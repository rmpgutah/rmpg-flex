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

describe('business archive/unarchive (Task 1.12)', () => {
  let archiveBizId: number;

  beforeAll(async () => {
    const { getDb } = await import('../../src/models/database');
    const db = getDb();
    const now = new Date().toISOString();
    const r = db.prepare('INSERT INTO businesses (name, created_at, updated_at) VALUES (?, ?, ?)')
      .run('ArchiveTarget LLC', now, now);
    archiveBizId = Number(r.lastInsertRowid);
  });

  it('POST /archive sets archived_at', async () => {
    const r = await request(app)
      .post(`/api/records/businesses/${archiveBizId}/archive`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
    expect(r.body.id).toBe(archiveBizId);
    const { getDb } = await import('../../src/models/database');
    const row = getDb().prepare('SELECT archived_at FROM businesses WHERE id = ?').get(archiveBizId) as any;
    expect(row.archived_at).toBeTruthy();
  });

  it('archived business excluded from /search', async () => {
    const r = await request(app)
      .get('/api/records/businesses/search?q=ArchiveTarget')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(200);
    expect(r.body.find((b: any) => b.id === archiveBizId)).toBeUndefined();
  });

  it('POST /unarchive clears archived_at', async () => {
    const r = await request(app)
      .post(`/api/records/businesses/${archiveBizId}/unarchive`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
    const { getDb } = await import('../../src/models/database');
    const row = getDb().prepare('SELECT archived_at FROM businesses WHERE id = ?').get(archiveBizId) as any;
    expect(row.archived_at).toBeNull();
  });

  it('archive 401 without auth', async () => {
    const r = await request(app).post(`/api/records/businesses/${archiveBizId}/archive`);
    expect(r.status).toBe(401);
  });

  it('archive 403 for officer role', async () => {
    const r = await request(app)
      .post(`/api/records/businesses/${archiveBizId}/archive`)
      .set('Authorization', `Bearer ${officerToken}`);
    expect(r.status).toBe(403);
  });

  it('archive 404 on bad business id', async () => {
    const r = await request(app)
      .post(`/api/records/businesses/999999/archive`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(404);
  });
});

describe('GET /api/records/businesses/:id/dossier (Task 1.18)', () => {
  let dossierBizId: number;
  let alarmBizId: number;
  let parentBizId: number;
  let viewerToken: string;
  let perfBizId: number;

  beforeAll(async () => {
    const { getDb } = await import('../../src/models/database');
    const { encryptAlarmField } = await import('../../src/utils/businessEncryption');
    const db = getDb();
    const now = new Date().toISOString();

    // ── Business with rich data for the all-keys test ──
    const bizR = db.prepare(`INSERT INTO businesses (name, parent_company, hours_of_operation, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)`).run(
      'Dossier Test Inc',
      'Acme Holdings',
      JSON.stringify({ mon: { open: '09:00', close: '17:00' }, tue: { open: '09:00', close: '17:00' } }),
      now, now,
    );
    dossierBizId = Number(bizR.lastInsertRowid);

    // Linked persons: a manager and an employee — to test sort order
    const empR = db.prepare('INSERT INTO persons (first_name, last_name) VALUES (?, ?)').run('Eve', 'Employee');
    const mgrR = db.prepare('INSERT INTO persons (first_name, last_name) VALUES (?, ?)').run('Mary', 'Manager');
    const empId = Number(empR.lastInsertRowid);
    const mgrId = Number(mgrR.lastInsertRowid);
    db.prepare(`INSERT INTO business_persons (business_id, person_id, role, created_at) VALUES (?, ?, ?, ?)`)
      .run(dossierBizId, empId, 'employee', now);
    db.prepare(`INSERT INTO business_persons (business_id, person_id, role, created_at) VALUES (?, ?, ?, ?)`)
      .run(dossierBizId, mgrId, 'manager', now);

    // Active warrant for manager
    const adminId = (db.prepare('SELECT id FROM users WHERE username = ?').get('test_admin') as any).id;
    db.prepare(`INSERT INTO warrants (warrant_number, type, status, subject_person_id, charge_description, entered_by)
      VALUES (?, ?, ?, ?, ?, ?)`).run('W-DOSS-001', 'arrest', 'active', mgrId, 'Theft', adminId);

    // ── Alarm-fields business ──
    const alarmR = db.prepare(`INSERT INTO businesses (name, alarm_panel_code, alarm_passphrase, alarm_company, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)`).run(
      'Alarm Test LLC',
      encryptAlarmField('1234'),
      encryptAlarmField('open-sesame'),
      'AcmeAlarm',
      now, now,
    );
    alarmBizId = Number(alarmR.lastInsertRowid);

    // ── Sibling businesses sharing parent_company ──
    db.prepare('INSERT INTO businesses (name, parent_company, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run('Sibling Co', 'Acme Holdings', now, now);
    const parR = db.prepare('INSERT INTO businesses (name, parent_company, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run('Parent Self', 'Acme Holdings', now, now);
    parentBizId = Number(parR.lastInsertRowid);

    // ── client_viewer user for alarm-strip test ──
    const bcryptjs = (await import('bcryptjs')).default;
    const hash = bcryptjs.hashSync('ViewerPass1!', 4);
    const userR = db.prepare(`
      INSERT INTO users (username, password_hash, full_name, email, role, status, must_change_password, totp_exempt, password_changed_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'active', 0, 1, ?, ?, ?)
    `).run('test_viewer', hash, 'Test Viewer', 'viewer@example.com', 'client_viewer', now, now, now);
    void userR;
    const viewerLogin = await request(app).post('/api/auth/login').send({ username: 'test_viewer', password: 'ViewerPass1!' });
    viewerToken = viewerLogin.body.token;

    // ── Perf business: 50 incidents + 50 calls ──
    const perfR = db.prepare('INSERT INTO businesses (name, created_at, updated_at) VALUES (?, ?, ?)')
      .run('PerfStress Co', now, now);
    perfBizId = Number(perfR.lastInsertRowid);
    const insIncident = db.prepare(`INSERT INTO incidents (incident_type, officer_id, created_at) VALUES (?, ?, ?)`);
    const insIncidentLink = db.prepare(`INSERT INTO incident_businesses (incident_id, business_id) VALUES (?, ?)`);
    const insCall = db.prepare(`INSERT INTO calls_for_service (incident_type, priority, location_address, created_at) VALUES (?, ?, ?, ?)`);
    const insCallLink = db.prepare(`INSERT INTO call_businesses (call_id, business_id) VALUES (?, ?)`);
    db.transaction(() => {
      for (let i = 0; i < 50; i++) {
        const incTime = new Date(Date.now() - i * 86400000).toISOString();
        const inc = insIncident.run('Theft', adminId, incTime);
        insIncidentLink.run(Number(inc.lastInsertRowid), perfBizId);
        const c = insCall.run('Disturbance', 'P3', '100 Main St', incTime);
        insCallLink.run(Number(c.lastInsertRowid), perfBizId);
      }
    })();
  });

  it('returns 404 on unknown business id', async () => {
    const r = await request(app)
      .get('/api/records/businesses/999999/dossier')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(404);
  });

  it('returns 200 with all expected top-level keys', async () => {
    const r = await request(app)
      .get(`/api/records/businesses/${dossierBizId}/dossier`)
      .set('Authorization', `Bearer ${officerToken}`);
    expect(r.status).toBe(200);
    const keys = Object.keys(r.body);
    for (const k of [
      'business', 'linked_persons', 'active_trespass_orders', 'recent_activity',
      'alarm_info', 'hours', 'photos', 'vehicles', 'visits',
      'related_businesses', 'active_bolos', 'heatmap', 'trend', 'risk_score', 'meta',
    ]) {
      expect(keys).toContain(k);
    }
  });

  it('decrypts alarm_info.panel_code for officer role', async () => {
    const r = await request(app)
      .get(`/api/records/businesses/${alarmBizId}/dossier`)
      .set('Authorization', `Bearer ${officerToken}`);
    expect(r.status).toBe(200);
    expect(r.body.alarm_info).toBeDefined();
    expect(r.body.alarm_info.panel_code).toBe('1234');
    expect(r.body.alarm_info.passphrase).toBe('open-sesame');
  });

  it('strips alarm_info entirely for client_viewer role', async () => {
    expect(viewerToken).toBeTruthy();
    const r = await request(app)
      .get(`/api/records/businesses/${alarmBizId}/dossier`)
      .set('Authorization', `Bearer ${viewerToken}`);
    expect(r.status).toBe(200);
    expect(r.body.alarm_info).toBeUndefined();
  });

  it('heatmap is 7×6 even with no events', async () => {
    const { getDb } = await import('../../src/models/database');
    const db = getDb();
    const empty = db.prepare('INSERT INTO businesses (name, created_at, updated_at) VALUES (?, ?, ?)')
      .run('Empty Biz', new Date().toISOString(), new Date().toISOString());
    const r = await request(app)
      .get(`/api/records/businesses/${Number(empty.lastInsertRowid)}/dossier`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.heatmap)).toBe(true);
    expect(r.body.heatmap).toHaveLength(7);
    expect(r.body.heatmap[0]).toHaveLength(6);
  });

  it('linked_persons sorted by role priority (manager before employee)', async () => {
    const r = await request(app)
      .get(`/api/records/businesses/${dossierBizId}/dossier`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(200);
    const roles = r.body.linked_persons.map((lp: any) => lp.role);
    const mgrIdx = roles.indexOf('manager');
    const empIdx = roles.indexOf('employee');
    expect(mgrIdx).toBeGreaterThanOrEqual(0);
    expect(empIdx).toBeGreaterThanOrEqual(0);
    expect(mgrIdx).toBeLessThan(empIdx);
  });

  it('linked_person.person includes active_warrant_count', async () => {
    const r = await request(app)
      .get(`/api/records/businesses/${dossierBizId}/dossier`)
      .set('Authorization', `Bearer ${adminToken}`);
    const mgr = r.body.linked_persons.find((lp: any) => lp.role === 'manager');
    expect(mgr).toBeDefined();
    expect(mgr.person.active_warrant_count).toBe(1);
    const emp = r.body.linked_persons.find((lp: any) => lp.role === 'employee');
    expect(emp.person.active_warrant_count).toBe(0);
  });

  it('hours.is_currently_open is a boolean', async () => {
    const r = await request(app)
      .get(`/api/records/businesses/${dossierBizId}/dossier`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(typeof r.body.hours.is_currently_open).toBe('boolean');
  });

  it('related_businesses populated when parent_company matches', async () => {
    const r = await request(app)
      .get(`/api/records/businesses/${parentBizId}/dossier`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.related_businesses)).toBe(true);
    const names = r.body.related_businesses.map((b: any) => b.name);
    expect(names).toContain('Sibling Co');
    expect(names).toContain('Dossier Test Inc');
    // Self excluded
    expect(names).not.toContain('Parent Self');
  });

  it('risk_score.level is one of low/moderate/high/critical', async () => {
    const r = await request(app)
      .get(`/api/records/businesses/${dossierBizId}/dossier`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(['low', 'moderate', 'high', 'critical']).toContain(r.body.risk_score.level);
    expect(typeof r.body.risk_score.score).toBe('number');
  });

  it('completes in <500ms for 50 incidents + 50 calls', async () => {
    const t0 = Date.now();
    const r = await request(app)
      .get(`/api/records/businesses/${perfBizId}/dossier`)
      .set('Authorization', `Bearer ${adminToken}`);
    const elapsed = Date.now() - t0;
    expect(r.status).toBe(200);
    expect(elapsed).toBeLessThan(500);
    expect(r.body.recent_activity.counts.incident_count).toBe(50);
    expect(r.body.recent_activity.counts.call_count).toBe(50);
  });

  it('returns 401 without auth', async () => {
    const r = await request(app).get(`/api/records/businesses/${dossierBizId}/dossier`);
    expect(r.status).toBe(401);
  });
});
