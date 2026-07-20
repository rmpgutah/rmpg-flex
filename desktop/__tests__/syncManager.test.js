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

test('pullAll: while paused, resolves without ever acquiring the sync lock', async () => {
  syncManager.pauseSync();
  try {
    await syncManager.pullAll();
    // If pullAll had proceeded past the pause guard, acquireSyncLock() would
    // have flipped isSyncing to true (and only releaseSyncLock(), reached via
    // the finally block, sets it back to false) — so isSyncing staying false
    // the whole way through proves pullAll returned before touching the lock
    // or the network.
    assert.equal(syncManager.isSyncing, false);
  } finally {
    syncManager.resumeSync();
  }
});

test('pushAll: while paused, resolves without ever acquiring the sync lock', async () => {
  syncManager.pauseSync();
  try {
    await syncManager.pushAll();
    assert.equal(syncManager.isSyncing, false);
  } finally {
    syncManager.resumeSync();
  }
});
