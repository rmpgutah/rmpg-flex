// ============================================================
// HR Integration Tests
// Exercises leave requests, disciplinary records, and employee
// listing. Also probes the suspected user.id vs user.userId bug
// where HR routes destructure user.id but JWT payload has userId.
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';
import { setupTestDataDir, teardownTestDataDir, createTestAdmin, createTestOfficer } from '../helpers/testDb';

let app: Application;
let testDir: string;
let adminToken: string;
let officerToken: string;
let adminId: number;
let officerId: number;

beforeAll(async () => {
  testDir = setupTestDataDir();
  const { initDatabase } = await import('../../src/models/database');
  const db = initDatabase();
  const admin = createTestAdmin(db);
  const officer = createTestOfficer(db);
  db.prepare('UPDATE users SET totp_exempt = 1, must_change_password = 0 WHERE id = ?').run(officer.userId);
  adminId = admin.userId;
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

describe('POST /api/hr/leave', () => {
  it('creates a leave request with required fields', async () => {
    const res = await request(app)
      .post('/api/hr/leave')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        type: 'vacation',
        start_date: '2026-05-01',
        end_date: '2026-05-03',
        hours_requested: 24,
        reason: 'Family trip',
      });

    expect([200, 201]).toContain(res.status);
    expect(res.body.id).toBeGreaterThan(0);
  });

  it('rejects missing type with 400', async () => {
    const res = await request(app)
      .post('/api/hr/leave')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        start_date: '2026-05-01',
        end_date: '2026-05-03',
      });

    expect(res.status).toBe(400);
  });

  it('rejects invalid date format with 400', async () => {
    const res = await request(app)
      .post('/api/hr/leave')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        type: 'sick',
        start_date: 'not-a-date',
        end_date: '2026-05-03',
      });

    expect(res.status).toBe(400);
  });

  it('BUG CHECK: persisted leave request has correct officer_id from JWT', async () => {
    // This test probes the suspected user.id vs user.userId bug.
    // If the HR route reads user.id (which doesn't exist in JwtPayload),
    // officer_id will be NULL — this test will catch that.
    const createRes = await request(app)
      .post('/api/hr/leave')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        type: 'personal',
        start_date: '2026-06-01',
        end_date: '2026-06-01',
        hours_requested: 8,
        reason: 'Appointment',
      });

    expect([200, 201]).toContain(createRes.status);
    const leaveId = createRes.body.id;

    // Fetch the list and find our entry
    const listRes = await request(app)
      .get('/api/hr/leave')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(listRes.status).toBe(200);
    const list = Array.isArray(listRes.body) ? listRes.body : listRes.body.data || listRes.body.leave || [];
    const ours = list.find((l: any) => l.id === leaveId);
    expect(ours).toBeDefined();
    // The officer_id must match the officer who logged in — NOT null or 0
    expect(ours.officer_id).toBe(officerId);
  });
});

describe('POST /api/hr/disciplinary', () => {
  it('creates a disciplinary record with required fields', async () => {
    const res = await request(app)
      .post('/api/hr/disciplinary')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        officer_id: officerId,
        type: 'verbal_warning',
        severity: 'minor',
        incident_date: '2026-04-10',
        description: 'Test disciplinary record',
      });

    expect([200, 201]).toContain(res.status);
    expect(res.body.id).toBeGreaterThan(0);
  });

  it('rejects missing officer_id with 400', async () => {
    const res = await request(app)
      .post('/api/hr/disciplinary')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        type: 'verbal_warning',
        incident_date: '2026-04-10',
        description: 'No officer specified',
      });

    expect(res.status).toBe(400);
  });

  it('rejects missing description with 400', async () => {
    const res = await request(app)
      .post('/api/hr/disciplinary')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        officer_id: officerId,
        type: 'verbal_warning',
        incident_date: '2026-04-10',
      });

    expect(res.status).toBe(400);
  });

  it('BUG CHECK: persisted disciplinary record has correct issued_by from JWT', async () => {
    const createRes = await request(app)
      .post('/api/hr/disciplinary')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        officer_id: officerId,
        type: 'written_warning',
        severity: 'moderate',
        incident_date: '2026-04-10',
        description: 'Issued by bug check',
      });

    expect([200, 201]).toContain(createRes.status);
    const recordId = createRes.body.id;

    const listRes = await request(app)
      .get('/api/hr/disciplinary')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(listRes.status).toBe(200);
    const list = Array.isArray(listRes.body) ? listRes.body : listRes.body.data || listRes.body.records || [];
    const ours = list.find((r: any) => r.id === recordId);
    expect(ours).toBeDefined();
    // issued_by must match the admin who created it — NOT null or 0
    expect(ours.issued_by).toBe(adminId);
  });
});

describe('GET /api/hr/employees', () => {
  it('lists employees', async () => {
    const res = await request(app)
      .get('/api/hr/employees')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const list = Array.isArray(res.body) ? res.body : res.body.data || res.body.employees || [];
    expect(list.length).toBeGreaterThan(0);
  });
});
