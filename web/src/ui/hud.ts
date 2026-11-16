/**
 * hud.ts — the 2D overlay: session cards (top-left), system stats
 * (top-right), event feed (bottom-left), legend (bottom-right).
 *
 * Built with plain DOM + anime.js for enter/update motion. Reconciliation
 * is by id — nodes are created once, then updated in place, so animations
 * only play on real changes.
 */
import { animate } from 'animejs';
import type { SystemEvent } from '@shared/protocol.js';
import type { Engine } from '../engine/engine.js';
import { modelColor, store as defaultStore } from '../state/store.js';
import type { Store } from '../state/store.js';

const MAX_CARDS = 30;
const MAX_FEED_NODES = 10;

interface CardRefs {
  el: HTMLElement;
  title: HTMLElement;
  status: HTMLElement;
  messages: HTMLElement;
  tools: HTMLElement;
  modelDot: HTMLElement;
  meta: HTMLElement;
}

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

/** Animate a numeric textContent from its current value to `to`. */
function tweenNumber(node: HTMLElement, to: number, durationMs = 420): void {
  const from = Number(node.dataset.value || '0');
  if (from === to) return;
  node.dataset.value = String(to);
  const obj = { v: from };
  animate(obj, {
    v: to,
    duration: durationMs,
    ease: 'out(3)',
    onUpdate: () => {
      node.textContent = String(Math.round(obj.v));
    },
  });
}

function shortId(id: string): string {
  return id.length > 8 ? `…${id.slice(-6)}` : id;
}

