// RMPG PDF Engine — public types.
//
// These are the only types the rest of the codebase should import. Backends
// (native / pdfjs) implement RmpgPdfBackend; the dispatcher in index.ts picks
// one per document and exposes a uniform RmpgPdfDocument to callers.
//
// Goal: zero direct pdfjs imports anywhere in the UI. Everything goes through
// this facade so we can swap or expand the native backend without touching
// editor or viewer code.

export interface RenderOptions {
  /** Render scale multiplier. 1 = native PDF point size, 1.5 matches editor default. */
  scale: number;
  /** Existing canvas to draw into; created if absent. */
  canvas?: HTMLCanvasElement;
}

export interface PageViewport {
  width: number;       // pixel width at the requested scale
  height: number;      // pixel height at the requested scale
  scale: number;
  rotation: number;    // 0 / 90 / 180 / 270 — original page rotation
}

export interface TextItem {
  /** Plain text content of this fragment (already Unicode-mapped). */
  str: string;
  /** Affine transform [a, b, c, d, e, f] mapping text space → page space. */
  transform: [number, number, number, number, number, number];
  /** Width in PDF points. */
  width: number;
  /** Height in PDF points (font ascent + descent for the run). */
  height: number;
}

export interface RmpgPdfPage {
  /** 1-indexed page number within the document. */
  pageNumber: number;
  /** Native viewport at scale 1. Multiply width/height by scale for output px. */
  getViewport(opts: { scale: number }): PageViewport;
  /** Render this page into a 2D canvas context. Returns when done. */
  render(opts: RenderOptions): Promise<HTMLCanvasElement>;
  /** Per-glyph text positions for the selection layer. May return [] if the
   *  page has no extractable text (image-only / scanned). */
  getTextContent(): Promise<TextItem[]>;
}

export interface RmpgPdfDocument {
  /** Total page count. */
  numPages: number;
  /** Which engine backend rendered this document — surfaced in diagnostics. */
  backend: BackendName;
  /** Reason the dispatcher chose this backend. */
  backendReason: string;
  /** Get a single page (1-indexed). */
  getPage(pageNumber: number): Promise<RmpgPdfPage>;
  /** Free underlying resources. Idempotent. */
  destroy(): Promise<void>;
}

export type BackendName = 'native' | 'pdfjs';

export interface RmpgPdfBackend {
  /** Backend identifier — used in diagnostics + telemetry. */
  name: BackendName;
  /** Try to open this byte buffer. Throws BackendUnsupportedError if the
   *  backend can't render the document — the dispatcher then falls back. */
  open(bytes: Uint8Array): Promise<RmpgPdfDocument>;
}

export class BackendUnsupportedError extends Error {
  constructor(public reason: string) {
    super(`Backend cannot render this document: ${reason}`);
    this.name = 'BackendUnsupportedError';
  }
}

export class RmpgPdfError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = 'RmpgPdfError';
  }
}

export interface DiagnosticEntry {
  fileName: string | null;
  backend: BackendName;
  reason: string;
  byteSize: number;
  numPages: number;
  openedAt: number;
}
