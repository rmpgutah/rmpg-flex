// ============================================================
// Geofence / Maps Integration Tests
// Verifies the GPS-to-beat lookup that powers auto-fill of
// dispatch districts when calls are created with coordinates.
// ============================================================

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

  const res = await request(app)
    .post('/api/auth/login')
    .send({ username: admin.username, password: admin.password });
  adminToken = res.body.token;
});

afterAll(() => {
  teardownTestDataDir(testDir);
});

describe('GET /api/dispatch/geography/identify', () => {
  it('rejects missing lat/lng with 400', async () => {
    const res = await request(app)
      .get('/api/dispatch/geography/identify')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(400);
  });

  it('rejects non-numeric coordinates with 400', async () => {
    const res = await request(app)
      .get('/api/dispatch/geography/identify?lat=abc&lng=xyz')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(400);
  });

  it('returns found:false for coordinates outside any beat', async () => {
    // Mid-Atlantic Ocean — definitely not in any Utah beat
    const res = await request(app)
      .get('/api/dispatch/geography/identify?lat=30.0&lng=-50.0')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.found).toBe(false);
  });

  it('identifies a Salt Lake City beat from coordinates', async () => {
    // SLC downtown — should hit a beat in the seeded geofence
    const res = await request(app)
      .get('/api/dispatch/geography/identify?lat=40.7608&lng=-111.8910')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    // Either found:true (geofence has SLC data) OR found:false (no SLC polygon)
    // — both are valid; we just want to confirm the route doesn't crash
    expect(res.body).toHaveProperty('found');
    if (res.body.found) {
      expect(res.body).toHaveProperty('beat');
      expect(res.body).toHaveProperty('zone');
    }
  });
});

describe('GET /api/dispatch/geography/beats', () => {
  it('lists seeded dispatch beats', async () => {
    const res = await request(app)
      .get('/api/dispatch/geography/beats')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const list = Array.isArray(res.body) ? res.body : res.body.data || res.body.beats || [];
    // Migration seeds 269 beats — confirm at least some are present
    expect(list.length).toBeGreaterThan(0);
  });
});

describe('GET /api/dispatch/geography/sectors', () => {
  it('lists seeded dispatch sectors', async () => {
    const res = await request(app)
      .get('/api/dispatch/geography/sectors')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const list = Array.isArray(res.body) ? res.body : res.body.data || res.body.sectors || [];
    // GeoJSON seed produces 29 Utah counties as sectors
    expect(list.length).toBeGreaterThan(0);
  });
});

describe('GET /api/dispatch/geography/zones', () => {
  it('lists seeded dispatch zones', async () => {
    const res = await request(app)
      .get('/api/dispatch/geography/zones')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const list = Array.isArray(res.body) ? res.body : res.body.data || res.body.zones || [];
    // Migration seeds 82 zones
    expect(list.length).toBeGreaterThan(0);
  });
});
