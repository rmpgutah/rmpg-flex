// ============================================================
// Citations Integration Tests
// Exercises citation creation, retrieval, and payment recording.
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

describe('POST /api/citations', () => {
  it('creates a traffic citation with required fields', async () => {
    const res = await request(app)
      .post('/api/citations')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        type: 'traffic',
        violation_description: 'Speeding 15 over',
        violation_date: '2026-04-10',
        violation_time: '14:30',
        location: '400 S State St, SLC, UT',
        person_name: 'John Citation',
        person_dl: 'UT12345',
        fine_amount: 150,
      });

    expect([200, 201]).toContain(res.status);
    // Citations routes wrap responses in { data: ... }
    expect(res.body.data).toMatchObject({
      type: 'traffic',
      violation_description: 'Speeding 15 over',
    });
    expect(res.body.data.id).toBeGreaterThan(0);
  });

  it('rejects missing violation_description with 400', async () => {
    const res = await request(app)
      .post('/api/citations')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ type: 'traffic', violation_date: '2026-04-10' });

    expect(res.status).toBe(400);
  });

  it('rejects missing violation_date with 400', async () => {
    const res = await request(app)
      .post('/api/citations')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ type: 'traffic', violation_description: 'Test' });

    expect(res.status).toBe(400);
  });

  it('rejects invalid type with 400', async () => {
    const res = await request(app)
      .post('/api/citations')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        type: 'not_a_valid_type',
        violation_description: 'Test',
        violation_date: '2026-04-10',
      });

    expect(res.status).toBe(400);
  });

  it('persists the created citation and makes it retrievable', async () => {
    const createRes = await request(app)
      .post('/api/citations')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        type: 'parking',
        violation_description: 'Expired meter',
        violation_date: '2026-04-10',
        location: '100 Main St',
        fine_amount: 35,
      });

    expect([200, 201]).toContain(createRes.status);
    const citationId = createRes.body.data.id;

    const getRes = await request(app)
      .get(`/api/citations/${citationId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body.data.violation_description).toBe('Expired meter');
    expect(getRes.body.data.type).toBe('parking');
  });

  it('lists all citations', async () => {
    const res = await request(app)
      .get('/api/citations')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const list = Array.isArray(res.body) ? res.body : res.body.data || res.body.citations || [];
    expect(list.length).toBeGreaterThan(0);
  });
});

describe('Citation payments', () => {
  let citationId: number;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/citations')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        type: 'traffic',
        violation_description: 'Payment test citation',
        violation_date: '2026-04-10',
        fine_amount: 200,
      });
    citationId = res.body.data.id;
  });

  it('records a payment against a citation', async () => {
    const res = await request(app)
      .post(`/api/citations/${citationId}/payments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        amount: 200,
        payment_method: 'credit_card',
        payment_date: '2026-04-10',
      });

    expect([200, 201]).toContain(res.status);
  });

  it('retrieves payments for a citation', async () => {
    const res = await request(app)
      .get(`/api/citations/${citationId}/payments`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    // GET /citations/:id/payments returns { data: { payments, total_amount, total_paid, remaining } }
    expect(res.body.data.payments.length).toBeGreaterThan(0);
    expect(res.body.data.total_paid).toBe(200);
  });
});
