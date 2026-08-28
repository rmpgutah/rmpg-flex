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
import { useNavigate, useSearchParams } from 'react-router';
import { ArrowLeft, Camera, Loader2, MapPin, RefreshCw, X, Check, ScanLine, Car, AlertTriangle, Radar, IdCard } from 'lucide-react';
import { apiPostForm, apiFetch, authedImageUrl } from '../../hooks/useApi';
import { downscaleImage } from '../../utils/downscaleImage';
import { usePatrolScan } from '../../hooks/usePatrolScan';
import { PATROL_INTERVAL_MS } from '../../utils/patrolScan';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../components/ToastProvider';
import TrustBadge from '../../components/TrustBadge';
import LiveDlScanner, { type IdScanResult } from '../../components/LiveDlScanner';
import { formatStampTimestampMountain } from '../../utils/photoStamp';
import type { AamvaResult, ScanAlert } from '../../utils/aamvaParser';
import { aamvaToScanResultObj } from '../../utils/scanIdToRecipient';
import { importWithRetry } from '../../utils/importWithRetry';

type GpsFix = { lat: number; lng: number; accuracy: number } | null;

const PATROL_TICK_S = PATROL_INTERVAL_MS / 1000;

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
  /** Non-fatal server-side warnings (e.g. field-photo attach failed, vehicle record upsert failed). */
  warnings?: string[];
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
  ctx.fillStyle = 'rgb(0 0 0 / 0.62)';
  ctx.fillRect(0, h - bandH, w, bandH);

  ctx.fillStyle = 'white';
  ctx.font = `${fontPx}px monospace`;
  ctx.textBaseline = 'middle';
  const pad = Math.round(bandH * 0.35);
  const midY = h - bandH / 2;

  const left = `${opts.timestamp}  ·  ${opts.officer}${opts.unit ? `  ·  ${opts.unit}` : ''}`;
  ctx.fillText(left, pad, midY);

  if (opts.gps) {
    const gpsText = `${opts.gps.lat.toFixed(6)}, ${opts.gps.lng.toFixed(6)} (±${Math.round(opts.gps.accuracy)}m)`;
    const tw = ctx.measureText(gpsText).width;
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--panel-header-color').trim() || 'goldenrod';
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
  return formatStampTimestampMountain(d);
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
  const [idScanMode, setIdScanMode] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [idScanResult, setIdScanResult] = useState<{
    parsed: AamvaResult; alerts: ScanAlert[]; personId: number; personCreated: boolean;
    warrantHits: Array<{ id: number; warrant_number: string | null; offense_description: string | null }>;
    priorCallCount: number; openCaseCount: number;
  } | null>(null);
  const [idScanSubmitting, setIdScanSubmitting] = useState(false);

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

  // Revoke the capture preview object URL on change + unmount so abandoned
  // captures (navigate-away, capture-twice, ALPR keep-on-screen) don't leak.
  useEffect(() => {
    return () => { if (preview) URL.revokeObjectURL(preview); };
  }, [preview]);

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

  // ── Patrol Scan (continuous "while driving" ALPR) ──
  // Grab the live frame, stamp it, downscale for a fast plate read. Returns
  // null when the camera isn't ready so the loop just skips that tick.
  const grabPatrolFrame = useCallback(async (): Promise<Blob | null> => {
    const video = videoRef.current;
    if (!video || !cameraReady) return null;
    const stamped = await stampToBlob(video, video.videoWidth, video.videoHeight);
    if (!stamped) return null;
    return downscaleImage(stamped, 1280, 0.8);
  }, [cameraReady, stampToBlob]);

  const getGps = useCallback(() => (gps ? { lat: gps.lat, lng: gps.lng } : null), [gps]);
  const patrol = usePatrolScan({
    getFrame: grabPatrolFrame,
    getGps,
    onError: (m) => { /* transient tick failure — keep patrolling */ void m; },
  });
  const patrolRunning = patrol.running;

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
      // Shared metadata appends so the two post paths can't diverge.
      const appendMeta = (fd: FormData) => {
        if (gps) { fd.append('lat', String(gps.lat)); fd.append('lng', String(gps.lng)); }
        if (callId) fd.append('call_id', callId);
        if (incidentId) fd.append('incident_id', incidentId);
      };

      if (alprMode) {
        // Downscale for a fast plate read; the full-res stamped blob still goes
        // to the call's photo gallery via the field_photos row the server makes.
        const alprBlob = await downscaleImage(blob, 1280, 0.8);
        const alprForm = new FormData();
        alprForm.append('photo', alprBlob, 'field-photo.jpg');
        appendMeta(alprForm);
        alprForm.append('capture_reason', 'on_scene_alpr');
        const r = await apiPostForm<AlprScanResult>('/alpr/capture', alprForm);
        const rHits = r.hits ?? [];
        setScan(r);
        addToast(
          (r.vehicle_count ?? 0)
            ? 'ALPR: plate read — identifying vehicle…'
            : 'ALPR: no readable plate — photo saved to call',
          rHits.some((h) => h.severity === 'critical') ? 'error' : 'success',
        );
        // Surface any non-fatal server warnings (e.g. photo not attached to call gallery).
        if (r.warnings?.length) {
          addToast(r.warnings.join(' · '), 'warning');
        }
        if (r.enrich_status === 'pending') void pollEnrichment(r.id);
        // keep the preview + result on screen so the officer can review hits
      } else {
        // 'photo' is the field name both /field-photos and /alpr/capture accept.
        const form = new FormData();
        form.append('photo', blob, 'field-photo.jpg');
        appendMeta(form);
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

  const handleIdScanComplete = useCallback(async ({ barcodeText }: IdScanResult) => {
    setShowScanner(false);
    startCamera(facing);
    if (!barcodeText) { addToast('No barcode read — try again or use manual entry', 'error'); return; }
    try {
      const { parseAamva, looksLikeAamva, assessAamva } = await importWithRetry(() => import('../../utils/aamvaParser'));
      if (!looksLikeAamva(barcodeText)) { addToast('Barcode did not decode as a DL/ID', 'error'); return; }
      const parsed = parseAamva(barcodeText);
      const alerts = assessAamva(parsed);
      setIdScanSubmitting(true);
      const scanPayload = aamvaToScanResultObj(parsed);
      const resp = await apiFetch<{
        person: { id: number }; person_created: boolean;
        warrant_hits: Array<{ id: number; warrant_number: string | null; offense_description: string | null }>;
        prior_calls: unknown[]; open_cases: unknown[];
      }>('/records/from-dl-scan', {
        method: 'POST',
        body: JSON.stringify({ scan: scanPayload, call_id: callId ? Number(callId) : undefined }),
      });
      setIdScanResult({
        parsed, alerts, personId: resp.person.id, personCreated: resp.person_created,
        warrantHits: resp.warrant_hits, priorCallCount: resp.prior_calls.length, openCaseCount: resp.open_cases.length,
      });
      addToast(resp.person_created ? 'New person record created from scan' : 'Matched existing person record', 'success');
      if (resp.warrant_hits.length > 0) {
        addToast(`⚠ ${resp.warrant_hits.length} active warrant(s) found`, 'error');
      }
    } catch (err: any) {
      addToast(err?.message || 'Scan failed to parse — try again', 'error');
    } finally {
      setIdScanSubmitting(false);
    }
  }, [addToast, startCamera, facing, callId]);

  const clearIdScan = useCallback(() => { setIdScanResult(null); }, []);

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col safe-pt safe-pb safe-px">
      {/* ── Top bar ── */}
      <div className="flex items-center justify-between px-3 py-2 bg-surface-sunken border-b border-border-default">
        <button
          type="button"
          onClick={() => navigate(-1)}
          // Audit caught (2026-06-21): on-scene officer touch surface — Back
          // was effectively ~32px; gloved finger on a moving phone routinely
          // mis-taps. Bumped to 44px minimum per WCAG 2.5.5 target size.
          className="flex items-center gap-1 text-fg-muted text-xs font-bold uppercase tracking-wider p-2 -ml-2 min-w-[44px] min-h-[44px]"
          aria-label="Back"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <span className="text-[10px] font-bold uppercase tracking-widest text-[color:var(--panel-header-color)]">Field Camera</span>
        <button
          type="button"
          onClick={() => setFacing((f) => (f === 'environment' ? 'user' : 'environment'))}
          className="text-fg-muted p-2 -mr-2 min-w-[44px] min-h-[44px] flex items-center justify-center"
          aria-label="Flip camera"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* ── Mode bar — ALPR toggle + Patrol Scan + call context ── */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-surface-overlay border-b border-border-subtle">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setAlprMode((m) => {
              const next = !m;
              if (next) setIdScanMode(false);
              return next;
            })}
            disabled={patrolRunning}
            className={`flex items-center gap-1.5 px-2 py-1 text-[10px] font-bold uppercase tracking-wider border disabled:opacity-40 ${
              alprMode ? 'border-accent-silver-400 text-[color:var(--field-label-color)] bg-surface-sunken' : 'border-border-subtle text-fg-muted'
            }`}
            aria-pressed={alprMode}
          >
            <ScanLine className="w-3.5 h-3.5" /> Scan vehicles {alprMode ? 'ON' : 'OFF'}
          </button>
          <button
            type="button"
            onClick={() => setIdScanMode((m) => {
              const next = !m;
              if (next) setAlprMode(false);
              return next;
            })}
            disabled={patrolRunning}
            className={`flex items-center gap-1.5 px-2 py-1 text-[10px] font-bold uppercase tracking-wider border disabled:opacity-40 ${
              idScanMode ? 'border-brand-400 text-brand-400 bg-surface-sunken' : 'border-border-subtle text-fg-muted'
            }`}
            aria-pressed={idScanMode}
          >
            <IdCard className="w-3.5 h-3.5" /> Scan ID {idScanMode ? 'ON' : 'OFF'}
          </button>
          <button
            type="button"
            onClick={() => (patrolRunning ? patrol.stop() : patrol.start())}
            className={`flex items-center gap-1.5 px-2 py-1 text-[10px] font-bold uppercase tracking-wider border ${
              patrolRunning ? 'border-red-600 text-red-300 bg-red-950 animate-pulse' : 'border-border-subtle text-fg-muted'
            }`}
            aria-pressed={patrolRunning}
          >
            <Radar className="w-3.5 h-3.5" /> Patrol {patrolRunning ? 'ON' : 'OFF'}
          </button>
        </div>
        {callId && !patrolRunning && (
          <span className="text-[10px] font-bold uppercase tracking-wider text-fg-muted">
            Call #{callId}
          </span>
        )}
        {patrolRunning && (
          <span className="text-[10px] font-bold uppercase tracking-wider text-red-300">
            {patrol.scanCount} scanned
          </span>
        )}
      </div>

      {/* ── Viewfinder / preview ── */}
      <div className="relative flex-1 overflow-hidden">
        {/* Patrol Scan: critical-hit banner — full-width, dismissable */}
        {patrol.lastHit && (
          <div className="absolute top-0 left-0 right-0 z-20 bg-red-700 text-rmpg-100 px-3 py-2 flex items-start gap-2 shadow-lg safe-pt safe-px">
            <AlertTriangle className="w-5 h-5 shrink-0 mt-px animate-pulse" />
            <div className="flex-1 min-w-0">
              <div className="text-[10px] font-bold uppercase tracking-widest">Patrol Hit</div>
              <div className="text-sm font-semibold leading-tight">{patrol.lastHit.text}</div>
            </div>
            <button type="button" onClick={patrol.clearHit} className="p-1 -mr-1 min-w-[44px] min-h-[44px] flex items-center justify-center" aria-label="Dismiss hit alert">
              <X className="w-5 h-5" />
            </button>
          </div>
        )}
        {/* Patrol Scan: live read log along the bottom */}
        {patrolRunning && patrol.log.length > 0 && (
          <div className="absolute bottom-0 left-0 right-0 z-10 max-h-[42%] overflow-y-auto bg-black/80 border-t border-border-default divide-y divide-border-subtle safe-pb safe-px">
            {patrol.log.map((e) => (
              <div
                key={e.key}
                className={`flex items-center justify-between px-3 py-1.5 ${e.critical ? 'bg-red-950' : ''}`}
              >
                <span className={`text-sm tracking-[0.12em] font-semibold ${e.critical ? 'text-red-300' : 'text-rmpg-100'}`}>
                  {e.plate}
                </span>
                <span className="text-[10px] text-fg-muted min-w-0 truncate ml-2 flex-1 text-right flex items-center justify-end gap-1">
                  {e.vehicle}
                  {e.confidence != null && <TrustBadge trust={{ trustScore: e.confidence, readCount: 1, basis: 'patrol scan' }} />}
                  {e.critical ? ' · ⚠ HIT' : ''}
                </span>
              </div>
            ))}
          </div>
        )}
        {/* ALPR scan result overlay */}
        {scan && (
          <div className="absolute inset-0 z-10 bg-black/92 overflow-y-auto p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-[color:var(--field-label-color)] flex items-center gap-1">
                  <Car className="w-4 h-4" /> {scan.vehicle_count} vehicle(s)
                  {callId ? ` · linked to call #${callId}` : ''}
                </span>
                {scan.enrich_status === 'pending' && (
                  <span className="text-[10px] text-fg-muted flex items-center gap-1">
                    <Loader2 className="w-3 h-3 animate-spin" /> Identifying…
                  </span>
                )}
              </div>
              <button type="button" onClick={clearScan} className="text-fg-muted p-1 min-w-[44px] min-h-[44px] flex items-center justify-center" aria-label="Done">
                <X className="w-5 h-5" />
              </button>
            </div>
            {(scan.hits ?? []).filter((h) => h.severity === 'critical').map((h, i) => (
              <div key={`c${i}-${h.detail}`} className="flex items-start gap-1.5 bg-red-950 border border-red-600 text-red-300 text-xs font-semibold px-2 py-1.5">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />
                <span>{scan.accepted === false ? 'UNCONFIRMED — verify plate: ' : ''}{h.detail}</span>
              </div>
            ))}
            {scan.accepted === false && scan.enrich_status !== 'pending' && (
              <div className="flex items-start gap-1.5 bg-yellow-950/60 border border-yellow-700 text-yellow-300 text-[11px] px-2 py-1.5">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />
                <span>Low-confidence read — held for review. Not recorded as confirmed until an officer verifies it.</span>
              </div>
            )}
            {(scan.vehicle_count ?? 0) === 0 && (
              <div className="text-[11px] text-fg-muted px-1 py-2">
                No readable plate found. The photo was still saved to the call.
              </div>
            )}
            {(scan.vehicles ?? []).map((v, i) => (
              <div key={v.vehicle_record_id ?? i} className="border border-border-default bg-surface-sunken p-2">
                <div className="flex items-center justify-between">
                  <span className="text-lg tracking-[0.15em] text-rmpg-100 font-semibold">{v.plate || '—'}</span>
                  <span className="text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 border border-border-subtle text-fg-muted">
                    {v.vehicle_record_created ? 'NEW RECORD' : 'LINKED'}
                  </span>
                </div>
                <div className="text-[11px] text-fg-muted mt-0.5 flex items-center gap-1.5 flex-wrap">
                  <span>{[v.color, v.year, v.make, v.model].filter(Boolean).join(' ') || v.vehicle_type || '—'}</span>
                  {v.confidence != null && <TrustBadge trust={{ trustScore: v.confidence, readCount: 1, basis: 'single read' }} />}
                </div>
                {(v.condition || v.damage_observed || (v.damage_areas && v.damage_areas.length > 0)) && (
                  <div className="mt-1 space-y-0.5">
                    <div className="flex items-center gap-1.5">
                      {v.condition && (
                        <span className={`text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 border ${conditionBadgeClass(v.condition)}`}>
                          {v.condition}
                        </span>
                      )}
                      {v.damage_summary && <span className="text-[10px] text-fg-muted">{v.damage_summary}</span>}
                    </div>
                    {v.damage_areas && v.damage_areas.length > 0 && (
                      <ul className="text-[10px] text-fg-muted pl-3 list-disc">
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
              className="w-full py-2 text-xs font-bold uppercase tracking-wider border border-accent-silver-400 text-[color:var(--field-label-color)] mt-1">
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
            <div className="absolute top-0 left-0 right-0 px-3 py-2 flex items-start justify-between pointer-events-none safe-pt safe-px">
              <div className="bg-black/55 px-2 py-1 font-mono text-[11px] text-rmpg-100">{clock}</div>
              <div className={`bg-black/55 px-2 py-1 font-mono text-[11px] flex items-center gap-1 ${gps ? 'text-[color:var(--field-label-color)]' : 'text-red-400'}`}>
                <MapPin className="w-3 h-3" />
                {gps ? `±${Math.round(gps.accuracy)}m` : 'NO GPS'}
              </div>
            </div>
            <div className="absolute bottom-0 left-0 right-0 px-3 pb-2 pointer-events-none safe-pb safe-px">
              <div className="bg-black/55 px-2 py-1 inline-block font-mono text-[11px] text-rmpg-100">
                {user?.full_name || user?.username || '—'}
              </div>
            </div>
            {cameraError && (
              <div className="absolute inset-0 flex items-center justify-center p-6">
                <div className="bg-surface-base border border-border-default p-4 text-center text-xs text-rmpg-300 max-w-xs">
                  <Camera className="w-6 h-6 mx-auto mb-2 text-fg-muted" />
                  {cameraError}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Bottom controls ── */}
      <div className="bg-surface-sunken border-t border-border-default px-4 py-4">
        {preview ? (
          <div className="flex items-center justify-center gap-6">
            <button
              type="button"
              onClick={discard}
              disabled={uploading || !!scan}
              className="flex flex-col items-center gap-1 text-red-400 disabled:opacity-40"
              aria-label="Discard photo"
            >
              <span className="w-14 h-14 border-2 border-red-700/60 bg-surface-base flex items-center justify-center">
                <X className="w-6 h-6" />
              </span>
              <span className="text-[10px] uppercase font-bold tracking-wider">Discard</span>
            </button>
            <button
              type="button"
              onClick={upload}
              disabled={uploading || !!scan}
              className={`flex flex-col items-center gap-1 disabled:opacity-40 ${alprMode ? 'text-[color:var(--field-label-color)]' : 'text-green-400'}`}
              aria-label={alprMode ? 'Scan vehicles' : 'Save photo'}
            >
              <span className={`w-16 h-16 border-2 bg-surface-base flex items-center justify-center ${alprMode ? 'border-accent-silver-400/60' : 'border-green-700/60'}`}>
                {uploading ? <Loader2 className="w-7 h-7 animate-spin" />
                  : alprMode ? <ScanLine className="w-7 h-7" /> : <Check className="w-7 h-7" />}
              </span>
              <span className="text-[10px] uppercase font-bold tracking-wider">
                {uploading ? (alprMode ? 'Scanning…' : 'Saving…') : (alprMode ? 'Scan' : 'Save')}
              </span>
            </button>
          </div>
        ) : patrolRunning ? (
          <div className="flex flex-col items-center gap-2">
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-red-300">
              <Radar className="w-4 h-4 animate-pulse" /> Patrol scanning · every {Math.round(PATROL_TICK_S)}s
            </div>
            <button
              type="button"
              onClick={() => patrol.stop()}
              className="px-8 py-3 border-2 border-red-600 text-red-300 bg-red-950 text-sm font-bold uppercase tracking-widest"
              aria-label="Stop patrol scan"
            >
              Stop Patrol
            </button>
            <span className="text-[9px] text-rmpg-500 uppercase tracking-wider">
              Keep phone mounted &amp; screen on — web can’t scan in the background
            </span>
          </div>
        ) : (
          <div className="flex items-center justify-center gap-8">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex flex-col items-center gap-1 text-fg-muted"
              aria-label="Use native camera app"
            >
              <span className="w-12 h-12 border border-border-subtle bg-surface-base flex items-center justify-center">
                <Camera className="w-5 h-5" />
              </span>
              <span className="text-[9px] uppercase font-bold tracking-wider">Native</span>
            </button>
            <button
              type="button"
              onClick={idScanMode ? () => {
                streamRef.current?.getTracks().forEach((t) => t.stop());
                setShowScanner(true);
              } : capture}
              disabled={!cameraReady && !idScanMode}
              className="w-[72px] h-[72px] border-4 border-brand-400 bg-surface-raised flex items-center justify-center disabled:opacity-30"
              aria-label={idScanMode ? 'Scan ID barcode' : 'Take photo'}
            >
              {idScanMode ? <IdCard className="w-8 h-8 text-brand-400" /> : <span className="w-12 h-12 bg-brand-400" />}
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
      {showScanner && (
        <LiveDlScanner
          onComplete={handleIdScanComplete}
          onClose={() => { setShowScanner(false); startCamera(facing); }}
          onUploadInstead={() => {
            setShowScanner(false);
            startCamera(facing);
            addToast('Photo-upload scanning isn\'t available on this screen — try again or use another entry method', 'error');
          }}
        />
      )}
      {idScanResult && (
        <div className="absolute inset-0 z-30 bg-black/92 overflow-y-auto p-3 space-y-2 safe-pt safe-pb safe-px">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-brand-400 flex items-center gap-1">
              <IdCard className="w-4 h-4" /> {idScanResult.parsed.last_name}, {idScanResult.parsed.first_name}
              {idScanResult.personCreated ? ' · NEW RECORD' : ' · LINKED'}
            </span>
            <button type="button" onClick={clearIdScan} className="text-fg-muted p-1 min-w-[44px] min-h-[44px] flex items-center justify-center" aria-label="Done">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="text-xs text-fg-muted space-y-0.5">
            <div>DOB {idScanResult.parsed.date_of_birth || '—'}</div>
            <div>DL {idScanResult.parsed.dl_number || '—'} ({idScanResult.parsed.dl_state || '—'})</div>
            <div>{idScanResult.parsed.address || '—'}, {idScanResult.parsed.city || '—'} {idScanResult.parsed.state || ''} {idScanResult.parsed.zip || ''}</div>
          </div>
          {(idScanResult.priorCallCount > 0 || idScanResult.openCaseCount > 0) && (
            <div className="text-[10px] text-fg-muted">
              {idScanResult.priorCallCount} prior call(s) · {idScanResult.openCaseCount} open case(s)
            </div>
          )}
          {idScanResult.warrantHits.length > 0 && (
            <div className="bg-red-950 border border-red-600 text-red-300 text-xs font-bold px-2 py-1.5 space-y-1">
              <div className="uppercase tracking-wider">⚠ Active Warrant{idScanResult.warrantHits.length > 1 ? 's' : ''}</div>
              {idScanResult.warrantHits.map((w) => (
                <div key={w.id}>{w.warrant_number || `#${w.id}`} — {w.offense_description || 'no offense on file'}</div>
              ))}
            </div>
          )}
          {idScanResult.alerts.map((a, i) => (
            <div key={`${a.code}-${i}`} className={`flex items-start gap-1.5 border text-xs font-semibold px-2 py-1.5 ${
              a.level === 'danger' ? 'bg-red-950 border-red-600 text-red-300'
                : a.level === 'warning' ? 'bg-yellow-950/60 border-yellow-700 text-yellow-300'
                : 'bg-surface-sunken border-border-subtle text-fg-muted'
            }`}>
              <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />
              <span>{a.message}</span>
            </div>
          ))}
          <button
            type="button" onClick={() => navigate(`/records?tab=persons&personId=${idScanResult.personId}`)}
            className="w-full py-2 text-xs font-bold uppercase tracking-wider border border-brand-400 text-brand-400 mt-1">
            View Person Record
          </button>
          <button
            type="button" onClick={clearIdScan}
            className="w-full py-2 text-xs font-bold uppercase tracking-wider border border-border-subtle text-fg-muted">
            Scan Another
          </button>
        </div>
      )}
      {idScanSubmitting && (
        <div className="absolute inset-0 z-30 bg-black/70 flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-brand-400" />
        </div>
      )}
    </div>
  );
}
