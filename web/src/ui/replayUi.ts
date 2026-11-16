/**
 * replayUi.ts — the replay surface: session picker, timeline bar, replay log.
 *
 * These are plain DOM panels inside the HUD root. All logic (clock, seeking,
 * frame routing) lives in ReplayEngine; this module is presentation +
 * gesture capture with callbacks wired by main.ts.
 */
import { animate } from 'animejs';
import type { ReplayTimeline, SessionSummary } from '@shared/protocol.js';
import type { ReplayState } from '../modules/replayEngine.js';
import { REPLAY_SPEEDS } from '../modules/replayEngine.js';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  parent?: HTMLElement,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (parent) parent.appendChild(node);
  return node;
}

function fmtClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/* ------------------------------ picker ------------------------------ */

export class ReplayPicker {
  readonly root: HTMLElement;
  private listEl: HTMLElement;
  private input: HTMLInputElement;
  private rows: Array<{ el: HTMLElement; text: string }> = [];

  onPick: ((id: string) => void) | null = null;
  onClose: (() => void) | null = null;

  constructor(hudRoot: HTMLElement) {
    this.root = el('div', 'panel', hudRoot);
    this.root.id = 'panel-picker';
    this.root.style.display = 'none';

    const head = el('div', 'panel-head', this.root);
    el('div', 'panel-title', head).textContent = 'replay a session';
    const close = el('button', 'detail-close', head);
    close.type = 'button';
    close.textContent = '✕';
    close.addEventListener('click', () => this.onClose?.());

    this.input = el('input', 'picker-search', this.root) as HTMLInputElement;
    this.input.type = 'search';
    this.input.placeholder = 'filter sessions…';
    this.input.addEventListener('input', () => this.applyFilter());

    this.listEl = el('div', 'picker-list', this.root);
  }

  show(sessions: SessionSummary[]): void {
    this.listEl.replaceChildren();
    this.rows = [];
    for (const s of sessions.slice(0, 120)) {
      const row = el('div', 'picker-row', this.listEl);
      const live = s.status === 'live';
      if (live) {
        row.classList.add('disabled');
        row.title = 'still running — finishes soon';
      }
      const top = el('div', 'picker-row-top', row);
      el('span', 'picker-title', top).textContent = s.title;
      const chip = el('span', `picker-state ${s.status}`, top);
      chip.textContent = s.status;
      const meta = el('div', 'picker-meta', row);
      meta.textContent = `${s.date || '—'} · ${s.messages} msgs · ${s.tools} tools${s.simulated ? ' · sim' : ''}`;
      if (!live) {
        row.addEventListener('click', () => this.onPick?.(s.id));
      }
      this.rows.push({ el: row, text: `${s.title} ${s.date} ${s.tag ?? ''}`.toLowerCase() });
    }
    this.input.value = '';
    this.applyFilter();
    if (this.root.style.display === 'none') {
      this.root.style.display = '';
      animate(this.root, { opacity: [0, 1], translateY: [-14, 0], duration: 300, ease: 'out(3)' });
    }
  }

  private applyFilter(): void {
    const q = this.input.value.trim().toLowerCase();
    for (const row of this.rows) {
      row.el.style.display = !q || row.text.includes(q) ? '' : 'none';
    }
  }

  hide(): void {
    this.root.style.display = 'none';
  }
}

/* ---------------------------- timeline bar ---------------------------- */

export class TimelineBar {
  readonly root: HTMLElement;
  private playBtn: HTMLButtonElement;
  private speedBtns = new Map<number, HTMLElement>();
  private track: HTMLElement;
  private fill: HTMLElement;
  private handle: HTMLElement;
  private bookmarksEl: HTMLElement;
  private timeEl: HTMLElement;
  private countersEl: HTMLElement;
  private titleEl: HTMLElement;

  private timeline: ReplayTimeline | null = null;
  private dragging = false;

  onPlayToggle: (() => void) | null = null;
  onSpeed: ((s: number) => void) | null = null;
  onSeek: ((t: number) => void) | null = null;
  onStep: ((dir: 1 | -1) => void) | null = null;
  onClose: (() => void) | null = null;

