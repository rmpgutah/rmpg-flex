import React, { useState, useEffect } from 'react';
import { Package } from 'lucide-react';
import FormModal from '../../../components/FormModal';
import { useFormDirty } from '../../../hooks/useFormDirty';
import type { EquipmentType, EquipmentCondition, EquipmentStatus } from '../../../types';

export interface EquipmentFormData {
  officer_id: string;
  equipment_type: EquipmentType;
  make: string;
  model: string;
  serial_number: string;
  asset_tag: string;
  condition: EquipmentCondition;
  status: EquipmentStatus;
  issued_date: string;
  returned_date: string;
  notes: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: EquipmentFormData) => void;
  isSubmitting: boolean;
  officers: { id: string; name: string }[];
  initialData?: Partial<EquipmentFormData> & { id?: string };
  mode?: 'create' | 'edit';
}

const EQUIPMENT_TYPES: { value: EquipmentType; label: string }[] = [
  { value: 'radio', label: 'Radio' },
  { value: 'body_camera', label: 'Body Camera' },
  { value: 'firearm', label: 'Firearm' },
  { value: 'taser', label: 'Taser' },
  { value: 'baton', label: 'Baton' },
  { value: 'handcuffs', label: 'Handcuffs' },
  { value: 'vest', label: 'Vest' },
  { value: 'badge', label: 'Badge' },
  { value: 'id_card', label: 'ID Card' },
  { value: 'keys', label: 'Keys' },
  { value: 'flashlight', label: 'Flashlight' },
  { value: 'vehicle_key', label: 'Vehicle Key' },
  { value: 'laptop', label: 'Laptop' },
  { value: 'phone', label: 'Phone' },
  { value: 'other', label: 'Other' },
];

const CONDITIONS: { value: EquipmentCondition; label: string }[] = [
  { value: 'new', label: 'New' },
  { value: 'good', label: 'Good' },
  { value: 'fair', label: 'Fair' },
  { value: 'poor', label: 'Poor' },
  { value: 'damaged', label: 'Damaged' },
  { value: 'lost', label: 'Lost' },
];

const STATUSES: { value: EquipmentStatus; label: string }[] = [
  { value: 'issued', label: 'Issued' },
  { value: 'returned', label: 'Returned' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'damaged', label: 'Damaged' },
  { value: 'lost', label: 'Lost' },
  { value: 'retired', label: 'Retired' },
];

const EMPTY: EquipmentFormData = {
  officer_id: '',
  equipment_type: 'radio',
  make: '',
  model: '',
  serial_number: '',
  asset_tag: '',
  condition: 'good',
  status: 'issued',
  issued_date: '',
  returned_date: '',
  notes: '',
};

export default function EquipmentFormModal({
  isOpen, onClose, onSubmit, isSubmitting, officers, initialData, mode = 'create',
}: Props) {
  const [form, setForm] = useState<EquipmentFormData>(EMPTY);
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
  const set = (key: keyof EquipmentFormData, val: string) => setForm(p => ({ ...p, [key]: val }));

  return (
    <FormModal
      isOpen={isOpen}
      onClose={handleClose}
      onSubmit={handleSubmit}
      title={mode === 'edit' ? 'Edit Equipment' : 'Issue Equipment'}
      icon={Package}
      submitLabel={mode === 'edit' ? 'Update' : 'Issue Equipment'}
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
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="field-label">Equipment Type <span className="text-red-400">*</span></label>
            <select required value={form.equipment_type} onChange={e => set('equipment_type', e.target.value)} className="select-dark">
              {EQUIPMENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
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
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="field-label">Make</label>
            <input type="text" value={form.make} onChange={e => set('make', e.target.value)} placeholder="e.g. Motorola" className="input-dark min-h-[36px]" />
          </div>
          <div>
            <label className="field-label">Model</label>
            <input type="text" value={form.model} onChange={e => set('model', e.target.value)} placeholder="e.g. APX 8000" className="input-dark min-h-[36px]" />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="field-label">Serial Number</label>
            <input type="text" value={form.serial_number} onChange={e => set('serial_number', e.target.value)} placeholder="Serial #" className="input-dark min-h-[36px]" />
          </div>
          <div>
            <label className="field-label">Asset Tag</label>
            <input type="text" value={form.asset_tag} onChange={e => set('asset_tag', e.target.value)} placeholder="Asset tag #" className="input-dark min-h-[36px]" />
          </div>
        </div>
      </div>

      {/* Condition & Dates */}
      <div className="flex items-center gap-2 mt-4 mb-3">
        <span className="field-label text-brand-400 whitespace-nowrap">Condition & Dates</span>
        <div className="flex-1 h-px bg-rmpg-700" />
      </div>
      <div className="panel-inset p-3 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          <div>
            <label className="field-label">Condition</label>
            <select value={form.condition} onChange={e => set('condition', e.target.value)} className="select-dark">
              {CONDITIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <label className="field-label">Issued Date</label>
            <input type="date" value={form.issued_date} onChange={e => set('issued_date', e.target.value)} className="input-dark min-h-[36px]" />
          </div>
          <div>
            <label className="field-label">Returned Date</label>
            <input
              type="date"
              value={form.returned_date}
              onChange={e => set('returned_date', e.target.value)}
              className="input-dark min-h-[36px]"
              disabled={form.status !== 'returned'}
            />
            {form.status !== 'returned' && (
              <p className="text-[9px] text-rmpg-500 mt-0.5">Only for returned status</p>
            )}
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
