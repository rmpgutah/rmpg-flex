# Warrant Tab Backend Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dedupe the `warrants` table's redundant columns, enforce a proper status lifecycle server-side, and clean up the route internals that drifted apart from the frontend over many incremental patches — without changing any of the 33 existing endpoint URLs/methods.

**Architecture:** One new migration (`0200_warrants_schema_dedup.sql`) backfills and drops 4 duplicate columns from `warrants` (`warrant_type`, `person_id`, `court`, `judge`, `bond_amount`, `offense`, `offense_description`, `expiry_date`, `service_date` — see table below). A new `src/utils/warrantStatus.ts` module centralizes the status state machine, imported by the routes that mutate `warrants.status`. Every route in `src/routes/warrants.ts` that reads/writes a deduped column gets updated to the single canonical name. A new `POST /:id/reopen` endpoint is added. Frontend changes are minimal because the canonical names were chosen to match what `WarrantsPage.tsx`'s `Warrant` TypeScript interface already uses.

**Tech Stack:** Cloudflare Workers, Hono, D1 (SQLite), TypeScript, Vitest (`tests/` for Node-env unit tests, `test-workers/` for Miniflare route tests), React 18 (client).

## Global Constraints

- Every existing endpoint path/method in `src/routes/warrants.ts` stays unchanged — no URL renames, no removed routes.
- Canonical column names (from `docs/superpowers/specs/2026-07-21-warrant-tab-backend-rebuild-design.md`, as corrected during planning): `type`, `subject_person_id`, `charge_description`, `issuing_court`, `issuing_judge`, `bail_amount`, `expires_at`, `served_at`. Dropped: `warrant_type`, `person_id`, `offense`, `offense_description`, `court`, `judge`, `bond_amount`, `expiry_date`, `service_date`.
- Canonical status values: `active` | `served` | `recalled` | `expired` | `quashed` (matches `WarrantsPage.tsx:56`'s existing TS union — do not add a 6th value). `archived_at` stays an orthogonal soft-delete column, not a status value.
- D1 queries are async — always `await` (per CLAUDE.md).
- All D1 bound-parameter batches over ~90 ids must be chunked (existing `chunkIds`/`ID_CHUNK_SIZE` helper in `src/routes/warrants.ts` — reuse it, don't duplicate).
- After merging, apply the migration directly to live D1 via `scripts/apply-migration.sh 0200_warrants_schema_dedup.sql` and verify with `pragma_table_info('warrants')` (deploy's migration-apply step is `continue-on-error: true` per CLAUDE.md).
- New Worker code follows the structured logger (`src/utils/logger.ts`'s `log.error`) where a route already uses it (search-all does; most others still use `console.error` — match the existing pattern in the specific route you're editing, don't do a blanket conversion outside this plan's scope).

---

## File Structure

- **Create** `migrations/0200_warrants_schema_dedup.sql` — backfill + drop duplicate columns.
- **Create** `src/utils/warrantStatus.ts` — status state machine (`isValidTransition`, `WARRANT_STATUSES`, `WarrantStatus` type).
- **Create** `tests/warrantStatus.test.ts` — Node-env unit tests for the state machine.
- **Modify** `src/routes/warrants.ts` — column reference cleanup across ~10 routes, state-machine enforcement in `PUT /:id` / `PUT /:id/serve` / `POST /:id/archive` / `POST /:id/unarchive`, new `POST /:id/reopen`.
- **Modify** `src/utils/utahWarrantPoller.ts` — drop dual-writes to the removed duplicate columns.
- **Create** `test-workers/warrantsStatusTransitions.test.ts` — Miniflare route tests for the state machine + reopen RBAC.
- **Modify** `client/src/pages/WarrantsPage.tsx` — add a "Reopen" action.
- **Modify** `client/src/pages/warrants/ScrapersTab.tsx` — complete the `formatLiveFeedEntry` TODO (live-feed event rendering).

---

### Task 1: Migration — dedupe `warrants` schema

**Files:**
- Create: `migrations/0200_warrants_schema_dedup.sql`
- Test: manual verification via `npm run migrate:local` + `pragma_table_info`

**Interfaces:**
- Produces: `warrants` table with columns `warrant_type`, `person_id`, `court`, `judge`, `bond_amount`, `offense`, `offense_description`, `expiry_date`, `service_date` removed; all data preserved in the canonical columns (`type`, `subject_person_id`, `issuing_court`, `issuing_judge`, `bail_amount`, `charge_description`, `expires_at`, `served_at`).

- [ ] **Step 1: Write the migration file**

```sql
-- ============================================================
-- 0200: warrants schema dedup
-- ============================================================
-- The `warrants` table accumulated duplicate column pairs from years of
-- incremental patches (see docs/superpowers/specs/2026-07-21-warrant-tab-
-- backend-rebuild-design.md). This migration backfills each canonical
-- column from its deprecated twin wherever the canonical value is NULL,
-- then drops the deprecated column. Canonical choices were verified against
-- actual usage across src/ and client/src/ during planning — `type` and
-- `subject_person_id` (not `warrant_type`/`person_id`) are what's actually
-- read/written everywhere, including the frontend's Warrant TS interface.
-- ============================================================

-- type / warrant_type — always dual-written historically, so this backfill
-- is defensive (covers any row that predates the dual-write, e.g. rows
-- inserted directly via D1 console/import).
UPDATE warrants SET type = warrant_type WHERE type IS NULL AND warrant_type IS NOT NULL;

-- subject_person_id / person_id — person_id has no read/write call sites
-- anywhere in src/ or client/src/ (confirmed via repo-wide grep during
-- planning); this backfill exists only in case some row has data in
-- person_id that was never mirrored to subject_person_id.
UPDATE warrants SET subject_person_id = person_id WHERE subject_person_id IS NULL AND person_id IS NOT NULL;

-- charge_description / offense / offense_description — priority order
-- matches the COALESCE(charge_description, offense_description, offense)
-- pattern already used in src/routes/warrants.ts's national-search route.
UPDATE warrants SET charge_description = offense_description WHERE charge_description IS NULL AND offense_description IS NOT NULL;
UPDATE warrants SET charge_description = offense WHERE charge_description IS NULL AND offense IS NOT NULL;

-- issuing_court / court
UPDATE warrants SET issuing_court = court WHERE issuing_court IS NULL AND court IS NOT NULL;

-- issuing_judge / judge
UPDATE warrants SET issuing_judge = judge WHERE issuing_judge IS NULL AND judge IS NOT NULL;

-- bail_amount / bond_amount
UPDATE warrants SET bail_amount = bond_amount WHERE bail_amount IS NULL AND bond_amount IS NOT NULL;

-- expires_at / expiry_date
UPDATE warrants SET expires_at = expiry_date WHERE expires_at IS NULL AND expiry_date IS NOT NULL;

-- served_at / service_date
UPDATE warrants SET served_at = service_date WHERE served_at IS NULL AND service_date IS NOT NULL;

-- Drop the now-redundant columns. Requires SQLite 3.35+ (D1's underlying
-- engine supports this). This migration is tracked once in d1_migrations
-- (see scripts/apply-migration.sh) — it is NOT designed to be re-run, unlike
-- the ADD-COLUMN migrations elsewhere in this repo that tolerate re-apply.
ALTER TABLE warrants DROP COLUMN warrant_type;
ALTER TABLE warrants DROP COLUMN person_id;
ALTER TABLE warrants DROP COLUMN offense;
ALTER TABLE warrants DROP COLUMN offense_description;
ALTER TABLE warrants DROP COLUMN court;
ALTER TABLE warrants DROP COLUMN judge;
ALTER TABLE warrants DROP COLUMN bond_amount;
ALTER TABLE warrants DROP COLUMN expiry_date;
ALTER TABLE warrants DROP COLUMN service_date;
```

- [ ] **Step 2: Apply locally and verify**

Run: `npm run migrate:local`
Expected: no errors.

Run: `npx wrangler d1 execute rmpg-flex --local --command "SELECT name FROM pragma_table_info('warrants') ORDER BY name"`
Expected: output includes `type`, `subject_person_id`, `charge_description`, `issuing_court`, `issuing_judge`, `bail_amount`, `expires_at`, `served_at`; does NOT include `warrant_type`, `person_id`, `offense`, `offense_description`, `court`, `judge`, `bond_amount`, `expiry_date`, `service_date`.

- [ ] **Step 3: Commit**

```bash
git add migrations/0200_warrants_schema_dedup.sql
git commit -m "feat(warrants): dedupe redundant warrants table columns

Backfills 8 duplicate column pairs into their canonical column, then
drops the deprecated ones. See docs/superpowers/specs/2026-07-21-warrant-
tab-backend-rebuild-design.md for the canonical-choice rationale."
```

---

### Task 2: Status state machine module

**Files:**
- Create: `src/utils/warrantStatus.ts`
- Test: `tests/warrantStatus.test.ts`

**Interfaces:**
- Produces:
  - `type WarrantStatus = 'active' | 'served' | 'recalled' | 'expired' | 'quashed'`
  - `const WARRANT_STATUSES: readonly WarrantStatus[]`
  - `function isValidStatus(value: unknown): value is WarrantStatus`
  - `function isValidTransition(from: WarrantStatus, to: WarrantStatus): boolean`
  - `const TERMINAL_STATUSES: ReadonlySet<WarrantStatus>` (`served`, `recalled`, `expired`, `quashed`)

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/warrantStatus.test.ts
import { describe, it, expect } from 'vitest';
import {
  WARRANT_STATUSES, TERMINAL_STATUSES, isValidStatus, isValidTransition,
} from '../src/utils/warrantStatus';

describe('warrantStatus', () => {
  it('lists exactly the 5 canonical statuses', () => {
    expect(WARRANT_STATUSES).toEqual(['active', 'served', 'recalled', 'expired', 'quashed']);
  });

  it('isValidStatus accepts only the canonical 5', () => {
    expect(isValidStatus('active')).toBe(true);
    expect(isValidStatus('served')).toBe(true);
    expect(isValidStatus('closed')).toBe(false);
    expect(isValidStatus('')).toBe(false);
    expect(isValidStatus(undefined)).toBe(false);
    expect(isValidStatus(123)).toBe(false);
  });

  it('TERMINAL_STATUSES contains served/recalled/expired/quashed, not active', () => {
    expect(TERMINAL_STATUSES.has('served')).toBe(true);
    expect(TERMINAL_STATUSES.has('recalled')).toBe(true);
    expect(TERMINAL_STATUSES.has('expired')).toBe(true);
    expect(TERMINAL_STATUSES.has('quashed')).toBe(true);
    expect(TERMINAL_STATUSES.has('active')).toBe(false);
  });

  it('active can transition to served, recalled, quashed, or expired', () => {
    expect(isValidTransition('active', 'served')).toBe(true);
    expect(isValidTransition('active', 'recalled')).toBe(true);
    expect(isValidTransition('active', 'quashed')).toBe(true);
    expect(isValidTransition('active', 'expired')).toBe(true);
  });

  it('a status can stay the same (no-op edit)', () => {
    expect(isValidTransition('active', 'active')).toBe(true);
    expect(isValidTransition('served', 'served')).toBe(true);
  });

  it('terminal statuses cannot transition directly to another terminal or to active', () => {
    expect(isValidTransition('served', 'active')).toBe(false);
    expect(isValidTransition('served', 'recalled')).toBe(false);
    expect(isValidTransition('quashed', 'active')).toBe(false);
    expect(isValidTransition('expired', 'served')).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/warrantStatus.test.ts`
Expected: FAIL with "Cannot find module '../src/utils/warrantStatus'"

- [ ] **Step 3: Write the implementation**

```typescript
// src/utils/warrantStatus.ts
// Canonical warrant lifecycle. Matches WarrantsPage.tsx's Warrant['status']
// TS union exactly (client/src/pages/WarrantsPage.tsx:56) — do not add a
// 6th value without updating the frontend type in lockstep.
//
// archived_at (a separate warrants column) is an orthogonal soft-delete
// flag, not part of this state machine — a warrant can be archived from
// any status.

export type WarrantStatus = 'active' | 'served' | 'recalled' | 'expired' | 'quashed';

export const WARRANT_STATUSES: readonly WarrantStatus[] = [
  'active', 'served', 'recalled', 'expired', 'quashed',
] as const;

// served/recalled/expired/quashed are terminal: reachable from active (or
// from each other only via the same value, i.e. a no-op re-save), and the
// only way back to active is the explicit /reopen endpoint — never a plain
// PUT /:id status-field edit.
export const TERMINAL_STATUSES: ReadonlySet<WarrantStatus> = new Set([
  'served', 'recalled', 'expired', 'quashed',
]);

export function isValidStatus(value: unknown): value is WarrantStatus {
  return typeof value === 'string' && (WARRANT_STATUSES as readonly string[]).includes(value);
}

// Allowed transitions for PUT /:id and the dedicated action routes:
//   - staying on the same status is always allowed (a plain field edit
//     that happens to re-send the current status)
//   - active -> any of the 4 terminal statuses
//   - a terminal status -> active is NOT allowed here; that's /reopen's job
//   - a terminal status -> a different terminal status is not allowed;
//     the operator must reopen first, then re-transition
export function isValidTransition(from: WarrantStatus, to: WarrantStatus): boolean {
  if (from === to) return true;
  if (from === 'active') return TERMINAL_STATUSES.has(to);
  return false;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/warrantStatus.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/utils/warrantStatus.ts tests/warrantStatus.test.ts
git commit -m "feat(warrants): add status state machine module"
```

---

### Task 3: Enforce state machine + add reopen in `src/routes/warrants.ts`

**Files:**
- Modify: `src/routes/warrants.ts:1036-1150` (`PUT /:id`, `PUT /:id/serve`, `POST /:id/archive`, `POST /:id/unarchive`, `DELETE /:id`) and add a new route immediately after `PUT /:id/serve`
- Test: `test-workers/warrantsStatusTransitions.test.ts` (Task 6 — this task's routes are exercised there; no separate test file here since Miniflare/D1 is required to exercise real routes)

**Interfaces:**
- Consumes: `isValidStatus`, `isValidTransition`, `WarrantStatus` from `../utils/warrantStatus` (Task 2)
- Produces: `POST /:id/reopen` route (admin/supervisor/manager only, via existing `requireRole` from `../middleware/auth`)

- [ ] **Step 1: Import the state machine and `requireRole` at the top of the file**

In `src/routes/warrants.ts`, after the existing imports (around line 15):

```typescript
import { requireRole } from '../middleware/auth';
import { isValidStatus, isValidTransition, TERMINAL_STATUSES, type WarrantStatus } from '../utils/warrantStatus';
```

- [ ] **Step 2: Enforce the state machine in `PUT /:id`**

Replace the body of `warrants.put('/:id', ...)` (currently `src/routes/warrants.ts:1036-1075`):

```typescript
warrants.put('/:id', async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid warrant id' }, 400);
    const existing = await queryFirst<{ id: number; subject_person_id: number | null; status: string }>(
      db, 'SELECT id, subject_person_id, status FROM warrants WHERE id = ?', id);
    if (!existing) return c.json({ error: 'Warrant not found' }, 404);

    const body = await c.req.json<Record<string, unknown>>();

    if ('status' in body) {
      if (!isValidStatus(body.status)) {
        return c.json({ error: 'invalid_status', message: `status must be one of: ${WARRANT_STATUSES.join(', ')}` }, 400);
      }
      const fromStatus = existing.status as WarrantStatus;
      if (isValidStatus(fromStatus) && !isValidTransition(fromStatus, body.status)) {
        return c.json({
          error: 'invalid_status_transition',
          from: fromStatus,
          to: body.status,
          message: TERMINAL_STATUSES.has(fromStatus)
            ? `Warrant is ${fromStatus} (terminal) — use POST /:id/reopen before changing status`
            : `Cannot transition from ${fromStatus} to ${body.status}`,
        }, 400);
      }
    }

    const sets: string[] = [];
    const params: unknown[] = [];
    for (const col of ALLOWED_WARRANT_COLUMNS) {
      if (col in body) {
        sets.push(`${col} = ?`);
        params.push(body[col]);
      }
    }
    if (sets.length === 0) return c.json({ error: 'No updatable fields provided' }, 400);
    sets.push(`updated_at = datetime('now')`);
    params.push(id);

    await execute(db, `UPDATE warrants SET ${sets.join(', ')} WHERE id = ?`, ...params);
    const updated = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM warrants WHERE id = ?', id);

    // Only re-screen when subject_person_id actually changed — an edit to
    // status/bail/notes/etc. must not trigger a fresh 7-source scan.
    if ('subject_person_id' in body && body.subject_person_id != null
        && Number(body.subject_person_id) !== existing.subject_person_id) {
      c.executionCtx.waitUntil(
        screenPersonAllSources(c.env, Number(body.subject_person_id), { triggeredBy: 'warrant_update' })
          .catch((err) => console.error('[warrants] screening trigger failed:', err)),
      );
    }
    return c.json(updated);
  } catch (err) {
    console.error('[warrants] update error', err);
    return c.json({ error: 'Failed to update warrant' }, 500);
  }
});
```

Note: this references `WARRANT_STATUSES` in the error message — add it to the import from Step 1:

```typescript
import { isValidStatus, isValidTransition, TERMINAL_STATUSES, WARRANT_STATUSES, type WarrantStatus } from '../utils/warrantStatus';
```

- [ ] **Step 3: Enforce `active` precondition in `PUT /:id/serve`**

Replace the body of `warrants.put('/:id/serve', ...)` (currently `src/routes/warrants.ts:1078-1101`):

```typescript
warrants.put('/:id/serve', async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid warrant id' }, 400);
    const existing = await queryFirst<{ id: number; status: string }>(db, 'SELECT id, status FROM warrants WHERE id = ?', id);
    if (!existing) return c.json({ error: 'Warrant not found' }, 404);
    const fromStatus = existing.status as WarrantStatus;
    if (isValidStatus(fromStatus) && !isValidTransition(fromStatus, 'served')) {
      return c.json({ error: 'invalid_status_transition', from: fromStatus, to: 'served' }, 400);
    }

    const body = await c.req.json<{ served_location?: string | null }>().catch(() => ({} as { served_location?: string | null }));
    const user = c.get('user') as { id?: number } | undefined;

    await execute(
      db,
      `UPDATE warrants SET status = 'served', served_at = datetime('now'),
         served_location = ?, served_by = ?, updated_at = datetime('now') WHERE id = ?`,
      body.served_location ?? null, user?.id ?? null, id,
    );
    const updated = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM warrants WHERE id = ?', id);
    return c.json(updated);
  } catch (err) {
    console.error('[warrants] serve error', err);
    return c.json({ error: 'Failed to mark warrant served' }, 500);
  }
});
```

(Note: `service_date = datetime('now')` is dropped from the SET clause — that column no longer exists after Task 1's migration.)

- [ ] **Step 4: Add `POST /:id/reopen` immediately after the serve route**

Insert directly after the closing `});` of `PUT /:id/serve` (before `POST /:id/archive`):

```typescript
// POST /warrants/:id/reopen — the only way a terminal-status warrant
// (served/recalled/expired/quashed) can return to 'active'. Gated to
// admin/supervisor/manager (same tier as sensitive warrant-record actions
// elsewhere in this file) and audit-logged, since silently flipping a
// closed warrant back open is a meaningful record-keeping event.
warrants.post('/:id/reopen', requireRole('admin', 'supervisor', 'manager'), async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid warrant id' }, 400);
    const existing = await queryFirst<{ id: number; status: string }>(db, 'SELECT id, status FROM warrants WHERE id = ?', id);
    if (!existing) return c.json({ error: 'Warrant not found' }, 404);
    const fromStatus = existing.status as WarrantStatus;
    if (isValidStatus(fromStatus) && !TERMINAL_STATUSES.has(fromStatus)) {
      return c.json({ error: 'not_terminal', message: `Warrant is already ${fromStatus}` }, 400);
    }

    const user = c.get('user') as { id?: number } | undefined;
    await execute(
      db,
      `UPDATE warrants SET status = 'active', updated_at = datetime('now') WHERE id = ?`,
      id,
    );
    await execute(
      db,
      `INSERT INTO audit_log (user_id, action, entity_type, entity_id, details) VALUES (?, 'warrant_reopen', 'warrant', ?, ?)`,
      user?.id ?? null, String(id), JSON.stringify({ from_status: fromStatus }),
    );
    const updated = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM warrants WHERE id = ?', id);
    return c.json(updated);
  } catch (err) {
    console.error('[warrants] reopen error', err);
    return c.json({ error: 'Failed to reopen warrant' }, 500);
  }
});
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no new errors from `src/routes/warrants.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/routes/warrants.ts
git commit -m "feat(warrants): enforce status state machine, add POST /:id/reopen"
```

