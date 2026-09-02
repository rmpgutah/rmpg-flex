import { describe, test, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import tesseractTrainingRouter from '../src/routes/tesseractTraining';

function makeDb(opts: { corpusIds?: Set<number> } = {}) {
  const corpusIds = opts.corpusIds ?? new Set<number>();
  const prepare = (sql: string) => {
    let boundArgs: any[] = [];
    const stmt: any = {
      bind: (...args: any[]) => { boundArgs = args; return stmt; },
      first: async () => {
        if (/FROM tesseract_training_corpus WHERE serve_intake_document_id/.test(sql)) {
          const id = boundArgs[0];
          return corpusIds.has(id) ? { id: 1 } : null;
        }
        return null;
      },
      all: async () => ({ results: [] }),
      run: async () => ({ meta: { changes: 0 } }),
    };
    return stmt;
  };
  return { prepare };
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

describe('tesseract training raster pages', () => {
  test('returns 404 when the document is not in the corpus', async () => {
    const app = makeApp('admin');
    const fd = new FormData();
    fd.append('page', new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }), 'page-001.jpg');
    fd.append('page_number', '1');
    const res = await app.request('/documents/9/raster-pages', { method: 'POST', body: fd }, {
      DB: makeDb(), TESSERACT_TRAINING: { put: vi.fn() },
    });
    expect(res.status).toBe(404);
    expect((await res.json() as any).code).toBe('NOT_SUBMITTED');
  });

  test('writes page-NNN.jpg objects to the training bucket', async () => {
    const app = makeApp('manager');
    const put = vi.fn();
    const fd = new FormData();
    fd.append('page', new Blob([new Uint8Array([9, 9, 9])], { type: 'image/jpeg' }), 'page-002.jpg');
    fd.append('page_number', '2');
    const res = await app.request('/documents/9/raster-pages', { method: 'POST', body: fd }, {
      DB: makeDb({ corpusIds: new Set([9]) }), TESSERACT_TRAINING: { put },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.pages).toEqual([2]);
    expect(put).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[0][0]).toBe('training-corpus/9/page-002.jpg');
  });
});
