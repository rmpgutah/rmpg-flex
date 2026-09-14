# Delivery Scheduler → CAD Push Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let rmpgutahps.us push a confirmed delivery appointment into RMPG Flex as a real, dispatchable `calls_for_service` row, authenticated via an HMAC-signed webhook.

**Architecture:** A new public (JWT-bypassed, HMAC-verified) Hono route, `POST /api/deliveries/webhook`, inserts (or idempotently updates) a `calls_for_service` row plus a matching `calls_for_service_ext` row carrying delivery-specific fields. No new table — extends the existing 1:1 ext-table overflow pattern this repo already uses to keep `calls_for_service` under its D1 100-column cap.

**Tech Stack:** Hono route on Cloudflare Workers, D1 (`calls_for_service` / `calls_for_service_ext`), Web Crypto HMAC-SHA256 (reusing helpers already exported from `src/routes/fleetioWebhook.ts`), Vitest (Node suite `tests/` + Miniflare suite `test-workers/`).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-14-delivery-scheduler-cad-push-design.md` — this plan implements it in full; do not add scope beyond it (no cancel/reschedule webhook, no retry/dead-letter queue, no officer/unit assignment changes).
- Never `ALTER TABLE` the base `calls_for_service` table or touch its `source` `CHECK` constraint — all new fields go on `calls_for_service_ext` via plain `ADD COLUMN` (no `CHECK`, no cap risk).
- `incident_type = 'delivery'` (free TEXT, no CHECK — confirmed against `migrations/baseline/schema.sql:144`). `source = 'other'` (existing CHECK-permitted value; do not add `'delivery_scheduler'` to the enum).
- Reuse the existing `calls_for_service_ext.external_source_system` column (added by `migrations/0184_cfs_ext_external_source_system.sql`, free TEXT) for the origin discriminator — value `'delivery_scheduler'`. Do **not** add a new `delivery_origin` column; it would duplicate this one.
- D1 does not support `IF NOT EXISTS` on `ADD COLUMN` — migrations must tolerate re-apply failing with "duplicate column name" (CLAUDE.md rule #5, `migrations/README.md`).
- New secret: `RMPG_FLEX_WEBHOOK_SECRET` (mirrors `SERVEMANAGER_WEBHOOK_SECRET` naming). Route returns `503 { ok:false, code:'not_configured' }` when unset, per this repo's standing convention (`src/utils/notConfigured.ts`).
- Header name: `x-rmpg-flex-hmac-sha256`. Signature: `hmacSha256Hex(secret, rawBodyString)` — hex-encoded HMAC-SHA256 over the exact raw request body bytes, `TextEncoder`-based (already implemented in `src/routes/fleetioWebhook.ts`; reuse it, don't reimplement).
- Idempotency key: `calls_for_service_ext.delivery_slot_id`, unique (partial index, nullable column). A repeat webhook for the same `delivery_slots.id` updates the existing row pair, never inserts a duplicate.
- v1 is confirm-only: this route only ever creates/updates a call from an "approved" delivery event. No delete/cancel handling.

---

## Task 1: `calls_for_service_ext` delivery columns — migration + self-heal reconciler

**Files:**
- Create: `migrations/0289_delivery_ext_columns.sql`
- Modify: `src/utils/db.ts` (append new reconciler, following the `ensureAccountLockoutColumns` pattern at `src/utils/db.ts:517-528`)
- Test: `test-workers/dbEnsureDeliveryExtColumns.test.ts`

**Interfaces:**
- Produces: `ensureDeliveryExtColumns(db: D1Database): Promise<void>` — exported from `src/utils/db.ts`, idempotent, self-heals the 8 new columns + unique index if the migration hasn't landed yet on live D1 (same rationale as every other `ensure*Columns` reconciler in this file). Task 3 calls this before its first write.
- Columns added to `calls_for_service_ext`: `delivery_slot_id INTEGER`, `delivery_case_number TEXT`, `delivery_scheduled_date TEXT`, `delivery_time_window TEXT`, `delivery_contact_name TEXT`, `delivery_contact_phone TEXT`, `delivery_contact_email TEXT`, `delivery_subject_name TEXT`, `delivery_status TEXT`.
- Index: `idx_cfs_ext_delivery_slot_id` — `UNIQUE`, partial (`WHERE delivery_slot_id IS NOT NULL`).

- [ ] **Step 1: Write the migration file**

```sql
-- 0289_delivery_ext_columns.sql
-- =====================================================================
-- rmpgutahps.us delivery-scheduling integration, piece 1/3: pushes a
-- confirmed delivery appointment into Flex as a real dispatchable
-- calls_for_service row. Delivery-specific fields go on the existing
-- 1:1 overflow table (calls_for_service is at/near the D1 100-column
-- cap — see CLAUDE.md gotcha #19 and the 0262 rebuild incident) rather
-- than a new table, matching the precedent set by 0184
-- (external_source_system) and 0041 (the ADD-COLUMN-on-_ext fallback
-- adopted after a CHECK-constraint rebuild broke live D1).
--
-- delivery_slot_id is the idempotency key (rmpgutahps.us delivery_slots.id
-- — a subject can have more than one delivery scheduled over time, e.g.
-- after a decline + reschedule, so case_number alone isn't unique enough).
-- The unique index is partial because every non-delivery calls_for_service
-- row leaves this column NULL.
--
-- Spec: docs/superpowers/specs/2026-09-14-delivery-scheduler-cad-push-design.md
--
-- D1 does NOT support IF NOT EXISTS on ADD COLUMN; re-applying this file
-- against a DB that already has these columns raises "duplicate column
-- name", which deploy.yml's continue-on-error swallows (see CLAUDE.md).
-- =====================================================================

ALTER TABLE calls_for_service_ext ADD COLUMN delivery_slot_id INTEGER;
ALTER TABLE calls_for_service_ext ADD COLUMN delivery_case_number TEXT;
ALTER TABLE calls_for_service_ext ADD COLUMN delivery_scheduled_date TEXT;
ALTER TABLE calls_for_service_ext ADD COLUMN delivery_time_window TEXT;
ALTER TABLE calls_for_service_ext ADD COLUMN delivery_contact_name TEXT;
ALTER TABLE calls_for_service_ext ADD COLUMN delivery_contact_phone TEXT;
ALTER TABLE calls_for_service_ext ADD COLUMN delivery_contact_email TEXT;
ALTER TABLE calls_for_service_ext ADD COLUMN delivery_subject_name TEXT;
ALTER TABLE calls_for_service_ext ADD COLUMN delivery_status TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_cfs_ext_delivery_slot_id
  ON calls_for_service_ext(delivery_slot_id) WHERE delivery_slot_id IS NOT NULL;
```

- [ ] **Step 2: Add the reconciler to `src/utils/db.ts`**

Append this block at the end of the file (after the last `ensure*Columns` function — e.g. after `ensureAttachmentEvidenceColumns`, matching the existing one-reconciler-per-feature layout):

```ts
// ── Delivery-scheduler CAD push columns reconciler ──────────
// Migration 0289_delivery_ext_columns.sql adds the delivery_* columns to
// calls_for_service_ext for the rmpgutahps.us delivery-scheduler push
// (see docs/superpowers/specs/2026-09-14-delivery-scheduler-cad-push-design.md).
// Same self-heal situation as every other reconciler here (CLAUDE.md rule #5).
let _deliveryExtColumnsEnsured = false;

const DELIVERY_EXT_COLUMNS: Array<[string, string]> = [
  ['delivery_slot_id', 'INTEGER'],
  ['delivery_case_number', 'TEXT'],
  ['delivery_scheduled_date', 'TEXT'],
  ['delivery_time_window', 'TEXT'],
  ['delivery_contact_name', 'TEXT'],
  ['delivery_contact_phone', 'TEXT'],
  ['delivery_contact_email', 'TEXT'],
  ['delivery_subject_name', 'TEXT'],
  ['delivery_status', 'TEXT'],
];

export async function ensureDeliveryExtColumns(db: D1Database): Promise<void> {
  if (_deliveryExtColumnsEnsured) return;
  for (const [col, type] of DELIVERY_EXT_COLUMNS) {
    try {
      if (!(await columnExists(db, 'calls_for_service_ext', col))) {
        await db.prepare(`ALTER TABLE calls_for_service_ext ADD COLUMN ${col} ${type}`).run();
      }
    } catch {
      // Race or pre-existing column — tolerated by design (CLAUDE.md rule #5).
    }
  }
  try {
    await db.prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_cfs_ext_delivery_slot_id
         ON calls_for_service_ext(delivery_slot_id) WHERE delivery_slot_id IS NOT NULL`,
    ).run();
  } catch {
    // Tolerated — index may already exist.
  }
  _deliveryExtColumnsEnsured = await columnExists(db, 'calls_for_service_ext', 'delivery_slot_id').catch(() => false);
}
```

- [ ] **Step 3: Write the failing test**

Create `test-workers/dbEnsureDeliveryExtColumns.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { ensureDeliveryExtColumns, columnExists } from '../src/utils/db';

describe('ensureDeliveryExtColumns', () => {
  beforeEach(async () => {
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS calls_for_service (id INTEGER PRIMARY KEY)`).run();
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS calls_for_service_ext (id INTEGER PRIMARY KEY)`).run();
  });

  it('adds all nine delivery_* columns', async () => {
    await ensureDeliveryExtColumns(env.DB);

    for (const col of [
      'delivery_slot_id', 'delivery_case_number', 'delivery_scheduled_date',
      'delivery_time_window', 'delivery_contact_name', 'delivery_contact_phone',
      'delivery_contact_email', 'delivery_subject_name', 'delivery_status',
    ]) {
      expect(await columnExists(env.DB, 'calls_for_service_ext', col)).toBe(true);
    }
  });

  it('enforces uniqueness on delivery_slot_id but allows multiple NULLs', async () => {
    await ensureDeliveryExtColumns(env.DB);
    await env.DB.prepare(`INSERT INTO calls_for_service_ext (id, delivery_slot_id) VALUES (1, 100)`).run();
    await env.DB.prepare(`INSERT INTO calls_for_service_ext (id, delivery_slot_id) VALUES (2, NULL)`).run();
    await env.DB.prepare(`INSERT INTO calls_for_service_ext (id, delivery_slot_id) VALUES (3, NULL)`).run();

    await expect(
      env.DB.prepare(`INSERT INTO calls_for_service_ext (id, delivery_slot_id) VALUES (4, 100)`).run(),
    ).rejects.toThrow();
  });

  it('is idempotent when called twice', async () => {
    await ensureDeliveryExtColumns(env.DB);
    await ensureDeliveryExtColumns(env.DB);
    expect(await columnExists(env.DB, 'calls_for_service_ext', 'delivery_slot_id')).toBe(true);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm run test:worker -- dbEnsureDeliveryExtColumns`
Expected: FAIL with `ensureDeliveryExtColumns is not a function` (or import error) — the function doesn't exist yet if Step 2 wasn't applied, or passes if it was. Run this *before* Step 2's code exists to confirm the red state, then apply Step 2.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:worker -- dbEnsureDeliveryExtColumns`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add migrations/0289_delivery_ext_columns.sql src/utils/db.ts test-workers/dbEnsureDeliveryExtColumns.test.ts
git commit -m "feat(db): add delivery_* columns to calls_for_service_ext

Reconciler + migration for the rmpgutahps.us delivery-scheduler CAD
push (piece 1/3). Extends the existing 1:1 ext-table overflow pattern
rather than touching calls_for_service directly.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: Delivery webhook payload parsing (pure, unit-tested)

**Files:**
- Create: `src/utils/deliveryWebhook.ts`
- Test: `tests/deliveryWebhook.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `export interface DeliveryWebhookPayload { slotId: number; caseNumber: string; slotDate: string; timeWindow: string; contactName: string; contactPhone: string | null; contactEmail: string | null; notes: string | null; address: string | null; subjectName: string | null; status: string; }` and `export function parseDeliveryWebhookPayload(raw: unknown): { ok: true; payload: DeliveryWebhookPayload } | { ok: false; error: string }`. Task 3's route handler calls this after signature verification and before touching D1.

- [ ] **Step 1: Write the failing test**

Create `tests/deliveryWebhook.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseDeliveryWebhookPayload } from '../src/utils/deliveryWebhook';

const VALID_BODY = {
  slot_id: 42,
  case_number: 'CASE-2026-001',
  slot_date: '2026-09-20',
  time_window: '9am-11am',
  name: 'Jane Subject',
  email: 'jane@example.com',
  phone: '555-0100',
  notes: 'Gate code 1234',
  address: '123 Main St, Salt Lake City, UT',
  subject_name: 'Jane Subject',
  status: 'confirmed',
};

describe('parseDeliveryWebhookPayload', () => {
  it('accepts a fully populated valid payload', () => {
    const result = parseDeliveryWebhookPayload(VALID_BODY);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload).toEqual({
        slotId: 42,
        caseNumber: 'CASE-2026-001',
        slotDate: '2026-09-20',
        timeWindow: '9am-11am',
        contactName: 'Jane Subject',
        contactPhone: '555-0100',
        contactEmail: 'jane@example.com',
        notes: 'Gate code 1234',
        address: '123 Main St, Salt Lake City, UT',
        subjectName: 'Jane Subject',
        status: 'confirmed',
      });
    }
  });

  it('accepts a minimal payload, defaulting optional fields to null', () => {
    const result = parseDeliveryWebhookPayload({
      slot_id: 7,
      case_number: 'CASE-2026-002',
      slot_date: '2026-09-21',
      time_window: '1pm-3pm',
      name: 'John Subject',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.contactPhone).toBeNull();
      expect(result.payload.contactEmail).toBeNull();
      expect(result.payload.notes).toBeNull();
      expect(result.payload.address).toBeNull();
      expect(result.payload.subjectName).toBeNull();
      expect(result.payload.status).toBe('confirmed');
    }
  });

  it.each([
    ['missing slot_id', { case_number: 'C1', slot_date: 'd', time_window: 'w', name: 'n' }],
    ['slot_id as a string', { slot_id: '42', case_number: 'C1', slot_date: 'd', time_window: 'w', name: 'n' }],
    ['missing case_number', { slot_id: 1, slot_date: 'd', time_window: 'w', name: 'n' }],
    ['missing slot_date', { slot_id: 1, case_number: 'C1', time_window: 'w', name: 'n' }],
    ['missing time_window', { slot_id: 1, case_number: 'C1', slot_date: 'd', name: 'n' }],
    ['missing name', { slot_id: 1, case_number: 'C1', slot_date: 'd', time_window: 'w' }],
    ['non-object payload', 'not-an-object'],
    ['null payload', null],
  ])('rejects payload with %s', (_label, body) => {
    const result = parseDeliveryWebhookPayload(body);
    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/deliveryWebhook.test.ts`
Expected: FAIL — `Cannot find module '../src/utils/deliveryWebhook'`

- [ ] **Step 3: Write the implementation**

Create `src/utils/deliveryWebhook.ts`:

```ts
// ============================================================
// RMPG Flex — rmpgutahps.us delivery-scheduler CAD push (piece 1/3)
// ------------------------------------------------------------
// Pure payload validation for POST /api/deliveries/webhook. Kept
// separate from the route (src/routes/deliveriesWebhook.ts) so the
// shape checks are unit-testable without a D1 binding.
//
// Spec: docs/superpowers/specs/2026-09-14-delivery-scheduler-cad-push-design.md
// ============================================================

export interface DeliveryWebhookPayload {
  slotId: number;
  caseNumber: string;
  slotDate: string;
  timeWindow: string;
  contactName: string;
  contactPhone: string | null;
  contactEmail: string | null;
  notes: string | null;
  address: string | null;
  subjectName: string | null;
  status: string;
}

export type ParseResult =
  | { ok: true; payload: DeliveryWebhookPayload }
  | { ok: false; error: string };

function optionalString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/** Validates the rmpgutahps.us delivery-confirmation webhook body. Required:
 *  slot_id (number), case_number/slot_date/time_window/name (non-empty strings).
 *  Everything else is optional and defaults to null (status defaults to
 *  'confirmed' since this route is only ever called on the approve action). */
export function parseDeliveryWebhookPayload(raw: unknown): ParseResult {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'payload must be an object' };
  }
  const obj = raw as Record<string, unknown>;

  if (typeof obj.slot_id !== 'number' || !Number.isFinite(obj.slot_id)) {
    return { ok: false, error: 'slot_id is required and must be a number' };
  }
  if (typeof obj.case_number !== 'string' || obj.case_number.length === 0) {
    return { ok: false, error: 'case_number is required' };
  }
  if (typeof obj.slot_date !== 'string' || obj.slot_date.length === 0) {
    return { ok: false, error: 'slot_date is required' };
  }
  if (typeof obj.time_window !== 'string' || obj.time_window.length === 0) {
    return { ok: false, error: 'time_window is required' };
  }
  if (typeof obj.name !== 'string' || obj.name.length === 0) {
    return { ok: false, error: 'name is required' };
  }

  return {
    ok: true,
    payload: {
      slotId: obj.slot_id,
      caseNumber: obj.case_number,
      slotDate: obj.slot_date,
      timeWindow: obj.time_window,
      contactName: obj.name,
      contactPhone: optionalString(obj.phone),
      contactEmail: optionalString(obj.email),
      notes: optionalString(obj.notes),
      address: optionalString(obj.address),
      subjectName: optionalString(obj.subject_name),
      status: optionalString(obj.status) ?? 'confirmed',
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/deliveryWebhook.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add src/utils/deliveryWebhook.ts tests/deliveryWebhook.test.ts
git commit -m "feat(deliveries): add pure payload validation for delivery webhook

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: Webhook route — HMAC auth, upsert into calls_for_service, wiring

**Files:**
- Create: `src/routes/deliveriesWebhook.ts`
- Modify: `src/types.ts` (add `RMPG_FLEX_WEBHOOK_SECRET?: string;` to the `Bindings` type)
- Modify: `src/middleware/auth.ts` (add `/api/deliveries/webhook` to `isPublicAuthBypass`, `src/middleware/auth.ts:47-59`)
- Modify: `src/routesConfig.ts` (register the new router)
- Test: `test-workers/deliveriesWebhook.test.ts`

**Interfaces:**
- Consumes: `ensureDeliveryExtColumns` (Task 1), `parseDeliveryWebhookPayload`/`DeliveryWebhookPayload` (Task 2), `hmacSha256Hex`/`constantTimeEquals` (already exported from `src/routes/fleetioWebhook.ts:44,53`), `getDb`/`execute`/`queryFirst` (`src/utils/db.ts`), `withNextCallNumber`/`currentCallNumberPrefix` (`src/utils/callNumberSeq.ts`), `notConfigured` (`src/utils/notConfigured.ts`), `log` (`src/utils/logger.ts`).
- Produces: default-exported Hono router `deliveriesWebhook`, mounted at `/api/deliveries/webhook`. Nothing downstream depends on this beyond the route registration itself — this is the last task in the plan.

- [ ] **Step 1: Write the failing test**

Create `test-workers/deliveriesWebhook.test.ts`:

```ts
// Miniflare integration test for POST /api/deliveries/webhook.
// Verifies HMAC auth, the calls_for_service + calls_for_service_ext write,
// and idempotency on repeat delivery_slot_id.
import { createHmac } from 'node:crypto';
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import deliveriesWebhook from '../src/routes/deliveriesWebhook';

const SECRET = 'test-rmpg-flex-webhook-secret';

function sign(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

const app = new Hono<{ Bindings: Record<string, unknown>; Variables: Record<string, unknown> }>();
app.route('/api/deliveries/webhook', deliveriesWebhook);

const VALID_BODY = JSON.stringify({
  slot_id: 42,
  case_number: 'CASE-2026-001',
  slot_date: '2026-09-20',
  time_window: '9am-11am',
  name: 'Jane Subject',
  phone: '555-0100',
  address: '123 Main St, Salt Lake City, UT',
});

async function envWithSecret(): Promise<Record<string, unknown>> {
  return { ...(env as unknown as Record<string, unknown>), RMPG_FLEX_WEBHOOK_SECRET: SECRET };
}

describe('POST /api/deliveries/webhook', () => {
  beforeEach(async () => {
    await env.DB.prepare(`DELETE FROM calls_for_service_ext`).run().catch(() => undefined);
    await env.DB.prepare(`DELETE FROM calls_for_service`).run().catch(() => undefined);
  });

  it('rejects a missing signature header', async () => {
    const res = await app.request('/api/deliveries/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: VALID_BODY,
    }, await envWithSecret());
    expect(res.status).toBe(401);
  });

  it('rejects an invalid signature', async () => {
    const res = await app.request('/api/deliveries/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-rmpg-flex-hmac-sha256': 'not-the-right-hash' },
      body: VALID_BODY,
    }, await envWithSecret());
    expect(res.status).toBe(401);
  });

  it('returns 503 when RMPG_FLEX_WEBHOOK_SECRET is unset', async () => {
    const res = await app.request('/api/deliveries/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-rmpg-flex-hmac-sha256': sign(VALID_BODY, SECRET) },
      body: VALID_BODY,
    }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(503);
    const json = await res.json() as { ok: boolean; code: string };
    expect(json.ok).toBe(false);
    expect(json.code).toBe('not_configured');
  });

  it('creates a dispatchable calls_for_service row on a valid signed request', async () => {
    const res = await app.request('/api/deliveries/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-rmpg-flex-hmac-sha256': sign(VALID_BODY, SECRET) },
      body: VALID_BODY,
    }, await envWithSecret());
    expect(res.status).toBe(201);
    const json = await res.json() as { ok: boolean; call_id: number; created: boolean };
    expect(json.ok).toBe(true);
    expect(json.created).toBe(true);

    const call = await env.DB.prepare(`SELECT * FROM calls_for_service WHERE id = ?`).bind(json.call_id).first<Record<string, unknown>>();
    expect(call?.incident_type).toBe('delivery');
    expect(call?.source).toBe('other');
    expect(call?.location_address).toBe('123 Main St, Salt Lake City, UT');
    expect(call?.status).toBe('pending');

    const ext = await env.DB.prepare(`SELECT * FROM calls_for_service_ext WHERE id = ?`).bind(json.call_id).first<Record<string, unknown>>();
    expect(ext?.delivery_slot_id).toBe(42);
    expect(ext?.delivery_case_number).toBe('CASE-2026-001');
    expect(ext?.external_source_system).toBe('delivery_scheduler');
  });

  it('is idempotent: a repeat webhook for the same slot_id updates, not duplicates', async () => {
    const firstRes = await app.request('/api/deliveries/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-rmpg-flex-hmac-sha256': sign(VALID_BODY, SECRET) },
      body: VALID_BODY,
    }, await envWithSecret());
    const first = await firstRes.json() as { call_id: number };

    const updatedBody = JSON.stringify({
      slot_id: 42,
      case_number: 'CASE-2026-001',
      slot_date: '2026-09-20',
      time_window: '11am-1pm',
      name: 'Jane Subject',
      address: '123 Main St, Salt Lake City, UT',
    });
    const secondRes = await app.request('/api/deliveries/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-rmpg-flex-hmac-sha256': sign(updatedBody, SECRET) },
      body: updatedBody,
    }, await envWithSecret());
    expect(secondRes.status).toBe(200);
    const second = await secondRes.json() as { call_id: number; created: boolean };
    expect(second.created).toBe(false);
    expect(second.call_id).toBe(first.call_id);

    const rows = await env.DB.prepare(`SELECT COUNT(*) as n FROM calls_for_service`).first<{ n: number }>();
    expect(rows?.n).toBe(1);

    const ext = await env.DB.prepare(`SELECT delivery_time_window FROM calls_for_service_ext WHERE id = ?`).bind(first.call_id).first<{ delivery_time_window: string }>();
    expect(ext?.delivery_time_window).toBe('11am-1pm');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:worker -- deliveriesWebhook`
Expected: FAIL — `Cannot find module '../src/routes/deliveriesWebhook'`

- [ ] **Step 3: Add the binding type**

In `src/types.ts`, find the `DIAL_CONNECT_WEBHOOK_SECRET?: string;` line and add immediately after it:

```ts
  // rmpgutahps.us delivery-scheduler → CAD push (piece 1/3). Set via
  // `wrangler secret put RMPG_FLEX_WEBHOOK_SECRET`. Unset -> 503 not_configured.
  // See docs/superpowers/specs/2026-09-14-delivery-scheduler-cad-push-design.md
  RMPG_FLEX_WEBHOOK_SECRET?: string;
```

- [ ] **Step 4: Write the route**

Create `src/routes/deliveriesWebhook.ts`:

```ts
// ============================================================
// RMPG Flex — rmpgutahps.us delivery-scheduler CAD push (piece 1/3)
// ============================================================
// POST /api/deliveries/webhook
//
// Auth model: HMAC-SHA256 over the raw request body, hex-encoded, header
// `x-rmpg-flex-hmac-sha256`, secret RMPG_FLEX_WEBHOOK_SECRET. Matches this
// repo's ServeManager webhook convention rather than a static API key —
// see the design doc for why. Reuses the existing hmacSha256Hex /
// constantTimeEquals helpers from fleetioWebhook.ts rather than
// reimplementing them.
//
// v1 is confirm-only: rmpgutahps.us calls this only from its approve
// action. No cancel/reschedule trigger in this phase (see spec, Out of
// Scope). A repeat call for the same delivery_slots.id (retry, duplicate
// click) updates the existing calls_for_service / calls_for_service_ext
// row pair in place rather than creating a duplicate call — keyed on
// calls_for_service_ext.delivery_slot_id (UNIQUE, partial index).
//
// Spec: docs/superpowers/specs/2026-09-14-delivery-scheduler-cad-push-design.md
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { hmacSha256Hex, constantTimeEquals } from './fleetioWebhook';
import { parseDeliveryWebhookPayload, type DeliveryWebhookPayload } from '../utils/deliveryWebhook';
import { getDb, execute, queryFirst, ensureDeliveryExtColumns } from '../utils/db';
import { currentCallNumberPrefix, withNextCallNumber } from '../utils/callNumberSeq';
import { notConfigured } from '../utils/notConfigured';
import { log } from '../utils/logger';

const deliveriesWebhook = new Hono<Env>();

async function findExistingCallId(db: D1Database, slotId: number): Promise<number | null> {
  const row = await queryFirst<{ id: number }>(
    db,
    `SELECT id FROM calls_for_service_ext WHERE delivery_slot_id = ?`,
    slotId,
  );
  return row?.id ?? null;
}

async function updateExistingDelivery(db: D1Database, callId: number, payload: DeliveryWebhookPayload): Promise<void> {
  await execute(
    db,
    `UPDATE calls_for_service SET location_address = COALESCE(?, location_address) WHERE id = ?`,
    payload.address, callId,
  );
  await execute(
    db,
    `UPDATE calls_for_service_ext SET
       delivery_case_number = ?, delivery_scheduled_date = ?, delivery_time_window = ?,
       delivery_contact_name = ?, delivery_contact_phone = ?, delivery_contact_email = ?,
       delivery_subject_name = ?, delivery_status = ?
     WHERE id = ?`,
    payload.caseNumber, payload.slotDate, payload.timeWindow,
    payload.contactName, payload.contactPhone, payload.contactEmail,
    payload.subjectName, payload.status, callId,
  );
}

async function createDeliveryCall(db: D1Database, payload: DeliveryWebhookPayload): Promise<number> {
  const prefix = currentCallNumberPrefix();
  const address = payload.address ?? '(address not provided by delivery scheduler)';
  const { result: callId } = await withNextCallNumber(db, prefix, async (callNumber) => {
    const insert = await execute(
      db,
      `INSERT INTO calls_for_service
         (call_number, incident_type, priority, status, caller_name, caller_phone,
          location_address, notes, source)
       VALUES (?, 'delivery', 'P4', 'pending', ?, ?, ?, ?, 'other')`,
      callNumber, payload.contactName, payload.contactPhone, address, payload.notes,
    );
    return Number(insert.meta.last_row_id);
  });

  await execute(
    db,
    `INSERT INTO calls_for_service_ext
       (id, external_source_system, delivery_slot_id, delivery_case_number,
        delivery_scheduled_date, delivery_time_window, delivery_contact_name,
        delivery_contact_phone, delivery_contact_email, delivery_subject_name, delivery_status)
     VALUES (?, 'delivery_scheduler', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    callId, payload.slotId, payload.caseNumber, payload.slotDate, payload.timeWindow,
    payload.contactName, payload.contactPhone, payload.contactEmail, payload.subjectName, payload.status,
  );

  return callId;
}

deliveriesWebhook.post('/', async (c) => {
  const secret = c.env.RMPG_FLEX_WEBHOOK_SECRET;
  if (!secret) {
    return notConfigured(c, 'rmpg_flex_webhook_secret_unset', { code: 'RMPG_FLEX_WEBHOOK_SECRET_UNSET' });
  }

  const rawBody = await c.req.text();
  const header = c.req.header('x-rmpg-flex-hmac-sha256');
  if (!header) {
    return c.json({ ok: false, error: 'Missing signature' }, 401);
  }
  const expected = await hmacSha256Hex(secret, rawBody);
  if (!constantTimeEquals(header.toLowerCase(), expected.toLowerCase())) {
    return c.json({ ok: false, error: 'Invalid signature' }, 401);
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(rawBody);
  } catch {
    return c.json({ ok: false, error: 'Invalid JSON' }, 400);
  }

  const parsed = parseDeliveryWebhookPayload(parsedBody);
  if (!parsed.ok) {
    return c.json({ ok: false, error: parsed.error }, 400);
  }

  const db = getDb(c.env);
  await ensureDeliveryExtColumns(db);

  try {
    const existingId = await findExistingCallId(db, parsed.payload.slotId);
    if (existingId !== null) {
      await updateExistingDelivery(db, existingId, parsed.payload);
      return c.json({ ok: true, call_id: existingId, created: false }, 200);
    }
    const callId = await createDeliveryCall(db, parsed.payload);
    return c.json({ ok: true, call_id: callId, created: true }, 201);
  } catch (err) {
    log.error('delivery webhook failed', { slotId: parsed.payload.slotId },
      err instanceof Error ? err : new Error(String(err)));
    return c.json({ ok: false, error: 'Internal error' }, 500);
  }
});

export default deliveriesWebhook;
```

- [ ] **Step 5: Wire the auth bypass**

In `src/middleware/auth.ts`, the `isPublicAuthBypass` function (around line 47-59) currently ends:

```ts
    || pathname === '/api/integrations/calls-for-service'
    || pathname === '/api/dialer-connect/ingest';
```

Change it to:

```ts
    || pathname === '/api/integrations/calls-for-service'
    || pathname === '/api/dialer-connect/ingest'
    // rmpgutahps.us delivery-scheduler → CAD push (piece 1/3). No JWT —
    // gated by HMAC-SHA256 (RMPG_FLEX_WEBHOOK_SECRET) inside the route
    // itself (see src/routes/deliveriesWebhook.ts).
    || pathname === '/api/deliveries/webhook';
```

- [ ] **Step 6: Register the route in `src/routesConfig.ts`**

Find the import block near the top (alongside `import fleetio from './routes/fleetio';`) and add:

```ts
import deliveriesWebhook from './routes/deliveriesWebhook';
```

Find the routes array entry for `{ prefix: '/api/dialer-connect/ingest', ... }` (around line 874) and add immediately after it:

```ts
  { prefix: '/api/deliveries/webhook', router: deliveriesWebhook, auth: 'public',
    note: 'rmpgutahps.us delivery-scheduler push (piece 1/3). HMAC via RMPG_FLEX_WEBHOOK_SECRET (x-rmpg-flex-hmac-sha256). 503 not_configured when unset.' },
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npm run test:worker -- deliveriesWebhook`
Expected: PASS (5 tests)

- [ ] **Step 8: Run the full test suites**

Run: `npm run typecheck && npx vitest run && npm run test:worker`
Expected: all PASS — this touches `src/types.ts`, `src/middleware/auth.ts`, and `src/routesConfig.ts`, all of which are exercised by other suites, so the full run (not just the targeted file) is the real gate here per this repo's own `full-suite-not-targeted-tests` lesson.

- [ ] **Step 9: Commit**

```bash
git add src/routes/deliveriesWebhook.ts src/types.ts src/middleware/auth.ts src/routesConfig.ts test-workers/deliveriesWebhook.test.ts
git commit -m "feat(deliveries): add POST /api/deliveries/webhook CAD push route

HMAC-signed (RMPG_FLEX_WEBHOOK_SECRET) receiver for rmpgutahps.us's
confirmed-delivery push. Creates a dispatchable calls_for_service row
(incident_type='delivery') plus a calls_for_service_ext row carrying
delivery-specific fields, idempotent on delivery_slot_id.

Piece 1/3 of the delivery scheduler <-> Flex integration.
Spec: docs/superpowers/specs/2026-09-14-delivery-scheduler-cad-push-design.md

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: Apply migration to live D1 and verify

**Files:** none (operational task — this repo's migrations aren't reliably applied by `deploy.yml` alone, see CLAUDE.md's "Schema changes (D1)" section).

**Interfaces:** none — this task has no code interface; it's the operational follow-through the spec calls out (`scripts/apply-migration.sh`) so a merge to `main` doesn't silently leave live D1 without the new columns until the reconciler's first request-time self-heal.

- [ ] **Step 1: Merge the PR containing Tasks 1-3 to `main`** (per this repo's PR-flow convention — not a direct push).

- [ ] **Step 2: Apply and track the migration on live D1**

Run:
```bash
scripts/apply-migration.sh 0289_delivery_ext_columns.sql
```
Expected: script reports the DDL applied and the migration inserted into `d1_migrations` on remote D1 `785de7ae-3e7a-4e01-93bb-d24ddd813f6b`.

- [ ] **Step 3: Verify the columns landed**

Run:
```bash
npx wrangler d1 execute rmpg-flex --remote --command "SELECT name FROM pragma_table_info('calls_for_service_ext') WHERE name LIKE 'delivery_%'"
```
Expected: 9 rows listing all `delivery_*` columns.

- [ ] **Step 4: Set the webhook secret**

Run:
```bash
npx wrangler secret put RMPG_FLEX_WEBHOOK_SECRET
```
Expected: prompts for the secret value (coordinate the exact value with the rmpgutahps.us side — both systems must use the same secret). Paste in a securely-generated value (e.g. `openssl rand -hex 32`), confirm.

- [ ] **Step 5: Smoke-test against live**

Coordinate with the rmpgutahps.us side to fire one real confirm-approve event (or a manual curl with a matching HMAC signature) against `https://api.rmpgutah.us/api/deliveries/webhook`, then confirm a new row appears:
```bash
npx wrangler d1 execute rmpg-flex --remote --command "SELECT id, call_number, incident_type, location_address FROM calls_for_service WHERE incident_type = 'delivery' ORDER BY id DESC LIMIT 1"
```
Expected: one row matching the test delivery, visible on the live CAD dispatch board.

---

## Self-Review Notes

- **Spec coverage**: trigger/transport (scheduler-side, referenced only) — Task 3 covers the receiving half; auth (Task 3 Steps 4-5); data model + migration (Task 1, Task 3); idempotency (Task 1 unique index + Task 3 update-in-place, tested); payload contents (Task 2); out-of-scope items (no cancel webhook, no retry queue, no officer/unit changes) — none implemented, consistent with spec.
- **`delivery_origin` vs `external_source_system`**: the spec draft mentioned a new `delivery_origin` column; while mapping file structure for this plan, `calls_for_service_ext.external_source_system` was found already added by migration `0184` for exactly this purpose (recording the originating external system on a `source='other'` row). The plan reuses it (`'delivery_scheduler'`) instead of adding a duplicate column — a refinement of the spec's intent, not a scope change.
- **Type consistency**: `DeliveryWebhookPayload` (Task 2) field names (`slotId`, `caseNumber`, `slotDate`, `timeWindow`, `contactName`, `contactPhone`, `contactEmail`, `notes`, `address`, `subjectName`, `status`) are used identically in Task 3's `createDeliveryCall`/`updateExistingDelivery`/route handler — verified no drift.
