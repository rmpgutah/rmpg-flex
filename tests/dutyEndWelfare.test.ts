// ============================================================
// POST /dispatch/duty/end — welfare DO teardown
// ============================================================
// An officer who ends shift with an armed WelfareWatchDO (P1/P2 onscene
// that never de-escalated) used to keep firing alarms against the off-
// duty officer — phantom escalations, paged supervisors, dispatcher
// distrust of the watch system.
//
// Fix: after the unit release, POST /stop to the officer's WelfareWatchDO
// stub. The DO's handleStop is idempotent (setState(null) + deleteAlarm),
// so it's safe to fire unconditionally. To avoid ghost "auto-cleared"
// frames on every shift end, we first GET /state and only broadcast
// the welfare_auto_cleared dispatch_update when the DO actually had
// a watch active (call_sign or call_number present).
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import duty from '../src/routes/dispatch/duty';
import type { Env } from '../src/types';
import { recordingDb } from './helpers/fakeD1';

const emitAlertSpy = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('../src/utils/alertHub', () => ({ emitAlert: emitAlertSpy }));

// Hand-rolled WELFARE_WATCH binding double. Captures every fetch the
// duty handler dispatches to the DO stub so we can assert on URL +
// method without spinning up a real DurableObjectNamespace.
interface WelfareCalls {
  state: { method: string; url: string }[];
  stop: { method: string; url: string }[];
  other: { method: string; url: string }[];
}
function makeWelfareNamespace(stateReply: unknown): { binding: DurableObjectNamespace; calls: WelfareCalls } {
  const calls: WelfareCalls = { state: [], stop: [], other: [] };
  const stub = {
    fetch: async (urlOrReq: string | Request, init?: RequestInit): Promise<Response> => {
      const url = typeof urlOrReq === 'string' ? urlOrReq : urlOrReq.url;
      const method = (init?.method ?? (typeof urlOrReq !== 'string' ? urlOrReq.method : 'GET')) || 'GET';
      const path = new URL(url).pathname;
      const entry = { method, url };
      if (path === '/state') { calls.state.push(entry); return Response.json(stateReply); }
      if (path === '/stop')  { calls.stop.push(entry);  return Response.json({ success: true }); }
      calls.other.push(entry);
      return new Response('not found', { status: 404 });
    },
  };
  const binding = {
    idFromName: (_name: string) => ({ toString: () => 'fake-do-id' }),
    get: (_id: unknown) => stub,
  } as unknown as DurableObjectNamespace;
  return { binding, calls };
}

function buildApp(db: D1Database, welfare: DurableObjectNamespace) {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('user', { id: 42, username: 'officer', role: 'officer', full_name: 'Test Officer' });
    c.set('userId', 42);
    await next();
  });
  app.route('/api/dispatch/duty', duty);
  return (path: string, init?: RequestInit) =>
    app.request(path, init, { DB: db, JWT_SECRET: 'test', WELFARE_WATCH: welfare });
}

describe('POST /dispatch/duty/end — welfare DO teardown', () => {
  beforeEach(() => emitAlertSpy.mockClear());

  it('always calls DO /stop, even when no watch is armed (idempotent)', async () => {
    // No active watch → DO returns { stage: 0, idle: true }. We still fire
    // /stop unconditionally because (a) handleStop is idempotent and (b)
    // a TOCTOU between GET /state and POST /stop would otherwise leak
    // an arming watch through duty-end.
    const { db } = recordingDb([
      // openEntry → null (no clock-in), officerUnit → null. Defaults give []
      // so the handler skips the time-entry close + unit-release blocks.
    ]);
    const { binding, calls } = makeWelfareNamespace({ stage: 0, idle: true });
    const request = buildApp(db, binding);
    const res = await request('/api/dispatch/duty/end', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(res.status).toBe(200);
    expect(calls.state).toHaveLength(1);
    expect(calls.stop).toHaveLength(1);
    expect(calls.stop[0].method).toBe('POST');

    // No welfare_auto_cleared broadcast because the watch was idle. (The
    // unit-release path emits 0 frames here too because officerUnit was null.)
    const welfareFrames = emitAlertSpy.mock.calls.filter((args) =>
      (args[2] as { action?: string })?.action === 'welfare_auto_cleared',
    );
    expect(welfareFrames).toHaveLength(0);
  });

  it('broadcasts welfare_auto_cleared when the watch WAS armed', async () => {
    const { db } = recordingDb([]);
    const { binding, calls } = makeWelfareNamespace({
      stage: 1, idle: false, call_sign: 'D19', call_number: 'CFS-2026-0001',
    });
    const request = buildApp(db, binding);
    const res = await request('/api/dispatch/duty/end', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(res.status).toBe(200);
    expect(calls.stop).toHaveLength(1);

    const welfareFrames = emitAlertSpy.mock.calls.filter((args) =>
      (args[2] as { action?: string })?.action === 'welfare_auto_cleared',
    );
    expect(welfareFrames).toHaveLength(1);
    const [, , payload] = welfareFrames[0] as [unknown, string, Record<string, unknown>];
    expect(payload).toMatchObject({
      action: 'welfare_auto_cleared',
      user_id: 42,
      call_sign: 'D19',
      call_number: 'CFS-2026-0001',
      reason: 'shift_end',
    });
  });

  it('does NOT throw the request when the DO is unreachable', async () => {
    // Simulate a DO binding outage by making the stub fetch throw. The duty
    // handler's catch must log and continue — a welfare teardown failure
    // must never block a shift end.
    const { db } = recordingDb([]);
    const stub = { fetch: async () => { throw new Error('DO unreachable'); } };
    const binding = {
      idFromName: (_n: string) => ({ toString: () => 'x' }),
      get: () => stub,
    } as unknown as DurableObjectNamespace;
    const request = buildApp(db, binding);
    const res = await request('/api/dispatch/duty/end', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(res.status).toBe(200);
  });
});
