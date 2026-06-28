# Dispatch Linkage Expansion & Client-Data Autofill — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand dispatch call-linkage (admin-configurable person/vehicle/caller/business roles, link businesses to calls) and autofill client data into the call's caller/PSO fields when a client is selected.

**Architecture:** A dedicated `link_options` DB table layered over hardcoded client defaults, merged at render (mirrors the proven `DEFAULT_DISPOSITION_CODES` + custom-codes pattern — dropdowns never go empty if the fetch fails). New `call_businesses` link endpoints mirror the existing `call_persons` endpoints. Client autofill lazily fetches the full client and fills *blank* fields only.

**Tech Stack:** Cloudflare Worker (Hono, D1) for `src/`; React 18 + TypeScript + Vite + vitest for `client/`. Spec: [`docs/superpowers/specs/2026-06-13-dispatch-linkage-client-autofill-design.md`](../specs/2026-06-13-dispatch-linkage-client-autofill-design.md).

**Reference patterns (read before starting):**
- Person-link endpoints to mirror: [`src/routes/dispatch/callLinks.ts:51-204`](../../../src/routes/dispatch/callLinks.ts)
- Business helpers to reuse: `findOrCreateBusiness` ([`src/utils/serveIntakeRecords.ts:172`](../../../src/utils/serveIntakeRecords.ts)), `linkCallToBusiness` (:456)
- Route registry: [`src/routesConfig.ts:210-268`](../../../src/routesConfig.ts) (`ROUTE_REGISTRY`; `callLinks` mounted at `/api/dispatch`, `admin` at `/api/admin`)
- Client dropdown + caller block + linked persons UI: [`client/src/pages/dispatch/DispatchPage.tsx`](../../../client/src/pages/dispatch/DispatchPage.tsx) — client select `4182`, caller relationship `4268`, person-role `4770`, vehicle-role `4821`, link functions `499-554`
- Shared dropdown components: [`client/src/components/LinkPersonModal.tsx:31`](../../../client/src/components/LinkPersonModal.tsx), [`client/src/components/NewCallModal.tsx:80`](../../../client/src/components/NewCallModal.tsx)
- Admin tabs: [`client/src/pages/AdminPage.tsx:231`](../../../client/src/pages/AdminPage.tsx) (`TabId` union), `:641` (`tabGroups`)

**Cross-cutting rules (from CLAUDE.md + memory):**
- D1 calls are async — always `await`. No worker test suite — verify worker code with `npm run typecheck` + manual D1/browser checks.
- After merge, migrations may silently not reach live D1 — apply `0104` directly to live `rmpg-flex` (`785de7ae-…`) and verify with `pragma_table_info`.
- **Never `ALTER calls_for_service`** (100-col cap). This plan adds no columns to it.
- Bump `CACHE_NAME` in `client/public/sw.js` (final task) — client changed.
- Businesses for call-linkage live in the **`businesses`** table (FK target of `call_businesses`), NOT the `properties`-backed `/records/businesses`. Search/create against `businesses`.

---

## Task 1: Migration `0104_link_options.sql` + seed

**Files:**
- Create: `migrations/0104_link_options.sql`

- [ ] **Step 1: Write the migration + seed**

Create `migrations/0104_link_options.sql`:

```sql
-- link_options: admin-editable option lists for call-linkage dropdowns.
-- Layered UNDER hardcoded client defaults (constants/linkOptions.ts) which
-- guarantee non-empty dropdowns if this table is empty/unreachable. Rows here
-- override a default's label/sort, hide it (is_active=0), or add a custom value.
-- is_default=1 marks seeded baseline rows (protected from hard-delete in admin).
CREATE TABLE IF NOT EXISTS link_options (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,            -- person_role | vehicle_role | caller_relationship | business_role
  value TEXT NOT NULL,
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 100,
  is_active INTEGER NOT NULL DEFAULT 1,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT,
  UNIQUE(category, value)
);
CREATE INDEX IF NOT EXISTS idx_link_options_cat ON link_options(category, is_active, sort_order);

INSERT OR IGNORE INTO link_options (category, value, label, sort_order, is_default) VALUES
  ('person_role','suspect','Suspect',10,1),
  ('person_role','victim','Victim',20,1),
  ('person_role','witness','Witness',30,1),
  ('person_role','reporting_party','Reporting Party',40,1),
  ('person_role','involved','Involved',50,1),
  ('person_role','complainant','Complainant',60,1),
  ('person_role','serve_recipient','Serve Recipient',70,1),
  ('person_role','serve_recipient_agent','Serve Recipient Agent',80,1),
  ('person_role','registered_agent','Registered Agent',90,1),
  ('person_role','authorized_agent','Authorized Agent',100,1),
  ('person_role','plaintiff','Plaintiff',110,1),
  ('person_role','defendant','Defendant',120,1),
  ('person_role','attorney','Attorney',130,1),
  ('person_role','process_server','Process Server',140,1),
  ('person_role','client_contact','Client Contact',150,1),
  ('person_role','mentioned','Mentioned',160,1),
  ('person_role','other','Other',170,1),
  ('vehicle_role','suspect_vehicle','Suspect Vehicle',10,1),
  ('vehicle_role','victim_vehicle','Victim Vehicle',20,1),
  ('vehicle_role','witness_vehicle','Witness Vehicle',30,1),
  ('vehicle_role','involved','Involved',40,1),
  ('vehicle_role','evidence','Evidence',50,1),
  ('vehicle_role','towed','Towed',60,1),
  ('vehicle_role','recovered','Recovered',70,1),
  ('vehicle_role','other','Other',80,1),
  ('caller_relationship','employee','Employee',10,1),
  ('caller_relationship','victim','Victim',20,1),
  ('caller_relationship','witness','Witness',30,1),
  ('caller_relationship','complainant','Complainant',40,1),
  ('caller_relationship','management','Management',50,1),
  ('caller_relationship','alarm_company','Alarm Company',60,1),
  ('caller_relationship','officer','Officer',70,1),
  ('caller_relationship','anonymous','Anonymous',80,1),
  ('caller_relationship','registered_agent','Registered Agent',90,1),
  ('caller_relationship','attorney','Attorney',100,1),
  ('caller_relationship','plaintiff','Plaintiff',110,1),
  ('caller_relationship','defendant','Defendant',120,1),
  ('caller_relationship','property_manager','Property Manager',130,1),
  ('caller_relationship','tenant','Tenant',140,1),
  ('caller_relationship','client','Client',150,1),
  ('caller_relationship','guard_on_duty','Guard On Duty',160,1),
  ('caller_relationship','third_party','Third Party',170,1),
  ('caller_relationship','automated_system','Automated System',180,1),
  ('caller_relationship','neighbor','Neighbor',190,1),
  ('caller_relationship','family_member','Family Member',200,1),
  ('caller_relationship','other','Other',210,1),
  ('business_role','served_business','Served Business',10,1),
  ('business_role','client_org','Client Organization',20,1),
  ('business_role','alarm_company','Alarm Company',30,1),
  ('business_role','property','Property',40,1),
  ('business_role','employer','Employer',50,1),
  ('business_role','registered_agent_entity','Registered Agent Entity',60,1),
  ('business_role','involved','Involved',70,1),
  ('business_role','other','Other',80,1);
```

- [ ] **Step 2: Apply locally and verify**

Run: `npm run migrate:local`
Then: `npx wrangler d1 execute rmpg-flex --local --command "SELECT category, COUNT(*) n FROM link_options GROUP BY category"`
Expected: 4 rows — `business_role 8`, `caller_relationship 21`, `person_role 17`, `vehicle_role 8`.

- [ ] **Step 3: Commit**

```bash
git add migrations/0104_link_options.sql
git commit -m "feat(db): link_options table + seed for configurable linkage dropdowns"
```

