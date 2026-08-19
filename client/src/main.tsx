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
import { BrowserRouter } from 'react-router';
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
// Decode the sampled console sounds off the critical path. These were three
// top-level calls, which fetched and WebAudio-decoded 22 assets (from a 1.3 MB
// public/sounds/) before React rendered — pure contention with first paint.
// Nothing is lost by deferring: the AudioContext is gesture-suspended anyway,
// so no sound can play until the user interacts, and decode is fast once it
// runs. uiClickSounds is sample-only with no oscillator fallback, so an
// undecoded key plays SILENCE — that is why the full list is preloaded rather
// than left to lazy-load on first play.
{
  const ric = window.requestIdleCallback;
  const schedule: (cb: () => void) => unknown = ric
    ? (cb: () => void) => ric(cb, { timeout: 3000 })
    : (cb: () => void) => window.setTimeout(cb, 1200);
  schedule(() => {
    preloadSoundAssets();
    preloadSoundAssets(['navigate', 'ui_open', 'ui_close', 'ui_error']);
    preloadSoundAssets([
      // Core dispatch — fired before any user interaction in a busy shift
      'dispatch_bell', 'info', 'caution', 'warning', 'alert', 'alarm',
      'descending', 'p1_alert', 'emergency_three',
      // Status chirps — fired on every unit status change
      'chirp', 'double_chirp', 'enroute_chirp', 'onscene_chirp', 'cleared_chirp',
      // Radio / comms
      'key_up', 'key_out', 'roger', 'data_chirp',
      // Error / NACK
      'error', 'bonk',
      // Session
      'login_ok', 'logoff',
    ]);
  });
}
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
import { ApiBaseProvider } from './hooks/useApiBase';
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
    <ApiBaseProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ApiBaseProvider>
  </React.StrictMode>
);
