// Positive identity confirmation for person-linked records (warrants, intel
// dossiers, jail ingest, skip-trace). Name alone is never enough to link —
// a second John Doe must not inherit the first John Doe's warrants or
// aggregator details. DOB is compared after normalizeDob() so
// `10/11/2001` and `2001-10-11` are the same birthday. Age is accepted as
// a fallback (±1 year). A city/state conflict is a hard reject when both
// sides carry a place.

import { normalizeDob } from './normalizeDob';

export const AGE_MATCH_TOLERANCE = 1;

export interface IdentityFields {
  first?: string | null;
  last?: string | null;
  fullName?: string | null;
  dob?: string | null;
  age?: number | string | null;
  city?: string | null;
  state?: string | null;
  address?: string | null;
}

export interface IdentityVerdict {
  /** True only when name matches AND DOB/age positively confirms. */
  matched: boolean;
  name: boolean;
  dobOrAge: boolean;
  place: boolean;
  placeConflict: boolean;
  anchors: string[];
}

export function normalizePersonName(s: string | null | undefined): string {
  return (s ?? '').toUpperCase().trim().replace(/[.\-']/g, ' ').replace(/\s+/g, ' ');
}

export function parsePersonName(fullName: string | null | undefined): { first: string; last: string } {
  const parts = normalizePersonName(fullName).split(' ').filter(Boolean);
  if (parts.length === 0) return { first: '', last: '' };
  if (parts.length === 1) return { first: '', last: parts[0] };
  return { first: parts[0], last: parts[parts.length - 1] };
}

function sides(fields: IdentityFields): { first: string; last: string } {
  const first = normalizePersonName(fields.first);
  const last = normalizePersonName(fields.last);
  if (first || last) return { first, last };
  return parsePersonName(fields.fullName);
}

export function ageFromDob(dob: string | null | undefined): number | null {
  const iso = normalizeDob(dob ?? null);
  if (!iso) return null;
  const [y, mo, d] = iso.split('-').map(Number);
  const now = new Date();
  let age = now.getFullYear() - y;
  const m = now.getMonth() + 1 - mo;
  if (m < 0 || (m === 0 && now.getDate() < d)) age--;
  return age >= 0 && age < 130 ? age : null;
}

export function parseAge(raw: number | string | null | undefined): number | null {
  if (raw == null || raw === '') return null;
  const n = typeof raw === 'number' ? raw : parseInt(String(raw).replace(/[^\d]/g, ''), 10);
  if (!Number.isFinite(n) || n < 0 || n >= 130) return null;
  return n;
}

/**
 * Full match: normalized first AND last both equal.
 * Partial match: last name exact, first name's first character equal
 * (nicknames / OCR first-initial drift). A last-name mismatch never passes.
 */
export function nameMatches(a: IdentityFields, b: IdentityFields): boolean {
  const left = sides(a);
  const right = sides(b);
  if (!left.last || !right.last || left.last !== right.last) return false;
  if (!left.first || !right.first) return false;
  if (left.first === right.first) return true;
  return left.first[0] === right.first[0];
}

/**
 * Positive DOB/age confirmation. Exact normalized DOB wins. Otherwise age
 * tolerance (±1). Missing evidence on either side fails — we do not link
 * "every John Doe" just because one side has a birthday and the other is blank.
 */
export function dobOrAgeConfirms(a: IdentityFields, b: IdentityFields): boolean {
  const aDob = normalizeDob(a.dob ?? null);
  const bDob = normalizeDob(b.dob ?? null);
  if (aDob && bDob) return aDob === bDob;

  const aAge = parseAge(a.age) ?? ageFromDob(aDob);
  const bAge = parseAge(b.age) ?? ageFromDob(bDob);
  if (aAge != null && bAge != null) {
    return Math.abs(aAge - bAge) <= AGE_MATCH_TOLERANCE;
  }
  return false;
}

const CITY_ALIASES: Record<string, string> = {
  slc: 'salt lake city',
  's l c': 'salt lake city',
  'salt lake': 'salt lake city',
  'wvc': 'west valley city',
};

function normPlace(s: string | null | undefined): string {
  const raw = (s ?? '').toLowerCase().trim().replace(/[.,]/g, ' ').replace(/\s+/g, ' ');
  return CITY_ALIASES[raw] ?? raw;
}

function normState(s: string | null | undefined): string {
  const raw = (s ?? '').toLowerCase().trim();
  if (raw === 'utah' || raw === 'ut') return 'ut';
  return raw;
}

/** True when both sides have a city and/or state that agree. */
export function placeConfirms(a: IdentityFields, b: IdentityFields): boolean {
  const aCity = normPlace(a.city);
  const bCity = normPlace(b.city);
  const aState = normState(a.state);
  const bState = normState(b.state);
  let any = false;
  if (aCity && bCity) {
    if (aCity !== bCity) return false;
    any = true;
  }
  if (aState && bState) {
    if (aState !== bState) return false;
    any = true;
  }
  return any;
}

export function placeConflicts(a: IdentityFields, b: IdentityFields): boolean {
  const aCity = normPlace(a.city);
  const bCity = normPlace(b.city);
  if (aCity && bCity && aCity !== bCity) return true;
  const aState = normState(a.state);
  const bState = normState(b.state);
  if (aState && bState && aState !== bState) return true;
  return false;
}

export function confirmIdentity(seed: IdentityFields, candidate: IdentityFields): IdentityVerdict {
  const name = nameMatches(seed, candidate);
  const dobOrAge = dobOrAgeConfirms(seed, candidate);
  const place = placeConfirms(seed, candidate);
  const conflict = placeConflicts(seed, candidate);
  const anchors: string[] = [];
  if (name) anchors.push('name');
  if (dobOrAge) {
    const seedDob = normalizeDob(seed.dob ?? null);
    const candDob = normalizeDob(candidate.dob ?? null);
    anchors.push(seedDob && candDob && seedDob === candDob ? 'dob' : 'age');
  }
  if (place) anchors.push('place');
  return {
    matched: name && dobOrAge && !conflict,
    name,
    dobOrAge,
    place,
    placeConflict: conflict,
    anchors,
  };
}

export function identityConfirmed(seed: IdentityFields, candidate: IdentityFields): boolean {
  return confirmIdentity(seed, candidate).matched;
}

export function identityConfidence(v: IdentityVerdict): 'high' | 'medium' | 'low' {
  if (v.matched && v.place) return 'high';
  if (v.matched) return 'medium';
  return 'low';
}
