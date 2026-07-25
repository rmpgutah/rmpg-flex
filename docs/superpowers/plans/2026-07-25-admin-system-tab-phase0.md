# Admin System Config — Phase 0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the three confirmed defects that make Admin → System Config silently lose data or hammer the API, remove one dead duplicate route, link statute rows to the Law Book, and mark the sections whose values nothing consumes yet.

**Architecture:** Three Worker-side changes (a missing `category` on an INSERT, a disposition-namespace merge extracted into a pure testable helper, one dead handler deleted) and three client-side changes (a runaway effect stabilized, a deep link added, an honesty notice component). No schema migration. No behavior defaults change.

**Tech Stack:** Hono on Cloudflare Workers · Cloudflare D1 · React 18 + TypeScript + Vite + Tailwind · Vitest (Node suite in `tests/`, Miniflare/workerd suite in `test-workers/`) · @testing-library/react

## Global Constraints

- **Spec:** [`docs/superpowers/specs/2026-07-25-admin-system-tab-wiring-design.md`](../specs/2026-07-25-admin-system-tab-wiring-design.md). Phase 0 only — do not start Phases 1–3.
- **No operational default changes.** Phase 0 fixes plumbing only. Do not alter any value in `DEFAULT_SYSTEM_SETTINGS`, `DEFAULT_SECURITY`, `DEFAULT_PRIORITIES`, or the disposition defaults list.
- **No schema migration in this phase.** `system_config` already has the `category` column (`NOT NULL DEFAULT 'general'`, `migrations/0001_initial_schema.sql:381`).
- **Never hardcode hex colors** in client code. Use the `rmpg-*` / `brand-*` / `surface-*` / severity Tailwind tokens. Palette source of truth is `client/src/styles/theme-palettes.css`.
- **Border radius is 2px everywhere** — never `rounded-lg`.
- **Company name** is "Rocky Mountain Protective Group" in prose; "RMPG" only for very limited references. No PII in commit messages or test fixtures — use synthetic call signs and names.
- **All D1 calls are async** — always `await` `.first()` / `.all()` / `.run()`.
- `main` is protected. Work on the current branch and open a PR; never push to `main` directly.
- Run commands from the repo root: `/Users/rmpgutah/RMPG Flex/.claude/worktrees/admin-system-paths-links-c5f4a3`.

## File Structure

| File | Responsibility |
|---|---|
| `src/utils/dispositionConfig.ts` **(create)** | Pure disposition parsing/merging: both key namespaces + the built-in defaults roster. No D1, no Hono — unit-testable in the Node suite. |
| `tests/dispositionConfig.test.ts` **(create)** | Node unit tests for the above. |
| `src/routes/admin.ts` **(modify)** | Add `category`/`is_active` to the system-settings INSERT; delegate disposition assembly to the new helper; delete the dead `/config-history` duplicate. |
| `test-workers/adminSystemConfig.test.ts` **(create)** | Miniflare route-level regression tests for all three Worker fixes. |
| `client/src/pages/admin/NotEnforcedNotice.tsx` **(create)** | Small presentational notice: "stored, not yet enforced". One responsibility, reused by six sections. |
| `client/src/pages/admin/AdminSystemTab.tsx` **(modify)** | Stabilize the statute effect + debounce search; add the Law Book link; render the notices. |
| `client/src/pages/admin/__tests__/AdminSystemTab.statutes.test.tsx` **(create)** | Regression test for the fetch loop and the debounce. |

---

### Task 1: Close the System Settings round-trip

`PUT /admin/system-settings` INSERTs without `category`, so rows land under the schema
default `'general'` while the tab reads back `grouped.system_settings` — every one of the 60
fields silently reverts to defaults on reload. `src/routes/audit.ts:312` establishes the
convention this must match: `category='system_settings'`.

**Files:**
- Modify: `src/routes/admin.ts:2006-2025` (the `admin.put('/system-settings')` handler)
- Test: `test-workers/adminSystemConfig.test.ts` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: nothing later tasks depend on. `test-workers/adminSystemConfig.test.ts` is extended by Tasks 2 and 3.

- [ ] **Step 1: Write the failing test**

Create `test-workers/adminSystemConfig.test.ts`:

```ts
// Route-level regression tests (Miniflare/workerd) for the Admin → System Config
// wiring defects fixed in Phase 0. See
// docs/superpowers/specs/2026-07-25-admin-system-tab-wiring-design.md
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { execute } from '../src/utils/db';
import admin from '../src/routes/admin';

const app = new Hono<{
  Bindings: Record<string, unknown>;
  Variables: { user: { id: number; role: string; username: string }; userId: number };
}>();
app.use('*', async (c, next) => {
  c.set('user', { id: 1, role: 'admin', username: 'test-admin' });
  c.set('userId', 1);
  await next();
});
app.route('/api/admin', admin);

beforeAll(async () => {
  const db = (env as unknown as { DB: D1Database }).DB;
  await execute(db, `CREATE TABLE IF NOT EXISTS system_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    config_key TEXT NOT NULL,
    config_value TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'general',
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
});

describe('PUT /api/admin/system-settings — category round-trip', () => {
  it('files saved settings under category=system_settings so config-items reads them back', async () => {
    const saveRes = await app.request('/api/admin/system-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agency_ori: 'UT0190000', records_retention_years: '7' }),
    }, env as unknown as Record<string, unknown>);
    expect(saveRes.status).toBe(200);

    // The admin tab reloads through this endpoint, grouped by category.
    const readRes = await app.request('/api/admin/config-items', {}, env as unknown as Record<string, unknown>);
    expect(readRes.status).toBe(200);
    const grouped = await readRes.json() as Record<string, Array<{ config_key: string; config_value: string }>>;

    const settings = grouped.system_settings ?? [];
    expect(settings.map((r) => r.config_key).sort()).toEqual(['agency_ori', 'records_retention_years']);
    expect(settings.find((r) => r.config_key === 'agency_ori')!.config_value).toBe('UT0190000');

    // And must NOT leak into the untyped 'general' bucket.
    expect((grouped.general ?? []).map((r) => r.config_key)).not.toContain('agency_ori');
  });

  it('overwrites rather than accumulating rows when the same key is saved twice', async () => {
    await app.request('/api/admin/system-settings', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ auto_archive_days: '90' }),
    }, env as unknown as Record<string, unknown>);
    await app.request('/api/admin/system-settings', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ auto_archive_days: '120' }),
    }, env as unknown as Record<string, unknown>);

    const readRes = await app.request('/api/admin/config-items', {}, env as unknown as Record<string, unknown>);
    const grouped = await readRes.json() as Record<string, Array<{ config_key: string; config_value: string }>>;
    const rows = (grouped.system_settings ?? []).filter((r) => r.config_key === 'auto_archive_days');
    expect(rows).toHaveLength(1);
    expect(rows[0].config_value).toBe('120');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run --config vitest.workers.config.mts test-workers/adminSystemConfig.test.ts
