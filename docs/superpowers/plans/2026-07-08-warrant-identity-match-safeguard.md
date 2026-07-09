# Warrant Identity-Match Safeguard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require positive identity confirmation (name match AND DOB/age match) before a per-person warrant source (Ada County, Natrona) links a hit to a local person record, replacing today's "attach unless disconfirmed" behavior.

**Architecture:** A new pure module `identityMatch.ts` provides a single `identityMatch(hit, person)` predicate combining a name gate (full first+last match, or partial last-exact + first-initial match) and a DOB/age gate (exact DOB match, ±1-year age tolerance, or reject if neither side has any identity data). `reconcile.ts`'s `reconcileHits()` filters incoming hits through this predicate before dedup/merge, so non-matching hits never get `person_id` attached and never appear in that person's result set.

**Tech Stack:** TypeScript, Vitest.

**Spec:** [`docs/superpowers/specs/2026-07-08-warrant-identity-match-safeguard-design.md`](../specs/2026-07-08-warrant-identity-match-safeguard-design.md)

**Explicitly out of scope:** `utahWarrantPoller.ts` is NOT touched — it already has its own `isLikelyMatch()` namesake guard with a deliberate, documented policy (DOB-less persons get attributed anyway rather than skipped) that predates this work and must not be silently reversed. Full-list adapters (Socrata/ArcGIS/PDF/XML/CSV/FBI/UtahCounty) never link `person_id` today and stay that way.

---

### Task 1: `identityMatch.ts` — name + DOB/age gate module

**Files:**
- Create: `src/utils/warrantSources/identityMatch.ts`
- Test: `tests/identityMatch.test.ts` (new)

- [ ] **Step 1: Write the failing tests**

Create `tests/identityMatch.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { identityMatch } from '../src/utils/warrantSources/identityMatch';
import type { RawWarrantHit, PersonRow } from '../src/utils/warrantSources/types';

const person = (o: Partial<PersonRow> = {}): PersonRow => ({
  id: 1, first_name: 'John', middle_name: null, last_name: 'Smith', dob: '1990-01-01', ...o,
});
const hit = (o: Partial<RawWarrantHit> = {}): RawWarrantHit => ({
  source_key: 's1', warrant_id: 'W1', ...o,
});

function trueAge(dob: string): number {
  const born = new Date(dob);
  const now = new Date();
  let age = now.getFullYear() - born.getFullYear();
  const m = now.getMonth() - born.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < born.getDate())) age--;
  return age;
}

describe('identityMatch — name gate', () => {
  it('full first+last match, dob match => true', () => {
    expect(identityMatch(hit({ first_name: 'John', last_name: 'Smith', date_of_birth: '1990-01-01' }), person())).toBe(true);
  });

  it('partial match (last exact + first initial), dob match => true', () => {
    expect(identityMatch(hit({ first_name: 'Jon', last_name: 'Smith', date_of_birth: '1990-01-01' }), person())).toBe(true);
  });

  it('last name mismatch => false, even with matching dob', () => {
    expect(identityMatch(hit({ first_name: 'John', last_name: 'Jones', date_of_birth: '1990-01-01' }), person())).toBe(false);
  });

  it('first initial mismatch (not full, not partial) => false', () => {
    expect(identityMatch(hit({ first_name: 'Robert', last_name: 'Smith', date_of_birth: '1990-01-01' }), person())).toBe(false);
  });

  it('falls back to full_name when discrete first/last are blank', () => {
    expect(identityMatch(hit({ full_name: 'John Smith', date_of_birth: '1990-01-01' }), person())).toBe(true);
  });

  it('full_name fallback still enforces the partial-match rule', () => {
    expect(identityMatch(hit({ full_name: 'Jon Smith', date_of_birth: '1990-01-01' }), person())).toBe(true);
    expect(identityMatch(hit({ full_name: 'Robert Smith', date_of_birth: '1990-01-01' }), person())).toBe(false);
  });

  it('hit with no name info at all (blank first/last/full_name) => false', () => {
    expect(identityMatch(hit({ date_of_birth: '1990-01-01' }), person())).toBe(false);
  });

  it('name matching is case-insensitive and whitespace-tolerant', () => {
    expect(identityMatch(hit({ first_name: '  john  ', last_name: 'SMITH', date_of_birth: '1990-01-01' }), person())).toBe(true);
  });
});

describe('identityMatch — dob/age gate', () => {
  it('exact dob match on both sides => true (with matching name)', () => {
    expect(identityMatch(hit({ first_name: 'John', last_name: 'Smith', date_of_birth: '1990-01-01' }), person({ dob: '1990-01-01' }))).toBe(true);
  });

  it('dob mismatch on both sides => false', () => {
    expect(identityMatch(hit({ first_name: 'John', last_name: 'Smith', date_of_birth: '1985-06-15' }), person({ dob: '1990-01-01' }))).toBe(false);
  });

  it('person has dob, hit has age within tolerance => true', () => {
    expect(identityMatch(hit({ first_name: 'John', last_name: 'Smith', age: trueAge('1990-01-01') }), person({ dob: '1990-01-01' }))).toBe(true);
  });

  it('person has dob, hit age off by exactly 1 => true (boundary)', () => {
    expect(identityMatch(hit({ first_name: 'John', last_name: 'Smith', age: trueAge('1990-01-01') + 1 }), person({ dob: '1990-01-01' }))).toBe(true);
  });

  it('person has dob, hit age off by more than 1 => false', () => {
    expect(identityMatch(hit({ first_name: 'John', last_name: 'Smith', age: trueAge('1990-01-01') + 5 }), person({ dob: '1990-01-01' }))).toBe(false);
  });

  it('neither side has any dob or age => false (reject, no positive evidence)', () => {
    expect(identityMatch(hit({ first_name: 'John', last_name: 'Smith' }), person({ dob: '' }))).toBe(false);
  });

  it('person has no dob but hit has an age => age-only comparison is impossible (no person age to compare), so false', () => {
    expect(identityMatch(hit({ first_name: 'John', last_name: 'Smith', age: 35 }), person({ dob: '' }))).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/identityMatch.test.ts`
