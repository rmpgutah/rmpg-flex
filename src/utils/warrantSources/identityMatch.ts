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
 * DOB/age confirmation. Exact DOB match wins when both sides have one — a
 * mismatch here is a hard reject, not a fallback to age tolerance. Otherwise
 * falls back to age-tolerance comparison (person's DOB-derived age vs. the
 * hit's reported age). If the PERSON has no usable identity data (no dob,
 * hence no derivable age) AND the hit also carries none, there is no
 * positive evidence anywhere to confirm identity — reject.
 *
 * Absence of age/dob ON THE HIT ALONE, when the person DOES have a dob, is
 * NOT disconfirming — this mirrors reconcile.ts's pre-existing, deliberate
 * ageDisconfirms() invariant ("absence of an age on the hit is not
 * disconfirming"). The name gate (nameMatches) already did the primary
 * identity-narrowing work; this gate's job is to catch an actual CONFLICT
 * in DOB/age evidence, not to demand redundant corroboration when none
 * exists to conflict with.
 */
function dobOrAgeConfirms(hit: RawWarrantHit, person: PersonRow): boolean {
  const personDob = person.dob || null;
  const hitDob = hit.date_of_birth || null;
  // Raw string equality, no reparsing — assumes both sides are already
  // normalized ISO-ish dates, matching the same convention already used by
  // matchesDobOrAge() in warrantNationalSearch.ts. A format mismatch (e.g.
  // one side ISO, the other MM/DD/YYYY) would false-reject here rather than
  // fall through to age tolerance, since this branch only skips when a dob
  // is BLANK, not when both are present but differently formatted.
  if (personDob && hitDob) return personDob === hitDob;

  const personAge = ageFromDob(personDob);
  const hitAge = hit.age ?? null;
  if (personAge != null && hitAge != null) {
    return Math.abs(personAge - hitAge) <= AGE_MATCH_TOLERANCE;
  }
  // Person has usable identity data but the hit carries none — pass through
  // (no conflicting evidence, so nothing to reject on).
  if (personAge != null && hitAge == null && !hitDob) return true;
  // Neither side has any usable identity data to compare — no positive
  // evidence exists anywhere to confirm identity.
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
