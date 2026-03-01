// ============================================================
// RMPG Flex — Connectivity Monitor
// Polls the remote server health endpoint every 10 seconds.
// Emits connectivity state changes to the renderer process.
// On offline→online transition, triggers push sync.
// ============================================================

const https = require('https');
const { BrowserWindow } = require('electron');

const REMOTE_SERVER = 'rmpgutah.us';
const POLL_INTERVAL = 10_000; // 10 seconds
const STABLE_CHECKS = 3; // Must be stable for 3 consecutive checks

let isOnline = true; // Assume online until proven otherwise
let pollHandle = null;
let consecutiveState = 0; // Count of consecutive same-state results
let pendingState = true;
let onTransitionCallback = null;

function start(onTransition) {
  if (pollHandle) return;
  onTransitionCallback = onTransition || null;

  console.log('[Connectivity] Starting monitor — polling', REMOTE_SERVER, 'every', POLL_INTERVAL / 1000, 's');

  pollHandle = setInterval(checkHealth, POLL_INTERVAL);
  // Initial check after 2 seconds
  setTimeout(checkHealth, 2000);
}

function stop() {
  if (pollHandle) {
    clearInterval(pollHandle);
    pollHandle = null;
    console.log('[Connectivity] Monitor stopped');
  }
}

function getState() {
  return isOnline;
}

function checkHealth() {
  const req = https.request({
    hostname: REMOTE_SERVER,
    port: 443,
    path: '/api/health',
    method: 'GET',
    timeout: 5000,
    rejectUnauthorized: false,
  }, (res) => {
    const newState = res.statusCode === 200;
    handleCheckResult(newState);
  });

  req.on('error', () => handleCheckResult(false));
  req.on('timeout', () => {
    req.destroy();
    handleCheckResult(false);
  });
  req.end();
}

function handleCheckResult(currentlyOnline) {
  if (currentlyOnline === pendingState) {
    consecutiveState++;
  } else {
    pendingState = currentlyOnline;
    consecutiveState = 1;
  }

  // Only change state after STABLE_CHECKS consecutive results
  if (consecutiveState >= STABLE_CHECKS && pendingState !== isOnline) {
    const wasOnline = isOnline;
    isOnline = pendingState;

    console.log('[Connectivity]', wasOnline ? 'ONLINE → OFFLINE' : 'OFFLINE → ONLINE');

    // Notify all renderer windows
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('offline:connectivity-changed', { isOnline });
      }
    }

    // Trigger sync callback on offline→online transition
    if (isOnline && !wasOnline && onTransitionCallback) {
      console.log('[Connectivity] Connection restored — triggering sync');
      try { onTransitionCallback(); } catch (err) {
        console.error('[Connectivity] Sync callback error:', err.message);
      }
    }
  }
}

// Force a state for testing
function forceState(online) {
  const wasOnline = isOnline;
  isOnline = online;
  pendingState = online;
  consecutiveState = STABLE_CHECKS;
  if (wasOnline !== online) {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('offline:connectivity-changed', { isOnline });
      }
    }
  }
}

module.exports = { start, stop, getState, forceState };
