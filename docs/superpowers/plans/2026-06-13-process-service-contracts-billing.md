# Process Service Contracts & Billing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make process-service contracts first-class with a dynamic pricing rate card, link serve jobs to contracts, auto-compute review-gated charges when a job completes (served or non-est), and generate invoices from approved charges — surfaced as new tabs in Patrol Management.

**Architecture:** A pure, unit-tested charge engine (`computeServeCharges`) sits behind a DB-aware store that reads contract terms + the editable pricing rate card and upserts `serve_charges`/`serve_charge_lines`. A best-effort hook in `serve.ts` fires the store when a job's status flips to `served`/`failed`. A new `/api/billing` router exposes pricing CRUD, contract terms, the review queue, and invoice-from-charges. Three new Patrol Management tabs (Pricing, Contracts, Billing Review) drive it. Every contract/pricing/charge write is logged to the existing `activity_log`.

**Tech Stack:** Cloudflare Workers + Hono, D1 (via `src/utils/db.ts` helpers), React 18 + Vite + Tailwind, vitest (worker tests in `tests/`, node env; client tests in `client/` jsdom env).

**Spec:** [docs/superpowers/specs/2026-06-13-process-service-contracts-billing-design.md](../specs/2026-06-13-process-service-contracts-billing-design.md)

---

## File Structure

**Create:**
- `migrations/0104_process_service_billing.sql` — 4 new tables + 1 ALTER + pricing seed.
- `src/utils/serveCharges.ts` — pure charge engine + types (no DB).
- `src/utils/serveChargeStore.ts` — DB-aware fact-gathering + upsert; calls the pure engine.
- `src/routes/serveBilling.ts` — new Hono router: pricing, contract terms, serve-charges review, invoice-from-charges.
- `tests/serveCharges.test.ts` — pure engine unit tests.
- `client/src/hooks/usePsBilling.ts` — fetch/mutate helpers for pricing, terms, charges.
- `client/src/pages/patrol/psBillingHelpers.ts` — pure helpers (pricing-edit, charge summary) shared by tabs + tests.
- `client/src/pages/patrol/PricingTab.tsx` — editable rate card.
- `client/src/pages/patrol/ContractsTab.tsx` — PS contracts + terms + audit history.
- `client/src/pages/patrol/BillingReviewTab.tsx` — review queue → approve/void → generate invoice.
- `client/src/pages/patrol/__tests__/psBillingHelpers.test.ts` — pure helper tests.

**Modify:**
- `src/routes/serve.ts` — best-effort charge generation in `logAttempt` + `substitute-service`; accept `contract_id` on create/update.
- `src/routesConfig.ts` — mount `serveBilling` at `/api/billing`.
- `client/src/pages/PatrolPage.tsx` — add `pricing`/`contracts`/`billing` tabs + render branches.
- `client/public/sw.js` — bump `CACHE_NAME`.

**Reference (read, do not change):**
- `src/routes/billing.ts` — contract/invoice CRUD + `recalcInvoiceTotal`, `requireRole`, `generateInvoiceNumber` patterns to mirror.
- `src/utils/db.ts` — `getDb`, `query`, `queryFirst`, `execute`, `columnExists`.
- `client/src/pages/patrol/MileageAuditTab.tsx` — existing Patrol tab component pattern (PanelTitleBar, apiFetch, tokens).

---

## Conventions for every task

- **DB access:** `const db = getDb(c.env);` then `query<T>(db, sql, ...binds)` / `queryFirst<T>(...)` / `execute(...)`. All are async — always `await`.
- **Role gate (copy the local helper, as `billing.ts`/`serve.ts` both do):**
  ```ts
  function requireRole(c: { get: (k: 'user') => { role: string } | undefined }, ...roles: string[]): string | null {
    const u = c.get('user');
    if (!u || !roles.includes(u.role)) return 'Insufficient role';
    return null;
  }
  ```
- **Worker tests:** `npm test` (vitest, node env, picks up `tests/**/*.test.ts`).
- **Client typecheck/build:** `cd client && npx tsc --noEmit` and `npx vite build`.
- **Money:** round every line total and subtotal to cents with `Math.round(x * 100) / 100`.
- **Commits:** small, after each green step. Final shipping is via PR (`gh pr create`), not direct push.

---

# Milestone 1 — Schema + charge engine

## Task 1: Migration `0104_process_service_billing.sql`

**Files:**
- Create: `migrations/0104_process_service_billing.sql`

- [ ] **Step 1: Write the migration**

```sql
-- ============================================================
-- 0104_process_service_billing.sql
-- Process Service Contracts billing: dynamic pricing rate card,
-- per-contract PS terms, computed serve charges + review state.
-- All idempotent. serve_queue is NOT on the column-cap watch list,
-- so the single ALTER is safe.
-- ============================================================

-- ── Dynamic pricing rate card (the rmpgutahps.us pricing source of truth) ──
CREATE TABLE IF NOT EXISTS ps_pricing_items (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  code              TEXT NOT NULL UNIQUE,
  label             TEXT NOT NULL,
  unit              TEXT NOT NULL DEFAULT 'per_serve'
                      CHECK(unit IN ('per_serve','per_attempt','per_mile','per_hour','flat')),
  amount            REAL NOT NULL DEFAULT 0,
  taxable           INTEGER NOT NULL DEFAULT 1,
  attempts_included INTEGER NOT NULL DEFAULT 0,
  is_active         INTEGER NOT NULL DEFAULT 1,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  updated_at        TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_by        INTEGER
);

-- ── Per-contract process-service terms (1:1 ext of client_contracts) ──
CREATE TABLE IF NOT EXISTS ps_contract_terms (
  contract_id         INTEGER PRIMARY KEY REFERENCES client_contracts(id) ON DELETE CASCADE,
  billing_trigger     TEXT NOT NULL DEFAULT 'on_completion'
                        CHECK(billing_trigger IN ('on_completion','on_service','per_attempt','manual')),
  sla_days            INTEGER,
  retainer_amount     REAL,
  doc_types_json      TEXT,
  rate_overrides_json TEXT,
  notes               TEXT,
  updated_at          TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_by          INTEGER
);

-- ── Computed charge header (one per billable job) ──
CREATE TABLE IF NOT EXISTS serve_charges (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  serve_queue_id INTEGER NOT NULL UNIQUE REFERENCES serve_queue(id) ON DELETE CASCADE,
  contract_id    INTEGER,
  status         TEXT NOT NULL DEFAULT 'pending_review'
                   CHECK(status IN ('pending_review','approved','invoiced','void')),
  subtotal       REAL NOT NULL DEFAULT 0,
  tax_amount     REAL NOT NULL DEFAULT 0,
  computed_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  reviewed_by    INTEGER,
  reviewed_at    TEXT,
  invoice_id     INTEGER,
  notes          TEXT
);
CREATE INDEX IF NOT EXISTS idx_serve_charges_status ON serve_charges(status);
CREATE INDEX IF NOT EXISTS idx_serve_charges_contract ON serve_charges(contract_id);

-- ── Charge line breakdown (mirrors invoice_line_items) ──
CREATE TABLE IF NOT EXISTS serve_charge_lines (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  serve_charge_id INTEGER NOT NULL REFERENCES serve_charges(id) ON DELETE CASCADE,
  pricing_code    TEXT,
  description     TEXT NOT NULL,
  quantity        REAL NOT NULL DEFAULT 1,
  unit_price      REAL NOT NULL DEFAULT 0,
  line_total      REAL NOT NULL DEFAULT 0,
  taxable         INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_serve_charge_lines_charge ON serve_charge_lines(serve_charge_id);

-- ── Link serve jobs to their contract (single ALTER; no IF NOT EXISTS on ADD COLUMN in D1) ──
ALTER TABLE serve_queue ADD COLUMN contract_id INTEGER;

-- ── Seed standard pricing codes at amount 0 (owner sets real prices in the UI) ──
INSERT OR IGNORE INTO ps_pricing_items (code, label, unit, amount, taxable, attempts_included, sort_order) VALUES
  ('flat_serve',    'Standard Service',        'per_serve',   0, 1, 0, 10),
  ('rush',          'Rush / Same-Day',         'flat',        0, 1, 0, 20),
  ('extra_attempt', 'Additional Attempt',      'per_attempt', 0, 1, 3, 30),
  ('skip_trace',    'Skip Trace',              'flat',        0, 1, 0, 40),
  ('mileage',       'Mileage',                 'per_mile',    0, 0, 0, 50),
  ('wait',          'Stakeout / Wait Time',    'per_hour',    0, 1, 0, 60);
```

- [ ] **Step 2: Apply to local D1 and verify**

Run: `npm run migrate:local`
Then verify the table + column exist locally:
Run: `npx wrangler d1 execute rmpg-flex --local --command "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('ps_pricing_items','ps_contract_terms','serve_charges','serve_charge_lines');"`
Expected: 4 rows.
Run: `npx wrangler d1 execute rmpg-flex --local --command "SELECT name FROM pragma_table_info('serve_queue') WHERE name='contract_id';"`
Expected: 1 row (`contract_id`).

