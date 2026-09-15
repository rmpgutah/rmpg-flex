# D1 migrations

Applied automatically to live D1 (`rmpg-flex` = `785de7ae-3e7a-4e01-93bb-d24ddd813f6b`) by Wrangler on every deploy:

```
wrangler d1 migrations apply rmpg-flex --remote
```

(See `.github/workflows/deploy.yml`.)

## Local development (`npm run migrate:local`)

**The historical `migrations/*.sql` files are NOT replayable from scratch.** They're a
dirty-schema rehoming artifact: two conflicting `0001` files (`0001_initial.sql` makes
`system_config(key, value)`; `0001_initial_schema.sql` assumes `config_key, config_value`),
ordering violations (0003–0005 reference `serve_queue` before it exists), non-constant
`ADD COLUMN` defaults (0011), and several dup-column ALTERs. A from-scratch
`wrangler d1 migrations apply` dies at the second file. This has been broken since the
early Cloudflare rehoming — **live D1 is the source of truth**, not the replayed history.

So `migrate:local` does **not** replay history. It bootstraps a fresh local D1 from an
authoritative schema snapshot of live, then applies any migrations newer than the snapshot:

```jsonc
"migrate:local": "wrangler d1 execute rmpg-flex --local --file migrations/baseline/schema.sql && wrangler d1 migrations apply rmpg-flex --local"
```

- **`migrations/baseline/schema.sql`** — a schema-only snapshot of live (no rows; this is
  a police system, never snapshot PII). It is idempotent (`CREATE … IF NOT EXISTS`) and ends
  by seeding `d1_migrations` with every historical filename, so the follow-up
  `wrangler d1 migrations apply --local` runs **only** migrations added after the snapshot
  (`0072+`). It lives in a **subdirectory**, so `wrangler d1 migrations apply` never picks it
  up (wrangler only reads `*.sql` directly under `migrations/`).
- **Regenerate** after a batch of new migrations (re-squash):
  `CLOUDFLARE_ACCOUNT_ID=<acct> npm run baseline:build` (wraps `wrangler d1 export --no-data`,
  adds `IF NOT EXISTS`, and re-seeds the tracker — see `scripts/build-baseline.mjs`).
- For a **pristine** local rebuild, delete `.wrangler/state/v3/d1/` first, then `migrate:local`.

New migrations (`0072+`) you author **do** flow through wrangler normally on both local
(layered on the baseline) and remote — keep writing them as usual per the rules below.

## Numbering

Wrangler applies files in **lexicographic order** by filename, tracked in the `d1_migrations` table by exact filename. The four-digit prefix is conventional, not enforced — but our convention is to use it strictly.

Current high-water: **`0187_forensics_gov_standard.sql`**. Next free integer: `0188`.

## Known irregularities (history)

These exist for historical reasons and should NOT be "fixed" by renumbering — D1 has already recorded them by name in production:

| Prefix | Files | Reason |
|--------|-------|--------|
| `0001` | `0001_initial.sql`, `0001_initial_schema.sql` | Two parallel branches both started numbering at 0001 during the early CF rehoming. Both applied; both are idempotent. |
| `0002` | `0002_seed.sql`, `0002_serve_queue_persons.sql` | Same root cause. |
| `0003` | `0003_calls_for_service_extended.sql`, `0003_serve_queue_columns.sql` | Same. |
| `0007` | *(missing)* | Skipped in numbering. Not a lost migration — the work landed under `0008_users_columns.sql`. |
| `0020` | *(missing)* | Skipped. Work landed under `0021_panic_alerts.sql`. |
| `0048`–`0051` | `0048_fleet_tables` … `0051_fleet_100_more_upgrades` (in `d1_migrations` only, **not** on disk) | The fleet batch was renumbered to `0052`–`0055`; both name sets were applied. wrangler keys on filename, so the renamed files re-applied as no-ops (idempotent `CREATE TABLE IF NOT EXISTS`). The on-disk files are `0052`–`0055`. |
| `0056` | *(missing)* | Skipped. The fleet-alignment work landed under `0057_fleet_schema_alignment.sql`. |
| `0262` | `0262_calls_status_merged_split.sql` (rewritten 2026-09-05) | The original recreated `calls_for_service` as a 38-column table with the wrong column names and then `DROP TABLE`d the real 100-column one. It could never apply under wrangler (the copy failed first and the file rolled back), but replayed statement-by-statement it destroyed the table locally. The file now copies exactly the 100 baseline columns behind a `pragma_table_info` count guard — see `tests/migration0262CallsRebuild.test.ts`. D1's SQLite has a hard `SQLITE_MAX_COLUMN = 100`; a 101st column makes the table `SQLITE_CORRUPT`, so `0128`'s `ADD COLUMN analytics_replayed_at` must never be applied to `calls_for_service`. |
| `0064` | `0064_incident_subresource_columns.sql`, `0064_warrants_served_location.sql` | Two unrelated changes both numbered 0064; applied independently by full filename. |
| `0067` | `0067_forensic_activity_log_exhibit_id.sql`, `0067_personnel_fitness_commendations.sql`, `0067_seed_multi_source_scrapers.sql` | Three unrelated changes sharing 0067; applied independently by full filename. |
| `0070` | `0070_admin_departments_announcements_notif_rules.sql`, `0070_unincorporated_zone_sector_fixes.sql` | Two unrelated changes sharing 0070; applied independently by full filename. |
| `0075` | Two files at 0075 | Two unrelated changes both numbered 0075; applied independently. |
| `0084` | Two files at 0084 | Same pattern. |
| `0085` | Two files at 0085 | Same pattern. |
| `0102` | Two files at 0102 | Same pattern. |
| `0104` | Two files at 0104 | Same pattern. |
| `0107` | Two files at 0107 | Same pattern. |
| `0108` | Two files at 0108 | Same pattern. |
| `0110` | `0110_national_warrant_pdf_sources.sql`, `0110_warrant_source_chunking.sql` | Two unrelated changes sharing 0110; both real, both applied; apply in lexicographic filename order (pdf-sources first). `0110_warrant_source_chunking.sql` is the actual source of truth for Baton Rouge (`socrata-brla-citycourt`)'s current `enabled=1` state — two earlier files (`0107_national_warrant_pull.sql`, `0110_national_warrant_pdf_sources.sql`) both describe it as staying disabled; that's stale, this file's UPDATE is what's live. |
| `0118` | Two files at 0118 | Same pattern. |
| `0119` | Two files at 0119 | Same pattern. |
| `0121` | Two files at 0121 | Same pattern. |
| `0122` | Two files at 0122 | Same pattern. |
| `0125` | Two files at 0125 | Same pattern. |
| `0127` | Two files at 0127 | Same pattern. |
| `0142` | Two files at 0142 | Same pattern. |
| `0146` | Two files at 0146 | Same pattern. |
| `0150` | Two files at 0150 | Same pattern. |
| `0152` | Two files at 0152 | Same pattern. |
| `0153` | Two files at 0153 | Same pattern. |
| `0155` | `0155_case_management_expansion.sql`, `0155_persons_ext_dl_fields.sql` | Two unrelated changes sharing 0155; applied independently. |
| `0170` | `0170_court_lookups.sql`, `0170_invoice_line_items_line_type.sql` | Two unrelated changes sharing 0170; applied independently. |

## Adding a new migration

1. Use the next free integer (currently `0188`).
2. Single file per migration, snake_case description: `0039_describe_change.sql`.
3. Write all DDL idempotently — `CREATE TABLE IF NOT EXISTS`, `INSERT OR IGNORE`. D1 doesn't support `IF NOT EXISTS` on `ADD COLUMN` — either accept the failure on re-apply or check first.
4. **Watch the column cap.** `calls_for_service` (100 cols) and `persons` (94 cols) are at or near D1's 100-column SELECT cap. Any `ALTER TABLE` against them will be rejected by CI (`.github/workflows/column-cap-check.yml`). New columns go to `<table>_ext` overflow tables — see `calls_for_service_ext` for the established pattern.
5. Run locally first: `npm run migrate:local`.
6. On merge to main, `deploy.yml` runs `wrangler d1 migrations apply rmpg-flex --remote`. The step has `continue-on-error: true` to tolerate bare `ALTER TABLE ADD COLUMN` re-runs (D1 lacks `IF NOT EXISTS` for ADD COLUMN). **Do not rely on the deploy log alone** — always verify the migration landed by querying `pragma_table_info('<table>')` on live D1 after deploy.

## Manual schema patches

Sometimes you need to apply a schema fix directly to live D1 without going through the merge → `deploy.yml` flow — when reverse-engineering a missing table from the deployed legacy bundle, when the matching code change can't ship in the same PR, or simply after merging an `ALTER`-bearing migration that `continue-on-error: true` would otherwise let drift.

