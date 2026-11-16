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
