# Serve Intake golden fixtures

These are **synthetic derivatives** of real ICU Investigations packets.

They reproduce the *layout and hazards* of production documents — watermark
bleed, homoglyphs, two-column Information Forms, witness-fee lines,
place-of-employment service language — with entirely fabricated parties,
case numbers, addresses, and phone numbers.

**Never check a real client packet into this repo.** Real packets contain
identifiable parties in active civil litigation. `tests/serveIntakeExtract.test.ts`
states this as a norm in its header comment ("No real case data") but does not
enforce it programmatically. The actual guards live in
`tests/serveIntakeFixtures.test.ts`, in this same directory's test suite:

- a **denylist test** (`carries no real client identities`) that rejects a
  fixed list of names known to appear in the real packets this corpus was
  derived from — this only catches those specific known names, not any other
  real content;
- a **content ratchet test** (`fixture content matches its recorded hash`)
  that pins each fixture's SHA-256 hash and fails on any change to fixture
  content, forcing a deliberate, reviewed hash update — this catches any
  edit, but only after the fact, and does not itself judge whether new
  content is synthetic.

Neither guard alone is sufficient; keep both.

To add a fixture: copy the layout, replace every identity, record the
expected extraction in `expected.json`, and add the new file's hash to
`FIXTURE_HASHES` in `tests/serveIntakeFixtures.test.ts`.

## Year-inference contract for bare month/day service instructions

Service instructions sometimes give a date without a year — e.g.
`individual-employment.txt` says "Start attempts on or after June 26." with
no year stated. The extraction contract is: **a bare month/day in service
instructions takes its year from the job's due date.** In this fixture the
header gives `Due: 06/30/2026`, so "June 26" resolves to `2026-06-26` (see
`attempt_start_not_before` in `expected.json`) rather than, say, the current
year or the nearest future occurrence. This is a real ambiguity in the
source documents — a bare "June 26" could otherwise be misread as referring
to any year — so any extraction model change must preserve this
due-date-year inference or it will silently mis-grade against this fixture.
