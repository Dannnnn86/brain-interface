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
   * @param {{ hub: import('./hub.js').Hub, store: import('./sessions.js').SessionStore, log?: (m: string) => void }} deps
   */
  constructor({ hub, store, log }) {
    this.hub = hub;
    this.store = store;
    this.log = log || (() => {});
    /** @type {import('../../shared/protocol.d.ts').SystemEvent[]} */
    this.feed = [];
    this.sessionsTimer = null;

    this.sweepTimer = setInterval(() => this.sweepIdle(), SWEEP_MS);
    this.sweepTimer.unref?.();
  }

  /** Handle one raw event (already JSON-parsed). Returns the normalized event or null. */
  handle(raw) {
    const event = normalizeEvent(raw);
    if (!event) return null;

    this.feed.push(event);
    if (this.feed.length > FEED_MAX) this.feed.splice(0, this.feed.length - FEED_MAX);

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
      default:
        break;
    }

    this.store.upsertLive(next);
  }

  /** Age out sessions that stopped reporting. */
  sweepIdle() {
    const now = Date.now();
    let changed = false;
    for (const s of this.store.list()) {
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
    // WS payloads are capped; the full list stays available via /api/sessions
    // for future analytics/replay modules. Live sessions sort first.
    this.hub.broadcast({ kind: 'sessions', sessions: this.store.list().slice(0, 120) });
  }

  close() {
    clearInterval(this.sweepTimer);
    clearTimeout(this.sessionsTimer);
  }
}
