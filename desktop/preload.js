// ============================================================
// RMPG Flex — Electron Preload Script
// Exposes safe APIs to the renderer process via contextBridge.
// ============================================================

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  // Platform info
  platform: process.platform,
  isElectron: true,

  // Window controls
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),

  // App version
  getVersion: () => ipcRenderer.invoke('app:version'),

  // Notifications (native OS notifications)
  showNotification: (title, body) => {
    new Notification(title, { body });
  },

  // ─── Geolocation Fallback ─────────────────────────
  // IP-based geolocation via Google's Geolocation API when
  // navigator.geolocation fails (common on desktop without GPS)
  getIpLocation: () => ipcRenderer.invoke('geo:ip-locate'),

  // ─── Auto-Update API ────────────────────────────────
  // Listen for update status events from the main process
  onUpdateStatus: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('update-status', handler);
    // Return cleanup function
    return () => ipcRenderer.removeListener('update-status', handler);
  },

  // Trigger a manual update check
  checkForUpdates: () => ipcRenderer.send('updater:check'),

  // ─── Recon Connect ─────────────────────────────────
  // Spawn the locally-installed Recon Connect toolkit in a new terminal window.
  // Returns { ok: boolean, error?: string } — never throws.
  launchReconConnect: () => ipcRenderer.invoke('recon:launch'),

  // Run the platform-appropriate install flow in a visible terminal window.
  // Returns { ok: boolean, error?: string }.
  installReconConnect: () => ipcRenderer.invoke('recon:install'),

  // Quick existence check — returns { installed: boolean, path?: string }.
  checkReconConnect: () => ipcRenderer.invoke('recon:check'),

  // ─── In-app terminal (xterm.js bridge) ──────────────
  // Spawn a Recon Connect process and stream stdio through IPC events.
  reconSpawn: (opts) => ipcRenderer.invoke('recon:term-spawn', opts),
  reconInput: (sessionId, data) => ipcRenderer.send('recon:term-input', { sessionId, data }),
  reconResize: (sessionId, cols, rows) => ipcRenderer.send('recon:term-resize', { sessionId, cols, rows }),
  reconKill: (sessionId) => ipcRenderer.invoke('recon:term-kill', { sessionId }),

  // ─── Native tool runner (Wireless pilot) ───────────
  reconToolSpawn: (toolId, args) => ipcRenderer.invoke('recon:tool-spawn', { toolId, args }),
  reconToolKill: (sessionId) => ipcRenderer.invoke('recon:tool-kill', { sessionId }),
  reconToolInstall: (pkg) => ipcRenderer.invoke('recon:tool-install', { pkg }),
  onReconToolData: (callback) => {
    const handler = (_e, payload) => callback(payload.sessionId, payload.kind, payload.data);
    ipcRenderer.on('recon:tool-data', handler);
    return () => ipcRenderer.removeListener('recon:tool-data', handler);
  },
  onReconToolExit: (callback) => {
    const handler = (_e, payload) => callback(payload.sessionId, payload.code);
    ipcRenderer.on('recon:tool-exit', handler);
    return () => ipcRenderer.removeListener('recon:tool-exit', handler);
  },
  onReconData: (callback) => {
    const handler = (_e, payload) => callback(payload.sessionId, payload.data);
    ipcRenderer.on('recon:term-data', handler);
    return () => ipcRenderer.removeListener('recon:term-data', handler);
  },
  onReconExit: (callback) => {
    const handler = (_e, payload) => callback(payload.sessionId, payload.code);
    ipcRenderer.on('recon:term-exit', handler);
    return () => ipcRenderer.removeListener('recon:term-exit', handler);
  },

  // Install a downloaded update (restarts the app)
  installUpdate: () => ipcRenderer.send('updater:install'),

  // Force clear all caches and reload (for update propagation)
  forceRefresh: () => ipcRenderer.invoke('app:force-refresh'),

  // ─── Offline Mode API ──────────────────────────────────
  // Route an API request through the local SQLite database
  localApi: (method, path, body) =>
    ipcRenderer.invoke('offline:api', { method, path, body }),

  // Get current offline/authorization state
  getOfflineState: () => ipcRenderer.invoke('offline:state'),

  // Employee: enter a 6-digit PIN to unlock 24h local writes
  enterPin: (pin) => ipcRenderer.invoke('offline:enter-pin', { pin }),

  // Admin: generate a 6-digit PIN for an employee
  generatePin: (userId) => ipcRenderer.invoke('offline:generate-pin', { userId }),

  // Get sync status (last pull/push times, queue depth)
  getSyncStatus: () => ipcRenderer.invoke('offline:sync-status'),

  // Force an immediate sync cycle
  triggerSync: () => ipcRenderer.invoke('offline:trigger-sync'),

  // Get locally cached user for offline auth
  getCachedUser: (username) =>
    ipcRenderer.invoke('offline:get-cached-user', { username }),

  // Listen for connectivity state changes
  onConnectivityChange: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('offline:connectivity-changed', handler);
    return () => ipcRenderer.removeListener('offline:connectivity-changed', handler);
  },

  // Listen for sync progress events
  onSyncProgress: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('offline:sync-progress', handler);
    return () => ipcRenderer.removeListener('offline:sync-progress', handler);
  },

  // Listen for sync completion
  onSyncComplete: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('offline:sync-complete', handler);
    return () => ipcRenderer.removeListener('offline:sync-complete', handler);
  },

  // Listen for PIN session expiry
  onPinExpired: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('offline:pin-expired', handler);
    return () => ipcRenderer.removeListener('offline:pin-expired', handler);
  },

  // Listen for authorization state changes
  onAuthorizationChanged: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('offline:authorization-changed', handler);
    return () => ipcRenderer.removeListener('offline:authorization-changed', handler);
  },
});
