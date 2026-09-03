import { useEffect, useRef, useState, cloneElement } from 'react';
import { openAndRenderPage, RmpgPdfDocument } from '../../../lib/rmpg-pdf-engine';
import { Annotation, MeasureCalibration, PageCrop, PageMeta, Point, StampLabel, StickyCategory, STICKY_CATEGORIES, Tool, DEFAULT_RENDER_SCALE } from '../types';
import { formatEnumValue } from '../../../utils/formatters';

interface Props {
  pdfBytes: Uint8Array | null;
  /** Shared, already-parsed document opened once by the parent. When present,
   *  the page renders from it instead of re-opening the whole PDF per page
   *  (an N-page doc otherwise parses itself N times). The parent owns the
   *  lifecycle — this component never destroys a shared doc. Falls back to a
   *  per-page open when absent (standalone use) or when forcePdfjs is set. */
  doc?: RmpgPdfDocument | null;
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
  /** Live (no-history) update during an in-progress drag/resize. */
  onUpdateAnnotationLive?: (id: string, patch: Partial<Annotation>) => void;
  /** Snapshot the pre-gesture state into history once, on the first move. */
  onTransformStart?: () => void;
  onSetCrop?: (visualIdx: number, crop: PageCrop | null) => void;
  onAnnotationContextMenu?: (id: string, x: number, y: number) => void;
  /** When true, skip the native engine and render via PDF.js directly.
   *  Wired to a toolbar toggle so users can recover stuck blank pages. */
  forcePdfjs?: boolean;
  /** Snap new annotation placements + drags to a grid (in PDF points). */
  snapToGrid?: boolean;
  /** Grid step in PDF points (converted to screen px internally). */
  gridSize?: number;
  /** Active real-world measurement calibration. When set, the measure + area
   *  tools report calibrated distances/areas instead of raw inches/points. */
  calibration?: MeasureCalibration | null;
  /** Default category applied to sticky notes created on this page. */
  stickyCategory?: StickyCategory;
  /** Aspect-ratio lock for the Crop tool (width / height). When > 0 the crop
   *  drag is constrained to this ratio (1 = square, 4/3, Letter 8.5/11, …).
   *  0 / undefined = free-form crop. */
  cropAspect?: number;
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
  const { pdfBytes, doc, originalPageNumber, visualPageNumber, pageMeta, zoom, tool, color, strokeWidth, pendingImage, pendingStamp, annotations, activeId, onSelectAnnotation, onAddAnnotation, onUpdateAnnotation, onUpdateAnnotationLive, onTransformStart, onSetCrop, onAnnotationContextMenu, forcePdfjs, snapToGrid, gridSize, calibration, stickyCategory, cropAspect } = props;
  // Snap a value (screen px at render scale) to the configured grid. The grid
  // is defined in PDF points, so step = gridSize * DEFAULT_RENDER_SCALE px.
  const snap = (v: number): number => {
    if (!snapToGrid || !gridSize || gridSize <= 0) return v;
    const step = gridSize * DEFAULT_RENDER_SCALE;
    return Math.round(v / step) * step;
  };
  const snapPt = (p: Point): Point => ({ x: snap(p.x), y: snap(p.y) });
  // Tracks whether the current drag/resize gesture has already snapshotted the
  // pre-gesture state into history (so we do it exactly once, on the first move).
  const gestureSnapshotRef = useRef(false);
  // Apply a drag/resize move: snapshot-once into history, then stream live
  // (no-history) updates. Falls back to the history-recording path if the live
  // props aren't provided.
  const applyTransformMove = (id: string, patch: Partial<Annotation>) => {
    if (onUpdateAnnotationLive && onTransformStart) {
      if (!gestureSnapshotRef.current) { onTransformStart(); gestureSnapshotRef.current = true; }
      onUpdateAnnotationLive(id, patch);
    } else {
      onUpdateAnnotation(id, patch);
    }
  };
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
  const [polyDraft, setPolyDraft] = useState<{ tool: 'polygon' | 'polyline' | 'measureArea'; vertices: Point[]; cursor: Point } | null>(null);

