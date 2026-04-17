# Email System Enhancement Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Harden the existing Graph+SMTP email subsystem, add FTS5 search and an inbound rules engine, and wire inbound email into the CAD/RMS data graph (auto-linking, email-to-CFS tip line, PII redaction on external forward).

**Architecture:** Three logical phases stacked as separate commits in one mega-PR. Phase 1 touches sending/audit only. Phase 2 adds tables and a rule engine invoked from the poller. Phase 3 adds auto-linking and redaction. Each phase ships its own tests; `vitest` is the server test runner (see `server/package.json`).

**Tech Stack:** TypeScript / Express 5 / better-sqlite3 (with FTS5) / React / vitest / `marked` + `sanitize-html` (NOT DOMPurify — it's stubbed in this repo per `server/package.json` overrides).

---

## Pre-flight notes

- Working branch: the current `claude/unruffled-brown` worktree.
- `tsx` is the server runtime. Never `ts-node`.
- Run tests with `cd server && npx vitest run <file>`.
- Deploy is NOT part of this plan. Stop at "all tests green, committed".
- `auditLog(req, action, entityType, entityId, detailsOrBefore?, afterOrDetails?)` writes to `activity_log`. Use `'email'` as `entityType` and Graph message id (string) as `entityId`.
- **DDL style rule** (CLAUDE.md gotcha #42): issue every `CREATE TABLE` / `CREATE INDEX` / `CREATE TRIGGER` / `CREATE VIRTUAL TABLE` via its own `db.prepare('...').run()`. Do NOT use better-sqlite3's bulk multi-statement shortcut method — the Edit-tool security hook will reject it. Wrap multi-step DDL in `db.transaction(() => { db.prepare(...).run(); db.prepare(...).run(); })()` if atomicity matters.
- `calls_for_service.source` already accepts `'email'` (`server/src/routes/dispatch/calls.ts:299`).

---

## Phase 1 — Polish & harden

### Task 1.0: Document existing email tables (safety net)

**Why:** `email_cache`, `email_folders`, `email_links`, `scheduled_emails` exist on prod but have no `CREATE TABLE` in source. Adds defensive idempotent DDL so fresh dev clones work.

**Files:**
- Modify: `server/src/models/database.ts` (insert block before the existing `addCol('email_cache', 'categories', ...)` line, currently at 3627).

**Step 1:** Open `database.ts`. Find `addCol('email_cache', 'categories', ...)` line. Insert ABOVE it:

```ts
// Defensive: these tables existed historically but had no CREATE in source.
db.prepare(`CREATE TABLE IF NOT EXISTS email_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  graph_id TEXT UNIQUE NOT NULL,
  conversation_id TEXT,
  folder_id TEXT,
  subject TEXT,
  from_address TEXT,
  from_name TEXT,
  to_addresses TEXT,
  cc_addresses TEXT,
  body_preview TEXT,
  body_html TEXT,
  has_attachments INTEGER DEFAULT 0,
  is_read INTEGER DEFAULT 0,
  is_flagged INTEGER DEFAULT 0,
  importance TEXT DEFAULT 'normal',
  received_at TEXT,
  sent_at TEXT,
  synced_at TEXT
)`).run();
db.prepare(`CREATE INDEX IF NOT EXISTS idx_email_cache_folder ON email_cache(folder_id)`).run();
db.prepare(`CREATE INDEX IF NOT EXISTS idx_email_cache_received ON email_cache(received_at DESC)`).run();
db.prepare(`CREATE INDEX IF NOT EXISTS idx_email_cache_conv ON email_cache(conversation_id)`).run();

db.prepare(`CREATE TABLE IF NOT EXISTS email_folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  graph_id TEXT UNIQUE NOT NULL,
  display_name TEXT,
  parent_folder_id TEXT,
  total_count INTEGER DEFAULT 0,
  unread_count INTEGER DEFAULT 0,
  synced_at TEXT
)`).run();

db.prepare(`CREATE TABLE IF NOT EXISTS email_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email_graph_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  created_by INTEGER,
  created_at TEXT
)`).run();
db.prepare(`CREATE INDEX IF NOT EXISTS idx_email_links_email ON email_links(email_graph_id)`).run();
db.prepare(`CREATE INDEX IF NOT EXISTS idx_email_links_entity ON email_links(entity_type, entity_id)`).run();

db.prepare(`CREATE TABLE IF NOT EXISTS scheduled_emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  to_addresses TEXT NOT NULL,
  cc_addresses TEXT,
  bcc_addresses TEXT,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  attachments TEXT,
  scheduled_at TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  sent_at TEXT,
  error_message TEXT,
  created_by INTEGER NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
)`).run();
db.prepare(`CREATE INDEX IF NOT EXISTS idx_scheduled_emails_status ON scheduled_emails(status, scheduled_at)`).run();
```

**Step 2:** Typecheck: `cd server && npx tsc --noEmit` — should show no NEW errors (28 pre-existing `@types/express` errors are expected).

**Step 3:** Boot sanity-check: `cd server && npx tsx -e "import('./src/models/database').then(m => { m.initDatabase(); console.log('OK'); })"`. Expected: prints `OK`.

**Step 4:** Commit.
```bash
git add server/src/models/database.ts
git commit -m "chore(db): document existing email_cache/folders/links/scheduled_emails tables"
```

---

### Task 1.1: Install sanitizer deps

**Files:** `server/package.json`

**Step 1:** Install.
```bash
cd server && npm install marked sanitize-html --save --legacy-peer-deps
npm install @types/sanitize-html --save-dev --legacy-peer-deps
```

**Step 2:** Verify `package.json` got both `marked` and `sanitize-html` under `dependencies`. Do not pin versions further — use whatever npm resolved.

**Step 3:** Commit.
```bash
git add server/package.json server/package-lock.json
git commit -m "chore(email): add marked + sanitize-html for safe markdown rendering"
```

---

### Task 1.2: Safe markdown renderer with test

**Files:**
- Create: `server/src/utils/emailMarkdown.ts`
- Create: `server/src/__tests__/emailMarkdown.test.ts`

**Step 1 — Write the failing test first:**

```ts
// server/src/__tests__/emailMarkdown.test.ts
import { describe, it, expect } from 'vitest';
import { renderEmailMarkdown } from '../utils/emailMarkdown';

describe('renderEmailMarkdown', () => {
  it('wraps in a full HTML document', () => {
    const out = renderEmailMarkdown('hello');
    expect(out).toMatch(/^<!DOCTYPE html>/);
    expect(out).toContain('<body');
  });

  it('renders bold and italic', () => {
    const out = renderEmailMarkdown('**bold** *italic*');
    expect(out).toContain('<strong>bold</strong>');
    expect(out).toContain('<em>italic</em>');
  });

  it('preserves safe http/https/mailto links', () => {
    expect(renderEmailMarkdown('[x](https://example.com)')).toContain('href="https://example.com"');
    expect(renderEmailMarkdown('[x](mailto:a@b.c)')).toContain('href="mailto:a@b.c"');
  });

  it('strips javascript: URLs', () => {
    const out = renderEmailMarkdown('[click](javascript:alert(1))');
    expect(out).not.toContain('javascript:');
  });

  it('strips data: URLs', () => {
    const out = renderEmailMarkdown('[click](data:text/html,<script>)');
    expect(out).not.toContain('data:text/html');
  });

  it('strips inline script tags from raw html', () => {
    const out = renderEmailMarkdown('hi <script>alert(1)</script>');
    expect(out).not.toContain('<script');
  });

  it('escapes ampersands and angle brackets in plain text', () => {
    const out = renderEmailMarkdown('a & b <c>');
    expect(out).toContain('a &amp; b');
  });

  it('preserves newlines via breaks', () => {
    const out = renderEmailMarkdown('line1\nline2');
    expect(out.toLowerCase()).toContain('<br');
  });
});
```

**Step 2 — Run the test, verify failure:**
```bash
cd server && npx vitest run src/__tests__/emailMarkdown.test.ts
```
Expected: fails with "Cannot find module ../utils/emailMarkdown".

**Step 3 — Implement:**

```ts
// server/src/utils/emailMarkdown.ts
import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

// Convert markdown to safe HTML wrapped in a full document.
// Safe: rejects javascript:, vbscript:, and data: schemes on links.
export function renderEmailMarkdown(src: string): string {
  const raw = marked.parse(src, { async: false, breaks: true, gfm: true }) as string;
  const clean = sanitizeHtml(raw, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img']),
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: { img: ['http', 'https', 'cid'] },
    allowedAttributes: {
      a: ['href', 'name', 'target', 'rel'],
      img: ['src', 'alt', 'title', 'width', 'height'],
      '*': ['style'],
    },
    transformTags: {
      a: (tag, attribs) => ({
        tagName: 'a',
        attribs: { ...attribs, rel: 'noopener noreferrer', target: '_blank' },
      }),
    },
  });
  return [
    '<!DOCTYPE html><html><head><meta charset="utf-8"></head>',
    '<body style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.5;color:#1a1a1a;">',
    clean,
    '</body></html>',
  ].join('');
}
```

**Step 4 — Run the test, verify pass:**
```bash
cd server && npx vitest run src/__tests__/emailMarkdown.test.ts
```
Expected: all 8 tests pass.

**Step 5 — Commit:**
```bash
git add server/src/utils/emailMarkdown.ts server/src/__tests__/emailMarkdown.test.ts
git commit -m "feat(email): safe markdown renderer with sanitize-html"
```

---

### Task 1.3: Use the safe renderer in the poller

**Files:**
- Modify: `server/src/utils/emailPoller.ts:245-256` (markdown block in `processScheduledEmails`)

