// In-memory DataStore — third reference implementation alongside the D1
// adapter. Use cases:
//   1. orchestrator unit tests (no DB needed)
//   2. CLI demos (run end-to-end without Cloudflare)
//   3. local development against the real .gov API before D1 is wired
//
// All state lives in plain Maps. Not threadsafe (single-isolate use only).
// Persons are pre-seeded via the options arg; the store does not learn
// new persons from warrant data — that's the local system's job.

import type { DataStore, PersonStub, PollResult, WarrantRecord } from '../types.ts';

export interface MemoryDataStoreOptions {
  /** Optional pre-seeded persons for findPersonByNameDOB lookups. */
  persons?: PersonStub[];
}

export interface MemoryDataStoreSnapshot {
  warrants: WarrantRecord[];
  links: Array<{ warrantId: number; personId: number; linkedAt: string }>;
  audit: PollResult[];
}

export interface MemoryDataStore extends DataStore {
  /** Test helper — return everything the store has accumulated. */
  snapshot(): MemoryDataStoreSnapshot;
  /** Test helper — clear without dropping pre-seeded persons. */
  reset(): void;
}

export function makeMemoryDataStore(opts: MemoryDataStoreOptions = {}): MemoryDataStore {
  // (source, sourceWarrantId) -> {record, id}
  let warrantsByKey = new Map<string, { id: number; rec: WarrantRecord }>();
  let warrantsById = new Map<number, WarrantRecord>();
  let nextId = 1;
  let links: Array<{ warrantId: number; personId: number; linkedAt: string }> = [];
  let audit: PollResult[] = [];

  const persons = opts.persons ?? [];

  const key = (source: string, srcId: string) => `${source}::${srcId}`;

  return {
    async findExistingWarrant(source, sourceWarrantId) {
      const hit = warrantsByKey.get(key(source, sourceWarrantId));
      return hit ? hit.rec : null;
    },

    async upsertWarrant(rec) {
      const k = key(rec.source, rec.sourceWarrantId);
      const existing = warrantsByKey.get(k);
      if (existing) {
        warrantsByKey.set(k, { id: existing.id, rec });
        warrantsById.set(existing.id, rec);
        return { inserted: false, warrantId: existing.id };
      }
      const id = nextId++;
      warrantsByKey.set(k, { id, rec });
      warrantsById.set(id, rec);
      return { inserted: true, warrantId: id };
    },

    async findPersonByNameDOB(name, dob) {
      // Match canonical name; if dob supplied, require it to match too.
      // Mirrors the D1 adapter's semantics so tests are portable.
      for (const p of persons) {
        if (p.fullName !== name) continue;
        if (dob && p.dob && p.dob !== dob) continue;
        return p;
      }
      return null;
    },

    async linkWarrantToPerson(warrantId, personId) {
      const exists = links.some((l) => l.warrantId === warrantId && l.personId === personId);
      if (exists) return; // idempotent like ON CONFLICT DO NOTHING
      links.push({ warrantId, personId, linkedAt: new Date().toISOString() });
    },

    async recordAudit(result) {
      audit.push(result);
    },

    snapshot() {
      return {
        warrants: Array.from(warrantsById.values()),
        links: [...links],
        audit: [...audit],
      };
    },

    reset() {
      warrantsByKey = new Map();
      warrantsById = new Map();
      nextId = 1;
      links = [];
      audit = [];
    },
  };
}
