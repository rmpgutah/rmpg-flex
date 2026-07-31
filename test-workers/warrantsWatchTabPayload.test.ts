// test-workers/warrantsWatchTabPayload.test.ts
//
// GET /warrants/utah-search/auto-poll-status must return the NESTED shape the
// Watch List tab actually reads.
//
// The route returned a FLAT payload (`lastSync`, `lastPersonsChecked`,
// `activeWarrants`, …) while WarrantsPage.tsx reads `res.syncStatus.lastSync`,
// `res.totalPersons`, `res.runs`, `res.flaggedPersons` and `res.recentHits`.
// Every one resolved to undefined, and the client's defensive `?? []` / `?? 0`
// normalization turned that total mismatch into a confident "empty but working"
// tab. Verified live 2026-07-31: "PERSONS MONITORED 0", "WARRANT HITS 0",
// "LAST SCAN: Never" and a blank body, immediately after a run that checked 83
// people and found 37 warrants.
//
// These tests assert NON-ZERO / NON-NULL values against seeded data. Asserting
// only "the key exists" would pass against the very defaults that hid the bug.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { execute } from '../src/utils/db';
import warrants from '../src/routes/warrants';

const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: { id: number; role: string } } }>();
app.use('*', async (c, next) => {
  c.set('user', { id: 1, role: 'admin' });
  await next();
});
app.route('/api/warrants', warrants);

function db() {
  return (env as unknown as { DB: D1Database }).DB;
}

beforeEach(async () => {
  await execute(db(), `CREATE TABLE IF NOT EXISTS warrant_watch_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT, started_at TEXT, completed_at TEXT,
    persons_checked INTEGER DEFAULT 0, new_warrants_found INTEGER DEFAULT 0,
    warrants_cleared INTEGER DEFAULT 0, errors INTEGER DEFAULT 0,
    status TEXT DEFAULT 'running', error_message TEXT
  )`);
  await execute(db(), `CREATE TABLE IF NOT EXISTS persons (
    id INTEGER PRIMARY KEY AUTOINCREMENT, first_name TEXT, last_name TEXT, dob TEXT,
    gender TEXT, race TEXT, height TEXT, weight TEXT, hair_color TEXT, eye_color TEXT,
    address TEXT, photo_url TEXT
  )`);
  await execute(db(), `CREATE TABLE IF NOT EXISTS utah_warrants (
    id INTEGER PRIMARY KEY AUTOINCREMENT, utah_person_id TEXT, utah_warrant_id TEXT,
    first_name TEXT, last_name TEXT, age INTEGER, city TEXT, issue_date TEXT,
    court_name TEXT, case_id TEXT, charges TEXT, person_id INTEGER,
    first_seen_at TEXT, last_seen_at TEXT, is_active INTEGER DEFAULT 1, source TEXT
  )`);
  await execute(db(), `CREATE TABLE IF NOT EXISTS warrant_watch_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, person_id INTEGER, person_name TEXT,
    event TEXT NOT NULL, utah_warrant_id TEXT, court_name TEXT, charges TEXT, created_at TEXT
  )`);
  for (const t of ['warrant_watch_runs', 'persons', 'utah_warrants', 'warrant_watch_log']) {
    await execute(db(), `DELETE FROM ${t}`);
  }

  // A run that finished, mirroring live run 755 (83 checked / 37 found / 7 cleared).
  await execute(db(),
    `INSERT INTO warrant_watch_runs (run_id, started_at, completed_at, persons_checked,
      new_warrants_found, warrants_cleared, errors, status)
     VALUES ('utah-live', '2026-07-31T04:01:00.000Z', '2026-07-31T04:14:36.000Z', 83, 37, 7, 0, 'completed')`);
  await execute(db(),
    `INSERT INTO persons (id, first_name, last_name, dob) VALUES (5, 'Jane', 'Roe', '1990-01-01'), (6, 'No', 'Dob', NULL)`);
  await execute(db(),
    `INSERT INTO utah_warrants (utah_warrant_id, person_id, charges, court_name, issue_date, is_active, last_seen_at, first_name, last_name)
     VALUES ('UW-1', 5, 'THEFT', 'SLC JUSTICE', '2026-01-01', 1, '2026-07-31T04:00:00Z', 'Jane', 'Roe'),
            ('UW-2', 6, 'ASSAULT', 'MURRAY', '2026-02-01', 1, '2026-07-31T03:00:00Z', 'No', 'Dob')`);
  await execute(db(),
    `INSERT INTO warrant_watch_log (person_id, person_name, event, charges, created_at)
     VALUES (5, 'Jane Roe', 'warrant_found', 'THEFT', '2026-07-31T04:10:00Z')`);
});

