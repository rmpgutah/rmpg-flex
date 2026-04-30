import { useEffect, useRef, useState } from 'react';
import { X, Eraser, Check } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
  onConfirm: (dataUrl: string) => void;
}

export default function SignaturePad({ open, onClose, onConfirm }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const lastRef = useRef<{ x: number; y: number } | null>(null);
  const [hasInk, setHasInk] = useState(false);

  useEffect(() => {
    if (!open) return;
    const c = canvasRef.current;
    if (!c) return;
    c.width = 600;
    c.height = 220;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.strokeStyle = '#0a0a0a';
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    setHasInk(false);
  }, [open]);

  if (!open) return null;

  const start = (x: number, y: number) => { drawingRef.current = true; lastRef.current = { x, y }; };
  const draw = (x: number, y: number) => {
    if (!drawingRef.current || !lastRef.current) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    ctx.beginPath();
    ctx.moveTo(lastRef.current.x, lastRef.current.y);
    ctx.lineTo(x, y);
    ctx.stroke();
    lastRef.current = { x, y };
    setHasInk(true);
  };
  const end = () => { drawingRef.current = false; lastRef.current = null; };

  const toCoords = (e: React.MouseEvent | React.TouchEvent) => {
    const c = canvasRef.current;
    if (!c) return { x: 0, y: 0 };
    const r = c.getBoundingClientRect();
    if ('touches' in e) {
      const t = e.touches[0] ?? e.changedTouches[0];
      return { x: ((t.clientX - r.left) / r.width) * c.width, y: ((t.clientY - r.top) / r.height) * c.height };
    }
    return { x: ((e.clientX - r.left) / r.width) * c.width, y: ((e.clientY - r.top) / r.height) * c.height };
  };

  const clear = () => {
    const c = canvasRef.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    setHasInk(false);
  };

  const confirm = () => {
    const c = canvasRef.current;
    if (!c) return;
    onConfirm(c.toDataURL('image/png'));
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[#141414] border border-[#222222] rounded-[2px] p-4 max-w-[680px] w-full" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-white">Draw signature</h3>
          <button type="button" onClick={onClose} className="p-1 text-rmpg-400 hover:text-white" aria-label="Close"><X className="w-4 h-4" /></button>
        </div>
        <p className="text-[10px] text-rmpg-500 mb-2">Sign with your mouse, trackpad, or touch screen. The signature is embedded as a PNG image.</p>
        <canvas
          ref={canvasRef}
          className="w-full bg-white border border-[#333] rounded-sm cursor-crosshair touch-none"
          onMouseDown={(e) => { const p = toCoords(e); start(p.x, p.y); }}
          onMouseMove={(e) => { const p = toCoords(e); draw(p.x, p.y); }}
          onMouseUp={end}
          onMouseLeave={end}
          onTouchStart={(e) => { e.preventDefault(); const p = toCoords(e); start(p.x, p.y); }}
          onTouchMove={(e) => { e.preventDefault(); const p = toCoords(e); draw(p.x, p.y); }}
          onTouchEnd={(e) => { e.preventDefault(); end(); }}
        />
        <div className="flex items-center justify-end gap-2 mt-3">
          <button type="button" onClick={clear} className="btn-secondary inline-flex items-center gap-1"><Eraser className="w-3.5 h-3.5" /> Clear</button>
          <button type="button" onClick={confirm} disabled={!hasInk} className="btn-primary inline-flex items-center gap-1 disabled:opacity-50"><Check className="w-3.5 h-3.5" /> Use signature</button>
        </div>
      </div>
    </div>
  );
}
