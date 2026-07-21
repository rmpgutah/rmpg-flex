# Warrant Tab Backend Rebuild — Design

**Date**: 2026-07-21
**Status**: Approved
**Author**: Claude (with Christopher Zamora)

## Context

`src/routes/warrants.ts` (33 endpoints, ~1,373 lines) has accumulated through a long series of "implement missing/dead route" patches (see git log: #2787, #2743, #2700, #2602, #2593, #2811, #2823-2827, #2844) rather than a single coherent design. The `warrants` table (60 columns) has multiple redundant column pairs from this iterative history (`type`/`warrant_type`, `bond_amount`/`bail_amount`, `court`/`issuing_court`, `judge`/`issuing_judge`, `offense`/`offense_description`/`charge_description`, `expiry_date`/`expires_at`, `service_date`/`served_at`, `subject_person_id`/`person_id`). This drift is the recurring root cause of the "missing route" bug pattern: routes and frontend disagree on which column is authoritative.

This is a full architectural rebuild: dedupe the schema, rebuild the route internals against a single canonical column set and an enforced status state machine, and rewire the frontend to match — landed as one PR in sequenced commits (migration → backend → frontend).

Out of scope: national warrant pull (`national_warrant_sources`/poller), NSOPW auto-screen (`screenPersonAllSources`), and Legal Data Hunter integrations keep their current behavior — only their references to renamed warrant columns are updated.

## Schema Dedup

New migration (next free prefix after `0199`, i.e. `0200_warrants_schema_dedup.sql`). For each duplicate pair: backfill the canonical column from the deprecated one wherever canonical is null, then `ALTER TABLE warrants DROP COLUMN <deprecated>`.

| Keep (canonical) | Drop | Notes |
|---|---|---|
| `warrant_type` | `type` | |
| `charge_description` | `offense`, `offense_description` | coalesce in that priority order |
| `issuing_court` | `court` | |
| `issuing_judge` | `judge` | |
| `bail_amount` | `bond_amount` | |
| `expires_at` | `expiry_date` | |
| `served_at` | `service_date` | |
| `person_id` | `subject_person_id` | all routes/screening callers switch to `person_id` |

`subject_first_name`/`subject_last_name`/`subject_name` are NOT deduped — they're legitimately distinct (structured vs display name) and both are read by the frontend.

Migration must be idempotent per repo convention (`migrations/README.md`): guard each `ALTER ... DROP COLUMN` and backfill with existence checks so re-running doesn't error. Apply directly to live D1 after merge per CLAUDE.md's `scripts/apply-migration.sh` process (deploy step is `continue-on-error`), and verify via `pragma_table_info('warrants')`.

## Status State Machine

Canonical statuses (matches `WarrantsPage.tsx`'s existing TS union exactly — no frontend relabeling): `active` | `served` | `recalled` | `expired` | `quashed`. `archived_at` remains an orthogonal soft-delete flag independent of status.

Enforced transitions (server-side, in `PUT /:id` and dedicated action routes):
- `active` → `served` (via existing `PUT /:id/serve`; requires `served_at` + `served_location` in the request body)
- `active` → `recalled` | `quashed` (via `PUT /:id`, direct status field)
- any status → `expired`: lazy check on read (`GET /`, `GET /:id`) comparing `expires_at` to now, plus a light daily cron tick alongside the existing warrant-poller cron so records expire even if nobody reads them
- `served` | `recalled` | `quashed` | `expired` are terminal for the status field — normal field edits (correcting a typo, updating notes) remain allowed, but flipping status back to `active` requires the new `POST /:id/reopen` endpoint, which writes an `audit_log` row (existing `audit_log` table, `action='warrant_reopen'`)
- `archived_at` set/cleared via existing `/:id/archive` and `/:id/unarchive`, valid from any status

Invalid transitions return `400 { error: 'invalid_status_transition', from, to }`.

## Route Contract

All 33 existing endpoint paths/methods are preserved — the frontend already calls them and URLs are not part of the drift problem. Internal rewrite covers:
- Every route returns `{error: string}` with a non-2xx status on failure. No more silent empty-result swallowing (current `GET /` catch block returns `200` with empty data on any DB error, masking failures — this becomes a real 500 with the error logged via `log.error` + `logErrorToDb`).
- Input validation on all POST/PUT bodies (manual validation, matching existing repo convention — no Zod dependency present today).
- Status-machine enforcement per above, applied in `PUT /:id`, `PUT /:id/serve`, `POST /:id/archive`, `/:id/unarchive`.
- One new endpoint: `POST /:id/reopen` (admin/supervisor/manager only — same RBAC tier as archive/unarchive).
- All column references updated to the canonical set from the dedup table above.
- The dynamically-registered route built in a loop (currently around line 290) gets inlined as an explicit route — dynamic route registration was flagged during recon as a potential silent-shadowing risk and isn't necessary for the small fixed set of paths it covers.

## Frontend Rewiring

- `WarrantsPage.tsx` and extracted tabs (`WarrantsListTab.tsx`, `ScrapersTab.tsx`, inline Dashboard/Search-All/modals) updated to read/write canonical column names.
- Add a "Reopen" action (visible on terminal-status warrants, gated to admin/supervisor/manager roles client-side to match server RBAC) calling the new `POST /:id/reopen`.
- Finish the open `TODO(user-contribution)` in `ScrapersTab.tsx:85` for live-feed event rendering, since it's warrant-adjacent and already flagged incomplete — folded into this rebuild rather than left as a separate loose end.
- No IA/visual changes beyond this — the 2026-07-14 warrants-page-rebuild-design.md structural/visual rebuild is a separate, already-approved effort; this work only touches data plumbing.

## Testing

No existing Worker test suite covers `/warrants` (CLAUDE.md: only `tsc --noEmit` today, Miniflare tests are opt-in per route). Following the `test-workers/health.test.ts`/`auth.test.ts` pattern:
- New `test-workers/warrants.test.ts`: status-transition enforcement (valid/invalid transitions), RBAC on `client_viewer` exclusion and the new reopen endpoint, canonical-column read/write round trip.
- Migration verification: before/after row count check and a spot-check that backfilled canonical columns match the old deprecated-column values, run against local D1 (`npm run migrate:local`) before the migration is trusted against remote.
- Client: `npx vitest run` for any touched components; manual verification in the dev preview for the reopen action and status transitions end-to-end.
