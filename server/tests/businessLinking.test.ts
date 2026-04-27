// ============================================================
// Tests for the incident_businesses junction table.
// Plan task 1.1 — first junction in the Business records parity
// effort, mirroring the incident_persons pattern.
//
// NOTE: The plan originally placed this file at server/__tests__/
// and used initDatabase(':memory:'). Adjusted to:
//   - Live in server/tests/ (only path scanned by vitest.config.ts)
//   - Use the project's setupTestDataDir helper (initDatabase()
//     here takes no path argument and uses RMPG_DATA_DIR)
// ============================================================
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDataDir, teardownTestDataDir } from './helpers/testDb';

let testDir: string;

beforeAll(async () => {
  testDir = setupTestDataDir();
  const { initDatabase } = await import('../src/models/database');
  initDatabase();
});

afterAll(() => { teardownTestDataDir(testDir); });

describe('incident_businesses table', () => {
  it('creates the table with expected columns', async () => {
    const { getDb } = await import('../src/models/database');
    const db = getDb();
    const cols = db.prepare("PRAGMA table_info(incident_businesses)").all() as any[];
    const names = cols.map(c => c.name).sort();
    expect(names).toEqual(['added_by','business_id','created_at','id','incident_id','notes','role'].sort());
  });

  it('enforces UNIQUE(incident_id, business_id)', async () => {
    const { getDb } = await import('../src/models/database');
    const db = getDb();
    // Seed an officer so incidents.officer_id FK is satisfied.
    const officerId = (db.prepare(
      `INSERT INTO users (username, password_hash, full_name, email, role, status, must_change_password, password_changed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'officer', 'active', 0, datetime('now'), datetime('now'), datetime('now'))`
    ).run('unique_test_officer', 'x', 'Unique Officer', 'unique@test.local').lastInsertRowid) as number;
    const incidentId = (db.prepare(
      `INSERT INTO incidents (incident_number, incident_type, officer_id) VALUES (?, ?, ?)`
    ).run('IR-T1', 'TEST', officerId).lastInsertRowid) as number;
    const businessId = (db.prepare(
      `INSERT INTO businesses (name) VALUES (?)`
    ).run('Acme UNIQUE Test').lastInsertRowid) as number;
    db.prepare(
      `INSERT INTO incident_businesses (incident_id, business_id, role) VALUES (?, ?, ?)`
    ).run(incidentId, businessId, 'victim');
    expect(() =>
      db.prepare(
        `INSERT INTO incident_businesses (incident_id, business_id, role) VALUES (?, ?, ?)`
      ).run(incidentId, businessId, 'witness')
    ).toThrow(/UNIQUE/);
  });

  it('enforces role enum CHECK constraint', async () => {
    const { getDb } = await import('../src/models/database');
    const db = getDb();
    const officerId = (db.prepare(
      `INSERT INTO users (username, password_hash, full_name, email, role, status, must_change_password, password_changed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'officer', 'active', 0, datetime('now'), datetime('now'), datetime('now'))`
    ).run('check_test_officer', 'x', 'Check Officer', 'check@test.local').lastInsertRowid) as number;
    const incidentId = (db.prepare(
      `INSERT INTO incidents (incident_number, incident_type, officer_id) VALUES (?, ?, ?)`
    ).run('IR-T2', 'TEST', officerId).lastInsertRowid) as number;
    const businessId = (db.prepare(
      `INSERT INTO businesses (name) VALUES (?)`
    ).run('Acme CHECK Test').lastInsertRowid) as number;
    expect(() =>
      db.prepare(
        `INSERT INTO incident_businesses (incident_id, business_id, role) VALUES (?, ?, ?)`
      ).run(incidentId, businessId, 'not_a_real_role')
    ).toThrow(/CHECK/);
  });

  it('cascades on incident delete', async () => {
    const { getDb } = await import('../src/models/database');
    const db = getDb();
    const officerId = (db.prepare(
      `INSERT INTO users (username, password_hash, full_name, email, role, status, must_change_password, password_changed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'officer', 'active', 0, datetime('now'), datetime('now'), datetime('now'))`
    ).run('cascade_test_officer', 'x', 'Cascade Officer', 'cascade@test.local').lastInsertRowid) as number;
    const incidentId = (db.prepare(
      `INSERT INTO incidents (incident_number, incident_type, officer_id) VALUES (?, ?, ?)`
    ).run('IR-CASC-1', 'TEST', officerId).lastInsertRowid) as number;
    const businessId = (db.prepare(
      `INSERT INTO businesses (name) VALUES (?)`
    ).run('CascadeBiz1').lastInsertRowid) as number;
    db.prepare(
      `INSERT INTO incident_businesses (incident_id, business_id, role) VALUES (?, ?, ?)`
    ).run(incidentId, businessId, 'victim');
    // Delete the parent incident — link must vanish, not throw
    expect(() => db.prepare('DELETE FROM incidents WHERE id = ?').run(incidentId)).not.toThrow();
    const remaining = db.prepare('SELECT COUNT(*) as c FROM incident_businesses WHERE incident_id = ?').get(incidentId) as { c: number };
    expect(remaining.c).toBe(0);
  });

  it("role defaults to 'involved' when omitted", async () => {
    const { getDb } = await import('../src/models/database');
    const db = getDb();
    const officerId = (db.prepare(
      `INSERT INTO users (username, password_hash, full_name, email, role, status, must_change_password, password_changed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'officer', 'active', 0, datetime('now'), datetime('now'), datetime('now'))`
    ).run('default_test_officer', 'x', 'Default Officer', 'default@test.local').lastInsertRowid) as number;
    const incidentId = (db.prepare(
      `INSERT INTO incidents (incident_number, incident_type, officer_id) VALUES (?, ?, ?)`
    ).run('IR-DEF-1', 'TEST', officerId).lastInsertRowid) as number;
    const businessId = (db.prepare(
      `INSERT INTO businesses (name) VALUES (?)`
    ).run('DefaultBiz1').lastInsertRowid) as number;
    // Insert without role
    db.prepare(`INSERT INTO incident_businesses (incident_id, business_id) VALUES (?, ?)`).run(incidentId, businessId);
    const row = db.prepare('SELECT role FROM incident_businesses WHERE incident_id = ?').get(incidentId) as { role: string };
    expect(row.role).toBe('involved');
  });
});

