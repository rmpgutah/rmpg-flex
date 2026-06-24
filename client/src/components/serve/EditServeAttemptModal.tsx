// ============================================================
// EditServeAttemptModal — focused edit form for a logged attempt
// ============================================================
// Operator corrections to a previously-logged attempt: timestamp typos,
// wrong attempt_type, wrong disposition_code picked, follow-up notes.
// Photo/signature/officer stay immutable — those are evidence.
//
// Distinct from ServeAttemptModal (the new-attempt wizard) on purpose:
// editing is a small, fast form, not a guided GPS/signature/photo flow.
// Wires to PUT /api/process-server/:queueId/attempt/:attemptId.
// ============================================================

import React, { useEffect, useMemo, useState } from 'react';
import { X, Save, Loader2, AlertTriangle, Trash2 } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import type { ServeAttempt } from '../../types';
import {
  PSO_CATEGORIES,
  codesInCategory,
  lookupPsoCode,
  type PsoCategory,
} from '../../constants/processServiceCodes';

interface EditServeAttemptModalProps {
  isOpen: boolean;
  onClose: () => void;
  queueId: number;
  attempt: ServeAttempt;
  /** Called after a successful save so the parent can refetch. */
  onSaved: () => void;
  /** Called when the user confirms deletion of this attempt. Parent handles the API call + toast. */
  onDelete?: (queueId: number, attempt: ServeAttempt) => void;
}

type AttemptTypeOption = ServeAttempt['attempt_type'];
const ATTEMPT_TYPES: AttemptTypeOption[] = ['personal', 'substitute', 'posting', 'failed'];

// Convert ISO timestamp → datetime-local input value (no TZ shifting:
// browser shows it as the wall-clock time the row was stamped with).
function toDateTimeLocal(iso: string | null): string {
  if (!iso) return '';
  // Accept both "2026-06-22T10:15:00Z" and "2026-06-22 10:15:00"
  const m = iso.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::(\d{2}))?/);
  if (!m) return '';
  return `${m[1]}T${m[2]}${m[3] ? `:${m[3]}` : ''}`;
}

// Reverse: datetime-local → ISO-ish string the server happily stores.
// We preserve local-wall-clock (no Z) to match how attempts are logged.
function fromDateTimeLocal(local: string): string | null {
  if (!local) return null;
  // Normalize to "YYYY-MM-DD HH:MM:SS"
  const m = local.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::(\d{2}))?/);
  if (!m) return local;
  return `${m[1]} ${m[2]}:${m[3] ?? '00'}`;
}

