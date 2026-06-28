import { renderPdfV2 } from './engine/renderer';
import { renderMultiCopyPdfV2 } from './engine/multiCopy';
import type { FormSchema } from './engine/types';
import type { CitationCopyVariant } from './forms/citationInstructions';
import { embedSidecar, outputWithSidecar, type SidecarPayload, type SidecarSignature } from './engine/sidecar';
export { renderPdfV2 } from './engine/renderer';
export { renderMultiCopyPdfV2 } from './engine/multiCopy';
export type { CitationCopyVariant } from './forms/citationInstructions';
export { embedSidecar, outputWithSidecar, extractSidecarFromBytes, canonicalize, payloadHash } from './engine/sidecar';
export type { SidecarPayload, SidecarSignature } from './engine/sidecar';

export interface DownloadOptions {
  /** Schema id (e.g. 'citation', 'incident') used in the sidecar. Required for round-trip extraction. */
  schemaId?: string;
  /** Case/citation/incident number — surfaces in the sidecar header. */
  caseNumber?: string;
  /** Optional pre-computed signature (set after calling /api/pdf-tools/sign-payload). */
  signature?: SidecarSignature;
  /** Override generatedAt for deterministic snapshots in tests. */
  generatedAt?: Date;
}

export async function downloadPdfV2<T>(
  schema: FormSchema<T>,
  data: T,
  filename: string,
  options?: DownloadOptions,
): Promise<void> {
  const doc = await renderPdfV2(schema, data, { generatedAt: options?.generatedAt });
  if (options?.schemaId) {
    const payload: SidecarPayload = {
      v: 1,
      schemaId: options.schemaId,
      formNumber: schema.meta.formNumber,
      caseNumber: options.caseNumber ?? '',
      generatedAt: (options.generatedAt ?? new Date()).toISOString(),
      data: data as unknown,
      signature: options.signature,
    };
    embedSidecar(doc, payload);
    const bytes = outputWithSidecar(doc);
    // Copy into a fresh ArrayBuffer to satisfy DOM Blob's BlobPart
    // type (Uint8Array<SharedArrayBuffer> isn't assignable).
    const ab = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(ab).set(bytes);
    const blob = new Blob([ab], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    return;
  }
  doc.save(filename);
}

/**
 * Render multi-copy PDF + sidecar embed and return final bytes.
 * Shared by download and blob-URL callers so both paths produce
 * byte-identical output (matters for sidecar round-trip tests).
 */
export async function renderMultiCopyPdfV2WithSidecar<T>(
  schema: FormSchema<T>,
  data: T,
  copies: CitationCopyVariant[],
  options?: DownloadOptions,
): Promise<Uint8Array> {
  const doc = await renderMultiCopyPdfV2(
    schema, data, copies,
    { generatedAt: options?.generatedAt },
  );
  if (!options?.schemaId) return new Uint8Array(doc.output('arraybuffer') as ArrayBuffer);
  const payload: SidecarPayload = {
    v: 1,
    schemaId: options.schemaId,
    formNumber: schema.meta.formNumber,
    caseNumber: options.caseNumber ?? '',
    generatedAt: (options.generatedAt ?? new Date()).toISOString(),
    data: data as unknown,
    signature: options.signature,
  };
  embedSidecar(doc, payload);
  return outputWithSidecar(doc);
}

function bytesToBlobUrl(bytes: Uint8Array): string {
  // Copy into a fresh ArrayBuffer to satisfy DOM Blob's BlobPart
  // type (Uint8Array<SharedArrayBuffer> isn't assignable).
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  const blob = new Blob([ab], { type: 'application/pdf' });
  return URL.createObjectURL(blob);
}

export async function downloadMultiCopyPdfV2<T>(
  schema: FormSchema<T>,
  data: T,
  copies: CitationCopyVariant[],
  filename: string,
  options?: DownloadOptions,
): Promise<void> {
  const bytes = await renderMultiCopyPdfV2WithSidecar(schema, data, copies, options);
  const url = bytesToBlobUrl(bytes);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Render multi-copy PDF + sidecar and return a blob URL for the
 * in-app PDF viewer. Caller is responsible for revoking the URL.
 */
export async function multiCopyPdfV2BlobUrl<T>(
  schema: FormSchema<T>,
  data: T,
  copies: CitationCopyVariant[],
  options?: DownloadOptions,
): Promise<string> {
  const bytes = await renderMultiCopyPdfV2WithSidecar(schema, data, copies, options);
  return bytesToBlobUrl(bytes);
}
