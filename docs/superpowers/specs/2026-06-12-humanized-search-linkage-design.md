# Humanized Search, Linkage & Connection — Design

**Date:** 2026-06-12
**Status:** Approved (brainstorming) — pending implementation plan
**Platforms:** Web (Mac/Windows browser + Electron), Backend Worker (serves web + iOS), iOS field app

## Problem

Recent work humanized **display** output: coded values now render as plain English
(`traffic_stop` → "Traffic Stop", `P1` → "Priority 1", `on_scene` → "On Scene (10-23)").
See PRs #1178 (iOS `FieldFormat`), #1179 and #1180 (web humanizer sweeps).

But **search, linkage, and connection still match the raw coded value, not the plain-English
output the user sees.** Concretely:

- `IncidentsPage` displays `humanizeType(inc.type)` = "Traffic Stop" but its filter matches
  `inc.type.toLowerCase().includes(q)` = `traffic_stop`. Typing "Traffic Stop" (what the
  officer sees) returns nothing.
- The backend graph seeder `connections.ts` `/search` runs `incident_type LIKE '%Traffic Stop%'`,
  which never matches the stored `traffic_stop`.

This is a WYSIWYG violation: officers can't search by what's on screen. It affects ~70 web
client filter sites, several backend search/linkage endpoints, and (via the server) iOS lookups.

## Goal

**Additive WYSIWYG matching.** Everywhere data is searched, linked, or connected, the match
haystack includes **both** the raw coded value **and** its plain-English humanized form.
Anything that matches today keeps matching (raw codes, record/case numbers, names); what the
user *sees* additionally becomes findable.

Decided during brainstorming:
- **Matching semantics = additive** (not "plain-English only"). Record/case numbers and raw
  codes remain searchable; the humanized form is added to the haystack.
- **Web approach = shared inline helper, surgical per-site adoption** (Approach A) — chosen over
  migrating every page to a central hook (would re-sort rows and risk regressions) and over a
  generic record-walker (over-matches, wrong on real coded maps).

## Non-Goals

- No fuzzy/typo-tolerant search, no ranking changes, no reordering of existing result lists.
- No removal of raw-code or record-number searchability ("not the entry ID/number" means the
  humanized form must *also* work, not that codes stop working).
- No change to which fields a given page searches (we augment the *form* of coded fields only;
  we do not add or remove searched fields).
- No FTS reindex (intel FTS is fixed query-side, not by re-ingesting).

## Architecture

```
            ┌──────────── shared "raw + humanized haystack" principle ────────────┐
            │                                                                      │
  WEB (Mac/Win)                 BACKEND (serves web+iOS)             iOS (field app)
  client/src/utils/             src/utils/searchText.ts              FieldFormat.swift
    searchText.ts               codeCandidates(term)                 (display already
  coded(raw, humanizer)         codedLike(col, term)                  humanized; audit for
   → "traffic_stop               → expands query so                   any raw-value filter)
      traffic stop"              "Traffic Stop" also                  record search is
  adopted at ~70 filter         matches stored                        server-backed →
  sites (one-expr swap)         "traffic_stop"                        inherits backend fix
```

Each of web and backend gets one small, pure, unit-tested helper. Adoption is mechanical but
not blind — each coded field needs the correct humanizer chosen.

## Component 1 — Web (`client/src/utils/searchText.ts`)

New module. Two primitives plus a field→humanizer registry.

```ts
type Humanizer = (v: string | null | undefined) => string;

/**
 * Lowercase haystack fragment for a coded field: raw + humanized, deduped, null-safe.
 *   coded('traffic_stop', humanizeType) → "traffic_stop traffic stop"
 *   coded('P1', humanizePriority)        → "p1 priority 1"
 *   coded(null)                          → ""
 */
export function coded(raw: string | null | undefined, humanizer?: Humanizer): string;

/** Convenience for new sites: every whitespace-separated term must appear in the haystack. */
export function matchesQuery(
  query: string,
  ...parts: Array<string | number | null | undefined>
): boolean;
```

### Field → humanizer registry

