# Brain Interface — M2/M3/M4 Improvement Roadmap

> **Status:** M1 complete (commit c29f021, 2026-11-15). This document is the
> working plan for the next milestones, ordered by value. Each milestone is
> independently shippable and ends with QA evidence (smoke + qa-shot + vision).

**Guiding principle:** the interface should grow from *monitor* → *explorer* →
*time machine* → *analyst*, without ever regressing the live view.

---

## M2 — Explorer (Architecture Map + Focus + Event Recorder)

**Goal:** click through the whole system; every live event is durably recorded
so later milestones (replay, analytics) have a source of truth.

### M2-A: Live plugin verification + event recorder (small)

- [x] After Dan restarts opencode: confirm plugin POSTs land (add a one-line
      ingest log: first event per session per hour, not per-event spam).
      → ingest logs first event per session + idle/error endings (done).
- [x] Server: append every normalized event to `server/data/events/YYYYMMDD.jsonl`
      (append-only, daily files, gitignored). This is the replay + analytics
      raw feed. Rotation: close handle at midnight; never block ingest on IO
      (fire-and-forget append). → recorder.js (done, verified in smoke).
- [ ] Plugin: defensively extract token usage from `session.updated` /
      message info if present (`info.tokens` shapes vary) → include as
      `tokens: { input?, output? }` on events. Probe first with a logging
      pass, then wire the real field. → DEFERRED to M3 (needs live plugin
      session post-restart to probe event shapes).
- [x] `GET /api/events?day=YYYYMMDD&limit=` → recorded events (for replay/analytics).

**Verify:** smoke adds a check that jsonl grows after POST /ingest; restart a
real session → server log shows plugin events (not simulated).

### M2-B: Architecture Map (the big visual win — data already served)

**Data prep (server):**
- [x] `state.js`: return the FULL skills list — `skills.names: string[]`
      (per-skill source tag deferred; not needed yet).
- [ ] `GET /api/state` grows: skill → vendor/agent linkage guesses (v1:
      none, edges refined in M3 from real transcript usage).

**Client — new module `web/src/modules/ArchitectureMap.ts`:**
- Layout: concentric force layout on CPU (≈180 nodes; <1ms/frame — GPU compute
  deferred until >1k nodes; keep behind a `LayoutEngine` interface so a TSL
  compute swap-in is later a one-file change):
  - Ring 0 center: BRAIN hub. Ring 1: providers. Ring 2: models.
    Ring 3: agents. Ring 4: skills (fanned by source). Ring 5: MCP servers.
    Ring 6: plugins.
- Rendering: nodes = instanced glow sprites (reuse the sprite pattern from
  brain.ts, one sprite per ring-group), edges = one additive `LineSegments`
  with per-vertex colors (opacity by edge type), labels = projected divs
  (hover + selected only — never all 180 at once).
- Toggle: top-center pill `[ BRAIN | MAP ]`, anime.js crossfade of the two
  scenes (brain group fades to 0.08, map fades in), camera stays.
- Interactions: raycast on pointerdown; click node → right-side detail panel
  (name, type, provider/status/description where known); filter chips row
  (enabled/disabled, local/remote, provider color legend); double-click →
  camera fly-to node.
- MCP status dots: enabled (green) / disabled (dim) / bridge-gated — data
  from `/api/state` (`enabled` flag).

**Verify:** `qa-shot.js http://localhost:4200/?mode=map` (add URL param to boot
straight into map mode for automation) → vision QA: rings legible, no
overlaps beyond acceptable, labels readable; smoke: `/api/state` returns full
skill name list (length > 100).

### M2-C: Focus & interaction layer

- [ ] Region orbs become clickable → region info panel (right side):
      frontal → agents list; parietal → MCP statuses; cerebellum → skills
      (top 20 + count); temporal → live sessions; brainstem → system summary.
- [ ] Session card click → camera fly-to (anime tween of `controls.target` +
      camera position), selected session highlighted: its impulses render at
      full brightness, others dim to 35% (per-session opacity multiplier in
      ImpulseSystem).
- [ ] Keyboard: `1–6` fly to regions, `Space` pause/resume impulse spawning,
      `Esc` clear selection.
- [ ] Hover a session card → its impulses get a soft outline glow (cheap:
      temporarily raise ghost count via size multiplier).

**Verify:** CDP-driven click test in qa-shot (click a `.session-card`, assert
camera moved / selection class applied); vision QA of the panel.

### M2-D: Visual polish pass

