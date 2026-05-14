// Tests for pdfSigner.ts — Ed25519 signing of PDF payload
// envelopes. Covers canonicalization stability, sign/verify
// round-trip, tamper detection, and the env-driven helper's
// graceful null return when the keypair is unset.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  canonicalizePdfPayload,
  signPdfPayload,
  verifyPdfSignature,
  signPdfWithEnv,
  type PdfSignaturePayload,
} from '../pdfSigner';
import { generateEd25519Keypair } from '../evidenceSigner';

const FIXED_PAYLOAD: PdfSignaturePayload = {
  formKey: 'incident',
  caseNumber: 'INC-26-001',
  payloadHash: 'a'.repeat(64),
  signedAt: '2026-04-01T00:00:00Z',
};

describe('canonicalizePdfPayload', () => {
  it('emits keys in alphabetical order', () => {
    const out = canonicalizePdfPayload(FIXED_PAYLOAD);
    expect(out).toBe(
      '{"algorithm":"Ed25519","case_number":"INC-26-001","form_key":"incident",'
      + `"payload_sha256":"${'a'.repeat(64)}","signed_at":"2026-04-01T00:00:00Z"}`,
    );
  });

  it('produces byte-identical output for two equivalent payloads', () => {
    const a = canonicalizePdfPayload(FIXED_PAYLOAD);
    const b = canonicalizePdfPayload({ ...FIXED_PAYLOAD });
    expect(a).toBe(b);
  });

  it('changes when payloadHash changes', () => {
    const a = canonicalizePdfPayload(FIXED_PAYLOAD);
    const b = canonicalizePdfPayload({ ...FIXED_PAYLOAD, payloadHash: 'b'.repeat(64) });
    expect(a).not.toBe(b);
  });
});

describe('sign/verify round-trip', () => {
  const kp = generateEd25519Keypair();

  it('verifies a valid signature', () => {
    const sig = signPdfPayload(kp.privateKey, FIXED_PAYLOAD);
    expect(verifyPdfSignature(kp.publicKey, FIXED_PAYLOAD, sig)).toBe(true);
  });

  it('rejects when payloadHash was tampered', () => {
    const sig = signPdfPayload(kp.privateKey, FIXED_PAYLOAD);
    const tampered = { ...FIXED_PAYLOAD, payloadHash: 'b'.repeat(64) };
    expect(verifyPdfSignature(kp.publicKey, tampered, sig)).toBe(false);
  });

  it('rejects when caseNumber was tampered', () => {
    const sig = signPdfPayload(kp.privateKey, FIXED_PAYLOAD);
    const tampered = { ...FIXED_PAYLOAD, caseNumber: 'INC-99-999' };
    expect(verifyPdfSignature(kp.publicKey, tampered, sig)).toBe(false);
  });

  it('rejects when formKey was tampered (cross-form replay protection)', () => {
    const sig = signPdfPayload(kp.privateKey, FIXED_PAYLOAD);
    const tampered = { ...FIXED_PAYLOAD, formKey: 'court_event' };
    expect(verifyPdfSignature(kp.publicKey, tampered, sig)).toBe(false);
  });

  it('rejects when verifying with a different keypair', () => {
    const sig = signPdfPayload(kp.privateKey, FIXED_PAYLOAD);
    const otherKp = generateEd25519Keypair();
    expect(verifyPdfSignature(otherKp.publicKey, FIXED_PAYLOAD, sig)).toBe(false);
  });

  it('rejects malformed base64 signatures without throwing', () => {
    expect(verifyPdfSignature(kp.publicKey, FIXED_PAYLOAD, 'not-base64-!@#$')).toBe(false);
    expect(verifyPdfSignature(kp.publicKey, FIXED_PAYLOAD, '')).toBe(false);
  });

  it('produces 88-char base64 signatures (64 raw bytes for Ed25519)', () => {
    const sig = signPdfPayload(kp.privateKey, FIXED_PAYLOAD);
    expect(sig).toHaveLength(88);
  });
});

describe('signPdfWithEnv (graceful degradation)', () => {
  const ORIGINAL_PRIV = process.env.EVIDENCE_SIGNING_PRIVATE_KEY;
  const ORIGINAL_PUB = process.env.EVIDENCE_SIGNING_PUBLIC_KEY;

  beforeEach(() => {
    delete process.env.EVIDENCE_SIGNING_PRIVATE_KEY;
    delete process.env.EVIDENCE_SIGNING_PUBLIC_KEY;
  });

  afterEach(() => {
    if (ORIGINAL_PRIV !== undefined) process.env.EVIDENCE_SIGNING_PRIVATE_KEY = ORIGINAL_PRIV;
    else delete process.env.EVIDENCE_SIGNING_PRIVATE_KEY;
    if (ORIGINAL_PUB !== undefined) process.env.EVIDENCE_SIGNING_PUBLIC_KEY = ORIGINAL_PUB;
    else delete process.env.EVIDENCE_SIGNING_PUBLIC_KEY;
  });

  it('returns null when neither env var is set', () => {
    expect(signPdfWithEnv(FIXED_PAYLOAD)).toBeNull();
  });

  it('returns null when only one env var is set', () => {
    process.env.EVIDENCE_SIGNING_PRIVATE_KEY = 'something';
    expect(signPdfWithEnv(FIXED_PAYLOAD)).toBeNull();
  });

  it('returns a full signature envelope when both env vars are set', () => {
    const kp = generateEd25519Keypair();
    process.env.EVIDENCE_SIGNING_PRIVATE_KEY = kp.privateKey;
    process.env.EVIDENCE_SIGNING_PUBLIC_KEY = kp.publicKey;
    const result = signPdfWithEnv(FIXED_PAYLOAD);
    expect(result).not.toBeNull();
    expect(result!.signature).toHaveLength(88);
    expect(result!.publicKey).toBe(kp.publicKey);
    expect(result!.algorithm).toBe('Ed25519');
    expect(result!.signedAt).toBe(FIXED_PAYLOAD.signedAt);
    // And it must verify against the same keypair
    expect(verifyPdfSignature(kp.publicKey, FIXED_PAYLOAD, result!.signature)).toBe(true);
  });
});
