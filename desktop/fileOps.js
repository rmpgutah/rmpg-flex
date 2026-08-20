// ============================================================
// RMPG Flex — File & Data Export/Import
// Pure option-builders for Electron's native save/open file
// dialogs. Every OS/Electron-touching function takes its
// dependency as a parameter, mirroring desktop/systemInfo.js's
// pattern, for zero-runtime-dependency unit testing.
// ============================================================

'use strict';

const { encryptSecretForStorage, decryptSecretForStorage } = require('./security/secretsStore');

/** Builds the options shape for Electron's dialog.showSaveDialog. */
function buildSaveDialogOptions({ defaultPath, filters } = {}) {
  return {
    defaultPath: defaultPath || undefined,
    filters: filters || [],
  };
}

/** Builds the options shape for Electron's dialog.showOpenDialog. */
function buildOpenDialogOptions({ filters, multi } = {}) {
  return {
    filters: filters || [],
    properties: multi ? ['openFile', 'multiSelections'] : ['openFile'],
  };
}

/**
 * Resolves the set of directories a renderer-supplied file path is allowed
 * to fall under, for validateFilePathInput() in security/ipcGuard.js.
 * Takes Electron's `app` module as a parameter (no direct `electron` import)
 * so this stays unit-testable with a fake `app.getPath`.
 *
 * Deliberately EXCLUDES `userData` — that's where the live local SQLite
 * cache (rmpg-local.db, see localDb.js's getLocalDbPath) lives, and none of
 * the four legitimate fs:* flows that consult this list (PDF/CSV export,
 * bulk import, encrypted DB backup/restore) need userData: the DB backup
 * channels (fs:export-db-backup/fs:import-db-backup) resolve dbPath
 * internally via getLocalDbPath(), never through this allowlist. Including
 * it would let a compromised renderer read/overwrite the live DB (or its
 * -wal/-shm sidecars) directly via fs:write-export/fs:read-import,
 * bypassing validateBackupFileBeforeImport and swapInLocalDbWithRollback
 * entirely.
 */
function resolveAllowedRoots(appModule) {
  return [
    appModule.getPath('downloads'),
    appModule.getPath('documents'),
    appModule.getPath('desktop'),
    appModule.getPath('temp'),
  ];
}

/**
 * Defense-in-depth check for fs:write-export/fs:read-import: even with
 * `userData` excluded from resolveAllowedRoots(), this rejects a validated
 * path that resolves to the live local DB file itself or its `-wal`/`-shm`
 * sidecars, regardless of which allowed root it happened to fall under
 * (e.g. a symlink, or a future allowlist change). `resolvedPath` and
 * `dbPath` are expected to both already be absolute, resolved paths (the
 * output of validateFilePathInput()'s `.resolved` and getLocalDbPath()
 * respectively) — this is a plain equality check, not a path-normalizing
 * one, so callers must resolve both sides first.
 */
function isLocalDbPath(resolvedPath, dbPath) {
  return resolvedPath === dbPath || resolvedPath === dbPath + '-wal' || resolvedPath === dbPath + '-shm';
}

/**
 * Formats Electron's webContents.getPrintersAsync() resolved shape
 * (Array<{name, displayName, description, status, isDefault, options}>)
 * down to the fields the renderer actually needs, preserving order.
 */
function formatPrinters(rawPrinterList) {
  return (rawPrinterList || []).map((printer) => ({
    name: printer.name,
    isDefault: printer.isDefault,
  }));
}

/**
 * Validates a renderer-supplied printer name against the real, just-fetched
 * printer list (from formatPrinters()) before it's ever passed to
 * webContents.print()'s deviceName — a compromised renderer can't smuggle
 * an arbitrary/malicious device name past this check.
 */
function isKnownPrinterName(printerName, formattedPrinterList) {
  return (formattedPrinterList || []).some((printer) => printer.name === printerName);
}

/**
 * Prepares a live better-sqlite3 backup for export: base64-encodes the raw
 * backup bytes, then encrypts that string via Group H's
 * encryptSecretForStorage (OS-keychain-backed) so the on-disk .rmpgbak
 * file is never plaintext SQLite. Takes `safeStorage` as a param (no
 * direct `electron` import) to stay unit-testable.
 */
function encodeBackupForExport(rawDbBytes, safeStorageModule) {
  if (!Buffer.isBuffer(rawDbBytes)) {
    throw new TypeError('rawDbBytes must be a Buffer');
  }
  const base64 = rawDbBytes.toString('base64');
  return encryptSecretForStorage(base64, safeStorageModule);
}

/**
 * Inverse of encodeBackupForExport: decrypts the on-disk .rmpgbak text via
 * Group H's decryptSecretForStorage to recover the base64-of-raw-bytes
 * string, then base64-decodes it back to the raw backup Buffer. Takes
 * `safeStorage` as a param (no direct `electron` import) to stay
 * unit-testable. Callers are responsible for validating the result is a
 * genuine SQLite file (validateBackupFileBeforeImport) before trusting it.
 */
function decodeBackupForImport(encodedText, safeStorageModule) {
  const base64 = decryptSecretForStorage(encodedText, safeStorageModule);
  return Buffer.from(base64, 'base64');
}

/**
 * Attempts to call initLocalDb() to reopen the local DB after some preceding
 * failure (a failed pre-write snapshot, or a failed/rolled-back import).
 * Returns `null` if the reopen succeeds (no additional error to report).
 * If the reopen itself throws, returns a string combining the preceding
 * failure's message with the reopen failure's message, so a second failure
 * is never silently masked behind the first. Never throws.
 */
function attemptReopenAfterFailure(initLocalDb, precedingErrorMessage) {
  try {
    initLocalDb();
    return null;
  } catch (reopenErr) {
    return `${precedingErrorMessage}; additionally, reopening the local DB failed: ${reopenErr.message}`;
  }
}

