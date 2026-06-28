// Photo storage unit tests — exercise the upstream-fetch contract,
// content-type validation, size ceiling, and staleness gate without
// touching real R2 or D1.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { downloadAndStorePhoto } from '../src/utils/nsopw/photoStore';

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
      { UPLOADS: bucket } as never, db, 42, 'ut', 'icrimewatch.net:735527',
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
