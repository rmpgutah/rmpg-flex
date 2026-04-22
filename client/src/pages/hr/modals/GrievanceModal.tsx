// ============================================================
// RMPG Flex — Grievance Modal
// File a new grievance (employee-facing)
// ============================================================

import React, { useState, useEffect, useCallback } from 'react';
import { X, FileWarning } from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';

interface UserOption {
  id: string;
  full_name: string;
  badge_number?: string;
}

interface Grievance {
  id?: number;
  against_user_id: string | null;
  grievance_type: string;
  subject: string;
  description: string;
  priority: string;
}

interface GrievanceModalProps {
  onClose: () => void;
  onSaved: () => void;
  grievance?: Grievance | null;
}

const GRIEVANCE_TYPES = [
  { value: 'workplace', label: 'Workplace' },
  { value: 'policy', label: 'Policy' },
  { value: 'harassment', label: 'Harassment' },
  { value: 'discrimination', label: 'Discrimination' },
  { value: 'safety', label: 'Safety' },
  { value: 'retaliation', label: 'Retaliation' },
  { value: 'other', label: 'Other' },
];

const PRIORITY_LEVELS = [
  { value: 'low', label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
];

export default function GrievanceModal({ onClose, onSaved, grievance }: GrievanceModalProps) {
  const [users, setUsers] = useState<UserOption[]>([]);
  const [againstUserId, setAgainstUserId] = useState<string>(grievance?.against_user_id || '');
  const [grievanceType, setGrievanceType] = useState(grievance?.grievance_type || 'workplace');
  const [subject, setSubject] = useState(grievance?.subject || '');
  const [description, setDescription] = useState(grievance?.description || '');
  const [priority, setPriority] = useState(grievance?.priority || 'normal');
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
    if (!subject.trim() || !description.trim()) {
      setError('Subject and description are required.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const payload = {
        against_user_id: againstUserId || null,
        grievance_type: grievanceType,
        subject: subject.trim(),
        description: description.trim(),
        priority,
      };
      if (grievance?.id) {
        await apiFetch(`/hr/grievances/${grievance.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
      } else {
        await apiFetch('/hr/grievances', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
      onSaved();
    } catch (err: any) {
      setError(err.message || 'Failed to submit grievance');
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
            <FileWarning className="w-4 h-4 text-orange-400" />
            <h3 className="text-sm font-semibold text-white">
              {grievance?.id ? 'Edit Grievance' : 'File Grievance'}
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
            <label className={labelClass}>Against (Optional)</label>
            <select value={againstUserId} onChange={e => setAgainstUserId(e.target.value)} className={inputClass}>
              <option value="">Not specified</option>
              {users.map(u => (
                <option key={u.id} value={u.id}>
                  {u.full_name}{u.badge_number ? ` (${u.badge_number})` : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Type *</label>
              <select value={grievanceType} onChange={e => setGrievanceType(e.target.value)} className={inputClass}>
                {GRIEVANCE_TYPES.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Priority *</label>
              <select value={priority} onChange={e => setPriority(e.target.value)} className={inputClass}>
                {PRIORITY_LEVELS.map(p => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className={labelClass}>Subject *</label>
            <input
              type="text"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              className={inputClass}
              placeholder="Brief summary of the grievance..."
              autoFocus
              maxLength={200}
            />
          </div>

          <div>
            <label className={labelClass}>Description *</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              className={`${inputClass} h-28 resize-none`}
              placeholder="Detailed description of the grievance, including dates, witnesses, and specifics..."
              maxLength={5000}
            />
            <div className="text-[9px] text-rmpg-500 text-right mt-0.5">{description.length}/5000</div>
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
            {saving ? 'Submitting...' : grievance?.id ? 'Update Grievance' : 'File Grievance'}
          </button>
        </div>
      </div>
    </div>
  );
}
