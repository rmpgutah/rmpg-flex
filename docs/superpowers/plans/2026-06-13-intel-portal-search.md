# Intel Portal — Phase 2: Supercharged Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat `/intel/search` list with a parser-driven, faceted, card-based search: an extended operator grammar, ranked rich preview cards, same-identity clustering, and saved searches + history.

**Architecture:** A pure client `parseQuery()` turns analyst text (operators + free text) into a structured query. A NEW worker endpoint `GET /api/intel/query` (sibling to the untouched `/search`, so `GlobalSearch` is unaffected) executes the structured query — targeted identifier/name/addr/case lookups + FTS free-text + flag/type/date filtering — and returns enriched hits (with `photo_url`) plus facet counts. The `IntelSearch` page composes parser → query → facet sidebar → preview cards, with same-canonical-identity clustering and a saved-searches/recent-history bar. One new migration (`0107`) adds `intel_saved_searches` + `intel_search_history`.

**Tech Stack:** React 18 + TS + Vite + Tailwind (client); Hono + D1 (worker, `query`/`queryFirst`/`execute` from `src/utils/db.ts`); Vitest (client TDD). Worker verified via typecheck + live-D1 SQL execution (no worker test runner).

**Operator grammar (user-chosen "Extended"):** `plate:` `vin:` `dob:` `phone:` `dl:` `case:` `name:"…"` `addr:"…"` `type:` `flag:` `since:` `until:` + free text. Identifier auto-detection still works without operators.

**Schema facts (verified live D1 `785de7ae`):** `persons(dob, address, city, phone, dl_number, photo_url, flags, first_name, last_name)`; `cases(case_number, title, status, opened_date, created_at)`; `vehicles_records(plate_number, vin, make, model, color)`. `intel_index` FTS exists. `intel_saved_searches` / `intel_search_history` do NOT exist (this plan creates them). Migration high-water on main is `0106` → this plan uses **`0107`**.

**Design tokens:** pure-black `#000`, raised `#0b0b0b`, gold `#d4a017`, gray `#888`, zero blue, borders `#232323`/`#3a3a3a`, **2px radius only**.

**Honest scope note on `since:`/`until:`:** date filtering applies only to result rows that carry a known date (the targeted case/incident/call branches). FTS/identifier hits without a date are NOT excluded by a date range — the UI labels the active date filter as "applied to dated records." This is deliberate partial support, documented, not silent.

---

## File Structure

**Create (client):**
- `client/src/pages/intel/useQueryParser.ts` — pure `parseQuery(raw): ParsedQuery` + `ParsedQuery` type
- `client/src/pages/intel/useIntelQuery.ts` — calls `/api/intel/query`, returns hits + facets + loading/error
- `client/src/pages/intel/clusterHits.ts` — pure same-canonical clustering
- `client/src/pages/intel/IntelSearch.tsx` — the supercharged page (replaces old IntelSearchPage at `/intel/search`)
- `client/src/pages/intel/search/SearchBar.tsx` — input + operator hint + saved/recent dropdowns
- `client/src/pages/intel/search/FacetSidebar.tsx` — type + flag facet counts
- `client/src/pages/intel/search/ResultCard.tsx` — person/vehicle/generic preview card
- `client/src/pages/intel/useSavedSearches.ts` — saved searches + history hook
- Tests under `client/src/pages/intel/__tests__/` and `client/src/pages/intel/search/__tests__/`

**Create (worker):**
- `src/utils/intelQuery.ts` — `runIntelQuery(db, params): Promise<{ results: QueryHit[]; facets: Facets }>`
- `migrations/0107_intel_search.sql` — `intel_saved_searches` + `intel_search_history`

**Modify:**
- `src/routes/intel.ts` — register `GET /query`, `GET/POST/DELETE /saved-searches`, `GET /search-history`
- `client/src/App.tsx` — point `/intel/search` child route at `IntelSearch` (instead of `IntelSearchPage`)
- `client/public/sw.js` — bump `CACHE_NAME`

---

## Task 1: Query parser (`useQueryParser.ts`)

**Files:**
- Create: `client/src/pages/intel/useQueryParser.ts`
- Test: `client/src/pages/intel/__tests__/useQueryParser.test.ts`

- [ ] **Step 1: Write the failing test**

Create `client/src/pages/intel/__tests__/useQueryParser.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseQuery } from '../useQueryParser';

describe('parseQuery', () => {
  it('extracts free text when no operators', () => {
    const p = parseQuery('hale vincent');
    expect(p.text).toBe('hale vincent');
    expect(p.flags).toEqual([]);
  });

  it('parses simple operators', () => {
    const p = parseQuery('plate:8XQ220 type:vehicle');
    expect(p.identifiers.plate).toBe('8XQ220');
    expect(p.type).toBe('vehicle');
    expect(p.text).toBe('');
  });

  it('parses quoted values for name and addr', () => {
    const p = parseQuery('name:"Hale Vincent" addr:"123 Main St"');
    expect(p.name).toBe('Hale Vincent');
    expect(p.addr).toBe('123 Main St');
  });

  it('accumulates multiple flags', () => {
    const p = parseQuery('flag:warrant flag:gang river');
    expect(p.flags.sort()).toEqual(['gang', 'warrant']);
    expect(p.text).toBe('river');
  });

  it('parses identifiers, dl, case, and date range', () => {
    const p = parseQuery('dob:1991-08-02 phone:5550101 vin:1FT dl:D12345 case:2026-001 since:2026-01-01 until:2026-06-01');
    expect(p.identifiers.dob).toBe('1991-08-02');
    expect(p.identifiers.phone).toBe('5550101');
    expect(p.identifiers.vin).toBe('1FT');
    expect(p.identifiers.dl).toBe('D12345');
    expect(p.identifiers.case).toBe('2026-001');
    expect(p.since).toBe('2026-01-01');
    expect(p.until).toBe('2026-06-01');
  });

  it('treats unknown key:value as free text', () => {
    const p = parseQuery('color:red ford');
    expect(p.text).toContain('color:red');
    expect(p.text).toContain('ford');
  });

  it('toQueryParams produces a flat param object for the API', () => {
    const p = parseQuery('name:"Jane Doe" flag:warrant type:person');
    const qp = require('../useQueryParser').toQueryParams(p);
    expect(qp.name).toBe('Jane Doe');
    expect(qp.flag).toBe('warrant');
    expect(qp.type).toBe('person');
  });
});
```

- [ ] **Step 2: Run the test, verify it FAILS** (cannot find module `../useQueryParser`)

Run: `cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/hopeful-bhabha-b1ccce/client" && npx vitest run src/pages/intel/__tests__/useQueryParser.test.ts`

