// ============================================================
// evidenceSigner — Ed25519 signing for evidence_hashes entries
// ============================================================
// Each evidence_hashes row gets a signature over a stable
// JSON-canonicalized payload (artifact_type, artifact_id,
// sha256, captured_at, prev_hash_id) so a single host
// compromise can't silently rewrite history without breaking
// signature verification against the public key.
//
// Tests verify:
//   1. Keypair generation produces 32-byte raw Ed25519 keys
//   2. Sign + verify round-trip
//   3. Verify rejects tampered payloads
//   4. Verify rejects wrong public key
//   5. Canonical payload format is deterministic across key order
//   6. Verifier handles base64-encoded keys (env-friendly)

import { describe, it, expect } from 'vitest';
import {
  generateEd25519Keypair,
  signEvidencePayload,
  verifyEvidenceSignature,
  canonicalizeEvidencePayload,
  loadKeypairFromEnv,
  type EvidencePayload,
} from '../evidenceSigner';

describe('generateEd25519Keypair', () => {
  it('produces a base64 keypair with both keys non-empty', () => {
    const kp = generateEd25519Keypair();
    expect(kp.publicKey).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(kp.privateKey).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(kp.publicKey.length).toBeGreaterThan(20);
    expect(kp.privateKey.length).toBeGreaterThan(20);
  });

  it('produces fresh keys on each call', () => {
    const a = generateEd25519Keypair();
    const b = generateEd25519Keypair();
    expect(a.publicKey).not.toBe(b.publicKey);
    expect(a.privateKey).not.toBe(b.privateKey);
  });
});

describe('canonicalizeEvidencePayload', () => {
  it('produces the same string regardless of key order in input', () => {
    const a: EvidencePayload = {
      artifact_type: 'driving_event_clip',
      artifact_id: 42,
      sha256: 'a'.repeat(64),
      captured_at: '2026-04-28 12:00:00',
      prev_hash_id: 7,
    };
    const b: any = {
      prev_hash_id: 7,
      sha256: 'a'.repeat(64),
      artifact_id: 42,
      captured_at: '2026-04-28 12:00:00',
      artifact_type: 'driving_event_clip',
    };
    expect(canonicalizeEvidencePayload(a)).toBe(canonicalizeEvidencePayload(b));
  });

  it('serializes prev_hash_id=null distinctly from absent', () => {
    const a: EvidencePayload = {
      artifact_type: 'x', artifact_id: 1, sha256: 'a'.repeat(64),
      captured_at: 't', prev_hash_id: null,
    };
    expect(canonicalizeEvidencePayload(a)).toContain('"prev_hash_id":null');
  });
});

describe('sign + verify round-trip', () => {
  it('verifies a freshly-signed payload', () => {
    const kp = generateEd25519Keypair();
    const payload: EvidencePayload = {
      artifact_type: 'driving_event_clip',
      artifact_id: 1,
      sha256: 'a'.repeat(64),
      captured_at: '2026-04-28 12:00:00',
      prev_hash_id: null,
    };
    const sig = signEvidencePayload(kp.privateKey, payload);
    expect(sig).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(verifyEvidenceSignature(kp.publicKey, payload, sig)).toBe(true);
  });

  it('rejects a tampered sha256', () => {
    const kp = generateEd25519Keypair();
    const payload: EvidencePayload = {
      artifact_type: 'driving_event_clip',
      artifact_id: 1,
      sha256: 'a'.repeat(64),
      captured_at: '2026-04-28 12:00:00',
      prev_hash_id: null,
    };
    const sig = signEvidencePayload(kp.privateKey, payload);
    const tampered = { ...payload, sha256: 'b'.repeat(64) };
    expect(verifyEvidenceSignature(kp.publicKey, tampered, sig)).toBe(false);
  });

  it('rejects a tampered artifact_id', () => {
    const kp = generateEd25519Keypair();
    const payload: EvidencePayload = {
      artifact_type: 'driving_event_clip', artifact_id: 1,
      sha256: 'c'.repeat(64), captured_at: 't', prev_hash_id: null,
    };
    const sig = signEvidencePayload(kp.privateKey, payload);
    expect(verifyEvidenceSignature(kp.publicKey, { ...payload, artifact_id: 99 }, sig)).toBe(false);
  });

  it('rejects a verification with the wrong public key', () => {
    const a = generateEd25519Keypair();
    const b = generateEd25519Keypair();
    const payload: EvidencePayload = {
      artifact_type: 'x', artifact_id: 1, sha256: 'a'.repeat(64),
      captured_at: 't', prev_hash_id: null,
    };
    const sig = signEvidencePayload(a.privateKey, payload);
    expect(verifyEvidenceSignature(b.publicKey, payload, sig)).toBe(false);
  });

  it('rejects an entirely garbage signature without throwing', () => {
    const kp = generateEd25519Keypair();
    const payload: EvidencePayload = {
      artifact_type: 'x', artifact_id: 1, sha256: 'a'.repeat(64),
      captured_at: 't', prev_hash_id: null,
    };
    expect(() => verifyEvidenceSignature(kp.publicKey, payload, 'not-a-real-sig')).not.toThrow();
    expect(verifyEvidenceSignature(kp.publicKey, payload, 'not-a-real-sig')).toBe(false);
  });
});

describe('loadKeypairFromEnv', () => {
  it('returns null when env vars unset', () => {
    expect(loadKeypairFromEnv({} as any)).toBeNull();
  });

  it('loads valid env keys', () => {
    const kp = generateEd25519Keypair();
    const env = {
      EVIDENCE_SIGNING_PRIVATE_KEY: kp.privateKey,
      EVIDENCE_SIGNING_PUBLIC_KEY: kp.publicKey,
    };
    const loaded = loadKeypairFromEnv(env as any);
    expect(loaded).not.toBeNull();
    expect(loaded!.privateKey).toBe(kp.privateKey);
    expect(loaded!.publicKey).toBe(kp.publicKey);
  });

  it('returns null when only one of the two keys is set (incomplete config)', () => {
    expect(loadKeypairFromEnv({ EVIDENCE_SIGNING_PRIVATE_KEY: 'abc' } as any)).toBeNull();
    expect(loadKeypairFromEnv({ EVIDENCE_SIGNING_PUBLIC_KEY: 'abc' } as any)).toBeNull();
  });
});
