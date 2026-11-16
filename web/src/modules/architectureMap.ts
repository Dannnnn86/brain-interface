/**
 * architectureMap.ts — the Architecture Map: the whole opencode system as a
 * navigable constellation.
 *
 * Six concentric rings (providers → models → agents → skills → MCP servers →
 * plugins) around a central hub, laid out deterministically in the XZ plane
 * with a gentle group spin. Nodes render as ONE instanced-sprite cloud (the
 * same pattern as brain.ts); edges render as one additive LineSegments with
 * per-vertex colors. Node picking is CPU-side (project + nearest-screen-point),
 * which is trivial at ~180 nodes and avoids raycasting an instanced sprite.
 *
 * A LayoutEngine seam is kept conceptually: swap `layout()` for a compute
 * shader implementation when node counts exceed ~1k (spec §3.5).
 */
import * as THREE from 'three/webgpu';
import { instancedBufferAttribute, texture, uniform, uv, vec2, vec4 } from 'three/tsl';
import { makeGlowTexture } from '../engine/engine.js';
import type { SystemState } from '@shared/protocol.js';

export type MapNodeKind = 'hub' | 'provider' | 'model' | 'agent' | 'skill' | 'mcp' | 'plugin';

export const MAP_KINDS: MapNodeKind[] = ['provider', 'model', 'agent', 'skill', 'mcp', 'plugin'];

export interface MapNode {
  index: number;
  id: string;
  kind: MapNodeKind;
  label: string;
  color: THREE.Color;
  baseColor: THREE.Color;
  size: number;
  pos: THREE.Vector3;       // local space (ring layout)
  data: Record<string, unknown>;
}

interface MapEdge {
  a: number;
  b: number;
  color: THREE.Color;
}

const RING_RADIUS: Record<MapNodeKind | 'hub', number> = {
  hub: 0,
  provider: 82,
  model: 132,
  agent: 172,
  skill: 218,
  mcp: 254,
  plugin: 282,
};

const NODE_SIZE: Record<MapNodeKind | 'hub', number> = {
  hub: 30,
  provider: 22,
  model: 13,
  agent: 17,
  skill: 8,
  mcp: 15,
  plugin: 14,
};

const KIND_COLOR: Record<MapNodeKind | 'hub', number> = {
  hub: 0xaad4ff,
  provider: 0x4d6bfe,
  model: 0x8fa8ff,
  agent: 0xb84aff,
  skill: 0x7ae0c8,
  mcp: 0xff9d4d,
  plugin: 0xff7ab8,
};