/**
 * Swaps a validated backup in as the live local DB cache, with an automatic
 * rollback if the swap doesn't survive reopening. validateBackupFileBeforeImport
 * (secretsStore.js) only checks a 16-byte magic header — a file that's
 * genuinely SQLite but has a corrupted/truncated body passes that check and
 * only fails once initLocalDb()'s own integrity pragmas actually touch it.
 * Without a rollback, that leaves the working DB already overwritten with no
 * way back. This function snapshots the current DB file before writing the
 * new one, and if closing/writing/reopening fails at any point, restores the
 * snapshot and reopens it so the app comes back up on the DB it started with.
 *
 * `deps = { dbPath, fsModule, closeLocalDb, initLocalDb }` — DI pattern
 * matching the rest of this file: `fsModule` is Node's `fs` module (or a
 * fake with the same `.promises.{copyFile,writeFile,unlink,access}` shape),
 * `closeLocalDb`/`initLocalDb` are zero-arg functions (localDb.js).
 *
 * Never throws — every path returns a `{ok, error?, rolledBack?}` result so
 * callers can distinguish "restore failed, offline mode disabled" from a
 * generic 'Local DB not initialized' error leaking out of the next
 * unrelated getLocalDb() call.
 */
async function swapInLocalDbWithRollback(rawBytes, deps) {
  const { dbPath, fsModule, closeLocalDb, initLocalDb } = deps;
  const rollbackPath = dbPath + '.pre-import-backup';

  async function deleteStaleSidecars(basePath) {
    for (const suffix of ['-wal', '-shm']) {
      await fsModule.promises.unlink(basePath + suffix).catch(() => {});
    }
  }

  try {
    closeLocalDb();
    // Snapshot of the current DB before it's overwritten. On a first-ever
    // run there's no existing dbPath to copy — ENOENT is expected and safe
    // to proceed from, since there's nothing to roll back to in that case
    // anyway. Any OTHER failure (disk full, permission denied, AV file
    // lock, transient I/O error) means we have no guaranteed way back if
    // the import fails, so abort here, before the destructive write ever
    // touches dbPath, rather than silently proceeding with no safety net.
    try {
      await fsModule.promises.copyFile(dbPath, rollbackPath);
    } catch (snapshotErr) {
      if (snapshotErr.code !== 'ENOENT') {
        // closeLocalDb() above already closed the in-process DB handle, and
        // this path aborts before dbPath is ever touched — so dbPath is
        // still the exact same file that was open a moment ago. Reopen it
        // so getLocalDb() callers elsewhere in the app (offlineRouter.js,
        // syncManager.js, ...) don't see a stale 'not initialized' error for
        // the rest of the session over what was only a transient snapshot
        // failure (disk full, permission, AV lock, ...).
        const snapshotError = `could not snapshot existing local DB before import: ${snapshotErr.message}`;
        const reopenError = attemptReopenAfterFailure(initLocalDb, snapshotError);
        return {
          ok: false,
          error: reopenError || snapshotError,
          rolledBack: false,
        };
      }
    }
    await fsModule.promises.writeFile(dbPath, rawBytes);
    await deleteStaleSidecars(dbPath);
    initLocalDb();
    await fsModule.promises.unlink(rollbackPath).catch(() => {});
    return { ok: true };
  } catch (err) {
    const originalError = err.message;
    try {
      await fsModule.promises.access(rollbackPath);
    } catch (accessErr) {
      if (accessErr.code === 'ENOENT') {
        // Genuinely nothing to roll back to (e.g. the pre-write snapshot
        // step itself never ran or was already cleaned up).
        return { ok: false, error: originalError, rolledBack: false };
      }
      // Some OTHER error reading the rollback snapshot (permission denied,
      // transient I/O, ...) is a different situation than "no rollback
      // available" — surface it distinctly rather than silently folding it
      // into the same message.
      return {
        ok: false,
        error: `${originalError}; additionally, could not confirm the rollback snapshot exists: ${accessErr.message}`,
        rolledBack: false,
      };
    }

    // The rollback snapshot exists — attempt the file-level restore (copy
    // it back over dbPath, drop stale sidecars). A failure here means the
    // restore copy itself didn't complete, so dbPath may be left in an
    // inconsistent/half-written state; there's no point attempting to
    // reopen it, and rolledBack must be false.
    try {
      // initLocalDb() above may have already reassigned localDb.js's
      // module-scoped `db` to a new (possibly-corrupt) handle before it
      // threw. Re-closing here (idempotent — see closeLocalDb() itself)
      // releases that handle before we reopen the restored snapshot, so we
      // never leak a native SQLite handle across the restore.
      closeLocalDb();
      await fsModule.promises.copyFile(rollbackPath, dbPath);
      await deleteStaleSidecars(dbPath);
    } catch {
      return { ok: false, error: originalError, rolledBack: false };
    }

    // The restore copy itself succeeded — the on-disk file at dbPath is
    // genuinely the good, restored file. Attempt to reopen a working
    // connection to it; if that also fails, the file is fine but the app
    // has no working connection to it, which is functionally similar to
    // not having rolled back at all from the caller's perspective.
    const reopenError = attemptReopenAfterFailure(initLocalDb, originalError);
    if (reopenError) {
      return { ok: false, error: reopenError, rolledBack: false };
    }
    return { ok: false, error: originalError, rolledBack: true };
  }
}

module.exports = {
  buildSaveDialogOptions,
  buildOpenDialogOptions,
  resolveAllowedRoots,
  isLocalDbPath,
  formatPrinters,
  isKnownPrinterName,
  encodeBackupForExport,
  decodeBackupForImport,
  swapInLocalDbWithRollback,
};
