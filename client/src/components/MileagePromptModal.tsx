import { useState, useRef, useEffect } from 'react';
import { X, ShieldAlert } from 'lucide-react';

// ─── Guardrail constants ────────────────────────────────────
const MAX_PLAUSIBLE_MILEAGE = 999999;
const MAX_DELTA_WARNING = 500; // warn on >500 mi delta
const MAX_DECREASE_ALLOWANCE = 5; // allow small negative deltas (odometer rounding)

interface MileagePromptModalProps {
  mode: 'starting' | 'ending';
  callNumber: string;
  vehicleId: string;
  startingMileage?: number | null;
  /** Current known mileage (for guardrail validation) */
  currentMileage?: number | null;
  /** Whether the current user has admin/manager role for overrides */
  isAdmin?: boolean;
  onSubmit: (mileage: number, vehicleId: string, force?: boolean, reason?: string) => void;
  onCancel: () => void;
}

export default function MileagePromptModal({
  mode, callNumber, vehicleId, startingMileage, currentMileage, isAdmin, onSubmit, onCancel,
}: MileagePromptModalProps) {
  const [mileage, setMileage] = useState('');
  const [editVehicleId, setEditVehicleId] = useState(vehicleId || '');
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forceOverride, setForceOverride] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Auto-focus the mileage input on mount
    const timer = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, []);

  // Guardrail: validate mileage value on every input change
  useEffect(() => {
    if (!mileage) { setWarning(null); setError(null); return; }
    const val = parseFloat(mileage);
    if (isNaN(val)) { setWarning(null); setError(null); return; }

    // Out-of-bounds check
    if (val < 0) {
      setError('Mileage cannot be negative');
      return;
    }
    if (val > MAX_PLAUSIBLE_MILEAGE) {
      setError(`Mileage exceeds plausible max of ${MAX_PLAUSIBLE_MILEAGE.toLocaleString()}`);
      return;
    }

    // Decreasing check (ending mode only, against starting mileage)
    if (mode === 'ending' && startingMileage != null && val < startingMileage - MAX_DECREASE_ALLOWANCE) {
      setWarning(`Ending mileage (${val.toFixed(1)}) is ${(startingMileage - val).toFixed(1)} mi below starting mileage (${startingMileage.toFixed(1)}). Use force override if correct.`);
      if (isAdmin && forceOverride) setWarning(null);
    } else {
      setWarning(null);
    }

    // Delta check (against current known mileage)
    if (currentMileage != null && Math.abs(val - currentMileage) > MAX_DELTA_WARNING) {
      const delta = Math.abs(val - currentMileage);
      setWarning((prev) => prev || `Mileage delta of ${delta.toFixed(0)} mi is unusually large. Verify reading.`);
      if (isAdmin && forceOverride) setWarning(null);
    }

    setError(null);
  }, [mileage, mode, startingMileage, currentMileage, isAdmin, forceOverride]);

  const handleSubmit = () => {
    const val = parseFloat(mileage);
    if (isNaN(val) || val < 0 || val > MAX_PLAUSIBLE_MILEAGE) return;
    onSubmit(val, editVehicleId, forceOverride, overrideReason || undefined);
  };

  // Skip mileage — proceed with status change without entering mileage
  const handleSkip = () => {
    onSubmit(0, editVehicleId, false);
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" style={{ touchAction: 'manipulation' }} onClick={onCancel}>
      <div
        className="w-full max-w-[340px] border rounded-sm"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--color-rmpg-800, #141414)',
          borderColor: 'var(--color-rmpg-600, #373737)',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-3 py-2 border-b"
          style={{
            background: 'var(--color-rmpg-700, #181818)',
            borderColor: 'var(--color-rmpg-600, #373737)',
          }}
        >
          <span className="text-xs sm:text-xs font-bold text-white">
            {mode === 'starting' ? 'Starting Mileage' : 'Ending Mileage'} — {callNumber}
          </span>
          <button type="button" onClick={onCancel} className="text-rmpg-400 hover:text-white p-2 sm:p-0 min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 flex items-center justify-center" aria-label="Close" title="Close">
            <X className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
          </button>
        </div>

        {/* Body */}
        <div className="px-4 py-3 space-y-3">
          {mode === 'ending' && startingMileage != null && (
            <div className="text-[10px] text-rmpg-400">
              Starting mileage: <span className="text-brand-gold-400 font-mono font-bold">{startingMileage.toLocaleString()}</span>
            </div>
          )}

          {currentMileage != null && (
            <div className="text-[10px] text-rmpg-400">
              Current known: <span className="text-rmpg-200 font-mono">{currentMileage.toLocaleString()}</span>
            </div>
          )}

          <div>
            <label className="text-[10px] text-brand-gold-500 block mb-1">
              {mode === 'starting' ? 'Odometer Reading (Start)' : 'Odometer Reading (End)'}
            </label>
            <input
              ref={inputRef}
              type="number"
              min="0"
              max={MAX_PLAUSIBLE_MILEAGE}
              step="0.1"
              className="input-dark text-sm w-full font-mono"
              placeholder="e.g. 45230"
              value={mileage}
              onChange={(e) => { setMileage(e.target.value); setForceOverride(false); }}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); if (e.key === 'Escape') onCancel(); }}
            />
          </div>

          {/* Guardrail: error message (blocks submit) */}
          {error && (
            <div className="text-[10px] text-red-400 bg-red-900/20 border border-red-700/30 rounded-sm px-2 py-1 flex items-start gap-1">
              <ShieldAlert className="w-3 h-3 mt-px shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Guardrail: warning message (advisory) */}
          {warning && (
            <div className="text-[10px] text-amber-400 bg-amber-900/20 border border-amber-700/30 rounded-sm px-2 py-1 flex items-start gap-1">
              <ShieldAlert className="w-3 h-3 mt-px shrink-0" />
              <span>{warning}</span>
            </div>
          )}

          {/* Admin force-override: shown when guardrail fires and user is admin */}
          {warning && isAdmin && (
            <label className="flex items-center gap-2 text-[10px] text-rmpg-400 cursor-pointer">
              <input
                type="checkbox"
                checked={forceOverride}
                onChange={(e) => setForceOverride(e.target.checked)}
                className="w-3 h-3 rounded-sm accent-brand-gold-400"
              />
              <span className="text-brand-gold-400 font-bold">ADMIN FORCE OVERRIDE</span>
            </label>
          )}

          {/* Override reason field (shown when force is checked) */}
          {forceOverride && isAdmin && (
            <div>
              <label className="text-[10px] text-brand-gold-500 block mb-1">Override Reason (audited)</label>
              <input
                type="text"
                className="input-dark text-xs w-full"
                placeholder="Reason for override..."
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                maxLength={200}
              />
            </div>
          )}

          <div>
            <label className="text-[10px] text-brand-gold-500 block mb-1">Vehicle ID</label>
            {vehicleId ? (
              <div className="text-xs text-rmpg-200 font-mono bg-rmpg-700/50 border border-rmpg-600 rounded-sm px-2 py-1">
                {vehicleId}
              </div>
            ) : (
              <input
                type="text"
                className="input-dark text-xs w-full"
                placeholder="Vehicle ID or unit number"
                value={editVehicleId}
                onChange={(e) => setEditVehicleId(e.target.value)}
              />
            )}
          </div>

          {mode === 'ending' && startingMileage != null && mileage && !isNaN(parseFloat(mileage)) && (
            <div className="text-[10px] text-rmpg-400">
              Total miles: <span className="text-green-400 font-mono font-bold">
                {Math.max(0, parseFloat(mileage) - startingMileage).toFixed(1)}
              </span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex flex-col sm:flex-row justify-end gap-2 px-4 py-3 border-t"
          style={{ borderColor: 'var(--color-rmpg-600, #373737)', touchAction: 'manipulation' }}
        >
          <button type="button" onClick={handleSkip} className="toolbar-btn text-xs px-4 py-2 min-h-[44px] sm:min-h-0 text-amber-400 hover:text-amber-300 order-2 sm:order-1">
            Skip — No Mileage
          </button>
          <div className="flex gap-2 order-1 sm:order-2">
            <button type="button" onClick={onCancel} className="toolbar-btn text-xs px-4 py-2 min-h-[44px] sm:min-h-0 flex-1 sm:flex-none">Cancel</button>
            <button type="button"
              onClick={handleSubmit}
              disabled={!mileage || isNaN(parseFloat(mileage)) || !!error}
              className="toolbar-btn toolbar-btn-primary text-xs px-4 py-2 min-h-[44px] sm:min-h-0 flex-1 sm:flex-none"
            >
              {mode === 'starting' ? 'Go En Route' : 'Go On Scene'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
