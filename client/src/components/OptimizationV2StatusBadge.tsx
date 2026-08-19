import { Loader2, CheckCircle2, XCircle } from 'lucide-react';

interface Props {
  status: 'idle' | 'pending' | 'processing' | 'complete' | 'error';
  elapsedMs?: number;
  className?: string;
}

export default function OptimizationV2StatusBadge({ status, elapsedMs, className = '' }: Props) {
  if (status === 'idle') return null;

  const elapsedS = elapsedMs != null ? Math.floor(elapsedMs / 1000) : 0;

  if (status === 'pending') {
    return (
      <span
        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-900/40 text-amber-300 border border-amber-700/40 ${className}`}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
        Queued
      </span>
    );
  }

  if (status === 'processing') {
    return (
      <span
        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-900/40 text-blue-300 border border-blue-700/40 ${className}`}
      >
        <Loader2 className="w-3 h-3 animate-spin" />
        {`Optimizing… ${elapsedS}s`}
      </span>
    );
  }

  if (status === 'complete') {
    return (
      <span
        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-green-900/40 text-green-300 border border-green-700/40 ${className}`}
      >
        <CheckCircle2 className="w-3 h-3" />
        Optimized
      </span>
    );
  }

  // error
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-red-900/40 text-red-300 border border-red-700/40 ${className}`}
    >
      <XCircle className="w-3 h-3" />
      Failed
    </span>
  );
}
