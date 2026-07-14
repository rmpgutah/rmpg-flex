import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { apiFetchV2 } from '../hooks/apiFetchV2';

/** Structurally compatible with both fuel-row shapes already used across
 *  the two fuel screens (FuelTab.tsx, FuelEntriesRoute.tsx) — every field
 *  here is optional so either existing row type satisfies it without
 *  changes to those files' own row interfaces. */
export interface FuelEntryRow {
  id: number;
  fuel_date?: string | null;
  gallons?: number | null;
  cost_per_gallon?: number | null;
  total_cost?: number | null;
  odometer?: number | null;
  fuel_type?: string | null;
  station?: string | null;
  notes?: string | null;
  is_full_tank?: number | null;
  payment_method?: string | null;
  driver_name?: string | null;
  location?: string | null;
}

// Optional fields (not `string | null` required) so this accepts
// useFleetWideFanOut's `VehicleStub` directly without a type error —
// a type with required fields is assignable to one with optional fields,
// but not the reverse.
interface VehicleOption { id: number; vehicle_number?: string | null; vehicle_name?: string | null; }

interface FuelEntryModalProps {
  /** Fixed vehicle (per-vehicle screens). Pass `null` for a fleet-wide
   *  create flow where the user must pick a vehicle — in that case also
   *  pass `vehicles`. */
  vehicleId: number | null;
  vehicles?: VehicleOption[];
  mode: 'create' | 'edit';
  /** Required when mode is 'edit'. */
  entry?: FuelEntryRow;
  onClose: () => void;
  onSaved: () => void;
}

