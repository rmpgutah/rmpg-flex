'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateIpcSenderOrigin } = require('../ipcGuard');

test('validateIpcSenderOrigin: accepts a matching host', () => {
  const event = { senderFrame: { url: 'https://rmpgutah.us/dispatch' } };
  assert.equal(validateIpcSenderOrigin(event, 'rmpgutah.us'), true);
});

test('validateIpcSenderOrigin: accepts a matching host with a port (dev server)', () => {
  const event = { senderFrame: { url: 'http://localhost:5173/dispatch' } };
  assert.equal(validateIpcSenderOrigin(event, 'localhost:5173'), true);
});

test('validateIpcSenderOrigin: rejects a mismatched host', () => {
  const event = { senderFrame: { url: 'https://evil.example/phish' } };
  assert.throws(
    () => validateIpcSenderOrigin(event, 'rmpgutah.us'),
    /IPC_UNTRUSTED_SENDER/
  );
});

test('validateIpcSenderOrigin: rejects a missing senderFrame', () => {
  const event = {};
  assert.throws(
    () => validateIpcSenderOrigin(event, 'rmpgutah.us'),
    /IPC_UNTRUSTED_SENDER/
  );
});

test('validateIpcSenderOrigin: rejects an unparseable sender URL', () => {
  const event = { senderFrame: { url: 'not-a-url' } };
  assert.throws(
    () => validateIpcSenderOrigin(event, 'rmpgutah.us'),
    /IPC_UNTRUSTED_SENDER/
  );
});

const { createIpcGuards } = require('../ipcGuard');

function makeFakeIpcMain() {
  const handlers = new Map();
  const onHandlers = new Map();
  return {
    handle(channel, fn) { handlers.set(channel, fn); },
    on(channel, fn) { onHandlers.set(channel, fn); },
    _invoke(channel, event, ...args) { return handlers.get(channel)(event, ...args); },
    _emit(channel, event, ...args) { return onHandlers.get(channel)(event, ...args); },
  };
}

test('guardedHandle: calls through to the handler for a trusted sender', async () => {
  const fakeIpcMain = makeFakeIpcMain();
  const { guardedHandle } = createIpcGuards(fakeIpcMain, 'rmpgutah.us');
  guardedHandle('test:echo', async (_event, value) => ({ echoed: value }));
  const event = { senderFrame: { url: 'https://rmpgutah.us/dispatch' } };
  const result = await fakeIpcMain._invoke('test:echo', event, 42);
  assert.deepEqual(result, { echoed: 42 });
});

test('guardedHandle: rejects for an untrusted sender without calling the handler', async () => {
  const fakeIpcMain = makeFakeIpcMain();
  let called = false;
  const { guardedHandle } = createIpcGuards(fakeIpcMain, 'rmpgutah.us');
  guardedHandle('test:echo', async () => { called = true; return 'should not run'; });
  const event = { senderFrame: { url: 'https://evil.example/phish' } };
  await assert.rejects(
    () => fakeIpcMain._invoke('test:echo', event, 42),
    /IPC_UNTRUSTED_SENDER/
  );
  assert.equal(called, false);
});

test('guardedOn: calls through to the handler for a trusted sender', () => {
  const fakeIpcMain = makeFakeIpcMain();
  let received = null;
  const { guardedOn } = createIpcGuards(fakeIpcMain, 'rmpgutah.us');
  guardedOn('test:fire', (_event, value) => { received = value; });
  const event = { senderFrame: { url: 'https://rmpgutah.us/dispatch' } };
  fakeIpcMain._emit('test:fire', event, 'payload');
  assert.equal(received, 'payload');
});

test('guardedOn: swallows the call for an untrusted sender without throwing', () => {
  const fakeIpcMain = makeFakeIpcMain();
  let called = false;
  const { guardedOn } = createIpcGuards(fakeIpcMain, 'rmpgutah.us');
  guardedOn('test:fire', () => { called = true; });
  const event = { senderFrame: { url: 'https://evil.example/phish' } };
  assert.doesNotThrow(() => fakeIpcMain._emit('test:fire', event, 'payload'));
  assert.equal(called, false);
});

