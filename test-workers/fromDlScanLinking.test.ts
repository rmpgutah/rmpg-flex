// test-workers/fromDlScanLinking.test.ts
// Route-level test (Miniflare/workerd) for POST /api/records/from-dl-scan's
// full field persistence + auto-linking: dl_records upsert, current-call/case
// linking, warrant backfill + surfacing, prior-call/open-case surfacing.
//
// Auth note: unlike alprCapture.test.ts, this suite does NOT mint a JWT.
// test-workers/entry.ts (the shared minimal test app) injects a fixed
// { role: 'admin' } user via middleware ahead of every mounted router —
// real JWT verification happens in src/middleware/auth.ts, which is applied
// per-prefix in src/index.ts and is NOT part of this test harness. Routes
// here read c.get('user')/c.get('userId'), which the injected middleware
// already sets, so requests are sent with no Authorization header.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { execute, query } from '../src/utils/db';
import app from './entry';

// Requests go through app.request(path, init, env, executionCtx) — the 4th
// arg is required because from-dl-scan's SOR auto-screen fires via
// c.executionCtx.waitUntil(); without a stub ExecutionContext, Hono throws
// "This context has no ExecutionContext" before the handler can respond.
const testExecutionCtx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

async function resetTables() {
  const db = (env as unknown as { DB: D1Database }).DB;
  for (const t of [
    'persons_ext', 'persons', 'dl_records', 'dl_addresses', 'vehicles_records', 'properties',
    'warrants', 'call_persons', 'calls_for_service', 'case_person_links', 'case_calls', 'cases', 'clients',
  ]) {
    await execute(db, `DROP TABLE IF EXISTS ${t}`);
  }
  // properties.client_id is NOT NULL + FKs to clients(id); from-dl-scan
  // creates a sentinel client row the first time a property is created from
  // a scan address (ensureScanSentinelClient), so the table must exist.
  await execute(db, `CREATE TABLE clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, contact_name TEXT, status TEXT, notes TEXT
  )`);
  await execute(db, `CREATE TABLE persons (
    id INTEGER PRIMARY KEY AUTOINCREMENT, first_name TEXT, middle_name TEXT, last_name TEXT, dob TEXT,
    gender TEXT, height TEXT, weight TEXT, eye_color TEXT, hair_color TEXT,
    address TEXT, city TEXT, state TEXT, zip TEXT, dl_number TEXT, dl_state TEXT,
    dl_expiry TEXT, dl_class TEXT, is_veteran INTEGER, flags TEXT, notes TEXT, created_at TEXT
  )`);
  await execute(db, `CREATE TABLE persons_ext (
    person_id INTEGER PRIMARY KEY, suffix TEXT, nationality TEXT, voice_description TEXT,
    religion TEXT, dietary_restrictions TEXT, address_2 TEXT,
    dl_restrictions TEXT, dl_endorsements TEXT, dl_issue_date TEXT,
    country TEXT, document_discriminator TEXT, is_real_id INTEGER, is_organ_donor INTEGER,
    under_18_until TEXT, under_21_until TEXT, aamva_version INTEGER, issuer_id TEXT,
    address2 TEXT, raw_aamva_elements TEXT
  )`);
  await execute(db, `CREATE TABLE dl_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT, dl_number TEXT, dl_state TEXT, dl_class TEXT, dl_status TEXT,
    dl_expiration TEXT, dl_issue_date TEXT, dl_restrictions TEXT, dl_endorsements TEXT,
    first_name TEXT, middle_name TEXT, last_name TEXT, full_name TEXT, suffix TEXT,
    date_of_birth TEXT, gender TEXT, height TEXT, weight TEXT, eye_color TEXT, hair_color TEXT, race TEXT,
    source TEXT, raw_record TEXT, fetched_at TEXT, updated_at TEXT
  )`);
  await execute(db, `CREATE TABLE dl_addresses (
    id INTEGER PRIMARY KEY AUTOINCREMENT, dl_record_id INTEGER, address TEXT, address2 TEXT,
    city TEXT, state TEXT, postal_code TEXT, country TEXT
  )`);
  await execute(db, `CREATE TABLE vehicles_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT, plate_number TEXT, state TEXT, vin TEXT, make TEXT,
    model TEXT, year TEXT, color TEXT, owner_person_id INTEGER, registered_owner TEXT,
    notes TEXT, created_at TEXT
  )`);
  await execute(db, `CREATE TABLE properties (
    id INTEGER PRIMARY KEY AUTOINCREMENT, client_id INTEGER, name TEXT, address TEXT, city TEXT,
    state TEXT, zip TEXT, property_type TEXT, occupancy_status TEXT, owner_name TEXT,
    notes TEXT, is_active INTEGER, created_at TEXT
  )`);
  await execute(db, `CREATE TABLE warrants (
    id INTEGER PRIMARY KEY AUTOINCREMENT, warrant_number TEXT, warrant_type TEXT, status TEXT DEFAULT 'active',
    subject_person_id INTEGER, subject_first_name TEXT, subject_last_name TEXT, subject_dob TEXT,
    offense_description TEXT, bond_amount REAL, issuing_agency TEXT
  )`);
  await execute(db, `CREATE TABLE calls_for_service (
    id INTEGER PRIMARY KEY AUTOINCREMENT, call_number TEXT, incident_type TEXT, status TEXT, created_at TEXT
  )`);
  await execute(db, `CREATE TABLE call_persons (
    id INTEGER PRIMARY KEY AUTOINCREMENT, call_id INTEGER, person_id INTEGER, person_type TEXT, added_at TEXT
  )`);
  await execute(db, `CREATE TABLE cases (
    id INTEGER PRIMARY KEY AUTOINCREMENT, case_number TEXT, title TEXT, status TEXT DEFAULT 'open'
  )`);
  await execute(db, `CREATE TABLE case_calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT, case_id INTEGER, call_id INTEGER
  )`);
  await execute(db, `CREATE TABLE case_person_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT, case_id INTEGER, person_id INTEGER, relationship TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);
}

function scanBody(overrides: Record<string, unknown> = {}) {
  return {
    scan: {
      first_name: 'Jane', last_name: 'Doe', date_of_birth: '1990-05-14',
      dl_number: 'D1234567', dl_state: 'UT', address: '123 Main St',
      is_veteran: true, suffix: 'Jr', country: 'USA', document_discriminator: 'ABC123',
      is_real_id: true, is_organ_donor: false, aamva_version: 9, issuer_id: '636040',
      address2: 'Apt 4', raw_elements: { DAQ: 'D1234567' },
      ...overrides,
    },
  };
}

describe('POST /api/records/from-dl-scan — full field persistence + auto-linking', () => {
  beforeEach(resetTables);

  it('persists every AAMVA field (persons + persons_ext) and upserts dl_records', async () => {
    const res = await app.request('/api/records/from-dl-scan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(scanBody()),
    }, env as unknown as Record<string, unknown>, testExecutionCtx);

    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.person_created).toBe(true);
    expect(body.dl_record_created).toBe(true);
    expect(body.dl_record_id).not.toBeNull();

    const db = (env as unknown as { DB: D1Database }).DB;
    const ext = await query<any>(db, 'SELECT * FROM persons_ext WHERE person_id = ?', body.person.id);
    expect(ext[0].suffix).toBe('Jr');
    expect(ext[0].country).toBe('USA');
    expect(ext[0].is_real_id).toBe(1);
    expect(ext[0].is_organ_donor).toBe(0);
    expect(ext[0].aamva_version).toBe(9);
    expect(JSON.parse(ext[0].raw_aamva_elements)).toEqual({ DAQ: 'D1234567' });

    const dlRows = await query<any>(db, 'SELECT * FROM dl_records WHERE dl_number = ?', 'D1234567');
    expect(dlRows.length).toBe(1);
    expect(dlRows[0].last_name).toBe('Doe');
  });

  it('re-scanning the same DL updates dl_records instead of duplicating it', async () => {
    await app.request('/api/records/from-dl-scan', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(scanBody()),
    }, env as unknown as Record<string, unknown>, testExecutionCtx);
    const res2 = await app.request('/api/records/from-dl-scan', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(scanBody({ dl_class: 'C' })),
    }, env as unknown as Record<string, unknown>, testExecutionCtx);
    const body2 = await res2.json() as any;
    expect(body2.dl_record_created).toBe(false);

    const db = (env as unknown as { DB: D1Database }).DB;
    const dlRows = await query<any>(db, 'SELECT * FROM dl_records WHERE dl_number = ?', 'D1234567');
    expect(dlRows.length).toBe(1);
  });

  it('links the scanned subject to the current call when call_id is provided', async () => {
    const db = (env as unknown as { DB: D1Database }).DB;
    await execute(db, `INSERT INTO calls_for_service (id, call_number) VALUES (42, 'C-42')`);
    const res = await app.request('/api/records/from-dl-scan', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...scanBody(), call_id: 42 }),
    }, env as unknown as Record<string, unknown>, testExecutionCtx);
    const body = await res.json() as any;
    expect(body.call_linked).toBe(true);

    const links = await query<any>(db, 'SELECT * FROM call_persons WHERE call_id = 42');
    expect(links.length).toBe(1);
    expect(links[0].person_id).toBe(body.person.id);
  });

  it('also links the case when the current call already belongs to one', async () => {
    const db = (env as unknown as { DB: D1Database }).DB;
    await execute(db, `INSERT INTO calls_for_service (id, call_number) VALUES (42, 'C-42')`);
    await execute(db, `INSERT INTO cases (id, case_number) VALUES (7, 'CASE-7')`);
    await execute(db, `INSERT INTO case_calls (case_id, call_id) VALUES (7, 42)`);
    const res = await app.request('/api/records/from-dl-scan', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...scanBody(), call_id: 42 }),
    }, env as unknown as Record<string, unknown>, testExecutionCtx);
    const body = await res.json() as any;
    expect(body.case_linked_id).toBe(7);

    const links = await query<any>(db, 'SELECT * FROM case_person_links WHERE case_id = 7');
    expect(links.length).toBe(1);
    expect(links[0].person_id).toBe(body.person.id);
  });

  it('backfills an orphaned warrant matching name+DOB and surfaces it as a hit', async () => {
    const db = (env as unknown as { DB: D1Database }).DB;
    await execute(db,
      `INSERT INTO warrants (warrant_number, status, subject_first_name, subject_last_name, subject_dob)
       VALUES ('W-1', 'active', 'Jane', 'Doe', '1990-05-14')`);
    const res = await app.request('/api/records/from-dl-scan', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(scanBody()),
    }, env as unknown as Record<string, unknown>, testExecutionCtx);
    const body = await res.json() as any;

    expect(body.warrant_hits.length).toBe(1);
    expect(body.warrant_hits[0].warrant_number).toBe('W-1');

    const warrantRow = await query<any>(db, `SELECT subject_person_id FROM warrants WHERE warrant_number = 'W-1'`);
    expect(warrantRow[0].subject_person_id).toBe(body.person.id);
  });

  it('does not backfill or surface a warrant with a different DOB', async () => {
    const db = (env as unknown as { DB: D1Database }).DB;
    await execute(db,
      `INSERT INTO warrants (warrant_number, status, subject_first_name, subject_last_name, subject_dob)
       VALUES ('W-2', 'active', 'Jane', 'Doe', '1985-01-01')`);
    const res = await app.request('/api/records/from-dl-scan', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(scanBody()),
    }, env as unknown as Record<string, unknown>, testExecutionCtx);
    const body = await res.json() as any;
    expect(body.warrant_hits.length).toBe(0);
  });

  it('surfaces prior calls and open cases without writing new links to them', async () => {
    const db = (env as unknown as { DB: D1Database }).DB;
    const first = await app.request('/api/records/from-dl-scan', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(scanBody()),
    }, env as unknown as Record<string, unknown>, testExecutionCtx);
    const firstBody = await first.json() as any;
    const personId = firstBody.person.id;

    await execute(db, `INSERT INTO calls_for_service (id, call_number, created_at) VALUES (99, 'C-99', datetime('now'))`);
    await execute(db, `INSERT INTO call_persons (call_id, person_id) VALUES (99, ?)`, personId);
    await execute(db, `INSERT INTO cases (id, case_number, status) VALUES (55, 'CASE-55', 'open')`);
    await execute(db, `INSERT INTO case_person_links (case_id, person_id) VALUES (55, ?)`, personId);

    const second = await app.request('/api/records/from-dl-scan', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(scanBody()),
    }, env as unknown as Record<string, unknown>, testExecutionCtx);
    const secondBody = await second.json() as any;

    expect(secondBody.prior_calls.some((c: any) => c.id === 99)).toBe(true);
    expect(secondBody.open_cases.some((c: any) => c.id === 55)).toBe(true);
    // Re-scanning must not create a duplicate call_persons/case_person_links row.
    const callLinks = await query<any>(db, 'SELECT * FROM call_persons WHERE call_id = 99');
    expect(callLinks.length).toBe(1);
  });
});
