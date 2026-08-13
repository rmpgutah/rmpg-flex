// ============================================================
// RMPG Flex — Post-quantum encryption subsystem: low-level primitives
// ------------------------------------------------------------
// Worker-safe (no `node:*`) shared helpers built on Web Crypto
// (`crypto.subtle`). DRYs up the inline base64 / AES-GCM / compare loops
// duplicated across encryptedR2.ts, cpgCrypto.ts, edgeHmac.ts, and
// signedAccess.ts without modifying them — new post-quantum modules and
// any future crypto util import from here.
//
// Primitives ONLY. No novel cryptography. Every algorithm here is a
// vetted NIST / RFC standard:
//   - AES-256-GCM          (FIPS 197 / SP 800-38D, authenticated AEAD)
//   - HKDF-SHA-256         (RFC 5869, key derivation)
//   - SHA-256              (FIPS 180-4)
//   - crypto.getRandomValues (CSPRNG provided by the runtime)
// ============================================================

import { CryptoConfigError } from './errors';

// ── Bytes <-> string ────────────────────────────────────────

export function randomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  crypto.getRandomValues(out);
  return out;
}

export function b64encode(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

export function b64decode(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

export function fromUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

export function hexEncode(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
  return s;
}

export function hexDecode(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new CryptoConfigError('hex string has odd length');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

// Constant-time equality over equal-length byte buffers. Short-circuits
// on length mismatch (length is not secret).
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// ── Hashing ─────────────────────────────────────────────────

export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const buf = await crypto.subtle.digest('SHA-256', data);
  return new Uint8Array(buf);
}

// ── HKDF-SHA-256 (RFC 5869) ──────────────────────────────────

export async function hkdf(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  if (length > 255 * 32) {
    throw new CryptoConfigError(`HKDF length ${length} exceeds 255*HashLen`);
  }
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    key,
    length * 8,
  );
  return new Uint8Array(bits);
}

// ── AES-256-GCM (FIPS 197 / SP 800-38D) ──────────────────────

export async function importAesKey(raw: Uint8Array): Promise<CryptoKey> {
  if (raw.length !== 32) {
    throw new CryptoConfigError(`AES-256 key must be 32 bytes (got ${raw.length})`);
  }
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/** Encrypt with a fresh random 96-bit IV. Returns iv (12B) and ciphertext
 *  (plaintext-length + 16B GCM auth tag appended by WebCrypto). */
export async function aesGcmEncrypt(
  key: CryptoKey,
  plaintext: Uint8Array,
  aad?: Uint8Array,
): Promise<{ iv: Uint8Array; ciphertext: Uint8Array }> {
  const iv = randomBytes(12);
  const params: SubtleCryptoEncryptAlgorithm = { name: 'AES-GCM', iv };
  if (aad) params.additionalData = aad;
  const ct = await crypto.subtle.encrypt(params, key, plaintext);
  return { iv, ciphertext: new Uint8Array(ct) };
}

export async function aesGcmDecrypt(
  key: CryptoKey,
  iv: Uint8Array,
  ciphertext: Uint8Array,
  aad?: Uint8Array,
): Promise<Uint8Array> {
  const params: SubtleCryptoEncryptAlgorithm = { name: 'AES-GCM', iv };
  if (aad) params.additionalData = aad;
  const pt = await crypto.subtle.decrypt(params, key, ciphertext);
  return new Uint8Array(pt);
}

// ── Master key loading (shared by envelope + keystore) ───────

/** Import a base64-encoded 32-byte master key (KEK) from a Worker secret.
 *  Fail-closed: a missing/malformed secret throws rather than letting a
 *  caller silently store plaintext (same contract as encryptedR2.ts). */
export async function importMasterKey(keyB64: string | undefined, name: string): Promise<Uint8Array> {
  if (!keyB64) {
    throw new CryptoConfigError(`${name} is not set (wrangler secret put ${name})`);
  }
  let raw: Uint8Array;
  try {
    raw = b64decode(keyB64.trim());
  } catch {
    throw new CryptoConfigError(`${name} is not valid base64`);
  }
  if (raw.length !== 32) {
    throw new CryptoConfigError(`${name} must decode to 32 bytes (got ${raw.length})`);
  }
  return raw;
}