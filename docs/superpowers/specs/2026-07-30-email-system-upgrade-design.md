# Email System — Full-Scale Upgrade — Design

**Date:** 2026-07-30
**Status:** Approved, pending implementation plan (Phase 1)
**Scope:** 5 phases, each an independently shippable PR. This document sequences all 5; each phase gets its own `writing-plans` implementation plan when its turn comes.

---

## 1. Context

The RMPG Flex email subsystem lives entirely in the Cloudflare Worker (`src/routes/email.ts`, ~2,500 lines) — a single-tenant Microsoft Graph integration. **The 2026-04-14 `docs/plans/email-enhancement-*.md` documents are stale**: they describe the retired VPS Express/better-sqlite3 architecture and should be disregarded.

The current (verified by reading source) system already has:

| Capability | Where |
|---|---|
| OAuth (single tenant grant, CSRF-protected callback, token refresh) | `email.ts` admin/oauth routes |
| Secret encryption (AES-GCM, JWT_SECRET-derived key) | `src/utils/emailCrypto.ts` |
| Send/reply/forward via durable outbox + cron retry with backoff | `enqueueAndSend`, `drainEmailOutbox` |
| Rules engine (from/subject substring or bounded regex, mark-read/flag/move/categorize) | `matchRule`, `runEmailPoll` |
| Autolinker (CFS numbers, plates — DB-existence gated to avoid false positives) | `runAutolinker` |
| Cached search (D1 `email_messages` LIKE) | `GET /messages/search` |
| Attachment/image proxy hardening (content-type allowlist, CSP, auth-gated) | `/messages/:id/attachments/:aid`, `/image-proxy` |
| Templates, scheduled send, thread grouping | `email_templates`, `email_scheduled`, `GET /threads` |
| Blocked senders (junk on poll) | `email_blocked_senders` |

"Full-scale upgrade" therefore means closing specific, verified gaps — not rebuilding.

## 2. Goals

Harden and extend the existing system across 5 ordered phases:

1. Security hardening (rate limiting, search correctness, audit completeness, attachment size caps)
2. At-rest encryption of cached email bodies
3. Per-user mailboxes (replace the single shared tenant grant)
4. CAD/RMS integration depth (broader autolink, PII redaction, tip-line pipeline)
5. S/MIME (outbound signing/encryption)

## 3. Non-goals

- Rebuilding anything already shipped (templates, scheduled send, thread view, rules CRUD, autolinker skeleton).
- Read receipts / delivery tracking.
- Attachment virus scanning (Graph/M365 handle this upstream).
- Rich-text compose editor overhaul.

## 4. Phase 1 — Security hardening (this implementation cycle)

### 4.1 Search correctness (`GET /messages/search`)

**Problem:** `like = %${q.replace(...)}%` is bound as a plain D1 parameter. Per project memory (`feedback_d1_like_pattern_50_char_cap`), D1's `LIKE` silently stops matching past ~48-50 characters of *pattern* — not an error, just wrong results for long queries. Today's query strings are short (subject/name searches), so this is latent, not yet triggering — but it's the same bug class that has bitten other D1 LIKE call sites in this repo.

**Fix:** Cap the search query length before building the pattern (reject/truncate anything that would approach the cap — 40 chars is a safe ceiling for a `%...%` wrap) and add a code comment referencing the constraint so a future caller doesn't reintroduce a long-pattern search. No index change needed; `email_messages` search volume doesn't justify FTS5 yet (deferred — see Phase 4 note on search depth if it becomes necessary).

### 4.2 Send rate limiting

**Problem:** `POST /send` (and reply/forward) is covered only by the generic `apiRateLimit` (600 req/5min per user) — sized for read-heavy dispatch polling, not send abuse. A compromised session or buggy client retry loop could burn through Graph's tenant-wide send quota (shared across the whole org, since it's one mailbox) or trip Microsoft's abuse detection, locking out the department's real mail.

