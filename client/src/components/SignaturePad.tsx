import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Eraser, Check, X, Type, PenTool } from 'lucide-react';
import '../signatureFonts.css';

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

// Realistic, self-hosted handwriting fonts (see signatureFonts.css). `family`
// must match the @font-face family name exactly — canvas only renders the
// webfont once document.fonts.load() resolves for it.
const SIGNATURE_FONTS = [
  { name: 'Elegant',   family: 'Great Vibes',    size: 46, weight: 400 },
  { name: 'Flowing',   family: 'Dancing Script', size: 40, weight: 600 },
  { name: 'Casual',    family: 'Sacramento',     size: 44, weight: 400 },
  { name: 'Penned',    family: 'Homemade Apple', size: 30, weight: 400 },
  { name: 'Marker',    family: 'Caveat',         size: 44, weight: 600 },
];

const fontCss = (f: typeof SIGNATURE_FONTS[number], sizePx = f.size) =>
  `${f.weight} ${sizePx}px "${f.family}", cursive`;

// Fixed export resolution multiplier — the backing canvas is rendered at this
// scale so the exported PNG is crisp when placed on a PDF (a 400×150 pad
// exports at 1200×450). Independent of screen devicePixelRatio so output is
// deterministic across devices.
const RENDER_SCALE = 3;

// Stroke width envelope (in CSS px, before RENDER_SCALE).
const MIN_W = 0.7;
const MAX_W = 3.2;

