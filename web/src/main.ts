/**
 * main.ts — boot sequence + the brain/map mode manager.
 *
 * Modes:
 *   brain — the neural cloud (default): live impulses, region orbs, labels
 *   map   — the architecture constellation: providers/models/agents/skills/
 *           MCP/plugins rings with click-to-inspect
 *
 * Interactions: click region orbs (raycast) · click map nodes (CPU picking) ·
 * click session cards (focus + highlight) · keys 1-6 regions, Space pause,
 * Esc clear, M for map toggle · ?mode=map deep-links straight to the map.
 */
import './styles/main.css';
import * as THREE from 'three/webgpu';
import { animate } from 'animejs';
import { createEngine } from './engine/engine.js';
import { createBrain } from './engine/brain.js';
import { createRegions } from './engine/regions.js';
import type { RegionName } from './engine/regions.js';
import { ImpulseSystem } from './engine/impulses.js';
import { store } from './state/store.js';
import { connect, rpc } from './net/client.js';
import { Hud } from './ui/hud.js';
import { ArchitectureMap } from './modules/architectureMap.js';
import { ReplayEngine } from './modules/replayEngine.js';
import { ReplayPicker, TimelineBar, ReplayLog, frameToLogEntry } from './ui/replayUi.js';
import { AnalyticsPanel } from './ui/analyticsPanel.js';
import type { AnalyticsResponse, ReplayTimeline, SystemEvent, TimelineFrame } from '@shared/protocol.js';

type Mode = 'brain' | 'map' | 'replay';

const REGION_ORDER: RegionName[] = ['frontal', 'temporal', 'parietal', 'occipital', 'cerebellum', 'brainstem'];

const REGION_TITLES: Record<RegionName, string> = {
  frontal: 'frontal lobe · agents',
  temporal: 'temporal lobe · sessions',
  parietal: 'parietal lobe · mcp bridge',
  occipital: 'occipital lobe · output',
  cerebellum: 'cerebellum · skills',
  brainstem: 'brainstem · runtime',
};

