// ============================================================
// RMPG Flex — Guided two-step ID Scanner
// ============================================================
// A dynamic, full-screen camera capture that walks the operator through
// both sides of an ID card using an ID-1 card overlay template:
//
//   STEP 1 — FRONT: rest the front of the card inside the card frame and
//            capture a still (the demographic/photo side, kept on file).
//   STEP 2 — BACK:  flip the card; a highlighted PDF417 strip guides
//            alignment. The barcode reads continuously, and on a hit the
//            back still is captured too.
//
// onComplete returns the decoded AAMVA text plus BOTH card images so the
// caller can create/merge a Persons record and keep the front + back on
// file. Either image can be null (operator skipped / decode-only).
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Flashlight, Loader2, ScanLine, Upload, X, Check, RotateCcw, CreditCard } from 'lucide-react';
import { importWithRetry } from '../utils/importWithRetry';

export interface IdScanResult {
  barcodeText: string | null;
  frontImage: Blob | null;
  backImage: Blob | null;
}

interface LiveDlScannerProps {
  onComplete: (result: IdScanResult) => void;
  onClose: () => void;
  /** Open the photo-upload fallback (file input). */
  onUploadInstead: () => void;
}

type Step = 'front' | 'back';

// ID-1 card is 85.6 × 53.98 mm → 1.586:1. The overlay frame matches so the
// operator rests the real card edge-to-edge inside the guide.
const CARD_ASPECT = 1.586;

