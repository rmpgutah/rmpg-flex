import { describe, test, expect, beforeEach, vi } from 'vitest';
import geofencesRouter from '../src/routes/geofences';
import { Hono } from 'hono';

function makeApp(dbOverride?: any) {
  const app = new Hono<{ Bindings: any; Variables: any }>();
  app.use('*', async (c, next) => {
    c.set('user', { id: 1, username: 'test', role: 'admin', full_name: 'Test' });
    await next();
  });
  app.route('/', geofencesRouter);
  return app;
}

const mockDb = {
  prepare: vi.fn().mockReturnThis(),
  bind: vi.fn().mockReturnThis(),
  all: vi.fn().mockResolvedValue({ results: [] }),
  run: vi.fn().mockResolvedValue({ meta: { last_row_id: 42 } }),
  first: vi.fn().mockResolvedValue(null),
};

test('GET / returns empty array', async () => {
  const app = makeApp();
  const res = await app.request('/', {}, { DB: mockDb });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(Array.isArray(body)).toBe(true);
});

test('POST / rejects missing zone_name', async () => {
  const app = makeApp();
  const res = await app.request('/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ geojson_data: '{}' }),
  }, { DB: mockDb });
  expect(res.status).toBe(400);
});

test('POST / rejects invalid GeoJSON', async () => {
  const app = makeApp();
  const res = await app.request('/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ zone_name: 'test', geojson_data: 'not-json' }),
  }, { DB: mockDb });
  expect(res.status).toBe(400);
  const body = await res.json() as { error: string };
  expect(body.error).toBe('invalid_geojson');
});

test('POST / creates geofence and returns id', async () => {
  const app = makeApp();
  const res = await app.request('/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      zone_name: 'Test Zone',
      zone_type: 'alert',
      geojson_data: '{"type":"FeatureCollection","features":[]}',
      color: '#d4a017',
    }),
  }, { DB: mockDb });
  expect(res.status).toBe(201);
  const body = await res.json() as { id: number };
  expect(body.id).toBe(42);
});

test('DELETE /:id soft-deletes (sets is_active=0)', async () => {
  const app = makeApp();
  const res = await app.request('/5', { method: 'DELETE' }, { DB: mockDb });
  expect(res.status).toBe(200);
  expect(mockDb.bind).toHaveBeenCalledWith(5);
});
