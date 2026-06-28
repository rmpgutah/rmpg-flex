# Salt Lake County Assessor fixtures

These HTML files are **synthetic** approximations of what the parser expects.
They were authored when we could not capture real HTML from the live site
(it requires a ColdFusion session + form POST that our development
environment couldn't satisfy, and Firecrawl credentials were not available
in the worktree).

## What the parser expects

- Result-list pages (`single.html`, `multi.html`) are HTML tables where each
  `<tr>` for a parcel contains the parcel number in `dd-dd-ddd-ddd` form
  (e.g. `16-04-301-005`) and a link to the parcel detail page
  (`href="parcel.cfm?id=…"`).
- The "no-match" page (`none.html`) is the query form page with no row
  containing a parcel-number pattern.
- The detail page (`detail.html`) is a key/value table of the form
  `<tr><th>Label:</th><td>Value</td></tr>`, with an optional "Sale History"
  subsection containing date / price / doc# rows.

The parser is intentionally tolerant: it scans tables for the parcel-number
regex, pulls labelled cells with a heuristic `pullByLabel`, and captures
EVERY detected key/value pair into `raw_data_json` as a catch-all.

## ⚠️ Before merging the PR

Replace each file with real captured HTML from
`https://apps.saltlakecounty.gov/assessor/new/query.cfm`:

| File          | What to capture                                                |
|---------------|-----------------------------------------------------------------|
| single.html   | A query that returns EXACTLY 1 parcel                          |
| multi.html    | A query that returns ≥2 parcels (strip mall / duplex address)  |
| none.html     | A query that returns 0 results (clearly fake address)          |
| detail.html   | The detail page reached by clicking a parcel from the results  |

### Capture options (any one is fine)

1. **Browser + View Source.** Open the live form, run the search, click
   View Source on the results, save as the matching filename in this
   directory.

2. **`curl` with a session cookie jar.**

   ```bash
   curl --cookie-jar /tmp/cf-cookies.txt --cookie /tmp/cf-cookies.txt \
     -X POST -d 'address=2200+S+500+E' \
     https://apps.saltlakecounty.gov/assessor/new/query.cfm \
     > tests/fixtures/sl-assessor/single.html
   ```

3. **Firecrawl scrape.**

   ```bash
   curl -X POST https://api.firecrawl.dev/v1/scrape \
     -H "Authorization: Bearer $FIRECRAWL_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"url":"https://apps.saltlakecounty.gov/assessor/new/query.cfm?...","formats":["html"]}' \
     | jq -r '.data.html' > tests/fixtures/sl-assessor/single.html
   ```

After replacing, re-run:

```bash
npx vitest run tests/sl-assessor.parser.test.ts
```

If the parser can't pull a typed slot from real-world HTML, the value lands
in `raw_data_json` instead of erroring — inspect that dump to teach the
parser the real labels, then tighten its regex. Don't relax the tests to
make them pass; refine the parser or the fixture instead.
