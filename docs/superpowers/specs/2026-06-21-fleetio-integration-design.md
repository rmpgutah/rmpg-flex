# Fleet.io Integration — Design Spec

**Date**: 2026-06-21
**Status**: Approved (brainstormed in-session with operator)
**Owner**: Christopher Zamora (operator-owner)
**Implementation**: 9-PR program (see Phasing)

---

## Goal

Make RMPG Flex the **single data-entry surface** for fleet operations while keeping Fleet.io (commercial SaaS, fleetio.com) as the downstream system of record for maintenance discipline, PM reminders, parts/vendor invoicing, and reports. Data flows bidirectionally in real time so a mechanic editing a work order in Fleet.io's mobile app appears on dispatch's readiness board within seconds; conversely, every fuel/inspection/work-order action taken in RMPG immediately flows out to Fleet.io.

Additionally, RMPG ships **richer visualizations and dashboards than Fleet.io's stock UI**, exploiting cross-system joins Fleet.io literally cannot build (calls handled, officer assignments, live GPS).

## Non-goals

- Migrating off Fleet.io. It stays. RMPG mirrors and extends, doesn't replace.
- Retiring RMPG's existing in-house fleet UIs. Dispatch/MDT/patrol keep using them; this work enhances them.
- Replacing ClearPathGPS for telemetry. Live GPS continues to come from ClearPathGPS.
- A parts-inventory subsystem (Phase 2; we serialize but don't model stock).
- A custom-fields engine (Phase 2; we serialize `custom_fields_json` only).
- A vendors-page redesign beyond what `ref_vendors` requires (Phase 2).
- A VMRS-code picker UX beyond a basic searchable cascade (Phase 2).

## Architecture — eight components (six core + two supporting)

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Fleet.io (external)                         │
└──────────────┬───────────────────────────────────┬──────────────────┘
   webhook POST│                                   │outbound HTTPS
               ▼                                   ▲
   ┌────────────────────────┐         ┌─────────────────────────────┐
   │ (3) Webhook receiver   │         │ (1) Fleetio adapter         │
   │ /api/fleetio/webhook   │         │ src/utils/fleetio/client.ts │
   │ HMAC verify, ack, queue│         │ typed errors, retry/backoff │
   └────────────┬───────────┘         └──────────────┬──────────────┘
                │                                    │
                ▼                                    │
   ┌──────────────────────────────────────────────┐  │
   │ (2) Sync engine                              │  │
   │ src/utils/fleetio/sync.ts                    │  │
   │ • applyInbound(event)  • applyOutbound(evt)  │◀─┘
   │ • mergeWithOwnership(local, remote, rules)   │
   │ • idempotency via deterministic event_id     │
   └────┬───────────────────────────┬─────────────┘
        │ reads/writes              │ emit
        ▼                           ▼
   ┌──────────────────┐    ┌─────────────────────────────────────┐
   │ (5) D1 mirror    │    │ (4) Event hooks (write-path glue)   │
   │ fleet_vehicles + │    │ emitFleetioEvent(c, kind, payload)  │
   │ fleetio_links    │    │ called from fuel/inspection routes  │
   │ fleetio_events   │    │ via c.executionCtx.waitUntil        │
   │ fleetio_conflicts│    └─────────────────────────────────────┘
   └──────────────────┘
        │
        ▼
   ┌─────────────────────────────────────────────────────────────────┐
   │ (6) Visualization API + React surfaces                          │
   │ /api/fleet-viz/*  → composed queries joining mirror + RMPG ops  │
   │ client/src/pages/fleet/dashboard/*  (Recharts + Mapbox)         │
   └─────────────────────────────────────────────────────────────────┘
              ▲                                ▲
              │                                │
   ┌──────────┴────────────┐    ┌──────────────┴───────────────────┐
   │ (7) Reconciliation    │    │ (8) Admin/seed routes            │
   │ cron every 30 min     │    │ /api/fleetio/seed (admin only)   │
   │ replays missed events │    │ /api/fleetio/test-connection     │
   └───────────────────────┘    │ /api/fleetio/relink (VIN match)  │
                                └──────────────────────────────────┘
```

### Boundaries & rationale

- **(1) Adapter** (`src/utils/fleetio/client.ts`) — pure Fleet.io HTTP, never touches D1. Unit-testable with stub `fetch`. Mirrors `clearpathGps.ts` / `roboflowAlpr.ts` patterns. Owns: header construction, retry, 429 backoff, typed errors (`FleetioConfigError | TimeoutError | HttpError | RateLimitError`).
- **(2) Sync engine** (`src/utils/fleetio/sync.ts`) — pure logic over typed inputs. Never fetches. Field-ownership rules live here as imported const.
- **(3) Webhook receiver** (`src/routes/fleetio-webhook.ts`) — HMAC verify + queue insertion. **200s in <100 ms** so Fleet.io's 30-second response window is never at risk. All real work happens in `c.executionCtx.waitUntil`.
- **(4) Event hooks** — one `emitFleetioEvent(c, kind, payload)` call site per RMPG write path (fuel POST, inspection POST, work-order PATCH, vehicle UPDATE). Identical shape to the existing `recordAudit()` seam from the R2 Data Catalog project — minimum cognitive load.
- **(5) D1 mirror** — `fleet_vehicles` stays the operational source-of-truth for dispatch/MDT (zero perf change). Three new sync-bookkeeping tables (`fleetio_links`, `fleetio_events`, `fleetio_conflicts`) + one state cursor table (`fleetio_sync_state`).
- **(6) Visualization** — new pages under `client/src/pages/fleet/dashboard/` combining the mirror with RMPG's operational tables. The "why RMPG, not just Fleet.io" demo.
- **(7) Reconciliation cron** — every 30 minutes; safety net for missed webhooks (Fleet.io retries 5×/hr then 1×/hr for 24h, but we may still miss during long redeploys). Replays `fleetio_events WHERE status IN ('pending','failed') AND attempts < 7` with exponential backoff.
- **(8) Admin/seed routes** — one-time seed for initial vehicle push, manual VIN-based relink for the messy cases, test-connection for setup.

## Data model

### Migrations

Migrations are renumbered to land after the current high-water `0132` (collisions with `0130_serve_attempt_schedules.sql`, `0131_serve_location_notes.sql`, `0132_serve_queue_business_id.sql` made the original numbering unsafe). Each PR's plan will pick the next-free integer at authoring time in case more land in main first.

| File | Contents | PR |
|---|---|---|
| `0133_fleetio_sync_tables.sql` | `fleetio_links`, `fleetio_events`, `fleetio_conflicts`, `fleetio_sync_state` | 1 |
| `0134_ref_tables.sql` | ~22 ref tables + 5 xref tables + 1 cache table (DDL only) | 2 |
| `0135_ref_seed.sql` | Static seed data (states, colors, fuel types, units, VMRS catalogue) | 2 |
| `0136_fleet_vehicles_extend.sql` | +13 columns on `fleet_vehicles` | 3 |
| `0137_fleet_fuel_extend.sql` | +8 columns on `fleet_fuel_log` | 3 |
| `0138_work_orders.sql` | `work_orders`, `work_order_line_items`, `work_order_attachments`, `work_order_comments` + 6 columns on `fleet_maintenance` | 5 |
| `0139_inspection_templates.sql` | `inspection_templates` + 3 columns on `vehicle_inspections` | 6 |

Per `[[project-d1-schema-drift-audit]]` memory: **every migration must be applied directly to live D1 `785de7ae` after merge and verified via `pragma_table_info`** — `deploy.yml`'s `continue-on-error: true` on the migration step means the deploy log alone is not authoritative.

### Extensions to existing tables (additive, nullable)

| Table | New columns |
|---|---|
| `fleet_vehicles` | `fuel_volume_units`, `primary_meter_unit`, `secondary_meter_value`, `secondary_meter_unit`, `secondary_meter_label`, `watch_list`, `default_image_url`, `tire_size_id`, `oil_type_id`, `oil_capacity_qts`, `coolant_capacity_qts`, `gvwr_lbs`, `fuel_type_id` (FK→`ref_fuel_types`) — current 50 + 13 = 63 cols, safe under D1 100-col cap |
| `fleet_fuel_log` | `is_partial_fillup`, `vendor_id` (FK→`ref_vendors`), `reference_number`, `geo_lat`, `geo_lng`, `receipt_r2_key`, `comments`, `custom_fields_json` |
| `fleet_maintenance` | `work_order_id` (FK→`work_orders`), `vmrs_system_code`, `vmrs_assembly_code`, `vmrs_component_code`, `attachments_json`, `custom_fields_json` |
| `vehicle_inspections` | `template_id` (FK→`inspection_templates`), `items_json`, `escalated_issue_id` |

### New tables — work-order subsystem

```sql
CREATE TABLE IF NOT EXISTS work_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open','in_progress','waiting_parts','completed','cancelled')),
  number TEXT,
  opened_at TEXT NOT NULL,
  closed_at TEXT,
  summary TEXT,
  vendor_id INTEGER,
  assigned_to_user_id INTEGER,
  est_cost REAL,
  actual_cost REAL,
  odometer_at_open INTEGER,
  odometer_at_close INTEGER,
  notes TEXT,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS work_order_line_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_order_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('labor','part','fee')),
  description TEXT NOT NULL,
  qty REAL DEFAULT 1,
  unit_cost REAL,
  total_cost REAL,
  part_id INTEGER,
  vmrs_code TEXT,
  sort_order INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS work_order_attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_order_id INTEGER NOT NULL,
  r2_key TEXT NOT NULL,
  filename TEXT,
  mime TEXT,
  uploaded_by INTEGER,
  uploaded_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS work_order_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_order_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
```

### New tables — inspection templates

```sql
CREATE TABLE IF NOT EXISTS inspection_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  schema_json TEXT NOT NULL,    -- items: [{key, label, type, required, fail_creates_issue}]
  active INTEGER DEFAULT 1,
  version INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
```

Templates are versioned; editing creates a new version (immutable once submitted-against).

### New tables — Fleet.io sync bookkeeping

```sql
CREATE TABLE IF NOT EXISTS fleetio_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rmpg_table TEXT NOT NULL,
  rmpg_id INTEGER NOT NULL,
  fleetio_resource TEXT NOT NULL,
  fleetio_id INTEGER NOT NULL,
  last_pushed_at TEXT,
  last_pulled_at TEXT,
  pushed_checksum TEXT,    -- skip re-push if unchanged
  pulled_checksum TEXT,
  UNIQUE (rmpg_table, rmpg_id),
  UNIQUE (fleetio_resource, fleetio_id)
);
CREATE TABLE IF NOT EXISTS fleetio_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  direction TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
  event_id TEXT NOT NULL,
  resource TEXT NOT NULL,
  resource_id INTEGER,
  action TEXT NOT NULL,    -- create | update | delete
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER DEFAULT 0,
  payload_json TEXT NOT NULL,
  error TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  processed_at TEXT,
  UNIQUE (direction, event_id)    -- dedup
);
CREATE TABLE IF NOT EXISTS fleetio_conflicts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rmpg_table TEXT NOT NULL,
  rmpg_id INTEGER NOT NULL,
  field TEXT NOT NULL,
  local_value TEXT,
  remote_value TEXT,
  resolution TEXT,    -- local_wins | remote_wins | manual | unresolved
  resolved_by INTEGER,
  resolved_at TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS fleetio_sync_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now','localtime'))
);
```

## Field ownership & bidirectional flow

### The two write paths

**Outbound (RMPG → Fleet.io)** — primary entry path:
1. Operator submits form in RMPG; route handler writes to D1; UI reflects immediately.
2. Same handler calls `emitFleetioEvent(c, '<resource>.<action>', {...})` inside `c.executionCtx.waitUntil`.
3. Helper writes `fleetio_events` row (`direction='outbound'`), then fires the adapter call.
4. On success: `fleetio_links` row created/updated, `pushed_checksum` stamped, event marked `completed`.
5. On failure: event marked `failed` with error; reconciliation cron retries with exponential backoff.

**Inbound (Fleet.io → RMPG)** — for changes originating in Fleet.io:
1. Fleet.io POSTs to `/api/fleetio/webhook` with `X-Fleetio-Webhook-Signature`.
2. Receiver verifies HMAC SHA-256 against `FLEETIO_WEBHOOK_SECRET`. Mismatch → 401, log to `audit_log`.
3. Receiver writes `fleetio_events` row (`direction='inbound', event_id=<fleetio_event_id>`) — `UNIQUE` constraint dedupes retries.
4. Receiver returns **HTTP 200 in under 100 ms**.
5. `c.executionCtx.waitUntil(syncEngine.applyInbound(eventId))` kicks off the D1 work asynchronously.
6. Sync engine applies the change per the ownership map, writes D1, broadcasts over the existing WS (`src/routes/ws.ts`) — connected clients re-render via `useLiveSync`.

### Ownership map (`src/utils/fleetio/ownership.ts`)

Hard-coded TS const. Reasons (rejected D1 alternative): policy-is-code matches every other rule in this codebase (route allowlists, role permissions); git blame is the audit trail; an admin-edited rule has no review gate. If churn exceeds ~2 edits/month, promote to D1 overrides at that point — not before.

Three classes per field:

- **`'rmpg'`** — RMPG-owned. Outbound push always wins. If Fleet.io sends an inbound update, log a conflict and **don't overwrite**; queue an outbound re-assertion of the RMPG value.
- **`'fleetio'`** — Fleet.io-owned. Inbound updates always win. Outbound pushes for this field are dropped silently.
- **`'shared'`** — Last-write-wins by `updated_at` timestamp. If both sides changed within a 60-second window, log `resolution='unresolved'`, apply remote value as default, badge in UI.

Initial map (refinable; full per-resource map lives in `ownership.ts`):

```ts
export const VEHICLE_OWNERSHIP = {
  vehicle_name:            'rmpg',
  vehicle_number:          'rmpg',
  assigned_unit_id:        'rmpg',
  status:                  'rmpg',
  current_mileage:         'rmpg',      // ClearPathGPS-fed
  is_pursuit_rated:        'rmpg',
  is_take_home:            'rmpg',
  garage_location:         'rmpg',
  color:                   'rmpg',
  plate_state:             'rmpg',
  default_image_url:       'rmpg',
  next_service_mileage:    'fleetio',   // FI's PM engine computes
  next_service_date:       'fleetio',
  warranty_expiry_date:    'fleetio',
  watch_list:              'fleetio',
  vin:                     'shared',
  make:                    'shared',
  model:                   'shared',
  year:                    'shared',
  plate_number:            'shared',
  body_type:               'shared',
  fuel_type_id:            'shared',
  primary_meter_unit:      'shared',
} as const;
```

(Full map for fuel/maintenance/work-orders/inspections in `ownership.ts`.)

### Conflict UI

**Inline badge** on the affected record (vehicle/fuel/WO). Small amber chip with hover-tooltip showing `local vs remote` values and a one-click resolve (apply local / apply remote / keep both as note). Matches existing `IconButton` + toast patterns. No daily email noise.

A second `/admin/fleetio-health` page surfaces aggregated conflict counts + unresolved list as a fallback for ones the operator missed at point-of-edit.

## Cross-reference DB & autofill engine

**Goal**: every form-fillable string is FK-backed, autocomplete-driven, with cascading filters and external-decode autofill. Building this first means every later feature (forms, viz, queries) operates on clean joined data instead of free-text typos.

### Reference tables (`0135_ref_tables.sql`)

**Vehicle reference**: `ref_vehicle_makes`, `ref_vehicle_models`, `ref_vehicle_types`, `ref_body_types`, `ref_drivetrains`, `ref_transmission_types`, `ref_engine_types`, `ref_fuel_types`, `ref_colors`, `ref_plate_states`, `ref_tire_sizes`, `ref_oil_types`.

**Maintenance reference**: `ref_vmrs_systems`, `ref_vmrs_assemblies`, `ref_vmrs_components` (~5500 codes), `ref_service_types`, `ref_part_categories`, `ref_parts`, `ref_labor_rates`, `ref_work_order_categories`.

**Fuel reference**: `ref_fuel_grades`, `ref_fuel_card_types`.

**Shared**: `ref_vendors` (supersedes `fleet_fuel_vendors`; `kind` ∈ fuel|shop|parts|insurance), `ref_units_of_measure`.

**Cross-reference joins**: `xref_make_to_default_oil`, `xref_model_year_to_specs`, `xref_vehicle_type_to_template`, `xref_vmrs_to_default_parts`, `xref_vendor_to_recent_parts`.

**VIN decoder cache**: `vin_decode_cache (vin PK, decoded_json, fetched_at)`.

### Seeding strategy

| Table | Source | Cadence |
|---|---|---|
| `ref_plate_states` | Static (50 + DC + territories) | One-time in migration |
| `ref_colors`, `ref_fuel_types`, `ref_units_of_measure`, `ref_drivetrains`, `ref_transmission_types` | Static (~15-20 rows each) | One-time |
| `ref_vmrs_*` | Official VMRS catalogue (TMC); ~5500 rows | One-time JSON-loaded migration (split if migration runner strains on ~300KB compressed payload) |
| `ref_vehicle_makes/models` | NHTSA vPIC bulk export (free, public) | Monthly cron `0 3 1 * *` |
| `ref_oil_types`, `ref_tire_sizes`, `ref_service_types` | Curated (~30-50 rows each) | One-time; admin can add |
| `vin_decode_cache` | NHTSA vPIC API on first encounter | Lazy per-VIN |
| `ref_vendors` | Migrate from existing `fleet_fuel_vendors`; admin adds shops | Migration + manual |

### Autofill flows

**Vehicle entry**: VIN → `vin_decode_cache` (miss → fetch NHTSA vPIC → cache) → autofill make/model/year/body/engine/transmission/drivetrain/fuel-type/GVWR. Operator can override any field. Picking `vehicle_type` filters body_types, default inspection_template (`xref_vehicle_type_to_template`), default oil/tire (`xref_model_year_to_specs`).

**Service entry**: VMRS system → assembly dropdown narrows → component dropdown narrows → suggested parts surface (`xref_vmrs_to_default_parts` ranked by frequency). Picking vendor surfaces `xref_vendor_to_recent_parts` for one-click re-use.

**Fuel entry**: device geolocation → nearest `ref_vendors WHERE kind='fuel'` (within 0.5 mi) surfaces. Vendor → fuel grades narrow. Receipt photo → optional Workers AI OCR pass autofills gallons/price/total.

**Inspection template builder**: items from `ref_inspection_items` library OR custom. Templates versioned; editing creates a new version.

### Bidirectional sync of reference data

| RMPG ref table | Fleet.io resource | Ownership |
|---|---|---|
| `ref_fuel_types` | `fuel_types` | fleetio |
| `ref_vehicle_types` | `vehicle_types` | fleetio |
| `ref_vendors` | `vendors` + `contacts` | shared |
| `ref_parts` | `parts` | shared |
| `ref_vmrs_*` | `vmrs_*` | fleetio |
| `ref_makes/models` | `vehicle_makes/models` | fleetio |

Inbound webhooks for these resources update the local ref table → forms reload dropdowns via WS.

### Admin UI

`/admin/reference-data` (tabbed CRUD), `/admin/vmrs-browser` (tree view + search; needed for 5500 codes), `/admin/vendors` (list + map + merge-duplicates tool for legacy free-text fuel logs).

## Visualization surface

### Foundations (ship regardless)

- **F1** Fleet KPI ribbon (top of dashboard) — totals: in-service / in-shop / overdue PMs / avg MPG / month cost-per-mile. Live via WS.
- **F2** Vehicle dossier page — tabbed: Service timeline, Fuel chart, Work orders, Inspections, Calls handled, Officer assignments.
- **F3** Readiness Board — per-shift grid; one card per vehicle: status + fuel + PM countdown + open WOs + last inspection.

### Phase 1 chart selection (operator-selected: all 8)

| Code | Surface | Lib | Moat? (RMPG-only edge) |
|---|---|---|---|
| **V1** | Fleet Map — Mapbox overlay, vehicles colored by readiness, click for dossier | Mapbox | ✅ live GPS |
| **V2** | PM Timeline (Gantt) — vehicles × time, scheduled/overdue/completed bars | Recharts + custom | ❌ |
| **V3** | MPG by officer scatter — outliers = lead foot or fuel theft | Recharts | ✅ needs officer assignments |
| **V4** | Cost-per-mile stack — fuel + maint + parts + insurance per vehicle | Recharts | ❌ |
| **V5** | Work Order Sankey — open→in-shop→parts→returned→closed flow | d3/custom SVG | ❌ |
| **V6** | Fuel anomaly heatmap — calendar × officer, intensity = anomaly score | Recharts | ✅ needs officer + GPS-derived "was this car at this station" |
| **V7** | Calls per gallon — productive work per gallon consumed | Recharts | ✅✅ Fleet.io literally cannot build this |
| **V8** | Upcoming PM list — sorted by miles-until-due + spark | table + Recharts mini | ❌ |

V3/V6/V7 are the moat. Build at least one in Phase 1 so the integration demonstrates net-new capability, not just a Fleet.io reskin.

### Backend

New routes under `/api/fleet-viz/*` — pure aggregates joining mirror tables with RMPG operational tables (`calls_for_service`, `cad_units`, `officers`, ClearPathGPS tables). All read-only.

## Error handling, idempotency, observability

### Idempotency

- **Outbound** — deterministic `event_id = sha256(rmpg_table + ':' + rmpg_id + ':' + action + ':' + version_counter)`. `UNIQUE(direction, event_id)` blocks double-creates on replay.
- **Inbound** — Fleet.io's webhook event id used as `event_id`. Their retry policy (5×/hr + 1×/hr for 24h = up to 29 attempts) makes duplicates routine; unique constraint silently drops them.
- **Per-resource checksums** — `fleetio_links.pushed_checksum` skips a push entirely if payload hash unchanged. Eliminates rate-limit pressure from save-without-changes PATCHes.

### Retries & backoff

- Outbound: 1s, 4s, 16s, 60s, 5m, 30m, 2h. After 7 failures, mark `failed` and surface in admin queue.
- Inbound: ack 200 immediately; failures during `waitUntil` are picked up by 30-min reconciliation cron.
- HTTP 429: respect `Retry-After`; absent → backoff schedule. Three consecutive 429s → 5-minute circuit-breaker pause.

### Failure modes

| Failure | Behavior |
|---|---|
| `FLEETIO_API_KEY` unset | 503 `{ error: 'fleetio_not_configured' }`; UI surfaces "Sync disabled" banner (mirrors `/api/alpr` pattern) |
| HMAC mismatch | 401, log to `audit_log` as potential probe |
| Fleet.io 5xx | Retry per backoff; after 7 failures, surface in conflicts UI |
| Fleet.io 4xx (non-429/401) | Mark `failed` immediately (bad payload), surface |
| D1 write fails after webhook ack | Reconciliation cron retries |
| Conflict on `rmpg`-owned field | Log conflict, don't overwrite, queue outbound re-assertion |
| Conflict on `shared` field within 60s | Log unresolved, apply remote (default), badge in UI |
| Reconciliation finds Fleet.io row with no link AND VIN matches RMPG row | Auto-link by VIN, log to `audit_log` |

### Observability

`/admin/fleetio-health` page:
- Outbound queue depth + 24h success/failure counts
- Inbound webhook receive rate + last-received timestamp (alert if >2h gap during business hours)
- Conflicts unresolved (linked to inline resolution UIs)
- Reconciliation last-run + delta-found
- `fleetio_sync_state` last-cursor positions per resource

Emit to existing `flex_events` analytics stream (R2 Data Catalog project — see `[[project-r2-data-catalog-analytics]]`) for long-term retention + SQL queryability:

```ts
recordAudit(c, { type: 'FLEETIO_SYNC', resource, action, direction, status, ms_elapsed })
```

### Configuration

Three new secrets via `wrangler secret put`: `FLEETIO_API_KEY`, `FLEETIO_ACCOUNT_TOKEN`, `FLEETIO_WEBHOOK_SECRET`.

One new env var in `wrangler.toml` `[vars]`: `FLEETIO_API_BASE = "https://secure.fleetio.com/api/v1"`.

One new cron in `wrangler.toml`:

```toml
[[triggers]]
crons = ["*/30 * * * *"]   # Fleet.io reconciliation, every 30 min
```

(Monthly NHTSA refresh cron `0 3 1 * *` added in PR 2.)

## Testing strategy

| Layer | Test type | Coverage target |
|---|---|---|
| `client.ts` adapter | Vitest with stub fetch | 40+ cases: headers, retry/backoff, error typing, 429 |
| `ownership.ts` | Vitest | ~30 cases: every field × every class combo |
| `sync.ts` engine | Vitest with in-memory event store | applyInbound/applyOutbound, dedup, checksum-skip, conflict path |
| Webhook receiver | Miniflare + signed test payload | HMAC verify (good + bad), ack timing <100ms, queue insertion |
| Event-hook integration | Vitest with stub adapter | One outbound event per write path per resource |
| Reconciliation cron | Vitest with seeded D1 + stub adapter | Picks up failed events, respects backoff window, VIN auto-link |
| Viz queries | Vitest | `/api/fleet-viz/*` SQL produces expected aggregates over seed data |
| UI components | Vitest + RTL | Conflict badge, readiness board sort, dossier tabs, autofill cascades |

**Worker test bootstrap**: per CLAUDE.md, there's no Worker test suite today. PR 4 sets up Miniflare for `/src/` — small one-time cost, unlocks every future Worker test. Listed as Phase 2 tech debt already; this is the forcing function.

## Phasing — 9 PRs

| PR | Title | Ships |
|---|---|---|
| **1** | `feat(fleetio): adapter + seed + admin connect` | `client.ts`, types, `/api/fleetio/test-connection`, `/api/fleetio/seed` (admin), wrangler secrets/cron, mig `0133`, vitest harness |
| **2** | `feat(fleet-ref): cross-reference DB + VIN decoder + seed` | Migs `0134`+`0135`, NHTSA decoder util + cache, ref-table CRUD routes, `/admin/reference-data` + `/admin/vmrs-browser` + `/admin/vendors` skeletons, monthly NHTSA cron |
| **3** | `feat(fleet): schema parity push (vehicles + fuel)` | Migs `0136`+`0137`, extended vehicle/fuel forms with "Advanced" sections backed by ref tables, `emitFleetioEvent` wired, **schema-diff report committed** at `docs/superpowers/specs/2026-06-21-fleetio-schema-diff.md` |
| **4** | `feat(fleetio): bidirectional sync + conflicts UI + Miniflare harness` | `/api/fleetio/webhook` (HMAC), `sync.ts`, `ownership.ts`, reconciliation cron, inline conflict badge component, Miniflare set up for `/src/` tests |
| **5** | `feat(work-orders): full lifecycle subsystem` | Mig `0138`, `/api/work-orders/*` CRUD, list/detail/edit pages, WO sync wired |
| **6** | `feat(inspections): templates + per-item photos + auto-issue` | Mig `0139`, template builder (admin), QR pre-trip uses templates, per-item photos, fail → auto-create issue + outbound emit |
| **7** | `feat(fleet-dashboard): foundations + V4 + V8` | F1 KPI ribbon, F2 vehicle dossier, F3 readiness board, V4 cost-per-mile, V8 upcoming PM list, `/api/fleet-viz/*` aggregates |
| **8** | `feat(fleet-viz): moats — Map + MPG + anomalies + calls/gallon` | V1 Fleet Map, V3 MPG-by-officer, V6 fuel anomaly heatmap, V7 calls-per-gallon |
| **9** | `feat(fleet-viz): PM timeline + WO Sankey` | V2 PM Gantt, V5 work-order Sankey, saved-view persistence |

Each PR is independently shippable. Pausing after any PR leaves the system functional. Per `[[feedback-use-pr-flow-not-direct-push]]`: every PR branches off `origin/main` → `gh pr create` → user reviews & merges → CI deploys.

## Risk register

| Risk | Mitigation |
|---|---|
| Fleet.io rate limits unknown until first sustained sync | Adapter has 429 handler + circuit-breaker; `/admin/fleetio-health` exposes 429 counts early |
| Migration drift to live D1 | Each PR's checklist requires direct DDL apply to live `785de7ae` + `pragma_table_info` verify |
| Webhook 30-s timeout under D1 contention | Ack happens in <100 ms; all D1 work in `waitUntil` |
| `fleet_vehicles` column-cap pressure | 50 + 13 = 63 cols (safe under D1's ~100 cap); `scripts/check-column-cap.js` enforces in CI |
| VMRS seed payload (~300KB compressed) strains migration runner | Split into chunked migration files if needed |
| 9-PR program drift if priorities shift | Each PR independently shippable; can pause after any one without orphaning work |
| User squash-merge drops hunks (per `[[feedback-verify-main-compiles-after-stack-merge]]`) | After each merge, verify main compiles + key file count tripwires before starting next PR |
| Fleet.io webhook secret not yet provisioned | PR 4 includes secret-setup checklist in its body; PR 1-3 ship without inbound (outbound-only) so don't block |
| NHTSA vPIC API rate limit (5/sec public) | Per-VIN cache + bulk-export refresh only monthly; no risk under normal use |
| Operator edits Fleet.io directly and confuses the team | Conflict UI surfaces; team education that RMPG is the entry point; inbound webhook always works as safety net |

## Open questions / deferred to Phase 2

- **Parts inventory subsystem** — stock-on-hand, reorder points, location tracking. Fleet.io has this; we serialize `part_id` references but don't model inventory.
- **Vendor lifecycle UI** — beyond `ref_vendors` CRUD.
- **VMRS picker UX** — beyond basic cascade.
- **Custom fields engine** — per-account user-defined fields. Stored as `custom_fields_json` but no definition UI.
- **D1-overridable ownership map** — code-only for now; promote if rule changes exceed ~2/month.
- **In-cabin tablet integration** — surface inspection workflow on MDT tablets (would integrate with existing MDT bus from `[[project-ios-field-workflows-platform]]`).

## References

- Fleet.io [Quick Start](https://developer.fleetio.com/docs/overview/quick-start)
- Fleet.io [Webhooks overview](https://developer.fleetio.com/docs/overview/webhooks)
- Fleet.io [Receiving a webhook event payload](https://developer.fleetio.com/docs/guides/webhooks/receiving-a-webhook-event-payload)
- Fleet.io [API Keys help](https://help.fleetio.com/en_US/api-keys)
- Fleet.io [Developer API (2023-03-01)](https://developer.fleetio.com/docs/api/2023-03-01/fleetio-developer-api)
- NHTSA vPIC [API documentation](https://vpic.nhtsa.dot.gov/api/)
- TMC [VMRS standard](https://tmc.trucking.org/VMRS)

## Cross-references to existing memory

- `[[project-r2-data-catalog-analytics]]` — `recordAudit()` pattern for `flex_events` emissions; identical seam used here.
- `[[project-d1-schema-drift-audit]]` — every migration applied directly to live `785de7ae` after merge.
- `[[project-alpr-roboflow]]` — 503-when-key-missing pattern for `/api/fleetio` routes.
- `[[project-clearpathgps-integration-auth]]` — adapter shape (KV-cached creds, retry/backoff, typed errors).
- `[[feedback-use-pr-flow-not-direct-push]]` — every PR branches off `origin/main` → PR → merge → deploy.
- `[[feedback-verify-main-compiles-after-stack-merge]]` — verify main after each merge before starting next PR.

## Supporting deliverables

- **`docs/superpowers/specs/2026-06-21-fleetio-schema-diff.md`** — produced in PR 3; field-by-field comparison between Fleet.io's resource schemas and RMPG's existing tables, with must/should/nice priorities. Referenced by all subsequent form-extension PRs.