const { sanitizeReconToolArgs } = require('../ipcGuard');

const FAKE_CATALOG = {
  nmap: { title: 'Nmap' },
  wireshark: { title: 'Wireshark' },
};

test('sanitizeReconToolArgs: accepts a known tool with simple scalar args', () => {
  const result = sanitizeReconToolArgs('nmap', { target: '10.0.0.1', ports: '22,80' }, FAKE_CATALOG);
  assert.deepEqual(result, { ok: true });
});

test('sanitizeReconToolArgs: rejects an unknown toolId', () => {
  const result = sanitizeReconToolArgs('not-a-real-tool', {}, FAKE_CATALOG);
  assert.equal(result.ok, false);
  assert.match(result.error, /Unknown tool/);
});

test('sanitizeReconToolArgs: rejects a non-object args value', () => {
  const result = sanitizeReconToolArgs('nmap', 'not-an-object', FAKE_CATALOG);
  assert.equal(result.ok, false);
  assert.match(result.error, /must be an object/);
});

test('sanitizeReconToolArgs: rejects a nested object value inside args', () => {
  const result = sanitizeReconToolArgs('nmap', { target: { nested: true } }, FAKE_CATALOG);
  assert.equal(result.ok, false);
  assert.match(result.error, /invalid value type/);
});

test('sanitizeReconToolArgs: rejects args exceeding the size cap', () => {
  const result = sanitizeReconToolArgs('nmap', { target: 'x'.repeat(5000) }, FAKE_CATALOG);
  assert.equal(result.ok, false);
  assert.match(result.error, /too large/);
});

const { validatePinInput } = require('../ipcGuard');

test('validatePinInput: accepts a 6-digit numeric string', () => {
  assert.deepEqual(validatePinInput('123456'), { ok: true });
});

test('validatePinInput: rejects a non-string', () => {
  const result = validatePinInput(123456);
  assert.equal(result.ok, false);
});

test('validatePinInput: rejects the wrong length', () => {
  const result = validatePinInput('12345');
  assert.equal(result.ok, false);
});

test('validatePinInput: rejects non-digit characters', () => {
  const result = validatePinInput('12345a');
  assert.equal(result.ok, false);
});

const { validateUserIdInput } = require('../ipcGuard');

test('validateUserIdInput: accepts a positive integer', () => {
  assert.deepEqual(validateUserIdInput(42), { ok: true });
});

test('validateUserIdInput: accepts a numeric string', () => {
  assert.deepEqual(validateUserIdInput('42'), { ok: true });
});

test('validateUserIdInput: rejects zero or negative', () => {
  assert.equal(validateUserIdInput(0).ok, false);
  assert.equal(validateUserIdInput(-1).ok, false);
});

test('validateUserIdInput: rejects a non-numeric string', () => {
  assert.equal(validateUserIdInput('DROP TABLE users').ok, false);
});

test('validateUserIdInput: rejects null/undefined', () => {
  assert.equal(validateUserIdInput(null).ok, false);
  assert.equal(validateUserIdInput(undefined).ok, false);
});

const path = require('node:path');
const { validateFilePathInput } = require('../ipcGuard');

test('validateFilePathInput: accepts a path under an allowed root', () => {
  const root = path.resolve('/tmp/rmpg-exports');
  const result = validateFilePathInput(path.join(root, 'backup.sqlite'), [root]);
  assert.equal(result.ok, true);
  assert.equal(result.resolved, path.join(root, 'backup.sqlite'));
});

test('validateFilePathInput: rejects a path outside every allowed root', () => {
  const root = path.resolve('/tmp/rmpg-exports');
  const result = validateFilePathInput('/etc/passwd', [root]);
  assert.equal(result.ok, false);
});

test('validateFilePathInput: rejects a traversal attempt that escapes the root', () => {
  const root = path.resolve('/tmp/rmpg-exports');
  const result = validateFilePathInput(path.join(root, '..', '..', 'etc', 'passwd'), [root]);
  assert.equal(result.ok, false);
});

