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
import { X, Save, Loader2, AlertTriangle, Trash2, Camera, PenTool, Clock, Plus } from 'lucide-react';
import { apiFetch, apiPostForm, authedImageUrl } from '../../hooks/useApi';
import ServeAttemptFileFolders from './ServeAttemptFileFolders';
import { useFormDraft } from '../../hooks/useFormDraft';
import type { ServeAttempt } from '../../types';
import { toDisplayLabel } from '../../utils/formatters';
import { toDatetimeLocalValue, mtDatetimeLocalToUtc } from '../../utils/dateUtils';
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

// `attempt_at` is stored as naive UTC ("YYYY-MM-DD HH:MM:SS") — the same
// contract every other timestamp column follows, and the one parseTimestamp()
// assumes when it appends 'Z' to a zone-less string. This modal previously
// hand-rolled its own pair of converters that passed the browser's Mountain
// wall-clock straight through, on the premise that "attempts are logged in
// local time." They are not: attempts are stamped by SQLite
// datetime('now','localtime'), and on a Cloudflare Worker 'localtime' IS UTC.
// The mismatch silently shifted every operator-edited attempt back 6-7 hours
// on the printed Notice of Attempt (a 07:35 MDT attempt printed as 01:35).
// Use the canonical DST-aware helpers instead — same pair the other 15+
// timestamp editors in the app use.

const AGE_RANGES = ['Under 18', '18-25', '26-35', '36-45', '46-55', '56-65', 'Over 65'];
const HAIR_COLORS = ['Black', 'Brown', 'Blonde', 'Red', 'Gray', 'White', 'Bald', 'Other'];
const RELATIONSHIPS = ['Spouse', 'Roommate', 'Coworker', 'Family Member', 'Other'];

interface EditAttemptForm {
  attemptAt: string;
  attemptType: AttemptTypeOption;
  dispositionCode: string;
  notes: string;
  ageRange: string;
  height: string;
  weight: string;
  hairColor: string;
  clothing: string;
  personServedName: string;
  relationship: string;
}

const EMPTY_EDIT_FORM: EditAttemptForm = {
  attemptAt: '',
  attemptType: 'failed',
  dispositionCode: '',
  notes: '',
  ageRange: '',
  height: '',
  weight: '',
  hairColor: '',
  clothing: '',
  personServedName: '',
  relationship: '',
};

