// ============================================================
// Admin Warrant Scrapers Tab — Phase 5
// ============================================================
// Dense multi-select table for bulk scraper operations. Complements
// the ScrapersTab in WarrantsPage — this view is power-user focused:
// no live feed, no distribution chart, just a table + bulk actions.
//
// Bulk actions:
//   - Enable / Disable selected sources
//   - Reset circuit breaker on selected sources
//   - Set priority tier (1-4) on selected sources
//
// Backed by POST /api/warrants/scrapers/bulk from Phase 4.
// ============================================================

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { RefreshCw, CheckSquare, Square, AlertTriangle, Power, PowerOff, RotateCcw } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { useToast } from '../../components/ToastProvider';
import { useContextMenu, type ContextMenuItem } from '../../context/ContextMenuContext';
import { useMenuActions } from '../../utils/contextMenuActions';
import type { ScraperSource, ScraperHealthGrade } from '../../types/scrapers';

interface Props {
  LoadingSpinner: React.ComponentType;
  error: string | null;
  setError: (e: string | null) => void;
}

type BulkAction = 'enable' | 'disable' | 'reset' | 'set_priority';

const GRADE_COLORS: Record<ScraperHealthGrade, string> = {
  A: 'text-green-400',
  B: 'text-lime-400',
  C: 'text-amber-400',
  D: 'text-orange-400',
  F: 'text-red-400',
};

const TIER_LABELS: Record<number, string> = {
  1: 'CRIT',
  2: 'HIGH',
  3: 'NORM',
  4: 'LOW',
};

