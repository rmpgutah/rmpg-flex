# Universal Disposition Framework + Attempt-History & Time-Clock Fixes

**Date:** 2026-06-22
**Author:** Claude Opus 4.7 (in collaboration with Christopher Zamora)
**Status:** Design — pending operator review before plan authoring
**Trigger:** Operator-attached `Attempt to Serve` PDF + four-part request:
  (1) fix contact-attempt notes fallback, (2) fix time-clock 6-hour offset,
  (3) generalize the Process Server disposition-code system across the app,
  (4) lay out a unified attempt-code picker and history display.

## TL;DR

The Process Server module already has a well-built structured-disposition
system ([`src/utils/processServiceCodes.ts`](../../../src/utils/processServiceCodes.ts) —
47 codes in 10 PS/00–PS/45 categories with legacy-result mapping, queue-outcome
mapping, tone, hints). It is **isolated** — only `serve_attempts` uses it. CFS,
cases, jail, crisis-response and other modules close with free-text dispositions
that don't cross-reference each other.

This design ships the well-built pattern into a **universal framework** spanning
three taxonomies (PS = Process-Serve, CC = Call-Closure, CT = Court) with a
**crosslink engine** that auto-propagates closures across the CFS → Serve → Case
chain. Two surgical bugs ride alongside in the first PR.

**Staging:** Five PRs over multiple sessions. PR-A bugs ship today; PR-B
foundation next; PR-C/D/E layer on top.

## Goals

- **Stop payroll corruption** — every clock-in row stored before this lands has
  a UTC timestamp labeled `+00:00` that the display layer treats as wall-clock,
  yielding a 6-hour offset in June (7-hour in winter). Stop the bleed; backfill
  the rows.
- **Stop blank attempt-history rows** — when an operator skipped the notes
  field, the timeline row collapses to `date | type | result` with empty space.
  The PSO `disposition_code` is already there — display it.
- **Unify dispositions** — three modules (CFS, Serve, Cases) get a shared code
  taxonomy with the same 5-increment hierarchy, the same chip renderer, the same
  picker, and the same audit trail.
- **Make closures flow** — when a CFS closes with CC/25.x (process-service
  outcome), spawn the matching PS serve attempt automatically. When a case
  dismisses (CT/15), recall any open serve papers. Operator-set codes are
  authoritative; the engine just fans them out.
- **Per-code RBAC** — sensitive codes (PS/35 court-ordered, PS/40.10 already
  served, CT codes generally) gated to supervisors and above.
- **Per-officer per-domain recents** — Officer Zamora's frequently-used PS codes
  surface at the top of the PS picker; his CC recents stay in the CC picker.

## Non-Goals

- **No taxonomy expansion in the bug-fix PR.** PR-A is strictly the two bugs.
- **No code-editing UI in this design.** Operators don't edit code definitions
  through the admin UI yet — that's a future PR after the framework lands.
- **No backfill of historical CFS dispositions into CC codes.** Existing
  free-text `disposition` columns stay readable; the new `disposition_code`
  column populates going forward + auto-translates on read via heuristics.
- **No replacing of WelfareWatchDO outcomes** — welfare checks roll into the DO's
  existing enum, NOT into CC codes. CC/30 is **dropped** from the taxonomy.
- **No expansion into modules outside CFS/Serve/Cases in this design** (jail,
  crisis-response, field-interviews, evidence). They keep their current
  disposition fields. They can adopt the framework later by following the same
  pattern PR-C uses.

## Scope Decomposition (5 PRs)

This design covers all five PRs. Each PR gets its own implementation plan via
the `superpowers:writing-plans` skill after operator approves this spec.

| PR | Subject | Migration (planned) | Risk |
|---|---|---|---|
| **A** | Notes fallback + Time-clock dual-stamp | `0150` | Low (cosmetic + data hygiene) |
| **B** | Universal disposition framework foundation | `0151` | Medium (touches every PSO render site) |
| **C** | CC codes (Call-Closure for CFS) | `0152` | Medium (new column on calls_for_service) |
| **D** | CT codes (Court/Case dispositions) | `0153` | Low (informational, picker rarely used) |
| **E** | Cross-link engine | `0154` | Medium (cascading writes; reversible) |

