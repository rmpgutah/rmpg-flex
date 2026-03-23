// ============================================================
// RMPG Flex — Disciplinary Form Modal
// Create / edit disciplinary records and commendations
// ============================================================

import { useState, useEffect, useRef, useId } from 'react';
import { X, Loader2, Star, Shield } from 'lucide-react';
import type { DisciplinaryRecord, DisciplinaryType, DisciplinarySeverity } from '../../../types';
import { DISCIPLINARY_TYPE_LABELS } from '../utils/hrConstants';

interface DisciplinaryFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: any) => Promise<void>;
  editRecord?: DisciplinaryRecord | null;
  officers: Array<{ id: number; full_name: string }>;
}

const SEVERITY_OPTIONS: { value: DisciplinarySeverity; label: string }[] = [
  { value: 'minor', label: 'Minor' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'major', label: 'Major' },
  { value: 'critical', label: 'Critical' },
];

const TYPE_OPTIONS: { value: DisciplinaryType; label: string }[] = Object.entries(
  DISCIPLINARY_TYPE_LABELS,
).map(([value, label]) => ({ value: value as DisciplinaryType, label }));

const EMPTY_FORM = {
  officer_id: '',
  type: 'verbal_warning' as DisciplinaryType,
  severity: 'minor' as DisciplinarySeverity,
  incident_date: '',
  description: '',
  action_taken: '',
  follow_up_date: '',
  witness: '',
};

