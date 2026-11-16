/**
 * qa-shot.js — zero-dependency visual QA for the brain interface.
 *
 * Drives already-cached Chrome over the DevTools Protocol using Node's
 * built-in WebSocket client. No playwright/puppeteer install required.
 *
 *   node scripts/qa-shot.js [url] [out.png]
 *
 * What it does:
 *   1. Launches headless Chrome pointed at the app.
 *   2. Collects console messages and uncaught exceptions.
 *   3. Waits for the boot overlay to finish (or times out).
 *   4. Evaluates app state (__brain hook): backend, fps, sessions, feed.
 *   5. Captures a PNG screenshot.
 *   6. Prints a JSON summary and exits non-zero on boot failure.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const URL_ARG = process.argv[2] || 'http://localhost:4200';
const OUT_PNG = process.argv[3] || path.join(os.tmpdir(), 'brain-qa.png');
const DEBUG_PORT = 9223;
const BOOT_TIMEOUT_MS = 20_000;

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];
const chromePath = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
if (!chromePath) {
  console.error('no Chrome/Edge found');
  process.exit(1);
}

const profileDir = path.join(os.tmpdir(), `brain-qa-profile-${Date.now()}`);
const chrome = spawn(
  chromePath,
  [
    '--headless=new',
    '--enable-unsafe-swiftshader',
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1600,900',
    '--hide-scrollbars',
    '--disable-extensions',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getTarget() {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      /* chrome not ready */
    }
    await sleep(200);
  }
  throw new Error('chrome devtools endpoint never came up');
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    ws.onmessage = (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id != null && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      } else if (msg.method) {
        this.events.push(msg);
      }
    };
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`${method} timed out`));
        }
      }, 20_000);
    });
  }
}

try {
  const wsUrl = await getTarget();
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  const cdp = new CDP(ws);

  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('Page.navigate', { url: URL_ARG });

  // Wait for boot overlay to be dismissed.
  const bootDeadline = Date.now() + BOOT_TIMEOUT_MS;
  let bootDone = false;
  while (Date.now() < bootDeadline) {
    await sleep(500);
    try {
      const res = await cdp.send('Runtime.evaluate', {
        expression: `document.getElementById('boot')?.classList.contains('done') ?? false`,
        returnByValue: true,
      });
      if (res.result?.value === true) {
        bootDone = true;
        break;
      }
    } catch {
      /* still navigating */
    }
  }

  // Let a few frames + simulator events land.
  await sleep(3000);

  const stateRes = await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      const b = window.__brain;
      return {
        bootDone: document.getElementById('boot')?.classList.contains('done') ?? false,
        bootText: document.querySelector('.boot-text')?.textContent ?? null,
        panels: !!document.querySelector('#panel-sessions'),
        backend: b?.engine?.backend ?? null,
        fps: b?.engine ? Math.round(b.engine.fps) : null,
        connection: b?.store?.connection ?? null,
        sessions: document.querySelectorAll('.session-card').length,
        feedItems: document.querySelectorAll('.feed-item').length,
        regionLabels: document.querySelectorAll('.region-label').length,
        labelsVisible: Array.from(document.querySelectorAll('.region-label')).filter(n => n.style.display !== 'none').length,
        mode: b?.mode ? b.mode() : null,
        mapNodes: b?.map ? b.map.nodeCount() : null,
        mapVisible: b?.map ? b.map.group.visible : null,
        mapLabelsVisible: Array.from(document.querySelectorAll('.map-label')).filter(n => n.style.display !== 'none').length,
        detailOpen: document.querySelector('#panel-detail')?.style.display !== 'none' ?? false,
        modeButtons: document.querySelectorAll('.mode-btn').length,
        activeModeBtn: document.querySelector('.mode-btn.active')?.textContent ?? null,
        pillRect: (() => {
          const el = document.getElementById('panel-mode');
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
        })(),
        activeBtnRect: (() => {
          const el = document.querySelector('.mode-btn.active');
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width) };
        })(),
        cameraPos: b?.engine ? { x: Math.round(b.engine.camera.position.x), y: Math.round(b.engine.camera.position.y), z: Math.round(b.engine.camera.position.z) } : null,
        labelSample: Array.from(document.querySelectorAll('.map-label')).filter(n => n.style.display !== 'none').slice(0, 6).map(n => ({ t: n.textContent, l: n.style.left, top: n.style.top })),
      };
    })()`,
    returnByValue: true,
  });
  const state = stateRes.result?.value ?? null;

  // Console + exceptions.
  const console_ = cdp.events
    .filter((e) => e.method === 'Runtime.consoleAPICalled')
    .map((e) => ({
      level: e.params.type,
      text: (e.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300),
    }))
    .filter((l) => l.level !== 'debug');
  const exceptions = cdp.events
    .filter((e) => e.method === 'Runtime.exceptionThrown')
    .map((e) => e.params.exceptionDetails?.exception?.description?.slice(0, 500) || e.params.exceptionDetails?.text);

  // Screenshot.
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(OUT_PNG, Buffer.from(shot.data, 'base64'));

  const summary = { url: URL_ARG, bootDone, state, console: console_.slice(-20), exceptions, screenshot: OUT_PNG };
  console.log(JSON.stringify(summary, null, 2));

  ws.close();
  chrome.kill();
  process.exit(bootDone && state?.panels ? 0 : 1);
} catch (err) {
  console.error('qa-shot failed:', err?.message || err);
  chrome.kill();
  process.exit(2);
}
