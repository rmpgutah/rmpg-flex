// ============================================================
// RMPG Flex — NSOPW (Nationwide Sex Offender Public Website) types.
// ------------------------------------------------------------
// The federated DOJ search aggregates results from all 50 states +
// territories + tribes in a single response. These types describe the
// canonical RMPG-side shape after parsing; the raw wire shape lives in
// client.ts and may differ slightly once the MOU pack arrives (the
// envelope has been documented publicly but request/response fields
// evolve). The parser at parse.ts is the only thing that needs to
// understand the wire shape.
// ============================================================

/** What the caller is searching for. */
export interface NsopwQuery {
  surname: string;
  forename: string;
  middleName?: string;
  dob?: string;                // 'YYYY-MM-DD' when known
}

/** A normalized cache/identity key for a query. */
export type NsopwCacheKey = string;

/** One offender returned by NSOPW, normalized into RMPG canonical form. */
export interface NsopwOffender {
  nsopwOffenderId: string;            // jurisdiction-issued external id
  jurisdiction: string;               // 'UT', 'CO', etc.
  jurisdictionLabel: string;          // human label, e.g. 'Utah BCI'
  firstName: string;
  middleName: string | null;
  lastName: string;
  suffix: string | null;
  aliases: string[];
  dateOfBirth: string | null;         // 'YYYY-MM-DD' when known
  sex: string | null;
  race: string | null;
  height: string | null;
  weight: string | null;
  hairColor: string | null;
  eyeColor: string | null;
  scarsMarks: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  offense: string | null;
  riskLevel: string | null;           // jurisdiction-native tier label
  tier: number | null;                // normalized 1/2/3 when derivable
  registrationStatus: string | null;
  complianceStatus: string | null;
  photoUrl: string | null;
  detailUrl: string | null;           // jurisdiction's public deep-link
  raw: unknown;                       // original NSOPW row, for audit/replay
}

/** Whole-response coverage map — which jurisdictions answered cleanly. */
export type JurisdictionStatus = 'ok' | 'timeout' | 'error' | 'no_data';
export type JurisdictionCoverage = Record<string, JurisdictionStatus>;

/** Raw federated response after parse. */
export interface NsopwSearchResponse {
  offenders: NsopwOffender[];
  jurisdictionCoverage: JurisdictionCoverage;
  /** Raw envelope, retained for audit + replay. */
  raw: unknown;
}

/** Final per-candidate classification after match.ts ranks. */
export type MatchClassification = 'confirmed' | 'possible' | 'excluded';

export interface ClassifiedCandidate {
  offender: NsopwOffender;
  classification: MatchClassification;
  score: number;                      // 0..1
  matchedFields: string[];            // ['surname','forename','dob'] etc.
  reason: string;                     // human-readable why
}

/** Typed errors mirror the project pattern (Fleet.io, Roboflow, ClearPath). */
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
