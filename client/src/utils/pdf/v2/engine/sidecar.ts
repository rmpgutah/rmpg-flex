// ============================================================
// Sidecar — embed canonical record data inside generated PDFs
// ============================================================
// The v2 form engine renders PDFs from a {schema, data} pair.
// We persist `data` itself inside the PDF so extraction is
// loss-free: the PDF is both a printable artifact AND the
// machine-readable source of record. Round-trip parity = re-render
// from the embedded data, hash, compare to the original render.
//
// Dual-redundant embed:
//   1. PDF Info Dict /Keywords = "RMPG-SIDECAR-V1:<base64>"
//      Preserved through qpdf encryption (Gotcha #46) and most
//      PDF transforms.
//   2. Post-%%EOF comment marker (also base64). Survives some
//      tools that strip Info dicts (linearizers, PDF/A converters).
// Reader prefers (1), falls back to (2) — either alone is enough.
//
// Canonicalization: keys sorted alphabetically (recursive), no
// whitespace. The same canonical bytes are used for both signing
// (sha256 → /api/pdf-tools/sign-payload) and round-trip hash
// comparison, so a verified signature implies the embedded data
// matches the rendered output bit-for-bit.

import jsPDF from 'jspdf';

const SIDECAR_VERSION = 1 as const;
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
  v: typeof SIDECAR_VERSION;
  schemaId: string;
  formNumber: string;
  caseNumber: string;
  generatedAt: string;
  data: unknown;
  signature?: SidecarSignature;
}

/**
 * Canonical JSON: recursive alphabetical key sort, no whitespace,
 * UTF-8. Stable across runs so payloadHash stays comparable.
 *
 * Arrays preserve order (significant), objects sort keys.
 * undefined values dropped (matches JSON.stringify semantics).
 * NaN/Infinity become null (same as JSON.stringify).
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

/**
 * SHA-256 hex of canonical JSON. Browser-side WebCrypto.
 */
export async function payloadHash(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalize(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Encode a sidecar to its base64 wire form. Same encoder used for
 * both the Keywords entry and the post-EOF marker.
 */
function encodeSidecar(payload: SidecarPayload): string {
  const json = canonicalize(payload);
  // btoa expects a binary string; Latin-1 path mangles UTF-8, so
  // we go via Uint8Array → binary chars.
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function decodeSidecar(b64: string): SidecarPayload {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const json = new TextDecoder('utf-8').decode(bytes);
  const parsed = JSON.parse(json) as SidecarPayload;
  if (parsed?.v !== SIDECAR_VERSION) {
    throw new Error(`Unsupported sidecar version: ${(parsed as any)?.v}`);
  }
  return parsed;
}

/**
 * Embed the sidecar into a jsPDF document. Mutates the doc's Info
 * dict (Keywords) AND appends a post-EOF marker. Idempotent —
 * calling twice with the same payload produces the same bytes.
 *
 * Must be called *before* doc.output()/save() — the post-EOF
 * marker is written via a downstream wrapper because jsPDF
 * itself terminates the file at output time.
 */
export function embedSidecar(doc: jsPDF, payload: SidecarPayload): void {
  const b64 = encodeSidecar(payload);
  // jsPDF supports keywords as a string in Properties.
  doc.setProperties({
    keywords: `${KEYWORDS_PREFIX}${b64}`,
    creator: 'RMPG Flex v2 PDF Engine',
  });
  // Stash on the doc so output wrappers can append the post-EOF
  // marker without re-canonicalizing.
  (doc as any).__rmpgSidecarB64 = b64;
}

/**
 * Output the doc as bytes, with the post-EOF marker appended after
 * the final %%EOF. Use this instead of doc.output('arraybuffer')
 * when sidecar redundancy matters.
 */
export function outputWithSidecar(doc: jsPDF): Uint8Array {
  const buf = new Uint8Array(doc.output('arraybuffer'));
  const b64: string | undefined = (doc as any).__rmpgSidecarB64;
  if (!b64) return buf;
  const marker = `\n${POST_EOF_BEGIN}${b64}${POST_EOF_END}\n`;
  const tail = new TextEncoder().encode(marker);
  const out = new Uint8Array(buf.length + tail.length);
  out.set(buf, 0);
  out.set(tail, buf.length);
  return out;
}

/**
 * Extract a sidecar from raw PDF bytes. Tries Keywords first, then
 * the post-EOF marker. Returns null if neither is present or
 * either is malformed (caller can decide whether to error).
 */
export function extractSidecarFromBytes(bytes: Uint8Array): SidecarPayload | null {
  // Decode permissively as Latin-1 — the markers are ASCII and we
  // only need to find them; the base64 body is also ASCII.
  let text = '';
  for (const b of bytes) text += String.fromCharCode(b);

  // Path 1: Info dict Keywords. jsPDF writes this as
  //   /Keywords (RMPG-SIDECAR-V1:<base64>)
  // The parens form is "literal string" in PDF; jsPDF doesn't escape
  // base64 chars (no parens or backslashes in base64), so a simple
  // regex is safe.
  const kwMatch = text.match(/\/Keywords\s*\((RMPG-SIDECAR-V1:[A-Za-z0-9+/=]+)\)/);
  if (kwMatch) {
    const b64 = kwMatch[1].slice(KEYWORDS_PREFIX.length);
    try { return decodeSidecar(b64); } catch { /* fall through */ }
  }

  // Path 2: post-EOF marker.
  const beginIdx = text.lastIndexOf(POST_EOF_BEGIN);
  if (beginIdx >= 0) {
    const endIdx = text.indexOf(POST_EOF_END, beginIdx);
    if (endIdx > beginIdx) {
      const b64 = text.slice(beginIdx + POST_EOF_BEGIN.length, endIdx);
      try { return decodeSidecar(b64); } catch { /* fall through */ }
    }
  }
  return null;
}
