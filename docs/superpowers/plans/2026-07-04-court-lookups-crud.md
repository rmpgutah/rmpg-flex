# Court Lookups CRUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Back `AdminCourtLookupsTab.tsx` with a real `court_lookups` table and full CRUD routes under `/api/court/lookups`, so admins can manage every Court Tracker dropdown (courts, judges, prosecutors, event types, outcomes, etc.) instead of hitting 404s.

**Architecture:** One new migration creates `court_lookups`. Five new routes are added to the existing `src/routes/court.ts` Hono router (already mounted at `/api/court` with `auth: 'required'`). Write operations (`POST`/`PUT`/`DELETE`) are gated to `admin` role via the router's existing local `requireRole()` helper.

**Tech Stack:** Hono, Cloudflare D1, `src/utils/db.ts` (`query`/`queryFirst`/`execute`), Vitest + `@cloudflare/vitest-pool-workers` (Miniflare) for route tests.

---

### Task 1: Migration — `court_lookups` table

**Files:**
- Create: `migrations/0170_court_lookups.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- 0170: court_lookups — editable dropdown values for the Court Tracker
-- (courts, judges, prosecutors, event types, outcomes, pleas, bond
-- statuses, witness types, officer roles, charge codes, and any new
-- category an admin adds). Backs AdminCourtLookupsTab.tsx, which was
-- shipped with a complete UI but no matching table/routes (broken-
-- functionality audit, 2026-07-04).
CREATE TABLE IF NOT EXISTS court_lookups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  value TEXT NOT NULL,
  display_label TEXT,
  meta TEXT,
  display_order INTEGER NOT NULL DEFAULT 100,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_court_lookups_category ON court_lookups(category, display_order);
```

- [ ] **Step 2: Apply locally and verify**

Run: `npm run migrate:local`
Expected: migration `0170_court_lookups.sql` listed as applied, no errors.

Run: `npx wrangler d1 execute rmpg-flex --local --command "SELECT sql FROM sqlite_master WHERE name='court_lookups'"`
Expected: prints the `CREATE TABLE` statement above.

- [ ] **Step 3: Commit**

```bash
git add migrations/0170_court_lookups.sql
git commit -m "feat(court): add court_lookups table migration"
```

---

### Task 2: Route test scaffold + `GET /lookups/categories`

**Files:**
- Create: `test-workers/courtLookups.test.ts`
- Modify: `src/routes/court.ts` (append new section near the end of the file, after the existing `/compliance-rate` handler)

- [ ] **Step 1: Write the failing test file**

```ts
// Route-level regression test (Miniflare/workerd) for /api/court/lookups —
// backing AdminCourtLookupsTab.tsx's editable dropdown management.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { execute } from '../src/utils/db';
import court from '../src/routes/court';

function buildApp(role: string) {
  const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: { id: number; role: string; username: string }; userId: number } }>();
  app.use('*', async (c, next) => {
    c.set('user', { id: 1, role, username: 'test-user' });
    c.set('userId', 1);
    await next();
  });
  app.route('/api/court', court);
  return app;
}

beforeAll(async () => {
  const db = (env as unknown as { DB: D1Database }).DB;
  await execute(db, `CREATE TABLE IF NOT EXISTS court_lookups (
    id INTEGER PRIMARY KEY AUTOINCREMENT, category TEXT NOT NULL, value TEXT NOT NULL,
    display_label TEXT, meta TEXT, display_order INTEGER NOT NULL DEFAULT 100,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
  )`);
  await execute(db, `INSERT INTO court_lookups (category, value, display_label, display_order, is_active)
    VALUES ('court', 'third-district', 'Third District Court', 10, 1)`);
  await execute(db, `INSERT INTO court_lookups (category, value, display_label, display_order, is_active)
    VALUES ('court', 'justice-court', 'Justice Court', 20, 0)`);
  await execute(db, `INSERT INTO court_lookups (category, value, display_label, display_order, is_active)
    VALUES ('judge', 'smith', 'Judge Smith', 10, 1)`);
});

describe('GET /api/court/lookups/categories', () => {
  it('returns distinct categories with counts', async () => {
    const app = buildApp('officer');
    const res = await app.request('/api/court/lookups/categories', {}, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ category: string; count: number }>;
    const court = body.find((c) => c.category === 'court');
    const judge = body.find((c) => c.category === 'judge');
    expect(court?.count).toBe(2);
    expect(judge?.count).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.workers.config.mts test-workers/courtLookups.test.ts`
