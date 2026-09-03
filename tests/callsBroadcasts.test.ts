// ============================================================
// /api/dispatch/calls — missing broadcast coverage
// ============================================================
// Six call mutations historically wrote to D1 without broadcasting
// dispatch_update, so peer dispatcher consoles rendered stale state
// for up to 20s (until the cross-device poll) and a deleted call
// kept showing on every board until a manual refresh.
//
// Fix: emitAlert(dispatch_update, …) after every mutation. These
// tests are smoke-level — one per representative mutation — because
// all six paths share the same try/catch wrapper and mergedCallRow
// helper; if one wires up correctly the structurally-identical
// siblings do too. Verified shape: action + the {id} or full row.
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import calls from '../src/routes/dispatch/calls';
import type { Env } from '../src/types';
import { recordingDb } from './helpers/fakeD1';

// Spy on emitAlert by replacing the module export at import time.
// (vi.hoisted ensures the mock applies before src/routes/dispatch/calls
// resolves its `import { emitAlert } from '../../utils/alertHub'`.)
const emitAlertSpy = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('../src/utils/alertHub', () => ({ emitAlert: emitAlertSpy }));

function buildApp(db: D1Database) {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('user', { id: 1, username: 'tester', role: 'admin', full_name: 'Test User' });
    c.set('userId', 1);
    await next();
  });
  app.route('/api/dispatch/calls', calls);
  return (path: string, init?: RequestInit) => app.request(path, init, { DB: db, JWT_SECRET: 'test' });
}

describe('/api/dispatch/calls broadcasts', () => {
  beforeEach(() => {
    emitAlertSpy.mockClear();
  });

  it('DELETE /:id emits dispatch_update { action: "call_deleted" } with the id', async () => {
    // Seed the pre-existence check so the new 404 guard passes; executeBatch
    // then proceeds and emitAlert fires as expected.
    const { db } = recordingDb([
      { match: /SELECT id FROM calls_for_service WHERE id = \?/, rows: [{ id: 123 }] },
    ]);
    const request = buildApp(db);
    const res = await request('/api/dispatch/calls/123', { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(emitAlertSpy).toHaveBeenCalledTimes(1);
    const [, type, payload] = emitAlertSpy.mock.calls[0];
    expect(type).toBe('dispatch_update');
    expect(payload).toEqual({ action: 'call_deleted', call: { id: 123 } });
  });

  it('POST /:id/unarchive emits dispatch_update { action: "call_updated" } with merged row', async () => {
    // unarchive path: UPDATE status='closed', then mergedCallRow re-fetch
    // (SELECT calls_for_service + SELECT calls_for_service_ext), then emitAlert.
    const { db } = recordingDb([
      { match: /SELECT \* FROM calls_for_service WHERE id = \?/, rows: [{ id: 7, status: 'closed', call_number: 'CFS-2026-0007' }] },
      { match: /SELECT \* FROM calls_for_service_ext WHERE id = \?/, rows: [{ id: 7, held_at: null }] },
    ]);
    const request = buildApp(db);
    const res = await request('/api/dispatch/calls/7/unarchive', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(emitAlertSpy).toHaveBeenCalledTimes(1);
    const [, type, payload] = emitAlertSpy.mock.calls[0] as [unknown, string, { action: string; call: Record<string, unknown> }];
    expect(type).toBe('dispatch_update');
    expect(payload.action).toBe('call_updated');
    // mergedCallRow spreads `calls_for_service` then `_ext` so both shapes appear.
    expect(payload.call.id).toBe(7);
    expect(payload.call.status).toBe('closed');
    expect(payload.call.held_at).toBeNull();
  });

  it('mergedCallRow returns null when the call no longer exists → no broadcast', async () => {
    // Concurrent DELETE between the UPDATE and the re-fetch: the broadcast
    // helper returns null and the handler skips the emit (verified by the
    // `if (merged)` guard at the unarchive call site).
    const { db } = recordingDb([
      { match: /SELECT \* FROM calls_for_service WHERE id = \?/, rows: [] },
    ]);
    const request = buildApp(db);
    const res = await request('/api/dispatch/calls/999/unarchive', { method: 'POST' });
    expect(res.status).toBe(200); // mutation still succeeded
    expect(emitAlertSpy).not.toHaveBeenCalled();
  });
});