/** Provider id → brand-ish color (matches the HUD model-dot palette). */
export function providerColor(id: string, name: string): number {
  const s = `${id} ${name}`.toLowerCase();
  if (s.includes('nvidia') || s.includes('nim') || s.includes('nemotron')) return 0x76b900;
  if (s.includes('anthropic') || s.includes('claude')) return 0xd4a5ff;
  if (s.includes('google') || s.includes('gemini')) return 0x4285f4;
  if (s.includes('ollama') || s.includes('local')) return 0xff9500;
  if (s.includes('openai') || s.includes('gpt')) return 0x74aa9c;
  if (s.includes('deepseek')) return 0x4d6bfe;
  if (s.includes('glm') || s.includes('z-ai') || s.includes('cerebras') || s.includes('groq')) return 0x00c896;
  if (s.includes('harbor') || s.includes('route') || s.includes('free')) return 0xf2b84b;
  // deterministic fallback from the id hash
  const palette = [0x5fd7ff, 0xff6b8a, 0x9d8cff, 0x59d98a, 0xf2b84b, 0xff9dc1];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

/* ------------------------------------------------------------------ */

export interface PickResult {
  node: MapNode;
  screenX: number;
  screenY: number;
}

export interface FlyTarget {
  position: THREE.Vector3;
  target: THREE.Vector3;
}

export class ArchitectureMap {
  readonly group = new THREE.Group();

  private nodes: MapNode[] = [];
  private edges: MapEdge[] = [];
  private hiddenKinds = new Set<MapNodeKind>();
  private hovered: MapNode | null = null;
  private selected: MapNode | null = null;

  private nodesSprite: THREE.Sprite | null = null;
  private sizesAttr: THREE.InstancedBufferAttribute | null = null;
  private colorsAttr: THREE.InstancedBufferAttribute | null = null;
  private baseColors: Float32Array | null = null;
  private edgesMesh: THREE.LineSegments | null = null;
  private fade = uniform(1);

  private labels = new Map<MapNode, HTMLElement>();
  private labelsRoot: HTMLElement;
  private skillUsage = new Map<string, number>();
  private usageMax = 1;

  constructor(labelsRoot: HTMLElement) {
    this.labelsRoot = labelsRoot;
    this.group.rotation.x = -0.3; // lay the rings back like a star chart
    this.group.visible = false;
  }

  /* ------------------------------ build ------------------------------ */

  build(state: SystemState): void {
    this.disposeScene();
    const nodes: MapNode[] = [];
    const edges: MapEdge[] = [];
    const add = (
      kind: MapNodeKind | 'hub',
      id: string,
      label: string,
      pos: THREE.Vector3,
      color: number,
      data: Record<string, unknown> = {},
      sizeMul = 1,
    ): MapNode => {
      const node: MapNode = {
        index: nodes.length,
        id,
        kind: kind as MapNodeKind,
        label,
        color: new THREE.Color(color),
        baseColor: new THREE.Color(color),
        size: (NODE_SIZE[kind] ?? 10) * sizeMul,
        pos,
        data,
      };
      nodes.push(node);
      return node;
    };

    const ringPos = (kind: MapNodeKind, angle: number, jitter = 10): THREE.Vector3 =>
      new THREE.Vector3(
        Math.cos(angle) * RING_RADIUS[kind],
        (Math.random() - 0.5) * jitter,
        Math.sin(angle) * RING_RADIUS[kind],
      );

    // Hub
    const hub = add('hub', 'hub', 'opencode', new THREE.Vector3(0, 0, 0), KIND_COLOR.hub, {}, 1);

    // Providers (uniform ring) + models (clustered near their provider)
    const providers = state.providers ?? [];
    providers.forEach((p, i) => {
      const angle = (i / Math.max(1, providers.length)) * Math.PI * 2 - Math.PI / 2;
      const dim = p.disabled ? 0.4 : 1;
      const color = providerColor(p.id, p.name);
      const pNode = add('provider', `provider:${p.id}`, p.name || p.id, ringPos('provider', angle), color, {
        models: p.models,
        disabled: p.disabled === true,
      });
      pNode.color.multiplyScalar(p.disabled ? 0.45 : 1);
      edges.push({ a: hub.index, b: pNode.index, color: new THREE.Color(color).multiplyScalar(0.5 * dim) });

      const models = p.models ?? [];
      const spread = Math.min(0.6, models.length * 0.055);
      models.forEach((m, j) => {
        const mAngle = angle + (models.length > 1 ? (j / (models.length - 1) - 0.5) * spread : 0);
        const mNode = add('model', `model:${p.id}/${m}`, m, ringPos('model', mAngle, 14), color, {
          provider: p.name || p.id,
        });
        mNode.color.multiplyScalar(0.72);
        edges.push({ a: pNode.index, b: mNode.index, color: new THREE.Color(color).multiplyScalar(0.3 * dim) });
      });
    });

    // Agents (uniform)
    const agents = state.agents ?? [];
    agents.forEach((a, i) => {
      const angle = (i / Math.max(1, agents.length)) * Math.PI * 2 - Math.PI / 2 + 0.3;
      const n = add('agent', `agent:${a}`, a, ringPos('agent', angle), KIND_COLOR.agent, {});
      edges.push({ a: hub.index, b: n.index, color: new THREE.Color(KIND_COLOR.agent).multiplyScalar(0.34) });
    });

    // Skills (uniform, dense ring — hub edges very dim so the fan reads as texture)
    const skills = state.skills?.names ?? [];
    skills.forEach((s, i) => {
      const angle = (i / Math.max(1, skills.length)) * Math.PI * 2;
      const n = add('skill', `skill:${s}`, s, ringPos('skill', angle, 8), KIND_COLOR.skill, {});
      edges.push({ a: hub.index, b: n.index, color: new THREE.Color(KIND_COLOR.skill).multiplyScalar(0.05) });
    });

    // MCP servers (uniform; disabled dimmed)
    const mcps = state.mcpServers ?? [];
    mcps.forEach((m, i) => {
      const angle = (i / Math.max(1, mcps.length)) * Math.PI * 2 + 0.15;
      const n = add('mcp', `mcp:${m.name}`, m.name, ringPos('mcp', angle), KIND_COLOR.mcp, {
        type: m.type,
        enabled: m.enabled,
      });
      if (!m.enabled) n.color.multiplyScalar(0.35);
      edges.push({
        a: hub.index,
        b: n.index,
        color: new THREE.Color(KIND_COLOR.mcp).multiplyScalar(m.enabled ? 0.3 : 0.1),
      });
    });

    // Plugins (uniform)
    const plugins = state.plugins ?? [];
    plugins.forEach((p, i) => {
      const angle = (i / Math.max(1, plugins.length)) * Math.PI * 2 + 0.7;
      const label = String(p).split(/[\\/]/).filter(Boolean).pop() || String(p);
      const n = add('plugin', `plugin:${p}`, label, ringPos('plugin', angle), KIND_COLOR.plugin, { path: String(p) });
      edges.push({ a: hub.index, b: n.index, color: new THREE.Color(KIND_COLOR.plugin).multiplyScalar(0.3) });
    });

    this.nodes = nodes;
    this.edges = edges;
    this.buildNodeSprite();
    this.rebuildEdges();
    this.buildLabels();
    this.applyKindVisibility();
    this.applyUsageVisuals();
  }

  private buildNodeSprite(): void {
    const count = this.nodes.length;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 4);
    const sizes = new Float32Array(count);
    this.nodes.forEach((n, i) => {
      positions[i * 3] = n.pos.x;
      positions[i * 3 + 1] = n.pos.y;
      positions[i * 3 + 2] = n.pos.z;
      colors[i * 4] = n.color.r;
      colors[i * 4 + 1] = n.color.g;
      colors[i * 4 + 2] = n.color.b;
      colors[i * 4 + 3] = 1;
      sizes[i] = n.size;
    });

    const glow = makeGlowTexture();
    const material = new THREE.PointsNodeMaterial();
    material.positionNode = instancedBufferAttribute(new THREE.InstancedBufferAttribute(positions, 3), 'vec3' as const);
    this.sizesAttr = new THREE.InstancedBufferAttribute(sizes, 1);
    this.colorsAttr = new THREE.InstancedBufferAttribute(colors, 4);
    this.baseColors = colors.slice();
    material.sizeNode = vec2(instancedBufferAttribute(this.sizesAttr, 'float' as const));
    material.colorNode = instancedBufferAttribute(
      this.colorsAttr,
      'vec4' as const,
    ).mul(texture(glow, uv())).mul(this.fade);
    material.sizeAttenuation = true;
    material.transparent = true;
    material.blending = THREE.AdditiveBlending;
    material.depthWrite = false;

    const sprite = new THREE.Sprite(material) as THREE.Sprite & { count: number };
    sprite.count = count;
    sprite.frustumCulled = false;
    this.nodesSprite = sprite;
    this.group.add(sprite);
  }

  private rebuildEdges(): void {
    if (this.edgesMesh) {
      this.group.remove(this.edgesMesh);
      this.edgesMesh.geometry.dispose();
      this.edgesMesh = null;
    }
    const visibleEdges = this.edges.filter(
      (e) => !this.hiddenKinds.has(this.nodes[e.a].kind) && !this.hiddenKinds.has(this.nodes[e.b].kind),
    );
    const positions = new Float32Array(visibleEdges.length * 6);
    const colors = new Float32Array(visibleEdges.length * 6);
    visibleEdges.forEach((e, i) => {
      const a = this.nodes[e.a].pos;
      const b = this.nodes[e.b].pos;
      positions.set([a.x, a.y, a.z, b.x, b.y, b.z], i * 6);
      colors.set([e.color.r, e.color.g, e.color.b, e.color.r, e.color.g, e.color.b], i * 6);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const mesh = new THREE.LineSegments(geo, mat);
    mesh.frustumCulled = false;
    this.edgesMesh = mesh;
    this.group.add(mesh);
  }

  private buildLabels(): void {
    for (const el of this.labels.values()) el.remove();
    this.labels.clear();
    // Label divs are created for every node but only styled while active
    // (hub, providers, hovered, selected) — 15-ish projections per frame.
    for (const node of this.nodes) {
      const el = document.createElement('div');
      el.className = 'map-label';
      el.textContent = node.label;
      el.style.display = 'none';
      this.labelsRoot.appendChild(el);
      this.labels.set(node, el);
    }
  }

  /* ---------------------------- filtering ---------------------------- */

  setKindVisible(kind: MapNodeKind, visible: boolean): void {
    if (visible) this.hiddenKinds.delete(kind);
    else this.hiddenKinds.add(kind);
    this.applyKindVisibility();
    this.rebuildEdges();
  }

  isKindVisible(kind: MapNodeKind): boolean {
    return !this.hiddenKinds.has(kind);
  }

  private applyKindVisibility(): void {
    if (!this.sizesAttr) return;
    this.nodes.forEach((n, i) => {
      this.sizesAttr!.setX(i, this.hiddenKinds.has(n.kind) ? 0 : this.sizeFor(n));
    });
    this.sizesAttr.needsUpdate = true;
  }

  private sizeFor(node: MapNode): number {
    let size = node.size;
    if (node.kind === 'skill') size *= this.usageMultiplier(node.label);
    if (node === this.hovered || node === this.selected) size *= 1.45;
    return size;
  }

  /** Skills swell by real invocation counts (from analytics). */
  private usageMultiplier(skillName: string): number {
    if (this.skillUsage.size === 0) return 1;
    const key = skillName.toLowerCase();
    let count = this.skillUsage.get(key) ?? 0;
    if (count === 0) {
      for (const [name, c] of this.skillUsage) {
        if (name.includes(key) || key.includes(name)) {
          count = Math.max(count, c);
          break;
        }
      }
    }
    if (count === 0) return 1;
    return 1 + Math.min(1, count / this.usageMax) * 0.9;
  }

  /** Feed skill invocation counts (lowercase names → counts). */
  setSkillUsage(usage: Map<string, number>): void {
    this.skillUsage = new Map();
    let max = 1;
    for (const [name, count] of usage) {
      const key = name.toLowerCase();
      this.skillUsage.set(key, (this.skillUsage.get(key) ?? 0) + count);
      max = Math.max(max, this.skillUsage.get(key)!);
    }
    this.usageMax = max;
    this.refreshSizes();
    this.applyUsageVisuals();
  }

  /** Unused skills dim once usage data exists (dead-skill detection). */
  private applyUsageVisuals(): void {
    if (!this.colorsAttr || !this.baseColors) return;
    const colors = this.colorsAttr.array as Float32Array;
    this.nodes.forEach((n, i) => {
      if (n.kind !== 'skill') return;
      const unused = this.skillUsage.size > 0 && this.usageMultiplier(n.label) <= 1;
      const dim = unused ? 0.28 : 1;
      colors[i * 4] = this.baseColors![i * 4] * dim;
      colors[i * 4 + 1] = this.baseColors![i * 4 + 1] * dim;
      colors[i * 4 + 2] = this.baseColors![i * 4 + 2] * dim;
      colors[i * 4 + 3] = 1;
    });
    this.colorsAttr.needsUpdate = true;
  }

  /* --------------------------- interaction --------------------------- */

  setHover(node: MapNode | null): void {
    if (node === this.hovered) return;
    this.hovered = node;
    this.refreshSizes();
  }

  setSelected(node: MapNode | null): void {
    if (node === this.selected) return;
    this.selected = node;
    this.refreshSizes();
  }

  get selectedNode(): MapNode | null {
    return this.selected;
  }

  private refreshSizes(): void {
    if (!this.sizesAttr) return;
    this.nodes.forEach((n, i) => {
      this.sizesAttr!.setX(i, this.hiddenKinds.has(n.kind) ? 0 : this.sizeFor(n));
    });
    this.sizesAttr.needsUpdate = true;
  }

  /** CPU picking: nearest visible node under the pointer (screen space). */
  pick(px: number, py: number, camera: THREE.Camera, size: { w: number; h: number }): PickResult | null {
    const v = new THREE.Vector3();
    let best: PickResult | null = null;
    let bestDist = Infinity;
    for (const node of this.nodes) {
      if (this.hiddenKinds.has(node.kind)) continue;
      v.copy(node.pos).applyMatrix4(this.group.matrixWorld).project(camera);
      if (v.z > 1 || v.z < -1) continue;
      const sx = (v.x * 0.5 + 0.5) * size.w;
      const sy = (-v.y * 0.5 + 0.5) * size.h;
      const dist = Math.hypot(px - sx, py - sy);
      const threshold = node.size * 0.9 + 14;
      if (dist < threshold && dist < bestDist) {
        bestDist = dist;
        best = { node, screenX: sx, screenY: sy };
      }
    }
    return best;
  }

  flyTargetFor(node: MapNode): FlyTarget {
    if (node.kind === 'hub') {
      return { position: new THREE.Vector3(0, 430, 470), target: new THREE.Vector3(0, 0, 0) };
    }
    const world = node.pos.clone().applyMatrix4(this.group.matrixWorld);
    const outward = new THREE.Vector3(world.x, 0, world.z).normalize();
    return {
      position: world.clone().add(outward.multiplyScalar(110)).add(new THREE.Vector3(0, 95, 70)),
      target: world.clone(),
    };
  }

  /** Detail rows for the HUD's detail panel. */
  infoFor(node: MapNode): { title: string; kind: MapNodeKind; rows: Array<[string, string]> } {
    const rows: Array<[string, string]> = [['type', node.kind]];
    switch (node.kind) {
      case 'hub':
        rows.push(['nodes', String(this.nodes.length)], ['edges', String(this.edges.length)]);
        break;
      case 'provider': {
        const models = (node.data.models as string[]) ?? [];
        rows.push(['models', String(models.length)]);
        if (node.data.disabled) rows.push(['status', 'disabled']);
        if (models.length) rows.push(['list', models.slice(0, 10).join(', ') + (models.length > 10 ? ' …' : '')]);
        break;
      }
      case 'model':
        rows.push(['provider', String(node.data.provider ?? '')]);
        break;
      case 'mcp':
        rows.push(['transport', String(node.data.type ?? '')], ['state', node.data.enabled ? 'enabled' : 'disabled (bridge-gated)']);
        break;
      case 'plugin':
        rows.push(['path', String(node.data.path ?? '')]);
        break;
      default:
        break;
    }
    return { title: node.label, kind: node.kind, rows };
  }

  nodeCount(): number {
    return this.nodes.length;
  }

  /* ------------------------------ render ------------------------------ */

  setFade(v: number): void {
    this.fade.value = THREE.MathUtils.clamp(v, 0, 1);
  }

  setVisible(v: boolean): void {
    this.group.visible = v;
    if (!v) {
      for (const el of this.labels.values()) el.style.display = 'none';
    }
  }

  update(dt: number, _t: number, camera: THREE.Camera, size: { w: number; h: number }): void {
    if (!this.group.visible) return;
    this.group.rotation.y += dt * 0.028;

    const active = new Set<MapNode>();
    if (this.hovered) active.add(this.hovered);
    if (this.selected) active.add(this.selected);
    for (const node of this.nodes) {
      if ((node.kind === 'provider' || node.kind === 'hub') && !this.hiddenKinds.has(node.kind)) {
        active.add(node);
      }
    }

    const v = new THREE.Vector3();
    for (const node of this.nodes) {
      const el = this.labels.get(node);
      if (!el) continue;
      if (!active.has(node)) {
        if (el.style.display !== 'none') el.style.display = 'none';
        continue;
      }
      v.copy(node.pos).applyMatrix4(this.group.matrixWorld).project(camera);
      if (v.z > 1 || v.z < -1) {
        el.style.display = 'none';
        continue;
      }
      const x = (v.x * 0.5 + 0.5) * size.w;
      const y = (-v.y * 0.5 + 0.5) * size.h;
      el.style.display = '';
      el.style.left = `${x.toFixed(1)}px`;
      el.style.top = `${(y + node.size * 0.9 + 14).toFixed(1)}px`;
      const emphasis = node === this.hovered || node === this.selected ? 'strong' : 'dim';
      if (el.dataset.emphasis !== emphasis) {
        el.dataset.emphasis = emphasis;
      }
    }
  }

  private disposeScene(): void {
    if (this.nodesSprite) {
      this.group.remove(this.nodesSprite);
      (this.nodesSprite.material as THREE.Material).dispose();
      this.nodesSprite = null;
    }
    if (this.edgesMesh) {
      this.group.remove(this.edgesMesh);
      this.edgesMesh.geometry.dispose();
      this.edgesMesh = null;
    }
    this.sizesAttr = null;
  }
}
