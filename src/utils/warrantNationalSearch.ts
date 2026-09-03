// Shared helpers for the national warrant search endpoints
// (GET /api/warrants/national-coverage, POST /api/warrants/national-search
// in src/routes/warrants.ts). Kept out of that file since it's already a
// large route file — this module is pure/testable on its own and reusable
// if the also-stubbed POST /search-all is ever fixed later.

import { dobOrAgeConfirms } from './identityConfirm';

export const US_STATES: Array<{ code: string; name: string }> = [
  { code: 'AL', name: 'Alabama' }, { code: 'AK', name: 'Alaska' },
  { code: 'AZ', name: 'Arizona' }, { code: 'AR', name: 'Arkansas' },
  { code: 'CA', name: 'California' }, { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' }, { code: 'DE', name: 'Delaware' },
  { code: 'DC', name: 'District of Columbia' }, { code: 'FL', name: 'Florida' },
  { code: 'GA', name: 'Georgia' }, { code: 'HI', name: 'Hawaii' },
  { code: 'ID', name: 'Idaho' }, { code: 'IL', name: 'Illinois' },
  { code: 'IN', name: 'Indiana' }, { code: 'IA', name: 'Iowa' },
  { code: 'KS', name: 'Kansas' }, { code: 'KY', name: 'Kentucky' },
  { code: 'LA', name: 'Louisiana' }, { code: 'ME', name: 'Maine' },
  { code: 'MD', name: 'Maryland' }, { code: 'MA', name: 'Massachusetts' },
  { code: 'MI', name: 'Michigan' }, { code: 'MN', name: 'Minnesota' },
  { code: 'MS', name: 'Mississippi' }, { code: 'MO', name: 'Missouri' },
  { code: 'MT', name: 'Montana' }, { code: 'NE', name: 'Nebraska' },
  { code: 'NV', name: 'Nevada' }, { code: 'NH', name: 'New Hampshire' },
  { code: 'NJ', name: 'New Jersey' }, { code: 'NM', name: 'New Mexico' },
  { code: 'NY', name: 'New York' }, { code: 'NC', name: 'North Carolina' },
  { code: 'ND', name: 'North Dakota' }, { code: 'OH', name: 'Ohio' },
  { code: 'OK', name: 'Oklahoma' }, { code: 'OR', name: 'Oregon' },
  { code: 'PA', name: 'Pennsylvania' }, { code: 'RI', name: 'Rhode Island' },
  { code: 'SC', name: 'South Carolina' }, { code: 'SD', name: 'South Dakota' },
  { code: 'TN', name: 'Tennessee' }, { code: 'TX', name: 'Texas' },
  { code: 'UT', name: 'Utah' }, { code: 'VT', name: 'Vermont' },
  { code: 'VA', name: 'Virginia' }, { code: 'WA', name: 'Washington' },
  { code: 'WV', name: 'West Virginia' }, { code: 'WI', name: 'Wisconsin' },
  { code: 'WY', name: 'Wyoming' },
];

/**
 * Strict match confirmation: when the query supplied a dob, a candidate
 * record is only considered a match if its OWN dob matches exactly, or —
 * for records that only carry an age — the age computed from the query's
 * dob (as of today) falls within +/-1 year of the record's stated age. A
 * record with neither dob nor age, when the query supplied a dob, does NOT
 * match — there's no basis to confirm identity. When the query supplied no
 * dob at all, every record passes (name/state-only fallback).
 */
export function matchesDobOrAge(
  queryDob: string | null,
  record: { dob: string | null; age: number | null },
): boolean {
  if (!queryDob) return true;
  return dobOrAgeConfirms({ dob: queryDob }, { dob: record.dob, age: record.age });
}

export interface MappedWarrant {
  id: string | number;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  dob: string | null;
  age: number | string | null;
  state: string | null;
  warrant_type: string | null;
  offense_level: string | null;
  charge: string | null;
  issued_date: string | null;
  photo_url: string | null;
  status: string | null;
  bond_amount: number | string | null;
  court: string | null;
  source: string | null;
}

/** Maps a scraped_warrants row to the client Warrant shape, passing every
 *  other column through under its own name (capture-all-data requirement —
 *  nothing gets silently dropped, only renamed where the client expects a
 *  different key). */
export function mapScrapedWarrantRow(row: Record<string, unknown>): MappedWarrant & Record<string, unknown> {
  return {
    ...row,
    id: row.id as string | number,
    first_name: (row.first_name as string) ?? null,
    last_name: (row.last_name as string) ?? null,
    full_name: (row.full_name as string) ?? null,
    dob: (row.date_of_birth as string) ?? null,
    age: (row.age as number) ?? null,
    state: (row.state as string) ?? null,
    warrant_type: (row.warrant_type as string) ?? null,
    offense_level: (row.offense_level as string) ?? null,
    charge: (row.charge_description as string) ?? null,
    issued_date: (row.issue_date as string) ?? null,
    photo_url: (row.photo_url as string) ?? null,
    status: (row.status as string) ?? null,
    bond_amount: (row.bail_amount as number) ?? null,
    court: (row.court_name as string) ?? null,
    source: (row.source_key as string) ?? null,
  };
}

/** Maps a local `warrants` row to the client Warrant shape, same
 *  capture-all-data pass-through rule as mapScrapedWarrantRow. */
export function mapLocalWarrantRow(row: Record<string, unknown>): MappedWarrant & Record<string, unknown> {
  return {
    ...row,
    id: row.id as string | number,
    first_name: (row.subject_first_name as string) ?? null,
    last_name: (row.subject_last_name as string) ?? null,
    full_name: (row.subject_name as string) ?? null,
    dob: (row.subject_dob as string) ?? null,
    age: null,
    state: null,
    warrant_type: (row.warrant_type as string) ?? (row.type as string) ?? null,
    offense_level: (row.offense_level as string) ?? null,
    charge: (row.charge_description as string) ?? (row.offense as string) ?? null,
    issued_date: (row.issued_date as string) ?? null,
    photo_url: null,
    status: (row.status as string) ?? null,
    bond_amount: (row.bond_amount as number) ?? (row.bail_amount as number) ?? null,
    court: (row.issuing_court as string) ?? (row.court as string) ?? null,
    source: 'local',
  };
}
