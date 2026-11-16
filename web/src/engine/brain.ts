/**
 * brain.ts — the central neural cloud.
 *
 * Three GPU-instanced sprite clouds (brain / halo / starfield). Native
 * THREE.Points render as 1-pixel primitives on WebGPU (point-list topology —
 * no gl_PointSize in WebGPU), so each cloud is ONE THREE.Sprite driven by
 * instanced buffer attributes (position / size / color), exactly as three's
 * own PointsNodeMaterial docs prescribe:
 *
 *   const instancedPoints = new THREE.Sprite(
 *     new THREE.PointsNodeMaterial({ positionNode: instancedBufferAttribute(...) })
 *   );
 *
 * `sprite.count` drives the instance count (three's getDrawParameters reads
 * `object.count`). The brain cloud is a two-lobed ellipsoid shell with
 * sinusoidal fold noise; colors run deep violet (interior) → cyan (surface)
 * with occasional bright sparkles.
 */
import * as THREE from 'three/webgpu';
import { instancedBufferAttribute, texture, uniform, uv, vec2, vec4 } from 'three/tsl';
import { makeGlowTexture } from './engine.js';

const BRAIN_COUNT = 44_000;
const HALO_COUNT = 3_800;
const STAR_COUNT = 1_400;

const RADII = { rx: 128, ry: 96, rz: 152, lobeOffset: 46 };

const DEEP = new THREE.Color(0x2a1466);
const CYAN = new THREE.Color(0x00d4ff);
const HALO = new THREE.Color(0x2f6dff);
const STAR = new THREE.Color(0x9fc8ff);
const SPARKLE = new THREE.Color(0xd9fbff);

export interface Brain {
  group: THREE.Group;
  update(dt: number, t: number): void;
  /** Global opacity multiplier (mode crossfades). */
  setFade(v: number): void;
  setVisible(v: boolean): void;
}

interface InstancedSprite extends THREE.Sprite {
  count: number;
}

interface Sample {
  x: number; y: number; z: number;
  r: number; g: number; b: number; a: number;
  size: number;
}

function buildCloud(
  count: number,
  sample: (i: number, out: Sample) => void,
  sizeAttenuation: boolean,
): CloudHandle {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 4);
  const sizes = new Float32Array(count);
  const out: Sample = { x: 0, y: 0, z: 0, r: 0, g: 0, b: 0, a: 1, size: 3 };

  for (let i = 0; i < count; i++) {
    out.r = 1; out.g = 1; out.b = 1; out.a = 1; out.size = 3;
    sample(i, out);
    positions[i * 3] = out.x;
    positions[i * 3 + 1] = out.y;
    positions[i * 3 + 2] = out.z;
    colors[i * 4] = out.r;
    colors[i * 4 + 1] = out.g;
    colors[i * 4 + 2] = out.b;
    colors[i * 4 + 3] = out.a;
    sizes[i] = out.size;
  }

  const glow = makeGlowTexture();
  const fade = uniform(1);
  const material = new THREE.PointsNodeMaterial();
  material.positionNode = instancedBufferAttribute(new THREE.InstancedBufferAttribute(positions, 3), 'vec3' as const);
  material.sizeNode = vec2(instancedBufferAttribute(new THREE.InstancedBufferAttribute(sizes, 1), 'float' as const));
  material.colorNode = instancedBufferAttribute(
    new THREE.InstancedBufferAttribute(colors, 4),
    'vec4' as const,
  ).mul(texture(glow, uv())).mul(fade);
  material.sizeAttenuation = sizeAttenuation;
  material.transparent = true;
  material.blending = THREE.AdditiveBlending;
  material.depthWrite = false;

  const sprite = new THREE.Sprite(material) as InstancedSprite;
  sprite.count = count;
  sprite.frustumCulled = false;
  return { sprite, fade };
}

interface CloudHandle {
  sprite: InstancedSprite;
  fade: { value: number };
}

