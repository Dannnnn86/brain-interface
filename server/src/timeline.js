/**
 * timeline.js — session replay timelines.
 *
 * Builds a time-ordered frame list for one session, from two sources:
 *
 *   1. RECORDED (rich): the durable events/*.jsonl log — real timestamps,
 *      tool names, durations, error flags. Used when ≥5 events exist.
 *   2. TRANSCRIPT (universal): the vault transcript markdown — nearly every
 *      finished session has one. Message timestamps are real (from the
 *      `### [n] role — ts` headers); tool invocations become synthetic
 *      call/result frame pairs spread inside their message.
 *
 * Frames use the SystemEvent shape so the client can re-feed them into the
 * same impulse system as live events:
 *   { t, type, tool?, argsSummary?, ok?, durationMs?, text?, error? }
 * where t = seconds since session start.
 *
 * Results are cached (LRU 20, 10-minute TTL).
 */
const CACHE_MAX = 20;
const CACHE_TTL_MS = 10 * 60_000;
const MIN_RECORDED_EVENTS = 5;
const MAX_TRANSCRIPT_FRAMES = 1500;

const cache = new Map(); // id -> { at, timeline }

/* ------------------------------ helpers ------------------------------ */

/** '2026-08-08 02:49:40' → epoch ms (local), or null. */
function parseStamp(ts) {
  if (typeof ts !== 'string') return null;
  const m = ts.match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m.map(Number);
  const date = new Date(y, mo - 1, d, h, mi, s);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

const FILE_TOOLS = new Set(['edit', 'write', 'multiedit', 'patch']);

function bookmarkKindFor(frame) {
  if (frame.type === 'session.error' || frame.ok === false) return 'error';
  if (frame.type === 'tool.call') return FILE_TOOLS.has(frame.tool) ? 'file' : 'tool';
  return null;
}

function finalize(id, title, source, frames, totals) {
  frames.sort((a, b) => a.t - b.t);
  const duration = frames.length ? frames[frames.length - 1].t + 2 : 0;
  const bookmarks = [];
  for (const f of frames) {
    const kind = bookmarkKindFor(f);
    if (kind) bookmarks.push({ t: Math.round(f.t * 10) / 10, kind });
  }
  return {
    id,
    title: title || 'Untitled session',
    source,
    duration: Math.round(duration * 10) / 10,
    frames,
    bookmarks,
    totals: totals ?? null,
    generatedAt: Date.now(),
  };
}

/* ------------------------------ builders ------------------------------ */

function fromRecorded(summary, events) {
  // Real sessions span hours (overnight pauses) — compress idle gaps exactly
  // like transcripts do, keeping genuine bursts at full fidelity.
  const GAP_CAP_S = 60;
  let t = 0;
  let prevAt = null;
  const frames = events.map((e) => {
    const at = e.at || (prevAt ?? Date.now());
    if (prevAt != null) {
      const rawDelta = (at - prevAt) / 1000;
      t += Math.min(Math.max(rawDelta, 0), GAP_CAP_S);
    }
    prevAt = at;
    const frame = {
      t: Math.round(t * 10) / 10,
      type: e.type,
    };
    if (e.tool) frame.tool = e.tool;
    if (e.argsSummary) frame.argsSummary = e.argsSummary;
    if (typeof e.ok === 'boolean') frame.ok = e.ok;
    if (Number.isFinite(e.durationMs)) frame.durationMs = e.durationMs;
    if (e.text) frame.text = e.text;
    if (e.error) frame.error = e.error;
    return frame;
  });
  return finalize(summary.id, summary.title, 'recorded', frames, {
    messages: Math.max(summary.messages || 0, events.filter((e) => e.type === 'session.activity').length),
    tools: events.filter((e) => e.type === 'tool.call').length,
  });
}

function fromTranscript(summary, transcript) {
  const frames = [];
  const msgs = transcript.messages || [];
  let firstStamp = null;
  let rawPrev = null;
  let lastT = 0;

  // Idle-gap compression: human conversations pause for minutes/hours between
  // messages; replay keeps real bursts but caps any inter-message gap at 60s.
  const GAP_CAP_S = 60;

  for (const m of msgs) {
    const stamp = parseStamp(m.ts);
    if (stamp != null && firstStamp == null) firstStamp = stamp;
    let t;
    if (stamp != null && firstStamp != null) {
      const raw = (stamp - firstStamp) / 1000;
      const delta = rawPrev == null ? 0 : raw - rawPrev;
      t = lastT + Math.min(Math.max(delta, 0), GAP_CAP_S);
      rawPrev = raw;
    } else {
      t = lastT + 5; // no timestamps in this transcript shape
    }

    if (m.role === 'user') {
      frames.push({ t: Math.round(t * 10) / 10, type: 'session.activity', text: m.text || '' });
      lastT = t;
      continue;
    }

    // assistant message: tool invocations spread across ~2s, then the text
    const tools = m.tools || [];
    tools.forEach((tool, k) => {
      const tCall = t + (tools.length > 1 ? (k / tools.length) * 2 : 0);
      frames.push({ t: Math.round(tCall * 10) / 10, type: 'tool.call', tool: tool.name, argsSummary: tool.summary });
      frames.push({
        t: Math.round((tCall + 0.6) * 10) / 10,
        type: 'tool.result',
        tool: tool.name,
        ok: true,
        durationMs: 600,
      });
    });
    if (m.text) {
      frames.push({ t: Math.round((t + 2.4) * 10) / 10, type: 'session.activity', text: m.text });
    }
    lastT = t + (m.text ? 2.4 : 2);
  }

  if (frames.length > MAX_TRANSCRIPT_FRAMES) frames.length = MAX_TRANSCRIPT_FRAMES;
  return finalize(summary.id, summary.title, 'transcript', frames, {
    messages: summary.messages || msgs.length,
    tools: frames.filter((f) => f.type === 'tool.call').length,
  });
}

/* ------------------------------- public ------------------------------- */

/**
 * Build (or serve cached) timeline for a session id. Returns null when the
 * session has no usable source.
 */
export function buildTimeline({ store, recorder }, id) {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    cache.delete(id); // LRU touch
    cache.set(id, hit);
    return hit.timeline;
  }

  const detail = store.detail(id);
  const summary = detail.summary || { id, title: 'Untitled session' };

  let timeline = null;
  const recorded = recorder ? recorder.readForSession(id) : [];
  if (recorded.length >= MIN_RECORDED_EVENTS) {
    timeline = fromRecorded(summary, recorded);
  } else if (detail.transcript && detail.transcript.messages?.length) {
    timeline = fromTranscript(summary, detail.transcript);
  } else if (recorded.length) {
    // Tiny recorded bursts still beat nothing.
    timeline = fromRecorded(summary, recorded);
  }

  if (timeline) {
    cache.set(id, { at: Date.now(), timeline });
    if (cache.size > CACHE_MAX) {
      const oldest = cache.keys().next().value;
      cache.delete(oldest);
    }
  }
  return timeline;
}
