// ============================================================
// Cases Integration Tests
// Verifies the mirror-write from legacy linked_* JSON columns to
// the new case_*_links junction tables (Task 3.3 of the
// Connections Analyst Tool plan).
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';
import { setupTestDataDir, teardownTestDataDir, createTestAdmin } from '../helpers/testDb';

let app: Application;
let testDir: string;
let adminToken: string;
let personA: number;
let personB: number;
let personC: number;

beforeAll(async () => {
  testDir = setupTestDataDir();
  const { initDatabase, getDb } = await import('../../src/models/database');
  const db = initDatabase();
  const admin = createTestAdmin(db);
  const { createTestApp } = await import('../helpers/testApp');
  app = await createTestApp();

  const loginRes = await request(app)
    .post('/api/auth/login')
    .send({ username: admin.username, password: admin.password });
  adminToken = loginRes.body.token;

  const d = getDb();
  personA = Number(d.prepare("INSERT INTO persons (first_name, last_name) VALUES ('Case','PersonA')").run().lastInsertRowid);
  personB = Number(d.prepare("INSERT INTO persons (first_name, last_name) VALUES ('Case','PersonB')").run().lastInsertRowid);
  personC = Number(d.prepare("INSERT INTO persons (first_name, last_name) VALUES ('Case','PersonC')").run().lastInsertRowid);
});

afterAll(() => { teardownTestDataDir(testDir); });

describe('Case mirror-write: linked_persons → case_person_links', () => {
  it('POST /api/cases with linked_persons mirrors to case_person_links', async () => {
    const res = await request(app)
      .post('/api/cases')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'Mirror Write POST Test',
        case_type: 'investigation',
        linked_persons: [personA, personB],
      });
    expect([200, 201]).toContain(res.status);
    const caseId = res.body.data.id;

    const { getDb } = await import('../../src/models/database');
    const d = getDb();
    const rows = d.prepare('SELECT person_id FROM case_person_links WHERE case_id = ? ORDER BY person_id').all(caseId) as any[];
    expect(rows.map(r => r.person_id).sort()).toEqual([personA, personB].sort());
  });

  it('PUT /api/cases/:id with changed linked_persons replaces junction rows', async () => {
    // Create case with personA, personB
    const createRes = await request(app)
      .post('/api/cases')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: 'Mirror Write PUT Test', case_type: 'investigation', linked_persons: [personA, personB] });
    expect([200, 201]).toContain(createRes.status);
    const caseId = createRes.body.data.id;

    // Update to only personC
    const putRes = await request(app)
      .put(`/api/cases/${caseId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ linked_persons: [personC] });
    expect(putRes.status).toBe(200);

    const { getDb } = await import('../../src/models/database');
    const d = getDb();
    const rows = d.prepare('SELECT person_id FROM case_person_links WHERE case_id = ?').all(caseId) as any[];
    expect(rows.map(r => r.person_id)).toEqual([personC]);
  });

  it('POST /api/cases with no links creates zero junction rows', async () => {
    const res = await request(app)
      .post('/api/cases')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: 'Empty Links Case', case_type: 'investigation' });
    expect([200, 201]).toContain(res.status);
    const caseId = res.body.data.id;

    const { getDb } = await import('../../src/models/database');
    const d = getDb();
    const rows = d.prepare('SELECT person_id FROM case_person_links WHERE case_id = ?').all(caseId) as any[];
    expect(rows).toEqual([]);
  });
});