- [ ] **Step 3: Implement `client/src/pages/intel/useQueryParser.ts`**

```ts
// Pure query-language parser for Intel Search. Turns analyst text with field
// operators into a structured ParsedQuery. Identifier auto-detection still
// happens server-side; this just lets analysts scope explicitly.
//
// Grammar: key:value or key:"quoted value". Known keys below; anything else
// (unknown key, or bare words) becomes free text.

export interface ParsedQuery {
  text: string;
  type?: string;
  name?: string;
  addr?: string;
  flags: string[];
  identifiers: { plate?: string; vin?: string; dob?: string; phone?: string; dl?: string; case?: string };
  since?: string;
  until?: string;
}

const KNOWN = new Set(['plate', 'vin', 'dob', 'phone', 'dl', 'case', 'name', 'addr', 'type', 'flag', 'since', 'until']);
// Matches  key:"quoted value"  OR  key:bareword  (bareword = no spaces)
const TOKEN = /(\w+):(?:"([^"]*)"|(\S+))/g;

export function parseQuery(raw: string): ParsedQuery {
  const out: ParsedQuery = { text: '', flags: [], identifiers: {} };
  const leftover: string[] = [];
  let lastIndex = 0;
  const input = raw || '';

  let m: RegExpExecArray | null;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(input)) !== null) {
    // Capture any free text BETWEEN tokens.
    const between = input.slice(lastIndex, m.index).trim();
    if (between) leftover.push(between);
    lastIndex = TOKEN.lastIndex;

    const key = m[1].toLowerCase();
    const value = (m[2] !== undefined ? m[2] : m[3]) || '';
    if (!KNOWN.has(key)) { leftover.push(m[0]); continue; } // unknown operator → free text

    switch (key) {
      case 'type': out.type = value.toLowerCase(); break;
      case 'name': out.name = value; break;
      case 'addr': out.addr = value; break;
      case 'flag': if (value) out.flags.push(value.toLowerCase()); break;
      case 'since': out.since = value; break;
      case 'until': out.until = value; break;
      case 'plate': out.identifiers.plate = value; break;
      case 'vin': out.identifiers.vin = value; break;
      case 'dob': out.identifiers.dob = value; break;
      case 'phone': out.identifiers.phone = value; break;
      case 'dl': out.identifiers.dl = value; break;
      case 'case': out.identifiers.case = value; break;
    }
  }
  const tail = input.slice(lastIndex).trim();
  if (tail) leftover.push(tail);
  out.text = leftover.join(' ').trim();
  return out;
}

/** Flatten a ParsedQuery into the query-string params the API expects. */
export function toQueryParams(p: ParsedQuery): Record<string, string> {
  const qp: Record<string, string> = {};
  if (p.text) qp.q = p.text;
  if (p.type) qp.type = p.type;
  if (p.name) qp.name = p.name;
  if (p.addr) qp.addr = p.addr;
  if (p.flags.length) qp.flag = p.flags.join(',');
  if (p.since) qp.since = p.since;
  if (p.until) qp.until = p.until;
  for (const [k, v] of Object.entries(p.identifiers)) if (v) qp[k] = v;
  return qp;
}
```

> Note: the test uses `require('../useQueryParser').toQueryParams` — keep both `parseQuery` and `toQueryParams` as named exports.

- [ ] **Step 4: Run the test, verify it PASSES** (all cases)

Run: `cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/hopeful-bhabha-b1ccce/client" && npx vitest run src/pages/intel/__tests__/useQueryParser.test.ts`

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/intel/useQueryParser.ts client/src/pages/intel/__tests__/useQueryParser.test.ts
git commit -m "feat(intel): extended query-operator parser for supercharged search"
```

---

## Task 2: Migration 0107 — saved searches + history

**Files:**
- Create: `migrations/0107_intel_search.sql`

- [ ] **Step 1: Write the migration**

Create `migrations/0107_intel_search.sql`:

```sql
-- Intel Portal Phase 2: per-user saved searches + recent history.
CREATE TABLE IF NOT EXISTS intel_saved_searches (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL,
  name        TEXT NOT NULL,
  query_text  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, name)
);
CREATE INDEX IF NOT EXISTS idx_saved_searches_user ON intel_saved_searches(user_id);

CREATE TABLE IF NOT EXISTS intel_search_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL,
  query_text  TEXT NOT NULL,
  executed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_search_history_user ON intel_search_history(user_id, executed_at);
```

- [ ] **Step 2: Apply locally (optional) + record for live**

Run: `cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/hopeful-bhabha-b1ccce" && npm run migrate:local 2>&1 | tail -5` (if it errors on environment, skip — the controller applies to live D1 directly, see Step 3).

- [ ] **Step 3: Apply DDL directly to live D1 (controller task)**

The deploy migration step is `continue-on-error` and historically misses live. The controller applies the two `CREATE TABLE`/`CREATE INDEX` statements to live `785de7ae` via the Cloudflare D1 API and verifies with `SELECT name FROM sqlite_master WHERE name IN ('intel_saved_searches','intel_search_history')`. (The worker route code tolerates the tables being briefly absent via try/catch.)

- [ ] **Step 4: Commit**

```bash
git add migrations/0107_intel_search.sql
git commit -m "feat(intel): migration 0107 — saved searches + search history tables"
```

---

## Task 3: Worker query engine (`intelQuery.ts`)

**Files:**
- Create: `src/utils/intelQuery.ts`
- Modify: `src/routes/intel.ts` (register `GET /query`)

- [ ] **Step 1: Write `src/utils/intelQuery.ts`**

