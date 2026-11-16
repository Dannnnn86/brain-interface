/**
 * protocol.js — shared wire protocol between the brain-interface server,
 * the opencode reporter plugin, and the web client.
 *
 * Plain ESM with zero dependencies so it can run inside:
 *   - the Node server (native import)
 *   - the opencode plugin runtime (Bun — native import)
 *   - the browser (bundled by Vite)
 *
 * Types live in protocol.d.ts (same basename → TypeScript auto-resolves).
 */

export const PROTOCOL_VERSION = 1;

/** Event types flowing from opencode (or the simulator) into the server. */
export const EVENT = {
  SESSION_START: 'session.start',
  SESSION_ACTIVITY: 'session.activity',
  TOOL_CALL: 'tool.call',
  TOOL_RESULT: 'tool.result',
  SESSION_IDLE: 'session.idle',
  SESSION_ERROR: 'session.error',
  SESSION_FILE: 'session.file',
  /** Estimated session payload size (NVIDIA-cap guard). */
  SESSION_PAYLOAD: 'session.payload',
  /** Cumulative token + cost totals for a session (plugin-captured). */
  SESSION_TOKENS: 'session.tokens',
  /** Plugin (re)load handshake — a new value means a new opencode run. */
  RUNTIME_START: 'runtime.start',
};

/** Payload pressure guard: Dan's auto-trim threshold (18 MB). */
export const PAYLOAD_TRIM_BYTES = 18_000_000;

/** Brain regions used as visual anchors (mirrors the spec's mapping). */
export const REGIONS = [
  'frontal',    // agents / planning
  'temporal',   // sessions / memory
  'parietal',   // mcp bridge / integrations
  'occipital',  // visual output
  'cerebellum', // skills
  'brainstem',  // core runtime
];

/** Neural palette (spec tokens). */
export const PALETTE = {
  afferent: 0x00d4ff, // user → model
  efferent: 0xff6b00, // model → tool
  internal: 0xb84aff, // reasoning
  ret: 0x00ff88,      // tool → model
  error: 0xff0044,
  background: 0x030508,
};

/**
 * Where an impulse for a given event travels (from → to region anchors).
 * Used by the client's impulsion system; kept here so server and client agree.
 */
export function impulsePathFor(type) {
  switch (type) {
    case EVENT.SESSION_ACTIVITY: return { from: 'brainstem', to: 'frontal', color: PALETTE.afferent };
    case EVENT.TOOL_CALL:       return { from: 'frontal', to: 'parietal', color: PALETTE.efferent };
    case EVENT.TOOL_RESULT:     return { from: 'parietal', to: 'temporal', color: PALETTE.ret };
    case EVENT.SESSION_IDLE:    return { from: 'temporal', to: 'brainstem', color: PALETTE.afferent };
    case EVENT.SESSION_ERROR:   return { from: 'brainstem', to: 'brainstem', color: PALETTE.error };
    case EVENT.SESSION_START:   return { from: 'brainstem', to: 'frontal', color: PALETTE.internal };
    default:                    return { from: 'brainstem', to: 'frontal', color: PALETTE.internal };
  }
}

const VALID_STATUS = new Set(['live', 'idle', 'error', 'archived']);

/**
 * Defensively normalize an event received over the wire (from plugin POSTs,
 * the simulator, or older clients). Returns null when unusable.
 */
export function normalizeEvent(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const type = typeof raw.type === 'string' ? raw.type : '';
  if (!Object.values(EVENT).includes(type)) return null;
  const sessionId = typeof raw.sessionId === 'string' && raw.sessionId ? raw.sessionId : 'unknown';
  const event = {
    type,
    sessionId,
    at: Number.isFinite(raw.at) ? raw.at : Date.now(),
    simulated: raw.simulated === true,
  };
  if (typeof raw.title === 'string') event.title = raw.title.slice(0, 200);
  if (typeof raw.model === 'string') event.model = raw.model.slice(0, 120);
  if (typeof raw.tool === 'string') event.tool = raw.tool.slice(0, 80);
  if (typeof raw.argsSummary === 'string') event.argsSummary = raw.argsSummary.slice(0, 300);
  if (Number.isFinite(raw.durationMs)) event.durationMs = Math.max(0, raw.durationMs);
  if (typeof raw.ok === 'boolean') event.ok = raw.ok;
  if (typeof raw.text === 'string') event.text = raw.text.slice(0, 400);
  if (typeof raw.error === 'string') event.error = raw.error.slice(0, 400);
  if (Number.isFinite(raw.messageCount)) event.messageCount = Math.max(0, raw.messageCount);
  if (Array.isArray(raw.files)) event.files = raw.files.slice(0, 20).map(String);
  if (typeof raw.region === 'string') event.region = raw.region.slice(0, 40);
  if (Number.isFinite(raw.payloadBytes)) event.payloadBytes = Math.max(0, raw.payloadBytes);
  if (typeof raw.runId === 'string') event.runId = raw.runId.slice(0, 64);
  if (Number.isFinite(raw.cost)) event.cost = Math.max(0, raw.cost);
  if (raw.tokens && typeof raw.tokens === 'object') {
    const num = (v) => (Number.isFinite(v) ? Math.max(0, v) : 0);
    event.tokens = {
      input: num(raw.tokens.input),
      output: num(raw.tokens.output),
      reasoning: num(raw.tokens.reasoning),
      cacheRead: num(raw.tokens.cacheRead),
      cacheWrite: num(raw.tokens.cacheWrite),
    };
  }
  return event;
}

/** Normalize a session summary (used by REST /api/sessions and WS snapshots). */
export function normalizeSession(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = typeof raw.id === 'string' && raw.id ? raw.id : '';
  if (!id) return null;
  return {
    id,
    title: typeof raw.title === 'string' ? raw.title.slice(0, 200) : 'Untitled session',
    date: typeof raw.date === 'string' ? raw.date.slice(0, 40) : '',
    tag: typeof raw.tag === 'string' ? raw.tag.slice(0, 60) : '',
    messages: Number.isFinite(raw.messages) ? Math.max(0, raw.messages) : 0,
    tools: Number.isFinite(raw.tools) ? Math.max(0, raw.tools) : 0,
    files: Number.isFinite(raw.files) ? Math.max(0, raw.files) : 0,
    status: VALID_STATUS.has(raw.status) ? raw.status : 'idle',
    simulated: raw.simulated === true,
    model: typeof raw.model === 'string' ? raw.model.slice(0, 120) : '',
    startedAt: Number.isFinite(raw.startedAt) ? raw.startedAt : 0,
    lastEventAt: Number.isFinite(raw.lastEventAt) ? raw.lastEventAt : 0,
    payloadBytes: Number.isFinite(raw.payloadBytes) ? Math.max(0, raw.payloadBytes) : 0,
    tokens: raw.tokens && typeof raw.tokens === 'object'
      ? {
          in: Number.isFinite(raw.tokens.in) ? Math.max(0, raw.tokens.in) : 0,
          out: Number.isFinite(raw.tokens.out) ? Math.max(0, raw.tokens.out) : 0,
          cost: Number.isFinite(raw.tokens.cost) ? Math.max(0, raw.tokens.cost) : 0,
        }
      : undefined,
  };
}
