---
title: "opencode Brain Interface — 3D System Visualization"
status: draft
created: 2026-11-14
last_reviewed: 2026-11-14
tags: [opencode, visualization, webgpu, threejs, architecture, brain-interface]
---

# opencode Brain Interface — 3D System Visualization

**A single-page WebGPU application that visualizes the entire opencode system as an interactive 3D brain — live sessions, system architecture, historical replay, and analytics in one immersive neural interface.**

---

## 1. Vision & Scope

### 1.1 Purpose
Create a **comprehensive brain interface** for opencode that unifies:
- **Real-time session monitoring** — watch active sessions as neural firing patterns
- **Time-travel session replay** — scrub through completed sessions frame-by-frame
- **System architecture exploration** — navigate skills, MCP servers, agents, providers as brain regions
- **Development analytics** — token costs, skill usage patterns, bottleneck detection

### 1.2 Core Metaphor: The Neural Brain
```
┌─────────────────────────────────────────────────────────────┐
│                    OPENDCODE BRAIN                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │  FRONTAL    │  │  TEMPORAL   │  │  PARIETAL           │  │
│  │  LOBE       │  │  LOBE       │  │  LOBE               │  │
│  │  Planning   │  │  Memory     │  │  Integration        │  │
│  │  (Agents)   │  │  (Sessions) │  │  (MCP Bridge)       │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │  OCCIPITAL  │  │  CEREBELLUM │  │  BRAINSTEM          │  │
│  │  LOBE       │  │  (Skills)   │  │  (Core Runtime)     │  │
│  │  (Visual    │  │  Procedural │  │  Providers, Config  │  │
│  │   Output)   │  │  Memory)    │  │                     │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 1.3 Success Criteria
- **60 FPS** on modern GPUs (RTX 3060+ / M1+), graceful fallback to Three.js WebGL
- **< 100ms latency** from opencode event → visual update (WebSocket path)
- **Sub-second load** for 1000+ session replay
- **Zero config** — auto-discovers vault, sessions, opencode config
- **Extensible** — new visualization modules plug into core engine

---

## 2. System Architecture

### 2.1 High-Level Data Flow

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│   opencode       │     │   Brain Interface │     │   Browser        │
│   (Desktop/CLI)  │     │   (Standalone)    │     │   (Client)       │
└────────┬─────────┘     └────────┬─────────┘     └────────┬─────────┘
         │                        │                        │
         │ 1. Plugin: WS Server   │                        │
         │◄───────────────────────│                        │
         │                        │                        │
         │ 2. Session Events      │                        │
         │───────────────────────►│                        │
         │                        │                        │
         │ 3. File Watcher        │                        │
         │ (sessions/ vault)      │                        │
         │◄───────────────────────│                        │
         │                        │                        │
         │ 4. MCP Bridge Query    │                        │
         │◄───────────────────────│                        │
         │                        │                        │
         │                    5. Render Loop (WebGPU)     │
         │                    ◄───────────────────────────│
         │                    6. User Interaction         │
         │                    ───────────────────────────►│
```

### 2.2 Components

| Component | Technology | Responsibility |
|-----------|------------|----------------|
| **opencode Plugin** | TypeScript (Node.js) | WebSocket server, session event emission, file watcher, MCP bridge proxy |
| **WebGPU Engine** | Three.js r160+ + WebGPURenderer | Scene graph, compute shaders, render loop, post-processing |
| **Data Layer** | IndexedDB + Web Workers | Session caching, incremental parsing, query engine |
| **Visualization Modules** | TypeScript + Three.js | Session Monitor, Replay, Architecture Map, Analytics |
| **UI Layer** | Vanilla TS + CSS Custom Properties | HUD, controls, panels, settings (no React — performance) |

### 2.3 opencode Plugin (`brain-interface-plugin`)

**Location:** `~/.config/opencode/plugins/brain-interface/`

