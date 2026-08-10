import { describe, test, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import tesseractTrainingRouter from '../src/routes/tesseractTraining';

function makeDb(opts: {
  corpus?: Record<number, { id: number; approval_status: string }>;
} = {}) {
  const corpus = opts.corpus ?? {};
  const updates: Array<{ id: number; approvedBy: number }> = [];

  const prepare = (sql: string) => {
    let boundArgs: any[] = [];
    const stmt: any = {
      bind: (...args: any[]) => { boundArgs = args; return stmt; },
      first: async () => {
        if (/FROM tesseract_training_corpus WHERE serve_intake_document_id/.test(sql)) {
          const docId = boundArgs[0];
          return corpus[docId] ?? null;
        }
        return null;
      },
      all: async () => ({ results: [] }),
      run: async () => {
        if (/UPDATE tesseract_training_corpus SET approval_status/.test(sql)) {
          const [approvedBy, docId] = boundArgs;
          if (corpus[docId]) corpus[docId].approval_status = 'approved';
          updates.push({ id: docId, approvedBy });
          return { meta: { changes: corpus[docId] ? 1 : 0 } };
        }
        return { meta: { changes: 0 } };
      },
    };
    return stmt;
  };

  return { prepare, _updates: updates, _corpus: corpus };
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

describe('tesseract training approval', () => {
  test('POST /documents/:id/approve returns 403 for a non-admin/manager role', async () => {
    const app = makeApp('officer');
    const res = await app.request('/documents/5/approve', { method: 'POST' }, { DB: makeDb() });
    expect(res.status).toBe(403);
  });

  test('POST /documents/:id/approve returns 404 when the document is not in the corpus', async () => {
    const app = makeApp('admin');
    const res = await app.request('/documents/5/approve', { method: 'POST' }, { DB: makeDb() });
    expect(res.status).toBe(404);
  });

  test('POST /documents/:id/approve marks a pending submission approved', async () => {
    const app = makeApp('manager');
    const db = makeDb({ corpus: { 5: { id: 1, approval_status: 'pending' } } });
    const res = await app.request('/documents/5/approve', { method: 'POST' }, { DB: db });
    expect(res.status).toBe(200);
    expect(db._corpus[5].approval_status).toBe('approved');
  });

  test('POST /documents/:id/approve is idempotent on an already-approved submission', async () => {
    const app = makeApp('admin');
    const db = makeDb({ corpus: { 5: { id: 1, approval_status: 'approved' } } });
    const res = await app.request('/documents/5/approve', { method: 'POST' }, { DB: db });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
  });
});
