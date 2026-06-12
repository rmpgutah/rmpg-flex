# Intel Search + Entity Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Federated, ranked, identifier-aware search across all record types plus non-destructive "possible same person" entity resolution — the spine of the Palantir-grade records initiative.

**Architecture:** A D1 FTS5 table `intel_index` is kept in sync by the Worker cron via `src/utils/intelIndexer.ts`. `src/routes/intel.ts` exposes `/api/intel/search` (identifier sniffing → FTS bm25 → per-type LIKE fallback) and resolution endpoints. Pure matching logic lives in `src/utils/intelMatch.ts`. Client gets `/intel` (IntelSearchPage) and `GlobalSearch.tsx` is rewired to the new endpoint.

**Tech Stack:** Hono on Cloudflare Workers, D1 (FTS5), React 18 + Vite + Tailwind (Spillman black/gold tokens), vitest for client tests. Worker has typecheck only — pure helpers are written testable for a future Miniflare suite.

**Spec:** `docs/superpowers/specs/2026-06-11-intel-search-entity-resolution-design.md`

**Schema facts (verified against connections.ts, which was validated on live D1):**
persons(first_name,last_name,dob,address,city,state,phone,flags) • vehicles_records(plate_number,state,make,model,year,color,vin,owner_person_id,flags) • properties(name,address,property_type) • cases(case_number,title,case_type,status,priority) • incidents(incident_number,incident_type,status,priority,location_address,call_id) • warrants(warrant_number,status,type,subject_person_id,person_id,charge_description) • citations(citation_number,type,status,person_id,vehicle_id,violation_description) • field_interviews(fi_number,person_id,vehicle_id,location,contact_reason) • trespass_orders(order_number,person_id,property_id,location,status) • calls_for_service(call_number,incident_type,priority,status,location_address) • evidence(evidence_number,description,evidence_type,status).
⚠️ `persons.dob` not `date_of_birth`. ⚠️ Sentinel strings: live text columns hold literal "None"/"N/A"/"0" — never truthiness-check. ⚠️ All D1 calls are async. ⚠️ Never ALTER persons/calls_for_service (100-col cap) — this plan adds only NEW tables.

---

### Task 1: Migration 0098 — intel tables

**Files:**
- Create: `migrations/0098_intel_search.sql`

- [ ] **Step 1: Write the migration (idempotent DDL)**

```sql
-- 0098: Intel Search + Entity Resolution (spec 2026-06-11)
-- FTS5 index over all record types + person resolution tables.
CREATE VIRTUAL TABLE IF NOT EXISTS intel_index USING fts5(
  entity_type UNINDEXED,
  entity_id UNINDEXED,
  label,
  body,
  identifiers,
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TABLE IF NOT EXISTS intel_index_state (
  entity_type TEXT PRIMARY KEY,
  last_synced_at TEXT,
  row_count INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS entity_resolution_suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_a INTEGER NOT NULL,
  person_b INTEGER NOT NULL,
  score REAL NOT NULL,
  reasons TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending',
  decided_by INTEGER,
  decided_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE (person_a, person_b)
);
CREATE INDEX IF NOT EXISTS idx_ers_status ON entity_resolution_suggestions(status);

CREATE TABLE IF NOT EXISTS person_canonical (
  person_id INTEGER PRIMARY KEY,
  canonical_person_id INTEGER NOT NULL,
  confirmed_by INTEGER,
  confirmed_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pc_canonical ON person_canonical(canonical_person_id);
```

- [ ] **Step 2: Apply locally and verify**

Run: `npm run migrate:local`
Expected: 0098 applies cleanly. Then `npx wrangler d1 execute rmpg-flex --local --command "SELECT name FROM sqlite_master WHERE name LIKE 'intel%' OR name LIKE 'entity_res%' OR name='person_canonical'"` lists intel_index (+fts5 shadow tables), intel_index_state, entity_resolution_suggestions, person_canonical.

- [ ] **Step 3: Commit**

```bash
git add migrations/0098_intel_search.sql
git commit -m "feat(intel): migration 0098 — FTS index + entity resolution tables"
```

> Post-merge ops note (NOT a code step): per CLAUDE.md rule 5, also apply this DDL directly to live D1 `785de7ae` via the Cloudflare D1 API and verify with sqlite_master, because deploy-time migration apply is continue-on-error.

---

### Task 2: Pure matching helpers — `src/utils/intelMatch.ts`

**Files:**
- Create: `src/utils/intelMatch.ts`

No Worker test harness exists (typecheck only); write these as pure, dependency-free functions.

- [ ] **Step 1: Implement helpers**

