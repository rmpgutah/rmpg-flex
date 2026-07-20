# Desktop Shell — Group C (Sync & Offline Management) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `desktop/syncManager.js` and `desktop/localDb.js` with the 10 Sync & Offline Management functions for the RMPG Flex desktop shell (pause/resume the background sync loop, queue visibility + targeted retry/clear, last-error surfacing, forced full resync, cache-size stats, targeted cache clear, write-queue-size badge) — per Group C of the 10-group sequence in [`docs/superpowers/specs/2026-07-18-desktop-shell-functions-and-hardening-design.md`](../specs/2026-07-18-desktop-shell-functions-and-hardening-design.md) (spec functions #21-30, `sync:*` channel namespace).

**Architecture:** No new module — this group extends the two existing files the spec names (`desktop/syncManager.js`, `desktop/localDb.js`), following the same DI-testable pattern established in Groups A/B (`localDb.js` functions take `db`/`app`/`path` as parameters where they don't already receive a module-level `db` via the existing `getLocalDb()` pattern this file already uses; `syncManager.js` functions reuse its existing module-level `serverUrl`/`isSyncing` state style). This branch is stacked on Group B's branch (`claude/desktop-hardening-group-b-file-data-io`, PR #2858, unmerged, itself stacked on unmerged Groups A/H/G).

**Tech Stack:** Plain Node.js (CommonJS), `better-sqlite3` (already a `desktop/` dependency), `node:test` + `node:assert/strict`.

## Global Constraints

- Match existing `desktop/*.js` conventions: CommonJS, no TypeScript, header comment block matching `desktop/syncManager.js`'s/`desktop/localDb.js`'s existing style.
- New `localDb.js` functions that only need the module-level `db` (the pattern `getQueueDepth`/`getPendingQueue`/etc. already use — no injected `db` parameter, they close over the module-level `db` variable set by `initLocalDb()`) should follow that SAME existing convention, not introduce a new DI style inconsistent with the rest of the file. New `syncManager.js` functions likewise reuse its existing module-level state (`isSyncing`, `serverUrl`, etc.) rather than taking it as a parameter — matching that file's established style. This is a deliberate departure from Groups A/B's stricter DI pattern: `localDb.js`/`syncManager.js` are **already** written as stateful singletons (one process-wide DB connection, one process-wide sync loop) and retrofitting full parameter-injection onto them is out of scope for this group — every *new* function here matches its *host file's* existing convention instead.
- **Scope decision on `pauseSync`/`resumeSync` (Task 1)**: rather than tearing down/rebuilding the `setInterval` timers `startPullSchedule`/`stopPullSchedule` already manage (which would require re-threading `serverUrl`/`mainWindow` through the pause/resume call sites), this plan adds a single module-level `isPaused` boolean checked at the top of `pullAll`, `pushAll`, and `pullTable` — the three functions that actually perform network I/O. The existing timers keep firing on schedule; while paused, each tick becomes a fast no-op. This is simpler, has no risk of losing timer state, and is trivially testable (call the guarded function, assert it returns early without calling `serverFetch`).
- **Scope decision on `getLastSyncError` (Task 5)**: `pullTable`'s and `pushAll`'s existing catch blocks currently only `console.warn`/`console.error` — there is no queryable "most recent sync error" today distinct from the `sync_queue` per-item error column. This plan adds one `setConfig('last_sync_error', JSON.stringify({message, at}))` call to each of those two existing catch blocks (the minimum touch to make the data available), and a new `getLastSyncError()` reader in `localDb.js` that parses that config key. This does not change either function's existing silent-fail-and-retry-on-next-interval behavior — it only additionally records what happened.
- **Scope decision on `forceFullResync` (Task 6)**: "wipe local cache" means the **mirrored/reference read cache only** (the tables `pullTable`/`replaceTable` populate from the server: `users`, `clients`, `properties`, `units`, `calls_for_service`, `incidents`, `time_entries`, `persons`, `vehicles_records`) — it must NOT touch `sync_queue` (locally-created writes not yet pushed to the server) or `gps_breadcrumbs` pending rows, since those represent real officer work that would be silently lost. This plan also resets each wiped table's `sync_metadata` row so the subsequent `pullAll()` treats every table as needing a full pull (matching `REFERENCE_TABLES`' existing `since: null` behavior, extended to all tables for this one forced cycle) rather than an incremental delta that could skip rows if the wipe raced a delta pull.
- **Scope decision on `getLocalCacheStats`'s `bytes` field (Task 7)**: SQLite has no cheap per-table byte-size query without the `dbstat` virtual table, which is a compile-time SQLite option not guaranteed present in every `better-sqlite3` build. This plan attempts `SELECT SUM(pgsize) FROM dbstat WHERE name = ?` per table inside a `try/catch`; if `dbstat` is unavailable (the query throws), `bytes` is returned as `null` for that table rather than a fabricated estimate — row counts are always accurate regardless of `dbstat` availability.
- **Scope decision on `getSyncQueueDetail`'s field mapping (Task 2)**: `sync_queue`'s schema has no column literally named `action` — this plan maps the spec's `action` field to the row's existing `method` column (e.g. `'POST'`/`'PATCH'`/`'DELETE'`, the HTTP verb queued for that write), and `failCount` to the existing `attempts` column (meaningful specifically because this function only surfaces `pending`/`failed` rows, where every recorded attempt was, by definition, not yet a success).
- Group C's flagship wiring task (Task 10, not one of the 10 spec-numbered functions but directly in this group's stated scope of extending `syncManager.js`/`localDb.js`): Group H's `upsertUserWithEncryptedHash(row)` (`desktop/localDb.js:400`) was shipped fully built and tested but never called anywhere — confirmed via `grep -n upsertUserWithEncryptedHash desktop/syncManager.js desktop/main.js` returning nothing outside `localDb.js` itself. `syncManager.js`'s `pullTable` currently pulls the `'users'` reference table through the generic `replaceTable('users', rows)` → `upsertRow('users', row)` path, which stores each row's `password_hash` value exactly as the server sent it — meaning the locally-cached password hash used by `desktop/pinManager.js`'s offline-login flow is **not** run through `safeStorage` encryption at all today, despite Group H having built exactly the function to do that. This plan wires it in.
- Commit after each task.

