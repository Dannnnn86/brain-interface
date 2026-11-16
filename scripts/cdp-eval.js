/**
 * cdp-eval.js — run a JS expression inside a fresh headless Chrome page.
 *
 *   node scripts/cdp-eval.js <url> "<expression>"
 *
 * Prints the JSON result. Zero dependencies (Node's built-in WebSocket).
 * Useful for debugging computed styles, geometry, and app state.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const URL_ARG = process.argv[2] || 'http://localhost:4200';
const EXPR = process.argv[3] || '1';
const DEBUG_PORT = 9224;

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

const profileDir = path.join(os.tmpdir(), `brain-eval-profile-${Date.now()}`);
const chrome = spawn(
  chromePath,
  [
    '--headless=new',
    '--enable-unsafe-swiftshader',
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--window-size=1600,900',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  let wsUrl = null;
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline && !wsUrl) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
      wsUrl = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl ?? null;
    } catch {
      /* not ready */
    }
    if (!wsUrl) await sleep(200);
  }
  if (!wsUrl) throw new Error('devtools endpoint never came up');

  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });

  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(String(ev.data));
    if (msg.id != null && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const mid = ++id;
      pending.set(mid, resolve);
      ws.send(JSON.stringify({ id: mid, method, params }));
    });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: URL_ARG });
  await sleep(4500); // let the app boot + settle

  const res = await send('Runtime.evaluate', {
    expression: EXPR,
    returnByValue: true,
    awaitPromise: true,
  });
  console.log(JSON.stringify(res.result?.result?.value ?? res.result, null, 2));
  ws.close();
  chrome.kill();
  process.exit(0);
} catch (err) {
  console.error('cdp-eval failed:', err?.message || err);
  chrome.kill();
  process.exit(1);
}
