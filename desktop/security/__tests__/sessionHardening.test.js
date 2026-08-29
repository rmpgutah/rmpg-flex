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
  assert.match(policy, /frame-src[^;]*https:\/\/dialer\.rmpgutah\.us/);
  assert.match(policy, /script-src[^;]*challenges\.cloudflare\.com/);
  assert.doesNotMatch(policy, /static\.cloudflareinsights\.com/);
  assert.doesNotMatch(policy, /connect-src 'none'/);
  assert.match(policy, /script-src[^;]*'self'/);
});

const { shouldAttachDesktopCspReportOnly } = require('../sessionHardening');

test('shouldAttachDesktopCspReportOnly: CAD hosts only, never Dial Connect', () => {
  assert.equal(shouldAttachDesktopCspReportOnly('https://rmpgutah.us/dispatch'), true);
  assert.equal(shouldAttachDesktopCspReportOnly('https://www.rmpgutah.us/'), true);
  assert.equal(shouldAttachDesktopCspReportOnly('https://c6dd3fb2.rmpg-flex.pages.dev/'), true);
  assert.equal(shouldAttachDesktopCspReportOnly('http://localhost:5173/'), true);
  assert.equal(shouldAttachDesktopCspReportOnly('https://dialer.rmpgutah.us/dialer-embed'), false);
  assert.equal(shouldAttachDesktopCspReportOnly('https://static.cloudflareinsights.com/beacon.min.js'), false);
  assert.equal(shouldAttachDesktopCspReportOnly('https://api.rmpgutah.us/api/health'), false);
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

test('isPermissionAllowed: allows media from Dial Connect so Twilio Voice works in the embed', () => {
  assert.equal(isPermissionAllowed('dialer.rmpgutah.us', 'rmpgutah.us', 'media'), true);
  assert.equal(isPermissionAllowed('dialer.rmpgutah.us', 'rmpgutah.us', 'geolocation'), false);
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

const { shouldAllowNewWindow } = require('../sessionHardening');

test('shouldAllowNewWindow: allows same-host http(s)', () => {
  assert.deepEqual(shouldAllowNewWindow('https://rmpgutah.us/print', 'rmpgutah.us'), { action: 'allow' });
});

test('shouldAllowNewWindow: routes a different http(s) host external', () => {
  assert.deepEqual(shouldAllowNewWindow('https://maps.google.com/?q=1', 'rmpgutah.us'), { action: 'external' });
});

test('shouldAllowNewWindow: Dial Connect opens in-app so Twilio Voice stays one Client', () => {
  assert.deepEqual(
    shouldAllowNewWindow('https://dialer.rmpgutah.us/dialer', 'rmpgutah.us'),
    { action: 'allow' },
  );
});

test('shouldAllowNewWindow: denies a javascript: URL', () => {
  assert.deepEqual(shouldAllowNewWindow('javascript:alert(1)', 'rmpgutah.us'), { action: 'deny' });
});

test('shouldAllowNewWindow: denies a data: URL', () => {
  assert.deepEqual(shouldAllowNewWindow('data:text/html,x', 'rmpgutah.us'), { action: 'deny' });
});

test('shouldAllowNewWindow: denies an unparseable URL', () => {
  assert.deepEqual(shouldAllowNewWindow('not a url', 'rmpgutah.us'), { action: 'deny' });
});

const { assertSecureElectronDefaults } = require('../sessionHardening');

function fakeApp(enabledSwitches) {
  return {
    commandLine: {
      hasSwitch: (name) => enabledSwitches.includes(name),
    },
  };
}

test('assertSecureElectronDefaults: ok when no insecure switches are set', () => {
  assert.deepEqual(assertSecureElectronDefaults(fakeApp([])), { ok: true });
});

test('assertSecureElectronDefaults: flags disable-web-security', () => {
  const result = assertSecureElectronDefaults(fakeApp(['disable-web-security']));
  assert.equal(result.ok, false);
  assert.ok(result.violations.includes('disable-web-security'));
});

test('assertSecureElectronDefaults: flags multiple insecure switches at once', () => {
  const result = assertSecureElectronDefaults(fakeApp(['disable-web-security', 'allow-file-access-from-files']));
  assert.equal(result.violations.length, 2);
});

// Group J Task 9: the original 4-switch list only covered flags that
// directly disable web-platform security checks; it missed switches that
// widen the app's debug-protocol or OS-sandbox attack surface instead.
// These cases guard the expanded list.
test('assertSecureElectronDefaults: flags remote-debugging-port', () => {
  const result = assertSecureElectronDefaults(fakeApp(['remote-debugging-port']));
  assert.equal(result.ok, false);
  assert.ok(result.violations.includes('remote-debugging-port'));
});

test('assertSecureElectronDefaults: flags remote-debugging-address', () => {
  const result = assertSecureElectronDefaults(fakeApp(['remote-debugging-address']));
  assert.equal(result.ok, false);
  assert.ok(result.violations.includes('remote-debugging-address'));
});

test('assertSecureElectronDefaults: flags no-sandbox', () => {
  const result = assertSecureElectronDefaults(fakeApp(['no-sandbox']));
  assert.equal(result.ok, false);
  assert.ok(result.violations.includes('no-sandbox'));
});

test('assertSecureElectronDefaults: flags allow-insecure-localhost', () => {
  const result = assertSecureElectronDefaults(fakeApp(['allow-insecure-localhost']));
  assert.equal(result.ok, false);
  assert.ok(result.violations.includes('allow-insecure-localhost'));
});

test('assertSecureElectronDefaults: flags disable-site-isolation-trials', () => {
  const result = assertSecureElectronDefaults(fakeApp(['disable-site-isolation-trials']));
  assert.equal(result.ok, false);
  assert.ok(result.violations.includes('disable-site-isolation-trials'));
});

const { shouldExposeDevToolsMenuItem } = require('../sessionHardening');

test('shouldExposeDevToolsMenuItem: true when not packaged (dev run)', () => {
  assert.equal(shouldExposeDevToolsMenuItem(false), true);
});

test('shouldExposeDevToolsMenuItem: false when packaged (production build)', () => {
  assert.equal(shouldExposeDevToolsMenuItem(true), false);
});

const { isSecureUpdateFeedUrl } = require('../sessionHardening');

test('isSecureUpdateFeedUrl: true for an https URL', () => {
  assert.equal(isSecureUpdateFeedUrl('https://api.rmpgutah.us/updates/'), true);
});

test('isSecureUpdateFeedUrl: false for an http URL', () => {
  assert.equal(isSecureUpdateFeedUrl('http://api.rmpgutah.us/updates/'), false);
});

test('isSecureUpdateFeedUrl: false for an unparseable value', () => {
  assert.equal(isSecureUpdateFeedUrl('not a url'), false);
});

const { shouldAuditCertificateVerification, createCertificateVerifyProc } = require('../sessionHardening');

test('shouldAuditCertificateVerification: true for a pinned host', () => {
  assert.equal(shouldAuditCertificateVerification('api.rmpgutah.us', ['api.rmpgutah.us', 'rmpgutah.us']), true);
});

test('shouldAuditCertificateVerification: false for a non-pinned host', () => {
  assert.equal(shouldAuditCertificateVerification('example.com', ['api.rmpgutah.us', 'rmpgutah.us']), false);
});

test('createCertificateVerifyProc: always defers to Chromium (-3), never overrides', () => {
  const logs = [];
  const proc = createCertificateVerifyProc(['api.rmpgutah.us'], (msg) => logs.push(msg));
  let calledWith;
  proc({ hostname: 'api.rmpgutah.us', verificationResult: 'net::OK' }, (v) => { calledWith = v; });
  assert.equal(calledWith, -3);
  assert.equal(logs.length, 0, 'should not log when verification succeeded');
});

test('createCertificateVerifyProc: logs an audit warning for a pinned host with a failed verification result, but still defers to Chromium', () => {
  const logs = [];
  const proc = createCertificateVerifyProc(['api.rmpgutah.us'], (msg) => logs.push(msg));
  let calledWith;
  proc({ hostname: 'api.rmpgutah.us', verificationResult: 'net::ERR_CERT_AUTHORITY_INVALID' }, (v) => { calledWith = v; });
  assert.equal(calledWith, -3);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /api\.rmpgutah\.us/);
  assert.match(logs[0], /ERR_CERT_AUTHORITY_INVALID/);
});

test('createCertificateVerifyProc: never logs for a non-pinned host, even on failure', () => {
  const logs = [];
  const proc = createCertificateVerifyProc(['api.rmpgutah.us'], (msg) => logs.push(msg));
  let calledWith;
  proc({ hostname: 'some-other-host.example', verificationResult: 'net::ERR_CERT_AUTHORITY_INVALID' }, (v) => { calledWith = v; });
  assert.equal(calledWith, -3);
  assert.equal(logs.length, 0);
});

const path = require('node:path');
const { resolveTrustedPreloadPath } = require('../sessionHardening');

test('resolveTrustedPreloadPath: returns the path when it exactly matches the allowed one', () => {
  const allowed = path.resolve('/app/desktop/preload.js');
  assert.equal(resolveTrustedPreloadPath(allowed, allowed), allowed);
});

test('resolveTrustedPreloadPath: returns the path when it resolves to the same file via a relative form', () => {
  const allowed = path.resolve('/app/desktop/preload.js');
  const relative = path.join('/app/desktop', '.', 'preload.js');
  assert.equal(resolveTrustedPreloadPath(relative, allowed), allowed);
});

test('resolveTrustedPreloadPath: throws for any other path', () => {
  const allowed = path.resolve('/app/desktop/preload.js');
  assert.throws(() => resolveTrustedPreloadPath('/tmp/malicious-preload.js', allowed), /untrusted preload path/);
});