```ts
// Parser-driven advanced search. Sibling to /search (which stays untouched for
// GlobalSearch). Builds targeted identifier/name/addr/case lookups + FTS free
// text, enriches person hits with photo_url + flags + cluster, and returns
// facet counts. Each branch is try/catch-isolated. SQL verified vs live D1.
import type { D1Database } from '@cloudflare/workers-types';
import { query } from './db';
import { personFlagsForIds } from './intelQueryFlags';

export interface QueryHit {
  type: string; id: number; label: string; snippet: string;
  flags: string[]; score: number; photo_url?: string | null;
  cluster?: { canonical_person_id: number | null; pending_suggestions: number };
  date?: string | null;
}
export interface Facets { byType: Record<string, number>; byFlag: Record<string, number> }
export interface QueryParams {
  q?: string; type?: string; name?: string; addr?: string; flag?: string;
  plate?: string; vin?: string; dob?: string; phone?: string; dl?: string; case?: string;
  since?: string; until?: string; limit?: number;
}

const esc = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
const like = (s: string) => `%${esc(s)}%`;

export async function runIntelQuery(db: D1Database, p: QueryParams): Promise<{ results: QueryHit[]; facets: Facets }> {
  const limit = Math.min(p.limit || 50, 100);
  const hits = new Map<string, QueryHit>();
  const put = (h: QueryHit) => { const k = `${h.type}:${h.id}`; if (!hits.has(k) || hits.get(k)!.score < h.score) hits.set(k, h); };

  // name: → persons by name
  if (p.name) {
    try {
      for (const r of await query<any>(db,
        `SELECT id, first_name, last_name, photo_url FROM persons
          WHERE (COALESCE(first_name,'') || ' ' || COALESCE(last_name,'')) LIKE ? ESCAPE '\\' LIMIT ?`,
        like(p.name), limit))
        put({ type: 'person', id: r.id, label: `${r.first_name || ''} ${r.last_name || ''}`.trim(), snippet: '', flags: [], score: 95, photo_url: r.photo_url });
    } catch (e: any) { console.error('[query] name:', e?.message); }
  }
  // addr: → persons by address/city
  if (p.addr) {
    try {
      for (const r of await query<any>(db,
        `SELECT id, first_name, last_name, photo_url, address FROM persons
          WHERE COALESCE(address,'') LIKE ? ESCAPE '\\' OR COALESCE(city,'') LIKE ? ESCAPE '\\' LIMIT ?`,
        like(p.addr), like(p.addr), limit))
        put({ type: 'person', id: r.id, label: `${r.first_name || ''} ${r.last_name || ''}`.trim(), snippet: r.address || '', flags: [], score: 80, photo_url: r.photo_url });
    } catch (e: any) { console.error('[query] addr:', e?.message); }
  }
  // dl: / dob: / phone: → persons exact-ish
  for (const [col, val, sc] of [['dl_number', p.dl, 92], ['dob', p.dob, 92], ['phone', p.phone, 92]] as const) {
    if (!val) continue;
    try {
      for (const r of await query<any>(db,
        `SELECT id, first_name, last_name, photo_url FROM persons WHERE COALESCE(${col},'') LIKE ? ESCAPE '\\' LIMIT ?`,
        like(String(val)), limit))
        put({ type: 'person', id: r.id, label: `${r.first_name || ''} ${r.last_name || ''}`.trim(), snippet: `${col}: ${val}`, flags: [], score: sc, photo_url: r.photo_url });
    } catch (e: any) { console.error(`[query] ${col}:`, e?.message); }
  }
  // plate: / vin: → vehicles_records
  for (const [col, val] of [['plate_number', p.plate], ['vin', p.vin]] as const) {
    if (!val) continue;
    try {
      for (const r of await query<any>(db,
        `SELECT id, plate_number, make, model, color, vin FROM vehicles_records WHERE COALESCE(${col},'') LIKE ? ESCAPE '\\' LIMIT ?`,
        like(String(val)), limit))
        put({ type: 'vehicle', id: r.id, label: [r.color, r.make, r.model].filter(Boolean).join(' ') + (r.plate_number ? ` (${r.plate_number})` : ''), snippet: r.vin || '', flags: [], score: 92 });
    } catch (e: any) { console.error(`[query] ${col}:`, e?.message); }
  }
  // case: → cases by case_number
  if (p.case) {
    try {
      for (const r of await query<any>(db,
        `SELECT id, case_number, title, opened_date FROM cases WHERE COALESCE(case_number,'') LIKE ? ESCAPE '\\' LIMIT ?`,
        like(p.case), limit))
        put({ type: 'case', id: r.id, label: r.case_number || r.title || `Case #${r.id}`, snippet: r.title || '', flags: [], score: 92, date: r.opened_date });
    } catch (e: any) { console.error('[query] case:', e?.message); }
  }
  // q free text → FTS over intel_index (best-effort; LIKE fallback on persons)
  if (p.q && p.q.trim().length >= 2) {
    const term = p.q.trim();
    try {
      for (const r of await query<any>(db,
        `SELECT entity_type, entity_id, label, snippet(intel_index, 3, '[', ']', '…', 12) AS snip, bm25(intel_index) AS rank
           FROM intel_index WHERE intel_index MATCH ? ORDER BY rank LIMIT ?`,
        term.split(/\s+/).map((t) => `"${t.replace(/"/g, '')}"`).join(' '), limit))
        put({ type: r.entity_type, id: Number(r.entity_id), label: r.label, snippet: r.snip || '', flags: [], score: 50 - Number(r.rank) });
    } catch (e: any) {
      console.error('[query] FTS, LIKE fallback:', e?.message);
      try {
        for (const r of await query<any>(db,
          `SELECT id, first_name, last_name, photo_url FROM persons WHERE (COALESCE(first_name,'') || ' ' || COALESCE(last_name,'')) LIKE ? ESCAPE '\\' LIMIT ?`,
          like(term), limit))
          put({ type: 'person', id: r.id, label: `${r.first_name || ''} ${r.last_name || ''}`.trim(), snippet: '', flags: [], score: 20, photo_url: r.photo_url });
      } catch (e2: any) { console.error('[query] LIKE fallback:', e2?.message); }
    }
  }

  let results = [...hits.values()];

  // type: filter
  if (p.type) results = results.filter((r) => r.type === p.type);
  // since/until: drop only hits that HAVE a date outside the range (undated pass through)
  if (p.since) results = results.filter((r) => !r.date || r.date >= p.since!);
  if (p.until) results = results.filter((r) => !r.date || r.date <= p.until!);

  // Person enrichment: flags (warrant/officer-safety/gang) + cluster + flag: filter
  const personIds = results.filter((r) => r.type === 'person').map((r) => r.id);
  if (personIds.length) {
    const { flags, canon, pending } = await personFlagsForIds(db, personIds);
    for (const r of results) if (r.type === 'person') {
      r.flags = flags.get(r.id) || [];
      r.cluster = { canonical_person_id: canon.get(r.id) ?? null, pending_suggestions: pending.get(r.id) || 0 };
    }
  }
  // flag: filter (after enrichment) — match against the person's hot flags (lowercased contains)
  if (p.flag) {
    const wanted = p.flag.split(',').map((f) => f.trim().toLowerCase()).filter(Boolean);
    results = results.filter((r) => wanted.every((w) => r.flags.some((f) => f.toLowerCase().includes(w))));
  }

  results.sort((a, b) => b.score - a.score);
  results = results.slice(0, limit);

  // Facets over the final set.
  const facets: Facets = { byType: {}, byFlag: {} };
  for (const r of results) {
    facets.byType[r.type] = (facets.byType[r.type] || 0) + 1;
    for (const f of r.flags) facets.byFlag[f] = (facets.byFlag[f] || 0) + 1;
  }
  return { results, facets };
}
```

- [ ] **Step 2: Write `src/utils/intelQueryFlags.ts`** (person enrichment helper — mirrors the inline logic already in `/search` so we don't import a route)

```ts
import type { D1Database } from '@cloudflare/workers-types';
import { query } from './db';

