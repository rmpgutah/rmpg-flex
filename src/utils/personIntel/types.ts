export interface IntelSeed {
  name?: string;
  dob?: string;      // YYYY-MM-DD
  phone?: string;
  email?: string;
  plate?: string;
  address?: string;
}

export type DataCategory = 'address' | 'phone' | 'email' | 'associate' | 'vehicle' | 'social' | 'business' | 'legal' | 'online';

export interface RawDataPoint {
  category: DataCategory;
  field: string;
  value: string;
  source: string;
}

export interface MergedDataPoint {
  category: DataCategory;
  field: string;
  value: string;
  sources: string[];
  confidence: number;
}

export interface IntelConnection {
  fromSubject: string;
  relationship: 'associate' | 'relative' | 'co-resident' | 'business-partner' | 'co-defendant';
  toSubject: string;
  confidence: number;
  sources: string[];
}

export interface SourceResult {
  sourceName: string;
  phase: 1 | 2 | 3;
  status: 'success' | 'error' | 'skipped' | 'not_configured';
  dataPoints: RawDataPoint[];
  connections: IntelConnection[];
  responseTimeMs: number;
  errorMessage?: string;
}

export type RiskFlag = 'warrant' | 'nsopw' | 'ofac' | 'hibp_breach' | 'arrest_mention';

export interface ConfidenceOpts {
  sources: string[];
  hasInternalRecord: boolean;
  hasCrawlCorroboration: boolean;
}
