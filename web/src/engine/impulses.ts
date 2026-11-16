/**
 * impulses.ts — session events rendered as travelling neural impulses.
 *
 * A sprite pool (no per-frame allocations): each impulse is one glowing head
 * sprite plus two ghost sprites that lag behind it, moving along a quadratic
 * bezier between two region anchors. Events map to paths/colors via
 * impulsePathFor(); errors spawn radial bursts at the affected anchor.
 *
 * Idle ambience: if nothing has fired for a few seconds, faint internal
 * impulses keep the brain breathing.
 */
import * as THREE from 'three/webgpu';
import { makeGlowTexture, makeRingTexture } from './engine.js';
import { EVENT, impulsePathFor, PALETTE } from '@shared/protocol.js';
import type { SystemEvent } from '@shared/protocol.js';
import type { RegionName, Regions } from './regions.js';
import { modelColor } from '../state/store.js';

const POOL_SIZE = 180;
const GHOSTS = 2;
const SHOCKWAVE_POOL = 8;

const ease = THREE.MathUtils.smoothstep;

interface Impulse {
  active: boolean;
  material: THREE.SpriteMaterial;
  head: THREE.Sprite;
  ghosts: THREE.Sprite[];
  from: THREE.Vector3;
  control: THREE.Vector3;
  to: THREE.Vector3;
  age: number;      // negative = delayed
  delay: number;
  duration: number;
  size: number;
  sessionId?: string;
}

interface Shockwave {
  sprite: THREE.Sprite;
  material: THREE.SpriteMaterial;
  active: boolean;
  age: number;
  duration: number;
  maxScale: number;
}

export class ImpulseSystem {
  private pool: Impulse[] = [];
  private next = 0;
  private group = new THREE.Group();
  private lastSpawnAt = performance.now();
  private shockwaves: Shockwave[] = [];
  private fade = 1;
  private paused = false;
  private highlight: string | null = null;

