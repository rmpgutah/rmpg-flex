// Polyfills MUST be the first import — pdfjs-dist v5.7+ uses
// Map.prototype.getOrInsertComputed (TC39 Stage 3) which isn't in older
// Electron Chromium. Without this, PDF rendering throws
// `TypeError: this[#t].getOrInsertComputed is not a function`.
import './utils/jsPolyfills';
// Mandatory Mountain Time: pin every date/time display to America/Denver
// regardless of the device timezone. Must run before any rendering.
import './utils/enforceMountainTime';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import './styles/spillman.css';
import './styles/spillman-kit.css';
import { bootstrapThemePreference } from './utils/theme';
import { setupNativeAppShell } from './utils/nativeAppShell';
import { installUiTrapHotkey } from './utils/uiTrapDiagnostic';
import { initUiClickSounds } from './utils/uiClickSounds';
import { preloadSoundAssets } from './utils/soundAssets';
import { initTabScrollbars } from './utils/tabScrollbars';

bootstrapThemePreference();
setupNativeAppShell();
// Spillman-console key ticks on interactive clicks (document-level,
// capture phase — works on login page and across all React routes)
initUiClickSounds();
// Decode the sampled console sounds up front so the first click/chime/login
// plays the actual asset instead of the synth fallback (decode works while
// the AudioContext is still gesture-suspended; playback resumes on gesture).
// Beyond the UI five, warm the high-traffic dispatch library tones; the
// rest of the library lazy-loads on first play (synth covers that play).
preloadSoundAssets();
preloadSoundAssets([
  'info', 'chirp', 'double_chirp', 'error', 'caution', 'warning',
  'alert', 'alarm', 'descending', 'p1_alert', 'key_up', 'key_out', 'data_chirp',
]);
// Ctrl+Alt+D fail-safe diagnostic — captures UI trap state when the
// app freezes (clicks/typing dead). Installed at the document level
// so it fires even if React/focus traps are stuck.
installUiTrapHotkey();

// Always-visible custom scrollbar for horizontal tab/section strips. macOS
// Chrome auto-hides native (overlay) scrollbars, so this overlays our own
// thin bar on every .tab-scroll strip. Uses a MutationObserver, so it catches
// strips rendered later by React routes.
initTabScrollbars();

// Signals that the main entry bundle executed successfully.
(window as any).__RMPG_BOOTSTRAPPED__ = true;

// ── Global stale-chunk safety net ──────────────────────────────
// After a Cloudflare Pages deploy rotates chunk hashes, a long-lived tab's
// bare `await import()` rejects with "Failed to fetch dynamically imported
// module" because the old hash 404s (the SPA HTML fallback then fails to
// parse as JS). importWithRetry() guards CALL SITES that opt in, but ~20
// pages still call `await import()` directly. Catch those rejections here
// and trigger the same one-time bounded reload — operators stop having to
// hard-refresh after every deploy.
import { isChunkLoadError, tryReloadForChunkFailure } from './utils/chunkRetry';
window.addEventListener('unhandledrejection', (event) => {
  if (!isChunkLoadError(event.reason)) return;
  // tryReloadForChunkFailure honors a 30s window: a second failure inside it
  // means the reload didn't help, so we let the rejection propagate (no loop).
  const held = tryReloadForChunkFailure<void>(event.reason);
  if (held) {
    // Reload is in flight — swallow the unhandled rejection so the browser
    // doesn't log a console error before navigation tears the page down.
    event.preventDefault();
  }
});

// Remove the inline pre-splash once React takes over
const preSplash = document.getElementById('pre-splash');
if (preSplash) {
  preSplash.style.opacity = '0';
  setTimeout(() => preSplash.remove(), 300);
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
