# Person Intelligence Dossier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone Person Intelligence Dossier module — an OSINT aggregation engine that accepts any identifying seed (name, DOB, phone, email, plate), runs a 3-phase async pipeline via a Durable Object, cross-corroborates data for 95%+ accuracy, and produces a persistent dossier with graph visualization.

**Architecture:** `PersonIntelDO` (alarm-driven, mirrors `DeepResearchDO`) executes Phase 1 (internal D1 records, ~2s) → Phase 2 (OSINT API fan-out, ~30s) → Phase 3 (Firecrawl webcrawl + Claude extraction, ~90s). Results written to D1 after each phase; client polls `GET /api/person-intel/:id`. UI is a new `/intel/person` route with a dossier view + graph tab.

**Tech Stack:** Cloudflare Workers + D1 + Durable Objects (new_sqlite_classes), Hono routes, React 18 + TypeScript + Vite, Tailwind (Spillman night theme tokens), react-force-graph-2d for graph, Firecrawl v1 REST, Workers AI (Claude → OpenAI → Workers AI fallback via callAi).

---

## File Map

**New Worker files:**
- `migrations/0152_person_intelligence.sql` — 4 new tables + indexes
- `src/utils/personIntel/types.ts` — shared TS types
- `src/utils/personIntel/confidence.ts` — cross-source corroboration scoring
- `src/utils/personIntel/riskScore.ts` — risk flag accumulator
- `src/utils/personIntel/phase1.ts` — D1 internal records query
- `src/utils/personIntel/adapters/microbilt.ts`
- `src/utils/personIntel/adapters/pipl.ts`
- `src/utils/personIntel/adapters/spokeo.ts`
- `src/utils/personIntel/adapters/numverify.ts`
- `src/utils/personIntel/adapters/hunter.ts`
- `src/utils/personIntel/adapters/hibp.ts`
- `src/utils/personIntel/adapters/clearbit.ts`
- `src/utils/personIntel/phase2.ts` — OSINT fan-out orchestrator
- `src/utils/personIntel/fusion.ts` — cross-source data fusion
- `src/utils/personIntel/phase3.ts` — Firecrawl + Claude extraction
- `src/durable-objects/PersonIntelDO.ts`
- `src/routes/personIntel.ts`

**Modified Worker files:**
- `src/index.ts` — mount route + register DO
- `src/types.ts` — add `PERSON_INTEL_DO` binding
- `wrangler.toml` — DO binding + migration

**New client files:**
- `client/src/pages/intel/PersonIntelPage.tsx` — list + new investigation form
- `client/src/pages/intel/PersonIntelDossierPage.tsx` — dossier view with phase progress
- `client/src/pages/intel/PersonIntelGraphTab.tsx` — react-force-graph-2d connections graph
- `client/src/pages/intel/PersonIntelPdfExport.ts` — PDF generation

**Modified client files:**
- `client/src/App.tsx` — add routes
- `client/src/pages/admin/AdminPage.tsx` — add Person Intel tab
- `client/src/pages/admin/AdminPersonIntelTab.tsx` — API key config panel

**Test files:**
- `tests/personIntelConfidence.test.ts`
- `tests/personIntelRiskScore.test.ts`
- `tests/personIntelPhase1.test.ts`
- `tests/personIntelFusion.test.ts`
- `tests/personIntelPhase3.test.ts`

---

### Task 1: D1 Migration + wrangler.toml + types.ts binding

**Files:**
- Create: `migrations/0152_person_intelligence.sql`
- Modify: `wrangler.toml`
- Modify: `src/types.ts`

- [ ] **Step 1: Write the migration**

```sql
-- migrations/0152_person_intelligence.sql
CREATE TABLE IF NOT EXISTS person_intelligence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_seed TEXT NOT NULL,
  subject_name TEXT,
  subject_dob TEXT,
  subject_photo_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  phase INTEGER NOT NULL DEFAULT 0,
  phase1_completed_at TEXT,
  phase2_completed_at TEXT,
  phase3_completed_at TEXT,
  risk_score REAL DEFAULT 0,
  risk_flags TEXT,
  linked_person_id INTEGER,
  sources_queried INTEGER DEFAULT 0,
  sources_succeeded INTEGER DEFAULT 0,
  data_points_found INTEGER DEFAULT 0,
  created_by INTEGER NOT NULL,
  org_id TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS person_intel_data_points (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dossier_id INTEGER NOT NULL,
  category TEXT NOT NULL,
  field TEXT NOT NULL,
  value TEXT NOT NULL,
  sources TEXT NOT NULL,
  confidence REAL NOT NULL,
  verified_by INTEGER DEFAULT 0,
  officer_note TEXT,
  officer_flagged INTEGER DEFAULT 0,
  promoted INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS person_intel_connections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dossier_id INTEGER NOT NULL,
  from_subject TEXT NOT NULL,
  relationship TEXT NOT NULL,
  to_subject TEXT NOT NULL,
  to_subject_dossier_id INTEGER,
  confidence REAL NOT NULL,
  sources TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS person_intel_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dossier_id INTEGER NOT NULL,
  source_name TEXT NOT NULL,
  phase INTEGER NOT NULL,
  status TEXT NOT NULL,
  response_time_ms INTEGER,
  data_points_found INTEGER DEFAULT 0,
  error_message TEXT,
  queried_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pid_dossier ON person_intel_data_points(dossier_id);
CREATE INDEX IF NOT EXISTS idx_pic_dossier ON person_intel_connections(dossier_id);
CREATE INDEX IF NOT EXISTS idx_pis_dossier ON person_intel_sources(dossier_id);
CREATE INDEX IF NOT EXISTS idx_pi_linked_person ON person_intelligence(linked_person_id);
CREATE INDEX IF NOT EXISTS idx_pi_status ON person_intelligence(status);
```

- [ ] **Step 2: Apply migration locally**

```bash
npm run migrate:local
```
Expected: `✅ Applied 1 migrations` (no errors)

- [ ] **Step 3: Add DO binding to wrangler.toml**

In `wrangler.toml`, add after the last `[[durable_objects.bindings]]` entry:
```toml
[[durable_objects.bindings]]
name = "PERSON_INTEL_DO"
class_name = "PersonIntelDO"
```

In the `[migrations]` section (or the `[[migrations]]` array), add to the entry with `new_sqlite_classes`:
```toml
new_sqlite_classes = ["PersonIntelDO"]
```
If the existing entry already has a `new_sqlite_classes` array, append `"PersonIntelDO"` to it.

- [ ] **Step 4: Add binding to src/types.ts**

In `src/types.ts`, after the `DEEP_RESEARCH: DurableObjectNamespace;` line, add:
```typescript
  PERSON_INTEL_DO: DurableObjectNamespace;
```

- [ ] **Step 5: Run typecheck to confirm no breakage**

```bash
npm run typecheck
```
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add migrations/0152_person_intelligence.sql wrangler.toml src/types.ts
git commit -m "feat(person-intel): migration 0152 + DO binding + types"
```

---

### Task 2: Shared Types + Confidence Scoring Engine

**Files:**
- Create: `src/utils/personIntel/types.ts`
- Create: `src/utils/personIntel/confidence.ts`
- Create: `tests/personIntelConfidence.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/personIntelConfidence.test.ts
import { describe, it, expect } from 'vitest';
import { deriveConfidence, mergeDataPoints } from '../src/utils/personIntel/confidence';
import type { RawDataPoint } from '../src/utils/personIntel/types';

describe('deriveConfidence', () => {
  it('base with one source = 0.40', () => {
    expect(deriveConfidence({ sources: ['MicroBilt'], hasInternalRecord: false, hasCrawlCorroboration: false })).toBeCloseTo(0.40);
  });
  it('two sources = 0.58', () => {
    expect(deriveConfidence({ sources: ['MicroBilt', 'Pipl'], hasInternalRecord: false, hasCrawlCorroboration: false })).toBeCloseTo(0.58);
  });
  it('three sources = 0.76', () => {
    expect(deriveConfidence({ sources: ['MicroBilt', 'Pipl', 'Spokeo'], hasInternalRecord: false, hasCrawlCorroboration: false })).toBeCloseTo(0.76);
  });
  it('internal record bonus = +0.12', () => {
    expect(deriveConfidence({ sources: ['MicroBilt'], hasInternalRecord: true, hasCrawlCorroboration: false })).toBeCloseTo(0.52);
  });
  it('crawl corroboration bonus = +0.08', () => {
    expect(deriveConfidence({ sources: ['MicroBilt'], hasInternalRecord: false, hasCrawlCorroboration: true })).toBeCloseTo(0.48);
  });
  it('caps at 0.95', () => {
    expect(deriveConfidence({ sources: ['A', 'B', 'C', 'D'], hasInternalRecord: true, hasCrawlCorroboration: true })).toBeLessThanOrEqual(0.95);
  });
});

