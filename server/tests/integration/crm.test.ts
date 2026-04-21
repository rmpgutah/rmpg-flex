// ============================================================
// CRM Integration Tests
// Exercises CRM lead creation, retrieval, and pipeline stages.
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

describe('POST /api/crm-leads/leads', () => {
  it('creates a lead with only the required business_name', async () => {
    // This test probes whether optional validateStr calls improperly reject
    // requests that don't include every field. If the bug is present, this
    // will return 400 "contact_name is required" etc.
    const res = await request(app)
      .post('/api/crm-leads/leads')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        business_name: 'Acme Corp',
      });

    expect([200, 201]).toContain(res.status);
  });

  it('creates a lead with full optional fields', async () => {
    const res = await request(app)
      .post('/api/crm-leads/leads')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        business_name: 'Full Lead Co',
        contact_name: 'Jane Manager',
        contact_email: 'jane@full.co',
        contact_phone: '801-555-0200',
        contact_title: 'Facilities Manager',
        address: '100 Main St',
        city: 'Salt Lake City',
        state: 'UT',
        zip: '84111',
        estimated_value: 50000,
        industry: 'retail',
        source: 'manual',
      });

    expect([200, 201]).toContain(res.status);
    expect(res.body.id || res.body.data?.id).toBeGreaterThan(0);
  });

  it('rejects missing business_name with 400', async () => {
    const res = await request(app)
      .post('/api/crm-leads/leads')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ contact_name: 'No Business' });

    expect(res.status).toBe(400);
  });

  it('rejects invalid pipeline_stage with 400', async () => {
    const res = await request(app)
      .post('/api/crm-leads/leads')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        business_name: 'Bad Stage Co',
        pipeline_stage: 'not_a_real_stage',
      });

    expect(res.status).toBe(400);
  });

  it('lists leads', async () => {
    const res = await request(app)
      .get('/api/crm-leads/leads')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const list = Array.isArray(res.body) ? res.body : res.body.data || res.body.leads || [];
    expect(list.length).toBeGreaterThan(0);
  });
});
