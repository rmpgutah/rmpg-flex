'use strict';

const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');

// ---------------------------------------------------------------------------
// Stub electron ipcMain so CameraScanner can be required without Electron
// ---------------------------------------------------------------------------
const fakeListeners = {};
const fakeIpcMain = {
  on:             (ch, fn) => { fakeListeners[ch] = fakeListeners[ch] || []; fakeListeners[ch].push(fn); },
  once:           (ch, fn) => { fakeListeners[ch] = fakeListeners[ch] || []; fakeListeners[ch].push(fn); },
  removeListener: (ch, fn) => {
    if (!fakeListeners[ch]) return;
    fakeListeners[ch] = fakeListeners[ch].filter(f => f !== fn);
  },
  emit: (ch, ...args) => { (fakeListeners[ch] || []).forEach(fn => fn(...args)); },
};

// Patch require('electron') before the module is loaded
const Module = require('module');
const _origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'electron') return { ipcMain: fakeIpcMain };
  return _origLoad.call(this, request, ...rest);
};

// Patch require('jsqr') to return a controlled decoder
let jsqrReturnValue = null;
Module._load = (function (originalLoad) {
  return function (request, ...rest) {
    if (request === 'electron') return { ipcMain: fakeIpcMain };
    if (request === 'jsqr') return (data, w, h) => jsqrReturnValue;
    return originalLoad.call(this, request, ...rest);
  };
})(Module._load);

const { CameraScanner } = require('../cameraScanner');

// ---------------------------------------------------------------------------
// Stub BrowserWindow
// ---------------------------------------------------------------------------
class StubBrowserWindow {
  constructor(opts) {
    this._opts = opts;
    this._closed = false;
    this._listeners = {};
    this.webContents = {
      send: mock.fn(),
      executeJavaScript: mock.fn(() => Promise.resolve()),
      on: mock.fn(),
      setWindowOpenHandler: mock.fn(() => ({ action: 'deny' })),
    };
  }
  loadURL() {}
  isDestroyed() { return this._closed; }
  close() {
    this._closed = true;
    (this._listeners['closed'] || []).forEach(fn => fn());
  }
  on(event, fn) {
    this._listeners[event] = this._listeners[event] || [];
    this._listeners[event].push(fn);
  }
}

