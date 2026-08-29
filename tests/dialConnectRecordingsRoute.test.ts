import { describe, test, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import dialConnectRecordings from '../src/routes/dialConnectRecordings';
import * as persist from '../src/utils/dialConnectRecordings';

vi.spyOn(persist, 'ensureDialConnectRecordingsTable').mockResolvedValue();
vi.spyOn(persist, 'upsertDialConnectRecording').mockResolvedValue({
  id: 7, created: true, hasAudio: false,
});

function makeApp(role = 'dispatcher') {
  const app = new Hono<{ Bindings: any; Variables: any }>();
  app.use('*', async (c, next) => {
    if (role) {
      c.set('user', { id: 1, username: 'tester', role, full_name: 'Test Dispatcher' });
      c.set('userId', 1);
    }
    await next();
  });
  app.route('/', dialConnectRecordings);
  return app;
}

function makeDb(rows: persist.DialConnectRecordingRow[] = []) {
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
      const id = this.__bindArgs?.[0];
      return rows.find((r) => r.id === id) ?? null;
    }),
    all: vi.fn(async function () {
      return { results: rows };
    }),
    run: vi.fn(async function () {
      return { meta: { last_row_id: 7, changes: 1 } };
    }),
  };
}

const sample: persist.DialConnectRecordingRow = {
  id: 3,
  recording_sid: 'REabcd1234',
  call_sid: 'CAabcd1234',
  from_number: '+18015550100',
  to_number: '+18015550999',
  direction: 'inbound',
  started_at: '2026-08-12T15:04:00Z',
  ended_at: '2026-08-12T15:07:00Z',
  duration_seconds: 180,
  dispatcher_name: 'Dana Whitlock',
  transcript: 'Need an officer',
  segments_json: null,
  audio_r2_key: null,
  audio_content_type: null,
  audio_bytes: null,
  source: 'dial_connect',
  ingested_at: '2026-08-12T15:08:00Z',
  updated_at: '2026-08-12T15:08:00Z',
};

beforeEach(() => {
  vi.mocked(persist.upsertDialConnectRecording).mockClear();
});

describe('GET /api/dial-connect-recordings', () => {
  test('lists summaries for dispatchers', async () => {
    const app = makeApp();
    const res = await app.request('/', {}, { DB: makeDb([sample]), JWT_SECRET: 'test' });
    expect(res.status).toBe(200);
    const json = await res.json() as Array<{ recording_sid: string; has_transcript: boolean }>;
    expect(json).toHaveLength(1);
    expect(json[0].recording_sid).toBe('REabcd1234');
    expect(json[0].has_transcript).toBe(true);
  });

  test('client_viewer is forbidden', async () => {
    const app = makeApp('client_viewer');
    const res = await app.request('/', {}, { DB: makeDb(), JWT_SECRET: 'test' });
    expect(res.status).toBe(403);
  });
});

describe('POST /api/dial-connect-recordings', () => {
  test('stores a CAD iframe ingest', async () => {
    const app = makeApp();
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recordingSid: 'REabcd1234', transcript: 'Hello' }),
    }, { DB: makeDb(), JWT_SECRET: 'test' });
    expect(res.status).toBe(201);
    expect(persist.upsertDialConnectRecording).toHaveBeenCalledOnce();
  });

  test('400 when recordingSid missing', async () => {
    const app = makeApp();
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript: 'Hello' }),
    }, { DB: makeDb(), JWT_SECRET: 'test' });
    expect(res.status).toBe(400);
  });
});

describe('GET /:id', () => {
  test('returns transcript detail', async () => {
    const app = makeApp();
    const res = await app.request('/3', {}, { DB: makeDb([sample]), JWT_SECRET: 'test' });
    expect(res.status).toBe(200);
    const json = await res.json() as { transcript: string };
    expect(json.transcript).toBe('Need an officer');
  });
});
