// ============================================================
// Court Integration Tests
// Exercises court event creation, retrieval, and continuance.
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

describe('POST /api/court/events', () => {
  it('creates a court event with required fields', async () => {
    const res = await request(app)
      .post('/api/court/events')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        event_type: 'trial',
        event_date: '2026-05-15',
        event_time: '09:00',
        court_name: '3rd District Court',
        courtroom: '201',
        judge_name: 'Judge Smith',
        defendant_name: 'John Doe',
      });

    expect([200, 201]).toContain(res.status);
    expect(res.body.data?.id || res.body.id).toBeGreaterThan(0);
  });

  it('rejects missing event_type with 400', async () => {
    const res = await request(app)
      .post('/api/court/events')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ event_date: '2026-05-15' });

    expect(res.status).toBe(400);
  });

  it('rejects missing event_date with 400', async () => {
    const res = await request(app)
      .post('/api/court/events')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ event_type: 'trial' });

    expect(res.status).toBe(400);
  });

  it('rejects invalid event_date format with 400', async () => {
    const res = await request(app)
      .post('/api/court/events')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ event_type: 'trial', event_date: 'May 15' });

    expect(res.status).toBe(400);
  });

  it('persists the court event and makes it retrievable', async () => {
    const createRes = await request(app)
      .post('/api/court/events')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        event_type: 'hearing',
        event_date: '2026-06-01',
        court_name: 'Salt Lake Justice Court',
        defendant_name: 'Jane Smith',
      });

    expect([200, 201]).toContain(createRes.status);
    const eventId = createRes.body.data?.id || createRes.body.id;

    const getRes = await request(app)
      .get(`/api/court/events/${eventId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(getRes.status).toBe(200);
    // GET may also wrap in { data: ... } — handle both
    const event = getRes.body.data || getRes.body;
    expect(event.event_type).toBe('hearing');
    expect(event.defendant_name).toBe('Jane Smith');
  });

  it('lists court events', async () => {
    const res = await request(app)
      .get('/api/court/events')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const list = Array.isArray(res.body) ? res.body : res.body.data || res.body.events || [];
    expect(list.length).toBeGreaterThan(0);
  });
});

describe('Court event continuance', () => {
  let eventId: number;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/court/events')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        event_type: 'trial',
        event_date: '2026-07-01',
        court_name: 'Test Court',
        defendant_name: 'Continuance Test',
      });
    eventId = res.body.data?.id || res.body.id;
  });

  it('records a continuance on a court event', async () => {
    const res = await request(app)
      .post(`/api/court/events/${eventId}/continuance`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        new_date: '2026-08-15',
        reason: 'Defense request',
      });

    expect([200, 201]).toContain(res.status);
  });
});
