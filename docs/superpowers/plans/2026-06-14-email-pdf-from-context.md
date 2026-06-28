# Email PDF from Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the app-wide "Email PDF" button actually send a generated PDF via Microsoft Graph through the existing durable outbox, tied to its originating record (case / incident / warrant / evidence) and surfaced on that record.

**Architecture:** A new real `POST /api/pdf-engine/email` multipart handler (replacing a `501` stub) base64s the uploaded PDF into a Graph `fileAttachment` and routes it through `enqueueAndSend()` — the existing outbox enqueue + synchronous Graph send + cron-retry core, exported from `src/routes/email.ts` and given an optional `recordType`/`recordId`. Pure payload helpers move to `src/utils/emailSend.ts` (unit-tested). A `GET /api/email/by-record` endpoint and a reusable `<EmailedDocuments>` component surface the sends on each record.

**Tech Stack:** Cloudflare Workers + Hono + D1 (`src/`), React 18 + Vite + Tailwind (`client/`), vitest. Microsoft Graph `/me/sendMail`.

**Spec:** `docs/superpowers/specs/2026-06-14-email-pdf-from-context-design.md`

**Plan refinements over the spec (intentional):**
- `enqueueAndSend` lives in `src/routes/email.ts` (exported), NOT in the util, because it depends on that module's private `graphFetch`/`ensureValidToken`. Only the *pure, dependency-free* helpers move to `src/utils/emailSend.ts`. This keeps `/email/send`'s send behavior byte-identical (a stated non-goal: don't swap its token mechanism).
- The scheduled-send drain is left unchanged (it needs no record linkage); only `/email/send` is refactored onto the shared core.
- `recordType` is treated as an opaque string end-to-end (more record types exist via `PrintRecordButton` than the 4 we mount). The invariant: the `recordType` string used at send time must equal the one passed to `<EmailedDocuments>` on the same page.

---

## File structure

| File | Responsibility | Action |
|---|---|---|
| `migrations/0118_email_outbox_record_link.sql` | Add `record_type`/`record_id` to `email_outbox` | Create |
| `src/utils/emailSend.ts` | Pure Graph-payload helpers (`parseAddrList`, `mapAttachments`, `buildSendPayload`) + types | Create |
| `tests/emailSend.test.ts` | Unit tests for the pure helpers | Create |
| `src/routes/email.ts` | Import helpers from util; add exported `enqueueAndSend` + `ensureOutboxRecordColumns`; refactor `/send`; add `GET /by-record` | Modify |
| `src/routes/pdfEngine.ts` | Real `POST /email` multipart handler | Create |
| `tests/pdfEngine.test.ts` | Unit tests for `bytesToBase64` + `sanitizeAttachmentName` | Create |
| `src/routesConfig.ts` | Mount `pdfEngine` at `/api/pdf-engine` (replace stub) | Modify |
| `client/src/components/PdfReviewModal.tsx` | Thread `recordType`/`recordId` into `emailBlob`; switch to `apiPostForm` | Modify |
| `client/src/components/__tests__/PdfReviewModal.test.tsx` | Test `emailBlob` record-field passthrough | Modify |
| `client/src/components/EmailedDocuments.tsx` | Reusable "Emailed Documents" surface | Create |
| `client/src/pages/CaseManagementPage.tsx` `IncidentsPage.tsx` `WarrantsPage.tsx` `EvidencePropertyPage.tsx` | Mount `<EmailedDocuments>` | Modify |
| `client/public/sw.js` | Bump `CACHE_NAME` | Modify |

---

## Task 0: Setup — make the test suite runnable

**Why:** This worktree's `node_modules` is missing deps (`unpdf`), so the husky pre-commit hook's `vitest run` fails on 8 warrant suites — which would block every commit below.

- [ ] **Step 1: Install dependencies**

Run: `npm install`
Expected: completes; `node_modules/unpdf` now exists.

- [ ] **Step 2: Verify the worker suite is green**

Run: `npm test`
Expected: all suites pass (no more `Cannot find package 'unpdf'`). If a small number of *pre-existing* unrelated failures remain, note them — they are not caused by this work and the hook can be bypassed with `--no-verify` for unrelated red, but prefer a green baseline.

---

## Task 1: Migration — record-link columns on `email_outbox`

**Files:**
- Create: `migrations/0118_email_outbox_record_link.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Link outbound sends to their originating record (case / incident / warrant /
-- evidence) so "Email PDF from context" sends can be surfaced on that record.
-- D1 cannot IF NOT EXISTS an ADD COLUMN; src/routes/email.ts reconciles these at
-- runtime via columnExists() (ensureOutboxRecordColumns), and they must also be
-- applied directly to live D1 785de7ae after merge (deploy migration step is
-- continue-on-error). email_outbox is far below the 100-column cap.
ALTER TABLE email_outbox ADD COLUMN record_type TEXT;
ALTER TABLE email_outbox ADD COLUMN record_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_email_outbox_record
  ON email_outbox(record_type, record_id);
```

- [ ] **Step 2: Apply to local D1**

Run: `npm run migrate:local`
Expected: applies cleanly (or, on re-run, the `ADD COLUMN` errors are tolerable — the index line is idempotent).

- [ ] **Step 3: Commit**

```bash
git add migrations/0118_email_outbox_record_link.sql
git commit -m "feat(email): migration 0118 — record_type/record_id on email_outbox"
```

---

## Task 2: Pure send helpers — `src/utils/emailSend.ts` (TDD)

**Files:**
- Create: `src/utils/emailSend.ts`
- Test: `tests/emailSend.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/emailSend.test.ts
import { describe, it, expect } from 'vitest';
import { parseAddrList, mapAttachments, buildSendPayload } from '../src/utils/emailSend';

describe('parseAddrList', () => {
  it('splits a comma/semicolon string and drops blanks/non-addresses', () => {
    expect(parseAddrList('a@x.com, b@y.com ; ,notanemail')).toEqual([
      { emailAddress: { address: 'a@x.com' } },
      { emailAddress: { address: 'b@y.com' } },
    ]);
  });
  it('accepts an array', () => {
    expect(parseAddrList(['a@x.com', '', 'c@z.com'])).toEqual([
      { emailAddress: { address: 'a@x.com' } },
      { emailAddress: { address: 'c@z.com' } },
    ]);
  });
  it('returns [] for undefined', () => {
    expect(parseAddrList(undefined)).toEqual([]);
  });
});

describe('mapAttachments', () => {
  it('maps base64 attachments to Graph fileAttachments and caps at 20', () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ name: `f${i}.pdf`, contentBytes: 'AA' }));
    const out = mapAttachments(many);
    expect(out).toHaveLength(20);
    expect(out[0]).toEqual({
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: 'f0.pdf', contentType: 'application/octet-stream', contentBytes: 'AA',
    });
  });
  it('drops entries with no contentBytes', () => {
    expect(mapAttachments([{ name: 'x.pdf' }])).toEqual([]);
  });
});

describe('buildSendPayload', () => {
  it('builds an HTML payload with recipients and an attachment', () => {
    const p = buildSendPayload({
      to: 'a@x.com', cc: ['b@y.com'], subject: 'Hi', body: '<b>hi</b>', isHtml: true,
      attachments: [{ name: 'doc.pdf', contentType: 'application/pdf', contentBytes: 'QQ' }],
    });
    expect(p.message.subject).toBe('Hi');
    expect(p.message.body).toEqual({ contentType: 'HTML', content: '<b>hi</b>' });
    expect(p.message.toRecipients).toEqual([{ emailAddress: { address: 'a@x.com' } }]);
    expect(p.message.ccRecipients).toEqual([{ emailAddress: { address: 'b@y.com' } }]);
    expect(p.message.attachments?.[0].name).toBe('doc.pdf');
    expect(p.saveToSentItems).toBe(true);
  });
  it('defaults subject, uses Text when isHtml===false, omits empty attachments, clamps importance', () => {
    const p = buildSendPayload({ to: 'a@x.com', isHtml: false, importance: 'bogus' });
    expect(p.message.subject).toBe('(no subject)');
    expect(p.message.body.contentType).toBe('Text');
    expect(p.message.attachments).toBeUndefined();
    expect(p.message.importance).toBe('normal');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/emailSend.test.ts`
Expected: FAIL — `Cannot find module '../src/utils/emailSend'`.

- [ ] **Step 3: Create the helper module**

```ts
// src/utils/emailSend.ts
// Pure, dependency-free helpers for composing Microsoft Graph /me/sendMail
// payloads. Extracted so BOTH /api/email/send (src/routes/email.ts) and the
// PDF-from-context handler (src/routes/pdfEngine.ts) build identical payloads.
// The side-effecting enqueueAndSend() stays in email.ts because it depends on
// that module's graphFetch/token machinery (kept unchanged on purpose).

export interface GraphRecipient { emailAddress: { address: string } }
export interface SendAttachment { name?: string; contentType?: string; contentBytes?: string }
export interface GraphAttachment {
  '@odata.type': string; name: string; contentType: string; contentBytes: string;
}
export interface SendInput {
  to?: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  subject?: string;
  body?: string;
  isHtml?: boolean;
  attachments?: SendAttachment[];
  importance?: string;
  requestReadReceipt?: boolean;
  requestDeliveryReceipt?: boolean;
  replyTo?: string | string[];
}
export interface GraphSendPayload {
  message: {
    subject: string;
    body: { contentType: 'HTML' | 'Text'; content: string };
    toRecipients: GraphRecipient[];
    ccRecipients: GraphRecipient[];
    bccRecipients: GraphRecipient[];
    attachments?: GraphAttachment[];
    importance: string;
    isReadReceiptRequested: boolean;
    isDeliveryReceiptRequested: boolean;
    replyTo?: GraphRecipient[];
  };
  saveToSentItems: boolean;
}

/** Accept "a@x.com, b@y.com" OR ["a@x.com","b@y.com"]; drop blanks/non-addresses. */
export function parseAddrList(raw: string | string[] | undefined): GraphRecipient[] {
  const parts = Array.isArray(raw) ? raw : (raw || '').split(/[,;]/);
  return parts
    .map((s) => String(s).trim())
    .filter((s) => s && /@/.test(s))
    .map((address) => ({ emailAddress: { address } }));
}

/** Map the compose UI's base64 attachment list to Graph fileAttachments (cap 20). */
export function mapAttachments(atts: SendAttachment[] | undefined): GraphAttachment[] {
  return (atts || [])
    .filter((a) => a && a.contentBytes)
    .slice(0, 20)
    .map((a) => ({
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: (a.name || 'attachment').slice(0, 255),
      contentType: a.contentType || 'application/octet-stream',
      contentBytes: a.contentBytes as string,
    }));
}

/** Compose a Graph /me/sendMail payload. Mirrors the original /email/send body. */
export function buildSendPayload(input: SendInput): GraphSendPayload {
  const attachments = mapAttachments(input.attachments);
  const importance = ['low', 'normal', 'high'].includes(input.importance || '')
    ? (input.importance as string) : 'normal';
  const replyToList = parseAddrList(input.replyTo);
  return {
    message: {
      subject: input.subject || '(no subject)',
      body: {
        contentType: input.isHtml === false ? 'Text' : 'HTML',
        content: input.body || '',
      },
      toRecipients: parseAddrList(input.to),
      ccRecipients: parseAddrList(input.cc),
      bccRecipients: parseAddrList(input.bcc),
      ...(attachments.length ? { attachments } : {}),
      importance,
      isReadReceiptRequested: !!input.requestReadReceipt,
      isDeliveryReceiptRequested: !!input.requestDeliveryReceipt,
      ...(replyToList.length ? { replyTo: replyToList } : {}),
    },
    saveToSentItems: true,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/emailSend.test.ts`
Expected: PASS (8 assertions across 3 describes).

- [ ] **Step 5: Commit**

```bash
git add src/utils/emailSend.ts tests/emailSend.test.ts
git commit -m "feat(email): extract pure Graph send-payload helpers to utils/emailSend"
```

---

## Task 3: Refactor `email.ts` onto the shared core + `enqueueAndSend`

**Files:**
- Modify: `src/routes/email.ts`

Context: today `/email/send` (lines ~781–857) and the schedule drain (~2186–2205) declare local `parseAddrList`/`mapAttachments` and inline the outbox enqueue+send. We replace the local helpers with imports, add an exported `enqueueAndSend`, and refactor `/send` to use both. `graphFetch` (line ~447) and `ensureValidToken` stay put.

- [ ] **Step 1: Import the helpers and `columnExists`**

In the import block (the `getDb` import is at line ~24), change:
```ts
import { getDb, queryFirst, query, execute } from '../utils/db';
```
to:
```ts
import { getDb, queryFirst, query, execute, columnExists } from '../utils/db';
import {
  parseAddrList, mapAttachments, buildSendPayload,
  type SendAttachment, type SendInput,
} from '../utils/emailSend';
```

- [ ] **Step 2: Delete the now-duplicated local helpers**

Remove the local `parseAddrList` (the `// ─── Send / reply / forward` block, ~lines 758–764), the local `interface SendAttachment { ... }` (~line 766), and the local `mapAttachments` (~lines 769–779). The schedule drain and `/send` will use the imported versions.

- [ ] **Step 3: Add `ensureOutboxRecordColumns` + exported `enqueueAndSend`**

Insert immediately above the `email.post('/send', ...)` handler:
```ts
// Runtime reconcile for the 0118 record-link columns (deploy migration step is
// continue-on-error; this guarantees the columns exist before we write them).
let _outboxRecordColsEnsured = false;
async function ensureOutboxRecordColumns(db: D1Database): Promise<boolean> {
  if (_outboxRecordColsEnsured) return true;
  if (!(await columnExists(db, 'email_outbox', 'record_type'))) {
    try { await execute(db, 'ALTER TABLE email_outbox ADD COLUMN record_type TEXT'); } catch { /* race/exists */ }
    try { await execute(db, 'ALTER TABLE email_outbox ADD COLUMN record_id INTEGER'); } catch { /* race/exists */ }
  }
  _outboxRecordColsEnsured = await columnExists(db, 'email_outbox', 'record_type');
  return _outboxRecordColsEnsured;
}

// Shared send core: enqueue to the durable outbox, attempt a synchronous Graph
// send, and on failure leave the row pending for the cron drain to retry.
// Used by both POST /send and the PDF-from-context handler.
export async function enqueueAndSend(
  env: Bindings,
  ownerUserId: number,
  payload: unknown,
  opts: { recordType?: string | null; recordId?: number | null } = {},
): Promise<{ outboxId: number; status: 'sent' | 'queued'; error?: string }> {
  const json = JSON.stringify(payload);
  const wantLink = opts.recordType != null && opts.recordId != null;
  const hasRecordCols = wantLink ? await ensureOutboxRecordColumns(env.DB) : false;

  const queued = hasRecordCols
    ? await execute(env.DB,
        "INSERT INTO email_outbox (owner_user_id, payload, status, record_type, record_id) VALUES (?, ?, 'pending', ?, ?)",
        ownerUserId, json, opts.recordType, opts.recordId)
    : await execute(env.DB,
        "INSERT INTO email_outbox (owner_user_id, payload, status) VALUES (?, ?, 'pending')",
        ownerUserId, json);
  const outboxId = queued.meta.last_row_id as number;

  try {
    const res = await graphFetch(env, '/me/sendMail', { method: 'POST', body: json });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const err = `Graph ${res.status}: ${text.slice(0, 200)}`;
      await execute(env.DB,
        "UPDATE email_outbox SET attempts = 1, last_error = ?, next_attempt_at = datetime('now','localtime','+1 minute') WHERE id = ?",
        err, outboxId);
      return { outboxId, status: 'queued', error: err };
    }
    await execute(env.DB,
      "UPDATE email_outbox SET status = 'sent', sent_at = datetime('now','localtime') WHERE id = ?",
      outboxId);
    return { outboxId, status: 'sent' };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed';
    await execute(env.DB,
      "UPDATE email_outbox SET attempts = 1, last_error = ?, next_attempt_at = datetime('now','localtime','+1 minute') WHERE id = ?",
      msg, outboxId);
    return { outboxId, status: 'queued', error: msg };
  }
}
```

- [ ] **Step 4: Refactor the `/send` handler to use the shared core**

Replace the entire `email.post('/send', async (c) => { ... })` body (the current ~781–857 block) with:
```ts
email.post('/send', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json().catch(() => ({})) as SendInput;
  if (!parseAddrList(body.to).length) return c.json({ error: 'At least one recipient required' }, 400);
  const payload = buildSendPayload(body);
  const r = await enqueueAndSend(c.env, userId, payload);
  if (r.status === 'sent') return c.json({ success: true, outboxId: r.outboxId });
  return c.json({ success: false, queued: true, outboxId: r.outboxId, error: r.error }, 202);
});
```
(Response shapes — `{ success, outboxId }` on send, `202 { success:false, queued:true, outboxId, error }` on transient failure — are identical to before.)

- [ ] **Step 5: Verify the worker typechecks and the suite is green**

Run: `npm run typecheck`
Expected: no errors. (If `SendAttachment` is referenced elsewhere in `email.ts`, e.g. the schedule drain's `JSON.parse(r.attachments) as SendAttachment[]`, the imported type covers it.)

Run: `npm test`
Expected: all green, including `tests/emailSend.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/routes/email.ts
git commit -m "refactor(email): /send delegates to exported enqueueAndSend; record-link aware"
```

---

## Task 4: Real `POST /api/pdf-engine/email` handler (TDD on pure bits)

**Files:**
- Create: `src/routes/pdfEngine.ts`
- Test: `tests/pdfEngine.test.ts`
- Modify: `src/routesConfig.ts`

- [ ] **Step 1: Write failing tests for the pure helpers**

```ts
// tests/pdfEngine.test.ts
import { describe, it, expect } from 'vitest';
import { bytesToBase64, sanitizeAttachmentName } from '../src/routes/pdfEngine';

describe('bytesToBase64', () => {
  it('encodes bytes to base64 (matches btoa for small input)', () => {
    const bytes = new Uint8Array([72, 105]); // "Hi"
    expect(bytesToBase64(bytes)).toBe('SGk=');
  });
  it('handles >32KB without overflow', () => {
    const big = new Uint8Array(40_000).fill(65); // 'A'
    const out = bytesToBase64(big);
    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(50_000);
  });
});

describe('sanitizeAttachmentName', () => {
  it('builds a safe .pdf filename from a form type', () => {
    expect(sanitizeAttachmentName('FI-9/Use of Force')).toBe('FI-9_Use of Force.pdf');
  });
  it('falls back to document.pdf', () => {
    expect(sanitizeAttachmentName('')).toBe('document.pdf');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/pdfEngine.test.ts`
Expected: FAIL — `Cannot find module '../src/routes/pdfEngine'`.

- [ ] **Step 3: Create the router**

```ts
// src/routes/pdfEngine.ts
// Real handler for POST /api/pdf-engine/email — "Email PDF from context".
// Replaces the no-op 501 stub. Accepts the multipart PDF the PdfReviewModal
// produces, base64s it into a Graph fileAttachment, and routes it through the
// SAME durable outbox as /api/email/send (enqueueAndSend) — inheriting retry,
// backoff, and (via record_type/record_id) record linkage.

import { Hono } from 'hono';
import type { Env } from '../types';
import { requireRole } from '../middleware/auth';
import { enqueueAndSend } from './email';
import { buildSendPayload, parseAddrList, type SendInput } from '../utils/emailSend';

const pdfEngine = new Hono<Env>();

const MAX_PDF_BYTES = 3 * 1024 * 1024; // 3 MB raw — see design §Error handling

// base64-encode bytes in chunks (avoids String.fromCharCode call-stack overflow).
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

// Build a safe attachment filename from the form type.
export function sanitizeAttachmentName(formType: string): string {
  const base = (formType || 'document').replace(/[^\w.\- ]+/g, '_').slice(0, 251);
  return `${base || 'document'}.pdf`;
}

// Field-operational roles (mirrors the alpr.ts / intel.ts gate).
const operational = requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher');

pdfEngine.post('/email', operational, async (c) => {
  const userId = c.get('userId');
  let form: FormData;
  try { form = await c.req.formData(); }
  catch { return c.json({ sent: false, error: 'Expected multipart/form-data with a `pdf` file' }, 400); }

  const fileEntry = form.get('pdf');
  const file = fileEntry && typeof fileEntry === 'object' && 'arrayBuffer' in (fileEntry as object)
    ? (fileEntry as File) : null;
  if (!file) return c.json({ sent: false, error: 'Missing pdf (multipart field: pdf)' }, 400);

  const to = form.getAll('to').map(String);
  const cc = form.getAll('cc').map(String);
  const subject = String(form.get('subject') || '');
  const body = String(form.get('body') || '');
  const formType = String(form.get('form_type') || 'document');
  const recordType = form.get('record_type') ? String(form.get('record_type')) : null;
  const recordIdRaw = form.get('record_id');
  const recordIdNum = recordIdRaw != null && String(recordIdRaw) !== '' ? Number(recordIdRaw) : NaN;
  const recordId = Number.isFinite(recordIdNum) ? recordIdNum : null;

  if (!parseAddrList(to).length) return c.json({ sent: false, error: 'At least one recipient required' }, 400);

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength > MAX_PDF_BYTES) {
    return c.json({
      sent: false,
      error: `PDF too large (${(bytes.byteLength / 1048576).toFixed(1)} MB; max 3 MB for inline email)`,
    }, 413);
  }

  const input: SendInput = {
    to, cc,
    subject: subject || formType,
    body, isHtml: true,
    attachments: [{
      name: sanitizeAttachmentName(formType),
      contentType: 'application/pdf',
      contentBytes: bytesToBase64(bytes),
    }],
  };
  const payload = buildSendPayload(input);
  const r = await enqueueAndSend(c.env, userId, payload, { recordType, recordId });
  if (r.status === 'sent') return c.json({ sent: true, outboxId: r.outboxId });
  return c.json({ sent: false, queued: true, outboxId: r.outboxId, error: r.error }, 202);
});

export default pdfEngine;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/pdfEngine.test.ts`
Expected: PASS (4 assertions).

- [ ] **Step 5: Mount the router (replace the stub)**

In `src/routesConfig.ts`, add to the import block (near the other `./routes/*` imports, e.g. after the `stubs` import at line ~143):
```ts
import pdfEngine from './routes/pdfEngine';
```
Then change line ~551 from:
```ts
  { prefix: '/api/pdf-engine', router: stubs, auth: 'required' },
```
to:
```ts
  { prefix: '/api/pdf-engine', router: pdfEngine, auth: 'required' },
```

- [ ] **Step 6: Verify typecheck + suite**

Run: `npm run typecheck && npm test`
Expected: green.

- [ ] **Step 7: Commit**

```bash
git add src/routes/pdfEngine.ts tests/pdfEngine.test.ts src/routesConfig.ts
git commit -m "feat(email): real POST /api/pdf-engine/email — Graph send via shared outbox"
```

---

## Task 5: `GET /api/email/by-record` surfacing endpoint

**Files:**
- Modify: `src/routes/email.ts`

- [ ] **Step 1: Add the route**

Insert near the other `email.get` send-side routes (e.g. just after the `email.get('/outbox', ...)` handler, ~line 868):
```ts
// Outbound PDFs/emails sent FROM a given record (case/incident/warrant/evidence).
// Reads the durable outbox by the 0118 record-link columns and parses each
// payload to a clean surface shape. Distinct from /links/by-entity, which lists
// INBOUND emails (email_links, keyed by Graph message-id).
email.get('/by-record', async (c) => {
  const recordType = c.req.query('recordType');
  const recordId = c.req.query('recordId');
  if (!recordType || !recordId) return c.json({ items: [] });
  if (!(await columnExists(c.env.DB, 'email_outbox', 'record_type'))) return c.json({ items: [] });

  const rows = await query<{
    id: number; owner_user_id: number; payload: string; status: string;
    created_at: string; sent_at: string | null; last_error: string | null;
    full_name: string | null; username: string | null;
  }>(c.env.DB,
    `SELECT o.id, o.owner_user_id, o.payload, o.status, o.created_at, o.sent_at, o.last_error,
            u.full_name, u.username
       FROM email_outbox o
       LEFT JOIN users u ON u.id = o.owner_user_id
      WHERE o.record_type = ? AND o.record_id = ?
      ORDER BY o.id DESC LIMIT 100`,
    recordType, Number(recordId));

  const items = rows.map((r) => {
    let to: string[] = []; let subject = ''; let attachmentName: string | null = null;
    try {
      const p = JSON.parse(r.payload) as {
        message?: {
          subject?: string;
          toRecipients?: Array<{ emailAddress?: { address?: string } }>;
          attachments?: Array<{ name?: string }>;
        };
      };
      to = (p.message?.toRecipients || []).map((x) => x.emailAddress?.address || '').filter(Boolean);
      subject = p.message?.subject || '';
      attachmentName = p.message?.attachments?.[0]?.name || null;
    } catch { /* leave defaults */ }
    return {
      outboxId: r.id, status: r.status, createdAt: r.created_at, sentAt: r.sent_at,
      error: r.last_error, sentByUserId: r.owner_user_id,
      sentBy: r.full_name || r.username || `user #${r.owner_user_id}`,
      to, subject, attachmentName,
    };
  });
  return c.json({ items });
});
```

- [ ] **Step 2: Verify typecheck + suite**

Run: `npm run typecheck && npm test`
Expected: green.

- [ ] **Step 3: Commit**

```bash
git add src/routes/email.ts
git commit -m "feat(email): GET /email/by-record — outbound sends per record"
```

---

## Task 6: Client — thread record fields into `emailBlob` + use `apiPostForm` (TDD)

**Files:**
- Modify: `client/src/components/PdfReviewModal.tsx`
- Modify: `client/src/components/__tests__/PdfReviewModal.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `client/src/components/__tests__/PdfReviewModal.test.tsx`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as useApi from '../../hooks/useApi';
import { emailBlob } from '../PdfReviewModal';