---

### Task 1: `pauseSync` + `resumeSync`

**Files:**
- Modify: `desktop/syncManager.js`, `desktop/__tests__/syncManager.test.js` (new test file — none exists yet for this module; check first), `desktop/main.js`, `desktop/preload.js`

**Interfaces:**
- `syncManager.js` gains a module-level `let isPaused = false;` and two exported functions: `pauseSync()` sets it `true` and logs; `resumeSync()` sets it `false` and logs. Export a getter `get isPaused() { return isPaused; }` in `module.exports` (matching the existing `get isSyncing()`/`get lastPushAt()` getter pattern already in this file) so it's externally observable for tests and for `offline:sync-status` to optionally report later.
- Add `if (isPaused) return;` as the very first line inside `pullAll()`, `pushAll()`, and `pullTable(table)` (three separate early-return guards, not one — `pullTable` is also called directly by the per-table `setInterval` timers, not only through `pullAll`).
- Wiring in `main.js`: `guardedHandle('sync:pause', () => { if (syncManager) syncManager.pauseSync(); })` and `guardedHandle('sync:resume', () => { if (syncManager) syncManager.resumeSync(); })` — matching the existing null-check-before-use pattern `offline:sync-status`/`offline:trigger-sync` already use for the lazily-initialized module-level `syncManager` variable (`main.js:172`).
- Preload: `pauseSync: () => ipcRenderer.invoke('sync:pause')`, `resumeSync: () => ipcRenderer.invoke('sync:resume')`.

- [ ] **Step 1: Write failing tests** in a new `desktop/__tests__/syncManager.test.js`: `pauseSync()` sets `isPaused` to `true`; `resumeSync()` sets it back to `false`; a call to `pullAll()` while paused resolves without calling `serverFetch` (you'll need to check how `serverFetch` is structured — it's a module-internal, non-exported function using Electron's `net` module; the simplest testable assertion is that `pullAll()` while paused does NOT call `acquireSyncLock()`'s side effects — i.e. `isSyncing` stays `false` throughout and returns fast. Check the existing `isSyncing`/`lastPushAt` getters for how to observe this without needing to mock `net`).
- [ ] **Step 2: Run tests, verify they fail.**
- [ ] **Step 3: Implement** `isPaused` state + the three early-return guards in `syncManager.js`.
- [ ] **Step 4: Run tests, verify they pass.**
- [ ] **Step 5: Wire `sync:pause`/`sync:resume` into `main.js`.**
- [ ] **Step 6: Wire into `preload.js`.**
- [ ] **Step 7: `node --check`, run the test suite, commit.**

