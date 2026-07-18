import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import screening from '../src/routes/screening';
import type { Env } from '../src/types';
import { makeFakeDb } from './helpers/fakeD1';

const screenPersonAllSourcesMock = vi.fn();

vi.mock('../src/utils/screening/screenPerson', () => ({
  screenPersonAllSources: (...args: unknown[]) => screenPersonAllSourcesMock(...args),
}));

function buildApp(role: string) {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('user', { id: 9, username: 'tester', role, full_name: 'Test User' } as any);
    await next();
  });
  app.route('/api/screening', screening);
  return (path: string, init?: RequestInit) => app.request(path, init, { DB: makeFakeDb([]) });
}

describe('POST /api/screening/screen-person/:id', () => {
  it('runs the on-demand scan and returns its summary', async () => {
    screenPersonAllSourcesMock.mockReset().mockResolvedValue({ sourcesRun: 7, newHits: 2, errors: 0 });
    const request = buildApp('admin');

    const res = await request('/api/screening/screen-person/42', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, sourcesRun: 7, newHits: 2, errors: 0 });
    expect(screenPersonAllSourcesMock).toHaveBeenCalledWith(
      expect.anything(), 42, expect.objectContaining({ triggeredBy: 'manual:9' }),
    );
  });

  it('rejects a non-numeric id', async () => {
    const request = buildApp('admin');
    const res = await request('/api/screening/screen-person/not-a-number', { method: 'POST' });
    expect(res.status).toBe(400);
  });

  it('rejects a role outside SCAN_ROLES', async () => {
    const request = buildApp('officer');
    const res = await request('/api/screening/screen-person/42', { method: 'POST' });
    expect(res.status).toBe(403);
  });

  it('returns 500 with a safe message when the scan throws', async () => {
    screenPersonAllSourcesMock.mockReset().mockRejectedValue(new Error('db exploded'));
    const request = buildApp('admin');
    const res = await request('/api/screening/screen-person/42', { method: 'POST' });
    expect(res.status).toBe(500);
    const body = await res.json() as { success: boolean };
    expect(body.success).toBe(false);
  });
});