---

### Task 4: Fix remaining column references in `src/routes/warrants.ts`

**Files:**
- Modify: `src/routes/warrants.ts` — `POST /search-all` (lines ~342-343), `POST /national-search` (lines ~581-582), `computePriorityScore` (line ~632, ~635), `GET /expiring` (lines ~770, ~774), `GET /unified` (lines ~834-836), `POST /ingest-utah` (line ~1267), `GET /summary-report` (lines ~1318-1319)

**Interfaces:**
- Consumes: nothing new (pure column-reference cleanup against the Task 1 migration)
- Produces: no interface changes — same response shapes, since the deduped columns were already the ones actually populated/read in practice

- [ ] **Step 1: Fix `POST /search-all`'s local-table filter columns**

In `src/routes/warrants.ts`, find (around line 342-343):

```typescript
    if (body.courtName) { localConditions.push('court LIKE ?'); localParams.push(`%${body.courtName}%`); }
    if (body.charge) { localConditions.push('offense LIKE ?'); localParams.push(`%${body.charge}%`); }
```

Replace with:

```typescript
    if (body.courtName) { localConditions.push('issuing_court LIKE ?'); localParams.push(`%${body.courtName}%`); }
    if (body.charge) { localConditions.push('charge_description LIKE ?'); localParams.push(`%${body.charge}%`); }
```