describe('emailBlob', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('posts to /pdf-engine/email via apiPostForm with record fields', async () => {
    const spy = vi.spyOn(useApi, 'apiPostForm').mockResolvedValue({} as never);
    const blob = new Blob(['%PDF-1.4'], { type: 'application/pdf' });
    await emailBlob(blob, 'FI-9', ['a@x.com'], ['b@y.com'], 'Subj', '<p>hi</p>', 'case', 42);

    expect(spy).toHaveBeenCalledTimes(1);
    const [endpoint, fd] = spy.mock.calls[0];
    expect(endpoint).toBe('/pdf-engine/email');
    expect(fd.get('form_type')).toBe('FI-9');
    expect(fd.getAll('to')).toEqual(['a@x.com']);
    expect(fd.get('record_type')).toBe('case');
    expect(fd.get('record_id')).toBe('42');
    expect(fd.get('pdf')).toBeInstanceOf(Blob);
  });

  it('omits record fields when not provided', async () => {
    const spy = vi.spyOn(useApi, 'apiPostForm').mockResolvedValue({} as never);
    const blob = new Blob(['%PDF-1.4'], { type: 'application/pdf' });
    await emailBlob(blob, 'FI-9', ['a@x.com'], [], 'Subj', 'hi');
    const fd = spy.mock.calls[0][1];
    expect(fd.get('record_type')).toBeNull();
    expect(fd.get('record_id')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd client && npx vitest run src/components/__tests__/PdfReviewModal.test.tsx`
Expected: FAIL — `emailBlob` still posts via `fetch` to `/api/pdf-engine/email` (no `apiPostForm` call) and ignores record fields.

- [ ] **Step 3: Rewrite `emailBlob` and its call site**

In `client/src/components/PdfReviewModal.tsx`, add to the imports at the top:
```ts
import { apiPostForm } from '../hooks/useApi';
```
Replace the entire `export async function emailBlob(...) { ... }` (currently ~lines 57–90) with:
```ts
/** POST the PDF blob + email fields to /api/pdf-engine/email via the canonical
 *  multipart helper (correct API origin + auth; the old bare fetch used the wrong
 *  token key). recordType/recordId tie the send to its record for surfacing. */
export async function emailBlob(
  blob: Blob,
  formType: string,
  to: string[],
  cc: string[],
  subject: string,
  body: string,
  recordType?: string,
  recordId?: number,
): Promise<void> {
  const fd = new FormData();
  fd.append('form_type', formType);
  to.forEach((t) => fd.append('to', t));
  cc.forEach((v) => fd.append('cc', v));
  fd.append('subject', subject);
  fd.append('body', body);
  if (recordType) fd.append('record_type', recordType);
  if (recordId != null) fd.append('record_id', String(recordId));
  fd.append('pdf', blob, `${formType}.pdf`);
  await apiPostForm('/pdf-engine/email', fd);
}
```
Then update the call in `handleEmailSend` (~line 210) from:
```ts
      await emailBlob(blob, schema.meta.formNumber, to, cc, subject, body);
```
to:
```ts
      await emailBlob(blob, schema.meta.formNumber, to, cc, subject, body, recordType, recordId);
```
(`recordType` and `recordId` are already in scope — they're props of `PdfReviewModal`.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd client && npx vitest run src/components/__tests__/PdfReviewModal.test.tsx`
Expected: PASS.

- [ ] **Step 5: Verify client typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/PdfReviewModal.tsx client/src/components/__tests__/PdfReviewModal.test.tsx
git commit -m "feat(email): emailBlob posts via apiPostForm + threads record_type/record_id"
```

---

## Task 7: Client — `<EmailedDocuments>` surface component

**Files:**
- Create: `client/src/components/EmailedDocuments.tsx`

- [ ] **Step 1: Create the component**

```tsx
// client/src/components/EmailedDocuments.tsx
// "Emailed Documents" — outbound PDFs/emails sent FROM this record, via
// GET /api/email/by-record. Mirrors the <FileAttachments entityType entityId>
// interface and sits beside it on record detail panels. Distinct from
// <LinkedEmailsSection> (inbound, Graph-linked correspondence).
import { useEffect, useState } from 'react';
import { apiFetch } from '../hooks/useApi';

interface SentDoc {
  outboxId: number;
  status: 'pending' | 'sent' | 'failed';
  createdAt: string;
  sentAt: string | null;
  error: string | null;
  sentBy: string;
  to: string[];
  subject: string;
  attachmentName: string | null;
}
interface Props { recordType: string; recordId: number | string; title?: string; }

const STATUS: Record<SentDoc['status'], { label: string; cls: string }> = {
  sent:    { label: 'Sent',   cls: 'text-green-400 border-green-900' },
  pending: { label: 'Queued', cls: 'text-[#d4a017] border-[#5a4a10]' },
  failed:  { label: 'Failed', cls: 'text-red-400 border-red-900' },
};

export default function EmailedDocuments({ recordType, recordId, title = 'Emailed Documents' }: Props) {
  const [items, setItems] = useState<SentDoc[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (recordId == null || recordId === '') return;
    setLoading(true);
    apiFetch<{ items: SentDoc[] }>(
      `/email/by-record?recordType=${encodeURIComponent(recordType)}&recordId=${encodeURIComponent(String(recordId))}`,
    )
      .then((d) => setItems(d.items || []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [recordType, recordId]);

  return (
    <div className="border border-[#232323] bg-[#0b0b0b]">
      <div className="px-3 py-2 text-[#d4a017] text-xs font-semibold uppercase border-b border-[#232323]">
        {title}{items.length ? ` (${items.length})` : ''}
      </div>
      {loading ? (
        <div className="px-3 py-2 text-gray-500 text-[11px]">Loading…</div>
      ) : items.length === 0 ? (
        <div className="px-3 py-2 text-gray-500 text-[11px] italic">No documents emailed from this record yet.</div>
      ) : (
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-gray-400 text-[9px] uppercase border-b border-[#1a1a1a]">
              <th className="text-left px-3 py-[3px] font-semibold">When</th>
              <th className="text-left px-3 py-[3px] font-semibold">Sent by</th>
              <th className="text-left px-3 py-[3px] font-semibold">To</th>
              <th className="text-left px-3 py-[3px] font-semibold">Document</th>
              <th className="text-left px-3 py-[3px] font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => {
              const s = STATUS[it.status] ?? STATUS.pending;
              return (
                <tr key={it.outboxId} className="border-b border-[#141414]">
                  <td className="px-3 py-[2px] text-gray-300">{(it.sentAt || it.createdAt || '').replace('T', ' ').slice(0, 16)}</td>
                  <td className="px-3 py-[2px] text-gray-300">{it.sentBy}</td>
                  <td className="px-3 py-[2px] text-gray-300" title={it.to.join(', ')}>{it.to.join(', ') || '—'}</td>
                  <td className="px-3 py-[2px] text-gray-300">{it.attachmentName || it.subject || '—'}</td>
                  <td className="px-3 py-[2px]">
                    <span className={`inline-block border px-1 ${s.cls}`} title={it.error || ''}>{s.label}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify client typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/EmailedDocuments.tsx
git commit -m "feat(email): <EmailedDocuments> record surface component"
```

---

## Task 8: Mount `<EmailedDocuments>` on the four record detail pages

**Files:**
- Modify: `client/src/pages/CaseManagementPage.tsx`
- Modify: `client/src/pages/IncidentsPage.tsx`
- Modify: `client/src/pages/WarrantsPage.tsx`
- Modify: `client/src/pages/EvidencePropertyPage.tsx`

**Invariant:** the `recordType` literal used here must equal what `PdfReviewModal` passes at send time on the same page. Use `case` / `incident` / `warrant` / `evidence`.

- [ ] **Step 1: CaseManagementPage** — add the import:
```tsx
import EmailedDocuments from '../components/EmailedDocuments';
```
Find the existing `<FileAttachments entityType="case" entityId={String(selected.id)} />` (~line 1414) and add directly after it:
```tsx
<EmailedDocuments recordType="case" recordId={selected.id} />
```

- [ ] **Step 2: IncidentsPage** — add the import:
```tsx
import EmailedDocuments from '../components/EmailedDocuments';
```
Locate the `<FileAttachments ... />` usage for the selected incident (grep `FileAttachments` in this file; the selected record is `selectedIncident`). Add directly after it:
```tsx
<EmailedDocuments recordType="incident" recordId={selectedIncident.id} />
```

- [ ] **Step 3: WarrantsPage** — add the import:
```tsx
import EmailedDocuments from '../components/EmailedDocuments';
```
Find `<LinkedEmailsSection entityType="warrant" entityId={selectedWarrant.id} />` (~line 2474) and add directly after it:
```tsx
<EmailedDocuments recordType="warrant" recordId={selectedWarrant.id} />
```

- [ ] **Step 4: EvidencePropertyPage** — add the import:
```tsx
import EmailedDocuments from '../components/EmailedDocuments';
```
In the detail panel for the `selected` item (the `info` detail tab; `selected` is the state at ~line 80), add:
```tsx
{selected && <EmailedDocuments recordType="evidence" recordId={selected.id} />}
```

- [ ] **Step 5: Verify each page passes `recordType`/`recordId` to `PdfReviewModal`**

For each of the four pages, confirm the `<PdfReviewModal ... />` (or the `PrintRecordButton`/wrapper that renders it) is given `recordType` matching the literal above and `recordId` = the selected record id, AND that `allowedActions` includes `'email'`. If a page renders `PdfReviewModal` without these props, add them — otherwise its emailed PDFs won't be linked or surfaced. Run: `grep -n "PdfReviewModal\|allowedActions\|recordType" client/src/pages/<Page>.tsx` per page.

- [ ] **Step 6: Verify client typecheck + build**

Run: `cd client && npx tsc --noEmit && npx vite build`
Expected: typecheck clean; build succeeds.

- [ ] **Step 7: Commit**

```bash
git add client/src/pages/CaseManagementPage.tsx client/src/pages/IncidentsPage.tsx client/src/pages/WarrantsPage.tsx client/src/pages/EvidencePropertyPage.tsx
git commit -m "feat(email): surface <EmailedDocuments> on case/incident/warrant/evidence records"
```

---

## Task 9: Service-worker cache bump + full verification

**Files:**
- Modify: `client/public/sw.js`

- [ ] **Step 1: Bump the cache name**

Open `client/public/sw.js`, find the `const CACHE_NAME = 'rmpg-flex-vNNN'` (or similar) line, and increment the version number (e.g. `v942` → `v943`). Run `grep -n "CACHE_NAME" client/public/sw.js` to find the exact current value.

- [ ] **Step 2: Full verification (all CI gates locally)**

Run each and confirm the expected result:
```bash
npm run typecheck                       # worker tsc — no errors
npm test                                # worker vitest — all green (incl. emailSend, pdfEngine)
cd client && npx tsc --noEmit           # client tsc — no errors
cd client && npx vitest run             # client vitest — all green (incl. PdfReviewModal)
cd client && npx vite build             # client build — succeeds
```

- [ ] **Step 3: Commit**

```bash
git add client/public/sw.js
git commit -m "chore(email): bump SW cache for Email-PDF-from-context"
```

- [ ] **Step 4: Push branch + open PR**

```bash
git push -u origin claude/friendly-fermat-1f4743
gh pr create --title "feat(email): Email PDF from context — real Graph send + record surfacing" --body "<summary + 'apply migration 0118 to live D1 785de7ae after merge' note>"
```

---

## Post-merge (manual, documented in the PR body)

1. **Apply migration 0118 to live D1** `785de7ae` via the Cloudflare D1 API (deploy migration step is `continue-on-error`):
   `ALTER TABLE email_outbox ADD COLUMN record_type TEXT;`
   `ALTER TABLE email_outbox ADD COLUMN record_id INTEGER;`
   `CREATE INDEX IF NOT EXISTS idx_email_outbox_record ON email_outbox(record_type, record_id);`
   Verify with `pragma_table_info('email_outbox')`.
   (The runtime `ensureOutboxRecordColumns` is a safety net, but apply explicitly.)
2. **Manual smoke (browser, since WAF blocks curl):** open a case/incident/warrant/evidence record with a configured mailbox, generate a PDF, "Email PDF" to a test address → expect success/queued; confirm an `email_outbox` row with `record_type`/`record_id` set; confirm it renders in the record's **Emailed Documents** panel.

---

## Self-review

**Spec coverage:**
- Real multipart `/api/pdf-engine/email` over shared `enqueueAndSend` → Tasks 3, 4. ✅
- `record_type`/`record_id` persistence + runtime reconcile → Tasks 1, 3. ✅
- Surfacing endpoint + reusable component + 4 mounts → Tasks 5, 7, 8. ✅
- `apiPostForm` switch + record-field passthrough → Task 6. ✅
- Pure-helper unit tests + client test → Tasks 2, 4, 6. ✅
- 3 MB cap / `413`, `202` queued semantics → Task 4. ✅
- SW bump, live-D1 apply, manual smoke → Task 9 + Post-merge. ✅
- Non-goals (graphFetch consolidation, pdf-artifacts, audit-log) → untouched. ✅

**Type consistency:** `enqueueAndSend(env, ownerUserId, payload, opts)` returns `{ outboxId, status: 'sent'|'queued', error? }` and is called identically in Task 4 and the refactored `/send` (Task 3). `SendInput` / `buildSendPayload` / `parseAddrList` / `mapAttachments` defined in Task 2 and consumed unchanged in Tasks 3, 4. `EmailedDocuments` `SentDoc` shape matches the `GET /by-record` JSON in Task 5. `emailBlob(blob, formType, to, cc, subject, body, recordType?, recordId?)` signature consistent between Task 6 definition and the Task 6 call site.

**Placeholder scan:** No TBD/TODO; every code step shows full code; commands have expected output. The only "find the line" instructions are in Task 8 (megafile mounts) — bounded by exact anchor strings (`<FileAttachments entityType="case" ...>`, `<LinkedEmailsSection entityType="warrant" ...>`) and the named selected-record variable per page.
