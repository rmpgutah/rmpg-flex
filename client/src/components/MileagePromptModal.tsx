import { useState, useRef, useEffect } from 'react';
import { X, ShieldAlert, AlertTriangle } from 'lucide-react';

interface MileagePromptModalProps {
  mode: 'starting' | 'ending';
  /** Context label in the header (e.g. a call number, or "SHIFT START"). */
  callNumber: string;
  vehicleId: string;
  startingMileage?: number | null;
  /** Current unit mileage (pulled from units.mileage on the server side) */
  previousMileage?: number | null;
  /** Whether the current user has admin/manager/supervisor role — enables override */
  isManager?: boolean;
  /** Submit-button label override. Defaults to "Go En Route"/"Go On Scene" (call-status flow). */
  submitLabel?: string;
  /** Hide the "Skip — No Mileage" affordance. Used by the shift lifecycle, where mileage is strictly required. */
  hideSkip?: boolean;
  onSubmit: (mileage: number, vehicleId: string, overrideReason?: string) => void;
  onCancel: () => void;
}

/**
 * MileagePromptModal — prompts an officer for odometer readings when
 * changing call status to enroute (start) or onscene (end).
 *
 * MILEAGE GUARDRAILS (Claude Opus 4.8 — d3001d25):
 *   The pre-Claude version accepted any input without validation.
 *   Guardrails now mirror the backend's:
 *     1. Ceiling: 999,999 max
 *     2. Decreasing: warns when lower than previous
 *     3. Delta sanity: warns when single-step > 500 mi
 *   Admin overrides (ShieldAlert with reason textarea) gate the
 *   decreasing + delta cases so fleet data-integrity audits can
 *   reconstruct the justification for out-of-band writes.
 */
export default function MileagePromptModal({
  mode, callNumber, vehicleId, startingMileage,
  previousMileage, isManager = false,
  submitLabel, hideSkip = false,
  onSubmit, onCancel,
}: MileagePromptModalProps) {
  const [mileage, setMileage] = useState('');
  const [editVehicleId, setEditVehicleId] = useState(vehicleId || '');
  const [warning, setWarning] = useState<string | null>(null);
  const [overrideReason, setOverrideReason] = useState('');
  const [showOverride, setShowOverride] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, []);

  // Validate against guardrails — returns true if the value passes,
  // false if blocked (user must override or correct). For non-manager
  // users, the guardrail blocks the submit entirely.
  const validate = (val: number): boolean => {
    setWarning(null);
    setShowOverride(false);
    if (val > 999_999) {
      setWarning(`Mileage ${val.toLocaleString()} exceeds the maximum of 999,999. This is very likely a data-entry error — add one fewer digit.`);
      return false;
    }
    // Delta sanity: if we have a previous reading and the jump is > 500 mi
    // in a single session, that's not plausible for one patrol shift.
    if (previousMileage != null && val > previousMileage && val - previousMileage > 500) {
      if (isManager) {
        setWarning(`Mileage jumps ${val - previousMileage} miles from the previous reading (${previousMileage}). Override this to proceed, or correct the entry.`);
        setShowOverride(true);
        return false;
      }
      setWarning(`Mileage jumps ${val - previousMileage} miles from the previous reading (${previousMileage}). This is not a normal shift's driving distance — verify your entry or contact an admin.`);
      return false;
    }
    // Decreasing: if new < previous and user isn't a manager, block.
    if (previousMileage != null && val < previousMileage) {
      if (isManager) {
        setWarning(`New mileage (${val}) is lower than the previous reading (${previousMileage}). Override this to proceed, or correct the entry.`);
        setShowOverride(true);
        return false;
      }
      setWarning(`New mileage is lower than the previous reading (${previousMileage}). Odometer readings should not decrease. Contact an admin to override.`);
      return false;
    }
    return true;
  };

  const handleValueChange = (raw: string) => {
    setMileage(raw);
    setWarning(null);
    setShowOverride(false);
    const val = parseFloat(raw);
    if (!isNaN(val) && val >= 0) validate(val);
  };

  const handleSubmit = () => {
    const val = parseFloat(mileage);
    if (isNaN(val) || val < 0) return;
    if (!validate(val)) return;
    onSubmit(val, editVehicleId);
  };

  const handleOverride = () => {
    const val = parseFloat(mileage);
    if (isNaN(val) || val < 0) return;
    onSubmit(val, editVehicleId, overrideReason || undefined);
  };

  const handleSkip = () => {
    onSubmit(0, editVehicleId);
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" style={{ touchAction: 'manipulation' }} onClick={onCancel}>
      <div
        className="w-full max-w-[360px] border rounded-sm"
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

          <div>
            <label className="text-[10px] text-brand-gold-500 block mb-1">
              {mode === 'starting' ? 'Odometer Reading (Start)' : 'Odometer Reading (End)'}
            </label>
            <input
              ref={inputRef}
              type="number"
              min="0"
              max="999999"
              step="0.1"
              className="input-dark text-sm w-full font-mono"
              placeholder="e.g. 45230"
              value={mileage}
              onChange={(e) => handleValueChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); if (e.key === 'Escape') onCancel(); }}
            />
          </div>

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

          {/* Warning + override (Claude: d3001d25 guardrails) */}
          {warning && (
            <div className="rounded-sm p-2 text-[10px] space-y-2"
              style={{ background: 'rgba(212,160,23,0.08)', borderColor: 'rgba(212,160,23,0.3)', borderWidth: 1 }}>
              <div className="flex items-start gap-1.5">
                <ShieldAlert className="w-3.5 h-3.5 text-brand-gold-400 mt-0.5 shrink-0" />
                <span className="text-brand-gold-300 leading-relaxed">{warning}</span>
              </div>
              {showOverride && (
                <div className="space-y-1.5">
                  <textarea
                    className="input-dark text-[10px] w-full min-h-[40px] resize-none"
                    placeholder="Reason for override (required — appears in audit log)..."
                    value={overrideReason}
                    onChange={(e) => setOverrideReason(e.target.value)}
                    maxLength={500}
                  />
                  <button
                    type="button"
                    onClick={handleOverride}
                    disabled={!overrideReason.trim()}
                    className="toolbar-btn text-[10px] px-3 py-1 w-full bg-amber-900/30 border-amber-700 text-amber-300 hover:bg-amber-900/50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <AlertTriangle className="w-3 h-3 inline mr-1" />
                    Force Override
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex flex-col sm:flex-row justify-end gap-2 px-4 py-3 border-t"
          style={{ borderColor: 'var(--color-rmpg-600, #373737)', touchAction: 'manipulation' }}
        >
          {!hideSkip && (
            <button type="button" onClick={handleSkip} className="toolbar-btn text-xs px-4 py-2 min-h-[44px] sm:min-h-0 text-amber-400 hover:text-amber-300 order-2 sm:order-1">
              Skip — No Mileage
            </button>
          )}
          <div className="flex gap-2 order-1 sm:order-2">
            <button type="button" onClick={onCancel} className="toolbar-btn text-xs px-4 py-2 min-h-[44px] sm:min-h-0 flex-1 sm:flex-none">Cancel</button>
            <button type="button"
              onClick={handleSubmit}
              disabled={!mileage || isNaN(parseFloat(mileage))}
              className="toolbar-btn toolbar-btn-primary text-xs px-4 py-2 min-h-[44px] sm:min-h-0 flex-1 sm:flex-none"
            >
              {submitLabel ?? (mode === 'starting' ? 'Go En Route' : 'Go On Scene')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