export default function EditServeAttemptModal({
  isOpen,
  onClose,
  queueId,
  attempt,
  onSaved,
  onDelete,
}: EditServeAttemptModalProps) {
  const [attemptAt, setAttemptAt] = useState<string>('');
  const [attemptType, setAttemptType] = useState<AttemptTypeOption>('failed');
  const [dispositionCode, setDispositionCode] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form whenever the modal opens against a (possibly different) attempt.
  useEffect(() => {
    if (!isOpen) return;
    setAttemptAt(toDateTimeLocal(attempt.attempt_at));
    setAttemptType(attempt.attempt_type || 'failed');
    setDispositionCode(attempt.disposition_code || '');
    setNotes(attempt.notes || '');
    setError(null);
  }, [isOpen, attempt]);

  // Group codes by category for the picker.
  const codesByCategory = useMemo(() => {
    const out: Record<string, ReturnType<typeof codesInCategory>> = {};
    for (const cat of PSO_CATEGORIES) {
      out[cat.code] = codesInCategory(cat.code);
    }
    return out;
  }, []);

  const resolvedCode = dispositionCode ? lookupPsoCode(dispositionCode) : null;

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        attempt_at: fromDateTimeLocal(attemptAt),
        attempt_type: attemptType,
        notes: notes.trim() || null,
      };
      // Send disposition_code when set — server derives `result` from it.
      // Send the legacy `result` only when no disposition_code is picked, so
      // the server's whitelist path keeps the existing result on a notes-only
      // edit (we omit it from the body entirely).
      if (dispositionCode) body.disposition_code = dispositionCode;

      await apiFetch(`/process-server/${queueId}/attempt/${attempt.id}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-attempt-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="panel-beveled w-full max-w-lg rounded-[2px] bg-surface-base p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        style={{ borderColor: 'var(--border-default)' }}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 id="edit-attempt-title" className="text-sm font-bold text-amber-400 uppercase tracking-wider">
            Edit Attempt #{attempt.attempt_number}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-rmpg-400 hover:text-rmpg-200 p-1"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3 text-xs">
          {/* Attempt timestamp */}
          <div>
            <label className="text-[10px] text-amber-400 block mb-0.5" htmlFor="edit-attempt-at">Attempted At</label>
            <input
              id="edit-attempt-at"
              type="datetime-local"
              step="60"
              className="input-dark text-xs w-full"
              value={attemptAt}
              onChange={(e) => setAttemptAt(e.target.value)}
            />
          </div>

          {/* Attempt type */}
          <div>
            <label className="text-[10px] text-amber-400 block mb-0.5" htmlFor="edit-attempt-type">Attempt Type</label>
            <select
              id="edit-attempt-type"
              className="input-dark text-xs w-full"
              value={attemptType}
              onChange={(e) => setAttemptType(e.target.value as AttemptTypeOption)}
            >
              {ATTEMPT_TYPES.map((t) => (
                <option key={t} value={t}>{toDisplayLabel(t)}</option>
              ))}
            </select>
          </div>

          {/* PSO disposition code — grouped by category */}
          <div>
            <label className="text-[10px] text-amber-400 block mb-0.5" htmlFor="edit-disposition-code">
              Disposition Code <span className="text-rmpg-500 normal-case font-normal">(leave blank to keep current result)</span>
            </label>
            <select
              id="edit-disposition-code"
              className="input-dark text-xs w-full"
              value={dispositionCode}
              onChange={(e) => setDispositionCode(e.target.value)}
            >
              <option value="">— Keep current result ({attempt.result}) —</option>
              {PSO_CATEGORIES.map((cat: PsoCategory) => (
                <optgroup key={cat.code} label={`${cat.code} — ${cat.label}`}>
                  {codesByCategory[cat.code].map((code) => (
                    <option key={code.code} value={code.code}>{code.code} — {code.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            {resolvedCode?.hint && (
              <div className="text-[10px] text-rmpg-400 mt-0.5 italic">{resolvedCode.hint}</div>
            )}
          </div>

          {/* Notes */}
          <div>
            <label className="text-[10px] text-amber-400 block mb-0.5" htmlFor="edit-attempt-notes">Notes</label>
            <textarea
              id="edit-attempt-notes"
              rows={3}
              className="input-dark text-xs w-full resize-y"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Additional context — what changed, why the edit was made"
            />
          </div>

          {/* Immutable evidence reminder */}
          <div className="flex items-start gap-1.5 text-[10px] text-rmpg-400">
            <AlertTriangle className="w-3 h-3 text-amber-400 mt-0.5 flex-shrink-0" />
            <span>
              GPS coordinates, photos, signature, and the officer who logged the attempt are immutable — they're evidence.
            </span>
          </div>

          {error && (
            <div className="text-[11px] text-red-400 bg-red-900/30 border border-red-700/40 px-2 py-1 rounded-[2px]">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 mt-4 pt-3 border-t border-rmpg-700/40">
          {/* Delete button — left side */}
          {onDelete && (
            <div className="mr-auto">
              {confirmingDelete ? (
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-red-400">Remove this attempt?</span>
                  <button
                    type="button"
                    onClick={() => { setConfirmingDelete(false); onDelete(queueId, attempt); }}
                    className="text-[10px] font-bold text-red-300 bg-red-900/40 hover:bg-red-900/60 border border-red-700/50 px-2 py-1 rounded-[2px]"
                  >
                    Confirm
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingDelete(false)}
                    className="text-[10px] text-rmpg-400 hover:text-rmpg-200 px-2 py-1"
                  >
                    Keep
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(true)}
                  disabled={saving}
                  className="inline-flex items-center gap-1 text-[10px] text-red-400 hover:text-red-300 bg-red-900/10 hover:bg-red-900/30 border border-red-800/30 hover:border-red-700/50 px-2 py-1 rounded-[2px] disabled:opacity-40"
                  title="Delete this attempt"
                >
                  <Trash2 className="w-3 h-3" />
                  Delete
                </button>
              )}
            </div>
          )}
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="text-[11px] text-rmpg-300 hover:text-rmpg-100 px-3 py-1.5"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="text-[11px] font-bold text-green-300 bg-green-900/40 hover:bg-green-900/60 border border-green-700/50 px-3 py-1.5 rounded-[2px] inline-flex items-center gap-1 disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
