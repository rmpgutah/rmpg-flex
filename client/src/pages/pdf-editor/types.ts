// Shared types for the integrated PDF editor.
//
// Coordinate system invariant: every annotation stores screen-pixel coordinates
// at the canvas render scale (default 1.5). The save pipeline (save.ts) performs
// the single conversion to PDF user-space at flatten time. Do NOT mix systems.

export type Tool =
  | 'select'
  | 'hand'
  | 'text'
  | 'highlight'
  | 'underline'
  | 'strikethrough'
  | 'redact'
  | 'rect'
  | 'ellipse'
  | 'line'
  | 'arrow'
  | 'pen'
  | 'signature'
  | 'image'
  | 'stamp'
  | 'link'
  | 'crop'
  | 'barcode'
  | 'sticky'
  | 'datestamp'
  | 'eyedropper'
  | 'polygon'
  | 'polyline'
  | 'cloud'
  | 'check'
  | 'cross';

export type StampLabel =
  | 'CONFIDENTIAL'
  | 'EVIDENCE'
  | 'COPY'
  | 'ORIGINAL'
  | 'DRAFT'
  | 'APPROVED'
  | 'VOID'
  | 'FILED'
  | 'RECEIVED';

export interface Point { x: number; y: number; }

export interface AnnotationBase {
  id: string;
  page: number;            // 1-indexed page number in the *current* visual order
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;       // visual rotation in degrees
  opacity?: number;        // 0..1
  color?: string;          // CSS hex (#rrggbb)
  fillColor?: string;
  strokeWidth?: number;
  /** Stroke style for shapes / lines: solid (default), dashed, dotted. */
  strokeStyle?: 'solid' | 'dashed' | 'dotted';
  /** When true, drag/resize/keyboard-delete are disabled. */
  locked?: boolean;
  /** Stacking order — higher = drawn later (on top). Defaults to insertion order. */
  zIndex?: number;
  /** Optional logical layer name (e.g. "Redaction", "Markup", "Signoff").
   *  The properties panel can toggle layer visibility globally. */
  layer?: string;
  /** Free-form note attached to the annotation, surfaced in the
   *  Annotations panel and on hover. */
  note?: string;
  /** Author who created this annotation (auto-set from current user on add). */
  authorName?: string;
  authorId?: number;
  /** ISO timestamp of creation. Used in audit exports. */
  createdAt?: string;
  /** Workflow status — useful for review-cycle docs. */
  status?: 'open' | 'in-review' | 'resolved';
}

export interface TextAnnotation extends AnnotationBase {
  type: 'text';
  text: string;
  fontSize: number;
  bold?: boolean;
  italic?: boolean;
}

export interface HighlightAnnotation extends AnnotationBase {
  type: 'highlight';
}

/** Text-markup underline — a thin rule along the bottom of the dragged box. */
export interface UnderlineAnnotation extends AnnotationBase {
  type: 'underline';
}

/** Text-markup strikethrough — a thin rule through the middle of the box. */
export interface StrikethroughAnnotation extends AnnotationBase {
  type: 'strikethrough';
}

export interface RedactAnnotation extends AnnotationBase {
  type: 'redact';
  // visual-flatten redaction. Caveat: pdf-lib can't strip the original content
  // stream beneath the box, but we render an opaque black rectangle into the
  // saved page content. For maximum-sensitivity redaction, post-process with
  // a print-to-PDF round trip. UI warns the user about this.
}

export interface RectAnnotation extends AnnotationBase {
  type: 'rect';
}

export interface EllipseAnnotation extends AnnotationBase {
  type: 'ellipse';
}

export interface LineAnnotation extends AnnotationBase {
  type: 'line';
  arrow?: boolean;          // when true, render with an arrowhead at (x+w, y+h)
}

export interface PenAnnotation extends AnnotationBase {
  type: 'pen';
  points: Point[];          // relative to (x, y)
}

export interface PolygonAnnotation extends AnnotationBase {
  type: 'polygon';
  /** Vertices in screen-pixel coords relative to (x, y). */
  points: Point[];
  /** When true, the path closes back to the first vertex (filled polygon).
   *  When false, render as a polyline (open path). */
  closed: boolean;
}

export interface CloudAnnotation extends AnnotationBase {
  type: 'cloud';
  /** Number of scallops along each edge — controls cloud "fluffiness". */
  scallopSize?: number;
}

/** Checkmark (✓) glyph — drawn as two strokes inside the bounding box. */
export interface CheckAnnotation extends AnnotationBase {
  type: 'check';
}

/** Cross / X (✗) glyph — drawn as two diagonal strokes inside the box. */
export interface CrossAnnotation extends AnnotationBase {
  type: 'cross';
}

export interface ImageAnnotation extends AnnotationBase {
  type: 'image' | 'signature';
  imageData: string;        // data: URL (png/jpeg)
}