async function status() {
  const res = await app.request('/api/warrants/utah-search/auto-poll-status', {}, env as unknown as Record<string, unknown>);
  expect(res.status).toBe(200);
  return await res.json() as Record<string, any>;
}

describe('GET /warrants/utah-search/auto-poll-status — Watch List contract', () => {
  it('nests syncStatus.lastSync with a REAL date, not null', async () => {
    const s = await status();
    // The live symptom was "LAST SCAN: Never" — i.e. this resolving to null.
    expect(s.syncStatus).toBeDefined();
    expect(s.syncStatus.lastSync).toBe('2026-07-31T04:14:36.000Z');
    expect(s.syncStatus.lastSync).not.toBeNull();
    expect(s.syncStatus.status).toBe('completed');
  });

  it('reports totalPersons non-zero — the "PERSONS MONITORED 0" symptom', async () => {
    const s = await status();
    expect(s.totalPersons).toBe(2);
    expect(s.totalPersons).not.toBe(0);
  });

  it('returns the run history the tab lists', async () => {
    const s = await status();
    expect(Array.isArray(s.runs)).toBe(true);
    expect(s.runs.length).toBeGreaterThan(0);
    expect(s.runs[0]).toMatchObject({ run_id: 'utah-live', persons_checked: 83, new_warrants_found: 37 });
  });

  it('returns flaggedPersons with their Utah warrants attached', async () => {
    const s = await status();
    expect(s.flaggedPersons.length).toBe(2);
    const jane = s.flaggedPersons.find((p: any) => p.last_name === 'Roe');
    expect(jane.utahWarrants.length).toBe(1);
    expect(jane.utahWarrants[0].charges).toBe('THEFT');
  });

  it('marks a DOB-less flagged person unverified (possible namesake, not a match)', async () => {
    const s = await status();
    expect(s.flaggedPersons.find((p: any) => p.last_name === 'Roe').unverified).toBe(false);
    expect(s.flaggedPersons.find((p: any) => p.last_name === 'Dob').unverified).toBe(true);
  });

  it('returns recentHits from the watch log', async () => {
    const s = await status();
    expect(s.recentHits.length).toBe(1);
    expect(s.recentHits[0]).toMatchObject({ person_name: 'Jane Roe', event: 'warrant_found' });
  });

  it('KEEPS the flat keys, so /utah/sync-status readers do not break', async () => {
    const s = await status();
    // Backwards compatibility: the response is a SUPERSET, not a replacement.
    expect(s.lastSync).toBe('2026-07-31T04:14:36.000Z');
    expect(s.lastPersonsChecked).toBe(83);
    expect(s.lastNewWarrants).toBe(37);
    expect(s.isRunning).toBe(false);
  });

  it('the sibling flat endpoints still respond with the flat shape', async () => {
    for (const p of ['/api/warrants/utah/sync-status', '/api/warrants/scraped/status']) {
      const res = await app.request(p, {}, env as unknown as Record<string, unknown>);
      expect(res.status).toBe(200);
      const j = await res.json() as Record<string, any>;
      expect(j.lastPersonsChecked).toBe(83);
    }
  });
});