```ts
// src/utils/intelMatch.ts
// Pure helpers for Intel Search: identifier sniffing, normalization,
// name similarity. No D1 / Hono imports — testable standalone.

export type IdentifierKind = 'plate' | 'phone' | 'dob' | 'record_number' | 'vin';

export interface SniffedIdentifier { kind: IdentifierKind; value: string }

// Live text columns store literal "None"/"N/A"/"0" instead of NULL.
export function isRealValue(v: unknown): boolean {
  if (v == null) return false;
  const s = String(v).trim();
  return s !== '' && !['none', 'n/a', 'na', 'null', '0', 'unknown'].includes(s.toLowerCase());
}

export function normalizePhone(v: string): string {
  const d = v.replace(/\D/g, '');
  return d.length === 11 && d.startsWith('1') ? d.slice(1) : d;
}

export function normalizeAddress(v: string): string {
  return v.toLowerCase()
    .replace(/[.,#]/g, ' ')
    .replace(/\b(street|str)\b/g, 'st').replace(/\bavenue\b/g, 'ave')
    .replace(/\bdrive\b/g, 'dr').replace(/\bboulevard\b/g, 'blvd')
    .replace(/\broad\b/g, 'rd').replace(/\blane\b/g, 'ln')
    .replace(/\b(apartment|apt|unit|suite|ste)\b\s*\S*/g, '')
    .replace(/\s+/g, ' ').trim();
}

export function normalizeName(v: string): string {
  return v.toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();
}

// Token-overlap name similarity in [0,1]; order-insensitive, handles
// middle names. "john a smith" vs "smith john" -> 1.0 on shared tokens.
export function nameSimilarity(a: string, b: string): number {
  const ta = new Set(normalizeName(a).split(' ').filter(Boolean));
  const tb = new Set(normalizeName(b).split(' ').filter(Boolean));
  if (!ta.size || !tb.size) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / Math.min(ta.size, tb.size);
}

// Detect what the user typed so exact identifier hits rank first.
export function sniffIdentifiers(q: string): SniffedIdentifier[] {
  const out: SniffedIdentifier[] = [];
  const t = q.trim();
  const digits = t.replace(/\D/g, '');
  if (digits.length === 10 || digits.length === 11) out.push({ kind: 'phone', value: normalizePhone(t) });
  if (/^\d{4}-\d{2}-\d{2}$/.test(t) || /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(t)) {
    const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    out.push({ kind: 'dob', value: m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : t });
  }
  if (/^[A-Z0-9]{17}$/i.test(t)) out.push({ kind: 'vin', value: t.toUpperCase() });
  else if (/^[A-Z0-9]{2,8}$/i.test(t) && /\d/.test(t)) out.push({ kind: 'plate', value: t.toUpperCase() });
  if (/^(CFS|CASE|INC|W|CIT|FI|TO)[-#]?\d+/i.test(t) || /^\d{2,4}-\d{3,}$/.test(t)) {
    out.push({ kind: 'record_number', value: t.toUpperCase() });
  }
  return out;
}

// Escape a user query for FTS5 MATCH: quote each token, add prefix-* to
// the last token for type-ahead. Returns null when nothing searchable.
export function toFtsQuery(q: string): string | null {
  const tokens = q.trim().replace(/['"^*()]/g, ' ').split(/\s+/).filter(Boolean);
  if (!tokens.length) return null;
  return tokens.map((t, i) => (i === tokens.length - 1 ? `"${t}"*` : `"${t}"`)).join(' ');
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck` — Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/utils/intelMatch.ts
git commit -m "feat(intel): pure matching helpers (identifier sniffing, normalization, name similarity)"
```

---

### Task 3: Indexer + resolution pass — `src/utils/intelIndexer.ts`

**Files:**
- Create: `src/utils/intelIndexer.ts`

- [ ] **Step 1: Implement the indexer**

Full re-sync per type (dataset ~6 MB; deltas not worth the complexity — YAGNI). Each type isolated in try/catch so one bad table never breaks the rest. Uses `query`/`execute` from `src/utils/db.ts`.

```ts
// src/utils/intelIndexer.ts
// Rebuilds the intel_index FTS5 table + computes person-resolution
// suggestions. Called from the Worker scheduled() cron and from
// POST /api/intel/reindex. Every entity type is try/catch-isolated.
import type { D1Database } from '@cloudflare/workers-types';
import { query, execute } from './db';
import { isRealValue, normalizePhone, normalizeAddress, nameSimilarity } from './intelMatch';

interface IndexRow { type: string; id: number; label: string; body: string; identifiers: string }

const joinReal = (...vals: unknown[]) => vals.filter(isRealValue).map(String).join(' ');

