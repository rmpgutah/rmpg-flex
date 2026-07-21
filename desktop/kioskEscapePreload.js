'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('kioskEscape', {
  attempt: (username, password) => ipcRenderer.invoke('kiosk:attempt-escape', username, password),
});
