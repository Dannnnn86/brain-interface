---
title: "opencode Brain Interface â€” 3D System Visualization"
status: draft
created: 2026-11-14
last_reviewed: 2026-11-14
tags: [opencode, visualization, webgpu, threejs, architecture, brain-interface]
---

# opencode Brain Interface â€” 3D System Visualization

**A single-page WebGPU application that visualizes the entire opencode system as an interactive 3D brain â€” live sessions, system architecture, historical replay, and analytics in one immersive neural interface.**

---

## 1. Vision & Scope

### 1.1 Purpose
Create a **comprehensive brain interface** for opencode that unifies:
- **Real-time session monitoring** â€” watch active sessions as neural firing patterns
- **Time-travel session replay** â€” scrub through completed sessions frame-by-frame
- **System architecture exploration** â€” navigate skills, MCP servers, agents, providers as brain regions
- **Development analytics** â€” token costs, skill usage patterns, bottleneck detection

### 1.2 Core Metaphor: The Neural Brain
```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                    OPENDCODE BRAIN                          â”‚
â”‚  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”  â”‚
â”‚  â”‚  FRONTAL    â”‚  â”‚  TEMPORAL   â”‚  â”‚  PARIETAL           â”‚  â”‚
â”‚  â”‚  LOBE       â”‚  â”‚  LOBE       â”‚  â”‚  LOBE               â”‚  â”‚
â”‚  â”‚  Planning   â”‚  â”‚  Memory     â”‚  â”‚  Integration        â”‚  â”‚
â”‚  â”‚  (Agents)   â”‚  â”‚  (Sessions) â”‚  â”‚  (MCP Bridge)       â”‚  â”‚
â”‚  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜  â”‚
â”‚  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”  â”‚
â”‚  â”‚  OCCIPITAL  â”‚  â”‚  CEREBELLUM â”‚  â”‚  BRAINSTEM          â”‚  â”‚
â”‚  â”‚  LOBE       â”‚  â”‚  (Skills)   â”‚  â”‚  (Core Runtime)     â”‚  â”‚
â”‚  â”‚  (Visual    â”‚  â”‚  Procedural â”‚  â”‚  Providers, Config  â”‚  â”‚
â”‚  â”‚   Output)   â”‚  â”‚  Memory)    â”‚  â”‚                     â”‚  â”‚
â”‚  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜  â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

### 1.3 Success Criteria
- **60 FPS** on modern GPUs (RTX 3060+ / M1+), graceful fallback to Three.js WebGL
- **< 100ms latency** from opencode event â†’ visual update (WebSocket path)
- **Sub-second load** for 1000+ session replay
- **Zero config** â€” auto-discovers vault, sessions, opencode config
- **Extensible** â€” new visualization modules plug into core engine

---

## 2. System Architecture

### 2.1 High-Level Data Flow

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”     â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”     â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚   opencode       â”‚     â”‚   Brain Interface â”‚     â”‚   Browser        â”‚
â”‚   (Desktop/CLI)  â”‚     â”‚   (Standalone)    â”‚     â”‚   (Client)       â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜     â””â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜     â””â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
         â”‚                        â”‚                        â”‚
         â”‚ 1. Plugin: WS Server   â”‚                        â”‚
         â”‚â—„â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”‚                        â”‚
         â”‚                        â”‚                        â”‚
         â”‚ 2. Session Events      â”‚                        â”‚
         â”‚â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â–ºâ”‚                        â”‚
         â”‚                        â”‚                        â”‚
         â”‚ 3. File Watcher        â”‚                        â”‚
         â”‚ (sessions/ vault)      â”‚                        â”‚
         â”‚â—„â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”‚                        â”‚
         â”‚                        â”‚                        â”‚
         â”‚ 4. MCP Bridge Query    â”‚                        â”‚
         â”‚â—„â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”‚                        â”‚
         â”‚                        â”‚                        â”‚
         â”‚                    5. Render Loop (WebGPU)     â”‚
         â”‚                    â—„â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”‚
         â”‚                    6. User Interaction         â”‚
         â”‚                    â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â–ºâ”‚
```

### 2.2 Components

