---
tags: [project, opencode, visualization]
status: active
created: 2026-11-15
---

# Brain Interface

3D WebGPU visualization of the entire opencode system — live sessions, system architecture, session replay, and analytics in one immersive neural interface.

**Location:** `D:\projects\44-brain-interface`

## Purpose

A single-page WebGPU app that renders opencode's whole system as an interactive 3D brain:
- **Session Monitor** — active sessions as neural firing patterns (streams of impulses per tool call)
- **Session Replay** — time-travel scrub through completed sessions with bookmarks (planned)
- **Architecture Map** — force-directed graph of providers, models, agents, skills, MCP servers, plugins (planned)
- **Analytics HUD** — token economy, tool success rates, trim events, session patterns (planned)

## Status

**Milestone 1 (Foundation) — DONE (2026-11-15)**

- Server (node, ws+chokidar): REST API, WS hub, vault watcher (403 sessions parsed),
  system-state reader (8 providers / 18 MCP / 111 skills), simulator, ingest pipeline
- Web (Vite+TS, three 0.187 WebGPU, animejs): 44k-point instanced sprite brain cloud,
  6 labeled region orbs, neural impulse system, HUD (cards/stats/feed/legend)
- Plugin reporter deployed to `~/.config/opencode/plugins/brain-interface/` and
  registered in `opencode.jsonc` (takes effect next opencode restart)
- Tests: `node scripts/smoke.js` (8/8), `scripts/qa-shot.js` headless visual QA
- Run: `npm run sim` (demo) or `npm run dev` (live) at the repo root → http://localhost:4200

## Design & Plan

- Spec: [[docs/superpowers/specs/2026-11-14-opencode-brain-interface-design]]
- Plan: [[docs/superpowers/plans/2026-11-14-brain-interface-implementation]]

## Key Decisions

- Standalone web app (localhost) + opencode plugin (WebSocket server + file watcher + MCP proxy)
- Hybrid data: live WebSocket events + vault/sessions file watching + MCP bridge queries
- Three.js WebGPURenderer with compute shaders; WebGL fallback
- Vanilla TS + CSS custom properties for UI (no framework — performance)

## Sections

- [[notes/Home]] — fleeting ideas
- [[inbox/Home]] — external captures
- [[knowledge/Home]] — evergreen knowledge
- [[outputs/Home]] — saved answers
- [[projects/Home]] — project-specific knowledge
- [[log]] — capture/compile log
