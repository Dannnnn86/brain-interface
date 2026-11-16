/**
 * qa-interact.js — interaction regression test for the brain interface.
 *
 * Drives a real headless Chrome over CDP and exercises the interaction layer:
 *   1. map mode: click near a provider label position → detail panel opens
 *   2. Esc → detail panel closes
 *   3. mode pill button click → back to brain mode
 *   4. keyboard "1" → frontal region focus (detail opens)
 *   5. session card click → detail opens with session title
 *   6. Space → PAUSED badge; Space again → badge gone
 *
 * Usage: node scripts/qa-interact.js [url]
 * Exit 0 = all checks pass.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const URL_ARG = process.argv[2] || 'http://localhost:4200/?mode=map';
const DEBUG_PORT = 9225;

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

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const profileDir = path.join(os.tmpdir(), `brain-interact-profile-${Date.now()}`);
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

let ws;
async function connect() {
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
  ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
}

let msgId = 0;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`${method} timeout`));
      }
    }, 15000);
  });
}

async function evaluate(expression) {
  const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  return res.result?.value;
}

try {
  await connect();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(String(ev.data));
    if (msg.id != null && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: URL_ARG });

  // Wait for boot.
  let booted = false;
  for (let i = 0; i < 40 && !booted; i++) {
    await sleep(500);
    booted = (await evaluate(`document.getElementById('boot')?.classList.contains('done') ?? false`)) === true;
  }
  check('app boots', booted);
  if (!booted) throw new Error('no boot');
  await sleep(1500);

  /* ---- 1. map click → detail ---- */
  const mode0 = await evaluate(`window.__brain?.mode?.() ?? null`);
  check('starts in map mode', mode0 === 'map', mode0);

  // Scan the central region for any pickable node, then dispatch a real
  // pointer click exactly there (robust to the map's slow rotation).
  const clicked = await evaluate(`(() => {
    const b = window.__brain;
    for (let y = 330; y < 580; y += 8) {
      for (let x = 620; x < 990; x += 8) {
        const hit = b.map.pick(x, y, b.engine.camera, b.engine.size);
        if (hit && hit.node.kind !== 'skill') {
          return { x, y, label: hit.node.label, kind: hit.node.kind };
        }
      }
    }
    return null;
  })()`);
  check('CPU picking finds a node', !!clicked, clicked ? `${clicked.kind}:${clicked.label}` : 'null');

  if (clicked) {
    await evaluate(`(async () => {
      const cv = document.getElementById('scene');
      const opts = { clientX: ${clicked.x}, clientY: ${clicked.y}, bubbles: true, pointerId: 1 };
      cv.dispatchEvent(new PointerEvent('pointerdown', opts));
      cv.dispatchEvent(new PointerEvent('pointerup', opts));
      await new Promise((r) => setTimeout(r, 400));
    })()`);
  }
  const detail1 = await evaluate(`({
    open: document.getElementById('panel-detail')?.style.display !== 'none',
    title: document.querySelector('.detail-title')?.textContent ?? null,
    rows: document.querySelectorAll('.detail-row').length,
  })`);
  check('node click opens detail panel', detail1.open === true && detail1.rows > 0, detail1.title);

  /* ---- 2. Esc closes ---- */
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
  await sleep(400);
  const detail2 = await evaluate(`document.getElementById('panel-detail')?.style.display !== 'none'`);
  check('Esc closes detail panel', detail2 === false);

  /* ---- 3. mode pill → brain ---- */
  await evaluate(`document.querySelector('.mode-btn[data-mode="brain"]').click()`);
  await sleep(1200);
  const mode1 = await evaluate(`window.__brain?.mode?.() ?? null`);
  check('mode pill switches to brain', mode1 === 'brain', mode1);

  /* ---- 4. keyboard 1 → frontal ---- */
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: '1' }))`);
  await sleep(500);
  const detail3 = await evaluate(`({
    open: document.getElementById('panel-detail')?.style.display !== 'none',
    title: document.querySelector('.detail-title')?.textContent ?? null,
  })`);
  check('key "1" focuses frontal region', detail3.open === true && (detail3.title || '').includes('frontal'), detail3.title);

  /* ---- 5. session card click ---- */
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
  await sleep(300);
  const cardInfo = await evaluate(`(async () => {
    const card = document.querySelector('.session-card');
    if (!card) return null;
    const title = card.querySelector('.session-title')?.textContent ?? '';
    card.click();
    await new Promise((r) => setTimeout(r, 500));
    return {
      title,
      open: document.getElementById('panel-detail')?.style.display !== 'none',
      panelTitle: document.querySelector('.detail-title')?.textContent ?? null,
    };
  })()`);
  check(
    'session card click opens session detail',
    !!cardInfo && cardInfo.open === true,
    cardInfo ? `${cardInfo.title} → ${cardInfo.panelTitle}` : 'no card',
  );

  /* ---- 6. Space pause toggle ---- */
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }))`);
  await sleep(300);
  const paused1 = await evaluate(`Array.from(document.querySelectorAll('#panel-mode .badge')).some(b => b.style.display !== 'none' && b.textContent.includes('PAUSED'))`);
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }))`);
  await sleep(300);
  const paused2 = await evaluate(`Array.from(document.querySelectorAll('#panel-mode .badge')).some(b => b.style.display !== 'none' && b.textContent.includes('PAUSED'))`);
  check('Space toggles PAUSED badge on', paused1 === true);
  check('Space toggles PAUSED badge off', paused2 === false);

  ws.close();
  chrome.kill();
} catch (err) {
  check('interaction run completed without exception', false, err?.message || String(err));
  try {
    chrome.kill();
  } catch {
    /* ignore */
  }
} finally {
  await sleep(300);
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} interaction checks passed`);
  process.exit(failed ? 1 : 0);
}
