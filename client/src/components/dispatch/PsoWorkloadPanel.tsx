// ============================================================
// RMPG Flex — PSO Workload Panel (Dispatch sidebar)
//
// Shows active Process Server jobs aggregated by officer so a
// dispatcher can see at a glance where the serve workload sits.
// Rendered above the call list when the Serve tab is active.
// Stays fresh via useLiveSync('process-server', ...).
// ============================================================

import { useState, useEffect, useCallback } from 'react';
import { Briefcase, AlertTriangle, Clock } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { useLiveSync } from '../../hooks/useLiveSync';
import { parseTimestamp } from '../../utils/dateUtils';

interface ActiveJob {
  id: number;
  status: string;
  priority: string;
  officer_id: number | null;
  officer_name?: string | null;
  recipient_name?: string | null;
  deadline?: string | null;
  attempt_count?: number;
}

interface OfficerBucket {
  officer_id: number | null;
  officer_name: string;
  total: number;
  urgent: number;
  overdue: number;
  nextDeadline: Date | null;
}

function bucketByOfficer(jobs: ActiveJob[]): OfficerBucket[] {
  const map = new Map<string, OfficerBucket>();
  const now = Date.now();
  for (const j of jobs) {
    const key = j.officer_id != null ? String(j.officer_id) : 'unassigned';
    if (!map.has(key)) {
      map.set(key, {
        officer_id: j.officer_id,
        officer_name: j.officer_name || (j.officer_id != null ? `Officer ${j.officer_id}` : 'Unassigned'),
        total: 0,
        urgent: 0,
        overdue: 0,
        nextDeadline: null,
      });
    }
    const b = map.get(key)!;
    b.total++;
    if (j.priority === 'urgent' || j.priority === 'rush') b.urgent++;
    if (j.deadline) {
      const dl = parseTimestamp(j.deadline);
      if (dl) {
        if (dl.getTime() < now) b.overdue++;
        if (!b.nextDeadline || dl < b.nextDeadline) b.nextDeadline = dl;
      }
    }
  }
  return [...map.values()].sort((a, b) => b.urgent - a.urgent || b.total - a.total);
}

export default function PsoWorkloadPanel() {
  const [jobs, setJobs] = useState<ActiveJob[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<ActiveJob[]>('/process-server?status=pending,attempted,in_progress&limit=100');
      setJobs(Array.isArray(data) ? data : []);
    } catch {
      // non-critical
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useLiveSync('process-server', load);

  const buckets = bucketByOfficer(jobs);
  const urgentTotal = jobs.filter((j) => j.priority === 'urgent' || j.priority === 'rush').length;
  const overdueTotal = buckets.reduce((s, b) => s + b.overdue, 0);

  if (loading || jobs.length === 0) return null;

  return (
    <div
      className="m-2 mb-0 rounded-[2px] p-2.5"
      style={{
        background: 'color-mix(in srgb, var(--sev-special) 6%, transparent)',
        border: '1px solid color-mix(in srgb, var(--sev-special) 22%, transparent)',
      }}
      aria-label="PSO workload summary"
    >
      {/* Header */}
      <div className="flex items-center gap-1.5 mb-2">
        <Briefcase className="w-3 h-3 flex-shrink-0" style={{ color: 'var(--sev-special-soft)' }} />
        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--sev-special-soft)' }}>
          PSO Workload
        </span>
        <span className="ml-auto text-[10px] font-mono tabular-nums" style={{ color: 'var(--sev-special-soft)' }}>
          {jobs.length} active
        </span>
        {urgentTotal > 0 && (
          <span
            className="flex items-center gap-0.5 text-[9px] font-bold px-1 py-0.5 rounded-sm"
            style={{ background: 'color-mix(in srgb, var(--sev-critical) 13%, transparent)', border: '1px solid color-mix(in srgb, var(--sev-critical) 31%, transparent)', color: 'var(--sev-critical)' }}
          >
            <AlertTriangle className="w-2.5 h-2.5" />
            {urgentTotal} URGENT
          </span>
        )}
        {overdueTotal > 0 && (
          <span
            className="flex items-center gap-0.5 text-[9px] font-bold px-1 py-0.5 rounded-sm"
            style={{ background: 'color-mix(in srgb, var(--sev-warn) 13%, transparent)', border: '1px solid color-mix(in srgb, var(--sev-warn) 31%, transparent)', color: 'var(--sev-warn-soft)' }}
          >
            <Clock className="w-2.5 h-2.5" />
            {overdueTotal} OVERDUE
          </span>
        )}
      </div>

      {/* Per-officer rows */}
      <div className="space-y-1">
        {buckets.map((b) => (
          <div key={b.officer_id ?? 'unassigned'} className="flex items-center gap-2 text-[10px]">
            <span className="font-medium truncate max-w-[120px]" style={{ color: 'var(--text-primary)' }}>
              {b.officer_name}
            </span>
            <span className="font-mono tabular-nums" style={{ color: 'var(--sev-special-soft)' }}>
              {b.total} job{b.total !== 1 ? 's' : ''}
            </span>
            {b.urgent > 0 && (
              <span className="font-bold" style={{ color: 'var(--sev-critical)' }}>
                {b.urgent}↑
              </span>
            )}
            {b.overdue > 0 && (
              <span className="font-bold" style={{ color: 'var(--sev-warn-soft)' }}>
                {b.overdue} OD
              </span>
            )}
            {b.nextDeadline && (
              <span className="ml-auto font-mono tabular-nums text-[9px]" style={{ color: 'var(--text-secondary)' }}>
                next {b.nextDeadline.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
