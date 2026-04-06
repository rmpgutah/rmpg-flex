// ============================================================
// RMPG Flex — Body Camera Video Edit Modal
// Allows admins to update video metadata after upload.
// ============================================================

import React, { useState, useEffect } from 'react';
import { Edit2 } from 'lucide-react';
import FormModal from './FormModal';
import { useFormDirty } from '../hooks/useFormDirty';
import type { BodyCamVideo, VideoClassification, VideoRetention } from '../types';

const CLASSIFICATIONS: { value: VideoClassification; label: string }[] = [
  { value: 'routine', label: 'Routine' },
  { value: 'evidence', label: 'Evidence' },
  { value: 'flagged', label: 'Flagged' },
  { value: 'restricted', label: 'Restricted' },
];

const RETENTION_STATUSES: { value: VideoRetention; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'archived', label: 'Archived' },
  { value: 'pending_deletion', label: 'Pending Deletion' },
];

interface FormData {
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
  onSave: (videoId: number, data: FormData) => Promise<void>;
  video: BodyCamVideo | null;
  isSubmitting: boolean;
}

export default function VideoEditModal({ isOpen, onClose, onSave, video, isSubmitting }: Props) {
  const [form, setForm] = useState<FormData>({
    title: '',
    classification: 'routine',
    case_number: '',
    retention_status: 'active',
    recorded_at: '',
    notes: '',
  });

  const { isDirty, snapshot } = useFormDirty(form, isOpen);

  useEffect(() => {
    if (isOpen && video) {
      const initial: FormData = {
        title: video.title || '',
        classification: video.classification || 'routine',
        case_number: video.case_number || '',
        retention_status: video.retention_status || 'active',
        recorded_at: video.recorded_at ? video.recorded_at.slice(0, 16) : '',
        notes: video.notes || '',
      };
      setForm(initial);
      snapshot(initial);
    }
  }, [isOpen, video, snapshot]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!video) return;
    await onSave(video.id, form);
  };

  const set = (field: keyof FormData, value: string) =>
    setForm(prev => ({ ...prev, [field]: value }));

  return (
    <FormModal
      isOpen={isOpen}
      onClose={onClose}
      onSubmit={handleSubmit}
      title="Edit Video Metadata"
      icon={Edit2}
      submitLabel="Save Changes"
      isSubmitting={isSubmitting}
      isDirty={isDirty}
    >
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className="field-label">Title <span className="text-red-400">*</span></label>
          <input
            type="text"
            value={form.title}
            onChange={e => set('title', e.target.value)}
            className="input-dark w-full"
            required
          />
        </div>

        <div>
          <label className="field-label">Classification</label>
          <select
            value={form.classification}
            onChange={e => set('classification', e.target.value)}
            className="select-dark w-full"
          >
            {CLASSIFICATIONS.map(c => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="field-label">Retention Status</label>
          <select
            value={form.retention_status}
            onChange={e => set('retention_status', e.target.value)}
            className="select-dark w-full"
          >
            {RETENTION_STATUSES.map(r => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="field-label">Case Number</label>
          <input
            type="text"
            value={form.case_number}
            onChange={e => set('case_number', e.target.value)}
            className="input-dark w-full"
            placeholder="e.g. 2026-CR-00123"
          />
        </div>

        <div>
          <label className="field-label">Recorded At</label>
          <input
            type="datetime-local"
            value={form.recorded_at}
            onChange={e => set('recorded_at', e.target.value)}
            className="input-dark w-full"
          />
        </div>

        <div className="col-span-2">
          <label className="field-label">Notes</label>
          <textarea
            value={form.notes}
            onChange={e => set('notes', e.target.value)}
            className="input-dark w-full"
            rows={3}
            placeholder="Additional notes about this video..."
          />
        </div>
      </div>
    </FormModal>
  );
}
