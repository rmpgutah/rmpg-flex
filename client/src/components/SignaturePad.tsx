import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Eraser, Check, X } from 'lucide-react';

interface SignaturePadProps {
  /** Current signature data URL (PNG base64) or null */
  value?: string | null;
  /** Called when user saves or clears the signature */
  onChange: (dataUrl: string | null) => void;
  /** Width of the canvas */
  width?: number;
  /** Height of the canvas */
  height?: number;
  /** Label above the pad */
  label?: string;
  /** Compact mode — smaller canvas, inline layout */
  compact?: boolean;
}

export default function SignaturePad({
  value,
  onChange,
  width = 400,
  height = 150,
  label = 'Digital Signature',
  compact = false,
}: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasContent, setHasContent] = useState(false);
  const [showPad, setShowPad] = useState(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);

  // Canvas dimensions for compact mode
  const cW = compact ? 280 : width;
  const cH = compact ? 100 : height;

  // Initialize canvas with white background
  const initCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // Signature line
    ctx.strokeStyle = '#cccccc';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(20, canvas.height - 25);
    ctx.lineTo(canvas.width - 20, canvas.height - 25);
    ctx.stroke();
    // "X" marker
    ctx.fillStyle = '#999999';
    ctx.font = '12px Helvetica';
    ctx.fillText('X', 10, canvas.height - 28);
    // Reset for drawing
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    setHasContent(false);
  }, []);

  useEffect(() => {
    if (showPad) {
      setTimeout(initCanvas, 50);
    }
  }, [showPad, initCanvas]);

  const getPoint = (e: React.MouseEvent | React.TouchEvent): { x: number; y: number } => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    if ('touches' in e) {
      const touch = e.touches[0];
      return {
        x: (touch.clientX - rect.left) * scaleX,
        y: (touch.clientY - rect.top) * scaleY,
      };
    }
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const startDraw = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    setIsDrawing(true);
    const pt = getPoint(e);
    lastPointRef.current = pt;
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) {
      ctx.beginPath();
      ctx.moveTo(pt.x, pt.y);
    }
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing) return;
    e.preventDefault();
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const pt = getPoint(e);
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    ctx.lineTo(pt.x, pt.y);
    ctx.stroke();
    lastPointRef.current = pt;
    setHasContent(true);
  };

  const endDraw = () => {
    setIsDrawing(false);
    lastPointRef.current = null;
  };

  const handleClear = () => {
    initCanvas();
  };

  const handleSave = () => {
    const canvas = canvasRef.current;
    if (!canvas || !hasContent) return;
    const dataUrl = canvas.toDataURL('image/png');
    onChange(dataUrl);
    setShowPad(false);
  };

  const handleRemove = () => {
    onChange(null);
    setShowPad(false);
  };

  // If we have a value, show the saved signature with edit option
  if (value && !showPad) {
    return (
      <div className="space-y-1">
        <label className="block text-xs font-semibold text-rmpg-300 uppercase">{label}</label>
        <div className="relative bg-white rounded border border-rmpg-600 p-2 inline-block">
          <img src={value} alt="Signature" className="max-h-16 object-contain" />
          <div className="absolute top-1 right-1 flex gap-1">
            <button
              type="button"
              onClick={() => setShowPad(true)}
              className="text-[10px] px-1.5 py-0.5 bg-brand-700 text-white rounded hover:bg-brand-600"
            >
              Re-sign
            </button>
            <button
              type="button"
              onClick={handleRemove}
              className="text-[10px] px-1.5 py-0.5 bg-red-700 text-white rounded hover:bg-red-600"
            >
              Remove
            </button>
          </div>
        </div>
      </div>
    );
  }

  // No value — show "Sign" button or the pad
  if (!showPad) {
    return (
      <div className="space-y-1">
        <label className="block text-xs font-semibold text-rmpg-300 uppercase">{label}</label>
        <button
          type="button"
          onClick={() => setShowPad(true)}
          className="px-3 py-1.5 text-xs font-semibold bg-brand-800 text-brand-200 border border-brand-600 rounded hover:bg-brand-700 transition-colors"
        >
          Sign Document
        </button>
      </div>
    );
  }

  // Drawing pad
  return (
    <div className="space-y-1">
      <label className="block text-xs font-semibold text-rmpg-300 uppercase">{label}</label>
      <div className="bg-rmpg-800 border border-rmpg-600 rounded p-2 inline-block">
        <canvas
          ref={canvasRef}
          width={cW}
          height={cH}
          className="bg-white rounded cursor-crosshair touch-none"
          style={{ width: cW, height: cH }}
          onMouseDown={startDraw}
          onMouseMove={draw}
          onMouseUp={endDraw}
          onMouseLeave={endDraw}
          onTouchStart={startDraw}
          onTouchMove={draw}
          onTouchEnd={endDraw}
        />
        <div className="flex items-center gap-2 mt-2">
          <button
            type="button"
            onClick={handleClear}
            className="flex items-center gap-1 px-2 py-1 text-xs bg-rmpg-700 text-rmpg-200 rounded hover:bg-rmpg-600"
          >
            <Eraser className="w-3 h-3" /> Clear
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!hasContent}
            className="flex items-center gap-1 px-2 py-1 text-xs bg-green-800 text-green-200 rounded hover:bg-green-700 disabled:opacity-40"
          >
            <Check className="w-3 h-3" /> Apply
          </button>
          <button
            type="button"
            onClick={() => setShowPad(false)}
            className="flex items-center gap-1 px-2 py-1 text-xs bg-rmpg-700 text-rmpg-300 rounded hover:bg-rmpg-600"
          >
            <X className="w-3 h-3" /> Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
