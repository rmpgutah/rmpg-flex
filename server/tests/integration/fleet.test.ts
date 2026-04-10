// ============================================================
// Fleet Integration Tests
// Exercises fleet vehicle CRUD + maintenance records. Does NOT
// cover dashcam/upload routes (multer testing is complex in
// supertest without a real file fixture).
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

describe('POST /api/fleet', () => {
  it('creates a fleet vehicle with required fields', async () => {
    const res = await request(app)
      .post('/api/fleet')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        vehicle_number: 'F-100',
        make: 'Ford',
        model: 'Explorer',
        year: 2023,
        color: 'Black',
        plate_number: 'RMPG100',
        plate_state: 'UT',
        current_mileage: 12000,
      });

    expect([200, 201]).toContain(res.status);
    expect(res.body.id).toBeGreaterThan(0);
    expect(res.body.vehicle_number).toBe('F-100');
  });

  it('rejects missing vehicle_number with 400', async () => {
    const res = await request(app)
      .post('/api/fleet')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ make: 'Ford', model: 'Explorer' });

    expect(res.status).toBe(400);
  });

  it('rejects duplicate vehicle_number with 409', async () => {
    const res = await request(app)
      .post('/api/fleet')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ vehicle_number: 'F-100', make: 'Ford' });

    expect(res.status).toBe(409);
  });

  it('persists vehicle and makes it retrievable', async () => {
    const createRes = await request(app)
      .post('/api/fleet')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        vehicle_number: 'F-200',
        make: 'Chevrolet',
        model: 'Tahoe',
        year: 2024,
        current_mileage: 500,
      });

    expect([200, 201]).toContain(createRes.status);
    const vehicleId = createRes.body.id;

    const getRes = await request(app)
      .get(`/api/fleet/${vehicleId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body.vehicle_number).toBe('F-200');
    expect(getRes.body.make).toBe('Chevrolet');
  });

  it('lists all fleet vehicles', async () => {
    const res = await request(app)
      .get('/api/fleet')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const list = Array.isArray(res.body) ? res.body : res.body.data || res.body.vehicles || [];
    expect(list.length).toBeGreaterThan(0);
  });
});

describe('Fleet maintenance records', () => {
  let vehicleId: number;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/fleet')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        vehicle_number: 'F-300',
        make: 'Ford',
        model: 'F-150',
        year: 2022,
      });
    vehicleId = res.body.id;
  });

  it('records a maintenance entry', async () => {
    const res = await request(app)
      .post(`/api/fleet/${vehicleId}/maintenance`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        type: 'oil_change',
        description: 'Synthetic oil change + filter',
        performed_at: '2026-04-10',
        mileage_at_service: 15000,
        cost: 89.99,
        vendor: 'Quick Lube',
      });

    expect([200, 201]).toContain(res.status);
    expect(res.body.id).toBeGreaterThan(0);
  });

  it('rejects missing description with 400', async () => {
    const res = await request(app)
      .post(`/api/fleet/${vehicleId}/maintenance`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ type: 'oil_change', cost: 50 });

    expect(res.status).toBe(400);
  });

  it('lists maintenance records for a vehicle', async () => {
    const res = await request(app)
      .get(`/api/fleet/${vehicleId}/maintenance`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const list = Array.isArray(res.body) ? res.body : res.body.data || res.body.maintenance || [];
    expect(list.length).toBeGreaterThan(0);
  });
});
