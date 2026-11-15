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

export const DEFAULT_VAULT = 'D:/documents/personal/main_vault';

export function configDir() {
  return (
    process.env.OPENCODE_CONFIG_DIR ||
    path.join(os.homedir(), '.config', 'opencode')
  );
}

function looksLikeVault(dir) {
  try {
    return (
      fs.existsSync(path.join(dir, 'Home.md')) &&
      fs.existsSync(path.join(dir, 'log.md'))
    );
  } catch {
    return false;
  }
}

/** Walk upward from `start` to find a vault root; fall back to default. */
export function findVault(start) {
  let dir = start;
  if (!dir) return DEFAULT_VAULT;
  while (true) {
    if (looksLikeVault(dir)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return DEFAULT_VAULT;
}

export function resolveVault() {
  if (process.env.BRAIN_VAULT) return process.env.BRAIN_VAULT;
  // Prefer the known vault when it exists on disk: project folders also
  // carry Home.md + log.md (their brain scaffold), so a plain upward walk
  // from the repo root would stop at the project instead of the vault.
  try {
    if (fs.existsSync(path.join(DEFAULT_VAULT, 'sessions')) || looksLikeVault(DEFAULT_VAULT)) {
      return DEFAULT_VAULT;
    }
  } catch {
    /* fall through to walk */
  }
  return findVault(process.cwd());
}

export const VAULT = resolveVault();
export const SESSIONS_DIR = path.join(VAULT, 'sessions');
export const INDEX_FILE = path.join(SESSIONS_DIR, 'index.md');

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
