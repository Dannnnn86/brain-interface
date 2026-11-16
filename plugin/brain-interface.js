/**
 * brain-interface — fail-silent reporter plugin for the Brain Interface.
 *
 * Forwards *interesting* opencode session events (session start/idle/error,
 * completed tool calls, completed text parts) to the Brain Interface server
 * over HTTP so the 3D visualization can render live activity.
 *
 * Design rules (mirrors session-logger):
 *   - ZERO npm dependencies (node builtins only; fetch is global).
 *   - Fire-and-forget POSTs with a 2s abort timeout — never awaited, so the
 *     opencode event loop is never stalled.
 *   - Backoff after failures: when the server is down, posts are skipped for
 *     30s at a time instead of hammering.
 *   - Fails safe: any error here is swallowed and logged to the app log.
 *
 * Install: this file lives at ~/.config/opencode/plugins/brain-interface/
 * and must be registered explicitly in opencode.jsonc's "plugin" array
 * (same gotcha as session-logger: subfolder plugins don't auto-discover).
 *
 * Config via env:
 *   BRAIN_SERVER   server base URL   (default http://127.0.0.1:3030)
 */

import path from 'path';
import fs from 'fs';

const SERVER = (process.env.BRAIN_SERVER || 'http://127.0.0.1:3030').replace(/\/+$/, '');
const POST_TIMEOUT_MS = 2000;
const FAILURE_BACKOFF_MS = 30_000;
const ACTIVITY_MIN_GAP_MS = 1500;
const PAYLOAD_MIN_GAP_MS = 5000;
// Payload estimate calibration: raw text/output lengths * JSON overhead.
const PAYLOAD_OVERHEAD = 1.25;
const PAYLOAD_PART_FIXED = 600;
const MAX_TRACKED = 500;

const CONFIG_DIR =
  process.env.OPENCODE_CONFIG_DIR ||
  (process.platform === 'win32'
    ? path.join(process.env.USERPROFILE || 'C:\\Users\\danhe', '.config', 'opencode')
    : path.join(process.env.HOME || '', '.config', 'opencode'));
const DEFAULT_VAULT = 'D:/documents/personal/main_vault';

/* ------------------------------------------------------------------ */
/* Vault discovery (same signature walk as session-logger)             */
/* ------------------------------------------------------------------ */

function looksLikeVault(dir) {
  try {
    return fs.existsSync(path.join(dir, 'Home.md')) && fs.existsSync(path.join(dir, 'log.md'));
  } catch {
    return false;
  }
}

