// ============================================================
// RMPG Flex — NSOPW federated response parser.
// ------------------------------------------------------------
// Ground truth: tests/fixtures/nsopw/john-smith-search.real.json
// (captured 2026-06-22 against the live DOJ endpoint).
//
// Real wire shape:
//   {
//     "statusCode": 201,
//     "jurisdictionStatus": [{jurisdictionId, statusCode, records, responseTime}, ...],
//     "query": { ... echo ... },
//     "offenders": [{
//       "name": { givenName, middleName, surName },
//       "aliases": [{ givenName, middleName, surName }, ...],
//       "gender": "M",
//       "dob": "1972-04-28T00:00:00",     // ~73% of records
//       "age": 54,
//       "locations": [{
//         "type": "RESIDENTIAL", "name": "RESIDENCE",
//         "streetAddress", "city", "county", "state", "zipCode",
//         "latitude", "longitude"
//       }],
//       "offenderUri": "https://offender.fdle.state.fl.us/...",
//       "imageUri": "https://offender.fdle.state.fl.us/...",
//       "absconder": false,
//       "jurisdictionId": "FL"
//     }]
//   }
//
// Pure function, no I/O. Unit-tested at tests/nsopwParse.test.ts
// against the real fixture.
// ============================================================

import type {
  NsopwOffender, NsopwSearchResponse, NsopwAlias, NsopwLocation,
  JurisdictionCoverage, JurisdictionStatus,
} from './types';
import { JURISDICTION_LABELS } from './jurisdictions';

type Bag = Record<string, unknown>;

