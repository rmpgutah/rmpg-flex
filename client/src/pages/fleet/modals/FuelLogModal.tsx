import React, { useId, useEffect, useState } from 'react';
import { Fuel, DollarSign, Clock } from 'lucide-react';
import PanelTitleBar from '../../../components/PanelTitleBar';
import DiscardUnsavedDialog from '../../../components/DiscardUnsavedDialog';
import type { FuelType } from '../../../types';

export interface FuelFormState {
  fuel_date: string;
  gallons: string;
  cost_per_gallon: string;
  total_cost: string;
  odometer_reading: string;
  fuel_type: FuelType;
  station: string;
  notes: string;
  // Enhanced capture (2026-05-31) — these power the efficiency analytics:
  // is_full_tank gates MPG math (partial fills don't reset the tank), and
  // payment_method/driver/location feed the richer PDF + audit breakdowns.
  is_full_tank: boolean;
  payment_method: string;
  driver_name: string;
  location: string;
}

export const EMPTY_FUEL_FORM: FuelFormState = {
  fuel_date: '', gallons: '', cost_per_gallon: '', total_cost: '',
  odometer_reading: '', fuel_type: 'regular', station: '', notes: '',
  is_full_tank: true, payment_method: '', driver_name: '', location: '',
};

const PAYMENT_METHODS = ['Fuel Card', 'Credit Card', 'Cash', 'Fleet Account', 'Reimbursement'];

const FUEL_TYPES: { value: FuelType; label: string }[] = [
  { value: 'regular', label: 'Regular' },
  { value: 'premium', label: 'Premium' },
  { value: 'diesel', label: 'Diesel' },
];

const FUEL_GRADE: Record<FuelType, { led: string; desc: string }> = {
  regular: { led: 'led-green', desc: 'Unleaded 87' },
  premium: { led: 'led-amber', desc: 'Unleaded 91-93' },
  diesel:  { led: 'led-gray',  desc: 'Diesel #2' },
};

interface Props {
  isOpen: boolean;
  mode?: 'create' | 'edit';
  form: FuelFormState;
  onChange: (form: FuelFormState) => void;
  onSave: () => void;
  onClose: () => void;
  saving: boolean;
  isDirty?: boolean;
  draftRestored?: boolean;
  onDiscardDraft?: () => void;
}