  // Compute a calibrated (or raw) area label for a closed polygon given its
  // absolute-page-pixel vertices. Uses the shoelace formula in PDF points, then
  // scales by the active real-world calibration when present.
  const areaLabelFor = (verts: Point[]): string => {
    let acc = 0;
    for (let i = 0; i < verts.length; i++) {
      const a = verts[i], b = verts[(i + 1) % verts.length];
      acc += a.x * b.y - b.x * a.y;
    }
    const areaPx = Math.abs(acc) / 2;
    // px → PDF points: divide each axis by render scale → divide area by scale².
    const areaPt = areaPx / (DEFAULT_RENDER_SCALE * DEFAULT_RENDER_SCALE);
    if (calibration && calibration.realPerPdfPoint > 0) {
      const real = areaPt * calibration.realPerPdfPoint * calibration.realPerPdfPoint;
      return `${real.toFixed(2)} sq ${calibration.unit}`;
    }
    const sqIn = areaPt / (72 * 72);
    return sqIn >= 0.01 ? `${sqIn.toFixed(2)} sq in` : `${areaPt.toFixed(0)} sq pt`;
  };

  // Render PDF page on mount + when bytes/doc change.
  useEffect(() => {
    if (originalPageNumber === 0) return;
    // Use the parent's shared document when available so an N-page PDF is
    // parsed once instead of once per page. The forcePdfjs diagnostic toggle
    // deliberately bypasses the shared doc and re-opens this page on its own,
    // so operators can still force the compatibility engine per-document.
    const sharedDoc = (!forcePdfjs && doc) ? doc : null;
    if (!sharedDoc && !pdfBytes) return;
    let cancelled = false;
    (async () => {
      // `pdf` is the document we render from. When we open our own (no shared
      // doc) we must destroy it; a shared doc is owned by the parent and must
      // NOT be destroyed here.
      let pdf: RmpgPdfDocument | null = null;
      let ownsDoc = false;
      try {
        const canvas = canvasRef.current;
        if (!canvas) return;
        setRenderError(null);
        if (sharedDoc) {
          pdf = sharedDoc;
          const page0 = await pdf.getPage(originalPageNumber);
          await page0.render({ scale: DEFAULT_RENDER_SCALE, canvas });
        } else {
          // openAndRenderPage tries the auto dispatcher first and retries with
          // PDF.js if anything fails during render — defense in depth so a
          // native renderer gap can't leave the page silently blank.
          pdf = await openAndRenderPage(pdfBytes!, {
            pageNumber: originalPageNumber,
            scale: DEFAULT_RENDER_SCALE,
            canvas,
            forcePdfjs,
          });
          ownsDoc = true;
        }
        // safeRender now throws on failure; it never returns null. The dead
        // null-branch that produced the misleading "Both engines failed"
        // generic was removed v467. Real errors land in the outer catch
        // below and become the overlay text.
        if (cancelled) { if (ownsDoc) await pdf.destroy(); return; }
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
              // Malformed text items (some XFA/odd PDFs) can carry a short or
              // missing transform; indexing tx[4]/tx[5] would throw and break
              // the whole page's text/selection layer. Skip the bad item.
              if (!tx || tx.length < 6) continue;
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
        // Free the document only if we opened it ourselves — a shared doc is
        // owned by the parent. Viewport sizes are already locked into the page.
        if (ownsDoc) { try { await pdf.destroy(); } catch { /* ignore */ } }
      } catch (err) {
        // Surface the FULL error (name + message + page + size) so the
        // overlay actually tells the user what's wrong without DevTools.
        console.error('[pdf-editor] page render failed', { page: originalPageNumber, err });
        const e = err as { name?: string; message?: string };
        const name = e?.name && e.name !== 'Error' ? `${e.name}: ` : '';
        const msg = e?.message ?? String(err);
        setRenderError(`Page ${originalPageNumber} · ${name}${msg}`);
      }
    })();
    return () => { cancelled = true; };
  }, [pdfBytes, doc, originalPageNumber, forcePdfjs]);