// Stub mainWindow
function makeMainWindow() {
  return { webContents: { send: mock.fn() } };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('CameraScanner', () => {
  let scanner;

  beforeEach(() => {
    scanner = new CameraScanner();
    // Clear any stale listeners
    Object.keys(fakeListeners).forEach(k => { fakeListeners[k] = []; });
  });

  afterEach(() => {
    scanner.stop();
  });

  it('start() creates a hidden BrowserWindow and returns true', () => {
    const mw = makeMainWindow();
    const result = scanner.start(mw, StubBrowserWindow);
    assert.equal(result, true);
    assert.ok(scanner._win instanceof StubBrowserWindow, 'scanner._win should be a StubBrowserWindow');
    assert.equal(scanner._win._opts.show, false, 'window should be hidden');
  });

  it('start() is idempotent — calling twice does not create a second window', () => {
    const mw = makeMainWindow();
    const firstResult = scanner.start(mw, StubBrowserWindow);
    const firstWin = scanner._win;
    const secondResult = scanner.start(mw, StubBrowserWindow);
    assert.equal(firstResult, true);
    assert.equal(secondResult, true);
    assert.strictEqual(scanner._win, firstWin, 'same window instance after duplicate start');
  });

  it('stop() destroys the window and clears state', () => {
    const mw = makeMainWindow();
    scanner.start(mw, StubBrowserWindow);
    const win = scanner._win;
    scanner.stop();
    assert.equal(scanner._win, null);
    assert.equal(scanner._mainWindow, null);
    assert.equal(win._closed, true);
  });

  it('stop() is safe to call when already stopped (no throw)', () => {
    assert.doesNotThrow(() => scanner.stop());
  });

  it('stop() is safe to call twice (duplicate stop is safe)', () => {
    const mw = makeMainWindow();
    scanner.start(mw, StubBrowserWindow);
    assert.doesNotThrow(() => {
      scanner.stop();
      scanner.stop();
    });
    assert.equal(scanner._win, null);
  });

  it('_decodeFrame() sends hardware:barcode-scan with source:camera on match', () => {
    const mw = makeMainWindow();
    scanner.start(mw, StubBrowserWindow);
    jsqrReturnValue = { data: 'TEST-QR-123' };

    const fakeBuffer = new ArrayBuffer(4); // 1px RGBA
    scanner._decodeFrame(fakeBuffer, 1, 1);

    const calls = mw.webContents.send.mock.calls;
    assert.equal(calls.length, 1);
    assert.equal(calls[0].arguments[0], 'hardware:barcode-scan');
    assert.deepEqual(calls[0].arguments[1], { payload: 'TEST-QR-123', source: 'camera' });
  });

  it('_decodeFrame() does nothing when jsQR returns null', () => {
    const mw = makeMainWindow();
    scanner.start(mw, StubBrowserWindow);
    jsqrReturnValue = null;

    const fakeBuffer = new ArrayBuffer(4);
    scanner._decodeFrame(fakeBuffer, 1, 1);

    assert.equal(mw.webContents.send.mock.calls.length, 0);
  });

  it('window close event clears _win reference', () => {
    const mw = makeMainWindow();
    scanner.start(mw, StubBrowserWindow);
    const win = scanner._win;
    win.close(); // triggers 'closed' event on the stub
    assert.equal(scanner._win, null);
  });

  it('ipcMain frame listener is removed on stop()', () => {
    const mw = makeMainWindow();
    scanner.start(mw, StubBrowserWindow);
    const listenerCountBefore = (fakeListeners['_camera-frame'] || []).length;
    scanner.stop();
    const listenerCountAfter = (fakeListeners['_camera-frame'] || []).length;
    assert.ok(listenerCountBefore > 0, 'listener should be registered while running');
    assert.equal(listenerCountAfter, 0, 'listener should be removed after stop');
  });

  it('start() locks down navigation and window-open on the scanner window', () => {
    const mw = makeMainWindow();
    scanner.start(mw, StubBrowserWindow);
    const navLocks = scanner._win.webContents.on.mock.calls.filter(c => c.arguments && c.arguments[0] === 'will-navigate');
    assert.ok(navLocks.length > 0, 'will-navigate lock should be registered');
    assert.ok(scanner._win.webContents.setWindowOpenHandler.mock.calls.length > 0, 'window-open handler should be registered');
  });

  it('_decodeFrame() rejects non-integer, non-positive, or absurd geometry', () => {
    const mw = makeMainWindow();
    scanner.start(mw, StubBrowserWindow);
    jsqrReturnValue = { data: 'SHOULD-NOT-DECODE' };
    const fakeBuffer = new ArrayBuffer(4);

    scanner._decodeFrame(fakeBuffer, NaN, 1);        // NaN
    scanner._decodeFrame(fakeBuffer, -1, 1);         // negative
    scanner._decodeFrame(fakeBuffer, 1.5, 1);        // non-integer
    scanner._decodeFrame(fakeBuffer, 5000, 5000);    // exceeds MAX_FRAME_BYTES
    scanner._decodeFrame(fakeBuffer, 2, 2);          // undersized (needs 16 bytes, has 4)

    assert.equal(mw.webContents.send.mock.calls.length, 0, 'no scan should be emitted');
  });

  it('_decodeFrame() ignores a padded-but-reasonable oversized frame', () => {
    const mw = makeMainWindow();
    scanner.start(mw, StubBrowserWindow);
    jsqrReturnValue = null;
    // 2x2 frame needs 16 bytes; provide exactly that (no throw, no scan since jsQR null)
    scanner._decodeFrame(new ArrayBuffer(16), 2, 2);
    assert.equal(mw.webContents.send.mock.calls.length, 0);
  });
});