export interface StampAnnotation extends AnnotationBase {
  type: 'stamp';
  label: StampLabel | string;
}

export interface LinkAnnotation extends AnnotationBase {
  type: 'link';
  url: string;
  text: string;            // visible label drawn over the rectangle
}

export interface StickyNoteAnnotation extends AnnotationBase {
  type: 'sticky';
  text: string;
  authorName?: string;
  createdAt?: string;
}

export type Annotation =
  | TextAnnotation
  | HighlightAnnotation
  | UnderlineAnnotation
  | StrikethroughAnnotation
  | RedactAnnotation
  | RectAnnotation
  | EllipseAnnotation
  | LineAnnotation
  | PenAnnotation
  | ImageAnnotation
  | StampAnnotation
  | LinkAnnotation
  | StickyNoteAnnotation
  | PolygonAnnotation
  | CloudAnnotation
  | CheckAnnotation
  | CrossAnnotation;

/** Per-page crop rectangle in screen-pixel coordinates at DEFAULT_RENDER_SCALE.
 *  Applied via pdf-lib setMediaBox at save time. */
export interface PageCrop {
  x: number; y: number; w: number; h: number;
}

export interface PageMeta {
  /** Original 1-indexed page number from the loaded PDF. */
  originalIndex: number;
  /** Render width at scale 1.5, in CSS pixels. */
  width: number;
  height: number;
  /** Visual rotation applied on top of original page rotation. */
  rotation: 0 | 90 | 180 | 270;
  /** Crop rectangle in screen-pixel coordinates; null = full page. */
  crop?: PageCrop | null;
}

export interface CustomStamp {
  id: string;
  label: string;
  imageData: string;       // data: URL
}

export interface BatesConfig {
  prefix: string;           // e.g. "RMPG-2026-"
  startNumber: number;      // e.g. 1
  padding: number;          // zero-pad width (e.g. 5 → 00001)
  position: 'tl' | 'tr' | 'bl' | 'br';
  fontSize: number;
}

/** Simple page-number footer — "Page N of M". Distinct from Bates numbering:
 *  no prefix/padding, always sequential 1..pageCount, centered footer position
 *  options. Stamped at save time alongside (and independent of) Bates. */
export interface PageNumbersConfig {
  /** Footer placement. */
  position: 'bl' | 'bc' | 'br';
  fontSize: number;
  /** Template — {n} = current page, {total} = page count. */
  format: string;           // e.g. "Page {n} of {total}"
}

export interface WatermarkConfig {
  text: string;
  opacity: number;          // 0..1
  fontSize: number;
  rotation: number;         // degrees
}

export interface DocumentMeta {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string;
}

export interface EditorState {
  bytes: Uint8Array | null;
  fileName: string;
  /** Visual order of pages — entries reference originalIndex. Pages dropped from
   *  this array are excluded from the saved output. */
  pageOrder: number[];
  pages: PageMeta[];
  annotations: Annotation[];
  bates: BatesConfig | null;
  watermark: WatermarkConfig | null;
  /** Simple "Page N of M" footer — null when disabled. */
  pageNumbers?: PageNumbersConfig | null;
  meta: DocumentMeta;
  /** Source file in the Documents store, when the editor was opened from there. */
  sourceFileId?: string | null;
  sourceFolderId?: number | null;
}

export const DEFAULT_RENDER_SCALE = 1.5;

// View / interaction preferences — persisted to localStorage by the editor.
export interface EditorPreferences {
  viewMode: 'single' | 'continuous' | 'two-up';
  snapToGrid: boolean;
  gridSize: number;            // PDF points
  defaultTool: Tool;
  recentColors: string[];      // up to 12
  layerVisibility: Record<string, boolean>;
  showAnnotationsPanel: boolean;
  autoSaveDrafts: boolean;
  readingMode: boolean;        // hide chrome for distraction-free viewing
  colorBlindPalette: boolean;  // use a CB-friendly default color set
  showRulers: boolean;
  showGrid: boolean;
  /** Page-thumbnail rail size. */
  thumbnailSize: 'small' | 'large';
  /** When true, the editor zooms to fit page width as soon as a PDF loads. */
  fitWidthOnLoad: boolean;
}

export const DEFAULT_PREFERENCES: EditorPreferences = {
  viewMode: 'continuous',
  snapToGrid: false,
  gridSize: 6,
  defaultTool: 'select',
  recentColors: ['#0a0a0a', '#555555', '#888888', '#aaaaaa', '#cccccc'],
  layerVisibility: {},
  showAnnotationsPanel: false,
  autoSaveDrafts: true,
  readingMode: false,
  colorBlindPalette: false,
  showRulers: false,
  showGrid: false,
  thumbnailSize: 'small',
  fitWidthOnLoad: true,
};

// Recent-files entry for the in-app launcher.
export interface RecentFile {
  fileId: string;
  fileName: string;
  folderId: number | null;
  openedAt: number;
}
