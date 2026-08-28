export interface IntelSeed {
  name?: string;
  dob?: string;      // YYYY-MM-DD or US MM/DD/YYYY
  age?: number | string;
  phone?: string;
  email?: string;
  plate?: string;
  address?: string;
  city?: string;
  state?: string;
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

/** A cross-ref emitted by an adapter before it is persisted (no dossier/id yet). */
export interface CapturedCrossRef {
  source: CrossReferenceSource;
  externalRef: string;
  externalUrl?: string;
  label: string;
  matchedFields: { field: string; value: string }[];
  confidence: number;
  isCriminal: boolean;
  riskFlags: RiskFlag[];
  /** Source-shaped structured payload (e.g. the full WebOlivia skip-trace
   *  profile: typed/provider-tagged phones, previous addresses w/ timespans,
   *  relatives & associates with ages). Persisted as meta_json. */
  meta?: Record<string, unknown>;
}

export interface SourceResult {
  sourceName: string;
  phase: 1 | 2 | 3;
  status: 'success' | 'error' | 'skipped' | 'not_configured';
  dataPoints: RawDataPoint[];
  connections: IntelConnection[];
  responseTimeMs: number;
  errorMessage?: string;
  /** Structured external-record cross-refs emitted by legal/criminal adapters. */
  crossRefs?: CapturedCrossRef[];
}

export type RiskFlag = 'warrant' | 'nsopw' | 'ofac' | 'hibp_breach' | 'arrest_mention' | 'fugitive' | 'court_criminal';

export interface ConfidenceOpts {
  sources: string[];
  hasInternalRecord: boolean;
  hasCrawlCorroboration: boolean;
}

// ============================================================
// Cross-reference capture & verification (2026-08-25)
// ============================================================
// Integrates six reference repositories into the dossier pipeline:
//  - WebOlivia/skip-trace + GautaVaid/Skip_Tracing — skip-trace profile
//    shape (phone type/provider, person_link, previous addresses, relatives
//    w/ age, associates) + multi-source confidence scoring.
//  - freelawproject/juriscraper + courtlistener — federal/state court
//    opinions + RECAP dockets via the CourtListener v4 REST API
//    (juriscraper is the scraper engine that FEEDS CourtListener; the API
//    is its sanctioned public surface).
//  - freelawproject/centralia — court-PDF opinion extractor output model
//    (cluster/opinions/headmatter/sections/removed/diagnostics). Workers
//    cannot run the Python extractor; this model is the typed contract a
//    client-side (Pyodide) or sidecar extractor fills.
//  - Premasajjanar/Criminal_database_management_system — criminal-records
//    cross-reference model (FIR/case number, charges, suspect/accused,
//    custody, evidence refs, case tracking).
// ============================================================

/** A captured cross-reference between the dossier subject and an external record. */
export interface CrossReference {
  id?: number;
  dossierId: number;
  source: CrossReferenceSource;
  /** Stable external id (docket number, FBI path, internal case id, profile id). */
  externalRef: string;
  externalUrl?: string;
  /** Human label for the match (case caption, bulletin title, profile name). */
  label: string;
  /** Which seed/known fields the external record corroborated. */
  matchedFields: { field: string; value: string }[];
  confidence: number;          // 0–1, name-only match is a lead (<0.5)
  isCriminal: boolean;
  riskFlags: RiskFlag[];
  /** Structured source payload (see CapturedCrossRef.meta). */
  meta?: Record<string, unknown>;
  capturedAt?: string;
  capturedBy?: number;
}

export type CrossReferenceSource =
  | 'COURTLISTENER'   // juriscraper-scraped federal/state dockets + opinions
  | 'FBI_WANTED'      // api.fbi.gov fugitive bulletins
  | 'CRIMINAL_DB'     // Premasajjanar-style criminal-records cross-reference
  | 'SKIP_TRACE'      // WebOlivia/GautaVaid skip-trace profile
  | 'INTERNAL';       // RMPG authoritative warrants/arrests/cases

export type VerificationMethod = 'dob' | 'address' | 'phone' | 'email' | 'identifier' | 'officer_review';
export type VerificationResult = 'confirmed' | 'rejected' | 'inconclusive';

/** An officer's verification of a captured cross-reference. */
export interface Verification {
  id?: number;
  crossRefId: number;
  method: VerificationMethod;
  result: VerificationResult;
  /** Free-text evidence the officer used to reach the verdict. */
  evidence: string;
  verifiedBy: number;
  verifiedAt?: string;
  /** Adjusted confidence after verification (confirmed → boost, rejected → 0). */
  adjustedConfidence: number;
}

/** Skip-trace profile shape (WebOlivia/skip-trace output model). */
export interface SkipTraceProfile {
  firstName?: string;
  lastName?: string;
  age?: string;
  born?: string;
  currentAddress?: string;
  city?: string;
  state?: string;
  zip?: string;
  county?: string;
  emails: string[];
  phones: { number: string; type?: string; provider?: string }[];
  previousAddresses: { street?: string; city?: string; state?: string; zip?: string; county?: string; timespan?: string }[];
  relatives: { name: string; age?: string }[];
  associates: { name: string; age?: string }[];
  personLink?: string;
  confidence: number;
}

/** centralia `read()` output model — court-PDF opinion extractor (freelawproject/centralia). */
export interface CentraliaResult {
  status: 'valid' | 'review' | 'scanned' | 'failed' | 'pending';
  court_id: string;
  cluster: {
    citation?: string;
    docket_number?: string;
    case_name?: string;
    date_filed?: string;
    date_filed_iso?: string | null;
    panel?: string[];
    parties?: string[];
  };
  opinions: { author?: string; type?: string; pages?: string; html?: string; text?: string }[];
  headmatter?: { by_role?: Record<string, string[]>; untinted?: number };
  endmatter?: { by_role?: Record<string, string[]>; untinted?: number };
  sections?: Record<string, unknown>;
  removed?: { kind?: string; page?: number; text?: string }[];
  warnings?: string[];
  diagnostics?: Record<string, unknown>;
  html?: string;
  casebody?: string;
  versions?: { centralia?: string } | Record<string, unknown>;
}