**Step 1:** Replace this block (inside `processScheduledEmails`):

```ts
      let bodyHtml = email.body;
      if (sigRow?.config_value) {
        bodyHtml += '\n\n--\n' + sigRow.config_value;
      }
      // Basic markdown conversion
      bodyHtml = bodyHtml
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>')
        .replace(/\n/g, '<br>');
      bodyHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.5;color:#1a1a1a;">${bodyHtml}</body></html>`;
```

with:

```ts
      let bodyMarkdown = email.body;
      if (sigRow?.config_value) {
        bodyMarkdown += '\n\n--\n' + sigRow.config_value;
      }
      const bodyHtml = renderEmailMarkdown(bodyMarkdown);
```

Add import at top of file:

```ts
import { renderEmailMarkdown } from './emailMarkdown';
```

**Step 2:** Typecheck: `cd server && npx tsc --noEmit` — no new errors.

**Step 3:** Run existing vitest suite: `cd server && npx vitest run`. Expected: all existing tests still pass.

**Step 4:** Commit.
```bash
git add server/src/utils/emailPoller.ts
git commit -m "refactor(email): use safe markdown renderer in poller"
```

---

### Task 1.4: Structured send result type (failing test first)

**Files:**
- Create: `server/src/__tests__/emailSender.test.ts`
- Modify: `server/src/utils/emailSender.ts`

**Step 1 — Write the failing test:**

```ts
// server/src/__tests__/emailSender.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../utils/msGraphClient', () => ({
  getGraphClient: vi.fn(),
  isAuthorized: vi.fn(),
  isEnabled: vi.fn(),
  getConfigValue: vi.fn(() => 'test@example.com'),
  CONFIG_KEYS: { mailbox: 'ms_email_mailbox' },
}));
vi.mock('../utils/smtpClient', () => ({
  sendViaSMTP: vi.fn(),
  isSmtpConfigured: vi.fn(),
}));
vi.mock('../models/database', () => ({
  getDb: () => ({ prepare: () => ({ get: () => ({ email: 'u@example.com', full_name: 'U' }) }) }),
}));

import { sendEmail } from '../utils/emailSender';
import * as graph from '../utils/msGraphClient';
import * as smtp from '../utils/smtpClient';

describe('sendEmail result shape', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns ok:false with reason=unknown when disabled', async () => {
    (graph.isEnabled as any).mockReturnValue(false);
    const res = await sendEmail({ to: 'a@b.c', subject: 's', html: '<p/>' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('unknown');
  });

  it('returns ok:true with transport=graph on graph success', async () => {
    (graph.isEnabled as any).mockReturnValue(true);
    (graph.isAuthorized as any).mockReturnValue(true);
    (graph.getGraphClient as any).mockResolvedValue({
      api: () => ({ post: vi.fn().mockResolvedValue({}) }),
    });
    const res = await sendEmail({ to: 'a@b.c', subject: 's', html: '<p/>' });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.transport).toBe('graph');
  });

  it('falls back to SMTP when graph throws and returns transport=smtp', async () => {
    (graph.isEnabled as any).mockReturnValue(true);
    (graph.isAuthorized as any).mockReturnValue(true);
    (graph.getGraphClient as any).mockResolvedValue({
      api: () => ({ post: vi.fn().mockRejectedValue(new Error('auth expired')) }),
    });
    (smtp.isSmtpConfigured as any).mockReturnValue(true);
    (smtp.sendViaSMTP as any).mockResolvedValue(undefined);
    const res = await sendEmail({ to: 'a@b.c', subject: 's', html: '<p/>' });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.transport).toBe('smtp');
  });

  it('returns ok:false with reason=auth_expired when graph fails & smtp not configured', async () => {
    (graph.isEnabled as any).mockReturnValue(true);
    (graph.isAuthorized as any).mockReturnValue(true);
    (graph.getGraphClient as any).mockResolvedValue({
      api: () => ({ post: vi.fn().mockRejectedValue(new Error('AuthenticationFailure: token expired')) }),
    });
    (smtp.isSmtpConfigured as any).mockReturnValue(false);
    const res = await sendEmail({ to: 'a@b.c', subject: 's', html: '<p/>' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('auth_expired');
  });
});
```

Run, verify fail.

**Step 2 — Replace `emailSender.ts`:**

```ts
// server/src/utils/emailSender.ts
// Unified Email Sender — Graph first, SMTP fallback, structured result.
import { getGraphClient, isAuthorized, isEnabled, getConfigValue, CONFIG_KEYS } from './msGraphClient';
import { sendViaSMTP, isSmtpConfigured } from './smtpClient';
import { getDb } from '../models/database';

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  cc?: string[];
  bcc?: string[];
  replyTo?: string;
  attachments?: Array<{ filename: string; content: Buffer | string; contentType?: string }>;
}

export type SendFailureReason = 'auth_expired' | 'network' | 'rejected_recipient' | 'quota' | 'unknown';
export type SendResult =
  | { ok: true; transport: 'graph' | 'smtp'; messageId?: string }
  | { ok: false; reason: SendFailureReason; detail: string };

function classifyError(err: any): SendFailureReason {
  const msg = String(err?.message || err || '').toLowerCase();
  if (/auth|token expired|unauthorized|401|forbidden|403/.test(msg)) return 'auth_expired';
  if (/network|econn|etimed|enotfound|dns/.test(msg)) return 'network';
  if (/recipient|invalid address|550|554/.test(msg)) return 'rejected_recipient';
  if (/quota|throttl|429|too many/.test(msg)) return 'quota';
  return 'unknown';
}

