// test-workers/forensicsHashes.test.ts
//
// Route-level test (Miniflare/workerd) for the forensic exhibit hash
// endpoints. Covers the tamper-evidence contract: intake hash recorded
// clean, a differing re-verify hash gets flagged as a mismatch, and the
// GET /:caseId/hashes stats roll up correctly.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { execute } from '../src/utils/db';
import forensics from '../src/routes/forensics';

const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: { id: number; role: string; username: string }; userId: number } }>();
app.use('*', async (c, next) => {
  c.set('user', { id: 1, role: 'admin', username: 'test-examiner' });
  c.set('userId', 1);
  await next();
});
app.route('/api/forensic-lab', forensics);

beforeAll(async () => {
  const db = (env as unknown as { DB: D1Database }).DB;
  await execute(db, `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT, full_name TEXT, role TEXT
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS forensic_cases (
    id INTEGER PRIMARY KEY AUTOINCREMENT, lab_number TEXT UNIQUE NOT NULL,
    case_type TEXT NOT NULL DEFAULT 'general', status TEXT NOT NULL DEFAULT 'received',
    priority TEXT NOT NULL DEFAULT 'normal', title TEXT NOT NULL, description TEXT,
    requesting_agency TEXT, requesting_officer TEXT, lead_examiner_id INTEGER,
    linked_incident_id INTEGER, linked_case_id INTEGER, linked_incident_number TEXT,
    linked_case_number TEXT, received_date TEXT NOT NULL DEFAULT (datetime('now')),
    due_date TEXT, completed_date TEXT, released_date TEXT, notes TEXT,
    metadata TEXT DEFAULT '{}', report_sections TEXT, archived_at TEXT,
    created_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS forensic_exhibits (
    id INTEGER PRIMARY KEY AUTOINCREMENT, forensic_case_id INTEGER NOT NULL,
    exhibit_number TEXT NOT NULL, exhibit_type TEXT NOT NULL DEFAULT 'other',
    description TEXT NOT NULL, hash_md5 TEXT, hash_sha256 TEXT,
    chain_of_custody TEXT DEFAULT '[]', disposition TEXT DEFAULT 'in_lab',
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS forensic_exhibit_hashes (
    id INTEGER PRIMARY KEY AUTOINCREMENT, forensic_case_id INTEGER NOT NULL,
    exhibit_id INTEGER NOT NULL, algorithm TEXT NOT NULL, hash_value TEXT NOT NULL,
    purpose TEXT NOT NULL DEFAULT 'intake', file_name TEXT, mismatch INTEGER NOT NULL DEFAULT 0,
    computed_by INTEGER, computed_by_name TEXT, computed_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS forensic_activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, forensic_case_id INTEGER NOT NULL,
    exhibit_id INTEGER, action TEXT NOT NULL, details TEXT,
    performed_by INTEGER, performed_by_name TEXT, performed_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS forensic_hash_sets (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, set_type TEXT NOT NULL
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS forensic_hash_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT, hash_set_id INTEGER NOT NULL,
    hash_value TEXT NOT NULL, hash_type TEXT NOT NULL
  )`);
  await execute(db, `INSERT INTO users (id, full_name, role) VALUES (1, 'Test Examiner', 'admin')`);
});

describe('POST /:caseId/exhibits/:exhibitId/hashes — tamper-evidence', () => {
  it('records a clean intake hash with mismatch=false', async () => {
    const db = (env as unknown as { DB: D1Database }).DB;
    await execute(db, `INSERT INTO forensic_cases (id, lab_number, title) VALUES (1, 'LAB-26-0001', 'Test Case')`);
    await execute(db, `INSERT INTO forensic_exhibits (id, forensic_case_id, exhibit_number, description) VALUES (1, 1, 'E-001', 'Hard drive')`);

    const res = await app.request('/api/forensic-lab/1/exhibits/1/hashes', {
      method: 'POST', body: JSON.stringify({ algorithm: 'sha256', hash_value: 'AABBCC', purpose: 'intake' }),
    }, env as unknown as Record<string, unknown>);

    expect(res.status).toBe(201);
    const body = await res.json() as { mismatch: boolean; data: { hash_value: string } };
    expect(body.mismatch).toBe(false);
    expect(body.data.hash_value).toBe('aabbcc'); // lowercased for consistent comparison
  });

  it('flags a differing re-verify hash as a mismatch', async () => {
    const res = await app.request('/api/forensic-lab/1/exhibits/1/hashes', {
      method: 'POST', body: JSON.stringify({ algorithm: 'sha256', hash_value: 'DDEEFF', purpose: 'reverify' }),
    }, env as unknown as Record<string, unknown>);

    expect(res.status).toBe(201);
    const body = await res.json() as { mismatch: boolean };
    expect(body.mismatch).toBe(true);
  });

  it('GET /:caseId/hashes rolls up total/flagged stats', async () => {
    const res = await app.request('/api/forensic-lab/1/hashes', {}, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as { hashes: unknown[]; stats: { total: number; flagged: number } };
    expect(body.stats.total).toBe(2);
    expect(body.stats.flagged).toBe(1); // the mismatch row
  });
});
