// POST/PUT/GET /api/citations — official Utah Uniform Citation fields
//
// These ~45 fields live in `citations_ext` rather than on `citations`:
// that table is at 72 columns and D1's SQLite is compiled with
// SQLITE_MAX_COLUMN=100, where a 101st column makes the table
// UNREADABLE rather than merely un-SELECTable. This suite pins the
// round-trip across that seam, plus the two things that are easy to
// get wrong once the data is split in two:
//
//   - a tri-state boolean must survive as NULL, not collapse to 0
//     (the paper form prints YES [] NO []; an unanswered question
//     leaves BOTH boxes empty, and rendering an explicit "NO" would
//     state a fact on a court document that nobody stated);
//   - an update touching ONLY ext fields must not be rejected as
//     NO_FIELDS, because the court's disposition strip is entirely
//     ext-resident.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { execute, queryFirst } from '../src/utils/db';
import citations from '../src/routes/citations';

type Role = string;
let role: Role = 'officer';

const app = new Hono<{
  Bindings: Record<string, unknown>;
  Variables: { user: { id: number; role: string; username: string }; userId: number };
}>();
app.use('*', async (c, next) => {
  c.set('user', { id: 1, role, username: 'test-user' });
  c.set('userId', 1);
  await next();
});
app.route('/api/citations', citations);

const db = () => (env as unknown as { DB: D1Database }).DB;
const call = (path: string, init?: RequestInit) =>
  app.request(`http://t${path}`, init, env as unknown as Record<string, unknown>);

const post = (body: Record<string, unknown>) =>
  call('/api/citations', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });

const BASE = {
  violation_description: 'LITTERING ON LAND/WATERWAY',
  violation_date: '2026-03-29',
  person_name: 'ZAMORA, CHRISTOPHER WRIGHT',
  statute_citation: '76-9-1802',
};

beforeAll(async () => {
  await execute(db(), `CREATE TABLE IF NOT EXISTS citations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, citation_number TEXT,
    type TEXT DEFAULT 'traffic', status TEXT DEFAULT 'issued',
    person_id INTEGER, person_name TEXT, person_dob TEXT, person_dl TEXT, person_address TEXT,
    statute_citation TEXT, violation_description TEXT, offense_level TEXT, fine_amount REAL,
    violation_date TEXT, violation_time TEXT, location TEXT, latitude REAL, longitude REAL,
    vehicle_plate TEXT, vehicle_state TEXT,
    issuing_officer_id INTEGER, issuing_officer_name TEXT, badge_number TEXT,
    court_date TEXT, court_name TEXT, court_address TEXT, notes TEXT,
    voided_at TEXT, voided_by INTEGER, voided_reason TEXT,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
  )`);
  // GET /:id joins these; without them the handler 500s and every
  // assertion below reads `undefined` instead of the merged row.
  await execute(db(), `CREATE TABLE IF NOT EXISTS persons (
    id INTEGER PRIMARY KEY AUTOINCREMENT, first_name TEXT, last_name TEXT
  )`);
  await execute(db(), `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT, full_name TEXT
  )`);
  await execute(db(), `CREATE TABLE IF NOT EXISTS citation_violations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, citation_id INTEGER, violation_number INTEGER,
    statute_id INTEGER, statute_citation TEXT, violation_code TEXT,
    violation_description TEXT, offense_level TEXT, fine_amount REAL,
    speed_recorded INTEGER, speed_limit INTEGER, notes TEXT
  )`);
});

describe('uniform citation overflow fields', () => {
  it('round-trips the official field set through POST and GET', async () => {
    const res = await post({
      ...BASE,
      ori: 'UTLED0100',
      issuing_agency: 'State of Utah DNR',
      caption_county: 'Davis',
      person_height: '511',
      person_eyes: 'BRO',
      person_hair: 'BRO',
      birth_place: 'UT',
      dl_expires: '11/2033',
      mile_post: '312',
      direction_of_travel: 'NB',
      court_phone: '(801)451-4488',
    });
    expect(res.status).toBe(201);
    const created = (await res.json() as any).data;
    expect(created.ori).toBe('UTLED0100');

    const got = await (await call(`/api/citations/${created.id}`)).json() as any;
    expect(got.data.ori).toBe('UTLED0100');
    expect(got.data.issuing_agency).toBe('State of Utah DNR');
    expect(got.data.person_height).toBe('511');
    expect(got.data.mile_post).toBe('312');
    expect(got.data.court_phone).toBe('(801)451-4488');
    // The base record must still be intact alongside it.
    expect(got.data.violation_description).toBe('LITTERING ON LAND/WATERWAY');
  });

  it('keeps an unanswered yes/no as NULL rather than an explicit No', async () => {
    const created = (await (await post({
      ...BASE, cdl_presented: true, motorcycle_endorsed: false,
    })).json() as any).data;

    const row = await queryFirst<Record<string, unknown>>(
      db(), 'SELECT * FROM citations_ext WHERE citation_id = ?', created.id,
    );
    expect(row?.cdl_presented).toBe(1);
    expect(row?.motorcycle_endorsed).toBe(0);
    // Never supplied → NULL, so the form prints neither box checked.
    expect(row?.picture_id).toBeNull();
    expect(row?.interstate).toBeNull();
  });

  it('accepts an update that touches only overflow fields', async () => {
    const created = (await (await post(BASE)).json() as any).data;
    // The court's disposition strip is entirely ext-resident, so an
    // ext-only PUT is a real update — not NO_FIELDS.
    const res = await call(`/api/citations/${created.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ docket_number: '1A125', judge_name: 'Stucki, Hollie', fine_imposed: 250.5 }),
    });
    expect(res.status).toBe(200);
    const updated = (await res.json() as any).data;
    expect(updated.docket_number).toBe('1A125');
    expect(updated.fine_imposed).toBe(250.5);
  });

  it('still rejects a genuinely empty update', async () => {
    const created = (await (await post(BASE)).json() as any).data;
    const res = await call(`/api/citations/${created.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ not_a_column: 'x' }),
    });
    expect(res.status).toBe(400);
    expect((await res.json() as any).code).toBe('NO_FIELDS');
  });

  it('never lets an overflow value shadow a base column', async () => {
    // person_state exists on citations_ext but NOT on citations; the merge
    // spreads ext UNDER the base row so a same-named base column always wins.
    const created = (await (await post({
      ...BASE, person_state: 'UT', notes: 'base note',
    })).json() as any).data;
    const got = await (await call(`/api/citations/${created.id}`)).json() as any;
    expect(got.data.notes).toBe('base note');
    expect(got.data.person_state).toBe('UT');
  });

  it('masks the SSN for readers who do not issue or supervise citations', async () => {
    const created = (await (await post({ ...BASE, ssn: '250995610' })).json() as any).data;

    role = 'officer';
    const asOfficer = await (await call(`/api/citations/${created.id}`)).json() as any;
    expect(asOfficer.data.ssn).toBe('250995610');

    role = 'client_viewer';
    const asViewer = await (await call(`/api/citations/${created.id}`)).json() as any;
    expect(asViewer.data.ssn).toBe('***-**-5610');
    role = 'officer';
  });
});
