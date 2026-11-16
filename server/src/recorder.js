/**
 * recorder.js — durable event log for replay + analytics.
 *
 * Every normalized ingest event is appended to a daily JSONL file under
 * server/data/events/YYYYMMDD.jsonl. Appends are fire-and-forget (fs.appendFile
 * callback) so the live path is never blocked by disk IO. The files are the
 * source of truth for M3 replay and M4 analytics.
 */
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.resolve(import.meta.dirname, '../../data/events');
const MAX_READ = 5000;

/** YYYYMMDD in UTC — matches the appends below and the API's default. */
export function currentDay() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

export class Recorder {
  constructor() {
    this.day = null;
    this.file = null;
    this.ready = false;
    this.count = 0;
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      this.ready = true;
    } catch {
      /* fail silent — recording is best-effort */
    }
  }

  /** Append one normalized event. Never throws, never blocks. */
  append(event) {
    if (!this.ready || !event) return;
    const day = new Date(event.at || Date.now()).toISOString().slice(0, 10).replace(/-/g, '');
    if (day !== this.day) {
      this.day = day;
      this.file = path.join(DATA_DIR, `${day}.jsonl`);
    }
    this.count += 1;
    fs.appendFile(this.file, `${JSON.stringify(event)}\n`, () => {
      /* callback form = non-blocking; errors intentionally swallowed */
    });
  }

  /** Read recorded events for a day (most recent `limit` first→last order kept). */
  read(day = currentDay(), limit = 2000) {
    const file = path.join(DATA_DIR, `${day}.jsonl`);
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      return [];
    }
    const lines = text.split('\n').filter(Boolean);
    const capped = Math.min(Math.max(1, limit), MAX_READ);
    const slice = lines.slice(-capped);
    const out = [];
    for (const line of slice) {
      try {
        out.push(JSON.parse(line));
      } catch {
        /* skip corrupt line */
      }
    }
    return out;
  }

  /**
   * All recorded events for one session across recent days, time-ordered.
   * Substring pre-filter keeps parsing cheap on big files.
   */
  readForSession(sessionId, daysBack = 14, cap = 2000) {
    if (!this.ready || !sessionId) return [];
    const days = this.days().slice(-daysBack);
    const needle = `"sessionId":"${sessionId}"`;
    const out = [];
    for (const day of days) {
      let text;
      try {
        text = fs.readFileSync(path.join(DATA_DIR, `${day}.jsonl`), 'utf8');
      } catch {
        continue;
      }
      for (const line of text.split('\n')) {
        if (!line || !line.includes(needle)) continue;
        try {
          const e = JSON.parse(line);
          if (e.sessionId === sessionId) out.push(e);
        } catch {
          /* skip corrupt line */
        }
      }
    }
    out.sort((a, b) => (a.at || 0) - (b.at || 0));
    return out.length > cap ? out.slice(-cap) : out;
  }

  /** Days that have recordings, oldest first. */
  days() {
    try {
      return fs
        .readdirSync(DATA_DIR)
        .filter((f) => /^\d{8}\.jsonl$/.test(f))
        .map((f) => f.replace('.jsonl', ''))
        .sort();
    } catch {
      return [];
    }
  }
}
