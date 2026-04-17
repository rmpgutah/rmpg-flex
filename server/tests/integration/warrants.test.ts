// ============================================================
// Warrants Integration Tests
// Exercises warrant creation, retrieval, person linking, and
// service recording. Warrants was recently overhauled — high
// bug-finding yield expected.
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';
import { setupTestDataDir, teardownTestDataDir, createTestAdmin } from '../helpers/testDb';

let app: Application;
let testDir: string;
let adminToken: string;
let testPersonId: number;

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

  // Create a test person to link warrants to
  const personRes = await request(app)
    .post('/api/records/persons')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      first_name: 'Warrant',
      last_name: 'Subject',
      dob: '1990-01-01',
    });
  testPersonId = personRes.body.id;
});

afterAll(() => {
  teardownTestDataDir(testDir);
});

describe('POST /api/warrants', () => {
  it('creates a warrant with required fields', async () => {
    const res = await request(app)
      .post('/api/warrants')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        type: 'arrest',
        charge_description: 'Failure to appear',
        bail_amount: 1500,
        offense_level: 'misdemeanor',
      });

    expect([200, 201]).toContain(res.status);
    expect(res.body.id).toBeGreaterThan(0);
  });

  it('rejects missing type with 400', async () => {
    const res = await request(app)
      .post('/api/warrants')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ charge_description: 'No type' });

    expect(res.status).toBe(400);
  });

  it('rejects missing charge_description with 400', async () => {
    const res = await request(app)
      .post('/api/warrants')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ type: 'arrest' });

    expect(res.status).toBe(400);
  });

  it('rejects nonexistent subject_person_id with 404', async () => {
    const res = await request(app)
      .post('/api/warrants')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        type: 'arrest',
        charge_description: 'Test',
        subject_person_id: 999999,
      });

    expect(res.status).toBe(404);
  });

  it('creates a warrant linked to a person and persists', async () => {
    const createRes = await request(app)
      .post('/api/warrants')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        type: 'bench',
        charge_description: 'Contempt of court',
        subject_person_id: testPersonId,
        issuing_court: '3rd District',
        issuing_judge: 'Judge Smith',
        bail_amount: 5000,
      });

    expect([200, 201]).toContain(createRes.status);
    const warrantId = createRes.body.id;

    const getRes = await request(app)
      .get(`/api/warrants/${warrantId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body).toMatchObject({
      id: warrantId,
      subject_person_id: testPersonId,
      charge_description: 'Contempt of court',
    });
    expect(String(getRes.body.type).toLowerCase()).toBe('bench');
  });

  it('lists warrants', async () => {
    const res = await request(app)
      .get('/api/warrants')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const list = Array.isArray(res.body) ? res.body : res.body.data || res.body.warrants || [];
    expect(list.length).toBeGreaterThan(0);
  });
});

describe('Warrant person lookup', () => {
  it('checks warrants for a specific person', async () => {
    const res = await request(app)
      .get(`/api/warrants/check/${testPersonId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    // Should return warrants tied to this person (we created one above)
    const warrants = Array.isArray(res.body) ? res.body : res.body.warrants || res.body.data || [];
    expect(warrants.length).toBeGreaterThan(0);
  });
});

describe('PUT /api/warrants/:id/serve', () => {
  let warrantId: number;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/warrants')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        type: 'arrest',
        charge_description: 'Test warrant for service',
        subject_person_id: testPersonId,
        bail_amount: 2500,
      });
    warrantId = res.body.id;
  });

  it('marks a warrant as served', async () => {
    const res = await request(app)
      .put(`/api/warrants/${warrantId}/serve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        served_location: '123 Test St',
        served_notes: 'Served at residence',
      });

    expect([200, 201]).toContain(res.status);
  });
});

describe('GET /api/warrants — filter de-duplication', () => {
  it('applies severity filter exactly once (no doubled WHERE clauses)', async () => {
    // Create two warrants with different offense_level
    await request(app).post('/api/warrants').set('Authorization', `Bearer ${adminToken}`).send({
      type: 'arrest', charge_description: 'Felony filter test', offense_level: 'felony'
    });
    await request(app).post('/api/warrants').set('Authorization', `Bearer ${adminToken}`).send({
      type: 'arrest', charge_description: 'Misdemeanor filter test', offense_level: 'misdemeanor'
    });

    const res = await request(app)
      .get('/api/warrants?severity=felony')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    for (const w of res.body.data) {
      expect(w.offense_level).toBe('felony');
    }
  });

  it('applies source filter exactly once', async () => {
    const res = await request(app)
      .get('/api/warrants?source=manual')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    for (const w of res.body.data) {
      expect(w.source === 'manual' || w.source === null).toBe(true);
    }
  });
});
