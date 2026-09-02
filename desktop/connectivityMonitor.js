// ============================================================
// RMPG Flex — Connectivity Monitor
// Polls the remote server health endpoint to track online/offline
// state. Debounces transitions to avoid flapping on unstable
// connections. Emits events to the renderer via IPC.
// ============================================================

const { net } = require('electron');
const { isAllowedApiHost } = require('./security/childProcessGuard');

class ConnectivityMonitor {
  constructor(serverUrl, options = {}) {
    this.serverUrl = serverUrl;
    this.pollInterval = options.pollInterval || 10_000;    // 10s default
    this.stableCount = options.stableCount || 3;           // 3 consecutive checks to confirm transition
    this.requestTimeout = options.requestTimeout || 5_000; // 5s timeout per check

    // Health checks go DIRECTLY to the API Worker (api.rmpgutah.us/api/health),
    // which has a Cloudflare WAF skip rule that bypasses the managed challenge.
    // The previous approach (rmpgutah.us/api/health via the strangler proxy)
    // failed at startup because net.request has no cf_clearance cookie before
    // the BrowserWindow solves the challenge, causing the monitor to report
    // the server as unreachable for 30+ seconds after every cold boot.
    this.healthCheckUrl = options.healthCheckUrl || (() => {
      try {
        const host = new URL(serverUrl).hostname;
        return host === 'localhost' || host === '127.0.0.1'
          ? `${serverUrl}/api/health`
          : 'https://api.rmpgutah.us/api/health';
      } catch {
        return `${serverUrl}/api/health`;
      }
    })();

    this._allowedHealthCheckHosts = (() => {
      try {
        const hosts = [new URL(serverUrl).hostname];
        const healthHost = new URL(this.healthCheckUrl).hostname;
        if (!hosts.includes(healthHost)) hosts.push(healthHost);
        return hosts;
      } catch {
        return [];
      }
    })();

    this.isOnline = false;           // Current confirmed state
    this._consecutiveState = 0;      // How many consecutive checks agree
    this._pendingState = false;      // State being confirmed
    this._timer = null;
    this._mainWindow = null;
    this._onTransition = null;       // Callback: (isOnline) => void
    this._checkInProgress = false;   // Guard against overlapping async checks
  }

  /**
   * Start monitoring.
   * @param {BrowserWindow} mainWindow — for sending IPC events to renderer
   * @param {Function} onTransition — called when online/offline state changes
   * @param {Function} [onEachCheck] — called after EVERY raw health check with
   *   (isReachable: boolean). Fires before the debounce/stable-count logic, so
   *   callers can act on the first confirmed positive without waiting for 3
   *   consecutive checks. Use this sparingly — it fires every 10s.
   */
  start(mainWindow, onTransition, onEachCheck) {
    this._mainWindow = mainWindow;
    this._onTransition = onTransition;
    this._onEachCheck = onEachCheck || null;

    // Do an immediate check
    this._check();

    // Then poll on interval
    this._timer = setInterval(() => this._check(), this.pollInterval);
    console.log(`[CONNECTIVITY] Monitoring started (poll every ${this.pollInterval / 1000}s)`);
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    console.log('[CONNECTIVITY] Monitoring stopped');
  }

  /** Force an immediate check and return the result */
  async checkNow() {
    return this._doHealthCheck();
  }

  // ─── Internal ──────────────────────────────────────────────

  async _check() {
    // Guard against overlapping async checks when the health check hangs
    // longer than pollInterval (10s). Without this, multiple concurrent
    // _check() calls can accumulate and produce duplicate transitions.
    if (this._checkInProgress) return;
    this._checkInProgress = true;
    try {
      const reachable = await this._doHealthCheck();

      // Fire the raw per-check callback first (before debounce logic) so callers
      // can react to the first confirmed positive without waiting for stableCount.
      if (this._onEachCheck) {
        try { this._onEachCheck(reachable); } catch { /* never block the monitor */ }
      }

      if (reachable === this._pendingState) {
        this._consecutiveState++;
      } else {
        this._pendingState = reachable;
        this._consecutiveState = 1;
      }

      // Only transition after stable consecutive checks
      if (this._consecutiveState >= this.stableCount && reachable !== this.isOnline) {
        const wasOnline = this.isOnline;
        this.isOnline = reachable;

        console.log(`[CONNECTIVITY] State changed: ${wasOnline ? 'ONLINE' : 'OFFLINE'} → ${reachable ? 'ONLINE' : 'OFFLINE'}`);

        // Notify renderer
        this._emit('offline:connectivity-changed', { isOnline: reachable });

        // Notify main process callback
        if (this._onTransition) {
          this._onTransition(reachable);
        }
      }
    } finally {
      this._checkInProgress = false;
    }
  }

  _doHealthCheck() {
    return new Promise((resolve) => {
      try {
        const url = this.healthCheckUrl;
        if (!isAllowedApiHost(url, this._allowedHealthCheckHosts)) {
          resolve(false);
          return;
        }

        const request = net.request({
          url,
          method: 'GET',
        });

        const timer = setTimeout(() => {
          try { request.abort(); } catch { /* ignore */ }
          resolve(false);
        }, this.requestTimeout);

        request.on('response', (response) => {
          clearTimeout(timer);
          // Consume the response body to avoid memory leaks
          response.on('data', () => {});
          response.on('end', () => {});
          resolve(response.statusCode === 200);
        });

        request.on('error', () => {
          clearTimeout(timer);
          resolve(false);
        });

        request.end();
      } catch {
        resolve(false);
      }
    });
  }

  _emit(channel, data) {
    try {
      if (this._mainWindow && !this._mainWindow.isDestroyed()) {
        this._mainWindow.webContents.send(channel, data);
      }
    } catch {
      // Window may have been destroyed
    }
  }
}

module.exports = { ConnectivityMonitor };