- [ ] **Step 3: Commit**

```bash
git add migrations/0104_process_service_billing.sql
git commit -m "feat(billing): 0104 process-service billing schema (pricing, terms, charges)"
```

> **Live-apply note (do at deploy, per CLAUDE.md migration-drift gotcha):** after merge, also apply this DDL directly to live D1 `785de7ae-…` via the Cloudflare D1 API and verify with `pragma_table_info`. The deploy step is `continue-on-error`.

---

## Task 2: Pure charge engine `serveCharges.ts` (TDD)

**Files:**
- Create: `src/utils/serveCharges.ts`
- Test: `tests/serveCharges.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/serveCharges.test.ts
import { describe, it, expect } from 'vitest';
import { computeServeCharges, type PricingItem, type ContractTerms, type ServeJobFacts } from '../src/utils/serveCharges';

const PRICING: PricingItem[] = [
  { code: 'flat_serve',    label: 'Standard Service',   unit: 'per_serve',   amount: 65, taxable: true,  attempts_included: 0 },
  { code: 'rush',          label: 'Rush / Same-Day',    unit: 'flat',        amount: 40, taxable: true,  attempts_included: 0 },
  { code: 'extra_attempt', label: 'Additional Attempt', unit: 'per_attempt', amount: 15, taxable: true,  attempts_included: 3 },
  { code: 'skip_trace',    label: 'Skip Trace',         unit: 'flat',        amount: 25, taxable: true,  attempts_included: 0 },
  { code: 'mileage',       label: 'Mileage',            unit: 'per_mile',    amount: 0.7, taxable: false, attempts_included: 0 },
  { code: 'wait',          label: 'Wait Time',          unit: 'per_hour',    amount: 30, taxable: true,  attempts_included: 0 },
];

const TERMS = (overrides: Record<string, number> = {}): ContractTerms => ({
  contract_id: 1, billing_trigger: 'on_completion', rate_overrides: overrides,
});

const JOB = (p: Partial<ServeJobFacts> = {}): ServeJobFacts => ({
  serve_queue_id: 100, priority: 'normal', attempt_count: 1,
  has_skip_trace: false, mileage: null, wait_hours: null, ...p,
});

describe('computeServeCharges', () => {
  it('bills the flat base on a single normal attempt (served)', () => {
    const r = computeServeCharges(JOB(), TERMS(), PRICING);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toMatchObject({ pricing_code: 'flat_serve', quantity: 1, unit_price: 65, line_total: 65 });
    expect(r.subtotal).toBe(65);
  });

  it('still bills the base on non-est (failed) jobs', () => {
    const r = computeServeCharges(JOB({ attempt_count: 3 }), TERMS(), PRICING);
    // 3 attempts == attempts_included(3) → no extra_attempt line, base only
    expect(r.subtotal).toBe(65);
  });

  it('adds rush surcharge when priority is rush or urgent', () => {
    expect(computeServeCharges(JOB({ priority: 'rush' }), TERMS(), PRICING).subtotal).toBe(105);
    expect(computeServeCharges(JOB({ priority: 'urgent' }), TERMS(), PRICING).subtotal).toBe(105);
  });

  it('charges extra attempts beyond attempts_included', () => {
    const r = computeServeCharges(JOB({ attempt_count: 5 }), TERMS(), PRICING); // 5-3=2 extra
    const extra = r.lines.find(l => l.pricing_code === 'extra_attempt');
    expect(extra).toMatchObject({ quantity: 2, unit_price: 15, line_total: 30 });
    expect(r.subtotal).toBe(95);
  });

  it('adds skip trace, mileage, and wait when present', () => {
    const r = computeServeCharges(JOB({ has_skip_trace: true, mileage: 10, wait_hours: 2 }), TERMS(), PRICING);
    expect(r.lines.find(l => l.pricing_code === 'skip_trace')?.line_total).toBe(25);
    expect(r.lines.find(l => l.pricing_code === 'mileage')).toMatchObject({ quantity: 10, line_total: 7 });
    expect(r.lines.find(l => l.pricing_code === 'wait')).toMatchObject({ quantity: 2, line_total: 60 });
    expect(r.subtotal).toBe(65 + 25 + 7 + 60);
  });

  it('honors per-contract rate overrides over the rate card', () => {
    const r = computeServeCharges(JOB(), TERMS({ flat_serve: 80 }), PRICING);
    expect(r.lines[0].line_total).toBe(80);
    expect(r.subtotal).toBe(80);
  });

  it('always emits the base line even when unpriced (amount 0)', () => {
    const zero = PRICING.map(p => p.code === 'flat_serve' ? { ...p, amount: 0 } : p);
    const r = computeServeCharges(JOB(), TERMS(), zero);
    expect(r.lines[0]).toMatchObject({ pricing_code: 'flat_serve', unit_price: 0, line_total: 0 });
    expect(r.subtotal).toBe(0);
  });

  it('omits optional add-ons when their rate is 0', () => {
    const zeroRush = PRICING.map(p => p.code === 'rush' ? { ...p, amount: 0 } : p);
    const r = computeServeCharges(JOB({ priority: 'rush' }), TERMS(), zeroRush);
    expect(r.lines.find(l => l.pricing_code === 'rush')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- serveCharges`
Expected: FAIL — `Cannot find module '../src/utils/serveCharges'`.

- [ ] **Step 3: Write the engine**

```ts
// src/utils/serveCharges.ts
// Pure process-service charge engine. No DB access — fully unit-testable.

export interface PricingItem {
  code: string;
  label: string;
  unit: 'per_serve' | 'per_attempt' | 'per_mile' | 'per_hour' | 'flat';
  amount: number;
  taxable: boolean;
  attempts_included: number;
}

export interface ContractTerms {
  contract_id: number | null;
  billing_trigger: string;
  rate_overrides: Record<string, number>;
}

export interface ServeJobFacts {
  serve_queue_id: number;
  priority: string | null;       // 'rush'|'urgent' → rush surcharge
  attempt_count: number;
  has_skip_trace: boolean;
  mileage: number | null;        // miles (manual in Phase 1)
  wait_hours: number | null;     // hours (manual in Phase 1)
}

export interface ChargeLine {
  pricing_code: string;
  description: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  taxable: boolean;
}

export interface ComputedCharges {
  lines: ChargeLine[];
  subtotal: number;
}

const cents = (n: number) => Math.round(n * 100) / 100;

export function computeServeCharges(
  job: ServeJobFacts,
  terms: ContractTerms,
  pricing: PricingItem[],
): ComputedCharges {
  const byCode = new Map(pricing.map((p) => [p.code, p]));
  const priceOf = (code: string): number =>
    terms.rate_overrides?.[code] ?? byCode.get(code)?.amount ?? 0;
  const taxableOf = (code: string): boolean => byCode.get(code)?.taxable ?? true;
  const labelOf = (code: string): string => byCode.get(code)?.label ?? code;

  const lines: ChargeLine[] = [];
  const push = (code: string, quantity: number, unitPrice: number) => {
    lines.push({
      pricing_code: code,
      description: labelOf(code),
      quantity,
      unit_price: cents(unitPrice),
      line_total: cents(quantity * unitPrice),
      taxable: taxableOf(code),
    });
  };

  // Base — always present (even at $0) so the reviewer sees the job.
  push('flat_serve', 1, priceOf('flat_serve'));

  // Rush surcharge.
  if ((job.priority === 'rush' || job.priority === 'urgent') && priceOf('rush') > 0) {
    push('rush', 1, priceOf('rush'));
  }

  // Extra attempts beyond the included count.
  const included = byCode.get('extra_attempt')?.attempts_included ?? 0;
  const extra = Math.max(0, (job.attempt_count ?? 0) - included);
  if (extra > 0 && priceOf('extra_attempt') > 0) {
    push('extra_attempt', extra, priceOf('extra_attempt'));
  }

  // Add-ons.
  if (job.has_skip_trace && priceOf('skip_trace') > 0) push('skip_trace', 1, priceOf('skip_trace'));
  if (job.mileage && job.mileage > 0 && priceOf('mileage') > 0) push('mileage', cents(job.mileage), priceOf('mileage'));
  if (job.wait_hours && job.wait_hours > 0 && priceOf('wait') > 0) push('wait', cents(job.wait_hours), priceOf('wait'));

  const subtotal = cents(lines.reduce((s, l) => s + l.line_total, 0));
  return { lines, subtotal };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- serveCharges`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/utils/serveCharges.ts tests/serveCharges.test.ts
git commit -m "feat(billing): pure serve-charge engine + tests"
```

---

## Task 3: DB-aware charge store `serveChargeStore.ts`

**Files:**
- Create: `src/utils/serveChargeStore.ts`

This gathers facts from D1, loads contract terms + pricing, calls the pure engine, and upserts `serve_charges` + `serve_charge_lines`. It never throws to its caller (returns `null` on failure) so the serve hook stays best-effort.

- [ ] **Step 1: Write the store**

```ts
// src/utils/serveChargeStore.ts
import type { D1Database } from '@cloudflare/workers-types';
import { query, queryFirst, execute } from './db';
import { computeServeCharges, type PricingItem, type ContractTerms, type ServeJobFacts } from './serveCharges';

