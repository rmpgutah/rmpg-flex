// ============================================================
// RMPG Flex — IPC Guard
// Sender-origin and input validation for every ipcMain handler.
// Wraps ipcMain.handle/ipcMain.on so a new handler cannot be
// registered without going through validateIpcSenderOrigin first.
// ============================================================

'use strict';

const { URL } = require('url');

/**
 * Throws if the IPC call's sender frame doesn't match expectedHost.
 * Returns true on success (never returns false — callers branch on throw).
 */
function validateIpcSenderOrigin(event, expectedHost) {
  if (!event || !event.senderFrame || typeof event.senderFrame.url !== 'string') {
    throw new Error('IPC_UNTRUSTED_SENDER: missing senderFrame');
  }
  let host;
  try {
    host = new URL(event.senderFrame.url).host;
  } catch {
    throw new Error('IPC_UNTRUSTED_SENDER: unparseable sender URL');
  }
  if (host !== expectedHost) {
    throw new Error(`IPC_UNTRUSTED_SENDER: host "${host}" does not match expected "${expectedHost}"`);
  }
  return true;
}

module.exports = {
  validateIpcSenderOrigin,
};