async function boot(): Promise<void> {
  const canvas = document.getElementById('scene') as HTMLCanvasElement;
  const labelsRoot = document.getElementById('labels') as HTMLElement;

  const engine = await createEngine(canvas);
  console.info(`[brain] renderer backend: ${engine.backend}`);

  const brain = createBrain(engine.scene);
  const regions = createRegions(engine.scene, labelsRoot);
  const impulses = new ImpulseSystem(engine.scene, regions.anchors, regions);
  const map = new ArchitectureMap(labelsRoot);
  engine.scene.add(map.group);

  /* ---------------------------- replay stack ---------------------------- */

  const replay = new ReplayEngine();
  let replayActive = false; // a timeline is loaded
  let replayId: string | null = null;

  // Live events feed impulses only when no replay owns the scene.
  store.onFeedItem.push((event) => {
    if (!replayActive) impulses.onEvent(event);
  });

  replay.setClearSink(() => impulses.clearAll());
  replay.setFrameSink((frame: TimelineFrame) => {
    impulses.onEvent(frameToSystemEvent(frame));
    const entry = frameToLogEntry(frame);
    replayLog.push(entry);
  });
  replay.setStateSink((state) => timelineBar.setState(state));

  const hud = new Hud(engine);
  const picker = new ReplayPicker(hud.root);
  const timelineBar = new TimelineBar(hud.root);
  const replayLog = new ReplayLog(hud.root);
  const analyticsPanel = new AnalyticsPanel(hud.root);

  function frameToSystemEvent(frame: TimelineFrame): SystemEvent {
    return {
      type: frame.type,
      sessionId: replayId ?? 'replay',
      at: Date.now(),
      tool: frame.tool,
      argsSummary: frame.argsSummary,
      ok: frame.ok,
      durationMs: frame.durationMs,
      text: frame.text,
      error: frame.error,
    };
  }

  /* ------------------------- mode management ------------------------- */

  let mode: Mode = 'brain';
  let selectedSessionId: string | null = null;
  let lastBuiltAt = 0;

  const fades = { brain: 1, regions: 1, impulses: 1, map: 0 };
  const BRAIN_VIEW = { pos: new THREE.Vector3(40, 130, 420), target: new THREE.Vector3(0, -10, 0) };
  const MAP_VIEW = { pos: new THREE.Vector3(0, 430, 470), target: new THREE.Vector3(0, 0, 0) };

  function applyFades(): void {
    brain.setFade(fades.brain);
    regions.setFade(fades.regions);
    impulses.setFade(fades.impulses);
    map.setFade(fades.map);
    brain.setVisible(fades.brain > 0.01);
    regions.setVisible(fades.regions > 0.01);
    map.setVisible(fades.map > 0.01);
  }

  function fadeTo(targets: Partial<typeof fades>, ms = 480): void {
    animate(fades, {
      ...targets,
      duration: ms,
      ease: 'inOut(2)',
      onUpdate: applyFades,
      onComplete: applyFades,
    });
  }

  function applyMapData(force = false): void {
    const st = store.systemState;
    if (!st) return;
    if (!force && st.generatedAt === lastBuiltAt) return;
    lastBuiltAt = st.generatedAt;
    map.build(st);
  }

  /** Resolve once the WebSocket is live (URL deep-links race the connect). */
  function whenConnected(timeoutMs = 8000): Promise<boolean> {
    if (store.connection === 'live') return Promise.resolve(true);
    return new Promise((resolve) => {
      const started = Date.now();
      const unsub = store.subscribe(() => {
        if (store.connection === 'live') {
          unsub();
          resolve(true);
        } else if (Date.now() - started > timeoutMs) {
          unsub();
          resolve(false);
        }
      });
    });
  }

  function exitReplay(): void {
    replay.pause();
    replay.unload();
    replayActive = false;
    replayId = null;
    picker.hide();
    timelineBar.hide();
    replayLog.hide();
    replayLog.clear();
    impulses.setAmbient(true);
  }

  async function loadReplay(id: string): Promise<boolean> {
    try {
      if (!(await whenConnected())) throw new Error('no connection');
      const timeline = (await rpc('getTimeline', { id })) as ReplayTimeline;
      replayActive = true;
      replayId = id;
      replay.load(timeline);
      timelineBar.setTimeline(timeline);
      picker.hide();
      timelineBar.show();
      replayLog.show();
      replayLog.clear();
      return true;
    } catch (err) {
      console.warn('[brain] timeline load failed:', err);
      if (mode === 'replay') picker.show(store.sessions);
      return false;
    }
  }

  async function setMode(next: Mode): Promise<void> {
    if (next === mode) return;
    const wasReplay = mode === 'replay';
    mode = next;
    hud.setMode(next);
    hud.hideDetail();
    if (next === 'map') {
      if (wasReplay) exitReplay();
      applyMapData();
      // Refresh system state in the background; rebuild if it changed.
      rpc('getState')
        .then((res) => {
          const st = (res as { state?: import('@shared/protocol.js').SystemState })?.state;
          if (st) {
            store.applyState(st);
            if (mode === 'map') applyMapData(true);
          }
        })
        .catch(() => {});
      fadeTo({ brain: 0, regions: 0, impulses: 0, map: 1 });
      engine.flyTo(MAP_VIEW.pos, MAP_VIEW.target);
    } else if (next === 'replay') {
      map.setSelected(null);
      map.setHover(null);
      fadeTo({ brain: 1, regions: 1, impulses: 1, map: 0 });
      engine.flyTo(BRAIN_VIEW.pos, BRAIN_VIEW.target);
      impulses.setAmbient(false);
      if (replayActive && replay.timeline) {
        timelineBar.setTimeline(replay.timeline);
        timelineBar.show();
        replayLog.show();
      } else {
        picker.show(store.sessions);
      }
    } else {
      if (wasReplay) exitReplay();
      map.setSelected(null);
      map.setHover(null);
      fadeTo({ brain: 1, regions: 1, impulses: 1, map: 0 });
      engine.flyTo(BRAIN_VIEW.pos, BRAIN_VIEW.target);
    }
  }

  /* --------------------------- hud wiring --------------------------- */

  hud.onModeChange = (m) => void setMode(m as Mode);
  hud.onSessionSelect = (id) => focusSession(id);
  hud.setMode(mode); // mark the default mode button active at boot

  picker.onPick = (id) => void loadReplay(id);
  picker.onClose = () => void setMode('brain');
  timelineBar.onPlayToggle = () => replay.toggle();
  timelineBar.onSpeed = (s) => replay.setSpeed(s);
  timelineBar.onSeek = (t) => replay.seek(t);
  timelineBar.onStep = (dir) => replay.step(dir);
  timelineBar.onClose = () => void setMode('brain');

  /* --------------------------- analytics --------------------------- */

  let analyticsData: AnalyticsResponse | null = null;

  async function loadAnalytics(scope: 'all' | 'real', force = false): Promise<void> {
    if (
      !force &&
      analyticsData &&
      analyticsData.scope === scope &&
      Date.now() - analyticsData.generatedAt < 60_000
    ) {
      analyticsPanel.render(analyticsData);
      return;
    }
    try {
      if (!(await whenConnected())) throw new Error('no connection');
      const data = (await rpc('getAnalytics', { scope })) as AnalyticsResponse;
      analyticsData = data;
      analyticsPanel.render(data);
      applyBrainHeat(data);
      map.setSkillUsage(new Map(data.skillUsage.map((u) => [u.skill, u.calls])));
    } catch (err) {
      console.warn('[brain] analytics failed:', err);
    }
  }

  function openAnalytics(): void {
    analyticsPanel.show();
    hud.setAnalyticsOpen(true);
    void loadAnalytics(analyticsPanel.scope);
  }

  function closeAnalytics(): void {
    analyticsPanel.hide();
    hud.setAnalyticsOpen(false);
  }

  function applyBrainHeat(data: AnalyticsResponse): void {
    const t = data.byType;
    const raw: Array<[RegionName, number]> = [
      ['frontal', t['session.activity'] ?? 0],
      ['temporal', data.counts.sessions],
      ['parietal', t['tool.call'] ?? 0],
      ['cerebellum', data.skillUsage.reduce((a, s) => a + s.calls, 0)],
      ['brainstem', t['session.error'] ?? 0],
      ['occipital', 0],
    ];
    const max = Math.max(1, ...raw.map(([, v]) => v));
    const share: Partial<Record<RegionName, number>> = {};
    for (const [name, v] of raw) share[name] = Math.sqrt(v / max);
    regions.setActivityShare(share);
  }

  hud.onAnalyticsToggle = () => {
    if (analyticsPanel.isOpen) closeAnalytics();
    else openAnalytics();
  };
  analyticsPanel.onClose = () => closeAnalytics();
  analyticsPanel.onScope = (scope) => void loadAnalytics(scope, true);

  hud.render(engine);
  store.subscribe(() => {
    hud.render(engine);
    if (mode === 'map' && store.systemState && store.systemState.generatedAt !== lastBuiltAt) {
      applyMapData();
    }
  });

  /* --------------------------- selection --------------------------- */

  function clearSelection(): void {
    selectedSessionId = null;
    impulses.setHighlight(null);
    map.setSelected(null);
    hud.hideDetail();
  }

  function focusSession(id: string): void {
    if (mode === 'map') void setMode('brain');
    selectedSessionId = id;
    impulses.setHighlight(id);
    const t = regions.anchors.temporal;
    engine.flyTo(new THREE.Vector3(t.x + 80, t.y + 90, t.z + 240), new THREE.Vector3(0, -10, 0));
    const s = store.sessions.find((x) => x.id === id);
    if (s) {
      hud.showDetail(
        {
          title: s.title,
          kind: 'region',
          rows: [
            ['session', s.id],
            ['status', s.status],
            ['messages', String(s.messages)],
            ['tools', String(s.tools)],
            ['model', s.model || '—'],
            ['date', s.date || '—'],
            ['tag', s.tag || '—'],
          ],
        },
        { belowSystem: true },
      );
    }
  }

  function regionRows(name: RegionName): Array<[string, string]> {
    const st = store.systemState;
    switch (name) {
      case 'frontal': {
        const agents = st?.agents ?? [];
        return [['agents', String(agents.length)], ['list', agents.join(', ')]];
      }
      case 'temporal': {
        const live = store.sessions.filter((s) => s.status === 'live');
        const recent = store.sessions.slice(0, 5).map((s) => s.title.slice(0, 28));
        return [['live now', String(live.length)], ['tracked', String(store.sessions.length)], ['recent', recent.join(' · ')]];
      }
      case 'parietal': {
        const mcps = st?.mcpServers ?? [];
        const on = mcps.filter((m) => m.enabled);
        return [['servers', `${on.length}/${mcps.length} enabled`], ['bridged', mcps.map((m) => m.name).slice(0, 12).join(', ')]];
      }
      case 'occipital':
        return [['note', 'visual output — renders & artifacts arrive in M3/M4']];
      case 'cerebellum': {
        const skills = st?.skills;
        return [['skills', String(skills?.count ?? 0)], ['sample', (skills?.names ?? []).slice(0, 12).join(', ')]];
      }
      case 'brainstem': {
        const providers = st?.providers ?? [];
        return [
          ['providers', String(providers.length)],
          ['models', String(providers.reduce((a, p) => a + p.models.length, 0))],
          ['plugins', String(st?.plugins.length ?? 0)],
          ['renderer', engine.backend.toUpperCase()],
          ['vault', st?.vault ?? store.systemState?.vault ?? '—'],
        ];
      }
      default:
        return [];
    }
  }

  function focusRegion(name: RegionName): void {
    if (mode === 'map') void setMode('brain');
    const t = regions.anchors[name];
    engine.flyTo(new THREE.Vector3(t.x + 50, t.y + 80, t.z + 250), t.clone());
    regions.flashRegion(name, 0x00d4ff, 1000);
    hud.showDetail({ title: REGION_TITLES[name], kind: 'region', rows: regionRows(name) }, { belowSystem: true });
  }

  /* ------------------------- pointer picking ------------------------- */

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let downAt: { x: number; y: number } | null = null;
  let lastHoverPick = 0;

  canvas.addEventListener('pointerdown', (e) => {
    downAt = { x: e.clientX, y: e.clientY };
  });

  canvas.addEventListener('pointerup', (e) => {
    if (!downAt) return;
    const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
    downAt = null;
    if (moved > 6) return; // was an orbit drag

    if (mode === 'map') {
      const hit = map.pick(e.clientX, e.clientY, engine.camera, engine.size);
      if (hit) {
        map.setSelected(hit.node);
        hud.showDetail(map.infoFor(hit.node), { belowSystem: true });
        const fly = map.flyTargetFor(hit.node);
        engine.flyTo(fly.position, fly.target);
      } else {
        map.setSelected(null);
        hud.hideDetail();
      }
      return;
    }

    // Brain mode: raycast region orbs (they are plain sprites — raycastable).
    pointer.x = (e.clientX / engine.size.w) * 2 - 1;
    pointer.y = -(e.clientY / engine.size.h) * 2 + 1;
    raycaster.setFromCamera(pointer, engine.camera);
    const hits = raycaster.intersectObjects(regions.pickables, false);
    if (hits.length > 0) {
      const idx = regions.pickables.indexOf(hits[0].object as THREE.Sprite);
      if (idx >= 0) focusRegion(REGION_ORDER[idx]);
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    if (mode !== 'map') {
      canvas.style.cursor = '';
      return;
    }
    const now = performance.now();
    if (now - lastHoverPick < 60) return;
    lastHoverPick = now;
    const hit = map.pick(e.clientX, e.clientY, engine.camera, engine.size);
    map.setHover(hit?.node ?? null);
    canvas.style.cursor = hit ? 'pointer' : '';
  });

  /* ----------------------------- keyboard ----------------------------- */

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

    if (e.key === 'a' || e.key === 'A') {
      if (analyticsPanel.isOpen) closeAnalytics();
      else openAnalytics();
      return;
    }

    if (mode === 'replay') {
      switch (e.key) {
        case ' ':
          e.preventDefault();
          replay.toggle();
          return;
        case 'ArrowRight':
          e.preventDefault();
          replay.step(1);
          return;
        case 'ArrowLeft':
          e.preventDefault();
          replay.step(-1);
          return;
        case 'Escape':
          if (analyticsPanel.isOpen) closeAnalytics();
          else void setMode('brain');
          return;
        case 'm':
        case 'M':
          void setMode('map');
          return;
        default:
          return;
      }
    }

    const num = Number(e.key);
    if (num >= 1 && num <= 6) {
      focusRegion(REGION_ORDER[num - 1]);
      return;
    }
    switch (e.key) {
      case 'Escape':
        if (analyticsPanel.isOpen) closeAnalytics();
        else clearSelection();
        break;
      case ' ':
        e.preventDefault();
        impulses.setPaused(!impulses.isPaused);
        hud.setPaused(impulses.isPaused);
        break;
      case 'm':
      case 'M':
        void setMode(mode === 'map' ? 'brain' : 'map');
        break;
      case 'r':
      case 'R':
        void setMode('replay');
        break;
      default:
        break;
    }
  });

  /* ------------------------------ frame ------------------------------ */

  engine.onFrame((dt, t) => {
    brain.update(dt, t);
    regions.update(dt, t, engine.camera, engine.size);
    impulses.update(dt, t);
    map.update(dt, t, engine.camera, engine.size);
    replay.update(dt);
  });

  engine.start();
  connect();

  // Debug/QA hook — used by scripts/qa-shot.js (and the console).
  (window as unknown as Record<string, unknown>).__brain = {
    engine,
    store,
    map,
    impulses,
    hud,
    replay,
    analytics: analyticsPanel,
    loadReplay,
    loadAnalytics,
    openAnalytics,
    closeAnalytics,
    analyticsOpen: () => analyticsPanel.isOpen,
    replayState: () => ({ active: replayActive, id: replayId, ...replay.state }),
    mode: () => mode,
    setMode,
    focusRegion,
    focusSession,
  };

  // Deep-link: ?mode=map | replay; &session=<id> loads a replay or focuses.
  const params = new URLSearchParams(window.location.search);
  const urlMode = params.get('mode');
  const urlSession = params.get('session');
  if (urlMode === 'map') void setMode('map');
  if (urlMode === 'replay') {
    void setMode('replay').then(() => {
      if (urlSession) void loadReplay(urlSession);
    });
  } else if (urlSession) {
    focusSession(urlSession);
  }
  if (params.get('analytics') === '1') void whenConnected().then(() => openAnalytics());

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
