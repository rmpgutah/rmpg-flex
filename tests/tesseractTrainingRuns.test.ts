// tests/tesseractTrainingRuns.test.ts
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import tesseractTrainingRouter from '../src/routes/tesseractTraining';
import { unzipSync, strFromU8 } from 'fflate';

function makeDb(opts: {
  approvedDocIds?: number[];
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
        return { results: [] };
      },
      first: async () => null,
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

function makeR2(objectsByDoc: Record<number, { imageBytes: Uint8Array; groundTruth: string }>) {
  const puts: Array<{ key: string; bytes: Uint8Array }> = [];
  return {
    list: async ({ prefix }: { prefix: string }) => {
      const m = prefix.match(/^training-corpus\/(\d+)\//);
      const docId = m ? Number(m[1]) : -1;
      if (!(docId in objectsByDoc)) return { objects: [] };
      return {
        objects: [
          { key: `training-corpus/${docId}/image.png` },
          { key: `training-corpus/${docId}/ground-truth.txt` },
        ],
      };
    },
    get: async (key: string) => {
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
      12: { imageBytes: new Uint8Array([1, 2, 3]), groundTruth: 'Recipient: Jane Doe' },
      34: { imageBytes: new Uint8Array([4, 5, 6]), groundTruth: 'Recipient: John Roe' },
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
});
