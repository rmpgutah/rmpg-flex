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
 * Citation-specific preamble: load v2 modules, fetch /full, map
 * violations, compute canonical hash, sign. Returns null when the
 * record type isn't migrated. Shared by download and viewer paths
 * so both produce byte-identical PDFs (sidecar parity).
 */
async function prepareCitationDispatch(opts: V2DispatchOptions) {
  if (opts.recordType !== 'citation') return null;

  const v2 = await import('./v2');
  const { citationSchema, citationCanonicalData } = await import('./v2/forms/citation');
  const { CITATION_INSTRUCTIONS } = await import('./v2/forms/citationInstructions');

  let data = opts.recordData ?? {};
  if (data.id != null) {
    try {
      const full = await apiFetch<any>(`/citations/${data.id}/full`);
      data = { ...full, ...data };
      data.violations = mapServerViolations(full.violations);
    } catch { /* fall through to back-compat flat fields */ }
  }
  const filename = `citation-${opts.identifier || data.citation_number || 'unknown'}.pdf`;
  const caseNumber = String(data.citation_number ?? '');
  const hash = await v2.payloadHash(citationCanonicalData(data));
  const signResp = caseNumber ? await signPayload('citation', caseNumber, hash) : null;
  const sidecarOptions = {
    schemaId: 'citation',
    caseNumber,
    signature: signResp
      ? {
          algorithm: signResp.algorithm,
          signature: signResp.signature,
          publicKey: signResp.publicKey,
          signedAt: signResp.signedAt,
          payloadHash: hash,
        }
      : undefined,
  };
  return { v2, citationSchema, CITATION_INSTRUCTIONS, data, filename, sidecarOptions };
}

/**
 * Dispatch a record print/download through the v2 engine if the
 * record type is migrated. Returns true on handled.
 */
export async function tryV2Dispatch(opts: V2DispatchOptions): Promise<boolean> {
  const ctx = await prepareCitationDispatch(opts);
  if (!ctx) return false;
  await ctx.v2.downloadMultiCopyPdfV2(
    ctx.citationSchema, ctx.data, ctx.CITATION_INSTRUCTIONS,
    ctx.filename, ctx.sidecarOptions,
  );
  return true;
}

/**
 * Same as tryV2Dispatch but returns a blob URL for the in-app PDF
 * viewer instead of triggering a download. Returns null when the
 * record type isn't migrated. Caller revokes the URL.
 */
export async function tryV2DispatchBlobUrl(opts: V2DispatchOptions): Promise<string | null> {
  const ctx = await prepareCitationDispatch(opts);
  if (!ctx) return null;
  return ctx.v2.multiCopyPdfV2BlobUrl(
    ctx.citationSchema, ctx.data, ctx.CITATION_INSTRUCTIONS,
    ctx.sidecarOptions,
  );
}
