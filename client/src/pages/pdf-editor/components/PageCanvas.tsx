import { useEffect, useRef, useState, cloneElement } from 'react';
import { openAndRenderPage } from '../../../lib/rmpg-pdf-engine';
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
  onAnnotationContextMenu?: (id: string, x: number, y: number) => void;
  /** When true, skip the native engine and render via PDF.js directly.
   *  Wired to a toolbar toggle so users can recover stuck blank pages. */
  forcePdfjs?: boolean;
}

function uid(): string { return Math.random().toString(36).slice(2, 10); }

// Names for the 8 resize handles: 4 corners + 4 edge midpoints. Each handle
// affects different sides of the annotation — see resize math in the
// onPointerMove handler below.
type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

const HANDLE_POSITIONS: Array<{ id: ResizeHandle; cx: 0 | 0.5 | 1; cy: 0 | 0.5 | 1; cursor: string }> = [
  { id: 'nw', cx: 0, cy: 0, cursor: 'nwse-resize' },
  { id: 'n',  cx: 0.5, cy: 0, cursor: 'ns-resize' },
  { id: 'ne', cx: 1, cy: 0, cursor: 'nesw-resize' },
  { id: 'e',  cx: 1, cy: 0.5, cursor: 'ew-resize' },
  { id: 'se', cx: 1, cy: 1, cursor: 'nwse-resize' },
  { id: 's',  cx: 0.5, cy: 1, cursor: 'ns-resize' },
  { id: 'sw', cx: 0, cy: 1, cursor: 'nesw-resize' },
  { id: 'w',  cx: 0, cy: 0.5, cursor: 'ew-resize' },
];

