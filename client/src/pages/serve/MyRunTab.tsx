// client/src/pages/serve/MyRunTab.tsx
// ─────────────────────────────────────────────────────────────────────────────
// My Run tab — officer-scoped view of today's serve jobs.
//
// Features:
//   1. Folder-aware grouping (In Progress → Queue → Served → Non-Service → Archived)
//   2. Linear progress bar: served/total
//   3. Completion banner when all active jobs are resolved
//   4. Next-job highlight card with prominent Navigate button
//   5. Emits 'serve:statusChanged' custom event for cross-tab sync
//   6. Accepts optional `jobs`/`onJobsChange` props from ServePage so the
//      Queue tab folder view updates immediately when My Run logs a status
// ─────────────────────────────────────────────────────────────────────────────

import { type Dispatch, type SetStateAction, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  Loader2,
  MapPin,
  Navigation,
  RefreshCw,
  Trophy,
  XCircle,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import ServeStatusFolder from '../../components/serve/ServeStatusFolder';
import type { ServeFolder, ServeJob } from '../../types';
import { deriveServeFolder, SERVE_FOLDER_CONFIG } from '../../types';
import { toDisplayLabel } from '../../utils/formatters';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function fmtDuration(ms: number): string {
  const totalMins = Math.floor(ms / 60_000);
  if (totalMins < 60) return `${totalMins}m`;
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function priorityColor(p: string): string {
  switch (p) {
    case 'urgent': return 'text-red-400';
    case 'rush':   return 'text-amber-400';
    case 'normal': return 'text-rmpg-300';
    default:       return 'text-rmpg-500'; // routine
  }
}

// ─── Status mark quick-actions ───────────────────────────────────────────────

/** POST a quick served/failed status update. Returns the new status string. */
async function quickStatusUpdate(jobId: number, result: 'served' | 'failed'): Promise<string> {
  const attemptType = result === 'served' ? 'personal' : 'failed';
  const res = await apiFetch<{ queue_status: string }>(`/process-server/${jobId}/attempt`, {
    method: 'POST',
    body: JSON.stringify({
      attempt_type: attemptType,
      result,
      address_verified: false,
    }),
  });
  return res?.queue_status ?? result;
}

// ─── Navigate helper ──────────────────────────────────────────────────────────

function openNavigation(job: ServeJob): void {
  if (job.recipient_lat != null && job.recipient_lng != null) {
    window.open(
      `https://www.google.com/maps/dir/?api=1&destination=${job.recipient_lat},${job.recipient_lng}`,
      '_blank',
      'noopener,noreferrer',
    );
  } else if (job.recipient_address) {
    const full = [
      job.recipient_address,
      (job as any).recipient_address_2,
      job.recipient_city,
      job.recipient_state,
      job.recipient_zip,
    ].filter(Boolean).join(', ');
    window.open(
      `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(full)}`,
      '_blank',
      'noopener,noreferrer',
    );
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface RunJobRowProps {
  job: ServeJob;
  isNext: boolean;
  onOptimisticUpdate: (jobId: number, newStatus: ServeJob['status']) => void;
}

function RunJobRow({ job, isNext, onOptimisticUpdate }: RunJobRowProps) {
  const [actioning, setActioning] = useState<'served' | 'failed' | null>(null);
  const isClosed = job.status === 'served' || job.status === 'failed' || job.status === 'archived' || job.status === 'skipped';

  const handleQuick = useCallback(async (result: 'served' | 'failed') => {
    if (isClosed || actioning) return;
    setActioning(result);
    try {
      const newStatus = (await quickStatusUpdate(job.id, result)) as ServeJob['status'];
      // Emit cross-tab event
      window.dispatchEvent(new CustomEvent('serve:statusChanged', {
        detail: { jobId: job.id, newStatus },
      }));
      onOptimisticUpdate(job.id, newStatus);
    } catch {
      // swallow — row stays as-is; server error doesn't brick the UI
    } finally {
      setActioning(null);
    }
  }, [job.id, isClosed, actioning, onOptimisticUpdate]);

  const hasAddress = !!(job.recipient_address);

  return (
    <div
      className={`flex items-start gap-2 px-3 py-2 rounded-[2px] border transition-all duration-150 ${
        isNext
          ? 'border-brand-400/50 bg-brand-400/5 shadow-[0_0_8px_rgba(212,160,23,0.08)]'
          : 'border-border-default bg-surface-sunken'
      }`}
    >
      {/* Status dot */}
      <span
        className={`mt-0.5 w-2 h-2 rounded-full flex-shrink-0 ${SERVE_FOLDER_CONFIG[deriveServeFolder(job)].dotClass}`}
        aria-hidden
      />

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-1.5 flex-wrap">
          <span className={`text-[11px] font-medium ${isClosed ? 'text-rmpg-400 line-through' : 'text-rmpg-100'}`}>
            {job.recipient_name}
          </span>
          <span className={`text-[9px] uppercase font-semibold ${priorityColor(job.priority)}`}>
            {job.priority}
          </span>
          {isNext && !isClosed && (
            <span className="text-[9px] font-bold text-brand-400 uppercase tracking-wide">
              NEXT
            </span>
          )}
        </div>
        <div className="text-[10px] text-rmpg-500 truncate mt-0.5">
          {job.recipient_address
            ? [job.recipient_address, (job as any).recipient_address_2, job.recipient_city].filter(Boolean).join(', ')
            : '— no address —'}
        </div>
        {job.deadline && (
          <div className="text-[9px] text-rmpg-600 mt-0.5">
            Due {job.deadline} · {job.attempt_count} attempt{job.attempt_count === 1 ? '' : 's'}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 flex-shrink-0">
        {/* Navigate */}
        {hasAddress && !isClosed && (
          <button
            type="button"
            onClick={() => openNavigation(job)}
            className={`flex items-center gap-0.5 px-2 py-1 text-[10px] font-medium rounded-[2px] border transition-all duration-150 focus:outline-none focus:ring-1 focus:ring-brand-400/40 ${
              isNext
                ? 'text-rmpg-100 bg-brand-400/80 border-brand-400 hover:bg-brand-400 shadow-[0_0_6px_rgba(212,160,23,0.2)]'
                : 'text-brand-400 border-brand-400/40 bg-transparent hover:bg-brand-400/10'
            }`}
            aria-label={`Navigate to ${job.recipient_name}`}
          >
            <Navigation size={10} />
            {isNext ? 'Navigate' : ''}
          </button>
        )}

        {/* Quick served */}
        {!isClosed && (
          <button
            type="button"
            disabled={!!actioning}
            onClick={() => handleQuick('served')}
            className="p-1 rounded-[2px] text-green-500 hover:text-green-400 hover:bg-green-900/20 border border-transparent hover:border-green-700/40 transition-all duration-150 focus:outline-none focus:ring-1 focus:ring-green-500/40 disabled:opacity-40"
            aria-label="Mark served"
            title="Mark served"
          >
            {actioning === 'served'
              ? <Loader2 size={13} className="animate-spin" />
              : <CheckCircle2 size={13} />}
          </button>
        )}

        {/* Quick non-service */}
        {!isClosed && (
          <button
            type="button"
            disabled={!!actioning}
            onClick={() => handleQuick('failed')}
            className="p-1 rounded-[2px] text-red-500 hover:text-red-400 hover:bg-red-900/20 border border-transparent hover:border-red-700/40 transition-all duration-150 focus:outline-none focus:ring-1 focus:ring-red-500/40 disabled:opacity-40"
            aria-label="Mark non-service"
            title="Mark non-service"
          >
            {actioning === 'failed'
              ? <Loader2 size={13} className="animate-spin" />
              : <XCircle size={13} />}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Next Job Card ─────────────────────────────────────────────────────────────

function NextJobCard({ job, onOptimisticUpdate }: { job: ServeJob; onOptimisticUpdate: (id: number, s: ServeJob['status']) => void }) {
  const [actioning, setActioning] = useState<'served' | 'failed' | null>(null);
  const isClosed = job.status === 'served' || job.status === 'failed' || job.status === 'archived' || job.status === 'skipped';
  const hasAddress = !!(job.recipient_address);

  const handleQuick = useCallback(async (result: 'served' | 'failed') => {
    if (isClosed || actioning) return;
    setActioning(result);
    try {
      const newStatus = (await quickStatusUpdate(job.id, result)) as ServeJob['status'];
      window.dispatchEvent(new CustomEvent('serve:statusChanged', {
        detail: { jobId: job.id, newStatus },
      }));
      onOptimisticUpdate(job.id, newStatus);
    } catch {
      // swallow
    } finally {
      setActioning(null);
    }
  }, [job.id, actioning, onOptimisticUpdate]);

  return (
    <div className="mx-0 mb-3 px-3 py-3 rounded-[2px] border-l-4 border-l-brand-400 border border-brand-400/30 bg-brand-400/5">
      {/* Header row */}
      <div className="flex items-center gap-2 mb-2">
        <MapPin size={13} className="text-brand-400 flex-shrink-0" aria-hidden />
        <span className="text-[10px] font-bold text-brand-400 uppercase tracking-wider">Next Stop</span>
        <span className={`ml-auto text-[9px] uppercase font-bold ${priorityColor(job.priority)}`}>
          {job.priority}
        </span>
      </div>

      {/* Recipient */}
      <div className="text-[13px] font-semibold text-rmpg-100 mb-0.5 truncate">{job.recipient_name}</div>
      <div className="text-[11px] text-rmpg-400 mb-2 truncate">
        {job.recipient_address
          ? [job.recipient_address, (job as any).recipient_address_2, job.recipient_city, job.recipient_state]
              .filter(Boolean).join(', ')
          : '— no address on file —'}
      </div>

      {/* Meta */}
      <div className="flex items-center gap-3 mb-3 text-[9px] text-rmpg-600 uppercase">
        {job.document_type && <span>{toDisplayLabel(job.document_type)}</span>}
        {job.deadline && <span>Due {job.deadline}</span>}
        {job.attempt_count > 0 && (
          <span className="text-amber-600">{job.attempt_count} prior attempt{job.attempt_count === 1 ? '' : 's'}</span>
        )}
        {job.case_number && <span className="font-mono">{job.case_number}</span>}
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2">
        {hasAddress && (
          <button
            type="button"
            onClick={() => openNavigation(job)}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold text-rmpg-100 bg-brand-400 hover:bg-brand-400/80 border border-brand-400 rounded-[2px] transition-all duration-150 shadow-[0_0_8px_rgba(212,160,23,0.2)] hover:shadow-[0_0_12px_rgba(212,160,23,0.35)] focus:outline-none focus:ring-2 focus:ring-brand-400/50"
            aria-label={`Navigate to ${job.recipient_name}`}
          >
            <Navigation size={12} />
            Navigate
          </button>
        )}
        <button
          type="button"
          disabled={!!actioning}
          onClick={() => handleQuick('served')}
          className="flex items-center justify-center gap-1 px-3 py-1.5 text-[11px] font-medium text-green-400 bg-green-900/20 hover:bg-green-900/40 border border-green-700/40 rounded-[2px] transition-all duration-150 focus:outline-none focus:ring-1 focus:ring-green-500/40 disabled:opacity-40"
          aria-label="Mark served"
        >
          {actioning === 'served' ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />}
          Served
        </button>
        <button
          type="button"
          disabled={!!actioning}
          onClick={() => handleQuick('failed')}
          className="flex items-center justify-center gap-1 px-3 py-1.5 text-[11px] font-medium text-red-400 bg-red-900/20 hover:bg-red-900/40 border border-red-700/40 rounded-[2px] transition-all duration-150 focus:outline-none focus:ring-1 focus:ring-red-500/40 disabled:opacity-40"
          aria-label="Mark non-service"
        >
          {actioning === 'failed' ? <Loader2 size={11} className="animate-spin" /> : <XCircle size={11} />}
          Non-Service
        </button>
      </div>

      {/* Service instructions */}
      {job.service_instructions && (
        <div className="mt-2 px-2 py-1.5 bg-surface-sunken border border-rmpg-700 rounded-[2px] text-[10px] text-rmpg-400 italic">
          {job.service_instructions}
        </div>
      )}
    </div>
  );
}

// ─── Progress Bar ─────────────────────────────────────────────────────────────

function ProgressBar({ served, total }: { served: number; total: number }) {
  const pct = total > 0 ? Math.round((served / total) * 100) : 0;
  const complete = pct === 100 && total > 0;
  return (
    <div className="px-3 py-2 border-b border-rmpg-700 bg-surface-sunken">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[9px] font-semibold uppercase text-rmpg-500 tracking-wider">
          Run Progress
        </span>
        <span className={`text-[10px] font-mono tabular-nums font-bold ${complete ? 'text-green-400' : 'text-rmpg-300'}`}>
          {served}/{total} served
          {total > 0 && ` (${pct}%)`}
        </span>
      </div>
      <div className="w-full h-1.5 bg-surface-overlay rounded-full overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div
          className={`h-full rounded-full transition-all duration-500 ease-out ${
            complete
              ? 'bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.4)]'
              : pct > 0
                ? 'bg-brand-400 shadow-[0_0_6px_rgba(212,160,23,0.25)]'
                : 'bg-rmpg-700'
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ─── Completion Banner ────────────────────────────────────────────────────────

function CompletionBanner({ startedAt, served, total }: { startedAt: number | null; served: number; total: number }) {
  const successRate = total > 0 ? Math.round((served / total) * 100) : 0;
  const elapsed = startedAt ? Date.now() - startedAt : null;

  return (
    <div className="mx-3 mb-3 px-4 py-3 rounded-[2px] border border-green-500/40 bg-green-900/15 flex items-start gap-3">
      <Trophy size={18} className="text-green-400 flex-shrink-0 mt-0.5" aria-hidden />
      <div>
        <div className="text-[12px] font-bold text-green-400 mb-0.5">Run Complete!</div>
        <div className="text-[11px] text-rmpg-300">
          {served}/{total} served ({successRate}% success rate)
          {elapsed && elapsed > 0 && ` · ${fmtDuration(elapsed)} total`}
        </div>
        <div className="text-[9px] text-rmpg-500 mt-1 uppercase tracking-wide">
          All active jobs have been resolved for today.
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export interface MyRunTabProps {
  officerId: number;
  /** Optional: shared jobs array from ServePage (when passed, My Run reads+writes from parent state). */
  sharedJobs?: ServeJob[];
  /** Optional: the ServePage `setJobs` dispatcher — propagates optimistic updates to the Queue tab instantly. */
  onJobsChange?: Dispatch<SetStateAction<ServeJob[]>>;
}

const FOLDER_ORDER: ServeFolder[] = ['in_progress', 'pending', 'served', 'failed', 'archived'];

export default function MyRunTab({ officerId, sharedJobs, onJobsChange }: MyRunTabProps) {
  const today = useMemo(() => todayIso(), []);
  const runStartRef = useRef<number | null>(null);

  // ── Local state (used when ServePage doesn't share its jobs) ──────────
  const [localJobs, setLocalJobs] = useState<ServeJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastFetched, setLastFetched] = useState<number | null>(null);

  // Resolve which set of jobs to display
  const allJobs: ServeJob[] = sharedJobs ?? localJobs;

  // ── Fetch (used when no sharedJobs) ──────────────────────────────────
  const fetchRun = useCallback(async () => {
    if (sharedJobs) return; // parent owns data
    setLoading(true);
    try {
      // Use the main endpoint (supports officer_id) and filter by serve_date client-side
      const raw = await apiFetch<ServeJob[]>(`/process-server?officer_id=${officerId}&limit=200`);
      const todayJobs = (raw ?? []).filter(j => (j.serve_date ?? '').startsWith(today));
      setLocalJobs(todayJobs);
      setLastFetched(Date.now());
    } catch {
      setLocalJobs([]);
    } finally {
      setLoading(false);
    }
  }, [officerId, today, sharedJobs]);

  useEffect(() => {
    fetchRun();
  }, [fetchRun]);

  // ── Listen for serve:statusChanged cross-tab events ─────────────────────
  // When running in standalone mode (no sharedJobs), we own localJobs and
  // must update it ourselves when another component fires this event.
  // In shared mode, ServePage owns `jobs` and has its own listener — skip.
  useEffect(() => {
    if (sharedJobs) return; // parent handles it
    const handler = (e: Event) => {
      const { jobId, newStatus } = (e as CustomEvent<{ jobId: number; newStatus: string }>).detail;
      setLocalJobs((prev) =>
        prev.map((j) =>
          j.id === jobId
            ? { ...j, status: newStatus as ServeJob['status'] }
            : j,
        ),
      );
    };
    window.addEventListener('serve:statusChanged', handler);
    return () => window.removeEventListener('serve:statusChanged', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!sharedJobs]); // only re-bind when the mode switches

  // ── Optimistic update (in-component quick actions) ────────────────────
  const handleOptimisticUpdate = useCallback((jobId: number, newStatus: ServeJob['status']) => {
    const update = (prev: ServeJob[]): ServeJob[] =>
      prev.map((j) =>
        j.id === jobId
          ? {
              ...j,
              status: newStatus,
              attempt_count: j.attempt_count + 1,
              closed_at:
                newStatus === 'served' || newStatus === 'failed'
                  ? new Date().toISOString()
                  : j.closed_at,
            }
          : j,
      );

    if (sharedJobs) {
      onJobsChange?.(update);
    } else {
      setLocalJobs(update);
    }
  }, [sharedJobs, onJobsChange]);

  // ── Filter to today + this officer ───────────────────────────────────
  const todayOfficerJobs = useMemo(() => {
    if (sharedJobs) {
      // When parent provides all jobs, filter by officer + today's date
      return sharedJobs.filter(
        (j) => j.officer_id === officerId && (j.serve_date ?? '').startsWith(today),
      );
    }
    return allJobs; // already filtered in fetch
  }, [allJobs, sharedJobs, officerId, today]);

  // ── Progress metrics ──────────────────────────────────────────────────
  const { totalToday, servedToday, activeJobs } = useMemo(() => {
    const total = todayOfficerJobs.length;
    const served = todayOfficerJobs.filter((j) => j.status === 'served').length;
    const active = todayOfficerJobs.filter(
      (j) => j.status === 'pending' || j.status === 'in_progress',
    );
    return { totalToday: total, servedToday: served, activeJobs: active };
  }, [todayOfficerJobs]);

  // ── Run completion detection ──────────────────────────────────────────
  const runComplete = totalToday > 0 && activeJobs.length === 0;

  // Track when we first see active jobs (approximates run start time)
  useEffect(() => {
    if (activeJobs.length > 0 && runStartRef.current === null) {
      runStartRef.current = Date.now() - (totalToday * 8 * 60_000); // rough estimate
    }
  }, [activeJobs.length, totalToday]);

  // ── Next job ──────────────────────────────────────────────────────────
  const nextJob = useMemo((): ServeJob | null => {
    // in_progress first, then pending; within each group: urgent→rush→normal→routine, then deadline ASC
    const candidates = todayOfficerJobs.filter(
      (j) => j.status === 'in_progress' || j.status === 'pending',
    );
    if (candidates.length === 0) return null;

    const priorityRank = (p: string) =>
      p === 'urgent' ? 1 : p === 'rush' ? 2 : p === 'normal' ? 3 : 4;
    const statusRank = (s: string) => (s === 'in_progress' ? 0 : 1);

    return [...candidates].sort((a, b) => {
      const sr = statusRank(a.status) - statusRank(b.status);
      if (sr !== 0) return sr;
      const pr = priorityRank(a.priority) - priorityRank(b.priority);
      if (pr !== 0) return pr;
      if (a.deadline && b.deadline) return a.deadline.localeCompare(b.deadline);
      if (a.deadline) return -1;
      if (b.deadline) return 1;
      return (a.sort_order ?? 0) - (b.sort_order ?? 0);
    })[0];
  }, [todayOfficerJobs]);

  // ── Group by folder ───────────────────────────────────────────────────
  const byFolder = useMemo((): Record<ServeFolder, ServeJob[]> => {
    const groups: Record<ServeFolder, ServeJob[]> = {
      in_progress: [], pending: [], served: [], failed: [], archived: [],
    };
    for (const job of todayOfficerJobs) {
      groups[deriveServeFolder(job)].push(job);
    }
    return groups;
  }, [todayOfficerJobs]);

  // ─────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────

  if (loading && todayOfficerJobs.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 text-xs text-rmpg-400">
        <Loader2 size={14} className="animate-spin mr-2 text-rmpg-500" aria-hidden />
        Loading your run…
      </div>
    );
  }

  if (!loading && todayOfficerJobs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-center px-6">
        <Clock size={24} className="text-rmpg-600 mb-2" aria-hidden />
        <p className="text-sm text-rmpg-400 font-medium">No jobs assigned to you for today.</p>
        <p className="text-[10px] text-rmpg-600 mt-1">
          Jobs assigned to you on {today} will appear here.
        </p>
        {!sharedJobs && (
          <button
            type="button"
            onClick={fetchRun}
            className="mt-3 flex items-center gap-1 px-3 py-1.5 text-[11px] font-medium text-rmpg-400 bg-surface-sunken border border-rmpg-700 rounded-[2px] hover:border-rmpg-400 transition-colors focus:outline-none focus:ring-1 focus:ring-rmpg-500/40"
          >
            <RefreshCw size={11} />
            Refresh
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-surface-base">
      {/* ── Progress bar ─────────────────────────────────────────── */}
      <ProgressBar served={servedToday} total={totalToday} />

      {/* ── Scrollable body ──────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-dark">
        <div className="p-3 space-y-3">

          {/* ── Completion banner ──────────────────────────────── */}
          {runComplete && (
            <CompletionBanner
              startedAt={runStartRef.current}
              served={servedToday}
              total={totalToday}
            />
          )}

          {/* ── Next Job card (shown when run is NOT complete) ──── */}
          {!runComplete && nextJob && (
            <NextJobCard job={nextJob} onOptimisticUpdate={handleOptimisticUpdate} />
          )}

          {/* ── Folder-grouped job list ─────────────────────────── */}
          <div className="space-y-2">
            {FOLDER_ORDER.map((folder) => {
              const folderJobs = byFolder[folder];
              const cfg = SERVE_FOLDER_CONFIG[folder];
              // Skip the archived folder entirely if it's empty
              if (folder === 'archived' && folderJobs.length === 0) return null;

              return (
                <ServeStatusFolder
                  key={folder}
                  status={folder}
                  label={cfg.label}
                  defaultOpen={cfg.defaultOpen}
                  count={folderJobs.length}
                >
                  {folderJobs.map((job) => (
                    <RunJobRow
                      key={job.id}
                      job={job}
                      isNext={nextJob?.id === job.id && !runComplete}
                      onOptimisticUpdate={handleOptimisticUpdate}
                    />
                  ))}
                </ServeStatusFolder>
              );
            })}
          </div>

          {/* ── Refresh footer (standalone mode only) ─────────────── */}
          {!sharedJobs && lastFetched && (
            <div className="flex items-center justify-between pt-1 border-t border-rmpg-800">
              <span className="text-[9px] text-rmpg-600">
                Updated {new Date(lastFetched).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
              <button
                type="button"
                onClick={fetchRun}
                disabled={loading}
                className="flex items-center gap-1 text-[9px] text-rmpg-500 hover:text-rmpg-300 transition-colors disabled:opacity-40 focus:outline-none"
                aria-label="Refresh my run"
              >
                <RefreshCw size={9} className={loading ? 'animate-spin' : ''} />
                Refresh
              </button>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