```ts
import {
  humanizeType, humanizePriority, humanizeDisposition,
  humanizeGender, humanizeRace, humanizeCaseType,
} from './statusLabels';
import { formatEnumValue } from './formatters';

// Sensible defaults so adoption is consistent. formatEnumValue is the generic fallback.
const FIELD_HUMANIZERS: Record<string, Humanizer> = {
  type: humanizeType, incident_type: humanizeType, call_type: humanizeType,
  priority: humanizePriority,
  disposition: humanizeDisposition,
  gender: humanizeGender, sex: humanizeGender,
  race: humanizeRace,
  case_type: humanizeCaseType,
};

/** Humanize by key with a generic Title-Case fallback. */
export function humanizeField(key: string, raw: string | null | undefined): string;
/** coded() using the key's mapped humanizer (or generic fallback). */
export function codedByKey(key: string, raw: string | null | undefined): string;
```

### Adoption pattern (per site)

Free-text fields are left exactly as-is; **only the coded-field expression changes**, preserving
each page's existing `.includes(q)` chain and result ordering.

```ts
// before
inc.type.toLowerCase().includes(q)
// after
coded(inc.type, humanizeType).includes(q)
```

**Status exception.** `humanizeStatus(status, type)` is context-dependent (`'call' | 'incident' | 'unit'`),
so status sites pass the explicit closure rather than relying on a key map:

```ts
coded(x.status, s => humanizeStatus(s, 'incident')).includes(q)
```

### Scope of web adoption

All client-side filter sites that currently match a **coded** field. Identified via
`grep -rln "toLowerCase().includes" client/src` (~70 files). Each file is reviewed; only the
coded-field expressions are swapped. Free-text-only filters (name/address/number/narrative)
need no change but are confirmed during the sweep. The largely-unused `useLocalSearch` hook is
left in place (not the chosen vehicle).

## Component 2 — Backend (`src/utils/searchText.ts`)

New module. Expands the *query* into candidate patterns (the mirror of the web's expand-the-value
approach), then OR-combines them into a `LIKE` clause. Always includes the raw term (additive).

```ts
/**
 * Candidate match strings for a human query term, additive:
 *   "Traffic Stop" → ["Traffic Stop", "traffic_stop"]
 *   "Priority 1"   → ["Priority 1", "P1"]
 *   "On Scene"     → ["On Scene", "on_scene", "10-23"]
 */
export function codeCandidates(term: string): string[];

/**
 * Builds ( col LIKE ? ESCAPE '\' OR col LIKE ? ... ) plus the escaped, wildcard-wrapped binds.
 * Reuses the existing escapeLike() wildcard-escaping already in connections.ts.
 */
export function codedLike(col: string, term: string): { sql: string; binds: string[] };
```

`codeCandidates` derivation, in order:
1. raw trimmed term (back-compat — names, numbers, partial codes still match),
2. snake_case form: `term.trim().toLowerCase().replace(/\s+/g, '_')` (covers the dominant
   `traffic_stop` enum family),
3. a small **reverse map** for closed enums whose stored code is NOT a snake_case of the label
   (priority `"Priority 1"`→`P1`; unit/call statuses `"On Scene"`→`on_scene`/`10-23`). This map
   is kept intentionally small and mirrors the closed enums in `statusLabels.ts`.

### Sites to update (only where `LIKE` targets a coded column)

Coded columns are: `incident_type`, `status`, `priority`, `category`, `disposition`. Name,
number, address, and narrative `LIKE`s are left untouched.

- `src/routes/connections.ts` `/search` — graph seeder (`incident_type`, `calls_for_service.incident_type`/`status`)
- `src/routes/records.ts` — record-link search (the linkage picker backend)
- `src/routes/dispatch/calls.ts`, `src/routes/dispatch/aggregates.ts`,
  `src/routes/useOfForce.ts`, `src/routes/codeEnforcement.ts`,
  `src/routes/knowledgeBase.ts` — coded-column filters

Each is confirmed by reading the SQL before editing; only coded-column predicates are expanded.

### Intel FTS5 (`/api/intel`)

FTS tokenizes `traffic_stop` as a single token, so a "traffic stop" query misses. Fix is
**query-side, no reindex**: when building the FTS `MATCH` expression, add the snake_case
candidate as an OR group (e.g. `("traffic stop" OR traffic_stop)`). This is the
highest-uncertainty piece; the exact tokenizer behavior (whether `_` is a separator under the
configured tokenizer) is **verified during implementation** before the expansion form is fixed.
If verification shows the tokenizer already splits on `_`, this sub-task is dropped as
unnecessary and that is recorded in the PR.