const isReal = (v: unknown) => v != null && String(v).trim() !== '';

export async function personFlagsForIds(db: D1Database, ids: number[]): Promise<{
  flags: Map<number, string[]>; canon: Map<number, number>; pending: Map<number, number>;
}> {
  const flags = new Map<number, string[]>(), canon = new Map<number, number>(), pending = new Map<number, number>();
  if (!ids.length) return { flags, canon, pending };
  const ph = ids.map(() => '?').join(',');
  try {
    for (const w of await query<any>(db,
      `SELECT COALESCE(subject_person_id, person_id) AS pid FROM warrants
        WHERE LOWER(COALESCE(status,'')) IN ('active','outstanding') AND COALESCE(subject_person_id, person_id) IN (${ph})`, ...ids))
      flags.set(w.pid, [...(flags.get(w.pid) || []), 'ACTIVE WARRANT']);
  } catch (e: any) { console.error('[queryflags] warrants:', e?.message); }
  try {
    for (const p of await query<any>(db, `SELECT id, flags FROM persons WHERE id IN (${ph})`, ...ids)) {
      const f = isReal(p.flags) ? String(p.flags).toLowerCase() : '';
      if (f.includes('officer safety') || f.includes('violent')) flags.set(p.id, [...(flags.get(p.id) || []), 'OFFICER SAFETY']);
      if (f.includes('gang')) flags.set(p.id, [...(flags.get(p.id) || []), 'GANG']);
    }
  } catch (e: any) { console.error('[queryflags] persons:', e?.message); }
  try {
    for (const r of await query<any>(db, `SELECT person_id, canonical_person_id FROM person_canonical WHERE person_id IN (${ph})`, ...ids))
      canon.set(r.person_id, r.canonical_person_id);
    for (const r of await query<any>(db,
      `SELECT person_a AS pid, COUNT(*) AS n FROM entity_resolution_suggestions WHERE status='pending' AND person_a IN (${ph}) GROUP BY person_a`, ...ids))
      pending.set(r.pid, r.n);
    for (const r of await query<any>(db,
      `SELECT person_b AS pid, COUNT(*) AS n FROM entity_resolution_suggestions WHERE status='pending' AND person_b IN (${ph}) GROUP BY person_b`, ...ids))
      pending.set(r.pid, (pending.get(r.pid) || 0) + r.n);
  } catch (e: any) { console.error('[queryflags] cluster:', e?.message); }
  return { flags, canon, pending };
}
```

- [ ] **Step 3: Register `GET /query` in `src/routes/intel.ts`**

Add import near the other utils:
```ts
import { runIntelQuery } from '../utils/intelQuery';
```
Add the route after the existing `/search` route:
```ts
// GET /query — parser-driven advanced search (rich hits + facets). Sibling to
// /search, which stays as-is for GlobalSearch.
intel.get('/query', operational, async (c) => {
  const p = {
    q: c.req.query('q'), type: c.req.query('type'), name: c.req.query('name'), addr: c.req.query('addr'),
    flag: c.req.query('flag'), plate: c.req.query('plate'), vin: c.req.query('vin'), dob: c.req.query('dob'),
    phone: c.req.query('phone'), dl: c.req.query('dl'), case: c.req.query('case'),
    since: c.req.query('since'), until: c.req.query('until'),
    limit: parseInt(c.req.query('limit') || '50', 10) || 50,
  };
  // Best-effort history record (never blocks the response).
  try {
    const userId = (c.var as any).user?.userId ?? (c.var as any).user?.id;
    const raw = c.req.query('raw') || '';
    if (userId && raw.trim()) await c.env.DB.prepare(
      'INSERT INTO intel_search_history (user_id, query_text) VALUES (?, ?)').bind(userId, raw.slice(0, 500)).run();
  } catch { /* history table may be briefly absent; ignore */ }
  return c.json(await runIntelQuery(getDb(c.env), p));
});
```

- [ ] **Step 4: Worker typecheck**

Run: `cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/hopeful-bhabha-b1ccce" && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Controller verifies the SQL against live D1**

Run each branch's SQL against live `785de7ae` (name, addr, dl/dob/phone, plate/vin, case, FTS) to confirm execution + adjust any column drift. Every branch is try/catch so worst case degrades, but confirm the common ones return rows.

- [ ] **Step 6: Commit**

```bash
git add src/utils/intelQuery.ts src/utils/intelQueryFlags.ts src/routes/intel.ts
git commit -m "feat(intel): /api/intel/query parser-driven advanced search + facets"
```

---

## Task 4: Saved-searches + history endpoints

**Files:**
- Modify: `src/routes/intel.ts`

- [ ] **Step 1: Add the routes** (after `/query`, using the existing `operational` gate and `getDb`):

```ts
// Saved searches (per user).
intel.get('/saved-searches', operational, async (c) => {
  const uid = (c.var as any).user?.userId ?? (c.var as any).user?.id;
  try {
    return c.json(await query(getDb(c.env),
      'SELECT id, name, query_text, created_at FROM intel_saved_searches WHERE user_id = ? ORDER BY created_at DESC', uid));
  } catch { return c.json([]); }
});
intel.post('/saved-searches', operational, async (c) => {
  const uid = (c.var as any).user?.userId ?? (c.var as any).user?.id;
  const body = await c.req.json<{ name?: string; query_text?: string }>().catch(() => ({}));
  if (!body.name || !body.query_text) return c.json({ error: 'name and query_text required' }, 400);
  await execute(getDb(c.env),
    `INSERT INTO intel_saved_searches (user_id, name, query_text) VALUES (?, ?, ?)
       ON CONFLICT(user_id, name) DO UPDATE SET query_text = excluded.query_text`,
    uid, body.name.slice(0, 80), body.query_text.slice(0, 500));
  return c.json({ success: true });
});
intel.delete('/saved-searches/:id', operational, async (c) => {
  const uid = (c.var as any).user?.userId ?? (c.var as any).user?.id;
  await execute(getDb(c.env), 'DELETE FROM intel_saved_searches WHERE id = ? AND user_id = ?', c.req.param('id'), uid);
  return c.json({ success: true });
});
// Recent history (distinct, latest 10).
intel.get('/search-history', operational, async (c) => {
  const uid = (c.var as any).user?.userId ?? (c.var as any).user?.id;
  try {
    return c.json(await query(getDb(c.env),
      `SELECT query_text, MAX(executed_at) AS executed_at FROM intel_search_history
        WHERE user_id = ? GROUP BY query_text ORDER BY executed_at DESC LIMIT 10`, uid));
  } catch { return c.json([]); }
});
```