Migration numbers above are **the next-free integers as of 2026-06-22**
(`ls migrations/` shows `0149_nsopw_records_links.sql` as the high-water).
If other PRs land between this design and PR-A implementation, each PR's plan
will pick the next-free integer at implementation time — the **order** matters
(A → B → C → D → E), the **numbers** don't.

---

## PR-A — Bug Fixes

### A1. Notes fallback in attempt history

**File:** [`client/src/components/serve/ServeJobCard.tsx`](../../../client/src/components/serve/ServeJobCard.tsx)

Replace the conditional render at line 333:

```tsx
const fallback = attempt.notes
  || formatCodeShort(attempt.disposition_code);
const isFallback = !attempt.notes;

{fallback && (
  <span
    className={`text-[10px] truncate flex-1 min-w-0 ${
      isFallback ? 'italic text-rmpg-500' : 'text-rmpg-400'
    }`}
    title={isFallback ? 'No operator notes — showing disposition code' : undefined}
  >
    {fallback}
  </span>
)}
```

**Hierarchy:** operator notes (canonical) → `formatCodeShort(disposition_code)`
(reader knows the taxonomy from training; no extra hint text per operator
preference). Italic + dimmer color signals the fallback case so a reviewer can
distinguish operator-written text from auto-derived text at a glance.

**Import path note:** PR-A imports `formatCodeShort` from
[`src/utils/processServiceCodes.ts`](../../../src/utils/processServiceCodes.ts) /
its client mirror — i.e., from the current file location. PR-B moves the helper
to `src/dispositions/registry.ts`; PR-B's plan updates the ServeJobCard import
as part of the chip swap. The PR-A fallback span is then **removed** in PR-B
because the chip itself carries the code display — the fallback span only needs
to exist for the brief PR-A interval where the legacy `result` text is still
the primary code surface.

**Same fix applies in `processServiceNotice.ts` PDF renderer** if it has a
parallel render — to verify during PR-A implementation.

### A2. Time-clock dual-stamp + backfill

**Files touched:**
- [`src/routes/personnel.ts`](../../../src/routes/personnel.ts) — every clock
  in/out/break write path swaps `new Date().toISOString().replace(...)` for
  `nowDualStamp()`.
- **New** `src/utils/denverTime.ts` — `nowDualStamp()` helper returns
  `{ utc, local }` using `Intl.DateTimeFormat` with `timeZone: 'America/Denver'`.
  DST-aware: June stamps MDT, December stamps MST automatically. `Intl` carries
  IANA zone data — the only DST-correct path inside Cloudflare Workers (Workers
  have no `TZ`; `Date.getTimezoneOffset()` returns 0; SQLite's
  `datetime(..., 'localtime')` resolves UTC).
- **New** `scripts/backfill-time-entries-denver.js` — one-shot script. Reads
  every row, parses `clock_in` / `clock_out` / `break_start` / `break_end` as
  UTC, formats via `Intl` into Denver wall-clock, writes to the `_local`
  columns. Idempotent — only writes when the `_local` column is null. Logs the
  count. Run via `wrangler d1 execute rmpg-flex --remote --file ...` after
  `0150` lands.
- Display sites (client time-clock and timecard pages) read `clock_in_local`
  with fallback to `clock_in` for ancient rows the backfill missed. Hours-worked
  math stays UTC-based.

**Migration `0150_time_entries_local_stamps.sql`:**

```sql
ALTER TABLE time_entries ADD COLUMN clock_in_local TEXT;
ALTER TABLE time_entries ADD COLUMN clock_out_local TEXT;
ALTER TABLE time_entries ADD COLUMN break_start_local TEXT;
ALTER TABLE time_entries ADD COLUMN break_end_local TEXT;
CREATE INDEX IF NOT EXISTS idx_time_entries_clock_in_local ON time_entries (clock_in_local);
```

