# Law Book pipeline (`scripts/lawbook/`)

Committed, resumable tooling that builds the `utah_statutes` "law book" from the
official Utah Code at [le.utah.gov](https://le.utah.gov/xcode) and adds AI
plain-language summaries. This replaces the throwaway `/tmp/utahcode` crawlers
that produced the original 1,705-row seed and were then lost (see the
`project-law-book` memory).

All output lands in `scripts/lawbook/data/` (git-ignored — it's regenerable and
large). The deployable artifact is `scripts/seed/utah_statutes.sql`; this folder
is the *tooling* that produces D1 writes.

## Scripts

| Script | What it does |
|---|---|
| `scrape-utah-code.mjs` | Walks the Utah Code tree (Title → Chapter → Part → Section), flattens each `#secdiv` into the exact inline `(1)(a)(i)` text the reader renders, detects offense level (penal categories only), and writes one JSONL per title. |
| `generate-summaries.mjs` | Adds `plain_summary` + `plain_elements` to JSONL records via Workers AI (REST, fp8-fast Llama). Resumable — re-runs skip rows that already have a summary. |
| `export-existing.mjs` | Pages live D1 → `data/existing.jsonl` for rows still missing a summary (backfill the original 1,705 rows). |
| `build-seed.mjs` | JSONL → ≤50 KB SQL chunks. Default = full-row `INSERT`s (with an idempotent leading `DELETE` for the loaded categories); `--update-summaries` = `UPDATE` only the summary fields by citation. |
| `load-to-d1.mjs` | POSTs the SQL chunks to the live D1 REST API in order (the documented bulk-load path — `wrangler` isn't authed here). |

## Targets (LE-relevant expansion)

`TARGETS` in `scrape-utah-code.mjs`: Title 25 (Fraud), 77 (Criminal Procedure),
53 (Public Safety), 80 (Juvenile Justice), 23A (Wildlife), 32B (Alcoholic
Beverage Control), 58 ch 37* (Controlled Substances), 78B ch 7 (Protective
Orders & Stalking Injunctions). These join the existing 76 (Criminal), 41
(Vehicle), and 58/78B licensing + admin rules.

## Version selection & `--as-of`

A section can list a current **and** a future version. The 16-digit token suffix
is `{enactmentDate}{effectiveDate}` — the **second** 8 digits are the in-force
date (e.g. `…_2026050620270101` = "Effective 1/1/2027"). Default mode picks the
version the wrapper marks current today. `--as-of=YYYY-MM-DD` instead picks the
latest version effective **on or before** that date — used to pull the 7/1/2026
amendments into Titles 76 & 77 without over-reaching to a still-later version:

```bash
node scrape-utah-code.mjs 76 --category=criminal  --as-of=2026-07-01
node scrape-utah-code.mjs 77 --category=procedure --as-of=2026-07-01
```

## End-to-end

```bash
cd scripts/lawbook

# 1. scrape: the expansion titles (current) + refresh 76/77 as-of 7/1/2026
node scrape-utah-code.mjs --all-targets
node scrape-utah-code.mjs 76 --category=criminal  --as-of=2026-07-01
node scrape-utah-code.mjs 77 --category=procedure --as-of=2026-07-01   # overwrites the current 77

# 2. summarize the title files + backfill the original rows
node generate-summaries.mjs data/title-*.jsonl
node export-existing.mjs && node generate-summaries.mjs data/existing.jsonl

# 3. build SQL chunks. The INSERT path replaces every loaded category (incl.
#    criminal=76), so the existing-row UPDATE must EXCLUDE criminal — 76 comes
#    from the fresh INSERT, 41/licensing keep their existing rows + new summaries.
node build-seed.mjs --glob --out=data/seed-chunks
node build-seed.mjs data/existing.jsonl --update-summaries --exclude-category=criminal --out=data/update-chunks

# 4. load to live D1 (785de7ae) — INSERTs first, then summary UPDATEs
node load-to-d1.mjs data/seed-chunks
node load-to-d1.mjs data/update-chunks
```

Schema lives in `migrations/0073` (table) + `migrations/0074` (plain-language
columns). The live DB is patched directly (REST); migrations only own DDL.
