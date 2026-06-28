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

  const loginRes = await request(app)
    .post('/api/auth/login')
    .send({ username: admin.username, password: admin.password });
  adminToken = loginRes.body.token;
});

afterAll(() => { teardownTestDataDir(testDir); });

describe('POST /api/pdf-artifacts', () => {
  const fakePdf = Buffer.from('%PDF-1.4\n% fake minimal pdf\n%%EOF\n');

  it('creates an artifact, stores blob, returns sha256', async () => {
    const res = await request(app)
      .post('/api/pdf-artifacts')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('form_type', 'warrant')
      .field('form_version', 'PS-210 Rev 2026-04')
      .field('record_type', 'warrant')
      .field('record_id', '42')
      .field('title', 'Arrest Warrant - Jones')
      .attach('pdf', fakePdf, 'warrant.pdf');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(res.body.id).toBeGreaterThan(0);
  });

  it('rejects missing required fields with 400', async () => {
    const res = await request(app)
      .post('/api/pdf-artifacts')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('pdf', Buffer.from('x'), 'x.pdf');
    expect(res.status).toBe(400);
  });

  it('rejects missing file with 400', async () => {
    const res = await request(app)
      .post('/api/pdf-artifacts')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('form_type', 'warrant')
      .field('form_version', 'R1')
      .field('record_type', 'warrant')
      .field('record_id', '1');
    expect(res.status).toBe(400);
  });

  it('rejects invalid record_type with 400', async () => {
    const res = await request(app)
      .post('/api/pdf-artifacts')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('form_type', 'warrant')
      .field('form_version', 'R1')
      .field('record_type', 'not_a_thing')
      .field('record_id', '1')
      .attach('pdf', Buffer.from('x'), 'x.pdf');
    expect(res.status).toBe(400);
  });
});

describe('GET /api/pdf-artifacts', () => {
  const fakePdf = Buffer.from('%PDF-1.4\n%%EOF\n');

  it('lists artifacts for a record', async () => {
    // Create 2 artifacts for warrant:99
    await request(app)
      .post('/api/pdf-artifacts')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('form_type', 'warrant').field('form_version', 'R1')
      .field('record_type', 'warrant').field('record_id', '99')
      .attach('pdf', fakePdf, 'a.pdf');
    await request(app)
      .post('/api/pdf-artifacts')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('form_type', 'warrant').field('form_version', 'R1')
      .field('record_type', 'warrant').field('record_id', '99')
      .attach('pdf', Buffer.concat([fakePdf, Buffer.from('different')]), 'b.pdf');

    const res = await request(app)
      .get('/api/pdf-artifacts?record_type=warrant&record_id=99')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(2);
  });
});
