// client/src/pages/FlexCamFootagePage.tsx
// Police MDT-style dashcam footage player — sequential 40s chunk playback,
// evidence lock/court-package workflow, touchscreen-optimised controls.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  AlertTriangle, CheckCircle2, ChevronLeft, Clock, Download,
  FileText, Lock, Maximize2, Pause, Play, Shield, Video,
} from 'lucide-react';
import { apiFetch, apiFetchBlob } from '../hooks/useApi';
import { buildTimeline, offsetToSeek, type PlayChunk } from '../utils/flexcamTimeline';

// ── Types ────────────────────────────────────────────────────

interface ChunkRow {
  seq: number; from_ts: number; to_ts: number;
  status: string; r2_key: string | null; bytes: number;
}
interface Marker {
  ts_ms: number; offset_ms: number | null; kind: string; type: string | null;
  severity: string | null; label: string | null; heading_deg: number | null; turn_dir: string | null;
}
interface Request {
  id: number; title: string | null; status: string;
  from_ts: number; to_ts: number;
  evidence_locked?: number; evidence_number?: string | null; classification?: string | null;
}
interface Detail {
  request: Request;
  manifest: { chunks: Array<{ seq: number; r2_key: string }>; gaps: number[]; spanMs: number; playableMs: number };
  markers: Marker[];
  chunks: ChunkRow[];
}

// ── Helpers ──────────────────────────────────────────────────

function fmt(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function fmtTs(ms: number): string {
  return new Date(ms).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    hour12: true, timeZone: 'America/Denver',
  });
}

function fmtBytes(b: number): string {
  if (b < 1048576) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
}

function headingToCard(deg: number | null): string {
  if (deg == null) return '';
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
}

function pinColor(m: Marker): string {
  if (m.type === 'turn') return m.kind === 'camera_hard_turn' ? '#f59e0b' : '#38bdf8';
  if (m.severity === 'critical' || m.severity === 'alert') return '#ef4444';
  if (m.severity === 'warning') return '#f59e0b';
  return '#34d399';
}

function statusBadge(status: string): { bg: string; text: string; label: string } {
  switch (status) {
    case 'complete':   return { bg: 'bg-emerald-900/40', text: 'text-emerald-400', label: 'READY' };
    case 'fulfilling': return { bg: 'bg-blue-900/40',   text: 'text-blue-400',    label: 'DOWNLOADING' };
    case 'partial':    return { bg: 'bg-amber-900/40',  text: 'text-amber-400',   label: 'PARTIAL' };
    default:           return { bg: 'bg-surface-raised', text: 'text-rmpg-400',   label: status.toUpperCase() };
  }
}

// ── Main component ───────────────────────────────────────────

