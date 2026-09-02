// Interactive person-intel search used by PersonIntelPanel.
// Utah live candidates are filtered by name + DOB/age (+ city when present)
// before any warrant detail is fetched, so a query for John Doe born
// 10/11/2001 in Salt Lake City does not attach Provo's 44-year-old John Doe.

import type { D1Database } from '@cloudflare/workers-types';
import { query } from '../db';
import {
  confirmIdentity,
  identityConfidence,
  parsePersonName,
  type IdentityFields,
} from '../identityConfirm';
import {
  searchUtahCandidates,
  fetchWarrantsForCandidates,
  type FetchedWarrant,
  type PersonStub,
} from '../utahWarrantPoller';
import { log } from '../logger';

const DETAIL_CAP = 8;

export interface PersonIntelQuery {
  firstName: string;
  lastName: string;
  dob?: string;
  age?: number;
  city?: string;
  state?: string;
}

export interface PersonIntelCard {
  utahPersonId: string;
  searchName: string;
  age?: number;
  city?: string;
  localPersonMatch: { id: number; name: string; dob?: string } | null;
  identityConfidence: 'high' | 'medium' | 'low';
  confidenceFactors: string[];
  utahWarrants: Array<{
    utah_warrant_id: string;
    first_name: string;
    last_name: string;
    court_name: string | null;
    case_id: string | null;
    charges: string[];
    issue_date: string | null;
    age: number | null;
    city: string | null;
  }>;
  courtRecords: Array<{ case_number: string; court_name: string; charge: string; filing_date: string | null }>;
  localWarrants: Array<{ id: number; warrant_number: string | null; charge_description: string | null; offense_level: string | null; status: string | null }>;
}

function seedFromQuery(q: PersonIntelQuery): IdentityFields {
  return {
    first: q.firstName,
    last: q.lastName,
    dob: q.dob,
    age: q.age,
    city: q.city,
    state: q.state,
  };
}

function candidateFields(c: PersonStub): IdentityFields {
  return {
    first: c.firstName,
    last: c.lastName,
    age: c.age,
    city: c.city,
    state: 'UT',
  };
}

function parseCharges(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (Array.isArray(v)) return v.map(String).filter(Boolean);
  } catch { /* not JSON */ }
  return String(raw).split(/;|\n/).map((s) => s.trim()).filter(Boolean);
}

