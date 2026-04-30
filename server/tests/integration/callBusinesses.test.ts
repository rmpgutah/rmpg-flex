// ============================================================
// call_businesses linking integration tests (Task 1.11)
// Covers POST/PUT/DELETE /api/dispatch/calls/:id/businesses
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';
import { setupTestDataDir, teardownTestDataDir, createTestAdmin, createTestOfficer } from '../helpers/testDb';

let app: Application;
let testDir: string;
let officerToken: string;
let callId: number;
let businessId: number;
let secondBusinessId: number;
let createdLinkId: number;
let arbitraryRoleLinkId: number;

beforeAll(async () => {
  testDir = setupTestDataDir();
  const { initDatabase } = await import('../../src/models/database');
  const db = initDatabase();
  createTestAdmin(db);
  const officer = createTestOfficer(db);
  db.prepare('UPDATE users SET totp_exempt = 1, must_change_password = 0 WHERE id = ?').run(officer.userId);

  const { createTestApp } = await import('../helpers/testApp');
  app = await createTestApp();

  const officerRes = await request(app)
    .post('/api/auth/login')
    .send({ username: officer.username, password: officer.password });
  officerToken = officerRes.body.token;

  const now = new Date().toISOString();
  // calls_for_service: incident_type, priority (P1-P4), location_address required
  const callR = db.prepare(`INSERT INTO calls_for_service (call_number, incident_type, priority, location_address, created_at)
    VALUES (?, ?, ?, ?, ?)`).run('CFS-CBT-001', 'theft', 'P3', '300 Test St', now);
  callId = Number(callR.lastInsertRowid);

  const bR = db.prepare('INSERT INTO businesses (name, created_at, updated_at) VALUES (?, ?, ?)').run('CallBiz One', now, now);
  businessId = Number(bR.lastInsertRowid);
  const bR2 = db.prepare('INSERT INTO businesses (name, created_at, updated_at) VALUES (?, ?, ?)').run('CallBiz Two', now, now);
  secondBusinessId = Number(bR2.lastInsertRowid);
});

afterAll(() => {
  teardownTestDataDir(testDir);
});

describe('call_businesses linking (Task 1.11)', () => {
  it('POST creates a link', async () => {
    const r = await request(app)
      .post(`/api/dispatch/calls/${callId}/businesses`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ business_id: businessId, role: 'victim', notes: 'on scene' });
    expect(r.status).toBe(201);
    expect(r.body.role).toBe('victim');
    expect(r.body.call_id).toBe(callId);
    expect(r.body.business_id).toBe(businessId);
    expect(r.body.notes).toBe('on scene');
    createdLinkId = r.body.id;
  });

  it('POST 409 on duplicate (call, business)', async () => {
    const r = await request(app)
      .post(`/api/dispatch/calls/${callId}/businesses`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ business_id: businessId, role: 'witness' });
    expect(r.status).toBe(409);
  });

  it('POST 404 on bad call_id', async () => {
    const r = await request(app)
      .post(`/api/dispatch/calls/999999/businesses`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ business_id: businessId, role: 'victim' });
    expect(r.status).toBe(404);
  });

  it('POST 404 on bad business_id', async () => {
    const r = await request(app)
      .post(`/api/dispatch/calls/${callId}/businesses`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ business_id: 999999, role: 'victim' });
    expect(r.status).toBe(404);
  });

  it('POST 401 without auth', async () => {
    const r = await request(app)
      .post(`/api/dispatch/calls/${callId}/businesses`)
      .send({ business_id: secondBusinessId, role: 'victim' });
    expect(r.status).toBe(401);
  });

  it('POST accepts arbitrary role string (no validation)', async () => {
    const r = await request(app)
      .post(`/api/dispatch/calls/${callId}/businesses`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ business_id: secondBusinessId, role: 'primary_complainant' });
    expect(r.status).toBe(201);
    expect(r.body.role).toBe('primary_complainant');
    arbitraryRoleLinkId = r.body.id;
  });

  it('PUT updates role and notes', async () => {
    const r = await request(app)
      .put(`/api/dispatch/calls/${callId}/businesses/${createdLinkId}`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ role: 'witness', notes: 'updated' });
    expect(r.status).toBe(200);
    expect(r.body.role).toBe('witness');
    expect(r.body.notes).toBe('updated');
  });

  it('PUT 404 on bad linkId', async () => {
    const r = await request(app)
      .put(`/api/dispatch/calls/${callId}/businesses/999999`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ role: 'victim' });
    expect(r.status).toBe(404);
  });

  it('DELETE removes link', async () => {
    const { getDb } = await import('../../src/models/database');
    const db = getDb();
    const r = await request(app)
      .delete(`/api/dispatch/calls/${callId}/businesses/${createdLinkId}`)
      .set('Authorization', `Bearer ${officerToken}`);
    expect(r.status).toBe(204);
    expect(db.prepare('SELECT id FROM call_businesses WHERE id = ?').get(createdLinkId)).toBeUndefined();
    // Call + business records untouched
    expect(db.prepare('SELECT id FROM calls_for_service WHERE id = ?').get(callId)).toBeDefined();
    expect(db.prepare('SELECT id FROM businesses WHERE id = ?').get(businessId)).toBeDefined();
  });

  it('DELETE 404 on bad linkId', async () => {
    const r = await request(app)
      .delete(`/api/dispatch/calls/${callId}/businesses/999999`)
      .set('Authorization', `Bearer ${officerToken}`);
    expect(r.status).toBe(404);
  });
});
