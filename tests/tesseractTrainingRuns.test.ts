// tests/tesseractTrainingRuns.test.ts
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import tesseractTrainingRouter from '../src/routes/tesseractTraining';
import { unzipSync, strFromU8 } from 'fflate';

function makeDb(opts: {
  approvedDocIds?: number[];
  runs?: Array<{ id: number; generated_at: string; generated_by: number; document_count: number; r2_key: string }>;
} = {}) {
  const approvedDocIds = opts.approvedDocIds ?? [];
  const inserts: Array<{ count: number; ids: number[]; r2Key: string; by: number }> = [];

  const prepare = (sql: string) => {
    let boundArgs: any[] = [];
    const stmt: any = {
      bind: (...args: any[]) => { boundArgs = args; return stmt; },
      all: async () => {
        if (/FROM tesseract_training_corpus WHERE approval_status/.test(sql)) {
          return { results: approvedDocIds.map((id) => ({ serve_intake_document_id: id })) };
        }
        if (/FROM tesseract_training_runs/.test(sql) && /ORDER BY/.test(sql)) {
          return { results: (opts.runs ?? []).slice().sort((a, b) => b.id - a.id) };
        }
        return { results: [] };
      },
      first: async () => {
        if (/FROM tesseract_training_runs WHERE id/.test(sql)) {
          return (opts.runs ?? []).find((r) => r.id === boundArgs[0]) ?? null;
        }
        return null;
      },
      run: async () => {
        if (/INSERT INTO tesseract_training_runs/.test(sql)) {
          const [by, count, idsJson, r2Key] = boundArgs;
          inserts.push({ by, count, ids: JSON.parse(idsJson), r2Key });
          return { meta: { changes: 1, last_row_id: inserts.length } };
        }
        return { meta: { changes: 0 } };
      },
    };
    return stmt;
  };

  return { prepare, _inserts: inserts };
}