export async function sendEmail(options: SendEmailOptions): Promise<SendResult> {
  if (!isEnabled()) {
    console.log('[Email] Integration not enabled — skipping send');
    return { ok: false, reason: 'unknown', detail: 'Email integration not enabled' };
  }

  let lastGraphErr: any = null;
  if (isAuthorized()) {
    try {
      const client = await getGraphClient();
      const toRecipients = (Array.isArray(options.to) ? options.to : [options.to])
        .map(email => ({ emailAddress: { address: email.trim() } }));
      const ccRecipients = (options.cc || []).map(email => ({ emailAddress: { address: email.trim() } }));
      const bccRecipients = (options.bcc || []).map(email => ({ emailAddress: { address: email.trim() } }));

      let htmlContent = options.html;
      if (htmlContent && !htmlContent.toLowerCase().includes('<html')) {
        htmlContent = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${htmlContent}</body></html>`;
      }

      const message: any = {
        subject: options.subject,
        body: { contentType: 'html', content: htmlContent },
        toRecipients,
      };
      if (ccRecipients.length) message.ccRecipients = ccRecipients;
      if (bccRecipients.length) message.bccRecipients = bccRecipients;
      if (options.replyTo) message.replyTo = [{ emailAddress: { address: options.replyTo } }];
      if (options.attachments?.length) {
        message.attachments = options.attachments.map(att => ({
          '@odata.type': '#microsoft.graph.fileAttachment',
          name: att.filename,
          contentType: att.contentType || 'application/octet-stream',
          contentBytes: Buffer.isBuffer(att.content) ? att.content.toString('base64') : Buffer.from(att.content).toString('base64'),
        }));
      }

      await client.api('/me/sendMail').post({ message, saveToSentItems: true });
      console.log(`[Email] Sent via Graph API to ${options.to}`);
      return { ok: true, transport: 'graph' };
    } catch (err: any) {
      lastGraphErr = err;
      console.error('[Email] Graph API send failed:', err.message);
    }
  }

  if (isSmtpConfigured()) {
    try {
      await sendViaSMTP(options);
      console.log(`[Email] Sent via SMTP fallback to ${options.to}`);
      return { ok: true, transport: 'smtp' };
    } catch (err: any) {
      console.error('[Email] SMTP fallback send failed:', err.message);
      return { ok: false, reason: classifyError(err), detail: err.message || 'SMTP send failed' };
    }
  }

  if (lastGraphErr) {
    return { ok: false, reason: classifyError(lastGraphErr), detail: lastGraphErr.message || 'Graph send failed' };
  }
  return { ok: false, reason: 'unknown', detail: 'No transport configured' };
}

export async function sendNotificationEmail(userId: number, title: string, body: string): Promise<SendResult> {
  try {
    const db = getDb();
    const user = db.prepare('SELECT email, full_name FROM users WHERE id = ?').get(userId) as { email: string; full_name: string } | undefined;
    if (!user?.email) return { ok: false, reason: 'rejected_recipient', detail: `No email for user ${userId}` };
    const mailbox = getConfigValue(CONFIG_KEYS.mailbox) || 'RMPG Flex';
    const html = buildNotificationHtml(title, body, user.full_name, mailbox);
    return await sendEmail({ to: user.email, subject: `[RMPG Flex] ${title}`, html });
  } catch (err: any) {
    return { ok: false, reason: 'unknown', detail: err.message || 'Notification failed' };
  }
}

function buildNotificationHtml(title: string, body: string, recipientName: string, senderAddress: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#0d1520;font-family:Segoe UI,Arial,sans-serif;">
<div style="max-width:600px;margin:0 auto;padding:24px;">
<div style="background:#141e2b;border:1px solid #1e3048;border-radius:2px;padding:24px;">
<div style="border-bottom:1px solid #1e3048;padding-bottom:16px;margin-bottom:16px;">
<h1 style="margin:0;font-size:16px;color:#d4a017;font-weight:600;">RMPG Flex</h1>
</div>
<p style="margin:0 0 8px;color:#8899aa;font-size:13px;">Hello ${escapeHtml(recipientName)},</p>
<h2 style="margin:0 0 12px;font-size:15px;color:#e2e8f0;font-weight:600;">${escapeHtml(title)}</h2>
<div style="color:#a0b0c0;font-size:13px;line-height:1.6;">${escapeHtml(body)}</div>
<div style="border-top:1px solid #1e3048;margin-top:24px;padding-top:16px;">
<p style="margin:0;color:#556677;font-size:11px;">This is an automated notification from RMPG Flex CAD/RMS. Sent from ${escapeHtml(senderAddress)}.</p>
</div></div></div></body></html>`;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
```

Run test, verify pass.

**Step 3 — Fix all callers.** Find them:
```bash
cd server && grep -rn "sendEmail\|sendNotificationEmail" src --include="*.ts" | grep -v __tests__ | grep -v emailSender.ts
```

For each caller that does `if (!sent)` or `if (sent)` on a boolean, change to `if (!result.ok)` / `if (result.ok)`. Expected callers: `emailPoller.ts` (line ~266), `notifications.ts` if present, anywhere calling `sendNotificationEmail`.

**Step 4 — Typecheck + all tests:**
```bash
cd server && npx tsc --noEmit
cd server && npx vitest run
```

**Step 5 — Commit:**
```bash
git add server/src/utils/emailSender.ts server/src/utils/emailPoller.ts server/src/__tests__/emailSender.test.ts
# plus any other caller files
git commit -m "refactor(email): structured SendResult type with error classification"
```

---

### Task 1.5: Email audit helper + wire into every send path

**Files:**
- Create: `server/src/utils/emailAudit.ts`
- Create: `server/src/__tests__/emailAudit.test.ts`
- Modify: `server/src/routes/email.ts` (every send path), `server/src/utils/emailPoller.ts` (scheduled delivery path)

**Step 1 — Failing test:**

```ts
// server/src/__tests__/emailAudit.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const runMock = vi.fn();
vi.mock('../models/database', () => ({
  getDb: () => ({ prepare: () => ({ run: runMock }) }),
}));
vi.mock('../utils/timeUtils', () => ({ localNow: () => '2026-04-14 10:00:00' }));

import { auditEmailSend } from '../utils/emailAudit';

describe('auditEmailSend', () => {
  beforeEach(() => runMock.mockClear());

  it('writes a row for SEND action with message id', () => {
    const req: any = { user: { userId: 1 }, ip: '127.0.0.1' };
    auditEmailSend(req, 'SEND', { to: ['a@b.c'], subject: 'Hello', messageId: 'abc123' });
    expect(runMock).toHaveBeenCalledTimes(1);
    const args = runMock.mock.calls[0];
    expect(args.some((a: any) => typeof a === 'string' && a.includes('abc123'))).toBe(true);
  });
});
```

Run, verify fail.

**Step 2 — Implement:**

```ts
// server/src/utils/emailAudit.ts
import type { Request } from 'express';
import { auditLog } from './auditLogger';

export type EmailAuditAction =
  | 'SEND' | 'REPLY' | 'REPLY_ALL' | 'FORWARD'
  | 'SCHEDULE_SEND' | 'SCHEDULED_DELIVERED' | 'SCHEDULED_FAILED'
  | 'DELETE' | 'MOVE';

export interface EmailAuditMeta {
  to?: string | string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  messageId?: string;
  transport?: 'graph' | 'smtp';
  linkedEntities?: Array<{ type: string; id: string | number }>;
  redactedFields?: string[];
  error?: string;
}

export function auditEmailSend(req: Request, action: EmailAuditAction, meta: EmailAuditMeta): void {
  const entityId = meta.messageId || 'n/a';
  const subject = (meta.subject || '').slice(0, 200);
  const to = Array.isArray(meta.to) ? meta.to.join(',') : (meta.to || '');
  const details: Record<string, any> = { action, to, subject };
  if (meta.cc?.length) details.cc = meta.cc;
  if (meta.bcc?.length) details.bcc = meta.bcc;
  if (meta.transport) details.transport = meta.transport;
  if (meta.linkedEntities?.length) details.links = meta.linkedEntities;
  if (meta.redactedFields?.length) details.redacted = meta.redactedFields;
  if (meta.error) details.error = meta.error;
  auditLog(req, action as any, 'email' as any, entityId, JSON.stringify(details));
}
```

Run test, verify pass.

**Step 3 — Wire into `email.ts`.** For each of these route handlers in `server/src/routes/email.ts`, add an `auditEmailSend` call AFTER the send succeeds (and one on failure with `error`):

| Line (approx) | Handler | Action |
|---|---|---|
| 630 | `POST /send` | `SEND` |
| 706 | `POST /messages/:id/reply` | `REPLY` |
| 727 | `POST /messages/:id/reply-all` | `REPLY_ALL` |
| 748 | `POST /messages/:id/forward` | `FORWARD` |
| 1135 | `POST /schedule` | `SCHEDULE_SEND` |

Pattern (example for `/send`):

```ts
const result = await sendEmail({...});
if (result.ok) {
  auditEmailSend(req, 'SEND', { to, cc, bcc, subject, messageId: result.messageId, transport: result.transport });
  return res.json({ success: true });
} else {
  auditEmailSend(req, 'SEND', { to, subject, error: `${result.reason}: ${result.detail}` });
  return res.status(502).json({ error: result.detail, reason: result.reason });
}
```

Add `import { auditEmailSend } from '../utils/emailAudit';` at top.

**Step 4 — Wire into `emailPoller.ts` scheduled delivery.** Replace the boolean-based success block with:

```ts
if (sent.ok) {
  db.prepare("UPDATE scheduled_emails SET status = 'sent', sent_at = ? WHERE id = ?").run(localNow(), email.id);
  auditLogSystem('SCHEDULED_DELIVERED' as any, 'email' as any, `scheduled:${email.id}`, JSON.stringify({ to: toList, subject: email.subject, transport: sent.transport }));
} else {
  const errMsg = `${sent.reason}: ${sent.detail}`;
  db.prepare("UPDATE scheduled_emails SET status = 'failed', error_message = ? WHERE id = ?").run(errMsg, email.id);
  auditLogSystem('SCHEDULED_FAILED' as any, 'email' as any, `scheduled:${email.id}`, errMsg);
}
```

Add `import { auditLogSystem } from './auditLogger';` at top.

**Step 5 — Run all tests:** `cd server && npx vitest run`. All green.

**Step 6 — Commit:**
```bash
git add server/src/utils/emailAudit.ts server/src/__tests__/emailAudit.test.ts server/src/routes/email.ts server/src/utils/emailPoller.ts
git commit -m "feat(email): audit every send path to activity_log"
```

---

### Task 1.6: Route-collision guard

**Step 1:** `cd server && npm run check:routes` — 0 duplicates. Fix if any.

---

### Task 1.7: Phase 1 checkpoint

**Step 1:** Full gate.
```bash
cd server && npx vitest run
cd client && npx tsc --noEmit
cd server && npx tsc --noEmit
cd server && npm run check:routes
```

**Step 2:** Tag with an empty commit.
```bash
git commit --allow-empty -m "checkpoint: Phase 1 (polish & harden) complete"
```

---

## Phase 2 — FTS5 search + rules engine

### Task 2.1: html_to_text SQL UDF

**Files:**
- Create: `server/src/models/sqliteFunctions.ts`
- Create: `server/src/__tests__/sqliteFunctions.test.ts`
- Modify: `server/src/models/database.ts` (register after `new Database(...)`)

**Step 1 — Failing test:**

```ts
// server/src/__tests__/sqliteFunctions.test.ts
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { registerSqliteFunctions } from '../models/sqliteFunctions';

describe('html_to_text', () => {
  const db = new Database(':memory:');
  registerSqliteFunctions(db);

  it('strips tags', () => {
    const r = db.prepare("SELECT html_to_text('<p>hello <b>world</b></p>') as t").get() as any;
    expect(r.t).toBe('hello world');
  });
  it('collapses whitespace', () => {
    const r = db.prepare("SELECT html_to_text('a\\n\\n\\n   b') as t").get() as any;
    expect(r.t).toBe('a b');
  });
  it('decodes entities', () => {
    const r = db.prepare("SELECT html_to_text('<p>a &amp; b</p>') as t").get() as any;
    expect(r.t).toBe('a & b');
  });
  it('handles null', () => {
    const r = db.prepare('SELECT html_to_text(NULL) as t').get() as any;
    expect(r.t).toBe('');
  });
});
```

Run, verify fail.

**Step 2 — Implement:**

```ts
// server/src/models/sqliteFunctions.ts
import type BetterSqlite3 from 'better-sqlite3';

export function registerSqliteFunctions(db: BetterSqlite3.Database): void {
  db.function('html_to_text', { deterministic: true }, (html: any) => {
    if (html == null) return '';
    return String(html)
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  });
}
```

Run test, verify pass.

**Step 3 — Wire into `database.ts`:** find the location where `db` is created (`new Database(dbPath)` near the top of the init function) and add immediately after:
```ts
import { registerSqliteFunctions } from './sqliteFunctions';
// ...
registerSqliteFunctions(db);
```

**Step 4 — Commit:**
```bash
git add server/src/models/sqliteFunctions.ts server/src/models/database.ts server/src/__tests__/sqliteFunctions.test.ts
git commit -m "feat(db): html_to_text SQL UDF for FTS body indexing"
```

---

### Task 2.2: FTS5 virtual table + triggers

**Files:** `server/src/models/database.ts`

**Step 1 — Insert after the `email_cache` `CREATE TABLE` block added in Task 1.0:**

```ts
// FTS5 external-content table for full-text search over email bodies
db.prepare(`CREATE VIRTUAL TABLE IF NOT EXISTS email_cache_fts USING fts5(
  subject, from_address, from_name, body_text,
  content='email_cache', content_rowid='id',
  tokenize='porter unicode61'
)`).run();

db.prepare(`CREATE TRIGGER IF NOT EXISTS email_cache_ai AFTER INSERT ON email_cache BEGIN
  INSERT INTO email_cache_fts(rowid, subject, from_address, from_name, body_text)
  VALUES (new.id, COALESCE(new.subject,''), COALESCE(new.from_address,''), COALESCE(new.from_name,''), html_to_text(new.body_html));
END`).run();

db.prepare(`CREATE TRIGGER IF NOT EXISTS email_cache_ad AFTER DELETE ON email_cache BEGIN
  INSERT INTO email_cache_fts(email_cache_fts, rowid, subject, from_address, from_name, body_text)
  VALUES ('delete', old.id, COALESCE(old.subject,''), COALESCE(old.from_address,''), COALESCE(old.from_name,''), html_to_text(old.body_html));
END`).run();

db.prepare(`CREATE TRIGGER IF NOT EXISTS email_cache_au AFTER UPDATE ON email_cache BEGIN
  INSERT INTO email_cache_fts(email_cache_fts, rowid, subject, from_address, from_name, body_text)
  VALUES ('delete', old.id, COALESCE(old.subject,''), COALESCE(old.from_address,''), COALESCE(old.from_name,''), html_to_text(old.body_html));
  INSERT INTO email_cache_fts(rowid, subject, from_address, from_name, body_text)
  VALUES (new.id, COALESCE(new.subject,''), COALESCE(new.from_address,''), COALESCE(new.from_name,''), html_to_text(new.body_html));
END`).run();

// Idempotent backfill — any rows already in email_cache that aren't indexed
db.prepare(`INSERT INTO email_cache_fts(rowid, subject, from_address, from_name, body_text)
  SELECT id, COALESCE(subject,''), COALESCE(from_address,''), COALESCE(from_name,''), html_to_text(body_html)
  FROM email_cache
  WHERE id NOT IN (SELECT rowid FROM email_cache_fts)`).run();
```

**Step 2 — Integration test:**

```ts
// server/src/__tests__/emailFts.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import Database from 'better-sqlite3';
import { registerSqliteFunctions } from '../models/sqliteFunctions';

describe('email_cache_fts', () => {
  const db = new Database(':memory:');
  beforeAll(() => {
    registerSqliteFunctions(db);
    db.prepare(`CREATE TABLE email_cache (id INTEGER PRIMARY KEY, subject TEXT, from_address TEXT, from_name TEXT, body_html TEXT)`).run();
    db.prepare(`CREATE VIRTUAL TABLE email_cache_fts USING fts5(subject,from_address,from_name,body_text,content='email_cache',content_rowid='id',tokenize='porter unicode61')`).run();
    db.prepare(`CREATE TRIGGER email_cache_ai AFTER INSERT ON email_cache BEGIN
      INSERT INTO email_cache_fts(rowid,subject,from_address,from_name,body_text)
      VALUES (new.id, COALESCE(new.subject,''), COALESCE(new.from_address,''), COALESCE(new.from_name,''), html_to_text(new.body_html));
    END`).run();
  });

  it('matches term in body_html via html_to_text', () => {
    db.prepare(`INSERT INTO email_cache (subject,from_address,from_name,body_html) VALUES (?,?,?,?)`)
      .run('Re: Case', 'judge@ut.gov', 'Judge', '<p>Subpoena for <b>suspect</b> delivered</p>');
    const rows = db.prepare(`SELECT rowid FROM email_cache_fts WHERE email_cache_fts MATCH 'suspect'`).all();
    expect(rows.length).toBe(1);
  });

  it('matches on subject', () => {
    const rows = db.prepare(`SELECT rowid FROM email_cache_fts WHERE email_cache_fts MATCH 'subject:Case'`).all();
    expect(rows.length).toBeGreaterThan(0);
  });
});
```

Run: `cd server && npx vitest run src/__tests__/emailFts.test.ts`. All pass.

**Step 3 — Commit:**
```bash
git add server/src/models/database.ts server/src/__tests__/emailFts.test.ts
git commit -m "feat(email): FTS5 virtual table + triggers for full-text search"
```

---

### Task 2.3: Search endpoint

**Files:** Modify `server/src/routes/email.ts` — add `GET /messages/search` BEFORE `GET /messages/:id` (otherwise `search` is captured as an id).

**Step 1 — Insert before line ~532:**

```ts
router.get('/messages/search', async (req: Request, res: Response) => {
  const db = getDb();
  const q = String(req.query.q || '').trim();
  const folder = req.query.folder ? String(req.query.folder) : '';
  const from = req.query.from ? String(req.query.from) : '';
  const after = req.query.after ? String(req.query.after) : '';
  const before = req.query.before ? String(req.query.before) : '';
  const flagged = req.query.flagged === '1';
  const hasAttachment = req.query.has_attachment === '1';
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '25'), 10)));
  const offset = Math.max(0, parseInt(String(req.query.offset || '0'), 10));

  if (!q && !folder && !from && !after && !before && !flagged && !hasAttachment) {
    return res.json({ results: [], total: 0 });
  }

  const where: string[] = [];
  const params: any[] = [];
  if (q.length >= 2) {
    const safeQ = q.replace(/["']/g, ' ').replace(/[^\w\s*]/g, ' ').trim();
    if (safeQ) {
      where.push('ec.id IN (SELECT rowid FROM email_cache_fts WHERE email_cache_fts MATCH ?)');
      params.push(safeQ);
    }
  }
  if (folder) { where.push('ec.folder_id = ?'); params.push(folder); }
  if (from)   { where.push('ec.from_address LIKE ?'); params.push(`%${from}%`); }
  if (after)  { where.push('ec.received_at >= ?'); params.push(after); }
  if (before) { where.push('ec.received_at <= ?'); params.push(before); }
  if (flagged) where.push('ec.is_flagged = 1');
  if (hasAttachment) where.push('ec.has_attachments = 1');
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const total = (db.prepare(`SELECT COUNT(*) as c FROM email_cache ec ${whereSql}`).get(...params) as any).c;
  const rows = db.prepare(
    `SELECT ec.id, ec.graph_id, ec.subject, ec.from_address, ec.from_name, ec.body_preview, ec.received_at, ec.folder_id, ec.is_read, ec.is_flagged, ec.has_attachments
     FROM email_cache ec ${whereSql}
     ORDER BY ec.received_at DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset);

  res.json({ results: rows, total, limit, offset });
});
```

**Step 2 — Typecheck + run suite.**

**Step 3 — Commit:**
```bash
git add server/src/routes/email.ts
git commit -m "feat(email): full-text search endpoint /messages/search"
```

---

### Task 2.4: Search UI on EmailPage

**Files:** `client/src/pages/EmailPage.tsx`

**Step 1:** Add a search input in the mailbox header. When `query.length >= 2`, fetch `/api/email/messages/search?q=<query>&folder=<current_folder>` via `apiFetch`. Replace the message list with search results. Keep a "Clear search" button.

Skeleton wiring:

```tsx
const [searchQuery, setSearchQuery] = useState('');
const [searchResults, setSearchResults] = useState<any[] | null>(null);

useEffect(() => {
  if (searchQuery.length < 2) { setSearchResults(null); return; }
  const t = setTimeout(() => {
    apiFetch<{ results: any[] }>(`/api/email/messages/search?q=${encodeURIComponent(searchQuery)}&folder=${encodeURIComponent(currentFolderId)}`)
      .then(r => setSearchResults(r.results))
      .catch(() => setSearchResults([]));
  }, 300);
  return () => clearTimeout(t);
}, [searchQuery, currentFolderId]);
```

Render `searchResults ?? messages`. Add input element to messages column header.

**Step 2:** Manual smoke test — `npm run dev`, type in the box, confirm results.

**Step 3:** Commit:
```bash
git add client/src/pages/EmailPage.tsx
git commit -m "feat(email): client search box wired to FTS endpoint"
```

---

### Task 2.5: Rules engine — tables + module + tests

**Files:**
- Modify: `server/src/models/database.ts`
- Create: `server/src/utils/emailRuleEngine.ts`
- Create: `server/src/__tests__/emailRuleEngine.test.ts`

**Step 1 — Tables (after the FTS block):**

```ts
db.prepare(`CREATE TABLE IF NOT EXISTS email_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 100,
  enabled INTEGER NOT NULL DEFAULT 1,
  conditions_json TEXT NOT NULL,
  actions_json TEXT NOT NULL,
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`).run();
db.prepare(`CREATE INDEX IF NOT EXISTS idx_email_rules_enabled ON email_rules(enabled, priority)`).run();

db.prepare(`CREATE TABLE IF NOT EXISTS email_rule_matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email_cache_id INTEGER NOT NULL,
  rule_id INTEGER NOT NULL,
  executed_at TEXT NOT NULL,
  action_result TEXT,
  FOREIGN KEY (email_cache_id) REFERENCES email_cache(id) ON DELETE CASCADE,
  FOREIGN KEY (rule_id) REFERENCES email_rules(id) ON DELETE CASCADE
)`).run();
db.prepare(`CREATE INDEX IF NOT EXISTS idx_email_rule_matches_email ON email_rule_matches(email_cache_id)`).run();
```

**Step 2 — Failing test:**

```ts
// server/src/__tests__/emailRuleEngine.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import Database from 'better-sqlite3';
import { evaluateRulesForEmail, matchesConditions } from '../utils/emailRuleEngine';

describe('matchesConditions', () => {
  const email = { from_address: 'judge@ut.gov', subject: 'Subpoena: Case 2026-CS-1234', body_text: 'please respond', has_attachments: 0, importance: 'normal' };
  it('matches sender_regex', () => {
    expect(matchesConditions({ sender_regex: '@ut\\.gov$' }, email)).toBe(true);
  });
  it('rejects wrong sender_regex', () => {
    expect(matchesConditions({ sender_regex: '@example\\.com$' }, email)).toBe(false);
  });
  it('matches subject_regex', () => {
    expect(matchesConditions({ subject_regex: 'Subpoena' }, email)).toBe(true);
  });
  it('matches body_contains case-insensitive', () => {
    expect(matchesConditions({ body_contains: 'RESPOND' }, email)).toBe(true);
  });
  it('requires all conditions (AND)', () => {
    expect(matchesConditions({ sender_regex: '@ut\\.gov$', subject_regex: 'Subpoena' }, email)).toBe(true);
    expect(matchesConditions({ sender_regex: '@ut\\.gov$', subject_regex: 'Nope' }, email)).toBe(false);
  });
});

describe('evaluateRulesForEmail', () => {
  let db: Database.Database;
  beforeAll(() => {
    db = new Database(':memory:');
    db.prepare(`CREATE TABLE email_cache (id INTEGER PRIMARY KEY, graph_id TEXT, from_address TEXT, subject TEXT, body_html TEXT, has_attachments INTEGER, importance TEXT, is_flagged INTEGER DEFAULT 0, folder_id TEXT, categories TEXT DEFAULT '[]')`).run();
    db.prepare(`CREATE VIRTUAL TABLE email_cache_fts USING fts5(subject,from_address,from_name,body_text,content='email_cache',content_rowid='id')`).run();
    db.prepare(`CREATE TABLE email_rules (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, priority INTEGER, enabled INTEGER, conditions_json TEXT, actions_json TEXT, created_by INTEGER, created_at TEXT, updated_at TEXT)`).run();
    db.prepare(`CREATE TABLE email_rule_matches (id INTEGER PRIMARY KEY AUTOINCREMENT, email_cache_id INTEGER, rule_id INTEGER, executed_at TEXT, action_result TEXT)`).run();
    db.prepare(`CREATE TABLE email_links (id INTEGER PRIMARY KEY AUTOINCREMENT, email_graph_id TEXT, entity_type TEXT, entity_id TEXT, auto_linked INTEGER DEFAULT 0, created_by INTEGER, created_at TEXT)`).run();
  });

  it('executes flag action on matching rule', async () => {
    db.prepare(`INSERT INTO email_cache (id, graph_id, from_address, subject, body_html, has_attachments, importance) VALUES (1,'g1','judge@ut.gov','Subpoena','<p>x</p>',0,'normal')`).run();
    db.prepare(`INSERT INTO email_cache_fts(rowid, subject, from_address, from_name, body_text) VALUES (1,'Subpoena','judge@ut.gov','','x')`).run();
    db.prepare(`INSERT INTO email_rules (name, priority, enabled, conditions_json, actions_json, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`)
      .run('Flag subpoenas', 100, 1, JSON.stringify({ sender_regex: '@ut\\.gov$' }), JSON.stringify([{ type: 'flag' }]), 1, '2026-04-14', '2026-04-14');
    await evaluateRulesForEmail(db, 1);
    const row = db.prepare('SELECT is_flagged FROM email_cache WHERE id = 1').get() as any;
    expect(row.is_flagged).toBe(1);
    expect(db.prepare('SELECT * FROM email_rule_matches WHERE email_cache_id = 1').get()).toBeTruthy();
  });
});
```

**Step 3 — Implement:**

```ts
// server/src/utils/emailRuleEngine.ts
import type BetterSqlite3 from 'better-sqlite3';
import { localNow } from './timeUtils';

export interface RuleConditions {
  sender_regex?: string;
  subject_regex?: string;
  body_contains?: string;
  has_attachment?: boolean;
  importance?: 'low' | 'normal' | 'high';
}

export interface RuleAction {
  type: 'move' | 'flag' | 'categorize' | 'link' | 'forward';
  folder_id?: string;
  category?: string;
  entity_type?: string;
  entity_id?: string | number;
  forward_to?: string[];
}

export interface Rule {
  id: number; name: string; priority: number; enabled: number;
  conditions_json: string; actions_json: string;
}

interface EmailLike {
  from_address: string; subject: string; body_text: string;
  has_attachments: number; importance: string;
}

export function matchesConditions(cond: RuleConditions, email: EmailLike): boolean {
  if (cond.sender_regex) {
    try { if (!new RegExp(cond.sender_regex, 'i').test(email.from_address || '')) return false; }
    catch { return false; }
  }
  if (cond.subject_regex) {
    try { if (!new RegExp(cond.subject_regex, 'i').test(email.subject || '')) return false; }
    catch { return false; }
  }
  if (cond.body_contains) {
    if (!String(email.body_text || '').toLowerCase().includes(cond.body_contains.toLowerCase())) return false;
  }
  if (cond.has_attachment !== undefined) {
    if (Boolean(email.has_attachments) !== cond.has_attachment) return false;
  }
  if (cond.importance) {
    if ((email.importance || 'normal').toLowerCase() !== cond.importance) return false;
  }
  return true;
}

function runAction(db: BetterSqlite3.Database, emailId: number, action: RuleAction): { ok: boolean; detail?: string } {
  try {
    switch (action.type) {
      case 'flag':
        db.prepare('UPDATE email_cache SET is_flagged = 1 WHERE id = ?').run(emailId);
        return { ok: true };
      case 'move':
        if (!action.folder_id) return { ok: false, detail: 'missing folder_id' };
        db.prepare('UPDATE email_cache SET folder_id = ? WHERE id = ?').run(action.folder_id, emailId);
        return { ok: true };
      case 'categorize': {
        if (!action.category) return { ok: false, detail: 'missing category' };
        const row = db.prepare('SELECT categories FROM email_cache WHERE id = ?').get(emailId) as any;
        let cats: string[] = [];
        try { cats = JSON.parse(row?.categories || '[]'); } catch { cats = []; }
        if (!cats.includes(action.category)) cats.push(action.category);
        db.prepare('UPDATE email_cache SET categories = ? WHERE id = ?').run(JSON.stringify(cats), emailId);
        return { ok: true };
      }
      case 'link': {
        if (!action.entity_type || action.entity_id == null) return { ok: false, detail: 'missing entity' };
        const e = db.prepare('SELECT graph_id FROM email_cache WHERE id = ?').get(emailId) as any;
        if (!e?.graph_id) return { ok: false, detail: 'no graph_id' };
        db.prepare('INSERT INTO email_links (email_graph_id, entity_type, entity_id, auto_linked, created_at) VALUES (?,?,?,1,?)')
          .run(e.graph_id, action.entity_type, String(action.entity_id), localNow());
        return { ok: true };
      }
      case 'forward':
        return { ok: true, detail: 'forward queued' };
      default:
        return { ok: false, detail: 'unknown action' };
    }
  } catch (err: any) {
    return { ok: false, detail: err.message || 'action error' };
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout:${label}`)), ms);
    p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

export async function evaluateRulesForEmail(db: BetterSqlite3.Database, emailId: number): Promise<void> {
  const email = db.prepare(`SELECT ec.id, ec.from_address, ec.subject, ec.has_attachments, ec.importance,
    COALESCE((SELECT body_text FROM email_cache_fts WHERE rowid = ec.id), '') as body_text
    FROM email_cache ec WHERE ec.id = ?`).get(emailId) as any;
  if (!email) return;

  const rules = db.prepare('SELECT * FROM email_rules WHERE enabled = 1 ORDER BY priority ASC').all() as Rule[];
  for (const rule of rules) {
    let cond: RuleConditions;
    let actions: RuleAction[];
    try { cond = JSON.parse(rule.conditions_json); actions = JSON.parse(rule.actions_json); }
    catch { continue; }

    if (!matchesConditions(cond, email)) continue;

    const results: Array<{ action: string; ok: boolean; detail?: string }> = [];
    for (const action of actions) {
      try {
        const r = await withTimeout(Promise.resolve(runAction(db, emailId, action)), 50, `rule:${rule.id}:${action.type}`);
        results.push({ action: action.type, ok: r.ok, detail: r.detail });
      } catch (err: any) {
        results.push({ action: action.type, ok: false, detail: err.message });
      }
    }
    db.prepare('INSERT INTO email_rule_matches (email_cache_id, rule_id, executed_at, action_result) VALUES (?,?,?,?)')
      .run(emailId, rule.id, localNow(), JSON.stringify(results));
  }
}
```

Run test, verify pass.

**Step 4 — Commit:**
```bash
git add server/src/models/database.ts server/src/utils/emailRuleEngine.ts server/src/__tests__/emailRuleEngine.test.ts
git commit -m "feat(email): rule engine with condition/action evaluation"
```

---

### Task 2.6: Wire rule engine into the poller

**Files:** `server/src/utils/emailPoller.ts`

**Step 1:** In `syncFolder`, track which email IDs are NEW inserts (not updates). Replace the upsert loop:

```ts
  const checkExisting = db.prepare('SELECT id FROM email_cache WHERE graph_id = ?');
  const newIds: number[] = [];
  const tx = db.transaction(() => {
    for (const msg of messages) {
      const existing = checkExisting.get(msg.id) as { id: number } | undefined;
      // ... existing field extraction ...
      const info = upsert.run( /* same args as before */ );
      if (!existing && info.lastInsertRowid) {
        newIds.push(Number(info.lastInsertRowid));
      }
    }
  });
  tx();

  // Rules run OUTSIDE the transaction — failures must not roll back sync
  for (const id of newIds) {
    try { await evaluateRulesForEmail(db, id); }
    catch (err: any) { console.warn(`[EmailPoller] Rule eval failed for email #${id}:`, err.message); }
  }
  return newIds.length;
```

Add `import { evaluateRulesForEmail } from './emailRuleEngine';`.

**Step 2:** Run all tests, all green.

**Step 3:** Commit:
```bash
git add server/src/utils/emailPoller.ts
git commit -m "feat(email): evaluate rules on new inbound messages"
```

---

### Task 2.7: Rule CRUD API

**Files:**
- Create: `server/src/routes/emailRules.ts`
- Modify: `server/src/index.ts` (mount)

**Step 1 — Implement:**

```ts
// server/src/routes/emailRules.ts
import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { auditLog } from '../utils/auditLogger';
import { localNow } from '../utils/timeUtils';
import { matchesConditions, RuleConditions } from '../utils/emailRuleEngine';

const router = Router();
router.use(authenticateToken);
router.use(requireRole('admin', 'manager'));

router.get('/', (_req, res) => {
  const db = getDb();
  res.json(db.prepare('SELECT * FROM email_rules ORDER BY priority ASC, id ASC').all());
});

router.post('/', (req: Request, res: Response) => {
  const db = getDb();
  const { name, priority = 100, enabled = 1, conditions, actions } = req.body || {};
  if (!name || !conditions || !actions) return res.status(400).json({ error: 'name, conditions, actions required' });
  const now = localNow();
  const info = db.prepare(`INSERT INTO email_rules (name, priority, enabled, conditions_json, actions_json, created_by, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(name, priority, enabled ? 1 : 0, JSON.stringify(conditions), JSON.stringify(actions), req.user!.userId, now, now);
  auditLog(req, 'CREATE' as any, 'email_rule' as any, info.lastInsertRowid as number, null, { name, conditions, actions });
  res.json({ id: info.lastInsertRowid });
});

router.put('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const id = Number(req.params.id);
  const { name, priority, enabled, conditions, actions } = req.body || {};
  const existing = db.prepare('SELECT * FROM email_rules WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'not found' });
  db.prepare(`UPDATE email_rules SET name=?, priority=?, enabled=?, conditions_json=?, actions_json=?, updated_at=? WHERE id=?`)
    .run(name, priority, enabled ? 1 : 0, JSON.stringify(conditions), JSON.stringify(actions), localNow(), id);
  auditLog(req, 'UPDATE' as any, 'email_rule' as any, id, existing, { name, conditions, actions });
  res.json({ success: true });
});

router.delete('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM email_rules WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'not found' });
  db.prepare('DELETE FROM email_rules WHERE id = ?').run(id);
  auditLog(req, 'DELETE' as any, 'email_rule' as any, id, existing, null);
  res.json({ success: true });
});

router.post('/test-match', (req: Request, res: Response) => {
  const db = getDb();
  const { conditions, sample_email_id } = req.body || {};
  if (!conditions) return res.status(400).json({ error: 'conditions required' });
  if (sample_email_id) {
    const email = db.prepare(`SELECT ec.from_address, ec.subject, ec.has_attachments, ec.importance,
      COALESCE((SELECT body_text FROM email_cache_fts WHERE rowid = ec.id), '') as body_text
      FROM email_cache ec WHERE ec.id = ?`).get(Number(sample_email_id)) as any;
    if (!email) return res.status(404).json({ error: 'email not found' });
    return res.json({ matches: matchesConditions(conditions as RuleConditions, email) });
  }
  const sample = db.prepare(`SELECT ec.id, ec.from_address, ec.subject, ec.has_attachments, ec.importance,
    COALESCE((SELECT body_text FROM email_cache_fts WHERE rowid = ec.id), '') as body_text
    FROM email_cache ec WHERE folder_id='inbox' ORDER BY received_at DESC LIMIT 50`).all() as any[];
  const hits = sample.filter(e => matchesConditions(conditions as RuleConditions, e));
  res.json({ matched: hits.length, total: sample.length, sample_ids: hits.slice(0, 10).map(e => e.id) });
});

export default router;
```

**Step 2 — Mount in `server/src/index.ts`** near the other `/api/email` mount:

```ts
import emailRulesRouter from './routes/emailRules';
app.use('/api/email/rules', emailRulesRouter);
```

Must be mounted BEFORE the main email router if the main router has a wildcard on `/rules`. Confirm by running `check:routes`.

**Step 3 — `cd server && npm run check:routes`** — 0 duplicates.

**Step 4 — Commit:**
```bash
git add server/src/routes/emailRules.ts server/src/index.ts
git commit -m "feat(email): admin CRUD API for email rules + test-match endpoint"
```

---

### Task 2.8: Rule builder UI

**Files:**
- Create: `client/src/pages/admin/AdminEmailRulesTab.tsx`
- Modify: `client/src/pages/admin/AdminEmailTab.tsx` (sub-tab link)

**Step 1 — Component:**

```tsx
// client/src/pages/admin/AdminEmailRulesTab.tsx
import { useEffect, useState } from 'react';
import { apiFetch } from '../../hooks/useApi';

interface Rule {
  id: number; name: string; priority: number; enabled: number;
  conditions_json: string; actions_json: string;
}

export default function AdminEmailRulesTab() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [editing, setEditing] = useState<Partial<Rule> | null>(null);

  const load = () => apiFetch<Rule[]>('/api/email/rules').then(setRules).catch(console.error);
  useEffect(() => { load(); }, []);

  async function save() {
    if (!editing) return;
    const payload = {
      name: editing.name,
      priority: editing.priority ?? 100,
      enabled: editing.enabled ?? 1,
      conditions: JSON.parse(editing.conditions_json || '{}'),
      actions: JSON.parse(editing.actions_json || '[]'),
    };
    if (editing.id) {
      await apiFetch(`/api/email/rules/${editing.id}`, { method: 'PUT', body: JSON.stringify(payload) });
    } else {
      await apiFetch('/api/email/rules', { method: 'POST', body: JSON.stringify(payload) });
    }
    setEditing(null); load();
  }

  async function remove(id: number) {
    if (!confirm('Delete this rule?')) return;
    await apiFetch(`/api/email/rules/${id}`, { method: 'DELETE' });
    load();
  }

  async function testMatch() {
    if (!editing) return;
    const r = await apiFetch<{ matched: number; total: number }>('/api/email/rules/test-match', {
      method: 'POST',
      body: JSON.stringify({ conditions: JSON.parse(editing.conditions_json || '{}') }),
    });
    alert(`Matched ${r.matched} of last ${r.total} inbox emails`);
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex justify-between">
        <h2 className="text-sm font-semibold text-[#d4a017]">EMAIL RULES</h2>
        <button onClick={() => setEditing({ priority: 100, enabled: 1, conditions_json: '{}', actions_json: '[]' })} className="px-3 py-1 border border-[#222] text-xs">NEW RULE</button>
      </div>
      <table className="w-full text-xs">
        <thead><tr className="text-left"><th>Name</th><th>Priority</th><th>Enabled</th><th></th></tr></thead>
        <tbody>
          {rules.map(r => (
            <tr key={r.id} className="border-t border-[#222]">
              <td>{r.name}</td><td>{r.priority}</td><td>{r.enabled ? 'YES' : 'NO'}</td>
              <td>
                <button onClick={() => setEditing(r)} className="px-2 py-0.5 border border-[#222] mr-2">EDIT</button>
                <button onClick={() => remove(r.id)} className="px-2 py-0.5 border border-[#222]">DELETE</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {editing && (
        <div className="border border-[#222] p-3 space-y-2 bg-[#141414]">
          <input placeholder="Rule name" value={editing.name || ''} onChange={e => setEditing({ ...editing, name: e.target.value })} className="w-full bg-black text-white px-2 py-1" />
          <input type="number" placeholder="Priority" value={editing.priority ?? 100} onChange={e => setEditing({ ...editing, priority: Number(e.target.value) })} className="w-full bg-black text-white px-2 py-1" />
          <textarea placeholder='Conditions JSON e.g. {"sender_regex":"@ut\\.gov$"}' value={editing.conditions_json || ''} onChange={e => setEditing({ ...editing, conditions_json: e.target.value })} className="w-full bg-black text-white px-2 py-1 h-20 font-mono" />
          <textarea placeholder='Actions JSON e.g. [{"type":"flag"}]' value={editing.actions_json || ''} onChange={e => setEditing({ ...editing, actions_json: e.target.value })} className="w-full bg-black text-white px-2 py-1 h-20 font-mono" />
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={!!editing.enabled} onChange={e => setEditing({ ...editing, enabled: e.target.checked ? 1 : 0 })} /> Enabled</label>
          <div className="flex gap-2">
            <button onClick={save} className="px-3 py-1 border border-[#d4a017] text-[#d4a017]">SAVE</button>
            <button onClick={testMatch} className="px-3 py-1 border border-[#222]">TEST MATCH</button>
            <button onClick={() => setEditing(null)} className="px-3 py-1 border border-[#222]">CANCEL</button>
          </div>
        </div>
      )}
    </div>
  );
}
```

**Step 2 — Wire sub-tab in `AdminEmailTab.tsx`:** add a tab-state and render `<AdminEmailRulesTab />` when active. Follow the existing tab pattern in that file.

**Step 3 — Manual smoke test:** create a rule, click TEST MATCH, confirm result.

**Step 4 — Commit:**
```bash
git add client/src/pages/admin/AdminEmailRulesTab.tsx client/src/pages/admin/AdminEmailTab.tsx
git commit -m "feat(email): admin rule builder UI"
```

---

### Task 2.9: Phase 2 checkpoint

```bash
cd server && npx vitest run
cd server && npm run check:routes
cd client && npx tsc --noEmit
git commit --allow-empty -m "checkpoint: Phase 2 (FTS + rules) complete"
```

---

## Phase 3 — CAD/RMS integration

### Task 3.1: PII patterns + redactor

**Files:**
- Create: `server/src/utils/piiPatterns.ts`
- Create: `server/src/utils/emailRedactor.ts`
- Create: `server/src/__tests__/emailRedactor.test.ts`

**Step 1 — Failing test:**

```ts
// server/src/__tests__/emailRedactor.test.ts
import { describe, it, expect } from 'vitest';
import { redactPII } from '../utils/emailRedactor';

describe('redactPII', () => {
  it('redacts SSN', () => {
    const r = redactPII('<p>SSN 123-45-6789 here</p>');
    expect(r.redacted).toContain('[REDACTED:SSN]');
    expect(r.diff.length).toBe(1);
  });
  it('redacts DOB like 01/15/1990', () => {
    const r = redactPII('<p>DOB 01/15/1990</p>');
    expect(r.redacted).toContain('[REDACTED:DOB]');
  });
  it('redacts phone in (801) 555-1234 format', () => {
    const r = redactPII('<p>Call (801) 555-1234</p>');
    expect(r.redacted).toContain('[REDACTED:PHONE]');
  });
  it('redacts Utah driver license', () => {
    const r = redactPII('<p>UT DL A1234567</p>');
    expect(r.redacted).toContain('[REDACTED:DL]');
  });
  it('returns unchanged html when nothing matches', () => {
    const r = redactPII('<p>hello world</p>');
    expect(r.redacted).toBe('<p>hello world</p>');
    expect(r.diff.length).toBe(0);
  });
  it('redacts multiple distinct types', () => {
    const r = redactPII('<p>SSN 111-22-3333 DOB 05/05/1980</p>');
    const types = new Set(r.diff.map(d => d.type));
    expect(types.has('SSN')).toBe(true);
    expect(types.has('DOB')).toBe(true);
  });
});
```

**Step 2 — Implement:**

```ts
// server/src/utils/piiPatterns.ts
export interface PiiPattern {
  type: 'SSN' | 'DOB' | 'PHONE' | 'DL';
  regex: RegExp;
}

export const PII_PATTERNS: PiiPattern[] = [
  { type: 'SSN',   regex: /\b\d{3}-\d{2}-\d{4}\b/g },
  { type: 'DOB',   regex: /\b(?:0?[1-9]|1[0-2])\/(?:0?[1-9]|[12]\d|3[01])\/(?:19|20)\d{2}\b/g },
  { type: 'PHONE', regex: /\(\d{3}\)\s*\d{3}-\d{4}/g },
  { type: 'DL',    regex: /\b[A-Z]\d{6,8}\b/g },
];
```

```ts
// server/src/utils/emailRedactor.ts
import { PII_PATTERNS } from './piiPatterns';

export interface RedactionDiff {
  original: string; replacement: string; type: string; index: number;
}

export function redactPII(html: string): { redacted: string; diff: RedactionDiff[] } {
  if (!html) return { redacted: html, diff: [] };
  const diff: RedactionDiff[] = [];
  let out = html;
  for (const { type, regex } of PII_PATTERNS) {
    const rx = new RegExp(regex.source, regex.flags);
    const replacements: Array<{ start: number; end: number; original: string }> = [];
    let m: RegExpExecArray | null;
    while ((m = rx.exec(out)) !== null) {
      replacements.push({ start: m.index, end: m.index + m[0].length, original: m[0] });
    }
    for (let i = replacements.length - 1; i >= 0; i--) {
      const r = replacements[i];
      out = out.slice(0, r.start) + `[REDACTED:${type}]` + out.slice(r.end);
      diff.push({ original: r.original, replacement: `[REDACTED:${type}]`, type, index: r.start });
    }
  }
  diff.sort((a, b) => a.index - b.index);
  return { redacted: out, diff };
}
```

Run test, verify pass.

**Step 3 — Commit:**
```bash
git add server/src/utils/piiPatterns.ts server/src/utils/emailRedactor.ts server/src/__tests__/emailRedactor.test.ts
git commit -m "feat(email): PII redactor for external forwards"
```

---

### Task 3.2: Auto-linker

**Files:**
- Create: `server/src/utils/emailAutoLinker.ts`
- Create: `server/src/__tests__/emailAutoLinker.test.ts`

**Step 1 — Failing test:**

```ts
// server/src/__tests__/emailAutoLinker.test.ts
import { describe, it, expect } from 'vitest';
import { extractEntityReferences } from '../utils/emailAutoLinker';

describe('extractEntityReferences', () => {
  it('extracts Case # reference', () => {
    const refs = extractEntityReferences('Re: Case #2026-CS-1234', 'see attached');
    expect(refs).toContainEqual(expect.objectContaining({ type: 'case', id: '2026-CS-1234' }));
  });
  it('extracts Incident #', () => {
    const refs = extractEntityReferences('', 'Please review Incident #26-0017 before court');
    expect(refs).toContainEqual(expect.objectContaining({ type: 'incident', id: '26-0017' }));
  });
  it('extracts FI-YY-NNNNN', () => {
    const refs = extractEntityReferences('FI-26-00123 followup', '');
    expect(refs).toContainEqual(expect.objectContaining({ type: 'field_interview', id: 'FI-26-00123' }));
  });
  it('dedupes identical references from subject + body', () => {
    const refs = extractEntityReferences('Case #2026-CS-1234', 'Case #2026-CS-1234 is ready');
    const caseRefs = refs.filter(r => r.type === 'case');
    expect(caseRefs.length).toBe(1);
  });
  it('returns empty for no matches', () => {
    expect(extractEntityReferences('hello', 'world')).toEqual([]);
  });
});
```

**Step 2 — Implement:**

```ts
// server/src/utils/emailAutoLinker.ts
export interface EntityRef {
  type: 'case' | 'incident' | 'field_interview' | 'citation' | 'call';
  id: string;
}

const PATTERNS: Array<{ type: EntityRef['type']; rx: RegExp }> = [
  { type: 'case',            rx: /Case\s*#?\s*(\d{4}-[A-Z]{2}-\d{4,})/gi },
  { type: 'incident',        rx: /Incident\s*#?\s*(\d{2}-\d{4,})/gi },
  { type: 'field_interview', rx: /\b(FI-\d{2}-\d{5,})\b/gi },
  { type: 'citation',        rx: /Citation\s*#?\s*(\d{4}-\d{4,})/gi },
  { type: 'call',            rx: /CFS-(\d{4}-\d{4,})/gi },
];

export function extractEntityReferences(subject: string, body: string): EntityRef[] {
  const haystack = `${subject || ''}\n${body || ''}`;
  const seen = new Set<string>();
  const out: EntityRef[] = [];
  for (const { type, rx } of PATTERNS) {
    const pattern = new RegExp(rx.source, rx.flags);
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(haystack)) !== null) {
      const id = m[1];
      const key = `${type}:${id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ type, id });
    }
  }
  return out;
}
```

Run test, verify pass.

**Step 3 — Commit:**
```bash
git add server/src/utils/emailAutoLinker.ts server/src/__tests__/emailAutoLinker.test.ts
git commit -m "feat(email): auto-linker extracts case/incident/FI references"
```

---

### Task 3.3: Wire auto-linker + allowlist into poller

**Files:**
- Modify: `server/src/models/database.ts` — add `auto_linked` column, seed allowlist config
- Modify: `server/src/utils/emailPoller.ts`

**Step 1 — Migration (append to email block):**

```ts
addCol('email_links', 'auto_linked', 'INTEGER DEFAULT 0');

// Seed defaults if missing
const existingAllowlist = db.prepare(`SELECT config_value FROM system_config WHERE config_key = 'email_autolink_allowlist'`).get();
if (!existingAllowlist) {
  db.prepare(`INSERT INTO system_config (config_key, config_value) VALUES (?, ?)`).run(
    'email_autolink_allowlist',
    JSON.stringify(['rmpgutah.us', '.gov', '.state.ut.us', 'ut.gov', 'slco.org'])
  );
}
const existingTipFolder = db.prepare(`SELECT config_value FROM system_config WHERE config_key = 'email_tip_line_folder_id'`).get();
if (!existingTipFolder) {
  db.prepare(`INSERT INTO system_config (config_key, config_value) VALUES (?, ?)`).run('email_tip_line_folder_id', '');
}
```

**Step 2 — Allowlist helper in `emailPoller.ts` (near top):**

```ts
function isAllowlistedSender(fromAddr: string): boolean {
  try {
    const raw = getConfigValue('email_autolink_allowlist') || '[]';
    const domains: string[] = JSON.parse(raw);
    const addr = (fromAddr || '').toLowerCase();
    return domains.some(d => {
      const dom = d.toLowerCase();
      if (dom.startsWith('.')) return addr.endsWith(dom);  // .gov matches foo.gov
      return addr.endsWith('@' + dom) || addr.endsWith('.' + dom);
    });
  } catch { return false; }
}
```

**Step 3 — Call auto-linker after rule eval in `syncFolder`:**

```ts
import { extractEntityReferences } from './emailAutoLinker';

// inside the newIds loop, after evaluateRulesForEmail:
try {
  const row = db.prepare(`SELECT graph_id, from_address, subject,
    COALESCE((SELECT body_text FROM email_cache_fts WHERE rowid = ec.id),'') as body_text
    FROM email_cache ec WHERE ec.id = ?`).get(id) as any;
  if (row && isAllowlistedSender(row.from_address)) {
    const refs = extractEntityReferences(row.subject || '', row.body_text || '');
    for (const ref of refs) {
      db.prepare(`INSERT INTO email_links (email_graph_id, entity_type, entity_id, auto_linked, created_at)
                  VALUES (?,?,?,1,?)`).run(row.graph_id, ref.type, ref.id, localNow());
    }
  }
} catch (err: any) {
  console.warn(`[poller] auto-link failed for email #${id}:`, err.message);
}
```

**Step 4 — Run vitest + boot sanity check.**

**Step 5 — Commit:**
```bash
git add server/src/models/database.ts server/src/utils/emailPoller.ts
git commit -m "feat(email): auto-link inbound from allowlisted senders"
```

---

### Task 3.4: Redaction on external forward

**Files:** Modify `server/src/routes/email.ts` — `POST /messages/:id/forward` handler (around line 748)

**Step 1:** Add logic before the send call:

```ts
import { redactPII } from '../utils/emailRedactor';

// inside the handler:
const INTERNAL_DOMAINS = ['rmpgutah.us'];
const recipientDomains = [...(to || []), ...(cc || []), ...(bcc || [])]
  .map((addr: string) => (addr.split('@')[1] || '').toLowerCase());
const hasExternal = recipientDomains.some(d => d && !INTERNAL_DOMAINS.some(id => d === id || d.endsWith('.' + id)));

if (hasExternal && !req.body.redaction_confirmed) {
  const { redacted, diff } = redactPII(String(body || ''));
  if (diff.length > 0) {
    return res.status(409).json({ requires_redaction: true, preview: { redacted, diff } });
  }
}
```

Then proceed with the existing send. On success, include `redactedFields`:

```ts
auditEmailSend(req, 'FORWARD', {
  to, cc, bcc, subject, messageId: result.messageId, transport: result.transport,
  redactedFields: req.body.redaction_confirmed ? ['pii'] : undefined,
});
```

**Step 2:** Typecheck + tests.

**Step 3:** Commit:
```bash
git add server/src/routes/email.ts
git commit -m "feat(email): require PII redaction confirmation on external forwards"
```

---

### Task 3.5: Forward redaction modal (client)

**Files:**
- Create: `client/src/components/email/ForwardRedactionModal.tsx`
- Modify: `client/src/pages/EmailPage.tsx`

**Step 1 — Create modal:**

```tsx
// client/src/components/email/ForwardRedactionModal.tsx
import { useState } from 'react';

interface DiffItem { original: string; replacement: string; type: string; index: number; }

interface Props {
  open: boolean;
  preview: { redacted: string; diff: DiffItem[] } | null;
  onConfirm: (body: string) => void;
  onCancel: () => void;
}

export default function ForwardRedactionModal({ open, preview, onConfirm, onCancel }: Props) {
  const [edited, setEdited] = useState(preview?.redacted || '');
  if (!open || !preview) return null;
  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center">
      <div className="bg-[#141414] border border-[#d4a017] max-w-2xl w-full p-4 space-y-3">
        <div className="text-[#d4a017] text-sm font-semibold">EXTERNAL FORWARD — REVIEW REDACTIONS</div>
        <div className="text-xs text-gray-400">
          {preview.diff.length} items flagged: {[...new Set(preview.diff.map(d => d.type))].join(', ')}
        </div>
        <textarea value={edited} onChange={e => setEdited(e.target.value)} className="w-full h-64 bg-black text-white font-mono text-xs p-2" />
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} className="px-3 py-1 border border-[#222]">CANCEL</button>
          <button onClick={() => onConfirm(edited)} className="px-3 py-1 border border-[#d4a017] text-[#d4a017]">CONFIRM & SEND</button>
        </div>
      </div>
    </div>
  );
}
```

**Step 2 — Wire into `EmailPage.tsx` forward flow:** if the POST `/forward` returns 409 with `{requires_redaction}`, open the modal with the preview; on confirm, re-POST with `redaction_confirmed: true` and the edited body.

**Step 3 — Commit:**
```bash
git add client/src/components/email/ForwardRedactionModal.tsx client/src/pages/EmailPage.tsx
git commit -m "feat(email): client modal for reviewing redactions before external forward"
```

---

### Task 3.6: Email-to-CFS tip line

**Files:** `server/src/utils/emailPoller.ts`

**Step 1 — Add helper and call site:**

```ts
async function createTipCallsFromEmails(newIds: number[]): Promise<void> {
  const db = getDb();
  const tipFolderId = getConfigValue('email_tip_line_folder_id');
  if (!tipFolderId) return;
  for (const id of newIds) {
    const row = db.prepare(`SELECT ec.graph_id, ec.from_address, ec.from_name, ec.subject,
      COALESCE((SELECT body_text FROM email_cache_fts WHERE rowid = ec.id),'') as body_text,
      ec.folder_id FROM email_cache ec WHERE ec.id = ?`).get(id) as any;
    if (!row || row.folder_id !== tipFolderId) continue;
    try {
      db.prepare(`INSERT INTO calls_for_service (source, caller_name, caller_phone, narrative, priority, status, location, created_at)
                  VALUES ('email', ?, '', ?, 3, 'pending_review', '', ?)`).run(
        row.from_name || row.from_address || 'Unknown',
        String(row.body_text || '').slice(0, 4000),
        localNow()
      );
      console.log(`[EmailPoller] Tip-line email #${id} created CFS`);
    } catch (err: any) {
      console.error(`[EmailPoller] Tip-line CFS creation failed for #${id}:`, err.message);
    }
  }
}