**Verification:**
1. Manually clock in/out at a known wall-clock time; confirm `clock_in_local`
   matches.
2. `wrangler d1 execute rmpg-flex --remote --command "SELECT clock_in, clock_in_local FROM time_entries ORDER BY id DESC LIMIT 5"` — both columns populated.
3. Run backfill script; query historical rows; confirm `clock_in_local` is 6 or 7
   hours behind `clock_in` depending on date.
4. Per `[[feedback-verify-main-compiles-after-stack-merge]]`, apply migration
   directly to live D1 `785de7ae` after merge and verify with
   `pragma_table_info`.

---

## PR-B — Universal Disposition Framework Foundation

### B1. Source-of-truth layout

New directory `src/dispositions/`:

```
src/dispositions/
  types.ts          → DispositionCode, DispositionCategory, DispositionDomain
  ps.ts             → PS/00–PS/45 (moved from src/utils/processServiceCodes.ts;
                      content unchanged, types regenerated to use new shape)
  cc.ts             → CC/00–CC/55 stub (codes ship in PR-C; PR-B has the file
                      and an empty array)
  ct.ts             → CT/00–CT/45 stub (codes ship in PR-D)
  registry.ts       → all-codes index, lookup helpers, formatCodeShort/Full
  crosslinks.ts     → cross-link declarations (data; engine in PR-E uses it)
  seed.ts           → boot reconciler — syncs TS source → disposition_codes DB
```

The Worker imports from `src/dispositions/` directly. The client mirrors via a
new `npm run sync-dispositions` script that copies the directory to
`client/src/dispositions/` with a `// GENERATED — edit src/dispositions/*`
banner. The mirror is **one-way**.

**CI guard:** new `.github/workflows/disposition-sync-check.yml` hashes both
trees on every PR; fails if they drift. Pattern mirrors the existing
`column-cap-check.yml` workflow.

Why mirror-with-CI-guard instead of a shared path alias: `/src/` and
`/client/src/` use separate `tsconfig`s and separate bundlers. Cross-build
imports break sourcemaps and confuse `tsc --noEmit`. The existing PSO
file already follows this manual-mirror pattern; PR-B formalizes it.

### B2. Generalized types

```ts
// src/dispositions/types.ts
export type DispositionDomain = 'PS' | 'CC' | 'CT';
export type DispositionTone = 'success' | 'attempt' | 'danger' | 'admin' | 'pending';
export type Role = 'admin' | 'manager' | 'supervisor' | 'officer' | 'dispatcher' |
  'contract_manager' | 'client_viewer' | 'human_resources';

export interface DispositionCode {
  code: string;          // "PS/15.05", "CC/25.01", "CT/15.01"
  domain: DispositionDomain;
  category: string;      // "PS/15"
  label: string;
  short: string;
  hint?: string;
  tone: DispositionTone;
  /** Roles allowed to apply this code. Undefined = all authed users. */
  allowedRoles?: Role[];
  /** Module-specific outcome enums (legacy result, queue status, case status). */
  outcomes?: Record<string, string>;
}

export interface DispositionCategory {
  code: string;
  domain: DispositionDomain;
  label: string;
  description: string;
  tone: DispositionTone;
}
```

Migrating PS codes onto this shape: `PsoCode.result` → `outcomes.legacyResult`,
`PsoCode.queueOutcome` → `outcomes.queueStatus`. No data shape change in the DB
(`serve_attempts.disposition_code` stays as-is).

### B3. Registry table + crosslinks table

**Migration `0151_disposition_registry.sql`:**

