/**
 * smoke.js — server end-to-end smoke test (no framework, plain node).
 *
 * Spawns the server in simulate mode, then verifies:
 *   1. /api/health responds ok
 *   2. /api/state reports providers
 *   3. /api/sessions returns the simulator's sessions
 *   4. a WebSocket client receives hello + live events
 *   5. POST /ingest round-trips a custom event to the WS feed
 *
 * Exits 0 on success, 1 on any failure. Run: node scripts/smoke.js
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3999; // dedicated port so a running dev server doesn't clash
const BASE = `http://127.0.0.1:${PORT}`;

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const server = spawn(process.execPath, ['server/src/index.js', '--simulate'], {
  cwd: root,
  env: { ...process.env, BRAIN_PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let serverOut = '';
server.stdout.on('data', (d) => {
  serverOut += String(d);
});
server.stderr.on('data', (d) => {
  serverOut += String(d);
});

async function waitForServer(ms = 8000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

function kill() {
  try {
    server.kill();
  } catch {
    /* ignore */
  }
}

try {
  const up = await waitForServer();
  check('server starts and answers /api/health', up, up ? '' : serverOut.slice(-600));
  if (!up) throw new Error('server never came up');

  const health = await (await fetch(`${BASE}/api/health`)).json();
  check('health payload sane', health.ok === true && health.simulate === true, JSON.stringify(health));

  const state = await (await fetch(`${BASE}/api/state`)).json();
  check('system state has providers', Array.isArray(state.providers) && state.providers.length >= 1, `${state.providers?.length ?? 0} providers, ${state.mcpServers?.length ?? 0} mcp`);
  check(
    'system state serves full skills list',
    Array.isArray(state.skills?.names) && state.skills.names.length > 50,
    `${state.skills?.names?.length ?? 0} skill names`,
  );

  const sessions1 = await (await fetch(`${BASE}/api/sessions`)).json();
  check('sessions endpoint lists simulated sessions', Array.isArray(sessions1.sessions) && sessions1.sessions.length >= 1, `${sessions1.sessions?.length ?? 0} sessions`);

  // ---- WebSocket round trip ----
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
  const inbox = [];
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('ws connect timeout')), 4000);
    ws.on('open', () => {
      clearTimeout(t);
      resolve();
    });
    ws.on('error', (e) => {
      clearTimeout(t);
      reject(e);
    });
  });
  ws.on('message', (d) => {
    try {
      inbox.push(JSON.parse(String(d)));
    } catch {
      /* ignore */
    }
  });

  await new Promise((r) => setTimeout(r, 700));
  const hello = inbox.find((m) => m.kind === 'hello');
  check('ws hello received', Boolean(hello), hello ? `${hello.sessions?.length ?? 0} sessions in hello` : 'none');

  // Custom ingest batch (6 events) — drives the deterministic recorded-timeline
  // check below and proves array bodies work.
  const marker = `smoke-${Date.now()}`;
  const markerEvents = [
    { type: 'session.start', sessionId: marker, title: 'smoke test session' },
    ...Array.from({ length: 5 }, (_, i) => ({
      type: 'session.activity',
      sessionId: marker,
      messageCount: i + 1,
      text: `smoke message ${i + 1}`,
    })),
  ];
  const ingestRes = await (
    await fetch(`${BASE}/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(markerEvents),
    })
  ).json();
  check('POST /ingest accepted (batch)', ingestRes.ok === true && ingestRes.accepted === 6, JSON.stringify(ingestRes));

  await new Promise((r) => setTimeout(r, 900));
  const gotMarker = inbox.some((m) => m.kind === 'event' && m.event?.sessionId === marker);
  check('ingested event broadcast to ws clients', gotMarker);

  const simEvents = inbox.filter((m) => m.kind === 'event' && m.event?.simulated);
  check('simulator events flowing', simEvents.length >= 1, `${simEvents.length} simulated events in window`);

  // Event recorder: the marker event must be durably recorded in today's jsonl.
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const recorded = await (await fetch(`${BASE}/api/events?day=${day}&limit=500`)).json();
  check(
    'events durably recorded to jsonl',
    Array.isArray(recorded.events) && recorded.events.some((e) => e.sessionId === marker),
    `${recorded.count ?? 0} events today`,
  );

  // ---- Timelines (M3 replay) ----
  // Deterministic: the 6 marker events we just posted must produce a timeline.
  {
    const res = await fetch(`${BASE}/api/sessions/${encodeURIComponent(marker)}/timeline`);
    const tl = res.ok ? await res.json() : null;
    check(
      'recorded timeline builds (marker session)',
      !!tl && tl.source === 'recorded' && tl.frames.length === 6 && tl.duration > 0,
      tl ? `${tl.frames.length} frames / ${Math.round(tl.duration)}s` : `HTTP ${res.status}`,
    );
  }

  // ---- Analytics (M4) ----
  {
    const res = await fetch(`${BASE}/api/analytics`);
    const an = res.ok ? await res.json() : null;
    check(
      'analytics builds (all scope)',
      !!an &&
        Array.isArray(an.toolHealth) &&
        an.toolHealth.length >= 1 &&
        an.activity.days.length === 30 &&
        an.heatmap.rows.length === 7 &&
        an.heatmap.rows[0].length === 24 &&
        an.counts.total > 0,
      an ? `${an.counts.total} events / ${an.toolHealth.length} tools / ${an.counts.sessions} sessions` : `HTTP ${res.status}`,
    );
  }
  {
    const res = await fetch(`${BASE}/api/analytics?scope=real`);
    const an = res.ok ? await res.json() : null;
    check(
      'analytics real scope excludes simulated',
      !!an && an.scope === 'real' && an.counts.scoped === an.counts.real && an.counts.real < an.counts.total,
      an ? `scoped=${an.counts.scoped} of total=${an.counts.total}` : `HTTP ${res.status}`,
    );
  }

  // Real vault session (recorded or transcript source — both are valid).
  const realCandidate = sessions1.sessions.find((s) => s.simulated !== true && s.messages > 5);
  if (realCandidate) {
    const res = await fetch(`${BASE}/api/sessions/${encodeURIComponent(realCandidate.id)}/timeline`);
    const tl = res.ok ? await res.json() : null;
    check(
      'real session timeline builds (gaps compressed)',
      !!tl &&
        ['recorded', 'transcript'].includes(tl.source) &&
        tl.frames.length >= 5 &&
        tl.duration > 0 &&
        tl.duration < 4 * 3600,
      tl ? `${tl.source}: ${tl.frames.length} frames / ${Math.round(tl.duration)}s` : `HTTP ${res.status}`,
    );
  } else {
    check('real session timeline builds (gaps compressed)', false, 'no vault session with messages found');
  }

  ws.close();
  kill();
} catch (err) {
  check('smoke run completed without exception', false, err?.message || String(err));
  kill();
} finally {
  await new Promise((r) => setTimeout(r, 300));
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}
