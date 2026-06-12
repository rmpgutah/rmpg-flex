// ============================================================
// RMPG Flex — Live DL Scanner (continuous camera PDF417 read)
// ============================================================
// Full-screen camera view that continuously samples frames and
// decodes the PDF417 barcode on the back of a license — no shutter
// button. Decodes typically land within a second or two of the
// barcode filling the guide box.
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Flashlight, Loader2, ScanLine, Upload, X } from 'lucide-react';

interface LiveDlScannerProps {
  onDecoded: (text: string) => void;
  onClose: () => void;
  /** Open the photo-upload fallback (file input). */
  onUploadInstead: () => void;
}

export default function LiveDlScanner({ onDecoded, onClose, onUploadInstead }: LiveDlScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const decodingRef = useRef(false);
  const doneRef = useRef(false);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(true);
  const [torchOn, setTorchOn] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [attempts, setAttempts] = useState(0);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => { try { t.stop(); } catch { /* already stopped */ } });
    streamRef.current = null;
  }, []);

  // Torch (rear flash) — supported on most Android/Chrome; iOS Safari lacks it.
  const toggleTorch = useCallback(async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      const next = !torchOn;
      await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
      setTorchOn(next);
    } catch { /* device refused — leave state as-is */ }
  }, [torchOn]);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play().catch(() => { /* autoplay policies — playsInline set */ });
        setStarting(false);

        const caps = stream.getVideoTracks()[0]?.getCapabilities?.() as (MediaTrackCapabilities & { torch?: boolean }) | undefined;
        if (caps?.torch) setTorchAvailable(true);

        const { decodePdf417Frame } = await import('../utils/pdf417Decoder');
        // ~3 frames/sec — fast enough to feel instant, light enough
        // that decode work never piles up (decodingRef gates re-entry).
        interval = setInterval(async () => {
          if (cancelled || doneRef.current || decodingRef.current) return;
          const v = videoRef.current;
          if (!v || v.readyState < 2 || !v.videoWidth) return;
          decodingRef.current = true;
          try {
            if (!canvasRef.current) canvasRef.current = document.createElement('canvas');
            const canvas = canvasRef.current;
            canvas.width = v.videoWidth;
            canvas.height = v.videoHeight;
            const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
            ctx.drawImage(v, 0, 0);
            const text = await decodePdf417Frame(ctx.getImageData(0, 0, canvas.width, canvas.height));
            setAttempts(a => a + 1);
            if (text && !doneRef.current) {
              doneRef.current = true;
              if (navigator.vibrate) navigator.vibrate(120);
              stopStream();
              onDecoded(text);
            }
          } finally {
            decodingRef.current = false;
          }
        }, 350);
      } catch (err: any) {
        if (!cancelled) {
          setStarting(false);
          setError(
            err?.name === 'NotAllowedError'
              ? 'Camera permission denied — allow camera access or upload a photo instead.'
              : 'Camera unavailable on this device — upload a photo instead.',
          );
        }
      }
    })();

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
      stopStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-[60] bg-black flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-[#0a0a0a] border-b border-[#222222] flex-shrink-0">
        <div className="flex items-center gap-2">
          <ScanLine size={14} className="text-[#d4a017]" />
          <span className="text-[11px] font-bold text-white uppercase tracking-widest">Live DL Scanner</span>
        </div>
        <button type="button" onClick={() => { stopStream(); onClose(); }} aria-label="Close scanner" className="text-[#888888] hover:text-white p-1">
          <X size={18} />
        </button>
      </div>

      {/* Camera viewport */}
      <div className="relative flex-1 overflow-hidden bg-black">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video ref={videoRef} playsInline muted className="absolute inset-0 w-full h-full object-cover" />

        {starting && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex items-center gap-2 text-[11px] text-[#888888]">
              <Loader2 size={16} className="animate-spin" /> Starting camera...
            </div>
          </div>
        )}

        {error ? (
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <div className="bg-[#141414] border border-red-700/50 rounded-sm p-4 max-w-xs text-center space-y-3">
              <Camera size={22} className="mx-auto text-red-400" />
              <p className="text-[11px] text-red-400">{error}</p>
              <button
                type="button"
                onClick={() => { stopStream(); onUploadInstead(); }}
                className="flex items-center gap-2 mx-auto px-4 py-2 bg-[#d4a017] hover:bg-[#b88a12] rounded-sm text-[11px] font-bold text-black"
              >
                <Upload size={13} /> Upload Photo
              </button>
            </div>
          </div>
        ) : !starting && (
          <>
            {/* Guide box — PDF417 is a wide strip, so the target is wide+short */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="relative w-[86%] max-w-md aspect-[3.2/1]">
                <div className="absolute -top-px -left-px w-6 h-6 border-t-2 border-l-2 border-[#d4a017]" />
                <div className="absolute -top-px -right-px w-6 h-6 border-t-2 border-r-2 border-[#d4a017]" />
                <div className="absolute -bottom-px -left-px w-6 h-6 border-b-2 border-l-2 border-[#d4a017]" />
                <div className="absolute -bottom-px -right-px w-6 h-6 border-b-2 border-r-2 border-[#d4a017]" />
                <div className="absolute inset-x-0 top-1/2 h-px bg-[#d4a017]/60 animate-pulse" />
              </div>
            </div>
            <div className="absolute bottom-24 inset-x-0 text-center pointer-events-none">
              <p className="text-[11px] font-bold text-white uppercase tracking-wider drop-shadow">Align the barcode on the BACK of the card</p>
              <p className="text-[9px] text-[#c0ccdd] mt-0.5 drop-shadow">Hold steady — reads automatically{attempts > 8 ? ' · try moving closer or adding light' : ''}</p>
            </div>
          </>
        )}
      </div>

      {/* Footer controls */}
      <div className="flex items-center justify-center gap-3 px-4 py-3 bg-[#0a0a0a] border-t border-[#222222] flex-shrink-0">
        {torchAvailable && (
          <button
            type="button"
            onClick={toggleTorch}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-sm text-[10px] font-bold border transition-colors ${
              torchOn ? 'bg-[#d4a017] text-black border-[#d4a017]' : 'bg-[#141414] text-[#c0ccdd] border-[#2e2e2e] hover:text-white'
            }`}
          >
            <Flashlight size={13} /> {torchOn ? 'Light On' : 'Light'}
          </button>
        )}
        <button
          type="button"
          onClick={() => { stopStream(); onUploadInstead(); }}
          className="flex items-center gap-1.5 px-3 py-2 bg-[#141414] border border-[#2e2e2e] rounded-sm text-[10px] font-bold text-[#c0ccdd] hover:text-white transition-colors"
        >
          <Upload size={13} /> Upload Photo
        </button>
        <button
          type="button"
          onClick={() => { stopStream(); onClose(); }}
          className="px-3 py-2 bg-[#141414] border border-[#2e2e2e] rounded-sm text-[10px] font-bold text-[#8899aa] hover:text-white transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