  constructor(hudRoot: HTMLElement) {
    this.root = el('div', 'panel', hudRoot);
    this.root.id = 'panel-replay';
    this.root.style.display = 'none';

    // transport buttons
    const stepBack = el('button', 'replay-btn', this.root);
    stepBack.type = 'button';
    stepBack.textContent = '⏮';
    stepBack.title = 'previous frame (←)';
    stepBack.addEventListener('click', () => this.onStep?.(-1));

    this.playBtn = el('button', 'replay-btn primary', this.root);
    this.playBtn.type = 'button';
    this.playBtn.textContent = '▶';
    this.playBtn.title = 'play/pause (Space)';
    this.playBtn.addEventListener('click', () => this.onPlayToggle?.());

    const stepFwd = el('button', 'replay-btn', this.root);
    stepFwd.type = 'button';
    stepFwd.textContent = '⏭';
    stepFwd.title = 'next frame (→)';
    stepFwd.addEventListener('click', () => this.onStep?.(1));

    // speed group
    const speeds = el('div', 'speed-group', this.root);
    for (const s of REPLAY_SPEEDS) {
      const btn = el('button', 'speed-btn', speeds);
      btn.type = 'button';
      btn.textContent = s === 0.5 ? '0.5×' : `${s}×`;
      btn.addEventListener('click', () => this.onSpeed?.(s));
      this.speedBtns.set(s, btn);
    }

    // track
    this.track = el('div', 'replay-track', this.root);
    el('div', 'track-rail', this.track);
    this.fill = el('div', 'track-fill', this.track);
    this.bookmarksEl = el('div', 'track-bookmarks', this.track);
    this.handle = el('div', 'track-handle', this.track);

    this.track.addEventListener('pointerdown', (e) => this.beginDrag(e));
    window.addEventListener('pointermove', (e) => this.moveDrag(e));
    window.addEventListener('pointerup', () => this.endDrag());

    // labels
    const right = el('div', 'replay-right', this.root);
    this.titleEl = el('div', 'replay-title', right);
    this.timeEl = el('div', 'replay-time', right);
    this.countersEl = el('div', 'replay-counters', right);

    const close = el('button', 'detail-close', this.root);
    close.type = 'button';
    close.textContent = '✕';
    close.title = 'exit replay (Esc)';
    close.addEventListener('click', () => this.onClose?.());
  }

  private pctFromEvent(e: PointerEvent): number {
    const rect = this.track.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  }

  private beginDrag(e: PointerEvent): void {
    if (!this.timeline) return;
    this.dragging = true;
    this.track.setPointerCapture?.(e.pointerId);
    this.onSeek?.(this.pctFromEvent(e) * this.timeline.duration);
  }

  private moveDrag(e: PointerEvent): void {
    if (!this.dragging || !this.timeline) return;
    this.onSeek?.(this.pctFromEvent(e) * this.timeline.duration);
  }

  private endDrag(): void {
    this.dragging = false;
  }

  /* ------------------------------ public ------------------------------ */

  setTimeline(timeline: ReplayTimeline): void {
    this.timeline = timeline;
    this.titleEl.textContent = timeline.title;
    this.countersEl.dataset.total = timeline.totals
      ? `${timeline.totals.messages} msgs · ${timeline.totals.tools} tools`
      : `${timeline.frames.length} frames`;
    // bookmark ticks
    this.bookmarksEl.replaceChildren();
    for (const bm of timeline.bookmarks) {
      const tick = el('div', `bm ${bm.kind}`, this.bookmarksEl);
      tick.style.left = `${((bm.t / Math.max(0.001, timeline.duration)) * 100).toFixed(2)}%`;
      tick.title = `${bm.kind} @ ${fmtClock(bm.t)}`;
    }
    this.setState({
      t: 0,
      playing: false,
      speed: 1,
      index: 0,
      duration: timeline.duration,
      frameCount: timeline.frames.length,
    });
  }

