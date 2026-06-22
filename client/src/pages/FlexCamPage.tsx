// client/src/pages/FlexCamPage.tsx
// Police MDT-style footage list — progress bars, status badges, evidence workflow,
// auto-refresh while any request is still downloading.
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, Clock, Download, FileText, Lock, Play, RefreshCw, Shield, Video, Wrench,
} from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';

interface Req {
  id: number; title: string | null; status: string;
  chunk_count: number; chunks_done: number;
  from_ts: number; to_ts: number;
  evidence_locked?: number; evidence_number?: string | null; classification?: string;
  trip_id?: string | null;
}

interface CustodyEntry {
  action: string; actor_user_id?: number | null; actor_name?: string | null;
  reason?: string | null; detail?: string | null; created_at: string;
}
interface CustodyResult { request: Req; custody: CustodyEntry[]; links: unknown[]; }
interface CourtPackageResult { payloadHash: string; signedAt: string; }

// ── Helpers ──────────────────────────────────────────────────

function fmtTs(ms: number, short = false): string {
  return new Date(ms).toLocaleString('en-US', {
    month: 'short', day: 'numeric',
    ...(short ? {} : { hour: 'numeric', minute: '2-digit', hour12: true }),
    timeZone: 'America/Denver',
  });
}

function statusBadge(r: Req): { bg: string; ring: string; text: string; label: string; Icon: React.ElementType } {
  if (r.evidence_locked) return { bg: 'bg-[#d4a017]/10', ring: 'border-[#d4a017]/50', text: 'text-[#d4a017]', label: r.evidence_number ?? 'EVIDENCE', Icon: Lock };
  switch (r.status) {
    case 'complete':   return { bg: 'bg-emerald-900/30', ring: 'border-emerald-700/50', text: 'text-emerald-400', label: 'READY',        Icon: CheckCircle2 };
    case 'fulfilling': return { bg: 'bg-blue-900/30',   ring: 'border-blue-700/50',   text: 'text-blue-400',    label: 'DOWNLOADING',  Icon: Clock };
    case 'partial':    return { bg: 'bg-amber-900/30',  ring: 'border-amber-700/50',  text: 'text-amber-400',   label: 'PARTIAL',      Icon: RefreshCw };
    default:           return { bg: 'bg-surface-raised', ring: 'border-border-default', text: 'text-rmpg-400',  label: r.status.toUpperCase(), Icon: Video };
  }
}

function pct(r: Req): number {
  return r.chunk_count ? Math.min(100, Math.round((r.chunks_done / r.chunk_count) * 100)) : 0;
}

function pctColor(r: Req): string {
  if (r.evidence_locked)    return 'bg-[#d4a017]';
  if (r.status === 'complete') return 'bg-emerald-500';
  if (r.status === 'fulfilling') return 'bg-blue-500';
  return 'bg-amber-500';
}

// ── Component ────────────────────────────────────────────────

