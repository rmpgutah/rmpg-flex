import { describe, test, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import tesseractTrainingRouter from '../src/routes/tesseractTraining';

function makeLegacyR2Object() {
  return { body: 'legacy-body', httpMetadata: {}, arrayBuffer: async () => new ArrayBuffer(8) };
}

function makeDb(opts: {
  docs?: Record<number, { r2_key: string; file_type: string; raw_text?: string | null }>;
  corpusIds?: Set<number>;
} = {}) {
  const docs = opts.docs ?? {};
  const corpusIds = opts.corpusIds ?? new Set<number>();
  const inserts: number[] = [];

  const prepare = (sql: string) => {
    let boundArgs: any[] = [];
    const stmt: any = {
      bind: (...args: any[]) => { boundArgs = args; return stmt; },
      first: async () => {
        if (/FROM tesseract_training_corpus WHERE serve_intake_document_id/.test(sql)) {
          return corpusIds.has(boundArgs[0]) ? { id: 1 } : null;
        }
        if (/FROM serve_intake_documents WHERE id/.test(sql)) {
          return docs[boundArgs[0]] ?? null;
        }
        return null;
      },
      all: async () => ({ results: [] }),
      run: async () => {
        if (/INSERT INTO tesseract_training_corpus/.test(sql)) inserts.push(boundArgs[0]);
        return { meta: { changes: 1, last_row_id: 1 } };
      },
    };
    return stmt;
  };

  return { prepare, _inserts: inserts };
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

function makeEnv(db: ReturnType<typeof makeDb>) {
  return {
    DB: db,
    UPLOADS: { get: async () => makeLegacyR2Object() },
    TESSERACT_TRAINING: { put: async () => {} },
    JWT_SECRET: 'test-jwt-secret-for-file-kek-derivation',
  };
}

beforeEach(() => vi.clearAllMocks());

describe('tesseract training bulk submit', () => {
  test('POST /documents/bulk-submit returns 403 for a non-admin/manager role', async () => {
    const app = makeApp('officer');
    const res = await app.request('/documents/bulk-submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ document_ids: [1] }),
    }, makeEnv(makeDb()));
    expect(res.status).toBe(403);
  });

  test('POST /documents/bulk-submit rejects more than 100 ids', async () => {
    const app = makeApp('admin');
    const ids = Array.from({ length: 101 }, (_, i) => i + 1);
    const res = await app.request('/documents/bulk-submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ document_ids: ids }),
    }, makeEnv(makeDb()));
    expect(res.status).toBe(400);
  });

  test('POST /documents/bulk-submit reports per-id success and failure independently', async () => {
    const app = makeApp('manager');
    const db = makeDb({
      docs: {
        10: { r2_key: 'uploads/10', file_type: 'image/png', raw_text: 'Recipient: Jane Doe' },
        11: { r2_key: 'uploads/11', file_type: 'image/png', raw_text: 'Recipient: John Roe' },
      },
      corpusIds: new Set([11]), // 11 already submitted -> should fail
    });
    const res = await app.request('/documents/bulk-submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ document_ids: [10, 11, 999] }), // 999 doesn't exist -> should fail
    }, makeEnv(db));
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.results).toEqual([
      { id: 10, success: true },
      { id: 11, success: false, error: 'Document already in training corpus' },
      { id: 999, success: false, error: 'Not found' },
    ]);
    expect(db._inserts).toEqual([10]);
  });
});
