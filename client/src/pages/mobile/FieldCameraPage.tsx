// ============================================================
// FieldCameraPage — /field-camera
//
// Full-screen mobile camera portal. Live rear-camera preview
// (getUserMedia) with a HUD showing what will be burned into
// the photo: clock, officer, unit, GPS. The shutter composites
// the video frame onto a canvas with:
//   • bottom data band — timestamp · officer · unit · lat/lng
//   • translucent RMPG logo watermark, bottom-right corner
// then uploads the stamped JPEG to /api/field-photos along with
// the metadata in queryable form. The stored object IS the
// stamped image — no clean original exists to dispute.
//
// Fallback: if getUserMedia is unavailable (older WebViews,
// permission denied), a <input capture="environment"> file
// picker takes the photo through the native camera app and the
// same stamping pipeline runs on the picked file.
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Camera, Loader2, MapPin, RefreshCw, X, Check, ScanLine, Car, AlertTriangle } from 'lucide-react';
import { apiPostForm, apiFetch, authedImageUrl } from '../../hooks/useApi';
import { downscaleImage } from '../../utils/downscaleImage';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../components/ToastProvider';

type GpsFix = { lat: number; lng: number; accuracy: number } | null;

interface ScanHit { kind?: string; severity: string; detail: string }
interface DamageArea { panel: string | null; type: string | null; severity: string | null }
interface ScanVehicle {
  plate: string | null; make: string | null; model: string | null; color: string | null;
  year: number | null; vehicle_type: string | null; confidence: number | null;
  vehicle_record_id: number | null; vehicle_record_created: boolean; hits: ScanHit[];
  condition?: string | null; damage_observed?: boolean | null; damage_summary?: string | null;
  damage_areas?: DamageArea[];
}
interface AlprScanResult {
  success: boolean; id: number; call_id: number | null; field_photo_id: number | null;
  vehicle_count: number; vehicles: ScanVehicle[]; hits: ScanHit[];
  enrich_status?: 'pending' | 'done' | 'failed';
  accepted?: boolean | null; plate_confidence?: number | null;
  condition?: string | null; damage_observed?: boolean | null; damage_summary?: string | null;
  damage_areas?: DamageArea[];
  image_url: string | null; annotated_image_url: string | null;
}

/** Tailwind classes for a condition badge (clean→salvage). Pure for testing. */
export function conditionBadgeClass(condition?: string | null): string {
  switch ((condition || '').toLowerCase()) {
    case 'clean': return 'bg-green-900/40 text-green-300 border-green-700';
    case 'minor': return 'bg-yellow-900/30 text-yellow-300 border-yellow-700';
    case 'moderate': return 'bg-orange-900/30 text-orange-300 border-orange-700';
    case 'heavy': case 'salvage': return 'bg-red-900/40 text-red-300 border-red-700';
    default: return 'bg-neutral-800 text-neutral-300 border-neutral-600';
  }
}