export async function loadPricing(db: D1Database): Promise<PricingItem[]> {
  const rows = await query<any>(db, 'SELECT code, label, unit, amount, taxable, attempts_included FROM ps_pricing_items WHERE is_active = 1');
  return rows.map((r) => ({
    code: r.code, label: r.label, unit: r.unit, amount: Number(r.amount) || 0,
    taxable: !!r.taxable, attempts_included: Number(r.attempts_included) || 0,
  }));
}

export async function loadTerms(db: D1Database, contractId: number | null): Promise<ContractTerms> {
  if (!contractId) return { contract_id: null, billing_trigger: 'on_completion', rate_overrides: {} };
  const row = await queryFirst<any>(db, 'SELECT contract_id, billing_trigger, rate_overrides_json FROM ps_contract_terms WHERE contract_id = ?', contractId);
  let overrides: Record<string, number> = {};
  try { overrides = row?.rate_overrides_json ? JSON.parse(row.rate_overrides_json) : {}; } catch { overrides = {}; }
  return {
    contract_id: contractId,
    billing_trigger: row?.billing_trigger ?? 'on_completion',
    rate_overrides: overrides,
  };
}

async function gatherFacts(db: D1Database, serveQueueId: number): Promise<{ facts: ServeJobFacts; contractId: number | null } | null> {
  const job = await queryFirst<any>(db, 'SELECT id, priority, attempt_count, contract_id FROM serve_queue WHERE id = ?', serveQueueId);
  if (!job) return null;
  const skip = await queryFirst<any>(db, 'SELECT 1 AS x FROM serve_skip_traces WHERE serve_queue_id = ? LIMIT 1', serveQueueId);
  return {
    contractId: job.contract_id ?? null,
    facts: {
      serve_queue_id: serveQueueId,
      priority: job.priority ?? 'normal',
      attempt_count: Number(job.attempt_count) || 0,
      has_skip_trace: !!skip,
      mileage: null,    // manual-in-review in Phase 1
      wait_hours: null, // manual-in-review in Phase 1
    },
  };
}

/**
 * Compute and upsert charges for a completed serve job. Idempotent on
 * serve_queue_id. Returns the serve_charges row id, or null on any failure
 * (caller treats billing as best-effort and never lets it break serving).
 * Will NOT overwrite an already-invoiced charge.
 */