  const localCoords = (e: React.MouseEvent | React.PointerEvent): Point => {
    const r = overlayRef.current?.getBoundingClientRect();
    if (!r) return { x: 0, y: 0 };
    return { x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (tool === 'hand') return;
    // Snap the placement point to the grid when enabled (affects click-to-place
    // tools + the start corner of drag-create geometry).
    const p = tool === 'select' ? localCoords(e) : snapPt(localCoords(e));

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
      const cat = stickyCategory ?? 'general';
      const meta = STICKY_CATEGORIES[cat];
      onAddAnnotation({ id: uid(), type: 'sticky', page: visualPageNumber, x: p.x, y: p.y, w: 180, h: 60, text, color: meta.ink, fillColor: meta.paper, category: cat, createdAt: new Date().toISOString() });
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
      // Literal hex, matching this file's own stamp default below: annotation
      // colors are consumed by sinks that cannot resolve var() — the PDF writer
      // takes numeric rgb, and the properties-panel <input type="color"> only
      // accepts #rrggbb (a CSS-var string there silently coerces to black).
      onAddAnnotation({ id: uid(), type: 'stamp', page: visualPageNumber, x: p.x, y: p.y, w, h, label: pendingStamp ?? 'CONFIDENTIAL', color: '#555555' });
      return;
    }
    if (tool === 'check' || tool === 'cross') {
      // Click-to-place a fixed-size glyph centered on the click point.
      const size = 24;
      onAddAnnotation({ id: uid(), type: tool, page: visualPageNumber, x: p.x - size / 2, y: p.y - size / 2, w: size, h: size, color, strokeWidth });
      return;
    }
    if (tool === 'pen') {
      setDrawing({ tool: 'pen', start: p, current: p, pen: [{ x: 0, y: 0 }] });
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      return;
    }
    if (tool === 'polygon' || tool === 'polyline' || tool === 'measureArea') {
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
    const rawP = localCoords(e);
    // Snap while drawing/dragging (not during free resize, where the handle math
    // already anchors the opposite edge).
    const p = (drawing || drag) ? snapPt(rawP) : rawP;
    if (polyDraft) {
      setPolyDraft({ ...polyDraft, cursor: p });
      // Don't return here — allow the rest of move to run if needed.
    }
    if (drawing) {
      if (drawing.tool === 'pen') {
        const rel = { x: p.x - drawing.start.x, y: p.y - drawing.start.y };
        setDrawing({ ...drawing, current: p, pen: [...(drawing.pen ?? []), rel] });
      } else if (drawing.tool === 'crop' && cropAspect && cropAspect > 0) {
        // Lock the crop drag to the chosen aspect ratio (w/h). Drive the box
        // off the dominant axis so dragging in any direction feels natural.
        const dx = p.x - drawing.start.x;
        const dy = p.y - drawing.start.y;
        const sx = dx < 0 ? -1 : 1;
        const sy = dy < 0 ? -1 : 1;
        let aw = Math.abs(dx);
        let ah = Math.abs(dy);
        if (aw / cropAspect >= ah) ah = aw / cropAspect; else aw = ah * cropAspect;
        setDrawing({ ...drawing, current: { x: drawing.start.x + sx * aw, y: drawing.start.y + sy * ah } });
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
      applyTransformMove(resize.id, { x: newX, y: newY, w: newW, h: newH });
      return;
    }
    if (drag) {
      const ann = annotations.find(a => a.id === drag.id);
      if (!ann) return;
      applyTransformMove(drag.id, { x: p.x - drag.offsetX, y: p.y - drag.offsetY });
    }
  };

  const onPointerUp = () => {
    // Gesture finished — the next drag/resize starts a fresh history snapshot.
    gestureSnapshotRef.current = false;
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
        else if (t === 'highlight') onAddAnnotation({ id: uid(), type: 'highlight', page: visualPageNumber, x, y, w, h, fillColor: '#999999' });
        else if (t === 'underline') onAddAnnotation({ id: uid(), type: 'underline', page: visualPageNumber, x, y, w, h, color, strokeWidth: sw });
        else if (t === 'strikethrough') onAddAnnotation({ id: uid(), type: 'strikethrough', page: visualPageNumber, x, y, w, h, color, strokeWidth: sw });
        else if (t === 'redact') onAddAnnotation({ id: uid(), type: 'redact', page: visualPageNumber, x, y, w, h });
        else if (t === 'cloud') onAddAnnotation({ id: uid(), type: 'cloud', page: visualPageNumber, x, y, w, h, color, strokeWidth: sw, scallopSize: 10 });
      } else if ((t === 'line' || t === 'arrow') && (Math.abs(current.x - start.x) > 2 || Math.abs(current.y - start.y) > 2)) {
        onAddAnnotation({ id: uid(), type: 'line', page: visualPageNumber, x: start.x, y: start.y, w: current.x - start.x, h: current.y - start.y, color, strokeWidth: sw, arrow: t === 'arrow' });
      } else if (t === 'measure' && (Math.abs(current.x - start.x) > 2 || Math.abs(current.y - start.y) > 2)) {
        // Distance between the two clicked points. Pixels → PDF points (÷ render
        // scale). When a real-world calibration is active, report calibrated
        // units; otherwise fall back to inches / points.
        const distPx = Math.hypot(current.x - start.x, current.y - start.y);
        const pts = distPx / DEFAULT_RENDER_SCALE;
        let label: string;
        if (calibration && calibration.realPerPdfPoint > 0) {
          const real = pts * calibration.realPerPdfPoint;
          label = `${real.toFixed(2)} ${calibration.unit}`;
        } else {
          const inches = pts / 72;
          label = inches >= 1 ? `${inches.toFixed(2)} in (${pts.toFixed(0)} pt)` : `${pts.toFixed(0)} pt`;
        }
        onAddAnnotation({ id: uid(), type: 'line', page: visualPageNumber, x: start.x, y: start.y, w: current.x - start.x, h: current.y - start.y, color, strokeWidth: sw, measureLabel: label });
      } else if (t === 'link' && w > 4 && h > 4) {
        const url = window.prompt('Hyperlink URL (e.g. https://...):', 'https://');
        if (url && /^(https?:|mailto:|tel:)/i.test(url)) {
          const text = window.prompt('Link label (visible in PDF):', url) || url;
          onAddAnnotation({ id: uid(), type: 'link', page: visualPageNumber, x, y, w, h, url, text });
        }
      } else if (t === 'formText' && w > 8 && h > 8) {
        const fieldName = window.prompt('Form field name (e.g. officer_name):', `field_${Date.now().toString(36)}`) || `field_${Date.now().toString(36)}`;
        onAddAnnotation({ id: uid(), type: 'formText', page: visualPageNumber, x, y, w, h, fieldName, label: fieldName });
      } else if (t === 'formCheck' && w > 8 && h > 8) {
        const fieldName = window.prompt('Checkbox field name (e.g. agree):', `check_${Date.now().toString(36)}`) || `check_${Date.now().toString(36)}`;
        const side = Math.min(w, h);
        onAddAnnotation({ id: uid(), type: 'formCheck', page: visualPageNumber, x, y, w: side, h: side, fieldName, label: fieldName });
      } else if (t === 'formDropdown' && w > 8 && h > 8) {
        const fieldName = window.prompt('Dropdown field name (e.g. disposition):', `dropdown_${Date.now().toString(36)}`) || `dropdown_${Date.now().toString(36)}`;
        const optsRaw = window.prompt('Options (comma-separated):', 'Option 1, Option 2, Option 3') || '';
        const options = optsRaw.split(',').map(s => s.trim()).filter(Boolean);
        if (options.length > 0) {
          onAddAnnotation({ id: uid(), type: 'formDropdown', page: visualPageNumber, x, y, w, h, fieldName, label: fieldName, options, defaultValue: options[0] });
        }
      } else if (t === 'formRadio' && w > 8 && h > 8) {
        const fieldName = window.prompt('Radio GROUP name (shared by all options, e.g. priority):', `radio_${Date.now().toString(36)}`) || `radio_${Date.now().toString(36)}`;
        const optsRaw = window.prompt('Options, top-to-bottom (comma-separated):', 'Yes, No') || '';
        const options = optsRaw.split(',').map(s => s.trim()).filter(Boolean);
        if (options.length > 0) {
          onAddAnnotation({ id: uid(), type: 'formRadio', page: visualPageNumber, x, y, w, h, fieldName, label: fieldName, options, defaultValue: options[0] });
        }
      } else if (t === 'formDate' && w > 8 && h > 8) {
        const fieldName = window.prompt('Date field name (e.g. report_date):', `date_${Date.now().toString(36)}`) || `date_${Date.now().toString(36)}`;
        onAddAnnotation({ id: uid(), type: 'formDate', page: visualPageNumber, x, y, w, h, fieldName, label: fieldName });
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
          const isArea = polyDraft.tool === 'measureArea';
          onAddAnnotation({
            id: uid(), type: 'polygon', page: visualPageNumber,
            x: minX, y: minY, w: maxX - minX || 1, h: maxY - minY || 1,
            points, closed: isArea ? true : polyDraft.tool === 'polygon',
            color, strokeWidth,
            ...(isArea && polyDraft.vertices.length >= 3 ? { areaLabel: areaLabelFor(polyDraft.vertices) } : {}),
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
                    + (polyDraft.tool === 'polygon' || polyDraft.tool === 'measureArea' ? ' Z' : '')}
                stroke={color}
                strokeWidth={strokeWidth * zoom}
                strokeDasharray={`${4 * zoom} ${3 * zoom}`}
                fill={polyDraft.tool === 'polygon' || polyDraft.tool === 'measureArea' ? 'rgba(212, 160, 23, 0.06)' : 'none'}
              />
              {polyDraft.vertices.map((v, i) => (
                <circle key={i} cx={v.x * zoom} cy={v.y * zoom} r={3} fill="#d4a017" stroke="#000" strokeWidth={0.5} />
              ))}
            </svg>
          )}
          {renderError && (
            <div className="absolute inset-0 flex items-center justify-center text-center p-4 pointer-events-none"
              style={{ background: 'rgba(220, 38, 38, 0.08)', border: '1px dashed rgba(220, 38, 38, 0.4)' }}>
              <div className="bg-surface-base border border-red-700/40 rounded-sm p-3 max-w-md text-[11px] pointer-events-auto">
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
                boxShadow: `inset 0 0 0 9999px rgba(0 0 0 / 0.55)`,
                clipPath: `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 ${pageMeta.crop.y * zoom}px, ${pageMeta.crop.x * zoom}px ${pageMeta.crop.y * zoom}px, ${pageMeta.crop.x * zoom}px ${(pageMeta.crop.y + pageMeta.crop.h) * zoom}px, ${(pageMeta.crop.x + pageMeta.crop.w) * zoom}px ${(pageMeta.crop.y + pageMeta.crop.h) * zoom}px, ${(pageMeta.crop.x + pageMeta.crop.w) * zoom}px ${pageMeta.crop.y * zoom}px, 0 ${pageMeta.crop.y * zoom}px)`,
              }} />
              <div className="absolute pointer-events-none border [border-color:var(--field-label-color)]" style={{
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
    // Per-annotation visual rotation (degrees, clockwise). Rotates about the
    // box center so it matches the save-time CTM. Omitted when 0 so unrotated
    // annotations keep their existing transform-free style.
    ...(ann.rotation ? { transform: `rotate(${ann.rotation}deg)`, transformOrigin: 'center center' } : {}),
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
    const linked = !!ann.url && /^(https?:|mailto:|tel:|#page=)/i.test(ann.url);
    inner = (
      <div onPointerDown={onPointerDown}
        title={linked ? `Link → ${ann.url}` : undefined}
        style={{ ...baseStyle, color: linked ? '#0046a1' : (ann.color ?? '#0a0a0a'), fontSize: ann.fontSize * zoom, fontWeight: ann.bold ? 700 : 400, fontStyle: ann.italic ? 'italic' : 'normal', fontFamily: 'Arial, sans-serif', whiteSpace: 'nowrap', userSelect: 'none', padding: 1, textDecoration: linked ? 'underline' : undefined, border: ann.showBorder ? `1px solid ${ann.color ?? '#d4a017'}` : undefined }}>
        {ann.text}
      </div>
    );
  } else if (ann.type === 'highlight') {
    inner = <div onPointerDown={onPointerDown} style={{ ...baseStyle, background: ann.fillColor ?? '#999999', opacity: (ann.opacity ?? 1) * 0.35, border: ann.showBorder ? `1px solid ${ann.color ?? '#d4a017'}` : undefined }} />;
  } else if (ann.type === 'underline') {
    inner = (
      <div onPointerDown={onPointerDown} style={{ ...baseStyle, opacity: ann.opacity ?? 1 }}>
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: Math.max(1, (ann.strokeWidth ?? 2) * zoom), background: ann.color ?? '#0a0a0a' }} />
      </div>
    );
  } else if (ann.type === 'strikethrough') {
    inner = (
      <div onPointerDown={onPointerDown} style={{ ...baseStyle, opacity: ann.opacity ?? 1 }}>
        <div style={{ position: 'absolute', left: 0, right: 0, top: '50%', transform: 'translateY(-50%)', height: Math.max(1, (ann.strokeWidth ?? 2) * zoom), background: ann.color ?? '#0a0a0a' }} />
      </div>
    );
  } else if (ann.type === 'redact') {
    const whiteOut = ann.redactStyle === 'white';
    inner = (
      <div onPointerDown={onPointerDown}
        title={ann.reason ? `Redaction — ${ann.reason}` : 'Redaction'}
        style={{ ...baseStyle, background: whiteOut ? '#fff' : '#000', border: whiteOut ? '1px solid #888' : undefined, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        {ann.reason && (
          <span style={{ color: whiteOut ? '#000' : '#fff', fontFamily: 'Arial, sans-serif', fontSize: Math.max(7, Math.min(ann.h * zoom * 0.5, 11)), letterSpacing: '0.02em', whiteSpace: 'nowrap', userSelect: 'none', padding: '0 2px' }}>
            {formatEnumValue(ann.reason)}
          </span>
        )}
      </div>
    );
  } else if (ann.type === 'rect') {
    const bs = ann.strokeStyle === 'dashed' ? 'dashed' : ann.strokeStyle === 'dotted' ? 'dotted' : 'solid';
    inner = <div onPointerDown={onPointerDown} style={{ ...baseStyle, border: `${(ann.strokeWidth ?? 1.5) * zoom}px ${bs} ${ann.color ?? '#0a0a0a'}`, background: ann.fillColor ?? 'transparent' }} />;
  } else if (ann.type === 'ellipse') {
    const bs = ann.strokeStyle === 'dashed' ? 'dashed' : ann.strokeStyle === 'dotted' ? 'dotted' : 'solid';
    inner = <div onPointerDown={onPointerDown} style={{ ...baseStyle, border: `${(ann.strokeWidth ?? 1.5) * zoom}px ${bs} ${ann.color ?? '#0a0a0a'}`, background: ann.fillColor ?? 'transparent', borderRadius: '50%' }} />;
  } else if (ann.type === 'line') {
    const lx = ann.w * zoom, ly = ann.h * zoom;
    const len = Math.hypot(lx, ly) || 1;
    const nx = -ly / len, ny = lx / len; // perpendicular unit
    const tick = 5 * zoom;
    const sw0 = (ann.strokeWidth ?? 1.5) * zoom;
    const dash = ann.strokeStyle === 'dashed' ? `${sw0 * 4} ${sw0 * 3}` : ann.strokeStyle === 'dotted' ? `${sw0} ${sw0 * 2}` : undefined;
    inner = (
      <svg onPointerDown={onPointerDown} style={{ ...baseStyle, overflow: 'visible' }}>
        <line x1={0} y1={0} x2={lx} y2={ly} stroke={ann.color ?? '#0a0a0a'} strokeWidth={(ann.strokeWidth ?? 1.5) * zoom} strokeDasharray={dash} />
        {ann.arrow && <ArrowHead x={lx} y={ly} dx={ann.w} dy={ann.h} color={ann.color ?? '#0a0a0a'} zoom={zoom} stroke={ann.strokeWidth ?? 1.5} />}
        {ann.measureLabel && (
          <>
            <line x1={nx * tick} y1={ny * tick} x2={-nx * tick} y2={-ny * tick} stroke={ann.color ?? '#0a0a0a'} strokeWidth={(ann.strokeWidth ?? 1.5) * zoom} />
            <line x1={lx + nx * tick} y1={ly + ny * tick} x2={lx - nx * tick} y2={ly - ny * tick} stroke={ann.color ?? '#0a0a0a'} strokeWidth={(ann.strokeWidth ?? 1.5) * zoom} />
            <text x={lx / 2} y={ly / 2 - 4 * zoom} fill={ann.color ?? '#0a0a0a'} fontSize={9 * zoom} textAnchor="middle" style={{ paintOrder: 'stroke', stroke: '#ffffff', strokeWidth: 2 * zoom }}>{ann.measureLabel}</text>
          </>
        )}
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
          fill={ann.closed && (ann.fillColor || ann.areaLabel) ? (ann.fillColor ?? 'rgba(212,160,23,0.08)') : 'none'} strokeLinejoin="round" />
        {ann.areaLabel && (
          <text x={ann.w * zoom / 2} y={ann.h * zoom / 2} fill={ann.color ?? '#0a0a0a'} fontSize={9 * zoom}
            textAnchor="middle" dominantBaseline="middle"
            style={{ paintOrder: 'stroke', stroke: '#ffffff', strokeWidth: 2 * zoom }}>{ann.areaLabel}</text>
        )}
      </svg>
    );
  } else if (ann.type === 'cloud') {
    // Revision cloud — SVG path of outward bulges around the box edges.
    const W = ann.w * zoom, H = ann.h * zoom;
    const bump = Math.max(4, (ann.scallopSize ?? 10) * zoom);
    const edge = (ax: number, ay: number, bx: number, by: number) => {
      const dx = bx - ax, dy = by - ay; const len = Math.hypot(dx, dy) || 1;
      const n = Math.max(1, Math.round(len / (bump * 2)));
      const ux = dx / len, uy = dy / len; const nx = -uy, ny = ux;
      let d = ''; let cx = ax, cy = ay;
      for (let i = 0; i < n; i++) {
        const seg = len / n;
        const mx = cx + ux * (seg / 2) + nx * bump;
        const my = cy + uy * (seg / 2) + ny * bump;
        const ex = ax + ux * seg * (i + 1), ey = ay + uy * seg * (i + 1);
        d += ` Q ${mx} ${my} ${ex} ${ey}`;
        cx = ex; cy = ey;
      }
      return d;
    };
    const path = `M 0 0${edge(0, 0, W, 0)}${edge(W, 0, W, H)}${edge(W, H, 0, H)}${edge(0, H, 0, 0)}`;
    inner = (
      <svg onPointerDown={onPointerDown} style={{ ...baseStyle, overflow: 'visible' }}>
        <path d={path} stroke={ann.color ?? '#0a0a0a'} strokeWidth={(ann.strokeWidth ?? 1.5) * zoom} fill={ann.fillColor ?? 'none'} strokeLinejoin="round" />
      </svg>
    );
  } else if (ann.type === 'check') {
    const W = ann.w * zoom, H = ann.h * zoom;
    inner = (
      <svg onPointerDown={onPointerDown} style={{ ...baseStyle, overflow: 'visible' }}>
        <path d={`M ${W * 0.15} ${H * 0.55} L ${W * 0.4} ${H * 0.82} L ${W * 0.85} ${H * 0.15}`}
          stroke={ann.color ?? '#0a0a0a'} strokeWidth={Math.max((ann.strokeWidth ?? 2) * zoom, H * 0.12)}
          fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  } else if (ann.type === 'cross') {
    const W = ann.w * zoom, H = ann.h * zoom;
    const lw = Math.max((ann.strokeWidth ?? 2) * zoom, H * 0.12);
    inner = (
      <svg onPointerDown={onPointerDown} style={{ ...baseStyle, overflow: 'visible' }}>
        <line x1={W * 0.18} y1={H * 0.18} x2={W * 0.82} y2={H * 0.82} stroke={ann.color ?? '#0a0a0a'} strokeWidth={lw} strokeLinecap="round" />
        <line x1={W * 0.82} y1={H * 0.18} x2={W * 0.18} y2={H * 0.82} stroke={ann.color ?? '#0a0a0a'} strokeWidth={lw} strokeLinecap="round" />
      </svg>
    );
  } else if (ann.type === 'image' || ann.type === 'signature') {
    inner = <img onPointerDown={onPointerDown} src={ann.imageData} alt="" style={{ ...baseStyle, objectFit: 'contain' }} />;
  } else if (ann.type === 'sticky') {
    const cat = ann.category ? STICKY_CATEGORIES[ann.category] : null;
    const paper = ann.fillColor ?? cat?.paper ?? '#fff7c2';
    const ink = ann.color ?? cat?.ink ?? '#0a0a0a';
    inner = (
      <div onPointerDown={onPointerDown} title={cat ? `${cat.label}: ${ann.text}` : ann.text}
        style={{ ...baseStyle, background: paper, color: ink, border: '1px solid #d4a017', boxShadow: '2px 2px 0 rgba(0 0 0 / 0.25)', padding: '4px 6px', fontFamily: 'Arial, sans-serif', fontSize: Math.max(10, ann.h * zoom * 0.18), userSelect: 'none', overflow: 'hidden' }}>
        {cat && (
          <span aria-hidden="true" style={{ position: 'absolute', top: 1, right: 3, fontWeight: 700, fontSize: Math.max(9, ann.h * zoom * 0.16), color: ink, opacity: 0.7 }}>{cat.glyph}</span>
        )}
        {ann.text}
      </div>
    );
  } else if (ann.type === 'link') {
    inner = (
      <div onPointerDown={onPointerDown} style={{ ...baseStyle, color: '#0046a1', textDecoration: 'underline', fontFamily: 'Arial, sans-serif', fontSize: Math.max(10, ann.h * zoom * 0.6), padding: 1, overflow: 'hidden', userSelect: 'none' }}
        title={`Link → ${ann.url}`}>
        {ann.text}
      </div>
    );
  } else if (ann.type === 'stamp') {
    const fontSize = Math.max(10, ann.h * zoom * 0.45);
    inner = (
      <div onPointerDown={onPointerDown} style={{ ...baseStyle, border: `${2.5 * zoom}px solid ${ann.color ?? '#555555'}`, color: ann.color ?? '#555555', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Arial, sans-serif', fontWeight: 800, fontSize, letterSpacing: '0.05em' }}>
        {String(ann.label).toUpperCase()}
      </div>
    );
  } else if (ann.type === 'formText') {
    inner = (
      <div onPointerDown={onPointerDown} title={`Form field: ${ann.fieldName}`}
        style={{ ...baseStyle, border: '1px solid #6b6b6b', background: 'rgba(212,160,23,0.06)', display: 'flex', alignItems: 'center', padding: '0 4px', fontFamily: 'Arial, sans-serif', fontSize: Math.max(8, ann.h * zoom * 0.4), color: '#888', userSelect: 'none', overflow: 'hidden' }}>
        {ann.defaultValue || ann.label || ann.fieldName}
      </div>
    );
  } else if (ann.type === 'formCheck') {
    const s = Math.min(ann.w, ann.h) * zoom;
    inner = (
      <div onPointerDown={onPointerDown} title={`Checkbox: ${ann.fieldName}`}
        style={{ ...baseStyle, width: s, height: s, border: '1px solid #6b6b6b', background: 'rgba(212,160,23,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--field-label-color)', fontSize: s * 0.7, userSelect: 'none' }}>
        {ann.defaultChecked ? '✓' : ''}
      </div>
    );
  } else if (ann.type === 'formDropdown') {
    inner = (
      <div onPointerDown={onPointerDown} title={`Dropdown: ${ann.fieldName} (${(ann.options ?? []).join(', ')})`}
        style={{ ...baseStyle, border: '1px solid #6b6b6b', background: 'rgba(212,160,23,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 4px', fontFamily: 'Helvetica, Arial, sans-serif', fontSize: Math.max(8, ann.h * zoom * 0.4), color: '#888', userSelect: 'none', overflow: 'hidden' }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ann.defaultValue || ann.label || ann.fieldName}</span>
        <span aria-hidden="true" style={{ color: 'var(--field-label-color)' }}>▾</span>
      </div>
    );
  } else if (ann.type === 'formRadio') {
    // Stack the radio options vertically inside the box (visual preview only).
    const opts = ann.options ?? [];
    const fs = Math.max(7, (ann.h * zoom) / Math.max(opts.length, 1) * 0.5);
    inner = (
      <div onPointerDown={onPointerDown} title={`Radio group: ${ann.fieldName}`}
        style={{ ...baseStyle, border: '1px dashed #6b6b6b', background: 'rgba(212,160,23,0.05)', display: 'flex', flexDirection: 'column', justifyContent: 'space-around', padding: '1px 3px', fontFamily: 'Arial, sans-serif', fontSize: fs, color: '#999', userSelect: 'none', overflow: 'hidden' }}>
        {opts.map((o, i) => (
          <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 3, whiteSpace: 'nowrap' }}>
            <span style={{ color: 'var(--field-label-color)' }}>{ann.defaultValue === o ? '◉' : '○'}</span>{o}
          </span>
        ))}
      </div>
    );
  } else if (ann.type === 'formDate') {
    inner = (
      <div onPointerDown={onPointerDown} title={`Date field: ${ann.fieldName}`}
        style={{ ...baseStyle, border: '1px solid #6b6b6b', background: 'rgba(212,160,23,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 4px', fontFamily: 'Arial, sans-serif', fontSize: Math.max(8, ann.h * zoom * 0.4), color: '#888', userSelect: 'none', overflow: 'hidden' }}>
        <span>{ann.defaultValue || 'MM/DD/YYYY'}</span>
        <span aria-hidden="true" style={{ color: 'var(--field-label-color)' }}>📅</span>
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
  if (tool === 'highlight') return <div style={{ ...style, background: '#999999', opacity: 0.25 }} />;
  if (tool === 'underline') return <div style={{ ...style, borderBottom: `${Math.max(1, strokeWidth * zoom)}px solid ${color}` }} />;
  if (tool === 'strikethrough') return <div style={{ ...style }}><div style={{ position: 'absolute', left: 0, right: 0, top: '50%', transform: 'translateY(-50%)', height: Math.max(1, strokeWidth * zoom), background: color }} /></div>;
  if (tool === 'redact') return <div style={{ ...style, background: '#000', opacity: 0.7 }} />;
  if (tool === 'formText' || tool === 'formCheck' || tool === 'formDropdown' || tool === 'formRadio' || tool === 'formDate') return <div style={{ ...style, border: '1px dashed #6b6b6b', background: 'rgba(212,160,23,0.1)' }} />;
  if (tool === 'cloud') return <div style={{ ...style, border: `${strokeWidth * zoom}px dashed ${color}`, borderRadius: 8 }} />;
  if (tool === 'line' || tool === 'arrow' || tool === 'measure') {
    const sx = (start.x - x) * zoom; const sy = (start.y - y) * zoom;
    const ex = (current.x - x) * zoom; const ey = (current.y - y) * zoom;
    const distPx = Math.hypot(current.x - start.x, current.y - start.y);
    const pts = distPx / DEFAULT_RENDER_SCALE; const inches = pts / 72;
    const liveLabel = inches >= 1 ? `${inches.toFixed(2)} in` : `${pts.toFixed(0)} pt`;
    return (
      <svg style={{ ...style, overflow: 'visible' }}>
        <line x1={sx} y1={sy} x2={ex} y2={ey} stroke={color} strokeWidth={strokeWidth * zoom} strokeDasharray="4 3" />
        {tool === 'measure' && (
          <text x={(sx + ex) / 2} y={(sy + ey) / 2 - 4} fill={color} fontSize={10 * zoom} textAnchor="middle"
            style={{ paintOrder: 'stroke', stroke: '#fff', strokeWidth: 2 }}>{liveLabel}</text>
        )}
      </svg>
    );
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
