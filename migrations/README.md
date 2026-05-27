# D1 migrations

Applied automatically to live D1 (`rmpg-flex` = `785de7ae-3e7a-4e01-93bb-d24ddd813f6b`) by Wrangler on every deploy:

```
wrangler d1 migrations apply rmpg-flex --remote
```

(See `.github/workflows/deploy.yml`. Local-only: `npm run migrate:local`.)

## Numbering

Wrangler applies files in **lexicographic order** by filename, tracked in the `d1_migrations` table by exact filename. The four-digit prefix is conventional, not enforced — but our convention is to use it strictly.

Current high-water: **`0038_radio.sql`**. Next free integer: `0039`.

## Known irregularities (history)

These exist for historical reasons and should NOT be "fixed" by renumbering — D1 has already recorded them by name in production:

| Prefix | Files | Reason |
|--------|-------|--------|
| `0001` | `0001_initial.sql`, `0001_initial_schema.sql` | Two parallel branches both started numbering at 0001 during the early CF rehoming. Both applied; both are idempotent. |
| `0002` | `0002_seed.sql`, `0002_serve_queue_persons.sql` | Same root cause. |
| `0003` | `0003_calls_for_service_extended.sql`, `0003_serve_queue_columns.sql` | Same. |
| `0007` | *(missing)* | Skipped in numbering. Not a lost migration — the work landed under `0008_users_columns.sql`. |
| `0020` | *(missing)* | Skipped. Work landed under `0021_panic_alerts.sql`. |

## Adding a new migration

1. Use the next free integer (currently `0039`).
2. Single file per migration, snake_case description: `0039_describe_change.sql`.
3. Write all DDL idempotently — `CREATE TABLE IF NOT EXISTS`, `INSERT OR IGNORE`. D1 doesn't support `IF NOT EXISTS` on `ADD COLUMN` — either accept the failure on re-apply or check first.
4. **Watch the column cap.** `calls_for_service` (100 cols) and `persons` (94 cols) are at or near D1's 100-column SELECT cap. Any `ALTER TABLE` against them will be rejected by CI (`.github/workflows/column-cap-check.yml`). New columns go to `<table>_ext` overflow tables — see `calls_for_service_ext` for the established pattern.
5. Run locally first: `npm run migrate:local`.
6. On merge to main, `deploy.yml` runs `wrangler d1 migrations apply rmpg-flex --remote`. The step now blocks deploy on failure (no more `continue-on-error: true`). If your migration fails on remote, fix it before re-merging.

## Manual schema patches via the D1 MCP

Sometimes you need to apply a schema fix directly to live D1 without going through a migration file — for example, when reverse-engineering a missing table from the deployed legacy bundle, or when the matching code change can't ship in the same PR. The tool is `mcp__bfc8f52c-…__d1_database_query` against `database_id: 785de7ae-3e7a-4e01-93bb-d24ddd813f6b`.

**When you do this, also INSERT a row into `d1_migrations` so wrangler's tracker doesn't try to re-apply on the next deploy:**

```sql
INSERT OR IGNORE INTO d1_migrations (name, applied_at)
  VALUES ('00NN_your_migration.sql', datetime('now'));
```

Wrangler matches by exact filename. If you omit this step, the next deploy will try to re-run your migration from scratch — usually a no-op for idempotent DDL, but it can fail loudly on `ALTER TABLE` ADD COLUMN that's already there. Worse, the failure now blocks the whole deploy (no more `continue-on-error`), so the discipline matters.

A short audit trail of every manual patch lives in `TRIAGE.md` addenda — append there when you patch live directly.

## The dirty-schema era (2026-05-24 → 2026-05-27)

For a window, the migration tracker on live D1 was stuck at `0011` even though many later tables had been created via direct D1 MCP patches. `deploy.yml` had `continue-on-error: true` on the migration apply step to mask the resulting ALTER conflicts. That's been resolved as of this PR — manually-applied migrations through `0038_radio.sql` are now recorded in `d1_migrations`, and `continue-on-error` has been removed.

If you're reading older PR descriptions or memory that references the dirty-schema state, it's historical context — the tracker is honest again.
