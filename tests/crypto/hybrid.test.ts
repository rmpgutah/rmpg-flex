import { describe, it, expect } from 'vitest';
import {
  seal,
  open,
  hybridSign,
  hybridVerify,
  hybridSigningKeygen,
  kemKeygen,
  parseHybridSignature,
  ED25519_SIG_LEN,
} from '../../src/utils/crypto';

describe('hybrid sealed box (X25519 + ML-KEM-768 -> HKDF -> AES-256-GCM)', () => {
  it('round-trips a message to a static recipient keypair', async () => {
    const recipient = kemKeygen();
    const msg = new TextEncoder().encode('RMPG Flex evidence payload — case 2026-0001');
    const { frame } = await seal(msg, recipient.publicKey);
    expect(frame.length).toBeGreaterThan(0);
    const recovered = await open(frame, recipient.secretKey);
    expect(recovered).toEqual(msg);
  });

  it('round-trips binary payloads of varied lengths', async () => {
    const recipient = kemKeygen();
    for (const len of [0, 1, 16, 255, 1024, 4096]) {
      const msg = new Uint8Array(len);
      for (let i = 0; i < len; i++) msg[i] = i & 0xff;
      const { frame } = await seal(msg, recipient.publicKey);
      expect(await open(frame, recipient.secretKey)).toEqual(msg);
    }
  });

  it('binds caller AAD: a correct AAD opens, a wrong AAD fails', async () => {
    const recipient = kemKeygen();
    const msg = new TextEncoder().encode('evidence');
    const aad = new TextEncoder().encode('record:42');
    const { frame } = await seal(msg, recipient.publicKey, aad);
    await expect(open(frame, recipient.secretKey, aad)).resolves.toEqual(msg);
    await expect(open(frame, recipient.secretKey, new TextEncoder().encode('record:43'))).rejects.toThrow();
  });

  it('fails closed when opened with the wrong recipient secret key', async () => {
    const recipient = kemKeygen();
    const other = kemKeygen();
    const msg = new TextEncoder().encode('secret');
    const { frame } = await seal(msg, recipient.publicKey);
    await expect(open(frame, other.secretKey)).rejects.toThrow();
  });

  it('evidence: two distinct seals produce independent frames (fresh KEM randomness)', async () => {
    const recipient = kemKeygen();
    const msg = new TextEncoder().encode('x');
    const a = await seal(msg, recipient.publicKey);
    const b = await seal(msg, recipient.publicKey);
    expect(a.frame).not.toEqual(b.frame);
    expect(await open(a.frame, recipient.secretKey)).toEqual(msg);
    expect(await open(b.frame, recipient.secretKey)).toEqual(msg);
  });
});

describe('hybrid signature (Ed25519 AND ML-DSA-65)', () => {
  it('signs and verifies a message with both halves', () => {
    const kp = hybridSigningKeygen();
    const msg = new TextEncoder().encode('audit event 7 — case sealed 2026-07-24T12:00:00Z');
    const sig = hybridSign(msg, kp.ed.secretKey, kp.pq.secretKey);
    expect(
      hybridVerify(sig, msg, kp.ed.publicKey, kp.pq.publicKey),
    ).toBe(true);
  });

  it('rejects a tampered message (both halves must verify)', () => {
    const kp = hybridSigningKeygen();
    const msg = new TextEncoder().encode('original audit event');
    const sig = hybridSign(msg, kp.ed.secretKey, kp.pq.secretKey);
    expect(
      hybridVerify(sig, new TextEncoder().encode('tampered audit event'), kp.ed.publicKey, kp.pq.publicKey),
    ).toBe(false);
  });

  it('rejects a signature where only the classical half is valid (PQ half swapped)', () => {
    const kp = hybridSigningKeygen();
    const other = hybridSigningKeygen();
    const msg = new TextEncoder().encode('msg');
    const sig = hybridSign(msg, kp.ed.secretKey, kp.pq.secretKey);
    // PQ public key from a different identity -> PQ half fails -> AND fails.
    expect(hybridVerify(sig, msg, kp.ed.publicKey, other.pq.publicKey)).toBe(false);
  });

  it('parses the Ed25519 half at the fixed 64-byte offset', () => {
    const kp = hybridSigningKeygen();
    const msg = new TextEncoder().encode('p');
    const sig = hybridSign(msg, kp.ed.secretKey, kp.pq.secretKey);
    const parsed = parseHybridSignature(sig);
    expect(parsed.ed.length).toBe(ED25519_SIG_LEN);
    expect(parsed.pq.length).toBeGreaterThan(0);
  });

  it('returns false (never throws) on a truncated signature with wrong pub sizes', () => {
    expect(hybridVerify(new Uint8Array(0), new Uint8Array(1), new Uint8Array(0), new Uint8Array(0))).toBe(false);
  });
});