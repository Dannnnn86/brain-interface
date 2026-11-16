/**
 * analyticsPanel.ts — the Analyst dashboard: a right-side slide-over with
 * hand-rolled visualizations (no chart library):
 *
 *   - totals row (animated count-ups)
 *   - tool health: bars + ok-rate + avg duration
 *   - activity: 30-day sparkline on a 2D canvas (events + sessions)
 *   - models: usage bars colored by provider
 *   - heatmap: 7×24 "when you work" grid
 *   - top skills + recent errors
 *
 * Scope toggle (ALL vs REAL) excludes simulated events for honest numbers.
 * Rendering happens after show() so canvas sizes are real.
 */
import { animate } from 'animejs';
import type { AnalyticsResponse } from '@shared/protocol.js';
import { modelColor } from '../state/store.js';

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

function fmtNum(n: number): string {
  return n >= 10000 ? `${Math.round(n / 1000)}k` : String(n);
}

function fmtMs(ms: number | null): string {
  if (ms == null) return '—';
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function tweenNum(node: HTMLElement, to: number, ms = 700): void {
  const from = Number(node.dataset.v || '0');
  node.dataset.v = String(to);
  const obj = { v: from };
  animate(obj, {
    v: to,
    duration: ms,
    ease: 'out(3)',
    onUpdate: () => {
      node.textContent = fmtNum(Math.round(obj.v));
    },
  });
}

/** Two-series sparkline on a canvas (events cyan, sessions violet). */
function drawSparkline(canvas: HTMLCanvasElement, data: AnalyticsResponse): void {
  const w = canvas.clientWidth || 420;
  const h = 72;
  const dpr = 2;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  // baseline grid
  ctx.strokeStyle = 'rgba(26, 35, 48, 0.9)';
  ctx.lineWidth = 1;
  for (let i = 1; i <= 3; i++) {
    const y = (h / 4) * i;
    ctx.beginPath();
    ctx.moveTo(4, y);
    ctx.lineTo(w - 4, y);
    ctx.stroke();
  }

  const series: Array<{ values: number[]; color: string }> = [
    { values: data.activity.days.map((d) => d.events), color: '#00d4ff' },
    { values: data.activity.days.map((d) => d.sessions), color: '#b84aff' },
  ];

  for (const s of series) {
    const max = Math.max(1, ...s.values);
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 1.6;
    ctx.shadowColor = s.color;
    ctx.shadowBlur = 6;
    ctx.beginPath();
    s.values.forEach((v, i) => {
      const x = 4 + (i / Math.max(1, s.values.length - 1)) * (w - 8);
      const y = h - 6 - (v / max) * (h - 18);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
}

export class AnalyticsPanel {
  readonly root: HTMLElement;
  private scopeBtns = new Map<'all' | 'real', HTMLElement>();
  private subEl: HTMLElement;
  private totalsEl: HTMLElement;
  private toolBody: HTMLElement;
  private sparkCanvas: HTMLCanvasElement;
  private sparkMeta: HTMLElement;
  private modelsBody: HTMLElement;
  private heatEl: HTMLElement;
  private skillsBody: HTMLElement;
  private errorsBody: HTMLElement;
  private open = false;
  private lastData: AnalyticsResponse | null = null;
  private currentScope: 'all' | 'real' = 'all';

  onScope: ((scope: 'all' | 'real') => void) | null = null;
  onClose: (() => void) | null = null;

  constructor(hudRoot: HTMLElement) {
    this.root = el('div', 'panel', hudRoot);
    this.root.id = 'panel-analytics';
    this.root.style.display = 'none';

    const head = el('div', 'an-head', this.root);
    el('div', 'an-title', head).textContent = 'ANALYTICS';

    const scope = el('div', 'an-scope', head);
    for (const key of ['all', 'real'] as const) {
      const btn = el('button', 'an-scope-btn', scope);
      btn.type = 'button';
      btn.textContent = key.toUpperCase();
      btn.addEventListener('click', () => {
        if (this.currentScope === key) return;
        this.currentScope = key;
        for (const [k, b] of this.scopeBtns) b.classList.toggle('active', k === key);
        this.onScope?.(key);
      });
      this.scopeBtns.set(key, btn);
    }
    this.scopeBtns.get('all')?.classList.add('active');

    const close = el('button', 'detail-close', head);
    close.type = 'button';
    close.textContent = '✕';
    close.addEventListener('click', () => this.onClose?.());

    this.subEl = el('div', 'an-sub', this.root);

    this.totalsEl = el('div', 'an-totals', this.root);

    /* tool health */
    const toolCard = el('div', 'an-card', this.root);
    el('h4', undefined, toolCard).textContent = 'tool health';
    this.toolBody = el('div', 'an-bars', toolCard);

    /* activity */
    const actCard = el('div', 'an-card', this.root);
    el('h4', undefined, actCard).textContent = 'activity · last 30 days';
    this.sparkCanvas = el('canvas', 'an-spark', actCard) as HTMLCanvasElement;
    this.sparkMeta = el('div', 'an-spark-meta', actCard);

    /* models */
    const modelCard = el('div', 'an-card', this.root);
    el('h4', undefined, modelCard).textContent = 'models';
    this.modelsBody = el('div', 'an-bars', modelCard);

    /* heatmap */
    const heatCard = el('div', 'an-card', this.root);
    el('h4', undefined, heatCard).textContent = 'when you work';
    this.heatEl = el('div', 'an-heat', heatCard);

    /* skills */
    const skillCard = el('div', 'an-card', this.root);
    el('h4', undefined, skillCard).textContent = 'top skills';
    this.skillsBody = el('div', 'an-bars', skillCard);

    /* errors */
    const errCard = el('div', 'an-card', this.root);
    el('h4', undefined, errCard).textContent = 'recent errors';
    this.errorsBody = el('div', 'an-errors', errCard);
  }

  get isOpen(): boolean {
    return this.open;
  }

  get scope(): 'all' | 'real' {
    return this.currentScope;
  }

  show(): void {
    if (this.open) return;
    this.open = true;
    this.root.style.display = '';
    animate(this.root, { opacity: [0, 1], translateX: [40, 0], duration: 360, ease: 'out(3)' });
    // redraw canvas once layout is live
    if (this.lastData) window.setTimeout(() => this.render(this.lastData!), 60);
  }

  hide(): void {
    if (!this.open) return;
    this.open = false;
    animate(this.root, {
      opacity: 0,
      translateX: 40,
      duration: 220,
      ease: 'in(2)',
      onComplete: () => {
        this.root.style.display = 'none';
      },
    });
  }

  render(data: AnalyticsResponse): void {
    this.lastData = data;
    const gen = new Date(data.generatedAt);
    const simNote =
      data.scope === 'all' && data.counts.simulated > 0
        ? ` · includes ${data.counts.simulated.toLocaleString()} simulated`
        : '';
    this.subEl.textContent = `window: ${data.windowDays} days · generated ${gen.toLocaleTimeString()}${simNote}`;

    /* totals */
    this.totalsEl.replaceChildren();
    const totals: Array<[string, number]> = [
      ['events', data.counts.scoped],
      ['sessions', data.counts.sessions],
      ['tool calls', data.counts.toolCalls],
      ['errors', data.counts.errors],
    ];
    for (const [label, value] of totals) {
      const block = el('div', 'an-total', this.totalsEl);
      const num = el('div', 'an-total-num', block);
      num.textContent = '0';
      tweenNum(num, value);
      el('div', 'an-total-label', block).textContent = label;
    }

    /* tool health */
    this.renderBars(
      this.toolBody,
      data.toolHealth.slice(0, 10).map((t) => ({
        label: t.tool,
        value: t.calls,
        right: `${t.calls} · ${t.okRate == null ? '—' : Math.round(t.okRate * 100) + '%'} · ${fmtMs(t.avgMs)}`,
        color: t.okRate == null ? '#7ab8ff' : t.okRate >= 0.95 ? '#00ff88' : t.okRate >= 0.85 ? '#ffd166' : '#ff6b6b',
        sub: t.failed > 0 ? `${t.failed} failed` : '',
      })),
    );

    /* sparkline */
    this.sparkCanvas.style.display = '';
    drawSparkline(this.sparkCanvas, data);
    const peakEvents = Math.max(0, ...data.activity.days.map((d) => d.events));
    const totalRecent = data.activity.days.reduce((a, d) => a + d.events, 0);
    this.sparkMeta.textContent = `${totalRecent.toLocaleString()} events · peak ${peakEvents.toLocaleString()}/day · cyan events / violet sessions`;

    /* models */
    this.renderBars(
      this.modelsBody,
      data.models.slice(0, 8).map((m) => ({
        label: m.model.split('/').pop() || m.model,
        value: m.events,
        right: `${fmtNum(m.events)} · ${m.sessions} sess`,
        color: modelColor(m.model),
        dot: modelColor(m.model),
      })),
    );

    /* heatmap */
    this.renderHeat(data.heatmap.rows);

    /* skills */
    this.renderBars(
      this.skillsBody,
      data.skillUsage.slice(0, 8).map((s) => ({
        label: s.skill,
        value: s.calls,
        right: String(s.calls),
        color: '#7ae0c8',
      })),
    );

    /* errors */
    this.errorsBody.replaceChildren();
    if (data.errors.recent.length === 0) {
      const none = el('div', 'an-none', this.errorsBody);
      none.textContent = 'no errors recorded in this window';
    } else {
      for (const e of data.errors.recent) {
        const row = el('div', 'an-error-row', this.errorsBody);
        el('span', 't', row).textContent = new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        el('span', 'ses', row).textContent = e.sessionId.slice(-6);
        el('span', 'msg', row).textContent = e.error.slice(0, 90);
      }
    }
  }

  private renderBars(
    body: HTMLElement,
    rows: Array<{ label: string; value: number; right: string; color: string; dot?: string; sub?: string }>,
  ): void {
    body.replaceChildren();
    if (rows.length === 0) {
      el('div', 'an-none', body).textContent = 'no data in this window';
      return;
    }
    const max = Math.max(1, ...rows.map((r) => r.value));
    rows.forEach((r, i) => {
      const row = el('div', 'an-bar-row', body);
      const top = el('div', 'an-bar-top', row);
      if (r.dot) {
        const dot = el('span', 'model-dot', top);
        dot.style.background = r.dot;
        dot.style.boxShadow = `0 0 6px ${r.dot}`;
      }
      el('span', 'an-bar-label', top).textContent = r.label;
      if (r.sub) el('span', 'an-bar-sub', top).textContent = r.sub;
      el('span', 'an-bar-right', top).textContent = r.right;
      const rail = el('div', 'an-bar-rail', row);
      const fill = el('div', 'an-bar-fill', rail);
      fill.style.background = r.color;
      fill.style.boxShadow = `0 0 8px ${r.color}55`;
      animate(fill, {
        width: ['0%', `${((r.value / max) * 100).toFixed(1)}%`],
        duration: 620,
        delay: i * 35,
        ease: 'out(3)',
      });
    });
  }

  private renderHeat(rows: number[][]): void {
    this.heatEl.replaceChildren();
    const max = Math.max(1, ...rows.flat());
    for (let d = 0; d < 7; d++) {
      const label = el('span', 'an-heat-day', this.heatEl);
      label.textContent = DAY_NAMES[d];
      for (let h = 0; h < 24; h++) {
        const v = rows[d]?.[h] ?? 0;
        const cell = el('span', 'an-heat-cell', this.heatEl);
        const alpha = v === 0 ? 0.04 : 0.1 + (v / max) * 0.85;
        cell.style.background = `rgba(0, 212, 255, ${alpha.toFixed(2)})`;
        cell.title = `${DAY_NAMES[d]} ${String(h).padStart(2, '0')}:00 — ${v} events`;
      }
    }
  }
}