**Fix:** New `emailSendRateLimit` middleware using the existing `rateLimitAllow(env.KV, key, limit, windowSeconds)` primitive (same one `apiRateLimit`/`auth.ts`/`ai.ts` already use — no new infra). Limit: 20 sends per 5 minutes per user (generous for legitimate dispatcher/officer use, well under anything that would trip Graph). Applied to `/send`, `/messages/:id/reply`, and the forward path.

### 4.3 Audit completeness

**Problem:** `email_audit_log` table exists in the schema (migration `0082_email_integration.sql`) but is never written — `GET /audit` reads `email_outbox` instead, which only captures original sends, not reply/forward/delete/rule-triggered moves. A supervisor reviewing "who sent what" today has a real but incomplete picture.

**Fix:** Add a small `auditEmailAction(env, userId, action, meta)` helper writing to `email_audit_log`. Call it from every mutating path: `/send` (already have outbox, add this too), `/messages/:id/reply`, forward, `/messages/:id` (delete). Keep `GET /audit` as-is (outbox-based, used by `AdminEmailAuditTab`) for now — this phase only makes the write-side complete; wiring `/audit` to prefer the richer table is a follow-up once the table has data to show.

**Deferred (not implemented this phase):** rule-triggered Graph patches applied automatically by `runEmailPoll` (mark-read/flag/move) are NOT audited. `runEmailPoll` runs as a scheduled cron job against a single shared tenant mailbox — it has no per-request authenticated user to attribute an audit row to, so wiring it into `auditEmailAction` (which is keyed on `userId`) is a meaningfully bigger change than the per-request routes above. Tracked as future work, not part of Phase 1 audit completeness.

### 4.4 Attachment size cap on send

**Problem:** `buildSendPayload` (in `emailSend.ts`) has no size check before handing attachments to Graph. Graph itself rejects inline attachments over ~4MB (and total message over ~35MB via API), but today that surfaces as an opaque Graph error at send time — after the user has already queued/attempted the send.

**Fix:** Pre-check total attachment bytes in `POST /send` before calling `enqueueAndSend`; return `413` with a clear message (`"Attachments total {size}, max 25MB per message"`) rather than letting a doomed request hit the outbox and burn a retry cycle.

## 5. Phase 2 — At-rest encryption of cached email content

**Status:** Approved 2026-07-30, ready for implementation plan.

### 5.1 Envelope pattern

New `src/utils/emailFieldCrypto.ts`, mirroring the shape of `src/utils/encryptedR2.ts` (per-value fresh random DEK, wrapped by a master KEK) rather than reusing `emailCrypto.ts`'s single static-key approach — that key is fine for a handful of OAuth secret rows, not appropriate for a growing table of message content. Unlike the R2 case (one `file_encryption_keys` D1 row per file), these are inline TEXT columns, so the wrapped DEK and both IVs are packed into the stored string itself rather than a separate table:

```
v2:<base64 wrapped_dek>:<base64 dek_iv>:<base64 field_iv>:<base64 ciphertext>
```

