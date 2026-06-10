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
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Camera, Loader2, MapPin, RefreshCw, X, Check } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../components/ToastProvider';

type GpsFix = { lat: number; lng: number; accuracy: number } | null;

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
  const { user } = useAuth();
  const { addToast } = useToast();

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

  const upload = useCallback(async () => {
    const blob = previewBlobRef.current;
    if (!blob || uploading) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append('photo', blob, 'field-photo.jpg');
      if (gps) { form.append('lat', String(gps.lat)); form.append('lng', String(gps.lng)); }
      await apiFetch('/field-photos', { method: 'POST', body: form });
      addToast('Photo saved', 'success');
      discard();
    } catch (err: any) {
      addToast(err?.message || 'Upload failed — photo kept on screen', 'error');
    } finally {
      setUploading(false);
    }
  }, [gps, uploading, discard, addToast]);

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

      {/* ── Viewfinder / preview ── */}
      <div className="relative flex-1 overflow-hidden">
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
              disabled={uploading}
              className="flex flex-col items-center gap-1 text-green-400 disabled:opacity-40"
              aria-label="Save photo"
            >
              <span className="w-16 h-16 border-2 border-green-700/60 bg-[#141414] flex items-center justify-center">
                {uploading ? <Loader2 className="w-7 h-7 animate-spin" /> : <Check className="w-7 h-7" />}
              </span>
              <span className="text-[10px] uppercase font-bold tracking-wider">{uploading ? 'Saving…' : 'Save'}</span>
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