---

### Task 2: `getSyncQueueDetail`

**Files:**
- Modify: `desktop/localDb.js`, `desktop/__tests__/localDb.test.js` (new — none exists yet; check first), `desktop/main.js`, `desktop/preload.js`

**Interfaces:**
- `getSyncQueueDetail(limit = 100)` in `localDb.js` — queries `SELECT id, table_name, method, attempts, error FROM sync_queue WHERE status IN ('pending', 'failed') ORDER BY attempts DESC, created_at ASC LIMIT ?`, maps each row to `{id, table: row.table_name, action: row.method, failCount: row.attempts, lastError: row.error}`.
- Wiring in `main.js`: `guardedHandle('sync:queue-detail', () => getSyncQueueDetail())`.
- Preload: `getSyncQueueDetail: () => ipcRenderer.invoke('sync:queue-detail')`.

- [ ] **Step 1: Write a failing test** in a new `desktop/__tests__/localDb.test.js`. Since `localDb.js` closes over a module-level `db` set by `initLocalDb()` (not dependency-injected per-function), the test needs to call `initLocalDb()` against a real temp SQLite file (use `node:test`'s `t.after` to clean up, and fake `electron`'s `app.getPath`/`safeStorage` the same way any existing Group H/A test already fakes Electron — check `desktop/__tests__/secretsStore.test.js` or similar for the established fake-Electron-module pattern used elsewhere in this repo, if `localDb.js` needs some of those at init time). Insert a few rows directly into `sync_queue` (mixing `status` values), call `getSyncQueueDetail()`, assert the mapped shape and that only `pending`/`failed` rows appear (not `synced`).
- [ ] **Step 2: Run test, verify it fails.**
- [ ] **Step 3: Implement `getSyncQueueDetail` in `localDb.js`, add to `module.exports`.**
- [ ] **Step 4: Run test, verify it passes.**
- [ ] **Step 5: Wire `sync:queue-detail` into `main.js`.**
- [ ] **Step 6: Wire into `preload.js`.**
- [ ] **Step 7: `node --check`, run the test suite, commit.**

---

### Task 3: `retryFailedSyncItem`

**Files:**
- Modify: `desktop/localDb.js`, `desktop/__tests__/localDb.test.js`, `desktop/main.js`, `desktop/preload.js`

**Interfaces:**
- `retrySyncQueueItem(id)` in `localDb.js` — first `SELECT id FROM sync_queue WHERE id = ?` to confirm the row genuinely exists (per Group G's `validateSyncQueueIdInput` doc comment: "no existence check — that's deferred to the handler itself"; this function IS that deferred existence check). If not found, returns `{ok:false, error: 'no sync queue item with that id'}`. Otherwise `UPDATE sync_queue SET status = 'pending', attempts = 0, error = NULL WHERE id = ?` (reset, not just re-flag — a fresh retry should not immediately re-trip a `attempts >= 4` "failed" threshold check elsewhere) and returns `{ok:true}`.
- Wiring in `main.js`: `guardedHandle('sync:retry-item', (event, id) => { const idCheck = validateSyncQueueIdInput(id); if (!idCheck.ok) return { ok: false, error: idCheck.error }; return retrySyncQueueItem(id); })`. `validateSyncQueueIdInput` is imported from `./security/ipcGuard` — check whether `main.js`'s existing `require('./security/ipcGuard')` destructure already includes it (it should, from Group G's own build — Group G's function was built "unwired," meaning no *handler* called it yet, but check whether it was already added to `main.js`'s import destructure anyway; if not, add it there, extending the existing line, not a new require).
- Preload: `retryFailedSyncItem: (id) => ipcRenderer.invoke('sync:retry-item', id)`.

