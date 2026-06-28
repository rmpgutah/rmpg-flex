import { test, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import mapAnnotationsRouter from '../src/routes/mapAnnotations';

const mockDb = {
  prepare: vi.fn().mockReturnThis(),
  bind: vi.fn().mockReturnThis(),
  all: vi.fn().mockResolvedValue({ results: [] }),
  run: vi.fn().mockResolvedValue({ meta: { last_row_id: 7 } }),
};

function makeApp() {
  const app = new Hono<{ Bindings: any; Variables: any }>();
  app.use('*', async (c, next) => {
    c.set('user', { id: 1, username: 'officer1', role: 'officer', full_name: 'Officer One' });
    await next();
  });
  app.route('/', mapAnnotationsRouter);
  return app;
}

beforeEach(() => vi.clearAllMocks());

test('GET / returns empty array', async () => {
  const app = makeApp();
  const res = await app.request('/', {}, { DB: mockDb });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual([]);
});

test('POST / rejects missing title', async () => {
  const app = makeApp();
  const res = await app.request('/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lat: 40.7, lng: -111.9 }),
  }, { DB: mockDb });
  expect(res.status).toBe(400);
  const body = await res.json() as { error: string };
  expect(body.error).toBe('title, lat, and lng are required');
});

test('POST / rejects invalid coordinates', async () => {
  const app = makeApp();
  const res = await app.request('/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'test', lat: 999, lng: -111.9 }),
  }, { DB: mockDb });
  expect(res.status).toBe(400);
  expect((await res.json() as { error: string }).error).toBe('invalid_coordinates');
});

test('POST / creates annotation and returns id', async () => {
  const app = makeApp();
  const res = await app.request('/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Suspicious Vehicle', lat: 40.7, lng: -111.9 }),
  }, { DB: mockDb });
  expect(res.status).toBe(201);
  expect((await res.json() as { id: number }).id).toBe(7);
});

test('DELETE /:id soft-deletes', async () => {
  const app = makeApp();
  const res = await app.request('/3', { method: 'DELETE' }, { DB: mockDb });
  expect(res.status).toBe(200);
  expect(mockDb.bind).toHaveBeenCalledWith(3);
});
