import React, { useState, useEffect, useMemo } from 'react';
import { Clock } from 'lucide-react';
import FormModal from '../../../components/FormModal';
import { useFormDirty } from '../../../hooks/useFormDirty';
import type { TimeEntry } from '../../../types';

export interface TimeEntryEditData {
  id: string;
  clock_in: string;
  clock_out: string;
  reason: string;
  notes: string;
}

const EDIT_REASONS = [
  'Forgot to clock out',
  'Incorrect time recorded',
  'Schedule change',
  'System error',
  'Supervisor correction',
  'Other',
];

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: TimeEntryEditData) => void;
  isSubmitting: boolean;
  entry: TimeEntry | null;
}

/** Convert ISO / DB datetime string to datetime-local input value */
function toLocalInput(dt?: string): string {
  if (!dt) return '';
  // Handle both ISO (2024-01-15T08:00:00.000Z) and DB (2024-01-15 08:00:00) formats
  const d = new Date(dt);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function TimeEntryEditModal({
  isOpen, onClose, onSubmit, isSubmitting, entry,
}: Props) {
  const [clockIn, setClockIn] = useState('');
  const [clockOut, setClockOut] = useState('');
  const [reason, setReason] = useState('');
  const [customReason, setCustomReason] = useState('');
  const [notes, setNotes] = useState('');
  const form = useMemo(() => ({ clockIn, clockOut, reason, notes }), [clockIn, clockOut, reason, notes]);
  const { isDirty, snapshot } = useFormDirty(form, isOpen);

  useEffect(() => {
    if (isOpen && entry) {
      const initialIn = toLocalInput(entry.clock_in);
      const initialOut = toLocalInput(entry.clock_out);
      setClockIn(initialIn);
      setClockOut(initialOut);
      setReason('');
      setCustomReason('');
      setNotes('');
      snapshot({ clockIn: initialIn, clockOut: initialOut, reason: '', notes: '' });
    } else if (isOpen) {
      setClockIn('');
      setClockOut('');
      setReason('');
      setCustomReason('');
      setNotes('');
      snapshot({ clockIn: '', clockOut: '', reason: '', notes: '' });
    }
  }, [isOpen, entry]);

  const calculatedHours = useMemo(() => {
    if (!clockIn) return null;
    if (!clockOut) return null;
    const start = new Date(clockIn).getTime();
    const end = new Date(clockOut).getTime();
    if (isNaN(start) || isNaN(end)) return null;
    const hrs = (end - start) / (1000 * 60 * 60);
    return hrs >= 0 ? hrs : null;
  }, [clockIn, clockOut]);

  const reasonValid = reason !== '' && (reason !== 'Other' || customReason.trim() !== '');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!entry || !reasonValid) return;
    const finalReason = reason === 'Other' ? customReason : reason;
    onSubmit({
      id: entry.id,
      clock_in: clockIn,
      clock_out: clockOut,
      reason: finalReason,
      notes,
    });
  };

  const handleClose = () => { setClockIn(''); setClockOut(''); setReason(''); setCustomReason(''); setNotes(''); onClose(); };

  return (
    <FormModal
      isOpen={isOpen}
      onClose={handleClose}
      onSubmit={handleSubmit}
      title="Edit Time Entry"
      icon={Clock}
      submitLabel="Update Punch"
      isSubmitting={isSubmitting}
      maxWidth="max-w-md"
      isDirty={isDirty}
    >
      {/* Officer info (read-only) */}
      {entry && (
        <div className="panel-beveled p-3 flex items-center justify-between">
          <div>
            <p className="field-label">Officer</p>
            <p className="text-sm text-white font-bold">{entry.officer_name || 'Unknown'}</p>
          </div>
          <div className="text-right">
            <p className="field-label">Entry ID</p>
            <p className="text-[10px] text-rmpg-300 font-mono">{entry.id.toString().slice(0, 8)}</p>
          </div>
        </div>
      )}

      {/* Punch times */}
      <div className="panel-inset p-3 space-y-3">
        <div>
          <label className="field-label">Clock In <span className="text-red-400">*</span></label>
          <input
            type="datetime-local"
            required
            value={clockIn}
            onChange={e => setClockIn(e.target.value)}
            className="input-dark"
          />
        </div>
        <div>
          <label className="field-label">Clock Out</label>
          <input
            type="datetime-local"
            value={clockOut}
            onChange={e => setClockOut(e.target.value)}
            className="input-dark"
          />
          {!clockOut && <p className="text-[9px] text-amber-400 mt-1">Leave blank if still active</p>}
        </div>
      </div>

      {/* Before/After Preview */}
      {entry && (clockIn !== toLocalInput(entry.clock_in) || clockOut !== toLocalInput(entry.clock_out)) && (
        <div className="panel-beveled p-3 border-l-2 border-l-amber-500">
          <p className="field-label mb-1.5">Changes Preview</p>
          <div className="grid grid-cols-2 gap-3 text-[10px]">
            <div>
              <p className="text-rmpg-500 uppercase text-[8px] font-bold">Before</p>
              <p className="text-rmpg-400 font-mono">In: {toLocalInput(entry.clock_in).replace('T', ' ')}</p>
              <p className="text-rmpg-400 font-mono">Out: {entry.clock_out ? toLocalInput(entry.clock_out).replace('T', ' ') : '—'}</p>
            </div>
            <div>
              <p className="text-green-500 uppercase text-[8px] font-bold">After</p>
              <p className="text-green-400 font-mono">In: {clockIn.replace('T', ' ')}</p>
              <p className="text-green-400 font-mono">Out: {clockOut ? clockOut.replace('T', ' ') : '—'}</p>
            </div>
          </div>
        </div>
      )}

      {/* Break minutes (read-only) */}
      {entry && entry.break_minutes > 0 && (
        <div className="flex items-center justify-between text-[10px] text-rmpg-400 px-3">
          <span>Break Time</span>
          <span className="font-mono text-amber-400">{entry.break_minutes} min</span>
        </div>
      )}

      {/* Live hours preview */}
      <div className="panel-beveled p-3 text-center border-t-2 border-t-brand-500">
        <p className="field-label mb-1">Calculated Hours</p>
        <p className={`text-xl font-bold font-mono ${calculatedHours !== null ? 'text-brand-400' : 'text-rmpg-500'}`}>
          {calculatedHours !== null ? calculatedHours.toFixed(2) : '—'}
        </p>
        {calculatedHours !== null && calculatedHours > 24 && (
          <p className="text-[9px] text-amber-400 mt-1">Warning: Entry exceeds 24 hours</p>
        )}
      </div>

      {/* Reason & Notes */}
      <div className="panel-inset p-3 space-y-3">
        <div>
          <label className="field-label">Reason for Edit <span className="text-red-400">*</span></label>
          <select className="select-dark w-full" value={reason} onChange={e => setReason(e.target.value)}>
            <option value="">— Select reason —</option>
            {EDIT_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        {reason === 'Other' && (
          <div>
            <label className="field-label">Specify Reason <span className="text-red-400">*</span></label>
            <input className="input-dark w-full" placeholder="Enter reason..." value={customReason} onChange={e => setCustomReason(e.target.value)} />
          </div>
        )}
        <div>
          <label className="field-label">Notes</label>
          <textarea className="textarea-dark w-full" rows={2} placeholder="Additional notes (optional)..." value={notes} onChange={e => setNotes(e.target.value)} />
        </div>
      </div>

      {/* Validation hint */}
      {!reasonValid && (
        <p className="text-[9px] text-red-400 px-3">A reason is required to submit changes.</p>
      )}
    </FormModal>
  );
}
