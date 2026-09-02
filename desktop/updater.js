// ============================================================
// RMPG Flex — Auto-Update Manager
// Wraps electron-updater to check the RMPG Flex server for
// new desktop app versions and install them automatically.
// ============================================================

const fs = require('fs');
const crypto = require('crypto');
const { autoUpdater } = require('electron-updater');
const { app, BrowserWindow, ipcMain } = require('electron');
const { isSecureUpdateFeedUrl } = require('./security/sessionHardening');
const { verifyDownloadedUpdateHash } = require('./security/sessionAuth');

// Set to true only after a downloaded update package's SHA512 has been
// explicitly re-verified by this app (verifyDownloadedUpdateHash), on top
// of whatever internal integrity checking electron-updater already does
// during download. `updater:install` below is the ONLY call site that
// invokes autoUpdater.quitAndInstall() in this file — gating it on this
// flag means a corrupted/tampered download can never be installed via the
// renderer-triggered path. Reset to false at the top of every fresh
// 'update-downloaded' event so a stale prior verification can't leak
// across update cycles.
let lastUpdateVerified = false;

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
   * @param {Function} guardedOn - sender-origin-validated wrapper around
   *   ipcMain.on, from createIpcGuards(ipcMain, TRUSTED_HOST) in main.js.
   *   Required so the renderer-facing 'updater:check'/'updater:install'
   *   channels get the same sender-origin validation as every other IPC
   *   handler in the app.
   */
  init(serverUrl, guardedOn) {
    if (this.initialized) return;
    this.initialized = true;
    this.serverUrl = serverUrl;

    console.log('[UPDATER] Initializing with server:', serverUrl);

    // ─── Configure electron-updater ───────────────────
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowDowngrade = false;
    autoUpdater.allowPrerelease = false;
    // forceDevUpdateConfig is never set here, and electron-updater defaults
    // it to false in a packaged build (app.isPackaged) — the https feed-URL
    // assertion below is the other half of "no insecure update transport."

    // Point at the Cloudflare Worker update feed.
    // The GitHub repo is private — GitHub Releases asset URLs return 404
    // to unauthenticated requests, and embedding a PAT in the shipped app
    // would leak access to anyone who decompiles the .asar. The old VPS
    // host (https://rmpgutah.us/releases/, nginx on /opt/rmpg-releases/)
    // was DECOMMISSIONED 2026-05-24, so that feed now returns the SPA's
    // index.html (HTTP 200 text/html) and electron-updater fails to parse
    // it as YAML — auto-update was silently dead.
    //
    // The `rmpg-flex-api` Worker now serves the feed from the
    // `rmpg-flex-downloads` R2 bucket at /updates/ (see src/routes/
    // downloads.ts → serveUpdatesYaml + /updates/:filename). It MUST be the
    // api.rmpgutah.us host: the apex rmpgutah.us is the Pages SPA and does
    // not carry these routes (it returns index.html, same failure as the
    // old VPS path). electron-updater's 'generic' provider GETs
    // <url>/latest.yml (win) / latest-mac.yml (mac) and follows the
    // path/sha512 it finds — no auth, no third party.
    const feedUrl = 'https://api.rmpgutah.us/updates/';
    if (!isSecureUpdateFeedUrl(feedUrl)) {
      throw new Error('[UPDATER] Refusing to start: update feed URL is not https');
    }
    autoUpdater.setFeedURL({
      provider: 'generic',
      url: feedUrl,
    });

    // ─── Event handlers ───────────────────────────────
    this._setupEventHandlers();

    // ─── IPC handlers from renderer ───────────────────
    guardedOn('updater:check', () => {
      console.log('[UPDATER] Manual check triggered from renderer');
      this.checkForUpdates();
    });

    guardedOn('updater:install', () => {
      console.log('[UPDATER] Install triggered from renderer');
      if (!lastUpdateVerified) {
        console.error('[UPDATER] Refusing to install: downloaded package failed (or never completed) hash re-verification');
        this._sendToRenderer('update-status', {
          status: 'error',
          message: 'Update package failed integrity verification and was not installed.',
        });
        return;
      }
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
      // Reset the in-progress flag so future checks aren't permanently blocked.
      // isUpdateInProgress is set on 'update-available' but if checkForUpdates()
      // throws before that event fires, the flag stays false — however if it
      // throws after 'update-available' fired (race), we must reset here.
      if (this.isUpdateInProgress) {
        this.isUpdateInProgress = false;
      }
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
      console.log(`[UPDATER] Update downloaded: v${info.version} — verifying package integrity`);
      this.isUpdateInProgress = false;
      lastUpdateVerified = false;

      // Also block electron-updater's OWN quit-time auto-install path while
      // verification is pending/failed. autoInstallOnAppQuit is the app's
      // primary/normal install flow (see the comment below) — it installs
      // silently on next natural app quit, entirely independent of the
      // updater:install IPC handler this file also gates on
      // lastUpdateVerified. Without this, a package that fails re-verification
      // would still be silently installed the next time the user quits,
      // defeating the point of the re-check. Restored to true only once
      // verification succeeds, below.
      autoUpdater.autoInstallOnAppQuit = false;

      // Explicit app-level re-verification of the downloaded package's
      // SHA512, on top of electron-updater's own internal checking.
      // `info.downloadedFile` is the LOCAL path electron-updater just wrote
      // the package to (set by AppUpdater's dispatchUpdateDownloaded
      // wrapper) — NOT `info.path`, which is a deprecated field carrying
      // the manifest's remote path fragment, not a local filesystem path.
      // `info.sha512` is the base64-encoded expected hash from the update
      // manifest (latest.yml / latest-mac.yml).
      verifyDownloadedUpdateHash(info.downloadedFile, info.sha512, fs, crypto)
        .then((result) => {
          if (!result.ok) {
            console.error(`[UPDATER] Downloaded package failed hash re-verification: ${result.error}`);
            this._sendToRenderer('update-status', {
              status: 'error',
              message: 'Downloaded update failed integrity verification.',
            });
            return;
          }

          lastUpdateVerified = true;
          autoUpdater.autoInstallOnAppQuit = true;
          this._sendToRenderer('update-status', {
            status: 'ready',
            version: info.version,
          });

          // Silent update — autoInstallOnAppQuit handles installation
          // No dialog, no forced restart. Update applies next time the app closes.
        })
        .catch((err) => {
          console.error('[UPDATER] Hash verification threw unexpectedly:', err && err.message);
          this._sendToRenderer('update-status', {
            status: 'error',
            message: 'Downloaded update failed integrity verification.',
          });
        });
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
