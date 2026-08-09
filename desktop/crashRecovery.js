// ============================================================
// RMPG Flex — Renderer/GPU crash recovery pure helpers
// No Electron dependency — unit-testable in isolation, matching
// the windowManager.js / deviceInfo.js / kioskShell.js convention.
// ============================================================
//
// Electron's main process has NO automatic recovery from a renderer or GPU
// process crash: `render-process-gone` / `child-process-gone` just fire an
// event and leave the window exactly as dead as the process that backed it.
// The client's own WebGL context-loss watchdog (client/src/utils/
// webglRecovery.ts) can't help here either — that code runs INSIDE the
// renderer, and by definition can't run once the renderer itself is gone.
// Reported live 2026-08-10: in-vehicle Toughbooks with a crashed renderer
// showed a permanently dead map that a normal page reload couldn't recover
// (the reload command has nowhere to go once its own process is dead),
// forcing a full app restart with no console access to diagnose why.
//
// This module tracks recovery attempts in a rolling time window (same shape
// as webglRecovery.ts's rebuildTimes/maxRebuilds/rebuildWindowMs) so main.js
// can auto-reload the window on a crash, but stop and surface a clear
// "needs a restart" screen instead of silently crash-looping forever if a
// unit's GPU/driver is genuinely, repeatedly failing.

'use strict';

/** Max automatic recoveries allowed within RECOVERY_WINDOW_MS before giving up. */
const MAX_RENDERER_RECOVERIES = 3;

/** Rolling window (ms) for the recovery cap. 5 minutes: real GPU driver
 *  resets in the field are rare and spaced out; several within minutes
 *  means a genuinely failing unit, not routine transient loss. */
const RECOVERY_WINDOW_MS = 5 * 60 * 1000;

/** `render-process-gone` / `child-process-gone` reasons worth an automatic
 *  reload. Deliberately excludes 'clean-exit' (normal app.quit()) so a
 *  regular shutdown never gets misread as a crash needing recovery. */
const RECOVERABLE_CRASH_REASONS = new Set([
  'crashed', 'oom', 'abnormal-exit', 'killed', 'launch-failed', 'integrity-failure',
]);

function isRecoverableCrashReason(reason) {
  return typeof reason === 'string' && RECOVERABLE_CRASH_REASONS.has(reason);
}

/** Drops timestamps outside the rolling window. Treats a missing/malformed
 *  timestamps array as empty rather than throwing — a corrupted recovery
 *  log must never itself block recovery. */
function pruneOldRecoveryTimestamps(timestamps, now, windowMs = RECOVERY_WINDOW_MS) {
  const list = Array.isArray(timestamps) ? timestamps : [];
  return list.filter((t) => typeof t === 'number' && now - t <= windowMs);
}

/** True while fewer than maxRecoveries attempts have landed within the
 *  rolling window — checked BEFORE reloading on each crash. */
function shouldAutoRecover(timestamps, now, maxRecoveries = MAX_RENDERER_RECOVERIES, windowMs = RECOVERY_WINDOW_MS) {
  return pruneOldRecoveryTimestamps(timestamps, now, windowMs).length < maxRecoveries;
}

/** Records a new recovery attempt, returning the pruned + appended list for
 *  the caller to store back into its running state. */
function recordRecoveryAttempt(timestamps, now, windowMs = RECOVERY_WINDOW_MS) {
  return [...pruneOldRecoveryTimestamps(timestamps, now, windowMs), now];
}

module.exports = {
  MAX_RENDERER_RECOVERIES,
  RECOVERY_WINDOW_MS,
  RECOVERABLE_CRASH_REASONS,
  isRecoverableCrashReason,
  pruneOldRecoveryTimestamps,
  shouldAutoRecover,
  recordRecoveryAttempt,
};
