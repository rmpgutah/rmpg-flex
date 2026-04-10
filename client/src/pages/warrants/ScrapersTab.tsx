// ============================================================
// Warrant Scrapers Tab
// ============================================================
// Admin + dispatcher view into the warrant scraper system:
//   - Header strip with healthy / degraded / failed / broken LEDs
//   - A-F health distribution bar chart
//   - Live event feed (WebSocket-driven)
//   - Filterable source list with inline-expandable detail + actions
//
// Consumes /api/warrants/scrapers (list) and /api/warrants/scrapers/health
// (polled every 30s). Subscribes to the 'scraper_event' WS message type
// for live run lifecycle updates.
// ============================================================

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  RefreshCw,
  Search,
  ChevronDown,
  Zap,
  RotateCw,
  Eye,
  AlertTriangle,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { useWebSocket } from '../../context/WebSocketContext';
import { useToast } from '../../components/ToastProvider';
import type {
  ScraperSource,
  ScraperHealthSummary,
  ScraperWsEvent,
  ScraperHealthGrade,
} from '../../types/scrapers';
import type { WSMessage } from '../../types';

// ── Configuration ───────────────────────────────────────────

const HEALTH_POLL_MS = 30_000;
const LIVE_FEED_CAPACITY = 50;

const TIER_LABELS: Record<number, string> = {
  1: 'CRIT',
  2: 'HIGH',
  3: 'NORM',
  4: 'LOW',
};

const GRADE_BAR_COLORS: Record<ScraperHealthGrade, string> = {
  A: 'bg-green-500',
  B: 'bg-lime-500',
  C: 'bg-amber-500',
  D: 'bg-orange-500',
  F: 'bg-red-500',
};

const GRADE_BADGE_CLASSES: Record<ScraperHealthGrade, string> = {
  A: 'text-green-400 bg-green-900/20 border-green-800',
  B: 'text-lime-400 bg-lime-900/20 border-lime-800',
  C: 'text-amber-400 bg-amber-900/20 border-amber-800',
  D: 'text-orange-400 bg-orange-900/20 border-orange-800',
  F: 'text-red-400 bg-red-900/20 border-red-800',
};

// ── Helpers ─────────────────────────────────────────────────

type GradeFilter = 'all' | ScraperHealthGrade;

interface LiveFeedEntry {
  id: number; // monotonic local counter for React keys
  timestamp: string;
  event: ScraperWsEvent;
}

/**
 * Format a single live feed event into its display shape.
 *
 * TODO(user-contribution): Define how each ScraperWsEvent type is rendered
 * in the live feed. This function is the single source of truth for the
 * visual language of the feed — return { color, icon, label, detail } for
 * each event variant. See the dispatch feed pattern or dispatch console
 * logs for inspiration.
 *
 * Events you need to handle (see ScraperWsEvent discriminated union):
 *   - run_started      (neutral / informational)
 *   - run_completed    (success — but `unchanged: true` means cache hit)
 *   - run_failed       (error)
 *   - circuit_broken   (critical alert)
 *   - circuit_restored (recovery)
 *
 * Constraints:
 *   - `color` must be a Tailwind text class ('text-green-400', etc.)
 *   - `icon` is a single character (●, ◐, ○, ✕, ↻) or short glyph
 *   - `label` should be ≤ 12 chars, uppercase, terminal-feel
 *   - `detail` is the human-readable right-side text
 */
interface LiveFeedDisplay {
  color: string;
  icon: string;
  label: string;
  detail: string;
}

function formatLiveFeedEvent(e: ScraperWsEvent): LiveFeedDisplay {
  switch (e.event) {
    case 'run_started':
      return {
        color: 'text-rmpg-400',
        icon: '●',
        label: 'STARTED',
        detail: `${e.display_name} · T${e.priority}`,
      };
    case 'run_completed':
      if (e.unchanged) {
        return {
          color: 'text-rmpg-500',
          icon: '◐',
          label: 'CACHED',
          detail: `${e.display_name} (no change)`,
        };
      }
      return {
        color: 'text-green-400',
        icon: '●',
        label: 'OK',
        detail: `${e.display_name} — ${e.parsed} parsed, ${e.inserted} new, ${e.updated} updated`,
      };
    case 'run_failed':
      return {
        color: 'text-red-400',
        icon: '✕',
        label: 'FAILED',
        detail: `${e.display_name} — ${e.error.substring(0, 80)}`,
      };
    case 'circuit_broken':
      return {
        color: 'text-red-500',
        icon: '⚠',
        label: 'BROKEN',
        detail: `${e.display_name} — recovery in ${e.backoff_hours}h (${e.consecutive_errors} errors)`,
      };
    case 'circuit_restored':
      return {
        color: 'text-lime-400',
        icon: '↻',
        label: 'RESTORED',
        detail: `${e.display_name} — back online`,
      };
  }
}

