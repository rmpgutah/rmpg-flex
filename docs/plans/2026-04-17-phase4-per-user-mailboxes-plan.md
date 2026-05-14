# Phase 4: Per-User M365 Mailboxes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Replace the single shared M365 mailbox with per-user OAuth, scoping all email operations to the authenticated user's own mailbox.

**Architecture:** Add `user_graph_tokens` table (AES-256-GCM tokens per user, reusing the existing encryption primitives in `msGraphClient.ts`). Refactor `getGraphClient(userId)` and `ensureValidToken(userId)` to read per-user tokens. Wipe pre-Phase-4 email data on first deploy. Sequential poller iterates enrolled users. Self-service enrollment banner on `EmailPage`.

**Tech Stack:** TypeScript / Express 5 / better-sqlite3 / `@microsoft/microsoft-graph-client` / vitest / React.

---

## Pre-flight notes

- Working branch: `claude/phase4-per-user-mailboxes` (already cut from current main containing merged Phases 1-3 + ReDoS fix).
- Design doc: `docs/plans/2026-04-17-phase4-per-user-mailboxes-design.md` (commit `9af6f8b1`).
- DDL style rule (CLAUDE.md #42): every CREATE / ALTER as a single `db.prepare('...').run()`.
- The Edit-tool security hook also blocks the literal substring `e``x``e``c(` in source — for regex iteration, use `String.prototype.matchAll`, never `RegExp.prototype` direct iteration on raw text.
- `auditLog` writes to `activity_log` not `audit_log`. Signature: `auditLog(req, action, entityType, entityId, before?, after?)`.
- `JWT_SECRET` rotation invalidates all per-user tokens (same as TOTP secrets — CLAUDE.md #1). Don't try to be clever about this; document it.
- Existing `encrypt()` / `decrypt()` in `msGraphClient.ts:23-45` are module-private. Task A1 exports them as `encryptToken` / `decryptToken`.

---

## Group A — Token storage + encryption primitives

### Task A1: Export encryption primitives

**Why:** The new `userGraphTokens.ts` module (Task A3) needs to encrypt per-user tokens using the same AES-256-GCM scheme that protects shared tokens today.

**Files:** Modify `server/src/utils/msGraphClient.ts`

**Step 1:** At line ~23-45 where `encrypt()` and `decrypt()` are defined, change them from module-private to exported. Add explicit JSDoc:

```ts
/** AES-256-GCM encrypt with key derived from JWT_SECRET. Output is iv:authTag:ciphertext (hex). */
export function encryptToken(plaintext: string): string {
  // ... existing encrypt() body
}

/** Decrypt a string produced by encryptToken(). Throws on tamper or wrong key. */
export function decryptToken(stored: string): string {
  // ... existing decrypt() body
}
```

Also keep the original `encrypt`/`decrypt` aliases temporarily (point to the new exports) so the rest of `msGraphClient.ts` doesn't break. Or rename in-place and update internal callers — preferred since it's one file.

**Step 2:** Typecheck: `cd server && npx tsc --noEmit` — no NEW errors.

**Step 3:** Commit:
```bash
git add server/src/utils/msGraphClient.ts
git commit -m "refactor(email): export encryptToken/decryptToken for per-user reuse"
```

---

### Task A2: Add user_graph_tokens table

**Files:** Modify `server/src/models/database.ts`

**Step 1:** In the email-section block (around line 3717 where `email_links` is created), insert after the email_rules block:

```ts
db.prepare(`CREATE TABLE IF NOT EXISTS user_graph_tokens (
  user_id INTEGER PRIMARY KEY,
  access_token_enc TEXT NOT NULL,
  refresh_token_enc TEXT,
  token_expires_at INTEGER NOT NULL,
  mailbox TEXT,
  scopes TEXT,
  enrolled_at TEXT NOT NULL,
  last_sync_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
)`).run();
```

**Step 2:** Boot sanity check:
```bash
cd server && npx tsx -e "import('./src/models/database').then(m => { m.initDatabase(); console.log('OK'); })"
```

**Step 3:** Commit:
```bash
git add server/src/models/database.ts
git commit -m "feat(db): user_graph_tokens table for per-user M365 OAuth"
```

---

### Task A3: User token storage module + tests

**Files:**
- Create: `server/src/utils/userGraphTokens.ts`
- Create: `server/src/__tests__/userGraphTokens.test.ts`

**Step 1 — Failing test first:**

```ts
// server/src/__tests__/userGraphTokens.test.ts
import { describe, it, expect, vi } from 'vitest';
import Database from 'better-sqlite3';

vi.mock('../models/database', () => {
  const _db = new Database(':memory:');
  _db.prepare(`CREATE TABLE user_graph_tokens (
    user_id INTEGER PRIMARY KEY, access_token_enc TEXT NOT NULL, refresh_token_enc TEXT,
    token_expires_at INTEGER NOT NULL, mailbox TEXT, scopes TEXT, enrolled_at TEXT NOT NULL, last_sync_at TEXT
  )`).run();
  return { getDb: () => _db };
});
vi.mock('../utils/timeUtils', () => ({ localNow: () => '2026-04-17 10:00:00' }));
vi.mock('../utils/msGraphClient', () => ({
  encryptToken: (s: string) => `enc:${s}`,
  decryptToken: (s: string) => s.replace(/^enc:/, ''),
}));

import { setUserTokens, getUserTokens, deleteUserTokens, isUserEnrolled, listEnrolledUserIds } from '../utils/userGraphTokens';

describe('userGraphTokens', () => {
  it('round-trips access + refresh tokens (encrypted at rest)', () => {
    setUserTokens(1, { accessToken: 'AAA', refreshToken: 'RRR', expiresAt: 9999, mailbox: 'a@b.c', scopes: 'Mail.Send' });
    const t = getUserTokens(1);
    expect(t).toEqual(expect.objectContaining({ accessToken: 'AAA', refreshToken: 'RRR', mailbox: 'a@b.c' }));
  });
  it('returns null for unenrolled user', () => {
    expect(getUserTokens(99)).toBeNull();
  });
  it('isUserEnrolled mirrors token presence', () => {
    expect(isUserEnrolled(1)).toBe(true);
    expect(isUserEnrolled(99)).toBe(false);
  });
  it('deleteUserTokens removes the row', () => {
    deleteUserTokens(1);
    expect(getUserTokens(1)).toBeNull();
  });
  it('listEnrolledUserIds returns all enrolled', () => {
    setUserTokens(1, { accessToken: 'A', refreshToken: 'R', expiresAt: 1, mailbox: '', scopes: '' });
    setUserTokens(2, { accessToken: 'A', refreshToken: 'R', expiresAt: 1, mailbox: '', scopes: '' });
    expect(listEnrolledUserIds().sort()).toEqual([1, 2]);
  });
});
```

Run: `cd server && npx vitest run src/__tests__/userGraphTokens.test.ts` — expect failure.

**Step 2 — Implement:**

```ts
// server/src/utils/userGraphTokens.ts
import { getDb } from '../models/database';
import { localNow } from './timeUtils';
import { encryptToken, decryptToken } from './msGraphClient';

export interface UserTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
  mailbox: string;
  scopes: string;
}

export function setUserTokens(userId: number, t: UserTokens): void {
  const db = getDb();
  const enrolledAt = localNow();
  db.prepare(
    `INSERT INTO user_graph_tokens (user_id, access_token_enc, refresh_token_enc, token_expires_at, mailbox, scopes, enrolled_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       access_token_enc=excluded.access_token_enc,
       refresh_token_enc=excluded.refresh_token_enc,
       token_expires_at=excluded.token_expires_at,
       mailbox=excluded.mailbox,
       scopes=excluded.scopes`
  ).run(
    userId,
    encryptToken(t.accessToken),
    t.refreshToken ? encryptToken(t.refreshToken) : null,
    t.expiresAt,
    t.mailbox,
    t.scopes,
    enrolledAt,
  );
}

export function getUserTokens(userId: number): UserTokens | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM user_graph_tokens WHERE user_id = ?').get(userId) as any;
  if (!row) return null;
  try {
    return {
      accessToken: decryptToken(row.access_token_enc),
      refreshToken: row.refresh_token_enc ? decryptToken(row.refresh_token_enc) : null,
      expiresAt: row.token_expires_at,
      mailbox: row.mailbox || '',
      scopes: row.scopes || '',
    };
  } catch {
    return null;  // tampered/key-rotated → treat as not enrolled
  }
}

export function deleteUserTokens(userId: number): void {
  getDb().prepare('DELETE FROM user_graph_tokens WHERE user_id = ?').run(userId);
}

export function isUserEnrolled(userId: number): boolean {
  return getUserTokens(userId) !== null;
}

export function listEnrolledUserIds(): number[] {
  const rows = getDb().prepare('SELECT user_id FROM user_graph_tokens ORDER BY user_id').all() as { user_id: number }[];
  return rows.map(r => r.user_id);
}

export function markUserSynced(userId: number): void {
  getDb().prepare('UPDATE user_graph_tokens SET last_sync_at = ? WHERE user_id = ?').run(localNow(), userId);
}

export function markUserNeedsReauth(userId: number): void {
  getDb().prepare('UPDATE user_graph_tokens SET token_expires_at = 0 WHERE user_id = ?').run(userId);
}
```

Run test — expect 5/5 passing.

**Step 3 — Commit:**
```bash
git add server/src/utils/userGraphTokens.ts server/src/__tests__/userGraphTokens.test.ts
git commit -m "feat(email): user-scoped token storage module"
```

---

## Group B — Graph client per-user refactor

### Task B1: Per-user `ensureValidToken(userId)`

**Files:** Modify `server/src/utils/msGraphClient.ts`

**Step 1:** Add a NEW function alongside the existing `ensureValidToken()` (don't delete yet):

```ts
import { getUserTokens, setUserTokens, markUserNeedsReauth } from './userGraphTokens';

export async function ensureValidTokenForUser(userId: number): Promise<string> {
  const tokens = getUserTokens(userId);
  if (!tokens) throw new Error(`User ${userId} not enrolled — needs OAuth`);
  if (tokens.expiresAt > Date.now() + 60_000) return tokens.accessToken;  // valid >1 min

  // Refresh
  const clientId = getDecryptedValue(CONFIG_KEYS.clientId);
  const clientSecret = getDecryptedValue(CONFIG_KEYS.clientSecret);
  const tenantId = getDecryptedValue(CONFIG_KEYS.tenantId);
  if (!clientId || !clientSecret || !tenantId || !tokens.refreshToken) {
    markUserNeedsReauth(userId);
    throw new Error(`User ${userId} token refresh failed: missing refresh_token or app config`);
  }

  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
    refresh_token: tokens.refreshToken,
    scope: GRAPH_SCOPES.join(' '),
  });
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  if (!res.ok) {
    markUserNeedsReauth(userId);
    throw new Error(`Token refresh HTTP ${res.status}`);
  }
  const data = await res.json() as any;
  setUserTokens(userId, {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || tokens.refreshToken,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
    mailbox: tokens.mailbox,
    scopes: tokens.scopes,
  });
  return data.access_token;
}

export async function getGraphClientForUser(userId: number): Promise<Client> {
  const accessToken = await ensureValidTokenForUser(userId);
  return Client.init({ authProvider: (done) => done(null, accessToken) });
}

export function isUserAuthorized(userId: number): boolean {
  const tokens = getUserTokens(userId);
  return !!tokens && tokens.expiresAt > 0;  // 0 = marked for reauth
}
```

**Step 2:** Add a unit test mocking `getUserTokens`:

```ts
// server/src/__tests__/msGraphClientPerUser.test.ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('../utils/userGraphTokens', () => ({
  getUserTokens: vi.fn(),
  setUserTokens: vi.fn(),
  markUserNeedsReauth: vi.fn(),
}));
vi.mock('../models/database', () => ({ getDb: () => ({ prepare: () => ({ get: () => null }) }) }));

import { ensureValidTokenForUser } from '../utils/msGraphClient';
import * as userTokens from '../utils/userGraphTokens';

describe('ensureValidTokenForUser', () => {
  it('throws if user not enrolled', async () => {
    (userTokens.getUserTokens as any).mockReturnValue(null);
    await expect(ensureValidTokenForUser(1)).rejects.toThrow(/not enrolled/);
  });
  it('returns existing token if not expired', async () => {
    (userTokens.getUserTokens as any).mockReturnValue({
      accessToken: 'AAA', refreshToken: 'RRR', expiresAt: Date.now() + 600_000, mailbox: '', scopes: '',
    });
    const t = await ensureValidTokenForUser(1);
    expect(t).toBe('AAA');
  });
});
```

Run vitest, expect green.

**Step 3 — Commit:**
```bash
git add server/src/utils/msGraphClient.ts server/src/__tests__/msGraphClientPerUser.test.ts
git commit -m "feat(email): per-user Graph client + token refresh"
```

---

### Task B2: OAuth authorize endpoint per-user

**Files:** Modify `server/src/routes/email.ts` and `server/src/utils/msGraphClient.ts`

**Step 1:** In `msGraphClient.ts`, add JWT-state OAuth helpers:

```ts
import jwt from 'jsonwebtoken';

export function buildOAuthStateForUser(userId: number): string {
  return jwt.sign(
    { userId, nonce: crypto.randomBytes(16).toString('hex'), purpose: 'graph_oauth' },
    config.jwt.secret,
    { expiresIn: '10m' }
  );
}

export function verifyOAuthStateForUser(state: string): number {
  const decoded = jwt.verify(state, config.jwt.secret) as any;
  if (decoded.purpose !== 'graph_oauth' || typeof decoded.userId !== 'number') {
    throw new Error('Invalid OAuth state');
  }
  return decoded.userId;
}

export function getAuthorizationUrlForUser(userId: number, redirectUri: string): string {
  const clientId = getDecryptedValue(CONFIG_KEYS.clientId);
  const tenantId = getDecryptedValue(CONFIG_KEYS.tenantId);
  if (!clientId || !tenantId) throw new Error('Email integration not configured');
  const state = buildOAuthStateForUser(userId);
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    response_mode: 'query',
    scope: GRAPH_SCOPES.join(' '),
    state,
    prompt: 'select_account',
  });
  return `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?${params}`;
}

export async function exchangeCodeForUserTokens(code: string, redirectUri: string, userId: number): Promise<void> {
  const clientId = getDecryptedValue(CONFIG_KEYS.clientId);
  const clientSecret = getDecryptedValue(CONFIG_KEYS.clientSecret);
  const tenantId = getDecryptedValue(CONFIG_KEYS.tenantId);
  if (!clientId || !clientSecret || !tenantId) throw new Error('Not configured');

  const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }).toString(),
  });
  if (!res.ok) throw new Error(`Token exchange HTTP ${res.status}`);
  const data = await res.json() as any;

  // Probe mailbox identity
  let mailbox = '';
  try {
    const meRes = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: { Authorization: `Bearer ${data.access_token}` },
    });
    if (meRes.ok) {
      const me = await meRes.json() as any;
      mailbox = me.userPrincipalName || me.mail || '';
    }
  } catch { /* tolerated */ }

  setUserTokens(userId, {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || null,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
    mailbox,
    scopes: data.scope || GRAPH_SCOPES.join(' '),
  });
}
```

Add `import { setUserTokens } from './userGraphTokens';` at top.

**Step 2:** In `email.ts`, add a new authenticated route and update the existing OAuth callback to per-user flow:

```ts
import { getAuthorizationUrlForUser, verifyOAuthStateForUser, exchangeCodeForUserTokens } from '../utils/msGraphClient';

// Add (after authenticateToken middleware applied at line ~138):
router.get('/oauth/authorize', (req: Request, res: Response) => {
  try {
    const host = config.isProduction ? 'rmpgutah.us' : (req.get('host') || 'localhost:3001');
    const redirectUri = `https://${host}/api/email/oauth/callback`;
    const url = getAuthorizationUrlForUser(req.user!.userId, redirectUri);
    res.json({ authorizationUrl: url });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Replace the existing /oauth/callback handler (line 94) with per-user version:
// Keep it OUTSIDE the authenticateToken middleware — Microsoft hits it without our JWT.
router.get('/oauth/callback', async (req: Request, res: Response) => {
  try {
    const { code, state, error } = req.query;
    if (error) return res.redirect('/email?status=error&message=Microsoft+denied');
    if (!code || !state) return res.redirect('/email?status=error&message=Missing+code');
    let userId: number;
    try { userId = verifyOAuthStateForUser(String(state)); }
    catch { return res.redirect('/email?status=error&message=Invalid+state'); }

    const host = config.isProduction ? 'rmpgutah.us' : (req.get('host') || 'localhost:3001');
    const redirectUri = `https://${host}/api/email/oauth/callback`;
    await exchangeCodeForUserTokens(String(code), redirectUri, userId);

    if (getConfigValue(CONFIG_KEYS.enabled) !== 'true') setConfigValue(CONFIG_KEYS.enabled, 'true');
    res.redirect('/email?enrolled=1');
  } catch (err: any) {
    console.error('[OAuth] Per-user exchange failed:', err.message);
    res.redirect('/email?status=error&message=Token+exchange+failed');
  }
});
```

**Step 3:** Typecheck + tests:
```bash
cd server && npx tsc --noEmit && npx vitest run
```

**Step 4 — Commit:**
```bash
git add server/src/routes/email.ts server/src/utils/msGraphClient.ts
git commit -m "feat(email): per-user OAuth authorize + callback"
```

---

## Group C — Schema migration + wipe

### Task C1: Add owner_user_id columns

**Files:** Modify `server/src/models/database.ts`

**Step 1:** In the email-section block, after the `addCol('email_links', 'auto_linked', ...)` line, add:

```ts
addCol('email_cache',      'owner_user_id', 'INTEGER');
addCol('email_folders',    'owner_user_id', 'INTEGER');
addCol('email_rules',      'owner_user_id', 'INTEGER');
addCol('scheduled_emails', 'owner_user_id', 'INTEGER');

db.prepare(`CREATE INDEX IF NOT EXISTS idx_email_cache_owner    ON email_cache(owner_user_id, folder_id)`).run();
db.prepare(`CREATE INDEX IF NOT EXISTS idx_email_folders_owner  ON email_folders(owner_user_id)`).run();
db.prepare(`CREATE INDEX IF NOT EXISTS idx_email_rules_owner    ON email_rules(owner_user_id, enabled, priority)`).run();
db.prepare(`CREATE INDEX IF NOT EXISTS idx_scheduled_owner      ON scheduled_emails(owner_user_id, status)`).run();
```

**Step 2:** Boot check, commit:
```bash
git add server/src/models/database.ts
git commit -m "feat(db): owner_user_id columns + indexes for per-user email scoping"
```

---

### Task C2: One-shot wipe migration

**Files:** Modify `server/src/models/database.ts`

**Step 1:** After the schema additions in Task C1, add a one-shot migration block:

```ts
const phase4Done = db.prepare(
  "SELECT config_value FROM system_config WHERE config_key = 'phase4_migration_done'"
).get();
if (!phase4Done) {
  console.log('[Phase4] Running one-shot wipe of pre-Phase-4 email data...');
  db.transaction(() => {
    db.prepare('DELETE FROM email_rule_matches').run();
    db.prepare('DELETE FROM email_rules').run();
    db.prepare('DELETE FROM email_links').run();
    db.prepare('DELETE FROM scheduled_emails').run();
    db.prepare('DELETE FROM email_cache').run();
    db.prepare('DELETE FROM email_folders').run();
    for (const k of ['ms_email_access_token','ms_email_refresh_token','ms_email_token_expires_at','ms_email_mailbox','ms_email_last_sync']) {
      db.prepare("DELETE FROM system_config WHERE config_key = ? AND category = 'integrations'").run(k);
    }
  })();
  db.prepare(
    "INSERT INTO system_config (config_key, config_value, category) VALUES ('phase4_migration_done', ?, 'system')"
  ).run(localNow());
  console.log('[Phase4] Migration complete.');
}
```

**Step 2:** Boot twice — second boot must NOT re-wipe:
```bash
cd server && npx tsx -e "import('./src/models/database').then(m => { m.initDatabase(); console.log('1st OK'); m.initDatabase(); console.log('2nd OK'); })"
```

Should print `[Phase4] Running one-shot wipe...` once, then `[Phase4] Migration complete.` once.

**Step 3 — Commit:**
```bash
git add server/src/models/database.ts
git commit -m "feat(db): Phase 4 one-shot wipe migration (gated by system_config flag)"
```

---

## Group D — Status endpoint + enrollment banner

### Task D1: Update GET /api/email/status to include `enrolled`

**Files:** Modify `server/src/routes/email.ts` (the `/status` handler at line ~145)

```ts
import { isUserEnrolled, getUserTokens } from '../utils/userGraphTokens';

router.get('/status', (req: Request, res: Response) => {
  try {
    const status = getStatus();
    const userId = req.user!.userId;
    const enrolled = isUserEnrolled(userId);
    const tokens = enrolled ? getUserTokens(userId) : null;
    const db = getDb();
    const cached = db.prepare('SELECT COUNT(*) as count FROM email_cache WHERE owner_user_id = ?').get(userId) as { count: number };
    res.json({
      ...status,
      enrolled,
      mailbox: tokens?.mailbox || null,
      cachedMessages: cached?.count || 0,
    });
  } catch (err: any) {
    console.error('Email route error:', err.message);
    res.status(500).json({ error: 'Failed to email route', code: 'EMAIL_ROUTE_ERROR' });
  }
});
```

**Commit:**
```bash
git add server/src/routes/email.ts
git commit -m "feat(email): /status returns per-user enrolled flag + mailbox"
```

---

### Task D2: Enrollment banner component

**Files:** Create `client/src/components/email/EnrollmentBanner.tsx`

```tsx
import { useState } from 'react';
import { apiFetch } from '../../hooks/useApi';

export default function EnrollmentBanner() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function connect() {
    setBusy(true); setError('');
    try {
      const r = await apiFetch<{ authorizationUrl: string }>('/api/email/oauth/authorize');
      window.location.href = r.authorizationUrl;
    } catch (err: any) {
      setError(err?.message || 'Failed to start OAuth');
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-center justify-center h-full p-8 space-y-4">
      <div className="text-2xl">📧</div>
      <div className="text-sm font-semibold text-[#d4a017]">CONNECT YOUR MICROSOFT 365 MAILBOX</div>
      <div className="text-xs text-gray-400 max-w-md text-center">
        To use email in RMPG Flex, you need to authorize access to your Microsoft 365 mailbox.
        Your email stays in Microsoft's servers — RMPG Flex only displays it.
      </div>
      <button
        onClick={connect}
        disabled={busy}
        className="px-4 py-2 border border-[#d4a017] text-[#d4a017] text-xs hover:bg-[#d4a017]/10 disabled:opacity-50"
      >
        {busy ? 'REDIRECTING...' : 'CONNECT MICROSOFT 365'}
      </button>
      {error && <div className="text-xs text-red-400">{error}</div>}
    </div>
  );
}
```

**Commit:**
```bash
git add client/src/components/email/EnrollmentBanner.tsx
git commit -m "feat(email): client EnrollmentBanner component"
```

---

### Task D3: Wire banner into EmailPage

**Files:** Modify `client/src/pages/EmailPage.tsx`

**Step 1:** Import banner; add `enrolled` state read from `/api/email/status`. Where the EmailPage decides to render the inbox, add an early return:

```tsx
import EnrollmentBanner from '../components/email/EnrollmentBanner';

const [enrolled, setEnrolled] = useState<boolean | null>(null);

useEffect(() => {
  apiFetch<{ enrolled: boolean }>('/api/email/status')
    .then(s => setEnrolled(s.enrolled))
    .catch(() => setEnrolled(false));
}, []);

// Handle ?enrolled=1 callback
useEffect(() => {
  const params = new URLSearchParams(window.location.search);
  if (params.get('enrolled') === '1') {
    setEnrolled(true);
    window.history.replaceState({}, '', '/email');
  }
}, []);

// Early return BEFORE the main inbox render:
if (enrolled === false) return <EnrollmentBanner />;
if (enrolled === null) return <div className="p-8 text-center text-xs text-gray-500">Checking enrollment...</div>;
```

**Commit:**
```bash
git add client/src/pages/EmailPage.tsx
git commit -m "feat(email): EmailPage shows enrollment banner when not enrolled"
```

---

## Group E — Poller refactor

### Task E1: Refactor syncFolder/syncInbox to take userId

**Files:** Modify `server/src/utils/emailPoller.ts`

**Step 1:** Change signatures:
```ts
async function syncFolder(client: any, userId: number, folderName: string, folderId: string, limit: number): Promise<number>
async function syncInbox(userId: number): Promise<void>
```

**Step 2:** Inside `syncFolder`:
- Add `owner_user_id` to the upsert column list and to all INSERT/UPDATE bindings
- Change `checkExisting` query to `WHERE graph_id = ? AND owner_user_id = ?`
- Update upsert prepared statement to include `owner_user_id` and `excluded.owner_user_id` in the ON CONFLICT clause if appropriate

**Step 3:** Inside `syncInbox(userId)`:
- Replace `if (!isConfigured() || !isEnabled() || !isAuthorized()) return;` with `if (!isConfigured() || !isEnabled() || !isUserEnrolled(userId)) return;`
- Use `getGraphClientForUser(userId)` instead of `getGraphClient()`
- Pass `userId` into every `syncFolder` call

**Step 4:** Add `syncAllUsers()`:

```ts
import { listEnrolledUserIds, markUserSynced } from './userGraphTokens';
import { getGraphClientForUser, isUserAuthorized } from './msGraphClient';

async function syncAllUsers(): Promise<void> {
  if (!isEnabled()) return;
  const userIds = listEnrolledUserIds();
  for (const userId of userIds) {
    try {
      await syncInbox(userId);
      markUserSynced(userId);
    } catch (err: any) {
      console.warn(`[EmailPoller] User ${userId} sync failed:`, err.message);
      // ensureValidTokenForUser already marks needs-reauth on token failures
    }
  }
  await processScheduledEmails();
}
```

**Step 5:** Replace `setInterval(() => syncInbox().catch(...), pollMs)` calls with `syncAllUsers().catch(...)`.

**Step 6:** Run vitest, fix any test breakage. The existing rule-engine test mocks email_cache without owner_user_id — update it to add the column.

**Step 7 — Commit:**
```bash
git add server/src/utils/emailPoller.ts server/src/__tests__/emailRuleEngine.test.ts
git commit -m "refactor(email): per-user poller (sequential loop over enrolled users)"
```

---

### Task E2: Scope rule engine to user

**Files:** Modify `server/src/utils/emailRuleEngine.ts`

**Step 1:** Update the rule fetch to be user-scoped:

```ts
const email = db.prepare(
  `SELECT ec.id, ec.owner_user_id, ec.from_address, ec.subject, ec.has_attachments, ec.importance,
     COALESCE((SELECT body_text FROM email_cache_fts WHERE rowid = ec.id), '') as body_text
   FROM email_cache ec WHERE ec.id = ?`
).get(emailId) as any;
if (!email) return;

const rules = db.prepare(
  'SELECT * FROM email_rules WHERE enabled = 1 AND (owner_user_id IS NULL OR owner_user_id = ?) ORDER BY priority ASC'
).all(email.owner_user_id) as Rule[];
```

**Step 2:** Update the existing test to verify a user-scoped rule fires only for its owner. Add `owner_user_id` to test schema + insert.

**Step 3 — Commit:**
```bash
git add server/src/utils/emailRuleEngine.ts server/src/__tests__/emailRuleEngine.test.ts
git commit -m "feat(email): rule engine scoped to user-owned + global rules"
```

---

## Group F — Route scoping + send refactor

### Task F1: Scope all read routes to req.user.userId

**Files:** Modify `server/src/routes/email.ts`

For each handler, add `WHERE owner_user_id = ?` to the SQL and bind `req.user!.userId`. Specifically:

- `GET /unread-count` — count where owner_user_id matches
- `GET /folders` — `WHERE owner_user_id = ?`
- `GET /messages` — add to existing WHERE
- `GET /messages/search` (FTS) — add `AND ec.owner_user_id = ?` to outer where
- `GET /messages/:id` — verify the row's owner matches before returning
- `GET /messages/:id/attachments` and `/attachments/:aid` — same auth check
- `PATCH /messages/:id` and `DELETE /messages/:id` — owner check
- `POST /messages/:id/move` — owner check
- `GET /threads`, `GET /thread/:conversationId` — owner scope
- `GET /flagged` — owner scope
- `POST /categorize`, `/categorize/batch` — owner check on each id
- `GET /links/:emailGraphId` and `GET /links/incident/:incidentId` — only return links whose email belongs to this user

For owner-mismatch on a single-id route, return `404 Not Found` (don't leak existence).

**Commit:**
```bash
git add server/src/routes/email.ts
git commit -m "feat(email): scope all read routes to req.user.userId"
```

---

### Task F2: Send routes use per-user Graph client

**Files:** Modify `server/src/routes/email.ts`, `server/src/utils/emailSender.ts`

**Step 1:** Change `sendEmail` signature to accept `userId`:

```ts
export async function sendEmail(userId: number, options: SendEmailOptions): Promise<SendResult>
```

Inside, replace `isAuthorized()` with `isUserAuthorized(userId)` and `getGraphClient()` with `getGraphClientForUser(userId)`. SMTP fallback stays as-is — it's tenant-shared.

**Step 2:** Update all callers to pass `req.user!.userId` (route handlers) or `email.created_by` (poller scheduled-emails processor).

**Step 3:** `POST /schedule` — write `owner_user_id = req.user!.userId` into `scheduled_emails`. The poller's `processScheduledEmails` reads `created_by` (existing column) for sender identity.

**Commit:**
```bash
git add server/src/utils/emailSender.ts server/src/routes/email.ts server/src/utils/emailPoller.ts server/src/__tests__/emailSender.test.ts
git commit -m "refactor(email): sendEmail accepts userId, schedule writes owner_user_id"
```

---

### Task F3: Rule CRUD scope

**Files:** Modify `server/src/routes/emailRules.ts`

- `GET /` — return rules `WHERE owner_user_id = ? OR owner_user_id IS NULL` (current user's + global)
- `POST /` — non-admin: write `owner_user_id = req.user!.userId`. Admin with `req.body.global === true`: write `owner_user_id = NULL`.
- `PUT /:id` and `DELETE /:id` — owner must match req.user.userId, OR (rule is global AND user is admin)
- `POST /test-match` — `sample_email_id` must belong to req.user, AND `WHERE folder_id='inbox' AND owner_user_id = req.user.userId` for the no-sample case

**Commit:**
```bash
git add server/src/routes/emailRules.ts
git commit -m "feat(email): rule CRUD scoped to user (admin can write global rules)"
```

---

### Task F4: Auto-linker + tip-line scope

**Files:** Modify `server/src/utils/emailPoller.ts`, `server/src/models/database.ts`

**Step 1:** The auto-linker INSERT into `email_links` should set `created_by` to the email owner (links themselves are global by design — case ↔ email is the same case regardless of who owns the email).

**Step 2:** Tip-line — `email_tip_line_folder_id` is global, but it must belong to a designated user. Seed a new config key `email_tip_line_owner_user_id`:

```ts
const existingTipOwner = db.prepare(`SELECT config_value FROM system_config WHERE config_key = 'email_tip_line_owner_user_id'`).get();
if (!existingTipOwner) {
  db.prepare(`INSERT INTO system_config (config_key, config_value) VALUES (?, ?)`).run('email_tip_line_owner_user_id', '');
}
```

In the poller's tip-line block, only create CFS rows when `email.owner_user_id === Number(getConfigValue('email_tip_line_owner_user_id'))`.

**Commit:**
```bash
git add server/src/utils/emailPoller.ts server/src/models/database.ts
git commit -m "feat(email): auto-linker writes created_by; tip-line scoped to designated user"
```

---

## Group G — Final tests + checkpoint

### Task G1: Final gates

```bash
cd server && npx vitest run               # all green
cd server && npm run check:routes         # 0 duplicates
cd server && npx tsc --noEmit             # no NEW errors
cd client && npx tsc --noEmit             # 0 errors
```

### Task G2: Manual smoke checklist

In `npm run dev`:
1. Open Email page as User A → see EnrollmentBanner.
2. Click CONNECT MICROSOFT 365 → complete Microsoft consent → redirected to /email?enrolled=1 → inbox renders.
3. Send an email to yourself → after poller cycle, it appears in Inbox.
4. Log out, log in as User B → Email page → EnrollmentBanner (still unenrolled).
5. Enroll User B with a different M365 account → User B's inbox is empty / contains B's mail only, NOT A's.
6. Admin → Email → Rules → create a rule with `global: true` → verify it fires for both A and B.
7. Forward an email from User A to an external address with PII → redaction modal appears (Phase 3 still works).

### Task G3: Final checkpoint commit

```bash
git commit --allow-empty -m "checkpoint: Phase 4 (per-user mailboxes) complete — ready for review"
```

---

## Post-plan notes

- **Old shared-mailbox routes**: the `restartEmailPoller` import in `email.ts` and the original `syncNow()` are still used. They now operate over all users via the refactored poller — verify nothing else expects single-tenant behavior.
- **OAuth state JWT** uses `config.jwt.secret` which is also the encryption key. Acceptable — both fail closed if the secret rotates.
- **No backfill** for existing data because Task C2 wipes everything. Cases/incidents that previously had email_links lose them — documented in design §1.
- **Phase 5 ideas (out of scope)**: per-user Graph webhook subscriptions instead of polling, M365 SSO into the app, shared-mailbox role objects with grant lists.
