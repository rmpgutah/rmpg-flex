// ============================================================
// RMPG Flex — Hybrid asymmetric crypto: sealed boxes + signatures
// ------------------------------------------------------------
// This is the "advanced" surface: post-quantum hybrid constructions
// composing the standardized primitives from postquantum.ts.
//
// NO novel algorithms. Every step is a vetted construction:
//
//  Sealed box (data-in-transit / end-to-end):
//    1. Hybrid KEM (X25519 + ML-KEM-768): encapsulate 32B shared secret
//       to a recipient static public key. Forward secrecy per seal on the
//       sender side via fresh KEM randomness.
//    2. HKDF-SHA-256(sharedSecret, salt=kemCT, info=label) -> 32B CEK.
//    3. AES-256-GCM(CEK) AEAD over the plaintext (+ caller AAD).
//    4. Length-prefixed, version-tagged binary frame.
//    One recipient public key, secret key never transmitted. Anyone can
//    seal; only the secret-key holder can open.
//
//  Hybrid signature (evidence / audit-chain integrity):
//    Ed25519 (classical) AND ML-DSA-65 (post-quantum) over the same
//    message, verified with an AND combiner. Stays valid as long as AT
//    LEAST ONE of the two underlying schemes remains unbroken — i.e.
//    it is secure against BOTH a quantum AND a classical adversary.
// ============================================================

import { CryptoVerificationError } from './errors';
import {
  ED25519_PUB_LEN,
  ED25519_SIG_LEN,
  ed25519Keygen,
  ed25519Sign,
  ed25519Verify,
  kemDecapsulate,
  kemEncapsulate,
  kemKeygen,
  ML_DSA_PUB_LEN,
  ML_DSA_SIG_LEN,
  mlDsaKeygen,
  mlDsaSign,
  mlDsaVerify,
  PQ_KEM_CT_LEN,
  PQ_KEM_PUB_LEN,
  type KemKeyPair,
} from './postquantum';
import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  concatBytes,
  constantTimeEqual,
  hkdf,
  importAesKey,
  utf8,
} from './primitives';

// ── Sealed box ───────────────────────────────────────────────

const SEAL_MAGIC = utf8('RMPGSEAL');
const SEAL_VERSION = 0x01;
const SEAL_INFO = utf8('RMPG-FLEX/hybrid-seal/v1');

export interface SealResult {
  /** Version-tagged binary frame: magic|ver|kemCT|iv|ciphertext. */
  frame: Uint8Array;
}

/** Asymmetrically encrypt `plaintext` to `recipientPublicKey` (hybrid
 *  X25519+ML-KEM-768 KEM -> HKDF -> AES-256-GCM). `aad` is authenticated
 *  but not encrypted (binding to envelope metadata, record ids, etc.). */
export async function seal(
  plaintext: Uint8Array,
  recipientPublicKey: Uint8Array,
  aad?: Uint8Array,
): Promise<SealResult> {
  if (recipientPublicKey.length !== PQ_KEM_PUB_LEN) {
    throw new CryptoVerificationError(
      `recipient KEM public key must be ${PQ_KEM_PUB_LEN} bytes (got ${recipientPublicKey.length})`,
    );
  }
  const { cipherText: kemCT, sharedSecret } = kemEncapsulate(recipientPublicKey);
  const cek = await hkdf(sharedSecret, kemCT, SEAL_INFO, 32);
  // Best-effort zeroization of intermediate keying material (limit A9 in
  // the pentest report — JS provides no explicit_bzero, but .fill(0) makes
  // the bytes unrecoverable from a direct read; a GC heap snapshot may still
  // capture a copy, which is the accepted residual risk for a SaaS runtime).
  try {
    sharedSecret.fill(0);
  } catch { /* sharedSecret may be a view — best effort */ }
  const key = await importAesKey(cek);
  try {
    const { iv, ciphertext } = await aesGcmEncrypt(key, plaintext, aad);
    const frame = concatBytes(
      SEAL_MAGIC,
      new Uint8Array([SEAL_VERSION]),
      kemCT,
      iv,
      ciphertext,
    );
    return { frame };
  } finally {
    cek.fill(0);
  }
}

