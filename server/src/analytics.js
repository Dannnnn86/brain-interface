/**
 * analytics.js — aggregate statistics over recorded events.
 *
 * Sources: the durable events/*.jsonl recordings (last 30 calendar days).
 * Two scopes: `all` (includes simulator) and `real` (simulated:false only) —
 * the HUD has a toggle; honest numbers matter more than pretty ones.
 *
 * Derived metrics:
 *   - toolHealth: calls / results / okRate / avgMs per tool, paired
 *     chronologically per session (call → next result), name-independent
 *     so simulator and real data both pair correctly.
 *   - activity: events + unique sessions per day (30-day sparkline).
 *   - models: event + session counts per model id.
 *   - heatmap: 7×24 grid (Mon=0 rows, LOCAL hour) for "when you work".
 *   - errors: total + last 10 with context.
 *   - skillUsage: skill-tool invocations grouped by argsSummary (≈ skill name).
 *   - byType: raw event-type counts (drives the brain region heat share).
 *
 * Cached 60s per scope.
 */
const CACHE_TTL_MS = 60_000;
const WINDOW_DAYS = 30;
const MAX_EVENTS_PER_DAY = 20_000;

let cache = { key: '', at: 0, data: null };

/** Last N UTC day keys (matches recorder file naming), oldest first. */
function windowDays(n) {
  const out = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
    out.push(d.toISOString().slice(0, 10).replace(/-/g, ''));
  }
  return out;
}

function emptyToolStat() {
  return { calls: 0, results: 0, ok: 0, failed: 0, totalMs: 0, nMs: 0 };
}

const EPISODE_GAP_MS = 10 * 60_000;

