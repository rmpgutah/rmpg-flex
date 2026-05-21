// ============================================================
// RMPG Flex — Body Camera Video Edit Modal
// ============================================================
// Admin-only modal for editing body camera video metadata.
// Uses FormModal wrapper with dirty-form tracking.
// ============================================================

import React, { useState, useEffect } from 'react';
import { Video } from 'lucide-react';
import FormModal from './FormModal';
import { useFormDraft } from '../hooks/useFormDraft';
import type { BodyCamVideo, VideoClassification, VideoRetention } from '../types';

export interface BodyCamVideoEditData {
  title: string;
  classification: VideoClassification;
  case_number: string;
  retention_status: VideoRetention;
  recorded_at: string;
  notes: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSave: (videoId: number, data: BodyCamVideoEditData) => Promise<void>;
  video: BodyCamVideo | null;
  isSubmitting: boolean;
}

const CLASSIFICATIONS: { value: VideoClassification; label: string }[] = [
  { value: 'routine', label: 'Routine' },
  { value: 'evidence', label: 'Evidence' },
  { value: 'flagged', label: 'Flagged' },
  { value: 'restricted', label: 'Restricted' },
];

const RETENTIONS: { value: VideoRetention; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'archived', label: 'Archived' },
  { value: 'pending_deletion', label: 'Pending Deletion' },
];

const EMPTY: BodyCamVideoEditData = {
  title: '',
  classification: 'routine',
  case_number: '',
  retention_status: 'active',
  recorded_at: '',
  notes: '',
};

export default function VideoEditModal({ isOpen, onClose, onSave, video, isSubmitting }: Props) {
  const {
    form,
    setForm,
    isDirty,
    wasRestored,
    clearDraft,
    snapshot,
  } = useFormDraft<BodyCamVideoEditData>({
    storageKey: 'rmpg_video_edit_form',
    defaultValue: EMPTY,
    isActive: isOpen,
  });

  useEffect(() => {
    if (isOpen && video) {
      const init: BodyCamVideoEditData = {
        title: video.title || '',
        classification: video.classification || 'routine',
        case_number: video.case_number || '',
        retention_status: video.retention_status || 'active',
        recorded_at: video.recorded_at ? video.recorded_at.slice(0, 16) : '',
        notes: video.notes || '',
      };
      setForm(init);
      snapshot();
    }
  }, [isOpen, video, snapshot]);

  const set = (field: keyof BodyCamVideoEditData, value: string) =>
    setForm(prev => ({ ...prev, [field]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!video) return;
    await onSave(video.id, form);
  };

  return (
    <FormModal
      isOpen={isOpen}
      onClose={onClose}
      onSubmit={handleSubmit}
      title={video ? `Edit: ${video.title}` : 'Edit Video'}
      icon={Video}
      submitLabel="Save Changes"
      isSubmitting={isSubmitting}
      isDirty={isDirty}
      draftRestored={wasRestored}
      onDiscardDraft={clearDraft}
      maxWidth="max-w-lg"
    >
      {/* Title */}
      <div>
        <label className="field-label mb-1 block">Title *</label>
        <input
          type="text"
          className="input-dark"
          value={form.title}
          onChange={e => set('title', e.target.value)}
          required
        />
      </div>

      {/* Classification + Retention */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="field-label mb-1 block">Classification</label>
          <select
            className="select-dark"
            value={form.classification}
            onChange={e => set('classification', e.target.value)}
          >
            {CLASSIFICATIONS.map(c => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label mb-1 block">Retention Status</label>
          <select
            className="select-dark"
            value={form.retention_status}
            onChange={e => set('retention_status', e.target.value)}
          >
            {RETENTIONS.map(r => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Case Number + Recorded At */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="field-label mb-1 block">Case Number</label>
          <input
            type="text"
            className="input-dark"
            value={form.case_number}
            onChange={e => set('case_number', e.target.value)}
            placeholder="e.g. RKY26-00042-CRM"
          />
        </div>
        <div>
          <label className="field-label mb-1 block">Recorded At</label>
          <input
            type="datetime-local"
            className="input-dark"
            value={form.recorded_at}
            onChange={e => set('recorded_at', e.target.value)}
          />
        </div>
      </div>

      {/* Notes */}
      <div>
        <label className="field-label mb-1 block">Notes</label>
        <textarea
          className="textarea-dark"
          rows={3}
          value={form.notes}
          onChange={e => set('notes', e.target.value)}
          placeholder="Optional notes about this footage..."
        />
      </div>

      {/* Overlay info */}
      {video?.overlay_status === 'complete' && (
        <p className="text-[10px] text-rmpg-500 italic">
          Changing classification, case number, or recorded date will automatically re-burn the video overlay.
        </p>
      )}
    </FormModal>
  );
}