**Use [`scripts/apply-migration.sh`](../scripts/apply-migration.sh) — it applies the file AND inserts the tracker row in one step:**

```bash
scripts/apply-migration.sh 0147_your_migration.sql
```

The script runs `wrangler d1 execute rmpg-flex --remote --file migrations/0147_your_migration.sql` then `INSERT OR IGNORE INTO d1_migrations`. If wrangler errors on the apply (commonly: "duplicate column name" on an idempotent re-apply), it prompts before marking tracked so genuine failures don't get papered over.

For one-off non-migration patches (no file under `migrations/`), the manual SQL still works:

```sql
INSERT OR IGNORE INTO d1_migrations (name, applied_at)
  VALUES ('00NN_your_migration.sql', datetime('now'));
```

Wrangler matches by exact filename. Skipping the tracker insert is what caused the **19-row drift sweep on 2026-06-22** (0128 → 0145 were all applied to live but untracked; wrangler retried them on every deploy until reconciled). Don't skip it.

A short audit trail of every manual patch lives in `TRIAGE.md` addenda — append there when you patch live directly.

## The dirty-schema era (2026-05-24 → 2026-05-27)

For a window, the migration tracker on live D1 was stuck at `0011` even though many later tables had been created via direct D1 MCP patches. `deploy.yml` had `continue-on-error: true` on the migration apply step to mask the resulting ALTER conflicts.

The tracker has since been brought fully honest in stages — the latest pass (2026-06-02) recorded every migration through **`0071_units_emergency_overlay.sql`** in `d1_migrations` after verifying each one's columns/tables/seed-rows are actually present on live (76 columns + 76 tables + the scraper seeds/indexes + the unincorporated-zone fixes, all confirmed via `pragma_table_info` / `sqlite_master`). With nothing left unrecorded, `wrangler d1 migrations apply rmpg-flex --remote` is now a clean no-op.

`continue-on-error: true` was **restored** on the apply step on 2026-05-31 (it had briefly been removed) and is kept deliberately — see the comment in `deploy.yml`. It is now belt-and-suspenders rather than a mask: with the tracker honest, the step has nothing to apply, but the flag still guarantees a stray seed/ALTER conflict can never gate the Worker + Pages deploys again.

**Lesson for new migrations:** a bare `ALTER TABLE … ADD COLUMN` is *not* idempotent on D1, so once its column lands on live (or via a `CREATE TABLE` on a fresh DB) the file dup-fails on every re-apply and — because wrangler aborts a migration file at the first failing statement and never records it — re-fails forever, blocking everything numbered after it. `0057_fleet_schema_alignment.sql` was reduced to a comment-only no-op for exactly this reason (its 15 ALTERs duplicated columns already declared in `0052`/`0053`'s `CREATE TABLE`s). If you must add a column, prefer putting it in the table's `CREATE` (fresh) and applying it directly to live + recording the migration (live), per the "Manual schema patches" section above.

## Drift detection

Run **[`scripts/check-migration-drift.sh`](../scripts/check-migration-drift.sh)** to verify that every `CREATE TABLE` and `ALTER TABLE` from the migration files actually exists on the live schema:

```bash
# Dry-run (just reports expected schema without querying D1):
scripts/check-migration-drift.sh

# Local D1 check:
DB_MODE=local scripts/check-migration-drift.sh

# Remote (live) D1 check:
DB_MODE=remote CLOUDFLARE_ACCOUNT_ID=<acct> scripts/check-migration-drift.sh
```

The script scans all `migrations/*.sql`, extracts every `CREATE TABLE` and `ALTER TABLE ADD COLUMN`, then queries `sqlite_master` / `pragma_table_info` on the target D1 to detect drift. Exit code 0 = clean; exit code 1 = drift found.

CI runs this against remote D1 on every deploy to catch the `continue-on-error` trap before it drifts.

If you're reading older PR descriptions or memory that references the dirty-schema state, it's historical context — the tracker is honest again.

## Local-only migrations (do NOT apply to Cloudflare D1)

| File | Reason |
|------|--------|
| `0249_sync_queue.sql` | FZ-55 local sync queue — no meaning on D1 |
| `0250_sync_conflicts.sql` | FZ-55 conflict audit trail — no meaning on D1 |
