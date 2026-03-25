import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Eraser, Check, X, Type, PenTool } from 'lucide-react';

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

// Signature-style cursive fonts rendered via canvas
const SIGNATURE_FONTS = [
  { name: 'Brush Script', css: 'italic 36px "Brush Script MT", "Segoe Script", cursive' },
  { name: 'Cursive', css: 'italic 32px "Segoe Script", "Apple Chancery", cursive' },
  { name: 'Formal', css: '28px "Palatino Linotype", "Book Antiqua", Palatino, serif' },
  { name: 'Handwritten', css: 'italic 30px "Comic Sans MS", "Marker Felt", cursive' },
];

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
  const lastPointRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const lastWidthRef = useRef(2);

  // Canvas dimensions for compact mode
  const cW = compact ? 280 : width;
  const cH = compact ? 100 : height;

  // Initialize canvas with white background and signature line
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
    ctx.strokeStyle = '#1a1a4e';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    setHasContent(false);
    lastWidthRef.current = 2;
  }, []);

  useEffect(() => {
    if (showPad && mode === 'draw') {
      setTimeout(initCanvas, 50);
    }
  }, [showPad, mode, initCanvas]);

  const getPoint = (e: React.MouseEvent | React.TouchEvent): { x: number; y: number; time: number } => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0, time: Date.now() };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    if ('touches' in e) {
      const touch = e.touches[0];
      return {
        x: (touch.clientX - rect.left) * scaleX,
        y: (touch.clientY - rect.top) * scaleY,
        time: Date.now(),
      };
    }
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
      time: Date.now(),
    };
  };

  const startDraw = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    setIsDrawing(true);
    const pt = getPoint(e);
    lastPointRef.current = pt;
    lastWidthRef.current = 2;
  };

  // Velocity-based line width for natural pen feel
  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing) return;
    e.preventDefault();
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const pt = getPoint(e);
    const last = lastPointRef.current;
    if (!last) {
      lastPointRef.current = pt;
      return;
    }

    // Compute velocity (pixels per millisecond)
    const dx = pt.x - last.x;
    const dy = pt.y - last.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const dt = Math.max(1, pt.time - last.time);
    const velocity = dist / dt;

    // Map velocity to line width: fast strokes → thin, slow strokes → thick
    // Clamp between 0.8 and 4 pixels, smooth with previous width
    const targetWidth = Math.max(0.8, Math.min(4, 3.5 - velocity * 2.5));
    const smoothWidth = lastWidthRef.current * 0.6 + targetWidth * 0.4;
    lastWidthRef.current = smoothWidth;

    // Draw with quadratic bezier for smooth curves
    const midX = (last.x + pt.x) / 2;
    const midY = (last.y + pt.y) / 2;

    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.quadraticCurveTo(last.x, last.y, midX, midY);
    ctx.strokeStyle = '#1a1a4e';
    ctx.lineWidth = smoothWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();

    lastPointRef.current = pt;
    setHasContent(true);
  };

  const endDraw = () => {
    setIsDrawing(false);
    lastPointRef.current = null;
  };

  const handleClear = () => {
    if (mode === 'type') {
      setTypedName('');
    } else {
      initCanvas();
    }
  };

  // Render typed signature onto canvas and export as PNG
  const renderTypedSignature = useCallback((): string | null => {
    const canvas = document.createElement('canvas');
    canvas.width = cW;
    canvas.height = cH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // White background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Signature line
    ctx.strokeStyle = '#cccccc';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(20, canvas.height - 25);
    ctx.lineTo(canvas.width - 20, canvas.height - 25);
    ctx.stroke();

    // Render typed name
    ctx.fillStyle = '#1a1a4e';
    ctx.font = SIGNATURE_FONTS[selectedFont].css;
    ctx.textBaseline = 'bottom';

    // Center the text and auto-scale if too wide
    const textWidth = ctx.measureText(typedName).width;
    const maxWidth = canvas.width - 50;
    const scale = textWidth > maxWidth ? maxWidth / textWidth : 1;

    ctx.save();
    const x = canvas.width / 2;
    const y = canvas.height - 28;
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.fillText(typedName, -textWidth / 2, 0);
    ctx.restore();

    return canvas.toDataURL('image/png');
  }, [typedName, selectedFont, cW, cH]);

  const handleSave = () => {
    if (mode === 'type') {
      if (!typedName.trim()) return;
      const dataUrl = renderTypedSignature();
      if (dataUrl) {
        onChange(dataUrl);
        setShowPad(false);
        setTypedName('');
      }
    } else {
      const canvas = canvasRef.current;
      if (!canvas || !hasContent) return;
      const dataUrl = canvas.toDataURL('image/png');
      onChange(dataUrl);
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
            <button
              type="button"
              onClick={() => setShowPad(true)}
              className="text-[10px] px-1.5 py-0.5 bg-brand-700 text-white rounded-sm hover:bg-brand-600"
            >
              Re-sign
            </button>
            <button
              type="button"
              onClick={handleRemove}
              className="text-[10px] px-1.5 py-0.5 bg-red-700 text-white rounded-sm hover:bg-red-600"
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
          className="px-3 py-1.5 text-xs font-semibold bg-brand-800 text-brand-200 border border-brand-600 rounded-sm hover:bg-brand-700 transition-colors"
        >
          Sign Document
        </button>
      </div>
    );
  }

  // Drawing / typing pad
  return (
    <div className="space-y-1">
      <label className="block text-xs font-semibold text-rmpg-300 uppercase">{label}</label>
      <div className="bg-rmpg-800 border border-rmpg-600 rounded-sm p-2 inline-block">
        {/* Mode toggle tabs */}
        <div className="flex gap-1 mb-2">
          <button
            type="button"
            onClick={() => setMode('draw')}
            className={`flex items-center gap-1 px-2 py-1 text-[10px] font-semibold rounded-sm transition-colors ${
              mode === 'draw'
                ? 'bg-brand-700 text-white'
                : 'bg-rmpg-700 text-rmpg-300 hover:bg-rmpg-600'
            }`}
          >
            <PenTool className="w-3 h-3" /> Draw
          </button>
          <button
            type="button"
            onClick={() => setMode('type')}
            className={`flex items-center gap-1 px-2 py-1 text-[10px] font-semibold rounded-sm transition-colors ${
              mode === 'type'
                ? 'bg-brand-700 text-white'
                : 'bg-rmpg-700 text-rmpg-300 hover:bg-rmpg-600'
            }`}
          >
            <Type className="w-3 h-3" /> Type
          </button>
        </div>

        {mode === 'draw' ? (
          /* Drawing canvas */
          <canvas
            ref={canvasRef}
            width={cW}
            height={cH}
            aria-label="Signature drawing area"
            className="bg-white rounded-sm cursor-crosshair touch-none"
            style={{ width: cW, height: cH }}
            onMouseDown={startDraw}
            onMouseMove={draw}
            onMouseUp={endDraw}
            onMouseLeave={endDraw}
            onTouchStart={startDraw}
            onTouchMove={draw}
            onTouchEnd={endDraw}
          />
        ) : (
          /* Typed signature mode */
          <div
            className="bg-white rounded-sm flex flex-col items-center justify-center"
            style={{ width: cW, height: cH }}
          >
            {/* Preview of typed signature */}
            <div className="flex-1 flex items-end justify-center w-full px-4 pb-1">
              <span
                className="text-center truncate max-w-full"
                style={{
                  font: SIGNATURE_FONTS[selectedFont].css,
                  color: '#1a1a4e',
                  fontSize: typedName.length > 20 ? '22px' : undefined,
                }}
              >
                {typedName || '\u00A0'}
              </span>
            </div>
            {/* Signature line */}
            <div className="w-full px-4 mb-4">
              <div style={{ borderTop: '1px solid #ccc' }} />
            </div>
            {/* Input field */}
            <input
              type="text"
              value={typedName}
              onChange={(e) => setTypedName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && typedName.trim()) handleSave(); }}
              placeholder="Type your full name"
              className="w-[90%] mb-2 px-2 py-1 text-sm border border-rmpg-600 rounded-sm text-rmpg-800 bg-white focus:outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-500"
              autoFocus
            />
            {/* Font selector */}
            <div className="flex gap-1 mb-1">
              {SIGNATURE_FONTS.map((f, i) => (
                <button
                  key={f.name}
                  type="button"
                  onClick={() => setSelectedFont(i)}
                  className={`px-1.5 py-0.5 text-[9px] rounded-sm transition-colors ${
                    selectedFont === i
                      ? 'bg-blue-100 border border-blue-400 text-blue-700'
                      : 'bg-rmpg-800 border border-rmpg-600 text-rmpg-300 hover:bg-rmpg-700'
                  }`}
                >
                  {f.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-2 mt-2">
          <button
            type="button"
            onClick={handleClear}
            className="flex items-center gap-1 px-2 py-1 text-xs bg-rmpg-700 text-rmpg-200 rounded-sm hover:bg-rmpg-600"
          >
            <Eraser className="w-3 h-3" /> Clear
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            className="flex items-center gap-1 px-2 py-1 text-xs bg-green-800 text-green-200 rounded-sm hover:bg-green-700 disabled:opacity-40"
          >
            <Check className="w-3 h-3" /> Apply
          </button>
          <button
            type="button"
            onClick={() => { setShowPad(false); setTypedName(''); }}
            className="flex items-center gap-1 px-2 py-1 text-xs bg-rmpg-700 text-rmpg-300 rounded-sm hover:bg-rmpg-600"
          >
            <X className="w-3 h-3" /> Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
