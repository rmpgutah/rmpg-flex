// ============================================================
// RMPG Flex — Disciplinary Action Modal
// Create a new disciplinary action record
// ============================================================

import React, { useState, useEffect } from 'react';
import { X, AlertTriangle, Clock } from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';
import { localToday } from '../../../utils/dateUtils';
import { useFormDraft } from '../../../hooks/useFormDraft';
import UnsavedChangesGuard from '../../../components/UnsavedChangesGuard';

interface UserOption {
  id: string;
  full_name: string;
  badge_number?: string;
}

interface DisciplinaryAction {
  id?: number;
  employee_id: string;
  action_type: string;
  severity: string;
  incident_date: string;
  description: string;
  corrective_action: string;
  follow_up_date: string;
}

interface DisciplinaryActionModalProps {
  onClose: () => void;
  onSaved: () => void;
  action?: DisciplinaryAction | null;
}

const ACTION_TYPES = [
  { value: 'verbal_warning', label: 'Verbal Warning' },
  { value: 'written_warning', label: 'Written Warning' },
  { value: 'suspension', label: 'Suspension' },
  { value: 'demotion', label: 'Demotion' },
  { value: 'termination', label: 'Termination' },
  { value: 'probation', label: 'Probation' },
  { value: 'other', label: 'Other' },
];

const SEVERITY_LEVELS = [
  { value: 'minor', label: 'Minor' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'major', label: 'Major' },
  { value: 'critical', label: 'Critical' },
];

const EMPTY_FORM = {
  employee_id: '',
  action_type: 'verbal_warning' as string,
  severity: 'minor' as string,
  incident_date: localToday(),
  description: '',
  corrective_action: '',
  follow_up_date: '',
};

export default function DisciplinaryActionModal({ onClose, onSaved, action }: DisciplinaryActionModalProps) {
  const [users, setUsers] = useState<UserOption[]>([]);
  const {
    form,
    setForm,
    isDirty,
    wasRestored,
    clearDraft,
    snapshot,
  } = useFormDraft<typeof EMPTY_FORM>({
    storageKey: 'rmpg_hr_disciplinary_action_form',
    defaultValue: EMPTY_FORM,
    isActive: true,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    apiFetch<UserOption[]>('/hr/employees').then(setUsers).catch(err => { console.warn('[HR] Employee load failed:', err); setError('Failed to load employee list'); });
  }, []);

  useEffect(() => {
    if (action) {
      setForm({
        employee_id: action.employee_id || '',
        action_type: action.action_type || 'verbal_warning',
        severity: action.severity || 'minor',
        incident_date: action.incident_date || localToday(),
        description: action.description || '',
        corrective_action: action.corrective_action || '',
        follow_up_date: action.follow_up_date || '',
      });
    }
    snapshot();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Escape to close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) {
        if (isDirty) {
          if (window.confirm('You have unsaved changes. Close anyway?')) onClose();
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [saving, onClose, isDirty]);

  const handleSubmit = async () => {
    if (!form.employee_id || !form.description.trim()) {
      setError('Employee and description are required.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const payload = {
        employee_id: form.employee_id,
        action_type: form.action_type,
        severity: form.severity,
        incident_date: form.incident_date,
        description: form.description.trim(),
        corrective_action: form.corrective_action.trim(),
        follow_up_date: form.follow_up_date || null,
      };
      if (action?.id) {
        await apiFetch(`/hr/disciplinary-actions/${action.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
      } else {
        await apiFetch('/hr/disciplinary-actions', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
      clearDraft();
      onSaved();
    } catch (err: any) {
      setError(err.message || 'Failed to save disciplinary action');
    } finally {
      setSaving(false);
    }
  };

  const inputClass = 'w-full bg-surface-sunken border border-rmpg-700 rounded-sm px-2 py-1.5 text-xs text-white focus:border-brand-500 focus:outline-none';
  const labelClass = 'block text-xs text-rmpg-400 mb-1';

  return (
    <>
      <UnsavedChangesGuard hasUnsavedChanges={isDirty} />
      <div className="fixed inset-0 z-50 print:hidden flex items-center justify-center bg-black/60" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="bg-surface-base border border-rmpg-700 rounded-sm w-full max-w-lg mx-4 max-h-[90vh] overflow-auto" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="px-4 py-2 border-b border-rmpg-700 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-orange-400" />
            <h3 className="text-sm font-semibold text-white">
              {action?.id ? 'Edit Disciplinary Action' : 'New Disciplinary Action'}
            </h3>
          </div>
          <button type="button" onClick={onClose} className="text-rmpg-500 hover:text-white" aria-label="Close" title="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-3">
          {wasRestored && (
            <div className="flex items-center justify-between px-3 py-2 rounded-sm border border-amber-500/30" style={{ background: '#1a1500' }}>
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-amber-400" />
                <span className="text-xs text-amber-400 font-medium">Restored pending draft</span>
              </div>
              <button type="button" onClick={() => { setForm({ ...EMPTY_FORM }); snapshot(); }} className="text-[10px] text-amber-400 underline hover:text-amber-300">
                Discard
              </button>
            </div>
          )}
          {error && (
            <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-sm px-2 py-1.5">
              {error}
            </div>
          )}

          <div>
            <label className={labelClass}>Employee *</label>
            <select value={form.employee_id} onChange={e => setForm(f => ({ ...f, employee_id: e.target.value }))} className={inputClass}>
              <option value="">Select employee...</option>
              {users.map(u => (
                <option key={u.id} value={u.id}>
                  {u.full_name}{u.badge_number ? ` (${u.badge_number})` : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Action Type *</label>
              <select value={form.action_type} onChange={e => setForm(f => ({ ...f, action_type: e.target.value }))} className={inputClass}>
                {ACTION_TYPES.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Severity *</label>
              <select value={form.severity} onChange={e => setForm(f => ({ ...f, severity: e.target.value }))} className={inputClass}>
                {SEVERITY_LEVELS.map(s => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Incident Date *</label>
              <input
                type="date"
                value={form.incident_date}
                onChange={e => setForm(f => ({ ...f, incident_date: e.target.value }))}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Follow-Up Date</label>
              <input
                type="date"
                value={form.follow_up_date}
                onChange={e => setForm(f => ({ ...f, follow_up_date: e.target.value }))}
                className={inputClass}
              />
            </div>
          </div>

          <div>
            <label className={labelClass}>Description *</label>
            <textarea
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              className={`${inputClass} h-20 resize-none`}
              placeholder="Describe the incident or behavior..."
            />
          </div>

          <div>
            <label className={labelClass}>Corrective Action</label>
            <textarea
              value={form.corrective_action}
              onChange={e => setForm(f => ({ ...f, corrective_action: e.target.value }))}
              className={`${inputClass} h-16 resize-none`}
              placeholder="Required corrective measures..."
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-rmpg-700 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-xs text-rmpg-400 hover:text-white">
            Cancel
          </button>
          <button type="button"
            onClick={handleSubmit}
            disabled={saving}
            className="px-3 py-1.5 text-xs bg-brand-500 text-white rounded-sm hover:bg-brand-600 disabled:opacity-50"
          >
            {saving ? 'Saving...' : action?.id ? 'Update Action' : 'Create Action'}
          </button>
        </div>
      </div>
    </div>
    </>
  );
}
