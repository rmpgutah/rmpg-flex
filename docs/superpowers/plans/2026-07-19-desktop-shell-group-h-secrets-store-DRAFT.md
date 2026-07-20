# Desktop Shell — Group H (Local Data Protection) Implementation Plan — DRAFT

> **DRAFT, written while Bash tooling was in an outage.** Grounded via Read-only inspection of `desktop/pinManager.js` and `desktop/localDb.js` in this same session. Once Bash recovers: (1) move this file to the correct worktree/branch (a new branch stacked on `claude/desktop-hardening-group-f-session-hardening` once Group F's PR exists, same pattern as Group F was stacked on Group G), (2) run the plan's own self-review checklist (placeholder scan, type consistency) before treating it as final, (3) rename to drop the `-DRAFT` suffix.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `desktop/security/secretsStore.js` — local-data-protection hardening for the RMPG Flex desktop shell (encrypt cached secrets via Electron's OS-keychain-backed `safeStorage`, migrate the three plaintext offline-PIN secrets currently sitting in `local_config`, encrypt cached `password_hash`, secure-delete on cache clear, verify local DB integrity at startup, restrict the SQLite file's OS permissions, plus three forward-looking functions for groups that don't exist yet) — per Group H of the 10-group sequence in [`docs/superpowers/specs/2026-07-18-desktop-shell-functions-and-hardening-design.md`](../specs/2026-07-18-desktop-shell-functions-and-hardening-design.md).

**Architecture:** A single new module, `desktop/security/secretsStore.js`. Every function takes its Electron/Node dependency (`safeStorage`, `db`, `fs`) as a parameter rather than requiring it internally — this is the same dependency-injection pattern Group F's `createCertificateVerifyProc(pinnedHosts, logFn)` used, and it's what keeps every function unit-testable with `node:test` and a fake stand-in object, with zero real Electron/SQLite runtime needed for the test suite.

**Tech Stack:** Plain Node.js (CommonJS), Electron's `safeStorage` API, `better-sqlite3`'s `db.pragma(...)`, Node's `fs.chmodSync`, `node:test` + `node:assert/strict`.

## Global Constraints

- Match existing `desktop/security/*.js` conventions: CommonJS, no TypeScript, header comment block matching `ipcGuard.js`/`sessionHardening.js`.
- Every function must be unit-testable with zero real Electron/`better-sqlite3` runtime — dependencies (`safeStorage`, `db`, `fs`) are always parameters, never `require('electron')`/`require('better-sqlite3')` inside this file.
- **Grounding correction vs. the original spec table**: the spec's Group H row #22 names only `admin_offline_secret`/`all_user_secrets` as the plaintext secrets to migrate. Direct inspection of `desktop/pinManager.js:80,103-104` found a THIRD plaintext secret key used the same way: `my_offline_secret`. This plan's Task 2 migrates all three, not two — documenting the correction here rather than silently narrowing scope from what the spec implied.
- Three functions (#27 `encryptDiagnosticsBundleOnExport`, #29 `wipeSecretsOnLogout`, #30 `validateBackupFileBeforeImport`) reference capabilities that don't exist yet (Group A's `exportDiagnosticsBundle`, no logout IPC channel exists anywhere in `main.js` today, Group B's `importLocalDbBackup`) — these ship standalone and unwired, exactly like Group G's Tasks 7-9, with a note on each explaining what will eventually consume it.
- Commit after each task.

---

### Task 1: `encryptSecretForStorage` / `decryptSecretForStorage` — safeStorage wrapper

**Files:**
- Create: `desktop/security/secretsStore.js`
- Test: `desktop/security/__tests__/secretsStore.test.js`

**Interfaces:**
- Produces: `encryptSecretForStorage(plaintext, safeStorage)` — returns a base64 string (Electron's `safeStorage.encryptString()` returns a `Buffer`; base64-encoding it makes it storable in a SQLite `TEXT` column). Throws if `safeStorage.isEncryptionAvailable()` is false or `plaintext` isn't a string. `decryptSecretForStorage(ciphertextBase64, safeStorage)` — inverse, returns the original plaintext string.

- [ ] **Step 1: Write the failing test**

Create `desktop/security/__tests__/secretsStore.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { encryptSecretForStorage, decryptSecretForStorage } = require('../secretsStore');

function fakeSafeStorage({ available = true } = {}) {
  return {
    isEncryptionAvailable: () => available,
    // Fake "encryption": reverse the string and wrap in a marker, just
    // enough to prove encrypt/decrypt round-trip through this module's
    // own base64 handling without needing real OS keychain access.
    encryptString: (plaintext) => Buffer.from(`ENC:${plaintext.split('').reverse().join('')}`, 'utf8'),
    decryptString: (buf) => {
      const raw = buf.toString('utf8');
      if (!raw.startsWith('ENC:')) throw new Error('bad ciphertext');
      return raw.slice(4).split('').reverse().join('');
    },
  };
}

test('encryptSecretForStorage: round-trips through decryptSecretForStorage', () => {
  const safeStorage = fakeSafeStorage();
  const ciphertext = encryptSecretForStorage('my-secret-value', safeStorage);
  assert.equal(typeof ciphertext, 'string');
  assert.notEqual(ciphertext, 'my-secret-value');
  assert.equal(decryptSecretForStorage(ciphertext, safeStorage), 'my-secret-value');
});

test('encryptSecretForStorage: throws when encryption is unavailable', () => {
  const safeStorage = fakeSafeStorage({ available: false });
  assert.throws(() => encryptSecretForStorage('x', safeStorage), /encryption is not available/);
});

test('encryptSecretForStorage: throws for a non-string plaintext', () => {
  const safeStorage = fakeSafeStorage();
  assert.throws(() => encryptSecretForStorage(123, safeStorage), /must be a string/);
});

test('decryptSecretForStorage: throws for a non-string ciphertext', () => {
  const safeStorage = fakeSafeStorage();
  assert.throws(() => decryptSecretForStorage(null, safeStorage), /must be a string/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd desktop && node --test 'security/__tests__/secretsStore.test.js'`
Expected: FAIL — `Cannot find module '../secretsStore'`

- [ ] **Step 3: Write the minimal implementation**

Create `desktop/security/secretsStore.js`:

```js
// ============================================================
// RMPG Flex — Secrets Store
// Local-data-protection hardening: OS-keychain-backed secret
// encryption (Electron safeStorage), plaintext-secret migration,
// cached password_hash encryption, secure cache deletion, local
// DB integrity verification, SQLite file permission restriction.
// Every function takes its Electron/Node dependency as a
// parameter rather than requiring it internally, so this file
// has zero real-runtime dependency and is fully unit-testable.
// ============================================================

'use strict';

/**
 * Encrypts plaintext via Electron's safeStorage (OS keychain-backed on
 * macOS Keychain / Windows DPAPI / Linux Secret Service) and returns a
 * base64 string suitable for storage in a SQLite TEXT column.
 */
function encryptSecretForStorage(plaintext, safeStorage) {
  if (typeof plaintext !== 'string') {
    throw new TypeError('plaintext must be a string');
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS-level encryption is not available on this machine');
  }
  return safeStorage.encryptString(plaintext).toString('base64');
}

/** Inverse of encryptSecretForStorage. */
function decryptSecretForStorage(ciphertextBase64, safeStorage) {
  if (typeof ciphertextBase64 !== 'string') {
    throw new TypeError('ciphertextBase64 must be a string');
  }
  return safeStorage.decryptString(Buffer.from(ciphertextBase64, 'base64'));
}

module.exports = {
  encryptSecretForStorage,
  decryptSecretForStorage,
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd desktop && node --test 'security/__tests__/secretsStore.test.js'`
Expected: PASS — 4 tests passing

- [ ] **Step 5: Add `secretsStore.js` to the test glob (should already be covered)**

Run: `grep -n '"test"' desktop/package.json`
Expected: the existing glob `node --test 'security/__tests__/**/*.js'` already covers this new test file — no change needed. Confirm by running the FULL glob:

Run: `cd desktop && node --test 'security/__tests__/**/*.js'`
Expected: PASS — includes the 4 new tests plus every prior `ipcGuard`/`sessionHardening` test.

- [ ] **Step 6: Commit**

```bash
git add desktop/security/secretsStore.js desktop/security/__tests__/secretsStore.test.js
git commit -m "desktop: add encryptSecretForStorage/decryptSecretForStorage (safeStorage wrapper)"
```

---

### Task 2: `migrateOfflineSecretsToSafeStorage` — one-time plaintext-secret migration

**Files:**
- Modify: `desktop/security/secretsStore.js`
- Modify: `desktop/pinManager.js` (call the migration once at `init()`)
- Test: `desktop/security/__tests__/secretsStore.test.js`

**Interfaces:**
- Produces: `migrateOfflineSecretsToSafeStorage(deps)` where `deps = { getConfig, setConfig, safeStorage, isMigrated }`. `isMigrated` is a pre-read boolean (the caller checks a sentinel config key, e.g. `getConfig('secrets_migrated_v1') === '1'`, before calling this — keeps the function itself a pure decision-plus-side-effect without embedding its own idempotency-check I/O). Returns `{ migrated: string[], skipped: string[] }` — `migrated` lists which of the three keys (`admin_offline_secret`, `all_user_secrets`, `my_offline_secret`) were plaintext and got re-written as `safeStorage`-encrypted; `skipped` lists keys that were already absent (nothing to migrate) or already looked like this module's own ciphertext (idempotent re-run safety, checked via a fixed prefix marker — see implementation).

- [ ] **Step 1: Write the failing test**

Append to `desktop/security/__tests__/secretsStore.test.js`:

```js
const { migrateOfflineSecretsToSafeStorage } = require('../secretsStore');

function fakeConfigStore(initial) {
  const store = { ...initial };
  return {
    getConfig: (key) => (key in store ? store[key] : null),
    setConfig: (key, value) => { store[key] = value; },
    _dump: () => ({ ...store }),
  };
}

test('migrateOfflineSecretsToSafeStorage: migrates all three plaintext secrets present', () => {
  const { getConfig, setConfig, _dump } = fakeConfigStore({
    admin_offline_secret: 'admin-plain',
    all_user_secrets: '[{"user_id":1,"secret":"user-plain"}]',
    my_offline_secret: 'my-plain',
  });
  const safeStorage = fakeSafeStorage();
  const result = migrateOfflineSecretsToSafeStorage({ getConfig, setConfig, safeStorage });
  assert.deepEqual(result.migrated.sort(), ['admin_offline_secret', 'all_user_secrets', 'my_offline_secret']);
  assert.deepEqual(result.skipped, []);
  // Each value in the store is now the encrypted form, decryptable back to the original
  const dumped = _dump();
  assert.equal(decryptSecretForStorage(dumped.admin_offline_secret, safeStorage), 'admin-plain');
});

test('migrateOfflineSecretsToSafeStorage: skips a key that is absent', () => {
  const { getConfig, setConfig } = fakeConfigStore({ admin_offline_secret: 'admin-plain' });
  const safeStorage = fakeSafeStorage();
  const result = migrateOfflineSecretsToSafeStorage({ getConfig, setConfig, safeStorage });
  assert.deepEqual(result.migrated, ['admin_offline_secret']);
  assert.deepEqual(result.skipped, ['all_user_secrets', 'my_offline_secret']);
});

test('migrateOfflineSecretsToSafeStorage: is idempotent — a second run skips already-migrated keys', () => {
  const { getConfig, setConfig } = fakeConfigStore({ admin_offline_secret: 'admin-plain' });
  const safeStorage = fakeSafeStorage();
  migrateOfflineSecretsToSafeStorage({ getConfig, setConfig, safeStorage });
  const second = migrateOfflineSecretsToSafeStorage({ getConfig, setConfig, safeStorage });
  assert.deepEqual(second.migrated, []);
  assert.deepEqual(second.skipped, ['admin_offline_secret', 'all_user_secrets', 'my_offline_secret']);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd desktop && node --test 'security/__tests__/secretsStore.test.js'`
Expected: FAIL — `migrateOfflineSecretsToSafeStorage is not a function`

- [ ] **Step 3: Write the minimal implementation**

Add to `desktop/security/secretsStore.js`, above `module.exports`:

```js
const OFFLINE_SECRET_KEYS = ['admin_offline_secret', 'all_user_secrets', 'my_offline_secret'];
// Every value this module encrypts is base64 — plaintext legacy values
// are plain JSON/strings and will not parse as valid base64-of-our-format.
// We detect "already migrated" by attempting a decrypt: if it succeeds,
// it was already ciphertext; if safeStorage throws, treat it as plaintext
// still needing migration. This makes the migration self-idempotent
// without a separate sentinel key that could itself drift out of sync.
function looksAlreadyMigrated(value, safeStorage) {
  try {
    decryptSecretForStorage(value, safeStorage);
    return true;
  } catch {
    return false;
  }
}

/**
 * One-time migration moving the three plaintext offline-PIN secrets
 * (desktop/pinManager.js:80,103-104) out of local_config's plaintext
 * storage into safeStorage-encrypted form, in place (same keys).
 * Safe to call on every startup — already-migrated keys are skipped.
 */
function migrateOfflineSecretsToSafeStorage({ getConfig, setConfig, safeStorage }) {
  const migrated = [];
  const skipped = [];
  for (const key of OFFLINE_SECRET_KEYS) {
    const value = getConfig(key);
    if (!value) {
      skipped.push(key);
      continue;
    }
    if (looksAlreadyMigrated(value, safeStorage)) {
      skipped.push(key);
      continue;
    }
    setConfig(key, encryptSecretForStorage(value, safeStorage));
    migrated.push(key);
  }
  return { migrated, skipped };
}
```

Update `module.exports` to add `migrateOfflineSecretsToSafeStorage`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd desktop && node --test 'security/__tests__/secretsStore.test.js'`
Expected: PASS — 7 tests passing

- [ ] **Step 5: Wire into `desktop/pinManager.js`**

At the top of `desktop/pinManager.js`, add:

```js
const { safeStorage } = require('electron');
const { migrateOfflineSecretsToSafeStorage, decryptSecretForStorage } = require('./security/secretsStore');
```

In the existing `init(window)` function, after `mainWindow = window;` and before the `expiryTimer` setup, add:

```js
  const migrationResult = migrateOfflineSecretsToSafeStorage({ getConfig, setConfig, safeStorage });
  if (migrationResult.migrated.length > 0) {
    console.log('[PIN-MANAGER] Migrated offline secrets to safeStorage:', migrationResult.migrated);
  }
```

This task does NOT update `generatePinForUser`/`validatePin` to decrypt before use — that is Task 3's job (it touches the same read sites as the `password_hash` encryption work and is easier to review as one coherent pass over "every place a secret is read back out").

- [ ] **Step 6: Sanity-check**

Run: `node --check desktop/pinManager.js`
Expected: exit code 0

- [ ] **Step 7: Commit**

```bash
git add desktop/security/secretsStore.js desktop/security/__tests__/secretsStore.test.js desktop/pinManager.js
git commit -m "desktop: migrate plaintext offline-PIN secrets to safeStorage encryption"
```

---

### Task 3: Decrypt secrets at read time in `pinManager.js`

**Files:**
- Modify: `desktop/pinManager.js` (both `generatePinForUser` and `validatePin`, and `checkLockout`'s caller path is untouched — only the three `getConfig('*_secret')` read sites change)

**Interfaces:**
- Consumes: `decryptSecretForStorage` from Task 1/2's imports (already added to `pinManager.js` in Task 2 Step 5).

- [ ] **Step 1: Read the current three call sites**

Confirm the exact current text of these three lines in `desktop/pinManager.js` (they may have shifted slightly from the line numbers seen during planning — Task 2 added two new lines near the top of the file):
- `generatePinForUser`: `const adminSecret = getConfig('admin_offline_secret');` and `const allSecrets = getConfig('all_user_secrets');`
- `validatePin`: `const userSecret = getConfig('my_offline_secret');` and `const adminSecret = getConfig('admin_offline_secret');`

- [ ] **Step 2: Wrap each read with a decrypt, tolerating the pre-migration plaintext case**

Since Task 2's migration runs at `init()` time (before any PIN operation can happen in practice — `mainWindow` isn't available for IPC calls until after `init()`), reads after migration should always see ciphertext. Still, decrypt defensively rather than assuming: write a tiny local helper in `pinManager.js` (not `secretsStore.js` — this is pinManager-specific glue, not a reusable primitive) right after the imports added in Task 2:

```js
function readSecretConfig(key) {
  const raw = getConfig(key);
  if (!raw) return null;
  try {
    return decryptSecretForStorage(raw, safeStorage);
  } catch {
    // Not yet migrated (shouldn't happen post-init(), but fail safe by
    // treating the raw value as already-plaintext rather than crashing
    // the PIN flow) — decrypt failure means "wasn't our ciphertext".
    return raw;
  }
}
```

Then replace each of the four `getConfig('*_secret'...)`/`getConfig('all_user_secrets')` call sites with `readSecretConfig(...)`:

In `generatePinForUser`:
```js
  const adminSecret = readSecretConfig('admin_offline_secret');
  if (!adminSecret) {
    return { error: 'Admin offline secret not configured. Sync with server first.' };
  }

  // Get the target user's secret
  let userSecret;
  const allSecrets = readSecretConfig('all_user_secrets');
```

In `validatePin`:
```js
  // Get secrets for validation
  const userSecret = readSecretConfig('my_offline_secret');
  const adminSecret = readSecretConfig('admin_offline_secret');
```

(Every other line in both functions — the lockout check, `JSON.parse(allSecrets)`, `computePin(...)` — is unchanged; `allSecrets` is still the same JSON string shape after decryption, just no longer plaintext-in-storage.)

- [ ] **Step 3: Sanity-check**

Run: `node --check desktop/pinManager.js`
Expected: exit code 0

- [ ] **Step 4: Manual trace verification (no live DB available)**

Since there is no Node test file for `pinManager.js` itself (it's Electron/SQLite-coupled, consistent with this repo having no Electron test harness), verify by hand-tracing: after Task 2's migration runs once, every `local_config` row for the three secret keys holds `encryptSecretForStorage(...)` output; `readSecretConfig` calls `decryptSecretForStorage` on read, recovering the original plaintext secret value that `computePin`/`JSON.parse` expect. Confirm no other file reads these three config keys directly (would bypass decryption) — search for `getConfig('admin_offline_secret'`, `getConfig('all_user_secrets'`, `getConfig('my_offline_secret'` outside `pinManager.js`; expected: no matches (these three keys are pinManager-private).

- [ ] **Step 5: Commit**

```bash
git add desktop/pinManager.js
git commit -m "desktop: decrypt offline-PIN secrets at read time via readSecretConfig"
```

---

### Task 4: `encryptCachedPasswordHashes` — encrypt the cached `password_hash` column

**Files:**
- Modify: `desktop/security/secretsStore.js`
- Modify: `desktop/localDb.js` (encrypt on write in the mirror-sync path, decrypt in `offline:get-cached-user`'s consumer)
- Modify: `desktop/main.js` (`offline:get-cached-user` handler — decrypt before returning)
- Test: `desktop/security/__tests__/secretsStore.test.js`

**Interfaces:**
- Produces: `encryptPasswordHashForCache(passwordHash, safeStorage)` / `decryptPasswordHashFromCache(ciphertext, safeStorage)` — thin, semantically-named wrappers around Task 1's `encryptSecretForStorage`/`decryptSecretForStorage` (same implementation, distinct exported names so call sites read clearly and so a future change to password-hash-specific handling — e.g. an added integrity tag — doesn't require touching call sites that use the generic secret functions for unrelated data).

- [ ] **Step 1: Write the failing test**

Append to `desktop/security/__tests__/secretsStore.test.js`:

```js
const { encryptPasswordHashForCache, decryptPasswordHashFromCache } = require('../secretsStore');

test('encryptPasswordHashForCache: round-trips through decryptPasswordHashFromCache', () => {
  const safeStorage = fakeSafeStorage();
  const ciphertext = encryptPasswordHashForCache('$2b$10$examplehash', safeStorage);
  assert.notEqual(ciphertext, '$2b$10$examplehash');
  assert.equal(decryptPasswordHashFromCache(ciphertext, safeStorage), '$2b$10$examplehash');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd desktop && node --test 'security/__tests__/secretsStore.test.js'`
Expected: FAIL — `encryptPasswordHashForCache is not a function`

- [ ] **Step 3: Write the minimal implementation**

Add to `desktop/security/secretsStore.js`, above `module.exports`:

```js
/**
 * Semantically-named wrappers around encryptSecretForStorage/
 * decryptSecretForStorage for the cached users.password_hash column
 * specifically — same mechanism today, kept as distinct exports so a
 * future password-hash-specific change (e.g. an added integrity tag)
 * doesn't ripple into unrelated secret call sites.
 */
function encryptPasswordHashForCache(passwordHash, safeStorage) {
  return encryptSecretForStorage(passwordHash, safeStorage);
}

function decryptPasswordHashFromCache(ciphertext, safeStorage) {
  return decryptSecretForStorage(ciphertext, safeStorage);
}
```

Update `module.exports` to add both.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd desktop && node --test 'security/__tests__/secretsStore.test.js'`
Expected: PASS — 9 tests passing

- [ ] **Step 5: Wire into `desktop/localDb.js`'s write path**

The `password_hash` column is populated via `upsertRow('users', row)` during `syncManager.js`'s mirror sync (not shown in this file — `upsertRow` is generic across all mirror tables). Rather than special-casing `upsertRow` for one table/column (which would break its generic contract), add a dedicated wrapper specifically for the users table:

At the top of `desktop/localDb.js`, add:
```js
const { app, safeStorage } = require('electron');
const { encryptPasswordHashForCache, decryptPasswordHashFromCache } = require('./security/secretsStore');
```
(`app` is already imported — extend the existing `const { app } = require('electron');` line to also destructure `safeStorage` rather than adding a second require line.)

Add a new exported function, placed after `upsertRow`/`replaceTable`/`deltaSync`:

```js
/**
 * Upserts a single users row with password_hash encrypted via safeStorage
 * before it touches disk. Callers (syncManager.js's user mirror sync)
 * should use this instead of the generic upsertRow('users', row) for
 * rows that include a password_hash field.
 */
function upsertUserWithEncryptedHash(row) {
  const encryptedRow = row.password_hash
    ? { ...row, password_hash: encryptPasswordHashForCache(row.password_hash, safeStorage) }
    : row;
  upsertRow('users', encryptedRow);
}
```

Update `module.exports` to add `upsertUserWithEncryptedHash`.

**Note on `syncManager.js`**: this task does NOT modify `syncManager.js` to call the new function instead of `upsertRow('users', ...)` directly — locating and confirming that exact call site is Group C's scope (Group C, "Sync & Offline Management", is a later group in this sequence and owns `syncManager.js` changes). This task ships the encrypted-write primitive; wiring it into the actual sync call site is flagged here as a TODO for Group C's plan to pick up, not silently dropped.

- [ ] **Step 6: Wire the decrypt side into `main.js`'s `offline:get-cached-user` handler**

Extend the `desktop/main.js` import line for `secretsStore` (add one if this is the first Group H function wired into `main.js`):
```js
const { decryptPasswordHashFromCache } = require('./security/secretsStore');
```
(`safeStorage` needs to be available in `main.js` too — check the existing `const { app, BrowserWindow, Menu, Tray, shell, dialog, nativeImage, ipcMain, net, powerSaveBlocker } = require('electron');` line at the top and extend it to also destructure `safeStorage`.)

Update the `guardedHandle('offline:get-cached-user', ...)` handler:

```js
guardedHandle('offline:get-cached-user', (_event, { username }) => {
  try {
    const db = getLocalDb();
    const user = db.prepare(
      `SELECT id, username, password_hash, first_name, last_name, full_name,
              email, role, badge_number, phone, status, avatar_url, created_at
       FROM users WHERE username = ? AND status = 'active'`
    ).get(username);
    if (!user) return null;
    return { ...user, password_hash: decryptPasswordHashFromCache(user.password_hash, safeStorage) };
  } catch (err) {
    console.error('[OFFLINE:CACHED-USER] Error:', err.message);
    return null;
  }
});
```

- [ ] **Step 7: Sanity-check**

Run: `node --check desktop/localDb.js && node --check desktop/main.js`
Expected: exit code 0 for both

- [ ] **Step 8: Commit**

```bash
git add desktop/security/secretsStore.js desktop/security/__tests__/secretsStore.test.js desktop/localDb.js desktop/main.js
git commit -m "desktop: encrypt cached password_hash via safeStorage (write+read paths)"
```

---

### Task 5: `secureDeleteLocalCache` — SQLite `secure_delete` pragma wrapper

**Files:**
- Modify: `desktop/security/secretsStore.js`
- Modify: `desktop/localDb.js` (enable the pragma at `initLocalDb()` time)
- Test: `desktop/security/__tests__/secretsStore.test.js`

**Interfaces:**
- Produces: `enableSecureDelete(db)` — calls `db.pragma('secure_delete = ON')`. This is SQLite's own built-in feature (overwrites deleted content with zeros before the page is freed) rather than a hand-rolled overwrite-then-delete — simpler, more correct, and doesn't require touching every existing `DELETE FROM` call site individually. `secureDeleteLocalCache(db, table, allowedTables)` — validates `table` against an allowlist (mirrors the discipline of Group G's `validateSyncQueueIdInput`-style allowlisting) then runs `DELETE FROM ${table}`, relying on `enableSecureDelete` having already been called once at DB init.

- [ ] **Step 1: Write the failing test**

Append to `desktop/security/__tests__/secretsStore.test.js`:

```js
const { enableSecureDelete, secureDeleteLocalCache } = require('../secretsStore');

function fakeDb() {
  const calls = [];
  return {
    pragma: (stmt) => { calls.push({ type: 'pragma', stmt }); },
    prepare: (sql) => ({ run: () => { calls.push({ type: 'run', sql }); } }),
    _calls: calls,
  };
}

test('enableSecureDelete: issues the secure_delete pragma', () => {
  const db = fakeDb();
  enableSecureDelete(db);
  assert.deepEqual(db._calls, [{ type: 'pragma', stmt: 'secure_delete = ON' }]);
});

test('secureDeleteLocalCache: deletes an allowlisted table', () => {
  const db = fakeDb();
  const result = secureDeleteLocalCache(db, 'gps_breadcrumbs', ['gps_breadcrumbs', 'pin_attempts']);
  assert.equal(result.ok, true);
  assert.equal(db._calls[0].sql, 'DELETE FROM gps_breadcrumbs');
});

test('secureDeleteLocalCache: rejects a table not on the allowlist', () => {
  const db = fakeDb();
  const result = secureDeleteLocalCache(db, 'users', ['gps_breadcrumbs', 'pin_attempts']);
  assert.equal(result.ok, false);
  assert.equal(db._calls.length, 0, 'must not run any SQL for a disallowed table');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd desktop && node --test 'security/__tests__/secretsStore.test.js'`
Expected: FAIL — `enableSecureDelete is not a function`

- [ ] **Step 3: Write the minimal implementation**

Add to `desktop/security/secretsStore.js`, above `module.exports`:

```js
/** SQLite's own secure-delete: overwrites freed page content with zeros. */
function enableSecureDelete(db) {
  db.pragma('secure_delete = ON');
}

/**
 * Deletes all rows from an allowlisted table. The allowlist is passed in
 * by the caller (rather than hardcoded here) so this stays a generic,
 * reusable primitive — Group C's future clearLocalCache(table) handler
 * is expected to be the real caller, passing the actual mirror-table
 * list from localDb.js's schema.
 */
function secureDeleteLocalCache(db, table, allowedTables) {
  if (!allowedTables.includes(table)) {
    return { ok: false, error: `table "${table}" is not in the allowed list` };
  }
  db.prepare(`DELETE FROM ${table}`).run();
  return { ok: true };
}
```

Update `module.exports` to add `enableSecureDelete` and `secureDeleteLocalCache`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd desktop && node --test 'security/__tests__/secretsStore.test.js'`
Expected: PASS — 12 tests passing

- [ ] **Step 5: Wire `enableSecureDelete` into `desktop/localDb.js`'s `initLocalDb()`**

Extend the top-of-file import to add `const { enableSecureDelete } = require('./security/secretsStore');`. In `initLocalDb()`, immediately after the existing pragma block:
```js
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
```
add:
```js
  enableSecureDelete(db);
```

(`secureDeleteLocalCache` itself is NOT wired to any handler in this task — no `clearLocalCache`/`forceFullResync` IPC handler exists yet; that's Group C's scope, per this plan's Global Constraints. `enableSecureDelete` being on globally means even Group C's eventual plain `DELETE FROM` calls get the secure-delete benefit automatically, without needing to remember to call `secureDeleteLocalCache` specifically — this is why enabling the pragma once at init is the higher-leverage half of this task.)

- [ ] **Step 6: Sanity-check**

Run: `node --check desktop/localDb.js`
Expected: exit code 0

- [ ] **Step 7: Commit**

```bash
git add desktop/security/secretsStore.js desktop/security/__tests__/secretsStore.test.js desktop/localDb.js
git commit -m "desktop: enable SQLite secure_delete pragma; add secureDeleteLocalCache primitive"
```

---

### Task 6: `verifyLocalDbIntegrity` — startup `PRAGMA integrity_check`

**Files:**
- Modify: `desktop/security/secretsStore.js`
- Modify: `desktop/localDb.js`
- Test: `desktop/security/__tests__/secretsStore.test.js`

**Interfaces:**
- Produces: `verifyLocalDbIntegrity(db)` — runs `db.pragma('integrity_check')`, which `better-sqlite3` returns as an array of `{integrity_check: string}` rows; a healthy database returns exactly `[{integrity_check: 'ok'}]`. Returns `{ok: true}` or `{ok: false, errors: string[]}`.

- [ ] **Step 1: Write the failing test**

Append to `desktop/security/__tests__/secretsStore.test.js`:

```js
const { verifyLocalDbIntegrity } = require('../secretsStore');

test('verifyLocalDbIntegrity: ok when the pragma returns the single "ok" row', () => {
  const db = { pragma: () => [{ integrity_check: 'ok' }] };
  assert.deepEqual(verifyLocalDbIntegrity(db), { ok: true });
});

test('verifyLocalDbIntegrity: reports errors when the pragma returns problem rows', () => {
  const db = { pragma: () => [{ integrity_check: 'row 4 missing from index idx_foo' }, { integrity_check: '*** in database main ***' }] };
  const result = verifyLocalDbIntegrity(db);
  assert.equal(result.ok, false);
  assert.equal(result.errors.length, 2);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd desktop && node --test 'security/__tests__/secretsStore.test.js'`
Expected: FAIL — `verifyLocalDbIntegrity is not a function`

- [ ] **Step 3: Write the minimal implementation**

Add to `desktop/security/secretsStore.js`, above `module.exports`:

```js
/**
 * Runs SQLite's built-in integrity_check. A healthy database returns
 * exactly one row, { integrity_check: 'ok' } — anything else (including
 * multiple rows) indicates corruption/tampering.
 */
function verifyLocalDbIntegrity(db) {
  const rows = db.pragma('integrity_check');
  if (rows.length === 1 && rows[0].integrity_check === 'ok') {
    return { ok: true };
  }
  return { ok: false, errors: rows.map((r) => r.integrity_check) };
}
```

Update `module.exports` to add `verifyLocalDbIntegrity`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd desktop && node --test 'security/__tests__/secretsStore.test.js'`
Expected: PASS — 14 tests passing

- [ ] **Step 5: Wire into `desktop/localDb.js`'s `initLocalDb()`**

Extend the import line to also destructure `verifyLocalDbIntegrity`. In `initLocalDb()`, after `enableSecureDelete(db);` (Task 5) and before `createMirrorTables();`, add:

```js
  const integrityResult = verifyLocalDbIntegrity(db);
  if (!integrityResult.ok) {
    console.error('[LOCAL-DB] Integrity check failed — local cache may be corrupted:', integrityResult.errors);
  }
```

(Non-fatal by design, matching this shell's established pattern (see the cache-clear race in `main.js`'s `createMainWindow()`) — a corrupted local cache degrades offline functionality but must not crash the whole app on startup. A human/future group can decide whether to escalate this to a blocking prompt.)

- [ ] **Step 6: Sanity-check**

Run: `node --check desktop/localDb.js`
Expected: exit code 0

- [ ] **Step 7: Commit**

```bash
git add desktop/security/secretsStore.js desktop/security/__tests__/secretsStore.test.js desktop/localDb.js
git commit -m "desktop: verify local DB integrity at startup via verifyLocalDbIntegrity"
```

---

### Task 7: `restrictLocalDbFilePermissions` — chmod 0600 on the SQLite files

**Files:**
- Modify: `desktop/security/secretsStore.js`
- Modify: `desktop/localDb.js`
- Test: `desktop/security/__tests__/secretsStore.test.js`

**Interfaces:**
- Produces: `restrictLocalDbFilePermissions(dbPath, fsModule)` — chmods `dbPath` to `0o600` (owner read/write only), plus its WAL-mode sidecar files `${dbPath}-wal` and `${dbPath}-shm` if they exist (both can contain the same sensitive row data as the main file while a transaction is in flight). Returns `{ok: true, chmoded: string[]}` or `{ok: false, error}` if the main file's chmod fails (sidecar chmod failures are logged but non-fatal — they may legitimately not exist yet on a fresh DB).

- [ ] **Step 1: Write the failing test**

Append to `desktop/security/__tests__/secretsStore.test.js`:

```js
const { restrictLocalDbFilePermissions } = require('../secretsStore');

function fakeFs({ existing = [] } = {}) {
  const chmoded = [];
  return {
    existsSync: (p) => existing.includes(p),
    chmodSync: (p, mode) => { chmoded.push({ path: p, mode }); },
    _chmoded: chmoded,
  };
}

test('restrictLocalDbFilePermissions: chmods the main db file to 0600', () => {
  const fs = fakeFs({ existing: ['/data/rmpg-local.db'] });
  const result = restrictLocalDbFilePermissions('/data/rmpg-local.db', fs);
  assert.equal(result.ok, true);
  assert.deepEqual(fs._chmoded[0], { path: '/data/rmpg-local.db', mode: 0o600 });
});

test('restrictLocalDbFilePermissions: also chmods -wal/-shm sidecars when present', () => {
  const fs = fakeFs({ existing: ['/data/rmpg-local.db', '/data/rmpg-local.db-wal', '/data/rmpg-local.db-shm'] });
  const result = restrictLocalDbFilePermissions('/data/rmpg-local.db', fs);
  assert.equal(result.chmoded.length, 3);
  assert.ok(result.chmoded.includes('/data/rmpg-local.db-wal'));
  assert.ok(result.chmoded.includes('/data/rmpg-local.db-shm'));
});

test('restrictLocalDbFilePermissions: skips sidecars that do not exist yet', () => {
  const fs = fakeFs({ existing: ['/data/rmpg-local.db'] });
  const result = restrictLocalDbFilePermissions('/data/rmpg-local.db', fs);
  assert.deepEqual(result.chmoded, ['/data/rmpg-local.db']);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd desktop && node --test 'security/__tests__/secretsStore.test.js'`
Expected: FAIL — `restrictLocalDbFilePermissions is not a function`

- [ ] **Step 3: Write the minimal implementation**

Add to `desktop/security/secretsStore.js`, above `module.exports`:

```js
/**
 * Restricts the local SQLite database file — and its WAL-mode sidecar
 * files, which can hold the same sensitive row data mid-transaction —
 * to owner-only read/write (0600). Best-effort: a missing sidecar (not
 * yet created, WAL mode not yet active) is not an error.
 */
function restrictLocalDbFilePermissions(dbPath, fsModule) {
  const chmoded = [];
  try {
    fsModule.chmodSync(dbPath, 0o600);
    chmoded.push(dbPath);
  } catch (err) {
    return { ok: false, error: err.message };
  }
  for (const sidecar of [`${dbPath}-wal`, `${dbPath}-shm`]) {
    if (fsModule.existsSync(sidecar)) {
      fsModule.chmodSync(sidecar, 0o600);
      chmoded.push(sidecar);
    }
  }
  return { ok: true, chmoded };
}
```

Update `module.exports` to add `restrictLocalDbFilePermissions`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd desktop && node --test 'security/__tests__/secretsStore.test.js'`
Expected: PASS — 17 tests passing

- [ ] **Step 5: Wire into `desktop/localDb.js`'s `initLocalDb()`**

Extend the import line to also destructure `restrictLocalDbFilePermissions`. In `initLocalDb()`, after `db = new Database(dbPath);` and before the pragma block, add:

```js
  const permsResult = restrictLocalDbFilePermissions(dbPath, fs);
  if (!permsResult.ok) {
    console.error('[LOCAL-DB] Failed to restrict file permissions:', permsResult.error);
  }
```

(`fs` is already imported at the top of `localDb.js` — reuse it, no new import needed. This must run AFTER `new Database(dbPath)` creates the file, not before — chmod on a nonexistent path throws.)

- [ ] **Step 6: Sanity-check**

Run: `node --check desktop/localDb.js`
Expected: exit code 0

- [ ] **Step 7: Commit**

```bash
git add desktop/security/secretsStore.js desktop/security/__tests__/secretsStore.test.js desktop/localDb.js
git commit -m "desktop: restrict local SQLite file (+ WAL sidecars) to 0600 via restrictLocalDbFilePermissions"
```

---

### Task 8: `redactSensitiveFieldsInLogs` — text redaction (standalone, immediately usable)

**Files:**
- Modify: `desktop/security/secretsStore.js`
- Test: `desktop/security/__tests__/secretsStore.test.js`

**Interfaces:**
- Produces: `redactSensitiveFieldsInLogs(text)` — pure string transform, returns `text` with JWT-shaped tokens (`eyJ...` base64url segments joined by `.`), 6-digit PIN-shaped sequences immediately following the word "pin" (case-insensitive), and any of this repo's known secret-key substrings (`admin_offline_secret`, `all_user_secrets`, `my_offline_secret` — reusing `OFFLINE_SECRET_KEYS` from Task 2) replaced with `[REDACTED]`. **Scope decision, documented here rather than silently narrowed**: this is a text-transform function callers opt into at specific log sites (e.g. the diagnostics-bundle export in Task 9) — it deliberately does NOT monkey-patch the global `console.log`/`console.error`, since doing so blind (no live app run available to verify nothing breaks) risks silently altering every log call in a 2870-line file with no way to check the blast radius in this environment.

- [ ] **Step 1: Write the failing test**

Append to `desktop/security/__tests__/secretsStore.test.js`:

```js
const { redactSensitiveFieldsInLogs } = require('../secretsStore');

test('redactSensitiveFieldsInLogs: redacts a JWT-shaped token', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
  const redacted = redactSensitiveFieldsInLogs(`Authorization: Bearer ${jwt}`);
  assert.doesNotMatch(redacted, /eyJ/);
  assert.match(redacted, /\[REDACTED\]/);
});

test('redactSensitiveFieldsInLogs: redacts a PIN following the word "pin"', () => {
  const redacted = redactSensitiveFieldsInLogs('Employee entered PIN 482913 for auth');
  assert.doesNotMatch(redacted, /482913/);
  assert.match(redacted, /\[REDACTED\]/);
});

test('redactSensitiveFieldsInLogs: redacts known secret-key substrings', () => {
  const redacted = redactSensitiveFieldsInLogs('config lookup failed for admin_offline_secret');
  assert.doesNotMatch(redacted, /admin_offline_secret/);
});

test('redactSensitiveFieldsInLogs: leaves ordinary text untouched', () => {
  const text = 'Sync completed for calls_for_service: 42 rows';
  assert.equal(redactSensitiveFieldsInLogs(text), text);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd desktop && node --test 'security/__tests__/secretsStore.test.js'`
Expected: FAIL — `redactSensitiveFieldsInLogs is not a function`

- [ ] **Step 3: Write the minimal implementation**

Add to `desktop/security/secretsStore.js`, above `module.exports`:

```js
const JWT_SHAPE = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
const PIN_AFTER_LABEL = /\bpin\b\s*:?\s*(\d{6})\b/gi;

/**
 * Text-transform redaction for use at specific log sites (opt-in, not a
 * global console monkey-patch — see interface doc for why). Redacts:
 * JWT-shaped tokens, a 6-digit PIN immediately following the word "pin",
 * and any of this repo's known offline-secret config-key names.
 */
function redactSensitiveFieldsInLogs(text) {
  let result = text.replace(JWT_SHAPE, '[REDACTED]');
  result = result.replace(PIN_AFTER_LABEL, (match, pin) => match.replace(pin, '[REDACTED]'));
  for (const key of OFFLINE_SECRET_KEYS) {
    result = result.split(key).join('[REDACTED]');
  }
  return result;
}
```

Update `module.exports` to add `redactSensitiveFieldsInLogs`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd desktop && node --test 'security/__tests__/secretsStore.test.js'`
Expected: PASS — 21 tests passing

- [ ] **Step 5: No wiring in this task**

Not called from `main.js`/`pinManager.js`/`localDb.js` yet — Task 9 (`encryptDiagnosticsBundleOnExport`, itself unwired pending Group A) is its first real consumer. Committing it standalone-but-tested now means Group A's future plan can wire it in without also having to design and test the redaction logic from scratch.

- [ ] **Step 6: Commit**

```bash
git add desktop/security/secretsStore.js desktop/security/__tests__/secretsStore.test.js
git commit -m "desktop: add redactSensitiveFieldsInLogs (standalone text-transform, no console monkey-patch)"
```

---

### Task 9: `encryptDiagnosticsBundleOnExport` — forward-looking (Group A dependency, unwired)

**Files:**
- Modify: `desktop/security/secretsStore.js`
- Test: `desktop/security/__tests__/secretsStore.test.js`

**Interfaces:**
- Produces: `encryptDiagnosticsBundleOnExport(plainText, safeStorage)` — composes Task 8's `redactSensitiveFieldsInLogs` then Task 1's `encryptSecretForStorage`, returning the redacted-then-encrypted base64 string. No consumer exists yet — Group A's future `exportDiagnosticsBundle` function is the intended caller (per the original spec's Group H row #27), and does not exist in this codebase yet.

- [ ] **Step 1: Write the failing test**

Append to `desktop/security/__tests__/secretsStore.test.js`:

```js
const { encryptDiagnosticsBundleOnExport } = require('../secretsStore');

test('encryptDiagnosticsBundleOnExport: redacts sensitive content, then encrypts', () => {
  const safeStorage = fakeSafeStorage();
  const raw = 'Log dump — PIN 482913 was entered, admin_offline_secret lookup failed';
  const ciphertext = encryptDiagnosticsBundleOnExport(raw, safeStorage);
  // The ciphertext must not, even accidentally, contain the raw secret values
  assert.doesNotMatch(ciphertext, /482913/);
  // Decrypting recovers the REDACTED form, not the original raw secrets
  const decrypted = decryptSecretForStorage(ciphertext, safeStorage);
  assert.doesNotMatch(decrypted, /482913/);
  assert.match(decrypted, /\[REDACTED\]/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd desktop && node --test 'security/__tests__/secretsStore.test.js'`
Expected: FAIL — `encryptDiagnosticsBundleOnExport is not a function`

- [ ] **Step 3: Write the minimal implementation**

Add to `desktop/security/secretsStore.js`, above `module.exports`:

```js
/**
 * Composes redactSensitiveFieldsInLogs + encryptSecretForStorage for the
 * diagnostics-bundle export flow. UNWIRED today — Group A's future
 * exportDiagnosticsBundle (System & Diagnostics, not yet built) is the
 * intended caller. Ships now, tested, so that future group's plan
 * doesn't have to design or test this composition from scratch.
 */
function encryptDiagnosticsBundleOnExport(plainText, safeStorage) {
  return encryptSecretForStorage(redactSensitiveFieldsInLogs(plainText), safeStorage);
}
```

Update `module.exports` to add `encryptDiagnosticsBundleOnExport`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd desktop && node --test 'security/__tests__/secretsStore.test.js'`
Expected: PASS — 22 tests passing

- [ ] **Step 5: Commit**

```bash
git add desktop/security/secretsStore.js desktop/security/__tests__/secretsStore.test.js
git commit -m "desktop: add encryptDiagnosticsBundleOnExport (unwired, for future Group A exportDiagnosticsBundle)"
```

---

### Task 10: `validateBackupFileBeforeImport` — forward-looking (Group B dependency, unwired)

**Files:**
- Modify: `desktop/security/secretsStore.js`
- Test: `desktop/security/__tests__/secretsStore.test.js`

**Interfaces:**
- Produces: `validateBackupFileBeforeImport(fileBuffer)` — pure function, returns `{ok: true}` or `{ok: false, error}`. Checks the buffer starts with SQLite's 16-byte magic header (`"SQLite format 3\0"`) — a cheap, dependency-free sanity check that a chosen "restore" file is actually a SQLite database before anything attempts to open it, closing the gap the original spec's Group H row #30 named ("a swapped-in malicious file can't be loaded"). No consumer exists yet — Group B's future `importLocalDbBackup` does not exist in this codebase yet.

- [ ] **Step 1: Write the failing test**

Append to `desktop/security/__tests__/secretsStore.test.js`:

```js
const { validateBackupFileBeforeImport } = require('../secretsStore');

test('validateBackupFileBeforeImport: accepts a buffer starting with the SQLite magic header', () => {
  const header = Buffer.from('SQLite format 3\0', 'utf8');
  const fakeDbFile = Buffer.concat([header, Buffer.from('...rest of file...')]);
  assert.deepEqual(validateBackupFileBeforeImport(fakeDbFile), { ok: true });
});

test('validateBackupFileBeforeImport: rejects a buffer without the magic header', () => {
  const result = validateBackupFileBeforeImport(Buffer.from('not a sqlite file'));
  assert.equal(result.ok, false);
});

test('validateBackupFileBeforeImport: rejects a buffer shorter than the header', () => {
  const result = validateBackupFileBeforeImport(Buffer.from('short'));
  assert.equal(result.ok, false);
});

test('validateBackupFileBeforeImport: rejects a non-Buffer input', () => {
  const result = validateBackupFileBeforeImport('not a buffer');
  assert.equal(result.ok, false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd desktop && node --test 'security/__tests__/secretsStore.test.js'`
Expected: FAIL — `validateBackupFileBeforeImport is not a function`

- [ ] **Step 3: Write the minimal implementation**

Add to `desktop/security/secretsStore.js`, above `module.exports`:

```js
const SQLITE_MAGIC_HEADER = Buffer.from('SQLite format 3\0', 'utf8');

/**
 * Cheap, dependency-free sanity check that a chosen "restore" file is
 * actually a SQLite database (matches its fixed 16-byte magic header)
 * before anything attempts to open it as the local cache. UNWIRED today
 * — Group B's future importLocalDbBackup (not yet built) is the
 * intended caller.
 */
function validateBackupFileBeforeImport(fileBuffer) {
  if (!Buffer.isBuffer(fileBuffer)) {
    return { ok: false, error: 'input must be a Buffer' };
  }
  if (fileBuffer.length < SQLITE_MAGIC_HEADER.length) {
    return { ok: false, error: 'file is too short to be a SQLite database' };
  }
  const header = fileBuffer.subarray(0, SQLITE_MAGIC_HEADER.length);
  if (!header.equals(SQLITE_MAGIC_HEADER)) {
    return { ok: false, error: 'file does not have a valid SQLite header' };
  }
  return { ok: true };
}
```

Update `module.exports` to add `validateBackupFileBeforeImport`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd desktop && node --test 'security/__tests__/secretsStore.test.js'`
Expected: PASS — 26 tests passing

- [ ] **Step 5: Commit**

```bash
git add desktop/security/secretsStore.js desktop/security/__tests__/secretsStore.test.js
git commit -m "desktop: add validateBackupFileBeforeImport (unwired, for future Group B importLocalDbBackup)"
```

---

### Task 11: Final verification pass

**Files:** none changed — verification only.

- [ ] **Step 1: Run the full secretsStore + sessionHardening + ipcGuard suites**

Run: `cd desktop && node --test 'security/__tests__/**/*.js'`
Expected: PASS — 26 `secretsStore` tests + 34 `sessionHardening` tests + 46 `ipcGuard` tests = 106 tests, 0 failing.

- [ ] **Step 2: Confirm every modified file still parses cleanly**

Run: `node --check desktop/main.js && node --check desktop/localDb.js && node --check desktop/pinManager.js`
Expected: exit code 0 for all three, no output.

- [ ] **Step 3: Confirm no plaintext offline secrets remain reachable outside `pinManager.js`**

Run: `grep -rn "getConfig('admin_offline_secret'\|getConfig('all_user_secrets'\|getConfig('my_offline_secret'" desktop/*.js`
Expected: matches only inside `desktop/pinManager.js` (via `readSecretConfig`) — if any other file reads these keys directly, that's a bypass of the encryption added in this plan and must be fixed before merge.

- [ ] **Step 4: Full manual dev-run smoke test (same known limitation as Groups G and F)**

Run: `cd desktop && npm start`
Expected: app launches; if a real display server is available, log in as a non-admin officer and generate/enter an offline PIN, confirming the flow still works end-to-end post-encryption; check the app's userData directory for `rmpg-local.db` and confirm (via `ls -la` on a real machine) it shows `-rw-------` (0600) permissions. If no display server is available in this environment, say so explicitly and rely on Steps 1-3's static checks instead.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "desktop: complete Group H (local data protection) — 106 tests passing"
```
