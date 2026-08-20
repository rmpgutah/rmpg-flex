export interface EnrichmentSeed {
  first_name: string;
  last_name: string;
  dob?: string;
  address?: string;
  city?: string;
  state?: string;
  phone?: string;
  email?: string;
  dl_number?: string;
  ssn_last4?: string;
}

export type MatchTier = 'CONFIRMED' | 'UNCONFIRMED';

export interface Address {
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
  type?: string;
  source: string;
}

export interface EnrichedRecord {
  name?: string;
  dob?: string;
  addresses: Address[];
  phones: string[];
  emails: string[];
  dl_number?: string;
  ssn_last4?: string;
  business_associations?: string[];
  watchlist_flags?: string[];
  source: string;
  raw?: unknown;
}

export interface SourceResult {
  source: string;
  ok: boolean;
  latency_ms: number;
  records: EnrichedRecord[];
  error?: string;
}

export interface HardLockResult {
  confirmed: boolean;
  anchors: string[];
}

export interface EnrichmentResponse {
  match_tier: MatchTier;
  anchors: string[];
  sources: SourceResult[];
  records: EnrichedRecord[];
  confirmed_count: number;
  cached: boolean;
  stale: boolean;
  searched_at: string;
}
