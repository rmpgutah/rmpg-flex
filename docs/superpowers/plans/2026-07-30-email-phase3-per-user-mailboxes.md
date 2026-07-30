# Email System — Phase 3 Per-User Mailboxes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut over from one shared, admin-owned Microsoft Graph mailbox to personal per-user O365 mailboxes — each user connects their own account and sees only their own inbox. Hard cutover: an unconnected user sees a "Connect your mailbox" prompt, not a shared fallback view.

**Architecture:** New `user_graph_tokens` table (one row per connected user, encrypted via the existing `emailCrypto.ts`). `ensureValidToken`/`graphFetch` change signature to take a `userId`. A new per-user OAuth flow (`/connect/authorize`, `/connect/callback`, `DELETE /connect`) replaces the admin-only shared authorize flow. `runEmailPoll` loops over every connected user instead of running once against a singleton token. Every existing route handler that calls `graphFetch`/`ensureValidToken` gets `c.get('userId')` threaded through — this is mechanical (the TypeScript compiler catches any missed call site once the signatures change, since the old 1-arg/2-arg calls become type errors).

**Tech Stack:** Hono, Cloudflare Workers, D1, `src/utils/emailCrypto.ts` (existing AES-GCM secret encryption), Vitest.

## Global Constraints

- Reuse `src/utils/emailCrypto.ts`'s `encryptSecret(env, plaintext)`/`decryptSecret(env, stored)` for `user_graph_tokens` — do NOT create new crypto code for this table; these are auth secrets, same class of data as the Azure client secret already encrypted this way.
- `graphFetch`/`ensureValidToken`'s new signature is `graphFetch(env: Bindings, userId: number, path: string, init?: RequestInit)` and `ensureValidToken(env: Bindings, userId: number): Promise<string>` — `userId` is the SECOND positional argument in both, right after `env`.
- This is a hard cutover — no dual-mode "shared mailbox as fallback." A user with no `user_graph_tokens` row gets a clear "not connected" state, never a shared/other-user's inbox.
- D1 calls are always `await`ed.
- Tests: `npx vitest run <file>`; full suite `npx vitest run` before the final commit.
- Migration file: next free integer prefix under `migrations/` — check `ls migrations/ | tail` at task time for the current high-water mark (do not hardcode a number in this plan; the exact filename is decided when Task 1 runs).
- CSRF state tokens for the new per-user connect flow reuse the EXACT SAME atomic compare-and-delete pattern already used by the existing `/oauth/callback` (`DELETE FROM system_config WHERE config_key = ? AND config_value = ? ...` — check `((consumed?.meta?.changes as number | undefined) ?? 0) === 0` to detect an invalid/replayed state) — do not invent a different CSRF mechanism.
- The Azure app registration config (`ms_email_client_id`/`ms_email_client_secret`/`ms_email_tenant_id` in `system_config`) is UNCHANGED by this phase — still admin-configured, still org-wide, still read via the existing `getCfgDecrypted(env, K.clientId)` etc. Only the per-user access/refresh token storage moves to the new table.

---

### Task 1: `user_graph_tokens` table, crypto helpers, and best-effort migration

**Files:**
- Create: `migrations/<NNNN>_user_graph_tokens.sql`
- Create: `src/utils/userGraphTokens.ts`
- Test: `tests/userGraphTokens.test.ts` (new)

**Interfaces:**
- Consumes: `encryptSecret`/`decryptSecret` from `src/utils/emailCrypto.ts` (already exist, signatures: `encryptSecret(env: {EMAIL_CRED_KEY?: string; JWT_SECRET: string}, plaintext: string): Promise<string>`, `decryptSecret(env, stored: string): Promise<string>`).
- Produces:
  - `export async function saveUserGraphToken(db: D1Database, env: {EMAIL_CRED_KEY?: string; JWT_SECRET: string}, userId: number, tokens: {accessToken: string; refreshToken: string; expiresAt: number; mailbox?: string}): Promise<void>` — upserts (insert or replace) the row for `userId`, encrypting both tokens.
  - `export async function getUserGraphToken(db: D1Database, env: {EMAIL_CRED_KEY?: string; JWT_SECRET: string}, userId: number): Promise<{accessToken: string; refreshToken: string; expiresAt: number; mailbox: string | null} | null>` — returns null if no row exists; decrypts both tokens otherwise.
  - `export async function deleteUserGraphToken(db: D1Database, userId: number): Promise<void>`.
  - `export async function listConnectedUserIds(db: D1Database): Promise<number[]>` — for the poller.

- [ ] **Step 1: Check the current migration high-water mark**

Run: `ls migrations/ | grep -E '^[0-9]{4}_' | sort | tail -5`
Note the highest 4-digit prefix. Your new migration file uses the next integer (e.g. if the highest is `0211`, yours is `0212`).

- [ ] **Step 2: Write the migration**

