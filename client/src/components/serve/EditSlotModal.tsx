import { useEffect, useState } from 'react';
import { CalendarClock } from 'lucide-react';
import FormModal from '../FormModal';
import type { ScheduleSlot } from '../../utils/schedulerView';

interface OfficerOption {
  id: number;
  name: string;
}

interface EditSlotModalProps {
  visible: boolean;
  slot: ScheduleSlot;
  officers: OfficerOption[];
  onSave: (slot: ScheduleSlot) => Promise<void>;
  onCancel: () => void;
  onClose: () => void;
}

const NOTIFY_OPTIONS = [
  { value: 900, label: '15 mins' },
  { value: 1800, label: '30 mins' },
  { value: 3600, label: '1 hour' },
  { value: 7200, label: '2 hours' },
  { value: 14400, label: '4 hours' },
  { value: 21600, label: '6 hours' },
];

const FIELD_LABEL = 'text-[9px] text-fg-muted uppercase font-mono block mb-0.5';
const FIELD_INPUT = 'w-full bg-surface-sunken border border-border-subtle rounded-sm px-2 py-1 text-xs text-rmpg-100 placeholder-rmpg-700 focus:outline-none focus:border-brand-500';

// Rewritten as native inputs against the app's own FormModal — the previous
// version imported `antd`/`@ant-design/icons`, neither of which was ever
// installed (only type-stubbed in src/antd.d.ts so tsc stayed quiet); the
// moment this component was actually rendered, Vite would fail to resolve
// the import at runtime. This version has no such dependency.
export default function EditSlotModal({ visible, slot, officers, onSave, onCancel, onClose }: EditSlotModalProps) {
  const [scheduledDate, setScheduledDate] = useState('');
  const [windowStart, setWindowStart] = useState('');
  const [windowEnd, setWindowEnd] = useState('');
  const [officerId, setOfficerId] = useState<string>('');
  const [windowLabel, setWindowLabel] = useState('');
  const [notifyBeforeSecs, setNotifyBeforeSecs] = useState(1800);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible || !slot) return;
    setScheduledDate(slot.scheduled_date ?? '');
    setWindowStart(slot.window_start ?? '');
    setWindowEnd(slot.window_end ?? '');
    setOfficerId(slot.officer_id != null ? String(slot.officer_id) : '');
    setWindowLabel(slot.window_label ?? '');
    setNotifyBeforeSecs(slot.notify_before_secs ?? 1800);
    setError(null);
  }, [visible, slot]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!scheduledDate || !windowStart || !windowEnd || !officerId) {
      setError('Date, window, and officer are required.');
      return;
    }
    if (windowEnd <= windowStart) {
      setError('Window end must be after window start.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave({
        ...slot,
        scheduled_date: scheduledDate,
        window_start: windowStart,
        window_end: windowEnd,
        officer_id: Number(officerId),
        window_label: windowLabel || null,
        notify_before_secs: notifyBeforeSecs,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save — check for scheduling conflicts.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormModal
      isOpen={visible}
      onClose={onCancel}
      onSubmit={handleSubmit}
      title={`Edit Attempt Slot #${slot.attempt}`}
      icon={CalendarClock}
      submitLabel="Save"
      isSubmitting={saving}
      maxWidth="max-w-md"
    >
      {error && (
        <div className="px-2 py-1.5 text-[11px] text-red-300 bg-red-950/40 border border-red-800/40 rounded-sm">
          {error}
        </div>
      )}

      <div>
        <label htmlFor="edit-slot-date" className={FIELD_LABEL}>Scheduled Date</label>
        <input
          id="edit-slot-date"
          type="date"
          value={scheduledDate}
          onChange={(e) => setScheduledDate(e.target.value)}
          className={FIELD_INPUT}
          required
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label htmlFor="edit-slot-window-start" className={FIELD_LABEL}>Window Start</label>
          <input
            id="edit-slot-window-start"
            type="time"
            value={windowStart}
            onChange={(e) => setWindowStart(e.target.value)}
            className={FIELD_INPUT}
            required
          />
        </div>
        <div>
          <label htmlFor="edit-slot-window-end" className={FIELD_LABEL}>Window End</label>
          <input
            id="edit-slot-window-end"
            type="time"
            value={windowEnd}
            onChange={(e) => setWindowEnd(e.target.value)}
            className={FIELD_INPUT}
            required
          />
        </div>
      </div>

      <div>
        <label htmlFor="edit-slot-officer" className={FIELD_LABEL}>Assigned Officer</label>
        <select
          id="edit-slot-officer"
          value={officerId}
          onChange={(e) => setOfficerId(e.target.value)}
          className={FIELD_INPUT}
          required
        >
          <option value="" className="bg-surface-raised text-rmpg-100">Select an officer</option>
          {officers.map((o) => (
            <option key={o.id} value={o.id} className="bg-surface-raised text-rmpg-100">{o.name}</option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="edit-slot-label" className={FIELD_LABEL}>Focus / Label</label>
        <input
          id="edit-slot-label"
          type="text"
          value={windowLabel}
          onChange={(e) => setWindowLabel(e.target.value)}
          placeholder="e.g. Evening — High Residential Hit Rate"
          className={FIELD_INPUT}
        />
      </div>

      <div>
        <label htmlFor="edit-slot-notify" className={FIELD_LABEL}>Notify Before Window</label>
        <select
          id="edit-slot-notify"
          value={notifyBeforeSecs}
          onChange={(e) => setNotifyBeforeSecs(Number(e.target.value))}
          className={FIELD_INPUT}
        >
          {NOTIFY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value} className="bg-surface-raised text-rmpg-100">{opt.label}</option>
          ))}
        </select>
      </div>
    </FormModal>
  );
}
