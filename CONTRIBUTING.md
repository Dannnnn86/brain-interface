# Contributing

Thanks for your interest in improving the Brain Interface!

## Setup

```bash
git clone https://github.com/Dannnnn86/brain-interface.git
cd brain-interface
npm install
npm run build
npm run sim        # demo mode: server with simulator + hot-reloading UI
```

Open http://localhost:4200 (Vite dev UI) — changes to `web/src` hot-reload,
changes to `server/src` need a server restart (Ctrl+C, rerun).

## Ground rules

- **Dependency-light by design.** The server allows only `ws` and `chokidar`;
  the web app only `three` and `animejs`. New dependencies need a stated
  reason in the PR description.
- **No frameworks.** Plain TypeScript + DOM + CSS custom properties.
- **Fail-safe plugin.** `plugin/brain-interface.js` must stay zero-dependency,
  fire-and-forget, and never throw into the opencode runtime.

## Before opening a PR

```bash
npx tsc --noEmit --project web   # typecheck
npm run build                    # production build must be clean
node scripts/smoke.js            # server suite (17 checks)
node scripts/qa-interact.js      # interaction suite (22 checks)
```

All four must pass. Visual changes: attach a screenshot (or run
`node scripts/qa-shot.js <url> out.png` and include it).

## Style

- Small, focused modules; one responsibility per file.
- Comments explain *why*, not *what*.
- Commit messages in the conventional style used in the log
  (`feat:`, `fix:`, `docs:`, `chore:`).
