// ============================================================
// RMPG Flex — Location Note Create/Edit Modal
// Operator-authored constraints on how/when a specific
// address, business, or person can be served.
// ============================================================

import { useState, useEffect } from 'react';
import { X, Save, Loader2, AlertTriangle } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const NOTE_TYPES = [
  { value: 'hours',      label: 'Hours / Schedule' },
  { value: 'access',     label: 'Access Restriction' },
  { value: 'security',   label: 'Security Consideration' },
  { value: 'preference', label: 'Service Preference' },
  { value: 'other',      label: 'Other' },
];
const ENTITY_TYPES = [
  { value: 'business', label: 'Business' },
  { value: 'person',   label: 'Person' },
  { value: 'address',  label: 'Address' },
];

interface LocationNote {
  id: number;
  entity_type: string;
  entity_name: string | null;
  address_norm: string | null;
  note_text: string;
  note_type: string;
  days_available: number[] | null;
  hours_start: string | null;
  hours_end: string | null;
  cutoff_time: string | null;
  active: number;
}

interface Props {
  noteId?: number;
  prefill?: {
    entity_type?: 'business' | 'person' | 'address';
    entity_name?: string;
    address?: string;
  };
  onClose: () => void;
  onSaved: () => void;
}

export default function LocationNoteModal({ noteId, prefill, onClose, onSaved }: Props) {
  const isEdit = !!noteId;

  const [entityType, setEntityType] = useState<string>(prefill?.entity_type ?? 'business');
  const [entityName, setEntityName] = useState(prefill?.entity_name ?? '');
  const [address, setAddress] = useState(prefill?.address ?? '');
  const [noteText, setNoteText] = useState('');
  const [noteType, setNoteType] = useState('hours');
  const [daysAvailable, setDaysAvailable] = useState<number[]>([1, 2, 3, 4, 5]); // Mon–Fri default
  const [anyDay, setAnyDay] = useState(true);
  const [hoursStart, setHoursStart] = useState('');
  const [hoursEnd, setHoursEnd] = useState('');
  const [cutoffTime, setCutoffTime] = useState('');

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Load existing note when editing
  useEffect(() => {
    if (!noteId) return;
    setLoading(true);
    apiFetch<LocationNote[]>('/serve-intake/location-notes')
      .then((notes) => {
        const note = notes.find((n) => n.id === noteId);
        if (note) {
          setEntityType(note.entity_type);
          setEntityName(note.entity_name ?? '');
          setAddress(note.address_norm ?? '');
          setNoteText(note.note_text);
          setNoteType(note.note_type);
          if (note.days_available && note.days_available.length > 0) {
            setAnyDay(false);
            setDaysAvailable(note.days_available);
          } else {
            setAnyDay(true);
            setDaysAvailable([0, 1, 2, 3, 4, 5, 6]);
          }
          setHoursStart(note.hours_start ?? '');
          setHoursEnd(note.hours_end ?? '');
          setCutoffTime(note.cutoff_time ?? '');
        }
      })
      .catch(() => setError('Failed to load notation'))
      .finally(() => setLoading(false));
  }, [noteId]);

  function toggleDay(d: number) {
    setDaysAvailable((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort((a, b) => a - b),
    );
  }

  async function handleSave() {
    if (!noteText.trim()) { setError('Note text is required'); return; }
    setError('');
    setSaving(true);
    try {
      const payload = {
        entity_type: entityType,
        entity_name: entityName.trim() || null,
        address: address.trim() || null,
        note_text: noteText.trim(),
        note_type: noteType,
        days_available: anyDay ? null : (daysAvailable.length > 0 ? daysAvailable : null),
        hours_start: hoursStart || null,
        hours_end: hoursEnd || null,
        cutoff_time: cutoffTime || null,
      };
      if (isEdit) {
        await apiFetch(`/serve-intake/location-notes/${noteId}`, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        await apiFetch('/serve-intake/location-notes', { method: 'POST', body: JSON.stringify(payload) });
      }
      onSaved();
    } catch {
      setError('Failed to save notation');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-surface-base border border-border-subtle rounded w-full max-w-lg shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
          <h3 className="text-[13px] font-semibold text-brand-200 tracking-wide">
            {isEdit ? 'EDIT SERVICE NOTATION' : 'NEW SERVICE NOTATION'}
          </h3>
          <button onClick={onClose} className="text-brand-500 hover:text-brand-200">
            <X size={14} />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={20} className="animate-spin text-brand-400" />
          </div>
        ) : (
          <div className="p-4 space-y-4">
            {/* Match criteria */}
            <div>
              <label className="block text-[10px] text-brand-400 font-semibold uppercase tracking-wide mb-2">
                Match Criteria
              </label>
              <div className="flex gap-2 mb-2">
                {ENTITY_TYPES.map((t) => (
                  <button
                    key={t.value}
                    onClick={() => setEntityType(t.value)}
                    className={`flex-1 py-1 text-[11px] border rounded transition-colors ${
                      entityType === t.value
                        ? 'bg-blue-900/40 border-blue-500 text-blue-300'
                        : 'bg-surface-raised border-border-subtle text-brand-400 hover:text-brand-200'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              {entityType !== 'address' && (
                <input
                  type="text"
                  value={entityName}
                  onChange={(e) => setEntityName(e.target.value)}
                  placeholder={entityType === 'business' ? 'Business name (e.g. ACME Corp.)' : 'Person full name'}
                  className="w-full px-2 py-1.5 text-[11px] bg-surface-raised border border-border-subtle rounded text-brand-200 placeholder:text-brand-600 mb-2"
                />
              )}
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Street address (optional secondary match)"
                className="w-full px-2 py-1.5 text-[11px] bg-surface-raised border border-border-subtle rounded text-brand-200 placeholder:text-brand-600"
              />
            </div>

            {/* Note type */}
            <div>
              <label className="block text-[10px] text-brand-400 font-semibold uppercase tracking-wide mb-1">
                Note Type
              </label>
              <select
                value={noteType}
                onChange={(e) => setNoteType(e.target.value)}
                className="w-full px-2 py-1.5 text-[11px] bg-surface-raised border border-border-subtle rounded text-brand-200"
              >
                {NOTE_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>

            {/* Note text */}
            <div>
              <label className="block text-[10px] text-brand-400 font-semibold uppercase tracking-wide mb-1">
                Notation (shown verbatim in PSO briefings)
              </label>
              <textarea
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                rows={3}
                placeholder="e.g. Closed weekends, M-F 08:00–17:00, stops accepting service at 15:30. Call ahead required."
                className="w-full px-2 py-1.5 text-[11px] bg-surface-raised border border-border-subtle rounded text-brand-200 placeholder:text-brand-600 resize-none"
              />
            </div>

            {/* Structured scheduling constraints */}
            <div className="border border-border-subtle rounded p-3 space-y-3">
              <label className="block text-[10px] text-brand-400 font-semibold uppercase tracking-wide">
                Structured Constraints (shapes attempt schedule automatically)
              </label>

              {/* Days available */}
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] text-brand-400">Days available</span>
                  <label className="flex items-center gap-1 text-[10px] text-brand-400 cursor-pointer ml-auto">
                    <input
                      type="checkbox"
                      checked={anyDay}
                      onChange={(e) => {
                        setAnyDay(e.target.checked);
                        if (e.target.checked) setDaysAvailable([0, 1, 2, 3, 4, 5, 6]);
                      }}
                      className="w-3 h-3"
                    />
                    Any day
                  </label>
                </div>
                {!anyDay && (
                  <div className="flex gap-1">
                    {DAY_LABELS.map((label, idx) => (
                      <button
                        key={idx}
                        onClick={() => toggleDay(idx)}
                        className={`flex-1 py-1 text-[10px] border rounded transition-colors ${
                          daysAvailable.includes(idx)
                            ? 'bg-blue-900/40 border-blue-500 text-blue-300'
                            : 'bg-surface-raised border-border-subtle text-brand-500 hover:text-brand-300'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Hours */}
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-[9px] text-brand-500 mb-1">Opens (HH:MM)</label>
                  <input
                    type="time"
                    value={hoursStart}
                    onChange={(e) => setHoursStart(e.target.value)}
                    className="w-full px-2 py-1 text-[11px] bg-surface-raised border border-border-subtle rounded text-brand-200"
                  />
                </div>
                <div>
                  <label className="block text-[9px] text-brand-500 mb-1">Closes (HH:MM)</label>
                  <input
                    type="time"
                    value={hoursEnd}
                    onChange={(e) => setHoursEnd(e.target.value)}
                    className="w-full px-2 py-1 text-[11px] bg-surface-raised border border-border-subtle rounded text-brand-200"
                  />
                </div>
                <div>
                  <label className="block text-[9px] text-brand-500 mb-1">Cutoff (HH:MM)</label>
                  <input
                    type="time"
                    value={cutoffTime}
                    onChange={(e) => setCutoffTime(e.target.value)}
                    className="w-full px-2 py-1 text-[11px] bg-surface-raised border border-border-subtle rounded text-brand-200"
                  />
                </div>
              </div>
              <p className="text-[9px] text-brand-600">
                Cutoff = last time they accept service (e.g. 15:30 for a business that closes at 17:00).
                Leave blank if not applicable.
              </p>
            </div>

            {error && (
              <div className="flex items-center gap-2 text-[11px] text-red-400 bg-red-900/20 border border-red-800 rounded px-3 py-2">
                <AlertTriangle size={12} /> {error}
              </div>
            )}

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={onClose}
                className="px-3 py-1.5 text-[11px] border border-border-subtle rounded text-brand-400 hover:text-brand-200 hover:border-border-muted"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-1.5 px-4 py-1.5 text-[11px] bg-blue-700 hover:bg-blue-600 border border-blue-500 rounded text-white font-semibold disabled:opacity-60"
              >
                {saving ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
                {isEdit ? 'Update Notation' : 'Save Notation'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
