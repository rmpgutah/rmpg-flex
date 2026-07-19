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