- [ ] **Step 4: Apply to LIVE D1 (post-merge, do not skip)**

After the PR merges, apply the same DDL directly to live `rmpg-flex` (`785de7ae-…`) via the Cloudflare D1 API/MCP (`d1_database_query`), because `deploy.yml`'s migration step is `continue-on-error`. Verify: `SELECT COUNT(*) FROM link_options` returns 54. *(Tracked here as a release step; not a code commit.)*

---

## Task 2: Client option defaults + pure merge helper

**Files:**
- Create: `client/src/constants/linkOptions.ts`
- Test: `client/src/constants/linkOptions.test.ts`

- [ ] **Step 1: Write the failing test**

Create `client/src/constants/linkOptions.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { DEFAULT_LINK_OPTIONS, mergeLinkOptions, type LinkOption } from './linkOptions';

describe('mergeLinkOptions', () => {
  it('returns defaults unchanged when no DB rows', () => {
    const merged = mergeLinkOptions('person_role', []);
    expect(merged).toEqual(DEFAULT_LINK_OPTIONS.person_role);
  });

  it('overrides a default label and re-sorts by sort_order', () => {
    const db: LinkOption[] = [{ value: 'suspect', label: 'Primary Suspect', sort_order: 5, is_active: 1 }];
    const merged = mergeLinkOptions('person_role', db);
    const suspect = merged.find((o) => o.value === 'suspect');
    expect(suspect?.label).toBe('Primary Suspect');
    expect(merged[0].value).toBe('suspect'); // sort_order 5 floats to top
  });

  it('appends a custom DB-only value', () => {
    const db: LinkOption[] = [{ value: 'co_signer', label: 'Co-Signer', sort_order: 999, is_active: 1 }];
    const merged = mergeLinkOptions('person_role', db);
    expect(merged.some((o) => o.value === 'co_signer')).toBe(true);
  });

  it('hides a default when DB marks it inactive', () => {
    const db: LinkOption[] = [{ value: 'other', label: 'Other', sort_order: 170, is_active: 0 }];
    const merged = mergeLinkOptions('person_role', db);
    expect(merged.some((o) => o.value === 'other')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/constants/linkOptions.test.ts`
Expected: FAIL — `Cannot find module './linkOptions'`.

- [ ] **Step 3: Write the implementation**

Create `client/src/constants/linkOptions.ts`:

```ts
// Configurable linkage option lists for dispatch call-linkage dropdowns.
// These hardcoded DEFAULTS are the runtime fallback — they guarantee dropdowns
// are never empty even if /api/dispatch/link-options is unreachable or unseeded.
// Admin DB rows (link_options table) are merged over these via mergeLinkOptions.
// Keep VALUES in sync with migrations/0104_link_options.sql seed.

export type LinkCategory = 'person_role' | 'vehicle_role' | 'caller_relationship' | 'business_role';

export interface LinkOption {
  value: string;
  label: string;
  sort_order?: number;
  is_active?: number; // 1 active, 0 hidden (DB rows only)
}

export const DEFAULT_LINK_OPTIONS: Record<LinkCategory, LinkOption[]> = {
  person_role: [
    { value: 'suspect', label: 'Suspect', sort_order: 10 },
    { value: 'victim', label: 'Victim', sort_order: 20 },
    { value: 'witness', label: 'Witness', sort_order: 30 },
    { value: 'reporting_party', label: 'Reporting Party', sort_order: 40 },
    { value: 'involved', label: 'Involved', sort_order: 50 },
    { value: 'complainant', label: 'Complainant', sort_order: 60 },
    { value: 'serve_recipient', label: 'Serve Recipient', sort_order: 70 },
    { value: 'serve_recipient_agent', label: 'Serve Recipient Agent', sort_order: 80 },
    { value: 'registered_agent', label: 'Registered Agent', sort_order: 90 },
    { value: 'authorized_agent', label: 'Authorized Agent', sort_order: 100 },
    { value: 'plaintiff', label: 'Plaintiff', sort_order: 110 },
    { value: 'defendant', label: 'Defendant', sort_order: 120 },
    { value: 'attorney', label: 'Attorney', sort_order: 130 },
    { value: 'process_server', label: 'Process Server', sort_order: 140 },
    { value: 'client_contact', label: 'Client Contact', sort_order: 150 },
    { value: 'mentioned', label: 'Mentioned', sort_order: 160 },
    { value: 'other', label: 'Other', sort_order: 170 },
  ],
  vehicle_role: [
    { value: 'suspect_vehicle', label: 'Suspect Vehicle', sort_order: 10 },
    { value: 'victim_vehicle', label: 'Victim Vehicle', sort_order: 20 },
    { value: 'witness_vehicle', label: 'Witness Vehicle', sort_order: 30 },
    { value: 'involved', label: 'Involved', sort_order: 40 },
    { value: 'evidence', label: 'Evidence', sort_order: 50 },
    { value: 'towed', label: 'Towed', sort_order: 60 },
    { value: 'recovered', label: 'Recovered', sort_order: 70 },
    { value: 'other', label: 'Other', sort_order: 80 },
  ],
  caller_relationship: [
    { value: 'employee', label: 'Employee', sort_order: 10 },
    { value: 'victim', label: 'Victim', sort_order: 20 },
    { value: 'witness', label: 'Witness', sort_order: 30 },
    { value: 'complainant', label: 'Complainant', sort_order: 40 },
    { value: 'management', label: 'Management', sort_order: 50 },
    { value: 'alarm_company', label: 'Alarm Company', sort_order: 60 },
    { value: 'officer', label: 'Officer', sort_order: 70 },
    { value: 'anonymous', label: 'Anonymous', sort_order: 80 },
    { value: 'registered_agent', label: 'Registered Agent', sort_order: 90 },
    { value: 'attorney', label: 'Attorney', sort_order: 100 },
    { value: 'plaintiff', label: 'Plaintiff', sort_order: 110 },
    { value: 'defendant', label: 'Defendant', sort_order: 120 },
    { value: 'property_manager', label: 'Property Manager', sort_order: 130 },
    { value: 'tenant', label: 'Tenant', sort_order: 140 },
    { value: 'client', label: 'Client', sort_order: 150 },
    { value: 'guard_on_duty', label: 'Guard On Duty', sort_order: 160 },
    { value: 'third_party', label: 'Third Party', sort_order: 170 },
    { value: 'automated_system', label: 'Automated System', sort_order: 180 },
    { value: 'neighbor', label: 'Neighbor', sort_order: 190 },
    { value: 'family_member', label: 'Family Member', sort_order: 200 },
    { value: 'other', label: 'Other', sort_order: 210 },
  ],
  business_role: [
    { value: 'served_business', label: 'Served Business', sort_order: 10 },
    { value: 'client_org', label: 'Client Organization', sort_order: 20 },
    { value: 'alarm_company', label: 'Alarm Company', sort_order: 30 },
    { value: 'property', label: 'Property', sort_order: 40 },
    { value: 'employer', label: 'Employer', sort_order: 50 },
    { value: 'registered_agent_entity', label: 'Registered Agent Entity', sort_order: 60 },
    { value: 'involved', label: 'Involved', sort_order: 70 },
    { value: 'other', label: 'Other', sort_order: 80 },
  ],
};

/**
 * Merge admin DB rows over the hardcoded defaults for one category.
 * - DB row matching an existing value → overrides label/sort_order; is_active=0 hides it.
 * - DB row with a new value → appended as a custom option.
 * - Result sorted by sort_order then label. Never empty if defaults exist.
 */
export function mergeLinkOptions(category: LinkCategory, dbRows: LinkOption[]): LinkOption[] {
  const byValue = new Map<string, LinkOption>();
  for (const d of DEFAULT_LINK_OPTIONS[category]) byValue.set(d.value, { ...d, is_active: 1 });
  for (const r of dbRows) {
    if (r.is_active === 0) { byValue.delete(r.value); continue; }
    const existing = byValue.get(r.value);
    byValue.set(r.value, {
      value: r.value,
      label: r.label || existing?.label || r.value,
      sort_order: r.sort_order ?? existing?.sort_order ?? 100,
      is_active: 1,
    });
  }
  return [...byValue.values()].sort(
    (a, b) => (a.sort_order ?? 100) - (b.sort_order ?? 100) || a.label.localeCompare(b.label),
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/constants/linkOptions.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add client/src/constants/linkOptions.ts client/src/constants/linkOptions.test.ts
git commit -m "feat(client): link-option defaults + mergeLinkOptions helper"
```

