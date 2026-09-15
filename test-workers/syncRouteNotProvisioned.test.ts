// Route-level regression test (Miniflare/workerd) for /api/sync/*.
//
// Live defect 2026-09-15: the admin Sync Status tab hammered
//   GET /api/sync/queue      → 500
//   GET /api/sync/conflicts  → 500
// through all three useApi retries. Root cause: `sync_queue` /
// `sync_conflicts` are created by migrations 0249/0250, both marked
// `Local-only` in their headers and deliberately NEVER applied to live D1
// (see CLAUDE.md "Schema changes"). On the cloud deployment the tables do
// not exist, so every query threw `no such table` out of the route body
// and the global onError turned it into a 500.
//
// "Not provisioned here" is the EXPECTED state for the cloud Worker, not an
// error, so the read endpoints must degrade to an empty 200 carrying
// `provisioned: false`, and the write endpoints must answer a typed 503
// instead of an opaque 500. The Miniflare D1 has no FZ-55 tables either,
// which is exactly the live cloud shape — so this file reproduces the bug
// without any fixture.
import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import sync from '../src/routes/sync';

type Env = Record<string, unknown>;
type Vars = { user: { id: number; role: string; username: string }; userId: number };

function appAs(role: string) {
  const app = new Hono<{ Bindings: Env; Variables: Vars }>();
  app.use('*', async (c, next) => {
    c.set('user', { id: 1, role, username: 'test-admin' });
    c.set('userId', 1);
    await next();
  });
  app.route('/api/sync', sync);
  return app;
}

describe('/api/sync/* when the FZ-55 sync tables are not provisioned', () => {
  it('GET /queue returns 200 with zeroed counts, not 500', async () => {
    const res = await appAs('admin').request('/api/sync/queue', {}, env as Env);
    expect(res.status).toBe(200);
    const body = await res.json() as {
      provisioned: boolean; pending: number; failed: number; delivered: number;
    };
    expect(body.provisioned).toBe(false);
    expect(body.pending).toBe(0);
    expect(body.failed).toBe(0);
    expect(body.delivered).toBe(0);
  });

  it('GET /conflicts returns 200 with an empty list, not 500', async () => {
    const res = await appAs('admin').request('/api/sync/conflicts?limit=50', {}, env as Env);
    expect(res.status).toBe(200);
    const body = await res.json() as { provisioned: boolean; conflicts: unknown[] };
    expect(body.provisioned).toBe(false);
    expect(body.conflicts).toEqual([]);
  });

  it('POST /replay answers a typed 503, not an opaque 500', async () => {
    const res = await appAs('admin').request('/api/sync/replay', { method: 'POST' }, env as Env);
    expect(res.status).toBe(503);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('not_provisioned');
  });

  it('POST /enqueue answers a typed 503, not an opaque 500', async () => {
    const res = await appAs('admin').request('/api/sync/enqueue', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'POST', path: '/api/dispatch/calls' }),
    }, env as Env);
    expect(res.status).toBe(503);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('not_provisioned');
  });

  // The provisioning probe must not become an authz bypass: role checks still
  // run first, so a non-privileged caller learns nothing about the schema.
  it('still forbids non-admin roles before probing the schema', async () => {
    for (const path of ['/api/sync/queue', '/api/sync/conflicts']) {
      const res = await appAs('officer').request(path, {}, env as Env);
      expect(res.status).toBe(403);
    }
    const replay = await appAs('officer').request('/api/sync/replay', { method: 'POST' }, env as Env);
    expect(replay.status).toBe(403);
  });
});
