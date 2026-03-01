// ============================================================
// RMPG Flex — Auto-Update Manager
// Wraps electron-updater to check the RMPG Flex server for
// new desktop app versions and install them automatically.
// ============================================================

const { autoUpdater } = require('electron-updater');
const { app, BrowserWindow, ipcMain } = require('electron');

class AppUpdater {
  constructor() {
    this.serverUrl = null;
    this.updateCheckInterval = null;
    this.isUpdateInProgress = false;
    this.downloadProgress = 0;
    this.initialized = false;
  }

  /**
   * Initialize the updater with the server URL.
   * Call AFTER the server is confirmed running and mainWindow is created.
   *
   * @param {string} serverUrl - e.g. "http://localhost:3001" or "https://rmpgutah.us"
   */
  init(serverUrl) {
    if (this.initialized) return;
    this.initialized = true;
    this.serverUrl = serverUrl;

    console.log('[UPDATER] Initializing with server:', serverUrl);

    // ─── Configure electron-updater ───────────────────
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowDowngrade = false;
    autoUpdater.allowPrerelease = false;

    // Point at the RMPG Flex server's update endpoint
    // electron-updater will fetch latest.yml / latest-mac.yml from this URL
    autoUpdater.setFeedURL({
      provider: 'generic',
      url: `${serverUrl}/updates`,
      useMultipleRangeRequest: false,
    });

    // ─── Event handlers ───────────────────────────────
    this._setupEventHandlers();

    // ─── IPC handlers from renderer ───────────────────
    ipcMain.on('updater:check', () => {
      console.log('[UPDATER] Manual check triggered from renderer');
      this.checkForUpdates();
    });

    ipcMain.on('updater:install', () => {
      console.log('[UPDATER] Install triggered from renderer');
      autoUpdater.quitAndInstall(false, true);
    });

    // ─── Start checking ───────────────────────────────
    // Initial check after a short delay (let the app settle)
    setTimeout(() => this.checkForUpdates(), 5000);

    // Periodic check every 2 minutes
    this.updateCheckInterval = setInterval(() => {
      this.checkForUpdates();
    }, 2 * 60 * 1000);
  }

  /**
   * Check for updates. Safe to call multiple times.
   */
  async checkForUpdates() {
    if (this.isUpdateInProgress) {
      console.log('[UPDATER] Update already in progress, skipping check');
      return;
    }

    try {
      console.log('[UPDATER] Checking for updates...');
      await autoUpdater.checkForUpdates();
    } catch (err) {
      console.error('[UPDATER] Check failed:', err.message);
      this._sendToRenderer('update-status', {
        status: 'error',
        message: err.message,
      });
    }
  }

  /**
   * Set up all autoUpdater event handlers.
   */
  _setupEventHandlers() {
    autoUpdater.on('checking-for-update', () => {
      console.log('[UPDATER] Checking for update...');
      this._sendToRenderer('update-status', { status: 'checking' });
    });

    autoUpdater.on('update-available', (info) => {
      console.log(`[UPDATER] Update available: v${info.version}`);
      this.isUpdateInProgress = true;
      this._sendToRenderer('update-status', {
        status: 'available',
        version: info.version,
        releaseDate: info.releaseDate,
      });
    });

    autoUpdater.on('update-not-available', (info) => {
      console.log(`[UPDATER] App is up to date (v${info.version})`);
      this._sendToRenderer('update-status', {
        status: 'up-to-date',
        version: info.version,
      });
    });

    autoUpdater.on('download-progress', (progress) => {
      this.downloadProgress = progress.percent;
      const pct = Math.round(progress.percent);
      if (pct % 10 === 0) {
        console.log(`[UPDATER] Download progress: ${pct}%`);
      }
      this._sendToRenderer('update-status', {
        status: 'downloading',
        percent: pct,
        bytesPerSecond: progress.bytesPerSecond,
        transferred: progress.transferred,
        total: progress.total,
      });
    });

    autoUpdater.on('update-downloaded', (info) => {
      console.log(`[UPDATER] Update downloaded: v${info.version} — will install on next quit`);
      this.isUpdateInProgress = false;
      this._sendToRenderer('update-status', {
        status: 'ready',
        version: info.version,
      });

      // Silent update — autoInstallOnAppQuit handles installation
      // No dialog, no forced restart. Update applies next time the app closes.
    });

    autoUpdater.on('error', (err) => {
      console.error('[UPDATER] Error:', err.message);
      this.isUpdateInProgress = false;
      this._sendToRenderer('update-status', {
        status: 'error',
        message: err.message,
      });
    });
  }

  /**
   * Silent update — no dialog, no forced restart.
   * autoInstallOnAppQuit handles installation when the user naturally closes the app.
   */

  /**
   * Send a message to all renderer windows.
   */
  _sendToRenderer(channel, data) {
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      if (!win.isDestroyed() && win.webContents) {
        try {
          win.webContents.send(channel, data);
        } catch {
          // Window may be closing
        }
      }
    }
  }

  /**
   * Clean up intervals and listeners.
   */
  destroy() {
    if (this.updateCheckInterval) {
      clearInterval(this.updateCheckInterval);
      this.updateCheckInterval = null;
    }
    ipcMain.removeAllListeners('updater:check');
    ipcMain.removeAllListeners('updater:install');
    this.initialized = false;
  }
}

module.exports = { AppUpdater };
