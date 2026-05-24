import React from 'react';
import { Calendar } from 'lucide-react';
import FormModal from './FormModal';
import { useFormDraft } from '../hooks/useFormDraft';

interface ScheduleFormData {
  officer_id: string;
  property_id: string;
  shift_date: string;
  start_time: string;
  end_time: string;
  notes: string;
}

const EMPTY_FORM: ScheduleFormData = {
  officer_id: '',
  property_id: '',
  shift_date: '',
  start_time: '18:00',
  end_time: '06:00',
  notes: '',
};

import RichTextArea from './RichTextArea';
interface ScheduleFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: {
    officer_id: string;
    property_id?: string;
    shift_date: string;
    start_time: string;
    end_time: string;
    notes?: string;
  }) => void;
  isSubmitting: boolean;
  officers: { id: string; name: string }[];
  properties: { id: string; name: string }[];
}

export default function ScheduleFormModal({
  isOpen,
  onClose,
  onSubmit,
  isSubmitting,
  officers,
  properties,
}: ScheduleFormModalProps) {
  const {
    form,
    setForm,
    isDirty,
    wasRestored,
    clearDraft,
    snapshot,
  } = useFormDraft<ScheduleFormData>({
    storageKey: 'rmpg_schedule_form',
    defaultValue: EMPTY_FORM,
    isActive: isOpen,
  });

  React.useEffect(() => {
    if (isOpen) {
      setForm(EMPTY_FORM);
      snapshot();
    }
  }, [isOpen, snapshot, setForm]);

  const set = (field: keyof ScheduleFormData, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      officer_id: form.officer_id,
      property_id: form.property_id || undefined,
      shift_date: form.shift_date,
      start_time: form.start_time,
      end_time: form.end_time,
      notes: form.notes || undefined,
    });
  };

  const handleClose = () => {
    clearDraft();
    onClose();
  };

  return (
    <FormModal
      isOpen={isOpen}
      onClose={handleClose}
      onSubmit={handleSubmit}
      title="Add Schedule"
      icon={Calendar}
      submitLabel="Create Schedule"
      isSubmitting={isSubmitting}
      isDirty={isDirty}
      draftRestored={wasRestored}
      onDiscardDraft={clearDraft}
    >
      {/* Officer */}
      <div>
        <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">
          Officer <span className="text-red-400">*</span>
        </label>
        <select
          required
          value={form.officer_id}
          onChange={(e) => set('officer_id', e.target.value)}
          className="w-full bg-surface-sunken border border-rmpg-600 text-sm text-white px-3 py-2 focus:outline-none focus:border-brand-500"
        >
          <option value="">Select officer...</option>
          {officers.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </div>

      {/* Property */}
      <div>
        <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">
          Property
        </label>
        <select
          value={form.property_id}
          onChange={(e) => set('property_id', e.target.value)}
          className="w-full bg-surface-sunken border border-rmpg-600 text-sm text-white px-3 py-2 focus:outline-none focus:border-brand-500"
        >
          <option value="">None (floating)</option>
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      {/* Shift Date */}
      <div>
        <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">
          Shift Date <span className="text-red-400">*</span>
        </label>
        <input
          type="date"
          required
          value={form.shift_date}
          onChange={(e) => set('shift_date', e.target.value)}
          className="w-full bg-surface-sunken border border-rmpg-600 text-sm text-white px-3 py-2 focus:outline-none focus:border-brand-500"
        />
      </div>

      {/* Time row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">
            Start Time <span className="text-red-400">*</span>
          </label>
          <input
            type="time"
            required
            value={form.start_time}
            onChange={(e) => set('start_time', e.target.value)}
            className="w-full bg-surface-sunken border border-rmpg-600 text-sm text-white px-3 py-2 focus:outline-none focus:border-brand-500"
          />
        </div>
        <div>
          <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">
            End Time <span className="text-red-400">*</span>
          </label>
          <input
            type="time"
            required
            value={form.end_time}
            onChange={(e) => set('end_time', e.target.value)}
            className="w-full bg-surface-sunken border border-rmpg-600 text-sm text-white px-3 py-2 focus:outline-none focus:border-brand-500"
          />
        </div>
      </div>

      {/* Notes */}
      <div>
        <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">
          Notes
        </label>
        <RichTextArea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Optional shift notes..."
          maxLength={2000}
          className="w-full bg-surface-sunken border border-rmpg-600 text-sm text-white px-3 py-2 focus:outline-none focus:border-brand-500 resize-none"
        />
        <div className="text-[9px] text-rmpg-500 text-right mt-0.5">{form.notes.length}/2000</div>
      </div>
    </FormModal>
  );
}
