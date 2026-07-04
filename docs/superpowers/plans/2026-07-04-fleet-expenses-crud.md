# Fleet Expenses CRUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Back `FleetExpensesTab.tsx` with a real `fleet_expenses` table and CRUD routes, so per-vehicle expense tracking (registration, tolls, tickets, etc.) actually persists instead of 404ing.

**Architecture:** One new migration creates `fleet_expenses` with a `CHECK` constraint matching the client's 15-category enum. Four new routes are added to the existing `src/routes/fleet.ts` Hono router (mounted at `/api/fleet`, `auth: 'required'`). Fleet.ts already has a router-level write gate (`MANAGER_ROLES` — admin/manager/supervisor) applied to all `POST/PUT/DELETE/PATCH`, so the new routes get manager-gating automatically with no extra code.

**Tech Stack:** Hono, Cloudflare D1, `src/utils/db.ts` (`query`/`queryFirst`/`execute`), Vitest + `@cloudflare/vitest-pool-workers` (Miniflare) for route tests.

---

### Task 1: Migration — `fleet_expenses` table

**Files:**
- Create: `migrations/0171_fleet_expenses.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- 0171: fleet_expenses — per-vehicle expense tracking (registration,
-- tolls, parking, car wash, tickets, towing, permits, insurance,
-- equipment, decals/wraps, storage, roadside assistance, inspection,
-- electronics, accessories, misc). Backs FleetExpensesTab.tsx, which
-- was shipped with a complete UI but no matching table/routes
-- (broken-functionality audit, 2026-07-04). Category CHECK mirrors
-- FleetExpenseCategory in client/src/types.ts — keep the two in sync.
CREATE TABLE IF NOT EXISTS fleet_expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER NOT NULL,
  expense_date TEXT NOT NULL,
  category TEXT NOT NULL CHECK(category IN (
    'registration','tolls','parking','car_wash','tickets','towing','permits',
    'insurance','equipment','decals_wraps','storage','roadside_assistance',
    'inspection','electronics','accessories','misc'
  )),
  amount REAL NOT NULL,
  vendor TEXT,
  description TEXT,
  odometer_reading INTEGER,
  recurring INTEGER NOT NULL DEFAULT 0,
  recurring_frequency TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_fleet_expenses_vehicle ON fleet_expenses(vehicle_id, expense_date);
```

- [ ] **Step 2: Apply locally and verify**

Run: `npm run migrate:local`
Expected: migration `0171_fleet_expenses.sql` applied, no errors.

Run: `npx wrangler d1 execute rmpg-flex --local --command "SELECT sql FROM sqlite_master WHERE name='fleet_expenses'"`
Expected: prints the `CREATE TABLE` statement above.

- [ ] **Step 3: Commit**

```bash
git add migrations/0171_fleet_expenses.sql
git commit -m "feat(fleet): add fleet_expenses table migration"
```

---

### Task 2: Route test scaffold + `GET /:vehicleId/expenses`

**Files:**
- Create: `test-workers/fleetExpenses.test.ts`
- Modify: `src/routes/fleet.ts`

- [ ] **Step 1: Write the failing test file**

```ts
// Route-level regression test (Miniflare/workerd) for /api/fleet/:vehicleId/expenses
// and /api/fleet/expenses/:id — backing FleetExpensesTab.tsx.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { execute } from '../src/utils/db';
import fleet from '../src/routes/fleet';

function buildApp(role: string) {
  const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: { id: number; role: string; username: string }; userId: number } }>();
  app.use('*', async (c, next) => {
    c.set('user', { id: 1, role, username: 'test-user' });
    c.set('userId', 1);
    await next();
  });
  app.route('/api/fleet', fleet);
  return app;
}

beforeAll(async () => {
  const db = (env as unknown as { DB: D1Database }).DB;
  await execute(db, `CREATE TABLE IF NOT EXISTS fleet_vehicles (
    id INTEGER PRIMARY KEY AUTOINCREMENT, vehicle_name TEXT, archived_at TEXT
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS fleet_expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT, vehicle_id INTEGER NOT NULL, expense_date TEXT NOT NULL,
    category TEXT NOT NULL CHECK(category IN (
      'registration','tolls','parking','car_wash','tickets','towing','permits',
      'insurance','equipment','decals_wraps','storage','roadside_assistance',
      'inspection','electronics','accessories','misc'
    )),
    amount REAL NOT NULL, vendor TEXT, description TEXT, odometer_reading INTEGER,
    recurring INTEGER NOT NULL DEFAULT 0, recurring_frequency TEXT, notes TEXT,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
  )`);
  await execute(db, `INSERT INTO fleet_vehicles (id, vehicle_name) VALUES (1, 'Unit 7')`);
  await execute(db, `INSERT INTO fleet_expenses (vehicle_id, expense_date, category, amount, vendor)
    VALUES (1, '2026-06-01', 'tolls', 4.50, 'UDOT Express Lanes')`);
  await execute(db, `INSERT INTO fleet_expenses (vehicle_id, expense_date, category, amount, vendor)
    VALUES (1, '2026-06-15', 'registration', 89.00, 'Utah DMV')`);
});

describe('GET /api/fleet/:vehicleId/expenses', () => {
  it('lists expenses for a vehicle, newest first', async () => {
    const app = buildApp('officer');
    const res = await app.request('/api/fleet/1/expenses', {}, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<{ category: string; expense_date: string }> };
    expect(body.data).toHaveLength(2);
    expect(body.data[0].expense_date).toBe('2026-06-15');
  });

  it('returns an empty list for a vehicle with no expenses', async () => {
    const app = buildApp('officer');
    const res = await app.request('/api/fleet/999/expenses', {}, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(body.data).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.workers.config.mts test-workers/fleetExpenses.test.ts`