describe('call_businesses table', () => {
  it('creates the table with expected columns', async () => {
    const { getDb } = await import('../src/models/database');
    const db = getDb();
    const cols = db.prepare("PRAGMA table_info(call_businesses)").all() as any[];
    const names = cols.map(c => c.name).sort();
    expect(names).toEqual(['added_by','business_id','call_id','created_at','id','notes','role'].sort());
  });

  it('enforces UNIQUE(call_id, business_id)', async () => {
    const { getDb } = await import('../src/models/database');
    const db = getDb();
    const callId = (db.prepare(
      `INSERT INTO calls_for_service (call_number, incident_type, priority, location_address)
       VALUES (?, ?, ?, ?)`
    ).run(`CB-UNQ-${Date.now()}`, 'disturbance', 'P3', '100 Test St').lastInsertRowid) as number;
    const businessId = (db.prepare(
      `INSERT INTO businesses (name) VALUES (?)`
    ).run('Acme CB UNIQUE').lastInsertRowid) as number;
    db.prepare(
      `INSERT INTO call_businesses (call_id, business_id, role) VALUES (?, ?, ?)`
    ).run(callId, businessId, 'victim');
    expect(() =>
      db.prepare(
        `INSERT INTO call_businesses (call_id, business_id, role) VALUES (?, ?, ?)`
      ).run(callId, businessId, 'witness')
    ).toThrow(/UNIQUE/);
  });

  it('cascades on call delete', async () => {
    const { getDb } = await import('../src/models/database');
    const db = getDb();
    const callId = (db.prepare(
      `INSERT INTO calls_for_service (call_number, incident_type, priority, location_address)
       VALUES (?, ?, ?, ?)`
    ).run(`CB-CASC-${Date.now()}`, 'disturbance', 'P3', '200 Test St').lastInsertRowid) as number;
    const businessId = (db.prepare(
      `INSERT INTO businesses (name) VALUES (?)`
    ).run('CascadeCallBiz1').lastInsertRowid) as number;
    db.prepare(
      `INSERT INTO call_businesses (call_id, business_id, role) VALUES (?, ?, ?)`
    ).run(callId, businessId, 'victim');
    expect(() => db.prepare('DELETE FROM calls_for_service WHERE id = ?').run(callId)).not.toThrow();
    const remaining = db.prepare('SELECT COUNT(*) as c FROM call_businesses WHERE call_id = ?').get(callId) as { c: number };
    expect(remaining.c).toBe(0);
  });

  it('allows duplicate role across different calls (UNIQUE is on the pair, not the role)', async () => {
    const { getDb } = await import('../src/models/database');
    const db = getDb();
    const callId1 = (db.prepare(
      `INSERT INTO calls_for_service (call_number, incident_type, priority, location_address)
       VALUES (?, ?, ?, ?)`
    ).run(`CB-DUP1-${Date.now()}`, 'disturbance', 'P3', '300 Test St').lastInsertRowid) as number;
    const callId2 = (db.prepare(
      `INSERT INTO calls_for_service (call_number, incident_type, priority, location_address)
       VALUES (?, ?, ?, ?)`
    ).run(`CB-DUP2-${Date.now()}`, 'disturbance', 'P3', '301 Test St').lastInsertRowid) as number;
    const businessId = (db.prepare(
      `INSERT INTO businesses (name) VALUES (?)`
    ).run('DupRoleBiz').lastInsertRowid) as number;
    expect(() => {
      db.prepare(`INSERT INTO call_businesses (call_id, business_id, role) VALUES (?, ?, ?)`)
        .run(callId1, businessId, 'victim');
      db.prepare(`INSERT INTO call_businesses (call_id, business_id, role) VALUES (?, ?, ?)`)
        .run(callId2, businessId, 'victim');
    }).not.toThrow();
    const count = db.prepare(
      `SELECT COUNT(*) as c FROM call_businesses WHERE business_id = ? AND role = 'victim'`
    ).get(businessId) as { c: number };
    expect(count.c).toBe(2);
  });
});
