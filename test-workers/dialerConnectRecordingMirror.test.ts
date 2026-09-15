// Route-level test (Miniflare/workerd): every Dial Connect recording is COPIED
// into RMPG Flex (encrypted R2 via putEncrypted) rather than left as a link to
// dialer.rmpgutah.us. Pins: ingest mirrors call + voicemail audio, the audio
// endpoint then serves the local copy with no upstream fetch, the cron sweep
// backfills rows whose inline mirror failed, and retries are bounded.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { query, execute } from '../src/utils/db';
import dialerConnect, { mirrorPendingRecordings, MIRROR_MAX_ATTEMPTS } from '../src/routes/dialerConnect';

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
const AUDIO = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x21]); // "ID3" header + padding

const realFetch = globalThis.fetch;
function stubUpstream(handler: (url: string) => Response) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => handler(String(input instanceof Request ? input.url : input))));
}
afterEach(() => { vi.stubGlobal('fetch', realFetch); });

async function post(body: Record<string, unknown>) {
  return app.request('/api/dialer-connect/events', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }, E);
}
interface MirrorRow { id: number; recording_r2_key: string | null; recording_bytes: number | null; recording_mirror_attempts: number; recording_mirror_error: string | null; recording_mirrored_at: string | null }

beforeAll(async () => {
  stubUpstream(() => new Response(AUDIO, { headers: { 'content-type': 'audio/mpeg' } }));
  const res = await post({ type: 'call_status', callSid: 'CAwarmupMirror', status: 'completed' });
  expect(res.status).toBe(201);
  await execute(db(), 'DELETE FROM dialer_calls');
  await execute(db(), 'DELETE FROM dialer_voicemails');
});

describe('Dial Connect recording mirror', () => {
  it('copies a call recording into R2 on ingest and serves it locally afterwards', async () => {
    const fetchSpy = vi.fn(async () => new Response(AUDIO, { headers: { 'content-type': 'audio/mpeg' } }));
    vi.stubGlobal('fetch', fetchSpy);
    const res = await post({
      type: 'recording_ready', callSid: 'CAmirror001', direction: 'outbound',
      from: '+18015550100', to: '+13852675779', durationSeconds: 30,
      recordingUrl: 'https://dialer.rmpgutah.us/recordings/CAmirror001.mp3',
    });
    expect(res.status).toBe(201);
    const { id } = await res.json() as { id: number };

    const [row] = await query<MirrorRow>(db(), 'SELECT * FROM dialer_calls WHERE id = ?', id);
    expect(row.recording_r2_key).toMatch(/^dialer-connect\/call\//);
    expect(row.recording_bytes).toBe(AUDIO.byteLength);
    expect(row.recording_mirrored_at).toBeTruthy();
    expect(row.recording_mirror_error).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Upstream is now unreachable — the archive must serve the local copy.
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('upstream down'); }));
    const audio = await app.request(`/api/dialer-connect/calls/${id}/audio`, {}, E);
    expect(audio.status).toBe(200);
    expect(audio.headers.get('content-type')).toBe('audio/mpeg');
    expect(new Uint8Array(await audio.arrayBuffer())).toEqual(AUDIO);
  });

  it('copies a voicemail recording into R2 on ingest', async () => {
    stubUpstream(() => new Response(AUDIO, { headers: { 'content-type': 'audio/wav' } }));
    const res = await post({
      type: 'voicemail', callSid: 'CAvm001', from: '+18014836072', to: '+18015550100',
      transcript: 'Please call me back about the court review.',
      recordingUrl: 'https://dialer.rmpgutah.us/recordings/CAvm001.wav',
    });
    expect(res.status).toBe(201);
    const { id } = await res.json() as { id: number };
    const [row] = await query<MirrorRow & { recording_content_type: string | null }>(db(), 'SELECT * FROM dialer_voicemails WHERE id = ?', id);
    expect(row.recording_r2_key).toMatch(/^dialer-connect\/vm\//);
    expect(row.recording_content_type).toBe('audio/wav');
  });

  it('never fetches a recording from a non-allow-listed host', async () => {
    const fetchSpy = vi.fn(async () => new Response(AUDIO));
    vi.stubGlobal('fetch', fetchSpy);
    const res = await post({ type: 'recording_ready', callSid: 'CAevil001', recordingUrl: 'https://evil.example.com/x.mp3' });
    expect(res.status).toBe(201);
    const { id } = await res.json() as { id: number };
    const [row] = await query<MirrorRow>(db(), 'SELECT * FROM dialer_calls WHERE id = ?', id);
    expect(row.recording_r2_key).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('cron sweep backfills a failed inline mirror and bounds retries', async () => {
    // Inline attempt fails (upstream 503) → attempts=1, error recorded, no key.
    stubUpstream(() => new Response('busy', { status: 503 }));
    const res = await post({ type: 'recording_ready', callSid: 'CAretry001', recordingUrl: 'https://dialer.rmpgutah.us/recordings/CAretry001.mp3' });
    const { id } = await res.json() as { id: number };
    let [row] = await query<MirrorRow>(db(), 'SELECT * FROM dialer_calls WHERE id = ?', id);
    expect(row.recording_r2_key).toBeNull();
    expect(row.recording_mirror_attempts).toBe(1);
    expect(row.recording_mirror_error).toContain('503');

    // Sweep while upstream is healthy → mirrored.
    stubUpstream(() => new Response(AUDIO, { headers: { 'content-type': 'audio/mpeg' } }));
    const swept = await mirrorPendingRecordings(env as never, 10);
    expect(swept.mirrored).toBeGreaterThanOrEqual(1);
    [row] = await query<MirrorRow>(db(), 'SELECT * FROM dialer_calls WHERE id = ?', id);
    expect(row.recording_r2_key).toBeTruthy();

    // A permanently dead URL stops being retried after MIRROR_MAX_ATTEMPTS.
    stubUpstream(() => new Response('gone', { status: 404 }));
    const dead = await post({ type: 'recording_ready', callSid: 'CAdead001', recordingUrl: 'https://dialer.rmpgutah.us/recordings/CAdead001.mp3' });
    const { id: deadId } = await dead.json() as { id: number };
    for (let i = 0; i < MIRROR_MAX_ATTEMPTS + 2; i++) await mirrorPendingRecordings(env as never, 10);
    const [deadRow] = await query<MirrorRow>(db(), 'SELECT * FROM dialer_calls WHERE id = ?', deadId);
    expect(deadRow.recording_r2_key).toBeNull();
    expect(deadRow.recording_mirror_attempts).toBe(MIRROR_MAX_ATTEMPTS);
    const fetchSpy = vi.fn(async () => new Response(AUDIO));
    vi.stubGlobal('fetch', fetchSpy);
    await mirrorPendingRecordings(env as never, 10);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