```sql
CREATE TABLE IF NOT EXISTS disposition_codes (
  code TEXT PRIMARY KEY,
  domain TEXT NOT NULL,
  category TEXT NOT NULL,
  label TEXT NOT NULL,
  short TEXT NOT NULL,
  hint TEXT,
  tone TEXT NOT NULL,
  allowed_roles_json TEXT,            -- JSON array; null = all roles allowed
  outcomes_json TEXT,                  -- JSON blob of module outcome enums
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_disposition_codes_domain ON disposition_codes (domain);
CREATE INDEX IF NOT EXISTS idx_disposition_codes_category ON disposition_codes (category);

CREATE TABLE IF NOT EXISTS disposition_crosslinks (
  source_code TEXT NOT NULL,
  target_code TEXT NOT NULL,
  reason TEXT NOT NULL,
  auto_flow INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (source_code, target_code)
);
```

**Boot reconciler** (`src/dispositions/seed.ts`) runs on Worker start via the
existing migration-reconcile pattern: walks `PS_CODES`, `CC_CODES`, `CT_CODES`,
`DISPOSITION_CROSSLINKS`; does `INSERT OR REPLACE INTO disposition_codes` and
`INSERT OR IGNORE INTO disposition_crosslinks`. TS source remains authoritative;
the DB rows are an indexed mirror. Codes removed from TS source stay in the DB
so historical references resolve.

### B4. Shared components

**`<DispositionCodeChip code="PS/15.05" size="sm" />`** — drop-in renderer used
in ServeJobCard rows, the Notice PDF, the audit log, future CFS/case surfaces.
Props:
- `code: string`
- `size?: 'xs' | 'sm' | 'md'` (default `'sm'`)
- `showHint?: boolean` (renders the hint inline; default false)
- `showCategory?: boolean` (prepends category label; default false)
- `tooltipMode?: 'hint' | 'label' | 'off'` (default `'hint'`)

Color comes from `DispositionCategory.tone` → CSS variable. No hardcoded hex
per the theme rules. The chip auto-re-themes between night and day.

**`<DispositionCodePicker domain="PS" value={...} onChange={...} />`** —
two-pane category-grid + code-grid layout. Optimized for iPad/phone:
- 44×44 min touch targets (iOS HIG)
- Left pane: 10 category tiles colored by tone
- Right pane: codes within selected category, recent codes pinned at top
- Search box across top for power users
- RBAC: codes whose `allowedRoles` exclude the current user are hidden (server
  validates on write)

**Recent codes:** localStorage key `disposition_recents_<officerId>_<domain>` =
`string[]` of last 8 codes, most-recent first. Set on picker submit, used to
pin at top of the right pane.

### B5. Adoption in PR-B

- [`ServeJobCard.tsx`](../../../client/src/components/serve/ServeJobCard.tsx)
  attempt-row renders the chip alongside the PR-A notes-fallback span. The
  legacy `attempt.result` red/green text is replaced by the chip.
- [`EditServeAttemptModal.tsx`](../../../client/src/components/serve/EditServeAttemptModal.tsx)
  and `ServeAttemptModal.tsx` swap their dropdowns for
  `<DispositionCodePicker domain="PS">`.
- `processServiceNotice.ts` PDF render uses the chip's text form
  (`formatCodeShort`) — no JSX in the PDF generator.

**No data shape changes.** `serve_attempts.disposition_code` column stays.

### B6. Verification

- Sync script lints cleanly: `npm run sync-dispositions && git diff --exit-code client/src/dispositions/`
- Boot reconciler: `SELECT COUNT(*) FROM disposition_codes WHERE domain='PS'`
  after first deploy returns 47 (current PSO_CODES count) within 60 seconds.
- Chip renders identically in dark and light theme (CSS variable-driven).
- Picker filters codes by `allowedRoles` against the current user's role.

---

## PR-C — CC Codes (Call-Closure for CFS)

### C1. Taxonomy (11 categories, ~40 codes)

Operator-locked structure:

