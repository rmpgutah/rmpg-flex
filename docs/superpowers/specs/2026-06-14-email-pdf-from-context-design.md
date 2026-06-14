# Email PDF from Context — Design

**Date:** 2026-06-14
**Status:** Implemented (with the front-end correction below)
**Subsystem:** Email (MS Graph) + PDF generation
**Approach:** B — real multipart `/api/pdf-engine/email` handler over a shared send core
**Linkage scope:** Persist + surface on record

---

## ⚠️ Implementation correction (2026-06-14, discovered during execution)

This spec's front-end premise was **wrong**: it assumed the "Email PDF" button was
reachable app-wide via `PdfReviewModal` / `CommitDropdown`. During Task 8 we verified
that **`PdfReviewModal` is rendered in zero production pages** (its only importer is a
type-only import in `CommitDropdown`, which is itself never rendered). The entire
`PdfReviewModal → CommitDropdown → PdfEmailDialog → emailBlob` UI was dead code.

The **live** PDF component is **`PrintRecordButton`** (`recordPdfGenerator.ts`), rendered
on warrant / citation / property / call / evidence / fleet / personnel pages, keyed by
`entityType`/`entityId`. It had no email action.

**Corrected front-end approach (built):**
- `emailBlob` extracted from the dead `PdfReviewModal` to `client/src/utils/emailPdf.ts`.
- An **Email action added to the live `PrintRecordButton`** (reuses `PdfEmailDialog` + the
  existing blob pipeline `fetchFreshRecordData → enrichWithImages → generateRecordPdfBlobUrl`),
  posting to `/api/pdf-engine/email` with `record_type=entityType`, `record_id=entityId`.
  Every `PrintRecordButton` instance now has Email.
- `<EmailedDocuments>` surfaces are mounted only where there is a **detail panel** with a
  stable selected record + `entityType`/`entityId`: **warrant, evidence, fleet, personnel**.
  The case/incident/evidence-property mounts from the first pass were removed (no email path).
- Per-row/inline `PrintRecordButton`s (citation, property/business, call) get the Email action
  but **no surface and no record-link** (they lack `entityType`/`entityId` and aren't detail
  panels) — deferred, noted as a fast-follow.

The **backend** (migration 0118, `enqueueAndSend`, `POST /api/pdf-engine/email`,
`GET /api/email/by-record`) is exactly as designed below and unaffected by the correction.

---

## Problem

The app generates PDFs (reports, forms, affidavits) through `PdfReviewModal`, whose
commit menu offers **download / attach / email / print**. The **Email PDF** button
(`PdfEmailDialog` → `emailBlob()`) posts a multipart PDF to `/api/pdf-engine/email`.

That endpoint is a **stub**: `src/routes/stubs.ts` returns
`501 { sent: false, error: 'Email delivery not configured' }`, and `emailBlob()`
throws on `!res.ok`. So the feature is dead — the operator gets an honest "not
configured" error, but there is no way to email a generated PDF from the record it
belongs to.

Meanwhile a complete, durable send path **already exists** and is unused by this
flow: `POST /api/email/send` enqueues to `email_outbox`, attempts Graph
`/me/sendMail` synchronously, returns `202` + cron-drained exponential-backoff
retry on failure, and **already accepts base64 attachments**. The fix is to feed
that existing pipe, not to build new Graph plumbing.

## Goal

Make **Email PDF** actually send via Microsoft Graph, through the existing durable
outbox, and **tie each sent PDF to its originating record** (case / incident /
warrant / evidence) so it is visible on that record afterward.

## Non-goals (explicitly out of scope)

- Consolidating the two `graphFetch` implementations
  (`src/utils/msGraph.ts:133` vs the module-private one in `src/routes/email.ts:447`)
  onto one. Noted as future cleanup; this PR preserves current send behavior byte-for-byte.
- Fixing the sibling **attach-to-record** button (`/api/pdf-artifacts`, also a stub).
- Wiring the unused `email_audit_log` table / the missing `GET /email/audit` route
  that `AdminEmailAuditTab` reads. (Adjacent dead code; tracked separately.)
- Mail-merge / bulk send (was a separate candidate capability).

---

## Ground truth (verified 2026-06-14)

