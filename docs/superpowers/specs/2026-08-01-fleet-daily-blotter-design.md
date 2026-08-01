# Fleet Daily Blotter — Design

**Date:** 2026-08-01
**Status:** Approved, pending implementation plan
**Author:** Claude Code (brainstormed with Christopher Zamora)

## Problem

`FleetReportsPage` (`/fleet/reports`, routed at [`App.tsx:618`](../../../client/src/App.tsx), linked from [`FleetPage.tsx:813`](../../../client/src/pages/fleet/FleetPage.tsx)) is a live, reachable page whose entire backend does not exist. It calls three endpoints:

- `GET /api/reports/daily-reports/by-month`
- `GET /api/reports/daily-reports/:filename`
- `POST /api/reports/daily-reports/generate`

None are implemented. `/api/reports` is mounted ([`routesConfig.ts:722`](../../../src/routesConfig.ts)) but `src/routes/reports.ts` has no `daily-reports` routes, there is no report generator anywhere in `src/`, and `wrangler.toml` has no cron near 00:05 (`0 */4`, `* * * * *`, `*/30`, `0 3 1 * *`). Every click produces a 404.

The page's own header comment claims reports are "Generated nightly at 00:05 MT by the existing `dailyReportGenerator`". That describes VPS-era code deleted in the 2026-07-16 cleanup and never ported. Per CLAUDE.md, comments referencing the old `server/` tree are history, not fact.

## Goal

Generate a **combined daily blotter** PDF — operations section plus fleet section — nightly at 00:05 America/Denver, store it in R2, and serve it through the three endpoints the existing UI already expects. No client changes.

## Non-goals

- Emailing or scheduled distribution of the blotter.
- Client-deliverable / per-contract site reports (different audience, different branding, different scoping).
- Any change to `FleetReportsPage.tsx` beyond removing the stale `dailyReportGenerator` comment.
- Replacing the client's jsPDF v2 engine. The two PDF codepaths coexist.

## Data reality

Measured against live D1 `785de7ae` on 2026-08-01:

| Source | Rows | Role |
|---|---:|---|
| `calls_for_service` | 114 (1–6/day) | Operations |
| `unit_trips` | 191 | Fleet miles & trips |
| `nav_trip_log` | 27 | Fleet trips |
| `fleet_fuel_log` | 92 | Fuel added |
| `fleet_inspections` | 18 | Daily checks |
| `fleet_pretrip_checklists` | 10 | Daily checks |
| `citations` | 2 | Operations |
| `work_orders` | 1 | Maintenance |
| `fleet_vehicles` | 1 | Fleet roster |
| `call_units` | **0** | ⚠️ Unusable |

**`call_units` is empty.** Officer/unit attribution must come from columns on `calls_for_service` itself — `assigned_unit_ids`, `unit_call_signs`, `reporting_officer_id`, `responding_officer`. A join through `call_units` would silently produce an empty operations section.

At 1–6 calls/day the output is a 1–3 page PDF. Pagination volume and cron duration are not concerns.

## Architecture

Four units, each with one purpose and independently testable.

### `src/utils/dailyReport/dates.ts`

```ts
export function denverDayBoundsUtc(dateStr: string): { startUtc: string; endUtc: string }
export function denverToday(nowMs: number): string   // YYYY-MM-DD
export function previousDenverDays(dateStr: string, n: number): string[]
```

**This module exists because of a real trap.** A blotter "for 2026-07-18" must cover 00:00:00–23:59:59 *America/Denver*, but D1 stores UTC (`datetime('now')`). A naive `date(created_at) = ?` misfiles every call between 18:00 and midnight Mountain into the following day, and shifts by an hour across DST. All collection queries take explicit UTC instant bounds derived here — never `date()` on a raw column.

Pure functions, no clock reads (`nowMs` is injected), so DST transitions are directly testable.

### `src/utils/dailyReport/collect.ts`

