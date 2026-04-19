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