| Thing | State |
|---|---|
| `POST /api/email/send` | **Real.** JSON in → `email_outbox` → sync Graph send → `202`+cron retry. Accepts base64 `attachments[]`. |
| `email_outbox` (mig 0082) | `id, owner_user_id, payload, attempts, last_error, next_attempt_at, status, created_at, sent_at`. **No record-link columns.** |
| `drainEmailOutbox` / `drainScheduledEmails` | Live in `src/index.ts` `scheduled()` cron. Backoff `1m→5m→30m→2h→6h`, fail after 5. |
| Templates / signatures / contacts | Already built (`/templates` CRUD, `/signature`, `/people`, `/contacts/search`). |
| `/api/pdf-engine/email` | **Stub** → `501`. (`src/routes/stubs.ts`, mounted `routesConfig.ts:551`.) |
| `/api/pdf-artifacts` | **Stub** → `501`. (Out of scope.) |
| `email_audit_log` (mig 0082) | Table exists; **nothing writes it, no read route.** (Out of scope.) |
| `email_links` | Keyed by Graph message-id, which `sendMail` does not return — **not usable** for outbound linkage. |
| `graphFetch` | Two impls: `src/utils/msGraph.ts:133` (KV-cached, refresh-aware) and a private one in `email.ts:447` that `/email/send` uses. |
| `apiPostForm` | Exists at `client/src/hooks/useApi.ts:427` — canonical multipart helper (correct API origin + auth). |
| Migration high-water | **0117** (CLAUDE.md "0093" is stale). New migration → `0118`. |
| `PdfReviewModal` props | `recordType?: 'case'|'incident'|'warrant'|'evidence'`, `recordId?: number`. UI already shipped. |

---

## Architecture & module boundaries

### New: `src/utils/emailSend.ts`
Extract the existing enqueue-then-send core out of the `/email/send` handler
**verbatim**, including the `graphFetch` it currently calls (so behavior is
unchanged), exposing:

```ts
// Pure helpers (unit-tested):
export function parseAddrList(raw: string | string[] | undefined): GraphRecipient[];
export function mapAttachments(atts: SendAttachment[] | undefined): GraphAttachment[];
export function buildSendPayload(input: SendInput): GraphSendPayload;

// Side-effecting core (DB + Graph):
export async function enqueueAndSend(
  env: Bindings,
  ownerUserId: number,
  payload: GraphSendPayload,
  opts?: { recordType?: string; recordId?: number },
): Promise<{ outboxId: number; status: 'sent' | 'queued'; error?: string }>;
```

`enqueueAndSend` INSERTs the outbox row (now including `record_type` / `record_id`),
attempts the synchronous Graph send, and on failure sets `attempts=1` +
`next_attempt_at` so the cron drain retries — identical to today's `/email/send`.

### New: `src/routes/pdfEngine.ts`
A real Hono router replacing the `stubs` mount for `/api/pdf-engine` in
`src/routesConfig.ts:551`. Implements `POST /email` only (room to grow). Thin:
parse multipart → validate → build payload → `enqueueAndSend`.

### Refactor: `src/routes/email.ts`
`POST /send` (and the schedule-send enqueue at ~line 2203) delegate to
`enqueueAndSend` / `buildSendPayload` from the new util. No external behavior change.

### Refactor: `src/routesConfig.ts`
Replace `{ prefix: '/api/pdf-engine', router: stubs, ... }` with the new
`pdfEngine` router (auth: `'required'`).

---

## Data flow

```
PdfReviewModal (recordType, recordId)
  └─ emailBlob(blob, formType, to[], cc[], subject, body, recordType, recordId)
       • append record_type / record_id to FormData
       • switch bare fetch('/api/pdf-engine/email')  →  apiPostForm('/pdf-engine/email', fd)
         POST /api/pdf-engine/email   (multipart: pdf, to[], cc[], subject, body[HTML],
                                       form_type, record_type, record_id)
  └─ pdfEngine.POST('/email')
       • validate: ≥1 valid recipient, pdf present, raw PDF ≤ 3 MB
       • read pdf bytes → base64 → Graph fileAttachment
         { name: `${title||form_type}.pdf`, contentType: 'application/pdf', contentBytes }
       • buildSendPayload({ to, cc, subject, body(HTML), attachments:[pdf] })
       • enqueueAndSend(env, userId, payload, { recordType, recordId })
  └─ email_outbox row (record_type, record_id set) → sync Graph send → 202+cron retry
```

## Persistence & record linkage

