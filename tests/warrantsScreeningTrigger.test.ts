import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import warrants from '../src/routes/warrants';
import type { Env } from '../src/types';
import { makeFakeDb } from './helpers/fakeD1';

const screenPersonAllSourcesMock = vi.fn().mockResolvedValue({ sourcesRun: 7, newHits: 0, errors: 0 });

vi.mock('../src/utils/screening/screenPerson', () => ({
  screenPersonAllSources: (...args: unknown[]) => screenPersonAllSourcesMock(...args),
}));

// c.executionCtx throws if the harness omits a real ExecutionContext —
// this stub lets waitUntil-based fire-and-forget routes run under test.
function stubExecutionCtx() {
  return {
    waitUntil: (p: Promise<unknown>) => { p.catch(() => {}); },
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;
}

function buildApp(db: D1Database) {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('user', { id: 1, username: 'tester', role: 'admin', full_name: 'Test User' } as any);
    await next();
  });
  app.route('/api/warrants', warrants);
  return (path: string, init?: RequestInit) => app.request(path, init, { DB: db }, stubExecutionCtx());
}

function postJson(body: Record<string, unknown>): RequestInit {
  return { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}
function putJson(body: Record<string, unknown>): RequestInit {
  return { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

// Give queued microtasks (the waitUntil'd promise) a turn to run.
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('warrant create/update screening trigger', () => {
  it('POST / fires screenPersonAllSources when subject_person_id is given', async () => {
    screenPersonAllSourcesMock.mockClear();
    const request = buildApp(makeFakeDb([
      { match: /SELECT first_name, last_name FROM persons/, rows: [{ first_name: 'John', last_name: 'Smith' }] },
      { match: /SELECT \* FROM warrants WHERE id/, rows: [{ id: 1, subject_person_id: 42 }] },
    ]));

    const res = await request('/api/warrants', postJson({
      type: 'arrest', charge_description: 'Theft', subject_person_id: 42,
    }));
    expect(res.status).toBe(201);
    await flush();

    expect(screenPersonAllSourcesMock).toHaveBeenCalledWith(
      expect.anything(), 42, expect.objectContaining({ triggeredBy: 'warrant_create' }),
    );
  });

  it('POST / does not fire screening when no subject_person_id is given', async () => {
    screenPersonAllSourcesMock.mockClear();
    const request = buildApp(makeFakeDb([
      { match: /SELECT \* FROM warrants WHERE id/, rows: [{ id: 1, subject_person_id: null }] },
    ]));

    const res = await request('/api/warrants', postJson({ type: 'arrest', charge_description: 'Theft' }));
    expect(res.status).toBe(201);
    await flush();

    expect(screenPersonAllSourcesMock).not.toHaveBeenCalled();
  });

  it('PUT /:id fires screening when subject_person_id changes', async () => {
    screenPersonAllSourcesMock.mockClear();
    const request = buildApp(makeFakeDb([
      { match: /SELECT id, subject_person_id FROM warrants WHERE id/, rows: [{ id: 5, subject_person_id: 10 }] },
      { match: /SELECT \* FROM warrants WHERE id/, rows: [{ id: 5, subject_person_id: 99 }] },
    ]));

    const res = await request('/api/warrants/5', putJson({ subject_person_id: 99 }));
    expect(res.status).toBe(200);
    await flush();

    expect(screenPersonAllSourcesMock).toHaveBeenCalledWith(
      expect.anything(), 99, expect.objectContaining({ triggeredBy: 'warrant_update' }),
    );
  });

  it('PUT /:id does not fire screening when subject_person_id is unchanged', async () => {
    screenPersonAllSourcesMock.mockClear();
    const request = buildApp(makeFakeDb([
      { match: /SELECT id, subject_person_id FROM warrants WHERE id/, rows: [{ id: 5, subject_person_id: 10 }] },
      { match: /SELECT \* FROM warrants WHERE id/, rows: [{ id: 5, subject_person_id: 10 }] },
    ]));

    const res = await request('/api/warrants/5', putJson({ status: 'served' }));
    expect(res.status).toBe(200);
    await flush();

    expect(screenPersonAllSourcesMock).not.toHaveBeenCalled();
  });
});