Create `migrations/<NNNN>_user_graph_tokens.sql` (idempotent, matches this project's DDL style — pure `CREATE TABLE IF NOT EXISTS`, no `ALTER`):

```sql
-- Phase 3 of the email system upgrade: per-user Microsoft Graph OAuth grants,
-- replacing the single shared admin-owned tenant token. Encrypted via the
-- existing src/utils/emailCrypto.ts AES-GCM helpers (same class of secret as
-- the Azure client secret already encrypted that way) — NOT the Phase 2
-- per-value envelope crypto, which targets bulk cached message content.
CREATE TABLE IF NOT EXISTS user_graph_tokens (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  access_token_enc TEXT NOT NULL,
  refresh_token_enc TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  mailbox TEXT,
  connected_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

- [ ] **Step 3: Write the failing test**

Create `tests/userGraphTokens.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import {
  saveUserGraphToken, getUserGraphToken, deleteUserGraphToken, listConnectedUserIds,
} from '../src/utils/userGraphTokens';

function fakeDb() {
  const rows = new Map<number, { access_token_enc: string; refresh_token_enc: string; expires_at: string; mailbox: string | null }>();
  return {
    prepare: (sql: string) => ({
      bind: (...params: unknown[]) => ({
        run: async () => {
          if (sql.includes('INSERT OR REPLACE INTO user_graph_tokens') || sql.includes('INSERT INTO user_graph_tokens')) {
            const [userId, accessEnc, refreshEnc, expiresAt, mailbox] = params as [number, string, string, string, string | null];
            rows.set(userId, { access_token_enc: accessEnc, refresh_token_enc: refreshEnc, expires_at: expiresAt, mailbox });
          } else if (sql.includes('DELETE FROM user_graph_tokens')) {
            rows.delete(params[0] as number);
          }
          return { success: true, meta: {} };
        },
        first: async () => {
          const userId = params[0] as number;
          const row = rows.get(userId);
          return row ? { ...row } : null;
        },
        all: async () => ({ results: [...rows.keys()].map((user_id) => ({ user_id })) }),
      }),
    }),
  } as unknown as D1Database;
}

const env = { JWT_SECRET: 'test-secret-at-least-32-bytes-long-for-testing' };

describe('userGraphTokens', () => {
  it('saves and retrieves a token round-trip (encrypted at rest)', async () => {
    const db = fakeDb();
    await saveUserGraphToken(db, env, 42, {
      accessToken: 'access-abc', refreshToken: 'refresh-xyz', expiresAt: 1234567890, mailbox: 'officer@rmpgutah.us',
    });
    const result = await getUserGraphToken(db, env, 42);
    expect(result).not.toBeNull();
    expect(result!.accessToken).toBe('access-abc');
    expect(result!.refreshToken).toBe('refresh-xyz');
    expect(result!.mailbox).toBe('officer@rmpgutah.us');
  });

  it('returns null for a user with no connected mailbox', async () => {
    const db = fakeDb();
    const result = await getUserGraphToken(db, env, 999);
    expect(result).toBeNull();
  });

  it('deletes a token', async () => {
    const db = fakeDb();
    await saveUserGraphToken(db, env, 7, { accessToken: 'a', refreshToken: 'b', expiresAt: 1, mailbox: null });
    await deleteUserGraphToken(db, 7);
    expect(await getUserGraphToken(db, env, 7)).toBeNull();
  });

  it('lists connected user ids', async () => {
    const db = fakeDb();
    await saveUserGraphToken(db, env, 1, { accessToken: 'a', refreshToken: 'b', expiresAt: 1, mailbox: null });
    await saveUserGraphToken(db, env, 2, { accessToken: 'c', refreshToken: 'd', expiresAt: 1, mailbox: null });
    const ids = await listConnectedUserIds(db);
    expect(ids.sort()).toEqual([1, 2]);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run tests/userGraphTokens.test.ts`
Expected: FAIL — `src/utils/userGraphTokens.ts` does not exist.

- [ ] **Step 5: Implement `src/utils/userGraphTokens.ts`**

```ts
// Per-user Microsoft Graph OAuth token storage (Phase 3 of the email
// upgrade: personal per-officer mailboxes, replacing the single shared
// admin-owned tenant grant). Encryption reuses emailCrypto.ts's AES-GCM
// helpers — same class of secret as the already-encrypted Azure client
// secret, not the bulk-content envelope crypto from Phase 2.
import { encryptSecret, decryptSecret } from './emailCrypto';

type CryptoEnv = { EMAIL_CRED_KEY?: string; JWT_SECRET: string };

export interface UserGraphTokenInput {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  mailbox?: string;
}

export interface UserGraphToken {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  mailbox: string | null;
}

export async function saveUserGraphToken(
  db: D1Database,
  env: CryptoEnv,
  userId: number,
  tokens: UserGraphTokenInput,
): Promise<void> {
  const accessEnc = await encryptSecret(env, tokens.accessToken);
  const refreshEnc = await encryptSecret(env, tokens.refreshToken);
  await db.prepare(
    `INSERT INTO user_graph_tokens (user_id, access_token_enc, refresh_token_enc, expires_at, mailbox, connected_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       access_token_enc = excluded.access_token_enc,
       refresh_token_enc = excluded.refresh_token_enc,
       expires_at = excluded.expires_at,
       mailbox = COALESCE(excluded.mailbox, user_graph_tokens.mailbox)`,
  ).bind(userId, accessEnc, refreshEnc, String(tokens.expiresAt), tokens.mailbox ?? null).run();
}

export async function getUserGraphToken(
  db: D1Database,
  env: CryptoEnv,
  userId: number,
): Promise<UserGraphToken | null> {
  const row = await db.prepare(
    'SELECT access_token_enc, refresh_token_enc, expires_at, mailbox FROM user_graph_tokens WHERE user_id = ?',
  ).bind(userId).first<{ access_token_enc: string; refresh_token_enc: string; expires_at: string; mailbox: string | null }>();
  if (!row) return null;
  return {
    accessToken: await decryptSecret(env, row.access_token_enc),
    refreshToken: await decryptSecret(env, row.refresh_token_enc),
    expiresAt: parseInt(row.expires_at, 10),
    mailbox: row.mailbox,
  };
}

export async function deleteUserGraphToken(db: D1Database, userId: number): Promise<void> {
  await db.prepare('DELETE FROM user_graph_tokens WHERE user_id = ?').bind(userId).run();
}

export async function listConnectedUserIds(db: D1Database): Promise<number[]> {
  const result = await db.prepare('SELECT user_id FROM user_graph_tokens').bind().all<{ user_id: number }>();
  return (result.results || []).map((r) => r.user_id);
}
```

Note: the test's `fakeDb()` mock uses `.bind()` with no arguments for `listConnectedUserIds`'s `all()` call to keep the mock simple — real D1's `.bind()` accepts zero args fine, this matches actual D1Database behavior.

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/userGraphTokens.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 7: Apply the migration locally and verify the table exists**

Run: `npm run migrate:local`
Then verify: `npx wrangler d1 execute rmpg-flex --local --command "SELECT name FROM sqlite_master WHERE type='table' AND name='user_graph_tokens'"`
Expected: one row returned.

- [ ] **Step 8: Typecheck**

Run: `npm run typecheck`
Expected: no new errors

- [ ] **Step 9: Commit**

```bash
git add migrations/ src/utils/userGraphTokens.ts tests/userGraphTokens.test.ts
git commit -m "feat(email): add per-user Graph token storage table and helpers"
```

---

### Task 2: New per-user connect/disconnect OAuth routes

**Files:**
- Modify: `src/routes/email.ts` — add `GET /connect/authorize`, `GET /connect/callback` (public), `DELETE /connect`, `GET /connect/status`
- Test: `tests/emailConnect.test.ts` (new — structural/unit tests only; the full OAuth code-exchange flow against live Microsoft endpoints is not unit-testable and isn't attempted here, matching how the existing `/oauth/callback` has no dedicated test today)

**Interfaces:**
- Consumes: `saveUserGraphToken`, `getUserGraphToken`, `deleteUserGraphToken` from Task 1's `src/utils/userGraphTokens.ts`.
- Produces: no new exports outside the route file — these are route handlers only.

- [ ] **Step 1: Read the existing `/oauth/callback` and `/admin/oauth/authorize` handlers for the exact CSRF and token-exchange pattern to mirror**

Run: `grep -n "email.get('/oauth/callback'\|email.get('/admin/oauth/authorize'" src/routes/email.ts` and read both handlers in full (they're near the top of the file, before the `email.use('*', authMiddleware)` gate for the callback, and shortly after it for the authorize route). You will reuse: the `GRAPH_SCOPES` array, the `AZURE_GUID_RE`/credential-lookup pattern via `getCfgDecrypted`, the state-token generation (`crypto.getRandomValues` + hex encoding), and the atomic compare-and-delete CSRF verification (`DELETE FROM system_config WHERE config_key = ? AND config_value = ? ...` then checking `meta.changes`).

- [ ] **Step 2: Write the failing test**

Create `tests/emailConnect.test.ts` — this tests the STATE KEY NAMING SCHEME (a pure, testable piece of the new flow) and confirms the new routes exist in the file, since a full HTTP-level OAuth test needs Miniflare/live network and is out of scope here (consistent with the existing untested `/oauth/callback`):

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('per-user connect routes exist and follow the CSRF pattern', () => {
  const src = readFileSync(new URL('../src/routes/email.ts', import.meta.url), 'utf-8');

  it('defines GET /connect/authorize', () => {
    expect(src).toMatch(/email\.get\('\/connect\/authorize'/);
  });

  it('defines GET /connect/callback', () => {
    expect(src).toMatch(/email\.get\('\/connect\/callback'/);
  });

  it('defines DELETE /connect', () => {
    expect(src).toMatch(/email\.delete\('\/connect'/);
  });

  it('defines GET /connect/status', () => {
    expect(src).toMatch(/email\.get\('\/connect\/status'/);
  });

  it('the callback is registered as a public route (bypasses authMiddleware) like the existing shared callback', () => {
    // The existing auth-skip check in email.use('*', ...) matches on pathname
    // suffix '/oauth/callback' OR the exact '/api/email/oauth/callback' path.
    // The new /connect/callback needs the same treatment or it will 401
    // before Microsoft's redirect (which carries no Authorization header)
    // ever reaches the handler.
    const authGateMatch = src.match(/email\.use\('\*',[\s\S]*?\n\}\);/);
    expect(authGateMatch).toBeTruthy();
    expect(authGateMatch![0]).toMatch(/connect\/callback/);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/emailConnect.test.ts`
Expected: FAIL — none of the 4 new routes exist yet, and the auth-gate doesn't mention `connect/callback`.

- [ ] **Step 4: Add the import**

Near the top of `src/routes/email.ts`, add to the existing imports block:

```ts
import { saveUserGraphToken, getUserGraphToken, deleteUserGraphToken } from '../utils/userGraphTokens';
```

- [ ] **Step 5: Widen the public-route auth-skip to include `/connect/callback`**

Find the existing block (search for `email.use('*', async (c, next) => {`):

```ts
email.use('*', async (c, next) => {
  const pathname = new URL(c.req.url).pathname;
  if (pathname === '/api/email/oauth/callback' || pathname.endsWith('/oauth/callback')) {
    return next();
  }
  return authMiddleware(c, next);
});
```

Replace with:

```ts
email.use('*', async (c, next) => {
  const pathname = new URL(c.req.url).pathname;
  if (
    pathname === '/api/email/oauth/callback' || pathname.endsWith('/oauth/callback') ||
    pathname === '/api/email/connect/callback' || pathname.endsWith('/connect/callback')
  ) {
    return next();
  }
  return authMiddleware(c, next);
});
```

- [ ] **Step 6: Add `GET /connect/authorize` (any authenticated user)**

Add this route AFTER the auth-gate block above (so it requires a valid JWT — this is per-user, not admin-gated, unlike `/admin/oauth/authorize`):

```ts
// Per-user mailbox connect (Phase 3) — any authenticated user, not admin-gated.
// State is bound to the requesting user via a per-request system_config row
// (email_connect_state_<random> = userId), consumed atomically by the
// callback below — same CSRF pattern as the existing admin authorize flow,
// just keyed per-connection instead of a global singleton.
email.get('/connect/authorize', async (c) => {
  const userId = c.get('userId');
  const clientId = await getCfgDecrypted(c.env, K.clientId);
  const tenantId = await getCfgDecrypted(c.env, K.tenantId);
  if (!clientId || !tenantId) {
    return c.json({ error: 'Azure AD app registration is not configured yet — ask an admin to set it up', code: 'NOT_CONFIGURED' }, 400);
  }
  const stateBytes = crypto.getRandomValues(new Uint8Array(32));
  let state = '';
  for (const b of stateBytes) state += b.toString(16).padStart(2, '0');
  await setCfg(c.env.DB, `email_connect_state_${state}`, String(userId));

  const host = new URL(c.req.url).host;
  const redirectUri = `https://${host}/api/email/connect/callback`;
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: GRAPH_SCOPES.join(' '),
    state,
    prompt: 'consent',
  });
  const url = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?${params.toString()}`;
  return c.json({ url });
});
```

- [ ] **Step 7: Add `GET /connect/callback` (public — registered before, but placed anywhere in the file since Hono routes by path not declaration order for this middleware setup; place it near the existing public `/oauth/callback` for readability)**

```ts
// Public: Microsoft redirects here with ?code&state after a per-user
// mailbox connect. Mirrors /oauth/callback's token-exchange structure but
// resolves the owning userId from the per-request state row instead of a
// singleton, and writes to user_graph_tokens instead of system_config.
email.get('/connect/callback', async (c) => {
  const url = new URL(c.req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const oauthErr = url.searchParams.get('error');
  if (oauthErr) {
    const KNOWN_OAUTH_ERRORS = new Set([
      'access_denied', 'invalid_request', 'unauthorized_client', 'invalid_grant',
      'unsupported_response_type', 'invalid_scope', 'server_error', 'temporarily_unavailable',
    ]);
    const safeErr = KNOWN_OAUTH_ERRORS.has(oauthErr) ? oauthErr : 'oauth_error';
    return c.redirect(`/email?connect_status=error&message=${encodeURIComponent(safeErr)}`);
  }
  if (!code || !state) return c.redirect('/email?connect_status=error&message=Missing+code+or+state');

  const stateKey = `email_connect_state_${state}`;
  const row = await queryFirst<{ config_value: string }>(
    c.env.DB,
    "SELECT config_value FROM system_config WHERE config_key = ? AND category = 'integrations' AND is_active = 1 LIMIT 1",
    stateKey,
  );
  if (!row) return c.redirect('/email?connect_status=error&message=Invalid+or+expired+state');
  const consumed = await execute(
    c.env.DB,
    "DELETE FROM system_config WHERE config_key = ? AND category = 'integrations'",
    stateKey,
  );
  if (((consumed?.meta?.changes as number | undefined) ?? 0) === 0) {
    return c.redirect('/email?connect_status=error&message=Invalid+state');
  }
  const userId = parseInt(row.config_value, 10);
  if (!userId) return c.redirect('/email?connect_status=error&message=Invalid+state');

  const clientId = await getCfgDecrypted(c.env, K.clientId);
  const clientSecret = await getCfgDecrypted(c.env, K.clientSecret);
  const tenantId = await getCfgDecrypted(c.env, K.tenantId);
  if (!clientId || !clientSecret || !tenantId) {
    return c.redirect('/email?connect_status=error&message=Credentials+missing');
  }

  const redirectUri = `https://${url.host}/api/email/connect/callback`;
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    scope: GRAPH_SCOPES.join(' '),
  });

  try {
    const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(15_000),
    });
    const data = await res.json() as Record<string, unknown>;
    if (!res.ok) {
      const msg = String(data.error_description || data.error || 'Token exchange failed');
      return c.redirect(`/email?connect_status=error&message=${encodeURIComponent(msg)}`);
    }

    let mailbox: string | undefined;
    try {
      const parts = String(data.access_token).split('.');
      if (parts.length >= 2) {
        const pad = parts[1].length % 4 === 0 ? '' : '='.repeat(4 - (parts[1].length % 4));
        const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/') + pad));
        mailbox = payload.upn || payload.preferred_username || payload.unique_name || undefined;
      }
    } catch { /* best-effort */ }

    const expiresIn = Number(data.expires_in) || 3600;
    await saveUserGraphToken(c.env.DB, c.env, userId, {
      accessToken: String(data.access_token),
      refreshToken: data.refresh_token ? String(data.refresh_token) : '',
      expiresAt: Date.now() + expiresIn * 1000,
      mailbox,
    });

    return c.redirect('/email?connect_status=connected');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Token exchange failed';
    return c.redirect(`/email?connect_status=error&message=${encodeURIComponent(msg)}`);
  }
});
```

- [ ] **Step 8: Add `DELETE /connect` and `GET /connect/status`**

```ts
email.delete('/connect', async (c) => {
  const userId = c.get('userId');
  await deleteUserGraphToken(c.env.DB, userId);
  return c.json({ success: true });
});

