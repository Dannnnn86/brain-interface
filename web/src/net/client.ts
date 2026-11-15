/**
 * client.ts — WebSocket client with auto-reconnect and id-keyed RPC.
 *
 * Connects to /ws (proxied by Vite in dev, served by the brain server in
 * production). Server messages are routed into the store; RPC requests are
 * awaited via a pending-promise map.
 */
import type { ClientRequestMessage, ServerMessage } from '@shared/protocol.js';
import { store } from '../state/store.js';

type Pending = { resolve: (value: unknown) => void; reject: (err: Error) => void; timer: number };

let socket: WebSocket | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();
let backoffMs = 500;
let reconnectTimer: number | null = null;

function wsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
}

function handleMessage(raw: string): void {
  let msg: ServerMessage;
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }
  switch (msg.kind) {
    case 'hello':
      store.applyHello(msg);
      break;
    case 'sessions':
      store.applySessions(msg.sessions);
      break;
    case 'event':
      store.applyEvent(msg.event);
      break;
    case 'pong': {
      const p = pending.get(msg.id);
      if (p) {
        pending.delete(msg.id);
        window.clearTimeout(p.timer);
        p.resolve(msg.result);
      }
      break;
    }
    case 'error': {
      if (typeof msg.id === 'number') {
        const p = pending.get(msg.id);
        if (p) {
          pending.delete(msg.id);
          window.clearTimeout(p.timer);
          p.reject(new Error(msg.message));
        }
      }
      break;
    }
    default:
      break;
  }
}

function scheduleReconnect(): void {
  if (reconnectTimer != null) return;
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, backoffMs);
  backoffMs = Math.min(backoffMs * 1.8, 8000);
}

export function connect(): void {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
  store.setConnection('connecting');

  try {
    socket = new WebSocket(wsUrl());
  } catch {
    store.setConnection('offline');
    scheduleReconnect();
    return;
  }

  socket.onopen = () => {
    backoffMs = 500;
    store.setConnection('live');
  };

  socket.onmessage = (ev) => handleMessage(String(ev.data));

  socket.onclose = () => {
    socket = null;
    store.setConnection('offline');
    // Fail all pending calls so callers don't hang forever.
    for (const [id, p] of pending) {
      window.clearTimeout(p.timer);
      p.reject(new Error('connection lost'));
      pending.delete(id);
    }
    scheduleReconnect();
  };

  socket.onerror = () => {
    try {
      socket?.close();
    } catch {
      /* ignore */
    }
  };
}

/** Send an RPC request; rejects on timeout or disconnect. */
export function rpc<T = unknown>(method: ClientRequestMessage['method'], params?: Record<string, unknown>, timeoutMs = 10_000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      reject(new Error('not connected'));
      return;
    }
    const id = nextId++;
    const timer = window.setTimeout(() => {
      pending.delete(id);
      reject(new Error(`rpc ${method} timed out`));
    }, timeoutMs);
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
    socket.send(JSON.stringify({ kind: 'req', id, method, params } satisfies ClientRequestMessage));
  });
}
