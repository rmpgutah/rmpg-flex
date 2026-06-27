# Serve Intake — Quality Gate (Phase 1 of advanced-functionality roadmap)

**Status:** approved (brainstorming complete, awaiting writing-plans handoff)
**Author:** Claude (Opus 4.7) with operator confirmation
**Date:** 2026-06-22
**Sequel to:** PRs #1386 (pre-submission review panel), #1411 (OCR pre-fill), #1584 (auto-Case-File mig 0146)
**Phase scope:** 1 of 4 (Quality Gate; Phases 2–4 are Pre-Serve Intelligence, Field Workflow, Throughput)

## Problem statement

Serve Intake currently extracts structured fields from a packet via Claude (primary) and Workers AI (fallback), then merges per-doc results with a confidence-weighted picker plus a name-coherence guard. **Two real failures persist:**

1. **No grounded verification of the merged result.** Confidence is whatever the model self-reports; a hallucinated value with `confidence: 0.95` survives the merge and lands in `serve_queue` indistinguishable from a correctly-extracted one. The operator's recourse is to spot it manually in the review panel — a hard job at the end of a long shift.
2. **Multi-defendant packets only produce one serve job.** The extraction prompt explicitly handles "multiple defendants" by stuffing them into the `defendant` field (see [src/utils/serveIntakeExtract.ts:147](../../../src/utils/serveIntakeExtract.ts:147)), but the commit step takes only the primary recipient. A packet naming three defendants becomes one job; the other two are typed in by hand.

The screenshot that triggered this design showed exactly failure mode (1): a 7.5 MB Court Docket failed extraction, the Field Sheet + Information Form extracted at 90%, but the recipient first/last name fields stayed empty. The operator had to type them in despite paying for OCR.

## Goals

- **Catch unsupported field values.** Every committed `serve_queue` row should either have a value supported by the raw text of at least one source document, or be flagged for supervisor review.
- **Fan out multi-defendant packets.** A packet naming N defendants should be capable of creating N serve jobs in one click, all linked to a single case file.
- **Persist auditable judge verdicts.** Every intake gets a `serve_intake_judge_runs` row with model id, latency, raw response, and per-field verdict so a future supervisor (or a future incident review) can answer "why did the system trust this value?"
- **Zero blast-radius for the existing flow.** Single-defendant packets where the judge says everything's clean must look identical to today (no extra clicks, no extra latency past the inline judge call).

## Non-goals (Phase 1)

- Replacing the existing extraction pipeline. Claude-primary / Workers-AI-fallback stays as-is. The judge is a new layer on top.
- Cross-referencing against CAD incidents, BOLOs, warrants. That's Phase 2 (Pre-Serve Intelligence).
- Court calendar / hearing-date pulls. Phase 2.
- Voice dictation, on-scene tooling, ID-OCR. Phase 3.
- Bulk client-portal intake, marketplace. Phase 4.
- LLM-judge for fields the operator manually overrode in the review panel. Operator override is sacred; we suppress the judge on those.

## Architecture

```
                          [ /api/serve-intake/upload ]
                                      │
                ┌─────────────────────┼──────────────────────┐
                │                     │                      │
        per-doc extract       merge + name-coherence    NEW: judgeMerged()
        (existing)            guard (existing)          ┌────────────────────┐
                │                     │                 │ heuristic check    │
                │                     │                 │ ↓ if any flagged   │
                │                     │                 │ Claude judge       │
                │                     │                 │ ↓ on Claude fail   │
                │                     │                 │ Workers AI judge   │
                │                     │                 │ ↓ on both fail     │
                │                     │                 │ heuristic-only     │
                │                     │                 └────────────────────┘
                │                     │                      │
                └─────────────────────┴──────────────────────┘
                                      │
                       NEW: parseDefendants() (server-side defensive parse)
                                      │
                              response shape grows:
                              { fields, ...,
                                judge_verdicts: { <field>: FieldVerdict },
                                quality_status: 'clean' | 'needs_review',
                                judge_run_id: 17 }
                                      │
                                      ▼
                         [ ServeIntakePage review panel ]
                         + NEW "Defendants detected" picker (rendered client-side
                           from per-file /scan-document results — no extra round trip)
                         + yellow chips on judge-flagged fields (rendered from response)
                                      │
                            operator picks + clicks Create
                                      │
                                      ▼
                       commitIntake (EXTENDED)
                       loops over checked defendants → N intakes
                       quality_status persists on each serve_queue row
                       judge_run_id FK back to audit table
```

