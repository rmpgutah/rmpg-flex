# Company Browser Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three hardening pieces to the already-shipped Company Browser feature (Desktop tab, Electron-only web browser): role-based access restriction, AES-256-GCM encryption at rest for bookmarks/history, and an RMPG ownership/proprietary-use notice.

**Architecture:** Role restriction is a two-line addition to existing exclusion sets already used by other internal-only modules. Encryption is a new Worker-side crypto module (mirroring the existing `emailCrypto.ts` pattern) that wraps the existing `PUT`/`GET /preferences` handlers — the client never sees ciphertext vs. plaintext. The ownership notice is client-only: a persistent footer line plus a one-time, `localStorage`-backed dismissible modal.

**Tech Stack:** Hono/D1 (`src/`), Web Crypto API (`crypto.subtle`, AES-GCM), React/TypeScript/Vite (`client/src/`), vitest.

## Global Constraints

- Encryption scope: only `user_preferences.browser_bookmarks_json`/`browser_history_json` — no other Company Browser data (webview partitions are out of scope).
- Encrypted key derivation must be domain-separated from `emailCrypto.ts`'s own fallback (which hashes bare `JWT_SECRET`) — this feature's fallback hashes `JWT_SECRET + '|company-browser-data-v1'`, never the bare secret.
- `decryptBrowserData` must return `null` (not throw) on any failure — a corrupted row or post-rotation mismatch degrades to "no bookmarks/history," never a 500.
- `decryptBrowserData` must pass through legacy plaintext (non-`"v1:"`-prefixed) values unchanged — real rows already exist in D1 from the pre-encryption version of this feature.
- Role restriction: block `/desktop-company-browser` for `client_viewer` and `contract_manager` only — every other authenticated role keeps access.
- Ownership notice: footer line reads exactly `"© 2026 Rocky Mountain Protective Group, LLC — Internal Use Only, Authorized Personnel Only"`. First-launch modal is per-user (`localStorage` key namespaced by `user?.id`, falling back to a role-only key when `id` is absent — matching the exact fallback style already used by `client/src/components/JailFormModal.tsx:48` for its own per-user draft key), shown once, single "I Understand" dismiss button.
- No new D1 migration — the columns already exist; encryption only changes what bytes are stored in them.
- No new required secret — `COMPANY_BROWSER_DATA_KEY` is optional (same pattern as `EMAIL_CRED_KEY`).

---

### Task 1: Block `client_viewer`/`contract_manager` from Company Browser

**Files:**
- Modify: `client/src/data/navCatalog.ts:37-45`
- Test: `client/src/data/navCatalog.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing other tasks depend on — fully independent of Tasks 2 and 3.

- [ ] **Step 1: Write the failing test**

Add to `client/src/data/navCatalog.test.ts` (in the existing `describe` block that already asserts `CLIENT_VIEWER_BLOCKED.has('/admin')`/`CONTRACT_MANAGER_BLOCKED.has('/admin')` — add these two lines alongside those existing assertions, in the same `it`):

```ts
    expect(CLIENT_VIEWER_BLOCKED.has('/desktop-company-browser')).toBe(true);
    expect(CONTRACT_MANAGER_BLOCKED.has('/desktop-company-browser')).toBe(true);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/data/navCatalog.test.ts`
Expected: FAIL — `expect(received).toBe(true)` with `received = false` for both new assertions (the path isn't in either set yet).

- [ ] **Step 3: Add the path to both blocked sets**

In `client/src/data/navCatalog.ts`, change:

```ts
export const CLIENT_VIEWER_BLOCKED = new Set([
  '/admin', '/audit', '/personnel', '/fleet', '/ncic',
  '/radio', '/patrol', '/shift-plans', '/statute-analytics',
  '/reports/custom', '/crime-analysis', '/dar',
]);

export const CONTRACT_MANAGER_BLOCKED = new Set([
  '/admin', '/personnel',
]);
```

to:

```ts
export const CLIENT_VIEWER_BLOCKED = new Set([
  '/admin', '/audit', '/personnel', '/fleet', '/ncic',
  '/radio', '/patrol', '/shift-plans', '/statute-analytics',
  '/reports/custom', '/crime-analysis', '/dar', '/desktop-company-browser',
]);

