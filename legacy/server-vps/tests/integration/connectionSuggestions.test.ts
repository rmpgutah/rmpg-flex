import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';
import { setupTestDataDir, teardownTestDataDir, createTestAdmin } from '../helpers/testDb';

let app: Application;
let testDir: string;
let adminToken: string;
let officerToken: string;
let seedPerson: number;

beforeAll(async () => {
  testDir = setupTestDataDir();
  const { initDatabase, getDb } = await import('../../src/models/database');
  const db = initDatabase();
  const admin = createTestAdmin(db);
  const { createTestApp } = await import('../helpers/testApp');
  app = await createTestApp();

  adminToken = (await request(app).post('/api/auth/login').send({ username: admin.username, password: admin.password })).body.token;

  // Officer-role user (should NOT be able to access suggestions)
  const bcrypt = await import('bcryptjs');
  const hash = bcrypt.default.hashSync('OfficerP!', 12);
  const d = getDb();
  d.prepare(
    "INSERT INTO users (username, password_hash, role, email, full_name, status, must_change_password, totp_exempt, badge_number, phone, password_changed_at, created_at, updated_at) VALUES ('officer1', ?, 'officer', 'o@t.com', 'Officer One', 'active', 0, 1, 'B1', '555-0000', datetime('now'), datetime('now'), datetime('now'))"
  ).run(hash);
  officerToken = (await request(app).post('/api/auth/login').send({ username: 'officer1', password: 'OfficerP!' })).body.token;

  // Enable feature toggle
  d.prepare("INSERT INTO system_config (config_key, config_value) VALUES ('connections.suggestions_enabled', 'true')").run();

  // Seed person
  seedPerson = Number(d.prepare("INSERT INTO persons (first_name, last_name, phone, address, city) VALUES ('Seed','Person','555-0001','100 Main','SLC')").run().lastInsertRowid);
});

afterAll(() => { teardownTestDataDir(testDir); });

describe('GET /api/connections/suggestions', () => {
  it('returns 403 for officer role', async () => {
    const res = await request(app).get(`/api/connections/suggestions?type=person&id=${seedPerson}`)
      .set('Authorization', `Bearer ${officerToken}`);
    expect(res.status).toBe(403);
  });

  it('returns 403 when feature toggle is off', async () => {
    const { getDb } = await import('../../src/models/database');
    getDb().prepare("UPDATE system_config SET config_value = 'false' WHERE config_key = 'connections.suggestions_enabled'").run();
    const res = await request(app).get(`/api/connections/suggestions?type=person&id=${seedPerson}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FEATURE_DISABLED');
    // Re-enable for remaining tests
    getDb().prepare("UPDATE system_config SET config_value = 'true' WHERE config_key = 'connections.suggestions_enabled'").run();
  });

  it('R1: suggests persons sharing a phone', async () => {
    const { getDb } = await import('../../src/models/database');
    const d = getDb();
    const other = Number(d.prepare("INSERT INTO persons (first_name, last_name, phone) VALUES ('Share','Phone','555-0001')").run().lastInsertRowid);

    const res = await request(app).get(`/api/connections/suggestions?type=person&id=${seedPerson}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.disclaimer).toMatch(/Heuristic/i);
    expect(res.body.suggestions.some((s: any) => s.type === 'person' && s.id === other && s.rule === 'shared_phone')).toBe(true);
  });

  it('R2: suggests persons sharing an address', async () => {
    const { getDb } = await import('../../src/models/database');
    const d = getDb();
    const other = Number(d.prepare("INSERT INTO persons (first_name, last_name, address, city) VALUES ('Share','Addr','100 Main','SLC')").run().lastInsertRowid);

    const res = await request(app).get(`/api/connections/suggestions?type=person&id=${seedPerson}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.suggestions.some((s: any) => s.id === other && s.rule === 'shared_address')).toBe(true);
  });

  it('R3: suggests persons with ≥2 shared incidents', async () => {
    const { getDb } = await import('../../src/models/database');
    const d = getDb();
    const other = Number(d.prepare("INSERT INTO persons (first_name, last_name) VALUES ('Co','Occurrence')").run().lastInsertRowid);
    const i1 = Number(d.prepare("INSERT INTO incidents (incident_number, incident_type, status, officer_id) VALUES ('I-SUG-1','theft','submitted',1)").run().lastInsertRowid);
    const i2 = Number(d.prepare("INSERT INTO incidents (incident_number, incident_type, status, officer_id) VALUES ('I-SUG-2','theft','submitted',1)").run().lastInsertRowid);
    d.prepare("INSERT INTO incident_persons (incident_id, person_id, role, added_by) VALUES (?, ?, 'suspect', 1)").run(i1, seedPerson);
    d.prepare("INSERT INTO incident_persons (incident_id, person_id, role, added_by) VALUES (?, ?, 'witness', 1)").run(i1, other);
    d.prepare("INSERT INTO incident_persons (incident_id, person_id, role, added_by) VALUES (?, ?, 'suspect', 1)").run(i2, seedPerson);
    d.prepare("INSERT INTO incident_persons (incident_id, person_id, role, added_by) VALUES (?, ?, 'suspect', 1)").run(i2, other);

    const res = await request(app).get(`/api/connections/suggestions?type=person&id=${seedPerson}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const hit = res.body.suggestions.find((s: any) => s.id === other && s.rule === 'co_occurrence');
    expect(hit).toBeTruthy();
    expect(hit.confidence).toBe('medium');
    expect(hit.reason).toMatch(/2 shared/i);
  });

  it('R4: suggests persons cited in the same vehicle', async () => {
    const { getDb } = await import('../../src/models/database');
    const d = getDb();
    const other = Number(d.prepare("INSERT INTO persons (first_name, last_name) VALUES ('Plate','Pal')").run().lastInsertRowid);
    const v = Number(d.prepare("INSERT INTO vehicles_records (plate_number, state, make, model) VALUES ('XYZ999','UT','Honda','Civic')").run().lastInsertRowid);
    d.prepare(
      "INSERT INTO citations (citation_number, type, status, violation_date, person_id, vehicle_id) VALUES ('CIT-SUG-1','traffic','issued','2026-04-19',?,?)"
    ).run(seedPerson, v);
    d.prepare(
      "INSERT INTO citations (citation_number, type, status, violation_date, person_id, vehicle_id) VALUES ('CIT-SUG-2','traffic','issued','2026-04-19',?,?)"
    ).run(other, v);

    const res = await request(app).get(`/api/connections/suggestions?type=person&id=${seedPerson}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.suggestions.some((s: any) => s.id === other && s.rule === 'same_plate_stops')).toBe(true);
  });

  it('requires type=person (rejects other types with 400)', async () => {
    const res = await request(app).get('/api/connections/suggestions?type=vehicle&id=1')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
  });
});
