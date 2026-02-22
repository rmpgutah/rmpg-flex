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
  showDetails: boolean;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, showDetails: false };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary] Uncaught error:', error, info.componentStack);
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
          <div className="w-full max-w-lg bg-surface-base border border-red-900/50 shadow-2xl">
            {/* Header */}
            <div
              className="flex items-center gap-2 px-4 py-3 border-b border-red-900/30"
              style={{ background: 'linear-gradient(180deg, #2a1515 0%, #1a1a1a 100%)' }}
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
                <button
                  onClick={this.handleReload}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold uppercase tracking-wide
                             bg-red-700 hover:bg-red-600 border border-red-500 text-white shadow-sm transition-colors"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Reload Page
                </button>
                <button
                  onClick={this.handleDismiss}
                  className="toolbar-btn"
                >
                  Try Again
                </button>
              </div>

              {/* Collapsible details */}
              <button
                onClick={() => this.setState({ showDetails: !showDetails })}
                className="flex items-center gap-1 text-[10px] text-rmpg-400 hover:text-rmpg-200 transition-colors uppercase tracking-wider font-bold"
              >
                <DetailIcon className="w-3 h-3" />
                Error Details
              </button>
              {showDetails && error?.stack && (
                <pre className="mt-2 p-3 bg-black/40 border border-rmpg-700 text-[10px] text-rmpg-400 font-mono overflow-auto max-h-[200px] whitespace-pre-wrap">
                  {error.stack}
                </pre>
              )}
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