### Components

**`src/utils/serveIntakeJudge.ts` — NEW (server-only)**

```ts
export interface FieldVerdict {
  ok: boolean;                     // true = field value is supported by at least one raw_text
  reason: string | null;           // brief why-not (max 120 chars), null when ok
  suggested_value: string | null;  // judge's alternative; null when no better candidate
  judge_confidence: number;        // 0..1, judge's certainty in its own verdict
  source: 'heuristic' | 'claude' | 'workers_ai';
}

export interface JudgeResult {
  verdicts: Record<string, FieldVerdict>;
  model: string;                   // 'claude:claude-haiku-4-5-20251001' | '@cf/meta/llama-3.3-70b-instruct-fp8-fast' | 'heuristic-only'
  ms: number;
  raw_response: string;            // truncated to 8 KB
  flagged_field_count: number;
  overall_status: 'clean' | 'needs_review' | 'error';
  fallback_chain: ('heuristic' | 'claude' | 'workers_ai')[];
}

export async function judgeMerged(
  env: Env['Bindings'],
  fields: Record<string, ExtractedField>,
  rawTexts: { name: string; text: string }[],
  docTypes: string[],
): Promise<JudgeResult>
```

The judge runs in two stages internally:

1. **Heuristic checker (always runs)** — pure function over `fields` + `rawTexts`. Catches the highest-value failures cheaply:
   - `recipient_first_name` + `recipient_last_name` must each appear (case-insensitive substring) in at least one `text`.
   - `recipient_address` must include a token from at least one `text`.
   - `recipient_state` must be a real US state code; `recipient_zip` must be 5 or 9 digits; `recipient_dob` ISO-shaped and within 1900..today.
   - `recipient_city` must be consistent with `recipient_state` (per a small embedded city→state map, fallback: pass on unknown).
   - Each failing check produces a `FieldVerdict` with `ok: false`, `source: 'heuristic'`, `judge_confidence: 0.9`, and `reason` from a fixed catalog ("name not in any source text", "zip is not 5/9 digits", etc.).

2. **LLM judge (only when heuristic flagged something OR confidence is suspicious)** — Claude-primary, Workers-AI-fallback. Same `AI_TIMEOUT_MS=35_000` budget the existing extractors use. The LLM gets the merged `fields`, the doc types, and the truncated raw texts; it returns a `Record<field, FieldVerdict>`. The LLM verdict can DOWNGRADE a `clean` field to `flagged`, but **cannot UPGRADE a heuristic-flagged field to clean** — the heuristic check is the floor. (Rationale: if `recipient_first_name='John'` does not appear in any raw text, no amount of model self-confidence makes it real.)

`fallback_chain` records which stages ran (e.g., `['heuristic', 'claude']` for the happy path, `['heuristic', 'claude', 'workers_ai']` when Claude errored, `['heuristic']` when both LLM stages failed).

**`src/utils/serveIntakeDefendants.ts` — NEW (shared client + server)**

```ts
export interface DetectedDefendant {
  name: string;
  raw_source: string;       // the substring it was parsed from, for audit
  split_confidence: number; // 1.0 ';' split | 0.8 ' and '/`&` | 0.6 comma-of-3+ | 0.5 newline
  is_business: boolean;     // LLC / Inc / Corp / Co. / LLP / Trust / Estate of
}

export function parseDefendants(defendantField: string | undefined): DetectedDefendant[]
```

Pure deterministic function. Lives in a small util that both the client (for the picker) and the server (for the defensive re-parse) import. Splits by precedence:

1. `;` → split, `confidence: 1.0` per piece.
2. ` and ` (with word boundaries) or ` & ` → `0.8`.
3. Comma split when ≥3 name-shaped tokens (avoid `Smith, John` false-splits) → `0.6`. A "name-shaped token" is a non-empty piece (after trim) whose first character is uppercase, contains at least one space (i.e., is two or more words), and does NOT match a business-suffix regex. This intentionally rejects single-word fragments (`'John'`), surname-first patterns (`'Smith'`), and bare suffixes (`'LLC'`).
4. Newline → `0.5`.

