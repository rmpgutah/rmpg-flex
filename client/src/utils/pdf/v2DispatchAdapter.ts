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
//
// ISOLATION (Wave 3.1 follow-on): the pre-wave-3.1 code imported
// apiFetch from hooks/useApi, which is auth-coupled and redirects
// to /login on 401, tearing down the app mid-PDF-generation.
// Same pattern as c0f34f20 (pdfStaticMap), pdfImageHelpers.ts,
// and warrantPacket.ts. Now uses raw fetch + localStorage JWT.

import { importWithRetry } from '../importWithRetry';
import type { PdfSignatureBundle } from '../pdfIntegrity';
import { resolveApiHttpBase, WORKER_HTTP_ORIGIN } from '../apiOrigin';

// Isolated fetch — mirrors the getAuthToken + fetch pattern from
// pdfImageHelpers.ts & pdfIntegrity.ts, but inlined here to keep
// the v2 adapter self-contained (no shared fetch util yet).
function getAuthToken(): string {
  try {
    if (typeof localStorage === 'undefined') return '';
    return localStorage.getItem('rmpg_token') || '';
  } catch { return ''; }
}

async function isolatedFetch<T>(url: string, opts: RequestInit = {}): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const token = getAuthToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json', ...((opts.headers as Record<string, string>) || {}) };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(url, { ...opts, headers, signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
  finally { clearTimeout(timer); }
}

function apiBase(): string {
  if (typeof window === 'undefined') return WORKER_HTTP_ORIGIN;
  return resolveApiHttpBase({
    isDev: Boolean(import.meta.env?.DEV),
    hostname: window.location.hostname,
  });
}

export interface V2DispatchOptions {
  recordType: string;
  recordData: any;
  identifier?: string;
}

/**
 * Best-effort: ask the server to sign a canonical payload hash.
 * Returns null on 503 (signing not configured) so callers can
 * proceed with an unsigned sidecar — the PDF still works, just
 * without court-grade attestation.
 */
async function signPayload(
  formKey: string, caseNumber: string, payloadHash: string,
): Promise<PdfSignatureBundle | null> {
  try {
    const res = await isolatedFetch<PdfSignatureBundle>(`${apiBase()}/api/pdf-tools/sign-payload`, {
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

  const v2 = await importWithRetry(() => import('./v2'));
  const { citationSchema, citationCanonicalData } = await importWithRetry(() => import('./v2/forms/citation'));
  const { CITATION_INSTRUCTIONS } = await importWithRetry(() => import('./v2/forms/citationInstructions'));

  let data = opts.recordData ?? {};
  if (data.id != null) {
    try {
      const full = await isolatedFetch<any>(`${apiBase()}/api/citations/${data.id}/full`);
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
          algorithmVersion: signResp.algorithmVersion,
          ed25519: signResp.ed25519,
          mlDsa87: signResp.mlDsa87,
          slhDsa256f: signResp.slhDsa256f,
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