async function rowsFor(db: D1Database, type: string): Promise<IndexRow[]> {
  switch (type) {
    case 'person':
      return (await query<any>(db, 'SELECT id, first_name, last_name, dob, address, city, phone, flags FROM persons')).map((p) => ({
        type, id: p.id,
        label: joinReal(p.first_name, p.last_name) || `Person #${p.id}`,
        body: joinReal(p.address, p.city, p.flags),
        identifiers: joinReal(p.dob, isRealValue(p.phone) ? normalizePhone(p.phone) : null),
      }));
    case 'vehicle':
      return (await query<any>(db, 'SELECT id, plate_number, vin, make, model, year, color FROM vehicles_records')).map((v) => ({
        type, id: v.id,
        label: joinReal(v.color, v.year, v.make, v.model) || `Vehicle #${v.id}`,
        body: '',
        identifiers: joinReal(v.plate_number, v.vin),
      }));
    case 'property':
      return (await query<any>(db, 'SELECT id, name, address, property_type FROM properties')).map((p) => ({
        type, id: p.id, label: joinReal(p.name) || `Property #${p.id}`,
        body: joinReal(p.address, p.property_type), identifiers: '',
      }));
    case 'case':
      return (await query<any>(db, 'SELECT id, case_number, title, case_type, status FROM cases')).map((r) => ({
        type, id: r.id, label: joinReal(r.case_number, r.title) || `Case #${r.id}`,
        body: joinReal(r.case_type, r.status), identifiers: joinReal(r.case_number),
      }));
    case 'incident':
      return (await query<any>(db, 'SELECT id, incident_number, incident_type, status, location_address FROM incidents')).map((r) => ({
        type, id: r.id, label: joinReal(r.incident_number, r.incident_type) || `Incident #${r.id}`,
        body: joinReal(r.status, r.location_address), identifiers: joinReal(r.incident_number),
      }));
    case 'call':
      return (await query<any>(db, 'SELECT id, call_number, incident_type, status, location_address FROM calls_for_service')).map((r) => ({
        type, id: r.id, label: joinReal(r.call_number, r.incident_type) || `CFS-${r.id}`,
        body: joinReal(r.status, r.location_address), identifiers: joinReal(r.call_number),
      }));
    case 'warrant':
      return (await query<any>(db, 'SELECT id, warrant_number, status, type, charge_description FROM warrants')).map((r) => ({
        type, id: r.id, label: joinReal(r.warrant_number) || `Warrant #${r.id}`,
        body: joinReal(r.status, r.type, r.charge_description), identifiers: joinReal(r.warrant_number),
      }));
    case 'citation':
      return (await query<any>(db, 'SELECT id, citation_number, type, status, violation_description FROM citations')).map((r) => ({
        type, id: r.id, label: joinReal(r.citation_number) || `Citation #${r.id}`,
        body: joinReal(r.type, r.status, r.violation_description), identifiers: joinReal(r.citation_number),
      }));
    case 'field_interview':
      return (await query<any>(db, 'SELECT id, fi_number, location, contact_reason FROM field_interviews')).map((r) => ({
        type, id: r.id, label: joinReal(r.fi_number) || `FI #${r.id}`,
        body: joinReal(r.location, r.contact_reason), identifiers: joinReal(r.fi_number),
      }));
    case 'trespass_order':
      return (await query<any>(db, 'SELECT id, order_number, location, status FROM trespass_orders')).map((r) => ({
        type, id: r.id, label: joinReal(r.order_number) || `Trespass #${r.id}`,
        body: joinReal(r.location, r.status), identifiers: joinReal(r.order_number),
      }));
    case 'evidence':
      return (await query<any>(db, 'SELECT id, evidence_number, description, evidence_type, status FROM evidence')).map((r) => ({
        type, id: r.id, label: joinReal(r.evidence_number) || `Evidence #${r.id}`,
        body: joinReal(r.description, r.evidence_type, r.status), identifiers: joinReal(r.evidence_number),
      }));
    default: return [];
  }
}

export const INTEL_TYPES = ['person', 'vehicle', 'property', 'case', 'incident', 'call',
  'warrant', 'citation', 'field_interview', 'trespass_order', 'evidence'] as const;

export async function rebuildIntelIndex(db: D1Database): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const type of INTEL_TYPES) {
    try {
      const rows = await rowsFor(db, type);
      await execute(db, 'DELETE FROM intel_index WHERE entity_type = ?', type);
      // D1 batch keeps this under the subrequest budget vs per-row prepare().run()
      const stmt = (db as any).prepare(
        'INSERT INTO intel_index (entity_type, entity_id, label, body, identifiers) VALUES (?, ?, ?, ?, ?)');
      for (let i = 0; i < rows.length; i += 50) {
        await (db as any).batch(rows.slice(i, i + 50).map((r) =>
          stmt.bind(r.type, r.id, r.label, r.body, r.identifiers)));
      }
      await execute(db,
        `INSERT INTO intel_index_state (entity_type, last_synced_at, row_count) VALUES (?, datetime('now'), ?)
         ON CONFLICT(entity_type) DO UPDATE SET last_synced_at = datetime('now'), row_count = excluded.row_count`,
        type, rows.length);
      counts[type] = rows.length;
    } catch (err: any) {
      console.error(`[intel-index] ${type} sync failed:`, err?.message);
      counts[type] = -1;
    }
  }
  return counts;
}

