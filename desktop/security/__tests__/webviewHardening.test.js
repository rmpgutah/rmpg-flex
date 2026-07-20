'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { hardenGuestWebPreferences, shouldAllowGuestNavigation } = require('../webviewHardening');

test('hardenGuestWebPreferences forces safe defaults regardless of input', () => {
  const result = hardenGuestWebPreferences({
    nodeIntegration: true,
    contextIsolation: false,
    plugins: true,
    preload: '/some/malicious/preload.js',
    partition: 'persist:tab-1',
  });
  assert.equal(result.nodeIntegration, false);
  assert.equal(result.contextIsolation, true);
  assert.equal(result.plugins, false);
  assert.equal(result.preload, undefined);
  assert.equal(result.partition, 'persist:tab-1'); // non-security fields pass through
});

test('hardenGuestWebPreferences works from an empty/undefined input', () => {
  const result = hardenGuestWebPreferences();
  assert.equal(result.nodeIntegration, false);
  assert.equal(result.contextIsolation, true);
  assert.equal(result.plugins, false);
});

test('shouldAllowGuestNavigation allows http(s)', () => {
  assert.equal(shouldAllowGuestNavigation('https://example.com'), true);
  assert.equal(shouldAllowGuestNavigation('http://example.com/path?q=1'), true);
});

test('shouldAllowGuestNavigation denies non-http(s) schemes', () => {
  assert.equal(shouldAllowGuestNavigation('file:///etc/passwd'), false);
  assert.equal(shouldAllowGuestNavigation('javascript:alert(1)'), false);
  assert.equal(shouldAllowGuestNavigation('chrome://settings'), false);
});

test('shouldAllowGuestNavigation denies unparseable input', () => {
  assert.equal(shouldAllowGuestNavigation('not a url'), false);
  assert.equal(shouldAllowGuestNavigation(''), false);
  assert.equal(shouldAllowGuestNavigation(undefined), false);
});
