/**
 * state.js — reads the opencode system's own shape for the Architecture Map:
 * providers/models, MCP servers, plugins, skills, agents.
 *
 * Sources:
 *   ~/.config/opencode/opencode.jsonc   (JSONC — comments stripped)
 *   ~/.config/opencode/skills/*\/SKILL.md
 *   ~/.agents/skills/*\/SKILL.md
 *   ~/.config/opencode/node_modules/superpowers/skills/*\/SKILL.md
 *   ~/.config/opencode/agent(s)/*.md
 *
 * Cached for 30s; rebuild on demand.
 */
import fs from 'node:fs';
import path from 'node:path';
import { configDir } from './config.js';

const CACHE_TTL_MS = 30_000;
let cache = { at: 0, state: null };

/** Strip // and /* comments from JSONC without breaking strings. */
export function stripJsonc(text) {
  let out = '';
  let inString = false;
  let inLine = false;
  let inBlock = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inLine) {
      if (ch === '\n') {
        inLine = false;
        out += ch;
      }
      continue;
    }
    if (inBlock) {
      if (ch === '*' && next === '/') {
        inBlock = false;
        i++;
      }
      continue;
    }
    if (inString) {
      out += ch;
      if (ch === '\\') {
        out += next ?? '';
        i++;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === '/' && next === '/') {
      inLine = true;
      i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlock = true;
      i++;
      continue;
    }
    out += ch;
  }
  return out;
}

function readJsonc(file) {
  try {
    if (!fs.existsSync(file)) return {};
    return JSON.parse(stripJsonc(fs.readFileSync(file, 'utf8')));
  } catch {
    return {};
  }
}

function listDirs(root) {
  try {
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory() || e.isSymbolicLink())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

function collectSkills() {
  const home = process.env.USERPROFILE || process.env.HOME || '';
  const roots = [
    path.join(configDir(), 'skills'),
    path.join(home, '.agents', 'skills'),
    path.join(configDir(), 'node_modules', 'superpowers', 'skills'),
    path.join(home, '.opencode', 'skills'),
  ];
  const names = new Set();
  for (const root of roots) {
    for (const dir of listDirs(root)) {
      try {
        if (fs.existsSync(path.join(root, dir, 'SKILL.md'))) names.add(dir);
      } catch {
        /* unreadable dir — skip */
      }
    }
  }
  const all = [...names].sort();
  return { count: all.length, sample: all.slice(0, 40) };
}

function collectAgents() {
  const roots = [
    path.join(configDir(), 'agent'),
    path.join(configDir(), 'agents'),
  ];
  const names = new Set(['build', 'plan']);
  for (const root of roots) {
    try {
      for (const file of fs.readdirSync(root)) {
        if (file.endsWith('.md')) names.add(path.basename(file, '.md'));
      }
    } catch {
      /* dir absent — fine */
    }
  }
  return [...names].sort();
}

/** Build the full SystemState. */
export function buildSystemState() {
  const dir = configDir();
  const cfg = readJsonc(path.join(dir, 'opencode.jsonc'));
  const disabled = new Set(Array.isArray(cfg.disabled_providers) ? cfg.disabled_providers : []);

  const providers = Object.entries(cfg.provider || {}).map(([id, def]) => ({
    id,
    name: (def && (def.name || def.npm)) || id,
    models: Object.keys((def && def.models) || {}),
    disabled: disabled.has(id),
  }));

  const mcpServers = Object.entries(cfg.mcp || {}).map(([name, def]) => ({
    name,
    type: (def && def.type) || 'local',
    enabled: def?.enabled === true,
  }));

  const plugins = (Array.isArray(cfg.plugin) ? cfg.plugin : []).map((p) =>
    typeof p === 'string' ? p : Array.isArray(p) ? String(p[0]) : String(p)
  );

  return {
    vault: '', // filled by caller (index.js knows the vault)
    configDir: dir,
    providers,
    mcpServers,
    plugins,
    skills: collectSkills(),
    agents: collectAgents(),
    generatedAt: Date.now(),
  };
}

/** Cached accessor. */
export function getSystemState(vault, { force = false } = {}) {
  const now = Date.now();
  if (!force && cache.state && now - cache.at < CACHE_TTL_MS) {
    return { ...cache.state, vault };
  }
  const state = buildSystemState();
  cache = { at: now, state };
  return { ...state, vault };
}