const OPEN_FAILED = 'open failed: invalid or tampered frame';

export async function open(
  frame: Uint8Array,
  recipientSecretKey: Uint8Array,
  aad?: Uint8Array,
): Promise<Uint8Array> {
  // All parse/AEAD failures surface ONE uniform error message so an
  // attacker cannot distinguish "wrong key" from "tampered byte" from
  // "truncated frame" from "bad magic" — each of which is a distinct
  // oracle in a naive implementation. The only operation that legitimately
  // needs a distinct signal is the version check (a legitimately new
  // version is a different protocol), but it still throws OPEN_FAILED here
  // since an attacker could otherwise probe supported versions.
  const headerLen = SEAL_MAGIC.length + 1 + PQ_KEM_CT_LEN + 12;
  if (frame.length < headerLen) {
    throw new CryptoVerificationError(OPEN_FAILED);
  }
  const magic = frame.subarray(0, SEAL_MAGIC.length);
  if (!constantTimeEqual(magic, SEAL_MAGIC)) {
    throw new CryptoVerificationError(OPEN_FAILED);
  }
  if (frame[SEAL_MAGIC.length] !== SEAL_VERSION) {
    throw new CryptoVerificationError(OPEN_FAILED);
  }
  let off = SEAL_MAGIC.length + 1;
  const kemCT = frame.subarray(off, off + PQ_KEM_CT_LEN);
  off += PQ_KEM_CT_LEN;
  const iv = frame.subarray(off, off + 12);
  off += 12;
  const ciphertext = frame.subarray(off);

  // ML-KEM decapsulation is deterministic and ALWAYS returns 32 bytes
  // (even for a wrong recipient) — so a wrong key produces a wrong shared
  // secret that HKDF happily turns into a wrong CEK, and AES-GCM then
  // fails on the auth tag. That's the single failure point a caller sees.
  const sharedSecret = kemDecapsulate(kemCT, recipientSecretKey);
  const cek = await hkdf(sharedSecret, kemCT, SEAL_INFO, 32);
  try { sharedSecret.fill(0); } catch { /* view — best effort */ }
  const key = await importAesKey(cek);
  try {
    return await aesGcmDecrypt(key, iv, ciphertext, aad);
  } catch {
    throw new CryptoVerificationError(OPEN_FAILED);
  } finally {
    cek.fill(0);
  }
}

// ── Hybrid signature (Ed25519 AND ML-DSA-65) ─────────────────

const SIG_MAGIC = utf8('RMPGSIG');
const SIG_VERSION = 0x01;

export interface HybridSigningKeyPair {
  ed: { publicKey: Uint8Array; secretKey: Uint8Array };
  pq: { publicKey: Uint8Array; secretKey: Uint8Array };
}

export interface HybridPublicKey {
  ed: Uint8Array;
  pq: Uint8Array;
}

export function hybridSigningKeygen(): HybridSigningKeyPair {
  return { ed: ed25519Keygen(), pq: mlDsaKeygen() };
}

function be32(n: number): Uint8Array {
  return new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
}

function readBe32(buf: Uint8Array, off: number): number {
  return ((buf[off] << 24) | (buf[off + 1] << 16) | (buf[off + 2] << 8) | buf[off + 3]) >>> 0;
}

/** Produce a detached hybrid signature over `msg`. The frame layout is:
 *  magic(7)|ver(1)|edSig(64)|pqLen(4)|pqSig. */
export function hybridSign(
  msg: Uint8Array,
  classicalSecret: Uint8Array,
  pqSecret: Uint8Array,
): Uint8Array {
  const ed = ed25519Sign(msg, classicalSecret);
  if (ed.length !== ED25519_SIG_LEN) {
    throw new CryptoVerificationError('Ed25519 signature has unexpected length');
  }
  const pq = mlDsaSign(msg, pqSecret);
  return concatBytes(SIG_MAGIC, new Uint8Array([SIG_VERSION]), ed, be32(pq.length), pq);
}

