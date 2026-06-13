# Process Service Contracts, Dynamic Pricing & Serve→Invoice Billing — Design

**Date:** 2026-06-13
**Status:** Approved (design); ready for implementation planning
**Surface:** Patrol Management (new tabs) + `/api/billing` + `/api/serve`
**Phase:** 1 of 3 (see "Roadmap context" below)

---

## 1. Goal & boundary

Add **control**, **function management**, and **integration assist** to Patrol Management,
focused on **Process Service Contracts**. Phase 1 delivers:

- **Process Service Contracts** as first-class objects (parties, status lifecycle,
  process-service terms).
- A **dynamic, config-driven pricing system** (the internal source of truth for the
  `rmpgutahps.us` process-service pricing) — fully editable rate card.
- A **link from every serve job to its contract** (`serve_queue.contract_id`).
- An **automatic charge engine** that computes charges when a serve job completes
  (**served _or_ non-est**), from the contract's pricing.
- A **supervisor review/approval gate** before any charge is invoiceable, with a
  **field-level audit trail** of every contract / pricing / charge edit.
- **Invoice generation** from approved charges, completing the long-broken
  serve → contract → invoice chain.

All surfaced as new tabs inside **Patrol Management** ([PatrolPage.tsx](../../../client/src/pages/PatrolPage.tsx)).

### Out of scope for Phase 1 (deferred to later phases)

- Officer assignment console (routes + ad-hoc serve-job assignment).
- Patrol exceptions → dispatch CFS auto-creation.
- Live patrol/serve status on the dispatch board and map.
- External billing sync (QuickBooks / ServeManager) — `serve.ts` already notes
  `create-invoice-item (QuickBooks / ServeManager billing)` as a deferred feature;
  Phase 1 produces native invoices only.

---

## 2. Why now — the gap this closes

- `serve_queue` (serve jobs) has **no `contract_id`**, yet `invoices` already has
  `contract_id` and `client_contracts` exists → the billing chain is broken at exactly
  one link: *work done* cannot reach *contract terms* → *invoice*.
- `client_contracts` is generic (`flat`/`hourly`/`per_call` rates) with **no
  process-service terms** (per-serve rate, rush, per-attempt, add-ons, SLA).
- There is **no pricing table** anywhere; `serve.ts` lists `cost-estimate
  (config-driven pricing tables)` as a deferred feature. The dynamic pricing system is
  the anticipated-but-unbuilt piece.
- Contracts/invoices/line-items already have **full API CRUD** in
  [billing.ts](../../../src/routes/billing.ts) and a real `invoice_line_items` table —
  but **zero contract-management UI** in the client. Phase 1 connects and surfaces more
  than it invents.

---

## 3. Decisions (locked during brainstorming)

| Decision | Choice |
|---|---|
| Overall scope | All three (control / function mgmt / integration), **phased**; Phase 1 first |
| Phase 1 heart | **Contracts + billing link** (serve → contract → invoice) |
| Rate model | **All** components: flat per-serve **+** rush/same-day surcharge **+** per-attempt / extra-attempt **+** add-ons (skip trace, mileage, wait) |
| Pricing | **Dynamic, config-driven** rate card (editable settings) + **per-contract overrides** |
| Billing trigger | **On completion** — bills whether **served** or **non-est** (failed/exhausted attempts) |
| Review flow | **Approval gate + full field-level audit** before charges are invoiceable |
| UI placement | **New tabs in Patrol Management** |
| Spec packaging | **One spec**, milestone-sequenced (§9) |

---

## 4. Data model

**Principle:** keep billing _state_ off the already-wide `serve_queue` (~50 cols). It gets
**one** new column (the contract link, intrinsic to the job); computed charges live in a
side table. This mirrors the `_ext`/side-table discipline CLAUDE.md mandates for wide
tables. (`serve_queue` is **not** on the column-cap watch list, so the single ALTER is safe.)

All DDL is **idempotent** (`CREATE TABLE IF NOT EXISTS`), lands in migration **`0104_*`**
(next free prefix; high-water is `0103`), and **must also be applied directly to live D1**
(`785de7ae-…`) per the migration-drift gotcha, then verified with `pragma_table_info`.

### 4.1 `ps_pricing_items` — dynamic rate card (NEW)

The internal source of truth for process-service pricing (the `rmpgutahps.us` pricing system).

