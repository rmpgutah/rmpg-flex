'use strict';
// Preload for desktop/splash.html — bridges the three startup-sequence IPC
// channels between the main process and the splash renderer. NEVER expose
// node integration or arbitrary IPC access here; list only what splash.html needs.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('splashBridge', {
  // Receive a phase-transition signal from main.
  // Payload: { phase: 'boot'|'lock'|'welcome', data: {...} }
  onPhase: (cb) => ipcRenderer.on('splash:phase', (_e, data) => cb(data)),

  // Send FlexOS credentials to main for server-side validation.
  // Main validates via /api/auth/login — password never stays in renderer.
  sendAuth: (username, password) => ipcRenderer.send('splash:auth', { username, password }),

  // Receive auth result from main.
  // Payload: { ok: boolean, error?: string, officer?: { name, role } }
  onAuthResult: (cb) => ipcRenderer.on('splash:auth-result', (_e, data) => cb(data)),

  // Face unlock channels (Task 12)
  faceEnrollmentStatus: (userId) => ipcRenderer.invoke('face:enrollment-status', { userId }),
  faceVerify: (userId, embedding) => ipcRenderer.invoke('face:verify', { userId, embedding }),
  faceUnlockSuccess: () => ipcRenderer.send('face:unlock-success'),
});