## Component 3 — iOS

iOS record **search** is server-backed (the app POSTs the query to the Worker), so it inherits
the Component 2 fix automatically. `FieldFormat` already humanizes **display** (#1178).

Work is an **audit**: confirm no iOS view filters records client-side on a raw coded value.
Known state: `SubjectRecordsView` shows no client-side record filter; `FieldToolkitView` filters
tool `title`/`category` (already plain English). If any raw-value record filter is found, build
its match haystack from `FieldFormat.value(key, raw)` + the raw value (the iOS analog of
`coded()`). Expected outcome: little-to-no iOS code change beyond the audit.

## Data Flow (worked example)

Officer types **"Traffic Stop"** into the Incidents search box for a record stored as
`incident_type = 'traffic_stop'`:

1. **Web (local table filter):** `coded('traffic_stop', humanizeType)` → `"traffic_stop traffic stop"`;
   `.includes("traffic stop")` → **true**. Row shows. (Typing `traffic_stop` also still matches.)
2. **Backend (e.g. Connections graph seed):** `codedLike('incident_type', 'Traffic Stop')` →
   `(incident_type LIKE '%Traffic Stop%' OR incident_type LIKE '%traffic_stop%')` → matches the
   stored row. Node appears in the graph.
3. **iOS:** the same query hits the backend endpoint → inherits (2); display already humanized.

## Error Handling & Edge Cases

- **Nulls/empties:** `coded(null)`/`coded('')` → `""`; `codeCandidates('')` → `[]` (caller no-ops).
- **Unknown codes:** humanizer returns input unchanged → `coded()` dedupes so the haystack isn't
  doubled; still matches the raw form.
- **LIKE wildcards in user input** (`%`, `_`): backend reuses the existing `escapeLike()` so a
  search for `50%` doesn't match everything; web `.includes()` is literal (no wildcards).
- **Reverse-map ambiguity:** if a human term maps to multiple codes, all are OR'd (additive) — no
  silent narrowing.
- **Performance:** web haystacks are short per-row strings; backend adds 1–2 extra `LIKE` terms
  per coded column (existing `LIMIT n` per entity unchanged). Negligible.

## Testing

- **Web (vitest):**
  - `coded()` — both forms present, deduped, null-safe.
  - `matchesQuery()` / `humanizeField()` / `codedByKey()` dispatch incl. generic fallback.
  - One representative page test (`IncidentsPage` filter) proving "Traffic Stop" matches a
    `traffic_stop` row AND `traffic_stop` still matches.
- **Backend (vitest, root `tests/` — same location as `tests/walletToken.test.ts`):**
  - `codeCandidates('Traffic Stop')` ⊇ `traffic_stop`; `codeCandidates('Priority 1')` ⊇ `P1`.
  - `codedLike()` SQL shape + bind array (correct OR count, escaped wildcards).
- **iOS:** extend `FieldFormatTests` only if iOS filter code is added.

## Rollout / Phasing

Each phase is additive and independently shippable; one feature branch + PR per phase, per the
repo's PR-review flow (no direct push to main). Bump `client/public/sw.js` `CACHE_NAME` on any
client phase.

| Phase | Scope | Risk | SW bump |
|-------|-------|------|---------|
| **1** | Web: `searchText.ts` + adopt across ~70 filter sites + tests | Low (pure client, additive) | yes |
| **2** | Backend: `codeCandidates`/`codedLike` + coded-column LIKE sites + intel FTS query-expansion + tests | Medium (live `rmpg-flex` worker; verify routing per cutover notes) | — |
| **3** | iOS audit (+ fix only if a raw-value filter exists) | Low | — |

Phase 2 touches the live worker, which is cutover-sensitive (see project routing notes), so it
earns its own review/verify cycle. Because matching is additive, Phase 1 shipping before Phase 2
never regresses anything.

## Open Questions (resolve during implementation, not blocking)

1. Exact intel FTS tokenizer behavior for `_` — verify before fixing the MATCH expansion form
   (may make the FTS sub-task unnecessary).
2. Final contents of the backend status reverse-map — enumerate from `statusLabels.ts` closed
   enums during Phase 2.