```ts
export interface DailyReportData {
  date: string;                    // YYYY-MM-DD (Denver)
  generatedAt: string;             // ISO
  operations: {
    calls: CallRow[];
    citations: CitationRow[];
  };
  fleet: {
    trips: TripRow[];              // per-vehicle, with miles
    fuel: FuelRow[];
    checks: CheckRow[];            // inspections + pre-trip checklists
    workOrders: WorkOrderRow[];    // opened or closed that day
  };
}

export function isEmpty(data: DailyReportData): boolean
export async function collectDailyReport(db: D1Database, date: string): Promise<DailyReportData>
```

All D1 reads live here; no formatting, no PDF concepts. Every query is bounded by `denverDayBoundsUtc(date)`.

**Column-cap constraint:** `calls_for_service` sits at the D1 100-column limit. Per CLAUDE.md gotcha 19 and the `d1-column-cap-for-lists` memory, select an explicit narrow column list — never `SELECT *` or `SELECT c.*`.

### `src/utils/dailyReport/render.ts`

```ts
export function renderDailyReport(data: DailyReportData): Promise<Uint8Array>
```

**Pure** — takes data, returns PDF bytes. No D1, no R2, no `Date.now()`. Uses `pdf-lib` (new Worker dependency: pure JS, Workers-compatible, no per-use billing, unlike the `[browser]` Browser Rendering binding which is billed per browser-minute).

Layout: RMPG header with date and generation timestamp, Operations section, Fleet section, page numbers in the footer. A section with no rows prints "No activity recorded" rather than being omitted, so a reader can tell "nothing happened" from "this report is broken".

Purity is what makes this testable: a test asserts on returned bytes with no bindings at all.

### `src/utils/dailyReport/store.ts`

```ts
export function reportKey(date: string): string      // daily-reports/YYYY/MM/rmpg-daily-YYYY-MM-DD.pdf
export function parseReportKey(key: string): { date: string; filename: string } | null
export async function putReport(bucket: R2Bucket, date: string, bytes: Uint8Array): Promise<void>
export async function getReport(bucket: R2Bucket, filename: string): Promise<R2ObjectBody | null>
export async function listReports(bucket: R2Bucket): Promise<StoredReport[]>
export async function hasReport(bucket: R2Bucket, date: string): Promise<boolean>
```

Bucket: `DOWNLOADS` (`rmpg-flex-downloads`). **R2 is the single source of truth** — `by-month` is built from an R2 list, so there is no index table that can drift from the objects.

`parseReportKey` rejects anything not matching the exact `rmpg-daily-YYYY-MM-DD.pdf` shape. The download route resolves a filename to a key through it rather than interpolating user input, so `../` traversal and prefix escape are structurally impossible.

### `src/routes/dailyReports.ts`

Sub-router mounted inside the existing `/api/reports` router at `/daily-reports`.

**Mount order is load-bearing.** Hono matches in declaration order (see the `warrant-page-pipeline-repair` memory). Verified 2026-08-01: all 29 routes in `reports.ts` use literal prefixes and none is a bare `/:param`, so nothing currently shadows `/daily-reports/*` — the closest, `/shift-activity/:officerId`, is prefixed and cannot. The hazard is therefore latent rather than present: a future bare-parameter route declared above this mount would silently swallow it. The routing test below pins the behavior so that regression fails loudly instead of returning someone else's JSON.

| Route | Auth | Behavior |
|---|---|---|
| `GET /by-month` | authenticated | `{ months: [{ month, days: [{ filename, date, size, generated_at }] }], total_reports }`, months newest-first, days newest-first — matching what the UI already renders |
| `GET /:filename` | authenticated | PDF bytes, `Content-Type: application/pdf`, `Content-Disposition: inline`. 404 on unknown or malformed filename |
| `POST /generate` | `requireRole('admin')` | Body `{ date }`. Regenerates and overwrites. `{ ok: true, filename }`, or `{ ok: false, message }` when the day has no activity |

Missing `DOWNLOADS` binding returns `200 { ok: false, code: 'not_configured' }`, per the `503-not-configured-anti-pattern` memory — not a 503.

### Scheduling