| Component | Technology | Responsibility |
|-----------|------------|----------------|
| **opencode Plugin** | TypeScript (Node.js) | WebSocket server, session event emission, file watcher, MCP bridge proxy |
| **WebGPU Engine** | Three.js r160+ + WebGPURenderer | Scene graph, compute shaders, render loop, post-processing |
| **Data Layer** | IndexedDB + Web Workers | Session caching, incremental parsing, query engine |
| **Visualization Modules** | TypeScript + Three.js | Session Monitor, Replay, Architecture Map, Analytics |
| **UI Layer** | Vanilla TS + CSS Custom Properties | HUD, controls, panels, settings (no React â€” performance) |

### 2.3 opencode Plugin (`brain-interface-plugin`)

**Location:** `~/.config/opencode/plugins/brain-interface/`

```typescript
// plugin.ts â€” Main entry
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
// Server â†’ Client (event stream)
{ "type": "session.start", "sessionId": "ses_...", "title": "...", "model": "..." }
{ "type": "message.delta", "sessionId": "ses_...", "messageIndex": 5, "part": {...} }
{ "type": "tool.call", "sessionId": "ses_...", "tool": "bash", "args": {...}, "startTime": 123 }
{ "type": "tool.result", "sessionId": "ses_...", "tool": "bash", "result": {...}, "duration": 45 }
{ "type": "session.idle", "sessionId": "ses_...", "messageCount": 47 }
{ "type": "session.error", "sessionId": "ses_...", "error": "..." }

// Client â†’ Server (RPC)
{ "id": 1, "method": "getSystemState", "params": {} }
{ "id": 2, "method": "replaySession", "params": { "sessionId": "ses_...", "speed": 2.0 } }
```

### 2.4 Data Layer (Browser)

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                    DATA LAYER (IndexedDB)                  â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚  sessions/       â”‚  Transcripts, parsed messages, metadata â”‚
â”‚  system/         â”‚  Providers, agents, skills, MCPs, configâ”‚
â”‚  replay/         â”‚  Pre-computed frame data for scrubbing  â”‚
â”‚  analytics/      â”‚  Aggregated metrics, token costs, usage â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
         â”‚
         â–¼
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                    QUERY ENGINE (Web Worker)               â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚  â€¢ Incremental transcript parsing (streaming JSON)         â”‚
â”‚  â€¢ Session search/filter (tags, dates, files, tools)       â”‚
â”‚  â€¢ Analytics aggregations (token trends, skill frequency)  â”‚
â”‚  â€¢ Replay frame generation (time â†’ visual state)           â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
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
Active Session â†’ Neural Pathway
â”œâ”€â”€ User Message          â†’ Bright blue impulse (afferent)
â”œâ”€â”€ Model Reasoning       â†’ Purple slow wave (internal)
â”œâ”€â”€ Tool Call             â†’ Gold spike (efferent)
â”‚   â”œâ”€â”€ bash              â†’ Terminal icon particle
â”‚   â”œâ”€â”€ edit/read/write   â†’ File icon particle  
â”‚   â”œâ”€â”€ mcp_call          â†’ MCP server node highlight
â”‚   â””â”€â”€ skill             â†’ Cerebellum region pulse
â”œâ”€â”€ Tool Result           â†’ Green return wave
â””â”€â”€ Assistant Response    â†’ Blue impulse train (efferent)