/** Two-lobed brain shell (44k points). */
function buildBrainCloud(): CloudHandle {
  const tmp = new THREE.Color();
  return buildCloud(
    BRAIN_COUNT,
    (i, s) => {
      // Uniform direction on the sphere.
      const u = Math.random() * 2 - 1;
      const phi = Math.random() * Math.PI * 2;
      const r2 = Math.sqrt(1 - u * u);
      const dx = r2 * Math.cos(phi);
      const dy = u;
      const dz = r2 * Math.sin(phi);

      const lobe = i % 2 === 0 ? 1 : -1;

      // Fold noise + shell thickness (hollow-ish: r in [0.8, 1.08]).
      const fold =
        0.09 * Math.sin(dx * 7.1 + dz * 4.3) * Math.sin(dy * 6.4) +
        0.05 * Math.sin(phi * 9.0);
      const r = (1 + fold) * (0.8 + Math.random() * 0.28);

      let px = dx * RADII.rx * r + lobe * RADII.lobeOffset * (0.88 + 0.12 * r);
      let py = dy * RADII.ry * r * 0.94;
      const pz = dz * RADII.rz * r;

      // Flatten the underside slightly; thin out the central groove.
      if (py < -40) py *= 0.88;
      if (Math.abs(px) < 7 && Math.random() < 0.6) px += lobe * 10;

      s.x = px; s.y = py; s.z = pz;

      // Color: interior -> surface, plus rare bright sparkles.
      const depth = THREE.MathUtils.clamp((r - 0.78) / 0.32, 0, 1);
      tmp.copy(DEEP).lerp(CYAN, depth * depth);
      let size = 1.9 + Math.random() * 1.6;
      if (Math.random() < 0.055) {
        tmp.copy(SPARKLE);
        size += 2.4;
      }
      tmp.multiplyScalar(0.5 + Math.random() * 0.55);
      s.r = tmp.r; s.g = tmp.g; s.b = tmp.b;
      s.a = 0.55 + Math.random() * 0.45;
      s.size = size;
    },
    true,
  );
}

/** Sparse outer halo around the brain. */
function buildHalo(): CloudHandle {
  const tmp = new THREE.Color();
  return buildCloud(
    HALO_COUNT,
    (_i, s) => {
      const u = Math.random() * 2 - 1;
      const phi = Math.random() * Math.PI * 2;
      const r2 = Math.sqrt(1 - u * u);
      const r = 1.3 + Math.random() * 0.5;
      s.x = r2 * Math.cos(phi) * RADII.rx * r;
      s.y = u * RADII.ry * r;
      s.z = r2 * Math.sin(phi) * RADII.rz * r;
      tmp.copy(HALO).multiplyScalar(0.22 + Math.random() * 0.38);
      s.r = tmp.r; s.g = tmp.g; s.b = tmp.b;
      s.a = 0.18 + Math.random() * 0.3;
      s.size = 2.2 + Math.random() * 3.4;
    },
    true,
  );
}

/** Distant starfield (pixel-sized, no attenuation). */
function buildStars(): CloudHandle {
  const tmp = new THREE.Color();
  return buildCloud(
    STAR_COUNT,
    (_i, s) => {
      const u = Math.random() * 2 - 1;
      const phi = Math.random() * Math.PI * 2;
      const r2 = Math.sqrt(1 - u * u);
      const r = 1400 + Math.random() * 1200;
      s.x = r2 * Math.cos(phi) * r;
      s.y = u * r;
      s.z = r2 * Math.sin(phi) * r;
      tmp.copy(STAR).multiplyScalar(0.25 + Math.random() * 0.65);
      s.r = tmp.r; s.g = tmp.g; s.b = tmp.b;
      s.a = 0.35 + Math.random() * 0.5;
      s.size = 1.4 + Math.random() * 1.2;
    },
    false,
  );
}

export function createBrain(scene: THREE.Scene): Brain {
  const group = new THREE.Group();

  const brain = buildBrainCloud();
  const halo = buildHalo();
  const stars = buildStars();
  group.add(brain.sprite, halo.sprite, stars.sprite);

  scene.add(group);

  const fades = [brain.fade, halo.fade, stars.fade];
  let wobble = 0;
  let breathe = 0;

  return {
    group,
    setFade(v) {
      for (const f of fades) f.value = v;
    },
    setVisible(v) {
      group.visible = v;
    },
    update(dt, t) {
      wobble += dt;
      breathe += dt;
      brain.sprite.rotation.y = Math.sin(wobble * 0.11) * 0.07;
      brain.sprite.rotation.x = Math.sin(wobble * 0.07) * 0.03;
      const scale = 1 + Math.sin(breathe * 0.5) * 0.006;
      group.scale.setScalar(scale);
      // stars drift slowly + slight parallax
      stars.sprite.rotation.y += dt * 0.004;
      stars.sprite.rotation.x = Math.sin(t * 0.02) * 0.025;
    },
  };
}
