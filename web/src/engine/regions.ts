/**
 * regions.ts — the six brain-region anchors.
 *
 * Each region is (a) a glowing additive sprite orb sitting in the cloud and
 * (b) an HTML label projected to its screen position every frame. Regions
 * pulse gently and can flash in a color when events touch them
 * (impulses.ts calls flashRegion).
 */
import * as THREE from 'three/webgpu';
import { makeGlowTexture, makeRingTexture } from './engine.js';

export type RegionName =
  | 'frontal'
  | 'temporal'
  | 'parietal'
  | 'occipital'
  | 'cerebellum'
  | 'brainstem';

interface RegionDef {
  name: RegionName;
  label: string;
  pos: THREE.Vector3;
  tint: number;
}

const BASE_TINT = 0x7ab8ff;

const DEFS: RegionDef[] = [
  { name: 'frontal',    label: 'frontal · agents',      pos: new THREE.Vector3(0, 62, 168),   tint: 0x9db8ff },
  { name: 'temporal',   label: 'temporal · sessions',   pos: new THREE.Vector3(150, -30, 26), tint: 0x5fd7ff },
  { name: 'parietal',   label: 'parietal · mcp',        pos: new THREE.Vector3(-10, 108, -52), tint: 0x8f9dff },
  { name: 'occipital',  label: 'occipital · output',    pos: new THREE.Vector3(-30, 12, -172), tint: 0xb08cff },
  { name: 'cerebellum', label: 'cerebellum · skills',   pos: new THREE.Vector3(-92, -84, -108), tint: 0x7ae0c8 },
  { name: 'brainstem',  label: 'brainstem · runtime',   pos: new THREE.Vector3(0, -148, 4),    tint: 0x86f2ff },
];

interface OrbState {
  def: RegionDef;
  sprite: THREE.Sprite;
  material: THREE.SpriteMaterial;
  baseTint: THREE.Color;
  flash: { color: THREE.Color; until: number } | null;
  labelEl: HTMLElement;
  phase: number;
}

export interface Regions {
  anchors: Record<RegionName, THREE.Vector3>;
  /** Sprites exposed for CPU raycasting (click-to-focus). */
  pickables: THREE.Sprite[];
  update(dt: number, t: number, camera: THREE.Camera, size: { w: number; h: number }): void;
  flashRegion(name: RegionName, colorHex: number, holdMs?: number): void;
  /** Global opacity multiplier (mode crossfades). */
  setFade(v: number): void;
  setVisible(v: boolean): void;
  /** Analytics heat: 0..1 activity share per region swells its orb. */
  setActivityShare(share: Partial<Record<RegionName, number>> | null): void;
  /** Payload pressure ring at the temporal anchor (worst live session). */
  setPressure(pressure: { ratio: number } | null): void;
}

