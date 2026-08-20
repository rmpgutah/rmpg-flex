import { describe, test, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import tesseractTrainingRouter from '../src/routes/tesseractTraining';

function makeDb(opts: { note?: { serve_intake_document_id: number; strokes_json: string } | null } = {}) {
  let note = opts.note ?? null;

  const prepare = (sql: string) => {
    let boundArgs: any[] = [];
    const stmt: any = {
      bind: (...args: any[]) => { boundArgs = args; return stmt; },
      first: async () => {
        if (/FROM tesseract_review_annotations WHERE serve_intake_document_id/.test(sql)) {
          const docId = boundArgs[0];
          return note && note.serve_intake_document_id === docId ? note : null;
        }
        return null;
      },
      all: async () => ({ results: [] }),
      run: async () => {
        if (/INSERT INTO tesseract_review_annotations/.test(sql) || /INSERT OR REPLACE INTO tesseract_review_annotations/.test(sql)) {
          const [docId, strokesJson] = boundArgs;
          note = { serve_intake_document_id: docId, strokes_json: strokesJson };
        }
        return { meta: { changes: 1 } };
      },
    };
    return stmt;
  };

  return { prepare, _getNote: () => note };
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

describe('tesseract review notes', () => {
  test('GET /documents/:id/notes returns null when none saved yet', async () => {
    const app = makeApp('admin');
    const res = await app.request('/documents/5/notes', {}, { DB: makeDb() });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.strokes).toBeNull();
  });

  test('PUT /documents/:id/notes saves the strokes layer, GET returns it', async () => {
    const app = makeApp('manager');
    const db = makeDb();
    const strokes = [{ tool: 'arrow', points: [[1, 2], [3, 4]], color: 'red' }];
    const putRes = await app.request('/documents/5/notes', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ strokes }),
    }, { DB: db });
    expect(putRes.status).toBe(200);

    const getRes = await app.request('/documents/5/notes', {}, { DB: db });
    const body = await getRes.json() as any;
    expect(body.strokes).toEqual(strokes);
  });

  test('PUT /documents/:id/notes returns 403 for a non-admin/manager role', async () => {
    const app = makeApp('officer');
    const res = await app.request('/documents/5/notes', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ strokes: [] }),
    }, { DB: makeDb() });
    expect(res.status).toBe(403);
  });

  test('PUT /documents/:id/notes reports NOTES_SAVE_FAILED when the D1 upsert throws', async () => {
    const app = makeApp('admin');
    const db = {
      prepare: (sql: string) => ({
        bind: (..._args: any[]) => ({
          run: async () => {
            if (/INSERT INTO tesseract_review_annotations/.test(sql)) throw new Error('D1 unavailable');
            return { meta: { changes: 0 } };
          },
        }),
      }),
    };
    const res = await app.request('/documents/5/notes', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ strokes: [] }),
    }, { DB: db });
    expect(res.status).toBe(500);
    const body = await res.json() as any;
    expect(body.code).toBe('NOTES_SAVE_FAILED');
  });
});
