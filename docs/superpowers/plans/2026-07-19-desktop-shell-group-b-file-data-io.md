# Desktop Shell — Group B (File & Data Export/Import) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `desktop/fileOps.js` — the 10 File & Data Export/Import functions for the RMPG Flex desktop shell (save/open dialogs, export/import file I/O, reveal-in-folder, encrypted local-DB backup/restore, downloads-path lookup, printer enumeration, silent printing) — per Group B of the 10-group sequence in [`docs/superpowers/specs/2026-07-18-desktop-shell-functions-and-hardening-design.md`](../specs/2026-07-18-desktop-shell-functions-and-hardening-design.md) (spec functions #11-20, `fs:*` channel namespace).

**Architecture:** A single new module, `desktop/fileOps.js`, following the same DI pattern as `desktop/systemInfo.js` (Group A) — every OS/Electron-touching function takes its dependency (`fs`, `dialog`, `shell`, `app`, `safeStorage`, a `better-sqlite3` `Database` instance) as a parameter, so the pure decision/shaping logic is unit-tested with fakes in `desktop/__tests__/fileOps.test.js`, and the thin `main.js` wiring layer does the real `require()`s and `guardedHandle` registration. This branch is stacked on Group A's branch (`claude/desktop-hardening-group-a-system-diagnostics`, PR #2857, unmerged, itself stacked on Group H's unmerged PR #2854) — Group B is the first group to actually wire two previously-"unwired, for a future group" functions: Group G's `validateFilePathInput` (Task 7 in the Group G plan) and Group H's `validateBackupFileBeforeImport` (Task 9 in the Group H plan).

**Tech Stack:** Plain Node.js (CommonJS), Node's `fs`/`path` built-ins, Electron's `app`/`dialog`/`shell`/`safeStorage`/`webContents`, `better-sqlite3`'s `Database#backup()`, `node:test` + `node:assert/strict`.

## Global Constraints

- Match existing `desktop/*.js` conventions: CommonJS, no TypeScript, header comment block matching `desktop/systemInfo.js`'s style.
- Every function must be unit-testable with zero real Electron/OS runtime — dependencies are always parameters, never `require('electron')`/`require('fs')` called directly inside a testable function body. The thin `main.js` wiring layer is where the real `require`s happen.
- **Scope decision on path validation (Tasks 2-4, 9)**: `validateFilePathInput(candidatePath, allowedRoots)` (Group G, `desktop/security/ipcGuard.js:119`) requires a fixed list of allowed root directories. `fs:write-export`/`fs:read-import`/`fs:reveal`/`fs:import-db-backup` all receive a `path` argument directly over IPC from the renderer — even though the *intended* flow is that this path always originates from a prior `saveFileDialog`/`openFileDialog` result (a path the user explicitly picked via a native OS dialog), the raw IPC handler cannot assume that: a compromised renderer can call these channels directly with an arbitrary string. Per Group G's own stated threat model ("no arbitrary filesystem write via a crafted path"), every one of these four handlers validates its `path` argument against `allowedRoots = [app.getPath('downloads'), app.getPath('documents'), app.getPath('desktop'), app.getPath('temp'), app.getPath('userData')]` before touching the filesystem. **Known trade-off, flagged rather than silently absorbed**: this is narrower than "anywhere the native save dialog can reach" (e.g. a user explicitly choosing a USB drive or network share via the OS dialog would be rejected) — a deliberate v1 defense-in-depth choice, not an oversight. Flag this for reviewer attention and the eventual PR body.
- **Scope decision on `exportLocalDbBackup`/`importLocalDbBackup` (Tasks 8-9)**: the local cache runs in WAL mode (`desktop/localDb.js:34`), so a raw `fs.copyFile` of the `.db` file alone could miss committed-but-not-checkpointed data sitting in the `-wal` sidecar. `better-sqlite3`'s `Database#backup(destinationFile)` (available since v7, present here via `better-sqlite3 ^12.11.1`) performs a live, WAL-safe backup via SQLite's own backup API and returns a Promise — this plan uses it instead of a manual file copy. Implementer for Task 8: after `npm install` in this worktree, confirm `typeof db.backup === 'function'` before writing the implementation; if the installed version's API differs from this assumption, stop and report NEEDS_CONTEXT rather than guessing.
- **Scope decision on backup encryption (Tasks 8-9)**: Group H's `encryptSecretForStorage(plaintext, safeStorage)`/`decryptSecretForStorage(ciphertextBase64, safeStorage)` (`desktop/security/secretsStore.js:19,30`) operate on strings only (they wrap `safeStorage.encryptString`/`decryptString`). The raw SQLite backup file is binary. This plan base64-encodes the raw backup bytes into a string, encrypts that string, and writes the resulting ciphertext (itself base64 text) to the `.rmpgbak` file chosen via `saveFileDialog` — the inverse on import. This mirrors the same string-wrapping approach `desktop/localDb.js`'s `encryptPasswordHashForCache` already uses for non-string secrets.
- **Scope decision on `printSilently` (Task 7)**: Electron's `webContents.print(options, callback)` is callback-based (no native Promise return in the Electron version pinned by this repo's `package.json`) — this plan wraps it in a `new Promise(...)` inside the `main.js` wiring layer, matching the async-handler pattern already established for `sys:battery`/`sys:export-diagnostics`.
- `desktop/localDb.js` gains one new small exported helper, `getLocalDbPath(appModule, pathModule)`, so `fileOps.js` (Task 8/9) and `localDb.js` itself share one source of truth for the DB file location instead of duplicating the `path.join(app.getPath('userData'), 'rmpg-local.db')` computation. This is the smallest possible change to that file — no other `localDb.js` behavior changes.
- Commit after each task.

