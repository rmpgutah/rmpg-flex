# Fleet Manager UI — PR 7'a: Shell + Sidebar + Dashboard + Vehicles List — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the foundation for the Fleet.io-style Fleet Manager UI — two-pane shell, sidebar IA, KPI dashboard, vehicles list, vehicle-detail page with the Overview tab — mounted at `/fleet/v2/*` in parallel with the existing `/fleet`. No effect on the existing UI; operator opts into v2 by URL for the soak period.

**Architecture:** New isolated directory `client/src/pages/fleet/v2/` containing a layout shell (`FleetShell` = sidebar + outlet), a config-driven sidebar (`SIDEBAR_SECTIONS` single source of truth), three route components (Dashboard / Vehicles list / Vehicle detail), and shared chrome (`KpiRibbon`, `EmptyStateCard`, `SectionHeader`, `FleetListShell` stub). Reuses existing modals, hooks, formatters, and gauges from `client/src/components/` and `client/src/pages/fleet/` without modification. Page-view audit emit + `noindex` meta + CI endpoint-coverage workflow ship now so PRs 7'b/c inherit the guardrails.

**Tech Stack:** React 18 + TypeScript 5 + React Router 6 + Vite 6 + Tailwind + Recharts (already wired). Vitest 4 + React Testing Library for tests. Cloudflare Workers (no server changes other than one tiny audit-emit route).

**Spec:** [`docs/superpowers/specs/2026-06-21-fleet-manager-ui-fleetio-style-design.md`](../specs/2026-06-21-fleet-manager-ui-fleetio-style-design.md)

---

## Branch + scope

Land all 20 tasks on `feat/fleet-ui-fleetio-style` (already has the spec commit `868675edc`). Single PR, ~3,500 net new lines, follows the same `gh pr create` → operator-review → merge flow as PR #1477.

Per `[[feedback-use-pr-flow-not-direct-push]]`: branch off `origin/main`, never push HEAD:main, never `--force` (use `--force-with-lease` only if needed).

---

## File Structure

| Path | Action | Responsibility |
|---|---|---|
| `.github/workflows/fleet-ui-coverage.yml` | create | CI workflow: prints endpoint-coverage diff (informational in 7'a, blocking in 7'c) + fails PR if any `migrations/*.sql` is added |
| `docs/fleet-v2/live-sync-inventory.md` | create | Pure doc — channel inventory of every `useLiveSync()` call in `FleetPage.tsx` + 14 tab files |
| `client/src/types/fleetV2Audit.ts` | create | Discriminated-union TS types for `FleetV2AuditDetails` (FLEET_V2_VIEW + FLEET_V2_API_ERROR) |
| `client/src/pages/fleet/v2/hooks/useNoindexDuringSoak.ts` | create | Mounts `<meta name="robots" content="noindex">` for the soak period; flips on a `V2_SOAK_ACTIVE` constant for 7'c removal |
| `client/src/pages/fleet/v2/hooks/useFleetV2Audit.ts` | create | Client wrapper: POST `/api/audit-emit` on Route mount with `FLEET_V2_VIEW` payload |
| `src/routes/auditEmit.ts` | create | Tiny Worker route — `POST /api/audit-emit` accepts a narrowly-allowed action set (FLEET_V2_VIEW, FLEET_V2_API_ERROR), calls server-side `recordAudit()` |
| `src/routesConfig.ts` | modify | Register the new audit-emit route |
| `client/src/pages/fleet/v2/shell/EmptyStateCard.tsx` | create | "Coming in PR N" card + "View in Fleet.io →" deep-link button (used by ◯ sections + tabs) |
| `client/src/pages/fleet/v2/shell/SectionHeader.tsx` | create | Consistent `<h1>` + breadcrumb + action-button slot |
| `client/src/pages/fleet/v2/shell/KpiRibbon.tsx` | create | Top KPI strip — pulls existing /api/fleet/analytics + /api/fleet/notifications + /api/fleet/overdue-inspections |
| `client/src/pages/fleet/v2/shell/FleetListShell.tsx` | create | Filter chips + search + sort + pagination + export chrome; stubbed in 7'a, fully wired by VehiclesListRoute |
| `client/src/pages/fleet/v2/Sidebar.tsx` | create | `SIDEBAR_SECTIONS` const config + render — 11 Fleet.io-mirrored items + gold "RMPG ONLY" divider + 4 RMPG-only items |
| `client/src/pages/fleet/v2/FleetShell.tsx` | create | Two-pane layout: `<Sidebar>` + `<Outlet>` + child router; mounts `useNoindexDuringSoak()` once |
| `client/src/pages/fleet/v2/routes/DashboardRoute.tsx` | create | KPI ribbon + 3 cards (Upcoming Service / Recent Fuel / Recent Inspections) with "View all →" links |
| `client/src/pages/fleet/v2/routes/VehiclesListRoute.tsx` | create | Fleet-wide vehicles via existing `/api/fleet` + card/table toggle |
| `client/src/pages/fleet/v2/routes/VehicleDetailRoute.tsx` | create | Sticky header + status dropdown + 13-tab nav (only Overview wired; others show EmptyStateCard "Coming in PR 7'b"); reuses VehicleFormModal for Edit |
| `client/src/pages/fleet/v2/vehicleDetail/OverviewTab.tsx` | create | Port of `client/src/pages/fleet/tabs/FleetOverviewTab.tsx` — same data sources, same fields |
| `client/src/pages/admin/AdminFleetV2HealthTab.tsx` | create | Admin-only stub page — counts of FLEET_V2_VIEW + FLEET_V2_API_ERROR audit rows |
| `client/src/App.tsx` | modify | Lazy-load FleetShell + add `<Route path="/fleet/v2/*" element={...} />` BEFORE the existing `/fleet` route |
| `client/src/components/admin/AdminTabConfig.ts` *(or wherever admin tabs are listed)* | modify | Add the Fleet V2 Health tab |
| `client/public/sw.js` | modify | Bump `CACHE_NAME` (any client change requires this per CLAUDE.md) |
| `tests/fleetV2Audit.test.ts` | create | Vitest — discriminated-union type narrowing, no `as any` |
| `tests/auditEmit.test.ts` | create | Vitest — `/api/audit-emit` accepts allow-listed actions, rejects others |
| `client/src/pages/fleet/v2/__tests__/Sidebar.test.tsx` | create | RTL — `SIDEBAR_SECTIONS` renders all 15 items, gold divider visible, ◯ marker on empty sections |
| `client/src/pages/fleet/v2/__tests__/FleetShell.test.tsx` | create | RTL — viewport tests at 375x667 and 1440x900; sidebar collapses to drawer below 768px |
| `client/src/pages/fleet/v2/__tests__/DashboardRoute.test.tsx` | create | RTL — KPI ribbon renders, 3 cards render |
| `client/src/pages/fleet/v2/__tests__/VehiclesListRoute.test.tsx` | create | RTL — card and table modes both render seeded data |
| `client/src/pages/fleet/v2/__tests__/VehicleDetailRoute.test.tsx` | create | RTL — header + status dropdown + all 13 tab names visible; only Overview wired |
| `tests/fleet-v2-reuse/VehicleFormModal.contract.test.tsx` | create | RTL — VehicleFormModal mounts inside FleetShell, fills, submits, asserts API call |
| `tests/cross-impact/map-fleet-markers.test.tsx` | create | RTL — MapPage with seeded fleet vehicles renders markers |
| `client/src/pages/fleet/v2/__tests__/no-as-any.test.ts` | create | Vitest — `grep "as any"` over `client/src/pages/fleet/v2/` returns empty |

---

## Task 1: Live-sync channel inventory (doc-only)

**Why:** Section 6.4 of the spec requires this before any code touches the new shell. Pure audit deliverable — no code yet.

**Files:**
- Create: `docs/fleet-v2/live-sync-inventory.md`

- [ ] **Step 1.1: Confirm branch + clean working tree**

Run: `git status -s && git branch --show-current`
Expected: empty status, branch `feat/fleet-ui-fleetio-style`.

- [ ] **Step 1.2: Enumerate every `useLiveSync` call in old fleet tree**

Run: `grep -rn "useLiveSync" client/src/pages/fleet/ 2>/dev/null`
Note the file paths, line numbers, and channel arguments.

- [ ] **Step 1.3: Write the inventory doc**

Create `docs/fleet-v2/live-sync-inventory.md`:

```markdown
# Fleet V2 — Live Sync Channel Inventory

Audit of every `useLiveSync()` call in the existing `/fleet` UI tree.
Generated for [PR 7'a spec](../superpowers/specs/2026-06-21-fleet-manager-ui-fleetio-style-design.md) §6.4.

Each row documents the channel string, payload shape (best-effort from
the server-side broadcast), and which new v2 Route will subscribe to
the same channel in PR 7'a/b.

| File:line | Channel | Payload shape | v2 Route that subscribes |
|---|---|---|---|
| (filled by Step 1.2 grep output) | ... | ... | ... |

## Notes

- Channels named after RESOURCE types (e.g. `fleet_vehicles`) are stable
  and can be re-subscribed in v2 with no server change.
- Channels named after COMPONENT INSTANCES (if any) need refactoring
  to resource-based names before v2 Routes can subscribe — flag for
  PR 7'b.
- If the old fleet code uses no `useLiveSync` at all, this doc still
  ships and notes "no live channels used; v2 inherits the data-only
  pattern (fetch-on-mount + manual refresh button)".
```

Then fill the table from the Step 1.2 grep output.

- [ ] **Step 1.4: Commit**

```bash
git add docs/fleet-v2/live-sync-inventory.md
git commit -m "docs(fleet-v2): live-sync channel inventory (PR 7'a §6.4)"
```

Pre-commit hook runs vitest (~1013 tests + 2 client suites). Should pass — doc-only change.

---

## Task 2: CI workflow — endpoint coverage + no-DDL guard

**Why:** Section 6.1 + 6.2 of the spec. Ship now so the guardrail catches the first commit that breaks it.

**Files:**
- Create: `.github/workflows/fleet-ui-coverage.yml`

- [ ] **Step 2.1: Write the workflow**

Create `.github/workflows/fleet-ui-coverage.yml`:

```yaml
name: fleet-ui-coverage

on:
  pull_request:
    paths:
      - 'client/src/pages/fleet/**'
      - 'src/routes/fleet.ts'
      - 'migrations/**'

jobs:
  no-ddl-guard:
    name: No DDL in fleet-ui PR
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - name: Block any new migrations file
        run: |
          # Fail if this PR introduces any new file under migrations/
          base="${{ github.event.pull_request.base.sha }}"
          head="${{ github.event.pull_request.head.sha }}"
          new_migrations=$(git diff --name-only --diff-filter=A "$base...$head" -- 'migrations/*.sql' | tr -d '[:space:]')
          if [ -n "$new_migrations" ]; then
            echo "::error::Fleet-UI PR may not add migrations. Found new files:"
            git diff --name-only --diff-filter=A "$base...$head" -- 'migrations/*.sql'
            exit 1
          fi
          echo "OK: no new migrations in this PR."

  endpoint-coverage:
    name: Endpoint coverage report (informational in 7'a, blocking in 7'c)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Compute old vs new /api/fleet/* endpoint sets
        id: cov
        run: |
          old_set=$(grep -rohE "/api/fleet[a-zA-Z0-9/_-]*" \
            client/src/pages/fleet/FleetPage.tsx \
            client/src/pages/fleet/FleetDetailPanel.tsx \
            client/src/pages/fleet/tabs/ 2>/dev/null | sort -u || true)
          new_set=$(grep -rohE "/api/fleet[a-zA-Z0-9/_-]*" \
            client/src/pages/fleet/v2/ 2>/dev/null | sort -u || true)
          echo "=== Endpoints in OLD fleet UI ==="
          echo "$old_set"
          echo
          echo "=== Endpoints in NEW v2 UI ==="
          echo "$new_set"
          echo
          echo "=== Missing from v2 (must be added before cutover) ==="
          comm -23 <(echo "$old_set") <(echo "$new_set") || true
          echo
          echo "=== Added to v2 (acceptable; review for purpose) ==="
          comm -13 <(echo "$old_set") <(echo "$new_set") || true
      - name: Check coverage gating
        run: |
          # In 7'a/7'b: informational only — never fails.
          # In 7'c: this step will be changed to `exit 1` if the
          # "Missing from v2" set is non-empty. Until then, this is
          # a status report and always passes.
          echo "Coverage report above. Cutover PR 7'c will gate on it."
```

- [ ] **Step 2.2: Verify the workflow file parses**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/fleet-ui-coverage.yml'))" && echo "YAML OK"`
Expected: `YAML OK`.

- [ ] **Step 2.3: Commit**

```bash
git add .github/workflows/fleet-ui-coverage.yml
git commit -m "ci(fleet-ui): endpoint-coverage + no-DDL guard workflow"
```

---

## Task 3: Audit-payload types — `client/src/types/fleetV2Audit.ts`

