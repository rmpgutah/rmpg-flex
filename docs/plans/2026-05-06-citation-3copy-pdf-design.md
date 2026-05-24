# Citation 3-Copy PDF — Hotdog-Fold Multi-Violation Design

**Date:** 2026-05-06
**Author:** brainstormed via `/superpowers:brainstorming`
**Scope:** v2 PDF engine — citation print path only
**Out of scope:** Citation authoring UI (separate brainstorm after this lands), legacy `recordPdfGenerator.ts` citation path, other record types

## Background

Spillman Flex / Motorola Solutions visual upgrade landed earlier today (commit `d5198b4a`) — citation PDFs now render with formal Spillman typography, but only as a single-page document with single-violation flat fields. RMPG operators issue traffic citations using the standard 3-part Western-state convention: a single physical citation produces three copies (Violator / Officer / Administrative) of the same record, traditionally as a hotdog-folded NCR pad.

The user's brief (2026-05-06): replace the current single-page citation print with a 3-page document, each page split vertically into a left-half citation block and a right-half copy-specific instructions block, with full multi-violation support so the underlying `citations` + `citation_violations` schema is no longer flattened to a single row in the rendered output.

## Final approved design decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Print mode** | Replace single-page entirely (option B from Q1) | Always-3-copy is the policy convention RMPG runs |
| **Page format** | Portrait letter 8.5" × 11", vertical center fold (option A from Q2) | Standard NCR pad geometry; halves are 4.25" × 11" |
| **Instructions text** | I draft standard Utah-jurisdiction text (option A from Q3) | Operator can correct in follow-up commit |
| **Multi-violation layout** | Auto: compact table for ≤3 violations, stacked-per-violation for 4+ (option C from Q1-multi) | Operator-friendly fit for both common (1-2) and high-count (5+) cases |
| **Issuing officer placement** | Bottom of left half after Court Address (option A from Q2-officer) | Mirrors traditional citation booklet convention |
| **Long-text overflow** | Allow continuation pages (option B from Q3-overflow) | Preserves full record without truncating safety-critical text |

## Visual contract

### Page geometry

Every page is portrait letter (8.5" × 11"). Vertical center fold splits each into two 4.25"-wide halves. Margins: 10mm outer (top/left/right), 18mm bottom; 5mm gap each side of the fold rule.

```
┌──────────────────────┬──────────────────────┐
│ Spillman header      │ Spillman header      │  ← spans full 8.5" page width
│ (agency, title, meta)│ (continued)          │
├──────────────────────┼──────────────────────┤
│                      │ COPY-VARIANT BANNER  │  ← top of right half only
│ CITATION DATA        │ ─────────────────────│
│ (left-half schema)   │                      │
│                      │ COPY-SPECIFIC        │
│ Identical on         │ INSTRUCTIONS         │
│ pages 1-3            │                      │
│                      │ Different per page   │
├──────────────────────┴──────────────────────┤
│ Footer (full width)                         │
└─────────────────────────────────────────────┘
                ↑
    visible 0.5pt vertical fold rule
    runs page-top-to-footer-top
```

Each of 3 pages has the same left-half citation data (idempotent re-render). Right halves differ:
- Page 1: VIOLATOR COPY banner + violator instructions
- Page 2: OFFICER COPY banner + officer attestation/notes/witness
- Page 3: ADMINISTRATIVE COPY banner + clerk routing/disposition/supervisor

Continuation pages (when long content overflows) inherit the same split + copy variant of the page they continue.

### Spillman header (full-width, every page)

Reuses the agency-block + form-meta-row header shipped in commit `ad771fe3`:
```
══════════════════════════════════════════════════════════  (1.5pt rule)
            ROCKY MOUNTAIN PROTECTIVE GROUP                   ← 11pt bold
                SALT LAKE CITY, UTAH                           ← 8pt
                                                              
                    CITATION                                  ← 14pt bold
                                                             
        FORM PS-209  ·  CASE C-26-12345  ·  PAGE 1 OF 3       ← 7pt right
──────────────────────────────────────────────────────────  (0.5pt rule)
```

The form-meta row's `PAGE N OF M` is the *total* page count across all 3 copies (and continuation pages).

### Copy-variant banner (right half, top of every page)

Below the header thin rule, the right half gets a single-line banner identifying the copy:
```
VIOLATOR COPY                                    ← 9pt bold UPPERCASE
──────────────────────────────────────           ← 0.5pt rule, half-width
```

Banner text per copy:
- Page 1: `VIOLATOR COPY`
- Page 2: `OFFICER COPY — RETAIN FOR RECORDS`
- Page 3: `ADMINISTRATIVE COPY — COURT FILING`

