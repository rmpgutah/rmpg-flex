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

export async function downloadMultiCopyPdfV2<T>(
  schema: FormSchema<T>,
  data: T,
  copies: CitationCopyVariant[],
  filename: string,
  options?: DownloadOptions,
): Promise<void> {
  const doc = await renderMultiCopyPdfV2(
    schema, data, copies,
    { generatedAt: options?.generatedAt },
  );
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