// ── Subcomponents ───────────────────────────────────────────

function StatusLed({
  color,
  label,
  count,
}: {
  color: 'green' | 'amber' | 'red' | 'dark';
  label: string;
  count: number;
}) {
  const colorMap = {
    green: 'bg-green-500 shadow-[0_0_6px_#22c55e]',
    amber: 'bg-amber-500 shadow-[0_0_6px_#f59e0b]',
    red: 'bg-red-500 shadow-[0_0_6px_#ef4444]',
    dark: 'bg-rmpg-700',
  };
  return (
    <div className="flex items-center gap-2">
      <span className={`w-2 h-2 rounded-full ${colorMap[color]}`} />
      <span className="text-lg font-mono font-bold text-white">{count}</span>
      <span className="text-[10px] uppercase tracking-widest text-rmpg-500">
        {label}
      </span>
    </div>
  );
}

function ScraperHealthHeader({
  summary,
  onRefresh,
}: {
  summary: ScraperHealthSummary;
  onRefresh: () => void;
}) {
  return (
    <div className="panel-raised p-3 flex items-center gap-4 flex-wrap">
      <StatusLed color="green" label="Healthy" count={summary.healthy} />
      <StatusLed color="amber" label="Degraded" count={summary.degraded} />
      <StatusLed color="red" label="Failed" count={summary.failed} />
      <StatusLed color="dark" label="Broken" count={summary.circuit_broken} />
      <div className="flex-1" />
      <div className="text-[10px] uppercase tracking-widest text-rmpg-500">
        Last hour:{' '}
        <span className="text-[#d4a017] font-bold">{summary.last_hour_runs}</span> runs,{' '}
        <span className="text-[#d4a017] font-bold">{summary.last_hour_inserted}</span>{' '}
        new
      </div>
      <button
        onClick={onRefresh}
        className="px-2 py-1 text-xs border border-rmpg-700 hover:bg-rmpg-800 flex items-center gap-1"
      >
        <RefreshCw size={12} /> Refresh
      </button>
    </div>
  );
}

