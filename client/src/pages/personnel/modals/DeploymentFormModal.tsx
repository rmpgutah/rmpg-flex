import React, { useState, useEffect } from 'react';
import { MapPinned } from 'lucide-react';
import FormModal from '../../../components/FormModal';
import { useFormDirty } from '../../../hooks/useFormDirty';

export interface DeploymentFormData {
  officer_id: string;
  property_id: string;
  position: string;
  start_date: string;
  end_date: string;
  status: string;
  hours_per_week: string;
  notes: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: DeploymentFormData) => void;
  isSubmitting: boolean;
  officers: { id: string; name: string }[];
  properties: { id: string; name: string }[];
  initialData?: Partial<DeploymentFormData> & { id?: string };
  mode?: 'create' | 'edit';
}

const POSITIONS = ['Patrol', 'Access Control', 'Concierge', 'Surveillance', 'Supervisor', 'Response', 'Other'];
const STATUSES = [
  { value: 'active', label: 'Active' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

const EMPTY: DeploymentFormData = {
  officer_id: '', property_id: '', position: 'Patrol', start_date: '',
  end_date: '', status: 'active', hours_per_week: '', notes: '',
};

export default function DeploymentFormModal({
  isOpen, onClose, onSubmit, isSubmitting, officers, properties, initialData, mode = 'create',
}: Props) {
  const [form, setForm] = useState<DeploymentFormData>(EMPTY);
  const { isDirty, snapshot } = useFormDirty(form, isOpen);

  useEffect(() => {
    if (isOpen && initialData) {
      const initial = { ...EMPTY, ...initialData };
      setForm(initial);
      snapshot(initial);
    } else if (isOpen) {
      setForm(EMPTY);
      snapshot(EMPTY);
    }
  }, [isOpen, initialData]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(form);
  };

  const handleClose = () => { setForm(EMPTY); onClose(); };
  const set = (key: keyof DeploymentFormData, val: string) => setForm(p => ({ ...p, [key]: val }));

  return (
    <FormModal
      isOpen={isOpen}
      onClose={handleClose}
      onSubmit={handleSubmit}
      title={mode === 'edit' ? 'Edit Deployment' : 'New Deployment'}
      icon={MapPinned}
      submitLabel={mode === 'edit' ? 'Update' : 'Create Deployment'}
      isSubmitting={isSubmitting}
      isDirty={isDirty}
    >
      {/* Assignment */}
      <div className="panel-inset p-3 space-y-3">
        <div>
          <label className="field-label">Officer <span className="text-red-400">*</span></label>
          <select required value={form.officer_id} onChange={e => set('officer_id', e.target.value)} className="select-dark" disabled={mode === 'edit'}>
            <option value="">Select officer...</option>
            {officers.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </div>
        <div>
          <label className="field-label">Property <span className="text-red-400">*</span></label>
          <select required value={form.property_id} onChange={e => set('property_id', e.target.value)} className="select-dark">
            <option value="">Select property...</option>
            {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="field-label">Position</label>
            <select value={form.position} onChange={e => set('position', e.target.value)} className="select-dark">
              {POSITIONS.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label className="field-label">Status</label>
            <select value={form.status} onChange={e => set('status', e.target.value)} className="select-dark">
              {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Schedule */}
      <div className="flex items-center gap-2 mt-4 mb-3">
        <span className="field-label text-brand-400 whitespace-nowrap">Schedule</span>
        <div className="flex-1 h-px bg-rmpg-700" />
      </div>
      <div className="panel-inset p-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          <div>
            <label className="field-label">Start Date <span className="text-red-400">*</span></label>
            <input type="date" required value={form.start_date} onChange={e => set('start_date', e.target.value)} className="input-dark min-h-[36px]" />
          </div>
          <div>
            <label className="field-label">End Date</label>
            <input type="date" value={form.end_date} onChange={e => set('end_date', e.target.value)} className="input-dark min-h-[36px]" />
          </div>
          <div>
            <label className="field-label">Hours / Week</label>
            <input type="number" min="0" max="168" value={form.hours_per_week} onChange={e => set('hours_per_week', e.target.value)} placeholder="40" className="input-dark min-h-[36px]" />
          </div>
        </div>
      </div>

      {/* Notes */}
      <div className="flex items-center gap-2 mt-4 mb-3">
        <span className="field-label text-brand-400 whitespace-nowrap">Notes</span>
        <div className="flex-1 h-px bg-rmpg-700" />
      </div>
      <div className="panel-inset p-3">
        <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={3} placeholder="Deployment notes..." className="textarea-dark" maxLength={3000} />
        <div className="text-[9px] text-rmpg-500 text-right mt-0.5">{form.notes.length}/3000</div>
      </div>
    </FormModal>
  );
}
