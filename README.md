# Brain Interface

3D WebGPU visualization of the entire opencode system — live sessions, system
architecture, session replay, and analytics in one immersive neural interface.

```
        ◉ BRAIN INTERFACE
   a two-lobed pressure-field of everything
   your agent is doing, right now
```

## What it shows

- **Brain cloud** — 44k GPU-instanced points, deep violet → cyan, breathing
- **Region orbs** — frontal (agents), temporal (sessions), parietal (mcp),
  occipital (output), cerebellum (skills), brainstem (runtime)
- **Neural impulses** — every session event becomes a travelling pulse:
  user message (cyan), tool call (orange), tool result (green),
  reasoning (purple), error (red burst)
- **Session cards** — live sessions with message/tool counters, model dots
- **Event feed** — rolling ticker of the last 10 events
- **System panel** — providers, models, MCP servers, skills, plugins, agents,
  events/min, FPS, renderer backend

## Run it

Prerequisites: Node 24+.

```bash
npm install          # once
npm run build        # build web/dist (needed for production mode)
```

### Auto-start (recommended)

The production server (one port, :3030, serving the built UI) starts hidden at
every logon via a Windows scheduled task, and restarts itself up to 3× on crash:

```bash
npm run autostart:install   # register the task (already done on this machine)
npm run autostart:status    # task state + port 3030 check
npm run autostart:stop      # pause it
npm run autostart:start     # resume it
npm run autostart:remove    # uninstall the task
```

Then open **http://localhost:3030** — bookmark it.
Log file: `data/server-autostart.log`.

> The production UI is the **built** app — after pulling code changes run
> `npm run build` and restart the task (`autostart:stop` + `autostart:start`).

### Development mode

```bash
npm run sim          # server with --simulate + Vite dev UI (:4200), hot reload
npm run dev          # live: plugin events + vault watching + Vite dev UI
```

If the auto-started server already occupies :3030, `dev`/`sim` reuse it and
only spawn the Vite UI (the dev UI proxies API/WS to :3030).

## Live events (opencode plugin)

The reporter plugin forwards real session events (tool calls, completions,
idle/error) to the server with zero dependencies and zero blocking:

1. Copy `plugin/brain-interface.js` to
   `~/.config/opencode/plugins/brain-interface/brain-interface.js`
   (already deployed on this machine)
2. Add it to the `plugin` array in `~/.config/opencode/opencode.jsonc`:
   ```jsonc
   "plugin": [
     "./plugins/session-logger/session-logger.js",
     "./plugins/mcp-bridge.js",
     "./plugins/brain-interface/brain-interface.js",
     "C:/Users/danhe/.config/opencode/node_modules/superpowers"
   ]
   ```
3. Restart opencode (plugins are loaded at startup).

Until then, the server still works live via the vault watcher (finished
sessions appear within seconds) plus `--simulate` for the full experience.

## Production mode (single port)

```bash
npm run build        # tsc + vite build → web/dist
npm start            # server serves the built app on :3030
```

## Development utilities

```bash
node scripts/smoke.js                 # server end-to-end smoke test (8 checks)
node scripts/qa-shot.js http://localhost:4200 out.png
                                      # headless-Chrome visual QA (screenshot +
                                      # console + app state JSON, no deps)
```

## Architecture

```
plugin/brain-interface.js   opencode reporter (zero deps, fail-silent POSTs)
server/                     node server: REST + WS + vault watcher + simulator
web/                        Vite + TypeScript + three.js (WebGPU) + anime.js
shared/protocol.js(.d.ts)   wire protocol shared by all three
```

- Native WebGPU points are 1px (`point-list` has no point size) — the clouds
  use the documented `Sprite` + `PointsNodeMaterial` + `instancedBufferAttribute`
  pattern with `sprite.count` for instancing.
- WebGPU → WebGL2 fallback is automatic (three falls back internally; we also
  retry with `forceWebGL: true`).

## Ports

| Service | Port | Override |
|---------|------|----------|
| Production (auto-start task) | 3030 | `BRAIN_PORT` |
| Vite dev | 4200 | `WEB_PORT` |

## Troubleshooting

- **Port busy** — server exits with a clear message; set `BRAIN_PORT=3031`.
- **No WebGPU** — automatic WebGL2 fallback; the SYSTEM panel shows the
  active backend.
- **No impulses** — check the connection badge is LIVE; with `npm run dev`
  (not `sim`) events only flow once the plugin is installed + opencode
  restarted, though finished sessions still appear via the watcher.
- **Vault not found** — set `BRAIN_VAULT=D:/path/to/vault`.
