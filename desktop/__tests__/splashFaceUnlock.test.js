'use strict';
/**
 * Task 12 smoke tests — FlexOS lock screen face unlock
 *
 * These tests verify structural correctness of the changes made in Task 12.
 * They do NOT exercise the full UI flow (face-api.js inference, camera access,
 * Electron IPC round-trips) — that path requires a real Electron renderer with
 * WebRTC access, which has no jsdom equivalent. The brief acknowledges this.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

// ── 1: splashPreload.js exposes the three face channels ───────────────────────
test('splashPreload.js: faceEnrollmentStatus is exposed via contextBridge', () => {
  const src = fs.readFileSync(path.join(ROOT, 'splashPreload.js'), 'utf8');
  assert.match(src, /faceEnrollmentStatus\s*:/,
    'faceEnrollmentStatus must be in the contextBridge exposeInMainWorld block');
  assert.match(src, /ipcRenderer\.invoke\(\s*['"]face:enrollment-status['"]/,
    'faceEnrollmentStatus must invoke face:enrollment-status');
});

test('splashPreload.js: faceVerify is exposed via contextBridge', () => {
  const src = fs.readFileSync(path.join(ROOT, 'splashPreload.js'), 'utf8');
  assert.match(src, /faceVerify\s*:/,
    'faceVerify must be in the contextBridge exposeInMainWorld block');
  assert.match(src, /ipcRenderer\.invoke\(\s*['"]face:verify['"]/,
    'faceVerify must invoke face:verify');
});

test('splashPreload.js: faceUnlockSuccess is exposed via contextBridge', () => {
  const src = fs.readFileSync(path.join(ROOT, 'splashPreload.js'), 'utf8');
  assert.match(src, /faceUnlockSuccess\s*:/,
    'faceUnlockSuccess must be in the contextBridge exposeInMainWorld block');
  assert.match(src, /ipcRenderer\.send\(\s*['"]face:unlock-success['"]/,
    'faceUnlockSuccess must send face:unlock-success');
});

// ── 2: main.js has the face:unlock-success ipcMain.on handler ─────────────────
test('main.js: ipcMain.on face:unlock-success handler exists', () => {
  const src = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
  // The handler is registered through guardedSplashOn (createLocalFileIpcGuards),
  // which wraps ipcMain.on internally — accept both forms so this audit test
  // matches the real, sender-validated registration.
  assert.match(src, /(?:ipcMain\.on|guardedSplashOn)\(\s*['"]face:unlock-success['"]/,
    'main.js must register ipcMain.on handler for face:unlock-success');
});

test('main.js: face:unlock-success handler closes splashWindow', () => {
  const src = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
  // Verify the handler block contains splashWindow close logic
  const handlerStart = src.indexOf("guardedSplashOn('face:unlock-success'");
  assert.ok(handlerStart !== -1, 'handler must exist');
  const handlerBlock = src.slice(handlerStart, handlerStart + 400);
  assert.match(handlerBlock, /splashWindow/,
    'handler must reference splashWindow to close it');
  assert.match(handlerBlock, /mainWindow/,
    'handler must reference mainWindow to show/focus it');
  assert.match(handlerBlock, /logSecurityAuditEvent/,
    'handler must call logSecurityAuditEvent');
});

// ── 3: splash.html has the face unlock section and script ─────────────────────
test('splash.html: face-unlock-section div is present', () => {
  const src = fs.readFileSync(path.join(ROOT, 'splash.html'), 'utf8');
  assert.match(src, /id="face-unlock-section"/,
    'splash.html must contain face-unlock-section div');
  assert.match(src, /id="face-unlock-btn"/,
    'splash.html must contain face-unlock-btn button');
  assert.match(src, /id="face-status"/,
    'splash.html must contain face-status paragraph');
});

test('splash.html: initFaceUnlock function is defined', () => {
  const src = fs.readFileSync(path.join(ROOT, 'splash.html'), 'utf8');
  assert.match(src, /function initFaceUnlock/,
    'splash.html must define initFaceUnlock');
  assert.match(src, /splashBridge\.faceEnrollmentStatus/,
    'initFaceUnlock must call splashBridge.faceEnrollmentStatus');
  assert.match(src, /splashBridge\.faceVerify/,
    'initFaceUnlock must call splashBridge.faceVerify');
  assert.match(src, /splashBridge\.faceUnlockSuccess/,
    'initFaceUnlock must call splashBridge.faceUnlockSuccess on success');
});

test('splash.html: initFaceUnlock is called from the lock phase handler', () => {
  const src = fs.readFileSync(path.join(ROOT, 'splash.html'), 'utf8');
  assert.match(src, /initFaceUnlock\s*\(/,
    'initFaceUnlock must be invoked somewhere in splash.html');
});

test('splash.html: face-unlock-section is hidden by default', () => {
  const src = fs.readFileSync(path.join(ROOT, 'splash.html'), 'utf8');
  // The section must start hidden
  const sectionMatch = src.match(/id="face-unlock-section"[^>]*style="([^"]*)"/);
  assert.ok(sectionMatch, 'face-unlock-section must have inline style');
  assert.match(sectionMatch[1], /display\s*:\s*none/,
    'face-unlock-section must be display:none by default');
});