test('validateFilePathInput: rejects a non-string path', () => {
  const root = path.resolve('/tmp/rmpg-exports');
  const result = validateFilePathInput(null, [root]);
  assert.equal(result.ok, false);
});

const { validateSyncQueueIdInput } = require('../ipcGuard');

test('validateSyncQueueIdInput: accepts a positive integer', () => {
  assert.deepEqual(validateSyncQueueIdInput(7), { ok: true });
});

test('validateSyncQueueIdInput: rejects zero, negative, or non-integer', () => {
  assert.equal(validateSyncQueueIdInput(0).ok, false);
  assert.equal(validateSyncQueueIdInput(-3).ok, false);
  assert.equal(validateSyncQueueIdInput(1.5).ok, false);
});

test('validateSyncQueueIdInput: rejects a non-numeric value', () => {
  assert.equal(validateSyncQueueIdInput('all').ok, false);
});

const { validateGlobalShortcutAccelerator } = require('../ipcGuard');

test('validateGlobalShortcutAccelerator: accepts a valid modifier+key combo', () => {
  assert.deepEqual(validateGlobalShortcutAccelerator('CommandOrControl+Shift+P'), { ok: true });
});

test('validateGlobalShortcutAccelerator: accepts a valid function key combo', () => {
  assert.deepEqual(validateGlobalShortcutAccelerator('Alt+F9'), { ok: true });
});

test('validateGlobalShortcutAccelerator: rejects an unknown token', () => {
  const result = validateGlobalShortcutAccelerator('CommandOrControl+Banana');
  assert.equal(result.ok, false);
});

test('validateGlobalShortcutAccelerator: rejects a non-string', () => {
  assert.equal(validateGlobalShortcutAccelerator(null).ok, false);
});

test('validateGlobalShortcutAccelerator: rejects an empty string', () => {
  assert.equal(validateGlobalShortcutAccelerator('').ok, false);
});

const { createRateLimiter } = require('../ipcGuard');

test('createRateLimiter: allows calls under the limit', () => {
  const { checkRateLimit } = createRateLimiter(3, 60_000);
  assert.equal(checkRateLimit('recon:tool-spawn').ok, true);
  assert.equal(checkRateLimit('recon:tool-spawn').ok, true);
  assert.equal(checkRateLimit('recon:tool-spawn').ok, true);
});

test('createRateLimiter: rejects the call that exceeds the limit', () => {
  const { checkRateLimit } = createRateLimiter(2, 60_000);
  assert.equal(checkRateLimit('recon:tool-spawn').ok, true);
  assert.equal(checkRateLimit('recon:tool-spawn').ok, true);
  const third = checkRateLimit('recon:tool-spawn');
  assert.equal(third.ok, false);
  assert.match(third.error, /rate limit/);
});

test('createRateLimiter: tracks separate channels independently', () => {
  const { checkRateLimit } = createRateLimiter(1, 60_000);
  assert.equal(checkRateLimit('channel-a').ok, true);
  assert.equal(checkRateLimit('channel-b').ok, true);
  assert.equal(checkRateLimit('channel-a').ok, false);
});

test('createRateLimiter: resets after the window elapses', async () => {
  const { checkRateLimit } = createRateLimiter(1, 50);
  assert.equal(checkRateLimit('channel-a').ok, true);
  assert.equal(checkRateLimit('channel-a').ok, false);
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(checkRateLimit('channel-a').ok, true);
});

const { requireOfflineAuthForSensitiveIpc } = require('../ipcGuard');

test('requireOfflineAuthForSensitiveIpc: allows an admin role', () => {
  assert.deepEqual(requireOfflineAuthForSensitiveIpc('admin'), { ok: true });
});

test('requireOfflineAuthForSensitiveIpc: rejects a non-admin role', () => {
  const result = requireOfflineAuthForSensitiveIpc('officer');
  assert.equal(result.ok, false);
});

