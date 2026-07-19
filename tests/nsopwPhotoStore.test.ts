// Photo storage unit tests — exercise the upstream-fetch contract,
// content-type validation, size ceiling, and staleness gate without
// touching real R2 or D1.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { downloadAndStorePhoto } from '../src/utils/nsopw/photoStore';

// A deterministic base64 32-byte KEK for tests — the write path now fails
// closed (see src/utils/encryptedR2.ts) without FILE_ENCRYPTION_KEK set.
const TEST_KEK = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => i)));

function makeMockDb(existingFetchedAt: string | null = null) {
  const updates: Array<{ sql: string; bindings: unknown[] }> = [];
  const prepared = vi.fn(() => ({
    bind: vi.fn(() => ({
      first: vi.fn().mockResolvedValue(
        existingFetchedAt
          ? { photo_fetched_at: existingFetchedAt }
          : { photo_fetched_at: null },
      ),
      run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
    })),
  }));
  // execute() in db.ts calls db.prepare(sql).bind(...).run() — match that
  // shape. We capture every prepared SQL string for assertions.
  const db = {
    prepare: vi.fn((sql: string) => {
      const stmt = {
        bind: vi.fn((...bindings: unknown[]) => {
          if (sql.startsWith('UPDATE')) updates.push({ sql, bindings });
          return {
            first: vi.fn().mockResolvedValue(
              existingFetchedAt ? { photo_fetched_at: existingFetchedAt } : { photo_fetched_at: null },
            ),
            run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
            all: vi.fn().mockResolvedValue({ results: [] }),
          };
        }),
        first: vi.fn().mockResolvedValue(
          existingFetchedAt ? { photo_fetched_at: existingFetchedAt } : { photo_fetched_at: null },
        ),
        run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
        all: vi.fn().mockResolvedValue({ results: [] }),
      };
      return stmt;
    }),
  };
  // Mark unused for caller checks.
  prepared.mockReturnThis();
  return { db: db as unknown as Parameters<typeof downloadAndStorePhoto>[1], updates };
}

function makeMockBucket() {
  const puts: Array<{ key: string; size: number; contentType?: string }> = [];
  const bucket = {
    put: vi.fn(async (key: string, bytes: ArrayBuffer, opts: { httpMetadata?: { contentType?: string } }) => {
      puts.push({ key, size: bytes.byteLength, contentType: opts?.httpMetadata?.contentType });
      return { uploaded: true };
    }),
  };
  return { bucket: bucket as unknown, puts };
}

