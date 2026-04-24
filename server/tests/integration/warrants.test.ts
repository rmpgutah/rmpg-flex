// ============================================================
// Warrants Integration Tests
// Exercises warrant creation, retrieval, person linking, and
// service recording. Warrants was recently overhauled — high
// bug-finding yield expected.
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';
import type Database from 'better-sqlite3';
import { setupTestDataDir, teardownTestDataDir, createTestAdmin } from '../helpers/testDb';

let app: Application;
let testDir: string;
let adminToken: string;
let testPersonId: number;
let db: Database.Database;
let adminUserId: number;

// ── Inline fixtures (the plan referenced agent/seed* helpers that
// don't exist in this file; keeping harness consistent with the
// rest of the suite by using supertest + auth header + direct SQL
// inserts).
function seedWarrant(overrides: Record<string, any> = {}): number {
  const row: Record<string, any> = {
    type: 'arrest',
    status: 'active',
    charge_description: 'Seeded charge',
    entered_by: adminUserId,
    subject_person_id: null,
    issue_date: null,
    priority_score: null,
    archived_at: null,
    source: 'manual',
    statute_id: null,
    ...overrides,
  };
  const res = db
    .prepare(
      `INSERT INTO warrants (type, status, charge_description, entered_by,
        subject_person_id, issue_date, priority_score, archived_at, source, statute_id)
       VALUES (@type, @status, @charge_description, @entered_by,
        @subject_person_id, @issue_date, @priority_score, @archived_at, @source, @statute_id)`
    )
    .run(row);
  return Number(res.lastInsertRowid);
}

function seedWarrants(list: Array<Record<string, any>>): number[] {
  return list.map((o) => seedWarrant(o));
}

function seedPerson(overrides: Record<string, any> = {}): number {
  const res = db
    .prepare('INSERT INTO persons (first_name, last_name, dob) VALUES (?, ?, ?)')
    .run(overrides.first_name || 'Test', overrides.last_name || 'Person', overrides.dob || '1990-01-01');
  return Number(res.lastInsertRowid);
}

function seedCall(overrides: Record<string, any> = {}): number {
  const res = db
    .prepare(
      `INSERT INTO calls_for_service (call_number, incident_type, priority, location_address)
       VALUES (?, ?, ?, ?)`
    )
    .run(
      overrides.call_number || `C-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      overrides.incident_type || 'disturbance',
      overrides.priority || 'P3',
      overrides.location_address || '123 Test'
    );
  return Number(res.lastInsertRowid);
}

function authGet(path: string) {
  return request(app).get(path).set('Authorization', `Bearer ${adminToken}`);
}
function authPost(path: string) {
  return request(app).post(path).set('Authorization', `Bearer ${adminToken}`);
}

beforeAll(async () => {
  testDir = setupTestDataDir();
  const { initDatabase } = await import('../../src/models/database');
  db = initDatabase();
  const admin = createTestAdmin(db);
  adminUserId = admin.userId;
  const { createTestApp } = await import('../helpers/testApp');
  app = await createTestApp();

  const res = await request(app)
    .post('/api/auth/login')
    .send({ username: admin.username, password: admin.password });
  adminToken = res.body.token;

  // Create a test person to link warrants to
  const personRes = await request(app)
    .post('/api/records/persons')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      first_name: 'Warrant',
      last_name: 'Subject',
      dob: '1990-01-01',
    });
  testPersonId = personRes.body.id;
});

afterAll(() => {
  teardownTestDataDir(testDir);
});

describe('POST /api/warrants', () => {
  it('creates a warrant with required fields', async () => {
    const res = await request(app)
      .post('/api/warrants')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        type: 'arrest',
        charge_description: 'Failure to appear',
        bail_amount: 1500,
        offense_level: 'misdemeanor',
      });

    expect([200, 201]).toContain(res.status);
    expect(res.body.id).toBeGreaterThan(0);
  });

  it('rejects missing type with 400', async () => {
    const res = await request(app)
      .post('/api/warrants')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ charge_description: 'No type' });

    expect(res.status).toBe(400);
  });

  it('rejects missing charge_description with 400', async () => {
    const res = await request(app)
      .post('/api/warrants')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ type: 'arrest' });

    expect(res.status).toBe(400);
  });

  it('rejects nonexistent subject_person_id with 404', async () => {
    const res = await request(app)
      .post('/api/warrants')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        type: 'arrest',
        charge_description: 'Test',
        subject_person_id: 999999,
      });

    expect(res.status).toBe(404);
  });

  it('creates a warrant linked to a person and persists', async () => {
    const createRes = await request(app)
      .post('/api/warrants')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        type: 'bench',
        charge_description: 'Contempt of court',
        subject_person_id: testPersonId,
        issuing_court: '3rd District',
        issuing_judge: 'Judge Smith',
        bail_amount: 5000,
      });

    expect([200, 201]).toContain(createRes.status);
    const warrantId = createRes.body.id;

    const getRes = await request(app)
      .get(`/api/warrants/${warrantId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body).toMatchObject({
      id: warrantId,
      subject_person_id: testPersonId,
      charge_description: 'Contempt of court',
    });
    expect(String(getRes.body.type).toLowerCase()).toBe('bench');
  });

  it('lists warrants', async () => {
    const res = await request(app)
      .get('/api/warrants')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const list = Array.isArray(res.body) ? res.body : res.body.data || res.body.warrants || [];
    expect(list.length).toBeGreaterThan(0);
  });
});

