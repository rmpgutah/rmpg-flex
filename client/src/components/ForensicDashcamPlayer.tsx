// ============================================================
// RMPG Flex — Forensic Dashcam Player
// ============================================================
// On-demand dashcam playback for a driving event. The clip is NEVER pre-
// downloaded: <video preload="none"> streams from /api/driving-events/:id/stream
// (the Worker proxies a fresh pre-signed S3 url on play). A 1Hz GPS+speed track
// drives a time-synced forensic overlay: speed/heading/coords HUD, a speed-
// colored GPS road-track with a moving vehicle marker, a speed profile, and a
// driving-analysis readout (distance, peak g-forces, event verdict).
// ============================================================
import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Gauge, Navigation, AlertTriangle, Activity, Car, MapPin, Loader2, ScanSearch, Route } from 'lucide-react';
import { apiFetch, authedImageUrl } from '../hooks/useApi';
import {
  trackStats, normalizeTrack, positionAtTime, speedColor, compass, forensicVerdict,
  type GpsPoint, type TrackPoint,
} from '../utils/dashcamForensics';
import {
  turnRateDegPerSec, bearingAt, videoPredictivePath, pickPrimary, plateRegion, clampBox, vehicleTag,
  type Detection,
} from '../utils/drivingPrediction';
import { loadVehicleDetector, detectVehicles, type DetectorStatus } from '../utils/aiVehicleTracking';

interface VehicleAttrs { state?: string | null; make?: string | null; model?: string | null; color?: string | null; year?: number | null }
interface MediaResp {
  id: number; has_video: boolean; stream_url: string | null; duration_sec: number | null;
  gps: GpsPoint[]; address: string | null; event_type: string | null; event_timestamp: string | null;
  still_url: string | null; plate: string | null; plate_confidence: number | null;
  vehicle: VehicleAttrs | null; detections?: unknown[];
}

const GOLD = '#d4a017';

/** Interpolate the playhead's (x,y) in SVG space from the normalized track. */
function dotAt(pts: TrackPoint[], tSec: number): { x: number; y: number } | null {
  if (pts.length === 0) return null;
  if (pts.length === 1 || tSec <= pts[0].tSec) return { x: pts[0].x, y: pts[0].y };
  const last = pts[pts.length - 1];
  if (tSec >= last.tSec) return { x: last.x, y: last.y };
  let i = 0; while (i < pts.length - 1 && pts[i + 1].tSec <= tSec) i++;
  const a = pts[i], b = pts[i + 1];
  const f = (tSec - a.tSec) / Math.max(0.001, b.tSec - a.tSec);
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
}

