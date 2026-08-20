import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { TEST_KEK, envWithKek, ensureFileEncryptionKeysTable } from './fileEncryptionTestSchema';

describe('fileEncryptionTestSchema helper', () => {
  it('TEST_KEK decodes to exactly 32 bytes', () => {
    const bin = atob(TEST_KEK);
    expect(bin.length).toBe(32);
  });

  it('envWithKek adds FILE_ENCRYPTION_KEK without mutating the input', () => {
    const base = { DB: 'placeholder' } as unknown as Record<string, unknown>;
    const withKek = envWithKek(base);
    expect(withKek.FILE_ENCRYPTION_KEK).toBe(TEST_KEK);
    expect(base.FILE_ENCRYPTION_KEK).toBeUndefined();
  });

  it('ensureFileEncryptionKeysTable creates a queryable table', async () => {
    await ensureFileEncryptionKeysTable(env.DB as unknown as D1Database);
    const row = await (env.DB as unknown as D1Database)
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='file_encryption_keys'")
      .first<{ name: string }>();
    expect(row?.name).toBe('file_encryption_keys');
  });
});