describe('Warrant person lookup', () => {
  it('checks warrants for a specific person', async () => {
    const res = await request(app)
      .get(`/api/warrants/check/${testPersonId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    // Should return warrants tied to this person (we created one above)
    const warrants = Array.isArray(res.body) ? res.body : res.body.warrants || res.body.data || [];
    expect(warrants.length).toBeGreaterThan(0);
  });
});

describe('PUT /api/warrants/:id/serve', () => {
  let warrantId: number;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/warrants')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        type: 'arrest',
        charge_description: 'Test warrant for service',
        subject_person_id: testPersonId,
        bail_amount: 2500,
      });
    warrantId = res.body.id;
  });

  it('marks a warrant as served', async () => {
    const res = await request(app)
      .put(`/api/warrants/${warrantId}/serve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        served_location: '123 Test St',
        served_notes: 'Served at residence',
      });

    expect([200, 201]).toContain(res.status);
  });
});

describe('GET /api/warrants — filter de-duplication', () => {
  it('applies severity filter exactly once (no doubled WHERE clauses)', async () => {
    // Create two warrants with different offense_level
    await request(app).post('/api/warrants').set('Authorization', `Bearer ${adminToken}`).send({
      type: 'arrest', charge_description: 'Felony filter test', offense_level: 'felony'
    });
    await request(app).post('/api/warrants').set('Authorization', `Bearer ${adminToken}`).send({
      type: 'arrest', charge_description: 'Misdemeanor filter test', offense_level: 'misdemeanor'
    });

    const res = await request(app)
      .get('/api/warrants?severity=felony')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    for (const w of res.body.data) {
      expect(w.offense_level).toBe('felony');
    }
  });

  it('applies source filter exactly once', async () => {
    const res = await request(app)
      .get('/api/warrants?source=manual')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    for (const w of res.body.data) {
      expect(w.source === 'manual' || w.source === null).toBe(true);
    }
  });
});

