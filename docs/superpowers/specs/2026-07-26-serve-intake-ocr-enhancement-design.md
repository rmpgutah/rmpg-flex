# Serve Intake OCR — Output & Visual Enhancement (design)

**Date:** 2026-07-26
**Branch:** `claude/serve-intake-ocr-enhancement-167d8d`
**Reference artifact:** `RMPG Flex - CFS26-00127.pdf` (production output, operator-edited to mark the target)
**Fixture corpus:** 10 ICU Investigations packets (`~/Desktop/Process Service/ICU Investigations/`)

---

## 1. Problem

The Serve Intake OCR pipeline reads a three-document packet (Court Docket, Field Sheet,
Information Form), extracts structured fields, and writes a PSO briefing onto the dispatch
CFS. That CFS renders as the PS-201 Call For Service Report.

The pipeline works, but the output has three classes of defect:

**Extraction is undefended against real input hazards.** The Field Sheet's "RUSH" watermark
bleeds into the text layer as isolated `H`/`S`/`U`/`R` tokens sitting inside the Case, Court,
Plaintiff, and Defendant cells (Telarus 16223079). Court Dockets carry Cyrillic homoglyphs
(`Palo Alto, СA 94304`). Neither is handled, so garbage reaches the model.

**The briefing does not model the facts that govern a lawful attempt.** Three examples from
the fixture corpus, all currently unextractable:

- `Check VV787 $18.50` — a witness fee the server must physically carry (Anderson 16153258).
- `BUSINESS ADDRESS` + "Individuals must be personally served at their place of employment" —
  which *inverts* the dwelling sub-service guidance the briefing prints today.
- "Diligence is 1 between 6AM-9AM, 1 between 9AM-6PM and 1 between 6PM-9PM. One attempt must
  be on Saturday or Sunday." — a client-mandated schedule the planner ignores.

**The report contradicts itself and clips.** Confirmed defects:

| ID | Defect | Location |
|---|---|---|
| D1 | Deadline clamp collapses distinct attempt offsets onto one date (report shows attempts 2 and 3 both on Tue 2026-07-28) | `serveDiligencePlanner.ts:186` |
| D2 | Client window detection reads only the first line of `queueRow.notes`, never `service_instructions` — so the report prints "no client restriction" on a packet whose own description quotes the client's 3-window schedule | `serveIntakeBriefing.ts:403` |
| D3 | `addFormattedText` measures wrap width in the normal font but renders `*italic*` runs as `bolditalic` (wider); `hasBold` tests only `**`. Result: right-margin overflow (page 4, "PHOTOGRAPH THE LOCAT") | `pdfGenerator.ts:2055` |
| D4 | `buildPsoBriefing` emits 2 notes (+1 OCR note); the target is 7 topical entries | `serveIntakeBriefing.ts:528` |
| D5 | Weekday abbreviations render inconsistently (`TUE` vs `TUESDAY`) | `serveDiligencePlanner.ts:44` |
| D6 | Attempt timing keys off `isBusiness` (entity type) rather than the physical address class | `serveDiligencePlanner.ts:91` |

---

## 2. Operator decisions (binding)

These were decided by the operator and are not open for re-litigation during implementation.

**D-1 — Typography stays fully uppercase.** The all-caps entry bodies are house style, not an
artifact. `.toUpperCase()` on note bodies stays. Consequence: bold and underline become the
only surviving hierarchy signal inside an entry, so emphasis rendering must be verified rather
than assumed.

**D-2 — Address class is a property of the LOCATION, not the recipient.** Business timing
windows apply only to a *confirmed business location*. A registered agent at a residential
address gets residential timing. The corporate/agent role continues to drive **who may lawfully
accept service** (URCP 4(d)(1)(E)) — that concern is separated from **when to attempt**.
`isBusiness` must stop driving window selection.

**D-3 — Model upgrade must not require new spend.** Route intake through the existing
`callAi()` chain (Claude → OpenAI → Workers AI, with the KV cooldown breaker) instead of the
hardcoded Workers-AI model constants, and raise the Workers-AI floor. When no paid key is
configured the pipeline degrades to free Workers AI with no behavioural change beyond accuracy.

**D-4 — Phased delivery.** Four stacked PRs, each independently reviewable and gated on the
fixture corpus.

---

## 3. Architecture

### 3.1 Address-class resolution (new)

A single resolver produces `address_class ∈ {residential, business, unknown}` plus a
`confirmed: boolean`. Resolution order, first hit wins:

1. **Operator confirmation at review** — explicit override on the Serve Intake page.
2. **Existing records** — a matching `properties` / `businesses` row already classifies it.
3. **Packet language** — literal `BUSINESS ADDRESS` / `place of employment` / suite-number
   patterns in the Field Sheet instructions.