Expected: FAIL — 404 (no route registered for `/api/court/lookups/categories`)

- [ ] **Step 3: Implement the route**

Append to `src/routes/court.ts`, immediately before the file's final `export default ct;` (or equivalent export line — check the last line of the file and insert above it):

```ts
// ── Court Lookups — editable dropdown values (2026-07-04) ─────
// Backs AdminCourtLookupsTab.tsx. Every Court Tracker dropdown reads
// from this table by `category`. Categories are created implicitly —
// inserting the first row with a new category name creates it.

ct.get('/lookups/categories', async (c) => {
  const db = getDb(c.env);
  const rows = await query<{ category: string; count: number }>(
    db,
    `SELECT category, COUNT(*) as count FROM court_lookups GROUP BY category ORDER BY category`,
  );
  return c.json(rows);
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.workers.config.mts test-workers/courtLookups.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add test-workers/courtLookups.test.ts src/routes/court.ts
git commit -m "feat(court): add GET /lookups/categories route"
```

---

### Task 3: `GET /lookups?category=&includeInactive=`

**Files:**
- Modify: `test-workers/courtLookups.test.ts`
- Modify: `src/routes/court.ts`

- [ ] **Step 1: Add the failing test** (append inside the existing `describe` blocks, as a new top-level `describe`)

```ts
describe('GET /api/court/lookups', () => {
  it('returns only active items by default, ordered by display_order', async () => {
    const app = buildApp('officer');
    const res = await app.request('/api/court/lookups?category=court', {}, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ value: string; is_active: number }>;
    expect(body).toHaveLength(1);
    expect(body[0].value).toBe('third-district');
  });

  it('includes inactive items when includeInactive=true', async () => {
    const app = buildApp('officer');
    const res = await app.request('/api/court/lookups?category=court&includeInactive=true', {}, env as unknown as Record<string, unknown>);
    const body = await res.json() as Array<{ value: string }>;
    expect(body).toHaveLength(2);
    expect(body.map((r) => r.value)).toEqual(['third-district', 'justice-court']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.workers.config.mts test-workers/courtLookups.test.ts`
Expected: FAIL — 404 for `GET /lookups`

- [ ] **Step 3: Implement the route** (append after the `/lookups/categories` handler from Task 2)

```ts
ct.get('/lookups', async (c) => {
  const db = getDb(c.env);
  const category = c.req.query('category');
  const includeInactive = c.req.query('includeInactive') === 'true';
  if (!category) return c.json({ error: 'category query param is required' }, 400);

  const sql = includeInactive
    ? `SELECT * FROM court_lookups WHERE category = ? ORDER BY display_order, id`
    : `SELECT * FROM court_lookups WHERE category = ? AND is_active = 1 ORDER BY display_order, id`;
  const rows = await query(db, sql, category);
  return c.json(rows);
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.workers.config.mts test-workers/courtLookups.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add test-workers/courtLookups.test.ts src/routes/court.ts
git commit -m "feat(court): add GET /lookups list route"
```

---

### Task 4: `POST /lookups`

**Files:**
- Modify: `test-workers/courtLookups.test.ts`
- Modify: `src/routes/court.ts`

- [ ] **Step 1: Add the failing test**

```ts
describe('POST /api/court/lookups', () => {
  it('rejects non-admin roles', async () => {
    const app = buildApp('officer');
    const res = await app.request('/api/court/lookups', {
      method: 'POST',
      body: JSON.stringify({ category: 'outcome', value: 'guilty', display_label: 'Guilty' }),
    }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(403);
  });

  it('creates a new lookup row as admin', async () => {
    const app = buildApp('admin');
    const res = await app.request('/api/court/lookups', {
      method: 'POST',
      body: JSON.stringify({ category: 'outcome', value: 'guilty', display_label: 'Guilty', display_order: 10 }),
    }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as { id: number };
    expect(typeof body.id).toBe('number');

    const listRes = await app.request('/api/court/lookups?category=outcome', {}, env as unknown as Record<string, unknown>);
    const list = await listRes.json() as Array<{ value: string }>;
    expect(list.map((r) => r.value)).toContain('guilty');
  });

  it('rejects a request missing value', async () => {
    const app = buildApp('admin');
    const res = await app.request('/api/court/lookups', {
      method: 'POST',
      body: JSON.stringify({ category: 'outcome' }),
    }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.workers.config.mts test-workers/courtLookups.test.ts`
