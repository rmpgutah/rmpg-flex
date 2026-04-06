// ============================================================
// RMPG Flex — Dash Camera Video Edit Modal
// ============================================================
// Allows admin users to edit dashcam video metadata: title, event type,
// case #, classification, retention, speed, address, notes, recorded_at.
// ============================================================

import React, { useState, useEffect } from 'react';
import { X, Save, Loader2, Car } from 'lucide-react';
import type { DashcamVideo, VideoClassification } from '../types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  video: DashcamVideo | null;
  onSave: (videoId: number, data: DashCamVideoEditData) => Promise<void>;
}

export interface DashCamVideoEditData {
  title: string;
  event_type: string;
  case_number: string;
  classification: VideoClassification;
  retention_status: string;
  speed_mph: string;
  address: string;
  notes: string;
  recorded_at: string;
}

const CLASSIFICATIONS: { value: VideoClassification; label: string }[] = [
  { value: 'routine', label: 'Routine' },
  { value: 'evidence', label: 'Evidence' },
  { value: 'flagged', label: 'Flagged' },
  { value: 'restricted', label: 'Restricted' },
];

const RETENTION_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'archived', label: 'Archived' },
  { value: 'pending_review', label: 'Pending Review' },
];

const EVENT_TYPE_OPTIONS = [
  { value: '', label: '— None —' },
  { value: 'hard_brake', label: 'Hard Brake' },
  { value: 'speeding', label: 'Speeding' },
  { value: 'impact', label: 'Impact' },
  { value: 'hard_accel', label: 'Hard Acceleration' },
  { value: 'hard_turn', label: 'Hard Turn' },
  { value: 'video_start', label: 'Video Start' },
  { value: 'camera_triggered', label: 'Camera Triggered' },
  { value: 'panic', label: 'Panic' },
];

export default function DashCamVideoEditModal({ isOpen, onClose, video, onSave }: Props) {
  const [title, setTitle] = useState('');
  const [eventType, setEventType] = useState('');
  const [caseNumber, setCaseNumber] = useState('');
  const [classification, setClassification] = useState<VideoClassification>('routine');
  const [retentionStatus, setRetentionStatus] = useState('active');
  const [speedMph, setSpeedMph] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [recordedAt, setRecordedAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Populate form when video changes
  useEffect(() => {
    if (video) {
      setTitle(video.title || '');
      setEventType(video.event_type || '');
      setCaseNumber(video.case_number || '');
      setClassification(video.classification || 'routine');
      setRetentionStatus(video.retention_status || 'active');
      setSpeedMph(video.speed_mph != null ? String(video.speed_mph) : '');
      setAddress(video.address || '');
      setNotes(video.notes || '');
      setRecordedAt(video.recorded_at ? video.recorded_at.slice(0, 16) : '');
      setError('');
    }
  }, [video]);

  if (!isOpen || !video) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) { setError('Title is required'); return; }
    setSaving(true);
    setError('');
    try {
      await onSave(video.id, {
        title: title.trim(),
        event_type: eventType,
        case_number: caseNumber.trim(),
        classification,
        retention_status: retentionStatus,
        speed_mph: speedMph,
        address: address.trim(),
        notes: notes.trim(),
        recorded_at: recordedAt,
      });
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80" onClick={onClose}>
      <div
        className="bg-surface-base border border-rmpg-700 rounded-lg shadow-2xl w-[520px] max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-rmpg-700 bg-surface-raised">
          <div className="flex items-center gap-2">
            <Car className="w-4 h-4 text-brand-400" />
            <h2 className="text-sm font-bold text-rmpg-100">Edit Dash Camera Video</h2>
          </div>
          <button onClick={onClose} className="toolbar-btn p-1">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-4 space-y-3">
          {error && (
            <div className="text-[11px] text-red-400 bg-red-900/20 border border-red-800/30 rounded px-3 py-1.5">
              {error}
            </div>
          )}

          {/* Title */}
          <div>
            <label className="field-label">Title *</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="input-field w-full"
              placeholder="Video title"
              required
            />
          </div>

          {/* Event Type + Case Number — side by side */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="field-label">Event Type</label>
              <select
                value={eventType}
                onChange={e => setEventType(e.target.value)}
                className="input-field w-full"
              >
                {EVENT_TYPE_OPTIONS.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label">Case Number</label>
              <input
                type="text"
                value={caseNumber}
                onChange={e => setCaseNumber(e.target.value)}
                className="input-field w-full"
                placeholder="e.g. 2026-1142"
              />
            </div>
          </div>

          {/* Classification + Retention — side by side */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="field-label">Classification</label>
              <select
                value={classification}
                onChange={e => setClassification(e.target.value as VideoClassification)}
                className="input-field w-full"
              >
                {CLASSIFICATIONS.map(c => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label">Retention Status</label>
              <select
                value={retentionStatus}
                onChange={e => setRetentionStatus(e.target.value)}
                className="input-field w-full"
              >
                {RETENTION_OPTIONS.map(r => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Speed + Address — side by side */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="field-label">Speed (mph)</label>
              <input
                type="number"
                value={speedMph}
                onChange={e => setSpeedMph(e.target.value)}
                className="input-field w-full"
                placeholder="e.g. 65"
                min="0"
                max="200"
                step="1"
              />
            </div>
            <div>
              <label className="field-label">Address</label>
              <input
                type="text"
                value={address}
                onChange={e => setAddress(e.target.value)}
                className="input-field w-full"
                placeholder="e.g. 123 Main St"
              />
            </div>
          </div>

          {/* Recorded At */}
          <div>
            <label className="field-label">Recorded At</label>
            <input
              type="datetime-local"
              value={recordedAt}
              onChange={e => setRecordedAt(e.target.value)}
              className="input-field w-full"
            />
          </div>

          {/* Notes */}
          <div>
            <label className="field-label">Notes</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              className="input-field w-full h-20 resize-none"
              placeholder="Additional notes..."
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-rmpg-700">
            <button type="button" onClick={onClose} className="toolbar-btn px-3 py-1.5 text-xs" disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="toolbar-btn toolbar-btn-primary px-3 py-1.5 text-xs" disabled={saving}>
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
              Save Changes
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
