# Phase 4: Per-User M365 Mailboxes — Design

**Date:** 2026-04-17
**Status:** Approved, pending implementation plan
**Follow-up to:** `docs/plans/2026-04-14-email-enhancement-design.md`

---

## 1. Context

Phases 1–3 (PR #212) shipped a hardened, searchable, CAD/RMS-integrated email subsystem on top of a **single shared** Microsoft 365 mailbox. Every authorized user of RMPG Flex sees the same inbox. Phase 4 replaces that model with **per-user M365 mailboxes** — each officer authorizes RMPG Flex to access their own M365 inbox, and their view of email in the app is scoped to that inbox.

## 2. Key decisions (locked)

| Decision | Choice |
|---|---|
| Shared-mailbox fate | **Retired entirely.** No coexistence mode. |
| Existing data | **Full wipe on deploy** — `email_cache`, `email_folders`, `email_links`, `scheduled_emails`, `email_rules`, `email_rule_matches`. |
| Enrollment UX | **Self-service banner on EmailPage.** No forced redirect. Rest of app works without email enrollment. |
| Poller strategy | **Sequential loop** over enrolled users. Simple, naturally rate-limit-safe. |
| Token encryption | **Reuse existing `setConfigValue(..., shouldEncrypt=true)` pattern** — AES-256-GCM with JWT_SECRET-derived key. Indexed per-user via the new `user_graph_tokens` table. |
| Email rule scope | **Both** — admin rules (`owner_user_id IS NULL`) apply globally; user rules apply only to that user. |

## 3. Non-goals

- Shared-mailbox compatibility mode. Out.
- Webhooks for real-time Graph change notifications. Poller-driven stays.
- Cross-user email search. Each user only sees their own mail.
- M365 tenant SSO for app login. The app's JWT-based login stays as-is; this PR only adds the Graph OAuth consent flow per-user.

## 4. Data model

### New table

```sql
CREATE TABLE IF NOT EXISTS user_graph_tokens (
  user_id INTEGER PRIMARY KEY,
  access_token_enc TEXT NOT NULL,
  refresh_token_enc TEXT,
  token_expires_at INTEGER NOT NULL,   -- epoch ms
  mailbox TEXT,                        -- /me/mailboxSettings userPrincipalName
  scopes TEXT,
  enrolled_at TEXT NOT NULL,
  last_sync_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

### Column additions

```sql
ALTER TABLE email_cache      ADD COLUMN owner_user_id INTEGER;
ALTER TABLE email_folders    ADD COLUMN owner_user_id INTEGER;
ALTER TABLE email_rules      ADD COLUMN owner_user_id INTEGER;  -- NULL = global
ALTER TABLE scheduled_emails ADD COLUMN owner_user_id INTEGER;

CREATE INDEX idx_email_cache_owner    ON email_cache(owner_user_id, folder_id);
CREATE INDEX idx_email_folders_owner  ON email_folders(owner_user_id);
CREATE INDEX idx_email_rules_owner    ON email_rules(owner_user_id, enabled, priority);
CREATE INDEX idx_scheduled_owner      ON scheduled_emails(owner_user_id, status);
```

### Shared-mailbox config rows to deprecate

Keep for app-registration identity (OAuth app itself is still a single Azure AD app registration):
- `ms_email_client_id`, `ms_email_client_secret`, `ms_email_tenant_id`, `ms_email_enabled`

Delete on migration:
- `ms_email_access_token`, `ms_email_refresh_token`, `ms_email_token_expires_at`, `ms_email_mailbox`, `ms_email_last_sync`

## 5. Token encryption

Reuse `setConfigValue(key, value, shouldEncrypt=true)` + `getDecryptedValue(key)` from `msGraphClient.ts`. Per-user tokens live in their own row keyed by `user_id`, but pass through the same AES-256-GCM primitive.

**Failure mode preserved from the existing TOTP design**: if `JWT_SECRET` rotates, all tokens are unrecoverable → every user re-enrolls. Documented in CLAUDE.md #1; no change.

## 6. Graph client refactor

```ts
// server/src/utils/msGraphClient.ts
export async function getGraphClient(userId: number): Promise<Client>
export async function ensureValidToken(userId: number): Promise<string>
export function isAuthorized(userId: number): boolean
```

`isEnabled()` remains global (the integration is on/off for the tenant regardless of who's enrolled).

All existing callers add `userId`:
- Route handlers: `req.user.userId`
- Poller: the loop variable over enrolled users
- Scheduled send processor: `email.created_by` from the `scheduled_emails` row

## 7. OAuth enrollment

### Server routes

- `GET /api/email/oauth/authorize` — authenticated user; builds state = `JWT({ userId, nonce, exp: +10min })`; redirects to Microsoft consent URL using the global OAuth app registration.
- `GET /api/email/oauth/callback` (existing) — verify state JWT, exchange code, write `user_graph_tokens`, redirect to `/email?enrolled=1`.

### Client

`EmailPage.tsx` queries `GET /api/email/status`. New response shape:
```ts
{ enabled: boolean; enrolled: boolean; mailbox: string | null; lastSync: string | null }
```

If `enrolled === false`:
```
┌──────────────────────────────────────────────┐
│ 📧  Connect your Microsoft 365 mailbox       │
│                                              │
│ To use email in RMPG Flex, you need to       │
│ authorize access to your mailbox.            │
│                                              │
│        [ CONNECT MICROSOFT 365 ]             │
└──────────────────────────────────────────────┘
```

Rest of the app (cases, incidents, dispatch, etc.) continues to work for un-enrolled users. "Email about this" buttons on case/incident pages still work but land on the enrollment banner if the user hasn't connected.

### Scopes

Unchanged: `Mail.ReadWrite Mail.Send offline_access User.Read`. Per-user consent means each user approves these scopes for their own mailbox only.

## 8. Poller refactor

### Sequential loop

```ts
async function syncAllUsers(): Promise<void> {
  const db = getDb();
  const users = db.prepare(
    'SELECT user_id FROM user_graph_tokens ORDER BY user_id'
  ).all() as { user_id: number }[];

  for (const { user_id } of users) {
    try {
      await syncInbox(user_id);
    } catch (err: any) {
      console.warn(`[EmailPoller] User ${user_id} sync failed:`, err.message);
      // Expired-token specifically: mark user for re-enroll
      if (/token|auth|401/i.test(err.message)) {
        db.prepare(
          'UPDATE user_graph_tokens SET token_expires_at = 0 WHERE user_id = ?'
        ).run(user_id);
      }
    }
  }

  await processScheduledEmails();  // still global
}
```

### Rate-limit posture

Graph's per-mailbox throttle (~10k requests / 10 min) is per user, so sequential iteration is naturally safe. The app-level global throttle (~600 requests / second at tenant level) would only matter at 100+ users syncing tightly, which is far above RMPG's scale.

### syncFolder changes

Every INSERT/UPDATE in `syncFolder` gains `owner_user_id`. The `checkExisting` probe also becomes scoped:
```ts
const checkExisting = db.prepare(
  'SELECT id FROM email_cache WHERE graph_id = ? AND owner_user_id = ?'
);
```

This preserves the invariant that two users both forwarded the same inbound email can each have their own cache row (same `graph_id` is possible across users).

## 9. Route scoping

Every `/api/email/*` handler (except admin config) adds `owner_user_id = ?` to its SQL, using `req.user.userId`:

| Endpoint | Where the filter goes |
|---|---|
| `GET /folders` | `WHERE owner_user_id = ?` |
| `GET /messages` | `WHERE owner_user_id = ?` (already folder-filtered) |
| `GET /messages/search` (FTS) | Outer WHERE on `ec.owner_user_id = ?` |
| `GET /messages/:id/...` | Auth check: the graph_id must belong to this user |
| `POST /send`, `/reply`, `/forward`, `/schedule` | Write `owner_user_id = req.user.userId` into `scheduled_emails`; Graph client scoped |
| `GET /links/...`, `POST /link` | `WHERE owner_user_id = ?` on email-side joins |
| `GET /api/email/rules` | `WHERE owner_user_id = ? OR owner_user_id IS NULL` (user sees own + global) |
| `POST /api/email/rules` | Non-admin: `owner_user_id = req.user.userId`. Admin with `?global=1`: `owner_user_id = NULL`. |
| `PUT /PATCH /api/email/rules/:id` | Editor must be owner, or admin for global rules |
| Admin: `/api/email/admin/*` | Unchanged — tenant OAuth app config |

The rule engine evaluates both user-owned and global rules on each new message:
```sql
SELECT * FROM email_rules
WHERE enabled = 1
  AND (owner_user_id IS NULL OR owner_user_id = ?)
ORDER BY priority ASC
```

## 10. Scheduled emails

`scheduled_emails.owner_user_id` = the user who scheduled it. The poller's `processScheduledEmails` reads `created_by` → looks up that user's Graph client → sends on their behalf. If that user has unenrolled or their token is dead, the scheduled send is marked `failed` with a clear error.

## 11. Error surfaces

| Situation | Behavior |
|---|---|
| Un-enrolled user opens Email page | Enrollment banner; rest of app works |
| User's token expired | Token refresh attempted; if refresh also fails, `token_expires_at=0` set; UI shows "Reconnect" banner on next load |
| User un-enrolls mid-cycle | Admin "revoke" button → `DELETE FROM user_graph_tokens WHERE user_id = ?`; their cached rows wiped |
| Admin revokes a user's tokens | Same as above |
| Graph tenant-wide outage | Individual user syncs fail; poller logs but continues. Inbox shows stale data with a "last synced" timestamp |

## 12. Tests

- `userGraphTokens.test.ts` — encrypt/decrypt roundtrip, expiry check, per-user isolation
- `emailPoller.test.ts` — sequential iteration, one user failure doesn't halt others, expired-token marks re-auth
- `emailSender.test.ts` — now takes `userId`; per-user Graph client mock
- `emailRuleEngine.test.ts` — already covered; extend to verify scoped query returns global + own, not other users'
- Integration: un-enrolled user gets 403 or empty response from `/api/email/messages`

## 13. Migration + deploy

Single additive migration in `database.ts` init, gated by `system_config.phase4_migration_done`:

```ts
const done = getConfigValue('phase4_migration_done');
if (!done) {
  db.transaction(() => {
    db.prepare('DELETE FROM email_rule_matches').run();
    db.prepare('DELETE FROM email_rules').run();
    db.prepare('DELETE FROM email_links').run();
    db.prepare('DELETE FROM scheduled_emails').run();
    db.prepare('DELETE FROM email_cache').run();
    db.prepare('DELETE FROM email_folders').run();
    // Delete old shared-mailbox config rows
    ['ms_email_access_token','ms_email_refresh_token','ms_email_token_expires_at','ms_email_mailbox','ms_email_last_sync']
      .forEach(k => db.prepare('DELETE FROM system_config WHERE config_key = ?').run(k));
  })();
  setConfigValue('phase4_migration_done', localNow());
}
```

CREATE TABLE + ALTER TABLE migrations are idempotent (via `CREATE TABLE IF NOT EXISTS` + `addCol`). Safe to replay.

### Deploy runbook addition

1. Bump `CACHE_NAME` in `client/public/sw.js`.
2. Deploy server. Expect first-boot log: `[Phase4] Migration complete — wiped email_cache/folders/links/scheduled/rules.`
3. Admins open Email page → click "Connect Microsoft 365" → complete OAuth.
4. Broadcast note to officers: *"After the latest update, open the Email page and click 'Connect Microsoft 365' to connect your inbox. You won't see any mail until you do."*

## 14. Estimated scope

- **Backend**: ~900 LOC (new `user_graph_tokens` helpers, `getGraphClient(userId)` refactor, poller loop, route filters, migration).
- **Frontend**: ~250 LOC (enrollment banner component, `EmailPage` wiring, admin enrollment-status list).
- **Tests**: ~300 LOC.
- **Total**: ~1450 LOC, one PR.

## 15. Open items resolved via brainstorming

- Rollout model: **replace, per-user only** ✓
- Existing data: **full wipe** ✓
- Enrollment UX: **self-service banner** ✓
- Sync strategy: **sequential** ✓
- Rule scope: **both admin-global + per-user** ✓

## 16. Next step

Invoke `superpowers:writing-plans` to produce the step-by-step TDD-first implementation plan.
