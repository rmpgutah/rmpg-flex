# Serve Intake v2 — Comprehensive Rebuild Design

**Status:** draft (awaiting operator review)
**Date:** 2026-08-26
**Author:** Claude (GLM-5.2) with operator direction
**Scope:** Full redesign of the Serve Intake subsystem — intake, scheduling, enforcement, registered-agent path, quality gate
**Supersedes (incorporates, not replaces):**
- `2026-06-22-serve-intake-quality-gate-design.md` (Phase 1 — shipped)
- `2026-07-26-serve-intake-ocr-enhancement-design.md` (PRs 1–2 shipped, PRs 3–4 pending)

---

## 1. Executive Summary

Serve Intake v1 is a working 222-file, 66K-line subsystem that extracts structured fields from uploaded civil-process packets, quality-gates them via a heuristic+LLM judge, commits serve jobs, generates a PSO briefing on the dispatch CFS, and tracks attempts through to service completion. It works. But it has accumulated structural debt that blocks the remaining roadmap:

- **Megafiles.** `serveIntake.ts` (2,994 lines), `ServeIntakePage.tsx` (2,062 lines), `serveIntakeExtract.ts` (1,272 lines), `serveIntakeRecords.ts` (1,359 lines). Changes touch hundreds of unrelated lines; review is hard; merge conflicts are chronic.
- **No shared code.** Worker (`src/`) and React (`client/src/`) have duplicate copies of `serveIntakeDefendants.ts`, `serveIntakeJudge.ts` types, and extraction field maps, all kept in sync by hand. They have drifted (today's `console.warn` fix was a drift repair).
- **Stale re-parsing.** `ServeIntakePage.tsx:519` re-runs `parseDefendants()` on every `files` state mutation — 3 OCR results trickling in = 3 identical parse passes and (before today) 3 identical `console.warn` lines.
- **Roadmap stalled at Phase 1.** The 4-phase roadmap (Quality Gate → Pre-Serve Intelligence → Field Workflow → Throughput) shipped Phase 1 only. Phases 2–4 are unbuilt.
- **PRs 3–4 of the OCR enhancement** (PDF render fixes, Serve Intake page UI) are unshipped. The 18+10 improvements there are documented and approved but not implemented.
- **Registered-agent path is implicit.** Business entities are silently skipped by `parseDefendants` with a comment saying "registered-agent path expected to handle" — but that path is not a first-class flow. It's ad-hoc logic scattered across extraction and commit.

Serve Intake v2 is a **consolidation-first rebuild**: break the megafiles into focused modules, extract shared code into a real shared package, build the missing registered-agent path as a first-class flow, ship the pending PR 3–4 UI work, and lay the groundwork for Phases 2–4. No net-new extraction models — the incumbent `llama-3.3-70b-instruct-fp8-fast` stays (A/B-confirmed). The goal is to make the subsystem **maintainable enough to ship Phases 2–4** rather than to add new ML.

---

## 2. Current State Assessment

### 2.1 What works well (keep)

| Area | Status | Evidence |
|------|--------|----------|
| OCR pipeline | ✅ Solid | Claude → OpenAI → Workers AI fallback chain with KV cooldown breaker; `toMarkdown` for PDF structure; `llama-3.3-70b` incumbent A/B-confirmed at 35/36 |
| Quality gate (Phase 1) | ✅ Shipped | `serveIntakeJudge.ts` heuristic+LLM judge; `serve_intake_judge_runs` audit table; `quality_status` lifecycle on `serve_queue` |
| Multi-defendant fanout | ✅ Shipped | `parseDefendants()` + `DefendantsPicker` + `commitIntake` loop over `defendants_selected` |
| Briefing decomposition | ✅ Shipped (PR 2) | 7-entry PSO briefing with authority strings, address-class timing, client-schedule parsing |
| Pre-clean + post-validation | ✅ Shipped (PR 1) | Watermark scrubbing, homoglyph normalization, date/zip/state validators |
| Serve receipts | ✅ Solid | `serve_receipts` table, QR scans, device fingerprint, integrity hash, lifecycle states |
| Attempt scheduling | ✅ Solid | `serve_attempt_schedules`, dwell times, attempt windows, timezone repair |
| Route optimization | ✅ Solid | `serveRouteOptimizer.ts` (1,096 lines), clustering, TSP-ish ordering |
| Test coverage | ✅ Broad | 68 test files, 10,751 lines; all four CI gates clean |

### 2.2 What's broken or debt-laden (fix in v2)

| ID | Problem | Impact | Root cause |
|----|---------|--------|------------|
| D-01 | `serveIntake.ts` is 2,994 lines | Review/merge pain, change-blast-radius | One Hono app holds upload, scan, intake, review-queue, reprocess, documents — 6 concerns in one file |
| D-02 | `ServeIntakePage.tsx` is 2,062 lines | Same | Upload, OCR review, defendant picker, quality panel, success card, missing-field strip — all one component |
| D-03 | No shared package between Worker and React | Drift (today's `console.warn` fix), duplicate maintenance | `serveIntakeDefendants.ts`, `serveIntakeJudge.ts` types, field maps maintained by hand in two trees |
| D-04 | `useEffect` at `ServeIntakePage.tsx:519` re-parses defendants on every `files` mutation | Wasted CPU, console spam (fixed today but parse still re-runs) | Effect deps `[files]` instead of memoized `bestDefendant` |
| D-05 | Registered-agent path is implicit | Business defendants silently dropped; no first-class flow | `parseDefendants` skips `is_business` with a comment; no RA-specific extraction, commit, or UI |
| D-06 | PR 3 (PDF render, 18 items) unshipped | Right-margin overflow, dead signature sheet, N/A runs, map collisions | Design approved 2026-07-26, not implemented |
| D-07 | PR 4 (Serve Intake page UI, 10 items) unshipped | No per-field confidence chips, no source badges, no conflict resolver, no address-class selector | Same |
| D-08 | Phase 2 (Pre-Serve Intelligence) unbuilt | No CAD/BOLO/warrant cross-ref at intake | Roadmap deferred |
| D-09 | Phase 3 (Field Workflow) unbuilt | No voice dictation, no on-scene ID-OCR, no mobile attempt-first flow | Roadmap deferred |
| D-10 | Phase 4 (Throughput) unbuilt | No bulk client-portal intake, no marketplace | Roadmap deferred |
| D-11 | Stale service-worker cache | Old accessibility warnings persist after source fix | SW cache invalidation is SHA-based but the operator may not have accepted the `Update` prompt |
| D-12 | `serveIntakeExtract.ts` (1,272 lines) holds all extraction logic | Hard to test individual document-family prompts | One file handles Information Form, Field Sheet, Court Docket prompts + merge + arbitration |

---

## 3. v2 Architecture

### 3.1 Module decomposition (fixes D-01, D-02, D-12)

**Worker route split** — `src/routes/serveIntake.ts` (2,994) → 6 focused route files:

```
src/routes/serveIntake/
  index.ts              — Hono sub-app, mounts all sub-routes (~80 lines)
  upload.ts             — POST /upload (multipart, OCR orchestration, judge, commit) (~600 lines)
  scan.ts               — POST /scan-document (single-file OCR for client preview) (~200 lines)
  intake.ts             — POST /intake (legacy text-only path) (~150 lines)
  documents.ts          — GET /:id/documents, GET /documents/:docId/file, POST /documents/:docId/reprocess (~250 lines)
  reviewQueue.ts        — GET /review-queue, POST /review-queue/:id/accept, POST /review-queue/:id/fix (~200 lines)
  reprocess.ts          — POST /reprocess-failed (~100 lines)
```

**Worker util split** — `serveIntakeExtract.ts` (1,272) → focused modules:

```
src/utils/serveIntake/
  extract/
    index.ts            — orchestration: calls per-family extractors, merges, arbitrates (~300 lines)
    informationForm.ts  — Information Form-specific prompt + parsing (~250 lines)
    fieldSheet.ts       — Field Sheet-specific prompt + parsing (~250 lines)
    courtDocket.ts      — Court Docket-specific prompt + parsing (~250 lines)
    merge.ts            — confidence-weighted merge + name-coherence guard (~150 lines)
  records/
    commit.ts           — commitIntake (was serveIntakeRecords.ts:1,359 → ~600 lines, split below)
    person.ts           — person create/link helpers (~200 lines)
    property.ts         — property create/link + address-class resolution (~200 lines)
    caseFile.ts         — case file auto-create + multi-defendant linking (~150 lines)
    call.ts             — CFS creation + briefing notation write (~200 lines)
```

`serveIntakeRecords.ts` (1,359 lines) splits into `records/` — each sub-module owns one entity type.

**React page split** — `ServeIntakePage.tsx` (2,062) → page shell + extracted components:

```
client/src/pages/serve-intake/
  ServeIntakePage.tsx   — page shell, tab state, top-level effects (~400 lines)
  UploadZone.tsx        — drag/drop, file picker, file list, snapshot logic (~400 lines)
  OcrReviewPanel.tsx    — field-edit grid, OCR badges, override state (~400 lines)
  DefendantSection.tsx  — defendants picker + detected list (~200 lines)
  QualitySection.tsx    — judge verdicts, yellow chips, review-queue badge (~200 lines)
  SuccessCard.tsx       — N-intake result display, missing-field strip (~300 lines)
  useIntakeState.ts     — all useState/useReducer extracted to a custom hook (~200 lines)
  useFileProcessing.ts  — handleFiles, extractPdfText, rasterizePdf, scanPdfOcr (~300 lines)
```

### 3.2 Shared package (fixes D-03)

Extract the hand-synced duplicates into a real shared module:

```
shared/serveIntake/
  defendants.ts          — parseDefendants + DetectedDefendant (was 2 × 78 lines)
  judge.ts               — FieldVerdict, JudgeResult types (was 2 × 9 lines)
  fields.ts              — TARGET_FIELDS, CRITICAL_FIELDS, field key maps (currently duplicated)
  documentTypes.ts       — DOCUMENT_TYPES list (currently duplicated between client/server)
  index.ts               — re-exports
```

**Import strategy:** Both `src/` and `client/src/` import from `../../shared/serveIntake/`. No npm package needed — the relative path works because both trees share the same repo root. Vite (client) and esbuild (Worker) both resolve TS via relative paths. The existing `tsconfig.json` `paths` mapping can add `"@serve-intake/*": ["../shared/serveIntake/*"]` for cleaner imports.

**Lockstep enforcement:** Delete the duplicate files (`src/utils/serveIntakeDefendants.ts`, `client/src/utils/serveIntakeDefendants.ts`, `client/src/types/serveIntakeJudge.ts`) and re-export from `shared/` during migration. A CI grep check (`scripts/check-serve-intake-dupes.sh`) fails if any of those old paths are recreated.

### 3.3 Registered-agent path as first-class flow (fixes D-05)

Today: `parseDefendants` skips business entities with a comment. The RA path is ad-hoc.

v2: Business defendants get a **parallel extraction + commit path**:

```
parseDefendants() → { individuals: DetectedDefendant[], businesses: DetectedDefendant[] }

if businesses.length > 0:
  RA extraction path:
    1. Extract registered_agent_name + registered_agent_address from packet
       (new TARGET_FIELDS in extraction prompt — already partially in §3.4 of OCR enhancement)
    2. Look up businesses row by name (findOrCreateBusiness — exists today)
    3. Resolve registered agent entity:
       - If RA name matches a person in persons table → link
       - Else create person stub with RA name + RA address
    4. Create serve_queue row with:
       - recipient_type = 'registered_agent'
       - recipient_name = RA name
       - recipient_address = RA address (NOT the business address — service is on the agent)
       - business_id = FK to businesses
       - case_file_id = same as individual defendants
    5. Briefing: SERVICE AUTHORITY section notes RA service per URCP 4(d)(1)(E)

UI:
  DefendantsPicker renders two sections:
    "Individuals to serve" (checkboxes, today's behavior)
    "Business entities (registered-agent service)" (checkboxes, new)
  Business entries show: entity name, RA name, RA address (if extracted)
  Operator can edit RA name/address before commit
```

**Schema:** `serve_queue.recipient_type` already exists (migration `0237_serve_queue_recipient_type.sql`). `serve_queue.business_id` already exists (migration `0132_serve_queue_business_id.sql`). `registered_agent_name` and `registered_agent_address` land in `parsed_data` JSON (no new columns — avoids schema churn per the OCR enhancement doc §6 risk note).

### 3.4 Memoization fix (fixes D-04)

`ServeIntakePage.tsx:519` — replace the `[files]` effect with a memoized derivation:

```ts
// Before (v1):
useEffect(() => {
  // ... compute bestDefendant from files ...
  const detected = parseDefendants(bestDefendant);
  setDetectedDefendants(detected);
  // ...
}, [files]);

// After (v2):
const bestDefendant = useMemo(() => {
  let best = '', bestConf = 0;
  for (const f of files) {
    const v = f.ocrResult?.fields?.defendant;
    if (v?.value && v.confidence > bestConf) { best = v.value; bestConf = v.confidence; }
  }
  return best;
}, [files]);

const detectedDefendants = useMemo(() => parseDefendants(bestDefendant), [bestDefendant]);

// Sync to state only when the parsed result actually changes
useEffect(() => {
  setSelectedDefendants(prev => {
    if (prev.length === 0 && detectedDefendants.length > 0) return detectedDefendants.map(d => d.name);
    return prev.filter(n => detectedDefendants.some(d => d.name === n));
  });
}, [detectedDefendants]);
```

`parseDefendants` runs once per unique `bestDefendant` value, not once per `files` mutation.

### 3.5 PR 3 + PR 4 (fixes D-06, D-07)

Ship the 28 approved-but-unimplemented items from the OCR enhancement doc:

**PR 3 (PDF render, 18 items):** per-run width measurement (D3 fix), entries 5–7, timeline table fix, N/A suppression, map page fixes, signature block compaction, continuation headers, widow/orphan control, gutter alignment, long-token breaking, LINKED INDIVIDUALS rendering, OCR CONTEXT prose rewrite, provenance line, uppercase emphasis verification.

**PR 4 (Serve Intake page UI, 10 items):** per-field confidence chip, per-field source badge, conflict resolver, "not found" vs "found and empty" distinction, inline attempt-plan preview, witness-fee checklist, address-class selector, client-instruction parse preview, per-document re-extraction, golden-fixture test harness.

### 3.6 Phase 2 groundwork (fixes D-08)

Pre-Serve Intelligence — cross-reference the extracted recipient against existing records at intake time:

```
After extraction, before commit:
  1. Warrant check (serveIntakeWarrantCheck.ts exists — wire it into the commit flow visibly)
  2. CAD incident cross-ref: has this address appeared in recent calls_for_service?
  3. BOLO check: is the recipient name on an active BOLO?
  4. Prior serves: has this person been served before? (link to existing serve_queue rows)
  5. Property lookup: known gated community, access notes, hazard flags

Output: enrich the judge verdicts with a "pre_serve_intel" section
  - each check returns { status: 'clear'|'hit'|'unknown', detail: string }
  - hits render as red chips in the review panel
  - the briefing gains Entry 1b: PRE-SERVE INTEL (between OFFICER SAFETY and INTAKE)
```

**No new tables** — uses existing `warrants`, `calls_for_service`, `comms_bolos`, `serve_queue`, `properties`. The intel section lands in `parsed_data._intake.pre_serve_intel` JSON.

### 3.7 Service worker staleness (fixes D-11)

The SW auto-stamps `CACHE_NAME` from the git SHA. The issue is the **Update prompt** — operators may dismiss it. v2 adds:

- `ServeIntakePage` (and all pages) show a non-dismissible toast when a new SW version is waiting: "A new version of the app is available. Reload to update." with a one-click reload button.
- The `sw.js` skipWaiting() on `message` from the page — the toast calls `navigator.serviceWorker.controller.postMessage({ type: 'SKIP_WAITING' })` then reloads.
- This is already partially in `sw.js:519` (the `fetchWithRetry` path). Wire the UI side.

---

## 4. Implementation Phases

Each phase is an independently reviewable, independently mergeable PR. No phase depends on a later phase. All phases must keep the four CI gates green (worker typecheck, worker vitest, client typecheck, client vitest).

### Phase A — Shared package + memoization (low-risk, high-value)

**PRs:**
1. **PR A1:** Create `shared/serveIntake/` with `defendants.ts`, `judge.ts`, `fields.ts`, `documentTypes.ts`. Update both `src/` and `client/src/` imports to point at `shared/`. Delete the duplicate files. Add `scripts/check-serve-intake-dupes.sh` CI guard. ~200 lines moved, ~50 lines new.
2. **PR A2:** Fix the `useEffect` memoization in `ServeIntakePage.tsx` (§3.4). ~30 lines changed.
3. **PR A3:** Add SW update-toast UI + `SKIP_WAITING` postMessage. ~80 lines new in `client/src/components/UpdateToast.tsx` + `sw.js` wiring.

**Risk:** Low. PR A1 is a pure import-path move. PR A2 is a hook refactor with existing tests as guard. PR A3 is additive UI.

### Phase B — Route + util decomposition (structural, no behavior change)

**PRs:**
4. **PR B1:** Split `src/routes/serveIntake.ts` (2,994) into `src/routes/serveIntake/` sub-files (§3.1). Pure move — no logic changes. The sub-app `index.ts` mounts at the same path. ~2,994 lines moved, ~80 lines new (mount boilerplate).
5. **PR B2:** Split `src/utils/serveIntakeExtract.ts` (1,272) into `src/utils/serveIntake/extract/` (§3.1). Pure move. ~1,272 lines moved.
6. **PR B3:** Split `src/utils/serveIntakeRecords.ts` (1,359) into `src/utils/serveIntake/records/` (§3.1). Pure move. ~1,359 lines moved.
7. **PR B4:** Split `client/src/pages/ServeIntakePage.tsx` (2,062) into `client/src/pages/serve-intake/` (§3.1). Extract `useIntakeState`, `useFileProcessing` hooks + sub-components. ~2,062 lines moved, ~100 lines new (prop wiring).

**Risk:** Medium. Large diffs but zero logic change. Each PR must pass all tests to prove no regression. Review by diffstat + test run, not line-by-line.

### Phase C — Registered-agent path (new feature)

**PRs:**
8. **PR C1:** Update `parseDefendants` (in `shared/serveIntake/defendants.ts`) to return `{ individuals, businesses }` instead of filtering businesses out. Update all call sites. ~100 lines changed.
9. **PR C2:** Add RA extraction fields to the extraction prompt (`registered_agent_name`, `registered_agent_address`). Update `serveIntake/extract/` modules. ~150 lines new.
10. **PR C3:** Add RA commit path in `serveIntake/records/commit.ts` — creates person stub + serve_queue row with `recipient_type='registered_agent'`. ~200 lines new.
11. **PR C4:** Update `DefendantsPicker` to render two sections (individuals + businesses). RA name/address editable. ~200 lines changed.
12. **PR C5:** Briefing SERVICE AUTHORITY section: RA service doctrine per URCP 4(d)(1)(E). ~100 lines changed in `serveIntakeBriefing.ts`.

**Risk:** Medium. New commit path, but gated: only fires when `businesses.length > 0`. Individual path unchanged. Tests: new fixtures for RA packets.

### Phase D — PR 3 + PR 4 (PDF render + page UI)

**PRs:**
13. **PR D1:** PDF render fixes — per-run width measurement (D3), timeline table, N/A suppression, map page collisions, signature block, continuation headers, widow/orphan, gutter alignment, long-token breaking. 18 items from OCR enhancement doc PR 3. ~800 lines changed in `servePdfGenerator.ts` + `recordPdfGenerator.ts`.
14. **PR D2:** Serve Intake page UI — per-field confidence chips, source badges, conflict resolver, "not found" distinction, attempt-plan preview, witness-fee checklist, address-class selector, client-instruction parse preview, per-document re-extraction. 10 items from OCR enhancement doc PR 4. ~1,200 lines changed across `serve-intake/` components.
15. **PR D3:** Golden-fixture test harness — 10 practice packets with checked-in expected field set. ~400 lines new in `tests/fixtures/serve-intake/`.

**Risk:** Medium-high. D1 touches the PDF generator (3,030 lines) — high blast radius. D2 is additive UI. D3 is test-only.

### Phase E — Phase 2 Pre-Serve Intelligence (new feature)

**PRs:**
16. **PR E1:** Wire `serveIntakeWarrantCheck.ts` (exists, 137 lines) into the commit flow visibly — warrant hits render in the review panel + briefing. ~200 lines changed.
17. **PR E2:** CAD incident cross-ref — query `calls_for_service` for the recipient address, last 90 days. ~150 lines new in `serveIntake/records/` + route.
18. **PR E3:** BOLO check — query `comms_bolos` active for recipient name. ~100 lines new.
19. **PR E4:** Prior serves lookup — query `serve_queue` for recipient person_id. ~100 lines new.
20. **PR E5:** Property hazard lookup — query `properties` for gated/hazard flags. ~100 lines new.
21. **PR E6:** Briefing Entry 1b: PRE-SERVE INTEL. ~150 lines changed in `serveIntakeBriefing.ts`.

**Risk:** Low-medium. All read-only queries against existing tables. No schema changes. Each check fails closed (unknown → no chip, no briefing entry).

---

## 5. Schema Changes

**Phase A–E require exactly ONE new migration:**

```sql
-- 0257_serve_intake_v2.sql
-- Serve Intake v2: registered-agent path + pre-serve intel groundwork.
-- No new tables — all new data lands in existing parsed_data JSON or
-- existing columns (recipient_type, business_id already exist).

-- serve_queue: index for pre-serve intel lookups (recipient_person_id
-- cross-ref to find prior serves). Column already exists; this is just
-- a perf index that the Phase E prior-serves query needs.
CREATE INDEX IF NOT EXISTS idx_serve_queue_recipient_person
  ON serve_queue(recipient_person_id) WHERE recipient_person_id IS NOT NULL;

-- serve_queue: index for business-id lookups (RA path).
CREATE INDEX IF NOT EXISTS idx_serve_queue_business
  ON serve_queue(business_id) WHERE business_id IS NOT NULL;

-- serve_intake_judge_runs: add pre_serve_intel JSON column for audit.
-- serve_intake_judge_runs is 21 lines, well under the 100-col cap.
ALTER TABLE serve_intake_judge_runs ADD COLUMN pre_serve_intel TEXT;
```

**After merge:** apply via `scripts/apply-migration.sh 0257_serve_intake_v2.sql` (per CLAUDE.md — deploy is `continue-on-error`, so apply directly to live D1 `785de7ae`).

All other v2 data (RA name/address, address-class confirmation, pre-serve intel results) lives in `serve_queue.parsed_data` JSON — no schema churn, per the OCR enhancement doc §6 risk note.

---

## 6. Testing Strategy

### 6.1 Per-PR gates

Every PR in every phase must pass:
- `npm run typecheck` (Worker)
- `npx vitest run` (Worker tests)
- `cd client && npx tsc --noEmit` (client typecheck)
- `cd client && npx vitest run` (client tests)

Per CLAUDE.md: baseline is clean across all four gates. Any red is caused by the PR.

### 6.2 Phase-specific tests

| Phase | New tests |
|-------|-----------|
| A | `shared/serveIntake/__tests__/defendants.test.ts` (moved, not new); `check-serve-intake-dupes.sh` CI guard; memoization test for `useFileProcessing` hook |
| B | No new tests — existing tests must pass unchanged (proves pure-move) |
| C | RA extraction fixtures (3 packets: LLC, Inc., Corp); RA commit test (person stub + serve_queue with `recipient_type='registered_agent'`); `DefendantsPicker` two-section render test; briefing RA doctrine test |
| D | Golden-fixture harness (10 packets, field-level assertions); PDF right-margin overflow render test (D3); per-field confidence chip render test; conflict resolver test |
| E | Warrant-hit briefing test; CAD cross-ref test (mock `calls_for_service`); BOLO hit test; prior-serves test; property hazard test; pre-serve intel aggregation test |

### 6.3 Integration tests

The existing `tests/serveIntakeUploadJudge.integration.test.ts` (41 lines) is the spine. Extend it:

- **Phase C:** add a multi-defendant packet with one individual + one LLC → assert 2 serve_queue rows, one with `recipient_type='registered_agent'`, both linked to same `case_file_id`.
- **Phase E:** add a packet where the recipient has an active warrant → assert `quality_status='needs_review'` and briefing Entry 1b present.

---

## 7. Rollout & Risk

### 7.1 Rollout order

Phases are **independently mergeable** but have a recommended order:

```
A (shared + memo)  →  B (decomposition)  →  C (RA path)
                                             ↓
                                       D (PDF + UI)  →  E (Phase 2 intel)
```

- A first: unblocks shared-code imports for all later phases.
- B second: reduces blast-radius for C/D/E by making files smaller.
- C and D can proceed in parallel (different files: C touches extraction/commit, D touches PDF/UI).
- E last: builds on the stabilized C/D output (intel needs the RA path to also be checked).

### 7.2 Risk matrix

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| PR B large diffs hide a behavior change | Medium | High | Each B PR is pure-move; CI gates + existing tests catch regressions; review by diffstat + test run |
| RA commit path creates duplicate persons | Medium | Medium | `findOrCreatePerson` by name+DOB; test with RA that matches existing person |
| PDF render changes break existing reports | Medium | High | D1 PR includes before/after PDF snapshot tests; golden-fixture harness (D3) gates |
| Shared package import path breaks Vite/esbuild build | Low | High | PR A1 verified by `cd client && npm run build` + `wrangler deploy --dry-run` before merge |
| Phase E queries add latency to intake | Low | Low | All queries are indexed lookups; fail-closed (timeout → unknown, no chip) |
| SW update toast annoys operators | Low | Low | Only shows when a new SW is actually waiting; dismissible after first interaction |

### 7.3 Non-goals (explicitly out of scope for v2)

- **New extraction models.** The incumbent `llama-3.3-70b` stays. Scout was A/B-rejected. Moondream deferred.
- **Phase 3 (Field Workflow).** Voice dictation, on-scene ID-OCR, mobile attempt-first flow — separate future spec.
- **Phase 4 (Throughput).** Bulk client-portal intake, marketplace — separate future spec.
- **Replacing the extraction pipeline.** Claude → OpenAI → Workers AI fallback stays.
- **TOTP/WebAuthn.** VPS-era features, not ported, not in scope.
- **UI theme changes.** Blue & Silver theme stays; new components use existing tokens.

---

## 8. Success Metrics

Measurable after each phase lands:

| Phase | Metric | Target |
|-------|--------|--------|
| A | Duplicate files between `src/` and `client/src/` for serve intake | 0 (CI-enforced) |
| A | `parseDefendants` calls per intake session | 1 (was 3+) |
| B | Largest serve-intake source file | < 700 lines (was 2,994) |
| B | Largest serve-intake client file | < 500 lines (was 2,062) |
| C | Business-entity defendants committed via RA path | > 0/week (was 0 — all silently dropped) |
| D | PDF right-margin overflow incidents | 0 (D3 fix) |
| D | Golden-fixture extraction pass rate | ≥ 95% (10 packets, field-level) |
| E | Intakes with pre-serve intel section in briefing | 100% (every intake runs all checks) |
| E | Warrant hits caught at intake (not discovered in field) | measurable from `serve_intake_judge_runs.pre_serve_intel` |

---

## 9. References

- [src/routes/serveIntake.ts](../../src/routes/serveIntake.ts) — v1 megafile to be split (Phase B)
- [client/src/pages/ServeIntakePage.tsx](../../client/src/pages/ServeIntakePage.tsx) — v1 megafile to be split (Phase B)
- [src/utils/serveIntakeExtract.ts](../../src/utils/serveIntakeExtract.ts) — extraction to be split (Phase B)
- [src/utils/serveIntakeRecords.ts](../../src/utils/serveIntakeRecords.ts) — records to be split (Phase B)
- [shared/serveIntake/](../../shared/serveIntake/) — new shared package (Phase A)
- `2026-06-22-serve-intake-quality-gate-design.md` — Phase 1 (shipped, incorporated)
- `2026-07-26-serve-intake-ocr-enhancement-design.md` — PRs 1–2 shipped, PRs 3–4 = Phase D
- Migrations: `0030`, `0034`, `0132` (business_id), `0152` (judge), `0237` (recipient_type), `0257` (v2)
- CLAUDE.md sections: D1 100-column cap, D1 100-bound-parameter cap, service worker auto-stamp, deploy.yml continue-on-error, four CI gates