// Draw the data overlay + watermark onto a canvas that already holds
// the photo. Exported for unit testing the band layout math.
export function stampOverlay(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  opts: {
    timestamp: string;
    officer: string;
    unit?: string | null;
    gps: GpsFix;
    logo: HTMLImageElement | null;
  },
) {
  // ── Bottom data band ──
  // Semi-opaque black band, height scales with image size so the text
  // is legible at any capture resolution.
  const bandH = Math.max(34, Math.round(h * 0.045));
  const fontPx = Math.max(13, Math.round(bandH * 0.42));
  ctx.fillStyle = 'rgba(0,0,0,0.62)';
  ctx.fillRect(0, h - bandH, w, bandH);

  ctx.fillStyle = '#ffffff';
  ctx.font = `${fontPx}px monospace`;
  ctx.textBaseline = 'middle';
  const pad = Math.round(bandH * 0.35);
  const midY = h - bandH / 2;

  const left = `${opts.timestamp}  ·  ${opts.officer}${opts.unit ? `  ·  ${opts.unit}` : ''}`;
  ctx.fillText(left, pad, midY);

  if (opts.gps) {
    const gpsText = `${opts.gps.lat.toFixed(6)}, ${opts.gps.lng.toFixed(6)} (±${Math.round(opts.gps.accuracy)}m)`;
    const tw = ctx.measureText(gpsText).width;
    ctx.fillStyle = '#d4a017';
    ctx.fillText(gpsText, w - tw - pad, midY);
  }

  // ── Watermark — translucent logo, bottom-right, above the band ──
  if (opts.logo && opts.logo.naturalWidth > 0) {
    const logoW = Math.max(64, Math.round(w * 0.13));
    const logoH = Math.round(logoW * (opts.logo.naturalHeight / opts.logo.naturalWidth));
    const margin = Math.round(w * 0.02);
    ctx.globalAlpha = 0.45;
    ctx.drawImage(opts.logo, w - logoW - margin, h - bandH - logoH - margin, logoW, logoH);
    ctx.globalAlpha = 1;
  }
}

