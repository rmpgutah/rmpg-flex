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

export type SourceKind = 'api' | 'html' | 'browser' | 'portal';

export interface SourceMeta { key: string; display_name: string; state: string; county: string | null; source_url: string; kind: SourceKind; priority: 1 | 2 | 3 | 4; }

export interface WarrantSourceAdapter {
  meta: SourceMeta;
  /** Query the source for ONE local person. Pure of persistence — returns raw hits or throws on transport error. Phase-2 browser/portal kinds may throw 'unsupported transport'. */
  fetchForPerson(person: PersonRow, env: { DB: D1Database } & Record<string, unknown>): Promise<RawWarrantHit[]>;
}
