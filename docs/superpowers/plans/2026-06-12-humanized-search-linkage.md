# Humanized Search, Linkage & Connection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make search, linkage, and connection match the plain-English value the user sees ("Traffic Stop") in addition to the stored coded value (`traffic_stop`), system-wide across web, backend, and iOS.

**Architecture:** Additive WYSIWYG matching. Two small pure helpers — one web (`coded()` expands the *value*: raw + humanized), one backend (`codeCandidates()`/`codedLike()` expand the *query* into OR'd LIKE patterns). Adopt at coded-field search sites only; free-text/number/name matching and result ordering are unchanged. iOS record search is server-backed → inherits the backend fix.

**Tech Stack:** React + TypeScript + Vitest (web `client/`); Hono on Cloudflare Workers + D1 + Vitest (backend `src/`, tests in root `tests/`); Swift + XCTest (iOS `ios/`).

**Spec:** `docs/superpowers/specs/2026-06-12-humanized-search-linkage-design.md`

---

## Grounded facts (verified 2026-06-12, base `fcfdbda9`)

- **SW cache version:** `client/public/sw.js:605` → `const CACHE_NAME = 'rmpg-flex-v916';` (bump to `v917` in Phase 1).
- **Web humanizers** live in `client/src/utils/statusLabels.ts` (`humanizeType`, `humanizePriority`, `humanizeDisposition`, `humanizeStatus(status, type)`, `humanizeGender`, `humanizeRace`, `humanizeCaseType`) and `client/src/utils/formatters.ts` (`formatEnumValue`, `formatLabel`).
- **Web vitest tests:** `client/src/**/__tests__/*.test.ts` (e.g. `client/src/utils/__tests__/tabScrollbarGeometry.test.ts`). Run with `cd client && npx vitest run`.
- **Backend vitest tests:** root `tests/*.test.ts` (e.g. `tests/walletToken.test.ts`). Run with `npm test` (vitest at repo root).
- **Backend `escapeLike`** is a local function at `src/routes/connections.ts:71` — extract to the shared util (DRY).
- **Intel FTS** `intel_index` (`migrations/0098_intel_search.sql:5`) uses `tokenize = 'unicode61 remove_diacritics 2'`. `unicode61` treats `_` as a separator, so `traffic_stop` already tokenizes to `traffic`+`stop` and snake_case codes likely already match. Only non-snake closed enums (`P1`, `10-23`) may miss — Phase 2 verifies this before doing anything.
- **Grounded web sweep set** — coded-field SEARCH filters (NOT styling/logic):
  - `client/src/pages/IncidentsPage.tsx:845` — `inc.type`
  - `client/src/pages/dispatch/DispatchPage.tsx:1299` — `call.incident_type`
  - `client/src/pages/map/MapPage.tsx:3216` — `c.incident_type`
  - `client/src/pages/records/PersonsTab.tsx:505` — flag `f.type`
  - `client/src/pages/hr/tabs/GrievancesTab.tsx:146` — `g.type`
  - `client/src/pages/hr/tabs/AttendanceTab.tsx:191` — `r.type`
  - `client/src/components/IncidentPicker.tsx:71` — `i.type`
  - `client/src/pages/hr/tabs/DocumentsTab.tsx:150` — `doc.category` (review: may already be plain English)
  - `client/src/pages/document-writer/components/TemplateChooser.tsx:102` — `t.category` (review: may already be plain English)
- **LEAVE ALONE (conditional styling, not search):** `client/src/pages/OffenderRegistryPage.tsx:137-180` (badge color by `status`), `client/src/components/CriminalHistorySection.tsx:471` (text color by `disposition`).

---

## File Structure

**Phase 1 — Web**
- Create: `client/src/utils/searchText.ts` — `coded()`, `matchesQuery()`, `humanizeField()`, `codedByKey()`, `FIELD_HUMANIZERS`. One responsibility: build search haystacks that include humanized forms.
- Create: `client/src/utils/__tests__/searchText.test.ts` — unit tests for the helper.
- Modify: the 7–9 grounded sweep files above (one-expression swap each).
- Create: `client/src/pages/__tests__/incidentsSearch.test.ts` — representative page-filter test (pure filter function, no React render).
- Modify: `client/public/sw.js:605` — bump `CACHE_NAME` to `v917`.

**Phase 2 — Backend**
- Create: `src/utils/searchText.ts` — `escapeLike()`, `codeCandidates()`, `codedLike()`. One responsibility: expand a human query term into LIKE candidates.
- Create: `tests/searchText.test.ts` — unit tests for the helper.
- Modify: `src/routes/connections.ts` (use shared `escapeLike`; `codedLike` for `incident_type`/`status`), `src/routes/records.ts`, `src/routes/dispatch/calls.ts`, `src/routes/dispatch/aggregates.ts`, `src/routes/useOfForce.ts`, `src/routes/codeEnforcement.ts`, `src/routes/knowledgeBase.ts` — only coded-column `LIKE` predicates.
- Modify (conditional on tokenizer verification): intel FTS query builder.

**Phase 3 — iOS**
- Audit: `ios/RMPGFlexTester/RMPGFlexTester/*.swift` for any client-side record filter matching a raw coded value.
- Modify (only if found): the offending view, building the haystack from `FieldFormat.value(key, raw)` + raw.
- Modify (only if code added): `ios/RMPGFlexTester/RMPGFlexTesterTests/FieldFormatTests.swift`.

---

## PHASE 1 — Web

> Create a feature branch off the latest `origin/main` for this phase (e.g. `claude/humanized-search-web`). End the phase with a PR per the repo's review flow.

### Task 1: Create `coded()` with tests

**Files:**
- Create: `client/src/utils/searchText.ts`
- Test: `client/src/utils/__tests__/searchText.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// client/src/utils/__tests__/searchText.test.ts
import { describe, it, expect } from 'vitest';
import { coded } from '../searchText';
import { humanizeType, humanizePriority } from '../statusLabels';

describe('coded', () => {
  it('includes raw and humanized forms, lowercased', () => {
    const h = coded('traffic_stop', humanizeType);
    expect(h).toContain('traffic_stop');   // raw still searchable
    expect(h).toContain('traffic stop');   // humanized now searchable
    expect(h).toBe(h.toLowerCase());
  });

  it('expands a coded priority', () => {
    expect(coded('P1', humanizePriority)).toContain('priority 1');
    expect(coded('P1', humanizePriority)).toContain('p1');
  });

  it('is null/empty safe', () => {
    expect(coded(null)).toBe('');
    expect(coded(undefined)).toBe('');
    expect(coded('')).toBe('');
  });

  it('does not double when humanizer returns the raw value unchanged', () => {
    const h = coded('weird_unknown_code', (v) => String(v)); // identity humanizer
    expect(h).toBe('weird_unknown_code');
  });

  it('works with no humanizer (raw only, lowercased)', () => {
    expect(coded('SomeValue')).toBe('somevalue');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/utils/__tests__/searchText.test.ts`
Expected: FAIL — "Failed to resolve import '../searchText'".

- [ ] **Step 3: Write minimal implementation**

```ts
// client/src/utils/searchText.ts
// ============================================================
// RMPG Flex — Humanized search helpers
// ============================================================
// Additive WYSIWYG matching: a search/filter haystack should include
// BOTH the raw coded value AND its plain-English humanized form, so an
// officer can search by what they SEE ("Traffic Stop") while raw-code
// and record-number lookups keep working. See
// docs/superpowers/specs/2026-06-12-humanized-search-linkage-design.md
// ============================================================

type Humanizer = (v: string | null | undefined) => string;

/**
 * Lowercase haystack fragment for a coded field: raw + humanized, deduped,
 * null-safe. Slots directly into existing `.includes(q)` filter chains.
 *   coded('traffic_stop', humanizeType) → "traffic_stop traffic stop"
 *   coded('P1', humanizePriority)        → "p1 priority 1"
 *   coded(null)                          → ""
 */
export function coded(raw: string | null | undefined, humanizer?: Humanizer): string {
  if (raw == null || raw === '') return '';
  const rawStr = String(raw);
  const human = humanizer ? humanizer(rawStr) : '';
  const parts =
    human && human.toLowerCase() !== rawStr.toLowerCase() ? [rawStr, human] : [rawStr];
  return parts.join(' ').toLowerCase();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/utils/__tests__/searchText.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add client/src/utils/searchText.ts client/src/utils/__tests__/searchText.test.ts
git commit -m "feat(web): coded() search helper — raw + humanized haystack"
```

### Task 2: Add `matchesQuery`, `FIELD_HUMANIZERS`, `humanizeField`, `codedByKey`

**Files:**
- Modify: `client/src/utils/searchText.ts`
- Test: `client/src/utils/__tests__/searchText.test.ts`

- [ ] **Step 1: Write the failing tests (append to the existing file)**

```ts
// append to client/src/utils/__tests__/searchText.test.ts
import { matchesQuery, humanizeField, codedByKey } from '../searchText';

describe('matchesQuery', () => {
  it('requires every whitespace-separated term to appear (new-site convenience)', () => {
    expect(matchesQuery('traffic stop', coded('traffic_stop', humanizeType))).toBe(true);
    expect(matchesQuery('stop bogus', coded('traffic_stop', humanizeType))).toBe(false);
  });
  it('empty query matches everything', () => {
    expect(matchesQuery('', 'anything')).toBe(true);
  });
  it('skips null/empty parts', () => {
    expect(matchesQuery('john', 'John Smith', null, undefined, '')).toBe(true);
  });
});

describe('humanizeField / codedByKey', () => {
  it('dispatches known keys to the right humanizer', () => {
    expect(humanizeField('incident_type', 'traffic_stop').toLowerCase()).toBe('traffic stop');
    expect(humanizeField('priority', 'P1').toLowerCase()).toContain('priority 1');
  });
  it('falls back to generic Title-Case for unknown keys', () => {
    expect(humanizeField('some_other_key', 'foo_bar').toLowerCase()).toBe('foo bar');
  });
  it('codedByKey produces raw + humanized', () => {
    const h = codedByKey('incident_type', 'traffic_stop');
    expect(h).toContain('traffic_stop');
    expect(h).toContain('traffic stop');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd client && npx vitest run src/utils/__tests__/searchText.test.ts`
Expected: FAIL — `matchesQuery`/`humanizeField`/`codedByKey` not exported.

- [ ] **Step 3: Implement (append to `searchText.ts`)**

```ts
// append to client/src/utils/searchText.ts
import {
  humanizeType,
  humanizePriority,
  humanizeDisposition,
  humanizeGender,
  humanizeRace,
  humanizeCaseType,
} from './statusLabels';
import { formatEnumValue } from './formatters';

/**
 * Convenience for NEW filter sites only: every whitespace-separated term in
 * `query` must appear in the combined haystack. (Existing sites keep their
 * single-substring `.includes(q)` semantics by using coded() inline — do NOT
 * retrofit matchesQuery onto existing filters; it changes multi-word behavior.)
 */
export function matchesQuery(
  query: string,
  ...parts: Array<string | number | null | undefined>
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = parts
    .filter((p) => p != null && p !== '')
    .map((p) => String(p).toLowerCase())
    .join(' ');
  return q.split(/\s+/).every((term) => hay.includes(term));
}

// Default humanizer per coded field key. NOTE: `status` is intentionally
// absent — humanizeStatus needs a context arg ('call'|'incident'|'unit'), so
// status sites pass an explicit closure: coded(x.status, s => humanizeStatus(s, 'incident')).
const FIELD_HUMANIZERS: Record<string, Humanizer> = {
  type: humanizeType,
  incident_type: humanizeType,
  call_type: humanizeType,
  priority: humanizePriority,
  disposition: humanizeDisposition,
  gender: humanizeGender,
  sex: humanizeGender,
  race: humanizeRace,
  case_type: humanizeCaseType,
};

/** Humanize a coded value by its field key, with generic Title-Case fallback. */
export function humanizeField(key: string, raw: string | null | undefined): string {
  const h = FIELD_HUMANIZERS[key];
  return h ? h(raw) : formatEnumValue(raw);
}

/** coded() driven by the field key's mapped humanizer (or generic fallback). */
export function codedByKey(key: string, raw: string | null | undefined): string {
  return coded(raw, (v) => humanizeField(key, v));
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd client && npx vitest run src/utils/__tests__/searchText.test.ts`
Expected: PASS (all describe blocks).

- [ ] **Step 5: Typecheck + commit**

```bash
cd client && npx tsc --noEmit && cd ..
git add client/src/utils/searchText.ts client/src/utils/__tests__/searchText.test.ts
git commit -m "feat(web): matchesQuery + field-keyed humanizers for search"
```

### Task 3: Adopt in IncidentsPage (worked example) + page-filter test

**Files:**
- Modify: `client/src/pages/IncidentsPage.tsx:845`
- Test: `client/src/pages/__tests__/incidentsSearch.test.ts`

- [ ] **Step 1: Write the failing test (extract the matcher as a tiny pure fn to test)**

First, in `IncidentsPage.tsx`, export a pure matcher used by the filter. Near the top-level (module scope, not inside the component), add:

```ts
// client/src/pages/IncidentsPage.tsx — module scope
import { coded } from '../utils/searchText';
import { humanizeType } from '../utils/statusLabels'; // already imported on line 72 — reuse, do not duplicate

export function incidentMatchesSearch(
  inc: { incident_number: string; title: string; location: string; officer_name: string; type: string },
  q: string,
): boolean {
  return (
    inc.incident_number.toLowerCase().includes(q) ||
    inc.title.toLowerCase().includes(q) ||
    inc.location.toLowerCase().includes(q) ||
    inc.officer_name.toLowerCase().includes(q) ||
    coded(inc.type, humanizeType).includes(q)
  );
}
```

Then the test:

```ts
// client/src/pages/__tests__/incidentsSearch.test.ts
import { describe, it, expect } from 'vitest';
import { incidentMatchesSearch } from '../IncidentsPage';

const row = {
  incident_number: 'INC-2026-0001',
  title: 'Report taken',
  location: '100 Main St',
  officer_name: 'J. Smith',
  type: 'traffic_stop',
};

describe('incidentMatchesSearch', () => {
  it('matches the plain-English label the officer sees', () => {
    expect(incidentMatchesSearch(row, 'traffic stop')).toBe(true);
  });
  it('still matches the raw code (additive)', () => {
    expect(incidentMatchesSearch(row, 'traffic_stop')).toBe(true);
  });
  it('still matches the record number', () => {
    expect(incidentMatchesSearch(row, 'inc-2026-0001')).toBe(true);
  });
  it('does not match unrelated text', () => {
    expect(incidentMatchesSearch(row, 'burglary')).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd client && npx vitest run src/pages/__tests__/incidentsSearch.test.ts`
Expected: FAIL on the "traffic stop" case until the filter uses `coded(...)` (and import error until `incidentMatchesSearch` is exported).

- [ ] **Step 3: Wire the existing filter (line ~835-846) to call the pure matcher**

Replace the inline `return (...)` in the `.filter((inc) => {...})` block so it delegates to `incidentMatchesSearch(inc, q)`:

```ts
// client/src/pages/IncidentsPage.tsx — inside the existing filter
.filter((inc) => {
  if (uofFilter && !UOF_TYPES.includes(inc.type)) return false;
  if (!searchQuery) return true;
  const q = searchQuery.toLowerCase();
  return incidentMatchesSearch(inc as any, q);
})
```

- [ ] **Step 4: Run test + typecheck to verify pass**

Run: `cd client && npx vitest run src/pages/__tests__/incidentsSearch.test.ts && npx tsc --noEmit`
Expected: PASS (4 tests); tsc clean.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/IncidentsPage.tsx client/src/pages/__tests__/incidentsSearch.test.ts
git commit -m "fix(web): IncidentsPage search matches humanized call type"
```

### Task 4: Sweep the remaining grounded coded-field search sites

For EACH file below, the recipe is identical: locate the coded-field expression in the search filter and wrap ONLY that expression with `coded(value, <humanizer>)`. Leave every free-text field, the result ordering, and any non-search `.includes()` (styling/logic) untouched.

**Per-file recipe:**
1. Open the file; find the search filter (the `.filter(... toLowerCase().includes(q) ...)`).
2. Import `coded` from the searchText util (relative path) and reuse the page's existing humanizer import (add one only if missing).
3. Swap `x.<codedField>.toLowerCase().includes(q)` → `coded(x.<codedField>, <humanizer>).includes(q)` (or `coded(x.<codedField>, s => humanizeStatus(s, '<ctx>'))` for status).
4. `cd client && npx tsc --noEmit` after each file.

- [ ] **Step 1: `client/src/pages/dispatch/DispatchPage.tsx:1299`** — `(call.incident_type || '').toLowerCase().includes(q)` → `coded(call.incident_type, humanizeType).includes(q)`.
- [ ] **Step 2: `client/src/pages/map/MapPage.tsx:3216`** — `(c.incident_type || '').toLowerCase().includes(q)` → `coded(c.incident_type, humanizeType).includes(q)`.
- [ ] **Step 3: `client/src/components/IncidentPicker.tsx:71`** — `i.type?.toLowerCase().includes(q)` → `coded(i.type, humanizeType).includes(q)`.
- [ ] **Step 4: `client/src/pages/records/PersonsTab.tsx:505`** — flag type: `p.flags.some((f) => coded((typeof f === 'object' ? f.type : f), humanizeFlag).includes(q))` (use `humanizeFlag` from statusLabels; if a flag isn't in the map it falls back to the raw, still additive).
- [ ] **Step 5: `client/src/pages/hr/tabs/GrievancesTab.tsx:146`** — `g.type.toLowerCase().includes(q)` → `coded(g.type, formatEnumValue).includes(q)` (HR grievance types are generic snake_case enums → generic humanizer is correct).
- [ ] **Step 6: `client/src/pages/hr/tabs/AttendanceTab.tsx:191`** — `r.type.toLowerCase().includes(q)` → `coded(r.type, formatEnumValue).includes(q)`.
- [ ] **Step 7: `client/src/pages/hr/tabs/DocumentsTab.tsx:150`** — REVIEW first: if `doc.category` is already a plain-English label, leave it; if it's a snake_case code, `coded(doc.category, formatEnumValue).includes(q)`.
- [ ] **Step 8: `client/src/pages/document-writer/components/TemplateChooser.tsx:102`** — REVIEW first: if `t.category` is already plain English, leave it; else `coded(t.category, formatEnumValue).includes(needle)`.
- [ ] **Step 9: Find stragglers** — run:

```bash
cd "$(git rev-parse --show-toplevel)"
grep -rEn "\.(type|incident_type|call_type|status|priority|disposition|case_type|gender|sex|race)\b[^=]*\.toLowerCase\(\)\.includes" client/src/pages client/src/components | grep -v "OffenderRegistryPage\|CriminalHistorySection"
```

For each remaining hit, decide search-vs-styling. If it's a search filter, apply the recipe. If it's conditional logic (badge color, branch), leave it and note why.

- [ ] **Step 10: Typecheck + commit**

```bash
cd client && npx tsc --noEmit && cd ..
git add -A client/src
git commit -m "fix(web): humanized matching across coded-field search sites"
```

### Task 5: Bump SW, full verify, open PR

**Files:**
- Modify: `client/public/sw.js:605`

- [ ] **Step 1: Bump the service-worker cache version**

```ts
// client/public/sw.js:605
const CACHE_NAME = 'rmpg-flex-v917';
```

- [ ] **Step 2: Full client gate**

Run: `cd client && npx tsc --noEmit && npx vitest run && npx vite build`
Expected: tsc clean; all vitest pass (incl. the new searchText + incidentsSearch tests); build succeeds.

- [ ] **Step 3: Commit + push + PR**

```bash
git add client/public/sw.js
git commit -m "chore(web): bump SW cache to v917 (humanized search)"
git push -u origin HEAD
gh pr create --base main --title "fix(web): search/linkage match humanized values" \
  --body "Phase 1 of humanized search (spec: docs/superpowers/specs/2026-06-12-humanized-search-linkage-design.md). Additive: typing 'Traffic Stop' now finds traffic_stop rows; raw codes + record numbers still match. New coded() helper + tests; ~7-9 coded-field search sites swapped; SW v917."
```

---

## PHASE 2 — Backend

> New feature branch off latest `origin/main` (e.g. `claude/humanized-search-backend`). Touches the LIVE `rmpg-flex` worker — verify routing per the cutover notes after deploy. PR per review flow.

### Task 6: Create `codeCandidates()` + `escapeLike()` with tests

**Files:**
- Create: `src/utils/searchText.ts`
- Test: `tests/searchText.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/searchText.test.ts
import { describe, it, expect } from 'vitest';
import { codeCandidates, escapeLike } from '../src/utils/searchText';

describe('codeCandidates', () => {
  it('adds the snake_case form of a multi-word term (additive)', () => {
    const c = codeCandidates('Traffic Stop');
    expect(c).toContain('Traffic Stop');  // raw term kept
    expect(c).toContain('traffic_stop');  // snake form for coded columns
  });
  it('reverse-maps closed enums whose code is not a snake of the label', () => {
    expect(codeCandidates('Priority 1')).toContain('P1');
    expect(codeCandidates('On Scene')).toEqual(expect.arrayContaining(['on_scene', '10-23']));
  });
  it('empty term yields no candidates', () => {
    expect(codeCandidates('   ')).toEqual([]);
  });
  it('dedupes', () => {
    const c = codeCandidates('burglary');
    expect(new Set(c).size).toBe(c.length);
  });
});

describe('escapeLike', () => {
  it('escapes LIKE wildcards', () => {
    expect(escapeLike('50%_x')).toBe('50\\%\\_x');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- tests/searchText.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/utils/searchText.ts
// ============================================================
// RMPG Flex — backend humanized-search query expansion
// ============================================================
// Mirror of the web coded() helper: instead of expanding the stored value,
// expand the user's QUERY term into candidate match strings (raw + snake_case
// + closed-enum reverse-maps) and OR them into a LIKE clause. Additive — the
// raw term is always included, so name/number search is unaffected.
// Spec: docs/superpowers/specs/2026-06-12-humanized-search-linkage-design.md
// ============================================================

/** Escape LIKE wildcards so a search for "50%" doesn't match everything. */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

// Plain-English label (lowercased) → stored code(s), for closed enums whose
// code is NOT simply the snake_case of the label. Mirrors the closed maps in
// client/src/utils/statusLabels.ts. Keep small and intentional.
const LABEL_TO_CODE: Record<string, string[]> = {
  'priority 1': ['P1'],
  'priority 2': ['P2'],
  'priority 3': ['P3'],
  'priority 4': ['P4'],
  'on scene': ['on_scene', '10-23'],
  'en route': ['en_route', '10-17'],
  'available': ['available', '10-8'],
  'out of service': ['out_of_service', '10-7'],
};

/**
 * Additive candidate match strings for a human query term:
 *   "Traffic Stop" → ["Traffic Stop", "traffic_stop"]
 *   "Priority 1"   → ["Priority 1", "P1"]
 *   "On Scene"     → ["On Scene", "on_scene", "10-23"]
 */
export function codeCandidates(term: string): string[] {
  const t = term.trim();
  if (!t) return [];
  const out = new Set<string>([t]);
  out.add(t.toLowerCase().replace(/\s+/g, '_'));
  const rev = LABEL_TO_CODE[t.toLowerCase()];
  if (rev) for (const code of rev) out.add(code);
  return [...out];
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- tests/searchText.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/searchText.ts tests/searchText.test.ts
git commit -m "feat(api): codeCandidates + escapeLike query-expansion helper"
```

### Task 7: Add `codedLike()` with tests

**Files:**
- Modify: `src/utils/searchText.ts`
- Test: `tests/searchText.test.ts`

- [ ] **Step 1: Append the failing test**

```ts
// append to tests/searchText.test.ts
import { codedLike } from '../src/utils/searchText';

describe('codedLike', () => {
  it('builds an OR-of-LIKE clause with escaped, wildcard-wrapped binds', () => {
    const { sql, binds } = codedLike('incident_type', 'Traffic Stop');
    expect(sql).toBe("(incident_type LIKE ? ESCAPE '\\' OR incident_type LIKE ? ESCAPE '\\')");
    expect(binds).toEqual(['%Traffic Stop%', '%traffic_stop%']);
  });
  it('returns a never-match clause for an empty term', () => {
    expect(codedLike('x', '  ')).toEqual({ sql: '0', binds: [] });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- tests/searchText.test.ts`
Expected: FAIL — `codedLike` not exported.

- [ ] **Step 3: Implement (append to `src/utils/searchText.ts`)**

```ts
// append to src/utils/searchText.ts

/**
 * Build ( col LIKE ? ESCAPE '\' OR col LIKE ? ... ) plus escaped, wildcard-
 * wrapped binds for a human query term. Use for CODED columns only
 * (incident_type, status, priority, category, disposition). For an empty
 * term returns a never-match clause so callers can splice unconditionally.
 */
export function codedLike(col: string, term: string): { sql: string; binds: string[] } {
  const cands = codeCandidates(term);
  if (cands.length === 0) return { sql: '0', binds: [] };
  const sql = '(' + cands.map(() => `${col} LIKE ? ESCAPE '\\'`).join(' OR ') + ')';
  const binds = cands.map((c) => `%${escapeLike(c)}%`);
  return { sql, binds };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- tests/searchText.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git add src/utils/searchText.ts tests/searchText.test.ts
git commit -m "feat(api): codedLike LIKE-clause builder"
```

### Task 8: Adopt in `connections.ts` `/search` + share `escapeLike`

**Files:**
- Modify: `src/routes/connections.ts`

- [ ] **Step 1: Replace the local `escapeLike` (line ~71) with the shared import**

```ts
// src/routes/connections.ts — near the top imports
import { escapeLike, codedLike } from '../utils/searchText';
```
Delete the local `function escapeLike(...) {...}` at line ~71 (the shared one is identical).

- [ ] **Step 2: Expand the coded-column predicates in `/search`**

In the `/search` handler (lines ~620-666), the `incident_type` predicates use a single `term` bind. For the incident + calls_for_service queries, build the coded clause and splice it. Example for the incidents query (line ~649):

```ts
// before:
//   `... WHERE incident_number LIKE ? ESCAPE '\\' OR incident_type LIKE ? ESCAPE '\\' OR location_address LIKE ? ESCAPE '\\' LIMIT 8`, term, term, term
// after:
const itLike = codedLike('incident_type', q.trim());
for (const i of await query<any>(
  db,
  `SELECT id, incident_number, incident_type FROM incidents
     WHERE incident_number LIKE ? ESCAPE '\\' OR ${itLike.sql} OR location_address LIKE ? ESCAPE '\\' LIMIT 8`,
  term, ...itLike.binds, term,
)) { /* ...existing push... */ }
```

Apply the same shape to the `calls_for_service` query (line ~655): expand `incident_type` (and `status` if it is searched) via `codedLike`, keep `call_number`/`location_address` on the plain `term`.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/routes/connections.ts
git commit -m "fix(api): connections /search matches humanized incident/call type"
```

### Task 9: Adopt in the remaining coded-column LIKE sites

For each route, first read the SQL and confirm the `LIKE` targets a CODED column (`incident_type`, `status`, `priority`, `category`, `disposition`). Expand only those with `codedLike`; leave name/number/address/narrative predicates alone.

- [ ] **Step 1: `src/routes/records.ts`** — record-link search: expand any coded-column predicate (e.g. `incident_type`, `status`) via `codedLike`.
- [ ] **Step 2: `src/routes/dispatch/calls.ts`** — expand `incident_type`/`status` filters via `codedLike`.
- [ ] **Step 3: `src/routes/dispatch/aggregates.ts`** — expand coded-column filters via `codedLike`.
- [ ] **Step 4: `src/routes/useOfForce.ts`** — expand coded-column filters via `codedLike`.
- [ ] **Step 5: `src/routes/codeEnforcement.ts`** — expand coded-column filters via `codedLike`.
- [ ] **Step 6: `src/routes/knowledgeBase.ts`** — expand `category` filter via `codedLike` IF category is a coded value; if it's free-text article categories, leave it.
- [ ] **Step 7: Typecheck + commit**

```bash
npm run typecheck
git add src/routes
git commit -m "fix(api): humanized matching across coded-column search routes"
```

### Task 10: Intel FTS — verify tokenizer, expand only if needed

**Files:**
- Read: `migrations/0098_intel_search.sql`, the intel search route (the file building the FTS `MATCH` query).

- [ ] **Step 1: Verify the tokenizer splits on `_`**

`intel_index` uses `tokenize = 'unicode61 remove_diacritics 2'`. Confirm empirically against live D1 (read-only) via the D1 query MCP:
```sql
SELECT rowid FROM intel_index WHERE intel_index MATCH 'traffic stop' LIMIT 1;
-- vs a row known to contain stored 'traffic_stop'
```
If "traffic stop" already matches a `traffic_stop` row, snake_case codes are covered by tokenization — **skip the rest of this task** and record that finding in the PR body.

- [ ] **Step 2 (only if Step 1 shows a miss): expand the FTS query for closed-enum codes**

In the intel search route, before building the `MATCH` expression, OR-in the reverse-mapped code candidates from `codeCandidates(term)` that differ from the raw term (e.g. `("priority 1" OR P1)`). Add a unit test in `tests/` for the query-builder string. Keep the change scoped to the closed-enum cases only.

- [ ] **Step 3: Commit (if changed)**

```bash
git add src/routes/<intel-route>.ts tests/
git commit -m "fix(api): intel FTS query expansion for closed-enum codes"
```

### Task 11: Backend verify + PR

- [ ] **Step 1: Full backend gate**

Run: `npm run typecheck && npm test`
Expected: typecheck clean; all tests pass.

- [ ] **Step 2: Push + PR**

```bash
git push -u origin HEAD
gh pr create --base main --title "fix(api): search/linkage match humanized values" \
  --body "Phase 2 of humanized search. codeCandidates/codedLike query-expansion on coded-column LIKEs (connections, records, dispatch, UoF, code-enforcement, KB). escapeLike shared. Intel FTS verified (see body). Additive — raw codes/numbers unaffected."
```

- [ ] **Step 3: Post-merge live verify**

After merge + deploy, confirm routing/health per the cutover notes (the live worker is `rmpg-flex`). In a real browser, search "Traffic Stop" on the Connections graph and confirm a `traffic_stop` node appears.

---

## PHASE 3 — iOS

> New branch off latest `origin/main` (e.g. `claude/humanized-search-ios`). Builds in the USER's Xcode (this Mac is CLT-only — do not attempt `xcodebuild`; verify logic via the FieldFormat test harness / `swiftc` if needed).

### Task 12: Audit + (conditional) fix iOS client-side record filters

**Files:**
- Audit: all `ios/RMPGFlexTester/RMPGFlexTester/*.swift`
- Modify (only if a raw-value record filter exists): the offending view + `FieldFormatTests.swift`

- [ ] **Step 1: Audit for client-side record filters matching raw coded values**

```bash
cd "$(git rev-parse --show-toplevel)"
grep -rn "localizedCaseInsensitiveContains\|\.contains(\|\.filter" ios/RMPGFlexTester/RMPGFlexTester --include=*.swift \
  | grep -iv "favorites\|collapsed\|hiddenKeys\|priority.filter\|category =="
```
Classify each hit: (a) tool/category filter on already-plain-English text → leave; (b) record filter on a coded field (`status`, `type`, `priority`, etc.) → fix in Step 2; (c) non-search logic → leave.

- [ ] **Step 2 (only if a type-(b) hit exists): build the haystack from `FieldFormat.value`**

For the offending filter, match against `FieldFormat.value(key, raw)` lowercased AND the raw value lowercased (additive), e.g.:
```swift
let hay = (FieldFormat.value(key, raw) + " " + (raw ?? "")).lowercased()
return hay.contains(query.lowercased())
```
Add a `FieldFormatTests` case asserting the humanized form is searchable while the raw still matches.

- [ ] **Step 3: Record the audit outcome**

If no type-(b) hits exist (the expected outcome — iOS record search is server-backed and inherits Phase 2), write a one-line note in the PR body: "iOS audit: no client-side raw-value record filters; search inherits backend Phase 2." Close the phase with that note (no code change needed) or with the Step 2 fix.

- [ ] **Step 4: Commit + PR (only if code changed)**

```bash
git add ios/
git commit -m "fix(ios): humanized matching for client-side record filter"
git push -u origin HEAD
gh pr create --base main --title "fix(ios): humanized search audit + fix" --body "Phase 3 of humanized search."
```

---

## Self-Review (completed against the spec)

- **Spec coverage:** Component 1 (web) → Tasks 1-5. Component 2 (backend) → Tasks 6-11. Component 3 (iOS) → Task 12. Additive semantics → enforced by `coded()`/`codeCandidates()` always keeping the raw form. Testing section → Tasks 1,2,3,6,7,(10),(12). Rollout phasing → the three phases, each ending in its own PR + SW bump (Phase 1).
- **Refinement vs spec:** the spec's "~70 filter sites" was the superset of ALL `.includes` filters; the grounded coded-field SEARCH subset is ~7-9 files (enumerated), plus a straggler grep (Task 4 Step 9). Two styling-only hits explicitly excluded. The intel-FTS task is gated behind a tokenizer verification because `unicode61` likely already splits `_`.
- **Type consistency:** `coded(raw, humanizer?)` and `codedByKey(key, raw)` used consistently; `codedLike(col, term)` returns `{ sql, binds }` used identically in Tasks 8-9; `humanizeStatus(s, ctx)` always passed its context arg; `escapeLike` defined once (backend) and shared into `connections.ts`.
- **Placeholder scan:** the only deliberately deferred items are gated by verification steps (intel tokenizer, DocumentsTab/TemplateChooser category review, iOS audit) — each with an explicit decision rule, not a blank "TODO".
