import React from 'react';
import { AlertTriangle, RefreshCw, Loader2 } from 'lucide-react';

interface ErrorRetryProps {
  message?: string;
  onRetry: () => void;
  retrying?: boolean;
  className?: string;
}

export default function ErrorRetry({
  message = 'Failed to load data. Please try again.',
  onRetry,
  retrying = false,
  className = '',
}: ErrorRetryProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center py-10 px-4 text-center ${className}`}
    >
      <div className="w-full max-w-sm rounded-sm border border-red-700/40 bg-red-900/20 p-6">
        <div className="flex items-center justify-center mb-3">
          <div className="w-10 h-10 rounded-sm bg-red-900/40 border border-red-700/50 flex items-center justify-center">
            <AlertTriangle size={20} className="text-red-400" />
          </div>
        </div>
        <p className="text-xs text-red-400 mb-4 leading-relaxed">{message}</p>
        <button
          onClick={onRetry}
          disabled={retrying}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider bg-red-900/30 hover:bg-red-900/50 border border-red-700/40 text-red-300 hover:text-red-200 transition-colors disabled:opacity-50"
        >
          {retrying ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <RefreshCw size={12} />
          )}
          {retrying ? 'Retrying...' : 'Retry'}
        </button>
      </div>
    </div>
  );
}
