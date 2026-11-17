/**
 * dev.js — zero-dependency dev launcher.
 *
 * Starts the brain-interface server (optionally with --simulate) and the Vite
 * dev server for the web app side by side, prefixing all output so a single
 * terminal shows both streams. Ctrl+C cleanly stops both.
 *
 *   node scripts/dev.js              → server + web
 *   node scripts/dev.js --simulate   → server with synthetic sessions + web
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const simulate = process.argv.includes('--simulate');

const procs = [];
let shuttingDown = false;

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const p of procs) {
    try {
      p.kill();
    } catch {
      /* already dead */
    }
  }
  setTimeout(() => process.exit(code), 300);
}

function run(name, args, cwd) {
  const child = spawn(process.execPath, args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });
  const tag = `[${name}]`;
  const pipe = (stream) =>
    stream.on('data', (data) => {
      for (const line of String(data).split(/\r?\n/)) {
        if (line.trim()) console.log(`${tag} ${line}`);
      }
    });
  pipe(child.stdout);
  pipe(child.stderr);
  child.on('exit', (code) => {
    if (!shuttingDown) {
      console.log(`${tag} exited with code ${code}`);
      shutdown(code ?? 0);
    }
  });
  procs.push(child);
  return child;
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

const BRAIN_PORT = process.env.BRAIN_PORT || 3030;

console.log('[dev] starting brain-interface' + (simulate ? ' (SIMULATE mode)' : ''));
console.log('[dev] web UI will be at  http://localhost:' + (process.env.WEB_PORT || 4200));
console.log('[dev] api/ws backend at   http://127.0.0.1:' + BRAIN_PORT);

// If a server is already running on the port (e.g. the auto-start task),
// reuse it instead of failing with EADDRINUSE.
async function serverAlreadyRunning() {
  try {
    const res = await fetch(`http://127.0.0.1:${BRAIN_PORT}/api/health`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

serverAlreadyRunning().then((running) => {
  if (running) {
    console.log(`[dev] server already live on :${BRAIN_PORT} (auto-start task?) — reusing it`);
  } else {
    run('server', ['server/src/index.js', ...(simulate ? ['--simulate'] : [])], root);
  }
  // vite is hoisted to the workspace root node_modules by npm
  run('web', [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js')], path.join(root, 'web'));
});
