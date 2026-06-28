// ============================================================
// /api/admin/config* — CRUD + grouped endpoint smoke tests.
// ============================================================
// Backs PR fixing the AdminSystemTab broken contract surfaced in the
// 2026-06-21 prod console dump:
//   - GET /admin/config returned a flat key/value map but AdminSystemTab
//     expected Record<category, ConfigItem[]> → every editor was empty.
//   - POST /admin/config (Add Incident Type / Add Disposition / etc.) had
//     no handler → 404 spam on every click.
//   - PUT /admin/config/:id and DELETE /admin/config/:id had no handler →
//     edits and deletes both 404'd. When POST returned 404 the client
//     cached an undefined id, then PUT /admin/config/undefined fired.
//
// These tests pin the new GET /admin/config-items grouped shape and the
// POST / PUT / DELETE handlers added to admin.ts. The role gate is checked
// at both the read (manager+) and write (admin+manager / admin-only)
// boundaries. Tests use the same lightweight D1 double as audit.test.ts.

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import admin from '../src/routes/admin';
import type { Env } from '../src/types';
import { makeFakeDb, recordingDb } from './helpers/fakeD1';

type Role = 'admin' | 'manager' | 'supervisor' | 'officer';

function buildApp(role: Role, db: D1Database) {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('user', { id: 1, username: 'tester', role, full_name: 'Test' });
    await next();
  });
  app.route('/api/admin', admin);
  return (path: string, init?: RequestInit) => app.request(path, init, { DB: db });
}

const SAMPLE_ROWS = [
  { id: 1, config_key: 'incident_type', config_value: 'theft', category: 'incident_types', sort_order: 0, is_active: 1, created_at: 't', updated_at: 't' },
  { id: 2, config_key: 'incident_type', config_value: 'assault', category: 'incident_types', sort_order: 0, is_active: 1, created_at: 't', updated_at: 't' },
  { id: 3, config_key: 'priority_levels', config_value: '[]', category: 'priority_config', sort_order: 0, is_active: 1, created_at: 't', updated_at: 't' },
];

describe('GET /api/admin/config-items', () => {
  it('returns Record<category, ConfigItem[]> grouped by category', async () => {
    const request = buildApp('admin', makeFakeDb([
      { match: /SELECT id, config_key, config_value, category/, rows: SAMPLE_ROWS },
    ]));
    const res = await request('/api/admin/config-items');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, any[]>;
    expect(body.incident_types).toHaveLength(2);
    expect(body.priority_config).toHaveLength(1);
    expect(body.incident_types[0]).toMatchObject({ id: 1, config_key: 'incident_type', config_value: 'theft' });
  });

  it('allows admin, manager, supervisor', async () => {
    for (const role of ['admin', 'manager', 'supervisor'] as const) {
      const request = buildApp(role, makeFakeDb([
        { match: /SELECT id, config_key, config_value, category/, rows: [] },
      ]));
      const res = await request('/api/admin/config-items');
      expect(res.status).toBe(200);
    }
  });

  it('rejects officer with 403', async () => {
    const request = buildApp('officer', makeFakeDb([]));
    const res = await request('/api/admin/config-items');
    expect(res.status).toBe(403);
  });
});

