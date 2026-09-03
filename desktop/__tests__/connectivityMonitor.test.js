'use strict';

// ConnectivityMonitor tests — pure logic only.
// net.request and Electron bindings are not available in Node test context,
// so we monkey-patch the internal _doHealthCheck to control reachability.

const test = require('node:test');
const assert = require('node:assert/strict');

// Provide a minimal stub for the Electron 'electron' module so the require
// inside connectivityMonitor.js doesn't throw in a non-Electron process.
// We only need net to be present (even as an empty object) since
// _doHealthCheck is overridden in every test.
const Module = require('module');
const _originalLoad = Module._load;
// Stub both Electron (not available in Node) and childProcessGuard (uses Electron internals).
Module._load = function (request, ...args) {
  if (request === 'electron') return { net: {} };
  if (request === './security/childProcessGuard') return { isAllowedApiHost: () => true };
  return _originalLoad.call(this, request, ...args);
};

const { ConnectivityMonitor } = require('../connectivityMonitor');

// ─── onEachCheck callback ──────────────────────────────────────

test('onEachCheck: fires on every raw health check before debounce logic', async () => {
  const monitor = new ConnectivityMonitor('https://example.com', { stableCount: 3 });
  const calls = [];

  // Override network call to always return true
  monitor._doHealthCheck = async () => true;

  let resolveFirst;
  const firstCall = new Promise((r) => { resolveFirst = r; });

  monitor.start(
    null, // no mainWindow needed
    () => {}, // onTransition — we don't care about debounced transitions here
    (isReachable) => {
      calls.push(isReachable);
      resolveFirst(isReachable);
    }
  );

  const result = await firstCall;
  monitor.stop();

  assert.equal(result, true, 'onEachCheck received true from the raw health check');
  assert.ok(calls.length >= 1, 'at least one raw check fired');
});

test('onEachCheck: receives false when the server is unreachable', async () => {
  const monitor = new ConnectivityMonitor('https://example.com', { stableCount: 3 });

  monitor._doHealthCheck = async () => false;

  let resolveFirst;
  const firstCall = new Promise((r) => { resolveFirst = r; });

  monitor.start(null, () => {}, (isReachable) => { resolveFirst(isReachable); });

  const result = await firstCall;
  monitor.stop();

  assert.equal(result, false);
});

test('onEachCheck: fires even when stableCount is not yet reached (debounce bypass)', async () => {
  // stableCount=999 means onTransition would never fire in a short test
  const monitor = new ConnectivityMonitor('https://example.com', { stableCount: 999 });
  const transitionCalls = [];
  const rawCalls = [];

  monitor._doHealthCheck = async () => true;

  let resolveFirst;
  const firstRaw = new Promise((r) => { resolveFirst = r; });

  monitor.start(
    null,
    (online) => transitionCalls.push(online),
    (isReachable) => { rawCalls.push(isReachable); resolveFirst(); }
  );

  await firstRaw;
  monitor.stop();

  assert.equal(transitionCalls.length, 0, 'onTransition should not have fired (stableCount not reached)');
  assert.ok(rawCalls.length >= 1, 'onEachCheck fired despite stableCount not reached');
});

test('onEachCheck: missing callback is silently ignored', async () => {
  const monitor = new ConnectivityMonitor('https://example.com', { stableCount: 3 });
  monitor._doHealthCheck = async () => true;

  let fired = false;
  let resolveTransition;
  const transitionDone = new Promise((r) => { resolveTransition = r; });

  // Provide onTransition but no onEachCheck — should not throw
  monitor.start(null, (online) => {
    fired = true;
    resolveTransition();
  });

  // Trigger enough checks for the debounce to trip
  for (let i = 0; i < 3; i++) {
    await monitor._check();
  }
  monitor.stop();

  assert.equal(fired, true, 'onTransition still fires normally without onEachCheck');
});
