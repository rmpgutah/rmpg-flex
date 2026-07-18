import { describe, it, expect } from 'vitest';
import { ml_dsa87 } from '@noble/post-quantum/ml-dsa.js';
import { slh_dsa_sha2_256f } from '@noble/post-quantum/slh-dsa.js';
import { deriveHkdfSeedForTest } from '../src/utils/pdfSign';
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

describe('deriveHkdfSeedForTest', () => {
  const env = { JWT_SECRET: 'test-jwt-secret-value' } as unknown as Bindings;

  it('derives the requested byte length', async () => {
    const seed32 = await deriveHkdfSeedForTest(env, 'label-a', 32);
    const seed96 = await deriveHkdfSeedForTest(env, 'label-a', 96);
    expect(seed32.length).toBe(32);
    expect(seed96.length).toBe(96);
  });

  it('is deterministic for the same env + label', async () => {
    const a = await deriveHkdfSeedForTest(env, 'label-a', 32);
    const b = await deriveHkdfSeedForTest(env, 'label-a', 32);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('produces different bytes for different labels (domain separation)', async () => {
    const a = await deriveHkdfSeedForTest(env, 'label-a', 32);
    const b = await deriveHkdfSeedForTest(env, 'label-b', 32);
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });

  it('prefers PDF_SIGNING_KEY over JWT_SECRET when both are set', async () => {
    const envWithBoth = { JWT_SECRET: 'jwt-value', PDF_SIGNING_KEY: 'dGVzdC1wZGYtc2lnbmluZy1rZXk=' } as unknown as Bindings;
    const envJwtOnly = { JWT_SECRET: 'jwt-value' } as unknown as Bindings;
    const a = await deriveHkdfSeedForTest(envWithBoth, 'label-a', 32);
    const b = await deriveHkdfSeedForTest(envJwtOnly, 'label-a', 32);
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });
});