export default function FlexCamFootagePage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData]         = useState<Detail | null>(null);
  const [err, setErr]           = useState<string | null>(null);
  const [idx, setIdx]           = useState(0);
  const [playing, setPlaying]   = useState(false);
  const [posMs, setPosMs]       = useState(0);
  const [loading, setLoading]   = useState(false);
  const [lockBusy, setLockBusy] = useState(false);
  const [pkgBusy, setPkgBusy]   = useState(false);
  const [pkgMsg, setPkgMsg]     = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const urlCache = useRef<Map<number, string>>(new Map());
  const fullRef  = useRef<HTMLDivElement | null>(null);
  // Monotonically-increasing generation counter: every playSegment call grabs
  // the next value. Any async continuation that sees a newer value is stale
  // (another call won) and must bail out without touching the video element.
  const genRef   = useRef(0);

  const reload = useCallback(() => {
    apiFetch<Detail>(`/flexcam/footage/${id}`).then(setData).catch((e: Error) => setErr(e.message));
  }, [id]);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => () => {
    for (const u of urlCache.current.values()) URL.revokeObjectURL(u);
    urlCache.current.clear();
  }, []);

  const timeline = useMemo(() => {
    const downloaded = (data?.chunks ?? [])
      .filter((c) => c.status === 'downloaded')
      .map<PlayChunk>((c) => ({ seq: c.seq, durationMs: c.to_ts - c.from_ts }));
    return buildTimeline(downloaded);
  }, [data]);

  async function loadSeq(seq: number): Promise<string | null> {
    const cached = urlCache.current.get(seq);
    if (cached) return cached;
    setLoading(true);
    try {
      const blob = await apiFetchBlob(`/flexcam/footage/${id}/chunk/${seq}/stream`);
      const url = URL.createObjectURL(blob);
      urlCache.current.set(seq, url);
      return url;
    } catch (e) { setErr((e as Error).message); return null; }
    finally { setLoading(false); }
  }

  async function playSegment(segIndex: number, withinMs = 0) {
    const myGen = ++genRef.current;
    const seg   = timeline.segments[segIndex];
    const video = videoRef.current;
    if (!seg || !video) return;
    setIdx(segIndex);

    // Fetch (or retrieve from cache) before touching the video element so we
    // overlap network time with the tail of the previous clip playing.
    const url = await loadSeq(seg.seq);
    if (!url || myGen !== genRef.current) return; // stale — newer call took over

    // Pause the current clip before changing src so that in-flight play()
    // promises resolve cleanly and the browser doesn't re-fire 'ended'.
    video.pause();
    video.src = url;
    // Do NOT call video.load() — assigning to .src triggers an implicit load.
    // Calling load() explicitly while the element is at end-of-clip causes the
    // browser to re-fire 'ended', which re-enters onEnded and starts a second
    // parallel playSegment chain (the repeat / bad-transition bugs).

    await new Promise<void>((resolve) => {
      // readyState >= 2 (HAVE_CURRENT_DATA) means data is already available
      // — blob URLs backed by in-memory cache hit this path immediately.
      if (video.readyState >= 2) { resolve(); return; }
      const onCanPlay = () => { video.removeEventListener('canplay', onCanPlay); resolve(); };
      video.addEventListener('canplay', onCanPlay);
    });

    if (myGen !== genRef.current) return; // stale during canplay wait
    if (withinMs > 0) {
      try { video.currentTime = withinMs / 1000; } catch { /* */ }
    }
    video.play().catch(() => { if (myGen === genRef.current) setPlaying(false); });

    // Warm the next segment while this one plays to eliminate fetch-gap on hand-off.
    if (timeline.segments[segIndex + 1]) void loadSeq(timeline.segments[segIndex + 1].seq);
  }

  function onEnded() {
    if (idx < timeline.segments.length - 1) void playSegment(idx + 1);
    else setPlaying(false);
  }
  function onTimeUpdate() {
    const seg   = timeline.segments[idx];
    const video = videoRef.current;
    if (seg && video) setPosMs(seg.startMs + video.currentTime * 1000);
  }
  function togglePlay() {
    const video = videoRef.current;
    if (!video) return;
    if (!video.src && timeline.segments.length) { void playSegment(0); setPlaying(true); return; }
    if (video.paused) video.play().then(() => setPlaying(true)).catch(() => {});
    else { video.pause(); setPlaying(false); }
  }
  function seekToOffset(offsetMs: number) {
    const target = offsetToSeek(offsetMs, timeline);
    if (!target) return;
    const segIndex = timeline.segments.findIndex((s) => s.seq === target.seq);
    if (segIndex >= 0) { void playSegment(segIndex, target.withinMs); setPlaying(true); }
  }
  function handleFullscreen() {
    const el = fullRef.current;
    if (!el) return;
    if (!document.fullscreenElement) el.requestFullscreen().catch(() => {});
    else document.exitFullscreen().catch(() => {});
  }

  async function lockEvidence() {
    if (!data || lockBusy) return;
    setLockBusy(true);
    try {
      await apiFetch(`/flexcam/footage/${data.request.id}/lock`, { method: 'POST' });
      reload();
    } catch (e) { setErr((e as Error).message); }
    finally { setLockBusy(false); }
  }

  async function genCourtPkg() {
    if (!data || pkgBusy) return;
    setPkgBusy(true); setPkgMsg(null);
    try {
      const res = await apiFetch<{ payloadHash: string; signedAt: string }>(
        `/flexcam/footage/${data.request.id}/court-package`, { method: 'POST' }
      );
      setPkgMsg(`✓ Signed ${new Date(res.signedAt).toLocaleString()} · SHA-256: ${res.payloadHash.slice(0, 16)}…`);
    } catch (e: unknown) {
      const err = e as Error & { status?: number };
      setPkgMsg(err.status === 409 ? '⚠ Lock footage as evidence first.' : `Error: ${err.message}`);
    } finally { setPkgBusy(false); }
  }

  // ── Render ───────────────────────────────────────────────

  if (err) return (
    <div className="p-4 flex items-start gap-3 text-red-400">
      <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
      <div>
        <div className="text-[11px] font-bold uppercase tracking-wide">FOOTAGE ERROR</div>
        <div className="text-[10px] mt-0.5 text-red-300">{err}</div>
        <button onClick={() => { setErr(null); reload(); }}
          className="mt-2 text-[10px] text-brand-400 underline">Retry</button>
      </div>
    </div>
  );
  if (!data) return (
    <div className="p-4 flex items-center gap-2 text-rmpg-400 text-[11px]">
      <Video className="w-4 h-4 animate-pulse" />Loading footage…
    </div>
  );

  const total    = timeline.totalMs;
  const pct      = total ? Math.min(100, (posMs / total) * 100) : 0;
  const markers  = data.markers.filter((m) => m.offset_ms != null);
  const sc       = statusBadge(data.request.status);
  const dlBytes  = data.chunks.filter((c) => c.status === 'downloaded').reduce((s, c) => s + c.bytes, 0);
  const dlCount  = data.chunks.filter((c) => c.status === 'downloaded').length;

  return (
    <div className="flex flex-col min-h-full bg-surface-base">

      {/* ── MDT Header ─────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3 py-2 bg-surface-sunken border-b-2 border-blue-800/60 flex-shrink-0">
        <a href="/flexcam"
          className="flex items-center gap-1 text-[9px] text-rmpg-400 hover:text-brand-400 transition-colors uppercase tracking-wider font-bold flex-shrink-0">
          <ChevronLeft className="w-3 h-3" />FOOTAGE
        </a>
        <div className="w-px h-4 bg-border-default flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-bold text-rmpg-100 uppercase tracking-wider truncate">
            {data.request.title ?? `REQUEST ${data.request.id}`}
          </div>
          <div className="text-[9px] text-rmpg-500 font-mono">
            {fmtTs(data.request.from_ts)} — {fmtTs(data.request.to_ts)}
          </div>
        </div>
        <div className={`flex items-center gap-1 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${sc.bg} ${sc.text} border border-current/30 flex-shrink-0`}>
          {data.request.status === 'complete'   && <CheckCircle2 className="w-2.5 h-2.5" />}
          {data.request.status === 'fulfilling' && <Clock className="w-2.5 h-2.5 animate-spin" />}
          {sc.label}
        </div>
        {!!data.request.evidence_locked && (
          <div className="flex items-center gap-1 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider bg-[#d4a017]/10 text-[#d4a017] border border-[#d4a017]/40 flex-shrink-0">
            <Lock className="w-2.5 h-2.5" />
            {data.request.evidence_number ?? 'EVIDENCE'}
          </div>
        )}
      </div>

      {/* ── Video ───────────────────────────────────────────── */}
      <div ref={fullRef} className="relative bg-black border-b border-border-default flex-shrink-0">
        {/* Dashcam corner overlays */}
        <div className="absolute top-2 left-2 z-10 flex items-center gap-2 pointer-events-none">
          <Shield className="w-3 h-3 text-white/25" />
          <span className="text-[8px] text-white/35 font-mono tracking-widest uppercase">
            RMPG FLEXCAM&nbsp;·&nbsp;{new Date(data.request.from_ts).toLocaleDateString('en-US', { timeZone: 'America/Denver' })}
          </span>
        </div>
        {playing && (
          <div className="absolute top-2 right-10 z-10 flex items-center gap-1 text-[8px] text-red-400 font-mono font-bold pointer-events-none">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block animate-pulse" />REC
          </div>
        )}
        {loading && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/60 pointer-events-none">
            <span className="text-[10px] text-brand-400 font-mono animate-pulse tracking-widest">LOADING SEGMENT…</span>
          </div>
        )}
        <video
          ref={videoRef}
          className="w-full max-h-[56vh] bg-black"
          onEnded={onEnded}
          onTimeUpdate={onTimeUpdate}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          controls={false}
          playsInline
        />
        <button onClick={handleFullscreen}
          className="absolute bottom-2 right-2 z-10 p-1.5 bg-black/50 text-white/40 hover:text-white transition-colors">
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
        {!timeline.segments.length && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 gap-2 pointer-events-none">
            <Video className="w-8 h-8 text-rmpg-600" />
            <span className="text-[10px] text-rmpg-400 font-mono uppercase tracking-wider">
              {data.request.status === 'fulfilling' ? 'DOWNLOADING FOOTAGE…' : 'NO FOOTAGE AVAILABLE'}
            </span>
          </div>
        )}
      </div>

      {/* ── Transport + scrubber ─────────────────────────────── */}
      <div className="px-3 py-2.5 bg-surface-sunken border-b border-border-default flex-shrink-0 space-y-2">
        {/* Controls row */}
        <div className="flex items-center gap-3">
          <button onClick={togglePlay} disabled={!timeline.segments.length}
            className="flex items-center gap-1.5 px-4 py-2 text-[10px] font-bold uppercase tracking-wide
                       border border-blue-700 bg-blue-900/40 text-blue-300 hover:bg-blue-800/50
                       disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
            {playing ? <><Pause className="w-3.5 h-3.5" />PAUSE</> : <><Play className="w-3.5 h-3.5" />PLAY</>}
          </button>
          <div className="font-mono tabular-nums text-[12px]">
            <span className="text-brand-400">{fmt(posMs)}</span>
            <span className="text-rmpg-600 mx-0.5">/</span>
            <span className="text-rmpg-300">{fmt(total)}</span>
          </div>
          <div className="flex-1" />
          <div className="text-[9px] text-rmpg-500 text-right leading-tight">
            <div>{dlCount}/{data.chunks.length} segs · {fmtBytes(dlBytes)}</div>
            {data.manifest.gaps.length > 0 && (
              <div className="text-amber-500">{data.manifest.gaps.length} GAP{data.manifest.gaps.length > 1 ? 'S' : ''}</div>
            )}
          </div>
        </div>

        {/* Scrubber */}
        <div className="relative h-8 bg-[#0a0f18] border border-blue-900/40 cursor-pointer select-none"
          onClick={(e) => {
            const r = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
            seekToOffset(((e.clientX - r.left) / r.width) * total);
          }}>
          {/* Downloaded segment bands */}
          {timeline.segments.map((seg) => (
            <div key={seg.seq}
              className="absolute top-0 bottom-0 bg-blue-700/20 border-r border-blue-700/15"
              style={{ left: `${(seg.startMs / total) * 100}%`, width: `${(seg.durationMs / total) * 100}%` }} />
          ))}
          {/* Gold playhead with glow */}
          <div className="absolute top-0 bottom-0 w-[2px] pointer-events-none"
            style={{ left: `${pct}%`, background: '#d4a017', boxShadow: '0 0 6px #d4a01788' }} />
          {/* Clickable marker pins */}
          {markers.map((m, i) => (
            <div key={i}
              title={`${m.label ?? m.type ?? m.kind}${m.turn_dir ? ` · ${m.turn_dir}` : ''}${m.heading_deg != null ? ` · ${headingToCard(m.heading_deg)}` : ''} @ ${fmt(m.offset_ms!)}`}
              onClick={(e) => { e.stopPropagation(); seekToOffset(m.offset_ms!); }}
              className="absolute top-0 bottom-0 w-[4px] hover:w-[7px] transition-all cursor-pointer"
              style={{ left: `${total ? (m.offset_ms! / total) * 100 : 0}%`, background: pinColor(m), opacity: 0.85 }} />
          ))}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-[8px] font-mono text-white/15 select-none">{fmt(posMs)}</span>
          </div>
        </div>

        {/* Chunk download strip — color-coded per-segment download map */}
        <div className="flex gap-px h-1.5 overflow-hidden">
          {data.chunks.map((c) => (
            <div key={c.seq} className={`flex-1 min-w-[2px] ${
              c.status === 'downloaded' ? 'bg-blue-500' :
              c.status === 'missing'    ? 'bg-red-900'  :
              c.status === 'requested'  ? 'bg-amber-700' : 'bg-surface-raised'
            }`} title={`Seg ${c.seq}: ${c.status}`} />
          ))}
        </div>
        <div className="flex gap-4 text-[9px] text-rmpg-600">
          <span><span className="inline-block w-2 h-1 bg-blue-500 mr-1 align-middle" />downloaded</span>
          <span><span className="inline-block w-2 h-1 bg-amber-700 mr-1 align-middle" />pending</span>
          <span><span className="inline-block w-2 h-1 bg-red-900 mr-1 align-middle" />unavailable</span>
        </div>
      </div>

      {/* ── Evidence action bar ──────────────────────────────── */}
      <div className="px-3 py-2 bg-surface-raised border-b border-border-default flex items-center gap-2 flex-wrap flex-shrink-0">
        <div className="flex items-center gap-1 text-[9px] text-rmpg-500 uppercase tracking-wider font-bold flex-shrink-0">
          <Shield className="w-3 h-3" />EVIDENCE
        </div>
        <div className="w-px h-4 bg-border-default flex-shrink-0" />
        {data.request.evidence_locked ? (
          <div className="flex items-center gap-1.5 text-[10px] font-bold text-[#d4a017]">
            <Lock className="w-3 h-3" />
            {data.request.evidence_number ?? 'LOCKED'}
            {data.request.classification && (
              <span className="text-[9px] text-rmpg-500 font-normal">· {data.request.classification}</span>
            )}
          </div>
        ) : (
          <button onClick={lockEvidence} disabled={lockBusy}
            className="flex items-center gap-1 text-[10px] text-rmpg-300 hover:text-[#d4a017] border border-border-default hover:border-[#d4a017]/50 px-2.5 py-1 transition-colors disabled:opacity-40">
            <Lock className="w-3 h-3" />{lockBusy ? 'LOCKING…' : 'LOCK AS EVIDENCE'}
          </button>
        )}
        <button onClick={genCourtPkg} disabled={!data.request.evidence_locked || pkgBusy}
          className="flex items-center gap-1 text-[10px] text-rmpg-300 hover:text-brand-400 border border-border-default hover:border-brand-500 px-2.5 py-1 transition-colors disabled:opacity-30">
          <FileText className="w-3 h-3" />{pkgBusy ? 'GENERATING…' : 'COURT PACKAGE'}
        </button>
        <a href={`/api/flexcam/footage/${data.request.id}`} target="_blank" rel="noreferrer"
          className="flex items-center gap-1 text-[10px] text-rmpg-400 hover:text-brand-400 px-1 transition-colors ml-auto">
          <Download className="w-3 h-3" />MANIFEST
        </a>
      </div>
      {pkgMsg && (
        <div className={`px-3 py-1.5 text-[10px] font-mono border-b border-border-default ${
          pkgMsg.startsWith('✓') ? 'text-emerald-400 bg-emerald-900/10' : 'text-amber-400 bg-amber-900/10'}`}>
          {pkgMsg}
        </div>
      )}

      {/* ── Event marker list ────────────────────────────────── */}
      <div className="flex-1 overflow-auto min-h-0">
        <div className="px-3 py-2 border-b border-border-default flex items-center gap-3 flex-wrap">
          <span className="text-[9px] text-rmpg-500 uppercase tracking-wider font-bold">
            EVENTS {markers.length > 0 && `(${markers.length})`}
          </span>
          <div className="flex gap-3 text-[9px] text-rmpg-600">
            <span><span className="inline-block w-2 h-2 mr-0.5 align-middle" style={{ background: '#ef4444' }} />critical</span>
            <span><span className="inline-block w-2 h-2 mr-0.5 align-middle" style={{ background: '#f59e0b' }} />warning</span>
            <span><span className="inline-block w-2 h-2 mr-0.5 align-middle" style={{ background: '#38bdf8' }} />turn</span>
            <span><span className="inline-block w-2 h-2 mr-0.5 align-middle" style={{ background: '#34d399' }} />info</span>
          </div>
        </div>
        {markers.length === 0 ? (
          <div className="px-3 py-6 text-center text-[10px] text-rmpg-600">
            No events detected.{' '}
            <a href={`/api/flexcam/footage/${data.request.id}/markers?rebuild=1`}
              target="_blank" rel="noreferrer" className="underline hover:text-brand-400">
              Rebuild markers
            </a>
          </div>
        ) : (
          <ul className="divide-y divide-border-default">
            {markers.map((m, i) => {
              const active = posMs >= (m.offset_ms ?? 0) && posMs < (m.offset_ms ?? 0) + 1000;
              return (
                <li key={i}
                  onClick={() => seekToOffset(m.offset_ms!)}
                  className={`flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors ${active ? 'bg-blue-900/30' : 'hover:bg-surface-raised'}`}>
                  <div className="w-1 self-stretch flex-shrink-0" style={{ background: pinColor(m) }} />
                  <span className="text-[10px] font-mono tabular-nums text-rmpg-400 w-12 flex-shrink-0">
                    {fmt(m.offset_ms!)}
                  </span>
                  <span className="text-[9px] uppercase tracking-wide font-bold px-1.5 py-0.5 border flex-shrink-0"
                    style={{ borderColor: `${pinColor(m)}44`, color: pinColor(m), background: `${pinColor(m)}11` }}>
                    {m.severity ?? m.type ?? m.kind}
                  </span>
                  <span className="text-[10px] text-rmpg-300 flex-1 min-w-0 truncate">
                    {m.label ?? m.type ?? m.kind}
                    {m.turn_dir && ` · ${m.turn_dir.toUpperCase()}`}
                    {m.heading_deg != null && ` · ${headingToCard(m.heading_deg)} ${Math.round(m.heading_deg)}°`}
                  </span>
                  <Play className="w-3 h-3 text-rmpg-600 flex-shrink-0" />
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