- [ ] **Step 2: Fix `POST /national-search`'s local-table COALESCE filters**

Find (around line 581-582):

```typescript
  if (body.warrant_type) { localWhere.push("UPPER(COALESCE(warrant_type, type)) = ?"); localParams.push(body.warrant_type.toUpperCase()); }
  if (body.charge_keyword) { localWhere.push('COALESCE(charge_description, offense_description, offense) LIKE ?'); localParams.push(`%${body.charge_keyword}%`); }
```

Replace with:

```typescript
  if (body.warrant_type) { localWhere.push('UPPER(type) = ?'); localParams.push(body.warrant_type.toUpperCase()); }
  if (body.charge_keyword) { localWhere.push('charge_description LIKE ?'); localParams.push(`%${body.charge_keyword}%`); }
```

- [ ] **Step 3: Fix `computePriorityScore`'s COALESCE reads**

Find (around line 632, 635):

```typescript
  const bail = Number(row.bail_amount ?? row.bond_amount) || 0;
  const attempts = Number(row.service_attempt_count) || 0;
  let urgency = 0;
  const expiresAt = row.expires_at ?? row.expiry_date;
```

Replace with:

```typescript
  const bail = Number(row.bail_amount) || 0;
  const attempts = Number(row.service_attempt_count) || 0;
  let urgency = 0;
  const expiresAt = row.expires_at;
```

