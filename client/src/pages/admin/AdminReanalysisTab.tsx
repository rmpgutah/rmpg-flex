import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  RefreshCw, ChevronDown, ChevronRight, AlertTriangle,
  CheckCircle2, Loader2, Camera, Shield, Database,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { parseTimestamp } from '../../utils/dateUtils';

interface Props {
  LoadingSpinner: React.FC;
  error: string | null;
  setError: (e: string | null) => void;
}

interface JobState {
  job_id: number | null;
  status: 'idle' | 'running' | 'complete' | 'failed';
  processed: number;
  skipped: number;
  errors: number;
  error_detail: string | null;
  skipped_units: Array<{ unit_id: number; trip_id: number }>;
  started_at: string | null;
  finished_at: string | null;
  has_more: boolean;
}

const EMPTY_JOB: JobState = {
  job_id: null, status: 'idle', processed: 0, skipped: 0, errors: 0,
  error_detail: null, skipped_units: [], started_at: null, finished_at: null, has_more: false,
};

function fmtDate(s: string | null) {
  if (!s) return '—';
  try { return parseTimestamp(s).toLocaleString(); } catch { return s; }
}

function StatusChip({ status }: { status: JobState['status'] }) {
  if (status === 'idle') return <span className="text-rmpg-400 text-[10px] uppercase tracking-widest">Not run</span>;
  if (status === 'running') return <span className="flex items-center gap-1 text-brand-400 text-[10px] uppercase tracking-widest"><Loader2 className="w-3 h-3 animate-spin" />Running…</span>;
  if (status === 'complete') return <span className="flex items-center gap-1 text-green-400 text-[10px] uppercase tracking-widest"><CheckCircle2 className="w-3 h-3" />Complete</span>;
  return <span className="flex items-center gap-1 text-red-400 text-[10px] uppercase tracking-widest"><AlertTriangle className="w-3 h-3" />Failed</span>;
}

