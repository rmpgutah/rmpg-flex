// ============================================================
// RMPG Flex — Post-quantum primitive wrappers
// ------------------------------------------------------------
// Thin, typed wrappers over @noble/post-quantum + @noble/curves.
//
// Every algorithm here is a NIST-standardized, peer-reviewed primitive —
// NOT a novel construction:
//   - ML-KEM-768     (FIPS 203, NIST PQC KEM, formerly Kyber)
//   - ML-DSA-65      (FIPS 204, NIST PQC signature, formerly Dilithium)
//   - X25519         (RFC 7748, classical ECDH)
//   - Ed25519        (RFC 8032, classical signature)
//
// The hybrid KEM preset `ml_kem768_x25519` (X-Wing-style) combines
// X25519 + ML-KEM-768 so a ciphertext is secure as long as AT LEAST ONE
// of the classical or post-quantum assumptions holds — the conservative
// "hybrid" posture recommended while PQ algorithms mature. This is what
// puts the layer ahead of currently-deployed software while staying on
// fully standardized ground (no homebrew ciphers).
// ============================================================

import { ml_kem768_x25519 } from '@noble/post-quantum/hybrid.js';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import { ed25519 } from '@noble/curves/ed25519.js';

import { CryptoConfigError } from './errors';
import { randomBytes } from './primitives';

// Exported for advanced / direct callers; typed wrappers below are preferred.
export const PQ_HYBRID_KEM = ml_kem768_x25519;
export const PQ_SIGNER = ml_dsa65;
export const CLASSIC_SIGNER = ed25519;

export const PQ_KEM_PUB_LEN = ml_kem768_x25519.lengths.publicKey!;
export const PQ_KEM_SEC_LEN = ml_kem768_x25519.lengths.secretKey!;
export const PQ_KEM_CT_LEN = ml_kem768_x25519.lengths.cipherText!;
export const PQ_KEM_SS_LEN = 32; // hybrid shared-secret length

// ML-DSA-65
export const ML_DSA_PUB_LEN = ml_dsa65.lengths.publicKey!;
export const ML_DSA_SEC_LEN = ml_dsa65.lengths.secretKey!;
export const ML_DSA_SIG_LEN = ml_dsa65.lengths.signature!; // fixed-length in FIPS 204

// Ed25519
export const ED25519_SEC_LEN = 32;
export const ED25519_PUB_LEN = 32;
export const ED25519_SIG_LEN = 64;

// ── Hybrid KEM (X25519 + ML-KEM-768) ─────────────────────────

export interface KemKeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

export interface KemEncapsulation {
  cipherText: Uint8Array;
  sharedSecret: Uint8Array;
}

export function kemKeygen(): KemKeyPair {
  const { publicKey, secretKey } = ml_kem768_x25519.keygen();
  return { publicKey: publicKey as Uint8Array, secretKey: secretKey as Uint8Array };
}

/** Encapsulate a fresh 32-byte shared secret to `recipientPublicKey`.
 *  Uses fresh randomness — forward secrecy on the encapsulator side. */
export function kemEncapsulate(recipientPublicKey: Uint8Array): KemEncapsulation {
  if (recipientPublicKey.length !== PQ_KEM_PUB_LEN) {
    throw new CryptoConfigError(
      `hybrid KEM public key must be ${PQ_KEM_PUB_LEN} bytes (got ${recipientPublicKey.length})`,
    );
  }
  const r = ml_kem768_x25519.encapsulate(recipientPublicKey);
  return { cipherText: r.cipherText as Uint8Array, sharedSecret: r.sharedSecret as Uint8Array };
}

export function kemDecapsulate(cipherText: Uint8Array, recipientSecretKey: Uint8Array): Uint8Array {
  if (cipherText.length !== PQ_KEM_CT_LEN) {
    throw new CryptoConfigError(
      `hybrid KEM ciphertext must be ${PQ_KEM_CT_LEN} bytes (got ${cipherText.length})`,
    );
  }
  return ml_kem768_x25519.decapsulate(cipherText, recipientSecretKey) as Uint8Array;
}

// ── Ed25519 (classical half of the hybrid signature) ────────

export interface Ed25519KeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

export function ed25519Keygen(): Ed25519KeyPair {
  const secretKey = randomBytes(ED25519_SEC_LEN);
  const publicKey = ed25519.getPublicKey(secretKey) as Uint8Array;
  return { publicKey, secretKey };
}

export function ed25519Sign(msg: Uint8Array, secretKey: Uint8Array): Uint8Array {
  return ed25519.sign(msg, secretKey) as Uint8Array;
}

export function ed25519Verify(sig: Uint8Array, msg: Uint8Array, publicKey: Uint8Array): boolean {
  return ed25519.verify(sig, msg, publicKey);
}

// ── ML-DSA-65 (post-quantum half of the hybrid signature) ───

export interface MlDsaKeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

export function mlDsaKeygen(): MlDsaKeyPair {
  const { publicKey, secretKey } = ml_dsa65.keygen();
  return { publicKey: publicKey as Uint8Array, secretKey: secretKey as Uint8Array };
}

export function mlDsaSign(msg: Uint8Array, secretKey: Uint8Array): Uint8Array {
  return ml_dsa65.sign(msg, secretKey) as Uint8Array;
}

export function mlDsaVerify(sig: Uint8Array, msg: Uint8Array, publicKey: Uint8Array): boolean {
  return ml_dsa65.verify(sig, msg, publicKey);
}