- [ ] **Step 4: Fix `GET /expiring`'s COALESCE read**

Find (around line 769-774):

```typescript
    const rows = await query<Record<string, any>>(
      db, `SELECT expires_at, expiry_date FROM warrants WHERE status = 'active'`,
    );
    const now = Date.now();
    const count = rows.filter((row) => {
      const exp = row.expires_at ?? row.expiry_date;
      if (!exp) return false;
```

Replace with:

```typescript
    const rows = await query<Record<string, any>>(
      db, `SELECT expires_at FROM warrants WHERE status = 'active'`,
    );
    const now = Date.now();
    const count = rows.filter((row) => {
      const exp = row.expires_at;
      if (!exp) return false;
```

- [ ] **Step 5: Fix `GET /unified`'s local-row reshape**

Find (around line 830-838):

```typescript
    const localRows = await query<Record<string, any>>(db, 'SELECT * FROM warrants');
    let merged: Record<string, any>[] = localRows.map((row) => ({
      ...row,
      source: row.source ?? 'local',
      charge_description: row.charge_description ?? row.offense ?? null,
      bail_amount: row.bail_amount ?? row.bond_amount ?? null,
      issuing_court: row.issuing_court ?? row.court ?? null,
      source_state: null,
    }));
```

Replace with:

```typescript
    const localRows = await query<Record<string, any>>(db, 'SELECT * FROM warrants');
    let merged: Record<string, any>[] = localRows.map((row) => ({
      ...row,
      source: row.source ?? 'local',
      source_state: null,
    }));
```

