// client/src/pages/FlexCamFootagePage.tsx
// Police MDT-style dashcam footage player — sequential 40s chunk playback,
// evidence lock/court-package workflow, touchscreen-optimised controls.
//
// Player uses a DOUBLE-BUFFER: two <video> elements (vid0/vid1) that swap roles.
// While vid0 plays clip N, vid1 silently pre-parses clip N+1. On transition we
// flip which element is "front" (z-10) — the browser never needs to re-parse,
// giving near-zero gap between segments.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import {
  AlertTriangle, Camera, CheckCircle2, ChevronLeft, Clock, Download,
  FileText, Film, Keyboard, Lock, Maximize2, Pause, Play, RotateCcw,
  Shield, SkipBack, SkipForward, Video, Wrench,
} from 'lucide-react';
import { apiFetch, apiFetchBlob } from '../hooks/useApi';
import { buildTimeline, offsetToSeek, type PlayChunk } from '../utils/flexcamTimeline';
import { formatPlayerStatus } from '../utils/flexcamPlayerStatus';
import { usePersistedState } from '../hooks/usePersistedState';
import { useAuth } from '../context/AuthContext';
import ConfirmDialog from '../components/ConfirmDialog';
import { parseTimestamp } from '../utils/dateUtils';
import { withAlpha } from '../utils/withAlpha';

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
  chunk_count?: number; chunks_done?: number;
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
  const { user } = useAuth();
  const canManage = user?.role === 'admin' || user?.role === 'manager';
  const [data, setData]         = useState<Detail | null>(null);
  const [err, setErr]           = useState<string | null>(null);
  const [idx, setIdx]           = useState(0);
  const [playing, setPlaying]   = useState(false);
  // posMsRef mirrors posMs so rAF closures always read the live value.
  const [posMs, _setPosMs]      = useState(0);
  const posMsRef                = useRef(0);
  function setPosMs(ms: number) { posMsRef.current = ms; _setPosMs(ms); }
  const [loading, setLoading]   = useState(false);
  // playbackErr is per-chunk (decode failed / fetch timed out). Distinct from
  // `err` (which represents a top-level GET /flexcam/footage/:id failure and
  // replaces the entire UI). playbackErr keeps the player visible and surfaces
  // the failure as an inline banner so the operator knows WHY the clip won't
  // load — versus the prior silent hang where canplay never fired.
  const [playbackErr, setPlaybackErr] = useState<string | null>(null);
  const [lockBusy, setLockBusy] = useState(false);
  const [pkgBusy, setPkgBusy]       = useState(false);
  const [pkgMsg, setPkgMsg]         = useState<string | null>(null);
  const [markersLoading, setMarkersLoading] = useState(false);
  const [manifestBusy, setManifestBusy] = useState(false);
  const [rate, setRate]               = useState(1);
  const [capturing, setCapturing]     = useState(false);
  const [capMsg, setCapMsg]           = useState<string | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // 'classic' = full police dashcam bars; 'minimal' = subtle corner HUD; 'none' = off.
  // Persist per-browser so officers don't have to re-set their preferred HUD
  // every time they open a different request — matches the per-user UX
  // operators expect from the rest of the app.
  const [overlayMode, setOverlayMode] = usePersistedState<'classic' | 'minimal' | 'none'>(
    'rmpg_flexcam_overlay_mode',
    'classic',
    (v) => v === 'classic' || v === 'minimal' || v === 'none',
  );
  const overlayModeRef = useRef<'classic' | 'minimal' | 'none'>('classic');
  const [repairBusy, setRepairBusy]   = useState(false);
  const [repairMsg, setRepairMsg]     = useState<string | null>(null);
  const [burning, setBurning]         = useState(false);
  const [burnMsg, setBurnMsg]         = useState<string | null>(null);
  const burnRafRef    = useRef(0);
  const burnRecRef    = useRef<MediaRecorder | null>(null);

  // ConfirmDialog state — lock-evidence confirm (irreversible action)
  const [lockConfirmOpen, setLockConfirmOpen] = useState(false);
  // Ref for N-shortcut focus target (play/pause button)
  const playBtnRef = useRef<HTMLButtonElement | null>(null);

  // Double-buffer: two video elements that swap roles.
  // frontRef / front (state) = which slot (0 or 1) is currently visible.
  // backSeqRef = which seq is pre-loaded in the back buffer (null if none).
  const vid0 = useRef<HTMLVideoElement | null>(null);
  const vid1 = useRef<HTMLVideoElement | null>(null);
  const frontRef    = useRef<0 | 1>(0);
  const backSeqRef  = useRef<number | null>(null);
  const [front, setFront] = useState<0 | 1>(0);

  const urlCache = useRef<Map<number, string>>(new Map());
  const fullRef  = useRef<HTMLDivElement | null>(null);
  // Monotonically-increasing generation counter: every playSegment call grabs
  // the next value. Any async continuation that sees a newer value is stale
  // (another call won) and must bail out without touching the video element.
  const genRef   = useRef(0);

  // Helpers: get front/back video element from current frontRef value.
  function getFrontEl(): HTMLVideoElement | null {
    return (frontRef.current === 0 ? vid0 : vid1).current;
  }
  function getBackEl(): HTMLVideoElement | null {
    return (frontRef.current === 0 ? vid1 : vid0).current;
  }

  const reload = useCallback(() => {
    let cancelled = false;
    apiFetch<Detail>(`/flexcam/footage/${id}`)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e: Error) => { if (!cancelled) setErr(e.message); });
    return () => { cancelled = true; };
  }, [id]);

  useEffect(() => reload(), [reload]);
  useEffect(() => () => {
    for (const u of urlCache.current.values()) URL.revokeObjectURL(u);
    urlCache.current.clear();
  }, []);

  // ── URL deep-link: /flexcam/:id?event_id=<n> | ?t=<ms> ─────────────────
  // Cross-page contract: case / incident / activity-feed rows link to the
  // marker that triggered the entry, and the supervisor lands with the
  // playhead already on that event. `event_id` takes precedence over `t=`
  // when both are present. The param is stripped after consumption so a
  // refresh does not re-seek (the operator may have scrubbed elsewhere).
  // One-shot per page load; gated on `data` so the timeline / markers
  // arrays are populated before we try to look up the offset.
  const [searchParams, setSearchParams] = useSearchParams();
  const pendingEventIdRef = useRef<string | null>(searchParams.get('event_id'));
  const pendingTimeRef    = useRef<string | null>(searchParams.get('t'));
  useEffect(() => {
    if (!data) return;
    const eventTarget = pendingEventIdRef.current;
    const timeTarget  = pendingTimeRef.current;
    if (!eventTarget && !timeTarget) return;
    pendingEventIdRef.current = null;
    pendingTimeRef.current = null;
    let offsetMs: number | null = null;
    if (eventTarget) {
      const idx = Number(eventTarget);
      // Allow both 1-based event_id (operator-friendly URL form) and
      // matching by ts_ms when the entry didn't have a stable index.
      const m = data.markers[idx - 1] ?? data.markers.find((mm) => mm.ts_ms === idx);
      if (m && m.offset_ms != null) offsetMs = m.offset_ms;
    }
    if (offsetMs == null && timeTarget) {
      const t = Number(timeTarget);
      if (Number.isFinite(t) && t >= 0) offsetMs = t;
    }
    if (offsetMs != null) seekToOffset(offsetMs);
    const next = new URLSearchParams(searchParams);
    next.delete('event_id');
    next.delete('t');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // Keep overlayModeRef in sync so the burn rAF closure reads the live value.
  useEffect(() => { overlayModeRef.current = overlayMode; }, [overlayMode]);

  // Apply playback speed to the front video whenever rate changes.
  useEffect(() => {
    const v = getFrontEl();
    if (v) v.playbackRate = rate;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rate]);

  const timeline = useMemo(() => {
    const downloaded = (data?.chunks ?? [])
      .filter((c) => c.status === 'downloaded')
      .map<PlayChunk>((c) => ({ seq: c.seq, durationMs: c.to_ts - c.from_ts }));
    return buildTimeline(downloaded);
  }, [data]);

  // total / pct must be declared before the early returns so they're always in scope
  // for closures (captureFrame) and for the keyboard useEffect below.
  const total = timeline.totalMs;
  const pct   = total ? Math.min(100, (posMs / total) * 100) : 0;

  // Keyboard shortcuts — must be declared before early returns (Rules of Hooks).
  // Space/K=play, J/L=skip10s, Shift+skip=30s, ,/.=speed, N=play toggle, ?=shortcuts, Esc=cascade.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      if (typing) return;
      // ── Escape smart-cascade (close-newest-first) ─────────────────────
      // Innermost state closes first; each branch calls stopPropagation
      // so parent handlers (e.g. a wrapping modal) do not double-fire.
      if (e.key === 'Escape') {
        if (lockConfirmOpen) { e.stopPropagation(); setLockConfirmOpen(false); return; }
        if (shortcutsOpen) { e.stopPropagation(); setShortcutsOpen(false); return; }
        if (document.fullscreenElement) {
          e.stopPropagation();
          // exitFullscreen is async; suppress rejection on platforms
          // (e.g. iOS Safari) that resolve via webkit prefix instead.
          document.exitFullscreen().catch(() => {});
          return;
        }
        if (playbackErr) { e.stopPropagation(); setPlaybackErr(null); return; }
        if (playing) {
          e.stopPropagation();
          const v = getFrontEl();
          if (v) { v.pause(); setPlaying(false); }
          return;
        }
        return;
      }
      // N = focus/activate play button (primary action shortcut)
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        playBtnRef.current?.focus();
        togglePlay();
        return;
      }
      switch (e.key) {
        case ' ': case 'k': e.preventDefault(); togglePlay(); break;
        case 'ArrowLeft': case 'j':
          seekToOffset(Math.max(0, posMs - (e.shiftKey ? 30_000 : 10_000)));
          break;
        case 'ArrowRight': case 'l':
          seekToOffset(Math.min(total, posMs + (e.shiftKey ? 30_000 : 10_000)));
          break;
        case '>': case '.': setRate((r) => Math.min(2, +(r + 0.25).toFixed(2))); break;
        case '<': case ',': setRate((r) => Math.max(0.25, +(r - 0.25).toFixed(2))); break;
        case '?': setShortcutsOpen((v) => !v); break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posMs, total, shortcutsOpen, playbackErr, playing, lockConfirmOpen]);

  async function loadSeq(seq: number): Promise<string | null> {
    const cached = urlCache.current.get(seq);
    if (cached) return cached;
    setLoading(true);
    try {
      const blob = await apiFetchBlob(`/flexcam/footage/${id}/chunk/${seq}/stream`);
      const url = URL.createObjectURL(blob);
      urlCache.current.set(seq, url);
      return url;
    } catch (e) {
      // Chunk fetch failures used to setErr(), which replaced the entire page
      // with a top-level error and hid the working timeline. Route them to
      // playbackErr so the player stays visible and shows the failure inline.
      setPlaybackErr(`Clip ${seq}: ${(e as Error).message}`);
      return null;
    }
    finally { setLoading(false); }
  }

  async function playSegment(segIndex: number, withinMs = 0) {
    const myGen = ++genRef.current;
    const seg   = timeline.segments[segIndex];
    if (!seg) return;
    setIdx(segIndex);

    const url = await loadSeq(seg.seq);
    if (!url || myGen !== genRef.current) return;

    // Determine which slot is front / back right now.
    const fSlot = frontRef.current;
    const bSlot = (1 - fSlot) as 0 | 1;
    const fEl = (fSlot === 0 ? vid0 : vid1).current!;
    const bEl = (bSlot === 0 ? vid0 : vid1).current!;

    // Fast-path: seek within the segment already loaded in the front video.
    if (fEl.src === url) {
      if (withinMs > 0) { try { fEl.currentTime = withinMs / 1000; } catch { /* */ } }
      fEl.playbackRate = rate;
      fEl.play().catch(() => { if (myGen === genRef.current) setPlaying(false); });
      return;
    }

    // Check whether back buffer already has this segment pre-parsed and ready.
    // Only use the pre-loaded buffer for sequential playback (withinMs===0);
    // seeks always re-load so currentTime can be set precisely.
    const isPreloaded = backSeqRef.current === seg.seq && bEl.readyState >= 3 && withinMs === 0;

    if (!isPreloaded) {
      // Load segment into back buffer, wait for canplay before flipping.
      // Race against a 15s timeout + listen for decode error so a malformed
      // chunk (or a fetch that produces an empty blob) doesn't leave the
      // LOADING… overlay up forever. Outcome surfaces in playbackErr so the
      // operator sees WHY the clip won't play.
      bEl.pause();
      bEl.src = url;
      setLoading(true);
      let outcome: 'ready' | 'error' | 'timeout';
      try {
        outcome = await new Promise<'ready' | 'error' | 'timeout'>((resolve) => {
          if (bEl.readyState >= 2) { resolve('ready'); return; }
          let timer: number | undefined;
          const cleanup = () => {
            bEl.removeEventListener('canplay', onCanplay);
            bEl.removeEventListener('error', onErr);
            if (timer !== undefined) window.clearTimeout(timer);
          };
          const onCanplay = () => { cleanup(); resolve('ready'); };
          const onErr = () => { cleanup(); resolve('error'); };
          bEl.addEventListener('canplay', onCanplay);
          bEl.addEventListener('error', onErr);
          timer = window.setTimeout(() => { cleanup(); resolve('timeout'); }, 15_000);
        });
      } finally {
        setLoading(false);
      }
      if (myGen !== genRef.current) return; // stale — newer call won
      if (outcome !== 'ready') {
        setPlaybackErr(outcome === 'timeout'
          ? `Clip ${seg.seq} timed out loading after 15s — chunk may be malformed or network stalled`
          : `Clip ${seg.seq} failed to decode`);
        setPlaying(false);
        return;
      }
      if (withinMs > 0) { try { bEl.currentTime = withinMs / 1000; } catch { /* */ } }
    }

    // Flip: back buffer becomes front. Update frontRef BEFORE play() so that
    // the onPlay handler on bEl sees the correct frontRef value.
    frontRef.current = bSlot;
    setFront(bSlot);
    fEl.pause();                                      // old front stops
    bEl.playbackRate = rate;
    bEl.play().catch(() => { if (myGen === genRef.current) setPlaying(false); });
    backSeqRef.current = null;

    // Pre-load next segment into the (now free) old-front slot while this clip plays.
    const nextSeg = timeline.segments[segIndex + 1];
    if (nextSeg) {
      void loadSeq(nextSeg.seq).then((nextUrl) => {
        if (!nextUrl || myGen !== genRef.current) return;
        // After the flip, fSlot is now the back buffer.
        const newBackEl = (fSlot === 0 ? vid0 : vid1).current;
        if (!newBackEl || newBackEl.src === nextUrl) return;
        newBackEl.pause();
        newBackEl.src = nextUrl;
        newBackEl.preload = 'auto';
        newBackEl.load(); // start parsing — does NOT autoplay
        backSeqRef.current = nextSeg.seq;
      });
    }
  }

  function onEnded(e: React.SyntheticEvent<HTMLVideoElement>) {
    // Guard: only the front video's ended event advances the timeline.
    if (e.currentTarget !== getFrontEl()) return;
    if (idx < timeline.segments.length - 1) void playSegment(idx + 1);
    else setPlaying(false);
  }
  function onTimeUpdate(e: React.SyntheticEvent<HTMLVideoElement>) {
    if (e.currentTarget !== getFrontEl()) return;
    const seg = timeline.segments[idx];
    if (seg) setPosMs(seg.startMs + (e.currentTarget as HTMLVideoElement).currentTime * 1000);
  }
  function togglePlay() {
    const video = getFrontEl();
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
    } catch (e) {
      // Surface the failure into pkgMsg (the evidence-action-bar banner)
      // rather than setErr(), which replaced the whole page with a fatal
      // error and hid the otherwise-working timeline + scrubber.
      setPkgMsg(`⚠ Lock failed: ${(e as Error).message}`);
    }
    finally { setLockBusy(false); }
  }

  // Hard-reset the player: cancel in-flight loads, revoke cached blobs,
  // clear both video elements, reset all state, and re-fetch fresh request data.
  function reconfigure() {
    genRef.current++;
    for (const ref of [vid0, vid1]) {
      const v = ref.current;
      if (v) { v.pause(); v.src = ''; }
    }
    for (const u of urlCache.current.values()) URL.revokeObjectURL(u);
    urlCache.current.clear();
    frontRef.current = 0;
    backSeqRef.current = null;
    setFront(0);
    setIdx(0); setPosMs(0); setPlaying(false); setLoading(false); setPkgMsg(null);
    setPlaybackErr(null);
    reload();
  }

  async function rebuildMarkers() {
    if (!data || markersLoading) return;
    setMarkersLoading(true);
    try {
      await apiFetch(`/flexcam/footage/${data.request.id}/markers?rebuild=1`);
      reload();
    } catch (e) { setErr((e as Error).message); }
    finally { setMarkersLoading(false); }
  }

  async function downloadManifest() {
    if (!data || manifestBusy) return;
    setManifestBusy(true);
    try {
      const json = await apiFetch<unknown>(`/flexcam/footage/${data.request.id}`);
      const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `footage-manifest-${data.request.id}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 3000);
    } catch (e) { setErr((e as Error).message); }
    finally { setManifestBusy(false); }
  }

  // ── Canvas overlay helpers ─────────────────────────────────────────────────
  // drawOverlayOnCanvas mirrors the JSX overlays so "Burn Clip" output matches
  // what the officer sees on screen.  Must be called AFTER ctx.drawImage(video).

  function drawClassicOverlay(ctx: CanvasRenderingContext2D, W: number, H: number, nowMs: number) {
    if (!data) return;
    const barH  = Math.max(26, Math.round(H * 0.042));
    const fs    = Math.max(11, Math.round(barH * 0.46));
    const fsS   = Math.max(9,  Math.round(barH * 0.37));
    const pad   = Math.round(W * 0.012);

    // ── Top bar ──
    ctx.fillStyle = 'rgba(0 0 0 / 0.84)';
    ctx.fillRect(0, 0, W, barH * 2);
    ctx.textBaseline = 'top';

    // Dept name
    ctx.font = `bold ${fs}px monospace`;
    ctx.fillStyle = '#fbbf24';
    ctx.textAlign = 'left';
    ctx.fillText('ROCKY MTN PROTECTIVE GROUP', pad, Math.round(barH * 0.18));

    // Sub-line: camera / date
    const dateStr = new Date(data.request.from_ts).toLocaleDateString('en-US',
      { timeZone: 'America/Denver', month: '2-digit', day: '2-digit', year: 'numeric' });
    ctx.font = `${fsS}px monospace`;
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillText(`IN-CAR FORWARD  ·  ${dateStr}`, pad, Math.round(barH * 0.18) + fs + 2);

    // REC indicator (top-right)
    const recLabel = '● REC';
    ctx.font = `bold ${fs}px monospace`;
    ctx.fillStyle = '#ef4444';
    ctx.textAlign = 'right';
    ctx.fillText(recLabel, W - pad, Math.round(barH * 0.18));

    // Unit label below REC
    const unit = (data.request.title ?? `REQ-${data.request.id}`).toUpperCase();
    ctx.font = `${fsS}px monospace`;
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillText(unit, W - pad, Math.round(barH * 0.18) + fs + 2);

    // ── Bottom bar ──
    ctx.fillStyle = 'rgba(0 0 0 / 0.84)';
    ctx.fillRect(0, H - barH * 2, W, barH * 2);
    ctx.textBaseline = 'middle';
    const midY = H - barH;

    const nowDate = new Date(data.request.from_ts + nowMs);
    const dStr = nowDate.toLocaleDateString('en-US',
      { timeZone: 'America/Denver', month: '2-digit', day: '2-digit', year: 'numeric' });
    const tStr = nowDate.toLocaleTimeString('en-US',
      { timeZone: 'America/Denver', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });

    ctx.font = `${fs}px monospace`;
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.textAlign = 'left';
    ctx.fillText(dStr, pad, midY);

    ctx.font = `bold ${fs}px monospace`;
    ctx.fillStyle = '#fbbf24';
    ctx.textAlign = 'center';
    ctx.fillText(`${tStr}  MDT`, W / 2, midY);

    const evLabel = data.request.evidence_locked
      ? (data.request.evidence_number ?? 'EVIDENCE')
      : 'UNCLASSIFIED';
    ctx.font = `${fs}px monospace`;
    ctx.fillStyle = data.request.evidence_locked ? '#fbbf24' : 'rgba(255,255,255,0.4)';
    ctx.textAlign = 'right';
    ctx.fillText(evLabel, W - pad, midY);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    // Diagonal evidence watermark when locked
    if (data.request.evidence_locked) {
      ctx.save();
      ctx.translate(W / 2, H / 2);
      ctx.rotate(-Math.PI / 7);
      ctx.font = `bold ${Math.round(H * 0.09)}px monospace`;
      ctx.fillStyle = 'rgba(251,191,36,0.09)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText((data.request.evidence_number ?? 'EVIDENCE').toUpperCase(), 0, 0);
      ctx.restore();
    }
  }

  function drawMinimalOverlay(ctx: CanvasRenderingContext2D, W: number, H: number, nowMs: number) {
    if (!data) return;
    const fs  = Math.max(11, Math.round(H * 0.018));
    const pad = 8;
    const nowDate = new Date(data.request.from_ts + nowMs);
    const tsStr = nowDate.toLocaleTimeString('en-US',
      { timeZone: 'America/Denver', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });

    // Timestamp badge bottom-left
    ctx.fillStyle = 'rgba(0 0 0 / 0.5)';
    const stampW = ctx.measureText(tsStr).width + 16;
    ctx.fillRect(pad, H - pad - fs * 2.2 - fs * 1.4, stampW, fs * 1.4);
    ctx.font = `${fs}px monospace`;
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillText(tsStr, pad + 8, H - pad - fs * 2.2 - fs * 1.4 + 2);

    // Evidence watermark
    if (data.request.evidence_locked) {
      ctx.save();
      ctx.translate(W / 2, H / 2);
      ctx.rotate(-Math.PI / 7);
      ctx.font = `bold ${Math.round(H * 0.09)}px monospace`;
      ctx.fillStyle = 'rgba(212,160,23,0.11)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(data.request.evidence_number ?? 'EVIDENCE', 0, 0);
      ctx.restore();
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  // Burn the current frame to canvas + download as JPEG.
  async function captureFrame() {
    const video = getFrontEl();
    if (!video || !data || capturing) return;
    setCapturing(true);
    try {
      const W = video.videoWidth || 1280;
      const H = video.videoHeight || 720;
      const canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      try { ctx.drawImage(video, 0, 0, W, H); } catch { setCapMsg('Frame capture failed (video not ready)'); return; }

      if (overlayMode === 'classic') drawClassicOverlay(ctx, W, H, posMs);
      else if (overlayMode === 'minimal') drawMinimalOverlay(ctx, W, H, posMs);
      else {
        // No overlay mode: still stamp a minimal evidence strip so the JPEG is identifiable.
        const absTs = new Date(data.request.from_ts + posMs);
        const tsLabel = absTs.toLocaleString('en-US', { timeZone: 'America/Denver', month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
        const lines = [
          `RMPG FLEXCAM — ${data.request.title ?? `REQUEST ${data.request.id}`}`,
          `${tsLabel} · ${fmt(posMs)} / ${fmt(total)}`,
          data.request.evidence_locked ? `EVIDENCE: ${data.request.evidence_number ?? 'LOCKED'}` : 'UNCLASSIFIED — NOT EVIDENCE',
        ];
        const fs = Math.max(14, Math.round(H * 0.022));
        const stripH = fs * (lines.length + 0.6) + 12;
        ctx.fillStyle = 'rgba(0 0 0 / 0.76)';
        ctx.fillRect(0, H - stripH, W, stripH);
        ctx.textBaseline = 'top';
        lines.forEach((line, i) => {
          ctx.font = `${i === 0 ? 'bold ' : ''}${fs}px monospace`;
          ctx.fillStyle = i === 0 ? '#d4a017' : i === 2 && !data.request.evidence_locked ? '#ef4444' : '#e5e5e5';
          ctx.fillText(line, 12, H - stripH + 6 + i * fs * 1.18);
        });
      }

      canvas.toBlob((b) => {
        if (!b) return;
        const url = URL.createObjectURL(b);
        const a = document.createElement('a');
        const fname = `flexcam-${data.request.id}-${fmt(posMs).replace(/:/g, '-')}.jpg`;
        a.href = url; a.download = fname; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 3000);
        setCapMsg(`✓ ${fname}`);
        setTimeout(() => setCapMsg(null), 4000);
      }, 'image/jpeg', 0.95);
    } finally { setCapturing(false); }
  }

  // Burn current segment to video with overlay baked in.
  // Uses canvas.captureStream() → MediaRecorder → download webm.
  async function burnClip() {
    const video = getFrontEl();
    if (!video || !data || burning || !video.videoWidth) {
      setBurnMsg('⚠ Play a segment first to load video into the player.');
      setTimeout(() => setBurnMsg(null), 4000);
      return;
    }
    setBurning(true);
    setBurnMsg('Starting recording…');

    const W = video.videoWidth;
    const H = video.videoHeight;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d')!;

    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
        ? 'video/webm;codecs=vp8'
        : 'video/webm';
    const stream = canvas.captureStream(30);
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 4_000_000 });
    burnRecRef.current = recorder;
    const chunks: Blob[] = [];

    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onstop = () => {
      cancelAnimationFrame(burnRafRef.current);
      burnRecRef.current = null;
      const blob = new Blob(chunks, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const seg = timeline.segments[idx];
      a.href = url;
      a.download = `flexcam-${data.request.id}-seg${seg?.seq ?? (idx + 1)}-overlay.webm`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 8000);
      setBurning(false);
      setBurnMsg(`✓ Segment exported with overlay`);
      setTimeout(() => setBurnMsg(null), 5000);
    };

    // Draw loop: composite video + overlay onto canvas at 30fps.
    const mode = overlayModeRef.current;
    const drawLoop = () => {
      try { ctx.drawImage(video, 0, 0, W, H); } catch { /* video not ready */ }
      if (mode === 'classic') drawClassicOverlay(ctx, W, H, posMsRef.current);
      else if (mode === 'minimal') drawMinimalOverlay(ctx, W, H, posMsRef.current);
      burnRafRef.current = requestAnimationFrame(drawLoop);
    };

    // Seek to start of segment and play before starting the recorder.
    try { video.currentTime = 0; } catch { /* */ }
    await video.play().catch(() => {});

    recorder.start(200); // flush every 200ms for smooth download
    setBurnMsg('Recording… (plays at normal speed)');
    drawLoop();

    // Stop when the segment naturally ends.
    video.addEventListener('ended', () => {
      if (recorder.state === 'recording') recorder.stop();
    }, { once: true });
  }

  function cancelBurn() {
    const r = burnRecRef.current;
    if (r && r.state === 'recording') r.stop();
    cancelAnimationFrame(burnRafRef.current);
    setBurning(false);
    setBurnMsg(null);
    burnRecRef.current = null;
  }

  async function repairFootage() {
    if (!data || repairBusy) return;
    setRepairBusy(true); setRepairMsg(null);
    try {
      const res = await apiFetch<{ repaired: number; message: string }>(
        `/flexcam/footage/${data.request.id}/repair`, { method: 'POST' }
      );
      setRepairMsg(`✓ ${res.message}`);
      setTimeout(reload, 2000);
    } catch (e: unknown) {
      const err = e as Error & { status?: number };
      setRepairMsg(err.status === 409 ? '⚠ Locked — unlock first.' : `Error: ${err.message}`);
    } finally { setRepairBusy(false); }
  }

  async function genCourtPkg() {
    if (!data || pkgBusy) return;
    setPkgBusy(true); setPkgMsg(null);
    try {
      const res = await apiFetch<{ payloadHash: string; signedAt: string }>(
        `/flexcam/footage/${data.request.id}/court-package`, { method: 'POST' }
      );
      setPkgMsg(`✓ Signed ${parseTimestamp(res.signedAt).toLocaleString('en-US', { timeZone: 'America/Denver' })} · SHA-256: ${res.payloadHash.slice(0, 16)}…`);
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

  const markers  = data.markers.filter((m) => m.offset_ms != null);
  const sc       = statusBadge(data.request.status);
  const dlBytes  = data.chunks.filter((c) => c.status === 'downloaded').reduce((s, c) => s + c.bytes, 0);
  const dlCount  = data.chunks.filter((c) => c.status === 'downloaded').length;

  // Shared video-element props (same on both buffer slots). onError surfaces
  // codec/decode failures into playbackErr instead of failing silently — prior
  // behavior was the LOADING… overlay sitting up forever with no indication
  // the video element had already rejected the stream.
  const videoProps = {
    controls: false as const,
    playsInline: true,
    onEnded,
    onTimeUpdate,
    onError: (e: React.SyntheticEvent<HTMLVideoElement>) => {
      const v = e.currentTarget;
      // Ignore the noise event browsers fire when src is empty/cleared.
      if (!v.src || v.src === window.location.href) return;
      const code = v.error?.code;
      const msg = v.error?.message || 'unknown';
      setPlaybackErr(`Video decode error (code ${code ?? '?'}): ${msg}`);
      setPlaying(false);
    },
    style: { position: 'absolute' as const, inset: 0, width: '100%', height: '100%', objectFit: 'contain' as const, background: '#000' },
  };

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
          <div className="flex items-center gap-1 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider bg-[#d4a017]/10 [color:var(--panel-header-color)] border [border-color:var(--field-label-color)]/40 flex-shrink-0">
            <Lock className="w-2.5 h-2.5" />
            {data.request.evidence_number ?? 'EVIDENCE'}
          </div>
        )}
      </div>

      {/* ── Video ───────────────────────────────────────────────────────────
          Stable 16:9 container that never collapses. Height = 56.25vw (16:9 of
          full width) capped at 56vh. Both buffer videos sit absolutely inside;
          the front one has z-index 10 (visible), the back one z-index 0 (hidden).
      ─────────────────────────────────────────────────────────────────────── */}
      <div
        ref={fullRef}
        className="relative bg-black border-b border-border-default flex-shrink-0 w-full overflow-hidden"
        style={{ height: 'min(56.25vw, 56vh)' }}
      >
        {/* Slot 0 */}
        <video
          ref={vid0}
          {...videoProps}
          onPlay={() => { if (frontRef.current === 0) setPlaying(true); }}
          onPause={() => { if (frontRef.current === 0) setPlaying(false); }}
          style={{ ...videoProps.style, zIndex: front === 0 ? 10 : 0 }}
        />
        {/* Slot 1 */}
        <video
          ref={vid1}
          {...videoProps}
          onPlay={() => { if (frontRef.current === 1) setPlaying(true); }}
          onPause={() => { if (frontRef.current === 1) setPlaying(false); }}
          style={{ ...videoProps.style, zIndex: front === 1 ? 10 : 0 }}
        />

        {/* ── HUD overlays (pointer-events-none so click-to-play still works) */}

        {/* CLASSIC: full police dashcam bars top + bottom */}
        {overlayMode === 'classic' && (
          <div className="absolute inset-0 pointer-events-none select-none font-mono" style={{ zIndex: 20 }}>
            {/* Top bar */}
            <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-3"
              style={{ background: 'rgba(0 0 0 / 0.84)', borderBottom: '1px solid rgba(255,255,255,0.07)', paddingTop: 5, paddingBottom: 5 }}>
              <div className="flex flex-col leading-tight">
                <span className="text-[9px] font-bold tracking-[0.14em] uppercase" style={{ color: '#fbbf24' }}>
                  ROCKY MTN PROTECTIVE GROUP
                </span>
                <span className="text-[8px] tracking-[0.1em] uppercase" style={{ color: 'rgba(255,255,255,0.55)' }}>
                  IN-CAR FORWARD &nbsp;·&nbsp;
                  {new Date(data.request.from_ts).toLocaleDateString('en-US', { timeZone: 'America/Denver', month: '2-digit', day: '2-digit', year: 'numeric' })}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right leading-tight">
                  <span className="text-[9px] tracking-widest uppercase block" style={{ color: 'rgba(255,255,255,0.75)' }}>
                    {(data.request.title ?? `REQ-${data.request.id}`).toUpperCase()}
                  </span>
                  {rate !== 1 && (
                    <span className="text-[8px] font-bold" style={{ color: '#fbbf24' }}>{rate.toFixed(2)}×</span>
                  )}
                </div>
                {playing ? (
                  <div className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: '#ef4444' }} />
                    <span className="text-[9px] font-bold tracking-widest" style={{ color: 'var(--sev-critical)' }}>REC</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full" style={{ background: 'rgba(239,68,68,0.35)' }} />
                    <span className="text-[9px] tracking-widest" style={{ color: 'rgba(239,68,68,0.45)' }}>PAUSE</span>
                  </div>
                )}
              </div>
            </div>

            {/* Bottom bar */}
            <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between px-3"
              style={{ background: 'rgba(0 0 0 / 0.84)', borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: 5, paddingBottom: 5 }}>
              <span className="text-[9px] tracking-widest tabular-nums" style={{ color: 'rgba(255,255,255,0.75)' }}>
                {new Date(data.request.from_ts + posMs).toLocaleDateString('en-US', { timeZone: 'America/Denver', month: '2-digit', day: '2-digit', year: 'numeric' })}
              </span>
              <span className="text-[10px] font-bold tracking-widest tabular-nums" style={{ color: '#fbbf24' }}>
                {new Date(data.request.from_ts + posMs).toLocaleTimeString('en-US', { timeZone: 'America/Denver', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                {' '}MDT
              </span>
              <span className="text-[9px] tracking-widest uppercase" style={{ color: data.request.evidence_locked ? '#fbbf24' : 'rgba(255,255,255,0.45)' }}>
                {data.request.evidence_locked ? (data.request.evidence_number ?? 'EVIDENCE') : 'UNCLASSIFIED'}
              </span>
            </div>

            {/* Diagonal evidence watermark when locked */}
            {!!data.request.evidence_locked && (
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="font-bold tracking-[0.3em] uppercase"
                  style={{ fontSize: 'clamp(18px,5vw,56px)', transform: 'rotate(-18deg)', whiteSpace: 'nowrap', color: 'rgba(251,191,36,0.09)' }}>
                  {data.request.evidence_number ?? 'EVIDENCE'}
                </span>
              </div>
            )}
          </div>
        )}

        {/* MINIMAL: subtle corner HUD */}
        {overlayMode === 'minimal' && (
          <div className="absolute inset-0 pointer-events-none select-none" style={{ zIndex: 20 }}>
            <div className="absolute top-2 left-2 flex items-center gap-1.5">
              <Shield className="w-3 h-3 text-white/30" />
              <span className="text-[8px] text-white/40 font-mono tracking-widest uppercase">
                RMPG&nbsp;·&nbsp;{new Date(data.request.from_ts).toLocaleDateString('en-US', { timeZone: 'America/Denver' })}
              </span>
            </div>
            <div className="absolute top-2 right-10 flex items-center gap-2">
              {playing && (
                <span className="flex items-center gap-1 text-[8px] text-red-400 font-mono font-bold">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block animate-pulse" />REC
                </span>
              )}
              {rate !== 1 && (
                <span className="text-[8px] font-mono font-bold [color:var(--panel-header-color)] bg-black/60 px-1 py-0.5">
                  {rate.toFixed(2)}×
                </span>
              )}
            </div>
            <div className="absolute bottom-10 left-2 flex flex-col gap-0.5">
              <span className="text-[9px] text-white/60 font-mono tabular-nums bg-black/50 px-1.5 py-0.5">
                {new Date(data.request.from_ts + posMs).toLocaleString('en-US', {
                  timeZone: 'America/Denver', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
                })}
              </span>
              <span className="text-[8px] text-white/35 font-mono tabular-nums px-1.5">
                T+{fmt(posMs)} / {fmt(total)}
              </span>
            </div>
            {!!data.request.evidence_locked && (
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="[color:var(--panel-header-color)]/10 font-bold font-mono tracking-[0.3em] uppercase"
                  style={{ fontSize: 'clamp(18px,5vw,56px)', transform: 'rotate(-18deg)', whiteSpace: 'nowrap' }}>
                  {data.request.evidence_number ?? 'EVIDENCE'}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Fullscreen + overlay mode cycle */}
        <div className="absolute bottom-2 right-2 flex items-center gap-1" style={{ zIndex: 30 }}>
          <button
            onClick={() => setOverlayMode((m) => m === 'classic' ? 'minimal' : m === 'minimal' ? 'none' : 'classic')}
            title={overlayMode === 'classic' ? 'Classic overlay → switch to Minimal' : overlayMode === 'minimal' ? 'Minimal overlay → switch to Off' : 'No overlay → switch to Classic'}
            className={`p-1.5 bg-black/50 transition-colors text-[8px] font-mono font-bold tracking-widest uppercase leading-none flex items-center gap-1 ${
              overlayMode === 'classic' ? 'text-amber-300/80 hover:text-amber-300' :
              overlayMode === 'minimal' ? 'text-white/40 hover:text-white/70' :
              'text-white/15 hover:text-white/40'
            }`}>
            <Shield className="w-3 h-3" />
            {overlayMode === 'classic' ? 'CAM' : overlayMode === 'minimal' ? 'MIN' : 'OFF'}
          </button>
          <button aria-label="Expand" onClick={handleFullscreen}
            className="p-1.5 bg-black/50 text-white/40 hover:text-white transition-colors">
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Loading segment overlay — shown only on initial fetch; pre-buffered transitions skip this */}
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 pointer-events-none" style={{ zIndex: 40 }}>
            <span className="text-[10px] text-brand-400 font-mono animate-pulse tracking-widest">LOADING…</span>
          </div>
        )}

        {/* No footage state — driven by formatPlayerStatus so the message is
            specific (error / partial count / no-footage / ready) instead of a
            binary "DOWNLOADING…/NO FOOTAGE AVAILABLE". */}
        {!timeline.segments.length && (() => {
          const status = formatPlayerStatus({
            err: playbackErr,
            chunkCount: data.request.chunk_count ?? 0,
            downloadedCount: data.request.chunks_done ?? 0,
            requestStatus: data.request.status,
          });
          const labelClass = status.severity === 'error' ? 'text-red-400'
            : status.severity === 'progress' ? 'text-blue-400'
            : 'text-rmpg-400';
          const iconClass = status.severity === 'error' ? 'text-red-500' : 'text-rmpg-600';
          return (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 gap-2 pointer-events-none px-4 text-center" style={{ zIndex: 20 }}>
              <Video className={`w-8 h-8 ${iconClass}`} />
              <span className={`text-[10px] ${labelClass} font-mono uppercase tracking-wider`}>
                {status.label}
              </span>
            </div>
          );
        })()}

        {/* Inline playback-error banner when chunks exist but a clip failed
            (decode error or canplay timeout). Dismissable; sits above HUD. */}
        {!!playbackErr && timeline.segments.length > 0 && (
          <div className="absolute top-2 left-2 right-2 flex items-start gap-2 px-2 py-1.5 bg-red-950/90 border border-red-700/60 text-red-200 text-[10px] font-mono" style={{ zIndex: 35 }}>
            <AlertTriangle className="w-3 h-3 flex-shrink-0 mt-0.5" />
            <div className="flex-1">{playbackErr}</div>
            <button onClick={() => setPlaybackErr(null)}
              className="text-red-300 hover:text-red-100 pointer-events-auto"
              aria-label="Dismiss error">×</button>
          </div>
        )}
      </div>

      {/* ── Transport + scrubber ─────────────────────────────── */}
      <div className="px-3 py-2.5 bg-surface-sunken border-b border-border-default flex-shrink-0 space-y-2">
        {/* Controls row */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Skip back */}
          <button onClick={() => seekToOffset(Math.max(0, posMs - 10_000))} disabled={!timeline.segments.length}
            title="Skip back 10s (J)" aria-label="Skip back 10s"
            className="p-1.5 border border-border-default text-rmpg-400 hover:text-brand-400 hover:border-brand-600 transition-colors disabled:opacity-30">
            <SkipBack className="w-3.5 h-3.5" />
          </button>

          {/* Play / Pause — N shortcut target */}
          <button ref={playBtnRef} onClick={togglePlay} disabled={!timeline.segments.length}
            className="flex items-center gap-1.5 px-4 py-2 text-[10px] font-bold uppercase tracking-wide
                       border border-blue-700 bg-blue-900/40 text-blue-300 hover:bg-blue-800/50
                       disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
            {playing ? <><Pause className="w-3.5 h-3.5" />PAUSE</> : <><Play className="w-3.5 h-3.5" />PLAY</>}
          </button>

          {/* Skip forward */}
          <button onClick={() => seekToOffset(Math.min(total, posMs + 10_000))} disabled={!timeline.segments.length}
            title="Skip forward 10s (L)" aria-label="Skip forward 10s"
            className="p-1.5 border border-border-default text-rmpg-400 hover:text-brand-400 hover:border-brand-600 transition-colors disabled:opacity-30">
            <SkipForward className="w-3.5 h-3.5" />
          </button>

          {/* Playback speed */}
          <button
            onClick={() => setRate((r) => {
              const steps = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];
              const idx = steps.indexOf(+r.toFixed(2));
              return steps[(idx + 1) % steps.length];
            })}
            title="Cycle playback speed (< / >)"
            className={`px-2 py-1.5 text-[9px] font-mono font-bold border transition-colors ${
              rate !== 1
                ? '[border-color:var(--field-label-color)]/60 [color:var(--panel-header-color)] bg-[#d4a017]/10 hover:bg-[#d4a017]/20'
                : 'border-border-default text-rmpg-500 hover:text-brand-400 hover:border-brand-600'}`}>
            {rate.toFixed(2)}×
          </button>

          {/* Reconfigure */}
          <button onClick={reconfigure} title="Stop playback, clear cached clips, and reload fresh data"
            className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wide
                       border border-border-default text-rmpg-400 hover:text-brand-400 hover:border-brand-600
                       transition-colors">
            <RotateCcw className="w-3 h-3" />RECFG
          </button>

          {/* Time display */}
          <div className="font-mono tabular-nums text-[12px] ml-1">
            <span className="text-brand-400">{fmt(posMs)}</span>
            <span className="text-rmpg-600 mx-0.5">/</span>
            <span className="text-rmpg-300">{fmt(total)}</span>
          </div>

          <div className="flex-1" />

          {/* Shortcuts hint */}
          <button onClick={() => setShortcutsOpen((v) => !v)}
            title="Keyboard shortcuts (?)"
            className={`p-1.5 border transition-colors ${shortcutsOpen ? 'border-brand-500 text-brand-400' : 'border-border-default text-rmpg-600 hover:text-rmpg-400'}`}>
            <Keyboard className="w-3 h-3" />
          </button>

          {/* Segment / gap summary */}
          <div className="text-[9px] text-rmpg-500 text-right leading-tight">
            <div>{dlCount}/{data.chunks.length} segs · {fmtBytes(dlBytes)}</div>
            {data.manifest.gaps.length > 0 && (
              <div className="text-amber-500">{data.manifest.gaps.length} GAP{data.manifest.gaps.length > 1 ? 'S' : ''}</div>
            )}
          </div>
        </div>

        {/* Keyboard shortcuts panel */}
        {shortcutsOpen && (
          <div className="bg-surface-sunken border border-border-default px-3 py-2 grid grid-cols-2 gap-x-6 gap-y-0.5 text-[9px]">
            {([
              ['N', 'Play / Pause (focus)'],
              ['Space / K', 'Play / Pause'],
              ['J / ←', 'Skip back 10s'],
              ['L / →', 'Skip forward 10s'],
              ['Shift+J / Shift+←', 'Skip back 30s'],
              ['Shift+L / Shift+→', 'Skip forward 30s'],
              ['< or ,', 'Speed down'],
              ['> or .', 'Speed up'],
              ['?', 'Toggle this panel'],
              ['Esc', 'Close panel / exit fullscreen / pause'],
            ] as [string, string][]).map(([key, label]) => (
              <div key={key} className="flex items-center gap-2">
                <span className="font-mono text-brand-400 w-28 flex-shrink-0">{key}</span>
                <span className="text-rmpg-500">{label}</span>
              </div>
            ))}
          </div>
        )}

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
          <div className="flex items-center gap-1.5 text-[10px] font-bold text-brand-400">
            <Lock className="w-3 h-3" />
            {data.request.evidence_number ?? 'LOCKED'}
            {data.request.classification && (
              <span className="text-[9px] text-rmpg-500 font-normal">· {data.request.classification}</span>
            )}
          </div>
        ) : canManage ? (
          <button onClick={() => setLockConfirmOpen(true)} disabled={lockBusy}
            className="flex items-center gap-1 text-[10px] text-rmpg-300 hover:text-brand-400 border border-border-default hover:border-brand-500/50 px-2.5 py-1 transition-colors disabled:opacity-40">
            <Lock className="w-3 h-3" />{lockBusy ? 'LOCKING…' : 'LOCK AS EVIDENCE'}
          </button>
        ) : null}
        {canManage && (
          <button onClick={genCourtPkg} disabled={!data.request.evidence_locked || pkgBusy}
            className="flex items-center gap-1 text-[10px] text-rmpg-300 hover:text-brand-400 border border-border-default hover:border-brand-500 px-2.5 py-1 transition-colors disabled:opacity-30">
            <FileText className="w-3 h-3" />{pkgBusy ? 'GENERATING…' : 'COURT PACKAGE'}
          </button>
        )}
        <button onClick={captureFrame} disabled={capturing}
          title="Burn current frame to JPEG with evidence stamp (no playback needed)"
          className="flex items-center gap-1 text-[10px] text-rmpg-300 hover:text-emerald-400 border border-border-default hover:border-emerald-700/50 px-2.5 py-1 transition-colors disabled:opacity-40">
          <Camera className="w-3 h-3" />{capturing ? 'CAPTURING…' : 'CAPTURE FRAME'}
        </button>
        {burning ? (
          <button onClick={cancelBurn}
            className="flex items-center gap-1 text-[10px] text-amber-400 border border-amber-600/60 hover:border-red-500/60 hover:text-red-400 px-2.5 py-1 transition-colors animate-pulse">
            <Film className="w-3 h-3" />STOP BURN
          </button>
        ) : (
          <button onClick={burnClip}
            title="Record current segment to video file with overlay burned in (plays at normal speed)"
            className="flex items-center gap-1 text-[10px] text-rmpg-300 hover:text-amber-400 border border-border-default hover:border-amber-600/50 px-2.5 py-1 transition-colors">
            <Film className="w-3 h-3" />BURN CLIP
          </button>
        )}
        {/* Repair — shown when trip is partial/stuck, not evidence-locked, and user has manage rights */}
        {data.request.status === 'partial' && !data.request.evidence_locked && canManage && (
          <button onClick={repairFootage} disabled={repairBusy}
            title="Reset missing chunks so the cron retries them"
            className="flex items-center gap-1 text-[10px] text-amber-400 hover:text-amber-300 border border-amber-700/60 hover:border-amber-600 px-2.5 py-1 transition-colors disabled:opacity-40">
            <Wrench className="w-3 h-3" />{repairBusy ? 'REPAIRING…' : 'REPAIR'}
          </button>
        )}
        <button onClick={downloadManifest} disabled={manifestBusy}
          className="flex items-center gap-1 text-[10px] text-rmpg-400 hover:text-brand-400 px-1 transition-colors ml-auto disabled:opacity-40">
          <Download className="w-3 h-3" />{manifestBusy ? 'DOWNLOADING…' : 'MANIFEST'}
        </button>
      </div>
      {(pkgMsg || capMsg || repairMsg || burnMsg) && (
        <div className="px-3 py-1.5 text-[10px] font-mono border-b border-border-default flex items-center gap-3">
          {pkgMsg && (
            <span className={pkgMsg.startsWith('✓') ? 'text-emerald-400' : 'text-amber-400'}>{pkgMsg}</span>
          )}
          {capMsg && <span className="text-emerald-400">{capMsg}</span>}
          {repairMsg && (
            <span className={repairMsg.startsWith('✓') ? 'text-emerald-400' : 'text-amber-400'}>{repairMsg}</span>
          )}
          {burnMsg && (
            <span className={burnMsg.startsWith('✓') ? 'text-emerald-400' : burnMsg.startsWith('⚠') ? 'text-amber-400' : 'text-amber-300'}>
              {burnMsg}
            </span>
          )}
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
          <div className="px-3 py-8 flex flex-col items-center gap-3 text-center">
            <CheckCircle2 className="w-6 h-6 text-rmpg-700" />
            <div className="space-y-1">
              <div className="text-[11px] text-rmpg-500 font-semibold uppercase tracking-wide">
                No events detected
              </div>
              <div className="text-[10px] text-rmpg-700 max-w-[260px]">
                {markersLoading
                  ? 'Scanning trip footage for driving events…'
                  : 'This trip has no flagged events. Re-run the AI scanner to re-check, or events will populate automatically as new data arrives.'}
              </div>
            </div>
            <button onClick={rebuildMarkers} disabled={markersLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[9px] font-bold uppercase tracking-wide border border-border-default text-rmpg-400 hover:text-brand-400 hover:border-brand-600 transition-colors disabled:opacity-40">
              <RotateCcw className={`w-3 h-3 ${markersLoading ? 'animate-spin' : ''}`} />
              {markersLoading ? 'SCANNING…' : 'RE-SCAN FOR EVENTS'}
            </button>
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
                    style={{ borderColor: withAlpha(pinColor(m), '44'), color: pinColor(m), background: withAlpha(pinColor(m), '11') }}>
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

      {/* ── ConfirmDialog — lock as evidence (irreversible) ── */}
      <ConfirmDialog
        isOpen={lockConfirmOpen}
        onClose={() => setLockConfirmOpen(false)}
        onConfirm={() => { setLockConfirmOpen(false); void lockEvidence(); }}
        title="Lock as Evidence"
        message="Locking footage as evidence is irreversible. The recording will be preserved under evidence custody and cannot be modified or deleted without a supervisor override."
        details={
          <span>{data?.request.title ?? `Request #${data?.request.id}`}</span>
        }
        confirmLabel="Lock Evidence"
        confirmVariant="warning"
        isLoading={lockBusy}
      />
    </div>
  );
}
