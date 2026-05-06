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

function mapServerViolations(rows: unknown): Array<{
  statute_citation: string;
  description: string;
  offense_level: 'Infraction' | 'Misdemeanor' | 'Felony';
  fine_amount: number;
}> {
  if (!Array.isArray(rows)) return [];
  return rows.map((r: any) => ({
    statute_citation: String(r?.statute_citation ?? ''),
    description: String(r?.violation_description ?? ''),
    offense_level: normalizeOffenseLevel(r?.offense_level),
    fine_amount: Number(r?.fine_amount ?? 0),
  }));
}

function normalizeOffenseLevel(raw: unknown): 'Infraction' | 'Misdemeanor' | 'Felony' {
  const s = String(raw ?? '').toLowerCase();
  if (s.startsWith('fel')) return 'Felony';
  if (s.startsWith('mis')) return 'Misdemeanor';
  return 'Infraction';
}

/**
 * Dispatch a record print through the v2 engine if the record
 * type is migrated. Returns true on handled, false on
 * "not migrated, fall through to legacy."
 */
export async function tryV2Dispatch(opts: V2DispatchOptions): Promise<boolean> {
  if (opts.recordType !== 'citation') return false;

  const { downloadMultiCopyPdfV2, payloadHash } = await import('./v2');
  const { citationSchema, citationCanonicalData } = await import('./v2/forms/citation');
  const { CITATION_INSTRUCTIONS } = await import('./v2/forms/citationInstructions');

  // Fetch joined violations + payments from /full when an id is available.
  // The server route returns {...row, violations[], payments[]}. Falls back
  // to opts.recordData on fetch failure (offline, server error) so prints
  // still work with whatever the upstream caller provided.
  let data = opts.recordData ?? {};
  if (data.id != null) {
    try {
      const full = await apiFetch<any>(`/citations/${data.id}/full`);
      data = { ...full, ...data };  // server fields baseline; upstream overrides win for any explicit overrides (e.g. signature_image)
      data.violations = mapServerViolations(full.violations);
    } catch {
      // Server fetch failed — fall through with original recordData. The
      // back-compat path in citation.ts will render flat single-violation
      // fields if violations[] is empty.
    }
  }
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

  await downloadMultiCopyPdfV2(citationSchema, data, CITATION_INSTRUCTIONS, filename, {
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
