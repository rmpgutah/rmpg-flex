// Miniflare tests for the Dial Connect history import: idempotent upserts keyed
// by dispatch_app_id, status mapping, voicemail rows, satellites, and the
// recording mirror attaching the service key only for export URLs.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { execute, query, queryFirst } from '../src/utils/db';
import dialerConnect, { mirrorPendingRecordings } from '../src/routes/dialerConnect';
import dialerConnectImport, { mapCallStatus, isDialConnectExportUrl } from '../src/routes/dialerConnectImport';

type User = { id: number; role: string; username: string; full_name: string };
const admin: User = { id: 1, role: 'admin', username: 'admin', full_name: 'Admin' };
const officer: User = { id: 2, role: 'officer', username: 'ofc', full_name: 'Officer' };
function makeApp(user: User) {
  const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: User; userId: number } }>();
  app.use('*', async (c, next) => { c.set('user', user); c.set('userId', user.id); await next(); });
  app.onError((err, c) => c.json({ error: err instanceof Error ? err.message : String(err) }, 500));
  app.route('/api/dialer-connect/import', dialerConnectImport);
  app.route('/api/dialer-connect', dialerConnect);
  return app;
}
const db = () => (env as unknown as { DB: D1Database }).DB;
// Must be an isAllowedRecordingSourceUrl() host or the mirror skips the row.
const BASE = 'https://rmpgutah.us/dialer';
const E = () => ({ ...(env as unknown as Record<string, unknown>), DIAL_CONNECT_SERVICE_KEY: 'svc-key', DIAL_CONNECT_API_BASE: BASE });

const exportPage = {
  exportedAt: '2026-09-14T00:00:00.000Z',
  users: [{ id: 'u1', name: 'Chzamo', email: 'c@x' }],
  calls: [
    {
      id: 'c1', twilioCallSid: 'CA111', direction: 'inbound', status: 'completed', callerNumber: '(801) 555-1212', callerName: 'Pat',
      receivedAt: '2026-09-01T10:00:00.000Z', answeredAt: '2026-09-01T10:00:05.000Z', endedAt: '2026-09-01T10:03:00.000Z',
      durationSeconds: 175, dispositionCode: 'resolved', notes: 'ok', transcript: null, aiTranscript: 'hello there', aiSummary: 'Asked about hours',
      incidentId: null, callerIdBlocked: false, ivrDigits: '2', deletedAt: null, deleteReason: null,
      handledBy: { id: 'u1', name: 'Chzamo', email: 'c@x' },
      recordingUrl: `${BASE}/api/export/audio/c1?kind=recording`, voicemailUrl: null,
    },
    {
      id: 'c2', twilioCallSid: null, direction: 'inbound', status: 'no_answer', callerNumber: '+18015550000', callerName: null,
      receivedAt: '2026-09-02T10:00:00.000Z', answeredAt: null, endedAt: null, durationSeconds: null, dispositionCode: null, notes: null,
      transcript: null, aiTranscript: null, aiSummary: null, incidentId: null, callerIdBlocked: false, ivrDigits: null,
      deletedAt: '2026-09-03T00:00:00.000Z', deleteReason: 'spam', handledBy: null,
      recordingUrl: null, voicemailUrl: `${BASE}/api/export/audio/c2?kind=voicemail`,
    },
    {
      id: 'c3', twilioCallSid: 'CA333', direction: 'outbound', status: 'failed', callerNumber: '+18014085868', callerName: null,
      receivedAt: '2026-09-14T22:46:53.000Z', answeredAt: null, endedAt: '2026-09-14T22:47:28.000Z', durationSeconds: 0,
      dispositionCode: null, notes: null, transcript: null, aiTranscript: null, aiSummary: null, incidentId: null,
      callerIdBlocked: true, ivrDigits: null, deletedAt: null, deleteReason: null, handledBy: { id: 'u1', name: 'Chzamo', email: 'c@x' },
      recordingUrl: null, voicemailUrl: null,
    },
  ],
  callbacks: [{ id: 'cb1', phoneNumber: '8015552222', note: 'call back', scheduledFor: '2026-09-20T15:00:00.000Z', incidentId: null, createdById: 'u1', completed: false, createdAt: '2026-09-10T00:00:00.000Z' }],
  contacts: [{ id: 'ct1', name: 'Sarge', phoneNumber: '+18015553333', isFavorite: true, ownerId: 'u1', createdAt: '2026-08-01T00:00:00.000Z' }],
  smsConversations: [{ id: 's1', phoneNumber: '+18015554444', updatedAt: '2026-09-05T00:00:00.000Z', createdAt: '2026-09-04T00:00:00.000Z',
    messages: [{ id: 'm1', conversationId: 's1', direction: 'inbound', body: 'hello', twilioSid: 'SM1', status: 'received', createdAt: '2026-09-04T00:00:01.000Z' },
               { id: 'm2', conversationId: 's1', direction: 'outbound', body: 'hi', twilioSid: 'SM2', status: 'delivered', createdAt: '2026-09-04T00:01:00.000Z' }] }],
  nextCursor: null,
};

