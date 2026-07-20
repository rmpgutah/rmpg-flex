# Desktop Shell — Group I (Auth/Session Hardening) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `desktop/security/sessionAuth.js` — 10 Auth/Session Hardening functions for the RMPG Flex desktop shell — per Group I of the 10-group sequence in [`docs/superpowers/specs/2026-07-18-desktop-shell-functions-and-hardening-design.md`](../specs/2026-07-18-desktop-shell-functions-and-hardening-design.md) (Section 2 — Hardening — functions #31-40; NOT the same numbering as Section 1's Group D, which independently uses #31-40 for its own new-functions list — the spec has two separate 1-50 sequences, one per section). Group I is the second-to-last group and, per the spec's own dependency note, requires Groups A-E to already exist (they now all do — A/#2857, B/#2858, C/#2864, D/#2862, E/#2868 are all merged or in review).

**Architecture:** A single new module, `desktop/security/sessionAuth.js`, following the exact pattern established by Groups F/G/H's `desktop/security/*.js` files — every function takes its Electron/Node dependency (`db`, `powerMonitor`, `getConfig`/`setConfig`, `os`, `crypto`) as a parameter, so the pure decision logic is unit-tested with fakes in `desktop/security/__tests__/sessionAuth.test.js`, and `main.js`/`updater.js`/`syncManager.js` do the real wiring. This is the group with the most cross-group wiring in the whole program — two of its ten functions (`disableClipboardAutoSyncOfSecrets`, `enforceSecondaryWindowSecurityDefaults`) exist specifically to retrofit Group E's `clipboard:set`/`openSecondaryWindow`, and a third (`revokeStaleSyncTokensOnMismatch`) reuses Group C's `wipeMirroredCacheTables`.

**Tech Stack:** Plain Node.js (CommonJS), Node's `crypto`/`os` built-ins, Electron's `powerMonitor`, `node:test` + `node:assert/strict`.

## Global Constraints

