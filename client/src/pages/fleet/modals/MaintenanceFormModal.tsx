import React, { useId } from 'react';
import { Wrench } from 'lucide-react';
import PanelTitleBar from '../../../components/PanelTitleBar';

export interface MaintenanceFormState {
  type: string;
  description: string;
  mileage_at_service: string;
  cost: string;
  vendor: string;
  performed_by: string;
  performed_at: string;
  next_due_date: string;
}

export const EMPTY_MAINT_FORM: MaintenanceFormState = {
  type: 'oil_change', description: '', mileage_at_service: '', cost: '',
  vendor: '', performed_by: '', performed_at: '', next_due_date: '',
};

const MAINTENANCE_TYPES = [
  { value: 'oil_change', label: 'Oil Change' },
  { value: 'tire_rotation', label: 'Tire Rotation' },
  { value: 'brake_service', label: 'Brake Service' },
  { value: 'inspection', label: 'Inspection' },
  { value: 'repair', label: 'Repair' },
  { value: 'other', label: 'Other' },
];

interface Props {
  isOpen: boolean;
  mode?: 'create' | 'edit';
  form: MaintenanceFormState;
  onChange: (form: MaintenanceFormState) => void;
  onSave: () => void;
  onClose: () => void;
  saving: boolean;
}

export default function MaintenanceFormModal({ isOpen, mode = 'create', form, onChange, onSave, onClose, saving }: Props) {
  const titleId = useId();
  if (!isOpen) return null;

  const setField = (field: keyof MaintenanceFormState, value: string) =>
    onChange({ ...form, [field]: value });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true" aria-labelledby={titleId} style={{ background: 'rgba(0,0,0,0.6)' }}>
      <div className="panel-beveled w-[480px] max-h-[80vh] flex flex-col" style={{ background: '#1a2636' }}>
        <PanelTitleBar title={mode === 'edit' ? 'EDIT MAINTENANCE' : 'LOG MAINTENANCE'} icon={Wrench} id={titleId}>
          <button className="toolbar-btn text-[9px]" onClick={onClose}>X</button>
        </PanelTitleBar>
        <div className="flex-1 overflow-y-auto p-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[9px] text-gray-500 uppercase font-semibold block mb-0.5">Type</label>
              <select className="select-dark w-full text-[11px]" value={form.type}
                onChange={(e) => setField('type', e.target.value)}>
                {MAINTENANCE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[9px] text-gray-500 uppercase font-semibold block mb-0.5">Performed At (Date/Time)</label>
              <input className="input-dark w-full text-[11px] font-mono" type="datetime-local" step="1" value={form.performed_at}
                onChange={(e) => setField('performed_at', e.target.value)} />
            </div>
            <div className="col-span-2">
              <label className="text-[9px] text-gray-500 uppercase font-semibold block mb-0.5">Description *</label>
              <textarea className="input-dark w-full text-[10px] h-16 resize-none" value={form.description}
                onChange={(e) => setField('description', e.target.value)} />
            </div>
            <div>
              <label className="text-[9px] text-gray-500 uppercase font-semibold block mb-0.5">Mileage at Service</label>
              <input className="input-dark w-full text-[11px] font-mono" type="number" value={form.mileage_at_service}
                onChange={(e) => setField('mileage_at_service', e.target.value)} />
            </div>
            <div>
              <label className="text-[9px] text-gray-500 uppercase font-semibold block mb-0.5">Cost ($)</label>
              <input className="input-dark w-full text-[11px] font-mono" type="number" step="0.01" value={form.cost}
                onChange={(e) => setField('cost', e.target.value)} />
            </div>
            <div>
              <label className="text-[9px] text-gray-500 uppercase font-semibold block mb-0.5">Vendor</label>
              <input className="input-dark w-full text-[11px]" value={form.vendor}
                onChange={(e) => setField('vendor', e.target.value)} />
            </div>
            <div>
              <label className="text-[9px] text-gray-500 uppercase font-semibold block mb-0.5">Performed By</label>
              <input className="input-dark w-full text-[11px]" value={form.performed_by}
                onChange={(e) => setField('performed_by', e.target.value)} />
            </div>
            <div className="col-span-2">
              <label className="text-[9px] text-gray-500 uppercase font-semibold block mb-0.5">Next Due Date/Time</label>
              <input className="input-dark w-full text-[11px] font-mono" type="datetime-local" step="1" value={form.next_due_date}
                onChange={(e) => setField('next_due_date', e.target.value)} />
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-4 py-2 border-t border-rmpg-700">
          <button className="toolbar-btn" onClick={onClose}>Cancel</button>
          <button className="toolbar-btn toolbar-btn-primary" onClick={onSave} disabled={saving}>
            {saving ? 'Saving...' : mode === 'edit' ? 'Update Maintenance' : 'Log Maintenance'}
          </button>
        </div>
      </div>
    </div>
  );
}