function findVault(directory) {
  let dir = directory;
  if (!dir) return DEFAULT_VAULT;
  while (true) {
    if (looksLikeVault(dir)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return DEFAULT_VAULT;
}

/* ------------------------------------------------------------------ */
/* Reporter state                                                      */
/* ------------------------------------------------------------------ */

const state = {
  runId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  lastFailureAt: 0,
  lastActivityAt: new Map(),   // sessionId -> ms (throttle activity posts)
  seenParts: new Map(),        // partId -> ms (dedupe part completions)
  callStartedAt: new Map(),    // callId -> ms (tool duration)
  titles: new Map(),           // sessionId -> title
  models: new Map(),           // sessionId -> model id
  payloadBySession: new Map(), // sessionId -> estimated bytes
  partSizes: new Map(),        // sessionId -> Map(partId -> {text,out})
  lastPayloadAt: new Map(),    // sessionId -> ms (throttle payload posts)
  tokensBySession: new Map(),  // sessionId -> cumulative token counters
  tokenSent: new Set(),        // messageIds already captured
  sent: 0,
};

function prune(map, max = MAX_TRACKED) {
  if (map.size <= max) return;
  const excess = map.size - max;
  let i = 0;
  for (const key of map.keys()) {
    map.delete(key);
    if (++i >= excess) break;
  }
}

function serverReachable() {
  return Date.now() - state.lastFailureAt > FAILURE_BACKOFF_MS;
}

/** Fire-and-forget POST (never awaited by callers). */
function post(event) {
  if (!serverReachable()) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), POST_TIMEOUT_MS);
  if (typeof timer.unref === 'function') timer.unref();
  fetch(`${SERVER}/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
    signal: controller.signal,
  })
    .then((res) => {
      clearTimeout(timer);
      if (res.ok) {
        state.sent += 1;
        state.lastFailureAt = 0;
      } else {
        state.lastFailureAt = Date.now();
      }
    })
    .catch(() => {
      clearTimeout(timer);
      state.lastFailureAt = Date.now();
    });
}

function extractSessionId(props) {
  if (!props || typeof props !== 'object') return undefined;
  for (const key of ['sessionID', 'sessionId', 'session_id', 'id']) {
    if (typeof props[key] === 'string' && props[key]) return props[key];
  }
  for (const key of ['info', 'session', 'status', 'part', 'message']) {
    const nested = props[key];
    if (!nested || typeof nested !== 'object') continue;
    for (const sub of ['sessionID', 'sessionId', 'session_id']) {
      if (typeof nested[sub] === 'string' && nested[sub]) return nested[sub];
    }
  }
  return undefined;
}

function titleFor(sessionId) {
  return state.titles.get(sessionId) || undefined;
}

function modelFor(sessionId) {
  return state.models.get(sessionId) || undefined;
}

function baseEvent(sessionId, type, extra = {}) {
  return {
    type,
    sessionId,
    at: Date.now(),
    title: titleFor(sessionId),
    model: modelFor(sessionId),
    ...extra,
  };
}

/* ------------------------------------------------------------------ */
/* Part summarization                                                  */
/* ------------------------------------------------------------------ */

function textSnippet(text) {
  if (typeof text !== 'string') return '';
  return text.replace(/\s+/g, ' ').trim().slice(0, 120);
}

// opencode message parts come in a couple of historical shapes:
//   { type: 'tool', tool, callID, state: { status, input, time, error } }
//   { type: 'tool-invocation', toolInvocation: { state, toolName, input, result } }
function handlePart(part) {
  if (!part || typeof part !== 'object') return;
  const sessionId = extractSessionId({ part });
  if (!sessionId) return;
  const partId = part.id || `${sessionId}:${part.type}:${part.callID || ''}`;

  // Payload pressure estimate: incremental text/output growth per part.
  trackPayload(sessionId, part);

  if (part.type === 'tool') {
    const callId = part.callID || partId;
    const status = part.state?.status;
    if (status === 'pending' || status === 'running') {
      if (!state.callStartedAt.has(callId)) {
        state.callStartedAt.set(callId, part.state?.time?.start || Date.now());
        prune(state.callStartedAt);
        post(baseEvent(sessionId, 'tool.call', {
          tool: String(part.tool || 'tool').slice(0, 60),
          argsSummary: textSnippet(part.state?.title || part.state?.input?.command || ''),
        }));
      }
      return;
    }
    if (status === 'completed' || status === 'error') {
      if (state.seenParts.has(partId)) return;
      state.seenParts.set(partId, Date.now());
      prune(state.seenParts);
      const started = state.callStartedAt.get(callId);
      const ended = part.state?.time?.end;
      post(baseEvent(sessionId, 'tool.result', {
        tool: String(part.tool || 'tool').slice(0, 60),
        ok: status === 'completed',
        durationMs: started && ended ? Math.max(0, ended - started) : undefined,
        error: status === 'error' ? textSnippet(part.state?.error || 'tool error') : undefined,
      }));
    }
    return;
  }

  if (part.type === 'tool-invocation' && part.toolInvocation?.state === 'result') {
    if (state.seenParts.has(partId)) return;
    state.seenParts.set(partId, Date.now());
    prune(state.seenParts);
    post(baseEvent(sessionId, 'tool.result', {
      tool: String(part.toolInvocation.toolName || 'tool').slice(0, 60),
      ok: !part.toolInvocation.error,
    }));
    return;
  }

  if (part.type === 'text') {
    // Only completed text parts (time.end set) — deltas would flood.
    const done = part.time?.end != null;
    if (!done) return;
    if (state.seenParts.has(partId)) return;
    state.seenParts.set(partId, Date.now());
    prune(state.seenParts);
    const last = state.lastActivityAt.get(sessionId) || 0;
    if (Date.now() - last < ACTIVITY_MIN_GAP_MS) return;
    state.lastActivityAt.set(sessionId, Date.now());
    prune(state.lastActivityAt);
    post(baseEvent(sessionId, 'session.activity', { text: textSnippet(part.text) }));
  }
}

/* ------------------------------------------------------------------ */
/* Payload estimation (NVIDIA-cap guard)                               */
/* ------------------------------------------------------------------ */

/**
 * Track incremental size growth per part (text + tool output lengths) and
 * emit a `session.payload` estimate (throttled). Cheap: never serializes
 * whole parts, only diffs string lengths.
 */
function trackPayload(sessionId, part) {
  if (!part.id) return;
  let parts = state.partSizes.get(sessionId);
  if (!parts) {
    parts = new Map();
    state.partSizes.set(sessionId, parts);
  }
  const prev = parts.get(part.id) || { text: 0, out: 0 };
  const textLen = typeof part.text === 'string' ? part.text.length : 0;
  const outLen = typeof part.state?.output === 'string' ? part.state.output.length : 0;
  const delta = Math.max(0, textLen - prev.text) + Math.max(0, outLen - prev.out);
  if (delta <= 0) return;
  parts.set(part.id, { text: textLen, out: outLen });

  const est = (state.payloadBySession.get(sessionId) || 0) + delta;
  state.payloadBySession.set(sessionId, est);

  const now = Date.now();
  if (now - (state.lastPayloadAt.get(sessionId) || 0) < PAYLOAD_MIN_GAP_MS) return;
  state.lastPayloadAt.set(sessionId, now);
  prune(state.lastPayloadAt);
  post(
    baseEvent(sessionId, 'session.payload', {
      payloadBytes: Math.round(est * PAYLOAD_OVERHEAD + parts.size * PAYLOAD_PART_FIXED),
    }),
  );
}

/* ------------------------------------------------------------------ */
/* Token capture (opencode reports tokens + cost per assistant message) */
/* ------------------------------------------------------------------ */

function captureTokens(sessionId, info) {
  if (!info || info.role !== 'assistant') return;
  const messageId = info.id;
  const t = info.tokens;
  if (!messageId || !t || state.tokenSent.has(messageId)) return;
  // Prefer final counts; early updates may carry partial/zero values.
  const ready = info.time?.completed != null || (t.output || 0) > 0 || (t.input || 0) > 0;
  if (!ready) return;
  state.tokenSent.add(messageId);
  prune(state.tokenSent);

  const acc = state.tokensBySession.get(sessionId) || {
    input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0,
  };
  acc.input += t.input || 0;
  acc.output += t.output || 0;
  acc.reasoning += t.reasoning || 0;
  acc.cacheRead += t.cache?.read || 0;
  acc.cacheWrite += t.cache?.write || 0;
  acc.cost += typeof info.cost === 'number' ? info.cost : 0;
  state.tokensBySession.set(sessionId, acc);
  prune(state.tokensBySession);

  post(
    baseEvent(sessionId, 'session.tokens', {
      tokens: {
        input: acc.input,
        output: acc.output,
        reasoning: acc.reasoning,
        cacheRead: acc.cacheRead,
        cacheWrite: acc.cacheWrite,
      },
      cost: Math.round(acc.cost * 100000) / 100000,
      model: info.modelID || modelFor(sessionId),
    }),
  );
}

/* ------------------------------------------------------------------ */
/* Plugin                                                              */
/* ------------------------------------------------------------------ */

export const BrainInterface = async ({ directory }) => {
  const vault = findVault(directory);
  void vault; // server keeps its own vault; discovery here is a sanity check

  // Handshake: tells the server a fresh opencode run began, so the live deck
  // shows only this run's sessions (previous ones stay replayable).
  post({ type: 'runtime.start', sessionId: 'runtime', runId: state.runId, at: Date.now() });

  return {
    event: async ({ event }) => {
      if (!event || typeof event !== 'object') return;
      const props = event.properties || {};
      try {
        switch (event.type) {
          case 'session.created':
          case 'session.updated': {
            const id = extractSessionId(props);
            const info = props.info || props.session || {};
            if (id) {
              if (typeof info.title === 'string' && info.title) state.titles.set(id, info.title.slice(0, 200));
              const modelId =
                (info.model && (info.model.id || info.model.modelID)) ||
                (info.version && info.version.model) ||
                undefined;
              if (typeof modelId === 'string' && modelId) state.models.set(id, modelId);
              prune(state.titles);
              prune(state.models);
            }
            if (event.type === 'session.created' && id) {
              post(baseEvent(id, 'session.start'));
            }
            break;
          }
          case 'session.status': {
            if (props.status && props.status.type === 'idle') {
              const id = extractSessionId(props);
              if (id) post(baseEvent(id, 'session.idle'));
            }
            break;
          }
          case 'session.idle': {
            const id = extractSessionId(props);
            if (id) post(baseEvent(id, 'session.idle'));
            break;
          }
          case 'session.error': {
            const id = extractSessionId(props);
            if (id) {
              const err = props.error;
              post(baseEvent(id, 'session.error', {
                error: textSnippet(typeof err === 'string' ? err : err?.message || 'session error'),
              }));
            }
            break;
          }
          case 'message.part.updated': {
            handlePart(props.part);
            break;
          }
          case 'message.updated': {
            const sessionId = extractSessionId(props) || props.info?.sessionID;
            if (sessionId) captureTokens(sessionId, props.info);
            break;
          }
          default:
            break;
        }
      } catch {
        // Fail silent — the reporter must never break the session.
      }
    },
  };
};