function makeR2(opts: {
  objectsByDoc?: Record<number, {
    imageBytes: Uint8Array;
    groundTruth: string;
    pages?: Array<{ n: number; bytes: Uint8Array }>;
  }>;
  savedZip?: { key: string; bytes: Uint8Array };
} = {}) {
  const objectsByDoc = opts.objectsByDoc ?? {};
  const savedZip = opts.savedZip;
  const puts: Array<{ key: string; bytes: Uint8Array }> = [];
  return {
    list: async ({ prefix }: { prefix: string }) => {
      const m = prefix.match(/^training-corpus\/(\d+)\//);
      const docId = m ? Number(m[1]) : -1;
      const entry = objectsByDoc[docId];
      if (!entry) return { objects: [] };
      const objects: Array<{ key: string }> = [{ key: `training-corpus/${docId}/ground-truth.txt` }];
      if (entry.pages?.length) {
        for (const p of entry.pages) {
          objects.push({ key: `training-corpus/${docId}/page-${String(p.n).padStart(3, '0')}.jpg` });
        }
      } else {
        objects.push({ key: `training-corpus/${docId}/image.png` });
      }
      return { objects };
    },
    get: async (key: string) => {
      if (savedZip && key === savedZip.key) {
        const bytes = savedZip.bytes;
        return { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
      }
      const pageM = key.match(/^training-corpus\/(\d+)\/page-(\d+)\.jpg$/);
      if (pageM) {
        const entry = objectsByDoc[Number(pageM[1])];
        const page = entry?.pages?.find((p) => p.n === Number(pageM[2]));
        if (!page) return null;
        const bytes = page.bytes;
        return { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
      }
      const m = key.match(/^training-corpus\/(\d+)\/(image\.png|ground-truth\.txt)$/);
      if (!m) return null;
      const docId = Number(m[1]);
      const entry = objectsByDoc[docId];
      if (!entry) return null;
      const bytes = m[2] === 'image.png' ? entry.imageBytes : new TextEncoder().encode(entry.groundTruth);
      return { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
    },
    put: async (key: string, bytes: Uint8Array) => { puts.push({ key, bytes }); },
    _puts: puts,
  };
}

function makeApp(role: string) {
  const app = new Hono<{ Bindings: any; Variables: any }>();
  app.use('*', async (c, next) => {
    c.set('user', { id: 42, username: 'tester', role, full_name: 'Test User' });
    await next();
  });
  app.route('/', tesseractTrainingRouter);
  return app;
}

beforeEach(() => vi.clearAllMocks());

describe('tesseract training runs — POST /runs', () => {
  test('returns 403 for a non-admin/manager role', async () => {
    const app = makeApp('officer');
    const res = await app.request('/documents/runs', { method: 'POST' }, {
      DB: makeDb(), TESSERACT_TRAINING: makeR2({}),
    });
    expect(res.status).toBe(403);
  });

  test('returns 400 when no documents are approved', async () => {
    const app = makeApp('admin');
    const res = await app.request('/documents/runs', { method: 'POST' }, {
      DB: makeDb({ approvedDocIds: [] }), TESSERACT_TRAINING: makeR2({}),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.code).toBe('NOTHING_TO_TRAIN');
  });

  test('bundles approved documents into a zip with the expected layout and saves it to R2', async () => {
    const app = makeApp('manager');
    const db = makeDb({ approvedDocIds: [12, 34] });
    const r2 = makeR2({
      objectsByDoc: {
        12: { imageBytes: new Uint8Array([1, 2, 3]), groundTruth: 'Recipient: Jane Doe' },
        34: { imageBytes: new Uint8Array([4, 5, 6]), groundTruth: 'Recipient: John Roe' },
      },
    });
    const res = await app.request('/documents/runs', { method: 'POST' }, { DB: db, TESSERACT_TRAINING: r2 });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.document_count).toBe(2);
    expect(typeof body.id).toBe('number');

    expect(r2._puts).toHaveLength(1);
    const zipBytes = r2._puts[0].bytes;
    const unzipped = unzipSync(zipBytes);
    expect(Object.keys(unzipped).sort()).toEqual([
      'README.md',
      'rmpg-ground-truth/12.gt.txt',
      'rmpg-ground-truth/12.png',
      'rmpg-ground-truth/34.gt.txt',
      'rmpg-ground-truth/34.png',
    ]);
    expect(strFromU8(unzipped['rmpg-ground-truth/12.gt.txt'])).toBe('Recipient: Jane Doe');
    expect(strFromU8(unzipped['README.md'])).toContain('MODEL_NAME=rmpg');

    expect(db._inserts).toHaveLength(1);
    expect(db._inserts[0].count).toBe(2);
    expect(db._inserts[0].ids.sort()).toEqual([12, 34]);
    expect(db._inserts[0].r2Key).toBe(r2._puts[0].key);
  });

  test('packages rasterized PDF pages as per-page tesstrain pairs', async () => {
    const app = makeApp('admin');
    const db = makeDb({ approvedDocIds: [12] });
    const r2 = makeR2({
      objectsByDoc: {
        12: {
          imageBytes: new Uint8Array([9]),
          groundTruth: 'Complaint caption',
          pages: [
            { n: 1, bytes: new Uint8Array([1]) },
            { n: 2, bytes: new Uint8Array([2]) },
          ],
        },
      },
    });
    const res = await app.request('/documents/runs', { method: 'POST' }, { DB: db, TESSERACT_TRAINING: r2 });
    expect(res.status).toBe(200);
    const unzipped = unzipSync(r2._puts[0].bytes);
    expect(Object.keys(unzipped).sort()).toEqual([
      'README.md',
      'rmpg-ground-truth/12_p1.gt.txt',
      'rmpg-ground-truth/12_p1.jpg',
      'rmpg-ground-truth/12_p2.gt.txt',
      'rmpg-ground-truth/12_p2.jpg',
    ]);
  });
});

describe('tesseract training runs — GET /runs and download', () => {
  test('GET /documents/runs returns 403 for a non-admin/manager role', async () => {
    const app = makeApp('officer');
    const res = await app.request('/documents/runs', {}, { DB: makeDb(), TESSERACT_TRAINING: makeR2({}) });
    expect(res.status).toBe(403);
  });

  test('GET /documents/runs lists runs newest first', async () => {
    const app = makeApp('admin');
    const db = makeDb({
      runs: [
        { id: 1, generated_at: '2026-08-01T00:00:00Z', generated_by: 42, document_count: 3, r2_key: 'training-runs/1/package.zip' },
        { id: 2, generated_at: '2026-08-05T00:00:00Z', generated_by: 42, document_count: 7, r2_key: 'training-runs/2/package.zip' },
      ],
    });
    const res = await app.request('/documents/runs', {}, { DB: db, TESSERACT_TRAINING: makeR2({}) });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.rows.map((r: any) => r.id)).toEqual([2, 1]);
  });

  test('GET /documents/runs/:id/download streams the saved zip with the right headers', async () => {
    const app = makeApp('manager');
    const zipBytes = new Uint8Array([80, 75, 3, 4]); // PK.. zip magic bytes, doesn't need to be a real zip for this test
    const db = makeDb({
      runs: [{ id: 5, generated_at: '2026-08-05T00:00:00Z', generated_by: 42, document_count: 2, r2_key: 'training-runs/5/package.zip' }],
    });
    const r2 = makeR2({ savedZip: { key: 'training-runs/5/package.zip', bytes: zipBytes } });
    const res = await app.request('/documents/runs/5/download', {}, { DB: db, TESSERACT_TRAINING: r2 });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toContain('rmpg-training-5.zip');
    const buf = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(buf)).toEqual(Array.from(zipBytes));
  });

  test('GET /documents/runs/:id/download returns 404 for an unknown id', async () => {
    const app = makeApp('admin');
    const res = await app.request('/documents/runs/999/download', {}, { DB: makeDb({ runs: [] }), TESSERACT_TRAINING: makeR2({}) });
    expect(res.status).toBe(404);
  });
});