```
id               INTEGER PK AUTOINCREMENT
code             TEXT UNIQUE NOT NULL   -- 'flat_serve' | 'rush' | 'extra_attempt'
                                        --  | 'skip_trace' | 'mileage' | 'wait' | …(extensible)
label            TEXT NOT NULL          -- human label shown on invoices
unit             TEXT NOT NULL          -- 'per_serve' | 'per_attempt' | 'per_mile' | 'per_hour' | 'flat'
amount           REAL NOT NULL DEFAULT 0
taxable          INTEGER NOT NULL DEFAULT 1
attempts_included INTEGER DEFAULT 0     -- used by extra_attempt logic (attempts beyond this bill)
is_active        INTEGER NOT NULL DEFAULT 1
sort_order       INTEGER NOT NULL DEFAULT 0
updated_at       TEXT NOT NULL DEFAULT (datetime('now','localtime'))
updated_by       INTEGER                -- users(id)
```

New codes can be added from the Pricing tab without a schema change. Seed the standard
codes (`flat_serve`, `rush`, `extra_attempt`, `skip_trace`, `mileage`, `wait`) at
amount `0` so the owner sets real prices in the UI.

### 4.2 `ps_contract_terms` — process-service terms (1:1 ext of `client_contracts`) (NEW)

Reuses the existing generic `client_contracts` row (parties, status lifecycle, dates) for
any contract with `contract_type = 'process_service'`, and adds only the PS specifics.

```
contract_id       INTEGER PK            -- FK client_contracts(id) ON DELETE CASCADE
billing_trigger   TEXT NOT NULL DEFAULT 'on_completion'  -- 'on_completion' | 'on_service' | 'per_attempt' | 'manual'
sla_days          INTEGER               -- service deadline target (days)
retainer_amount   REAL
doc_types_json    TEXT                  -- JSON array of document types covered
rate_overrides_json TEXT                -- JSON object: { "<pricing code>": <amount> } negotiated per-firm
notes             TEXT
updated_at        TEXT NOT NULL DEFAULT (datetime('now','localtime'))
updated_by        INTEGER
```

Charge resolution for a code = `rate_overrides_json[code] ?? ps_pricing_items[code].amount`.
`billing_trigger` defaults to `on_completion` (the locked decision) but is stored per
contract so future contracts can differ without code changes.

### 4.3 `serve_charges` — one billable row per completed job (NEW)

```
id               INTEGER PK AUTOINCREMENT
serve_queue_id   INTEGER UNIQUE NOT NULL  -- FK serve_queue(id); UNIQUE → idempotent regeneration
contract_id      INTEGER                  -- nullable: completed-but-unassigned jobs still create a charge
status           TEXT NOT NULL DEFAULT 'pending_review'
                                          -- 'pending_review' | 'approved' | 'invoiced' | 'void'
subtotal         REAL NOT NULL DEFAULT 0
tax_amount       REAL NOT NULL DEFAULT 0
computed_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
reviewed_by      INTEGER
reviewed_at      TEXT
invoice_id       INTEGER                  -- set when status → invoiced
notes            TEXT
```

### 4.4 `serve_charge_lines` — charge breakdown (NEW)

Mirrors `invoice_line_items` so invoice generation is a straight copy.

```
id               INTEGER PK AUTOINCREMENT
serve_charge_id  INTEGER NOT NULL         -- FK serve_charges(id) ON DELETE CASCADE
pricing_code     TEXT                     -- provenance back to ps_pricing_items.code
description      TEXT NOT NULL
quantity         REAL NOT NULL DEFAULT 1
unit_price       REAL NOT NULL DEFAULT 0  -- snapshotted at compute time (see §7 edge cases)
line_total       REAL NOT NULL DEFAULT 0
taxable          INTEGER NOT NULL DEFAULT 1
```

### 4.5 ALTER (one)

```
ALTER TABLE serve_queue ADD COLUMN contract_id INTEGER;   -- settable at intake/assignment
```

(D1 has no `IF NOT EXISTS` on ADD COLUMN — accept failure on re-apply, or guard via
`pragma_table_info('serve_queue')` before applying to live.)

### 4.6 Audit — reuse `activity_log`

No new audit table. Every write to a contract, pricing item, or serve charge logs to the
existing `activity_log` (`user_id`, `action`, `entity_type`, `entity_id`, `details`):

- `entity_type ∈ { 'ps_contract', 'ps_pricing_item', 'serve_charge' }`
- `details` = JSON `{ field: { old, new }, … }` capturing the field-level change set.

---

## 5. Backend

New router **`src/routes/serveBilling.ts`**, mounted at **`/api/billing`** (alongside
`billing.ts`), `auth: 'required'`. Writes gated via `requireRole(...)`:

- Pricing & contract-terms writes: `admin`, `manager`, `contract_manager` (matches the
  existing `billing.ts /contracts` gate).