(`charge_description`, `bail_amount`, and `issuing_court` are already present on `row` from `SELECT *` since they're the canonical columns — no reshape needed.)

- [ ] **Step 6: Fix `POST /ingest-utah`'s INSERT column list**

Find (around line 1266-1268):

```typescript
      await execute(
        db,
        `INSERT INTO warrants (warrant_number, type, status, subject_name, offense, court, bond_amount, issued_date)
         VALUES (?, 'arrest', 'active', ?, ?, ?, ?, ?)`,
        warrantNumber, subjectName,
        Array.isArray(w.charges) ? w.charges.filter(Boolean).join('; ') : (w.charges || null),
        w.court_name ?? null, w.bail_amount ?? null, w.issue_date ?? null,
      );
```

Replace with:

```typescript
      await execute(
        db,
        `INSERT INTO warrants (warrant_number, type, status, subject_name, charge_description, issuing_court, bail_amount, issued_date)
         VALUES (?, 'arrest', 'active', ?, ?, ?, ?, ?)`,
        warrantNumber, subjectName,
        Array.isArray(w.charges) ? w.charges.filter(Boolean).join('; ') : (w.charges || null),
        w.court_name ?? null, w.bail_amount ?? null, w.issue_date ?? null,
      );
```

- [ ] **Step 7: Fix `GET /summary-report`'s top-courts query**

Find (around line 1317-1324):

```typescript
    const topCourtsWhere = where.length
      ? `WHERE ${where.join(' AND ')} AND court IS NOT NULL`
      : 'WHERE court IS NOT NULL';

    const [byStatusRows, byTypeRows, topCourtsRows, newCountRow, clearedCountRow, latestRun] = await Promise.all([
      query<{ status: string; n: number }>(db, `SELECT status, COUNT(*) AS n FROM warrants ${whereClause} GROUP BY status`, ...params),
      query<{ type: string; n: number }>(db, `SELECT type, COUNT(*) AS n FROM warrants ${whereClause} GROUP BY type`, ...params),
      query<{ issuing_court: string; count: number }>(
        db,
        `SELECT court AS issuing_court, COUNT(*) AS count FROM warrants ${topCourtsWhere} GROUP BY court ORDER BY count DESC LIMIT 10`,
        ...params,
      ).catch(() => []),
```

Replace with:

```typescript
    const topCourtsWhere = where.length
      ? `WHERE ${where.join(' AND ')} AND issuing_court IS NOT NULL`
      : 'WHERE issuing_court IS NOT NULL';

    const [byStatusRows, byTypeRows, topCourtsRows, newCountRow, clearedCountRow, latestRun] = await Promise.all([
      query<{ status: string; n: number }>(db, `SELECT status, COUNT(*) AS n FROM warrants ${whereClause} GROUP BY status`, ...params),
      query<{ type: string; n: number }>(db, `SELECT type, COUNT(*) AS n FROM warrants ${whereClause} GROUP BY type`, ...params),
      query<{ issuing_court: string; count: number }>(
        db,
        `SELECT issuing_court, COUNT(*) AS count FROM warrants ${topCourtsWhere} GROUP BY issuing_court ORDER BY count DESC LIMIT 10`,
        ...params,
      ).catch(() => []),
```

- [ ] **Step 8: Fix `POST /` (create)'s INSERT and validation to drop dual-writes**

Find (around line 972-1011, the whole `warrants.post('/', ...)` body — only the `if (!body.type...)` guard, the INSERT column list/VALUES, and the bound params change):

```typescript
    if (!body.type || typeof body.type !== 'string') {
      return c.json({ error: 'type is required' }, 400);
    }
```

stays as-is (no change — `type` was already canonical). Find the INSERT:

```typescript
    const result = await execute(
      db,
      `INSERT INTO warrants (
         warrant_number, type, warrant_type, status,
         subject_person_id, subject_name,
         charge_description, offense, issuing_court, court, issuing_judge, judge,
         bail_amount, bond_amount, offense_level, expires_at, expiry_date, notes,
         statute_id, statute_citation, source, entered_by, created_by,
         created_at, updated_at
       ) VALUES (?, ?, ?, 'active',
         ?, ?,
         ?, ?, ?, ?, ?, ?,
         ?, ?, ?, ?, ?, ?,
         ?, ?, 'manual', ?, ?,
         datetime('now'), datetime('now'))`,
      warrantNumber, body.type, body.type,
      body.subject_person_id ?? null, subjectName,
      body.charge_description, body.charge_description, body.issuing_court ?? null, body.issuing_court ?? null,
      body.issuing_judge ?? null, body.issuing_judge ?? null,
      body.bail_amount ?? null, body.bail_amount ?? null, body.offense_level ?? null,
      body.expires_at ?? null, body.expires_at ?? null, body.notes ?? null,
      body.statute_id ?? null, body.statute_citation ?? null,
      user?.id ?? null, user?.id ?? null,
    );
```

Replace with:

```typescript
    const result = await execute(
      db,
      `INSERT INTO warrants (
         warrant_number, type, status,
         subject_person_id, subject_name,
         charge_description, issuing_court, issuing_judge,
         bail_amount, offense_level, expires_at, notes,
         statute_id, statute_citation, source, entered_by, created_by,
         created_at, updated_at
       ) VALUES (?, ?, 'active',
         ?, ?,
         ?, ?, ?,
         ?, ?, ?, ?,
         ?, ?, 'manual', ?, ?,
         datetime('now'), datetime('now'))`,
      warrantNumber, body.type,
      body.subject_person_id ?? null, subjectName,
      body.charge_description, body.issuing_court ?? null, body.issuing_judge ?? null,
      body.bail_amount ?? null, body.offense_level ?? null,
      body.expires_at ?? null, body.notes ?? null,
      body.statute_id ?? null, body.statute_citation ?? null,
      user?.id ?? null, user?.id ?? null,
    );
```

- [ ] **Step 9: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add src/routes/warrants.ts
git commit -m "refactor(warrants): drop dual-column reads/writes now that schema is deduped"
```

---

### Task 5: Update `src/utils/utahWarrantPoller.ts` to single canonical columns

**Files:**
- Modify: `src/utils/utahWarrantPoller.ts:361-390` (the confirmed-hit UPDATE and INSERT)

**Interfaces:**
- Consumes: nothing new
- Produces: same behavior — poller still upserts `warrants` rows for confirmed Utah hits, now writing only canonical columns

- [ ] **Step 1: Fix the UPDATE branch**

Find (around line 361-372):

```typescript
    await execute(
      db,
      `UPDATE warrants SET
         status='active', archived_at=NULL,
         subject_person_id=?, subject_name=?, subject_first_name=?, subject_last_name=?,
         charge_description=?, offense=?, issuing_court=?, court=?, issued_date=?,
         scraped_source=?, scraped_raw=?, confirmed=1, auto_created=1,
         last_checked_at=datetime('now'), last_check_result='active',
         updated_at=datetime('now')
       WHERE id=?`,
      localPersonId, subjectName, w.first_name, w.last_name,
      chargeText, chargeText, w.court_name, w.court_name, w.issue_date,
      SOURCE_KEY, JSON.stringify(w), existing.id,
    );
```

Replace with:

```typescript
    await execute(
      db,
      `UPDATE warrants SET
         status='active', archived_at=NULL,
         subject_person_id=?, subject_name=?, subject_first_name=?, subject_last_name=?,
         charge_description=?, issuing_court=?, issued_date=?,
         scraped_source=?, scraped_raw=?, confirmed=1, auto_created=1,
         last_checked_at=datetime('now'), last_check_result='active',
         updated_at=datetime('now')
       WHERE id=?`,
      localPersonId, subjectName, w.first_name, w.last_name,
      chargeText, w.court_name, w.issue_date,
      SOURCE_KEY, JSON.stringify(w), existing.id,
    );
```

- [ ] **Step 2: Fix the INSERT branch**

Find (around line 376-390):

```typescript
    await execute(
      db,
      `INSERT INTO warrants (
         warrant_number, type, warrant_type, status,
         subject_person_id, subject_name, subject_first_name, subject_last_name,
         charge_description, offense, issuing_court, court, issued_date,
         source, external_warrant_id, external_source_key, scraped_source, scraped_raw,
         auto_created, confirmed, last_checked_at, last_check_result, created_at, updated_at
       ) VALUES (?, 'arrest', 'arrest', 'active',
         ?, ?, ?, ?, ?, ?, ?, ?, ?,
         ?, ?, ?, ?, ?,
         1, 1, datetime('now'), 'active', datetime('now'), datetime('now'))`,
      `UTW-${w.utah_warrant_id}`,
      localPersonId, subjectName, w.first_name, w.last_name,
      chargeText, chargeText, w.court_name, w.court_name, w.issue_date,
      SOURCE_KEY, w.utah_warrant_id, SOURCE_KEY, SOURCE_KEY, JSON.stringify(w),
    );
```

Replace with:

```typescript
    await execute(
      db,
      `INSERT INTO warrants (
         warrant_number, type, status,
         subject_person_id, subject_name, subject_first_name, subject_last_name,
         charge_description, issuing_court, issued_date,
         source, external_warrant_id, external_source_key, scraped_source, scraped_raw,
         auto_created, confirmed, last_checked_at, last_check_result, created_at, updated_at
       ) VALUES (?, 'arrest', 'active',
         ?, ?, ?, ?, ?, ?, ?,
         ?, ?, ?, ?, ?,
         1, 1, datetime('now'), 'active', datetime('now'), datetime('now'))`,
      `UTW-${w.utah_warrant_id}`,
      localPersonId, subjectName, w.first_name, w.last_name,
      chargeText, w.court_name, w.issue_date,
      SOURCE_KEY, w.utah_warrant_id, SOURCE_KEY, SOURCE_KEY, JSON.stringify(w),
    );
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/utils/utahWarrantPoller.ts
git commit -m "refactor(utahWarrantPoller): drop dual-column writes now that schema is deduped"
```

---

### Task 6: Miniflare integration tests for status transitions + reopen

**Files:**
- Create: `test-workers/warrantsStatusTransitions.test.ts`

**Interfaces:**
- Consumes: `src/routes/warrants.ts` default export (Hono app), `src/middleware/auth.ts`'s `requireRole` behavior (exercised indirectly via role in test harness)

- [ ] **Step 1: Write the test file**

```typescript
// test-workers/warrantsStatusTransitions.test.ts
// Route-level regression test (Miniflare/workerd) for the warrant status
// state machine (PUT /:id, PUT /:id/serve, POST /:id/reopen) added in the
// 2026-07-21 warrant-tab backend rebuild.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { execute, queryFirst } from '../src/utils/db';
import warrants from '../src/routes/warrants';

function buildApp(role: string) {
  const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: { id: number; role: string; username: string }; userId: number } }>();
  app.use('*', async (c, next) => {
    c.set('user', { id: 1, role, username: 'test-user' });
    c.set('userId', 1);
    await next();
  });
  app.route('/api/warrants', warrants);
  return app;
}

