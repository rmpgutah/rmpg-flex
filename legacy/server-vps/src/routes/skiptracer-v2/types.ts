// ============================================================
// Skip Tracker 3.5 — Shared Types & Interfaces
// ============================================================
// Dossier builder system: multi-source skip tracing with
// unified profile resolution. Imported by all source adapters,
// the resolver, and the orchestrator route.

// ============================================================
// Search Query
// ============================================================

export interface SearchQuery {
  /** Free-form full name (used when firstName/lastName not split) */
  name?: string;
  firstName?: string;
  lastName?: string;
  middleName?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  phone?: string;
  email?: string;
  /** Date of birth — ISO 8601 (YYYY-MM-DD) */
  dob?: string;
  /** Last 4 digits of SSN */
  ssn_last4?: string;
  username?: string;
  /** Age range for disambiguation */
  ageMin?: number;
  ageMax?: number;
}

// ============================================================
// Sub-Record Types
// ============================================================

export interface AddressRecord {
  source: string;
  street: string;
  street2?: string;
  city: string;
  state: string;
  zip: string;
  county?: string;
  type?: 'current' | 'previous' | 'mailing' | 'business' | 'unknown';
  firstSeen?: string;
  lastSeen?: string;
  lat?: number;
  lng?: number;
  verified?: boolean;
}

export interface PhoneRecord {
  source: string;
  number: string;
  type?: 'mobile' | 'landline' | 'voip' | 'unknown';
  carrier?: string;
  lineStatus?: 'active' | 'inactive' | 'unknown';
  firstSeen?: string;
  lastSeen?: string;
  verified?: boolean;
}

export interface SocialProfile {
  source: string;
  platform: string;
  username?: string;
  displayName?: string;
  profileUrl?: string;
  bio?: string;
  lastActive?: string;
  followers?: number;
  verified?: boolean;
}

export interface AssociateRecord {
  source: string;
  name: string;
  relationship?: string;
  address?: string;
  phone?: string;
  confidence?: number;
}

export interface CourtRecord {
  source: string;
  caseNumber: string;
  court: string;
  state: string;
  county?: string;
  caseType?: 'criminal' | 'civil' | 'traffic' | 'family' | 'bankruptcy' | 'other';
  filingDate?: string;
  dispositionDate?: string;
  disposition?: string;
  charges?: string[];
  status?: 'open' | 'closed' | 'pending' | 'unknown';
  plaintiff?: string;
  defendant?: string;
  judge?: string;
}

export interface PropertyRecord {
  source: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  county?: string;
  ownerName?: string;
  parcelId?: string;
  propertyType?: 'residential' | 'commercial' | 'land' | 'industrial' | 'unknown';
  assessedValue?: number;
  marketValue?: number;
  saleDate?: string;
  salePrice?: number;
  yearBuilt?: number;
  squareFeet?: number;
  bedrooms?: number;
  bathrooms?: number;
  lat?: number;
  lng?: number;
}

export interface LicenseRecord {
  source: string;
  type: 'driver' | 'professional' | 'concealed_carry' | 'hunting' | 'fishing' | 'other';
  licenseNumber?: string;
  state: string;
  status?: 'active' | 'expired' | 'suspended' | 'revoked' | 'unknown';
  issueDate?: string;
  expirationDate?: string;
  description?: string;
}

export interface VehicleRecord {
  source: string;
  vin?: string;
  plate?: string;
  plateState?: string;
  year?: number;
  make?: string;
  model?: string;
  color?: string;
  registeredOwner?: string;
  registrationStatus?: 'active' | 'expired' | 'suspended' | 'unknown';
  registrationExpiry?: string;
  titleState?: string;
}

export interface BusinessRecord {
  source: string;
  name: string;
  type?: string;
  status?: 'active' | 'inactive' | 'dissolved' | 'unknown';
  state: string;
  entityNumber?: string;
  registrationDate?: string;
  address?: string;
  role?: string;
  agent?: string;
  ein?: string;
}

export interface WatchlistFlag {
  source: string;
  listName: string;
  matchType?: 'exact' | 'partial' | 'alias' | 'fuzzy';
  matchScore?: number;
  category?: string;
  details?: string;
  dateAdded?: string;
  lastUpdated?: string;
}

export interface SexOffenderRecord {
  source: string;
  name: string;
  registryState: string;
  tier?: string;
  offenses?: string[];
  registrationDate?: string;
  address?: string;
  photoUrl?: string;
  status?: 'compliant' | 'non-compliant' | 'absconded' | 'unknown';
  verified?: boolean;
}

