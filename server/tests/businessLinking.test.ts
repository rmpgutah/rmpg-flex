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
});
