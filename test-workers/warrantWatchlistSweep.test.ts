// test-workers/warrantWatchlistSweep.test.ts
// Route-level test (Miniflare/workerd) for the warrant branch of
// sweepWatchlist(). Person/vehicle behavior is unchanged and already
// implicitly covered by this same sweep function; these tests focus on
// the new warrant-specific detection (status change, expiring soon,
// subject encountered) and the pre-existing vehicle-misrouting bug fix
// (entity_type='warrant' must NOT fall through to hitsForPerson).
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { execute, query } from '../src/utils/db';
import { sweepWatchlist } from '../src/utils/intelWatchlist';

async function resetTables() {
  const db = (env as unknown as { DB: D1Database }).DB;
  await execute(db, 'DROP TABLE IF EXISTS intel_watchlist');
  await execute(db, 'DROP TABLE IF EXISTS warrants');
  await execute(db, 'DROP TABLE IF EXISTS notifications');
  await execute(db, 'DROP TABLE IF EXISTS calls_for_service');
  await execute(db, 'DROP TABLE IF EXISTS call_persons');
  await execute(db, `CREATE TABLE intel_watchlist (
    id INTEGER PRIMARY KEY AUTOINCREMENT, entity_type TEXT NOT NULL, entity_id INTEGER NOT NULL,
    reason TEXT, added_by INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1,
    last_alert_at TEXT, created_at TEXT DEFAULT (datetime('now')),
    last_known_status TEXT, expiry_alerted_at TEXT
  )`);
  await execute(db, `CREATE TABLE warrants (
    id INTEGER PRIMARY KEY AUTOINCREMENT, warrant_number TEXT, status TEXT NOT NULL DEFAULT 'active',
    subject_person_id INTEGER, subject_name TEXT, expires_at TEXT, expiry_date TEXT
  )`);
  await execute(db, `CREATE TABLE notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT, priority TEXT, title TEXT, message TEXT,
    entity_type TEXT, entity_id INTEGER, user_id INTEGER, is_read INTEGER DEFAULT 0, created_at TEXT
  )`);
  await execute(db, `CREATE TABLE calls_for_service (
    id INTEGER PRIMARY KEY AUTOINCREMENT, call_number TEXT, incident_type TEXT, created_at TEXT
  )`);
  await execute(db, `CREATE TABLE call_persons (
    id INTEGER PRIMARY KEY AUTOINCREMENT, call_id INTEGER, person_id INTEGER
  )`);
}

