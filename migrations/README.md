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

1. Use the next free integer (currently `0039`).
2. Single file per migration, snake_case description: `0039_describe_change.sql`.
3. Write all DDL idempotently — `CREATE TABLE IF NOT EXISTS`, `INSERT OR IGNORE`. D1 does NOT support `IF NOT EXISTS` on `ADD COLUMN`, so for bare `ALTER TABLE ... ADD COLUMN` accept that the migration only ever runs once cleanly against the tracker.
4. Run locally first: `npm run migrate:local`.
5. After merge to main, `deploy.yml` runs `migrate:prod`. The migration step is **not** `continue-on-error` anymore — a failure breaks the deploy by design. If you see one, the cause is almost always either a non-idempotent statement against an already-migrated DB or a tracker/schema mismatch. Fix the underlying mismatch (see below); don't re-silence the step.

## Recording manual applies (D1 MCP / `wrangler d1 execute`)

When live needs a schema fix and you bypass `wrangler d1 migrations apply` — e.g. running SQL through the Cloudflare D1 MCP (`mcp__bfc8f52c-…__d1_database_query`) or `wrangler d1 execute rmpg-flex --remote --command "..."` — you **must** also record the migration in the tracker so wrangler skips it on the next deploy:

```sql
INSERT OR IGNORE INTO d1_migrations (name, applied_at)
VALUES ('0039_your_migration.sql', datetime('now'));
```

Without this insert, the next CI deploy will try to re-apply your migration. Idempotent DDL survives that (noisily); non-idempotent DDL — bare `ALTER TABLE ADD COLUMN`, `DROP TABLE`, raw `INSERT`s without `OR IGNORE` — fails the whole deploy. The tracker is wrangler's single source of truth for skip-vs-run; treat it the same way you treat the schema itself. Always pair a manual apply with the tracker insert in the same session.

Reconciliation of 0001–0038 against the live tracker happened on 2026-05-27 as part of the "tighten migration apply" PR; prior to that, `continue-on-error: true` had silenced months of skew between `/migrations/` and the live DB.

## The `live/` subdirectory

`migrations/live/` mirrors what's actually been applied to the remote D1. Treat it as read-only documentation of production state; don't edit files there.