test('requireOfflineAuthForSensitiveIpc: rejects a missing/null role', () => {
  assert.equal(requireOfflineAuthForSensitiveIpc(null).ok, false);
  assert.equal(requireOfflineAuthForSensitiveIpc(undefined).ok, false);
});

const { auditIpcHandlerRegistry } = require('../ipcGuard');

test('auditIpcHandlerRegistry: passes when source has no raw ipcMain registrations', () => {
  const source = `
    guardedHandle('app:version', () => app.getVersion());
    guardedOn('window:minimize', () => mainWindow?.minimize());
  `;
  assert.deepEqual(auditIpcHandlerRegistry(source), { ok: true });
});

test('auditIpcHandlerRegistry: flags a raw ipcMain.handle call', () => {
  const source = `ipcMain.handle('new:channel', () => {});`;
  const result = auditIpcHandlerRegistry(source);
  assert.equal(result.ok, false);
  assert.equal(result.violations.length, 1);
  assert.match(result.violations[0], /new:channel/);
});

test('auditIpcHandlerRegistry: flags a raw ipcMain.on call', () => {
  const source = `ipcMain.on('new:channel', () => {});`;
  const result = auditIpcHandlerRegistry(source);
  assert.equal(result.ok, false);
  assert.match(result.violations[0], /new:channel/);
});

test('auditIpcHandlerRegistry: flags multiple violations', () => {
  const source = `
    ipcMain.handle('a', () => {});
    guardedHandle('b', () => {});
    ipcMain.on('c', () => {});
  `;
  const result = auditIpcHandlerRegistry(source);
  assert.equal(result.violations.length, 2);
});

const { validateKioskEscapeCredentials } = require('../ipcGuard');

test('validateKioskEscapeCredentials: accepts non-empty username and password', () => {
  assert.deepEqual(validateKioskEscapeCredentials('czamora', 'hunter2'), { ok: true });
});

test('validateKioskEscapeCredentials: rejects empty/missing username or password', () => {
  assert.equal(validateKioskEscapeCredentials('', 'hunter2').ok, false);
  assert.equal(validateKioskEscapeCredentials('czamora', '').ok, false);
  assert.equal(validateKioskEscapeCredentials(undefined, 'hunter2').ok, false);
  assert.equal(validateKioskEscapeCredentials('czamora', undefined).ok, false);
});

test('validateKioskEscapeCredentials: rejects non-string input', () => {
  assert.equal(validateKioskEscapeCredentials(123, 'hunter2').ok, false);
  assert.equal(validateKioskEscapeCredentials('czamora', {}).ok, false);
});

test('validateKioskEscapeCredentials: rejects an over-length password (basic sanity cap)', () => {
  assert.equal(validateKioskEscapeCredentials('czamora', 'x'.repeat(1025)).ok, false);
});

// ─── Local-file sender guard (kiosk escape hatch) ─────────────
// Regression coverage for the bug this guard exists to fix: the kiosk
// escape window is loaded with BrowserWindow.loadFile(), so it can never
// satisfy the host-based guard, and registering its channel through
// createIpcGuards silently rejected every attempt to leave kiosk mode.

// `path` is already required at the top of the local-DB guard block above.
const { pathToFileURL } = require('node:url');
const {
  validateIpcSenderIsLocalFile,
  createLocalFileIpcGuards,
} = require('../ipcGuard');

const ESCAPE_PAGE = path.join(__dirname, '..', '..', 'kioskEscape.html');
const ESCAPE_PAGE_URL = pathToFileURL(ESCAPE_PAGE).href;

test('validateIpcSenderOrigin: rejects a file:// sender (host is always empty)', () => {
  // The bug. A file:// URL parses fine but its host is '', so a host guard
  // can never admit it — which is why local pages need their own guard.
  const event = { senderFrame: { url: ESCAPE_PAGE_URL } };
  assert.equal(new URL(ESCAPE_PAGE_URL).host, '');
  assert.throws(
    () => validateIpcSenderOrigin(event, 'rmpgutah.us'),
    /IPC_UNTRUSTED_SENDER/
  );
});

