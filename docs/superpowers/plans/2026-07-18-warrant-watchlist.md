# Warrants Watch List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user flag a specific warrant for personal, ongoing attention ("My Watched Warrants") with opt-in alerts for status change, expiring-soon, and subject-encountered, by extending the existing `intel_watchlist` system rather than building new plumbing.

**Architecture:** `intel_watchlist` (currently `entity_type IN ('person','vehicle')`) gains `'warrant'` as a third watchable type, plus two new nullable columns (`last_known_status`, `expiry_alerted_at`) for change-detection state. `src/utils/intelWatchlist.ts`'s sweep function — which already exists but has never actually been wired into the cron — gets a three-way entity-type branch (fixing a real dispatch bug in the process) and is wired into `src/index.ts`'s per-minute cron for the first time. The client adds a small hook to track the current user's watched warrant IDs, a context-menu "Watch"/"Unwatch" action on `WarrantsListTab.tsx`, and a "My Watched Warrants" filter chip that composes with existing filters via `GET /warrants/unified`'s in-memory filter pipeline (no SQL join — that endpoint already does all filtering in JS over an in-memory array, not SQL).

**Tech Stack:** Hono + D1 (Worker), React/Vite (client), Vitest + Miniflare/`cloudflare:test` (`test-workers/`), Vitest + `@testing-library/react` (client).

## Global Constraints

- Personal, per-user watches only — never shared/team-visible. Ownership is `added_by`, matching the existing `intel_watchlist` model.
- Label the feature **"My Watched Warrants"** everywhere in the UI — `WarrantsPage.tsx` already has an unrelated tab literally named `watch` (a 4-hourly automated person/vehicle screening scan); do not reuse the bare word "Watch" alone anywhere a user could confuse the two.
- No new top-level tab — this lives as a filter chip inside the existing `warrants` tab of `WarrantsListTab.tsx`.
- No new notification delivery mechanism — reuse the existing `notifications` table/inbox/bell exactly as the person/vehicle watch path already does.
- The warrant's linked-person column is `subject_person_id` (NOT `person_id` — `person_id` on the `warrants` table belongs to a different, mostly-unused write path; confirmed via `ALLOWED_WARRANT_COLUMNS` in `src/routes/warrants.ts:931-936` and the `POST /warrants` insert).
- The warrant's expiration column is `expires_at`, with `expiry_date` as a fallback for rows never touched since edit (`computePriorityScore`'s own pattern: `row.expires_at ?? row.expiry_date`, `src/routes/warrants.ts:635`) — always read both with that same fallback.
- Server-side date math on stored timestamp strings uses `Date.parse(str)`/`new Date(str)` directly (Workers run in UTC, so naive server strings parse correctly) — this is the established convention (`src/utils/panicEscalationSweep.ts:50`), NOT the client-side `parseTimestamp()` gotcha that only applies to browser code under `client/src/`.
- Spec: [docs/superpowers/specs/2026-07-18-warrant-watchlist-design.md](../specs/2026-07-18-warrant-watchlist-design.md).
- Migration high-water mark is `0192` (confirmed via `ls migrations/ | tail`) — this plan's migration is `0193_warrant_watch_extensions.sql`.

---

### Task 1: Migration + `intel_watchlist` CRUD extension for `entity_type='warrant'`

**Files:**
- Create: `migrations/0193_warrant_watch_extensions.sql`
- Modify: `src/routes/intel.ts:317, 330-347`
- Test: `test-workers/warrantWatchlistCrud.test.ts`

**Interfaces:**
- Produces: `WATCHABLE = ['person', 'vehicle', 'warrant']`. `POST /api/intel/watchlist` with `{ entity_type: 'warrant', entity_id, reason? }` now 404s if `entity_id` isn't a real `warrants.id`, and seeds the new `last_known_status` column from that warrant's current `status` at insert time.

- [ ] **Step 1: Write the migration**

```sql
-- migrations/0193_warrant_watch_extensions.sql
ALTER TABLE intel_watchlist ADD COLUMN last_known_status TEXT;
ALTER TABLE intel_watchlist ADD COLUMN expiry_alerted_at TEXT;
```

- [ ] **Step 2: Apply it locally**

Run: `npm run migrate:local`
Expected: applies cleanly (a second run would fail on "duplicate column name" — expected/idempotent-by-tracking, not a bug, per `migrations/README.md`).

- [ ] **Step 3: Write the failing test**

```ts
// test-workers/warrantWatchlistCrud.test.ts
// Route-level test (Miniflare/workerd) proving intel_watchlist accepts
// entity_type='warrant', rejects a non-existent warrant id, and seeds
// last_known_status from the warrant's current status at insert time.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { execute } from '../src/utils/db';
import intel from '../src/routes/intel';

const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: { id: number; role: string }; userId: number } }>();
app.use('*', async (c, next) => {
  c.set('user', { id: 5, role: 'officer' });
  c.set('userId', 5);
  await next();
});
app.route('/api/intel', intel);

beforeAll(async () => {
  const db = (env as unknown as { DB: D1Database }).DB;
  await execute(db, `CREATE TABLE IF NOT EXISTS intel_watchlist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL, entity_id INTEGER NOT NULL,
    reason TEXT, added_by INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1,
    last_alert_at TEXT DEFAULT (datetime('now')), created_at TEXT DEFAULT (datetime('now')),
    last_known_status TEXT, expiry_alerted_at TEXT,
    UNIQUE (entity_type, entity_id, added_by)
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS warrants (
    id INTEGER PRIMARY KEY AUTOINCREMENT, warrant_number TEXT, status TEXT NOT NULL DEFAULT 'active',
    subject_person_id INTEGER, subject_name TEXT, expires_at TEXT, expiry_date TEXT
  )`);
  await execute(db, `INSERT INTO warrants (id, warrant_number, status, subject_person_id, subject_name)
    VALUES (42, 'W-2026-042', 'active', 900, 'John Doe')`);
});

describe('POST /api/intel/watchlist — warrant entity type', () => {
  it('rejects a non-existent warrant id with 404', async () => {
    const res = await app.request('/api/intel/watchlist', {
      method: 'POST',
      body: JSON.stringify({ entity_type: 'warrant', entity_id: 999999 }),
    }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(404);
  });

  it('accepts a real warrant id and seeds last_known_status from its current status', async () => {
    const res = await app.request('/api/intel/watchlist', {
      method: 'POST',
      body: JSON.stringify({ entity_type: 'warrant', entity_id: 42, reason: 'flagged from warrants' }),
    }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean };
    expect(body.success).toBe(true);

    const listRes = await app.request('/api/intel/watchlist', {}, env as unknown as Record<string, unknown>);
    const rows = await listRes.json() as { entity_type: string; entity_id: number; last_known_status: string }[];
    const row = rows.find(r => r.entity_type === 'warrant' && r.entity_id === 42);
    expect(row?.last_known_status).toBe('active');
  });

  it('still accepts person/vehicle watches unchanged (no existence check, no last_known_status)', async () => {
    const res = await app.request('/api/intel/watchlist', {
      method: 'POST',
      body: JSON.stringify({ entity_type: 'person', entity_id: 12345 }),
    }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run --config vitest.workers.config.mts test-workers/warrantWatchlistCrud.test.ts`
Expected: FAIL — `entity_type: 'warrant'` isn't in `WATCHABLE` yet, so the first two assertions get a `400`, not `404`/`200`.

