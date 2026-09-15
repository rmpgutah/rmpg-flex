// Route-level test (Miniflare/workerd): every mirrored Dial Connect recording
// ends up with a transcript. Upstream (Twilio Intelligence / OpenAI in
// dispatch-app) is the primary path and silently no-ops when unconfigured, so
// this Worker-side Whisper sweep is the backstop. Pins: it transcribes calls
// and voicemails, never overwrites an upstream transcript, bounds its retries,
// and skips audio too large for the model instead of burning every attempt.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { query, execute, queryFirst } from '../src/utils/db';
import { putEncrypted } from '../src/utils/encryptedR2';
import {
  transcribePendingRecordings,
  TRANSCRIBE_MAX_ATTEMPTS,
  TRANSCRIBE_MAX_BYTES,
} from '../src/utils/dialerTranscription';

const db = () => (env as unknown as { DB: D1Database }).DB;
const E = env as unknown as Record<string, unknown>;
const AUDIO = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x21]);
// The Miniflare test env has no `AI` binding (see vitest.workers.config.mts —
// the AI binding is module-mocked per test), and the sweep no-ops without one.
// transcribeTransmission itself is mocked below, so a truthy stub is enough.
const sweepEnv = () => ({ ...E, AI: { run: vi.fn() } }) as never;

const transcribe = vi.fn();
vi.mock('../src/utils/aiDispatcher', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  transcribeTransmission: (...a: unknown[]) => transcribe(...a),
}));

interface Row {
  id: number;
  transcript: string | null;
  transcript_status: string | null;
  transcript_attempts: number;
  transcript_error: string | null;
  transcript_source: string | null;
}

const rowOf = (table: string, id: number) =>
  queryFirst<Row>(db(), `SELECT id, transcript, transcript_status, transcript_attempts, transcript_error, transcript_source FROM ${table} WHERE id = ?`, id);

/** Insert a row whose recording is already mirrored into encrypted R2. */
async function seedMirrored(
  table: 'dialer_calls' | 'dialer_voicemails',
  opts: { bytes?: number; transcript?: string | null } = {},
): Promise<number> {
  const res = await execute(
    db(),
    `INSERT INTO ${table} (call_sid, from_number, transcript, transcript_status) VALUES (?, ?, ?, ?)`,
    `CA${table}${Math.random().toString(36).slice(2)}`,
    '+18015551212',
    opts.transcript ?? null,
    opts.transcript ? 'ready' : 'none',
  );
  const id = Number(res.meta.last_row_id);
  const key = `dialer-connect/test/${table}/${id}`;
  await putEncrypted(
    (E as { UPLOADS: R2Bucket }).UPLOADS, db(), E as never, key, AUDIO,
    { httpMetadata: { contentType: 'audio/mpeg' } },
  );
  await execute(
    db(),
    `UPDATE ${table} SET recording_r2_key = ?, recording_content_type = 'audio/mpeg', recording_bytes = ? WHERE id = ?`,
    key, opts.bytes ?? AUDIO.byteLength, id,
  );
  return id;
}

let app: { request(path: string, init: RequestInit, env: unknown): Promise<Response> };

beforeAll(async () => {
  // Force the route's runtime schema reconcile so the 0292 columns exist here.
  const { default: dialerConnect } = await import('../src/routes/dialerConnect');
  const { Hono } = await import('hono');
  const built = new Hono<{
    Bindings: Record<string, unknown>;
    Variables: { user: { id: number; role: string; username: string; full_name: string }; userId: number };
  }>();
  built.use('*', async (c, next) => {
    c.set('user', { id: 7, role: 'dispatcher', username: 'czamora', full_name: 'Christopher Zamora' });
    c.set('userId', 7);
    await next();
  });
  built.onError((err, c) => c.json({ error: err instanceof Error ? err.message : String(err) }, 500));
  built.route('/api/dialer-connect', dialerConnect);
  app = built as never;
  const warm = await built.request('/api/dialer-connect/events', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'call_status', callSid: 'CAwarmupTranscribe', status: 'completed' }),
  }, E);
  expect(warm.status).toBe(201);
});

beforeEach(async () => {
  transcribe.mockReset();
  await execute(db(), 'DELETE FROM dialer_calls');
  await execute(db(), 'DELETE FROM dialer_voicemails');
});

