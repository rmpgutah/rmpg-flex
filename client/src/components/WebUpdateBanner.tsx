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

function reloadCooldownActive(): boolean {
  try {
    const last = parseInt(localStorage.getItem(RELOAD_STAMP_KEY) || '0', 10);
    return Number.isFinite(last) && Date.now() - last < RELOAD_COOLDOWN_MS;
  } catch { return false; }
}

function stampReload(): void {
  try { localStorage.setItem(RELOAD_STAMP_KEY, String(Date.now())); } catch { /* private mode */ }
}

/** True when reloading right now would NOT lose unsaved work. */
function isSafeToReload(): boolean {
  const ae = document.activeElement as HTMLElement | null;
  if (ae) {
    const tag = ae.tagName;
    // A focused field means the operator is actively typing.
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return false;
    if (ae.isContentEditable) return false;
  }
  // An open modal/dialog almost always wraps an in-progress action (add/edit
  // forms in this app are modals). Defer until it closes.
  if (document.querySelector('[role="dialog"], [aria-modal="true"]')) return false;
  return true;
}

export default function WebUpdateBanner() {
  const { updateAvailable, applyUpdate } = useServiceWorker();
  const initialTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
      if (isSafeToReload()) {
        if (retryRef.current) clearInterval(retryRef.current);
        stampReload();
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