Visual Encoding:
- Amplitude = token count / complexity
- Frequency = message rate
- Color hue = model/provider (NVIDIA=green, Anthropic=purple, Google=blue, Local=orange)
- Particle trail = file paths touched
```

### 3.4 Session Replay (Time-Travel)

```
Timeline Scrubber (bottom) â†’ Controls replay speed/direction
â”œâ”€â”€ 0.1x  â”€â”€ 0.5x â”€â”€ 1x â”€â”€ 2x â”€â”€ 10x â”€â”€ 100x
â”œâ”€â”€ Frame-by-frame stepping (â†/â†’ keys)
â”œâ”€â”€ Bookmark markers (errors, tool calls, file edits)
â”œâ”€â”€ Synchronized multi-view:
â”‚   â”œâ”€â”€ 3D Brain (main)
â”‚   â”œâ”€â”€ Message Log (side panel)
â”‚   â”œâ”€â”€ File Diff Viewer (modal)
â”‚   â”œâ”€â”€ Token Counter (HUD)
â”‚   â””â”€â”€ Tool Call Graph (overlay)
â””â”€â”€ Export: WebM video, JSON trace, annotated markdown
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
- Click node â†’ expand details panel
- Drag node â†’ pin position, others re-layout
- Hover edge â†’ show call frequency, latency
- Filter by: active/inactive, local/remote, enabled/disabled
- Search: fuzzy match on any property
```

### 3.6 Analytics Dashboard (HUD Overlay)

```
Persistent HUD (top-right, semi-transparent):
â”œâ”€â”€ System Health
â”‚   â”œâ”€â”€ Active sessions: 3
â”‚   â”œâ”€â”€ Queue depth: 0
â”‚   â”œâ”€â”€ Payload size: 12.4 MB / 18 MB (trim threshold)
â”‚   â””â”€â”€ MCP status: 14/22 ON
â”œâ”€â”€ Token Economy (rolling 24h)
â”‚   â”œâ”€â”€ Total: 2.4M tokens
â”‚   â”œâ”€â”€ By provider: NVIDIA 45%, Anthropic 30%, Local 25%
â”‚   â”œâ”€â”€ By skill: brainstorming 15%, compile 12%, note 8%
â”‚   â””â”€â”€ Cost estimate: $0.47 (NIM) / $0.00 (local)
â”œâ”€â”€ Performance
â”‚   â”œâ”€â”€ Avg response: 3.2s
â”‚   â”œâ”€â”€ Tool call success: 94%
â”‚   â””â”€â”€ Trim events: 2 (last 24h)
â””â”€â”€ Session Patterns
    â”œâ”€â”€ Peak hours: 14:00-18:00, 22:00-02:00
    â”œâ”€â”€ Avg session: 47 messages, 12 min
    â””â”€â”€ Most used tools: bash, read, edit, mcp_call
