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

**Fix:** Add a small `auditEmailAction(env, userId, action, meta)` helper writing to `email_audit_log`. Call it from every mutating path: `/send` (already have outbox, add this too), `/messages/:id/reply`, forward, `/messages/:id` (delete), and rule-triggered Graph patches in `runEmailPoll`. Keep `GET /audit` as-is (outbox-based, used by `AdminEmailAuditTab`) for now — this phase only makes the write-side complete; wiring `/audit` to prefer the richer table is a follow-up once the table has data to show.

### 4.4 Attachment size cap on send

**Problem:** `buildSendPayload` (in `emailSend.ts`) has no size check before handing attachments to Graph. Graph itself rejects inline attachments over ~4MB (and total message over ~35MB via API), but today that surfaces as an opaque Graph error at send time — after the user has already queued/attempted the send.

**Fix:** Pre-check total attachment bytes in `POST /send` before calling `enqueueAndSend`; return `413` with a clear message (`"Attachments total {size}, max 25MB per message"`) rather than letting a doomed request hit the outbox and burn a retry cycle.

## 5. Phase 2 — At-rest encryption (design sketch, implemented later)

Extend the AES-GCM pattern already used for OAuth secrets (`emailCrypto.ts`) to `email_messages.body_preview` and `email_scheduled.body`/`to_addresses`. Follow the envelope-encryption shape in `src/utils/encryptedR2.ts` (per-row DEK wrapped by a master KEK) rather than reusing the single static key in `emailCrypto.ts` — that key is fine for a handful of OAuth secret rows, not for a growing table of message bodies. Decrypt on read in `/messages/search` and any future full-body cache. Full plan written when this phase starts.

## 6. Phase 3 — Per-user mailboxes (design sketch)

New `user_graph_tokens (user_id, access_token_enc, refresh_token_enc, expires_at, scopes)`. `ensureValidToken`/`graphFetch` take a `userId` param instead of reading the single tenant grant. Poller iterates enrolled users. `email_messages` gets `owner_user_id` (already exists — poller currently writes the OAuth initiator's ID to every row; this phase makes it actually vary per real mailbox owner). Admin UI: "Connect your mailbox" enrollment per user, replacing the current single admin-configured OAuth flow (which becomes tenant-app-registration only, not the per-mailbox grant).

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