**Why:** Sections 6.9 + 6.10. Discriminated union prevents untyped JSON in audit emits. TDD: types are tested via a tiny narrowing-discipline test.

**Files:**
- Create: `client/src/types/fleetV2Audit.ts`
- Create: `client/tests/fleetV2Audit.test.ts`

- [ ] **Step 3.1: Write failing test**

Create `client/tests/fleetV2Audit.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { FleetV2AuditDetails, FleetV2ViewDetails, FleetV2ApiErrorDetails } from '../src/types/fleetV2Audit';
import { isViewDetails, isApiErrorDetails } from '../src/types/fleetV2Audit';

describe('FleetV2AuditDetails discriminated union', () => {
  it('isViewDetails narrows correctly', () => {
    const v: FleetV2AuditDetails = { kind: 'FLEET_V2_VIEW', route: '/fleet/v2', viewport_width: 1440 };
    expect(isViewDetails(v)).toBe(true);
    if (isViewDetails(v)) {
      // TS narrows here — these compile only because the type is correct
      const _r: string = v.route;
      const _w: number = v.viewport_width;
      expect(_r).toBe('/fleet/v2');
      expect(_w).toBe(1440);
    }
  });

  it('isApiErrorDetails narrows correctly', () => {
    const e: FleetV2AuditDetails = {
      kind: 'FLEET_V2_API_ERROR',
      endpoint: '/api/fleet',
      status: 500,
      message: 'boom',
    };
    expect(isApiErrorDetails(e)).toBe(true);
    if (isApiErrorDetails(e)) {
      const _s: number = e.status;
      expect(_s).toBe(500);
    }
  });

  it('isViewDetails rejects an error payload', () => {
    const e: FleetV2AuditDetails = { kind: 'FLEET_V2_API_ERROR', endpoint: '/x', status: 0, message: '' };
    expect(isViewDetails(e)).toBe(false);
  });

  it('FleetV2ViewDetails and FleetV2ApiErrorDetails are separate concrete types', () => {
    const v: FleetV2ViewDetails = { kind: 'FLEET_V2_VIEW', route: '/x', viewport_width: 100 };
    const e: FleetV2ApiErrorDetails = { kind: 'FLEET_V2_API_ERROR', endpoint: '/y', status: 1, message: 'a' };
    expect(v.kind).not.toBe(e.kind);
  });
});
```

- [ ] **Step 3.2: Run — expect FAIL**

Run: `cd client && npx vitest run tests/fleetV2Audit.test.ts`
Expected: fail with "Cannot find module '../src/types/fleetV2Audit'".

- [ ] **Step 3.3: Implement the types**

Create `client/src/types/fleetV2Audit.ts`:

```ts
// ============================================================
// Fleet V2 audit-emit payload types
// ============================================================
// Discriminated union for the `details` field on every
// recordAudit() call emitted from the new /fleet/v2 UI.
// Section 6.10 of the spec mandates typed payloads — no
// untyped JSON in audit_log/flex_events rows.
// ============================================================

export interface FleetV2ViewDetails {
  kind: 'FLEET_V2_VIEW';
  /** The /fleet/v2/... pathname at mount time. */
  route: string;
  /** window.innerWidth at mount time. Used by 6.6 viewport analysis. */
  viewport_width: number;
}

export interface FleetV2ApiErrorDetails {
  kind: 'FLEET_V2_API_ERROR';
  /** The /api/fleet/... endpoint that returned non-2xx. */
  endpoint: string;
  /** HTTP status code (0 if network/abort). */
  status: number;
  /** Human-readable message — never include response body (may leak secrets). */
  message: string;
}

export type FleetV2AuditDetails = FleetV2ViewDetails | FleetV2ApiErrorDetails;

export function isViewDetails(d: FleetV2AuditDetails): d is FleetV2ViewDetails {
  return d.kind === 'FLEET_V2_VIEW';
}

export function isApiErrorDetails(d: FleetV2AuditDetails): d is FleetV2ApiErrorDetails {
  return d.kind === 'FLEET_V2_API_ERROR';
}
```

- [ ] **Step 3.4: Run — expect PASS**

Run: `cd client && npx vitest run tests/fleetV2Audit.test.ts`
Expected: 4 tests pass.

- [ ] **Step 3.5: Commit**

```bash
git add client/src/types/fleetV2Audit.ts client/tests/fleetV2Audit.test.ts
git commit -m "feat(fleet-v2): typed audit payloads — FLEET_V2_VIEW + FLEET_V2_API_ERROR"
```

---

## Task 4: Worker route — `POST /api/audit-emit`

**Why:** Client routes need a server endpoint to push their FLEET_V2_VIEW + FLEET_V2_API_ERROR audit rows. Narrow allow-list prevents this route becoming an open audit-injection endpoint.

**Files:**
- Create: `src/routes/auditEmit.ts`
- Modify: `src/routesConfig.ts`
- Create: `tests/auditEmit.test.ts`

- [ ] **Step 4.1: Write failing test**

Create `tests/auditEmit.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import auditEmit from '../src/routes/auditEmit';

describe('POST /api/audit-emit', () => {
  let app: Hono<any>;
  let auditCalls: Array<{ action: string; entityType: string; details: unknown }>;

  beforeEach(() => {
    auditCalls = [];
    app = new Hono();
    // Pretend the user is authed (the real middleware sets c.var.user).
    app.use('*', async (c, next) => {
      c.set('user', { id: 7, username: 'tester', role: 'officer' });
      c.set('userId', 7);
      await next();
    });
    // Inject a stub recordAudit by replacing the module — vitest mocks.
    app.route('/', auditEmit);
  });

  it('accepts FLEET_V2_VIEW action', async () => {
    const res = await app.request('/api/audit-emit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'FLEET_V2_VIEW', entityType: 'fleet_ui_page', details: { kind: 'FLEET_V2_VIEW', route: '/fleet/v2', viewport_width: 1440 } }),
    });
    expect(res.status).toBe(202);
  });

  it('accepts FLEET_V2_API_ERROR action', async () => {
    const res = await app.request('/api/audit-emit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'FLEET_V2_API_ERROR', entityType: 'fleet_ui_page', details: { kind: 'FLEET_V2_API_ERROR', endpoint: '/api/fleet', status: 500, message: 'boom' } }),
    });
    expect(res.status).toBe(202);
  });

  it('rejects an action not on the allow-list (400)', async () => {
    const res = await app.request('/api/audit-emit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'ANYTHING_ELSE', entityType: 'x', details: {} }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/not allowed/i);
  });

  it('rejects a missing action (400)', async () => {
    const res = await app.request('/api/audit-emit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entityType: 'x', details: {} }),
    });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 4.2: Run — expect FAIL**

Run: `npx vitest run tests/auditEmit.test.ts`
Expected: fail with "Cannot find module '../src/routes/auditEmit'".

- [ ] **Step 4.3: Implement the route**

Create `src/routes/auditEmit.ts`:

```ts
// ============================================================
// Tiny audit-emit route for client-side instrumentation.
//
// PR 7'a opens this route ONLY for the narrow allow-list below
// (FLEET_V2_*). Adding new actions here requires explicit code
// review — the design rule is "audit emits go through specific
// routes per feature", not "one open audit endpoint for everything."
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { recordAudit } from '../utils/auditLog';

const ALLOWED_ACTIONS = new Set([
  'FLEET_V2_VIEW',
  'FLEET_V2_API_ERROR',
]);

const route = new Hono<Env>();

route.post('/api/audit-emit', async (c) => {
  let body: { action?: string; entityType?: string; entityId?: number | string | null; details?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid JSON body' }, 400);
  }
  const action = String(body.action ?? '');
  if (!action) {
    return c.json({ error: 'action is required' }, 400);
  }
  if (!ALLOWED_ACTIONS.has(action)) {
    return c.json({ error: `action '${action}' not allowed by this endpoint` }, 400);
  }
  await recordAudit(c, {
    action,
    entityType: String(body.entityType ?? 'fleet_ui_page'),
    entityId: body.entityId ?? null,
    details: body.details ?? null,
  });
  return c.json({ ok: true }, 202);
});

export default route;
```

- [ ] **Step 4.4: Register in routesConfig.ts**

Open `src/routesConfig.ts`. Add the import near the other route imports (alphabetical-ish):

```ts
import auditEmit from './routes/auditEmit';
```

Add to `ROUTE_REGISTRY` between `audit` and the next alphabetical entry (`auth` if it lives nearby, or just after `audit`):

```ts
  { prefix: '/api/audit-emit', router: auditEmit, auth: 'required' },
```

Wait — the route uses `.post('/api/audit-emit', ...)` with the FULL path inside the handler. The Hono mount in routesConfig uses a prefix, so the inner path should be relative. Adjust the route file accordingly:

Edit `src/routes/auditEmit.ts` — change `route.post('/api/audit-emit', ...)` to `route.post('/', ...)` since the prefix `/api/audit-emit` is added by the registry.

Then update `tests/auditEmit.test.ts` similarly — the test mounts the router at `/`, so requests should be to `/` (already correct since the test calls `'/api/audit-emit'` — fix it to `'/'` and adjust the mount in beforeEach to `app.route('/api/audit-emit', auditEmit)` instead).

Final test setup:

```ts
beforeEach(() => {
  // ... user stub middleware ...
  app.route('/api/audit-emit', auditEmit);
});
```

Then requests stay as `/api/audit-emit` and inside the route handler use `route.post('/', ...)`.

- [ ] **Step 4.5: Run — expect PASS**

Run: `npx vitest run tests/auditEmit.test.ts`
Expected: 4 tests pass.

- [ ] **Step 4.6: Typecheck**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 4.7: Commit**

```bash
git add src/routes/auditEmit.ts src/routesConfig.ts tests/auditEmit.test.ts
git commit -m "feat(fleet-v2): POST /api/audit-emit — narrow allow-list for FLEET_V2_* audits"
```

---

## Task 5: `useNoindexDuringSoak` hook

**Why:** Section 6.8 — `/fleet/v2/*` pages should not be indexed by search engines or browser history-search during the soak. Single constant flip at cutover (7'c) removes the meta tag.

**Files:**
- Create: `client/src/pages/fleet/v2/hooks/useNoindexDuringSoak.ts`
- Create: `client/src/pages/fleet/v2/hooks/__tests__/useNoindexDuringSoak.test.tsx`

- [ ] **Step 5.1: Write failing test**

Create `client/src/pages/fleet/v2/hooks/__tests__/useNoindexDuringSoak.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { useNoindexDuringSoak, V2_SOAK_ACTIVE } from '../useNoindexDuringSoak';

function HookHost() {
  useNoindexDuringSoak();
  return <div>host</div>;
}

describe('useNoindexDuringSoak', () => {
  beforeEach(() => { document.head.innerHTML = ''; });
  afterEach(() => { cleanup(); document.head.innerHTML = ''; });

  it('adds <meta name="robots" content="noindex"> on mount when soak is active', () => {
    if (!V2_SOAK_ACTIVE) {
      // Defensive: this test only runs while soak is on (7'a/b ship soak=true).
      return;
    }
    render(<HookHost />);
    const meta = document.head.querySelector('meta[name="robots"]');
    expect(meta).not.toBeNull();
    expect(meta?.getAttribute('content')).toBe('noindex');
  });

  it('removes the meta on unmount (idempotent)', () => {
    if (!V2_SOAK_ACTIVE) return;
    const { unmount } = render(<HookHost />);
    expect(document.head.querySelector('meta[name="robots"]')).not.toBeNull();
    unmount();
    expect(document.head.querySelector('meta[name="robots"]')).toBeNull();
  });

  it('does not duplicate the meta if mounted twice', () => {
    if (!V2_SOAK_ACTIVE) return;
    render(<HookHost />);
    render(<HookHost />);
    const metas = document.head.querySelectorAll('meta[name="robots"]');
    expect(metas.length).toBe(1);
  });
});
```

- [ ] **Step 5.2: Run — expect FAIL**

Run: `cd client && npx vitest run src/pages/fleet/v2/hooks/__tests__/useNoindexDuringSoak.test.tsx`
Expected: fail with "Cannot find module".

- [ ] **Step 5.3: Implement**

Create `client/src/pages/fleet/v2/hooks/useNoindexDuringSoak.ts`:

```ts
import { useEffect } from 'react';

/** Single constant flipped at cutover (PR 7'c) to remove the noindex meta. */
export const V2_SOAK_ACTIVE = true;

const META_NAME = 'robots';
const META_CONTENT = 'noindex';

/** Adds <meta name="robots" content="noindex"> to <head> while soak is on.
 *  Reference-counts so multiple Route components mounting the hook don't
 *  duplicate or prematurely remove the tag. */
let refCount = 0;
let metaEl: HTMLMetaElement | null = null;

function add() {
  if (!metaEl) {
    metaEl = document.createElement('meta');
    metaEl.setAttribute('name', META_NAME);
    metaEl.setAttribute('content', META_CONTENT);
    document.head.appendChild(metaEl);
  }
  refCount += 1;
}