### Vertical fold rule

A visible 0.5pt black line runs from immediately below the header thin rule to immediately above the footer thin rule, at the horizontal center of the page (X = 107.95mm in mm units). Operators use this as the physical-fold cue.

### Footer (full width, every page)

Reuses the Spillman footer shipped in commit `2bcea4e1`:
```
──────────────────────────────────────────────────────────  (0.5pt rule)
PROPERTY OF ROCKY MOUNTAIN PROTECTIVE GROUP — LAW ENFORCEMENT SENSITIVE   PAGE 1 OF 3
REV. 2026-04                                                              FORM PS-209
```

### Left-half citation schema

Reflowed from the current 3-column max to **2-column max** so values like "Capital One, N.A., successor by merger to Discover Bank" don't truncate in the 4.25"-wide column. Section order:

1. **CITATION INFORMATION** (1-column stacked: Citation Number / Type / Status)
2. **TIMING & LEVEL** (2-column: Violation Date · Offense Level / Violation Time)
3. **LOCATION** (1-column: Address)
4. **SUBJECT** (1-column stacked: Full Name / DOB · DL # / Address)
5. **VEHICLE INFORMATION** (2-column: License Plate · State / Vehicle Description)
6. **VIOLATIONS** *(new — multi-violation block, see below)*
7. **COURT** (2-column: Court Date · Court Name / Court Address)
8. **ISSUING OFFICER** (1-column at bottom: Name + Badge#)
9. **NOTES** (1-column narrative, allows continuation page if long)

### Multi-violation rendering (auto-layout)

The schema receives a `violations: CitationViolation[]` array. The renderer auto-picks layout:

**Compact table** (≤3 violations):
```
VIOLATIONS
──────────────────────────────────────
STATUTE         DESCRIPTION              LVL    FINE
─────────────   ──────────────────────   ───    ───────
UCA 41-6a-601   Speeding 15 MPH over     INF    $175.00
                posted limit (40/25)
─────────────   ──────────────────────   ───    ───────
UCA 41-6a-92    Failure to signal turn   INF    $ 50.00
─────────────   ──────────────────────   ───    ───────
                              TOTAL FINE        $225.00
```

**Stacked-per-violation** (4+ violations):
```
VIOLATIONS
──────────

VIOLATION 1
───────────
STATUTE / CODE          OFFENSE LEVEL
UCA 41-6a-601           Infraction

DESCRIPTION
Speeding 15 MPH over posted limit
(40/25)

FINE                    $175.00
─────────────────────────────────────

VIOLATION 2
───────────
... (per-violation block) ...
─────────────────────────────────────

═════════════════════════════════════
TOTAL FINE              $225.00
═════════════════════════════════════
```

**Backward compat:** if `data.violations` is empty/missing, fall back to single-violation flat fields (`statute_citation` / `fine_amount` / `violation_description` / `offense_level`) — render as if N=1.

### Issuing officer block (bottom of left half)

Single-column section just before the footer:
```
ISSUING OFFICER
─────────────────────────────────────
ZAMORA, CHRISTOPHER  ·  Badge #1572
─────────────────────────────────────
```

### Right-half copy-specific instructions text

Drafted Utah-jurisdiction text. Each block fits in a 4.25"-wide column. If a block runs longer than ~70 lines (over a single page), it wraps to a continuation page that inherits the same copy banner + a "(continued)" suffix.

#### Page 1 — Violator Copy

```
VIOLATOR COPY
─────────────────────────────────────

You are charged with the violation
described on the left half of this
citation.

YOUR OPTIONS
─────────────────────────────────────

1. PAY THE FINE
   Mail payment to the court address
   shown at left. Make checks payable
   to the court.

2. REQUEST A COURT HEARING
   Appear in person at the court
   named on or before the court date
   shown.

3. REQUEST A PLEA IN ABEYANCE
   Contact the court directly within
   14 days of issuance.

WARNING — FAILURE TO RESPOND
─────────────────────────────────────

If you do not respond by the court
date shown, a bench warrant may be
issued for your arrest and your
driver's license may be suspended.
(Utah Code §53-3-218)

─────────────────────────────────────

Signature below acknowledges receipt
only and is NOT an admission of
guilt.

X _______________________________
  Violator Signature

Date: ____________________________

─────────────────────────────────────

Issued under Utah Code Title 41
Chapter 6a (Traffic Code) and
Title 77 Chapter 7 (Criminal
Procedure).
```

#### Page 2 — Officer Copy

```
OFFICER COPY — RETAIN FOR RECORDS
─────────────────────────────────────

ISSUING OFFICER ATTESTATION
─────────────────────────────────────

I certify under penalty of perjury
under the laws of the State of Utah
that I personally observed the
violation described on the left,
that the violation occurred at the
date/time/location indicated, and
that I issued this citation to the
person identified.

Officer ____________________________

Badge # ____________________________

Date ____________  Time ____________

FIELD NOTES (court testimony)
─────────────────────────────────────

____________________________________

____________________________________

____________________________________

____________________________________

____________________________________

____________________________________

____________________________________

WITNESS INFORMATION (if any)
─────────────────────────────────────

Name ______________________________

Phone _____________________________

Address ___________________________
___________________________________

X _______________________________
  Officer Signature

Date: ____________________________
```

#### Page 3 — Administrative Copy

```
ADMINISTRATIVE COPY — COURT FILING
─────────────────────────────────────

ROUTING
─────────────────────────────────────

☐ Sent to court within 5 business
  days
☐ Filed in agency records
☐ Forwarded to prosecutor (if
  criminal)
☐ Bond posted: $ __________________

CLERK PROCESSING
─────────────────────────────────────

Date Received _____________________

Clerk Initials ____________________

Case Number Assigned _______________

DISPOSITION
─────────────────────────────────────

☐ Pending court appearance
☐ Paid in full
☐ Dismissed
☐ Warrant issued (FTA)
☐ Plea in abeyance / Diversion
☐ Reduced/amended charge
☐ Other: __________________________

SUPERVISOR REVIEW
─────────────────────────────────────

X _______________________________
  Supervisor Signature

Date: ____________________________

NOTES FOR FILE
─────────────────────────────────────

____________________________________

____________________________________

____________________________________
```

## Architecture

### New + edited files

| File | Type | Purpose | Est. lines |
|---|---|---|---|
| `client/src/utils/pdf/v2/engine/panel.ts` | NEW | `Panel(left, top, width, height)` utility — wraps `LayoutEngine` to constrain rendering to a sub-region | ~80 |
| `client/src/utils/pdf/v2/engine/multiCopy.ts` | NEW | `renderMultiCopyPdfV2(schema, data, copies, instructions)` — orchestrator that produces a multi-page PDF with split halves | ~140 |
| `client/src/utils/pdf/v2/forms/citationInstructions.ts` | NEW | Three text blocks (violator/officer/admin) + copy banner labels + per-block layout primitives | ~150 |
| `client/src/utils/pdf/v2/forms/citation.ts` | EDIT | (a) Reflow schema to 2-column max; (b) extend `CitationData` with `violations: CitationViolation[]`; (c) add multi-violation auto-layout helper that emits compact-table for ≤3 / stacked for 4+ | ~80 lines edited |
| `client/src/utils/pdf/v2DispatchAdapter.ts` | EDIT | Citation kind now routes through `renderMultiCopyPdfV2` instead of `renderPdfV2`. Sidecar embed/sign flow unchanged. | ~20 lines edited |
| `client/src/utils/pdf/v2/engine/__tests__/panel.test.ts` | NEW | Panel rendering bounds + cursor isolation | ~80 |
| `client/src/utils/pdf/v2/engine/__tests__/multiCopy.test.ts` | NEW | 3-page output; copy-variant rendering; sidecar bytes still extractable | ~120 |
| `client/src/utils/pdf/v2/forms/__tests__/citationInstructions.test.ts` | NEW | Text-block content lock; line-count guard | ~50 |
| Snapshot baselines | REGEN | `citation_blank` snapshot regenerates because layout changes; new `citation_3copy.empty.{pdf,sha256}` baseline added | mechanical |

### `Panel` API (the load-bearing primitive)

```typescript
export interface PanelBounds {
  left: number;      // mm
  top: number;       // mm
  width: number;     // mm
  height: number;    // mm
}

export class Panel {
  constructor(public bounds: PanelBounds, private doc: jsPDF) {}

  /** Sub-LayoutEngine constrained to this panel's bounds. */
  layout(): LayoutEngine;

  /** Draw the panel's outer border (debug only). */
  debugOutline(): void;
}
```

### `renderMultiCopyPdfV2` orchestration

```typescript
export interface CopyVariant {
  id: 'violator' | 'officer' | 'administrative';
  bannerText: string;
  renderInstructions: (panel: Panel) => void;
}

export async function renderMultiCopyPdfV2<T>(
  schema: FormSchema<T>,
  data: T,
  copies: CopyVariant[],
  options?: RenderOptions,
): Promise<jsPDF>;
```

For each copy in `copies` (typically 3): add page → draw full-width header → draw vertical fold rule → render schema into LEFT panel → render banner + `copy.renderInstructions(rightPanel)` → draw full-width footer. Total page count drives the `PAGE N OF M` calculation in header/footer.

### `CitationData` extension

```typescript
export interface CitationViolation {
  statute_citation: string;       // 'UCA 41-6a-601'
  description: string;
  offense_level: 'Infraction' | 'Misdemeanor' | 'Felony';
  fine_amount: number;
}

export interface CitationData {
  // ... existing flat fields ...

  /** Optional multi-violation array. When present, replaces the single-
   *  violation flat fields in the rendered VIOLATIONS section. When
   *  empty/missing, renderer falls back to flat fields for backward
   *  compatibility with single-violation citations issued before the
   *  multi-violation feature lands. */
  violations?: CitationViolation[];
}
```

`citationCanonicalData` extends to include the violations array — sidecar JSON captures the full list.

## Sidecar integrity preservation

The sidecar embed (round-trip integrity feature) lives at the document level: Info-dict `/Keywords` + post-`%%EOF` marker. Both are page-independent. The 3-page document still embeds **one** sidecar with the canonical citation data (now including violations[]). The Ed25519 signature is over the JSON data, not the visual rendering. **All 15 existing sidecar tests must pass unmodified — explicit non-regression gate.**

The new `multiCopy.ts` orchestrator calls the existing `embedSidecar()` helper once at the document level, after all 3 pages are rendered.

## Server-side coupling

The server's `/api/citations/:id/full` endpoint already returns the citation row joined with `citation_violations` rows. The client print path (`PrintRecordButton` for `recordType: 'citation'`) needs to fetch via `/full` instead of the bare row to populate `data.violations`. Verify in implementation plan.

## Risks + mitigations

| Risk | Mitigation |
|------|-----------|
| Field truncation in 4.25" half | Schema reflowed to 2-column max; long fields use full 1-column width; continuation pages allowed |
| Sidecar drift with new orchestrator | Existing `embedSidecar()` helper called once at doc level; all 15 sidecar tests must pass unmodified |
| Operators expecting 1-page get 3 pages | Replace mode chosen explicitly; deploy notification to operators |
| Multi-tenant Utah-text drift | Hardcoded for now; abstract to `system_config` later if RMPG signs non-Utah clients |
| Snapshot baseline churn | Mechanical regeneration at end (Task 8 of the impl plan) |
| Continuation page header/footer must use the *correct* PAGE N OF M | Renderer counts total physical pages and back-fills the header/footer text on a final pass |

## Verification path

1. All 15 existing sidecar tests pass UNMODIFIED — round-trip integrity preserved
2. New `panel.test.ts` (~6 tests) — bounds, cursor isolation
3. New `multiCopy.test.ts` (~8 tests) — 3-page output, copy variants distinct, sidecar embedded once, total-page-count correct in header/footer
4. New `citationInstructions.test.ts` (~3 tests) — text-block content lock per variant
5. Updated `citation.ts` tests — backward compat (empty violations[] = flat fallback), multi-violation auto-layout switch at N=4
6. Manual: render a 2-violation citation in dev preview; verify pixel layout against the design mockup; print to a real letter-paper printer; visually verify hotdog-fold geometry
7. Production smoke after deploy: print a real citation; visual conforms to design

## Out of scope (deliberate)

- **Citation authoring UI** — separate brainstorm + plan after this PDF lands
- **Statute lookup integration** in print path — print path consumes already-resolved violation rows; lookup is a UI concern
- **Print queue duplex / NCR-paper detection** — printing a 3-page PDF onto plain paper produces 3 sheets; NCR pad printing is a printer-driver concern not a PDF concern
- **Custom font embedding** — Helvetica only, same as the prior visual upgrade
- **Multi-tenant agency override** — uses `AGENCY` constant from `style.ts`
- **Other record types** (incident, warrant, FI, arrest) — separate sessions

## Scope estimate

| | Lines |
|---|---|
| New code | ~470 |
| Edits | ~100 |
| Tests | ~250 |
| Snapshot regeneration | mechanical |
| **Total** | ~820 lines |

**Effort:** ~5-7 hours focused work, single session.

## Approval status

Brainstormed and approved 2026-05-06 via interactive design dialogue:
- Q1 (replace mode): **B** — replace single-page entirely
- Q2 (page format): **A** — portrait letter 8.5" × 11", vertical center fold
- Q3 (instructions text): **A** — I draft Utah-jurisdiction text
- Q1-multi (violation layout): **C** — auto: compact for ≤3, stacked for 4+
- Q2-officer (placement): **A** — bottom of left half
- Q3-overflow (long text): **B** — allow continuation pages

Implementation plan to follow via `/superpowers:writing-plans`.