- [ ] **Step 5: Extend `WATCHABLE` and add the existence check**

Use the Edit tool on `src/routes/intel.ts`:

old_string:
```
const WATCHABLE = ['person', 'vehicle'];

intel.get('/watchlist', operational, async (c) => {
  const db = getDb(c.env);
  const userId = c.get('userId') as number;
  try {
    return c.json(await query<any>(db,
      `SELECT * FROM intel_watchlist WHERE active = 1 AND added_by = ? ORDER BY created_at DESC LIMIT 200`, userId));
  } catch (err: any) {
    return c.json({ error: err?.message, hint: 'migration 0099 may not have reached live D1' }, 500);
  }
});

intel.post('/watchlist', operational, async (c) => {
  const db = getDb(c.env);
  const userId = c.get('userId') as number;
  const body = await c.req.json().catch(() => ({} as any));
  const entityType = String(body?.entity_type || '');
  const entityId = Number(body?.entity_id);
  if (!WATCHABLE.includes(entityType) || !Number.isFinite(entityId)) {
    return c.json({ error: 'entity_type (person|vehicle) and entity_id required' }, 400);
  }
  // Reactivate an existing watch instead of violating the UNIQUE key.
  await execute(db,
    `INSERT INTO intel_watchlist (entity_type, entity_id, reason, added_by, active, last_alert_at)
     VALUES (?, ?, ?, ?, 1, datetime('now'))
     ON CONFLICT(entity_type, entity_id, added_by) DO UPDATE SET
       active = 1, reason = excluded.reason, last_alert_at = datetime('now')`,
    entityType, entityId, body?.reason || null, userId);
  return c.json({ success: true });
});
```

new_string:
```
const WATCHABLE = ['person', 'vehicle', 'warrant'];

intel.get('/watchlist', operational, async (c) => {
  const db = getDb(c.env);
  const userId = c.get('userId') as number;
  try {
    return c.json(await query<any>(db,
      `SELECT * FROM intel_watchlist WHERE active = 1 AND added_by = ? ORDER BY created_at DESC LIMIT 200`, userId));
  } catch (err: any) {
    return c.json({ error: err?.message, hint: 'migration 0099 may not have reached live D1' }, 500);
  }
});

intel.post('/watchlist', operational, async (c) => {
  const db = getDb(c.env);
  const userId = c.get('userId') as number;
  const body = await c.req.json().catch(() => ({} as any));
  const entityType = String(body?.entity_type || '');
  const entityId = Number(body?.entity_id);
  if (!WATCHABLE.includes(entityType) || !Number.isFinite(entityId)) {
    return c.json({ error: 'entity_type (person|vehicle|warrant) and entity_id required' }, 400);
  }
  // Warrants are watched by row id, unlike person/vehicle — confirm the
  // referenced warrant is real and seed last_known_status so the sweep's
  // first pass doesn't spuriously fire a "status changed" alert.
  let lastKnownStatus: string | null = null;
  if (entityType === 'warrant') {
    const warrant = await queryFirst<{ status: string }>(db, 'SELECT status FROM warrants WHERE id = ?', entityId);
    if (!warrant) return c.json({ error: 'Warrant not found' }, 404);
    lastKnownStatus = warrant.status;
  }
  // Reactivate an existing watch instead of violating the UNIQUE key.
  await execute(db,
    `INSERT INTO intel_watchlist (entity_type, entity_id, reason, added_by, active, last_alert_at, last_known_status)
     VALUES (?, ?, ?, ?, 1, datetime('now'), ?)
     ON CONFLICT(entity_type, entity_id, added_by) DO UPDATE SET
       active = 1, reason = excluded.reason, last_alert_at = datetime('now')`,
    entityType, entityId, body?.reason || null, userId, lastKnownStatus);
  return c.json({ success: true });
});
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run --config vitest.workers.config.mts test-workers/warrantWatchlistCrud.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 7: Run the Worker typecheck**

Run: `npm run typecheck`
Expected: PASS — `queryFirst` is already imported at the top of `src/routes/intel.ts`.

- [ ] **Step 8: Commit**

```bash
git add migrations/0193_warrant_watch_extensions.sql src/routes/intel.ts test-workers/warrantWatchlistCrud.test.ts
git commit -m "feat(warrants): add warrant entity type to intel_watchlist"
```

---

### Task 2: Three-way sweep branch + warrant alert detection

**Files:**
- Modify: `src/utils/intelWatchlist.ts`
- Test: `test-workers/warrantWatchlistSweep.test.ts`

**Interfaces:**
- Consumes: `WatchRow` (extended with `last_known_status`/`expiry_alerted_at`), the existing `hitsForPerson(db, personId, since)`.
- Produces: `sweepWatchlist(db: D1Database): Promise<number>` (unchanged signature) — now correctly three-way-dispatches on `entity_type`, and for `'warrant'` inserts 0-3 independent `notifications` rows per sweep (status-change, expiring-soon, subject-encountered), each `type: 'warrant_watch_hit'`.

- [ ] **Step 1: Write the failing tests**

```ts
// test-workers/warrantWatchlistSweep.test.ts
// Route-level test (Miniflare/workerd) for the warrant branch of
// sweepWatchlist(). Person/vehicle behavior is unchanged and already
// implicitly covered by this same sweep function; these tests focus on
// the new warrant-specific detection (status change, expiring soon,
// subject encountered) and the pre-existing vehicle-misrouting bug fix
// (entity_type='warrant' must NOT fall through to hitsForPerson).
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { execute, query } from '../src/utils/db';
import { sweepWatchlist } from '../src/utils/intelWatchlist';

async function resetTables() {
  const db = (env as unknown as { DB: D1Database }).DB;
  await execute(db, 'DROP TABLE IF EXISTS intel_watchlist');
  await execute(db, 'DROP TABLE IF EXISTS warrants');
  await execute(db, 'DROP TABLE IF EXISTS notifications');
  await execute(db, 'DROP TABLE IF EXISTS calls_for_service');
  await execute(db, 'DROP TABLE IF EXISTS call_persons');
  await execute(db, `CREATE TABLE intel_watchlist (
    id INTEGER PRIMARY KEY AUTOINCREMENT, entity_type TEXT NOT NULL, entity_id INTEGER NOT NULL,
    reason TEXT, added_by INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1,
    last_alert_at TEXT, created_at TEXT DEFAULT (datetime('now')),
    last_known_status TEXT, expiry_alerted_at TEXT
  )`);
  await execute(db, `CREATE TABLE warrants (
    id INTEGER PRIMARY KEY AUTOINCREMENT, warrant_number TEXT, status TEXT NOT NULL DEFAULT 'active',
    subject_person_id INTEGER, subject_name TEXT, expires_at TEXT, expiry_date TEXT
  )`);
  await execute(db, `CREATE TABLE notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT, priority TEXT, title TEXT, message TEXT,
    entity_type TEXT, entity_id INTEGER, user_id INTEGER, is_read INTEGER DEFAULT 0, created_at TEXT
  )`);
  await execute(db, `CREATE TABLE calls_for_service (
    id INTEGER PRIMARY KEY AUTOINCREMENT, call_number TEXT, incident_type TEXT, created_at TEXT
  )`);
  await execute(db, `CREATE TABLE call_persons (
    id INTEGER PRIMARY KEY AUTOINCREMENT, call_id INTEGER, person_id INTEGER
  )`);
}