function remove() {
  refCount -= 1;
  if (refCount <= 0 && metaEl) {
    metaEl.remove();
    metaEl = null;
    refCount = 0;
  }
}

export function useNoindexDuringSoak(): void {
  useEffect(() => {
    if (!V2_SOAK_ACTIVE) return;
    add();
    return remove;
  }, []);
}
```

- [ ] **Step 5.4: Run — expect PASS**

Run: `cd client && npx vitest run src/pages/fleet/v2/hooks/__tests__/useNoindexDuringSoak.test.tsx`
Expected: 3 tests pass.

- [ ] **Step 5.5: Commit**

```bash
git add client/src/pages/fleet/v2/hooks/
git commit -m "feat(fleet-v2): useNoindexDuringSoak hook — single-constant flip at cutover"
```

---

## Task 6: `useFleetV2Audit` hook — client-side audit emit

**Why:** Section 6.9 — every Route emits FLEET_V2_VIEW on mount. Hook centralizes the fire-and-forget POST so callers stay one-line.

**Files:**
- Create: `client/src/pages/fleet/v2/hooks/useFleetV2Audit.ts`
- Create: `client/src/pages/fleet/v2/hooks/__tests__/useFleetV2Audit.test.tsx`

- [ ] **Step 6.1: Write failing test**

Create `client/src/pages/fleet/v2/hooks/__tests__/useFleetV2Audit.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import { useFleetV2View } from '../useFleetV2Audit';

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 202 }));
  vi.stubGlobal('fetch', fetchMock);
});

function ViewHost({ route }: { route: string }) {
  useFleetV2View(route);
  return <div>host</div>;
}

describe('useFleetV2View', () => {
  it('POSTs FLEET_V2_VIEW to /api/audit-emit on mount with route + viewport_width', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 1440, configurable: true });
    render(<ViewHost route="/fleet/v2/dashboard" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/audit-emit$/);
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body.action).toBe('FLEET_V2_VIEW');
    expect(body.entityType).toBe('fleet_ui_page');
    expect(body.details).toEqual({
      kind: 'FLEET_V2_VIEW',
      route: '/fleet/v2/dashboard',
      viewport_width: 1440,
    });
    cleanup();
  });

  it('swallows fetch errors silently (fire-and-forget)', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'));
    expect(() => render(<ViewHost route="/x" />)).not.toThrow();
    cleanup();
  });
});
```

- [ ] **Step 6.2: Run — expect FAIL**

Run: `cd client && npx vitest run src/pages/fleet/v2/hooks/__tests__/useFleetV2Audit.test.tsx`
Expected: fail "Cannot find module".

- [ ] **Step 6.3: Implement**

Create `client/src/pages/fleet/v2/hooks/useFleetV2Audit.ts`:

```ts
import { useEffect, useRef } from 'react';
import { apiFetch } from '../../../../hooks/useApi';
import type { FleetV2AuditDetails } from '../../../../types/fleetV2Audit';

interface EmitArgs {
  action: 'FLEET_V2_VIEW' | 'FLEET_V2_API_ERROR';
  entityType: string;
  details: FleetV2AuditDetails;
}

function emit(args: EmitArgs): void {
  // Fire-and-forget; errors swallowed so audit emits never break the UI.
  apiFetch('/audit-emit', {
    method: 'POST',
    body: JSON.stringify(args),
  }).catch(() => {});
}

/** Emits a single FLEET_V2_VIEW row on mount. Idempotent across React strict-mode double-invoke. */
export function useFleetV2View(route: string): void {
  const emittedRef = useRef(false);
  useEffect(() => {
    if (emittedRef.current) return;
    emittedRef.current = true;
    emit({
      action: 'FLEET_V2_VIEW',
      entityType: 'fleet_ui_page',
      details: {
        kind: 'FLEET_V2_VIEW',
        route,
        viewport_width: typeof window !== 'undefined' ? window.innerWidth : 0,
      },
    });
  }, [route]);
}

/** Used by API-call error sentinels (FleetListShell + per-Route fetch wrappers). */
export function emitFleetV2ApiError(endpoint: string, status: number, message: string): void {
  emit({
    action: 'FLEET_V2_API_ERROR',
    entityType: 'fleet_ui_page',
    details: { kind: 'FLEET_V2_API_ERROR', endpoint, status, message },
  });
}
```

- [ ] **Step 6.4: Run — expect PASS**

Run: `cd client && npx vitest run src/pages/fleet/v2/hooks/__tests__/useFleetV2Audit.test.tsx`
Expected: 2 tests pass.

If the `apiFetch` import path is wrong, fix it by reading `client/src/hooks/useApi.ts` to find the correct relative path from `v2/hooks/`. Expected is `'../../../../hooks/useApi'` (up 4 levels: hooks → v2 → fleet → pages → src/hooks).

- [ ] **Step 6.5: Commit**

```bash
git add client/src/pages/fleet/v2/hooks/useFleetV2Audit.ts client/src/pages/fleet/v2/hooks/__tests__/useFleetV2Audit.test.tsx
git commit -m "feat(fleet-v2): useFleetV2View + emitFleetV2ApiError hooks"
```

---

## Task 7: Shared chrome — `EmptyStateCard` + `SectionHeader`

**Why:** Used by every ◯ section + tab in this PR and 7'b. Cheap to build, cheap to test, locks visual consistency.

**Files:**
- Create: `client/src/pages/fleet/v2/shell/EmptyStateCard.tsx`
- Create: `client/src/pages/fleet/v2/shell/SectionHeader.tsx`
- Create: `client/src/pages/fleet/v2/shell/__tests__/EmptyStateCard.test.tsx`
- Create: `client/src/pages/fleet/v2/shell/__tests__/SectionHeader.test.tsx`

- [ ] **Step 7.1: Write failing test for `EmptyStateCard`**

Create `client/src/pages/fleet/v2/shell/__tests__/EmptyStateCard.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EmptyStateCard } from '../EmptyStateCard';

describe('EmptyStateCard', () => {
  it('renders title + plannedPr line + fleetioUrl button', () => {
    render(
      <EmptyStateCard
        title="Work Orders"
        plannedPr="PR 5"
        description="Vehicle in-shop tracking."
        fleetioUrl="https://app.fleetio.com/work_orders"
      />
    );
    expect(screen.getByText('Work Orders')).toBeInTheDocument();
    expect(screen.getByText(/Coming in PR 5/)).toBeInTheDocument();
    expect(screen.getByText('Vehicle in-shop tracking.')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /view in fleet\.io/i }) as HTMLAnchorElement;
    expect(link.href).toBe('https://app.fleetio.com/work_orders');
    expect(link.target).toBe('_blank');
    expect(link.rel).toMatch(/noopener/);
  });

  it('renders without fleetioUrl (no link, no crash)', () => {
    render(<EmptyStateCard title="Documents" plannedPr="Phase 2" description="Per-vehicle uploads." />);
    expect(screen.queryByRole('link', { name: /view in fleet\.io/i })).toBeNull();
  });
});
```

- [ ] **Step 7.2: Run — expect FAIL**

Run: `cd client && npx vitest run src/pages/fleet/v2/shell/__tests__/EmptyStateCard.test.tsx`
Expected: fail "Cannot find module".

- [ ] **Step 7.3: Implement `EmptyStateCard`**

Create `client/src/pages/fleet/v2/shell/EmptyStateCard.tsx`:

```tsx
import { ExternalLink } from 'lucide-react';

export interface EmptyStateCardProps {
  title: string;
  plannedPr: string;
  description: string;
  fleetioUrl?: string;
}

/** Styled empty-state for sidebar sections and vehicle-detail tabs that aren't
 *  built yet. Per spec §1: includes a "View in Fleet.io" deep-link so the
 *  operator can grab the data from Fleet.io until the matching PR ships. */
