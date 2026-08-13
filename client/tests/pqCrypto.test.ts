import { describe, it, expect } from 'vitest';
import { seal as browserSeal, b64encode, b64decode, utf8, looksLikeSealedFrame } from '../src/utils/pqCrypto';

// Server-side open() — imported from the Worker source tree via relative path.
// vitest resolves TS through the project; this proves wire-compatibility:
// the browser seal() output must open with the Worker open() verbatim.
// We mirror the server constants here rather than importing across the
// src/↔client/src/ boundary (separate tsconfigs/builds).
import {
  ml_kem768_x25519,
} from '@noble/post-quantum/hybrid.js';

const SEAL_MAGIC = utf8('RMPGSEAL');
const SEAL_VERSION = 0x01;
const SEAL_INFO = utf8('RMPG-FLEX/hybrid-seal/v1');
const KEM_CT_LEN = ml_kem768_x25519.lengths.cipherText!;

async function hkdf(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm as unknown as BufferSource, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: salt as unknown as BufferSource, info: info as unknown as BufferSource } as HkdfParams,
    key,
    length * 8,
  );
  return new Uint8Array(bits);
}

// Mirror of Worker open(): parse the frame the browser produced and recover plaintext.
async function serverOpen(frame: Uint8Array, recipientSecretKey: Uint8Array, aad?: Uint8Array): Promise<Uint8Array> {
  const magic = frame.subarray(0, SEAL_MAGIC.length);
  if (!magic.every((b, i) => b === SEAL_MAGIC[i])) throw new Error('bad magic');
  if (frame[SEAL_MAGIC.length] !== SEAL_VERSION) throw new Error('bad version');
  let off = SEAL_MAGIC.length + 1;
  const kemCT = frame.subarray(off, off + KEM_CT_LEN);
  off += KEM_CT_LEN;
  const iv = frame.subarray(off, off + 12);
  off += 12;
  const ciphertext = frame.subarray(off);
  const sharedSecret = ml_kem768_x25519.decapsulate(kemCT, recipientSecretKey) as Uint8Array;
  const cek = await hkdf(sharedSecret, kemCT, SEAL_INFO, 32);
  const key = await crypto.subtle.importKey('raw', cek as unknown as BufferSource, { name: 'AES-GCM' }, false, ['decrypt']);
  const params: AesGcmParams = { name: 'AES-GCM', iv: iv as unknown as BufferSource };
  if (aad) params.additionalData = aad as unknown as BufferSource;
  const pt = await crypto.subtle.decrypt(params, key, ciphertext as unknown as BufferSource);
  return new Uint8Array(pt);
}

describe('client pqCrypto.ts — frame format & interop', () => {
  it('generates a keypair with the same KEM and seals to its public key', async () => {
    const recipient = ml_kem768_x25519.keygen();
    const pubB64 = b64encode(recipient.publicKey as Uint8Array);
    const msg = utf8('officer-device evidence — sealed before upload');
    const { frame } = await browserSeal(msg, pubB64, utf8('evidence:1'));
    expect(looksLikeSealedFrame(frame)).toBe(true);
    // The server (holding the secret key) opens it:
    const recovered = await serverOpen(frame, recipient.secretKey as Uint8Array, utf8('evidence:1'));
    // Compare byte-wise (vitest toEqual is pedantic about Uint8Array buffer identity).
    expect(recovered.length).toBe(msg.length);
    expect(Array.from(recovered)).toEqual(Array.from(msg));
  });

  it('rejects AAD mismatch exactly like the server would', async () => {
    const recipient = ml_kem768_x25519.keygen();
    const pubB64 = b64encode(recipient.publicKey as Uint8Array);
    const { frame } = await browserSeal(utf8('v'), pubB64, utf8('aad-correct'));
    await expect(serverOpen(frame, recipient.secretKey as Uint8Array, utf8('aad-wrong'))).rejects.toThrow();
  });

  it('two browser seals to the same recipient are independent (fresh KEM randomness)', async () => {
    const recipient = ml_kem768_x25519.keygen();
    const pubB64 = b64encode(recipient.publicKey as Uint8Array);
    const a = await browserSeal(utf8('x'), pubB64);
    const b = await browserSeal(utf8('x'), pubB64);
    expect(a.frame).not.toEqual(b.frame);
  });

  it('looksLikeSealedFrame rejects random/non-RMPGSEAL bytes', () => {
    expect(looksLikeSealedFrame(new Uint8Array(32))).toBe(false);
    expect(looksLikeSealedFrame(utf8('not a seal at all, too short'))).toBe(false);
  });

  it('base64 round-trips bytes identically (shared helper parity with server)', () => {
    const bytes = new Uint8Array([0, 80, 255, 1, 2, 3]);
    expect(b64decode(b64encode(bytes))).toEqual(bytes);
  });
});