  constructor(
    scene: THREE.Scene,
    private anchors: Record<RegionName, THREE.Vector3>,
    private regions: Regions,
  ) {
    const glow = makeGlowTexture();
    for (let i = 0; i < POOL_SIZE; i++) {
      const material = new THREE.SpriteMaterial({
        map: glow,
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const head = new THREE.Sprite(material);
      head.scale.setScalar(0.001);
      head.visible = false;
      const ghosts: THREE.Sprite[] = [];
      for (let g = 0; g < GHOSTS; g++) {
        const ghost = new THREE.Sprite(material); // shares color/opacity — trail via scale only
        ghost.scale.setScalar(0.001);
        ghost.visible = false;
        ghosts.push(ghost);
        this.group.add(ghost);
      }
      this.group.add(head);
      this.pool.push({
        active: false,
        material,
        head,
        ghosts,
        from: new THREE.Vector3(),
        control: new THREE.Vector3(),
        to: new THREE.Vector3(),
        age: 0,
        delay: 0,
        duration: 1,
        size: 14,
      });
    }
    this.group.frustumCulled = false;
    scene.add(this.group);

    // Shockwave pool (error bursts): expanding ring sprites.
    const ring = makeRingTexture();
    for (let i = 0; i < SHOCKWAVE_POOL; i++) {
      const material = new THREE.SpriteMaterial({
        map: ring,
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(material);
      sprite.scale.setScalar(0.001);
      sprite.visible = false;
      this.group.add(sprite);
      this.shockwaves.push({ sprite, material, active: false, age: 0, duration: 0.7, maxScale: 200 });
    }
  }

  /* ---------------------------- spawning ---------------------------- */

  private take(): Impulse {
    // Round-robin through the pool; stealing the oldest slot when saturated.
    const imp = this.pool[this.next];
    this.next = (this.next + 1) % this.pool.length;
    return imp;
  }

  private spawn(
    from: THREE.Vector3,
    to: THREE.Vector3,
    color: number | THREE.Color,
    opts: {
      size?: number;
      duration?: number;
      delay?: number;
      intensity?: number;
      curve?: number;
      straight?: boolean;
      sessionId?: string;
    } = {},
  ): Impulse {
    const imp = this.take();
    const fromV = from.clone();
    const toV = to.clone();
    imp.from = fromV;
    imp.to = toV;

    const dist = fromV.distanceTo(toV);
    const duration = opts.duration ?? THREE.MathUtils.clamp(dist / 260, 0.8, 1.9);
    const delay = opts.delay ?? 0;
    const size = opts.size ?? 15;

    // Quadratic bezier control point: midpoint pushed sideways for an arc.
    const mid = fromV.clone().lerp(toV, 0.5);
    if (opts.straight) {
      imp.control = mid;
    } else {
      const dir = toV.clone().sub(fromV);
      const perp = new THREE.Vector3(-dir.z, dir.y * 0.35, dir.x).normalize();
      const bow = dist * (opts.curve ?? 0.16) * (Math.random() * 2 - 1);
      imp.control = mid.add(perp.multiplyScalar(bow)).add(new THREE.Vector3(0, (Math.random() - 0.5) * dist * 0.1, 0));
    }

    imp.age = -delay;
    imp.delay = delay;
    imp.duration = duration;
    imp.size = size;
    imp.active = true;
    imp.sessionId = opts.sessionId;

    const c = color instanceof THREE.Color ? color.clone() : new THREE.Color(color);
    c.multiplyScalar(opts.intensity ?? 1);
    imp.material.color.copy(c);
    imp.material.opacity = 0;

    const visible = delay <= 0;
    imp.head.visible = visible;
    for (const g of imp.ghosts) g.visible = visible;

    this.lastSpawnAt = performance.now();
    return imp;
  }

  /** Mix the event's model color into the type color (30%). */
  private tintFor(baseColor: number, model?: string): THREE.Color {
    const c = new THREE.Color(baseColor);
    if (model) {
      try {
        c.lerp(new THREE.Color(modelColor(model)), 0.3);
      } catch {
        /* unknown color string — keep base */
      }
    }
    return c;
  }

  /* ------------------------- public controls ------------------------- */

  setFade(v: number): void {
    this.fade = THREE.MathUtils.clamp(v, 0, 1);
  }

  setPaused(p: boolean): void {
    this.paused = p;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  /** Dim every impulse except those of `sessionId` (null = no highlight). */
  setHighlight(sessionId: string | null): void {
    this.highlight = sessionId;
  }

  /* ------------------------- public API ------------------------- */

  /** Feed a session event into the visualization. */
  onEvent(event: SystemEvent): void {
    const path = impulsePathFor(event.type);
    const from = this.anchors[path.from];
    const to = this.anchors[path.to];
    if (!from || !to) return;
    const sid = event.sessionId;

    switch (event.type) {
      case EVENT.SESSION_START: {
        for (let i = 0; i < 3; i++) {
          this.spawn(from, to, this.tintFor(path.color, event.model), {
            delay: i * 0.12,
            size: 13,
            intensity: 0.85,
            sessionId: sid,
          });
        }
        this.regions.flashRegion('frontal', PALETTE.internal, 700);
        break;
      }
      case EVENT.SESSION_ACTIVITY: {
        const size = 13 + Math.min(8, (event.messageCount ?? 0) / 8);
        this.spawn(from, to, this.tintFor(path.color, event.model), { size, intensity: event.text ? 1 : 0.8, sessionId: sid });
        this.regions.flashRegion('frontal', PALETTE.afferent, 500);
        break;
      }
      case EVENT.TOOL_CALL: {
        this.spawn(from, to, this.tintFor(path.color, event.model), { size: 15, sessionId: sid });
        this.regions.flashRegion('parietal', PALETTE.efferent, 600);
        if (event.tool === 'skill') this.regions.flashRegion('cerebellum', PALETTE.internal, 800);
        break;
      }
      case EVENT.TOOL_RESULT: {
        const ok = event.ok !== false;
        const color = ok ? this.tintFor(path.color, event.model) : new THREE.Color(PALETTE.error);
        this.spawn(from, to, color, { size: ok ? 13 : 16, intensity: ok ? 0.95 : 1, sessionId: sid });
        if (!ok) this.regions.flashRegion('parietal', PALETTE.error, 700);
        break;
      }
      case EVENT.SESSION_IDLE: {
        this.spawn(from, to, this.tintFor(path.color, event.model), { size: 12, intensity: 0.8, sessionId: sid });
        this.regions.flashRegion('temporal', PALETTE.ret, 900);
        break;
      }
      case EVENT.SESSION_ERROR: {
        this.burst(from, PALETTE.error, 24, sid);
        this.shockwave(from, PALETTE.error);
        this.regions.flashRegion('brainstem', PALETTE.error, 1200);
        break;
      }
      case EVENT.SESSION_FILE: {
        this.spawn(this.anchors.temporal, this.anchors.brainstem, PALETTE.internal, { size: 11, intensity: 0.7, sessionId: sid });
        break;
      }
      default:
        break;
    }
  }

  /** Radial particle burst at a position. */
  private burst(at: THREE.Vector3, color: number, count: number, sessionId?: string): void {
    for (let i = 0; i < count; i++) {
      const dir = new THREE.Vector3(
        Math.random() * 2 - 1,
        Math.random() * 2 - 1,
        Math.random() * 2 - 1,
      ).normalize().multiplyScalar(70 + Math.random() * 130);
      this.spawn(at, at.clone().add(dir), color, {
        size: 9 + Math.random() * 8,
        duration: 0.55 + Math.random() * 0.75,
        straight: true,
        sessionId,
      });
    }
  }

  /** Expanding ring at a position (error emphasis). */
  private shockwave(at: THREE.Vector3, color: number): void {
    const wave = this.shockwaves.find((w) => !w.active) || this.shockwaves[0];
    wave.active = true;
    wave.age = 0;
    wave.sprite.position.copy(at);
    wave.sprite.visible = true;
    wave.material.color.set(color);
    wave.material.opacity = 0.8;
    wave.sprite.scale.setScalar(24);
  }

  /* ---------------------------- per frame ---------------------------- */

  update(dt: number, _t: number): void {
    for (const imp of this.pool) {
      if (!imp.active) continue;

      if (!this.paused) imp.age += dt;
      if (imp.age < 0) continue; // still delayed

      const u = imp.age / imp.duration;
      if (u >= 1) {
        if (!this.paused) {
          imp.active = false;
          imp.head.visible = false;
          imp.material.opacity = 0;
          for (const g of imp.ghosts) g.visible = false;
          continue;
        }
        imp.material.opacity = 0;
        continue;
      }

      this.place(imp, imp.head, u);
      const fadeIn = ease(u, 0, 0.12);
      const fadeOut = 1 - ease(u, 0.7, 1);
      const alpha = fadeIn * fadeOut;
      const dim = this.highlight ? (imp.sessionId === this.highlight ? 1 : 0.22) : 1;
      imp.material.opacity = alpha * 0.95 * this.fade * dim;

      const headScale = imp.size * (0.4 + 0.6 * fadeIn) * (1 - 0.35 * ease(u, 0.75, 1));
      imp.head.scale.setScalar(headScale);
      imp.head.visible = true;

      for (let g = 0; g < imp.ghosts.length; g++) {
        const ug = u - 0.055 * (g + 1);
        const ghost = imp.ghosts[g];
        if (ug <= 0 || ug >= 1) {
          ghost.visible = false;
          continue;
        }
        ghost.visible = true;
        this.place(imp, ghost, ug);
        ghost.scale.setScalar(headScale * (0.5 - g * 0.16));
      }
    }

    // Shockwaves — expanding error rings.
    for (const wave of this.shockwaves) {
      if (!wave.active) continue;
      if (!this.paused) wave.age += dt;
      const u = wave.age / wave.duration;
      if (u >= 1) {
        if (!this.paused) {
          wave.active = false;
          wave.sprite.visible = false;
          wave.material.opacity = 0;
        }
        continue;
      }
      const scale = 24 + (wave.maxScale - 24) * ease(u, 0, 1);
      wave.sprite.scale.setScalar(scale);
      wave.material.opacity = (1 - u) * 0.8 * this.fade;
    }

    // Idle ambience — a faint internal pulse keeps the brain alive.
    if (!this.paused) {
      const now = performance.now();
      if (now - this.lastSpawnAt > 4200 && Math.random() < dt * 0.35) {
        this.spawn(this.anchors.brainstem, this.anchors.frontal, PALETTE.internal, {
          size: 10,
          intensity: 0.4,
          duration: 2.4,
        });
      }
    }
  }

  private place(imp: Impulse, sprite: THREE.Sprite, u: number): void {
    const a = (1 - u) * (1 - u);
    const b = 2 * (1 - u) * u;
    const c = u * u;
    sprite.position.set(
      a * imp.from.x + b * imp.control.x + c * imp.to.x,
      a * imp.from.y + b * imp.control.y + c * imp.to.y,
      a * imp.from.z + b * imp.control.z + c * imp.to.z,
    );
  }
}