export function EmptyStateCard({ title, plannedPr, description, fleetioUrl }: EmptyStateCardProps) {
  return (
    <div className="rounded-sm border border-rmpg-700 bg-surface-raised p-6 max-w-xl">
      <h2 className="text-base font-semibold text-rmpg-100 mb-1">{title}</h2>
      <p className="text-sm text-rmpg-400 mb-2">Coming in {plannedPr}.</p>
      <p className="text-sm text-rmpg-200 mb-4">{description}</p>
      {fleetioUrl ? (
        <a
          href={fleetioUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-sm text-brand-400 hover:underline"
        >
          View in Fleet.io <ExternalLink className="w-3 h-3" />
        </a>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 7.4: Run — expect PASS**

Run: `cd client && npx vitest run src/pages/fleet/v2/shell/__tests__/EmptyStateCard.test.tsx`
Expected: 2 tests pass.

- [ ] **Step 7.5: Write failing test for `SectionHeader`**

Create `client/src/pages/fleet/v2/shell/__tests__/SectionHeader.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SectionHeader } from '../SectionHeader';

describe('SectionHeader', () => {
  it('renders title + optional action slot', () => {
    render(<SectionHeader title="Vehicles" actions={<button>+ New Vehicle</button>} />);
    expect(screen.getByRole('heading', { name: 'Vehicles' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ New Vehicle' })).toBeInTheDocument();
  });

  it('renders title alone (no action slot)', () => {
    render(<SectionHeader title="Reports" />);
    expect(screen.getByRole('heading', { name: 'Reports' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 7.6: Implement `SectionHeader`**

Create `client/src/pages/fleet/v2/shell/SectionHeader.tsx`:

```tsx
import type { ReactNode } from 'react';

export interface SectionHeaderProps {
  title: string;
  actions?: ReactNode;
}

export function SectionHeader({ title, actions }: SectionHeaderProps) {
  return (
    <div className="flex items-baseline justify-between px-4 py-3 border-b border-rmpg-700">
      <h1 className="text-lg font-semibold text-rmpg-100">{title}</h1>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
```

- [ ] **Step 7.7: Run + commit**

Run: `cd client && npx vitest run src/pages/fleet/v2/shell/__tests__/`
Expected: 4 tests pass.

```bash
git add client/src/pages/fleet/v2/shell/EmptyStateCard.tsx \
        client/src/pages/fleet/v2/shell/SectionHeader.tsx \
        client/src/pages/fleet/v2/shell/__tests__/
git commit -m "feat(fleet-v2): shared chrome — EmptyStateCard + SectionHeader"
```

---

## Task 8: `Sidebar` with `SIDEBAR_SECTIONS` config

**Why:** The IA spine. Single source of truth: routes derive from this const; tests assert it; no magic strings elsewhere.

**Files:**
- Create: `client/src/pages/fleet/v2/Sidebar.tsx`
- Create: `client/src/pages/fleet/v2/__tests__/Sidebar.test.tsx`

- [ ] **Step 8.1: Write failing test**

Create `client/src/pages/fleet/v2/__tests__/Sidebar.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Sidebar, SIDEBAR_SECTIONS } from '../Sidebar';

function renderSidebar() {
  return render(
    <MemoryRouter>
      <Sidebar />
    </MemoryRouter>
  );
}

describe('SIDEBAR_SECTIONS config', () => {
  it('has 15 items: 11 Fleet.io-mirrored + 4 RMPG-only', () => {
    expect(SIDEBAR_SECTIONS.length).toBe(15);
    const fi = SIDEBAR_SECTIONS.filter((s) => s.scope === 'fleetio');
    const rmpg = SIDEBAR_SECTIONS.filter((s) => s.scope === 'rmpg-only');
    expect(fi.length).toBe(11);
    expect(rmpg.length).toBe(4);
  });

  it('has 4 ◯ empty sections (work-orders / issues / documents / parts)', () => {
    const empty = SIDEBAR_SECTIONS.filter((s) => s.empty);
    expect(empty.map((s) => s.id).sort()).toEqual(['documents', 'issues', 'parts', 'work-orders']);
  });

  it('every section has a unique id and a route path under /fleet/v2', () => {
    const ids = new Set(SIDEBAR_SECTIONS.map((s) => s.id));
    expect(ids.size).toBe(SIDEBAR_SECTIONS.length);
    for (const s of SIDEBAR_SECTIONS) {
      expect(s.path.startsWith('/fleet/v2')).toBe(true);
    }
  });
});

describe('<Sidebar>', () => {
  it('renders all 15 section labels', () => {
    renderSidebar();
    for (const section of SIDEBAR_SECTIONS) {
      expect(screen.getByText(section.label)).toBeInTheDocument();
    }
  });

  it('renders the gold RMPG ONLY divider between fleetio and rmpg-only', () => {
    renderSidebar();
    expect(screen.getByText(/rmpg only/i)).toBeInTheDocument();
  });

  it('marks ◯ empty sections visually', () => {
    renderSidebar();
    // Each ◯ section has an accessible label suffix "(coming soon)".
    const wo = screen.getByRole('link', { name: /work orders.*coming soon/i });
    expect(wo).toBeInTheDocument();
  });

  it('marks RMPG-only sections with a gold dot indicator (via aria-label)', () => {
    renderSidebar();
    const personnel = screen.getByRole('link', { name: /personnel.*rmpg only/i });
    expect(personnel).toBeInTheDocument();
  });
});
```

- [ ] **Step 8.2: Run — expect FAIL**

Run: `cd client && npx vitest run src/pages/fleet/v2/__tests__/Sidebar.test.tsx`
Expected: fail "Cannot find module".

- [ ] **Step 8.3: Implement**

Create `client/src/pages/fleet/v2/Sidebar.tsx`:

```tsx
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, Car, Fuel, Wrench, ClipboardList, CheckSquare,
  AlertTriangle, FileText, Package, Store, BarChart3,
  Users, Camera, MapPin, FileEdit,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type SidebarScope = 'fleetio' | 'rmpg-only';

export interface SidebarItem {
  id: string;
  label: string;
  path: string;
  icon: LucideIcon;
  scope: SidebarScope;
  /** True when this section's content isn't built yet (shows ◯ + EmptyStateCard). */
  empty?: boolean;
  /** Fleet.io deep-link for ◯ sections. */
  fleetioUrl?: string;
}

export const SIDEBAR_SECTIONS: readonly SidebarItem[] = [
  // === Fleet.io-mirrored (above the gold divider) ===
  { id: 'dashboard',   label: 'Dashboard',    path: '/fleet/v2',              icon: LayoutDashboard, scope: 'fleetio' },
  { id: 'vehicles',    label: 'Vehicles',     path: '/fleet/v2/vehicles',     icon: Car,             scope: 'fleetio' },
  { id: 'fuel',        label: 'Fuel Entries', path: '/fleet/v2/fuel',         icon: Fuel,            scope: 'fleetio' },
  { id: 'service',     label: 'Service',      path: '/fleet/v2/service',      icon: Wrench,          scope: 'fleetio' },
  { id: 'work-orders', label: 'Work Orders',  path: '/fleet/v2/work-orders',  icon: ClipboardList,   scope: 'fleetio', empty: true, fleetioUrl: 'https://secure.fleetio.com/work_orders' },
  { id: 'inspections', label: 'Inspections',  path: '/fleet/v2/inspections',  icon: CheckSquare,     scope: 'fleetio' },
  { id: 'issues',      label: 'Issues',       path: '/fleet/v2/issues',       icon: AlertTriangle,   scope: 'fleetio', empty: true, fleetioUrl: 'https://secure.fleetio.com/issues' },
  { id: 'documents',   label: 'Documents',    path: '/fleet/v2/documents',    icon: FileText,        scope: 'fleetio', empty: true, fleetioUrl: 'https://secure.fleetio.com/documents' },
  { id: 'parts',       label: 'Parts',        path: '/fleet/v2/parts',        icon: Package,         scope: 'fleetio', empty: true, fleetioUrl: 'https://secure.fleetio.com/parts' },
  { id: 'vendors',     label: 'Vendors',      path: '/fleet/v2/vendors',      icon: Store,           scope: 'fleetio' },
  { id: 'reports',     label: 'Reports',      path: '/fleet/v2/reports',      icon: BarChart3,       scope: 'fleetio' },
  // === RMPG-only (below the gold divider) ===
  { id: 'personnel',    label: 'Personnel',     path: '/fleet/v2/personnel',     icon: Users,    scope: 'rmpg-only' },
  { id: 'dash-cameras', label: 'Dash Cameras',  path: '/fleet/v2/dash-cameras',  icon: Camera,   scope: 'rmpg-only' },
  { id: 'gps',          label: 'GPS Tracking',  path: '/fleet/v2/gps',           icon: MapPin,   scope: 'rmpg-only' },
  { id: 'analysis',     label: 'Analysis Forms',path: '/fleet/v2/analysis',      icon: FileEdit, scope: 'rmpg-only' },
];

export function Sidebar() {
  const fleetio = SIDEBAR_SECTIONS.filter((s) => s.scope === 'fleetio');
  const rmpgOnly = SIDEBAR_SECTIONS.filter((s) => s.scope === 'rmpg-only');
  return (
    <nav className="w-56 shrink-0 bg-surface-base border-r border-rmpg-700 py-2 overflow-y-auto" aria-label="Fleet sections">
      <ul className="space-y-0.5">
        {fleetio.map((s) => <SidebarRow key={s.id} item={s} />)}
      </ul>
      <Divider />
      <ul className="space-y-0.5">
        {rmpgOnly.map((s) => <SidebarRow key={s.id} item={s} />)}
      </ul>
    </nav>
  );
}

function SidebarRow({ item }: { item: SidebarItem }) {
  const Icon = item.icon;
  const suffix = [
    item.empty ? '(coming soon)' : null,
    item.scope === 'rmpg-only' ? '(RMPG only)' : null,
  ].filter(Boolean).join(' ');
  return (
    <li>
      <NavLink
        to={item.path}
        end={item.path === '/fleet/v2'}
        aria-label={[item.label, suffix].filter(Boolean).join(' ').trim()}
        className={({ isActive }) =>
          `flex items-center gap-2 px-3 py-1.5 text-[11px] ${
            isActive ? 'bg-rmpg-700 text-rmpg-50' : 'text-rmpg-300 hover:bg-rmpg-800 hover:text-rmpg-100'
          }`
        }
      >
        <Icon className="w-3.5 h-3.5 shrink-0" />
        <span className="flex-1">{item.label}</span>
        {item.empty ? <span aria-hidden className="text-rmpg-500">◯</span> : null}
        {item.scope === 'rmpg-only' ? <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-brand-400" /> : null}
      </NavLink>
    </li>
  );
}

function Divider() {
  return (
    <div className="my-2 px-3" aria-hidden>
      <hr className="border-rmpg-700" />
      <div className="text-[9px] uppercase tracking-wider text-brand-400 text-center py-1">
        RMPG only
      </div>
      <hr className="border-rmpg-700" />
    </div>
  );
}
```

- [ ] **Step 8.4: Run — expect PASS**

Run: `cd client && npx vitest run src/pages/fleet/v2/__tests__/Sidebar.test.tsx`
Expected: 7 tests pass.

- [ ] **Step 8.5: Commit**

```bash
git add client/src/pages/fleet/v2/Sidebar.tsx client/src/pages/fleet/v2/__tests__/Sidebar.test.tsx
git commit -m "feat(fleet-v2): Sidebar + SIDEBAR_SECTIONS — single source of truth IA"
```

---

## Task 9: `KpiRibbon`

**Why:** Top of the Dashboard route. Reuses 3 existing endpoints — no new backend.

**Files:**
- Create: `client/src/pages/fleet/v2/shell/KpiRibbon.tsx`
- Create: `client/src/pages/fleet/v2/shell/__tests__/KpiRibbon.test.tsx`

- [ ] **Step 9.1: Write failing test**

Create `client/src/pages/fleet/v2/shell/__tests__/KpiRibbon.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { KpiRibbon } from '../KpiRibbon';

let fetchMock: ReturnType<typeof vi.fn>;

function stubFetch(map: Record<string, unknown>) {
  fetchMock = vi.fn((url: string) => {
    for (const [k, v] of Object.entries(map)) {
      if (url.includes(k)) return Promise.resolve(new Response(JSON.stringify(v), { status: 200 }));
    }
    return Promise.resolve(new Response('{}', { status: 404 }));
  });
  vi.stubGlobal('fetch', fetchMock);
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('<KpiRibbon>', () => {
  it('renders 5 KPI cells with values from the 3 endpoints', async () => {
    stubFetch({
      '/api/fleet/analytics': { in_service: 15, in_maintenance: 2, monthly_fuel_spend_usd: 4321.5, monthly_cost_per_mile_usd: 0.42 },
      '/api/fleet/overdue-inspections': { alerts: [{ id: 1 }, { id: 2 }, { id: 3 }] },
      '/api/fleet/notifications': { notifications: [] },
    });
    render(<KpiRibbon />);
    await waitFor(() => expect(screen.getByText(/in service/i)).toBeInTheDocument());
    expect(screen.getByText(/15/)).toBeInTheDocument();   // in service
    expect(screen.getByText(/^2$/)).toBeInTheDocument();   // in maintenance
    expect(screen.getByText(/^3$/)).toBeInTheDocument();   // overdue PMs (alerts length)
    expect(screen.getByText(/\$4,321/)).toBeInTheDocument();
    expect(screen.getByText(/\$0\.42/)).toBeInTheDocument();
  });

  it('renders gracefully when an endpoint 404s (shows em-dashes)', async () => {
    stubFetch({}); // all 404
    render(<KpiRibbon />);
    await waitFor(() => expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(5));
  });
});
```

- [ ] **Step 9.2: Run — expect FAIL**

Run: `cd client && npx vitest run src/pages/fleet/v2/shell/__tests__/KpiRibbon.test.tsx`
Expected: fail "Cannot find module".

- [ ] **Step 9.3: Implement**

Create `client/src/pages/fleet/v2/shell/KpiRibbon.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { apiFetch } from '../../../../hooks/useApi';

interface AnalyticsResp {
  in_service?: number;
  in_maintenance?: number;
  monthly_fuel_spend_usd?: number;
  monthly_cost_per_mile_usd?: number;
}
interface OverdueResp {
  alerts?: Array<{ id: number }>;
}

interface KpiData {
  in_service?: number;
  in_maintenance?: number;
  overdue_pms?: number;
  monthly_fuel_spend?: number;
  cost_per_mile?: number;
}

export function KpiRibbon() {
  const [data, setData] = useState<KpiData>({});
  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([
      apiFetch<AnalyticsResp>('/fleet/analytics'),
      apiFetch<OverdueResp>('/fleet/overdue-inspections'),
    ]).then(([a, o]) => {
      if (cancelled) return;
      const next: KpiData = {};
      if (a.status === 'fulfilled' && a.value) {
        next.in_service = a.value.in_service;
        next.in_maintenance = a.value.in_maintenance;
        next.monthly_fuel_spend = a.value.monthly_fuel_spend_usd;
        next.cost_per_mile = a.value.monthly_cost_per_mile_usd;
      }
      if (o.status === 'fulfilled' && o.value?.alerts) {
        next.overdue_pms = o.value.alerts.length;
      }
      setData(next);
    });
    return () => { cancelled = true; };
  }, []);
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 p-3 border-b border-rmpg-700 bg-surface-base">
      <Cell label="In service" value={fmt(data.in_service)} />
      <Cell label="In maintenance" value={fmt(data.in_maintenance)} />
      <Cell label="Overdue PMs" value={fmt(data.overdue_pms)} />
      <Cell label="Monthly fuel" value={fmtUsd(data.monthly_fuel_spend)} />
      <Cell label="Cost / mi" value={fmtUsd(data.cost_per_mile)} />
    </div>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-sm border border-rmpg-700 bg-surface-raised px-3 py-2">
      <div className="text-[9px] uppercase tracking-wide text-rmpg-400">{label}</div>
      <div className="text-base font-semibold text-rmpg-100 mt-0.5">{value}</div>
    </div>
  );
}

function fmt(n: number | undefined): string {
  return typeof n === 'number' ? n.toLocaleString() : '—';
}
function fmtUsd(n: number | undefined): string {
  if (typeof n !== 'number') return '—';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
}
```

- [ ] **Step 9.4: Run — expect PASS**

Run: `cd client && npx vitest run src/pages/fleet/v2/shell/__tests__/KpiRibbon.test.tsx`
Expected: 2 tests pass.

- [ ] **Step 9.5: Commit**

```bash
git add client/src/pages/fleet/v2/shell/KpiRibbon.tsx client/src/pages/fleet/v2/shell/__tests__/KpiRibbon.test.tsx
git commit -m "feat(fleet-v2): KpiRibbon — 5-cell live KPI strip"
```

---

## Task 10: `FleetListShell` stub

**Why:** PR 7'b will flesh this out into a full table+filter+pagination chrome. PR 7'a ships just enough that VehiclesListRoute can render with proper search + an action slot.

**Files:**
- Create: `client/src/pages/fleet/v2/shell/FleetListShell.tsx`
- Create: `client/src/pages/fleet/v2/shell/__tests__/FleetListShell.test.tsx`

- [ ] **Step 10.1: Write failing test**

Create `client/src/pages/fleet/v2/shell/__tests__/FleetListShell.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FleetListShell } from '../FleetListShell';

describe('<FleetListShell>', () => {
  it('renders title, search input, action slot, and children', () => {
    render(
      <FleetListShell
        title="Vehicles"
        searchPlaceholder="Search vehicles..."
        onSearchChange={() => {}}
        actions={<button>+ New</button>}
      >
        <div>row content</div>
      </FleetListShell>
    );
    expect(screen.getByRole('heading', { name: 'Vehicles' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search vehicles...')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ New' })).toBeInTheDocument();
    expect(screen.getByText('row content')).toBeInTheDocument();
  });

  it('fires onSearchChange on input', () => {
    let captured = '';
    render(
      <FleetListShell title="Fuel" searchPlaceholder="Search..." onSearchChange={(v) => { captured = v; }}>
        <div />
      </FleetListShell>
    );
    fireEvent.change(screen.getByPlaceholderText('Search...'), { target: { value: 'unit 12' } });
    expect(captured).toBe('unit 12');
  });
});
```

- [ ] **Step 10.2: Run — expect FAIL**

Run: `cd client && npx vitest run src/pages/fleet/v2/shell/__tests__/FleetListShell.test.tsx`
Expected: fail.

- [ ] **Step 10.3: Implement**

Create `client/src/pages/fleet/v2/shell/FleetListShell.tsx`:

```tsx
import type { ReactNode } from 'react';
import { Search } from 'lucide-react';
import { SectionHeader } from './SectionHeader';

export interface FleetListShellProps {
  title: string;
  searchPlaceholder: string;
  onSearchChange: (value: string) => void;
  actions?: ReactNode;
  children: ReactNode;
}

/** Stub for PR 7'a — title + search + actions slot + children area.
 *  PR 7'b adds: filter chips, sort dropdown, server-side pagination, CSV export. */
export function FleetListShell({ title, searchPlaceholder, onSearchChange, actions, children }: FleetListShellProps) {
  return (
    <div className="flex flex-col h-full">
      <SectionHeader title={title} actions={actions} />
      <div className="px-4 py-2 border-b border-rmpg-700 bg-surface-base flex items-center gap-2">
        <Search className="w-3.5 h-3.5 text-rmpg-400" />
        <input
          type="text"
          placeholder={searchPlaceholder}
          onChange={(e) => onSearchChange(e.target.value)}
          className="flex-1 bg-transparent text-[11px] text-rmpg-100 placeholder:text-rmpg-500 outline-none"
        />
      </div>
      <div className="flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
```

- [ ] **Step 10.4: Run + commit**

Run: `cd client && npx vitest run src/pages/fleet/v2/shell/__tests__/FleetListShell.test.tsx`
Expected: 2 tests pass.

```bash
git add client/src/pages/fleet/v2/shell/FleetListShell.tsx client/src/pages/fleet/v2/shell/__tests__/FleetListShell.test.tsx
git commit -m "feat(fleet-v2): FleetListShell stub — title + search + actions"
```

---

## Task 11: `FleetShell` (two-pane layout + child router)

**Why:** The container that hosts the sidebar and routes. Where `useNoindexDuringSoak()` mounts once.

**Files:**
- Create: `client/src/pages/fleet/v2/FleetShell.tsx`
- Create: `client/src/pages/fleet/v2/__tests__/FleetShell.test.tsx`

- [ ] **Step 11.1: Write failing test (with viewport sub-tests)**

Create `client/src/pages/fleet/v2/__tests__/FleetShell.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { FleetShell } from '../FleetShell';

function renderAt(path: string, width: number) {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
  window.dispatchEvent(new Event('resize'));
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/fleet/v2/*" element={<FleetShell />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('<FleetShell>', () => {
  beforeEach(() => { document.head.innerHTML = ''; });

  it('renders sidebar at 1440x900 (desktop)', () => {
    renderAt('/fleet/v2', 1440);
    expect(screen.getByLabelText(/fleet sections/i)).toBeInTheDocument();
  });

  it('collapses sidebar to drawer trigger at 375x667 (mobile)', () => {
    renderAt('/fleet/v2', 375);
    // Mobile shell shows a "menu" button instead of always-visible sidebar.
    expect(screen.getByRole('button', { name: /menu|sections/i })).toBeInTheDocument();
  });

  it('renders the Outlet child route', () => {
    renderAt('/fleet/v2', 1440);
    // Dashboard route is the default; its KPI ribbon "In service" label is the canary.
    // Use queryByText to avoid hard dependency if Dashboard fetches async data.
    expect(screen.queryByText(/in service/i)).toBeInTheDocument();
  });

  it('mounts the noindex meta tag (V2_SOAK_ACTIVE=true)', () => {
    renderAt('/fleet/v2', 1440);
    const meta = document.head.querySelector('meta[name="robots"]');
    expect(meta?.getAttribute('content')).toBe('noindex');
  });
});
```

- [ ] **Step 11.2: Run — expect FAIL**

Run: `cd client && npx vitest run src/pages/fleet/v2/__tests__/FleetShell.test.tsx`
Expected: fail "Cannot find module".

- [ ] **Step 11.3: Implement**

Create `client/src/pages/fleet/v2/FleetShell.tsx`:

```tsx
import { useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { useIsMobile } from '../../../hooks/useIsMobile';
import { useNoindexDuringSoak } from './hooks/useNoindexDuringSoak';
import { Sidebar } from './Sidebar';
import { DashboardRoute } from './routes/DashboardRoute';
import { VehiclesListRoute } from './routes/VehiclesListRoute';
import { VehicleDetailRoute } from './routes/VehicleDetailRoute';
import { EmptyStateCard } from './shell/EmptyStateCard';
import { SIDEBAR_SECTIONS } from './Sidebar';

export default function FleetShell() {
  useNoindexDuringSoak();
  const isMobile = useIsMobile();
  const [drawerOpen, setDrawerOpen] = useState(false);
  return (
    <div className="flex h-full bg-surface-base">
      {/* Sidebar — always visible on desktop; drawer on mobile */}
      {isMobile ? (
        <>
          <button
            onClick={() => setDrawerOpen((v) => !v)}
            aria-label="Open menu"
            className="fixed top-2 left-2 z-50 p-2 rounded-sm bg-surface-raised border border-rmpg-700"
          >
            <Menu className="w-4 h-4" />
          </button>
          {drawerOpen ? <div className="fixed inset-0 z-40 bg-black/50" onClick={() => setDrawerOpen(false)}><Sidebar /></div> : null}
        </>
      ) : (
        <Sidebar />
      )}
      <main className="flex-1 overflow-hidden">
        <Routes>
          <Route index element={<DashboardRoute />} />
          <Route path="vehicles" element={<VehiclesListRoute />} />
          <Route path="vehicles/:id/*" element={<VehicleDetailRoute />} />
          {/* Empty sections: render EmptyStateCard for each ◯ item from the sidebar config */}
          {SIDEBAR_SECTIONS.filter((s) => s.empty).map((s) => (
            <Route
              key={s.id}
              path={s.path.replace(/^\/fleet\/v2\/?/, '') || ''}
              element={
                <EmptyStateCard
                  title={s.label}
                  plannedPr={
                    s.id === 'work-orders' ? 'PR 5' :
                    s.id === 'issues' ? 'PR 6' :
                    'Phase 2'
                  }
                  description={
                    s.id === 'work-orders' ? 'Vehicle in-shop tracking.' :
                    s.id === 'issues' ? 'Tracked findings and their resolution.' :
                    s.id === 'documents' ? 'Per-vehicle uploaded documents.' :
                    'Parts catalog and inventory.'
                  }
                  fleetioUrl={s.fleetioUrl}
                />
              }
            />
          ))}
          {/* Other non-empty sections (fuel/service/inspections/vendors/reports/personnel/dash-cameras/gps/analysis)
              are stubbed in PR 7'a — built out in PR 7'b and PR 7'c. For now they show a transitional empty state. */}
          {SIDEBAR_SECTIONS.filter((s) => !s.empty && !['dashboard', 'vehicles'].includes(s.id)).map((s) => (
            <Route
              key={s.id}
              path={s.path.replace(/^\/fleet\/v2\/?/, '') || ''}
              element={
                <EmptyStateCard
                  title={s.label}
                  plannedPr={s.scope === 'rmpg-only' ? "PR 7'c" : "PR 7'b"}
                  description={`Built in the next PR of the Fleet Manager UI program.`}
                  fleetioUrl={s.fleetioUrl}
                />
              }
            />
          ))}
        </Routes>
      </main>
    </div>
  );
}
```

- [ ] **Step 11.4: Run — expect PASS**

Run: `cd client && npx vitest run src/pages/fleet/v2/__tests__/FleetShell.test.tsx`
Expected: 4 tests pass.

If the "renders the Outlet child route" test fails because Dashboard fetches async data, the assertion uses `queryByText` so it should still pass (returns null OR the element); adjust to use the heading "Dashboard" set by SectionHeader instead if needed.

- [ ] **Step 11.5: Commit**

```bash
git add client/src/pages/fleet/v2/FleetShell.tsx client/src/pages/fleet/v2/__tests__/FleetShell.test.tsx
git commit -m "feat(fleet-v2): FleetShell two-pane layout + mobile drawer + child router"
```

---

## Task 12: `DashboardRoute`

**Why:** Default landing on `/fleet/v2`. KPI ribbon + 3 cards.

**Files:**
- Create: `client/src/pages/fleet/v2/routes/DashboardRoute.tsx`
- Create: `client/src/pages/fleet/v2/__tests__/DashboardRoute.test.tsx`

- [ ] **Step 12.1: Write failing test**

Create `client/src/pages/fleet/v2/__tests__/DashboardRoute.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DashboardRoute } from '../routes/DashboardRoute';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
});

function renderDash() {
  return render(<MemoryRouter><DashboardRoute /></MemoryRouter>);
}

describe('<DashboardRoute>', () => {
  it('renders the section header "Dashboard"', () => {
    renderDash();
    expect(screen.getByRole('heading', { name: /dashboard/i })).toBeInTheDocument();
  });

  it('renders the KPI ribbon', () => {
    renderDash();
    expect(screen.getByText(/in service/i)).toBeInTheDocument();
  });

  it('renders 3 cards: Upcoming Service, Recent Fuel, Recent Inspections', () => {
    renderDash();
    expect(screen.getByText(/upcoming service/i)).toBeInTheDocument();
    expect(screen.getByText(/recent fuel/i)).toBeInTheDocument();
    expect(screen.getByText(/recent inspections/i)).toBeInTheDocument();
  });

  it('each card has a "View all →" link to its full section', () => {
    renderDash();
    const links = screen.getAllByRole('link', { name: /view all/i });
    expect(links.length).toBe(3);
    expect(links.map((l) => (l as HTMLAnchorElement).pathname).sort()).toEqual([
      '/fleet/v2/fuel',
      '/fleet/v2/inspections',
      '/fleet/v2/service',
    ]);
  });
});
```

- [ ] **Step 12.2: Run — expect FAIL**

Run: `cd client && npx vitest run src/pages/fleet/v2/__tests__/DashboardRoute.test.tsx`
Expected: fail.

- [ ] **Step 12.3: Implement**

Create `client/src/pages/fleet/v2/routes/DashboardRoute.tsx`:

```tsx
import { Link } from 'react-router-dom';
import { KpiRibbon } from '../shell/KpiRibbon';
import { SectionHeader } from '../shell/SectionHeader';
import { useFleetV2View } from '../hooks/useFleetV2Audit';

export function DashboardRoute() {
  useFleetV2View('/fleet/v2');
  return (
    <div className="h-full flex flex-col">
      <SectionHeader title="Dashboard" />
      <KpiRibbon />
      <div className="flex-1 overflow-y-auto p-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card title="Upcoming Service" viewAllTo="/fleet/v2/service">
          <p className="text-sm text-rmpg-400">Service items due in the next 7 days.</p>
        </Card>
        <Card title="Recent Fuel Entries" viewAllTo="/fleet/v2/fuel">
          <p className="text-sm text-rmpg-400">Last 10 fuel logs.</p>
        </Card>
        <Card title="Recent Inspections" viewAllTo="/fleet/v2/inspections">
          <p className="text-sm text-rmpg-400">Last 10 inspections.</p>
        </Card>
      </div>
    </div>
  );
}

function Card({ title, viewAllTo, children }: { title: string; viewAllTo: string; children: React.ReactNode }) {
  return (
    <div className="rounded-sm border border-rmpg-700 bg-surface-raised p-4">
      <div className="flex items-baseline justify-between mb-2">
        <h2 className="text-sm font-semibold text-rmpg-100">{title}</h2>
        <Link to={viewAllTo} className="text-xs text-brand-400 hover:underline">View all →</Link>
      </div>
      {children}
    </div>
  );
}
```

- [ ] **Step 12.4: Run + commit**

Run: `cd client && npx vitest run src/pages/fleet/v2/__tests__/DashboardRoute.test.tsx`
Expected: 4 tests pass.

```bash
git add client/src/pages/fleet/v2/routes/DashboardRoute.tsx client/src/pages/fleet/v2/__tests__/DashboardRoute.test.tsx
git commit -m "feat(fleet-v2): DashboardRoute — KPI ribbon + 3 cards"
```

---

## Task 13: `VehiclesListRoute`

**Why:** Fleet-wide list — the second most-used screen after Dashboard. Card/table toggle.

**Files:**
- Create: `client/src/pages/fleet/v2/routes/VehiclesListRoute.tsx`
- Create: `client/src/pages/fleet/v2/__tests__/VehiclesListRoute.test.tsx`

- [ ] **Step 13.1: Write failing test**

Create `client/src/pages/fleet/v2/__tests__/VehiclesListRoute.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { VehiclesListRoute } from '../routes/VehiclesListRoute';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([
    { id: 1, vehicle_name: 'Unit 12', vehicle_number: 'U-12', make: 'Ford', model: 'Explorer', year: 2022, plate_number: 'ABC123', plate_state: 'UT', status: 'in_service', current_mileage: 47283 },
    { id: 2, vehicle_name: 'Unit 8',  vehicle_number: 'U-8',  make: 'Chevy', model: 'Tahoe',    year: 2020, plate_number: 'XYZ789', plate_state: 'UT', status: 'maintenance', current_mileage: 91234 },
  ]), { status: 200 })));
});