Confirm `execute` is imported in `intel.ts` (it is — used elsewhere). If not, add it to the `db` import.

- [ ] **Step 2: Worker typecheck**

Run: `npm run typecheck` → PASS.

- [ ] **Step 3: Commit**

```bash
git add src/routes/intel.ts
git commit -m "feat(intel): saved-searches CRUD + recent search-history endpoints"
```

---

## Task 5: `useIntelQuery` hook + `clusterHits` util

**Files:**
- Create: `client/src/pages/intel/useIntelQuery.ts`
- Create: `client/src/pages/intel/clusterHits.ts`
- Test: `client/src/pages/intel/__tests__/clusterHits.test.ts`

- [ ] **Step 1: Write the failing test for clustering**

Create `client/src/pages/intel/__tests__/clusterHits.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { clusterHits } from '../clusterHits';
import type { QueryHit } from '../useIntelQuery';

const h = (id: number, canonical: number | null): QueryHit => ({
  type: 'person', id, label: `P${id}`, snippet: '', flags: [], score: 50,
  cluster: { canonical_person_id: canonical, pending_suggestions: 0 },
});

describe('clusterHits', () => {
  it('collapses persons sharing a canonical id into one card', () => {
    const out = clusterHits([h(1, 5), h(2, 5), h(3, null)]);
    // 1 and 2 share canonical 5 → one cluster; 3 stands alone
    expect(out.length).toBe(2);
    const merged = out.find((c) => c.linkedCount && c.linkedCount > 1);
    expect(merged?.linkedCount).toBe(2);
  });

  it('leaves non-person hits untouched', () => {
    const v: QueryHit = { type: 'vehicle', id: 9, label: 'Ford', snippet: '', flags: [], score: 40 };
    const out = clusterHits([v]);
    expect(out.length).toBe(1);
    expect(out[0].hit.type).toBe('vehicle');
  });
});
```

- [ ] **Step 2: Run, verify FAIL** (`../clusterHits` missing)

Run: `cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/hopeful-bhabha-b1ccce/client" && npx vitest run src/pages/intel/__tests__/clusterHits.test.ts`

- [ ] **Step 3: Implement both files**

`client/src/pages/intel/useIntelQuery.ts`:
```ts
// Calls /api/intel/query with the parsed structured params. Returns enriched
// hits + facet counts. Debounced by the caller; this just fetches.
import { useState, useCallback } from 'react';
import { apiFetch } from '../../hooks/useApi';
import { toQueryParams, type ParsedQuery } from './useQueryParser';

export interface QueryHit {
  type: string; id: number; label: string; snippet: string;
  flags: string[]; score: number; photo_url?: string | null;
  cluster?: { canonical_person_id: number | null; pending_suggestions: number };
  date?: string | null;
}
export interface Facets { byType: Record<string, number>; byFlag: Record<string, number> }

export function useIntelQuery() {
  const [results, setResults] = useState<QueryHit[]>([]);
  const [facets, setFacets] = useState<Facets>({ byType: {}, byFlag: {} });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback((parsed: ParsedQuery, raw: string) => {
    const qp = toQueryParams(parsed);
    if (Object.keys(qp).length === 0) { setResults([]); setFacets({ byType: {}, byFlag: {} }); return; }
    qp.raw = raw; // for server-side history
    setLoading(true);
    apiFetch<{ results: QueryHit[]; facets: Facets }>(`/intel/query?${new URLSearchParams(qp).toString()}`)
      .then((r) => { setResults(r.results || []); setFacets(r.facets || { byType: {}, byFlag: {} }); setError(null); })
      .catch((e) => setError(e?.message || 'search failed'))
      .finally(() => setLoading(false));
  }, []);

  return { results, facets, loading, error, run };
}
```

`client/src/pages/intel/clusterHits.ts`:
```ts
// Collapse person hits that resolve to the same canonical identity into one
// card (so duplicates of the same human don't spam results). Non-persons and
// persons without a canonical link pass through as singletons.
import type { QueryHit } from './useIntelQuery';

export interface ClusteredHit { hit: QueryHit; linkedCount: number }

export function clusterHits(hits: QueryHit[]): ClusteredHit[] {
  const byCanonical = new Map<number, QueryHit[]>();
  const out: ClusteredHit[] = [];
  for (const h of hits) {
    const canonical = h.type === 'person' ? h.cluster?.canonical_person_id ?? null : null;
    if (canonical == null) { out.push({ hit: h, linkedCount: 1 }); continue; }
    byCanonical.set(canonical, [...(byCanonical.get(canonical) || []), h]);
  }
  for (const group of byCanonical.values()) {
    group.sort((a, b) => b.score - a.score);
    out.push({ hit: group[0], linkedCount: group.length });
  }
  out.sort((a, b) => b.hit.score - a.hit.score);
  return out;
}
```

- [ ] **Step 4: Run the clustering test, verify PASS**

Run: `cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/hopeful-bhabha-b1ccce/client" && npx vitest run src/pages/intel/__tests__/clusterHits.test.ts`

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/intel/useIntelQuery.ts client/src/pages/intel/clusterHits.ts client/src/pages/intel/__tests__/clusterHits.test.ts
git commit -m "feat(intel): useIntelQuery hook + same-identity clustering"
```

---

## Task 6: Result card + facet sidebar components

**Files:**
- Create: `client/src/pages/intel/search/ResultCard.tsx`
- Create: `client/src/pages/intel/search/FacetSidebar.tsx`
- Test: `client/src/pages/intel/search/__tests__/searchUi.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `client/src/pages/intel/search/__tests__/searchUi.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import ResultCard from '../ResultCard';
import FacetSidebar from '../FacetSidebar';

describe('search UI', () => {
  it('ResultCard shows label, flags, linked badge and fires onSelect', () => {
    const onSelect = vi.fn();
    render(<ResultCard
      clustered={{ hit: { type: 'person', id: 2, label: 'HALE, Vincent', snippet: '', flags: ['ACTIVE WARRANT'], score: 90 }, linkedCount: 3 }}
      onSelect={onSelect} onOpen={() => {}} />);
    expect(screen.getByText('HALE, Vincent')).toBeInTheDocument();
    expect(screen.getByText('ACTIVE WARRANT')).toBeInTheDocument();
    expect(screen.getByText(/3 linked/i)).toBeInTheDocument();
    fireEvent.click(screen.getByText('HALE, Vincent'));
    expect(onSelect).toHaveBeenCalledWith('person', 2, 'HALE, Vincent');
  });

  it('FacetSidebar lists type counts and fires onToggleType', () => {
    const onToggleType = vi.fn();
    render(<FacetSidebar facets={{ byType: { person: 4, vehicle: 1 }, byFlag: { 'active warrant': 2 } }}
      activeType={null} activeFlags={[]} onToggleType={onToggleType} onToggleFlag={() => {}} />);
    expect(screen.getByText(/person/i)).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    fireEvent.click(screen.getByText(/person/i));
    expect(onToggleType).toHaveBeenCalledWith('person');
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/hopeful-bhabha-b1ccce/client" && npx vitest run src/pages/intel/search/__tests__/searchUi.test.tsx`