// Candidate "possible same person" pairs. Blocking keys (DOB, phone,
// address, shared vehicle) keep this O(groups) not O(n^2).
export async function computeResolutionSuggestions(db: D1Database): Promise<number> {
  const persons = await query<any>(db, 'SELECT id, first_name, last_name, dob, address, phone FROM persons');
  const pairs = new Map<string, { a: number; b: number; score: number; reasons: { rule: string; detail: string }[] }>();
  const addPair = (a: number, b: number, score: number, rule: string, detail: string) => {
    const [lo, hi] = a < b ? [a, b] : [b, a];
    const key = `${lo}:${hi}`;
    const e = pairs.get(key) || { a: lo, b: hi, score: 0, reasons: [] };
    e.score = Math.min(1, e.score + score);
    e.reasons.push({ rule, detail });
    pairs.set(key, e);
  };
  const byKey = (keyOf: (p: any) => string | null) => {
    const groups = new Map<string, any[]>();
    for (const p of persons) {
      const k = keyOf(p);
      if (k) groups.set(k, [...(groups.get(k) || []), p]);
    }
    return groups;
  };
  const fullName = (p: any) => joinReal(p.first_name, p.last_name);

  for (const [dob, group] of byKey((p) => (isRealValue(p.dob) ? String(p.dob) : null)))
    for (let i = 0; i < group.length; i++)
      for (let j = i + 1; j < group.length; j++) {
        const sim = nameSimilarity(fullName(group[i]), fullName(group[j]));
        if (sim >= 0.5) addPair(group[i].id, group[j].id, 0.5 + sim * 0.3, 'dob_name', `same DOB ${dob}, name sim ${sim.toFixed(2)}`);
      }
  for (const [, group] of byKey((p) => (isRealValue(p.phone) ? normalizePhone(String(p.phone)) : null)))
    for (let i = 0; i < group.length; i++)
      for (let j = i + 1; j < group.length; j++)
        addPair(group[i].id, group[j].id, 0.35, 'shared_phone', 'same phone number');
  for (const [, group] of byKey((p) => (isRealValue(p.address) ? normalizeAddress(String(p.address)) : null)))
    for (let i = 0; i < group.length; i++)
      for (let j = i + 1; j < group.length; j++) {
        const sim = nameSimilarity(fullName(group[i]), fullName(group[j]));
        if (sim >= 0.5) addPair(group[i].id, group[j].id, 0.2, 'shared_address', 'same address + similar name');
      }

  let written = 0;
  for (const { a, b, score, reasons } of pairs.values()) {
    if (score < 0.35) continue;
    // Never downgrade a human decision: only insert-or-refresh pending rows.
    await execute(db,
      `INSERT INTO entity_resolution_suggestions (person_a, person_b, score, reasons)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(person_a, person_b) DO UPDATE SET
         score = excluded.score, reasons = excluded.reasons
       WHERE entity_resolution_suggestions.status = 'pending'`,
      a, b, score, JSON.stringify(reasons));
    written++;
  }
  return written;
}
```

- [ ] **Step 2: Typecheck** — `npm run typecheck`, expected PASS.
- [ ] **Step 3: Commit** — `git add src/utils/intelIndexer.ts && git commit -m "feat(intel): FTS indexer + person resolution pass"`

---

### Task 4: API routes — `src/routes/intel.ts` + registry + cron hook

**Files:**
- Create: `src/routes/intel.ts`
- Modify: `src/routesConfig.ts` (add registry entry near the `/api/connections` entry, ~line 313)
- Modify: `src/index.ts` `scheduled()` handler (~line 319) — add intel sync alongside existing cron jobs

- [ ] **Step 1: Implement the route file**

```ts
// src/routes/intel.ts — Intel Search + Entity Resolution API.
// Federated ranked search over intel_index (FTS5) with identifier
// sniffing and per-type LIKE fallback; supervisor-gated resolution
// confirm/reject. Spec: docs/superpowers/specs/2026-06-11-*.md
import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';
import { requireRole } from '../middleware/auth';
import { sniffIdentifiers, toFtsQuery, isRealValue } from '../utils/intelMatch';
import { rebuildIntelIndex, computeResolutionSuggestions, INTEL_TYPES } from '../utils/intelIndexer';

const intel = new Hono<Env>();
const operational = requireRole(['admin', 'manager', 'supervisor', 'officer', 'dispatcher']);
const supervisorPlus = requireRole(['admin', 'manager', 'supervisor']);

interface IntelHit {
  type: string; id: number; label: string; snippet: string;
  flags: string[]; score: number;
  cluster?: { canonical_person_id: number | null; pending_suggestions: number };
}

async function personFlags(db: any, ids: number[]): Promise<Map<number, string[]>> {
  const out = new Map<number, string[]>();
  if (!ids.length) return out;
  const ph = ids.map(() => '?').join(',');
  try {
    for (const w of await query<any>(db,
      `SELECT COALESCE(subject_person_id, person_id) AS pid FROM warrants
       WHERE status IN ('active','outstanding') AND COALESCE(subject_person_id, person_id) IN (${ph})`, ...ids))
      out.set(w.pid, [...(out.get(w.pid) || []), 'ACTIVE WARRANT']);
  } catch (err: any) { console.error('[intel] warrant flags failed:', err?.message); }
  try {
    for (const p of await query<any>(db, `SELECT id, flags FROM persons WHERE id IN (${ph})`, ...ids)) {
      const f = isRealValue(p.flags) ? String(p.flags).toLowerCase() : '';
      if (f.includes('officer safety') || f.includes('violent')) out.set(p.id, [...(out.get(p.id) || []), 'OFFICER SAFETY']);
      if (f.includes('gang')) out.set(p.id, [...(out.get(p.id) || []), 'GANG']);
    }
  } catch (err: any) { console.error('[intel] person flags failed:', err?.message); }
  return out;
}

