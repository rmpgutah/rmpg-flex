/**
 * FleetOptimizationHistoryCard — compact table of recent Mapbox Optimization
 * V2 jobs for the current user (or all jobs for admin/manager).
 *
 * Fetches from GET /api/mapbox/optimization-v2 (list endpoint in
 * mapboxOptimizationV2.ts) and displays date, type, status, and a brief
 * description so fleet managers have visibility into past runs.
 *
 * Enriched summary includes: service/vehicle counts, objective, capabilities,
 * requirements, distance/duration, route breakdown, and break info.
 */

import React, { useEffect, useState } from 'react';
import {
  History, RefreshCw, CheckCircle, Loader2, AlertCircle, Clock,
  Route, Users, Target, Wrench, Fuel, ChevronDown, ChevronRight,
} from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';
import { parseTimestamp } from '../../../utils/dateUtils';
import { formatEnumValue } from '../../../utils/formatters';

// ─── Types ────────────────────────────────────────────────────────────────────

interface RouteSummary {
  vehicle: string | null;
  distance_mi: number | null;
  duration_min: number | null;
  stop_count: number;
}

interface JobSummary {
  service_count?: number;
  vehicle_count?: number;
  objective?: string | null;
  avg_mpg?: number | null;
  capabilities?: string[];
  requirements?: string[];
  has_break?: boolean;
  break_duration?: number | null;
  shift_start?: string;
  shift_end?: string;
  route_count?: number;
  dropped_count?: number;
  total_distance_mi?: number;
  total_duration_min?: number;
  route_summaries?: RouteSummary[];
}

interface JobRow {
  id: string;
  job_id?: string;
  job_type: string;
  status: string;
  ref_id: number | null;
  created_by: number;
  created_at: string;
  updated_at: string;
  error_message: string | null;
  summary?: JobSummary;
}

interface ListResponse {
  jobs?: JobRow[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtJobType(t: string): string {
  if (t === 'fleet_route') return 'Fleet Route';
  if (t === 'serve_run') return 'Serve Run';
  if (t === 'patrol_beat') return 'Patrol Beat';
  if (t === 'multi_unit_dispatch') return 'Dispatch';
  return formatEnumValue(t);
}

function fmtDate(iso: string): string {
  try {
    return parseTimestamp(iso).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
      hour12: true, timeZone: 'America/Denver',
    });
  } catch { return iso; }
}

function fmtDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m} min`;
}

function fmtObjective(obj?: string | null): string {
  if (!obj) return '';
  if (obj === 'min-schedule-completion-time') return 'Min Time';
  if (obj === 'min-total-travel-duration') return 'Min Travel';
  return obj.replace(/-/g, ' ');
}

function StatusIcon({ s }: { s: string }) {
  if (s === 'complete') return <CheckCircle className="w-3 h-3 text-green-400" />;
  if (s === 'error') return <AlertCircle className="w-3 h-3 text-red-400" />;
  if (s === 'processing' || s === 'pending') return <Loader2 className="w-3 h-3 text-amber-400 animate-spin" />;
  return <Clock className="w-3 h-3 text-rmpg-500" />;
}

function statusLabel(s: string): string {
  if (s === 'complete') return 'Complete';
  if (s === 'error') return 'Error';
  if (s === 'processing') return 'Running';
  if (s === 'pending') return 'Queued';
  return s;
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  className?: string;
}

export default function FleetOptimizationHistoryCard({ className = '' }: Props) {
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    apiFetch<ListResponse>('/mapbox/optimization-v2')
      .then((res) => {
        setJobs(res?.jobs ?? []);
        setFetchedAt(Date.now());
      })
      .catch(() => setJobs([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  return (
    <div className={`bg-surface-raised border border-rmpg-700 rounded ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-rmpg-700/60">
        <span className="flex items-center gap-2 text-xs font-semibold text-[color:var(--panel-header-color)] uppercase tracking-wide">
          <History className="w-3.5 h-3.5" />
          Optimization History
        </span>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          aria-label="Refresh optimization history"
          className="p-0.5 rounded hover:bg-rmpg-700 text-rmpg-500 hover:text-rmpg-200 disabled:opacity-40 transition-colors"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        {jobs.length === 0 && !loading && (
          <p className="text-[10px] text-rmpg-600 italic px-3 py-2">
            No optimization jobs found.
          </p>
        )}
        {jobs.length > 0 && (
          <table className="w-full text-[10px]">
            <thead>
              <tr className="border-b border-rmpg-700/60">
                <th className="text-left px-3 py-1 font-semibold text-fg-muted uppercase text-[9px] w-4" />
                <th className="text-left px-3 py-1 font-semibold text-fg-muted uppercase text-[9px]">Date</th>
                <th className="text-left px-3 py-1 font-semibold text-fg-muted uppercase text-[9px]">Type</th>
                <th className="text-left px-3 py-1 font-semibold text-fg-muted uppercase text-[9px]">Status</th>
                <th className="text-left px-3 py-1 font-semibold text-fg-muted uppercase text-[9px]">Summary</th>
              </tr>
            </thead>
            <tbody>
              {jobs.slice(0, 20).map((j) => {
                const s = j.summary;
                const isExpanded = expandedId === j.id;
                const hasDetails = j.status === 'complete' && s;

                return (
                  <React.Fragment key={j.id}>
                    <tr
                      className={`border-b border-rmpg-700/30 ${hasDetails ? 'hover:bg-rmpg-700/20 cursor-pointer' : ''}`}
                      onClick={() => hasDetails && toggleExpand(j.id)}
                    >
                      <td className="px-3 py-1 text-fg-muted w-4">
                        {hasDetails && (
                          isExpanded
                            ? <ChevronDown className="w-3 h-3" />
                            : <ChevronRight className="w-3 h-3" />
                        )}
                      </td>
                      <td className="px-3 py-1 text-fg-secondary font-mono whitespace-nowrap">{fmtDate(j.created_at)}</td>
                      <td className="px-3 py-1 text-rmpg-200">{fmtJobType(j.job_type)}</td>
                      <td className="px-3 py-1">
                        <span className="flex items-center gap-1">
                          <StatusIcon s={j.status} />
                          <span className={
                            j.status === 'complete' ? 'text-green-400' :
                            j.status === 'error' ? 'text-red-400' :
                            'text-amber-400'
                          }>
                            {statusLabel(j.status)}
                          </span>
                        </span>
                      </td>
                      <td className="px-3 py-1">
                        {s ? (
                          <span className="flex items-center gap-2 flex-wrap">
                            {s.service_count != null && (
                              <span className="flex items-center gap-0.5 text-fg-secondary" title={`${s.service_count} service stops`}>
                                <Target className="w-2.5 h-2.5 text-fg-muted" />
                                {s.service_count}
                              </span>
                            )}
                            {s.vehicle_count != null && s.vehicle_count > 1 && (
                              <span className="flex items-center gap-0.5 text-fg-secondary" title={`${s.vehicle_count} vehicles`}>
                                <Users className="w-2.5 h-2.5 text-fg-muted" />
                                {s.vehicle_count}
                              </span>
                            )}
                            {s.total_distance_mi != null && (
                              <span className="text-fg-muted font-mono" title={`${s.total_distance_mi} miles total`}>
                                {s.total_distance_mi} mi
                              </span>
                            )}
                            {s.total_duration_min != null && (
                              <span className="text-fg-muted font-mono" title={`${s.total_duration_min} minutes total`}>
                                {fmtDuration(s.total_duration_min * 60)}
                              </span>
                            )}
                            {s.objective && (
                              <span className="text-fg-muted" title={`Objective: ${fmtObjective(s.objective)}`}>
                                {fmtObjective(s.objective)}
                              </span>
                            )}
                            {s.has_break && (
                              <span className="text-fg-muted" title={`Break: ${fmtDuration(s.break_duration ?? 0)}`}>
                                ☕
                              </span>
                            )}
                            {s.dropped_count != null && s.dropped_count > 0 && (
                              <span className="text-red-400" title={`${s.dropped_count} dropped services`}>
                                ⚠ {s.dropped_count}
                              </span>
                            )}
                          </span>
                        ) : j.status === 'error' ? (
                          <span className="text-red-400 truncate max-w-[140px]" title={j.error_message ?? ''}>
                            {j.error_message ?? 'Failed'}
                          </span>
                        ) : null}
                      </td>
                    </tr>

                    {/* Expanded detail row */}
                    {isExpanded && s && (
                      <tr className="border-b border-rmpg-700/20 bg-surface-sunken/50">
                        <td colSpan={5} className="px-3 py-2">
                          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[9px]">
                            {/* Left column — problem config */}
                            <div className="space-y-1">
                              <div className="text-[9px] font-semibold text-fg-muted uppercase mb-1">Configuration</div>
                              {s.objective && (
                                <div className="flex items-center gap-1.5">
                                  <Target className="w-2.5 h-2.5 text-fg-muted" />
                                  <span className="text-fg-secondary">Objective:</span>
                                  <span className="text-rmpg-200">{fmtObjective(s.objective)}</span>
                                </div>
                              )}
                              {s.shift_start && (
                                <div className="flex items-center gap-1.5">
                                  <Clock className="w-2.5 h-2.5 text-fg-muted" />
                                  <span className="text-fg-secondary">Shift:</span>
                                  <span className="text-rmpg-200">
                                    {fmtDate(s.shift_start)} – {s.shift_end ? fmtDate(s.shift_end) : '—'}
                                  </span>
                                </div>
                              )}
                              {s.avg_mpg && (
                                <div className="flex items-center gap-1.5">
                                  <Fuel className="w-2.5 h-2.5 text-fg-muted" />
                                  <span className="text-fg-secondary">Avg MPG:</span>
                                  <span className="text-rmpg-200">{s.avg_mpg}</span>
                                </div>
                              )}
                              {s.capabilities && s.capabilities.length > 0 && (
                                <div className="flex items-center gap-1.5">
                                  <Wrench className="w-2.5 h-2.5 text-fg-muted" />
                                  <span className="text-fg-secondary">Caps:</span>
                                  <span className="text-rmpg-200">{s.capabilities.join(', ')}</span>
                                </div>
                              )}
                              {s.requirements && s.requirements.length > 0 && (
                                <div className="flex items-center gap-1.5">
                                  <Wrench className="w-2.5 h-2.5 text-fg-muted" />
                                  <span className="text-fg-secondary">Reqs:</span>
                                  <span className="text-rmpg-200">{s.requirements.join(', ')}</span>
                                </div>
                              )}
                              {s.has_break && (
                                <div className="flex items-center gap-1.5">
                                  <Clock className="w-2.5 h-2.5 text-fg-muted" />
                                  <span className="text-fg-secondary">Break:</span>
                                  <span className="text-rmpg-200">{fmtDuration(s.break_duration ?? 0)}</span>
                                </div>
                              )}
                            </div>

                            {/* Right column — solution results */}
                            <div className="space-y-1">
                              <div className="text-[9px] font-semibold text-fg-muted uppercase mb-1">Results</div>
                              {s.route_count != null && (
                                <div className="flex items-center gap-1.5">
                                  <Route className="w-2.5 h-2.5 text-fg-muted" />
                                  <span className="text-fg-secondary">Routes:</span>
                                  <span className="text-rmpg-200">{s.route_count}</span>
                                </div>
                              )}
                              {s.total_distance_mi != null && (
                                <div className="flex items-center gap-1.5">
                                  <Route className="w-2.5 h-2.5 text-fg-muted" />
                                  <span className="text-fg-secondary">Distance:</span>
                                  <span className="text-rmpg-200">{s.total_distance_mi} mi</span>
                                </div>
                              )}
                              {s.total_duration_min != null && (
                                <div className="flex items-center gap-1.5">
                                  <Clock className="w-2.5 h-2.5 text-fg-muted" />
                                  <span className="text-fg-secondary">Duration:</span>
                                  <span className="text-rmpg-200">{fmtDuration(s.total_duration_min * 60)}</span>
                                </div>
                              )}
                              {s.dropped_count != null && s.dropped_count > 0 && (
                                <div className="flex items-center gap-1.5">
                                  <AlertCircle className="w-2.5 h-2.5 text-red-400" />
                                  <span className="text-red-400">Dropped:</span>
                                  <span className="text-red-400">{s.dropped_count}</span>
                                </div>
                              )}

                              {/* Per-route breakdown */}
                              {s.route_summaries && s.route_summaries.length > 0 && (
                                <div className="mt-1.5 space-y-0.5">
                                  {s.route_summaries.map((r, i) => (
                                    <div key={i} className="flex items-center gap-2 text-fg-muted pl-3">
                                      <span className="text-fg-secondary font-mono">{r.vehicle ?? `R${i + 1}`}</span>
                                      {r.distance_mi != null && <span>{r.distance_mi} mi</span>}
                                      {r.duration_min != null && <span>{fmtDuration(r.duration_min * 60)}</span>}
                                      <span className="text-fg-muted">{r.stop_count} stops</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {fetchedAt && (
        <div className="px-3 py-1 text-[9px] text-rmpg-700 border-t border-rmpg-700/30">
          Fetched {new Date(fetchedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })} {/* new-date-ok: fetchedAt is a Date.now() epoch number, not a server string */}
        </div>
      )}
    </div>
  );
}