Expected: FAIL — the module doesn't exist yet.

- [ ] **Step 3: Implement**

Create `src/utils/warrantSources/identityMatch.ts`:

```ts
import type { RawWarrantHit, PersonRow } from './types';

// Same tolerance already used independently by utahWarrantPoller.ts's
// isLikelyMatch and reconcile.ts's ageDisconfirms — this module does NOT
// replace either of those (see design doc: utahWarrantPoller.ts is
// explicitly out of scope, and reconcile.ts's existing confidence logic is
// kept for hits that pass this gate). This is a separate, stricter gate
// applied specifically to Ada County/Natrona's fetchForPerson results before
// they're allowed into reconcileHits at all.
const AGE_MATCH_TOLERANCE = 1;

function normalizeName(s: string | null | undefined): string {
  return (s ?? '').toUpperCase().trim().replace(/[.\-]/g, ' ').replace(/\s+/g, ' ');
}

function splitFullName(fullName: string | null | undefined): { first: string; last: string } {
  const parts = normalizeName(fullName).split(' ').filter(Boolean);
  if (parts.length === 0) return { first: '', last: '' };
  if (parts.length === 1) return { first: '', last: parts[0] };
  return { first: parts[0], last: parts[parts.length - 1] };
}

/** Prefer discrete first_name/last_name; fall back to splitting full_name
 *  when both discrete fields are blank (several adapters — Bonner XML, some
 *  PDF families — only populate full_name). */
function hitName(hit: RawWarrantHit): { first: string; last: string } {
  const first = normalizeName(hit.first_name);
  const last = normalizeName(hit.last_name);
  if (first || last) return { first, last };
  return splitFullName(hit.full_name);
}

/**
 * Full match: normalized first AND last both equal.
 * Partial match: last name exact, first name's first character equal —
 * catches nicknames (Bob/Robert) and single-character OCR/typo drift in the
 * first name while still requiring the more distinctive surname to be exact.
 * A last-name mismatch (or a hit with no last name at all) never passes,
 * regardless of first name.
 */
function nameMatches(hit: RawWarrantHit, person: PersonRow): boolean {
  const h = hitName(hit);
  const personLast = normalizeName(person.last_name);
  const personFirst = normalizeName(person.first_name);
  if (!h.last || !personLast || h.last !== personLast) return false;
  if (!h.first || !personFirst) return false;
  if (h.first === personFirst) return true; // full match
  return h.first[0] === personFirst[0]; // partial match: first-initial
}

/** Whole-years age from an ISO-ish dob string, or null if unparseable. */
function ageFromDob(dob: string | null | undefined): number | null {
  if (!dob) return null;
  const born = new Date(dob);
  if (isNaN(born.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - born.getFullYear();
  const m = now.getMonth() - born.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < born.getDate())) age--;
  return age >= 0 && age < 130 ? age : null;
}

/**
 * DOB/age confirmation. Exact DOB match wins when both sides have one.
 * Otherwise falls back to age-tolerance comparison (person's DOB-derived age
 * vs. the hit's reported age). If NEITHER side has any usable DOB or age,
 * there is no positive evidence to confirm identity — reject.
 */
function dobOrAgeConfirms(hit: RawWarrantHit, person: PersonRow): boolean {
  const personDob = person.dob || null;
  const hitDob = hit.date_of_birth || null;
  if (personDob && hitDob) return personDob === hitDob;

  const personAge = ageFromDob(personDob);
  const hitAge = hit.age ?? null;
  if (personAge != null && hitAge != null) {
    return Math.abs(personAge - hitAge) <= AGE_MATCH_TOLERANCE;
  }
  return false;
}

/**
 * Positive identity confirmation gate for linking a per-person-source hit
 * (Ada County / Natrona fetchForPerson results) to a local person record.
 * Both a name match AND a DOB/age match are required — see design doc
 * (docs/superpowers/specs/2026-07-08-warrant-identity-match-safeguard-design.md)
 * for the full rationale.
 */
export function identityMatch(hit: RawWarrantHit, person: PersonRow): boolean {
  return nameMatches(hit, person) && dobOrAgeConfirms(hit, person);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/identityMatch.test.ts`