export function createRegions(scene: THREE.Scene, labelsRoot: HTMLElement): Regions {
  const glow = makeGlowTexture();
  const group = new THREE.Group();
  const orbs: OrbState[] = [];
  const anchors = {} as Record<RegionName, THREE.Vector3>;

  for (const def of DEFS) {
    const material = new THREE.SpriteMaterial({
      map: glow,
      color: def.tint,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(material);
    sprite.position.copy(def.pos);
    sprite.scale.setScalar(34);
    group.add(sprite);

    const labelEl = document.createElement('div');
    labelEl.className = 'region-label';
    labelEl.textContent = def.label;
    labelsRoot.appendChild(labelEl);

    orbs.push({
      def,
      sprite,
      material,
      baseTint: new THREE.Color(def.tint),
      flash: null,
      labelEl,
      phase: Math.random() * Math.PI * 2,
    });
    anchors[def.name] = def.pos.clone();
  }

  scene.add(group);

  // Payload pressure ring (trim-threshold guard) at the temporal anchor.
  const pressureMat = new THREE.SpriteMaterial({
    map: makeRingTexture(),
    color: 0x00d4ff,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const pressureSprite = new THREE.Sprite(pressureMat);
  pressureSprite.position.copy(anchors.temporal);
  pressureSprite.scale.setScalar(0.001);
  pressureSprite.visible = false;
  group.add(pressureSprite);

  const projected = new THREE.Vector3();
  let fade = 1;
  let visible = true;
  let activity: Partial<Record<RegionName, number>> | null = null;
  let pressure: { ratio: number } | null = null;

  const PRESSURE_SHOW = 0.4; // below this, ring stays hidden

  return {
    anchors,
    pickables: orbs.map((o) => o.sprite),

    setActivityShare(share) {
      activity = share;
    },

    setPressure(p) {
      pressure = p;
    },

    setFade(v) {
      fade = THREE.MathUtils.clamp(v, 0, 1);
    },

    setVisible(v) {
      visible = v;
      group.visible = v;
      if (!v) {
        for (const orb of orbs) orb.labelEl.style.display = 'none';
      }
    },

    flashRegion(name, colorHex, holdMs = 900) {
      const orb = orbs.find((o) => o.def.name === name);
      if (!orb) return;
      orb.flash = { color: new THREE.Color(colorHex), until: performance.now() + holdMs };
      orb.labelEl.classList.add('flash');
      orb.labelEl.style.setProperty('--flash-color', `#${colorHex.toString(16).padStart(6, '0')}`);
      setTimeout(() => orb.labelEl.classList.remove('flash'), holdMs);
    },

    update(_dt, t, camera, size) {
      if (!visible) return;
      const now = performance.now();

      // Pressure ring: scale + color encode payload proximity to the trim cap.
      if (pressure && pressure.ratio > PRESSURE_SHOW) {
        const r = THREE.MathUtils.clamp(pressure.ratio, 0, 1.1);
        const pulse = 1 + Math.sin(t * 2.4) * 0.06;
        pressureSprite.visible = true;
        pressureSprite.scale.setScalar((58 + r * 130) * pulse);
        const c = pressureMat.color;
        if (r < 0.7) {
          c.setHex(0x00d4ff).lerp(new THREE.Color(0xffb020), (r - PRESSURE_SHOW) / (0.7 - PRESSURE_SHOW));
        } else {
          c.setHex(0xffb020).lerp(new THREE.Color(0xff0044), (r - 0.7) / 0.4);
        }
        pressureMat.opacity = (0.2 + 0.4 * r) * fade;
      } else if (pressureSprite.visible) {
        pressureSprite.visible = false;
        pressureMat.opacity = 0;
      }
      for (const orb of orbs) {
        // Gentle independent pulse + analytics activity swell.
        const pulse = 1 + Math.sin(t * 1.1 + orb.phase) * 0.09;
        const heat = 1 + (activity?.[orb.def.name] ?? 0) * 0.75;
        orb.sprite.scale.setScalar(34 * pulse * heat);

        // Color: flash lerp or base pulse.
        if (orb.flash && now < orb.flash.until) {
          orb.material.color.copy(orb.flash.color);
          orb.material.opacity = 0.95 * fade;
        } else {
          orb.flash = null;
          orb.material.color.copy(orb.baseTint).multiplyScalar(0.82 + Math.sin(t * 0.9 + orb.phase) * 0.14);
          orb.material.opacity = (0.5 + Math.sin(t * 0.8 + orb.phase) * 0.1) * fade;
        }

        // Project label.
        projected.copy(orb.def.pos).project(camera);
        const visible = projected.z < 1 && projected.z > -1;
        if (!visible) {
          orb.labelEl.style.display = 'none';
          continue;
        }
        orb.labelEl.style.display = '';
        const x = (projected.x * 0.5 + 0.5) * size.w;
        const y = (-projected.y * 0.5 + 0.5) * size.h;
        orb.labelEl.style.left = `${x.toFixed(1)}px`;
        orb.labelEl.style.top = `${(y + 30).toFixed(1)}px`;
        // Fade with depth toward edges of the screen + global fade.
        const edge = Math.min(1, (1 - Math.abs(projected.x)) * 2.4);
        orb.labelEl.style.opacity = ((0.28 + 0.72 * edge) * fade).toFixed(2);
      }
    },
  };
}

export { BASE_TINT };
