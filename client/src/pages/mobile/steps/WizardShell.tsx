// WizardShell — shared header (progress bar + back button) and footer
// (Continue button) for all 5 wizard steps.
//
// The shell owns nothing about form state — it just renders chrome and
// forwards navigation events to the controller.

import { useEffect, useRef } from 'react';
import { ChevronLeft, Loader2 } from 'lucide-react';

interface WizardShellProps {
  currentStep: number;
  totalSteps?: number;
  /** How many sections the reader should consider already completed (pre-solved + newly done). */
  sectionsDone?: number;
  /** Omit to hide the back button on step 1. */
  onBack?: () => void;
  onContinue: () => void;
  continueEnabled: boolean;
  continueLabel?: string;
  continueLoading?: boolean;
  children: React.ReactNode;
}

export default function WizardShell({
  currentStep,
  totalSteps = 5,
  sectionsDone,
  onBack,
  onContinue,
  continueEnabled,
  continueLabel = 'Continue',
  continueLoading = false,
  children,
}: WizardShellProps) {
  const shellRef = useRef<HTMLDivElement>(null);

  // iOS keyboard: shrink the shell to the visual viewport so the footer stays visible.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const handleResize = () => {
      if (shellRef.current) {
        shellRef.current.style.height = `${vv.height}px`;
      }
    };
    vv.addEventListener('resize', handleResize);
    handleResize();
    return () => vv.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div ref={shellRef} className="min-h-screen bg-white flex flex-col" style={{ height: '100dvh' }}>
      {/* ── Header ─────────────────────────────────────────────── */}
      <header className="bg-white border-b border-gray-200 px-4 pt-3 pb-3 flex-shrink-0">
        <div className="max-w-lg mx-auto">
          <div className="flex items-center gap-3">
            {onBack ? (
              <button
                type="button"
                onClick={onBack}
                className="p-1 -ml-1 text-gray-300 active:opacity-60 shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center"
                aria-label="Go back"
              >
                <ChevronLeft size={24} />
              </button>
            ) : (
              // Reserve space so the progress bar aligns the same on step 1
              <span className="w-7 shrink-0" aria-hidden />
            )}
            {/* Screen-reader live announcement — the visual bar is aria-hidden. */}
            {sectionsDone !== undefined && (
              <p role="status" className="sr-only">Step {sectionsDone} of 5 complete</p>
            )}
            {/* 5-segment progress bar */}
            <div className="flex gap-1 flex-1" role="progressbar" aria-valuenow={currentStep} aria-valuemin={1} aria-valuemax={totalSteps} aria-label={`Step ${currentStep} of ${totalSteps}`}>
              {Array.from({ length: totalSteps }, (_, i) => (
                <span
                  key={i}
                  className={`h-1.5 flex-1 rounded-sm transition-colors ${
                    i + 1 <= currentStep ? 'bg-blue-600' : 'bg-gray-200'
                  }`}
                />
              ))}
            </div>
            <span className="text-xs text-gray-400 shrink-0 tabular-nums">
              {currentStep}/{totalSteps}
            </span>
          </div>
        </div>
      </header>

      {/* ── Step content ──────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {children}
      </div>

      {/* ── Footer: Continue button ────────────────────────────── */}
      <div className="bg-white border-t border-gray-200 px-4 pt-3 pb-5 flex-shrink-0" style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom, 1.25rem))' }}>
        <div className="max-w-lg mx-auto">
          <button
            type="button"
            onClick={onContinue}
            disabled={!continueEnabled || continueLoading}
            className="w-full py-3.5 rounded-sm font-semibold text-[15px] bg-blue-600 text-white disabled:opacity-40 active:opacity-80 flex items-center justify-center gap-2"
          >
            {continueLoading
              ? <><Loader2 size={16} className="animate-spin" /> Submitting…</>
              : continueLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
