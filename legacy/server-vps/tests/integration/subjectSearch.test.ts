// ============================================================
// Subject search integration tests (Task 1.17)
// Covers GET /api/records/subjects/search — unified person +
// business search with discriminated-union response shape,
// scoring/ranking, badges, archived exclusion, type filtering.
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';
import { setupTestDataDir, teardownTestDataDir, createTestAdmin, createTestOfficer } from '../helpers/testDb';

let app: Application;
let testDir: string;
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

  const officerRes = await request(app)
    .post('/api/auth/login')
    .send({ username: officer.username, password: officer.password });
  officerToken = officerRes.body.token;

  const now = new Date().toISOString();

  // ── Persons ────────────────────────────────────────────────
  const insertP = db.prepare(`
    INSERT INTO persons (first_name, last_name, dob, phone, flags, is_sex_offender, dl_number)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const johnRes = insertP.run('John', 'Smith', '1980-01-01', '555-1000', '[]', 0, 'DL12345');
  const janeRes = insertP.run('Jane', 'Smith', '1985-02-02', '555-1001', '[]', 0, null);
  const soRes = insertP.run('Sex', 'Offender Test', '1970-03-03', '555-1002', '[]', 1, null);
  const oldRes = insertP.run('Old', 'Smith', '1960-01-01', '555-1003', '[]', 0, null);
  db.prepare('UPDATE persons SET archived_at = ? WHERE id = ?').run(now, oldRes.lastInsertRowid);

  // Active warrant for Jane (use subject_person_id — the actual schema column)
  db.prepare(`
    INSERT INTO warrants (warrant_number, type, status, subject_person_id, charge_description, entered_by, created_at, updated_at)
    VALUES (?, 'arrest', 'active', ?, ?, 1, ?, ?)
  `).run('W-TEST-001', janeRes.lastInsertRowid, 'Test charge', now, now);

  // ── Businesses ─────────────────────────────────────────────
  const insertB = db.prepare(`
    INSERT INTO businesses (name, dba_name, ein, phone, address, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  insertB.run('Smith Auto', null, null, '555-1212', '100 Main St', now, now);
  insertB.run('Walmart Store 321', 'Walmart', '12-3456789', '555-9999', '1500 S State St', now, now);
  insertB.run('Other Phone Co', null, null, '555-1213', null, now, now);

  const archivedB = insertB.run('Defunct Smith Co', null, null, '555-0002', null, now, now);
  db.prepare('UPDATE businesses SET archived_at = ? WHERE id = ?').run(now, archivedB.lastInsertRowid);

  void johnRes;
  void soRes;
});

afterAll(() => {
  teardownTestDataDir(testDir);
});

