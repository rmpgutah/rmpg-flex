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

import { nativeBackend } from './native';
import { pdfjsBackend } from './backends/pdfjs';
import { BackendUnsupportedError, RmpgPdfDocument } from './types';
import { recordOpen } from './diagnostics';

export interface OpenOptions {
  /** Optional file name for diagnostics. */
  fileName?: string;
  /** Force a specific backend. Useful for diagnostics + tests. */
  backend?: 'native' | 'pdfjs' | 'auto';
}

export async function open(bytes: Uint8Array, opts: OpenOptions = {}): Promise<RmpgPdfDocument> {
  const which = opts.backend ?? 'auto';

  // Single-backend modes — caller wants a specific one (e.g. "force PDF.js").
  if (which === 'native') return openWith(bytes, opts, true);
  if (which === 'pdfjs') return openWith(bytes, opts, false);

  // Auto mode: native first, fall back on unsupported feature.
  try {
    return await openWith(bytes, opts, true);
  } catch (err) {
    if (!(err instanceof BackendUnsupportedError)) throw err;
    // Fall through to PDF.js — record the reason for telemetry.
    return openWith(bytes, { ...opts, backend: 'pdfjs' }, false, `native fallback: ${err.reason}`);
  }
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