export default function FlexCamPage() {
  const [reqs, setReqs]         = useState<Req[]>([]);
  const [loading, setLoading]   = useState(true);
  const [lastFetch, setLastFetch] = useState(0);
  const [custodyOpen, setCustodyOpen]     = useState<Record<number, CustodyResult | null>>({});
  const [custodyLoading, setCustodyLoading] = useState<Record<number, boolean>>({});
  const [custodyErr, setCustodyErr]       = useState<Record<number, string>>({});
  const [pkgResult, setPkgResult] = useState<Record<number, string>>({});
  const [pkgLoading, setPkgLoading] = useState<Record<number, boolean>>({});
  const [repairResult, setRepairResult] = useState<Record<number, string>>({});
  const [repairLoading, setRepairLoading] = useState<Record<number, boolean>>({});
  const [highlightId, setHighlightId] = useState<number | null>(null);
  const refsReqs = useRef(reqs);
  refsReqs.current = reqs;
  const rowRefs = useRef<Map<number, HTMLDivElement | null>>(new Map());

  const fetchReqs = useCallback((quiet = false) => {
    if (!quiet) setLoading(true);
    apiFetch<{ requests: Req[] }>('/flexcam/footage')
      .then((r) => { setReqs(r.requests); setLastFetch(Date.now()); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchReqs(); }, [fetchReqs]);

  // Auto-refresh every 20s while any request is still downloading.
  useEffect(() => {
    const timer = setInterval(() => {
      const active = refsReqs.current.some(
        (r) => r.status === 'fulfilling' || r.status === 'pending_request',
      );
      if (active) fetchReqs(true);
    }, 20_000);
    return () => clearInterval(timer);
  }, [fetchReqs]);

  // ── URL deep-link: /flexcam?request_id=<n> auto-scrolls + highlights ────
  // Cross-page contract: dispatch / cases / Body / Dash cameras can link
  // "view FlexCam request" → /flexcam?request_id=42 and the operator lands on
  // the row already in the auto-refresh table with its custody panel primed.
  // One-shot per page load; the param is stripped after applying. Falls back
  // to a direct GET when the target is outside the current list (e.g. archived
  // or a different account scope). Mirrors the DashCamerasPage pattern.
  const [searchParams, setSearchParams] = useSearchParams();
  const pendingRequestIdRef = useRef<string | null>(searchParams.get('request_id'));
  useEffect(() => {
    const target = pendingRequestIdRef.current;
    if (!target || loading) return;
    pendingRequestIdRef.current = null;
    const numericId = Number(target);
    if (!Number.isFinite(numericId) || numericId <= 0) return;
    let cancelled = false;
    (async () => {
      try {
        const hit = reqs.find((r) => r.id === numericId);
        if (!hit) {
          // Not in the current list; reload once in case it just appeared.
          await Promise.resolve(fetchReqs(true));
        }
        if (cancelled) return;
        setHighlightId(numericId);
        // Wait one tick for the row to render, then scroll into view.
        requestAnimationFrame(() => {
          const el = rowRefs.current.get(numericId);
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
        // Auto-open custody panel for the deep-linked row.
        if (custodyOpen[numericId] === undefined) toggleCustody(numericId);
        // Decay the highlight after 4s.
        setTimeout(() => setHighlightId((h) => (h === numericId ? null : h)), 4000);
      } finally {
        if (!cancelled) {
          const next = new URLSearchParams(searchParams);
          next.delete('request_id');
          setSearchParams(next, { replace: true });
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reqs, loading]);

  // ── Esc smart-cascade: close-newest-open-first ─────────────────────────
  // The card has no modals, but stacked-open custody dropdowns and inline
  // result banners need a uniform "press Esc to dismiss" affordance for
  // parity with the rest of the page audit. Skip while typing in any field.
  useEffect(() => {
    const isTypingInField = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
    };
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (isTypingInField(e.target)) return;
      // 1) Inline custody error banners
      const errIds = Object.keys(custodyErr).map(Number);
      if (errIds.length > 0) {
        setCustodyErr({});
        return;
      }
      // 2) Inline repair / package result banners
      if (Object.keys(repairResult).length > 0 || Object.keys(pkgResult).length > 0) {
        setRepairResult({});
        setPkgResult({});
        return;
      }
      // 3) Any open custody dropdown
      const openIds = Object.keys(custodyOpen).map(Number);
      if (openIds.length > 0) {
        setCustodyOpen({});
        return;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [custodyErr, repairResult, pkgResult, custodyOpen]);

  const toggleCustody = useCallback((id: number) => {
    if (custodyOpen[id] !== undefined) {
      setCustodyOpen((p) => { const n = { ...p }; delete n[id]; return n; });
      setCustodyErr((p) => { const n = { ...p }; delete n[id]; return n; });
      return;
    }
    setCustodyLoading((p) => ({ ...p, [id]: true }));
    setCustodyErr((p) => { const n = { ...p }; delete n[id]; return n; });
    apiFetch<CustodyResult>(`/flexcam/footage/${id}/custody`)
      .then((res) => setCustodyOpen((p) => ({ ...p, [id]: res })))
      .catch((e: Error) => {
        // Inline error display — the prior native alert() blocked the UI
        // thread, escaped the surrounding theme, and bypassed Esc/click-out.
        setCustodyOpen((p) => { const n = { ...p }; delete n[id]; return n; });
        setCustodyErr((p) => ({ ...p, [id]: e.message }));
      })
      .finally(() => setCustodyLoading((p) => ({ ...p, [id]: false })));
  }, [custodyOpen]);

  function requestCourtPkg(req: Req) {
    if (pkgLoading[req.id]) return;
    setPkgLoading((p) => ({ ...p, [req.id]: true }));
    setPkgResult((p) => ({ ...p, [req.id]: '' }));
    apiFetch<CourtPackageResult>(`/flexcam/footage/${req.id}/court-package`, { method: 'POST' })
      .then((res) => {
        const blob = new Blob([JSON.stringify(res, null, 2)], { type: 'application/json' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url; a.download = `court-package-${req.id}.json`; a.click();
        URL.revokeObjectURL(url);
        setPkgResult((p) => ({ ...p, [req.id]: `✓ Signed ${new Date(res.signedAt).toLocaleString()} · ${res.payloadHash.slice(0, 12)}…` }));
      })
      .catch((e: Error & { status?: number }) => {
        setPkgResult((p) => ({
          ...p,
          [req.id]: e.status === 409 ? 'Lock as evidence first.' : `Error: ${e.message}`,
        }));
      })
      .finally(() => setPkgLoading((p) => ({ ...p, [req.id]: false })));
  }

  function repairRequest(req: Req) {
    if (repairLoading[req.id]) return;
    setRepairLoading((p) => ({ ...p, [req.id]: true }));
    setRepairResult((p) => ({ ...p, [req.id]: '' }));
    apiFetch<{ repaired: number; message: string }>(`/flexcam/footage/${req.id}/repair`, { method: 'POST' })
      .then((res) => {
        setRepairResult((p) => ({ ...p, [req.id]: `✓ ${res.message}` }));
        setTimeout(() => fetchReqs(true), 2000);
      })
      .catch((e: Error & { status?: number }) => {
        setRepairResult((p) => ({
          ...p,
          [req.id]: e.status === 409 ? 'Locked — unlock first.' : `Error: ${e.message}`,
        }));
      })
      .finally(() => setRepairLoading((p) => ({ ...p, [req.id]: false })));
  }

  // ── Summary counts ───────────────────────────────────────

  const total      = reqs.length;
  const downloading = reqs.filter((r) => r.status === 'fulfilling').length;
  const ready      = reqs.filter((r) => r.status === 'complete').length;
  const locked     = reqs.filter((r) => !!r.evidence_locked).length;

  // ── Render ───────────────────────────────────────────────

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-3">
        <PanelTitleBar title="FLEXCAM — TRIP FOOTAGE" icon={Video} />
        <div className="flex-1" />
        <button onClick={() => fetchReqs()} disabled={loading}
          className="flex items-center gap-1 text-[9px] text-rmpg-400 hover:text-brand-400 transition-colors disabled:opacity-40 px-2 py-1 border border-border-default">
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          {lastFetch ? new Date(lastFetch).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true }) : 'REFRESH'}
        </button>
      </div>

      {/* ── Summary stats ──────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-2">
        {[
          { label: 'TOTAL',       value: total,       color: 'text-rmpg-300' },
          { label: 'DOWNLOADING', value: downloading, color: 'text-blue-400' },
          { label: 'READY',       value: ready,       color: 'text-emerald-400' },
          { label: 'LOCKED',      value: locked,      color: 'text-[#d4a017]' },
        ].map((s) => (
          <div key={s.label} className="bg-surface-sunken border border-border-default px-3 py-2">
            <div className={`text-[18px] font-bold tabular-nums ${s.color}`}>{s.value}</div>
            <div className="text-[8px] text-rmpg-600 uppercase tracking-wider font-bold">{s.label}</div>
          </div>
        ))}
      </div>

      {/* ── Request cards ────────────────────────────────────── */}
      {reqs.length === 0 && !loading && (
        <div className="text-center py-12 text-rmpg-600 text-[11px]">
          No trip footage yet. Full-drive recordings appear here automatically.
        </div>
      )}

      <div className="space-y-2">
        {reqs.map((r) => {
          const sb   = statusBadge(r);
          const p    = pct(r);
          const pc   = pctColor(r);

          const isHighlit = highlightId === r.id;
          return (
            <Fragment key={r.id}>
              <div
                ref={(el) => { rowRefs.current.set(r.id, el); }}
                className={`bg-surface-raised border p-3 space-y-2 transition-colors ${isHighlit ? 'border-brand-500 ring-1 ring-brand-500/40' : 'border-border-default'}`}
              >
                {/* Row 1: title + date + status badge */}
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] font-bold text-rmpg-100 uppercase tracking-wide truncate">
                      {r.title ?? `REQUEST ${r.id}`}
                    </div>
                    <div className="text-[9px] text-rmpg-500 font-mono mt-0.5">
                      {fmtTs(r.from_ts)} — {fmtTs(r.to_ts)}
                    </div>
                  </div>
                  <div className={`flex items-center gap-1 px-2 py-0.5 text-[9px] font-bold border flex-shrink-0 ${sb.bg} ${sb.ring} ${sb.text}`}>
                    <sb.Icon className={`w-2.5 h-2.5 ${r.status === 'fulfilling' && !r.evidence_locked ? 'animate-spin' : ''}`} />
                    {sb.label}
                  </div>
                </div>

                {/* Row 2: progress bar */}
                <div className="space-y-0.5">
                  <div className="h-2 bg-surface-sunken border border-border-default overflow-hidden">
                    <div className={`h-full ${pc} transition-all duration-500`} style={{ width: `${p}%` }} />
                  </div>
                  <div className="flex justify-between text-[9px] text-rmpg-600 tabular-nums">
                    <span>{r.chunks_done}/{r.chunk_count} segments</span>
                    <span>{p}%</span>
                  </div>
                </div>

                {/* Row 3: action buttons */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  <a href={`/flexcam/${r.id}`}
                    className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide px-2.5 py-1.5 bg-blue-900/40 border border-blue-700/60 text-blue-300 hover:bg-blue-800/50 transition-colors">
                    <Play className="w-2.5 h-2.5" />PLAY
                  </a>
                  {r.trip_id ? (
                    <Link
                      to={`/flexcam/trip/${r.trip_id}`}
                      className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide px-2.5 py-1.5 border border-brand-700/60 text-brand-300 hover:bg-brand-900/20 transition-colors"
                    >
                      <Play className="w-2.5 h-2.5" />PLAY TRIP
                    </Link>
                  ) : null}
                  {/* REPAIR — visible on partial trips or stuck fulfilling */}
                  {(r.status === 'partial' || (r.status === 'fulfilling' && r.chunks_done < r.chunk_count)) && !r.evidence_locked && (
                    <button
                      onClick={() => repairRequest(r)}
                      disabled={repairLoading[r.id]}
                      title="Reset missing chunks and retry download"
                      className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide px-2.5 py-1.5 border border-amber-700/60 text-amber-400 hover:bg-amber-900/20 transition-colors disabled:opacity-40">
                      <Wrench className="w-2.5 h-2.5" />
                      {repairLoading[r.id] ? '…' : 'REPAIR'}
                    </button>
                  )}
                  <button
                    onClick={() => toggleCustody(r.id)}
                    disabled={custodyLoading[r.id]}
                    className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide px-2.5 py-1.5 border border-border-default text-rmpg-400 hover:text-brand-400 hover:border-brand-600 transition-colors disabled:opacity-40">
                    <Shield className="w-2.5 h-2.5" />
                    {custodyLoading[r.id] ? '…' : custodyOpen[r.id] !== undefined ? 'HIDE CUSTODY' : 'CUSTODY'}
                  </button>
                  <button
                    onClick={() => requestCourtPkg(r)}
                    disabled={pkgLoading[r.id] || !r.evidence_locked}
                    title={!r.evidence_locked ? 'Lock as evidence first' : undefined}
                    className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide px-2.5 py-1.5 border border-border-default text-rmpg-400 hover:text-brand-400 hover:border-brand-600 transition-colors disabled:opacity-30">
                    <FileText className="w-2.5 h-2.5" />
                    {pkgLoading[r.id] ? '…' : 'COURT PKG'}
                  </button>
                  <button
                    onClick={() => {
                      apiFetch<unknown>(`/flexcam/footage/${r.id}`)
                        .then((json) => {
                          const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url; a.download = `footage-manifest-${r.id}.json`; a.click();
                          setTimeout(() => URL.revokeObjectURL(url), 3000);
                        })
                        .catch(console.error);
                    }}
                    className="flex items-center gap-1 text-[9px] text-rmpg-500 hover:text-brand-400 px-1.5 py-1 ml-auto transition-colors"
                    title="Download manifest JSON">
                    <Download className="w-2.5 h-2.5" />
                  </button>
                </div>

                {/* Repair / court pkg results */}
                {repairResult[r.id] && (
                  <div className={`text-[9px] font-mono px-2 py-1 border flex items-start gap-1.5 ${
                    repairResult[r.id].startsWith('✓') ? 'text-emerald-400 border-emerald-900 bg-emerald-900/10' : 'text-amber-400 border-amber-900 bg-amber-900/10'}`}>
                    {!repairResult[r.id].startsWith('✓') && <AlertTriangle className="w-2.5 h-2.5 mt-0.5 flex-shrink-0" />}
                    {repairResult[r.id]}
                  </div>
                )}
                {pkgResult[r.id] && (
                  <div className={`text-[9px] font-mono px-2 py-1 border ${
                    pkgResult[r.id].startsWith('✓') ? 'text-emerald-400 border-emerald-900 bg-emerald-900/10' : 'text-amber-400 border-amber-900 bg-amber-900/10'}`}>
                    {pkgResult[r.id]}
                  </div>
                )}
                {custodyErr[r.id] && (
                  <div className="text-[9px] font-mono px-2 py-1 border border-red-900 bg-red-900/10 text-red-400 flex items-start gap-1.5">
                    <AlertTriangle className="w-2.5 h-2.5 mt-0.5 flex-shrink-0" />
                    <span className="flex-1">Custody load failed: {custodyErr[r.id]}</span>
                    <button
                      onClick={() => setCustodyErr((p) => { const n = { ...p }; delete n[r.id]; return n; })}
                      className="text-red-300 hover:text-red-100"
                      aria-label="Dismiss custody error"
                    >×</button>
                  </div>
                )}
              </div>

              {/* Chain of custody panel */}
              {custodyOpen[r.id] !== undefined && custodyOpen[r.id] !== null && (
                <div className="border border-border-default bg-surface-sunken p-3 space-y-1.5 -mt-1">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Shield className="w-3 h-3 text-[#d4a017]" />
                    <span className="text-[9px] font-bold uppercase tracking-wider text-[#d4a017]">Chain of Custody</span>
                  </div>
                  {custodyOpen[r.id]!.custody.length === 0 ? (
                    <div className="text-[10px] text-rmpg-600">No custody entries.</div>
                  ) : (
                    custodyOpen[r.id]!.custody.map((entry, i) => (
                      <div key={i} className="flex items-baseline gap-2 py-0.5 border-b border-border-default last:border-0">
                        <span className="text-[9px] font-bold uppercase text-[#d4a017] w-20 flex-shrink-0">{entry.action}</span>
                        <span className="text-[10px] text-rmpg-300 flex-1 min-w-0">
                          {entry.actor_name ?? (entry.actor_user_id != null ? `#${entry.actor_user_id}` : '—')}
                          {entry.reason && <span className="ml-1 text-rmpg-500 text-[9px]">({entry.reason})</span>}
                        </span>
                        <span className="text-[9px] text-rmpg-600 flex-shrink-0 font-mono">
                          {new Date(entry.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