async function seedWarrant(db: D1Database, status: string): Promise<number> {
  const result = await execute(
    db,
    `INSERT INTO warrants (warrant_number, type, status, subject_name, charge_description, created_at, updated_at)
     VALUES (?, 'arrest', ?, 'Test Subject', 'test charge', datetime('now'), datetime('now'))`,
    `TEST-${Math.random()}`, status,
  );
  return Number(result.meta.last_row_id);
}

beforeEach(async () => {
  const db = (env as unknown as { DB: D1Database }).DB;
  await execute(db, `CREATE TABLE IF NOT EXISTS warrants (
    id INTEGER PRIMARY KEY AUTOINCREMENT, warrant_number TEXT UNIQUE, type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active', subject_name TEXT, subject_first_name TEXT,
    subject_last_name TEXT, subject_dob TEXT, subject_person_id INTEGER, charge_description TEXT,
    issuing_court TEXT, issuing_judge TEXT, bail_amount REAL, offense_level TEXT, expires_at TEXT,
    notes TEXT, statute_id INTEGER, statute_citation TEXT, source TEXT DEFAULT 'manual',
    entered_by INTEGER, created_by INTEGER, priority TEXT, served_at TEXT, served_by INTEGER,
    served_location TEXT, archived_at TEXT, issued_date TEXT, created_at TEXT, updated_at TEXT
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT DEFAULT (datetime('now')),
    user_id INTEGER, action TEXT, entity_type TEXT, entity_id TEXT, details TEXT
  )`);
  await execute(db, 'DELETE FROM warrants');
  await execute(db, 'DELETE FROM audit_log');
});

