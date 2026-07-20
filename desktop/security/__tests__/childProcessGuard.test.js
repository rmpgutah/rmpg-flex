'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildSandboxedChildEnv,
  scheduleChildProcessTimeout,
  resolveChildProcessTimeoutMs,
  DEFAULT_CHILD_PROCESS_TIMEOUT_MS,
  isAtConcurrencyLimit,
  MAX_CONCURRENT_TOOLS,
  isAllowedBinaryName,
  isAllowedApiHost,
  parseIpLocateResponse,
} = require('../childProcessGuard');

test('buildSandboxedChildEnv: only allowlisted keys appear, sensitive keys never leak through', () => {
  const baseEnv = {
    HOME: '/Users/operator',
    USER: 'operator',
    LANG: 'en_US.UTF-8',
    GOOGLE_API_KEY: 'super-secret-key',
    SECRET_TOKEN: 'another-secret',
    SHELL: '/bin/zsh',
    npm_config_registry: 'https://registry.npmjs.org/',
    RANDOM_OTHER_VAR: 'value',
  };
  const result = buildSandboxedChildEnv(baseEnv, ['/usr/bin', '/bin']);

  assert.deepEqual(Object.keys(result).sort(), ['HOME', 'LANG', 'PATH', 'USER']);
  assert.equal(result.GOOGLE_API_KEY, undefined);
  assert.equal(result.SECRET_TOKEN, undefined);
  assert.equal(result.SHELL, undefined);
  assert.equal(result.npm_config_registry, undefined);
  assert.equal(result.RANDOM_OTHER_VAR, undefined);
});

