import { describe, it, expect } from 'vitest';
import { encryptSecret, decryptSecret, isEncrypted, CpgCryptoError } from '../src/utils/cpgCrypto';

// A deterministic base64 32-byte key for tests.
const KEY = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => i)));

describe('cpgCrypto', () => {
  it('round-trips a secret', async () => {
    const enc = await encryptSecret('s3cr3t-p@ss', KEY);
    expect(enc.startsWith('v1:')).toBe(true);
    expect(enc).not.toContain('s3cr3t');
    const dec = await decryptSecret(enc, KEY);
    expect(dec).toBe('s3cr3t-p@ss');
  });

  it('produces a fresh IV each call (ciphertext differs for same input)', async () => {
    const a = await encryptSecret('same', KEY);
    const b = await encryptSecret('same', KEY);
    expect(a).not.toBe(b);
    expect(await decryptSecret(a, KEY)).toBe('same');
    expect(await decryptSecret(b, KEY)).toBe('same');
  });

  it('emits the v1:iv:ct shape', async () => {
    const enc = await encryptSecret('x', KEY);
    const parts = enc.split(':');
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe('v1');
  });

  it('throws on a tampered ciphertext', async () => {
    const enc = await encryptSecret('hunter2', KEY);
    const parts = enc.split(':');
    // Flip the FIRST base64 char of the ciphertext segment — guaranteed to
    // fall inside a full 4-char/3-byte group, so it always changes a real
    // ciphertext/tag byte. Flipping near the END (as this test originally
    // did) is flaky: a fixed-length payload's tail group can have unused
    // padding bits (e.g. 23 bytes -> a final partial group whose last
    // char's low 2 bits are always-zero filler, not real byte content), so
    // some random ciphertexts/tags produce a byte-identical decode despite
    // a different base64 string, letting decryption spuriously succeed.
    const first = parts[2];
    parts[2] = (first.slice(0, 1) === 'A' ? 'B' : 'A') + first.slice(1);
    await expect(decryptSecret(parts.join(':'), KEY)).rejects.toBeInstanceOf(CpgCryptoError);
  });

  it('throws a typed error when the key is missing', async () => {
    await expect(encryptSecret('x', undefined)).rejects.toBeInstanceOf(CpgCryptoError);
  });

  it('throws a typed error when the key is the wrong length', async () => {
    await expect(encryptSecret('x', btoa('short'))).rejects.toBeInstanceOf(CpgCryptoError);
  });

  it('rejects a malformed stored value', async () => {
    await expect(decryptSecret('not-a-blob', KEY)).rejects.toBeInstanceOf(CpgCryptoError);
  });

  it('isEncrypted recognises our blobs only', async () => {
    const enc = await encryptSecret('x', KEY);
    expect(isEncrypted(enc)).toBe(true);
    expect(isEncrypted('plaintext')).toBe(false);
    expect(isEncrypted(null)).toBe(false);
  });
});
