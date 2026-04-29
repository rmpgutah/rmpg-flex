import { useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import { Annotation, PageCrop, PageMeta, Point, StampLabel, Tool, DEFAULT_RENDER_SCALE } from '../types';

interface Props {
  pdfBytes: Uint8Array | null;
  originalPageNumber: number;     // 0 = inserted blank
  visualPageNumber: number;       // 1-indexed in current order
  pageMeta: PageMeta;
  zoom: number;
  tool: Tool;
  color: string;
  strokeWidth: number;
  pendingImage: string | null;       // data URL for image/signature drop
  pendingStamp: StampLabel | string | null;
  annotations: Annotation[];
  activeId: string | null;
  onSelectAnnotation: (id: string | null) => void;
  onAddAnnotation: (a: Annotation) => void;
  onUpdateAnnotation: (id: string, patch: Partial<Annotation>) => void;
  onSetCrop?: (visualIdx: number, crop: PageCrop | null) => void;
}

function uid(): string { return Math.random().toString(36).slice(2, 10); }

export default function PageCanvas(props: Props) {
  const { pdfBytes, originalPageNumber, visualPageNumber, pageMeta, zoom, tool, color, strokeWidth, pendingImage, pendingStamp, annotations, activeId, onSelectAnnotation, onAddAnnotation, onUpdateAnnotation, onSetCrop } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const [drawing, setDrawing] = useState<{ tool: Tool; start: Point; current: Point; pen?: Point[] } | null>(null);
  const [drag, setDrag] = useState<{ id: string; offsetX: number; offsetY: number } | null>(null);

  // Render PDF page on mount + when bytes change.
  useEffect(() => {
    if (!pdfBytes || originalPageNumber === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const pdf = await pdfjs.getDocument({ data: pdfBytes.slice() }).promise;
        if (cancelled) return;
        const page = await pdf.getPage(originalPageNumber);
        const viewport = page.getViewport({ scale: DEFAULT_RENDER_SCALE });
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        await page.render({ canvasContext: ctx, viewport, canvas }).promise;

        // Build a transparent text layer so users can select / copy text
        // from the underlying PDF (huge UX win for inspecting witness
        // statements, evidence reports, etc.).
        const textLayer = textLayerRef.current;
        if (textLayer && !cancelled) {
          textLayer.replaceChildren();
          try {
            const textContent = await page.getTextContent();
            for (const item of textContent.items as Array<{ str: string; transform: number[]; width: number; height: number }>) {
              if (!item.str) continue;
              const tx = item.transform;
              const x = tx[4];
              const y = viewport.height - tx[5];
              const fontSize = Math.hypot(tx[2], tx[3]);
              const span = document.createElement('span');
              span.textContent = item.str;
              span.style.position = 'absolute';
              span.style.left = `${x}px`;
              span.style.top = `${y - fontSize}px`;
              span.style.fontSize = `${fontSize}px`;
              span.style.color = 'transparent';
              span.style.whiteSpace = 'pre';
              span.style.transformOrigin = '0 0';
              span.className = 'pdf-text-span';
              textLayer.appendChild(span);
            }
          } catch {
            // Image-only / scanned PDFs have no text content. That's expected.
          }
        }
      } catch (err) {
        console.error('Page render failed', err);
      }
    })();
    return () => { cancelled = true; };
  }, [pdfBytes, originalPageNumber]);

  const localCoords = (e: React.MouseEvent | React.PointerEvent): Point => {
    const r = overlayRef.current?.getBoundingClientRect();
    if (!r) return { x: 0, y: 0 };
    return { x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (tool === 'hand') return;
    const p = localCoords(e);

    // Click on empty area in select mode → deselect.
    if (tool === 'select') {
      onSelectAnnotation(null);
      return;
    }

    if (tool === 'text') {
      const text = window.prompt('Annotation text:', '');
      if (!text) return;
      onAddAnnotation({ id: uid(), type: 'text', page: visualPageNumber, x: p.x, y: p.y, w: 0, h: 0, text, fontSize: 14, color });
      return;
    }
    if (tool === 'link') {
      // Drag to draw the link bounds; finalize on pointer up via the same flow
      // as rect/highlight (handled below).
      setDrawing({ tool: 'link' as Tool, start: p, current: p });
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      return;
    }
    if (tool === 'crop') {
      setDrawing({ tool: 'crop' as Tool, start: p, current: p });
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      return;
    }
    if (tool === 'image' || tool === 'signature' || tool === 'barcode') {
      if (!pendingImage) return;
      // Default sizing — barcode tool can override via the editor state below;
      // for image/signature use the existing fixed defaults.
      const w = tool === 'image' ? 180 : tool === 'signature' ? 180 : 120;
      const h = tool === 'image' ? 80 : tool === 'signature' ? 80 : 120;
      const annType: 'image' | 'signature' = tool === 'barcode' ? 'image' : tool;
      onAddAnnotation({ id: uid(), type: annType, page: visualPageNumber, x: p.x, y: p.y, w, h, imageData: pendingImage });
      return;
    }
    if (tool === 'stamp') {
      const w = 220; const h = 64;
      onAddAnnotation({ id: uid(), type: 'stamp', page: visualPageNumber, x: p.x, y: p.y, w, h, label: pendingStamp ?? 'CONFIDENTIAL', color: '#c62828' });
      return;
    }
    if (tool === 'pen') {
      setDrawing({ tool: 'pen', start: p, current: p, pen: [{ x: 0, y: 0 }] });
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      return;
    }
    // Drag-create geometry tools.
    setDrawing({ tool, start: p, current: p });
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = localCoords(e);
    if (drawing) {
      if (drawing.tool === 'pen') {
        const rel = { x: p.x - drawing.start.x, y: p.y - drawing.start.y };
        setDrawing({ ...drawing, current: p, pen: [...(drawing.pen ?? []), rel] });
      } else {
        setDrawing({ ...drawing, current: p });
      }
      return;
    }
    if (drag) {
      const ann = annotations.find(a => a.id === drag.id);
      if (!ann) return;
      onUpdateAnnotation(drag.id, { x: p.x - drag.offsetX, y: p.y - drag.offsetY });
    }
  };

  const onPointerUp = () => {
    if (drawing) {
      const { tool: t, start, current, pen } = drawing;
      const x = Math.min(start.x, current.x);
      const y = Math.min(start.y, current.y);
      const w = Math.abs(current.x - start.x);
      const h = Math.abs(current.y - start.y);
      const sw = strokeWidth;

      if (t === 'pen' && pen && pen.length > 2) {
        const xs = pen.map(p => p.x); const ys = pen.map(p => p.y);
        const minX = Math.min(0, ...xs); const maxX = Math.max(0, ...xs);
        const minY = Math.min(0, ...ys); const maxY = Math.max(0, ...ys);
        onAddAnnotation({ id: uid(), type: 'pen', page: visualPageNumber, x: start.x + minX, y: start.y + minY, w: maxX - minX, h: maxY - minY, points: pen.map(p => ({ x: p.x - minX, y: p.y - minY })), color, strokeWidth: sw });
      } else if (w > 4 && h > 4) {
        if (t === 'rect') onAddAnnotation({ id: uid(), type: 'rect', page: visualPageNumber, x, y, w, h, color, strokeWidth: sw });
        else if (t === 'ellipse') onAddAnnotation({ id: uid(), type: 'ellipse', page: visualPageNumber, x, y, w, h, color, strokeWidth: sw });
        else if (t === 'highlight') onAddAnnotation({ id: uid(), type: 'highlight', page: visualPageNumber, x, y, w, h, fillColor: '#fff050' });
        else if (t === 'redact') onAddAnnotation({ id: uid(), type: 'redact', page: visualPageNumber, x, y, w, h });
      } else if ((t === 'line' || t === 'arrow') && (Math.abs(current.x - start.x) > 2 || Math.abs(current.y - start.y) > 2)) {
        onAddAnnotation({ id: uid(), type: 'line', page: visualPageNumber, x: start.x, y: start.y, w: current.x - start.x, h: current.y - start.y, color, strokeWidth: sw, arrow: t === 'arrow' });
      } else if (t === 'link' && w > 4 && h > 4) {
        const url = window.prompt('Hyperlink URL (e.g. https://...):', 'https://');
        if (url && /^(https?:|mailto:|tel:)/i.test(url)) {
          const text = window.prompt('Link label (visible in PDF):', url) || url;
          onAddAnnotation({ id: uid(), type: 'link', page: visualPageNumber, x, y, w, h, url, text });
        }
      } else if (t === 'crop' && w > 8 && h > 8) {
        onSetCrop?.(visualPageNumber - 1, { x, y, w, h });
      }
      setDrawing(null);
    }
    if (drag) setDrag(null);
  };

  const startAnnDrag = (e: React.PointerEvent, ann: Annotation) => {
    if (tool !== 'select') return;
    e.stopPropagation();
    onSelectAnnotation(ann.id);
    const p = localCoords(e);
    setDrag({ id: ann.id, offsetX: p.x - ann.x, offsetY: p.y - ann.y });
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const cursor = tool === 'hand' ? 'cursor-grab' : tool === 'text' ? 'cursor-text' : tool === 'select' ? 'cursor-default' : 'cursor-crosshair';
  const rotated = pageMeta.rotation;
  const dispW = (rotated === 90 || rotated === 270) ? pageMeta.height : pageMeta.width;
  const dispH = (rotated === 90 || rotated === 270) ? pageMeta.width : pageMeta.height;

  return (
    <div className="flex flex-col items-center" data-page-number={visualPageNumber}>
      <div className="text-[10px] text-rmpg-500 mb-1">Page {visualPageNumber}{originalPageNumber === 0 ? ' (blank)' : ''}</div>
      <div
        className={`relative bg-white shadow-lg ${cursor}`}
        style={{ width: dispW * zoom, height: dispH * zoom }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <canvas
          ref={canvasRef}
          className="absolute pointer-events-none"
          style={{
            transform: `rotate(${rotated}deg) scale(${zoom})`,
            transformOrigin: 'top left',
            top: rotated === 180 ? dispH * zoom : rotated === 90 ? 0 : 0,
            left: rotated === 90 ? dispW * zoom : rotated === 180 ? dispW * zoom : 0,
          }}
        />
        {/* Text layer — transparent text positioned to match the rasterized
            page so users can select + copy with the native browser selection.
            Sits beneath the annotation overlay (which captures pointer events
            for the active drawing tool); only enabled in 'select' / 'hand'. */}
        <div
          ref={textLayerRef}
          aria-hidden="false"
          style={{
            position: 'absolute',
            inset: 0,
            transform: `scale(${zoom})`,
            transformOrigin: 'top left',
            pointerEvents: tool === 'select' || tool === 'hand' ? 'auto' : 'none',
            userSelect: 'text',
            color: 'transparent',
          }}
        />
        <div ref={overlayRef} className="absolute inset-0" style={{ width: dispW * zoom, height: dispH * zoom }}>
          {annotations.map(ann => (
            <AnnotationView
              key={ann.id}
              ann={ann}
              zoom={zoom}
              selected={ann.id === activeId}
              onPointerDown={(e) => startAnnDrag(e, ann)}
            />
          ))}
          {drawing && <DrawingPreview drawing={drawing} zoom={zoom} color={color} strokeWidth={strokeWidth} />}
          {pageMeta.crop && (
            // Render the persisted crop as a translucent overlay to confirm
            // what will be visible in the saved PDF.
            <>
              <div className="absolute inset-0 pointer-events-none" style={{
                background: `linear-gradient(transparent 0,transparent 0)`,
                boxShadow: `inset 0 0 0 9999px rgba(0,0,0,0.55)`,
                clipPath: `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 ${pageMeta.crop.y * zoom}px, ${pageMeta.crop.x * zoom}px ${pageMeta.crop.y * zoom}px, ${pageMeta.crop.x * zoom}px ${(pageMeta.crop.y + pageMeta.crop.h) * zoom}px, ${(pageMeta.crop.x + pageMeta.crop.w) * zoom}px ${(pageMeta.crop.y + pageMeta.crop.h) * zoom}px, ${(pageMeta.crop.x + pageMeta.crop.w) * zoom}px ${pageMeta.crop.y * zoom}px, 0 ${pageMeta.crop.y * zoom}px)`,
              }} />
              <div className="absolute pointer-events-none border border-[#d4a017]" style={{
                left: pageMeta.crop.x * zoom,
                top: pageMeta.crop.y * zoom,
                width: pageMeta.crop.w * zoom,
                height: pageMeta.crop.h * zoom,
              }} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function AnnotationView({ ann, zoom, selected, onPointerDown }: { ann: Annotation; zoom: number; selected: boolean; onPointerDown: (e: React.PointerEvent) => void }) {
  const baseStyle: React.CSSProperties = {
    position: 'absolute',
    left: ann.x * zoom,
    top: ann.y * zoom,
    width: ann.w * zoom,
    height: ann.h * zoom,
    opacity: ann.opacity ?? 1,
    outline: selected ? '2px solid #d4a017' : 'none',
  };

  if (ann.type === 'text') {
    return (
      <div onPointerDown={onPointerDown} style={{ ...baseStyle, color: ann.color ?? '#0a0a0a', fontSize: ann.fontSize * zoom, fontWeight: ann.bold ? 700 : 400, fontStyle: ann.italic ? 'italic' : 'normal', fontFamily: 'Helvetica, Arial, sans-serif', whiteSpace: 'nowrap', userSelect: 'none', padding: 1 }}>
        {ann.text}
      </div>
    );
  }
  if (ann.type === 'highlight') {
    return <div onPointerDown={onPointerDown} style={{ ...baseStyle, background: ann.fillColor ?? '#fff050', opacity: (ann.opacity ?? 1) * 0.4 }} />;
  }
  if (ann.type === 'redact') {
    return <div onPointerDown={onPointerDown} style={{ ...baseStyle, background: '#000' }} />;
  }
  if (ann.type === 'rect') {
    return <div onPointerDown={onPointerDown} style={{ ...baseStyle, border: `${(ann.strokeWidth ?? 1.5) * zoom}px solid ${ann.color ?? '#0a0a0a'}`, background: ann.fillColor ?? 'transparent' }} />;
  }
  if (ann.type === 'ellipse') {
    return <div onPointerDown={onPointerDown} style={{ ...baseStyle, border: `${(ann.strokeWidth ?? 1.5) * zoom}px solid ${ann.color ?? '#0a0a0a'}`, background: ann.fillColor ?? 'transparent', borderRadius: '50%' }} />;
  }
  if (ann.type === 'line') {
    return (
      <svg onPointerDown={onPointerDown} style={{ ...baseStyle, overflow: 'visible' }}>
        <line x1={0} y1={0} x2={ann.w * zoom} y2={ann.h * zoom} stroke={ann.color ?? '#0a0a0a'} strokeWidth={(ann.strokeWidth ?? 1.5) * zoom} />
        {ann.arrow && <ArrowHead x={ann.w * zoom} y={ann.h * zoom} dx={ann.w} dy={ann.h} color={ann.color ?? '#0a0a0a'} zoom={zoom} stroke={ann.strokeWidth ?? 1.5} />}
      </svg>
    );
  }
  if (ann.type === 'pen') {
    const d = ann.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x * zoom} ${p.y * zoom}`).join(' ');
    return (
      <svg onPointerDown={onPointerDown} style={{ ...baseStyle, overflow: 'visible' }}>
        <path d={d} stroke={ann.color ?? '#0a0a0a'} strokeWidth={(ann.strokeWidth ?? 1.5) * zoom} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (ann.type === 'image' || ann.type === 'signature') {
    return <img onPointerDown={onPointerDown} src={ann.imageData} alt="" style={{ ...baseStyle, objectFit: 'contain' }} />;
  }
  if (ann.type === 'link') {
    return (
      <div onPointerDown={onPointerDown} style={{ ...baseStyle, color: '#0046a1', textDecoration: 'underline', fontFamily: 'Helvetica, Arial, sans-serif', fontSize: Math.max(10, ann.h * zoom * 0.6), padding: 1, overflow: 'hidden', userSelect: 'none' }}
        title={`Link → ${ann.url}`}>
        {ann.text}
      </div>
    );
  }
  if (ann.type === 'stamp') {
    const fontSize = Math.max(10, ann.h * zoom * 0.45);
    return (
      <div onPointerDown={onPointerDown} style={{ ...baseStyle, border: `${2.5 * zoom}px solid ${ann.color ?? '#c62828'}`, color: ann.color ?? '#c62828', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Helvetica, Arial, sans-serif', fontWeight: 800, fontSize, letterSpacing: '0.05em' }}>
        {String(ann.label).toUpperCase()}
      </div>
    );
  }
  return null;
}

function ArrowHead({ x, y, dx, dy, color, zoom, stroke }: { x: number; y: number; dx: number; dy: number; color: string; zoom: number; stroke: number }) {
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len; const uy = dy / len;
  const head = 12 * zoom; const wide = 6 * zoom;
  const bx = x - ux * head; const by = y - uy * head;
  const p1 = { x: bx + (-uy) * wide, y: by + ux * wide };
  const p2 = { x: bx - (-uy) * wide, y: by - ux * wide };
  return (
    <>
      <line x1={x} y1={y} x2={p1.x} y2={p1.y} stroke={color} strokeWidth={stroke * zoom} />
      <line x1={x} y1={y} x2={p2.x} y2={p2.y} stroke={color} strokeWidth={stroke * zoom} />
    </>
  );
}

function DrawingPreview({ drawing, zoom, color, strokeWidth }: { drawing: { tool: Tool; start: Point; current: Point; pen?: Point[] }; zoom: number; color: string; strokeWidth: number }) {
  const { tool, start, current, pen } = drawing;
  const x = Math.min(start.x, current.x);
  const y = Math.min(start.y, current.y);
  const w = Math.abs(current.x - start.x);
  const h = Math.abs(current.y - start.y);
  const style: React.CSSProperties = { position: 'absolute', left: x * zoom, top: y * zoom, width: w * zoom, height: h * zoom, pointerEvents: 'none' };

  if (tool === 'rect') return <div style={{ ...style, border: `${strokeWidth * zoom}px dashed ${color}` }} />;
  if (tool === 'ellipse') return <div style={{ ...style, border: `${strokeWidth * zoom}px dashed ${color}`, borderRadius: '50%' }} />;
  if (tool === 'highlight') return <div style={{ ...style, background: '#fff050', opacity: 0.3 }} />;
  if (tool === 'redact') return <div style={{ ...style, background: '#000', opacity: 0.7 }} />;
  if (tool === 'line' || tool === 'arrow') {
    const sx = (start.x - x) * zoom; const sy = (start.y - y) * zoom;
    const ex = (current.x - x) * zoom; const ey = (current.y - y) * zoom;
    return <svg style={{ ...style, overflow: 'visible' }}><line x1={sx} y1={sy} x2={ex} y2={ey} stroke={color} strokeWidth={strokeWidth * zoom} strokeDasharray="4 3" /></svg>;
  }
  if (tool === 'pen' && pen) {
    const d = pen.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x * zoom} ${p.y * zoom}`).join(' ');
    return <svg style={{ position: 'absolute', left: start.x * zoom, top: start.y * zoom, overflow: 'visible', pointerEvents: 'none' }}><path d={d} stroke={color} strokeWidth={strokeWidth * zoom} fill="none" strokeLinecap="round" /></svg>;
  }
  if (tool === 'link') {
    return <div style={{ ...style, border: `${strokeWidth * zoom}px dashed #1976d2`, background: 'rgba(25,118,210,0.08)' }} />;
  }
  if (tool === 'crop') {
    return <div style={{ ...style, border: `${strokeWidth * zoom}px dashed #d4a017`, background: 'rgba(212,160,23,0.05)' }} />;
  }
  return null;
}
