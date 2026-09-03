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
import { X, Gauge, Navigation, AlertTriangle, Activity, Car, MapPin, Loader2, ScanSearch, Route, Camera, ZoomIn, ShieldAlert, Layers, FileText, RefreshCw, Siren, Radio, CheckCircle2, Sparkles, Maximize2, ShieldOff } from 'lucide-react';
import { apiFetch, apiPostForm, authedImageUrl } from '../hooks/useApi';
import PlateMagnifier from './PlateMagnifier';
import { ENHANCE_PRESETS, presetByKey, nextPresetKey, cssFilterFor } from '../utils/imageEnhance';
import {
  instAccelG, activeThreats, severityColor, zoomTransform, evidenceStampLines, evidenceFilename,
  type Threat,
} from '../utils/tacticalForensics';
import { enhancePlateImage } from '../utils/alprImagePrep';
import { exportForensicReport } from '../utils/forensicReportPdf';
import {
  trackStats, normalizeTrack, positionAtTime, speedColor, compass, forensicVerdict,
  type GpsPoint, type TrackPoint,
} from '../utils/dashcamForensics';
import {
  turnRateDegPerSec, bearingAt, videoPredictivePath, plateRegion, clampBox, vehicleTag, predictPath,
} from '../utils/drivingPrediction';
import ForensicTrackMap from './ForensicTrackMap';
import PlateDossier from './PlateDossier';
import RedactionStudio from './RedactionStudio';
import { loadVehicleDetector, detectVehicles, type DetectorStatus } from '../utils/aiVehicleTracking';
import {
  emptyTrackerState, stepTracker, visibleTracks, primaryTrack, type TrackerState, type Track,
} from '../utils/vehicleTracker';
import {
  loadPlateDetector, detectPlateBboxes, plateBoxToFrame, bestPlate, type PlateDetectorStatus,
} from '../utils/fastAlpr';
import { aggressionScore, detectAnomalies, proximity, type RiskScore, type Anomaly } from '../utils/tacticalIntel';
import { toDisplayLabel } from '../utils/formatters';