```typescript
// plugin.ts — Main entry
export const BrainInterfacePlugin = async ({ client, directory }) => {
  // 1. Start WebSocket server on localhost:3030
  // 2. Subscribe to session events (status, message, tool calls)
  // 3. Watch vault/sessions/ for new transcripts
  // 4. Expose MCP bridge via WebSocket (proxy mcp_search, mcp_call)
  // 5. Serve static assets in dev mode
  
  return {
    event: async ({ event }) => { /* forward to WS clients */ },
    // Custom RPC methods for the UI
    rpc: {
      getSystemState: () => { /* providers, agents, skills, MCPs */ },
      getActiveSessions: () => { /* live sessions with message streams */ },
      getSessionTranscript: (id) => { /* full transcript from SDK */ },
      queryMCP: (server, tool, args) => { /* proxy to mcp-bridge */ },
    }
  };
};
```

**WebSocket Protocol:**
```json
// Server → Client (event stream)
{ "type": "session.start", "sessionId": "ses_...", "title": "...", "model": "..." }
{ "type": "message.delta", "sessionId": "ses_...", "messageIndex": 5, "part": {...} }
{ "type": "tool.call", "sessionId": "ses_...", "tool": "bash", "args": {...}, "startTime": 123 }
{ "type": "tool.result", "sessionId": "ses_...", "tool": "bash", "result": {...}, "duration": 45 }
{ "type": "session.idle", "sessionId": "ses_...", "messageCount": 47 }
{ "type": "session.error", "sessionId": "ses_...", "error": "..." }

// Client → Server (RPC)
{ "id": 1, "method": "getSystemState", "params": {} }
{ "id": 2, "method": "replaySession", "params": { "sessionId": "ses_...", "speed": 2.0 } }
```

### 2.4 Data Layer (Browser)

```
┌────────────────────────────────────────────────────────────┐
│                    DATA LAYER (IndexedDB)                  │
├────────────────────────────────────────────────────────────┤
│  sessions/       │  Transcripts, parsed messages, metadata │
│  system/         │  Providers, agents, skills, MCPs, config│
│  replay/         │  Pre-computed frame data for scrubbing  │
│  analytics/      │  Aggregated metrics, token costs, usage │
└────────────────────────────────────────────────────────────┘
         │
         ▼
┌────────────────────────────────────────────────────────────┐
│                    QUERY ENGINE (Web Worker)               │
├────────────────────────────────────────────────────────────┤
│  • Incremental transcript parsing (streaming JSON)         │
│  • Session search/filter (tags, dates, files, tools)       │
│  • Analytics aggregations (token trends, skill frequency)  │
│  • Replay frame generation (time → visual state)           │
└────────────────────────────────────────────────────────────┘
```

---

## 3. 3D Visualization Design

### 3.1 Scene Architecture (Three.js + WebGPU)

```typescript
// Core scene setup
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 10000);
const renderer = new THREE.WebGPURenderer({ 
  antialias: true, 
  powerPreference: 'high-performance',
  stencil: false,
  depth: true
});

// Compute shader pipeline for layouts
const layoutPipeline = {
  forceDirected: new ComputeShader('force-directed.wgsl'),
  hierarchical: new ComputeShader('hierarchical.wgsl'),
  radial: new ComputeShader('radial.wgsl'),
  timeline: new ComputeShader('timeline.wgsl'),
};

// Post-processing
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new BloomPass({ strength: 0.3, radius: 0.5 }));
composer.addPass(new ChromaticAberrationPass({ offset: 0.002 }));
composer.addPass(new FilmPass({ noiseIntensity: 0.02, scanlinesIntensity: 0.05 }));
```

### 3.2 Brain Regions (Visual Mapping)

