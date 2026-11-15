/**
 * watcher.js — watches the vault's sessions/ directory so finished sessions
 * appear in the UI within a couple of seconds, with no plugin involvement.
 *
 * Any .md change (including index.md, which is how session-logger announces
 * new sessions) triggers a debounced refresh callback.
 */
import chokidar from 'chokidar';
import { SESSIONS_DIR } from './config.js';

const DEBOUNCE_MS = 1000;

export function startWatcher({ onSessionsChanged, log }) {
  let timer = null;
  const trigger = (file) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        onSessionsChanged(file);
      } catch (err) {
        log?.(`refresh failed: ${err?.message || err}`);
      }
    }, DEBOUNCE_MS);
    timer.unref?.();
  };

  const watcher = chokidar.watch(SESSIONS_DIR, {
    ignoreInitial: true,
    depth: 0,
    awaitWriteFinish: { stabilityThreshold: 800, pollInterval: 200 },
  });
  watcher.on('add', (f) => f.endsWith('.md') && trigger(f));
  watcher.on('change', (f) => f.endsWith('.md') && trigger(f));
  watcher.on('error', (err) => log?.(`watcher error: ${err?.message || err}`));
  return watcher;
}
