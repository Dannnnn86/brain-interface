/**
 * sessions.js — disk-backed session store.
 *
 * Two sources merged:
 *   1. Disk (durable): parses <vault>/sessions/index.md entries and, on
 *      demand, the transcript files themselves.
 *   2. Live (ephemeral): sessions currently being reported by the opencode
 *      plugin or the simulator (fed by ingest.js).
 *
 * Live summaries win while a session is active; once idle, disk entries and
 * live entries converge on the same id (session ids come from opencode).
 */
import fs from 'node:fs';
import path from 'node:path';
import { INDEX_FILE, SESSIONS_DIR } from './config.js';

/** Hard cap on tracked sessions (live + disk). Oldest idle/completed are
 *  evicted first from MEMORY/LISTS ONLY — vault files are never touched. */
const MAX_TRACKED_SESSIONS = 500;
const MAX_TRANSCRIPT_BYTES = 4 * 1024 * 1024;
const MAX_MESSAGES_PER_SESSION = 500;

/* ------------------------------ index.md ------------------------------ */

const ENTRY_START = /^(?:##+|-)\s*(\d{4}-\d{2}-\d{2})\s*[—–-]\s*(.+?)\s*$/;

function cleanBold(line) {
  return line.replace(/\*\*/g, '');
}

/**
 * Parse sessions/index.md (both historical formats appear in the wild):
 *   ## 2026-08-06 — Title          |  - 2026-08-08 — title ...
 *   - **Session:** `ses_...`       |    - Session: `ses_...`
 *   - **Messages:** 147            |    - Messages: 14
 *   - **Tag:** `...`               |    - Tag: `...`
 *   - **Transcript:** [[...]]      |    - Transcript: [[...]]
 */
export function parseIndex(text) {
  const entries = [];
  let cur = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const start = line.match(ENTRY_START);
    if (start && !/transcript|session|messages|tag/i.test(start[2]).valueOf()) {
      if (cur && cur.id) entries.push(cur);
      cur = { date: start[1], title: start[2].slice(0, 200), id: '', messages: 0, tag: '', transcript: '' };
      continue;
    }
    if (!cur) continue;

    const plain = cleanBold(line);
    let m;
    if ((m = plain.match(/^[-•]?\s*Session:\s*`?([A-Za-z0-9_\-]+)`?/i))) {
      cur.id = m[1];
    } else if ((m = plain.match(/^[-•]?\s*Messages:\s*(\d+)/i))) {
      cur.messages = Number(m[1]);
    } else if ((m = plain.match(/^[-•]?\s*Tag:\s*`?([^`\n]+)`?/i))) {
      cur.tag = m[1].trim();
    } else if ((m = plain.match(/Transcript:\s*\[\[([^\]|]+)/i))) {
      cur.transcript = m[1].trim();
    }
  }
  if (cur && cur.id) entries.push(cur);
  return entries;
}

/* ----------------------------- transcripts ----------------------------- */

const MSG_HEADER = /^###\s*\[(\d+)\]\s*(\w+)\s*[—-]\s*(.+)$/;
const TOOL_LINE = /^>\s*\*\*([A-Za-z0-9_\-]+)\*\*\((.*)\)\s*$/;
const FILE_LINE = /^>\s*\*\*file:\*\*\s*(.+)$/;

/** Parse one transcript file into a compact, UI-ready shape. */
export function parseTranscript(file) {
  let text;
  try {
    const stat = fs.statSync(file);
    const fd = fs.openSync(file, 'r');
    const size = Math.min(stat.size, MAX_TRANSCRIPT_BYTES);
    const buf = Buffer.alloc(size);
    fs.readSync(fd, buf, 0, size, 0);
    fs.closeSync(fd);
    text = buf.toString('utf8');
  } catch {
    return null;
  }

  const messages = [];
  const toolCounts = {};
  const files = new Set();
  let cur = null;

  const push = () => {
    if (cur) {
      cur.text = cur.lines.join('\n').trim().slice(0, 600);
      delete cur.lines;
      messages.push(cur);
    }
    cur = null;
  };

  for (const line of text.split(/\r?\n/)) {
    const header = line.match(MSG_HEADER);
    if (header) {
      push();
      if (messages.length >= MAX_MESSAGES_PER_SESSION) break;
      cur = { index: Number(header[1]), role: header[2], ts: header[3].trim(), tools: [], lines: [] };
      continue;
    }
    if (!cur) continue;
    if (line.startsWith('> _step start')) continue;
    if (line.startsWith('<details') || line.startsWith('</details>') || line.startsWith('```')) continue;

    const tool = line.match(TOOL_LINE);
    if (tool) {
      const name = tool[1];
      cur.tools.push({ name, summary: tool[2].slice(0, 140) });
      toolCounts[name] = (toolCounts[name] || 0) + 1;
      continue;
    }
    const fileLine = line.match(FILE_LINE);
    if (fileLine) {
      files.add(fileLine[1].trim());
      continue;
    }
    if (line.startsWith('> **snapshot files:**')) {
      for (const f of line.replace('> **snapshot files:**', '').split(',')) {
        const t = f.trim();
        if (t) files.add(t);
      }
      continue;
    }
    if (line.startsWith('>')) continue;
    cur.lines.push(line);
  }
  push();

  return {
    messages,
    toolCounts,
    files: [...files].slice(0, 50),
  };
}

/* ------------------------------- store ------------------------------- */

export class SessionStore {
  constructor() {
    /** @type {Map<string, any>} disk sessions by id */
    this.disk = new Map();
    /** @type {Map<string, any>} live sessions by id */
    this.live = new Map();
  }

  /** Re-read index.md and merge into the disk map (most recent within budget). */
  refreshFromDisk() {
    let text = '';
    try {
      text = fs.readFileSync(INDEX_FILE, 'utf8');
    } catch {
      return;
    }
    const budget = Math.max(0, MAX_TRACKED_SESSIONS - this.live.size);
    const entries = parseIndex(text).slice(-budget);
    for (const e of entries) {
      const prev = this.disk.get(e.id) || {};
      this.disk.set(e.id, {
        id: e.id,
        title: e.title || prev.title || 'Untitled session',
        date: e.date || prev.date || '',
        tag: e.tag || prev.tag || '',
        messages: e.messages || prev.messages || 0,
        tools: prev.tools || 0,
        files: prev.files || 0,
        status: 'idle',
        transcript: e.transcript || prev.transcript || '',
      });
    }
    this.evict();
  }

  /** Upsert a session coming from live events. */
  upsertLive(summary) {
    const prev = this.live.get(summary.id) || {};
    this.live.set(summary.id, { ...prev, ...summary });
    this.evict();
  }

  /**
   * Keep the tracked catalog at MAX_TRACKED_SESSIONS: oldest idle/completed
   * live entries drop first, then oldest disk entries. Memory/lists only —
   * transcripts and recordings stay on disk and remain replayable.
   */
  evict() {
    let over = this.live.size + this.disk.size - MAX_TRACKED_SESSIONS;
    if (over <= 0) return;
    // 1) finished live sessions, oldest activity first
    const idleLive = [...this.live.values()]
      .filter((s) => s.status !== 'live')
      .sort((a, b) => (a.lastEventAt || 0) - (b.lastEventAt || 0));
    for (const s of idleLive) {
      if (over <= 0) break;
      this.live.delete(s.id);
      over -= 1;
    }
    // 2) still over? oldest disk entries (files untouched)
    if (over > 0) {
      const disks = [...this.disk.values()].sort((a, b) =>
        String(a.date).localeCompare(String(b.date)),
      );
      for (const s of disks) {
        if (over <= 0) break;
        this.disk.delete(s.id);
        over -= 1;
      }
    }
  }

  /** Live-table sessions only (this opencode run) — drives the left deck. */
  listLive() {
    return [...this.live.values()].sort(
      (a, b) => (b.lastEventAt || 0) - (a.lastEventAt || 0),
    );
  }

  /** Drop every live session (used when a new opencode run starts). */
  clearLive() {
    this.live.clear();
  }

  /** Find one session in index.md even if it was evicted from memory. */
  findOnDisk(id) {
    try {
      const text = fs.readFileSync(INDEX_FILE, 'utf8');
      const entry = parseIndex(text).find((e) => e.id === id);
      if (!entry) return null;
      return {
        id: entry.id,
        title: entry.title || 'Untitled session',
        date: entry.date || '',
        tag: entry.tag || '',
        messages: entry.messages || 0,
        tools: 0,
        files: 0,
        status: 'idle',
        transcript: entry.transcript || '',
      };
    } catch {
      return null;
    }
  }

  /** Get one live session (ingest mutates through this). */
  getLive(id) {
    return this.live.get(id);
  }

  /** Full merge for the UI: live sessions first, disk newest-first after. */
  list() {
    const seen = new Set();
    const out = [];
    const lives = [...this.live.values()].sort((a, b) => (b.lastEventAt || 0) - (a.lastEventAt || 0));
    for (const s of lives) {
      out.push({
        ...s,
        date: s.date || new Date(s.startedAt || s.lastEventAt || Date.now()).toISOString().slice(0, 10),
      });
      seen.add(s.id);
    }
    const disks = [...this.disk.values()]
      .filter((s) => !seen.has(s.id))
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
    for (const s of disks) out.push(s);
    return out;
  }

  /**
   * Detailed view: summary + transcript (from disk when available, else the
   * live event trail held by ingest).
   */
  detail(id) {
    const live = this.live.get(id) || null;
    // Memory-first, then a direct index.md scan so evicted sessions still
    // resolve for replay.
    const disk = this.disk.get(id) || this.findOnDisk(id);
    const summary = {
      ...(disk || {}),
      ...(live || {}),
      id,
      status: live?.status || 'idle',
    };
    let transcript = null;
    if (disk?.transcript) {
      const file = path.join(SESSIONS_DIR, disk.transcript.replace(/^sessions\//, '') + '.md');
      transcript = parseTranscript(file);
    }
    return { summary, transcript };
  }
}
