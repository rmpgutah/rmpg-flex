import React, { useState, useEffect } from 'react';
import { Clock, Gauge, Car, AlertCircle, X, CheckCircle2 } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';

interface VehicleOption {
  id: number;
  vehicle_number?: string;
  name?: string;
  current_mileage?: number | null;
  odometer?: number | null;
}

interface ClockInOutMileageModalProps {
  isOpen: boolean;
  onClose: () => void;
  isClockingOut: boolean;
  officerId: string | number;
  onSuccess: (data: any) => void;
}

export default function ClockInOutMileageModal({
  isOpen,
  onClose,
  isClockingOut,
  officerId,
  onSuccess,
}: ClockInOutMileageModalProps) {
  const [vehicles, setVehicles] = useState<VehicleOption[]>([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string>('');
  const [mileage, setMileage] = useState<string>('');
  const [startingMileageDisplay, setStartingMileageDisplay] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setMileage('');
      setSelectedVehicleId('');
      setError(null);
      setStartingMileageDisplay(null);
      return;
    }

    let cancelled = false;

    if (isClockingOut) {
      // Fetch active time entry to get assigned vehicle and starting mileage
      apiFetch<{ active: boolean; entry?: any }>('/personnel/time/mine/active')
        .then((res: { active: boolean; entry?: any }) => {
          if (!cancelled && res.entry) {
            if (res.entry.starting_mileage != null) {
              setStartingMileageDisplay(Number(res.entry.starting_mileage));
            }
            if (res.entry.vehicle_id) {
              setSelectedVehicleId(String(res.entry.vehicle_id));
            }
          }
        })
        .catch(() => {});
    }

    // Load available vehicles
    apiFetch<VehicleOption[]>('/fleet/vehicles')
      .then((data: VehicleOption[]) => {
        if (!cancelled && Array.isArray(data)) {
          setVehicles(data);
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [isOpen, isClockingOut]);

  // When a vehicle is picked on clock-in, pre-fill its current mileage
  const handleVehicleSelect = (vId: string) => {
    setSelectedVehicleId(vId);
    if (!isClockingOut && vId) {
      const v = vehicles.find((x) => String(x.id) === String(vId));
      const odo = v?.current_mileage ?? v?.odometer;
      if (odo != null && odo > 0) {
        setMileage(String(odo));
      }
    }
  };

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const num = parseFloat(mileage);
    if (isNaN(num) || num <= 0) {
      setError(`Please enter a valid ${isClockingOut ? 'ending' : 'starting'} odometer reading.`);
      return;
    }

    if (isClockingOut && startingMileageDisplay != null && num < startingMileageDisplay) {
      setError(`Ending mileage (${num}) cannot be less than starting mileage (${startingMileageDisplay}).`);
      return;
    }

    setError(null);
    setLoading(true);

    try {
      if (isClockingOut) {
        const res = await apiFetch('/personnel/time/clock-out', {
          method: 'POST',
          body: JSON.stringify({
            officer_id: officerId != null ? Number(officerId) : undefined,
            ending_mileage: num,
          }),
        });
        onSuccess(res);
      } else {
        const res = await apiFetch('/personnel/time/clock-in', {
          method: 'POST',
          body: JSON.stringify({
            officer_id: officerId != null ? Number(officerId) : undefined,
            vehicle_id: selectedVehicleId ? Number(selectedVehicleId) : undefined,
            starting_mileage: num,
          }),
        });
        onSuccess(res);
      }
      onClose();
    } catch (err: any) {
      setError(err?.message || `Failed to ${isClockingOut ? 'clock out' : 'clock in'}`);
    } finally {
      setLoading(false);
    }
  };

  const shiftMilesCalculated =
    isClockingOut && startingMileageDisplay != null && !isNaN(parseFloat(mileage))
      ? Math.max(0, Math.round((parseFloat(mileage) - startingMileageDisplay) * 10) / 10)
      : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs">
      <div
        className="w-full max-w-md rounded-lg border border-[var(--spm-border)] p-4 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto"
        style={{ background: 'var(--surface-base)' }}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center justify-between border-b border-[var(--spm-border)] pb-2">
          <div className="flex items-center gap-2">
            <div
              className={`p-1.5 rounded-sm ${
                isClockingOut ? 'bg-amber-500/20 text-amber-400' : 'bg-green-500/20 text-green-400'
              }`}
            >
              <Clock className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs font-bold text-fg-primary uppercase tracking-wider">
                {isClockingOut ? 'Clock Out — Ending Mileage Report' : 'Clock In — Vehicle & Starting Mileage'}
              </h3>
              <p className="text-[10px] text-fg-muted">
                {isClockingOut ? 'Record shift end odometer' : 'Mandatory shift start report'}
              </p>
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
          {!isClockingOut && (
            <div>
              <label className="block text-[10px] font-medium text-fg-secondary mb-1">
                Assigned Vehicle (Optional)
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-fg-muted">
                  <Car className="w-3.5 h-3.5" />
                </div>
                <select
                  value={selectedVehicleId}
                  onChange={(e) => handleVehicleSelect(e.target.value)}
                  className="select-dark pl-8 text-xs w-full"
                >
                  <option value="">— No Vehicle Assigned / Walking / Fixed Post —</option>
                  {vehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.vehicle_number || v.name || `Vehicle #${v.id}`}
                      {v.current_mileage ? ` (${v.current_mileage} mi)` : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {isClockingOut && startingMileageDisplay != null && (
            <div className="flex items-center justify-between text-xs p-2 rounded-sm bg-surface-raised border border-[var(--spm-border)]">
              <span className="text-fg-muted">Starting Mileage on File:</span>
              <span className="font-mono font-bold text-fg-primary">{startingMileageDisplay.toFixed(1)} mi</span>
            </div>
          )}

          <div>
            <label className="block text-[10px] font-medium text-fg-secondary mb-1">
              {isClockingOut ? 'Ending Odometer Reading' : 'Starting Odometer Reading'}
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
                placeholder="e.g. 48120.4"
                value={mileage}
                onChange={(e) => setMileage(e.target.value)}
                className="input-dark pl-8 text-xs font-mono w-full"
              />
            </div>
          </div>

          {shiftMilesCalculated !== null && (
            <div className="flex items-center justify-between text-xs p-2 rounded-sm bg-brand-950/30 border border-brand-800/40 text-brand-300">
              <span className="flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5 text-brand-400" />
                <span>Calculated Shift Distance:</span>
              </span>
              <span className="font-mono font-bold">{shiftMilesCalculated.toFixed(1)} miles</span>
            </div>
          )}

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
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-fg-primary rounded-sm disabled:opacity-50 transition-colors ${
                isClockingOut ? 'bg-amber-600 hover:bg-amber-500' : 'bg-green-600 hover:bg-green-500'
              }`}
            >
              <Clock className="w-3 h-3" />
              {loading ? 'Submitting...' : isClockingOut ? 'Complete Clock Out' : 'Complete Clock In'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
