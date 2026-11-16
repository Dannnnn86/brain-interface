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

**Milestones 1-3 — DONE (2026-11-15)**

- M1 Foundation: server (REST + WS + vault watcher + simulator), WebGPU brain
  cloud (44k points), region orbs, impulses, HUD; reporter plugin LIVE (real
  opencode sessions recording, incl. this project's own sessions)
- M2 Explorer: Architecture Map (169 nodes, click-to-inspect, BRAIN|MAP pill),
  focus layer (regions 1-6, session highlight, Space pause, Esc), durable event
  recorder (`data/events/*.jsonl`)
- M3 Time Machine: replay any session — timeline API (recorded/transcript
  sources, 60s idle-gap compression), session picker, timeline bar (0.5-100x,
  scrub, bookmarks, stepping), replay log; `?mode=replay&session=` deep links
- Tests: smoke 12/12, qa-interact 16/16, qa-shot + cdp-eval visual QA tooling
- Run: `npm run sim` (demo) or `npm run dev` (live) → http://localhost:4200
- Next: M4 Analyst (analytics API + dashboards + token capture + heatmap)

## Design & Plan

- Spec: [[docs/superpowers/specs/2026-11-14-opencode-brain-interface-design]]
- Plan: [[docs/superpowers/plans/2026-11-14-brain-interface-implementation]]
- Roadmap (M2-M4): [[docs/superpowers/plans/2026-11-15-brain-interface-m2-roadmap]]

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
