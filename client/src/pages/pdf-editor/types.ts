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
  | 'cross'
  | 'measure'
  | 'formText'
  | 'formCheck';

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
  /** Draw a thin border around the annotation's bounding box. Used by
   *  highlights and text boxes (Acrobat "Border" toggle). When set, a 1px
   *  rule in `color` (or gold) is drawn around the box on screen + in the
   *  saved PDF. */
  showBorder?: boolean;
  /** Threaded discussion replies attached to this annotation (sticky notes +
   *  text). Each reply carries an author + timestamp, surfaced in the
   *  Annotations panel and the annotation-report PDF. */
  replies?: AnnotationReply[];
}

/** One reply in an annotation's discussion thread. */
export interface AnnotationReply {
  id: string;
  author: string;
  text: string;
  createdAt: string;       // ISO timestamp
}

export interface TextAnnotation extends AnnotationBase {
  type: 'text';
  text: string;
  fontSize: number;
  bold?: boolean;
  italic?: boolean;
  /** Font family for text annotations: helvetica (default), times, courier. */
  fontFamily?: 'helvetica' | 'times' | 'courier';
  /** Optional hyperlink target. When set, the text annotation becomes a
   *  clickable link (rendered as a real /Link annot in the interactive save
   *  path; underlined + tinted on screen). */
  url?: string;
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
  /** When set, this line is a measurement dimension line — its label (the
   *  computed distance, e.g. "3.42 in") is drawn at the midpoint with tick
   *  marks at each end. Set by the Measure tool. */
  measureLabel?: string;
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

/** Fillable AcroForm field placed by the Form-Field tool. Written into the
 *  saved PDF as a real interactive widget via pdf-lib's form API (the editor
 *  routes any document containing form fields through the pdf-lib save path).
 *  In-app it renders as a labeled placeholder box so the operator sees where
 *  the field will land. */
export interface FormFieldAnnotation extends AnnotationBase {
  type: 'formText' | 'formCheck';
  /** Unique field name written into the AcroForm (e.g. "officer_name"). */
  fieldName: string;
  /** Default value: text for formText, checked-state for formCheck. */
  defaultValue?: string;
  defaultChecked?: boolean;
  /** Placeholder/label shown in-app (not necessarily written to the PDF). */
  label?: string;
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
  | CrossAnnotation
  | FormFieldAnnotation;

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
  /** Manual deskew angle in degrees (positive = clockwise). Applied to the
   *  rendered page content at save time only — separate from the 90°-step
   *  `rotation` above. Used to straighten scans that came in slightly tilted. */
  deskew?: number;
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
  /** Numbering style for the {n} token:
   *  'decimal' (1,2,3 — default), 'roman' (i,ii,iii), 'Roman' (I,II,III),
   *  'alpha' (a,b,c), 'Alpha' (A,B,C). {total} always stays decimal. */
  style?: 'decimal' | 'roman' | 'Roman' | 'alpha' | 'Alpha';
}

/** A custom page-label rule: pages in the (1-indexed visual) range
 *  [from, to] are numbered with `style`, prefixed by `prefix`, starting the
 *  count at `start`. Used by the footer's {label} token. Rules are applied in
 *  array order; later rules win on overlap. */
export interface PageLabelRule {
  id: string;
  from: number;
  to: number;
  prefix: string;
  style: 'decimal' | 'roman' | 'Roman' | 'alpha' | 'Alpha';
  start: number;
}

export interface WatermarkConfig {
  text: string;
  opacity: number;          // 0..1
  fontSize: number;
  rotation: number;         // degrees
  /** Placement style. 'diagonal' (default) draws one centered, rotated stamp.
   *  'tiled' repeats the text across the whole page in a grid. */
  mode?: 'diagonal' | 'tiled';
  /** Optional image watermark (data: URL). When set, the image is drawn
   *  centered instead of / in addition to the text. */
  imageData?: string;
}

/** Header / footer text stamped on every page, distinct from the simple
 *  "Page N of M" footer. Three slots per band (left/center/right). Supports
 *  the {n}/{total} tokens like page numbers. */
export interface HeaderFooterConfig {
  headerLeft?: string;
  headerCenter?: string;
  headerRight?: string;
  footerLeft?: string;
  footerCenter?: string;
  footerRight?: string;
  fontSize: number;
}

/** Named in-app bookmark pointing at a page (1-indexed visual order). */
export interface Bookmark {
  id: string;
  title: string;
  page: number;
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
  /** Custom header/footer text bands — null when disabled. */
  headerFooter?: HeaderFooterConfig | null;
  /** Custom page-label rules — drive the {label} token in the page-number
   *  footer. Empty / undefined = plain sequential numbering. */
  pageLabels?: PageLabelRule[];
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
