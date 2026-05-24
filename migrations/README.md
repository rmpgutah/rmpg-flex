# D1 migrations

Applied by Wrangler: `wrangler d1 migrations apply rmpg-flex-db --remote` (or `--local` for the dev DB).

## Numbering

Wrangler applies files in **lexicographic order** by filename, tracked in the `d1_migrations` table by exact filename. The four-digit prefix is conventional, not enforced — but our convention is to use it strictly.

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

1. Use the next free integer (currently `0023`).
2. Single file per migration, snake_case description: `0023_describe_change.sql`.
3. Write all DDL idempotently — `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` (D1 doesn't support `IF NOT EXISTS` on `ADD COLUMN` — wrap in a check or accept the failure on re-apply against a partially-migrated DB).
4. Run locally first: `npm run migrate:local`.
5. After merge to main, `deploy.yml` runs `migrate:prod` (currently `continue-on-error: true` because the prod D1 carries dirty schema from earlier runs — the Worker reconciles missing columns at boot).

## The `live/` subdirectory

`migrations/live/` mirrors what's actually been applied to the remote D1. Treat it as read-only documentation of production state; don't edit files there.