beforeAll(async () => {
  // Schema comes from dialerConnect's ensureSchema on first request; make sure the base tables exist.
  await makeApp(admin).request('/api/dialer-connect/calls', {}, E());
});
afterEach(() => vi.unstubAllGlobals());

describe('POST /api/dialer-connect/import/dial-connect', () => {
  it('rejects non-admin roles', async () => {
    const res = await makeApp(officer).request('/api/dialer-connect/import/dial-connect', { method: 'POST' }, E());
    expect(res.status).toBe(403);
  });

  it('imports calls, voicemails, callbacks, contacts and SMS idempotently', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('x-rmpg-service-key')).toBe('svc-key');
      expect(url.startsWith(`${BASE}/api/export/history`)).toBe(true);
      return new Response(JSON.stringify(exportPage), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const first = await makeApp(admin).request('/api/dialer-connect/import/dial-connect', { method: 'POST' }, E());
    expect(first.status).toBe(200);
    const t1 = await first.json();
    expect(t1).toMatchObject({ ok: true, calls: 3, voicemails: 1, callbacks: 1, contacts: 1, smsConversations: 1, smsMessages: 2, pages: 1 });
    expect(t1.skipped).toEqual([]);

    const c1 = await queryFirst<Record<string, unknown>>(db(), "SELECT * FROM dialer_calls WHERE dispatch_app_id = 'c1'");
    expect(c1).toMatchObject({ call_sid: 'CA111', direction: 'inbound', status: 'completed', from_number: '+18015551212', from_name: 'Pat',
      agent_name: 'Chzamo', duration_seconds: 175, disposition: 'resolved', transcript: 'hello there', transcript_status: 'ready',
      recording_source_url: `${BASE}/api/export/audio/c1?kind=recording` });
    expect(String(c1!.notes)).toContain('AI summary: Asked about hours');
    expect(String(c1!.tags)).toContain('dial-connect-import');

    const c2 = await queryFirst<Record<string, unknown>>(db(), "SELECT * FROM dialer_calls WHERE dispatch_app_id = 'c2'");
    expect(c2).toMatchObject({ status: 'missed', call_sid: null });
    expect(String(c2!.tags)).toContain('dc-deleted');
    expect(String(c2!.notes)).toContain('spam');
    const vm = await queryFirst<Record<string, unknown>>(db(), "SELECT * FROM dialer_voicemails WHERE dispatch_app_id = 'c2'");
    expect(vm).toMatchObject({ from_number: '+18015550000', recording_source_url: `${BASE}/api/export/audio/c2?kind=voicemail`, mailbox: 'dial-connect' });

    const c3 = await queryFirst<Record<string, unknown>>(db(), "SELECT * FROM dialer_calls WHERE dispatch_app_id = 'c3'");
    expect(c3).toMatchObject({ direction: 'outbound', status: 'failed', to_number: '+18014085868' });
    expect(String(c3!.tags)).toContain('caller-id-blocked');

    expect(await queryFirst(db(), "SELECT * FROM dialer_callbacks WHERE dispatch_app_id = 'cb1'")).toMatchObject({ phone_number: '+18015552222', created_by_name: 'Chzamo', completed: 0 });
    expect(await queryFirst(db(), "SELECT * FROM dialer_contacts WHERE dispatch_app_id = 'ct1'")).toMatchObject({ name: 'Sarge', is_favorite: 1, owner_name: 'Chzamo' });
    const msgs = await query<{ body: string }>(db(), "SELECT m.body FROM dialer_sms_messages m JOIN dialer_sms_conversations c ON c.id = m.conversation_id WHERE c.dispatch_app_id = 's1' ORDER BY m.sent_at");
    expect(msgs.map((m) => m.body)).toEqual(['hello', 'hi']);

    // A Flex-side edit must survive a re-run; counts must not grow.
    await execute(db(), "UPDATE dialer_calls SET disposition = 'callback_scheduled', notes = 'edited in Flex' WHERE dispatch_app_id = 'c1'");
    const second = await makeApp(admin).request('/api/dialer-connect/import/dial-connect', { method: 'POST' }, E());
    expect((await second.json()).calls).toBe(3);
    expect(await queryFirst<{ n: number }>(db(), "SELECT COUNT(*) AS n FROM dialer_calls WHERE dispatch_app_id IN ('c1','c2','c3')")).toMatchObject({ n: 3 });
    expect(await queryFirst<{ n: number }>(db(), "SELECT COUNT(*) AS n FROM dialer_voicemails WHERE dispatch_app_id = 'c2'")).toMatchObject({ n: 1 });
    expect(await queryFirst<{ n: number }>(db(), "SELECT COUNT(*) AS n FROM dialer_sms_messages")).toMatchObject({ n: 2 });
    expect(await queryFirst<Record<string, unknown>>(db(), "SELECT disposition, notes FROM dialer_calls WHERE dispatch_app_id = 'c1'")).toMatchObject({ disposition: 'callback_scheduled', notes: 'edited in Flex' });
  });

  it('links an import row to a call already archived by SID instead of duplicating it', async () => {
    await execute(db(), "INSERT INTO dialer_calls (call_sid, direction, status, from_number, started_at) VALUES ('CA999', 'inbound', 'completed', '+18015559999', '2026-09-01T00:00:00.000Z')");
    const page = { ...exportPage, callbacks: [], contacts: [], smsConversations: [], calls: [{ ...exportPage.calls[0], id: 'c9', twilioCallSid: 'CA999', recordingUrl: null }] };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(page), { status: 200 })));
    await makeApp(admin).request('/api/dialer-connect/import/dial-connect', { method: 'POST' }, E());
    const rows = await query<{ dispatch_app_id: string | null }>(db(), "SELECT dispatch_app_id FROM dialer_calls WHERE call_sid = 'CA999'");
    expect(rows).toHaveLength(1);
    expect(rows[0].dispatch_app_id).toBe('c9');
  });

  it('reports not_configured without a service key and 503 when the export is unreachable', async () => {
    const nc = await makeApp(admin).request('/api/dialer-connect/import/dial-connect', { method: 'POST' }, { ...(env as unknown as Record<string, unknown>), DIAL_CONNECT_SERVICE_KEY: undefined });
    expect(await nc.json()).toEqual({ ok: false, code: 'not_configured' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('down', { status: 502 })));
    const res = await makeApp(admin).request('/api/dialer-connect/import/dial-connect', { method: 'POST' }, E());
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe('dialer_unreachable');
  });

  it('status endpoint reports imported counts and pending copies', async () => {
    const res = await makeApp(admin).request('/api/dialer-connect/import/dial-connect/status', {}, E());
    const body = await res.json();
    expect(body.importedCalls).toBeGreaterThanOrEqual(3);
    expect(body.importedVoicemails).toBeGreaterThanOrEqual(1);
    expect(body.copiesPending).toHaveProperty('call');
  });
});

