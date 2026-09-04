// ============================================================
// RMPG Flex — Error Boundary
// Catches uncaught React errors and shows a recovery UI
// ============================================================

import React, { Component, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import {
  CHUNK_RELOAD_KEY,
  CHUNK_RELOAD_WINDOW_MS,
  isChunkLoadError,
  repairAllPoisonedChunksInBrowser,
  evictPoisonedChunkCachesInBrowser,
} from '../utils/chunkRetry';

/** Ceiling on the pre-reload repair fetch, so a hung network can never make the
 *  Reload button feel dead. Mirrors index.html's 3s entry-recovery ceiling. */
const RECOVERY_FETCH_CEILING_MS = 3_000;

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  componentStack: string | null;
  showDetails: boolean;
  isOffline: boolean;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, componentStack: null, showDetails: false, isOffline: false };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error, isOffline: typeof navigator !== 'undefined' && navigator.onLine === false };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary] Uncaught error:', error, info.componentStack);

    // Auto-reload on stale chunk errors (happens after deploys when cached JS
    // references old chunks). This is a safety net — lazyRetry normally reloads
    // before the boundary is hit. Uses the same key/window as chunkRetry.ts so
    // the two guards are always in sync (avoids duplicate hardcoded strings).
    if (isChunkLoadError(error)) {
      const lastReload = sessionStorage.getItem(CHUNK_RELOAD_KEY);
      const lastAt = lastReload ? parseInt(lastReload, 10) : null;
      if (lastAt === null || Number.isNaN(lastAt) || Date.now() - lastAt > CHUNK_RELOAD_WINDOW_MS) {
        sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
        // A plain reload is a no-op against HTTP-cache-poisoned chunks (same
        // current index.html -> same poisoned chunk URL -> same failure), so
        // this auto-path must run the same bounded evict+repair dance as the
        // manual "Reload Page" button before reloading. See ErrorBoundary's
        // `recoverThenReload` for the shared ordering rationale.
        this.recoverThenReload(error);
        return;
      }
    }

    // Save component stack for display in error UI
    this.setState({ componentStack: info.componentStack || null });
    // Report to server for diagnostics (fire-and-forget, best-effort)
    try {
      const token = localStorage.getItem('rmpg_token');
      if (token) {
        fetch('/api/admin/health/client-error', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            message: error.message,
            stack: error.stack,
            componentStack: info.componentStack,
            url: window.location.href,
            timestamp: new Date().toISOString(),
          }),
        }).catch(() => {});
      }
    } catch { /* silent */ }
  }

  /**
   * Bypass-refetch the poisoned chunk (and, for the manual button, purge SW
   * caches) before reloading. A PLAIN reload cannot fix the HTTP-cache-poison
   * failure class — same current index -> same poisoned cached chunk -> same
   * card, forever. Bounded by RECOVERY_FETCH_CEILING_MS so a hung network can
   * never make recovery feel dead — the same reasoning as index.html's 3s
   * ceiling on its entry recovery.
   *
   * `purgeCaches` is opt-in: the BROAD service-worker purge costs offline
   * capability until the next online load, so it stays confined to the
   * explicit user-initiated Reload button and is skipped on the automatic
   * componentDidCatch safety net (which must still repair the HTTP cache —
   * a plain reload there was a guaranteed no-op — but shouldn't silently
   * strip offline support from a unit that never asked for a reload).
   *
   * Repairs via `repairAllPoisonedChunksInBrowser`, not just the one URL in
   * `err`'s message: Chrome's dynamic-import rejection only ever names the
   * TOP-LEVEL import target, never a transitive sub-chunk that top-level
   * module statically imports. Resource Timing catches those regardless of
   * what the rejection message says — see chunkRetry.ts.
   */
  private recoverThenReload(err: Error, purgeCaches = false) {
    // Ordering is load-bearing when purging: eviction must run FIRST, since a
    // `fetch(..., {cache:'reload'})` bypasses the HTTP cache but is still
    // dispatched through the service worker's fetch handler, so repairing
    // while a poisoned SW is registered lets that same SW answer the repair
    // request from its own bad cache.
    const recover = async () => {
      if (purgeCaches) await evictPoisonedChunkCachesInBrowser();
      await repairAllPoisonedChunksInBrowser(err);
    };
    void Promise.race([
      recover(),
      new Promise((r) => setTimeout(r, RECOVERY_FETCH_CEILING_MS)),
    ]).then(() => window.location.reload(), () => window.location.reload());
  }

  handleReload = () => {
    // Clear the chunk-reload guard so the fresh load can auto-retry if chunks
    // still fail (e.g. during a multi-minute CF Pages propagation window).
    try { sessionStorage.removeItem(CHUNK_RELOAD_KEY); } catch { /* private mode */ }

    const err = this.state.error;
    if (err && isChunkLoadError(err)) {
      this.recoverThenReload(err, /* purgeCaches */ true);
      return;
    }
    window.location.reload();
  };

  handleDismiss = () => {
    // Navigate to the app root rather than re-rendering children — resetting
    // hasError would re-render the same children that threw (render-time
    // error like a null-pointer), which immediately throws again, creating
    // a rapid crash loop. Navigation creates a fresh document, gives
    // transient errors a clean slate, and avoids the loop entirely.
    window.location.href = '/';
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      const { error, showDetails, isOffline } = this.state;
      const DetailIcon = showDetails ? ChevronUp : ChevronDown;

      // When a lazy chunk fails to load and the device is offline, "Reload Page"
      // would only fail again. Show a connectivity-specific recovery screen instead.
      const isOfflineChunkFailure = isOffline && isChunkLoadError(error ?? new Error());
      if (isOfflineChunkFailure) {
        return (
          <div className="flex items-center justify-center min-h-[400px] p-8">
            <div className="w-full max-w-md bg-surface-base border border-rmpg-700 shadow-md animate-scale-in text-center p-8">
              <p className="text-sm font-bold text-rmpg-100 uppercase tracking-wider mb-3">
                Connection Lost
              </p>
              <p className="text-xs text-fg-muted leading-relaxed mb-6">
                This page couldn't load because your device is offline.<br />
                It will reload automatically when your connection returns.
              </p>
              <button type="button"
                onClick={this.handleReload}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold uppercase tracking-wide
                           bg-surface-raised hover:bg-surface-hover border border-rmpg-600 text-rmpg-200 transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Retry Now
              </button>
            </div>
          </div>
        );
      }

      return (
        <div className="flex items-center justify-center min-h-[400px] p-8">
          <div className="w-full max-w-lg bg-surface-base border border-red-900/50 shadow-md animate-scale-in" style={{ borderTop: '2px solid var(--sev-critical)' }}>
            {/* Header */}
            <div
              className="flex items-center gap-2 px-4 py-3 border-b border-red-900/30"
              style={{ background: 'linear-gradient(180deg, rgb(var(--sev-critical-rgb) / 0.08) 0%, var(--surface-sunken) 100%)' }}
            >
              <AlertTriangle className="w-5 h-5 text-red-400" />
              <h2 className="text-sm font-bold text-red-300 uppercase tracking-wider">
                Application Error
              </h2>
            </div>

            {/* Body */}
            <div className="p-6">
              <p className="text-sm text-rmpg-200 leading-relaxed mb-2">
                An unexpected error occurred. This page could not be rendered.
              </p>
              <p className="text-xs text-rmpg-400 mb-4">
                {error instanceof Error ? error.message : 'Unknown error'}
              </p>

              {/* Action buttons */}
              <div className="flex items-center gap-3 mb-4">
                <button type="button"
                  onClick={this.handleReload}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold uppercase tracking-wide
                             bg-red-700 hover:bg-red-600 border border-red-500 text-rmpg-100 shadow-sm transition-colors"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Reload Page
                </button>
                <button type="button"
                  onClick={this.handleDismiss}
                  className="toolbar-btn"
                >
                  Return Home
                </button>
              </div>

              {/* Collapsible details */}
              <button type="button"
                onClick={() => this.setState({ showDetails: !showDetails })}
                className="flex items-center gap-1 text-[10px] text-rmpg-400 hover:text-rmpg-200 transition-colors uppercase tracking-wider font-bold"
              >
                <DetailIcon className="w-3 h-3" />
                Error Details
              </button>
              {showDetails && (
                <div className="mt-2 space-y-2">
                  {this.state.componentStack && (
                    <div>
                      <div className="text-[9px] text-red-400 font-bold uppercase tracking-wider mb-1">Component Stack</div>
                      <pre className="p-3 bg-black/40 border border-red-900/40 text-[10px] text-red-300 font-mono overflow-auto max-h-[150px] whitespace-pre-wrap">
                        {this.state.componentStack}
                      </pre>
                    </div>
                  )}
                  {error?.stack && (
                    <div>
                      <div className="text-[9px] text-fg-muted font-bold uppercase tracking-wider mb-1">Stack Trace</div>
                      <pre className="p-3 bg-black/40 border border-rmpg-700 text-[10px] text-rmpg-400 font-mono overflow-auto max-h-[150px] whitespace-pre-wrap">
                        {error.stack}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