export default function DisciplinaryFormModal({
  isOpen,
  onClose,
  onSubmit,
  editRecord,
  officers,
}: DisciplinaryFormModalProps) {
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [submitting, setSubmitting] = useState(false);
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  const isCommendation = form.type === 'commendation';
  const isEditing = !!editRecord;

  // Reset form when modal opens / editRecord changes
  useEffect(() => {
    if (!isOpen) return;
    if (editRecord) {
      setForm({
        officer_id: String(editRecord.officer_id),
        type: editRecord.type,
        severity: editRecord.severity,
        incident_date: editRecord.incident_date,
        description: editRecord.description,
        action_taken: editRecord.action_taken ?? '',
        follow_up_date: editRecord.follow_up_date ?? '',
        witness: editRecord.witness ?? '',
      });
    } else {
      setForm({ ...EMPTY_FORM });
    }
  }, [isOpen, editRecord]);

  // Escape to close
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, submitting, onClose]);

  if (!isOpen) return null;

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
  ) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await onSubmit({
        ...form,
        officer_id: Number(form.officer_id),
        follow_up_date: form.follow_up_date || null,
        action_taken: form.action_taken || null,
        witness: form.witness || null,
      });
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const accentBorder = isCommendation ? 'border-amber-500/40' : 'border-[#1e3048]';
  const accentHeader = isCommendation ? 'bg-amber-900/20' : 'bg-[#1a2636]';
  const HeaderIcon = isCommendation ? Star : Shield;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={submitting ? undefined : onClose} />

      {/* Dialog */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-sm border ${accentBorder} bg-[#141e2b] shadow-xl`}
      >
        {/* Header */}
        <div className={`flex items-center justify-between px-4 py-3 border-b ${accentBorder} ${accentHeader}`}>
          <div className="flex items-center gap-2">
            <HeaderIcon size={16} className={isCommendation ? 'text-amber-400' : 'text-brand-400'} />
            <h2 id={titleId} className="text-sm font-semibold text-white">
              {isEditing ? 'Edit' : 'New'} {isCommendation ? 'Commendation' : 'Disciplinary Record'}
            </h2>
          </div>
          <button type="button" onClick={onClose} disabled={submitting} className="text-rmpg-400 hover:text-white">
            <X size={16} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Officer */}
            <div className="space-y-1">
              <label className="text-xs text-rmpg-400">Officer *</label>
              <select
                name="officer_id"
                value={form.officer_id}
                onChange={handleChange}
                required
                className="w-full bg-[#0d1520] border border-[#1e3048] rounded-sm px-2 py-1.5 text-sm text-white"
              >
                <option value="">Select officer...</option>
                {officers.map(o => (
                  <option key={o.id} value={o.id}>
                    {o.full_name}
                  </option>
                ))}
              </select>
            </div>

            {/* Type */}
            <div className="space-y-1">
              <label className="text-xs text-rmpg-400">Type *</label>
              <select
                name="type"
                value={form.type}
                onChange={handleChange}
                required
                className="w-full bg-[#0d1520] border border-[#1e3048] rounded-sm px-2 py-1.5 text-sm text-white"
              >
                {TYPE_OPTIONS.map(t => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Severity — hidden for commendations */}
            {!isCommendation && (
              <div className="space-y-1">
                <label className="text-xs text-rmpg-400">Severity *</label>
                <select
                  name="severity"
                  value={form.severity}
                  onChange={handleChange}
                  required
                  className="w-full bg-[#0d1520] border border-[#1e3048] rounded-sm px-2 py-1.5 text-sm text-white"
                >
                  {SEVERITY_OPTIONS.map(s => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Incident date */}
            <div className="space-y-1">
              <label className="text-xs text-rmpg-400">Incident Date *</label>
              <input
                type="date"
                name="incident_date"
                value={form.incident_date}
                onChange={handleChange}
                required
                className="w-full bg-[#0d1520] border border-[#1e3048] rounded-sm px-2 py-1.5 text-sm text-white"
              />
            </div>

            {/* Follow-up date */}
            <div className="space-y-1">
              <label className="text-xs text-rmpg-400">Follow-up Date</label>
              <input
                type="date"
                name="follow_up_date"
                value={form.follow_up_date}
                onChange={handleChange}
                className="w-full bg-[#0d1520] border border-[#1e3048] rounded-sm px-2 py-1.5 text-sm text-white"
              />
            </div>

            {/* Witness */}
            <div className="space-y-1">
              <label className="text-xs text-rmpg-400">Witness</label>
              <input
                type="text"
                name="witness"
                value={form.witness}
                onChange={handleChange}
                placeholder="Witness name"
                className="w-full bg-[#0d1520] border border-[#1e3048] rounded-sm px-2 py-1.5 text-sm text-white placeholder-rmpg-500"
              />
            </div>
          </div>

          {/* Description */}
          <div className="space-y-1">
            <label className="text-xs text-rmpg-400">Description *</label>
            <textarea
              name="description"
              value={form.description}
              onChange={handleChange}
              required
              rows={3}
              className="w-full bg-[#0d1520] border border-[#1e3048] rounded-sm px-2 py-1.5 text-sm text-white placeholder-rmpg-500 resize-none"
              placeholder="Describe the incident or commendation..."
            />
          </div>

          {/* Action taken */}
          <div className="space-y-1">
            <label className="text-xs text-rmpg-400">Action Taken</label>
            <textarea
              name="action_taken"
              value={form.action_taken}
              onChange={handleChange}
              rows={2}
              className="w-full bg-[#0d1520] border border-[#1e3048] rounded-sm px-2 py-1.5 text-sm text-white placeholder-rmpg-500 resize-none"
              placeholder="Corrective action or follow-up steps..."
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2 border-t border-[#1e3048]">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-3 py-1.5 text-xs text-rmpg-400 hover:text-white border border-[#1e3048] rounded-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className={`px-3 py-1.5 text-xs font-medium rounded-sm flex items-center gap-1.5 ${
                isCommendation
                  ? 'bg-amber-600 hover:bg-amber-500 text-white'
                  : 'bg-brand-600 hover:bg-brand-500 text-white'
              } disabled:opacity-50`}
            >
              {submitting && <Loader2 size={12} className="animate-spin" />}
              {isEditing ? 'Update' : 'Create'} {isCommendation ? 'Commendation' : 'Record'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