function fmtTime(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

function feedLine(event: SystemEvent): { chip: string; chipClass: string; msg: string } {
  switch (event.type) {
    case 'session.start':
      return { chip: 'start', chipClass: 'start', msg: event.title || 'session started' };
    case 'session.activity':
      return { chip: 'user', chipClass: 'user', msg: event.text || `message #${event.messageCount ?? '?'}` };
    case 'tool.call':
      return { chip: 'tool', chipClass: 'tool', msg: `${event.tool || 'tool'}(${event.argsSummary || ''})` };
    case 'tool.result':
      return {
        chip: 'result',
        chipClass: 'result',
        msg: `${event.ok === false ? 'ERROR' : 'ok'} · ${event.durationMs ?? 0} ms`,
      };
    case 'session.idle':
      return { chip: 'idle', chipClass: 'reason', msg: `idle · ${event.messageCount ?? 0} messages` };
    case 'session.error':
      return { chip: 'error', chipClass: 'err', msg: event.error || 'session error' };
    case 'session.file':
      return { chip: 'file', chipClass: 'start', msg: event.text || 'transcript updated' };
    default:
      return { chip: 'evt', chipClass: 'start', msg: event.type };
  }
}

export class Hud {
  readonly root: HTMLElement;
  private badges: HTMLElement;
  private connBadge: HTMLElement;
  private simBadge: HTMLElement;
  private sessionsList: HTMLElement;
  private statRows: HTMLElement;
  private feedList: HTMLElement;
  private feedHead: HTMLElement;
  private cards = new Map<string, CardRefs>();
  private renderedEvents = 0;
  private stats: Record<string, HTMLElement> = {};
  private store: Store;
  private modeButtons = new Map<string, HTMLElement>();
  private pauseBadge!: HTMLElement;
  private detailPanel!: HTMLElement;
  private detailBody!: HTMLElement;
  private detailTitle!: HTMLElement;
  private detailChip!: HTMLElement;

  /** Set by main.ts: fired when a session card is clicked. */
  onSessionSelect: ((id: string) => void) | null = null;
  /** Set by main.ts: fired when the brain/map mode pill is clicked. */
  onModeChange: ((mode: string) => void) | null = null;
  /** Set by main.ts: fired when the analytics button is clicked. */
  onAnalyticsToggle: (() => void) | null = null;
  private analyticsBtn!: HTMLButtonElement;

  constructor(engine: Engine, store: Store = defaultStore) {
    this.store = store;
    this.root = document.getElementById('hud') as HTMLElement;

    /* ---------------- sessions panel ---------------- */
    const sessionsPanel = el('div', 'panel', this.root);
    sessionsPanel.id = 'panel-sessions';

    const brand = el('div', 'brand', sessionsPanel);
    el('div', 'brand-glyph', brand).textContent = '◉';
    const brandText = el('div', undefined, brand);
    el('div', 'brand-name', brandText).textContent = 'BRAIN INTERFACE';
    el('div', 'brand-sub', brandText).textContent = 'opencode · neural monitor';

    this.badges = el('div', 'badges', brand);
    this.connBadge = el('span', 'badge connecting', this.badges);
    el('span', 'dot', this.connBadge);
    el('span', 'conn-text', this.connBadge).textContent = 'CONNECTING';
    this.simBadge = el('span', 'badge sim', this.badges);
    this.simBadge.textContent = 'SIM';
    this.simBadge.style.display = 'none';

    this.sessionsList = el('div', undefined, sessionsPanel);
    this.sessionsList.id = 'sessions-list';

    /* ---------------- mode pill (top center) ---------------- */
    const modePill = el('div', 'panel mode-pill', this.root);
    modePill.id = 'panel-mode';
    for (const [key, label] of [
      ['brain', 'BRAIN'],
      ['map', 'MAP'],
      ['replay', 'REPLAY'],
    ] as Array<[string, string]>) {
      const btn = el('button', 'mode-btn', modePill);
      btn.type = 'button';
      btn.textContent = label;
      btn.dataset.mode = key;
      btn.addEventListener('click', () => this.onModeChange?.(key));
      this.modeButtons.set(key, btn);
    }
    this.pauseBadge = el('span', 'badge connecting', modePill);
    this.pauseBadge.textContent = '⏸ PAUSED';
    this.pauseBadge.style.display = 'none';

    /* ---------------- detail panel (right, slide-in) ---------------- */
    this.detailPanel = el('div', 'panel', this.root);
    this.detailPanel.id = 'panel-detail';
    this.detailPanel.style.display = 'none';
    const detailHead = el('div', 'panel-head', this.detailPanel);
    this.detailTitle = el('div', 'detail-title', detailHead);
    this.detailChip = el('span', 'feed-chip start', detailHead);
    const closeBtn = el('button', 'detail-close', detailHead);
    closeBtn.type = 'button';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', () => this.hideDetail());
    this.detailBody = el('div', 'detail-body', this.detailPanel);

    /* ---------------- system panel ---------------- */
    const systemPanel = el('div', 'panel', this.root);
    systemPanel.id = 'panel-system';
    const sysHead = el('div', 'panel-head', systemPanel);
    el('div', 'panel-title', sysHead).textContent = 'system';
    this.analyticsBtn = el('button', 'panel-link', sysHead);
    this.analyticsBtn.type = 'button';
    this.analyticsBtn.textContent = 'analytics ▸';
    this.analyticsBtn.title = 'open the analyst dashboard (a)';
    this.analyticsBtn.addEventListener('click', () => this.onAnalyticsToggle?.());

    this.statRows = el('div', 'stat-rows', systemPanel);
    const statKeys: Array<[string, string]> = [
      ['providers', 'Providers'],
      ['models', 'Models'],
      ['mcp', 'MCP servers'],
      ['skills', 'Skills'],
      ['plugins', 'Plugins'],
      ['agents', 'Agents'],
      ['live', 'Live sessions'],
      ['epm', 'Events / min'],
      ['total', 'Total events'],
      ['fps', 'Render FPS'],
      ['backend', 'Renderer'],
    ];
    for (const [key, label] of statKeys) {
      const row = el('div', 'stat-row', this.statRows);
      el('span', 'k', row).textContent = label;
      const v = el('span', 'v', row);
      v.textContent = '—';
      this.stats[key] = v;
    }

    /* ---------------- feed panel ---------------- */
    const feedPanel = el('div', 'panel', this.root);
    feedPanel.id = 'panel-feed';
    const feedHeadRow = el('div', 'panel-head', feedPanel);
    el('div', 'panel-title', feedHeadRow).textContent = 'event feed';
    this.feedHead = el('div', 'panel-title', feedHeadRow);

    this.feedList = el('ul', undefined, feedPanel);
    this.feedList.id = 'feed-list';

    /* ---------------- legend ---------------- */
    const legend = el('div', 'panel', this.root);
    legend.id = 'panel-legend';
    const legendRows: Array<[string, string]> = [
      ['#00d4ff', 'user message · afferent'],
      ['#b84aff', 'reasoning · internal'],
      ['#ff6b00', 'tool call · efferent'],
      ['#00ff88', 'tool result · return'],
      ['#ff0044', 'error'],
    ];
    for (const [color, label] of legendRows) {
      const row = el('div', 'legend-row', legend);
      const sw = el('span', 'legend-swatch', row);
      sw.style.background = color;
      sw.style.boxShadow = `0 0 8px ${color}`;
      el('span', undefined, row).textContent = label;
    }

    /* live re-render loop for numbers that drift (fps, epm) */
    setInterval(() => this.renderStats(engine), 700);
  }

  render(engine: Engine): void {
    this.renderBadges();
    this.renderCardDeck();
    this.renderStats(engine);
    this.renderNewFeedItems();
  }

  /* ------------------------------ modes ------------------------------ */

  setMode(mode: string): void {
    for (const [key, btn] of this.modeButtons) {
      btn.classList.toggle('active', key === mode);
    }
    // Scoped panel visibility (e.g. replay hides the live feed + legend).
    this.root.classList.remove('mode-brain', 'mode-map', 'mode-replay');
    this.root.classList.add(`mode-${mode}`);
  }

  setPaused(paused: boolean): void {
    this.pauseBadge.style.display = paused ? '' : 'none';
  }

  setAnalyticsOpen(open: boolean): void {
    this.analyticsBtn.textContent = open ? 'analytics ▾' : 'analytics ▸';
    this.analyticsBtn.classList.toggle('active', open);
  }

  /* ---------------------------- detail panel ---------------------------- */

  showDetail(info: { title: string; kind?: string; rows: Array<[string, string]> }, opts: { belowSystem?: boolean } = {}): void {
    this.detailTitle.textContent = info.title;
    this.detailChip.textContent = info.kind ?? '';
    this.detailChip.className = `feed-chip ${this.chipClassFor(info.kind)}`;
    this.detailPanel.classList.toggle('below-system', opts.belowSystem === true);
    this.detailBody.replaceChildren();
    for (const [k, v] of info.rows) {
      const row = el('div', 'detail-row', this.detailBody);
      el('span', 'dk', row).textContent = k;
      el('span', 'dv', row).textContent = v;
    }
    if (this.detailPanel.style.display === 'none') {
      this.detailPanel.style.display = '';
      animate(this.detailPanel, {
        opacity: [0, 1],
        translateX: [24, 0],
        duration: 320,
        ease: 'out(3)',
      });
    }
  }

  hideDetail(): void {
    if (this.detailPanel.style.display === 'none') return;
    animate(this.detailPanel, {
      opacity: 0,
      translateX: 24,
      duration: 200,
      ease: 'in(2)',
      onComplete: () => {
        this.detailPanel.style.display = 'none';
      },
    });
  }

  private chipClassFor(kind?: string): string {
    switch (kind) {
      case 'provider': return 'user';
      case 'agent': return 'reason';
      case 'skill': return 'result';
      case 'mcp': return 'tool';
      case 'plugin': return 'err';
      case 'region': return 'start';
      default: return 'start';
    }
  }

  /* ----------------------------- badges ----------------------------- */

  private renderBadges(): void {
    const conn = this.store.connection;
    this.connBadge.className = `badge ${conn}`;
    const text = this.connBadge.querySelector('.conn-text') as HTMLElement;
    text.textContent = conn === 'live' ? 'LIVE' : conn === 'connecting' ? 'CONNECTING' : 'OFFLINE';
    this.simBadge.style.display = this.store.simulate ? '' : 'none';
  }

  /* --------------------------- session deck --------------------------- */

  private renderCardDeck(): void {
    const sessions = this.store.sessions.slice(0, MAX_CARDS);
    const seen = new Set<string>();

    sessions.forEach((s, i) => {
      seen.add(s.id);
      let refs = this.cards.get(s.id);
      if (!refs) {
        refs = this.buildCard(s.id);
        this.cards.set(s.id, refs);
        // enter animation, staggered by position
        animate(refs.el, {
          opacity: [0, 1],
          translateY: [10, 0],
          duration: 380,
          delay: i * 24,
          ease: 'out(3)',
        });
      }
      this.updateCard(refs, s);
    });

    // remove cards that fell out of the list
    for (const [id, refs] of this.cards) {
      if (!seen.has(id)) {
        animate(refs.el, {
          opacity: 0,
          translateY: -6,
          duration: 220,
          ease: 'out(2)',
          onComplete: () => refs.el.remove(),
        });
        this.cards.delete(id);
      }
    }
  }

  private buildCard(id: string): CardRefs {
    const elCard = el('div', 'session-card idle clickable', this.sessionsList);
    elCard.dataset.sessionId = id;
    elCard.addEventListener('click', () => this.onSessionSelect?.(id));
    const title = el('div', 'session-title', elCard);
    const meta = el('div', 'session-meta', elCard);
    const dot = el('span', 'model-dot', meta);
    const msgs = el('span', 'stat', meta);
    el('span', undefined, msgs).textContent = 'msg';
    const msgB = el('b', undefined, msgs);
    const tools = el('span', 'stat', meta);
    el('span', undefined, tools).textContent = 'tool';
    const toolB = el('b', undefined, tools);
    const status = el('span', 'session-status idle', meta);
    return { el: elCard, title, status, messages: msgB, tools: toolB, modelDot: dot, meta };
  }

  private updateCard(refs: CardRefs, s: import('@shared/protocol.js').SessionSummary): void {
    if (refs.title.textContent !== s.title) refs.title.textContent = s.title;
    const statusText = s.status === 'live' ? '● live' : s.status === 'error' ? '▲ error' : 'idle';
    if (refs.status.textContent !== statusText) refs.status.textContent = statusText;
    refs.el.className = `session-card ${s.status}`;
    refs.status.className = `session-status ${s.status}`;
    refs.modelDot.style.background = modelColor(s.model);
    refs.modelDot.style.boxShadow = `0 0 6px ${modelColor(s.model)}`;
    tweenNumber(refs.messages, s.messages);
    tweenNumber(refs.tools, s.tools);
  }

  /* ------------------------------ stats ------------------------------ */

  private renderStats(engine: Engine): void {
    const st = this.store.systemState;
    const set = (key: string, value: string | number) => {
      const node = this.stats[key];
      if (!node) return;
      const next = String(value);
      if (node.textContent !== next) node.textContent = next;
    };
    if (st) {
      set('providers', st.providers.filter((p) => !p.disabled).length);
      set('models', st.providers.reduce((acc, p) => acc + p.models.length, 0));
      set('mcp', `${st.mcpServers.filter((m) => m.enabled).length}/${st.mcpServers.length}`);
      set('skills', st.skills.count);
      set('plugins', st.plugins.length);
      set('agents', st.agents.length);
    }
    const live = this.store.sessions.filter((s) => s.status === 'live').length;
    set('live', live);
    set('epm', this.store.eventsPerMin);
    set('total', this.store.totalEvents);
    set('fps', Math.round(engine.fps));
    set('backend', engine.backend.toUpperCase());
  }

  /* ------------------------------- feed ------------------------------- */

  private renderNewFeedItems(): void {
    const feed = this.store.feed;
    const newCount = Math.max(0, this.store.totalEvents - this.renderedEvents);
    if (newCount === 0) {
      this.feedHead.textContent = `${this.store.eventsPerMin}/min`;
      return;
    }
    const fresh = feed.slice(Math.max(0, feed.length - newCount));
    this.renderedEvents = this.store.totalEvents;
    this.feedHead.textContent = `${this.store.eventsPerMin}/min`;

    for (const event of fresh.slice(-4)) {
      const line = feedLine(event);
      const item = el('li', 'feed-item', this.feedList);
      el('span', 't', item).textContent = fmtTime(event.at || Date.now());
      const chip = el('span', `feed-chip ${line.chipClass}`, item);
      chip.textContent = line.chip;
      el('span', 'ses', item).textContent = shortId(event.sessionId);
      el('span', 'msg', item).textContent = line.msg;
      animate(item, {
        opacity: [0, 1],
        translateX: [-14, 0],
        duration: 260,
        ease: 'out(3)',
      });
    }

    // Evict old nodes beyond the visible window, staggered.
    const nodes = Array.from(this.feedList.children) as HTMLElement[];
    const excess = nodes.length - MAX_FEED_NODES;
    if (excess > 0) {
      const doomed = nodes.slice(0, excess);
      animate(doomed, {
        opacity: 0,
        translateX: 10,
        duration: 200,
        ease: 'in(2)',
        onComplete: () => doomed.forEach((n) => n.remove()),
      });
    }
  }
}
