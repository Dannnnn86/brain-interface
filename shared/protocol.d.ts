/**
 * protocol.d.ts — TypeScript surface for protocol.js (shared wire protocol).
 * TypeScript resolves these types automatically for `import ... from '.../protocol.js'`.
 */

export declare const PROTOCOL_VERSION: number;

export declare const EVENT: {
  readonly SESSION_START: 'session.start';
  readonly SESSION_ACTIVITY: 'session.activity';
  readonly TOOL_CALL: 'tool.call';
  readonly TOOL_RESULT: 'tool.result';
  readonly SESSION_IDLE: 'session.idle';
  readonly SESSION_ERROR: 'session.error';
  readonly SESSION_FILE: 'session.file';
};
export type EventType = (typeof EVENT)[keyof typeof EVENT];

export declare const REGIONS: readonly [
  'frontal', 'temporal', 'parietal', 'occipital', 'cerebellum', 'brainstem',
];
export type RegionName = (typeof REGIONS)[number];

export declare const PALETTE: {
  readonly afferent: number;
  readonly efferent: number;
  readonly internal: number;
  readonly ret: number;
  readonly error: number;
  readonly background: number;
};

export interface ImpulsePath {
  from: RegionName;
  to: RegionName;
  color: number;
}
export declare function impulsePathFor(type: string): ImpulsePath;

export type SessionStatus = 'live' | 'idle' | 'error' | 'archived';

export interface SystemEvent {
  type: EventType | string;
  sessionId: string;
  at: number;
  simulated?: boolean;
  title?: string;
  model?: string;
  tool?: string;
  argsSummary?: string;
  durationMs?: number;
  ok?: boolean;
  text?: string;
  error?: string;
  messageCount?: number;
  files?: string[];
  region?: string;
}

export interface SessionSummary {
  id: string;
  title: string;
  date: string;
  tag: string;
  messages: number;
  tools: number;
  files: number;
  status: SessionStatus;
  simulated?: boolean;
  model?: string;
  startedAt?: number;
  lastEventAt?: number;
}

export interface ProviderInfo {
  id: string;
  name: string;
  models: string[];
  disabled?: boolean;
}

export interface McpServerInfo {
  name: string;
  type: string;
  enabled: boolean;
}

export interface SystemState {
  vault: string;
  configDir: string;
  providers: ProviderInfo[];
  mcpServers: McpServerInfo[];
  plugins: string[];
  skills: { count: number; names: string[]; sample?: string[] };
  agents: string[];
  generatedAt: number;
}

/* ------------------------- WebSocket messages ------------------------- */

export interface HelloMessage {
  kind: 'hello';
  protocolVersion: number;
  state: SystemState;
  sessions: SessionSummary[];
  simulate: boolean;
}

export interface EventMessage {
  kind: 'event';
  event: SystemEvent;
}

export interface SessionsMessage {
  kind: 'sessions';
  sessions: SessionSummary[];
}

export interface PongMessage {
  kind: 'pong';
  id: number;
  result: unknown;
}

export interface ErrorMessage {
  kind: 'error';
  id?: number;
  message: string;
}

export type ServerMessage = HelloMessage | EventMessage | SessionsMessage | PongMessage | ErrorMessage;

export interface ClientRequestMessage {
  kind: 'req';
  id: number;
  method:
    | 'getState'
    | 'getSessions'
    | 'getSession'
    | 'getTimeline'
    | 'getAnalytics'
    | 'getFeed'
    | 'simulate';
  params?: Record<string, unknown>;
}

export interface ToolHealthEntry {
  tool: string;
  calls: number;
  results: number;
  ok: number;
  failed: number;
  okRate: number | null;
  avgMs: number | null;
}

export interface AnalyticsResponse {
  generatedAt: number;
  scope: 'all' | 'real';
  windowDays: number;
  counts: {
    total: number;
    simulated: number;
    real: number;
    scoped: number;
    toolCalls: number;
    errors: number;
    sessions: number;
  };
  byType: Record<string, number>;
  toolHealth: ToolHealthEntry[];
  activity: { days: Array<{ day: string; events: number; sessions: number }> };
  models: Array<{ model: string; events: number; sessions: number }>;
  heatmap: { rows: number[][] }; // 7 rows (Mon=0) × 24 cols
  errors: {
    total: number;
    recent: Array<{ at: number; sessionId: string; simulated: boolean; error: string }>;
  };
  skillUsage: Array<{ skill: string; calls: number }>;
  tokens: null | { input: number; output: number };
}

export interface TimelineFrame {
  t: number;
  type: string;
  tool?: string;
  argsSummary?: string;
  ok?: boolean;
  durationMs?: number;
  text?: string;
  error?: string;
}

export interface ReplayTimeline {
  id: string;
  title: string;
  source: 'recorded' | 'transcript';
  duration: number;
  frames: TimelineFrame[];
  bookmarks: Array<{ t: number; kind: 'error' | 'tool' | 'file' }>;
  totals: { messages: number; tools: number } | null;
  generatedAt: number;
}

export interface ClientPingMessage {
  kind: 'ping';
  at: number;
}

export type ClientMessage = ClientRequestMessage | ClientPingMessage;

/* ------------------------------ Helpers ------------------------------ */

export declare function normalizeEvent(raw: unknown): SystemEvent | null;
export declare function normalizeSession(raw: unknown): SessionSummary | null;
