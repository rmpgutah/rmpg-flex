'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const syncManager = require('../syncManager');

test('pauseSync: sets isPaused to true', () => {
  syncManager.resumeSync(); // start from a known state
  syncManager.pauseSync();
  assert.equal(syncManager.isPaused, true);
});

test('resumeSync: sets isPaused back to false', () => {
  syncManager.pauseSync();
  assert.equal(syncManager.isPaused, true);
  syncManager.resumeSync();
  assert.equal(syncManager.isPaused, false);
});

test('pullAll: while paused, its own guard fires before acquireSyncLock() ever runs', () => {
  // NOTE on why this is NOT the same (weaker) check as before: checking
  // `isSyncing === false` only *after* pullAll() resolves can't tell "the
  // isPaused guard returned immediately" apart from "the guard was missing,
  // real work ran, and releaseSyncLock() in the `finally` block cleaned up
  // afterwards" — both land on isSyncing === false at that point. This test
  // instead reads isSyncing SYNCHRONOUSLY, in the same tick as the call,
  // before pullAll() has had any chance to yield to the microtask queue.
  //
  // `pullAll` is `async function pullAll() { if (isPaused) return; if
  // (!acquireSyncLock()) return; ... await pullTable(table) ... }` —
  // acquireSyncLock() is a plain synchronous call with no `await` before it,
  // so calling pullAll() (without awaiting it) runs synchronously through the
  // guard check and, if the guard does NOT fire, straight into
  // acquireSyncLock() (which flips isSyncing to true) before the function can
  // suspend at its first `await`. So immediately after invoking pullAll():
  //   - guard present (correct behavior): isSyncing is still false — pullAll
  //     returned on its very first line and never reached acquireSyncLock().
  //   - guard removed (regression): isSyncing already reads true — proven
  //     empirically by temporarily deleting the guard and observing this
  //     assertion flip (see task verification notes).
  // This is deliberately independent of pullTable()'s own separate isPaused
  // guard (which also happens to fire here, since this test pauses first) —
  // it isolates pullAll()'s own top-level guard specifically.
  syncManager.resumeSync();
  syncManager.pauseSync();
  const pending = syncManager.pullAll();
  assert.equal(syncManager.isSyncing, false);
  return pending.finally(() => syncManager.resumeSync());
});

test('pushAll: while paused, its own guard fires before any local-DB access', async () => {
  // Same underlying problem as pullAll's old test: `isSyncing === false`
  // after the fact doesn't distinguish "guard returned immediately" from
  // "guard was missing but the finally block released the lock anyway".
  //
  // The discriminator used here: this test harness never runs a live
  // Electron app, so localDb.initLocalDb() is never called and localDb's
  // internal `db` handle stays null for the life of the process. Any push
  // path that gets past the isPaused guard immediately calls
  // getQueueDepth(), which does `db.prepare(...)` on that null handle and
  // throws synchronously — before pushAll() ever reaches an `await` — so the
  // rejection propagates straight out of pushAll() (the lock's `finally`
  // release can't mask it into a clean resolve the way it could once real
  // async work was involved). That means, in this harness, "pushAll()
  // resolves without rejecting" while paused is only possible if the guard
  // returned before touching local state at all. Verified empirically: with
  // the isPaused guard temporarily removed, pushAll() here rejects with
  // "Cannot read properties of null (reading 'prepare')" instead of
  // resolving — flipping this assertion to a failure.
  syncManager.resumeSync();
  syncManager.pauseSync();
  try {
    await assert.doesNotReject(() => syncManager.pushAll());
    assert.equal(syncManager.isSyncing, false);
  } finally {
    syncManager.resumeSync();
  }
});
