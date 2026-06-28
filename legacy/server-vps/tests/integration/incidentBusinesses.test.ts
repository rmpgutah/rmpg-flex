// ============================================================
// incident_businesses linking integration tests (Task 1.10)
// Covers POST/PUT/DELETE /api/incidents/:id/businesses
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';
import { setupTestDataDir, teardownTestDataDir, createTestAdmin, createTestOfficer } from '../helpers/testDb';

let app: Application;
let testDir: string;
let officerToken: string;
let officerUserId: number;
let incidentId: number;
let otherIncidentId: number;
let businessId: number;
let secondBusinessId: number;
let createdLinkId: number;

beforeAll(async () => {
  testDir = setupTestDataDir();
  const { initDatabase } = await import('../../src/models/database');
  const db = initDatabase();
  createTestAdmin(db);
  const officer = createTestOfficer(db);
  officerUserId = officer.userId;
  db.prepare('UPDATE users SET totp_exempt = 1, must_change_password = 0 WHERE id = ?').run(officer.userId);

  const { createTestApp } = await import('../helpers/testApp');
  app = await createTestApp();

  const officerRes = await request(app)
    .post('/api/auth/login')
    .send({ username: officer.username, password: officer.password });
  officerToken = officerRes.body.token;

  const now = new Date().toISOString();
  // Seed incidents
  const incR = db.prepare(`INSERT INTO incidents (incident_number, incident_type, status, officer_id, location_address, created_at, updated_at)
    VALUES (?, ?, 'draft', ?, ?, ?, ?)`).run('IBT-001', 'theft', officer.userId, '100 Main St', now, now);
  incidentId = Number(incR.lastInsertRowid);
  const incR2 = db.prepare(`INSERT INTO incidents (incident_number, incident_type, status, officer_id, location_address, created_at, updated_at)
    VALUES (?, ?, 'draft', ?, ?, ?, ?)`).run('IBT-002', 'theft', officer.userId, '200 Main St', now, now);
  otherIncidentId = Number(incR2.lastInsertRowid);

  // Seed businesses
  const bR = db.prepare('INSERT INTO businesses (name, created_at, updated_at) VALUES (?, ?, ?)').run('Acme LLC', now, now);
  businessId = Number(bR.lastInsertRowid);
  const bR2 = db.prepare('INSERT INTO businesses (name, created_at, updated_at) VALUES (?, ?, ?)').run('Globex Corp', now, now);
  secondBusinessId = Number(bR2.lastInsertRowid);
});

afterAll(() => {
  teardownTestDataDir(testDir);
});

describe('incident_businesses linking (Task 1.10)', () => {
  it('POST creates a link', async () => {
    const r = await request(app)
      .post(`/api/incidents/${incidentId}/businesses`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ business_id: businessId, role: 'victim', notes: 'reported theft' });
    expect(r.status).toBe(201);
    expect(r.body.role).toBe('victim');
    expect(r.body.incident_id).toBe(incidentId);
    expect(r.body.business_id).toBe(businessId);
    expect(r.body.notes).toBe('reported theft');
    createdLinkId = r.body.id;
  });

  it('POST returns 400 on invalid role', async () => {
    const r = await request(app)
      .post(`/api/incidents/${incidentId}/businesses`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ business_id: secondBusinessId, role: 'kingmaker' });
    expect(r.status).toBe(400);
    expect(Array.isArray(r.body.allowed)).toBe(true);
  });

  it('POST returns 409 on duplicate (incident, business)', async () => {
    const r = await request(app)
      .post(`/api/incidents/${incidentId}/businesses`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ business_id: businessId, role: 'witness' });
    expect(r.status).toBe(409);
  });

  it('POST returns 404 when incident not found', async () => {
    const r = await request(app)
      .post(`/api/incidents/999999/businesses`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ business_id: businessId, role: 'victim' });
    expect(r.status).toBe(404);
  });

  it('POST returns 404 when business not found', async () => {
    const r = await request(app)
      .post(`/api/incidents/${incidentId}/businesses`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ business_id: 999999, role: 'victim' });
    expect(r.status).toBe(404);
  });

  it('POST requires auth', async () => {
    const r = await request(app)
      .post(`/api/incidents/${incidentId}/businesses`)
      .send({ business_id: secondBusinessId, role: 'victim' });
    expect(r.status).toBe(401);
  });

  it('PUT updates role', async () => {
    const r = await request(app)
      .put(`/api/incidents/${incidentId}/businesses/${createdLinkId}`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ role: 'witness', notes: 'changed status' });
    expect(r.status).toBe(200);
    expect(r.body.role).toBe('witness');
    expect(r.body.notes).toBe('changed status');
  });

  it('PUT 404 on bad linkId', async () => {
    const r = await request(app)
      .put(`/api/incidents/${incidentId}/businesses/999999`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ role: 'victim' });
    expect(r.status).toBe(404);
  });

  it('PUT 404 when linkId belongs to different incident', async () => {
    const r = await request(app)
      .put(`/api/incidents/${otherIncidentId}/businesses/${createdLinkId}`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ role: 'victim' });
    expect(r.status).toBe(404);
  });

  it('PUT 400 on invalid role', async () => {
    const r = await request(app)
      .put(`/api/incidents/${incidentId}/businesses/${createdLinkId}`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ role: 'kingmaker' });
    expect(r.status).toBe(400);
  });

  it('DELETE removes link, incident + business records untouched', async () => {
    const { getDb } = await import('../../src/models/database');
    const db = getDb();
    const r = await request(app)
      .delete(`/api/incidents/${incidentId}/businesses/${createdLinkId}`)
      .set('Authorization', `Bearer ${officerToken}`);
    expect(r.status).toBe(204);
    expect(r.body).toEqual({});

    expect(db.prepare('SELECT id FROM incident_businesses WHERE id = ?').get(createdLinkId)).toBeUndefined();
    expect(db.prepare('SELECT id FROM incidents WHERE id = ?').get(incidentId)).toBeDefined();
    expect(db.prepare('SELECT id FROM businesses WHERE id = ?').get(businessId)).toBeDefined();
  });

  it('DELETE 404 on bad linkId', async () => {
    const r = await request(app)
      .delete(`/api/incidents/${incidentId}/businesses/999999`)
      .set('Authorization', `Bearer ${officerToken}`);
    expect(r.status).toBe(404);
  });
});