email.get('/connect/status', async (c) => {
  const userId = c.get('userId');
  const token = await getUserGraphToken(c.env.DB, c.env, userId);
  return c.json({ connected: !!token, mailbox: token?.mailbox ?? null });
});
```

- [ ] **Step 9: Run test to verify it passes**

Run: `npx vitest run tests/emailConnect.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 10: Typecheck**

Run: `npm run typecheck`
Expected: no new errors

- [ ] **Step 11: Commit**

```bash
git add src/routes/email.ts tests/emailConnect.test.ts
git commit -m "feat(email): add per-user mailbox connect/disconnect OAuth flow"
```

---

### Task 3: Change `ensureValidToken`/`graphFetch` to take `userId`, thread through every call site

**Files:**
- Modify: `src/routes/email.ts` — the two core functions, plus every one of their ~57 call sites across every route handler and the poller/drain functions in this file.

**Interfaces:**
- Produces: `ensureValidToken(env: Bindings, userId: number): Promise<string>`, `graphFetch(env: Bindings, userId: number, path: string, init?: RequestInit): Promise<Response>` — `userId` is the new second positional parameter on both.

This task is a MECHANICAL signature change applied everywhere, verified by the TypeScript compiler: once the two function signatures change, every call site using the OLD (1-arg / 3-arg) call shape becomes a compile error, so `npm run typecheck` after your edits gives you a complete, unmissable checklist of what still needs fixing — do not try to manually track all 57 sites, use the compiler.