// Call after the auto-link loop:
await createTipCallsFromEmails(newIds);
```

**Step 2 — Verify `calls_for_service` schema.** Print columns:

```bash
cd server && npx tsx -e "import('./src/models/database').then(async m => { m.initDatabase(); const db = m.getDb(); console.log(db.prepare('SELECT sql FROM sqlite_master WHERE name=\"calls_for_service\"').get()); })"
```

If any non-null column lacks a default, extend the INSERT. Prefer extracting a helper `createPendingReviewCall(source, caller, narrative)` in `server/src/utils/callsForService.ts` if the INSERT becomes more than ~10 fields (see CLAUDE.md gotcha #24: the redispatch INSERT has 74 columns — don't replicate that here).

**Step 3 — Commit:**
```bash
git add server/src/utils/emailPoller.ts
git commit -m "feat(email): tip-line folder emails auto-create pending CFS entries"
```

---

### Task 3.7: "Email about this" from Case/Incident pages

**Files:** `client/src/pages/CaseDetailPage.tsx`, `client/src/pages/IncidentDetailPage.tsx`, `client/src/pages/EmailPage.tsx`

**Step 1 — Add button to both detail pages:**

```tsx
<button
  onClick={() => navigate(`/email?compose=1&subject=${encodeURIComponent(`Case #${caseNumber}`)}&link_type=case&link_id=${encodeURIComponent(caseNumber)}`)}
  className="px-2 py-1 border border-[#222] text-xs"
>
  EMAIL ABOUT THIS
</button>
```

For incidents use `link_type=incident` and the incident number.

**Step 2 — In `EmailPage.tsx`, read URL params:**

```tsx
const [params] = useSearchParams();
useEffect(() => {
  if (params.get('compose') === '1') {
    const subj = params.get('subject') || '';
    openCompose({ subject: subj });
  }
}, []);
// Remember link_type/link_id for post-send /api/email/link POST.
```

After send succeeds, POST `/api/email/link` with `email_graph_id` (from send response), `entity_type=link_type`, `entity_id=link_id`.

**Step 3 — Commit:**
```bash
git add client/src/pages/CaseDetailPage.tsx client/src/pages/IncidentDetailPage.tsx client/src/pages/EmailPage.tsx
git commit -m "feat(email): email-about-this buttons on case/incident pages"
```

---

### Task 3.8: Final verification

**Step 1:** Run every gate:
```bash
cd server && npx vitest run
cd server && npx tsc --noEmit
cd server && npm run check:routes
cd client && npx tsc --noEmit
```

**Step 2:** Manual smoke test with `npm run dev`:
- Open Email page, search for a term — results appear from FTS
- Admin → Email → Rules — create a test rule, click TEST MATCH
- Forward a message to an external address containing a fake SSN — modal appears with redaction preview

**Step 3:** Final checkpoint:
```bash
git commit --allow-empty -m "checkpoint: Phase 3 (CAD/RMS integration) complete — mega-PR ready for review"
```

**Step 4:** Branch is ready to open a PR to `main`:
```bash
git log --oneline main..HEAD
```

Do NOT push or open the PR yet — that's a user-confirmed action.

---

## Post-plan notes

- **Phase 4 (per-user mailboxes)** is intentionally not in this plan. It requires: `user_graph_tokens` table (AES-encrypted), `email_cache.owner_user_id` backfill, `getGraphClient(userId)` refactor, per-user OAuth enrollment UI. Will be a separate plan once the mega-PR lands.
- **`email_logs` table** exists in `database.ts` (line ~3536) independently from `activity_log`. Consider wiring `auditEmailSend` to also write there for a searchable email-specific trail — out of scope here.
- **Rule engine `forward` action** records intent but doesn't actually send; wiring the send requires a service-account `req`-less path — defer to Phase 4 when per-user auth clarifies who "sends on behalf of".
- **Auto-linker entity verification** is intentionally deferred. Current behavior: writes the link; UI 404s if the referenced case/incident doesn't exist. Acceptable for first cut — harden with existence checks in a follow-up.
