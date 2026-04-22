# PDF v2 Engine — Design

**Date:** 2026-04-14
**Status:** Approved for implementation planning
**Owner:** Claude Code (session `dazzling-germain`)

## Problem

RMPG Flex produces ~23 distinct PDF outputs across six generator files totaling 10k+ lines. The subsystem has drifted:

- A partial design system (`pdfTokens`, `pdfFormHelpers`, `pdfAssets`) exists but adoption is patchy — `blankFormPdfGenerator` and `patrolTrackingPdfGenerator` adopted tokens, the 3,400-line `recordPdfGenerator` did not, and `proposalPdf` uses none of the shared helpers.
- Layout bugs exist (overlaps, bad page breaks, cutoffs).
- Data-binding gaps exist (newer DB columns like PSO and process service don't render; nulls leak as `"undefined"`).
- Legal polish is inconsistent (signatures, notary blocks, chain of custody, distribution lists).

A past attempt at unification (evidenced by the partial token adoption) didn't carry through, probably because touching `recordPdfGenerator.ts` all at once was too risky for production legal documents.

## Goals

1. Unified visual style (typography, header, footer, colors, spacing) across all 23 outputs.
2. Eliminate null leaks, `"undefined"` printing, and missing-field bugs at the primitive level.
3. Eliminate layout defects (clip-offs, bad page breaks, cutoffs) via shared layout primitives.
4. Add legal/professional polish (signatures, notary blocks, chain of custody) as first-class primitives.
5. **Preview-before-commit for every PDF.** No more instant downloads. Every v2 PDF goes through a split-pane review modal where the officer can edit fields, see the live PDF update, then pick a commit action (download, attach to record, email, print).
6. Do all of the above **without regressing any PDF currently used in production**, especially legal documents (warrants, citations, affidavits).

## Non-goals

- No big-bang rewrite of v1 generators.
- No new PDF library (staying on `jsPDF`).
- No schema-driven form editor for non-engineers.
- No server-side PDF generation — all rendering stays client-side.

## Approach — chosen

**Approach C — Build v2 alongside v1, migrate opt-in per form.**

Considered and rejected:
- **Approach A** (audit + targeted repairs). Safer than B but still touches v1 code in place. Risks regressing legal PDFs.
- **Approach B** (big-bang token migration). Fastest visual consistency but the same past attempt already failed at this. The 3,400-line `recordPdfGenerator.ts` has bespoke layout code — not just styled — so a token migration alone wouldn't fix layout bugs.

Approach C is chosen because legal documents in the system are admissible in court. A regression in affidavit output could cause a judge to reject service of process. The insurance policy of keeping v1 immutable while v2 stabilizes is worth the extra code surface during migration.

## Architecture

### Directory layout

```
client/src/utils/pdf/
  v2/
    engine/
      renderer.ts        ← consumes a FormSchema, produces a jsPDF doc
      primitives.ts      ← labeledField, checkboxRow, narrative, table, signature
      layout.ts          ← page break logic, column grid, section stacker
      header.ts          ← unified agency header
      footer.ts          ← unified footer
      context.ts         ← RenderContext passed to callbacks (no raw `doc` access)
      types.ts           ← FormSchema, FieldSpec, SectionSpec, RenderCallback
    forms/
      callForm.ts        ← one file per record type
      personForm.ts
      warrantForm.ts
      citationForm.ts
      ...
    blankForms/          ← PS-205 through PS-211 re-expressed as v2 schemas
    adapters/
      v1Bridge.ts        ← reuses existing V1 data interfaces as schema input
  (existing v1 files remain untouched under client/src/utils/)
```

### Single entry point

```ts
// pdf/v2/index.ts
export async function renderPdfV2(schema: FormSchema, data: unknown): Promise<jsPDF>;
export async function downloadPdfV2(schema: FormSchema, data: unknown, filename: string): Promise<void>;
```

Existing page callers keep invoking v1 functions. A feature-flag facade decides v1 vs v2 per form.

## The hybrid schema + callback contract

Three rules govern the contract:

### Rule 1 — Sections are either schema objects or render callbacks

```ts
export type Section = SchemaSection | RenderCallback;

export type SchemaSection = {
  kind: 'section';
  title: string;
  columns?: 1 | 2 | 3;
  fields: FieldSpec[];
  visibleIf?: (data: any) => boolean;
};

export type RenderCallback = (ctx: RenderContext, data: any) => void;

export type FieldSpec =
  | LabeledField       // { kind:'labeled', label, accessor, width? }
  | CheckboxField      // { kind:'checkbox', label, accessor }
  | NarrativeField     // { kind:'narrative', label, accessor, minLines? }
  | TableField         // { kind:'table', columns, rows }
  | SignatureField     // { kind:'signature', label, image?, printedName?, date? }
  | SpacerField;       // { kind:'spacer', height }
```

### Rule 2 — Callbacks never see `doc`, only a `RenderContext` with primitives

The `RenderContext` exposes the same primitives the schema consumes (`labeledField`, `checkboxRow`, `narrative`, `table`, `signature`, `spacer`, `pageBreakIfNeeded`) plus read-only introspection (`cursorY`, `pageHeight`, `leftX`, `rightX`, `columnWidth`). Critically: **no `rawText`, no `doc`, no `setFont`**. Callbacks get flexibility for conditional/variable-length content without being able to drift typography.

### Rule 3 — Data contract flows one type parameter from schema to accessors

```ts
export const callFormSchema: FormSchema<CallPdfData> = {
  meta: { formNumber: 'FORM PS-101', title: 'CALL FOR SERVICE', revision: FORM_REVISION },
  header: defaultHeader('call'),
  sections: [
    {
      kind: 'section', title: 'DISPATCH', columns: 2,
      fields: [
        f.labeled('Call #',   d => d.call_number),
        f.labeled('Priority', d => d.priority),
        /* ... */
      ],
    },
    {
      kind: 'section', title: 'PSO CLIENT REQUEST', columns: 2,
      visibleIf: d => Boolean(d.pso_service_type),
      fields: [ /* PSO-only fields */ ],
    },
    (ctx, d) => renderCaseLinks(ctx, d.case_links ?? []),
    {
      kind: 'section', title: 'OFFICER SIGNATURE',
      fields: [ f.signature('Responding Officer', d => d.officer_signature_data) ],
    },
  ],
};
```

### What the contract buys us

- **Null leak proofing** lives in one primitive. `labeledField()` renders `—` for null/undefined/empty and never `"undefined"`.
- **`visibleIf`** covers ~80% of today's conditionals (PSO, process service, warrant-linked) with no callback needed.
- **Callbacks exist** for the 20% that's genuinely dynamic (variable-length lists, custom cross-ref tables) but can't drift typography.
- **Every primitive is one implementation** in `engine/primitives.ts`. Fix once, applied everywhere.
- **TS types flow** through the schema so accessor typos get caught.

## Feature flag / opt-in mechanism

### Storage — `system_config` JSON row

```ts
{
  key: 'pdf.v2.enabled_forms',
  value: {
    call: false, person: false, vehicle: false, warrant: false,
    evidence: false, fleet: false, personnel: false, property: false,
    citation: false, incident_blank: false, person_blank: false,
    vehicle_blank: false, property_blank: false, citation_blank: false,
    field_interview_blank: false, affidavit_service: false,
    affidavit_non_service: false, service_log: false, patrol_tracking: false,
    invoice: false, proposal: false, bolo: false, warrant_summary: false,
  }
}
```

Default `false` for every key. Engine ships dark. No new tables — reuses the existing `system_config` pattern.

### Call-site shape

```ts
// pdf/index.ts — public facade
export async function downloadRecordPdf<T extends RecordPdfType>(
  type: T, data: RecordPdfDataMap[T], filename: string,
): Promise<void> {
  if (await isPdfV2Enabled(type)) {
    return downloadPdfV2(getSchema(type), data, filename);
  }
  return downloadRecordPdfV1(type, data, filename);
}
```

Existing page callers keep calling `downloadRecordPdf('warrant', data, filename)` unchanged. No if/else sprawl across pages.

### Admin UI — `/admin/pdf-engine`

- Spillman-style table: form name, version (v1/v2), last changed at, last changed by.
- Per-row dropdown `[v1, v2]` → `PUT /api/admin/pdf-engine/:form` → writes `system_config`, broadcasts via WebSocket, audit-logs. Admin role only.
- **"Revert All to v1"** emergency button.
- Per-form **"Preview v2"** button — generates sample PDF from canned fixture without enabling the flag.

### Runtime-safe flipping

- Flag changes take effect on next PDF generation; no restart needed.
- If v2 schema throws: facade catches, falls back to v1, logs `pdf_engine_fallback` to `audit_log` with form type + data ID.

```ts
async function downloadPdfV2Safely(schema, data, filename) {
  try {
    return await downloadPdfV2(schema, data, filename);
  } catch (err) {
    logPdfEngineFallback(schema.meta.formNumber, err);
    return downloadRecordPdfV1Fallback(schema, data, filename);
  }
}
```

### Env override for dev

`VITE_PDF_FORCE_V2=1` in `client/.env.local` forces all forms to v2. Makes local dev and visual-regression testing trivial without touching the DB.

### Retirement path

After a form has run in v2 for 30+ days with zero fallback events, admin panel surfaces **"Retire v1 for this form"**. Clicking deletes the v1 registration from the facade and removes the flag entry. Dead v1 code can then be deleted file-by-file.

## Preview UX (`PdfReviewModal`)

Every v2 form flows through a preview-before-commit modal. No instant downloads. This is exclusive to v2 — while a form is still on v1, generation behaves the current way (immediate save). Being on v2 gets you preview.

### The split-pane review modal

- **Left pane:** editor, one collapsible group per `SchemaSection`. Auto-generated from the same `FormSchema<T>` that renders the PDF — no per-form editor UI to maintain. Each `FieldSpec.kind` maps to a React input (`labeled` → text, `checkbox` → checkbox, `narrative` → textarea, `table` → editable grid, `signature` → signature pad).
- **Right pane:** `<iframe src={blobUrl}>` showing the live jsPDF output. Re-renders on a 400ms debounce so typing doesn't thrash.
- **Footer:** single **Commit** dropdown — the one place all four commit pathways live.

### Field editability

Every `FieldSpec` gains two optional flags:

```ts
{ kind: 'labeled', label: 'Assigned Units', accessor: d => d.assigned_units,
  editable: false,
  readOnlyReason: 'Unit assignments come from the dispatch console.' }
```

- **Computed / joined fields** (assigned units, case linkages, district lookups, officer names from unit IDs) are `editable: false` and surface a tooltip explaining where to change them.
- **Direct scalar columns** (narrative, subject description, flags, custodian notes) are editable by default.
- **Signature fields** are always editable — generated at preview time, not from the record.
- **Agency header fields** (form number, revision, logo) are always locked.

### Commit pathways — one button, four actions

```ts
type CommitAction =
  | { kind: 'download'; filename: string }
  | { kind: 'attach';   recordType: 'case'|'incident'|'warrant'|'evidence'; recordId: number }
  | { kind: 'email';    to: string[]; cc?: string[]; subject: string; body: string }
  | { kind: 'print'    /* opens browser print dialog on the blob */ };
```

The commit dropdown only shows actions allowed for the current form + current user role.

| Form | Allowed commit actions |
|---|---|
| Warrant | download, attach-to-case, email, print |
| Citation | download, print, email-to-violator |
| Affidavit of Service | download, attach-to-serve-job, email-to-court, print |
| Invoice | download, email-to-client |
| BOLO | download, email-to-distribution-list, print |
| Patrol Tracking | download, email-to-client |

Role enforcement uses the existing `requireRole` middleware — e.g., only admins can `email-to-court`. No new permissions system.

### Write-back semantics — edits mutate the source record

The user explicitly chose "Full edits before commit, writes back to source record." That means editing a warrant in preview changes the warrant record. Implications:

- **Phase 1 — Save Draft:** writes edits via the record's existing update endpoint (`PATCH /api/warrants/:id`). Hits normal audit log, validation, permission checks. Sets a `pdf_draft_session_id` on the record so other users see "being edited by Ofc. Jones" via WebSocket.
- **Phase 2 — Commit:** executes the chosen action on top of the already-saved record.
- **There is no preview-only state.** Edits persist to the source record regardless of whether the user commits or cancels the PDF output.
- **Warning banner** above the commit row makes this visible: `⚠ Editing will update the Warrant record (WAR-0042). Use Cancel to discard.`
- **Cancel with unsaved changes** prompts `[Discard] [Save as Draft] [Keep Editing]`. Discard throws away React form state before any DB write — autosave only fires on explicit Save Draft or after 60s idle.

### Audit trail

Every edit made during a preview session writes an audit log entry tagged `pdf_preview_edit` with form type, record ID, user, and which fields changed. Command staff can filter audit log by `pdf_preview_edit` to see what was touched through the preview path vs. normal record edits. Preview-path edits show up in the record's History tab as `Ofc. Park edited probable_cause (PDF preview session)`.

### `pdf_artifacts` archive table — new

When a user picks **Attach to record**, the generated PDF is stored as an immutable artifact:

```sql
CREATE TABLE IF NOT EXISTS pdf_artifacts (
  id             INTEGER PRIMARY KEY,
  form_type      TEXT NOT NULL,        -- 'warrant', 'affidavit_service', etc.
  form_version   TEXT NOT NULL,        -- schema meta.revision at time of render
  record_type    TEXT NOT NULL,        -- 'case', 'incident', 'warrant', 'evidence'
  record_id      INTEGER NOT NULL,
  blob_path      TEXT NOT NULL,        -- path under server/uploads/pdf/…
  sha256         TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  created_by     INTEGER NOT NULL,
  title          TEXT
);
CREATE INDEX idx_pdf_artifacts_rec ON pdf_artifacts(record_type, record_id);
```

Attached PDFs appear under the record's Attachments tab. Unchanging — if source data later changes, the attached PDF stays as it was. This is how you get court-admissible "as of 2026-04-14 this is what the warrant said" artifacts.

### Commit-action implementations

- **Download:** blob → `URL.createObjectURL` → anchor click. Filename includes form number + record ID + date.
- **Print:** hidden iframe, `iframe.contentWindow.print()`. No server roundtrip.
- **Email:** `POST /api/pdf-engine/email` (new endpoint). Multipart: PDF blob + recipient list + subject + body. Server attaches via existing SMTP transport. Rate-limited and audit-logged as `pdf_email_sent`.
- **Attach:** `POST /api/pdf-engine/artifacts`. Stores blob under `server/uploads/pdf/<form_type>/<yyyy>/<mm>/<sha256>.pdf`, inserts `pdf_artifacts` row.

### Performance budget

- Re-render on 400ms debounce after any field change.
- Target ≤200ms for a typical 2-page form. Benchmark: current v1 `recordPdfGenerator` generates a populated warrant in ~120ms on a 2022 M2 laptop. v2 must not regress by more than 25%.
- Iframe `<iframe src="blob:…pdf">` renders natively in Chrome, Safari, Edge. PDF.js fallback for older Firefox.

### Role gates summary

| Action | Required role / rule |
|---|---|
| Open preview | any role that can view the source record |
| Edit fields in preview | any role that can edit the source record |
| Commit: Download / Print | same as preview open |
| Commit: Attach to record | same as preview edit |
| Commit: Email (generic) | admin, manager |
| Commit: Email to court / external legal | admin only (configurable per form) |

## Migration order — 4 waves

### Wave 1 — Blank forms (6)

`incident_blank`, `person_blank`, `vehicle_blank`, `property_blank`, `citation_blank`, `field_interview_blank`.

No data, just lines and checkboxes. Already using `pdfTokens`. Zero legal-data-binding risk. Shakes out the engine against a safe surface.

### Wave 2 — Non-legal operational records (3)

`fleet`, `personnel`, `property`.

Real data binding, internal ops only. Exercises `adapters/v1Bridge.ts` and `visibleIf`.

### Wave 3 — Client-facing / business (4)

`invoice`, `proposal`, `patrol_tracking`, `bolo`.

Customer-visible, polish matters. Engine hardened by waves 1–2.

### Wave 4 — Legal documents (10)

`call`, `person`, `vehicle`, `citation`, `warrant`, `warrant_summary`, `evidence`, `affidavit_service`, `affidavit_non_service`, `service_log`.

Admissible in court. Only flipped after waves 1–3 have stabilized and each form has passed visual review by command staff / process-server staff.

### Gating rule

No form in wave N flips until **all** forms in wave N-1 have been live for 7 days with zero `pdf_engine_fallback` audit log entries.

## Testing strategy

### Layer 1 — Primitive unit tests

`engine/primitives.test.ts` with Vitest. Null/undefined/long-text/page-edge-crossing for every primitive. Catches the "undefined prints literally" class of bugs at the primitive level.

### Layer 2 — Per-form byte snapshot tests

```
client/src/utils/pdf/v2/forms/__tests__/
  fixtures/
    call.minimal.json       ← required fields only
    call.typical.json       ← realistic populated call
    call.kitchen-sink.json  ← every conditional triggered
    call.null-heavy.json    ← many nulls, empty arrays
    warrant.typical.json
    citation.kitchen-sink.json
    ...
  callForm.snapshot.test.ts ← base64 byte snapshot per fixture
```

### Layer 3 — Visual regression for legal forms (Wave 4 only)

CI runs `pdf-to-png-converter` over snapshot outputs and commits PNGs. PR reviewer sees side-by-side image diff. Overkill for fleet reports, worth it for warrants.

### Layer 4 — Parity tests during migration

Nightly CI job generates same fixture through both v1 and v2 for forms currently flipping. Records byte hash + PNG comparison. Drift shows up in a Slack-style notification before production does.

## Rollout sequence per form

1. Schema PR lands. Unit + snapshot tests pass.
2. Visual review of snapshot PNG by owner (tech lead for ops, command staff for legal).
3. Merge and deploy. v2 live but flag `false` — nothing changes in production.
4. Admin enables flag in `/admin/pdf-engine`.
5. 7-day observation window. `pdf_engine_fallback` must stay at 0.
6. Form graduates. Wave counter advances.

## Definition of done

The project is complete when:

- All 23 forms run v2 in production ≥30 days with zero fallback events.
- "Retire v1 for this form" has been clicked for every form.
- `recordPdfGenerator.ts`, `blankFormPdfGenerator.ts`, `servePdfGenerator.ts`, `patrolTrackingPdfGenerator.ts`, `invoicePdfGenerator.ts`, `proposalPdf.ts` are deleted.
- `pdfTokens.ts`, `pdfFormHelpers.ts`, `pdfAssets.ts`, `pdfImageHelpers.ts` are absorbed into `pdf/v2/engine/` or deleted.
- `pdf/` is the only PDF code tree in the repo.
- `PdfReviewModal` is the universal entry point — every "Generate PDF" button on every page opens it.
- `pdf_artifacts` table contains at least one attachment for every form type, produced through the preview path.
- No call site in the client references `doc.save()` directly. (Lint rule enforces.)

## Risks

- **Visual drift between v1 and v2 during migration.** Mitigation: Layer 4 parity tests, per-form stakeholder review before flag flip.
- **v2 rendering bug in production.** Mitigation: facade catch-and-fallback to v1, `pdf_engine_fallback` audit log, admin "Revert All" button.
- **Schema ergonomics prove too rigid.** Mitigation: hybrid design means any stuck conditional can escape to a render callback without invalidating the rest of the form.
- **`recordPdfGenerator.ts` has behavior not captured in v1 data interfaces.** Mitigation: `v1Bridge.ts` reuses the existing interfaces verbatim; if we discover undocumented behavior, that form goes back one wave.
- **Callback escape-hatch abuse.** Mitigation: `RenderContext` does not expose `doc`. Lint rule can enforce that `forms/*` never imports `jspdf` directly.
- **Snapshot churn.** Mitigation: fixtures are deterministic; schema changes produce intentional snapshot diffs, which the reviewer must approve in the PR.
- **Preview edits silently mutate source records.** This is by-design but dangerous — an officer might not realize closing the preview has already persisted the narrative edit. Mitigation: prominent warning banner above commit row, audit-log tag `pdf_preview_edit`, History tab annotation `(PDF preview session)`.
- **Editing a record via preview while another user edits it via normal record detail page** — last-write-wins could clobber changes. Mitigation: `pdf_draft_session_id` column + WebSocket broadcast of "record is being edited in PDF preview by X." Normal record editor surfaces the same banner.
- **400ms debounce re-render performance.** Long forms (warrant with 10+ offenses, incident with kitchen-sink data) could exceed the 200ms target. Mitigation: incremental render (render only dirty pages), or cap the preview at 2-page visible window with full render on scroll.
- **`pdf_artifacts` disk growth.** Every attached PDF lives on the VPS forever. A 200KB warrant × 10k warrants/year = 2GB/year. Mitigation: retention policy configurable per form type (default 7 years for legal forms, 1 year for internal ops); archive to cold storage beyond that horizon.

## Open questions for implementation planning

1. Does `audit_log` already have a generic `category` field, or do we need a migration? (Likely yes; used by other features.)
2. Is there a preferred visual-regression library already in the repo, or is `pdf-to-png-converter` a new dependency?
3. Does the admin UI follow the Spillman column-table pattern from `/admin/*` pages, or does it warrant a new layout?
4. Where should `getSchema(type)` live — a registry map in `pdf/v2/index.ts` or one-file-per-form with a common export barrel?
5. Does the existing SMTP transport support multipart attachments, or does the new `POST /api/pdf-engine/email` need to stand up its own? (Likely has it — the system already sends leave-request and HR notification emails.)
6. Is there an existing signature-pad component in the repo we can reuse, or do we pull in a library like `react-signature-canvas`?
7. Should `pdf_draft_session_id` also block concurrent edits on the normal record detail page, or just surface a banner?
8. What is the retention policy default for legal-form artifacts — 7 years, indefinite, or configurable per form type in admin?
9. Is there a file-upload path under `server/uploads/` already used by case evidence that we can model `pdf_artifacts` blob storage after?

These will be answered during the implementation planning step.
