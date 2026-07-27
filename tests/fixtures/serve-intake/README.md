# Serve Intake golden fixtures

These are **synthetic derivatives** of real ICU Investigations packets.

They reproduce the *layout and hazards* of production documents — watermark
bleed, homoglyphs, two-column Information Forms, witness-fee lines,
place-of-employment service language — with entirely fabricated parties,
case numbers, addresses, and phone numbers.

**Never check a real client packet into this repo.** Real packets contain
identifiable parties in active civil litigation. `tests/serveIntakeExtract.test.ts`
has enforced this norm since the suite was written; these fixtures follow it.

To add a fixture: copy the layout, replace every identity, and record the
expected extraction in `expected.json`.