export default function EditServeAttemptModal({
  isOpen,
  onClose,
  queueId,
  attempt,
  onSaved,
  onDelete,
}: EditServeAttemptModalProps) {
  const {
    form, setForm, wasRestored, clearDraft, signalSaved, snapshot,
  } = useFormDraft<EditAttemptForm>({
    storageKey: `rmpg_edit_serve_attempt_${attempt.id}`,
    defaultValue: EMPTY_EDIT_FORM,
    isActive: isOpen,
  });
  const {
    attemptAt, attemptType, dispositionCode, notes,
    ageRange, height, weight, hairColor, clothing, personServedName, relationship,
  } = form;
  const setAttemptAt = (v: string) => setForm({ ...form, attemptAt: v });
  const setAttemptType = (v: AttemptTypeOption) => setForm({ ...form, attemptType: v });
  const setDispositionCode = (v: string) => setForm({ ...form, dispositionCode: v });
  const setNotes = (v: string) => setForm({ ...form, notes: v });
  const setAgeRange = (v: string) => setForm({ ...form, ageRange: v });
  const setHeight = (v: string) => setForm({ ...form, height: v });
  const setWeight = (v: string) => setForm({ ...form, weight: v });
  const setHairColor = (v: string) => setForm({ ...form, hairColor: v });
  const setClothing = (v: string) => setForm({ ...form, clothing: v });
  const setPersonServedName = (v: string) => setForm({ ...form, personServedName: v });
  const setRelationship = (v: string) => setForm({ ...form, relationship: v });

  // New photos added during this edit session (not yet persisted).
  const [newPhotos, setNewPhotos] = useState<{ id: string; url: string }[]>([]);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form whenever the modal opens against a (possibly different) attempt,
  // unless a local draft for this exact attempt was just restored.
  useEffect(() => {
    if (!isOpen) return;
    if (!wasRestored) {
      // Parse existing description back into individual fields if possible.
      const descParts: Record<string, string> = {};
      (attempt.person_served_description || '').split(', ').forEach((part) => {
        const [k, ...v] = part.split(': ');
        if (k && v.length) descParts[k.toLowerCase()] = v.join(': ');
      });
      setForm({
        attemptAt: toDatetimeLocalValue(attempt.attempt_at),
        attemptType: attempt.attempt_type || 'failed',
        dispositionCode: attempt.disposition_code || '',
        notes: attempt.notes || '',
        ageRange: descParts['age'] || '',
        height: descParts['height'] || '',
        weight: descParts['weight'] || '',
        hairColor: descParts['hair'] || '',
        clothing: descParts['clothing'] || '',
        personServedName: attempt.person_served_name || '',
        relationship: attempt.person_served_relationship || '',
      });
    }
    setNewPhotos([]);
    setError(null);
    setTimeout(() => snapshot(), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const handlePhotoAdd = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const totalExisting = (attempt.photo_ids?.length ?? 0) + newPhotos.length;
    const remaining = Math.max(0, 10 - totalExisting);
    const toUpload = Array.from(files).slice(0, remaining);
    if (toUpload.length === 0) return;
    setUploadingPhoto(true);
    try {
      for (const file of toUpload) {
        const formData = new FormData();
        formData.append('files', file);
        const rows = await apiPostForm<{ file_id: string }[]>('/uploads', formData);
        const row = Array.isArray(rows) ? rows[0] : (rows as any);
        if (row?.file_id) {
          const fileId = row.file_id;
          setNewPhotos((prev) => [
            ...prev,
            { id: fileId, url: authedImageUrl(`/api/uploads/${encodeURIComponent(fileId)}`) },
          ]);
        }
      }
    } catch {
      setError('Photo upload failed — try again');
    } finally {
      setUploadingPhoto(false);
      e.target.value = '';
    }
  };

  const buildDescription = (): string => {
    const parts: string[] = [];
    if (ageRange) parts.push(`Age: ${ageRange}`);
    if (height) parts.push(`Height: ${height}`);
    if (weight) parts.push(`Weight: ${weight}`);
    if (hairColor) parts.push(`Hair: ${hairColor}`);
    if (clothing) parts.push(`Clothing: ${clothing}`);
    return parts.join(', ');
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        attempt_at: mtDatetimeLocalToUtc(attemptAt) || null,
        attempt_type: attemptType,
        notes: notes.trim() || null,
      };
      if (dispositionCode) body.disposition_code = dispositionCode;
      if (newPhotos.length > 0) body.photo_ids_append = newPhotos.map((p) => p.id);

      // Physical description fields
      const desc = buildDescription();
      if (attemptType === 'personal' || attemptType === 'substitute') {
        body.person_served_description = desc || null;
      }
      if (attemptType === 'substitute') {
        body.person_served_name = personServedName.trim() || null;
        body.person_served_relationship = relationship || null;
      }

      await apiFetch(`/process-server/${queueId}/attempt/${attempt.id}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      signalSaved();
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  const guardedClose = () => { clearDraft(); onClose(); };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-attempt-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={guardedClose}
    >
      <div
        className="panel-beveled flex max-h-[90vh] w-full max-w-lg flex-col rounded-[2px] bg-surface-base p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        style={{ borderColor: 'var(--border-default)' }}
      >
        <div className="flex shrink-0 items-center justify-between mb-3">
          <h2 id="edit-attempt-title" className="text-sm font-bold text-amber-400 uppercase tracking-wider">
            Edit Attempt #{attempt.attempt_number}
          </h2>
          <button
            type="button"
            onClick={guardedClose}
            className="text-rmpg-400 hover:text-rmpg-200 p-1"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="-mr-2 flex-1 space-y-3 overflow-y-auto pr-2 text-xs scrollbar-dark">
          {wasRestored && (
            <div className="flex items-center justify-between px-2 py-1.5 rounded-[2px] border border-amber-500/30 bg-amber-950/20">
              <div className="flex items-center gap-1.5 text-[10px] text-amber-400 font-medium">
                <Clock className="w-3 h-3" /> Restored unsaved edits
              </div>
              <button type="button" onClick={clearDraft} className="text-[10px] text-amber-400 underline hover:text-amber-300">
                Discard
              </button>
            </div>
          )}
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
              Disposition Code <span className="text-fg-muted normal-case font-normal">(leave blank to keep current result)</span>
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

          {/* Physical description (personal / substitute) */}
          {(attemptType === 'personal' || attemptType === 'substitute') && (
            <fieldset className="space-y-2 border border-rmpg-700 rounded-[2px] p-2">
              <legend className="text-[10px] font-semibold text-amber-400 uppercase px-1">Physical Description</legend>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] text-rmpg-400 uppercase mb-0.5" htmlFor="edit-age-range">Age Range</label>
                  <select
                    id="edit-age-range"
                    className="input-dark text-xs w-full"
                    value={ageRange}
                    onChange={(e) => setAgeRange(e.target.value)}
                  >
                    <option value="">Select…</option>
                    {AGE_RANGES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] text-rmpg-400 uppercase mb-0.5" htmlFor="edit-hair-color">Hair Color</label>
                  <select
                    id="edit-hair-color"
                    className="input-dark text-xs w-full"
                    value={hairColor}
                    onChange={(e) => setHairColor(e.target.value)}
                  >
                    <option value="">Select…</option>
                    {HAIR_COLORS.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] text-rmpg-400 uppercase mb-0.5" htmlFor="edit-height">Height</label>
                  <input id="edit-height" type="text" className="input-dark text-xs w-full"
                    value={height} onChange={(e) => setHeight(e.target.value)} placeholder="e.g., 5'10" />
                </div>
                <div>
                  <label className="block text-[10px] text-rmpg-400 uppercase mb-0.5" htmlFor="edit-weight">Weight</label>
                  <input id="edit-weight" type="text" className="input-dark text-xs w-full"
                    value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="e.g., 180 lbs" />
                </div>
              </div>
              <div>
                <label className="block text-[10px] text-rmpg-400 uppercase mb-0.5" htmlFor="edit-clothing">Clothing</label>
                <input id="edit-clothing" type="text" className="input-dark text-xs w-full"
                  value={clothing} onChange={(e) => setClothing(e.target.value)} placeholder="Clothing worn" />
              </div>
              {attemptType === 'substitute' && (
                <>
                  <div>
                    <label className="block text-[10px] text-rmpg-400 uppercase mb-0.5" htmlFor="edit-person-name">Person Served Name</label>
                    <input id="edit-person-name" type="text" className="input-dark text-xs w-full"
                      value={personServedName} onChange={(e) => setPersonServedName(e.target.value)}
                      placeholder="Full name" />
                  </div>
                  <div>
                    <label className="block text-[10px] text-rmpg-400 uppercase mb-0.5" htmlFor="edit-relationship">Relationship</label>
                    <select id="edit-relationship" className="input-dark text-xs w-full"
                      value={relationship} onChange={(e) => setRelationship(e.target.value)}>
                      <option value="">Select…</option>
                      {RELATIONSHIPS.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                </>
              )}
            </fieldset>
          )}

          {/* Photos — existing (immutable) + new additions */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-1 text-[10px] text-amber-400">
                <Camera className="w-3 h-3" />
                <span>Field Photos ({(attempt.photo_ids?.length ?? 0) + newPhotos.length})</span>
              </div>
              {(attempt.photo_ids?.length ?? 0) + newPhotos.length < 10 && (
                <label className="flex items-center gap-1 cursor-pointer text-[10px] text-brand-400 hover:text-brand-300">
                  {uploadingPhoto
                    ? <Loader2 className="w-3 h-3 animate-spin" />
                    : <Plus className="w-3 h-3" />}
                  <span>{uploadingPhoto ? 'Uploading…' : 'Add Photo'}</span>
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    multiple
                    disabled={uploadingPhoto}
                    onChange={handlePhotoAdd}
                    className="hidden"
                  />
                </label>
              )}
            </div>
            {((attempt.photo_ids?.length ?? 0) + newPhotos.length > 0) && (
              <div className="flex flex-wrap gap-1.5">
                {(attempt.photo_ids ?? []).map((photoId) => (
                  <a
                    key={photoId}
                    href={authedImageUrl(`/api/uploads/${encodeURIComponent(photoId)}`)}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Original evidence photo"
                    className="block w-16 h-16 border border-rmpg-700 rounded-[2px] overflow-hidden hover:border-brand-400/50 transition-colors"
                  >
                    <img
                      src={authedImageUrl(`/api/uploads/${encodeURIComponent(photoId)}`)}
                      alt="Attempt photo"
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  </a>
                ))}
                {newPhotos.map((p) => (
                  <div key={p.id} className="relative w-16 h-16 border border-brand-600 rounded-[2px] overflow-hidden group">
                    <img src={p.url} alt="New photo" className="w-full h-full object-cover" loading="lazy" />
                    <button
                      type="button"
                      onClick={() => setNewPhotos((prev) => prev.filter((x) => x.id !== p.id))}
                      className="absolute top-0.5 right-0.5 w-4 h-4 bg-red-700 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity"
                      aria-label="Remove new photo"
                    >
                      <Trash2 className="w-2.5 h-2.5 text-rmpg-100" />
                    </button>
                    <span className="absolute bottom-0 left-0 right-0 bg-brand-900/80 text-[8px] text-brand-300 text-center py-0.5">NEW</span>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-start gap-1.5 text-[10px] text-rmpg-400 mt-1.5">
              <AlertTriangle className="w-3 h-3 text-amber-400 mt-0.5 flex-shrink-0" />
              <span>Original photos and GPS are immutable evidence. New photos are appended.</span>
            </div>
          </div>

          <ServeAttemptFileFolders queueId={queueId} attemptId={attempt.id} />

          {/* Signature preview */}
          {attempt.signature_data && (
            <div>
              <div className="flex items-center gap-1 text-[10px] text-amber-400 mb-1">
                <PenTool className="w-3 h-3" />
                <span>Signature on File</span>
              </div>
              <div className="inline-block border border-rmpg-700 rounded-[2px] p-2 bg-surface-sunken">
                <img
                  src={`data:image/png;base64,${attempt.signature_data}`}
                  alt="Officer signature"
                  className="max-h-16 max-w-full"
                />
              </div>
            </div>
          )}

          {error && (
            <div className="text-[11px] text-red-400 bg-red-900/30 border border-red-700/40 px-2 py-1 rounded-[2px]">
              {error}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2 mt-4 pt-3 border-t border-rmpg-700/40">
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
            onClick={guardedClose}
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