```

Expected: FAIL. The first test fails on the `settings.map(...)` assertion — it receives `[]`
because the rows were filed under `general`.

- [ ] **Step 3: Write the minimal implementation**

In `src/routes/admin.ts`, inside `admin.put('/system-settings')`, replace the INSERT
statement (currently three columns) so the row carries its category. The `DELETE` above it
stays exactly as-is — it is load-bearing (live `system_config` has a COMPOSITE unique index
on `(config_key, config_value)`, so `ON CONFLICT(config_key)` throws).

Find:

```ts
      await execute(db, `DELETE FROM system_config WHERE config_key = ?`, key);
      await execute(db,
        `INSERT INTO system_config (config_key, config_value, updated_at) VALUES (?, ?, datetime('now'))`,
        key, val);
```

Replace with:

```ts
      await execute(db, `DELETE FROM system_config WHERE config_key = ?`, key);
      // `category` is REQUIRED here. system_config.category is NOT NULL DEFAULT
      // 'general', so omitting it silently filed every setting under 'general'
      // while AdminSystemTab reloads from GET /config-items → grouped.system_settings
      // — the panel's 60 fields saved and then reverted to defaults on refresh.
      // 'system_settings' is the convention src/routes/audit.ts:312 already uses.
      await execute(db,
        `INSERT INTO system_config (config_key, config_value, category, is_active, updated_at)
         VALUES (?, ?, 'system_settings', 1, datetime('now'))`,
        key, val);
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run --config vitest.workers.config.mts test-workers/adminSystemConfig.test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/routes/admin.ts test-workers/adminSystemConfig.test.ts
git commit -m "$(cat <<'EOF'
fix(admin): file saved system settings under category=system_settings

PUT /admin/system-settings INSERTed only (config_key, config_value,
updated_at). system_config.category is NOT NULL DEFAULT 'general', so every
saved setting landed in 'general' while AdminSystemTab reloads from
GET /config-items -> grouped.system_settings. The panel's 60 fields saved
successfully and then reverted to hardcoded defaults on refresh.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Make admin-created dispositions reach the dispatch dropdowns

The tab writes `config_key: 'disposition_code'` with `category: 'dispositions'`
(`AdminSystemTab.tsx:733`), but flat `GET /admin/config` builds its disposition array only
from keys prefixed `disposition.` (`src/routes/admin.ts:75`). `DispatchPage.tsx:984` and
`IncidentsPage.tsx:497` — the only consumers — therefore never see an admin-created code.

Rather than patch the 100-line inline block, extract the parse/merge into a pure helper.
That makes the precedence rules testable in the fast Node suite and shrinks the handler.

**Files:**
- Create: `src/utils/dispositionConfig.ts`
- Create: `tests/dispositionConfig.test.ts`
- Modify: `src/routes/admin.ts:56-156` (the `admin.get('/config')` handler)
- Modify: `test-workers/adminSystemConfig.test.ts` (append one route-level test)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:
  - `interface DispositionConfigRow { config_key: string; config_value: string; category?: string | null }`
  - `interface Disposition { code: string; description: string; color?: string; is_active: boolean; config_value: string }`
  - `const DEFAULT_DISPOSITIONS: { code: string; description: string }[]`
  - `function isDispositionRow(row: DispositionConfigRow): boolean`
  - `function mergeDispositions(rows: DispositionConfigRow[]): Disposition[]`

- [ ] **Step 1: Write the failing test**

Create `tests/dispositionConfig.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_DISPOSITIONS,
  isDispositionRow,
  mergeDispositions,
  type DispositionConfigRow,
} from '../src/utils/dispositionConfig';

const legacyRow = (code: string, description: string): DispositionConfigRow => ({
  config_key: `disposition.${code}`,
  config_value: JSON.stringify({ code, description, color: '#123456' }),
  category: 'dispositions',
});

// What AdminSystemTab.tsx:733 actually writes: a constant config_key, with the
// meaning carried by `category`.
const adminTabRow = (code: string, description: string): DispositionConfigRow => ({
  config_key: 'disposition_code',
  config_value: JSON.stringify({ code, description, color: '#abcdef' }),
  category: 'dispositions',
});

describe('isDispositionRow', () => {
  it('recognizes the legacy disposition.<code> key namespace', () => {
    expect(isDispositionRow(legacyRow('GOA', 'Gone on Arrival'))).toBe(true);
  });

  it('recognizes rows whose category is dispositions regardless of key', () => {
    expect(isDispositionRow(adminTabRow('TRESPASS', 'Trespass Warning Issued'))).toBe(true);
  });

  it('ignores unrelated config rows', () => {
    expect(isDispositionRow({ config_key: 'agency_ori', config_value: 'UT0190000', category: 'system_settings' })).toBe(false);
  });
});

describe('mergeDispositions', () => {
  it('surfaces a disposition created by the admin tab', () => {
    const merged = mergeDispositions([adminTabRow('PATROL CHECK', 'Patrol Check Completed')]);
    const found = merged.find((d) => d.code === 'PATROL CHECK');
    expect(found).toBeDefined();
    expect(found!.description).toBe('Patrol Check Completed');
    expect(found!.is_active).toBe(true);
  });

  it('includes the built-in roster so a fresh database is never empty', () => {
    const merged = mergeDispositions([]);
    expect(merged).toHaveLength(DEFAULT_DISPOSITIONS.length);
    expect(merged.map((d) => d.code)).toContain('Report Taken');
  });

  it('lets a custom row override a built-in of the same code without duplicating it', () => {
    const merged = mergeDispositions([adminTabRow('GOA', 'Gone on Arrival (custom wording)')]);
    const matches = merged.filter((d) => d.code === 'GOA');
    expect(matches).toHaveLength(1);
    expect(matches[0].description).toBe('Gone on Arrival (custom wording)');
  });

  it('does not double-list a code present in both key namespaces', () => {
    const merged = mergeDispositions([
      legacyRow('UTL', 'Unable to Locate (legacy)'),
      adminTabRow('UTL', 'Unable to Locate (admin tab)'),
    ]);
    const matches = merged.filter((d) => d.code === 'UTL');
    expect(matches).toHaveLength(1);
    // The legacy namespace is processed first and wins, so an old explicit
    // override is never silently replaced.
    expect(matches[0].description).toBe('Unable to Locate (legacy)');
  });

  it('skips malformed JSON instead of throwing', () => {
    const merged = mergeDispositions([
      { config_key: 'disposition_code', config_value: '{not json', category: 'dispositions' },
    ]);
    expect(merged).toHaveLength(DEFAULT_DISPOSITIONS.length);
  });

  it('honors an explicit is_active:false on a custom row', () => {
    const merged = mergeDispositions([{
      config_key: 'disposition_code',
      config_value: JSON.stringify({ code: 'RETIRED', description: 'Retired code', is_active: false }),
      category: 'dispositions',
    }]);
    expect(merged.find((d) => d.code === 'RETIRED')!.is_active).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run tests/dispositionConfig.test.ts
```

