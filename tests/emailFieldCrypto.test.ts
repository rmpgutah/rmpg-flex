import { describe, it, expect } from 'vitest';
import { encryptField, decryptFieldIfEncrypted, EmailFieldEncryptionError } from '../src/utils/emailFieldCrypto';

// 32 random bytes, base64-encoded — a valid test KEK.
const TEST_KEK = 'MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTI=';

describe('emailFieldCrypto', () => {
  it('round-trips a plaintext value through encrypt then decrypt', async () => {
    const env = { EMAIL_FIELD_ENCRYPTION_KEK: TEST_KEK };
    const encrypted = await encryptField(env, 'Case update: subject closed');
    expect(encrypted.startsWith('v2:')).toBe(true);
    const decrypted = await decryptFieldIfEncrypted(env, encrypted);
    expect(decrypted).toBe('Case update: subject closed');
  });

  it('passes through a value that is not v2:-prefixed unchanged (legacy plaintext row)', async () => {
    const env = { EMAIL_FIELD_ENCRYPTION_KEK: TEST_KEK };
    const result = await decryptFieldIfEncrypted(env, 'plain unencrypted body preview text');
    expect(result).toBe('plain unencrypted body preview text');
  });

  it('returns empty string for null/undefined input', async () => {
    const env = { EMAIL_FIELD_ENCRYPTION_KEK: TEST_KEK };
    expect(await decryptFieldIfEncrypted(env, null)).toBe('');
    expect(await decryptFieldIfEncrypted(env, undefined)).toBe('');
  });

  it('throws EmailFieldEncryptionError when encrypting with no KEK set', async () => {
    const env = {};
    await expect(encryptField(env, 'anything')).rejects.toThrow(EmailFieldEncryptionError);
  });

  it('throws EmailFieldEncryptionError when decrypting a v2: value with no KEK set', async () => {
    const env = { EMAIL_FIELD_ENCRYPTION_KEK: TEST_KEK };
    const encrypted = await encryptField(env, 'secret body');
    await expect(decryptFieldIfEncrypted({}, encrypted)).rejects.toThrow(EmailFieldEncryptionError);
  });

  it('produces different ciphertext for the same plaintext on repeated calls (fresh IV/DEK each time)', async () => {
    const env = { EMAIL_FIELD_ENCRYPTION_KEK: TEST_KEK };
    const a = await encryptField(env, 'same text');
    const b = await encryptField(env, 'same text');
    expect(a).not.toBe(b);
  });

  it('throws EmailFieldEncryptionError for a malformed (non-32-byte) KEK', async () => {
    const env = { EMAIL_FIELD_ENCRYPTION_KEK: 'dG9vc2hvcnQ=' }; // "tooshort" base64, not 32 bytes
    await expect(encryptField(env, 'x')).rejects.toThrow(EmailFieldEncryptionError);
  });
});