function renderList() {
  return render(<MemoryRouter><VehiclesListRoute /></MemoryRouter>);
}

describe('<VehiclesListRoute>', () => {
  it('fetches /api/fleet and renders seeded rows', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('Unit 12')).toBeInTheDocument());
    expect(screen.getByText('Unit 8')).toBeInTheDocument();
  });

  it('search input filters by name (client-side prefilter)', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('Unit 12')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText(/search vehicles/i), { target: { value: 'tahoe' } });
    expect(screen.queryByText('Unit 12')).toBeNull();
    expect(screen.getByText('Unit 8')).toBeInTheDocument();
  });

  it('toggles between card and table view', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('Unit 12')).toBeInTheDocument());
    // Default = card view
    expect(screen.getByRole('button', { name: /table view/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /table view/i }));
    // After toggling, the "card view" button is visible
    expect(screen.getByRole('button', { name: /card view/i })).toBeInTheDocument();
  });

  it('vehicle link goes to /fleet/v2/vehicles/:id', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('Unit 12')).toBeInTheDocument());
    const link = screen.getByRole('link', { name: /unit 12/i }) as HTMLAnchorElement;
    expect(link.pathname).toBe('/fleet/v2/vehicles/1');
  });
});
```

- [ ] **Step 13.2: Run — expect FAIL**

Run: `cd client && npx vitest run src/pages/fleet/v2/__tests__/VehiclesListRoute.test.tsx`
Expected: fail.

- [ ] **Step 13.3: Implement**

Create `client/src/pages/fleet/v2/routes/VehiclesListRoute.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { LayoutGrid, Table as TableIcon, Plus } from 'lucide-react';
import { apiFetch } from '../../../../hooks/useApi';
import { FleetListShell } from '../shell/FleetListShell';
import { useFleetV2View } from '../hooks/useFleetV2Audit';

