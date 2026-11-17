---
tags: [log]
status: active
created: 2026-11-15
---

# Log

## 2026-11-15 — Initialized
Project scaffolded at `D:\projects\44-brain-interface`. Design spec approved; implementation plan written. Phase 1 (Foundation) starts: opencode plugin with WebSocket server, web app scaffold, 3D scene.

## 2026-11-15 — Milestone 1 (Foundation) complete
- Full stack built and verified: server (REST+WS+vault watcher+simulator), web app
  (WebGPU brain cloud, impulses, HUD), zero-dep reporter plugin (deployed + registered).
- Key finding: WebGPU native points are locked at 1px (point-list topology) — cloud
  rebuilt with the documented Sprite + PointsNodeMaterial + instancedBufferAttribute
  pattern (`sprite.count` drives instancing). Verified via headless screenshot + vision QA.
- Smoke test: 8/8. QA shots: boot OK, 30 session cards, feed flowing, 6 labels, 128-140fps
  (SwiftShader headless; higher on real GPU).
- Committed as `c29f021` (42 files) on Dan's go.
- Roadmap written: [[docs/superpowers/plans/2026-11-15-brain-interface-m2-roadmap]]
  (M2 Explorer: architecture map + focus interactions + event recorder;
  M3 Time Machine: replay; M4 Analyst: analytics + persistence).
- Next: M2-A live plugin verification after opencode restart, then M2-B map.

## 2026-11-15 — Milestone 2 (Explorer) complete
- **Event recorder** (`server/src/recorder.js`): every normalized event appended
  to `server/data/events/YYYYMMDD.jsonl` (fire-and-forget); `GET /api/events`
  serves them; ingest logs first-event-per-session + endings.
- **Architecture Map**: 169-node constellation (providers→models→agents→
  skills→MCP→plugins rings, colored edges, CPU picking, hover/select, fly-to,
  detail panel); BRAIN|MAP pill with anime crossfade; `?mode=map` deep link.
- **Focus layer**: region orbs clickable (+keys 1-6) → info panel + fly-to;
  session card click → highlight (others dim to 22%) + camera + detail;
  Space = pause impulses (PAUSED badge); Esc clears.
- **Impulse upgrades**: per-model color tint (30% lerp), error shockwave rings,
  24-particle bursts, ghosts, global fade.
- **Tests**: smoke 10/10, `scripts/qa-interact.js` 10/10 (new), qa-shot both
  modes + vision QA clean; `scripts/cdp-eval.js` added for debugging.
- Gotcha: Vite dev cache served stale CSS after rapid saves (watcher missed a
  save) — restart Vite; diagnose with cdp-eval rule inspection.

## 2026-11-15 — Milestone 3 (Time Machine) complete
- **Plugin verified LIVE**: real opencode sessions recorded (own M1 session =
  332 frames) — the whole pipeline works with reality, not just the simulator.
- **Timeline API** (`server/src/timeline.js` + REST/WS): recorded jsonl source
  (≥5 events) with transcript fallback; idle-gap compression (60s cap) in both
  — 17h real session → 2.2h replay; LRU-20 cache; `totals` for counters.
- **Replay UI**: REPLAY pill (3-mode), searchable session picker (live
  disabled), timeline bar (transport, 0.5–100×, drag scrub + bookmark ticks,
  counters), replay log panel; live feed/legend hidden in replay mode.
- **ReplayEngine**: frame stream into the same impulse system; backward seek =
  clear + history respawn; stepping; Space/←/→/Esc/r keys; `?mode=replay&
  session=` deep-link (connection-race fixed with whenConnected()).
- **Tests**: smoke 12/12 (marker-fixture timeline + real-session bounds),
  qa-interact 16/16 (full replay flow), vision QA + deterministic CDP checks
  (vision false-positive on feed/legend hidden state — CDP confirmed correct).
- **Durable fix**: Vite `server.watch.usePolling` (Windows watcher reliability;
  stale-CSS bit twice across sessions).
- Deferred: token capture (M4, needs a probe pass over live event shapes).

## 2026-11-15 — Milestone 4 (Analyst) complete — ROADMAP COMPLETE
- **analytics.js**: tool health (per-session call→result pairing), 30-day
  activity, models, 7×24 local-hour heatmap, errors, skill usage, byType;
  scope all|real (simulated excluded); 60s cache. Cross-checked vs raw jsonl:
  exact match (24425 events / 5676 calls, delta 0). Recorder MAX_READ 5k→50k.
- **Analytics overlay**: totals count-ups, tool bars (okRate colors), canvas
  sparkline, model bars, 168-cell heatmap, skills, errors; ALL/REAL toggle;
  open via system-panel link / `a` / `?analytics=1`.
- **Brain heat**: region orbs swell by activity share (sqrt) from analytics.
- **Map**: skill nodes swell by real invocation counts.
- Fixes: sessions panel overlapped feed (max-height cap); vision false-positive
  rate noted again (heatmap "missing" = below fold; 168 cells in DOM).
- Tests: smoke 14/14, qa-interact 20/20. Vite polling: 0 restarts needed.
- Remaining nice-to-haves (parking lot): token capture probe, IndexedDB
  offline boot, agent→skill map edges, WebM export, Telegram digest.

## 2026-11-15 — Milestone 5 (Guardian & Insight) complete
- **Payload pressure**: plugin v2 incremental estimator (+ runtime.start
  handshake, token capture); card gauges, panel strip, temporal pressure ring;
  sim heavy-session spikes (gauge peaked 19.1/18 MB). 18MB trim constant shared.
- **Tokens & cost**: SDK-verified message.updated capture (tokens+cost,
  cumulative per session); analytics tokens card + per-model tokens/cost.
- **Problem sessions**: 10-min error-episode clustering, click → instant
  replay. **Unknown-skill detection** (real `unknown×2` caught).
- **Dead-skill dimming** on map; **bloom** (TSL, WebGPU-only, 59fps headless)
  + activity-driven cloud brightness.
- **Left panel = current opencode run**: runtime.start resets deck; WS live-only;
  picker fetches full catalog (500 cap); empty-state hint card.
- **500-session cutoff**: oldest idle/completed evicted (memory/lists only;
  vault files untouched); evicted ids replay via index.md scan.
- Tests: smoke 17/17, qa-interact 22/22, vision clean. Plugin deployed —
  live payload/tokens verify on next opencode restart.

## 2026-11-15 — Auto-start at logon
- Scheduled task `BrainInterfaceServer` registered (current user, at logon):
  runs scripts/start-server.vbs (invisible wscript) → node server/src/index.js
  --serve-web on :3030, restarts up to 3× on crash, log at
  data/server-autostart.log. Management: npm run autostart:{install,remove,
  start,stop,status}.
- Production URL: http://localhost:3030 (serves built UI; live mode, no sim).
- dev/sim now detect an occupied :3030 and reuse the running server instead of
  failing (dev UI proxies to it).
- Verified live: task started the server (pid 11064), health ok, web 200.