describe('recording mirror + export URLs', () => {
  it('mapCallStatus + isDialConnectExportUrl', () => {
    expect(mapCallStatus('no_answer', null)).toBe('missed');
    expect(mapCallStatus('in_progress', '2026-01-01T00:00:00Z')).toBe('completed');
    expect(mapCallStatus('in_progress', null)).toBe('in_progress');
    expect(mapCallStatus('ringing', '2026-01-01T00:00:00Z')).toBe('missed');
    expect(isDialConnectExportUrl(BASE, `${BASE}/api/export/audio/c1?kind=recording`)).toBe(true);
    expect(isDialConnectExportUrl(BASE, 'https://api.twilio.com/2010-04-01/Accounts/AC1/Recordings/RE1')).toBe(false);
  });

  it('attaches the service key only when copying from the dispatch-app export', async () => {
    const seen: Array<{ url: string; key: string | null }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      seen.push({ url, key: new Headers(init?.headers).get('x-rmpg-service-key') });
      return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'audio/mpeg' } });
    }));
    await execute(db(), "UPDATE dialer_calls SET recording_r2_key = NULL, recording_mirror_attempts = 0 WHERE dispatch_app_id = 'c1'");
    await mirrorPendingRecordings(E() as never, 50);
    const exportFetch = seen.find((s) => s.url.startsWith(`${BASE}/api/export/audio/`));
    expect(exportFetch?.key).toBe('svc-key');
    const mirrored = await queryFirst<{ recording_r2_key: string | null }>(db(), "SELECT recording_r2_key FROM dialer_calls WHERE dispatch_app_id = 'c1'");
    expect(mirrored?.recording_r2_key).toBeTruthy();
  });
});