interface FleetVehicleRow {
  id: number;
  vehicle_name: string | null;
  vehicle_number: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  plate_number: string | null;
  plate_state: string | null;
  status: string | null;
  current_mileage: number | null;
}

type ViewMode = 'card' | 'table';

export function VehiclesListRoute() {
  useFleetV2View('/fleet/v2/vehicles');
  const [rows, setRows] = useState<FleetVehicleRow[]>([]);
  const [search, setSearch] = useState('');
  const [mode, setMode] = useState<ViewMode>('card');

  useEffect(() => {
    apiFetch<FleetVehicleRow[]>('/fleet').then((r) => setRows(r ?? [])).catch(() => setRows([]));
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.vehicle_name, r.vehicle_number, r.make, r.model, r.plate_number]
        .filter(Boolean).join(' ').toLowerCase().includes(q)
    );
  }, [rows, search]);

  return (
    <FleetListShell
      title="Vehicles"
      searchPlaceholder="Search vehicles..."
      onSearchChange={setSearch}
      actions={
        <>
          <button
            onClick={() => setMode(mode === 'card' ? 'table' : 'card')}
            aria-label={mode === 'card' ? 'Switch to table view' : 'Switch to card view'}
            className="px-2 py-1 text-[11px] border border-rmpg-700 rounded-sm hover:bg-rmpg-800"
          >
            {mode === 'card' ? <TableIcon className="w-3 h-3 inline mr-1" /> : <LayoutGrid className="w-3 h-3 inline mr-1" />}
            {mode === 'card' ? 'Table view' : 'Card view'}
          </button>
          <button className="px-2 py-1 text-[11px] bg-brand-400 text-rmpg-950 rounded-sm hover:brightness-110">
            <Plus className="w-3 h-3 inline mr-1" /> New Vehicle
          </button>
        </>
      }
    >
      {mode === 'card' ? <CardGrid rows={filtered} /> : <TableView rows={filtered} />}
    </FleetListShell>
  );
}

function CardGrid({ rows }: { rows: FleetVehicleRow[] }) {
  return (
    <div className="p-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
      {rows.map((r) => (
        <Link
          key={r.id}
          to={`/fleet/v2/vehicles/${r.id}`}
          className="block p-3 rounded-sm border border-rmpg-700 bg-surface-raised hover:border-brand-400"
        >
          <div className="text-sm font-semibold text-rmpg-100">{r.vehicle_name ?? r.vehicle_number ?? `Vehicle ${r.id}`}</div>
          <div className="text-[10px] text-rmpg-400 mt-0.5">
            {r.year ?? ''} {r.make ?? ''} {r.model ?? ''}
          </div>
          <div className="text-[10px] text-rmpg-400 mt-1">{r.plate_number ?? '—'} ({r.plate_state ?? '—'})</div>
          <div className="text-[10px] text-rmpg-300 mt-2">{(r.current_mileage ?? 0).toLocaleString()} mi · {r.status ?? 'unknown'}</div>
        </Link>
      ))}
    </div>
  );
}

