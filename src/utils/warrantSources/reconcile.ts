import type { RawWarrantHit, PersonRow } from './types';

/**
 * One canonical warrant for a person after cross-source dedup. A warrant that
 * multiple sources reported collapses into a single hit; `sources` records the
 * distinct source_keys that saw it.
 */
export interface CanonicalHit extends RawWarrantHit {
  person_id: number | null;
  confidence: 'confirmed' | 'unverified';
  sources: string[]; // distinct source_keys that reported this warrant, first-seen order
}

// Copy of the poller's ageFromDob (kept standalone so this module stays pure
// and import-free of the poller). Same semantics: real-current-date diff,
// month/day adjusted, clamped to a sane human range.
function ageFromDob(dob: string | null): number | null {
  if (!dob) return null;
  const born = new Date(dob);
  if (isNaN(born.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - born.getFullYear();
  const m = now.getMonth() - born.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < born.getDate())) age--;
  return age >= 0 && age < 130 ? age : null;
}

// Same ±1 tolerance as the poller's AGE_MATCH_TOLERANCE — absorbs the
// birthday-timing gap between when a source computed `age` and now.
const AGE_MATCH_TOLERANCE = 1;

const isBlank = (v: unknown): boolean => v === null || v === undefined || v === '';

/**
 * Dedup key for a raw hit, in priority order:
 *  1. warrant_id (most stable)
 *  2. case_number
 *  3. composite: lower(last_name)|lower(court_name)|issue_date
 * Missing composite parts become empty strings.
 */
function dedupKey(h: RawWarrantHit): string {
  if (!isBlank(h.warrant_id)) return `wid:${h.warrant_id}`;
  if (!isBlank(h.case_number)) return `cn:${h.case_number}`;
  const ln = (h.last_name ?? '').toLowerCase();
  const court = (h.court_name ?? '').toLowerCase();
  const issued = h.issue_date ?? '';
  return `cmp:${ln}|${court}|${issued}`;
}

// Fields merged from raw hits (everything on RawWarrantHit except the
// identity/grouping fields we manage explicitly).
const MERGE_FIELDS: (keyof RawWarrantHit)[] = [
  'warrant_id',
  'first_name',
  'middle_name',
  'last_name',
  'full_name',
  'date_of_birth',
  'age',
  'city',
  'state',
  'charge_description',
  'court_name',
  'case_number',
  'bail_amount',
  'issue_date',
  'warrant_type',
  'photo_url',
  'detail_url',
];

/**
 * Whether `hit.age` disconfirms the person's DOB-derived age. Only true when
 * the person HAS a usable DOB AND the hit HAS an age that is off by more than
 * the tolerance. Absence of an age on the hit is NOT disconfirming.
 */
function ageDisconfirms(hit: RawWarrantHit, personAge: number | null): boolean {
  if (personAge === null) return false;
  if (hit.age === null || hit.age === undefined) return false;
  return Math.abs(personAge - hit.age) > AGE_MATCH_TOLERANCE;
}

/**
 * Merge raw hits (possibly the SAME warrant reported by multiple sources) for
 * ONE person into canonical hits.
 *
 * Confidence keys off the PERSON (mirrors the utah_warrants confirmed/unverified
 * model):
 *  - No person DOB => unverified (namesake risk; cannot age-confirm).
 *  - Person DOB present, and NO hit age conflicts the DOB-derived age => confirmed
 *    (we attributed by name; a missing age is not disconfirming).
 *  - Person DOB present but a merged hit's age is off by >1 => unverified
 *    (that attribution is suspect).
 */
export function reconcileHits(hits: RawWarrantHit[], person: PersonRow): CanonicalHit[] {
  const personAge = ageFromDob(person.dob);
  const personHasDob = !isBlank(person.dob);

  const byKey = new Map<string, CanonicalHit>();

  for (const h of hits) {
    const key = dedupKey(h);
    const existing = byKey.get(key);

    if (!existing) {
      const canonical: CanonicalHit = {
        ...h,
        person_id: person.id,
        confidence: 'unverified', // resolved after merge
        sources: [h.source_key],
      };
      byKey.set(key, canonical);
    } else {
      // Prefer the first non-empty value for each field (sparse source's gaps
      // filled by a richer source seen later).
      for (const f of MERGE_FIELDS) {
        if (isBlank(existing[f]) && !isBlank(h[f])) {
          (existing[f] as RawWarrantHit[keyof RawWarrantHit]) = h[f];
        }
      }
      if (!existing.sources.includes(h.source_key)) {
        existing.sources.push(h.source_key);
      }
    }
  }

  const out: CanonicalHit[] = [];
  for (const canonical of byKey.values()) {
    let confidence: 'confirmed' | 'unverified';
    if (!personHasDob) {
      confidence = 'unverified';
    } else if (ageDisconfirms(canonical, personAge)) {
      confidence = 'unverified';
    } else {
      confidence = 'confirmed';
    }
    canonical.confidence = confidence;
    out.push(canonical);
  }

  return out;
}
