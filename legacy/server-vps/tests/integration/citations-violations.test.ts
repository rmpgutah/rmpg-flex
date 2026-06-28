import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { setupTestDataDir, teardownTestDataDir, createTestAdmin } from '../helpers/testDb';

let app: any;
let token: string;
let testDir: string;

beforeAll(async () => {
  testDir = setupTestDataDir();
  const { initDatabase } = await import('../../src/models/database');
  const db = initDatabase();
  const admin = createTestAdmin(db);
  const { createTestApp } = await import('../helpers/testApp');
  app = await createTestApp();
  const r = await request(app).post('/api/auth/login').send({ username: admin.username, password: admin.password });
  token = r.body.token;
});
afterAll(() => teardownTestDataDir(testDir));

const auth = (req: request.Test) => req.set('Authorization', `Bearer ${token}`);

describe('POST /api/citations with violations[]', () => {
  it('creates citation + violations atomically', async () => {
    const res = await auth(request(app).post('/api/citations').send({
      type: 'traffic',
      person_name: 'Test Subject',
      violation_date: '2026-05-06',
      violations: [
        { statute_citation: 'UCA 41-6a-601', description: 'Speeding', offense_level: 'Infraction', fine_amount: 175 },
        { statute_citation: 'UCA 41-6a-92', description: 'Failure to signal', offense_level: 'Infraction', fine_amount: 50 },
      ],
    }));
    expect([200, 201]).toContain(res.status);
    expect(res.body.id).toBeDefined();
    const { getDb } = await import('../../src/models/database');
    const rows = getDb().prepare('SELECT * FROM citation_violations WHERE citation_id = ? ORDER BY id').all(res.body.id);
    expect(rows).toHaveLength(2);
  });

  it('omitting violations preserves single-violation back-compat', async () => {
    const res = await auth(request(app).post('/api/citations').send({
      type: 'traffic',
      person_name: 'Back-compat Subject',
      violation_date: '2026-05-06',
      violation_description: 'Single violation back-compat',
      statute_citation: 'UCA 1-1-1',
      fine_amount: 100,
    }));
    expect([200, 201]).toContain(res.status);
    const { getDb } = await import('../../src/models/database');
    const rows = getDb().prepare('SELECT * FROM citation_violations WHERE citation_id = ?').all(res.body.id);
    expect(rows).toHaveLength(0);
  });
});

describe('PUT /api/citations/:id with violations[]', () => {
  it('replaces all violations (delete + insert in transaction)', async () => {
    const created = await auth(request(app).post('/api/citations').send({
      type: 'traffic',
      person_name: 'PUT-Test',
      violation_date: '2026-05-06',
      violations: [{ statute_citation: 'A', description: 'a', offense_level: 'Infraction', fine_amount: 10 }],
    }));
    const id = created.body.id;

    const updated = await auth(request(app).put(`/api/citations/${id}`).send({
      violations: [
        { statute_citation: 'B', description: 'b', offense_level: 'Misdemeanor', fine_amount: 200 },
        { statute_citation: 'C', description: 'c', offense_level: 'Infraction', fine_amount: 50 },
      ],
    }));
    expect(updated.status).toBe(200);
    const { getDb } = await import('../../src/models/database');
    const rows = getDb().prepare<unknown[], { statute_citation: string; fine_amount: number }>('SELECT statute_citation, fine_amount FROM citation_violations WHERE citation_id = ? ORDER BY id').all(id);
    expect(rows.map((r) => r.statute_citation)).toEqual(['B', 'C']);
    expect(rows.map((r) => r.fine_amount)).toEqual([200, 50]);
  });
});
