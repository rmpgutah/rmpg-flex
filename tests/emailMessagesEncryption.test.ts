import { describe, it, expect, vi } from 'vitest';
import { encryptField, decryptFieldIfEncrypted } from '../src/utils/emailFieldCrypto';
import { readFileSync } from 'node:fs';

const TEST_KEK = 'MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTI=';

// This test exercises the encrypt-then-search-narrows-then-decrypt round trip
// at the level of the pure helpers, since a full Hono route test would need
// Miniflare (covered separately in test-workers/ per project convention).
// It documents the CONTRACT this task's route changes must satisfy:
// body_preview is stored encrypted, and a value read back out must decrypt
// to the original.
describe('email_messages.body_preview encryption contract', () => {
  it('a body_preview written via encryptField and read back via decryptFieldIfEncrypted round-trips', async () => {
    const env = { EMAIL_FIELD_ENCRYPTION_KEK: TEST_KEK };
    const original = 'Officer requested backup at 123 Main St — see attached photo.';
    const stored = await encryptField(env, original);
    expect(stored.startsWith('v2:')).toBe(true);
    const readBack = await decryptFieldIfEncrypted(env, stored);
    expect(readBack).toBe(original);
  });

  it('a legacy plaintext body_preview (pre-encryption row) still decrypts to itself', async () => {
    const env = { EMAIL_FIELD_ENCRYPTION_KEK: TEST_KEK };
    const legacy = 'Old cached preview text from before encryption shipped';
    expect(await decryptFieldIfEncrypted(env, legacy)).toBe(legacy);
  });
});

describe('GET /messages/search query shape', () => {
  it('does not LIKE-match body_preview (ciphertext cannot be pattern-matched)', () => {
    const src = readFileSync(new URL('../src/routes/email.ts', import.meta.url), 'utf-8');
    const searchHandlerMatch = src.match(/email\.get\('\/messages\/search'[\s\S]*?\n}\);/);
    expect(searchHandlerMatch).toBeTruthy();
    const handlerSrc = searchHandlerMatch![0];
    expect(handlerSrc).not.toMatch(/body_preview\s+LIKE/);
    expect(handlerSrc).toMatch(/subject\s+LIKE/);
    expect(handlerSrc).toMatch(/from_address\s+LIKE/);
  });
});
