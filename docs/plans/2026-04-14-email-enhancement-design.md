# Email System Enhancement — Design

**Date:** 2026-04-14
**Status:** Approved, pending implementation plan
**Scope:** Phases 1–3 in a single mega-PR (stacked internally); Phase 4 as a follow-up PR.

---

## 1. Context

The RMPG Flex email subsystem is already broad:

| Layer | File | Role |
|---|---|---|
| Transport (out) | `server/src/utils/emailSender.ts` | Unified send — Graph first, SMTP fallback |
| Transport (Graph) | `server/src/utils/msGraphClient.ts` | OAuth + Graph client (single `/me/…` account today) |
| Transport (SMTP) | `server/src/utils/smtpClient.ts` | nodemailer fallback |
| Polling | `server/src/utils/emailPoller.ts` | Syncs inbox/sent/drafts/deleted/junk/archive + custom folders into `email_cache` |
| API | `server/src/routes/email.ts` (1,725 lines) | Folders, messages, send, reply/forward, templates, contacts, email↔incident links, scheduled sends, admin, flagged, categorize, threads, image-proxy |
| UI | `client/src/pages/EmailPage.tsx` (2,590 lines) | Mailbox, compose, admin tab |

The system is a single-mailbox Graph deployment. "Enhance" therefore means closing specific gaps — not building from scratch.

## 2. Gaps identified

1. **Fragile markdown renderer** in `emailPoller.ts:249-256` — no URL sanitization on links, XSS risk.
2. **Incomplete send auditing** — not every send path writes to `audit_log`.
3. **No full-text search** across cached email bodies; only metadata is indexed.
4. **No inbound rules engine** — can't auto-file, auto-flag, or auto-link by sender/subject/body pattern.
5. **No CAD/RMS auto-linking** — inbound emails referencing `Case #`, `Incident #`, `FI-YY-NNNNN`, `Citation #`, `CFS-YYYY-NNNN` are not linked automatically.
6. **No email-to-CFS pipeline** — tip-line emails can't auto-create calls.
7. **No PII redaction on external forward** — nothing prevents an officer from forwarding a victim statement to a .com address.
8. **No server-side test coverage** on any email path.
9. **No per-user mailboxes** — all users share the same Graph inbox.

## 3. Goals

- Harden what exists (Phase 1).
- Add server-side search and a rules engine (Phase 2).
- Wire inbound email into the CAD/RMS data graph (Phase 3).
- Move to per-user mailboxes (Phase 4, follow-up PR).

## 4. Non-goals

- S/MIME, DKIM signing, DMARC reporting.
- Read receipts / delivery tracking (Graph provides limited visibility; not worth the effort here).
- Attachment virus scanning (Graph + M365 handle this upstream).
- Email composition rich-text editor overhaul — out of scope.
- Desktop offline outbox queue — revisit separately.

## 5. Design by phase

### Phase 1 — Polish & harden

**New files**
- `server/src/utils/emailMarkdown.ts` — wraps `marked` + `DOMPurify`. Exports `renderEmailMarkdown(src: string): string`. Sanitizes URLs (reject `javascript:`, `data:` except images from allowlist, `vbscript:`).
- `server/src/utils/emailAudit.ts` — exports `auditEmailSend(req, action, meta)`. `action` ∈ `SEND | REPLY | REPLY_ALL | FORWARD | SCHEDULE_SEND | SCHEDULED_DELIVERED`. `meta` = `{to, cc, bcc, subject_hash, message_id, redacted_fields?, linked_entities?}`.

**Modified files**
- `server/src/utils/emailPoller.ts:249-256` — replace inline markdown with `renderEmailMarkdown`.
- `server/src/utils/emailSender.ts` — change return type from `Promise<boolean>` to `Promise<SendResult>`:
  ```ts
  type SendResult =
    | { ok: true; transport: 'graph' | 'smtp'; messageId?: string }
    | { ok: false; reason: 'auth_expired' | 'network' | 'rejected_recipient' | 'quota' | 'unknown'; detail: string };
  ```
  All callers updated to handle the discriminated union. Legacy boolean checks converted to `result.ok`.
- `server/src/routes/email.ts` — every send path (`/send`, `/reply`, `/reply-all`, `/forward`, `/schedule`, processScheduledEmails) calls `auditEmailSend` on success.

**New tests** (vitest, `server/src/__tests__/`)
- `emailSender.test.ts` — Graph success, Graph auth failure → SMTP success, both fail, structured error shape.
- `emailPoller.test.ts` — markdown renderer rejects `javascript:` URL, scheduled-email malformed JSON path.
- `emailAudit.test.ts` — every action writes a row to `audit_log` with expected fields.

**DB migrations:** none.

### Phase 2 — Full-text search + rules engine

**New tables** (added to `database.ts` via lazy `CREATE TABLE IF NOT EXISTS`)

