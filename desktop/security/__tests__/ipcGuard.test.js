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