Expected: FAIL — 404 (no route registered for `/api/fleet/:vehicleId/expenses`)

- [ ] **Step 3: Implement the route**

Append to `src/routes/fleet.ts`, near the end of the file (after the existing `DELETE /:id` soft-delete handler covered in the design doc, before the final `export default fleet;`):

```ts
// ── Fleet Expenses — per-vehicle expense tracking (2026-07-04) ──
// Backs FleetExpensesTab.tsx. Registration/tolls/parking/tickets/etc.
// Manager-tier write gate already applied at the router level (top
// of this file) — no per-route role check needed here.

fleet.get('/:vehicleId{[0-9]+}/expenses', async (c) => {
  const db = getDb(c.env);
  const vehicleId = Number(c.req.param('vehicleId'));
  const rows = await query(
    db,
    `SELECT * FROM fleet_expenses WHERE vehicle_id = ? ORDER BY expense_date DESC, id DESC`,
    vehicleId,
  );
  return c.json({ data: rows });
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.workers.config.mts test-workers/fleetExpenses.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add test-workers/fleetExpenses.test.ts src/routes/fleet.ts
git commit -m "feat(fleet): add GET /:vehicleId/expenses route"
```

---

### Task 3: `POST /:vehicleId/expenses`

**Files:**
- Modify: `test-workers/fleetExpenses.test.ts`
- Modify: `src/routes/fleet.ts`

- [ ] **Step 1: Add the failing test**

```ts
describe('POST /api/fleet/:vehicleId/expenses', () => {
  it('rejects non-manager roles (router-level write gate)', async () => {
    const app = buildApp('officer');
    const res = await app.request('/api/fleet/1/expenses', {
      method: 'POST',
      body: JSON.stringify({ expense_date: '2026-07-01', category: 'towing', amount: 150 }),
    }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(403);
  });

  it('creates an expense as manager', async () => {
    const app = buildApp('manager');
    const res = await app.request('/api/fleet/1/expenses', {
      method: 'POST',
      body: JSON.stringify({ expense_date: '2026-07-01', category: 'towing', amount: 150, vendor: 'AAA' }),
    }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as { id: number };
    expect(typeof body.id).toBe('number');

    const listRes = await app.request('/api/fleet/1/expenses', {}, env as unknown as Record<string, unknown>);
    const list = await listRes.json() as { data: Array<{ category: string }> };
    expect(list.data.map((r) => r.category)).toContain('towing');
  });

  it('rejects an invalid category', async () => {
    const app = buildApp('manager');
    const res = await app.request('/api/fleet/1/expenses', {
      method: 'POST',
      body: JSON.stringify({ expense_date: '2026-07-01', category: 'not_a_real_category', amount: 10 }),
    }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(500);
  });

  it('rejects a request missing amount', async () => {
    const app = buildApp('manager');
    const res = await app.request('/api/fleet/1/expenses', {
      method: 'POST',
      body: JSON.stringify({ expense_date: '2026-07-01', category: 'misc' }),
    }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(400);
  });
});
```