```sql
-- FTS5 external-content table mirrored from email_cache
CREATE VIRTUAL TABLE IF NOT EXISTS email_cache_fts USING fts5(
  subject, from_address, from_name, body_text,
  content='email_cache', content_rowid='id',
  tokenize='porter unicode61'
);

-- 3 triggers to keep FTS in sync
CREATE TRIGGER IF NOT EXISTS email_cache_ai AFTER INSERT ON email_cache BEGIN
  INSERT INTO email_cache_fts(rowid, subject, from_address, from_name, body_text)
  VALUES (new.id, new.subject, new.from_address, new.from_name, html_to_text(new.body_html));
END;
-- ... ad / au triggers similar
```

`html_to_text` is a SQL UDF registered on better-sqlite3 at DB init — strips tags, collapses whitespace. Defined in `server/src/models/sqliteFunctions.ts`.

```sql
CREATE TABLE IF NOT EXISTS email_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 100,
  enabled INTEGER NOT NULL DEFAULT 1,
  conditions_json TEXT NOT NULL,   -- {sender_regex?, subject_regex?, body_contains?, has_attachment?, importance?}
  actions_json TEXT NOT NULL,       -- [{type: 'move'|'flag'|'categorize'|'link'|'forward', ...}]
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS email_rule_matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email_cache_id INTEGER NOT NULL,
  rule_id INTEGER NOT NULL,
  executed_at TEXT NOT NULL,
  action_result TEXT,               -- JSON per-action success/failure
  FOREIGN KEY (email_cache_id) REFERENCES email_cache(id) ON DELETE CASCADE,
  FOREIGN KEY (rule_id) REFERENCES email_rules(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_email_rule_matches_email ON email_rule_matches(email_cache_id);
```

**New files**
- `server/src/utils/emailRuleEngine.ts` — `evaluateRules(emailCacheId: number): Promise<RuleResult[]>`. Loads enabled rules by priority, evaluates conditions, executes actions. 50 ms/rule timeout. Failures logged to `email_rule_matches` with `action_result.error`, never throw out of `syncFolder`.
- `server/src/routes/emailRules.ts` — CRUD for `email_rules` (admin only). `POST /test-match` — takes a rule + optional email_cache_id, returns whether conditions match (no side effects).
- `server/src/__tests__/emailRules.test.ts` — condition matching, action execution, priority ordering, timeout handling.

**Modified files**
- `server/src/utils/emailPoller.ts` — after each `upsert.run(...)` in `syncFolder`, if `info.lastInsertRowid` (new insert), push `{emailCacheId}` onto an in-memory queue. After the DB transaction commits, drain the queue through `evaluateRules`. Separate TX keeps rule failures from rolling back the sync.
- `server/src/routes/email.ts` — new `GET /messages/search?q=&folder=&from=&after=&before=&has_attachment=&flagged=`. Uses FTS5 MATCH on `q`, joins back to `email_cache` for the projection. Paginate with `?limit=&offset=`.
- `server/src/index.ts` — mount `emailRules.ts` at `/api/email/rules`.
- `client/src/pages/EmailPage.tsx` — top-bar search input + results list (fall back to folder view when query empty).
- `client/src/pages/admin/AdminEmailTab.tsx` — new sub-tab "Rules" linking to:
- `client/src/pages/admin/AdminEmailRulesTab.tsx` (new) — rule list, enable toggle, priority reorder, edit modal with condition + action builder, "test against last 50 emails" preview.

### Phase 3 — CAD/RMS integration

**New files**
- `server/src/utils/emailAutoLinker.ts` — exports `extractEntityReferences(subject: string, bodyText: string): EntityRef[]`.
  - Regex set: `Case\s*#?\s*(\d{4}-[A-Z]{2}-\d{4,})`, `Incident\s*#?\s*(\d{2}-\d{4,})`, `(FI-\d{2}-\d{5,})`, `Citation\s*#?\s*(\d{4}-\d{4,})`, `CFS-(\d{4}-\d{4,})`.
  - For each match, verify the entity exists in the DB before linking (prevents linking to non-existent 404s from spam).
  - Domain allowlist check — only auto-link if sender domain is in `system_config['email_autolink_allowlist']` (default: `rmpgutah.us`, `.gov`, `.state.ut.us`, `ut.gov`, `slco.org`) OR if a user manually confirmed ≥3 prior links from that sender (tracked via `email_links.auto_linked` flag).
- `server/src/utils/emailRedactor.ts` — exports `redactPII(html: string): {redacted: string, diff: Array<{original, replacement, type}>}`.
  - Patterns: SSN (`\d{3}-\d{2}-\d{4}`), driver's license (UT format `[A-Z]\d{6,8}`), DOB (`\d{1,2}/\d{1,2}/\d{4}`), phone (`\(\d{3}\)\s*\d{3}-\d{4}`), street address (heuristic: number + street name + ("St"|"Ave"|"Blvd"|…)).
  - Each match replaced with `[REDACTED:TYPE]`. Diff returned for UI preview.
  - Pattern list loaded from `server/src/utils/piiPatterns.ts` (shared with future redaction callers).

