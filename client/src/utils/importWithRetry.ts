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

const RELOAD_KEY = 'rmpg_chunk_reload';

function isChunkLoadError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes('failed to fetch dynamically imported module') ||
    msg.includes('chunkloaderror') ||
    msg.includes('loading chunk') ||
    msg.includes('failed to load module script') ||
    msg.includes('expected a javascript-or-wasm module') ||
    msg.includes('chunk load failed')
  );
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Dynamically import a module with stale-chunk resilience. Retries the import
 * in place, and on persistent failure reloads the page once to fetch the fresh
 * bundle. Returns a never-settling promise while a reload is in flight so the
 * caller doesn't surface a transient error to the user.
 */
export async function importWithRetry<T>(factory: () => Promise<T>): Promise<T> {
  try {
    return await factory();
  } catch {
    // First failure — retry in place before escalating to a reload.
  }
  try {
    await sleep(1500);
    return await factory();
  } catch {
    /* fall through to the longer retry */
  }
  try {
    await sleep(4000);
    return await factory();
  } catch (err) {
    if (isChunkLoadError(err)) {
      const last = sessionStorage.getItem(RELOAD_KEY);
      const now = Date.now();
      // Reload once per 30s to avoid a reload loop if the fresh index still
      // can't load the chunk (CDN still propagating / genuine server error).
      if (!last || now - parseInt(last) > 30000) {
        sessionStorage.setItem(RELOAD_KEY, String(now));
        window.location.reload();
        // Stay pending; the reload navigates away before this resolves.
        return new Promise<T>(() => { /* reload in flight */ });
      }
    }
    throw err;
  }
}