export default function AdminWarrantScrapersTab({ LoadingSpinner, error, setError }: Props) {
  const [sources, setSources] = useState<ScraperSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [stateFilter, setStateFilter] = useState<string>('all');
  const { addToast } = useToast();

  const fetchAll = useCallback(async () => {
    try {
      setLoading(true);
      const res = await apiFetch<{ sources: ScraperSource[] }>('/warrants/scrapers');
      setSources(res.sources || []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load scrapers');
    } finally {
      setLoading(false);
    }
  }, [setError]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const uniqueStates = useMemo(
    () => Array.from(new Set(sources.map((s) => s.state).filter(Boolean))).sort(),
    [sources],
  );

  const filtered = useMemo(() => {
    if (stateFilter === 'all') return sources;
    return sources.filter((s) => s.state === stateFilter);
  }, [sources, stateFilter]);

  const toggleOne = (key: string) => {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelected(next);
  };

  const toggleAll = () => {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((s) => s.source_key)));
    }
  };

  // Shared bulk runner — targets an explicit set of source keys so the
  // right-click menu can act on a single row without touching `selected`.
  const runBulk = async (action: BulkAction, keys: string[], priority?: number): Promise<boolean> => {
    if (keys.length === 0) return false;
    if (submitting) return false;

    const body: Record<string, unknown> = { action, source_keys: keys };
    if (action === 'set_priority') body.priority = priority;

    try {
      setSubmitting(true);
      const res = await apiFetch<{ success: boolean; affected: number }>(
        '/warrants/scrapers/bulk',
        { method: 'POST', body: JSON.stringify(body) },
      );
      addToast(`Bulk ${action} applied to ${res.affected} source(s)`, 'success');
      await fetchAll();
      return true;
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Bulk op failed', 'error');
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  const bulk = async (action: BulkAction, priority?: number) => {
    if (selected.size === 0) return;
    const ok = await runBulk(action, Array.from(selected), priority);
    if (ok) setSelected(new Set());
  };

  // ── Right-click context menu (per scraper source) ──
  const { openMenu } = useContextMenu();
  const m = useMenuActions();

  const buildSourceMenu = (s: ScraperSource): ContextMenuItem[] => [
    s.enabled
      ? m.action('Disable source', () => runBulk('disable', [s.source_key]), { icon: <PowerOff size={12} />, disabled: submitting })
      : m.action('Enable source', () => runBulk('enable', [s.source_key]), { icon: <Power size={12} />, disabled: submitting }),
    ...(s.circuit_broken
      ? [m.action('Reset circuit breaker', () => runBulk('reset', [s.source_key]), { icon: <RotateCcw size={12} />, disabled: submitting })]
      : []),
    m.separator(),
    m.action('Set priority: Critical', () => runBulk('set_priority', [s.source_key], 1), { disabled: submitting }),
    m.action('Set priority: High', () => runBulk('set_priority', [s.source_key], 2), { disabled: submitting }),
    m.action('Set priority: Normal', () => runBulk('set_priority', [s.source_key], 3), { disabled: submitting }),
    m.action('Set priority: Low', () => runBulk('set_priority', [s.source_key], 4), { disabled: submitting }),
    m.separator(),
    m.copy('Copy source key', s.source_key),
    ...(s.display_name ? [m.copy('Copy name', s.display_name)] : []),
    ...(s.source_url ? [m.openExternal('Open source URL', s.source_url)] : []),
  ];

  if (loading) return <LoadingSpinner />;

  return (
    <div className="space-y-3">
      {error && (
        <div className="panel-inset bg-red-900/20 border border-red-800 p-2 flex items-center gap-2 text-[11px] text-red-300">
          <AlertTriangle size={12} /> {error}
        </div>
      )}

      {/* Header strip */}
      <div className="panel-raised p-3 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3 text-[11px]">
          <span className="uppercase tracking-widest text-[#d4a017] font-bold">
            Warrant Scrapers
          </span>
          <span className="text-rmpg-500">
            {sources.length} total · {selected.size} selected
          </span>
        </div>
        <div className="flex items-center gap-2">
          <select id="ff-adminwarrantscraperstab-0"
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value)}
            className="select-dark text-xs"
          >
            <option value="all">All States</option>
            {uniqueStates.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <button
            onClick={fetchAll}
            className="px-2 py-1 text-xs border border-rmpg-700 hover:bg-rmpg-800 flex items-center gap-1"
          >
            <RefreshCw size={12} /> Refresh
          </button>
        </div>
      </div>

      {/* Bulk action bar — only visible when rows are selected */}
      {selected.size > 0 && (
        <div className="panel-raised p-2 flex items-center gap-1 text-[10px] flex-wrap">
          <span className="text-rmpg-500 uppercase tracking-widest mr-2">
            Bulk:
          </span>
          <button
            onClick={() => bulk('enable')}
            disabled={submitting}
            className="px-2 py-1 border border-rmpg-700 hover:bg-rmpg-800 disabled:opacity-50"
          >
            Enable
          </button>
          <button
            onClick={() => bulk('disable')}
            disabled={submitting}
            className="px-2 py-1 border border-rmpg-700 hover:bg-rmpg-800 disabled:opacity-50"
          >
            Disable
          </button>
          <button
            onClick={() => bulk('reset')}
            disabled={submitting}
            className="px-2 py-1 border border-rmpg-700 hover:bg-rmpg-800 disabled:opacity-50"
          >
            Reset Circuit
          </button>
          <select id="ff-adminwarrantscraperstab-1"
            onChange={(e) => {
              if (e.target.value) {
                bulk('set_priority', parseInt(e.target.value, 10));
                e.target.value = '';
              }
            }}
            disabled={submitting}
            defaultValue=""
            className="select-dark text-[10px] disabled:opacity-50"
          >
            <option value="" disabled>Set Priority…</option>
            <option value="1">1 — Critical</option>
            <option value="2">2 — High</option>
            <option value="3">3 — Normal</option>
            <option value="4">4 — Low</option>
          </select>
          <button
            onClick={() => setSelected(new Set())}
            className="ml-auto px-2 py-1 border border-rmpg-700 hover:bg-rmpg-800"
          >
            Clear selection
          </button>
        </div>
      )}

      {/* Dense table */}
      <div className="panel-raised max-h-[600px] overflow-y-auto scrollbar-dark">
        <table className="w-full text-[10px] font-mono">
          <thead className="bg-rmpg-900 sticky top-0 z-10">
            <tr className="border-b border-rmpg-700">
              <th className="p-2 text-left w-8">
                <button
                  onClick={toggleAll}
                  className="text-rmpg-400 hover:text-white"
                  title="Select all (filtered)"
                >
                  {selected.size === filtered.length && filtered.length > 0 ? (
                    <CheckSquare size={12} />
                  ) : (
                    <Square size={12} />
                  )}
                </button>
              </th>
              <th className="p-2 text-left">Source</th>
              <th className="p-2 text-left w-12">State</th>
              <th className="p-2 text-center w-14">Tier</th>
              <th className="p-2 text-center w-16">Enabled</th>
              <th className="p-2 text-center w-14">Grade</th>
              <th className="p-2 text-right w-16">Runs 24h</th>
              <th className="p-2 text-right w-20">Warrants</th>
              <th className="p-2 text-right w-14">Errors</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={9} className="p-4 text-center text-rmpg-500">
                  No sources match filter
                </td>
              </tr>
            ) : (
              filtered.map((s) => {
                const grade = s.metrics_24h?.health_grade || 'F';
                const isSelected = selected.has(s.source_key);
                return (
                  <tr
                    key={s.source_key}
                    onContextMenu={(e) => openMenu(e, buildSourceMenu(s))}
                    className={`border-t border-rmpg-800 hover:bg-rmpg-800/50 ${isSelected ? 'bg-rmpg-800/30' : ''}`}
                  >
                    <td className="p-2">
                      <button
                        onClick={() => toggleOne(s.source_key)}
                        className="text-rmpg-400 hover:text-white"
                      >
                        {isSelected ? <CheckSquare size={12} /> : <Square size={12} />}
                      </button>
                    </td>
                    <td className="p-2 text-white truncate max-w-[260px]" title={s.display_name}>
                      {s.source_key}
                    </td>
                    <td className="p-2 text-rmpg-400">{s.state}</td>
                    <td className="p-2 text-center text-rmpg-400">
                      {TIER_LABELS[s.priority] || 'NORM'}
                    </td>
                    <td className="p-2 text-center">
                      {s.enabled ? (
                        <span className="text-green-400">●</span>
                      ) : (
                        <span className="text-rmpg-700">○</span>
                      )}
                      {s.circuit_broken ? (
                        <span className="text-red-500 ml-1" title="Circuit broken">✕</span>
                      ) : null}
                    </td>
                    <td className={`p-2 text-center font-bold ${GRADE_COLORS[grade]}`}>
                      {grade}
                    </td>
                    <td className="p-2 text-right text-rmpg-400">
                      {s.metrics_24h?.total_runs ?? 0}
                    </td>
                    <td className="p-2 text-right text-rmpg-400">
                      {s.warrant_count}
                    </td>
                    <td className="p-2 text-right text-rmpg-400">
                      {s.consecutive_errors}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="text-[10px] text-rmpg-600">
        For the full dashboard with live feed and health charts, see{' '}
        <span className="text-[#d4a017]">Warrants → Scrapers tab</span>.
      </div>
    </div>
  );
}