- [ ] **Step 1: Change `ensureValidToken`'s signature to take `userId` and use it**

Find (search for `async function ensureValidToken`):

```ts
async function ensureValidToken(env: Bindings): Promise<string> {
  const accessToken = await getCfgDecrypted(env, K.accessToken);
  const expiresAtStr = await getCfg(env.DB, K.tokenExpiresAt);
  const expiresAt = expiresAtStr ? parseInt(expiresAtStr, 10) : 0;
  if (accessToken && expiresAt && Date.now() < expiresAt - 300_000) {
    return accessToken;
  }
  const refreshToken = await getCfgDecrypted(env, K.refreshToken);
  if (!refreshToken) throw new Error('Microsoft re-authorization required — no refresh token');

  const clientId = await getCfgDecrypted(env, K.clientId);
  const clientSecret = await getCfgDecrypted(env, K.clientSecret);
  const tenantId = await getCfgDecrypted(env, K.tenantId);
  if (!clientId || !clientSecret || !tenantId) {
    throw new Error('Azure AD credentials not configured');
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
    scope: GRAPH_SCOPES.join(' '),
  });
  const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(15_000),
  });
  const data = await res.json() as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(String(data.error_description || data.error || 'Token refresh failed'));
  }
  await setCfgEncrypted(env, K.accessToken, String(data.access_token));
  if (data.refresh_token) await setCfgEncrypted(env, K.refreshToken, String(data.refresh_token));
  const expiresIn = Number(data.expires_in) || 3600;
  await setCfg(env.DB, K.tokenExpiresAt, String(Date.now() + expiresIn * 1000));
  return String(data.access_token);
}
```