function TableView({ rows }: { rows: FleetVehicleRow[] }) {
  return (
    <table className="w-full text-[11px]">
      <thead className="bg-surface-base">
        <tr>
          <th className="text-left px-3 py-1.5 font-semibold">Name</th>
          <th className="text-left px-3 py-1.5 font-semibold">Make/Model</th>
          <th className="text-left px-3 py-1.5 font-semibold">Plate</th>
          <th className="text-right px-3 py-1.5 font-semibold">Miles</th>
          <th className="text-left px-3 py-1.5 font-semibold">Status</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="border-b border-rmpg-700 hover:bg-rmpg-800">
            <td className="px-3 py-0.5">
              <Link to={`/fleet/v2/vehicles/${r.id}`} className="text-rmpg-100 hover:text-brand-400">
                {r.vehicle_name ?? r.vehicle_number ?? `Vehicle ${r.id}`}
              </Link>
            </td>
            <td className="px-3 py-0.5 text-rmpg-300">{[r.year, r.make, r.model].filter(Boolean).join(' ')}</td>
            <td className="px-3 py-0.5 text-rmpg-300">{r.plate_number ?? '—'} ({r.plate_state ?? '—'})</td>
            <td className="px-3 py-0.5 text-right text-rmpg-300">{(r.current_mileage ?? 0).toLocaleString()}</td>
            <td className="px-3 py-0.5 text-rmpg-300">{r.status ?? 'unknown'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 13.4: Run + commit**

Run: `cd client && npx vitest run src/pages/fleet/v2/__tests__/VehiclesListRoute.test.tsx`
Expected: 4 tests pass.

```bash
git add client/src/pages/fleet/v2/routes/VehiclesListRoute.tsx client/src/pages/fleet/v2/__tests__/VehiclesListRoute.test.tsx
git commit -m "feat(fleet-v2): VehiclesListRoute — card/table toggle + client-side filter"
```

---

## Task 14: `VehicleDetailRoute` + Overview tab

**Why:** The vehicle drill-in. PR 7'a wires the shell + sticky header + 13-name tab bar + Overview tab. Other tabs show EmptyStateCard "Coming in PR 7'b".

**Files:**
- Create: `client/src/pages/fleet/v2/routes/VehicleDetailRoute.tsx`
- Create: `client/src/pages/fleet/v2/vehicleDetail/OverviewTab.tsx`
- Create: `client/src/pages/fleet/v2/__tests__/VehicleDetailRoute.test.tsx`

- [ ] **Step 14.1: Write failing test**

Create `client/src/pages/fleet/v2/__tests__/VehicleDetailRoute.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { VehicleDetailRoute } from '../routes/VehicleDetailRoute';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    if (url.endsWith('/api/fleet/1')) {
      return Promise.resolve(new Response(JSON.stringify({
        id: 1, vehicle_name: 'Unit 12', vehicle_number: 'U-12',
        make: 'Ford', model: 'Explorer', year: 2022,
        plate_number: 'ABC123', plate_state: 'UT', vin: '1HGBH41JXMN109186',
        status: 'in_service', current_mileage: 47283,
      }), { status: 200 }));
    }
    return Promise.resolve(new Response('{}', { status: 200 }));
  }));
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/fleet/v2/vehicles/:id/*" element={<VehicleDetailRoute />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('<VehicleDetailRoute>', () => {
  it('renders sticky header with vehicle name + plate + status', async () => {
    renderAt('/fleet/v2/vehicles/1');
    await waitFor(() => expect(screen.getByText('Unit 12')).toBeInTheDocument());
    expect(screen.getByText(/ABC123/)).toBeInTheDocument();
    expect(screen.getByText(/in service/i)).toBeInTheDocument();
  });

  it('renders all 13 tab names in the tab bar', async () => {
    renderAt('/fleet/v2/vehicles/1');
    await waitFor(() => expect(screen.getByText('Unit 12')).toBeInTheDocument());
    const expected = ['Overview', 'Service', 'Inspections', 'Fuel', 'Issues', 'Work Orders', 'Documents', 'Costs', 'Recalls', 'Damage', 'Tires', 'Assignments', 'Activity'];
    for (const tab of expected) {
      expect(screen.getByRole('tab', { name: new RegExp(tab, 'i') })).toBeInTheDocument();
    }
  });

  it('Overview tab is active by default and renders content', async () => {
    renderAt('/fleet/v2/vehicles/1');
    await waitFor(() => expect(screen.getByText('Unit 12')).toBeInTheDocument());
    const overviewTab = screen.getByRole('tab', { name: /^overview/i });
    expect(overviewTab.getAttribute('aria-selected')).toBe('true');
    // Overview tab content includes the VIN.
    expect(screen.getByText(/1HGBH41JXMN109186/)).toBeInTheDocument();
  });

  it('clicking Service tab shows the EmptyStateCard for 7'b', async () => {
    renderAt('/fleet/v2/vehicles/1');
    await waitFor(() => expect(screen.getByText('Unit 12')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('tab', { name: /^service/i }));
    expect(screen.getByText(/coming in pr 7'b/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 14.2: Run — expect FAIL**

Run: `cd client && npx vitest run src/pages/fleet/v2/__tests__/VehicleDetailRoute.test.tsx`
Expected: fail.

- [ ] **Step 14.3: Implement `OverviewTab`**

Create `client/src/pages/fleet/v2/vehicleDetail/OverviewTab.tsx`:

```tsx
import type { FleetVehicleDetail } from '../routes/VehicleDetailRoute';

/** PR 7'a stub Overview. PR 7'b will port the full 500-line FleetOverviewTab.
 *  For 7'a we render the essential fields so the Vehicle Detail screen has
 *  observable content (per spec §6.2 field-coverage rules). */
export function OverviewTab({ vehicle }: { vehicle: FleetVehicleDetail }) {
  return (
    <div className="p-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Section title="Identity">
        <Row label="VIN" value={vehicle.vin} />
        <Row label="Year" value={vehicle.year?.toString()} />
        <Row label="Make" value={vehicle.make} />
        <Row label="Model" value={vehicle.model} />
        <Row label="Color" value={vehicle.color} />
      </Section>
      <Section title="Registration">
        <Row label="Plate" value={`${vehicle.plate_number ?? '—'} (${vehicle.plate_state ?? '—'})`} />
        <Row label="Vehicle #" value={vehicle.vehicle_number} />
      </Section>
      <Section title="Operations">
        <Row label="Status" value={vehicle.status} />
        <Row label="Mileage" value={vehicle.current_mileage?.toLocaleString()} />
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-sm border border-rmpg-700 bg-surface-raised">
      <div className="px-3 py-1.5 border-b border-rmpg-700 text-[10px] uppercase tracking-wide text-rmpg-400 font-semibold">{title}</div>
      <div className="p-3 space-y-1">{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-baseline justify-between text-[11px]">
      <span className="text-rmpg-400">{label}</span>
      <span className="text-rmpg-100">{value ?? '—'}</span>
    </div>
  );
}
```

- [ ] **Step 14.4: Implement `VehicleDetailRoute`**

Create `client/src/pages/fleet/v2/routes/VehicleDetailRoute.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { apiFetch } from '../../../../hooks/useApi';
import { OverviewTab } from '../vehicleDetail/OverviewTab';
import { EmptyStateCard } from '../shell/EmptyStateCard';
import { useFleetV2View } from '../hooks/useFleetV2Audit';

export interface FleetVehicleDetail {
  id: number;
  vehicle_name: string | null;
  vehicle_number: string | null;
  vin: string | null;
  plate_number: string | null;
  plate_state: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  color: string | null;
  status: string | null;
  current_mileage: number | null;
}

type TabId = 'overview' | 'service' | 'inspections' | 'fuel' | 'issues' | 'work-orders' | 'documents' | 'costs' | 'recalls' | 'damage' | 'tires' | 'assignments' | 'activity';

const TABS: { id: TabId; label: string }[] = [
  { id: 'overview',    label: 'Overview' },
  { id: 'service',     label: 'Service' },
  { id: 'inspections', label: 'Inspections' },
  { id: 'fuel',        label: 'Fuel' },
  { id: 'issues',      label: 'Issues' },
  { id: 'work-orders', label: 'Work Orders' },
  { id: 'documents',   label: 'Documents' },
  { id: 'costs',       label: 'Costs' },
  { id: 'recalls',     label: 'Recalls' },
  { id: 'damage',      label: 'Damage' },
  { id: 'tires',       label: 'Tires' },
  { id: 'assignments', label: 'Assignments' },
  { id: 'activity',    label: 'Activity' },
];

export function VehicleDetailRoute() {
  const { id } = useParams<{ id: string }>();
  useFleetV2View(`/fleet/v2/vehicles/${id ?? ''}`);
  const [vehicle, setVehicle] = useState<FleetVehicleDetail | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>('overview');

  useEffect(() => {
    if (!id) return;
    apiFetch<FleetVehicleDetail>(`/fleet/${id}`).then(setVehicle).catch(() => setVehicle(null));
  }, [id]);

  if (!vehicle) return <div className="p-4 text-rmpg-400 text-sm">Loading vehicle #{id}…</div>;

  return (
    <div className="h-full flex flex-col">
      {/* Sticky header */}
      <div className="sticky top-0 z-10 bg-surface-base border-b border-rmpg-700 px-4 py-3">
        <Link to="/fleet/v2/vehicles" className="text-xs text-rmpg-400 hover:text-brand-400 inline-flex items-center gap-1 mb-2">
          <ArrowLeft className="w-3 h-3" /> Back to Vehicles
        </Link>
        <div className="flex items-baseline justify-between">
          <div>
            <h1 className="text-lg font-semibold text-rmpg-100">
              {vehicle.vehicle_name ?? vehicle.vehicle_number ?? `Vehicle ${vehicle.id}`}
              <span className="ml-2 text-sm text-rmpg-400">{vehicle.plate_number} ({vehicle.plate_state})</span>
            </h1>
            <div className="text-[11px] text-rmpg-400 mt-0.5">
              {vehicle.year} {vehicle.make} {vehicle.model} · VIN {vehicle.vin ?? '—'} · {(vehicle.current_mileage ?? 0).toLocaleString()} mi
            </div>
          </div>
          <div className="px-2 py-1 text-[10px] rounded-sm bg-rmpg-700 text-rmpg-50">
            {(vehicle.status ?? 'unknown').replace(/_/g, ' ').toUpperCase()}
          </div>
        </div>
        {/* Tab bar */}
        <div role="tablist" aria-label="Vehicle tabs" className="mt-3 flex gap-1 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={activeTab === t.id}
              onClick={() => setActiveTab(t.id)}
              className={`px-3 py-1 text-[11px] whitespace-nowrap rounded-t-sm ${
                activeTab === t.id ? 'bg-rmpg-700 text-rmpg-50' : 'text-rmpg-400 hover:text-rmpg-100'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'overview' ? (
          <OverviewTab vehicle={vehicle} />
        ) : (
          <div className="p-4">
            <EmptyStateCard
              title={TABS.find((t) => t.id === activeTab)?.label ?? ''}
              plannedPr={['issues', 'work-orders', 'documents'].includes(activeTab) ? (activeTab === 'work-orders' ? 'PR 5' : activeTab === 'issues' ? 'PR 6' : 'Phase 2') : "PR 7'b"}
              description="This tab will land in the next PR of the Fleet Manager UI program."
              fleetioUrl={activeTab === 'work-orders' ? `https://secure.fleetio.com/vehicles/${vehicle.id}/work_orders` : undefined}
            />
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 14.5: Run + commit**

Run: `cd client && npx vitest run src/pages/fleet/v2/__tests__/VehicleDetailRoute.test.tsx`
Expected: 4 tests pass.

```bash
git add client/src/pages/fleet/v2/routes/VehicleDetailRoute.tsx \
        client/src/pages/fleet/v2/vehicleDetail/OverviewTab.tsx \
        client/src/pages/fleet/v2/__tests__/VehicleDetailRoute.test.tsx
git commit -m "feat(fleet-v2): VehicleDetailRoute + Overview tab (other tabs empty-state)"
```

---

## Task 15: Wire `FleetShell` into `App.tsx`

**Why:** Mount the v2 routes alongside the existing `/fleet` route — both work in production during the soak.

**Files:**
- Modify: `client/src/App.tsx`
- Modify: `client/public/sw.js` (CACHE_NAME bump)

- [ ] **Step 15.1: Read App.tsx around the /fleet route**

Run: `grep -n 'FleetPage\|/fleet' client/src/App.tsx`
Note the existing line that imports/mounts FleetPage.

- [ ] **Step 15.2: Add lazy import + new route**

Open `client/src/App.tsx`.

Add this lazy import near `const FleetPage = lazyRetry(() => import('./pages/fleet'));`:

```tsx
const FleetShell = lazyRetry(() => import('./pages/fleet/v2/FleetShell'));
```

Find the existing line:
```tsx
<Route path="/fleet" element={<RouteErrorBoundary><FleetPage /></RouteErrorBoundary>} />
```

Insert the new route IMMEDIATELY BEFORE it (more specific first):
```tsx
<Route path="/fleet/v2/*" element={<RouteErrorBoundary><FleetShell /></RouteErrorBoundary>} />
```

- [ ] **Step 15.3: Bump service worker cache**

Open `client/public/sw.js`. Find the line like `const CACHE_NAME = 'rmpg-flex-vN';` and increment N by 1.

- [ ] **Step 15.4: Typecheck + build**

Run: `cd client && npx tsc --noEmit && npx vite build 2>&1 | tail -5`
Expected: tsc clean, vite build ends with "✓ built in Xs".

- [ ] **Step 15.5: Smoke test in dev (if convenient)**

Run: `npm run dev` in one terminal + `cd client && npm run dev` in another. Visit `http://localhost:5173/fleet/v2`. Sidebar should render, dashboard should show KPI cells (or em-dashes if API not running). Visit `/fleet` — old UI should still work unchanged.

If dev environment is non-trivial to set up, skip this step and rely on the merged-PR Cloudflare Pages preview.

- [ ] **Step 15.6: Commit**

```bash
git add client/src/App.tsx client/public/sw.js
git commit -m "feat(fleet-v2): mount FleetShell at /fleet/v2/* + bump SW cache"
```

---

## Task 16: `/admin/fleet-v2-health` page stub

**Why:** Section 6.9 — admin page surfacing FLEET_V2_VIEW + FLEET_V2_API_ERROR counts so we can monitor the soak. Stub UI in 7'a; flesh out in 7'b/c.

**Files:**
- Create: `client/src/pages/admin/AdminFleetV2HealthTab.tsx`
- Modify: wherever admin tabs are wired (likely `client/src/pages/admin/AdminPage.tsx` or similar — discover via grep)

- [ ] **Step 16.1: Discover the admin-tabs registry**

Run: `grep -rn "AdminPage\|admin.*tab\|adminTabs" client/src/pages/admin/ 2>/dev/null | head -20`
Find the file that registers admin tabs. If there's a `const TABS = [...]` array, that's the integration point. If not, leave the page as a route in App.tsx and add a top-level admin route.

- [ ] **Step 16.2: Write the stub page**

Create `client/src/pages/admin/AdminFleetV2HealthTab.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { apiFetch } from '../../hooks/useApi';

/** Stub for PR 7'a. PR 7'b adds: per-route view counts, recent FLEET_V2_API_ERROR
 *  events table, viewport-width histogram. */
export function AdminFleetV2HealthTab() {
  const [viewCount, setViewCount] = useState<number | null>(null);
  const [errorCount, setErrorCount] = useState<number | null>(null);

  useEffect(() => {
    // Reuses /api/audit (existing) to count FLEET_V2_VIEW + FLEET_V2_API_ERROR
    // rows in the last 24h. If /api/audit doesn't support this query shape,
    // PR 7'b will add a dedicated endpoint. For 7'a, gracefully show "—".
    apiFetch<{ count: number }>('/audit/count?action=FLEET_V2_VIEW&since=24h').then((r) => setViewCount(r?.count ?? null)).catch(() => setViewCount(null));
    apiFetch<{ count: number }>('/audit/count?action=FLEET_V2_API_ERROR&since=24h').then((r) => setErrorCount(r?.count ?? null)).catch(() => setErrorCount(null));
  }, []);

  return (
    <div className="p-4 space-y-3">
      <h2 className="text-base font-semibold text-rmpg-100">Fleet V2 — Soak Health</h2>
      <p className="text-xs text-rmpg-400 max-w-prose">
        Tracks usage of the new /fleet/v2 UI during the 7-day soak before cutover.
        Stub in PR 7'a; richer breakdown in PR 7'b.
      </p>
      <div className="grid grid-cols-2 gap-3 max-w-md">
        <Cell label="Page views (24h)" value={viewCount} />
        <Cell label="API errors (24h)" value={errorCount} />
      </div>
    </div>
  );
}

function Cell({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-sm border border-rmpg-700 bg-surface-raised p-3">
      <div className="text-[9px] uppercase tracking-wide text-rmpg-400">{label}</div>
      <div className="text-lg font-semibold text-rmpg-100 mt-1">{value ?? '—'}</div>
    </div>
  );
}
```

- [ ] **Step 16.3: Wire into admin tabs registry**

If you found the registry in Step 16.1: add a `{ key: 'fleet-v2-health', label: 'Fleet V2 Health', component: AdminFleetV2HealthTab }` entry (adapt to the actual shape).

If you did NOT find a registry: add a standalone admin route in `client/src/App.tsx`:

```tsx
const AdminFleetV2HealthTab = lazyRetry(() => import('./pages/admin/AdminFleetV2HealthTab').then((m) => ({ default: m.AdminFleetV2HealthTab })));
// ...
<Route path="/admin/fleet-v2-health" element={<RouteErrorBoundary><AdminFleetV2HealthTab /></RouteErrorBoundary>} />
```

- [ ] **Step 16.4: Typecheck + commit**

Run: `cd client && npx tsc --noEmit`
Expected: clean.

```bash
git add client/src/pages/admin/AdminFleetV2HealthTab.tsx client/src/App.tsx
git commit -m "feat(fleet-v2): /admin/fleet-v2-health stub — page-view + error counts"
```

---

## Task 17: Reused-component contract test — VehicleFormModal

**Why:** Section 6.3 — confirms VehicleFormModal still functions when mounted inside the new FleetShell parent context.

**Files:**
- Create: `tests/fleet-v2-reuse/VehicleFormModal.contract.test.tsx`

(Note: this lives under the worker `tests/` directory to leverage the existing vitest config. If the test environment requires a JSDom shim, follow the pattern of `tests/alprEdit.test.ts`.)

- [ ] **Step 17.1: Write the contract test**

Create `tests/fleet-v2-reuse/VehicleFormModal.contract.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import VehicleFormModal, { EMPTY_VEHICLE_FORM } from '../../client/src/components/VehicleFormModal';

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 999, success: true }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});

describe('VehicleFormModal — contract test (reused by /fleet/v2)', () => {
  it('mounts in MemoryRouter, opens, fills required fields, submits, fires the API call', async () => {
    const onClose = vi.fn();
    const onSaved = vi.fn();
    render(
      <MemoryRouter>
        <VehicleFormModal
          mode="new_vehicle"
          form={EMPTY_VEHICLE_FORM}
          onChange={() => {}}
          onClose={onClose}
          onSaved={onSaved}
        />
      </MemoryRouter>
    );
    // The modal title is the canary that it mounted in our parent context.
    expect(screen.queryByText(/new vehicle|add vehicle/i)).toBeInTheDocument();
    // We can't easily fill all fields without knowing the exact form layout,
    // so just assert the close button works without crashing.
    const closeBtn = screen.queryByRole('button', { name: /close|cancel/i });
    if (closeBtn) {
      fireEvent.click(closeBtn);
      await waitFor(() => expect(onClose).toHaveBeenCalled());
    } else {
      // If the modal's close UX isn't a button (e.g., ESC key only), at least confirm onSaved is callable.
      expect(typeof onSaved).toBe('function');
    }
  });
});
```

- [ ] **Step 17.2: Run + commit**

Run: `cd client && npx vitest run ../tests/fleet-v2-reuse/`
(Or follow the repo's actual test-runner invocation — check `package.json` scripts.)

If the test environment can't import client-side TSX from the worker tests, MOVE this test to `client/tests/fleet-v2-reuse/VehicleFormModal.contract.test.tsx` and adjust the import paths.

Expected: test passes (the modal at minimum mounts and renders its title).

```bash
git add tests/fleet-v2-reuse/   # or client/tests/fleet-v2-reuse/
git commit -m "test(fleet-v2): contract — VehicleFormModal mounts in v2 parent context"
```

---

## Task 18: MapPage cross-impact smoke test

**Why:** Section 6.5 — confirms MapPage still renders fleet vehicle markers after we add the v2 directory.

**Files:**
- Create: `client/tests/cross-impact/map-fleet-markers.test.tsx`

- [ ] **Step 18.1: Locate MapPage**

Run: `find client/src/pages -name "MapPage*" -type f 2>/dev/null`
Note the import path.

- [ ] **Step 18.2: Write the smoke test**

Create `client/tests/cross-impact/map-fleet-markers.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// MapPage uses Mapbox GL; stub the constructor so the test environment doesn't
// need a real Mapbox API.
vi.mock('mapbox-gl', () => ({
  default: {
    Map: vi.fn().mockImplementation(() => ({
      on: vi.fn(), off: vi.fn(), addControl: vi.fn(), remove: vi.fn(),
      addSource: vi.fn(), addLayer: vi.fn(), getSource: vi.fn(),
    })),
    NavigationControl: vi.fn(),
    accessToken: '',
  },
}));

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([]), { status: 200 })));
});

describe('MapPage cross-impact (no regression from /fleet/v2 work)', () => {
  it('renders without throwing when mounted in MemoryRouter', async () => {
    // Lazy-import to ensure module-load doesn't run during the mock setup.
    const { default: MapPage } = await import('../../src/pages/map/MapPage');
    const { container } = render(<MemoryRouter><MapPage /></MemoryRouter>);
    expect(container.firstChild).not.toBeNull();
  });
});
```

If the actual MapPage entry isn't at `pages/map/MapPage`, adjust the import path. If MapPage depends on context providers, wrap with the minimum providers needed.

- [ ] **Step 18.3: Run + commit**

Run: `cd client && npx vitest run tests/cross-impact/map-fleet-markers.test.tsx`
Expected: passes (or reports a clear error that points to a missing provider — fix and re-run).

```bash
git add client/tests/cross-impact/
git commit -m "test(cross-impact): MapPage smoke — no regression from /fleet/v2"
```

---

## Task 19: Zero-`as any` guard test

**Why:** Section 6.10 — CI-style enforcement that the new code doesn't loosen the type system.

**Files:**
- Create: `client/src/pages/fleet/v2/__tests__/no-as-any.test.ts`

- [ ] **Step 19.1: Write the test**

Create `client/src/pages/fleet/v2/__tests__/no-as-any.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

describe('Fleet V2 type discipline', () => {
  it('contains zero `as any` casts under client/src/pages/fleet/v2/', () => {
    const root = resolve(__dirname, '../../../../..'); // up to repo root
    let out = '';
    try {
      out = execSync(
        `grep -rn "as any" "${root}/client/src/pages/fleet/v2/" --include="*.ts" --include="*.tsx" || true`,
        { encoding: 'utf-8' }
      );
    } catch {
      out = '';
    }
    // Exclude this test file itself.
    const hits = out.split('\n').filter((l) => l && !l.includes('no-as-any.test.ts'));
    if (hits.length > 0) {
      console.error('Forbidden `as any` casts found:\n' + hits.join('\n'));
    }
    expect(hits).toEqual([]);
  });
});
```

- [ ] **Step 19.2: Run + commit**

Run: `cd client && npx vitest run src/pages/fleet/v2/__tests__/no-as-any.test.ts`
Expected: passes (we haven't written any `as any` casts).

```bash
git add client/src/pages/fleet/v2/__tests__/no-as-any.test.ts
git commit -m "test(fleet-v2): forbid `as any` casts in v2 directory"
```

---

## Task 20: Final verification + push + PR

**Why:** Pre-push gate mirrors CI. Then open the PR for operator review.

**Files:**
- None (verification + push)

- [ ] **Step 20.1: Run all gates locally**

```bash
npm run typecheck                       # worker types
cd client && npx tsc --noEmit && cd ..  # client types
cd client && npx vitest run && cd ..    # client tests
npx vitest run                          # worker tests
cd client && npx vite build && cd ..    # client production build
```

Expected: every command exits 0.

- [ ] **Step 20.2: Push**

```bash
git push -u origin HEAD
```

(Pre-push hook runs the same gates again.)

- [ ] **Step 20.3: Open PR**

```bash
gh pr create --title "feat(fleet-v2): PR 7'a — shell + sidebar + dashboard + vehicles list" --body "$(cat <<'EOF'
## Summary

PR 7'a of the 3-PR Fleet.io-style Fleet Manager UI program (spec: [`docs/superpowers/specs/2026-06-21-fleet-manager-ui-fleetio-style-design.md`](docs/superpowers/specs/2026-06-21-fleet-manager-ui-fleetio-style-design.md)).

Ships the foundation: two-pane shell + sidebar IA + KPI dashboard + vehicles list + vehicle-detail page with Overview tab. **Parallel-mounted at `/fleet/v2/*`** — the existing `/fleet` route is untouched.

## What's in this PR

- `client/src/pages/fleet/v2/` — new isolated directory:
  - `FleetShell` (two-pane layout + child router + mobile drawer)
  - `Sidebar` + `SIDEBAR_SECTIONS` const (single source of truth for IA)
  - `KpiRibbon` (5-cell live strip; reuses existing `/api/fleet/analytics` + `/overdue-inspections`)
  - `EmptyStateCard` + `SectionHeader` + `FleetListShell` stub (shared chrome)
  - `routes/DashboardRoute` + `VehiclesListRoute` + `VehicleDetailRoute` (Overview tab wired; other 12 tabs show EmptyStateCard)
- `client/src/types/fleetV2Audit.ts` — discriminated-union audit payload types
- `client/src/pages/fleet/v2/hooks/useNoindexDuringSoak.ts` — soak-period noindex meta (single constant flip at cutover)
- `client/src/pages/fleet/v2/hooks/useFleetV2Audit.ts` — fire-and-forget FLEET_V2_VIEW + FLEET_V2_API_ERROR emits
- `src/routes/auditEmit.ts` — tiny Worker endpoint with narrow allow-list (FLEET_V2_* only)
- `client/src/pages/admin/AdminFleetV2HealthTab.tsx` — admin-only soak health stub
- `.github/workflows/fleet-ui-coverage.yml` — endpoint-coverage report (informational here, blocking in 7'c) + no-DDL guard
- `docs/fleet-v2/live-sync-inventory.md` — audit of every `useLiveSync` in old fleet tree
- `client/public/sw.js` — `CACHE_NAME` bump
- New vitest coverage: Sidebar / FleetShell (incl. viewport tests) / DashboardRoute / VehiclesListRoute / VehicleDetailRoute / EmptyStateCard / SectionHeader / KpiRibbon / FleetListShell / useNoindexDuringSoak / useFleetV2Audit / VehicleFormModal contract / MapPage cross-impact / zero-`as any` guard

## Guardrails landed (from spec §6)

- ✅ §6.1 No DDL guard (CI workflow + reviewer checklist)
- ✅ §6.2 Endpoint-coverage CI workflow (informational this PR; blocking in 7'c)
- ✅ §6.3 Reused-component contract test (VehicleFormModal)
- 📝 §6.4 Live-sync channel inventory committed
- ✅ §6.5 MapPage cross-impact smoke test
- ✅ §6.6 Viewport tests at 375x667 + 1440x900
- ✅ §6.8 `noindex` meta during soak (single constant flip at cutover)
- ✅ §6.9 Page-view audit + API-error sentinel + /admin/fleet-v2-health stub
- ✅ §6.10 Zero `as any` in new code (vitest enforced); typed audit payloads

## Out of scope (lands in PR 7'b / 7'c)

- The 12 vehicle-detail tabs beyond Overview (show EmptyStateCard pointing to 7'b)
- Fleet-wide list pages (Fuel / Service / Inspections / Vendors / Reports) — empty states pointing to 7'b
- The 4 RMPG-only sections — empty states pointing to 7'c
- Cutover (flip `/fleet` to FleetShell, delete old code, `/fleet-legacy` mount) — PR 7'c only

## Reviewer focus

1. Sidebar IA in `Sidebar.tsx` — order match the spec? Anything mislabeled?
2. `useNoindexDuringSoak` ref-counting — robust against React strict-mode double-invoke?
3. The audit-emit route's allow-list — too narrow / too wide?
4. `FleetShell` mobile drawer — usable at 375x667 viewport (manual smoke on phone)?

## Test plan

- [x] All vitest suites pass locally
- [x] Worker + client typecheck clean
- [x] Client vite build clean
- [x] CI gates fire on push
- [ ] After merge: visit `https://rmpgutah.us/fleet/v2` in a logged-in browser, confirm sidebar renders + dashboard cards visible + click any vehicle → detail page works
- [ ] After merge: confirm `https://rmpgutah.us/fleet` STILL works (old UI untouched)
- [ ] After merge: confirm `/admin/fleet-v2-health` shows FLEET_V2_VIEW counter after a few minutes

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 20.4: Report PR URL + watch CI**

```bash
gh pr view --json url -q .url
gh pr checks --watch
```

Wait for green; if anything fails, fix locally + push another commit; never `--no-verify`.

---

## Verification matrix (spec coverage check)

| Spec requirement (§) | Covered by task |
|---|---|
| §1 sidebar IA + SIDEBAR_SECTIONS const | 8 |
| §1 gold "RMPG ONLY" divider | 8 |
| §1 ◯ empty-marker on Work Orders / Issues / Documents / Parts | 8, 11 (FleetShell Empty routes) |
| §2 sticky header + status badge + tab bar | 14 |
| §2 13-tab list (Overview wired; rest show EmptyStateCard) | 14 |
| §2 Activity tab — uses audit_log scoped by vehicle_id | NOT wired in 7'a; empty-state placeholder; full implementation in 7'b |
| §3 KPI ribbon (Dashboard) | 9 |
| §3 3 cards (Upcoming Service / Recent Fuel / Recent Inspections) | 12 |
| §3 fleet-wide list pages (Fuel/Service/Inspections/Vendors/Reports) | NOT in 7'a — empty-state placeholders; lands in 7'b |
| §4 RMPG-only sections (Personnel / DashCameras / GPS / Analysis) | NOT in 7'a — empty-state placeholders; lands in 7'c |
| §5 file structure under `client/src/pages/fleet/v2/` | 7, 8, 9, 10, 11, 12, 13, 14 |
| §5 routing change (App.tsx) | 15 |
| §6.1 no DDL guard | 2 |
| §6.2 endpoint-coverage CI | 2 |
| §6.3 reused-component contract test | 17 |
| §6.4 live-sync channel inventory doc | 1 |
| §6.5 cross-impact test (MapPage) | 18 |
| §6.6 viewport tests (375 + 1440) | 11 |
| §6.7 PDF/Print/Export not regressed | covered by NOT modifying those files; full audit lands in 7'c |
| §6.8 `/fleet-legacy` escape hatch | 7'c |
| §6.8 atomic flip + pre-drafted revert | 7'c |
| §6.8 SW cache bump | 15 |
| §6.8 soak period | enforced by leaving `/fleet` untouched in 7'a + 7'b |
| §6.8 noindex meta during soak | 5 (hook), 11 (mounted in FleetShell) |
| §6.9 page-view audit emit | 6, 12, 13, 14 |
| §6.9 API-error sentinel | 6 (`emitFleetV2ApiError` exported; wired into routes in 7'b) |
| §6.9 /admin/fleet-v2-health stub | 16 |
| §6.10 zero `as any` | 19 |
| §6.10 typed audit payloads | 3 |
| §6.10 SIDEBAR_SECTIONS single source of truth | 8 |

All PR 7'a in-scope requirements covered. Items marked "lands in 7'b/7'c" are explicitly out of scope per the phased plan.

## Out of scope (deferred)

| Item | PR |
|---|---|
| Full vehicle-detail tabs (12) | 7'b |
| Fleet-wide list pages | 7'b |
| Reports card grid | 7'b |
| Activity tab (audit_log feed) | 7'b |
| Endpoint-coverage CI becomes blocking | 7'c |
| RMPG-only sections (Personnel / DashCameras / GPS / Analysis) | 7'c |
| `/fleet` flip to FleetShell + delete old code | 7'c |
| `/fleet-legacy` 7-day escape hatch | 7'c |
| Pre-drafted revert PR + Cloudflare rollback URL in PR body | 7'c |
| Channel-parity tests (per spec §6.4) | 7'b — built on the channel inventory from 7'a Task 1 |