After splitting, trim each piece, strip `et al.` and leading party markers (`"Defendant 1: "`, `"D1) "`), detect business markers, and emit. Empty / single-token / fragment-only pieces are dropped.

**Behavior on edge cases:**
- 0 detected → empty array; UI shows no picker; current single-recipient flow runs.
- 1 detected → array of one; UI hides the picker; commit treats it as the primary recipient.
- N detected, all `is_business=true` → empty array returned (registered-agent service is a different workflow handled elsewhere; not in scope here).
- N detected mixed business + individual → array contains only the non-business entries.

**`src/utils/serveIntakeRecords.ts` — EXTENDED (`commitIntake`)**

`commitIntake` gains two optional parameters:

- `defendants_selected: string[] | null` — names the operator checked in the picker. When non-null, the function loops over this list and creates one full intake (person + property + call + serve_queue + case_person_link) per defendant. When `null`, the existing single-recipient code path runs unchanged.
- `judge_run_id: number | null` — FK into `serve_intake_judge_runs`. Stored on every queue row created during the loop.

All N intakes share the same `case_file_id` (existing mig 0146 auto-creates one per intake batch) so they appear as a single case in `/cases`.

### Schema

New migration `migrations/0152_serve_intake_judge.sql`:

```sql
-- 0152_serve_intake_judge.sql
-- Quality-Gate Phase 1: judge audit + per-row quality flag.

CREATE TABLE IF NOT EXISTS serve_intake_judge_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  model TEXT NOT NULL,                -- 'claude:…' | '@cf/meta/…' | 'heuristic-only'
  ms INTEGER NOT NULL,
  raw_response TEXT,                  -- truncated to 8 KB
  flagged_field_count INTEGER NOT NULL DEFAULT 0,
  overall_status TEXT NOT NULL,       -- 'clean' | 'needs_review' | 'error'
  fallback_chain TEXT NOT NULL,       -- JSON array, e.g. '["heuristic","claude"]'
  upload_user_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_judge_runs_created
  ON serve_intake_judge_runs(created_at DESC);

-- serve_queue: per-row quality flag. Default 'clean' so existing rows look healthy.
ALTER TABLE serve_queue ADD COLUMN quality_status TEXT NOT NULL DEFAULT 'clean';
ALTER TABLE serve_queue ADD COLUMN judge_run_id INTEGER REFERENCES serve_intake_judge_runs(id);
ALTER TABLE serve_queue ADD COLUMN quality_reviewed_by INTEGER;
ALTER TABLE serve_queue ADD COLUMN quality_reviewed_at TEXT;
```

`quality_status` values and lifecycle:

| Value | Meaning | Set by |
|---|---|---|
| `'clean'` | Default; judge ran cleanly + nothing flagged | `commitIntake` when `JudgeResult.overall_status === 'clean'` |
| `'needs_review'` | Judge flagged at least one field, OR judge errored entirely (conservative — flag when uncertain) | `commitIntake` when `JudgeResult.overall_status === 'needs_review' \|\| 'error'` |
| `'reviewed_ok'` | A supervisor reviewed the flagged intake and accepted the extracted values | Supervisor action via `POST /review-queue/:id/accept` (added in this PR) |
| `'reviewed_fixed'` | A supervisor reviewed, edited at least one field, and re-saved | Supervisor action via `PUT /:id` (existing) + flag bump via `POST /review-queue/:id/fix` |

The supervisor review queue (existing `GET /review-queue`) gains a new filter for `quality_status='needs_review'`.

Runtime reconciler in the existing pattern (mirror [`reconcileScheduleSchema`](../../../src/routes/serveIntake.ts:74)) — `serve_queue.quality_status` and friends gated by `columnExists()`. Required because [`deploy.yml`](../../../.github/workflows/deploy.yml)'s migration apply is `continue-on-error: true`.

### Data flow