Expected: FAIL — `Cannot find module '../src/utils/dispositionConfig'`.

- [ ] **Step 3: Create the helper**

Create `src/utils/dispositionConfig.ts`. **The `DEFAULT_DISPOSITIONS` array must be moved
verbatim** from the `defaults` array currently at `src/routes/admin.ts:96-142` — copy it,
do not retype it from memory, and do not add, remove, or reword any entry:

```ts
// ============================================================
// RMPG Flex — Disposition config assembly
// ============================================================
// Dispositions live in system_config under TWO historical namespaces:
//
//   1. config_key = 'disposition.<CODE>'   (legacy, one row per code)
//   2. category   = 'dispositions'         (what AdminSystemTab.tsx writes
//                                           today, with a constant
//                                           config_key of 'disposition_code')
//
// GET /admin/config used to recognize only (1), so every disposition created
// in Admin -> System Config -> Dispositions was invisible to DispatchPage and
// IncidentsPage — it saved, appeared in the admin table, and never reached the
// dropdowns. This module recognizes both and is the single place the
// precedence rules live.
//
// Pure: no D1, no Hono. Unit-tested in tests/dispositionConfig.test.ts.
// ============================================================

export interface DispositionConfigRow {
  config_key: string;
  config_value: string;
  category?: string | null;
}

export interface Disposition {
  code: string;
  description: string;
  color?: string;
  is_active: boolean;
  /** Retained for backward-compat: existing clients JSON.parse this field. */
  config_value: string;
}

/**
 * Baked-in roster so the dropdown is never empty on a fresh database.
 * Custom rows override these BY CODE, so an admin can retune wording or color
 * without losing the built-ins.
 */
export const DEFAULT_DISPOSITIONS: { code: string; description: string }[] = [
  { code: 'Report Taken',     description: 'Report Taken' },
  { code: 'Unfounded',        description: 'Unfounded' },
  { code: 'GOA',              description: 'Gone on Arrival' },
  { code: 'Referred',         description: 'Referred to other agency' },
  { code: 'No Action',        description: 'No Action Required' },
  { code: 'Arrest',           description: 'Arrest Made' },
  { code: 'Warning',          description: 'Warning Issued' },
  { code: 'Citation',         description: 'Citation Issued' },
  { code: 'Trespass Warning', description: 'Trespass Warning Issued' },
  { code: 'Civil Matter',     description: 'Civil Matter — No Action' },
  { code: 'Resolved',         description: 'Resolved on Scene' },
  { code: 'Transported',      description: 'Subject Transported' },
  { code: 'False Alarm',      description: 'False Alarm' },
  { code: 'Verbal Warning',   description: 'Verbal Warning Issued' },
  { code: 'Field Interview',  description: 'Field Interview (FI) Conducted' },
  { code: 'Counseled',        description: 'Subject Counseled' },
  { code: 'Documentation Only', description: 'Documentation Only' },
  { code: 'UTL',              description: 'Unable to Locate' },
  { code: 'Assist Rendered',  description: 'Assist Rendered' },
  { code: 'Negative Contact', description: 'Negative Contact' },
  { code: 'Patrol Completed', description: 'Patrol Completed' },
  { code: 'Premise Secured',  description: 'Premise Secured' },
  { code: 'Owner Notified',   description: 'Owner/Keyholder Notified' },
  { code: 'Vehicle Towed',    description: 'Vehicle Towed' },
  { code: 'Standby Complete', description: 'Standby Complete' },
  // Process Service outcomes (paper service — pso_client_request /
  // process_service calls). Namespaced with a 'PS ' code prefix so they group
  // together and never collide with the law-enforcement codes above.
  // Per-attempt diligence tracking still lives in the dedicated serve
  // subsystem (serve_attempts); these are the call-level closeout codes.
  { code: 'PS Served',            description: 'Process Served — Personal' },
  { code: 'PS Sub-Served',        description: 'Process Served — Substitute' },
  { code: 'PS Posted',            description: 'Process Served — Posted & Mailed' },
  { code: 'PS Corporate',         description: 'Process Served — Corporate/Registered Agent' },
  { code: 'PS Mailed',            description: 'Process Served — By Mail' },
  { code: 'PS Non-Service',       description: 'Process — Unable to Serve' },
  { code: 'PS Evasive',           description: 'Process — Evasive / Avoiding Service' },
  { code: 'PS Vacant',            description: 'Process — Vacant / Unoccupied' },
  { code: 'PS No Access',         description: 'Process — Gated / No Access' },
  { code: 'PS Unknown',           description: 'Process — Recipient Unknown at Address' },
  { code: 'PS Out of Jurisdiction', description: 'Process — Out of Jurisdiction' },
  { code: 'PS Recalled',          description: 'Process — Recalled by Client' },
  { code: 'PS Non Est',           description: 'Process — Returned Non-Est (Return of Service Filed)' },
  { code: 'Cancelled',        description: 'Call Cancelled' },
];

const LEGACY_KEY_PREFIX = 'disposition.';

/** True when this system_config row carries a disposition, in either namespace. */
export function isDispositionRow(row: DispositionConfigRow): boolean {
  return row.config_key.startsWith(LEGACY_KEY_PREFIX) || row.category === 'dispositions';
}

function parseRow(row: DispositionConfigRow): Disposition | null {
  try {
    const parsed = JSON.parse(row.config_value) as {
      code?: unknown; description?: unknown; color?: unknown; is_active?: unknown;
    };
    const code = typeof parsed.code === 'string' ? parsed.code.trim() : '';
    if (!code) return null;
    return {
      code,
      description: typeof parsed.description === 'string' ? parsed.description : code,
      color: typeof parsed.color === 'string' ? parsed.color : undefined,
      is_active: parsed.is_active !== false,
      config_value: row.config_value,
    };
  } catch {
    return null; // Malformed row — skip rather than fail the whole response.
  }
}

/**
 * Assemble the effective disposition roster: custom rows from both namespaces
 * first (legacy `disposition.<code>` keys take precedence over category rows so
 * a pre-existing explicit override is never silently replaced), then the
 * built-in defaults for any code not already present. Deduped by code.
 */
export function mergeDispositions(rows: DispositionConfigRow[]): Disposition[] {
  const dispositionRows = rows.filter(isDispositionRow);
  const legacy = dispositionRows.filter((r) => r.config_key.startsWith(LEGACY_KEY_PREFIX));
  const byCategory = dispositionRows.filter((r) => !r.config_key.startsWith(LEGACY_KEY_PREFIX));

  const out: Disposition[] = [];
  const seen = new Set<string>();

  for (const row of [...legacy, ...byCategory]) {
    const parsed = parseRow(row);
    if (!parsed || seen.has(parsed.code)) continue;
    seen.add(parsed.code);
    out.push(parsed);
  }

  for (const d of DEFAULT_DISPOSITIONS) {
    if (seen.has(d.code)) continue;
    seen.add(d.code);
    out.push({ ...d, is_active: true, config_value: JSON.stringify(d) });
  }

  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run tests/dispositionConfig.test.ts
```