interface StrokePoint { x: number; y: number; time: number; pressure: number; }

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
  const [mode, setMode] = useState<'draw' | 'type'>('draw');
  const [typedName, setTypedName] = useState('');
  const [selectedFont, setSelectedFont] = useState(0);
  const [fontsReady, setFontsReady] = useState(false);

  // Continuous-curve drawing state: previous raw point + previous midpoint.
  const lastPointRef = useRef<StrokePoint | null>(null);
  const lastMidRef = useRef<{ x: number; y: number } | null>(null);
  const lastWidthRef = useRef(2);
  const movedRef = useRef(false);

  // Canvas display dimensions (CSS px)
  const cW = compact ? 280 : width;
  const cH = compact ? 100 : height;

  // Configure the 2D context to draw in CSS-px coordinates on a
  // RENDER_SCALE-times-larger backing store (crisp export).
  const prepareCtx = useCallback((ctx: CanvasRenderingContext2D) => {
    ctx.setTransform(RENDER_SCALE, 0, 0, RENDER_SCALE, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#161616';
    ctx.fillStyle = '#161616';
  }, []);

  // Paint white background + the "X" signature baseline.
  const paintBackground = useCallback((ctx: CanvasRenderingContext2D) => {
    ctx.save();
    ctx.setTransform(RENDER_SCALE, 0, 0, RENDER_SCALE, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, cW, cH);
    ctx.strokeStyle = '#cccccc';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(20, cH - 25);
    ctx.lineTo(cW - 20, cH - 25);
    ctx.stroke();
    ctx.fillStyle = '#999999';
    ctx.font = '12px Helvetica, Arial, sans-serif';
    ctx.fillText('X', 10, cH - 28);
    ctx.restore();
  }, [cW, cH]);

  // Initialize / clear the drawing canvas.
  const initCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = Math.round(cW * RENDER_SCALE);
    canvas.height = Math.round(cH * RENDER_SCALE);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    paintBackground(ctx);
    prepareCtx(ctx);
    lastWidthRef.current = 2;
    lastPointRef.current = null;
    lastMidRef.current = null;
    setHasContent(false);
  }, [cW, cH, paintBackground, prepareCtx]);

  useEffect(() => {
    if (showPad && mode === 'draw') {
      const t = setTimeout(initCanvas, 50);
      return () => clearTimeout(t);
    }
  }, [showPad, mode, initCanvas]);

  // Preload the handwriting fonts when the Type tab opens so the live preview
  // and the exported canvas both render the real glyphs (not a fallback).
  useEffect(() => {
    if (!showPad || mode !== 'type') return;
    let cancelled = false;
    Promise.all(
      SIGNATURE_FONTS.map(f => document.fonts.load(`${f.weight} ${f.size}px "${f.family}"`, 'Signature')),
    )
      .then(() => { if (!cancelled) setFontsReady(true); })
      .catch(() => { if (!cancelled) setFontsReady(true); });
    return () => { cancelled = true; };
  }, [showPad, mode]);

  // Map a pointer event to a canvas point in CSS-px coordinates (+ pressure).
  const getPoint = (e: React.PointerEvent): StrokePoint => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0, time: Date.now(), pressure: 0.5 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = cW / rect.width;
    const scaleY = cH / rect.height;
    // Pen reports a real 0–1 pressure; mouse/touch report 0 or 0.5 → treat as neutral.
    const usePressure = e.pointerType === 'pen' && e.pressure > 0;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
      time: Date.now(),
      pressure: usePressure ? e.pressure : 0.5,
    };
  };

  // Compute stroke width: real pen pressure when available, otherwise velocity
  // (fast → thin, slow → thick). Smoothed against the previous width so the
  // line tapers naturally instead of jumping.
  const widthFor = (prev: StrokePoint, pt: StrokePoint): number => {
    let target: number;
    if (pt.pressure !== 0.5) {
      target = MIN_W + (MAX_W - MIN_W) * pt.pressure;
    } else {
      const dx = pt.x - prev.x;
      const dy = pt.y - prev.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const dt = Math.max(1, pt.time - prev.time);
      const velocity = dist / dt; // px/ms
      target = Math.max(MIN_W, Math.min(MAX_W, MAX_W - velocity * 2.2));
    }
    const smooth = lastWidthRef.current * 0.55 + target * 0.45;
    lastWidthRef.current = smooth;
    return smooth;
  };

  // Draw one continuous quadratic segment: previous midpoint → current
  // midpoint, using the previous raw point as the control. This connects the
  // FULL span between samples (the old code drew only last→midpoint, leaving
  // the midpoint→point half blank, which is what produced the dashed look).
  const drawSegment = (ctx: CanvasRenderingContext2D, prev: StrokePoint, pt: StrokePoint) => {
    const mid = { x: (prev.x + pt.x) / 2, y: (prev.y + pt.y) / 2 };
    const startMid = lastMidRef.current ?? prev;
    ctx.beginPath();
    ctx.moveTo(startMid.x, startMid.y);
    ctx.quadraticCurveTo(prev.x, prev.y, mid.x, mid.y);
    ctx.lineWidth = widthFor(prev, pt);
    ctx.stroke();
    lastMidRef.current = mid;
  };

  const startDraw = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setIsDrawing(true);
    movedRef.current = false;
    const pt = getPoint(e);
    lastPointRef.current = pt;
    lastMidRef.current = { x: pt.x, y: pt.y };
    lastWidthRef.current = MIN_W + (MAX_W - MIN_W) * 0.5;
  };

  const draw = (e: React.PointerEvent) => {
    if (!isDrawing) return;
    e.preventDefault();
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;

    // High-frequency intermediate points between animation frames → smoother ink.
    const native = e.nativeEvent as PointerEvent;
    const events: PointerEvent[] = native.getCoalescedEvents?.().length
      ? native.getCoalescedEvents()
      : [native];

    for (const ev of events) {
      const prev = lastPointRef.current;
      if (!prev) break;
      const rect = canvasRef.current!.getBoundingClientRect();
      const usePressure = ev.pointerType === 'pen' && ev.pressure > 0;
      const pt: StrokePoint = {
        x: (ev.clientX - rect.left) * (cW / rect.width),
        y: (ev.clientY - rect.top) * (cH / rect.height),
        time: Date.now(),
        pressure: usePressure ? ev.pressure : 0.5,
      };
      const dx = pt.x - prev.x;
      const dy = pt.y - prev.y;
      if (dx * dx + dy * dy < 0.05) continue; // skip jitter / duplicate samples
      drawSegment(ctx, prev, pt);
      lastPointRef.current = pt;
      movedRef.current = true;
    }
    setHasContent(true);
  };

  const endDraw = (e: React.PointerEvent) => {
    if (!isDrawing) return;
    // A tap with no movement should leave a dot, not nothing.
    if (!movedRef.current) {
      const ctx = canvasRef.current?.getContext('2d');
      const p = lastPointRef.current;
      if (ctx && p) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, MIN_W + 0.6, 0, Math.PI * 2);
        ctx.fill();
        setHasContent(true);
      }
    }
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    setIsDrawing(false);
    lastPointRef.current = null;
    lastMidRef.current = null;
  };

  const handleClear = () => {
    if (mode === 'type') setTypedName('');
    else initCanvas();
  };

  // Render the typed signature onto a hi-res offscreen canvas and export PNG.
  // Awaits the active font so canvas never falls back to a generic face.
  const renderTypedSignature = useCallback(async (): Promise<string | null> => {
    const f = SIGNATURE_FONTS[selectedFont];
    try {
      await document.fonts.load(`${f.weight} ${f.size}px "${f.family}"`, typedName || 'Signature');
    } catch { /* fall through — swap face if not ready */ }

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(cW * RENDER_SCALE);
    canvas.height = Math.round(cH * RENDER_SCALE);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.setTransform(RENDER_SCALE, 0, 0, RENDER_SCALE, 0, 0);

    // White background + baseline.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, cW, cH);
    ctx.strokeStyle = '#cccccc';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(20, cH - 25);
    ctx.lineTo(cW - 20, cH - 25);
    ctx.stroke();

    // Typed name, auto-scaled to fit and centered on the baseline.
    ctx.fillStyle = '#161616';
    ctx.font = fontCss(f);
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'center';
    const textWidth = ctx.measureText(typedName).width || 1;
    const maxWidth = cW - 50;
    const scale = textWidth > maxWidth ? maxWidth / textWidth : 1;

    ctx.save();
    ctx.translate(cW / 2, cH - 30);
    ctx.scale(scale, scale);
    ctx.fillText(typedName, 0, 0);
    ctx.restore();

    return canvas.toDataURL('image/png');
  }, [typedName, selectedFont, cW, cH]);

  const handleSave = async () => {
    if (mode === 'type') {
      if (!typedName.trim()) return;
      const dataUrl = await renderTypedSignature();
      if (dataUrl) {
        onChange(dataUrl);
        setShowPad(false);
        setTypedName('');
      }
    } else {
      const canvas = canvasRef.current;
      if (!canvas || !hasContent) return;
      onChange(canvas.toDataURL('image/png'));
      setShowPad(false);
    }
  };

  const handleRemove = () => {
    onChange(null);
    setShowPad(false);
  };

  const canSave = mode === 'type' ? typedName.trim().length > 0 : hasContent;

  // If we have a value, show the saved signature with edit option
  if (value && !showPad) {
    return (
      <div className="space-y-1">
        <label className="block text-xs font-semibold text-rmpg-300 uppercase">{label}</label>
        <div className="relative bg-white rounded-sm border border-rmpg-600 p-2 inline-block">
          <img src={value} alt="Signature" className="max-h-16 object-contain" />
          <div className="absolute top-1 right-1 flex gap-1">
            {/* 65: Re-sign button with transition */}
            <button
              type="button"
              onClick={() => setShowPad(true)}
              className="text-[10px] px-1.5 py-0.5 bg-brand-700 text-white rounded-sm hover:bg-brand-600 active:bg-brand-500 transition-colors"
            >
              Re-sign
            </button>
            {/* 66: Remove button with active state and transition */}
            <button
              type="button"
              onClick={handleRemove}
              className="text-[10px] px-1.5 py-0.5 bg-red-700 text-white rounded-sm hover:bg-red-600 active:bg-red-500 transition-colors"
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
        <label className="block text-xs font-semibold text-rmpg-300 uppercase" style={{ letterSpacing: '0.06em' }}>{label}</label>
        <button
          type="button"
          onClick={() => setShowPad(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-brand-800 text-brand-200 border border-brand-600 rounded-sm hover:bg-brand-700 active:bg-brand-600 focus-visible:ring-1 focus-visible:ring-brand-400 focus-visible:outline-none transition-colors duration-150"
        >
          <PenTool className="w-3 h-3" /> Sign Document
        </button>
      </div>
    );
  }

  // Drawing / typing pad
  return (
    <div className="space-y-1">
      <label className="block text-xs font-semibold text-rmpg-300 uppercase">{label}</label>
      {/* 48: Signature pad container with top accent */}
      <div className="bg-rmpg-800 border border-rmpg-600 rounded-sm p-2 inline-block" style={{ borderTop: '2px solid #888888' }}>
        {/* 49: Mode toggle tabs with improved active state contrast */}
        <div className="flex gap-1 mb-2">
          <button
            type="button"
            onClick={() => setMode('draw')}
            className={`flex items-center gap-1 px-2.5 py-1 text-[10px] font-semibold rounded-sm transition-all duration-150 ${
              mode === 'draw'
                ? 'bg-brand-700 text-white shadow-sm'
                : 'bg-rmpg-700 text-rmpg-300 hover:bg-rmpg-600 hover:text-rmpg-200'
            }`}
          >
            <PenTool className="w-3 h-3" /> Draw
          </button>
          <button
            type="button"
            onClick={() => setMode('type')}
            className={`flex items-center gap-1 px-2.5 py-1 text-[10px] font-semibold rounded-sm transition-all duration-150 ${
              mode === 'type'
                ? 'bg-brand-700 text-white shadow-sm'
                : 'bg-rmpg-700 text-rmpg-300 hover:bg-rmpg-600 hover:text-rmpg-200'
            }`}
          >
            <Type className="w-3 h-3" /> Type
          </button>
        </div>

        {mode === 'draw' ? (
          /* Drawing canvas — pointer events unify mouse/touch/pen + pressure */
          <canvas
            ref={canvasRef}
            aria-label="Signature drawing area"
            className="bg-white rounded-sm cursor-crosshair touch-none select-none"
            style={{ width: cW, height: cH }}
            onPointerDown={startDraw}
            onPointerMove={draw}
            onPointerUp={endDraw}
            onPointerLeave={endDraw}
            onPointerCancel={endDraw}
          />
        ) : (
          /* Typed signature mode */
          <div
            className="bg-white rounded-sm flex flex-col items-center justify-center"
            style={{ width: cW, height: cH }}
          >
            {/* Preview of typed signature */}
            <div className="flex-1 flex items-end justify-center w-full px-4 pb-1 overflow-hidden">
              <span
                className="text-center truncate max-w-full leading-none"
                style={{
                  font: fontCss(SIGNATURE_FONTS[selectedFont], typedName.length > 18 ? 30 : SIGNATURE_FONTS[selectedFont].size),
                  color: '#161616',
                  opacity: fontsReady ? 1 : 0.4,
                }}
              >
                {typedName || ' '}
              </span>
            </div>
            {/* Signature line */}
            <div className="w-full px-4 mb-4">
              <div style={{ borderTop: '1px solid #ccc' }} />
            </div>
            {/* Input field */}
            <input id="ff-signaturepad-0"
              type="text"
              value={typedName}
              onChange={(e) => setTypedName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && typedName.trim()) handleSave(); }}
              placeholder="Type your full name"
              className="w-[90%] mb-2 px-2 py-1 text-sm border border-rmpg-600 rounded-sm text-rmpg-800 bg-white focus:outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-500"
              autoFocus
            />
            {/* Font selector */}
            <div className="flex gap-1 mb-1 flex-wrap justify-center">
              {SIGNATURE_FONTS.map((f, i) => (
                <button
                  key={f.name}
                  type="button"
                  onClick={() => setSelectedFont(i)}
                  style={{ fontFamily: `"${f.family}", cursive` }}
                  className={`px-2 py-0.5 text-[13px] leading-none rounded-sm transition-colors ${
                    selectedFont === i
                      ? 'bg-gray-100 border border-gray-400 text-gray-800'
                      : 'bg-rmpg-800 border border-rmpg-600 text-rmpg-300 hover:bg-rmpg-700'
                  }`}
                  title={f.name}
                >
                  {f.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 50: Action buttons with improved spacing and transition effects */}
        <div className="flex items-center gap-2 mt-2 pt-2 border-t border-rmpg-700/50">
          <button
            type="button"
            onClick={handleClear}
            className="flex items-center gap-1 px-2.5 py-1 text-xs bg-rmpg-700 text-rmpg-200 rounded-sm hover:bg-rmpg-600 transition-colors duration-150"
          >
            <Eraser className="w-3 h-3" /> Clear
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            className="flex items-center gap-1 px-3 py-1 text-xs font-semibold bg-green-800 text-green-200 rounded-sm hover:bg-green-700 active:bg-green-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-150"
          >
            <Check className="w-3 h-3" /> Apply Signature
          </button>
          <button
            type="button"
            onClick={() => { setShowPad(false); setTypedName(''); }}
            className="flex items-center gap-1 px-2.5 py-1 text-xs bg-rmpg-700 text-rmpg-300 rounded-sm hover:bg-rmpg-600 transition-colors duration-150 ml-auto"
          >
            <X className="w-3 h-3" /> Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