```
1. drag/drop or pick → handleFiles → per-file POST /scan-document (existing)
2. CLIENT parseDefendants(scanResults.merged.defendant?.value)
3. Review panel renders existing field-edit grid + NEW "Defendants detected" picker
   (only when array length > 1; hidden when 0 or 1)
4. Operator deselects unwanted defendants + clicks Create
5. POST /api/serve-intake/upload with files + field_overrides + defendants_selected[] + client_id
6. Server: parallel OCR (existing) → merge + name-coherence (existing) → normalizeFields (existing)
7. Server: judgeMerged(env, normalizedFields, raw_texts, doc_types)
   - heuristic stage always runs
   - LLM judge runs only when heuristic flagged something OR self-reported conf < 0.7 on a key field
   - operator-overridden fields (confidence 1.0 from field_overrides) skipped entirely
8. Server: parseDefendants on the operator's submitted names (defensive — could be a tampered submit)
9. Server: persist serve_intake_judge_runs row (returns judge_run_id)
10. Server: commitIntake(..., defendants_selected, judge_run_id)
    - loops over defendants_selected
    - each loop creates person + property + call + serve_queue + case_person_link
    - each serve_queue row carries quality_status from judgeResult.overall_status
11. Response: { success, intakes: [{call_id, person_id, queue_id}, ...],
                judge_verdicts, quality_status, judge_run_id }
12. Client success card: renders N intakes; per-field yellow chips for flagged values
```

### Error handling

| Failure | Server behavior | Client experience |
|---|---|---|
| Claude no key / no credits / 503 | Workers AI judge runs; model id reflects fallback | No change visible |
| Claude + Workers AI both error or timeout | Heuristic-only judge; `fallback_chain = ['heuristic']` | No change visible |
| Heuristic itself crashes (should not happen — pure function with try/catch) | `verdicts={}`, `overall_status='error'`; audit row marked `error`; intake still commits | Success card shows no flags; supervisor still sees a row in review queue thanks to `error`-tier handling |
| Operator overrode a field via `field_overrides` | Judge verdict on that field is dropped before persisting | No flag on the field |
| Judge says `ok=false` but value DOES appear in raw text (heuristic conflict) | Heuristic wins; verdict not persisted as flagged; audit row notes `overridden_by_heuristic` | No flag on the field |
| `parseDefendants` (server) returns array of 0 or 1, but client sent N | Trust client picks (the client already filtered businesses); commit N intakes | No change |
| Operator picks 0 defendants | 400 with `{error:'Pick at least one defendant to serve'}` | Toast surfaces server message |
| Judge total wall-time exceeds `AI_TIMEOUT_MS` (35 s) | Race against the timeout; on timeout `fallback_chain` records `['heuristic', 'claude:timeout']` and we use whatever the heuristic produced | No change visible |

### Testing

**Unit, `parseDefendants`** — 15+ cases:
- `;` split: `'John Smith; Jane Doe'` → 2 entries, conf 1.0 each.
- ` and ` split: `'John Smith and Jane Doe'` → 2 entries, conf 0.8 each.
- Comma 3+: `'John Smith, Jane Doe, Bob Roe'` → 3 entries, conf 0.6 each.
- Comma 2 (`'Smith, John'` — surname-first): treated as a SINGLE entry. (Heuristic: ≥3 tokens to split on commas.)
- Newline: `'John Smith\nJane Doe'` → 2 entries, conf 0.5 each.
- LLC marker: `'Acme LLC and John Smith'` → 1 individual entry (Acme LLC filtered).
- `et al.` strip: `'John Smith et al.'` → 1 entry.
- `'Defendant 1: John Smith; Defendant 2: Jane Doe'` → 2 entries, labels stripped.
- Empty input, undefined, single-character, all-whitespace → empty array.
- All-business: `'Acme LLC; Beta Corp'` → empty array.

**Unit, `judgeMerged`** — with mocked Env:
- Claude returns valid JSON verdicts → result reflects them; `fallback_chain=['heuristic','claude']`.
- Claude throws → Workers AI runs; chain `['heuristic','claude','workers_ai']`.
- Both LLM stages throw → heuristic-only result; chain `['heuristic']`.
- Operator override: a field present in `field_overrides` map (mocked) → judge skips it; no verdict in result.
- Heuristic conflict: judge says `ok=false` but name IS in raw text → field not flagged.

**Unit, heuristic checker** — direct invocation, 10+ cases:
- Name present in `text[0]` → `ok=true`.
- Name absent in all raw texts → `ok=false`, reason `'name not found in any source document'`.
- Zip 5-digit → ok; 4-digit → flagged; 'ABCDE' → flagged.
- State 'XX' → flagged; 'UT' → ok.
- DOB '2050-01-01' → flagged (future); '1985-03-15' → ok.
- City-state map: `('West Jordan','UT')` → ok; `('West Jordan','CA')` → flagged.

