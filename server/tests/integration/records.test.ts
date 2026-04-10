// ============================================================
// Records Integration Tests
// Exercises persons, vehicles, and incidents CRUD — core data
// entry workflows for the RMS side of the system.
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

describe('POST /api/records/persons', () => {
  it('creates a person with required fields', async () => {
    const res = await request(app)
      .post('/api/records/persons')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        first_name: 'John',
        last_name: 'Doe',
        dob: '1985-06-15',
        gender: 'M',
        race: 'W',
      });

    expect([200, 201]).toContain(res.status);
    expect(res.body).toMatchObject({
      first_name: 'John',
      last_name: 'Doe',
    });
    expect(res.body.id).toBeGreaterThan(0);
  });

  it('rejects missing first_name with 400', async () => {
    const res = await request(app)
      .post('/api/records/persons')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ last_name: 'NoFirstName' });

    expect(res.status).toBe(400);
  });

  it('persists the created person and makes it retrievable', async () => {
    const createRes = await request(app)
      .post('/api/records/persons')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        first_name: 'Jane',
        last_name: 'PersistTest',
        address: '555 Retrieve Ave',
        city: 'SLC',
        state: 'UT',
        zip: '84101',
      });

    expect([200, 201]).toContain(createRes.status);
    const personId = createRes.body.id;

    const getRes = await request(app)
      .get(`/api/records/persons/${personId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body).toMatchObject({
      id: personId,
      first_name: 'Jane',
      last_name: 'PersistTest',
      address: '555 Retrieve Ave',
    });
  });

  it('lists all persons', async () => {
    const res = await request(app)
      .get('/api/records/persons')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const list = Array.isArray(res.body) ? res.body : res.body.data || res.body.persons || [];
    expect(list.length).toBeGreaterThan(0);
  });
});

describe('POST /api/records/vehicles', () => {
  it('creates a vehicle record', async () => {
    const res = await request(app)
      .post('/api/records/vehicles')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        plate_number: 'TEST123',
        state: 'UT',
        make: 'Ford',
        model: 'F-150',
        year: 2020,
        color: 'Blue',
      });

    expect([200, 201]).toContain(res.status);
    expect(res.body.id).toBeGreaterThan(0);
  });

  it('persists and retrieves a vehicle', async () => {
    const createRes = await request(app)
      .post('/api/records/vehicles')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        plate_number: 'PERS456',
        state: 'UT',
        make: 'Toyota',
        model: 'Camry',
        year: 2022,
        color: 'Silver',
      });

    expect([200, 201]).toContain(createRes.status);
    const vehicleId = createRes.body.id;

    const getRes = await request(app)
      .get(`/api/records/vehicles/${vehicleId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body.plate_number).toBe('PERS456');
    expect(getRes.body.make).toBe('Toyota');
  });
});

describe('POST /api/incidents', () => {
  it('creates an incident with required fields', async () => {
    const res = await request(app)
      .post('/api/incidents')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        incident_type: 'trespass',
        location_address: '888 Incident Way, SLC, UT',
        narrative: 'Test incident for integration test',
      });

    expect([200, 201]).toContain(res.status);
    expect(res.body).toMatchObject({
      incident_type: 'trespass',
    });
    expect(res.body.id).toBeGreaterThan(0);
    expect(res.body.incident_number).toBeTruthy();
  });

  it('rejects missing incident_type with 400', async () => {
    const res = await request(app)
      .post('/api/incidents')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ location_address: '123 Somewhere' });

    expect(res.status).toBe(400);
  });

  it('persists the created incident and makes it retrievable', async () => {
    const createRes = await request(app)
      .post('/api/incidents')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        incident_type: 'theft',
        location_address: '777 Persist Blvd, SLC, UT',
        narrative: 'Persistence check',
      });

    expect([200, 201]).toContain(createRes.status);
    const incidentId = createRes.body.id;

    const getRes = await request(app)
      .get(`/api/incidents/${incidentId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body.incident_type).toBe('theft');
  });
});

describe('Link persons to incidents', () => {
  let incidentId: number;
  let personId: number;

  beforeAll(async () => {
    const incidentRes = await request(app)
      .post('/api/incidents')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        incident_type: 'disturbance',
        location_address: '999 Link Test Rd',
        narrative: 'Link test',
      });
    incidentId = incidentRes.body.id;

    const personRes = await request(app)
      .post('/api/records/persons')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ first_name: 'Link', last_name: 'Person' });
    personId = personRes.body.id;
  });

  it('links a person to an incident', async () => {
    const res = await request(app)
      .post(`/api/incidents/${incidentId}/persons`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        person_id: personId,
        role: 'suspect',
      });

    expect([200, 201]).toContain(res.status);
  });
});
