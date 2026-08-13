import React, { useState, useRef, useCallback, useEffect } from 'react';
import { X, Scissors, Copy, Save, RotateCcw } from 'lucide-react';
import { useDraggablePosition } from '../../../hooks/useDraggablePosition';

interface DesktopSnippingToolProps {
  onClose: () => void;
}

type Mode = 'idle' | 'selecting' | 'preview';

interface Rect { x: number; y: number; w: number; h: number }

const W = 480;
const H = 360;

export default function DesktopSnippingTool({ onClose }: DesktopSnippingToolProps) {
  const [pos, setPos] = useState({ x: Math.max(0, (window.innerWidth - W) / 2), y: Math.max(0, (window.innerHeight - H) / 4) });
  const { onPointerDown } = useDraggablePosition(pos.x, pos.y, (x, y) => setPos({ x, y }));
  const [mode, setMode] = useState<Mode>('idle');
  const [capturedUrl, setCapturedUrl] = useState<string | null>(null);
  const [status, setStatus] = useState('');

  const overlayRef = useRef<HTMLDivElement>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const selRef = useRef<HTMLDivElement | null>(null);

  const startCapture = useCallback(() => {
    setMode('selecting');
  }, []);

  const finishCapture = useCallback(async (rect: Rect) => {
    setMode('idle');
    if (rect.w < 4 || rect.h < 4) { setStatus('Selection too small'); return; }

    setStatus('Capturing…');
    try {
      // Use html2canvas if available (loaded from window); fallback to placeholder
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const h2c = (window as any).html2canvas;
      if (h2c) {
        const canvas = await h2c(document.body, {
          x: rect.x + window.scrollX,
          y: rect.y + window.scrollY,
          width: rect.w,
          height: rect.h,
          useCORS: true,
          allowTaint: true,
        });
        setCapturedUrl(canvas.toDataURL('image/png'));
        setStatus('');
        setMode('preview');
      } else {
        // Fallback: plain canvas filled with a placeholder message
        const canvas = document.createElement('canvas');
        canvas.width = rect.w;
        canvas.height = rect.h;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#1a2a3a';
        ctx.fillRect(0, 0, rect.w, rect.h);
        ctx.strokeStyle = '#4a9eff';
        ctx.lineWidth = 2;
        ctx.strokeRect(1, 1, rect.w - 2, rect.h - 2);
        ctx.fillStyle = '#aab8c8';
        ctx.font = '12px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`Snip (${rect.w}×${rect.h})`, rect.w / 2, rect.h / 2 - 8);
        ctx.font = '10px monospace';
        ctx.fillText('html2canvas not loaded', rect.w / 2, rect.h / 2 + 10);
        setCapturedUrl(canvas.toDataURL('image/png'));
        setStatus('');
        setMode('preview');
      }
    } catch (e) {
      setStatus('Capture failed');
      setMode('idle');
    }
  }, []);

  // Overlay pointer events for drag selection
  useEffect(() => {
    if (mode !== 'selecting') return;
    const overlay = overlayRef.current;
    if (!overlay) return;

    const onDown = (e: PointerEvent) => {
      startRef.current = { x: e.clientX, y: e.clientY };
      if (selRef.current) {
        Object.assign(selRef.current.style, { display: 'block', left: `${e.clientX}px`, top: `${e.clientY}px`, width: '0', height: '0' });
      }
    };
    const onMove = (e: PointerEvent) => {
      if (!startRef.current || !selRef.current) return;
      const x = Math.min(e.clientX, startRef.current.x);
      const y = Math.min(e.clientY, startRef.current.y);
      const w = Math.abs(e.clientX - startRef.current.x);
      const h = Math.abs(e.clientY - startRef.current.y);
      Object.assign(selRef.current.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
    };
    const onUp = (e: PointerEvent) => {
      if (!startRef.current) return;
      const rect: Rect = {
        x: Math.min(e.clientX, startRef.current.x),
        y: Math.min(e.clientY, startRef.current.y),
        w: Math.abs(e.clientX - startRef.current.x),
        h: Math.abs(e.clientY - startRef.current.y),
      };
      startRef.current = null;
      finishCapture(rect);
    };
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') { setMode('idle'); } };

    overlay.addEventListener('pointerdown', onDown);
    overlay.addEventListener('pointermove', onMove);
    overlay.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      overlay.removeEventListener('pointerdown', onDown);
      overlay.removeEventListener('pointermove', onMove);
      overlay.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [mode, finishCapture]);

  const copyToClipboard = useCallback(async () => {
    if (!capturedUrl) return;
    try {
      const res = await fetch(capturedUrl);
      const blob = await res.blob();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      setStatus('Copied to clipboard');
      setTimeout(() => setStatus(''), 2000);
    } catch { setStatus('Copy failed'); }
  }, [capturedUrl]);

  const saveToDownloads = useCallback(() => {
    if (!capturedUrl) return;
    const a = document.createElement('a');
    a.href = capturedUrl;
    a.download = `snip-${Date.now()}.png`;
    a.click();
    setStatus('Saved');
    setTimeout(() => setStatus(''), 2000);
  }, [capturedUrl]);

  return (
    <>
      {/* Selection overlay */}
      {mode === 'selecting' && (
        <div
          ref={overlayRef}
          style={{ position: 'fixed', inset: 0, zIndex: 30000, background: 'rgba(0,0,0,0.45)', cursor: 'crosshair' }}
        >
          <div
            ref={selRef}
            style={{ position: 'fixed', border: '2px solid #4a9eff', background: 'rgba(74,158,255,0.08)', display: 'none', pointerEvents: 'none' }}
          />
          <div style={{ position: 'fixed', top: 12, left: '50%', transform: 'translateX(-50%)', background: 'rgba(0,0,0,0.7)', color: '#fff', padding: '4px 16px', borderRadius: 2, fontSize: 12 }}>
            Drag to select area &nbsp; <kbd style={{ opacity: 0.7 }}>Esc</kbd> to cancel
          </div>
        </div>
      )}

      {/* Tool panel */}
      <div style={{
        position: 'fixed', left: pos.x, top: pos.y, width: W, height: H,
        background: 'var(--surface-raised)', border: '1px solid var(--border-default)',
        borderRadius: 2, boxShadow: '0 8px 32px rgba(0,0,0,0.45)', zIndex: 20100,
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* Title bar */}
        <div
          onPointerDown={onPointerDown}
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px', height: 32, background: 'var(--surface-sunken)', cursor: 'move', flexShrink: 0 }}
        >
          <Scissors size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-primary)', flex: 1 }}>Snipping Tool</span>
          <button aria-label="Close Snipping Tool" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}>
            <X size={14} />
          </button>
        </div>

        {/* Toolbar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: 'var(--surface-base)', borderBottom: '1px solid var(--border-default)', flexShrink: 0 }}>
          <button
            aria-label="New snip"
            onClick={startCapture}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 14px', background: 'var(--desktop-shell-accent, var(--accent-silver-400))', border: 'none', borderRadius: 2, cursor: 'pointer', fontSize: 11, color: 'var(--surface-sunken)', fontWeight: 700 }}
          >
            <Scissors size={12} /> New Snip
          </button>
          {mode === 'preview' && capturedUrl && (
            <>
              <button aria-label="Copy snip" onClick={copyToClipboard} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', background: 'none', border: '1px solid var(--border-default)', borderRadius: 2, cursor: 'pointer', fontSize: 11, color: 'var(--text-primary)' }}>
                <Copy size={11} /> Copy
              </button>
              <button aria-label="Save snip" onClick={saveToDownloads} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', background: 'none', border: '1px solid var(--border-default)', borderRadius: 2, cursor: 'pointer', fontSize: 11, color: 'var(--text-primary)' }}>
                <Save size={11} /> Save
              </button>
              <button aria-label="Clear snip" onClick={() => { setCapturedUrl(null); setMode('idle'); }} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', background: 'none', border: '1px solid var(--border-default)', borderRadius: 2, cursor: 'pointer', fontSize: 11, color: 'var(--text-muted)' }}>
                <RotateCcw size={11} />
              </button>
            </>
          )}
          {status && <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 'auto' }}>{status}</span>}
        </div>

        {/* Preview area */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'auto', background: 'var(--surface-base)', padding: 12 }}>
          {capturedUrl ? (
            <img src={capturedUrl} alt="Captured snip" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 2 }} />
          ) : (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
              <Scissors size={32} style={{ marginBottom: 12, opacity: 0.3 }} />
              <p style={{ fontSize: 12 }}>Click <strong>New Snip</strong> and drag a region to capture.</p>
              <p style={{ fontSize: 10, marginTop: 4 }}>Shortcut: Win + Shift + S</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