| Category | Purpose | Sub-codes |
|---|---|---|
| **CC/00** Non-Action | call wasn't actionable | UNF, CXL-Caller, Duplicate, Closed-by-Phone |
| **CC/05** Resolved On-Scene | dispatched, resolved | RTF, Verbal Warning, Mediated, Civil Standby Done |
| **CC/10** Enforcement | enforcement action taken | ARR, CIT, Notice to Appear, Trespass Warning, Civil Infraction |
| **CC/15** Gone on Arrival | nobody there | GOA-Suspect, GOA-Caller, UTL |
| **CC/20** Transported/Referred | handoff to other agency | Hospital, Detox/Crisis, → SLCPD/UPD, → AP&P, → DCFS |
| **CC/25** Process-Service Outcome *(PS bridge)* | CFS was actually a serve call | .01→PS/05.01, .05→PS/10.01, .10→PS/20.01, .15→PS/00.01, .20→PS/15.01, .99→PS/00.99 |
| **CC/35** Property/Patrol | routine property action | Property Secured, Door Open (Secured), Susp Circ Cleared, Routine Pass |
| **CC/40** Administrative | admin closure | Cxl-Dispatch, Cxl-Client, Duplicate Dispatch, Test/Training, Other Admin |
| **CC/45** Pending | call still in flight | Initial Response, On-Scene, Awaiting Resolution |
| **CC/50** *(new)* Use of Force | UoF disposition | De-escalation, OC, Hands-On, TASER, Impact, Lethal, Other |
| **CC/55** *(new)* Client-Specific | contract-security specific | Client Notified, Client Refused, Client Billing Event, Client Requested Police, Property Damage, Other |

**CC/30 Welfare Check is dropped** — welfare checks live in `WelfareWatchDO`'s
existing outcome enum, not in CC. Cross-link is via the DO's domain.

### C2. Migration `0152_cfs_disposition_code.sql`

```sql
ALTER TABLE calls_for_service ADD COLUMN disposition_code TEXT;
CREATE INDEX IF NOT EXISTS idx_cfs_disposition_code ON calls_for_service (disposition_code);

-- New: UoF needs a place to land on the incident report it spawns
ALTER TABLE incident_reports ADD COLUMN uof_disposition_code TEXT;
```

Per the [`CLAUDE.md`](../../../CLAUDE.md) 100-column SELECT cap rule:
`calls_for_service` is at 100 columns. **The new column goes in
`calls_for_service_ext`**, not the parent table. PR-C plan must check
`scripts/check-column-cap.js` output and route the column to `_ext` if
necessary.

Free-text `calls_for_service.disposition` stays for back-compat. On read, the
existing free-text auto-translates to a CC code via
`registry.dispositionToCode(domain='CC', text)` heuristic — same pattern as
PS's existing `dispositionToCode`.

### C3. Hook points

- [`src/utils/cfsActions.ts`](../../../src/utils/cfsActions.ts) `closeCfs()` —
  takes optional `disposition_code: string`, validates it's a CC code, stores
  in the new column AND keeps writing free-text disposition for back-compat.
  Calls `propagateDisposition()` (PR-E).
- [`src/routes/dispatch/calls.ts`](../../../src/routes/dispatch/calls.ts) — close
  endpoint accepts `disposition_code` in the body.
- Client `DispositionPrompt.tsx` swaps its current dropdown for
  `<DispositionCodePicker domain="CC">`. Falls back to free-text input for
  codes not in the taxonomy.

### C4. Verification

- Close a CFS with `disposition_code='CC/25.20'` (evasive); confirm a
  `serve_queue` row is spawned with `disposition_code='PS/15.01'` and the
  history row is logged.
- Close a CFS with `disposition_code='CC/50.15'` (TASER); confirm an
  `incident_reports` stub is created with `uof_disposition_code='CC/50.15'`.
- Picker for CC domain hides CC/10.x for an `officer` role if RBAC rules say
  so (TBD per operator).

---

## PR-D — CT Codes (Court/Case Dispositions)

### D1. Taxonomy (10 categories, ~32 codes)

Operator-locked: **informational only**. CT codes are imported from court
records (CourtListener docket integration); operators rarely apply them
directly. The picker exists for the rare manual override case.

