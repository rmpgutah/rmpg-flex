import type { Bindings } from '../../types';
import type { SourceCoverage } from './coverage';

export interface PersonRow {
  id: number;
  first_name?: string | null;
  middle_name?: string | null;
  last_name?: string | null;
  dob?: string | null;            // 'YYYY-MM-DD'
  nationality?: string | null;
  citizenship?: string | null;
  sex?: string | null;
}

export interface SearchParams {
  source?: string;
  forename?: string;
  name?: string;
  nationality?: string;
  ageMin?: number;
  ageMax?: number;
  sexId?: string;
  page?: number;
}

export interface NormalizedCandidate {
  sourceKey: string;
  externalId: string;
  displayName: string;
  summary: string;
  photoUrl?: string;
  country?: string;
  listType?: string;
  dob?: string | null;
  ageMin?: number | null;
  ageMax?: number | null;
  nationalities?: string[];
  raw: unknown;
}

export interface MatchResult {
  score: number;
  matchedFields: string[];
  isConfident: boolean;
}

export interface ScreeningHitRow {
  id: number;
  source_key: string;
  person_id: number | null;
  external_id: string;
  match_score: number;
  matched_fields: string | null;
  status: 'pending' | 'confirmed' | 'dismissed';
  display_name: string | null;
  summary: string | null;
  photo_url: string | null;
  country: string | null;
  list_type: string | null;
  raw_json: string | null;
  reviewed_by: number | null;
  reviewed_at: string | null;
  promoted_ref: string | null;
  first_seen_at: string;
  last_seen_at: string;
  is_active: number;
}

export interface ScreeningAdapter {
  sourceKey: string;
  kind: 'notice' | 'sanction' | 'sex_offender';
  label: string;
  supportsSearch: boolean;
  supportsWatch: boolean;
  searchAdHoc(env: Bindings, params: SearchParams): Promise<NormalizedCandidate[]>;
  fetchForPerson(env: Bindings, person: PersonRow): Promise<NormalizedCandidate[]>;
  scoreMatch(person: PersonRow, candidate: NormalizedCandidate): MatchResult;
  normalize(raw: unknown): NormalizedCandidate;
  confirmHit(env: Bindings, hit: ScreeningHitRow): Promise<{ promotedRef: string }>;
  /**
   * Optional. For local-table-backed sources, reports whether searchable
   * data is actually loaded so an empty result is never mistaken for a
   * clearance. Omit for live-API sources (INTERPOL/OFAC) which are always
   * "covered" when reachable.
   */
  coverage?(env: Bindings): Promise<SourceCoverage>;
}
