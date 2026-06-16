// client/src/pages/FlexCamFootagePage.tsx
// Seamless full-drive footage player: plays a request's downloaded 40s chunks
// back-to-back as one continuous video (no length limit) and pins the timeline
// markers (camera-triggered violation tags + GPS turn pins) on the scrubber.
// Chunks stream as authed blobs (the stream endpoint needs the JWT a <video src>
// can't send), so each segment is fetched via apiFetchBlob → object URL.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { apiFetch, apiFetchBlob } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import { buildTimeline, offsetToSeek, type PlayChunk } from '../utils/flexcamTimeline';

interface ChunkRow { seq: number; from_ts: number; to_ts: number; status: string; r2_key: string | null; bytes: number; }
interface Marker {
  ts_ms: number; offset_ms: number | null; kind: string; type: string | null;
  severity: string | null; label: string | null; heading_deg: number | null; turn_dir: string | null;
}
interface Detail {
  request: { id: number; title: string | null; status: string; from_ts: number; to_ts: number };
  manifest: { chunks: Array<{ seq: number; r2_key: string }>; gaps: number[]; spanMs: number; playableMs: number };
  markers: Marker[];
  chunks: ChunkRow[];
}

const fmt = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
};

// Pin tone by marker kind/severity (semantic status colors — not theme surfaces).
function pinClass(m: Marker): string {
  if (m.type === 'turn') return m.kind === 'camera_hard_turn' ? 'bg-amber-400' : 'bg-sky-400';
  if (m.severity === 'critical' || m.severity === 'alert') return 'bg-red-500';
  if (m.severity === 'warning') return 'bg-amber-400';
  return 'bg-emerald-400';
}

