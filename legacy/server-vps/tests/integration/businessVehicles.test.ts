// ============================================================
// business_vehicles routes integration tests (Task 1.13)
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';
import { setupTestDataDir, teardownTestDataDir, createTestAdmin, createTestOfficer } from '../helpers/testDb';

let app: Application;
let testDir: string;
let adminToken: string;
let officerToken: string;
let bizId: number;
let vehicleId: number;
let vehicleId2: number;

beforeAll(async () => {
  testDir = setupTestDataDir();
  const { initDatabase } = await import('../../src/models/database');
  const db = initDatabase();
  const admin = createTestAdmin(db);
  const officer = createTestOfficer(db);
  db.prepare('UPDATE users SET totp_exempt = 1, must_change_password = 0 WHERE id = ?').run(officer.userId);

  const { createTestApp } = await import('../helpers/testApp');
  app = await createTestApp();

  const adminRes = await request(app).post('/api/auth/login').send({ username: admin.username, password: admin.password });
  adminToken = adminRes.body.token;
  const officerRes = await request(app).post('/api/auth/login').send({ username: officer.username, password: officer.password });
  officerToken = officerRes.body.token;

  const now = new Date().toISOString();
  const bizR = db.prepare('INSERT INTO businesses (name, created_at, updated_at) VALUES (?, ?, ?)')
    .run('Vehicle Co', now, now);
  bizId = Number(bizR.lastInsertRowid);
  const vR = db.prepare('INSERT INTO vehicles_records (plate_number, state, make, model, year, color) VALUES (?, ?, ?, ?, ?, ?)')
    .run('ABC123', 'UT', 'Ford', 'F-150', 2020, 'White');
  vehicleId = Number(vR.lastInsertRowid);
  const v2R = db.prepare('INSERT INTO vehicles_records (plate_number, state, make, model) VALUES (?, ?, ?, ?)')
    .run('XYZ789', 'UT', 'Toyota', 'Camry');
  vehicleId2 = Number(v2R.lastInsertRowid);
});

afterAll(() => {
  teardownTestDataDir(testDir);
});

describe('business_vehicles routes', () => {
  let linkId: number;

  it('POST creates a link', async () => {
    const r = await request(app)
      .post('/api/business-vehicles')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ business_id: bizId, vehicle_id: vehicleId, relationship: 'fleet', notes: 'truck #1' });
    expect(r.status).toBe(201);
    expect(r.body.business_id).toBe(bizId);
    expect(r.body.vehicle_id).toBe(vehicleId);
    expect(r.body.relationship).toBe('fleet');
    expect(r.body.notes).toBe('truck #1');
    linkId = r.body.id;
  });

  it('POST 400 on invalid relationship', async () => {
    const r = await request(app)
      .post('/api/business-vehicles')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ business_id: bizId, vehicle_id: vehicleId2, relationship: 'spaceship' });
    expect(r.status).toBe(400);
    expect(r.body.allowed).toBeDefined();
    expect(Array.isArray(r.body.allowed)).toBe(true);
  });

  it('POST 409 on duplicate', async () => {
    const r = await request(app)
      .post('/api/business-vehicles')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ business_id: bizId, vehicle_id: vehicleId, relationship: 'owner_employee' });
    expect(r.status).toBe(409);
  });

  it('POST 404 on bad business_id', async () => {
    const r = await request(app)
      .post('/api/business-vehicles')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ business_id: 999999, vehicle_id: vehicleId2, relationship: 'fleet' });
    expect(r.status).toBe(404);
  });

  it('POST 404 on bad vehicle_id', async () => {
    const r = await request(app)
      .post('/api/business-vehicles')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ business_id: bizId, vehicle_id: 999999, relationship: 'fleet' });
    expect(r.status).toBe(404);
  });

  it('POST 401 without auth', async () => {
    const r = await request(app)
      .post('/api/business-vehicles')
      .send({ business_id: bizId, vehicle_id: vehicleId2, relationship: 'fleet' });
    expect(r.status).toBe(401);
  });

  it('GET returns linked vehicles with embedded details', async () => {
    const r = await request(app)
      .get(`/api/business-vehicles/${bizId}`)
      .set('Authorization', `Bearer ${officerToken}`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
    const link = r.body.find((row: any) => row.vehicle_id === vehicleId);
    expect(link).toBeDefined();
    expect(link.plate_number).toBe('ABC123');
    expect(link.make).toBe('Ford');
    expect(link.model).toBe('F-150');
    expect(link.relationship).toBe('fleet');
  });

  it('DELETE removes link, vehicle record stays', async () => {
    const r = await request(app)
      .delete(`/api/business-vehicles/${linkId}`)
      .set('Authorization', `Bearer ${officerToken}`);
    expect(r.status).toBe(204);

    const { getDb } = await import('../../src/models/database');
    const db = getDb();
    const linkRow = db.prepare('SELECT id FROM business_vehicles WHERE id = ?').get(linkId);
    expect(linkRow).toBeUndefined();
    const vehicleRow = db.prepare('SELECT id FROM vehicles_records WHERE id = ?').get(vehicleId);
    expect(vehicleRow).toBeDefined();
  });
});
