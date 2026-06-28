import { useEffect, useRef } from 'react';
import { useServiceWorker } from '../hooks/useServiceWorker';
import { devLog } from '../utils/devLog';

/**
 * Silent PWA update applier.
 * When a new service worker is detected, automatically applies the update
 * in the background with no visible UI — BUT only at a moment that won't
 * destroy the operator's in-progress work.
 *
 * Why the gate (2026-06-02): the repo deploys many times a day. The old
 * version reloaded unconditionally ~2s after detecting any new bundle, so an
 * operator mid-data-entry (fuel log, cost modal, report form) would have the
 * page yanked out from under them — unsaved fields wiped, the feature "res
 * etting / going back to an old version." Now we reload only when it's SAFE
 * (no focused input, no open modal/dialog) and retry until it is, so the
 * update still lands within seconds of the operator pausing — without ever
 * clobbering an edit in progress.
 *
 * Web browsers: SW skipWaiting + window.location.reload().
 * Electron desktop: forceRefresh IPC (clears Chromium HTTP cache, service
 * workers, cachestorage, then reloads). Falls back to applyUpdate() if the
 * forceRefresh bridge isn't available (older EXE without the new preload).
 */

/** Minimum spacing between SW-update auto-reloads. 2026-06-11 incident:
 *  /sw.js byte-flapped at the edge, so updatefound→activate→reload looped
 *  every 1-3 minutes and operators "couldn't scroll" — every reload threw
 *  them back to the top of the page. A real deploy only needs ONE reload;
 *  anything more frequent is churn. */
const RELOAD_COOLDOWN_MS = 5 * 60_000;
const RELOAD_STAMP_KEY = 'rmpg_last_sw_reload';

/** Max time to defer reload when blocked by NavigationPage. After this,
 *  the update applies even if still on /navigation — protects against
 *  a full-shift patrol with no page change. */
const NAVIGATION_BLOCK_MAX_MS = 10 * 60_000;

function reloadCooldownActive(): boolean {
  try {
    const last = parseInt(localStorage.getItem(RELOAD_STAMP_KEY) || '0', 10);
    return Number.isFinite(last) && Date.now() - last < RELOAD_COOLDOWN_MS;
  } catch { return false; }
}

function stampReload(): void {
  try { localStorage.setItem(RELOAD_STAMP_KEY, String(Date.now())); } catch { /* private mode */ }
}

/** True when reloading right now would NOT lose unsaved work.
 *  @param navigationBlockedMs milliseconds since we first detected a
 *         NavigationPage block (0 = no block tracked yet). After
 *         NAVIGATION_BLOCK_MAX_MS the guard releases so the update
 *         eventually lands even on a full-shift drive with no page change. */
function isSafeToReload(navigationBlockedMs = 0): boolean {
  // 1. Don't yank the driver out of navigation mid-trip — but
  //    release after NAVIGATION_BLOCK_MAX_MS so critical updates
  //    eventually reach an all-shift driver.
  if (window.location.pathname.startsWith('/navigation')) {
    if (navigationBlockedMs < NAVIGATION_BLOCK_MAX_MS) return false;
  }
  // 2. Global dirty counter — incremented by UnsavedChangesGuard / useUnsavedChanges when
  //    any form has unsaved edits (counter prevents false negatives when multiple forms are open).
  if ((window as any).__rmpg_unsavedChangesCount > 0) return false;
  const ae = document.activeElement as HTMLElement | null;
  if (ae) {
    const tag = ae.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return false;
    if (ae.isContentEditable) return false;
  }
  // 3. Open modal/dialog — almost always wraps an in-progress action (add/edit forms).
  if (document.querySelector('[role="dialog"], [aria-modal="true"]')) return false;
  return true;
}

export default function WebUpdateBanner() {
  const { updateAvailable, applyUpdate } = useServiceWorker();
  const initialTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const navigationBlockedSinceRef = useRef<number>(0);

  const electron = (window as any).electron;
  const isElectron = !!electron?.isElectron;

  useEffect(() => {
    if (!updateAvailable) return;
    let cancelled = false;

    const doReload = () => {
      if (cancelled) return;
      if (isElectron && typeof electron?.forceRefresh === 'function') {
        devLog('[WEB-UPDATE] Electron — invoking forceRefresh IPC');
        electron.forceRefresh().catch((err: any) => {
          devLog('[WEB-UPDATE] forceRefresh failed, falling back to applyUpdate', err);
          applyUpdate();
        });
      } else {
        devLog('[WEB-UPDATE] Applying service worker update');
        applyUpdate();
      }
    };

    // Try to reload only when it won't destroy work; otherwise keep checking
    // so the update lands the moment the operator finishes their current edit.
    const tryReload = () => {
      if (cancelled) return;
      // Cooldown FIRST: if we already reloaded for an update in the last
      // 5 minutes, this "new" update is almost certainly SW churn, not a
      // real deploy. Stop retrying entirely — the next genuine update (or
      // a manual refresh) picks it up.
      if (reloadCooldownActive()) {
        devLog('[WEB-UPDATE] update detected but reload cooldown active — skipping');
        if (retryRef.current) clearInterval(retryRef.current);
        return;
      }
      // Track when navigation blocking started so we can impose a max timeout.
      // Reset when the driver leaves /navigation so a return visit starts fresh.
      if (window.location.pathname.startsWith('/navigation')) {
        if (navigationBlockedSinceRef.current === 0) {
          navigationBlockedSinceRef.current = Date.now();
        }
      } else {
        navigationBlockedSinceRef.current = 0;
      }
      if (isSafeToReload(Date.now() - navigationBlockedSinceRef.current)) {
        if (retryRef.current) clearInterval(retryRef.current);
        stampReload();
        navigationBlockedSinceRef.current = 0;
        doReload();
      }
    };

    // Brief grace period (lets an in-flight save/toast settle), then gated retry.
    initialTimerRef.current = setTimeout(() => {
      tryReload();
      if (!cancelled) {
        retryRef.current = setInterval(tryReload, 4000);
      }
    }, 2000);

    return () => {
      cancelled = true;
      if (initialTimerRef.current) clearTimeout(initialTimerRef.current);
      if (retryRef.current) clearInterval(retryRef.current);
    };
  }, [updateAvailable, applyUpdate, isElectron, electron]);

  // Render nothing — completely invisible
  return null;
}