export function FuelEntryModal({ vehicleId, vehicles, mode, entry, onClose, onSaved }: FuelEntryModalProps) {
  const [pickedVehicleId, setPickedVehicleId] = useState(vehicleId != null ? String(vehicleId) : '');
  const [fuelDate, setFuelDate] = useState(entry?.fuel_date ?? '');
  const [gallons, setGallons] = useState(entry?.gallons != null ? String(entry.gallons) : '');
  const [costPerGallon, setCostPerGallon] = useState(entry?.cost_per_gallon != null ? String(entry.cost_per_gallon) : '');
  const [totalCost, setTotalCost] = useState(entry?.total_cost != null ? String(entry.total_cost) : '');
  const [odometer, setOdometer] = useState(entry?.odometer != null ? String(entry.odometer) : '');
  const [fuelType, setFuelType] = useState(entry?.fuel_type ?? 'regular');
  const [station, setStation] = useState(entry?.station ?? '');
  const [notes, setNotes] = useState(entry?.notes ?? '');
  const [isFullTank, setIsFullTank] = useState(entry?.is_full_tank == null ? true : !!entry.is_full_tank);
  const [paymentMethod, setPaymentMethod] = useState(entry?.payment_method ?? '');
  const [driverName, setDriverName] = useState(entry?.driver_name ?? '');
  const [location, setLocation] = useState(entry?.location ?? '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey, { capture: true });
    return () => document.removeEventListener('keydown', onKey, { capture: true });
  }, [onClose, saving]);

  const handleSave = () => {
    setErr(null);
    if (vehicleId == null && !pickedVehicleId) {
      setErr('Vehicle is required.');
      return;
    }
    if (!fuelDate) {
      setErr('Date is required.');
      return;
    }
    setSaving(true);
    const body = JSON.stringify({
      fuel_date: fuelDate,
      gallons: gallons ? parseFloat(gallons) : null,
      cost_per_gallon: costPerGallon ? parseFloat(costPerGallon) : null,
      total_cost: totalCost ? parseFloat(totalCost) : null,
      odometer_reading: odometer ? parseFloat(odometer) : null,
      fuel_type: fuelType,
      station: station.trim() || null,
      notes: notes.trim() || null,
      is_full_tank: isFullTank,
      payment_method: paymentMethod.trim() || null,
      driver_name: driverName.trim() || null,
      location: location.trim() || null,
    });
    const targetVehicleId = vehicleId ?? parseInt(pickedVehicleId, 10);
    const req = mode === 'create'
      ? apiFetchV2(`/fleet/${targetVehicleId}/fuel`, { method: 'POST', body })
      : apiFetchV2(`/fleet/fuel/${entry!.id}`, { method: 'PUT', body });
    req
      .then(() => { setSaving(false); onSaved(); })
      .catch((e) => {
        setSaving(false);
        setErr(e instanceof Error ? e.message : `Failed to ${mode === 'create' ? 'create' : 'update'} fuel entry`);
      });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="fuel-entry-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={saving ? undefined : onClose}
    >
      <div
        className="bg-surface-raised border border-rmpg-700 rounded-sm w-[480px] max-w-full mx-4 max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-4 py-2 border-b border-rmpg-700">
          <h2 id="fuel-entry-modal-title" className="text-sm font-semibold text-rmpg-100">
            {mode === 'create' ? 'New Fuel Entry' : 'Edit Fuel Entry'}
          </h2>
          <button type="button" onClick={onClose} className="text-rmpg-400 hover:text-rmpg-100 p-1" disabled={saving} aria-label="Close">
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </header>
        <div className="p-4 space-y-3">
          {err ? <div className="px-3 py-2 rounded-sm border border-red-500/40 text-red-300 text-xs">{err}</div> : null}
          {vehicleId == null ? (
            <Field label="Vehicle *">
              <select
                className="w-full px-2 py-1 text-[12px] bg-surface-base border border-rmpg-700 rounded-sm text-rmpg-100"
                value={pickedVehicleId}
                onChange={(e) => setPickedVehicleId(e.target.value)}
                aria-required
                aria-label="Vehicle"
              >
                <option value="">— select vehicle —</option>
                {(vehicles ?? []).map((v) => (
                  <option key={v.id} value={v.id}>{v.vehicle_number ?? v.vehicle_name ?? `Vehicle ${v.id}`}</option>
                ))}
              </select>
            </Field>
          ) : null}
          <Field label="Date *">
            <input
              type="date"
              aria-label="Date"
              className="w-full px-2 py-1 text-[12px] bg-surface-base border border-rmpg-700 rounded-sm text-rmpg-100 font-mono"
              value={fuelDate}
              onChange={(e) => setFuelDate(e.target.value)}
              aria-required
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Gallons">
              <input
                type="number" inputMode="decimal" step="0.001" aria-label="Gallons"
                className="w-full px-2 py-1 text-[12px] bg-surface-base border border-rmpg-700 rounded-sm text-rmpg-100 font-mono"
                value={gallons} onChange={(e) => setGallons(e.target.value)}
              />
            </Field>
            <Field label="Cost/gal ($)">
              <input
                type="number" inputMode="decimal" step="0.001" aria-label="Cost per gallon"
                className="w-full px-2 py-1 text-[12px] bg-surface-base border border-rmpg-700 rounded-sm text-rmpg-100 font-mono"
                value={costPerGallon} onChange={(e) => setCostPerGallon(e.target.value)}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Total cost ($)">
              <input
                type="number" inputMode="decimal" step="0.01" aria-label="Total cost"
                className="w-full px-2 py-1 text-[12px] bg-surface-base border border-rmpg-700 rounded-sm text-rmpg-100 font-mono"
                value={totalCost} onChange={(e) => setTotalCost(e.target.value)}
              />
            </Field>
            <Field label="Odometer">
              <input
                type="number" inputMode="decimal" step="0.1" aria-label="Odometer"
                className="w-full px-2 py-1 text-[12px] bg-surface-base border border-rmpg-700 rounded-sm text-rmpg-100 font-mono"
                value={odometer} onChange={(e) => setOdometer(e.target.value)}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Fuel type">
              <select
                aria-label="Fuel type"
                className="w-full px-2 py-1 text-[12px] bg-surface-base border border-rmpg-700 rounded-sm text-rmpg-100"
                value={fuelType} onChange={(e) => setFuelType(e.target.value)}
              >
                <option value="regular">Regular</option>
                <option value="premium">Premium</option>
                <option value="diesel">Diesel</option>
              </select>
            </Field>
            <Field label="Station">
              <input
                type="text" aria-label="Station"
                className="w-full px-2 py-1 text-[12px] bg-surface-base border border-rmpg-700 rounded-sm text-rmpg-100"
                value={station} onChange={(e) => setStation(e.target.value)}
              />
            </Field>
          </div>
          <Field label="Fill type">
            <label className="flex items-center gap-2 px-2 py-1 text-[12px] text-rmpg-100">
              <input type="checkbox" className="accent-brand-400" checked={isFullTank} onChange={(e) => setIsFullTank(e.target.checked)} />
              {isFullTank ? 'Full tank (counts toward MPG)' : 'Partial fill (excluded from MPG)'}
            </label>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Payment method">
              <input
                type="text" aria-label="Payment method" placeholder="e.g. Fuel Card"
                className="w-full px-2 py-1 text-[12px] bg-surface-base border border-rmpg-700 rounded-sm text-rmpg-100"
                value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}
              />
            </Field>
            <Field label="Driver">
              <input
                type="text" aria-label="Driver"
                className="w-full px-2 py-1 text-[12px] bg-surface-base border border-rmpg-700 rounded-sm text-rmpg-100"
                value={driverName} onChange={(e) => setDriverName(e.target.value)}
              />
            </Field>
          </div>
          <Field label="Location">
            <input
              type="text" aria-label="Location"
              className="w-full px-2 py-1 text-[12px] bg-surface-base border border-rmpg-700 rounded-sm text-rmpg-100"
              value={location} onChange={(e) => setLocation(e.target.value)}
            />
          </Field>
          <Field label="Notes">
            <textarea
              aria-label="Notes"
              className="w-full px-2 py-1 text-[12px] bg-surface-base border border-rmpg-700 rounded-sm text-rmpg-100 h-16 resize-none"
              value={notes} onChange={(e) => setNotes(e.target.value)}
            />
          </Field>
        </div>
        <footer className="flex items-center justify-end gap-2 px-4 py-2 border-t border-rmpg-700">
          <button type="button" onClick={onClose} disabled={saving} className="px-2 py-1 text-[11px] border border-rmpg-700 rounded-sm hover:bg-rmpg-800 text-rmpg-100">
            Cancel
          </button>
          <button type="button" onClick={handleSave} disabled={saving} className="px-2 py-1 text-[11px] bg-brand-400 text-rmpg-950 rounded-sm hover:brightness-110 disabled:opacity-50">
            {saving ? 'Saving…' : mode === 'create' ? 'Create' : 'Save'}
          </button>
        </footer>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] text-rmpg-400 uppercase tracking-wide mb-0.5">{label}</div>
      {children}
    </div>
  );
}