export default function AdminReanalysisTab({ setError }: Props) {
  const [footage, setFootage]     = useState<JobState>(EMPTY_JOB);
  const [alpr,    setAlpr]        = useState<JobState>(EMPTY_JOB);
  const [replay,  setReplay]      = useState<JobState>(EMPTY_JOB);

  // Cursor state — persisted across "Continue" presses; reset on new run
  const alprCursor      = useRef(0);
  const replayCursors   = useRef({ sightings:0, audit:0, gps:0, cfs:0, citations:0, incidents:0 });

  const [showSkipped,   setShowSkipped]   = useState(false);
  const [loadingF,      setLoadingF]      = useState(false);
  const [loadingA,      setLoadingA]      = useState(false);
  const [loadingR,      setLoadingR]      = useState(false);

  // ── Polling ───────────────────────────────────────────────
  const polling = useRef(false);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const data = await apiFetch<Record<string, {
        job_id: number; status: string; processed: number; skipped: number;
        errors: number; error_detail: string | null; skipped_units: Array<{unit_id:number;trip_id:number}>;
        started_at: string; finished_at: string | null;
      } | null>>('/admin/reanalysis/status');

      const toJob = (key: string, cur: JobState): JobState => {
        const row = data[key];
        if (!row) return cur;
        return {
          ...cur,
          job_id: row.job_id,
          status: (row.status as JobState['status']) ?? 'idle',
          processed: row.processed ?? 0,
          skipped: row.skipped ?? 0,
          errors: row.errors ?? 0,
          error_detail: row.error_detail,
          skipped_units: row.skipped_units ?? [],
          started_at: row.started_at,
          finished_at: row.finished_at,
        };
      };

      setFootage(prev => toJob('footage_backfill', prev));
      setAlpr(prev    => toJob('alpr_confidence',  prev));
      setReplay(prev  => toJob('analytics_replay', prev));
    } catch { /* silent — poll will retry */ }
  }, []);

  // Poll while any job is running
  useEffect(() => {
    const anyRunning = footage.status === 'running' || alpr.status === 'running' || replay.status === 'running';
    if (anyRunning && !polling.current) {
      polling.current = true;
      const tick = () => {
        fetchStatus().finally(() => {
          if (polling.current) pollTimer.current = setTimeout(tick, 5000);
        });
      };
      tick();
    } else if (!anyRunning) {
      polling.current = false;
      if (pollTimer.current) { clearTimeout(pollTimer.current); pollTimer.current = null; }
    }
    return () => { /* keep timer — cleanup in else branch above */ };
  }, [footage.status, alpr.status, replay.status, fetchStatus]);

  // Initial status load
  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  // ── Footage backfill ──────────────────────────────────────
  const runFootage = async () => {
    setLoadingF(true);
    setFootage(prev => ({ ...prev, status: 'running' }));
    try {
      const res = await apiFetch<{ queued:number; skipped:number; errors:number; has_more:boolean; skipped_units:Array<{unit_id:number;trip_id:number}>; job_id:number }>(
        '/flexcam/backfill', { method: 'POST' },
      );
      setFootage(prev => ({
        ...prev,
        job_id: res.job_id,
        status: 'complete',
        processed: (prev.processed || 0) + (res.queued || 0),
        skipped: (prev.skipped || 0) + (res.skipped || 0),
        errors: (prev.errors || 0) + (res.errors || 0),
        skipped_units: [...(prev.skipped_units || []), ...(res.skipped_units || [])],
        has_more: res.has_more,
      }));
    } catch (e) {
      setError((e as Error).message);
      setFootage(prev => ({ ...prev, status: 'failed' }));
    } finally { setLoadingF(false); }
  };

  // ── ALPR confidence correction ────────────────────────────
  const runAlpr = async () => {
    setLoadingA(true);
    setAlpr(prev => ({ ...prev, status: 'running' }));
    try {
      const res = await apiFetch<{ corrected:number; has_more:boolean; next_cursor:number; job_id:number }>(
        `/admin/reanalysis/backfill-confidence?cursor=${alprCursor.current}`, { method: 'POST' },
      );
      alprCursor.current = res.next_cursor;
      setAlpr(prev => ({
        ...prev,
        job_id: res.job_id,
        status: 'complete',
        processed: (prev.processed || 0) + (res.corrected || 0),
        has_more: res.has_more,
      }));
    } catch (e) {
      setError((e as Error).message);
      setAlpr(prev => ({ ...prev, status: 'failed' }));
    } finally { setLoadingA(false); }
  };

  // ── Analytics replay ──────────────────────────────────────
  const runReplay = async () => {
    setLoadingR(true);
    setReplay(prev => ({ ...prev, status: 'running' }));
    const c = replayCursors.current;
    const qs = `cursor_sightings=${c.sightings}&cursor_audit=${c.audit}&cursor_gps=${c.gps}&cursor_cfs=${c.cfs}&cursor_citations=${c.citations}&cursor_incidents=${c.incidents}`;
    try {
      const res = await apiFetch<{
        replayed:number; has_more:boolean; job_id:number;
        next_cursor_sightings:number; next_cursor_audit:number; next_cursor_gps:number;
        next_cursor_cfs:number; next_cursor_citations:number; next_cursor_incidents:number;
      }>(`/admin/reanalysis/replay?${qs}`, { method: 'POST' });
      replayCursors.current = {
        sightings: res.next_cursor_sightings, audit: res.next_cursor_audit,
        gps: res.next_cursor_gps, cfs: res.next_cursor_cfs,
        citations: res.next_cursor_citations, incidents: res.next_cursor_incidents,
      };
      setReplay(prev => ({
        ...prev,
        job_id: res.job_id,
        status: 'complete',
        processed: (prev.processed || 0) + (res.replayed || 0),
        has_more: res.has_more,
      }));
    } catch (e) {
      setError((e as Error).message);
      setReplay(prev => ({ ...prev, status: 'failed' }));
    } finally { setLoadingR(false); }
  };

  // ── Card helper ───────────────────────────────────────────
  const Card = ({
    title, icon: Icon, description, job,
    loading, onRun, children,
  }: {
    title: string;
    icon: React.ElementType;
    description: string;
    job: JobState;
    loading: boolean;
    onRun: () => void;
    children?: React.ReactNode;
  }) => (
    <div className="border border-rmpg-600/40 bg-surface-raised p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4 text-brand-400 shrink-0" />
          <span className="text-xs font-semibold text-rmpg-100 uppercase tracking-wide">{title}</span>
        </div>
        <StatusChip status={job.status} />
      </div>

      <p className="text-[11px] text-rmpg-400 leading-relaxed">{description}</p>

      {job.status !== 'idle' && (
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <div className="text-base font-bold text-rmpg-100">{job.processed.toLocaleString()}</div>
            <div className="text-[10px] text-rmpg-400 uppercase tracking-wide">Processed</div>
          </div>
          <div>
            <div className="text-base font-bold text-rmpg-300">{job.skipped.toLocaleString()}</div>
            <div className="text-[10px] text-rmpg-400 uppercase tracking-wide">Skipped</div>
          </div>
          <div>
            <div className={`text-base font-bold ${job.errors > 0 ? 'text-red-400' : 'text-rmpg-300'}`}>{job.errors}</div>
            <div className="text-[10px] text-rmpg-400 uppercase tracking-wide">Errors</div>
          </div>
        </div>
      )}

      {job.started_at && (
        <div className="text-[10px] text-rmpg-500">
          Started {fmtDate(job.started_at)}{job.finished_at ? ` · Finished ${fmtDate(job.finished_at)}` : ''}
        </div>
      )}

      {job.error_detail && (
        <div className="text-[11px] text-red-400 bg-red-900/20 border border-red-700/30 px-2 py-1.5">
          {job.error_detail}
        </div>
      )}

      {children}

      <button
        type="button"
        onClick={onRun}
        disabled={loading || job.status === 'running'}
        className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium bg-rmpg-700 hover:bg-rmpg-600 disabled:opacity-40 disabled:cursor-not-allowed text-rmpg-100 transition-colors"
      >
        {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
        {job.has_more ? 'Continue (more remaining)' : job.status === 'complete' ? 'Run Again' : 'Run'}
      </button>
    </div>
  );

  return (
    <div className="p-4 space-y-4 max-w-2xl">
      <div>
        <h2 className="text-sm font-semibold text-rmpg-100 uppercase tracking-wider">Data Reanalysis</h2>
        <p className="text-[11px] text-rmpg-400 mt-1">
          Admin-triggered backfill pipelines. Each is paginated — press Continue until the button label changes to Run Again.
        </p>
      </div>

      {/* Footage Backfill */}
      <Card
        title="Footage Backfill"
        icon={Camera}
        description="Enqueues footage requests for closed trips that have no existing clip. Limited to trips within the 120-day ClearPath retention window. Only units with an active camera mapping are queued."
        job={footage}
        loading={loadingF}
        onRun={runFootage}
      >
        {footage.skipped_units.length > 0 && (
          <div className="border border-rmpg-600/40">
            <button
              type="button"
              onClick={() => setShowSkipped(v => !v)}
              className="flex items-center justify-between w-full px-2 py-1.5 text-[11px] text-rmpg-300 hover:bg-rmpg-700/30 transition-colors"
            >
              <span>{footage.skipped_units.length} trip(s) skipped — no active camera mapping</span>
              {showSkipped ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            </button>
            {showSkipped && (
              <div className="border-t border-rmpg-600/40 max-h-40 overflow-y-auto divide-y divide-rmpg-700/30">
                {footage.skipped_units.map((u, i) => (
                  <div key={i} className="px-2 py-1 text-[10px] text-rmpg-400 flex gap-4">
                    <span>Unit {u.unit_id}</span>
                    <span className="text-rmpg-500">Trip #{u.trip_id}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Card>

      {/* ALPR Confidence Fix */}
      <Card
        title="ALPR Confidence Fix"
        icon={Shield}
        description="Sets footage and edge plate confidence to ≤ 0.84 (the honest single-read cap). The original raw model value is preserved in original_confidence for audit. Does not change review status."
        job={alpr}
        loading={loadingA}
        onRun={runAlpr}
      >
        {alpr.processed > 0 && (
          <div className="text-[11px] text-rmpg-400 bg-rmpg-800/50 px-2 py-1.5">
            {alpr.processed.toLocaleString()} capture(s) corrected. Original values preserved in <code className="text-brand-400">original_confidence</code>.
          </div>
        )}
      </Card>

      {/* Analytics Replay */}
      <Card
        title="Analytics Replay"
        icon={Database}
        description="Pushes historical D1 rows to the Iceberg analytics warehouse: plate reads, audit events, GPS breadcrumbs, calls for service, citations, and incidents. Already-sent rows are skipped — safe to run multiple times."
        job={replay}
        loading={loadingR}
        onRun={runReplay}
      />
    </div>
  );
}
