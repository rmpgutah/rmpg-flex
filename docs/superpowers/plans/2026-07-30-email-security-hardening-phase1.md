# Email System — Phase 1 Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the existing Microsoft Graph email subsystem (`src/routes/email.ts`) against send abuse, silent search truncation, incomplete audit trails, and oversized-attachment failures — without touching anything already shipped (templates, scheduled send, threads, rules, autolinker).

**Architecture:** Four independent, additive changes to the existing Worker route file and its two helper modules (`src/utils/emailSend.ts`, new `src/utils/emailAudit.ts`). No new tables except none needed — `email_audit_log` already exists (migration `0082_email_integration.sql`) but has zero writers today. No schema migration required for this phase.

**Tech Stack:** Hono on Cloudflare Workers, D1 (`src/utils/db.ts`'s `query`/`queryFirst`/`execute`), KV-backed rate limiter (`src/utils/rateLimit.ts`'s `rateLimitAllow`), Vitest (`tests/*.test.ts`, run via `npx vitest run <file>`).

## Global Constraints

- Server-side TS lives under `/src/`; run `npm run typecheck` (tsc --noEmit) after every task.
- D1 calls are always `await`ed — a missed `await` silently returns `{}` (see CLAUDE.md gotcha #3).
- Never build a `LIKE` pattern longer than ~40 characters against D1 — patterns past ~48-50 chars silently stop matching (project memory `feedback_d1_like_pattern_50_char_cap`); this is the exact bug this plan closes for `/messages/search`.
- `rateLimitAllow(kv, bucket, limit, windowSeconds)` fails OPEN on KV errors (never blocks legitimate traffic on infra failure) — reuse it as-is, don't reimplement.
- Tests: `npx vitest run <file>` — full suite (`npx vitest run`) before the final commit, per project convention (targeted-only runs have hidden regressions before).
- Follow the existing file's error-handling style: routes catch and return `{ success: false, error }` JSON, never let an unhandled rejection 500 the whole route.

---

### Task 1: Cap the email search query length (fix D1 LIKE truncation risk)

**Files:**
- Modify: `src/routes/email.ts:579-605` (`GET /messages/search` handler)
- Test: `tests/emailSearch.test.ts` (new)

**Interfaces:**
- Produces: no new exports — this is a pure handler-body change, but establishes the constant `MAX_EMAIL_SEARCH_QUERY_LEN = 40` as a module-level `const` in `email.ts`, referenced only within that file for now.

- [ ] **Step 1: Write the failing test**

Create `tests/emailSearch.test.ts`. This tests the pattern-building logic in isolation by extracting it as a small pure helper first — see Step 3, which introduces `buildSearchLikePattern`. Write the test against that helper (which does not exist yet):

```ts
import { describe, it, expect } from 'vitest';
import { buildSearchLikePattern } from '../src/routes/email';

describe('buildSearchLikePattern', () => {
  it('wraps a short query in % wildcards', () => {
    expect(buildSearchLikePattern('acme')).toBe('%acme%');
  });

  it('escapes % and _ so they are treated as literals, not wildcards', () => {
    expect(buildSearchLikePattern('100%_off')).toBe('%100 _off%'.replace('100 _off', '100\\%\\_off'));
  });

  it('truncates queries longer than 40 chars before wrapping, to stay under the D1 LIKE pattern cap', () => {
    const longQuery = 'a'.repeat(60);
    const result = buildSearchLikePattern(longQuery);
    // 40 chars of query + 2 wildcard chars = 42
    expect(result.length).toBeLessThanOrEqual(42);
    expect(result).toBe(`%${'a'.repeat(40)}%`);
  });

  it('leaves a 40-char query untruncated', () => {
    const q = 'b'.repeat(40);
    expect(buildSearchLikePattern(q)).toBe(`%${q}%`);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/emailSearch.test.ts`
Expected: FAIL — `buildSearchLikePattern` is not exported from `src/routes/email.ts` (module has no such export yet).

- [ ] **Step 3: Extract and export the pure helper, then use it in the route**

In `src/routes/email.ts`, find the existing `GET /messages/search` handler (currently around line 579-605):

```ts
email.get('/messages/search', async (c) => {
  const userId = c.get('userId');
  const q = (c.req.query('q') || '').trim();
  if (q.length < 2) return c.json({ results: [] });
  const folder = (c.req.query('folder') || '').trim();
  const like = `%${q.replace(/[%_]/g, ' ')}%`;
  try {
    const params: unknown[] = [userId, like, like, like];
    let folderClause = '';
    if (folder && folder !== 'inbox') { folderClause = 'AND folder_id = ?'; params.push(folder); }
    const rows = await query(
      c.env.DB,
      `SELECT graph_id, conversation_id, subject, from_address, from_name, body_preview,
              has_attachments, is_read, is_flagged, importance, received_at
         FROM email_messages
        WHERE owner_user_id = ?
          AND (subject LIKE ? OR from_address LIKE ? OR body_preview LIKE ?)
          ${folderClause}
        ORDER BY received_at DESC
        LIMIT 50`,
      ...params,
    );
    return c.json({ results: rows });
  } catch {
    return c.json({ results: [] });
  }
});
```

Note the existing line replaces `%`/`_` with a literal space (`' '`), which is a pre-existing minor quirk (it defangs wildcards but changes search semantics slightly rather than escaping them) — **keep that exact behavior**, this task only adds the length cap, it does not change the escaping approach. Replace the handler with:

```ts
// D1's LIKE operator silently stops matching once the pattern exceeds
// roughly 48-50 characters — not an error, just wrong (empty) results.
// Cap the raw query well under that so `%${q}%` (42 chars max) never
// approaches the boundary. See project memory: D1 LIKE 50-char pattern cap.
const MAX_EMAIL_SEARCH_QUERY_LEN = 40;

export function buildSearchLikePattern(rawQuery: string): string {
  const capped = rawQuery.slice(0, MAX_EMAIL_SEARCH_QUERY_LEN);
  return `%${capped.replace(/[%_]/g, ' ')}%`;
}

email.get('/messages/search', async (c) => {
  const userId = c.get('userId');
  const q = (c.req.query('q') || '').trim();
  if (q.length < 2) return c.json({ results: [] });
  const folder = (c.req.query('folder') || '').trim();
  const like = buildSearchLikePattern(q);
  try {
    const params: unknown[] = [userId, like, like, like];
    let folderClause = '';
    if (folder && folder !== 'inbox') { folderClause = 'AND folder_id = ?'; params.push(folder); }
    const rows = await query(
      c.env.DB,
      `SELECT graph_id, conversation_id, subject, from_address, from_name, body_preview,
              has_attachments, is_read, is_flagged, importance, received_at
         FROM email_messages
        WHERE owner_user_id = ?
          AND (subject LIKE ? OR from_address LIKE ? OR body_preview LIKE ?)
          ${folderClause}
        ORDER BY received_at DESC
        LIMIT 50`,
      ...params,
    );
    return c.json({ results: rows });
  } catch {
    return c.json({ results: [] });
  }
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/emailSearch.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no new errors

- [ ] **Step 6: Commit**

```bash
git add src/routes/email.ts tests/emailSearch.test.ts
git commit -m "fix(email): cap search query length to avoid D1 LIKE pattern truncation"
```

---

### Task 2: Add a dedicated send-path rate limit

**Files:**
- Modify: `src/routes/email.ts` — add a new middleware function and apply it to `/send`, `/messages/:id/reply`, `/messages/:id/reply-all`, `/messages/:id/forward`
- Test: `tests/emailSendRateLimit.test.ts` (new)

**Interfaces:**
- Consumes: `rateLimitAllow(kv: KVNamespace, bucket: string, limit: number, windowSeconds: number): Promise<boolean>` from `src/utils/rateLimit.ts` (already exists, signature verified).
- Produces: `emailSendRateLimit` Hono middleware, exported from `src/routes/email.ts`, for use by the four send-family routes in this file (not exported for use elsewhere — this phase scopes it to email only).

- [ ] **Step 1: Write the failing test**

Create `tests/emailSendRateLimit.test.ts`. This is a unit test of the middleware's decision logic against a fake KV, not a full Hono integration test (matches the style of other route-adjacent unit tests in this repo — see `tests/emailSend.test.ts` for the pattern of testing pure/near-pure logic without spinning up the whole app).

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { emailSendRateLimit } from '../src/routes/email';

function fakeKv(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => { store.set(key, value); }),
  } as unknown as KVNamespace;
}

function fakeContext(userId: number | undefined, kv: KVNamespace) {
  const vars: Record<string, unknown> = { userId };
  return {
    get: (k: string) => vars[k],
    env: { KV: kv },
    req: { url: 'https://api.rmpgutah.us/api/email/send' },
    json: (body: unknown, status?: number) => ({ body, status: status ?? 200 }),
  } as any;
}

describe('emailSendRateLimit', () => {
  it('allows the request through when under the limit', async () => {
    const kv = fakeKv();
    const c = fakeContext(42, kv);
    const next = vi.fn(async () => {});
    const result = await emailSendRateLimit(c, next);
    expect(next).toHaveBeenCalledOnce();
    expect(result).toBeUndefined();
  });

  it('blocks with 429 once the per-user window limit (20/5min) is exceeded', async () => {
    const now = Math.floor(Date.now() / 1000);
    const windowStart = now - (now % 300);
    const kv = fakeKv({ [`rl:email-send:42:${windowStart}`]: '20' });
    const c = fakeContext(42, kv);
    const next = vi.fn(async () => {});
    const result = await c.constructor === Object ? null : null; // placeholder unused
    const res = await emailSendRateLimit(c, next);
    expect(next).not.toHaveBeenCalled();
    expect(res).toEqual({ body: { error: 'Too many emails sent. Slow down and try again shortly.', code: 'EMAIL_RATE_LIMITED' }, status: 429 });
  });

  it('is a no-op (passes through) when there is no authenticated userId', async () => {
    const kv = fakeKv();
    const c = fakeContext(undefined, kv);
    const next = vi.fn(async () => {});
    await emailSendRateLimit(c, next);
    expect(next).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/emailSendRateLimit.test.ts`
Expected: FAIL — `emailSendRateLimit` is not exported from `src/routes/email.ts`.

- [ ] **Step 3: Implement the middleware**

In `src/routes/email.ts`, add near the top of the file (after the existing imports, before the `K` config-key object — imports section currently ends around line 32):

```ts
import type { Context, Next } from 'hono';
import { rateLimitAllow } from '../utils/rateLimit';
```

Then, after the `email.use('*', ...)` auth-gating block (currently ends around line 252, right before `email.get('/status', ...)`), add:

```ts
// Send-family rate limit — separate from the generic apiRateLimit (600/5min,
// sized for read-heavy dispatch polling). A compromised session or a buggy
// client retry loop must not be able to burn through the org's single shared
// Graph mailbox's send quota or trip Microsoft's abuse detection.
const EMAIL_SEND_LIMIT = 20;
const EMAIL_SEND_WINDOW_SECONDS = 300;

export async function emailSendRateLimit(c: Context, next: Next) {
  const userId = c.get('userId') as number | undefined;
  if (userId == null) return next();
  const allowed = await rateLimitAllow(c.env.KV, `email-send:${userId}`, EMAIL_SEND_LIMIT, EMAIL_SEND_WINDOW_SECONDS);
  if (!allowed) {
    return c.json({ error: 'Too many emails sent. Slow down and try again shortly.', code: 'EMAIL_RATE_LIMITED' }, 429);
  }
  return next();
}
```

Then apply it to the four send-family routes. Find each route declaration and insert `emailSendRateLimit` as middleware:

```ts
email.post('/send', emailSendRateLimit, async (c) => {
```

```ts
email.post('/messages/:id/reply', emailSendRateLimit, async (c) => {
```

```ts
email.post('/messages/:id/reply-all', emailSendRateLimit, async (c) => {
```

```ts
email.post('/messages/:id/forward', emailSendRateLimit, async (c) => {
```

(Do not change anything else in these four handler bodies.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/emailSendRateLimit.test.ts`
Expected: PASS (3 tests). If the "blocks once exceeded" test fails on the bucket-key format, check the actual key `rateLimitAllow` builds (`rl:${bucket}:${windowStart}` where `bucket` is what you pass in — here `email-send:42`) and adjust the test's seeded key to match exactly.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no new errors

- [ ] **Step 6: Commit**

```bash
git add src/routes/email.ts tests/emailSendRateLimit.test.ts
git commit -m "feat(email): rate-limit send/reply/forward to 20 per 5 minutes per user"
```

---

### Task 3: Wire real writes to `email_audit_log`

**Files:**
- Create: `src/utils/emailAudit.ts`
- Modify: `src/routes/email.ts` — call the new helper from `POST /send` (via `enqueueAndSend`), `POST /messages/:id/reply`, `POST /messages/:id/reply-all`, `POST /messages/:id/forward`, `DELETE /messages/:id`
- Test: `tests/emailAudit.test.ts` (new)

**Interfaces:**
- Consumes: `execute(db: D1Database, sql: string, ...params: unknown[])` from `src/utils/db.ts` (already exists, used throughout `email.ts`).
- Produces: `auditEmailAction(env: Bindings, opts: { userId: number; username?: string | null; action: 'send' | 'reply' | 'reply_all' | 'forward' | 'delete'; toAddresses?: string[]; ccAddresses?: string[]; subject?: string; graphMessageId?: string; status: 'sent' | 'failed'; error?: string }): Promise<void>` from `src/utils/emailAudit.ts`. Never throws — logs and swallows on failure (audit writes must never break the send path).

- [ ] **Step 1: Write the failing test**

Create `tests/emailAudit.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { auditEmailAction } from '../src/utils/emailAudit';

function fakeDb(runFn: (sql: string, params: unknown[]) => void) {
  return {
    prepare: (sql: string) => ({
      bind: (...params: unknown[]) => ({
        run: async () => { runFn(sql, params); return { success: true }; },
      }),
    }),
  } as unknown as D1Database;
}

describe('auditEmailAction', () => {
  it('writes a row to email_audit_log with the expected fields', async () => {
    let capturedSql = '';
    let capturedParams: unknown[] = [];
    const db = fakeDb((sql, params) => { capturedSql = sql; capturedParams = params; });
    const env = { DB: db } as any;

    await auditEmailAction(env, {
      userId: 7,
      username: 'jdoe',
      action: 'send',
      toAddresses: ['a@x.com', 'b@y.com'],
      ccAddresses: [],
      subject: 'Case update',
      graphMessageId: 'AAMk123',
      status: 'sent',
    });

    expect(capturedSql).toContain('INSERT INTO email_audit_log');
    expect(capturedParams).toContain(7);
    expect(capturedParams).toContain('jdoe');
    expect(capturedParams).toContain(JSON.stringify(['a@x.com', 'b@y.com']));
    expect(capturedParams).toContain('Case update');
    expect(capturedParams).toContain('AAMk123');
    expect(capturedParams).toContain('sent');
  });

  it('records a failed send with the error message', async () => {
    let capturedParams: unknown[] = [];
    const db = fakeDb((_sql, params) => { capturedParams = params; });
    const env = { DB: db } as any;

    await auditEmailAction(env, {
      userId: 7,
      action: 'send',
      toAddresses: ['a@x.com'],
      subject: 'Case update',
      status: 'failed',
      error: 'Graph 429: throttled',
    });

    expect(capturedParams).toContain('failed');
    expect(capturedParams).toContain('Graph 429: throttled');
  });

  it('never throws even if the DB write fails', async () => {
    const db = {
      prepare: () => ({ bind: () => ({ run: async () => { throw new Error('D1 down'); } }) }),
    } as unknown as D1Database;
    const env = { DB: db } as any;

    await expect(auditEmailAction(env, {
      userId: 7, action: 'send', toAddresses: ['a@x.com'], subject: 'x', status: 'sent',
    })).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/emailAudit.test.ts`
Expected: FAIL — `src/utils/emailAudit.ts` does not exist.

- [ ] **Step 3: Implement `src/utils/emailAudit.ts`**

```ts
// Writes to email_audit_log (migration 0082_email_integration.sql). That
// table existed with zero writers before this file — GET /audit in
// email.ts read email_outbox instead, which only captures original sends,
// missing reply/forward/delete and rule-triggered moves. This is the
// write side; audit writes must never break the send path they're
// observing, so every failure here is caught and logged, never thrown.
import { execute } from './db';
import { log } from './logger';
import type { Bindings } from '../types';

export type EmailAuditAction = 'send' | 'reply' | 'reply_all' | 'forward' | 'delete';

export interface EmailAuditOpts {
  userId: number;
  username?: string | null;
  action: EmailAuditAction;
  toAddresses?: string[];
  ccAddresses?: string[];
  subject?: string;
  graphMessageId?: string;
  status: 'sent' | 'failed';
  error?: string;
}

export async function auditEmailAction(env: Bindings, opts: EmailAuditOpts): Promise<void> {
  try {
    await execute(
      env.DB,
      `INSERT INTO email_audit_log
        (sent_by, sent_by_username, to_addresses, cc_addresses, subject, graph_message_id, status, error, sent_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      opts.userId,
      opts.username ?? null,
      JSON.stringify(opts.toAddresses || []),
      opts.ccAddresses && opts.ccAddresses.length ? JSON.stringify(opts.ccAddresses) : null,
      `[${opts.action}] ${opts.subject || ''}`.trim(),
      opts.graphMessageId ?? null,
      opts.status,
      opts.error ?? null,
    );
  } catch (err) {
    log.error('Failed to write email_audit_log row', { action: opts.action, userId: opts.userId }, err);
  }
}
```

Note: `subject` is prefixed with `[action]` rather than adding a new `action` column, because `email_audit_log`'s schema (migration 0082) has no `action` column and this phase does not touch schema/migrations. This keeps `send` vs `reply` vs `forward` vs `delete` distinguishable in the existing `subject` text column without an ALTER TABLE.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/emailAudit.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Wire callers in `src/routes/email.ts`**

First, add the import near the top (with the other `../utils/*` imports):

```ts
import { auditEmailAction } from '../utils/emailAudit';
```

**5a. `POST /send`** — currently:

```ts
email.post('/send', emailSendRateLimit, async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json().catch(() => ({})) as SendInput;
  if (!parseAddrList(body.to).length) return c.json({ error: 'At least one recipient required' }, 400);
  const payload = buildSendPayload(body);
  const r = await enqueueAndSend(c.env, userId, payload);
  if (r.status === 'sent') return c.json({ success: true, outboxId: r.outboxId });
  return c.json({ success: false, queued: true, outboxId: r.outboxId, error: r.error }, 202);
});
```

Replace with:

```ts
email.post('/send', emailSendRateLimit, async (c) => {
  const userId = c.get('userId');
  const user = c.get('user') as { username?: string } | undefined;
  const body = await c.req.json().catch(() => ({})) as SendInput;
  const toAddrs = parseAddrList(body.to);
  if (!toAddrs.length) return c.json({ error: 'At least one recipient required' }, 400);
  const payload = buildSendPayload(body);
  const r = await enqueueAndSend(c.env, userId, payload);
  await auditEmailAction(c.env, {
    userId, username: user?.username, action: 'send',
    toAddresses: toAddrs.map((a) => a.emailAddress.address),
    ccAddresses: parseAddrList(body.cc).map((a) => a.emailAddress.address),
    subject: body.subject,
    status: r.status === 'sent' ? 'sent' : 'failed',
    error: r.error,
  });
  if (r.status === 'sent') return c.json({ success: true, outboxId: r.outboxId });
  return c.json({ success: false, queued: true, outboxId: r.outboxId, error: r.error }, 202);
});
```

**5b. `POST /messages/:id/reply`** — currently:

```ts
email.post('/messages/:id/reply', emailSendRateLimit, async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({})) as { body?: string; comment?: string };
  try {
    const res = await graphFetch(c.env, `/me/messages/${encodeURIComponent(id)}/reply`, {
      method: 'POST',
      body: JSON.stringify({ comment: body.body || body.comment || '' }),
    });
    if (!res.ok) return c.json({ success: false, error: `Graph ${res.status}` }, 502);
    return c.json({ success: true });
  } catch (err: unknown) {
    return c.json({ success: false, error: err instanceof Error ? err.message : 'Failed' }, 502);
  }
});
```

Replace with:

```ts
email.post('/messages/:id/reply', emailSendRateLimit, async (c) => {
  const id = c.req.param('id');
  const userId = c.get('userId');
  const user = c.get('user') as { username?: string } | undefined;
  const body = await c.req.json().catch(() => ({})) as { body?: string; comment?: string };
  try {
    const res = await graphFetch(c.env, `/me/messages/${encodeURIComponent(id)}/reply`, {
      method: 'POST',
      body: JSON.stringify({ comment: body.body || body.comment || '' }),
    });
    const ok = res.ok;
    await auditEmailAction(c.env, {
      userId, username: user?.username, action: 'reply',
      graphMessageId: id, status: ok ? 'sent' : 'failed',
      error: ok ? undefined : `Graph ${res.status}`,
    });
    if (!ok) return c.json({ success: false, error: `Graph ${res.status}` }, 502);
    return c.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed';
    await auditEmailAction(c.env, { userId, username: user?.username, action: 'reply', graphMessageId: id, status: 'failed', error: msg });
    return c.json({ success: false, error: msg }, 502);
  }
});
```

**5c. `POST /messages/:id/reply-all`** — apply the identical pattern as 5b, with `action: 'reply_all'` in both `auditEmailAction` calls.

**5d. `POST /messages/:id/forward`** — currently:

```ts
email.post('/messages/:id/forward', emailSendRateLimit, async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({})) as { to?: string | string[]; body?: string; comment?: string };
  const toRecipients = parseAddrList(body.to);
  if (!toRecipients.length) return c.json({ error: 'At least one recipient required' }, 400);
  try {
    const res = await graphFetch(c.env, `/me/messages/${encodeURIComponent(id)}/forward`, {
      method: 'POST',
      body: JSON.stringify({ comment: body.body || body.comment || '', toRecipients }),
    });
    if (!res.ok) return c.json({ success: false, error: `Graph ${res.status}` }, 502);
    return c.json({ success: true });
  } catch (err: unknown) {
    return c.json({ success: false, error: err instanceof Error ? err.message : 'Failed' }, 502);
  }
});
```

Replace with:

```ts
email.post('/messages/:id/forward', emailSendRateLimit, async (c) => {
  const id = c.req.param('id');
  const userId = c.get('userId');
  const user = c.get('user') as { username?: string } | undefined;
  const body = await c.req.json().catch(() => ({})) as { to?: string | string[]; body?: string; comment?: string };
  const toRecipients = parseAddrList(body.to);
  if (!toRecipients.length) return c.json({ error: 'At least one recipient required' }, 400);
  try {
    const res = await graphFetch(c.env, `/me/messages/${encodeURIComponent(id)}/forward`, {
      method: 'POST',
      body: JSON.stringify({ comment: body.body || body.comment || '', toRecipients }),
    });
    const ok = res.ok;
    await auditEmailAction(c.env, {
      userId, username: user?.username, action: 'forward',
      toAddresses: toRecipients.map((r) => r.emailAddress.address),
      graphMessageId: id, status: ok ? 'sent' : 'failed',
      error: ok ? undefined : `Graph ${res.status}`,
    });
    if (!ok) return c.json({ success: false, error: `Graph ${res.status}` }, 502);
    return c.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed';
    await auditEmailAction(c.env, {
      userId, username: user?.username, action: 'forward',
      toAddresses: toRecipients.map((r) => r.emailAddress.address),
      graphMessageId: id, status: 'failed', error: msg,
    });
    return c.json({ success: false, error: msg }, 502);
  }
});
```

**5e. `DELETE /messages/:id`** — currently:

```ts
email.delete('/messages/:id', async (c) => {
  const id = c.req.param('id');
  try {
    const res = await graphFetch(c.env, `/me/messages/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) return c.json({ success: false, error: `Graph ${res.status}` }, 502);
    return c.json({ success: true });
  } catch (err: unknown) {
    return c.json({ success: false, error: err instanceof Error ? err.message : 'Failed' }, 502);
  }
});
```

Replace with:

```ts
email.delete('/messages/:id', async (c) => {
  const id = c.req.param('id');
  const userId = c.get('userId');
  const user = c.get('user') as { username?: string } | undefined;
  try {
    const res = await graphFetch(c.env, `/me/messages/${encodeURIComponent(id)}`, { method: 'DELETE' });
    const ok = res.ok || res.status === 404;
    await auditEmailAction(c.env, {
      userId, username: user?.username, action: 'delete',
      graphMessageId: id, status: ok ? 'sent' : 'failed',
      error: ok ? undefined : `Graph ${res.status}`,
    });
    if (!ok) return c.json({ success: false, error: `Graph ${res.status}` }, 502);
    return c.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed';
    await auditEmailAction(c.env, { userId, username: user?.username, action: 'delete', graphMessageId: id, status: 'failed', error: msg });
    return c.json({ success: false, error: msg }, 502);
  }
});
```

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no new errors. If `c.get('user')` isn't typed with a `username` field, check `src/types.ts`'s `Variables` interface for the actual shape and adjust the cast to match (do not invent a field that doesn't exist on the JWT payload — read `src/middleware/auth.ts` to confirm what `c.set('user', ...)` actually stores).

- [ ] **Step 7: Run full email test suite**

Run: `npx vitest run tests/emailAudit.test.ts tests/emailSend.test.ts tests/emailSendRateLimit.test.ts tests/emailSearch.test.ts`
Expected: all PASS

- [ ] **Step 8: Commit**

```bash
git add src/utils/emailAudit.ts src/routes/email.ts tests/emailAudit.test.ts
git commit -m "feat(email): write every send/reply/forward/delete to email_audit_log"
```

---

### Task 4: Pre-check attachment size before queuing a send

**Files:**
- Modify: `src/utils/emailSend.ts` — add a size-check helper
- Modify: `src/routes/email.ts` — call it in `POST /send` before `enqueueAndSend`
- Test: `tests/emailSend.test.ts` (extend existing file)

**Interfaces:**
- Consumes: `SendAttachment` type from `src/utils/emailSend.ts` (already exists: `{ name?: string; contentType?: string; contentBytes?: string }`).
- Produces: `MAX_TOTAL_ATTACHMENT_BYTES = 25 * 1024 * 1024` constant and `totalAttachmentBytes(atts: SendAttachment[] | undefined): number` function, both exported from `src/utils/emailSend.ts`.

- [ ] **Step 1: Write the failing test**

Append to `tests/emailSend.test.ts` (existing file — add a new `describe` block; don't touch the existing `parseAddrList`/`mapAttachments` describes):

```ts
import { totalAttachmentBytes, MAX_TOTAL_ATTACHMENT_BYTES } from '../src/utils/emailSend';

describe('totalAttachmentBytes', () => {
  it('returns 0 for no attachments', () => {
    expect(totalAttachmentBytes(undefined)).toBe(0);
    expect(totalAttachmentBytes([])).toBe(0);
  });

  it('sums decoded byte length from base64 contentBytes', () => {
    // 'AAAA' base64-decodes to 3 raw bytes
    const atts = [{ name: 'a', contentBytes: 'AAAA' }, { name: 'b', contentBytes: 'AAAA' }];
    expect(totalAttachmentBytes(atts)).toBe(6);
  });

  it('ignores attachments with no contentBytes', () => {
    const atts = [{ name: 'a' }, { name: 'b', contentBytes: 'AAAA' }];
    expect(totalAttachmentBytes(atts)).toBe(3);
  });

  it('MAX_TOTAL_ATTACHMENT_BYTES is 25MB', () => {
    expect(MAX_TOTAL_ATTACHMENT_BYTES).toBe(25 * 1024 * 1024);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/emailSend.test.ts`
Expected: FAIL — `totalAttachmentBytes` and `MAX_TOTAL_ATTACHMENT_BYTES` are not exported from `src/utils/emailSend.ts`.

- [ ] **Step 3: Implement in `src/utils/emailSend.ts`**

Add at the end of the file (after `buildSendPayload`):

```ts
// Graph rejects inline attachments over ~4MB each and a message over
// ~35MB total via the sendMail API. We cap well under that (25MB total)
// so an oversized send fails fast with a clear message instead of
// queuing into email_outbox and burning a retry cycle on a doomed Graph
// call. atob() is available in the Workers runtime (no node:buffer).
export const MAX_TOTAL_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export function totalAttachmentBytes(atts: SendAttachment[] | undefined): number {
  if (!atts || !atts.length) return 0;
  let total = 0;
  for (const a of atts) {
    if (!a.contentBytes) continue;
    // base64 decoded length: 4 chars -> 3 bytes, minus padding
    const b64 = a.contentBytes;
    const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
    total += Math.floor((b64.length * 3) / 4) - padding;
  }
  return total;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/emailSend.test.ts`
Expected: PASS (all tests in the file, existing + new)

- [ ] **Step 5: Wire the check into `POST /send`**

In `src/routes/email.ts`, import the new exports (add to the existing `../utils/emailSend` import line):

```ts
import {
  parseAddrList, mapAttachments, buildSendPayload, totalAttachmentBytes, MAX_TOTAL_ATTACHMENT_BYTES,
  type SendAttachment, type SendInput,
} from '../utils/emailSend';
```

Then in `POST /send` (as modified by Task 3, Step 5a), insert the check right after the recipient check and before `buildSendPayload`:

```ts
email.post('/send', emailSendRateLimit, async (c) => {
  const userId = c.get('userId');
  const user = c.get('user') as { username?: string } | undefined;
  const body = await c.req.json().catch(() => ({})) as SendInput;
  const toAddrs = parseAddrList(body.to);
  if (!toAddrs.length) return c.json({ error: 'At least one recipient required' }, 400);
  const attBytes = totalAttachmentBytes(body.attachments);
  if (attBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
    return c.json({
      error: `Attachments total ${(attBytes / 1024 / 1024).toFixed(1)}MB, max ${MAX_TOTAL_ATTACHMENT_BYTES / 1024 / 1024}MB per message`,
      code: 'ATTACHMENTS_TOO_LARGE',
    }, 413);
  }
  const payload = buildSendPayload(body);
  const r = await enqueueAndSend(c.env, userId, payload);
  await auditEmailAction(c.env, {
    userId, username: user?.username, action: 'send',
    toAddresses: toAddrs.map((a) => a.emailAddress.address),
    ccAddresses: parseAddrList(body.cc).map((a) => a.emailAddress.address),
    subject: body.subject,
    status: r.status === 'sent' ? 'sent' : 'failed',
    error: r.error,
  });
  if (r.status === 'sent') return c.json({ success: true, outboxId: r.outboxId });
  return c.json({ success: false, queued: true, outboxId: r.outboxId, error: r.error }, 202);
});
```

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no new errors

- [ ] **Step 7: Run full email test suite**

Run: `npx vitest run tests/emailSend.test.ts tests/emailAudit.test.ts tests/emailSendRateLimit.test.ts tests/emailSearch.test.ts`
Expected: all PASS

- [ ] **Step 8: Commit**

```bash
git add src/utils/emailSend.ts src/routes/email.ts tests/emailSend.test.ts
git commit -m "feat(email): reject sends over 25MB total attachments before queuing"
```

---

### Task 5: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full worker test suite**

Run: `npx vitest run`
Expected: all files pass, including the 4 new/modified test files from Tasks 1-4. Per project convention, run the FULL suite, not just the targeted email tests — a red test has hidden behind green targeted runs before in this repo.

- [ ] **Step 2: Run worker typecheck**

Run: `npm run typecheck`
Expected: 0 errors

- [ ] **Step 3: Run client typecheck (this phase touches no client code, but confirm nothing else in the tree is broken)**

Run: `cd client && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 4: Manual sanity check — read the final diff**

Run: `git diff main --stat` (or `git log --oneline main..HEAD`)
Expected: exactly 4 feature commits (Tasks 1-4) touching `src/routes/email.ts`, `src/utils/emailSend.ts`, `src/utils/emailAudit.ts` (new), and 4 test files (3 new: `emailSearch.test.ts`, `emailSendRateLimit.test.ts`, `emailAudit.test.ts`; 1 extended: `emailSend.test.ts`). No migration files — this phase deliberately required none.

- [ ] **Step 5: Final commit if any cleanup was needed**

If Steps 1-3 required fixes, commit them separately with a clear message before considering Phase 1 done. If everything passed clean, no action needed here.
