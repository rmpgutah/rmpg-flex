import { describe, test, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import integrationsRouter from '../src/routes/integrations';
import * as apiKeys from '../src/utils/apiKeys';
import * as persist from '../src/utils/dialConnectRecordings';

vi.spyOn(persist, 'upsertDialConnectRecording').mockResolvedValue({
  id: 11, created: true, hasAudio: true,
});

function makeApp() {
  const app = new Hono<{ Bindings: any; Variables: any }>();
  app.route('/', integrationsRouter);
  return app;
}

const ACTIVE_KEY_HASH = 'hash-of-active-key';

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
      if (sql.includes('FROM integration_api_keys WHERE key_hash')) {
        if (this.__bindArgs?.[0] === ACTIVE_KEY_HASH) {
          return { id: 1, name: 'Dial Connect', is_active: 1, scopes: '["service_request"]' };
        }
        return null;
      }
      return null;
    }),
    all: vi.fn(async function () {
      return { results: [] };
    }),
    run: vi.fn(async function () {
      return { meta: { last_row_id: 1, changes: 1 } };
    }),
  };
}

beforeEach(() => {
  vi.mocked(persist.upsertDialConnectRecording).mockClear();
  vi.spyOn(apiKeys, 'sha256Hex').mockImplementation(async (input: string) => {
    if (input === 'valid-service-request-key') return ACTIVE_KEY_HASH;
    return 'hash-of-unknown-key';
  });
});

describe('POST /dial-connect-recordings (API key)', () => {
  test('valid key stores the recording', async () => {
    const app = makeApp();
    const res = await app.request('/dial-connect-recordings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid-service-request-key',
      },
      body: JSON.stringify({
        recordingSid: 'REabcd1234',
        transcript: 'Caller reports a trespass',
      }),
    }, { DB: makeMockDb() });
    expect(res.status).toBe(201);
    expect(persist.upsertDialConnectRecording).toHaveBeenCalledOnce();
  });

  test('missing API key -> 401', async () => {
    const app = makeApp();
    const res = await app.request('/dial-connect-recordings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recordingSid: 'REabcd1234' }),
    }, { DB: makeMockDb() });
    expect(res.status).toBe(401);
  });
});
