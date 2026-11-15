/**
 * main.ts — boot sequence.
 *
 *   canvas → engine (WebGPU w/ WebGL fallback) → brain + regions + impulses
 *   → HUD → WebSocket client → live.
 *
 * Boot overlay is dismissed once the first frame has rendered.
 */
import './styles/main.css';
import { createEngine } from './engine/engine.js';
import { createBrain } from './engine/brain.js';
import { createRegions } from './engine/regions.js';
import { ImpulseSystem } from './engine/impulses.js';
import { store } from './state/store.js';
import { connect } from './net/client.js';
import { Hud } from './ui/hud.js';

async function boot(): Promise<void> {
  const canvas = document.getElementById('scene') as HTMLCanvasElement;
  const labelsRoot = document.getElementById('labels') as HTMLElement;

  const engine = await createEngine(canvas);
  console.info(`[brain] renderer backend: ${engine.backend}`);

  const brain = createBrain(engine.scene);
  const regions = createRegions(engine.scene, labelsRoot);
  const impulses = new ImpulseSystem(engine.scene, regions.anchors, regions);

  store.onFeedItem.push((event) => impulses.onEvent(event));

  const hud = new Hud(engine);
  store.subscribe(() => hud.render(engine));
  hud.render(engine);

  engine.onFrame((dt, t) => {
    brain.update(dt, t);
    regions.update(dt, t, engine.camera, engine.size);
    impulses.update(dt, t);
  });

  engine.start();
  connect();

  // Debug/QA hook — used by scripts/qa-shot.js (and the console) to inspect
  // the running app without any build tooling.
  (window as unknown as Record<string, unknown>).__brain = { engine, store };

  // Dismiss the boot overlay after a beat so the first frames land smoothly.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      document.getElementById('boot')?.classList.add('done');
    }),
  );
}

boot().catch((err) => {
  console.error('[brain] boot failed:', err);
  const bootEl = document.getElementById('boot');
  if (bootEl) {
    bootEl.innerHTML =
      '<div class="boot-glyph" style="color:#ff0044">▲</div>' +
      '<div class="boot-text">renderer failed — check the console</div>';
  }
});