export default function FlexCamFootagePage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<Detail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [posMs, setPosMs] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const urlCache = useRef<Map<number, string>>(new Map());

  useEffect(() => {
    apiFetch<Detail>(`/flexcam/footage/${id}`).then(setData).catch((e: Error) => setErr(e.message));
  }, [id]);

  // Revoke all blob URLs on unmount.
  useEffect(() => () => { for (const u of urlCache.current.values()) URL.revokeObjectURL(u); urlCache.current.clear(); }, []);

  // Playable timeline (downloaded chunks only, in seq order) — drives offsets + seeking.
  const timeline = useMemo(() => {
    const downloaded = (data?.chunks ?? []).filter((c) => c.status === 'downloaded')
      .map<PlayChunk>((c) => ({ seq: c.seq, durationMs: c.to_ts - c.from_ts }));
    return buildTimeline(downloaded);
  }, [data]);

  async function loadSeq(seq: number): Promise<string | null> {
    const cached = urlCache.current.get(seq);
    if (cached) return cached;
    try {
      const blob = await apiFetchBlob(`/flexcam/footage/${id}/chunk/${seq}/stream`);
      const url = URL.createObjectURL(blob);
      urlCache.current.set(seq, url);
      return url;
    } catch (e) { setErr((e as Error).message); return null; }
  }

  // Play segment `segIndex` (index into timeline.segments), optionally seeking within it.
  async function playSegment(segIndex: number, withinMs = 0) {
    const seg = timeline.segments[segIndex];
    const video = videoRef.current;
    if (!seg || !video) return;
    setIdx(segIndex);
    const url = await loadSeq(seg.seq);
    if (!url) return;
    video.src = url;
    const onReady = () => { try { video.currentTime = withinMs / 1000; } catch { /* */ } video.play().catch(() => setPlaying(false)); video.removeEventListener('loadeddata', onReady); };
    video.addEventListener('loadeddata', onReady);
    video.load();
    // Warm the next segment so the hand-off has no fetch gap.
    if (timeline.segments[segIndex + 1]) void loadSeq(timeline.segments[segIndex + 1].seq);
  }

  function onEnded() {
    if (idx < timeline.segments.length - 1) void playSegment(idx + 1);
    else setPlaying(false);
  }
  function onTimeUpdate() {
    const seg = timeline.segments[idx];
    const video = videoRef.current;
    if (seg && video) setPosMs(seg.startMs + video.currentTime * 1000);
  }
  function togglePlay() {
    const video = videoRef.current;
    if (!video) return;
    if (!video.src && timeline.segments.length) { void playSegment(0); setPlaying(true); return; }
    if (video.paused) { video.play().then(() => setPlaying(true)).catch(() => {}); }
    else { video.pause(); setPlaying(false); }
  }
  function seekToOffset(offsetMs: number) {
    const target = offsetToSeek(offsetMs, timeline);
    if (!target) return;
    const segIndex = timeline.segments.findIndex((s) => s.seq === target.seq);
    if (segIndex >= 0) { void playSegment(segIndex, target.withinMs); setPlaying(true); }
  }

  if (err) return <div className="p-4 text-red-400 text-sm">FlexCam footage error: {err}</div>;
  if (!data) return <div className="p-4 text-rmpg-400 text-sm">Loading footage…</div>;

  const total = timeline.totalMs;
  const pct = total ? Math.min(100, (posMs / total) * 100) : 0;
  const markers = data.markers.filter((m) => m.offset_ms != null);

  return (
    <div className="p-4 space-y-3">
      <PanelTitleBar title={`FLEXCAM — ${data.request.title || `REQUEST ${data.request.id}`}`} />
      <div className="text-[11px] text-rmpg-400">
        {data.request.status} · {timeline.segments.length} segment(s) · {fmt(total)} playable
        {data.manifest.gaps.length ? ` · ${data.manifest.gaps.length} gap(s)` : ''}
        {' · '}<a className="text-brand-400 underline" href="/flexcam">← all footage</a>
      </div>

      {/* Player */}
      <div className="bg-black rounded-[2px] tactical-dark">
        <video ref={videoRef} className="w-full max-h-[60vh] bg-black" onEnded={onEnded} onTimeUpdate={onTimeUpdate}
          onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} controls={false} playsInline />
      </div>

      {/* Transport + scrubber with marker pins */}
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-[11px]">
          <button className="px-2 py-[2px] rounded-[2px] bg-surface-raised text-brand-400" onClick={togglePlay}
            disabled={!timeline.segments.length}>{playing ? '❚❚ Pause' : '▶ Play'}</button>
          <span className="text-rmpg-400 tabular-nums">{fmt(posMs)} / {fmt(total)}</span>
        </div>
        <div className="relative h-6 bg-surface-raised rounded-[2px] cursor-pointer"
          onClick={(e) => { const r = (e.currentTarget as HTMLDivElement).getBoundingClientRect(); seekToOffset(((e.clientX - r.left) / r.width) * total); }}>
          {/* playhead */}
          <div className="absolute top-0 bottom-0 w-[2px] bg-brand-400" style={{ left: `${pct}%` }} />
          {/* marker pins */}
          {markers.map((m, i) => (
            <div key={i} title={`${m.label ?? m.type ?? m.kind}${m.turn_dir ? ` (${m.turn_dir})` : ''} @ ${fmt(m.offset_ms!)}`}
              onClick={(e) => { e.stopPropagation(); seekToOffset(m.offset_ms!); }}
              className={`absolute top-1 bottom-1 w-[3px] ${pinClass(m)} hover:w-[5px]`}
              style={{ left: `${total ? (m.offset_ms! / total) * 100 : 0}%` }} />
          ))}
        </div>
      </div>

      {/* Marker legend / list */}
      <div className="text-[10px] text-rmpg-400">
        <span className="mr-3"><span className="inline-block w-2 h-2 bg-red-500 align-middle mr-1" />violation</span>
        <span className="mr-3"><span className="inline-block w-2 h-2 bg-amber-400 align-middle mr-1" />warning / hard-turn</span>
        <span className="mr-3"><span className="inline-block w-2 h-2 bg-sky-400 align-middle mr-1" />turn</span>
      </div>
      {markers.length === 0 && <div className="text-[10px] text-rmpg-400">No markers (run derivation: GET /flexcam/footage/{data.request.id}/markers?rebuild=1).</div>}
      <ul className="text-[11px] divide-y divide-surface-raised">
        {markers.map((m, i) => (
          <li key={i} className="py-[2px] flex items-center gap-2 cursor-pointer hover:text-brand-400" onClick={() => seekToOffset(m.offset_ms!)}>
            <span className={`inline-block w-2 h-2 ${pinClass(m)}`} />
            <span className="tabular-nums text-rmpg-400 w-12">{fmt(m.offset_ms!)}</span>
            <span>{m.label ?? m.type ?? m.kind}{m.turn_dir ? ` · ${m.turn_dir}` : ''}{m.heading_deg != null ? ` · ${Math.round(m.heading_deg)}°` : ''}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