- Charge review/approve/void: the above **plus `supervisor`**.

### 5.1 Endpoints

**Pricing (rate card):**
- `GET    /ps-pricing/items` — list (active + inactive).
- `POST   /ps-pricing/items` — add a code.
- `PUT    /ps-pricing/items/:id` — edit amount/label/unit/active.
- `DELETE /ps-pricing/items/:id` — soft via `is_active = 0` (never hard-delete; charges
  reference codes historically).
- Every write → `activity_log` (`ps_pricing_item`).

**Contract terms:**
- `GET /contracts/:id/ps-terms` — read terms (404-safe: returns defaults if no row yet).
- `PUT /contracts/:id/ps-terms` — upsert terms (creates `ps_contract_terms` on first save);
  → `activity_log` (`ps_contract`).
- (Base contract create/edit continues through existing `billing.ts /contracts`; set
  `contract_type = 'process_service'`.)

**Charge engine (pure, unit-testable):**
- `computeServeCharges(job, contract, pricing) → { lines[], subtotal, tax }`
  - Base: `flat_serve` (always — non-est still bills the base, per the trigger decision).
  - `+ rush` when the job is rush (priority flag or `time_window` indicating same-day/rush).
  - `+ extra_attempt × max(0, attempt_count − attempts_included)`.
  - `+ skip_trace` when a `serve_skip_traces` row exists for the job.
  - `+ mileage` from `serve_routes` / gps-trail distance when available.
  - `+ wait` when wait time is logged.
  - Each amount resolved as `rate_overrides_json[code] ?? ps_pricing_items[code].amount`.
  - Pure function over passed-in data → no DB calls inside; fully unit-testable without Miniflare.

**Generation hook (in `serve.ts`):**
- Where status flips to `served` / `failed` (logAttempt, ~L420–421) and on
  substitute-service (~L469): after the existing UPDATE, **best-effort** compute and
  upsert `serve_charges` (`pending_review`) + replace `serve_charge_lines`.
- Wrapped in `try/catch` — **a serve/attempt write must never fail because billing math
  threw.** A failed charge computation logs and leaves the job correctly served.

**Review queue:**
- `GET  /serve-charges?status=pending_review` — queue with job + contract + lines joined.
- `PUT  /serve-charges/:id` — edit lines / assign a contract / adjust amounts (blocked once
  `invoiced`); → `activity_log` (`serve_charge`).
- `POST /serve-charges/:id/approve` — `pending_review → approved`; stamps `reviewed_by/at`.
- `POST /serve-charges/:id/void` — `→ void` (with reason in `notes`).
- `POST /serve-charges/:id/recompute` — explicit re-run of the engine (does **not** happen
  automatically on pricing edits — see §7).

**Invoice from approved:**
- `POST /invoices/from-serve-charges` — body: `{ contract_id | client_id, from, to }`.
  Groups `approved` charges in range → creates one `invoices` row + copies
  `serve_charge_lines` into `invoice_line_items`; sets each charge `invoiced` with
  `invoice_id`. Reuses existing invoice infrastructure in `billing.ts`.

### 5.2 Mounting

Add to [routesConfig.ts](../../../src/routesConfig.ts) next to `billing`:
`{ prefix: '/api/billing', router: serveBilling, auth: 'required', note: '…' }`.
Hono matches by path, so the new `/ps-pricing`, `/contracts/:id/ps-terms`,
`/serve-charges`, `/invoices/from-serve-charges` paths coexist with `billing.ts`.

---

## 6. Frontend — new Patrol Management tabs

Extend the `usePersistedTab('rmpg_patrol_tab', …)` tab list in
[PatrolPage.tsx](../../../client/src/pages/PatrolPage.tsx). Follow existing design tokens
(pure-black `#000`, `#0b0b0b` raised, gold `#d4a017`, 2px radius, `PanelTitleBar`,
9px/11px tables, `IconButton` with `aria-label`). Data via `apiFetch`.

- **Contracts** — list process-service contracts (client, number, status, SLA, effective
  pricing summary). Create/edit drawer: base fields (via `billing.ts /contracts`) + PS terms
  (`/contracts/:id/ps-terms`) including `rate_overrides`. Per-contract **audit history**
  panel from `activity_log`.
- **Pricing** — the editable rate card (`ps_pricing_items`): inline-editable `amount`,
  `taxable`, `is_active`; add-new-code; "last changed by / when" per row. This is the
  dynamic settings surface.