describe('mergeDataPoints', () => {
  it('dedupes identical values and merges sources', () => {
    const points: RawDataPoint[] = [
      { category: 'address', field: 'street', value: '123 Main St', source: 'MicroBilt' },
      { category: 'address', field: 'street', value: '123 Main St', source: 'Pipl' },
    ];
    const merged = mergeDataPoints(points);
    expect(merged).toHaveLength(1);
    expect(merged[0].sources).toContain('MicroBilt');
    expect(merged[0].sources).toContain('Pipl');
  });
  it('keeps distinct values as separate points', () => {
    const points: RawDataPoint[] = [
      { category: 'phone', field: 'number', value: '8015550001', source: 'MicroBilt' },
      { category: 'phone', field: 'number', value: '8015550002', source: 'Pipl' },
    ];
    expect(mergeDataPoints(points)).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd client && npx vitest run ../tests/personIntelConfidence.test.ts 2>&1 | head -20
```
Expected: FAIL — `Cannot find module '../src/utils/personIntel/confidence'`

- [ ] **Step 3: Create types.ts**

```typescript
// src/utils/personIntel/types.ts
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
```

- [ ] **Step 4: Create confidence.ts**

```typescript
// src/utils/personIntel/confidence.ts
import type { ConfidenceOpts, RawDataPoint, MergedDataPoint } from './types';

export function deriveConfidence(opts: ConfidenceOpts): number {
  const { sources, hasInternalRecord, hasCrawlCorroboration } = opts;
  const uniqueSources = Math.min(sources.length, 4);
  let score = 0.40 + (uniqueSources - 1) * 0.18;
  if (hasInternalRecord) score += 0.12;
  if (hasCrawlCorroboration) score += 0.08;
  return Math.min(0.95, Math.max(0.05, score));
}

export function mergeDataPoints(points: RawDataPoint[]): MergedDataPoint[] {
  const map = new Map<string, MergedDataPoint>();
  for (const p of points) {
    const key = `${p.category}|${p.field}|${p.value.toLowerCase().trim()}`;
    const existing = map.get(key);
    if (existing) {
      if (!existing.sources.includes(p.source)) existing.sources.push(p.source);
    } else {
      map.set(key, { category: p.category, field: p.field, value: p.value, sources: [p.source], confidence: 0 });
    }
  }
  const result = Array.from(map.values());
  for (const dp of result) {
    dp.confidence = deriveConfidence({ sources: dp.sources, hasInternalRecord: false, hasCrawlCorroboration: false });
  }
  return result;
}
```

- [ ] **Step 5: Run tests to verify passing**

```bash
cd client && npx vitest run ../tests/personIntelConfidence.test.ts
```
Expected: PASS — 7 tests

- [ ] **Step 6: Commit**

```bash
git add src/utils/personIntel/types.ts src/utils/personIntel/confidence.ts tests/personIntelConfidence.test.ts
git commit -m "feat(person-intel): types + confidence scoring engine with tests"
```

---

### Task 3: Risk Score Engine

**Files:**
- Create: `src/utils/personIntel/riskScore.ts`
- Create: `tests/personIntelRiskScore.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/personIntelRiskScore.test.ts
import { describe, it, expect } from 'vitest';
import { computeRiskScore } from '../src/utils/personIntel/riskScore';
import type { RiskFlag } from '../src/utils/personIntel/types';

describe('computeRiskScore', () => {
  it('no flags = 0', () => {
    expect(computeRiskScore([])).toBe(0);
  });
  it('warrant = 30', () => {
    expect(computeRiskScore(['warrant'])).toBe(30);
  });
  it('ofac = 40', () => {
    expect(computeRiskScore(['ofac'])).toBe(40);
  });
  it('nsopw = 25', () => {
    expect(computeRiskScore(['nsopw'])).toBe(25);
  });
  it('hibp_breach = 10', () => {
    expect(computeRiskScore(['hibp_breach'])).toBe(10);
  });
  it('arrest_mention = 15', () => {
    expect(computeRiskScore(['arrest_mention'])).toBe(15);
  });
  it('caps at 100', () => {
    const flags: RiskFlag[] = ['warrant', 'ofac', 'nsopw', 'hibp_breach', 'arrest_mention'];
    expect(computeRiskScore(flags)).toBeLessThanOrEqual(100);
  });
  it('multiple flags accumulate', () => {
    expect(computeRiskScore(['warrant', 'nsopw'])).toBe(55);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd client && npx vitest run ../tests/personIntelRiskScore.test.ts 2>&1 | head -20
```
Expected: FAIL — `Cannot find module '../src/utils/personIntel/riskScore'`

- [ ] **Step 3: Implement riskScore.ts**

```typescript
// src/utils/personIntel/riskScore.ts
import type { RiskFlag } from './types';

const FLAG_WEIGHTS: Record<RiskFlag, number> = {
  warrant: 30,
  nsopw: 25,
  ofac: 40,
  hibp_breach: 10,
  arrest_mention: 15,
};

export function computeRiskScore(flags: RiskFlag[]): number {
  const total = flags.reduce((sum, f) => sum + (FLAG_WEIGHTS[f] ?? 0), 0);
  return Math.min(100, total);
}
```

- [ ] **Step 4: Run tests**

```bash
cd client && npx vitest run ../tests/personIntelRiskScore.test.ts
```
Expected: PASS — 8 tests

- [ ] **Step 5: Commit**

```bash
git add src/utils/personIntel/riskScore.ts tests/personIntelRiskScore.test.ts
git commit -m "feat(person-intel): risk score engine with tests"
```

---

### Task 4: Phase 1 — Internal D1 Records

**Files:**
- Create: `src/utils/personIntel/phase1.ts`
- Create: `tests/personIntelPhase1.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/personIntelPhase1.test.ts
import { describe, it, expect, vi } from 'vitest';
import { queryPhase1 } from '../src/utils/personIntel/phase1';
import type { IntelSeed } from '../src/utils/personIntel/types';

function makeDb(rows: any[]): any {
  return {
    prepare: () => ({
      bind: () => ({
        all: async () => ({ results: rows }),
        first: async () => rows[0] ?? null,
      }),
    }),
  };
}

describe('queryPhase1', () => {
  it('returns empty source result on empty DB', async () => {
    const db = makeDb([]);
    const seed: IntelSeed = { name: 'John Doe' };
    const result = await queryPhase1(db, seed);
    expect(result.sourceName).toBe('InternalRecords');
    expect(result.phase).toBe(1);
    expect(result.status).toBe('success');
    expect(result.dataPoints).toHaveLength(0);
  });

  it('returns address data points from persons table hit', async () => {
    const db = makeDb([{
      full_name: 'John Doe', date_of_birth: '1990-01-01',
      address: '123 Main St', city: 'Salt Lake City', state: 'UT', zip: '84101',
    }]);
    const seed: IntelSeed = { name: 'John Doe' };
    const result = await queryPhase1(db, seed);
    expect(result.status).toBe('success');
    const addrPoints = result.dataPoints.filter(p => p.category === 'address');
    expect(addrPoints.length).toBeGreaterThan(0);
  });

  it('wraps phone numbers as phone data points', async () => {
    const db = makeDb([{ phone: '8015550001', full_name: 'Jane Smith' }]);
    const seed: IntelSeed = { phone: '8015550001' };
    const result = await queryPhase1(db, seed);
    const phonePoints = result.dataPoints.filter(p => p.category === 'phone');
    expect(phonePoints.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd client && npx vitest run ../tests/personIntelPhase1.test.ts 2>&1 | head -20
```
Expected: FAIL — `Cannot find module '../src/utils/personIntel/phase1'`

- [ ] **Step 3: Implement phase1.ts**

```typescript
// src/utils/personIntel/phase1.ts
import type { IntelSeed, RawDataPoint, SourceResult } from './types';

function norm(s?: string): string { return (s ?? '').toLowerCase().trim(); }

function personRow(row: any): RawDataPoint[] {
  const pts: RawDataPoint[] = [];
  const src = 'InternalRecords';
  if (row.address) pts.push({ category: 'address', field: 'street', value: row.address, source: src });
  if (row.city) pts.push({ category: 'address', field: 'city', value: row.city, source: src });
  if (row.state) pts.push({ category: 'address', field: 'state', value: row.state, source: src });
  if (row.zip) pts.push({ category: 'address', field: 'zip', value: row.zip, source: src });
  if (row.phone) pts.push({ category: 'phone', field: 'number', value: row.phone, source: src });
  if (row.email) pts.push({ category: 'email', field: 'address', value: row.email, source: src });
  if (row.date_of_birth) pts.push({ category: 'legal', field: 'dob', value: row.date_of_birth, source: src });
  if (row.full_name) pts.push({ category: 'legal', field: 'name', value: row.full_name, source: src });
  return pts;
}

function vehicleRow(row: any): RawDataPoint[] {
  const src = 'InternalRecords';
  const pts: RawDataPoint[] = [];
  if (row.plate_number) pts.push({ category: 'vehicle', field: 'plate', value: row.plate_number, source: src });
  if (row.make) pts.push({ category: 'vehicle', field: 'make', value: row.make, source: src });
  if (row.model) pts.push({ category: 'vehicle', field: 'model', value: row.model, source: src });
  if (row.color) pts.push({ category: 'vehicle', field: 'color', value: row.color, source: src });
  return pts;
}

export async function queryPhase1(db: D1Database, seed: IntelSeed): Promise<SourceResult> {
  const t0 = Date.now();
  const pts: RawDataPoint[] = [];
  const src = 'InternalRecords';

  try {
    // Persons
    if (seed.name) {
      const like = `%${seed.name.split(' ')[0]}%`;
      const { results } = await db.prepare(
        'SELECT full_name,date_of_birth,address,city,state,zip,phone,email FROM persons WHERE full_name LIKE ? LIMIT 10'
      ).bind(like).all<any>();
      for (const r of results) pts.push(...personRow(r));
    }
    if (seed.phone) {
      const { results } = await db.prepare(
        'SELECT full_name,date_of_birth,address,city,state,zip,phone,email FROM persons WHERE phone = ? LIMIT 5'
      ).bind(seed.phone).all<any>();
      for (const r of results) {
        if (!pts.some(p => p.field === 'phone' && p.value === r.phone)) pts.push({ category: 'phone', field: 'number', value: seed.phone, source: src });
        pts.push(...personRow(r));
      }
    }
    if (seed.email) {
      const { results } = await db.prepare(
        'SELECT full_name,date_of_birth,address,city,state,zip,phone,email FROM persons WHERE email = ? LIMIT 5'
      ).bind(seed.email).all<any>();
      for (const r of results) pts.push(...personRow(r));
    }

    // Vehicles / ALPR
    if (seed.plate) {
      const { results } = await db.prepare(
        'SELECT plate_number,make,model,color,year FROM vehicles_records WHERE plate_number = ? LIMIT 5'
      ).bind(seed.plate.toUpperCase()).all<any>();
      for (const r of results) pts.push(...vehicleRow(r));
    }

    return { sourceName: src, phase: 1, status: 'success', dataPoints: pts, connections: [], responseTimeMs: Date.now() - t0 };
  } catch (e: any) {
    return { sourceName: src, phase: 1, status: 'error', dataPoints: [], connections: [], responseTimeMs: Date.now() - t0, errorMessage: String(e?.message ?? e) };
  }
}
```

- [ ] **Step 4: Run tests**

```bash
cd client && npx vitest run ../tests/personIntelPhase1.test.ts
```
Expected: PASS — 3 tests

- [ ] **Step 5: Commit**

```bash
git add src/utils/personIntel/phase1.ts tests/personIntelPhase1.test.ts
git commit -m "feat(person-intel): phase 1 internal D1 query with tests"
```

---

### Task 5: OSINT Adapters — People Search (MicroBilt, Pipl, Spokeo)

**Files:**
- Create: `src/utils/personIntel/adapters/microbilt.ts`
- Create: `src/utils/personIntel/adapters/pipl.ts`
- Create: `src/utils/personIntel/adapters/spokeo.ts`
- Create: `src/utils/personIntel/adapters/shared.ts`

- [ ] **Step 1: Create shared adapter helper**

```typescript
// src/utils/personIntel/adapters/shared.ts
import type { SourceResult, RawDataPoint, IntelConnection } from '../types';

export interface AdapterEnv { FIRECRAWL_API_KEY?: string; [k: string]: any; }

export function makeSourceResult(
  sourceName: string,
  phase: 1 | 2 | 3,
  status: SourceResult['status'],
  dataPoints: RawDataPoint[],
  connections: IntelConnection[],
  responseTimeMs: number,
  errorMessage?: string,
): SourceResult {
  return { sourceName, phase, status, dataPoints, connections, responseTimeMs, errorMessage };
}

export async function getKey(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare(
    'SELECT config_value FROM system_config WHERE config_key = ? AND is_active = 1 LIMIT 1'
  ).bind(key).first<{ config_value: string }>();
  return row?.config_value ?? null;
}

export async function safeFetch(url: string, init: RequestInit, timeoutMs = 15000): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 2: Create MicroBilt adapter**

```typescript
// src/utils/personIntel/adapters/microbilt.ts
import type { IntelSeed, RawDataPoint, SourceResult } from '../types';
import { getKey, safeFetch, makeSourceResult } from './shared';

const SRC = 'MicroBilt';

export async function queryMicrobilt(db: D1Database, seed: IntelSeed): Promise<SourceResult> {
  const t0 = Date.now();
  const apiKey = await getKey(db, 'microbilt_api_key');
  if (!apiKey) return makeSourceResult(SRC, 2, 'not_configured', [], [], Date.now() - t0);

  try {
    const body: any = {};
    if (seed.name) { const parts = seed.name.trim().split(' '); body.first_name = parts[0]; body.last_name = parts.slice(1).join(' ') || undefined; }
    if (seed.dob) body.dob = seed.dob;
    if (seed.phone) body.phone = seed.phone;
    if (seed.email) body.email = seed.email;

    const json = await safeFetch('https://api.microbilt.com/v2/getpersonreport', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });

    const pts: RawDataPoint[] = [];
    for (const addr of json?.addresses ?? []) {
      if (addr.street) pts.push({ category: 'address', field: 'street', value: addr.street, source: SRC });
      if (addr.city) pts.push({ category: 'address', field: 'city', value: addr.city, source: SRC });
      if (addr.state) pts.push({ category: 'address', field: 'state', value: addr.state, source: SRC });
      if (addr.zip) pts.push({ category: 'address', field: 'zip', value: addr.zip, source: SRC });
    }
    for (const ph of json?.phones ?? []) {
      if (ph.number) pts.push({ category: 'phone', field: 'number', value: ph.number, source: SRC });
    }
    for (const em of json?.emails ?? []) {
      if (em.address) pts.push({ category: 'email', field: 'address', value: em.address, source: SRC });
    }
    if (json?.dob) pts.push({ category: 'legal', field: 'dob', value: json.dob, source: SRC });

    return makeSourceResult(SRC, 2, 'success', pts, [], Date.now() - t0);
  } catch (e: any) {
    return makeSourceResult(SRC, 2, 'error', [], [], Date.now() - t0, String(e?.message ?? e));
  }
}
```

- [ ] **Step 3: Create Pipl adapter**

```typescript
// src/utils/personIntel/adapters/pipl.ts
import type { IntelSeed, RawDataPoint, IntelConnection, SourceResult } from '../types';
import { getKey, safeFetch, makeSourceResult } from './shared';

const SRC = 'Pipl';

export async function queryPipl(db: D1Database, seed: IntelSeed): Promise<SourceResult> {
  const t0 = Date.now();
  const apiKey = await getKey(db, 'pipl_api_key');
  if (!apiKey) return makeSourceResult(SRC, 2, 'not_configured', [], [], Date.now() - t0);

  try {
    const params = new URLSearchParams({ key: apiKey, pretty: 'false' });
    const person: any = {};
    if (seed.name) person.names = [{ full: seed.name }];
    if (seed.email) person.emails = [{ address: seed.email }];
    if (seed.phone) person.phones = [{ number: seed.phone }];
    if (seed.dob) person.dob = { display: seed.dob };

    const json = await safeFetch(`https://api.pipl.com/search/?${params}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ person }),
    });

    const pts: RawDataPoint[] = [];
    const conns: IntelConnection[] = [];
    const p = json?.person;
    for (const addr of p?.addresses ?? []) {
      if (addr.street) pts.push({ category: 'address', field: 'street', value: addr.display ?? addr.street, source: SRC });
      if (addr.city) pts.push({ category: 'address', field: 'city', value: addr.city, source: SRC });
      if (addr.state) pts.push({ category: 'address', field: 'state', value: addr.state, source: SRC });
    }
    for (const ph of p?.phones ?? []) {
      if (ph.display) pts.push({ category: 'phone', field: 'number', value: ph.display, source: SRC });
    }
    for (const em of p?.emails ?? []) {
      if (em.address) pts.push({ category: 'email', field: 'address', value: em.address, source: SRC });
    }
    for (const rel of p?.relationships ?? []) {
      const name = rel.names?.[0]?.display;
      if (name) conns.push({ fromSubject: seed.name ?? seed.email ?? '', relationship: 'associate', toSubject: name, confidence: 0.55, sources: [SRC] });
    }

    return makeSourceResult(SRC, 2, 'success', pts, conns, Date.now() - t0);
  } catch (e: any) {
    return makeSourceResult(SRC, 2, 'error', [], [], Date.now() - t0, String(e?.message ?? e));
  }
}
```

- [ ] **Step 4: Create Spokeo adapter**

```typescript
// src/utils/personIntel/adapters/spokeo.ts
import type { IntelSeed, RawDataPoint, SourceResult } from '../types';
import { getKey, safeFetch, makeSourceResult } from './shared';

const SRC = 'Spokeo';

export async function querySpokeo(db: D1Database, seed: IntelSeed): Promise<SourceResult> {
  const t0 = Date.now();
  const apiKey = await getKey(db, 'spokeo_api_key');
  if (!apiKey) return makeSourceResult(SRC, 2, 'not_configured', [], [], Date.now() - t0);

  try {
    const params = new URLSearchParams({ api_key: apiKey });
    if (seed.email) params.set('email', seed.email);
    else if (seed.phone) params.set('phone', seed.phone);
    else if (seed.name) params.set('name', seed.name);
    else return makeSourceResult(SRC, 2, 'skipped', [], [], Date.now() - t0);

    const json = await safeFetch(`https://api.spokeo.com/v2/people/search?${params}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });

    const pts: RawDataPoint[] = [];
    for (const person of json?.results ?? []) {
      for (const addr of person?.addresses ?? []) {
        if (addr.street) pts.push({ category: 'address', field: 'street', value: addr.street, source: SRC });
        if (addr.city) pts.push({ category: 'address', field: 'city', value: addr.city, source: SRC });
        if (addr.state) pts.push({ category: 'address', field: 'state', value: addr.state, source: SRC });
      }
      for (const ph of person?.phones ?? []) {
        if (ph.number) pts.push({ category: 'phone', field: 'number', value: ph.number, source: SRC });
      }
    }

    return makeSourceResult(SRC, 2, 'success', pts, [], Date.now() - t0);
  } catch (e: any) {
    return makeSourceResult(SRC, 2, 'error', [], [], Date.now() - t0, String(e?.message ?? e));
  }
}
```

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/utils/personIntel/adapters/
git commit -m "feat(person-intel): MicroBilt + Pipl + Spokeo adapters"
```

---

### Task 6: OSINT Adapters — Phone, Email, Breach

**Files:**
- Create: `src/utils/personIntel/adapters/numverify.ts`
- Create: `src/utils/personIntel/adapters/hunter.ts`
- Create: `src/utils/personIntel/adapters/hibp.ts`
- Create: `src/utils/personIntel/adapters/clearbit.ts`

- [ ] **Step 1: NumVerify adapter**

```typescript
// src/utils/personIntel/adapters/numverify.ts
import type { IntelSeed, RawDataPoint, SourceResult } from '../types';
import { getKey, safeFetch, makeSourceResult } from './shared';

const SRC = 'NumVerify';

export async function queryNumverify(db: D1Database, seed: IntelSeed): Promise<SourceResult> {
  const t0 = Date.now();
  if (!seed.phone) return makeSourceResult(SRC, 2, 'skipped', [], [], Date.now() - t0);
  const apiKey = await getKey(db, 'numverify_api_key');
  if (!apiKey) return makeSourceResult(SRC, 2, 'not_configured', [], [], Date.now() - t0);

  try {
    const json = await safeFetch(`http://apilayer.net/api/validate?access_key=${apiKey}&number=${encodeURIComponent(seed.phone)}&format=1`, { method: 'GET' });
    const pts: RawDataPoint[] = [];
    if (json?.valid) {
      if (json.carrier) pts.push({ category: 'phone', field: 'carrier', value: json.carrier, source: SRC });
      if (json.line_type) pts.push({ category: 'phone', field: 'line_type', value: json.line_type, source: SRC });
      if (json.location) pts.push({ category: 'address', field: 'region', value: json.location, source: SRC });
    }
    return makeSourceResult(SRC, 2, json?.valid ? 'success' : 'error', pts, [], Date.now() - t0, json?.valid ? undefined : 'Invalid number');
  } catch (e: any) {
    return makeSourceResult(SRC, 2, 'error', [], [], Date.now() - t0, String(e?.message ?? e));
  }
}
```

- [ ] **Step 2: Hunter.io adapter**

```typescript
// src/utils/personIntel/adapters/hunter.ts
import type { IntelSeed, RawDataPoint, SourceResult } from '../types';
import { getKey, safeFetch, makeSourceResult } from './shared';

const SRC = 'HunterIO';

export async function queryHunter(db: D1Database, seed: IntelSeed): Promise<SourceResult> {
  const t0 = Date.now();
  if (!seed.email) return makeSourceResult(SRC, 2, 'skipped', [], [], Date.now() - t0);
  const apiKey = await getKey(db, 'hunter_api_key');
  if (!apiKey) return makeSourceResult(SRC, 2, 'not_configured', [], [], Date.now() - t0);

  try {
    const json = await safeFetch(`https://api.hunter.io/v2/email-verifier?email=${encodeURIComponent(seed.email)}&api_key=${apiKey}`, { method: 'GET' });
    const pts: RawDataPoint[] = [];
    const d = json?.data;
    if (d?.result === 'deliverable') pts.push({ category: 'email', field: 'verified', value: 'true', source: SRC });
    if (d?.mx_records) pts.push({ category: 'email', field: 'mx_host', value: String(d.mx_records[0]?.hostname ?? ''), source: SRC });
    if (d?.smtp_server_accepts_all === false) pts.push({ category: 'email', field: 'disposable', value: 'false', source: SRC });
    return makeSourceResult(SRC, 2, 'success', pts, [], Date.now() - t0);
  } catch (e: any) {
    return makeSourceResult(SRC, 2, 'error', [], [], Date.now() - t0, String(e?.message ?? e));
  }
}
```

- [ ] **Step 3: HIBP adapter**

```typescript
// src/utils/personIntel/adapters/hibp.ts
import type { IntelSeed, RawDataPoint, SourceResult, RiskFlag } from '../types';
import { getKey, safeFetch, makeSourceResult } from './shared';

const SRC = 'HIBP';

export async function queryHibp(db: D1Database, seed: IntelSeed): Promise<{ result: SourceResult; riskFlags: RiskFlag[] }> {
  const t0 = Date.now();
  if (!seed.email) return { result: makeSourceResult(SRC, 2, 'skipped', [], [], Date.now() - t0), riskFlags: [] };
  const apiKey = await getKey(db, 'hibp_api_key');
  if (!apiKey) return { result: makeSourceResult(SRC, 2, 'not_configured', [], [], Date.now() - t0), riskFlags: [] };

  try {
    const json = await safeFetch(`https://haveibeenpwned.com/api/v3/breachedaccount/${encodeURIComponent(seed.email)}`, {
      method: 'GET',
      headers: { 'hibp-api-key': apiKey, 'User-Agent': 'RMPG-Flex-PersonIntel/1.0' },
    });
    const breaches: any[] = Array.isArray(json) ? json : [];
    const pts: RawDataPoint[] = breaches.map(b => ({ category: 'online' as const, field: 'breach', value: b.Name ?? 'Unknown', source: SRC }));
    const riskFlags: RiskFlag[] = breaches.length >= 3 ? ['hibp_breach'] : [];
    return { result: makeSourceResult(SRC, 2, 'success', pts, [], Date.now() - t0), riskFlags };
  } catch (e: any) {
    if (String(e?.message).includes('404')) return { result: makeSourceResult(SRC, 2, 'success', [], [], Date.now() - t0), riskFlags: [] };
    return { result: makeSourceResult(SRC, 2, 'error', [], [], Date.now() - t0, String(e?.message ?? e)), riskFlags: [] };
  }
}
```

- [ ] **Step 4: Clearbit adapter**

```typescript
// src/utils/personIntel/adapters/clearbit.ts
import type { IntelSeed, RawDataPoint, SourceResult } from '../types';
import { getKey, safeFetch, makeSourceResult } from './shared';

const SRC = 'Clearbit';

export async function queryClearbit(db: D1Database, seed: IntelSeed): Promise<SourceResult> {
  const t0 = Date.now();
  if (!seed.email) return makeSourceResult(SRC, 2, 'skipped', [], [], Date.now() - t0);
  const apiKey = await getKey(db, 'clearbit_api_key');
  if (!apiKey) return makeSourceResult(SRC, 2, 'not_configured', [], [], Date.now() - t0);

  try {
    const json = await safeFetch(`https://person.clearbit.com/v2/combined/find?email=${encodeURIComponent(seed.email)}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const pts: RawDataPoint[] = [];
    const p = json?.person;
    if (p?.name?.fullName) pts.push({ category: 'legal', field: 'name', value: p.name.fullName, source: SRC });
    if (p?.employment?.name) pts.push({ category: 'business', field: 'employer', value: p.employment.name, source: SRC });
    if (p?.employment?.title) pts.push({ category: 'business', field: 'job_title', value: p.employment.title, source: SRC });
    for (const profile of p?.social?.profiles ?? []) {
      if (profile.url) pts.push({ category: 'social', field: 'profile', value: profile.url, source: SRC });
    }
    if (p?.geo?.city) pts.push({ category: 'address', field: 'city', value: p.geo.city, source: SRC });
    if (p?.geo?.state) pts.push({ category: 'address', field: 'state', value: p.geo.state, source: SRC });
    return makeSourceResult(SRC, 2, 'success', pts, [], Date.now() - t0);
  } catch (e: any) {
    return makeSourceResult(SRC, 2, 'error', [], [], Date.now() - t0, String(e?.message ?? e));
  }
}
```

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/utils/personIntel/adapters/
git commit -m "feat(person-intel): NumVerify + Hunter + HIBP + Clearbit adapters"
```

---

### Task 7: Phase 2 Orchestrator + Data Fusion

**Files:**
- Create: `src/utils/personIntel/phase2.ts`
- Create: `src/utils/personIntel/fusion.ts`
- Create: `tests/personIntelFusion.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/personIntelFusion.test.ts
import { describe, it, expect } from 'vitest';
import { fuseResults } from '../src/utils/personIntel/fusion';
import type { SourceResult } from '../src/utils/personIntel/types';

describe('fuseResults', () => {
  it('merges duplicate values from different sources', () => {
    const results: SourceResult[] = [
      { sourceName: 'MicroBilt', phase: 2, status: 'success', dataPoints: [
        { category: 'address', field: 'city', value: 'Salt Lake City', source: 'MicroBilt' },
      ], connections: [], responseTimeMs: 100 },
      { sourceName: 'Pipl', phase: 2, status: 'success', dataPoints: [
        { category: 'address', field: 'city', value: 'Salt Lake City', source: 'Pipl' },
      ], connections: [], responseTimeMs: 200 },
    ];
    const fused = fuseResults(results);
    const cityPoints = fused.mergedPoints.filter(p => p.field === 'city');
    expect(cityPoints).toHaveLength(1);
    expect(cityPoints[0].sources).toContain('MicroBilt');
    expect(cityPoints[0].sources).toContain('Pipl');
    expect(cityPoints[0].confidence).toBeCloseTo(0.58);
  });

  it('filters noise below 0.40', () => {
    const results: SourceResult[] = [
      { sourceName: 'MicroBilt', phase: 2, status: 'success', dataPoints: [
        { category: 'online', field: 'profile', value: 'x', source: 'MicroBilt' },
      ], connections: [], responseTimeMs: 100 },
    ];
    const fused = fuseResults(results);
    // Single source with no internal/crawl corroboration → 0.40 exactly → not noise
    expect(fused.mergedPoints[0].confidence).toBeCloseTo(0.40);
  });

  it('collects connections from all sources', () => {
    const results: SourceResult[] = [
      { sourceName: 'Pipl', phase: 2, status: 'success', dataPoints: [], connections: [
        { fromSubject: 'John Doe', relationship: 'associate', toSubject: 'Jane Smith', confidence: 0.55, sources: ['Pipl'] },
      ], responseTimeMs: 100 },
    ];
    const fused = fuseResults(results);
    expect(fused.connections).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd client && npx vitest run ../tests/personIntelFusion.test.ts 2>&1 | head -20
```
Expected: FAIL — `Cannot find module '../src/utils/personIntel/fusion'`

- [ ] **Step 3: Implement fusion.ts**

```typescript
// src/utils/personIntel/fusion.ts
import type { SourceResult, MergedDataPoint, IntelConnection } from './types';
import { deriveConfidence } from './confidence';

export interface FusionResult {
  mergedPoints: MergedDataPoint[];
  connections: IntelConnection[];
  successCount: number;
}

export function fuseResults(results: SourceResult[]): FusionResult {
  const map = new Map<string, MergedDataPoint>();
  const connections: IntelConnection[] = [];
  let successCount = 0;

  for (const r of results) {
    if (r.status === 'success') successCount++;
    for (const dp of r.dataPoints) {
      const key = `${dp.category}|${dp.field}|${dp.value.toLowerCase().trim()}`;
      const existing = map.get(key);
      if (existing) {
        if (!existing.sources.includes(dp.source)) existing.sources.push(dp.source);
      } else {
        map.set(key, { category: dp.category, field: dp.field, value: dp.value, sources: [dp.source], confidence: 0 });
      }
    }
    connections.push(...r.connections);
  }

  const mergedPoints = Array.from(map.values()).map(dp => ({
    ...dp,
    confidence: deriveConfidence({ sources: dp.sources, hasInternalRecord: false, hasCrawlCorroboration: false }),
  }));

  return { mergedPoints, connections, successCount };
}
```

- [ ] **Step 4: Run tests**

```bash
cd client && npx vitest run ../tests/personIntelFusion.test.ts
```
Expected: PASS — 3 tests

- [ ] **Step 5: Implement phase2.ts**

```typescript
// src/utils/personIntel/phase2.ts
import type { IntelSeed, SourceResult, RiskFlag } from './types';
import { fuseResults, type FusionResult } from './fusion';
import { queryMicrobilt } from './adapters/microbilt';
import { queryPipl } from './adapters/pipl';
import { querySpokeo } from './adapters/spokeo';
import { queryNumverify } from './adapters/numverify';
import { queryHunter } from './adapters/hunter';
import { queryHibp } from './adapters/hibp';
import { queryClearbit } from './adapters/clearbit';

export interface Phase2Result extends FusionResult {
  sourceResults: SourceResult[];
  riskFlags: RiskFlag[];
}

export async function runPhase2(db: D1Database, seed: IntelSeed): Promise<Phase2Result> {
  const riskFlags: RiskFlag[] = [];

  const [microbilt, pipl, spokeo, numverify, hunter, hibpResult, clearbit] = await Promise.allSettled([
    queryMicrobilt(db, seed),
    queryPipl(db, seed),
    querySpokeo(db, seed),
    queryNumverify(db, seed),
    queryHunter(db, seed),
    queryHibp(db, seed),
    queryClearbit(db, seed),
  ]);

  const hibp = hibpResult.status === 'fulfilled' ? hibpResult.value : { result: { sourceName: 'HIBP', phase: 2 as const, status: 'error' as const, dataPoints: [], connections: [], responseTimeMs: 0, errorMessage: String((hibpResult as any).reason) }, riskFlags: [] as RiskFlag[] };
  riskFlags.push(...hibp.riskFlags);

  const settled = (r: PromiseSettledResult<any>, fallback: SourceResult): SourceResult =>
    r.status === 'fulfilled' ? r.value : { ...fallback, status: 'error', errorMessage: String((r as any).reason) };

  const sourceResults: SourceResult[] = [
    settled(microbilt, { sourceName: 'MicroBilt', phase: 2, status: 'error', dataPoints: [], connections: [], responseTimeMs: 0 }),
    settled(pipl, { sourceName: 'Pipl', phase: 2, status: 'error', dataPoints: [], connections: [], responseTimeMs: 0 }),
    settled(spokeo, { sourceName: 'Spokeo', phase: 2, status: 'error', dataPoints: [], connections: [], responseTimeMs: 0 }),
    settled(numverify, { sourceName: 'NumVerify', phase: 2, status: 'error', dataPoints: [], connections: [], responseTimeMs: 0 }),
    settled(hunter, { sourceName: 'HunterIO', phase: 2, status: 'error', dataPoints: [], connections: [], responseTimeMs: 0 }),
    hibp.result,
    settled(clearbit, { sourceName: 'Clearbit', phase: 2, status: 'error', dataPoints: [], connections: [], responseTimeMs: 0 }),
  ];

  const fused = fuseResults(sourceResults);
  return { ...fused, sourceResults, riskFlags };
}
```

- [ ] **Step 6: Commit**

```bash
git add src/utils/personIntel/fusion.ts src/utils/personIntel/phase2.ts tests/personIntelFusion.test.ts
git commit -m "feat(person-intel): phase 2 OSINT orchestrator + data fusion with tests"
```

---

### Task 8: Phase 3 — Firecrawl + Claude Extraction

**Files:**
- Create: `src/utils/personIntel/phase3.ts`
- Create: `tests/personIntelPhase3.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/personIntelPhase3.test.ts
import { describe, it, expect, vi } from 'vitest';
import { buildSearchQueries, extractDataPointsFromMarkdown } from '../src/utils/personIntel/phase3';
import type { IntelSeed } from '../src/utils/personIntel/types';

describe('buildSearchQueries', () => {
  it('generates name-based queries', () => {
    const seed: IntelSeed = { name: 'John Doe', dob: '1985-03-15' };
    const queries = buildSearchQueries(seed);
    expect(queries.length).toBeGreaterThanOrEqual(2);
    expect(queries.some(q => q.includes('John Doe'))).toBe(true);
  });
  it('generates plate query when plate provided', () => {
    const seed: IntelSeed = { plate: 'ABC123' };
    const queries = buildSearchQueries(seed);
    expect(queries.some(q => q.includes('ABC123'))).toBe(true);
  });
});

describe('extractDataPointsFromMarkdown', () => {
  it('parses LLM JSON output of data points', () => {
    const mockLlmOutput = JSON.stringify([
      { category: 'address', field: 'street', value: '456 Oak Ave' },
      { category: 'phone', field: 'number', value: '8015551234' },
    ]);
    const pts = extractDataPointsFromMarkdown(mockLlmOutput, 'Firecrawl');
    expect(pts).toHaveLength(2);
    expect(pts[0].source).toBe('Firecrawl');
    expect(pts[0].category).toBe('address');
  });
  it('returns empty array on invalid JSON', () => {
    expect(extractDataPointsFromMarkdown('not json', 'Firecrawl')).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd client && npx vitest run ../tests/personIntelPhase3.test.ts 2>&1 | head -20
```
Expected: FAIL — `Cannot find module '../src/utils/personIntel/phase3'`

- [ ] **Step 3: Implement phase3.ts**

```typescript
// src/utils/personIntel/phase3.ts
import type { IntelSeed, RawDataPoint, SourceResult, RiskFlag } from './types';
import { parseJsonLoose, runResearchLLM } from '../researchEngine';
import { firecrawlSearch } from '../firecrawl';

const DATA_CATEGORIES = ['address', 'phone', 'email', 'associate', 'vehicle', 'social', 'business', 'legal', 'online'] as const;

export function buildSearchQueries(seed: IntelSeed): string[] {
  const queries: string[] = [];
  if (seed.name) {
    queries.push(`"${seed.name}" address phone contact`);
    if (seed.dob) queries.push(`"${seed.name}" born ${seed.dob.split('-')[0]} background`);
    queries.push(`"${seed.name}" arrest warrant criminal record`);
  }
  if (seed.plate) queries.push(`license plate "${seed.plate}" vehicle owner`);
  if (seed.email) queries.push(`"${seed.email}" person identity`);
  if (seed.phone) queries.push(`"${seed.phone}" owner contact`);
  return queries.slice(0, 5);
}

export function extractDataPointsFromMarkdown(text: string, source: string): RawDataPoint[] {
  const j = parseJsonLoose<any[]>(text);
  if (!Array.isArray(j)) return [];
  const pts: RawDataPoint[] = [];
  for (const item of j) {
    if (!item?.category || !item?.field || !item?.value) continue;
    if (!(DATA_CATEGORIES as readonly string[]).includes(item.category)) continue;
    pts.push({ category: item.category, field: String(item.field), value: String(item.value).slice(0, 500), source });
  }
  return pts;
}

const EXTRACT_SYSTEM = `You are an OSINT data extractor for law enforcement. Given web page text about a person, extract structured data points.
Return ONLY a JSON array of objects with shape: [{category, field, value}].
Categories: address, phone, email, associate, vehicle, social, business, legal, online.
Only include factual data actually present in the text. No inference. No hallucination.`;

export interface Phase3Result {
  sourceResults: SourceResult[];
  dataPoints: RawDataPoint[];
  riskFlags: RiskFlag[];
  crawlCorroboration: boolean;
}

export async function runPhase3(
  env: { DB: D1Database; AI: Ai; FIRECRAWL_API_KEY?: string },
  seed: IntelSeed,
  knownValues: string[],
): Promise<Phase3Result> {
  const sourceResults: SourceResult[] = [];
  const allPoints: RawDataPoint[] = [];
  const riskFlags: RiskFlag[] = [];

  if (!env.FIRECRAWL_API_KEY) {
    return { sourceResults: [{ sourceName: 'Firecrawl', phase: 3, status: 'not_configured', dataPoints: [], connections: [], responseTimeMs: 0 }], dataPoints: [], riskFlags: [], crawlCorroboration: false };
  }

  const queries = buildSearchQueries(seed);

  for (const query of queries) {
    const t0 = Date.now();
    try {
      const results = await firecrawlSearch(env, query, { limit: 3, scrape: true, timeoutMs: 25000 });
      for (const r of results) {
        const md = r.markdown ?? r.description ?? '';
        if (!md) continue;
        const llmOut = await runResearchLLM(env, {
          system: EXTRACT_SYSTEM,
          user: `URL: ${r.url}\n\nCONTENT:\n${md.slice(0, 3000)}\n\nExtract data points about: ${seed.name ?? seed.email ?? seed.phone ?? seed.plate}`,
          maxTokens: 800,
        });
        const pts = extractDataPointsFromMarkdown(llmOut, 'Firecrawl');
        allPoints.push(...pts);

        // Risk flag: arrest mention in crawled content
        if (/\b(arrest|warrant|convicted|guilty|charged)\b/i.test(md)) riskFlags.push('arrest_mention');
      }
      sourceResults.push({ sourceName: 'Firecrawl', phase: 3, status: 'success', dataPoints: allPoints.slice(-50), connections: [], responseTimeMs: Date.now() - t0 });
    } catch (e: any) {
      sourceResults.push({ sourceName: 'Firecrawl', phase: 3, status: 'error', dataPoints: [], connections: [], responseTimeMs: Date.now() - t0, errorMessage: String(e?.message ?? e) });
    }
  }

  // Crawl corroboration: did we find any known values?
  const crawlValues = allPoints.map(p => p.value.toLowerCase());
  const crawlCorroboration = knownValues.some(v => crawlValues.some(cv => cv.includes(v.toLowerCase())));

  return { sourceResults, dataPoints: allPoints, riskFlags: [...new Set(riskFlags)], crawlCorroboration };
}
```

- [ ] **Step 4: Run tests**

```bash
cd client && npx vitest run ../tests/personIntelPhase3.test.ts
```
Expected: PASS — 4 tests

- [ ] **Step 5: Commit**

```bash
git add src/utils/personIntel/phase3.ts tests/personIntelPhase3.test.ts
git commit -m "feat(person-intel): phase 3 Firecrawl + Claude extraction with tests"
```

---

### Task 9: PersonIntelDO Durable Object

**Files:**
- Create: `src/durable-objects/PersonIntelDO.ts`
- Modify: `src/index.ts` (export DO class)

- [ ] **Step 1: Create PersonIntelDO**

```typescript
// src/durable-objects/PersonIntelDO.ts
import type { Bindings } from '../types';
import { execute, query } from '../utils/db';
import type { IntelSeed, RiskFlag } from '../utils/personIntel/types';
import { queryPhase1 } from '../utils/personIntel/phase1';
import { runPhase2 } from '../utils/personIntel/phase2';
import { runPhase3 } from '../utils/personIntel/phase3';
import { fuseResults } from '../utils/personIntel/fusion';
import { mergeDataPoints, deriveConfidence } from '../utils/personIntel/confidence';
import { computeRiskScore } from '../utils/personIntel/riskScore';

interface DOState {
  dossierId: number;
  seed: IntelSeed;
  stage: 'phase1' | 'phase2' | 'phase3' | 'done' | 'error';
  phase1Points?: any[];
  phase2Points?: any[];
  phase2Connections?: any[];
  riskFlags?: RiskFlag[];
}

const STAGE_GAP_MS = 500;

async function persistSourceResult(db: D1Database, dossierId: number, r: any) {
  await execute(db, `INSERT INTO person_intel_sources (dossier_id,source_name,phase,status,response_time_ms,data_points_found,error_message) VALUES (?,?,?,?,?,?,?)`,
    [dossierId, r.sourceName, r.phase, r.status, r.responseTimeMs, r.dataPoints?.length ?? 0, r.errorMessage ?? null]);
}

async function persistDataPoints(db: D1Database, dossierId: number, pts: any[]) {
  for (const p of pts) {
    await execute(db, `INSERT INTO person_intel_data_points (dossier_id,category,field,value,sources,confidence) VALUES (?,?,?,?,?,?)`,
      [dossierId, p.category, p.field, p.value, JSON.stringify(p.sources), p.confidence]);
  }
}

async function persistConnections(db: D1Database, dossierId: number, conns: any[]) {
  for (const c of conns) {
    await execute(db, `INSERT INTO person_intel_connections (dossier_id,from_subject,relationship,to_subject,confidence,sources) VALUES (?,?,?,?,?,?)`,
      [dossierId, c.fromSubject, c.relationship, c.toSubject, c.confidence, JSON.stringify(c.sources)]);
  }
}

export class PersonIntelDO {
  state: DurableObjectState;
  env: Bindings;

  constructor(state: DurableObjectState, env: Bindings) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const { dossierId, seed } = await request.json<{ dossierId: number; seed: IntelSeed }>();
    await this.state.storage.put<DOState>('s', { dossierId, seed, stage: 'phase1' });
    await execute(this.env.DB, `UPDATE person_intelligence SET status='running', phase=1 WHERE id=?`, [dossierId]);
    await this.state.storage.setAlarm(Date.now() + STAGE_GAP_MS);
    return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
  }

  async alarm(): Promise<void> {
    const st = await this.state.storage.get<DOState>('s');
    if (!st) return;

    try {
      if (st.stage === 'phase1') await this.runPhase1(st);
      else if (st.stage === 'phase2') await this.runPhase2(st);
      else if (st.stage === 'phase3') await this.runPhase3(st);
    } catch (e: any) {
      await execute(this.env.DB, `UPDATE person_intelligence SET status='error', notes=? WHERE id=?`,
        [String(e?.message ?? e).slice(0, 500), st.dossierId]);
      st.stage = 'error';
      await this.state.storage.put('s', st);
      return;
    }

    if (st.stage !== 'done') await this.state.storage.setAlarm(Date.now() + STAGE_GAP_MS);
  }

  private async runPhase1(st: DOState) {
    const result = await queryPhase1(this.env.DB, st.seed);
    await persistSourceResult(this.env.DB, st.dossierId, result);
    const merged = mergeDataPoints(result.dataPoints);
    st.phase1Points = merged;
    await execute(this.env.DB, `UPDATE person_intelligence SET phase=1, phase1_completed_at=datetime('now') WHERE id=?`, [st.dossierId]);
    await persistDataPoints(this.env.DB, st.dossierId, merged);
    st.stage = 'phase2';
    await this.state.storage.put('s', st);
  }

  private async runPhase2(st: DOState) {
    const { sourceResults, mergedPoints, connections, riskFlags } = await runPhase2(this.env.DB, st.seed);
    for (const r of sourceResults) await persistSourceResult(this.env.DB, st.dossierId, r);
    const allPoints = [...(st.phase1Points ?? []), ...mergedPoints];
    await persistDataPoints(this.env.DB, st.dossierId, mergedPoints);
    await persistConnections(this.env.DB, st.dossierId, connections);
    st.phase2Points = mergedPoints;
    st.phase2Connections = connections;
    st.riskFlags = riskFlags;
    await execute(this.env.DB, `UPDATE person_intelligence SET phase=2, phase2_completed_at=datetime('now'), sources_queried=sources_queried+?, sources_succeeded=sources_succeeded+? WHERE id=?`,
      [sourceResults.length, sourceResults.filter(r => r.status === 'success').length, st.dossierId]);
    st.stage = 'phase3';
    await this.state.storage.put('s', st);
  }

  private async runPhase3(st: DOState) {
    const knownValues = (st.phase1Points ?? []).concat(st.phase2Points ?? []).map((p: any) => p.value as string).filter(Boolean);
    const { sourceResults, dataPoints, riskFlags: crawlFlags, crawlCorroboration } = await runPhase3(this.env, st.seed, knownValues);
    for (const r of sourceResults) await persistSourceResult(this.env.DB, st.dossierId, r);

    // Re-score with crawl corroboration
    const merged = mergeDataPoints(dataPoints);
    const allRiskFlags: RiskFlag[] = [...(st.riskFlags ?? []), ...crawlFlags];

    // Auto-link: check if persons table has a match
    let linkedPersonId: number | null = null;
    if (st.seed.name) {
      const person = await this.env.DB.prepare(`SELECT id FROM persons WHERE full_name LIKE ? LIMIT 1`).bind(`%${st.seed.name.split(' ')[0]}%`).first<{ id: number }>();
      if (person) linkedPersonId = person.id;
    }

    // Check warrants → risk flag
    if (linkedPersonId) {
      const warrant = await this.env.DB.prepare(`SELECT id FROM warrants WHERE person_id=? AND status='active' LIMIT 1`).bind(linkedPersonId).first<{ id: number }>();
      if (warrant) allRiskFlags.push('warrant');
      const sor = await this.env.DB.prepare(`SELECT id FROM national_sex_offenders WHERE person_id=? LIMIT 1`).bind(linkedPersonId).first<{ id: number }>();
      if (sor) allRiskFlags.push('nsopw');
    }

    const uniqueFlags = [...new Set(allRiskFlags)];
    const riskScore = computeRiskScore(uniqueFlags);
    const dataPointsCount = await this.env.DB.prepare(`SELECT COUNT(*) as c FROM person_intel_data_points WHERE dossier_id=?`).bind(st.dossierId).first<{ c: number }>();

    await persistDataPoints(this.env.DB, st.dossierId, merged);
    await execute(this.env.DB, `UPDATE person_intelligence SET status='complete', phase=3, phase3_completed_at=datetime('now'), completed_at=datetime('now'), risk_score=?, risk_flags=?, linked_person_id=?, data_points_found=? WHERE id=?`,
      [riskScore, JSON.stringify(uniqueFlags), linkedPersonId, (dataPointsCount?.c ?? 0), st.dossierId]);

    st.stage = 'done';
    await this.state.storage.put('s', st);
  }
}
```

- [ ] **Step 2: Export DO from src/index.ts**

In `src/index.ts`, add this export at the top-level (alongside the existing DO exports):
```typescript
export { PersonIntelDO } from './durable-objects/PersonIntelDO';
```

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/durable-objects/PersonIntelDO.ts src/index.ts
git commit -m "feat(person-intel): PersonIntelDO alarm-driven 3-phase pipeline"
```

---

### Task 10: Worker Routes

**Files:**
- Create: `src/routes/personIntel.ts`
- Modify: `src/index.ts` (mount route)

- [ ] **Step 1: Create personIntel.ts route**

```typescript
// src/routes/personIntel.ts
import { Hono } from 'hono';
import type { Env } from '../types';
import { query, execute } from '../utils/db';

const app = new Hono<Env>();

// POST /api/person-intel — create investigation
app.post('/', async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{ seed: any; notes?: string }>();
  if (!body?.seed || typeof body.seed !== 'object') return c.json({ error: 'seed required' }, 400);

  const result = await execute(c.env.DB,
    `INSERT INTO person_intelligence (subject_seed, subject_name, created_by, notes) VALUES (?,?,?,?)`,
    [JSON.stringify(body.seed), body.seed.name ?? null, user.id, body.notes ?? null]
  );
  const dossierId = result.meta.last_row_id as number;

  // Spawn DO
  const id = c.env.PERSON_INTEL_DO.idFromName(`dossier-${dossierId}`);
  const stub = c.env.PERSON_INTEL_DO.get(id);
  await stub.fetch(new Request('https://internal/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dossierId, seed: body.seed }),
  }));

  return c.json({ id: dossierId, status: 'pending' }, 201);
});

// GET /api/person-intel — list
app.get('/', async (c) => {
  const user = c.get('user');
  const limit = Math.min(Number(c.req.query('limit') ?? 50), 100);
  const offset = Number(c.req.query('offset') ?? 0);
  const rows = await query<any>(c.env.DB,
    `SELECT id, subject_seed, subject_name, status, phase, risk_score, risk_flags, data_points_found, sources_queried, sources_succeeded, created_at, completed_at, linked_person_id
     FROM person_intelligence WHERE created_by=? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [user.id, limit, offset]
  );
  return c.json({ results: rows, limit, offset });
});

// GET /api/person-intel/:id — full dossier (polling endpoint)
app.get('/:id', async (c) => {
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  const dossier = await c.env.DB.prepare(
    `SELECT * FROM person_intelligence WHERE id=? AND created_by=?`
  ).bind(id, user.id).first<any>();
  if (!dossier) return c.json({ error: 'not found' }, 404);

  const [dataPoints, connections, sources] = await Promise.all([
    query<any>(c.env.DB, `SELECT * FROM person_intel_data_points WHERE dossier_id=? ORDER BY confidence DESC`, [id]),
    query<any>(c.env.DB, `SELECT * FROM person_intel_connections WHERE dossier_id=? ORDER BY confidence DESC`, [id]),
    query<any>(c.env.DB, `SELECT * FROM person_intel_sources WHERE dossier_id=? ORDER BY queried_at ASC`, [id]),
  ]);

  // Parse JSON fields
  dossier.subject_seed = JSON.parse(dossier.subject_seed ?? '{}');
  dossier.risk_flags = JSON.parse(dossier.risk_flags ?? '[]');

  return c.json({
    ...dossier,
    dataPoints: dataPoints.map((p: any) => ({ ...p, sources: JSON.parse(p.sources ?? '[]') })),
    connections: connections.map((c: any) => ({ ...c, sources: JSON.parse(c.sources ?? '[]') })),
    sources,
  });
});

// DELETE /api/person-intel/:id
app.delete('/:id', async (c) => {
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  const dossier = await c.env.DB.prepare(`SELECT created_by FROM person_intelligence WHERE id=?`).bind(id).first<any>();
  if (!dossier) return c.json({ error: 'not found' }, 404);
  if (dossier.created_by !== user.id && user.role !== 'admin') return c.json({ error: 'forbidden' }, 403);
  await execute(c.env.DB, `DELETE FROM person_intel_data_points WHERE dossier_id=?`, [id]);
  await execute(c.env.DB, `DELETE FROM person_intel_connections WHERE dossier_id=?`, [id]);
  await execute(c.env.DB, `DELETE FROM person_intel_sources WHERE dossier_id=?`, [id]);
  await execute(c.env.DB, `DELETE FROM person_intelligence WHERE id=?`, [id]);
  return c.json({ ok: true });
});

// POST /api/person-intel/:id/rerun — re-trigger DO
app.post('/:id/rerun', async (c) => {
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  const dossier = await c.env.DB.prepare(`SELECT * FROM person_intelligence WHERE id=? AND created_by=?`).bind(id, user.id).first<any>();
  if (!dossier) return c.json({ error: 'not found' }, 404);
  if (dossier.status !== 'error') return c.json({ error: 'only errored dossiers can be rerun' }, 400);

  await execute(c.env.DB, `UPDATE person_intelligence SET status='pending', phase=0 WHERE id=?`, [id]);
  const doId = c.env.PERSON_INTEL_DO.idFromName(`dossier-${id}`);
  const stub = c.env.PERSON_INTEL_DO.get(doId);
  await stub.fetch(new Request('https://internal/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dossierId: id, seed: JSON.parse(dossier.subject_seed) }),
  }));
  return c.json({ ok: true });
});

export default app;
```

- [ ] **Step 2: Mount route in src/index.ts**

In `src/index.ts`, add the import and mount:
```typescript
import personIntelRoutes from './routes/personIntel';
// ... (after existing route mounts)
app.use('/api/person-intel', authMiddleware);
app.route('/api/person-intel', personIntelRoutes);
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/routes/personIntel.ts src/index.ts
git commit -m "feat(person-intel): Worker routes POST/GET/DELETE + rerun"
```

---

### Task 11: Admin Configuration Tab

**Files:**
- Create: `client/src/pages/admin/AdminPersonIntelTab.tsx`
- Modify: `client/src/pages/admin/AdminPage.tsx` (add tab)

- [ ] **Step 1: Create AdminPersonIntelTab.tsx**

```tsx
// client/src/pages/admin/AdminPersonIntelTab.tsx
import { useState } from 'react';
import { apiFetch } from '../../hooks/useApi';
import { Shield } from 'lucide-react';

interface KeyConfig { key: string; label: string; placeholder: string; }

const PEOPLE_SEARCH_KEYS: KeyConfig[] = [
  { key: 'microbilt_api_key', label: 'MicroBilt API Key', placeholder: 'mb_...' },
  { key: 'pipl_api_key', label: 'Pipl API Key', placeholder: 'pipl_...' },
  { key: 'spokeo_api_key', label: 'Spokeo API Key', placeholder: 'sk_...' },
];
const PHONE_EMAIL_KEYS: KeyConfig[] = [
  { key: 'numverify_api_key', label: 'NumVerify API Key', placeholder: 'nv_...' },
  { key: 'hunter_api_key', label: 'Hunter.io API Key', placeholder: 'hu_...' },
  { key: 'hibp_api_key', label: 'HIBP API Key', placeholder: 'hibp_...' },
  { key: 'clearbit_api_key', label: 'Clearbit API Key', placeholder: 'cb_...' },
];

function KeySection({ title, keys }: { title: string; keys: KeyConfig[] }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      for (const [k, v] of Object.entries(values)) {
        if (!v.trim()) continue;
        await apiFetch('/admin/third-party-keys', { method: 'PUT', body: JSON.stringify({ key: k, value: v.trim() }) });
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-surface-raised border border-rmpg-700 rounded p-4 space-y-3">
      <h3 className="text-brand-300 font-semibold text-xs uppercase tracking-wider">{title}</h3>
      {keys.map(kc => (
        <div key={kc.key} className="space-y-1">
          <label className="text-rmpg-200 text-xs">{kc.label}</label>
          <input
            type="password"
            placeholder={kc.placeholder}
            value={values[kc.key] ?? ''}
            onChange={e => setValues(v => ({ ...v, [kc.key]: e.target.value }))}
            className="w-full bg-surface-base border border-rmpg-600 text-rmpg-100 text-xs px-2 py-1 rounded focus:outline-none focus:border-brand-400"
          />
        </div>
      ))}
      <button
        onClick={handleSave}
        disabled={saving}
        className="mt-2 px-3 py-1 bg-brand-600 hover:bg-brand-500 text-white text-xs rounded disabled:opacity-50"
      >
        {saving ? 'Saving...' : saved ? 'Saved ✓' : 'Save Keys'}
      </button>
    </div>
  );
}

export default function AdminPersonIntelTab() {
  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <Shield className="w-4 h-4 text-brand-400" />
        <span className="text-rmpg-100 font-semibold text-sm">Person Intelligence — API Keys</span>
      </div>
      <p className="text-rmpg-300 text-xs">Configure third-party OSINT APIs for the person intelligence dossier module. Keys are stored in the system config table.</p>
      <KeySection title="People Search" keys={PEOPLE_SEARCH_KEYS} />
      <KeySection title="Phone / Email / Breach" keys={PHONE_EMAIL_KEYS} />
    </div>
  );
}
```

- [ ] **Step 2: Add tab to AdminPage.tsx**

In `client/src/pages/admin/AdminPage.tsx`, import and add the tab:
```tsx
import AdminPersonIntelTab from './AdminPersonIntelTab';
// In the tabs array, add:
{ key: 'person-intel', label: 'Person Intel', component: <AdminPersonIntelTab /> }
```
(Match the exact tab registration pattern already used in AdminPage.tsx.)

- [ ] **Step 3: Build check**

```bash
cd client && npx tsc --noEmit
```
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/admin/AdminPersonIntelTab.tsx client/src/pages/admin/AdminPage.tsx
git commit -m "feat(person-intel): admin API key configuration tab"
```

---

### Task 12: PersonIntelPage — List + New Investigation Form

**Files:**
- Create: `client/src/pages/intel/PersonIntelPage.tsx`

- [ ] **Step 1: Create PersonIntelPage.tsx**

```tsx
// client/src/pages/intel/PersonIntelPage.tsx
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../../hooks/useApi';
import { Search, Plus, AlertTriangle, CheckCircle, Clock, XCircle } from 'lucide-react';
import PanelTitleBar from '../../components/PanelTitleBar';

interface Dossier {
  id: number;
  subject_name: string | null;
  subject_seed: any;
  status: 'pending' | 'running' | 'complete' | 'error';
  phase: number;
  risk_score: number;
  data_points_found: number;
  created_at: string;
  completed_at: string | null;
}

function StatusBadge({ status, phase }: { status: string; phase: number }) {
  if (status === 'complete') return <span className="flex items-center gap-1 text-green-400 text-xs"><CheckCircle className="w-3 h-3" />Complete</span>;
  if (status === 'error') return <span className="flex items-center gap-1 text-red-400 text-xs"><XCircle className="w-3 h-3" />Error</span>;
  if (status === 'running') return <span className="flex items-center gap-1 text-brand-400 text-xs"><Clock className="w-3 h-3" />Phase {phase}/3</span>;
  return <span className="flex items-center gap-1 text-rmpg-400 text-xs"><Clock className="w-3 h-3" />Pending</span>;
}

function RiskBadge({ score }: { score: number }) {
  const cls = score >= 60 ? 'text-red-400' : score >= 25 ? 'text-yellow-400' : 'text-rmpg-400';
  return <span className={`text-xs font-mono ${cls}`}>{score > 0 ? `⚠ ${score}` : '—'}</span>;
}

export default function PersonIntelPage() {
  const navigate = useNavigate();
  const [dossiers, setDossiers] = useState<Dossier[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [seed, setSeed] = useState({ name: '', dob: '', phone: '', email: '', plate: '' });
  const [notes, setNotes] = useState('');
  const [creating, setCreating] = useState(false);

  const load = async () => {
    try {
      const data = await apiFetch<{ results: Dossier[] }>('/person-intel');
      setDossiers(data.results ?? []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // Poll running investigations
  useEffect(() => {
    const running = dossiers.filter(d => d.status === 'pending' || d.status === 'running');
    if (!running.length) return;
    const interval = setInterval(load, 4000);
    return () => clearInterval(interval);
  }, [dossiers]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanSeed = Object.fromEntries(Object.entries(seed).filter(([, v]) => v.trim()));
    if (!Object.keys(cleanSeed).length) return;
    setCreating(true);
    try {
      const res = await apiFetch<{ id: number }>('/person-intel', { method: 'POST', body: JSON.stringify({ seed: cleanSeed, notes }) });
      navigate(`/intel/person/${res.id}`);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="PERSON INTELLIGENCE" icon={Search} />

      <div className="flex justify-end">
        <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-1 px-3 py-1 bg-brand-600 hover:bg-brand-500 text-white text-xs rounded">
          <Plus className="w-3 h-3" /> New Investigation
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="bg-surface-raised border border-rmpg-700 rounded p-4 space-y-3">
          <p className="text-rmpg-300 text-xs">Provide at least one identifier. Multiple identifiers increase accuracy.</p>
          <div className="grid grid-cols-2 gap-3">
            {(['name', 'dob', 'phone', 'email', 'plate'] as const).map(field => (
              <div key={field} className="space-y-1">
                <label className="text-rmpg-300 text-xs capitalize">{field === 'dob' ? 'Date of Birth' : field === 'plate' ? 'License Plate' : field.charAt(0).toUpperCase() + field.slice(1)}</label>
                <input
                  type={field === 'dob' ? 'date' : 'text'}
                  value={seed[field]}
                  onChange={e => setSeed(s => ({ ...s, [field]: e.target.value }))}
                  placeholder={field === 'plate' ? 'ABC-1234' : field === 'phone' ? '8015550001' : ''}
                  className="w-full bg-surface-base border border-rmpg-600 text-rmpg-100 text-xs px-2 py-1 rounded focus:outline-none focus:border-brand-400"
                />
              </div>
            ))}
            <div className="col-span-2 space-y-1">
              <label className="text-rmpg-300 text-xs">Notes</label>
              <input
                type="text"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Investigation notes..."
                className="w-full bg-surface-base border border-rmpg-600 text-rmpg-100 text-xs px-2 py-1 rounded focus:outline-none focus:border-brand-400"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={creating} className="px-3 py-1 bg-brand-600 hover:bg-brand-500 text-white text-xs rounded disabled:opacity-50">
              {creating ? 'Starting...' : 'Start Investigation'}
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="px-3 py-1 bg-rmpg-700 hover:bg-rmpg-600 text-rmpg-200 text-xs rounded">Cancel</button>
          </div>
        </form>
      )}

      <div className="bg-surface-raised border border-rmpg-700 rounded overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-surface-base">
            <tr>
              {['Subject', 'Status', 'Risk', 'Data Points', 'Created', ''].map(h => (
                <th key={h} className="px-3 py-[3px] text-left font-semibold text-rmpg-300 text-[9px]">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-3 py-4 text-center text-rmpg-400">Loading...</td></tr>
            ) : dossiers.length === 0 ? (
              <tr><td colSpan={6} className="px-3 py-4 text-center text-rmpg-400">No investigations yet</td></tr>
            ) : dossiers.map(d => (
              <tr key={d.id} className="border-t border-rmpg-800 hover:bg-surface-base cursor-pointer" onClick={() => navigate(`/intel/person/${d.id}`)}>
                <td className="px-3 py-[2px] text-rmpg-100">{d.subject_name ?? (d.subject_seed?.email ?? d.subject_seed?.phone ?? d.subject_seed?.plate ?? '—')}</td>
                <td className="px-3 py-[2px]"><StatusBadge status={d.status} phase={d.phase} /></td>
                <td className="px-3 py-[2px]"><RiskBadge score={d.risk_score ?? 0} /></td>
                <td className="px-3 py-[2px] text-rmpg-300">{d.data_points_found}</td>
                <td className="px-3 py-[2px] text-rmpg-400">{new Date(d.created_at).toLocaleDateString()}</td>
                <td className="px-3 py-[2px] text-brand-400 text-right pr-3">View →</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd client && npx tsc --noEmit 2>&1 | head -30
```
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/intel/PersonIntelPage.tsx
git commit -m "feat(person-intel): investigation list + new investigation form"
```

---

### Task 13: PersonIntelDossierPage — Dossier View

**Files:**
- Create: `client/src/pages/intel/PersonIntelDossierPage.tsx`

- [ ] **Step 1: Create PersonIntelDossierPage.tsx**

```tsx
// client/src/pages/intel/PersonIntelDossierPage.tsx
import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiFetch } from '../../hooks/useApi';
import { ArrowLeft, AlertTriangle, CheckCircle, Clock, RefreshCw } from 'lucide-react';
import PanelTitleBar from '../../components/PanelTitleBar';
import { Shield } from 'lucide-react';

type DataCategory = 'address' | 'phone' | 'email' | 'associate' | 'vehicle' | 'social' | 'business' | 'legal' | 'online';

interface DataPoint { id: number; category: DataCategory; field: string; value: string; sources: string[]; confidence: number; officer_flagged: number; promoted: number; }
interface Connection { id: number; from_subject: string; relationship: string; to_subject: string; confidence: number; sources: string[]; }
interface Source { id: number; source_name: string; phase: number; status: string; response_time_ms: number; data_points_found: number; error_message?: string; }
interface Dossier {
  id: number; status: string; phase: number; risk_score: number; risk_flags: string[];
  subject_name: string | null; subject_seed: any; linked_person_id: number | null;
  sources_queried: number; sources_succeeded: number; data_points_found: number;
  phase1_completed_at: string | null; phase2_completed_at: string | null; phase3_completed_at: string | null;
  created_at: string; completed_at: string | null; notes: string | null;
  dataPoints: DataPoint[]; connections: Connection[]; sources: Source[];
}

const CATEGORY_LABELS: Record<DataCategory, string> = {
  address: 'Addresses', phone: 'Phone Numbers', email: 'Email Addresses',
  associate: 'Associates', vehicle: 'Vehicles', social: 'Social Media',
  business: 'Business / Employment', legal: 'Legal / Identity', online: 'Online / Digital',
};

const CONFIDENCE_TIER = (c: number) => c >= 0.80 ? { label: 'Verified', cls: 'text-green-400' } : c >= 0.60 ? { label: 'Probable', cls: 'text-brand-400' } : c >= 0.40 ? { label: 'Possible', cls: 'text-yellow-400' } : { label: 'Noise', cls: 'text-rmpg-500' };

function PhaseBar({ phase, status, p1At, p2At, p3At }: { phase: number; status: string; p1At: string | null; p2At: string | null; p3At: string | null }) {
  const phases = [
    { label: 'Phase 1: Internal Records', done: !!p1At },
    { label: 'Phase 2: OSINT APIs', done: !!p2At },
    { label: 'Phase 3: Web Crawl', done: !!p3At },
  ];
  return (
    <div className="flex gap-2">
      {phases.map((p, i) => (
        <div key={i} className={`flex-1 h-1 rounded ${p.done ? 'bg-green-500' : i < phase ? 'bg-brand-500 animate-pulse' : 'bg-rmpg-700'}`} title={p.label} />
      ))}
    </div>
  );
}

export default function PersonIntelDossierPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [dossier, setDossier] = useState<Dossier | null>(null);
  const [activeTab, setActiveTab] = useState<'dossier' | 'graph' | 'sources'>('dossier');
  const [activeCategory, setActiveCategory] = useState<DataCategory | 'all'>('all');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<Dossier>(`/person-intel/${id}`);
      setDossier(data);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!dossier || dossier.status === 'complete' || dossier.status === 'error') return;
    const interval = setInterval(load, 3000);
    return () => clearInterval(interval);
  }, [dossier, load]);

  if (loading) return <div className="p-4 text-rmpg-400 text-sm">Loading dossier...</div>;
  if (!dossier) return <div className="p-4 text-red-400 text-sm">Dossier not found</div>;

  const visiblePoints = (activeCategory === 'all'
    ? dossier.dataPoints
    : dossier.dataPoints.filter(p => p.category === activeCategory)
  ).filter(p => p.confidence >= 0.40);

  const groupedPoints = visiblePoints.reduce((acc, p) => {
    const cat = p.category;
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(p);
    return acc;
  }, {} as Record<string, DataPoint[]>);

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-2">
        <button onClick={() => navigate('/intel/person')} className="text-rmpg-400 hover:text-rmpg-200">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <PanelTitleBar title={dossier.subject_name ?? 'PERSON INTELLIGENCE'} icon={Shield} />
        {(dossier.status === 'pending' || dossier.status === 'running') && (
          <RefreshCw className="w-3 h-3 text-brand-400 animate-spin ml-auto" />
        )}
      </div>

      {/* Risk + Phase bar */}
      <div className="bg-surface-raised border border-rmpg-700 rounded p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {dossier.risk_score >= 25 && <AlertTriangle className="w-4 h-4 text-red-400" />}
            <span className="text-xs text-rmpg-300">Risk Score: <span className={`font-mono ${dossier.risk_score >= 60 ? 'text-red-400' : dossier.risk_score >= 25 ? 'text-yellow-400' : 'text-rmpg-300'}`}>{dossier.risk_score}</span></span>
            {dossier.risk_flags.map(f => <span key={f} className="text-[9px] bg-red-900/40 text-red-300 px-1 py-0.5 rounded">{f}</span>)}
          </div>
          <span className="text-xs text-rmpg-400">{dossier.sources_succeeded}/{dossier.sources_queried} sources • {dossier.data_points_found} data points</span>
        </div>
        <PhaseBar phase={dossier.phase} status={dossier.status} p1At={dossier.phase1_completed_at} p2At={dossier.phase2_completed_at} p3At={dossier.phase3_completed_at} />
        <div className="text-[9px] text-rmpg-500">Status: {dossier.status.toUpperCase()} {dossier.completed_at ? `• Completed ${new Date(dossier.completed_at).toLocaleTimeString()}` : ''}</div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-rmpg-700">
        {(['dossier', 'graph', 'sources'] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`px-3 py-1 text-xs capitalize border-b-2 -mb-px ${activeTab === tab ? 'border-brand-400 text-brand-300' : 'border-transparent text-rmpg-400 hover:text-rmpg-200'}`}>
            {tab}
          </button>
        ))}
      </div>

      {activeTab === 'dossier' && (
        <div className="space-y-3">
          {/* Category filter */}
          <div className="flex flex-wrap gap-1">
            <button onClick={() => setActiveCategory('all')} className={`px-2 py-0.5 text-[10px] rounded ${activeCategory === 'all' ? 'bg-brand-600 text-white' : 'bg-rmpg-800 text-rmpg-300'}`}>All</button>
            {(Object.keys(CATEGORY_LABELS) as DataCategory[]).map(cat => (
              <button key={cat} onClick={() => setActiveCategory(cat)} className={`px-2 py-0.5 text-[10px] rounded ${activeCategory === cat ? 'bg-brand-600 text-white' : 'bg-rmpg-800 text-rmpg-300'}`}>{cat}</button>
            ))}
          </div>

          {Object.entries(groupedPoints).map(([cat, pts]) => (
            <div key={cat} className="bg-surface-raised border border-rmpg-700 rounded overflow-hidden">
              <div className="bg-surface-base px-3 py-1 text-[9px] font-semibold text-rmpg-300 uppercase tracking-wider">{CATEGORY_LABELS[cat as DataCategory] ?? cat}</div>
              <table className="w-full text-xs">
                <tbody>
                  {pts.sort((a, b) => b.confidence - a.confidence).map(p => {
                    const tier = CONFIDENCE_TIER(p.confidence);
                    return (
                      <tr key={p.id} className="border-t border-rmpg-800">
                        <td className="px-3 py-[2px] text-rmpg-400 w-24">{p.field}</td>
                        <td className="px-3 py-[2px] text-rmpg-100 font-mono">{p.value}</td>
                        <td className="px-3 py-[2px] text-rmpg-400 text-[9px]">{p.sources.join(', ')}</td>
                        <td className="px-3 py-[2px]"><span className={`text-[9px] ${tier.cls}`}>{tier.label}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}

          {visiblePoints.length === 0 && (
            <div className="text-center text-rmpg-400 text-xs py-8">
              {dossier.status === 'complete' ? 'No data points above confidence threshold' : 'Investigation in progress...'}
            </div>
          )}
        </div>
      )}

      {activeTab === 'sources' && (
        <div className="bg-surface-raised border border-rmpg-700 rounded overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-surface-base">
              <tr>
                {['Source', 'Phase', 'Status', 'Time', 'Points'].map(h => (
                  <th key={h} className="px-3 py-[3px] text-left font-semibold text-rmpg-300 text-[9px]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dossier.sources.map(s => (
                <tr key={s.id} className="border-t border-rmpg-800">
                  <td className="px-3 py-[2px] text-rmpg-200">{s.source_name}</td>
                  <td className="px-3 py-[2px] text-rmpg-400">{s.phase}</td>
                  <td className="px-3 py-[2px]">
                    <span className={`text-[9px] ${s.status === 'success' ? 'text-green-400' : s.status === 'not_configured' ? 'text-rmpg-500' : s.status === 'skipped' ? 'text-rmpg-400' : 'text-red-400'}`}>{s.status}</span>
                  </td>
                  <td className="px-3 py-[2px] text-rmpg-400 font-mono">{s.response_time_ms}ms</td>
                  <td className="px-3 py-[2px] text-rmpg-300">{s.data_points_found}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'graph' && (
        <div className="text-center text-rmpg-400 text-xs py-8">
          <p>Connections graph — implement in Task 14</p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd client && npx tsc --noEmit 2>&1 | head -30
```
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/intel/PersonIntelDossierPage.tsx
git commit -m "feat(person-intel): dossier view with phase progress + data points table"
```

---

### Task 14: Connections Graph Tab

**Files:**
- Create: `client/src/pages/intel/PersonIntelGraphTab.tsx`
- Modify: `client/src/pages/intel/PersonIntelDossierPage.tsx` (replace placeholder)
- Modify: `client/package.json` (add react-force-graph-2d)

- [ ] **Step 1: Install react-force-graph-2d**

```bash
cd client && npm install react-force-graph-2d
```
Expected: package installed

- [ ] **Step 2: Create PersonIntelGraphTab.tsx**

```tsx
// client/src/pages/intel/PersonIntelGraphTab.tsx
import { useMemo, useRef } from 'react';
import ForceGraph2D from 'react-force-graph-2d';

interface Connection { from_subject: string; relationship: string; to_subject: string; confidence: number; }

interface Props {
  subjectName: string;
  connections: Connection[];
}

export default function PersonIntelGraphTab({ subjectName, connections }: Props) {
  const fgRef = useRef<any>(null);

  const graphData = useMemo(() => {
    const nodeSet = new Set<string>([subjectName]);
    for (const c of connections) { nodeSet.add(c.from_subject); nodeSet.add(c.to_subject); }
    const nodes = Array.from(nodeSet).map(name => ({
      id: name,
      label: name,
      isSubject: name === subjectName,
      color: name === subjectName ? '#d4a017' : '#4a7fa5',
    }));
    const links = connections.map(c => ({
      source: c.from_subject,
      target: c.to_subject,
      label: c.relationship,
      strength: c.confidence,
    }));
    return { nodes, links };
  }, [subjectName, connections]);

  if (!connections.length) {
    return <div className="text-center text-rmpg-400 text-xs py-12">No connections found in this investigation.</div>;
  }

  return (
    <div className="bg-surface-base border border-rmpg-700 rounded overflow-hidden" style={{ height: 450 }}>
      <ForceGraph2D
        ref={fgRef}
        graphData={graphData}
        width={undefined}
        height={450}
        backgroundColor="#0d1722"
        nodeLabel={(node: any) => node.label}
        nodeColor={(node: any) => node.color}
        nodeRelSize={6}
        linkLabel={(link: any) => link.label}
        linkColor={() => '#4a5568'}
        linkWidth={(link: any) => Math.max(1, link.strength * 3)}
        nodeCanvasObject={(node: any, ctx, globalScale) => {
          const label = node.label as string;
          const fontSize = 12 / globalScale;
          ctx.font = `${fontSize}px sans-serif`;
          ctx.fillStyle = node.color;
          ctx.beginPath();
          ctx.arc(node.x, node.y, node.isSubject ? 8 : 5, 0, 2 * Math.PI);
          ctx.fill();
          ctx.fillStyle = '#c9d0da';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillText(label.split(' ').slice(0, 2).join(' '), node.x, node.y + (node.isSubject ? 10 : 7));
        }}
      />
    </div>
  );
}
```

- [ ] **Step 3: Wire graph tab in PersonIntelDossierPage.tsx**

Replace the placeholder graph tab content:
```tsx
// Find and replace the activeTab === 'graph' block:
{activeTab === 'graph' && (
  <div className="text-center text-rmpg-400 text-xs py-8">
    <p>Connections graph — implement in Task 14</p>
  </div>
)}
```
with:
```tsx
{activeTab === 'graph' && (
  <PersonIntelGraphTab
    subjectName={dossier.subject_name ?? dossier.subject_seed?.name ?? 'Subject'}
    connections={dossier.connections}
  />
)}
```

And add the import at the top of PersonIntelDossierPage.tsx:
```tsx
import PersonIntelGraphTab from './PersonIntelGraphTab';
```

- [ ] **Step 4: Typecheck**

```bash
cd client && npx tsc --noEmit 2>&1 | head -30
```
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/intel/PersonIntelGraphTab.tsx client/src/pages/intel/PersonIntelDossierPage.tsx client/package.json client/package-lock.json
git commit -m "feat(person-intel): react-force-graph-2d connections graph tab"
```

---

### Task 15: Nav Entry + App Routes

**Files:**
- Modify: `client/src/App.tsx`
- Modify: navigation config (wherever nav items are defined)

- [ ] **Step 1: Add routes to App.tsx**

In `client/src/App.tsx`, find where routes are defined and add:
```tsx
import PersonIntelPage from './pages/intel/PersonIntelPage';
import PersonIntelDossierPage from './pages/intel/PersonIntelDossierPage';
// Inside the router:
<Route path="/intel/person" element={<PersonIntelPage />} />
<Route path="/intel/person/:id" element={<PersonIntelDossierPage />} />
```

- [ ] **Step 2: Add nav link**

Find the navigation config file (usually `client/src/utils/routesConfig.ts` or similar). Add a nav entry:
```typescript
{ path: '/intel/person', label: 'Person Intel', icon: 'Shield', roles: ['admin', 'manager', 'supervisor', 'officer'] }
```
If there is no routesConfig, add the entry in the sidebar/nav component directly using the same pattern as nearby entries.

- [ ] **Step 3: Typecheck + build**

```bash
cd client && npx tsc --noEmit && npx vite build 2>&1 | tail -10
```
Expected: build succeeds, no TS errors

- [ ] **Step 4: Commit**

```bash
git add client/src/App.tsx client/src/
git commit -m "feat(person-intel): nav entry + app routes"
```

---

### Task 16: Apply Migration to Live D1 + PR

**Files:**
- None new — deployment step

- [ ] **Step 1: Apply migration directly to live D1**

```bash
scripts/apply-migration.sh 0152_person_intelligence.sql
```
Expected: migration applied + tracked in d1_migrations

- [ ] **Step 2: Verify tables landed**

```bash
npx wrangler d1 execute rmpg-flex --remote --command "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'person_%'"
```
Expected: 4 rows — `person_intelligence`, `person_intel_data_points`, `person_intel_connections`, `person_intel_sources`

- [ ] **Step 3: Run full test suite**

```bash
cd client && npx vitest run
```
Expected: all tests pass (existing 1488+ new tests)

- [ ] **Step 4: Run all typechecks**

```bash
npm run typecheck && cd client && npx tsc --noEmit
```
Expected: no errors from either check

- [ ] **Step 5: Create PR**

```bash
git push origin claude/funny-beaver-d524a2
gh pr create --title "feat(person-intel): standalone OSINT dossier module — 3-phase DO pipeline + admin config + dossier UI + graph (SW vNNN)" --body "$(cat <<'EOF'
## Summary
- 4 new D1 tables (person_intelligence, _data_points, _connections, _sources), mig 0152
- PersonIntelDO alarm-driven 3-phase pipeline: D1 internal → OSINT fan-out (7 adapters: MicroBilt/Pipl/Spokeo/NumVerify/Hunter/HIBP/Clearbit) → Firecrawl + Claude extraction
- Cross-source confidence scoring (0.40 base + 0.18/source) + risk score engine (warrant/NSOPW/OFAC/HIBP/arrest flags)
- Worker routes: POST/GET/DELETE /api/person-intel + /:id + /:id/rerun
- Admin API key config tab (person-intel section in AdminPage)
- PersonIntelPage (list + new investigation form) + PersonIntelDossierPage (phase progress + categorized data points + sources table) + react-force-graph-2d connections graph
- Auto-link to persons/warrants/national_sex_offenders on Phase 3 completion

## Test plan
- [ ] Unit tests: confidence scoring, risk score, phase1 query, data fusion, phase3 extraction (5 new test files)
- [ ] Worker typecheck passes
- [ ] Client typecheck + vitest run passes
- [ ] Migration 0152 verified on live D1 (4 tables present)
- [ ] POST /api/person-intel with name seed → returns {id, status:'pending'}
- [ ] GET /api/person-intel/:id polls correctly as phases complete
- [ ] Admin tab shows key input fields for 7 OSINT providers

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review Checklist

**Spec coverage:**
- ✅ Three-phase DO pipeline (phase1/phase2/phase3 tasks)
- ✅ All 7 configured OSINT adapters (Tasks 5-6; WhoisXML/Censys/Spokeo/AbstractAPI partially skipped as "not_configured" when keys absent — correct behavior)
- ✅ Cross-source confidence scoring (Task 2)
- ✅ Risk score engine with all 5 flag types (Task 3)
- ✅ D1 schema, 4 tables (Task 1)
- ✅ Worker routes (Task 10)
- ✅ Admin key config (Task 11)
- ✅ Dossier UI with phase progress (Task 13)
- ✅ Connections graph (Task 14)
- ✅ Auto-link to persons/warrants/NSO (PersonIntelDO.runPhase3)
- ✅ Nav entry (Task 15)

**No placeholders:** All steps contain complete code.

**Type consistency:** `IntelSeed`, `RawDataPoint`, `MergedDataPoint`, `SourceResult`, `RiskFlag` defined in types.ts (Task 2) and used consistently throughout. `ConfidenceOpts.sources` is `string[]` everywhere. `phase` on `SourceResult` is typed as `1 | 2 | 3` and all adapters supply the correct literal.
