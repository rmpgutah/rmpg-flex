// ============================================================
// Businesses search integration tests (Task 1.8)
// Covers GET /api/records/businesses/search — name prefix,
// exact phone/EIN, address substring, archived exclusion,
// auth, role access, ranking.
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';
import { setupTestDataDir, teardownTestDataDir, createTestAdmin, createTestOfficer } from '../helpers/testDb';

let app: Application;
let testDir: string;
let adminToken: string;
let officerToken: string;

beforeAll(async () => {
  testDir = setupTestDataDir();
  const { initDatabase } = await import('../../src/models/database');
  const db = initDatabase();
  const admin = createTestAdmin(db);
  const officer = createTestOfficer(db);
  db.prepare('UPDATE users SET totp_exempt = 1, must_change_password = 0 WHERE id = ?').run(officer.userId);

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

  // Seed several businesses directly via DB (search is read-only).
  const now = new Date().toISOString();
  const insert = db.prepare(`
    INSERT INTO businesses (name, dba_name, ein, phone, address, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  insert.run('Walmart Store 321', 'Walmart', '12-3456789', '555-1212', '1500 S State St', now, now);
  insert.run('Acme Corp', null, null, '555-9999', null, now, now);
  insert.run('Smith Family Auto', null, null, '555-7777', '2200 W North Temple', now, now);
  insert.run('Old Walmart Sign Co', null, null, '555-0001', null, now, now);

  // Archived business
  const archivedRes = insert.run('Old Defunct Co', null, null, '555-0002', null, now, now);
  db.prepare('UPDATE businesses SET archived_at = ? WHERE id = ?').run(now, archivedRes.lastInsertRowid);
});

afterAll(() => {
  teardownTestDataDir(testDir);
});

describe('GET /api/records/businesses/search', () => {
  it('returns matches by name prefix', async () => {
    const r = await request(app)
      .get('/api/records/businesses/search?q=walm')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(200);
    expect(r.body.find((b: any) => b.name === 'Walmart Store 321')).toBeDefined();
  });

  it('returns matches by exact phone', async () => {
    const r = await request(app)
      .get('/api/records/businesses/search?q=555-9999')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(200);
    expect(r.body.find((b: any) => b.name === 'Acme Corp')).toBeDefined();
  });

  it('returns matches by exact EIN', async () => {
    const r = await request(app)
      .get('/api/records/businesses/search?q=12-3456789')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(200);
    expect(r.body.find((b: any) => b.name === 'Walmart Store 321')).toBeDefined();
  });

  it('returns matches by address substring', async () => {
    const r = await request(app)
      .get('/api/records/businesses/search?q=North+Temple')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(200);
    expect(r.body.find((b: any) => b.name === 'Smith Family Auto')).toBeDefined();
  });

  it('returns empty array on no match', async () => {
    const r = await request(app)
      .get('/api/records/businesses/search?q=nothingmatchesthisstring')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(200);
    expect(r.body).toEqual([]);
  });

  it('returns empty array on short query (< 2 chars)', async () => {
    const r = await request(app)
      .get('/api/records/businesses/search?q=a')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(r.body).toEqual([]);
  });

  it('excludes archived businesses', async () => {
    const r = await request(app)
      .get('/api/records/businesses/search?q=defunct')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(r.body.find((b: any) => b.name === 'Old Defunct Co')).toBeUndefined();
  });

  it('requires auth', async () => {
    const r = await request(app).get('/api/records/businesses/search?q=walm');
    expect(r.status).toBe(401);
  });

  it('officer role can also search', async () => {
    const r = await request(app)
      .get('/api/records/businesses/search?q=walm')
      .set('Authorization', `Bearer ${officerToken}`);
    expect(r.status).toBe(200);
  });

  it('respects limit param (capped at 100)', async () => {
    const r = await request(app)
      .get('/api/records/businesses/search?q=co&limit=200')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(200);
    expect(r.body.length).toBeLessThanOrEqual(100);
  });

  it('name-prefix matches rank above mid-string matches', async () => {
    const r = await request(app)
      .get('/api/records/businesses/search?q=walm')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(200);
    const walmartIdx = r.body.findIndex((b: any) => b.name === 'Walmart Store 321');
    const oldIdx = r.body.findIndex((b: any) => b.name === 'Old Walmart Sign Co');
    expect(walmartIdx).toBeGreaterThanOrEqual(0);
    expect(oldIdx).toBeGreaterThanOrEqual(0);
    expect(walmartIdx).toBeLessThan(oldIdx);
  });
});
