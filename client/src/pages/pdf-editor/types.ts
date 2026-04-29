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
  | 'redact'
  | 'rect'
  | 'ellipse'
  | 'line'
  | 'arrow'
  | 'pen'
  | 'signature'
  | 'image'
  | 'stamp';

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

export interface ImageAnnotation extends AnnotationBase {
  type: 'image' | 'signature';
  imageData: string;        // data: URL (png/jpeg)
}

export interface StampAnnotation extends AnnotationBase {
  type: 'stamp';
  label: StampLabel | string;
}

export type Annotation =
  | TextAnnotation
  | HighlightAnnotation
  | RedactAnnotation
  | RectAnnotation
  | EllipseAnnotation
  | LineAnnotation
  | PenAnnotation
  | ImageAnnotation
  | StampAnnotation;

export interface PageMeta {
  /** Original 1-indexed page number from the loaded PDF. */
  originalIndex: number;
  /** Render width at scale 1.5, in CSS pixels. */
  width: number;
  height: number;
  /** Visual rotation applied on top of original page rotation. */
  rotation: 0 | 90 | 180 | 270;
}

export interface BatesConfig {
  prefix: string;           // e.g. "RMPG-2026-"
  startNumber: number;      // e.g. 1
  padding: number;          // zero-pad width (e.g. 5 → 00001)
  position: 'tl' | 'tr' | 'bl' | 'br';
  fontSize: number;
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
  meta: DocumentMeta;
}

export const DEFAULT_RENDER_SCALE = 1.5;