export async function generateServeCharges(db: D1Database, serveQueueId: number): Promise<number | null> {
  try {
    const existing = await queryFirst<any>(db, 'SELECT id, status FROM serve_charges WHERE serve_queue_id = ?', serveQueueId);
    if (existing && existing.status === 'invoiced') return existing.id;

    const gathered = await gatherFacts(db, serveQueueId);
    if (!gathered) return null;
    const pricing = await loadPricing(db);
    const terms = await loadTerms(db, gathered.contractId);
    const computed = computeServeCharges(gathered.facts, terms, pricing);

    let chargeId: number;
    if (existing) {
      chargeId = existing.id;
      await execute(db,
        `UPDATE serve_charges SET contract_id = ?, subtotal = ?, computed_at = datetime('now','localtime'), status = 'pending_review' WHERE id = ?`,
        gathered.contractId, computed.subtotal, chargeId);
      await execute(db, 'DELETE FROM serve_charge_lines WHERE serve_charge_id = ?', chargeId);
    } else {
      const ins = await execute(db,
        `INSERT INTO serve_charges (serve_queue_id, contract_id, status, subtotal) VALUES (?, ?, 'pending_review', ?)`,
        serveQueueId, gathered.contractId, computed.subtotal);
      chargeId = Number(ins.meta.last_row_id);
    }
    for (const l of computed.lines) {
      await execute(db,
        `INSERT INTO serve_charge_lines (serve_charge_id, pricing_code, description, quantity, unit_price, line_total, taxable)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        chargeId, l.pricing_code, l.description, l.quantity, l.unit_price, l.line_total, l.taxable ? 1 : 0);
    }
    return chargeId;
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no errors from the new file).

- [ ] **Step 3: Commit**

```bash
git add src/utils/serveChargeStore.ts
git commit -m "feat(billing): DB-aware serve-charge generation store (best-effort, idempotent)"
```

---

# Milestone 2 — Pricing CRUD + Pricing tab

## Task 4: `serveBilling.ts` router — pricing endpoints + mount

**Files:**
- Create: `src/routes/serveBilling.ts`
- Modify: `src/routesConfig.ts`

- [ ] **Step 1: Create the router with pricing endpoints + audit helper**

```ts
// src/routes/serveBilling.ts
// ============================================================
// RMPG Flex — Process Service Contracts billing
// Pricing rate card, per-contract PS terms, computed serve
// charges (review-gated), and invoice generation from charges.
// Mounted at /api/billing alongside billing.ts (Hono path-matches).
// Migration: 0104_process_service_billing.sql
// ============================================================
import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';

const psb = new Hono<Env>();

function requireRole(c: { get: (k: 'user') => { role: string } | undefined }, ...roles: string[]): string | null {
  const u = c.get('user');
  if (!u || !roles.includes(u.role)) return 'Insufficient role';
  return null;
}
const MANAGE = ['admin', 'manager', 'contract_manager'];
const REVIEW = ['admin', 'manager', 'contract_manager', 'supervisor'];

async function logAudit(db: ReturnType<typeof getDb>, userId: number | null, action: string, entityType: string, entityId: number | null, details: unknown) {
  try {
    await execute(db,
      `INSERT INTO activity_log (user_id, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)`,
      userId, action, entityType, entityId, JSON.stringify(details ?? {}));
  } catch { /* audit must never break the write */ }
}

// ── Pricing rate card ──────────────────────────────────────
psb.get('/ps-pricing/items', async (c) => {
  const db = getDb(c.env);
  const rows = await query(db, 'SELECT * FROM ps_pricing_items ORDER BY sort_order, id');
  return c.json({ data: rows });
});

psb.post('/ps-pricing/items', async (c) => {
  const denied = requireRole(c, ...MANAGE);
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  const db = getDb(c.env);
  const b = await c.req.json<any>();
  if (!b.code || !b.label) return c.json({ error: 'code and label required' }, 400);
  const user = c.get('user') as { id: number } | undefined;
  const ins = await execute(db,
    `INSERT INTO ps_pricing_items (code, label, unit, amount, taxable, attempts_included, sort_order, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    b.code, b.label, b.unit ?? 'per_serve', Number(b.amount) || 0, b.taxable ? 1 : 0,
    Number(b.attempts_included) || 0, Number(b.sort_order) || 0, user?.id ?? null);
  const id = Number(ins.meta.last_row_id);
  await logAudit(db, user?.id ?? null, 'create', 'ps_pricing_item', id, b);
  const created = await queryFirst(db, 'SELECT * FROM ps_pricing_items WHERE id = ?', id);
  return c.json({ data: created }, 201);
});

psb.put('/ps-pricing/items/:id', async (c) => {
  const denied = requireRole(c, ...MANAGE);
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  const db = getDb(c.env);
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  const before = await queryFirst<any>(db, 'SELECT * FROM ps_pricing_items WHERE id = ?', id);
  if (!before) return c.json({ error: 'Not found' }, 404);
  const b = await c.req.json<any>();
  const user = c.get('user') as { id: number } | undefined;
  await execute(db,
    `UPDATE ps_pricing_items SET
       label = ?, unit = ?, amount = ?, taxable = ?, attempts_included = ?, is_active = ?, sort_order = ?,
       updated_at = datetime('now','localtime'), updated_by = ?
     WHERE id = ?`,
    b.label ?? before.label, b.unit ?? before.unit,
    b.amount !== undefined ? Number(b.amount) : before.amount,
    b.taxable !== undefined ? (b.taxable ? 1 : 0) : before.taxable,
    b.attempts_included !== undefined ? Number(b.attempts_included) : before.attempts_included,
    b.is_active !== undefined ? (b.is_active ? 1 : 0) : before.is_active,
    b.sort_order !== undefined ? Number(b.sort_order) : before.sort_order,
    user?.id ?? null, id);
  await logAudit(db, user?.id ?? null, 'update', 'ps_pricing_item', id, { before, after: b });
  const after = await queryFirst(db, 'SELECT * FROM ps_pricing_items WHERE id = ?', id);
  return c.json({ data: after });
});

psb.delete('/ps-pricing/items/:id', async (c) => {
  const denied = requireRole(c, ...MANAGE);
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  const db = getDb(c.env);
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  const user = c.get('user') as { id: number } | undefined;
  // Soft-delete: charges reference codes historically.
  await execute(db, `UPDATE ps_pricing_items SET is_active = 0, updated_at = datetime('now','localtime'), updated_by = ? WHERE id = ?`, user?.id ?? null, id);
  await logAudit(db, user?.id ?? null, 'deactivate', 'ps_pricing_item', id, {});
  return c.json({ success: true });
});

export default psb;
```

- [ ] **Step 2: Mount the router**

In `src/routesConfig.ts`, add the import near the other route imports (alongside `import billing from './routes/billing';` at line ~67):

```ts
import serveBilling from './routes/serveBilling';
```

And register it in the routes array immediately after the existing `billing` entry (the block at line ~392). Add:

```ts
  { prefix: '/api/billing', router: serveBilling, auth: 'required',
    note: 'Process-service contracts billing: pricing rate card, PS contract terms, serve charges, invoice-from-charges' },
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Manual smoke (local dev)**

Run (in one terminal): `npm run dev`
Run (in another): `curl -s http://localhost:8787/api/billing/ps-pricing/items` (expect a JSON `{"data":[...]}` with the 6 seeded codes once authed; unauthed returns the auth error — that's fine, it confirms the route exists and is gated).

- [ ] **Step 5: Commit**

```bash
git add src/routes/serveBilling.ts src/routesConfig.ts
git commit -m "feat(billing): /api/billing ps-pricing CRUD router + mount"
```

---

## Task 5: Client billing hooks `usePsBilling.ts` + pure helpers

**Files:**
- Create: `client/src/hooks/usePsBilling.ts`
- Create: `client/src/pages/patrol/psBillingHelpers.ts`
- Create: `client/src/pages/patrol/__tests__/psBillingHelpers.test.ts`

- [ ] **Step 1: Write the failing helper tests**

```ts
// client/src/pages/patrol/__tests__/psBillingHelpers.test.ts
import { describe, it, expect } from 'vitest';
import { applyPricingEdit, chargeTotal, formatUsd, type PricingRow } from '../psBillingHelpers';

const rows: PricingRow[] = [
  { id: 1, code: 'flat_serve', label: 'Standard', unit: 'per_serve', amount: 65, taxable: 1, attempts_included: 0, is_active: 1, sort_order: 10 },
  { id: 2, code: 'rush', label: 'Rush', unit: 'flat', amount: 40, taxable: 1, attempts_included: 0, is_active: 1, sort_order: 20 },
];

describe('applyPricingEdit', () => {
  it('updates only the targeted row field immutably', () => {
    const next = applyPricingEdit(rows, 1, 'amount', 80);
    expect(next[0].amount).toBe(80);
    expect(next[1]).toBe(rows[1]);       // untouched row keeps identity
    expect(rows[0].amount).toBe(65);     // original not mutated
  });
});

describe('chargeTotal', () => {
  it('sums line totals to cents', () => {
    expect(chargeTotal([{ line_total: 65 }, { line_total: 7.005 }])).toBe(72.01);
  });
});

describe('formatUsd', () => {
  it('formats with two decimals and a $ sign', () => {
    expect(formatUsd(65)).toBe('$65.00');
    expect(formatUsd(null)).toBe('$0.00');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd client && npx vitest run psBillingHelpers`
Expected: FAIL — cannot find `../psBillingHelpers`.

- [ ] **Step 3: Write the pure helpers**

```ts
// client/src/pages/patrol/psBillingHelpers.ts
export interface PricingRow {
  id: number;
  code: string;
  label: string;
  unit: string;
  amount: number;
  taxable: number;
  attempts_included: number;
  is_active: number;
  sort_order: number;
}

export function applyPricingEdit<K extends keyof PricingRow>(
  rows: PricingRow[], id: number, field: K, value: PricingRow[K],
): PricingRow[] {
  return rows.map((r) => (r.id === id ? { ...r, [field]: value } : r));
}

export function chargeTotal(lines: Array<{ line_total: number }>): number {
  return Math.round(lines.reduce((s, l) => s + (l.line_total || 0), 0) * 100) / 100;
}

export function formatUsd(n: number | null | undefined): string {
  const v = typeof n === 'number' && isFinite(n) ? n : 0;
  return `$${v.toFixed(2)}`;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd client && npx vitest run psBillingHelpers`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the data hook**

```ts
// client/src/hooks/usePsBilling.ts
import { useState, useCallback } from 'react';
import { apiFetch } from './useApi';
import type { PricingRow } from '../pages/patrol/psBillingHelpers';

export interface ServeChargeLine { id?: number; pricing_code: string | null; description: string; quantity: number; unit_price: number; line_total: number; taxable: number; }
export interface ServeCharge {
  id: number; serve_queue_id: number; contract_id: number | null; status: string;
  subtotal: number; tax_amount: number; computed_at: string; invoice_id: number | null; notes: string | null;
  defendant_name?: string; case_number?: string; client_name?: string; lines?: ServeChargeLine[];
}

export function usePsPricing() {
  const [items, setItems] = useState<PricingRow[]>([]);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await apiFetch<{ data: PricingRow[] }>('/billing/ps-pricing/items'); setItems(r?.data ?? []); }
    catch { /* surfaced by caller */ }
    setLoading(false);
  }, []);
  const save = useCallback(async (row: PricingRow) => {
    await apiFetch(`/billing/ps-pricing/items/${row.id}`, { method: 'PUT', body: JSON.stringify(row) });
  }, []);
  const create = useCallback(async (row: Partial<PricingRow>) => {
    await apiFetch('/billing/ps-pricing/items', { method: 'POST', body: JSON.stringify(row) });
  }, []);
  return { items, setItems, loading, load, save, create };
}

export function useServeCharges() {
  const [charges, setCharges] = useState<ServeCharge[]>([]);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async (status = 'pending_review') => {
    setLoading(true);
    try { const r = await apiFetch<{ data: ServeCharge[] }>(`/billing/serve-charges?status=${status}`); setCharges(r?.data ?? []); }
    catch { /* surfaced by caller */ }
    setLoading(false);
  }, []);
  const approve = useCallback(async (id: number) => { await apiFetch(`/billing/serve-charges/${id}/approve`, { method: 'POST' }); }, []);
  const voidCharge = useCallback(async (id: number, notes: string) => { await apiFetch(`/billing/serve-charges/${id}/void`, { method: 'POST', body: JSON.stringify({ notes }) }); }, []);
  const saveLines = useCallback(async (id: number, payload: { contract_id?: number | null; lines: ServeChargeLine[] }) => {
    await apiFetch(`/billing/serve-charges/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
  }, []);
  const generateInvoice = useCallback(async (payload: { contract_id?: number; client_id?: number; from: string; to: string }) => {
    return apiFetch<{ data: { invoice_id: number; invoice_number: string } }>('/billing/invoices/from-serve-charges', { method: 'POST', body: JSON.stringify(payload) });
  }, []);
  return { charges, loading, load, approve, voidCharge, saveLines, generateInvoice };
}
```

> Note: `apiFetch` accepts a path with or without `/api` and a standard `RequestInit`. Confirm the call shape against `client/src/hooks/useApi.ts` and match its existing usage (it sets JSON headers + auth).

- [ ] **Step 6: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add client/src/hooks/usePsBilling.ts client/src/pages/patrol/psBillingHelpers.ts client/src/pages/patrol/__tests__/psBillingHelpers.test.ts
git commit -m "feat(billing): client ps-billing hooks + pure helpers + tests"
```

---

## Task 6: `PricingTab.tsx` + wire into Patrol Management

**Files:**
- Create: `client/src/pages/patrol/PricingTab.tsx`
- Modify: `client/src/pages/PatrolPage.tsx`

- [ ] **Step 1: Write the Pricing tab**

```tsx
// client/src/pages/patrol/PricingTab.tsx
import { useEffect, useState } from 'react';
import { DollarSign, Save } from 'lucide-react';
import PanelTitleBar from '../../components/PanelTitleBar';
import { usePsPricing } from '../../hooks/usePsBilling';
import { applyPricingEdit, formatUsd, type PricingRow } from './psBillingHelpers';

const UNITS = ['per_serve', 'per_attempt', 'per_mile', 'per_hour', 'flat'];

export default function PricingTab() {
  const { items, setItems, loading, load, save } = usePsPricing();
  const [savingId, setSavingId] = useState<number | null>(null);
  useEffect(() => { load(); }, [load]);

  const edit = <K extends keyof PricingRow>(id: number, field: K, value: PricingRow[K]) =>
    setItems((rows) => applyPricingEdit(rows, id, field, value));

  const saveRow = async (row: PricingRow) => {
    setSavingId(row.id);
    try { await save(row); } finally { setSavingId(null); }
  };

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="PROCESS SERVICE PRICING" icon={DollarSign} />
      <p className="text-[10px] text-[#888]">Dynamic rate card. Edits apply to NEW charges only — existing charges keep their snapshotted amounts.</p>
      {loading ? <div className="text-[11px] text-[#888]">Loading…</div> : (
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-left text-[9px] font-semibold text-[#888] border-b border-[#232323]">
              <th className="py-[3px]">CODE</th><th>LABEL</th><th>UNIT</th><th>AMOUNT</th>
              <th>TAX</th><th>ATTEMPTS INCL.</th><th>ACTIVE</th><th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.id} className="border-b border-[#121212]">
                <td className="py-[2px] font-mono text-[#d4a017]">{r.code}</td>
                <td><input className="bg-[#0b0b0b] border border-[#232323] px-1 w-full" value={r.label} onChange={(e) => edit(r.id, 'label', e.target.value)} /></td>
                <td>
                  <select className="bg-[#0b0b0b] border border-[#232323] px-1" value={r.unit} onChange={(e) => edit(r.id, 'unit', e.target.value)}>
                    {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </td>
                <td><input type="number" step="0.01" className="bg-[#0b0b0b] border border-[#232323] px-1 w-20 text-right" value={r.amount} onChange={(e) => edit(r.id, 'amount', Number(e.target.value))} /> <span className="text-[#666]">{formatUsd(r.amount)}</span></td>
                <td><input type="checkbox" checked={!!r.taxable} onChange={(e) => edit(r.id, 'taxable', e.target.checked ? 1 : 0)} /></td>
                <td><input type="number" className="bg-[#0b0b0b] border border-[#232323] px-1 w-14 text-right" value={r.attempts_included} onChange={(e) => edit(r.id, 'attempts_included', Number(e.target.value))} /></td>
                <td><input type="checkbox" checked={!!r.is_active} onChange={(e) => edit(r.id, 'is_active', e.target.checked ? 1 : 0)} /></td>
                <td>
                  <button className="flex items-center gap-1 text-[#d4a017] disabled:opacity-50" disabled={savingId === r.id} onClick={() => saveRow(r)}>
                    <Save size={12} /> {savingId === r.id ? 'Saving…' : 'Save'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wire the tab into `PatrolPage.tsx`**

Find the `usePersistedTab` call (≈ line 263):

```tsx
const [activeTab, setActiveTab] = usePersistedTab('rmpg_patrol_tab', 'checkpoints', ['checkpoints', 'scans', 'compliance', 'map', 'summary', 'mileage'] as const);
```

Replace its array with the three new tabs appended:

```tsx
const [activeTab, setActiveTab] = usePersistedTab('rmpg_patrol_tab', 'checkpoints', ['checkpoints', 'scans', 'compliance', 'map', 'summary', 'mileage', 'pricing', 'contracts', 'billing'] as const);
```

Add the import near the other patrol-tab imports at the top of the file:

```tsx
import PricingTab from './patrol/PricingTab';
```

Find the tab-button list (the array containing `{ id: 'checkpoints' as const, label: 'Checkpoints', icon: QrCode }` ≈ line 700) and append, importing `DollarSign` from `lucide-react` in the existing icon import:

```tsx
{ id: 'pricing' as const, label: 'Pricing', icon: DollarSign },
```

Find the render region (where `{activeTab === 'mileage' && ( … )}` is, ≈ line 1428) and add after it:

```tsx
{activeTab === 'pricing' && <PricingTab />}
```

Also widen the `onTabChange` cast at ≈ line 762 to include the new ids:

```tsx
onTabChange={(id) => setActiveTab(id as 'checkpoints' | 'scans' | 'compliance' | 'map' | 'summary' | 'mileage' | 'pricing' | 'contracts' | 'billing')}
```

- [ ] **Step 3: Typecheck + build**

Run: `cd client && npx tsc --noEmit && npx vite build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/patrol/PricingTab.tsx client/src/pages/PatrolPage.tsx
git commit -m "feat(billing): Pricing tab in Patrol Management"
```

---

# Milestone 3 — Contract terms + Contracts tab

## Task 7: Contract-terms endpoints + `contract_id` on serve create/update

**Files:**
- Modify: `src/routes/serveBilling.ts`
- Modify: `src/routes/serve.ts`

- [ ] **Step 1: Add PS contract-terms endpoints to `serveBilling.ts`**

Insert before `export default psb;`:

```ts
// ── Per-contract process-service terms ─────────────────────
psb.get('/contracts/:id/ps-terms', async (c) => {
  const db = getDb(c.env);
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  const row = await queryFirst(db, 'SELECT * FROM ps_contract_terms WHERE contract_id = ?', id);
  // 404-safe: return defaults so the UI can render an empty form.
  return c.json({ data: row ?? { contract_id: id, billing_trigger: 'on_completion', sla_days: null, retainer_amount: null, doc_types_json: null, rate_overrides_json: null, notes: null } });
});

psb.put('/contracts/:id/ps-terms', async (c) => {
  const denied = requireRole(c, ...MANAGE);
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  const db = getDb(c.env);
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  const b = await c.req.json<any>();
  const user = c.get('user') as { id: number } | undefined;
  const before = await queryFirst<any>(db, 'SELECT * FROM ps_contract_terms WHERE contract_id = ?', id);
  const overridesJson = b.rate_overrides_json
    ? (typeof b.rate_overrides_json === 'string' ? b.rate_overrides_json : JSON.stringify(b.rate_overrides_json))
    : (b.rate_overrides ? JSON.stringify(b.rate_overrides) : null);
  const docTypesJson = b.doc_types_json
    ? (typeof b.doc_types_json === 'string' ? b.doc_types_json : JSON.stringify(b.doc_types_json))
    : (b.doc_types ? JSON.stringify(b.doc_types) : null);
  await execute(db,
    `INSERT INTO ps_contract_terms (contract_id, billing_trigger, sla_days, retainer_amount, doc_types_json, rate_overrides_json, notes, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(contract_id) DO UPDATE SET
       billing_trigger = excluded.billing_trigger, sla_days = excluded.sla_days,
       retainer_amount = excluded.retainer_amount, doc_types_json = excluded.doc_types_json,
       rate_overrides_json = excluded.rate_overrides_json, notes = excluded.notes,
       updated_at = datetime('now','localtime'), updated_by = excluded.updated_by`,
    id, b.billing_trigger ?? 'on_completion', b.sla_days ?? null, b.retainer_amount ?? null,
    docTypesJson, overridesJson, b.notes ?? null, user?.id ?? null);
  await logAudit(db, user?.id ?? null, before ? 'update' : 'create', 'ps_contract', id, { before, after: b });
  const after = await queryFirst(db, 'SELECT * FROM ps_contract_terms WHERE contract_id = ?', id);
  return c.json({ data: after });
});

// ── Audit history for a contract (from activity_log) ───────
psb.get('/contracts/:id/audit', async (c) => {
  const db = getDb(c.env);
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  const rows = await query(db,
    `SELECT a.id, a.action, a.entity_type, a.details, a.created_at, u.full_name AS user_name
       FROM activity_log a LEFT JOIN users u ON a.user_id = u.id
      WHERE a.entity_type = 'ps_contract' AND a.entity_id = ?
      ORDER BY a.id DESC LIMIT 100`, id);
  return c.json({ data: rows });
});
```

> **ON CONFLICT note:** `ps_contract_terms.contract_id` is the PRIMARY KEY, so `ON CONFLICT(contract_id)` is valid (unlike the `system_config` composite-unique trap noted in project memory). Verified against the Task-1 schema.

- [ ] **Step 2: Accept `contract_id` on serve create/update in `serve.ts`**

In `serve.ts`, the create handler is `sv.post('/', …)` (≈ line 282) and update is `sv.put('/:id', …)` (≈ line 343). Add `contract_id` to each.

For the INSERT (create): add `contract_id` to the column list and bind `body.contract_id ?? null`. For the UPDATE (`PUT /:id`): include `contract_id = ?` in the SET clause with `body.contract_id ?? null` (only if the existing handler uses an explicit column list — match its pattern; if it uses a field allowlist, add `'contract_id'` to that allowlist).

Read the two handlers first and make the minimal additive change that matches their existing style. Do not change any other column.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/routes/serveBilling.ts src/routes/serve.ts
git commit -m "feat(billing): PS contract terms endpoints + serve_queue.contract_id wiring"
```

---

## Task 8: `ContractsTab.tsx`

**Files:**
- Create: `client/src/pages/patrol/ContractsTab.tsx`
- Modify: `client/src/pages/PatrolPage.tsx`

- [ ] **Step 1: Write the Contracts tab**

```tsx
// client/src/pages/patrol/ContractsTab.tsx
import { useEffect, useState, useCallback } from 'react';
import { FileText, History } from 'lucide-react';
import PanelTitleBar from '../../components/PanelTitleBar';
import { apiFetch } from '../../hooks/useApi';
import { usePsPricing } from '../../hooks/usePsBilling';
import { formatUsd } from './psBillingHelpers';

interface Contract { id: number; client_id: number; client_name?: string; contract_number: string | null; contract_type: string | null; status: string; start_date: string; end_date: string | null; }
interface Terms { contract_id: number; billing_trigger: string; sla_days: number | null; retainer_amount: number | null; rate_overrides_json: string | null; notes: string | null; }
interface AuditRow { id: number; action: string; details: string; created_at: string; user_name: string | null; }

export default function ContractsTab() {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [selected, setSelected] = useState<Contract | null>(null);
  const [terms, setTerms] = useState<Terms | null>(null);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const { items: pricing, load: loadPricing } = usePsPricing();

  const loadContracts = useCallback(async () => {
    // Process-service contracts only.
    const r = await apiFetch<{ data: Contract[] }>('/billing/contracts');
    setContracts((r?.data ?? []).filter((c) => (c.contract_type ?? '') === 'process_service' || c.contract_type === null));
  }, []);
  useEffect(() => { loadContracts(); loadPricing(); }, [loadContracts, loadPricing]);

  const openContract = async (c: Contract) => {
    setSelected(c);
    const t = await apiFetch<{ data: Terms }>(`/billing/contracts/${c.id}/ps-terms`);
    setTerms(t?.data ?? null);
    try { setOverrides(t?.data?.rate_overrides_json ? JSON.parse(t.data.rate_overrides_json) : {}); } catch { setOverrides({}); }
    const a = await apiFetch<{ data: AuditRow[] }>(`/billing/contracts/${c.id}/audit`);
    setAudit(a?.data ?? []);
  };

  const saveTerms = async () => {
    if (!selected || !terms) return;
    await apiFetch(`/billing/contracts/${selected.id}/ps-terms`, {
      method: 'PUT',
      body: JSON.stringify({ ...terms, rate_overrides: overrides }),
    });
    await openContract(selected); // refresh audit
  };

  return (
    <div className="p-4 grid grid-cols-[260px_1fr] gap-4">
      <div>
        <PanelTitleBar title="PS CONTRACTS" icon={FileText} />
        <ul className="mt-2 text-[11px]">
          {contracts.map((c) => (
            <li key={c.id}>
              <button className={`w-full text-left px-2 py-[3px] border-b border-[#121212] ${selected?.id === c.id ? 'text-[#d4a017]' : 'text-[#ccc]'}`} onClick={() => openContract(c)}>
                {c.contract_number ?? `#${c.id}`} — {c.client_name ?? c.client_id} <span className="text-[#666]">({c.status})</span>
              </button>
            </li>
          ))}
          {contracts.length === 0 && <li className="text-[#888] px-2">No process-service contracts.</li>}
        </ul>
      </div>

      <div>
        {!selected ? <div className="text-[11px] text-[#888]">Select a contract.</div> : (
          <div className="space-y-4">
            <PanelTitleBar title={`TERMS — ${selected.contract_number ?? selected.id}`} icon={FileText} />
            {terms && (
              <div className="space-y-2 text-[11px]">
                <label className="block">Billing trigger
                  <select className="ml-2 bg-[#0b0b0b] border border-[#232323] px-1" value={terms.billing_trigger} onChange={(e) => setTerms({ ...terms, billing_trigger: e.target.value })}>
                    {['on_completion', 'on_service', 'per_attempt', 'manual'].map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </label>
                <label className="block">SLA days <input type="number" className="ml-2 bg-[#0b0b0b] border border-[#232323] px-1 w-20" value={terms.sla_days ?? ''} onChange={(e) => setTerms({ ...terms, sla_days: e.target.value === '' ? null : Number(e.target.value) })} /></label>
                <label className="block">Retainer <input type="number" step="0.01" className="ml-2 bg-[#0b0b0b] border border-[#232323] px-1 w-24" value={terms.retainer_amount ?? ''} onChange={(e) => setTerms({ ...terms, retainer_amount: e.target.value === '' ? null : Number(e.target.value) })} /></label>

                <div className="mt-2 font-semibold text-[#888]">Per-contract rate overrides (blank = use rate card)</div>
                <table className="w-full">
                  <tbody>
                    {pricing.filter((p) => p.is_active).map((p) => (
                      <tr key={p.code}>
                        <td className="text-[#ccc]">{p.label} <span className="text-[#666]">({formatUsd(p.amount)} default)</span></td>
                        <td className="text-right">
                          <input type="number" step="0.01" placeholder="—" className="bg-[#0b0b0b] border border-[#232323] px-1 w-24 text-right"
                            value={overrides[p.code] ?? ''} onChange={(e) => {
                              const v = e.target.value;
                              setOverrides((o) => { const n = { ...o }; if (v === '') delete n[p.code]; else n[p.code] = Number(v); return n; });
                            }} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button className="mt-2 px-3 py-1 bg-[#d4a017] text-black" onClick={saveTerms}>Save Terms</button>
              </div>
            )}

            <PanelTitleBar title="AUDIT HISTORY" icon={History} />
            <table className="w-full text-[10px]">
              <tbody>
                {audit.map((a) => (
                  <tr key={a.id} className="border-b border-[#121212]">
                    <td className="text-[#666] py-[2px]">{a.created_at}</td>
                    <td className="text-[#d4a017]">{a.action}</td>
                    <td className="text-[#888]">{a.user_name ?? '—'}</td>
                  </tr>
                ))}
                {audit.length === 0 && <tr><td className="text-[#888] py-[2px]">No history yet.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire into `PatrolPage.tsx`**

Add import: `import ContractsTab from './patrol/ContractsTab';`
Add to the tab-button list (import `FileText` from `lucide-react`): `{ id: 'contracts' as const, label: 'Contracts', icon: FileText },`
Add render branch near the Pricing one: `{activeTab === 'contracts' && <ContractsTab />}`

- [ ] **Step 3: Typecheck + build**

Run: `cd client && npx tsc --noEmit && npx vite build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/patrol/ContractsTab.tsx client/src/pages/PatrolPage.tsx
git commit -m "feat(billing): Contracts tab — PS terms, rate overrides, audit history"
```

---

# Milestone 4 — Generation hook + Billing Review

## Task 9: Best-effort charge generation hook in `serve.ts`

**Files:**
- Modify: `src/routes/serve.ts`

- [ ] **Step 1: Import the store**

At the top of `serve.ts`, add to the existing imports:

```ts
import { generateServeCharges } from '../utils/serveChargeStore';
```

- [ ] **Step 2: Fire after the status flips to served/failed in `logAttempt`**

In `logAttempt`, immediately after the existing `UPDATE serve_queue SET attempt_count = ?, status = ?, …` execute (≈ line 426) and before `return c.json(...)`, add:

```ts
  // Best-effort: bill on completion (served or non-est/failed). Must never
  // break the serve write, so failures are swallowed by generateServeCharges.
  if (newStatus === 'served' || newStatus === 'failed') {
    await generateServeCharges(db, id);
  }
```

- [ ] **Step 3: Fire in `substitute-service`**

In the `sv.post('/:id/substitute-service', …)` handler, after its `UPDATE serve_queue SET … status = 'served' …` execute (≈ line 469) and before `return c.json(...)`, add:

```ts
  await generateServeCharges(db, id);
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/serve.ts
git commit -m "feat(billing): generate serve charges on job completion (best-effort)"
```

---

## Task 10: Serve-charges review endpoints

**Files:**
- Modify: `src/routes/serveBilling.ts`

- [ ] **Step 1: Add the review-queue endpoints**

Insert before `export default psb;`:

```ts
// ── Serve charges review queue ─────────────────────────────
psb.get('/serve-charges', async (c) => {
  const db = getDb(c.env);
  const status = c.req.query('status') ?? 'pending_review';
  const charges = await query<any>(db,
    `SELECT sc.*, q.defendant_name, q.case_number, q.recipient_name, cl.name AS client_name
       FROM serve_charges sc
       JOIN serve_queue q ON sc.serve_queue_id = q.id
       LEFT JOIN client_contracts cc ON sc.contract_id = cc.id
       LEFT JOIN clients cl ON cc.client_id = cl.id
      WHERE sc.status = ?
      ORDER BY sc.computed_at DESC LIMIT 500`, status);
  // Attach lines per charge.
  for (const ch of charges) {
    ch.lines = await query(db, 'SELECT * FROM serve_charge_lines WHERE serve_charge_id = ? ORDER BY id', ch.id);
  }
  return c.json({ data: charges });
});

psb.put('/serve-charges/:id', async (c) => {
  const denied = requireRole(c, ...REVIEW);
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  const db = getDb(c.env);
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  const current = await queryFirst<any>(db, 'SELECT status FROM serve_charges WHERE id = ?', id);
  if (!current) return c.json({ error: 'Not found' }, 404);
  if (current.status === 'invoiced') return c.json({ error: 'Charge already invoiced — locked' }, 409);
  const b = await c.req.json<any>();
  const user = c.get('user') as { id: number } | undefined;
  const before = await queryFirst<any>(db, 'SELECT * FROM serve_charges WHERE id = ?', id);

  if (Array.isArray(b.lines)) {
    await execute(db, 'DELETE FROM serve_charge_lines WHERE serve_charge_id = ?', id);
    let subtotal = 0;
    for (const l of b.lines) {
      const lineTotal = Math.round((Number(l.quantity) || 0) * (Number(l.unit_price) || 0) * 100) / 100;
      subtotal += lineTotal;
      await execute(db,
        `INSERT INTO serve_charge_lines (serve_charge_id, pricing_code, description, quantity, unit_price, line_total, taxable)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        id, l.pricing_code ?? null, l.description ?? '', Number(l.quantity) || 0, Number(l.unit_price) || 0, lineTotal, l.taxable ? 1 : 0);
    }
    await execute(db, `UPDATE serve_charges SET subtotal = ? WHERE id = ?`, Math.round(subtotal * 100) / 100, id);
  }
  if (b.contract_id !== undefined) {
    await execute(db, 'UPDATE serve_charges SET contract_id = ? WHERE id = ?', b.contract_id ?? null, id);
  }
  if (b.notes !== undefined) {
    await execute(db, 'UPDATE serve_charges SET notes = ? WHERE id = ?', b.notes ?? null, id);
  }
  await logAudit(db, user?.id ?? null, 'update', 'serve_charge', id, { before, after: b });
  const after = await queryFirst(db, 'SELECT * FROM serve_charges WHERE id = ?', id);
  return c.json({ data: after });
});

psb.post('/serve-charges/:id/approve', async (c) => {
  const denied = requireRole(c, ...REVIEW);
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  const db = getDb(c.env);
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  const cur = await queryFirst<any>(db, 'SELECT status FROM serve_charges WHERE id = ?', id);
  if (!cur) return c.json({ error: 'Not found' }, 404);
  if (cur.status === 'invoiced') return c.json({ error: 'Already invoiced' }, 409);
  const user = c.get('user') as { id: number } | undefined;
  await execute(db, `UPDATE serve_charges SET status = 'approved', reviewed_by = ?, reviewed_at = datetime('now','localtime') WHERE id = ?`, user?.id ?? null, id);
  await logAudit(db, user?.id ?? null, 'approve', 'serve_charge', id, {});
  return c.json({ success: true });
});

psb.post('/serve-charges/:id/void', async (c) => {
  const denied = requireRole(c, ...REVIEW);
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  const db = getDb(c.env);
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  const cur = await queryFirst<any>(db, 'SELECT status FROM serve_charges WHERE id = ?', id);
  if (!cur) return c.json({ error: 'Not found' }, 404);
  if (cur.status === 'invoiced') return c.json({ error: 'Already invoiced' }, 409);
  const b = await c.req.json<any>().catch(() => ({}));
  const user = c.get('user') as { id: number } | undefined;
  await execute(db, `UPDATE serve_charges SET status = 'void', notes = ? WHERE id = ?`, b.notes ?? null, id);
  await logAudit(db, user?.id ?? null, 'void', 'serve_charge', id, { notes: b.notes ?? null });
  return c.json({ success: true });
});

psb.post('/serve-charges/:id/recompute', async (c) => {
  const denied = requireRole(c, ...REVIEW);
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  const db = getDb(c.env);
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  const charge = await queryFirst<any>(db, 'SELECT serve_queue_id, status FROM serve_charges WHERE id = ?', id);
  if (!charge) return c.json({ error: 'Not found' }, 404);
  if (charge.status === 'invoiced') return c.json({ error: 'Already invoiced' }, 409);
  const { generateServeCharges } = await import('../utils/serveChargeStore');
  const newId = await generateServeCharges(db, charge.serve_queue_id);
  return c.json({ success: newId !== null });
});
```

> Uses `client_contracts`/`clients` joins and the existing `serve_queue` columns (`defendant_name`, `case_number`, `recipient_name`) confirmed in the schema.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/routes/serveBilling.ts
git commit -m "feat(billing): serve-charges review queue (list/edit/approve/void/recompute)"
```

---

## Task 11: `BillingReviewTab.tsx`

**Files:**
- Create: `client/src/pages/patrol/BillingReviewTab.tsx`
- Modify: `client/src/pages/PatrolPage.tsx`

- [ ] **Step 1: Write the Billing Review tab**

```tsx
// client/src/pages/patrol/BillingReviewTab.tsx
import { useEffect, useState } from 'react';
import { ClipboardCheck, Check, X, FileOutput } from 'lucide-react';
import PanelTitleBar from '../../components/PanelTitleBar';
import { useServeCharges, type ServeCharge } from '../../hooks/usePsBilling';
import { formatUsd } from './psBillingHelpers';

export default function BillingReviewTab() {
  const { charges, loading, load, approve, voidCharge, generateInvoice } = useServeCharges();
  const [busyId, setBusyId] = useState<number | null>(null);
  const [msg, setMsg] = useState<string>('');
  useEffect(() => { load('pending_review'); }, [load]);

  const doApprove = async (ch: ServeCharge) => { setBusyId(ch.id); try { await approve(ch.id); await load('pending_review'); } finally { setBusyId(null); } };
  const doVoid = async (ch: ServeCharge) => {
    const reason = window.prompt('Void reason?') ?? '';
    setBusyId(ch.id); try { await voidCharge(ch.id, reason); await load('pending_review'); } finally { setBusyId(null); }
  };
  const doInvoice = async () => {
    const from = window.prompt('Invoice from date (YYYY-MM-DD)?') ?? '';
    const to = window.prompt('Invoice to date (YYYY-MM-DD)?') ?? '';
    if (!from || !to) return;
    const r = await generateInvoice({ from, to });
    setMsg(r?.data ? `Created invoice ${r.data.invoice_number}` : 'No approved charges in range.');
  };

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <PanelTitleBar title={`BILLING REVIEW (${charges.length})`} icon={ClipboardCheck} />
        <button className="flex items-center gap-1 px-3 py-1 bg-[#d4a017] text-black text-[11px]" onClick={doInvoice}>
          <FileOutput size={12} /> Generate Invoice (approved)
        </button>
      </div>
      {msg && <div className="text-[11px] text-[#d4a017]">{msg}</div>}
      {loading ? <div className="text-[11px] text-[#888]">Loading…</div> : (
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-left text-[9px] font-semibold text-[#888] border-b border-[#232323]">
              <th className="py-[3px]">JOB</th><th>CLIENT/CONTRACT</th><th>LINES</th><th>SUBTOTAL</th><th></th>
            </tr>
          </thead>
          <tbody>
            {charges.map((ch) => (
              <tr key={ch.id} className="border-b border-[#121212] align-top">
                <td className="py-[3px] text-[#ccc]">{ch.defendant_name ?? ch.serve_queue_id} {ch.case_number ? <span className="text-[#666]">({ch.case_number})</span> : null}</td>
                <td className={ch.contract_id ? 'text-[#ccc]' : 'text-[#e0533d]'}>{ch.client_name ?? (ch.contract_id ? `Contract ${ch.contract_id}` : 'UNASSIGNED CONTRACT')}</td>
                <td className="text-[#888]">
                  {(ch.lines ?? []).map((l, i) => (
                    <div key={i}>{l.description} — {l.quantity} × {formatUsd(l.unit_price)} = {formatUsd(l.line_total)}</div>
                  ))}
                </td>
                <td className="text-[#d4a017] font-semibold">{formatUsd(ch.subtotal)}</td>
                <td>
                  <div className="flex gap-2">
                    <button className="flex items-center gap-1 text-green-500 disabled:opacity-50" disabled={busyId === ch.id || !ch.contract_id} title={!ch.contract_id ? 'Assign a contract first' : 'Approve'} onClick={() => doApprove(ch)}><Check size={12} /> Approve</button>
                    <button className="flex items-center gap-1 text-[#e0533d] disabled:opacity-50" disabled={busyId === ch.id} onClick={() => doVoid(ch)}><X size={12} /> Void</button>
                  </div>
                </td>
              </tr>
            ))}
            {charges.length === 0 && <tr><td colSpan={5} className="text-[#888] py-2">Nothing awaiting review.</td></tr>}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

> Approve is disabled until a contract is assigned (the "unassigned contract" guard from the spec). Contract assignment + line editing reuse `PUT /serve-charges/:id` via `useServeCharges().saveLines`; a minimal inline editor can be added later — Phase 1 ships approve/void/invoice + the unassigned guard.

- [ ] **Step 2: Wire into `PatrolPage.tsx`**

Add import: `import BillingReviewTab from './patrol/BillingReviewTab';`
Add to the tab-button list (import `ClipboardCheck` from `lucide-react`): `{ id: 'billing' as const, label: 'Billing Review', icon: ClipboardCheck },`
Add render branch: `{activeTab === 'billing' && <BillingReviewTab />}`

- [ ] **Step 3: Typecheck + build**

Run: `cd client && npx tsc --noEmit && npx vite build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/patrol/BillingReviewTab.tsx client/src/pages/PatrolPage.tsx
git commit -m "feat(billing): Billing Review tab — approve/void + generate invoice"
```

---

# Milestone 5 — Invoice from charges + end-to-end

## Task 12: `POST /invoices/from-serve-charges`

**Files:**
- Modify: `src/routes/serveBilling.ts`

Groups `approved` charges by contract/client over a date range → one invoice + `invoice_line_items` copied from `serve_charge_lines`; marks charges `invoiced`. Mirrors `billing.ts`'s invoice-number + total-recalc pattern.

- [ ] **Step 1: Add invoice-number + total helpers (local) and the endpoint**

Insert before `export default psb;`:

```ts
async function nextInvoiceNumber(db: ReturnType<typeof getDb>): Promise<string> {
  const yy = String(new Date().getFullYear()).slice(-2);
  const prefix = `INV-${yy}-`;
  const last = await queryFirst<{ invoice_number: string }>(db, 'SELECT invoice_number FROM invoices WHERE invoice_number LIKE ? ORDER BY id DESC LIMIT 1', `${prefix}%`);
  let n = 1;
  const m = last?.invoice_number?.match(/^INV-\d{2}-(\d+)$/);
  if (m) n = parseInt(m[1], 10) + 1;
  return `${prefix}${String(n).padStart(4, '0')}`;
}

psb.post('/invoices/from-serve-charges', async (c) => {
  const denied = requireRole(c, ...REVIEW);
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  const db = getDb(c.env);
  const b = await c.req.json<any>();
  const { from, to } = b;
  if (!from || !to) return c.json({ error: 'from and to dates required' }, 400);

  // Select approved charges in range, optionally scoped to a contract/client.
  const conds = ["sc.status = 'approved'", 'date(sc.computed_at) >= date(?)', 'date(sc.computed_at) <= date(?)'];
  const params: unknown[] = [from, to];
  if (b.contract_id) { conds.push('sc.contract_id = ?'); params.push(b.contract_id); }
  if (b.client_id) { conds.push('cc.client_id = ?'); params.push(b.client_id); }
  const charges = await query<any>(db,
    `SELECT sc.id, sc.contract_id, cc.client_id
       FROM serve_charges sc LEFT JOIN client_contracts cc ON sc.contract_id = cc.id
      WHERE ${conds.join(' AND ')}`, ...params);
  if (charges.length === 0) return c.json({ data: null, message: 'No approved charges in range' });

  const clientId = charges.find((x) => x.client_id)?.client_id ?? null;
  const contractId = b.contract_id ?? charges.find((x) => x.contract_id)?.contract_id ?? null;

  const invNumber = await nextInvoiceNumber(db);
  const invIns = await execute(db,
    `INSERT INTO invoices (invoice_number, client_id, contract_id, issue_date, subtotal, tax_rate, tax_amount, total_amount)
     VALUES (?, ?, ?, date('now'), 0, 0, 0, 0)`,
    invNumber, clientId, contractId);
  const invoiceId = Number(invIns.meta.last_row_id);

  let subtotal = 0;
  for (const ch of charges) {
    const lines = await query<any>(db, 'SELECT * FROM serve_charge_lines WHERE serve_charge_id = ?', ch.id);
    for (const l of lines) {
      subtotal += Number(l.line_total) || 0;
      await execute(db,
        `INSERT INTO invoice_line_items (invoice_id, description, quantity, unit_price, line_total, tax_applied)
         VALUES (?, ?, ?, ?, ?, ?)`,
        invoiceId, l.description, l.quantity, l.unit_price, l.line_total, l.taxable ? 1 : 0);
    }
    await execute(db, `UPDATE serve_charges SET status = 'invoiced', invoice_id = ? WHERE id = ?`, invoiceId, ch.id);
  }
  subtotal = Math.round(subtotal * 100) / 100;
  await execute(db, `UPDATE invoices SET subtotal = ?, total_amount = ? WHERE id = ?`, subtotal, subtotal, invoiceId);

  const user = c.get('user') as { id: number } | undefined;
  await logAudit(db, user?.id ?? null, 'invoice', 'serve_charge', invoiceId, { invoice_number: invNumber, charge_ids: charges.map((x) => x.id) });
  return c.json({ data: { invoice_id: invoiceId, invoice_number: invNumber, charge_count: charges.length, subtotal } }, 201);
});
```

> Tax is left at 0 on the generated invoice header (line items carry `tax_applied`); apply `billing.ts`'s `recalcInvoiceTotal` later if per-invoice tax is needed. Phase 1 sums line totals.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/routes/serveBilling.ts
git commit -m "feat(billing): generate invoice from approved serve charges (closes serve→invoice chain)"
```

---

## Task 13: Service-worker bump + end-to-end verification

**Files:**
- Modify: `client/public/sw.js`

- [ ] **Step 1: Bump the SW cache name**

In `client/public/sw.js`, find the `CACHE_NAME = 'rmpg-flex-vNNN'` line and increment to the next version (check current value, then `+1`).

- [ ] **Step 2: Full local verification (manual end-to-end)**

1. `npm run migrate:local` (already applied; confirms idempotent).
2. `npm run dev` (worker on 8787) and `cd client && npm run dev` (Vite on 5173).
3. In the browser, log in, open Patrol Management → **Pricing**: set `flat_serve` = 65, `rush` = 40, `extra_attempt` = 15 (3 included), `skip_trace` = 25; Save each.
4. **Contracts**: open a contract (or create one via Billing with `contract_type='process_service'`), set terms, optionally an override; Save; confirm an audit row appears.
5. Assign that `contract_id` to a serve job (via Serve page or `PUT /api/serve/:id`), then complete the job (served or exhaust attempts → failed).
6. **Billing Review**: the job appears with computed lines; if no contract, it shows "UNASSIGNED CONTRACT" and Approve is disabled. Approve it.
7. Click **Generate Invoice (approved)** with a date range covering today → confirm an invoice number is returned and the charge leaves the queue.
8. Verify: `npx wrangler d1 execute rmpg-flex --local --command "SELECT i.invoice_number, li.description, li.line_total FROM invoices i JOIN invoice_line_items li ON li.invoice_id = i.id ORDER BY i.id DESC LIMIT 10;"`

- [ ] **Step 3: Run all tests + typecheck**

Run: `npm test && npm run typecheck`
Run: `cd client && npx vitest run && npx tsc --noEmit && npx vite build`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add client/public/sw.js
git commit -m "chore(sw): bump cache for process-service billing tabs"
```

- [ ] **Step 5: Open the PR**

```bash
git push -u origin HEAD
gh pr create --title "Patrol Mgmt Phase 1: Process Service Contracts + dynamic pricing + serve→invoice billing" --body "$(cat <<'EOF'
Implements docs/superpowers/specs/2026-06-13-process-service-contracts-billing-design.md

- 0104 schema: ps_pricing_items, ps_contract_terms, serve_charges, serve_charge_lines, serve_queue.contract_id
- Pure charge engine (computeServeCharges) + tests
- Best-effort generation on serve completion (served or non-est)
- /api/billing: pricing CRUD, PS contract terms + audit, serve-charges review queue, invoice-from-charges
- Patrol Management tabs: Pricing, Contracts, Billing Review

⚠️ After merge: apply 0104 DDL directly to live D1 (785de7ae) and verify with pragma_table_info.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

> **Live D1 reminder:** per CLAUDE.md, the deploy migration step is `continue-on-error`. After merge, apply `0104` directly to live D1 `785de7ae-…` via the Cloudflare D1 API and verify each new table/column with `pragma_table_info` before testing in prod.

---

## Self-Review (completed during planning)

**Spec coverage** — every spec section maps to a task:
- §4.1 `ps_pricing_items` → Task 1; CRUD → Task 4; UI → Task 6.
- §4.2 `ps_contract_terms` → Task 1; endpoints → Task 7; UI → Task 8.
- §4.3/4.4 `serve_charges`/`serve_charge_lines` → Task 1; populated → Tasks 3 + 9; reviewed → Task 10/11.
- §4.5 `serve_queue.contract_id` ALTER → Task 1; wired on serve write → Task 7.
- §4.6 audit via `activity_log` → `logAudit` in Tasks 4/7/10/12; surfaced → Task 8.
- §5 charge engine + resolution → Task 2; DB store → Task 3; hook → Task 9; endpoints → Tasks 4/7/10/12.
- §6 three tabs → Tasks 6/8/11.
- §7 edge cases: best-effort try/catch (Task 3/9), snapshot+recompute (Tasks 2/3 + 10), unassigned-contract guard (Tasks 3/11), invoiced-lock (Tasks 3/10/12), non-est bills base (Task 2 test).
- §8 testing → Tasks 2 (engine) + 5 (client helpers) + 13 (full run).
- §9 milestones → the 5 milestone headers.

**Placeholder scan** — no TBD/TODO; all code blocks are complete. The two "read the handler and match its style" steps (Task 7 Step 2; serve create/update) are deliberate: the exact INSERT/UPDATE column list in `serve.ts` must be read in-place to add one column additively without disturbing the existing allowlist. Code to add (`contract_id` + bind `body.contract_id ?? null`) is specified.

**Type consistency** — `computeServeCharges(job, terms, pricing)` signature and the `PricingItem`/`ContractTerms`/`ServeJobFacts`/`ChargeLine` types are identical across Tasks 2, 3, and the tests. `generateServeCharges(db, serveQueueId)` is referenced identically in Tasks 3, 9, 10. Client `PricingRow`/`ServeCharge`/`ServeChargeLine` shapes are consistent across Tasks 5, 6, 8, 11. Endpoint paths (`/billing/ps-pricing/items`, `/billing/contracts/:id/ps-terms`, `/billing/serve-charges`, `/billing/invoices/from-serve-charges`) match between router (Tasks 4/7/10/12) and hooks (Task 5).