export default function LiveDlScanner({ onComplete, onClose, onUploadInstead }: LiveDlScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const decodeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const decodingRef = useRef(false);
  const doneRef = useRef(false);
  const frontBlobRef = useRef<Blob | null>(null);

  const [step, setStep] = useState<Step>('front');
  const [frontPreview, setFrontPreview] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(true);
  const [torchOn, setTorchOn] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const stepRef = useRef<Step>('front');
  stepRef.current = step;

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => { try { t.stop(); } catch { /* already stopped */ } });
    streamRef.current = null;
  }, []);

  const toggleTorch = useCallback(async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      const next = !torchOn;
      await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
      setTorchOn(next);
    } catch { /* device refused */ }
  }, [torchOn]);

  // Grab the current video frame as a JPEG blob.
  const captureStill = useCallback((): Promise<Blob | null> => new Promise((res) => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return res(null);
    const c = document.createElement('canvas');
    c.width = v.videoWidth; c.height = v.videoHeight;
    const ctx = c.getContext('2d');
    if (!ctx) return res(null);
    ctx.drawImage(v, 0, 0);
    c.toBlob((b) => res(b), 'image/jpeg', 0.92);
  }), []);

  const captureFront = useCallback(async () => {
    const blob = await captureStill();
    if (blob) {
      frontBlobRef.current = blob;
      setFrontPreview(URL.createObjectURL(blob));
      if (navigator.vibrate) navigator.vibrate(60);
    }
    setStep('back');
  }, [captureStill]);

  const retakeFront = useCallback(() => {
    if (frontPreview) URL.revokeObjectURL(frontPreview);
    frontBlobRef.current = null;
    setFrontPreview(null);
    setStep('front');
  }, [frontPreview]);

  const skipFront = useCallback(() => { setStep('back'); }, []);

  const finish = useCallback(async (barcodeText: string | null, backImage: Blob | null) => {
    if (doneRef.current) return;
    doneRef.current = true;
    // Run the parent handler FIRST so it can set up results UI
    // while the camera feed is still live. Stop the camera stream
    // only after the parent is done — prevents a black viewfinder
    // during async processing (OCR upload, record lookup, …).
    await onComplete({ barcodeText, frontImage: frontBlobRef.current, backImage });
    stopStream();
  }, [onComplete, stopStream]);

  // ── camera + continuous PDF417 read on the BACK step ──
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play().catch(() => { /* playsInline set */ });
        setStarting(false);

        const caps = stream.getVideoTracks()[0]?.getCapabilities?.() as (MediaTrackCapabilities & { torch?: boolean }) | undefined;
        if (caps?.torch) setTorchAvailable(true);

        const { decodePdf417Frame } = await importWithRetry(() => import('../utils/pdf417Decoder'));
        interval = setInterval(async () => {
          if (cancelled || doneRef.current || decodingRef.current) return;
          if (stepRef.current !== 'back') return;     // only read on the back step
          const v = videoRef.current;
          if (!v || v.readyState < 2 || !v.videoWidth) return;
          decodingRef.current = true;
          try {
            if (!decodeCanvasRef.current) decodeCanvasRef.current = document.createElement('canvas');
            const canvas = decodeCanvasRef.current;
            canvas.width = v.videoWidth; canvas.height = v.videoHeight;
            const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
            ctx.drawImage(v, 0, 0);
            const text = await decodePdf417Frame(ctx.getImageData(0, 0, canvas.width, canvas.height));
            setAttempts(a => a + 1);
            if (text && !doneRef.current) {
              if (navigator.vibrate) navigator.vibrate(120);
              const back = await captureStill();   // keep the back image too
              finish(text, back);
            }
          } finally {
            decodingRef.current = false;
          }
        }, 350);
      } catch (err) {
        if (!cancelled) {
          setStarting(false);
          setError(((err as { name?: string }).name === 'NotAllowedError')
            ? 'Camera permission denied — allow camera access or upload a photo instead.'
            : 'Camera unavailable on this device — upload a photo instead.');
        }
      }
    })();

    return () => { cancelled = true; if (interval) clearInterval(interval); stopStream(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Manual finish on the back step without a barcode (keeps both images).
  const captureBackNoBarcode = useCallback(async () => {
    const back = await captureStill();
    finish(null, back);
  }, [captureStill, finish]);

  return (
    <div className="fixed inset-0 z-[60] bg-black flex flex-col">
      {/* Header + step indicator */}
      <div className="flex items-center justify-between px-4 py-3 bg-surface-overlay border-b border-border-default flex-shrink-0">
        <div className="flex items-center gap-2">
          <ScanLine size={14} className="[color:var(--panel-header-color)]" />
          <span className="text-[11px] font-bold text-rmpg-100 uppercase tracking-widest">ID Scanner</span>
        </div>
        <div className="flex items-center gap-1.5">
          <StepDot active={step === 'front'} done={!!frontPreview} label="FRONT" />
          <div className="w-4 h-px bg-rmpg-700" />
          <StepDot active={step === 'back'} done={false} label="BACK" />
        </div>
        <button type="button" onClick={() => { stopStream(); onClose(); }} aria-label="Close scanner" className="text-fg-muted hover:text-rmpg-100 p-1">
          <X size={18} />
        </button>
      </div>

      {/* Camera viewport */}
      <div className="relative flex-1 overflow-hidden bg-black">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video ref={videoRef} playsInline muted className="absolute inset-0 w-full h-full object-cover" />

        {starting && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex items-center gap-2 text-[11px] text-fg-muted"><Loader2 size={16} className="animate-spin" /> Starting camera...</div>
          </div>
        )}

        {error ? (
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <div className="bg-surface-deep border border-red-700/50 rounded-sm p-4 max-w-xs text-center space-y-3">
              <Camera size={22} className="mx-auto text-red-400" />
              <p className="text-[11px] text-red-400">{error}</p>
              <button type="button" onClick={() => { stopStream(); onUploadInstead(); }} className="flex items-center gap-2 mx-auto px-4 py-2 bg-brand-600 hover:bg-brand-700 rounded-sm text-[11px] font-bold text-rmpg-100">
                <Upload size={13} /> Upload Photo
              </button>
            </div>
          </div>
        ) : !starting && (
          <>
            {/* Dimmed surround + ID-1 card cutout overlay */}
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
              <div className="relative w-[88%] max-w-lg" style={{ aspectRatio: `${CARD_ASPECT}`, boxShadow: '0 0 0 9999px rgba(var(--surface-overlay-rgb) / 0.7)' }}>
                {/* card frame */}
                <div className="absolute inset-0 border-2 border-accent-silver-400 rounded-[6px]" />
                {/* corner ticks */}
                <div className="absolute -top-px -left-px w-7 h-7 border-t-2 border-l-2 border-white rounded-tl-[6px]" />
                <div className="absolute -top-px -right-px w-7 h-7 border-t-2 border-r-2 border-white rounded-tr-[6px]" />
                <div className="absolute -bottom-px -left-px w-7 h-7 border-b-2 border-l-2 border-white rounded-bl-[6px]" />
                <div className="absolute -bottom-px -right-px w-7 h-7 border-b-2 border-r-2 border-white rounded-br-[6px]" />

                {step === 'front' ? (
                  // Front template hints: photo box (left) + name lines (right)
                  <>
                    <div className="absolute left-[6%] top-[18%] w-[26%] h-[64%] border border-dashed border-white/40 rounded-[3px] flex items-center justify-center">
                      <Camera size={18} className="text-white/40" />
                    </div>
                    <div className="absolute right-[6%] top-[24%] w-[58%] space-y-2">
                      <div className="h-1.5 bg-white/30 rounded w-3/4" />
                      <div className="h-1.5 bg-white/25 rounded w-1/2" />
                      <div className="h-1.5 bg-white/20 rounded w-2/3" />
                    </div>
                  </>
                ) : (
                  // Back template hint: PDF417 strip zone + scan line
                  <>
                    <div className="absolute inset-x-[6%] top-[14%] h-[34%] border border-dashed border-accent-silver-400/70 rounded-[3px] flex items-center justify-center overflow-hidden">
                      <span className="text-[8px] font-mono uppercase tracking-wider text-accent-silver-400/80">PDF417 barcode here</span>
                      <div className="absolute inset-x-0 top-1/2 h-px bg-accent-silver-400/70 animate-pulse" />
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Frozen front thumbnail confirmation */}
            {step === 'back' && frontPreview && (
              <div className="absolute top-3 left-3 pointer-events-none">
                <div className="relative">
                  <img src={frontPreview} alt="captured front" className="w-16 rounded-sm border border-rmpg-700" style={{ aspectRatio: `${CARD_ASPECT}` }} />
                  <span className="absolute -top-1.5 -right-1.5 bg-green-600 rounded-full p-0.5"><Check size={9} className="text-rmpg-100" /></span>
                </div>
              </div>
            )}

            {/* Instruction */}
            <div className="absolute bottom-24 inset-x-0 text-center pointer-events-none px-4">
              {step === 'front' ? (
                <>
                  <p className="text-[12px] font-bold text-rmpg-100 uppercase tracking-wider drop-shadow">Step 1 — FRONT of the ID</p>
                  <p className="text-[9px] text-rmpg-200 mt-0.5 drop-shadow">Rest the front of the card inside the frame, then capture</p>
                </>
              ) : (
                <>
                  <p className="text-[12px] font-bold text-rmpg-100 uppercase tracking-wider drop-shadow">Step 2 — BACK of the ID</p>
                  <p className="text-[9px] text-rmpg-200 mt-0.5 drop-shadow">Align the PDF417 barcode — reads automatically{attempts > 10 ? ' · move closer or add light' : ''}</p>
                </>
              )}
            </div>
          </>
        )}
      </div>

      {/* Footer controls — step-specific */}
      <div className="flex items-center justify-center gap-2 px-4 py-3 bg-surface-overlay border-t border-border-default flex-shrink-0 flex-wrap">
        {torchAvailable && (
          <button type="button" onClick={toggleTorch} className={`flex items-center gap-1.5 px-3 py-2 rounded-sm text-[10px] font-bold border transition-colors ${torchOn ? 'bg-brand-600 text-rmpg-100 border-brand-600' : 'bg-surface-deep text-rmpg-200 border-rmpg-700 hover:text-rmpg-100'}`}>
            <Flashlight size={13} /> {torchOn ? 'Light On' : 'Light'}
          </button>
        )}

        {step === 'front' ? (
          <>
            <button type="button" onClick={captureFront} disabled={starting || !!error} className="flex items-center gap-2 px-5 py-2.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-40 rounded-sm text-[12px] font-bold text-rmpg-100 uppercase tracking-wider">
              <CreditCard size={15} /> Capture Front
            </button>
            <button type="button" onClick={skipFront} className="px-3 py-2 bg-surface-deep border border-rmpg-700 rounded-sm text-[10px] font-bold text-rmpg-400 hover:text-rmpg-100">Skip</button>
          </>
        ) : (
          <>
            {frontPreview && (
              <button type="button" onClick={retakeFront} className="flex items-center gap-1.5 px-3 py-2 bg-surface-deep border border-rmpg-700 rounded-sm text-[10px] font-bold text-rmpg-200 hover:text-rmpg-100">
                <RotateCcw size={12} /> Retake Front
              </button>
            )}
            <button type="button" onClick={captureBackNoBarcode} className="flex items-center gap-1.5 px-3 py-2 bg-surface-deep border border-rmpg-700 rounded-sm text-[10px] font-bold text-rmpg-200 hover:text-rmpg-100">
              <CreditCard size={13} /> Capture Back (no barcode)
            </button>
          </>
        )}

        <button type="button" onClick={() => { stopStream(); onUploadInstead(); }} className="flex items-center gap-1.5 px-3 py-2 bg-surface-deep border border-rmpg-700 rounded-sm text-[10px] font-bold text-rmpg-200 hover:text-rmpg-100">
          <Upload size={13} /> Upload
        </button>
        <button type="button" onClick={() => { stopStream(); onClose(); }} className="px-3 py-2 bg-surface-deep border border-rmpg-700 rounded-sm text-[10px] font-bold text-rmpg-400 hover:text-rmpg-100">Cancel</button>
      </div>
    </div>
  );
}

function StepDot({ active, done, label }: { active: boolean; done: boolean; label: string }) {
  return (
    <div className="flex items-center gap-1">
      <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[7px] font-bold ${done ? 'bg-green-600 text-rmpg-100' : active ? 'bg-brand-600 text-rmpg-100' : 'bg-surface-raised text-fg-muted border border-rmpg-700'}`}>
        {done ? <Check size={9} /> : label[0]}
      </span>
      <span className={`text-[8px] font-bold uppercase tracking-wider ${active ? '[color:var(--panel-header-color)]' : 'text-fg-muted'}`}>{label}</span>
    </div>
  );
}
