import { describe, it, expect } from 'vitest';
import { ml_dsa87 } from '@noble/post-quantum/ml-dsa.js';
import { slh_dsa_sha2_256f } from '@noble/post-quantum/slh-dsa.js';
import { signTriple } from '../src/utils/pdfSign';
import type { Bindings } from '../src/types';

// Benchmarked on 2026-07-18 (dev machine, @noble/post-quantum 0.6.1):
//   ml_dsa87:            keygen ~15ms, sign ~14ms,  verify ~5ms
//   slh_dsa_sha2_256s:    sign ~3711ms  — too slow for a Workers request handler
//   slh_dsa_sha2_256f:    sign ~365ms   — the parameter set this codebase uses
// Both are FIPS 205, NIST category 5 (256-bit) — same security level; f/s is
// purely a speed/signature-size tradeoff, not a security downgrade.

describe('@noble/post-quantum — library sanity', () => {
  it('ml_dsa87 signs and verifies with a deterministic 32-byte seed', () => {
    const seed = new Uint8Array(32).fill(7);
    const { publicKey, secretKey } = ml_dsa87.keygen(seed);
    const msg = new TextEncoder().encode('rmpg-test-message');
    const sig = ml_dsa87.sign(msg, secretKey);
    expect(ml_dsa87.verify(sig, msg, publicKey)).toBe(true);
    expect(publicKey.length).toBe(2592);
    expect(sig.length).toBe(4627);
  });

  it('ml_dsa87 rejects a tampered message', () => {
    const seed = new Uint8Array(32).fill(7);
    const { publicKey, secretKey } = ml_dsa87.keygen(seed);
    const sig = ml_dsa87.sign(new TextEncoder().encode('original'), secretKey);
    expect(ml_dsa87.verify(sig, new TextEncoder().encode('tampered'), publicKey)).toBe(false);
  });

  it('slh_dsa_sha2_256f signs and verifies with a deterministic 96-byte seed', () => {
    const seed = new Uint8Array(96).fill(9);
    const { publicKey, secretKey } = slh_dsa_sha2_256f.keygen(seed);
    const msg = new TextEncoder().encode('rmpg-test-message');
    const sig = slh_dsa_sha2_256f.sign(msg, secretKey);
    expect(slh_dsa_sha2_256f.verify(sig, msg, publicKey)).toBe(true);
    expect(publicKey.length).toBe(64);
    expect(sig.length).toBe(49856);
  });

  it('slh_dsa_sha2_256f rejects a tampered message', () => {
    const seed = new Uint8Array(96).fill(9);
    const { publicKey, secretKey } = slh_dsa_sha2_256f.keygen(seed);
    const sig = slh_dsa_sha2_256f.sign(new TextEncoder().encode('original'), secretKey);
    expect(slh_dsa_sha2_256f.verify(sig, new TextEncoder().encode('tampered'), publicKey)).toBe(false);
  });
});

describe('signTriple', () => {
  const env = { JWT_SECRET: 'test-jwt-secret-value' } as unknown as Bindings;

  it('produces three independently-verifiable signatures over the same message', async () => {
    const result = await signTriple(env, 'incident', 'INC-26-001234', 'a'.repeat(64));
    const message = new TextEncoder().encode('incident|INC-26-001234|' + 'a'.repeat(64));

    // Ed25519
    const ed25519Pub = await crypto.subtle.importKey(
      'raw', Uint8Array.from(atob(result.ed25519.publicKey), (c) => c.charCodeAt(0)),
      { name: 'Ed25519' }, false, ['verify'],
    );
    const ed25519Sig = Uint8Array.from(atob(result.ed25519.signature), (c) => c.charCodeAt(0));
    expect(await crypto.subtle.verify('Ed25519', ed25519Pub, ed25519Sig, message)).toBe(true);

    // ML-DSA-87
    const mlPub = Uint8Array.from(atob(result.mlDsa87.publicKey), (c) => c.charCodeAt(0));
    const mlSig = Uint8Array.from(atob(result.mlDsa87.signature), (c) => c.charCodeAt(0));
    expect(ml_dsa87.verify(mlSig, message, mlPub)).toBe(true);

    // SLH-DSA-256f
    const slhPub = Uint8Array.from(atob(result.slhDsa256f.publicKey), (c) => c.charCodeAt(0));
    const slhSig = Uint8Array.from(atob(result.slhDsa256f.signature), (c) => c.charCodeAt(0));
    expect(slh_dsa_sha2_256f.verify(slhSig, message, slhPub)).toBe(true);

    expect(result.keyId).toMatch(/^[0-9a-f]{16}$/);
    expect(new Date(result.signedAt).toISOString()).toBe(result.signedAt);
  });

  it('tampering with any input field invalidates all three signatures', async () => {
    const result = await signTriple(env, 'incident', 'INC-26-001234', 'a'.repeat(64));
    const tamperedMessage = new TextEncoder().encode('incident|INC-26-001234|' + 'b'.repeat(64));

    const ed25519Pub = await crypto.subtle.importKey(
      'raw', Uint8Array.from(atob(result.ed25519.publicKey), (c) => c.charCodeAt(0)),
      { name: 'Ed25519' }, false, ['verify'],
    );
    const ed25519Sig = Uint8Array.from(atob(result.ed25519.signature), (c) => c.charCodeAt(0));
    expect(await crypto.subtle.verify('Ed25519', ed25519Pub, ed25519Sig, tamperedMessage)).toBe(false);

    const mlPub = Uint8Array.from(atob(result.mlDsa87.publicKey), (c) => c.charCodeAt(0));
    const mlSig = Uint8Array.from(atob(result.mlDsa87.signature), (c) => c.charCodeAt(0));
    expect(ml_dsa87.verify(mlSig, tamperedMessage, mlPub)).toBe(false);

    const slhPub = Uint8Array.from(atob(result.slhDsa256f.publicKey), (c) => c.charCodeAt(0));
    const slhSig = Uint8Array.from(atob(result.slhDsa256f.signature), (c) => c.charCodeAt(0));
    expect(slh_dsa_sha2_256f.verify(slhSig, tamperedMessage, slhPub)).toBe(false);
  });
});

describe('signTriple — backward compat', () => {
  it('BACKWARD COMPAT: keyId for a known JWT_SECRET matches the pre-PQC value', async () => {
    // Golden value captured from the ORIGINAL getPdfSigningKey() (before this
    // plan), to prove deriveEd25519Seed()'s formula — and therefore every
    // already-issued signature's verifiability — is unchanged. Computed by
    // running the exact pre-change derivation formula (SHA-256(secret|
    // 'rmpg-pdf-ed25519-v1') -> seed -> SHA-256(seed) -> first 8 bytes hex)
    // against the fixed secret below. Never hand-edit this value — if this
    // test ever needs to change, something broke backward compatibility.
    const result = await signTriple({ JWT_SECRET: 'golden-test-secret-do-not-change' } as unknown as Bindings, 'x', 'y', 'a'.repeat(64));
    expect(result.keyId).toBe('867c4da05488c3a2');
  });
});