4. **Geocode POI class** — commercial vs residential parcel signal.
5. Otherwise `unknown`, `confirmed: false`.

**Unconfirmed never yields business timing.** `unknown` and unconfirmed both fall through to
residential defaults, which are strictly wider (they include evenings and weekends). Being
wrong in that direction costs an unnecessary attempt window; being wrong the other way means a
server sits outside a house at 10:00 on a Tuesday. This satisfies D-2 without introducing a
commit-blocking prompt.

The registered-agent role is recorded separately in `registered_agent_name` /
`registered_agent_address` and feeds the SERVICE AUTHORITY section only.

### 3.2 Attempt-window precedence (new)

One auditable function, precedence descending:

1. `client_attempt_schedule[]` — the client's literal bands, parsed from `service_instructions`.
2. Location note constraints (existing `ServiceLocationNote`).
3. `address_class` defaults (§3.1).
4. Generic diligence doctrine (existing `DILIGENCE_LINES`).

Cross-cutting constraints applied after selection: `service_days_prohibited` (no Sunday),
`attempt_start_not_before`, and the deadline clamp — which must now compress *within* a day
into distinct bands rather than stacking identical dates (fixes D1).

Every emitted window carries its authority string ("client-specified", "residential default",
"site note") so the report can print *why* that window was chosen.

### 3.3 Briefing decomposition

`buildPsoBriefing()` returns 7 notes instead of 2. Each maps to an existing renderer badge in
`recordPdfGenerator.ts:3316` — `OFFICER SAFETY`, `INTAKE`, `DISPATCH` — so no renderer change
is needed to *emit* them; only badge colouring is new.

| Entry | Author/badge | Content |
|---|---|---|
| 1 | OFFICER SAFETY | Risk assessment, indicators, posture |
| 2 | INTAKE | Service profile, case, documents, timeline, service authority |
| 3 | DISPATCH | Tactical approach, identity verification, refusal/evasion doctrine |
| 4 | DISPATCH | Attempt plan, service windows (with authority), diligence standard |
| 5 | DISPATCH | Affidavit requirements, client instructions verbatim |
| 6 | DISPATCH | Contacts, hiring party, job/reference IDs |
| 7 | OCR | Source documents, field count, missing criticals, dates seen |

### 3.4 Extraction hardening

Pre-clean runs before any model call and is pure/deterministic (unit-testable without a model):
watermark-token scrubbing, homoglyph normalization, bracket-noise repair, ligature/soft-hyphen
normalization, column-aware reflow, and per-page text-density routing to vision OCR.

Post-validation is likewise deterministic: date parseability, ZIP↔state agreement, phone digit
count, case-number shape. Validator agreement blends into the confidence score rather than the
model's unverified self-report.

Cross-document arbitration picks a winner by declared source precedence (Information Form >
Field Sheet > Court Docket for service mechanics; Court Docket > others for case caption) and
**retains the losing candidate** so the review UI can offer it.

---

## 4. The 68 improvements

### PR 1 — Extraction & OCR accuracy (Worker) · 20

1. Watermark-token scrubber for stamps reconstructed from isolated letters (`RUSH`, `COPY`, `FILED`, `DRAFT`).
2. Unicode homoglyph normalizer (Cyrillic/Greek → Latin), logging every substitution.
3. Bracket/checkbox noise repair (`[X)`, `[]`) → canonical forms.
4. Ligature, soft-hyphen, and NBSP normalization; de-hyphenate line-broken words.
5. Column-aware reflow so two-column Information Forms stop interleaving.
6. Per-page text-density check routing scan-stub pages to vision OCR.
7. Replace hardcoded model constants with `callAi()` (D-3).
8. Raise the Workers-AI floor model for both text and vision paths.
9. Document-family-specific prompts (Information Form / Field Sheet / Court Docket).
10. Bounded second-pass critic call on low-confidence fields only.
11. Deterministic post-validator (dates, ZIP↔state, phone, case-number shape).
12. Confidence recalibration blending self-report, validator agreement, and cross-document corroboration.
13. New field `address_class` + `address_class_confirmed`.
14. New fields `service_days_allowed` / `service_days_prohibited`.
15. New field `client_attempt_schedule[]` (structured bands parsed from free text).
16. New field `attempt_start_not_before`.
17. New fields `witness_fee_tendered` + `witness_fee_instrument`.
18. New field `registered_agent_address`, distinct from `recipient_address`.
19. New field `sub_service_authorized_first_attempt`.
20. Cross-document arbitration retaining losing candidates for the review UI.

### PR 2 — Briefing intelligence & timing engine (Worker) · 20

