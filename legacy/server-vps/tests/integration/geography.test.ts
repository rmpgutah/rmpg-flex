// ============================================================
// Geography Integration Tests
// Exercises the 4-tier Areas → Sectors → Zones → Beats API.
// Seed data comes from the real Utah GeoJSON files in
// client/public/geojson (county, municipality, beat).
// ============================================================

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';
import {
  setupTestDataDir,
  teardownTestDataDir,
  createTestAdmin,
  createTestOfficer,
} from '../helpers/testDb';

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
});

afterAll(() => {
  teardownTestDataDir(testDir);
});

describe('Geography API — areas', () => {
  it('GET /areas returns 6 Utah AOG areas with the expected codes', async () => {
    const res = await request(app)
      .get('/api/dispatch/geography/areas')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(6);
    const codes = res.body.map((a: any) => a.area_code).sort();
    expect(codes).toEqual([
      'BEAR_RIVER',
      'FIVE_COUNTY',
      'SIX_COUNTY',
      'SOUTHEASTERN',
      'UINTAH_BASIN',
      'WASATCH_FRONT',
    ]);
  });

  it('anonymous GET /areas returns 401', async () => {
    const res = await request(app).get('/api/dispatch/geography/areas');
    expect(res.status).toBe(401);
  });
});

describe('Geography API — sectors', () => {
  it('GET /sectors returns 29 Utah counties', async () => {
    const res = await request(app)
      .get('/api/dispatch/geography/sectors')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.length).toBe(29);
  });

  it('GET /sectors?area_id=<bear_river> returns 3 sectors', async () => {
    const areasRes = await request(app)
      .get('/api/dispatch/geography/areas')
      .set('Authorization', `Bearer ${adminToken}`);
    const bearRiver = areasRes.body.find((a: any) => a.area_code === 'BEAR_RIVER');
    expect(bearRiver).toBeTruthy();

    const res = await request(app)
      .get(`/api/dispatch/geography/sectors?area_id=${bearRiver.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(3); // Box Elder, Cache, Rich
    const names = res.body.map((s: any) => s.sector_name).sort();
    expect(names).toEqual(['Box Elder County', 'Cache County', 'Rich County']);
  });

  it('officer POST /sectors is forbidden (403)', async () => {
    const res = await request(app)
      .post('/api/dispatch/geography/sectors')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ sector_code: 'TST', sector_name: 'Test' });
    expect(res.status).toBe(403);
  });
});

describe('Geography API — zones', () => {
  it('GET /zones returns municipalities + unincorporated (250-320 rows)', async () => {
    const res = await request(app)
      .get('/api/dispatch/geography/zones')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(250);
    expect(res.body.length).toBeLessThan(320);
  });
});

describe('Geography API — beats', () => {
  it('GET /beats returns 719 beats', async () => {
    const res = await request(app)
      .get('/api/dispatch/geography/beats')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.length).toBe(719);
  });
});

describe('Geography API — tree', () => {
  it('GET /tree returns proper 4-level nesting (area → sector → zone → beat)', async () => {
    const res = await request(app)
      .get('/api/dispatch/geography/tree')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.areas.length).toBe(6);

    const wasatch = res.body.areas.find((a: any) => a.area_code === 'WASATCH_FRONT');
    expect(wasatch).toBeTruthy();
    expect(wasatch.sectors.length).toBe(8); // 8 counties in Wasatch Front

    const slc = wasatch.sectors.find((s: any) => s.sector_code === 'SLC');
    expect(slc).toBeTruthy();
    expect(slc.zones.length).toBeGreaterThan(0);
    expect(slc.zones[0].beats).toBeDefined();
  });
});

describe('Geography API — deleted /sections endpoints', () => {
  it('GET /sections returns 404 (regression guard)', async () => {
    const res = await request(app)
      .get('/api/dispatch/geography/sections')
      .set('Authorization', `Bearer ${adminToken}`);
    // Express returns 404 for unknown routes OR we may get a catch-all
    // response. Either 404 or something non-200 is acceptable here.
    expect([404, 501]).toContain(res.status);
  });
});