| Category | Purpose | Sub-codes |
|---|---|---|
| **CT/00** Pending | case is open | Filed/Awaiting Hearing, Continued, In Discovery, In Mediation |
| **CT/05** Conviction | guilty outcome | Guilty Plea, No Contest, Jury-Guilty, Bench-Guilty |
| **CT/10** Acquittal | not-guilty outcome | Jury-NG, Bench-NG, Directed Verdict |
| **CT/15** Dismissed | case ended without trial | With Prejudice, Without Prejudice, Want of Prosecution, Lack of PC |
| **CT/20** Deferred/Diverted | resolution pending compliance | Plea in Abeyance, Diversion Program, Stayed Sentence |
| **CT/25** Sealed/Expunged | post-resolution sealing | Expunged, Sealed |
| **CT/30** Civil Outcome | civil case resolution | Judgment-Plaintiff, Judgment-Defendant, Settled, Default Judgment |
| **CT/35** Appellate | appeal status | On Appeal, Appeal Denied, Appeal Sustained |
| **CT/40** Administrative | admin closure | Recalled by Prosecutor, Sealed by Court Order, Transferred |
| **CT/45** Closed | terminal closure | Final, Sentence Complete, Restitution Paid |

### D2. Migration `0153_cases_disposition_code.sql`

```sql
ALTER TABLE cases ADD COLUMN disposition_code TEXT;
ALTER TABLE cases ADD COLUMN disposition_set_at TEXT;
ALTER TABLE cases ADD COLUMN disposition_set_by INTEGER;  -- officer_id; null = system/import
CREATE INDEX IF NOT EXISTS idx_cases_disposition_code ON cases (disposition_code);
```

### D3. Auto-set hook

