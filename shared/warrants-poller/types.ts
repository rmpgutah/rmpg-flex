// Runtime-agnostic types for the Utah warrants poller.
// No Express, no Cloudflare, no better-sqlite3 imports. Pure TS.

export interface WarrantRecord {
  source: string;              // e.g. 'warrants.utah.gov', 'slco-sheriff'
  sourceWarrantId: string;     // stable per-source ID (or hash if site has none)
  subjectName: string;         // "LAST, FIRST MIDDLE" canonical form
  dob?: string;                // YYYY-MM-DD if exposed
  sex?: 'M' | 'F' | 'X' | 'U';
  race?: string;
  charges: string[];           // raw charge strings as listed
  statutes?: string[];         // parsed UT statute codes if available
  bondAmount?: number;         // USD
  bondType?: string;           // 'cash', 'cash-only', 'no-bond', etc.
  issuingAgency?: string;
  issuingCourt?: string;
  issuedDate?: string;         // YYYY-MM-DD
  warrantType?: 'arrest' | 'bench' | 'failure-to-appear' | 'other';
  lastKnownAddress?: string;
  notes?: string;
  rawHtml?: string;            // optional snapshot for audit / re-parsing
  fetchedAt: string;           // ISO 8601, set by orchestrator
}

export interface PollResult {
  source: string;
  startedAt: string;
  finishedAt: string;
  ok: boolean;
  warrantsFound: number;
  warrantsInserted: number;
  warrantsUpdated: number;
  personMatches: number;       // count of MNI cross-links created
  error?: string;
}

// Person record shape the linker needs. Kept minimal; the DataStore impl
// adapts the real persons table to this shape.
export interface PersonStub {
  id: number;
  fullName: string;
  dob?: string;
}

// The orchestrator depends ONLY on this interface. CF Workers backs it
// with D1; tests back it with an in-memory map. Keep it small.
export interface DataStore {
  findExistingWarrant(source: string, sourceWarrantId: string): Promise<WarrantRecord | null>;
  upsertWarrant(rec: WarrantRecord): Promise<{ inserted: boolean; warrantId: number }>;
  findPersonByNameDOB(name: string, dob?: string): Promise<PersonStub | null>;
  linkWarrantToPerson(warrantId: number, personId: number): Promise<void>;
  recordAudit(result: PollResult): Promise<void>;
}

// Optional alerting sink. CF impl posts to a Durable Object or Queue;
// tests can no-op. Decoupled from DataStore so polling works without
// a live WebSocket layer.
export interface AlertSink {
  newWarrantForKnownPerson(warrant: WarrantRecord, person: PersonStub): Promise<void>;
}