function ScraperHealthDistribution({
  sources,
}: {
  sources: ScraperSource[];
}) {
  const counts: Record<ScraperHealthGrade, number> = { A: 0, B: 0, C: 0, D: 0, F: 0 };
  for (const s of sources) {
    const g = s.metrics_24h?.health_grade || 'F';
    counts[g]++;
  }
  const total = sources.length || 1;
  const grades: ScraperHealthGrade[] = ['A', 'B', 'C', 'D', 'F'];

  return (
    <div className="panel-raised p-3">
      <div className="text-[10px] uppercase tracking-widest text-[#d4a017] font-bold mb-2">
        Health Distribution (24h)
      </div>
      <div className="space-y-1.5">
        {grades.map((g) => {
          const pct = (counts[g] / total) * 100;
          return (
            <div key={g} className="flex items-center gap-2">
              <span className="w-4 text-xs font-mono font-bold text-white">{g}</span>
              <div className="flex-1 h-4 bg-rmpg-900 border border-rmpg-700 relative">
                <div
                  className={`h-full ${GRADE_BAR_COLORS[g]}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="w-10 text-right text-xs font-mono text-rmpg-400">
                {counts[g]}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ScraperLiveFeed({ entries }: { entries: LiveFeedEntry[] }) {
  return (
    <div className="panel-raised p-3 h-full max-h-[240px] flex flex-col">
      <div className="text-[10px] uppercase tracking-widest text-[#d4a017] font-bold mb-2">
        Live Feed
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-dark space-y-0.5 font-mono text-[10px]">
        {entries.length === 0 ? (
          <div className="text-rmpg-600">Waiting for events...</div>
        ) : (
          entries.map((entry) => {
            const display = formatLiveFeedEvent(entry.event);
            const time = new Date(entry.timestamp).toLocaleTimeString().slice(0, 8);
            return (
              <div key={entry.id} className="flex items-start gap-2">
                <span className="text-rmpg-600 w-14 flex-shrink-0">{time}</span>
                <span className={`${display.color} w-3`}>{display.icon}</span>
                <span className="text-rmpg-400 w-14 flex-shrink-0">
                  {display.label}
                </span>
                <span className="text-white truncate flex-1">{display.detail}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function ScraperSourceCard({
  source,
  onRefresh,
}: {
  source: ScraperSource;
  onRefresh: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const { addToast } = useToast();
  const grade = source.metrics_24h?.health_grade || 'F';
  const m = source.metrics_24h;

  const trigger = async () => {
    try {
      await apiFetch(`/warrants/scrapers/${source.source_key}/trigger`, {
        method: 'POST',
      });
      addToast('Scrape triggered', 'success');
      setTimeout(onRefresh, 2000);
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Trigger failed', 'error');
    }
  };

  const reset = async () => {
    try {
      await apiFetch(`/warrants/scrapers/${source.source_key}/reset-circuit`, {
        method: 'POST',
      });
      addToast('Circuit reset', 'success');
      onRefresh();
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Reset failed', 'error');
    }
  };

  return (
    <div className="panel-raised">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-2 flex items-center gap-2 hover:bg-rmpg-800/50 text-left"
      >
        <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 bg-rmpg-900 text-rmpg-400 border border-rmpg-700 w-12 text-center">
          {TIER_LABELS[source.priority] || 'NORM'}
        </span>
        <span className="text-xs text-white flex-1 truncate">{source.display_name}</span>
        <span className="text-[10px] text-rmpg-500 w-10 text-right">{source.state}</span>
        <span
          className={`text-[10px] font-mono font-bold px-1.5 py-0.5 border w-6 text-center ${GRADE_BADGE_CLASSES[grade]}`}
        >
          {grade}
        </span>
        <span className="text-[10px] text-rmpg-500 w-16 text-right font-mono">
          {m ? `${Math.round(m.success_rate * 100)}%` : '—'}
        </span>
        <span className="text-[10px] text-rmpg-500 w-12 text-right font-mono">
          {source.warrant_count}
        </span>
        <ChevronDown
          size={12}
          className={`text-rmpg-500 transition-transform ${expanded ? 'rotate-180' : ''}`}
        />
      </button>

      {expanded && (
        <div className="p-3 border-t border-rmpg-800 space-y-2 text-[10px]">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <span className="text-rmpg-500">URL: </span>
              <span className="text-white break-all">{source.source_url}</span>
            </div>
            <div>
              <span className="text-rmpg-500">Last success: </span>
              <span className="text-white">
                {source.last_success_at
                  ? new Date(source.last_success_at).toLocaleString()
                  : 'never'}
              </span>
            </div>
            <div>
              <span className="text-rmpg-500">Runs 24h: </span>
              <span className="text-white">{m?.total_runs ?? 0}</span>
            </div>
            <div>
              <span className="text-rmpg-500">Avg parsed: </span>
              <span className="text-white">{m?.avg_parsed?.toFixed(1) ?? 0}</span>
            </div>
            <div>
              <span className="text-rmpg-500">p95 latency: </span>
              <span className="text-white">{m?.p95_duration_ms ?? 0}ms</span>
            </div>
            <div>
              <span className="text-rmpg-500">Consecutive errors: </span>
              <span className="text-white">{source.consecutive_errors}</span>
            </div>
          </div>

          {m?.last_error && (
            <div className="bg-red-900/20 border border-red-800 p-2 flex items-start gap-2">
              <AlertTriangle size={12} className="text-red-400 flex-shrink-0 mt-0.5" />
              <div className="text-red-400 text-[10px] font-mono break-words">
                {m.last_error}
              </div>
            </div>
          )}

          <div className="flex items-center gap-1 pt-1">
            <button
              onClick={trigger}
              className="px-2 py-1 text-[10px] border border-rmpg-700 hover:bg-rmpg-800 flex items-center gap-1"
            >
              <Zap size={10} /> Trigger
            </button>
            <button
              onClick={reset}
              className="px-2 py-1 text-[10px] border border-rmpg-700 hover:bg-rmpg-800 flex items-center gap-1"
            >
              <RotateCw size={10} /> Reset Circuit
            </button>
            <a
              href={source.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="px-2 py-1 text-[10px] border border-rmpg-700 hover:bg-rmpg-800 flex items-center gap-1"
            >
              <Eye size={10} /> View Source
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main tab component ──────────────────────────────────────

export default function ScrapersTab() {
  const [sources, setSources] = useState<ScraperSource[]>([]);
  const [summary, setSummary] = useState<ScraperHealthSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [stateFilter, setStateFilter] = useState<string>('all');
  const [gradeFilter, setGradeFilter] = useState<GradeFilter>('all');
  const [feedEntries, setFeedEntries] = useState<LiveFeedEntry[]>([]);
  const feedCounter = useRef(0);
  const { subscribe } = useWebSocket();

  const fetchAll = useCallback(async () => {
    try {
      const [srcRes, healthRes] = await Promise.all([
        apiFetch<{ sources: ScraperSource[] }>('/warrants/scrapers'),
        apiFetch<ScraperHealthSummary>('/warrants/scrapers/health'),
      ]);
      setSources(srcRes.sources || []);
      setSummary(healthRes);
    } catch (e) {
      console.error('[ScrapersTab] fetchAll failed:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load + poll
  useEffect(() => {
    fetchAll();
    const int = setInterval(fetchAll, HEALTH_POLL_MS);
    return () => clearInterval(int);
  }, [fetchAll]);

  // Subscribe to live scraper events
  useEffect(() => {
    const handler = (msg: WSMessage) => {
      const data = (msg as any).data as ScraperWsEvent | undefined;
      if (!data || typeof data.event !== 'string') return;

      feedCounter.current += 1;
      const entry: LiveFeedEntry = {
        id: feedCounter.current,
        timestamp: new Date().toISOString(),
        event: data,
      };
      setFeedEntries((prev) => [entry, ...prev].slice(0, LIVE_FEED_CAPACITY));

      // run_completed / circuit_broken / circuit_restored all affect aggregate
      // counts — do a lightweight refetch when one of these fires.
      if (
        data.event === 'run_completed' ||
        data.event === 'circuit_broken' ||
        data.event === 'circuit_restored'
      ) {
        fetchAll();
      }
    };

    const unsubscribe = subscribe('scraper_event', handler);
    return () => unsubscribe();
  }, [subscribe, fetchAll]);

  const uniqueStates = useMemo(
    () => Array.from(new Set(sources.map((s) => s.state).filter(Boolean))).sort(),
    [sources],
  );

  const filtered = useMemo(() => {
    return sources.filter((s) => {
      if (stateFilter !== 'all' && s.state !== stateFilter) return false;
      if (gradeFilter !== 'all' && s.metrics_24h?.health_grade !== gradeFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          s.source_key.toLowerCase().includes(q) ||
          (s.display_name || '').toLowerCase().includes(q) ||
          (s.state || '').toLowerCase().includes(q) ||
          (s.county || '').toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [sources, stateFilter, gradeFilter, search]);

  if (loading) {
    return <div className="p-4 text-rmpg-500 text-xs">Loading scraper status...</div>;
  }

  return (
    <div className="flex flex-col h-full min-h-0 panel-base p-3 space-y-3">
      {summary && <ScraperHealthHeader summary={summary} onRefresh={fetchAll} />}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="lg:col-span-2">
          <ScraperHealthDistribution sources={sources} />
        </div>
        <div>
          <ScraperLiveFeed entries={feedEntries} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 panel-raised p-2">
        <div className="flex items-center gap-1 flex-1 min-w-[200px]">
          <Search size={14} className="text-rmpg-500" />
          <input
            type="text"
            placeholder="Search sources..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input-dark flex-1 text-xs"
          />
        </div>
        <select
          value={stateFilter}
          onChange={(e) => setStateFilter(e.target.value)}
          className="select-dark text-xs"
        >
          <option value="all">All States</option>
          {uniqueStates.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          value={gradeFilter}
          onChange={(e) => setGradeFilter(e.target.value as GradeFilter)}
          className="select-dark text-xs"
        >
          <option value="all">All Grades</option>
          <option value="A">A</option>
          <option value="B">B</option>
          <option value="C">C</option>
          <option value="D">D</option>
          <option value="F">F</option>
        </select>
        <button
          onClick={fetchAll}
          className="px-2 py-1 text-xs border border-rmpg-700 hover:bg-rmpg-800 flex items-center gap-1"
        >
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto space-y-1 scrollbar-dark">
        {filtered.length === 0 ? (
          <div className="p-4 text-center text-rmpg-500 text-xs">
            No sources match filters
          </div>
        ) : (
          filtered.map((s) => (
            <ScraperSourceCard key={s.source_key} source={s} onRefresh={fetchAll} />
          ))
        )}
      </div>
    </div>
  );
}