describe('PUT /api/warrants/:id — status transitions', () => {
  it('allows active -> quashed', async () => {
    const db = (env as unknown as { DB: D1Database }).DB;
    const id = await seedWarrant(db, 'active');
    const app = buildApp('officer');
    const res = await app.request(`/api/warrants/${id}`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'quashed' }),
    }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string };
    expect(body.status).toBe('quashed');
  });

  it('rejects served -> active directly (must use /reopen)', async () => {
    const db = (env as unknown as { DB: D1Database }).DB;
    const id = await seedWarrant(db, 'served');
    const app = buildApp('officer');
    const res = await app.request(`/api/warrants/${id}`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'active' }),
    }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('invalid_status_transition');
  });

  it('rejects an unknown status value', async () => {
    const db = (env as unknown as { DB: D1Database }).DB;
    const id = await seedWarrant(db, 'active');
    const app = buildApp('officer');
    const res = await app.request(`/api/warrants/${id}`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'closed' }),
    }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('invalid_status');
  });

  it('allows a same-status no-op edit (e.g. updating notes)', async () => {
    const db = (env as unknown as { DB: D1Database }).DB;
    const id = await seedWarrant(db, 'active');
    const app = buildApp('officer');
    const res = await app.request(`/api/warrants/${id}`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'active', notes: 'updated notes' }),
    }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
  });
});

describe('PUT /api/warrants/:id/serve', () => {
  it('rejects serving an already-recalled warrant', async () => {
    const db = (env as unknown as { DB: D1Database }).DB;
    const id = await seedWarrant(db, 'recalled');
    const app = buildApp('officer');
    const res = await app.request(`/api/warrants/${id}/serve`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}),
    }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(400);
  });
});

