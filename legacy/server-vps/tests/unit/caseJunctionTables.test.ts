import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDataDir, teardownTestDataDir } from '../helpers/testDb';

let testDir: string;

beforeAll(async () => {
  testDir = setupTestDataDir();
  const { initDatabase } = await import('../../src/models/database');
  initDatabase();
});

afterAll(() => { teardownTestDataDir(testDir); });

describe('case junction tables', () => {
  it('case_person_links table exists with the right columns', async () => {
    const { getDb } = await import('../../src/models/database');
    const d = getDb();
    const cols = d.prepare("PRAGMA table_info(case_person_links)").all() as any[];
    const names = cols.map((c: any) => c.name);
    expect(names).toEqual(expect.arrayContaining(['case_id', 'person_id', 'relationship']));
  });

  it('case_incident_links table exists with the right columns', async () => {
    const { getDb } = await import('../../src/models/database');
    const d = getDb();
    const cols = d.prepare("PRAGMA table_info(case_incident_links)").all() as any[];
    const names = cols.map((c: any) => c.name);
    expect(names).toEqual(expect.arrayContaining(['case_id', 'incident_id']));
  });

  it('case_evidence_links table exists with the right columns', async () => {
    const { getDb } = await import('../../src/models/database');
    const d = getDb();
    const cols = d.prepare("PRAGMA table_info(case_evidence_links)").all() as any[];
    const names = cols.map((c: any) => c.name);
    expect(names).toEqual(expect.arrayContaining(['case_id', 'evidence_id']));
  });

  it('case_person_links UNIQUE constraint prevents duplicates', async () => {
    const { getDb } = await import('../../src/models/database');
    const d = getDb();
    // Create a fake case + person. `cases` requires created_by NOT NULL; use seeded admin (id=1).
    const caseId = Number(d.prepare(
      "INSERT INTO cases (case_number, title, case_type, status, created_by) VALUES ('CASE-JN-001', 'Junction Test', 'investigation', 'open', 1)"
    ).run().lastInsertRowid);
    const personId = Number(d.prepare(
      "INSERT INTO persons (first_name, last_name) VALUES ('JN', 'Test')"
    ).run().lastInsertRowid);
    d.prepare("INSERT INTO case_person_links (case_id, person_id) VALUES (?, ?)").run(caseId, personId);
    // Second insert should throw
    expect(() =>
      d.prepare("INSERT INTO case_person_links (case_id, person_id) VALUES (?, ?)").run(caseId, personId)
    ).toThrow();
  });

  it('case_person_links indexes exist', async () => {
    const { getDb } = await import('../../src/models/database');
    const d = getDb();
    const idxs = d.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='case_person_links'").all() as any[];
    const names = idxs.map((i: any) => i.name);
    expect(names).toEqual(expect.arrayContaining(['idx_cpl_case', 'idx_cpl_person']));
  });
});
