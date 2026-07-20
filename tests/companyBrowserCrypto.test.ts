import { describe, it, expect } from 'vitest';
import { encryptBrowserData, decryptBrowserData } from '../src/utils/companyBrowserCrypto';

const env = { JWT_SECRET: 'test-jwt-secret-value' };

describe('companyBrowserCrypto', () => {
  it('round-trips plaintext through encrypt then decrypt', async () => {
    const plaintext = JSON.stringify([{ id: 'b1', url: 'https://example.com', title: 'Example' }]);
    const ciphertext = await encryptBrowserData(env, plaintext);
    expect(ciphertext).not.toBe(plaintext);
    expect(ciphertext.startsWith('v1:')).toBe(true);
    const decrypted = await decryptBrowserData(env, ciphertext);
    expect(decrypted).toBe(plaintext);
  });

  it('produces different ciphertext for the same plaintext on repeated calls (random IV)', async () => {
    const plaintext = 'same input twice';
    const a = await encryptBrowserData(env, plaintext);
    const b = await encryptBrowserData(env, plaintext);
    expect(a).not.toBe(b);
  });

  it('passes through legacy (non-v1:-prefixed) plaintext unchanged', async () => {
    const legacy = JSON.stringify([{ id: 'old', url: 'https://legacy.example.com', title: 'Legacy' }]);
    const result = await decryptBrowserData(env, legacy);
    expect(result).toBe(legacy);
  });

  it('returns null for a corrupted/truncated ciphertext instead of throwing', async () => {
    const result = await decryptBrowserData(env, 'v1:not-valid-base64-ciphertext-at-all');
    expect(result).toBeNull();
  });

  it('derives a different key than emailCrypto.ts would for the same JWT_SECRET (domain separation)', async () => {
    // Two independently-encrypted values under the two different modules'
    // fallback-key derivations must NOT be decryptable by swapping which
    // module reads which ciphertext — proves the derived keys differ.
    const { encryptSecret } = await import('../src/utils/emailCrypto');
    const plaintext = 'shared-secret-material-test';
    const emailCiphertext = await encryptSecret(env, plaintext);
    const browserPlaintextAttempt = await decryptBrowserData(env, emailCiphertext);
    // If the keys were identical, this would successfully decrypt to `plaintext`.
    // With domain separation, AES-GCM's auth tag check fails -> null.
    expect(browserPlaintextAttempt).toBeNull();
  });
});
