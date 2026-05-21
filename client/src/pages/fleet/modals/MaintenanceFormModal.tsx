import React, { useId, useEffect } from 'react';
import { Wrench, Clock } from 'lucide-react';
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
  isDirty?: boolean;
  draftRestored?: boolean;
  onDiscardDraft?: () => void;
}

export default function MaintenanceFormModal({ isOpen, mode = 'create', form, onChange, onSave, onClose, saving, isDirty, draftRestored, onDiscardDraft }: Props) {
  const titleId = useId();

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

  const setField = (field: keyof MaintenanceFormState, value: string) =>
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
      <div className="panel-beveled w-[480px] max-w-full mx-4 max-h-[80vh] flex flex-col bg-surface-raised" onClick={(e) => e.stopPropagation()}>
        <PanelTitleBar title={mode === 'edit' ? 'EDIT MAINTENANCE' : 'LOG MAINTENANCE'} icon={Wrench} id={titleId}>
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
              <label className="text-[9px] text-rmpg-500 uppercase font-semibold block mb-0.5">Type</label>
              <select className="select-dark w-full text-[11px] min-h-[36px]" value={form.type}
                onChange={(e) => setField('type', e.target.value)}>
                {MAINTENANCE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[9px] text-rmpg-500 uppercase font-semibold block mb-0.5">Performed At (Date/Time)</label>
              <input className="input-dark w-full text-[11px] font-mono min-h-[36px]" type="datetime-local" step="1" value={form.performed_at}
                onChange={(e) => setField('performed_at', e.target.value)} />
            </div>
            <div className="col-span-2">
              <label className="text-[9px] text-rmpg-500 uppercase font-semibold block mb-0.5">Description *</label>
              <textarea className="input-dark w-full text-[10px] h-16 resize-none min-h-[36px]" value={form.description}
                onChange={(e) => setField('description', e.target.value)} maxLength={3000} placeholder="Describe the maintenance work performed..." />
              <div className="text-[8px] text-rmpg-500 text-right mt-0.5">{form.description.length}/3000</div>
            </div>
            <div>
              <label className="text-[9px] text-rmpg-500 uppercase font-semibold block mb-0.5">Mileage at Service</label>
              <input className="input-dark w-full text-[11px] font-mono min-h-[36px]" type="number" value={form.mileage_at_service}
                onChange={(e) => setField('mileage_at_service', e.target.value)} />
            </div>
            <div>
              <label className="text-[9px] text-rmpg-500 uppercase font-semibold block mb-0.5">Cost ($)</label>
              <input className="input-dark w-full text-[11px] font-mono min-h-[36px]" type="number" step="0.01" value={form.cost}
                onChange={(e) => setField('cost', e.target.value)} />
            </div>
            <div>
              <label className="text-[9px] text-rmpg-500 uppercase font-semibold block mb-0.5">Vendor</label>
              <input className="input-dark w-full text-[11px] min-h-[36px]" value={form.vendor}
                onChange={(e) => setField('vendor', e.target.value)} />
            </div>
            <div>
              <label className="text-[9px] text-rmpg-500 uppercase font-semibold block mb-0.5">Performed By</label>
              <input className="input-dark w-full text-[11px] min-h-[36px]" value={form.performed_by}
                onChange={(e) => setField('performed_by', e.target.value)} />
            </div>
            <div className="col-span-2">
              <label className="text-[9px] text-rmpg-500 uppercase font-semibold block mb-0.5">Next Due Date/Time</label>
              <input className="input-dark w-full text-[11px] font-mono min-h-[36px]" type="datetime-local" step="1" value={form.next_due_date}
                onChange={(e) => setField('next_due_date', e.target.value)} />
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-4 py-2 border-t border-rmpg-700">
          <button type="button" className="toolbar-btn" onClick={guardedClose} disabled={saving}>Cancel</button>
          <button type="button" className="toolbar-btn toolbar-btn-primary print:hidden" onClick={onSave} disabled={saving || !form.description.trim()}>
            {saving ? 'Saving...' : mode === 'edit' ? 'Update Maintenance' : 'Log Maintenance'}
          </button>
        </div>
      </div>
    </div>
  );
}
