// At-rest encryption for Company Browser bookmarks/history
// (user_preferences.browser_bookmarks_json / browser_history_json).
//
// v2: (current) — AEGIS-256X2-level encryption (AEGIS-256 per
//   draft-irtf-cfrg-aegis-aead-16). Uses a 256-bit key and a 256-bit
//   random nonce per encryption, providing nonce-misuse resistance beyond
//   standard AES-GCM and a 256-bit security bound for both key recovery
//   and forgery. Stored form: "v2:" + base64(nonce[32] || ct || tag[16]).
//
// v1: (legacy read-path) — AES-256-GCM with 12-byte nonce. Still decoded
//   for rows written before the v2 upgrade; new writes always use v2.
//   A v1: blob produced by emailCrypto.ts will fail to decrypt here because
//   the derived key differs (domain-separated — see getKey() below).
//
// Key source:
//   1. If env.COMPANY_BROWSER_DATA_KEY is set (base64 of >=32 random bytes),
//      use first 32 bytes (or SHA-256 hash if fewer than 32).
//   2. Otherwise derive from SHA-256(JWT_SECRET + '|company-browser-data-v1').
// Domain-separation string in path (2) prevents this module's fallback key
// from ever equalling the bare-JWT_SECRET key emailCrypto.ts derives.

import { aegis256x2Encrypt, aegis256x2Decrypt, randomAegisNonce } from './aegis256x2';

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64encode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function getKey(env: { COMPANY_BROWSER_DATA_KEY?: string; JWT_SECRET: string }): Promise<Uint8Array> {
  if (env.COMPANY_BROWSER_DATA_KEY) {
    const raw = b64decode(env.COMPANY_BROWSER_DATA_KEY).slice(0, 32);
    if (raw.length >= 32) return raw;
    // Stretch short keys to 32 bytes via SHA-256.
    return new Uint8Array(await crypto.subtle.digest('SHA-256', raw));
  }
  const hash = await crypto.subtle.digest('SHA-256', enc.encode(`${env.JWT_SECRET}|company-browser-data-v1`));
  return new Uint8Array(hash);
}

// Legacy AES-256-GCM decryption for v1: blobs (read-only compat path).
async function aesGcmDecrypt(key32: Uint8Array, stored: string): Promise<string | null> {
  try {
    const raw = b64decode(stored.slice(3)); // strip "v1:"
    const iv  = raw.slice(0, 12);
    const ct  = raw.slice(12);
    const ck  = await crypto.subtle.importKey('raw', key32, { name: 'AES-GCM' }, false, ['decrypt']);
    const pt  = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, ck, ct);
    return dec.decode(pt);
  } catch {
    return null;
  }
}

// Encrypt plaintext with AEGIS-256X2-level encryption.
// Output: "v2:" + base64(nonce[32] || ciphertext || tag[16])
export async function encryptBrowserData(
  env: { COMPANY_BROWSER_DATA_KEY?: string; JWT_SECRET: string },
  plaintext: string,
): Promise<string> {
  const key   = await getKey(env);
  const nonce = randomAegisNonce();
  const ct    = aegis256x2Encrypt(key, nonce, enc.encode(plaintext));

  const blob = new Uint8Array(32 + ct.length);
  blob.set(nonce, 0);
  blob.set(ct, 32);
  return `v2:${b64encode(blob)}`;
}

// Decrypt a stored ciphertext, handling both current (v2:) and legacy (v1:) formats.
// Returns null for a corrupted/key-mismatch ciphertext rather than throwing.
export async function decryptBrowserData(
  env: { COMPANY_BROWSER_DATA_KEY?: string; JWT_SECRET: string },
  stored: string,
): Promise<string | null> {
  if (!stored.startsWith('v1:') && !stored.startsWith('v2:')) {
    // Pre-encryption legacy row — return as-is so existing data isn't wiped.
    return stored;
  }

  const key = await getKey(env);

  if (stored.startsWith('v1:')) {
    return aesGcmDecrypt(key, stored);
  }

  // v2: — AEGIS-256X2
  try {
    const blob  = b64decode(stored.slice(3));
    if (blob.length < 32 + 16) return null; // too short for nonce + tag
    const nonce = blob.slice(0, 32);
    const ct    = blob.slice(32);
    const pt    = aegis256x2Decrypt(key, nonce, ct);
    return pt ? dec.decode(pt) : null;
  } catch {
    return null;
  }
}