describe('downloadAndStorePhoto', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('skips when UPLOADS binding is missing', async () => {
    const { db } = makeMockDb();
    const r = await downloadAndStorePhoto(
      { } as never, db, 7, 'UT', 'X1', 'https://x.example/p.jpg',
    );
    expect(r.stored).toBe(false);
    expect(r.reason).toContain('UPLOADS');
  });

  it('skips when photoUrl is empty', async () => {
    const { db } = makeMockDb();
    const { bucket } = makeMockBucket();
    const r = await downloadAndStorePhoto(
      { UPLOADS: bucket } as never, db, 7, 'UT', 'X1', null,
    );
    expect(r.stored).toBe(false);
    expect(r.reason).toBe('no photo url');
  });

  it('skips when fetched within last 7 days (staleness gate)', async () => {
    const recent = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
    const { db } = makeMockDb(recent);
    const { bucket } = makeMockBucket();
    const r = await downloadAndStorePhoto(
      { UPLOADS: bucket } as never, db, 7, 'UT', 'X1', 'https://x.example/p.jpg',
    );
    expect(r.stored).toBe(false);
    expect(r.reason).toBe('fresh in last 7d');
  });

  it('skips on upstream non-200', async () => {
    const { db } = makeMockDb();
    const { bucket } = makeMockBucket();
    global.fetch = vi.fn(async () => new Response('not found', { status: 404 })) as never;
    const r = await downloadAndStorePhoto(
      { UPLOADS: bucket } as never, db, 7, 'UT', 'X1', 'https://x.example/p.jpg',
    );
    expect(r.stored).toBe(false);
    expect(r.reason).toContain('HTTP 404');
  });

  it('skips on non-image content-type', async () => {
    const { db } = makeMockDb();
    const { bucket } = makeMockBucket();
    global.fetch = vi.fn(async () => new Response('<html/>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    })) as never;
    const r = await downloadAndStorePhoto(
      { UPLOADS: bucket } as never, db, 7, 'UT', 'X1', 'https://x.example/p.html',
    );
    expect(r.stored).toBe(false);
    expect(r.reason).toContain('non-image');
  });

  it('stores valid jpeg to R2 with sanitized key', async () => {
    const { db } = makeMockDb();
    const { bucket, puts } = makeMockBucket();
    const bytes = new Uint8Array(256).buffer;
    global.fetch = vi.fn(async () => new Response(bytes, {
      status: 200,
      headers: { 'content-type': 'image/jpeg' },
    })) as never;
    const r = await downloadAndStorePhoto(
      { UPLOADS: bucket, FILE_ENCRYPTION_KEK: TEST_KEK } as never, db, 42, 'ut', 'icrimewatch.net:735527',
      'https://wsdocs.example/photo.jpg',
    );
    expect(r.stored).toBe(true);
    expect(r.bytes).toBe(256);
    expect(r.contentType).toBe('image/jpeg');
    expect(puts).toHaveLength(1);
    // Key shape: nsopw-photos/{JURISDICTION}/{slug}.{ext}; colons sanitized.
    expect(puts[0].key).toBe('nsopw-photos/UT/icrimewatch.net_735527.jpg');
  });

  it('refuses uploads over the size cap', async () => {
    const { db } = makeMockDb();
    const { bucket } = makeMockBucket();
    const big = new Uint8Array(9 * 1024 * 1024).buffer;
    global.fetch = vi.fn(async () => new Response(big, {
      status: 200,
      headers: { 'content-type': 'image/jpeg' },
    })) as never;
    const r = await downloadAndStorePhoto(
      { UPLOADS: bucket } as never, db, 7, 'UT', 'X1', 'https://x.example/p.jpg',
    );
    expect(r.stored).toBe(false);
    expect(r.reason).toContain('too large');
  });
});

// ── Envelope encryption (file-encryption-at-rest Phase 2, Task 4) ──
// Mocked R2/D1 pattern matching tests/encryptedR2.test.ts — photoStore.ts is
// a plain exported function, not a Hono route, so no Miniflare needed here.
// (Reuses the module-level TEST_KEK declared above.)

function mockR2() {
  const store = new Map<string, { body: Uint8Array; httpMetadata?: any }>();
  return {
    store,
    put: vi.fn(async (key: string, bytes: any, opts?: any) => {
      store.set(key, { body: bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), httpMetadata: opts?.httpMetadata });
    }),
  };
}

function mockD1() {
  const rows = new Map<string, any>();
  return {
    rows,
    prepare: (sql: string) => ({
      bind: (...args: any[]) => ({
        first: async () => {
          if (sql.includes('SELECT photo_fetched_at')) return null; // not stale-gated in this test
          if (sql.includes('SELECT wrapped_dek')) return rows.get(args[0]) ?? null;
          return null;
        },
        run: async () => {
          if (sql.includes('INSERT INTO file_encryption_keys')) {
            rows.set(args[0], { wrapped_dek: args[1], dek_iv: args[2], file_iv: args[3] });
          }
        },
      }),
    }),
  };
}

describe('downloadAndStorePhoto — encrypts nsopw-photos/ at rest', () => {
  const originalFetch = global.fetch;
  beforeEach(() => { global.fetch = originalFetch; });

  it('stores ciphertext in R2, not the original photo bytes', async () => {
    const photoBytes = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3, 4, 5]);
    global.fetch = vi.fn(async () => new Response(photoBytes, { headers: { 'content-type': 'image/jpeg' } })) as any;

    const uploads = mockR2();
    const db = mockD1();
    const env = { UPLOADS: uploads, FILE_ENCRYPTION_KEK: TEST_KEK } as any;

    const result = await downloadAndStorePhoto(env, db as any, 42, 'FL', 'ext-1', 'https://example.test/photo.jpg');

    expect(result.stored).toBe(true);
    expect(result.key).toMatch(/^nsopw-photos\/FL\//);
    const stored = uploads.store.get(result.key!);
    expect(stored).toBeDefined();
    expect(Array.from(stored!.body)).not.toEqual(Array.from(photoBytes));
  });
});