describe('POST /api/warrants/:id/reopen', () => {
  it('admin can reopen a terminal-status warrant back to active, and it is audit-logged', async () => {
    const db = (env as unknown as { DB: D1Database }).DB;
    const id = await seedWarrant(db, 'quashed');
    const app = buildApp('admin');
    const res = await app.request(`/api/warrants/${id}/reopen`, { method: 'POST' }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string };
    expect(body.status).toBe('active');

    const logRow = await queryFirst<{ action: string; entity_id: string }>(
      db, `SELECT action, entity_id FROM audit_log WHERE action = 'warrant_reopen' AND entity_id = ?`, String(id),
    );
    expect(logRow).toBeTruthy();
  });

  it('officer cannot reopen (403)', async () => {
    const db = (env as unknown as { DB: D1Database }).DB;
    const id = await seedWarrant(db, 'quashed');
    const app = buildApp('officer');
    const res = await app.request(`/api/warrants/${id}/reopen`, { method: 'POST' }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(403);
  });

  it('rejects reopening an already-active warrant', async () => {
    const db = (env as unknown as { DB: D1Database }).DB;
    const id = await seedWarrant(db, 'active');
    const app = buildApp('admin');
    const res = await app.request(`/api/warrants/${id}/reopen`, { method: 'POST' }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('not_terminal');
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `npx vitest run --config vitest.workers.config.mts test-workers/warrantsStatusTransitions.test.ts`
Expected: PASS (8 tests). If `officer cannot reopen` fails with 200 instead of 403, verify Task 3 Step 4 applied `requireRole('admin', 'supervisor', 'manager')` as Hono middleware on that specific route (not just a comment).

- [ ] **Step 3: Commit**

```bash
git add test-workers/warrantsStatusTransitions.test.ts
git commit -m "test(warrants): add Miniflare tests for status state machine + reopen RBAC"
```

---

### Task 7: Frontend — add "Reopen" action to `WarrantsPage.tsx`

**Files:**
- Modify: `client/src/pages/WarrantsPage.tsx`

**Interfaces:**
- Consumes: `POST /warrants/:id/reopen` (Task 3), existing `apiFetch` helper from `client/src/hooks/useApi.ts`, existing `Warrant` interface (`status`, `id` fields)

- [ ] **Step 1: Find the existing status-update handler**

Run: `grep -n "handleUpdateStatus\|const handleUpdateStatus" client/src/pages/WarrantsPage.tsx`

This locates the function WarrantsPage already uses to PUT a new status (referenced in the design doc excerpt at `src/routes/warrants.ts:1034`'s comment: "handleUpdateStatus sends just `{ status }`"). Read the ~15 lines around it to match its exact signature, error handling, and toast/notification pattern before writing Step 2 — this plan does not reproduce it verbatim because the exact implementation must be read fresh (the file is 3,200+ lines and may have shifted since this plan was written).

- [ ] **Step 2: Add a `handleReopenWarrant` function next to `handleUpdateStatus`**

Using the exact same async/error/toast pattern found in Step 1 (substitute the actual pattern — e.g. if `handleUpdateStatus` calls `apiFetch(`/warrants/${id}`, { method: 'PUT', body: ... })` then wraps in try/catch with a toast on failure and a `fetchWarrants()`/state-refresh call on success), add:

```typescript
const handleReopenWarrant = async (id: number) => {
  try {
    await apiFetch(`/warrants/${id}/reopen`, { method: 'POST' });
    // Use whatever refresh call handleUpdateStatus uses on success
    // (e.g. fetchWarrants(), or optimistic local state update) — match it.
  } catch (err) {
    console.error('[WarrantsPage] reopen failed', err);
    // Use whatever error-surfacing handleUpdateStatus uses (toast/alert) — match it.
  }
};
```

- [ ] **Step 3: Add a "Reopen" button gated to terminal statuses**

Find where the warrant detail drawer/row renders its status action buttons (search for where `'served'`, `'recalled'`, `'quashed'` status labels are rendered as buttons — likely near the same block as the Serve/Recall/Quash action buttons). Add a conditional button:

```typescript
{['served', 'recalled', 'expired', 'quashed'].includes(w.status) && (
  <button
    type="button"
    onClick={() => handleReopenWarrant(w.id)}
    className="text-[9px] font-bold uppercase px-2 py-1 rounded-sm border border-rmpg-600/50 text-rmpg-300 hover:bg-rmpg-700/40"
  >
    Reopen
  </button>
)}
```

(Match the exact className pattern of the neighboring Serve/Recall/Quash buttons rather than inventing new styling — read the surrounding JSX first.)

- [ ] **Step 4: Manual verification in dev preview**

Run: `cd client && npm run dev` (or use the project's preview tooling)
Steps:
1. Open the Warrants tab, find or create a warrant, mark it "quashed".
2. Confirm a "Reopen" button now appears on that warrant.
3. Click it as a non-admin/supervisor/manager test user — confirm it fails gracefully (403 surfaced as an error, not a crash).
4. Log in as admin, click Reopen — confirm status flips back to "active" and the button disappears.

- [ ] **Step 5: Run client tests and typecheck**

Run: `cd client && npx tsc --noEmit && npx vitest run`
Expected: no new failures.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/WarrantsPage.tsx
git commit -m "feat(warrants): add Reopen action for terminal-status warrants"
```

---

### Task 8: Frontend — complete `ScrapersTab.tsx`'s live-feed rendering TODO

**Files:**
- Modify: `client/src/pages/warrants/ScrapersTab.tsx` (the `formatLiveFeedEntry`-shaped function flagged `TODO(user-contribution)` around line 85, per the design doc)

**Interfaces:**
- Consumes: `ScraperWsEvent` discriminated union (already imported in the file), `LiveFeedDisplay` interface (already defined at the TODO site: `{ color: string; icon: string; label: string; detail: string }`)
- Produces: the completed formatting function, used wherever `LiveFeedEntry` items are rendered in the tab's live feed panel

- [ ] **Step 1: Read the full TODO context and the `ScraperWsEvent` type**

Run: `grep -n "ScraperWsEvent" client/src/pages/warrants/ScrapersTab.tsx client/src/**/*.ts 2>/dev/null`

Read the discriminated union's exact field shape for each variant (`run_started`, `run_completed`, `run_failed`, `circuit_broken`, `circuit_restored`) before writing the function — the plan cannot hardcode field names without risking a mismatch against the real type.

- [ ] **Step 2: Implement the formatting function per the TODO's spec**

Following the constraints already documented at the TODO site (`color` = Tailwind text class, `icon` = single glyph, `label` ≤ 12 chars uppercase, `detail` = human-readable), implement (adjust field access to match what Step 1 found in the real `ScraperWsEvent` type):

```typescript
function formatLiveFeedEntry(event: ScraperWsEvent): LiveFeedDisplay {
  switch (event.type) {
    case 'run_started':
      return { color: 'text-rmpg-400', icon: '○', label: 'RUN START', detail: `${event.source_key} scan started` };
    case 'run_completed':
      return event.unchanged
        ? { color: 'text-rmpg-500', icon: '◐', label: 'CACHE HIT', detail: `${event.source_key} unchanged` }
        : { color: 'text-green-400', icon: '●', label: 'COMPLETE', detail: `${event.source_key} found ${event.count ?? 0}` };
    case 'run_failed':
      return { color: 'text-red-400', icon: '✕', label: 'FAILED', detail: `${event.source_key}: ${event.error ?? 'unknown error'}` };
    case 'circuit_broken':
      return { color: 'text-red-400', icon: '✕', label: 'CIRCUIT OPEN', detail: `${event.source_key} disabled after repeated failures` };
    case 'circuit_restored':
      return { color: 'text-green-400', icon: '↻', label: 'RESTORED', detail: `${event.source_key} back online` };
    default:
      return { color: 'text-rmpg-500', icon: '○', label: 'EVENT', detail: JSON.stringify(event) };
  }
}
```

Note: this implementation is a reasonable default the plan author chose, not verified against every field name in the live `ScraperWsEvent` type (that requires Step 1's read). Adjust field accessors (`event.source_key`, `event.count`, `event.error`, `event.unchanged`) to match whatever Step 1 actually finds — this is a genuine judgment call about visual language the codebase's `TODO(user-contribution)` comment explicitly left open, so treat this as a strong starting point to refine against the real type, not a byte-for-byte spec.

- [ ] **Step 3: Remove the TODO comment block** once the function is implemented, replacing it with a short one-line comment if any context is still non-obvious (e.g. why `unchanged` gets its own visual treatment).

- [ ] **Step 4: Manual verification in dev preview**

Run: `cd client && npm run dev`
Steps: open Warrants → Sources tab, trigger a scraper run (or wait for the cron), confirm live feed entries render with the expected color/icon/label/detail per event type instead of a blank/placeholder feed.

- [ ] **Step 5: Run client tests and typecheck**

Run: `cd client && npx tsc --noEmit && npx vitest run`
Expected: no new failures.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/warrants/ScrapersTab.tsx
git commit -m "feat(warrants): implement live-feed event formatting in ScrapersTab"
```

---

### Task 9: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full Worker test suite**

Run: `npx vitest run`
Expected: all pass (233+ files, matching or exceeding the pre-change baseline of 233 files / 1922 tests).

- [ ] **Step 2: Run the Miniflare Worker test suite**

Run: `npx vitest run --config vitest.workers.config.mts`
Expected: all pass, including the new `warrantsStatusTransitions.test.ts` and the pre-existing `warrantsNationalCoverage.test.ts` / `warrantsNationalSearch.test.ts` / `warrantsUnifiedWatchedOnly.test.ts` (these exercise routes touched in Task 4 — a regression there would mean a column-rename was missed).

- [ ] **Step 3: Run Worker typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Run client typecheck and tests**

Run: `cd client && npx tsc --noEmit && npx vitest run`
Expected: no new errors/failures vs. baseline.

- [ ] **Step 5: Apply the migration to live D1 and verify**

Run: `scripts/apply-migration.sh 0200_warrants_schema_dedup.sql`
Then run: `npx wrangler d1 execute rmpg-flex --remote --command "SELECT name FROM pragma_table_info('warrants') ORDER BY name"`
Expected: matches Task 1 Step 2's expected column list exactly (deduped columns absent).

- [ ] **Step 6: Smoke-test in the live app**

Per CLAUDE.md's health-check note, `/api/health` is reachable via `curl`; everything else needs a real browser (Cloudflare managed challenge). Open `https://rmpgutah.us` in a browser, navigate to the Warrants tab, and confirm: the warrant list loads, a warrant's detail drawer shows charge/court/judge/bail fields populated (proving the dedup backfill preserved data), Serve/Archive/Reopen actions work end-to-end.