**Modified files**
- `server/src/utils/emailPoller.ts` — after FTS insert, call `extractEntityReferences` and write verified matches to `email_links` (existing table). Set `auto_linked = 1` on new rows.
- `server/src/routes/email.ts` — `POST /messages/:id/forward` extended:
  - If any recipient domain is outside the allowlist, require `redaction_confirmed: true` in body.
  - When unconfirmed, return `409 Conflict` with `{requires_redaction: true, preview: {redacted, diff}}`.
  - Client shows modal (`ForwardRedactionModal.tsx`), user reviews/edits, re-submits with `redaction_confirmed: true`.
- `server/src/utils/emailPoller.ts` — email-to-CFS: if message lands in the folder whose Graph ID matches `system_config['email_tip_line_folder_id']`, insert a row into `calls_for_service` with `source = 'email_tip'`, `caller_name` from the `from` header, `caller_phone = ''`, `narrative = plain text body truncated to 4000 chars`, `priority = 3`, `status = 'pending_review'`, `location = ''`. A dispatcher manually reviews before activating.

**New files (client)**
- `client/src/components/email/ForwardRedactionModal.tsx` — diff preview, accept / edit / cancel.
- Add "Email about this case/incident" buttons on `CaseDetailPage.tsx` and `IncidentDetailPage.tsx` — opens `EmailPage` compose with subject prefilled, fires POST `/api/email/link` on send to create the bidirectional link.

**DB migrations (additive)**
```sql
ALTER TABLE email_links ADD COLUMN auto_linked INTEGER NOT NULL DEFAULT 0;
-- system_config seed (via setConfigValueIfMissing):
-- email_autolink_allowlist = '["rmpgutah.us",".gov",".state.ut.us","ut.gov","slco.org"]'
-- email_tip_line_folder_id = ''   (admin sets in UI)
```

### Phase 4 — Per-user mailboxes (FOLLOW-UP PR, not in mega-PR)

Design sketch only; detailed plan deferred until the mega-PR ships.

- New table `user_graph_tokens (user_id, access_token_enc, refresh_token_enc, expires_at, scopes)`, AES-256-GCM encrypted with a key derived from `JWT_SECRET`.
- `ALTER TABLE email_cache ADD COLUMN owner_user_id INTEGER REFERENCES users(id)`. Backfill existing rows to the admin account.
- `getGraphClient(userId)` replaces the global client. Poller iterates users, calls Graph per-user, writes `owner_user_id`.
- All `/api/email/*` endpoints scope to `req.user.id`.
- Admin OAuth enrollment flow per user. User sees "Connect Mailbox" on profile until enrolled.

## 6. Build order / PR plan

The mega-PR is delivered as a single branch but structured internally as three reviewable commits stacked in order:

1. **Commit 1 — Phase 1 (polish & harden)**. Must be green on its own.
2. **Commit 2 — Phase 2 (FTS + rules)**. Must be green on its own.
3. **Commit 3 — Phase 3 (CAD/RMS integration)**. Must be green on its own.

Each commit ships its own tests. Reviewers read top-down; bisect works cleanly.

## 7. Risks and mitigations

| Risk | Mitigation |
|---|---|
| FTS5 trigger races with `ON CONFLICT` upsert in poller | Use `content='email_cache' content_rowid='id'` external-content FTS — triggers fire AFTER the upsert completes. Covered by test. |
| Rule engine stalls polling | 50 ms per-rule timeout via `AbortController`; evaluation runs AFTER the sync TX commits. Failures never block sync. |
| Auto-link false positives from spam | Domain allowlist + entity-existence check + `auto_linked` column so admins can audit / bulk-undo. |
| PII redactor over-redacts (e.g., 9-digit numbers that aren't SSNs) | Diff preview in modal — officer reviews before send. Allow accept-as-is override logged to audit. |
| 2400-LOC mega-PR review burden | Stacked commits per phase; each phase has its own test suite and is independently revertable. |
| Markdown renderer change breaks already-sent scheduled emails | Renderer is only called going forward; already-rendered rows in `email_cache` are untouched. |
| `DOMPurify` server-side needs JSDOM — adds dep weight | Use `isomorphic-dompurify` which ships with its own lightweight DOM. Already pinned in `server/package.json` overrides. |
| `calls_for_service` insert for email-tip needs 74-column match (CLAUDE.md gotcha #24) | Use a minimal INSERT with only the required columns + DEFAULT on the rest. Write a test that the insert succeeds against the live schema. |

## 8. Open questions resolved

- **M365 licensing for Phase 4?** — Confirmed: every user has M365. Phase 4 proceeds as designed in the follow-up PR.
- **First-PR scope?** — Phases 1 + 2 + 3 bundled, stacked commits.

## 9. Next step

Invoke the `superpowers:writing-plans` skill to produce a step-by-step implementation plan from this design.
