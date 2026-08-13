import { describe, it, expect } from 'vitest';
import { encryptBrowserData, decryptBrowserData } from '../src/utils/companyBrowserCrypto';

const env = { JWT_SECRET: 'test-jwt-secret-value' };

describe('companyBrowserCrypto (AEGIS-256X2)', () => {
  it('round-trips plaintext through encrypt then decrypt', async () => {
    const plaintext = JSON.stringify([{ id: 'b1', url: 'https://example.com', title: 'Example' }]);
    const ciphertext = await encryptBrowserData(env, plaintext);
    expect(ciphertext).not.toBe(plaintext);
    expect(ciphertext.startsWith('v2:')).toBe(true);
    const decrypted = await decryptBrowserData(env, ciphertext);
    expect(decrypted).toBe(plaintext);
  });

  it('produces different ciphertext for the same plaintext on repeated calls (random nonce)', async () => {
    const plaintext = 'same input twice';
    const a = await encryptBrowserData(env, plaintext);
    const b = await encryptBrowserData(env, plaintext);
    expect(a).not.toBe(b);
  });

  it('passes through legacy (non-v1:/v2:-prefixed) plaintext unchanged', async () => {
    const legacy = JSON.stringify([{ id: 'old', url: 'https://legacy.example.com', title: 'Legacy' }]);
    const result = await decryptBrowserData(env, legacy);
    expect(result).toBe(legacy);
  });

  it('returns null for a corrupted/truncated v2 ciphertext instead of throwing', async () => {
    const result = await decryptBrowserData(env, 'v2:not-valid-base64-ciphertext-at-all');
    expect(result).toBeNull();
  });

  it('returns null when the tag is tampered (authentication failure)', async () => {
    const ct = await encryptBrowserData(env, 'sensitive data');
    // Strip "v2:", decode, flip last byte (last byte of auth tag), re-encode.
    const raw = ct.slice(3);
    const decoded = atob(raw);
    const flipped = decoded.slice(0, -1) + String.fromCharCode(decoded.charCodeAt(decoded.length - 1) ^ 0xff);
    const tampered = `v2:${btoa(flipped)}`;
    const result = await decryptBrowserData(env, tampered);
    expect(result).toBeNull();
  });

  it('decrypts a legacy v1: AES-GCM blob on the read-only compat path', async () => {
    // Synthesise a v1: blob using Web Crypto directly (the old scheme).
    const keyRaw = new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${env.JWT_SECRET}|company-browser-data-v1`)),
    );
    const ck = await crypto.subtle.importKey('raw', keyRaw, { name: 'AES-GCM' }, false, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ctBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, ck, new TextEncoder().encode('legacy plaintext'));
    const blob = new Uint8Array(12 + ctBuf.byteLength);
    blob.set(iv, 0);
    blob.set(new Uint8Array(ctBuf), 12);
    let b64 = '';
    for (const b of blob) b64 += String.fromCharCode(b);
    const stored = `v1:${btoa(b64)}`;

    const result = await decryptBrowserData(env, stored);
    expect(result).toBe('legacy plaintext');
  });

  it('derives a different key than emailCrypto.ts would for the same JWT_SECRET (domain separation)', async () => {
    const { encryptSecret } = await import('../src/utils/emailCrypto');
    const plaintext = 'shared-secret-material-test';
    const emailCiphertext = await encryptSecret(env, plaintext);
    // emailCrypto produces a v1: blob encrypted under the email key.
    // decryptBrowserData uses a domain-separated key, so the AES-GCM auth tag fails -> null.
    const browserAttempt = await decryptBrowserData(env, emailCiphertext);
    expect(browserAttempt).toBeNull();
  });

  it('round-trips an empty string', async () => {
    const ct = await encryptBrowserData(env, '');
    const pt = await decryptBrowserData(env, ct);
    expect(pt).toBe('');
  });

  it('round-trips a large payload (simulated bookmark list)', async () => {
    const bookmarks = Array.from({ length: 200 }, (_, i) => ({
      id: `bm${i}`, url: `https://example.com/page${i}`, title: `Page ${i}`,
    }));
    const plaintext = JSON.stringify(bookmarks);
    const ct = await encryptBrowserData(env, plaintext);
    const pt = await decryptBrowserData(env, ct);
    expect(pt).toBe(plaintext);
  });
});
