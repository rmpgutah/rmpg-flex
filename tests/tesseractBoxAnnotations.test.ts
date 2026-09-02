import { describe, test, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import tesseractTrainingRouter from '../src/routes/tesseractTraining';

function makeDb(opts: {
  boxes?: Array<{ id: number; serve_intake_document_id: number; x0: number; y0: number; x1: number; y1: number; corrected_text: string; created_at: string }>;
} = {}) {
  const boxes = opts.boxes ?? [];
  let nextId = boxes.length + 1;

  const prepare = (sql: string) => {
    let boundArgs: any[] = [];
    const stmt: any = {
      bind: (...args: any[]) => { boundArgs = args; return stmt; },
      first: async () => null,
      all: async () => {
        if (/FROM tesseract_box_annotations WHERE serve_intake_document_id/.test(sql)) {
          const docId = boundArgs[0];
          return { results: boxes.filter((b) => b.serve_intake_document_id === docId) };
        }
        return { results: [] };
      },
      run: async () => {
        if (/INSERT INTO tesseract_box_annotations/.test(sql)) {
          const [docId, x0, y0, x1, y1, correctedText, createdBy, pageNumber] = boundArgs;
          const row = { id: nextId++, serve_intake_document_id: docId, x0, y0, x1, y1, corrected_text: correctedText, created_by: createdBy, page_number: pageNumber ?? 1, created_at: 'now' };
          boxes.push(row);
          return { meta: { changes: 1, last_row_id: row.id } };
        }
        if (/DELETE FROM tesseract_box_annotations/.test(sql)) {
          const [boxId, docId] = boundArgs;
          const idx = boxes.findIndex((b) => b.id === boxId && b.serve_intake_document_id === docId);
          if (idx >= 0) boxes.splice(idx, 1);
          return { meta: { changes: idx >= 0 ? 1 : 0 } };
        }
        return { meta: { changes: 0 } };
      },
    };
    return stmt;
  };

  return { prepare, _boxes: boxes };
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

describe('tesseract box annotations', () => {
  test('GET /documents/:id/boxes returns 403 for a non-admin/manager role', async () => {
    const app = makeApp('officer');
    const res = await app.request('/documents/1/boxes', {}, { DB: makeDb() });
    expect(res.status).toBe(403);
  });

  test('GET /documents/:id/boxes returns only boxes for that document', async () => {
    const app = makeApp('admin');
    const db = makeDb({
      boxes: [
        { id: 1, serve_intake_document_id: 5, x0: 10, y0: 20, x1: 100, y1: 40, corrected_text: 'Main St', created_at: 'now' },
        { id: 2, serve_intake_document_id: 6, x0: 0, y0: 0, x1: 5, y1: 5, corrected_text: 'other doc', created_at: 'now' },
      ],
    });
    const res = await app.request('/documents/5/boxes', {}, { DB: db });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.boxes).toHaveLength(1);
    expect(body.boxes[0].corrected_text).toBe('Main St');
  });

  test('POST /documents/:id/boxes creates a box and returns its id', async () => {
    const app = makeApp('manager');
    const db = makeDb();
    const res = await app.request('/documents/5/boxes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x0: 1, y0: 2, x1: 3, y1: 4, corrected_text: 'S Main St' }),
    }, { DB: db });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(typeof body.id).toBe('number');
  });

  test('POST /documents/:id/boxes stores page_number when provided', async () => {
    const app = makeApp('admin');
    const db = makeDb();
    const res = await app.request('/documents/5/boxes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x0: 1, y0: 2, x1: 3, y1: 4, corrected_text: 'Page two', page_number: 2 }),
    }, { DB: db });
    expect(res.status).toBe(200);
    expect((db as any)._boxes[0].page_number).toBe(2);
  });

  test('POST /documents/:id/boxes rejects a missing corrected_text', async () => {
    const app = makeApp('admin');
    const res = await app.request('/documents/5/boxes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x0: 1, y0: 2, x1: 3, y1: 4, corrected_text: '' }),
    }, { DB: makeDb() });
    expect(res.status).toBe(400);
  });

  test('DELETE /documents/:id/boxes/:boxId removes the box', async () => {
    const app = makeApp('admin');
    const db = makeDb({ boxes: [{ id: 9, serve_intake_document_id: 5, x0: 1, y0: 1, x1: 2, y1: 2, corrected_text: 'x', created_at: 'now' }] });
    const res = await app.request('/documents/5/boxes/9', { method: 'DELETE' }, { DB: db });
    expect(res.status).toBe(200);
    expect(db._boxes).toHaveLength(0);
  });

  test('DELETE /documents/:id/boxes/:boxId returns 404 when the box belongs to a different document', async () => {
    const app = makeApp('admin');
    const db = makeDb({ boxes: [{ id: 9, serve_intake_document_id: 6, x0: 1, y0: 1, x1: 2, y1: 2, corrected_text: 'x', created_at: 'now' }] });
    const res = await app.request('/documents/5/boxes/9', { method: 'DELETE' }, { DB: db });
    expect(res.status).toBe(404);
    expect(db._boxes).toHaveLength(1);
  });

  test('POST /documents/:id/boxes reports BOX_INSERT_FAILED when the D1 insert throws', async () => {
    const app = makeApp('admin');
    const db = {
      prepare: (sql: string) => ({
        bind: (..._args: any[]) => ({
          run: async () => {
            if (/INSERT INTO tesseract_box_annotations/.test(sql)) throw new Error('D1 unavailable');
            return { meta: { changes: 0 } };
          },
        }),
      }),
    };
    const res = await app.request('/documents/5/boxes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x0: 1, y0: 2, x1: 3, y1: 4, corrected_text: 'S Main St' }),
    }, { DB: db });
    expect(res.status).toBe(500);
    const body = await res.json() as any;
    expect(body.code).toBe('BOX_INSERT_FAILED');
  });
});