---

## Task 3: `useLinkOptions` hook (fetch + merge + cache)

**Files:**
- Create: `client/src/hooks/useLinkOptions.ts`
- Test: `client/src/hooks/useLinkOptions.test.ts`

- [ ] **Step 1: Write the failing test**

Create `client/src/hooks/useLinkOptions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

vi.mock('./useApi', () => ({
  apiFetch: vi.fn(),
}));
import { apiFetch } from './useApi';
import { useLinkOptions, __resetLinkOptionsCache } from './useLinkOptions';

describe('useLinkOptions', () => {
  beforeEach(() => { __resetLinkOptionsCache(); vi.clearAllMocks(); });

  it('falls back to defaults when the fetch rejects', async () => {
    (apiFetch as any).mockRejectedValue(new Error('network'));
    const { result } = renderHook(() => useLinkOptions());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.options.person_role.some((o) => o.value === 'suspect')).toBe(true);
  });

  it('merges DB rows over defaults', async () => {
    (apiFetch as any).mockResolvedValue({
      person_role: [{ value: 'suspect', label: 'Primary Suspect', sort_order: 5, is_active: 1 }],
    });
    const { result } = renderHook(() => useLinkOptions());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.options.person_role[0].label).toBe('Primary Suspect');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/hooks/useLinkOptions.test.ts`
Expected: FAIL — `Cannot find module './useLinkOptions'`.

- [ ] **Step 3: Write the implementation**

Create `client/src/hooks/useLinkOptions.ts`:

```ts
import { useEffect, useState } from 'react';
import { apiFetch } from './useApi';
import {
  DEFAULT_LINK_OPTIONS, mergeLinkOptions,
  type LinkCategory, type LinkOption,
} from '../constants/linkOptions';

export type MergedLinkOptions = Record<LinkCategory, LinkOption[]>;

const CATEGORIES: LinkCategory[] = ['person_role', 'vehicle_role', 'caller_relationship', 'business_role'];

function defaultsAll(): MergedLinkOptions {
  return {
    person_role: DEFAULT_LINK_OPTIONS.person_role,
    vehicle_role: DEFAULT_LINK_OPTIONS.vehicle_role,
    caller_relationship: DEFAULT_LINK_OPTIONS.caller_relationship,
    business_role: DEFAULT_LINK_OPTIONS.business_role,
  };
}

// Module-level cache so every consumer shares one network round-trip.
let cache: MergedLinkOptions | null = null;
let inflight: Promise<MergedLinkOptions> | null = null;

/** Test-only: clear the shared cache between cases. */
export function __resetLinkOptionsCache(): void { cache = null; inflight = null; }

async function load(): Promise<MergedLinkOptions> {
  if (cache) return cache;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const raw = await apiFetch<Partial<Record<LinkCategory, LinkOption[]>>>('/dispatch/link-options');
      const merged = defaultsAll();
      for (const cat of CATEGORIES) {
        merged[cat] = mergeLinkOptions(cat, Array.isArray(raw?.[cat]) ? raw![cat]! : []);
      }
      cache = merged;
      return merged;
    } catch {
      // Network/endpoint failure → hardcoded defaults (logged once).
      console.warn('[useLinkOptions] falling back to default link options');
      cache = defaultsAll();
      return cache;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Returns merged-over-defaults linkage option lists. Never empty. */
export function useLinkOptions(): { options: MergedLinkOptions; loading: boolean } {
  const [options, setOptions] = useState<MergedLinkOptions>(() => cache ?? defaultsAll());
  const [loading, setLoading] = useState<boolean>(!cache);

  useEffect(() => {
    let alive = true;
    if (cache) { setOptions(cache); setLoading(false); return; }
    load().then((m) => { if (alive) { setOptions(m); setLoading(false); } });
    return () => { alive = false; };
  }, []);

  return { options, loading };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/hooks/useLinkOptions.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add client/src/hooks/useLinkOptions.ts client/src/hooks/useLinkOptions.test.ts
git commit -m "feat(client): useLinkOptions hook (cached fetch + merge over defaults)"
```

---

## Task 4: Worker read endpoint `GET /api/dispatch/link-options`

**Files:**
- Create: `src/routes/linkOptions.ts`
- Modify: `src/routesConfig.ts` (import + one registry entry)

- [ ] **Step 1: Write the read router**

Create `src/routes/linkOptions.ts`:

```ts
// Configurable linkage option lists. Read endpoint feeds dispatch dropdowns;
// admin CRUD (added in a later task) edits the same link_options table.
import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query } from '../utils/db';

const CATEGORIES = ['person_role', 'vehicle_role', 'caller_relationship', 'business_role'] as const;

// Read router — mounted at /api/dispatch → GET /api/dispatch/link-options.
export const linkOptions = new Hono<Env>();

linkOptions.get('/link-options', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<{ category: string; value: string; label: string; sort_order: number; is_active: number }>(
      db,
      `SELECT category, value, label, sort_order, is_active
         FROM link_options WHERE is_active = 1
        ORDER BY category, sort_order`,
    );
    const grouped: Record<string, unknown[]> = {};
    for (const cat of CATEGORIES) grouped[cat] = [];
    for (const r of rows) (grouped[r.category] ||= []).push(r);
    return c.json(grouped);
  } catch {
    // Table missing / not yet applied to live → empty groups; client falls back
    // to its hardcoded defaults. Never 500 the dropdowns.
    return c.json({ person_role: [], vehicle_role: [], caller_relationship: [], business_role: [] });
  }
});
```

- [ ] **Step 2: Register the router**