| Brain Region | opencode Concept | Visual Representation |
|--------------|------------------|----------------------|
| **Frontal Lobe** | Agents (coder, planner, researcher) | 3 neural clusters, pulsing with active agent |
| **Temporal Lobe** | Sessions (live + history) | Flowing particle streams, color = model/provider |
| **Parietal Lobe** | MCP Bridge & Servers | Geometric lattice, connections = active tool calls |
| **Occipital Lobe** | Visual Output (renders, images) | Holographic preview panels, floating in space |
| **Cerebellum** | Skills (procedural memory) | Hexagonal grid, lighting up on skill invocation |
| **Brainstem** | Core Runtime (providers, config, plugins) | Central column, vital signs (heartbeat = event loop) |

### 3.3 Session Visualization (Live Monitor)

```
Active Session → Neural Pathway
├── User Message          → Bright blue impulse (afferent)
├── Model Reasoning       → Purple slow wave (internal)
├── Tool Call             → Gold spike (efferent)
│   ├── bash              → Terminal icon particle
│   ├── edit/read/write   → File icon particle  
│   ├── mcp_call          → MCP server node highlight
│   └── skill             → Cerebellum region pulse
├── Tool Result           → Green return wave
└── Assistant Response    → Blue impulse train (efferent)

Visual Encoding:
- Amplitude = token count / complexity
- Frequency = message rate
- Color hue = model/provider (NVIDIA=green, Anthropic=purple, Google=blue, Local=orange)
- Particle trail = file paths touched
```

### 3.4 Session Replay (Time-Travel)

```
Timeline Scrubber (bottom) → Controls replay speed/direction
├── 0.1x  ── 0.5x ── 1x ── 2x ── 10x ── 100x
├── Frame-by-frame stepping (←/→ keys)
├── Bookmark markers (errors, tool calls, file edits)
├── Synchronized multi-view:
│   ├── 3D Brain (main)
│   ├── Message Log (side panel)
│   ├── File Diff Viewer (modal)
│   ├── Token Counter (HUD)
│   └── Tool Call Graph (overlay)
└── Export: WebM video, JSON trace, annotated markdown
```

### 3.5 Architecture Map (System Exploration)

```
Force-directed graph (compute shader) with 6 layers:
Layer 1: Providers (root nodes, sized by model count)
Layer 2: Models (connected to provider, colored by capability)
Layer 3: Agents (connected to default model)
Layer 4: Skills (connected to agents that use them)
Layer 5: MCP Servers (connected to skills/tools that call them)
Layer 6: Plugins (connected to events they handle)

Interactions:
- Click node → expand details panel
- Drag node → pin position, others re-layout
- Hover edge → show call frequency, latency
- Filter by: active/inactive, local/remote, enabled/disabled
- Search: fuzzy match on any property
```

### 3.6 Analytics Dashboard (HUD Overlay)

```
Persistent HUD (top-right, semi-transparent):
├── System Health
│   ├── Active sessions: 3
│   ├── Queue depth: 0
│   ├── Payload size: 12.4 MB / 18 MB (trim threshold)
│   └── MCP status: 14/22 ON
├── Token Economy (rolling 24h)
│   ├── Total: 2.4M tokens
│   ├── By provider: NVIDIA 45%, Anthropic 30%, Local 25%
│   ├── By skill: brainstorming 15%, compile 12%, note 8%
│   └── Cost estimate: $0.47 (NIM) / $0.00 (local)
├── Performance
│   ├── Avg response: 3.2s
│   ├── Tool call success: 94%
│   └── Trim events: 2 (last 24h)
└── Session Patterns
    ├── Peak hours: 14:00-18:00, 22:00-02:00
    ├── Avg session: 47 messages, 12 min
    └── Most used tools: bash, read, edit, mcp_call
```

---

## 4. Technical Implementation

### 4.1 Project Structure

