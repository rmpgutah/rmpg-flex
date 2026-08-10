import { test, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import adminDevRouter, { DEFAULT_FLAGS } from '../src/routes/adminDev';

const mockKV = {
  get: vi.fn().mockResolvedValue(null),
  put: vi.fn().mockResolvedValue(undefined),
};

const mockDb = {
  prepare: vi.fn().mockReturnThis(),
  bind: vi.fn().mockReturnThis(),
  first: vi.fn().mockResolvedValue(null),
  run: vi.fn().mockResolvedValue({ meta: { last_row_id: 1 } }),
};

function makeAdminApp() {
  const app = new Hono<{ Bindings: any; Variables: any }>();
  app.use('*', async (c, next) => {
    c.set('user', { id: 1, username: 'admin', role: 'admin', full_name: 'Admin User' });
    await next();
  });
  app.route('/', adminDevRouter);
  return app;
}

function makeOfficerApp() {
  const app = new Hono<{ Bindings: any; Variables: any }>();
  app.use('*', async (c, next) => {
    c.set('user', { id: 2, username: 'officer1', role: 'officer', full_name: 'Officer One' });
    await next();
  });
  app.route('/', adminDevRouter);
  return app;
}

beforeEach(() => vi.clearAllMocks());

test('GET /feature-flags returns defaults when KV is empty', async () => {
  const app = makeAdminApp();
  const res = await app.request('/feature-flags', {}, { KV: mockKV, DB: mockDb });
  expect(res.status).toBe(200);
  const body = await res.json() as any;
  expect(body.draw).toBe(true);
  expect(body.annotations).toBe(true);
  expect(body.dev_diagnostics).toBe(false);
});

test('GET /feature-flags returns KV value when set', async () => {
  mockKV.get.mockResolvedValueOnce(JSON.stringify({ draw: false, annotations: true }));
  const app = makeAdminApp();
  const res = await app.request('/feature-flags', {}, { KV: mockKV, DB: mockDb });
  expect(res.status).toBe(200);
  const body = await res.json() as any;
  expect(body.draw).toBe(false);
});

test('GET /feature-flags is readable by non-admin users', async () => {
  const app = makeOfficerApp();
  const res = await app.request('/feature-flags', {}, { KV: mockKV, DB: mockDb });
  expect(res.status).toBe(200);
});

test('PUT /feature-flags requires admin role', async () => {
  const app = makeOfficerApp();
  const res = await app.request('/feature-flags', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ draw: false }),
  }, { KV: mockKV, DB: mockDb });
  expect(res.status).toBe(403);
});

test('PUT /feature-flags updates KV as admin', async () => {
  const app = makeAdminApp();
  const res = await app.request('/feature-flags', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ draw: false, annotations: true }),
  }, { KV: mockKV, DB: mockDb });
  expect(res.status).toBe(200);
  expect(mockKV.put).toHaveBeenCalled();
  const body = await res.json() as any;
  expect(body.success).toBe(true);
  expect(body.flags.draw).toBe(false);
});

test('PUT /feature-flags merges with existing KV state', async () => {
  mockKV.get.mockResolvedValueOnce(JSON.stringify({ dev_diagnostics: true }));
  const app = makeAdminApp();
  const res = await app.request('/feature-flags', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ draw: false }),
  }, { KV: mockKV, DB: mockDb });
  expect(res.status).toBe(200);
  const body = await res.json() as any;
  // Both the existing KV value and the new PUT value should be reflected
  expect(body.flags.draw).toBe(false);
  expect(body.flags.dev_diagnostics).toBe(true);
});

test('POST /mock/call rejects non-admin', async () => {
  const app = makeOfficerApp();
  const res = await app.request('/mock/call', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'TRAFFIC STOP' }),
  }, { KV: mockKV, DB: mockDb });
  expect(res.status).toBe(403);
});

test('POST /mock/call creates a call as admin', async () => {
  const app = makeAdminApp();
  const res = await app.request('/mock/call', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'TRAFFIC STOP' }),
  }, { KV: mockKV, DB: mockDb });
  expect(res.status).toBe(200);
  const body = await res.json() as any;
  expect(body.success).toBe(true);
  expect(mockDb.run).toHaveBeenCalled();
});