- Match existing `desktop/security/*.js` conventions: CommonJS, no TypeScript, header comment block matching `desktop/security/sessionHardening.js`'s style.
- Every function must be unit-testable with zero real Electron/OS runtime — dependencies are always parameters. The thin `main.js`/`updater.js`/`syncManager.js` wiring layers do the real `require()`s.
- **Scope decision on `enforceJwtExpiryCheckLocally` (Task 1)**: this codebase has no existing JWT-decode logic anywhere in `desktop/` (confirmed — `offlineRouter.js` has no `jwt`/`exp` handling at all). This plan adds a minimal, dependency-free JWT payload decoder (base64url-decode the middle segment, `JSON.parse` it) — it does NOT verify the signature (that already happened server-side when the token was issued; this is a purely local, client-side staleness check, not a security boundary in the cryptographic sense) — it only reads the `exp` claim and compares against the current time, so `offline:api` can refuse to serve cached responses against a token that's already expired by its own stated lifetime.
- **Scope decision on `bindPinSessionToDeviceId` (Task 2)**: `desktop/localDb.js`'s `pin_sessions` table has no `device_id` column today. This plan adds one via a reconciliation `ALTER TABLE` wrapped in try/catch (SQLite has no `ADD COLUMN IF NOT EXISTS`, matching the exact caveat this repo's CLAUDE.md documents for the Worker's D1 migrations — same discipline applies here for local SQLite). The device identifier itself is NOT a hardware fingerprint (Node/Electron have no portable, dependency-free machine-ID API) — it's a `crypto.randomUUID()` generated once on first run and persisted in `local_config` under `device_id`, reused thereafter. This is weaker than true hardware fingerprinting (a wiped/reinstalled app gets a new ID) but is a real, meaningful improvement over today's total absence of device binding, and needs no new native dependency.
- **Scope decision on `auditPinAttemptLogRetention` (Task 3)**: "audit" here means an active cleanup, not a passive report — the function deletes `pin_attempts` rows beyond a retention policy (a row-count cap, e.g. keep the most recent 500 rows per user, since `pin_attempts` currently has no cap/rotation at all and is used for lockout logic that only needs a recent window).
- **Scope decision on `expireCachedCredentialsOnClockSkew` (Task 5)**: detecting a system clock jump requires comparing WALL-CLOCK elapsed time against a clock source immune to manual adjustment. Electron's main process doesn't expose a monotonic clock directly to arbitrary JS the way `process.hrtime.bigint()` does — this plan uses `process.hrtime.bigint()` (monotonic, unaffected by `date -s`/NTP corrections/manual clock changes) as the trusted reference, storing both a wall-clock timestamp AND a monotonic snapshot in `local_config` at each check, and comparing the WALL-CLOCK delta against the MONOTONIC delta on the next check — a large mismatch (wall-clock delta far exceeds monotonic delta, in either direction) indicates the system clock was manually altered.
- **Scope decision on `verifyUpdatePackageSignatureExplicitly` (Task 9)**: this repo's `updater.js` doesn't currently expose a code-signing public key or manifest-signing infrastructure (electron-updater relies on the OS's own code-sign verification — macOS Gatekeeper/notarization, Windows Authenticode — which already runs before `quitAndInstall` at the OS level). Building a full independent signature-verification pipeline (a second public key, a second signing step in the release process) is out of scope for this task. This plan instead adds a "belt-and-suspenders" integrity re-check: on the `update-downloaded` event, before allowing `quitAndInstall` to proceed, re-compute the downloaded file's SHA512 hash and compare it against `info.sha512` (already provided by `electron-updater`'s own `UpdateInfo` object, sourced from the signed update manifest `electron-builder` publishes) — this catches a downloaded-file corruption/tamper scenario between electron-updater's own download-verification and the actual install step, without requiring new signing infrastructure. Document this scope explicitly; do not attempt to build a second independent PKI.
- **Scope decision on `revokeStaleSyncTokensOnMismatch` (Task 10)**: reuses Group C's `wipeMirroredCacheTables(Object.keys(PULL_INTERVALS))` (already exported from `desktop/localDb.js`/used by `syncManager.js`'s `forceFullResync`) rather than duplicating cache-wipe logic — do not write a second wipe implementation.
- Commit after each task.

---

### Task 1: `enforceJwtExpiryCheckLocally`

**Files:**
- Create: `desktop/security/sessionAuth.js`
- Test: `desktop/security/__tests__/sessionAuth.test.js`

**Interfaces:**
- `decodeJwtPayloadLocally(token)` — pure. Splits `token` on `.`; if it doesn't have exactly 3 segments, returns `null` (not a throw — malformed input is common/expected, e.g. no cached token yet). Base64url-decodes the middle segment (`Buffer.from(segment.replace(/-/g,'+').replace(/_/g,'/'), 'base64')`), `JSON.parse`s it wrapped in try/catch (parse failure → `null`). Returns the decoded payload object or `null`.
- `isJwtExpiredLocally(token, nowMs)` — pure, calls `decodeJwtPayloadLocally`. If decode fails (`null`) OR the payload has no `exp` claim, treat as expired (fail closed — an undecodable/missing-expiry token should not be trusted as still valid). Otherwise compares `payload.exp * 1000 < nowMs` (JWT `exp` is seconds-since-epoch per RFC 7519, JS `Date.now()` is milliseconds — do not mix units).
- Wiring in `main.js`'s `offline:api` handler (search for it, read its current exact body first): before calling `offlineRouter.handle(...)`, check `isJwtExpiredLocally(getConfig('auth_token'), Date.now())` — if expired, return `{status: 401, error: 'cached session expired'}` instead of serving the cached-offline response.

- [ ] **Step 1: Write failing tests** for `decodeJwtPayloadLocally`: a real-shaped JWT (construct one by hand — base64url-encode a header `{}` and a payload `{"exp": 1234567890}`, join with `.` and a dummy signature segment) → decodes to the correct payload object; a token with only 2 segments → `null`; a token whose middle segment isn't valid base64/JSON → `null`; empty string → `null`.
- [ ] **Step 2: Run tests, verify they fail** (`Cannot find module '../sessionAuth'`).
- [ ] **Step 3: Write failing tests** for `isJwtExpiredLocally`: a token with `exp` far in the future relative to a fixed `nowMs` → not expired (`false`); a token with `exp` in the past → expired (`true`); a token with no `exp` claim → expired (`true`, fail-closed); an undecodable token → expired (`true`, fail-closed); verify the seconds-vs-milliseconds unit conversion with a concrete boundary case (an `exp` exactly at `nowMs/1000` — pick a clear, unambiguous test value, don't leave the boundary condition (`<` vs `<=`) untested).
- [ ] **Step 4: Implement both functions in `desktop/security/sessionAuth.js`.** Header comment block matching `desktop/security/sessionHardening.js`'s style. Export both.
- [ ] **Step 5: Run tests, verify they pass.**
- [ ] **Step 6: Wire into `main.js`'s `offline:api` handler** — read its exact current body first, add the expiry check as the FIRST thing inside the handler (before `offlineRouter.handle(...)` is ever called), import `isJwtExpiredLocally` from `./security/sessionAuth` (new require line — this is the first task requiring this module).
- [ ] **Step 7: `node --check`, run the test suite, commit.**

---

### Task 2: `bindPinSessionToDeviceId`

**Files:**
- Modify: `desktop/security/sessionAuth.js`, `desktop/security/__tests__/sessionAuth.test.js`, `desktop/localDb.js`, `desktop/main.js`

**Interfaces:**
- `getOrCreateDeviceId(getConfigFn, setConfigFn, randomUUIDFn)` — takes `getConfig`/`setConfig`-shaped functions AND a `crypto.randomUUID`-shaped function as parameters (DI-testable). Reads `getConfigFn('device_id')`; if present, returns it unchanged. If absent, generates `randomUUIDFn()`, persists it via `setConfigFn('device_id', newId)`, returns the new id.
- `isPinSessionBoundToDevice(session, currentDeviceId)` — pure. Given a `pin_sessions` row object (with a `device_id` field, which may be `null` for sessions created before this migration) and the current device's id: if `session.device_id` is `null`/`undefined` (a pre-migration session), treat as valid for backward compatibility (do NOT lock out existing active sessions the moment this ships) but note this in a comment as a one-time transitional allowance. If `session.device_id` is set, return `session.device_id === currentDeviceId`.
- In `desktop/localDb.js`: add a reconciliation call inside `initLocalDb()` (near the existing `restrictLocalDbFilePermissions`/`verifyLocalDbIntegrity` reconciliation calls) — `try { db.exec('ALTER TABLE pin_sessions ADD COLUMN device_id TEXT'); } catch (err) { if (!/duplicate column/i.test(err.message)) throw err; }`. Also update the `CREATE TABLE IF NOT EXISTS pin_sessions` DDL itself to include `device_id TEXT` for genuinely fresh installs (both the reconciliation AND the fresh-install DDL need the column — a fresh install never hits the `CREATE TABLE IF NOT EXISTS` path a second time to pick up the `ALTER`).
- Wire into wherever `pin_sessions` rows are created (search `desktop/pinManager.js` for the `INSERT INTO pin_sessions` call) — store `getOrCreateDeviceId(getConfig, setConfig, crypto.randomUUID)`'s result as `device_id` on insert. Wire into `offline:state`'s existing PIN-session-lookup query (`main.js`, search for the `SELECT expires_at FROM pin_sessions` query used there) — after fetching the session row, additionally check `isPinSessionBoundToDevice(session, getOrCreateDeviceId(...))`; if it fails, treat as NOT locally authorized (same as no active session).

- [ ] **Step 1: Write failing tests** for `getOrCreateDeviceId`: no stored id → generates + persists + returns a new one (assert `setConfigFn` was called with the generated value); existing stored id → returns it unchanged WITHOUT calling `setConfigFn` (assert no write happened — a real regression guard, not just a return-value check).
- [ ] **Step 2: Write failing tests** for `isPinSessionBoundToDevice`: matching device_id → `true`; mismatched → `false`; `null`/`undefined` device_id on the session (pre-migration row) → `true` (backward-compat allowance), with a comment/test name making the transitional nature explicit.
- [ ] **Step 3: Run tests, verify they fail.**
- [ ] **Step 4: Implement both functions.**
- [ ] **Step 5: Run tests, verify they pass.**
- [ ] **Step 6: Add the `ALTER TABLE` reconciliation + fresh-install DDL update to `localDb.js`.** Read `initLocalDb()`'s exact current reconciliation-call ordering first (the existing `restrictLocalDbFilePermissions` call has documented ordering constraints relative to the WAL pragma — read that comment, make sure your new reconciliation doesn't violate it) and `pin_sessions`'s exact current `CREATE TABLE` DDL before editing.
- [ ] **Step 7: Wire `getOrCreateDeviceId` into `pinManager.js`'s session-creation INSERT and `main.js`'s `offline:state` session-lookup**, reading both call sites' exact current code first.
- [ ] **Step 8: `node --check` on all touched files, run the test suite, commit.**

---

### Task 3: `auditPinAttemptLogRetention`

**Files:**
- Modify: `desktop/security/sessionAuth.js`, `desktop/security/__tests__/sessionAuth.test.js`, `desktop/main.js`

**Interfaces:**
- `pruneOldPinAttempts(db, maxRowsPerUser = 500)` — takes the real `better-sqlite3` `db` instance as a parameter (this function genuinely needs SQL, unlike most of this group's pure logic — matches `desktop/localDb.js`'s own module-level-`db` convention, but since this lives in `security/sessionAuth.js` not `localDb.js`, take `db` as an explicit parameter to stay consistent with THIS file's DI-testable style). For each distinct `user_id` in `pin_attempts`, deletes all but the most recent `maxRowsPerUser` rows (by `attempted_at`) for that user. A reasonable SQL approach: `DELETE FROM pin_attempts WHERE id NOT IN (SELECT id FROM pin_attempts WHERE user_id = ? ORDER BY attempted_at DESC LIMIT ?)` run once per distinct `user_id` (query `SELECT DISTINCT user_id FROM pin_attempts` first). Returns `{prunedRows: <total count deleted>}`.
- Wire a call to `pruneOldPinAttempts(getLocalDb(), 500)` into `main.js`'s startup sequence, near where `initLocalDb()` itself is called (search for that call site) — run once per app launch, not on every PIN attempt (this is retention/rotation, not real-time enforcement).

- [ ] **Step 1: Write a failing test** using the same `require.cache`-based electron-mocking pattern established in Group C's `desktop/__tests__/localDb.test.js` (this is the first test in `security/__tests__/` needing a REAL local DB — check whether that existing test file's setup pattern can be reused/imported, or needs to be duplicated here; prefer factoring the shared `require.cache` electron-mock setup into a small reusable test helper if it's easy to do without a large refactor, but don't force it if the two test files' surrounding context differs enough to make sharing awkward — your call). Seed more than 500 `pin_attempts` rows for one user (a smaller number for the test, e.g. seed 10 and prune to keep 3, to keep the test fast) plus a few rows for a second user, call `pruneOldPinAttempts`, assert: the first user has exactly the N most recent rows remaining (checked by content/order, not just count), the second user's rows are completely untouched, and the returned `{prunedRows}` count is correct.
- [ ] **Step 2: Run test, verify it fails.**
- [ ] **Step 3: Implement `pruneOldPinAttempts`.**
- [ ] **Step 4: Run test, verify it passes** (remember the `better-sqlite3` Node-ABI rebuild — though per the recently-merged infrastructure fix, `.husky/pre-push` now auto-manages this; check whether a manual `npm rebuild better-sqlite3` is still needed for a plain local `node --test` run, or whether that's also now automated — verify by reading `desktop/package.json`'s current `test`/`pretest` scripts and `.husky/pre-push`'s current content before assuming either way).
- [ ] **Step 5: Wire the startup call into `main.js`.**
- [ ] **Step 6: `node --check`, run the test suite, commit.**

---

### Task 4: `requireReauthForRecon`

**Files:**
- Modify: `desktop/security/sessionAuth.js`, `desktop/security/__tests__/sessionAuth.test.js`, `desktop/main.js`

**Interfaces:**
- `isReconLaunchAuthorized(cachedRole, activeSession)` — pure. Mirrors the same admin-always-allowed / active-PIN-session-required logic `offline:state`'s handler already uses (read that handler's exact current logic first, factor the SAME rule into this reusable, testable function rather than re-deriving a subtly different rule): `cachedRole === 'admin'` → `true`; otherwise `true` only if `activeSession` is a non-null object representing a currently-valid, non-expired, device-bound session (reuse `isPinSessionBoundToDevice` from Task 2 as part of this check if `activeSession` includes a `device_id` field — compose, don't duplicate).
- Wire into `main.js`'s `recon:launch` handler (search for it, read its exact current body — it currently has NO auth check at all per the spec's stated gap): as the FIRST check inside the handler, before any of the existing platform-detection/spawn logic, look up the current PIN session (same query pattern `offline:state` uses) and call `isReconLaunchAuthorized`; if unauthorized, return `{ok:false, error:'recon connect requires an active authenticated session'}` without spawning anything.

- [ ] **Step 1: Write failing tests** for `isReconLaunchAuthorized`: admin role → `true` regardless of session; non-admin with a valid active session → `true`; non-admin with no session (`null`) → `false`; non-admin with an expired session → `false`.
- [ ] **Step 2-4: Fail → implement → pass.**
- [ ] **Step 5: Wire into `recon:launch`** in `main.js`, reading its current exact code first.
- [ ] **Step 6: `node --check`, run the test suite, commit.**

---

### Task 5: `expireCachedCredentialsOnClockSkew`

**Files:**
- Modify: `desktop/security/sessionAuth.js`, `desktop/security/__tests__/sessionAuth.test.js`, `desktop/main.js`

**Interfaces:**
- `detectClockSkew(getConfigFn, setConfigFn, nowMs, monotonicNs, toleranceMs = 60000)` — pure-ish (takes `Date.now()`'s result and `process.hrtime.bigint()`'s result as parameters, not called internally — DI-testable). Reads two previously-stored values from config: `'clock_skew_check_wall_ms'` and `'clock_skew_check_monotonic_ns'` (both stored as strings, parse accordingly — monotonic nanoseconds as a `BigInt`, handle the string↔BigInt conversion carefully). If either is missing (first-ever check), just store the current `nowMs`/`monotonicNs` and return `{skewDetected: false}` (nothing to compare against yet). Otherwise compute `wallDeltaMs = nowMs - previousWallMs` and `monotonicDeltaMs = Number(monotonicNs - previousMonotonicNs) / 1e6` (BigInt nanoseconds → milliseconds), then `skewDetected = Math.abs(wallDeltaMs - monotonicDeltaMs) > toleranceMs`. Always updates the stored values to the current check's values before returning (so the next check compares against THIS one, a rolling baseline) — update BEFORE computing skew or after, your call, but be consistent and document it (updating after is more defensible: if `detectClockSkew` itself somehow doesn't get called again for a while, you want the LATEST successful check as the baseline, not a stale one — but either is a reasonable design, just be deliberate).
- Wire into `main.js`'s startup sequence (near the Task 3 `pruneOldPinAttempts` call — both are "periodic background hygiene" checks) — call `detectClockSkew(getConfig, setConfig, Date.now(), process.hrtime.bigint())`; if `skewDetected`, invalidate ALL active PIN sessions (`db.prepare('UPDATE pin_sessions SET is_active = 0 WHERE is_active = 1').run()` or similar — read the existing session-deactivation pattern if one already exists anywhere, e.g. in `pinManager.js`'s lockout logic, and reuse its style) forcing PIN re-entry.

