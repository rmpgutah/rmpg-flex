// ═══════════════════════════════════════════════════════════════
// Upload Progress Bar — file upload progress with speed/ETA
// ═══════════════════════════════════════════════════════════════
import React from 'react';
import { Loader2, Check, Zap } from 'lucide-react';
import type { UploadProgress } from '../../utils/uploadWithProgress';
import { formatBytes, formatSpeed, formatEta } from '../../utils/uploadWithProgress';

interface UploadProgressBarProps {
  progress: UploadProgress | null;
  fileName?: string;
  fileCount?: number;   // "Uploading 3 of 5 files"
  totalFiles?: number;
}

export default function UploadProgressBar({
  progress,
  fileName,
  fileCount,
  totalFiles,
}: UploadProgressBarProps) {
  if (!progress) return null;

  const { phase, percent, loaded, total, speed, eta } = progress;

  // Phase icon
  const PhaseIcon = phase === 'done'
    ? Check
    : phase === 'processing'
      ? Zap
      : Loader2;

  const phaseLabel = phase === 'done'
    ? 'Complete'
    : phase === 'processing'
      ? 'Processing...'
      : phase === 'error'
        ? 'Error'
        : 'Uploading...';

  const barColor = phase === 'done'
    ? '#d4a017'    // gold for completion
    : phase === 'error'
      ? '#dc2626'
      : '#888888'; // brand blue

  return (
    <div className="w-full space-y-1 px-1">
      {/* Top row: file info + percentage */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <PhaseIcon
            className={`w-3 h-3 flex-shrink-0 ${
              phase === 'done'
                ? 'text-[#d4a017]'
                : phase === 'error'
                  ? 'text-red-400'
                  : phase === 'processing'
                    ? 'text-brand-400 animate-pulse'
                    : 'text-brand-400 animate-spin'
            }`}
          />
          <span className="text-[10px] text-rmpg-200 truncate">
            {fileName
              ? fileName
              : totalFiles && totalFiles > 1
                ? `File ${fileCount ?? 1} of ${totalFiles}`
                : phaseLabel}
          </span>
        </div>
        <span className="text-[10px] font-mono text-rmpg-300 tabular-nums flex-shrink-0">
          {phase === 'uploading' ? `${percent}%` : phaseLabel}
        </span>
      </div>

      {/* Progress bar */}
      <div
        className="w-full bg-[#0c0c0c] border border-[#2b2b2b] rounded-sm overflow-hidden"
        style={{ height: 4 }}
      >
        {phase === 'processing' ? (
          <div
            className="h-full rounded-sm animate-progress-indeterminate"
            style={{ background: barColor, width: '40%' }}
          />
        ) : (
          <div
            className="h-full rounded-sm transition-all duration-300 ease-out"
            style={{
              background: barColor,
              width: `${Math.min(100, Math.max(0, percent))}%`,
            }}
          />
        )}
      </div>

      {/* Bottom row: bytes + ETA + speed */}
      {phase === 'uploading' && total > 0 && (
        <div className="flex items-center justify-between text-[9px] text-rmpg-400 tabular-nums">
          <span>{formatBytes(loaded)} / {formatBytes(total)}</span>
          <span className="flex items-center gap-2">
            {speed > 0 && <span>{formatSpeed(speed)}</span>}
            {eta > 0 && <span>~{formatEta(eta)} remaining</span>}
          </span>
        </div>
      )}

      {/* Multi-file counter */}
      {totalFiles && totalFiles > 1 && phase === 'uploading' && (
        <div className="text-[9px] text-rmpg-500">
          Uploading {fileCount ?? 1} of {totalFiles} files
        </div>
      )}

      {/* Reuse the indeterminate animation from ProgressBar */}
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
