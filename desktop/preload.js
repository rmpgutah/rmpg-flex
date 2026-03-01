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

  // ─── Auto-Update API ────────────────────────────────
  onUpdateStatus: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('update-status', handler);
    return () => ipcRenderer.removeListener('update-status', handler);
  },
  checkForUpdates: () => ipcRenderer.send('updater:check'),
  installUpdate: () => ipcRenderer.send('updater:install'),

  // ─── Offline / Local Data Store API ──────────────────
  // Route API call through local SQLite (when offline)
  localApi: (method, path, body) => ipcRenderer.invoke('offline:api', method, path, body),

  // Get current offline state
  getOfflineState: (userId) => ipcRenderer.invoke('offline:state', userId),

  // PIN management
  enterPin: (userId, pin) => ipcRenderer.invoke('offline:enter-pin', userId, pin),
  generatePin: (userId) => ipcRenderer.invoke('offline:generate-pin', userId),

  // Sync management
  getSyncStatus: () => ipcRenderer.invoke('offline:sync-status'),
  triggerSync: () => ipcRenderer.invoke('offline:trigger-sync'),
  setAuthToken: (token) => ipcRenderer.invoke('offline:set-token', token),

  // Local DB info
  getLocalStats: () => ipcRenderer.invoke('offline:local-stats'),
  getActiveSessions: () => ipcRenderer.invoke('offline:active-sessions'),

  // Offline auth helpers
  getCachedUser: (username) => ipcRenderer.invoke('offline:get-cached-user', username),
  cacheUser: (userId) => ipcRenderer.invoke('offline:cache-user', userId),
  getOfflineUsers: () => ipcRenderer.invoke('offline:get-users'),

  // ─── Offline Event Listeners ─────────────────────────
  onConnectivityChange: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('offline:connectivity-changed', handler);
    return () => ipcRenderer.removeListener('offline:connectivity-changed', handler);
  },
  onSyncProgress: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('offline:sync-progress', handler);
    return () => ipcRenderer.removeListener('offline:sync-progress', handler);
  },
  onPinExpired: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('offline:pin-expired', handler);
    return () => ipcRenderer.removeListener('offline:pin-expired', handler);
  },
});