export const CONTRACT_MANAGER_BLOCKED = new Set([
  '/admin', '/personnel', '/desktop-company-browser',
]);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/data/navCatalog.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add client/src/data/navCatalog.ts client/src/data/navCatalog.test.ts
git commit -m "feat(desktop): restrict Company Browser to internal staff roles"
```

---

### Task 2: Encryption at rest for bookmarks/history

**Files:**
- Create: `src/utils/companyBrowserCrypto.ts`
- Create: `tests/companyBrowserCrypto.test.ts`
- Modify: `src/routes/stubs.ts:24-49`
- Test (extend): `tests/stubsPreferences.test.ts`

**Interfaces:**
- Consumes: `c.env` (Hono context env, must include `JWT_SECRET: string` and optionally `COMPANY_BROWSER_DATA_KEY?: string`).
- Produces: `encryptBrowserData(env, plaintext): Promise<string>`, `decryptBrowserData(env, stored): Promise<string | null>` — consumed by `src/routes/stubs.ts`'s `PUT`/`GET /preferences` handlers (this task wires both call sites itself; no other task depends on this one).

- [ ] **Step 1: Write the failing test for the crypto module**

```ts
// tests/companyBrowserCrypto.test.ts
import { describe, it, expect } from 'vitest';
import { encryptBrowserData, decryptBrowserData } from '../src/utils/companyBrowserCrypto';

const env = { JWT_SECRET: 'test-jwt-secret-value' };

