import { describe, it, expect, vi } from 'vitest';
import { putEncrypted, getDecrypted, deleteEncryptionKey, FileEncryptionError } from '../src/utils/encryptedR2';

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
          bind(...args: unknown[]) {
            return {
              async run() {
                if (sql.includes('INSERT INTO file_encryption_keys')) {
                  const [r2_key, wrapped_dek, dek_iv, file_iv] = args as string[];
                  rows.set(r2_key, { wrapped_dek, dek_iv, file_iv });
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
  });

  it('throws FileEncryptionError when the KEK is the wrong length', async () => {
    const { bucket } = makeMockBucket();
    const { db } = makeMockDb();
    await expect(putEncrypted(bucket, db, btoa('too-short'), 'field-photos/f.jpg', new Uint8Array([1, 2, 3])))
      .rejects.toBeInstanceOf(FileEncryptionError);
  });
});
