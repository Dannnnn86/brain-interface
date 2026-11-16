/**
 * engine.ts — renderer, camera, controls and the frame loop.
 *
 * Uses three's WebGPURenderer with an automatic WebGL fallback (both via the
 * renderer's own fallback and an explicit try/catch re-init), an orbiting
 * damped camera, and a hook list so modules register per-frame updates.
 */
import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { animate } from 'animejs';

export type FrameHook = (dt: number, t: number) => void;

export interface Engine {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly backend: 'webgpu' | 'webgl';
  readonly fps: number;
  onFrame(hook: FrameHook): void;
  start(): void;
  /** Smoothly move the camera + orbit target. Cancels any in-flight flight. */
  flyTo(position: THREE.Vector3, target: THREE.Vector3, ms?: number): void;
  readonly size: { w: number; h: number };
}

async function createRenderer(canvas: HTMLCanvasElement): Promise<{ renderer: any; backend: 'webgpu' | 'webgl' }> {
  // Prefer WebGPU; three's WebGPURenderer also has an internal WebGL2 fallback.
  try {
    const renderer = new THREE.WebGPURenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    await renderer.init();
    return { renderer, backend: 'webgpu' };
  } catch (err) {
    console.warn('[engine] WebGPU init failed, falling back to WebGL2:', err);
    const renderer = new THREE.WebGPURenderer({
      canvas,
      antialias: true,
      forceWebGL: true,
    });
    await renderer.init();
    return { renderer, backend: 'webgl' };
  }
}

export async function createEngine(canvas: HTMLCanvasElement): Promise<Engine> {
  const { renderer, backend } = await createRenderer(canvas);

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x030508, 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x030508);

  const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 1, 6000);
  camera.position.set(40, 130, 420);

  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, -10, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.4;
  controls.minDistance = 120;
  controls.maxDistance = 1100;
  controls.enablePan = false;
  controls.update();

  const hooks: FrameHook[] = [];
  let prevFrameAt = performance.now();
  let elapsed = 0;
  let fpsEma = 60;
  const size = { w: window.innerWidth, h: window.innerHeight };

  window.addEventListener('resize', () => {
    size.w = window.innerWidth;
    size.h = window.innerHeight;
    camera.aspect = size.w / size.h;
    camera.updateProjectionMatrix();
    renderer.setSize(size.w, size.h);
  });

  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const dt = Math.min((now - prevFrameAt) / 1000, 0.05);
    prevFrameAt = now;
    elapsed += dt;
    if (dt > 0) fpsEma = fpsEma * 0.95 + (1 / dt) * 0.05;

    controls.update();
    for (const hook of hooks) {
      try {
        hook(dt, elapsed);
      } catch (err) {
        console.error('[engine] frame hook error:', err);
      }
    }
    renderer.render(scene, camera);
  });

  let flight: { cancel: () => void } | null = null;

  const engine: Engine = {
    scene,
    camera,
    controls,
    backend,
    get fps() {
      return fpsEma;
    },
    size,
    onFrame(hook) {
      hooks.push(hook);
    },
    start() {
      // setAnimationLoop already running
    },
    flyTo(position, target, ms = 950) {
      flight?.cancel();
      const fromPos = camera.position.clone();
      const fromTgt = controls.target.clone();
      const obj = { t: 0 };
      const animation = animate(obj, {
        t: 1,
        duration: ms,
        ease: 'inOut(2)',
        onUpdate: () => {
          camera.position.lerpVectors(fromPos, position, obj.t);
          controls.target.lerpVectors(fromTgt, target, obj.t);
          controls.update();
        },
      }) as unknown as { cancel?: () => void; pause?: () => void };
      flight = { cancel: () => animation.cancel?.() };
    },
  };

  return engine;
}

/** Thin glowing ring texture (shockwaves, halos). */
export function makeRingTexture(sizePx = 256): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = sizePx;
  c.height = sizePx;
  const ctx = c.getContext('2d')!;
  const r = sizePx / 2;
  const g = ctx.createRadialGradient(r, r, r * 0.62, r, r, r * 0.98);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.35)');
  g.addColorStop(0.78, 'rgba(255,255,255,0.95)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(r, r, r * 0.99, 0, Math.PI * 2);
  ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

/** Shared soft radial-gradient texture (glow dot) for points and sprites. */
export function makeGlowTexture(inner = 'rgba(255,255,255,1)', edge = 'rgba(255,255,255,0)', sizePx = 128): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = sizePx;
  c.height = sizePx;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(sizePx / 2, sizePx / 2, 0, sizePx / 2, sizePx / 2, sizePx / 2);
  g.addColorStop(0, inner);
  g.addColorStop(0.4, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, edge);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, sizePx, sizePx);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}