describe('companyBrowserCrypto', () => {
  it('round-trips plaintext through encrypt then decrypt', async () => {
    const plaintext = JSON.stringify([{ id: 'b1', url: 'https://example.com', title: 'Example' }]);
    const ciphertext = await encryptBrowserData(env, plaintext);
    expect(ciphertext).not.toBe(plaintext);
    expect(ciphertext.startsWith('v1:')).toBe(true);
    const decrypted = await decryptBrowserData(env, ciphertext);
    expect(decrypted).toBe(plaintext);
  });

  it('produces different ciphertext for the same plaintext on repeated calls (random IV)', async () => {
    const plaintext = 'same input twice';
    const a = await encryptBrowserData(env, plaintext);
    const b = await encryptBrowserData(env, plaintext);
    expect(a).not.toBe(b);
  });

  it('passes through legacy (non-v1:-prefixed) plaintext unchanged', async () => {
    const legacy = JSON.stringify([{ id: 'old', url: 'https://legacy.example.com', title: 'Legacy' }]);
    const result = await decryptBrowserData(env, legacy);
    expect(result).toBe(legacy);
  });

  it('returns null for a corrupted/truncated ciphertext instead of throwing', async () => {
    const result = await decryptBrowserData(env, 'v1:not-valid-base64-ciphertext-at-all');
    expect(result).toBeNull();
  });

  it('derives a different key than emailCrypto.ts would for the same JWT_SECRET (domain separation)', async () => {
    // Two independently-encrypted values under the two different modules'
    // fallback-key derivations must NOT be decryptable by swapping which
    // module reads which ciphertext — proves the derived keys differ.
    const { encryptSecret } = await import('../src/utils/emailCrypto');
    const plaintext = 'shared-secret-material-test';
    const emailCiphertext = await encryptSecret(env, plaintext);
    const browserPlaintextAttempt = await decryptBrowserData(env, emailCiphertext);
    // If the keys were identical, this would successfully decrypt to `plaintext`.
    // With domain separation, AES-GCM's auth tag check fails -> null.
    expect(browserPlaintextAttempt).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/companyBrowserCrypto.test.ts`
Expected: FAIL — `Cannot find module '../src/utils/companyBrowserCrypto'`

- [ ] **Step 3: Implement the crypto module**

```ts
// src/utils/companyBrowserCrypto.ts
// AES-GCM helpers for at-rest encryption of Company Browser bookmarks/history
// (user_preferences.browser_bookmarks_json / browser_history_json).
//
// Structurally identical to src/utils/emailCrypto.ts, but with its own
// fallback key derivation so this feature never ends up sharing the exact
// derived key emailCrypto.ts's own JWT_SECRET-only fallback produces — see
// getKey() below for why the domain-separation string matters.
//
// Key source:
//   1. If env.COMPANY_BROWSER_DATA_KEY is set (base64 of >=32 random bytes), use it.
//   2. Otherwise derive a stable key from SHA-256(JWT_SECRET + '|company-browser-data-v1').
// This makes the feature work out-of-the-box (JWT_SECRET is always present)
// while letting ops rotate to a dedicated key without a code change.
// Rotating COMPANY_BROWSER_DATA_KEY invalidates previously-stored bookmarks/
// history — decryptBrowserData degrades to null (not a thrown error) in
// that case, matching this module's documented failure behavior.

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64encode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function getKey(env: { COMPANY_BROWSER_DATA_KEY?: string; JWT_SECRET: string }): Promise<CryptoKey> {
  let raw: Uint8Array;
  if (env.COMPANY_BROWSER_DATA_KEY) {
    raw = b64decode(env.COMPANY_BROWSER_DATA_KEY).slice(0, 32);
    if (raw.length < 32) {
      const hash = await crypto.subtle.digest('SHA-256', raw);
      raw = new Uint8Array(hash);
    }
  } else {
    // Domain-separated from emailCrypto.ts's own fallback (which hashes bare
    // JWT_SECRET) — appending this literal tag means the two features never
    // derive the same key from the same root secret.
    const hash = await crypto.subtle.digest('SHA-256', enc.encode(`${env.JWT_SECRET}|company-browser-data-v1`));
    raw = new Uint8Array(hash);
  }
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

// Stored form: "v1:" + base64(iv || ciphertext+tag)
export async function encryptBrowserData(env: { COMPANY_BROWSER_DATA_KEY?: string; JWT_SECRET: string }, plaintext: string): Promise<string> {
  const key = await getKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext)),
  );
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return `v1:${b64encode(out)}`;
}

export async function decryptBrowserData(env: { COMPANY_BROWSER_DATA_KEY?: string; JWT_SECRET: string }, stored: string): Promise<string | null> {
  if (!stored.startsWith('v1:')) {
    // Legacy plaintext from the pre-encryption version of this feature —
    // best effort: return as-is so existing bookmarks/history aren't wiped.
    return stored;
  }
  try {
    const key = await getKey(env);
    const raw = b64decode(stored.slice(3));
    const iv = raw.slice(0, 12);
    const ct = raw.slice(12);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return dec.decode(pt);
  } catch {
    // Corrupted ciphertext or a key that no longer matches (e.g. after a
    // COMPANY_BROWSER_DATA_KEY rotation) — degrade to "no data" rather than
    // 500ing the whole /preferences response.
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/companyBrowserCrypto.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Write the failing test for the stubs.ts wiring**

Read the existing `tests/stubsPreferences.test.ts` first (from the original Company Browser feature) to match its exact D1-mock-and-Hono-invocation convention before adding these cases — do not invent a different test harness. Add these two `it` blocks to its existing `describe`:

```ts
  it('encrypts browser_bookmarks_json/browser_history_json before storing, and returns decrypted plaintext on GET', async () => {
    const env = makeEnv();
    const bookmarks = JSON.stringify([{ id: 'b1', url: 'https://example.com', title: 'Example' }]);
    const history = JSON.stringify([{ url: 'https://example.com', title: 'Example', visitedAt: '2026-07-20T00:00:00Z' }]);

    const putReq = new Request('http://x/preferences', {
      method: 'PUT',
      body: JSON.stringify({ browser_bookmarks_json: bookmarks, browser_history_json: history }),
    });
    await stubs.fetch(putReq, env, { get: () => env.userId } as never);

    // The raw stored row must NOT equal the plaintext sent — proves this is
    // actually encrypting, not a no-op passthrough.
    const rawRow = await env.DB.prepare('SELECT * FROM user_preferences WHERE user_id = ?').bind(env.userId).first();
    expect(rawRow.browser_bookmarks_json).not.toBe(bookmarks);
    expect(rawRow.browser_bookmarks_json.startsWith('v1:')).toBe(true);
    expect(rawRow.browser_history_json).not.toBe(history);
    expect(rawRow.browser_history_json.startsWith('v1:')).toBe(true);

    const getReq = new Request('http://x/preferences');
    const getRes = await stubs.fetch(getReq, env, { get: () => env.userId } as never);
    const getBody = await getRes.json() as Record<string, unknown>;
    expect(getBody.browser_bookmarks_json).toBe(bookmarks);
    expect(getBody.browser_history_json).toBe(history);
  });

  it('GET returns a pre-existing legacy plaintext row unchanged (no ciphertext prefix)', async () => {
    const env = makeEnv({ userId: 555 });
    const legacyBookmarks = JSON.stringify([{ id: 'old', url: 'https://legacy.example.com', title: 'Legacy' }]);
    // Simulate a row saved by the pre-encryption version of this feature —
    // insert plaintext directly, bypassing the (now-encrypting) PUT handler.
    await env.DB.prepare('INSERT OR IGNORE INTO user_preferences (user_id) VALUES (?)').bind(555).run();
    await env.DB.prepare('UPDATE user_preferences SET browser_bookmarks_json = ? WHERE user_id = ?')
      .bind(legacyBookmarks, 555).run();

    const getReq = new Request('http://x/preferences');
    const getRes = await stubs.fetch(getReq, env, { get: () => 555 } as never);
    const getBody = await getRes.json() as Record<string, unknown>;
    expect(getBody.browser_bookmarks_json).toBe(legacyBookmarks);
  });
```

If the existing test file's `makeEnv()` mock doesn't support a raw `UPDATE ... SET browser_bookmarks_json = ?` call shaped differently from the PUT handler's own multi-column UPDATE (check its SQL-parsing logic before assuming it does), extend `makeEnv()`'s mock `prepare()` to handle this single-column UPDATE shape too — don't skip the legacy-row test over a mock limitation.

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run tests/stubsPreferences.test.ts`
Expected: FAIL — the stored row's `browser_bookmarks_json`/`browser_history_json` still equal the plaintext sent (encryption isn't wired into `stubs.ts` yet).

- [ ] **Step 7: Wire encryption into `stubs.ts`'s PUT/GET handlers**

In `src/routes/stubs.ts`, add the import:

```ts
import { encryptBrowserData, decryptBrowserData } from '../utils/companyBrowserCrypto';
```

Change the `GET /preferences` handler from:

```ts
stubs.get('/preferences', async (c) => {
  const userId = c.get('userId') as number | undefined;
  if (userId == null) return c.json(PREF_DEFAULTS);
  const row = await c.env.DB.prepare('SELECT * FROM user_preferences WHERE user_id = ?')
    .bind(userId).first();
  return c.json(row ? { ...PREF_DEFAULTS, ...row } : PREF_DEFAULTS);
});
```

to:

```ts
const ENCRYPTED_BROWSER_COLUMNS = ['browser_bookmarks_json', 'browser_history_json'] as const;

async function decryptBrowserColumns(env: { COMPANY_BROWSER_DATA_KEY?: string; JWT_SECRET: string }, row: Record<string, unknown>): Promise<Record<string, unknown>> {
  const out = { ...row };
  for (const col of ENCRYPTED_BROWSER_COLUMNS) {
    const value = out[col];
    if (typeof value === 'string') {
      out[col] = await decryptBrowserData(env, value);
    }
  }
  return out;
}

stubs.get('/preferences', async (c) => {
  const userId = c.get('userId') as number | undefined;
  if (userId == null) return c.json(PREF_DEFAULTS);
  const row = await c.env.DB.prepare('SELECT * FROM user_preferences WHERE user_id = ?')
    .bind(userId).first();
  if (!row) return c.json(PREF_DEFAULTS);
  const decryptedRow = await decryptBrowserColumns(c.env, row as Record<string, unknown>);
  return c.json({ ...PREF_DEFAULTS, ...decryptedRow });
});
```

Change the `PUT /preferences` handler from:

```ts
stubs.put('/preferences', async (c) => {
  const userId = c.get('userId') as number | undefined;
  if (userId == null) return c.json({ error: 'unauthorized' }, 401);
  let body: Record<string, unknown> = {};
  try { body = await c.req.json(); } catch { /* tolerate empty body */ }
  const keys = Object.keys(body).filter((k) => PREF_COLUMNS.has(k));
  if (keys.length === 0) return c.json({ success: true, updated: 0 });
  await c.env.DB.prepare('INSERT OR IGNORE INTO user_preferences (user_id) VALUES (?)')
    .bind(userId).run();
  const setClause = keys.map((k) => `${k} = ?`).join(', ');
  const values = keys.map((k) => body[k] as string | number | null);
  await c.env.DB.prepare(
    `UPDATE user_preferences SET ${setClause}, updated_at = datetime('now') WHERE user_id = ?`,
  ).bind(...values, userId).run();
  const row = await c.env.DB.prepare('SELECT * FROM user_preferences WHERE user_id = ?')
    .bind(userId).first();
  return c.json({ success: true, preferences: row ? { ...PREF_DEFAULTS, ...row } : PREF_DEFAULTS });
});
```

to:

```ts
stubs.put('/preferences', async (c) => {
  const userId = c.get('userId') as number | undefined;
  if (userId == null) return c.json({ error: 'unauthorized' }, 401);
  let body: Record<string, unknown> = {};
  try { body = await c.req.json(); } catch { /* tolerate empty body */ }
  const keys = Object.keys(body).filter((k) => PREF_COLUMNS.has(k));
  if (keys.length === 0) return c.json({ success: true, updated: 0 });
  await c.env.DB.prepare('INSERT OR IGNORE INTO user_preferences (user_id) VALUES (?)')
    .bind(userId).run();
  const values = await Promise.all(keys.map(async (k) => {
    const value = body[k] as string | number | null;
    if ((k === 'browser_bookmarks_json' || k === 'browser_history_json') && typeof value === 'string') {
      return encryptBrowserData(c.env, value);
    }
    return value;
  }));
  const setClause = keys.map((k) => `${k} = ?`).join(', ');
  await c.env.DB.prepare(
    `UPDATE user_preferences SET ${setClause}, updated_at = datetime('now') WHERE user_id = ?`,
  ).bind(...values, userId).run();
  const row = await c.env.DB.prepare('SELECT * FROM user_preferences WHERE user_id = ?')
    .bind(userId).first();
  const decryptedRow = row ? await decryptBrowserColumns(c.env, row as Record<string, unknown>) : null;
  return c.json({ success: true, preferences: decryptedRow ? { ...PREF_DEFAULTS, ...decryptedRow } : PREF_DEFAULTS });
});
```

No `src/types.ts` edit is needed for this: `Bindings` already declares `JWT_SECRET: string` (`src/types.ts:28`), and does NOT declare `EMAIL_CRED_KEY` at all — yet `emailCrypto.ts` already takes `env: { EMAIL_CRED_KEY?: string; JWT_SECRET: string }` and is called with `c.env` elsewhere in the codebase without any cast. TypeScript's structural typing allows this because `EMAIL_CRED_KEY`/`COMPANY_BROWSER_DATA_KEY` are optional properties — a source object doesn't need to declare an optional property at all to satisfy it. Passing `c.env` directly to `encryptBrowserData`/`decryptBrowserData` will typecheck as-is.

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run tests/stubsPreferences.test.ts`
Expected: PASS (all tests, including the two new ones)

- [ ] **Step 9: Run Worker typecheck**

Run: `npm run typecheck`
Expected: 0 new errors

- [ ] **Step 10: Commit**

```bash
git add src/utils/companyBrowserCrypto.ts tests/companyBrowserCrypto.test.ts src/routes/stubs.ts tests/stubsPreferences.test.ts
git commit -m "feat(prefs): encrypt Company Browser bookmarks/history at rest"
```

---

### Task 3: Ownership notice — footer line + first-launch modal

**Files:**
- Modify: `client/src/pages/CompanyBrowserPage.tsx`
- Test (extend): `client/src/pages/CompanyBrowserPage.test.tsx`

**Interfaces:**
- Consumes: `useAuth()` from `client/src/context/AuthContext.tsx` (already used elsewhere in this codebase as `const { user } = useAuth()`, exposing `user?.id`) — new import for this file, which doesn't currently import it.
- Produces: nothing other tasks depend on — independent of Tasks 1 and 2.

- [ ] **Step 1: Write the failing tests**

Add to `client/src/pages/CompanyBrowserPage.test.tsx`. First, add the `useAuth` mock near the existing `apiFetch` mock at the top of the file (this file currently has no `useAuth` mock, since it doesn't yet import it):

```ts
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: '1', role: 'officer' } }),
}));
```

Then add a `beforeEach` that clears `localStorage` (this file's existing `beforeEach` only calls `vi.clearAllMocks()` — extend it, don't add a second `beforeEach`):

```ts
  beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); });
```

Then add these test cases:

```ts
  it('renders the ownership footer line', () => {
    render(<CompanyBrowserPage />);
    expect(screen.getByText(/© 2026 Rocky Mountain Protective Group, LLC/i)).toBeInTheDocument();
    expect(screen.getByText(/Internal Use Only, Authorized Personnel Only/i)).toBeInTheDocument();
  });

  it('shows the first-launch proprietary notice modal when no ack is stored for this user', () => {
    render(<CompanyBrowserPage />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/proprietary/i)).toBeInTheDocument();
  });

  it('dismisses the modal on "I Understand" and does not show it again after remount', () => {
    const { unmount } = render(<CompanyBrowserPage />);
    fireEvent.click(screen.getByRole('button', { name: /i understand/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    unmount();

    render(<CompanyBrowserPage />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows the modal again for a different user id (per-user, not global)', () => {
    const { unmount } = render(<CompanyBrowserPage />);
    fireEvent.click(screen.getByRole('button', { name: /i understand/i }));
    unmount();

    vi.doMock('../context/AuthContext', () => ({
      useAuth: () => ({ user: { id: '2', role: 'officer' } }),
    }));
    vi.resetModules();
  });
```

The last test (`'shows the modal again for a different user id'`) needs `vi.resetModules()` plus a re-import of both the mocked module and the component to actually take effect — `vi.doMock` alone does not retroactively change an already-hoisted `vi.mock` for modules already imported at the top of the file. Rewrite it using dynamic `import()` after `vi.resetModules()`:

```ts
  it('shows the modal again for a different user id (per-user, not global)', async () => {
    const { unmount } = render(<CompanyBrowserPage />);
    fireEvent.click(screen.getByRole('button', { name: /i understand/i }));
    unmount();

    vi.resetModules();
    vi.doMock('../context/AuthContext', () => ({
      useAuth: () => ({ user: { id: '2', role: 'officer' } }),
    }));
    vi.doMock('../hooks/useApi', () => ({
      apiFetch: vi.fn().mockResolvedValue({ browser_bookmarks_json: null, browser_history_json: null }),
    }));
    const { default: CompanyBrowserPageReloaded } = await import('./CompanyBrowserPage');
    render(<CompanyBrowserPageReloaded />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/pages/CompanyBrowserPage.test.tsx`
Expected: FAIL — no footer text exists, no `role="dialog"` element exists yet, `useAuth` isn't imported by the component yet (this last point doesn't fail the test directly, but the modal/footer assertions above will all fail since none of that markup exists).

- [ ] **Step 3: Implement the footer and modal**

In `client/src/pages/CompanyBrowserPage.tsx`, add the import:

```ts
import { useAuth } from '../context/AuthContext';
```

Add this helper near the top of the file, alongside the other small pure helpers (`makeTabId`, `normalizeAddressInput`, etc.):

```ts
function ownershipAckKey(userId: string | number | undefined): string {
  return userId != null ? `rmpg_company_browser_ack_${userId}` : 'rmpg_company_browser_ack';
}

function hasAcknowledgedOwnership(userId: string | number | undefined): boolean {
  try {
    return localStorage.getItem(ownershipAckKey(userId)) === '1';
  } catch {
    return false;
  }
}

function acknowledgeOwnership(userId: string | number | undefined): void {
  try {
    localStorage.setItem(ownershipAckKey(userId), '1');
  } catch {
    // Private-browsing/quota failure — degrades to "show the modal every
    // launch" rather than crashing the page, matching this codebase's
    // existing localStorage-failure convention (see navFavorites.ts).
  }
}
```

Inside the `CompanyBrowserPage` component function, add the auth hook call and the ack-modal state (near the other `useState` calls at the top of the component):

```ts
  const { user } = useAuth();
  const [showOwnershipNotice, setShowOwnershipNotice] = useState(() => !hasAcknowledgedOwnership(user?.id));
```

Add the dismiss handler (near the other `useCallback`s):

```ts
  const dismissOwnershipNotice = useCallback(() => {
    acknowledgeOwnership(user?.id);
    setShowOwnershipNotice(false);
  }, [user?.id]);
```

Add the footer line at the very end of the component's returned JSX tree, as the last child of the outermost `<div>` (after the closing `</div>` of the `flex-1 relative` tab-content area, still inside the outermost flex column `<div>`):

```tsx
      <div
        className="px-2 py-1 text-[10px] text-center"
        style={{ background: 'var(--surface-overlay)', borderTop: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}
      >
        © 2026 Rocky Mountain Protective Group, LLC — Internal Use Only, Authorized Personnel Only
      </div>

      {showOwnershipNotice && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Company Browser ownership notice"
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10,
          }}
        >
          <div
            style={{
              background: 'var(--surface-raised)', border: '1px solid var(--border-strong)',
              padding: 20, maxWidth: 420, textAlign: 'center',
            }}
          >
            <p className="text-[12px]" style={{ color: 'var(--text-primary)' }}>
              Company Browser is proprietary software owned by Rocky Mountain Protective Group, LLC.
              It is provided for internal use only, restricted to authorized RMPG personnel.
              Unauthorized access, copying, or distribution is prohibited.
            </p>
            <button
              type="button"
              onClick={dismissOwnershipNotice}
              className="mt-3 px-3 py-1 text-[11px]"
              style={{ background: 'var(--rmpg-700)', color: 'var(--text-primary)', border: '1px solid var(--border-strong)' }}
            >
              I Understand
            </button>
          </div>
        </div>
      )}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/pages/CompanyBrowserPage.test.tsx`
Expected: PASS (all tests, including the pre-existing ones from the original feature — confirm none regressed)

- [ ] **Step 5: Run client typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: 0 new errors

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/CompanyBrowserPage.tsx client/src/pages/CompanyBrowserPage.test.tsx
git commit -m "feat(desktop): add RMPG ownership footer + first-launch proprietary notice to Company Browser"
```

---

### Task 4: Manual verification (Electron)

Encryption and role-restriction are both fully covered by automated tests; the ownership notice's rendering is covered too. The one thing that can't be verified outside a real Electron session is that the encrypted round-trip actually works against LIVE D1 (not just the mocked test harness), and that the notice/footer render correctly inside the real dedicated `BrowserWindow`.

**Files:** none (manual verification only)

- [ ] **Step 1: Start the desktop app**

Run: `cd desktop && npm start`

- [ ] **Step 2: Verify the ownership notice and footer**

Open Company Browser (as an `officer`/`admin`/etc. role — not `client_viewer`/`contract_manager`). Confirm the first-launch modal appears with the RMPG ownership text and an "I Understand" button; dismiss it; confirm the footer line reads "© 2026 Rocky Mountain Protective Group, LLC — Internal Use Only, Authorized Personnel Only"; close and reopen Company Browser (without restarting the whole app) and confirm the modal does NOT reappear.

- [ ] **Step 3: Verify role restriction**

Log in as a `client_viewer` or `contract_manager` user. Confirm "Company Browser" does not appear in Module Directory, cannot be pinned to the Desktop tab, and does not appear in taskbar launcher search results.

- [ ] **Step 4: Verify bookmarks/history persist correctly against live encryption**

As an unrestricted role, add a bookmark and visit a page (recording history). Quit the app fully (tray Quit, not close-to-tray) and relaunch. Confirm the bookmark and history entry are still present — this proves the full encrypt-on-write, decrypt-on-read round-trip works against the real D1 database, not just the test mock.

- [ ] **Step 5: Verify the raw D1 row is actually encrypted**

Run: `wrangler d1 execute rmpg-flex --remote --command "SELECT browser_bookmarks_json FROM user_preferences WHERE user_id = <your test user's id>"`
Expected: the returned value starts with `v1:` (base64 ciphertext), not readable JSON — confirms encryption is actually active in production, not just passing tests against a mock.