export interface CustodyRecord {
  source: string;
  facility: string;
  facilityState: string;
  facilityType?: 'jail' | 'prison' | 'federal' | 'juvenile' | 'unknown';
  inmateId?: string;
  bookingDate?: string;
  releaseDate?: string;
  charges?: string[];
  status?: 'in_custody' | 'released' | 'transferred' | 'unknown';
  bond?: number;
  bondStatus?: 'set' | 'posted' | 'denied' | 'no_bond' | 'unknown';
}

// ============================================================
// Source Result — output from a single data source adapter
// ============================================================

export type SourceCategory = 'people' | 'court' | 'property' | 'business' | 'registry' | 'osint' | 'reference';

export interface SourceResult {
  source: string;
  sourceType: SourceCategory;
  confidence: number;
  fetchedAt: string;
  rawResultCount?: number;
  error?: string;

  // Sub-records returned by this source
  names?: Array<{ source: string; full: string; first?: string; middle?: string; last?: string; suffix?: string }>;
  dobs?: Array<{ source: string; dob: string; age?: number }>;
  ssns?: Array<{ source: string; last4: string }>;
  addresses?: AddressRecord[];
  phones?: PhoneRecord[];
  emails?: Array<{ source: string; address: string; type?: string; verified?: boolean }>;
  socialProfiles?: SocialProfile[];
  associates?: AssociateRecord[];
  courtRecords?: CourtRecord[];
  propertyRecords?: PropertyRecord[];
  licenses?: LicenseRecord[];
  vehicles?: VehicleRecord[];
  businesses?: BusinessRecord[];
  watchlistFlags?: WatchlistFlag[];
  sexOffenderRecords?: SexOffenderRecord[];
  custodyRecords?: CustodyRecord[];
  photos?: Array<{ source: string; url: string; description?: string }>;
  /** Free-form annotations (physical descriptions, warnings, NCIC numbers, rewards, cautions) */
  notes?: Array<{ source: string; text: string; category?: string }>;
  /** External links (wanted posters, PDFs, profile URLs) */
  links?: Array<{ source: string; url: string; label?: string }>;
  /** Generic metadata bag for reference/enrichment sources */
  meta?: Record<string, unknown>;
}

// ============================================================
// Data Source — adapter interface each source must implement
// ============================================================

export interface DataSource {
  /** Internal identifier (e.g. 'tlo', 'rapidapi_skip', 'utah_courts') */
  name: string;
  /** Human-readable name shown in UI */
  displayName: string;
  /** Category for grouping in the dossier */
  category: SourceCategory;
  /** Estimated cost per lookup in USD (0 for free sources) */
  costPerLookup: number;
  /** Priority order — lower numbers searched first */
  priority?: number;

  /** Execute a search and return results */
  search(query: SearchQuery): Promise<SourceResult>;
  /** Optional: fetch detailed record by source-specific ID */
  getDetails?(id: string): Promise<SourceResult>;
  /** Check if this source has valid credentials / config */
  isConfigured(): boolean;
  /** Check if this source is enabled by admin */
  isEnabled(): boolean;
  /** Verify the source API is reachable */
  healthCheck(): Promise<{ ok: boolean; latencyMs?: number; error?: string }>;
}

// ============================================================
// Dossier Profile — unified person after merging sources
// ============================================================

export interface DossierProfile {
  /** Internal profile ID (generated during resolution) */
  id: string;
  /** Merged / best-guess identity */
  firstName?: string;
  middleName?: string;
  lastName?: string;
  suffix?: string;
  aliases?: string[];
  dob?: string;
  age?: number;
  ssn_last4?: string;
  gender?: string;
  photoUrl?: string;

  // Aggregated sub-records from all sources
  addresses: AddressRecord[];
  phones: PhoneRecord[];
  emails: Array<{ source: string; address: string; type?: string; verified?: boolean }>;
  socialProfiles: SocialProfile[];
  associates: AssociateRecord[];
  courtRecords: CourtRecord[];
  propertyRecords: PropertyRecord[];
  licenses: LicenseRecord[];
  vehicles: VehicleRecord[];
  businesses: BusinessRecord[];
  watchlistFlags: WatchlistFlag[];
  sexOffenderRecords: SexOffenderRecord[];
  custodyRecords: CustodyRecord[];
  photos: Array<{ source: string; url: string; description?: string }>;

  // Attribution
  sources: string[];
  confidenceScore: number;
}

// ============================================================
// Unified Search Result — final response from orchestrator
// ============================================================

export interface UnifiedSearchResult {
  profiles: DossierProfile[];
  sourcesQueried: string[];
  sourcesResponded: string[];
  sourcesFailed?: Array<{ name: string; error: string }>;
  totalResults: number;
  totalCost: number;
  durationMs: number;
  query: SearchQuery;
  searchId: string;
  timestamp: string;
}
