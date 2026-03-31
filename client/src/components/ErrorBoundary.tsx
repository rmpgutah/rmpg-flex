// ============================================================
// RMPG Flex — Error Boundary
// Catches uncaught React errors and shows a recovery UI
// ============================================================

import React, { Component, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  componentStack: string | null;
  showDetails: boolean;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, componentStack: null, showDetails: false };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary] Uncaught error:', error, info.componentStack);

    // Auto-reload on stale chunk errors (happens after deploys when cached JS references old chunks)
    const msg = error.message || '';
    if (msg.includes('Failed to fetch dynamically imported module') || msg.includes('ChunkLoadError') || msg.includes('Loading chunk')) {
      const reloadKey = 'rmpg_chunk_reload';
      const lastReload = sessionStorage.getItem(reloadKey);
      // Only auto-reload once per session to prevent infinite loops
      if (!lastReload || Date.now() - parseInt(lastReload) > 30000) {
        sessionStorage.setItem(reloadKey, String(Date.now()));
        window.location.reload();
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

  handleReload = () => {
    window.location.reload();
  };

  handleDismiss = () => {
    this.setState({ hasError: false, error: null, showDetails: false });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      const { error, showDetails } = this.state;
      const DetailIcon = showDetails ? ChevronUp : ChevronDown;

      return (
        <div className="flex items-center justify-center min-h-[400px] p-8">
          <div className="w-full max-w-lg bg-surface-base border border-red-900/50 shadow-2xl animate-scale-in" style={{ borderTop: '2px solid #dc2626' }}>
            {/* Header */}
            <div
              className="flex items-center gap-2 px-4 py-3 border-b border-red-900/30"
              style={{ background: 'linear-gradient(180deg, #2a1515 0%, #141e2b 100%)' }}
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
                {error?.message || 'Unknown error'}
              </p>

              {/* Action buttons */}
              <div className="flex items-center gap-3 mb-4">
                <button type="button"
                  onClick={this.handleReload}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold uppercase tracking-wide
                             bg-red-700 hover:bg-red-600 border border-red-500 text-white shadow-sm transition-colors"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Reload Page
                </button>
                <button type="button"
                  onClick={this.handleDismiss}
                  className="toolbar-btn"
                >
                  Try Again
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
                      <div className="text-[9px] text-rmpg-500 font-bold uppercase tracking-wider mb-1">Stack Trace</div>
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