describe('GET /api/warrants — Phase 1 filters & computed fields', () => {
  it('filters by priority_min', async () => {
    const [lowId, midId, highId] = seedWarrants([
      { priority_score: 20 },
      { priority_score: 60 },
      { priority_score: 90 },
    ]);
    const res = await authGet('/api/warrants?priority_min=70').expect(200);
    const ids = res.body.data.map((w: any) => w.id);
    expect(ids).toContain(highId);
    expect(ids).not.toContain(lowId);
    expect(ids).not.toContain(midId);
    for (const w of res.body.data) {
      expect(w.priority_score).not.toBeNull();
      expect(w.priority_score).toBeGreaterThanOrEqual(70);
    }
  });

  it('filters by since_days', async () => {
    const now = new Date();
    const old = new Date(now.getTime() - 30 * 86400000).toISOString();
    const recent = new Date(now.getTime() - 3 * 86400000).toISOString();
    const [oldId, recentId] = seedWarrants([{ issue_date: old }, { issue_date: recent }]);
    const res = await authGet('/api/warrants?since_days=7').expect(200);
    const ids = res.body.data.map((w: any) => w.id);
    expect(ids).toContain(recentId);
    expect(ids).not.toContain(oldId);
  });

  it('filters by matches_person', async () => {
    const [noMatch, match] = seedWarrants([
      { subject_person_id: null },
      { subject_person_id: testPersonId },
    ]);
    const res = await authGet('/api/warrants?matches_person=1').expect(200);
    const ids = res.body.data.map((w: any) => w.id);
    expect(ids).toContain(match);
    expect(ids).not.toContain(noMatch);
    for (const w of res.body.data) {
      expect(w.subject_person_id).not.toBeNull();
    }
  });

  it('filters by state source', async () => {
    const [utId, nvId, manualId] = seedWarrants([
      { source: 'ut_warrants' },
      { source: 'nv_state' },
      { source: 'manual' },
    ]);
    const res = await authGet('/api/warrants?state=UT').expect(200);
    const ids = res.body.data.map((w: any) => w.id);
    expect(ids).toContain(utId);
    expect(ids).not.toContain(nvId);
    expect(ids).not.toContain(manualId);
  });

  it('combines filters with AND', async () => {
    const [a, b, c] = seedWarrants([
      { priority_score: 90, subject_person_id: null },
      { priority_score: 90, subject_person_id: testPersonId },
      { priority_score: 20, subject_person_id: testPersonId },
    ]);
    const res = await authGet('/api/warrants?priority_min=70&matches_person=1').expect(200);
    const ids = res.body.data.map((w: any) => w.id);
    expect(ids).toContain(b);
    expect(ids).not.toContain(a);
    expect(ids).not.toContain(c);
  });

  it('returns computed age_days and matches_person', async () => {
    const old = new Date(Date.now() - 10 * 86400000).toISOString();
    const wid = seedWarrant({ issue_date: old, subject_person_id: testPersonId });
    const res = await authGet('/api/warrants').expect(200);
    const w = res.body.data.find((r: any) => r.id === wid);
    expect(w).toBeTruthy();
    expect(w.age_days).toBeGreaterThanOrEqual(9);
    expect(w.age_days).toBeLessThanOrEqual(11);
    expect(w.matches_person).toBe(1);
  });
});

describe('GET /api/warrants/:id detail extensions', () => {
  it('includes statute_text when statute_id linked', async () => {
    // utah_statutes has several NOT NULL columns; provide all of them.
    const statuteId = db
      .prepare(
        `INSERT INTO utah_statutes (title, chapter, section, citation, short_title, description, category)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(76, 6, '404', '76-6-404-test', 'Theft', 'Theft statute', 'criminal')
      .lastInsertRowid as number;
    const warrantId = seedWarrant({ statute_id: statuteId });
    const res = await authGet(`/api/warrants/${warrantId}`).expect(200);
    expect(String(res.body.statute_text || '')).toContain('Theft');
  });

  it('includes rmpg_encounters when subject linked and has call_persons rows', async () => {
    const personId = seedPerson();
    const callId = seedCall();
    db.prepare('INSERT INTO call_persons (call_id, person_id) VALUES (?, ?)').run(callId, personId);
    const warrantId = seedWarrant({ subject_person_id: personId });
    const res = await authGet(`/api/warrants/${warrantId}`).expect(200);
    expect(res.body.rmpg_encounters).toBeInstanceOf(Array);
    expect(res.body.rmpg_encounters.length).toBeGreaterThan(0);
  });

  it('returns empty encounters/associates/vehicles when no subject link', async () => {
    const warrantId = seedWarrant({ subject_person_id: null });
    const res = await authGet(`/api/warrants/${warrantId}`).expect(200);
    expect(res.body.rmpg_encounters).toEqual([]);
    expect(res.body.known_associates).toEqual([]);
    expect(res.body.known_vehicles).toEqual([]);
  });
});
