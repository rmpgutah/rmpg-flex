// ============================================================
// RMPG Flex — Client-side post-quantum crypto utility
// ------------------------------------------------------------
// Browser mirror of the Worker's src/utils/crypto subsystem so that
// evidence, narratives, and attachments can be post-quantum SEALED
// on the officer's device BEFORE the bytes ever hit the Worker. The
// Worker holds only the wrapped secret halves (RMPG_PQ_MASTER_KEY
// unwraps server-side); the officer fetches the recipient's PUBLIC
// encryption key via GET /api/crypto/identities/encryption/public and
// seals locally. This is true end-to-end: even a full compromise of
// the Worker runtime (sans the secret store) cannot decrypt locally
// sealed payloads — only a holder of the unwrapped secret key can.
//
// Standardized primitives only (NIST FIPS 203/204, RFC 7748/8032):
//   - X25519 + ML-KEM-768 hybrid KEM (@noble/post-quantum hybrid preset)
//   - HKDF-SHA-256 KDF (Web Crypto)
//   - AES-256-GCM AEAD (Web Crypto)
// ============================================================

import { ml_kem768_x25519 } from '@noble/post-quantum/hybrid.js';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import { ed25519 } from '@noble/curves/ed25519.js';

// ── base64 helpers (browser + test DOM) ────────────────────────

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

// ── Sealed-box frame layout ───────────────────────────────────
// MUST match src/utils/crypto/hybrid.ts exactly so a browser-sealed
// frame opens server-side and vice-versa. The shared constant is the
// interop contract documented in docs/superpowers/specs/2026-07-24-pq-crypto-wire-format.md.

const SEAL_MAGIC = utf8('RMPGSEAL');
const SEAL_VERSION = 0x01;
const SEAL_INFO = utf8('RMPG-FLEX/hybrid-seal/v1');

const KEM_PUB_LEN = ml_kem768_x25519.lengths.publicKey!;
const KEM_CT_LEN = ml_kem768_x25519.lengths.cipherText!;

function concat(...parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// ── HKDF-SHA-256 (RFC 5869) via Web Crypto ────────────────────

async function hkdf(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm as unknown as BufferSource, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: salt as unknown as BufferSource, info: info as unknown as BufferSource } as HkdfParams,
    key,
    length * 8,
  );
  return new Uint8Array(bits);
}

// ── AES-256-GCM AEAD via Web Crypto ───────────────────────────

async function aesGcmEncrypt(keyBytes: Uint8Array, plaintext: Uint8Array, aad?: Uint8Array): Promise<{ iv: Uint8Array; ct: Uint8Array }> {
  if (keyBytes.length !== 32) throw new Error('AES-256 key must be 32 bytes');
  const key = await crypto.subtle.importKey('raw', keyBytes as unknown as BufferSource, { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const params: AesGcmParams = { name: 'AES-GCM', iv: iv as unknown as BufferSource };
  if (aad) params.additionalData = aad as unknown as BufferSource;
  const ct = await crypto.subtle.encrypt(params, key, plaintext as unknown as BufferSource);
  return { iv, ct: new Uint8Array(ct) };
}

// ── Sealed box (seal — client side has the recipient public key) ─

export interface SealResult {
  /** Version-tagged binary frame: magic|ver|kemCT|iv|ciphertext. */
  frame: Uint8Array;
}

/** Asymmetrically encrypt `plaintext` to `recipientPublicKeyB64` (base64
 *  X25519+ML-KEM-768 hybrid public key). `aad` is authenticated but not
 *  encrypted. The frame layout is wire-compatible with the Worker's
 *  open() — a browser-sealed frame opens server-side and vice-versa. */
export async function seal(plaintext: Uint8Array, recipientPublicKeyB64: string, aad?: Uint8Array): Promise<SealResult> {
  const recipientPub = b64decode(recipientPublicKeyB64);
  if (recipientPub.length !== KEM_PUB_LEN) {
    throw new Error(`recipient KEM public key must be ${KEM_PUB_LEN} bytes (got ${recipientPub.length})`);
  }
  const { cipherText: kemCT, sharedSecret } = ml_kem768_x25519.encapsulate(recipientPub);
  const cek = await hkdf(sharedSecret as Uint8Array, kemCT as Uint8Array, SEAL_INFO, 32);
  const { iv, ct } = await aesGcmEncrypt(cek, plaintext, aad);
  const frame = concat(SEAL_MAGIC, new Uint8Array([SEAL_VERSION]), kemCT as Uint8Array, iv, ct);
  return { frame };
}

/** Verify (without decrypting) that a blob looks like a RMPGSEAL frame.
 *  Useful for UI affordance on received evidence — does NOT authenticate. */
export function looksLikeSealedFrame(frame: Uint8Array): boolean {
  const minLen = SEAL_MAGIC.length + 1 + KEM_CT_LEN + 12 + 16; // +16 GCM tag
  if (frame.length < minLen) return false;
  const magic = frame.subarray(0, SEAL_MAGIC.length);
  return equalBytes(magic, SEAL_MAGIC) && frame[SEAL_MAGIC.length] === SEAL_VERSION;
}

export { KEM_PUB_LEN, KEM_CT_LEN };

// ── Hybrid signature verification (client-side MITM defense) ───
// Mirrors the Worker's hybridVerify: Ed25519 AND ML-DSA-65, no
// short-circuit. Used to verify the org encryption public key was
// signed by the org signing identity and wasn't swapped in transit.

const SIG_MAGIC = utf8('RMPGSIG');
const SIG_VERSION = 0x01;
const ED25519_SIG_LEN = 64;

export function hybridVerify(
  sig: Uint8Array,
  msg: Uint8Array,
  edPub: Uint8Array,
  pqPub: Uint8Array,
): boolean {
  if (edPub.length !== 32) return false;
  // ML-DSA-65 public key is 1952 bytes
  if (pqPub.length !== 1952) return false;
  // Parse the RMPGSIG frame (must match the server's layout exactly).
  const headerLen = SIG_MAGIC.length + 1 + ED25519_SIG_LEN + 4;
  if (sig.length < headerLen) return false;
  const magic = sig.subarray(0, SIG_MAGIC.length);
  if (!equalBytes(magic, SIG_MAGIC)) return false;
  if (sig[SIG_MAGIC.length] !== SIG_VERSION) return false;
  let off = SIG_MAGIC.length + 1;
  const edSig = sig.subarray(off, off + ED25519_SIG_LEN);
  off += ED25519_SIG_LEN;
  const pqLen = ((sig[off] << 24) | (sig[off + 1] << 16) | (sig[off + 2] << 8) | sig[off + 3]) >>> 0;
  off += 4;
  if (sig.length !== off + pqLen) return false;
  if (pqLen !== 3309) return false; // ML-DSA-65 fixed signature length
  const pqSig = sig.subarray(off, off + pqLen);
  // Evaluate both unconditionally (no short-circuit — see server comment).
  const edOk = ed25519.verify(edSig, msg, edPub);
  const pqOk = ml_dsa65.verify(pqSig, msg, pqPub);
  return ((edOk ? 1 : 0) & (pqOk ? 1 : 0)) === 1;
}