'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_RENDERER_RECOVERIES,
  RECOVERY_WINDOW_MS,
  isRecoverableCrashReason,
  pruneOldRecoveryTimestamps,
  shouldAutoRecover,
  recordRecoveryAttempt,
} = require('../crashRecovery');

test('isRecoverableCrashReason: treats real crash reasons as recoverable', () => {
  assert.equal(isRecoverableCrashReason('crashed'), true);
  assert.equal(isRecoverableCrashReason('oom'), true);
  assert.equal(isRecoverableCrashReason('abnormal-exit'), true);
  assert.equal(isRecoverableCrashReason('killed'), true);
  assert.equal(isRecoverableCrashReason('launch-failed'), true);
  assert.equal(isRecoverableCrashReason('integrity-failure'), true);
});

test('isRecoverableCrashReason: a normal shutdown is never treated as a crash', () => {
  assert.equal(isRecoverableCrashReason('clean-exit'), false);
});

test('isRecoverableCrashReason: rejects malformed input instead of throwing', () => {
  assert.equal(isRecoverableCrashReason(undefined), false);
  assert.equal(isRecoverableCrashReason(null), false);
  assert.equal(isRecoverableCrashReason(42), false);
});

test('pruneOldRecoveryTimestamps: drops entries outside the window', () => {
  const now = 1_000_000;
  const timestamps = [now - RECOVERY_WINDOW_MS - 1, now - 1000, now];
  assert.deepEqual(pruneOldRecoveryTimestamps(timestamps, now), [now - 1000, now]);
});

test('pruneOldRecoveryTimestamps: treats a missing/malformed array as empty', () => {
  const now = 1_000_000;
  assert.deepEqual(pruneOldRecoveryTimestamps(null, now), []);
  assert.deepEqual(pruneOldRecoveryTimestamps(undefined, now), []);
  assert.deepEqual(pruneOldRecoveryTimestamps(['not a number'], now), []);
});

test('shouldAutoRecover: true while under the cap', () => {
  const now = 1_000_000;
  assert.equal(MAX_RENDERER_RECOVERIES, 3);
  assert.equal(shouldAutoRecover([], now), true);
  assert.equal(shouldAutoRecover([now - 1, now - 2], now), true);
});

test('shouldAutoRecover: false once the cap is reached within the window', () => {
  const now = 1_000_000;
  const timestamps = [now - 3000, now - 2000, now - 1000];
  assert.equal(shouldAutoRecover(timestamps, now), false);
});

test('shouldAutoRecover: old attempts outside the window do not count against the cap', () => {
  const now = 1_000_000;
  // All 3 prior attempts are stale — a fresh crash right now should still recover.
  const timestamps = [
    now - RECOVERY_WINDOW_MS - 1,
    now - RECOVERY_WINDOW_MS - 2,
    now - RECOVERY_WINDOW_MS - 3,
  ];
  assert.equal(shouldAutoRecover(timestamps, now), true);
});

test('recordRecoveryAttempt: appends the new timestamp and prunes stale ones', () => {
  const now = 1_000_000;
  const timestamps = [now - RECOVERY_WINDOW_MS - 1, now - 1000];
  assert.deepEqual(recordRecoveryAttempt(timestamps, now), [now - 1000, now]);
});

test('a full crash-loop cycle: 3 rapid crashes recover, the 4th does not', () => {
  const start = 1_000_000;
  let timestamps = [];
  for (let i = 0; i < MAX_RENDERER_RECOVERIES; i++) {
    const now = start + i * 1000;
    assert.equal(shouldAutoRecover(timestamps, now), true, `attempt ${i + 1} should recover`);
    timestamps = recordRecoveryAttempt(timestamps, now);
  }
  const fourthNow = start + MAX_RENDERER_RECOVERIES * 1000;
  assert.equal(shouldAutoRecover(timestamps, fourthNow), false, 'the 4th rapid crash should not auto-recover');
});

// ─── Manual reload counter-reset contract ─────────────────────
// The F5 / Ctrl+Shift+F5 global hotkeys in main.js reset
// rendererRecoveryTimestamps to [] on press. This verifies that
// an empty array restores full auto-recovery capacity — a
// crash immediately after a manual reload MUST be recoverable.
test('resetting timestamps to [] re-enables full auto-recovery after a crash loop', () => {
  const now = 1_000_000;
  // Fill the cap (simulate a crash loop)
  let timestamps = [];
  for (let i = 0; i < MAX_RENDERER_RECOVERIES; i++) {
    timestamps = recordRecoveryAttempt(timestamps, now + i * 1000);
  }
  assert.equal(shouldAutoRecover(timestamps, now + 10_000), false, 'cap reached before reset');

  // Operator presses F5 — main.js sets rendererRecoveryTimestamps = []
  timestamps = [];
  assert.equal(shouldAutoRecover(timestamps, now + 11_000), true, 'reset restores recovery capacity');
});