interface VehicleAttrs { state?: string | null; make?: string | null; model?: string | null; color?: string | null; year?: number | null }
interface MediaResp {
  id: number; has_video: boolean; stream_url: string | null; duration_sec: number | null;
  gps: GpsPoint[]; address: string | null; event_type: string | null; event_timestamp: string | null;
  still_url: string | null; plate: string | null; plate_confidence: number | null;
  plate_accepted?: boolean | null; plate_review_status?: string | null;
  vehicle: VehicleAttrs | null; detections?: unknown[];
  footage_request_id?: number | null;  // set when a full-drive trip covers this event
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
  const [tracks, setTracks] = useState<Track[]>([]);
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [enhanceKey, setEnhanceKey] = useState('none');      // live enhancement preset (whole-frame CSS filter)
  const [magnifierOn, setMagnifierOn] = useState(true);      // live Plate Magnifier inset
  const [zoomOn, setZoomOn] = useState(false);               // digital PTZ on primary
  const [rate, setRate] = useState(1);                       // playback speed
  const [hits, setHits] = useState<Array<{ kind?: string; severity: string; detail: string }>>([]);
  const [trackView, setTrackView] = useState<'svg' | 'map'>('svg');
  const [prior, setPrior] = useState<{ count: number; distinct_days?: number; sightings: Array<{ id: number; location: string | null; source: string; created_at: string | null }> } | null>(null);
  const [dossier, setDossier] = useState<string | null>(null);
  const [redactOpen, setRedactOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const detLoopRef = useRef<number | null>(null);
  const trackerRef = useRef<TrackerState>(emptyTrackerState());
  const screenedRef = useRef<string>('');                    // last plate screened (dedupe)
  const captureRef = useRef<() => void>(() => {});           // latest evidence-capture fn (avoids stale closure)
  const magCanvasRef = useRef<HTMLCanvasElement | null>(null); // latest enhanced plate crop (drives OCR re-scan)
  // W7: closest-vehicle lock — prefer the current primary across frames (hysteresis)
  const primaryLockIdRef = useRef<number | null>(null);
  // W8: fast-alpr ONNX plate detector
  const [plateDetStatus, setPlateDetStatus] = useState<PlateDetectorStatus>('idle');
  const [onnxPlateBox, setOnnxPlateBox] = useState<[number, number, number, number] | null>(null);
  const plateDetRef = useRef<unknown>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true); setErr(null);
    apiFetch<MediaResp>(`/api/driving-events/${eventId}/media`)
      .then((m) => { if (alive) setMedia(m); })
      .catch((e) => { if (alive) setErr(e?.message || 'Failed to load media'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [eventId]);

  // Tactical keyboard shortcuts + Esc-to-close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      const v = videoRef.current;
      switch (e.key) {
        case 'Escape': onClose(); break;
        case ' ': case 'k': if (v) { v.paused ? v.play().catch(() => {}) : v.pause(); e.preventDefault(); } break;
        case 'ArrowRight': case 'l': if (v) v.currentTime = Math.min(v.duration || 1e9, v.currentTime + (e.shiftKey ? 1 : 0.1)); break;
        case 'ArrowLeft': case 'j': if (v) v.currentTime = Math.max(0, v.currentTime - (e.shiftKey ? 1 : 0.1)); break;
        case '>': case '.': setRate((r) => Math.min(2, +(r + 0.25).toFixed(2))); break;
        case '<': case ',': setRate((r) => Math.max(0.25, +(r - 0.25).toFixed(2))); break;
        case 'n': setEnhanceKey((k) => nextPresetKey(k)); break;
        case 'm': setMagnifierOn((x) => !x); break;
        case 'z': setZoomOn((x) => !x); break;
        case 'a': setAiOn((x) => !x); break;
        case 'c': captureRef.current(); break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose]);

  // Apply playback speed.
  useEffect(() => { if (videoRef.current) videoRef.current.playbackRate = rate; }, [rate, media?.id]);

  // Live hotlist / BOLO screen of the read plate (read-only; no notification spam).
  useEffect(() => {
    const plate = media?.plate || '';
    if (!plate) { setHits([]); return; }
    if (screenedRef.current === plate) return;
    screenedRef.current = plate;
    apiFetch<{ hits: Array<{ kind?: string; severity: string; detail: string }> }>(`/api/intel/screen-plate?plate=${encodeURIComponent(plate)}`)
      .then((r) => setHits(Array.isArray(r.hits) ? r.hits : []))
      .catch(() => setHits([]));
  }, [media?.plate]);

  // Plate re-identification — prior sightings of this plate across all sources.
  useEffect(() => {
    const plate = media?.plate;
    if (!plate) { setPrior(null); return; }
    apiFetch<typeof prior>(`/api/driving-events/plate-history?plate=${encodeURIComponent(plate)}`)
      .then((r) => setPrior(r)).catch(() => setPrior(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [media?.plate]);

  // Live CV vehicle detection loop — boxes that follow the vehicle in frame.
  // Lazy-loads the model from a CDN on first enable; degrades to telemetry-only.
  useEffect(() => {
    if (!aiOn || !media?.has_video) { setTracks([]); trackerRef.current = emptyTrackerState(); return; }
    let cancelled = false;
    let model: unknown = null;
    let busy = false;
    let lastDetT = -1;                 // last video.currentTime we ran detection on
    trackerRef.current = emptyTrackerState();
    setDetStatus('loading');
    loadVehicleDetector().then((m) => {
      if (cancelled) return;
      model = m;
      setDetStatus(m ? 'ready' : 'unavailable');
      if (!m) return;
      const tick = async () => {
        const v = videoRef.current;
        // Detect while PLAYING (continuously) AND while PAUSED on a new frame
        // (seek/step) — forensic plate reading happens paused on the best frame, so
        // the boxes must lock onto the frozen image instead of disappearing. When
        // paused on an unchanged frame we skip (no re-detect, no coasting drift).
        if (!cancelled && v && !v.ended && !document.hidden && !busy && v.readyState >= 2) {
          const newFrame = v.currentTime !== lastDetT;
          if (!v.paused || newFrame) {
            busy = true;
            lastDetT = v.currentTime;
            const found = await detectVehicles(model, v, 12);
            if (!cancelled) {
              trackerRef.current = stepTracker(trackerRef.current, found, { iouThresh: 0.3, smooth: 0.5, maxMissed: 8, trailLen: 14 });
              setTracks(visibleTracks(trackerRef.current, 3));
            }
            busy = false;
          }
        }
        if (!cancelled) detLoopRef.current = window.setTimeout(tick, 110);
      };
      tick();
    });
    return () => {
      cancelled = true;
      if (detLoopRef.current) { clearTimeout(detLoopRef.current); detLoopRef.current = null; }
      setTracks([]);
      trackerRef.current = emptyTrackerState();
    };
  }, [aiOn, media?.has_video, media?.id]);

  // W8: Lazy-load the ONNX plate detector alongside COCO-SSD.
  // Resolves null when unavailable → caller falls back to heuristic plateRegion().
  useEffect(() => {
    if (!aiOn) { plateDetRef.current = null; setPlateDetStatus('idle'); setOnnxPlateBox(null); return; }
    let cancelled = false;
    setPlateDetStatus('loading');
    loadPlateDetector().then((m) => {
      if (cancelled) return;
      plateDetRef.current = m;
      setPlateDetStatus(m ? 'ready' : 'unavailable');
    });
    return () => { cancelled = true; };
  }, [aiOn]);

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
  const accelG = useMemo(() => instAccelG(gps, t), [gps, t]);
  const threats: Threat[] = useMemo(() => activeThreats({ speed: speedNow, turnRate, accelG, postedLimit: null }), [speedNow, turnRate, accelG]);
  const critical = useMemo(() => hits.filter((h) => h.severity === 'critical'), [hits]);
  // A plate read is only a positive ID once it clears the derived-trust accept gate
  // (or a human confirmed it). Until then it is an UNCONFIRMED observation — never
  // paint it on a tracked box or screen it as a fact without saying so. (Guards
  // against the old "fabricated 100%" overlay where any read read as certain.)
  const plateConfirmed = useMemo(
    () => media?.plate_accepted === true || media?.plate_review_status === 'accepted' || media?.plate_review_status === 'confirmed' || media?.plate_review_status === 'confirmed_unlinked',
    [media?.plate_accepted, media?.plate_review_status],
  );
  const vTag = useMemo(() => vehicleTag(media?.vehicle ?? null), [media]);
  const roadPath = useMemo(() => videoPredictivePath(turnRate, speedNow, natW, natH), [turnRate, speedNow, natW, natH]);
  const roadFill = useMemo(() => {
    if (roadPath.length < 2) return '';
    const left = roadPath.map((p, i) => `${i === 0 ? 'M' : 'L'}${(p.x - p.halfWidth).toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const right = [...roadPath].reverse().map((p) => `L${(p.x + p.halfWidth).toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    return `${left} ${right} Z`;
  }, [roadPath]);
  // W7: primary vehicle lock — once we commit to a track, prefer it across frames
  // (hysteresis). The lock releases if the track goes missing for > 3 ticks.
  const primary = useMemo(() => {
    const best = primaryTrack(tracks, natW, natH);
    const lockedId = primaryLockIdRef.current;
    if (lockedId !== null) {
      const locked = tracks.find((t) => t.id === lockedId);
      if (locked && locked.missed <= 3) return locked; // stay on the locked track
      primaryLockIdRef.current = null;                 // lock expired
    }
    if (best) primaryLockIdRef.current = best.id;
    return best;
  }, [tracks, natW, natH]);

  // W8: When the primary vehicle changes and the ONNX detector is ready, crop the
  // primary bbox from the current video frame, run plate detection, and map the
  // result back to full-frame coordinates. Lives here so `primary` is in scope.
  useEffect(() => {
    if (!primary || !nat || plateDetStatus !== 'ready' || !plateDetRef.current) {
      setOnnxPlateBox(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const v = videoRef.current;
      if (!v || v.readyState < 2) return;
      const [bx, by, bw, bh] = clampBox(
        [primary.bbox[0], primary.bbox[1], primary.bbox[2], primary.bbox[3]],
        nat.w, nat.h,
      );
      if (bw < 20 || bh < 20) return;
      const crop = document.createElement('canvas');
      crop.width = Math.round(bw); crop.height = Math.round(bh);
      try { crop.getContext('2d')!.drawImage(v, bx, by, bw, bh, 0, 0, bw, bh); } catch { return; }
      const plates = await detectPlateBboxes(plateDetRef.current, crop);
      if (cancelled) return;
      const top = bestPlate(plates);
      setOnnxPlateBox(top ? plateBoxToFrame(top, [bx, by, bw, bh], crop) : null);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [primary?.id, primary?.bbox[0], primary?.bbox[1], plateDetStatus, nat]);

  // Wave 4 — tactical intel/AI: pursuit-aggression score, driving anomalies,
  // and a closing-proximity alarm derived from the primary track's frame fill.
  const risk = useMemo<RiskScore>(() => aggressionScore(stats, evType, null), [stats, evType]);
  const anomalies = useMemo<Anomaly[]>(() => detectAnomalies(gps), [gps]);
  const prevAreaRef = useRef(0);
  const prox = useMemo(() => {
    if (!primary) { prevAreaRef.current = 0; return null; }
    const area = primary.bbox[2] * primary.bbox[3];
    const p = proximity(area, prevAreaRef.current, natW * natH);
    prevAreaRef.current = area;
    return p;
  }, [primary, natW, natH]);
  const predictedGeo = useMemo(() => predictPath(gps, t, 4, 0.5), [gps, t]);
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

  // Best-effort chain-of-custody audit write (never blocks the UI).
  const logAudit = (action: string, details: string) => {
    apiFetch('/api/driving-events/audit-log', { method: 'POST', body: JSON.stringify({ action, event_id: eventId, details }) }).catch(() => {});
  };
  const evidenceMeta = () => ({
    eventType: media?.event_type || evType, address: media?.address || address,
    timestamp: media?.event_timestamp, lat: pos?.latitude, lng: pos?.longitude,
    speed: speedNow, plate: media?.plate, playbackTime: t, device: media ? String(media.id) : null,
  });

  // Compose the annotated frame (video + tracked boxes + plate + stamp) onto a
  // canvas. Same-origin stream (Worker proxy) → untainted. Returns null on fail.
  const composeFrameCanvas = (withStamp = true): HTMLCanvasElement | null => {
    const v = videoRef.current;
    if (!v || !nat) return null;
    const W = nat.w, H = nat.h;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    try { ctx.drawImage(v, 0, 0, W, H); } catch { return null; }
    ctx.lineWidth = Math.max(2, W / 380);
    for (const tr of tracks) {
      ctx.strokeStyle = primary && tr.id === primary.id ? reticleColor : '#7dd3fc';
      ctx.strokeRect(tr.bbox[0], tr.bbox[1], tr.bbox[2], tr.bbox[3]);
    }
    if (primary && media?.plate) {
      const [px, py, pw, ph] = clampBox(plateRegion(primary.bbox), W, H);
      ctx.strokeStyle = '#22d3ee'; ctx.strokeRect(px, py, pw, ph);
      ctx.font = `bold ${Math.round(H * 0.03)}px monospace`; ctx.fillStyle = '#22d3ee';
      ctx.fillText(media.plate, px, Math.max(20, py - 8));
    }
    if (withStamp) {
      const lines = evidenceStampLines(evidenceMeta());
      const fs = Math.max(12, Math.round(H * 0.022));
      const stripH = fs * (lines.length + 0.6) + 12;
      ctx.fillStyle = 'rgba(0 0 0 / 0.68)'; ctx.fillRect(0, H - stripH, W, stripH);
      ctx.textBaseline = 'top';
      lines.forEach((l, i) => {
        ctx.font = `${i === 0 ? 'bold ' : ''}${fs}px sans-serif`;
        ctx.fillStyle = i === 0 ? '#d4a017' : '#e5e5e5';
        ctx.fillText(l, 12, H - stripH + 6 + i * fs * 1.18);
      });
    }
    return canvas;
  };

  // Evidence frame → JPG download + audit.
  const captureEvidence = () => {
    const canvas = composeFrameCanvas(true);
    if (!canvas) return;
    canvas.toBlob((b) => {
      if (!b) return;
      const url = URL.createObjectURL(b);
      const a = document.createElement('a'); a.href = url; a.download = evidenceFilename(evidenceMeta()); a.click();
      setTimeout(() => URL.revokeObjectURL(url), 3000);
    }, 'image/jpeg', 0.95);
    logAudit('forensic_frame_capture', `t+${t.toFixed(1)}s${media?.plate ? ` plate ${media.plate}` : ''}`);
  };
  captureRef.current = captureEvidence;

  // Forensic PDF report — annotated frame + telemetry + GPS plot + intel.
  const exportReport = () => {
    const canvas = composeFrameCanvas(false);
    const frameDataUrl = canvas ? canvas.toDataURL('image/jpeg', 0.9) : null;
    exportForensicReport({
      eventType: evType, rawEventType: media?.event_type, address: media?.address || address,
      timestamp: media?.event_timestamp, device: media ? String(media.id) : null,
      lat: pos?.latitude, lng: pos?.longitude,
      plate: media?.plate, plateConfidence: media?.plate_confidence, vehicleTag: vTag,
      priorCount: prior?.count ?? null, priorDays: prior?.distinct_days ?? null,
      hits, verdict, stats, trackPts, frameDataUrl,
    });
    logAudit('forensic_report_export', `${stats.maxSpeed.toFixed(0)}mph peak${media?.plate ? ` plate ${media.plate}` : ''}`);
  };

  // Best-frame plate re-scan — W7 multi-frame consensus: sample 3 nearby frames
  // (t−0.5s, t, t+0.5s), OCR each, pick the majority-vote winner. Falls back to
  // the magnifier crop when it's live (single enhanced frame = "what you see").
  const [rescan, setRescan] = useState<{ busy: boolean; result: string | null }>({ busy: false, result: null });
  const rescanPlate = async () => {
    if (!primary || !nat) { setRescan({ busy: false, result: 'No target vehicle in frame' }); return; }
    setRescan({ busy: true, result: null });
    const v = videoRef.current;
    try {
      // "What you see is what gets OCR'd": when the Plate Magnifier is live, send the
      // exact ENHANCED plate crop (preset filter baked in) — single frame, no consensus.
      const mag = magCanvasRef.current;
      if (magnifierOn && enhanceKey !== 'none' && mag && mag.width > 1) {
        const ocrImage = await new Promise<Blob | null>((res) => mag.toBlob((b) => res(b), 'image/jpeg', 0.95));
        if (ocrImage) {
          const fd = new FormData();
          fd.append('image', ocrImage, 'rescan.jpg');
          fd.append('capture_reason', 'forensic_rescan');
          const r = await apiPostForm<{ capture?: { plate?: string | null; confidence?: number | null } }>('/alpr/capture', fd);
          const got = r?.capture?.plate || null;
          if (got) {
            setMedia((m) => (m ? { ...m, plate: got, plate_confidence: r.capture?.confidence ?? m.plate_confidence, plate_accepted: false, plate_review_status: 'needs_review' } : m));
            screenedRef.current = '';
          }
          setRescan({ busy: false, result: got ? `Read: ${got} (verify)` : 'No plate resolved' });
          logAudit('forensic_plate_rescan', got ? `read ${got}` : 'no read');
          return;
        }
      }

      // Multi-frame consensus: scrub to t-0.5, t, t+0.5 — capture each frame crop,
      // POST to /alpr/capture, collect plate readings, pick the majority winner.
      if (!v) { setRescan({ busy: false, result: 'Frame not ready' }); return; }
      const baseT = v.currentTime;
      const offsets = [-0.5, 0, 0.5];
      const readings: string[] = [];
      let lastConf: number | null = null;
      for (const offset of offsets) {
        await new Promise<void>((res) => {
          const target = Math.max(0, Math.min(v.duration || 1e9, baseT + offset));
          if (Math.abs(v.currentTime - target) < 0.05) { res(); return; }
          const onSeeked = () => { v.removeEventListener('seeked', onSeeked); res(); };
          v.addEventListener('seeked', onSeeked);
          v.currentTime = target;
        });
        // Small settle delay so the video element paints the new frame.
        await new Promise((res) => setTimeout(res, 60));
        const canvas = composeFrameCanvas(false);
        if (!canvas) continue;
        const [bx, by, bw, bh] = clampBox(
          [primary.bbox[0] - primary.bbox[2] * 0.1, primary.bbox[1] - primary.bbox[3] * 0.1, primary.bbox[2] * 1.2, primary.bbox[3] * 1.2],
          nat.w, nat.h,
        );
        const crop = document.createElement('canvas'); crop.width = bw; crop.height = bh;
        crop.getContext('2d')!.drawImage(canvas, bx, by, bw, bh, 0, 0, bw, bh);
        const raw: Blob = await new Promise((res) => crop.toBlob((b) => res(b as Blob), 'image/jpeg', 0.95));
        const ocrImage = await enhancePlateImage(raw, { targetWidth: 1280, maxWidth: 1600, contrast: true, sharpen: 1.0 });
        try {
          const fd = new FormData();
          fd.append('image', ocrImage, `rescan_${offset}.jpg`);
          fd.append('capture_reason', 'forensic_rescan');
          const r = await apiPostForm<{ capture?: { plate?: string | null; confidence?: number | null } }>('/alpr/capture', fd);
          if (r?.capture?.plate) { readings.push(r.capture.plate); lastConf = r.capture.confidence ?? null; }
        } catch { /* one frame failing doesn't abort the consensus */ }
      }
      // Restore playhead to where the user was.
      v.currentTime = baseT;

      // Majority vote: count occurrences of each plate string, pick the most common.
      const votes = readings.reduce<Record<string, number>>((acc, p) => ({ ...acc, [p]: (acc[p] || 0) + 1 }), {});
      const got = Object.keys(votes).sort((a, b) => votes[b] - votes[a])[0] || null;
      if (got) {
        setMedia((m) => (m ? { ...m, plate: got, plate_confidence: lastConf ?? m.plate_confidence, plate_accepted: false, plate_review_status: 'needs_review' } : m));
        screenedRef.current = '';
      }
      const frameCount = readings.length;
      setRescan({ busy: false, result: got ? `Read: ${got} (${frameCount}/3 frames, verify)` : 'No plate resolved' });
      logAudit('forensic_plate_rescan', got ? `consensus ${got} ${frameCount}/3` : 'no read');
    } catch (e) {
      setRescan({ busy: false, result: 'Re-scan failed' });
    }
  };

  // Auto-BOLO — push the target vehicle to the live BOLO board with the AI's
  // attributes + risk assessment pre-filled. One click from forensic review.
  const [bolo, setBolo] = useState<{ busy: boolean; done: boolean; err: string | null }>({ busy: false, done: false, err: null });
  const createBolo = async () => {
    setBolo({ busy: true, done: false, err: null });
    const plate = media?.plate || null;
    const vehDesc = [vTag, plate ? `plate ${plate}` : null].filter(Boolean).join(' · ') || 'Unknown vehicle';
    const where = media?.address || address || null;
    const descParts = [
      `Flagged from dashcam forensic review (event #${eventId}${evType ? `, ${toDisplayLabel(evType)}` : ''}).`,
      `Driving-risk ${risk.score}/100 (${risk.level})${risk.factors.length ? `: ${risk.factors.join(', ')}` : ''}.`,
      `Peak ${Math.round(stats.maxSpeed)} mph.`,
      anomalies.length ? `Anomalies: ${anomalies.map((a) => a.label).join(', ')}.` : '',
      where ? `Last seen near ${where}.` : '',
      pos ? `GPS ${pos.latitude.toFixed(5)}, ${pos.longitude.toFixed(5)}.` : '',
    ].filter(Boolean).join(' ');
    try {
      await apiFetch('/api/comms/bolos', {
        method: 'POST',
        body: JSON.stringify({
          type: 'vehicle',
          title: `BOLO — ${plate || vTag || 'vehicle'}`,
          vehicle_description: vehDesc,
          description: descParts,
          priority: risk.level === 'severe' || critical.length ? 'high' : risk.level === 'high' ? 'medium' : 'low',
          photo_url: media?.still_url || null,
        }),
      });
      setBolo({ busy: false, done: true, err: null });
      logAudit('forensic_bolo_created', `${plate || vTag || 'vehicle'} risk ${risk.score}`);
    } catch (e: any) {
      setBolo({ busy: false, done: false, err: e?.message || 'BOLO failed' });
    }
  };

  // Digital-zoom transform on the primary track.
  const zoom = useMemo(() => (zoomOn && primary ? zoomTransform(primary.bbox, natW, natH) : null), [zoomOn, primary, natW, natH]);
  // Live enhancement: the selected preset's CSS filter on the whole <video>, plus
  // the pixel pipeline the Plate Magnifier runs on the cropped plate region.
  const preset = useMemo(() => presetByKey(enhanceKey) ?? ENHANCE_PRESETS[0], [enhanceKey]);
  const videoFilter = useMemo(() => cssFilterFor(preset) || undefined, [preset]);
  // Plate region (natural px) of the primary vehicle — fed to the magnifier + OCR.
  // W8: prefer the ONNX detector's precise box; fall back to the heuristic lower-centre guess.
  const plateBox = useMemo(
    () => onnxPlateBox ?? (primary ? clampBox(plateRegion(primary.bbox), natW, natH) : null),
    [onnxPlateBox, primary, natW, natH],
  );

  // W7: dynamic reticle color derived from live threat/hit signals.
  // red  = confirmed hotlist hit OR alert-level proximity
  // yellow = any watchlist hit OR warn-proximity OR active driving threat
  // green = clear
  const reticleColor = useMemo((): string => {
    if (critical.length > 0 || (prox && prox.level === 'alert')) return '#ef4444';
    if (hits.length > 0 || (prox && prox.level === 'caution') || threats.length > 0) return '#f59e0b';
    return '#22c55e';
  }, [critical, hits, prox, threats]);

  return (
    <div className="fixed inset-0 z-[60] bg-black/95 flex flex-col" role="dialog" aria-label="Forensic dashcam player">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#222] bg-surface-raised shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Car className="w-4 h-4 [color:var(--panel-header-color)] shrink-0" />
          <span className="text-[11px] font-semibold tracking-wider [color:var(--panel-header-color)]">FORENSIC PLAYBACK</span>
          {evType && <span className="text-[10px] uppercase px-1.5 py-0.5 border border-amber-700/50 bg-amber-900/30 text-amber-300">{toDisplayLabel(evType)}</span>}
          {media?.footage_request_id && (
            <a href={`/flexcam/${media.footage_request_id}`} target="_blank" rel="noreferrer"
              className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-blue-700/50 bg-blue-900/30 text-blue-300 hover:border-blue-400 transition-colors whitespace-nowrap">
              ▶ Full Trip
            </a>
          )}
          <span className="text-[11px] text-fg-muted truncate">{media?.address || address || ''}</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Tactical toolbar */}
          {media?.has_video && (
            <>
              <button onClick={() => setRate((r) => (r >= 2 ? 0.25 : +(r + 0.25).toFixed(2)))}
                className="text-[10px] font-mono px-1.5 py-1 border border-[#2a2a2a] text-fg-muted hover:[border-color:var(--field-label-color)] tabular-nums" title="Playback speed ( < / > )">
                {rate.toFixed(2)}×
              </button>
              <button onClick={() => setEnhanceKey((k) => nextPresetKey(k))} title="Cycle image enhancement (n)"
                className={`flex items-center gap-1 text-[10px] font-semibold px-1.5 py-1 border ${enhanceKey !== 'none' ? '[border-color:var(--field-label-color)] [color:var(--panel-header-color)] bg-[#1a1400]' : 'border-[#2a2a2a] text-[#777]'}`}
                aria-label="Cycle image enhancement preset">
                <Sparkles className="w-3.5 h-3.5" />
                <span className="tracking-wider uppercase">{preset.label}</span>
              </button>
              <button onClick={() => setMagnifierOn((x) => !x)} title="Plate magnifier (m)"
                className={`p-1 border ${magnifierOn ? '[border-color:var(--field-label-color)] [color:var(--panel-header-color)] bg-[#1a1400]' : 'border-[#2a2a2a] text-[#777]'}`} aria-label="Toggle plate magnifier">
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => setZoomOn((x) => !x)} title="Digital zoom on target (z)"
                className={`p-1 border ${zoomOn ? '[border-color:var(--field-label-color)] [color:var(--panel-header-color)] bg-[#1a1400]' : 'border-[#2a2a2a] text-[#777]'}`} aria-label="Toggle digital zoom">
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => captureRef.current()} title="Capture evidence frame (c)"
                className="p-1 border border-[#2a2a2a] text-fg-muted hover:[border-color:var(--field-label-color)]" aria-label="Capture evidence frame">
                <Camera className="w-3.5 h-3.5" />
              </button>
              <button onClick={rescanPlate} disabled={rescan.busy} title="Re-scan plate from the target vehicle (best-frame OCR)"
                className="p-1 border border-[#2a2a2a] text-fg-muted hover:[border-color:var(--field-label-color)] disabled:opacity-50" aria-label="Re-scan plate">
                {rescan.busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              </button>
              <button onClick={exportReport} title="Export forensic PDF report"
                className="text-[10px] font-semibold px-1.5 py-1 border border-[#2a2a2a] text-fg-muted hover:[border-color:var(--field-label-color)] flex items-center gap-1" aria-label="Export forensic report">
                <FileText className="w-3.5 h-3.5" /> REPORT
              </button>
              <button onClick={() => setRedactOpen(true)} title="Redact & export for disclosure"
                className="text-[10px] font-semibold px-1.5 py-1 border border-[#232323] text-fg-muted hover:[border-color:var(--field-label-color)] flex items-center gap-1" aria-label="Open redaction studio">
                <ShieldOff className="w-3.5 h-3.5" /> REDACT
              </button>
              <span className="w-px h-4 bg-surface-raised" />
            </>
          )}
          <button
            onClick={() => setAiOn((v) => !v)}
            className={`text-[10px] font-semibold tracking-wider px-2 py-1 border flex items-center gap-1 ${
              aiOn ? '[border-color:var(--field-label-color)] [color:var(--panel-header-color)] bg-[#1a1400]' : 'border-[#2a2a2a] text-[#777]'}`}
            aria-label="Toggle AI vehicle tracking">
            <ScanSearch className="w-3 h-3" />
            AI TRACK
            {aiOn && detStatus === 'loading' && <Loader2 className="w-3 h-3 animate-spin" />}
            {aiOn && detStatus === 'ready' && <span className="text-[8px] tabular-nums">· {tracks.length} tracked</span>}
            {aiOn && detStatus === 'unavailable' && <span className="text-[8px] text-fg-muted">(telemetry)</span>}
          </button>
          <button onClick={onClose} className="text-fg-muted hover:text-rmpg-100 p-1" aria-label="Close player"><X className="w-5 h-5" /></button>
        </div>
      </div>

      {loading && (
        <div className="flex-1 flex items-center justify-center text-fg-muted text-sm gap-2">
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
              <div className="relative inline-flex max-h-full max-w-full"
                style={zoom ? { transform: `scale(${zoom.scale})`, transformOrigin: `${zoom.originXPct}% ${zoom.originYPct}%`, transition: 'transform 0.25s ease' } : { transition: 'transform 0.25s ease' }}>
                <video
                  ref={videoRef}
                  src={authedImageUrl(media.stream_url)}
                  poster={media.still_url ? authedImageUrl(media.still_url) : undefined}
                  controls preload="none" playsInline
                  style={videoFilter ? { filter: videoFilter } : undefined}
                  onLoadedMetadata={(e) => setNat({ w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight })}
                  onTimeUpdate={(e) => setT(e.currentTarget.currentTime)}
                  className="block max-h-full max-w-full" />

                {/* Detection + predictive-path overlay (drawn in natural px). */}
                {nat && (
                  <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox={`0 0 ${natW} ${natH}`} preserveAspectRatio="none">
                    {/* Predicted road path ahead — GPS-derived, so only when a track exists. */}
                    {gps.length > 1 && roadFill && (
                      <>
                        <path d={roadFill} fill="rgba(212,160,23,0.10)" />
                        <polyline points={roadPath.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}
                          fill="none" stroke="#d4a017" strokeWidth={3} strokeDasharray="12 9" opacity={0.85} vectorEffect="non-scaling-stroke" />
                      </>
                    )}
                    {/* Tracked vehicles — smoothed boxes + motion trail + id */}
                    {aiOn && tracks.map((tr) => {
                      const isP = !!primary && tr.id === primary.id;
                      const [x, y, w, h] = tr.bbox;
                      const col = isP ? reticleColor : '#7dd3fc';
                      const isVeh = tr.cls !== 'person';
                      // per-vehicle LP region (non-primary get a faint scan box)
                      const plr = isVeh && !isP ? clampBox(plateRegion(tr.bbox), natW, natH) : null;
                      return (
                        <g key={tr.id} opacity={isP ? 1 : 0.72}>
                          {tr.trail.length > 1 && (
                            <polyline points={tr.trail.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')}
                              fill="none" stroke={col} strokeWidth={2} opacity={0.35} vectorEffect="non-scaling-stroke" />
                          )}
                          <rect x={x} y={y} width={w} height={h} fill="none" stroke={col} strokeWidth={isP ? 4 : 2} vectorEffect="non-scaling-stroke" />
                          {plr && <rect x={plr[0]} y={plr[1]} width={plr[2]} height={plr[3]} fill="none" stroke="#22d3ee" strokeWidth={1.5} opacity={0.6} vectorEffect="non-scaling-stroke" />}
                          <text x={x + 3} y={y - 4} fontSize={13} fill={col} fontFamily="Arial, sans-serif">{tr.cls === 'person' ? 'PED' : 'VEH'}·{tr.id}</text>
                        </g>
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
                          {/* licence-plate sub-box — cyan when the read is a confirmed ID,
                              amber + dashed when it is an UNCONFIRMED observation so the
                              overlay never asserts an unverified plate as fact. */}
                          {(() => {
                            const lpCol = plateConfirmed ? '#22d3ee' : '#f59e0b';
                            const label = plateConfirmed ? (media.plate ?? '') : (media.plate ? `? ${media.plate}` : '');
                            return (
                              <>
                                <rect x={px} y={py} width={pw} height={ph} fill="none" stroke={lpCol} strokeWidth={3}
                                  strokeDasharray={plateConfirmed ? undefined : '8 5'} vectorEffect="non-scaling-stroke" />
                                {media.plate && (
                                  <>
                                    <rect x={px} y={py - 26} width={Math.max(80, label.length * 15)} height={24} fill="rgba(0 0 0 / 0.78)" stroke={lpCol} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
                                    <text x={px + 5} y={py - 8} fontSize={19} fill={lpCol} fontFamily="Arial, sans-serif" letterSpacing="2">{label}</text>
                                    {!plateConfirmed && (
                                      <text x={px + 5} y={py + ph + 16} fontSize={11} fill="#f59e0b" fontFamily="Arial, sans-serif" letterSpacing="1">UNCONFIRMED</text>
                                    )}
                                  </>
                                )}
                              </>
                            );
                          })()}
                          {vTag && (
                            <>
                              <rect x={x} y={tagY - 22} width={tagW} height={22} fill="rgba(0 0 0 / 0.8)" stroke="#d4a017" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
                              <text x={x + 6} y={tagY - 6} fontSize={16} fill="#d4a017" fontFamily="Arial, sans-serif">{vTag}</text>
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
              <div className="text-fg-muted text-sm">No video or still available for this event.</div>
            )}

            {/* Live Plate Magnifier — crops the target's plate region and runs the
                enhancement pipeline on it in real time (works paused; independent of
                GPS). Mounted in the OUTER container so the digital-zoom transform on
                the inner video doesn't also scale the inset. */}
            {media.has_video && magnifierOn && aiOn && plateBox && (
              <PlateMagnifier
                videoRef={videoRef}
                region={plateBox}
                pipeline={preset.pipeline}
                plate={media.plate}
                confidence={media.plate_confidence}
                confirmed={plateConfirmed}
                onCanvas={(cv) => { magCanvasRef.current = cv; }}
              />
            )}

            {/* HUD overlay (pointer-events-none so video controls still work) */}
            {gps.length > 0 && (
              <div className="absolute inset-0 pointer-events-none">
                {/* BOLO / hotlist tactical alert */}
                {hits.length > 0 && (
                  <div className={`absolute top-2 left-1/2 -translate-x-1/2 px-3 py-1.5 border-2 text-center max-w-[80%] ${
                    critical.length ? 'bg-red-950/90 border-red-500 animate-pulse' : 'bg-amber-950/90 [border-color:var(--field-label-color)]'}`}>
                    <div className={`flex items-center gap-1.5 justify-center text-[11px] font-bold tracking-wider ${critical.length ? 'text-red-300' : '[color:var(--panel-header-color)]'}`}>
                      <ShieldAlert className="w-4 h-4" />
                      {critical.length ? 'HOTLIST HIT' : 'WATCHLIST'} — {media.plate}
                      {!plateConfirmed && <span className="text-[9px] font-bold text-amber-300 ml-1">· VERIFY PLATE (unconfirmed read)</span>}
                    </div>
                    <div className="text-[10px] text-white/90 mt-0.5">{hits.map((h) => h.detail).join(' · ')}</div>
                  </div>
                )}
                {/* Closing-proximity alarm (officer safety) */}
                {prox && prox.level !== 'none' && (
                  <div className={`absolute ${hits.length ? 'top-12' : 'top-2'} left-1/2 -translate-x-1/2 px-3 py-1 border-2 text-center ${
                    prox.level === 'alert' ? 'bg-red-950/90 border-red-500 animate-pulse' : 'bg-amber-950/85 border-amber-500'}`}>
                    <div className={`flex items-center gap-1.5 justify-center text-[11px] font-bold tracking-wider ${prox.level === 'alert' ? 'text-red-300' : 'text-amber-300'}`}>
                      <Siren className="w-4 h-4" />
                      {prox.level === 'alert' ? 'COLLISION RISK — VEHICLE CLOSING' : 'CLOSING DISTANCE'}
                      <span className="font-mono text-[10px] opacity-80">{Math.round(prox.fillPct * 100)}% frame</span>
                    </div>
                  </div>
                )}
                {/* Speed — big, color-coded */}
                <div className="absolute top-3 left-3 flex flex-col">
                  <div className="flex items-baseline gap-1">
                    <span className="text-5xl font-bold tabular-nums leading-none" style={{ color: speedColor(speedNow, maxSpeed), textShadow: '0 1px 4px #000' }}>
                      {Math.round(speedNow)}
                    </span>
                    <span className="text-[11px] text-white/80 font-semibold">MPH</span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-[10px] text-white/80" style={{ textShadow: '0 1px 3px #000' }}>
                    <span className="flex items-center gap-1"><Navigation className="w-3 h-3" style={{ transform: `rotate(${pos?.bearing ?? 0}deg)` }} />{pos ? compass(pos.bearing) : '—'}</span>
                    <span className="tabular-nums" style={{ color: Math.abs(accelG) > 0.38 ? '#ef4444' : '#fff' }}>
                      {accelG >= 0 ? '+' : ''}{accelG.toFixed(2)}g
                    </span>
                  </div>
                  {/* Live threat chips */}
                  {threats.length > 0 && (
                    <div className="mt-1.5 flex flex-col gap-1 items-start">
                      {threats.map((th) => (
                        <span key={th.key} className="text-[10px] font-bold tracking-wider px-1.5 py-0.5 border bg-black/70"
                          style={{ color: severityColor(th.severity), borderColor: severityColor(th.severity) }}>
                          ⚠ {th.label}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                {/* Coords + plate */}
                <div className="absolute top-3 right-3 text-right text-[10px] font-mono text-white/85" style={{ textShadow: '0 1px 3px #000' }}>
                  {pos && <div>{pos.latitude.toFixed(5)}, {pos.longitude.toFixed(5)}</div>}
                  <div className="text-white/60">{media.event_timestamp || ''}</div>
                  {media.plate && (
                    <div className="mt-1 flex flex-col items-end gap-0.5">
                      <div className={`inline-block px-1.5 py-0.5 bg-black/70 border tracking-[0.15em] text-sm ${plateConfirmed ? '[border-color:var(--field-label-color)] [color:var(--panel-header-color)]' : 'border-amber-600 text-amber-400'}`}>
                        {media.plate}{media.plate_confidence != null && <span className="text-[8px] ml-1">{Math.round(media.plate_confidence * 100)}% trust</span>}
                      </div>
                      {!plateConfirmed && (
                        <span className="text-[8px] font-bold tracking-wider px-1 py-0.5 bg-amber-950/80 border border-amber-600 text-amber-300">
                          UNCONFIRMED · NEEDS REVIEW
                        </span>
                      )}
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
              <div className="text-[10px] uppercase tracking-wider text-fg-muted font-semibold mb-2 flex items-center justify-between">
                <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> GPS road track</span>
                <span className="flex items-center gap-0.5">
                  {(['svg', 'map'] as const).map((v) => (
                    <button key={v} onClick={() => setTrackView(v)}
                      className={`text-[8px] px-1.5 py-0.5 border ${trackView === v ? '[border-color:var(--field-label-color)] [color:var(--panel-header-color)] bg-[#1a1400]' : 'border-[#2a2a2a] text-fg-muted'}`}>
                      {v === 'svg' ? 'SCHEMATIC' : 'MAP'}
                    </button>
                  ))}
                </span>
              </div>
              {trackView === 'map' && gps.length > 1 ? (
                <ForensicTrackMap gps={gps} tSec={t} predicted={predictedGeo} height={210} />
              ) : trackPts.length > 1 ? (
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
                <div className="text-[11px] text-fg-muted italic py-4 text-center">No GPS track for this clip.</div>
              )}
              <div className="flex items-center justify-between mt-1.5 text-[8px] text-fg-muted">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" />Start</span>
                <span>slow→fast</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" />End</span>
              </div>
              {trackPts.length > 1 && (
                <div className="mt-2 flex items-center justify-between text-[9px] [color:var(--panel-header-color)] border-t border-[#1a1a1a] pt-1.5">
                  <span className="flex items-center gap-1"><Route className="w-3 h-3" /> Predicted</span>
                  <span className="font-mono text-fg-muted">
                    {Math.abs(turnRate) < 4 ? 'STRAIGHT' : turnRate > 0 ? `BEARING RIGHT ${Math.abs(turnRate).toFixed(0)}°/s` : `BEARING LEFT ${Math.abs(turnRate).toFixed(0)}°/s`} · hdg {compass(heading)}
                  </span>
                </div>
              )}
            </div>

            {/* Driving analysis */}
            <div className="p-3">
              <div className="text-[10px] uppercase tracking-wider text-fg-muted font-semibold mb-2 flex items-center gap-1">
                <Activity className="w-3 h-3" /> Driving analysis
              </div>

              {/* AI pursuit / aggression risk gauge */}
              {(() => {
                const col = risk.level === 'severe' ? '#ef4444' : risk.level === 'high' ? '#f97316' : risk.level === 'elevated' ? '#d4a017' : '#22c55e';
                return (
                  <div className="mb-2.5 border border-[#222] bg-surface-sunken p-2">
                    <div className="flex items-center justify-between text-[9px] uppercase tracking-wider mb-1">
                      <span className="flex items-center gap-1 text-fg-muted font-semibold"><Gauge className="w-3 h-3" /> AI risk score</span>
                      <span className="font-mono font-bold tabular-nums" style={{ color: col }}>{risk.score}/100 · {risk.level}</span>
                    </div>
                    <div className="h-1.5 bg-surface-deep border border-[#1a1a1a] overflow-hidden">
                      <div className="h-full transition-all" style={{ width: `${risk.score}%`, background: col }} />
                    </div>
                    {risk.factors.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {risk.factors.map((f, i) => (
                          <span key={i} className="text-[9px] px-1 py-0.5 border border-[#2a2a2a] text-fg-muted bg-black/40">{f}</span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Driving anomalies */}
              {anomalies.length > 0 && (
                <div className="mb-2.5 flex flex-wrap gap-1">
                  {anomalies.map((a) => (
                    <span key={a.key} className="text-[9px] font-bold tracking-wider px-1.5 py-0.5 border border-orange-700/60 bg-orange-950/30 text-orange-300 flex items-center gap-1">
                      <AlertTriangle className="w-2.5 h-2.5" /> {a.label}{a.tSec > 0 ? ` @${a.tSec.toFixed(0)}s` : ''}
                    </span>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                <Stat icon={Gauge} label="Peak speed" value={`${Math.round(stats.maxSpeed)} mph`} tone={stats.maxSpeed > 70 ? 'warn' : 'normal'} />
                <Stat icon={Gauge} label="Avg speed" value={`${Math.round(stats.avgSpeed)} mph`} />
                <Stat icon={MapPin} label="Distance" value={`${stats.distanceMiles.toFixed(2)} mi`} />
                <Stat icon={Activity} label="Duration" value={`${stats.durationSec.toFixed(0)} s`} />
                <Stat icon={AlertTriangle} label="Hard brake" value={`${stats.maxBrakeG.toFixed(2)} g`} tone={stats.maxBrakeG > 0.35 ? 'warn' : 'normal'} />
                <Stat icon={AlertTriangle} label="Hard accel" value={`${stats.maxAccelG.toFixed(2)} g`} tone={stats.maxAccelG > 0.35 ? 'warn' : 'normal'} />
              </div>
              <div className="mt-3 p-2 border border-[#2a2300] bg-[#161200] text-[11px] text-amber-200/90 leading-snug">
                <span className="text-[9px] uppercase tracking-wider [color:var(--panel-header-color)] font-semibold block mb-1">Forensic verdict</span>
                {verdict}
              </div>

              {/* Auto-BOLO — push target vehicle to the live BOLO board */}
              <button
                onClick={createBolo}
                disabled={bolo.busy || bolo.done}
                className={`mt-2.5 w-full flex items-center justify-center gap-1.5 text-[11px] font-bold tracking-wider px-2 py-2 border transition-colors ${
                  bolo.done ? 'border-green-700 text-green-400 bg-green-950/30'
                  : 'border-red-700/70 text-red-300 bg-red-950/30 hover:bg-red-900/40'} disabled:opacity-70`}
                aria-label="Create BOLO for this vehicle">
                {bolo.busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : bolo.done ? <CheckCircle2 className="w-3.5 h-3.5" />
                  : <Radio className="w-3.5 h-3.5" />}
                {bolo.done ? 'BOLO ISSUED' : bolo.busy ? 'ISSUING…' : `CREATE BOLO${media?.plate ? ` — ${media.plate}` : ''}`}
              </button>
              {bolo.err && <div className="mt-1 text-[10px] text-red-400">{bolo.err}</div>}

              {/* Plate re-identification — cross-source prior sightings */}
              {media?.plate && prior && (
                <div className="mt-3 border-t border-[#222] pt-2">
                  <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-fg-muted font-semibold mb-1.5">
                    <span className="flex items-center gap-1"><Layers className="w-3 h-3" /> Plate re-ID</span>
                    <button onClick={() => setDossier(media.plate)} className="text-[8px] px-1.5 py-0.5 border [border-color:var(--field-label-color)] [color:var(--panel-header-color)] hover:bg-[#1a1400]">DOSSIER</button>
                  </div>
                  <div className="text-[11px] text-rmpg-200">
                    <span className="[color:var(--panel-header-color)] tracking-[0.15em] font-semibold">{media.plate}</span>
                    <span className="text-fg-muted"> — {prior.count} prior sighting{prior.count === 1 ? '' : 's'}{prior.distinct_days ? ` over ${prior.distinct_days} day${prior.distinct_days === 1 ? '' : 's'}` : ''}</span>
                  </div>
                  {prior.sightings.slice(0, 4).map((s) => (
                    <button key={s.id} onClick={() => setDossier(media.plate)} className="w-full text-left text-[10px] text-fg-muted flex justify-between gap-2 mt-0.5 hover:text-fg-muted">
                      <span className="truncate">{s.location || s.source}</span>
                      <span className="shrink-0 font-mono">{String(s.created_at || '').slice(5, 16)}</span>
                    </button>
                  ))}
                </div>
              )}

              <div className="mt-3 text-[9px] text-fg-muted">
                On-demand stream — clip is fetched only on play, never archived. Telemetry: ClearPath 1&nbsp;Hz GPS.
              </div>
            </div>
          </div>
        </div>
      )}

      {rescan.result && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-3 py-1.5 bg-black/90 border [border-color:var(--field-label-color)] [color:var(--panel-header-color)] text-[11px] font-mono tracking-wider flex items-center gap-2">
          <ScanSearch className="w-3.5 h-3.5" /> PLATE RE-SCAN — {rescan.result}
          <button onClick={() => setRescan({ busy: false, result: null })} className="text-fg-muted hover:text-rmpg-100 ml-1" aria-label="Dismiss">×</button>
        </div>
      )}
      {dossier && <PlateDossier plate={dossier} onClose={() => setDossier(null)} />}
      {redactOpen && media?.stream_url && (
        <RedactionStudio
          eventId={eventId}
          streamUrl={media.stream_url}
          stampLines={evidenceStampLines(evidenceMeta())}
          onClose={() => setRedactOpen(false)}
        />
      )}
    </div>
  );
}

function Stat({ icon: Icon, label, value, tone = 'normal' }: { icon: any; label: string; value: string; tone?: 'normal' | 'warn' }) {
  return (
    <div className={`border px-2 py-1.5 ${tone === 'warn' ? 'border-amber-800/50 bg-amber-950/20' : 'border-[#222] bg-surface-sunken'}`}>
      <div className="flex items-center gap-1 text-[8px] uppercase tracking-wider text-fg-muted"><Icon className="w-2.5 h-2.5" />{label}</div>
      <div className={`font-mono mt-0.5 ${tone === 'warn' ? 'text-amber-300' : 'text-rmpg-100'}`}>{value}</div>
    </div>
  );
}