---

### Task 1: `saveFileDialog` + `openFileDialog`

**Files:**
- Create: `desktop/fileOps.js`
- Test: `desktop/__tests__/fileOps.test.js`

**Interfaces:**
- `buildSaveDialogOptions({ defaultPath, filters })` — pure. Returns `{ defaultPath: defaultPath || undefined, filters: filters || [] }` (Electron's `dialog.showSaveDialog` options shape).
- `buildOpenDialogOptions({ filters, multi })` — pure. Returns `{ filters: filters || [], properties: multi ? ['openFile', 'multiSelections'] : ['openFile'] }`.
- Wiring in `main.js`: `guardedHandle('fs:save-dialog', async (event, opts) => { const result = await dialog.showSaveDialog(mainWindow, buildSaveDialogOptions(opts || {})); return result.canceled ? null : result.filePath; })` and `guardedHandle('fs:open-dialog', async (event, opts) => { const result = await dialog.showOpenDialog(mainWindow, buildOpenDialogOptions(opts || {})); return result.canceled ? null : result.filePaths; })`.
- Preload: `saveFileDialog: (opts) => ipcRenderer.invoke('fs:save-dialog', opts)`, `openFileDialog: (opts) => ipcRenderer.invoke('fs:open-dialog', opts)`.

- [ ] **Step 1: Write failing tests** for `buildSaveDialogOptions`/`buildOpenDialogOptions` in `desktop/__tests__/fileOps.test.js`: default `filters: []` when omitted, `defaultPath` passthrough, `multi: true` produces `['openFile', 'multiSelections']`, `multi` omitted/false produces `['openFile']`.
- [ ] **Step 2: Run tests, verify they fail** (`Cannot find module '../fileOps'`).
- [ ] **Step 3: Implement** `desktop/fileOps.js` with the two pure functions + `module.exports`.
- [ ] **Step 4: Run tests, verify they pass.**
- [ ] **Step 5: Wire into `main.js`**: add `const { buildSaveDialogOptions, buildOpenDialogOptions } = require('./fileOps');` near the other capability-module requires, add the two `guardedHandle` registrations described above (use the existing `mainWindow` reference already in scope for other dialog-adjacent code in the file — check `dialog.showErrorBox` call site at ~line 2965 for how the file references the main window, if at all; `dialog.showSaveDialog`/`showOpenDialog` accept an optional `BrowserWindow` as first arg to make the dialog modal to it — pass it if a suitable in-scope reference exists, otherwise call the two-arg form without a parent window).
- [ ] **Step 6: Wire into `preload.js`**: add the two `ipcRenderer.invoke` passthroughs next to the existing `sys:*` block.
- [ ] **Step 7: `node --check` both files, run the full `fileOps.test.js` suite, commit.**

---

### Task 2: `writeExportFile`

**Files:**
- Modify: `desktop/fileOps.js`, `desktop/__tests__/fileOps.test.js`, `desktop/main.js`, `desktop/preload.js`

**Interfaces:**
- `resolveAllowedRoots(appModule)` — pure-ish (takes `app` as a param, calls its `getPath` method, no other side effects). Returns `[appModule.getPath('downloads'), appModule.getPath('documents'), appModule.getPath('desktop'), appModule.getPath('temp'), appModule.getPath('userData')]`. Exported once here; reused by Tasks 3/4/9.
- Wiring in `main.js`: `guardedHandle('fs:write-export', async (event, targetPath, data) => { const validation = validateFilePathInput(targetPath, resolveAllowedRoots(app)); if (!validation.ok) return { ok: false, error: validation.error }; try { await fs.promises.writeFile(validation.resolved, data); return { ok: true }; } catch (err) { return { ok: false, error: err.message }; } })`. `validateFilePathInput` is imported from `./security/ipcGuard` (already required in `main.js` for existing Group G wiring — confirm the existing import line and extend its destructure rather than adding a duplicate `require`, the exact mistake fixed in Group A's final review).
- Preload: `writeExportFile: (path, data) => ipcRenderer.invoke('fs:write-export', path, data)`.

- [ ] **Step 1: Write failing test** for `resolveAllowedRoots`: fake `app` with a `getPath` stub returning `{name}-path` per call, assert the 5 roots come back in the documented order.
- [ ] **Step 2: Run test, verify it fails.**
- [ ] **Step 3: Implement `resolveAllowedRoots` in `fileOps.js`, export it.**
- [ ] **Step 4: Run test, verify it passes.**
- [ ] **Step 5: Wire `fs:write-export` into `main.js`** exactly as above. Confirm (via `grep -n "require('./security/ipcGuard')" desktop/main.js`) whether `validateFilePathInput` is already destructured from an existing `ipcGuard` require line; if so, add it to that line's destructure rather than adding a new `require` line.
- [ ] **Step 6: Wire into `preload.js`.**
- [ ] **Step 7: `node --check`, run `fileOps.test.js`, commit.**

---

### Task 3: `readImportFile`

**Files:**
- Modify: `desktop/fileOps.js`, `desktop/__tests__/fileOps.test.js`, `desktop/main.js`, `desktop/preload.js`

**Interfaces:**
- Reuses `resolveAllowedRoots` from Task 2 — no new pure function needed in `fileOps.js` for this task (the handler is thin enough that the validate+read logic lives directly in the `main.js` wiring, matching how Group A's simplest wrapper tasks (`getDownloadsPath`-equivalent) were handled).
- Wiring in `main.js`: `guardedHandle('fs:read-import', async (event, sourcePath) => { const validation = validateFilePathInput(sourcePath, resolveAllowedRoots(app)); if (!validation.ok) return { ok: false, error: validation.error }; try { const data = await fs.promises.readFile(validation.resolved); return { ok: true, data }; } catch (err) { return { ok: false, error: err.message }; } })`. `data` is returned as a raw `Buffer` — Electron's structured-clone IPC serialization supports `Buffer` directly, no base64 round-trip needed for this channel (unlike the backup encrypt/decrypt path in Tasks 8-9, which needs a string for `safeStorage`).
- Preload: `readImportFile: (path) => ipcRenderer.invoke('fs:read-import', path)`.

- [ ] **Step 1: Add a `desktop/fileOps.js` unit test only if there is new pure logic to test.** Since this task's only new code is the thin `main.js` handler (no new pure exported function), skip straight to wiring — do not manufacture a placeholder pure function just to have something to unit-test. Note this explicitly in the task report so the reviewer does not flag "missing test" as a gap.
- [ ] **Step 2: Wire `fs:read-import` into `main.js`** exactly as above.
- [ ] **Step 3: Wire into `preload.js`.**
- [ ] **Step 4: `node --check` on `main.js`, commit.**

---

### Task 4: `revealInFolder`

**Files:**
- Modify: `desktop/main.js`, `desktop/preload.js`

**Interfaces:**
- Wiring in `main.js`: `guardedHandle('fs:reveal', (event, targetPath) => { const validation = validateFilePathInput(targetPath, resolveAllowedRoots(app)); if (!validation.ok) { console.error('[FS:REVEAL] Rejected path:', validation.error); return; } shell.showItemInFolder(validation.resolved); })`. Void return per spec (`(path) => void`) — on validation failure, logs and no-ops rather than throwing, consistent with the fail-safe/no-crash pattern used throughout Groups A/F/H.
- Preload: `revealInFolder: (path) => ipcRenderer.invoke('fs:reveal', path)`.

- [ ] **Step 1: Wire `fs:reveal` into `main.js`** exactly as above (no new pure `fileOps.js` function — same "thin wiring only" note as Task 3).
- [ ] **Step 2: Wire into `preload.js`.**
- [ ] **Step 3: `node --check`, commit.**

---

### Task 5: `getDownloadsPath`

**Files:**
- Modify: `desktop/main.js`, `desktop/preload.js`

**Interfaces:**
- Wiring in `main.js`: `guardedHandle('fs:downloads-path', () => app.getPath('downloads'))`. Trivial one-line wrapper, no new `fileOps.js` function, no validation needed (no user input).
- Preload: `getDownloadsPath: () => ipcRenderer.invoke('fs:downloads-path')`.

- [ ] **Step 1: Wire `fs:downloads-path` into `main.js`.**
- [ ] **Step 2: Wire into `preload.js`.**
- [ ] **Step 3: `node --check`, commit.**

---

### Task 6: `getPrinters`

**Files:**
- Modify: `desktop/fileOps.js`, `desktop/__tests__/fileOps.test.js`, `desktop/main.js`, `desktop/preload.js`

**Interfaces:**
- `formatPrinters(rawPrinterList)` — pure. Input matches Electron's `webContents.getPrintersAsync()` resolved shape (`Array<{name, displayName, description, status, isDefault, options}>`); output is `Array<{name, isDefault}>` per spec signature, mapped 1:1, preserving order.
- Wiring in `main.js`: `guardedHandle('fs:printers', async (event) => formatPrinters(await event.sender.getPrintersAsync()))`.
- Preload: `getPrinters: () => ipcRenderer.invoke('fs:printers')`.

- [ ] **Step 1: Write failing test** for `formatPrinters`: 3-element fake raw list (one `isDefault: true`), assert output shape/order/field-subset.
- [ ] **Step 2: Run test, verify it fails.**
- [ ] **Step 3: Implement `formatPrinters` in `fileOps.js`, export it.**
- [ ] **Step 4: Run test, verify it passes.**
- [ ] **Step 5: Wire `fs:printers` into `main.js`.**
- [ ] **Step 6: Wire into `preload.js`.**
- [ ] **Step 7: `node --check`, run `fileOps.test.js`, commit.**

---

### Task 7: `printSilently`

**Files:**
- Modify: `desktop/fileOps.js`, `desktop/__tests__/fileOps.test.js`, `desktop/main.js`, `desktop/preload.js`

**Interfaces:**
- `isKnownPrinterName(printerName, formattedPrinterList)` — pure. Returns `boolean`; used to validate the renderer-supplied `printerName` against the real, just-fetched printer list before ever calling `webContents.print()` with it (mirrors Group G's "validate against real rows" pattern already used for `validateSyncQueueIdInput`'s doc comment intent, applied here to printer names instead of DB rows).
- Wiring in `main.js`:
  ```js
  guardedHandle('fs:print-silent', async (event, printerName) => {
    const printers = formatPrinters(await event.sender.getPrintersAsync());
    if (!isKnownPrinterName(printerName, printers)) {
      return { ok: false, error: `unknown printer: ${printerName}` };
    }
    return new Promise((resolve) => {
      event.sender.print({ silent: true, deviceName: printerName }, (success, failureReason) => {
        resolve(success ? { ok: true } : { ok: false, error: failureReason });
      });
    });
  });
  ```
- Preload: `printSilently: (printerName) => ipcRenderer.invoke('fs:print-silent', printerName)`.

- [ ] **Step 1: Write failing test** for `isKnownPrinterName`: known name → `true`, unknown name → `false`, empty list → `false`.
- [ ] **Step 2: Run test, verify it fails.**
- [ ] **Step 3: Implement `isKnownPrinterName` in `fileOps.js`, export it.**
- [ ] **Step 4: Run test, verify it passes.**
- [ ] **Step 5: Wire `fs:print-silent` into `main.js`** exactly as above.
- [ ] **Step 6: Wire into `preload.js`.**
- [ ] **Step 7: `node --check`, run `fileOps.test.js`, commit.**

---

### Task 8: `exportLocalDbBackup`

**Files:**
- Modify: `desktop/localDb.js` (add `getLocalDbPath`), `desktop/fileOps.js`, `desktop/__tests__/fileOps.test.js`, `desktop/main.js`, `desktop/preload.js`

**Interfaces:**
- `desktop/localDb.js`: add `function getLocalDbPath(appModule, pathModule) { return pathModule.join(appModule.getPath('userData'), 'rmpg-local.db'); }`, add to `module.exports`. Refactor `initLocalDb()`'s existing inline `path.join(dbDir, 'rmpg-local.db')` (lines 23-24) to call this new function instead, so there is exactly one place the filename `'rmpg-local.db'` is written — do not leave the old inline computation duplicated alongside the new helper.
- `desktop/fileOps.js`: `encodeBackupForExport(rawDbBytes, safeStorageModule)` — pure-ish (takes `safeStorage` as param). `Buffer.isBuffer(rawDbBytes)` check → base64-encodes `rawDbBytes` to a string → calls Group H's `encryptSecretForStorage(base64String, safeStorageModule)` (imported from `./security/secretsStore`) → returns the resulting ciphertext string. Throws `TypeError` if `rawDbBytes` is not a Buffer (mirrors `encryptSecretForStorage`'s own throw-on-bad-type style).
- Wiring in `main.js`:
  ```js
  guardedHandle('fs:export-db-backup', async () => {
    const dialogResult = await dialog.showSaveDialog(mainWindow, {
      defaultPath: `rmpg-flex-backup-${Date.now()}.rmpgbak`,
      filters: [{ name: 'RMPG Flex Backup', extensions: ['rmpgbak'] }],
    });
    if (dialogResult.canceled) return { ok: false, error: 'cancelled' };
    const tempPath = path.join(app.getPath('temp'), `rmpg-db-backup-${Date.now()}.db`);
    try {
      await getLocalDb().backup(tempPath);
      const rawBytes = await fs.promises.readFile(tempPath);
      const encoded = encodeBackupForExport(rawBytes, safeStorage);
      await fs.promises.writeFile(dialogResult.filePath, encoded, 'utf8');
      return { ok: true, path: dialogResult.filePath };
    } catch (err) {
      return { ok: false, error: err.message };
    } finally {
      fs.promises.unlink(tempPath).catch(() => {});
    }
  });
  ```
  `getLocalDb` is imported from `./localDb` (check whether `main.js` already requires `./localDb` for another purpose — likely yes, given `syncManager.js`/`offlineRouter.js` depend on it — extend the existing destructure rather than adding a new require line, same duplicate-require discipline as Task 2).
- Preload: `exportLocalDbBackup: () => ipcRenderer.invoke('fs:export-db-backup')`.

- [ ] **Step 1: Preflight** — after `npm install` in this worktree, run `node -e "console.log(typeof require('better-sqlite3').prototype.backup)"` from `desktop/`. Expect `'function'`. If not, STOP and report NEEDS_CONTEXT with the actual output rather than proceeding on a wrong assumption.
- [ ] **Step 2: Write failing test** for `encodeBackupForExport`: fake `safeStorage` (`{ isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from('enc:' + s) }`), assert output is `Buffer.from('enc:' + rawBytes.toString('base64')).toString('base64')` (i.e., trace through `encryptSecretForStorage`'s real base64-of-encrypted-bytes behavior using the fake); assert `TypeError` thrown for a non-Buffer input.
- [ ] **Step 3: Run test, verify it fails.**
- [ ] **Step 4: Add `getLocalDbPath` to `localDb.js`** and refactor `initLocalDb()` to use it (Step 4a — separate sub-commit-worthy change, but keep it in this task's single commit per the Global Constraints "commit after each task" rule; do not split into two commits for one task).
- [ ] **Step 5: Implement `encodeBackupForExport` in `fileOps.js`**, importing `encryptSecretForStorage` from `./security/secretsStore`.
- [ ] **Step 6: Run test, verify it passes.**
- [ ] **Step 7: Wire `fs:export-db-backup` into `main.js`** exactly as above.
- [ ] **Step 8: Wire into `preload.js`.**
- [ ] **Step 9: `node --check` on `main.js` + `localDb.js` + `fileOps.js`, run full `fileOps.test.js` + `localDb`-related existing tests if any exist, commit.**

---

### Task 9: `importLocalDbBackup`

**Files:**
- Modify: `desktop/fileOps.js`, `desktop/__tests__/fileOps.test.js`, `desktop/main.js`, `desktop/preload.js`

**Interfaces:**
- `desktop/fileOps.js`: `decodeBackupForImport(encodedText, safeStorageModule)` — inverse of `encodeBackupForExport`: calls Group H's `decryptSecretForStorage(encodedText, safeStorageModule)` → gets back the base64-of-raw-bytes string → `Buffer.from(that, 'base64')` → returns the raw `Buffer`. This is the function that actually wires Group G's `validateFilePathInput` (via the handler, on the *chosen backup file's path*, before it's even read) and Group H's `validateBackupFileBeforeImport` (on the *decoded, decrypted byte content*, before it's trusted as a real SQLite file) — the two "unwired, for a future group" functions this whole plan exists to complete.
- Wiring in `main.js`:
  ```js
  guardedHandle('fs:import-db-backup', async (event, sourcePath) => {
    const pathValidation = validateFilePathInput(sourcePath, resolveAllowedRoots(app));
    if (!pathValidation.ok) return { ok: false, error: pathValidation.error };
    let rawBytes;
    try {
      const encodedText = await fs.promises.readFile(pathValidation.resolved, 'utf8');
      rawBytes = decodeBackupForImport(encodedText, safeStorage);
    } catch (err) {
      return { ok: false, error: `could not decrypt backup: ${err.message}` };
    }
    const contentValidation = validateBackupFileBeforeImport(rawBytes);
    if (!contentValidation.ok) return { ok: false, error: contentValidation.error };
    try {
      closeLocalDb();
      const dbPath = getLocalDbPath(app, path);
      await fs.promises.writeFile(dbPath, rawBytes);
      for (const suffix of ['-wal', '-shm']) {
        await fs.promises.unlink(dbPath + suffix).catch(() => {});
      }
      initLocalDb();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  ```
  `closeLocalDb`, `initLocalDb`, `getLocalDbPath` imported from `./localDb` (extend the existing destructure, per the same duplicate-require discipline as Tasks 2/8). `validateBackupFileBeforeImport` imported from `./security/secretsStore` (extend the existing multi-name destructure that already carries `decryptPasswordHashOrFallback`/`encryptDiagnosticsBundleOnExport`, per Group A's final-review fix — do not add a third separate `require` line for this module).
- Preload: `importLocalDbBackup: (path) => ipcRenderer.invoke('fs:import-db-backup', path)`.

- [ ] **Step 1: Write failing test** for `decodeBackupForImport`: fake `safeStorage` (`{ decryptString: (buf) => Buffer.from(buf.toString('base64'), 'base64').toString().slice(4) }` matching the `encodeBackupForExport` test's fake `'enc:'`-prefix convention so the two tests round-trip against each other), assert the decoded output equals the original raw bytes from the Task 8 test fixture.
- [ ] **Step 2: Run test, verify it fails.**
- [ ] **Step 3: Implement `decodeBackupForImport` in `fileOps.js`.**
- [ ] **Step 4: Run test, verify it passes; also add a round-trip test that pipes a Task-8-style fake `encodeBackupForExport` output through `decodeBackupForImport` using matching fakes and asserts equality with the original bytes** — this is the one integration-shaped test worth having in this otherwise fully-mocked suite, since a mismatched encode/decode pairing is exactly the kind of bug pure unit tests in isolation would miss.
- [ ] **Step 5: Wire `fs:import-db-backup` into `main.js`** exactly as above.
- [ ] **Step 6: Wire into `preload.js`.**
- [ ] **Step 7: `node --check`, run full `fileOps.test.js`, commit.**

---

### Task 10: Final verification pass

**Files:** none (verification only, no production code changes)

- [ ] Run the full `desktop` test suite: `node --test desktop/__tests__/*.test.js` — expect all prior-group tests still passing plus the new `fileOps.test.js` cases.
- [ ] `node --check` on every file touched this group: `main.js`, `preload.js`, `fileOps.js`, `localDb.js`.
- [ ] Confirm exactly 10 new `fs:*` channels are registered in `main.js` (`grep -c "guardedHandle('fs:" desktop/main.js`) and that all 10 are exposed in `preload.js`.
- [ ] Confirm `auditIpcHandlerRegistry` (Group G's dev-mode startup self-check) has no new raw `ipcMain.handle`/`on` calls to flag — it scans for calls bypassing `guardedHandle`/`guardedOn`, not a per-channel allowlist, so no update to that function itself should be needed; verify this assumption holds by reading its implementation once rather than assuming.
- [ ] Confirm no duplicate `require(...)` lines were introduced for `./security/ipcGuard`, `./security/secretsStore`, or `./localDb` across all of Tasks 1-9 (the exact class of issue Group A's final review caught) — `grep -n "require('./security/ipcGuard')\|require('./security/secretsStore')\|require('./localDb')" desktop/main.js` should show exactly one line per module.
- [ ] Update the progress ledger, mark Group B complete.
