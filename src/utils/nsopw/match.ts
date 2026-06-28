// ============================================================
// RMPG Flex — NSOPW candidate matching.
// ------------------------------------------------------------
// Implements the operator's chosen policy: STRICT auto-confirm,
// officer reviews borderline. NSOPW returns every offender whose
// name vaguely matches the query string; this module classifies
// each into 'confirmed' / 'possible' / 'excluded'.
//
// Auto-confirm requires ALL of:
//   - last name matches exactly (after canonicalization)
//   - first name matches exactly
//   - DOB is known on BOTH sides and matches exactly
//
// 'possible' covers:
//   - last name matches AND (first-initial match OR alias hit)
//   - last+first match but one side has no DOB
//   - DOB matches but name only matches phonetically (Levenshtein <= 2)
//
// Everything else → 'excluded'. Excluded candidates are still recorded
// in the audit trail (we queried them, NSOPW returned them) but they
// don't surface as hits or possibles on any UI.
// ============================================================

import type {
  ClassifiedCandidate, MatchClassification, NsopwOffender, NsopwQuery,
} from './types';
import { canonName, canonDob } from './normalize';

// 0.5 = surname match (0.4) + ANY weak forename signal (initial, phonetic, +0.1).
// Below 0.5 means "we got nothing past the surname alone", which is too noisy
// for the review queue when 50 states each have ~100 "Smith" entries.
const POSSIBLE_THRESHOLD = 0.5;
const CONFIRMED_THRESHOLD = 1.0;     // strict policy: only 1.0 auto-confirms

/**
 * Classify one NSOPW candidate against the query. Returns the
 * classification plus a score and matched-field list. Pure function.
 */
export function classifyCandidate(query: NsopwQuery, candidate: NsopwOffender): ClassifiedCandidate {
  const qSurname = canonName(query.surname);
  const qForename = canonName(query.forename);
  const qDob = canonDob(query.dob ?? '');
  const cSurname = canonName(candidate.lastName);
  const cForename = canonName(candidate.firstName);
  const cDob = canonDob(candidate.dateOfBirth ?? '');

  const matched: string[] = [];
  let score = 0;
  let reason = '';

  // ── Surname is the gate. No surname match → excluded immediately.
  // Aliases get a single retry shot — if the surname matches an alias,
  // we treat that as a half-strength surname hit (possible, not confirmed).
  const surnameMatchesPrimary = !!qSurname && qSurname === cSurname;
  // Aliases are structured {firstName, middleName, lastName} per the real
  // wire format (NsopwAlias). Surname-alias matches when the canonical
  // alias surname equals (or contains) the query surname.
  const surnameMatchesAlias =
    !surnameMatchesPrimary && qSurname.length > 0 &&
    candidate.aliases.some((a) => canonName(a.lastName ?? '').includes(qSurname));

  if (!surnameMatchesPrimary && !surnameMatchesAlias) {
    return {
      offender: candidate, classification: 'excluded', score: 0,
      matchedFields: [], reason: 'surname does not match',
    };
  }
  if (surnameMatchesPrimary) { matched.push('surname'); score += 0.4; }
  else { matched.push('surname-alias'); score += 0.2; reason += 'alias-only surname; '; }

  // ── Forename adds 0.3 when exact, 0.1 when initial / phonetic.
  // Phonetic-sibling (Stephen/Steven, Catherine/Kathryn) is checked
  // BEFORE first-initial because it's the more informative signal —
  // if the names are mostly the same, that's a phonetic typo, not
  // an unrelated J-name pair.
  if (qForename && cForename) {
    if (qForename === cForename) {
      matched.push('forename'); score += 0.3;
    } else if (qForename.length > 2 && cForename.length > 2 &&
               levenshtein(qForename, cForename) <= 2) {
      // Spelling typos / phonetic siblings (Stephen/Steven). Possible only.
      matched.push('forename-phonetic'); score += 0.1;
      reason += 'forename phonetic-similar; ';
    } else if (qForename[0] === cForename[0]) {
      matched.push('forename-initial'); score += 0.1;
      reason += 'forename initial only; ';
    } else {
      reason += 'forename mismatch; ';
    }
  } else if (!qForename) {
    reason += 'no forename in query; ';
  } else if (!cForename) {
    reason += 'no forename in candidate; ';
  }

  // ── DOB. Exact match adds the final 0.3 needed to reach 1.0 auto-confirm.
  if (qDob && cDob) {
    if (qDob === cDob) {
      matched.push('dob'); score += 0.3;
    } else {
      reason += `dob mismatch (q=${qDob}, c=${cDob}); `;
      // A confirmed DOB mismatch is a hard fail. Even with name match,
      // we can't be looking at the same person. Drop to excluded.
      return {
        offender: candidate, classification: 'excluded', score,
        matchedFields: matched, reason: reason.trim() + ' (DOB conflict)',
      };
    }
  } else if (!qDob && !cDob) {
    reason += 'no DOB on either side; ';
  } else if (!qDob) {
    reason += 'no DOB in query; ';
  } else {
    reason += 'no DOB on candidate; ';
  }

  score = Math.min(score, 1);

  let classification: MatchClassification;
  if (score >= CONFIRMED_THRESHOLD) classification = 'confirmed';
  else if (score >= POSSIBLE_THRESHOLD) classification = 'possible';
  else classification = 'excluded';

  return {
    offender: candidate, classification, score, matchedFields: matched,
    reason: reason.trim() || `score ${score.toFixed(2)}`,
  };
}

/**
 * Classify an entire candidate set. Returns sorted by score descending.
 */
export function classifyAll(query: NsopwQuery, candidates: NsopwOffender[]): ClassifiedCandidate[] {
  return candidates
    .map((c) => classifyCandidate(query, c))
    .sort((a, b) => b.score - a.score);
}

/** Standard Levenshtein, used for phonetic-sibling forename fuzz. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array(b.length + 1);
  const curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}
