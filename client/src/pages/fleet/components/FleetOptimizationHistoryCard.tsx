/**
 * FleetOptimizationHistoryCard — compact table of recent Mapbox Optimization
 * V2 jobs for the current user (or all jobs for admin/manager).
 *
 * Fetches from GET /api/mapbox/optimization-v2 (list endpoint in
 * mapboxOptimizationV2.ts) and displays date, type, status, and a brief
 * description so fleet managers have visibility into past runs.
 */

import React, { useEffect, useState } from 'react';
import { History, RefreshCw, CheckCircle, Loader2, AlertCircle, Clock } from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';
import { parseTimestamp } from '../../../utils/dateUtils';

// ─── Types ────────────────────────────────────────────────────────────────────

interface JobRow {
  id: string;
  job_type: string;
  status: string;
  ref_id: number | null;
  created_by: number;
  created_at: string;
  updated_at: string;
  error_message: string | null;
}

interface ListResponse {
  jobs?: JobRow[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtJobType(t: string): string {
  if (t === 'serve_run') return 'Serve Run';
  if (t === 'patrol_beat') return 'Patrol Beat';
  if (t === 'multi_unit_dispatch') return 'Dispatch';
  return t.replace(/_/g, ' ');
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
                <th className="text-left px-3 py-1 font-semibold text-rmpg-400 uppercase text-[9px]">Date</th>
                <th className="text-left px-3 py-1 font-semibold text-rmpg-400 uppercase text-[9px]">Type</th>
                <th className="text-left px-3 py-1 font-semibold text-rmpg-400 uppercase text-[9px]">Status</th>
                <th className="text-left px-3 py-1 font-semibold text-rmpg-400 uppercase text-[9px]">Job ID</th>
              </tr>
            </thead>
            <tbody>
              {jobs.slice(0, 20).map((j) => (
                <tr key={j.id} className="border-b border-rmpg-700/30 hover:bg-rmpg-700/20">
                  <td className="px-3 py-1 text-rmpg-300 font-mono whitespace-nowrap">{fmtDate(j.created_at)}</td>
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
                  <td className="px-3 py-1 font-mono text-rmpg-600 truncate max-w-[120px]" title={j.id}>
                    {j.id.slice(0, 12)}…
                  </td>
                </tr>
              ))}
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
