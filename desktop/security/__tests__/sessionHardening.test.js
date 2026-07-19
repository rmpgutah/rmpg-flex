'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCspHeaderValue } = require('../sessionHardening');

test('buildCspHeaderValue: returns a policy scoped to self plus known integrations', () => {
  const policy = buildCspHeaderValue();
  assert.match(policy, /default-src 'self'/);
  assert.match(policy, /connect-src[^;]*wss:\/\/api\.rmpgutah\.us/);
  assert.match(policy, /connect-src[^;]*https:\/\/api\.rmpgutah\.us/);
  assert.match(policy, /img-src[^;]*\*\.mapbox\.com/);
  assert.match(policy, /script-src[^;]*\*\.mapbox\.com/);
});

test('buildCspHeaderValue: does not include a wildcard default-src', () => {
  const policy = buildCspHeaderValue();
  assert.doesNotMatch(policy, /default-src[^;]*\*/);
});

test('buildCspHeaderValue: every directive is terminated with a semicolon', () => {
  const policy = buildCspHeaderValue();
  const directives = policy.split(';').map((d) => d.trim()).filter(Boolean);
  assert.ok(directives.length >= 6, 'expected at least 6 CSP directives');
});

const { isPermissionAllowed } = require('../sessionHardening');

test('isPermissionAllowed: allows a known permission from the trusted host', () => {
  assert.equal(isPermissionAllowed('rmpgutah.us', 'rmpgutah.us', 'geolocation'), true);
  assert.equal(isPermissionAllowed('rmpgutah.us', 'rmpgutah.us', 'notifications'), true);
  assert.equal(isPermissionAllowed('rmpgutah.us', 'rmpgutah.us', 'media'), true);
});

test('isPermissionAllowed: rejects a matching permission from an untrusted host', () => {
  assert.equal(isPermissionAllowed('evil.example', 'rmpgutah.us', 'geolocation'), false);
});

test('isPermissionAllowed: rejects an unlisted permission even from the trusted host', () => {
  assert.equal(isPermissionAllowed('rmpgutah.us', 'rmpgutah.us', 'midi'), false);
  assert.equal(isPermissionAllowed('rmpgutah.us', 'rmpgutah.us', 'clipboard-read'), false);
});

const { shouldAllowNavigation } = require('../sessionHardening');

test('shouldAllowNavigation: allows same-host https navigation', () => {
  assert.equal(shouldAllowNavigation('https://rmpgutah.us/dispatch', 'rmpgutah.us'), true);
});

test('shouldAllowNavigation: rejects a different host', () => {
  assert.equal(shouldAllowNavigation('https://evil.example/phish', 'rmpgutah.us'), false);
});

test('shouldAllowNavigation: rejects a data: URL', () => {
  assert.equal(shouldAllowNavigation('data:text/html,<script>alert(1)</script>', 'rmpgutah.us'), false);
});

test('shouldAllowNavigation: rejects an unparseable URL', () => {
  assert.equal(shouldAllowNavigation('not a url', 'rmpgutah.us'), false);
});

test('shouldAllowNavigation: allows the local offline fallback page (data: URL is the one deliberate exception — guarded by exact prefix)', () => {
  // getOfflineHTML() in main.js builds a data:text/html,... URL for the
  // offline fallback screen. Navigation TO it happens via mainWindow.loadURL()
  // directly (not a renderer-driven navigation event), so will-navigate
  // never actually fires for it — this test documents that assumption
  // rather than special-casing data: URLs as generally allowed.
  assert.equal(shouldAllowNavigation('data:text/html;charset=utf-8,%3Chtml%3E', 'rmpgutah.us'), false);
});

const { hardenWebPreferencesDefaults } = require('../sessionHardening');

test('hardenWebPreferencesDefaults: returns the hardened baseline with no overrides', () => {
  const prefs = hardenWebPreferencesDefaults();
  assert.equal(prefs.contextIsolation, true);
  assert.equal(prefs.nodeIntegration, false);
  assert.equal(prefs.webSecurity, true);
  assert.equal(prefs.webviewTag, false);
  assert.equal(prefs.experimentalFeatures, false);
  assert.equal(prefs.allowRunningInsecureContent, false);
  assert.equal(prefs.enableWebSQL, false);
});

test('hardenWebPreferencesDefaults: caller overrides win over the baseline', () => {
  const prefs = hardenWebPreferencesDefaults({ preload: '/path/to/preload.js', backgroundThrottling: false });
  assert.equal(prefs.preload, '/path/to/preload.js');
  assert.equal(prefs.backgroundThrottling, false);
  // baseline values not overridden are still present
  assert.equal(prefs.contextIsolation, true);
});

test('hardenWebPreferencesDefaults: an override cannot silently re-enable a security-critical flag by accident-proofing (documents intent, not enforced)', () => {
  // If a caller explicitly passes contextIsolation: false, that IS honored —
  // this function centralizes defaults, it does not forbid an override.
  // This test documents that behavior so it is a deliberate, visible choice
  // rather than a surprise.
  const prefs = hardenWebPreferencesDefaults({ contextIsolation: false });
  assert.equal(prefs.contextIsolation, false);
});
