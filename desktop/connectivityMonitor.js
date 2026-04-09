// ============================================================
// RMPG Flex — Connectivity Monitor
// Polls the remote server health endpoint to track online/offline
// state. Debounces transitions to avoid flapping on unstable
// connections. Emits events to the renderer via IPC.
// ============================================================

const { net } = require('electron');

class ConnectivityMonitor {
  constructor(serverUrl, options = {}) {
    this.serverUrl = serverUrl;
    this.pollInterval = options.pollInterval || 10_000;    // 10s default
    this.stableCount = options.stableCount || 3;           // 3 consecutive checks to confirm transition
    this.requestTimeout = options.requestTimeout || 5_000; // 5s timeout per check

    this.isOnline = false;           // Current confirmed state
    this._consecutiveState = 0;      // How many consecutive checks agree
    this._pendingState = false;      // State being confirmed
    this._timer = null;
    this._mainWindow = null;
    this._onTransition = null;       // Callback: (isOnline) => void
  }

  /**
   * Start monitoring.
   * @param {BrowserWindow} mainWindow — for sending IPC events to renderer
   * @param {Function} onTransition — called when online/offline state changes
   */
  start(mainWindow, onTransition) {
    this._mainWindow = mainWindow;
    this._onTransition = onTransition;

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
    const reachable = await this._doHealthCheck();

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
  }

  _doHealthCheck() {
    return new Promise((resolve) => {
      try {
        const request = net.request({
          url: `${this.serverUrl}/api/health`,
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
