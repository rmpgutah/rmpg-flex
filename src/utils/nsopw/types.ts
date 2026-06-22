// ============================================================
// RMPG Flex — NSOPW (Nationwide Sex Offender Public Website) types.
// ------------------------------------------------------------
// Ground truth: tests/fixtures/nsopw/john-smith-search.real.json
// (captured 2026-06-22 against the real DOJ endpoint).
//
// Wire format is the public CORS-restricted endpoint at
// nsopw-api.ojp.gov — see client.ts for endpoint + headers.
// These types describe the canonical RMPG-side shape AFTER parsing;
// the wire-format names (offenders[].name.surName, offenders[].dob)
// live in parse.ts.
// ============================================================

/** Officer-typed query. NSOPW search accepts firstName + lastName +
 *  optional city/county/zip; DOB is post-filter only (DOB is in the
 *  RESPONSE on ~73% of offenders but the FORM doesn't accept it). */
export interface NsopwQuery {
  surname: string;
  forename: string;
  middleName?: string;
  /** Post-filter only; never sent to NSOPW. */
  dob?: string;
  /** Optional location narrowing — passed through to NSOPW. */
  city?: string;
  county?: string;
  zip?: string;
}

export type NsopwCacheKey = string;

/** One offender returned by NSOPW, normalized into RMPG canonical form. */
export interface NsopwOffender {
  /** NSOPW does NOT return a per-offender id at the top level. The
   *  jurisdiction's id is encoded in `offenderUri`. We synthesize a
   *  stable id from the URI for dedup; if URI is missing we hash the
   *  name+jurisdiction+DOB. See parse.ts:deriveOffenderId(). */
  nsopwOffenderId: string;
  jurisdiction: string;               // 'UT', 'CO', 'CHEROKEE', 'REDLAKE', etc.
  jurisdictionLabel: string;          // derived label; raw API only returns the code
  firstName: string;
  middleName: string | null;
  lastName: string;
  suffix: string | null;
  aliases: NsopwAlias[];
  dateOfBirth: string | null;         // 'YYYY-MM-DD' when present in response (~73%)
  age: number | null;
  sex: string | null;                 // mapped from API `gender`
  race: string | null;                // NSOPW federated response does not carry race
  height: string | null;              // not in federated response
  weight: string | null;              // not in federated response
  hairColor: string | null;           // not in federated response
  eyeColor: string | null;            // not in federated response
  scarsMarks: string | null;          // not in federated response
  /** Primary residence (locations[0]). All locations preserved in `locations`. */
  address: string | null;
  city: string | null;
  county: string | null;
  state: string | null;
  zip: string | null;
  latitude: number | null;
  longitude: number | null;
  /** Multi-location: NSOPW can return RESIDENCE + WORK + INCARCERATED. */
  locations: NsopwLocation[];
  /** Whether the registrant is currently in absconder status. ~94% have this. */
  absconder: boolean;
  /** Offense / tier / risk are NOT in NSOPW's federated response — they
   *  require a per-state detail-page enrichment scrape (future work). */
  offense: string | null;
  riskLevel: string | null;
  tier: number | null;
  registrationStatus: string | null;
  complianceStatus: string | null;
  photoUrl: string | null;            // wire: imageUri (upstream state SOR host)
  /** Worker-served URL for the LOCALLY persisted photo, e.g.
   *  /api/nsopw/photo/123. Populated after upsertOffender(); the
   *  client prefers this over photoUrl when present so we serve
   *  our copy, not the upstream host. */
  localPhotoUrl: string | null;
  /** D1 row id of the persisted national_sex_offenders record. Set
   *  by the orchestrator after upsert; used to drive localPhotoUrl
   *  and the /api/nsopw/offender/:id detail link. */
  rowId: number | null;
  /** Linked canonical persons.id (auto-created if no existing local
   *  person matched the offender). Set after materializeOffenderLinks
   *  in the orchestrator. Client uses this to deep-link to the
   *  Records UI: /records?tab=persons&personId={personId}. */
  personId: number | null;
  /** Linked properties.id rows (one per real address from locations[];
   *  TRANSIENT / INCARCERATED skipped). Each entry carries the
   *  location_type so the UI can label "Residence" / "Work" / etc. */
  linkedProperties: Array<{ propertyId: number; locationType: string; locationName: string | null }>;
  detailUrl: string | null;           // wire: offenderUri (deep-link to jurisdiction's public record)
  raw: unknown;
}

export interface NsopwAlias {
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
}

export interface NsopwLocation {
  /** 'R' / 'RESIDENTIAL' / 'WORK' / 'INCARCERATED' / 'STUDENT' / 'N/A' */
  type: string;
  /** Label string ('RESIDENCE', etc.) — present on ~12% of locations. */
  name: string | null;
  streetAddress: string | null;
  city: string | null;
  county: string | null;
  state: string | null;
  zipCode: string | null;
  latitude: number | null;
  longitude: number | null;
}

export type JurisdictionStatus = 'ok' | 'timeout' | 'error' | 'no_data';
export type JurisdictionCoverage = Record<string, JurisdictionStatus>;

export interface NsopwSearchResponse {
  offenders: NsopwOffender[];
  jurisdictionCoverage: JurisdictionCoverage;
  /** Per-jurisdiction record counts — useful for "FL had 45 matches, 0 elsewhere"
   *  diagnostic surfaces in the UI. */
  jurisdictionRecordCounts: Record<string, number>;
  /** Per-jurisdiction response time in ms — surfaces slow states. */
  jurisdictionResponseTime: Record<string, number>;
  raw: unknown;
}

export type MatchClassification = 'confirmed' | 'possible' | 'excluded';

export interface ClassifiedCandidate {
  offender: NsopwOffender;
  classification: MatchClassification;
  score: number;
  matchedFields: string[];
  reason: string;
}

// Typed errors mirror the project pattern (Fleet.io, Roboflow, ClearPath).
export class NsopwConfigError extends Error {
  constructor(public reason: string) { super(`NSOPW not configured: ${reason}`); }
}
export class NsopwTimeoutError extends Error {
  constructor() { super('NSOPW federated query timed out'); }
}
export class NsopwHttpError extends Error {
  constructor(public status: number, public body?: string) {
    super(`NSOPW HTTP ${status}`);
  }
}
export class NsopwRateLimitError extends Error {
  constructor(public retryAfterSec?: number) {
    super(`NSOPW rate limit hit${retryAfterSec ? ` (retry after ${retryAfterSec}s)` : ''}`);
  }
}
