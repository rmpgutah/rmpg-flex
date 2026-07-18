# Utah County Assessor fixtures

These HTML files are **synthetic** — hand-authored to match the label/value
table structure of Utah County's ASP-based Land Records detail page
(`PropertyForm.asp?serial_no=<n>`), NOT real captures. The live site needs a
browser session Vitest's environment can't replicate headlessly.

The parser (`src/utils/utah-assessor/parser.ts`) is deliberately tolerant —
label-driven `pullByLabel(html, regex)` extraction plus a raw key/value
catch-all into `raw_data_json` — so swapping these for real captures later
should not require parser rewrites, only fixture replacement.

To capture a real one: open a serial number's detail page in a browser,
View Source, save as `detail-single.html`, and diff against this synthetic
version to see what regexes need adjusting.