Expected: FAIL — 404 for `POST /lookups`

- [ ] **Step 3: Implement the route** (append after the `GET /lookups` handler)

```ts
ct.post('/lookups', async (c) => {
  const roleErr = requireRole(c, 'admin');
  if (roleErr) return c.json({ error: roleErr }, 403);

  const db = getDb(c.env);
  const body = await c.req.json<{
    category?: string; value?: string; display_label?: string | null;
    meta?: string | null; display_order?: number; is_active?: number | boolean;
  }>();
  if (!body.category || !body.value) {
    return c.json({ error: 'category and value are required' }, 400);
  }

  const result = await execute(
    db,
    `INSERT INTO court_lookups (category, value, display_label, meta, display_order, is_active)
     VALUES (?, ?, ?, ?, ?, ?)`,
    body.category,
    body.value,
    body.display_label ?? null,
    body.meta ?? null,
    body.display_order ?? 100,
    body.is_active === undefined ? 1 : (body.is_active ? 1 : 0),
  );
  return c.json({ id: result.meta.last_row_id, success: true });
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.workers.config.mts test-workers/courtLookups.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add test-workers/courtLookups.test.ts src/routes/court.ts
git commit -m "feat(court): add POST /lookups create route"
```

---

### Task 5: `PUT /lookups/:id` (partial update)

**Files:**
- Modify: `test-workers/courtLookups.test.ts`
- Modify: `src/routes/court.ts`

- [ ] **Step 1: Add the failing test**

```ts
describe('PUT /api/court/lookups/:id', () => {
  it('rejects non-admin roles', async () => {
    const app = buildApp('officer');
    const res = await app.request('/api/court/lookups/1', {
      method: 'PUT',
      body: JSON.stringify({ is_active: 0 }),
    }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(403);
  });

  it('toggles is_active with a partial body', async () => {
    const app = buildApp('admin');
    const res = await app.request('/api/court/lookups/2', {
      method: 'PUT',
      body: JSON.stringify({ is_active: 1 }),
    }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);

    const listRes = await app.request('/api/court/lookups?category=court', {}, env as unknown as Record<string, unknown>);
    const list = await listRes.json() as Array<{ id: number; is_active: number }>;
    expect(list.find((r) => r.id === 2)?.is_active).toBe(1);
  });

  it('returns 404 for a missing id', async () => {
    const app = buildApp('admin');
    const res = await app.request('/api/court/lookups/9999', {
      method: 'PUT',
      body: JSON.stringify({ is_active: 0 }),
    }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.workers.config.mts test-workers/courtLookups.test.ts`
Expected: FAIL — 404 for `PUT /lookups/:id` (route not registered, so Hono itself 404s)

- [ ] **Step 3: Implement the route** (append after the `POST /lookups` handler)

```ts
const LOOKUP_FIELDS = ['category', 'value', 'display_label', 'meta', 'display_order', 'is_active'] as const;

ct.put('/lookups/:id', async (c) => {
  const roleErr = requireRole(c, 'admin');
  if (roleErr) return c.json({ error: roleErr }, 403);

  const db = getDb(c.env);
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);

  const existing = await queryFirst<{ id: number }>(db, 'SELECT id FROM court_lookups WHERE id = ?', id);
  if (!existing) return c.json({ error: 'Lookup not found' }, 404);

  const body = await c.req.json<Record<string, unknown>>();
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const field of LOOKUP_FIELDS) {
    if (field in body) {
      sets.push(`${field} = ?`);
      values.push(field === 'is_active' ? (body[field] ? 1 : 0) : body[field]);
    }
  }
  if (sets.length === 0) return c.json({ error: 'No updatable fields provided' }, 400);

  sets.push(`updated_at = datetime('now')`);
  values.push(id);
  await execute(db, `UPDATE court_lookups SET ${sets.join(', ')} WHERE id = ?`, ...values);
  return c.json({ success: true });
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.workers.config.mts test-workers/courtLookups.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add test-workers/courtLookups.test.ts src/routes/court.ts
git commit -m "feat(court): add PUT /lookups/:id partial-update route"
```

