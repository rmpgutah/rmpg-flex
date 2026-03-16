// ============================================================
// RMPG Flex — Dash Camera Video Edit Modal
// ============================================================
// Admin-only modal for editing dash camera video metadata.
// Uses FormModal wrapper with dirty-form tracking.
// ============================================================

import React, { useState, useEffect } from 'react';
import { Car } from 'lucide-react';
import FormModal from './FormModal';
import { useFormDirty } from '../hooks/useFormDirty';
import type { DashCamVideo, VideoClassification } from '../types';

export interface DashCamVideoEditData {
  title: string;
  classification: VideoClassification;
  case_number: string;
  speed_mph: string;
  latitude: string;
  longitude: string;
  address: string;
  notes: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSave: (videoId: number, data: DashCamVideoEditData) => Promise<void>;
  video: DashCamVideo | null;
  isSubmitting: boolean;
}

const CLASSIFICATIONS: { value: VideoClassification; label: string }[] = [
  { value: 'routine', label: 'Routine' },
  { value: 'evidence', label: 'Evidence' },
  { value: 'flagged', label: 'Flagged' },
  { value: 'restricted', label: 'Restricted' },
];

const EMPTY: DashCamVideoEditData = {
  title: '',
  classification: 'routine',
  case_number: '',
  speed_mph: '',
  latitude: '',
  longitude: '',
  address: '',
  notes: '',
};

export default function DashCamVideoEditModal({ isOpen, onClose, onSave, video, isSubmitting }: Props) {
  const [form, setForm] = useState<DashCamVideoEditData>(EMPTY);
  const { isDirty, snapshot } = useFormDirty(form, isOpen);

  useEffect(() => {
    if (isOpen && video) {
      const init: DashCamVideoEditData = {
        title: video.title || '',
        classification: (video.classification as VideoClassification) || 'routine',
        case_number: video.case_number || '',
        speed_mph: video.speed_mph != null ? String(video.speed_mph) : '',
        latitude: video.latitude != null ? String(video.latitude) : '',
        longitude: video.longitude != null ? String(video.longitude) : '',
        address: video.address || '',
        notes: video.notes || '',
      };
      setForm(init);
      snapshot(init);
    }
  }, [isOpen, video, snapshot]);

  const set = (field: keyof DashCamVideoEditData, value: string) =>
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
      title={video ? `Edit: ${video.title}` : 'Edit Dash Cam Video'}
      icon={Car}
      submitLabel="Save Changes"
      isSubmitting={isSubmitting}
      isDirty={isDirty}
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

      {/* Classification + Case Number */}
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
          <label className="field-label mb-1 block">Case Number</label>
          <input
            type="text"
            className="input-dark"
            value={form.case_number}
            onChange={e => set('case_number', e.target.value)}
            placeholder="e.g. RKY26-00042-CRM"
          />
        </div>
      </div>

      {/* Speed + Address */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="field-label mb-1 block">Speed (MPH)</label>
          <input
            type="number"
            className="input-dark"
            value={form.speed_mph}
            onChange={e => set('speed_mph', e.target.value)}
            placeholder="e.g. 45"
            min="0"
            max="200"
            step="1"
          />
        </div>
        <div>
          <label className="field-label mb-1 block">Address</label>
          <input
            type="text"
            className="input-dark"
            value={form.address}
            onChange={e => set('address', e.target.value)}
            placeholder="e.g. 1200 N Main St, Vernal"
          />
        </div>
      </div>

      {/* Latitude + Longitude */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="field-label mb-1 block">Latitude</label>
          <input
            type="number"
            className="input-dark"
            value={form.latitude}
            onChange={e => set('latitude', e.target.value)}
            placeholder="e.g. 40.4555"
            step="0.0001"
          />
        </div>
        <div>
          <label className="field-label mb-1 block">Longitude</label>
          <input
            type="number"
            className="input-dark"
            value={form.longitude}
            onChange={e => set('longitude', e.target.value)}
            placeholder="e.g. -109.5287"
            step="0.0001"
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

      {/* Info note */}
      <p className="text-[10px] text-rmpg-500 italic">
        Metadata changes are reflected in the live HUD overlay during playback.
      </p>
    </FormModal>
  );
}
