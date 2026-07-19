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

/**
 * Wraps an ipcMain instance so every handle()/on() registration made
 * through the returned guardedHandle/guardedOn validates the sender's
 * frame origin before the real handler runs.
 */
function createIpcGuards(ipcMain, expectedHost) {
  function guardedHandle(channel, handler) {
    ipcMain.handle(channel, async (event, ...args) => {
      validateIpcSenderOrigin(event, expectedHost);
      return handler(event, ...args);
    });
  }

  function guardedOn(channel, handler) {
    ipcMain.on(channel, (event, ...args) => {
      try {
        validateIpcSenderOrigin(event, expectedHost);
      } catch (err) {
        console.error(`[ipcGuard] rejected "${channel}":`, err.message);
        return;
      }
      handler(event, ...args);
    });
  }

  return { guardedHandle, guardedOn };
}

const MAX_RECON_ARGS_BYTES = 4096;

/**
 * Validates a recon-tool spawn request before it reaches child_process.spawn.
 * toolId must be a known key in catalog; args must be a flat object of
 * string/number/boolean values under a total size cap.
 */
function sanitizeReconToolArgs(toolId, args, catalog) {
  if (!catalog || !Object.prototype.hasOwnProperty.call(catalog, toolId)) {
    return { ok: false, error: `Unknown tool: ${toolId}` };
  }
  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    return { ok: false, error: 'args must be an object' };
  }
  for (const [key, value] of Object.entries(args)) {
    const t = typeof value;
    if (t !== 'string' && t !== 'number' && t !== 'boolean') {
      return { ok: false, error: `invalid value type for "${key}"` };
    }
  }
  const serializedSize = Buffer.byteLength(JSON.stringify(args), 'utf8');
  if (serializedSize > MAX_RECON_ARGS_BYTES) {
    return { ok: false, error: `args too large (${serializedSize} bytes, max ${MAX_RECON_ARGS_BYTES})` };
  }
  return { ok: true };
}

const PIN_SHAPE = /^\d{6}$/;

/** Defense-in-depth shape check — the renderer UI already constrains this. */
function validatePinInput(pin) {
  if (typeof pin !== 'string' || !PIN_SHAPE.test(pin)) {
    return { ok: false, error: 'PIN must be a 6-digit numeric string' };
  }
  return { ok: true };
}

/**
 * Validates a userId before it reaches pinManager.generatePinForUser().
 * Accepts a positive integer or a numeric string (both are legitimate forms
 * as pinManager compares using String(s.user_id) === String(userId)).
 */
function validateUserIdInput(userId) {
  if (userId === null || userId === undefined) {
    return { ok: false, error: 'userId is required' };
  }
  const asNumber = Number(userId);
  if (!Number.isInteger(asNumber) || asNumber <= 0) {
    return { ok: false, error: 'userId must be a positive integer' };
  }
  return { ok: true };
}

module.exports = {
  validateIpcSenderOrigin,
  createIpcGuards,
  sanitizeReconToolArgs,
  validatePinInput,
  validateUserIdInput,
};