- [ ] **Step 1: Write failing tests** for `retrySyncQueueItem`: existing failed row → reset to pending/attempts=0/error=null, returns `{ok:true}`; non-existent id → `{ok:false, error}` without touching the table.
- [ ] **Step 2: Run tests, verify they fail.**
- [ ] **Step 3: Implement `retrySyncQueueItem` in `localDb.js`, add to `module.exports`.**
- [ ] **Step 4: Run tests, verify they pass.**
- [ ] **Step 5: Wire `sync:retry-item` into `main.js`**, confirming `validateSyncQueueIdInput` is available (add to the existing `ipcGuard` require destructure if it's missing).
- [ ] **Step 6: Wire into `preload.js`.**
- [ ] **Step 7: `node --check`, run the test suite, commit.**

---

### Task 4: `clearFailedSyncItems`

**Files:**
- Modify: `desktop/localDb.js`, `desktop/__tests__/localDb.test.js`, `desktop/main.js`, `desktop/preload.js`

**Interfaces:**
- `clearFailedSyncItems()` in `localDb.js` — `DELETE FROM sync_queue WHERE status = 'failed'`, returns `{cleared: result.changes}` (`better-sqlite3`'s `.run()` result exposes `.changes` — the actual row count affected).
- Wiring in `main.js`: `guardedHandle('sync:clear-failed', () => clearFailedSyncItems())`.
- Preload: `clearFailedSyncItems: () => ipcRenderer.invoke('sync:clear-failed')`.

- [ ] **Step 1: Write a failing test**: seed 2 `failed` + 1 `pending` + 1 `synced` row, call `clearFailedSyncItems()`, assert `{cleared: 2}` and that only the 2 `failed` rows are gone (pending/synced rows untouched).
- [ ] **Step 2: Run test, verify it fails.**
- [ ] **Step 3: Implement, add to `module.exports`.**
- [ ] **Step 4: Run test, verify it passes.**
- [ ] **Step 5: Wire `sync:clear-failed` into `main.js`.**
- [ ] **Step 6: Wire into `preload.js`.**
- [ ] **Step 7: `node --check`, run the test suite, commit.**

---

### Task 5: `getLastSyncError`

**Files:**
- Modify: `desktop/localDb.js`, `desktop/syncManager.js`, `desktop/__tests__/localDb.test.js`, `desktop/main.js`, `desktop/preload.js`

**Interfaces:**
- `getLastSyncError()` in `localDb.js` — reads `getConfig('last_sync_error')`; if unset, returns `null`; otherwise `JSON.parse`s the stored value and returns `{message, at}`. If the stored value is somehow malformed JSON (shouldn't happen given this plan controls the only writer, but defend anyway), catch the parse error and return `null` rather than throwing.
- In `syncManager.js`: in `pullTable`'s existing `catch (err) { console.warn(...); }` block, add `setConfig('last_sync_error', JSON.stringify({ message: err.message, at: new Date().toISOString() }));` as the first line of that catch block (before the existing console.warn, order doesn't matter functionally, but keep the existing log line — do not remove it). Do the same in `pushAll`'s per-batch `catch (err) { ... }` block (the one that currently does `console.error('[SYNC] Batch push failed:', err.message);` and marks queue items). Do NOT add this to `pullSecrets`'s catch block — that's a distinct concern (offline-PIN secret refresh, not table sync) and conflating it here isn't what this function is for.
- Wiring in `main.js`: `guardedHandle('sync:last-error', () => getLastSyncError())`.
- Preload: `getLastSyncError: () => ipcRenderer.invoke('sync:last-error')`.

- [ ] **Step 1: Write failing tests** for `getLastSyncError`: unset config key → `null`; a well-formed `setConfig('last_sync_error', JSON.stringify({message:'x', at:'2026-01-01T00:00:00Z'}))` → returns the parsed object; malformed JSON in that key → `null`, not a throw.
- [ ] **Step 2: Run tests, verify they fail.**
- [ ] **Step 3: Implement `getLastSyncError` in `localDb.js`, add to `module.exports`. Add the two `setConfig` calls to `syncManager.js`'s existing catch blocks** (this is a small, surgical edit to existing code — read both catch blocks' exact current content first via Read, don't guess at line numbers).
- [ ] **Step 4: Run tests, verify they pass.**
- [ ] **Step 5: Wire `sync:last-error` into `main.js`.**
- [ ] **Step 6: Wire into `preload.js`.**
- [ ] **Step 7: `node --check` on all touched files, run the test suite, commit.**

---

### Task 6: `forceFullResync`

**Files:**
- Modify: `desktop/syncManager.js`, `desktop/localDb.js`, `desktop/__tests__/localDb.test.js`, `desktop/main.js`, `desktop/preload.js`

**Interfaces:**
- `wipeMirroredCacheTables()` in `localDb.js` — inside a single `db.transaction()`, for each table in a new exported constant `MIRRORED_CACHE_TABLES = ['users', 'clients', 'properties', 'units', 'calls_for_service', 'incidents', 'time_entries', 'persons', 'vehicles_records']` (the exact set `syncManager.js`'s `PULL_INTERVALS` keys already name — read that object first and use the SAME table list, don't hand-type a second copy that could drift; export `MIRRORED_CACHE_TABLES` from wherever makes more sense — likely `localDb.js`, with `syncManager.js` importing it, OR keep `PULL_INTERVALS`'s keys as the single source of truth and have `localDb.js`'s function accept the table list as a parameter from its caller in `syncManager.js`, since `syncManager.js` already owns that list. **Your call as implementer — pick whichever avoids duplicating the table list, and document which file you made the source of truth.**): `DELETE FROM ${table}` and `DELETE FROM sync_metadata WHERE table_name = ?`. Does NOT touch `sync_queue` or `gps_breadcrumbs` (per the Global Constraints scope decision above — these hold local unsynced writes, not cached reads).
- `forceFullResync()` in `syncManager.js` — calls the wipe function, then calls `pullAll()` (already exported, already handles the sync-lock/progress-emit/full-pull cycle — since every table's `sync_metadata` row is now gone, `pullTable`'s `meta.last_pull_at` will be `null` for every table, and reference tables already ignore it (`since: isReference ? null : meta.last_pull_at`) — for the *non*-reference tables this means their next pull is effectively a full pull too, since `since: null` server-side should mean "everything," matching this task's "full re-pull" requirement). Returns `{ok: true}` once `pullAll()` resolves (or `{ok:false, error}` if `pullAll()` throws — wrap in try/catch, `pullAll()` doesn't currently throw on its own per-table failures since those are swallowed internally, so this is mostly defensive).
- Wiring in `main.js`: `guardedHandle('sync:force-full', async () => { if (!syncManager) return { ok: false, error: 'sync not initialized' }; return syncManager.forceFullResync(); })`.
- Preload: `forceFullResync: () => ipcRenderer.invoke('sync:force-full')`.

- [ ] **Step 1: Write a failing test** for the wipe function: seed rows in a couple of the mirrored tables plus a `sync_queue` row and a `sync_metadata` row, call it, assert the mirrored tables and their `sync_metadata` rows are empty, and assert the `sync_queue` row is UNTOUCHED (this is the load-bearing assertion for the scope decision above — do not skip it).
- [ ] **Step 2: Run test, verify it fails.**
- [ ] **Step 3: Implement the wipe function in `localDb.js` and `forceFullResync` in `syncManager.js`.**
- [ ] **Step 4: Run test, verify it passes.**
- [ ] **Step 5: Wire `sync:force-full` into `main.js`.**
- [ ] **Step 6: Wire into `preload.js`.**
- [ ] **Step 7: `node --check` on all touched files, run the test suite, commit.**

---

### Task 7: `getLocalCacheStats`

**Files:**
- Modify: `desktop/localDb.js`, `desktop/__tests__/localDb.test.js`, `desktop/main.js`, `desktop/preload.js`

**Interfaces:**
- `getLocalCacheStats()` in `localDb.js` — for each table in the same table-list source-of-truth established in Task 6 (extend it if there are other locally-meaningful tables worth reporting, e.g. `sync_queue`/`gps_breadcrumbs` themselves are reasonable to include in a cache-stats view even though they're excluded from the *wipe* — your call, but if you include them, they must NOT be wiped by Task 6's function, only reported here): `rows = db.prepare('SELECT COUNT(*) as c FROM ' + table).get().c`; `bytes` via `try { db.prepare('SELECT SUM(pgsize) as b FROM dbstat WHERE name = ?').get(table)?.b ?? null } catch { null }` (per the Global Constraints scope decision — `dbstat` may not exist in this SQLite build). Returns `Array<{table, rows, bytes}>`.
- Wiring in `main.js`: `guardedHandle('sync:cache-stats', () => getLocalCacheStats())`.
- Preload: `getLocalCacheStats: () => ipcRenderer.invoke('sync:cache-stats')`.

- [ ] **Step 1: Write a failing test**: seed a few rows in one or two tables, call `getLocalCacheStats()`, assert row counts are correct for every table in the list (including empty ones — `rows: 0`), and assert the function does not throw regardless of whether `dbstat` is available in the test's `better-sqlite3` build (assert `bytes` is either a number or `null`, not that it's a *specific* value, since `dbstat` availability is environment-dependent).
- [ ] **Step 2: Run test, verify it fails.**
- [ ] **Step 3: Implement, add to `module.exports`.**
- [ ] **Step 4: Run test, verify it passes.**
- [ ] **Step 5: Wire `sync:cache-stats` into `main.js`.**
- [ ] **Step 6: Wire into `preload.js`.**
- [ ] **Step 7: `node --check`, run the test suite, commit.**

---

### Task 8: `clearLocalCache`

**Files:**
- Modify: `desktop/localDb.js`, `desktop/__tests__/localDb.test.js`, `desktop/main.js`, `desktop/preload.js`

**Interfaces:**
- `clearLocalCache(table)` in `localDb.js` — validates `table` against the SAME table-list source-of-truth from Task 6 (an allowlist — reject anything not in that list with `{ok:false, error: 'unknown or non-clearable table'}` BEFORE ever building a SQL string with it, same SQL-injection-via-identifier discipline `syncManager.js`'s existing `ALLOWED_SYNC_TABLES` check already demonstrates at `syncManager.js` around its `UPDATE ${item.table_name}` call site — read that existing code for the established pattern). If allowed: `DELETE FROM ${table}` + clear that table's `sync_metadata` row (same as Task 6's per-table wipe step, but for exactly one table, not all of them), returns `{ok:true}`.
- Wiring in `main.js`: `guardedHandle('sync:clear-cache', (event, table) => clearLocalCache(table))`.
- Preload: `clearLocalCache: (table) => ipcRenderer.invoke('sync:clear-cache', table)`.

- [ ] **Step 1: Write failing tests**: a table in the allowlist → cleared, returns `{ok:true}`; a table NOT in the allowlist (e.g. `'sqlite_master'`, or a made-up name) → `{ok:false, error}`, and critically, assert NO SQL was executed against the real tables (e.g. seed a row in some unrelated real table first, call `clearLocalCache('not-a-real-table; DROP TABLE users;--')` or similar, assert that table's rows are untouched) — this is the security-relevant test for this task, do not skip it.
- [ ] **Step 2: Run tests, verify they fail.**
- [ ] **Step 3: Implement, add to `module.exports`.**
- [ ] **Step 4: Run tests, verify they pass.**
- [ ] **Step 5: Wire `sync:clear-cache` into `main.js`.**
- [ ] **Step 6: Wire into `preload.js`.**
- [ ] **Step 7: `node --check`, run the test suite, commit.**

---

### Task 9: `getOfflineWriteQueueSize`

**Files:**
- Modify: `desktop/main.js`, `desktop/preload.js`

**Interfaces:**
- Wiring in `main.js`: `guardedHandle('sync:write-queue-size', () => getQueueDepth())` — `getQueueDepth` already exists and is already imported in `main.js` (check — it's used by `offline:sync-status` already, per the code read earlier in this plan's research). This is a trivial one-line wrapper, no new `localDb.js`/`syncManager.js` function, no validation needed (no user input).
- Preload: `getOfflineWriteQueueSize: () => ipcRenderer.invoke('sync:write-queue-size')`.

- [ ] **Step 1: Confirm `getQueueDepth` is already imported in `main.js`** (it should be, from the existing `offline:sync-status` handler's use of it) — if for some reason it isn't in scope where you're adding this new handler, extend the existing `require('./localDb')` destructure, do not add a new require line.
- [ ] **Step 2: Wire `sync:write-queue-size` into `main.js`.**
- [ ] **Step 3: Wire into `preload.js`.**
- [ ] **Step 4: `node --check`, commit.**

---

### Task 10: Wire `upsertUserWithEncryptedHash` into the `users` table pull path (Group H deferral)

**Files:**
- Modify: `desktop/localDb.js`, `desktop/syncManager.js`, `desktop/__tests__/localDb.test.js` (or `syncManager.test.js`, whichever already has a relevant fixture — your call), `desktop/__tests__/syncManager.test.js`

**Background:** `replaceTable(tableName, rows)` (`localDb.js:364`) is a generic bulk-replace used for every reference table, calling `upsertRow(tableName, row)` per row — no field-specific handling. `upsertUserWithEncryptedHash(row)` (`localDb.js:400`) already exists, is already tested, and already correctly wraps a row's `password_hash` through `encryptPasswordHashForCache`/`safeStorage` before calling `upsertRow('users', ...)` — but nothing calls it. `syncManager.js`'s `pullTable` currently calls generic `replaceTable(table, response.rows)` for every reference table including `'users'`, so cached password hashes arrive and are stored in plaintext-as-sent-by-server.

**Interfaces:**
- Add a new function `replaceUsersTable(rows)` to `localDb.js`: same transactional shape as `replaceTable` (`DELETE FROM users` inside a `db.transaction()`, then loop calling `upsertUserWithEncryptedHash(row)` instead of generic `upsertRow('users', row)` per row, then `updateSyncMeta('users', rows.length)` — mirror `replaceTable`'s existing structure exactly, just swap the per-row upsert call). Export it.
- In `syncManager.js`'s `pullTable`, change the existing `if (response.fullReplace) { replaceTable(table, response.rows); }` branch to special-case `'users'`: `if (response.fullReplace) { if (table === 'users') { replaceUsersTable(response.rows); } else { replaceTable(table, response.rows); } }`. Import `replaceUsersTable` from `./localDb` (extend the existing require destructure in `syncManager.js` — check its current import line first, do not add a duplicate).
- **Note on `deltaSync`'s path** (the `else` branch, for non-`fullReplace` responses): `'users'` is a `REFERENCE_TABLE` and reference tables always request `since: null` (full replace), so in practice `'users'` should always arrive via the `fullReplace` branch, never `deltaSync`. Confirm this is actually true by reading `pullTable`'s current logic once more before deciding whether `deltaSync` also needs a `'users'`-specific branch — if reference tables are guaranteed to always full-replace, leave `deltaSync` as-is and document why in your task report; do not add unreachable dead code for a path that can't occur.

- [ ] **Step 1: Read `replaceTable`'s exact current implementation** (`localDb.js`) and `pullTable`'s exact current implementation (`syncManager.js`) in full before writing anything — this task rewires existing, working code paths and needs to preserve their transactional/error-handling behavior exactly, just substituting the per-row upsert call for the `'users'` table.
- [ ] **Step 2: Write a failing test** for `replaceUsersTable`: seed `users` with an existing row, call `replaceUsersTable([{id:1, username:'x', password_hash:'plaintext-hash-value', ...other required columns}])`, assert the table now has exactly that row AND that the stored `password_hash` value is NOT the literal string `'plaintext-hash-value'` (i.e., it went through encryption) — use a fake `safeStorage` if `encryptPasswordHashForCache`'s existing tests already establish that pattern (check `desktop/__tests__/secretsStore.test.js` or wherever Group H's tests for this function live, and reuse the same fake rather than inventing a new one).
- [ ] **Step 3: Run test, verify it fails.**
- [ ] **Step 4: Implement `replaceUsersTable` in `localDb.js`, add to `module.exports`.**
- [ ] **Step 5: Run test, verify it passes.**
- [ ] **Step 6: Update `pullTable` in `syncManager.js`** to special-case `'users'` as described above. Add a test (in `syncManager.test.js`) confirming `pullTable('users', ...)`-style logic dispatches to `replaceUsersTable` rather than `replaceTable` for that one table specifically — this may require refactoring `pullTable` slightly to make the dispatch testable without a real network call (e.g. extract the `if (response.fullReplace) {...}` block into its own small testable function taking `table`/`rows` — use your judgment on the minimal refactor needed, but don't over-engineer a large restructure of `pullTable` for this).
- [ ] **Step 7: Run the full test suite, `node --check` on both files, commit.**

---

### Task 11: Final verification pass

**Files:** none (verification only, no production code changes)

- [ ] Run the full `desktop` test suite: `node --test desktop/__tests__/*.test.js` — expect all prior-group tests still passing plus the new `syncManager.test.js`/`localDb.test.js` cases.
- [ ] `node --check` on every file touched this group: `main.js`, `preload.js`, `syncManager.js`, `localDb.js`.
- [ ] Confirm exactly 10 new `sync:*` channels are registered in `main.js` (`grep -c "guardedHandle('sync:" desktop/main.js`) and that all 10 are exposed in `preload.js`.
- [ ] Confirm `auditIpcHandlerRegistry` has nothing new to flag (still a bypass-scan, not a per-channel allowlist — reconfirm this hasn't changed rather than assuming it holds from prior groups).
- [ ] Confirm no duplicate `require(...)` lines were introduced across all of Tasks 1-10 for `./security/ipcGuard`, `./localDb`, or `./syncManager` in `main.js`, and no duplicate `require('./localDb')` in `syncManager.js`.
- [ ] Update the progress ledger, mark Group C complete.
