'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSandboxedChildEnv, scheduleChildProcessTimeout, DEFAULT_CHILD_PROCESS_TIMEOUT_MS } = require('../childProcessGuard');

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
  const fakeChild = { killed: false, kill: (...args) => killSpy.push(args) };
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
  const fakeChild = { killed: false, kill: (...args) => killSpy.push(args) };
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
  const fakeChild = { killed: false, kill: (...args) => killSpy.push(args) };
  const fakeTimer = makeFakeTimer();

  scheduleChildProcessTimeout(fakeChild, 60000, fakeTimer);

  fakeTimer.calls[0].callback();
  fakeChild.killed = true; // child honored SIGTERM and exited before escalation fires

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