- [ ] Per-model impulse colors: `impulsePathFor` gains a model-color override
      (event.model → provider palette from store.modelColor) — user/tool/result
      keep type colors, but the impulse *tint* leans model color at 30% mix.
- [ ] Bloom: evaluate three 0.187 `PostProcessing` (TSL `pass()` + bloom) —
      if API friction > 1h, skip (additive sprites already glow) and note for M3.
- [ ] Error bursts: 14 → 24 particles, add a brief region-orb shockwave ring
      (scale-up sprite with fast fade).
- [ ] Starfield parallax: stars rotate at 0.5× brain rate; add slow drift.

**Verify:** qa-shot vs prior screenshots — vision A/B "which looks richer";
FPS must stay ≥ 55 in headless (SwiftShader baseline was 63).

### M2 acceptance — DONE (2026-11-15)

- `npm run sim` → toggle MAP → full system graph (169 nodes); click a node →
  detail panel; back to BRAIN → key 1-6 → region panel; click card → camera
  flies + session highlighted.
- Smoke: 10/10 checks (added skills-full-list + events-recorded).
- `scripts/qa-interact.js`: **10/10 interaction checks** (click/Esc/mode toggle/
  keyboard/card/Space-pause) — new reusable regression test.
- `scripts/qa-shot.js ?mode=map` + vision QA: map polished, MAP highlighted,
  labels readable, nothing clipped; brain mode unchanged + healthy.
- Deferred (noted for M3): node-kind filter chips UI (module API exists:
  `setKindVisible`), hover-glow on cards, PostProcessing bloom, token capture.
- Gotcha logged: Vite dev-server cache can silently serve a stale CSS transform
  after rapid saves — restart Vite after big CSS edits if rules seem missing
  (verify rule presence via `scripts/cdp-eval.js`).

---

## M3 — Time Machine (Replay) — DONE (2026-11-15)

**Server:**
- [x] `GET /api/sessions/:id/timeline` (+ WS `getTimeline`) → normalized
      frames. Two sources: recorded `events/*.jsonl` (≥5 events) with real
      timestamps, fallback transcript parser (real message stamps).
      NEW: idle-gap compression (60s cap per gap) in BOTH sources — real
      sessions span hours (one was 17h; compressed to ~2.2h; transcripts
      19h → 21min). Frames/format exactly as planned + `totals`.
- [x] Timeline cache (LRU 20, 10-min TTL) in `server/src/timeline.js`.

**Client — REPLAY mode:**
- [x] Third pill state `[ BRAIN | MAP | REPLAY ]`; replay reuses the brain
      scene (impulses) exactly as planned.
- [x] Session picker: searchable, live sessions disabled with tooltip.
- [x] Bottom timeline bar: transport (⏮ ▶ ⏭), speeds 0.5–100×, drag-scrub
      track with glowing handle, bookmark ticks (tool orange / file blue /
      error red), time + live counters (msgs · tools · frame i/N).
- [x] ReplayEngine: virtual clock → frame stream into the SAME ImpulseSystem;
      backward seek = clearAll + 1.2s history-window respawn; forward seek =
      silent; stepping ←/→; Space play/pause; Esc exits; `r` enters replay.
- [x] Replay log panel (right side; live feed + legend hidden in replay mode).
- [x] Live safety: store.onFeedItem router skips impulses while replay owns
      the scene; ambient impulses off in replay; URL `?mode=replay&session=`
      deep-link (waits for WS connect before fetching).

