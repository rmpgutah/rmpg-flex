// ============================================================
// RMPG Flex — Professional Digital Signature Pad
// Elegant canvas-based signature capture with smooth Bézier
// curves, velocity-based stroke width, and polished UI.
// ============================================================

import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Eraser, Check, X, PenLine } from 'lucide-react';

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
  width = 560,
  height = 200,
  label = 'Digital Signature',
  compact = false,
}: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasContent, setHasContent] = useState(false);
  const [showPad, setShowPad] = useState(false);
  const lastPointRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const pointsRef = useRef<{ x: number; y: number }[]>([]);
  const velocityRef = useRef(0);

  // Canvas dimensions — larger for natural handwriting
  const cW = compact ? 380 : width;
  const cH = compact ? 140 : height;

  // Stroke settings — velocity-responsive for natural feel
  const MIN_WIDTH = 1.0;
  const MAX_WIDTH = compact ? 3.0 : 3.5;
  const INK_COLOR = '#1a1a2e';

  // Initialize canvas with elegant signature field
  const initCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Crisp white background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Subtle guide line — professional dotted baseline
    const lineY = canvas.height - 32;
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = '#c0c8d0';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(28, lineY);
    ctx.lineTo(canvas.width - 28, lineY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Refined "✕" marker at baseline start
    ctx.fillStyle = '#9ca3af';
    ctx.font = `${compact ? '11px' : '13px'} "Segoe UI", system-ui, sans-serif`;
    ctx.fillText('✕', 12, lineY + 1);

    // Subtle label below the line
    ctx.fillStyle = '#b0b8c4';
    ctx.font = `${compact ? '8px' : '9px'} "Segoe UI", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('SIGN ABOVE', canvas.width / 2, canvas.height - 10);
    ctx.textAlign = 'start';

    // Reset for drawing
    ctx.strokeStyle = INK_COLOR;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    setHasContent(false);
    velocityRef.current = 0;
    pointsRef.current = [];
  }, [compact, cW, cH, INK_COLOR]);

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

  // Track previous midpoint for continuous path drawing
  const lastMidRef = useRef<{ x: number; y: number } | null>(null);

  // Calculate velocity-responsive stroke width
  const getStrokeWidth = (velocity: number): number => {
    // Higher velocity = thinner stroke (like a real pen)
    const v = Math.min(velocity, 6);
    const width = MAX_WIDTH - (v / 6) * (MAX_WIDTH - MIN_WIDTH);
    // Heavier smoothing for stable, gap-free strokes
    velocityRef.current = velocityRef.current * 0.7 + width * 0.3;
    return velocityRef.current;
  };

  // Draw a segment from one point to another (used for interpolation)
  const drawSegment = (
    ctx: CanvasRenderingContext2D,
    from: { x: number; y: number },
    ctrl: { x: number; y: number },
    to: { x: number; y: number },
    width: number,
  ) => {
    ctx.strokeStyle = INK_COLOR;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.quadraticCurveTo(ctrl.x, ctrl.y, to.x, to.y);
    ctx.stroke();
  };

  const startDraw = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    setIsDrawing(true);
    const pt = getPoint(e);
    lastPointRef.current = { ...pt, time: Date.now() };
    lastMidRef.current = null;
    pointsRef.current = [pt];
    velocityRef.current = MAX_WIDTH;

    // Draw a small dot at the start point (makes single taps visible)
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) {
      ctx.fillStyle = INK_COLOR;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, MAX_WIDTH * 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing) return;
    e.preventDefault();
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const pt = getPoint(e);
    const last = lastPointRef.current;
    if (!last) return;

    // Calculate velocity from distance and time
    const dx = pt.x - last.x;
    const dy = pt.y - last.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const dt = Math.max(Date.now() - last.time, 1);
    const velocity = dist / dt * 10;
    const strokeWidth = getStrokeWidth(velocity);

    // Current midpoint between last raw point and current
    const mid = { x: (last.x + pt.x) / 2, y: (last.y + pt.y) / 2 };

    if (lastMidRef.current) {
      // Draw continuous curve: from previous midpoint → through last point → to current midpoint
      // This creates seamless connections between segments
      drawSegment(ctx, lastMidRef.current, { x: last.x, y: last.y }, mid, strokeWidth);
    } else {
      // First segment: draw from raw last point to current midpoint
      drawSegment(ctx, { x: last.x, y: last.y }, { x: last.x, y: last.y }, mid, strokeWidth);
    }

    // If distance is very large (fast swipe), interpolate intermediate points
    if (dist > 25) {
      const steps = Math.ceil(dist / 12);
      for (let i = 1; i < steps; i++) {
        const t = i / steps;
        const ix = last.x + dx * t;
        const iy = last.y + dy * t;
        ctx.fillStyle = INK_COLOR;
        ctx.beginPath();
        ctx.arc(ix, iy, strokeWidth * 0.45, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    lastMidRef.current = mid;
    lastPointRef.current = { ...pt, time: Date.now() };
    pointsRef.current.push(pt);
    setHasContent(true);
  };

  const endDraw = () => {
    if (isDrawing && lastPointRef.current && lastMidRef.current) {
      // Draw final segment from last midpoint to actual last point
      const ctx = canvasRef.current?.getContext('2d');
      if (ctx) {
        const last = lastPointRef.current;
        drawSegment(ctx, lastMidRef.current, { x: last.x, y: last.y }, { x: last.x, y: last.y }, velocityRef.current);
      }
    }
    setIsDrawing(false);
    lastPointRef.current = null;
    lastMidRef.current = null;
    pointsRef.current = [];
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

  // ── Saved signature display ──────────────────────────────
  if (value && !showPad) {
    return (
      <div className="space-y-1.5">
        <label className="block text-xs font-semibold text-rmpg-300 uppercase tracking-wider">{label}</label>
        <div
          className="relative border overflow-hidden"
          style={{
            background: '#ffffff',
            borderColor: '#2a3e58',
            borderRadius: '2px',
            maxWidth: compact ? 320 : 480,
          }}
        >
          <div className="p-3 flex items-center justify-center" style={{ minHeight: compact ? 60 : 80 }}>
            <img src={value} alt="Signature" style={{ maxHeight: compact ? 56 : 72, objectFit: 'contain' }} />
          </div>
          {/* Signature line */}
          <div style={{ height: '1px', background: '#d0d8e0', margin: '0 16px' }} />
          <div className="flex items-center justify-between px-3 py-1.5" style={{ background: '#f8f9fa' }}>
            <span style={{ fontSize: '8px', color: '#9ca3af', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
              Digitally Signed
            </span>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => setShowPad(true)}
                className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold transition-colors"
                style={{
                  background: '#1a5a9e',
                  color: '#ffffff',
                  border: '1px solid #1a5a9e',
                  borderRadius: '2px',
                }}
              >
                <PenLine className="w-2.5 h-2.5" /> Re-sign
              </button>
              <button
                type="button"
                onClick={handleRemove}
                className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold transition-colors"
                style={{
                  background: 'transparent',
                  color: '#ef4444',
                  border: '1px solid #ef4444',
                  borderRadius: '2px',
                }}
              >
                <X className="w-2.5 h-2.5" /> Remove
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── "Sign" button — no signature yet ─────────────────────
  if (!showPad) {
    return (
      <div className="space-y-1.5">
        <label className="block text-xs font-semibold text-rmpg-300 uppercase tracking-wider">{label}</label>
        <button
          type="button"
          onClick={() => setShowPad(true)}
          className="flex items-center gap-2 px-4 py-2 text-xs font-bold uppercase tracking-wider transition-all"
          style={{
            background: 'linear-gradient(180deg, #1e6cb8 0%, #1a5a9e 100%)',
            color: '#ffffff',
            border: '1px solid #1a5a9e',
            borderBottomColor: '#14476e',
            borderRightColor: '#14476e',
            borderRadius: '2px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
          }}
        >
          <PenLine className="w-3.5 h-3.5" />
          Sign Document
        </button>
      </div>
    );
  }

  // ── Drawing pad — full professional canvas ───────────────
  return (
    <div className="space-y-2">
      <label className="block text-xs font-semibold text-rmpg-300 uppercase tracking-wider">{label}</label>
      <div
        className="border overflow-hidden"
        style={{
          background: '#141e2b',
          borderColor: '#3a5070',
          borderRadius: '2px',
          boxShadow: 'inset 0 1px 4px rgba(0,0,0,0.3), 0 2px 8px rgba(0,0,0,0.2)',
        }}
      >
        {/* Pad header */}
        <div
          className="flex items-center justify-between px-3 py-1.5"
          style={{
            background: 'linear-gradient(180deg, #1e2d40 0%, #182636 100%)',
            borderBottom: '1px solid #2a3e58',
          }}
        >
          <div className="flex items-center gap-1.5">
            <PenLine className="w-3 h-3 text-brand-400" />
            <span className="text-[10px] font-bold text-rmpg-200 uppercase tracking-widest">
              Signature Capture
            </span>
          </div>
          <span className="text-[9px] text-rmpg-500 italic">
            Draw your signature with mouse or touch
          </span>
        </div>

        {/* Canvas area with elegant border */}
        <div className="p-3">
          <div
            style={{
              border: '1px solid #e0e4e8',
              borderRadius: '2px',
              boxShadow: '0 1px 6px rgba(0,0,0,0.08)',
              overflow: 'hidden',
            }}
          >
            <canvas
              ref={canvasRef}
              width={cW}
              height={cH}
              className="touch-none"
              style={{
                width: '100%',
                height: 'auto',
                aspectRatio: `${cW} / ${cH}`,
                cursor: 'crosshair',
                background: '#ffffff',
                display: 'block',
              }}
              onMouseDown={startDraw}
              onMouseMove={draw}
              onMouseUp={endDraw}
              onMouseLeave={endDraw}
              onTouchStart={startDraw}
              onTouchMove={draw}
              onTouchEnd={endDraw}
            />
          </div>
        </div>

        {/* Action bar */}
        <div
          className="flex items-center justify-between px-3 py-2"
          style={{
            background: '#0d1520',
            borderTop: '1px solid #2a3e58',
          }}
        >
          <button
            type="button"
            onClick={handleClear}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold transition-colors"
            style={{
              background: '#1a2636',
              color: '#8899aa',
              border: '1px solid #2a3e58',
              borderRadius: '2px',
            }}
          >
            <Eraser className="w-3 h-3" /> Clear
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowPad(false)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold transition-colors"
              style={{
                background: '#1a2636',
                color: '#8899aa',
                border: '1px solid #2a3e58',
                borderRadius: '2px',
              }}
            >
              <X className="w-3 h-3" /> Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!hasContent}
              className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold uppercase tracking-wider transition-all"
              style={{
                background: hasContent
                  ? 'linear-gradient(180deg, #22c55e 0%, #16a34a 100%)'
                  : '#2a3636',
                color: hasContent ? '#ffffff' : '#5a6a6a',
                border: `1px solid ${hasContent ? '#16a34a' : '#2a3e3e'}`,
                borderBottomColor: hasContent ? '#15803d' : '#2a3e3e',
                borderRightColor: hasContent ? '#15803d' : '#2a3e3e',
                borderRadius: '2px',
                boxShadow: hasContent ? '0 1px 3px rgba(0,0,0,0.3)' : 'none',
                cursor: hasContent ? 'pointer' : 'not-allowed',
              }}
            >
              <Check className="w-3 h-3" /> Apply Signature
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
