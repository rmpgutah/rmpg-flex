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
  // Listen for update status events from the main process
  onUpdateStatus: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('update-status', handler);
    // Return cleanup function
    return () => ipcRenderer.removeListener('update-status', handler);
  },

  // Trigger a manual update check
  checkForUpdates: () => ipcRenderer.send('updater:check'),

  // Install a downloaded update (restarts the app)
  installUpdate: () => ipcRenderer.send('updater:install'),
});
