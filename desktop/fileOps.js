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
 */
function resolveAllowedRoots(appModule) {
  return [
    appModule.getPath('downloads'),
    appModule.getPath('documents'),
    appModule.getPath('desktop'),
    appModule.getPath('temp'),
    appModule.getPath('userData'),
  ];
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

module.exports = {
  buildSaveDialogOptions,
  buildOpenDialogOptions,
  resolveAllowedRoots,
  formatPrinters,
  isKnownPrinterName,
  encodeBackupForExport,
  decodeBackupForImport,
};
