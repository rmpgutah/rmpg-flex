// ============================================================
// POST /dispatch/panic — 5-second double-press dedupe
// ============================================================
// An officer who fat-fingers the panic button (or whose UI re-fires while
// a request is in flight) used to spawn TWO P1 officer_assist calls for
// the same event — dispatch saw both and could roll two units to one
// emergency, or miss that they were correlated. The fix adds a 5-second
// lookup that reuses an existing fresh panic-sourced open call instead
// of inserting a duplicate.
//
// These tests verify the SQL behavior via recordingDb:
//   - dedupe SELECT returns nothing → INSERT INTO calls_for_service runs
//   - dedupe SELECT returns a row    → INSERT does NOT run; panic_alerts
//                                       uses the existing call_id
// ============================================================

import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import panic from '../src/routes/dispatch/panic';
import type { Env } from '../src/types';
import { recordingDb } from './helpers/fakeD1';

// The notification engine spins up its own queries we don't want to
// orchestrate per-test — stub it (and the FlexCam auto-preserve import)
// so the panic flow under test focuses on the dedupe + INSERT shapes.
vi.mock('../src/routes/notificationEngine', () => ({
  evaluateNotificationRules: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../src/utils/footage/autoPreserve', () => ({
  preserveForEvent: vi.fn().mockResolvedValue(undefined),
}));

function buildApp(db: D1Database) {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('user', { id: 42, username: 'officer', role: 'officer', full_name: 'Test Officer' });
    c.set('userId', 42);
    await next();
  });
  app.route('/api/dispatch', panic);
  // No ALERT_HUB binding → emitAlert no-ops (verified at src/utils/alertHub.ts:24).
  return (path: string, init?: RequestInit) => app.request(path, init, { DB: db, JWT_SECRET: 'test', EVENTS: undefined });
}

describe('POST /dispatch/panic — double-press dedupe', () => {
  it('inserts a new CAD call when no recent panic exists', async () => {
    const { db, calls } = recordingDb([
      { match: /SELECT full_name, badge_number FROM users WHERE id = \?/, rows: [{ full_name: 'Test Officer', badge_number: 'B042' }] },
      { match: /SELECT id, call_sign, current_call_id, latitude, longitude FROM units WHERE officer_id/, rows: [{ id: 19, call_sign: 'D19', current_call_id: null, latitude: 40.76, longitude: -111.89 }] },
      // Dedupe SELECT — NOTHING recent.
      { match: /FROM calls_for_service\s+WHERE source = 'panic' AND dispatcher_id = \?/, rows: [] },
      // call_number generation for the new panic CAD call.
      { match: /SELECT MAX\(call_number\)/, rows: [{ max: null }] },
      // Final read of panic_alerts for the response payload.
      { match: /SELECT p\.\*, u\.full_name as user_name/, rows: [{ id: 1, call_number: 'PAN-2026-000001' }] },
    ]);

    const request = buildApp(db);
    const res = await request('/api/dispatch/panic', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ latitude: 40.76, longitude: -111.89, trigger_method: 'ui_button' }),
    });
    expect(res.status).toBe(201);

    const cadInserts = calls.filter((c) => /INSERT INTO calls_for_service/.test(c.sql));
    const panicInserts = calls.filter((c) => /INSERT INTO panic_alerts/.test(c.sql));
    expect(cadInserts).toHaveLength(1); // dedupe missed → fresh CAD call
    expect(panicInserts).toHaveLength(1);
  });

  it('writes an audit_log row on activation (recordAudit wiring)', async () => {
    // Panic activations are the most consequential officer-safety event in
    // the system; previously they wrote NO audit_log row, so compliance
    // review + analytics were blind. The fix routes through recordAudit().
    const { db, calls } = recordingDb([
      { match: /SELECT full_name, badge_number FROM users WHERE id = \?/, rows: [{ full_name: 'Test Officer', badge_number: 'B042' }] },
      { match: /SELECT id, call_sign, current_call_id, latitude, longitude FROM units WHERE officer_id/, rows: [{ id: 19, call_sign: 'D19', current_call_id: null, latitude: 40.76, longitude: -111.89 }] },
      { match: /FROM calls_for_service\s+WHERE source = 'panic' AND dispatcher_id = \?/, rows: [] },
      // call_number generation for the new panic CAD call.
      { match: /SELECT MAX\(call_number\)/, rows: [{ max: null }] },
      { match: /SELECT p\.\*, u\.full_name as user_name/, rows: [{ id: 1 }] },
    ]);
    const request = buildApp(db);
    await request('/api/dispatch/panic', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ trigger_method: 'ui_button' }),
    });

    // recordAudit's INSERT shape (auditLog.ts:52-53): six-column form with
    // COALESCE on created_at. Verify exactly one audit row for the activation
    // and that the action is 'panic_activated' (bind index 1 = action).
    const auditInserts = calls.filter((c) => /INSERT INTO audit_log/.test(c.sql));
    expect(auditInserts).toHaveLength(1);
    expect(auditInserts[0].args[1]).toBe('panic_activated');
    expect(auditInserts[0].args[2]).toBe('panic_alert');
  });

  it('REUSES the existing call when dedupe SELECT returns a row (5s double-press)', async () => {
    const { db, calls } = recordingDb([
      { match: /SELECT full_name, badge_number FROM users WHERE id = \?/, rows: [{ full_name: 'Test Officer', badge_number: 'B042' }] },
      { match: /SELECT id, call_sign, current_call_id, latitude, longitude FROM units WHERE officer_id/, rows: [{ id: 19, call_sign: 'D19', current_call_id: 777, latitude: 40.76, longitude: -111.89 }] },
      // Dedupe SELECT — HIT. Officer pressed panic 1.5s ago for the same emergency.
      { match: /FROM calls_for_service cfs\s+JOIN panic_alerts pa ON pa\.call_id = cfs\.id\s+WHERE cfs\.source = 'panic' AND pa\.user_id = \?/, rows: [{ id: 777 }] },
      // Final read of panic_alerts for the response payload.
      { match: /SELECT p\.\*, u\.full_name as user_name/, rows: [{ id: 2, call_id: 777, call_number: 'PAN-2026-000001' }] },
    ]);

    const request = buildApp(db);
    const res = await request('/api/dispatch/panic', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ latitude: 40.76, longitude: -111.89, trigger_method: 'ui_button' }),
    });
    expect(res.status).toBe(201);

    const cadInserts = calls.filter((c) => /INSERT INTO calls_for_service/.test(c.sql));
    const panicInserts = calls.filter((c) => /INSERT INTO panic_alerts/.test(c.sql));
    expect(cadInserts).toHaveLength(0); // dedupe HIT → no second CAD call spawned
    expect(panicInserts).toHaveLength(1); // panic_alerts row STILL written (one event, one alert row)

    // The panic_alerts INSERT must carry the existing callId, not null. The bind
    // order in panic.ts:188 is (officer_id, user_id, call_id, lat, lng, ...).
    expect(panicInserts[0].args[2]).toBe(777);
  });
});
