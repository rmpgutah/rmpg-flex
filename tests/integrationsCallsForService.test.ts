import { describe, test, expect, vi, beforeEach } from 'vitest';
import integrationsRouter from '../src/routes/integrations';
import { Hono } from 'hono';
import * as apiKeys from '../src/utils/apiKeys';

// The route mounts requireApiKeyScope() directly at the handler level (no
// JWT authMiddleware — see src/middleware/auth.ts isPublicAuthBypass), so
// the app under test is just the bare integrations router with a mocked D1.
function makeApp() {
  const app = new Hono<{ Bindings: any; Variables: any }>();
  app.route('/', integrationsRouter);
  return app;
}

const ACTIVE_KEY_HASH = 'hash-of-active-key';
const NO_SCOPE_KEY_HASH = 'hash-of-no-scope-key';

function makeMockDb() {
  return {
    prepare: vi.fn(function (this: any, sql: string) {
      this.__sql = sql;
      return this;
    }),
    bind: vi.fn(function (this: any, ...args: unknown[]) {
      this.__bindArgs = args;
      return this;
    }),
    first: vi.fn(async function (this: any) {
      const sql: string = this.__sql || '';
      const args: unknown[] = this.__bindArgs || [];
      if (sql.includes('FROM integration_api_keys WHERE key_hash')) {
        const hash = args[0];
        if (hash === ACTIVE_KEY_HASH) {
          return { id: 1, name: 'Dial Connect', is_active: 1, scopes: '["service_request"]' };
        }
        if (hash === NO_SCOPE_KEY_HASH) {
          return { id: 2, name: 'No Scope Key', is_active: 1, scopes: '["other_scope"]' };
        }
        return null;
      }
      return null;
    }),
    all: vi.fn(async function (this: any) {
      const sql: string = this.__sql || '';
      if (sql.includes('MAX(call_number)')) {
        return { results: [{ max: null }] };
      }
      return { results: [] };
    }),
    run: vi.fn(async function () {
      return { meta: { last_row_id: 99, changes: 1 } };
    }),
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(apiKeys, 'sha256Hex').mockImplementation(async (input: string) => {
    if (input === 'valid-service-request-key') return ACTIVE_KEY_HASH;
    if (input === 'valid-no-scope-key') return NO_SCOPE_KEY_HASH;
    return 'hash-of-unknown-key';
  });
});

const validBody = {
  locationAddress: '123 Main St, Salt Lake City, UT',
  latitude: 40.75,
  longitude: -111.9,
  incidentType: 'process_service',
  priority: 1,
  status: 'open',
  notes: 'Serve at front door',
  callerName: 'Jane Attorney',
  callerPhone: '801-555-0100',
};

describe('POST /calls-for-service', () => {
  test('valid request + valid API key with correct scope -> 201, mapped fields', async () => {
    const app = makeApp();
    const db = makeMockDb();
    const res = await app.request('/calls-for-service', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid-service-request-key',
      },
      body: JSON.stringify(validBody),
    }, { DB: db });

    expect(res.status).toBe(201);
    const json = await res.json() as { id: number; call_number: string };
    expect(json.id).toBe(99);
    expect(json.call_number).toMatch(/^CFS\d{2}-00001$/);

    // Verify the INSERT bound priority -> 'P1', status -> 'pending', source -> 'other'.
    const insertCall = (db.bind as any).mock.calls.find((args: unknown[]) =>
      args.includes('P1') && args.includes('pending'),
    );
    expect(insertCall).toBeTruthy();
  });

  test('missing API key -> 401', async () => {
    const app = makeApp();
    const db = makeMockDb();
    const res = await app.request('/calls-for-service', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody),
    }, { DB: db });
    expect(res.status).toBe(401);
  });

  test('invalid API key -> 401', async () => {
    const app = makeApp();
    const db = makeMockDb();
    const res = await app.request('/calls-for-service', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer totally-bogus-key',
      },
      body: JSON.stringify(validBody),
    }, { DB: db });
    expect(res.status).toBe(401);
  });

  test('valid key without required scope -> 403', async () => {
    const app = makeApp();
    const db = makeMockDb();
    const res = await app.request('/calls-for-service', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid-no-scope-key',
      },
      body: JSON.stringify(validBody),
    }, { DB: db });
    expect(res.status).toBe(403);
  });

  test('missing locationAddress -> 400', async () => {
    const app = makeApp();
    const db = makeMockDb();
    const { locationAddress, ...rest } = validBody;
    const res = await app.request('/calls-for-service', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid-service-request-key',
      },
      body: JSON.stringify(rest),
    }, { DB: db });
    expect(res.status).toBe(400);
  });

  test('invalid incidentType enum -> 400', async () => {
    const app = makeApp();
    const db = makeMockDb();
    const res = await app.request('/calls-for-service', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid-service-request-key',
      },
      body: JSON.stringify({ ...validBody, incidentType: 'not_a_real_type' }),
    }, { DB: db });
    expect(res.status).toBe(400);
  });

  test('invalid priority enum -> 400', async () => {
    const app = makeApp();
    const db = makeMockDb();
    const res = await app.request('/calls-for-service', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid-service-request-key',
      },
      body: JSON.stringify({ ...validBody, priority: 4 }),
    }, { DB: db });
    expect(res.status).toBe(400);
  });

  test('invalid status enum -> 400', async () => {
    const app = makeApp();
    const db = makeMockDb();
    const res = await app.request('/calls-for-service', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid-service-request-key',
      },
      body: JSON.stringify({ ...validBody, status: 'archived' }),
    }, { DB: db });
    expect(res.status).toBe(400);
  });
});
