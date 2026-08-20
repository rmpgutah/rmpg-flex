import { describe, test, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import tesseractTrainingRouter from '../src/routes/tesseractTraining';

function makeDb(rows: Array<{ doc_type: string | null; eligible: number; labeled: number; approved: number }>) {
  const prepare = (sql: string) => {
    const stmt: any = {
      bind: (..._args: any[]) => stmt,
      all: async () => {
        if (/GROUP BY d\.doc_type/.test(sql)) return { results: rows };
        return { results: [] };
      },
      first: async () => null,
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

describe('tesseract training stats', () => {
  test('GET /stats returns 403 for a non-admin/manager role', async () => {
    const app = makeApp('officer');
    const res = await app.request('/stats', {}, { DB: makeDb([]) });
    expect(res.status).toBe(403);
  });

  test('GET /stats aggregates totals and by_doc_type, including a null doc_type group', async () => {
    const app = makeApp('admin');
    const rows = [
      { doc_type: 'summons', eligible: 40, labeled: 12, approved: 6 },
      { doc_type: 'subpoena', eligible: 15, labeled: 3, approved: 1 },
      { doc_type: null, eligible: 8, labeled: 0, approved: 0 },
    ];
    const res = await app.request('/stats', {}, { DB: makeDb(rows) });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.total_eligible).toBe(63);
    expect(body.total_labeled).toBe(15);
    expect(body.total_approved).toBe(7);
    expect(body.by_doc_type).toHaveLength(3);
    expect(body.by_doc_type.find((r: any) => r.doc_type === null)).toEqual(
      { doc_type: null, eligible: 8, labeled: 0, approved: 0 },
    );
  });
});
