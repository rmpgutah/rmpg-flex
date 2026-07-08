# Identity-Match Safeguard for Person-Linked Warrant Polls

**Date:** 2026-07-08
**Status:** Approved for planning
**Scope:** `src/utils/warrantSources/reconcile.ts`, `src/utils/utahWarrantPoller.ts`, one new pure module.

## Background

Two categories of warrant source exist:

1. **Full-list sources** (Socrata, ArcGIS, PDF/XML/CSV families via `configRegistry.ts`,
   plus the FBI and Utah County code adapters) — ingest an entire roster and never
   attach a `person_id` (`store.ts:124`: "person_id is always NULL here — full-list
   hits are stored without person"). Already the safe default; **out of scope**.
2. **Per-person sources** (`fetchForPerson`-mode adapters: Ada County, Natrona,
   plus the dedicated Utah poller) — query a remote site/API using a LOCAL
   person's name (Ada/Natrona search by last name only) or ID (Utah), then
   `reconcile.ts`'s `reconcileHits(hits, person)` attaches
   `person_id: person.id` to **every returned hit unconditionally**. The only
   existing safeguard is `ageDisconfirms()`, which downgrades `confidence` to
   `'unverified'` when the hit's reported age conflicts with the person's
   DOB-derived age by more than 1 year — but the hit is still linked to the
   person's record either way, and there is **no name comparison at all**
   between the hit's own name fields and the queried person.

This means a last-name-only search (Ada County, Natrona) against a common
surname can silently attribute a stranger's warrant to the wrong local
person — a real false-positive risk for a law-enforcement CAD/RMS.

## Goal

Require **positive identity confirmation** — a name match AND a DOB/age
match — before a per-person-source hit is linked to a local person record.
Replace "attach unless disconfirmed" with "attach only if confirmed."

## Design

### 1. New pure module: `src/utils/warrantSources/identityMatch.ts`

```ts
export function identityMatch(hit: RawWarrantHit, person: PersonRow): boolean {
  return nameMatches(hit, person) && dobOrAgeConfirms(hit, person);
}
```

**Name gate** (`nameMatches`):
- Normalize both sides: uppercase, trim, collapse internal whitespace, strip
  punctuation (periods, hyphens treated as separators). Prefer `hit.last_name`/
  `hit.first_name` when present; fall back to splitting `hit.full_name` on
  whitespace (last token = last name, first token = first name) when the
  discrete fields are blank — several adapters (Bonner XML, some PDF families)
  only populate `full_name`.
- **Full match**: normalized first name equal AND normalized last name equal.
- **Partial match**: normalized last name equal AND normalized first name's
  first character equal (catches nicknames — "Bob"/"Robert" — and single-
  character OCR/typo drift in the first name, while still requiring the more
  distinctive surname to be exact).
- Passes if either full or partial matches. A last-name mismatch never passes,
  regardless of first name.

**Identity gate** (`dobOrAgeConfirms`):
- If `hit.date_of_birth` and `person.dob` are BOTH present → exact string
  equality required.
- Else if either side can produce an age (person's DOB-derived age, or a raw
  `hit.age` value) → `Math.abs(computedAge - hitAge) <= 1` (reuses the
  existing `AGE_MATCH_TOLERANCE`/`ageFromDob` logic already duplicated between
  `utahWarrantPoller.ts` and `reconcile.ts` — this module becomes the single
  home for it, and both call sites import from here instead of keeping their
  own copies).
- If **neither** side has any DOB or age information at all → **fails**
  (reject). No positive evidence, no link — per explicit decision, this is a
  hard requirement, not a soft downgrade.

### 2. `reconcile.ts` — filter, don't just flag

`reconcileHits(hits, person)` gains a pre-filter step: hits failing
`identityMatch(hit, person)` are **excluded** from the returned `CanonicalHit[]`
entirely — they are never merged, never assigned `person_id`, never appear in
this person's result set. This replaces the current behavior where every hit
gets `person_id: person.id` and only `confidence` varies.

The existing `ageDisconfirms`/`confidence` machinery is **kept** for hits that
DO pass the identity gate — `confidence: 'confirmed' | 'unverified'` still
reflects corroboration strength (e.g. a person with no DOB on file can still
have positively name-matched hits, which stay `'unverified'` since DOB-based
confirmation wasn't possible — but note: per the identity gate, a DOB-less
person now REQUIRES the hit to carry an age for the match to be accepted at
all, so `'unverified'` after this change specifically means "matched via age
tolerance, not exact DOB" rather than "matched via name only with no identity
check," which was the old, riskier meaning).

Concretely: `reconcileHits` gets one added line near its top —
`const identityChecked = hits.filter((h) => identityMatch(h, person));` — and
every existing reference to `hits` in the function body operates on
`identityChecked` instead.

### 3. `utahWarrantPoller.ts` — apply the same gate

The poller currently calls `warrants.utah.gov`'s `/persons/:id/warrants`
endpoint for a specific upstream person ID it already resolved via a prior
name-based lookup against the local person — but does not re-verify the
returned `UtahApiWarrant`/person-stub name against the local `PersonRow`
before persisting to `utah_warrants`. Add the same `identityMatch()` check
(using the poller's existing `PersonStub`/`FetchedWarrant` shape, mapped to
the shared `RawWarrantHit`-compatible fields) immediately before a fetched
warrant is queued for insertion. A person/warrant pair failing the gate is
dropped from that run's results (counted neither as found nor as an error —
it's a deliberate non-match, not a failure) and logged via `log.info` (the
structured logger already in use in this file) for auditability.

The poller's own local `ageFromDob`/`AGE_MATCH_TOLERANCE` are **removed** in
favor of importing from the new shared `identityMatch.ts` module (Task 1's
module becomes the single source of truth, per the design note in section 1).

### 4. What does NOT change

- Full-list adapters (Socrata/ArcGIS/PDF/XML/CSV/FBI/UtahCounty) — no `person_id`
  linking today, none added by this work.
- `src/routes/warrants.ts`'s `/search-all` endpoint and `matchesDobOrAge()` in
  `warrantNationalSearch.ts` — different use case (interactive, human-initiated
  query where the human is the one confirming identity), left untouched.
- The `degraded`/health-grade observability work from the prior PR — unrelated,
  already merged.

## Testing

- `tests/identityMatch.test.ts` (new): full-match pass, partial-match pass
  (nickname/first-initial), last-name-mismatch fail, DOB-exact-match pass,
  age-tolerance pass/fail at the ±1 boundary, both-sides-missing-dob/age fail,
  `full_name`-fallback parsing when discrete name fields are blank.
- `tests/warrantReconcile.test.ts` (extend existing, if present — check via
  `grep -rl "reconcileHits" tests/` first): add cases proving a name-mismatched
  hit is excluded from `reconcileHits`'s output (not just downgraded), and that
  a previously-`'unverified'`-but-linked hit under the OLD semantics no longer
  appears at all when it also fails the new name gate.
- `tests/utahWarrantPoller.test.ts` (extend existing, if present): add a case
  proving a name-mismatched upstream result is dropped, not persisted, and
  doesn't inflate `errors`.

## Migration/schema

None — this is pure application logic, no D1 schema change.