Expected: PASS (all 15 cases).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/utils/warrantSources/identityMatch.ts tests/identityMatch.test.ts
git commit -m "feat(warrants): add identityMatch name+dob/age confirmation gate"
```

---

### Task 2: `reconcile.ts` — filter hits through `identityMatch` before linking

**Files:**
- Modify: `src/utils/warrantSources/reconcile.ts`
- Modify: `tests/warrantSources/reconcile.test.ts`

- [ ] **Step 1: Update the test file's shared fixtures + add new cases**

The current `tests/warrantSources/reconcile.test.ts` line 7 is:

```ts
const hit = (o: Partial<RawWarrantHit>): RawWarrantHit => ({ source_key: 's1', warrant_id: 'W1', ...o });
```

Change it to default to a name that matches both `dobPerson` and `noDobPerson` (both `first_name: 'John', last_name: 'Smith'` per lines 5-6), so every EXISTING test in this file keeps testing exactly what it tested before (age/dedup/merge behavior) without each one needing individual edits — the new identity gate is satisfied by default, and only the NEW test cases below need to override name fields to exercise the gate itself:

```ts
const hit = (o: Partial<RawWarrantHit>): RawWarrantHit => ({ source_key: 's1', warrant_id: 'W1', first_name: 'John', last_name: 'Smith', ...o });
```

Read the actual current file first to confirm lines 5-7 match this description exactly before editing (they should, per the design doc's reference to this file).

Then append these new test cases inside the existing `describe('reconcileHits', ...)` block, after the last existing `it` (`'empty input => empty output'`):

```ts
  // --- identity-match safeguard (name + dob/age gate) ---

  it('name-mismatched hit is excluded entirely, not just downgraded', () => {
    const out = reconcileHits([hit({ warrant_id: 'W1', last_name: 'Jones' })], dobPerson);
    expect(out).toHaveLength(0);
  });

  it('partial name match (first-initial) with dob match is included and confirmed', () => {
    const out = reconcileHits([hit({ warrant_id: 'W1', first_name: 'Jon', date_of_birth: '1990-01-01' })], dobPerson);
    expect(out).toHaveLength(1);
    expect(out[0].confidence).toBe('confirmed');
  });

  it('a mix of matching and non-matching hits: only the matching one survives', () => {
    const matching = hit({ warrant_id: 'W1', source_key: 's1' });
    const mismatched = hit({ warrant_id: 'W2', source_key: 's2', last_name: 'Jones' });
    const out = reconcileHits([matching, mismatched], dobPerson);
    expect(out).toHaveLength(1);
    expect(out[0].warrant_id).toBe('W1');
  });

  it('DOB-less person with a hit carrying no age at all is excluded (no positive identity evidence)', () => {
    const out = reconcileHits([hit({ warrant_id: 'W1', age: null })], noDobPerson);
    expect(out).toHaveLength(0);
  });

  it('name matches via full_name fallback when discrete first/last are blank on the hit', () => {
    const out = reconcileHits([hit({ warrant_id: 'W1', first_name: undefined, last_name: undefined, full_name: 'John Smith', date_of_birth: '1990-01-01' })], dobPerson);
    expect(out).toHaveLength(1);
  });