describe('GET /api/records/subjects/search', () => {
  it('returns mixed person + business results when types not specified', async () => {
    const r = await request(app)
      .get('/api/records/subjects/search?q=smith')
      .set('Authorization', `Bearer ${officerToken}`);
    expect(r.status).toBe(200);
    const types = new Set(r.body.map((x: any) => x.type));
    expect(types.has('person')).toBe(true);
    expect(types.has('business')).toBe(true);
  });

  it('filters by types=person', async () => {
    const r = await request(app)
      .get('/api/records/subjects/search?q=smith&types=person')
      .set('Authorization', `Bearer ${officerToken}`);
    expect(r.status).toBe(200);
    expect(r.body.length).toBeGreaterThan(0);
    expect(r.body.every((x: any) => x.type === 'person')).toBe(true);
  });

  it('filters by types=business', async () => {
    const r = await request(app)
      .get('/api/records/subjects/search?q=smith&types=business')
      .set('Authorization', `Bearer ${officerToken}`);
    expect(r.status).toBe(200);
    expect(r.body.length).toBeGreaterThan(0);
    expect(r.body.every((x: any) => x.type === 'business')).toBe(true);
  });

  it('returns discriminated union shape with all required fields', async () => {
    const r = await request(app)
      .get('/api/records/subjects/search?q=smith')
      .set('Authorization', `Bearer ${officerToken}`);
    expect(r.body.length).toBeGreaterThan(0);
    for (const item of r.body) {
      expect(['person', 'business']).toContain(item.type);
      expect(typeof item.id).toBe('number');
      expect(typeof item.display_name).toBe('string');
      expect(typeof item.sub_text).toBe('string');
      expect(Array.isArray(item.badges)).toBe(true);
      expect(typeof item.score).toBe('number');
      expect(typeof item.metadata).toBe('object');
    }
  });

  it('boosts persons with active warrants in ranking', async () => {
    const r = await request(app)
      .get('/api/records/subjects/search?q=smith&types=person')
      .set('Authorization', `Bearer ${officerToken}`);
    const jane = r.body.findIndex((x: any) => x.display_name.includes('JANE'));
    const john = r.body.findIndex((x: any) => x.display_name.includes('JOHN'));
    expect(jane).toBeGreaterThanOrEqual(0);
    expect(john).toBeGreaterThanOrEqual(0);
    expect(jane).toBeLessThan(john);
  });

  it('attaches warrant badge to person with active warrant', async () => {
    const r = await request(app)
      .get('/api/records/subjects/search?q=jane')
      .set('Authorization', `Bearer ${officerToken}`);
    const jane = r.body.find((x: any) => x.type === 'person' && x.display_name.includes('JANE'));
    expect(jane).toBeDefined();
    expect(jane.badges.some((b: any) => b.type === 'warrant' && b.severity === 'critical')).toBe(true);
  });

  it('attaches sex offender flag badge', async () => {
    const r = await request(app)
      .get('/api/records/subjects/search?q=offender')
      .set('Authorization', `Bearer ${officerToken}`);
    const so = r.body.find((x: any) => x.type === 'person');
    expect(so).toBeDefined();
    expect(so.badges.some((b: any) => b.value === 'SEX OFFENDER' && b.severity === 'critical')).toBe(true);
  });

  it('excludes archived persons', async () => {
    const r = await request(app)
      .get('/api/records/subjects/search?q=Old')
      .set('Authorization', `Bearer ${officerToken}`);
    expect(r.body.find((x: any) => x.display_name.includes('OLD'))).toBeUndefined();
  });

  it('excludes archived businesses', async () => {
    const r = await request(app)
      .get('/api/records/subjects/search?q=defunct')
      .set('Authorization', `Bearer ${officerToken}`);
    expect(r.body).toEqual([]);
  });

  it('returns [] for query < 2 chars', async () => {
    const r = await request(app)
      .get('/api/records/subjects/search?q=a')
      .set('Authorization', `Bearer ${officerToken}`);
    expect(r.body).toEqual([]);
  });

  it('respects limit cap at 50', async () => {
    const r = await request(app)
      .get('/api/records/subjects/search?q=test&limit=200')
      .set('Authorization', `Bearer ${officerToken}`);
    expect(r.body.length).toBeLessThanOrEqual(50);
  });

  it('requires auth (401)', async () => {
    const r = await request(app).get('/api/records/subjects/search?q=smith');
    expect(r.status).toBe(401);
  });

  it('exact phone match boosts business ranking', async () => {
    // "Smith Auto" 555-1212 vs "Other Phone Co" 555-1213 — searching 555-1212
    // should put Smith Auto (exact phone match) ahead of any LIKE matches.
    const r = await request(app)
      .get('/api/records/subjects/search?q=555-1212&types=business')
      .set('Authorization', `Bearer ${officerToken}`);
    expect(r.body.length).toBeGreaterThan(0);
    const smithAuto = r.body.find((x: any) => x.display_name.includes('SMITH AUTO'));
    expect(smithAuto).toBeDefined();
    // Smith Auto should be first (highest score) due to exact phone match boost.
    expect(r.body[0].display_name).toContain('SMITH AUTO');
  });
});
