import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDataDir, teardownTestDataDir } from '../helpers/testDb';

let testDir: string;

beforeAll(async () => {
  testDir = setupTestDataDir();
});

afterAll(() => { teardownTestDataDir(testDir); });

describe('case links backfill', () => {
  it('migrates cases.linked_persons JSON array into case_person_links', async () => {
    const { initDatabase, getDb } = await import('../../src/models/database');
    initDatabase();
    const d = getDb();

    // Seed: create 2 persons + 1 case with linked_persons JSON = [p1, p2]
    const p1 = Number(d.prepare("INSERT INTO persons (first_name, last_name) VALUES ('A','One')").run().lastInsertRowid);
    const p2 = Number(d.prepare("INSERT INTO persons (first_name, last_name) VALUES ('B','Two')").run().lastInsertRowid);
    const caseId = Number(d.prepare(
      "INSERT INTO cases (case_number, title, case_type, status, created_by, linked_persons) VALUES ('CASE-BF-01', 'T', 'investigation', 'open', 1, ?)"
    ).run(JSON.stringify([p1, p2])).lastInsertRowid);

    // Junction table should be empty at this point (backfill hasn't run on this seeded data)
    const before = d.prepare("SELECT COUNT(*) as c FROM case_person_links WHERE case_id = ?").get(caseId) as any;
    expect(before.c).toBe(0);

    // Run the backfill directly
    const { backfillCaseLinks } = await import('../../src/migrations/2026-04-19-case-links-backfill');
    backfillCaseLinks(d);

    const after = d.prepare("SELECT person_id FROM case_person_links WHERE case_id = ? ORDER BY person_id").all(caseId) as any[];
    expect(after.map(r => r.person_id).sort((a, b) => a - b)).toEqual([p1, p2].sort((a, b) => a - b));
  });

  it('is idempotent — running twice produces the same rows', async () => {
    const { getDb } = await import('../../src/models/database');
    const { backfillCaseLinks } = await import('../../src/migrations/2026-04-19-case-links-backfill');
    const d = getDb();
    const before = d.prepare("SELECT COUNT(*) as c FROM case_person_links").get() as any;
    backfillCaseLinks(d);
    backfillCaseLinks(d);
    const after = d.prepare("SELECT COUNT(*) as c FROM case_person_links").get() as any;
    expect(after.c).toBe(before.c);
  });

  it('handles malformed JSON gracefully (skip, do not throw)', async () => {
    const { getDb } = await import('../../src/models/database');
    const { backfillCaseLinks } = await import('../../src/migrations/2026-04-19-case-links-backfill');
    const d = getDb();
    const caseId = Number(d.prepare(
      "INSERT INTO cases (case_number, title, case_type, status, created_by, linked_persons) VALUES ('CASE-BF-02', 'T', 'investigation', 'open', 1, 'not json at all')"
    ).run().lastInsertRowid);

    expect(() => backfillCaseLinks(d)).not.toThrow();
    const rows = d.prepare("SELECT COUNT(*) as c FROM case_person_links WHERE case_id = ?").get(caseId) as any;
    expect(rows.c).toBe(0);
  });

  it('backfills linked_incidents into case_incident_links', async () => {
    const { getDb } = await import('../../src/models/database');
    const { backfillCaseLinks } = await import('../../src/migrations/2026-04-19-case-links-backfill');
    const d = getDb();
    const incId = Number(d.prepare(
      "INSERT INTO incidents (incident_number, incident_type, status, officer_id) VALUES ('I-BF-001', 'theft', 'submitted', 1)"
    ).run().lastInsertRowid);
    const caseId = Number(d.prepare(
      "INSERT INTO cases (case_number, title, case_type, status, created_by, linked_incidents) VALUES ('CASE-BF-03', 'T', 'investigation', 'open', 1, ?)"
    ).run(JSON.stringify([incId])).lastInsertRowid);

    backfillCaseLinks(d);
    const row = d.prepare("SELECT incident_id FROM case_incident_links WHERE case_id = ?").get(caseId) as any;
    expect(row?.incident_id).toBe(incId);
  });

  it('backfills linked_evidence into case_evidence_links', async () => {
    const { getDb } = await import('../../src/models/database');
    const { backfillCaseLinks } = await import('../../src/migrations/2026-04-19-case-links-backfill');
    const d = getDb();
    // evidence.incident_id is NOT NULL — create an incident first
    const incId = Number(d.prepare(
      "INSERT INTO incidents (incident_number, incident_type, status, officer_id) VALUES ('I-BF-EV', 'theft', 'submitted', 1)"
    ).run().lastInsertRowid);
    const evId = Number(d.prepare(
      "INSERT INTO evidence (evidence_number, incident_id, description) VALUES ('EV-BF-001', ?, 'test')"
    ).run(incId).lastInsertRowid);
    const caseId = Number(d.prepare(
      "INSERT INTO cases (case_number, title, case_type, status, created_by, linked_evidence) VALUES ('CASE-BF-04', 'T', 'investigation', 'open', 1, ?)"
    ).run(JSON.stringify([evId])).lastInsertRowid);

    backfillCaseLinks(d);
    const row = d.prepare("SELECT evidence_id FROM case_evidence_links WHERE case_id = ?").get(caseId) as any;
    expect(row?.evidence_id).toBe(evId);
  });
});
