# Brain Interface â€” Implementation Plan (Milestone 1: Foundation)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A running 3D neural visualization of the opencode system â€” live session events, session cards, event feed, brain point-cloud â€” served on localhost, fed by a fail-safe opencode plugin reporter + vault file watcher + simulator.

**Architecture:** Two packages + one plugin. `server/` (Node ESM, deps: ws + chokidar) owns all logic: HTTP + WebSocket hub, vault/session scanning, system-state reading from opencode config, event ingest, simulator. `web/` (Vite + TS, deps: three + animejs) renders the 3D scene and HUD. `plugin/brain-interface.js` is a zero-dep, fail-silent reporter inside opencode that POSTs normalized session events to the server (same pattern as session-logger's BEAM relay).

**Tech Stack:** Node 24 (ESM), ws@^8, chokidar@^4, Vite@^6, TypeScript@^5.9, three@0.187 (WebGPURenderer w/ auto WebGL fallback), animejs@^4, plain CSS custom properties. No frameworks anywhere.

## Global Constraints

- Node â‰¥ 24, npm workspaces at repo root; NO pnpm.
- Plugin (`~/.config/opencode/plugins/brain-interface/brain-interface.js`) must be **zero npm dependencies**, fail-silent, never throw into opencode runtime (mirror session-logger.js patterns).
- Server ports: backend `3030`, web dev `4200`; both overridable via env (`BRAIN_PORT`, `WEB_PORT`).
- All loopback only (127.0.0.1). No auth in v1.
- NVIDIA payload cap: never dump >50KB into chat context; long outputs go to files.
- Visual palette = spec tokens (deep space #030508, afferent #00d4ff, efferent #ff6b00, internal #b84aff, return #00ff88, error #ff0044).
- Do not restart opencode / disrupt running sessions. Config edit for the plugin is made but only takes effect next launch.

---

### Task 1: Workspace scaffold

**Files:** Create `package.json` (root), `scripts/dev.js`, `shared/protocol.js`, `shared/protocol.d.ts`, `.gitignore`

- [ ] Root package.json: workspaces `["server","web"]`, scripts: `dev` (node scripts/dev.js), `sim` (server --simulate), `build` (web).
- [ ] scripts/dev.js: zero-dep spawner, prefixes `[server]`/`[web]` output, starts server then `vite` in web/, graceful Ctrl+C.
- [ ] shared/protocol.js: event type constants + `normalizeEvent()` used by both sides (plain ESM).
- [ ] shared/protocol.d.ts: TS types for the protocol (ClientMessage, ServerMessage, SessionSummary, SystemEvent, SystemState).
- [ ] Verify: `npm install` at root resolves both workspaces.

### Task 2: Server â€” config + hub + HTTP/WS core

**Files:** Create `server/package.json`, `server/src/config.js`, `server/src/hub.js`, `server/src/index.js`

- [ ] config.js: port env overrides; vault discovery (upward search for `Home.md`+`log.md`, default `<your-vault>`); opencode config dir resolution (same logic as session-logger).
- [ ] hub.js: WS client registry + `broadcast(msg)`; heartbeat ping/pong every 30s; dead client cleanup.
- [ ] index.js: node:http server; routes: `GET /api/health`, `GET /api/state`, `GET /api/sessions`, `GET /api/sessions/:id`, `POST /ingest`, static serve of `web/dist` when built; `Upgrade: websocket` handled by raw ws server on path `/ws`.
- [ ] Verify: `node server/src/index.js` â†’ curl health returns JSON; ws connects via node -e smoke script.

### Task 3: Server â€” system state reader

**Files:** Create `server/src/state.js`

- [ ] Reads: opencode.jsonc (providers/models/mcp/plugin list â€” tolerate JSONC comments via strip + JSON.parse), skills dirs (`~/.config/opencode/skills`, `~/.agents/skills`, superpowers skills), agents (built-ins + `.opencode/agents`), MCP servers with enabled flags, plugins array.
- [ ] Produces `SystemState` = { providers[], mcpServers[], plugins[], skills[], agents[], vault, configDir, generatedAt }.
- [ ] Rebuildable on demand (cached 30s).
- [ ] Verify: node smoke â†’ counts match reality (â‰ˆ5 providers, â‰ˆ20 MCPs, hundreds of skills).

### Task 4: Server â€” sessions store + vault watcher

**Files:** Create `server/src/sessions.js`, `server/src/watcher.js`

- [ ] sessions.js: parse `sessions/index.md` entries (`- date â€” title`, Session id, Messages, Tag, Transcript link); transcript header parse (`### [n] role â€” ts`); session store Map keyed by id with { title, date, messages, tools, files, tag, status }.
- [ ] watcher.js: chokidar on `<vault>/sessions` (ignoreInitial, awaitWriteFinish) â†’ on new/changed `.md` (not index.md) reparse + emit `session.file` event + broadcast `session.update`.
- [ ] Verify: temp-dir unit smoke: write fake transcript â†’ store gains session.

### Task 5: Server â€” ingest (plugin events) + simulator

**Files:** Create `server/src/ingest.js`, `server/src/simulator.js`

- [ ] ingest.js: accept normalized events from plugin: `session.start|session.activity|tool.call|tool.result|session.idle|session.error`; maintain live-session table (status live/idle/error, messageCount, lastEventAt, tools counter, files); broadcast each to WS; auto-idle sessions after 10 min of silence.
- [ ] simulator.js (`--simulate`): procedural fake sessions â€” spawn 2-4 sessions, emit user message â†’ reasoning â†’ tool calls (bash/read/edit/mcp_call with realistic names) â†’ results â†’ assistant text â†’ idle; loop forever; clearly flagged `simulated:true` in events.
- [ ] Verify: `node server/src/index.js --simulate` prints events; ws client receives them.

### Task 6: Web â€” scaffold + engine + WebGL/WebGPU renderer

**Files:** Create `web/package.json`, `web/tsconfig.json`, `web/vite.config.ts`, `web/index.html`, `web/src/main.ts`, `web/src/styles/main.css`, `web/src/engine/engine.ts`

- [ ] vite.config: port 4200, proxy `/api` + `/ws` (ws:true) â†’ 127.0.0.1:3030.
- [ ] engine.ts: `WebGPURenderer` (try) with `forceWebGL` fallback path; perspective cam (60Â°, zâ‰ˆ340); fixed-timestep loop w/ FPS meter; resize handling; `renderer.xr.enabled=false`; tone mapping ACES; clear color #030508.
- [ ] main.css: full-bleed canvas, HUD overlay grid, palette tokens from spec.
- [ ] Verify: `npm run build -w web` compiles clean; dev server serves HTML.

### Task 7: Web â€” brain point cloud + regions + labels

**Files:** Create `web/src/engine/brain.ts`, `web/src/engine/regions.ts`

- [ ] brain.ts: ~40k additive-blended points in a two-lobed brain ellipsoid (parametric surface + fbm noise jitter), slow rotation + subtle breathing scale (sin). Points shader: soft round sprite (texture), size attenuation, per-point color mix (deep violet â†’ cyan by radial depth).
- [ ] regions.ts: 6 glowing orbs (sprite + radial gradient texture) at brain-region anchors (frontal/temporal/parietal/occipital/cerebellum/brainstem) each with an HTML label (projected each frame, `[data-region]` elements), gentle pulse; API `flashRegion(name, color)` for events.
- [ ] Verify: build + visual check by Dan.

### Task 8: Web â€” net client + store

**Files:** Create `web/src/net/client.ts`, `web/src/state/store.ts`

- [ ] client.ts: WS connect to `/ws`, exponential-backoff reconnect, ping â†’ status ('connecting'|'live'|'offline'), RPC helper (id-keyed promises).
- [ ] store.ts: tiny observable store â€” sessions Map, event log ring (200), systemState, stats (events/min, per-type counts); emits change events for HUD.
- [ ] Verify: build clean; node smoke of reconnect logic not needed (manual).

### Task 9: Web â€” HUD (anime.js) + impulses (Session Monitor v1)

**Files:** Create `web/src/ui/hud.ts`, `web/src/engine/impulses.ts`

- [ ] hud.ts: top-left: brand + connection badge + live session cards (title, model dot, message count ticking, tool icons) â€” anime.js enter/update animations; top-right: system stats (providers/MCP/skills counts, events/min, FPS) with animated counters; bottom: event feed ticker (last 10, color-coded by type, slide-in via anime.js).
- [ ] impulses.ts: GPU-friendly impulsion system â€” pool of ~600 sprites; event â†’ spawn impulse traveling along a randomized curved path between region anchors (user: brainstemâ†’frontal cyan; tool.call: frontalâ†’parietal orange; tool.result: parietalâ†’temporal green; assistant: temporalâ†’brainstem cyan-blue; error: red burst at anchor); trail = fading sprite copies; ties to store event stream.
- [ ] Verify: `npm run dev` + `node server --simulate` â†’ visible impulses + live cards; Dan confirms.

### Task 10: Plugin reporter + opencode wiring

**Files:** Create `plugin/brain-interface.js`; deploy copy to `~\.config\opencode\plugins\brain-interface\brain-interface.js`; edit `~/.config/opencode/opencode.jsonc` plugin array

- [ ] Zero-dep ESM reporter: subscribes to session.status/message.updated/message.part.updated/session.error; normalizes + POSTs to `http://127.0.0.1:3030/ingest` with 2s AbortController timeout; fail-silent; in-memory counters; vault discovery reused (Home.md+log.md).
- [ ] Only forwards *interesting* parts (tool invocations, text completions, errors) to keep payload tiny.
- [ ] Add `"./plugins/brain-interface/brain-interface.js"` to plugin array (takes effect next opencode launch â€” do NOT restart now).
- [ ] Verify: node run of reporter module standalone (syntax + factory export); simulated fetch POST to running server logs an ingest.

### Task 11: Milestone verification + docs

**Files:** Update `Home.md` status, `log.md`; write `README.md` (run instructions)

- [ ] End-to-end: root `npm install` â†’ `npm run dev` â†’ open http://localhost:4200 â†’ simulated sips render; screenshots if playwright cache available; else Dan visual check.
- [ ] README: prerequisites, run commands, plugin install step, simulate mode, ports, troubleshooting (port busy, no WebGPU).
- [ ] Update log.md + Home.md; commit all.

## Risks & Fixes (self-critique)

1. **three@0.187 WebGPU API drift** â†’ v1 uses only stable core (Scene/Camera/Points/Sprite/WebGPURenderer). If WebGPURenderer import fails at build, swap to WebGLRenderer (same visuals for v1) â€” decision point in engine.ts behind a flag.
2. **Vite 8 novelty** â†’ pin vite@^6 (known config surface).
3. **Plugin runtime lacks fetch timeout control** â†’ AbortController is available in Bun (session-logger already uses it for BEAM). Fail-silent wrapper duplicates that proven code.
4. **opencode restart required for live plugin** â†’ simulator + file watcher cover the demo until next natural restart.
5. **Port collisions** â†’ env overrides + clear error messages; server exits non-zero with reason.
6. **Payload cap safety** â†’ no big file reads in this session; all artifacts written to disk; short console outputs.
7. **FS watch recursion on Windows** â†’ chokidar handles natively; awaitWriteFinish prevents half-written transcript parses.

## Acceptance (M1)

- `npm run dev` from repo root: both processes up, prefixed logs, no crash.
- Browser at :4200 shows: brain cloud + 6 labeled regions + HUD; with `--simulate`, impulses fire and session cards tick in real time.
- With a real opencode session (next restart): same visuals fed by the plugin; after session ends, its transcript appears via watcher.
- `npm run build` produces clean web dist; tsc has zero errors.