describe('POST /api/admin/config', () => {
  it('inserts a row and returns it with id', async () => {
    const { db, calls } = recordingDb([
      { match: /SELECT id, config_key, config_value, category, sort_order, is_active, created_at, updated_at\s+FROM system_config WHERE id/, rows: [
        { id: 1, config_key: 'incident_type', config_value: 'theft', category: 'incident_types', sort_order: 0, is_active: 1, created_at: 't', updated_at: 't' },
      ] },
    ]);
    const request = buildApp('admin', db);
    const res = await request('/api/admin/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config_key: 'incident_type', config_value: 'theft', category: 'incident_types' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { id: number; config_key: string };
    expect(body.id).toBe(1);
    expect(body.config_key).toBe('incident_type');
    const insertCall = calls.find(c => /^INSERT INTO system_config/.test(c.sql));
    expect(insertCall).toBeTruthy();
    expect(insertCall!.args).toEqual(['incident_type', 'theft', 'incident_types', 0]);
  });

  it('rejects missing config_key with 400', async () => {
    const request = buildApp('admin', makeFakeDb([]));
    const res = await request('/api/admin/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config_value: 'x' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects non-string config_value with 400', async () => {
    const request = buildApp('admin', makeFakeDb([]));
    const res = await request('/api/admin/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config_key: 'x', config_value: 42 }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects officer with 403', async () => {
    const request = buildApp('officer', makeFakeDb([]));
    const res = await request('/api/admin/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config_key: 'x', config_value: 'y' }),
    });
    expect(res.status).toBe(403);
  });

  it('defaults category to "general" when omitted', async () => {
    const { db, calls } = recordingDb([
      { match: /SELECT id, config_key/, rows: [{ id: 1, config_key: 'foo', config_value: 'bar', category: 'general', sort_order: 0, is_active: 1, created_at: 't', updated_at: 't' }] },
    ]);
    const request = buildApp('admin', db);
    await request('/api/admin/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config_key: 'foo', config_value: 'bar' }),
    });
    const insertCall = calls.find(c => /^INSERT INTO system_config/.test(c.sql));
    expect(insertCall!.args[2]).toBe('general');
  });
});

describe('PUT /api/admin/config/:id', () => {
  it('returns 400 for non-numeric id (the "undefined" prod bug)', async () => {
    const request = buildApp('admin', makeFakeDb([]));
    const res = await request('/api/admin/config/undefined', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config_value: 'x' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('INVALID_ID');
  });

  it('returns 400 for id <= 0', async () => {
    const request = buildApp('admin', makeFakeDb([]));
    const res = await request('/api/admin/config/0', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config_value: 'x' }),
    });
    expect(res.status).toBe(400);
  });

  it('updates and returns the row', async () => {
    const { db, calls } = recordingDb([
      { match: /SELECT id, config_key/, rows: [{ id: 5, config_key: 'k', config_value: 'new', category: 'general', sort_order: 0, is_active: 1, created_at: 't', updated_at: 't' }] },
    ]);
    const request = buildApp('admin', db);
    const res = await request('/api/admin/config/5', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config_value: 'new' }),
    });
    expect(res.status).toBe(200);
    const updateCall = calls.find(c => /^UPDATE system_config/.test(c.sql));
    expect(updateCall).toBeTruthy();
    expect(updateCall!.args).toEqual(['new', 5]);
  });

  it('rejects missing config_value with 400', async () => {
    const request = buildApp('admin', makeFakeDb([]));
    const res = await request('/api/admin/config/5', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('rejects officer with 403', async () => {
    const request = buildApp('officer', makeFakeDb([]));
    const res = await request('/api/admin/config/5', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config_value: 'x' }),
    });
    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/admin/config/:id', () => {
  it('returns 400 for non-numeric id', async () => {
    const request = buildApp('admin', makeFakeDb([]));
    const res = await request('/api/admin/config/undefined', { method: 'DELETE' });
    expect(res.status).toBe(400);
  });

  it('deletes the row and returns { success, id }', async () => {
    const { db, calls } = recordingDb([]);
    const request = buildApp('admin', db);
    const res = await request('/api/admin/config/7', { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; id: number };
    expect(body).toMatchObject({ success: true, id: 7 });
    const delCall = calls.find(c => /^DELETE FROM system_config/.test(c.sql));
    expect(delCall).toBeTruthy();
    expect(delCall!.args).toEqual([7]);
  });

  it('rejects manager with 403 (admin only)', async () => {
    const request = buildApp('manager', makeFakeDb([]));
    const res = await request('/api/admin/config/7', { method: 'DELETE' });
    expect(res.status).toBe(403);
  });
});
