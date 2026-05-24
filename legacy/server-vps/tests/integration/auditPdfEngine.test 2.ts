import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';
import { setupTestDataDir, teardownTestDataDir, createTestAdmin } from '../helpers/testDb';

let app: Application;
let testDir: string;
let adminToken: string;

beforeAll(async () => {
  testDir = setupTestDataDir();
  const { initDatabase } = await import('../../src/models/database');
  const db = initDatabase();
  const admin = createTestAdmin(db);
  const { createTestApp } = await import('../helpers/testApp');
  app = await createTestApp();

  const loginRes = await request(app)
    .post('/api/auth/login')
    .send({ username: admin.username, password: admin.password });
  adminToken = loginRes.body.token;
});

afterAll(() => { teardownTestDataDir(testDir); });

describe('POST /api/audit/pdf-engine-fallback', () => {
  it('records a fallback event and returns 200', async () => {
    const res = await request(app)
      .post('/api/audit/pdf-engine-fallback')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ formType: 'warrant', message: 'schema exploded' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns 400 when formType is missing', async () => {
    const res = await request(app)
      .post('/api/audit/pdf-engine-fallback')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ message: 'no form' });
    expect(res.status).toBe(400);
  });

  it('requires authentication', async () => {
    const res = await request(app)
      .post('/api/audit/pdf-engine-fallback')
      .send({ formType: 'warrant', message: 'err' });
    expect(res.status).toBe(401);
  });
});
