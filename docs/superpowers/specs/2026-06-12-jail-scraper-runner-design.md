# Automated Jail Scraping — External Runner + Credentialed Adapter

**Date:** 2026-06-12 · **Status:** Approved (menu items 2+3) · **Builds on:** Wave 3a jail framework (#1170)

## Goal

Real automated Utah county-jail coverage, two complementary paths:
- **(2) External runner** — a standalone Node + Playwright service that drives
  the JS-rendered county portals (which a Worker can't) and POSTs structured
  bookings into the intel pipeline. Runs on the user's Mac, a VPS, or cron.
- **(3) Credentialed adapter** — a Worker-native generic adapter that, when an
  authorized JSON feed/key exists (stored in `system_config`), pulls directly
  in the 4-hourly cron — no external host needed for those sources.

## Worker changes (`src/`)

### New endpoint — structured ingest
`POST /api/intel/jail/ingest-bookings` (supervisor+): body
`{ source_key, bookings: [{ full_name?, first_name?, last_name?, dob?,
booking_date?, charges?, county?, booking_id?, mugshot_url?, detail_url? }] }`
→ normalize + `ingestBookings(..., 'roster_scrape')` (reusing Wave 3a's
cross-hit). Returns `{ ingested, matched, alerts }`. This is what the external
runner calls; cleaner than serializing to CSV through `/jail/ingest`.

### Credentialed adapter — `src/utils/jailSources/adapters/credentialed.ts`
`makeCredentialedAdapter(meta, { urlKey, tokenKey, listPath, map })`: reads a
URL + bearer token from `system_config` (keys e.g. `jail_<src>_url`,
`jail_<src>_token`), fetches JSON, walks `listPath` to the array, maps each
record to a `JailBooking` via `map`. Returns [] (recorded status) on missing
config or non-200 — never throws the cron. `runJailScan` registers any source
that has config rows present.

## External runner (`tools/jail-scraper/`)

- `package.json` — Node ESM, `playwright` dep, `npm start`.
- `counties.json` — per-county config: `{ key, name, url, type: 'table'|'p2c'|
  'zuercher', selectors: { row, name, charges, bookingDate, dob } }`. Ships
  with a few example county configs marked NEEDS-VERIFICATION (portal selectors
  drift; operator confirms against the live page).
- `lib/extract.mjs` — **pure** DOM-rows → booking objects + field cleaners
  (name split, date normalize, charge join). Node `--test` unit tests.
- `index.mjs` — for each enabled county: Playwright opens the portal, waits for
  the roster, scrapes rows via the county's selectors, runs `extract`, and
  POSTs to `…/api/intel/jail/ingest-bookings` with a service JWT (env
  `RMPG_USER`/`RMPG_PASS` → login, or `RMPG_JWT`). Polite delay between
  counties; per-county try/catch with a summary report. `--dry-run` prints
  without posting.
- `README.md` — install (`npm i && npx playwright install chromium`), env vars,
  how to add a county (inspect the portal, fill selectors), scheduling (cron /
  launchd), and the honest note that selector drift is expected maintenance.

## Error handling

Runner: per-county isolation, dry-run, explicit NEEDS-VERIFICATION configs so
nothing silently scrapes the wrong DOM. Worker: ingest-bookings validates the
array, per-row try/catch (existing `ingestBookings`), credentialed adapter
degrades to [] + status.

## Testing

- Worker vitest: ingest-bookings happy path is exercised via existing
  `ingestBookings` (already tested); add a small validation test for the
  endpoint's array guard if practical (pure mapper).
- Runner: `node --test` on `lib/extract.mjs` (row→booking, date/name cleaners).
- No DB migration. No SW bump (no web client change).

## Out of scope

Per-county selector authoring for all 29 (operator/runner-config task),
captcha/auth portals, scheduling infra (documented, not provisioned).
