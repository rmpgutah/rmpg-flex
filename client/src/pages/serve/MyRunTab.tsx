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
import { useNavigate, type NavigateFunction } from 'react-router';
import {
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Loader2,
  MapPin,
  Navigation,
  RefreshCw,
  Route,
  Trophy,
  XCircle,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import ServeStatusFolder from '../../components/serve/ServeStatusFolder';
import type { ServeFolder, ServeJob } from '../../types';
import { deriveServeFolder, SERVE_FOLDER_CONFIG } from '../../types';
import { formatEnumValue, toDisplayLabel } from '../../utils/formatters';
import { parseTimestamp } from '../../utils/dateUtils';
import { useServeRunOptimization } from './hooks/useServeRunOptimization';

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
      // Device clock + device timezone = the true instant of the attempt.
      // The server default would stamp when the POST lands, which drifts on a
      // queued or slow submit from the field.
      attempt_at: new Date().toISOString(),
    }),
  });
  return res?.queue_status ?? result;
}

// ─── Navigate helper ──────────────────────────────────────────────────────────
// Routes to the app's own in-app Navigation page (NavigationPage.tsx honors
// ?destination=&lat=&lng= as a deep link — see NavPage.tsx's favorite links)
// instead of shelling out to an external map site. Keeps the officer's trip
// logged against this serve stop rather than leaving the app entirely.