export default function PageCanvas(props: Props) {
  const { pdfBytes, originalPageNumber, visualPageNumber, pageMeta, zoom, tool, color, strokeWidth, pendingImage, pendingStamp, annotations, activeId, onSelectAnnotation, onAddAnnotation, onUpdateAnnotation, onSetCrop, onAnnotationContextMenu, forcePdfjs } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const [drawing, setDrawing] = useState<{ tool: Tool; start: Point; current: Point; pen?: Point[] } | null>(null);
  const [drag, setDrag] = useState<{ id: string; offsetX: number; offsetY: number } | null>(null);
  // Active resize: which handle on which annotation, plus the original geometry
  // we measure deltas against. Capture is on the handle element so leaving it
  // doesn't end the gesture mid-drag.
  const [resize, setResize] = useState<{
    id: string;
    handle: ResizeHandle;
    originX: number; originY: number;
    originW: number; originH: number;
    pointerStartX: number; pointerStartY: number;
  } | null>(null);
  // Surfaces a visible message in the page area when both engines fail to
  // render — far better than the previous behavior of a silent black canvas
  // with no indication anything went wrong.
  const [renderError, setRenderError] = useState<string | null>(null);
  // Polygon / polyline draft — captured vertices in absolute page coords
  // until the user double-clicks (closes/finishes) or hits Escape (cancels).
  const [polyDraft, setPolyDraft] = useState<{ tool: 'polygon' | 'polyline'; vertices: Point[]; cursor: Point } | null>(null);

  // Render PDF page on mount + when bytes change.
  useEffect(() => {
    if (!pdfBytes || originalPageNumber === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const canvas = canvasRef.current;
        if (!canvas) return;
        setRenderError(null);
        // openAndRenderPage tries the auto dispatcher first and retries with
        // PDF.js if anything fails during render — defense in depth so a
        // native renderer gap can't leave the page silently blank.
        const pdf = await openAndRenderPage(pdfBytes, {
          pageNumber: originalPageNumber,
          scale: DEFAULT_RENDER_SCALE,
          canvas,
          forcePdfjs,
        });
        if (!pdf) {
          setRenderError(`Page ${originalPageNumber} could not be rendered. Both the native engine and the PDF.js fallback failed.`);
          return;
        }
        if (cancelled) { await pdf.destroy(); return; }
        const page = await pdf.getPage(originalPageNumber);
        const viewport = page.getViewport({ scale: DEFAULT_RENDER_SCALE });

        // Build a transparent text layer so users can select / copy text
        // from the underlying PDF (huge UX win for inspecting witness
        // statements, evidence reports, etc.).
        const textLayer = textLayerRef.current;
        if (textLayer && !cancelled) {
          textLayer.replaceChildren();
          try {
            const items = await page.getTextContent();
            for (const item of items) {
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
        // Free the document — viewport sizes are already locked into the page record.
        try { await pdf.destroy(); } catch { /* ignore */ }
      } catch (err) {
        console.error('Page render failed', err);
        setRenderError(err instanceof Error ? err.message : 'Render failed (see console)');
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
    if (tool === 'sticky') {
      const text = window.prompt('Sticky note:', '');
      if (!text) return;
      onAddAnnotation({ id: uid(), type: 'sticky', page: visualPageNumber, x: p.x, y: p.y, w: 180, h: 60, text, color: '#0a0a0a', fillColor: '#fff7c2', createdAt: new Date().toISOString() });
      return;
    }
    if (tool === 'datestamp') {
      const text = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' });
      onAddAnnotation({ id: uid(), type: 'text', page: visualPageNumber, x: p.x, y: p.y, w: 0, h: 0, text, fontSize: 12, color });
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
    if (tool === 'polygon' || tool === 'polyline') {
      // Each click adds a vertex; double-click closes (handled in onDoubleClick
      // below). Escape clears the draft via the orchestrator's keyboard handler.
      setPolyDraft(prev => prev && prev.tool === tool
        ? { ...prev, vertices: [...prev.vertices, p], cursor: p }
        : { tool, vertices: [p], cursor: p });
      return;
    }
    // Drag-create geometry tools.
    setDrawing({ tool, start: p, current: p });
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = localCoords(e);
    if (polyDraft) {
      setPolyDraft({ ...polyDraft, cursor: p });
      // Don't return here — allow the rest of move to run if needed.
    }
    if (drawing) {
      if (drawing.tool === 'pen') {
        const rel = { x: p.x - drawing.start.x, y: p.y - drawing.start.y };
        setDrawing({ ...drawing, current: p, pen: [...(drawing.pen ?? []), rel] });
      } else {
        setDrawing({ ...drawing, current: p });
      }
      return;
    }
    if (resize) {
      // Convert handle id to per-side deltas. dx/dy are in local coords.
      const dx = p.x - resize.pointerStartX;
      const dy = p.y - resize.pointerStartY;
      const h = resize.handle;
      let newX = resize.originX, newY = resize.originY;
      let newW = resize.originW, newH = resize.originH;
      const MIN = 6;
      if (h === 'nw' || h === 'w' || h === 'sw') { newX = resize.originX + dx; newW = resize.originW - dx; }
      if (h === 'ne' || h === 'e' || h === 'se') { newW = resize.originW + dx; }
      if (h === 'nw' || h === 'n' || h === 'ne') { newY = resize.originY + dy; newH = resize.originH - dy; }
      if (h === 'sw' || h === 's' || h === 'se') { newH = resize.originH + dy; }
      // Prevent negative or sub-minimum dimensions while keeping the opposite
      // edge anchored — clamp width/height first, then back out the position.
      if (newW < MIN) {
        if (h === 'nw' || h === 'w' || h === 'sw') newX = resize.originX + resize.originW - MIN;
        newW = MIN;
      }
      if (newH < MIN) {
        if (h === 'nw' || h === 'n' || h === 'ne') newY = resize.originY + resize.originH - MIN;
        newH = MIN;
      }
      onUpdateAnnotation(resize.id, { x: newX, y: newY, w: newW, h: newH });
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
    if (resize) setResize(null);
  };

  /** Begin a resize gesture. Captured separately from drag so the handle
   *  child element gets pointer capture (bubbles wouldn't fire during fast
   *  drags that exit the small handle rect). */
  const startResize = (e: React.PointerEvent, ann: Annotation, handle: ResizeHandle) => {
    if (ann.locked) return;
    e.stopPropagation();
    onSelectAnnotation(ann.id);
    const p = localCoords(e);
    setResize({
      id: ann.id, handle,
      originX: ann.x, originY: ann.y,
      originW: ann.w, originH: ann.h,
      pointerStartX: p.x, pointerStartY: p.y,
    });
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const startAnnDrag = (e: React.PointerEvent, ann: Annotation) => {
    if (tool !== 'select') return;
    if (ann.locked) {
      // Still allow selection so users can unlock from the panel.
      e.stopPropagation();
      onSelectAnnotation(ann.id);
      return;
    }
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
        onDoubleClick={(e) => {
          // Polygon / polyline finish gesture — needs at least 2 vertices.
          if (!polyDraft || polyDraft.vertices.length < 2) return;
          e.preventDefault();
          const xs = polyDraft.vertices.map(v => v.x);
          const ys = polyDraft.vertices.map(v => v.y);
          const minX = Math.min(...xs), minY = Math.min(...ys);
          const maxX = Math.max(...xs), maxY = Math.max(...ys);
          const points = polyDraft.vertices.map(v => ({ x: v.x - minX, y: v.y - minY }));
          onAddAnnotation({
            id: uid(), type: 'polygon', page: visualPageNumber,
            x: minX, y: minY, w: maxX - minX || 1, h: maxY - minY || 1,
            points, closed: polyDraft.tool === 'polygon',
            color, strokeWidth,
          });
          setPolyDraft(null);
        }}
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
              onResizeStart={(e, handle) => startResize(e, ann, handle)}
              showResizeHandles={ann.id === activeId && !ann.locked && tool === 'select'}
              onContextMenu={(e) => {
                if (!onAnnotationContextMenu) return;
                e.preventDefault();
                e.stopPropagation();
                onSelectAnnotation(ann.id);
                onAnnotationContextMenu(ann.id, e.clientX, e.clientY);
              }}
            />
          ))}
          {drawing && <DrawingPreview drawing={drawing} zoom={zoom} color={color} strokeWidth={strokeWidth} />}
          {polyDraft && (
            // Live polygon/polyline preview: solid line through committed
            // vertices + dashed segment to the cursor for the next vertex.
            <svg className="absolute inset-0 pointer-events-none" style={{ overflow: 'visible' }}>
              <path
                d={polyDraft.vertices.map((v, i) => `${i === 0 ? 'M' : 'L'} ${v.x * zoom} ${v.y * zoom}`).join(' ')
                    + ` L ${polyDraft.cursor.x * zoom} ${polyDraft.cursor.y * zoom}`
                    + (polyDraft.tool === 'polygon' ? ' Z' : '')}
                stroke={color}
                strokeWidth={strokeWidth * zoom}
                strokeDasharray={`${4 * zoom} ${3 * zoom}`}
                fill={polyDraft.tool === 'polygon' ? 'rgba(212, 160, 23, 0.06)' : 'none'}
              />
              {polyDraft.vertices.map((v, i) => (
                <circle key={i} cx={v.x * zoom} cy={v.y * zoom} r={3} fill="#d4a017" stroke="#000" strokeWidth={0.5} />
              ))}
            </svg>
          )}
          {renderError && (
            <div className="absolute inset-0 flex items-center justify-center text-center p-4 pointer-events-none"
              style={{ background: 'rgba(220, 38, 38, 0.08)', border: '1px dashed rgba(220, 38, 38, 0.4)' }}>
              <div className="bg-[#141414] border border-red-700/40 rounded-sm p-3 max-w-md text-[11px] pointer-events-auto">
                <div className="text-red-300 font-semibold mb-1">⚠ Page render failed</div>
                <div className="text-rmpg-300">{renderError}</div>
                <div className="text-rmpg-500 text-[10px] mt-2">
                  Try toggling the Compat engine button in the toolbar, or open browser DevTools → Console for more detail.
                </div>
              </div>
            </div>
          )}
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

function AnnotationView({ ann, zoom, selected, onPointerDown, onResizeStart, showResizeHandles, onContextMenu }: {
  ann: Annotation;
  zoom: number;
  selected: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  onResizeStart: (e: React.PointerEvent, handle: ResizeHandle) => void;
  showResizeHandles: boolean;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  const baseStyle: React.CSSProperties = {
    position: 'absolute',
    left: ann.x * zoom,
    top: ann.y * zoom,
    width: ann.w * zoom,
    height: ann.h * zoom,
    opacity: ann.opacity ?? 1,
    outline: selected ? '2px solid #d4a017' : 'none',
  };

  // Renders the 8 resize grips on top of the selected annotation. Each grip
  // is a small gold square at a corner / edge midpoint of the bounding box.
  // Pointer events are captured on the grip so a fast drag stays attached.
  const handlesEl = showResizeHandles ? (
    <>
      {HANDLE_POSITIONS.map(h => (
        <div
          key={h.id}
          onPointerDown={(e) => onResizeStart(e, h.id)}
          title={`Resize ${h.id}`}
          style={{
            position: 'absolute',
            left: ann.x * zoom + h.cx * ann.w * zoom - 4,
            top: ann.y * zoom + h.cy * ann.h * zoom - 4,
            width: 8, height: 8,
            background: '#d4a017',
            border: '1px solid #0a0a0a',
            borderRadius: 1,
            cursor: h.cursor,
            zIndex: 10,
          }}
        />
      ))}
    </>
  ) : null;

  // Render the type-specific body once into `inner`, then return the body
  // alongside the resize handles. Capturing into a variable means handles
  // co-render with every annotation kind without per-case duplication.
  let inner: React.ReactNode = null;

  if (ann.type === 'text') {
    inner = (
      <div onPointerDown={onPointerDown} style={{ ...baseStyle, color: ann.color ?? '#0a0a0a', fontSize: ann.fontSize * zoom, fontWeight: ann.bold ? 700 : 400, fontStyle: ann.italic ? 'italic' : 'normal', fontFamily: 'Helvetica, Arial, sans-serif', whiteSpace: 'nowrap', userSelect: 'none', padding: 1 }}>
        {ann.text}
      </div>
    );
  } else if (ann.type === 'highlight') {
    inner = <div onPointerDown={onPointerDown} style={{ ...baseStyle, background: ann.fillColor ?? '#fff050', opacity: (ann.opacity ?? 1) * 0.4 }} />;
  } else if (ann.type === 'redact') {
    inner = <div onPointerDown={onPointerDown} style={{ ...baseStyle, background: '#000' }} />;
  } else if (ann.type === 'rect') {
    inner = <div onPointerDown={onPointerDown} style={{ ...baseStyle, border: `${(ann.strokeWidth ?? 1.5) * zoom}px solid ${ann.color ?? '#0a0a0a'}`, background: ann.fillColor ?? 'transparent' }} />;
  } else if (ann.type === 'ellipse') {
    inner = <div onPointerDown={onPointerDown} style={{ ...baseStyle, border: `${(ann.strokeWidth ?? 1.5) * zoom}px solid ${ann.color ?? '#0a0a0a'}`, background: ann.fillColor ?? 'transparent', borderRadius: '50%' }} />;
  } else if (ann.type === 'line') {
    inner = (
      <svg onPointerDown={onPointerDown} style={{ ...baseStyle, overflow: 'visible' }}>
        <line x1={0} y1={0} x2={ann.w * zoom} y2={ann.h * zoom} stroke={ann.color ?? '#0a0a0a'} strokeWidth={(ann.strokeWidth ?? 1.5) * zoom} />
        {ann.arrow && <ArrowHead x={ann.w * zoom} y={ann.h * zoom} dx={ann.w} dy={ann.h} color={ann.color ?? '#0a0a0a'} zoom={zoom} stroke={ann.strokeWidth ?? 1.5} />}
      </svg>
    );
  } else if (ann.type === 'pen') {
    const d = ann.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x * zoom} ${p.y * zoom}`).join(' ');
    inner = (
      <svg onPointerDown={onPointerDown} style={{ ...baseStyle, overflow: 'visible' }}>
        <path d={d} stroke={ann.color ?? '#0a0a0a'} strokeWidth={(ann.strokeWidth ?? 1.5) * zoom} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  } else if (ann.type === 'polygon') {
    const d = ann.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x * zoom} ${p.y * zoom}`).join(' ')
      + (ann.closed ? ' Z' : '');
    inner = (
      <svg onPointerDown={onPointerDown} style={{ ...baseStyle, overflow: 'visible' }}>
        <path d={d} stroke={ann.color ?? '#0a0a0a'} strokeWidth={(ann.strokeWidth ?? 1.5) * zoom}
          fill={ann.closed && ann.fillColor ? ann.fillColor : 'none'} strokeLinejoin="round" />
      </svg>
    );
  } else if (ann.type === 'image' || ann.type === 'signature') {
    inner = <img onPointerDown={onPointerDown} src={ann.imageData} alt="" style={{ ...baseStyle, objectFit: 'contain' }} />;
  } else if (ann.type === 'sticky') {
    inner = (
      <div onPointerDown={onPointerDown} title={ann.text}
        style={{ ...baseStyle, background: ann.fillColor ?? '#fff7c2', color: ann.color ?? '#0a0a0a', border: '1px solid #d4a017', boxShadow: '2px 2px 0 rgba(0,0,0,0.25)', padding: '4px 6px', fontFamily: 'Helvetica, Arial, sans-serif', fontSize: Math.max(10, ann.h * zoom * 0.18), userSelect: 'none', overflow: 'hidden' }}>
        {ann.text}
      </div>
    );
  } else if (ann.type === 'link') {
    inner = (
      <div onPointerDown={onPointerDown} style={{ ...baseStyle, color: '#0046a1', textDecoration: 'underline', fontFamily: 'Helvetica, Arial, sans-serif', fontSize: Math.max(10, ann.h * zoom * 0.6), padding: 1, overflow: 'hidden', userSelect: 'none' }}
        title={`Link → ${ann.url}`}>
        {ann.text}
      </div>
    );
  } else if (ann.type === 'stamp') {
    const fontSize = Math.max(10, ann.h * zoom * 0.45);
    inner = (
      <div onPointerDown={onPointerDown} style={{ ...baseStyle, border: `${2.5 * zoom}px solid ${ann.color ?? '#c62828'}`, color: ann.color ?? '#c62828', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Helvetica, Arial, sans-serif', fontWeight: 800, fontSize, letterSpacing: '0.05em' }}>
        {String(ann.label).toUpperCase()}
      </div>
    );
  }

  // Inject onContextMenu onto whatever root element the type-specific branch
  // produced — saves us repeating the prop on every per-kind JSX assignment.
  // The cast is safe: every `inner` assignment above produces a single root
  // element that accepts onContextMenu (div / svg / img all accept it).
  const innerWithContextMenu = inner && onContextMenu
    ? cloneElement(inner as React.ReactElement<{ onContextMenu?: (e: React.MouseEvent) => void }>, { onContextMenu })
    : inner;
  return <>{innerWithContextMenu}{handlesEl}</>;
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
