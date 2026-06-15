import type { MatchResult } from './types';

export function normalizeName(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function ageFromDob(dob: string | null | undefined, nowYear: number): number | null {
  if (!dob) return null;
  const m = /\b(\d{4})\b/.exec(dob);
  if (!m) return null;
  const birthYear = parseInt(m[1], 10);
  if (!Number.isFinite(birthYear) || birthYear < 1900 || birthYear > nowYear) return null;
  return nowYear - birthYear;
}

export interface NameScoreInput {
  personSurname: string; personForename: string;
  personAge: number | null; personNationality: string | null;
  candSurname: string; candForename: string;
  candAgeMin: number | null; candAgeMax: number | null;
  candNationalities: string[];
}

export function scoreNameMatch(input: NameScoreInput, threshold = 0.8): MatchResult {
  const matched: string[] = [];
  const ps = normalizeName(input.personSurname);
  const cs = normalizeName(input.candSurname);
  if (!ps || !cs || ps !== cs) return { score: 0, matchedFields: [], isConfident: false };
  matched.push('surname');
  let score = 0.6;
  const pf = normalizeName(input.personForename);
  const cf = normalizeName(input.candForename);
  if (pf && cf) {
    if (pf === cf) { score += 0.25; matched.push('forename'); }
    else if (pf[0] === cf[0]) { score += 0.1; matched.push('forename-initial'); }
  }
  // Adapters set candAgeMin === candAgeMax to a single derived birth-year age,
  // so this is a ±1 window around that point. A genuine [min,max] range is also
  // supported. Do NOT use a single bound to mean an open-ended inequality.
  if (input.personAge != null && (input.candAgeMin != null || input.candAgeMax != null)) {
    const lo = (input.candAgeMin ?? input.candAgeMax)! - 1;
    const hi = (input.candAgeMax ?? input.candAgeMin)! + 1;
    if (input.personAge >= lo && input.personAge <= hi) { score += 0.15; matched.push('age'); }
  }
  if (input.personNationality) {
    const pnTokens = new Set(normalizeName(input.personNationality).split(' ').filter(Boolean));
    const natHit = input.candNationalities.some((n) =>
      normalizeName(n).split(' ').filter(Boolean).some((t) => pnTokens.has(t)));
    if (pnTokens.size && natHit) { score += 0.1; matched.push('nationality'); }
  }
  score = Math.min(score, 1);
  return { score, matchedFields: matched, isConfident: score >= threshold };
}

// Sanctions/SO lists often store a single free-form name. Require every person
// name token to appear among the candidate's normalized tokens.
export function scoreSanctionMatch(personSurname: string, personForename: string, candName: string, threshold = 0.8): MatchResult {
  const surname = normalizeName(personSurname);
  const forename = normalizeName(personForename);
  const candTokens = new Set(normalizeName(candName).split(' ').filter(Boolean));
  if (!surname || !candTokens.has(surname)) return { score: 0, matchedFields: [], isConfident: false };
  const matched = ['surname'];
  let score = 0.7;
  if (forename && candTokens.has(forename)) { score += 0.3; matched.push('forename'); }
  score = Math.min(score, 1);
  return { score, matchedFields: matched, isConfident: score >= threshold };
}

export { splitUdcName } from './udcApi';