**Unit, `commitIntake` with `defendants_selected`** — with sqlite-in-memory:
- `defendants_selected=null` → existing single-intake behavior (regression guard).
- 1 entry → 1 person, 1 property, 1 call, 1 serve_queue, 1 case_person_link; all linked to the same `case_file_id`.
- 3 entries → 3 of each; `case_file_id` consistent across all rows.
- Each row's `quality_status` matches the passed `judgeResult.overall_status`.
- Each row's `judge_run_id` matches the passed value.

**Integration**, `POST /api/serve-intake/upload`, 3 binary fixtures:
- single-defendant packet → 1 intake committed, picker not shown in response shape (`defendants_detected.length === 1` triggers client-side hide).
- ' and '-multi packet → 2 intakes committed when operator picks both.
- ';'-multi packet → 3 intakes committed when operator picks all three.
- judge mock returns `flagged_field_count=2` → response `quality_status='needs_review'`; both queue rows show that.
- judge mock throws → response `quality_status` reflects heuristic-only result; deploy still 200.

**Fixtures**, `tests/fixtures/serve-intake/`:
- `packet-single.json` (synthetic field map, one recipient)
- `packet-and-multi.json` (two recipients, ' and ' separator)
- `packet-semi-multi.json` (three recipients, ';' separator)

PDFs are not strictly required for the integration tests: the existing `/upload` handler reads a `client_text` form-field with a JSON array of `{name, type, text}` per file ([src/routes/serveIntake.ts:369-378](../../../src/routes/serveIntake.ts:369)). A test can post a multipart body with stub `application/pdf` Blobs (zero bytes ignored by the size guard if we set `size > 0` via a 1-byte content) and a populated `client_text` payload, so the merge + judge stages exercise without depending on the OCR container or Workers AI. For full end-to-end coverage including OCR, separate fixture PDFs would be required — out of scope for Phase 1.

## Rollout

- New migration `0152` applies in deploy.yml's continue-on-error step; runtime reconciler self-heals the column adds.
- Existing single-defendant flow is unchanged in behavior — no migration is destructive, no default changes.
- Multi-defendant picker rendered only when `defendants_detected.length > 1`, so today's UX is identical for single-recipient packets.
- Judge runs synchronously inside `/upload`; expected latency added is 0 ms when heuristic clean (no LLM call) or 8–15 s when LLM judge runs. The existing parallel doc extraction dominates total wall time on multi-doc packets; judge latency is amortized.

## Success metrics

Measurable from existing tables once the migration lands:

- **Recall (catch bad extractions)**: count of `serve_queue` rows where `quality_status='needs_review'` — expect ~5–15% of intakes per week based on the historical empty-recipient + low-confidence rate.
- **Multi-defendant fan-out**: count of `case_files` with >1 linked `serve_queue` rows in the first month. Today: 0 (operator types every subsequent defendant manually).
- **Operator time saved**: indirect, derivable from a before/after audit of `audit_log` entries on `serve_queue` UPDATEs (today's manual recipient typing shows up as field edits).

## Open questions deferred to writing-plans

- Exact judge prompt wording. Belongs in the implementation plan; the design only requires that the response shape conform to `Record<field, FieldVerdict>`.
- Threshold tuning for "self-confidence considered suspicious" (currently 0.7 in this spec). Plan stage can A/B against the heuristic baseline.
- UI styling of the yellow-chip flags. Frontend-design altitude, not architecture.
- Multi-tenant rate limiting on the LLM judge. Out of scope for Phase 1 (single-tenant deployment today).

## References

- [src/routes/serveIntake.ts](../../../src/routes/serveIntake.ts) — existing /upload, /scan-document, /review-queue
- [src/utils/serveIntakeExtract.ts](../../../src/utils/serveIntakeExtract.ts) — Claude + Workers AI extractors, ExtractionResult shape, TARGET_FIELDS
- [src/utils/serveIntakeRecords.ts](../../../src/utils/serveIntakeRecords.ts) — commitIntake
- [client/src/pages/ServeIntakePage.tsx](../../../client/src/pages/ServeIntakePage.tsx) — review panel, handleFiles, processIntake
- Migrations: `0146_case_auto_intake.sql` (case file auto-create), `0140_serve_attempt_schema.sql` (related schema reconciler)
- Memory: `project-case-management-overhaul`, `feedback-503-not-configured-anti-pattern`
