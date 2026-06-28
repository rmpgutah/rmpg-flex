// ============================================================
// business_visits routes integration tests (Task 1.14)
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';
import { setupTestDataDir, teardownTestDataDir, createTestAdmin, createTestOfficer } from '../helpers/testDb';

let app: Application;
let testDir: string;
let adminToken: string;
let officerToken: string;
let officerUserId: number;
let bizId: number;

beforeAll(async () => {
  testDir = setupTestDataDir();
  const { initDatabase } = await import('../../src/models/database');
  const db = initDatabase();
  const admin = createTestAdmin(db);
  const officer = createTestOfficer(db);
  officerUserId = officer.userId;
  db.prepare('UPDATE users SET totp_exempt = 1, must_change_password = 0 WHERE id = ?').run(officer.userId);

  const { createTestApp } = await import('../helpers/testApp');
  app = await createTestApp();

  const adminRes = await request(app).post('/api/auth/login').send({ username: admin.username, password: admin.password });
  adminToken = adminRes.body.token;
  const officerRes = await request(app).post('/api/auth/login').send({ username: officer.username, password: officer.password });
  officerToken = officerRes.body.token;

  const now = new Date().toISOString();
  const bizR = db.prepare('INSERT INTO businesses (name, created_at, updated_at) VALUES (?, ?, ?)')
    .run('Visit Co', now, now);
  bizId = Number(bizR.lastInsertRowid);
});

afterAll(() => {
  teardownTestDataDir(testDir);
});

describe('business_visits routes', () => {
  it('POST creates visit with officer from token (not body)', async () => {
    const r = await request(app)
      .post('/api/business-visits')
      .set('Authorization', `Bearer ${officerToken}`)
      // attempt to spoof a different officer_id in body — should be ignored
      .send({ business_id: bizId, officer_id: 99999, latitude: 40.76, longitude: -111.89, notes: 'check ok' });
    expect(r.status).toBe(201);
    expect(r.body.business_id).toBe(bizId);
    expect(r.body.officer_id).toBe(officerUserId);
    expect(r.body.latitude).toBeCloseTo(40.76);
    expect(r.body.notes).toBe('check ok');
  });

  it('POST 404 on bad business_id', async () => {
    const r = await request(app)
      .post('/api/business-visits')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ business_id: 999999, notes: 'x' });
    expect(r.status).toBe(404);
  });

  it('POST 401 without auth', async () => {
    const r = await request(app)
      .post('/api/business-visits')
      .send({ business_id: bizId });
    expect(r.status).toBe(401);
  });

  it('GET returns visits sorted DESC by visit_at', async () => {
    const { getDb } = await import('../../src/models/database');
    const db = getDb();
    // Insert two visits with explicit older + newer timestamps
    db.prepare('INSERT INTO business_visits (business_id, officer_id, visit_at, notes) VALUES (?, ?, ?, ?)')
      .run(bizId, officerUserId, '2024-01-01 12:00:00', 'old');
    db.prepare('INSERT INTO business_visits (business_id, officer_id, visit_at, notes) VALUES (?, ?, ?, ?)')
      .run(bizId, officerUserId, '2026-04-25 12:00:00', 'recent');

    const r = await request(app)
      .get(`/api/business-visits/${bizId}`)
      .set('Authorization', `Bearer ${officerToken}`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
    // Verify DESC order — recent should appear before old
    const recentIdx = r.body.findIndex((v: any) => v.notes === 'recent');
    const oldIdx = r.body.findIndex((v: any) => v.notes === 'old');
    expect(recentIdx).toBeGreaterThanOrEqual(0);
    expect(oldIdx).toBeGreaterThanOrEqual(0);
    expect(recentIdx).toBeLessThan(oldIdx);
  });

  it('GET respects since= filter', async () => {
    const r = await request(app)
      .get(`/api/business-visits/${bizId}?since=2025-01-01`)
      .set('Authorization', `Bearer ${officerToken}`);
    expect(r.status).toBe(200);
    expect(r.body.find((v: any) => v.notes === 'old')).toBeUndefined();
    expect(r.body.find((v: any) => v.notes === 'recent')).toBeDefined();
  });

  it('GET respects limit cap', async () => {
    const r = await request(app)
      .get(`/api/business-visits/${bizId}?limit=500`)
      .set('Authorization', `Bearer ${officerToken}`);
    expect(r.status).toBe(200);
    expect(r.body.length).toBeLessThanOrEqual(200);
  });
});
