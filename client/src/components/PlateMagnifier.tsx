// ============================================================
// RMPG Flex — Plate Magnifier (live forensic enhancement inset)
// ============================================================
// Crops the target vehicle's plate region from the playing/paused dashcam frame,
// upscales it, and runs the pure pixel pipeline (contrast → gamma → unsharp →
// invert/threshold) on every tick so obscure/blurry glyphs resolve in real time.
// Updates even while PAUSED (you pause on the best frame to read a plate). The
// latest enhanced canvas is handed up via onCanvas so the plate re-scan sends the
// exact image you see to OCR ("what you see is what gets read").
// ============================================================
import { useEffect, useRef } from 'react';
import { ScanSearch } from 'lucide-react';
import type { Box } from '../utils/drivingPrediction';
import { applyPipeline, type EnhancePipeline } from '../utils/imageEnhance';

export default function PlateMagnifier({
  videoRef, region, pipeline, plate, confidence, confirmed, upscale = 5, onCanvas,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  region: Box | null;                 // plate region in natural video px [x,y,w,h]
  pipeline: EnhancePipeline;
  plate: string | null;
  confidence: number | null;
  confirmed: boolean;
  upscale?: number;
  onCanvas?: (c: HTMLCanvasElement) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  // Keep the latest props in refs so the rAF loop (started once) never goes stale.
  const stateRef = useRef({ region, pipeline, upscale, onCanvas });
  stateRef.current = { region, pipeline, upscale, onCanvas };

  useEffect(() => {
    let last = 0;
    const TICK_MS = 120;               // ~8 fps — plenty for reading, easy on the CPU
    const draw = (ts: number) => {
      rafRef.current = requestAnimationFrame(draw);
      if (ts - last < TICK_MS) return;
      last = ts;
      const v = videoRef.current, canvas = canvasRef.current;
      const { region: reg, pipeline: pipe, upscale: up, onCanvas: cb } = stateRef.current;
      if (!v || !canvas || !reg || v.readyState < 2 || !v.videoWidth) return;
      const [rx, ry, rw, rh] = reg;
      if (rw < 2 || rh < 2) return;
      const dw = Math.max(2, Math.round(rw * up)), dh = Math.max(2, Math.round(rh * up));
      if (canvas.width !== dw) canvas.width = dw;
      if (canvas.height !== dh) canvas.height = dh;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      (ctx as any).imageSmoothingQuality = 'high';
      try {
        ctx.drawImage(v, rx, ry, rw, rh, 0, 0, dw, dh);
      } catch { return; }              // not painted yet / transient decode error
      try {
        const img = ctx.getImageData(0, 0, dw, dh);
        applyPipeline(img.data, dw, dh, pipe);
        ctx.putImageData(img, 0, 0);
        cb?.(canvas);                   // expose the enhanced frame for OCR
      } catch {
        // Tainted canvas (cross-origin) — leave the un-enhanced magnified draw up.
      }
    };
    rafRef.current = requestAnimationFrame(draw);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); rafRef.current = null; };
  }, [videoRef]);

  const col = confirmed ? '#22d3ee' : '#f59e0b';
  return (
    <div className="absolute bottom-16 right-3 w-[230px] bg-black/85 border" style={{ borderColor: col }}>
      <div className="flex items-center justify-between px-1.5 py-0.5 border-b" style={{ borderColor: col }}>
        <span className="flex items-center gap-1 text-[9px] font-bold tracking-wider" style={{ color: col }}>
          <ScanSearch className="w-3 h-3" /> PLATE MAGNIFIER
        </span>
        {confidence != null && <span className="text-[8px] font-mono text-rmpg-300">{Math.round(confidence * 100)}% trust</span>}
      </div>
      <canvas ref={canvasRef} className="block w-full" style={{ imageRendering: 'pixelated', aspectRatio: '3 / 1', background: '#000' }} />
      <div className="px-1.5 py-0.5 text-center font-mono tracking-[0.2em] text-sm" style={{ color: col }}>
        {plate ? (confirmed ? plate : `? ${plate}`) : '— — —'}
      </div>
      {plate && !confirmed && (
        <div className="px-1.5 pb-0.5 text-center text-[8px] font-bold tracking-wider text-amber-400">UNCONFIRMED · NEEDS REVIEW</div>
      )}
    </div>
  );
}
