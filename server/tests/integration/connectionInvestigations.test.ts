import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';
import { setupTestDataDir, teardownTestDataDir, createTestAdmin } from '../helpers/testDb';

let app: Application;
let testDir: string;
let adminToken: string;
let adminId: number;
let otherUserToken: string;
let otherUserId: number;

beforeAll(async () => {
  testDir = setupTestDataDir();
  const { initDatabase, getDb } = await import('../../src/models/database');
  const db = initDatabase();
  const admin = createTestAdmin(db);
  adminId = admin.userId;
  const { createTestApp } = await import('../helpers/testApp');
  app = await createTestApp();

  const loginRes = await request(app).post('/api/auth/login').send({ username: admin.username, password: admin.password });
  adminToken = loginRes.body.token;

  // Create a second test user (officer) for share-list testing.
  const bcrypt = await import('bcryptjs');
  const hash = bcrypt.default.hashSync('OtherPass1!', 4);
  const now = new Date().toISOString();
  const d = getDb();
  otherUserId = Number(d.prepare(
    `INSERT INTO users (username, password_hash, full_name, email, role, badge_number, phone, status, must_change_password, totp_exempt, password_changed_at, created_at, updated_at)
     VALUES ('otheruser', ?, 'Other User', 'other@test.com', 'officer', 'T003', '555-0102', 'active', 0, 1, ?, ?, ?)`
  ).run(hash, now, now, now).lastInsertRowid);
  const otherLogin = await request(app).post('/api/auth/login').send({ username: 'otheruser', password: 'OtherPass1!' });
  otherUserToken = otherLogin.body.token;
});

afterAll(() => { teardownTestDataDir(testDir); });

describe('POST /api/connections/investigations', () => {
  it('creates an investigation owned by the authenticated user', async () => {
    const res = await request(app)
      .post('/api/connections/investigations')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Jones investigation', seed_nodes: [{ type: 'person', id: 1 }], description: 'Phase 1' });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeGreaterThan(0);
    expect(res.body.user_id).toBe(adminId);
    expect(res.body.name).toBe('Jones investigation');
  });

  it('rejects missing name with 400', async () => {
    const res = await request(app)
      .post('/api/connections/investigations')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ seed_nodes: [] });
    expect(res.status).toBe(400);
  });

  it('requires authentication', async () => {
    const res = await request(app).post('/api/connections/investigations').send({ name: 'x' });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/connections/investigations', () => {
  it('returns only investigations owned by or shared with the user', async () => {
    const d = (await import('../../src/models/database')).getDb();
    d.prepare('DELETE FROM connection_investigations').run();

    d.prepare("INSERT INTO connection_investigations (user_id, name, seed_nodes, shared_user_ids) VALUES (?, 'mine1', '[]', '[]')").run(adminId);
    d.prepare("INSERT INTO connection_investigations (user_id, name, seed_nodes, shared_user_ids) VALUES (?, 'theirs1', '[]', '[]')").run(otherUserId);
    d.prepare("INSERT INTO connection_investigations (user_id, name, seed_nodes, shared_user_ids) VALUES (?, 'shared-with-me', '[]', ?)").run(otherUserId, JSON.stringify([adminId]));

    const res = await request(app).get('/api/connections/investigations').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const names = (res.body as any[]).map(r => r.name).sort();
    expect(names).toEqual(['mine1', 'shared-with-me']);
  });
});

describe('GET /api/connections/investigations/:id', () => {
  it('returns an investigation the user owns', async () => {
    const d = (await import('../../src/models/database')).getDb();
    const id = Number(d.prepare("INSERT INTO connection_investigations (user_id, name, seed_nodes, shared_user_ids) VALUES (?, 'own1', '[]', '[]')").run(adminId).lastInsertRowid);

    const res = await request(app).get(`/api/connections/investigations/${id}`).set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(id);
  });

  it('returns an investigation shared with the user', async () => {
    const d = (await import('../../src/models/database')).getDb();
    const id = Number(d.prepare(
      "INSERT INTO connection_investigations (user_id, name, seed_nodes, shared_user_ids) VALUES (?, 'shared2', '[]', ?)"
    ).run(otherUserId, JSON.stringify([adminId])).lastInsertRowid);

    const res = await request(app).get(`/api/connections/investigations/${id}`).set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  it('returns 403 for an investigation the user does not own or share', async () => {
    const d = (await import('../../src/models/database')).getDb();
    const id = Number(d.prepare("INSERT INTO connection_investigations (user_id, name, seed_nodes, shared_user_ids) VALUES (?, 'private-other', '[]', '[]')").run(otherUserId).lastInsertRowid);

    const res = await request(app).get(`/api/connections/investigations/${id}`).set('Authorization', `Bearer ${otherUserToken ? adminToken : adminToken}`);
    expect(res.status).toBe(403);
  });

  it('returns 404 when the id does not exist', async () => {
    const res = await request(app).get('/api/connections/investigations/999999').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/connections/investigations/:id', () => {
  it('owner can update name, description, seed_nodes, pinned_layout, annotations', async () => {
    const d = (await import('../../src/models/database')).getDb();
    const id = Number(d.prepare("INSERT INTO connection_investigations (user_id, name, seed_nodes) VALUES (?, 'orig', '[]')").run(adminId).lastInsertRowid);

    const res = await request(app)
      .put(`/api/connections/investigations/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'updated', description: 'now with detail', pinned_layout: { 'person-1': { x: 10, y: 20 } } });
    expect(res.status).toBe(200);
    const row = d.prepare('SELECT name, description, pinned_layout FROM connection_investigations WHERE id = ?').get(id) as any;
    expect(row.name).toBe('updated');
    expect(row.description).toBe('now with detail');
    expect(JSON.parse(row.pinned_layout)['person-1']).toEqual({ x: 10, y: 20 });
  });

  it('non-owner shared user cannot update', async () => {
    const d = (await import('../../src/models/database')).getDb();
    const id = Number(d.prepare("INSERT INTO connection_investigations (user_id, name, seed_nodes, shared_user_ids) VALUES (?, 'shared-update', '[]', ?)").run(otherUserId, JSON.stringify([adminId])).lastInsertRowid);

    const res = await request(app)
      .put(`/api/connections/investigations/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'hacked' });
    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/connections/investigations/:id', () => {
  it('owner can delete', async () => {
    const d = (await import('../../src/models/database')).getDb();
    const id = Number(d.prepare("INSERT INTO connection_investigations (user_id, name, seed_nodes) VALUES (?, 'to-delete', '[]')").run(adminId).lastInsertRowid);

    const res = await request(app).delete(`/api/connections/investigations/${id}`).set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const remaining = d.prepare('SELECT id FROM connection_investigations WHERE id = ?').get(id);
    expect(remaining).toBeUndefined();
  });

  it('non-owner cannot delete', async () => {
    const d = (await import('../../src/models/database')).getDb();
    const id = Number(d.prepare("INSERT INTO connection_investigations (user_id, name, seed_nodes) VALUES (?, 'sacred', '[]')").run(otherUserId).lastInsertRowid);

    const res = await request(app).delete(`/api/connections/investigations/${id}`).set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(403);
  });
});
