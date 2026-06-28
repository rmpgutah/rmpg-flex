// ============================================================
// pdfSidecarReader — server-side extraction of v2 PDF sidecars
// ============================================================
// Mirrors client/src/utils/pdf/v2/engine/sidecar.ts (the writer
// side). The two MUST stay byte-compatible: a PDF embedded by
// the client is parsed by this module, and re-rendering on the
// client from the data we return here must produce a PDF with
// the same payloadHash.
//
// Why regex-on-raw-bytes instead of a full PDF parser:
//   - We control the marker format on both ends, so we don't need
//     a parser that handles arbitrary PDFs.
//   - Server has no pdf-lib dep and we don't want to add one for a
//     fixed-shape lookup.
//   - The two embed locations (Keywords + post-EOF) are both
//     trivially regex-locatable in raw bytes.
//
// Cross-domain canonicalization: the canonical JSON used to compute
// the sidecar's payloadHash is *the same* canonicalization the
// /api/pdf-tools/sign-payload endpoint hashes. That's by design —
// a verified signature implies the embedded data is unaltered AND
// matches what the issuer signed.

import crypto from 'crypto';

const KEYWORDS_PREFIX = 'RMPG-SIDECAR-V1:';
const POST_EOF_BEGIN = '%RMPG_SIDECAR_BEGIN ';
const POST_EOF_END = ' RMPG_SIDECAR_END%';

export interface SidecarSignature {
  algorithm: 'Ed25519';
  publicKey: string;
  signature: string;
  signedAt: string;
  payloadHash: string;
}

export interface SidecarPayload {
  v: 1;
  schemaId: string;
  formNumber: string;
  caseNumber: string;
  generatedAt: string;
  data: unknown;
  signature?: SidecarSignature;
}

export interface SidecarReadResult {
  payload: SidecarPayload;
  /** 'keywords' | 'post-eof' — which location won. Useful for diagnostics. */
  source: 'keywords' | 'post-eof';
}

/**
 * Canonical JSON identical to the client's canonicalize(): keys
 * sorted alphabetically (recursive), no whitespace.
 */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  const sorted: Record<string, unknown> = {};
  for (const k of Object.keys(value as Record<string, unknown>).sort()) {
    sorted[k] = sortKeysDeep((value as Record<string, unknown>)[k]);
  }
  return sorted;
}

export function payloadHash(value: unknown): string {
  return crypto.createHash('sha256').update(canonicalize(value), 'utf8').digest('hex');
}

function decodeSidecar(b64: string): SidecarPayload {
  const json = Buffer.from(b64, 'base64').toString('utf8');
  const parsed = JSON.parse(json) as SidecarPayload;
  if (parsed?.v !== 1) {
    throw new Error(`Unsupported sidecar version: ${(parsed as any)?.v}`);
  }
  return parsed;
}

/**
 * Try Keywords first, then post-EOF marker. Returns null if neither
 * is present; throws nothing on malformed payloads (returns null
 * with a diagnostic in `error`).
 */
export function extractSidecar(pdfBytes: Buffer | Uint8Array): SidecarReadResult | null {
  // Treat as Latin-1 for marker scanning — markers are pure ASCII.
  const buf = Buffer.isBuffer(pdfBytes) ? pdfBytes : Buffer.from(pdfBytes);
  const text = buf.toString('latin1');

  // Path 1: /Keywords (RMPG-SIDECAR-V1:<base64>)
  const kwMatch = text.match(/\/Keywords\s*\((RMPG-SIDECAR-V1:[A-Za-z0-9+/=]+)\)/);
  if (kwMatch) {
    const b64 = kwMatch[1].slice(KEYWORDS_PREFIX.length);
    try {
      return { payload: decodeSidecar(b64), source: 'keywords' };
    } catch { /* try fallback */ }
  }

  // Path 2: post-EOF marker.
  const beginIdx = text.lastIndexOf(POST_EOF_BEGIN);
  if (beginIdx >= 0) {
    const endIdx = text.indexOf(POST_EOF_END, beginIdx);
    if (endIdx > beginIdx) {
      const b64 = text.slice(beginIdx + POST_EOF_BEGIN.length, endIdx);
      try {
        return { payload: decodeSidecar(b64), source: 'post-eof' };
      } catch { /* fall through */ }
    }
  }
  return null;
}
