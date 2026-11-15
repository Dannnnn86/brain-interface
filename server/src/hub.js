/**
 * hub.js — WebSocket hub.
 *
 * Owns the /ws endpoint on the shared HTTP server: client registry,
 * broadcast (serialize once), heartbeat to reap dead sockets, and dispatch
 * of client → server request messages to a handler.
 */
import { WebSocketServer } from 'ws';

const HEARTBEAT_MS = 30_000;

export class Hub {
  /**
   * @param {{ onClientMessage?: (client: import('ws').WebSocket, msg: any) => void, log?: (msg: string) => void }} opts
   */
  constructor(opts = {}) {
    this.log = opts.log || (() => {});
    this.onClientMessage = opts.onClientMessage || null;
    this.wss = new WebSocketServer({ noServer: true });
    this.clients = new Set();

    this.wss.on('connection', (ws) => {
      ws.isAlive = true;
      this.clients.add(ws);
      ws.on('pong', () => {
        ws.isAlive = true;
      });
      ws.on('message', (data) => {
        let msg;
        try {
          msg = JSON.parse(String(data));
        } catch {
          return;
        }
        try {
          this.onClientMessage?.(ws, msg);
        } catch (err) {
          this.log(`client message error: ${err?.message || err}`);
        }
      });
      ws.on('close', () => this.clients.delete(ws));
      ws.on('error', () => this.clients.delete(ws));
    });

    this.timer = setInterval(() => {
      for (const ws of this.clients) {
        if (ws.isAlive === false) {
          ws.terminate();
          this.clients.delete(ws);
          continue;
        }
        ws.isAlive = false;
        try {
          ws.ping();
        } catch {
          /* socket already gone */
        }
      }
    }, HEARTBEAT_MS);
    this.timer.unref?.();
  }

  /** Handle the HTTP upgrade for path /ws; destroy other paths. */
  attach(httpServer) {
    httpServer.on('upgrade', (req, socket, head) => {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      if (url.pathname !== '/ws') {
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => {
        this.wss.emit('connection', ws, req);
      });
    });
  }

  get size() {
    return this.clients.size;
  }

  /** Send a message to every open client. Objects are serialized once. */
  broadcast(message) {
    const payload = typeof message === 'string' ? message : JSON.stringify(message);
    for (const ws of this.clients) {
      if (ws.readyState === ws.OPEN) {
        try {
          ws.send(payload);
        } catch {
          /* dropped client; heartbeat will clean up */
        }
      }
    }
  }

  /** Reply to a single client. */
  reply(ws, message) {
    if (ws.readyState === ws.OPEN) {
      try {
        ws.send(JSON.stringify(message));
      } catch {
        /* ignore */
      }
    }
  }

  close() {
    clearInterval(this.timer);
    for (const ws of this.clients) {
      try {
        ws.terminate();
      } catch {
        /* ignore */
      }
    }
    this.clients.clear();
    this.wss.close();
  }
}