Expected: PASS (10 tests).

- [ ] **Step 5: Commit the helper**

```bash
git add src/utils/dispositionConfig.ts tests/dispositionConfig.test.ts
git commit -m "$(cat <<'EOF'
feat(admin): add pure disposition config merge helper

Recognizes both historical namespaces (legacy disposition.<code> keys and
category='dispositions' rows) and owns the precedence rules, so the flat
/admin/config handler no longer has to.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6: Write the failing route-level test**

Append to `test-workers/adminSystemConfig.test.ts`:

```ts
describe('GET /api/admin/config — disposition namespaces', () => {
  it('returns a disposition created the way AdminSystemTab writes it', async () => {
    const db = (env as unknown as { DB: D1Database }).DB;
    // Exactly what AdminSystemTab.tsx:733 POSTs.
    await execute(db,
      `INSERT INTO system_config (config_key, config_value, category, is_active)
       VALUES ('disposition_code', ?, 'dispositions', 1)`,
      JSON.stringify({ code: 'PATROL CHECK', description: 'Patrol Check Completed', color: '#888888' }));

    const res = await app.request('/api/admin/config', {}, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const cfg = await res.json() as { dispositions: Array<{ code: string; description: string; is_active: boolean }> };

    const found = cfg.dispositions.find((d) => d.code === 'PATROL CHECK');
    expect(found).toBeDefined();
    expect(found!.description).toBe('Patrol Check Completed');

    // Built-ins still present, and the raw row no longer leaks as a scalar.
    expect(cfg.dispositions.some((d) => d.code === 'Report Taken')).toBe(true);
    expect((cfg as unknown as Record<string, unknown>).disposition_code).toBeUndefined();
  });
});
```

- [ ] **Step 7: Run it to verify it fails**

```bash
npx vitest run --config vitest.workers.config.mts test-workers/adminSystemConfig.test.ts
```

Expected: FAIL — `found` is `undefined`, because the handler only recognizes
`disposition.`-prefixed keys.

- [ ] **Step 8: Wire the helper into the route**

In `src/routes/admin.ts`, add the import alongside the existing imports:

```ts
import { mergeDispositions, isDispositionRow, type DispositionConfigRow } from '../utils/dispositionConfig';
```

Then in `admin.get('/config')`, replace the whole body from the `const customDispositions`
declaration through `result.dispositions = merged;` with the version below. This deletes the
inline `defaults` array (now owned by the helper) and the `disposition.`-prefix branch:

```ts
    const db = getDb(c.env);
    const config = await query<Record<string, unknown>>(db, 'SELECT * FROM system_config');
    const result: Record<string, any> = {};
    const dispositionRows: DispositionConfigRow[] = [];

    for (const row of config) {
      // Live system_config columns are config_key/config_value (NOT key/value);
      // reading key/value yielded "undefined" for every row.
      const key = String(row.config_key);
      const value = String(row.config_value ?? '');
      const candidate: DispositionConfigRow = {
        config_key: key,
        config_value: value,
        category: row.category == null ? null : String(row.category),
      };

      if (isDispositionRow(candidate)) {
        // Consumed as a disposition below. Deliberately NOT also written into
        // the flat map: every category='dispositions' row shares the constant
        // config_key 'disposition_code', so doing both left a meaningless
        // last-write-wins scalar on the response. Nothing reads it.
        dispositionRows.push(candidate);
      } else if (!SECRET_KEY_PATTERN.test(key)) {
        result[key] = value;
      }
    }

    result.dispositions = mergeDispositions(dispositionRows);
    return c.json(result);
```

- [ ] **Step 9: Run both suites to verify they pass**

```bash
npx vitest run --config vitest.workers.config.mts test-workers/adminSystemConfig.test.ts && npx vitest run tests/dispositionConfig.test.ts
```

Expected: PASS — 3 Miniflare tests, 10 Node tests.

- [ ] **Step 10: Confirm no client consumer regressed**

```bash
grep -rn "disposition_code\|\.dispositions" client/src/pages/dispatch/DispatchPage.tsx client/src/pages/IncidentsPage.tsx
```

Expected: both read `cfg.dispositions`, filter on `is_active`, and `JSON.parse`
`config_value`. All three fields are still present on every element (including defaults), so
neither consumer needs a change. No hit for `disposition_code`.

- [ ] **Step 11: Typecheck and commit**

```bash
npm run typecheck
```

Expected: no errors.

```bash
git add src/routes/admin.ts test-workers/adminSystemConfig.test.ts
git commit -m "$(cat <<'EOF'
fix(admin): surface admin-created dispositions to dispatch and incidents

AdminSystemTab writes config_key='disposition_code' with
category='dispositions', but flat GET /admin/config built its disposition
list only from 'disposition.'-prefixed keys. Custom codes appeared in the
admin table and never reached the DispatchPage or IncidentsPage dropdowns.

GET /config now delegates to mergeDispositions(), which recognizes both
namespaces, dedupes by code, and keeps the built-in roster. The 39-entry
defaults array moves verbatim into the helper.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Delete the dead duplicate `/config-history` handler

Two handlers are registered for `GET /admin/config-history`. Hono dispatches the
first-registered, so `:773` (reads `activity_log`, honors `?limit`) serves all traffic and
`:2108` (reads `config_audit_log`) is unreachable. `config_audit_log` is created by
`migrations/0093_schema_drift_sweep.sql:72` but **written by nothing** in `src/`, so the dead
handler would return an empty list even if it were reachable. The only caller,
`client/src/pages/admin/AdminHealthTab.tsx:795`, sends `?limit=20` — which only the surviving
handler honors.

**Files:**
- Modify: `src/routes/admin.ts:2107-2115` (delete the second handler)
- Modify: `test-workers/adminSystemConfig.test.ts` (append one test)

**Interfaces:**
- Consumes: the `app` harness defined in Task 1's test file.
- Produces: nothing.

- [ ] **Step 1: Write the failing test**

Append to `test-workers/adminSystemConfig.test.ts`:

```ts
describe('GET /api/admin/config-history — single live handler', () => {
  it('reads activity_log and honors ?limit (the shape AdminHealthTab requests)', async () => {
    const db = (env as unknown as { DB: D1Database }).DB;
    await execute(db, `CREATE TABLE IF NOT EXISTS activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT, created_at TEXT
    )`);
    await execute(db, `INSERT INTO activity_log (action, created_at) VALUES ('config_update', '2026-07-01T00:00:00Z')`);
    await execute(db, `INSERT INTO activity_log (action, created_at) VALUES ('setting_update', '2026-07-02T00:00:00Z')`);
    await execute(db, `INSERT INTO activity_log (action, created_at) VALUES ('login', '2026-07-03T00:00:00Z')`);

    const res = await app.request('/api/admin/config-history?limit=1', {}, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<{ action: string }> };

    // limit=1 proves the activity_log handler answered: the config_audit_log
    // duplicate ignores the query param and hardcodes LIMIT 200.
    expect(body.data).toHaveLength(1);
    // Newest config-ish action first; 'login' is filtered out entirely.
    expect(body.data[0].action).toBe('setting_update');
  });
});
```

