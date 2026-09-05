// ============================================================
// GET /api/dispatch/disposition-codes — readable by every dispatch role
// ============================================================
// DispatchPage loaded its admin-configured disposition codes from
// GET /admin/config, which is gated to admin/manager/supervisor. Every
// dispatcher (and officer clearing their own call) therefore got a 403 and
// silently fell back to the built-in list — custom codes an admin added
// never reached the people who actually clear calls. This narrow endpoint
// exposes only the merged disposition roster, not the rest of system_config.
// ============================================================

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import aggregates from '../src/routes/dispatch/aggregates';
import type { Env } from '../src/types';
import { makeFakeDb } from './helpers/fakeD1';

function buildApp(db: D1Database, role: string) {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('user', { id: 2, username: 'dispatch1', role, full_name: 'Dispatcher One' });
    c.set('userId', 2);
    await next();
  });
  app.route('/api/dispatch', aggregates);
  return (path: string) => app.request(path, {}, { DB: db, JWT_SECRET: 'test' });
}

const rows = [
  { config_key: 'disposition_code', config_value: JSON.stringify({ code: 'RPT', description: 'Report Taken', color: '#3b82f6' }), category: 'dispositions', is_active: 1 },
  { config_key: 'disposition_code', config_value: JSON.stringify({ code: 'GOA', description: 'Gone On Arrival' }), category: 'dispositions', is_active: 1 },
  { config_key: 'agency_name', config_value: 'RMPG', category: 'branding', is_active: 1 },
  { config_key: 'fleetio_api_key', config_value: 'sekrit', category: 'security_config', is_active: 1 },
];

describe('GET /api/dispatch/disposition-codes', () => {
  for (const role of ['dispatcher', 'officer', 'supervisor', 'admin']) {
    it(`returns the merged disposition roster for role=${role}`, async () => {
      const db = makeFakeDb([{ match: /FROM system_config/, rows }]);
      const res = await buildApp(db, role)('/api/dispatch/disposition-codes');
      expect(res.status).toBe(200);
      const body = await res.json() as { dispositions: Array<{ code: string; description: string; config_value: string; is_active: boolean }> };
      const codes = body.dispositions.map((d) => d.code);
      expect(codes).toContain('RPT');
      expect(codes).toContain('GOA');
      // Same per-item contract DispatchPage already parses from /admin/config.
      const rpt = body.dispositions.find((d) => d.code === 'RPT')!;
      expect(rpt.is_active).toBe(true);
      expect(JSON.parse(rpt.config_value)).toMatchObject({ code: 'RPT', description: 'Report Taken' });
    });
  }

  it('never leaks non-disposition config rows (secrets, branding)', async () => {
    const db = makeFakeDb([{ match: /FROM system_config/, rows }]);
    const res = await buildApp(db, 'dispatcher')('/api/dispatch/disposition-codes');
    const text = await res.text();
    expect(text).not.toContain('sekrit');
    expect(text).not.toContain('agency_name');
    expect(Object.keys(JSON.parse(text))).toEqual(['dispositions']);
  });

  it('rejects client_viewer (read-only external role)', async () => {
    const db = makeFakeDb([{ match: /FROM system_config/, rows }]);
    const res = await buildApp(db, 'client_viewer')('/api/dispatch/disposition-codes');
    expect(res.status).toBe(403);
  });
});