describe('sweepWatchlist — warrant branch', () => {
  beforeEach(resetTables);

  it('fires a status-change alert and updates the snapshot', async () => {
    const db = (env as unknown as { DB: D1Database }).DB;
    await execute(db, `INSERT INTO warrants (id, warrant_number, status, subject_name) VALUES (1, 'W-1', 'served', 'Jane Roe')`);
    await execute(db, `INSERT INTO intel_watchlist (entity_type, entity_id, added_by, last_known_status) VALUES ('warrant', 1, 7, 'active')`);

    const alerts = await sweepWatchlist(db);
    expect(alerts).toBeGreaterThanOrEqual(1);

    const notifs = await query<any>(db, `SELECT * FROM notifications WHERE type = 'warrant_watch_hit'`);
    expect(notifs.some(n => /status changed/i.test(n.message) && /served/i.test(n.message))).toBe(true);

    const watch = await query<any>(db, `SELECT last_known_status FROM intel_watchlist WHERE entity_id = 1`);
    expect(watch[0].last_known_status).toBe('served');
  });

  it('does not re-fire a status-change alert on the next sweep with no further change', async () => {
    const db = (env as unknown as { DB: D1Database }).DB;
    await execute(db, `INSERT INTO warrants (id, warrant_number, status, subject_name) VALUES (2, 'W-2', 'active', 'Jane Roe')`);
    await execute(db, `INSERT INTO intel_watchlist (entity_type, entity_id, added_by, last_known_status) VALUES ('warrant', 2, 7, 'active')`);

    await sweepWatchlist(db); // first sweep — no change, no alert
    await sweepWatchlist(db); // second sweep — still no change
    const notifs = await query<any>(db, `SELECT * FROM notifications WHERE type = 'warrant_watch_hit'`);
    expect(notifs.length).toBe(0);
  });

  it('fires an expiring-soon alert exactly once', async () => {
    const db = (env as unknown as { DB: D1Database }).DB;
    const soon = new Date(Date.now() + 3 * 86400000).toISOString();
    await execute(db, `INSERT INTO warrants (id, warrant_number, status, subject_name, expires_at) VALUES (3, 'W-3', 'active', 'Jane Roe', ?)`, soon);
    await execute(db, `INSERT INTO intel_watchlist (entity_type, entity_id, added_by, last_known_status) VALUES ('warrant', 3, 7, 'active')`);

    await sweepWatchlist(db);
    let notifs = await query<any>(db, `SELECT * FROM notifications WHERE type = 'warrant_watch_hit'`);
    expect(notifs.filter(n => /expires in/i.test(n.message)).length).toBe(1);

    await sweepWatchlist(db); // second sweep — expiry_alerted_at is now set, must not re-fire
    notifs = await query<any>(db, `SELECT * FROM notifications WHERE type = 'warrant_watch_hit'`);
    expect(notifs.filter(n => /expires in/i.test(n.message)).length).toBe(1);
  });

  it('fires a subject-encountered alert reusing hitsForPerson, labeled with warrant context', async () => {
    const db = (env as unknown as { DB: D1Database }).DB;
    await execute(db, `INSERT INTO warrants (id, warrant_number, status, subject_person_id, subject_name) VALUES (4, 'W-4', 'active', 900, 'Jane Roe')`);
    await execute(db, `INSERT INTO intel_watchlist (entity_type, entity_id, added_by, last_known_status, last_alert_at) VALUES ('warrant', 4, 7, 'active', ?)`, new Date(0).toISOString());
    await execute(db, `INSERT INTO calls_for_service (id, call_number, incident_type, created_at) VALUES (1, 'CFS-2026-01542', 'traffic stop', datetime('now'))`);
    await execute(db, `INSERT INTO call_persons (call_id, person_id) VALUES (1, 900)`);

    await sweepWatchlist(db);
    const notifs = await query<any>(db, `SELECT * FROM notifications WHERE type = 'warrant_watch_hit'`);
    expect(notifs.some(n => /subject of warrant #W-4/i.test(n.message) && /CFS-2026-01542/.test(n.message))).toBe(true);
  });

  it('does not misroute a warrant watch into hitsForPerson (the pre-existing ternary bug)', async () => {
    const db = (env as unknown as { DB: D1Database }).DB;
    // A warrant with id=5 whose id would coincidentally match a person id
    // with unrelated new activity — if the old two-way ternary bug were
    // still present, this watch would incorrectly run hitsForPerson(db, 5, ...)
    // and could alert on unrelated activity for "person #5".
    await execute(db, `INSERT INTO warrants (id, warrant_number, status, subject_name) VALUES (5, 'W-5', 'active', 'No One')`);
    await execute(db, `INSERT INTO intel_watchlist (entity_type, entity_id, added_by, last_known_status) VALUES ('warrant', 5, 7, 'active')`);
    await execute(db, `INSERT INTO calls_for_service (id, call_number, incident_type, created_at) VALUES (2, 'CFS-UNRELATED', 'unrelated', datetime('now'))`);
    await execute(db, `INSERT INTO call_persons (call_id, person_id) VALUES (2, 5)`);

    await sweepWatchlist(db);
    const notifs = await query<any>(db, `SELECT * FROM notifications WHERE type = 'warrant_watch_hit'`);
    // No subject_person_id set on warrant #5, so no subject-encountered alert
    // should fire even though "person #5" has unrelated new activity.
    expect(notifs.some(n => /CFS-UNRELATED/.test(n.message))).toBe(false);
  });
});