New secret: `EMAIL_FIELD_ENCRYPTION_KEK` (distinct from `FILE_ENCRYPTION_KEK` — different blast radius; a compromised email KEK shouldn't also expose file encryption, and vice versa). Set via `wrangler secret put EMAIL_FIELD_ENCRYPTION_KEK`; local dev via `.dev.vars`.

Exports: `encryptField(env, plaintext: string): Promise<string>`, `decryptFieldIfEncrypted(env, stored: string): Promise<string>` — the latter checks for the `v2:` prefix and passes the value through unmodified if absent (mirrors `emailCrypto.ts`'s `v1:` legacy-tolerant check), so pre-existing plaintext rows keep working with **no backfill migration**.

**Fails closed** (unlike `emailCrypto.ts`'s graceful `JWT_SECRET` fallback, matching `encryptedR2.ts`'s posture): a missing/malformed KEK throws `EmailFieldEncryptionError` rather than silently storing plaintext — silently skipping encryption here would defeat the feature without anyone noticing.

### 5.2 Scope

Encrypted: `email_messages.body_preview`, `email_scheduled.body`, `email_scheduled.to_addresses`, `email_scheduled.cc_addresses`.

Left plaintext: `email_messages.subject`, `from_address`, `from_name` — needed for list views and the existing `GET /messages/search` LIKE query; encrypting them would either break search entirely or require a much heavier searchable-encryption scheme not justified at this scale.

### 5.3 Search behavior change

`GET /messages/search`'s `LIKE` clause narrows to `subject OR from_address` only — `body_preview` drops out of the WHERE clause, since ciphertext can't be LIKE-matched. Code comment explains why, so a future reader doesn't "fix" it by decrypting rows in a loop (which would defeat pagination/performance).

### 5.4 Write/read paths

- `runEmailPoll`'s `email_messages` upsert: encrypt `body_preview` before the `INSERT ... ON CONFLICT`.
- `POST /schedule`: encrypt `body`/`to_addresses`/`cc_addresses` before the `INSERT INTO email_scheduled`.
- `drainScheduledEmails` (the cron drain that reads pending `email_scheduled` rows and builds the Graph payload): decrypt before use.
- Any handler that reads `body_preview` back out for display (message list, search results): decrypt-tolerant on the way out.

### 5.5 Non-goals for this phase

- No backfill of existing plaintext rows — decrypt-tolerant reads make this unnecessary; old rows age out naturally as the poller's upsert cycle touches them again (though note: the upsert only re-writes `is_read`/`is_flagged`/`categories`/`body_preview` on conflict, so `body_preview` specifically DOES get re-encrypted on the next poll touch — full text of this needs verifying against the actual `ON CONFLICT` clause when the plan is written).
- No encryption of `email_outbox.payload` or `email_audit_log` fields in this phase — those are Phase 1 territory (already shipped) and out of scope for this pass; revisit only if a future audit flags them.

## 6. Phase 3 — Per-user mailboxes

**Status:** Approved 2026-07-30, ready for implementation plan.

**Confirmed intent**: this is a genuine cutover from a shared departmental mailbox to personal per-officer O365 mailboxes — each user connects and sees their own inbox, not a jointly-monitored shared one. The autolinker, rules engine, and tip-line pipeline become per-user features rather than org-wide. Hard cutover, no dual-mode: a user with no personal connection sees a "Connect your mailbox" prompt instead of an inbox, not a fallback shared view.

### 6.1 New table

```sql
CREATE TABLE IF NOT EXISTS user_graph_tokens (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  access_token_enc TEXT NOT NULL,
  refresh_token_enc TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  mailbox TEXT,
  connected_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Encrypted via the EXISTING `src/utils/emailCrypto.ts` (`encryptSecret`/`decryptSecret`) — not Phase 2's per-value envelope crypto, which was built for bulk cached message content, not a handful of per-user auth-secret rows. This matches how the admin's Azure client secret is already encrypted today.

### 6.2 Auth flow split

- Azure app registration (`ms_email_client_id`/`ms_email_client_secret`/`ms_email_tenant_id` in `system_config`) stays admin-configured, org-wide, unchanged — one Azure AD app, many personal OAuth grants against it.
- New `GET /connect/authorize` (any authenticated user, NOT admin-gated) — generates a CSRF state token, but instead of the singleton `ms_email_oauth_initiator` config key, stores the state→userId mapping keyed per-request (e.g. `system_config` row `email_connect_state_<random>` = userId, single-use, deleted on consume — same atomic compare-and-delete pattern the existing callback already uses for CSRF).
- New `GET /connect/callback` (public, mirrors today's `/oauth/callback` exactly in structure) — consumes the state, recovers the owning userId, exchanges the code, writes `user_graph_tokens` for THAT user.
- `DELETE /connect` — disconnect the current user's own mailbox (clears their `user_graph_tokens` row).
- The old admin `/admin/oauth/authorize` + shared `/oauth/callback` are retired. `/admin/test-connection` changes meaning: it now validates the Azure app registration itself (client credentials grant, or a lightweight discovery call) rather than testing a live user token, since there's no longer a single admin-owned token to test.

### 6.3 Core refactor: `ensureValidToken`/`graphFetch` take `userId`

```ts
async function ensureValidToken(env: Bindings, userId: number): Promise<string>
async function graphFetch(env: Bindings, userId: number, path: string, init?: RequestInit): Promise<Response>
```

This is the largest mechanical piece of the phase — **57 existing `graphFetch` call sites** across `src/routes/email.ts` need `c.get('userId')` (route handlers) or a poller-loop `userId` variable threaded through. Grouped into implementation tasks by route category (not one diff) — see the Phase 3 implementation plan when written.

### 6.4 Poller

`runEmailPoll` iterates `SELECT user_id FROM user_graph_tokens`, running today's per-user logic (it already writes `owner_user_id` — this phase makes that vary for real instead of always being the one `oauthInitiator`) once per enrolled user. A single user's poll failure (expired token, Graph error) must not block others' — wrap each user's poll iteration in its own try/catch, matching the existing per-message best-effort pattern inside a single poll.

### 6.5 Migration (best-effort, data-preserving)

A one-time step moves the CURRENT `ms_email_access_token`/`ms_email_refresh_token`/`ms_email_mailbox` (owned by whoever is recorded in `ms_email_oauth_initiator`) into a `user_graph_tokens` row for that same user — so the person who originally set this up doesn't lose access on deploy day. Best-effort: if the initiator config is missing or the token is already expired, log and skip (nobody is worse off than a fresh "reconnect" prompt). Every other user connects fresh.

### 6.6 Client changes

- `EmailPage.tsx`: gate on whether the current user has a `user_graph_tokens` row (new `GET /connect/status` or extend existing `/status`). No row → "Connect your mailbox" prompt instead of the inbox.
- `AdminEmailTab.tsx`: narrows to Azure app-registration credentials only (clientId/secret/tenantId, enable/pollInterval). Drop the shared authorize/enable-for-everyone UI — that's now per-user, done from `EmailPage.tsx` itself, not the admin tab.

### 6.7 Non-goals for this phase

- No migration of existing cached `email_messages`/`email_scheduled` rows to a "real" owner beyond the one best-effort migrated user — old cached mail under the previous shared identity is simply historical; it doesn't need to be reassigned.
- No per-user rate-limit tuning — Phase 1's `emailSendRateLimit` (20/5min per user) already keys by `userId`, so it works unchanged under per-user mailboxes with no code change.
- No UI for admins to see WHO has/hasn't connected their mailbox in this phase — worth a future addition, not blocking this cutover.

## 7. Phase 4 — CAD/RMS integration depth (design sketch)

- Extend `runAutolinker`'s regex set beyond CFS/plate to case numbers, incident numbers, warrant numbers — same DB-existence-gate pattern to avoid spam false-positives.
- PII redaction preview (SSN/DL/DOB/phone patterns) before forwarding to a domain outside an allowlist — `409` with a diff preview, client confirms, resubmits.
- Tip-line pipeline: emails landing in a configured folder auto-create a `pending_review` `calls_for_service` row.
- If search volume grows enough to need real full-text (not just longer LIKE), add FTS5 here rather than in Phase 1 — YAGNI until proven necessary.

## 8. Phase 5 — S/MIME (design sketch)

Deferred until cert/key management is scoped — heaviest lift, no dependents block on it.

## 9. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Rate limit too tight, blocks legitimate bulk sends (e.g. mass notification) | 20/5min is per-user; a dispatcher sending to a distribution list is one send, not N. Tunable via the same KV-backed limiter other routes use. |
| Audit table write adds latency to hot send path | Fire via the same `waitUntil`-friendly pattern already used for Graph-side rule actions; never blocks the response. |
| Search cap change breaks an existing long-query caller | No client code sends queries near 40 chars today (verified: `EmailPage.tsx` search box is free text, unbounded, but never observed near this length in practice) — this is defensive, not correcting live breakage. |

## 10. Next step

Invoke `superpowers:writing-plans` to produce a step-by-step implementation plan for **Phase 1** only.