test('validateIpcSenderIsLocalFile: accepts an allow-listed local page', () => {
  const event = { senderFrame: { url: ESCAPE_PAGE_URL } };
  assert.equal(validateIpcSenderIsLocalFile(event, [ESCAPE_PAGE]), true);
});

test('validateIpcSenderIsLocalFile: accepts a non-normalized allow-list entry', () => {
  const messy = path.join(__dirname, '..', '..', '.', 'kioskEscape.html');
  const event = { senderFrame: { url: ESCAPE_PAGE_URL } };
  assert.equal(validateIpcSenderIsLocalFile(event, [messy]), true);
});

test('validateIpcSenderIsLocalFile: rejects a different local file', () => {
  const event = { senderFrame: { url: pathToFileURL(path.join(__dirname, 'evil.html')).href } };
  assert.throws(
    () => validateIpcSenderIsLocalFile(event, [ESCAPE_PAGE]),
    /IPC_UNTRUSTED_SENDER/
  );
});

test('validateIpcSenderIsLocalFile: rejects a sibling file in the allowed directory', () => {
  // Exact-match, not startsWith — a file merely living next to the allowed
  // page must not inherit its trust.
  const sibling = path.join(path.dirname(ESCAPE_PAGE), 'preload.js');
  const event = { senderFrame: { url: pathToFileURL(sibling).href } };
  assert.throws(
    () => validateIpcSenderIsLocalFile(event, [ESCAPE_PAGE]),
    /IPC_UNTRUSTED_SENDER/
  );
});

test('validateIpcSenderIsLocalFile: rejects an http(s) sender', () => {
  const event = { senderFrame: { url: 'https://rmpgutah.us/dispatch' } };
  assert.throws(
    () => validateIpcSenderIsLocalFile(event, [ESCAPE_PAGE]),
    /expected a file:\/\/ sender/
  );
});

test('validateIpcSenderIsLocalFile: rejects a missing senderFrame', () => {
  assert.throws(
    () => validateIpcSenderIsLocalFile({}, [ESCAPE_PAGE]),
    /IPC_UNTRUSTED_SENDER/
  );
});

test('validateIpcSenderIsLocalFile: rejects an empty allow-list', () => {
  const event = { senderFrame: { url: ESCAPE_PAGE_URL } };
  assert.throws(() => validateIpcSenderIsLocalFile(event, []), /IPC_UNTRUSTED_SENDER/);
  assert.throws(() => validateIpcSenderIsLocalFile(event, undefined), /IPC_UNTRUSTED_SENDER/);
});

test('createLocalFileIpcGuards: guardedHandle runs the handler for an allowed page', async () => {
  const registered = new Map();
  const fakeIpcMain = { handle: (channel, fn) => registered.set(channel, fn), on: () => {} };
  const { guardedHandle } = createLocalFileIpcGuards(fakeIpcMain, [ESCAPE_PAGE]);
  guardedHandle('kiosk:attempt-escape', async () => ({ ok: true }));

  const result = await registered.get('kiosk:attempt-escape')({
    senderFrame: { url: ESCAPE_PAGE_URL },
  });
  assert.deepEqual(result, { ok: true });
});

test('createLocalFileIpcGuards: guardedHandle rejects an untrusted page without running the handler', async () => {
  const registered = new Map();
  const fakeIpcMain = { handle: (channel, fn) => registered.set(channel, fn), on: () => {} };
  const { guardedHandle } = createLocalFileIpcGuards(fakeIpcMain, [ESCAPE_PAGE]);
  let handlerRan = false;
  guardedHandle('kiosk:attempt-escape', async () => { handlerRan = true; return { ok: true }; });

  await assert.rejects(
    () => registered.get('kiosk:attempt-escape')({ senderFrame: { url: 'https://evil.example/' } }),
    /IPC_UNTRUSTED_SENDER/
  );
  assert.equal(handlerRan, false);
});