---

### Task 6: `DELETE /lookups/:id`

**Files:**
- Modify: `test-workers/courtLookups.test.ts`
- Modify: `src/routes/court.ts`

- [ ] **Step 1: Add the failing test**

```ts
describe('DELETE /api/court/lookups/:id', () => {
  it('rejects non-admin roles', async () => {
    const app = buildApp('officer');
    const res = await app.request('/api/court/lookups/3', { method: 'DELETE' }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(403);
  });

  it('deletes the row as admin', async () => {
    const app = buildApp('admin');
    const res = await app.request('/api/court/lookups/3', { method: 'DELETE' }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);

    const listRes = await app.request('/api/court/lookups?category=judge', {}, env as unknown as Record<string, unknown>);
    const list = await listRes.json() as Array<{ id: number }>;
    expect(list.find((r) => r.id === 3)).toBeUndefined();
  });

  it('returns 404 for a missing id', async () => {
    const app = buildApp('admin');
    const res = await app.request('/api/court/lookups/9999', { method: 'DELETE' }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.workers.config.mts test-workers/courtLookups.test.ts`
Expected: FAIL — 404 for `DELETE /lookups/:id`

- [ ] **Step 3: Implement the route** (append after the `PUT /lookups/:id` handler)

```ts
ct.delete('/lookups/:id', async (c) => {
  const roleErr = requireRole(c, 'admin');
  if (roleErr) return c.json({ error: roleErr }, 403);

  const db = getDb(c.env);
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);

  const existing = await queryFirst<{ id: number }>(db, 'SELECT id FROM court_lookups WHERE id = ?', id);
  if (!existing) return c.json({ error: 'Lookup not found' }, 404);

  await execute(db, 'DELETE FROM court_lookups WHERE id = ?', id);
  return c.json({ success: true });
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.workers.config.mts test-workers/courtLookups.test.ts`
Expected: PASS — full file green

- [ ] **Step 5: Commit**

```bash
git add test-workers/courtLookups.test.ts src/routes/court.ts
git commit -m "feat(court): add DELETE /lookups/:id route"
```

---

### Task 7: Typecheck, full test suite, PR

**Files:** none (verification only)

- [ ] **Step 1: Worker typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 2: Full node test suite**

Run: `npx vitest run`
Expected: all pass (no regressions)

- [ ] **Step 3: Full worker test suite**

Run: `npx vitest run --config vitest.workers.config.mts`
Expected: all pass, including the new `courtLookups.test.ts`

- [ ] **Step 4: Manual UI smoke check**

Run `npm run dev` (Worker) and `cd client && npm run dev` (Vite), open the Admin page's Court Lookups tab, add/edit/disable/delete a value in a category, confirm it persists across a refresh.

- [ ] **Step 5: Push branch and open PR**

```bash
git push -u origin <branch-name>
gh pr create --title "feat(court): add court_lookups table + CRUD routes" --body "$(cat <<'EOF'
## Summary
- Backs AdminCourtLookupsTab.tsx with a real court_lookups table + full CRUD under /api/court/lookups
- Admin-gated writes; reads open to any authenticated role

## Test plan
- [x] npx vitest run --config vitest.workers.config.mts test-workers/courtLookups.test.ts
- [x] npm run typecheck
- [x] Manual: add/edit/disable/delete a lookup in the Admin UI

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 6: After merge — apply migration to live D1**

```bash
scripts/apply-migration.sh 0170_court_lookups.sql
npx wrangler d1 execute rmpg-flex --remote --command "SELECT sql FROM sqlite_master WHERE name='court_lookups'"
```

Expected: prints the `CREATE TABLE` statement, confirming the migration landed on live D1 `785de7ae-...`.
