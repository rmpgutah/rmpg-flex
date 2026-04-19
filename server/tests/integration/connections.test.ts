import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';
import { setupTestDataDir, teardownTestDataDir, createTestAdmin } from '../helpers/testDb';

let app: Application;
let testDir: string;
let adminToken: string;
let personId: number;
let incidentId: number;

beforeAll(async () => {
  testDir = setupTestDataDir();
  const { initDatabase, getDb } = await import('../../src/models/database');
  const db = initDatabase();
  const admin = createTestAdmin(db);
  const { createTestApp } = await import('../helpers/testApp');
  app = await createTestApp();

  // Login
  const loginRes = await request(app)
    .post('/api/auth/login')
    .send({ username: admin.username, password: admin.password });
  adminToken = loginRes.body.token;

  // Seed data: 1 person, 1 incident, 1 incident_persons link
  const d = getDb();
  personId = Number(d.prepare(
    "INSERT INTO persons (first_name, last_name, dob) VALUES ('Test', 'Suspect', '1990-01-01')"
  ).run().lastInsertRowid);
  incidentId = Number(d.prepare(
    "INSERT INTO incidents (incident_number, incident_type, status, officer_id) VALUES ('I-0001', 'Burglary', 'submitted', ?)"
  ).run(admin.userId).lastInsertRowid);
  d.prepare(
    "INSERT INTO incident_persons (incident_id, person_id, role, added_by) VALUES (?, ?, 'suspect', ?)"
  ).run(incidentId, personId, admin.userId);
});

afterAll(() => { teardownTestDataDir(testDir); });

describe('GET /api/connections/graph', () => {
  it('returns graph with person seed + connected incident at depth 2', async () => {
    const res = await request(app)
      .get(`/api/connections/graph?type=person&id=${personId}&depth=2`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.nodes).toHaveLength(2);
    expect(res.body.nodes.find((n: any) => n.type === 'person')).toBeTruthy();
    expect(res.body.nodes.find((n: any) => n.type === 'incident')).toBeTruthy();
    expect(res.body.edges).toHaveLength(1);
    expect(res.body.edges[0].relationship).toBe('suspect');
  });

  it('rejects invalid type with 400', async () => {
    const res = await request(app)
      .get(`/api/connections/graph?type=unicorn&id=1&depth=2`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
  });

  it('requires authentication', async () => {
    const res = await request(app).get(`/api/connections/graph?type=person&id=${personId}`);
    expect(res.status).toBe(401);
  });

  it('traverses person → warrant via subject_person_id', async () => {
    const d = (await import('../../src/models/database')).getDb();
    // Look up an existing user id for entered_by (warrants.entered_by is NOT NULL FK to users)
    const uid = (d.prepare('SELECT id FROM users LIMIT 1').get() as any).id;
    const wid = d.prepare(
      "INSERT INTO warrants (warrant_number, subject_person_id, type, status, charge_description, entered_by) VALUES ('W-001', ?, 'arrest', 'active', 'Test charge', ?)"
    ).run(personId, uid).lastInsertRowid;

    const res = await request(app)
      .get(`/api/connections/graph?type=person&id=${personId}&depth=2`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.nodes.some((n: any) => n.type === 'warrant' && n.entityId === Number(wid))).toBe(true);
  });

  it('traverses warrant → person via subject_person_id', async () => {
    const d = (await import('../../src/models/database')).getDb();
    const uid = (d.prepare('SELECT id FROM users LIMIT 1').get() as any).id;
    const pRow = d.prepare(
      "INSERT INTO persons (first_name, last_name) VALUES ('Jane', 'Warrant-Subject')"
    ).run();
    const pid = Number(pRow.lastInsertRowid);
    const wid = Number(d.prepare(
      "INSERT INTO warrants (warrant_number, subject_person_id, type, status, charge_description, entered_by) VALUES ('W-002', ?, 'arrest', 'active', 'Test charge', ?)"
    ).run(pid, uid).lastInsertRowid);

    const res = await request(app)
      .get(`/api/connections/graph?type=warrant&id=${wid}&depth=2`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.nodes.some((n: any) => n.type === 'person' && n.entityId === pid)).toBe(true);
  });

  it('traverses person → citation via citations.person_id', async () => {
    const d = (await import('../../src/models/database')).getDb();
    const cid = Number(d.prepare(
      "INSERT INTO citations (citation_number, type, status, person_id, violation_date) VALUES ('C-001', 'traffic', 'issued', ?, '2026-04-19')"
    ).run(personId).lastInsertRowid);

    const res = await request(app)
      .get(`/api/connections/graph?type=person&id=${personId}&depth=2`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.nodes.some((n: any) => n.type === 'citation' && n.entityId === cid)).toBe(true);
  });

  it('traverses vehicle → citation via citations.vehicle_id', async () => {
    const d = (await import('../../src/models/database')).getDb();
    const vid = Number(d.prepare(
      "INSERT INTO vehicles_records (plate_number, state, make, model) VALUES ('ABC123','UT','Ford','F-150')"
    ).run().lastInsertRowid);
    const cid = Number(d.prepare(
      "INSERT INTO citations (citation_number, type, status, vehicle_id, violation_date) VALUES ('C-002', 'traffic', 'issued', ?, '2026-04-19')"
    ).run(vid).lastInsertRowid);

    const res = await request(app)
      .get(`/api/connections/graph?type=vehicle&id=${vid}&depth=2`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.nodes.some((n: any) => n.type === 'citation' && n.entityId === cid)).toBe(true);
  });

  it('traverses citation → person via citations.person_id', async () => {
    const d = (await import('../../src/models/database')).getDb();
    const pid = Number(d.prepare(
      "INSERT INTO persons (first_name, last_name) VALUES ('Cit','Subject')"
    ).run().lastInsertRowid);
    const cid = Number(d.prepare(
      "INSERT INTO citations (citation_number, type, status, person_id, violation_date) VALUES ('C-003', 'traffic', 'issued', ?, '2026-04-19')"
    ).run(pid).lastInsertRowid);

    const res = await request(app)
      .get(`/api/connections/graph?type=citation&id=${cid}&depth=2`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.nodes.some((n: any) => n.type === 'person' && n.entityId === pid)).toBe(true);
  });
});

describe('GET /api/connections/export/csv', () => {
  it('includes edges from incident_persons, not just record_links', async () => {
    const res = await request(app)
      .get('/api/connections/export/csv')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/csv/);
    // Seed data from beforeAll: 1 incident_persons row with role='suspect'
    expect(res.text).toContain('incident_persons');
    expect(res.text).toContain('suspect');
  });
});