- [ ] **Step 2: Run it**

```bash
npx vitest run --config vitest.workers.config.mts test-workers/adminSystemConfig.test.ts
```

Expected: PASS already — this test documents the *current* live behavior, which the
deletion must preserve. If it fails, stop: the assumption about Hono registration order is
wrong and the deletion is unsafe.

- [ ] **Step 3: Delete the dead handler**

In `src/routes/admin.ts`, delete this entire block (at `:2107-2115`), including the
`// ── Config history ──` comment line directly above it:

```ts
// ── Config history ─────────────────────────────────────────
admin.get('/config-history', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(db,
      `SELECT * FROM config_audit_log ORDER BY created_at DESC LIMIT 200`);
    return c.json({ data: rows });
  } catch { return c.json({ data: [] }); }
});
```

Leave the handler at `:773` untouched. Then add a one-line note above the surviving handler
so the duplicate is not reintroduced:

```ts
// Sole /config-history handler. A second one reading config_audit_log was
// registered further down this file and was unreachable (Hono dispatches the
// first match); config_audit_log has no writers anywhere in src/. Deleted
// 2026-07-25.
admin.get('/config-history', async (c) => {
```

- [ ] **Step 4: Verify exactly one handler remains and the test still passes**

```bash
grep -c "admin.get('/config-history'" src/routes/admin.ts
```

Expected: `1`

```bash
npx vitest run --config vitest.workers.config.mts test-workers/adminSystemConfig.test.ts && npm run typecheck
```

Expected: PASS (4 tests), no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/routes/admin.ts test-workers/adminSystemConfig.test.ts
git commit -m "$(cat <<'EOF'
refactor(admin): remove unreachable duplicate /config-history handler

Two handlers were registered for GET /admin/config-history. Hono dispatches
the first match, so the activity_log handler served all traffic and the
config_audit_log one was dead — and config_audit_log has no writers anywhere
in src/, so it would have returned [] regardless. The only caller
(AdminHealthTab) sends ?limit=20, which only the surviving handler honors.

Adds a regression test pinning the live behavior (activity_log + ?limit).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Stop the Criminal Codes request loop and debounce search

`expandedSections` is rebuilt as a fresh object literal on every render
(`AdminSystemTab.tsx:370`) and sits in an effect dependency array (`:634`). While the
Criminal Codes section is active the effect re-runs after every render, and because
`fetchStatutes` calls `setLoadingStatutes` / `setStatutes`, each run schedules the next —
an unbounded stream of `/api/statutes` requests. Search is also undebounced.

**Files:**
- Modify: `client/src/pages/admin/AdminSystemTab.tsx:629-634`
- Create: `client/src/pages/admin/__tests__/AdminSystemTab.statutes.test.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: nothing.

- [ ] **Step 1: Write the failing test**

Create `client/src/pages/admin/__tests__/AdminSystemTab.statutes.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import AdminSystemTab from '../AdminSystemTab';

vi.mock('../../../hooks/useApi', () => ({
  apiFetch: vi.fn((path: string) => {
    if (path.startsWith('/statutes')) {
      return Promise.resolve({
        data: [{ id: 1, citation: '76-5-102', short_title: 'Assault', category: 'criminal', offense_level: 'MB', subcategory: 'Assault' }],
        pagination: { total: 1, totalPages: 1 },
      });
    }
    if (path === '/admin/config-items') return Promise.resolve({});
    if (path === '/admin/call-templates') return Promise.resolve([]);
    if (path === '/dispatch/units') return Promise.resolve([]);
    return Promise.resolve({});
  }),
}));

vi.mock('../../../context/ContextMenuContext', () => ({
  useContextMenu: () => ({ openMenu: vi.fn() }),
}));

vi.mock('../../../utils/contextMenuActions', () => ({
  useMenuActions: () => ({
    action: (label: string) => ({ label }),
    separator: () => ({ separator: true }),
    copy: (label: string) => ({ label }),
    copyId: (_id: unknown, label: string) => ({ label }),
  }),
}));

vi.mock('../../../hooks/useUnsavedChanges', () => ({ useUnsavedChanges: vi.fn() }));

const LoadingSpinner = () => <div>loading</div>;

const renderTab = () => render(
  <AdminSystemTab users={[]} error={null} setError={vi.fn()} LoadingSpinner={LoadingSpinner} />,
);