- [ ] **Step 3: Implement both components**

`client/src/pages/intel/search/ResultCard.tsx`:
```tsx
import { authedImageUrl } from '../../../hooks/useApi';
import type { ClusteredHit } from '../clusterHits';

const TYPE_TAG: Record<string, string> = {
  person: 'text-[#d4a017]', vehicle: 'text-[#10b981]', warrant: 'text-[#ff6b5e]',
  case: 'text-[#d4a017]', incident: 'text-[#f59e0b]', call: 'text-[#22d3ee]',
};

export default function ResultCard({ clustered, onSelect, onOpen }: {
  clustered: ClusteredHit;
  onSelect: (type: string, id: number, label: string) => void;
  onOpen: (type: string, id: number) => void;
}) {
  const h = clustered.hit;
  return (
    <div className="border border-[#1f1f1f] bg-[#070707] rounded-[2px] p-2 flex items-center gap-3 hover:border-[#3a3a3a]">
      {h.type === 'person' && (
        h.photo_url
          ? <img src={authedImageUrl(h.photo_url)} alt="" className="w-9 h-11 object-cover rounded-[2px] border border-[#2a2a2a] shrink-0" />
          : <div className="w-9 h-11 bg-[#161616] border border-[#2a2a2a] rounded-[2px] shrink-0" />
      )}
      <button className="flex-1 min-w-0 text-left" onClick={() => onSelect(h.type, h.id, h.label)}>
        <div className="flex items-center gap-2">
          <span className={`font-mono text-[8px] uppercase ${TYPE_TAG[h.type] || 'text-[#888]'}`}>{h.type}</span>
          {clustered.linkedCount > 1 && (
            <span className="font-mono text-[8px] text-[#d4a017] border border-[#3a2a08] rounded-[2px] px-[4px]">{clustered.linkedCount} linked</span>
          )}
        </div>
        <div className="text-[12px] text-[#e8e8e8] truncate">{h.label || `#${h.id}`}</div>
        {h.snippet && <div className="text-[10px] text-[#666] truncate">{h.snippet}</div>}
        <div className="flex gap-1 mt-[3px] flex-wrap">
          {h.flags.map((f) => (
            <span key={f} className="font-mono text-[8px] px-[5px] py-[1px] rounded-[2px] bg-[#3a0d0a] text-[#ff6b5e]">{f}</span>
          ))}
        </div>
      </button>
      <button onClick={() => onOpen(h.type, h.id)}
        className="font-mono text-[8px] tracking-wide text-[#d4a017] border border-[#3a3a3a] rounded-[2px] px-2 py-[6px] uppercase shrink-0">Open</button>
    </div>
  );
}
```

`client/src/pages/intel/search/FacetSidebar.tsx`:
```tsx
import type { Facets } from '../useIntelQuery';

