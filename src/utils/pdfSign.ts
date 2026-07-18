// ============================================================
// RMPG Flex — Shared Ed25519 PDF signing primitives
// ============================================================
// Extracted from src/routes/pdfTools.ts so that both pdfTools
// and (Phase 2) the court-package endpoint share one implementation.
// ============================================================

import type { Bindings } from '../types';

// An Ed25519 private key is a 32-byte seed inside a fixed PKCS8 DER envelope.
// We derive a STABLE seed from a dedicated PDF_SIGNING_KEY when provisioned,
// else from JWT_SECRET — so signatures are reproducible across requests and
// isolates with NO ops/secret step required (the endpoint used to hard-503
// because no key was configured). Provision a dedicated PDF_SIGNING_KEY
// (base64 of 32 random bytes) in production so signature validity is decoupled
// from JWT_SECRET rotation. Signing uses Workers' native WebCrypto Ed25519.
const ED25519_PKCS8_PREFIX = new Uint8Array([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
]);

export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function base64UrlToBytes(b64url: string): Uint8Array {
  const pad = b64url.length % 4 === 2 ? '==' : b64url.length % 4 === 3 ? '=' : '';
  return base64ToBytes(b64url.replace(/-/g, '+').replace(/_/g, '/') + pad);
}

// HKDF-Expand (RFC 5869) — derives arbitrary-length, domain-separated key
// material from the same root secret used by deriveEd25519Seed, WITHOUT
// touching that function's formula (see file header). `label` must be
// unique per algorithm so a break in one derived seed reveals nothing
// about the others.
async function deriveHkdfSeed(env: Bindings, label: string, byteLength: number): Promise<Uint8Array> {
  const material = env.PDF_SIGNING_KEY?.trim() || env.JWT_SECRET;
  const ikm = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(material), 'HKDF', false, ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(), info: new TextEncoder().encode(label) },
    ikm,
    byteLength * 8,
  );
  return new Uint8Array(bits);
}

// Test-only export — removed once signTriple()'s own tests cover this
// behavior end-to-end (Task 5).
export const deriveHkdfSeedForTest = deriveHkdfSeed;

async function deriveEd25519Seed(env: Bindings): Promise<Uint8Array> {
  const provisioned = env.PDF_SIGNING_KEY?.trim();
  if (provisioned) {
    const raw = base64ToBytes(provisioned);
    if (raw.length === 32) return raw;                       // raw seed
    if (raw.length === 48) return raw.slice(ED25519_PKCS8_PREFIX.length); // pkcs8 → seed
    return new Uint8Array(await crypto.subtle.digest('SHA-256', raw));    // any → 32
  }
  const material = new TextEncoder().encode(`${env.JWT_SECRET}|rmpg-pdf-ed25519-v1`);
  return new Uint8Array(await crypto.subtle.digest('SHA-256', material));
}

interface CachedEd25519Key {
  seedHash: string;
  key: CryptoKey;
  ed25519PublicKey: Uint8Array;
}

let cachedEd25519: CachedEd25519Key | null = null;

async function getSigningKeys(env: Bindings): Promise<{ key: CryptoKey; keyId: string; ed25519PublicKey: Uint8Array }> {
  const seed = await deriveEd25519Seed(env);
  const seedHashBuf = await crypto.subtle.digest('SHA-256', seed);
  const seedHashBytes = new Uint8Array(seedHashBuf);
  const seedHash = bytesToBase64(seedHashBytes);
  // keyId = first 8 bytes of the seed hash (hex) — lets a verifier identify the
  // signing key without exposing it.
  const keyId = Array.from(seedHashBytes.slice(0, 8)).map((b) => b.toString(16).padStart(2, '0')).join('');

  if (cachedEd25519 && cachedEd25519.seedHash === seedHash) {
    return { key: cachedEd25519.key, keyId, ed25519PublicKey: cachedEd25519.ed25519PublicKey };
  }

  const pkcs8 = new Uint8Array(ED25519_PKCS8_PREFIX.length + 32);
  pkcs8.set(ED25519_PKCS8_PREFIX, 0);
  pkcs8.set(seed, ED25519_PKCS8_PREFIX.length);
  // extractable: true (was false) — needed to export the public key below.
  // Safe: this is a server-held key derived from a secret we already
  // control; exporting the PUBLIC half leaks nothing the derivation
  // formula doesn't already make computable by anyone holding the secret.
  const key = await crypto.subtle.importKey('pkcs8', pkcs8, { name: 'Ed25519' }, true, ['sign']);
  // @cloudflare/workers-types types exportKey() as Promise<ArrayBuffer | JsonWebKey> for
  // every format string (unlike lib.dom.d.ts, it doesn't overload on the 'jwk' literal),
  // so a cast is needed here — runtime shape is unaffected, format:'jwk' always returns JsonWebKey.
  const jwk = (await crypto.subtle.exportKey('jwk', key)) as JsonWebKey;
  if (!jwk.x) throw new Error('Ed25519 JWK export missing public key (x)');
  const ed25519PublicKey = base64UrlToBytes(jwk.x);

  cachedEd25519 = { seedHash, key, ed25519PublicKey };
  return { key, keyId, ed25519PublicKey };
}

// Test-only export — removed in Task 5 once signTriple()'s tests cover this.
export const getPdfSigningKeyForTest = getSigningKeys;

/** Sign a (formKey | caseNumber | payloadHash) triple — identical message format to
 *  POST /api/pdf-tools/sign-payload, so client/src/utils/pdfIntegrity.ts verifies it. */
export async function signTriple(
  env: Bindings, formKey: string, caseNumber: string, payloadHash: string,
): Promise<{ signature: string; signedAt: string; algorithm: 'Ed25519'; keyId: string }> {
  const { key, keyId } = await getSigningKeys(env);
  const message = new TextEncoder().encode(`${formKey}|${caseNumber}|${payloadHash}`);
  const sigBuf = await crypto.subtle.sign('Ed25519', key, message);
  return { signature: bytesToBase64(new Uint8Array(sigBuf)), signedAt: new Date().toISOString(), algorithm: 'Ed25519', keyId }; // new-date-ok
}