```

---

## 4. Technical Implementation

### 4.1 Project Structure

```
brain-interface/
â”œâ”€â”€ plugin/                          # opencode plugin
â”‚   â”œâ”€â”€ src/
â”‚   â”‚   â”œâ”€â”€ index.ts                 # Plugin entry
â”‚   â”‚   â”œâ”€â”€ ws-server.ts             # WebSocket server (ws library)
â”‚   â”‚   â”œâ”€â”€ event-bridge.ts          # opencode events â†’ WS
â”‚   â”‚   â”œâ”€â”€ file-watcher.ts          # chokidar on vault/sessions
â”‚   â”‚   â”œâ”€â”€ mcp-proxy.ts             # MCP bridge â†’ WS RPC
â”‚   â”‚   â””â”€â”€ static-server.ts         # Dev asset serving
â”‚   â”œâ”€â”€ package.json
â”‚   â””â”€â”€ tsconfig.json
â”‚
â”œâ”€â”€ web/                             # Standalone web app
â”‚   â”œâ”€â”€ public/
â”‚   â”‚   â”œâ”€â”€ index.html
â”‚   â”‚   â”œâ”€â”€ manifest.json
â”‚   â”‚   â””â”€â”€ favicon.svg
â”‚   â”œâ”€â”€ src/
â”‚   â”‚   â”œâ”€â”€ main.ts                  # App bootstrap
â”‚   â”‚   â”œâ”€â”€ engine/
â”‚   â”‚   â”‚   â”œâ”€â”€ WebGPUEngine.ts      # Three.js + WebGPU setup
â”‚   â”‚   â”‚   â”œâ”€â”€ ComputePipeline.ts   # Compute shader manager
â”‚   â”‚   â”‚   â”œâ”€â”€ RenderLoop.ts        # Fixed-timestep loop
â”‚   â”‚   â”‚   â””â”€â”€ PostProcessing.ts    # Effect composer
â”‚   â”‚   â”œâ”€â”€ data/
â”‚   â”‚   â”‚   â”œâ”€â”€ IndexedDB.ts         # Wrapper with migrations
â”‚   â”‚   â”‚   â”œâ”€â”€ SessionParser.ts     # Streaming transcript parser
â”‚   â”‚   â”‚   â”œâ”€â”€ QueryEngine.ts       # Web Worker + SQL.js
â”‚   â”‚   â”‚   â””â”€â”€ ReplayEngine.ts      # Frame generation
â”‚   â”‚   â”œâ”€â”€ modules/
â”‚   â”‚   â”‚   â”œâ”€â”€ SessionMonitor.ts    # Live neural visualization
â”‚   â”‚   â”‚   â”œâ”€â”€ SessionReplay.ts     # Time-travel scrubber
â”‚   â”‚   â”‚   â”œâ”€â”€ ArchitectureMap.ts   # Force-directed graph
â”‚   â”‚   â”‚   â”œâ”€â”€ AnalyticsHUD.ts      # Overlay dashboard
â”‚   â”‚   â”‚   â””â”€â”€ BrainRegions.ts      # Region management
â”‚   â”‚   â”œâ”€â”€ ui/
â”‚   â”‚   â”‚   â”œâ”€â”€ HUD.ts               # Persistent overlay
â”‚   â”‚   â”‚   â”œâ”€â”€ Panels.ts            # Slide-in detail panels
â”‚   â”‚   â”‚   â”œâ”€â”€ Controls.ts          # Camera, timeline, filters
â”‚   â”‚   â”‚   â””â”€â”€ Settings.ts          # Preferences modal
â”‚   â”‚   â”œâ”€â”€ shaders/
â”‚   â”‚   â”‚   â”œâ”€â”€ force-directed.wgsl  # GPU force layout
â”‚   â”‚   â”‚   â”œâ”€â”€ particle-trail.wgsl  # Session impulse trails
â”‚   â”‚   â”‚   â”œâ”€â”€ neural-pulse.wgsl    # Brain region animation
â”‚   â”‚   â”‚   â””â”€â”€ bloom.wgsl           # Custom bloom
â”‚   â”‚   â””â”€â”€ styles/
â”‚   â”‚       â”œâ”€â”€ variables.css        # Design tokens
â”‚   â”‚       â”œâ”€â”€ layout.css           # Grid/flex layout
â”‚   â”‚       â””â”€â”€ components.css       # Panel, button, slider styles
â”‚   â”œâ”€â”€ package.json
â”‚   â”œâ”€â”€ tsconfig.json
â”‚   â”œâ”€â”€ vite.config.ts               # Vite + wasm + webgpu
â”‚   â””â”€â”€ worker/
â”‚       â””â”€â”€ query.worker.ts          # Web Worker for data
â”‚
â”œâ”€â”€ shared/                          # Shared types
â”‚   â”œâ”€â”€ types.ts                     # WebSocket protocol, data schemas
â”‚   â””â”€â”€ constants.ts                 # Ports, thresholds, colors
â”‚
â”œâ”€â”€ docs/
â”‚   â”œâ”€â”€ architecture.md
â”‚   â”œâ”€â”€ shader-guide.md
â”‚   â””â”€â”€ plugin-api.md
â”‚
â”œâ”€â”€ package.json                     # Root workspace (pnpm)
â”œâ”€â”€ turbo.json                       # Turborepo config
â””â”€â”€ README.md
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
// SessionParser.ts â€” Handles 100MB+ transcripts efficiently
export class SessionParser {
  private db: IDBDatabase;
  private worker: Worker;
  
  async parseTranscript(file: File, sessionId: string): Promise<void> {
    // 1. Stream file in chunks (64KB)
    // 2. Parse markdown â†’ structured messages incrementally
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
    // Fast regex parsing for: ### [N] role â€” timestamp
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
- [ ] Dev environment: `pnpm dev` â†’ plugin + Vite HMR

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
    "~/.config/opencode/node_modules/superpowers"
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

- **Multi-user collaboration** â€” Shared brain state via WebRTC
- **AI-assisted insights** â€” "Why did this session trim?" â†’ natural language explanation
- **Prompt optimization** â€” Visualize token waste, suggest prompt rewrites
- **Skill usage heatmap** â€” Which skills fire together, which are dead code
- **MCP call tracing** â€” Distributed trace view across MCP servers
- **Mobile companion** â€” Read-only view on phone (WebGL only)
- **Export to Obsidian** â€” Brain state as markdown + graph links

---

## 9. Appendix: Design Tokens

```css
/* variables.css â€” Brain Interface Design System */
:root {
  /* Neural Color Palette */
  --neural-afferent: #00d4ff;      /* User â†’ Model (cyan) */
  --neural-efferent: #ff6b00;      /* Model â†’ Tool (orange) */
  --neural-internal: #b84aff;      /* Reasoning (purple) */
  --neural-return: #00ff88;        /* Tool â†’ Model (green) */
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