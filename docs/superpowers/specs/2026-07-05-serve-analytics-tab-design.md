# Serve Analytics Tab — Design

## Context

`src/routes/serveDashboard.ts` (mounted at `/api/serve-dashboard`, auth required) is a fully built, working analytics + bulk-ops backend for the process-server subsystem — 12 endpoints — with **zero client callers**. It was verified working in a prior audit round this session. This spec covers building the client UI to consume it: a new tab in the existing `ServePage.tsx`.

This is the first of three planned follow-ups to the same "built backend, no UI" gap (the other two — `serveQueueEnhanced.ts` and `serveIntake.ts`'s document-review queue — are separate specs).

No backend changes are in scope. All 12 routes already exist, are role-gated to `admin`/`manager`/`supervisor`, and were confirmed to match their documented contracts.

## Goal

Add an 8th tab, **"Analytics"**, to `ServePage.tsx`'s tab bar, visible only to `admin`/`manager`/`supervisor` roles, surfacing the process-server analytics and two bulk actions already built server-side.

## Scope

### In scope
- New tab component: `client/src/pages/serve/AnalyticsTab.tsx`
- Wiring for 10 of the 12 `serve-dashboard` endpoints:
  - `GET /daily-summary`
  - `GET /server-performance`
  - `GET /success-rate-by-type`
  - `GET /time-to-serve`
  - `GET /workload-distribution`
  - `GET /weekly-trend`
  - `GET /county-breakdown`
  - `GET /attempt-timeline/:queueId`
  - `POST /export`
  - `POST /bulk-reassign`
  - `POST /bulk-status-update`
- Role-based tab visibility (hide entirely for `officer`, matching the backend's own role gate — no dead-end 403 UI)

### Out of scope (explicitly deferred)
- `GET /stale-attempts` — redundant with the existing `diligence_gap` nudge sweep already surfaced elsewhere in the app. Not wired.
- Any backend route changes — all 12 routes are already correct as built.
- `serveQueueEnhanced.ts` and `serveIntake.ts` review-queue — separate specs, separate PRs.

## Architecture

Single new tab component (`AnalyticsTab.tsx`), added as an 8th entry (`'Analytics'`) in the existing `TABS` const in `ServePage.tsx`. Follows the codebase's existing per-section fetch pattern (each panel independently fetches, sets its own loading/error state via try/catch + toast — a single panel's failure never blanks the whole tab, matching `ServePage.tsx`'s existing style).

Tab visibility: read `useAuth()`'s current user role; render the tab button only if role is `admin`/`manager`/`supervisor`. This mirrors the backend's `DASHBOARD_ROLES` guard rather than showing the tab and letting requests 403.

### Layout (top to bottom)

1. **Shared range selector** — a single 7/30/90-day dropdown at the top of the tab. Drives `server-performance`, `success-rate-by-type`, and `county-breakdown` (all three accept a `days` query param with the same semantics). Does NOT drive `daily-summary` (always "today"), `workload-distribution` (always "now"), `weekly-trend` (fixed 12-week window, different unit), or `time-to-serve` (own control, see below).

2. **Daily summary strip** — `StatsCard` row for `daily-summary`'s six status counts (pending/assigned/in_progress/served/failed/attempted) with percentages, always "today" in America/Denver time (matches backend's `toDenverWallClock` usage).

3. **Workload panel** — `workload-distribution` as a table: officer name, assigned count, overdue count, today's attempts, over-capacity flag (row highlighted red when `over_capacity` is true, using existing severity-color tokens — never hardcoded hex per house style). Clicking an officer row expands to show their assigned `serve_queue` jobs (fetched from the existing `/process-server?officer_id=` list the Queue tab already uses — no new endpoint). Clicking a job within that expansion opens a modal populated by `attempt-timeline/:queueId`, styled consistently with the existing `ServeAuditLogModal` pattern already used elsewhere in `ServePage.tsx`.

4. **Server performance panel** — `server-performance` as a ranked table (officer, success rate %, avg attempts/serve, fastest serve in hours), sorted by the API's own ordering (successful_attempts DESC).

5. **Success-rate-by-type + county-breakdown** — two side-by-side compact tables (attempt_type/city, total, success rate).

6. **Time-to-serve panel** — three stat tiles (avg/median/p90 days). Own independent day-range control (default 90, matching the backend default) since its unit (days-to-serve) is semantically distinct from "activity in the last N days."

7. **Weekly trend panel** — `weekly-trend`, fixed 12-week window, rendered as a simple horizontal bar row per week (total attempts / successful attempts / queues created) using plain CSS bars — no charting library dependency is being added for this.

8. **Bulk actions panel** — under each expanded officer row (from panel 3), the attempts belonging to that officer's assigned queues render as a checkbox list (attempt id, defendant name, attempt date, result). A small action bar above the list offers:
   - **"Reassign selected"** → opens a small officer picker, calls `POST /bulk-reassign` with `{ toServerId, attemptIds, fromServerId: <current officer> }`.
   - **"Set status"** → dropdown of the seven valid statuses, calls `POST /bulk-status-update` with `{ attemptIds, status }`.
   Both actions refetch `workload-distribution` and the expanded officer's attempt list on success, and show a toast with the returned `reassigned_count`/`updated_queue_count`.

9. **Export** — a button opens a small filter popover (status dropdown, start/end date, officer picker) and calls `POST /export` with `{ ...filters, format: 'csv' }`. Response is a raw CSV `Response` (not JSON) — handled as a blob download via a temporary `<a>` element, standard browser download, filename taken from the `Content-Disposition` header already set server-side.

## Data flow

- All panels: `apiFetch<T>('/serve-dashboard/<path>?...')` — no new hooks needed, follows existing `ServePage.tsx` conventions (`useState` + `useCallback` fetch functions + `useEffect`).
- Export is the one non-JSON call; goes through raw `fetch` (or a small dedicated helper) since `apiFetch` assumes JSON — same pattern already used for other CSV exports elsewhere in the app (e.g. `ExportButton` component, already imported in `ServePage.tsx` — check whether it can be reused directly for this call before writing a bespoke one).

## Error handling

- Each panel: independent try/catch, sets a local `error` string on failure, renders an inline `EmptyState`/error message in just that panel — never blocks other panels from rendering.
- Bulk actions: on failure, toast the error message from the response; do not optimistically update local state — always refetch from server on success only.
- 403 (role denied): shouldn't be reachable in practice since the tab is hidden for non-privileged roles, but if hit (e.g. stale session), show a plain "Insufficient permissions" message rather than a raw error.

## Testing

- No existing Worker-side test suite covers `serveDashboard.ts` (per `CLAUDE.md`, there's no Worker test suite yet beyond typecheck) — out of scope to add one as part of a client-only PR.
- Client: manual verification via the dev server preview (per project convention) — load the tab, confirm each panel renders with live data against local D1, confirm role-gating (test as `officer` role — tab must not render), confirm bulk-reassign/bulk-status-update round-trip correctly and refetch.
- No new client unit tests planned — matches the existing pattern where `ServePage.tsx`'s other tabs (Assign, My Run, Performance) have no dedicated test files either.
