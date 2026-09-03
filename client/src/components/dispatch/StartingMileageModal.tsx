import React, { useState, useEffect } from 'react';
import { Navigation, Gauge, AlertCircle, X } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';

interface StartingMileageModalProps {
  isOpen: boolean;
  onClose: () => void;
  callId: string;
  callNumber: string;
  unitId?: string | number | null;
  onConfirm: (mileage: number) => Promise<void> | void;
}

export default function StartingMileageModal({
  isOpen,
  onClose,
  callId,
  callNumber,
  unitId,
  onConfirm,
}: StartingMileageModalProps) {
  const [mileage, setMileage] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchingOdo, setFetchingOdo] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setMileage('');
      setError(null);
      return;
    }

    // Attempt to prefetch vehicle odometer for the unit or shift
    let cancelled = false;
    setFetchingOdo(true);
    (async () => {
      try {
        if (unitId) {
          const res = await apiFetch<Array<{ current_mileage?: number | null; odometer?: number | null }>>(
            `/fleet/vehicles?assigned_unit_id=${unitId}`
          ).catch(() => null);
          const veh = Array.isArray(res) ? res[0] : res;
          const odo = veh?.current_mileage ?? veh?.odometer;
          if (!cancelled && odo != null && odo > 0) {
            setMileage(String(odo));
            return;
          }
        }
        // Fallback: check active time entry starting_mileage
        const timeRes = await apiFetch<{ active: boolean; entry?: { starting_mileage?: number | null } | null }>(
          '/personnel/time/mine/active'
        ).catch(() => null);
        if (!cancelled && timeRes?.entry?.starting_mileage != null) {
          setMileage(String(timeRes.entry.starting_mileage));
        }
      } catch {
        // non-fatal
      } finally {
        if (!cancelled) setFetchingOdo(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isOpen, unitId]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const num = parseFloat(mileage);
    if (isNaN(num) || num <= 0) {
      setError('Please enter a valid starting mileage greater than 0.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await onConfirm(num);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to confirm starting mileage');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs">
      <div
        className="w-full max-w-sm rounded-lg border border-[var(--spm-border)] p-4 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto"
        style={{ background: 'var(--surface-base)' }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mileage-modal-title"
      >
        <div className="flex items-center justify-between border-b border-[var(--spm-border)] pb-2">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-sm bg-brand-500/20 text-brand-400">
              <Navigation className="w-4 h-4" />
            </div>
            <div>
              <h3 id="mileage-modal-title" className="text-xs font-bold text-fg-primary uppercase tracking-wider">
                En Route Starting Mileage
              </h3>
              <p className="text-[10px] text-fg-muted">CFS {callNumber}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1 text-fg-muted hover:text-fg-primary transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-[10px] font-medium text-fg-secondary mb-1">
              Vehicle Starting Odometer
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-fg-muted">
                <Gauge className="w-3.5 h-3.5" />
              </div>
              <input
                type="number"
                step="0.1"
                min="0"
                required
                autoFocus
                placeholder={fetchingOdo ? 'Fetching odometer...' : 'e.g. 45210.5'}
                value={mileage}
                onChange={(e) => setMileage(e.target.value)}
                className="input-dark pl-8 text-xs font-mono w-full"
              />
            </div>
            <p className="text-[9px] text-fg-muted mt-1">
              {fetchingOdo
                ? 'Retrieving vehicle odometer...'
                : 'Confirm or edit starting odometer reading before en route departure.'}
            </p>
          </div>

          {error && (
            <div className="flex items-center gap-1.5 text-[10px] text-red-400 bg-red-950/40 border border-red-800/50 p-2 rounded-sm">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--spm-border)]">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-3 py-1.5 text-xs text-fg-secondary hover:text-fg-primary transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !mileage}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-fg-primary bg-brand-600 hover:bg-brand-500 rounded-sm disabled:opacity-50 transition-colors"
            >
              <Navigation className="w-3 h-3" />
              {loading ? 'Confirming...' : 'Confirm & Go En Route'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
