import React, { useId, useEffect } from 'react';
import { Car, Clock } from 'lucide-react';
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
  isDirty?: boolean;
  draftRestored?: boolean;
  onDiscardDraft?: () => void;
}

export default function VehicleFormModal({ isOpen, mode, form, onChange, onSave, onClose, saving, isDirty, draftRestored, onDiscardDraft }: Props) {
  const titleId = useId();

  // Escape to close (guarded when dirty)
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) {
        if (isDirty) {
          if (window.confirm('You have unsaved changes. Discard them?')) {
            onDiscardDraft?.();
            onClose();
          }
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, saving, onClose, isDirty, onDiscardDraft]);

  if (!isOpen) return null;

  const setField = (field: keyof VehicleFormState, value: string) =>
    onChange({ ...form, [field]: value });

  const guardedClose = () => {
    if (isDirty && !saving) {
      if (window.confirm('You have unsaved changes. Discard them?')) {
        onDiscardDraft?.();
        onClose();
      }
    } else {
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 print:hidden flex items-center justify-center" role="dialog" aria-modal="true" aria-labelledby={titleId} style={{ background: 'rgba(0,0,0,0.6)' }} onClick={saving ? undefined : guardedClose}>
      <div className="panel-beveled w-[560px] max-w-full mx-4 max-h-[80vh] flex flex-col bg-surface-raised" onClick={(e) => e.stopPropagation()}>
        <PanelTitleBar title={mode === 'new_vehicle' ? 'NEW VEHICLE' : 'EDIT VEHICLE'} icon={Car} id={titleId}>
          {isDirty && <span className="text-[8px] text-amber-400 font-bold uppercase tracking-wider mr-2">UNSAVED</span>}
          <button type="button" className="toolbar-btn text-[9px]" onClick={guardedClose}>X</button>
        </PanelTitleBar>
        <div className="flex-1 overflow-y-auto p-4">
          {draftRestored && onDiscardDraft && (
            <div className="flex items-center justify-between px-3 py-2 rounded-sm border border-amber-500/30 mb-3" style={{ background: '#1a1500' }}>
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-amber-400" />
                <span className="text-xs text-amber-400 font-medium">Restored pending draft</span>
              </div>
              <button type="button" onClick={onDiscardDraft} className="text-[10px] text-amber-400 underline hover:text-amber-300">Discard</button>
            </div>
          )}
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
              <input className="input-dark w-full text-[11px] font-mono uppercase min-h-[36px]" value={form.vin}
                onChange={(e) => setField('vin', e.target.value)} maxLength={17} pattern="[A-HJ-NPR-Za-hj-npr-z0-9]{17}" title="17-character VIN (no I, O, or Q)" placeholder="17-character VIN" />
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
                onChange={(e) => setField('notes', e.target.value)} maxLength={3000} />
              <div className="text-[8px] text-rmpg-500 text-right mt-0.5">{form.notes.length}/3000</div>
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-4 py-2 border-t border-rmpg-700">
          <button type="button" className="toolbar-btn" onClick={guardedClose} disabled={saving}>Cancel</button>
          <button type="button" className="toolbar-btn toolbar-btn-primary print:hidden" onClick={onSave} disabled={saving || !form.vehicle_number.trim()}>
            {saving ? 'Saving...' : mode === 'new_vehicle' ? 'Create Vehicle' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
