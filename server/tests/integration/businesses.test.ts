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

describe('business_persons linking (Task 1.9)', () => {
  let bizId: number;
  let personId: number;
  let managerLinkId: number;

  beforeAll(async () => {
    const { getDb } = await import('../../src/models/database');
    const db = getDb();
    const bizR = db.prepare('INSERT INTO businesses (name, created_at, updated_at) VALUES (?, ?, ?)')
      .run('LinkTest Inc', new Date().toISOString(), new Date().toISOString());
    bizId = Number(bizR.lastInsertRowid);
    const personR = db.prepare('INSERT INTO persons (first_name, last_name) VALUES (?, ?)')
      .run('Test', 'LinkPerson');
    personId = Number(personR.lastInsertRowid);
  });

  it('POST creates a link', async () => {
    const r = await request(app)
      .post(`/api/records/businesses/${bizId}/persons`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ person_id: personId, role: 'manager', notes: 'hired 2024' });
    expect(r.status).toBe(201);
    expect(r.body.role).toBe('manager');
    expect(r.body.business_id).toBe(bizId);
    expect(r.body.person_id).toBe(personId);
    expect(r.body.notes).toBe('hired 2024');
    managerLinkId = r.body.id;
  });

  it('POST allows same person+business with different role', async () => {
    const r = await request(app)
      .post(`/api/records/businesses/${bizId}/persons`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ person_id: personId, role: 'key_holder' });
    expect(r.status).toBe(201);
    expect(r.body.role).toBe('key_holder');
  });

  it('POST returns 409 on duplicate (business, person, role)', async () => {
    const r = await request(app)
      .post(`/api/records/businesses/${bizId}/persons`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ person_id: personId, role: 'manager' });
    expect(r.status).toBe(409);
  });

  it('POST returns 400 on invalid role', async () => {
    const r = await request(app)
      .post(`/api/records/businesses/${bizId}/persons`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ person_id: personId, role: 'kingmaker' });
    expect(r.status).toBe(400);
    expect(r.body.allowed).toBeDefined();
    expect(Array.isArray(r.body.allowed)).toBe(true);
  });

  it('POST returns 404 when business not found', async () => {
    const r = await request(app)
      .post(`/api/records/businesses/999999/persons`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ person_id: personId, role: 'employee' });
    expect(r.status).toBe(404);
  });

  it('POST returns 404 when person not found', async () => {
    const r = await request(app)
      .post(`/api/records/businesses/${bizId}/persons`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ person_id: 999999, role: 'employee' });
    expect(r.status).toBe(404);
  });

  it('POST requires auth', async () => {
    const r = await request(app)
      .post(`/api/records/businesses/${bizId}/persons`)
      .send({ person_id: personId, role: 'employee' });
    expect(r.status).toBe(401);
  });

  it('PUT updates dates and notes', async () => {
    const r = await request(app)
      .put(`/api/records/businesses/${bizId}/persons/${managerLinkId}`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ end_date: '2025-06-01', notes: 'left for competitor' });
    expect(r.status).toBe(200);
    expect(r.body.end_date).toBe('2025-06-01');
    expect(r.body.notes).toBe('left for competitor');
    expect(r.body.role).toBe('manager');
  });

  it('PUT 404 on bad linkId', async () => {
    const r = await request(app)
      .put(`/api/records/businesses/${bizId}/persons/99999`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ notes: 'test' });
    expect(r.status).toBe(404);
  });

  it('PUT 404 when linkId belongs to different business', async () => {
    const { getDb } = await import('../../src/models/database');
    const db = getDb();
    const otherBiz = db.prepare('INSERT INTO businesses (name, created_at, updated_at) VALUES (?, ?, ?)')
      .run('Other Biz', new Date().toISOString(), new Date().toISOString());
    const otherBizId = Number(otherBiz.lastInsertRowid);
    const r = await request(app)
      .put(`/api/records/businesses/${otherBizId}/persons/${managerLinkId}`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ notes: 'test' });
    expect(r.status).toBe(404);
  });

  it('PUT 400 on invalid role', async () => {
    const r = await request(app)
      .put(`/api/records/businesses/${bizId}/persons/${managerLinkId}`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ role: 'kingmaker' });
    expect(r.status).toBe(400);
    expect(r.body.allowed).toBeDefined();
  });

  it('PUT 409 when changing role to one already linked', async () => {
    // managerLinkId currently has role=manager; key_holder also exists. Try changing manager->key_holder.
    const r = await request(app)
      .put(`/api/records/businesses/${bizId}/persons/${managerLinkId}`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ role: 'key_holder' });
    expect(r.status).toBe(409);
  });

  it('DELETE removes link, person record stays', async () => {
    const { getDb } = await import('../../src/models/database');
    const db = getDb();
    // Create a fresh link to delete
    const createR = await request(app)
      .post(`/api/records/businesses/${bizId}/persons`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ person_id: personId, role: 'employee' });
    expect(createR.status).toBe(201);
    const delLinkId = createR.body.id;

    const r = await request(app)
      .delete(`/api/records/businesses/${bizId}/persons/${delLinkId}`)
      .set('Authorization', `Bearer ${officerToken}`);
    expect(r.status).toBe(204);
    expect(r.body).toEqual({});

    // Person still exists
    const personRow = db.prepare('SELECT id FROM persons WHERE id = ?').get(personId);
    expect(personRow).toBeDefined();
    // Link gone
    const linkRow = db.prepare('SELECT id FROM business_persons WHERE id = ?').get(delLinkId);
    expect(linkRow).toBeUndefined();
  });

  it('DELETE 404 on bad linkId', async () => {
    const r = await request(app)
      .delete(`/api/records/businesses/${bizId}/persons/99999`)
      .set('Authorization', `Bearer ${officerToken}`);
    expect(r.status).toBe(404);
  });
});
