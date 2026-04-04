// ═══════════════════════════════════════════════════════════════
// Feature 25: Linear Progress Bar for long operations
// ═══════════════════════════════════════════════════════════════
import React from 'react';

interface ProgressBarProps {
  value?: number;         // 0-100, undefined for indeterminate
  label?: string;
  showPercent?: boolean;
  color?: string;
  height?: number;
  className?: string;
}

export default function ProgressBar({
  value,
  label,
  showPercent = true,
  color = '#888888',
  height = 4,
  className = '',
}: ProgressBarProps) {
  const isIndeterminate = value === undefined;

  return (
    <div className={`space-y-1 ${className}`}>
      {(label || (showPercent && !isIndeterminate)) && (
        <div className="flex items-center justify-between">
          {label && <span className="text-[9px] text-rmpg-400 uppercase font-bold tracking-wider">{label}</span>}
          {showPercent && !isIndeterminate && (
            <span className="text-[9px] font-mono text-rmpg-300">{Math.round(value!)}%</span>
          )}
        </div>
      )}
      <div
        className="w-full bg-surface-sunken border border-[#222222] rounded-sm overflow-hidden"
        style={{ height }}
      >
        {isIndeterminate ? (
          <div
            className="h-full rounded-sm animate-progress-indeterminate"
            style={{ background: color, width: '40%' }}
          />
        ) : (
          <div
            className="h-full rounded-sm transition-all duration-300 ease-out"
            style={{ background: color, width: `${Math.min(100, Math.max(0, value!))}%` }}
          />
        )}
      </div>
      <style>{`
        @keyframes progress-indeterminate {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(350%); }
        }
        .animate-progress-indeterminate {
          animation: progress-indeterminate 1.5s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}