```

Note: the existing test `'DOB-less person => every hit unverified'` (line 27-30, `hit({ warrant_id: 'W1', age: 33 })` against `noDobPerson`) will need re-verification once you implement Task 2's Step 2 below — under the new identity gate, `noDobPerson` has no DOB, so `dobOrAgeConfirms` falls back to age-tolerance comparison using `ageFromDob(personDob)` which is `null` for a DOB-less person, meaning this hit will now be REJECTED (excluded), not merely downgraded to `'unverified'`. This existing test's assertion (`expect(out[0].confidence).toBe('unverified')`) will fail because `out` will now be EMPTY. This is the correct, intended behavioral change (a DOB-less person with only an age-bearing hit and no other corroboration has no positive identity evidence under the new gate) — update this existing test's assertion to match:

```ts
  it('DOB-less person => hit is excluded (no dob on person side means no positive identity evidence possible from age alone)', () => {
    const out = reconcileHits([hit({ warrant_id: 'W1', age: 33 })], noDobPerson);
    expect(out).toHaveLength(0);
  });
```

Read the actual current test at that location before replacing it, to confirm you're replacing the right block (it's the second `it` in the file, right after `'merges the same warrant_id...'`).

- [ ] **Step 2: Run tests to verify the new/updated ones fail, old ones still pass except the one being updated**

Run: `npx vitest run tests/warrantSources/reconcile.test.ts`
Expected: the pre-existing tests you did NOT touch should still PASS (thanks to Step 1's default-name fixture change). The new cases and the updated `'DOB-less person...'` case should FAIL until Step 3's implementation lands.

- [ ] **Step 3: Implement — filter hits in `reconcileHits`**

In `src/utils/warrantSources/reconcile.ts`, add the import at the top (after the existing `import type { RawWarrantHit, PersonRow } from './types';`):

```ts
import { identityMatch } from './identityMatch';
```

Then inside `reconcileHits`, find the current opening:

```ts
export function reconcileHits(hits: RawWarrantHit[], person: PersonRow): CanonicalHit[] {
  const personAge = ageFromDob(person.dob);
  const personHasDob = !isBlank(person.dob);

  const byKey = new Map<string, CanonicalHit>();

  for (const h of hits) {
```

Change the loop to iterate over a filtered list instead of the raw `hits` parameter:

```ts
export function reconcileHits(hits: RawWarrantHit[], person: PersonRow): CanonicalHit[] {
  const personAge = ageFromDob(person.dob);
  const personHasDob = !isBlank(person.dob);

  // Positive identity confirmation required before a hit is allowed to link
  // to this person at all — see identityMatch.ts / the design doc for the
  // full rationale. This replaces the old "attach unconditionally, flag via
  // confidence" behavior for name-mismatched or identity-unconfirmable hits.
  const identityChecked = hits.filter((h) => identityMatch(h, person));

  const byKey = new Map<string, CanonicalHit>();

  for (const h of identityChecked) {
```

Read the actual current file in full first (already read once during design — re-confirm the exact current line numbers/text haven't shifted) before making this edit. Do NOT change anything else in the function — the existing `dedupKey`, merge, and `confidence`-assignment logic (the `ageDisconfirms`/`personHasDob` branch at the bottom) stay exactly as they are; they now simply operate on the pre-filtered set.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/warrantSources/reconcile.test.ts`
Expected: PASS (all cases, old and new).

- [ ] **Step 5: Typecheck and full regression**

Run: `npm run typecheck && npx vitest run`
Expected: PASS across the board.

- [ ] **Step 6: Check for other callers of `reconcileHits` that might assume the old "always attached" behavior**

Run: `grep -rn "reconcileHits" src/ --include=*.ts`

Read every call site found (should be `runScan.ts` and the test file already handled). Confirm the caller in `runScan.ts` doesn't assume `reconcileHits`'s output array length always equals its input length, or otherwise break when the output is now sometimes shorter than the input (e.g. an off-by-index assumption). If it does something that would misbehave with a shorter output, STOP and report BLOCKED with specifics rather than guessing a fix — this plan did not anticipate needing changes there, so a real conflict here means the plan's assumptions need revisiting.

- [ ] **Step 7: Commit**

```bash
git add src/utils/warrantSources/reconcile.ts tests/warrantSources/reconcile.test.ts
git commit -m "feat(warrants): filter reconcileHits through identityMatch before linking person_id"
```

---

### Task 3: Full regression + PR

**Files:** none (verification + PR only)

- [ ] **Step 1: Full local verification**

Run:
```bash
npm run typecheck
npx vitest run
npx vitest run --config vitest.workers.config.mts
```
Expected: all PASS. The Miniflare suite is expected to show the same 2 pre-existing, unrelated failures noted in the prior warrant-observability PR (`test-workers/dispatchCallClose.test.ts`, `test-workers/panicSafetyFixes.test.ts`) and nothing new — confirm no NEW failures appeared (in particular, check `test-workers/` for anything exercising Ada County/Natrona adapters or `reconcileHits` indirectly via `grep -rln "reconcileHits\|ada-county\|natrona" test-workers/`).

- [ ] **Step 2: Open a PR**

```bash
git push -u origin HEAD
gh pr create --title "fix(warrants): require name+dob/age confirmation before linking Ada County/Natrona hits to a person" --body "$(cat <<'EOF'
## Summary
- Adds `identityMatch()` (src/utils/warrantSources/identityMatch.ts): a name-match gate (full first+last, or partial last-exact + first-initial) combined with a DOB/age-match gate (exact DOB, ±1yr age tolerance, or reject if neither side has any identity data).
- `reconcile.ts`'s `reconcileHits()` now filters hits through this gate BEFORE dedup/merge/person_id linking — a hit that fails is excluded entirely, not just downgraded to 'unverified' as before.
- Scope: this only affects the `fetchForPerson`-mode adapters (Ada County, Natrona), which search a remote site by last name only with no name/dob confirmation today. Full-list adapters never linked person_id and are unaffected. `utahWarrantPoller.ts` is explicitly untouched — it has its own pre-existing, deliberately-policy'd namesake guard (isLikelyMatch) that this work does not override.

Design: docs/superpowers/specs/2026-07-08-warrant-identity-match-safeguard-design.md
Plan: docs/superpowers/plans/2026-07-08-warrant-identity-match-safeguard.md

## Test plan
- [x] `npm run typecheck` clean
- [x] `npx vitest run` (Node suite) clean
- [x] `npx vitest run --config vitest.workers.config.mts` (Miniflare suite) clean (2 pre-existing unrelated failures only)

No migration/schema change — pure application logic.
EOF
)"
```

- [ ] **Step 3: Report the PR URL back for review/merge** (no auto-merge — this branch is separate from the already-merged warrant-observability PR, and per repo convention needs its own review pass before merge).
