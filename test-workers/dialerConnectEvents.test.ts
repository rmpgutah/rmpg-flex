// Route-level test (Miniflare/workerd) for POST /api/dialer-connect/events.
//
// Regression pins for the "unknown ×N / no duration / status flipped" call-history
// rows seen in production on 2026-09-05: a `recording_ready` event (which carries
// no status) arriving for an already-archived SID must enrich that row, never
// insert a numberless duplicate and never overwrite a `missed`/`failed` status
// with the insert-only 'completed' default. The upsert is a single statement so
// two events racing for the same SID cannot double-insert or 500 on the partial
// UNIQUE index.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { query, execute } from '../src/utils/db';
import dialerConnect from '../src/routes/dialerConnect';

const app = new Hono<{
  Bindings: Record<string, unknown>;
  Variables: { user: { id: number; role: string; username: string; full_name: string }; userId: number };
}>();
app.use('*', async (c, next) => {
  c.set('user', { id: 7, role: 'dispatcher', username: 'czamora', full_name: 'Christopher Zamora' });
  c.set('userId', 7);
  await next();
});
app.onError((err, c) => c.json({ error: err instanceof Error ? err.message : String(err) }, 500));
app.route('/api/dialer-connect', dialerConnect);

const db = () => (env as unknown as { DB: D1Database }).DB;
const E = env as unknown as Record<string, unknown>;

interface Row {
  id: number; call_sid: string | null; direction: string; status: string;
  from_number: string | null; to_number: string | null; duration_seconds: number | null;
  recording_source_url: string | null; started_at: string | null; agent_name: string | null;
  transcript: string | null; transcript_status: string | null;
}

async function post(body: Record<string, unknown>) {
  return app.request('/api/dialer-connect/events', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }, E);
}
async function rowsFor(sid: string): Promise<Row[]> {
  return query<Row>(db(), 'SELECT * FROM dialer_calls WHERE call_sid = ? ORDER BY id', sid);
}

beforeAll(async () => {
  // First request creates the schema; make sure we start from a clean table.
  const res = await post({ type: 'call_status', callSid: 'CAwarmup', status: 'completed' });
  expect(res.status).toBe(201);
  await execute(db(), 'DELETE FROM dialer_calls');
});

describe('POST /api/dialer-connect/events', () => {
  it('recording_ready after a failed call enriches the row and keeps status=failed', async () => {
    const sid = 'CAfailed001';
    let res = await post({
      type: 'call_status', callSid: sid, status: 'failed', direction: 'outbound',
      from: '+18015550100', to: '+13852675779', durationSeconds: 0, startedAt: '2026-09-05T13:37:15Z',
    });
    expect(res.status).toBe(201);

    // Dial Connect's recording_ready carries no status — before the fix this flipped
    // the row to 'completed' (or inserted a second, numberless row).
    res = await post({
      type: 'recording_ready', call_sid: sid,
      recordingUrl: 'https://dialer.rmpgutah.us/rec/CAfailed001.mp3',
      transcript: 'Call could not be completed.',
    });
    expect(res.status).toBe(201);

    const rows = await rowsFor(sid);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('failed');
    expect(rows[0].direction).toBe('outbound');
    expect(rows[0].from_number).toBe('+18015550100');
    expect(rows[0].to_number).toBe('+13852675779');
    expect(rows[0].started_at).toBe('2026-09-05T13:37:15Z');
    expect(rows[0].recording_source_url).toBe('https://dialer.rmpgutah.us/rec/CAfailed001.mp3');
    expect(rows[0].transcript_status).toBe('ready');
    expect(rows[0].agent_name).toBe('Christopher Zamora');
  });

  it('recording_ready arriving FIRST is later completed by call_status without a duplicate', async () => {
    const sid = 'CAorder002';
    let res = await post({
      type: 'recording_ready', callSid: sid, direction: 'inbound',
      from: '+13852675779', to: '+18015550100', durationSeconds: 61,
      recordingUrl: 'https://dialer.rmpgutah.us/rec/CAorder002.mp3',
    });
    expect(res.status).toBe(201);
    res = await post({ type: 'call_status', callSid: sid, status: 'missed', from: '+13852675779', to: '+18015550100' });
    expect(res.status).toBe(201);

    const rows = await rowsFor(sid);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('missed');
    expect(rows[0].direction).toBe('inbound');
    expect(rows[0].from_number).toBe('+13852675779');
    expect(rows[0].duration_seconds).toBe(61);
    expect(rows[0].recording_source_url).toBe('https://dialer.rmpgutah.us/rec/CAorder002.mp3');
  });

  it('concurrent events for one SID never double-insert or 500', async () => {
    const sid = 'CArace003';
    const results = await Promise.all([
      post({ type: 'call_status', callSid: sid, status: 'completed', direction: 'outbound', from: '+18015550100', to: '+18014836072', durationSeconds: 95 }),
      post({ type: 'recording_ready', callSid: sid, recordingUrl: 'https://dialer.rmpgutah.us/rec/CArace003.mp3' }),
      post({ type: 'transcript_ready', callSid: sid, transcript: 'Hello, this is RMPG.' }),
    ]);
    for (const r of results) expect(r.status).toBe(201);

    const rows = await rowsFor(sid);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('completed');
    expect(rows[0].to_number).toBe('+18014836072');
    expect(rows[0].duration_seconds).toBe(95);
    expect(rows[0].recording_source_url).toBe('https://dialer.rmpgutah.us/rec/CArace003.mp3');
    expect(rows[0].transcript).toBe('Hello, this is RMPG.');
  });

  it('an event without a SID still archives as a standalone row with sane defaults', async () => {
    const res = await post({ type: 'call_status', status: 'busy', to: '(801) 664-3345', direction: 'outbound' });
    expect(res.status).toBe(201);
    const { id } = await res.json() as { id: number };
    const [row] = await query<Row>(db(), 'SELECT * FROM dialer_calls WHERE id = ?', id);
    expect(row.call_sid).toBeNull();
    expect(row.status).toBe('busy');
    expect(row.to_number).toBe('+18016643345');
    expect(row.started_at).toBeTruthy();
  });
});
