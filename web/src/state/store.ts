/**
 * store.ts — tiny observable app store. No framework: a listener set plus
 * plain data. The HUD re-renders from this on every change; the impulse
 * system subscribes to the raw event stream (onFeedItem).
 */
import type { SessionSummary, SystemEvent, SystemState } from '@shared/protocol.js';

export type Connection = 'connecting' | 'live' | 'offline';

export interface ProviderStats {
  totals: Record<string, number>;
  eventsPerMin: number;
  totalEvents: number;
}

type Listener = () => void;

const FEED_MAX = 200;
const EVENTS_WINDOW_MS = 60_000;

export class Store {
  sessions: SessionSummary[] = [];
  feed: SystemEvent[] = [];
  systemState: SystemState | null = null;
  connection: Connection = 'connecting';
  simulate = false;
  totalEvents = 0;
  eventsPerMin = 0;
  perType: Record<string, number> = {};

  /** Raw event hooks (impulse system, future replay recorder). */
  readonly onFeedItem: Array<(event: SystemEvent) => void> = [];

  private listeners = new Set<Listener>();
  private eventTimes: number[] = [];

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) {
      try {
        fn();
      } catch (err) {
        console.error('[store] listener error:', err);
      }
    }
  }

  setConnection(connection: Connection): void {
    if (this.connection === connection) return;
    this.connection = connection;
    this.emit();
  }

  applyHello(payload: { state: SystemState; sessions: SessionSummary[]; simulate: boolean }): void {
    this.systemState = payload.state;
    this.simulate = payload.simulate;
    this.sessions = payload.sessions;
    this.emit();
  }

  applyState(state: SystemState): void {
    this.systemState = state;
    this.emit();
  }

  applySessions(sessions: SessionSummary[]): void {
    this.sessions = sessions;
    this.emit();
  }

  applyEvent(event: SystemEvent): void {
    this.feed.push(event);
    if (this.feed.length > FEED_MAX) this.feed.splice(0, this.feed.length - FEED_MAX);

    const now = Date.now();
    this.eventTimes.push(now);
    const cutoff = now - EVENTS_WINDOW_MS;
    while (this.eventTimes.length && this.eventTimes[0] < cutoff) this.eventTimes.shift();
    this.eventsPerMin = this.eventTimes.length;
    this.totalEvents += 1;
    this.perType[event.type] = (this.perType[event.type] || 0) + 1;

    for (const hook of this.onFeedItem) {
      try {
        hook(event);
      } catch (err) {
        console.error('[store] feed hook error:', err);
      }
    }
    this.emit();
  }
}

export const store = new Store();

/** Map a model id to its provider color (matches spec palette). */
export function modelColor(model: string | undefined): string {
  const m = (model || '').toLowerCase();
  if (m.includes('nvidia') || m.includes('nemotron') || m.includes('gpt-oss')) return '#76b900';
  if (m.includes('anthropic') || m.includes('claude')) return '#d4a5ff';
  if (m.includes('google') || m.includes('gemini')) return '#4285f4';
  if (m.includes('ollama') || m.includes('local')) return '#ff9500';
  if (m.includes('deepseek')) return '#4d6bfe';
  if (m.includes('glm') || m.includes('z-ai')) return '#00c896';
  return '#7ab8ff';
}