test('POST /mock/call rejects invalid type', async () => {
  const app = makeAdminApp();
  const res = await app.request('/mock/call', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'INVALID_TYPE' }),
  }, { KV: mockKV, DB: mockDb });
  expect(res.status).toBe(400);
  const body = await res.json() as any;
  expect(body.error).toBe('invalid_type');
});

test('POST /mock/gps rejects non-admin', async () => {
  const app = makeOfficerApp();
  const res = await app.request('/mock/gps', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ unit_id: 1, lat: 40.7, lng: -111.9 }),
  }, { KV: mockKV, DB: mockDb });
  expect(res.status).toBe(403);
});

test('POST /mock/gps returns 404 when unit not found', async () => {
  mockDb.first.mockResolvedValueOnce(null);
  const app = makeAdminApp();
  const res = await app.request('/mock/gps', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ unit_id: 999, lat: 40.7, lng: -111.9 }),
  }, { KV: mockKV, DB: mockDb });
  expect(res.status).toBe(404);
});

test('POST /mock/gps succeeds when unit exists', async () => {
  // officer_id is required: the breadcrumb lands in gps_breadcrumbs, whose
  // officer_id column is NOT NULL on live D1. A unit row without one cannot
  // produce a valid breadcrumb, so the mock has to carry it.
  mockDb.first.mockResolvedValueOnce({ id: 1, unit_number: 'UNIT-1', officer_id: 7 });
  const app = makeAdminApp();
  const res = await app.request('/mock/gps', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ unit_id: 1, lat: 40.7, lng: -111.9 }),
  }, { KV: mockKV, DB: mockDb });
  expect(res.status).toBe(200);
  const body = await res.json() as any;
  expect(body.success).toBe(true);
});

test('POST /mock/gps returns 409 when the unit has no officer assigned', async () => {
  // Rather than fabricate an officer_id, the route refuses — gps_breadcrumbs
  // .officer_id is NOT NULL, so there is nothing honest to insert.
  mockDb.first.mockResolvedValueOnce({ id: 2, unit_number: 'UNIT-2', officer_id: null });
  const app = makeAdminApp();
  const res = await app.request('/mock/gps', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ unit_id: 2, lat: 40.7, lng: -111.9 }),
  }, { KV: mockKV, DB: mockDb });
  expect(res.status).toBe(409);
  const body = await res.json() as any;
  expect(body.error).toBe('unit_has_no_officer');
});

test('DELETE /mock/calls rejects non-admin', async () => {
  const app = makeOfficerApp();
  const res = await app.request('/mock/calls', {
    method: 'DELETE',
  }, { KV: mockKV, DB: mockDb });
  expect(res.status).toBe(403);
});

test('DELETE /mock/calls closes test calls as admin', async () => {
  const app = makeAdminApp();
  const res = await app.request('/mock/calls', {
    method: 'DELETE',
  }, { KV: mockKV, DB: mockDb });
  expect(res.status).toBe(200);
  const body = await res.json() as any;
  expect(body.success).toBe(true);
});

// ── tesseract_ocr_primary feature flag ──────────────────────────────────────
test('DEFAULT_FLAGS export includes tesseract_ocr_primary set to false', () => {
  expect(DEFAULT_FLAGS.tesseract_ocr_primary).toBe(false);
});

test('GET /feature-flags defaults tesseract_ocr_primary to false', async () => {
  const app = makeAdminApp();
  const res = await app.request('/feature-flags', {}, { KV: mockKV, DB: mockDb });
  expect(res.status).toBe(200);
  const body = await res.json() as any;
  expect(body.tesseract_ocr_primary).toBe(false);
});

test('PUT /feature-flags allows admin to flip tesseract_ocr_primary on', async () => {
  const app = makeAdminApp();
  const res = await app.request('/feature-flags', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tesseract_ocr_primary: true }),
  }, { KV: mockKV, DB: mockDb });
  expect(res.status).toBe(200);
  const body = await res.json() as any;
  expect(body.flags.tesseract_ocr_primary).toBe(true);
});
