# Salt Lake County Assessor fixtures

## Real captures (2026-08-01) — use these

| File | Source | Contents |
|---|---|---|
| `pubmore-detail.html` | `PubMore/detail.cfm?parcel_id=16311270290000` | The **richest** rendering: all 54 residence + 21 parcel + 21 valuation fields, values DECODED. No coordinates, no legal description, land record 1 of N only. |
| `detail-expanded.html` | `valuationInfoExpanded.cfm?parcel_id=16311270290000` | Coordinates (`polyx`/`polyy`), legal description, per-year taxable value. ~45 fewer fields; values as CODES. |

Parcel `16-31-127-029-0000` (GARLUTZO, ANDREW — 3533 S TERRA SOL DR).
Parsed by `src/utils/sl-assessor/camaParser.ts`, asserted in
`tests/camaParser.test.ts`.

**Neither page is complete on its own** — a full build merges them via
`mergeCama()`. See the header comment in `camaParser.ts`.

### Re-capturing

```bash
curl -s -A "Mozilla/5.0" \
  "https://apps.saltlakecounty.gov/assessor/new/PubMore/detail.cfm?parcel_id=16311270290000" \
  -o tests/fixtures/sl-assessor/pubmore-detail.html
```

⚠️ **The parcel id must be 14 digits.** A 10-digit id returns HTTP 200 with
the *search form*, not an error — so a truncated id yields a fixture that
parses to nothing while looking like a successful capture.

## Legacy synthetic fixtures

`single.html`, `multi.html`, `none.html`, `detail.html` are **synthetic**
approximations authored before live HTML could be captured. They still back
`tests/sl-assessor.parser.test.ts`, which exercises the older
`valuationInfoExpanded`-oriented `parser.ts`.

Treat their passing as weak evidence: because they were invented to match the
parser rather than the county, they let ~45 residence fields parse as `null`
on every real parcel without a single failing test. Prefer the real captures
above for any new work.
