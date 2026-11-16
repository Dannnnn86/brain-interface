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

## M3 — Time Machine (Replay)

**Server:**
- [ ] `GET /api/sessions/:id/timeline` → normalized event timeline:
      - primary source: recorded `events/*.jsonl` (real timestamps, tool
        durations, model info);
      - fallback: transcript parser (message index → synthetic ts, tool lines
        from `> **tool**` lines — parser already exists in sessions.js).
      - Response: `{ session, frames: [{ t, type, tool?, ok?, text?, ... }], bookmarks: [{ t, kind: 'error'|'tool'|'file' }] }`.
- [ ] Timeline cache in memory (LRU 20) — transcripts re-parse is O(file).

**Client — REPLAY mode:**
- [ ] Third mode pill state `[ BRAIN | MAP | REPLAY ]` (or replay is an
      overlay on BRAIN — decided: replay IS brain mode with a timeline bar).
- [ ] Session picker (searchable dropdown from session list; live sessions
      disabled with "still running" tooltip).
- [ ] Bottom timeline: scrubber (drag = seek), play/pause, speeds
      0.5×/1×/2×/10×/100×, bookmark ticks (errors red, tool calls orange,
      file edits blue), frame stepping `←/→`.
- [ ] Replay engine (`ReplayEngine.ts`): virtual clock maps scrub position →
      stream of due events → same ImpulseSystem + a "replay session card" that
      shows counts at time T. Seeking backwards = reset impulse pool +
      fast-forward silently (no animation spam: batch-spawn with age offsets).
- [ ] Multi-view sync (lite): side log panel showing the message text around
      the playhead (from timeline frames).

**Verify:** replay a known real session (e.g. the trim-session one) — check
card counters match transcript at end; qa-shot with `?mode=replay&session=...`
+ vision QA of the timeline UI; stepping works via CDP key events.

---

## M4 — Analyst (Analytics + Persistence)

**Server:**
- [ ] `GET /api/analytics` (cached 60s): from recorded events + transcripts:
      - tool success rate + avg duration by tool (top 20);
      - events/day + sessions/day (last 30 days, sparkline-ready arrays);
      - per-model usage counts + token totals (once token capture proven);
      - trim events, error rates, busiest hours (heatmap-ready 7×24 grid).
- [ ] Usage-based edges for the MAP: agent → skill edges from transcripts'
      skill invocations (weights = counts). Replaces guess-edges.

**Client — ANALYTICS overlay:**
- [ ] Slide-over dashboard (no chart lib; hand-rolled canvas sparklines/bars):
      4 cards (tool health, activity, models, heatmap). anime.js count-ups.
- [ ] Brain heatmap mode: region orbs sized/brightened by activity share in
      the window (e.g. cerebellum bigger when skill usage high).
- [ ] IndexedDB persistence (idb): sessions + feed survive refresh; cold boot
      instant from cache, then reconcile with hello. (Optional if time.)

**Verify:** analytics numbers cross-checked against raw jsonl with a node
one-liner (printed table); vision QA of dashboard.

---

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