**Verified:** smoke **12/12** (incl. deterministic marker timeline + real
session compressed), qa-interact **16/16** (picker, load, play, pause, step,
exit), vision QA of timeline UI, deterministic CDP layout checks.
**BONUS:** the reporter plugin was found LIVE — real opencode sessions
(including this project's own M1 session, 332 frames) are being recorded.
Deferred to M4: token capture from live events (probe pass when M4 starts).

---

## M4 — Analyst (Analytics + Persistence) — DONE (2026-11-15)

**Server:**
- [x] `GET /api/analytics` + WS `getAnalytics` (cached 60s per scope) on
      `server/src/analytics.js`: tool health (calls/okRate/avgMs; per-session
      chronological call→result pairing, name-independent), 30-day activity
      (events+sessions/day), models (events+sessions), 7×24 LOCAL-hour
      heatmap, errors (+recent 10), skillUsage (skill-tool argsSummary),
      byType counts. **Scope toggle `all|real`** (excludes simulated —
      honest numbers police).
      - Verified: cross-checked vs raw jsonl — **exact match** (24425 events /
        5676 tool calls, delta 0). Recorder read cap raised 5k→50k (analytics
        was silently truncating to exactly 10 000).
- [x] Map usage-weighting: skill nodes swell by real invocation counts
      (`setSkillUsage`, matched to skill labels). Agent→skill edges deferred —
      agent attribution isn't reliable from current data (honest note).

**Client — ANALYTICS overlay:**
- [x] Slide-over dashboard (`web/src/ui/analyticsPanel.ts`): totals with
      anime count-ups, tool-health bars (okRate color-coded), 30-day canvas
      sparkline (events+sessions), model bars (provider colors), 168-cell
      heatmap, top skills, recent errors. Scope toggle ALL|REAL. Opened via
      the SYSTEM panel's "analytics ▸" link, key `a`, or `?analytics=1`.
- [x] Brain heat: region orbs swell by activity share (sqrt-scaled) from
      analytics (cerebellum grows with skill usage etc.).
- [ ] IndexedDB persistence — DEFERRED (server hello already serves
      everything on refresh; offline cold-boot not worth it yet).

**Verify:** smoke **14/14** (analytics all+real scopes), qa-interact **20/20**
(overlay, bars, 168 cells, scope refetch, Esc), vision QA confirmed totals
(27k/548/6259/958 = API-exact), sessions-panel/feed overlap fixed
(deterministic CDP check). Vite polling watcher: zero restarts needed.

---

## M5 — Guardian & Insight — DONE (2026-11-15)

**Parts shipped:**
1. **Payload pressure** — plugin estimates session size incrementally (text/output
   diffs ×1.25 + part overhead), `session.payload` events (throttled 5s); card
   gauges + sessions-panel strip ("peak ≈ X / 18 MB · trim guard") + pulsing
   temporal-anchor ring (cyan→amber→red, shows >40%). Simulator emits growth
   curves + heavy sessions that exceed the cap  (verified: gauge hit 19.1/18 MB).
2. **Tokens & cost** — plugin captures `message.updated` info (SDK-verified
   `tokens` + opencode's own `cost`), dedupes per message, sends cumulative
   `session.tokens`; analytics aggregates totals + per-model (tokens & cost card;
   placeholder until a live restart feeds real data — fixtures prove the path).
3. **Error episodes → problem sessions** — analytics clusters errors per session
   (10-min gaps), top-10 card; **click a row = instant replay** (verified).
4. **Dead-skill detection** — map dims zero-invocation skills to 28% once usage
   data is loaded; analytics lists unrecognized skill calls (already caught a
   real one: `unknown×2` from title-less skill parts).
5. **Bloom + data-driven brain** — TSL bloom (strength 0.35, WebGPU-only,
   try/catch fallback — verified active in QA, 59fps headless); cloud brightness
   follows live events/min (smoothed activity uniform).
6. **Left panel = this opencode run** — plugin sends `runtime.start` handshake;
   server resets the live deck per run; WS = live-only, REST/rpc = full catalog;
   picker fetches the catalog on open (up to 500 rows); empty deck shows a hint
   card. (opencode exposes no tab-state API — "open" = active since app launch.)
7. **500-session cutoff** — server tracks max 500 (oldest idle/completed evicted
   first; memory/lists only — vault files never touched); evicted ids still
   resolve via index.md scan for replay.

**Tests:** smoke **17/17** (payload/token persistence, runtime handshake deck
reset, analytics shapes), qa-interact **22/22** (gauges, strip, problem-click →
replay, all prior flows). Vision: bloom glow confirmed, no defects.

**After Dan's next opencode restart:** confirm live `session.payload` +
`session.tokens` in the server log / analytics tokens card.

## Parking lot (later / on request)

- WebM export of the brain view (canvas.captureStream + MediaRecorder).
- Compute-shader force layout (TSL) when node count > 1k (full skills graph).
- Multi-vault / multi-instance opencode support (vault switcher).
- Telegram digest hook: daily brain snapshot image at ~21:00.
- Mobile read-only layout (portrait HUD collapse).
- Replay annotations → write back to vault notes (`outputs/` brain postmortems).

## Cross-cutting rules

- Every milestone: `tsc --noEmit` clean, smoke suite green (extended per
  milestone), qa-shot + vision QA evidence, memory index updated, commit.
- Never regress M1: live view must work at every commit (mode toggles additive).
- Server stays dependency-light (ws + chokidar only; new deps need a stated reason).
