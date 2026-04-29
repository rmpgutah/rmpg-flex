// ============================================================
// RMPG Flex — Body Camera Video Edit Modal
// ============================================================
// Allows admin users to edit BWC video metadata: title, case #,
// interaction type, classification, retention, notes, recorded_at.
// ============================================================

import React, { useState, useEffect } from 'react';
import { X, Save, Loader2, Video } from 'lucide-react';
import type { BodyCamVideo, VideoClassification, BwcInteractionType } from '../types';

import RichTextArea from './RichTextArea';
interface Props {
  isOpen: boolean;
  onClose: () => void;
  video: BodyCamVideo | null;
  onSave: (videoId: number, data: BodyCamVideoEditData) => Promise<void>;
}

export interface BodyCamVideoEditData {
  title: string;
  case_number: string;
  interaction_type: BwcInteractionType | '';
  classification: VideoClassification;
  retention_status: string;
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
  { value: 'pending_deletion', label: 'Pending Deletion' },
];

const INTERACTION_TYPES: { value: BwcInteractionType; label: string }[] = [
  { value: 'traffic_stop', label: 'Traffic Stop' },
  { value: 'arrest', label: 'Arrest' },
  { value: 'use_of_force', label: 'Use of Force' },
  { value: 'search_warrant', label: 'Search Warrant' },
  { value: 'domestic_violence', label: 'Domestic Violence' },
  { value: 'welfare_check', label: 'Welfare Check' },
  { value: 'community_contact', label: 'Community Contact' },
  { value: 'foot_pursuit', label: 'Foot Pursuit' },
  { value: 'vehicle_pursuit', label: 'Vehicle Pursuit' },
  { value: 'interview', label: 'Interview' },
  { value: 'evidence_collection', label: 'Evidence Collection' },
  { value: 'field_training', label: 'Field Training' },
  { value: 'other', label: 'Other' },
];

export default function BodyCamVideoEditModal({ isOpen, onClose, video, onSave }: Props) {
  const [title, setTitle] = useState('');
  const [caseNumber, setCaseNumber] = useState('');
  const [interactionType, setInteractionType] = useState<BwcInteractionType | ''>('');
  const [classification, setClassification] = useState<VideoClassification>('routine');
  const [retentionStatus, setRetentionStatus] = useState('active');
  const [notes, setNotes] = useState('');
  const [recordedAt, setRecordedAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Populate form when video changes
  useEffect(() => {
    if (video) {
      setTitle(video.title || '');
      setCaseNumber(video.case_number || '');
      setInteractionType((video.interaction_type as BwcInteractionType) || '');
      setClassification(video.classification || 'routine');
      setRetentionStatus(video.retention_status || 'active');
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
        case_number: caseNumber.trim(),
        interaction_type: interactionType,
        classification,
        retention_status: retentionStatus,
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
            <Video className="w-4 h-4 text-brand-400" />
            <h2 className="text-sm font-bold text-rmpg-100">Edit Video Details</h2>
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

          {/* Interaction Type + Case Number — side by side */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="field-label">Interaction Type</label>
              <select
                value={interactionType}
                onChange={e => setInteractionType(e.target.value as BwcInteractionType | '')}
                className="input-field w-full"
              >
                <option value="">— None —</option>
                {INTERACTION_TYPES.map(t => (
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
            <RichTextArea
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
