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
  | 'measureArea'
  | 'formText'
  | 'formCheck'
  | 'formDropdown'
  | 'formRadio'
  | 'formDate';

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
  // stream beneath the box, but we render an opaque rectangle into the
  // saved page content. For maximum-sensitivity redaction, post-process with
  // a print-to-PDF round trip. UI warns the user about this.
  /** Bar fill style: 'black' (default, opaque black bar) or 'white' (white-out
   *  — paints an opaque white rectangle so the area reads as blank). */
  redactStyle?: 'black' | 'white';
  /** Optional exemption / reason label printed centered over the bar
   *  (e.g. "(b)(6)", "GRAMA 63G-2-302"). Drawn in contrasting ink. */
  reason?: string;
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
  /** When set, this is an AREA-measurement polygon — its computed area (e.g.
   *  "12.4 sq ft") is drawn at the centroid. Set by the area-measure tool and
   *  computed against the active MeasureCalibration. */
  areaLabel?: string;
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
  /** Categorisation tag (e.g. "Action", "Question", "Approved"). Drives the
   *  default note paper color + a small corner glyph. Surfaced in the
   *  Annotations panel filter. */
  category?: StickyCategory;
}

/** Sticky-note categories — each maps to a paper color + a marker glyph in
 *  STICKY_CATEGORIES (defined below). */
export type StickyCategory = 'general' | 'action' | 'question' | 'important' | 'approved' | 'rejected';

/** Category → {label, paper color, ink color, marker glyph}. Used by the sticky
 *  renderer and the category picker. Spillman-neutral palette (muted, no neon). */
export const STICKY_CATEGORIES: Record<StickyCategory, { label: string; paper: string; ink: string; glyph: string }> = {
  general:   { label: 'General',   paper: '#fff7c2', ink: '#0a0a0a', glyph: '•' },
  action:    { label: 'Action',    paper: '#ffe0b0', ink: '#0a0a0a', glyph: '▸' },
  question:  { label: 'Question',  paper: '#cfe3ff', ink: '#0a0a0a', glyph: '?' },
  important: { label: 'Important', paper: '#ffc9c9', ink: '#0a0a0a', glyph: '!' },
  approved:  { label: 'Approved',  paper: '#c9e7cf', ink: '#0a0a0a', glyph: '✓' },
  rejected:  { label: 'Rejected',  paper: '#e6c9c9', ink: '#7a1c1c', glyph: '✕' },
};

/** Fillable AcroForm field placed by the Form-Field tool. Written into the
 *  saved PDF as a real interactive widget via pdf-lib's form API (the editor
 *  routes any document containing form fields through the pdf-lib save path).
 *  In-app it renders as a labeled placeholder box so the operator sees where
 *  the field will land. */
export interface FormFieldAnnotation extends AnnotationBase {
  type: 'formText' | 'formCheck' | 'formDropdown' | 'formRadio' | 'formDate';
  /** Unique field name written into the AcroForm (e.g. "officer_name").
   *  For radio buttons this is the GROUP name shared by every option in the
   *  group; the selected option is `defaultValue`. */
  fieldName: string;
  /** Default value: text for formText/formDate, checked-state for formCheck,
   *  selected option for formDropdown/formRadio. */
  defaultValue?: string;
  defaultChecked?: boolean;
  /** Selectable options for formDropdown / formRadio (the choice list). */
  options?: string[];
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

/** Named in-app bookmark pointing at a page (1-indexed visual order).
 *  Bookmarks form a one-level hierarchy: a bookmark with `parentId` set is a
 *  child nested under that parent in the panel and the saved /Outlines tree. */
export interface Bookmark {
  id: string;
  title: string;
  page: number;
  /** Parent bookmark id when this is a child (nested) bookmark; undefined =
   *  top-level. The outline builder reads this to emit a nested tree. */
  parentId?: string;
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

/** Real-world measurement scale. The measure + area tools convert on-page PDF
 *  points into `unit` using `realPerPdfPoint` (how many real-world units one
 *  PDF point represents). Established by drawing a reference line of a known
 *  real length via the calibration dialog. null = uncalibrated (raw in/pt). */
export interface MeasureCalibration {
  /** Real-world units per single PDF point. */
  realPerPdfPoint: number;
  /** Unit label shown in measurement annotations, e.g. "ft", "m", "in". */
  unit: string;
  /** Human description of the reference, e.g. "1.00 in on page = 10 ft". */
  note?: string;
}

/** A saved annotation default ("favorite") — a named bundle of style props the
 *  operator can re-apply with one click. Persisted to localStorage. */
export interface AnnotationPreset {
  id: string;
  name: string;
  color: string;
  strokeWidth: number;
  opacity: number;
  strokeStyle?: 'solid' | 'dashed' | 'dotted';
  fontFamily?: 'helvetica' | 'times' | 'courier';
  fontSize?: number;
}

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
  /** Editor chrome theme — 'dark' (default Spillman pure-black) or 'light'
   *  (high-contrast light chrome for bright rooms). Affects ONLY the editor's
   *  surrounding UI, never the rendered PDF page. */
  chromeTheme: 'dark' | 'light';
  /** Saved annotation default presets ("favorites"). */
  annotationPresets: AnnotationPreset[];
  /** Active real-world measurement calibration — null when uncalibrated. */
  calibration: MeasureCalibration | null;
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
  chromeTheme: 'dark',
  annotationPresets: [],
  calibration: null,
};

// Recent-files entry for the in-app launcher.
export interface RecentFile {
  fileId: string;
  fileName: string;
  folderId: number | null;
  openedAt: number;
}
