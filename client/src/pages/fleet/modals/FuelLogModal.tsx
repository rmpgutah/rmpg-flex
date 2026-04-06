import React, { useId } from 'react';
import { Fuel, DollarSign } from 'lucide-react';
import PanelTitleBar from '../../../components/PanelTitleBar';
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
}

export const EMPTY_FUEL_FORM: FuelFormState = {
  fuel_date: '', gallons: '', cost_per_gallon: '', total_cost: '',
  odometer_reading: '', fuel_type: 'regular', station: '', notes: '',
};

const FUEL_TYPES: { value: FuelType; label: string }[] = [
  { value: 'regular', label: 'Regular' },
  { value: 'premium', label: 'Premium' },
  { value: 'diesel', label: 'Diesel' },
];

const FUEL_GRADE: Record<FuelType, { led: string; desc: string }> = {
  regular: { led: 'led-green', desc: 'Unleaded 87' },
  premium: { led: 'led-amber', desc: 'Unleaded 91-93' },
  diesel:  { led: 'led-blue',  desc: 'Diesel #2' },
};

interface Props {
  isOpen: boolean;
  mode?: 'create' | 'edit';
  form: FuelFormState;
  onChange: (form: FuelFormState) => void;
  onSave: () => void;
  onClose: () => void;
  saving: boolean;
}

export default function FuelLogModal({ isOpen, mode = 'create', form, onChange, onSave, onClose, saving }: Props) {
  const titleId = useId();
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true" aria-labelledby={titleId} style={{ background: 'rgba(0,0,0,0.6)' }}>
      <div className="panel-beveled w-[520px] max-h-[80vh] flex flex-col" style={{ background: '#1a2636' }}>
        <PanelTitleBar title={mode === 'edit' ? 'EDIT FUEL ENTRY' : 'LOG FUEL ENTRY'} icon={Fuel} id={titleId}>
          <button className="toolbar-btn text-[9px]" onClick={onClose}>X</button>
        </PanelTitleBar>
        <div className="flex-1 overflow-y-auto p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[9px] text-gray-500 uppercase font-semibold block mb-0.5">Date / Time *</label>
              <input className="input-dark w-full text-[11px] font-mono" type="datetime-local" step="1"
                value={form.fuel_date}
                onChange={(e) => setField('fuel_date', e.target.value)} />
            </div>
            <div>
              <label className="text-[9px] text-gray-500 uppercase font-semibold block mb-0.5">Fuel Type</label>
              <select className="select-dark w-full text-[11px]" value={form.fuel_type}
                onChange={(e) => setField('fuel_type', e.target.value)}>
                {FUEL_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              <div className="flex items-center gap-2 mt-1">
                <span className={`led-dot ${grade.led}`} />
                <span className="text-[8px] text-rmpg-500 uppercase">{grade.desc}</span>
              </div>
            </div>
            <div>
              <label className="text-[9px] text-gray-500 uppercase font-semibold block mb-0.5">Gallons *</label>
              <input className="input-dark w-full text-[11px] font-mono" type="number" step="0.001" value={form.gallons}
                onChange={(e) => setField('gallons', e.target.value)} placeholder="e.g. 15.500" />
            </div>
            <div>
              <label className="text-[9px] text-gray-500 uppercase font-semibold block mb-0.5">Cost per Gallon ($)</label>
              <input className="input-dark w-full text-[11px] font-mono" type="number" step="0.001" value={form.cost_per_gallon}
                onChange={(e) => setField('cost_per_gallon', e.target.value)} placeholder="e.g. 3.450" />
            </div>
            <div>
              <label className="text-[9px] text-gray-500 uppercase font-semibold block mb-0.5">Total Cost ($)</label>
              <input className="input-dark w-full text-[11px] font-mono" type="number" step="0.01" value={form.total_cost}
                onChange={(e) => setField('total_cost', e.target.value)} />
            </div>
            <div>
              <label className="text-[9px] text-gray-500 uppercase font-semibold block mb-0.5">Odometer Reading</label>
              <input className="input-dark w-full text-[11px] font-mono" type="number" step="0.1" value={form.odometer_reading}
                onChange={(e) => setField('odometer_reading', e.target.value)} />
            </div>

            {/* Live Cost Calculator */}
            {(form.gallons || form.cost_per_gallon) && (
              <div className="col-span-2 panel-beveled p-2.5 flex items-center justify-between bg-surface-sunken">
                <div className="flex items-center gap-3 text-[10px] font-mono">
                  <DollarSign className="w-3 h-3 text-green-500" />
                  <span className="text-gray-400">{form.gallons || '0.000'} gal</span>
                  <span className="text-rmpg-500">&times;</span>
                  <span className="text-gray-400">${form.cost_per_gallon || '0.000'}/gal</span>
                  <span className="text-rmpg-500">=</span>
                  <span className="text-green-400 font-bold text-xs">${form.total_cost || '0.00'}</span>
                </div>
                <span className="text-[8px] text-rmpg-500 uppercase tracking-wider">Computed Total</span>
              </div>
            )}

            <div className="col-span-2">
              <label className="text-[9px] text-gray-500 uppercase font-semibold block mb-0.5">Station</label>
              <input className="input-dark w-full text-[11px]" value={form.station}
                onChange={(e) => setField('station', e.target.value)} placeholder="e.g. Shell - Main St" />
            </div>
            <div className="col-span-2">
              <label className="text-[9px] text-gray-500 uppercase font-semibold block mb-0.5">Notes</label>
              <textarea className="input-dark w-full text-[10px] h-14 resize-none" value={form.notes}
                onChange={(e) => setField('notes', e.target.value)} />
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-4 py-2 border-t border-rmpg-700">
          <button className="toolbar-btn" onClick={onClose}>Cancel</button>
          <button className="toolbar-btn toolbar-btn-primary" onClick={onSave} disabled={saving}>
            {saving ? 'Saving...' : mode === 'edit' ? 'Update Fuel' : 'Log Fuel'}
          </button>
        </div>
      </div>
    </div>
  );
}