export default function ForensicDashcamPlayer({ eventId, eventType, address, onClose }: {
  eventId: number; eventType?: string | null; address?: string | null; onClose: () => void;
}) {
  const [media, setMedia] = useState<MediaResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [t, setT] = useState(0);             // current playback time (s)
  const [aiOn, setAiOn] = useState(true);    // live CV vehicle tracking
  const [detStatus, setDetStatus] = useState<DetectorStatus>('idle');
  const [dets, setDets] = useState<Detection[]>([]);
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const detLoopRef = useRef<number | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true); setErr(null);
    apiFetch<MediaResp>(`/api/driving-events/${eventId}/media`)
      .then((m) => { if (alive) setMedia(m); })
      .catch((e) => { if (alive) setErr(e?.message || 'Failed to load media'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [eventId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Live CV vehicle detection loop — boxes that follow the vehicle in frame.
  // Lazy-loads the model from a CDN on first enable; degrades to telemetry-only.
  useEffect(() => {
    if (!aiOn || !media?.has_video) { setDets([]); return; }
    let cancelled = false;
    let model: unknown = null;
    let busy = false;
    setDetStatus('loading');
    loadVehicleDetector().then((m) => {
      if (cancelled) return;
      model = m;
      setDetStatus(m ? 'ready' : 'unavailable');
      if (!m) return;
      const tick = async () => {
        const v = videoRef.current;
        if (!cancelled && v && !v.paused && !v.ended && !busy) {
          busy = true;
          const found = await detectVehicles(model, v);
          if (!cancelled) setDets(found);
          busy = false;
        }
        if (!cancelled) detLoopRef.current = window.setTimeout(tick, 130);
      };
      tick();
    });
    return () => {
      cancelled = true;
      if (detLoopRef.current) { clearTimeout(detLoopRef.current); detLoopRef.current = null; }
      setDets([]);
    };
  }, [aiOn, media?.has_video, media?.id]);

  const gps = media?.gps || [];
  const stats = useMemo(() => trackStats(gps), [gps]);
  const trackPts = useMemo(() => normalizeTrack(gps, 100, 100, 8), [gps]);
  const pos = useMemo(() => positionAtTime(gps, t), [gps, t]);
  const dot = useMemo(() => dotAt(trackPts, t), [trackPts, t]);
  const speedNow = pos?.speed ?? stats.startSpeed;
  const maxSpeed = stats.maxSpeed || 1;
  const evType = media?.event_type || eventType || null;
  const verdict = useMemo(() => forensicVerdict(evType, stats), [evType, stats]);

  // Prediction + tracking geometry (natural video px space).
  const natW = nat?.w || 1280, natH = nat?.h || 720;
  const turnRate = useMemo(() => turnRateDegPerSec(gps, t), [gps, t]);
  const heading = useMemo(() => bearingAt(gps, t), [gps, t]);
  const vTag = useMemo(() => vehicleTag(media?.vehicle ?? null), [media]);
  const roadPath = useMemo(() => videoPredictivePath(turnRate, speedNow, natW, natH), [turnRate, speedNow, natW, natH]);
  const roadFill = useMemo(() => {
    if (roadPath.length < 2) return '';
    const left = roadPath.map((p, i) => `${i === 0 ? 'M' : 'L'}${(p.x - p.halfWidth).toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const right = [...roadPath].reverse().map((p) => `L${(p.x + p.halfWidth).toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    return `${left} ${right} Z`;
  }, [roadPath]);
  const primary = useMemo(() => pickPrimary(dets, natW, natH), [dets, natW, natH]);
  // Predicted continuation ray on the (north-up) GPS mini-map, in SVG units.
  const predRay = useMemo(() => {
    if (!dot) return '';
    let hx = dot.x, hy = dot.y, hdg = heading;
    const segs = [`M${hx.toFixed(1)},${hy.toFixed(1)}`];
    for (let i = 0; i < 6; i++) {
      hdg += turnRate * 0.5;
      hx += Math.sin(hdg * Math.PI / 180) * 4;
      hy += -Math.cos(hdg * Math.PI / 180) * 4;
      segs.push(`L${hx.toFixed(1)},${hy.toFixed(1)}`);
    }
    return segs.join(' ');
  }, [dot, heading, turnRate]);

  // Speed-profile sparkline points (over track time).
  const speedPath = useMemo(() => {
    if (trackPts.length < 2) return '';
    const dur = trackPts[trackPts.length - 1].tSec || 1;
    return trackPts.map((p, i) => {
      const x = (p.tSec / dur) * 100;
      const y = 30 - (p.speed / maxSpeed) * 26;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(' ');
  }, [trackPts, maxSpeed]);
  const playheadX = useMemo(() => {
    const dur = trackPts.length ? (trackPts[trackPts.length - 1].tSec || 1) : (media?.duration_sec || 1);
    return Math.max(0, Math.min(100, (t / dur) * 100));
  }, [t, trackPts, media]);

  return (
    <div className="fixed inset-0 z-[60] bg-black/95 flex flex-col" role="dialog" aria-label="Forensic dashcam player">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#222] bg-surface-raised shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Car className="w-4 h-4 text-[#d4a017] shrink-0" />
          <span className="text-[11px] font-semibold tracking-wider text-[#d4a017]">FORENSIC PLAYBACK</span>
          {evType && <span className="text-[10px] uppercase px-1.5 py-0.5 border border-amber-700/50 bg-amber-900/30 text-amber-300">{evType.replace(/_/g, ' ')}</span>}
          <span className="text-[11px] text-rmpg-400 truncate">{media?.address || address || ''}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setAiOn((v) => !v)}
            className={`text-[10px] font-semibold tracking-wider px-2 py-1 border flex items-center gap-1 ${
              aiOn ? 'border-[#d4a017] text-[#d4a017] bg-[#1a1400]' : 'border-[#2a2a2a] text-[#777]'}`}
            aria-label="Toggle AI vehicle tracking">
            <ScanSearch className="w-3 h-3" />
            AI TRACK
            {aiOn && detStatus === 'loading' && <Loader2 className="w-3 h-3 animate-spin" />}
            {aiOn && detStatus === 'unavailable' && <span className="text-[8px] text-rmpg-500">(telemetry)</span>}
          </button>
          <button onClick={onClose} className="text-rmpg-400 hover:text-white p-1" aria-label="Close player"><X className="w-5 h-5" /></button>
        </div>
      </div>

      {loading && (
        <div className="flex-1 flex items-center justify-center text-rmpg-400 text-sm gap-2">
          <Loader2 className="w-5 h-5 animate-spin" /> Resolving clip…
        </div>
      )}
      {!loading && err && (
        <div className="flex-1 flex items-center justify-center text-red-300 text-sm">{err}</div>
      )}

      {!loading && media && (
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_360px] overflow-hidden">
          {/* ── Video + HUD overlay ── */}
          <div className="relative bg-black flex items-center justify-center overflow-hidden">
            {media.has_video && media.stream_url ? (
              <div className="relative inline-flex max-h-full max-w-full">
                <video
                  ref={videoRef}
                  src={authedImageUrl(media.stream_url)}
                  poster={media.still_url ? authedImageUrl(media.still_url) : undefined}
                  controls preload="none" playsInline
                  onLoadedMetadata={(e) => setNat({ w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight })}
                  onTimeUpdate={(e) => setT(e.currentTarget.currentTime)}
                  className="block max-h-full max-w-full" />

                {/* Detection + predictive-path overlay (drawn in natural px). */}
                {nat && gps.length > 1 && (
                  <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox={`0 0 ${natW} ${natH}`} preserveAspectRatio="none">
                    {/* Predicted road path ahead */}
                    {roadFill && (
                      <>
                        <path d={roadFill} fill="rgba(212,160,23,0.10)" />
                        <polyline points={roadPath.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}
                          fill="none" stroke="#d4a017" strokeWidth={3} strokeDasharray="12 9" opacity={0.85} vectorEffect="non-scaling-stroke" />
                      </>
                    )}
                    {/* Live vehicle detections */}
                    {aiOn && dets.map((d, i) => {
                      const isP = !!primary && d.bbox === primary.bbox;
                      const [x, y, w, h] = d.bbox;
                      return (
                        <rect key={i} x={x} y={y} width={w} height={h} fill="none"
                          stroke={isP ? '#d4a017' : '#7dd3fc'} strokeWidth={isP ? 4 : 2}
                          opacity={isP ? 1 : 0.7} vectorEffect="non-scaling-stroke" />
                      );
                    })}
                    {/* Primary vehicle: LP box + plate + Make/Model/Year/Color tag */}
                    {aiOn && primary && (() => {
                      const [x, y] = primary.bbox;
                      const [px, py, pw, ph] = clampBox(plateRegion(primary.bbox), natW, natH);
                      const tagW = Math.max(150, vTag.length * 11);
                      const tagY = Math.max(26, y - 8);
                      return (
                        <g>
                          {/* licence-plate sub-box */}
                          <rect x={px} y={py} width={pw} height={ph} fill="none" stroke="#22d3ee" strokeWidth={3} vectorEffect="non-scaling-stroke" />
                          {media.plate && (
                            <>
                              <rect x={px} y={py - 26} width={Math.max(80, media.plate.length * 15)} height={24} fill="rgba(0,0,0,0.78)" stroke="#22d3ee" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
                              <text x={px + 5} y={py - 8} fontSize={19} fill="#22d3ee" fontFamily="monospace" letterSpacing="2">{media.plate}</text>
                            </>
                          )}
                          {vTag && (
                            <>
                              <rect x={x} y={tagY - 22} width={tagW} height={22} fill="rgba(0,0,0,0.8)" stroke="#d4a017" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
                              <text x={x + 6} y={tagY - 6} fontSize={16} fill="#d4a017" fontFamily="sans-serif">{vTag}</text>
                            </>
                          )}
                        </g>
                      );
                    })()}
                  </svg>
                )}
              </div>
            ) : media.still_url ? (
              <img src={authedImageUrl(media.still_url)} alt="Dashcam still" className="max-h-full max-w-full object-contain" />
            ) : (
              <div className="text-rmpg-500 text-sm">No video or still available for this event.</div>
            )}

            {/* HUD overlay (pointer-events-none so video controls still work) */}
            {gps.length > 0 && (
              <div className="absolute inset-0 pointer-events-none">
                {/* Speed — big, color-coded */}
                <div className="absolute top-3 left-3 flex flex-col">
                  <div className="flex items-baseline gap-1">
                    <span className="text-5xl font-bold tabular-nums leading-none" style={{ color: speedColor(speedNow, maxSpeed), textShadow: '0 1px 4px #000' }}>
                      {Math.round(speedNow)}
                    </span>
                    <span className="text-[11px] text-white/80 font-semibold">MPH</span>
                  </div>
                  <div className="mt-1 flex items-center gap-1 text-[10px] text-white/80" style={{ textShadow: '0 1px 3px #000' }}>
                    <Navigation className="w-3 h-3" style={{ transform: `rotate(${pos?.bearing ?? 0}deg)` }} />
                    {pos ? compass(pos.bearing) : '—'}
                  </div>
                </div>
                {/* Coords + plate */}
                <div className="absolute top-3 right-3 text-right text-[10px] font-mono text-white/85" style={{ textShadow: '0 1px 3px #000' }}>
                  {pos && <div>{pos.latitude.toFixed(5)}, {pos.longitude.toFixed(5)}</div>}
                  <div className="text-white/60">{media.event_timestamp || ''}</div>
                  {media.plate && (
                    <div className="mt-1 inline-block px-1.5 py-0.5 bg-black/70 border border-[#d4a017] text-[#d4a017] tracking-[0.15em] text-sm">
                      {media.plate}{media.plate_confidence != null && <span className="text-[8px] ml-1">{Math.round(media.plate_confidence * 100)}%</span>}
                    </div>
                  )}
                </div>
                {/* Speed profile strip */}
                <div className="absolute bottom-12 left-0 right-0 px-3">
                  <svg viewBox="0 0 100 32" preserveAspectRatio="none" className="w-full h-10 opacity-90">
                    <path d={speedPath} fill="none" stroke={GOLD} strokeWidth={0.8} vectorEffect="non-scaling-stroke" />
                    <line x1={playheadX} y1={0} x2={playheadX} y2={32} stroke="#fff" strokeWidth={0.6} vectorEffect="non-scaling-stroke" />
                  </svg>
                </div>
              </div>
            )}
          </div>

          {/* ── Forensic side panel ── */}
          <div className="border-l border-[#222] bg-surface-raised overflow-auto">
            {/* Road track */}
            <div className="p-3 border-b border-[#222]">
              <div className="text-[10px] uppercase tracking-wider text-rmpg-400 font-semibold mb-2 flex items-center gap-1">
                <MapPin className="w-3 h-3" /> GPS road track
              </div>
              {trackPts.length > 1 ? (
                <svg viewBox="0 0 100 100" className="w-full aspect-square bg-[#050505] border border-[#1a1a1a]">
                  {/* speed-colored segments */}
                  {trackPts.slice(1).map((p, i) => (
                    <line key={i} x1={trackPts[i].x} y1={trackPts[i].y} x2={p.x} y2={p.y}
                      stroke={speedColor((trackPts[i].speed + p.speed) / 2, maxSpeed)} strokeWidth={1.6} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                  ))}
                  <circle cx={trackPts[0].x} cy={trackPts[0].y} r={1.6} fill="#22c55e" />
                  <circle cx={trackPts[trackPts.length - 1].x} cy={trackPts[trackPts.length - 1].y} r={1.6} fill="#ef4444" />
                  {/* predicted continuation (dashed) */}
                  {predRay && <path d={predRay} fill="none" stroke={GOLD} strokeWidth={1} strokeDasharray="2.5 2" opacity={0.85} vectorEffect="non-scaling-stroke" />}
                  {dot && <circle cx={dot.x} cy={dot.y} r={2.4} fill="#fff" stroke={GOLD} strokeWidth={1} vectorEffect="non-scaling-stroke" />}
                </svg>
              ) : (
                <div className="text-[11px] text-rmpg-500 italic py-4 text-center">No GPS track for this clip.</div>
              )}
              <div className="flex items-center justify-between mt-1.5 text-[8px] text-rmpg-500">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" />Start</span>
                <span>slow→fast</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" />End</span>
              </div>
              {trackPts.length > 1 && (
                <div className="mt-2 flex items-center justify-between text-[9px] text-[#d4a017] border-t border-[#1a1a1a] pt-1.5">
                  <span className="flex items-center gap-1"><Route className="w-3 h-3" /> Predicted</span>
                  <span className="font-mono text-rmpg-300">
                    {Math.abs(turnRate) < 4 ? 'STRAIGHT' : turnRate > 0 ? `BEARING RIGHT ${Math.abs(turnRate).toFixed(0)}°/s` : `BEARING LEFT ${Math.abs(turnRate).toFixed(0)}°/s`} · hdg {compass(heading)}
                  </span>
                </div>
              )}
            </div>

            {/* Driving analysis */}
            <div className="p-3">
              <div className="text-[10px] uppercase tracking-wider text-rmpg-400 font-semibold mb-2 flex items-center gap-1">
                <Activity className="w-3 h-3" /> Driving analysis
              </div>
              <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                <Stat icon={Gauge} label="Peak speed" value={`${Math.round(stats.maxSpeed)} mph`} tone={stats.maxSpeed > 70 ? 'warn' : 'normal'} />
                <Stat icon={Gauge} label="Avg speed" value={`${Math.round(stats.avgSpeed)} mph`} />
                <Stat icon={MapPin} label="Distance" value={`${stats.distanceMiles.toFixed(2)} mi`} />
                <Stat icon={Activity} label="Duration" value={`${stats.durationSec.toFixed(0)} s`} />
                <Stat icon={AlertTriangle} label="Hard brake" value={`${stats.maxBrakeG.toFixed(2)} g`} tone={stats.maxBrakeG > 0.35 ? 'warn' : 'normal'} />
                <Stat icon={AlertTriangle} label="Hard accel" value={`${stats.maxAccelG.toFixed(2)} g`} tone={stats.maxAccelG > 0.35 ? 'warn' : 'normal'} />
              </div>
              <div className="mt-3 p-2 border border-[#2a2300] bg-[#161200] text-[11px] text-amber-200/90 leading-snug">
                <span className="text-[9px] uppercase tracking-wider text-[#d4a017] font-semibold block mb-1">Forensic verdict</span>
                {verdict}
              </div>
              <div className="mt-2 text-[9px] text-rmpg-600">
                On-demand stream — clip is fetched only on play, never archived. Telemetry: ClearPath 1&nbsp;Hz GPS.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ icon: Icon, label, value, tone = 'normal' }: { icon: any; label: string; value: string; tone?: 'normal' | 'warn' }) {
  return (
    <div className={`border px-2 py-1.5 ${tone === 'warn' ? 'border-amber-800/50 bg-amber-950/20' : 'border-[#222] bg-surface-sunken'}`}>
      <div className="flex items-center gap-1 text-[8px] uppercase tracking-wider text-rmpg-500"><Icon className="w-2.5 h-2.5" />{label}</div>
      <div className={`font-mono mt-0.5 ${tone === 'warn' ? 'text-amber-300' : 'text-rmpg-100'}`}>{value}</div>
    </div>
  );
}
