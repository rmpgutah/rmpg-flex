import React, { useState, useEffect } from 'react';
import { GraduationCap } from 'lucide-react';
import FormModal from '../../../components/FormModal';
import { useFormDirty } from '../../../hooks/useFormDirty';
import type { TrainingCategory } from '../../../types';

export interface TrainingFormData {
  officer_id: string;
  course_name: string;
  category: TrainingCategory;
  provider: string;
  completed_date: string;
  expiry_date: string;
  score: string;
  hours: string;
  certificate_number: string;
  status: string;
  notes: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: TrainingFormData) => void;
  isSubmitting: boolean;
  officers: { id: string; name: string }[];
  initialData?: Partial<TrainingFormData> & { id?: string };
  mode?: 'create' | 'edit';
}

const CATEGORIES: { value: TrainingCategory; label: string }[] = [
  { value: 'firearms', label: 'Firearms' },
  { value: 'defensive_tactics', label: 'Defensive Tactics' },
  { value: 'first_aid', label: 'First Aid / CPR' },
  { value: 'legal', label: 'Legal' },
  { value: 'communication', label: 'Communication' },
  { value: 'driving', label: 'Driving' },
  { value: 'technology', label: 'Technology' },
  { value: 'leadership', label: 'Leadership' },
  { value: 'compliance', label: 'Compliance' },
  { value: 'other', label: 'Other' },
];

const STATUSES = [
  { value: 'completed', label: 'Completed' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'expired', label: 'Expired' },
];

const EMPTY: TrainingFormData = {
  officer_id: '', course_name: '', category: 'other', provider: '',
  completed_date: '', expiry_date: '', score: '', hours: '',
  certificate_number: '', status: 'scheduled', notes: '',
};

export default function TrainingFormModal({
  isOpen, onClose, onSubmit, isSubmitting, officers, initialData, mode = 'create',
}: Props) {
  const [form, setForm] = useState<TrainingFormData>(EMPTY);
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
  const set = (key: keyof TrainingFormData, val: string) => setForm(p => ({ ...p, [key]: val }));

  return (
    <FormModal
      isOpen={isOpen}
      onClose={handleClose}
      onSubmit={handleSubmit}
      title={mode === 'edit' ? 'Edit Training Record' : 'Add Training Record'}
      icon={GraduationCap}
      submitLabel={mode === 'edit' ? 'Update' : 'Add Training'}
      isSubmitting={isSubmitting}
      isDirty={isDirty}
    >
      {/* Officer & Course */}
      <div className="panel-inset p-3 space-y-3">
        <div>
          <label className="field-label">Officer <span className="text-red-400">*</span></label>
          <select required value={form.officer_id} onChange={e => set('officer_id', e.target.value)} className="select-dark" disabled={mode === 'edit'}>
            <option value="">Select officer...</option>
            {officers.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </div>
        <div>
          <label className="field-label">Course Name <span className="text-red-400">*</span></label>
          <input type="text" required value={form.course_name} onChange={e => set('course_name', e.target.value)} placeholder="e.g. Firearms Qualification" className="input-dark min-h-[36px]" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="field-label">Category</label>
            <select value={form.category} onChange={e => set('category', e.target.value)} className="select-dark">
              {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
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

      {/* Details */}
      <div className="flex items-center gap-2 mt-4 mb-3">
        <span className="field-label text-brand-400 whitespace-nowrap">Details</span>
        <div className="flex-1 h-px bg-rmpg-700" />
      </div>
      <div className="panel-inset p-3 space-y-3">
        <div>
          <label className="field-label">Provider</label>
          <input type="text" value={form.provider} onChange={e => set('provider', e.target.value)} placeholder="Training provider or institution" className="input-dark min-h-[36px]" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="field-label">Completed Date</label>
            <input type="date" value={form.completed_date} onChange={e => set('completed_date', e.target.value)} className="input-dark min-h-[36px]" />
          </div>
          <div>
            <label className="field-label">Expiry Date</label>
            <input type="date" value={form.expiry_date} onChange={e => set('expiry_date', e.target.value)} className="input-dark min-h-[36px]" />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          <div>
            <label className="field-label">Hours</label>
            <input type="number" step="0.5" min="0" value={form.hours} onChange={e => set('hours', e.target.value)} placeholder="0" className="input-dark min-h-[36px]" />
          </div>
          <div>
            <label className="field-label">Score (%)</label>
            <input type="number" min="0" max="100" value={form.score} onChange={e => set('score', e.target.value)} placeholder="Optional" className="input-dark min-h-[36px]" />
          </div>
          <div>
            <label className="field-label">Certificate #</label>
            <input type="text" value={form.certificate_number} onChange={e => set('certificate_number', e.target.value)} placeholder="Cert number" className="input-dark min-h-[36px]" />
          </div>
        </div>
      </div>

      {/* Notes */}
      <div className="flex items-center gap-2 mt-4 mb-3">
        <span className="field-label text-brand-400 whitespace-nowrap">Notes</span>
        <div className="flex-1 h-px bg-rmpg-700" />
      </div>
      <div className="panel-inset p-3">
        <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={3} placeholder="Additional notes..." className="textarea-dark" />
      </div>
    </FormModal>
  );
}
