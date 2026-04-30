// ============================================================
// business_photos routes integration tests (Task 1.15)
// Multi-photo support for businesses w/ multipart upload.
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import type { Application } from 'express';
import { setupTestDataDir, teardownTestDataDir, createTestAdmin, createTestOfficer } from '../helpers/testDb';

let app: Application;
let testDir: string;
let adminToken: string;
let officerToken: string;
let bizId: number;

const TINY_PNG = Buffer.from([
  0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
  0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4,
  0x89, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9C, 0x62, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00,
  0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE,
  0x42, 0x60, 0x82,
]);

beforeAll(async () => {
  testDir = setupTestDataDir();
  const { initDatabase } = await import('../../src/models/database');
  const db = initDatabase();
  const admin = createTestAdmin(db);
  const officer = createTestOfficer(db);
  db.prepare('UPDATE users SET totp_exempt = 1, must_change_password = 0 WHERE id = ?').run(officer.userId);

  const { createTestApp } = await import('../helpers/testApp');
  app = await createTestApp();

  const adminRes = await request(app).post('/api/auth/login').send({ username: admin.username, password: admin.password });
  adminToken = adminRes.body.token;
  const officerRes = await request(app).post('/api/auth/login').send({ username: officer.username, password: officer.password });
  officerToken = officerRes.body.token;

  const now = new Date().toISOString();
  const bizR = db.prepare('INSERT INTO businesses (name, created_at, updated_at) VALUES (?, ?, ?)')
    .run('Photo Co', now, now);
  bizId = Number(bizR.lastInsertRowid);
});

afterAll(() => {
  teardownTestDataDir(testDir);
});

describe('POST /api/business-photos', () => {
  it('uploads a photo and returns 201 with proper url', async () => {
    const r = await request(app)
      .post('/api/business-photos')
      .set('Authorization', `Bearer ${officerToken}`)
      .field('business_id', String(bizId))
      .field('category', 'storefront')
      .field('caption', 'Front entrance')
      .attach('photo', TINY_PNG, 'test.png');
    expect(r.status).toBe(201);
    expect(r.body.url).toMatch(/^\/uploads\/business-photos\/[a-f0-9-]+\.png$/);
    expect(r.body.business_id).toBe(bizId);
    expect(r.body.category).toBe('storefront');
    expect(r.body.caption).toBe('Front entrance');
  });

  it('400 when photo file missing', async () => {
    const r = await request(app)
      .post('/api/business-photos')
      .set('Authorization', `Bearer ${officerToken}`)
      .field('business_id', String(bizId))
      .field('category', 'storefront');
    expect(r.status).toBe(400);
  });

  it('400 when business_id missing', async () => {
    const r = await request(app)
      .post('/api/business-photos')
      .set('Authorization', `Bearer ${officerToken}`)
      .field('category', 'storefront')
      .attach('photo', TINY_PNG, 'test.png');
    expect(r.status).toBe(400);
  });

  it('400 when category invalid', async () => {
    const r = await request(app)
      .post('/api/business-photos')
      .set('Authorization', `Bearer ${officerToken}`)
      .field('business_id', String(bizId))
      .field('category', 'bogus-category')
      .attach('photo', TINY_PNG, 'test.png');
    expect(r.status).toBe(400);
  });

  it('400 when file type is not an image', async () => {
    const r = await request(app)
      .post('/api/business-photos')
      .set('Authorization', `Bearer ${officerToken}`)
      .field('business_id', String(bizId))
      .field('category', 'storefront')
      .attach('photo', Buffer.from('hello world'), { filename: 'note.txt', contentType: 'text/plain' });
    expect(r.status).toBe(400);
  });

  it('400 when file exceeds 10MB', async () => {
    const tooBig = Buffer.alloc(11 * 1024 * 1024);
    const r = await request(app)
      .post('/api/business-photos')
      .set('Authorization', `Bearer ${officerToken}`)
      .field('business_id', String(bizId))
      .field('category', 'storefront')
      .attach('photo', tooBig, { filename: 'big.png', contentType: 'image/png' });
    expect(r.status).toBe(400);
  });

  it('404 when business does not exist', async () => {
    const r = await request(app)
      .post('/api/business-photos')
      .set('Authorization', `Bearer ${officerToken}`)
      .field('business_id', '999999')
      .field('category', 'storefront')
      .attach('photo', TINY_PNG, 'test.png');
    expect(r.status).toBe(404);
  });

  it('401 without auth', async () => {
    const r = await request(app)
      .post('/api/business-photos')
      .field('business_id', String(bizId))
      .field('category', 'storefront')
      .attach('photo', TINY_PNG, 'test.png');
    expect(r.status).toBe(401);
  });
});

describe('GET /api/business-photos/:businessId', () => {
  it('returns photos sorted by uploaded_at DESC', async () => {
    const { getDb } = await import('../../src/models/database');
    const db = getDb();
    db.prepare(`INSERT INTO business_photos (business_id, url, caption, category, uploaded_at) VALUES (?, ?, ?, ?, ?)`)
      .run(bizId, '/uploads/business-photos/old.png', 'old', 'interior', '2024-01-01 12:00:00');
    db.prepare(`INSERT INTO business_photos (business_id, url, caption, category, uploaded_at) VALUES (?, ?, ?, ?, ?)`)
      .run(bizId, '/uploads/business-photos/recent.png', 'recent', 'interior', '2026-04-25 12:00:00');

    const r = await request(app)
      .get(`/api/business-photos/${bizId}`)
      .set('Authorization', `Bearer ${officerToken}`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
    const recentIdx = r.body.findIndex((p: any) => p.caption === 'recent');
    const oldIdx = r.body.findIndex((p: any) => p.caption === 'old');
    expect(recentIdx).toBeGreaterThanOrEqual(0);
    expect(oldIdx).toBeGreaterThanOrEqual(0);
    expect(recentIdx).toBeLessThan(oldIdx);
  });
});

describe('DELETE /api/business-photos/:photoId', () => {
  it('admin can delete a photo and the file is removed from disk', async () => {
    // Upload a photo first as officer
    const up = await request(app)
      .post('/api/business-photos')
      .set('Authorization', `Bearer ${officerToken}`)
      .field('business_id', String(bizId))
      .field('category', 'parking')
      .attach('photo', TINY_PNG, 'todelete.png');
    expect(up.status).toBe(201);
    const photoId = up.body.id;
    const url: string = up.body.url;

    // Resolve the file path
    const uploadsRoot = process.env.RMPG_UPLOADS_DIR!;
    const filePath = path.join(uploadsRoot, url.replace(/^\/uploads\//, ''));
    expect(fs.existsSync(filePath)).toBe(true);

    const del = await request(app)
      .delete(`/api/business-photos/${photoId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(del.status).toBe(204);
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it('officer (non-admin/manager/supervisor) cannot delete — 403', async () => {
    const up = await request(app)
      .post('/api/business-photos')
      .set('Authorization', `Bearer ${officerToken}`)
      .field('business_id', String(bizId))
      .field('category', 'exterior')
      .attach('photo', TINY_PNG, 'noperm.png');
    expect(up.status).toBe(201);
    const photoId = up.body.id;

    const del = await request(app)
      .delete(`/api/business-photos/${photoId}`)
      .set('Authorization', `Bearer ${officerToken}`);
    expect(del.status).toBe(403);
  });

  it('404 when photoId does not exist', async () => {
    const del = await request(app)
      .delete('/api/business-photos/9999999')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(del.status).toBe(404);
  });
});
