import React, { useState, useEffect } from 'react';
import { Camera } from 'lucide-react';
import FormModal from '../../../components/FormModal';
import { useFormDirty } from '../../../hooks/useFormDirty';
import type { CameraStatus } from '../../../types';

import RichTextArea from '../../../components/RichTextArea';
export interface BodyCameraFormData {
  officer_id: string;
  camera_id: string;
  make: string;
  model: string;
  firmware_version: string;
  storage_capacity_gb: string;
  status: CameraStatus;
  condition: string;
  assigned_at: string;
  returned_at: string;
  notes: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: BodyCameraFormData) => void;
  isSubmitting: boolean;
  officers: { id: string; name: string }[];
  initialData?: Partial<BodyCameraFormData> & { id?: number };
  mode?: 'create' | 'edit';
}

const STATUSES: { value: CameraStatus; label: string }[] = [
  { value: 'assigned', label: 'Assigned' },
  { value: 'available', label: 'Available' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'retired', label: 'Retired' },
  { value: 'lost', label: 'Lost' },
];

const CONDITIONS = [
  { value: 'new', label: 'New' },
  { value: 'good', label: 'Good' },
  { value: 'fair', label: 'Fair' },
  { value: 'poor', label: 'Poor' },
  { value: 'damaged', label: 'Damaged' },
];

const EMPTY: BodyCameraFormData = {
  officer_id: '',
  camera_id: '',
  make: '',
  model: '',
  firmware_version: '',
  storage_capacity_gb: '32',
  status: 'assigned',
  condition: 'good',
  assigned_at: '',
  returned_at: '',
  notes: '',
};

export default function BodyCameraFormModal({
  isOpen, onClose, onSubmit, isSubmitting, officers, initialData, mode = 'create',
}: Props) {
  const [form, setForm] = useState<BodyCameraFormData>(EMPTY);
  const { isDirty, snapshot } = useFormDirty(form, isOpen);

  useEffect(() => {
    if (isOpen && initialData) {
      const initial = { ...EMPTY, ...initialData, storage_capacity_gb: String(initialData.storage_capacity_gb || '32') };
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
  const set = (key: keyof BodyCameraFormData, val: string) => setForm(p => ({ ...p, [key]: val }));

  return (
    <FormModal
      isOpen={isOpen}
      onClose={handleClose}
      onSubmit={handleSubmit}
      title={mode === 'edit' ? 'Edit Body Camera' : 'Assign Body Camera'}
      icon={Camera}
      submitLabel={mode === 'edit' ? 'Update' : 'Assign Camera'}
      isSubmitting={isSubmitting}
      isDirty={isDirty}
    >
      {/* Assignment */}
      <div className="panel-inset p-3 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="field-label">Officer <span className="text-red-400">*</span></label>
            <select required value={form.officer_id} onChange={e => set('officer_id', e.target.value)} className="select-dark">
              <option value="">Select officer...</option>
              {officers.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
          <div>
            <label className="field-label">Camera ID / Serial <span className="text-red-400">*</span></label>
            <input type="text" required value={form.camera_id} onChange={e => set('camera_id', e.target.value)} placeholder="e.g. BC-001" className="input-dark min-h-[36px]" />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="field-label">Status</label>
            <select value={form.status} onChange={e => set('status', e.target.value)} className="select-dark">
              {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <label className="field-label">Condition</label>
            <select value={form.condition} onChange={e => set('condition', e.target.value)} className="select-dark">
              {CONDITIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Device Details */}
      <div className="flex items-center gap-2 mt-4 mb-3">
        <span className="field-label text-brand-400 whitespace-nowrap">Device Details</span>
        <div className="flex-1 h-px bg-rmpg-700" />
      </div>
      <div className="panel-inset p-3 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="field-label">Make</label>
            <input type="text" value={form.make} onChange={e => set('make', e.target.value)} placeholder="e.g. Axon" className="input-dark min-h-[36px]" />
          </div>
          <div>
            <label className="field-label">Model</label>
            <input type="text" value={form.model} onChange={e => set('model', e.target.value)} placeholder="e.g. Body 4" className="input-dark min-h-[36px]" />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="field-label">Firmware Version</label>
            <input type="text" value={form.firmware_version} onChange={e => set('firmware_version', e.target.value)} placeholder="e.g. v3.2.1" className="input-dark min-h-[36px]" />
          </div>
          <div>
            <label className="field-label">Storage Capacity (GB)</label>
            <input type="number" value={form.storage_capacity_gb} onChange={e => set('storage_capacity_gb', e.target.value)} min={1} className="input-dark min-h-[36px]" />
          </div>
        </div>
      </div>

      {/* Dates */}
      <div className="flex items-center gap-2 mt-4 mb-3">
        <span className="field-label text-brand-400 whitespace-nowrap">Dates</span>
        <div className="flex-1 h-px bg-rmpg-700" />
      </div>
      <div className="panel-inset p-3 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="field-label">Assigned Date</label>
            <input type="date" value={form.assigned_at} onChange={e => set('assigned_at', e.target.value)} className="input-dark min-h-[36px]" />
          </div>
          <div>
            <label className="field-label">Returned Date</label>
            <input
              type="date"
              value={form.returned_at}
              onChange={e => set('returned_at', e.target.value)}
              className="input-dark min-h-[36px]"
              disabled={form.status !== 'available' && form.status !== 'retired'}
            />
          </div>
        </div>
      </div>

      {/* Notes */}
      <div className="flex items-center gap-2 mt-4 mb-3">
        <span className="field-label text-brand-400 whitespace-nowrap">Notes</span>
        <div className="flex-1 h-px bg-rmpg-700" />
      </div>
      <div className="panel-inset p-3">
        <RichTextArea value={form.notes} onChange={e => set('notes', e.target.value)} rows={3} placeholder="Additional notes..." maxLength={3000} className="textarea-dark" />
        <div className="text-[9px] text-rmpg-500 text-right mt-0.5">{form.notes.length}/3000</div>
      </div>
    </FormModal>
  );
}