describe('sweepWatchlist — warrant branch', () => {
  beforeEach(resetTables);

  it('fires a status-change alert and updates the snapshot', async () => {
    const db = (env as unknown as { DB: D1Database }).DB;
    await execute(db, `INSERT INTO warrants (id, warrant_number, status, subject_name) VALUES (1, 'W-1', 'served', 'Jane Roe')`);
    await execute(db, `INSERT INTO intel_watchlist (entity_type, entity_id, added_by, last_known_status) VALUES ('warrant', 1, 7, 'active')`);

    const alerts = await sweepWatchlist(db);
    expect(alerts).toBeGreaterThanOrEqual(1);

    const notifs = await query<any>(db, `SELECT * FROM notifications WHERE type = 'warrant_watch_hit'`);
    expect(notifs.some(n => /status changed/i.test(n.message) && /served/i.test(n.message))).toBe(true);

    const watch = await query<any>(db, `SELECT last_known_status FROM intel_watchlist WHERE entity_id = 1`);
    expect(watch[0].last_known_status).toBe('served');
  });

  it('does not re-fire a status-change alert on the next sweep with no further change', async () => {
    const db = (env as unknown as { DB: D1Database }).DB;
    await execute(db, `INSERT INTO warrants (id, warrant_number, status, subject_name) VALUES (2, 'W-2', 'active', 'Jane Roe')`);
    await execute(db, `INSERT INTO intel_watchlist (entity_type, entity_id, added_by, last_known_status) VALUES ('warrant', 2, 7, 'active')`);

    await sweepWatchlist(db); // first sweep — no change, no alert
    await sweepWatchlist(db); // second sweep — still no change
    const notifs = await query<any>(db, `SELECT * FROM notifications WHERE type = 'warrant_watch_hit'`);
    expect(notifs.length).toBe(0);
  });

  it('fires an expiring-soon alert exactly once', async () => {
    const db = (env as unknown as { DB: D1Database }).DB;
    const soon = new Date(Date.now() + 3 * 86400000).toISOString();
    await execute(db, `INSERT INTO warrants (id, warrant_number, status, subject_name, expires_at) VALUES (3, 'W-3', 'active', 'Jane Roe', ?)`, soon);
    await execute(db, `INSERT INTO intel_watchlist (entity_type, entity_id, added_by, last_known_status) VALUES ('warrant', 3, 7, 'active')`);

    await sweepWatchlist(db);
    let notifs = await query<any>(db, `SELECT * FROM notifications WHERE type = 'warrant_watch_hit'`);
    expect(notifs.filter(n => /expires in/i.test(n.message)).length).toBe(1);

    await sweepWatchlist(db); // second sweep — expiry_alerted_at is now set, must not re-fire
    notifs = await query<any>(db, `SELECT * FROM notifications WHERE type = 'warrant_watch_hit'`);
    expect(notifs.filter(n => /expires in/i.test(n.message)).length).toBe(1);
  });

  it('fires a subject-encountered alert reusing hitsForPerson, labeled with warrant context', async () => {
    const db = (env as unknown as { DB: D1Database }).DB;
    await execute(db, `INSERT INTO warrants (id, warrant_number, status, subject_person_id, subject_name) VALUES (4, 'W-4', 'active', 900, 'Jane Roe')`);
    await execute(db, `INSERT INTO intel_watchlist (entity_type, entity_id, added_by, last_known_status, last_alert_at) VALUES ('warrant', 4, 7, 'active', ?)`, new Date(0).toISOString());
    await execute(db, `INSERT INTO calls_for_service (id, call_number, incident_type, created_at) VALUES (1, 'CFS-2026-01542', 'traffic stop', datetime('now'))`);
    await execute(db, `INSERT INTO call_persons (call_id, person_id) VALUES (1, 900)`);

    await sweepWatchlist(db);
    const notifs = await query<any>(db, `SELECT * FROM notifications WHERE type = 'warrant_watch_hit'`);
    expect(notifs.some(n => /subject of warrant #W-4/i.test(n.message) && /CFS-2026-01542/.test(n.message))).toBe(true);
  });

  it('does not misroute a warrant watch into hitsForPerson (the pre-existing ternary bug)', async () => {
    const db = (env as unknown as { DB: D1Database }).DB;
    // A warrant with id=5 whose id would coincidentally match a person id
    // with unrelated new activity — if the old two-way ternary bug were
    // still present, this watch would incorrectly run hitsForPerson(db, 5, ...)
    // and could alert on unrelated activity for "person #5".
    await execute(db, `INSERT INTO warrants (id, warrant_number, status, subject_name) VALUES (5, 'W-5', 'active', 'No One')`);
    await execute(db, `INSERT INTO intel_watchlist (entity_type, entity_id, added_by, last_known_status) VALUES ('warrant', 5, 7, 'active')`);
    await execute(db, `INSERT INTO calls_for_service (id, call_number, incident_type, created_at) VALUES (2, 'CFS-UNRELATED', 'unrelated', datetime('now'))`);
    await execute(db, `INSERT INTO call_persons (call_id, person_id) VALUES (2, 5)`);

    await sweepWatchlist(db);
    const notifs = await query<any>(db, `SELECT * FROM notifications WHERE type = 'warrant_watch_hit'`);
    // No subject_person_id set on warrant #5, so no subject-encountered alert
    // should fire even though "person #5" has unrelated new activity.
    expect(notifs.some(n => /CFS-UNRELATED/.test(n.message))).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run --config vitest.workers.config.mts test-workers/warrantWatchlistSweep.test.ts`
Expected: FAIL — the current two-way ternary routes `entity_type='warrant'` into `hitsForPerson(db, entityId, since)`, so none of the warrant-specific behaviors exist yet (and the last test would actually fail in the "wrong" direction — showing the bug — since it WOULD find the unrelated CFS hit today).

- [ ] **Step 3: Rewrite `src/utils/intelWatchlist.ts`**

```ts
// ============================================================
// RMPG Flex — Intel watchlist sweep (Palantir Phase 4)
// ============================================================
// Runs in the per-minute cron. For each active watch, finds activity
// linked to the watched entity created AFTER last_alert_at (new calls,
// field interviews, citations) and inserts a HIGH-priority row into the
// existing notifications table for the watcher — surfaces in the
// notifications inbox/bell with no new delivery plumbing.
//
// Warrant watches (entity_type='warrant') are handled separately from
// person/vehicle: instead of one hits-based notification, up to THREE
// independent alerts can fire per sweep — status change, expiring soon,
// and subject encountered (which reuses hitsForPerson against the
// warrant's subject_person_id, but is labeled with warrant context).
//
// Each watch is try/catch-isolated; the sweep can never throw out of
// the cron. last_alert_at only advances when hits were found (or stays
// fresh on no-hit to bound the scan window via COALESCE in queries).
// ============================================================

import { log } from './logger';
import type { D1Database } from '@cloudflare/workers-types';
import { query, queryFirst, execute } from './db';

interface WatchRow {
  id: number; entity_type: string; entity_id: number;
  reason: string | null; added_by: number; last_alert_at: string | null;
  last_known_status: string | null; expiry_alerted_at: string | null;
}

interface Hit { kind: string; label: string }

const EXPIRY_WARNING_DAYS = 7;

async function hitsForPerson(db: D1Database, personId: number, since: string): Promise<Hit[]> {
  const hits: Hit[] = [];
  try {
    for (const r of await query<any>(db,
      `SELECT c.call_number, c.incident_type FROM calls_for_service c
       JOIN call_persons cp ON cp.call_id = c.id
       WHERE cp.person_id = ? AND c.created_at > ? LIMIT 5`, personId, since))
      hits.push({ kind: 'call', label: `${r.call_number || 'CFS'} ${r.incident_type || ''}`.trim() });
  } catch (err: any) { log.error('[intel-watchlist] person calls failed', { error: err?.message }); }
  try {
    for (const r of await query<any>(db,
      `SELECT fi_number, contact_reason FROM field_interviews
       WHERE person_id = ? AND created_at > ? LIMIT 5`, personId, since))
      hits.push({ kind: 'field interview', label: `${r.fi_number || 'FI'} ${r.contact_reason || ''}`.trim() });
  } catch (err: any) { log.error('[intel-watchlist] person FIs failed', { error: err?.message }); }
  try {
    for (const r of await query<any>(db,
      `SELECT citation_number FROM citations
       WHERE person_id = ? AND created_at > ? LIMIT 5`, personId, since))
      hits.push({ kind: 'citation', label: r.citation_number || 'Citation' });
  } catch (err: any) { log.error('[intel-watchlist] person citations failed', { error: err?.message }); }
  return hits;
}

async function hitsForVehicle(db: D1Database, vehicleId: number, since: string): Promise<Hit[]> {
  const hits: Hit[] = [];
  try {
    for (const r of await query<any>(db,
      `SELECT c.call_number, c.incident_type FROM calls_for_service c
       JOIN call_vehicles cv ON cv.call_id = c.id
       WHERE cv.vehicle_id = ? AND c.created_at > ? LIMIT 5`, vehicleId, since))
      hits.push({ kind: 'call', label: `${r.call_number || 'CFS'} ${r.incident_type || ''}`.trim() });
  } catch (err: any) { log.error('[intel-watchlist] vehicle calls failed', { error: err?.message }); }
  try {
    for (const r of await query<any>(db,
      `SELECT fi_number FROM field_interviews
       WHERE vehicle_id = ? AND created_at > ? LIMIT 5`, vehicleId, since))
      hits.push({ kind: 'field interview', label: r.fi_number || 'FI' });
  } catch (err: any) { log.error('[intel-watchlist] vehicle FIs failed', { error: err?.message }); }
  return hits;
}

async function entityLabel(db: D1Database, type: string, id: number): Promise<string> {
  try {
    if (type === 'person') {
      const p = await query<any>(db, 'SELECT first_name, last_name FROM persons WHERE id = ?', id);
      if (p[0]) return `${p[0].first_name} ${p[0].last_name}`;
    } else if (type === 'vehicle') {
      const v = await query<any>(db, 'SELECT plate_number, make, model FROM vehicles_records WHERE id = ?', id);
      if (v[0]) return [v[0].make, v[0].model, v[0].plate_number ? `(${v[0].plate_number})` : ''].filter(Boolean).join(' ');
    }
  } catch { /* fall through */ }
  return `${type} #${id}`;
}

interface WarrantRow {
  status: string;
  warrant_number: string | null;
  subject_person_id: number | null;
  subject_name: string | null;
  expires_at: string | null;
  expiry_date: string | null;
}

// Runs the three warrant-specific checks for one watch, inserting 0-3
// notification rows directly (each independently, unlike the single
// hits-based insert used for person/vehicle watches below). Returns the
// number of alerts fired, so the caller's total count stays accurate.
async function processWarrantWatch(db: D1Database, w: WatchRow): Promise<number> {
  const warrant = await queryFirst<WarrantRow>(db,
    'SELECT status, warrant_number, subject_person_id, subject_name, expires_at, expiry_date FROM warrants WHERE id = ?',
    w.entity_id);
  if (!warrant) return 0; // warrant was deleted since the watch was created
  const label = warrant.warrant_number || `#${w.entity_id}`;
  let alerts = 0;

  // 1. Status change
  if (w.last_known_status != null && warrant.status !== w.last_known_status) {
    await execute(db,
      `INSERT INTO notifications (type, priority, title, message, entity_type, entity_id, user_id, is_read, created_at)
       VALUES ('warrant_watch_hit', 'high', ?, ?, 'warrant', ?, ?, 0, datetime('now'))`,
      `WARRANT ${label} STATUS CHANGED`,
      `Warrant ${label} status changed: ${w.last_known_status} → ${warrant.status}${w.reason ? ` (watch reason: ${w.reason})` : ''}`,
      w.entity_id, w.added_by);
    alerts++;
  }
  if (warrant.status !== w.last_known_status) {
    await execute(db, `UPDATE intel_watchlist SET last_known_status = ? WHERE id = ?`, warrant.status, w.id);
  }

  // 2. Expiring soon (one-time)
  const expiresAt = warrant.expires_at ?? warrant.expiry_date;
  if (warrant.status === 'active' && expiresAt && !w.expiry_alerted_at) {
    const expiresAtMs = Date.parse(expiresAt);
    if (!Number.isNaN(expiresAtMs)) {
      const daysUntil = Math.ceil((expiresAtMs - Date.now()) / 86400000);
      if (daysUntil >= 0 && daysUntil <= EXPIRY_WARNING_DAYS) {
        await execute(db,
          `INSERT INTO notifications (type, priority, title, message, entity_type, entity_id, user_id, is_read, created_at)
           VALUES ('warrant_watch_hit', 'high', ?, ?, 'warrant', ?, ?, 0, datetime('now'))`,
          `WARRANT ${label} EXPIRING SOON`,
          `Warrant ${label} expires in ${daysUntil} day${daysUntil === 1 ? '' : 's'}`,
          w.entity_id, w.added_by);
        await execute(db, `UPDATE intel_watchlist SET expiry_alerted_at = datetime('now') WHERE id = ?`, w.id);
        alerts++;
      }
    }
  }

  // 3. Subject encountered — reuses hitsForPerson, labeled with warrant context
  if (warrant.subject_person_id != null) {
    const since = w.last_alert_at || new Date(0).toISOString();
    const hits = await hitsForPerson(db, warrant.subject_person_id, since);
    if (hits.length) {
      const detail = hits.map((h) => `${h.kind}: ${h.label}`).join('; ');
      await execute(db,
        `INSERT INTO notifications (type, priority, title, message, entity_type, entity_id, user_id, is_read, created_at)
         VALUES ('warrant_watch_hit', 'high', ?, ?, 'warrant', ?, ?, 0, datetime('now'))`,
        `WARRANT ${label} SUBJECT ENCOUNTERED`,
        `Subject of warrant ${label} (${warrant.subject_name || 'unknown'}) appeared in new activity — ${detail}`,
        w.entity_id, w.added_by);
      await execute(db, `UPDATE intel_watchlist SET last_alert_at = datetime('now') WHERE id = ?`, w.id);
      alerts++;
    }
  }

  return alerts;
}

export async function sweepWatchlist(db: D1Database): Promise<number> {
  let alerts = 0;
  let watches: WatchRow[] = [];
  try {
    watches = await query<WatchRow>(db,
      'SELECT id, entity_type, entity_id, reason, added_by, last_alert_at, last_known_status, expiry_alerted_at FROM intel_watchlist WHERE active = 1 LIMIT 200');
  } catch (err: any) {
    // Table missing on live = migration drift; stay silent beyond one log.
    log.error('[intel-watchlist] sweep skipped', { error: err?.message });
    return 0;
  }
  for (const w of watches) {
    try {
      if (w.entity_type === 'warrant') {
        alerts += await processWarrantWatch(db, w);
        continue;
      }
      const since = w.last_alert_at || new Date(0).toISOString();
      const hits = w.entity_type === 'vehicle'
        ? await hitsForVehicle(db, w.entity_id, since)
        : await hitsForPerson(db, w.entity_id, since);
      if (!hits.length) continue;
      const label = await entityLabel(db, w.entity_type, w.entity_id);
      const detail = hits.map((h) => `${h.kind}: ${h.label}`).join('; ');
      await execute(db,
        `INSERT INTO notifications (type, priority, title, message, entity_type, entity_id, user_id, is_read, created_at)
         VALUES ('watchlist_hit', 'high', ?, ?, ?, ?, ?, 0, datetime('now'))`,
        `WATCHLIST: ${label}`,
        `New activity for watched ${w.entity_type} ${label}${w.reason ? ` (watch reason: ${w.reason})` : ''} — ${detail}`,
        w.entity_type, w.entity_id, w.added_by);
      await execute(db, `UPDATE intel_watchlist SET last_alert_at = datetime('now') WHERE id = ?`, w.id);
      alerts++;
    } catch (err: any) {
      log.error('[intel-watchlist] watch failed', { watch_id: w.id, error: err?.message });
    }
  }
  return alerts;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --config vitest.workers.config.mts test-workers/warrantWatchlistSweep.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Run the Worker typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/utils/intelWatchlist.ts test-workers/warrantWatchlistSweep.test.ts
git commit -m "feat(warrants): add warrant status/expiry/subject alert detection to sweep, fix vehicle/person dispatch bug"
```

---

### Task 3: Wire `sweepWatchlist` into the per-minute cron

**Files:**
- Modify: `src/index.ts:293-321`

**Interfaces:**
- Consumes: `sweepWatchlist(db: D1Database): Promise<number>` (Task 2).

This is the fix for the pre-existing dead-code bug: `sweepWatchlist` has never actually been invoked by the cron, so the whole `intel_watchlist` feature (person/vehicle included) has been silently non-functional in production. This task makes it run for the first time.

- [ ] **Step 1: Add the cron call**

Use the Edit tool on `src/index.ts`:

old_string:
```
      // Panic alert escalation — src/routes/dispatch/panic.ts's own header
      // comment flags this as a known gap: escalation_level existed but
      // nothing ever advanced it or re-broadcast an unacknowledged alert.
      ctx.waitUntil(
        import('./utils/panicEscalationSweep').then((m) =>
          m.sweepPanicEscalation(env.DB).then((r) => {
            if (r.escalated > 0) console.log(`[panic-escalation] escalated ${r.escalated}`);
          }).catch((err) => console.error('Panic escalation sweep failed:', err)),
        ).catch(() => {}),
      );
```

new_string:
```
      // Panic alert escalation — src/routes/dispatch/panic.ts's own header
      // comment flags this as a known gap: escalation_level existed but
      // nothing ever advanced it or re-broadcast an unacknowledged alert.
      ctx.waitUntil(
        import('./utils/panicEscalationSweep').then((m) =>
          m.sweepPanicEscalation(env.DB).then((r) => {
            if (r.escalated > 0) console.log(`[panic-escalation] escalated ${r.escalated}`);
          }).catch((err) => console.error('Panic escalation sweep failed:', err)),
        ).catch(() => {}),
      );
      // Intel watchlist sweep (person/vehicle/warrant) — alerts a watcher
      // when new activity, a status change, or an approaching expiration
      // hits one of their watched entities. This has existed since Phase 4
      // but was never actually wired into the cron until now.
      ctx.waitUntil(
        import('./utils/intelWatchlist').then((m) =>
          m.sweepWatchlist(env.DB).then((count) => {
            if (count > 0) console.log(`[intel-watchlist] fired ${count} alert(s)`);
          }).catch((err) => console.error('Intel watchlist sweep failed:', err)),
        ).catch(() => {}),
      );
```

- [ ] **Step 2: Run the Worker typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "fix(warrants): wire sweepWatchlist into the per-minute cron (was never called)"
```

---

### Task 4: `watched_only` filter on `GET /warrants/unified`

**Files:**
- Modify: `src/routes/warrants.ts:797-919`
- Test: `test-workers/warrantsUnifiedWatchedOnly.test.ts`

**Interfaces:**
- Produces: `GET /warrants/unified?watched_only=1` — when present, restricts results to warrants the authenticated user currently has an active watch on, composing with every other existing filter (status, type, priority_min, etc.) exactly like `matches_person`/`state`/`state_prefix` already do, since this endpoint filters entirely in-memory over one merged array (no SQL join needed).

- [ ] **Step 1: Write the failing test**

```ts
// test-workers/warrantsUnifiedWatchedOnly.test.ts
// Route-level test (Miniflare/workerd) for the watched_only filter on
// GET /warrants/unified — this endpoint filters in-memory over a merged
// array (local warrants + scraped_warrants), not via SQL, so this test
// confirms watched_only composes correctly with the existing status filter.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { execute } from '../src/utils/db';
import warrants from '../src/routes/warrants';

const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: { id: number; role: string } } }>();
app.use('*', async (c, next) => {
  c.set('user', { id: 7, role: 'officer' });
  await next();
});
app.route('/api/warrants', warrants);

beforeAll(async () => {
  const db = (env as unknown as { DB: D1Database }).DB;
  await execute(db, `CREATE TABLE IF NOT EXISTS warrants (
    id INTEGER PRIMARY KEY AUTOINCREMENT, warrant_number TEXT, type TEXT DEFAULT 'arrest',
    status TEXT NOT NULL DEFAULT 'active', subject_person_id INTEGER, subject_name TEXT,
    subject_first_name TEXT, subject_last_name TEXT, charge_description TEXT, bail_amount REAL,
    bond_amount REAL, offense TEXT, offense_level TEXT, issuing_court TEXT, court TEXT,
    source TEXT, archived_at TEXT, expires_at TEXT, created_at TEXT DEFAULT (datetime('now'))
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS scraped_warrants (id INTEGER PRIMARY KEY AUTOINCREMENT)`);
  await execute(db, `CREATE TABLE IF NOT EXISTS intel_watchlist (
    id INTEGER PRIMARY KEY AUTOINCREMENT, entity_type TEXT NOT NULL, entity_id INTEGER NOT NULL,
    added_by INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1
  )`);
  await execute(db, `INSERT INTO warrants (id, warrant_number, status) VALUES (10, 'W-10', 'active'), (11, 'W-11', 'active'), (12, 'W-12', 'served')`);
  await execute(db, `INSERT INTO intel_watchlist (entity_type, entity_id, added_by, active) VALUES ('warrant', 10, 7, 1), ('warrant', 12, 7, 1), ('warrant', 11, 99, 1)`);
});

describe('GET /warrants/unified?watched_only=1', () => {
  it('returns only the current user\'s watched warrants', async () => {
    const res = await app.request('/api/warrants/unified?watched_only=1', {}, env as unknown as Record<string, unknown>);
    const body = await res.json() as { warrants: { id: number }[]; total: number };
    const ids = body.warrants.map(w => w.id).sort();
    expect(ids).toEqual([10, 12]); // NOT 11 — that's watched by a different user (added_by=99)
  });

  it('composes with the existing status filter', async () => {
    const res = await app.request('/api/warrants/unified?watched_only=1&status=active', {}, env as unknown as Record<string, unknown>);
    const body = await res.json() as { warrants: { id: number }[]; total: number };
    expect(body.warrants.map(w => w.id)).toEqual([10]); // 12 is watched but status='served', filtered out
  });

  it('is a no-op when omitted (existing behavior unchanged)', async () => {
    const res = await app.request('/api/warrants/unified', {}, env as unknown as Record<string, unknown>);
    const body = await res.json() as { warrants: { id: number }[]; total: number };
    expect(body.total).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.workers.config.mts test-workers/warrantsUnifiedWatchedOnly.test.ts`
Expected: FAIL — `watched_only` isn't read or filtered on yet; the first two assertions return all matching rows regardless of watch state.

- [ ] **Step 3: Add the filter**

Use the Edit tool on `src/routes/warrants.ts`:

old_string:
```
    const matchesPersonOnly = c.req.query('matches_person') === '1';
    const stateFilter = c.req.query('state');
    const statePrefix = c.req.query('state_prefix');

    const localRows = await query<Record<string, any>>(db, 'SELECT * FROM warrants');
```

new_string:
```
    const matchesPersonOnly = c.req.query('matches_person') === '1';
    const stateFilter = c.req.query('state');
    const statePrefix = c.req.query('state_prefix');
    const watchedOnly = c.req.query('watched_only') === '1';
    let watchedWarrantIds: Set<number> = new Set();
    if (watchedOnly) {
      const userId = (c.get('user') as { id?: number } | undefined)?.id;
      if (userId) {
        const watched = await query<{ entity_id: number }>(db,
          `SELECT entity_id FROM intel_watchlist WHERE entity_type = 'warrant' AND added_by = ? AND active = 1`,
          userId);
        watchedWarrantIds = new Set(watched.map((w) => w.entity_id));
      }
    }

    const localRows = await query<Record<string, any>>(db, 'SELECT * FROM warrants');
```

Then, in the same file, add the filter condition to the existing `filtered` predicate — use the Edit tool:

old_string:
```
      if (statePrefix && !String(row.source ?? '').startsWith(statePrefix)) return false;
      return true;
    });
```

new_string:
```
      if (statePrefix && !String(row.source ?? '').startsWith(statePrefix)) return false;
      if (watchedOnly && !watchedWarrantIds.has(Number(row.id))) return false;
      return true;
    });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.workers.config.mts test-workers/warrantsUnifiedWatchedOnly.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Run the Worker typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/routes/warrants.ts test-workers/warrantsUnifiedWatchedOnly.test.ts
git commit -m "feat(warrants): add watched_only filter to GET /warrants/unified"
```

---

### Task 5: Client `useWatchedWarrantIds` hook

**Files:**
- Create: `client/src/pages/warrants/useWatchedWarrantIds.ts`
- Create: `client/src/pages/warrants/useWatchedWarrantIds.test.ts`

**Interfaces:**
- Consumes: `apiFetch` (existing `client/src/hooks/useApi.ts`), `GET /api/intel/watchlist` (existing, returns an array of `{ entity_type, entity_id, ... }` rows).
- Produces (consumed by Task 6): `useWatchedWarrantIds(): { watchedIds: Set<number>; refresh: () => Promise<void> }`.

- [ ] **Step 1: Write the failing test**

```ts
// client/src/pages/warrants/useWatchedWarrantIds.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const apiFetchMock = vi.fn();
vi.mock('../../hooks/useApi', () => ({ apiFetch: (...args: unknown[]) => apiFetchMock(...args) }));

import { useWatchedWarrantIds } from './useWatchedWarrantIds';

describe('useWatchedWarrantIds', () => {
  beforeEach(() => apiFetchMock.mockReset());

  it('fetches on mount and filters to entity_type=warrant', async () => {
    apiFetchMock.mockResolvedValue([
      { entity_type: 'warrant', entity_id: 10 },
      { entity_type: 'warrant', entity_id: 12 },
      { entity_type: 'person', entity_id: 900 },
    ]);
    const { result } = renderHook(() => useWatchedWarrantIds());
    await waitFor(() => expect(result.current.watchedIds.size).toBe(2));
    expect(result.current.watchedIds.has(10)).toBe(true);
    expect(result.current.watchedIds.has(12)).toBe(true);
    expect(result.current.watchedIds.has(900)).toBe(false);
    expect(apiFetchMock).toHaveBeenCalledWith('/intel/watchlist');
  });

  it('refresh() re-fetches and updates the set', async () => {
    apiFetchMock.mockResolvedValue([{ entity_type: 'warrant', entity_id: 10 }]);
    const { result } = renderHook(() => useWatchedWarrantIds());
    await waitFor(() => expect(result.current.watchedIds.size).toBe(1));

    apiFetchMock.mockResolvedValue([{ entity_type: 'warrant', entity_id: 10 }, { entity_type: 'warrant', entity_id: 11 }]);
    await act(async () => { await result.current.refresh(); });
    expect(result.current.watchedIds.has(11)).toBe(true);
  });

  it('leaves watchedIds empty (not throwing) when the fetch fails', async () => {
    apiFetchMock.mockRejectedValue(new Error('network error'));
    const { result } = renderHook(() => useWatchedWarrantIds());
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalled());
    expect(result.current.watchedIds.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/pages/warrants/useWatchedWarrantIds.test.ts`
Expected: FAIL — `Cannot find module './useWatchedWarrantIds'`

- [ ] **Step 3: Write the hook**

```ts
// client/src/pages/warrants/useWatchedWarrantIds.ts
// Tracks the current user's watched warrant ids (a subset of
// intel_watchlist filtered to entity_type='warrant') for the
// WarrantsListTab "Watch"/"Unwatch" menu item and the "My Watched
// Warrants" filter chip. Best-effort UI state — a failed fetch just
// leaves the set empty rather than surfacing an error, since this only
// affects a menu label and a filter, not core warrant data.
import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../../hooks/useApi';

interface WatchlistRow {
  entity_type: string;
  entity_id: number;
}

export function useWatchedWarrantIds(): { watchedIds: Set<number>; refresh: () => Promise<void> } {
  const [watchedIds, setWatchedIds] = useState<Set<number>>(new Set());

  const refresh = useCallback(async () => {
    try {
      const rows = await apiFetch<WatchlistRow[]>('/intel/watchlist');
      setWatchedIds(new Set(
        (rows || [])
          .filter((r) => r.entity_type === 'warrant')
          .map((r) => r.entity_id),
      ));
    } catch {
      setWatchedIds(new Set());
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { watchedIds, refresh };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/pages/warrants/useWatchedWarrantIds.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/warrants/useWatchedWarrantIds.ts client/src/pages/warrants/useWatchedWarrantIds.test.ts
git commit -m "feat(warrants): add useWatchedWarrantIds hook"
```

---

### Task 6: `WarrantsListTab.tsx` — Watch/Unwatch menu item + "My Watched Warrants" filter chip

**Files:**
- Modify: `client/src/pages/warrants/WarrantsListTab.tsx`
- Modify: `client/src/pages/warrants/__tests__/WarrantsListTab.test.tsx`

**Interfaces:**
- Consumes: `useWatchedWarrantIds()` (Task 5), `apiFetch` (existing), `FilterChip` (existing internal component, `WarrantsListTab.tsx:170`), `useMenuActions()`'s `m.action` (existing), `useToast()`'s `addToast` (existing).

- [ ] **Step 1: Write the failing tests**

Add to the end of `client/src/pages/warrants/__tests__/WarrantsListTab.test.tsx` (inside the existing `describe('WarrantsListTab', ...)` block, before its closing `});`):

```ts
  it('shows a "My Watched Warrants" filter chip that adds watched_only=1 to the request', async () => {
    renderTab();
    await waitFor(() => expect(useApiModule.apiFetch).toHaveBeenCalled());
    const chip = screen.getByRole('button', { name: /my watched warrants/i });
    await userEvent.click(chip);
    await waitFor(() => {
      expect(useApiModule.apiFetch).toHaveBeenCalledWith(expect.stringContaining('watched_only=1'));
    });
  });

  it('toggling the chip off removes watched_only from the request', async () => {
    renderTab();
    await waitFor(() => expect(useApiModule.apiFetch).toHaveBeenCalled());
    const chip = screen.getByRole('button', { name: /my watched warrants/i });
    await userEvent.click(chip); // on
    await waitFor(() => expect(useApiModule.apiFetch).toHaveBeenCalledWith(expect.stringContaining('watched_only=1')));
    await userEvent.click(chip); // off
    await waitFor(() => {
      const lastCall = (useApiModule.apiFetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[0];
      expect(String(lastCall)).not.toContain('watched_only');
    });
  });
```

Also add a small standalone test for the watch-toggle menu item. The existing top-of-file mock for `ContextMenuContext` (`vi.mock('../../../context/ContextMenuContext', () => ({ useContextMenu: () => ({ openMenu: vi.fn() }) }))`) creates a NEW `vi.fn()` every time `useContextMenu()` is called, so it can't be used to capture what a later render passed to `openMenu` — it needs to become a stable, hoisted reference so the test can inspect calls made to it. Replace that existing mock declaration:

old_string (in the test file's existing mocks, near the top):
```
vi.mock('../../../context/ContextMenuContext', () => ({
  useContextMenu: () => ({ openMenu: vi.fn() }),
}));
```

new_string:
```
const { openMenuMock } = vi.hoisted(() => ({ openMenuMock: vi.fn() }));
vi.mock('../../../context/ContextMenuContext', () => ({
  useContextMenu: () => ({ openMenu: openMenuMock }),
}));
```

Then add the new describe block at the end of the file:

```tsx
describe('WarrantsListTab — watch/unwatch action', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    openMenuMock.mockClear();
  });

  it('POSTs to /intel/watchlist when watching an unwatched warrant via the context menu', async () => {
    vi.spyOn(useApiModule, 'apiFetch').mockImplementation(async (path: string) => {
      if (String(path).includes('/warrants/unified')) {
        return { warrants: [{ id: 10, warrant_number: 'W-10', status: 'active', subject_name: 'Jane Roe', subject_person_id: null }], total: 1 };
      }
      if (String(path) === '/intel/watchlist') return []; // useWatchedWarrantIds' own fetch — no watches yet
      return {};
    });
    renderTab();
    const row = await screen.findByText('W-10');
    row.closest('tr, div')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));

    await waitFor(() => expect(openMenuMock).toHaveBeenCalled());
    const menuItems = openMenuMock.mock.calls.at(-1)?.[1] as { label: string; onClick: () => void }[] | undefined;
    const watchItem = menuItems?.find((i) => /watch this warrant/i.test(i.label));
    expect(watchItem).toBeTruthy();

    await act(async () => { await watchItem!.onClick(); });
    expect(useApiModule.apiFetch).toHaveBeenCalledWith('/intel/watchlist', expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('"entity_type":"warrant"'),
    }));
  });

  it('labels the menu item "Unwatch this warrant" when the warrant is already watched', async () => {
    vi.doMock('../useWatchedWarrantIds', () => ({
      useWatchedWarrantIds: () => ({ watchedIds: new Set([10]), refresh: vi.fn() }),
    }));
    vi.resetModules();
    const { default: WarrantsListTabReloaded } = await import('../WarrantsListTab');
    vi.spyOn(useApiModule, 'apiFetch').mockImplementation(async (path: string) => {
      if (String(path).includes('/warrants/unified')) {
        return { warrants: [{ id: 10, warrant_number: 'W-10', status: 'active', subject_name: 'Jane Roe', subject_person_id: null }], total: 1 };
      }
      return [];
    });
    render(<MemoryRouter><WarrantsListTabReloaded {...baseProps} /></MemoryRouter>);
    const row = await screen.findByText('W-10');
    row.closest('tr, div')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    await waitFor(() => expect(openMenuMock).toHaveBeenCalled());
    const menuItems = openMenuMock.mock.calls.at(-1)?.[1] as { label: string }[] | undefined;
    expect(menuItems?.some((i) => /unwatch this warrant/i.test(i.label))).toBe(true);
  });
});
```

The second test uses `vi.resetModules()` + a dynamic re-import specifically because it needs a DIFFERENT `watchedIds` value than the rest of the file's shared top-of-file mock — this is the correct, supported way to vary a mock per-test in Vitest (unlike the unsupported `vi.doMock`-without-reset pattern this replaces).

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd client && npx vitest run src/pages/warrants/__tests__/WarrantsListTab.test.tsx`
Expected: FAIL — no `filterWatchedOnly` state/chip exists yet, and no `useWatchedWarrantIds` import exists in `WarrantsListTab.tsx` (the mock in the test has nothing to mock yet, but the "My Watched Warrants" chip won't render).

- [ ] **Step 3: Add the hook, state, and filter param**

Use the Edit tool on `client/src/pages/warrants/WarrantsListTab.tsx`. First, the import:

old_string:
```
import { toDisplayLabel } from '../../utils/formatters';
```

new_string:
```
import { toDisplayLabel } from '../../utils/formatters';
import { useWatchedWarrantIds } from './useWatchedWarrantIds';
```

Then add the hook call and state, right after the existing filter-chip state block:

old_string:
```
  const [filterFederal, setFilterFederal] = useState(false);
  const [filterArchivedChip, setFilterArchivedChip] = useState(false);
```

new_string:
```
  const [filterFederal, setFilterFederal] = useState(false);
  const [filterArchivedChip, setFilterArchivedChip] = useState(false);
  const [filterWatchedOnly, setFilterWatchedOnly] = useState(false);
  const { watchedIds, refresh: refreshWatchedIds } = useWatchedWarrantIds();
```

Then add `watched_only` to the request params and the hook's dependency array:

old_string:
```
      if (filterArchivedChip) params.set('include_archived', '1');

      // Try unified endpoint first, fall back to standard
```

new_string:
```
      if (filterArchivedChip) params.set('include_archived', '1');
      if (filterWatchedOnly) params.set('watched_only', '1');

      // Try unified endpoint first, fall back to standard
```

old_string:
```
  }, [filterStatus, filterType, filterSource, filterCourt, filterSeverity, filterPersonId, debouncedSearch, showArchived, page, sortKey, sortOrder, filterPriority, filterSinceWeek, filterMatches, filterStateChip, filterFederal, filterArchivedChip]);
```

new_string:
```
  }, [filterStatus, filterType, filterSource, filterCourt, filterSeverity, filterPersonId, debouncedSearch, showArchived, page, sortKey, sortOrder, filterPriority, filterSinceWeek, filterMatches, filterStateChip, filterFederal, filterArchivedChip, filterWatchedOnly]);
```

Also update `anyFilterActive` and `clearAllFilters` so the "All" chip and empty-state detection account for it:

old_string:
```
  const anyFilterActive = filterPriority || filterSinceWeek || filterMatches || !!filterStateChip || filterFederal || filterArchivedChip;
```

new_string:
```
  const anyFilterActive = filterPriority || filterSinceWeek || filterMatches || !!filterStateChip || filterFederal || filterArchivedChip || filterWatchedOnly;
```

old_string:
```
  function clearAllFilters() {
    setFilterPriority(false);
    setFilterSinceWeek(false);
    setFilterMatches(false);
    setFilterStateChip('');
    setFilterFederal(false);
    setFilterArchivedChip(false);
  }
```

new_string:
```
  function clearAllFilters() {
    setFilterPriority(false);
    setFilterSinceWeek(false);
    setFilterMatches(false);
    setFilterStateChip('');
    setFilterFederal(false);
    setFilterArchivedChip(false);
    setFilterWatchedOnly(false);
  }
```

- [ ] **Step 4: Add the filter chip to the UI**

old_string:
```
            <FilterChip active={filterFederal} onClick={() => { setFilterFederal(v => !v); setPage(1); }}>Federal only</FilterChip>
            <FilterChip active={filterArchivedChip} onClick={() => { setFilterArchivedChip(v => !v); setPage(1); }}>Show archived</FilterChip>
          </div>
```

new_string:
```
            <FilterChip active={filterFederal} onClick={() => { setFilterFederal(v => !v); setPage(1); }}>Federal only</FilterChip>
            <FilterChip active={filterArchivedChip} onClick={() => { setFilterArchivedChip(v => !v); setPage(1); }}>Show archived</FilterChip>
            <FilterChip active={filterWatchedOnly} onClick={() => { setFilterWatchedOnly(v => !v); setPage(1); }}>My Watched Warrants</FilterChip>
          </div>
```

Also add it to the empty-state's `hasActiveFilter` check:

old_string:
```
                  !!filterPersonId || filterPriority || filterSinceWeek ||
                  filterMatches || !!filterStateChip || filterFederal ||
                  filterArchivedChip;
```

new_string:
```
                  !!filterPersonId || filterPriority || filterSinceWeek ||
                  filterMatches || !!filterStateChip || filterFederal ||
                  filterArchivedChip || filterWatchedOnly;
```

- [ ] **Step 5: Add the Watch/Unwatch context-menu action**

`buildWarrantMenu` is a plain function called per-row (`buildWarrantMenu(w)` inside an `onContextMenu` handler), not itself a React component — it cannot call the `useWatchToggle` hook (hooks may only run inside a component's own render). The toggle logic is written inline instead, directly calling `apiFetch` and refreshing the `watchedIds` set afterward.

First, add the toggle handler function near the other row-action handlers (right before `buildWarrantMenu`):

old_string:
```
  const buildWarrantMenu = (w: Warrant): ContextMenuItem[] => {
```

new_string:
```
  const handleToggleWatch = useCallback(async (w: Warrant) => {
    const isWatched = watchedIds.has(w.id);
    try {
      if (isWatched) {
        await apiFetch(`/intel/watchlist/warrant/${w.id}`, { method: 'DELETE' });
        addToast(`Stopped watching ${w.warrant_number}`, 'success');
      } else {
        await apiFetch('/intel/watchlist', {
          method: 'POST',
          body: JSON.stringify({ entity_type: 'warrant', entity_id: w.id, reason: 'flagged from warrants list' }),
        });
        addToast(`Watching ${w.warrant_number}`, 'success');
      }
      await refreshWatchedIds();
    } catch {
      addToast(isWatched ? 'Failed to unwatch warrant' : 'Failed to watch warrant', 'error');
    }
  }, [watchedIds, refreshWatchedIds, addToast]);

  const buildWarrantMenu = (w: Warrant): ContextMenuItem[] => {
```

Then add the menu item itself, right after "Edit warrant" and before the serve/recall separator (so it's grouped with the other always-available actions, not the active-only ones):

old_string:
```
      m.action('Edit warrant', () => props.onOpenEditForm(w), { icon: <Pencil size={12} /> }),
      m.separator(),
      ...(isActive
```

new_string:
```
      m.action('Edit warrant', () => props.onOpenEditForm(w), { icon: <Pencil size={12} /> }),
      m.action(
        watchedIds.has(w.id) ? 'Unwatch this warrant' : 'Watch this warrant',
        () => handleToggleWatch(w),
        { icon: <Eye size={12} /> },
      ),
      m.separator(),
      ...(isActive
```

`addToast` is already destructured at `WarrantsListTab.tsx:184` (`const { addToast } = useToast();`) and used throughout the component (e.g. line 301) — no new destructuring needed, `handleToggleWatch` just uses the existing binding.

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd client && npx vitest run src/pages/warrants/__tests__/WarrantsListTab.test.tsx`
Expected: PASS (all tests, including the pre-existing ones — confirm no regression)

- [ ] **Step 7: Run the client typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add client/src/pages/warrants/WarrantsListTab.tsx client/src/pages/warrants/__tests__/WarrantsListTab.test.tsx
git commit -m "feat(warrants): add Watch/Unwatch menu action and My Watched Warrants filter chip"
```

---

### Task 7: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full client test suite**

Run: `cd client && npx vitest run`
Expected: All tests pass, including every new test file from Tasks 5-6 (no regressions).

- [ ] **Step 2: Run the full client build**

Run: `cd client && npx vite build`
Expected: Build succeeds.

- [ ] **Step 3: Run the Worker typecheck and root Worker test suite**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 4: Run all new Miniflare route tests together**

Run: `npx vitest run --config vitest.workers.config.mts test-workers/warrantWatchlistCrud.test.ts test-workers/warrantWatchlistSweep.test.ts test-workers/warrantsUnifiedWatchedOnly.test.ts`
Expected: PASS.

- [ ] **Step 5: Apply the migration to local D1 and confirm the schema**

Run: `npm run migrate:local`
Run: `npx wrangler d1 execute rmpg-flex --local --command "PRAGMA table_info(intel_watchlist)"`
Expected: output includes `last_known_status` and `expiry_alerted_at`.

- [ ] **Step 6: Manual browser verification**

Use the Browser pane: start the client dev server, log in (or confirm the login page renders cleanly and stop there if no local dev credentials exist, matching this repo's established pattern for sessions without seeded local auth), navigate to `/warrants`:
- Right-click a warrant row, confirm "Watch this warrant" appears in the context menu.
- Click it, confirm a success toast appears and the menu item now reads "Unwatch this warrant" on the next right-click.
- Click the "My Watched Warrants" filter chip, confirm the list narrows to just that warrant.
- Click the chip again to toggle it off, confirm the full list returns.

- [ ] **Step 7: Final commit (if any manual-verification fixes were needed)**

```bash
git add -A
git commit -m "fix(warrants): address issues found during manual verification"
```

(Skip this commit if Step 6 found no issues.)
