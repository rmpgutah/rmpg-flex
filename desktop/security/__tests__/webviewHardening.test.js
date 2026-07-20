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

test('shouldAllowGuestNavigation allows the about:blank new-tab sentinel only', () => {
  assert.equal(shouldAllowGuestNavigation('about:blank'), true);
});

test('shouldAllowGuestNavigation denies other about: URLs (not a blanket scheme allowance)', () => {
  assert.equal(shouldAllowGuestNavigation('about:config'), false);
  assert.equal(shouldAllowGuestNavigation('about:preferences'), false);
  assert.equal(shouldAllowGuestNavigation('about:blank/'), false); // not the exact literal
});

// desktop/main.js's 'did-attach-webview' handler wires this same function up
// to the guest webContents' own (cancelable) 'will-navigate' event to gate
// every navigation AFTER the initial attach too (see main.js, next to the
// 'will-attach-webview' handler) — not just the one-time initial src. These
// two cases stand in for that later-navigation check, since main.js itself
// can't be unit-tested without booting Electron.
test('shouldAllowGuestNavigation (later-navigation check): rejects file:// mid-session', () => {
  assert.equal(shouldAllowGuestNavigation('file:///etc/passwd'), false);
});

test('shouldAllowGuestNavigation (later-navigation check): allows https:// mid-session', () => {
  assert.equal(shouldAllowGuestNavigation('https://example.com/redirected'), true);
});

test('shouldAllowGuestNavigation denies unparseable input', () => {
  assert.equal(shouldAllowGuestNavigation('not a url'), false);
  assert.equal(shouldAllowGuestNavigation(''), false);
  assert.equal(shouldAllowGuestNavigation(undefined), false);
});
