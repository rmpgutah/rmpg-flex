import { describe, it, expect, vi } from 'vitest';
import { putEncrypted, getDecrypted, deleteEncryptionKey, FileEncryptionError, _resetKeysTableEnsuredForTest } from '../src/utils/encryptedR2';

// A deterministic base64 32-byte KEK for tests.
const KEK = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => i)));

function makeMockBucket() {
  const store = new Map<string, { data: ArrayBuffer; httpMetadata?: { contentType?: string } }>();
  return {
    bucket: {
      async put(key: string, data: ArrayBuffer | Uint8Array, opts?: { httpMetadata?: { contentType?: string } }) {
        const buf = data instanceof Uint8Array ? data.slice().buffer : data;
        store.set(key, { data: buf, httpMetadata: opts?.httpMetadata });
      },
      async get(key: string) {
        const entry = store.get(key);
        if (!entry) return null;
        return { arrayBuffer: async () => entry.data, httpMetadata: entry.httpMetadata };
      },
    } as any,
    store,
  };
}

function makeMockDb() {
  const rows = new Map<string, { wrapped_dek: string; dek_iv: string; file_iv: string }>();
  return {
    db: {
      prepare(sql: string) {
        return {
          async run() {
            return { success: true };
          },
          bind(...args: unknown[]) {
            return {
              async run() {
                if (sql.includes('INSERT INTO file_encryption_keys')) {
                  const [r2_key, wrapped_dek, dek_iv, file_iv] = args as string[];
                  rows.set(r2_key, { wrapped_dek, dek_iv, file_iv });
                } else if (sql.includes('UPDATE file_encryption_keys')) {
                  const [wrapped_dek, dek_iv, r2_key] = args as string[];
                  const existing = rows.get(r2_key);
                  if (existing) rows.set(r2_key, { ...existing, wrapped_dek, dek_iv });
                } else if (sql.includes('DELETE FROM file_encryption_keys')) {
                  rows.delete(args[0] as string);
                }
                return { success: true };
              },
              async first() {
                return rows.get(args[0] as string) ?? null;
              },
            };
          },
        };
      },
    } as any,
    rows,
  };
}