The CourtListener docket-import job (existing in `src/routes/cases.ts` or a
sibling) gets a new heuristic mapper `courtListenerToCt(docketEntry)` that
returns a CT code from common docket-text patterns ("Dismissed", "Plea
Accepted", "Verdict — Guilty", etc.). When found, the case's
`disposition_code` is updated and `propagateDisposition()` fires.

### D4. RBAC

CT codes generally gated to `supervisor` and above (officers don't set court
outcomes). Picker hides them for unauthorized roles; server validates.

---

## PR-E — Cross-link Engine

### E1. Crosslink declarations

Data, not code. Lives in `src/dispositions/crosslinks.ts`:

```ts
export const DISPOSITION_CROSSLINKS: Crosslink[] = [
  // CC → PS (process-service CFS spawns a serve queue row)
  { source: 'CC/25.01', target: 'PS/05.01', reason: 'CFS closed as personally served', autoFlow: true },
  { source: 'CC/25.05', target: 'PS/10.01', reason: 'CFS closed as sub-served', autoFlow: true },
  { source: 'CC/25.10', target: 'PS/20.01', reason: 'CFS closed as posted', autoFlow: true },
  { source: 'CC/25.15', target: 'PS/00.01', reason: 'CFS closed as no answer', autoFlow: true },
  { source: 'CC/25.20', target: 'PS/15.01', reason: 'CFS closed as evasive', autoFlow: true },
  { source: 'CC/25.99', target: 'PS/00.99', reason: 'CFS closed with other PS outcome', autoFlow: true },

  // CC/50 (UoF) → incident_reports (sentinel target INC/UOF)
  { source: 'CC/50.01', target: 'INC/UOF', reason: 'UoF de-escalation logged', autoFlow: true },
  { source: 'CC/50.05', target: 'INC/UOF', reason: 'OC deployment requires UoF report', autoFlow: true },
  { source: 'CC/50.10', target: 'INC/UOF', reason: 'Hands-on force requires UoF report', autoFlow: true },
  { source: 'CC/50.15', target: 'INC/UOF', reason: 'TASER deployment requires UoF report', autoFlow: true },
  { source: 'CC/50.20', target: 'INC/UOF', reason: 'Impact weapon requires UoF report', autoFlow: true },
  { source: 'CC/50.25', target: 'INC/UOF', reason: 'Lethal force requires UoF report', autoFlow: true },

  // CC/55.10 (Client billing event) → invoice line
  { source: 'CC/55.10', target: 'INV/AUTO', reason: 'Client billing event triggers invoice line', autoFlow: true },

  // CT → PS (court closure recalls open serve papers)
  { source: 'CT/15.01', target: 'PS/40.05', reason: 'Case dismissed with prejudice — recall papers', autoFlow: true },
  { source: 'CT/15.05', target: 'PS/40.05', reason: 'Case dismissed without prejudice', autoFlow: true },
  { source: 'CT/15.10', target: 'PS/40.05', reason: 'Case dismissed (want of prosecution)', autoFlow: true },
  { source: 'CT/15.15', target: 'PS/40.05', reason: 'Case dismissed (lack of PC)', autoFlow: true },
  { source: 'CT/40.01', target: 'PS/40.05', reason: 'Prosecutor recalled — recall papers', autoFlow: true },

  // PS → CT (service complete; suggest case clock starts) — propose-only
  { source: 'PS/05.01', target: 'CT/00.05', reason: 'Service complete; case clock starts', autoFlow: false },
  { source: 'PS/10.01', target: 'CT/00.05', reason: 'Sub-service complete; case clock starts', autoFlow: false },
  { source: 'PS/20.01', target: 'CT/00.05', reason: 'Posting service complete', autoFlow: false },
];
```

Sentinel targets (`INC/UOF`, `INV/AUTO`) aren't disposition codes themselves —
they're keywords the engine dispatches on to know which side-table to write.

### E2. Engine implementation

**File:** `src/utils/dispositions/crosslinkEngine.ts`

```ts
export async function propagateDisposition(
  env: Env,
  source: { code: string; entityType: 'cfs' | 'serve' | 'case'; entityId: number; setBy: number | null },
  ctx: ExecutionContext,
): Promise<PropagationResult>
```

Per the operator-locked **aggressive** auto-apply mode:
1. Look up all `disposition_crosslinks` where `source_code = source.code`.
2. For each with `auto_flow = 1`:
   - Compute idempotency key `${source.entityType}|${source.entityId}|${source.code}|${target_code}`.
   - If `disposition_history` already has a non-reverted row with that key, skip.
   - Apply the target mutation in a transaction (described in E3).
   - Insert `disposition_history` row.
3. For each with `auto_flow = 0`:
   - Insert `disposition_history` row with `applied_at = null` to mark as
     proposed; admin UI lists these for review (admin UI is future PR).

All cross-link writes go through `ctx.waitUntil` so the originating request
returns fast. Failures log to audit but don't fail the source mutation.

### E3. Target dispatch

```ts
async function applyCrosslink(env, source, link, ctx): Promise<PropagationEvent> {
  switch (true) {
    case link.target_code.startsWith('PS/'):
      // upsert serve_queue row + log serve_attempt
      return applyToServe(env, source, link);
    case link.target_code.startsWith('CT/'):
      // update cases.disposition_code
      return applyToCase(env, source, link);
    case link.target_code === 'INV/AUTO':
      // create invoice_lines row
      return applyToInvoice(env, source, link);
    case link.target_code === 'INC/UOF':
      // create incident_reports stub
      return applyToIncidentReport(env, source, link);
  }
}
```

### E4. Hook points

| Module | File | Hook |
|---|---|---|
| CFS close | [`src/utils/cfsActions.ts`](../../../src/utils/cfsActions.ts) | After write of `disposition_code`, call `propagateDisposition({ entityType: 'cfs', ... })` |
| Serve attempt | [`src/routes/serve.ts`](../../../src/routes/serve.ts) `POST /:id/attempt` | After write of attempt + `disposition_code`, call engine |
| Case disposition | [`src/routes/cases.ts`](../../../src/routes/cases.ts) | After write of `disposition_code`, call engine |
| CourtListener import | (existing job) | After import sets a CT code, call engine |

### E5. Audit table

**Migration `0154_disposition_history.sql`:**

```sql
CREATE TABLE IF NOT EXISTS disposition_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_entity_type TEXT NOT NULL,
  source_entity_id INTEGER NOT NULL,
  source_code TEXT NOT NULL,
  target_entity_type TEXT,
  target_entity_id INTEGER,
  target_code TEXT,
  reason TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  applied_at TEXT,                     -- null = proposed; set on auto-apply or admin confirm
  applied_by INTEGER,                  -- officer_id who set source; null = system
  reverted_at TEXT,
  reverted_by INTEGER
);
CREATE INDEX IF NOT EXISTS idx_disposition_history_source
  ON disposition_history (source_entity_type, source_entity_id);
CREATE INDEX IF NOT EXISTS idx_disposition_history_target
  ON disposition_history (target_entity_type, target_entity_id);
```

### E6. Reversibility

Admin UI (later PR) lists `disposition_history` rows with revert buttons. Per
the operator-locked aggressive mode, every auto-applied change is reversible:
- Revert target mutation (delete spawned row, or restore previous
  `disposition_code` from `audit_log`)
- Set `disposition_history.reverted_at` and `reverted_by`
- Idempotency key remains; re-firing the same source disposition will not
  re-apply because the history row exists. Operator must manually re-issue.

### E7. Verification

- Close a test CFS with `CC/25.20`; query `disposition_history` — one row with
  `target_code = 'PS/15.01'`. Query `serve_queue` — new row exists with that
  code.
- Close the same CFS again (same call_id); query `disposition_history` — still
  one row. Idempotency works.
- Dismiss a test case with `CT/15.05`; query `serve_queue` rows linked to that
  case — `disposition_code = 'PS/40.05'`, status updated.
- Revert via admin UI; verify the serve_queue row's disposition resets.

---

## Risks & Mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Time-clock backfill mis-converts a row (DST edge case at 2026 spring-forward midnight) | Low | `Intl.DateTimeFormat` is the IANA-aware path; spot-check the two rows nearest the DST transition manually post-backfill |
| Sync script drift between PR-B and the client mirror | Medium | CI guard fails the PR; pre-push hook (existing) catches locally |
| Cross-link engine spawns duplicate serve_queue rows under retry | High without idempotency | Idempotency key from `source_id + source_code + target_code`; existence check before write |
| `calls_for_service` hits 100-column cap when CC code is added | Certain (already at 100) | Route the new column to `calls_for_service_ext` per the `_ext` overflow pattern documented in CLAUDE.md gotcha #13 |
| `disposition_code` value drift between TS source and DB | Medium | Boot reconciler runs `INSERT OR REPLACE` on every Worker start; mismatch self-heals within 60s of deploy |
| Aggressive auto-flow surprises an operator (CC/25.20 spawned a serve row they didn't expect) | Medium | All changes reversible via `disposition_history`; admin UI ships in a follow-up PR; the `auto_flow=true` rules are seeded but admin can flip them to `false` per-row via direct DB edit until UI ships |
| Migrations don't reach live D1 (existing known issue) | High | Per the existing `scripts/apply-migration.sh` workflow, apply each of `0150`–`0154` directly to live `785de7ae` after merge. Verify with `pragma_table_info` |
| CT code mapper mis-classifies a docket entry from CourtListener | Medium | Mapper is heuristic; if `null`, CT code stays empty (no propagation). Operator can manually override |

## Open Questions for Operator Review

None remaining for design approval. Implementation-time questions (e.g., per-PR
RBAC list, exact CC/50 cross-link semantics for `INC/UOF` body content) will
surface in the `superpowers:writing-plans` step for each PR.

## Next Step

After operator approves this spec, invoke `superpowers:writing-plans` to author
PR-A's implementation plan first (bug fixes ship today). PR-B/C/D/E plans follow
in subsequent sessions.