export interface ParsedHybridSignature {
  ed: Uint8Array;
  pq: Uint8Array;
}

export function parseHybridSignature(sig: Uint8Array): ParsedHybridSignature {
  const headerLen = SIG_MAGIC.length + 1 + ED25519_SIG_LEN + 4;
  if (sig.length < headerLen) {
    throw new CryptoVerificationError('hybrid signature too short');
  }
  const magic = sig.subarray(0, SIG_MAGIC.length);
  if (!magic.every((b, i) => b === SIG_MAGIC[i])) {
    throw new CryptoVerificationError('hybrid signature has bad magic');
  }
  if (sig[SIG_MAGIC.length] !== SIG_VERSION) {
    throw new CryptoVerificationError(`unsupported hybrid-signature version ${sig[SIG_MAGIC.length]}`);
  }
  let off = SIG_MAGIC.length + 1;
  const ed = sig.subarray(off, off + ED25519_SIG_LEN);
  off += ED25519_SIG_LEN;
  const pqLen = readBe32(sig, off);
  off += 4;
  if (sig.length !== off + pqLen) {
    throw new CryptoVerificationError('hybrid signature has inconsistent PQ length');
  }
  // Defense-in-depth: FIPS 204 fixes ML-DSA-65 signature length to 3309 bytes.
  // Rejecting any other length here means a giant attacker-supplied pqLen
  // can't reach mlDsaVerify (which, while it would reject, would spend real
  // CPU first). This converts an unbounded-DoS class into a fast protocol
  // rejection. A future signer with a different PQ algorithm (Falcon, SLH-DSA)
  // would ship under a new frame version, not extend this one.
  if (pqLen !== ML_DSA_SIG_LEN) {
    throw new CryptoVerificationError('hybrid signature has unexpected PQ length');
  }
  const pq = sig.subarray(off, off + pqLen);
  return { ed, pq: pq as Uint8Array };
}

/** Verify a hybrid signature. Returns true ONLY when BOTH the classical
 *  (Ed25519) and post-quantum (ML-DSA-65) halves verify — the AND
 *  combiner. A malformed but well-framed signature returns false rather
 *  than throwing.
 *
 *  Security: BOTH halves are evaluated unconditionally and combined with a
 *  constant-time AND (bitwise `&`) — never short-circuit `&&`. A naive
 *  `edOk && pqOk` would skip the (much slower) ML-DSA verify whenever
 *  Ed25519 fails, making the wall-clock time of a verify a side channel
 *  that distinguishes "classical half wrong" from "PQ half wrong". For a
 *  hybrid AND combiner the contract is "break both to forge", which
 *  requires giving the attacker NO information about which half is the
 *  weak link on any given query. */
export function hybridVerify(
  sig: Uint8Array,
  msg: Uint8Array,
  classicPub: Uint8Array,
  pqPub: Uint8Array,
): boolean {
  if (classicPub.length !== ED25519_PUB_LEN) return false;
  if (pqPub.length !== ML_DSA_PUB_LEN) return false;
  let parsed: ParsedHybridSignature;
  try {
    parsed = parseHybridSignature(sig);
  } catch {
    return false;
  }
  // Evaluate both unconditionally; combine with bitwise AND (no short-circuit).
  const edOk = ed25519Verify(parsed.ed, msg, classicPub);
  const pqOk = mlDsaVerify(parsed.pq, msg, pqPub);
  // Bitwise AND of the two boolean results cast to 0/1, then compare to 1.
  // Parens REQUIRED: `===` binds tighter than `&`, so `a & b === 1` parses
  // as `a & (b === 1)` — a real bug. Explicit parens make the AND first.
  return ((edOk ? 1 : 0) & (pqOk ? 1 : 0)) === 1;
}

// Re-exports for callers that want the KEM keypair type directly.
export type { KemKeyPair };