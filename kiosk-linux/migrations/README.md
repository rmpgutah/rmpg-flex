# Kiosk Linux Fleet — D1 Migrations

Migrations for the **dedicated** `kiosk-linux-fleet` D1 database (bound as
`KIOSK_DB` in `wrangler.toml`). This is a SEPARATE database from the main
`rmpg-flex` D1 (bound `DB`) — its migration numbering starts fresh at
`0001` and has no relationship to the top-level `migrations/` directory's
numbering.

## Applying

```bash
wrangler d1 migrations apply kiosk-linux-fleet --remote
```

(Run from the repo root — `wrangler.toml`'s `[[d1_databases]]` entry for
`KIOSK_DB` points wrangler at this directory via its own
`migrations_dir` setting; see Task 2.)