describe('Dial Connect transcription backstop', () => {
  it('transcribes a mirrored call recording and marks it ready', async () => {
    transcribe.mockResolvedValue('Unit twelve, show me out at the Maverik on State.');
    const id = await seedMirrored('dialer_calls');

    const out = await transcribePendingRecordings(sweepEnv(), 10);
    expect(out).toMatchObject({ attempted: 1, transcribed: 1 });

    const row = await rowOf('dialer_calls', id);
    expect(row?.transcript).toBe('Unit twelve, show me out at the Maverik on State.');
    expect(row?.transcript_status).toBe('ready');
    expect(row?.transcript_source).toBe('workers-ai');
  });

  it('transcribes voicemails too', async () => {
    transcribe.mockResolvedValue('Please call me back about the alarm.');
    const id = await seedMirrored('dialer_voicemails');

    await transcribePendingRecordings(sweepEnv(), 10);

    const row = await rowOf('dialer_voicemails', id);
    expect(row?.transcript).toBe('Please call me back about the alarm.');
    expect(row?.transcript_status).toBe('ready');
  });

  it('never overwrites a transcript that already arrived from upstream', async () => {
    const id = await seedMirrored('dialer_calls', { transcript: 'Twilio Intelligence text' });

    const out = await transcribePendingRecordings(sweepEnv(), 10);

    expect(out.attempted).toBe(0);
    expect(transcribe).not.toHaveBeenCalled();
    expect((await rowOf('dialer_calls', id))?.transcript).toBe('Twilio Intelligence text');
  });

  it('bounds retries — an unintelligible recording stops being retried', async () => {
    transcribe.mockResolvedValue(null); // Whisper returned nothing usable
    const id = await seedMirrored('dialer_calls');

    for (let i = 0; i < TRANSCRIBE_MAX_ATTEMPTS + 2; i += 1) {
      await transcribePendingRecordings(sweepEnv(), 10);
    }

    expect(transcribe).toHaveBeenCalledTimes(TRANSCRIBE_MAX_ATTEMPTS);
    const row = await rowOf('dialer_calls', id);
    expect(row?.transcript_attempts).toBe(TRANSCRIBE_MAX_ATTEMPTS);
    expect(row?.transcript).toBeNull();
    expect(row?.transcript_error).toBeTruthy();
  });

  it('records a model failure as an error rather than losing the row', async () => {
    transcribe.mockRejectedValue(new Error('AI timeout: whisper-turbo'));
    const id = await seedMirrored('dialer_calls');

    const out = await transcribePendingRecordings(sweepEnv(), 10);

    expect(out).toMatchObject({ attempted: 1, transcribed: 0, failed: 1 });
    const row = await rowOf('dialer_calls', id);
    expect(row?.transcript_attempts).toBe(1);
    expect(row?.transcript_error).toContain('AI timeout');
  });

  it('skips audio too large for the model instead of retrying it to death', async () => {
    const id = await seedMirrored('dialer_calls', { bytes: TRANSCRIBE_MAX_BYTES + 1 });

    await transcribePendingRecordings(sweepEnv(), 10);

    expect(transcribe).not.toHaveBeenCalled();
    const row = await rowOf('dialer_calls', id);
    // Marked terminally so the sweep does not pick it up again — and visibly,
    // so "no transcript" is never indistinguishable from "nothing was said".
    expect(row?.transcript_status).toBe('too_large');
    expect(row?.transcript_error).toContain('too large');
  });

  it('leaves un-mirrored rows alone — there is nothing local to transcribe yet', async () => {
    await execute(db(), `INSERT INTO dialer_calls (call_sid, recording_source_url) VALUES ('CAnotmirrored', 'https://rmpgutah.us/dialer/x')`);

    const out = await transcribePendingRecordings(sweepEnv(), 10);

    expect(out.attempted).toBe(0);
    expect(transcribe).not.toHaveBeenCalled();
  });

  it('transcribes one row on demand, and retries a row the sweep gave up on', async () => {
    transcribe.mockResolvedValue(null);
    const id = await seedMirrored('dialer_calls');
    for (let i = 0; i < TRANSCRIBE_MAX_ATTEMPTS; i += 1) await transcribePendingRecordings(sweepEnv(), 10);
    expect((await rowOf('dialer_calls', id))?.transcript_status).toBe('unintelligible');

    transcribe.mockResolvedValue('Second pass got it.');
    const res = await app.request(`/api/dialer-connect/calls/${id}/transcribe`, { method: 'POST' }, sweepEnv());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, transcript: 'Second pass got it.', transcript_status: 'ready' });
  });

  it('refuses on-demand transcription when the recording is not mirrored yet', async () => {
    const r = await execute(db(), `INSERT INTO dialer_calls (call_sid, recording_source_url) VALUES ('CAondemand', 'https://rmpgutah.us/dialer/x')`);
    const id = Number(r.meta.last_row_id);
    const res = await app.request(`/api/dialer-connect/calls/${id}/transcribe`, { method: 'POST' }, sweepEnv());
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'not_mirrored' });
  });

  it('honours the per-sweep limit', async () => {
    transcribe.mockResolvedValue('ok');
    await seedMirrored('dialer_calls');
    await seedMirrored('dialer_calls');
    await seedMirrored('dialer_calls');

    const out = await transcribePendingRecordings(sweepEnv(), 2);

    expect(out.attempted).toBe(2);
    expect(await query(db(), `SELECT id FROM dialer_calls WHERE transcript IS NULL`)).toHaveLength(1);
  });
});