export function buildAnalytics({ recorder, skills = [] }, scope = 'all') {
  if (cache.data && cache.key === scope && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.data;
  }
  const knownSkills = skills.map((s) => String(s).toLowerCase());

  const days = windowDays(WINDOW_DAYS);
  const available = new Set(recorder.days());
  const events = [];
  for (const day of days) {
    if (!available.has(day)) continue;
    events.push(...recorder.read(day, MAX_EVENTS_PER_DAY));
  }

  const simulatedCount = events.filter((e) => e.simulated).length;
  const scoped = scope === 'real' ? events.filter((e) => !e.simulated) : events;

  const bySession = new Map();
  for (const e of scoped) {
    let arr = bySession.get(e.sessionId);
    if (!arr) {
      arr = [];
      bySession.set(e.sessionId, arr);
    }
    arr.push(e);
  }

  /* ------------------------- per-session pairing ------------------------- */

  const toolStats = new Map();
  const perDay = new Map(days.map((d) => [d, { events: 0, sessions: new Set() }]));
  const hourGrid = Array.from({ length: 7 }, () => new Array(24).fill(0));
  const modelCounts = new Map();
  const modelSessions = new Map();
  const skillRaw = new Map();
  const byType = {};
  const errorList = [];
  const tokenLatest = new Map(); // sessionId -> { tokens, cost, model, title }
  const sessionErrors = new Map(); // sessionId -> [at...]
  const sessionTitles = new Map(); // sessionId -> last seen title
  let errors = 0;
  let toolCalls = 0;

  for (const [sessionId, arr] of bySession) {
    arr.sort((a, b) => (a.at || 0) - (b.at || 0));
    const pendingCalls = [];
    let sessionModel = null;

    for (const e of arr) {
      const at = e.at || Date.now();
      // day bucket (UTC, matches recorder files)
      const dayKey = new Date(at).toISOString().slice(0, 10).replace(/-/g, '');
      const dayAgg = perDay.get(dayKey);
      if (dayAgg) {
        dayAgg.events += 1;
        dayAgg.sessions.add(sessionId);
      }
      // heatmap (LOCAL time — reflects Dan's actual working hours)
      const local = new Date(at);
      hourGrid[(local.getDay() + 6) % 7][local.getHours()] += 1;

      byType[e.type] = (byType[e.type] || 0) + 1;
      if (e.model && !sessionModel) sessionModel = e.model;
      if (e.model) modelCounts.set(e.model, (modelCounts.get(e.model) || 0) + 1);
      if (e.title) sessionTitles.set(sessionId, e.title);
      if (e.type === 'session.tokens' && e.tokens) {
        tokenLatest.set(sessionId, {
          tokens: e.tokens,
          cost: e.cost || 0,
          model: e.model || sessionModel || '',
        });
      }
      if (e.type === 'session.error' || (e.type === 'tool.result' && e.ok === false)) {
        let arr2 = sessionErrors.get(sessionId);
        if (!arr2) {
          arr2 = [];
          sessionErrors.set(sessionId, arr2);
        }
        arr2.push(at);
      }

      switch (e.type) {
        case 'tool.call': {
          toolCalls += 1;
          pendingCalls.push(e.tool || 'tool');
          const s = toolStats.get(e.tool || 'tool') || emptyToolStat();
          s.calls += 1;
          toolStats.set(e.tool || 'tool', s);
          if (e.tool === 'skill') {
            const name = (e.argsSummary || '').trim().slice(0, 60) || 'unknown';
            skillRaw.set(name, (skillRaw.get(name) || 0) + 1);
          }
          break;
        }
        case 'tool.result': {
          const name = pendingCalls.shift() || e.tool || 'tool';
          const s = toolStats.get(name) || emptyToolStat();
          s.results += 1;
          if (e.ok === false) s.failed += 1;
          else s.ok += 1;
          if (Number.isFinite(e.durationMs)) {
            s.totalMs += e.durationMs;
            s.nMs += 1;
          }
          toolStats.set(name, s);
          if (e.ok === false) {
            errors += 1;
            if (errorList.length < 200) {
              errorList.push({
                at,
                sessionId,
                simulated: e.simulated === true,
                error: e.error || `tool failed: ${name}`,
              });
            }
          }
          break;
        }
        case 'session.error': {
          errors += 1;
          if (errorList.length < 200) {
            errorList.push({ at, sessionId, simulated: e.simulated === true, error: e.error || 'session error' });
          }
          break;
        }
        default:
          break;
      }
    }

    if (sessionModel) modelSessions.set(sessionModel, (modelSessions.get(sessionModel) || 0) + 1);
  }

  const toolHealth = [...toolStats.entries()]
    .map(([tool, s]) => ({
      tool,
      calls: s.calls,
      results: s.results,
      ok: s.ok,
      failed: s.failed,
      okRate: s.results > 0 ? Math.round((s.ok / s.results) * 1000) / 1000 : null,
      avgMs: s.nMs > 0 ? Math.round(s.totalMs / s.nMs) : null,
    }))
    .sort((a, b) => b.calls - a.calls)
    .slice(0, 20);

  /* ------------------------- tokens & cost (cumulative per session) ------------------------- */

  const tokenTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, sessions: 0 };
  const tokensByModel = new Map();
  for (const entry of tokenLatest.values()) {
    const t = entry.tokens;
    tokenTotals.input += t.input;
    tokenTotals.output += t.output;
    tokenTotals.cacheRead += t.cacheRead;
    tokenTotals.cacheWrite += t.cacheWrite;
    tokenTotals.cost += entry.cost;
    tokenTotals.sessions += 1;
    if (entry.model) {
      const m = tokensByModel.get(entry.model) || { input: 0, output: 0, cost: 0 };
      m.input += t.input;
      m.output += t.output;
      m.cost += entry.cost;
      tokensByModel.set(entry.model, m);
    }
  }

  /* ------------------------- error episodes → problem sessions ------------------------- */

  const problemSessions = [];
  for (const [sessionId, errorAts] of sessionErrors) {
    errorAts.sort((a, b) => a - b);
    let episodes = 1;
    for (let i = 1; i < errorAts.length; i++) {
      if (errorAts[i] - errorAts[i - 1] > EPISODE_GAP_MS) episodes += 1;
    }
    const sample = bySession.get(sessionId)?.[0] || {};
    problemSessions.push({
      sessionId,
      title: sessionTitles.get(sessionId) || 'Untitled session',
      errors: errorAts.length,
      episodes,
      firstAt: errorAts[0],
      lastAt: errorAts[errorAts.length - 1],
      simulated: sample.simulated === true,
    });
  }
  problemSessions.sort((a, b) => b.errors - a.errors);

  /* ------------------------- unknown skills (hygiene signal) ------------------------- */

  const isKnownSkill = (name) => {
    const n = name.toLowerCase();
    return knownSkills.some((k) => k.length > 2 && (n.includes(k) || k.includes(n)));
  };
  const unknownSkills = [...skillRaw.entries()]
    .filter(([name]) => knownSkills.length > 0 && !isKnownSkill(name))
    .map(([skill, calls]) => ({ skill, calls }))
    .sort((a, b) => b.calls - a.calls)
    .slice(0, 10);

  const data = {
    generatedAt: Date.now(),
    scope,
    windowDays: WINDOW_DAYS,
    counts: {
      total: events.length,
      simulated: simulatedCount,
      real: events.length - simulatedCount,
      scoped: scoped.length,
      toolCalls,
      errors,
      sessions: bySession.size,
    },
    byType,
    toolHealth,
    activity: {
      days: days.map((d) => {
        const agg = perDay.get(d);
        return { day: d, events: agg?.events || 0, sessions: agg?.sessions.size || 0 };
      }),
    },
    models: [...modelCounts.entries()]
      .map(([model, count]) => ({
        model,
        events: count,
        sessions: modelSessions.get(model) || 0,
        tokens: tokensByModel.get(model) || null,
      }))
      .sort((a, b) => b.events - a.events)
      .slice(0, 15),
    heatmap: { rows: hourGrid }, // 7 rows Mon=0, 24 cols
    errors: { total: errors, recent: errorList.slice(-10).reverse() },
    skillUsage: [...skillRaw.entries()]
      .map(([skill, calls]) => ({ skill, calls }))
      .sort((a, b) => b.calls - a.calls)
      .slice(0, 40),
    tokens: tokenLatest.size > 0 ? tokenTotals : null,
    problemSessions: problemSessions.slice(0, 10),
    unknownSkills,
  };

  cache = { key: scope, at: Date.now(), data };
  return data;
}
