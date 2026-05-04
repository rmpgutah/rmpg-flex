// ============================================================
// RMPG Flex — Disciplinary Action Modal
// Create a new disciplinary action record
// ============================================================

import { useState, useEffect } from 'react';
import { X, AlertTriangle } from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';
import { localToday } from '../../../utils/dateUtils';

import RichTextArea from '../../../components/RichTextArea';
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

export default function DisciplinaryActionModal({ onClose, onSaved, action }: DisciplinaryActionModalProps) {
  const [users, setUsers] = useState<UserOption[]>([]);
  const [employeeId, setEmployeeId] = useState(action?.employee_id || '');
  const [actionType, setActionType] = useState(action?.action_type || 'verbal_warning');
  const [severity, setSeverity] = useState(action?.severity || 'minor');
  const [incidentDate, setIncidentDate] = useState(action?.incident_date || localToday());
  const [description, setDescription] = useState(action?.description || '');
  const [correctiveAction, setCorrectiveAction] = useState(action?.corrective_action || '');
  const [followUpDate, setFollowUpDate] = useState(action?.follow_up_date || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    apiFetch<UserOption[]>('/hr/employees').then(setUsers).catch(err => { console.warn('[HR] Employee load failed:', err); setError('Failed to load employee list'); });
  }, []);

  // Escape to close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !saving) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [saving, onClose]);

  const handleSubmit = async () => {
    if (!employeeId || !description.trim()) {
      setError('Employee and description are required.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const payload = {
        employee_id: employeeId,
        action_type: actionType,
        severity,
        incident_date: incidentDate,
        description: description.trim(),
        corrective_action: correctiveAction.trim(),
        follow_up_date: followUpDate || null,
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
          {error && (
            <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-sm px-2 py-1.5">
              {error}
            </div>
          )}

          <div>
            <label className={labelClass}>Employee *</label>
            <select value={employeeId} onChange={e => setEmployeeId(e.target.value)} className={inputClass}>
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
              <select value={actionType} onChange={e => setActionType(e.target.value)} className={inputClass}>
                {ACTION_TYPES.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Severity *</label>
              <select value={severity} onChange={e => setSeverity(e.target.value)} className={inputClass}>
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
                value={incidentDate}
                onChange={e => setIncidentDate(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Follow-Up Date</label>
              <input
                type="date"
                value={followUpDate}
                onChange={e => setFollowUpDate(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>

          <div>
            <label className={labelClass}>Description *</label>
            <RichTextArea
              value={description}
              onChange={e => setDescription(e.target.value)}
              className={`${inputClass} h-20 resize-none`}
              placeholder="Describe the incident or behavior..."
            />
          </div>

          <div>
            <label className={labelClass}>Corrective Action</label>
            <RichTextArea
              value={correctiveAction}
              onChange={e => setCorrectiveAction(e.target.value)}
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
  );
}
