// ============================================================
// RMPG Flex — File & Data Export/Import
// Pure option-builders for Electron's native save/open file
// dialogs. Every OS/Electron-touching function takes its
// dependency as a parameter, mirroring desktop/systemInfo.js's
// pattern, for zero-runtime-dependency unit testing.
// ============================================================

'use strict';

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

module.exports = {
  buildSaveDialogOptions,
  buildOpenDialogOptions,
  resolveAllowedRoots,
  formatPrinters,
};