export default function FacetSidebar({ facets, activeType, activeFlags, onToggleType, onToggleFlag }: {
  facets: Facets;
  activeType: string | null;
  activeFlags: string[];
  onToggleType: (t: string) => void;
  onToggleFlag: (f: string) => void;
}) {
  const types = Object.entries(facets.byType).sort((a, b) => b[1] - a[1]);
  const flags = Object.entries(facets.byFlag).sort((a, b) => b[1] - a[1]);
  const Row = ({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) => (
    <button onClick={onClick}
      className={`w-full flex items-center justify-between px-2 py-[4px] rounded-[2px] text-[11px] ${active ? 'bg-[#0c0c0c] text-[#d4a017]' : 'text-[#bdbdbd] hover:bg-[#0a0a0a]'}`}>
      <span className="capitalize truncate">{label.replace('_', ' ')}</span>
      <span className="font-mono text-[9px] text-[#888]">{count}</span>
    </button>
  );
  return (
    <div className="w-[150px] shrink-0 space-y-3">
      {types.length > 0 && (
        <div>
          <div className="font-mono text-[8px] tracking-widest text-[#555] uppercase px-2 mb-1">Type</div>
          {types.map(([t, n]) => <Row key={t} label={t} count={n} active={activeType === t} onClick={() => onToggleType(t)} />)}
        </div>
      )}
      {flags.length > 0 && (
        <div>
          <div className="font-mono text-[8px] tracking-widest text-[#555] uppercase px-2 mb-1">Flag</div>
          {flags.map(([f, n]) => <Row key={f} label={f} count={n} active={activeFlags.includes(f)} onClick={() => onToggleFlag(f)} />)}
        </div>
      )}
    </div>
  );
}
```

> `authedImageUrl` is exported from `client/src/hooks/useApi.ts` (verified). It appends the auth token for `/api/uploads` image loads.

- [ ] **Step 4: Run the test, verify PASS**

Run: `cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/hopeful-bhabha-b1ccce/client" && npx vitest run src/pages/intel/search/__tests__/searchUi.test.tsx`

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/intel/search/ResultCard.tsx client/src/pages/intel/search/FacetSidebar.tsx client/src/pages/intel/search/__tests__/searchUi.test.tsx
git commit -m "feat(intel): result preview card + facet sidebar"
```

---

## Task 7: Saved-searches hook + search bar

**Files:**
- Create: `client/src/pages/intel/useSavedSearches.ts`
- Create: `client/src/pages/intel/search/SearchBar.tsx`
- Test: `client/src/pages/intel/search/__tests__/searchBar.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `client/src/pages/intel/search/__tests__/searchBar.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import SearchBar from '../SearchBar';

vi.mock('../../../../hooks/useApi', () => ({ apiFetch: vi.fn(async () => []) }));

describe('SearchBar', () => {
  it('renders input and fires onChange', () => {
    const onChange = vi.fn();
    render(<SearchBar value="" onChange={onChange} onSave={() => {}} />);
    const input = screen.getByPlaceholderText(/search/i);
    fireEvent.change(input, { target: { value: 'plate:8XQ' } });
    expect(onChange).toHaveBeenCalledWith('plate:8XQ');
  });

  it('shows the operator hint', () => {
    render(<SearchBar value="" onChange={() => {}} onSave={() => {}} />);
    expect(screen.getByText(/plate:/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/hopeful-bhabha-b1ccce/client" && npx vitest run src/pages/intel/search/__tests__/searchBar.test.tsx`

- [ ] **Step 3: Implement both files**

`client/src/pages/intel/useSavedSearches.ts`:
```ts
// Saved searches + recent history for the search bar dropdowns.
import { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../../hooks/useApi';

export interface SavedSearch { id: number; name: string; query_text: string; created_at: string }
export interface RecentSearch { query_text: string; executed_at: string }

export function useSavedSearches() {
  const [saved, setSaved] = useState<SavedSearch[]>([]);
  const [recent, setRecent] = useState<RecentSearch[]>([]);

  const reload = useCallback(() => {
    apiFetch<SavedSearch[]>('/intel/saved-searches').then((r) => setSaved(Array.isArray(r) ? r : [])).catch(() => setSaved([]));
    apiFetch<RecentSearch[]>('/intel/search-history').then((r) => setRecent(Array.isArray(r) ? r : [])).catch(() => setRecent([]));
  }, []);
  useEffect(reload, [reload]);

  const save = useCallback(async (name: string, query_text: string) => {
    await apiFetch('/intel/saved-searches', { method: 'POST', body: JSON.stringify({ name, query_text }) }).catch(console.error);
    reload();
  }, [reload]);

  const remove = useCallback(async (id: number) => {
    await apiFetch(`/intel/saved-searches/${id}`, { method: 'DELETE' }).catch(console.error);
    reload();
  }, [reload]);

  return { saved, recent, save, remove, reload };
}
```

`client/src/pages/intel/search/SearchBar.tsx`:
```tsx
import { useState } from 'react';
import { Search, Star } from 'lucide-react';
import { useSavedSearches } from '../useSavedSearches';

const HINT = 'plate:  dob:  phone:  vin:  dl:  case:  name:"…"  addr:"…"  type:  flag:  since:  until:';

export default function SearchBar({ value, onChange, onSave }: {
  value: string;
  onChange: (v: string) => void;
  onSave?: (name: string) => void;
}) {
  const { saved, recent } = useSavedSearches();
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <div className="flex items-center gap-2 border border-[#2e2e2e] bg-[#0b0b0b] rounded-[2px] px-3 py-2 focus-within:border-[#d4a017]">
        <Search size={14} className="text-[#d4a017]" />
        <input
          autoFocus value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Search — try plate:8XQ220, name:&quot;Hale&quot;, flag:warrant…"
          className="flex-1 bg-transparent text-[13px] text-gray-200 outline-none"
        />
        {onSave && value.trim() && (
          <button title="Save this search" onClick={() => { const n = prompt('Name this search:'); if (n) onSave(n); }}
            className="text-[#888] hover:text-[#d4a017]"><Star size={13} /></button>
        )}
      </div>
      <div className="text-[9px] text-[#555] font-mono mt-1 px-1 truncate">{HINT}</div>

      {open && (saved.length > 0 || recent.length > 0) && (
        <div className="absolute z-20 left-0 right-0 mt-1 bg-[#060606] border border-[#232323] rounded-[2px] max-h-[260px] overflow-y-auto">
          {saved.length > 0 && <div className="font-mono text-[8px] tracking-widest text-[#555] uppercase px-3 pt-2">Saved</div>}
          {saved.map((s) => (
            <button key={s.id} onMouseDown={() => onChange(s.query_text)}
              className="w-full text-left px-3 py-[5px] text-[11px] text-[#cfcfcf] hover:bg-[#0c0c0c] flex items-center gap-2">
              <Star size={10} className="text-[#d4a017]" /><span className="flex-1 truncate">{s.name}</span>
              <span className="text-[9px] text-[#555] font-mono truncate max-w-[160px]">{s.query_text}</span>
            </button>
          ))}
          {recent.length > 0 && <div className="font-mono text-[8px] tracking-widest text-[#555] uppercase px-3 pt-2">Recent</div>}
          {recent.map((r, i) => (
            <button key={i} onMouseDown={() => onChange(r.query_text)}
              className="w-full text-left px-3 py-[5px] text-[11px] text-[#bdbdbd] hover:bg-[#0c0c0c] truncate">{r.query_text}</button>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the test, verify PASS**

Run: `cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/hopeful-bhabha-b1ccce/client" && npx vitest run src/pages/intel/search/__tests__/searchBar.test.tsx`

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/intel/useSavedSearches.ts client/src/pages/intel/search/SearchBar.tsx client/src/pages/intel/search/__tests__/searchBar.test.tsx
git commit -m "feat(intel): saved-searches hook + search bar with operator hint"
```

---

## Task 8: `IntelSearch` page (compose everything) + route swap

**Files:**
- Create: `client/src/pages/intel/IntelSearch.tsx`
- Modify: `client/src/App.tsx` (route `/intel/search` → `IntelSearch`)
- Test: `client/src/pages/intel/__tests__/IntelSearch.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `client/src/pages/intel/__tests__/IntelSearch.test.tsx`:

```tsx
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect } from 'vitest';
import IntelSearch from '../IntelSearch';
import { IntelProvider } from '../IntelContext';

vi.mock('../../../hooks/useApi', () => ({
  apiFetch: vi.fn(async (path: string) => {
    if (path.includes('/intel/query')) return {
      results: [{ type: 'person', id: 2, label: 'HALE, Vincent', snippet: '', flags: ['ACTIVE WARRANT'], score: 95,
        cluster: { canonical_person_id: null, pending_suggestions: 0 } }],
      facets: { byType: { person: 1 }, byFlag: { 'active warrant': 1 } },
    };
    return [];
  }),
  authedImageUrl: (u: string) => u,
}));

describe('IntelSearch', () => {
  it('runs a query and renders result cards', async () => {
    render(<MemoryRouter><IntelProvider><IntelSearch /></IntelProvider></MemoryRouter>);
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'name:"Hale"' } });
    await waitFor(() => expect(screen.getByText('HALE, Vincent')).toBeInTheDocument(), { timeout: 2000 });
    expect(screen.getByText('ACTIVE WARRANT')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/hopeful-bhabha-b1ccce/client" && npx vitest run src/pages/intel/__tests__/IntelSearch.test.tsx`

- [ ] **Step 3: Implement `client/src/pages/intel/IntelSearch.tsx`**

```tsx
// Supercharged Intel Search: parser → /api/intel/query → facets + clustered
// preview cards. Card click drives the right context panel; Open routes to the
// record. Replaces the old flat IntelSearchPage at /intel/search.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { parseQuery } from './useQueryParser';
import { useIntelQuery } from './useIntelQuery';
import { clusterHits } from './clusterHits';
import { useIntelContext } from './IntelContext';
import { recordPath } from './intelTypes';
import SearchBar from './search/SearchBar';
import FacetSidebar from './search/FacetSidebar';
import ResultCard from './search/ResultCard';
import { useSavedSearches } from './useSavedSearches';

export default function IntelSearch() {
  const [raw, setRaw] = useState('');
  const [activeType, setActiveType] = useState<string | null>(null);
  const [activeFlags, setActiveFlags] = useState<string[]>([]);
  const { results, facets, loading, error, run } = useIntelQuery();
  const { selectEntity } = useIntelContext();
  const { save } = useSavedSearches();
  const navigate = useNavigate();
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    clearTimeout(debounce.current);
    if (raw.trim().length < 2) return;
    debounce.current = setTimeout(() => run(parseQuery(raw), raw), 250);
    return () => clearTimeout(debounce.current);
  }, [raw, run]);

  const clustered = useMemo(() => {
    let r = results;
    if (activeType) r = r.filter((h) => h.type === activeType);
    if (activeFlags.length) r = r.filter((h) => activeFlags.every((f) => h.flags.some((hf) => hf.toLowerCase().includes(f))));
    return clusterHits(r);
  }, [results, activeType, activeFlags]);

  const toggleType = (t: string) => setActiveType((cur) => (cur === t ? null : t));
  const toggleFlag = (f: string) => setActiveFlags((cur) => (cur.includes(f) ? cur.filter((x) => x !== f) : [...cur, f]));

  return (
    <div className="p-3 space-y-3">
      <SearchBar value={raw} onChange={setRaw} onSave={(name) => save(name, raw)} />
      {error && <div className="text-[10px] text-[#ff6b5e]">Search error: {error}</div>}

      <div className="flex gap-4">
        {(Object.keys(facets.byType).length > 0) && (
          <FacetSidebar facets={facets} activeType={activeType} activeFlags={activeFlags}
            onToggleType={toggleType} onToggleFlag={toggleFlag} />
        )}
        <div className="flex-1 min-w-0 space-y-2">
          {loading && <div className="text-[11px] text-[#888]">Searching…</div>}
          {!loading && raw.trim().length >= 2 && clustered.length === 0 && <div className="text-[11px] text-[#888]">No results.</div>}
          {clustered.map((c) => (
            <ResultCard key={`${c.hit.type}:${c.hit.id}`} clustered={c}
              onSelect={selectEntity}
              onOpen={(type, id) => navigate(recordPath({ type, id }))} />
          ))}
          {raw.trim().length < 2 && (
            <div className="text-[11px] text-[#555] pt-6 text-center">
              Type to search. Use operators like <span className="text-[#d4a017] font-mono">plate:</span>,
              <span className="text-[#d4a017] font-mono"> name:"…"</span>,
              <span className="text-[#d4a017] font-mono"> flag:warrant</span>, or just a name / plate / phone.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Point `/intel/search` at the new page in `App.tsx`**

Add the lazy import near the other intel ones (after `IntelComingSoon`):
```tsx
const IntelSearch = lazyRetry(() => import('./pages/intel/IntelSearch'));
```
Change the child route element from `IntelSearchPage` to `IntelSearch`:
```tsx
              <Route path="search" element={<RouteErrorBoundary><IntelSearch /></RouteErrorBoundary>} />
```
(Leave the `IntelSearchPage` lazy import in place — it may still be referenced elsewhere; do NOT delete it without grepping. The old page simply stops being routed.)

- [ ] **Step 5: Run the test, typecheck, build**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/hopeful-bhabha-b1ccce/client"
npx vitest run src/pages/intel/__tests__/IntelSearch.test.tsx
npx tsc --noEmit
npx vite build
```
All PASS.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/intel/IntelSearch.tsx client/src/App.tsx
git commit -m "feat(intel): supercharged IntelSearch page (parser + facets + cards + clustering)"
```

---

## Task 9: SW bump + full verification

**Files:**
- Modify: `client/public/sw.js`

- [ ] **Step 1: Bump `CACHE_NAME`** to the next version above current (controller will confirm the live high-water at finish to avoid a collision; bump to at least one above the working-tree value).

- [ ] **Step 2: Full gate**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/hopeful-bhabha-b1ccce"
npm run typecheck
cd client && npx tsc --noEmit && npx vitest run && npx vite build
```
All PASS (vitest should include the new parser/cluster/UI/search tests).

- [ ] **Step 3: Commit**

```bash
git add client/public/sw.js
git commit -m "chore(intel): bump SW cache for supercharged search"
```

---

## Self-Review

**Spec coverage (spec §5):**
- Smart query parsing (operators + plain language) → Task 1 ✓ (extended grammar per user choice)
- Faceted, ranked results → Tasks 3 (facets in endpoint) + 6 (FacetSidebar) ✓
- Rich preview cards (photo, flags, escalation hint) → Task 6 ResultCard (photo + flags + cluster badge; escalation lives in the right-panel peek — documented trim) ✓
- Inline dossier/graph peek from any hit → reuses Foundation's `selectEntity` → context panel ✓
- Cross-entity clustering → Task 5 `clusterHits` ✓
- Saved searches + history → Tasks 2 (tables) + 4 (endpoints) + 7 (hook/UI) ✓

**Placeholder scan:** No TBD/TODO; every code step is complete. `since:`/`until:` partial support is explicitly documented (not silent).

**Type consistency:** `QueryHit`/`Facets` are defined identically in `src/utils/intelQuery.ts` (worker) and `client/src/pages/intel/useIntelQuery.ts` (client) and consumed unchanged by `clusterHits`, `ResultCard`, `FacetSidebar`, `IntelSearch`. `ParsedQuery` + `toQueryParams` (Task 1) feed `useIntelQuery.run` (Task 5). `ClusteredHit` (Task 5) is consumed by `ResultCard` (Task 6). `recordPath` imported from `intelTypes` (Foundation). `selectEntity(type,id,label)` matches the Foundation context.

**Risk recheck:** new `/query` endpoint is a sibling — `/search` + GlobalSearch untouched. Worker SQL verified against live D1 in Task 3 Step 5. Migration 0107 applied to live + verified in Task 2 Step 3. SW collision avoided by confirming live high-water at finish.
