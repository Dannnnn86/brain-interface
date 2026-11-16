/**
 * index.js — brain-interface server entry point.
 *
 * One HTTP server that:
 *   - serves the REST API            (/api/*)
 *   - accepts plugin events          (POST /ingest)
 *   - upgrades WebSocket clients     (/ws)
 *   - serves the built web app       (when web/dist exists or --serve-web)
 *
 * Run modes:
 *   node server/src/index.js                  → live only (plugin + vault watch)
 *   node server/src/index.js --simulate       → synthetic sessions for demos
 *   node server/src/index.js --serve-web      → also serve web/dist statically
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { Hub } from './hub.js';
import { Ingest } from './ingest.js';
import { Recorder, currentDay } from './recorder.js';
import { SessionStore } from './sessions.js';
import { buildTimeline } from './timeline.js';
import { startWatcher } from './watcher.js';
import { Simulator } from './simulator.js';
import { getSystemState } from './state.js';
import {
  BRAIN_PORT, HOST, MIME, SESSIONS_DIR, SIMULATE, VAULT,
} from './config.js';

const WEB_DIST = path.resolve(import.meta.dirname, '../../web/dist');
const startedAt = Date.now();

const log = (msg) => console.log(`[brain] ${msg}`);

/* ------------------------------- wiring ------------------------------- */

const store = new SessionStore();
store.refreshFromDisk();

const hub = new Hub({ log, onClientMessage: handleClientMessage });

const recorder = new Recorder();

const ingest = new Ingest({
  hub,
  store,
  recorder,
  log: (m) => log(`ingest: ${m}`),
});

const watcher = startWatcher({
  log,
  onSessionsChanged: (file) => {
    store.refreshFromDisk();
    ingest.broadcastSessions();
    log(`sessions refreshed (${path.basename(file)})`);
  },
});

// Fallback refresh — protects against missed fs events.
const refreshTimer = setInterval(() => {
  store.refreshFromDisk();
}, 60_000);
refreshTimer.unref?.();

let simulator = null;
if (SIMULATE) {
  simulator = new Simulator({
    onEvent: (e) => ingest.handle(e),
    log: (m) => log(`sim: ${m}`),
  });
  simulator.start();
}

/* ----------------------------- HTTP server ----------------------------- */