```
brain-interface/
├── plugin/                          # opencode plugin
│   ├── src/
│   │   ├── index.ts                 # Plugin entry
│   │   ├── ws-server.ts             # WebSocket server (ws library)
│   │   ├── event-bridge.ts          # opencode events → WS
│   │   ├── file-watcher.ts          # chokidar on vault/sessions
│   │   ├── mcp-proxy.ts             # MCP bridge → WS RPC
│   │   └── static-server.ts         # Dev asset serving
│   ├── package.json
│   └── tsconfig.json
│
├── web/                             # Standalone web app
│   ├── public/
│   │   ├── index.html
│   │   ├── manifest.json
│   │   └── favicon.svg
│   ├── src/
│   │   ├── main.ts                  # App bootstrap
│   │   ├── engine/
│   │   │   ├── WebGPUEngine.ts      # Three.js + WebGPU setup
│   │   │   ├── ComputePipeline.ts   # Compute shader manager
│   │   │   ├── RenderLoop.ts        # Fixed-timestep loop
│   │   │   └── PostProcessing.ts    # Effect composer
│   │   ├── data/
│   │   │   ├── IndexedDB.ts         # Wrapper with migrations
│   │   │   ├── SessionParser.ts     # Streaming transcript parser
│   │   │   ├── QueryEngine.ts       # Web Worker + SQL.js
│   │   │   └── ReplayEngine.ts      # Frame generation
│   │   ├── modules/
│   │   │   ├── SessionMonitor.ts    # Live neural visualization
│   │   │   ├── SessionReplay.ts     # Time-travel scrubber
│   │   │   ├── ArchitectureMap.ts   # Force-directed graph
│   │   │   ├── AnalyticsHUD.ts      # Overlay dashboard
│   │   │   └── BrainRegions.ts      # Region management
│   │   ├── ui/
│   │   │   ├── HUD.ts               # Persistent overlay
│   │   │   ├── Panels.ts            # Slide-in detail panels
│   │   │   ├── Controls.ts          # Camera, timeline, filters
│   │   │   └── Settings.ts          # Preferences modal
│   │   ├── shaders/
│   │   │   ├── force-directed.wgsl  # GPU force layout
│   │   │   ├── particle-trail.wgsl  # Session impulse trails
│   │   │   ├── neural-pulse.wgsl    # Brain region animation
│   │   │   └── bloom.wgsl           # Custom bloom
│   │   └── styles/
│   │       ├── variables.css        # Design tokens
│   │       ├── layout.css           # Grid/flex layout
│   │       └── components.css       # Panel, button, slider styles
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts               # Vite + wasm + webgpu
│   └── worker/
│       └── query.worker.ts          # Web Worker for data
│
├── shared/                          # Shared types
│   ├── types.ts                     # WebSocket protocol, data schemas
│   └── constants.ts                 # Ports, thresholds, colors
│
├── docs/
│   ├── architecture.md
│   ├── shader-guide.md
│   └── plugin-api.md
│
├── package.json                     # Root workspace (pnpm)
├── turbo.json                       # Turborepo config
└── README.md
```

### 4.2 Key Dependencies

| Category | Packages | Version Strategy |
|----------|----------|------------------|
| **3D Engine** | `three@^0.160`, `@webgpu/types` | Latest stable |
| **Build** | `vite@^5`, `typescript@^5`, `pnpm@^9` | Locked |
| **WebSocket** | `ws@^8` (plugin), native `WebSocket` (web) | Standard |
| **File Watch** | `chokidar@^3` | Standard |
| **Database** | `idb@^8`, `sql.js@^1` (WASM) | WASM for queries |
| **Parsing** | Custom streaming parser | Zero-dep |
| **Compute** | WebGPU compute shaders (WGSL) | Native |
| **Styling** | CSS Custom Properties, no framework | Zero-runtime |

### 4.3 Compute Shaders (WGSL)

