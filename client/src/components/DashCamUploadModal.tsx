// ============================================================
// RMPG Flex — Dash Camera Video Upload Modal
// ============================================================
// Manual upload of dash cam footage. Adapted from VideoUploadModal.tsx
// with dashcam-specific fields (device, event type, speed, address).

import React, { useState, useRef, useCallback } from 'react';
import { X, Upload, Car, Loader2, AlertTriangle } from 'lucide-react';
import type { CpgDeviceMapping } from '../types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  apiBase: string;
  getAuthHeaders: () => Record<string, string>;
  deviceMappings: CpgDeviceMapping[];
  officers: { id: number; full_name: string }[];
}

const EVENT_TYPE_OPTIONS = [
  { value: '', label: 'None / General' },
  { value: 'hard_brake', label: 'Hard Brake' },
  { value: 'speeding', label: 'Speeding' },
  { value: 'impact', label: 'Impact' },
  { value: 'hard_accel', label: 'Hard Acceleration' },
  { value: 'hard_turn', label: 'Hard Turn' },
  { value: 'video_start', label: 'Video Start' },
  { value: 'camera_triggered', label: 'Camera Triggered' },
  { value: 'panic', label: 'Panic' },
];

const CLASSIFICATION_OPTIONS = [
  { value: 'routine', label: 'Routine' },
  { value: 'evidence', label: 'Evidence' },
  { value: 'flagged', label: 'Flagged' },
  { value: 'restricted', label: 'Restricted' },
];