function fmtStamp(d: Date): string {
  // America/Denver wall clock, court-readable: 2026-06-09 14:23:07 MT
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())} MT`;
}

export default function FieldCameraPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const { addToast } = useToast();

  // Call context — when launched from a call (?call_id=…), photos auto-attach
  // to that call and ALPR links/creates vehicle records against it.
  const callId = searchParams.get('call_id');
  const incidentId = searchParams.get('incident_id');
  // ALPR "scan vehicles" mode: default on when scoped to a call, or via ?alpr=1.
  const [alprMode, setAlprMode] = useState(!!callId || searchParams.get('alpr') === '1');
  const [scan, setScan] = useState<AlprScanResult | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const logoRef = useRef<HTMLImageElement | null>(null);

  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [gps, setGps] = useState<GpsFix>(null);
  const [clock, setClock] = useState(() => fmtStamp(new Date()));
  const [preview, setPreview] = useState<string | null>(null); // object URL of stamped capture
  const previewBlobRef = useRef<Blob | null>(null);
  const [uploading, setUploading] = useState(false);
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');

  useEffect(() => { document.title = 'Field Camera — RMPG Flex'; }, []);

  // Preload the watermark logo once. White-on-transparent version reads
  // best over photos; rmpg-logo.png is the official transparent asset.
  useEffect(() => {
    const img = new Image();
    img.src = '/rmpg-logo.png';
    img.onload = () => { logoRef.current = img; };
  }, []);

  // Live clock for the HUD (the actual stamp re-reads Date at shutter).
  useEffect(() => {
    const t = setInterval(() => setClock(fmtStamp(new Date())), 1000);
    return () => clearInterval(t);
  }, []);

  // GPS watch — continuous so the HUD shows fix quality before shooting.
  useEffect(() => {
    if (!navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(
      (pos) => setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      () => { /* no fix — stamp omits GPS rather than block the shot */ },
      { enableHighAccuracy: true, maximumAge: 5000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  // Camera lifecycle.
  const startCamera = useCallback(async (face: 'environment' | 'user') => {
    setCameraError(null);
    setCameraReady(false);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: face, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraReady(true);
    } catch (err: any) {
      setCameraError(err?.name === 'NotAllowedError'
        ? 'Camera permission denied. Use the file picker below or enable camera access in settings.'
        : `Camera unavailable (${err?.message || 'unknown'}). Use the file picker below.`);
    }
  }, []);

  useEffect(() => {
    startCamera(facing);
    return () => { streamRef.current?.getTracks().forEach((t) => t.stop()); };
  }, [facing, startCamera]);

  // Composite a source (video frame or picked image) into a stamped JPEG.
  const stampToBlob = useCallback(async (
    source: HTMLVideoElement | HTMLImageElement,
    sw: number,
    sh: number,
  ): Promise<Blob | null> => {
    // Cap the long edge at 2048 — plenty for evidence, keeps uploads small.
    const scale = Math.min(1, 2048 / Math.max(sw, sh));
    const w = Math.round(sw * scale);
    const h = Math.round(sh * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(source, 0, 0, w, h);
    stampOverlay(ctx, w, h, {
      timestamp: fmtStamp(new Date()),
      officer: user?.full_name || user?.username || `Officer #${user?.id ?? '—'}`,
      unit: (user as any)?.call_sign ?? null,
      gps,
      logo: logoRef.current,
    });
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  }, [user, gps]);

  // Shutter — capture the live frame.
  const capture = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !cameraReady) return;
    const blob = await stampToBlob(video, video.videoWidth, video.videoHeight);
    if (!blob) { addToast('Capture failed', 'error'); return; }
    previewBlobRef.current = blob;
    setPreview(URL.createObjectURL(blob));
  }, [cameraReady, stampToBlob, addToast]);

  // Fallback — native camera app via file input, same stamping pipeline.
  const onFilePicked = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const img = new Image();
    const url = URL.createObjectURL(file);
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('decode failed'));
      img.src = url;
    }).catch(() => { addToast('Could not read image', 'error'); });
    URL.revokeObjectURL(url);
    if (!img.naturalWidth) return;
    const blob = await stampToBlob(img, img.naturalWidth, img.naturalHeight);
    if (!blob) { addToast('Stamping failed', 'error'); return; }
    previewBlobRef.current = blob;
    setPreview(URL.createObjectURL(blob));
  }, [stampToBlob, addToast]);

  const discard = useCallback(() => {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    previewBlobRef.current = null;
  }, [preview]);

  // Background enrichment lands a moment after the fast plate read — re-fetch the
  // capture up to twice to fill make/model/color. Bounded; never loops forever.
  const pollEnrichment = useCallback(async (id: number) => {
    for (let i = 0; i < 2; i++) {
      await new Promise((res) => setTimeout(res, 2500));
      try {
        const cap = await apiFetch<{
          enrich_status?: string;
          accepted?: boolean | null; plate_confidence?: number | null;
          condition?: string | null; damage_observed?: boolean | null; damage_summary?: string | null;
          damage_areas?: DamageArea[];
          vehicles?: Array<ScanVehicle>;
        }>(`/alpr/capture/${id}`);
        if (cap.vehicles?.length || cap.enrich_status === 'done') {
          setScan((prev) => (prev && prev.id === id
            ? { ...prev, enrich_status: 'done',
                accepted: cap.accepted ?? prev.accepted, plate_confidence: cap.plate_confidence ?? prev.plate_confidence,
                condition: cap.condition ?? prev.condition, damage_observed: cap.damage_observed ?? prev.damage_observed,
                damage_summary: cap.damage_summary ?? prev.damage_summary, damage_areas: cap.damage_areas ?? prev.damage_areas,
                vehicles: cap.vehicles?.length ? cap.vehicles!.map((v) => {
                  // Merge enriched attributes onto the matching fast vehicle so
                  // the per-vehicle critical-hit display + record badge survive.
                  const prevV = prev.vehicles.find((p) => p.plate && p.plate === v.plate);
                  return {
                    plate: v.plate, make: v.make, model: v.model, color: v.color, year: v.year,
                    vehicle_type: v.vehicle_type, confidence: v.confidence,
                    condition: v.condition, damage_observed: v.damage_observed, damage_summary: v.damage_summary,
                    damage_areas: v.damage_areas,
                    vehicle_record_id: prevV?.vehicle_record_id ?? null,
                    vehicle_record_created: prevV?.vehicle_record_created ?? false,
                    hits: prevV?.hits ?? [],
                  };
                }) : prev.vehicles }
            : prev));
        }
        if (cap.enrich_status === 'done' || cap.enrich_status === 'failed') return;
      } catch { /* transient — try once more */ }
    }
  }, []);

  const upload = useCallback(async () => {
    const blob = previewBlobRef.current;
    if (!blob || uploading) return;
    setUploading(true);
    try {
      // 'photo' is the field name both /field-photos and /alpr/capture accept.
      const form = new FormData();
      form.append('photo', blob, 'field-photo.jpg');
      if (gps) { form.append('lat', String(gps.lat)); form.append('lng', String(gps.lng)); }
      if (callId) form.append('call_id', callId);
      if (incidentId) form.append('incident_id', incidentId);

      if (alprMode) {
        // Downscale for a fast plate read; the full-res stamped blob still goes
        // to the call's photo gallery via the field_photos row the server makes.
        const alprBlob = await downscaleImage(blob, 1280, 0.8);
        const alprForm = new FormData();
        alprForm.append('photo', alprBlob, 'field-photo.jpg');
        if (gps) { alprForm.append('lat', String(gps.lat)); alprForm.append('lng', String(gps.lng)); }
        if (callId) alprForm.append('call_id', callId);
        if (incidentId) alprForm.append('incident_id', incidentId);
        alprForm.append('capture_reason', 'on_scene_alpr');
        const r = await apiPostForm<AlprScanResult>('/alpr/capture', alprForm);
        setScan(r);
        addToast(
          r.vehicle_count
            ? 'ALPR: plate read — identifying vehicle…'
            : 'ALPR: no readable plate — photo saved to call',
          r.hits.some((h) => h.severity === 'critical') ? 'error' : 'success',
        );
        if (r.enrich_status === 'pending') void pollEnrichment(r.id);
        // keep the preview + result on screen so the officer can review hits
      } else {
        await apiPostForm('/field-photos', form);
        addToast(callId ? 'Photo saved to call' : 'Photo saved', 'success');
        discard();
      }
    } catch (err: any) {
      addToast(err?.message || 'Upload failed — photo kept on screen', 'error');
    } finally {
      setUploading(false);
    }
  }, [gps, uploading, discard, addToast, alprMode, callId, incidentId, pollEnrichment]);

  const clearScan = useCallback(() => { setScan(null); discard(); }, [discard]);

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      {/* ── Top bar ── */}
      <div className="flex items-center justify-between px-3 py-2 bg-[#080808] border-b border-[#1a1a1a]">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="flex items-center gap-1 text-[#888] text-xs font-bold uppercase tracking-wider p-2 -ml-2"
          aria-label="Back"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <span className="text-[10px] font-bold uppercase tracking-widest text-[#d4a017]">Field Camera</span>
        <button
          type="button"
          onClick={() => setFacing((f) => (f === 'environment' ? 'user' : 'environment'))}
          className="text-[#888] p-2 -mr-2"
          aria-label="Flip camera"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* ── Mode bar — ALPR toggle + call context ── */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#050505] border-b border-[#141414]">
        <button
          type="button"
          onClick={() => setAlprMode((m) => !m)}
          className={`flex items-center gap-1.5 px-2 py-1 text-[10px] font-bold uppercase tracking-wider border ${
            alprMode ? 'border-[#d4a017] text-[#d4a017] bg-[#1a1400]' : 'border-[#333] text-[#888]'
          }`}
          aria-pressed={alprMode}
        >
          <ScanLine className="w-3.5 h-3.5" /> Scan vehicles {alprMode ? 'ON' : 'OFF'}
        </button>
        {callId && (
          <span className="text-[10px] font-bold uppercase tracking-wider text-[#888]">
            Call #{callId}
          </span>
        )}
      </div>

      {/* ── Viewfinder / preview ── */}
      <div className="relative flex-1 overflow-hidden">
        {/* ALPR scan result overlay */}
        {scan && (
          <div className="absolute inset-0 z-10 bg-black/92 overflow-y-auto p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-[#d4a017] flex items-center gap-1">
                  <Car className="w-4 h-4" /> {scan.vehicle_count} vehicle(s)
                  {callId ? ` · linked to call #${callId}` : ''}
                </span>
                {scan.enrich_status === 'pending' && (
                  <span className="text-[10px] text-[#888] flex items-center gap-1">
                    <Loader2 className="w-3 h-3 animate-spin" /> Identifying…
                  </span>
                )}
              </div>
              <button type="button" onClick={clearScan} className="text-[#888] p-1" aria-label="Done">
                <X className="w-5 h-5" />
              </button>
            </div>
            {scan.hits.filter((h) => h.severity === 'critical').map((h, i) => (
              <div key={`c${i}-${h.detail}`} className="flex items-start gap-1.5 bg-red-950 border border-red-600 text-red-300 text-xs font-semibold px-2 py-1.5">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />
                <span>{scan.accepted === false ? 'UNCONFIRMED — verify plate: ' : ''}{h.detail}</span>
              </div>
            ))}
            {scan.accepted === false && scan.enrich_status !== 'pending' && (
              <div className="flex items-start gap-1.5 bg-yellow-950/60 border border-yellow-700 text-yellow-300 text-[11px] px-2 py-1.5">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />
                <span>Low-confidence read{scan.plate_confidence != null ? ` (${Math.round(scan.plate_confidence * 100)}%)` : ''} — held for review. Not recorded as confirmed until an officer verifies it.</span>
              </div>
            )}
            {scan.vehicle_count === 0 && (
              <div className="text-[11px] text-[#888] px-1 py-2">
                No readable plate found. The photo was still saved to the call.
              </div>
            )}
            {scan.vehicles.map((v, i) => (
              <div key={v.vehicle_record_id ?? i} className="border border-[#222] bg-[#0b0b0b] p-2">
                <div className="flex items-center justify-between">
                  <span className="text-lg tracking-[0.15em] text-white font-semibold">{v.plate || '—'}</span>
                  <span className="text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 border border-[#333] text-[#888]">
                    {v.vehicle_record_created ? 'NEW RECORD' : 'LINKED'}
                  </span>
                </div>
                <div className="text-[11px] text-[#888] mt-0.5">
                  {[v.color, v.year, v.make, v.model].filter(Boolean).join(' ') || v.vehicle_type || '—'}
                  {v.confidence != null ? ` · ${Math.round(v.confidence * 100)}%` : ''}
                </div>
                {(v.condition || v.damage_observed || (v.damage_areas && v.damage_areas.length > 0)) && (
                  <div className="mt-1 space-y-0.5">
                    <div className="flex items-center gap-1.5">
                      {v.condition && (
                        <span className={`text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 border ${conditionBadgeClass(v.condition)}`}>
                          {v.condition}
                        </span>
                      )}
                      {v.damage_summary && <span className="text-[10px] text-[#aaa]">{v.damage_summary}</span>}
                    </div>
                    {v.damage_areas && v.damage_areas.length > 0 && (
                      <ul className="text-[10px] text-[#888] pl-3 list-disc">
                        {v.damage_areas.map((d, di) => (
                          <li key={di}>{[d.severity, d.panel, d.type].filter(Boolean).join(' ')}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
                {v.hits.filter((h) => h.severity === 'critical').map((h, hi) => (
                  <div key={`vh${hi}-${h.detail}`} className="text-[11px] text-red-400 font-semibold mt-1">⚠ {h.detail}</div>
                ))}
              </div>
            ))}
            <button
              type="button" onClick={clearScan}
              className="w-full py-2 text-xs font-bold uppercase tracking-wider border border-[#d4a017] text-[#d4a017] mt-1">
              Done
            </button>
          </div>
        )}
        {preview ? (
          <img src={preview} alt="Captured photo preview" className="absolute inset-0 w-full h-full object-contain bg-black" />
        ) : (
          <>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption -- live viewfinder, no audio track */}
            <video ref={videoRef} playsInline muted className="absolute inset-0 w-full h-full object-cover" />
            {/* HUD — mirrors what the stamp will burn in */}
            <div className="absolute top-0 left-0 right-0 px-3 py-2 flex items-start justify-between pointer-events-none">
              <div className="bg-black/55 px-2 py-1 font-mono text-[11px] text-white">{clock}</div>
              <div className={`bg-black/55 px-2 py-1 font-mono text-[11px] flex items-center gap-1 ${gps ? 'text-[#d4a017]' : 'text-red-400'}`}>
                <MapPin className="w-3 h-3" />
                {gps ? `±${Math.round(gps.accuracy)}m` : 'NO GPS'}
              </div>
            </div>
            <div className="absolute bottom-0 left-0 right-0 px-3 pb-2 pointer-events-none">
              <div className="bg-black/55 px-2 py-1 inline-block font-mono text-[11px] text-white">
                {user?.full_name || user?.username || '—'}
              </div>
            </div>
            {cameraError && (
              <div className="absolute inset-0 flex items-center justify-center p-6">
                <div className="bg-[#141414] border border-[#222] p-4 text-center text-xs text-rmpg-300 max-w-xs">
                  <Camera className="w-6 h-6 mx-auto mb-2 text-[#888]" />
                  {cameraError}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Bottom controls ── */}
      <div className="bg-[#080808] border-t border-[#1a1a1a] px-4 py-4">
        {preview ? (
          <div className="flex items-center justify-center gap-6">
            <button
              type="button"
              onClick={discard}
              disabled={uploading}
              className="flex flex-col items-center gap-1 text-red-400 disabled:opacity-40"
              aria-label="Discard photo"
            >
              <span className="w-14 h-14 border-2 border-red-700/60 bg-[#141414] flex items-center justify-center">
                <X className="w-6 h-6" />
              </span>
              <span className="text-[10px] uppercase font-bold tracking-wider">Discard</span>
            </button>
            <button
              type="button"
              onClick={upload}
              disabled={uploading || !!scan}
              className={`flex flex-col items-center gap-1 disabled:opacity-40 ${alprMode ? 'text-[#d4a017]' : 'text-green-400'}`}
              aria-label={alprMode ? 'Scan vehicles' : 'Save photo'}
            >
              <span className={`w-16 h-16 border-2 bg-[#141414] flex items-center justify-center ${alprMode ? 'border-[#d4a017]/60' : 'border-green-700/60'}`}>
                {uploading ? <Loader2 className="w-7 h-7 animate-spin" />
                  : alprMode ? <ScanLine className="w-7 h-7" /> : <Check className="w-7 h-7" />}
              </span>
              <span className="text-[10px] uppercase font-bold tracking-wider">
                {uploading ? (alprMode ? 'Scanning…' : 'Saving…') : (alprMode ? 'Scan' : 'Save')}
              </span>
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-center gap-8">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex flex-col items-center gap-1 text-[#888]"
              aria-label="Use native camera app"
            >
              <span className="w-12 h-12 border border-[#333] bg-[#141414] flex items-center justify-center">
                <Camera className="w-5 h-5" />
              </span>
              <span className="text-[9px] uppercase font-bold tracking-wider">Native</span>
            </button>
            <button
              type="button"
              onClick={capture}
              disabled={!cameraReady}
              className="w-[72px] h-[72px] border-4 border-[#d4a017] bg-[#1a1a1a] flex items-center justify-center disabled:opacity-30"
              aria-label="Take photo"
            >
              <span className="w-12 h-12 bg-[#d4a017]" />
            </button>
            {/* Spacer balances the layout so the shutter stays centered */}
            <span className="w-12" aria-hidden="true" />
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={onFilePicked}
          aria-label="Capture photo with native camera"
        />
      </div>
    </div>
  );
}