async function openNavigation(job: ServeJob, navigate: NavigateFunction): Promise<void> {
  const label = encodeURIComponent(job.recipient_name || 'Serve stop');
  if (job.recipient_lat != null && job.recipient_lng != null) {
    navigate(`/navigation?destination=${label}&lat=${job.recipient_lat}&lng=${job.recipient_lng}`);
    return;
  }
  if (!job.recipient_address) return;
  const full = [
    job.recipient_address,
    job.recipient_address_2,
    job.recipient_city,
    job.recipient_state,
    job.recipient_zip,
  ].filter(Boolean).join(', ');
  try {
    const geo = await apiFetch<{ results: Array<{ lat: string; lon: string }> }>(`/geocode/search?q=${encodeURIComponent(full)}&limit=1`);
    const hit = geo?.results?.[0];
    if (!hit) return;
    navigate(`/navigation?destination=${label}&lat=${hit.lat}&lng=${hit.lon}`);
  } catch {
    // best-effort — no toast plumbing at this scope; button simply no-ops on failure
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface RunJobRowProps {
  job: ServeJob;
  isNext: boolean;
  onOptimisticUpdate: (jobId: number, newStatus: ServeJob['status']) => void;
  navigate: NavigateFunction;
  routeStop?: number;
  /** Formatted ETA string from optimization (shown next to the address). */
  eta?: string;
}

function RunJobRow({ job, isNext, onOptimisticUpdate, navigate, routeStop, eta }: RunJobRowProps) {
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
          ? 'border-brand-400/50 bg-brand-400/5 shadow-[0_0_8px_rgb(var(--accent-silver-400-rgb)/0.08)]'
          : 'border-border-default bg-surface-sunken'
      }`}
    >
      {/* Route stop number (when a plan is active) or status dot */}
      {routeStop != null ? (
        <span className="mt-0.5 w-4 h-4 rounded-full flex-shrink-0 flex items-center justify-center text-[9px] font-bold bg-rmpg-700 text-rmpg-200 leading-none" aria-label={`Stop ${routeStop}`}>
          {routeStop}
        </span>
      ) : (
        <span
          className={`mt-0.5 w-2 h-2 rounded-full flex-shrink-0 ${SERVE_FOLDER_CONFIG[deriveServeFolder(job)].dotClass}`}
          aria-hidden
        />
      )}

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-1.5 flex-wrap">
          <span className={`text-[11px] font-medium ${isClosed ? 'text-rmpg-400 line-through' : 'text-rmpg-100'}`}>
            {job.recipient_name}
          </span>
          <span className={`text-[9px] uppercase font-semibold ${priorityColor(job.priority)}`}>
            {formatEnumValue(job.priority)}
          </span>
          {isNext && !isClosed && (
            <span className="text-[9px] font-bold text-brand-400 uppercase tracking-wide">
              NEXT
            </span>
          )}
        </div>
        <div className="text-[10px] text-rmpg-500 truncate mt-0.5">
          {job.recipient_address
            ? [job.recipient_address, job.recipient_address_2, job.recipient_city].filter(Boolean).join(', ')
            : '— no address —'}
          {eta && (
            <span className="ml-1.5 text-[9px] text-brand-400 font-medium">ETA {eta}</span>
          )}
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
            onClick={() => openNavigation(job, navigate)}
            className={`flex items-center gap-0.5 px-2 py-1 text-[10px] font-medium rounded-[2px] border transition-all duration-150 focus:outline-none focus:ring-1 focus:ring-brand-400/40 ${
              isNext
                ? 'text-rmpg-100 bg-brand-400/80 border-brand-400 hover:bg-brand-400 shadow-[0_0_6px_rgb(var(--accent-silver-400-rgb)/0.2)]'
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

function NextJobCard({ job, onOptimisticUpdate, navigate, routeStop }: { job: ServeJob; onOptimisticUpdate: (id: number, s: ServeJob['status']) => void; navigate: NavigateFunction; routeStop?: number }) {
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
        <span className="text-[10px] font-bold text-brand-400 uppercase tracking-wider">
          Next Stop{routeStop != null ? ` · #${routeStop}` : ''}
        </span>
        <span className={`ml-auto text-[9px] uppercase font-bold ${priorityColor(job.priority)}`}>
          {formatEnumValue(job.priority)}
        </span>
      </div>

      {/* Recipient */}
      <div className="text-[13px] font-semibold text-rmpg-100 mb-0.5 truncate">{job.recipient_name}</div>
      <div className="text-[11px] text-rmpg-400 mb-2 truncate">
        {job.recipient_address
          ? [job.recipient_address, job.recipient_address_2, job.recipient_city, job.recipient_state]
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
            onClick={() => openNavigation(job, navigate)}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold text-rmpg-100 bg-brand-400 hover:bg-brand-400/80 border border-brand-400 rounded-[2px] transition-all duration-150 shadow-[0_0_8px_rgb(var(--accent-silver-400-rgb)/0.2)] hover:shadow-[0_0_12px_rgb(var(--accent-silver-400-rgb)/0.35)] focus:outline-none focus:ring-2 focus:ring-brand-400/50"
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
                ? 'bg-brand-400 shadow-[0_0_6px_rgb(var(--accent-silver-400-rgb)/0.25)]'
                : 'bg-rmpg-700'
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ─── Completion Banner ────────────────────────────────────────────────────────

/**
 * Tone for the end-of-run banner.
 *
 * The banner used to be unconditionally green + Trophy + "Run Complete!" — it
 * computed `successRate` purely to print it and never let it affect the
 * styling. On the live board that produced a gold trophy and a green
 * celebration over "0/1 served (0% success rate)", where the single job was a
 * non-service. Congratulating an officer for a shift that served nobody is
 * both wrong and quietly corrosive to how much the banner is trusted.
 *
 * The bands below are a judgement call, made deliberately conservative:
 *
 *   • The banner only appears once EVERY active job is resolved for the day, so
 *     the run is finished in all three cases. What varies is how much the tone
 *     claims about it — not whether the officer is done.
 *   • In process serving a documented non-service is a legitimate, diligent and
 *     billable outcome. A low served-rate is therefore NOT failure, and none of
 *     these bands scold. The worst case is neutral, never negative.
 *   • Only the top band celebrates. A trophy that appears every day stops
 *     meaning anything, and one that appears over 0/1 served actively teaches
 *     officers to ignore the banner.
 *
 * Tune the two numbers here and nothing else needs to change — every consumer
 * reads the returned tone rather than re-deriving it.
 *
 * Constraint enforced by the return type: accent is 'green' | 'silver' | 'amber'
 * only. Red is reserved for CAD safety severity, and a slow serve day is not a
 * safety event. Amber is available but unused — it reads as overdue-style
 * urgency, which is wrong for work that is already finished.
 */
const RUN_TONE_CELEBRATE_AT = 80; // strong day — worth the trophy
const RUN_TONE_NEUTRAL_AT = 40;   // ordinary day — acknowledged, not praised

function runTone(successRate: number): {
  accent: 'green' | 'silver' | 'amber';
  title: string;
  icon: typeof Trophy;
} {
  // The ICON carries as much of the message as the colour — a trophy over
  // "Run Closed Out" would undo the whole point of the wording — so it moves
  // with the band rather than staying pinned to Trophy.
  if (successRate >= RUN_TONE_CELEBRATE_AT) {
    return { accent: 'green', title: 'Run Complete!', icon: Trophy };
  }
  if (successRate >= RUN_TONE_NEUTRAL_AT) {
    return { accent: 'silver', title: 'Run Complete', icon: CheckCircle2 };
  }
  // Amber band: some attempts were made but <40% succeeded — a caution signal,
  // not a celebration, but also not a blank slate. 0% (all doors closed, no
  // serves possible) stays silver — that's a diligent documented outcome, not a
  // performance concern. A slow day is never red (not a safety event).
  if (successRate > 0) {
    return { accent: 'amber', title: 'Run Closed Out', icon: XCircle };
  }
  return { accent: 'silver', title: 'Run Closed Out', icon: ClipboardCheck };
}

const TONE_STYLES: Record<'green' | 'silver' | 'amber', { wrap: string; icon: string; title: string }> = {
  green:  { wrap: 'border-green-500/40 bg-green-900/15',                              icon: 'text-green-400',         title: 'text-green-400' },
  silver: { wrap: 'border-accent-silver-500/40 bg-accent-silver-500/10',              icon: 'text-accent-silver-300', title: 'text-accent-silver-300' },
  amber:  { wrap: 'border-amber-500/40 bg-amber-900/15',                              icon: 'text-amber-400',         title: 'text-amber-400' },
};

function CompletionBanner({ startedAt, served, total }: { startedAt: number | null; served: number; total: number }) {
  const successRate = total > 0 ? Math.round((served / total) * 100) : 0;
  const elapsed = startedAt ? Date.now() - startedAt : null;
  const tone = runTone(successRate);
  const styles = TONE_STYLES[tone.accent];
  const ToneIcon = tone.icon;

  return (
    <div className={`mx-3 mb-3 px-4 py-3 rounded-[2px] border flex items-start gap-3 ${styles.wrap}`}>
      <ToneIcon size={18} className={`${styles.icon} flex-shrink-0 mt-0.5`} aria-hidden />
      <div>
        <div className={`text-[12px] font-bold mb-0.5 ${styles.title}`}>{tone.title}</div>
        <div className="text-[11px] text-text-secondary">
          {served}/{total} served ({successRate}% success rate)
          {elapsed && elapsed > 0 && ` · ${fmtDuration(elapsed)} total`}
        </div>
        <div className="text-[9px] text-fg-muted mt-1 uppercase tracking-wide">
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
  /** Ordered job IDs from the saved route plan — when provided, active jobs sort by route sequence and show stop numbers. */
  routeOrderIds?: number[];
}

const FOLDER_ORDER: ServeFolder[] = ['in_progress', 'pending', 'served', 'failed', 'archived'];

export default function MyRunTab({ officerId, sharedJobs, onJobsChange, routeOrderIds }: MyRunTabProps) {
  const navigate = useNavigate();
  const today = useMemo(() => todayIso(), []);
  const runStartRef = useRef<number | null>(null);

  // ── Local state (used when ServePage doesn't share its jobs) ──────────
  const [localJobs, setLocalJobs] = useState<ServeJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastFetched, setLastFetched] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      setError(null);
      setLocalJobs(todayJobs);
      setLastFetched(Date.now());
    } catch {
      setError('Failed to load run data');
      setLocalJobs([]);
    } finally {
      setLoading(false);
    }
  }, [officerId, today, sharedJobs]);

  useEffect(() => {
    fetchRun();
  }, [fetchRun]);

  // ── Mileage today (read-only, pre-invoice visibility) ─────────────────
  const [mileageToday, setMileageToday] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ miles: number }>(`/serve/mileage/mine?date=${today}`)
      .then((res) => { if (!cancelled) setMileageToday(res?.miles ?? null); })
      .catch(() => { if (!cancelled) setMileageToday(null); });
    return () => { cancelled = true; };
  }, [today]);

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

  // Route position lookup: job id → 1-based stop number (only for jobs in the plan)
  const routeStopIndex = useMemo((): Map<number, number> => {
    if (!routeOrderIds || routeOrderIds.length === 0) return new Map();
    const map = new Map<number, number>();
    routeOrderIds.forEach((id, i) => map.set(id, i + 1));
    return map;
  }, [routeOrderIds]);

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
    // in_progress first, then pending; within each group: route order → priority → deadline
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
      // Route order beats priority when a plan exists
      if (routeStopIndex.size > 0) {
        const ar = routeStopIndex.get(a.id) ?? Infinity;
        const br = routeStopIndex.get(b.id) ?? Infinity;
        if (ar !== br) return ar - br;
      }
      const pr = priorityRank(a.priority) - priorityRank(b.priority);
      if (pr !== 0) return pr;
      if (a.deadline && b.deadline) return a.deadline.localeCompare(b.deadline);
      if (a.deadline) return -1;
      if (b.deadline) return 1;
      return (a.sort_order ?? 0) - (b.sort_order ?? 0);
    })[0];
  }, [todayOfficerJobs, routeStopIndex]);

  // ── Group by folder ───────────────────────────────────────────────────
  const byFolder = useMemo((): Record<ServeFolder, ServeJob[]> => {
    const groups: Record<ServeFolder, ServeJob[]> = {
      in_progress: [], pending: [], served: [], failed: [], archived: [],
    };
    for (const job of todayOfficerJobs) {
      groups[deriveServeFolder(job)].push(job);
    }
    // When a route plan exists, sort active folders by planned stop order.
    if (routeStopIndex.size > 0) {
      const routeSort = (a: ServeJob, b: ServeJob) => {
        const ai = routeStopIndex.get(a.id) ?? Infinity;
        const bi = routeStopIndex.get(b.id) ?? Infinity;
        return ai - bi;
      };
      groups.in_progress.sort(routeSort);
      groups.pending.sort(routeSort);
    }
    return groups;
  }, [todayOfficerJobs, routeStopIndex]);

  // ── Optimization V2 ───────────────────────────────────────────────────
  const optRun = useServeRunOptimization();

  // ETA lookup: jobId → formatted local time string
  const etaByJobId = useMemo((): Map<number, string> => {
    if (optRun.status !== 'complete') return new Map();
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Denver',
      hour: 'numeric',
      minute: '2-digit',
    });
    const map = new Map<number, string>();
    for (const stop of optRun.optimizedOrder) {
      try {
        map.set(stop.jobId, fmt.format(parseTimestamp(stop.eta)));
      } catch {
        // malformed ISO — skip
      }
    }
    return map;
  }, [optRun.status, optRun.optimizedOrder]);

  // When optimization completes, reorder pending jobs to match the optimized sequence.
  // Non-routed pending jobs stay at the end; other folders are unaffected.
  const pendingJobsForDisplay = useMemo((): ServeJob[] => {
    const pending = byFolder.pending;
    if (optRun.status !== 'complete' || optRun.optimizedOrder.length === 0) return pending;
    const orderMap = new Map(optRun.optimizedOrder.map((s, i) => [s.jobId, i]));
    return [...pending].sort((a, b) => {
      const ai = orderMap.get(a.id) ?? Infinity;
      const bi = orderMap.get(b.id) ?? Infinity;
      return ai - bi;
    });
  }, [byFolder.pending, optRun.status, optRun.optimizedOrder]);

  // Queue jobs that have coordinates (prerequisite for routing)
  const routableQueueCount = useMemo(
    () => byFolder.pending.filter((j) => j.recipient_lat != null && j.recipient_lng != null).length,
    [byFolder.pending],
  );

  // Denver shift window helpers for today
  function denverShiftTimes(): { shiftStart: string; shiftEnd: string } {
    const now = new Date();
    const ymd = now.toLocaleDateString('en-CA', { timeZone: 'America/Denver' }); // YYYY-MM-DD
    return {
      shiftStart: `${ymd}T06:00:00-06:00`,
      shiftEnd:   `${ymd}T18:00:00-06:00`,
    };
  }

  const handleOptimize = useCallback(() => {
    const { shiftStart, shiftEnd } = denverShiftTimes();
    // TODO: wire officerUnitId from auth context when available
    const officerUnitId = 0;
    // TODO: wire serveRouteId from active route when available
    const serveRouteId = 0;
    void optRun.startOptimization(byFolder.pending, officerUnitId, shiftStart, shiftEnd, serveRouteId);
  }, [optRun, byFolder.pending]);

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
      {error && (
        <div className="px-3 py-2 text-[10px] text-red-400 bg-surface-sunken border-b border-border-default">
          {error}
        </div>
      )}
      {mileageToday !== null && mileageToday > 0 && (
        <div className="px-3 py-1 border-b border-rmpg-700 bg-surface-sunken text-[9px] text-fg-muted uppercase tracking-wider flex items-center justify-between">
          <span>Mileage today</span>
          <span className="font-mono tabular-nums text-rmpg-100">{mileageToday.toFixed(1)} mi</span>
        </div>
      )}

      {/* ── Optimize Run toolbar ─────────────────────────────────── */}
      {routableQueueCount >= 2 && (
        <div className="px-3 py-1.5 border-b border-rmpg-700 bg-surface-sunken flex items-center gap-2">
          {(optRun.status === 'idle' || optRun.status === 'error') && (
            <button
              type="button"
              onClick={handleOptimize}
              className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-medium text-brand-400 bg-transparent border border-brand-400/40 rounded-[2px] hover:bg-brand-400/10 transition-all duration-150 focus:outline-none focus:ring-1 focus:ring-brand-400/40"
              aria-label="Optimize route order"
            >
              <Route size={11} />
              Optimize Route
            </button>
          )}
          {(optRun.status === 'pending' || optRun.status === 'processing') && (
            <span className="flex items-center gap-1.5 text-[10px] text-blue-400 animate-pulse">
              <Loader2 size={10} className="animate-spin" />
              Optimizing…
            </span>
          )}
          {optRun.status === 'complete' && (
            <>
              <span className="text-[9px] text-rmpg-500">Route optimized</span>
              <button
                type="button"
                onClick={optRun.reset}
                className="text-[9px] text-rmpg-600 hover:text-rmpg-400 transition-colors focus:outline-none ml-auto"
                aria-label="Clear optimization"
              >
                Clear
              </button>
            </>
          )}
          {optRun.status === 'error' && (
            <span className="text-[9px] text-red-400 ml-1">Optimization failed</span>
          )}
          {optRun.status === 'complete' && optRun.droppedJobIds.length > 0 && (
            <span className="text-[9px] text-amber-400 ml-auto">
              {optRun.droppedJobIds.length} job{optRun.droppedJobIds.length === 1 ? '' : 's'} could not be optimally scheduled
            </span>
          )}
        </div>
      )}

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
            <NextJobCard job={nextJob} onOptimisticUpdate={handleOptimisticUpdate} navigate={navigate} routeStop={routeStopIndex.get(nextJob.id)} />
          )}

          {/* ── Folder-grouped job list ─────────────────────────── */}
          <div className="space-y-2">
            {FOLDER_ORDER.map((folder) => {
              // Use the optimized order for pending jobs when available
              const folderJobs = folder === 'pending' ? pendingJobsForDisplay : byFolder[folder];
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
                      navigate={navigate}
                      routeStop={routeStopIndex.get(job.id)}
                      eta={folder === 'pending' ? etaByJobId.get(job.id) : undefined}
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

// Pure tone logic + the banner, exported for unit test. Not part of the public
// surface — MyRunTab's default export is what the app mounts.
export const __testables = { runTone, CompletionBanner };
