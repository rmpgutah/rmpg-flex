# Intel v2 — Wave 1: Intelligence Development Cycle

**Date:** 2026-06-13
**Status:** Approved (design) — pending spec review
**Author:** Claude (brainstormed with C. Zamora)
**Program:** Intel v2 (4-wave upgrade). This is **Wave 1 of 4**.

---

## 0. Program context

The user requested a "massive system upgrade" to Intel Search and development. The
existing intel stack is already deep (PRs #1164/#1168/#1169/#1170/#1171/#1173):
FTS5 federated search, person entity resolution, dossiers + PDF, derived graph
edges, watchlists, auto-screening, narrative link mining, plate log, jail ingest,
in-app recording, gang intel.

The request decomposes into **four subsystems** built as a wave program:

1. **Wave 1 — Intelligence Development Cycle** ← *this spec*. The genuinely-missing
   tradecraft layer: raw tips → evaluated → graded → sanitized → disseminated
   intelligence *products*, with source/CI management, dissemination controls, and
   28 CFR Part 23-style retention.
2. **Wave 2 — Unified Intel Workbench** (later). Palantir-style workspace: link-graph
   canvas, entity timeline, saved investigation cases. *Consumes* Wave 1's products.
3. **Wave 3 — AI Analysis Engine** (later). Workers AI entity/relationship extraction,
   RAG Q&A, narrative summarization, threat scoring. *Drafts* Wave 1's products.
4. **Wave 4 — Collection Sources** (later). OSINT/court/ALPR/enrichment feeds.

**Why Wave 1 first:** the Workbench and AI engine both *consume* a graded,
sanitized "intelligence product" entity that does not yet exist. Building the
foundation first means Waves 2–3 render real entities with zero rework.

---

## 1. Core concept: the intelligence product is a new, two-bodied entity

Real intel tradecraft separates:

- the **raw report** — who said it, source identity, unsanitized — RESTRICTED, and
- the **sanitized product** — what gets disseminated, source protected.

The existing schema stores one text body per record and cannot express this split.
Wave 1's core table `intel_reports` carries **both** `raw_narrative` (restricted)
and `sanitized_narrative` (disseminable). This split is what makes the whole
compliance/dissemination story possible.

---

## 2. The cycle as an explicit state machine

```
  SUBMITTED ──▶ UNDER_EVALUATION ──▶ GRADED ──▶ ANALYZED ──▶ DISSEMINATED ──▶ ARCHIVED
   (officer)      (supervisor+)    (5×5×5    (sanitized   (→ inbox/PDF/      │
       │               │            grade)    narrative+    share + audit)    │
       │               │                       links)            │            ▼
       └──▶ REJECTED ◀─┘                                         └──▶ RECALLED  PURGED
            (no criminal predicate)                            (correction)  (retention)
```

**States:** `submitted`, `under_evaluation`, `graded`, `analyzed`, `disseminated`,
`recalled`, `archived`, `purged`, `rejected`.

Transitions are gated by **role** AND **completeness**. The completeness rules live
in a single pure function `canTransition(report, toStatus, role)` (see §5) — encoding
the cycle as a guarded state machine means rules like "disseminate requires a
sanitized narrative + handling code + grade + criminal predicate" are enforced in
code, not by convention.

### Intended transition rules (authoritative; `canTransition` implements these)

| From | To | Role | Required before transition |
|------|----|------|----------------------------|
| submitted | under_evaluation | supervisor+ | — (takes ownership) |
| submitted / under_evaluation | rejected | supervisor+ | `rejected_reason` non-empty |
| under_evaluation | graded | supervisor+ | `source_reliability` (A–F) + `info_credibility` (1–6) + `handling_code` all set |
| graded | analyzed | supervisor+ | `sanitized_narrative` + `assessment` + `criminal_predicate` all non-empty |
| analyzed | disseminated | supervisor+ | grade set + `sanitized_narrative` + `handling_code` + `criminal_predicate` |
| disseminated | recalled | supervisor+ | `recalled_reason` non-empty |
| disseminated / recalled | archived | supervisor+ or retention cron | — |
| archived (review_date passed) | purged | supervisor+ | retention approval; scrubs narratives, keeps tombstone |

Officers (operational role) may **submit** and edit their own `submitted` report.
All evaluation/grading/analysis/dissemination is supervisor+.

---

## 3. Grading model — Admiralty 5×5×5

Each graded report carries three coded values:

### Source reliability (A–F)
- **A** Reliable — no doubt of authenticity/competence; history of complete reliability
- **B** Usually reliable — minor doubt; valid in most instances
- **C** Fairly reliable — doubt; has provided valid info in the past
- **D** Not usually reliable — significant doubt; has occasionally been valid
- **E** Unreliable — history of invalid information
- **F** Cannot be judged — insufficient basis to evaluate

### Information credibility (1–6)
- **1** Confirmed — corroborated by independent sources; logical; consistent
- **2** Probably true — not confirmed; logical; consistent with other info
- **3** Possibly true — not confirmed; reasonably logical; agrees with some info
- **4** Doubtful — not confirmed; possible but not logical; no corroboration
- **5** Improbable — not confirmed; not logical; contradicted by other info
- **6** Cannot be judged — validity cannot be determined

### Handling code (dissemination control — the third "5")
- **H1** Disseminate within RMPG (originating organization). *Default.*
- **H2** Disseminate to other law-enforcement agencies, need-to-know.
- **H3** Disseminate to non-LE partners / contract clients, sanitized, need-to-know.
- **H4** Disseminate with conditions; receiving unit must refer to originator before
  further dissemination.
- **H5** No further dissemination; originator authorization required for any release.

External share (§6) requires `handling_code` ∈ {H2, H3} (or H4 with originator
override). H1 = internal only; H5 = no external share.

---

## 4. Data model — migration `0104_intel_development.sql`

Idempotent DDL (`CREATE TABLE IF NOT EXISTS`). **Applied directly to live D1
(`785de7ae`) after merge** — deploy-time migration apply is `continue-on-error`.

### 4.1 `intel_reports`
```
id                  INTEGER PK AUTOINCREMENT
report_number       TEXT UNIQUE          -- 'INT-2026-0001'
title               TEXT NOT NULL
status              TEXT NOT NULL DEFAULT 'submitted'   -- state machine §2
source_id           INTEGER              -- FK intel_sources, NULLABLE
source_type         TEXT                 -- denormalized for filtering
source_reliability  TEXT                 -- 'A'..'F', NULL until graded
info_credibility    INTEGER              -- 1..6, NULL until graded
handling_code       TEXT                 -- 'H1'..'H5', NULL until graded
raw_narrative       TEXT                 -- RESTRICTED (source-identifying)
sanitized_narrative TEXT                 -- disseminable (source protected)
assessment          TEXT                 -- analyst evaluation / significance
threat_level        TEXT DEFAULT 'low'   -- low|medium|high|critical
classification      TEXT                 -- free/coded caveats
criminal_predicate  TEXT                 -- 28 CFR Part 23 retention justification
submitted_by        INTEGER              -- FK users
submitted_at        TEXT DEFAULT (datetime('now'))
evaluated_by        INTEGER
evaluated_at        TEXT
analyzed_by         INTEGER
analyzed_at         TEXT
disseminated_by     INTEGER
disseminated_at     TEXT
review_date         TEXT                 -- computeReviewDate(); 28 CFR 5-yr default
retention_status    TEXT DEFAULT 'active' -- active|due_review|flagged_purge|purged
rejected_reason     TEXT
recalled_reason     TEXT
created_at          TEXT DEFAULT (datetime('now'))
updated_at          TEXT DEFAULT (datetime('now'))
```
Indexes: `(status)`, `(retention_status)`, `(threat_level)`, `(submitted_by)`,
`(source_id)`.

### 4.2 `intel_sources` (CI / source registry)
```
id                    INTEGER PK AUTOINCREMENT
source_code           TEXT UNIQUE          -- 'SRC-2026-014' (non-identifying handle)
source_type           TEXT NOT NULL        -- officer_observation|confidential_informant|
                                           -- anonymous_tip|public|other_agency|osint|
                                           -- technical|victim|witness|suspect
display_label         TEXT                 -- non-identifying ('CI #14', 'Anon caller')
true_identity_person_id INTEGER            -- FK persons, NULLABLE, RESTRICTED
handler_user_id       INTEGER              -- FK users (assigned handler)
reliability_grade     TEXT                 -- 'A'..'F' baseline
status                TEXT DEFAULT 'active' -- active|inactive|closed|compromised
restricted            INTEGER DEFAULT 1    -- 1 = identity gated to supervisor+
notes_restricted      TEXT                 -- supervisor+ only
created_by            INTEGER
created_at            TEXT DEFAULT (datetime('now'))
updated_at            TEXT DEFAULT (datetime('now'))
```
Index: `(source_type)`, `(status)`.

### 4.3 `intel_source_reliability_log`
```
id          INTEGER PK AUTOINCREMENT
source_id   INTEGER NOT NULL     -- FK intel_sources
old_grade   TEXT
new_grade   TEXT
reason      TEXT
changed_by  INTEGER
created_at  TEXT DEFAULT (datetime('now'))
```
Index: `(source_id)`.

### 4.4 `intel_report_links` (entity junction — reuses existing suggestion-junction pattern)
```
id          INTEGER PK AUTOINCREMENT
report_id   INTEGER NOT NULL
entity_type TEXT NOT NULL   -- person|vehicle|location|organization|call|incident|gang|business
entity_id   INTEGER NOT NULL
role        TEXT            -- subject|associate|location|mentioned|vehicle_used|...
added_by    INTEGER
created_at  TEXT DEFAULT (datetime('now'))
UNIQUE (report_id, entity_type, entity_id, role)
```
Index: `(report_id)`, `(entity_type, entity_id)`.

### 4.5 `intel_dissemination_log` (release ledger — backs external-share audit)
```
id              INTEGER PK AUTOINCREMENT
report_id       INTEGER NOT NULL
recipient_type  TEXT            -- user|agency|client
recipient_id    INTEGER         -- NULLABLE (users.id when internal)
recipient_label TEXT            -- free-text for external agency/client
channel         TEXT            -- inbox|pdf|external_export
handling_ack    INTEGER DEFAULT 0
reason          TEXT
disseminated_by INTEGER
created_at      TEXT DEFAULT (datetime('now'))
```
Index: `(report_id)`.

---

## 5. Pure logic — `src/utils/intelDevelopment.ts` (vitest-tested)

Follows the `intelMatch`/`intelDossier` precedent: pure, dependency-free helpers
with `tests/intelDevelopment.test.ts`.

- `canTransition(report, toStatus, role): { ok: boolean; reason?: string }` — the
  state-machine guard implementing the §2 table. **USER-CONTRIBUTED** (~8–10 lines of
  the completeness rules; scaffold + tests provided).
- `confidenceScore(reliability, credibility): number` — combines A–F + 1–6 into a
  single 0–100 confidence. **USER-CONTRIBUTED** (~5 lines; multiple valid weightings;
  scaffold + tests provided).
- `gradeLabel(reliability, credibility): string` — e.g. `'B2 — Usually reliable /
  Probably true'`.
- `computeReviewDate(disseminatedAt, handlingCode): string` — 28 CFR default +5 years
  (sooner for sensitive handling codes if desired).
- `nextReportNumber(year, seq): string` — `INT-2026-0001` formatting.
- `retentionStatus(report, nowISO): 'active'|'due_review'|'flagged_purge'` — drives
  the cron.
- `redactReport(report, role, isOwner): report` — strips `raw_narrative` + source
  identity for unauthorized viewers.

---

## 6. Routes — `src/routes/intel/development.ts`, mounted by `intel.ts`

Mounted via `intel.route('/reports', intelReports)` and `intel.route('/sources',
intelSources)` (or a single sub-router exposing both) so all intel stays under
`/api/intel` and the 44KB `intel.ts` does not grow. Auth: `/api/intel` is already
`auth: 'required'` in `routesConfig.ts`; handlers add role gates.

**Reports**
- `POST   /api/intel/reports` — submit raw report. `operational` (officer+).
- `GET    /api/intel/reports` — list, filters (`status`, `grade`, `threat`, `mine`,
  `retention`). Role-scoped; raw redacted via `redactReport`.
- `GET    /api/intel/reports/:id` — detail, redacted by role/handling/ownership.
- `PUT    /api/intel/reports/:id` — edit (state-aware; officer may edit own `submitted`).
- `POST   /api/intel/reports/:id/evaluate` — set 5×5×5 grade → `graded`. `supervisorPlus`.
- `POST   /api/intel/reports/:id/analyze` — assessment + sanitized narrative + predicate
  → `analyzed`. `supervisorPlus`.
- `POST   /api/intel/reports/:id/disseminate` — release → `disseminated`. `supervisorPlus`.
- `POST   /api/intel/reports/:id/recall` — → `recalled`. `supervisorPlus`.
- `POST   /api/intel/reports/:id/reject` — → `rejected`. `supervisorPlus`.
- `POST   /api/intel/reports/:id/links` / `DELETE /api/intel/reports/:id/links/:linkId`
  — entity linking. `supervisorPlus`.
- `POST   /api/intel/reports/:id/share` — external/client share. `supervisorPlus`;
  requires permitting `handling_code`; writes `intel_dissemination_log` + `audit_log`.
  The sanitized product PDF is generated **client-side** (see §7) — no server PDF
  route; the share endpoint records the release event, the client renders/attaches
  the PDF for the user to send.

**Sources**
- `GET    /api/intel/sources` — list (identity redacted unless supervisor+).
- `POST   /api/intel/sources` — create. `supervisorPlus`.
- `GET    /api/intel/sources/:id` — detail (identity gated).
- `PUT    /api/intel/sources/:id` — edit. `supervisorPlus`.
- `POST   /api/intel/sources/:id/reliability` — log a grade change → reliability log.
  `supervisorPlus`.

**Cron (retention)** — a **daily branch** added to the existing scheduled handler
(keyed off hour so it runs once/day): set `retention_status='due_review'` for reports
whose `review_date <= now` and `retention_status='active'`; emit a notification to
intel supervisors. Purge itself is a supervisor action (scrubs `raw_narrative` +
`sanitized_narrative`, sets `retention_status='purged'`, keeps tombstone metadata +
audit row).

---

## 7. Integration with existing subsystems (pure addition — no rework)

- **Dissemination → inbox:** on `disseminate`, insert `notifications` rows
  (`type='intel_product'`, `priority` by threat) for authorized recipients
  (role/explicit list), plus `intel_dissemination_log` + `audit_log`.
- **Dissemination → FTS:** index `entity_type='intel_report'` into `intel_index`
  (label = `report_number` + title, body = **sanitized** narrative, identifiers =
  linked entity ids). Add one `case` to `rowsFor` in `intelIndexer.ts`. Only
  `disseminated` reports are indexed.
- **Dossier:** `intelDossier.ts` `getDossier` gains a **"Linked Intelligence"**
  section — disseminated, handling-/role-permitted reports linked to that person.
- **PDF:** new `client/src/utils/intelProductPdf.ts`, Arial-only
  (`registerArialFont` at the jsPDF site per project rule), handling-code-stamped
  header/footer, source-sanitized. Never renders `raw_narrative`.
- **External share (Wave 1 scope):** produces the sanitized PDF + records the
  recipient/handling/reason in `intel_dissemination_log` + `audit_log`. Actual
  transport (email via the existing MS Graph subsystem) is a clean follow-up hook,
  out of scope for Wave 1.

---

## 8. Client

- `client/src/pages/intel/IntelReportsPage.tsx` (route `/intel/reports`) — queue/list:
  status filters, Admiralty grade badges, threat chips, retention flags.
- `client/src/pages/intel/IntelReportDetailPage.tsx` (`/intel/reports/:id`) — the
  lifecycle UI: submit form → grading widget (A–F × 1–6 × handling) → analyst panel
  (raw vs sanitized side-by-side, raw redacted for unauthorized) → links editor →
  disseminate / recall / reject controls → dissemination log → PDF button → share modal.
- `client/src/pages/intel/IntelSourcesPage.tsx` (`/intel/sources`) — source/CI
  registry; true identity + restricted notes shown only to supervisor+.
- Nav entries + links from `IntelSearchPage` and person dossier.
- All calls via `apiFetch`. Spillman pure-black design tokens, 2px radius.
- **Service worker:** bump `CACHE_NAME` in `client/public/sw.js` (`v916` → `v917`).

---

## 9. Testing

- `tests/intelDevelopment.test.ts` — unit tests for every pure helper, especially
  `canTransition` (each row of the §2 table, both ok + rejected paths), `confidenceScore`,
  `computeReviewDate`, `retentionStatus`, `redactReport`.
- Worker typecheck (`npm run typecheck`) + client typecheck + client vitest must pass
  (CI: `pr-tests.yml`).
- Add route smoke tests where feasible (per CLAUDE.md "prefer a smoke test in the same PR").

---

## 10. Delivery

- Feature branch off `origin/main` → `gh pr create` (per project flow; **not** a direct
  push to main). PR runs `pr-tests.yml`; merge triggers `deploy.yml`.
- **Post-merge:** apply `0104_intel_development.sql` directly to live D1 `785de7ae` via
  the Cloudflare D1 API; verify with `pragma_table_info('intel_reports')` (deploy
  migration step is `continue-on-error`).
- Verify boot + a disseminate round-trip in a real browser (WAF blocks curl on non-health
  paths).
- SW bump shipped with the client build so users get fresh chunks.

---

## 11. Out of scope (later waves; hooks left clean)

- Graph workbench / investigation cases — **Wave 2**.
- AI auto-extraction, auto-drafting of sanitized narrative, auto-grading — **Wave 3**
  (the `evaluate`/`analyze` routes accept the same payload an AI drafter would produce).
- New collection feeds (OSINT/court/ALPR) — **Wave 4**.
- Formal tasking/requirements (collection-plan) management.
- External-share *transport* (email/secure link) — follow-up; Wave 1 logs + PDFs only.

---

## 12. Open implementation notes

- Confirm live `persons` PK column name before wiring `true_identity_person_id`
  (memory: `persons.dob` not `date_of_birth`; verify with `pragma_table_info`).
- Confirm the exact scheduled-handler entry point in `src/index.ts` for the daily
  retention branch (the per-minute watchlist sweep already lives there).
- `report_number` sequence: derive next seq from `MAX` of current-year reports at
  insert time (single-writer D1, acceptable); no separate counter table needed.
