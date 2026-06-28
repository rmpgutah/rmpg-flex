import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import auditByEntity from '../src/routes/auditByEntity';

describe('GET /api/audit/by-vehicle/:id', () => {
  let app: Hono<any>;
  let dbCall: { sql: string; bindings: unknown[] } | null = null;

  beforeEach(() => {
    dbCall = null;
    app = new Hono();
    app.use('*', async (c, next) => {
      c.set('user', { id: 7, username: 'tester', role: 'officer' });
      c.set('userId', 7);
      (c as any).env = {
        DB: {
          prepare: (sql: string) => ({
            bind: (...bindings: unknown[]) => ({
              all: async () => {
                dbCall = { sql, bindings };
                return { results: [
                  { id: 1, action: 'STATUS_CHANGE', details: '{"from":"in_service","to":"maintenance"}', created_at: '2026-06-20T10:00:00Z', user_id: 7 },
                ] };
              },
            }),
          }),
        },
        EVENTS: undefined,
      };
      await next();
    });
    app.route('/api/audit/by-vehicle', auditByEntity);
  });

  it('returns audit_log rows scoped to the vehicle id', async () => {
    const res = await app.request('/api/audit/by-vehicle/42');
    expect(res.status).toBe(200);
    const body = await res.json() as { rows: Array<{ action: string }> };
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].action).toBe('STATUS_CHANGE');
    expect(dbCall?.bindings).toContain('vehicle');
    expect(dbCall?.bindings).toContain(42);
  });

  it('rejects a non-numeric id (400)', async () => {
    const res = await app.request('/api/audit/by-vehicle/abc');
    expect(res.status).toBe(400);
  });

  it('clamps limit to 100 max', async () => {
    const res = await app.request('/api/audit/by-vehicle/42?limit=500');
    expect(res.status).toBe(200);
    expect(dbCall?.bindings).toContain(100);
  });
});