function json(res, code, body) {
  const payload = JSON.stringify(body);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

function readBody(req, cap = 512 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > cap) {
        reject(new Error('payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname) {
  const distExists = fs.existsSync(WEB_DIST);
  if (!distExists) {
    json(res, 404, { error: 'web app not built — run: npm run build (or use the Vite dev server on :4200)' });
    return;
  }
  const safe = pathname.replace(/\.\.+/g, '').replace(/^\/+/, '');
  let file = path.join(WEB_DIST, safe || 'index.html');
  if (!file.startsWith(WEB_DIST)) file = path.join(WEB_DIST, 'index.html');
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(WEB_DIST, 'index.html'); // SPA fallback
  }
  try {
    const body = fs.readFileSync(file);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(body);
  } catch {
    json(res, 500, { error: 'static read failed' });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const { pathname } = url;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  try {
    if (req.method === 'POST' && pathname === '/ingest') {
      const raw = await readBody(req);
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        json(res, 400, { error: 'invalid JSON' });
        return;
      }
      const events = Array.isArray(parsed) ? parsed : [parsed];
      let accepted = 0;
      for (const e of events) if (ingest.handle(e)) accepted++;
      json(res, 200, { ok: true, accepted });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/health') {
      json(res, 200, {
        ok: true,
        version: 1,
        simulate: SIMULATE,
        uptimeMs: Date.now() - startedAt,
        wsClients: hub.size,
        sessions: store.list().length,
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/state') {
      json(res, 200, getSystemState(VAULT, { force: url.searchParams.has('force') }));
      return;
    }

    if (req.method === 'GET' && pathname === '/api/sessions') {
      json(res, 200, { sessions: store.list() });
      return;
    }

    const timeline = pathname.match(/^\/api\/sessions\/([^/]+)\/timeline$/);
    if (req.method === 'GET' && timeline) {
      const id = decodeURIComponent(timeline[1]);
      const built = buildTimeline({ store, recorder }, id);
      if (!built) json(res, 404, { error: 'no timeline for this session' });
      else json(res, 200, built);
      return;
    }

    const detail = pathname.match(/^\/api\/sessions\/([^/]+)$/);
    if (req.method === 'GET' && detail) {
      const id = decodeURIComponent(detail[1]);
      json(res, 200, store.detail(id));
      return;
    }

    if (req.method === 'GET' && pathname === '/api/feed') {
      json(res, 200, { feed: ingest.feed.slice(-100) });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/events') {
      const day = url.searchParams.get('day') || currentDay();
      const limit = Number(url.searchParams.get('limit') || 2000);
      const events = recorder.read(day, limit);
      json(res, 200, { day, count: events.length, events, days: recorder.days() });
      return;
    }

    if (req.method === 'GET' && (pathname === '/' || !pathname.startsWith('/api'))) {
      serveStatic(req, res, pathname);
      return;
    }

    json(res, 404, { error: 'not found' });
  } catch (err) {
    json(res, 500, { error: err?.message || String(err) });
  }
});

/* ----------------------------- WS RPC layer ----------------------------- */

function handleClientMessage(ws, msg) {
  if (!msg || typeof msg !== 'object') return;
  if (msg.kind === 'ping') {
    hub.reply(ws, { kind: 'pong', id: 0, result: { at: Date.now() } });
    return;
  }
  if (msg.kind !== 'req' || typeof msg.id !== 'number') return;

  const respond = (result) => hub.reply(ws, { kind: 'pong', id: msg.id, result });
  const fail = (message) => hub.reply(ws, { kind: 'error', id: msg.id, message });

  try {
    switch (msg.method) {
      case 'getState':
        respond({ state: getSystemState(VAULT, { force: true }) });
        break;
      case 'getSessions':
        respond({ sessions: store.list() });
        break;
      case 'getSession': {
        const id = String(msg.params?.id || '');
        if (!id) return fail('missing session id');
        respond(store.detail(id));
        break;
      }
      case 'getTimeline': {
        const id = String(msg.params?.id || '');
        if (!id) return fail('missing session id');
        const built = buildTimeline({ store, recorder }, id);
        if (!built) return fail('no timeline for this session');
        respond(built);
        break;
      }
      case 'getFeed':
        respond({ feed: ingest.feed.slice(-100) });
        break;
      case 'simulate':
        if (simulator) {
          const s = simulator.spawnSession();
          respond({ ok: true, sessionId: s.id });
        } else {
          fail('simulator not running — start the server with --simulate');
        }
        break;
      default:
        fail(`unknown method: ${msg.method}`);
    }
  } catch (err) {
    fail(err?.message || String(err));
  }
}

hub.attach(server);

/* ----------------------------- hello-on-connect ----------------------------- */

hub.wss.on('connection', (ws) => {
  hub.reply(ws, {
    kind: 'hello',
    protocolVersion: 1,
    state: getSystemState(VAULT),
    sessions: store.list().slice(0, 120),
    simulate: SIMULATE,
  });
});

/* -------------------------------- startup -------------------------------- */

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    log(`port ${BRAIN_PORT} is already in use — another brain-interface server may be running.`);
    log('Set BRAIN_PORT=<other> to use a different port.');
    process.exit(1);
  }
  log(`server error: ${err.message}`);
  process.exit(1);
});

server.listen(BRAIN_PORT, HOST, () => {
  log(`vault:        ${VAULT}`);
  log(`sessions dir: ${SESSIONS_DIR}${fs.existsSync(SESSIONS_DIR) ? '' : '  (NOT FOUND)'}`);
  log(`listening on  http://${HOST}:${BRAIN_PORT}   ws://${HOST}:${BRAIN_PORT}/ws`);
  log(`mode:         ${SIMULATE ? 'SIMULATE' : 'live'}${fs.existsSync(WEB_DIST) ? ' + serving web/dist' : ''}`);
});

function shutdown() {
  log('shutting down');
  simulator?.stop();
  watcher.close();
  ingest.close();
  hub.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500).unref?.();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