**Force-Directed Layout (Architecture Map):**
```wgsl
// force-directed.wgsl
@group(0) @binding(0) var<storage, read_write> nodes: array<Node>;
@group(0) @binding(1) var<storage, read> edges: array<Edge>;
@group(0) @binding(2) var<uniform> params: SimParams;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= nodes.length) { return; }
  
  var force = vec2<f32>(0.0);
  let node = nodes[i];
  
  // Repulsion (Barnes-Hut approximation via uniform grid)
  for (var j = 0u; j < nodes.length; j++) {
    if (i == j) { continue; }
    let other = nodes[j];
    let delta = node.position - other.position;
    let dist = max(length(delta), 0.1);
    force += normalize(delta) * params.repulsion / (dist * dist);
  }
  
  // Attraction (edges)
  for (var e = 0u; e < edges.length; e++) {
    let edge = edges[e];
    if (edge.source == i || edge.target == i) {
      let otherIdx = select(edge.target, edge.source, edge.source == i);
      let other = nodes[otherIdx];
      let delta = other.position - node.position;
      let dist = length(delta);
      force += normalize(delta) * params.attraction * dist;
    }
  }
  
  // Damping + velocity integration
  node.velocity = (node.velocity + force * params.dt) * params.damping;
  node.position += node.velocity * params.dt;
  
  nodes[i] = node;
}
```

**Neural Pulse (Session Impulses):**
```wgsl
// neural-pulse.wgsl
@group(0) @binding(0) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(1) var<uniform> time: f32;
@group(0) @binding(2) var<uniform> params: PulseParams;

@compute @workgroup_size(128)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= particles.length) { return; }
  
  var p = particles[i];
  let age = time - p.birthTime;
  
  if (age > p.lifetime) {
    // Reset particle (object pool)
    p = spawnParticle(params);
  } else {
    // Neural impulse propagation
    let progress = age / p.lifetime;
    p.position = p.startPos + p.direction * progress * p.speed;
    p.size = p.maxSize * smoothstep(0.0, 1.0, progress) * (1.0 - progress);
    p.opacity = 1.0 - progress;
    p.color = mix(p.startColor, p.endColor, progress);
  }
  
  particles[i] = p;
}
```

### 4.4 Session Parser (Streaming, Incremental)

```typescript
// SessionParser.ts — Handles 100MB+ transcripts efficiently
export class SessionParser {
  private db: IDBDatabase;
  private worker: Worker;
  
  async parseTranscript(file: File, sessionId: string): Promise<void> {
    // 1. Stream file in chunks (64KB)
    // 2. Parse markdown → structured messages incrementally
    // 3. Store in IndexedDB with indexes: sessionId, timestamp, tool, file
    // 4. Emit progress events for UI
    
    const stream = file.stream();
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let messageIndex = 0;
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      
      for (const line of lines) {
        const parsed = this.parseLine(line, messageIndex++);
        if (parsed) await this.storeMessage(sessionId, parsed);
      }
    }
    // Flush buffer
  }
  
  private parseLine(line: string, index: number): Message | null {
    // Fast regex parsing for: ### [N] role — timestamp
    // Tool invocations, file ops, reasoning, etc.
  }
}
```

---

## 5. Development Phases

### Phase 1: Foundation (Week 1-2)
- [ ] opencode plugin with WebSocket server
- [ ] Basic Three.js + WebGPU scene setup
- [ ] IndexedDB schema + session parser
- [ ] Vault/sessions auto-discovery
- [ ] Dev environment: `pnpm dev` → plugin + Vite HMR

### Phase 2: Core Visualizations (Week 3-4)
- [ ] Brain regions (static geometry + shaders)
- [ ] Live Session Monitor (neural impulses)
- [ ] Architecture Map (force-directed compute shader)
- [ ] Basic camera controls (orbit, fly, focus)

### Phase 3: Replay & History (Week 5-6)
- [ ] Session Replay engine (frame generation)
- [ ] Timeline scrubber with bookmarks
- [ ] Multi-view sync (3D + log + diff)
- [ ] Archive support (sessions/archive/)

### Phase 4: Analytics & Polish (Week 7-8)
- [ ] Analytics HUD (token costs, patterns)
- [ ] Settings / preferences persistence
- [ ] Performance optimization (LOD, frustum culling)
- [ ] Fallback to WebGL for non-WebGPU browsers
- [ ] Documentation + demo video

---

## 6. Configuration & Deployment

### 6.1 opencode Config Addition

