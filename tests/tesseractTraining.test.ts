import { describe, test, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import tesseractTrainingRouter from '../src/routes/tesseractTraining';

// A legacy (unencrypted) R2 object — used so getDecrypted() falls through to
// the plain UPLOADS.get() fallback path without needing real crypto fixtures.
function makeLegacyR2Object() {
  return {
    body: 'legacy-body',
    httpMetadata: {},
    arrayBuffer: async () => new ArrayBuffer(8),
  };
}

function makeDb(opts: {
  docs?: Record<number, { r2_key: string; file_type: string; file_name?: string; raw_text?: string | null; doc_type?: string | null; created_at?: string }>;
  corpusIds?: Set<number>;
} = {}) {
  const docs = opts.docs ?? {};
  const corpusIds = opts.corpusIds ?? new Set<number>();
  const inserts: Array<{ documentId: number; addedBy: number }> = [];

  const prepare = (sql: string) => {
    let boundArgs: any[] = [];
    const stmt: any = {
      bind: (...args: any[]) => { boundArgs = args; return stmt; },
      first: async () => {
        if (/FROM tesseract_training_corpus WHERE serve_intake_document_id/.test(sql)) {
          const id = boundArgs[0];
          return corpusIds.has(id) ? { id: 1, approval_status: 'pending' } : null;
        }
        if (/FROM serve_intake_documents WHERE id/.test(sql)) {
          const id = boundArgs[0];
          return docs[id] ?? null;
        }
        // e.g. file_encryption_keys lookup inside getDecrypted() — no row,
        // so getDecrypted() falls back to the legacy UPLOADS.get() path.
        return null;
      },
      all: async () => ({ results: [] }),
      run: async () => {
        if (/INSERT INTO tesseract_training_corpus/.test(sql)) {
          inserts.push({ documentId: boundArgs[0], addedBy: boundArgs[1] });
        }
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

beforeEach(() => vi.clearAllMocks());

describe('tesseractTraining route — permissions', () => {
  const nonPrivilegedRoles = ['officer', 'dispatcher', 'client_viewer'];

  for (const role of nonPrivilegedRoles) {
    test(`GET /documents returns 403 for role=${role}`, async () => {
      const app = makeApp(role);
      const db = makeDb();
      const res = await app.request('/documents', {}, { DB: db });
      expect(res.status).toBe(403);
      expect((await res.json() as any).code).toBe('FORBIDDEN');
    });
  }

  test('GET /documents/:id returns 403 for a non-admin/manager role', async () => {
    const app = makeApp('officer');
    const db = makeDb();
    const res = await app.request('/documents/1', {}, { DB: db });
    expect(res.status).toBe(403);
    expect((await res.json() as any).code).toBe('FORBIDDEN');
  });

  test('GET /documents/:id/image returns 403 for a non-admin/manager role', async () => {
    const app = makeApp('dispatcher');
    const db = makeDb();
    const res = await app.request('/documents/1/image', {}, { DB: db, UPLOADS: {} });
    expect(res.status).toBe(403);
    expect((await res.json() as any).code).toBe('FORBIDDEN');
  });

  test('POST /documents/:id/submit returns 403 for a non-admin/manager role', async () => {
    const app = makeApp('client_viewer');
    const db = makeDb();
    const res = await app.request('/documents/1/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ground_truth_text: 'hello world' }),
    }, { DB: db });
    expect(res.status).toBe(403);
    expect((await res.json() as any).code).toBe('FORBIDDEN');
  });
});

describe('tesseractTraining route — /documents filtering', () => {
  test('GET /documents filters by doc_type, labeled, and date range', async () => {
    const app = makeApp('admin');
    const db = makeDb();
    // Override .all() to assert the SQL carries the expected WHERE clauses and
    // bound values, since this mock DB doesn't do real filtering.
    let capturedSql = '';
    let capturedArgs: any[] = [];
    const originalPrepare = db.prepare.bind(db);
    (db as any).prepare = (sql: string) => {
      const stmt = originalPrepare(sql);
      const originalBind = stmt.bind.bind(stmt);
      stmt.bind = (...args: any[]) => { capturedSql = sql; capturedArgs = args; return originalBind(...args); };
      return stmt;
    };
    await app.request(
      '/documents?doc_type=summons&labeled=false&from=2026-01-01&to=2026-12-31',
      {}, { DB: db },
    );
    expect(capturedSql).toMatch(/d\.doc_type = \?/);
    expect(capturedSql).toMatch(/t\.id IS NULL/);
    expect(capturedSql).toMatch(/d\.created_at >= \?/);
    expect(capturedSql).toMatch(/d\.created_at <= \?/);
    expect(capturedArgs).toContain('summons');
    expect(capturedArgs).toContain('2026-01-01');
    expect(capturedArgs).toContain('2026-12-31');
  });

  test('GET /documents treats doc_type=null as an explicit IS NULL filter', async () => {
    const app = makeApp('admin');
    const db = makeDb();
    let capturedSql = '';
    const originalPrepare = db.prepare.bind(db);
    (db as any).prepare = (sql: string) => {
      const stmt = originalPrepare(sql);
      if (/FROM serve_intake_documents/.test(sql)) capturedSql = sql;
      return stmt;
    };
    await app.request('/documents?doc_type=null', {}, { DB: db });
    expect(capturedSql).toMatch(/d\.doc_type IS NULL/);
  });
});

describe('tesseractTraining route — 404 for missing document', () => {
  test('GET /documents/:id returns 404 when the document does not exist', async () => {
    const app = makeApp('admin');
    const db = makeDb({ docs: {} });
    const res = await app.request('/documents/999', {}, { DB: db });
    expect(res.status).toBe(404);
  });

  test('GET /documents/:id/image returns 404 when the document does not exist', async () => {
    const app = makeApp('manager');
    const db = makeDb({ docs: {} });
    const res = await app.request('/documents/999/image', {}, { DB: db, UPLOADS: {} });
    expect(res.status).toBe(404);
  });

  test('POST /documents/:id/submit returns 404 when the document does not exist', async () => {
    const app = makeApp('admin');
    const db = makeDb({ docs: {} });
    const res = await app.request('/documents/999/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ground_truth_text: 'hello world' }),
    }, { DB: db, UPLOADS: {}, TESSERACT_TRAINING: {} });
    expect(res.status).toBe(404);
  });
});

describe('tesseractTraining route — duplicate submission', () => {
  test('POST /documents/:id/submit returns 409 when the document is already in the training corpus', async () => {
    const app = makeApp('admin');
    const db = makeDb({
      docs: { 5: { r2_key: 'uploads/5.png', file_type: 'image/png' } },
      corpusIds: new Set([5]),
    });
    const put = vi.fn();
    const res = await app.request('/documents/5/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ground_truth_text: 'already submitted text' }),
    }, { DB: db, UPLOADS: { get: vi.fn() }, TESSERACT_TRAINING: { put } });

    expect(res.status).toBe(409);
    expect((await res.json() as any).code).toBe('ALREADY_SUBMITTED');
    // The duplicate check happens before any R2 write is attempted.
    expect(put).not.toHaveBeenCalled();
    expect(db._inserts).toHaveLength(0);
  });

  test('POST /documents/:id/submit returns 409 (not 400) when already submitted even with missing ground_truth_text', async () => {
    const app = makeApp('admin');
    const db = makeDb({
      docs: { 6: { r2_key: 'uploads/6.png', file_type: 'image/png' } },
      corpusIds: new Set([6]),
    });
    const put = vi.fn();
    const res = await app.request('/documents/6/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ground_truth_text: '' }),
    }, { DB: db, UPLOADS: { get: vi.fn() }, TESSERACT_TRAINING: { put } });

    // The already-submitted check must run BEFORE the missing-text check —
    // this restores the original single-submit route's behavior.
    expect(res.status).toBe(409);
    expect((await res.json() as any).code).toBe('ALREADY_SUBMITTED');
    expect(put).not.toHaveBeenCalled();
    expect(db._inserts).toHaveLength(0);
  });
});

describe('tesseractTraining route — R2-then-D1 write ordering', () => {
  test('a forced R2 write failure prevents any tesseract_training_corpus row from being inserted', async () => {
    const app = makeApp('admin');
    const db = makeDb({
      docs: { 8: { r2_key: 'uploads/8.png', file_type: 'image/png' } },
    });
    const legacyObj = makeLegacyR2Object();
    const uploads = { get: vi.fn().mockResolvedValue(legacyObj) };
    // Simulate the image PUT succeeding but the ground-truth-text PUT failing —
    // the route must not insert the tracking row unless BOTH puts succeed.
    const put = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('R2 bucket unavailable'));
    const tesseractTraining = { put };

    const res = await app.request('/documents/8/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ground_truth_text: 'the verified ground truth' }),
    }, { DB: db, UPLOADS: uploads, TESSERACT_TRAINING: tesseractTraining });

    expect(res.status).toBe(500);
    const body = await res.json() as any;
    expect(body.code).toBe('R2_WRITE_FAILED');

    expect(put).toHaveBeenCalledTimes(2);
    // No D1 row inserted after the R2 failure — write ordering guarantee.
    expect(db._inserts).toHaveLength(0);
  });

  test('when both R2 writes succeed, the D1 row is inserted exactly once, after the writes', async () => {
    const app = makeApp('manager');
    const db = makeDb({
      docs: { 9: { r2_key: 'uploads/9.png', file_type: 'image/png' } },
    });
    const legacyObj = makeLegacyR2Object();
    const uploads = { get: vi.fn().mockResolvedValue(legacyObj) };

    const callOrder: string[] = [];
    const put = vi.fn().mockImplementation(async (key: string) => {
      callOrder.push(`put:${key}`);
    });
    const tesseractTraining = { put };

    const res = await app.request('/documents/9/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ground_truth_text: 'the verified ground truth' }),
    }, { DB: db, UPLOADS: uploads, TESSERACT_TRAINING: tesseractTraining });

    expect(res.status).toBe(200);
    expect(put).toHaveBeenCalledTimes(2);
    expect(db._inserts).toEqual([{ documentId: 9, addedBy: 42 }]);
    // Both R2 writes are recorded before the (untracked-by-callOrder) D1 insert
    // runs — asserting call count/args here covers the ordering contract
    // exercised directly by the failure-path test above.
    expect(callOrder).toEqual([
      'put:training-corpus/9/image.png',
      'put:training-corpus/9/ground-truth.txt',
    ]);
  });

  test('a D1 insert failure AFTER both R2 writes succeed reports CORPUS_INSERT_FAILED, not a silent success', async () => {
    const app = makeApp('admin');
    const docs = { 10: { r2_key: 'uploads/10.png', file_type: 'image/png' } };
    const corpusIds = new Set<number>();
    const prepare = (sql: string) => {
      let boundArgs: any[] = [];
      const stmt: any = {
        bind: (...args: any[]) => { boundArgs = args; return stmt; },
        first: async () => {
          if (/FROM tesseract_training_corpus WHERE serve_intake_document_id/.test(sql)) {
            const id = boundArgs[0];
            return corpusIds.has(id) ? { id: 1, approval_status: 'pending' } : null;
          }
          if (/FROM serve_intake_documents WHERE id/.test(sql)) {
            return (docs as any)[boundArgs[0]] ?? null;
          }
          return null;
        },
        all: async () => ({ results: [] }),
        run: async () => {
          if (/INSERT INTO tesseract_training_corpus/.test(sql)) {
            throw new Error('D1 unavailable');
          }
          return { meta: { changes: 1, last_row_id: 1 } };
        },
      };
      return stmt;
    };
    const db = { prepare };
    const legacyObj = makeLegacyR2Object();
    const uploads = { get: vi.fn().mockResolvedValue(legacyObj) };
    const put = vi.fn().mockResolvedValue(undefined);
    const tesseractTraining = { put };

    const res = await app.request('/documents/10/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ground_truth_text: 'the verified ground truth' }),
    }, { DB: db, UPLOADS: uploads, TESSERACT_TRAINING: tesseractTraining });

    // Both R2 writes DID happen (the pair now exists in R2 with no corpus row
    // pointing at it — the orphan this error path exists to make visible).
    expect(put).toHaveBeenCalledTimes(2);
    expect(res.status).toBe(500);
    const body = await res.json() as any;
    expect(body.code).toBe('CORPUS_INSERT_FAILED');
  });
});
