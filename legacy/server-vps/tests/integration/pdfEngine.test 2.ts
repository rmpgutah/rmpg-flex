import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';
import { setupTestDataDir, teardownTestDataDir, createTestAdmin, createTestOfficer } from '../helpers/testDb';

let app: Application;
let testDir: string;
let adminToken: string;
let officerToken: string;

beforeAll(async () => {
  testDir = setupTestDataDir();
  const { initDatabase } = await import('../../src/models/database');
  const db = initDatabase();
  const admin = createTestAdmin(db);
  const officer = createTestOfficer(db);
  const { createTestApp } = await import('../helpers/testApp');
  app = await createTestApp();

  const adminRes = await request(app)
    .post('/api/auth/login')
    .send({ username: admin.username, password: admin.password });
  adminToken = adminRes.body.token;
  const officerRes = await request(app)
    .post('/api/auth/login')
    .send({ username: officer.username, password: officer.password });
  officerToken = officerRes.body.token;
});

afterAll(() => { teardownTestDataDir(testDir); });

describe('PDF engine feature flags', () => {
  it('GET /api/admin/pdf-engine/flags returns all forms defaulted to false', async () => {
    const res = await request(app)
      .get('/api/admin/pdf-engine/flags')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.call).toBe(false);
    expect(res.body.warrant).toBe(false);
    expect(res.body.incident_blank).toBe(false);
  });

  it('PUT /api/admin/pdf-engine/flags/:form flips a flag and persists', async () => {
    const put = await request(app)
      .put('/api/admin/pdf-engine/flags/warrant')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ enabled: true });
    expect(put.status).toBe(200);
    expect(put.body.success).toBe(true);
    expect(put.body.enabled).toBe(true);

    const get = await request(app)
      .get('/api/admin/pdf-engine/flags')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(get.body.warrant).toBe(true);
  });

  it('PUT /api/admin/pdf-engine/flags/:form rejects non-admin with 403', async () => {
    const res = await request(app)
      .put('/api/admin/pdf-engine/flags/citation')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ enabled: true });
    expect(res.status).toBe(403);
  });

  it('PUT /api/admin/pdf-engine/flags/:form returns 400 for unknown form', async () => {
    const res = await request(app)
      .put('/api/admin/pdf-engine/flags/not_a_real_form')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ enabled: true });
    expect(res.status).toBe(400);
  });

  it('PUT /api/admin/pdf-engine/revert-all resets all flags to false', async () => {
    // Enable something first
    await request(app)
      .put('/api/admin/pdf-engine/flags/citation')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ enabled: true });

    const revert = await request(app)
      .put('/api/admin/pdf-engine/revert-all')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(revert.status).toBe(200);
    expect(revert.body.success).toBe(true);

    const flags = await request(app)
      .get('/api/admin/pdf-engine/flags')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(flags.body.warrant).toBe(false);
    expect(flags.body.citation).toBe(false);
  });
});