export async function runWarrantPersonIntel(
  db: D1Database,
  q: PersonIntelQuery,
): Promise<{ results: PersonIntelCard[]; apiAvailable: boolean }> {
  const seed = seedFromQuery(q);
  const hasIdentity = !!(q.dob || q.age);

  let apiAvailable = true;
  let candidates: PersonStub[] = [];
  try {
    candidates = await searchUtahCandidates(q.firstName, q.lastName);
  } catch (err) {
    apiAvailable = false;
    log.warn('person-intel Utah search failed; degrading to local', {
      err: err instanceof Error ? err.message : String(err),
    });
  }

  const keep: PersonStub[] = [];
  for (const c of candidates) {
    const v = confirmIdentity(seed, candidateFields(c));
    if (hasIdentity) {
      if (v.matched) keep.push(c);
    } else if (v.name && !v.placeConflict) {
      keep.push(c);
    }
  }

  let fetched: FetchedWarrant[] = [];
  try {
    fetched = await fetchWarrantsForCandidates(keep.slice(0, DETAIL_CAP));
  } catch (err) {
    apiAvailable = false;
    log.warn('person-intel Utah detail failed', {
      err: err instanceof Error ? err.message : String(err),
    });
  }

  const byUtahId = new Map<string, FetchedWarrant[]>();
  for (const w of fetched) {
    const list = byUtahId.get(w.utah_person_id) ?? [];
    list.push(w);
    byUtahId.set(w.utah_person_id, list);
  }

  const localPeople = await query<{ id: number; first_name: string; last_name: string; dob: string | null; city: string | null; state: string | null }>(
    db,
    `SELECT id, first_name, last_name, dob, city, state FROM persons
      WHERE UPPER(TRIM(first_name)) = UPPER(?) AND UPPER(TRIM(last_name)) = UPPER(?)
      LIMIT 25`,
    q.firstName, q.lastName,
  ).catch(() => []);

  const localWarrants = await query<{
    id: number; warrant_number: string | null; charge_description: string | null;
    offense_level: string | null; status: string | null;
    subject_first_name: string | null; subject_last_name: string | null; subject_dob: string | null;
    subject_person_id: number | null; subject_name: string | null;
  }>(
    db,
    `SELECT id, warrant_number, charge_description, offense_level, status,
            subject_first_name, subject_last_name, subject_dob, subject_person_id, subject_name
       FROM warrants
      WHERE LOWER(COALESCE(status,'')) NOT IN ('served','recalled','expired','cancelled','cleared','closed','quashed')
        AND (
          (UPPER(TRIM(COALESCE(subject_first_name,''))) = UPPER(?) AND UPPER(TRIM(COALESCE(subject_last_name,''))) = UPPER(?))
          OR UPPER(TRIM(COALESCE(subject_name,''))) = UPPER(?)
        )
      LIMIT 50`,
    q.firstName, q.lastName, `${q.firstName} ${q.lastName}`.trim(),
  ).catch(() => []);

  const courtRecords = await query<{ case_number: string; court_name: string; charge: string; filing_date: string | null }>(
    db,
    `SELECT case_number, court_name, charge, filing_date FROM court_records_cache
      WHERE UPPER(TRIM(COALESCE(first_name,''))) = UPPER(?) AND UPPER(TRIM(COALESCE(last_name,''))) = UPPER(?)
      LIMIT 20`,
    q.firstName, q.lastName,
  ).catch(() => []);

  const cards: PersonIntelCard[] = [];

  for (const c of keep.slice(0, DETAIL_CAP)) {
    const id = String(c.personId);
    const cand = candidateFields(c);
    const v = confirmIdentity(seed, cand);
    const local = pickLocalMatch(seed, localPeople, hasIdentity);
    const matchedLocalWarrants = localWarrants.filter((w) => warrantMatchesSeed(seed, w, hasIdentity));
    cards.push({
      utahPersonId: id,
      searchName: [c.firstName, c.lastName].filter(Boolean).join(' '),
      age: typeof c.age === 'number' ? c.age : undefined,
      city: c.city,
      localPersonMatch: local,
      identityConfidence: identityConfidence(v),
      confidenceFactors: v.anchors,
      utahWarrants: (byUtahId.get(id) ?? []).map((w) => ({
        utah_warrant_id: w.utah_warrant_id,
        first_name: w.first_name,
        last_name: w.last_name,
        court_name: w.court_name,
        case_id: w.case_id,
        charges: parseCharges(w.charges),
        issue_date: w.issue_date,
        age: w.age,
        city: w.city,
      })),
      courtRecords: identityFilterCourts(seed, courtRecords, hasIdentity),
      localWarrants: matchedLocalWarrants.map((w) => ({
        id: w.id,
        warrant_number: w.warrant_number,
        charge_description: w.charge_description,
        offense_level: w.offense_level,
        status: w.status,
      })),
    });
  }

  // If Utah returned nothing, still surface local identity-confirmed hits.
  if (cards.length === 0) {
    const local = pickLocalMatch(seed, localPeople, hasIdentity);
    const matchedLocalWarrants = localWarrants.filter((w) => warrantMatchesSeed(seed, w, hasIdentity));
    if (local || matchedLocalWarrants.length) {
      const name = local?.name ?? `${q.firstName} ${q.lastName}`.trim();
      const v = confirmIdentity(seed, {
        first: q.firstName, last: q.lastName, dob: local?.dob, city: q.city, state: q.state,
      });
      cards.push({
        utahPersonId: local ? `local:${local.id}` : `local:${name}`,
        searchName: name,
        localPersonMatch: local,
        identityConfidence: identityConfidence(v),
        confidenceFactors: v.anchors.length ? v.anchors : ['name'],
        utahWarrants: [],
        courtRecords: identityFilterCourts(seed, courtRecords, hasIdentity),
        localWarrants: matchedLocalWarrants.map((w) => ({
          id: w.id,
          warrant_number: w.warrant_number,
          charge_description: w.charge_description,
          offense_level: w.offense_level,
          status: w.status,
        })),
      });
    }
  }

  return { results: cards, apiAvailable };
}

function pickLocalMatch(
  seed: IdentityFields,
  people: Array<{ id: number; first_name: string; last_name: string; dob: string | null; city: string | null; state: string | null }>,
  requireIdentity: boolean,
): { id: number; name: string; dob?: string } | null {
  const confirmed = people.filter((p) => confirmIdentity(seed, {
    first: p.first_name, last: p.last_name, dob: p.dob, city: p.city, state: p.state,
  }).matched);
  if (confirmed.length === 1) {
    const p = confirmed[0];
    return { id: p.id, name: `${p.first_name} ${p.last_name}`.trim(), dob: p.dob ?? undefined };
  }
  if (requireIdentity) return null;
  // Name-only: unique local person is a lead, never auto-linked as confirmed.
  if (people.length === 1) {
    const p = people[0];
    return { id: p.id, name: `${p.first_name} ${p.last_name}`.trim(), dob: p.dob ?? undefined };
  }
  return null;
}

function warrantMatchesSeed(
  seed: IdentityFields,
  w: { subject_first_name: string | null; subject_last_name: string | null; subject_dob: string | null; subject_name: string | null },
  requireIdentity: boolean,
): boolean {
  const parsed = (!w.subject_first_name || !w.subject_last_name) ? parsePersonName(w.subject_name) : { first: '', last: '' };
  const cand: IdentityFields = {
    first: w.subject_first_name || parsed.first,
    last: w.subject_last_name || parsed.last,
    fullName: w.subject_name,
    dob: w.subject_dob,
  };
  const v = confirmIdentity(seed, cand);
  if (requireIdentity) return v.matched;
  return v.name;
}

function identityFilterCourts(
  seed: IdentityFields,
  rows: Array<{ case_number: string; court_name: string; charge: string; filing_date: string | null }>,
  requireIdentity: boolean,
): typeof rows {
  // court_records_cache is already name-scoped in SQL. When the query carried
  // a DOB we still return them as leads (courts often lack DOB) but they are
  // never auto-linked — the panel does not ingest court rows.
  void seed; void requireIdentity;
  return rows;
}
