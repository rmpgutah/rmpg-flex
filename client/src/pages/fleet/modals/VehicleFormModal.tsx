import React, { useId, useEffect } from 'react';
import { Car } from 'lucide-react';
import PanelTitleBar from '../../../components/PanelTitleBar';
import type { FleetVehicleStatus } from '../../../types';

export interface VehicleFormState {
  vehicle_number: string;
  make: string;
  model: string;
  year: string;
  color: string;
  vin: string;
  plate_number: string;
  plate_state: string;
  status: FleetVehicleStatus;
  current_mileage: string;
  next_service_mileage: string;
  insurance_expiry: string;
  registration_expiry: string;
  equipment_str: string;
  notes: string;
}

export const EMPTY_VEHICLE_FORM: VehicleFormState = {
  vehicle_number: '', make: '', model: '', year: '', color: '', vin: '',
  plate_number: '', plate_state: '', status: 'in_service', current_mileage: '',
  next_service_mileage: '', insurance_expiry: '', registration_expiry: '', equipment_str: '', notes: '',
};

const VEHICLE_STATUSES: { value: FleetVehicleStatus; label: string }[] = [
  { value: 'in_service', label: 'In Service' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'out_of_service', label: 'Out of Service' },
  { value: 'retired', label: 'Retired' },
];

interface Props {
  isOpen: boolean;
  mode: 'new_vehicle' | 'edit_vehicle';
  form: VehicleFormState;
  onChange: (form: VehicleFormState) => void;
  onSave: () => void;
  onClose: () => void;
  saving: boolean;
}