**Migration `0118_email_outbox_record_link.sql`:**
```sql
ALTER TABLE email_outbox ADD COLUMN record_type TEXT;
ALTER TABLE email_outbox ADD COLUMN record_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_email_outbox_record
  ON email_outbox(record_type, record_id);
```
- D1 cannot `IF NOT EXISTS` on `ADD COLUMN`; the route reconciles via a boot-time
  `columnExists()` check (existing pattern), and the columns are **applied directly
  to live D1 `785de7ae`** after merge (deploy migration step is `continue-on-error`).
- `email_outbox` is 9 columns — far below the 100-column cap; not a watched table.
- Normal compose sends leave the columns NULL; only context emails populate them.
  The outbox row is the durable record (recipients + subject + attachment name live
  in `payload`; status / sent_at on the row). No new table.

## Surfacing on the record

**`GET /api/email/by-record?recordType=<t>&recordId=<id>`** (in `email.ts`, auth
required): selects `email_outbox` rows where `record_type`/`record_id` match, parses
each `payload` JSON, returns:
```ts
{ outboxId, sentAt, createdAt, sentByUserId, sentByUsername /* LEFT JOIN users
  ON users.id = owner_user_id; null if user deleted */,
  to: string[], subject, attachmentName, status: 'pending'|'sent'|'failed', error }
```

**Client `<EmailedDocuments recordType recordId />`** — reusable component, pure-black
theme table (header 9px `font-semibold`, rows 11px), columns: When · Sent by ·
To · Document · Status badge (sent=green / queued=gold / failed=red). Mounted on the
case, incident, warrant, and evidence detail pages. A single reusable component, four
mount points.

## Error handling

- **Validation (pdfEngine):** ≥1 valid recipient (else `400`), `pdf` present (else
  `400`), **raw PDF ≤ 3 MB** (else `413` with a clear message — do **not** silently
  queue a doomed oversized send). Rationale: Graph's simple `/me/sendMail` caps the
  total request near 4 MB and base64 inflates ~33%, so 3 MB raw (~4 MB encoded) is the
  safe inline ceiling; generated police forms are far smaller. Larger uploads (Graph
  upload-session) are out of scope.
- **Send outcome:** `200 { sent, outboxId }` on immediate success, `202 { queued,
  outboxId, error }` on transient Graph failure (both are `res.ok`, so the button
  reports success/queued). Inherits the outbox hard-fail-after-5 with `last_error`
  surfaced via the existing `/outbox` introspection.
- **Not configured:** if no refresh token is stored, Graph send fails → row stays
  pending → operator sees "queued". (Matches `/email/send` behavior; acceptable.)

## Testing

- **Worker (vitest, pure):** `tests/emailSend.test.ts` — `parseAddrList`,
  `buildSendPayload`, and the multipart→payload mapping (recipient parsing, HTML
  body, attachment shape, record-link passthrough). Worker has no Miniflare suite
  yet, so pure-function coverage is the bar (matches `tests/roboflowAlpr.test.ts`).
- **Client (vitest):** extend the existing `PdfReviewModal.test.tsx` to assert
  `record_type` / `record_id` are appended and `apiPostForm` is used.
- **Manual:** send a real PDF through a configured mailbox → confirm an `email_outbox`
  row with `record_type`/`record_id` set, the Graph send (or queued+drain), and that
  it renders in `<EmailedDocuments>` on the record.

## Deploy notes

- Bump `client/public/sw.js` `CACHE_NAME`.
- Apply `0118` directly to live D1 `785de7ae` after merge; verify with
  `pragma_table_info('email_outbox')`.
- Ship via feature-branch PR → `pr-tests.yml` → user merges → `deploy.yml`.

## Build sequence (for the implementation plan)

1. `migrations/0118_email_outbox_record_link.sql`.
2. Extract `src/utils/emailSend.ts` from `email.ts`; refactor `/email/send` +
   schedule-send to use it (no behavior change) — verify typecheck + existing flow.
3. Add boot/first-use `columnExists()` reconcile for the new columns.
4. New `src/routes/pdfEngine.ts` `POST /email`; remap the prefix in `routesConfig.ts`.
5. `GET /api/email/by-record` in `email.ts`.
6. Client: extend `emailBlob()` (record fields + `apiPostForm`); thread props in
   `PdfReviewModal`.
7. Client: `<EmailedDocuments>` component + 4 mount points.
8. Tests (worker pure + client) + SW bump.
