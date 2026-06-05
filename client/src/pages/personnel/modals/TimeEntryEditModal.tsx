import React, { useEffect, useMemo } from 'react';
import { Clock } from 'lucide-react';
import FormModal from '../../../components/FormModal';
import { useFormDraft } from '../../../hooks/useFormDraft';
import type { TimeEntry } from '../../../types';
import { toDatetimeLocalValue, mtDatetimeLocalToUtc } from '../../../utils/dateUtils';

export interface TimeEntryEditData {
  id: string;
  clock_in: string;
  clock_out: string;
  reason: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: TimeEntryEditData) => void;
  isSubmitting: boolean;
  entry: TimeEntry | null;
}

/** Convert a stored (UTC) datetime string to a Mountain-Time datetime-local input value. */
function toLocalInput(dt?: string): string {
  return toDatetimeLocalValue(dt);
}

export default function TimeEntryEditModal({
  isOpen, onClose, onSubmit, isSubmitting, entry,
}: Props) {
  const {
    form,
    setForm,
    isDirty,
    wasRestored,
    clearDraft,
    snapshot,
  } = useFormDraft<{ clockIn: string; clockOut: string; reason: string }>({
    storageKey: 'rmpg_personnel_time_entry_form',
    defaultValue: { clockIn: '', clockOut: '', reason: '' },
    isActive: isOpen,
  });

  useEffect(() => {
    if (isOpen && entry) {
      const initialIn = toLocalInput(entry.clock_in);
      const initialOut = toLocalInput(entry.clock_out);
      // Reason is always re-entered per edit — never carry it over.
      setForm({ clockIn: initialIn, clockOut: initialOut, reason: '' });
      snapshot();
    } else if (isOpen) {
      setForm({ clockIn: '', clockOut: '', reason: '' });
      snapshot();
    }
  }, [isOpen, entry, setForm, snapshot]);

  const calculatedHours = useMemo(() => {
    if (!form.clockIn) return null;
    if (!form.clockOut) return null;
    const start = new Date(form.clockIn).getTime();
    const end = new Date(form.clockOut).getTime();
    if (isNaN(start) || isNaN(end)) return null;
    const hrs = (end - start) / (1000 * 60 * 60);
    return hrs >= 0 ? hrs : null;
  }, [form.clockIn, form.clockOut]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!entry) return;
    // Inputs are Mountain-Time wall-clock; store as UTC (app standard).
    onSubmit({
      id: entry.id,
      clock_in: mtDatetimeLocalToUtc(form.clockIn),
      clock_out: form.clockOut ? mtDatetimeLocalToUtc(form.clockOut) : form.clockOut,
      reason: form.reason.trim(),
    });
  };

  const handleClose = () => { setForm({ clockIn: '', clockOut: '', reason: '' }); onClose(); };

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
      draftRestored={wasRestored}
      onDiscardDraft={clearDraft}
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
          <input id="ff-timeentryeditmodal-0"
            type="datetime-local"
            required
            value={form.clockIn}
            onChange={e => setForm(f => ({ ...f, clockIn: e.target.value }))}
            className="input-dark min-h-[36px]"
          />
        </div>
        <div>
          <label className="field-label">Clock Out</label>
          <input id="ff-timeentryeditmodal-1"
            type="datetime-local"
            value={form.clockOut}
            onChange={e => setForm(f => ({ ...f, clockOut: e.target.value }))}
            className="input-dark min-h-[36px]"
          />
          {!form.clockOut && <p className="text-[9px] text-amber-400 mt-1">Leave blank if still active</p>}
        </div>
      </div>

      {/* Reason — required. Edits move total_hours → payroll, so every change is
          audited (who / old / new / reason) in time_entry_edits. */}
      <div className="panel-inset p-3">
        <label className="field-label">Reason for change <span className="text-red-400">*</span></label>
        <textarea id="ff-timeentryeditmodal-2"
          required
          rows={2}
          value={form.reason}
          onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
          placeholder="e.g. Officer radioed in — forgot to clock out at end of shift"
          className="input-dark min-h-[44px] resize-y"
        />
        <p className="text-[9px] text-rmpg-400 mt-1">Recorded in the entry's audit trail.</p>
      </div>

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
    </FormModal>
  );
}