const statuteCallCount = async () => {
  const { apiFetch } = await import('../../../hooks/useApi');
  return (apiFetch as unknown as { mock: { calls: unknown[][] } }).mock.calls
    .filter((args) => String(args[0]).startsWith('/statutes')).length;
};

beforeEach(() => {
  vi.clearAllMocks();
  // The tab persists its active section; pin it to Criminal Codes.
  localStorage.setItem('rmpg_admin_sections', JSON.stringify('criminal_codes'));
});

afterEach(() => {
  localStorage.clear();
  vi.useRealTimers();
});

describe('AdminSystemTab — Criminal Codes', () => {
  it('fetches statutes once on open instead of looping', async () => {
    renderTab();
    await waitFor(() => expect(screen.getByText('76-5-102')).toBeInTheDocument());

    const afterOpen = await statuteCallCount();
    expect(afterOpen).toBe(1);

    // Settle any trailing renders — a stable effect must not add requests.
    await act(async () => { await new Promise((r) => setTimeout(r, 100)); });
    expect(await statuteCallCount()).toBe(1);
  });

  it('debounces typing into one request per burst', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderTab();
    await waitFor(() => expect(screen.getByText('76-5-102')).toBeInTheDocument());
    const baseline = await statuteCallCount();

    const input = screen.getByLabelText(/search statutes/i);
    for (const value of ['a', 'as', 'ass', 'assa', 'assau']) {
      fireEvent.change(input, { target: { value } });
    }

    // Before the debounce window elapses, nothing new has been requested.
    expect(await statuteCallCount()).toBe(baseline);

    await act(async () => { vi.advanceTimersByTime(400); });
    await waitFor(async () => expect(await statuteCallCount()).toBe(baseline + 1));
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd client && npx vitest run src/pages/admin/__tests__/AdminSystemTab.statutes.test.tsx
```

Expected: FAIL — the first test reports a call count far above 1 (the loop), and the second
fails because each keystroke fires immediately.

- [ ] **Step 3: Fix the effect**

In `client/src/pages/admin/AdminSystemTab.tsx`, replace the auto-search effect:

```tsx
  // Auto-search statutes when section is expanded
  useEffect(() => {
    if (expandedSections.has('criminal_codes')) {
      fetchStatutes(statuteSearch, statuteCategory, statutePage);
    }
  }, [expandedSections, statuteSearch, statuteCategory, statutePage, fetchStatutes]);
```

with:

```tsx
  // Auto-search statutes while the Criminal Codes section is active.
  //
  // Depends on the PRIMITIVE `activeSection`, never on `expandedSections` —
  // that is a fresh object literal on every render, so listing it here made the
  // effect re-run after every render. Because fetchStatutes sets state, each run
  // scheduled the next one: an unbounded stream of /api/statutes requests for as
  // long as this section stayed open.
  //
  // The 300 ms timer doubles as the search debounce, so typing issues one
  // request per burst rather than one per keystroke.
  useEffect(() => {
    if (activeSection !== 'criminal_codes') return;
    const timer = setTimeout(() => {
      fetchStatutes(statuteSearch, statuteCategory, statutePage);
    }, 300);
    return () => clearTimeout(timer);
  }, [activeSection, statuteSearch, statuteCategory, statutePage, fetchStatutes]);
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd client && npx vitest run src/pages/admin/__tests__/AdminSystemTab.statutes.test.tsx
```

Expected: PASS (2 tests).

If the first test sees `0` calls instead of `1`, the 300 ms timer has not fired within the
assertion window — widen the `waitFor` timeout to 2000 ms rather than removing the debounce.

- [ ] **Step 5: Typecheck**

```bash
cd client && npx tsc --noEmit
```

Expected: no NEW errors. There are 12 pre-existing errors in the client tree; compare
against `git stash` output if unsure whether one is yours.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/admin/AdminSystemTab.tsx client/src/pages/admin/__tests__/AdminSystemTab.statutes.test.tsx
git commit -m "$(cat <<'EOF'
fix(admin): stop the Criminal Codes statute request loop

expandedSections is a fresh object literal every render and was listed in
the auto-search effect's dependency array, so the effect re-ran after every
render — and since fetchStatutes sets state, each run scheduled the next.
The panel issued /api/statutes requests continuously while open.

Depends on the primitive activeSection instead, and reuses the effect's
300ms timer as the search debounce (one request per typing burst).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Link statute rows to the Law Book

`/law-book?statute_id=<id>` is already a supported deep link
(`client/src/pages/LawBookPage.tsx:287`), but statute rows offer only copy actions — the
data is displayed and goes nowhere.

**Files:**
- Modify: `client/src/pages/admin/AdminSystemTab.tsx` — `buildStatuteMenu` (`:1378`) and the statute table row (`:2406-2419`)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: nothing.

- [ ] **Step 1: Write the failing test**

Append to `client/src/pages/admin/__tests__/AdminSystemTab.statutes.test.tsx`, inside the
existing `describe('AdminSystemTab — Criminal Codes')` block:

```tsx
  it('renders the citation as a Law Book deep link', async () => {
    renderTab();
    const link = await screen.findByRole('link', { name: /76-5-102/ });
    expect(link).toHaveAttribute('href', '/law-book?statute_id=1');
  });
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd client && npx vitest run src/pages/admin/__tests__/AdminSystemTab.statutes.test.tsx
```

Expected: FAIL — "Unable to find role 'link'". The citation is a plain `<td>`.

- [ ] **Step 3: Add the link**

In `AdminSystemTab.tsx`, add the `Link` import to the existing import block at the top of
the file:

```tsx
import { Link } from 'react-router-dom';
```

Replace the citation cell in the statute table:

```tsx
                            <td className="px-2 py-1.5 font-mono text-brand-400 font-bold whitespace-nowrap">{s.citation}</td>
```

with:

```tsx
                            <td className="px-2 py-1.5 font-mono font-bold whitespace-nowrap">
                              {/* /law-book?statute_id= is handled by LawBookPage's
                                  deep-link reader — the statute panel was display-only
                                  before this. */}
                              <Link
                                to={`/law-book?statute_id=${s.id}`}
                                className="text-brand-400 hover:text-brand-300 hover:underline"
                                title={`Open ${s.citation} in the Law Book`}
                              >
                                {s.citation}
                              </Link>
                            </td>
```

Then add a matching context-menu action. Replace `buildStatuteMenu`:

```tsx
  const buildStatuteMenu = (s: any): ContextMenuItem[] => [
    m.copy('Copy citation', s.citation),
    m.copy('Copy title', s.short_title),
    m.copyId(s.id, 'Copy statute ID'),
  ];
```

with:

```tsx
  const buildStatuteMenu = (s: any): ContextMenuItem[] => [
    m.action('Open in Law Book', () => navigate(`/law-book?statute_id=${s.id}`), { icon: <Scale size={12} /> }),
    m.separator(),
    m.copy('Copy citation', s.citation),
    m.copy('Copy title', s.short_title),
    m.copyId(s.id, 'Copy statute ID'),
  ];
```

Add `useNavigate` to the same `react-router-dom` import and call it inside the component,
next to the other hook declarations (near `const { openMenu } = useContextMenu();`):

```tsx
import { Link, useNavigate } from 'react-router-dom';
```

```tsx
  const navigate = useNavigate();
```

- [ ] **Step 4: Add the router wrapper the test now needs**

Rendering a `Link` outside a router throws. In
`client/src/pages/admin/__tests__/AdminSystemTab.statutes.test.tsx`, add the import:

```tsx
import { MemoryRouter } from 'react-router-dom';
```

and wrap the render helper:

```tsx
const renderTab = () => render(
  <MemoryRouter>
    <AdminSystemTab users={[]} error={null} setError={vi.fn()} LoadingSpinner={LoadingSpinner} />
  </MemoryRouter>,
);
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd client && npx vitest run src/pages/admin/__tests__/AdminSystemTab.statutes.test.tsx
```

Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/admin/AdminSystemTab.tsx client/src/pages/admin/__tests__/AdminSystemTab.statutes.test.tsx
git commit -m "$(cat <<'EOF'
feat(admin): link Criminal Codes rows into the Law Book

The statute panel displayed citations with copy-only actions even though
/law-book?statute_id= is a supported deep link. Citations are now links and
the context menu gains "Open in Law Book".

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Mark the sections nothing consumes yet

Six sections write to D1 and are read by nothing anywhere in `src/` or `client/src/`:
Priority Levels (`priority_levels`), Call Sources (`call_source_list`), Unit Types
(`unit_type_list`), Zones & Beats (`zone_beat_list`), Evidence Types (`evidence_type_list`),
and Security Policy (`security_settings`). An administrator currently cannot distinguish
these from Branding, which is genuinely wired (`client/src/utils/pdfGenerator.ts:157`). Say
so on the surface until Phase 3 wires them.

**Files:**
- Create: `client/src/pages/admin/NotEnforcedNotice.tsx`
- Create: `client/src/pages/admin/__tests__/NotEnforcedNotice.test.tsx`
- Modify: `client/src/pages/admin/AdminSystemTab.tsx` (six section bodies)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `NotEnforcedNotice`, a default-exported React component taking `{ what: string }`.

- [ ] **Step 1: Write the failing test**

Create `client/src/pages/admin/__tests__/NotEnforcedNotice.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import NotEnforcedNotice from '../NotEnforcedNotice';

describe('NotEnforcedNotice', () => {
  it('states plainly that the value is stored but not yet applied', () => {
    render(<NotEnforcedNotice what="Priority labels and colors" />);
    expect(screen.getByRole('note')).toBeInTheDocument();
    expect(screen.getByText(/Priority labels and colors/)).toBeInTheDocument();
    expect(screen.getByText(/not yet enforced/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd client && npx vitest run src/pages/admin/__tests__/NotEnforcedNotice.test.tsx
```

Expected: FAIL — `Cannot find module '../NotEnforcedNotice'`.

- [ ] **Step 3: Create the component**

Create `client/src/pages/admin/NotEnforcedNotice.tsx`:

```tsx
import { AlertCircle } from 'lucide-react';

interface NotEnforcedNoticeProps {
  /** What this section configures, e.g. "Priority labels and colors". */
  what: string;
}

/**
 * Inline notice for a System Config section whose values are persisted but not
 * yet read by any consumer. Six sections were in this state as of 2026-07-25
 * (see docs/superpowers/specs/2026-07-25-admin-system-tab-wiring-design.md).
 * Each Phase 2/3 PR removes this notice from the section it wires — the notice
 * disappearing is the visible signal that enforcement landed.
 */
export default function NotEnforcedNotice({ what }: NotEnforcedNoticeProps) {
  return (
    <div
      role="note"
      className="flex items-start gap-2 px-2.5 py-2 mb-3 bg-amber-950/30 border border-amber-700/40 text-[10px] text-amber-200/90"
    >
      <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-px text-amber-400" aria-hidden="true" />
      <span>
        <span className="font-semibold">{what}</span> are saved here but{' '}
        <span className="font-semibold">not yet enforced</span> anywhere in the
        application. Changes persist and will take effect when this section is
        wired to its consumers.
      </span>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd client && npx vitest run src/pages/admin/__tests__/NotEnforcedNotice.test.tsx
```

Expected: PASS (1 test).

- [ ] **Step 5: Place the notice in the six sections**

In `AdminSystemTab.tsx`, add the import:

```tsx
import NotEnforcedNotice from './NotEnforcedNotice';
```

Insert one notice immediately after the closing `</div>` of each section's heading block
(the `<div className="flex items-center justify-between mb-3">…</div>`), for these six
sections and **no others** — do not add one to `incident_types`, `dispositions`, `units`,
`templates`, `branding`, or `settings`:

| Section marker | Line (pre-edit) | `what` prop |
|---|---|---|
| `activeSection === 'priorities'` | `:1645` | `"Priority labels, colors and response targets"` |
| `activeSection === 'call_sources'` | `:1698` | `"Call source options"` |
| `activeSection === 'unit_types'` | `:1785` | `"Unit type labels and colors"` |
| `activeSection === 'zones'` | `:1993` | `"Zones and beats"` |
| `activeSection === 'evidence_types'` | `:2064` | `"Evidence type options"` |
| `activeSection === 'security'` | `:2219` | `"Password and session policy values"` |

For example, in the priorities section:

```tsx
            </div>
            <NotEnforcedNotice what="Priority labels, colors and response targets" />
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
```

- [ ] **Step 6: Verify all six render and no others**

```bash
grep -c "NotEnforcedNotice what=" client/src/pages/admin/AdminSystemTab.tsx
```

Expected: `6`

- [ ] **Step 7: Run the full client suite and typecheck**

```bash
cd client && npx tsc --noEmit && npx vitest run
```

Expected: no NEW type errors; no NEW test failures. Baseline per `CLAUDE.md` is 12
pre-existing type errors and 9 pre-existing failures across 4 files
(equipmentCustodyPdf/prettyAction, MdtPage, PlateLogPage). Anything beyond that baseline is
yours to fix.

- [ ] **Step 8: Commit**

```bash
git add client/src/pages/admin/NotEnforcedNotice.tsx client/src/pages/admin/__tests__/NotEnforcedNotice.test.tsx client/src/pages/admin/AdminSystemTab.tsx
git commit -m "$(cat <<'EOF'
feat(admin): mark System Config sections that are stored but not enforced

Six sections (priorities, call sources, unit types, zones and beats,
evidence types, security policy) write to D1 and are read by nothing in the
tree, and were visually indistinguishable from Branding, which is genuinely
wired. Each now carries an inline notice; Phase 2/3 PRs remove the notice
for the sections they wire.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Full verification and pull request

**Files:** none modified.

**Interfaces:**
- Consumes: all prior tasks.
- Produces: the PR.

- [ ] **Step 1: Run every gate**

```bash
npm run typecheck
```

Expected: no errors.

```bash
npx vitest run tests/dispositionConfig.test.ts
```

Expected: PASS (10 tests).

```bash
npx vitest run --config vitest.workers.config.mts test-workers/adminSystemConfig.test.ts
```

Expected: PASS (4 tests).

```bash
cd client && npx tsc --noEmit && npx vitest run && npx vite build
```

Expected: no NEW type errors, no NEW test failures beyond the documented baseline, build
succeeds.

- [ ] **Step 2: Manual browser verification**

Start the Worker and the SPA:

```bash
npm run dev
```

```bash
cd client && npm run dev
```

Open `http://localhost:5173/admin?tab=system` and confirm each item:

1. Click through all 13 sections — every one renders without a console error.
2. **Criminal Codes:** open DevTools → Network, filter `statutes`. Opening the section
   issues **one** request. Type "assault" — one further request after you stop typing, not
   one per keystroke. The request stream must be idle when you are.
3. **Criminal Codes:** click a citation — it navigates to the Law Book with that statute
   resolved. Right-click a row — "Open in Law Book" appears and works.
4. **System Settings:** change Agency ORI, wait for the autosave (1.5 s) or switch sections,
   then hard-reload. **The value must persist** — this is defect #1.
5. **Dispositions:** add a code (e.g. `PATROL CHECK` / "Patrol Check Completed"), then open
   Dispatch and check the disposition dropdown on a call. **The new code must appear** —
   this is defect #2.
6. The six unwired sections each show the amber "not yet enforced" notice; Branding,
   Incident Types, Dispositions, Quick Templates, Dispatch Units, and System Settings do
   **not**.

- [ ] **Step 3: Open the pull request**

```bash
git push -u origin claude/admin-system-paths-links-c5f4a3
```

```bash
gh pr create -R rmpgutah/rmpg-flex --title "fix(admin): Phase 0 — make System Config actually path and show results" --body "$(cat <<'EOF'
Phase 0 of the Admin → System Config wiring program. Spec:
`docs/superpowers/specs/2026-07-25-admin-system-tab-wiring-design.md`.

## Defects fixed

- **System Settings never read back what it saved.** `PUT /admin/system-settings`
  INSERTed without `category`; `system_config.category` is `NOT NULL DEFAULT 'general'`,
  so all 60 fields filed under `general` while the tab reloads from
  `grouped.system_settings` — every field silently reverted to defaults on refresh.
- **Admin-created dispositions never reached the dropdowns.** The tab writes
  `config_key='disposition_code'` + `category='dispositions'`; flat `GET /admin/config`
  recognized only `disposition.`-prefixed keys. Assembly is now a pure, unit-tested
  helper (`src/utils/dispositionConfig.ts`) that handles both namespaces.
- **Criminal Codes issued unbounded `/api/statutes` requests.** An object literal in an
  effect dependency array re-ran the effect every render, and the fetch set state. Now
  keyed on the primitive `activeSection`, with the effect's timer doubling as a 300 ms
  search debounce.

## Also

- Removed the unreachable duplicate `GET /admin/config-history` (read `config_audit_log`,
  which has no writers anywhere in `src/`). Added a regression test pinning the surviving
  `activity_log` + `?limit` behavior.
- Statute citations link to `/law-book?statute_id=`, plus an "Open in Law Book" context
  action.
- The six sections whose values nothing consumes now say so inline, so they are no longer
  indistinguishable from Branding, which is genuinely wired.

## Not in this PR

No schema migration, no operational default changes, and no new enforcement — Phases 1–3
of the spec cover moving the 60 settings onto the `system_settings` rail and wiring the six
orphan sections. A Dispatch Units deep link was cut deliberately: no `unit` URL parameter
exists on DispatchPage or MapPage, so it would have meant editing a ~6k-line file.

## Verification

Worker typecheck ✅ · `tests/dispositionConfig.test.ts` 10 ✅ ·
`test-workers/adminSystemConfig.test.ts` 4 ✅ · client typecheck (no new errors) ✅ ·
client vitest (no new failures) ✅ · `vite build` ✅ · manual browser pass over all 13
sections, including confirming a saved setting survives reload and a new disposition
reaches the Dispatch dropdown.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Post-merge follow-up**

Phase 0 adds no migration, so nothing needs applying to live D1. After merge, verify the
deploy landed the Worker bundle (CI green is not proof of shipped — see
`feedback-wrangler-action-silent-stale-bundle`), then confirm on
`https://rmpgutah.us/admin?tab=system` in a real browser that a System Settings value
survives a reload.

---

## Self-Review

**Spec coverage.** Phase 0's six numbered items map to tasks 1, 2, 4, 3, 5, 6 respectively.
The spec's "explicitly out of scope" note (Dispatch Units deep link) is carried into Task 5's
scope and the PR body. The spec's Phase 0 verification list is Task 7 Step 2.

**Type consistency.** `DispositionConfigRow` / `Disposition` / `mergeDispositions` /
`isDispositionRow` / `DEFAULT_DISPOSITIONS` are declared in Task 2 Step 3 and used with the
same names in Task 2 Steps 1 and 8. `NotEnforcedNotice`'s single `what: string` prop is
consistent across Task 6 Steps 1, 3, and 5.

**Placeholder scan.** No TBD/TODO markers, no "add appropriate error handling", no "similar
to Task N" back-references. Every code step carries the literal code. The one place the plan
says "copy, do not retype" is `DEFAULT_DISPOSITIONS` (Task 2 Step 3) — the full 39-entry
array is nonetheless reproduced in the plan so it can be diffed against the original rather
than trusted.