export default function VehicleFormModal({ isOpen, mode, form, onChange, onSave, onClose, saving }: Props) {
  const titleId = useId();

  // Escape to close
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !saving) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, saving, onClose]);

  if (!isOpen) return null;

  const setField = (field: keyof VehicleFormState, value: string) =>
    onChange({ ...form, [field]: value });

  return (
    <div className="fixed inset-0 z-50 print:hidden flex items-center justify-center" role="dialog" aria-modal="true" aria-labelledby={titleId} style={{ background: 'rgba(0,0,0,0.6)' }}>
      <div className="panel-beveled w-[560px] max-h-[80vh] flex flex-col" style={{ background: '#1a2636' }}>
        <PanelTitleBar title={mode === 'new_vehicle' ? 'NEW VEHICLE' : 'EDIT VEHICLE'} icon={Car} id={titleId}>
          <button type="button" className="toolbar-btn text-[9px]" onClick={onClose}>X</button>
        </PanelTitleBar>
        <div className="flex-1 overflow-y-auto p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[9px] text-rmpg-500 uppercase font-semibold block mb-0.5">Vehicle Number *</label>
              <input className="input-dark w-full text-[11px] font-mono min-h-[36px]" value={form.vehicle_number}
                onChange={(e) => setField('vehicle_number', e.target.value)} />
            </div>
            <div>
              <label className="text-[9px] text-rmpg-500 uppercase font-semibold block mb-0.5">Status</label>
              <select className="select-dark w-full text-[11px] min-h-[36px]" value={form.status}
                onChange={(e) => setField('status', e.target.value)}>
                {VEHICLE_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[9px] text-rmpg-500 uppercase font-semibold block mb-0.5">Make</label>
              <input className="input-dark w-full text-[11px] min-h-[36px]" value={form.make}
                onChange={(e) => setField('make', e.target.value)} />
            </div>
            <div>
              <label className="text-[9px] text-rmpg-500 uppercase font-semibold block mb-0.5">Model</label>
              <input className="input-dark w-full text-[11px] min-h-[36px]" value={form.model}
                onChange={(e) => setField('model', e.target.value)} />
            </div>
            <div>
              <label className="text-[9px] text-rmpg-500 uppercase font-semibold block mb-0.5">Year</label>
              <input className="input-dark w-full text-[11px] font-mono min-h-[36px]" type="number" value={form.year}
                onChange={(e) => setField('year', e.target.value)} />
            </div>
            <div>
              <label className="text-[9px] text-rmpg-500 uppercase font-semibold block mb-0.5">Color</label>
              <input className="input-dark w-full text-[11px] min-h-[36px]" value={form.color}
                onChange={(e) => setField('color', e.target.value)} />
            </div>
            <div className="col-span-2">
              <label className="text-[9px] text-rmpg-500 uppercase font-semibold block mb-0.5">VIN</label>
              <input className="input-dark w-full text-[11px] font-mono min-h-[36px]" value={form.vin}
                onChange={(e) => setField('vin', e.target.value)} />
            </div>
            <div>
              <label className="text-[9px] text-rmpg-500 uppercase font-semibold block mb-0.5">Plate Number</label>
              <input className="input-dark w-full text-[11px] font-mono min-h-[36px]" value={form.plate_number}
                onChange={(e) => setField('plate_number', e.target.value)} />
            </div>
            <div>
              <label className="text-[9px] text-rmpg-500 uppercase font-semibold block mb-0.5">Plate State</label>
              <input className="input-dark w-full text-[11px] min-h-[36px]" maxLength={2} value={form.plate_state}
                onChange={(e) => setField('plate_state', e.target.value.toUpperCase())} />
            </div>
            <div>
              <label className="text-[9px] text-rmpg-500 uppercase font-semibold block mb-0.5">Current Mileage</label>
              <input className="input-dark w-full text-[11px] font-mono min-h-[36px]" type="number" value={form.current_mileage}
                onChange={(e) => setField('current_mileage', e.target.value)} />
            </div>
            <div>
              <label className="text-[9px] text-rmpg-500 uppercase font-semibold block mb-0.5">Next Service Mileage</label>
              <input className="input-dark w-full text-[11px] font-mono min-h-[36px]" type="number" value={form.next_service_mileage}
                onChange={(e) => setField('next_service_mileage', e.target.value)}
                placeholder="e.g. 50000" />
              {form.current_mileage && form.next_service_mileage && (
                <span className={`text-[8px] mt-0.5 block ${
                  parseInt(form.next_service_mileage) - parseInt(form.current_mileage) <= 0 ? 'text-red-400' :
                  parseInt(form.next_service_mileage) - parseInt(form.current_mileage) <= 500 ? 'text-amber-400' : 'text-green-400'
                }`}>
                  {parseInt(form.next_service_mileage) - parseInt(form.current_mileage)} miles until service
                </span>
              )}
            </div>
            <div>
              <label className="text-[9px] text-rmpg-500 uppercase font-semibold block mb-0.5">Registration Expiry (Date/Time)</label>
              <input className="input-dark w-full text-[11px] font-mono min-h-[36px]" type="datetime-local" step="1" value={form.registration_expiry}
                onChange={(e) => setField('registration_expiry', e.target.value)} />
            </div>
            <div>
              <label className="text-[9px] text-rmpg-500 uppercase font-semibold block mb-0.5">Insurance Expiry (Date/Time)</label>
              <input className="input-dark w-full text-[11px] font-mono min-h-[36px]" type="datetime-local" step="1" value={form.insurance_expiry}
                onChange={(e) => setField('insurance_expiry', e.target.value)} />
            </div>
            <div />
            <div className="col-span-2">
              <label className="text-[9px] text-rmpg-500 uppercase font-semibold block mb-0.5">Equipment (comma-separated)</label>
              <input className="input-dark w-full text-[10px] min-h-[36px]" value={form.equipment_str}
                onChange={(e) => setField('equipment_str', e.target.value)}
                placeholder="e.g. Lightbar, MDT, Radar, Body Camera, Shotgun Rack" />
            </div>
            <div className="col-span-2">
              <label className="text-[9px] text-rmpg-500 uppercase font-semibold block mb-0.5">Notes</label>
              <textarea className="input-dark w-full text-[10px] h-16 resize-none min-h-[36px]" value={form.notes}
                onChange={(e) => setField('notes', e.target.value)} />
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-4 py-2 border-t border-rmpg-700">
          <button type="button" className="toolbar-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="toolbar-btn toolbar-btn-primary print:hidden" onClick={onSave} disabled={saving}>
            {saving ? 'Saving...' : mode === 'new_vehicle' ? 'Create Vehicle' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
