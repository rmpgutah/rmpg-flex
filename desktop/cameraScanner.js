// ============================================================
// RMPG Flex — Camera QR / Barcode Scanner
//
// Opens a hidden off-screen BrowserWindow that accesses the
// device camera via getUserMedia, captures frames every 250ms,
// and passes each frame to jsQR for QR/barcode decoding.
//
// On a successful decode, emits hardware:barcode-scan with
// { payload, source: 'camera' } — the same shape as the
// hardware xPAK scanner — so the renderer has one code path.
// ============================================================

'use strict';

// jsQR is a pure-JS QR decoder — no native bindings.
// Loaded lazily so this file can be required even when jsqr is absent.
let jsQR;
try {
  jsQR = require('jsqr');
} catch (err) {
  console.warn('[CAMERA-SCANNER] jsqr not available:', err.message);
}

const SCAN_INTERVAL_MS = 250;

// Upper bound on a single decoded frame (RGBA bytes). The offscreen window is
// 640x480 so a real frame is ~1.2MB; 4096x4096 is already an extreme cap for
// a QR/barcode scanner and prevents a malformed or compromised renderer from
// making the MAIN process allocate an unbounded buffer out of `_camera-frame`
// IPC payloads sent per 250ms tick.
const MAX_FRAME_BYTES = 4096 * 4096 * 4;
const SCAN_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head><body>
<video id="v" autoplay playsinline style="display:none"></video>
<canvas id="c"></canvas>
<script>
const video = document.getElementById('v');
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
  .then((stream) => {
    video.srcObject = stream;
    video.onloadedmetadata = () => {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      setInterval(() => {
        ctx.drawImage(video, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        window.__frameCallback__(imageData.data.buffer, canvas.width, canvas.height);
      }, ${SCAN_INTERVAL_MS});
    };
  })
  .catch((err) => window.__frameError__(err.message));
</script>
</body></html>`;

class CameraScanner {
  constructor() {
    this._win = null;
    this._mainWindow = null;
    this._frameListener = null;
    this._errorListener = null;
  }

  /**
   * Start the camera scanner.
   * @param {Electron.BrowserWindow} mainWindow - The main app window to send scan results to.
   * @param {typeof import('electron').BrowserWindow} BrowserWindowClass - BrowserWindow constructor (injected for testability).
   * @returns {boolean} true if started (or already running), false if jsQR unavailable.
   */
  start(mainWindow, BrowserWindowClass) {
    if (!jsQR) {
      console.warn('[CAMERA-SCANNER] jsQR unavailable — camera scanning disabled');
      return false;
    }
    if (this._win) return true; // already running — idempotent

    this._mainWindow = mainWindow;

    // Hidden off-screen window — no frame, never shown to user.
    //
    // SECURITY TRADEOFF (accepted, mirrors main.js's barcode-buffer comment):
    // this is the ONE window in the app that does NOT use
    // hardenWebPreferencesDefaults(). It runs an offscreen `data:` page that
    // needs (a) `nodeIntegration: true` to hand each video frame straight to
    // ipcRenderer.send as a raw buffer (avoiding the structured-clone cost of
    // a contextBridge round-trip per 250ms tick) and (b) `webSecurity: false`
    // so `getUserMedia` is allowed on an opaque-origin `data:` URL. That is
    // only reachable because the page is a hardcoded, static, offline string
    // (SCAN_HTML) with no user input, no links, and — via the navigation
    // locks added below — no way to navigate anywhere else. If this window is
    // ever repurposed to load remote content, it MUST be refactored onto a
    // preload + contextBridge with nodeIntegration off first.
    this._win = new BrowserWindowClass({
      width: 640,
      height: 480,
      show: false,
      webPreferences: {
        offscreen: true,
        nodeIntegration: true,
        webSecurity: false,
        contextIsolation: true,
        enableWebSQL: false,
        allowRunningInsecureContent: false,
      },
    });

    // The scanner page must never be able to navigate away from the static
    // data: URL or open a window. This is defense-in-depth on top of the fact
    // that SCAN_HTML contains no such capability.
    this._win.webContents.on('will-navigate', (navEvent, url) => {
      console.warn('[CAMERA-SCANNER] Blocked navigation to:', url);
      navEvent.preventDefault();
    });
    this._win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

    this._win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(SCAN_HTML));

    // Wire the frame callback via executeJavaScript after the page loads.
    // The scanner page uses window.__frameCallback__ / __frameError__ to
    // pass image data back; we expose these via ipcRenderer in the page.
    this._win.webContents.executeJavaScript(`
      window.__frameCallback__ = function(buffer, width, height) {
        require('electron').ipcRenderer.send('_camera-frame', buffer, width, height);
      };
      window.__frameError__ = function(msg) {
        require('electron').ipcRenderer.send('_camera-error', msg);
      };
    `).catch(() => {});

    const { ipcMain } = require('electron');

    this._frameListener = (_event, buffer, width, height) => {
      this._decodeFrame(buffer, width, height);
    };

    this._errorListener = (_event, msg) => {
      console.warn('[CAMERA-SCANNER] getUserMedia failed:', msg);
      this.stop();
    };

    ipcMain.on('_camera-frame', this._frameListener);
    ipcMain.once('_camera-error', this._errorListener);

    this._win.on('closed', () => {
      this._win = null;
    });

    console.log('[CAMERA-SCANNER] Started');
    return true;
  }

  /**
   * Decode a single frame via jsQR. Fires hardware:barcode-scan on the
   * main window's webContents when a QR code is found.
   * @param {ArrayBuffer} buffer - Raw RGBA pixel data.
   * @param {number} width
   * @param {number} height
   */
  _decodeFrame(buffer, width, height) {
    if (!jsQR) return;
    // Never trust the renderer's reported geometry or buffer length. A
    // malformed/oversized frame must not allocate an unbounded buffer in the
    // main process (the `_camera-frame` IPC channel is otherwise unbounded).
    const w = Number(width);
    const h = Number(height);
    if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0) {
      console.warn('[CAMERA-SCANNER] Ignoring frame with invalid geometry:', width, height);
      return;
    }
    const expectedBytes = w * h * 4;
    if (expectedBytes > MAX_FRAME_BYTES) {
      console.warn('[CAMERA-SCANNER] Ignoring frame larger than max size:', w, h);
      return;
    }
    const byteLength = buffer instanceof ArrayBuffer
      ? buffer.byteLength
      : ArrayBuffer.isView(buffer) ? buffer.byteLength : 0;
    if (byteLength < expectedBytes) {
      console.warn('[CAMERA-SCANNER] Ignoring undersized frame buffer:', byteLength, '<', expectedBytes);
      return;
    }
    try {
      const data = new Uint8ClampedArray(buffer);
      const result = jsQR(data, w, h);
      if (result && result.data) {
        console.log('[CAMERA-SCANNER] Decoded:', result.data);
        this._mainWindow?.webContents.send('hardware:barcode-scan', {
          payload: result.data,
          source: 'camera',
        });
      }
    } catch (err) {
      console.warn('[CAMERA-SCANNER] decode error:', err.message);
    }
  }

  /**
   * Stop the camera scanner and clean up.
   * Safe to call when already stopped.
   */
  stop() {
    const { ipcMain } = require('electron');
    if (this._frameListener) {
      ipcMain.removeListener('_camera-frame', this._frameListener);
      this._frameListener = null;
    }
    if (this._errorListener) {
      ipcMain.removeListener('_camera-error', this._errorListener);
      this._errorListener = null;
    }
    if (this._win && !this._win.isDestroyed()) {
      this._win.close();
    }
    this._win = null;
    this._mainWindow = null;
    console.log('[CAMERA-SCANNER] Stopped');
  }
}

module.exports = { CameraScanner };
