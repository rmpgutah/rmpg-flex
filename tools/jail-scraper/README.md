# RMPG Flex — Jail Scraper Runner

External Node + Playwright service that scrapes JS-rendered Utah county jail
roster portals (which the Cloudflare Worker can't drive) and POSTs structured
bookings into the intel pipeline. Each booking is cross-hit against known/
flagged persons by the backend, exactly like manual ingest.

> This is the **(2) external runner** half of automated jail coverage. The
> **(3) credentialed adapter** half is in the Worker itself
> (`src/utils/jailSources/adapters/credentialed.ts`): if a county/state exposes
> an authorized JSON feed, put its URL + token in `system_config`
> (`jail_<key>_url` / `jail_<key>_token`) and the 4-hourly Worker cron pulls it
> directly — no runner needed for those.

## Install

```bash
cd tools/jail-scraper
npm install
npx playwright install chromium
```

## Configure auth

The runner posts to the live API and needs a supervisor+ login:

```bash
export RMPG_USER='you@rmpgutah.us'
export RMPG_PASS='********'
# or, instead of user/pass:
export RMPG_JWT='<a valid bearer token>'
# optional: export RMPG_API='https://api.rmpgutah.us'  (default)
```

## Add / verify a county

County selectors live in `counties.json`. Each entry is **disabled** and marked
`needs-verification` until you confirm it against the live page — portal DOM
changes without notice, so never run a guessed selector against real data.

1. Open the county's roster URL in a browser, open devtools.
2. Find the repeating row element → fill `selectors.row`.
3. For each field (name, bookingDate, charges, dob), find a CSS selector
   **relative to the row** and fill it in.
4. Set `"enabled": true` and `"status": "verified"`.
5. Dry-run it first (below) and eyeball the output before posting.

Name cells can be `"Last, First"` or `"First Last"` — the extractor handles
both. Dates in `M/D/Y`, `M-D-YY`, or ISO are normalized to `YYYY-MM-DD`.

## Run

```bash
npm run dry-run                 # scrape all enabled counties, print, NO post
node index.mjs --only ut-davis  # one county
npm start                       # scrape + post to the intel pipeline
```

`--dry-run` prints the first 5 bookings per county so you can validate selectors
without touching the database. Each county is isolated — one failure never stops
the others; a final `SUMMARY` line reports per-county results.

## Schedule (optional)

cron (every 4h):
```
0 */4 * * * cd /path/to/tools/jail-scraper && RMPG_USER=... RMPG_PASS=... /usr/bin/node index.mjs >> scraper.log 2>&1
```
Or wrap in a launchd plist on macOS. Match the Worker's 4-hourly cadence.

## Test

```bash
npm test   # node --test on the pure extraction lib (lib/extract.test.mjs)
```

## Honest limits

- **Selector drift is expected maintenance** — when a county redesigns its
  portal, its selectors break and that county returns 0 until updated. The
  `SUMMARY` and `0 bookings` logs surface this.
- **Captcha / login-walled portals** aren't handled — those stay on manual
  ingest or a credentialed feed.
- The shipped `counties.json` entries are **starting guesses**, all disabled.
  Verify before enabling.