```jsonc
// ~/.config/opencode/opencode.jsonc
{
  "plugin": [
    "./plugins/session-logger/session-logger.js",
    "./plugins/mcp-bridge.js",
    "./plugins/brain-interface/plugin.js",  // NEW
    "C:/Users/danhe/.config/opencode/node_modules/superpowers"
  ],
  "brainInterface": {
    "port": 3030,
    "host": "localhost",
    "enableWebSocket": true,
    "enableFileWatch": true,
    "enableMCPProxy": true,
    "maxPayloadBytes": 18000000
  }
}
```

### 6.2 Standalone App Deployment

```bash
# Development
cd brain-interface
pnpm install
pnpm dev          # Starts Vite + plugin (concurrently)

# Production build
pnpm build        # Outputs to dist/
pnpm preview      # Serves dist/ on localhost:4173

# Install as opencode plugin
pnpm plugin:build # Compiles plugin to dist/plugin.js
# Add to opencode.jsonc plugin array
```

### 6.3 Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BRAIN_INTERFACE_PORT` | 3030 | WebSocket server port |
| `BRAIN_INTERFACE_VAULT` | auto-detect | Vault path override |
| `BRAIN_INTERFACE_WEBGPU` | true | Force WebGPU (false = WebGL fallback) |
| `BRAIN_INTERFACE_DEBUG` | false | Verbose logging |

---

## 7. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| WebGPU not available | Medium | High | Three.js WebGL fallback; feature detection at startup |
| Large transcript parsing blocks UI | High | Medium | Web Worker + streaming parser; IndexedDB async |
| WebSocket connection drops | Medium | Medium | Auto-reconnect with exponential backoff; event replay on reconnect |
| Compute shader compilation fails | Low | High | Validate WGSL at build; fallback CPU layout |
| opencode plugin API changes | Medium | Medium | Versioned protocol; plugin loads gracefully |
| Memory leaks in long sessions | Medium | High | Object pooling for particles; periodic GC hints; LOD |

---

## 8. Future Extensions (Post-MVP)

- **Multi-user collaboration** — Shared brain state via WebRTC
- **AI-assisted insights** — "Why did this session trim?" → natural language explanation
- **Prompt optimization** — Visualize token waste, suggest prompt rewrites
- **Skill usage heatmap** — Which skills fire together, which are dead code
- **MCP call tracing** — Distributed trace view across MCP servers
- **Mobile companion** — Read-only view on phone (WebGL only)
- **Export to Obsidian** — Brain state as markdown + graph links

---

## 9. Appendix: Design Tokens

```css
/* variables.css — Brain Interface Design System */
:root {
  /* Neural Color Palette */
  --neural-afferent: #00d4ff;      /* User → Model (cyan) */
  --neural-efferent: #ff6b00;      /* Model → Tool (orange) */
  --neural-internal: #b84aff;      /* Reasoning (purple) */
  --neural-return: #00ff88;        /* Tool → Model (green) */
  --neural-error: #ff0044;         /* Errors (red) */
  --neural-background: #030508;    /* Deep space */
  --neural-surface: #0a0f14;       /* Panel background */
  --neural-border: #1a2330;        /* Subtle borders */
  --neural-text: #e8edf5;          /* Primary text */
  --neural-text-dim: #6b7b94;      /* Secondary text */
  
  /* Provider Colors */
  --provider-nvidia: #76b900;
  --provider-anthropic: #d4a5ff;
  --provider-google: #4285f4;
  --provider-ollama: #ff9500;
  --provider-freellm: #00c896;
  
  /* Spacing & Motion */
  --space-unit: 4px;
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 16px;
  --transition-fast: 120ms ease-out;
  --transition-normal: 240ms ease-out;
  --transition-slow: 480ms ease-out;
  
  /* 3D Parameters */
  --brain-radius: 500;
  --particle-count: 50000;
  --trail-length: 30;
  --pulse-speed: 2.5;
}
```

---

*Design document created 2026-11-14. Ready for review and implementation planning.*