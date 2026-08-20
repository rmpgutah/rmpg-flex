// ============================================================
// RMPG Flex — IPC Guard
// Sender-origin and input validation for every ipcMain handler.
// Wraps ipcMain.handle/ipcMain.on so a new handler cannot be
// registered without going through validateIpcSenderOrigin first.
// ============================================================

'use strict';

const { URL, fileURLToPath } = require('url');
const path = require('path');

/**
 * Throws if the IPC call's sender frame doesn't match expectedHost.
 * Returns true on success (never returns false — callers branch on throw).
 *
 * NOTE: this is a HOST check, so it only ever admits http(s) frames. A page
 * loaded with BrowserWindow.loadFile() has a `file://` URL whose host is the
 * empty string and can never match a real host — see
 * validateIpcSenderIsLocalFile below for the guard those windows need.
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
 * Normalizes a filesystem path for comparison. Windows paths are
 * case-insensitive (and `fileURLToPath` is not guaranteed to round-trip the
 * drive letter in the same case `__dirname` reports), so fold case there —
 * but NOT on macOS/Linux, where two paths differing only in case are two
 * genuinely different files and folding would widen the allow-list.
 */
function normalizePathForCompare(candidate) {
  const resolved = path.resolve(candidate);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/**
 * Throws unless the IPC call's sender frame is one of a fixed set of local
 * `file://` pages shipped inside the app bundle.
 *
 * validateIpcSenderOrigin can't serve these windows: it compares
 * `new URL(url).host`, which is `''` for every `file://` URL and so never
 * equals a real host. Trusted-local windows (the kiosk escape hatch) must
 * still be gated, so they get their own guard that matches on the resolved
 * FILE PATH — an exact match against an explicit allow-list, not a
 * scheme-only "is it file://" check, so an arbitrary HTML file elsewhere on
 * disk (a download, a USB stick) opened in some future window can never
 * reach a channel registered through this guard.
 *
 * Returns true on success (never returns false — callers branch on throw).
 */
function validateIpcSenderIsLocalFile(event, allowedFilePaths) {
  if (!event || !event.senderFrame || typeof event.senderFrame.url !== 'string') {
    throw new Error('IPC_UNTRUSTED_SENDER: missing senderFrame');
  }
  let parsed;
  try {
    parsed = new URL(event.senderFrame.url);
  } catch {
    throw new Error('IPC_UNTRUSTED_SENDER: unparseable sender URL');
  }
  if (parsed.protocol !== 'file:') {
    throw new Error(`IPC_UNTRUSTED_SENDER: expected a file:// sender, got "${parsed.protocol}"`);
  }
  let senderPath;
  try {
    senderPath = normalizePathForCompare(fileURLToPath(parsed));
  } catch {
    throw new Error('IPC_UNTRUSTED_SENDER: sender URL is not a usable file path');
  }
  const allowed = (allowedFilePaths || []).some(
    (candidate) => normalizePathForCompare(candidate) === senderPath
  );
  if (!allowed) {
    throw new Error(`IPC_UNTRUSTED_SENDER: file "${senderPath}" is not an allowed local page`);
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

/**
 * createIpcGuards' sibling for channels served by trusted local `file://`
 * pages instead of the remote app shell. Same registration contract
 * (guardedHandle/guardedOn), same throw-on-reject behavior — only the
 * sender predicate differs. Kept as a separate factory rather than a mode
 * flag on createIpcGuards so a channel can never accidentally accept BOTH
 * a remote origin and a local file.
 */
function createLocalFileIpcGuards(ipcMain, allowedFilePaths) {
  function guardedHandle(channel, handler) {
    ipcMain.handle(channel, async (event, ...args) => {
      validateIpcSenderIsLocalFile(event, allowedFilePaths);
      return handler(event, ...args);
    });
  }

  function guardedOn(channel, handler) {
    ipcMain.on(channel, (event, ...args) => {
      try {
        validateIpcSenderIsLocalFile(event, allowedFilePaths);
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

/**
 * Resolves candidatePath and confirms it falls under one of allowedRoots.
 * Used by any future handler that writes/reads a renderer-chosen file path
 * (exports, backups) so a crafted path can't escape the intended directory.
 */
function validateFilePathInput(candidatePath, allowedRoots) {
  if (typeof candidatePath !== 'string' || candidatePath.length === 0) {
    return { ok: false, error: 'path must be a non-empty string' };
  }
  const resolved = path.resolve(candidatePath);
  const isUnderAnyRoot = allowedRoots.some((root) => {
    const resolvedRoot = path.resolve(root);
    return resolved === resolvedRoot || resolved.startsWith(resolvedRoot + path.sep);
  });
  if (!isUnderAnyRoot) {
    return { ok: false, error: `path "${resolved}" is outside all allowed directories` };
  }
  return { ok: true, resolved };
}

/**
 * Validates a sync queue ID before it reaches the future sync:retry-item handler.
 * Must be a positive integer (no existence check — that's deferred to the handler itself).
 */
function validateSyncQueueIdInput(id) {
  if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) {
    return { ok: false, error: 'id must be a positive integer' };
  }
  return { ok: true };
}

const ACCELERATOR_MODIFIERS = new Set([
  'CommandOrControl', 'CmdOrCtrl', 'Command', 'Cmd', 'Control', 'Ctrl',
  'Alt', 'Option', 'AltGr', 'Shift', 'Super', 'Meta',
]);

const ACCELERATOR_KEYS = new Set([
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split(''),
  ...Array.from({ length: 24 }, (_, i) => `F${i + 1}`),
  'Plus', 'Space', 'Tab', 'Backspace', 'Delete', 'Insert', 'Return', 'Enter',
  'Up', 'Down', 'Left', 'Right', 'Home', 'End', 'PageUp', 'PageDown', 'Escape', 'Esc',
]);

/**
 * Validates an Electron globalShortcut Accelerator string: zero or more
 * known modifiers joined by "+", ending in exactly one known key token.
 */
function validateGlobalShortcutAccelerator(accelerator) {
  if (typeof accelerator !== 'string' || accelerator.length === 0) {
    return { ok: false, error: 'accelerator must be a non-empty string' };
  }
  const parts = accelerator.split('+');
  const key = parts[parts.length - 1];
  const modifiers = parts.slice(0, -1);
  if (!ACCELERATOR_KEYS.has(key)) {
    return { ok: false, error: `unknown key token "${key}"` };
  }
  for (const mod of modifiers) {
    if (!ACCELERATOR_MODIFIERS.has(mod)) {
      return { ok: false, error: `unknown modifier token "${mod}"` };
    }
  }
  return { ok: true };
}

/**
 * Sliding-window call-count limiter, keyed by channel name. Each call to
 * the returned checkRateLimit records a timestamp and rejects once
 * maxCallsPerWindow timestamps fall inside the trailing windowMs.
 */
function createRateLimiter(maxCallsPerWindow, windowMs) {
  const callLog = new Map(); // channel -> array of timestamps

  function checkRateLimit(channel) {
    const now = Date.now();
    const timestamps = (callLog.get(channel) || []).filter((t) => now - t < windowMs);
    if (timestamps.length >= maxCallsPerWindow) {
      callLog.set(channel, timestamps);
      return { ok: false, error: `rate limit exceeded for "${channel}" (${maxCallsPerWindow} per ${windowMs}ms)` };
    }
    timestamps.push(now);
    callLog.set(channel, timestamps);
    return { ok: true };
  }

  return { checkRateLimit };
}

/** Gate for IPC actions (e.g. admin PIN generation) that must not be
 * callable by a non-admin renderer session, even a same-origin one. */
function requireOfflineAuthForSensitiveIpc(cachedRole) {
  if (cachedRole !== 'admin') {
    return { ok: false, error: 'This action requires an admin session' };
  }
  return { ok: true };
}

const RAW_IPC_REGISTRATION = /^\s*ipcMain\.(handle|on)\(\s*['"]([^'"]+)['"]/gm;

/**
 * Statically scans main.js source text for any ipcMain.handle/on call that
 * bypasses guardedHandle/guardedOn. Returns the offending channel names so
 * a regression (a new handler added without going through the guard) is
 * caught immediately instead of silently reintroducing an unvalidated
 * channel.
 */
function auditIpcHandlerRegistry(mainJsSource) {
  const violations = [];
  let match;
  RAW_IPC_REGISTRATION.lastIndex = 0;
  while ((match = RAW_IPC_REGISTRATION.exec(mainJsSource)) !== null) {
    violations.push(`raw ipcMain.${match[1]}('${match[2]}') bypasses guardedHandle/guardedOn`);
  }
  return violations.length === 0 ? { ok: true } : { ok: false, violations };
}

/**
 * Shape-validates the kiosk escape hatch's username/password before main.js
 * sends them anywhere. Mirrors validatePinInput's convention: non-throwing,
 * { ok, error } return shape. A generous 1024-char cap is a basic sanity
 * bound, not a real password-policy check — the live /api/auth/login call
 * is the actual authority on whether the credentials are correct.
 */
function validateKioskEscapeCredentials(username, password) {
  if (typeof username !== 'string' || username.length === 0) {
    return { ok: false, error: 'username must be a non-empty string' };
  }
  if (typeof password !== 'string' || password.length === 0) {
    return { ok: false, error: 'password must be a non-empty string' };
  }
  if (password.length > 1024) {
    return { ok: false, error: 'password exceeds maximum length' };
  }
  return { ok: true };
}

module.exports = {
  validateIpcSenderOrigin,
  validateIpcSenderIsLocalFile,
  createIpcGuards,
  createLocalFileIpcGuards,
  sanitizeReconToolArgs,
  validatePinInput,
  validateUserIdInput,
  validateFilePathInput,
  validateSyncQueueIdInput,
  validateGlobalShortcutAccelerator,
  createRateLimiter,
  requireOfflineAuthForSensitiveIpc,
  auditIpcHandlerRegistry,
  validateKioskEscapeCredentials,
};