Note on the invalid-category test: the D1 `CHECK` constraint rejects the insert at the database layer, which the route's catch-all surfaces as a 500 — this is intentional defense-in-depth (the client's `CATEGORIES` dropdown already prevents this in normal use).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.workers.config.mts test-workers/fleetExpenses.test.ts`
Expected: FAIL — 404 for `POST /:vehicleId/expenses`

- [ ] **Step 3: Implement the route** (append after the `GET /:vehicleId/expenses` handler)

```ts
fleet.post('/:vehicleId{[0-9]+}/expenses', async (c) => {
  const db = getDb(c.env);
  const vehicleId = Number(c.req.param('vehicleId'));
  const body = await c.req.json<{
    expense_date?: string; category?: string; amount?: number; vendor?: string | null;
    description?: string | null; odometer_reading?: number | null;
    recurring?: boolean; recurring_frequency?: string | null; notes?: string | null;
  }>();
  if (!body.expense_date || !body.category || body.amount === undefined) {
    return c.json({ error: 'expense_date, category, and amount are required' }, 400);
  }

  try {
    const result = await execute(
      db,
      `INSERT INTO fleet_expenses
       (vehicle_id, expense_date, category, amount, vendor, description, odometer_reading, recurring, recurring_frequency, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      vehicleId,
      body.expense_date,
      body.category,
      body.amount,
      body.vendor ?? null,
      body.description ?? null,
      body.odometer_reading ?? null,
      body.recurring ? 1 : 0,
      body.recurring_frequency ?? null,
      body.notes ?? null,
    );
    return c.json({ id: result.meta.last_row_id, success: true });
  } catch (err) {
    return c.json({ error: 'Failed to create expense', detail: (err as Error).message }, 500);
  }
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.workers.config.mts test-workers/fleetExpenses.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add test-workers/fleetExpenses.test.ts src/routes/fleet.ts
git commit -m "feat(fleet): add POST /:vehicleId/expenses create route"
```

---

### Task 4: `PUT /expenses/:id`

**Files:**
- Modify: `test-workers/fleetExpenses.test.ts`
- Modify: `src/routes/fleet.ts`

- [ ] **Step 1: Add the failing test**

```ts
describe('PUT /api/fleet/expenses/:id', () => {
  it('rejects non-manager roles', async () => {
    const app = buildApp('officer');
    const res = await app.request('/api/fleet/expenses/1', {
      method: 'PUT',
      body: JSON.stringify({ amount: 999 }),
    }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(403);
  });

  it('updates an expense as manager', async () => {
    const app = buildApp('manager');
    const res = await app.request('/api/fleet/expenses/1', {
      method: 'PUT',
      body: JSON.stringify({ amount: 5.00, vendor: 'Updated Vendor' }),
    }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);

    const listRes = await app.request('/api/fleet/1/expenses', {}, env as unknown as Record<string, unknown>);
    const list = await listRes.json() as { data: Array<{ id: number; amount: number; vendor: string }> };
    const updated = list.data.find((r) => r.id === 1);
    expect(updated?.amount).toBe(5.00);
    expect(updated?.vendor).toBe('Updated Vendor');
  });

  it('returns 404 for a missing id', async () => {
    const app = buildApp('manager');
    const res = await app.request('/api/fleet/expenses/9999', {
      method: 'PUT',
      body: JSON.stringify({ amount: 1 }),
    }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.workers.config.mts test-workers/fleetExpenses.test.ts`
Expected: FAIL — 404 for `PUT /expenses/:id`

- [ ] **Step 3: Implement the route** (append after the `POST /:vehicleId/expenses` handler — note this is a *different* path shape, `/expenses/:id`, not nested under `:vehicleId`)

```ts
const EXPENSE_FIELDS = [
  'expense_date', 'category', 'amount', 'vendor', 'description',
  'odometer_reading', 'recurring', 'recurring_frequency', 'notes',
] as const;

fleet.put('/expenses/:id{[0-9]+}', async (c) => {
  const db = getDb(c.env);
  const id = Number(c.req.param('id'));

  const existing = await queryFirst<{ id: number }>(db, 'SELECT id FROM fleet_expenses WHERE id = ?', id);
  if (!existing) return c.json({ error: 'Expense not found' }, 404);

  const body = await c.req.json<Record<string, unknown>>();
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const field of EXPENSE_FIELDS) {
    if (field in body) {
      sets.push(`${field} = ?`);
      values.push(field === 'recurring' ? (body[field] ? 1 : 0) : body[field]);
    }
  }
  if (sets.length === 0) return c.json({ error: 'No updatable fields provided' }, 400);

  sets.push(`updated_at = datetime('now')`);
  values.push(id);
  try {
    await execute(db, `UPDATE fleet_expenses SET ${sets.join(', ')} WHERE id = ?`, ...values);
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: 'Failed to update expense', detail: (err as Error).message }, 500);
  }
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.workers.config.mts test-workers/fleetExpenses.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add test-workers/fleetExpenses.test.ts src/routes/fleet.ts
git commit -m "feat(fleet): add PUT /expenses/:id update route"
```

---

### Task 5: `DELETE /expenses/:id`

**Files:**
- Modify: `test-workers/fleetExpenses.test.ts`
- Modify: `src/routes/fleet.ts`

- [ ] **Step 1: Add the failing test**

```ts
describe('DELETE /api/fleet/expenses/:id', () => {
  it('rejects non-manager roles', async () => {
    const app = buildApp('officer');
    const res = await app.request('/api/fleet/expenses/2', { method: 'DELETE' }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(403);
  });

  it('deletes an expense as manager', async () => {
    const app = buildApp('manager');
    const res = await app.request('/api/fleet/expenses/2', { method: 'DELETE' }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);

    const listRes = await app.request('/api/fleet/1/expenses', {}, env as unknown as Record<string, unknown>);
    const list = await listRes.json() as { data: Array<{ id: number }> };
    expect(list.data.find((r) => r.id === 2)).toBeUndefined();
  });

  it('returns 404 for a missing id', async () => {
    const app = buildApp('manager');
    const res = await app.request('/api/fleet/expenses/9999', { method: 'DELETE' }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.workers.config.mts test-workers/fleetExpenses.test.ts`
Expected: FAIL — 404 for `DELETE /expenses/:id`

- [ ] **Step 3: Implement the route** (append after the `PUT /expenses/:id` handler)

```ts
fleet.delete('/expenses/:id{[0-9]+}', async (c) => {
  const db = getDb(c.env);
  const id = Number(c.req.param('id'));

  const existing = await queryFirst<{ id: number }>(db, 'SELECT id FROM fleet_expenses WHERE id = ?', id);
  if (!existing) return c.json({ error: 'Expense not found' }, 404);

  await execute(db, 'DELETE FROM fleet_expenses WHERE id = ?', id);
  return c.json({ success: true });
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.workers.config.mts test-workers/fleetExpenses.test.ts`
Expected: PASS — full file green

- [ ] **Step 5: Commit**

```bash
git add test-workers/fleetExpenses.test.ts src/routes/fleet.ts
git commit -m "feat(fleet): add DELETE /expenses/:id route"
```

---

### Task 6: Route-ordering regression check + typecheck + PR

**Files:** none (verification only)

Fleet.ts registers routes like `/:id{[0-9]+}` for the vehicle CRUD elsewhere in the file. Since Hono matches in registration order and `/expenses/:id` is a distinct literal-prefixed path (not `/:id`), there's no collision — but confirm this explicitly.

- [ ] **Step 1: Confirm no route-order collision**

Run: `grep -n "fleet\.\(get\|post\|put\|delete\)('/:id" src/routes/fleet.ts`
Expected: any bare `/:id{[0-9]+}` routes are for vehicles (e.g. `fleet.delete('/:id{[0-9]+}', ...)` at the soft-delete handler) — none conflict with the literal `/expenses` or `/:vehicleId/expenses` prefixes, since Hono requires an exact literal-segment match before falling through to a param route.

- [ ] **Step 2: Worker typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 3: Full worker test suite**

Run: `npx vitest run --config vitest.workers.config.mts`
Expected: all pass, including `fleetExpenses.test.ts`

- [ ] **Step 4: Manual UI smoke check**

Run `npm run dev` (Worker) and `cd client && npm run dev` (Vite), open a vehicle's Expenses tab in Fleet, add/edit/delete an expense of each of a few categories, confirm the PDF export button still works with real data.

- [ ] **Step 5: Push branch and open PR**

```bash
git push -u origin <branch-name>
gh pr create --title "feat(fleet): add fleet_expenses table + CRUD routes" --body "$(cat <<'EOF'
## Summary
- Backs FleetExpensesTab.tsx with a real fleet_expenses table + CRUD under /api/fleet
- CHECK constraint on category mirrors the client's FleetExpenseCategory enum
- Manager-tier write gate already covers these routes (router-level middleware)

## Test plan
- [x] npx vitest run --config vitest.workers.config.mts test-workers/fleetExpenses.test.ts
- [x] npm run typecheck
- [x] Manual: add/edit/delete expenses across categories in the Fleet UI

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 6: After merge — apply migration to live D1**

```bash
scripts/apply-migration.sh 0171_fleet_expenses.sql
npx wrangler d1 execute rmpg-flex --remote --command "SELECT sql FROM sqlite_master WHERE name='fleet_expenses'"
```

Expected: prints the `CREATE TABLE` statement, confirming the migration landed on live D1 `785de7ae-...`.