  setState(state: ReplayState): void {
    if (!this.timeline) return;
    const pct = state.duration > 0 ? (state.t / state.duration) * 100 : 0;
    this.fill.style.width = `${pct.toFixed(2)}%`;
    this.handle.style.left = `${pct.toFixed(2)}%`;
    this.timeEl.textContent = `${fmtClock(state.t)} / ${fmtClock(state.duration)}`;

    // counters up to the playhead
    let msgs = 0;
    let tools = 0;
    for (let i = 0; i < state.index && i < this.timeline.frames.length; i++) {
      const f = this.timeline.frames[i];
      if (f.type === 'session.activity') msgs++;
      if (f.type === 'tool.call') tools++;
    }
    const total = this.countersEl.dataset.total ?? '';
    this.countersEl.textContent = `${msgs}·${tools} | ${state.index}/${state.frameCount} | ${total}`;

    this.playBtn.textContent = state.playing ? '⏸' : '▶';
    for (const [s, btn] of this.speedBtns) {
      btn.classList.toggle('active', s === state.speed);
    }
  }

  show(): void {
    if (this.root.style.display === 'none') {
      this.root.style.display = '';
      animate(this.root, { opacity: [0, 1], translateY: [26, 0], duration: 380, ease: 'out(3)' });
    }
  }

  hide(): void {
    this.root.style.display = 'none';
  }
}

/* ---------------------------- replay log ---------------------------- */

interface LogEntry {
  t: number;
  chip: string;
  chipClass: string;
  text: string;
}

const LOG_MAX = 8;

export class ReplayLog {
  readonly root: HTMLElement;
  private listEl: HTMLElement;
  private entries: LogEntry[] = [];
  private dirty = false;

  constructor(hudRoot: HTMLElement) {
    this.root = el('div', 'panel', hudRoot);
    this.root.id = 'panel-replay-log';
    this.root.style.display = 'none';
    const head = el('div', 'panel-head', this.root);
    el('div', 'panel-title', head).textContent = 'replay log';
    this.listEl = el('ul', 'replay-log-list', this.root);

    setInterval(() => {
      if (this.dirty) this.render();
    }, 150);
  }

  clear(): void {
    this.entries = [];
    this.dirty = true;
  }

  push(entry: LogEntry): void {
    this.entries.push(entry);
    if (this.entries.length > LOG_MAX) this.entries.splice(0, this.entries.length - LOG_MAX);
    this.dirty = true;
  }

  private render(): void {
    this.dirty = false;
    this.listEl.replaceChildren();
    for (const e of this.entries) {
      const item = el('li', 'feed-item replay-log-item', this.listEl);
      el('span', 't', item).textContent = fmtClock(e.t);
      const chip = el('span', `feed-chip ${e.chipClass}`, item);
      chip.textContent = e.chip;
      el('span', 'msg', item).textContent = e.text;
    }
  }

  show(): void {
    this.root.style.display = '';
  }

  hide(): void {
    this.root.style.display = 'none';
  }
}

/** Convert a replay frame into a log entry (chip + text). */
export function frameToLogEntry(frame: { t: number; type: string; tool?: string; argsSummary?: string; ok?: boolean; text?: string; error?: string; durationMs?: number }): LogEntry {
  switch (frame.type) {
    case 'session.activity':
      return { t: frame.t, chip: 'msg', chipClass: 'user', text: frame.text || 'message' };
    case 'tool.call':
      return { t: frame.t, chip: 'tool', chipClass: 'tool', text: `${frame.tool}(${frame.argsSummary || ''})` };
    case 'tool.result':
      return {
        t: frame.t,
        chip: frame.ok === false ? 'ERR' : 'ok',
        chipClass: frame.ok === false ? 'err' : 'result',
        text: `${frame.tool || 'tool'}`,
      };
    case 'session.error':
      return { t: frame.t, chip: 'error', chipClass: 'err', text: frame.error || 'error' };
    case 'session.idle':
      return { t: frame.t, chip: 'idle', chipClass: 'reason', text: 'session idle' };
    default:
      return { t: frame.t, chip: 'evt', chipClass: 'start', text: frame.type };
  }
}
