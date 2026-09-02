import React, { useId, useEffect, useState } from 'react';
import { Wrench, Clock } from 'lucide-react';
import PanelTitleBar from '../../../components/PanelTitleBar';
import DiscardUnsavedDialog from '../../../components/DiscardUnsavedDialog';

export interface MaintenanceFormState {
  type: string;
  description: string;
  mileage_at_service: string;
  cost: string;
  labor_cost: string;
  vendor: string;
  performed_by: string;
  performed_at: string;
  next_due_date: string;
  next_due_mileage: string;
  service_tasks: string;
  notes: string;
}

export const EMPTY_MAINT_FORM: MaintenanceFormState = {
  type: 'oil_change', description: '', mileage_at_service: '', cost: '', labor_cost: '',
  vendor: '', performed_by: '', performed_at: '', next_due_date: '', next_due_mileage: '',
  service_tasks: '', notes: '',
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

  const setField = (field: keyof MaintenanceFormState, value: string) =>
    onChange({ ...form, [field]: value });

  const guardedClose = () => {
    if (isDirty && !saving) setDiscardOpen(true);
    else onClose();
  };

  return (
    <div className="fixed inset-0 z-50 print:hidden flex items-center justify-center bg-black/60" role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={saving ? undefined : guardedClose}>
      <div className="panel-beveled w-[480px] max-w-full mx-4 max-h-[80vh] flex flex-col bg-surface-raised" onClick={(e) => e.stopPropagation()}>
        <PanelTitleBar title={mode === 'edit' ? 'EDIT MAINTENANCE' : 'LOG MAINTENANCE'} icon={Wrench} id={titleId}>
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
              <label htmlFor="ff-maintenanceformmodal-0" className="text-[9px] text-rmpg-500 uppercase font-semibold block mb-0.5">Type</label>
              <select id="ff-maintenanceformmodal-0" className="select-dark w-full text-[11px] min-h-[36px]" value={form.type}
                onChange={(e) => setField('type', e.target.value)}>
                {MAINTENANCE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="ff-maintenanceformmodal-1" className="text-[9px] text-rmpg-500 uppercase font-semibold block mb-0.5">Performed At (Date/Time)</label>
              <input id="ff-maintenanceformmodal-1" className="input-dark w-full text-[11px] font-mono min-h-[36px]" type="datetime-local" step="1" value={form.performed_at}
                onChange={(e) => setField('performed_at', e.target.value)} />
            </div>
            <div className="col-span-2">
              <label htmlFor="ff-maintenanceformmodal-2" className="text-[9px] text-rmpg-500 uppercase font-semibold block mb-0.5">Description *</label>
              <textarea id="ff-maintenanceformmodal-2" className="input-dark w-full text-[10px] h-16 resize-none min-h-[36px]" value={form.description}
                onChange={(e) => setField('description', e.target.value)} maxLength={3000} placeholder="Describe the maintenance work performed..." />
              <div className="text-[8px] text-rmpg-500 text-right mt-0.5">{form.description.length}/3000</div>
            </div>
            <div>
              <label htmlFor="ff-maintenanceformmodal-3" className="text-[9px] text-rmpg-500 uppercase font-semibold block mb-0.5">Mileage at Service</label>
              <input id="ff-maintenanceformmodal-3" className="input-dark w-full text-[11px] font-mono min-h-[36px]" type="number" value={form.mileage_at_service}
                onChange={(e) => setField('mileage_at_service', e.target.value)} />
            </div>
            <div>
              <label htmlFor="ff-maintenanceformmodal-4" className="text-[9px] text-rmpg-500 uppercase font-semibold block mb-0.5">Total Cost ($)</label>
              <input id="ff-maintenanceformmodal-4" className="input-dark w-full text-[11px] font-mono min-h-[36px]" type="number" step="0.01" value={form.cost}
                onChange={(e) => setField('cost', e.target.value)} />
            </div>
            <div>
              <label htmlFor="ff-maintenanceformmodal-8" className="text-[9px] text-rmpg-500 uppercase font-semibold block mb-0.5">Labor Cost ($)</label>
              <input id="ff-maintenanceformmodal-8" className="input-dark w-full text-[11px] font-mono min-h-[36px]" type="number" step="0.01" value={form.labor_cost}
                onChange={(e) => setField('labor_cost', e.target.value)} />
            </div>
            <div>
              <label htmlFor="ff-maintenanceformmodal-5" className="text-[9px] text-rmpg-500 uppercase font-semibold block mb-0.5">Vendor</label>
              <input id="ff-maintenanceformmodal-5" className="input-dark w-full text-[11px] min-h-[36px]" value={form.vendor}
                onChange={(e) => setField('vendor', e.target.value)} />
            </div>
            <div>
              <label htmlFor="ff-maintenanceformmodal-6" className="text-[9px] text-rmpg-500 uppercase font-semibold block mb-0.5">Performed By</label>
              <input id="ff-maintenanceformmodal-6" className="input-dark w-full text-[11px] min-h-[36px]" value={form.performed_by}
                onChange={(e) => setField('performed_by', e.target.value)} />
            </div>
            <div>
              <label htmlFor="ff-maintenanceformmodal-7" className="text-[9px] text-rmpg-500 uppercase font-semibold block mb-0.5">Next Due Date/Time</label>
              <input id="ff-maintenanceformmodal-7" className="input-dark w-full text-[11px] font-mono min-h-[36px]" type="datetime-local" step="1" value={form.next_due_date}
                onChange={(e) => setField('next_due_date', e.target.value)} />
            </div>
            <div>
              <label htmlFor="ff-maintenanceformmodal-9" className="text-[9px] text-rmpg-500 uppercase font-semibold block mb-0.5">Next Due Mileage</label>
              <input id="ff-maintenanceformmodal-9" className="input-dark w-full text-[11px] font-mono min-h-[36px]" type="number" value={form.next_due_mileage}
                onChange={(e) => setField('next_due_mileage', e.target.value)} placeholder="e.g. 96000" />
            </div>
            <div className="col-span-2">
              <label htmlFor="ff-maintenanceformmodal-10" className="text-[9px] text-rmpg-500 uppercase font-semibold block mb-0.5">Service Tasks (comma-separated)</label>
              <input id="ff-maintenanceformmodal-10" className="input-dark w-full text-[11px] min-h-[36px]" value={form.service_tasks}
                onChange={(e) => setField('service_tasks', e.target.value)} placeholder="oil filter, drain plug gasket, cabin filter…" />
            </div>
            <div className="col-span-2">
              <label htmlFor="ff-maintenanceformmodal-11" className="text-[9px] text-rmpg-500 uppercase font-semibold block mb-0.5">Notes</label>
              <textarea id="ff-maintenanceformmodal-11" className="input-dark w-full text-[10px] h-14 resize-none min-h-[36px]" value={form.notes}
                onChange={(e) => setField('notes', e.target.value)} maxLength={2000} placeholder="Warranty info, invoice #, parts detail, follow-ups…" />
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
      <DiscardUnsavedDialog isOpen={discardOpen} onClose={() => setDiscardOpen(false)} onConfirm={confirmDiscard} />
    </div>
  );
}