export default function FuelLogModal({ isOpen, mode = 'create', form, onChange, onSave, onClose, saving, isDirty, draftRestored, onDiscardDraft }: Props) {
  const titleId = useId();
  const [discardOpen, setDiscardOpen] = useState(false);

  const confirmDiscard = () => {
    setDiscardOpen(false);
    onDiscardDraft?.();
    onClose();
  };

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) {
        if (isDirty) setDiscardOpen(true);
        else onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, saving, onClose, isDirty]);

  if (!isOpen) return null;

  const setField = (field: keyof FuelFormState, value: string) => {
    const updated = { ...form, [field]: value };
    // Auto-compute total_cost when gallons or cost_per_gallon change
    if ((field === 'gallons' || field === 'cost_per_gallon') && updated.gallons && updated.cost_per_gallon) {
      const total = parseFloat(updated.gallons) * parseFloat(updated.cost_per_gallon);
      if (!isNaN(total)) {
        // Preserve full precision — round to cents only for display, not storage
        updated.total_cost = String(Math.round(total * 100) / 100);
      }
    }
    onChange(updated);
  };

  const grade = FUEL_GRADE[form.fuel_type] || FUEL_GRADE.regular;

  const guardedClose = () => {
    if (isDirty && !saving) setDiscardOpen(true);
    else onClose();
  };

  return (
    <div className="fixed inset-0 z-50 print:hidden flex items-center justify-center bg-black/60" role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={saving ? undefined : guardedClose}>
      <div className="panel-beveled w-[520px] max-w-full mx-4 max-h-[80vh] flex flex-col bg-surface-raised" onClick={(e) => e.stopPropagation()}>
        <PanelTitleBar title={mode === 'edit' ? 'EDIT FUEL ENTRY' : 'LOG FUEL ENTRY'} icon={Fuel} id={titleId}>
          {isDirty && <span className="text-[8px] text-amber-400 font-bold uppercase tracking-wider mr-2">UNSAVED</span>}
          <button type="button" className="toolbar-btn text-[9px]" onClick={guardedClose}>X</button>
        </PanelTitleBar>
        <div className="flex-1 min-h-0 overflow-y-auto p-4">
          {draftRestored && onDiscardDraft && (
            <div className="flex items-center justify-between px-3 py-2 rounded-sm border border-amber-500/30 mb-3" style={{ background: 'rgb(var(--sev-warn-rgb) / 0.1)' }}>
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-amber-400" />
                <span className="text-xs text-amber-400 font-medium">Restored pending draft</span>
              </div>
              <button type="button" onClick={onDiscardDraft} className="text-[10px] text-amber-400 underline hover:text-amber-300">Discard</button>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="ff-fuellogmodal-0" className="text-[9px] text-rmpg-500 uppercase font-semibold block mb-0.5">Date / Time *</label>
              <input id="ff-fuellogmodal-0" className="input-dark w-full text-[11px] font-mono min-h-[36px]" type="datetime-local" step="1"
                value={form.fuel_date}
                onChange={(e) => setField('fuel_date', e.target.value)} />
            </div>
            <div>
              <label htmlFor="ff-fuellogmodal-1" className="text-[9px] text-rmpg-500 uppercase font-semibold block mb-0.5">Fuel Type</label>
              <select id="ff-fuellogmodal-1" className="select-dark w-full text-[11px] min-h-[36px]" value={form.fuel_type}
                onChange={(e) => setField('fuel_type', e.target.value)}>
                {FUEL_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              <div className="flex items-center gap-2 mt-1">
                <span className={`led-dot ${grade.led}`} />
                <span className="text-[8px] text-rmpg-500 uppercase">{grade.desc}</span>
              </div>
            </div>
            <div>
              <label htmlFor="ff-fuellogmodal-2" className="text-[9px] text-rmpg-500 uppercase font-semibold block mb-0.5">Gallons *</label>
              <input id="ff-fuellogmodal-2" className="input-dark w-full text-[11px] font-mono min-h-[36px]" type="number" step="0.001" value={form.gallons}
                onChange={(e) => setField('gallons', e.target.value)} placeholder="e.g. 15.500" />
            </div>
            <div>
              <label htmlFor="ff-fuellogmodal-3" className="text-[9px] text-rmpg-500 uppercase font-semibold block mb-0.5">Cost per Gallon ($)</label>
              <input id="ff-fuellogmodal-3" className="input-dark w-full text-[11px] font-mono min-h-[36px]" type="number" step="0.001" value={form.cost_per_gallon}
                onChange={(e) => setField('cost_per_gallon', e.target.value)} placeholder="e.g. 3.450" />
            </div>
            <div>
              <label htmlFor="ff-fuellogmodal-4" className="text-[9px] text-rmpg-500 uppercase font-semibold block mb-0.5">Total Cost ($)</label>
              <input id="ff-fuellogmodal-4" className="input-dark w-full text-[11px] font-mono min-h-[36px]" type="number" step="0.01" value={form.total_cost}
                onChange={(e) => setField('total_cost', e.target.value)} />
            </div>
            <div>
              <label htmlFor="ff-fuellogmodal-5" className="text-[9px] text-rmpg-500 uppercase font-semibold block mb-0.5">Odometer Reading</label>
              <input id="ff-fuellogmodal-5" className="input-dark w-full text-[11px] font-mono min-h-[36px]" type="number" step="0.1" value={form.odometer_reading}
                onChange={(e) => setField('odometer_reading', e.target.value)} placeholder="for MPG calc" />
            </div>

            {/* Full-tank toggle — drives MPG accuracy. A partial fill doesn't
                reset the tank, so its gallons can't be attributed to the
                odometer span; we record it but exclude it from MPG. */}
            <div>
              <label className="text-[9px] text-rmpg-500 uppercase font-semibold block mb-0.5">Fill Type</label>
              <label className="flex items-center gap-2 input-dark w-full text-[11px] min-h-[36px] px-2 cursor-pointer select-none">
                <input id="ff-fuellogmodal-6" type="checkbox" className="accent-brand-500" checked={form.is_full_tank}
                  onChange={(e) => onChange({ ...form, is_full_tank: e.target.checked })} />
                <span className={form.is_full_tank ? 'text-rmpg-200' : 'text-amber-400'}>
                  {form.is_full_tank ? 'Full Tank (counts toward MPG)' : 'Partial Fill (excluded from MPG)'}
                </span>
              </label>
            </div>
            <div>
              <label htmlFor="ff-fuellogmodal-7" className="text-[9px] text-rmpg-500 uppercase font-semibold block mb-0.5">Payment Method</label>
              <input id="ff-fuellogmodal-7" className="input-dark w-full text-[11px] min-h-[36px]" value={form.payment_method} list="fuel-pay-methods"
                onChange={(e) => setField('payment_method', e.target.value)} placeholder="e.g. Fuel Card" />
              <datalist id="fuel-pay-methods">
                {PAYMENT_METHODS.map((m) => <option key={m} value={m} />)}
              </datalist>
            </div>
            <div>
              <label htmlFor="ff-fuellogmodal-8" className="text-[9px] text-rmpg-500 uppercase font-semibold block mb-0.5">Driver / Officer</label>
              <input id="ff-fuellogmodal-8" className="input-dark w-full text-[11px] min-h-[36px]" value={form.driver_name}
                onChange={(e) => setField('driver_name', e.target.value)} placeholder="who fueled" />
            </div>

            {/* Live Cost Calculator */}
            {(form.gallons || form.cost_per_gallon) && (
              <div className="col-span-2 panel-beveled p-2.5 flex items-center justify-between bg-surface-sunken">
                <div className="flex items-center gap-3 text-[10px] font-mono">
                  <DollarSign className="w-3 h-3 text-green-500" />
                  <span className="text-rmpg-400">{form.gallons || '0.000'} gal</span>
                  <span className="text-rmpg-500">&times;</span>
                  <span className="text-rmpg-400">${form.cost_per_gallon || '0.000'}/gal</span>
                  <span className="text-rmpg-500">=</span>
                  <span className="text-green-400 font-bold text-xs">${form.total_cost || '0.00'}</span>
                </div>
                <span className="text-[8px] text-rmpg-500 uppercase tracking-wider">Computed Total</span>
              </div>
            )}

            <div>
              <label htmlFor="ff-fuellogmodal-9" className="text-[9px] text-rmpg-500 uppercase font-semibold block mb-0.5">Station</label>
              <input id="ff-fuellogmodal-9" className="input-dark w-full text-[11px] min-h-[36px]" value={form.station}
                onChange={(e) => setField('station', e.target.value)} placeholder="e.g. Shell - Main St" />
            </div>
            <div>
              <label htmlFor="ff-fuellogmodal-10" className="text-[9px] text-rmpg-500 uppercase font-semibold block mb-0.5">Location / City</label>
              <input id="ff-fuellogmodal-10" className="input-dark w-full text-[11px] min-h-[36px]" value={form.location}
                onChange={(e) => setField('location', e.target.value)} placeholder="e.g. Salt Lake City" />
            </div>
            <div className="col-span-2">
              <label htmlFor="ff-fuellogmodal-11" className="text-[9px] text-rmpg-500 uppercase font-semibold block mb-0.5">Notes</label>
              <textarea id="ff-fuellogmodal-11" className="input-dark w-full text-[10px] h-14 resize-none min-h-[36px]" value={form.notes}
                onChange={(e) => setField('notes', e.target.value)} maxLength={2000} />
              <div className="text-[8px] text-rmpg-500 text-right mt-0.5">{form.notes.length}/2000</div>
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-4 py-2 border-t border-rmpg-700">
          <button type="button" className="toolbar-btn" onClick={guardedClose} disabled={saving}>Cancel</button>
          <button type="button" className="toolbar-btn toolbar-btn-primary print:hidden" onClick={onSave} disabled={saving || !form.fuel_date || !form.gallons}>
            {saving ? 'Saving...' : mode === 'edit' ? 'Update Fuel' : 'Log Fuel'}
          </button>
        </div>
      </div>
      <DiscardUnsavedDialog isOpen={discardOpen} onClose={() => setDiscardOpen(false)} onConfirm={confirmDiscard} />
    </div>
  );
}
