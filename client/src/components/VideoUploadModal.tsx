// ============================================================
// RMPG Flex — Body Camera Video Upload Modal
// ============================================================

import React, { useState, useRef } from 'react';
import { Upload, X, Video, Loader2, Radio } from 'lucide-react';
import type { BodyCamera, VideoClassification } from '../types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onUploaded: () => void;
  cameras: BodyCamera[];
  officerId: number;
  apiBase: string;
  getAuthHeaders: () => Record<string, string>;
}

const CLASSIFICATIONS: { value: VideoClassification; label: string }[] = [
  { value: 'routine', label: 'Routine' },
  { value: 'evidence', label: 'Evidence' },
  { value: 'flagged', label: 'Flagged' },
  { value: 'restricted', label: 'Restricted' },
];

const ACTIVATION_TYPES = [
  { value: 'MANUAL', label: 'Manual Activation' },
  { value: 'ACTIVATED', label: 'Auto-Activated' },
  { value: 'PRE-EVENT', label: 'Pre-Event Buffer' },
];

export default function VideoUploadModal({
  isOpen, onClose, onUploaded, cameras, officerId, apiBase, getAuthHeaders,
}: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [cameraId, setCameraId] = useState('');
  const [recordedAt, setRecordedAt] = useState('');
  const [caseNumber, setCaseNumber] = useState('');
  const [classification, setClassification] = useState<VideoClassification>('routine');
  const [eventType, setEventType] = useState('MANUAL');
  const [notes, setNotes] = useState('');
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [duration, setDuration] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const reset = () => {
    setFile(null);
    setTitle('');
    setCameraId('');
    setRecordedAt('');
    setCaseNumber('');
    setClassification('routine');
    setEventType('MANUAL');
    setNotes('');
    setProgress(0);
    setError('');
    setDuration(null);
    setUploading(false);
  };

  const handleClose = () => {
    if (uploading) return;
    reset();
    onClose();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      setFile(f);
      setError('');
      setDuration(null);
      if (!title) {
        setTitle(f.name.replace(/\.[^.]+$/, ''));
      }
      // Extract duration using hidden video element
      const videoEl = document.createElement('video');
      videoEl.preload = 'metadata';
      videoEl.onloadedmetadata = () => {
        if (videoEl.duration && isFinite(videoEl.duration)) {
          setDuration(Math.round(videoEl.duration));
        }
        URL.revokeObjectURL(videoEl.src);
      };
      videoEl.onerror = () => {
        URL.revokeObjectURL(videoEl.src);
        // Duration extraction failed — server will try ffprobe
      };
      videoEl.src = URL.createObjectURL(f);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !title || !cameraId) {
      setError('File, title, and camera are required');
      return;
    }

    setUploading(true);
    setProgress(0);
    setError('');

    const formData = new FormData();
    formData.append('video', file);
    formData.append('title', title);
    formData.append('camera_id', cameraId);
    // Resolve officer_id from the selected camera (each camera is assigned to an officer)
    const selectedCamera = cameras.find(c => String(c.id) === cameraId);
    const resolvedOfficerId = selectedCamera?.officer_id || officerId;
    formData.append('officer_id', String(resolvedOfficerId));
    formData.append('classification', classification);
    if (duration != null) formData.append('duration_seconds', String(duration));
    if (recordedAt) formData.append('recorded_at', recordedAt);
    if (caseNumber) formData.append('case_number', caseNumber);
    if (eventType) formData.append('event_type', eventType);
    if (notes) formData.append('notes', notes);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${apiBase}/personnel/bodycam-videos`);
    xhr.timeout = 600000; // 10 minute timeout for large uploads

    const headers = getAuthHeaders();
    for (const [key, val] of Object.entries(headers)) {
      xhr.setRequestHeader(key, val);
    }

    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) {
        setProgress(Math.round((ev.loaded / ev.total) * 100));
      }
    };

    xhr.onload = () => {
      setUploading(false);
      if (xhr.status >= 200 && xhr.status < 300) {
        reset();
        onUploaded();
        onClose();
      } else {
        try {
          const resp = JSON.parse(xhr.responseText);
          setError(resp.error || `Upload failed (HTTP ${xhr.status})`);
        } catch {
          setError(`Upload failed (HTTP ${xhr.status})`);
        }
      }
    };

    xhr.onerror = () => {
      setUploading(false);
      setError('Network error — upload failed. Check your connection and try again.');
    };

    xhr.ontimeout = () => {
      setUploading(false);
      setError('Upload timed out — the file may be too large for your connection speed. Try a smaller file or a faster connection.');
    };

    xhr.send(formData);
  };

  const formatSize = (bytes: number) => {
    if (!bytes) return '-';
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const formatDurationHMS = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={handleClose}>
      <div className="bg-surface-base border border-rmpg-700 rounded-lg shadow-xl w-[520px] max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-rmpg-700 bg-surface-raised">
          <div className="flex items-center gap-2">
            <Upload className="w-4 h-4 text-brand-400" />
            <h2 className="text-sm font-bold text-rmpg-100">Upload Body Camera Video</h2>
          </div>
          <button onClick={handleClose} disabled={uploading} className="toolbar-btn p-1">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {/* Error */}
          {error && (
            <div className="panel-beveled p-2 border border-red-700/40 bg-red-900/20">
              <p className="text-xs text-red-400">{error}</p>
            </div>
          )}

          {/* File Input */}
          <div className="panel-inset p-3">
            <label className="field-label mb-2 block">Video File <span className="text-red-400">*</span></label>
            {file ? (
              <div className="flex items-center gap-2">
                <Video className="w-4 h-4 text-brand-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-rmpg-200 truncate">{file.name}</p>
                  <p className="text-[9px] text-rmpg-500">
                    {formatSize(file.size)} &bull; {file.type}
                    {duration != null && <> &bull; {formatDurationHMS(duration)}</>}
                  </p>
                </div>
                <button type="button" onClick={() => { setFile(null); if (fileRef.current) fileRef.current.value = ''; }} className="toolbar-btn p-1">
                  <X className="w-3 h-3" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="w-full py-6 border-2 border-dashed border-rmpg-600 rounded-lg hover:border-brand-500 transition-colors flex flex-col items-center gap-2"
              >
                <Upload className="w-6 h-6 text-rmpg-500" />
                <span className="text-xs text-rmpg-400">Click to select video</span>
                <span className="text-[9px] text-rmpg-600">MP4, MOV, AVI, WebM — No size limit</span>
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="video/mp4,video/quicktime,video/x-msvideo,video/webm,.mp4,.mov,.avi,.webm"
              onChange={handleFileChange}
              className="hidden"
            />
          </div>

          {/* Metadata */}
          <div className="panel-inset p-3 space-y-3">
            <div>
              <label className="field-label">Title <span className="text-red-400">*</span></label>
              <input type="text" value={title} onChange={e => setTitle(e.target.value)} required placeholder="Video title" className="input-dark" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="field-label">Camera <span className="text-red-400">*</span></label>
                <select value={cameraId} onChange={e => setCameraId(e.target.value)} required className="select-dark">
                  <option value="">Select camera...</option>
                  {cameras.map(c => <option key={c.id} value={c.id}>{c.camera_id} — {[c.make, c.model].filter(Boolean).join(' ') || 'Unknown'}</option>)}
                </select>
              </div>
              <div>
                <label className="field-label">Classification</label>
                <select value={classification} onChange={e => setClassification(e.target.value as VideoClassification)} className="select-dark">
                  {CLASSIFICATIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="field-label">Recorded Date</label>
                <input type="datetime-local" value={recordedAt} onChange={e => setRecordedAt(e.target.value)} className="input-dark" />
              </div>
              <div>
                <label className="field-label">Case Number</label>
                <input type="text" value={caseNumber} onChange={e => setCaseNumber(e.target.value)} placeholder="e.g. 2026-0001" className="input-dark" />
              </div>
            </div>
            <div>
              <label className="field-label flex items-center gap-1"><Radio className="w-2.5 h-2.5" /> Activation Type</label>
              <select value={eventType} onChange={e => setEventType(e.target.value)} className="select-dark">
                {ACTIVATION_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="field-label">Notes</label>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Additional notes..." className="textarea-dark" />
            </div>
          </div>

          {/* Progress Bar */}
          {uploading && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-rmpg-400 flex items-center gap-1.5">
                  <Loader2 className="w-3 h-3 animate-spin text-brand-400" />
                  Uploading...
                </span>
                <span className="text-brand-400 font-mono font-bold">{progress}%</span>
              </div>
              <div className="w-full h-2 bg-surface-sunken rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-brand-600 to-brand-400 transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button type="button" onClick={handleClose} disabled={uploading} className="toolbar-btn text-xs px-4 py-1.5">
              Cancel
            </button>
            <button
              type="submit"
              disabled={uploading || !file || !title || !cameraId}
              className="toolbar-btn-primary text-xs px-4 py-1.5 flex items-center gap-1.5"
            >
              {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
              {uploading ? 'Uploading...' : 'Upload Video'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