In `src/routesConfig.ts`, add the import near the other route imports (after line 152's `import dispatchCallLinks ...`):

```ts
import { linkOptions as linkOptionsRead } from './routes/linkOptions';
```

Then add to the `ROUTE_REGISTRY` array, immediately after the `dispatchCallLinks` entry (line ~234):

```ts
  { prefix: '/api/dispatch', router: linkOptionsRead, auth: 'required' },
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Manual verify (local)**

Run `npm run dev` in one shell. In another:
`curl -s http://localhost:8787/api/dispatch/link-options -H "Authorization: Bearer <dev-jwt>"`
Expected: JSON with 4 keys; `person_role` has 17 entries. (If you lack a dev JWT, defer to the browser check post-deploy — the client falls back to defaults regardless.)

- [ ] **Step 5: Commit**

```bash
git add src/routes/linkOptions.ts src/routesConfig.ts
git commit -m "feat(api): GET /api/dispatch/link-options read endpoint"
```

---

## Task 5: Swap hardcoded dropdowns to use merged options

**Files:**
- Modify: `client/src/pages/dispatch/DispatchPage.tsx` (caller `4268`, person-role `4770`, vehicle-role `4821`)
- Modify: `client/src/components/LinkPersonModal.tsx` (`PERSON_ROLES` `31-38`, usage `297`)
- Modify: `client/src/components/NewCallModal.tsx` (`CALLER_RELATIONSHIPS` `80-91`, its `<select>`)

- [ ] **Step 1: Wire the hook into DispatchPage**

Near the other hooks at the top of the `DispatchPage` component body (e.g. just after the linked-persons state at line ~497), add:

```tsx
  const { options: linkOptions } = useLinkOptions();
```

Add the import at the top of the file with the other hook imports:

```tsx
import { useLinkOptions } from '../../hooks/useLinkOptions';
```

- [ ] **Step 2: Replace the person-role `<select>` options (around line 4770)**

Replace the six hardcoded `<option>` children with:

```tsx
                            <select className="input-dark text-[9px] py-0 px-1 w-auto" value={linkPersonRole} onChange={(e) => setLinkPersonRole(e.target.value)}>
                              {linkOptions.person_role.map((o) => (
                                <option key={o.value} value={o.value}>{o.label}</option>
                              ))}
                            </select>
```

- [ ] **Step 3: Replace the vehicle-role `<select>` options (around line 4821)**

```tsx
                            <select className="input-dark text-[9px] py-0 px-1 w-auto" value={linkVehicleRole} onChange={(e) => setLinkVehicleRole(e.target.value)}>
                              {linkOptions.vehicle_role.map((o) => (
                                <option key={o.value} value={o.value}>{o.label}</option>
                              ))}
                            </select>
```

- [ ] **Step 4: Replace the caller-relationship `<select>` options (around line 4268)**

Keep the leading placeholder; map the rest:

```tsx
                          <select className="select-dark text-xs" value={editData.caller_relationship} onChange={(e) => updateEditField('caller_relationship', e.target.value)}>
                            <option value="">-- Relationship --</option>
                            {linkOptions.caller_relationship.map((o) => (
                              <option key={o.value} value={o.value}>{o.label}</option>
                            ))}
                          </select>
```

- [ ] **Step 5: Update LinkPersonModal to use the hook**

In `client/src/components/LinkPersonModal.tsx`: add `import { useLinkOptions } from '../hooks/useLinkOptions';` at the top. Inside the component, add `const { options } = useLinkOptions();`. Replace the `PERSON_ROLES.map((r) => ...)` at line ~297 with `options.person_role.map((r) => ...)` (same `{r.value}`/`{r.label}` shape). Delete the now-unused `PERSON_ROLES` const at lines 31-38. **If** the default selected role state was typed as the `PersonRole` union, widen it to `string` (the configurable list is open-ended).

- [ ] **Step 6: Update NewCallModal to use the hook**

In `client/src/components/NewCallModal.tsx`: add `import { useLinkOptions } from '../hooks/useLinkOptions';`, add `const { options } = useLinkOptions();` in the component. Replace the `CALLER_RELATIONSHIPS.map(...)` in its caller-relationship `<select>` with a leading `<option value="">-- Select --</option>` followed by `options.caller_relationship.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)`. Delete the `CALLER_RELATIONSHIPS` const at lines 80-91.

- [ ] **Step 7: Typecheck + tests + build**

Run: `cd client && npx tsc --noEmit && npx vitest run`
Expected: no type errors; all tests pass.

- [ ] **Step 8: Commit**

```bash
git add client/src/pages/dispatch/DispatchPage.tsx client/src/components/LinkPersonModal.tsx client/src/components/NewCallModal.tsx
git commit -m "feat(client): drive linkage dropdowns from configurable options"
```

---

## Task 6: Worker business-link endpoints

**Files:**
- Modify: `src/routes/dispatch/callLinks.ts` (append a BUSINESSES section after the VEHICLES section, before `export default links`)

- [ ] **Step 1: Add the business-search + link endpoints**

At the top of `callLinks.ts`, add the import for the reusable helper:

```ts
import { findOrCreateBusiness } from '../../utils/serveIntakeRecords';
```

Append this block just before the final `export default links;`:

```ts
// ═══════════════════════════════════════════════════════════════════
// BUSINESSES  (call_businesses → businesses table; FK-correct, consistent
// with serve-intake. NOT the properties-backed /records/businesses.)
// ═══════════════════════════════════════════════════════════════════

// GET /dispatch/business-search?q= — typeahead against the businesses table.
links.get('/business-search', async (c) => {
  const db = getDb(c.env);
  const q = (c.req.query('q') || '').trim().toLowerCase();
  if (q.length < 2) return c.json([]);
  const rows = await query<Record<string, unknown>>(
    db,
    `SELECT id, name, address, city, state, phone, business_type
       FROM businesses
      WHERE archived_at IS NULL AND LOWER(name) LIKE ?
      ORDER BY name LIMIT 10`,
    `%${q}%`,
  );
  return c.json(rows);
});

// GET /dispatch/calls/:id/businesses — joined with businesses for one-fetch render.
links.get('/calls/:id/businesses', async (c) => {
  const db = getDb(c.env);
  const rows = await query<Record<string, unknown>>(
    db,
    `SELECT cb.id, cb.call_id, cb.business_id, cb.role, cb.notes, cb.created_at,
            b.name, b.address, b.city, b.state, b.phone, b.business_type
       FROM call_businesses cb
       JOIN businesses b ON cb.business_id = b.id
      WHERE cb.call_id = ?
      ORDER BY cb.created_at DESC LIMIT 200`,
    c.req.param('id'),
  );
  return c.json(rows);
});

// POST /dispatch/calls/:id/businesses  body { business_id, role?, notes? }
links.post('/calls/:id/businesses', async (c) => {
  const db = getDb(c.env);
  const callId = c.req.param('id');
  const userId = c.get('userId') as number;
  const body = await c.req.json<{ business_id: number; role?: string; notes?: string }>();
  if (!body.business_id) return c.json({ error: 'business_id required' }, 400);
  const biz = await queryFirst<{ id: number }>(db, 'SELECT id FROM businesses WHERE id = ?', body.business_id);
  if (!biz) return c.json({ error: 'Business not found' }, 404);
  await execute(
    db,
    `INSERT OR IGNORE INTO call_businesses (call_id, business_id, role, notes, added_by, created_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`,
    callId, body.business_id, body.role || 'involved', body.notes ?? null, userId,
  );
  const created = await queryFirst<Record<string, unknown>>(
    db,
    `SELECT cb.*, b.name, b.address, b.city, b.state, b.phone, b.business_type
       FROM call_businesses cb JOIN businesses b ON cb.business_id = b.id
      WHERE cb.call_id = ? AND cb.business_id = ? AND cb.role = ?`,
    callId, body.business_id, body.role || 'involved',
  );
  await emitAlert(c.env, 'dispatch_update', {
    action: 'call_business_added', call_id: Number(callId), link: created,
  });
  return c.json(created, 201);
});

// POST /dispatch/calls/:id/businesses/quick-add  body { name, address?, city?, state?, zip?, phone?, role? }
links.post('/calls/:id/businesses/quick-add', async (c) => {
  const db = getDb(c.env);
  const callId = c.req.param('id');
  const userId = c.get('userId') as number;
  const body = await c.req.json<{ name: string; address?: string; city?: string; state?: string; zip?: string; phone?: string; role?: string }>();
  if (!body.name || !body.name.trim()) return c.json({ error: 'name required' }, 400);
  // Reuse the serve-intake find-or-create so dispatch + scanner share one
  // de-dupe path (matches LOWER(name)). Returns { id }.
  const ref = await findOrCreateBusiness(db, {
    name: body.name.trim(), address: body.address || null, city: body.city || null,
    state: body.state || null, zip: body.zip || null, phone: body.phone || null,
  } as any);
  await execute(
    db,
    `INSERT OR IGNORE INTO call_businesses (call_id, business_id, role, added_by, created_at)
     VALUES (?, ?, ?, ?, datetime('now'))`,
    callId, ref.id, body.role || 'involved', userId,
  );
  const created = await queryFirst<Record<string, unknown>>(
    db,
    `SELECT cb.*, b.name, b.address, b.city, b.state, b.phone, b.business_type
       FROM call_businesses cb JOIN businesses b ON cb.business_id = b.id
      WHERE cb.call_id = ? AND cb.business_id = ? AND cb.role = ?`,
    callId, ref.id, body.role || 'involved',
  );
  await emitAlert(c.env, 'dispatch_update', { action: 'call_business_added', call_id: Number(callId), link: created });
  return c.json({ created: true, business_id: ref.id, link: created }, 201);
});

// DELETE /dispatch/calls/:id/businesses/:linkId
links.delete('/calls/:id/businesses/:linkId', async (c) => {
  const db = getDb(c.env);
  const callId = c.req.param('id');
  const linkId = c.req.param('linkId');
  await execute(db, 'DELETE FROM call_businesses WHERE id = ? AND call_id = ?', linkId, callId);
  await emitAlert(c.env, 'dispatch_update', {
    action: 'call_business_removed', call_id: Number(callId), link_id: Number(linkId),
  });
  return c.json({ success: true });
});

// PATCH /dispatch/calls/:id/businesses/:linkId — change role / notes
links.patch('/calls/:id/businesses/:linkId', async (c) => {
  const db = getDb(c.env);
  const callId = c.req.param('id');
  const linkId = c.req.param('linkId');
  const body = await c.req.json<{ role?: string; notes?: string }>();
  const sets: string[] = [];
  const params: unknown[] = [];
  if (body.role !== undefined) { sets.push('role = ?'); params.push(body.role); }
  if (body.notes !== undefined) { sets.push('notes = ?'); params.push(body.notes); }
  if (sets.length === 0) return c.json({ error: 'No fields' }, 400);
  params.push(linkId, callId);
  await execute(db, `UPDATE call_businesses SET ${sets.join(', ')} WHERE id = ? AND call_id = ?`, ...params);
  const updated = await queryFirst<Record<string, unknown>>(
    db,
    `SELECT cb.*, b.name FROM call_businesses cb JOIN businesses b ON cb.business_id = b.id WHERE cb.id = ?`,
    linkId,
  );
  await emitAlert(c.env, 'dispatch_update', { action: 'call_business_updated', call_id: Number(callId), link: updated });
  return c.json(updated);
});
```

> **Note:** `findOrCreateBusiness`'s `BusinessInput` may not declare every field passed above — the `as any` cast tolerates that. If `npm run typecheck` flags a missing required field, open [`serveIntakeRecords.ts:172`](../../../src/utils/serveIntakeRecords.ts) and pass exactly the fields its `BusinessInput` requires (at minimum `name`).

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors. (Fix any `BusinessInput` mismatch per the note.)

- [ ] **Step 3: Commit**

```bash
git add src/routes/dispatch/callLinks.ts
git commit -m "feat(api): call_businesses link endpoints + business search"
```

---

## Task 7: Linked Businesses UI block

**Files:**
- Modify: `client/src/pages/dispatch/DispatchPage.tsx` (state near `494-497`; functions near `499-554`; UI block after the Linked Vehicles block ending ~`4866`; fetch on call-open alongside `fetchCallPersons`/`fetchCallVehicles`)

- [ ] **Step 1: Add state + functions**

After the `callVehicles` state (line ~495), add:

```tsx
  const [callBusinesses, setCallBusinesses] = useState<any[]>([]);
  const [linkBusinessRole, setLinkBusinessRole] = useState('involved');
  const [businessSearchResults, setBusinessSearchResults] = useState<any[]>([]);
  const [showBusinessDropdown, setShowBusinessDropdown] = useState(false);
  const [businessQuery, setBusinessQuery] = useState('');
  const businessDropdownRef = useRef<HTMLDivElement>(null);
```

After `unlinkVehicleFromCall` (line ~554), add:

```tsx
  const fetchCallBusinesses = useCallback(async (callId: string | number) => {
    try {
      const data = await apiFetch<any[]>(`/dispatch/calls/${callId}/businesses`);
      setCallBusinesses(Array.isArray(data) ? data : []);
    } catch { setCallBusinesses([]); }
  }, []);

  const searchBusinesses = useCallback((q: string) => {
    setBusinessQuery(q);
    if (q.trim().length < 2) { setBusinessSearchResults([]); setShowBusinessDropdown(false); return; }
    apiFetch<any[]>(`/dispatch/business-search?q=${encodeURIComponent(q)}`)
      .then((r) => { setBusinessSearchResults(Array.isArray(r) ? r : []); setShowBusinessDropdown(true); })
      .catch(() => setBusinessSearchResults([]));
  }, []);

  const linkBusinessToCall = useCallback(async (callId: string | number, businessId: string | number, role: string) => {
    try {
      await apiFetch(`/dispatch/calls/${callId}/businesses`, {
        method: 'POST', body: JSON.stringify({ business_id: businessId, role }),
      });
      fetchCallBusinesses(callId);
    } catch (err: any) {
      console.error('Link business error:', err);
      addToast(err?.message || 'Failed to link business', 'error');
    }
  }, [fetchCallBusinesses, addToast]);

  const quickAddBusiness = useCallback(async (callId: string | number, name: string, role: string) => {
    try {
      await apiFetch(`/dispatch/calls/${callId}/businesses/quick-add`, {
        method: 'POST', body: JSON.stringify({ name, role }),
      });
      fetchCallBusinesses(callId);
      setBusinessQuery(''); setBusinessSearchResults([]); setShowBusinessDropdown(false);
    } catch (err: any) {
      console.error('Quick-add business error:', err);
      addToast(err?.message || 'Failed to add business', 'error');
    }
  }, [fetchCallBusinesses, addToast]);

  const unlinkBusinessFromCall = useCallback(async (callId: string | number, linkId: string | number) => {
    try {
      await apiFetch(`/dispatch/calls/${callId}/businesses/${linkId}`, { method: 'DELETE' });
      setCallBusinesses(prev => prev.filter(b => b.id !== linkId));
    } catch (err: any) {
      console.error('Unlink business error:', err);
      addToast(err?.message || 'Failed to unlink business', 'error');
      fetchCallBusinesses(callId);
    }
  }, [addToast, fetchCallBusinesses]);
```

- [ ] **Step 2: Fetch businesses when a call opens**

Find where `fetchCallPersons(selectedCall.id)` and `fetchCallVehicles(...)` are called on call selection (grep `fetchCallVehicles(`). Add a sibling call `fetchCallBusinesses(<sameId>);` everywhere `fetchCallVehicles` is invoked.

- [ ] **Step 3: Add the UI block**

Immediately after the Linked Vehicles `</div>` that closes its block (the one ending around line 4866, before the "Direction of Travel" block), insert:

```tsx
                        {/* ── Linked Businesses ── */}
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <label className="text-[9px] text-brand-gold-500">Linked Businesses</label>
                            <select className="input-dark text-[9px] py-0 px-1 w-auto" value={linkBusinessRole} onChange={(e) => setLinkBusinessRole(e.target.value)}>
                              {linkOptions.business_role.map((o) => (
                                <option key={o.value} value={o.value}>{o.label}</option>
                              ))}
                            </select>
                          </div>
                          {callBusinesses.length > 0 && (
                            <div className="flex flex-wrap gap-1 mb-1">
                              {callBusinesses.map((cb: any) => (
                                <span key={cb.id} className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-mono bg-rmpg-700 border border-rmpg-500 rounded-sm text-rmpg-200">
                                  <span className="text-brand-gold-500 uppercase text-[7px] font-black">{(cb.role || '').replace(/_/g, ' ')}</span>
                                  {cb.name}
                                  {cb.business_type && <span className="text-rmpg-500">{cb.business_type}</span>}
                                  <button type="button" onClick={() => unlinkBusinessFromCall(selectedCall.id, cb.id)} className="text-red-500 hover:text-red-300 ml-0.5" title="Remove">&times;</button>
                                </span>
                              ))}
                            </div>
                          )}
                          <div className="relative" ref={businessDropdownRef}>
                            <input type="text" className="input-dark text-xs" placeholder="Search business records to link..." value={businessQuery} onChange={(e) => searchBusinesses(e.target.value)} onFocus={() => { if (businessSearchResults.length > 0) setShowBusinessDropdown(true); }} />
                            {showBusinessDropdown && businessSearchResults.length > 0 && (
                              <div className="absolute z-50 left-0 right-0 mt-0.5 max-h-40 overflow-y-auto border border-rmpg-500 bg-rmpg-800 rounded-sm shadow-lg">
                                {businessSearchResults.map((b: any) => (
                                  <button type="button" key={b.id} className="w-full text-left px-2 py-1 text-[10px] text-rmpg-200 hover:bg-brand-500/20 border-b border-rmpg-700 last:border-0" onClick={() => {
                                    linkBusinessToCall(selectedCall.id, b.id, linkBusinessRole);
                                    setBusinessQuery(''); setShowBusinessDropdown(false);
                                  }}>
                                    <span className="font-semibold text-white">{b.name}</span>
                                    {b.address && <span className="text-rmpg-500 ml-1 text-[9px]">— {b.address}</span>}
                                  </button>
                                ))}
                              </div>
                            )}
                            {businessQuery.trim().length >= 2 && businessSearchResults.length === 0 && (
                              <button type="button" onClick={() => quickAddBusiness(selectedCall.id, businessQuery.trim(), linkBusinessRole)} className="mt-0.5 inline-flex items-center gap-1 px-2 py-1 text-[9px] font-bold uppercase text-brand-400 bg-brand-900/30 border border-brand-700/40 hover:bg-brand-900/50 transition-colors">
                                <PlusCircle className="w-3 h-3" /> Add "{businessQuery.trim()}"
                              </button>
                            )}
                          </div>
                        </div>
```

- [ ] **Step 4: Typecheck + build**

Run: `cd client && npx tsc --noEmit && npx vite build`
Expected: no errors; build succeeds. (`useRef`/`PlusCircle` are already imported in this file.)

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/dispatch/DispatchPage.tsx
git commit -m "feat(client): Linked Businesses block on the call Persons/Vehicles tab"
```

---

## Task 8: `clientAutofill.ts` — fill-blanks mapping (review-and-adjust)

**Files:**
- Create: `client/src/utils/clientAutofill.ts`
- Test: `client/src/utils/clientAutofill.test.ts`

> **User decision point:** the field mapping below is a complete, working default.
> Confirm or adjust which client field feeds which call field (and the default
> `caller_relationship`) before/while implementing — this is the one genuinely
> RMPG-specific business rule in the build.

- [ ] **Step 1: Write the failing test**

Create `client/src/utils/clientAutofill.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { autofillFromClient, applyFillBlanks } from './clientAutofill';

const client = {
  id: '7', name: 'ICU Investigations, LLC.', contact_name: 'Jane Doe',
  contact_phone: '(435) 976-1200', contact_email: 'a1@example.com',
  address: '250 N Red Cliffs Dr', client_code: '0175',
  contracts: [{ id: 99 }],
};

describe('autofillFromClient', () => {
  it('maps client fields to call fields', () => {
    const patch = autofillFromClient(client as any);
    expect(patch.caller_name).toBe('Jane Doe');
    expect(patch.caller_phone).toBe('(435) 976-1200');
    expect(patch.pso_requestor_email).toBe('a1@example.com');
    expect(patch.pso_billing_code).toBe('0175');
    expect(patch.caller_relationship).toBe('client');
  });
});

describe('applyFillBlanks', () => {
  it('fills only blank fields, never overwrites', () => {
    const current = { caller_name: 'Typed Already', caller_phone: '' };
    const next = applyFillBlanks(current, { caller_name: 'Jane Doe', caller_phone: '(435) 976-1200' });
    expect(next.caller_name).toBe('Typed Already'); // preserved
    expect(next.caller_phone).toBe('(435) 976-1200'); // filled
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/utils/clientAutofill.test.ts`
Expected: FAIL — `Cannot find module './clientAutofill'`.

- [ ] **Step 3: Write the implementation**

Create `client/src/utils/clientAutofill.ts`:

```ts
// Maps a Client record onto CFS edit fields, FILL-BLANKS-ONLY.
// autofillFromClient() returns the candidate patch; applyFillBlanks() merges it
// into the current edit state without overwriting anything already entered.

export interface ClientRecord {
  id: string | number;
  name?: string;
  contact_name?: string;
  contact_phone?: string;
  contact_email?: string;
  address?: string;
  client_code?: string;
  contracts?: Array<{ id: number | string }>;
}

/** Candidate values to fill from the selected client. Adjust mappings to taste. */
export function autofillFromClient(client: ClientRecord): Record<string, string> {
  const patch: Record<string, string> = {};
  const set = (k: string, v: unknown) => { if (v != null && String(v).trim() !== '') patch[k] = String(v); };

  // Caller block
  set('caller_name', client.contact_name);
  set('caller_phone', client.contact_phone);
  set('caller_address', client.address);
  set('caller_relationship', 'client'); // default relationship when a client is the caller

  // PSO / Process-Service requestor block
  set('pso_requestor_name', client.contact_name);
  set('pso_requestor_phone', client.contact_phone);
  set('pso_requestor_email', client.contact_email);
  set('pso_billing_code', client.client_code);

  // Contract linkage — first/most-recent contract id, if hydrated
  if (Array.isArray(client.contracts) && client.contracts.length > 0) {
    set('contract_id', client.contracts[0].id);
  }
  return patch;
}

function isBlank(v: unknown): boolean {
  return v == null || (typeof v === 'string' && v.trim() === '');
}

/** Merge patch into current, filling only blank keys. Pure — returns a new object. */
export function applyFillBlanks<T extends Record<string, any>>(current: T, patch: Record<string, string>): T {
  const next: Record<string, any> = { ...current };
  for (const [k, v] of Object.entries(patch)) if (isBlank(next[k])) next[k] = v;
  return next as T;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/utils/clientAutofill.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add client/src/utils/clientAutofill.ts client/src/utils/clientAutofill.test.ts
git commit -m "feat(client): clientAutofill fill-blanks mapping helper"
```

---

## Task 9: Wire autofill into the DispatchPage client selector

**Files:**
- Modify: `client/src/pages/dispatch/DispatchPage.tsx` (client `<select>` at `4182`; add a handler)

- [ ] **Step 1: Add the change handler**

Near the other edit handlers (after the linked-business functions from Task 7), add:

```tsx
  const handleClientChange = useCallback(async (clientId: string) => {
    updateEditField('client_id', clientId);
    if (!clientId) return;
    try {
      const full = await apiFetch<ClientRecord>(`/clients/${clientId}`);
      const patch = autofillFromClient(full);
      setEditData((prev: any) => applyFillBlanks(prev, patch));
    } catch (err) {
      console.error('Client autofill failed (non-fatal):', err);
    }
  }, []);
```

Add imports at the top:

```tsx
import { autofillFromClient, applyFillBlanks, type ClientRecord } from '../../utils/clientAutofill';
```

> If `setEditData` is not the state setter's name in this component, grep `setEditData\|const \[editData` near line 1850 and use the actual setter. The apply must go through the setter so the edit form re-renders with the filled values.

- [ ] **Step 2: Point the client `<select>` at the handler**

Change the client select's `onChange` (line ~4182) from `onChange={(e) => updateEditField('client_id', e.target.value)}` to:

```tsx
                            <select className="select-dark text-xs mt-0.5" value={editData.client_id || ''} onChange={(e) => handleClientChange(e.target.value)}>
```

- [ ] **Step 3: Typecheck + build**

Run: `cd client && npx tsc --noEmit && npx vite build`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/dispatch/DispatchPage.tsx
git commit -m "feat(client): autofill caller/PSO fields from selected client (fill-blanks)"
```

---

## Task 10: Contract/Client chip in the PSO panel

**Files:**
- Modify: `client/src/pages/dispatch/DispatchPage.tsx` (PSO CLIENT REQUEST DETAILS panel header, around `5015-5106`)

- [ ] **Step 1: Render the chip**

Inside the PSO panel, just below its section title (around line 5018, before the requestor fields), add a read-only chip that shows the selected client + contract/billing/auth context:

```tsx
                        {(selectedCall.client_id || editData.client_id) && (() => {
                          const cid = String(editData.client_id || selectedCall.client_id);
                          const cli = clientsList.find((c) => String(c.id) === cid);
                          const contractId = editData.contract_id || (selectedCall as any).contract_id;
                          const billing = editData.pso_billing_code || selectedCall.pso_billing_code;
                          const auth = editData.pso_authorization || selectedCall.pso_authorization;
                          return (
                            <div className="mb-2 inline-flex flex-wrap items-center gap-2 px-2 py-1 bg-brand-900/20 border border-brand-700/40 rounded-sm text-[10px]">
                              <span className="text-brand-gold-500 uppercase font-black text-[8px] tracking-wide">Client</span>
                              <span className="text-white font-semibold">{cli?.name || `#${cid}`}</span>
                              {contractId && <span className="text-rmpg-300">Contract: {contractId}</span>}
                              {billing && <span className="text-rmpg-300">Billing: {billing}</span>}
                              {auth && <span className="text-rmpg-300">Auth: {auth}</span>}
                            </div>
                          );
                        })()}
```

- [ ] **Step 2: Typecheck + build**

Run: `cd client && npx tsc --noEmit && npx vite build`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/dispatch/DispatchPage.tsx
git commit -m "feat(client): client/contract context chip in PSO panel"
```

---

## Task 11: Admin link-options CRUD endpoints

**Files:**
- Modify: `src/routes/linkOptions.ts` (add admin router export)
- Modify: `src/routesConfig.ts` (import + registry entry)

- [ ] **Step 1: Add the admin router**

Append to `src/routes/linkOptions.ts`:

```ts
import { execute, queryFirst } from '../utils/db';
import { requireRole } from '../middleware/auth';

// Admin router — mounted at /api/admin/link-options. admin/manager only.
export const linkOptionsAdmin = new Hono<Env>();

// GET (all rows incl. inactive, for the editor)
linkOptionsAdmin.get('/', requireRole('admin', 'manager'), async (c) => {
  const db = getDb(c.env);
  const rows = await query<Record<string, unknown>>(
    db, 'SELECT * FROM link_options ORDER BY category, sort_order',
  );
  return c.json(rows);
});

// POST — add a custom option { category, value, label, sort_order? }
linkOptionsAdmin.post('/', requireRole('admin', 'manager'), async (c) => {
  const db = getDb(c.env);
  const b = await c.req.json<{ category: string; value: string; label: string; sort_order?: number }>();
  if (!b.category || !b.value || !b.label) return c.json({ error: 'category, value, label required' }, 400);
  await execute(
    db,
    `INSERT OR IGNORE INTO link_options (category, value, label, sort_order, is_active, is_default)
     VALUES (?, ?, ?, ?, 1, 0)`,
    b.category, b.value.trim(), b.label.trim(), b.sort_order ?? 500,
  );
  const row = await queryFirst(db, 'SELECT * FROM link_options WHERE category = ? AND value = ?', b.category, b.value.trim());
  return c.json(row, 201);
});

// PATCH /:id — edit label / sort_order / is_active
linkOptionsAdmin.patch('/:id', requireRole('admin', 'manager'), async (c) => {
  const db = getDb(c.env);
  const id = c.req.param('id');
  const b = await c.req.json<{ label?: string; sort_order?: number; is_active?: number }>();
  const sets: string[] = []; const params: unknown[] = [];
  if (b.label !== undefined) { sets.push('label = ?'); params.push(b.label); }
  if (b.sort_order !== undefined) { sets.push('sort_order = ?'); params.push(b.sort_order); }
  if (b.is_active !== undefined) { sets.push('is_active = ?'); params.push(b.is_active ? 1 : 0); }
  if (sets.length === 0) return c.json({ error: 'No fields' }, 400);
  sets.push("updated_at = datetime('now')");
  params.push(id);
  await execute(db, `UPDATE link_options SET ${sets.join(', ')} WHERE id = ?`, ...params);
  const row = await queryFirst(db, 'SELECT * FROM link_options WHERE id = ?', id);
  return c.json(row);
});

// DELETE /:id — hard-delete custom rows only; defaults are hidden, not deleted.
linkOptionsAdmin.delete('/:id', requireRole('admin', 'manager'), async (c) => {
  const db = getDb(c.env);
  const id = c.req.param('id');
  const row = await queryFirst<{ is_default: number }>(db, 'SELECT is_default FROM link_options WHERE id = ?', id);
  if (!row) return c.json({ error: 'Not found' }, 404);
  if (row.is_default) {
    await execute(db, "UPDATE link_options SET is_active = 0, updated_at = datetime('now') WHERE id = ?", id);
    return c.json({ success: true, hidden: true });
  }
  await execute(db, 'DELETE FROM link_options WHERE id = ?', id);
  return c.json({ success: true, deleted: true });
});
```

> **Note:** confirm `requireRole` is exported from `src/middleware/auth.ts` with a rest-param signature (it's used as `requireRole(...WRITE_ROLES)` in `calls.ts`). If the import path differs, match `calls.ts`'s import.

- [ ] **Step 2: Register the admin router**

In `src/routesConfig.ts`, extend the existing import to include the admin router:

```ts
import { linkOptions as linkOptionsRead, linkOptionsAdmin } from './routes/linkOptions';
```

Add to `ROUTE_REGISTRY`, near the `/api/admin` entries (after line ~268):

```ts
  { prefix: '/api/admin/link-options', router: linkOptionsAdmin, auth: 'required' },
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/routes/linkOptions.ts src/routesConfig.ts
git commit -m "feat(api): admin CRUD for link_options"
```

---

## Task 12: Admin "Linkage Options" editor UI

**Files:**
- Create: `client/src/components/admin/LinkageOptionsEditor.tsx`
- Modify: `client/src/pages/AdminPage.tsx` (`TabId` union `231`; a `tabGroups` entry `641`; render switch)

- [ ] **Step 1: Build the editor component**

Create `client/src/components/admin/LinkageOptionsEditor.tsx`:

```tsx
import { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../../hooks/useApi';
import { Plus } from 'lucide-react';

interface Row { id: number; category: string; value: string; label: string; sort_order: number; is_active: number; is_default: number; }
const CATEGORIES = [
  { key: 'person_role', label: 'Person Roles' },
  { key: 'vehicle_role', label: 'Vehicle Roles' },
  { key: 'caller_relationship', label: 'Caller Relationships' },
  { key: 'business_role', label: 'Business Roles' },
];

export default function LinkageOptionsEditor() {
  const [rows, setRows] = useState<Row[]>([]);
  const [cat, setCat] = useState('person_role');
  const [newValue, setNewValue] = useState('');
  const [newLabel, setNewLabel] = useState('');

  const load = useCallback(() => {
    apiFetch<Row[]>('/admin/link-options').then((r) => setRows(Array.isArray(r) ? r : [])).catch(() => setRows([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  const patch = async (id: number, body: Partial<Row>) => {
    await apiFetch(`/admin/link-options/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
    load();
  };
  const remove = async (id: number) => {
    await apiFetch(`/admin/link-options/${id}`, { method: 'DELETE' });
    load();
  };
  const add = async () => {
    if (!newValue.trim() || !newLabel.trim()) return;
    await apiFetch('/admin/link-options', { method: 'POST', body: JSON.stringify({ category: cat, value: newValue.trim().toLowerCase().replace(/\s+/g, '_'), label: newLabel.trim() }) });
    setNewValue(''); setNewLabel(''); load();
  };

  const catRows = rows.filter((r) => r.category === cat).sort((a, b) => a.sort_order - b.sort_order);

  return (
    <div className="p-4 space-y-3">
      <div className="flex gap-1 flex-wrap">
        {CATEGORIES.map((c) => (
          <button key={c.key} onClick={() => setCat(c.key)} className={`px-2 py-1 text-[10px] uppercase font-bold border rounded-sm ${cat === c.key ? 'bg-brand-900/40 text-brand-300 border-brand-600/40' : 'text-rmpg-400 border-rmpg-600'}`}>{c.label}</button>
        ))}
      </div>
      <table className="w-full text-xs">
        <thead><tr className="text-brand-gold-500 text-[9px] uppercase"><th className="text-left py-[3px]">Label</th><th className="text-left">Value</th><th>Sort</th><th>Active</th><th></th></tr></thead>
        <tbody>
          {catRows.map((r) => (
            <tr key={r.id} className="border-t border-rmpg-700">
              <td className="py-[2px]"><input className="input-dark text-xs w-full" defaultValue={r.label} onBlur={(e) => e.target.value !== r.label && patch(r.id, { label: e.target.value })} /></td>
              <td className="text-rmpg-500 font-mono text-[10px]">{r.value}{r.is_default ? '' : ' *'}</td>
              <td className="text-center"><input type="number" className="input-dark text-xs w-14" defaultValue={r.sort_order} onBlur={(e) => Number(e.target.value) !== r.sort_order && patch(r.id, { sort_order: Number(e.target.value) })} /></td>
              <td className="text-center"><input type="checkbox" checked={!!r.is_active} onChange={(e) => patch(r.id, { is_active: e.target.checked ? 1 : 0 })} /></td>
              <td className="text-center"><button onClick={() => remove(r.id)} className="text-red-500 hover:text-red-300" title={r.is_default ? 'Hide' : 'Delete'}>&times;</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex items-end gap-2 pt-2 border-t border-rmpg-700">
        <div><label className="text-[9px] text-brand-gold-500">New label</label><input className="input-dark text-xs" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Co-Signer" /></div>
        <div><label className="text-[9px] text-brand-gold-500">Value (slug)</label><input className="input-dark text-xs" value={newValue} onChange={(e) => setNewValue(e.target.value)} placeholder="co_signer" /></div>
        <button onClick={add} className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-bold uppercase text-brand-400 bg-brand-900/30 border border-brand-700/40"><Plus className="w-3 h-3" /> Add</button>
      </div>
      <p className="text-[9px] text-rmpg-500">* = custom (hard-deletable). Seeded defaults are hidden (uncheck Active), not deleted.</p>
    </div>
  );
}
```

- [ ] **Step 2: Add the Admin tab**

In `client/src/pages/AdminPage.tsx`:
- Extend the `TabId` union (line 231) with `| 'linkage'`.
- Add to a `tabGroups` entry's `tabs` array (e.g. the System/config group around line 665): `{ id: 'linkage', label: 'Linkage Options', icon: Link2 },` — ensure `Link2` is imported from `lucide-react` (add it to the existing lucide import if absent).
- Add the render branch alongside the other `{activeTab === '...' && (...)}` blocks (near line 876):

```tsx
        {activeTab === 'linkage' && <LinkageOptionsEditor />}
```
- Import the component at the top: `import LinkageOptionsEditor from '../components/admin/LinkageOptionsEditor';`

- [ ] **Step 3: Typecheck + build**

Run: `cd client && npx tsc --noEmit && npx vite build`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/admin/LinkageOptionsEditor.tsx client/src/pages/AdminPage.tsx
git commit -m "feat(admin): Linkage Options editor (configure linkage dropdowns)"
```

---

## Task 13: Service-worker bump + full verification

**Files:**
- Modify: `client/public/sw.js` (`CACHE_NAME`)

- [ ] **Step 1: Bump the cache name**

Find the current `CACHE_NAME` (grep `CACHE_NAME` in `client/public/sw.js` — currently `v916`-era per recent commits) and increment it (e.g. `rmpg-flex-v917`). Match the existing exact string format.

- [ ] **Step 2: Run the full local gate (mirrors CI + pre-push)**

```bash
npm run typecheck
cd client && npx tsc --noEmit && npx vitest run && npx vite build && cd ..
```
Expected: worker typecheck clean; client types clean; all vitest pass (incl. the 8 new tests across Tasks 2/3/8); build succeeds.

- [ ] **Step 3: Commit**

```bash
git add client/public/sw.js
git commit -m "chore(sw): bump cache for dispatch linkage + client autofill"
```

- [ ] **Step 4: Push + open PR (per project flow)**

```bash
git push -u origin claude/nostalgic-mestorf-fceff1
gh pr create --title "Dispatch linkage expansion + client-data autofill" --body "<summary + test plan + 'apply migration 0104 to live D1 post-merge' reminder>"
```

- [ ] **Step 5: Post-merge release step (NOT a commit)**

After merge, apply `migrations/0104_link_options.sql` directly to live `rmpg-flex` (`785de7ae-…`) via the D1 API and verify `SELECT COUNT(*) FROM link_options` = 54 and `pragma_table_info('link_options')`. Then browser-verify: open a PSO call → Persons/Vehicles tab shows expanded role dropdowns + Linked Businesses; select a client → caller/requestor blanks fill; Admin → Linkage Options edits a label and it reflects in the dropdown.

---

## Self-Review

**Spec coverage:**
- Admin-configurable option lists → Tasks 1, 4, 11, 12 ✅
- Expanded default roles (person/caller/business) → Tasks 1, 2 ✅
- Person/vehicle/caller dropdowns driven by options → Task 5 ✅
- Link Businesses to calls (endpoints + UI) → Tasks 6, 7 ✅
- Client-data autofill (fill-blanks) → Tasks 8, 9 ✅
- Contract/Client link chip → Task 10 ✅
- Robust fallback (defaults when DB empty/unreachable) → Tasks 2, 3, 4 ✅
- No `ALTER calls_for_service`; live-D1 apply step; SW bump → Tasks 1, 13 ✅

**Type consistency:** `LinkOption`/`LinkCategory`/`mergeLinkOptions` (Task 2) are consumed unchanged by `useLinkOptions` (Task 3) and the read endpoint's shape (Task 4). `autofillFromClient`/`applyFillBlanks`/`ClientRecord` (Task 8) are consumed unchanged in Task 9. `call_businesses` columns (`role`, `notes`, `created_at`, `added_by`) match migration 0023 in Task 6's SQL. Admin endpoints (Task 11) write the same `link_options` columns the editor (Task 12) reads.

**Placeholder scan:** Task 8's mapping is a *complete working default* flagged for user review — not a placeholder. The two `> Note` callouts (Task 6 `BusinessInput`, Task 11 `requireRole`) are verification instructions with concrete fallbacks, not gaps.
