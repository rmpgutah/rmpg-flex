// RMPG PDF Engine — public dispatcher.
//
// Every PDF view in the app calls open() instead of importing pdfjs
// directly. The dispatcher tries the native backend first; on
// BackendUnsupportedError it falls back to PDF.js. Both produce the same
// RmpgPdfDocument shape so call-sites are backend-agnostic.
//
// See ./README.md for scope, current native-backend coverage, and roadmap.

export type { RmpgPdfDocument, RmpgPdfPage, PageViewport, RenderOptions, TextItem, BackendName, DiagnosticEntry } from './types';
export { BackendUnsupportedError, RmpgPdfError } from './types';
export { recordOpen, getDiagnostics, subscribeDiagnostics, diagnosticsSummary } from './diagnostics';
// Writer surface — proprietary PDF byte writer (see native/writer/).
export { RmpgPdfBuilder, ContentStreamBuilder, type BuilderMetadata } from './native/writer';
// Defense-in-depth render helper that retries with PDF.js on any failure.
export { openAndRenderPage } from './safeRender';

import { nativeBackend } from './native';
import { pdfjsBackend } from './backends/pdfjs';
import { RmpgPdfDocument } from './types';
import { recordOpen } from './diagnostics';

export interface OpenOptions {
  /** Optional file name for diagnostics. */
  fileName?: string;
  /** Force a specific backend. Useful for diagnostics + tests. */
  backend?: 'native' | 'pdfjs' | 'auto';
}

export async function open(bytes: Uint8Array, opts: OpenOptions = {}): Promise<RmpgPdfDocument> {
  const which = opts.backend ?? 'auto';

  // Single-backend modes — caller wants a specific one.
  if (which === 'native') return openWith(bytes, opts, true);
  if (which === 'pdfjs') return openWith(bytes, opts, false);

  // Auto mode: PDF.js (Mozilla, Apache 2.0) is the default reliable engine.
  // The native backend is OPT-IN via `backend: 'native'` for documents we
  // know it can handle (jsPDF-generated PDFs etc.) — it's the future, but
  // its coverage is too narrow today to be the default and the user
  // experience suffers when it can't render things.
  return openWith(bytes, opts, false);
}

async function openWith(
  bytes: Uint8Array,
  opts: OpenOptions,
  preferNative: boolean,
  fallbackNote?: string,
): Promise<RmpgPdfDocument> {
  const backend = preferNative ? nativeBackend : pdfjsBackend;
  const doc = await backend.open(bytes);
  if (fallbackNote) (doc as any).backendReason = `${doc.backendReason}; ${fallbackNote}`;
  recordOpen({
    fileName: opts.fileName ?? null,
    backend: doc.backend,
    reason: doc.backendReason,
    byteSize: bytes.byteLength,
    numPages: doc.numPages,
    openedAt: Date.now(),
  });
  return doc;
}