21. Single precedence function for attempt windows (§3.2).
22. Residential defaults: 07:00–09:00 / 11:00–13:00 / 17:00–20:30 plus a weekend attempt.
23. Business defaults: 09:30–11:30 / 13:30–15:30, weekdays, within posted hours.
24. **`isBusiness` no longer selects windows** — timing keys off confirmed `address_class`; unconfirmed falls through to residential (D-2, §3.1).
25. Honor `service_days_prohibited` (never schedule a forbidden Sunday).
26. Honor `attempt_start_not_before`.
27. Fix D1 — deadline clamp compresses within-day into distinct bands instead of stacking dates.
28. Fix D5 — emit full weekday names.
29. Print the authority for each window beside it.
30. Flag explicitly when the client's own schedule cannot fit before the deadline.
31. Fix D2 — read client windows from `service_instructions` and `notes`.
32. Address-class-aware service authority: place-of-employment service suppresses dwelling sub-service language.
33. Subpoena doctrine surfaces the actual witness-fee instrument from the packet.
34. Distinguish *party to serve* from *case parties* (a subpoena recipient is typically a non-party).
35. Out-of-state issuing court handling (UIDDA) when docket state ≠ service state.
36. Itemize each document to be served as a server-tickable checklist.
37. Entry 1 — OFFICER SAFETY.
38. Entry 2 — INTAKE.
39. Entry 3 — TACTICAL APPROACH.
40. Entry 4 — ATTEMPT PLAN + WINDOWS + DILIGENCE.

### PR 3 — PDF render & visual (client) · 18

41. Fix D3 — per-run width measurement so italic/bolditalic runs stop overflowing the right margin.
42. Entry 5 — AFFIDAVIT + CLIENT INSTRUCTIONS.
43. Entry 6 — CONTACTS.
44. Entry 7 — OCR CONTEXT, with distinct badge colours per entry class.
45. Timeline table: populate ELAPSED/PHASE or collapse the empty columns.
46. Suppress `N/A` runs on a pending call; one "pending" note per block.
47. Map page: resolve scale-bar vs. attribution collision.
48. Map page: reposition the AREA OVERVIEW inset off the street labels.
49. Keep egress callouts A–D inside the frame at all zoom levels.
50. Compact the page-5 signature block; eliminate the dead sheet.
51. Continuation-header consistency across all pages of a spanning entry.
52. Widow/orphan control for section headers at page feet.
53. Bullet and number gutter alignment on wrapped list lines.
54. Long-token breaking so nothing runs past the text column.
55. `LINKED INDIVIDUALS`: render unknown DOB/phone as "NOT IN DOCUMENTS", not `--`.
56. Rewrite the OCR CONTEXT entry in the operator's prose register (sources, field count, extraction date).
57. Move per-document confidence to a compact provenance line.
58. **Uppercase stays (D-1)** — instead, verify and strengthen bold/underline weight contrast, since emphasis is the only hierarchy left inside an all-caps body.

### PR 4 — Serve Intake page UI (client) · 10

59. Per-field confidence chip.
60. Per-field source badge (which document supplied the value).
61. Conflict resolver showing both candidates with sources.
62. "Not found in documents" visually distinct from "found and empty".
63. Inline attempt-plan preview before commit.
64. Witness-fee / physical-item checklist surfaced at review.
65. Address-class selector, pre-filled from §3.1, operator-overridable (D-2).
66. Client-instruction parse preview showing the derived structured schedule.
67. Re-run extraction on one document without re-uploading the packet.
68. Golden-fixture test harness over the 10 practice packets with a checked-in expected field set.

---

## 5. Testing

**Fixture harness (item 68) is the spine.** It lands in PR 1 with an expected-field set derived
from the 10 packets and asserts field-level extraction. PRs 2–4 must keep it green.

- Pre-clean and post-validation are pure functions — unit-tested with no model call.
- The window-precedence function is pure over `(nowIso, deadline, class, schedule, note)` —
  every operator decision above becomes a named test case, including the registered-agent-at-a-
  residence case from D-2 and the duplicate-date case from D1.
- Briefing decomposition is asserted on note count, author tags, and section presence.
- PDF changes are asserted through the existing generator tests plus a rendered-output check for
  the right-margin overflow case (D3).

Per `CLAUDE.md` the baseline is clean across all four gates, so any red is caused by this work.

## 6. Risks

- **Renderer coupling.** Splitting one note into seven multiplies the entry-header strips; PR 3
  must confirm the page-break/continuation path holds at 7 entries before PR 2 ships the split.
- **Schedule parsing from free text.** Client instructions are prose. The parser must fail
  *closed* — an unparseable schedule falls back to `address_class` defaults and says so in the
  report, rather than inventing bands.
- **New fields vs. column caps.** `serve_queue` is not near the D1 100-column cap, but the new
  fields land in `parsed_data` JSON where possible to avoid schema churn.
