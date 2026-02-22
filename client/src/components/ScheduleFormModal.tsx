import React, { useState } from 'react';
import { Calendar } from 'lucide-react';
import FormModal from './FormModal';

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
  const [officerId, setOfficerId] = useState('');
  const [propertyId, setPropertyId] = useState('');
  const [shiftDate, setShiftDate] = useState('');
  const [startTime, setStartTime] = useState('18:00');
  const [endTime, setEndTime] = useState('06:00');
  const [notes, setNotes] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      officer_id: officerId,
      property_id: propertyId || undefined,
      shift_date: shiftDate,
      start_time: startTime,
      end_time: endTime,
      notes: notes || undefined,
    });
  };

  const handleClose = () => {
    setOfficerId('');
    setPropertyId('');
    setShiftDate('');
    setStartTime('18:00');
    setEndTime('06:00');
    setNotes('');
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
    >
      {/* Officer */}
      <div>
        <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">
          Officer <span className="text-red-400">*</span>
        </label>
        <select
          required
          value={officerId}
          onChange={(e) => setOfficerId(e.target.value)}
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
          value={propertyId}
          onChange={(e) => setPropertyId(e.target.value)}
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
          value={shiftDate}
          onChange={(e) => setShiftDate(e.target.value)}
          className="w-full bg-surface-sunken border border-rmpg-600 text-sm text-white px-3 py-2 focus:outline-none focus:border-brand-500"
        />
      </div>

      {/* Time row */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">
            Start Time <span className="text-red-400">*</span>
          </label>
          <input
            type="time"
            required
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
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
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            className="w-full bg-surface-sunken border border-rmpg-600 text-sm text-white px-3 py-2 focus:outline-none focus:border-brand-500"
          />
        </div>
      </div>

      {/* Notes */}
      <div>
        <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">
          Notes
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Optional shift notes..."
          className="w-full bg-surface-sunken border border-rmpg-600 text-sm text-white px-3 py-2 focus:outline-none focus:border-brand-500 resize-none"
        />
      </div>
    </FormModal>
  );
}
