// Polyfills MUST be the first import — pdfjs-dist v5.7+ uses
// Map.prototype.getOrInsertComputed (TC39 Stage 3) which isn't in older
// Electron Chromium. Without this, PDF rendering throws
// `TypeError: this[#t].getOrInsertComputed is not a function`.
import './utils/jsPolyfills';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import { bootstrapThemePreference } from './utils/theme';
import { setupNativeAppShell } from './utils/nativeAppShell';
import { installUiTrapHotkey } from './utils/uiTrapDiagnostic';

bootstrapThemePreference();
setupNativeAppShell();
// Ctrl+Alt+D fail-safe diagnostic — captures UI trap state when the
// app freezes (clicks/typing dead). Installed at the document level
// so it fires even if React/focus traps are stuck.
installUiTrapHotkey();

// Signals that the main entry bundle executed successfully.
(window as any).__RMPG_BOOTSTRAPPED__ = true;

// Remove the inline pre-splash once React takes over
const preSplash = document.getElementById('pre-splash');
if (preSplash) {
  preSplash.style.opacity = '0';
  setTimeout(() => preSplash.remove(), 300);
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