describe('encryptedR2', () => {
  it('round-trips: putEncrypted then getDecrypted returns the original bytes', async () => {
    const { bucket } = makeMockBucket();
    const { db } = makeMockDb();
    const original = new TextEncoder().encode('hello evidence photo bytes');
    await putEncrypted(bucket, db, KEK, 'field-photos/a.jpg', original, { httpMetadata: { contentType: 'image/jpeg' } });
    const result = await getDecrypted(bucket, db, KEK, 'field-photos/a.jpg');
    expect(result).not.toBeNull();
    expect(new TextDecoder().decode(result!.bytes)).toBe('hello evidence photo bytes');
    expect(result!.httpMetadata?.contentType).toBe('image/jpeg');
  });

  it('stores ciphertext in R2, not plaintext', async () => {
    const { bucket, store } = makeMockBucket();
    const { db } = makeMockDb();
    const original = new TextEncoder().encode('sensitive content');
    await putEncrypted(bucket, db, KEK, 'field-photos/b.jpg', original);
    const stored = new Uint8Array(store.get('field-photos/b.jpg')!.data);
    expect(new TextDecoder().decode(stored)).not.toContain('sensitive content');
  });

  it('two files with identical plaintext produce different ciphertext (fresh DEK per file)', async () => {
    const { bucket, store } = makeMockBucket();
    const { db } = makeMockDb();
    const original = new TextEncoder().encode('same content both times');
    await putEncrypted(bucket, db, KEK, 'field-photos/c1.jpg', original);
    await putEncrypted(bucket, db, KEK, 'field-photos/c2.jpg', original);
    const c1 = new Uint8Array(store.get('field-photos/c1.jpg')!.data);
    const c2 = new Uint8Array(store.get('field-photos/c2.jpg')!.data);
    expect(Array.from(c1)).not.toEqual(Array.from(c2));
  });

  it('crypto-shredding: deleting the D1 row makes the file permanently undecryptable even though the R2 object still exists', async () => {
    const { bucket, store } = makeMockBucket();
    const { db } = makeMockDb();
    await putEncrypted(bucket, db, KEK, 'field-photos/d.jpg', new TextEncoder().encode('shred me'));
    await deleteEncryptionKey(db, 'field-photos/d.jpg');
    expect(store.has('field-photos/d.jpg')).toBe(true); // R2 object untouched
    const result = await getDecrypted(bucket, db, KEK, 'field-photos/d.jpg');
    expect(result).toBeNull(); // but undecryptable
  });

  it('getDecrypted returns null for a key that was never stored', async () => {
    const { bucket } = makeMockBucket();
    const { db } = makeMockDb();
    expect(await getDecrypted(bucket, db, KEK, 'field-photos/never-existed.jpg')).toBeNull();
  });

  it('throws FileEncryptionError when the KEK is missing', async () => {
    const { bucket } = makeMockBucket();
    const { db } = makeMockDb();
    await expect(putEncrypted(bucket, db, undefined, 'field-photos/e.jpg', new Uint8Array([1, 2, 3])))
      .rejects.toBeInstanceOf(FileEncryptionError);
    await expect(putEncrypted(bucket, db, {}, 'field-photos/e2.jpg', new Uint8Array([1, 2, 3])))
      .rejects.toBeInstanceOf(FileEncryptionError);
  });

  it('decrypts JWT-wrapped files after a dedicated FILE_ENCRYPTION_KEK is added, without rewriting R2', async () => {
    const { bucket, store } = makeMockBucket();
    const { db, rows } = makeMockDb();
    const jwtEnv = { JWT_SECRET: 'test-jwt-secret-do-not-use-in-prod' };
    const original = new TextEncoder().encode('jwt then dedicated kek');
    await putEncrypted(bucket, db, jwtEnv, 'field-photos/migrate.jpg', original);
    const ciphertextBefore = new Uint8Array(store.get('field-photos/migrate.jpg')!.data);
    const wrapBefore = rows.get('field-photos/migrate.jpg')!.wrapped_dek;

    const mixed = { FILE_ENCRYPTION_KEK: KEK, JWT_SECRET: jwtEnv.JWT_SECRET };
    const result = await getDecrypted(bucket, db, mixed, 'field-photos/migrate.jpg');
    expect(new TextDecoder().decode(result!.bytes)).toBe('jwt then dedicated kek');
    expect(Array.from(new Uint8Array(store.get('field-photos/migrate.jpg')!.data))).toEqual(Array.from(ciphertextBefore));
    expect(rows.get('field-photos/migrate.jpg')!.wrapped_dek).not.toBe(wrapBefore);

    const dedicatedOnly = { FILE_ENCRYPTION_KEK: KEK };
    const afterRewrap = await getDecrypted(bucket, db, dedicatedOnly, 'field-photos/migrate.jpg');
    expect(new TextDecoder().decode(afterRewrap!.bytes)).toBe('jwt then dedicated kek');
  });

  it('unwraps with FILE_ENCRYPTION_KEK_PREVIOUS without changing R2 bytes', async () => {
    const { bucket, store } = makeMockBucket();
    const { db } = makeMockDb();
    const oldKek = KEK;
    const newKek = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => 255 - i)));
    const original = new TextEncoder().encode('previous dedicated kek');
    await putEncrypted(bucket, db, oldKek, 'field-photos/prev.jpg', original);
    const ciphertextBefore = new Uint8Array(store.get('field-photos/prev.jpg')!.data);
    const result = await getDecrypted(
      bucket, db,
      { FILE_ENCRYPTION_KEK: newKek, FILE_ENCRYPTION_KEK_PREVIOUS: oldKek },
      'field-photos/prev.jpg',
    );
    expect(new TextDecoder().decode(result!.bytes)).toBe('previous dedicated kek');
    expect(Array.from(new Uint8Array(store.get('field-photos/prev.jpg')!.data))).toEqual(Array.from(ciphertextBefore));
  });

  it('throws FileEncryptionError when no candidate KEK unwraps the DEK', async () => {
    const { bucket } = makeMockBucket();
    const { db } = makeMockDb();
    await putEncrypted(bucket, db, KEK, 'field-photos/wrong.jpg', new TextEncoder().encode('x'));
    const other = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => i + 1)));
    await expect(getDecrypted(bucket, db, other, 'field-photos/wrong.jpg'))
      .rejects.toMatchObject({ name: 'FileEncryptionError', message: 'Decryption failed — key may have changed' });
  });

  it('round-trips using a JWT_SECRET-derived KEK when FILE_ENCRYPTION_KEK is unset', async () => {
    const { bucket } = makeMockBucket();
    const { db } = makeMockDb();
    const env = { JWT_SECRET: 'test-jwt-secret-do-not-use-in-prod' };
    const original = new TextEncoder().encode('jwt-fallback ciphertext');
    await putEncrypted(bucket, db, env, 'field-photos/jwt.jpg', original);
    const result = await getDecrypted(bucket, db, env, 'field-photos/jwt.jpg');
    expect(new TextDecoder().decode(result!.bytes)).toBe('jwt-fallback ciphertext');
  });

  it('does not fall back to JWT_SECRET when FILE_ENCRYPTION_KEK is present but malformed', async () => {
    const { bucket } = makeMockBucket();
    const { db } = makeMockDb();
    await expect(putEncrypted(
      bucket, db,
      { FILE_ENCRYPTION_KEK: btoa('too-short'), JWT_SECRET: 'would-work-alone' },
      'field-photos/no-fallback.jpg',
      new Uint8Array([1, 2, 3]),
    )).rejects.toBeInstanceOf(FileEncryptionError);
  });

  it('throws FileEncryptionError when the KEK is the wrong length', async () => {
    const { bucket } = makeMockBucket();
    const { db } = makeMockDb();
    await expect(putEncrypted(bucket, db, btoa('too-short'), 'field-photos/f.jpg', new Uint8Array([1, 2, 3])))
      .rejects.toBeInstanceOf(FileEncryptionError);
  });

  it('rejects a tampered R2 ciphertext (AES-GCM auth tag catches it) rather than returning garbage', async () => {
    const { bucket, store } = makeMockBucket();
    const { db } = makeMockDb();
    await putEncrypted(bucket, db, KEK, 'field-photos/tamper.jpg', new TextEncoder().encode('original evidence content'));
    // Flip a byte in the middle of the stored ciphertext.
    const entry = store.get('field-photos/tamper.jpg')!;
    const tampered = new Uint8Array(entry.data);
    const mid = Math.floor(tampered.length / 2);
    tampered[mid] = tampered[mid] ^ 0xff;
    store.set('field-photos/tamper.jpg', { ...entry, data: tampered.buffer });
    await expect(getDecrypted(bucket, db, KEK, 'field-photos/tamper.jpg')).rejects.toThrow();
  });

  it('rejects a tampered wrapped DEK rather than unwrapping to garbage key material', async () => {
    const { bucket } = makeMockBucket();
    const { db, rows } = makeMockDb();
    await putEncrypted(bucket, db, KEK, 'field-photos/tamper2.jpg', new TextEncoder().encode('original evidence content'));
    const row = rows.get('field-photos/tamper2.jpg')!;
    // Corrupt the wrapped_dek's base64 payload (flip the first character, staying valid base64).
    const corrupted = (row.wrapped_dek[0] === 'A' ? 'B' : 'A') + row.wrapped_dek.slice(1);
    rows.set('field-photos/tamper2.jpg', { ...row, wrapped_dek: corrupted });
    await expect(getDecrypted(bucket, db, KEK, 'field-photos/tamper2.jpg')).rejects.toThrow();
  });

  it('creates file_encryption_keys if the live D1 table is missing', async () => {
    _resetKeysTableEnsuredForTest();
    const { bucket } = makeMockBucket();
    const sql: string[] = [];
    const db = {
      prepare(query: string) {
        sql.push(query);
        return {
          async run() { return { success: true }; },
          bind() {
            return {
              async run() { return { success: true }; },
              async first() { return null; },
            };
          },
        };
      },
    } as any;
    await putEncrypted(bucket, db, KEK, 'field-photos/heal.jpg', new TextEncoder().encode('x'));
    expect(sql.some((s) => /CREATE TABLE IF NOT EXISTS file_encryption_keys/i.test(s))).toBe(true);
  });
});
