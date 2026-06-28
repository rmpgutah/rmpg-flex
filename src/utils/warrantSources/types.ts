import type { D1Database } from '@cloudflare/workers-types';

export interface PersonRow { id: number; first_name: string; middle_name: string | null; last_name: string; dob: string | null; }

/** Source-agnostic raw hit BEFORE persistence/normalization. */
export interface RawWarrantHit {
  source_key: string;
  warrant_id: string;          // source's stable id for the warrant
  first_name?: string | null;
  middle_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
  date_of_birth?: string | null;
  age?: number | null;
  city?: string | null;
  state?: string | null;
  charge_description?: string | null;  // raw; normalized later
  court_name?: string | null;
  case_number?: string | null;
  bail_amount?: number | null;
  issue_date?: string | null;
  warrant_type?: string | null;
  photo_url?: string | null;
  detail_url?: string | null;
}

export type SourceKind = 'api' | 'html' | 'browser' | 'portal' | 'json' | 'socrata' | 'arcgis' | 'pdf' | 'xml' | 'csv' | 'p2c-legacy' | 'p2c-cloud';
export type SourceMode = 'full-list' | 'per-person';
export type WarrantCategory = 'criminal' | 'civil' | 'wanted';

export interface SourceMeta {
  key: string;
  display_name: string;
  state: string;
  county: string | null;
  source_url: string;
  kind: SourceKind;
  priority: 1 | 2 | 3 | 4;
  family?: string;
  category?: WarrantCategory;
}

/** One bounded window of a full-list roster, plus the cursor to resume from. */
export interface ChunkResult {
  hits: RawWarrantHit[];
  nextCursor: string | null;   // opaque resume token (arcgis: last OBJECTID; socrata: next offset)
  done: boolean;               // true = roster fully traversed this pass
}

export interface WarrantSourceAdapter {
  meta: SourceMeta;
  mode: SourceMode;
  fetchAll?(env: { DB: D1Database } & Record<string, unknown>): Promise<RawWarrantHit[]>;
  /** Chunked full-list fetch: return one window starting after `cursor` (null = start). */
  fetchChunk?(
    cursor: string | null,
    env: { DB: D1Database } & Record<string, unknown>,
  ): Promise<ChunkResult>;
  fetchForPerson?(person: PersonRow, env: { DB: D1Database } & Record<string, unknown>): Promise<RawWarrantHit[]>;
}
