/**
 * ingest.js — the single entry point for live events (plugin POSTs, the
 * simulator route, or anything else that speaks the protocol).
 *
 * Maintains the live-session table, keeps a rolling event feed, broadcasts
 * each event and a debounced sessions snapshot to all WebSocket clients,
 * and auto-ages live sessions that went quiet.
 */
import { EVENT, normalizeEvent } from '../../shared/protocol.js';

const FEED_MAX = 200;
const SESSIONS_DEBOUNCE_MS = 300;
const AUTO_IDLE_MS = 10 * 60_000;
const SWEEP_MS = 60_000;

export class Ingest {
  /**
   * @param {{ hub: import('./hub.js').Hub, store: import('./sessions.js').SessionStore, recorder?: import('./recorder.js').Recorder, log?: (m: string) => void }} deps
   */
  constructor({ hub, store, recorder, log }) {
    this.hub = hub;
    this.store = store;
    this.recorder = recorder || null;
    this.log = log || (() => {});
    /** @type {import('../../shared/protocol.d.ts').SystemEvent[]} */
    this.feed = [];
    this.sessionsTimer = null;
    /** sessions already announced in the log (avoid per-event spam) */
    this.seenSessions = new Set();
    /** Current opencode run id (runtime.start handshake). */
    this.runId = null;

    this.sweepTimer = setInterval(() => this.sweepIdle(), SWEEP_MS);
    this.sweepTimer.unref?.();
  }

  /** Handle one raw event (already JSON-parsed). Returns the normalized event or null. */
  handle(raw) {
    const event = normalizeEvent(raw);
    if (!event) return null;

    // New opencode run → previous run's sessions leave the live deck (they
    // remain fully replayable via recordings/transcripts).
    if (event.type === EVENT.RUNTIME_START && event.runId) {
      if (event.runId !== this.runId) {
        const previousCount = this.store.listLive().length;
        this.store.clearLive();
        this.runId = event.runId;
        this.log(`opencode run ${event.runId.slice(0, 8)} started — live deck reset (${previousCount} carried over)`);
      }
      this.recorder?.append(event);
      this.broadcastSessions();
      return event;
    }

    this.feed.push(event);
    if (this.feed.length > FEED_MAX) this.feed.splice(0, this.feed.length - FEED_MAX);

    this.recorder?.append(event);

    // Log once per session (first event) plus each notable ending.
    if (!this.seenSessions.has(event.sessionId)) {
      if (this.seenSessions.size > 500) this.seenSessions.clear();
      this.seenSessions.add(event.sessionId);
      this.log(
        `session ${event.sessionId.slice(-8)} (${event.simulated ? 'sim' : 'live'}) started — ${event.title || 'untitled'}`,
      );
    } else if (event.type === 'session.idle' || event.type === 'session.error') {
      this.log(`session ${event.sessionId.slice(-8)} ${event.type === 'session.idle' ? 'went idle' : `error: ${event.error || ''}`}`);
    }

    this.updateLive(event);

    this.hub.broadcast({ kind: 'event', event });
    this.broadcastSessionsDebounced();
    return event;
  }

  updateLive(event) {
    const now = Number.isFinite(event.at) ? event.at : Date.now();
    const prev = this.store.getLive(event.sessionId) || {
      id: event.sessionId,
      title: event.title || 'Live session',
      date: '',
      tag: '',
      messages: 0,
      tools: 0,
      files: 0,
      status: 'live',
      simulated: false,
      model: '',
      startedAt: now,
      lastEventAt: now,
    };

    const next = { ...prev, lastEventAt: now };
    if (event.simulated) next.simulated = true;
    if (event.title) next.title = event.title;
    if (event.model) next.model = event.model;

    switch (event.type) {
      case EVENT.SESSION_START:
        next.status = 'live';
        next.startedAt = now;
        next.messages = event.messageCount ?? next.messages;
        break;
      case EVENT.SESSION_ACTIVITY:
        next.status = 'live';
        next.messages = event.messageCount ?? next.messages + 1;
        break;
      case EVENT.TOOL_CALL:
        next.status = 'live';
        next.tools += 1;
        if (Array.isArray(event.files)) next.files = Math.max(next.files, event.files.length);
        break;
      case EVENT.TOOL_RESULT:
        next.status = 'live';
        break;
      case EVENT.SESSION_IDLE:
        next.status = 'idle';
        next.messages = event.messageCount ?? next.messages;
        break;
      case EVENT.SESSION_ERROR:
        next.status = 'error';
        next.messages = event.messageCount ?? next.messages;
        break;
      case EVENT.SESSION_FILE:
        // Disk-side announcement — nothing to maintain live beyond presence.
        next.status = next.status === 'live' ? 'live' : 'idle';
        break;
      case EVENT.SESSION_PAYLOAD:
        next.payloadBytes = event.payloadBytes ?? next.payloadBytes ?? 0;
        break;
      case EVENT.SESSION_TOKENS:
        if (event.tokens) {
          // Plugin sends cumulative per-session totals — latest wins.
          next.tokens = {
            in: event.tokens.input + event.tokens.cacheRead,
            out: event.tokens.output + event.tokens.reasoning,
            cost: event.cost ?? next.tokens?.cost ?? 0,
          };
        }
        break;
      default:
        break;
    }

    this.store.upsertLive(next);
  }

  /** Age out sessions that stopped reporting. */
  sweepIdle() {
    const now = Date.now();
    let changed = false;
    for (const s of this.store.listLive()) {
      if (s.status === 'live' && s.lastEventAt && now - s.lastEventAt > AUTO_IDLE_MS) {
        const live = this.store.getLive(s.id);
        if (live) {
          live.status = 'idle';
          changed = true;
        }
      }
    }
    if (changed) this.broadcastSessions();
  }

  broadcastSessionsDebounced() {
    if (this.sessionsTimer) return;
    this.sessionsTimer = setTimeout(() => {
      this.sessionsTimer = null;
      this.broadcastSessions();
    }, SESSIONS_DEBOUNCE_MS);
    this.sessionsTimer.unref?.();
  }

  broadcastSessions() {
    // The live deck carries THIS opencode run's sessions only. The full
    // catalog stays available via /api/sessions + rpc getSessions (picker).
    this.hub.broadcast({ kind: 'sessions', sessions: this.store.listLive() });
  }

  close() {
    clearInterval(this.sweepTimer);
    clearTimeout(this.sessionsTimer);
  }
}
