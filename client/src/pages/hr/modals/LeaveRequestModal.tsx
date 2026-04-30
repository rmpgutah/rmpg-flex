// ============================================================
// RMPG Flex — Leave Request Modal
// Submit or edit a leave/PTO request
// ============================================================

import { useState, useEffect, useMemo } from 'react';
import { CalendarDays } from 'lucide-react';
import FormModal from '../../../components/FormModal';
import type { LeaveRequest, LeaveType } from '../../../types';

import RichTextArea from '../../../components/RichTextArea';
interface LeaveRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: LeaveFormData) => Promise<void>;
  editRequest?: LeaveRequest | null;
}

export interface LeaveFormData {
  type: LeaveType;
  start_date: string;
  end_date: string;
  hours_requested: number;
  reason: string;
}

const LEAVE_TYPES: { value: LeaveType; label: string }[] = [
  { value: 'vacation', label: 'Vacation' },
  { value: 'sick', label: 'Sick' },
  { value: 'personal', label: 'Personal' },
  { value: 'bereavement', label: 'Bereavement' },
  { value: 'training', label: 'Training' },
  { value: 'unpaid', label: 'Unpaid' },
];

/** Count business days between two date strings (inclusive of both endpoints). */
function countBusinessDays(startStr: string, endStr: string): number {
  if (!startStr || !endStr) return 0;
  const start = new Date(startStr + 'T00:00:00');
  const end = new Date(endStr + 'T00:00:00');
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) return 0;
  let count = 0;
  const cur = new Date(start);
  while (cur <= end) {
    const day = cur.getDay();
    if (day !== 0 && day !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

export default function LeaveRequestModal({
  isOpen,
  onClose,
  onSubmit,
  editRequest,
}: LeaveRequestModalProps) {
  const [type, setType] = useState<LeaveType>('vacation');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [hours, setHours] = useState(0);
  const [hoursManual, setHoursManual] = useState(false);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Populate from editRequest when opening
  useEffect(() => {
    if (!isOpen) return;
    if (editRequest) {
      setType(editRequest.type);
      setStartDate(editRequest.start_date);
      setEndDate(editRequest.end_date);
      setHours(editRequest.hours_requested);
      setHoursManual(false);
      setReason(editRequest.reason || '');
    } else {
      setType('vacation');
      setStartDate('');
      setEndDate('');
      setHours(0);
      setHoursManual(false);
      setReason('');
    }
    setSubmitting(false);
  }, [isOpen, editRequest]);

  // Auto-calculate hours from dates unless user has overridden
  const autoHours = useMemo(() => countBusinessDays(startDate, endDate) * 8, [startDate, endDate]);
  useEffect(() => {
    if (!hoursManual) setHours(autoHours);
  }, [autoHours, hoursManual]);

  const isDirty = useMemo(() => {
    if (editRequest) {
      return (
        type !== editRequest.type ||
        startDate !== editRequest.start_date ||
        endDate !== editRequest.end_date ||
        hours !== editRequest.hours_requested ||
        reason !== (editRequest.reason || '')
      );
    }
    return !!(type !== 'vacation' || startDate || endDate || hours || reason);
  }, [type, startDate, endDate, hours, reason, editRequest]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!startDate || !endDate) return;
    setSubmitting(true);
    try {
      await onSubmit({ type, start_date: startDate, end_date: endDate, hours_requested: hours, reason });
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass =
    'w-full bg-surface-sunken border border-rmpg-700 text-white text-xs px-3 py-2 rounded-sm focus:outline-none focus:border-brand-500 transition-colors';
  const labelClass = 'block text-xs font-medium text-rmpg-300 mb-1';

  return (
    <FormModal
      isOpen={isOpen}
      onClose={onClose}
      onSubmit={handleSubmit}
      title={editRequest ? 'Edit Leave Request' : 'Request Time Off'}
      icon={CalendarDays}
      submitLabel={editRequest ? 'Update Request' : 'Submit Request'}
      isSubmitting={submitting}
      isDirty={isDirty}
      maxWidth="max-w-lg"
    >
      {/* Leave Type */}
      <div>
        <label className={labelClass}>Leave Type</label>
        <select
          value={type}
          onChange={e => setType(e.target.value as LeaveType)}
          className={inputClass}
        >
          {LEAVE_TYPES.map(lt => (
            <option key={lt.value} value={lt.value}>{lt.label}</option>
          ))}
        </select>
      </div>

      {/* Dates */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>Start Date</label>
          <input
            type="date"
            value={startDate}
            onChange={e => setStartDate(e.target.value)}
            required
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>End Date</label>
          <input
            type="date"
            value={endDate}
            onChange={e => setEndDate(e.target.value)}
            min={startDate || undefined}
            required
            className={inputClass}
          />
        </div>
      </div>

      {/* Hours */}
      <div>
        <label className={labelClass}>Hours Requested</label>
        <input
          type="number"
          value={hours}
          onChange={e => {
            setHours(Number(e.target.value));
            setHoursManual(true);
          }}
          min={0}
          step={1}
          className={inputClass}
        />
        {autoHours > 0 && (
          <p className="text-xs text-rmpg-500 mt-1">
            Auto-calculated: {countBusinessDays(startDate, endDate)} business day{countBusinessDays(startDate, endDate) !== 1 ? 's' : ''} x 8 hrs = {autoHours} hrs
            {hoursManual && (
              <button
                type="button"
                onClick={() => { setHoursManual(false); setHours(autoHours); }}
                className="ml-2 text-brand-400 hover:text-brand-300 underline"
              >
                reset
              </button>
            )}
          </p>
        )}
      </div>

      {/* Reason */}
      <div>
        <label className={labelClass}>Reason</label>
        <RichTextArea
          value={reason}
          onChange={e => setReason(e.target.value)}
          rows={3}
          placeholder="Optional — provide context for your request"
          maxLength={2000}
          className={inputClass + ' resize-none'}
        />
        <div className="text-[9px] text-rmpg-500 text-right mt-0.5">{reason.length}/2000</div>
      </div>
    </FormModal>
  );
}
