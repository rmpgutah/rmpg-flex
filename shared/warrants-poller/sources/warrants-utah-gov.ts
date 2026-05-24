// warrants.utah.gov adapter — query-lookup mode (public JSON REST API).
//
// API shape captured live 2026-05-24 via chrome-devtools MCP:
//   POST /api/v1/persons   body: {"name":{"first":"...","last":"..."}}
//     -> 201 {persons:[{id, name:{first,middle?,last}, homeAddress:{city?},
//                       age, links:{self, warrants}}]}
//   GET /api/v1/persons/{id}/warrants
//     -> 200 {warrants:[{id, issueDate, court:{name, caseId},
//                        charges:[string], links:{self}}]}
//   GET /api/v1/persons/{id}/warrants/{wid}   -> 403 (public access ends here)
//
// Fielded data is minimal — no DOB on persons (only `age` string), no bond,
// no warrant type, no statute codes. Our WarrantRecord has those as optional
// so they stay undefined here rather than being faked.
//
// The two name fields (first, last) are BOTH required by the API. lookup()
// takes a canonical name string from normalize.ts (typically "LAST, FIRST
// MIDDLE") and splits it.

import { BaseWarrantSource, type SourceMode } from './base';
import type { WarrantRecord } from '../types';

const API_BASE = 'https://warrants.utah.gov/api/v1';

interface PersonStub {
  id: string;
  name: { first: string; middle?: string; last: string };
  homeAddress?: { city?: string };
  age?: string;
}

interface WarrantStub {
  id: string;
  issueDate?: string;       // YYYY-MM-DD
  court?: { name?: string; caseId?: string };
  charges?: string[];
}

export class WarrantsUtahGovSource extends BaseWarrantSource {
  readonly id = 'warrants-utah-gov';
  readonly displayName = 'Utah Statewide Warrants Portal';
  readonly mode: SourceMode = 'query-lookup';

  async lookup(query: { name: string; dob?: string; age?: number }): Promise<WarrantRecord[]> {
    const { first, last } = splitName(query.name);
    if (!first || !last) {
      // API requires both. Refuse rather than spam a guaranteed-empty call.
      return [];
    }

    const persons = await this.searchPersons(first, last);

    // Disambiguate ONLY when the portal returned multiple candidates with the
    // same name. Single-match means the API's name match was unique enough to
    // trust — applying an age filter there risks dropping a real warrant due
    // to a ±1y data-entry slip (typo on system-side DOB, etc.). In a CAD/RMS
    // context the cost of a missed warrant alert >> the cost of a possibly-
    // misaged single match (which the officer will visually verify anyway).
    const expected = expectedAge(query);
    const filtered =
      persons.length > 1 && expected !== undefined
        ? persons.filter((p) => matchesAge(p.age, expected))
        : persons;

    // Fan out to per-person warrants endpoints. Sequential, not parallel:
    // the source is behind CloudFront + APIGW and we don't want to trip
    // rate limits during a single lookup. BaseWarrantSource.throttle()
    // enforces minIntervalMs between fetchWithRetry() calls.
    const out: WarrantRecord[] = [];
    const fetchedAt = new Date().toISOString();
    for (const person of filtered) {
      const warrants = await this.fetchWarrants(person.id);
      for (const w of warrants) {
        out.push(toRecord(person, w, fetchedAt));
      }
    }
    return out;
  }

  private async searchPersons(first: string, last: string): Promise<PersonStub[]> {
    const res = await this.fetchWithRetry(`${API_BASE}/persons`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ name: { first, last } }),
    });
    if (res.status === 404 || res.status === 204) return [];
    if (!res.ok && res.status !== 201) {
      throw new Error(`warrants.utah.gov persons search ${res.status}`);
    }
    const json = (await res.json()) as { persons?: PersonStub[] };
    return json.persons ?? [];
  }

  private async fetchWarrants(personId: string): Promise<WarrantStub[]> {
    const res = await this.fetchWithRetry(
      `${API_BASE}/persons/${encodeURIComponent(personId)}/warrants`,
      { headers: { accept: 'application/json' } },
    );
    if (res.status === 404) return [];
    if (!res.ok) throw new Error(`warrants.utah.gov warrants/${personId} ${res.status}`);
    const json = (await res.json()) as { warrants?: WarrantStub[] };
    return json.warrants ?? [];
  }
}

// "LAST, FIRST MIDDLE" -> {first:"FIRST", last:"LAST"}
// "FIRST MIDDLE LAST"  -> {first:"FIRST", last:"LAST"}
// "MONONYM"            -> {first:"", last:""}  (rejected upstream)
function splitName(raw: string): { first: string; last: string } {
  const s = raw.trim();
  if (s.includes(',')) {
    const [last, rest] = s.split(',', 2).map((x) => x.trim());
    const first = (rest ?? '').split(/\s+/)[0] ?? '';
    return { first, last };
  }
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return { first: '', last: '' };
  return { first: parts[0], last: parts[parts.length - 1] };
}

// API exposes `age` (string years), not DOB. To disambiguate by age we need
// the caller's expected age — provided directly or derived from their DOB.
// `age` wins when both are supplied because it matches the portal's own
// representation (no birthday-timing recomputation needed on our side).
function expectedAge(query: { dob?: string; age?: number }): number | undefined {
  if (typeof query.age === 'number' && Number.isFinite(query.age) && query.age >= 0) {
    return Math.floor(query.age);
  }
  if (!query.dob) return undefined;
  const m = query.dob.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return undefined;
  const birth = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const beforeBirthday =
    now.getMonth() < birth.getMonth() ||
    (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate());
  if (beforeBirthday) age--;
  return age;
}

// ±1y tolerance absorbs birthday-timing slop between when each side last
// computed age (December-born person queried in early January, etc.).
// If the portal didn't expose age for a candidate, don't drop them —
// missing data is not evidence of mismatch.
function matchesAge(apiAge: string | undefined, expected: number): boolean {
  if (!apiAge) return true;
  const actual = parseInt(apiAge, 10);
  if (Number.isNaN(actual)) return true;
  return Math.abs(actual - expected) <= 1;
}

function toRecord(person: PersonStub, warrant: WarrantStub, fetchedAt: string): WarrantRecord {
  const nameParts = [person.name.last + ',', person.name.first, person.name.middle].filter(Boolean);
  return {
    source: 'warrants-utah-gov',
    sourceWarrantId: warrant.id,
    subjectName: nameParts.join(' '),
    charges: warrant.charges ?? [],
    issuedDate: warrant.issueDate,
    issuingCourt: warrant.court?.name,
    lastKnownAddress: person.homeAddress?.city,
    notes: warrant.court?.caseId ? `Case ${warrant.court.caseId}` : undefined,
    fetchedAt,
  };
}