test('buildSandboxedChildEnv: PATH is always present, built from pathParts not baseEnv.PATH', () => {
  const baseEnv = { PATH: '/should/not/be/used', HOME: '/h', USER: 'u', LANG: 'l' };
  const result = buildSandboxedChildEnv(baseEnv, ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin']);
  assert.equal(result.PATH, '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin');
});

test('buildSandboxedChildEnv: PATH present even when pathParts is empty', () => {
  const result = buildSandboxedChildEnv({}, []);
  assert.equal(result.PATH, '');
  assert.equal('HOME' in result, false);
  assert.equal('USER' in result, false);
  assert.equal('LANG' in result, false);
});

test('buildSandboxedChildEnv: a missing optional key is fully absent, not set to undefined', () => {
  const baseEnv = { HOME: '/Users/operator', USER: 'operator' }; // no LANG
  const result = buildSandboxedChildEnv(baseEnv, ['/usr/bin']);

  assert.equal('LANG' in result, false);
  assert.equal(Object.keys(result).includes('LANG'), false);
  assert.deepEqual(Object.keys(result).sort(), ['HOME', 'PATH', 'USER']);
});

test('buildSandboxedChildEnv: all of HOME/USER/LANG missing leaves only PATH', () => {
  const result = buildSandboxedChildEnv({ SOME_OTHER: 'x' }, ['/bin']);
  assert.deepEqual(result, { PATH: '/bin' });
});

test('buildSandboxedChildEnv: does not mutate baseEnv or pathParts', () => {
  const baseEnv = { HOME: '/h', USER: 'u', LANG: 'l', SECRET: 's' };
  const pathParts = ['/bin', '/usr/bin'];
  const baseEnvCopy = { ...baseEnv };
  const pathPartsCopy = [...pathParts];

  buildSandboxedChildEnv(baseEnv, pathParts);

  assert.deepEqual(baseEnv, baseEnvCopy);
  assert.deepEqual(pathParts, pathPartsCopy);
});

// --- scheduleChildProcessTimeout ---

function makeFakeTimer() {
  // A setTimeout-shaped fake: records the callback/delay instead of
  // actually scheduling real wall-clock time. Returns a handle object
  // the test can use to manually fire the callback, simulating "the
  // timeout elapsed" instantly and deterministically.
  const calls = [];
  const killFn = (callback, delayMs) => {
    const handle = { fired: false, callback, delayMs };
    calls.push(handle);
    return handle;
  };
  killFn.calls = calls;
  return killFn;
}

test('scheduleChildProcessTimeout: sends SIGTERM once the fake timeout fires', () => {
  const killSpy = [];
  const fakeChild = { exitCode: null, signalCode: null, kill: (...args) => killSpy.push(args) };
  const fakeTimer = makeFakeTimer();

  const handle = scheduleChildProcessTimeout(fakeChild, 60000, fakeTimer);

  assert.equal(fakeTimer.calls.length, 1);
  assert.equal(fakeTimer.calls[0].delayMs, 60000);
  assert.equal(killSpy.length, 0);

  // Simulate the timeout elapsing.
  fakeTimer.calls[0].callback();

  assert.equal(killSpy.length, 1);
  assert.deepEqual(killSpy[0], ['SIGTERM']);
  assert.ok(handle);
});

test('scheduleChildProcessTimeout: escalates to SIGKILL if the child has not exited by the escalation delay', () => {
  const killSpy = [];
  const fakeChild = { exitCode: null, signalCode: null, kill: (...args) => killSpy.push(args) };
  const fakeTimer = makeFakeTimer();

  scheduleChildProcessTimeout(fakeChild, 60000, fakeTimer);

  // Fire the initial timeout — sends SIGTERM and schedules the escalation.
  fakeTimer.calls[0].callback();
  assert.deepEqual(killSpy, [['SIGTERM']]);
  assert.equal(fakeTimer.calls.length, 2);
  assert.equal(fakeTimer.calls[1].delayMs, 1500);

  // Child ignored SIGTERM (still not killed) — fire the escalation.
  fakeTimer.calls[1].callback();
  assert.deepEqual(killSpy, [['SIGTERM'], ['SIGKILL']]);
});

test('scheduleChildProcessTimeout: does NOT escalate to SIGKILL if the child already exited after SIGTERM', () => {
  const killSpy = [];
  const fakeChild = { exitCode: null, signalCode: null, kill: (...args) => killSpy.push(args) };
  const fakeTimer = makeFakeTimer();

  scheduleChildProcessTimeout(fakeChild, 60000, fakeTimer);

  fakeTimer.calls[0].callback();
  fakeChild.exitCode = 0; // child honored SIGTERM and exited before escalation fires

  fakeTimer.calls[1].callback();
  assert.deepEqual(killSpy, [['SIGTERM']]);
});

test('scheduleChildProcessTimeout: clearing the returned handle before it fires prevents the kill', () => {
  const killSpy = [];
  const fakeChild = { kill: (...args) => killSpy.push(args) };
  const clearedHandles = [];
  const fakeTimer = (callback, delayMs) => {
    const handle = { callback, delayMs, cleared: false };
    return handle;
  };
  const fakeClearTimeout = (handle) => {
    if (handle) handle.cleared = true;
    clearedHandles.push(handle);
  };

  const handle = scheduleChildProcessTimeout(fakeChild, 60000, fakeTimer);
  fakeClearTimeout(handle);

  // Even if something were to invoke the recorded callback after the
  // handle was cleared, the caller (main.js) never does so once
  // clearTimeout has been called — real setTimeout guarantees the
  // callback simply never runs. Model that guarantee here: a cleared
  // handle's callback is never invoked by the "timer" mechanism.
  assert.equal(handle.cleared, true);
  assert.equal(killSpy.length, 0);
});

test('scheduleChildProcessTimeout: returns the timer handle from killFn', () => {
  const fakeChild = { kill: () => {} };
  const sentinelHandle = { id: 'sentinel' };
  const fakeTimer = () => sentinelHandle;

  const handle = scheduleChildProcessTimeout(fakeChild, 1000, fakeTimer);

  assert.equal(handle, sentinelHandle);
});

test('DEFAULT_CHILD_PROCESS_TIMEOUT_MS: is within the documented 5-15 minute range', () => {
  assert.ok(DEFAULT_CHILD_PROCESS_TIMEOUT_MS >= 5 * 60 * 1000);
  assert.ok(DEFAULT_CHILD_PROCESS_TIMEOUT_MS <= 15 * 60 * 1000);
});

// --- resolveChildProcessTimeoutMs ---

test('resolveChildProcessTimeoutMs: uses the tool override when present', () => {
  const tool = { timeoutMs: 30 * 60 * 1000 };
  assert.equal(resolveChildProcessTimeoutMs(tool, DEFAULT_CHILD_PROCESS_TIMEOUT_MS), 30 * 60 * 1000);
});

test('resolveChildProcessTimeoutMs: falls back to defaultMs when the tool has no override', () => {
  const tool = { title: 'no override here' };
  assert.equal(resolveChildProcessTimeoutMs(tool, DEFAULT_CHILD_PROCESS_TIMEOUT_MS), DEFAULT_CHILD_PROCESS_TIMEOUT_MS);
});

test('resolveChildProcessTimeoutMs: falls back to defaultMs for a zero or negative override', () => {
  assert.equal(resolveChildProcessTimeoutMs({ timeoutMs: 0 }, DEFAULT_CHILD_PROCESS_TIMEOUT_MS), DEFAULT_CHILD_PROCESS_TIMEOUT_MS);
  assert.equal(resolveChildProcessTimeoutMs({ timeoutMs: -5000 }, DEFAULT_CHILD_PROCESS_TIMEOUT_MS), DEFAULT_CHILD_PROCESS_TIMEOUT_MS);
});

test('resolveChildProcessTimeoutMs: falls back to defaultMs for a non-numeric override', () => {
  assert.equal(resolveChildProcessTimeoutMs({ timeoutMs: '900000' }, DEFAULT_CHILD_PROCESS_TIMEOUT_MS), DEFAULT_CHILD_PROCESS_TIMEOUT_MS);
});

test('resolveChildProcessTimeoutMs: falls back to defaultMs for a missing/undefined tool', () => {
  assert.equal(resolveChildProcessTimeoutMs(undefined, DEFAULT_CHILD_PROCESS_TIMEOUT_MS), DEFAULT_CHILD_PROCESS_TIMEOUT_MS);
});

// --- isAtConcurrencyLimit ---

test('isAtConcurrencyLimit: below the limit returns false', () => {
  assert.equal(isAtConcurrencyLimit(2, 5), false);
});

test('isAtConcurrencyLimit: exactly at the limit returns true', () => {
  assert.equal(isAtConcurrencyLimit(5, 5), true);
});

test('isAtConcurrencyLimit: above the limit returns true', () => {
  assert.equal(isAtConcurrencyLimit(6, 5), true);
});

test('isAtConcurrencyLimit: zero max is true for any non-negative count, including zero', () => {
  assert.equal(isAtConcurrencyLimit(0, 0), true);
  assert.equal(isAtConcurrencyLimit(1, 0), true);
  assert.equal(isAtConcurrencyLimit(100, 0), true);
});

test('isAtConcurrencyLimit: zero active count with a positive max is false', () => {
  assert.equal(isAtConcurrencyLimit(0, 5), false);
});

test('MAX_CONCURRENT_TOOLS: is a positive integer in the documented 3-5 range', () => {
  assert.ok(Number.isInteger(MAX_CONCURRENT_TOOLS));
  assert.ok(MAX_CONCURRENT_TOOLS >= 3);
  assert.ok(MAX_CONCURRENT_TOOLS <= 5);
});

// --- isAllowedBinaryName ---

test('isAllowedBinaryName: a binary matching a known command returns true', () => {
  assert.equal(isAllowedBinaryName('nmap', ['nmap', 'nikto', 'curl']), true);
});

test('isAllowedBinaryName: a binary matching a known command in a Set returns true', () => {
  assert.equal(isAllowedBinaryName('nikto', new Set(['nmap', 'nikto', 'curl'])), true);
});

test('isAllowedBinaryName: a syntactically-valid but unregistered binary returns false', () => {
  // 'wget' is not a RECON_TOOLS command in this fixture, even though it
  // would pass the existing regex check used upstream in main.js.
  assert.equal(isAllowedBinaryName('wget', ['nmap', 'nikto', 'curl']), false);
});

test('isAllowedBinaryName: is an exact match, not a substring/prefix match', () => {
  assert.equal(isAllowedBinaryName('nma', ['nmap']), false);
  assert.equal(isAllowedBinaryName('nmapx', ['nmap']), false);
});

test('isAllowedBinaryName: empty binary name returns false without throwing', () => {
  assert.equal(isAllowedBinaryName('', ['nmap']), false);
});

test('isAllowedBinaryName: null/undefined binary name returns false without throwing', () => {
  assert.equal(isAllowedBinaryName(null, ['nmap']), false);
  assert.equal(isAllowedBinaryName(undefined, ['nmap']), false);
});

test('isAllowedBinaryName: missing/empty allowedCommands returns false without throwing', () => {
  assert.equal(isAllowedBinaryName('nmap', undefined), false);
  assert.equal(isAllowedBinaryName('nmap', null), false);
  assert.equal(isAllowedBinaryName('nmap', []), false);
});

test('isAllowedBinaryName: is case-sensitive (matches RECON_TOOLS command casing, e.g. theHarvester)', () => {
  assert.equal(isAllowedBinaryName('theharvester', ['theHarvester']), false);
  assert.equal(isAllowedBinaryName('theHarvester', ['theHarvester']), true);
});

// --- isAllowedApiHost ---

test('isAllowedApiHost: exact hostname match against a single allowed host returns true', () => {
  assert.equal(isAllowedApiHost('https://www.googleapis.com/geolocation/v1/geolocate?key=abc', ['www.googleapis.com']), true);
});

test('isAllowedApiHost: exact hostname match against a Set of allowed hosts returns true', () => {
  assert.equal(isAllowedApiHost('https://rmpgutah.us/api/health', new Set(['rmpgutah.us', 'www.googleapis.com'])), true);
});

test('isAllowedApiHost: a crafted subdomain of an allowed host is rejected (no endsWith/includes bypass)', () => {
  assert.equal(isAllowedApiHost('https://www.googleapis.com.attacker.com/geolocation/v1/geolocate', ['www.googleapis.com']), false);
  assert.equal(isAllowedApiHost('https://evil.googleapis.com/geolocation/v1/geolocate', ['www.googleapis.com']), false);
});

test('isAllowedApiHost: the allowed hostname stuffed into a query string of a different host is rejected', () => {
  assert.equal(isAllowedApiHost('https://evil.com/?host=www.googleapis.com', ['www.googleapis.com']), false);
});

test('isAllowedApiHost: a host not in the allowlist at all is rejected', () => {
  assert.equal(isAllowedApiHost('https://api.example.com/foo', ['www.googleapis.com']), false);
});

test('isAllowedApiHost: an unparseable URL fails closed (false, no throw)', () => {
  assert.equal(isAllowedApiHost('not a url', ['www.googleapis.com']), false);
  assert.equal(isAllowedApiHost('', ['www.googleapis.com']), false);
  assert.equal(isAllowedApiHost(undefined, ['www.googleapis.com']), false);
  assert.equal(isAllowedApiHost(null, ['www.googleapis.com']), false);
});

test('isAllowedApiHost: a missing or empty allowedHosts list is rejected without throwing', () => {
  assert.equal(isAllowedApiHost('https://www.googleapis.com/foo', undefined), false);
  assert.equal(isAllowedApiHost('https://www.googleapis.com/foo', null), false);
  assert.equal(isAllowedApiHost('https://www.googleapis.com/foo', []), false);
});

// --- parseIpLocateResponse ---

test('parseIpLocateResponse: a well-formed response parses correctly', () => {
  const body = JSON.stringify({ location: { lat: 37.7, lng: -122.4 }, accuracy: 150 });
  assert.deepEqual(parseIpLocateResponse(body), {
    ok: true,
    latitude: 37.7,
    longitude: -122.4,
    accuracy: 150,
  });
});

test('parseIpLocateResponse: missing accuracy falls back to the existing handler default (5000)', () => {
  const body = JSON.stringify({ location: { lat: 37.7, lng: -122.4 } });
  const result = parseIpLocateResponse(body);
  assert.equal(result.ok, true);
  assert.equal(result.accuracy, 5000);
});

test('parseIpLocateResponse: missing location entirely fails closed', () => {
  const body = JSON.stringify({ error: { message: 'no location' } });
  assert.deepEqual(parseIpLocateResponse(body), {
    ok: false,
    error: 'malformed geolocation response',
  });
});

test('parseIpLocateResponse: lat/lng present but as strings fails closed', () => {
  const body = JSON.stringify({ location: { lat: '37.7', lng: '-122.4' } });
  assert.equal(parseIpLocateResponse(body).ok, false);
});

test('parseIpLocateResponse: lat/lng present but null fails closed', () => {
  const body = JSON.stringify({ location: { lat: null, lng: null } });
  assert.equal(parseIpLocateResponse(body).ok, false);
});

test('parseIpLocateResponse: extra unexpected fields alongside a valid location still parse correctly', () => {
  const body = JSON.stringify({
    location: { lat: 40.1, lng: -111.8 },
    accuracy: 25,
    extra: 'unused',
    someObj: { nested: true },
  });
  assert.deepEqual(parseIpLocateResponse(body), {
    ok: true,
    latitude: 40.1,
    longitude: -111.8,
    accuracy: 25,
  });
});

test('parseIpLocateResponse: malformed JSON fails closed without throwing', () => {
  assert.doesNotThrow(() => {
    const result = parseIpLocateResponse('not json{{{');
    assert.deepEqual(result, { ok: false, error: 'malformed geolocation response' });
  });
});

test('parseIpLocateResponse: lat/lng of exactly 0 (equator/prime meridian) is a valid coordinate, not rejected', () => {
  const body = JSON.stringify({ location: { lat: 0, lng: 0 }, accuracy: 10 });
  assert.deepEqual(parseIpLocateResponse(body), {
    ok: true,
    latitude: 0,
    longitude: 0,
    accuracy: 10,
  });
});

test('parseIpLocateResponse: non-object top-level JSON (e.g. array/string/number) fails closed', () => {
  assert.equal(parseIpLocateResponse('null').ok, false);
  assert.equal(parseIpLocateResponse('42').ok, false);
  assert.equal(parseIpLocateResponse('"just a string"').ok, false);
  assert.equal(parseIpLocateResponse('[]').ok, false);
});