// GET /search?q=&types=person,vehicle&limit=40
intel.get('/search', operational, async (c) => {
  const q = (c.req.query('q') || '').trim();
  if (q.length < 2) return c.json({ query: q, results: [] });
  const db = getDb(c.env);
  const typeFilter = (c.req.query('types') || '').split(',').filter((t) => (INTEL_TYPES as readonly string[]).includes(t));
  const limit = Math.min(parseInt(c.req.query('limit') || '40', 10) || 40, 100);
  const hits = new Map<string, IntelHit>(); // "type:id" → best hit

  // 1) Identifier exact hits (highest rank)
  for (const ident of sniffIdentifiers(q)) {
    try {
      for (const r of await query<any>(db,
        `SELECT entity_type, entity_id, label, identifiers FROM intel_index
         WHERE identifiers LIKE ? LIMIT 20`, `%${ident.value}%`)) {
        hits.set(`${r.entity_type}:${r.entity_id}`, {
          type: r.entity_type, id: Number(r.entity_id), label: r.label,
          snippet: r.identifiers, flags: [], score: 100,
        });
      }
    } catch (err: any) { console.error('[intel] identifier search failed:', err?.message); }
  }

  // 2) FTS bm25
  const fts = toFtsQuery(q);
  if (fts) {
    try {
      for (const r of await query<any>(db,
        `SELECT entity_type, entity_id, label,
                snippet(intel_index, 3, '[', ']', '…', 12) AS snip,
                bm25(intel_index) AS rank
         FROM intel_index WHERE intel_index MATCH ? ORDER BY rank LIMIT ?`, fts, limit)) {
        const key = `${r.entity_type}:${r.entity_id}`;
        if (!hits.has(key)) hits.set(key, {
          type: r.entity_type, id: Number(r.entity_id), label: r.label,
          snippet: r.snip || '', flags: [], score: 50 - Number(r.rank),
        });
      }
    } catch (err: any) {
      console.error('[intel] FTS failed, falling back to LIKE:', err?.message);
      // 3) LIKE fallback — keeps search alive if intel_index missing on live
      const term = `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
      try {
        for (const p of await query<any>(db,
          `SELECT id, first_name, last_name FROM persons
           WHERE (first_name || ' ' || last_name) LIKE ? ESCAPE '\\' LIMIT 10`, term))
          hits.set(`person:${p.id}`, { type: 'person', id: p.id, label: `${p.first_name} ${p.last_name}`, snippet: '', flags: [], score: 10 });
      } catch (e: any) { console.error('[intel] LIKE fallback failed:', e?.message); }
    }
  }

  let results = [...hits.values()];
  if (typeFilter.length) results = results.filter((r) => typeFilter.includes(r.type));
  results.sort((a, b) => b.score - a.score);
  results = results.slice(0, limit);

  // Person enrichment: hot flags + resolution cluster info
  const personIds = results.filter((r) => r.type === 'person').map((r) => r.id);
  if (personIds.length) {
    const flags = await personFlags(db, personIds);
    const ph = personIds.map(() => '?').join(',');
    const canon = new Map<number, number>();
    const pending = new Map<number, number>();
    try {
      for (const r of await query<any>(db,
        `SELECT person_id, canonical_person_id FROM person_canonical WHERE person_id IN (${ph})`, ...personIds))
        canon.set(r.person_id, r.canonical_person_id);
      for (const r of await query<any>(db,
        `SELECT person_a AS pid, COUNT(*) AS n FROM entity_resolution_suggestions
         WHERE status = 'pending' AND person_a IN (${ph}) GROUP BY person_a`, ...personIds))
        pending.set(r.pid, r.n);
      for (const r of await query<any>(db,
        `SELECT person_b AS pid, COUNT(*) AS n FROM entity_resolution_suggestions
         WHERE status = 'pending' AND person_b IN (${ph}) GROUP BY person_b`, ...personIds))
        pending.set(r.pid, (pending.get(r.pid) || 0) + r.n);
    } catch (err: any) { console.error('[intel] cluster enrich failed:', err?.message); }
    for (const r of results) {
      if (r.type !== 'person') continue;
      r.flags = flags.get(r.id) || [];
      r.cluster = { canonical_person_id: canon.get(r.id) ?? null, pending_suggestions: pending.get(r.id) || 0 };
    }
  }

  return c.json({ query: q, results });
});

// GET /health — index freshness for diagnosis
intel.get('/health', operational, async (c) => {
  const db = getDb(c.env);
  try {
    return c.json({ index: await query<any>(db, 'SELECT * FROM intel_index_state ORDER BY entity_type') });
  } catch (err: any) {
    return c.json({ index: [], error: err?.message, hint: 'migration 0098 may not have reached live D1' });
  }
});

// POST /reindex — full rebuild (admin only)
intel.post('/reindex', requireRole(['admin']), async (c) => {
  const db = getDb(c.env);
  const counts = await rebuildIntelIndex(db);
  const suggestions = await computeResolutionSuggestions(db);
  return c.json({ success: true, counts, suggestions });
});

// ─── Resolution ──────────────────────────────────────────────
intel.get('/resolution/suggestions', supervisorPlus, async (c) => {
  const db = getDb(c.env);
  const status = c.req.query('status') || 'pending';
  const rows = await query<any>(db,
    `SELECT s.*, pa.first_name AS a_first, pa.last_name AS a_last, pa.dob AS a_dob,
            pb.first_name AS b_first, pb.last_name AS b_last, pb.dob AS b_dob
     FROM entity_resolution_suggestions s
     JOIN persons pa ON pa.id = s.person_a
     JOIN persons pb ON pb.id = s.person_b
     WHERE s.status = ? ORDER BY s.score DESC LIMIT 100`, status);
  return c.json(rows);
});

intel.post('/resolution/suggestions/:id/confirm', supervisorPlus, async (c) => {
  const db = getDb(c.env);
  const id = Number(c.req.param('id'));
  const userId = c.get('userId') as number;
  const body = await c.req.json().catch(() => ({}));
  const s = await queryFirst<any>(db, 'SELECT * FROM entity_resolution_suggestions WHERE id = ?', id);
  if (!s) return c.json({ error: 'Suggestion not found' }, 404);
  const canonical = Number(body?.canonical_person_id) === s.person_b ? s.person_b : s.person_a;
  const alias = canonical === s.person_a ? s.person_b : s.person_a;
  await execute(db,
    `INSERT OR REPLACE INTO person_canonical (person_id, canonical_person_id, confirmed_by) VALUES (?, ?, ?)`,
    alias, canonical, userId);
  await execute(db,
    `UPDATE entity_resolution_suggestions SET status = 'confirmed', decided_by = ?, decided_at = datetime('now') WHERE id = ?`,
    userId, id);
  return c.json({ success: true, canonical_person_id: canonical, alias_person_id: alias });
});

intel.post('/resolution/suggestions/:id/reject', supervisorPlus, async (c) => {
  const db = getDb(c.env);
  const id = Number(c.req.param('id'));
  const userId = c.get('userId') as number;
  const r = await execute(db,
    `UPDATE entity_resolution_suggestions SET status = 'rejected', decided_by = ?, decided_at = datetime('now') WHERE id = ?`,
    userId, id);
  return (r as any).meta?.changes ? c.json({ success: true }) : c.json({ error: 'Suggestion not found' }, 404);
});

intel.delete('/resolution/canonical/:personId', supervisorPlus, async (c) => {
  const db = getDb(c.env);
  await execute(db, 'DELETE FROM person_canonical WHERE person_id = ?', Number(c.req.param('personId')));
  return c.json({ success: true });
});

export default intel;
```

- [ ] **Step 2: Register in routesConfig.ts**

Next to the `/api/connections` entry (~line 313):

```ts
import intel from './routes/intel';
// ...
  { prefix: '/api/intel', router: intel, auth: 'required' },
```

(Match the exact entry-object shape used by neighbors — copy the connections line and adjust.)

- [ ] **Step 3: Hook the cron**

In `src/index.ts` `scheduled()` (~line 319), alongside the existing fire-and-forget jobs (email, warrant scan), add:

```ts
ctx.waitUntil(
  import('./utils/intelIndexer').then(async ({ rebuildIntelIndex, computeResolutionSuggestions }) => {
    const db = env.DB;
    await rebuildIntelIndex(db as any);
    await computeResolutionSuggestions(db as any);
  }).catch((err) => console.error('[intel-index] cron failed:', err)),
);
```

Match the surrounding pattern exactly (some jobs gate on cron name — if `event.cron` switching exists, attach intel to the least-frequent schedule).

- [ ] **Step 4: Typecheck + local smoke**

Run: `npm run typecheck` — PASS.
Run: `npm run dev` then (with a valid local JWT or by temporarily checking via the health route): `curl http://localhost:8787/` returns the root probe. If local D1 has data: login and hit `/api/intel/reindex` then `/api/intel/search?q=smith`.

- [ ] **Step 5: Commit**

```bash
git add src/routes/intel.ts src/routesConfig.ts src/index.ts
git commit -m "feat(intel): federated search + resolution API, cron index sync"
```

---

### Task 5: Client — IntelSearchPage

**Files:**
- Create: `client/src/pages/IntelSearchPage.tsx`
- Create: `client/src/pages/__tests__/IntelSearchPage.test.tsx`
- Modify: `client/src/App.tsx` (or wherever routes are declared — grep `ConnectionsPage` and mirror it) — add `/intel` route
- Modify: `client/src/components/Layout.tsx` — add nav entry next to Connections

- [ ] **Step 1: Write failing test**

```tsx
// client/src/pages/__tests__/IntelSearchPage.test.tsx
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import IntelSearchPage from '../IntelSearchPage';

vi.mock('../../hooks/useApi', () => ({
  apiFetch: vi.fn(async (path: string) => {
    if (path.includes('/intel/search')) return {
      query: 'smith',
      results: [
        { type: 'person', id: 1, label: 'John Smith', snippet: '', flags: ['ACTIVE WARRANT'], score: 90,
          cluster: { canonical_person_id: null, pending_suggestions: 2 } },
        { type: 'vehicle', id: 7, label: 'Red Ford F-150 (ABC123)', snippet: 'ABC123', flags: [], score: 40 },
      ],
    };
    return [];
  }),
}));

describe('IntelSearchPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders grouped results with flags after typing a query', async () => {
    render(<MemoryRouter><IntelSearchPage /></MemoryRouter>);
    fireEvent.change(screen.getByPlaceholderText(/search persons, vehicles/i), { target: { value: 'smith' } });
    await waitFor(() => expect(screen.getByText('John Smith')).toBeInTheDocument());
    expect(screen.getByText('ACTIVE WARRANT')).toBeInTheDocument();
    expect(screen.getByText(/Red Ford F-150/)).toBeInTheDocument();
    expect(screen.getByText(/2 possible match/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd client && npx vitest run src/pages/__tests__/IntelSearchPage.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the page**

Follow project patterns: `PanelTitleBar`, surface tokens (#0a0a0a/#141414), 2px radius, dense 11px rows, gold #d4a017 accents, no pills. Structure:

```tsx
// client/src/pages/IntelSearchPage.tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';

interface IntelHit {
  type: string; id: number; label: string; snippet: string;
  flags: string[]; score: number;
  cluster?: { canonical_person_id: number | null; pending_suggestions: number };
}

const TYPE_LABELS: Record<string, string> = {
  person: 'PERSONS', vehicle: 'VEHICLES', property: 'PROPERTIES', case: 'CASES',
  incident: 'INCIDENTS', call: 'CALLS FOR SERVICE', warrant: 'WARRANTS',
  citation: 'CITATIONS', field_interview: 'FIELD INTERVIEWS',
  trespass_order: 'TRESPASS ORDERS', evidence: 'EVIDENCE',
};

// Where a result row navigates on click — mirrors record-page routes.
function recordPath(hit: IntelHit): string {
  switch (hit.type) {
    case 'person': return `/records?tab=persons&id=${hit.id}`;
    case 'vehicle': return `/records?tab=vehicles&id=${hit.id}`;
    case 'warrant': return `/warrants?id=${hit.id}`;
    case 'case': return `/cases?id=${hit.id}`;
    default: return `/connections?type=${hit.type}&id=${hit.id}`;
  }
}

export default function IntelSearchPage() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<IntelHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const navigate = useNavigate();
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    clearTimeout(debounceRef.current);
    if (q.trim().length < 2) { setResults([]); return; }
    debounceRef.current = setTimeout(() => {
      setLoading(true);
      apiFetch<{ results: IntelHit[] }>(`/intel/search?q=${encodeURIComponent(q)}`)
        .then((r) => setResults(r.results || []))
        .catch(console.error)
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(debounceRef.current);
  }, [q]);

  const grouped = useMemo(() => {
    const filtered = typeFilter ? results.filter((r) => r.type === typeFilter) : results;
    const g = new Map<string, IntelHit[]>();
    for (const r of filtered) g.set(r.type, [...(g.get(r.type) || []), r]);
    return g;
  }, [results, typeFilter]);

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="INTEL SEARCH" icon={Search} />
      <input
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search persons, vehicles, plates, phones, DOBs, case numbers…"
        className="w-full bg-[#050505] border border-[#222222] px-3 py-2 text-sm text-gray-200 focus:border-[#d4a017] outline-none"
      />
      <div className="flex gap-1 flex-wrap">
        {Object.entries(TYPE_LABELS).map(([t, label]) => (
          <button key={t}
            onClick={() => setTypeFilter(typeFilter === t ? null : t)}
            className={`text-[9px] px-2 py-[3px] border ${typeFilter === t ? 'border-[#d4a017] text-[#d4a017]' : 'border-[#222222] text-[#888888]'}`}>
            {label}
          </button>
        ))}
      </div>
      {loading && <div className="text-[11px] text-[#888888]">Searching…</div>}
      {[...grouped.entries()].map(([type, hits]) => (
        <div key={type} className="bg-[#141414] border border-[#222222]">
          <div className="px-2 py-[3px] text-[9px] font-semibold text-[#d4a017] border-b border-[#1a1a1a]">
            {TYPE_LABELS[type] || type.toUpperCase()} ({hits.length})
          </div>
          {hits.map((h) => (
            <button key={`${h.type}:${h.id}`}
              onClick={() => navigate(recordPath(h))}
              className="w-full text-left px-2 py-[2px] text-[11px] text-gray-200 hover:bg-[#1a1a1a] flex items-center gap-2 border-b border-[#1a1a1a] last:border-b-0">
              <span className="flex-1">{h.label}</span>
              {h.snippet && <span className="text-[#888888] truncate max-w-[300px]">{h.snippet}</span>}
              {h.flags.map((f) => (
                <span key={f} className="text-[9px] font-semibold text-red-500">{f}</span>
              ))}
              {h.cluster && h.cluster.pending_suggestions > 0 && (
                <span className="text-[9px] text-[#d4a017]">
                  {h.cluster.pending_suggestions} possible match{h.cluster.pending_suggestions > 1 ? 'es' : ''}
                </span>
              )}
            </button>
          ))}
        </div>
      ))}
      {!loading && q.trim().length >= 2 && results.length === 0 && (
        <div className="text-[11px] text-[#888888]">No results.</div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `cd client && npx vitest run src/pages/__tests__/IntelSearchPage.test.tsx` — Expected: PASS.

- [ ] **Step 5: Wire route + nav**

In the router file (grep for `ConnectionsPage` to find it), add a lazy route for `/intel` → `IntelSearchPage`, mirroring the Connections entry exactly. In `Layout.tsx`, add an "Intel Search" nav item next to Connections (same icon pattern, `Search` from lucide).

- [ ] **Step 6: Typecheck + full client tests**

Run: `cd client && npx tsc --noEmit && npx vitest run` — Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add client/src/pages/IntelSearchPage.tsx client/src/pages/__tests__/IntelSearchPage.test.tsx client/src/App.tsx client/src/components/Layout.tsx
git commit -m "feat(intel): Intel Search page with grouped ranked results + flags"
```

---

### Task 6: Rewire GlobalSearch + resolution review UI

**Files:**
- Modify: `client/src/components/GlobalSearch.tsx` — point at `/intel/search`, render flags
- Create: `client/src/components/ResolutionReviewPanel.tsx` — supervisor confirm/reject list, embedded at the top of IntelSearchPage for supervisor+ roles
- Modify: `client/src/pages/IntelSearchPage.tsx` — mount the panel

- [ ] **Step 1: Read GlobalSearch.tsx, swap its data source**

Change its fetch to `apiFetch('/intel/search?q=…')` and map `{type,id,label,flags}` into its existing result-row rendering; append red flag text (same 9px style as Task 5). Keep its existing navigation behavior; reuse `recordPath` by exporting it from IntelSearchPage (`export function recordPath`).

- [ ] **Step 2: Implement ResolutionReviewPanel**

```tsx
// client/src/components/ResolutionReviewPanel.tsx
import { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../hooks/useApi';

interface Suggestion {
  id: number; person_a: number; person_b: number; score: number; reasons: string;
  a_first: string; a_last: string; a_dob: string | null;
  b_first: string; b_last: string; b_dob: string | null;
}

export default function ResolutionReviewPanel() {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const load = useCallback(() => {
    apiFetch<Suggestion[]>('/intel/resolution/suggestions?status=pending')
      .then(setSuggestions)
      .catch(() => setSuggestions([])); // 403 for non-supervisors → render nothing
  }, []);
  useEffect(load, [load]);

  const decide = async (id: number, action: 'confirm' | 'reject') => {
    await apiFetch(`/intel/resolution/suggestions/${id}/${action}`, { method: 'POST' }).catch(console.error);
    load();
  };

  if (!suggestions.length) return null;
  return (
    <div className="bg-[#141414] border border-[#d4a017]">
      <div className="px-2 py-[3px] text-[9px] font-semibold text-[#d4a017] border-b border-[#1a1a1a]">
        POSSIBLE DUPLICATE PERSONS ({suggestions.length})
      </div>
      {suggestions.map((s) => {
        let reasons: { rule: string; detail: string }[] = [];
        try { reasons = JSON.parse(s.reasons); } catch { /* malformed reasons render empty */ }
        return (
          <div key={s.id} className="px-2 py-[2px] text-[11px] text-gray-200 flex items-center gap-2 border-b border-[#1a1a1a] last:border-b-0">
            <span className="flex-1">
              {s.a_first} {s.a_last} {s.a_dob ? `(${s.a_dob})` : ''} ↔ {s.b_first} {s.b_last} {s.b_dob ? `(${s.b_dob})` : ''}
            </span>
            <span className="text-[9px] text-[#888888]">{reasons.map((r) => r.rule).join(', ')} · {(s.score * 100).toFixed(0)}%</span>
            <button onClick={() => decide(s.id, 'confirm')} className="text-[9px] text-[#d4a017] border border-[#222222] px-2 py-[1px]">SAME PERSON</button>
            <button onClick={() => decide(s.id, 'reject')} className="text-[9px] text-[#888888] border border-[#222222] px-2 py-[1px]">DIFFERENT</button>
          </div>
        );
      })}
    </div>
  );
}
```

Mount in IntelSearchPage directly under `PanelTitleBar`: `<ResolutionReviewPanel />`.

- [ ] **Step 3: Add a test for the panel**

```tsx
// client/src/components/__tests__/ResolutionReviewPanel.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import ResolutionReviewPanel from '../ResolutionReviewPanel';

vi.mock('../../hooks/useApi', () => ({
  apiFetch: vi.fn(async () => ([{
    id: 1, person_a: 1, person_b: 2, score: 0.8,
    reasons: '[{"rule":"dob_name","detail":"same DOB"}]',
    a_first: 'John', a_last: 'Smith', a_dob: '1990-01-01',
    b_first: 'Jon', b_last: 'Smith', b_dob: '1990-01-01',
  }])),
}));

describe('ResolutionReviewPanel', () => {
  it('renders pending suggestions with decide buttons', async () => {
    render(<ResolutionReviewPanel />);
    await waitFor(() => expect(screen.getByText(/POSSIBLE DUPLICATE PERSONS/)).toBeInTheDocument());
    expect(screen.getByText('SAME PERSON')).toBeInTheDocument();
    expect(screen.getByText('DIFFERENT')).toBeInTheDocument();
  });
});
```

Run: `cd client && npx vitest run` — Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/GlobalSearch.tsx client/src/components/ResolutionReviewPanel.tsx client/src/components/__tests__/ResolutionReviewPanel.test.tsx client/src/pages/IntelSearchPage.tsx
git commit -m "feat(intel): rewire GlobalSearch to intel API + supervisor resolution review panel"
```

---

### Task 7: Ship checks

**Files:**
- Modify: `client/public/sw.js` — bump `CACHE_NAME` version (required on every client change)

- [ ] **Step 1: Bump SW cache** — increment the `CACHE_NAME` version in `client/public/sw.js`, commit with message `chore: bump SW cache for intel search`.
- [ ] **Step 2: Full verification**

```bash
npm run typecheck && cd client && npx tsc --noEmit && npx vitest run && npx vite build
```
Expected: all PASS, build succeeds.

- [ ] **Step 3: Push branch + open PR** to `main` describing: migration 0098 (with reminder to apply directly to live D1 post-merge), new `/api/intel` surface, `/intel` page, GlobalSearch rewire, cron index sync.

---

## Deviations from spec

The spec listed `arrests`, `businesses`, and `serve_jobs` among indexable types. This plan covers the 11 types whose live columns are verified via connections.ts; the other three are a fast follow once their live schemas are checked with `pragma_table_info` (adding a type = one `case` in `rowsFor`).

## Post-merge ops checklist (human/agent with Cloudflare access)

1. Apply 0098 DDL directly to live D1 `785de7ae` via the D1 API; verify with `SELECT name FROM sqlite_master WHERE name LIKE 'intel%'`.
2. Hit `POST /api/intel/reindex` as admin (browser session — WAF blocks curl) to seed the index without waiting for cron.
3. Verify `/api/intel/health` shows row counts and `/intel` returns results in the browser.
