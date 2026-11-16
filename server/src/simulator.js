/**
 * simulator.js — synthetic session generator for development and demos.
 *
 * Runs when the server starts with --simulate. Produces a realistic event
 * stream through the exact same ingest pipeline as the real plugin, so the
 * end-to-end path (ingest → store → broadcast → visuals) is always exercised.
 */
import { EVENT, PAYLOAD_TRIM_BYTES } from '../../shared/protocol.js';

const TITLES = [
  'fix trim-session payload bug',
  'render sermon short #3',
  'kicad schematic review',
  'refactor mcp-bridge timeout handling',
  'write comms2 lab report',
  'build pico oscilloscope firmware',
  'organize vault notes',
  'debug nvidia 25MiB cap',
  'make reels from church service',
  'shorten build times',
];

const MODELS = [
  'deepseek-ai/deepseek-v4.1-flash',
  'z-ai/glm-5.3-flash',
  'nvidia/nemotron-3-ultra-550b-a55b',
];

const TOOLS = [
  ['bash', 'npm test -- --watch=false'],
  ['read', 'server/src/index.js'],
  ['edit', 'web/src/engine/brain.ts'],
  ['write', 'docs/architecture.md'],
  ['grep', 'pattern: TODO, include: *.ts'],
  ['glob', '**/*.wgsl'],
  ['mcp_call', 'datasheets.search_component'],
  ['mcp_call', 'matlab.evaluate'],
  ['skill', 'brainstorming'],
  ['task', 'explore: find auth flow'],
];

const SNIPPETS = [
  'Alright — reading the file and tracing the call path now.',
  'Found it: the payload counter goes stale after a trim.',
  'Rendering frame 15 for a quick visual check.',
  'Tests pass locally; committing the fix.',
  'The datasheet confirms 2.2V forward drop at 20mA.',
  'I need to check the schema before editing.',
  'Compiling the shader module first to catch type errors.',
];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const rint = (min, max) => min + Math.floor(Math.random() * (max - min + 1));

export class Simulator {
  /** @param {{ onEvent: (event: object) => void, log?: (m: string) => void }} deps */
  constructor({ onEvent, log }) {
    this.onEvent = onEvent;
    this.log = log || (() => {});
    this.sessions = [];
    this.counter = 0;
    this.timer = null;
  }

  start() {
    this.spawnSession();
    this.spawnSession();
    this.timer = setInterval(() => this.tick(), 1100);
    this.timer.unref?.();
    this.log('simulator started (2 sessions seeded)');
  }

  stop() {
    clearInterval(this.timer);
  }

  spawnSession() {
    // Keep the array bounded: finished sessions are history, not participants.
    this.sessions = this.sessions.filter((s) => !s.done);
    const id = `sim-${String(++this.counter).padStart(3, '0')}-${Math.random().toString(36).slice(2, 6)}`;
    // ~1 in 6 sessions is a "heavy" one that races toward the trim threshold —
    // exercises the pressure ring + gauges end-to-end.
    const heavy = Math.random() < 0.17;
    const session = {
      id,
      title: pick(TITLES),
      model: pick(MODELS),
      messages: 0,
      pendingTools: 0,
      lifetime: rint(25, 70),
      born: Date.now(),
      payloadBytes: heavy ? rint(9_000_000, 13_000_000) : rint(200_000, 900_000),
      payloadRate: heavy ? rint(400_000, 700_000) : rint(15_000, 90_000),
      tokens: { input: rint(20_000, 60_000), output: rint(2_000, 8_000), cacheRead: rint(5_000, 40_000), cacheWrite: 0 },
      cost: 0,
    };
    this.sessions.push(session);
    this.emit(session, EVENT.SESSION_START, { title: session.title, model: session.model });
    this.emitPayload(session);
    return session;
  }

  /** Cumulative token totals + cost (shapes mirror the live plugin capture). */
  growTokens(session) {
    session.tokens.input += rint(1_500, 9_000);
    session.tokens.output += rint(150, 1_400);
    session.tokens.cacheRead += rint(1_000, 6_000);
    session.cost += Math.random() * 0.002;
    this.onEvent({
      type: EVENT.SESSION_TOKENS,
      sessionId: session.id,
      at: Date.now(),
      simulated: true,
      model: session.model,
      tokens: { ...session.tokens, reasoning: 0 },
      cost: Math.round(session.cost * 10000) / 10000,
    });
  }

  /** Estimated payload size event. */
  emitPayload(session) {
    this.onEvent({
      type: EVENT.SESSION_PAYLOAD,
      sessionId: session.id,
      at: Date.now(),
      simulated: true,
      payloadBytes: Math.round(session.payloadBytes),
    });
  }

  emit(session, type, extra = {}) {
    this.onEvent({
      type,
      sessionId: session.id,
      at: Date.now(),
      simulated: true,
      title: session.title,
      model: session.model,
      messageCount: session.messages,
      ...extra,
    });
  }

  tick() {
    const live = this.sessions.filter((s) => !s.done);
    if (!live.length) {
      // Never let the stream go silent — always have someone working.
      this.spawnSession();
      return;
    }
    // Occasionally spawn a fresh session while others still run.
    if (live.length < 3 && Math.random() < 0.06) this.spawnSession();

    const session = pick(live);
    session.messages += 1;

    // Payload growth + periodic payload events.
    session.payloadBytes = Math.min(
      PAYLOAD_TRIM_BYTES * 1.06,
      session.payloadBytes + session.payloadRate * (0.6 + Math.random() * 0.8),
    );
    if (Math.random() < 0.22) this.emitPayload(session);
    if (Math.random() < 0.3) this.growTokens(session);

    if (session.messages >= session.lifetime) {
      session.done = true;
      this.emit(session, EVENT.SESSION_IDLE, { messageCount: session.messages });
      this.growTokens(session);
      this.emitPayload(session);
      this.log(`sim session ${session.id} finished (${session.messages} messages)`);
      return;
    }

    const roll = Math.random();
    if (session.pendingTools > 0 && roll < 0.5) {
      session.pendingTools -= 1;
      this.emit(session, EVENT.TOOL_RESULT, {
        tool: 'tool',
        durationMs: rint(30, 9000),
        ok: Math.random() > 0.06,
      });
      return;
    }
    if (roll < 0.42) {
      const [name, summary] = pick(TOOLS);
      session.pendingTools += 1;
      this.emit(session, EVENT.TOOL_CALL, { tool: name, argsSummary: summary });
      return;
    }
    if (roll < 0.47) {
      this.emit(session, EVENT.SESSION_ERROR, { error: 'payload cap reached — trim required' });
      return;
    }
    if (roll < 0.62) {
      this.emit(session, EVENT.SESSION_ACTIVITY, { text: pick(SNIPPETS).slice(0, 120) });
      return;
    }
    this.emit(session, EVENT.SESSION_ACTIVITY);
  }
}