function str(v: unknown): string | null {
  if (typeof v === 'string' && v.trim().length) return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function bool(v: unknown): boolean {
  return v === true || v === 'true' || v === 1 || v === '1';
}

/** Strip the time portion off NSOPW's ISO datetime DOB: '1972-04-28T00:00:00' → '1972-04-28' */
export function normalizeDob(dob: string | null): string | null {
  if (!dob) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(dob);
  return m ? m[1] : null;
}

function parseAlias(raw: unknown): NsopwAlias | null {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as Bag;
  const first = str(b.givenName);
  const last = str(b.surName);
  if (!first && !last) return null;
  return {
    firstName: first,
    middleName: str(b.middleName),
    lastName: last,
  };
}

function parseLocation(raw: unknown): NsopwLocation | null {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as Bag;
  // Drop locations that are completely empty (some states return placeholder rows).
  const street = str(b.streetAddress);
  const city = str(b.city);
  if (!street && !city) return null;
  // Treat lat/long === 0 as "unknown" (NSOPW uses 0 as a sentinel for "no coords").
  const lat = num(b.latitude);
  const lon = num(b.longitude);
  return {
    type: str(b.type) ?? 'UNKNOWN',
    name: str(b.name),
    streetAddress: street,
    city,
    county: str(b.county),
    state: str(b.state),
    zipCode: str(b.zipCode) ?? str(b.zip),
    latitude: lat === 0 ? null : lat,
    longitude: lon === 0 ? null : lon,
  };
}

/**
 * Synthesize a stable per-offender ID. NSOPW's federated response
 * doesn't expose a unified ID; we derive one from `offenderUri`
 * (the most stable signal — a deep-link the jurisdiction maintains).
 * Falls back to a name+jurisdiction+DOB hash when URI is missing.
 */
function deriveOffenderId(b: Bag, jurisdiction: string): string {
  const uri = str(b.offenderUri);
  if (uri) {
    // Strip query string variation — same offender across replays should map
    // to the same id. We keep host + path + the first id-looking query param.
    try {
      const u = new URL(uri);
      // Look for common id params: OfndrID, personId, sid, id, offenderId
      const idParam = ['OfndrID', 'personId', 'sid', 'id', 'offenderId', 'sexOffenderId']
        .map((p) => u.searchParams.get(p))
        .find((v) => v && v.trim().length);
      if (idParam) return `${u.host}:${idParam}`;
      // Hash-fragment links (Arkansas style): use the fragment
      if (u.hash) return `${u.host}:${u.hash.slice(1)}`;
      // Fallback: path tail
      const tail = u.pathname.split('/').filter(Boolean).pop();
      return tail ? `${u.host}:${tail}` : u.host;
    } catch { /* fall through */ }
  }
  // No URI — synthesize from name + jurisdiction + DOB.
  const name = b.name as Bag | undefined;
  const surName = str(name?.surName) ?? '';
  const givenName = str(name?.givenName) ?? '';
  const dob = normalizeDob(str(b.dob)) ?? '';
  return `${jurisdiction}:${surName}:${givenName}:${dob}`.toUpperCase();
}

/** Parse one offender from the federated response. */
export function parseOffender(raw: unknown): NsopwOffender | null {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as Bag;
  const name = (b.name ?? {}) as Bag;
  const firstName = str(name.givenName) ?? '';
  const lastName = str(name.surName) ?? '';
  if (!firstName && !lastName) return null;

  const jurisdiction = (str(b.jurisdictionId) ?? '').toUpperCase().slice(0, 32);
  const jurisdictionLabel = JURISDICTION_LABELS[jurisdiction] ?? jurisdiction;

  const aliasesRaw = Array.isArray(b.aliases) ? (b.aliases as unknown[]) : [];
  const aliases: NsopwAlias[] = aliasesRaw.map(parseAlias).filter((a): a is NsopwAlias => a !== null);

  const locationsRaw = Array.isArray(b.locations) ? (b.locations as unknown[]) : [];
  const locations: NsopwLocation[] = locationsRaw
    .map(parseLocation)
    .filter((l): l is NsopwLocation => l !== null);

  // Promote locations[0] to the flat columns for index-friendly queries.
  const primary = locations[0] ?? null;

  return {
    nsopwOffenderId: deriveOffenderId(b, jurisdiction),
    jurisdiction,
    jurisdictionLabel,
    firstName,
    middleName: str(name.middleName),
    lastName,
    suffix: null,                           // NSOPW federated response has no separate suffix field
    aliases,
    dateOfBirth: normalizeDob(str(b.dob)),
    age: num(b.age),
    sex: str(b.gender),
    race: null,
    height: null,
    weight: null,
    hairColor: null,
    eyeColor: null,
    scarsMarks: null,
    address: primary?.streetAddress ?? null,
    city: primary?.city ?? null,
    county: primary?.county ?? null,
    state: primary?.state ?? null,
    zip: primary?.zipCode ?? null,
    latitude: primary?.latitude ?? null,
    longitude: primary?.longitude ?? null,
    locations,
    absconder: bool(b.absconder),
    offense: null,
    riskLevel: null,
    tier: null,
    registrationStatus: null,
    complianceStatus: null,
    photoUrl: str(b.imageUri),
    // localPhotoUrl + rowId are set by the orchestrator after
    // upsertOffender; the parser doesn't know the row id yet.
    localPhotoUrl: null,
    rowId: null,
    detailUrl: str(b.offenderUri),
    raw,
  };
}

/**
 * Parse a full NSOPW federated search response.
 * Tolerates the v1.0 shape (current) and is defensive against
 * field-name drift on future API revisions.
 */
export function parseSearchResponse(raw: unknown): NsopwSearchResponse {
  if (!raw || typeof raw !== 'object') {
    return {
      offenders: [], jurisdictionCoverage: {},
      jurisdictionRecordCounts: {}, jurisdictionResponseTime: {}, raw,
    };
  }
  const env = raw as Bag;

  const rawOffenders = Array.isArray(env.offenders) ? env.offenders as unknown[] : [];
  const offenders: NsopwOffender[] = [];
  for (const r of rawOffenders) {
    const o = parseOffender(r);
    if (o) offenders.push(o);
  }

  const jurisdictionCoverage: JurisdictionCoverage = {};
  const jurisdictionRecordCounts: Record<string, number> = {};
  const jurisdictionResponseTime: Record<string, number> = {};
  const jurStatus = Array.isArray(env.jurisdictionStatus)
    ? env.jurisdictionStatus as unknown[]
    : [];
  for (const j of jurStatus) {
    if (!j || typeof j !== 'object') continue;
    const jb = j as Bag;
    const code = (str(jb.jurisdictionId) ?? '').toUpperCase().slice(0, 32);
    if (!code) continue;
    const httpStatus = str(jb.statusCode);
    jurisdictionCoverage[code] = httpStatusToCoverage(httpStatus);
    const records = num(jb.records);
    if (records != null) jurisdictionRecordCounts[code] = records;
    const rt = num(jb.responseTime);
    if (rt != null) jurisdictionResponseTime[code] = rt;
  }

  return {
    offenders,
    jurisdictionCoverage,
    jurisdictionRecordCounts,
    jurisdictionResponseTime,
    raw,
  };
}

/**
 * NSOPW returns HTTP-style codes per jurisdiction ('200' / '500' / '408').
 * Map those to our coarse coverage status enum.
 */
function httpStatusToCoverage(httpStatus: string | null): JurisdictionStatus {
  if (!httpStatus) return 'no_data';
  if (httpStatus === '200' || httpStatus === '201') return 'ok';
  if (httpStatus === '408' || httpStatus === '504') return 'timeout';
  return 'error';
}

/**
 * Derive a normalized 1/2/3 tier from a free-form jurisdiction label.
 * Kept as a utility — NSOPW's federated response doesn't carry tier
 * data, but a per-state detail-page enrichment scraper (future work)
 * will produce labels that this can normalize.
 */
export function deriveTier(label: string | null): number | null {
  if (!label) return null;
  const s = label.toLowerCase();
  if (/\b(tier|level)\s*(3|iii)\b/.test(s) || /\bsvp\b/.test(s) ||
      /sexually\s*violent/.test(s) || /\bhigh\b/.test(s)) return 3;
  if (/\b(tier|level)\s*(2|ii)\b/.test(s) || /\bmoderate\b/.test(s) ||
      /\bmedium\b/.test(s)) return 2;
  if (/\b(tier|level)\s*(1|i)\b/.test(s) || /\blow\b/.test(s)) return 1;
  return null;
}