Replace with (reads/writes `user_graph_tokens` for `userId` instead of the singleton `system_config` keys):

```ts
async function ensureValidToken(env: Bindings, userId: number): Promise<string> {
  const stored = await getUserGraphToken(env.DB, env, userId);
  if (!stored) throw new Error('Microsoft mailbox not connected — visit /email and click Connect');
  if (stored.accessToken && stored.expiresAt && Date.now() < stored.expiresAt - 300_000) {
    return stored.accessToken;
  }
  if (!stored.refreshToken) throw new Error('Microsoft re-authorization required — no refresh token');

  const clientId = await getCfgDecrypted(env, K.clientId);
  const clientSecret = await getCfgDecrypted(env, K.clientSecret);
  const tenantId = await getCfgDecrypted(env, K.tenantId);
  if (!clientId || !clientSecret || !tenantId) {
    throw new Error('Azure AD credentials not configured');
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: stored.refreshToken,
    grant_type: 'refresh_token',
    scope: GRAPH_SCOPES.join(' '),
  });
  const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(15_000),
  });
  const data = await res.json() as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(String(data.error_description || data.error || 'Token refresh failed'));
  }
  const expiresIn = Number(data.expires_in) || 3600;
  await saveUserGraphToken(env.DB, env, userId, {
    accessToken: String(data.access_token),
    refreshToken: data.refresh_token ? String(data.refresh_token) : stored.refreshToken,
    expiresAt: Date.now() + expiresIn * 1000,
    mailbox: stored.mailbox ?? undefined,
  });
  return String(data.access_token);
}
```

- [ ] **Step 2: Change `graphFetch`'s signature**

Find:

```ts
async function graphFetch(env: Bindings, path: string, init: RequestInit = {}): Promise<Response> {
  const token = await ensureValidToken(env);
  const headers = new Headers(init.headers as HeadersInit | undefined);
  headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return fetch(`https://graph.microsoft.com/v1.0${path}`, {
    ...init,
    headers,
    signal: AbortSignal.timeout(20_000),
  });
}
```

Replace with:

```ts
async function graphFetch(env: Bindings, userId: number, path: string, init: RequestInit = {}): Promise<Response> {
  const token = await ensureValidToken(env, userId);
  const headers = new Headers(init.headers as HeadersInit | undefined);
  headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return fetch(`https://graph.microsoft.com/v1.0${path}`, {
    ...init,
    headers,
    signal: AbortSignal.timeout(20_000),
  });
}
```

- [ ] **Step 3: Run typecheck to get the complete list of broken call sites**

Run: `npm run typecheck 2>&1 | grep "src/routes/email.ts"`
This will print one error per call site still using the old signature — this IS your checklist. There will be roughly 55-57 of them (some may already have been touched by Tasks 1-2's new routes, which were written with the NEW signature in mind — verify those don't also show errors; if `/connect/authorize`'s and `/connect/callback`'s code from Task 2 didn't call `graphFetch`/`ensureValidToken` at all, they won't appear here, which is correct).

- [ ] **Step 4: Fix each call site — the mechanical rule**

For every Hono ROUTE HANDLER (an `email.get(...)`, `email.post(...)`, etc. callback that receives `c`) that calls `graphFetch(c.env, ...)`:
1. Ensure the handler has `const userId = c.get('userId');` near its top — many already do (for audit/rate-limit purposes from Phase 1); if not present, add it as the first line of the handler body.
2. Change every `graphFetch(c.env, ` in that handler to `graphFetch(c.env, userId, `.
3. Change every bare `ensureValidToken(c.env)` (if any exist outside `graphFetch` itself — check via `grep -n "ensureValidToken(c.env)" src/routes/email.ts`) to `ensureValidToken(c.env, userId)`.

For the POLLER and DRAIN functions (`runEmailPoll`, `drainEmailOutbox`, `drainScheduledEmails`, and `runAutolinker`'s caller context if it calls Graph — check via the typecheck error list from Step 3), which do NOT have a Hono `c` context:
1. `runEmailPoll` will be rewritten in Task 4 to loop over connected users — for THIS task, thread whatever the function's current per-poll owner variable is (today it's `ownerUserId`, derived from the singleton `oauthInitiator` config) as the `userId` argument to any `graphFetch`/`ensureValidToken` calls inside it. Task 4 will change how `ownerUserId` is obtained (looping vs. singleton); this task only needs the function to compile correctly against the NEW two-arg signature using whatever userId variable is already in scope at each call site.
2. `drainEmailOutbox` and `drainScheduledEmails` already select `owner_user_id` per row (added in Phase 1/2's fix waves) — use that row's `owner_user_id` as the `userId` argument for any `graphFetch` call inside their loops.

Work through the typecheck error list from Step 3 one file-line at a time; after each batch of fixes, re-run `npm run typecheck 2>&1 | grep "src/routes/email.ts" | wc -l` and confirm the count is decreasing. Continue until it reaches 0.

- [ ] **Step 5: Full typecheck clean**

Run: `npm run typecheck`
Expected: 0 errors anywhere in the repo (not just email.ts — a stray syntax slip while editing 57 sites could break something else; the full command catches that).

- [ ] **Step 6: Run the full test suite**

Run: `npx vitest run`
Expected: all pass. Some existing tests that exercise `graphFetch`/`ensureValidToken` indirectly (if any — check `tests/emailSend.test.ts`, `tests/emailOutboxDrain.test.ts`, `tests/emailScheduledDrainKekFailure.test.ts` for any that construct a Bindings-like `env` and call route logic) may need their fixture updated to include a `userId` in scope or a mock `user_graph_tokens` lookup — fix any that fail, following the pattern of whichever existing test needed the update (read the failure message; it will point at the exact mismatch).

- [ ] **Step 7: Commit**

```bash
git add src/routes/email.ts tests/
git commit -m "refactor(email): thread userId through graphFetch/ensureValidToken (Phase 3 core signature change)"
```

Note: if Step 6 required test fixture fixes, include those files in this same commit — they're part of making this signature change compile and pass, not a separate task.

---

### Task 4: Per-user poller loop

**Files:**
- Modify: `src/routes/email.ts` — `runEmailPoll`

**Interfaces:**
- Consumes: `listConnectedUserIds(db: D1Database): Promise<number[]>` from Task 1's `src/utils/userGraphTokens.ts`.
- Produces: `runEmailPoll`'s exported return shape gains a `perUser` breakdown; check `src/index.ts`'s cron handler (wherever `runEmailPoll` is currently invoked) for how the return value is consumed and keep that call site compiling — read it before changing the return type.

- [ ] **Step 1: Read the current `runEmailPoll` in full**

Run: `grep -n "export async function runEmailPoll" src/routes/email.ts` and read the entire function (it's long — spans the singleton-token check, the rules query, the per-message loop with rule matching, autolinking, and DB upsert). Also run `grep -rn "runEmailPoll(" src/index.ts` to see exactly how the cron handler calls it and what it does with the return value — you must keep that call site compiling.

- [ ] **Step 2: Write the failing test**

Create/extend a test file (check if `tests/` already has one covering `runEmailPoll` at the unit level — likely not, since it needs live Graph calls; if none exists, create `tests/runEmailPollPerUser.test.ts` with a STRUCTURAL check, matching the pattern used for Task 2's connect routes, since a full poll-loop integration test needs Miniflare + mocked Graph responses which is a heavier lift than this task's scope justifies):

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('runEmailPoll loops over connected users', () => {
  it('calls listConnectedUserIds instead of reading a singleton oauthInitiator', () => {
    const src = readFileSync(new URL('../src/routes/email.ts', import.meta.url), 'utf-8');
    const fnMatch = src.match(/export async function runEmailPoll[\s\S]*?\n\}\n/);
    expect(fnMatch).toBeTruthy();
    const fnSrc = fnMatch![0];
    expect(fnSrc).toMatch(/listConnectedUserIds/);
  });

  it('a single users poll failure is caught per-user (does not throw out of the whole function)', () => {
    const src = readFileSync(new URL('../src/routes/email.ts', import.meta.url), 'utf-8');
    const fnMatch = src.match(/export async function runEmailPoll[\s\S]*?\n\}\n/);
    const fnSrc = fnMatch![0];
    // Expect at least one try/catch inside the per-user loop body, distinct
    // from the existing per-message try/catch already in this function.
    const tryCount = (fnSrc.match(/\btry\s*\{/g) || []).length;
    expect(tryCount).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/runEmailPollPerUser.test.ts`
Expected: FAIL — `runEmailPoll` still reads the singleton.

- [ ] **Step 4: Rewrite `runEmailPoll` to loop over connected users**

Read the CURRENT function body (from Step 1) and restructure it: hoist everything currently keyed on the single `ownerUserId` (derived from `oauthInitiator`) into a per-user loop over `await listConnectedUserIds(env.DB)`. Wrap each user's poll body in its own `try/catch` so one user's failure (expired token, Graph error, malformed data) doesn't stop the others — log the error via `log.error` (already imported/used elsewhere in this file) and continue to the next user. Sum the per-user `{scanned, upserted, ruleHits, linked}` counts into the function's overall return value; add a `perUser: Array<{userId: number; scanned: number; upserted: number; error?: string}>` field to the return shape for diagnosability, and update `src/index.ts`'s cron handler call site if it destructures the old flat return shape in a way that would now be misleading (read that call site from Step 1 to decide — if it just logs the counts, extending the shape additively is enough; do not remove any existing field the cron handler reads).

Since this task's exact line-by-line transformation depends on reading the function's current full body (which is long and may have shifted slightly from earlier phases' edits), the required OUTCOME is:
- The function no longer reads `K.oauthInitiator` / a singleton owner at all — remove that logic entirely.
- It calls `listConnectedUserIds(env.DB)` and iterates the result.
- For each `userId`, it performs the SAME per-user logic the function already has today (list inbox messages via `graphFetch(env, userId, ...)`, evaluate rules scoped to that user via the existing `WHERE is_active = 1 AND (owner_user_id IS NULL OR owner_user_id = ?)` pattern, run the autolinker, upsert into `email_messages` with `owner_user_id = userId`) — this logic itself does NOT change, only the OUTER loop that used to run once now runs once per connected user.
- A per-user try/catch means one user's Graph 401/500/network error is logged and skipped, not fatal to the whole poll.
- The overall skip conditions (`enabled !== 'true'`) still apply globally before the per-user loop starts — check `system_config` once, not per-user (polling is enabled/disabled organization-wide; only WHO gets polled becomes per-user).

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/runEmailPollPerUser.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: Typecheck and full suite**

Run: `npm run typecheck && npx vitest run`
Expected: both clean

- [ ] **Step 7: Commit**

```bash
git add src/routes/email.ts tests/runEmailPollPerUser.test.ts
git commit -m "feat(email): poll each connected user's mailbox independently"
```

---

### Task 5: Best-effort migration of the existing shared token

**Files:**
- Modify: `src/routes/email.ts` — `runEmailPoll` (or a dedicated one-time migration function called from it, your choice — a small standalone function called once at the top of `runEmailPoll` is cleaner and self-contained) OR a Worker startup/admin-triggered path — pick whichever this codebase's existing patterns favor (check if there's a precedent for "run once, mark done" migrations in `src/` outside the `migrations/` SQL folder; if not, a small idempotent function guarded by a `system_config` flag like `email_phase3_migrated = 'true'` is the simplest approach and matches this project's `setConfigValueIfMissing`-style idempotent seeding elsewhere).
- Test: `tests/emailPhase3Migration.test.ts` (new)

**Interfaces:**
- Consumes: `saveUserGraphToken` from Task 1, `getCfgDecrypted`/`getCfg`/`setCfg` (already exist in this file).

- [ ] **Step 1: Write the failing test**

Create `tests/emailPhase3Migration.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { migrateSharedTokenToUserGraphTokens } from '../src/routes/email';

function fakeDb(configRows: Record<string, string> = {}, existingUserToken = false) {
  const config = new Map(Object.entries(configRows));
  let migrated = false;
  let savedUserId: number | null = null;
  return {
    _wasCalled: () => savedUserId,
    prepare: (sql: string) => ({
      bind: (...params: unknown[]) => ({
        first: async () => {
          if (sql.includes('system_config') && sql.includes('config_key = ?')) {
            const key = params[params.length - 1] as string;
            return config.has(key) ? { config_value: config.get(key) } : null;
          }
          return null;
        },
        run: async () => {
          if (sql.includes('INSERT') && sql.includes('user_graph_tokens')) savedUserId = params[0] as number;
          return { success: true, meta: {} };
        },
      }),
    }),
  } as unknown as D1Database;
}

describe('migrateSharedTokenToUserGraphTokens', () => {
  it('is a no-op when there is no recorded oauthInitiator', async () => {
    const db = fakeDb({});
    const env = { DB: db, JWT_SECRET: 'test-secret-at-least-32-bytes-long' } as any;
    await expect(migrateSharedTokenToUserGraphTokens(env)).resolves.not.toThrow();
  });

  it('does not throw when the shared token config is present but incomplete', async () => {
    const db = fakeDb({ ms_email_oauth_initiator: '5' });
    const env = { DB: db, JWT_SECRET: 'test-secret-at-least-32-bytes-long' } as any;
    await expect(migrateSharedTokenToUserGraphTokens(env)).resolves.not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/emailPhase3Migration.test.ts`
Expected: FAIL — `migrateSharedTokenToUserGraphTokens` is not exported from `src/routes/email.ts`.

- [ ] **Step 3: Implement the migration function**

Add this exported function to `src/routes/email.ts` (near `runEmailPoll`, since that's where it will be invoked from):

```ts
// One-time, best-effort migration (Phase 3): the single shared admin-owned
// token (owned by whoever is recorded in K.oauthInitiator) gets copied into
// user_graph_tokens for that same user, so they don't lose access on
// deploy day. Everyone else connects fresh via /connect/authorize.
// Guarded by a system_config flag so it only ever runs once. Never throws —
// worst case on failure is that one user reconnects manually, same as
// everyone else.
export async function migrateSharedTokenToUserGraphTokens(env: Bindings): Promise<void> {
  const alreadyMigrated = await getCfg(env.DB, 'email_phase3_migrated');
  if (alreadyMigrated === 'true') return;
  try {
    const initiator = await getCfg(env.DB, K.oauthInitiator);
    const userId = initiator ? parseInt(initiator, 10) : 0;
    if (userId) {
      const accessToken = await getCfgDecrypted(env, K.accessToken);
      const refreshToken = await getCfgDecrypted(env, K.refreshToken);
      const expiresAtStr = await getCfg(env.DB, K.tokenExpiresAt);
      const mailbox = await getCfg(env.DB, K.mailbox);
      if (accessToken && refreshToken && expiresAtStr) {
        await saveUserGraphToken(env.DB, env, userId, {
          accessToken,
          refreshToken,
          expiresAt: parseInt(expiresAtStr, 10),
          mailbox: mailbox ?? undefined,
        });
      }
    }
  } catch (err) {
    log.error('Phase 3 shared-token migration failed (best-effort, non-fatal)', {}, err);
  }
  await setCfg(env.DB, 'email_phase3_migrated', 'true');
}
```

- [ ] **Step 4: Call it once from `runEmailPoll`**

At the very top of `runEmailPoll` (before the `enabled !== 'true'` check, so the migration runs even if polling itself happens to be disabled at the moment — it's a one-time data move, unrelated to whether polling is currently on), add:

```ts
await migrateSharedTokenToUserGraphTokens(env);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/emailPhase3Migration.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: Typecheck and full suite**

Run: `npm run typecheck && npx vitest run`
Expected: both clean

- [ ] **Step 7: Commit**

```bash
git add src/routes/email.ts tests/emailPhase3Migration.test.ts
git commit -m "feat(email): best-effort migrate the existing shared token to its owning user"
```

---

### Task 6: Client — connect-gate `EmailPage.tsx`, narrow `AdminEmailTab.tsx`

**Files:**
- Modify: `client/src/pages/EmailPage.tsx` — add a connect-gate at the top of the page
- Modify: `client/src/pages/admin/AdminEmailTab.tsx` — remove the shared authorize/enable-for-everyone UI, keep only Azure app-registration credential fields
- Test: whatever this repo's existing pattern is for `EmailPage.tsx`/`AdminEmailTab.tsx` tests (check `client/src/pages/__tests__/` or co-located `.test.tsx` files for these two — follow the existing test file's setup/mocking style exactly, do not introduce a new testing pattern)

**Interfaces:**
- Consumes: `GET /api/email/connect/status` → `{connected: boolean, mailbox: string | null}` (from Task 2).
- Consumes: `GET /api/email/connect/authorize` → `{url: string}` (from Task 2) — client redirects the browser to `url` on "Connect" click.
- Consumes: `DELETE /api/email/connect` (from Task 2) — client calls this on "Disconnect."

- [ ] **Step 1: Find the existing test setup pattern for these two files**

Run: `find client/src -iname "EmailPage.test.tsx" -o -iname "AdminEmailTab.test.tsx"` — read whichever exists to learn this project's exact mocking approach for `apiFetch` (likely `vi.mock('../hooks/useApi', ...)` or similar). If neither file has an existing test, check a comparable page's test (e.g. search `client/src/pages/__tests__/` for a page with a similar "gate on a status check" pattern) and follow that structure.

- [ ] **Step 2: Read the current top of `EmailPage.tsx`**

Run: `grep -n "^export default function EmailPage" client/src/pages/EmailPage.tsx` and read from there through the first `useEffect`/data-loading logic (roughly the first 100-150 lines) to find where to insert a connect-status check before the existing inbox-loading logic runs.

- [ ] **Step 3: Write the failing test**

Add (or create) a test file matching the pattern found in Step 1. The exact assertions:
- Renders a "Connect your mailbox" prompt (button/link) when `GET /connect/status` returns `{connected: false, mailbox: null}`.
- Renders the normal inbox UI (does NOT render the connect prompt) when it returns `{connected: true, mailbox: 'officer@rmpgutah.us'}`.
- Clicking "Connect" triggers a request to `GET /connect/authorize` and navigates the browser to the returned `url` (mock `window.location.href` assignment or whatever navigation mechanism this codebase's existing OAuth-launch code already uses — check how the EXISTING admin "Authorize" button in `AdminEmailTab.tsx` does this today via `grep -n "admin/oauth/authorize" client/src` and mirror that exact navigation call).

Write the concrete test code once you've read Step 1's pattern — do not skip writing real assertions; follow this codebase's existing React Testing Library conventions (render, screen.getByText/getByRole, waitFor) exactly as the reference test file does.

- [ ] **Step 4: Run test to verify it fails**

Run: `cd client && npx vitest run <the test file>`
Expected: FAIL — the connect-gate doesn't exist yet.

- [ ] **Step 5: Implement the connect-gate in `EmailPage.tsx`**

Add a `useState`/`useEffect` pair near the top of the component that calls `apiFetch<{connected: boolean; mailbox: string | null}>('/email/connect/status')` on mount. While loading, show the existing page's loading pattern (check what spinner/skeleton convention the file already uses elsewhere). Once loaded: if `!connected`, render a simple centered panel with a message ("Connect your Microsoft 365 mailbox to use email") and a button that calls `apiFetch<{url: string}>('/email/connect/authorize')` then navigates the browser to the returned `url` — RETURN EARLY from the component's render (do not mount the rest of the inbox UI, its data-fetching effects, etc., while unconnected — this avoids firing a barrage of 401s/empty-state requests against endpoints that now require a connected mailbox). If `connected`, proceed to render the existing inbox UI unchanged.

- [ ] **Step 6: Run test to verify it passes**

Run: `cd client && npx vitest run <the test file>`
Expected: PASS

- [ ] **Step 7: Narrow `AdminEmailTab.tsx`**

Read the current file (`client/src/pages/admin/AdminEmailTab.tsx`) in full. Remove any UI for: the shared "Authorize" button (was calling `/admin/oauth/authorize`), the "enabled" toggle if it was specifically about the shared mailbox being on/off (Azure app-registration credentials themselves — clientId/secret/tenantId fields — stay, since that config is still admin-managed per the design). If the file has a "connection status" section showing the shared mailbox's authorized state, remove it (there's no longer a single shared authorized state to show — connection is per-user now, visible on each user's own `EmailPage.tsx`). Keep whatever SMTP-fallback-disabled messaging exists if present (unrelated to this phase). This step doesn't need new tests beyond confirming any existing `AdminEmailTab.test.tsx` (if one exists) still passes after removing the now-dead UI — update/remove any test assertions that specifically tested the removed authorize button.

- [ ] **Step 8: Run the client test suite and typecheck**

Run: `cd client && npx tsc --noEmit && npx vitest run`
Expected: both clean

- [ ] **Step 9: Commit**

```bash
git add client/src/pages/EmailPage.tsx client/src/pages/admin/AdminEmailTab.tsx client/src/pages/__tests__/ client/src/pages/admin/
git commit -m "feat(email): client connect-gate for per-user mailboxes, narrow admin tab to app-registration only"
```

---

### Task 7: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full worker test suite**

Run: `npx vitest run`
Expected: all pass.

- [ ] **Step 2: Run worker and client typecheck**

Run: `npm run typecheck && cd client && npx tsc --noEmit`
Expected: both 0 errors.

- [ ] **Step 3: Run the full client test suite**

Run: `cd client && npx vitest run`
Expected: all pass. Per project convention, run the FULL suite, not just targeted email tests — do NOT run this concurrently with the root worker suite (known to produce fake failures under contention per this project's own documented experience) — run them sequentially.

- [ ] **Step 4: Confirm scope**

Run: `git diff <phase-3-start-commit> --stat`
Expected: `migrations/`, `src/utils/userGraphTokens.ts`, `src/routes/email.ts`, `client/src/pages/EmailPage.tsx`, `client/src/pages/admin/AdminEmailTab.tsx`, and the new test files. No unrelated files.

- [ ] **Step 5: Manual deployment notes for the final report**

Record clearly in the final report (not automated by this plan):
- The new migration must be applied to live D1 via `scripts/apply-migration.sh <the migration filename>` after merge, per this project's standard migration-deployment process (CLAUDE.md's "Schema changes (D1)" section) — deploy's own migration-apply step is `continue-on-error` and cannot be trusted alone.
- After deploy, the person who originally connected the shared mailbox should verify their access carried over via the Task 5 migration (check `GET /email/connect/status` returns `connected: true` for them without needing to click Connect); everyone else needs to click "Connect your mailbox" once.
- The old singleton config keys (`ms_email_access_token`, `ms_email_refresh_token`, `ms_email_mailbox`, `ms_email_oauth_initiator`, `ms_email_token_expires_at`) are now unused dead data in `system_config` — this plan does NOT clean them up (leaving unused rows is harmless; deleting them is out of scope and not worth the risk of touching a working migration path unnecessarily).

- [ ] **Step 6: Final commit if any cleanup was needed**

If Steps 1-3 required fixes, commit them separately with a clear message. If everything passed clean, no action needed here.
