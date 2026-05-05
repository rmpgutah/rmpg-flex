// ============================================================
// v2DispatchAdapter — bridge between PrintRecordButton (legacy
// recordType) and the v2 sidecar-aware engine
// ============================================================
// Returns true when the record type was handled via v2
// (sidecar-embedded, optionally Ed25519-signed). Returns false
// for record types not yet migrated; the caller falls back to
// the legacy recordPdfGenerator path.
//
// The async-import pattern keeps the v2 engine + jspdf bundle
// out of the main page chunk for record types that aren't yet
// migrated — only the citation print site (which renders <50
// times per shift in practice) pays the load cost.

import { apiFetch } from '../../hooks/useApi';

export interface V2DispatchOptions {
  recordType: string;
  recordData: any;
  identifier?: string;
}

interface SignPayloadResponse {
  algorithm: 'Ed25519';
  signature: string;
  publicKey: string;
  signedAt: string;
}

/**
 * Best-effort: ask the server to sign a canonical payload hash.
 * Returns null on 503 (signing not configured) so callers can
 * proceed with an unsigned sidecar — the PDF still works, just
 * without court-grade attestation.
 */
async function signPayload(
  formKey: string, caseNumber: string, payloadHash: string,
): Promise<SignPayloadResponse | null> {
  try {
    const res = await apiFetch<SignPayloadResponse>('/pdf-tools/sign-payload', {
      method: 'POST',
      body: JSON.stringify({ formKey, caseNumber, payloadHash }),
    });
    return res;
  } catch {
    return null;
  }
}

/**
 * Dispatch a record print through the v2 engine if the record
 * type is migrated. Returns true on handled, false on
 * "not migrated, fall through to legacy."
 */
export async function tryV2Dispatch(opts: V2DispatchOptions): Promise<boolean> {
  if (opts.recordType !== 'citation') return false;

  const { downloadPdfV2, payloadHash } = await import('./v2');
  const { citationSchema, citationCanonicalData } = await import('./v2/forms/citation');

  const data = opts.recordData ?? {};
  const filename = `citation-${opts.identifier || data.citation_number || 'unknown'}.pdf`;
  const caseNumber = String(data.citation_number ?? '');

  // Compute canonical hash of the SCHEMA-PROJECTED data — that's
  // the hash the sidecar will record AND the hash signPayload
  // signs. Using citationCanonicalData (path-keyed, not raw row)
  // means rendering the same logical record twice always produces
  // the same hash even if the row gained extra columns.
  const projected = citationCanonicalData(data);
  const hash = await payloadHash(projected);

  const signature = caseNumber
    ? await signPayload('citation', caseNumber, hash)
    : null;

  await downloadPdfV2(citationSchema, data, filename, {
    schemaId: 'citation',
    caseNumber,
    signature: signature
      ? {
          algorithm: signature.algorithm,
          signature: signature.signature,
          publicKey: signature.publicKey,
          signedAt: signature.signedAt,
          payloadHash: hash,
        }
      : undefined,
  });
  return true;
}
