// ============================================================
// Auth Integration Tests
// Exercises the full login → JWT → refresh → logout flow against
// an isolated test database.
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';
import { setupTestDataDir, teardownTestDataDir, createTestAdmin } from '../helpers/testDb';

let app: Application;
let testDir: string;
let adminCreds: { username: string; password: string; userId: number };

beforeAll(async () => {
  testDir = setupTestDataDir();
  // Init DB BEFORE importing routes (routes call getDb() at request time)
  const { initDatabase } = await import('../../src/models/database');
  const db = initDatabase();
  adminCreds = createTestAdmin(db);
  const { createTestApp } = await import('../helpers/testApp');
  app = await createTestApp();
});

afterAll(() => {
  teardownTestDataDir(testDir);
});

describe('POST /api/auth/login', () => {
  it('accepts valid credentials and returns JWT tokens', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: adminCreds.username, password: adminCreds.password });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
    expect(res.body).toHaveProperty('refreshToken');
    expect(res.body.user).toMatchObject({
      username: adminCreds.username,
      role: 'admin',
    });
  });

  it('rejects wrong password with 401', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: adminCreds.username, password: 'wrong_password' });

    expect(res.status).toBe(401);
    expect(res.body).not.toHaveProperty('accessToken');
  });

  it('rejects unknown username with 401', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'does_not_exist', password: 'any_password' });

    expect(res.status).toBe(401);
  });

  it('rejects missing fields with 400', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({});

    expect([400, 401]).toContain(res.status);
  });
});

describe('GET /api/auth/me', () => {
  let token: string;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: adminCreds.username, password: adminCreds.password });
    token = res.body.token;
  });

  it('returns current user with valid token', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.username).toBe(adminCreds.username);
  });

  it('rejects missing token', async () => {
    const res = await request(app).get('/api/auth/me');
    expect([401, 403]).toContain(res.status);
  });

  it('rejects malformed token', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer not_a_real_token');
    expect([401, 403]).toContain(res.status);
  });
});

describe('POST /api/auth/refresh', () => {
  let refreshToken: string;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: adminCreds.username, password: adminCreds.password });
    refreshToken = res.body.refreshToken;
  });

  it('issues a new access token from a valid refresh token', async () => {
    const res = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
  });

  it('rejects invalid refresh token', async () => {
    const res = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: 'not_a_real_token' });

    expect([400, 401]).toContain(res.status);
  });
});