- [ ] **Step 1: Write failing tests** for `detectClockSkew`: first-ever check (no stored baseline) → `{skewDetected:false}`, and assert the baseline WAS stored (`setConfigFn` called); a subsequent check where wall-clock and monotonic deltas roughly agree (e.g. both ~5000ms) → `{skewDetected:false}`; a subsequent check where wall-clock jumped far ahead of monotonic (e.g. wall delta 10 years, monotonic delta 5000ms) → `{skewDetected:true}`; a subsequent check where wall-clock jumped BACKWARD (negative wall delta, positive monotonic delta) → `{skewDetected:true}` (this is the "rolled-back clock to replay an expired PIN window" attack the spec explicitly names — make sure this exact scenario has a dedicated test, not just forward-jump).
- [ ] **Step 2-4: Fail → implement → pass**, being careful with the BigInt↔string round-trip in your fakes (a fake `setConfigFn` needs to actually store what it's given as a string, and your fake `getConfigFn` needs to return that stored string back, for the round-trip test to be meaningful rather than trivially passing).
- [ ] **Step 5: Wire into `main.js`'s startup sequence**, including the session-invalidation-on-skew-detected logic.
- [ ] **Step 6: `node --check`, run the test suite, commit.**

---

### Task 6: `lockOnSystemSleep`

**Files:**
- Modify: `desktop/main.js`

**Interfaces:**
- Wiring only (this is an Electron `powerMonitor` event-listener registration, not independently unit-testable without a live Electron runtime — matches how Group E's `flashFrame`/`toggleFullScreen` went untested at the `main.js` layer): `powerMonitor.on('suspend', () => { /* invalidate active PIN sessions, same DB update as Task 5's clock-skew response */ });` and also listen for `'lock-screen'` (a distinct Electron `powerMonitor` event fired specifically on OS screen-lock, not just sleep) — read Electron's `powerMonitor` event list to confirm `'lock-screen'` is genuinely a supported event on this app's target platforms (macOS/Windows/Linux support varies — `powerMonitor`'s docs note `'lock-screen'`/`'unlock-screen'` are macOS/Windows only, NOT Linux; guard accordingly or accept the platform gap and document it, matching this program's established "gracefully degrade on unsupported platforms" pattern).
- Factor the actual "invalidate all active PIN sessions" logic into a small named function (could live in `sessionAuth.js` as `invalidateAllActivePinSessions(db)`, reused by BOTH Task 5's clock-skew response and this task's sleep/lock response — do not duplicate the same `UPDATE pin_sessions SET is_active = 0 ...` SQL in two places).

- [ ] **Step 1: If Task 5 didn't already factor out a reusable `invalidateAllActivePinSessions(db)` function, do so now** (check Task 5's actual implementation first — if it inlined the UPDATE directly, extract it into `sessionAuth.js` and have Task 5's wiring call the extracted function too, updating Task 5's own call site in `main.js` to use it).
- [ ] **Step 2: Wire `powerMonitor.on('suspend', ...)` and (platform-guarded) `'lock-screen'`** into `main.js`'s startup sequence (near where `powerMonitor` is already used for `sys:idle-time`, from Group A).
- [ ] **Step 3: `node --check`, run the test suite (confirming `invalidateAllActivePinSessions` itself, if newly extracted, has its own test), commit.**

---

### Task 7: `disableClipboardAutoSyncOfSecrets` — wires Group E's `clipboard:set`

**Files:**
- Modify: `desktop/security/sessionAuth.js`, `desktop/security/__tests__/sessionAuth.test.js`, `desktop/main.js`

**Interfaces:**
- `looksLikeSecretValue(text, knownSecrets)` — pure. `knownSecrets` is an array of currently-cached secret strings (the actual values of `getConfig('admin_offline_secret')`, `getConfig('my_offline_secret')`, `getConfig('all_user_secrets')` if set, PLUS `getConfig('auth_token')` — read Group H's `secretsStore.js`/`pinManager.js` to confirm the exact set of config keys that hold sensitive values). Returns `true` if `text` exactly equals any entry in `knownSecrets` (a simple, low-false-positive check: block only EXACT matches to a currently-known secret value, not a heuristic pattern-match that could false-positive on legitimate case-related text like report content — document this as a deliberate precision-over-recall choice, since falsely blocking a legitimate clipboard copy would itself be a usability regression in a CAD tool).
- Wire into `main.js`'s EXISTING `clipboard:set` handler (from Group E — search for `'clipboard:set'`, read its exact current body: `guardedHandle('clipboard:set', (event, text) => { clipboard.writeText(String(text)); })`): before calling `clipboard.writeText`, gather the current known-secret values (decrypt via Group H's `decryptSecretForStorage`/`decryptPasswordHashOrFallback` where needed — read how those are already used elsewhere in `main.js` for the exact decrypt-with-fallback pattern to reuse, don't invent a new one), call `looksLikeSecretValue(String(text), knownSecrets)`; if `true`, return `{ok:false, error:'cannot copy secret values to the clipboard'}` WITHOUT calling `clipboard.writeText` at all; otherwise proceed as before.

- [ ] **Step 1: Read Group E's exact current `clipboard:set` handler** and Group H's `secretsStore.js` exports (`decryptSecretForStorage` etc.) before writing anything.
- [ ] **Step 2: Write failing tests** for `looksLikeSecretValue`: `text` exactly matching one of `knownSecrets` → `true`; `text` NOT matching any → `false`; empty `knownSecrets` array → `false` for any input; `text` that's a SUBSTRING of a known secret but not an exact match → `false` (confirms this is exact-match, not substring-match, per the precision-over-recall scope decision).
- [ ] **Step 3-4: Fail → implement → pass.**
- [ ] **Step 5: Wire into `clipboard:set`**, reading the exact current handler code and the exact current secret-decryption call patterns used elsewhere in `main.js` first.
- [ ] **Step 6: `node --check`, run the test suite, commit.**

---

### Task 8: `enforceSecondaryWindowSecurityDefaults` — wires Group E's `openSecondaryWindow`

**Files:**
- Modify: `desktop/security/sessionAuth.js`, `desktop/security/__tests__/sessionAuth.test.js`, `desktop/main.js`

**Interfaces:**
- `assertWebPreferencesNotWeaker(candidatePrefs, referencePrefs)` — pure. Compares two `webPreferences`-shaped objects on the security-relevant keys (`contextIsolation`, `nodeIntegration`, `webSecurity`, `webviewTag`, `experimentalFeatures`, `allowRunningInsecureContent`, `enableWebSQL` — the exact set `hardenWebPreferencesDefaults()` from Group F sets, read that function's current code to get the authoritative list and each key's "secure" value). For each key where the "secure" direction is known (e.g. `contextIsolation: true` is secure, `false` is weaker; `nodeIntegration: false` is secure, `true` is weaker), asserts `candidatePrefs[key]` is at least as secure as `referencePrefs[key]`. Returns `{ok:true}` or `{ok:false, error: 'weaker webPreferences: <key>'}` naming the first violated key found.
- Wire into `main.js`'s EXISTING `window:open-secondary` handler (Group E — search for it, read its exact current body): AFTER building the candidate `webPreferences` via `hardenWebPreferencesDefaults({...})` but BEFORE actually constructing the `new BrowserWindow(...)`, call `assertWebPreferencesNotWeaker(candidateWebPreferences, hardenWebPreferencesDefaults())` (comparing against a FRESH baseline call with no overrides, representing the maximally-secure defaults) — this is a self-check/regression-guard: since `openSecondaryWindow` already calls `hardenWebPreferencesDefaults()` correctly today (confirmed in Group E's own final review), this assertion should always pass in the current code — its value is catching a FUTURE regression if someone later weakens the call site without realizing it. If it ever fails, return `{ok:false, error}` and do NOT create the window.

- [ ] **Step 1: Read `hardenWebPreferencesDefaults()`'s exact current implementation** (the authoritative list of security-relevant keys and their secure values) and `window:open-secondary`'s exact current handler code before writing anything.
- [ ] **Step 2: Write failing tests** for `assertWebPreferencesNotWeaker`: identical prefs → `{ok:true}`; candidate with `contextIsolation:false` where reference has `true` → `{ok:false}` naming that key; candidate with `nodeIntegration:true` where reference has `false` → `{ok:false}`; candidate that's MORE secure or equally secure on every key (e.g. extra unrelated keys present) → `{ok:true}` (don't false-positive on benign extra keys not in the security-relevant set).
- [ ] **Step 3-4: Fail → implement → pass.**
- [ ] **Step 5: Wire the self-check into `window:open-secondary`**, reading its exact current code first — this should be a small, additive change (one function call + one early-return branch), not a restructure of the existing handler.
- [ ] **Step 6: `node --check`, run the test suite, commit.**

---

### Task 9: `verifyUpdatePackageSignatureExplicitly`

**Files:**
- Modify: `desktop/security/sessionAuth.js`, `desktop/security/__tests__/sessionAuth.test.js`, `desktop/updater.js`

**Interfaces:**
- `verifyDownloadedUpdateHash(filePath, expectedSha512, fsModule, cryptoModule)` — takes the downloaded file path, the expected hash (from electron-updater's own `info.sha512`), and `fs`/`crypto` as parameters (DI-testable — a fake `fsModule.createReadStream` or `fsModule.readFileSync` + fake `cryptoModule.createHash`). Reads the file, computes its SHA512 (electron-updater's manifest format uses base64-encoded SHA512 — match that encoding, not hex), compares against `expectedSha512`. Returns `{ok:true}` or `{ok:false, error:'update package hash mismatch'}`.
- Wire into `desktop/updater.js`'s `update-downloaded` event handler (read its exact current code — search for `autoUpdater.on('update-downloaded'`): before the update is allowed to proceed to install (i.e., before `quitAndInstall` would ever be called, which currently happens later via the separate `updater:install` IPC channel — read that handler too, at `guardedOn('updater:install', ...)`), call `verifyDownloadedUpdateHash` using `info.path`/`info.sha512` from the `update-downloaded` event payload. If verification fails, do NOT let `updater:install`'s later `quitAndInstall` call proceed — e.g., track a module-level `let lastUpdateVerified = false;` flag set only on successful verification, checked by `updater:install` before calling `quitAndInstall`.

- [ ] **Step 1: Read `updater.js`'s exact current `update-downloaded` handler and `updater:install` handler** before writing anything — confirm the `info` object's actual shape (electron-updater's `UpdateDownloadedEvent` — verify it genuinely includes `.path`/`.sha512` fields as assumed, don't guess).
- [ ] **Step 2: Write failing tests** for `verifyDownloadedUpdateHash`: matching hash → `{ok:true}`; mismatched hash → `{ok:false}`; using fakes for `fs`/`crypto` (don't touch a real filesystem or compute a real SHA512 in the test — a fake `crypto.createHash` returning a fixed digest for a fixed fake file content is sufficient to test the comparison logic).
- [ ] **Step 3-4: Fail → implement → pass.**
- [ ] **Step 5: Wire into `updater.js`**, adding the verification-gate flag as described.
- [ ] **Step 6: `node --check`, run the test suite, commit.**

---

### Task 10: `revokeStaleSyncTokensOnMismatch` — reuses Group C's `wipeMirroredCacheTables`

**Files:**
- Modify: `desktop/security/sessionAuth.js`, `desktop/security/__tests__/sessionAuth.test.js`, `desktop/syncManager.js`

**Interfaces:**
- `hasUserOrOrgMismatch(cachedUserId, freshUserId)` — pure. Simple inequality check with type-coercion safety (`String(cachedUserId) !== String(freshUserId)`, guarding against a number-vs-string mismatch between how the two IDs might be stored) — returns `true` if they differ AND both are genuinely present (if either is null/undefined, e.g. no cached user yet on a fresh install, return `false` — nothing to mismatch against).
- Wire into `desktop/syncManager.js`'s `pullAll()` or `pullSecrets()` (read both current implementations — wherever a fresh, authoritative user identity becomes available from a server response is the right hook point; if neither currently surfaces a fresh user id distinct from the cached one, this may need a small additive check reading whatever identity the sync response DOES carry — use your judgment grounded in the actual code, escalate with NEEDS_CONTEXT if no reasonable hook point exists without inventing new server-response fields that don't exist today): if `hasUserOrOrgMismatch(getConfig('current_user_id'), freshUserIdFromResponse)`, call the EXISTING `wipeMirroredCacheTables(Object.keys(PULL_INTERVALS))` from `desktop/localDb.js` (already imported in `syncManager.js` since Group C) instead of proceeding with the normal sync — log a warning, do not silently continue syncing mismatched data into the wrong user's cache.

- [ ] **Step 1: Read `syncManager.js`'s `pullAll`/`pullSecrets`/`pullTable` current implementations in full** to find the actual, real hook point where a fresh user/org identity is available (or determine none exists cleanly today) before writing anything. This is the task most likely to need NEEDS_CONTEXT escalation if the assumed hook point doesn't exist — do not force a fake integration point.
- [ ] **Step 2: Write failing tests** for `hasUserOrOrgMismatch`: matching ids (same type) → `false`; matching ids (number vs string) → `false` (coercion-safe); differing ids → `true`; either side null/undefined → `false`.
- [ ] **Step 3-4: Fail → implement → pass.**
- [ ] **Step 5: Wire into the real hook point identified in Step 1**, reusing `wipeMirroredCacheTables`/`PULL_INTERVALS` (already imported in `syncManager.js`) — do not write a second wipe implementation.
- [ ] **Step 6: `node --check`, run the test suite, commit.**

---

### Task 11: Final verification pass

**Files:** none (verification only, no production code changes)

- [ ] Run the full `desktop` test suite (`node --test desktop/__tests__/*.test.js desktop/security/__tests__/*.test.js` or the repo's established `npm test` invocation — check `desktop/package.json`'s current `test` script, which may have changed since the recently-merged CI/ABI-automation PRs) — expect all prior-group tests still passing plus this group's new cases.
- [ ] `node --check` on every file touched this group: `main.js`, `updater.js`, `syncManager.js`, `localDb.js`, `pinManager.js`, `security/sessionAuth.js`.
- [ ] Confirm no duplicate `require(...)` lines were introduced for `./security/sessionAuth`, `./security/secretsStore`, `./localDb` across all of Tasks 1-10, in every file touched.
- [ ] Confirm the `pin_sessions` table's `device_id` column reconciliation (Task 2) is idempotent — running `initLocalDb()` twice in a row against the same DB file must not throw on the second `ALTER TABLE` attempt.
- [ ] Update the progress ledger, mark Group I complete.