**No new cron trigger.** The per-minute `* * * * *` handler already runs Denver-local daily work by gating on `Intl.DateTimeFormat('America/Denver')` hour and minute ([`index.ts:502`](../../../src/index.ts)). A new gate on `hour === 0 && minute === 5` follows that pattern exactly and is DST-correct for free.

The job generates **yesterday's** Denver day, then backfills: it checks the previous 7 Denver days and generates any missing from R2. Self-healing after an outage, bounded so it can never run long. Days with genuinely no activity produce no object and are re-checked cheaply each night — `hasReport` is a `head`, and `collect` short-circuits on `isEmpty`.

The whole task is wrapped in its own try/catch with `logErrorToDb`, so a failure cannot abort the other per-minute cron work — matching the existing convention.

## Retention

Indefinite. At 1–3 pages/day, a decade stays well under a gigabyte. A blotter is a records document; silent expiry of a law-enforcement record is discovered at the worst possible moment. No R2 lifecycle rule is configured.

## Error handling

| Condition | Behavior |
|---|---|
| Day has no activity | No object written. `generate` → `{ ok: false, message }`. Cron skips silently. |
| `DOWNLOADS` unbound | `{ ok: false, code: 'not_configured' }`, HTTP 200. |
| D1 read fails during collect | Throws; cron catches and logs to `error_log`; route returns 500. Never a partial PDF. |
| R2 put fails | Throws; same handling. No half-written object, since `put` is atomic. |
| Unknown/malformed filename | 404 from `parseReportKey` returning null. |
| Cron task throws | Caught per-task, logged, other cron work proceeds. |

## Testing

**`tests/dailyReportDates.test.ts`** — the highest-value tests here.
- Denver day bounds convert to correct UTC instants in both MST and MDT.
- Both 2026 DST transitions: spring-forward (23-hour day) and fall-back (25-hour day).
- A call at 23:30 MT lands in that Denver day, not the next.
- `previousDenverDays` walks backward across a DST boundary without duplicating or skipping.

**`tests/dailyReportCollect.test.ts`** — stub D1.
- Empty day → `isEmpty` true.
- Populated day → each section carries its rows.
- Queries bind UTC instant bounds, never `date(created_at)`. Asserted on the emitted SQL, because a stub that filters in TS would pass either way. *(This exact trap was hit in PR #3243: mirroring a predicate in the stub let the production clause be deleted with every test still green.)*
- No query selects `*` from `calls_for_service` (column cap).

**`tests/dailyReportRender.test.ts`** — pure, no bindings.
- Output begins with `%PDF-`.
- Empty sections render the "No activity recorded" line rather than vanishing.
- Deterministic: same input twice → same byte length.

**`tests/dailyReportStore.test.ts`** — pure key logic.
- `reportKey` / `parseReportKey` round-trip.
- `parseReportKey` rejects traversal (`../`), wrong extension, and malformed dates.

**`test-workers/dailyReports.test.ts`** — Miniflare, real R2.
- `by-month` groups and orders correctly, and returns an empty shape (not a 500) when the bucket is empty.
- `:filename` returns bytes with the right headers; unknown filename 404s.
- `generate` is admin-only; a non-admin gets 403.
- `/api/reports/daily-reports/by-month` resolves to this router, not a sibling route in `reports.ts`.

## Risks

1. **`pdf-lib` bundle size.** New Worker dependency. The plan measures the bundle before and after; if it materially moves startup, the fallback is lazy `await import()` inside the render path so only the cron and `generate` pay for it.
2. **Mount-order regression.** Nothing shadows `/daily-reports/*` today (verified above), but a future bare-parameter route declared ahead of it would. The routing test is the guard.
3. **Thin fleet data.** With one vehicle and one work order, the fleet section will often be near-empty. That is a true reflection of current operations, not a defect — the "No activity recorded" line makes it legible.
4. **Backfill on first deploy.** The first nightly run finds 7 missing days and generates all of them. Bounded and cheap at this data volume, but expected — not a malfunction.

## Out of scope, noted for later

- Emailing the blotter to a distribution list.
- A weekly or monthly roll-up.
- Per-contract client-facing site reports.
