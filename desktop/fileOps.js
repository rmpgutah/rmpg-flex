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

module.exports = {
  buildSaveDialogOptions,
  buildOpenDialogOptions,
};