- **Billing Review** — the `pending_review` queue: each completed job with its computed
  line breakdown (editable), **Approve / Void**, contract assignment for unassigned jobs,
  then **Generate Invoice** for a selected batch. Tab badge = count awaiting review.

Bump `CACHE_NAME` in `client/public/sw.js` on every client change (cache invalidation).

---

## 7. End-to-end flow & edge cases

```
Serve job completes (served | failed/non-est)
  └─ serve.ts hook → computeServeCharges(job, contract, pricing)
       └─ serve_charges (pending_review) + serve_charge_lines   [best-effort, try/catch]
            └─ Patrol Mgmt ▸ Billing Review: supervisor edits / assigns contract / approves
                 └─ POST /invoices/from-serve-charges
                      └─ invoices + invoice_line_items ; serve_charges → invoiced (locked)
```

**Edge cases:**
- **No contract on a completed job** → charge still created (`pending_review`,
  `contract_id` null) and flagged "unassigned contract" in the queue. Supervisor assigns a
  contract during review. Billable work is **never silently dropped**.
- **Pricing edited after a charge was computed** → `serve_charge_lines.unit_price` is
  **snapshotted at compute time**. Editing the rate card never retroactively changes
  existing charges; `POST /serve-charges/:id/recompute` is the explicit opt-in.
- **Re-completion / job re-opened** → `serve_charges.serve_queue_id` is UNIQUE;
  regeneration updates in place **unless** already `invoiced` (then locked; changes go
  through a credit/adjustment, out of Phase 1 scope).
- **Billing failure isolation** → the generation hook is wrapped so a serve/attempt write
  always succeeds even if charge math throws (logged for follow-up).
- **Non-est billing** → status `failed` (max attempts exhausted) still bills `flat_serve`
  (+ any per-attempt/add-ons), per the locked trigger.

---

## 8. Testing

- **Worker (unit):** `computeServeCharges` across the matrix — flat only; +rush;
  attempts under/at/over `attempts_included`; each add-on present/absent; override vs
  default amount; non-est still bills base; tax vs non-tax lines. Pure function → no
  Miniflare needed.
- **Worker (smoke):** add smoke tests for the new routes in the same PR
  (CLAUDE.md: "add a smoke test in the same PR" when adding a route).
- **Client (vitest):** the Pricing inline-edit reducer and the Billing Review
  approve/void/assign state transitions. `invoice-from-charges` payload builder.
- **CI:** existing `pr-tests.yml` (worker-typecheck, client-typecheck, client-tests,
  client-build) + `column-cap-check.yml` (the single `serve_queue` ALTER is on a
  non-watched table → passes).

---

## 9. Build milestones (for the implementation plan)

Sequenced so each is independently verifiable; each can be its own PR.

1. **Migration `0104` + `computeServeCharges` + unit tests.** Schema lands; charge engine
   proven in isolation. (Apply `0104` to live D1 directly; verify with `pragma_table_info`.)
2. **Pricing CRUD + Pricing tab.** The dynamic rate card is editable end-to-end with audit.
3. **Contract terms + Contracts tab.** PS contracts manageable; `serve_queue.contract_id`
   settable at intake/assignment.
4. **Generation hook + Billing Review tab.** Completed jobs produce reviewable charges;
   approve/void/assign works.
5. **Invoice-from-charges + end-to-end.** Approved charges → invoices; chain closed.

---

## 10. Project-specific implementation notes

- **Ship via PR flow** (`feedback-use-pr-flow-not-direct-push`): feature branch off
  `origin/main`, `gh pr create`; the user reviews/merges; merge triggers `deploy.yml`.
- **Migrations land twice**: merge applies `0104` via `deploy.yml` (continue-on-error)
  **and** apply the DDL directly to live D1 (`785de7ae-…`); verify with
  `pragma_table_info('<table>')` before debugging any "no such column/table".
- **SW bump**: increment `CACHE_NAME` in `client/public/sw.js` for the client tabs.
- **Roles**: pricing/contract writes `admin`/`manager`/`contract_manager`; review/approve
  adds `supervisor`.
- **Do not** overload the police-geography roster (`shift_plans`, `dispatch_zones`) — PS
  contracts are client/property-scoped, not beat-scoped.

---

## 11. Roadmap context (later phases — not built here)

- **Phase 2 — Officer function management:** assignment console (reusable named **routes**
  + **ad-hoc** loose jobs, per the brainstorming decision), in-app tour/serve-run, overdue
  nudges.
- **Phase 3 — Integration assist:** exceptions → dispatch CFS, patrol/serve status on the
  dispatch board + map, external billing sync (QuickBooks / ServeManager).
