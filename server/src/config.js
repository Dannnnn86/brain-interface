/**
 * config.js — runtime configuration + discovery.
 *
 * Ports come from env with sane defaults; the vault is discovered by walking
 * upward from the working directory looking for the second-brain signature
 * (Home.md + log.md), mirroring the session-logger plugin's logic so the
 * server and plugin always agree on where sessions live.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const HOST = '127.0.0.1';
export const BRAIN_PORT = Number(process.env.BRAIN_PORT || 3030);
export const SIMULATE = process.argv.includes('--simulate');
export const SERVE_WEB = process.argv.includes('--serve-web');

export function configDir() {
  return (
    process.env.OPENCODE_CONFIG_DIR ||
    path.join(os.homedir(), '.config', 'opencode')
  );
}

/** A vault has the second-brain signature AND a sessions/ directory —
 *  project brains (Home.md + log.md only) don't qualify. */
function looksLikeVault(dir) {
  try {
    return (
      fs.existsSync(path.join(dir, 'Home.md')) &&
      fs.existsSync(path.join(dir, 'log.md')) &&
      fs.existsSync(path.join(dir, 'sessions'))
    );
  } catch {
    return false;
  }
}

/** Walk upward from `start` to find a vault root; null when none. */
export function findVault(start) {
  let dir = start;
  if (!dir) return null;
  while (true) {
    if (looksLikeVault(dir)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** Machine-local overrides live in data/local.json (gitignored). */
function localVault() {
  try {
    const file = path.resolve(import.meta.dirname, '../../data/local.json');
    // Strip a UTF-8 BOM if present (Windows editors love adding one).
    const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    const json = JSON.parse(text);
    return typeof json.vault === 'string' && json.vault ? json.vault : null;
  } catch {
    return null;
  }
}

/**
 * Vault resolution order:
 *   1. BRAIN_VAULT env var
 *   2. data/local.json  { "vault": "…" }   (gitignored, machine-local)
 *   3. upward walk from the working directory
 * Result may be null — the server runs fine without a vault (live events +
 * simulator only); vault-backed features (history, transcripts) just stay off.
 */
export function resolveVault() {
  if (process.env.BRAIN_VAULT) return process.env.BRAIN_VAULT;
  return localVault() || findVault(process.cwd());
}

export const VAULT = resolveVault();
export const SESSIONS_DIR = VAULT ? path.join(VAULT, 'sessions') : null;
export const INDEX_FILE = SESSIONS_DIR ? path.join(SESSIONS_DIR, 'index.md') : null;

/** Files sent to the browser as-is. Small map — enough for our own dist. */
export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};
