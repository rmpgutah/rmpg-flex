// Retry-then-reload wrapper for plain dynamic `import()` of non-component
// modules. React.lazy() route chunks are guarded by lazyRetry() in App.tsx,
// but a bare `await import('../utils/foo')` inside an event handler has no
// such protection: when a long-lived tab requests an old hash the server no
// longer serves (after a Pages deploy rotates chunk hashes), the import throws
// "Failed to fetch dynamically imported module" and the rejection is swallowed
// by the caller's try/catch toast — it never reaches the ErrorBoundary, so the
// page never reloads and the feature stays broken until a manual refresh.
// (Incident: "Notice of Communication failed: Failed to fetch dynamically
// imported module .../psoNoticePdfGenerator-*.js".)
//
// Strategy mirrors lazyRetry: retry the import in place first (1.5s, 4s) to
// ride out the Pages deploy-propagation window where the fresh index already
// references a chunk the CDN is still replicating (a reload there re-fails
// instantly), then reload ONCE per 30s to pick up the fresh index.

import React from 'react';
import {
  isChunkLoadError, tryReloadForChunkFailure, normalizeChunkError,
  retryChunkImportInBrowser,
} from './chunkRetry';

/**
 * Dynamically import a module with stale-chunk resilience. Retries the import
 * in place, and on persistent failure reloads the page once to fetch the fresh
 * bundle. Returns a never-settling promise while a reload is in flight so the
 * caller doesn't surface a transient error to the user.
 *
 * The retry ladder itself (repair-then-retry, at 0/1.5s/4s) lives in
 * `retryChunkImportInBrowser` (chunkRetry.ts) — shared with `lazyRetry` so a
 * fix to the ladder applies to both call sites at once.
 */
export async function importWithRetry<T>(factory: () => Promise<T>): Promise<T> {
  try {
    return await retryChunkImportInBrowser(factory);
  } catch (err) {
    if (isChunkLoadError(err)) {
      const held = tryReloadForChunkFailure<T>(err);
      if (held) return held;
    }
    throw err;
  }
}

/**
 * React.lazy() with stale-chunk resilience: retry ladder → poison repair →
 * bounded reload. Shared by App.tsx route splits and any component-level lazy
 * import (Layout, MobileHomePage, map, etc.).
 */
export function lazyRetry<T extends React.ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
): React.LazyExoticComponent<T> {
  const withRetry = () => retryChunkImportInBrowser(factory);
  return React.lazy(() => withRetry().catch((err) => {
    const held = tryReloadForChunkFailure<{ default: T }>(err);
    if (held) return held;
    throw normalizeChunkError(err);
  }));
}