export default function DashCamUploadModal({
  isOpen, onClose, onSuccess, apiBase, getAuthHeaders,
  deviceMappings, officers,
}: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [officerId, setOfficerId] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [eventType, setEventType] = useState('');
  const [classification, setClassification] = useState('routine');
  const [recordedAt, setRecordedAt] = useState('');
  const [caseNumber, setCaseNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [speed, setSpeed] = useState('');
  const [address, setAddress] = useState('');
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [duration, setDuration] = useState<number | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setFile(null);
    setTitle('');
    setOfficerId('');
    setDeviceId('');
    setEventType('');
    setClassification('routine');
    setRecordedAt('');
    setCaseNumber('');
    setNotes('');
    setSpeed('');
    setAddress('');
    setUploading(false);
    setProgress(0);
    setError(null);
    setDuration(null);
  }, []);

  const handleClose = useCallback(() => {
    if (uploading) return;
    reset();
    onClose();
  }, [uploading, reset, onClose]);

  const handleFileSelect = useCallback((selectedFile: File) => {
    setFile(selectedFile);
    setError(null);
    if (!title) {
      const nameWithoutExt = selectedFile.name.replace(/\.[^/.]+$/, '');
      setTitle(nameWithoutExt);
    }

    // Extract duration from video metadata
    const videoEl = document.createElement('video');
    videoEl.preload = 'metadata';
    videoEl.onloadedmetadata = () => {
      if (isFinite(videoEl.duration)) {
        setDuration(Math.round(videoEl.duration));
      }
      URL.revokeObjectURL(videoEl.src);
    };
    videoEl.src = URL.createObjectURL(selectedFile);
  }, [title]);

  const handleDeviceChange = useCallback((cpgDeviceId: string) => {
    setDeviceId(cpgDeviceId);
    // Auto-resolve officer from device mapping
    if (cpgDeviceId) {
      const mapping = deviceMappings.find(m => m.cpg_device_id === cpgDeviceId);
      if (mapping?.officer_name) {
        const officer = officers.find(o => o.full_name === mapping.officer_name);
        if (officer) setOfficerId(String(officer.id));
      }
    }
  }, [deviceMappings, officers]);

  const handleUpload = useCallback(async () => {
    if (!file || !title) {
      setError('Please provide a video file and title');
      return;
    }

    setUploading(true);
    setProgress(0);
    setError(null);

    const formData = new FormData();
    formData.append('video', file);
    formData.append('title', title);
    if (officerId) formData.append('officer_id', officerId);
    if (deviceId) formData.append('cpg_device_id', deviceId);
    if (eventType) formData.append('event_type', eventType);
    formData.append('classification', classification);
    if (recordedAt) formData.append('recorded_at', recordedAt);
    if (caseNumber) formData.append('case_number', caseNumber);
    if (notes) formData.append('notes', notes);
    if (speed) formData.append('speed_mph', speed);
    if (address) formData.append('address', address);
    if (duration != null) formData.append('duration_seconds', String(duration));

    // Find unit_id from device mapping
    if (deviceId) {
      const mapping = deviceMappings.find(m => m.cpg_device_id === deviceId);
      if (mapping) formData.append('unit_id', String(mapping.unit_id));
    }

    const xhr = new XMLHttpRequest();
    xhr.timeout = 600000; // 10 min

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        setProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      setUploading(false);
      if (xhr.status >= 200 && xhr.status < 300) {
        reset();
        onSuccess();
        onClose();
      } else {
        try {
          const resp = JSON.parse(xhr.responseText);
          setError(resp.error || `Upload failed (${xhr.status})`);
        } catch {
          setError(`Upload failed (${xhr.status})`);
        }
      }
    };

    xhr.onerror = () => {
      setUploading(false);
      setError('Network error — check your connection and try again.');
    };

    xhr.ontimeout = () => {
      setUploading(false);
      setError('Upload timed out. The file may be too large.');
    };

    const headers = getAuthHeaders();
    xhr.open('POST', `${apiBase}/dashcam-videos`);
    xhr.setRequestHeader('Authorization', headers['Authorization'] || '');
    xhr.send(formData);
  }, [file, title, officerId, deviceId, eventType, classification, recordedAt, caseNumber, notes, speed, address, duration, deviceMappings, apiBase, getAuthHeaders, reset, onSuccess, onClose]);

  if (!isOpen) return null;

  const formatSize = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80" onClick={handleClose}>
      <div className="bg-surface-base border border-rmpg-700 rounded-lg shadow-xl w-[600px] max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-rmpg-700 bg-surface-raised">
          <div className="flex items-center gap-2">
            <Car className="w-4 h-4 text-brand-400" />
            <h2 className="text-sm font-bold text-rmpg-100">Upload Dash Camera Video</h2>
          </div>
          <button onClick={handleClose} disabled={uploading} className="toolbar-btn p-1">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          {error && (
            <div className="panel-beveled p-2.5 flex items-center gap-2 border border-red-700/40 bg-red-900/10">
              <AlertTriangle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
              <span className="text-[10px] text-red-400">{error}</span>
            </div>
          )}

          {/* File Drop Zone */}
          <div
            className={`panel-inset p-6 text-center cursor-pointer hover:bg-surface-hover transition-colors ${file ? 'border-brand-500' : ''}`}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="video/mp4,video/quicktime,video/x-msvideo,video/webm,.mp4,.mov,.avi,.webm"
              onChange={e => { if (e.target.files?.[0]) handleFileSelect(e.target.files[0]); }}
              className="hidden"
            />
            {file ? (
              <div className="flex items-center justify-center gap-3">
                <Car className="w-6 h-6 text-brand-400" />
                <div className="text-left">
                  <p className="text-xs font-semibold text-rmpg-100 truncate max-w-[300px]">{file.name}</p>
                  <p className="text-[10px] text-rmpg-400">{formatSize(file.size)}{duration ? ` | ${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, '0')}` : ''}</p>
                </div>
              </div>
            ) : (
              <>
                <Upload className="w-8 h-8 text-rmpg-500 mx-auto mb-2" />
                <p className="text-xs text-rmpg-400">Click to select a video file</p>
                <p className="text-[9px] text-rmpg-600 mt-0.5">Accepted: MP4, MOV, AVI, WebM</p>
              </>
            )}
          </div>

          {/* Form Fields */}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="field-label mb-1 block">Title *</label>
              <input type="text" value={title} onChange={e => setTitle(e.target.value)} className="input-dark text-xs w-full" placeholder="Video title" />
            </div>

            <div>
              <label className="field-label mb-1 block">Device</label>
              <select value={deviceId} onChange={e => handleDeviceChange(e.target.value)} className="input-dark text-xs w-full">
                <option value="">— Select device —</option>
                {deviceMappings.filter(d => d.is_active).map(d => (
                  <option key={d.cpg_device_id} value={d.cpg_device_id}>
                    {d.cpg_display_name} ({d.call_sign || 'unassigned'})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="field-label mb-1 block">Officer</label>
              <select value={officerId} onChange={e => setOfficerId(e.target.value)} className="input-dark text-xs w-full">
                <option value="">— Select officer —</option>
                {officers.map(o => (
                  <option key={o.id} value={o.id}>{o.full_name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="field-label mb-1 block">Event Type</label>
              <select value={eventType} onChange={e => setEventType(e.target.value)} className="input-dark text-xs w-full">
                {EVENT_TYPE_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="field-label mb-1 block">Classification</label>
              <select value={classification} onChange={e => setClassification(e.target.value)} className="input-dark text-xs w-full">
                {CLASSIFICATION_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="field-label mb-1 block">Recorded At</label>
              <input type="datetime-local" value={recordedAt} onChange={e => setRecordedAt(e.target.value)} className="input-dark text-xs w-full" />
            </div>

            <div>
              <label className="field-label mb-1 block">Case Number</label>
              <input type="text" value={caseNumber} onChange={e => setCaseNumber(e.target.value)} className="input-dark text-xs w-full" placeholder="Optional" />
            </div>

            <div>
              <label className="field-label mb-1 block">Speed (mph)</label>
              <input type="number" value={speed} onChange={e => setSpeed(e.target.value)} className="input-dark text-xs w-full" placeholder="Optional" />
            </div>

            <div>
              <label className="field-label mb-1 block">Address</label>
              <input type="text" value={address} onChange={e => setAddress(e.target.value)} className="input-dark text-xs w-full" placeholder="Optional" />
            </div>

            <div className="col-span-2">
              <label className="field-label mb-1 block">Notes</label>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} className="input-dark text-xs w-full h-16 resize-none" placeholder="Optional notes" />
            </div>
          </div>

          {/* Upload Progress */}
          {uploading && (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[10px]">
                <span className="flex items-center gap-1 text-rmpg-400">
                  <Loader2 className="w-3 h-3 animate-spin text-brand-400" />
                  Uploading...
                </span>
                <span className="font-mono text-brand-400">{progress}%</span>
              </div>
              <div className="w-full bg-rmpg-700 rounded-full h-1.5">
                <div className="bg-brand-500 h-1.5 rounded-full transition-all" style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-rmpg-700">
            <button onClick={handleClose} disabled={uploading} className="toolbar-btn text-xs px-4 py-1.5">
              Cancel
            </button>
            <button
              onClick={handleUpload}
              disabled={uploading || !file || !title}
              className="toolbar-btn toolbar-btn-primary text-xs px-4 py-1.5 flex items-center gap-1.5"
            >
              {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
              {uploading ? 'Uploading...' : 'Upload Video'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
