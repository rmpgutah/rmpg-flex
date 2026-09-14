// ============================================================
// Evidence chain-of-custody status writes vs. the evidence.status CHECK
// ============================================================
// Live error_log (2026-09-14 12:47:10): 'Failed: D1_ERROR: CHECK constraint
// failed: status IN (\'received\',\'in_storage\',\'submitted_to_le\',
// \'released\',\'disposed\')' from POST /api/records/evidence/4/chain-action.
//
// Three write paths in src/routes/records.ts set status to a value the old
// CHECK constraint never allowed: chain-action's action='check_in'/'check_out'
// mapping, and the dedicated /checkout and /checkin endpoints. Migration
// 0289_evidence_status_checkout_checkin.sql widens the CHECK to match what
// the app has always assumed (see client/src/pages/EvidencePropertyPage.tsx
// status filters + src/routes/records.ts:2259). This test pins the fix at
// the HTTP layer — the exact request shape that failed live.

import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import app from './entry';

type D1 = import('@cloudflare/workers-types').D1Database;

async function seedEvidenceTable(db: D1): Promise<void> {
  // The route's response query LEFT JOINs users (e.collected_by = u.id) —
  // needs to exist even though every test's rows leave collected_by NULL.
  await db.prepare('CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, full_name TEXT)').run();
  // Mirrors the live post-migration shape (only the columns this test needs;
  // the route's ensureEvidenceSchema() ALTERs in the rest on demand).
  // D1Database.exec() splits its input on newlines and runs each line as its
  // own statement, so a multi-line CREATE TABLE has to go through prepare()
  // instead (a single statement, whitespace/newlines are fine there).
  await db.prepare(`CREATE TABLE IF NOT EXISTS evidence (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    evidence_number TEXT,
    incident_id INTEGER,
    description TEXT,
    evidence_type TEXT,
    storage_location TEXT,
    collected_by INTEGER,
    status TEXT NOT NULL DEFAULT 'received' CHECK(status IN ('received','in_storage','submitted_to_le','released','disposed','checked_out','checked_in')),
    chain_of_custody TEXT DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    checked_out_by INTEGER,
    checked_out_at TEXT,
    checkout_reason TEXT,
    expected_return_date TEXT,
    condition_on_return TEXT
  )`).run();
}

describe('evidence chain-action / checkout / checkin — status vs. CHECK constraint', () => {
  beforeAll(async () => {
    await seedEvidenceTable(env.DB as unknown as D1);
  });

  it('POST /chain-action with action=check_out does not hit the CHECK constraint', async () => {
    const db = env.DB as unknown as D1;
    const { meta } = await db.prepare(
      `INSERT INTO evidence (evidence_number, description, evidence_type, status) VALUES (?, ?, ?, 'received')`,
    ).bind('E-CO-1', 'test item', 'other').run();
    const id = meta.last_row_id;

    const res = await app.request(`/api/records/evidence/${id}/chain-action`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'check_out', to_location: 'Evidence Locker A' }),
    }, env);

    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; data: { status: string } };
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('checked_out');
  });

  it('POST /chain-action with action=check_in does not hit the CHECK constraint', async () => {
    const db = env.DB as unknown as D1;
    const { meta } = await db.prepare(
      `INSERT INTO evidence (evidence_number, description, evidence_type, status) VALUES (?, ?, ?, 'checked_out')`,
    ).bind('E-CI-1', 'test item', 'other').run();
    const id = meta.last_row_id;

    const res = await app.request(`/api/records/evidence/${id}/chain-action`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'check_in' }),
    }, env);

    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; data: { status: string } };
    expect(body.data.status).toBe('checked_in');
  });

  it('POST /checkout sets status=checked_out without a 500', async () => {
    const db = env.DB as unknown as D1;
    const { meta } = await db.prepare(
      `INSERT INTO evidence (evidence_number, description, evidence_type, status) VALUES (?, ?, ?, 'received')`,
    ).bind('E-CO-2', 'test item', 'other').run();
    const id = meta.last_row_id;

    const res = await app.request(`/api/records/evidence/${id}/checkout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'court' }),
    }, env);

    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; data: { status: string } };
    expect(body.data.status).toBe('checked_out');
  });

  it('POST /checkin sets status=checked_in without a 500', async () => {
    const db = env.DB as unknown as D1;
    const { meta } = await db.prepare(
      `INSERT INTO evidence (evidence_number, description, evidence_type, status) VALUES (?, ?, ?, 'checked_out')`,
    ).bind('E-CI-2', 'test item', 'other').run();
    const id = meta.last_row_id;

    const res = await app.request(`/api/records/evidence/${id}/checkin`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ condition_on_return: 'good' }),
    }, env);

    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; data: { status: string } };
    expect(body.data.status).toBe('checked_in');
  });
});
