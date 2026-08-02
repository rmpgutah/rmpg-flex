import { describe, it, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { reportKey } from '../src/utils/dailyReport/store';
import { getDb, execute, queryFirst } from '../src/utils/db';

// collectDailyReport (src/utils/dailyReport/collect.ts) queries these tables
// directly with explicit column lists — none exist in this Miniflare D1
// instance by default, so POST /generate 500'd with "no such table:
// calls_for_service" until they're created (empty is fine; the test only
// exercises the "no activity" / isEmpty() branch).
beforeAll(async () => {
  const db = getDb(env as unknown as { DB: D1Database });
  await execute(db, `CREATE TABLE IF NOT EXISTS calls_for_service (
    id INTEGER PRIMARY KEY AUTOINCREMENT, call_number TEXT, received_at TEXT, created_at TEXT,
    incident_type TEXT, priority TEXT, location_address TEXT, disposition TEXT, status TEXT,
    unit_call_signs TEXT, responding_officer TEXT
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS citations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, citation_number TEXT, citation_date TEXT, created_at TEXT,
    violation_description TEXT, location_address TEXT, issuing_officer_name TEXT, fine_amount REAL
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS fleet_vehicles (
    id INTEGER PRIMARY KEY AUTOINCREMENT, vehicle_name TEXT, vehicle_number TEXT, plate_number TEXT
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS unit_trips (
    id INTEGER PRIMARY KEY AUTOINCREMENT, vehicle_id INTEGER, start_time TEXT,
    distance_m REAL, duration_s INTEGER
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS fleet_fuel_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, vehicle_id INTEGER, fuel_date TEXT, created_at TEXT,
    gallons REAL, total_cost REAL, odometer REAL, station TEXT
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS fleet_inspections (
    id INTEGER PRIMARY KEY AUTOINCREMENT, vehicle_id INTEGER, inspection_date TEXT, created_at TEXT,
    overall_result TEXT, passed INTEGER, inspector TEXT
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS fleet_pretrip_checklists (
    id INTEGER PRIMARY KEY AUTOINCREMENT, vehicle_id INTEGER, check_date TEXT, created_at TEXT,
    status TEXT, officer_id INTEGER
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS work_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT, number TEXT, vehicle_id INTEGER,
    opened_at TEXT, closed_at TEXT, summary TEXT, status TEXT
  )`);
});

// Adapted from the brief's helper. src/middleware/auth.ts's authMiddleware
// verifies the JWT signature/claims but then looks the caller's ROLE up
// from the `users` table by id (`SELECT ... FROM users WHERE id = ?`) —
// it does not trust a `role` claim embedded in the token itself. So a
// helper that just signs `{ userId: 1, role }` and expects the server to
// honor that role (as the brief's draft did) would make the 'admin' and
// 'officer' cases indistinguishable once both hit the same user id. This
// version seeds (or reuses) a real users row per role and mints the JWT
// against that row's real id, mirroring the DB-seeding pattern in
// test-workers/auth.test.ts's account-lockout tests.
type TestRole = 'admin' | 'officer' | 'manager' | 'supervisor' | 'dispatcher'
  | 'client_viewer' | 'contract_manager' | 'human_resources';

async function authHeaders(role: TestRole): Promise<Record<string, string>> {
  const { SignJWT } = await import('jose');
  const db = getDb(env as unknown as { DB: D1Database });
  await execute(db, `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name TEXT, first_name TEXT, last_name TEXT, email TEXT,
    role TEXT NOT NULL DEFAULT 'officer', badge_number TEXT, phone TEXT, avatar_url TEXT,
    status TEXT NOT NULL DEFAULT 'active', must_change_password INTEGER NOT NULL DEFAULT 0,
    totp_enabled INTEGER NOT NULL DEFAULT 0, login_count INTEGER NOT NULL DEFAULT 0, last_login_at TEXT
  )`);

  const username = `daily-reports-${role}`;
  let row = await queryFirst<{ id: number }>(db, 'SELECT id FROM users WHERE username = ?', username);
  if (!row) {
    await execute(
      db,
      `INSERT INTO users (username, password_hash, full_name, role, status) VALUES (?, 'x', ?, ?, 'active')`,
      username,
      `Daily Reports ${role}`,
      role,
    );
    row = await queryFirst<{ id: number }>(db, 'SELECT id FROM users WHERE username = ?', username);
  }

  const secret = new TextEncoder().encode(env.JWT_SECRET as string);
  const token = await new SignJWT({ userId: row!.id, role })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('1h')
    .sign(secret);
  return { Authorization: `Bearer ${token}` };
}

describe('GET /api/reports/daily-reports/by-month', () => {
  it('returns an empty shape, not a 500, when nothing is stored', async () => {
    const res = await SELF.fetch('https://x/api/reports/daily-reports/by-month', {
      headers: await authHeaders('officer'),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { months: unknown[]; total_reports: number };
    expect(Array.isArray(body.months)).toBe(true);
    expect(body.total_reports).toBe(0);
  });

  it('groups stored reports by month, newest first', async () => {
    await env.DOWNLOADS.put(reportKey('2026-07-18'), new Uint8Array([1, 2, 3]));
    await env.DOWNLOADS.put(reportKey('2026-08-01'), new Uint8Array([1, 2, 3]));
    const res = await SELF.fetch('https://x/api/reports/daily-reports/by-month', {
      headers: await authHeaders('officer'),
    });
    const body = await res.json() as { months: { month: string; days: { date: string }[] }[]; total_reports: number };
    expect(body.total_reports).toBe(2);
    expect(body.months[0].month).toBe('2026-08');
    expect(body.months[1].month).toBe('2026-07');
    expect(body.months[1].days[0].date).toBe('2026-07-18');
  });

  // Pins the mount: a sibling route in reports.ts must not swallow this path.
  it('resolves to the daily-reports router, not a sibling handler', async () => {
    const res = await SELF.fetch('https://x/api/reports/daily-reports/by-month', {
      headers: await authHeaders('officer'),
    });
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('months');
  });

  // Pins the router-level RBAC gate's exclusion (reports.ts's `reports.use('*', ...)`
  // otherwise restricts all of /api/reports/* to admin|manager|supervisor). The
  // exclusion is anchored with startsWith('/api/reports/daily-reports') rather
  // than a bare .includes() — this proves the anchored form actually matches at
  // runtime and doesn't silently 403 every officer.
  it('an officer can read daily-reports despite the analytics role gate', async () => {
    const res = await SELF.fetch('https://x/api/reports/daily-reports/by-month', {
      headers: await authHeaders('officer'),
    });
    expect(res.status).toBe(200);
  });

  // Proves the exclusion did not widen past the blotter mount: a sibling
  // reports.ts route with a similar-looking name must still be gated to
  // ANALYTICS_ROLES for a non-elevated caller.
  it('the analytics gate still blocks an officer on a sibling reports route', async () => {
    const res = await SELF.fetch('https://x/api/reports/officer-activity', {
      headers: await authHeaders('officer'),
    });
    expect(res.status).toBe(403);
  });

  // BLOTTER_ROLES boundary (product requirement, fix round 2): the blotter
  // carries call addresses/dispositions/officer names + all citations, so
  // it is limited to internal operational roles — not "any authenticated
  // user" as the earlier fix round assumed.
  it('allows every internal operational role to read the blotter', async () => {
    for (const role of ['admin', 'manager', 'supervisor', 'officer', 'dispatcher'] as const) {
      const res = await SELF.fetch('https://x/api/reports/daily-reports/by-month', {
        headers: await authHeaders(role),
      });
      expect(res.status, `role ${role} should be allowed`).toBe(200);
    }
  });

  it('denies outward-facing and non-operational roles', async () => {
    // A blotter carries call addresses, dispositions and officer names —
    // client_viewer and contract_manager are client-facing accounts.
    for (const role of ['client_viewer', 'contract_manager', 'human_resources'] as const) {
      const res = await SELF.fetch('https://x/api/reports/daily-reports/by-month', {
        headers: await authHeaders(role),
      });
      expect(res.status, `role ${role} should be denied`).toBe(403);
    }
  });

  it('denies a disallowed role the PDF download too, not just the listing', async () => {
    // The listing and the download are separate handlers — gating one is not
    // gating the other.
    await env.DOWNLOADS.put(reportKey('2026-07-18'), new TextEncoder().encode('%PDF-1.7 x'));
    const res = await SELF.fetch('https://x/api/reports/daily-reports/rmpg-daily-2026-07-18.pdf', {
      headers: await authHeaders('client_viewer'),
    });
    expect(res.status).toBe(403);
  });
});

describe('GET /api/reports/daily-reports/:filename', () => {
  it('serves stored bytes inline as a PDF', async () => {
    await env.DOWNLOADS.put(reportKey('2026-07-18'), new TextEncoder().encode('%PDF-1.7 test'));
    const res = await SELF.fetch('https://x/api/reports/daily-reports/rmpg-daily-2026-07-18.pdf', {
      headers: await authHeaders('officer'),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/pdf');
    expect(res.headers.get('content-disposition')).toContain('inline');
  });

  it('404s an unknown report', async () => {
    const res = await SELF.fetch('https://x/api/reports/daily-reports/rmpg-daily-1999-01-01.pdf', {
      headers: await authHeaders('officer'),
    });
    expect(res.status).toBe(404);
  });

  it('404s a malformed filename rather than touching R2', async () => {
    const res = await SELF.fetch('https://x/api/reports/daily-reports/not-a-report.pdf', {
      headers: await authHeaders('officer'),
    });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/reports/daily-reports/generate', () => {
  it('is admin-only', async () => {
    const res = await SELF.fetch('https://x/api/reports/daily-reports/generate', {
      method: 'POST',
      headers: { ...(await authHeaders('officer')), 'content-type': 'application/json' },
      body: JSON.stringify({ date: '2026-07-18' }),
    });
    expect(res.status).toBe(403);
  });

  it('reports ok:false for a day with no activity', async () => {
    const res = await SELF.fetch('https://x/api/reports/daily-reports/generate', {
      method: 'POST',
      headers: { ...(await authHeaders('admin')), 'content-type': 'application/json' },
      body: JSON.stringify({ date: '1999-01-01' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; message?: string };
    expect(body.ok).toBe(false);
    expect(body.message).toBeTruthy();
  });

  it('rejects a malformed date', async () => {
    const res = await SELF.fetch('https://x/api/reports/daily-reports/generate', {
      method: 'POST',
      headers: { ...(await authHeaders('admin')), 'content-type': 'application/json' },
      body: JSON.stringify({ date: 'yesterday' }),
    });
    expect(res.status).toBe(400);
  });

  // DATE_RE only checks shape ('\d{4}-\d{2}-\d{2}') and admits a
  // calendar-impossible date; without the parseReportKey round-trip this
  // would write an R2 object that the download route later can never
  // resolve back to a valid key.
  it('rejects a calendar-impossible date', async () => {
    const res = await SELF.fetch('https://x/api/reports/daily-reports/generate', {
      method: 'POST',
      headers: { ...(await authHeaders('admin')), 'content-type': 'application/json' },
      body: JSON.stringify({ date: '2026-13-45' }),
    });
    expect(res.status).toBe(400);
  });
});
