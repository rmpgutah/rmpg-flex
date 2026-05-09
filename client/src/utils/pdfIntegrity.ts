// ============================================================
// RMPG Flex — PDF Document Integrity
//
// Two parallel hashes:
//   1. PAYLOAD hash — SHA-256 over canonical-JSON of the input
//      record. Stable across regenerations of the same DB row.
//      Goes in the per-page footer + the trailer page.
//      This is what a future Ed25519 signature (Phase D) will
//      sign, so the canonical form must match exactly between
//      generator and signer.
//
//   2. BYTE hash — SHA-256 over the rendered PDF bytes.
//      Non-deterministic but instance-bound. Computed AFTER
//      generation completes; not visible inside the PDF itself
//      (would create a bootstrap problem). Surfaced via the
//      download flow and intended for offline verification.
//
// Both answers different chain-of-custody questions:
//   - Payload: "does this PDF describe the same record state
//     that was in the database at print-time?"
//   - Byte:    "is this exact PDF copy unmodified since print?"
// ============================================================

// Fields stripped from canonical-JSON before hashing. These are
// either binary blobs that bloat the hash input, presentation
// state that the generator itself supplies, or fields that vary
// between regenerations of the same logical record.
const NON_CANONICAL_FIELDS = new Set<string>([
  '_officerSignature',
  '_signatureImage',
  '_logoBase64',
  '_sealBase64',
  '_dossier', // appendix data fetched at print-time, not part of the source row
  'connections', // connection graph profiles fetched at print-time
]);

/**
 * Recursively produce a canonical-JSON string with sorted keys,
 * dropped nullish values, and dropped non-canonical fields.
 *
 * Two parties hashing the same logical record MUST get the
 * same bytes — otherwise the legal value of the hash collapses.
 */
export function canonicalJsonStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'function') return null;
  if (typeof value !== 'object') return value;

  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  // Plain object — sort keys, drop blacklisted + nullish, recurse
  const obj = value as Record<string, unknown>;
  const sortedKeys = Object.keys(obj).sort();
  const out: Record<string, unknown> = {};
  for (const k of sortedKeys) {
    if (NON_CANONICAL_FIELDS.has(k)) continue;
    const v = obj[k];
    if (v === null || v === undefined) continue;
    out[k] = canonicalize(v);
  }
  return out;
}

/**
 * SHA-256 over UTF-8 bytes of the canonical-JSON form.
 * Returns lowercase hex (64 chars).
 */
export async function computePayloadHash(data: unknown): Promise<string> {
  const canonical = canonicalJsonStringify(data);
  const bytes = new TextEncoder().encode(canonical);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return bufferToHex(digest);
}

/**
 * SHA-256 over arbitrary bytes — used by the download flow to
 * hash the rendered PDF after generation completes.
 */
export async function computeByteHash(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const buf: ArrayBuffer = bytes instanceof Uint8Array
    ? (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
        ? (bytes.buffer as ArrayBuffer)
        : (bytes.slice().buffer as ArrayBuffer))
    : bytes;
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return bufferToHex(digest);
}

function bufferToHex(buf: ArrayBuffer): string {
  const view = new Uint8Array(buf);
  let hex = '';
  for (let i = 0; i < view.length; i++) {
    hex += view[i].toString(16).padStart(2, '0');
  }
  return hex;
}

// ── Active state (set by async wrappers, read by sync generators) ──

let activePayloadHash = '';

export function setActivePayloadHash(hex: string): void {
  activePayloadHash = (hex || '').toLowerCase();
}
export function getActivePayloadHash(): string {
  return activePayloadHash;
}
export function clearActivePayloadHash(): void {
  activePayloadHash = '';
}

// ── Signature state (Phase D — Ed25519 over payload hash + form context) ──

export interface PdfSignatureBundle {
  /** Base64 Ed25519 signature (88 chars). */
  signature: string;
  /** Base64 SPKI DER public key — printed on trailer for offline verification. */
  publicKey: string;
  /** ISO 8601 timestamp the signature was minted at (server clock). */
  signedAt: string;
  /** Always 'Ed25519' today; future algorithms may bind via this field. */
  algorithm: 'Ed25519';
}

let activeSignature: PdfSignatureBundle | undefined;

export function setActiveSignature(sig: PdfSignatureBundle | undefined): void {
  activeSignature = sig;
}
export function getActiveSignature(): PdfSignatureBundle | undefined {
  return activeSignature;
}
export function clearActiveSignature(): void {
  activeSignature = undefined;
}

/**
 * Fetch an Ed25519 signature from the server for the current
 * payload hash. Returns null on graceful failures (server has
 * no keypair configured, network error, non-200 response) so
 * callers can continue rendering an UNSIGNED trailer instead
 * of failing the whole PDF generation.
 */
export async function fetchPdfSignature(
  formKey: string,
  caseNumber: string,
  payloadHash: string,
): Promise<PdfSignatureBundle | null> {
  try {
    const res = await fetch('/api/pdf-tools/sign-payload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Auth header is set globally by the apiFetch interceptor in
        // most contexts; we use raw fetch here because we don't need
        // the response-shape coercion apiFetch applies.
        ...(getAuthHeader() ? { Authorization: getAuthHeader() } : {}),
      },
      body: JSON.stringify({ formKey, caseNumber, payloadHash }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (!json || typeof json.signature !== 'string') return null;
    return {
      signature: json.signature,
      publicKey: json.publicKey,
      signedAt: json.signedAt,
      algorithm: 'Ed25519',
    };
  } catch {
    return null;
  }
}

// Best-effort auth header lookup — mirrors useApi's strategy
// (token persisted in localStorage under 'authToken'). Kept
// inline here to avoid a circular import with hooks/useApi.
function getAuthHeader(): string {
  try {
    if (typeof localStorage === 'undefined') return '';
    const token = localStorage.getItem('authToken');
    return token ? `Bearer ${token}` : '';
  } catch {
    return '';
  }
}

/**
 * Format a base64 signature for the trailer page in 4-char
 * groups separated by spaces, twelve groups per line. 88 chars
 * → 22 groups → 2 lines, which fits the trailer block cleanly.
 */
export function formatSignatureGrouped(b64: string): string[] {
  if (!b64) return [];
  const groups: string[] = [];
  for (let i = 0; i < b64.length; i += 4) {
    groups.push(b64.slice(i, i + 4));
  }
  const lines: string[] = [];
  for (let i = 0; i < groups.length; i += 12) {
    lines.push(groups.slice(i, i + 12).join(' '));
  }
  return lines;
}

/** First 8 hex chars — what we show in the per-page footer to keep it scannable. */
export function getActivePayloadHashShort(): string {
  return activePayloadHash ? activePayloadHash.slice(0, 8) : '';
}

/**
 * Format a hash for the trailer page in 4-char groups separated
 * by spaces, four groups per line. Easier for a human to read
 * back to a verifier over the phone or transcribe to a log book.
 *
 *   abc12345 6789def0 12345678 9abcdef0
 *   ...
 */
export function formatHashGrouped(hex: string): string[] {
  if (!hex) return [];
  const groups: string[] = [];
  for (let i = 0; i < hex.length; i += 4) {
    groups.push(hex.slice(i, i + 4));
  }
  const lines: string[] = [];
  for (let i = 0; i < groups.length; i += 4) {
    lines.push(groups.slice(i, i + 4).join(' '));
  }
  return lines;
}
