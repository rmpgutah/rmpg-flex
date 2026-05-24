// ============================================================
// Dispatch Integration Tests
// Exercises the full dispatch workflow: create unit → create call
// → dispatch → assign unit → status transitions → clear.
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';
import { setupTestDataDir, teardownTestDataDir, createTestAdmin, createTestOfficer } from '../helpers/testDb';

let app: Application;
let testDir: string;
let adminToken: string;
let officerToken: string;
let officerId: number;

beforeAll(async () => {
  testDir = setupTestDataDir();
  const { initDatabase } = await import('../../src/models/database');
  const db = initDatabase();
  const admin = createTestAdmin(db);
  const officer = createTestOfficer(db);
  // Officer also needs 2FA exemption and no password change
  db.prepare('UPDATE users SET totp_exempt = 1, must_change_password = 0 WHERE id = ?').run(officer.userId);
  officerId = officer.userId;

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

afterAll(() => {
  teardownTestDataDir(testDir);
});

describe('Units: POST /api/dispatch/units', () => {
  it('creates a unit with required fields', async () => {
    const res = await request(app)
      .post('/api/dispatch/units')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ call_sign: 'T101', officer_id: officerId, status: 'available' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      call_sign: 'T101',
      status: 'available',
    });
    expect(res.body.id).toBeGreaterThan(0);
  });

  it('rejects duplicate call_sign with 409', async () => {
    const res = await request(app)
      .post('/api/dispatch/units')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ call_sign: 'T101', status: 'available' });

    expect(res.status).toBe(409);
  });

  it('rejects missing call_sign with 400', async () => {
    const res = await request(app)
      .post('/api/dispatch/units')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'available' });

    expect(res.status).toBe(400);
  });

  it('lists all units', async () => {
    const res = await request(app)
      .get('/api/dispatch/units')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body) || Array.isArray(res.body.data) || Array.isArray(res.body.units)).toBe(true);
  });
});

describe('Calls: POST /api/dispatch/calls', () => {
  it('creates a call with required fields and returns 201', async () => {
    const res = await request(app)
      .post('/api/dispatch/calls')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        incident_type: 'suspicious_activity',
        priority: 'P2',
        location_address: '123 Test St, Salt Lake City, UT',
        caller_name: 'Test Caller',
        caller_phone: '801-555-0100',
        description: 'Test call from integration test',
      });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      incident_type: 'suspicious_activity',
      location_address: '123 Test St, Salt Lake City, UT',
    });
    expect(String(res.body.priority).toUpperCase()).toBe('P2');
    expect(res.body.id).toBeGreaterThan(0);
    expect(res.body.call_number).toBeTruthy();
  });

  it('rejects missing incident_type with 400', async () => {
    const res = await request(app)
      .post('/api/dispatch/calls')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ priority: 'P2', location_address: '456 Main St' });

    expect(res.status).toBe(400);
  });

  it('rejects short location_address with 400', async () => {
    const res = await request(app)
      .post('/api/dispatch/calls')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ incident_type: 'welfare_check', priority: 'P3', location_address: 'AB' });

    expect(res.status).toBe(400);
  });

  it('rejects invalid latitude with 400', async () => {
    const res = await request(app)
      .post('/api/dispatch/calls')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        incident_type: 'alarm_response',
        priority: 'P1',
        location_address: '789 Center St, SLC, UT',
        latitude: 999,
        longitude: -111,
      });

    expect(res.status).toBe(400);
  });

  it('persists the created call and makes it retrievable by ID', async () => {
    const createRes = await request(app)
      .post('/api/dispatch/calls')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        incident_type: 'trespass',
        priority: 'P3',
        location_address: '100 Retrieve St, SLC, UT',
        description: 'Persistence test',
      });

    expect(createRes.status).toBe(201);
    const callId = createRes.body.id;

    const getRes = await request(app)
      .get(`/api/dispatch/calls/${callId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body).toMatchObject({
      id: callId,
      incident_type: 'trespass',
      location_address: '100 Retrieve St, SLC, UT',
    });
  });
});

describe('Call lifecycle: dispatch → assign → status → clear', () => {
  let callId: number;
  let unitId: number;

  beforeAll(async () => {
    // Create a fresh call
    const callRes = await request(app)
      .post('/api/dispatch/calls')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        incident_type: 'disturbance',
        priority: 'P2',
        location_address: '200 Lifecycle Ave, SLC, UT',
      });
    callId = callRes.body.id;

    // Create a unit
    const unitRes = await request(app)
      .post('/api/dispatch/units')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ call_sign: 'L202', officer_id: officerId, status: 'available' });
    unitId = unitRes.body.id;
  });

  it('assigns a unit to the call', async () => {
    const res = await request(app)
      .post(`/api/dispatch/calls/${callId}/assign-unit`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ unit_id: unitId });

    expect([200, 201]).toContain(res.status);
  });

  it('transitions the call to enroute', async () => {
    const res = await request(app)
      .post(`/api/dispatch/calls/${callId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'enroute' });

    expect([200, 201]).toContain(res.status);
  });

  it('transitions the call to onscene', async () => {
    const res = await request(app)
      .post(`/api/dispatch/calls/${callId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'onscene' });

    expect([200, 201]).toContain(res.status);
  });

  it('transitions the call to cleared', async () => {
    const res = await request(app)
      .post(`/api/dispatch/calls/${callId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'cleared', disposition: 'resolved' });

    expect([200, 201]).toContain(res.status);
  });

  it('persists the cleared status on retrieval', async () => {
    const res = await request(app)
      .get(`/api/dispatch/calls/${callId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(['cleared', 'closed']).toContain(res.body.status);
  });
});

describe('Unit status updates', () => {
  let unitId: number;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/dispatch/units')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ call_sign: 'S303', officer_id: officerId, status: 'available' });
    unitId = res.body.id;
  });

  it('updates unit status via PUT /units/:id/status', async () => {
    const res = await request(app)
      .put(`/api/dispatch/units/${unitId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'busy' });

    expect([200, 201]).toContain(res.status);
  });

  it('persists the new status on retrieval', async () => {
    const res = await request(app)
      .get('/api/dispatch/units')
      .set('Authorization', `Bearer ${adminToken}`);

    const units = Array.isArray(res.body) ? res.body : res.body.data || res.body.units || [];
    const unit = units.find((u: any) => u.id === unitId);
    expect(unit).toBeTruthy();
    expect(unit.status).toBe('busy');
  });
});
