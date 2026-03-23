// ============================================================
// RMPG Flex — Dash Camera Multi-File Upload Wizard
// 3-step wizard: Select Files → Enter Metadata → Review & Upload
// Drop-in replacement for DashCamUploadModal
// ============================================================

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Upload, X, ChevronDown, ChevronRight, Check, AlertCircle,
  Film, Plus, ArrowLeft, ArrowRight, Loader2, Trash2, Copy,
} from 'lucide-react';

// ── Types ───────────────────────────────────────────────────

interface FleetVehicle {
  id: number;
  vehicle_number: string;
  make?: string;
  model?: string;
  year?: number;
}

interface UnitOption {
  id: number;
  call_sign: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onUploaded: () => void;
  vehicles: FleetVehicle[];
  units: UnitOption[];
  apiBase: string;
  getAuthHeaders: () => Record<string, string>;
}

interface FileEntry {
  id: string;
  file: File;
  thumbnailUrl: string | null;
  thumbnailBlob: Blob | null;
  duration: number | null;
  title: string;
  vehicleId: string;
  unitId: string;
  recordedAt: string;
  classification: string;
  caseNumber: string;
  speedMph: string;
  latitude: string;
  longitude: string;
  address: string;
  notes: string;
}

type UploadStatus = 'queued' | 'uploading' | 'complete' | 'error';

interface UploadState {
  status: UploadStatus;
  progress: number;
  error: string;
}

// ── Constants ───────────────────────────────────────────────

const MAX_FILES = 10;
const ACCEPTED_TYPES = 'video/mp4,video/quicktime,video/x-msvideo,video/webm,video/x-matroska';

const CLASSIFICATIONS = [
  { value: 'routine', label: 'Routine' },
  { value: 'evidence', label: 'Evidence' },
  { value: 'flagged', label: 'Flagged' },
  { value: 'restricted', label: 'Restricted' },
];

// ── Helpers ─────────────────────────────────────────────────

function formatSize(bytes: number): string {
  if (!bytes) return '-';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDuration(seconds: number | null): string {
  if (seconds == null) return '--:--';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function generateId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function generateThumbnail(file: File): Promise<{ url: string; blob: Blob; duration: number | null }> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    const objectUrl = URL.createObjectURL(file);
    video.src = objectUrl;

    let resolved = false;
    const finish = (url: string, blob: Blob, dur: number | null) => {
      if (resolved) return;
      resolved = true;
      URL.revokeObjectURL(objectUrl);
      resolve({ url, blob, duration: dur });
    };

    const captureFrame = () => {
      const dur = video.duration && isFinite(video.duration) ? Math.round(video.duration) : null;
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 320;
        canvas.height = 180;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          canvas.toBlob((b) => {
            if (b) {
              const thumbUrl = URL.createObjectURL(b);
              finish(thumbUrl, b, dur);
            } else {
              finish('', new Blob(), dur);
            }
          }, 'image/jpeg', 0.7);
        } else {
          finish('', new Blob(), dur);
        }
      } catch {
        finish('', new Blob(), dur);
      }
    };

    video.onloadedmetadata = () => {
      const seekTarget = video.duration > 2 ? 2 : 0;
      video.currentTime = seekTarget;
    };

    video.onseeked = () => {
      captureFrame();
    };

    video.onerror = () => {
      if (!resolved) {
        resolved = true;
        URL.revokeObjectURL(objectUrl);
        resolve({ url: '', blob: new Blob(), duration: null });
      }
    };

    // Fallback timeout
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        URL.revokeObjectURL(objectUrl);
        resolve({ url: '', blob: new Blob(), duration: null });
      }
    }, 10000);
  });
}

// ── Component ───────────────────────────────────────────────

export default function DashCamUploadWizard({
  isOpen, onClose, onUploaded, vehicles, units, apiBase, getAuthHeaders,
}: Props) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [expandedFile, setExpandedFile] = useState<string | null>(null);
  const [uploadStates, setUploadStates] = useState<Record<string, UploadState>>({});
  const [isUploading, setIsUploading] = useState(false);
  const [allDone, setAllDone] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const thumbnailUrlsRef = useRef<string[]>([]);

  // Clean up thumbnail URLs on unmount
  useEffect(() => {
    return () => {
      thumbnailUrlsRef.current.forEach((url) => {
        if (url) URL.revokeObjectURL(url);
      });
      thumbnailUrlsRef.current = [];
    };
  }, []);

  if (!isOpen) return null;

  const reset = () => {
    thumbnailUrlsRef.current.forEach((url) => {
      if (url) URL.revokeObjectURL(url);
    });
    thumbnailUrlsRef.current = [];
    setStep(1);
    setFiles([]);
    setExpandedFile(null);
    setUploadStates({});
    setIsUploading(false);
    setAllDone(false);
    xhrRef.current = null;
  };

  const handleClose = () => {
    if (isUploading) return;
    reset();
    onClose();
  };

  const handleCloseAfterUpload = () => {
    const completedCount = Object.values(uploadStates).filter((s) => s.status === 'complete').length;
    if (completedCount > 0) {
      onUploaded();
    }
    reset();
    onClose();
  };

  // ── Step 1: File Selection ────────────────

  const addFiles = async (incoming: FileList | File[]) => {
    const arr = Array.from(incoming);
    const remaining = MAX_FILES - files.length;
    const toAdd = arr.slice(0, remaining);

    for (const file of toAdd) {
      const { url, blob, duration } = await generateThumbnail(file);
      if (url) thumbnailUrlsRef.current.push(url);

      const entry: FileEntry = {
        id: generateId(),
        file,
        thumbnailUrl: url || null,
        thumbnailBlob: blob.size > 0 ? blob : null,
        duration,
        title: file.name.replace(/\.[^.]+$/, ''),
        vehicleId: '',
        unitId: '',
        recordedAt: '',
        classification: 'routine',
        caseNumber: '',
        speedMph: '',
        latitude: '',
        longitude: '',
        address: '',
        notes: '',
      };

      setFiles((prev) => [...prev, entry]);
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      addFiles(e.target.files);
      e.target.value = '';
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const removeFile = (id: string) => {
    setFiles((prev) => {
      const removed = prev.find((f) => f.id === id);
      if (removed?.thumbnailUrl) {
        URL.revokeObjectURL(removed.thumbnailUrl);
        thumbnailUrlsRef.current = thumbnailUrlsRef.current.filter((u) => u !== removed.thumbnailUrl);
      }
      return prev.filter((f) => f.id !== id);
    });
  };

  // ── Step 2: Metadata ─────────────────────

  const updateFile = (id: string, updates: Partial<FileEntry>) => {
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, ...updates } : f)));
  };

  const applyToAll = () => {
    const source = files.find((f) => f.id === expandedFile);
    if (!source) return;
    setFiles((prev) =>
      prev.map((f) =>
        f.id === source.id
          ? f
          : {
              ...f,
              vehicleId: source.vehicleId,
              unitId: source.unitId,
              classification: source.classification,
            }
      )
    );
  };

  // ── Step 3: Upload ───────────────────────

  const uploadFile = useCallback(
    (entry: FileEntry): Promise<void> => {
      return new Promise((resolve) => {
        setUploadStates((prev) => ({
          ...prev,
          [entry.id]: { status: 'uploading', progress: 0, error: '' },
        }));

        const formData = new FormData();
        formData.append('video', entry.file);
        formData.append('title', entry.title || entry.file.name);
        if (entry.vehicleId) formData.append('vehicle_id', entry.vehicleId);
        if (entry.unitId) formData.append('unit_id', entry.unitId);
        formData.append('classification', entry.classification);
        if (entry.duration != null) formData.append('duration_seconds', String(entry.duration));
        if (entry.recordedAt) formData.append('recorded_at', entry.recordedAt);
        if (entry.speedMph) formData.append('speed_mph', entry.speedMph);
        if (entry.latitude) formData.append('latitude', entry.latitude);
        if (entry.longitude) formData.append('longitude', entry.longitude);
        if (entry.address) formData.append('address', entry.address);
        if (entry.caseNumber) formData.append('case_number', entry.caseNumber);
        if (entry.notes) formData.append('notes', entry.notes);
        if (entry.thumbnailBlob && entry.thumbnailBlob.size > 0) {
          formData.append('thumbnail', entry.thumbnailBlob, 'thumbnail.jpg');
        }

        const xhr = new XMLHttpRequest();
        xhrRef.current = xhr;
        xhr.open('POST', `${apiBase}/fleet/dashcam-videos`);
        xhr.timeout = 600000;

        const headers = getAuthHeaders();
        for (const [key, val] of Object.entries(headers)) {
          xhr.setRequestHeader(key, val);
        }

        xhr.upload.onprogress = (ev) => {
          if (ev.lengthComputable) {
            const pct = Math.round((ev.loaded / ev.total) * 100);
            setUploadStates((prev) => ({
              ...prev,
              [entry.id]: { ...prev[entry.id], progress: pct },
            }));
          }
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            setUploadStates((prev) => ({
              ...prev,
              [entry.id]: { status: 'complete', progress: 100, error: '' },
            }));
          } else {
            let errorMsg = `Upload failed (HTTP ${xhr.status})`;
            try {
              const resp = JSON.parse(xhr.responseText);
              if (resp.error) errorMsg = resp.error;
            } catch {}
            setUploadStates((prev) => ({
              ...prev,
              [entry.id]: { status: 'error', progress: 0, error: errorMsg },
            }));
          }
          resolve();
        };

        xhr.onerror = () => {
          setUploadStates((prev) => ({
            ...prev,
            [entry.id]: { status: 'error', progress: 0, error: 'Network error' },
          }));
          resolve();
        };

        xhr.ontimeout = () => {
          setUploadStates((prev) => ({
            ...prev,
            [entry.id]: { status: 'error', progress: 0, error: 'Upload timed out' },
          }));
          resolve();
        };

        xhr.send(formData);
      });
    },
    [apiBase, getAuthHeaders]
  );

  const startUploadAll = useCallback(async () => {
    setIsUploading(true);
    const initial: Record<string, UploadState> = {};
    files.forEach((f) => {
      initial[f.id] = { status: 'queued', progress: 0, error: '' };
    });
    setUploadStates(initial);

    for (const entry of files) {
      await uploadFile(entry);
    }

    setIsUploading(false);
    setAllDone(true);
  }, [files, uploadFile]);

  // ── Step Indicator ────────────────────────

  const stepLabels = ['Select Files', 'Metadata', 'Upload'];

  const stepIndicator = (
    <div className="flex items-center justify-center gap-2 py-2">
      {stepLabels.map((label, i) => {
        const stepNum = (i + 1) as 1 | 2 | 3;
        const isActive = step === stepNum;
        const isDone = step > stepNum;
        return (
          <React.Fragment key={label}>
            {i > 0 && (
              <div
                className={`w-8 h-px ${isDone ? 'bg-brand-500' : 'bg-rmpg-700'}`}
              />
            )}
            <div className="flex items-center gap-1.5">
              <div
                className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold border ${
                  isActive
                    ? 'bg-brand-500 border-brand-400 text-white'
                    : isDone
                    ? 'bg-brand-500/30 border-brand-500 text-brand-300'
                    : 'bg-surface-sunken border-rmpg-600 text-rmpg-500'
                }`}
              >
                {isDone ? <Check className="w-3 h-3" /> : stepNum}
              </div>
              <span
                className={`text-[9px] font-bold uppercase tracking-wider ${
                  isActive ? 'text-rmpg-200' : 'text-rmpg-500'
                }`}
              >
                {label}
              </span>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );

  // ── Render Step 1 ─────────────────────────

  const renderStep1 = () => (
    <div className="flex-1 overflow-y-auto p-4 space-y-3">
      {/* Drop Zone */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onClick={() => files.length < MAX_FILES && fileRef.current?.click()}
        className={`border-2 border-dashed rounded-sm py-10 flex flex-col items-center gap-3 cursor-pointer transition-colors ${
          files.length >= MAX_FILES
            ? 'border-rmpg-700 opacity-50 cursor-not-allowed'
            : 'border-rmpg-600 hover:border-brand-500'
        }`}
      >
        <Upload className="w-8 h-8 text-rmpg-500" />
        <span className="text-xs text-rmpg-300">
          {files.length >= MAX_FILES
            ? `Maximum ${MAX_FILES} files reached`
            : 'Drag and drop video files here, or click to browse'}
        </span>
        <span className="text-[9px] text-rmpg-600">MP4, MOV, AVI, WebM, MKV</span>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept={ACCEPTED_TYPES + ',.mp4,.mov,.avi,.webm,.mkv'}
        multiple
        onChange={handleFileInput}
        className="hidden"
      />

      {/* File List */}
      {files.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-rmpg-400 uppercase tracking-wider">
              {files.length} file{files.length !== 1 ? 's' : ''} selected
            </span>
            {files.length < MAX_FILES && (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="toolbar-btn text-[10px] px-2 py-1 flex items-center gap-1"
              >
                <Plus className="w-3 h-3" /> Add More
              </button>
            )}
          </div>

          {files.map((entry) => (
            <div
              key={entry.id}
              className="panel-inset p-2 flex items-center gap-3"
            >
              {/* Thumbnail */}
              <div className="w-16 h-10 flex-shrink-0 bg-surface-sunken overflow-hidden rounded-sm">
                {entry.thumbnailUrl ? (
                  <img
                    src={entry.thumbnailUrl}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <Film className="w-4 h-4 text-rmpg-600" />
                  </div>
                )}
              </div>

              {/* File Info */}
              <div className="flex-1 min-w-0">
                <p className="text-[11px] text-rmpg-200 font-semibold truncate">
                  {entry.file.name}
                </p>
                <p className="text-[9px] text-rmpg-500">
                  {formatSize(entry.file.size)}
                  {entry.duration != null && <> &bull; {formatDuration(entry.duration)}</>}
                </p>
              </div>

              {/* Remove */}
              <button
                type="button"
                onClick={() => removeFile(entry.id)}
                className="toolbar-btn p-1 text-rmpg-500 hover:text-red-400"
                title="Remove file"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  // ── Render Step 2 ─────────────────────────

  const renderStep2 = () => {
    // Expand first file by default if none expanded
    const activeExpanded =
      expandedFile && files.some((f) => f.id === expandedFile)
        ? expandedFile
        : files[0]?.id || null;

    return (
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {/* Apply to All toolbar */}
        <div className="panel-inset p-2 flex items-center justify-between">
          <span className="text-[9px] text-rmpg-400">
            Copy Vehicle, Unit, and Classification from the open file to all files
          </span>
          <button
            type="button"
            onClick={applyToAll}
            disabled={!activeExpanded}
            className="toolbar-btn text-[10px] px-3 py-1 flex items-center gap-1"
          >
            <Copy className="w-3 h-3" /> Apply to All
          </button>
        </div>

        {/* Accordion */}
        {files.map((entry) => {
          const isExpanded = entry.id === activeExpanded;
          return (
            <div key={entry.id} className="panel-beveled overflow-hidden">
              {/* Accordion Header */}
              <button
                type="button"
                onClick={() => setExpandedFile(isExpanded ? null : entry.id)}
                className="w-full flex items-center gap-2 px-3 py-2 hover:bg-surface-hover transition-colors"
              >
                {isExpanded ? (
                  <ChevronDown className="w-3.5 h-3.5 text-rmpg-400 flex-shrink-0" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 text-rmpg-400 flex-shrink-0" />
                )}
                <div className="w-10 h-6 flex-shrink-0 bg-surface-sunken overflow-hidden rounded-sm">
                  {entry.thumbnailUrl ? (
                    <img src={entry.thumbnailUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Film className="w-3 h-3 text-rmpg-600" />
                    </div>
                  )}
                </div>
                <span className="text-[11px] text-rmpg-200 font-semibold truncate flex-1 text-left">
                  {entry.file.name}
                </span>
                <span className="text-[9px] text-rmpg-500 flex-shrink-0">
                  {formatSize(entry.file.size)}
                </span>
              </button>

              {/* Accordion Body */}
              {isExpanded && (
                <div className="px-3 pb-3 pt-1 space-y-3 border-t border-rmpg-700">
                  {/* Title */}
                  <div>
                    <label className="text-[10px] font-bold text-rmpg-400 uppercase tracking-wider">
                      Title <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="text"
                      value={entry.title}
                      onChange={(e) => updateFile(entry.id, { title: e.target.value })}
                      placeholder="Video title"
                      className="input-dark"
                    />
                  </div>

                  {/* Vehicle & Unit */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-bold text-rmpg-400 uppercase tracking-wider">
                        Vehicle
                      </label>
                      <select
                        value={entry.vehicleId}
                        onChange={(e) => updateFile(entry.id, { vehicleId: e.target.value })}
                        className="select-dark"
                      >
                        <option value="">Select vehicle...</option>
                        {vehicles.map((v) => (
                          <option key={v.id} value={v.id}>
                            #{v.vehicle_number} — {[v.year, v.make, v.model].filter(Boolean).join(' ')}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-rmpg-400 uppercase tracking-wider">
                        Unit
                      </label>
                      <select
                        value={entry.unitId}
                        onChange={(e) => updateFile(entry.id, { unitId: e.target.value })}
                        className="select-dark"
                      >
                        <option value="">Select unit...</option>
                        {units.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.call_sign}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Recorded At & Classification */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-bold text-rmpg-400 uppercase tracking-wider">
                        Recorded At
                      </label>
                      <input
                        type="datetime-local"
                        value={entry.recordedAt}
                        onChange={(e) => updateFile(entry.id, { recordedAt: e.target.value })}
                        className="input-dark"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-rmpg-400 uppercase tracking-wider">
                        Classification
                      </label>
                      <select
                        value={entry.classification}
                        onChange={(e) => updateFile(entry.id, { classification: e.target.value })}
                        className="select-dark"
                      >
                        {CLASSIFICATIONS.map((c) => (
                          <option key={c.value} value={c.value}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Case Number & Speed */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-bold text-rmpg-400 uppercase tracking-wider">
                        Case Number
                      </label>
                      <input
                        type="text"
                        value={entry.caseNumber}
                        onChange={(e) => updateFile(entry.id, { caseNumber: e.target.value })}
                        placeholder="e.g. 2026-0001"
                        className="input-dark"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-rmpg-400 uppercase tracking-wider">
                        Speed (MPH)
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        value={entry.speedMph}
                        onChange={(e) => updateFile(entry.id, { speedMph: e.target.value })}
                        placeholder="e.g. 45"
                        className="input-dark"
                      />
                    </div>
                  </div>

                  {/* Lat/Lng */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-bold text-rmpg-400 uppercase tracking-wider">
                        Latitude
                      </label>
                      <input
                        type="number"
                        step="0.0001"
                        value={entry.latitude}
                        onChange={(e) => updateFile(entry.id, { latitude: e.target.value })}
                        placeholder="e.g. 40.7608"
                        className="input-dark"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-rmpg-400 uppercase tracking-wider">
                        Longitude
                      </label>
                      <input
                        type="number"
                        step="0.0001"
                        value={entry.longitude}
                        onChange={(e) => updateFile(entry.id, { longitude: e.target.value })}
                        placeholder="e.g. -111.8910"
                        className="input-dark"
                      />
                    </div>
                  </div>

                  {/* Address */}
                  <div>
                    <label className="text-[10px] font-bold text-rmpg-400 uppercase tracking-wider">
                      Address
                    </label>
                    <input
                      type="text"
                      value={entry.address}
                      onChange={(e) => updateFile(entry.id, { address: e.target.value })}
                      placeholder="e.g. 123 S State St, Salt Lake City, UT"
                      className="input-dark"
                    />
                  </div>

                  {/* Notes */}
                  <div>
                    <label className="text-[10px] font-bold text-rmpg-400 uppercase tracking-wider">
                      Notes
                    </label>
                    <textarea
                      value={entry.notes}
                      onChange={(e) => updateFile(entry.id, { notes: e.target.value })}
                      rows={2}
                      placeholder="Additional notes..."
                      className="textarea-dark"
                    />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  // ── Render Step 3 ─────────────────────────

  const renderStep3 = () => {
    const completedCount = Object.values(uploadStates).filter((s) => s.status === 'complete').length;
    const errorCount = Object.values(uploadStates).filter((s) => s.status === 'error').length;
    const totalCount = files.length;

    return (
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {/* Summary Header */}
        {allDone && (
          <div
            className={`panel-beveled p-3 border ${
              errorCount > 0
                ? 'border-amber-700/40 bg-amber-900/10'
                : 'border-green-700/40 bg-green-900/10'
            }`}
          >
            <p className="text-xs font-semibold text-rmpg-200">
              {errorCount === 0
                ? `All ${totalCount} file${totalCount !== 1 ? 's' : ''} uploaded successfully.`
                : `${completedCount} of ${totalCount} uploaded. ${errorCount} failed.`}
            </p>
          </div>
        )}

        {/* File table */}
        <div className="space-y-1.5">
          {files.map((entry) => {
            const state = uploadStates[entry.id];
            const vehicle = vehicles.find((v) => String(v.id) === entry.vehicleId);
            const unit = units.find((u) => String(u.id) === entry.unitId);

            return (
              <div key={entry.id} className="panel-inset p-2 flex items-center gap-3">
                {/* Thumbnail */}
                <div className="w-14 h-9 flex-shrink-0 bg-surface-sunken overflow-hidden rounded-sm">
                  {entry.thumbnailUrl ? (
                    <img src={entry.thumbnailUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Film className="w-3 h-3 text-rmpg-600" />
                    </div>
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] text-rmpg-200 font-semibold truncate">{entry.title}</p>
                  <div className="flex items-center gap-2 text-[9px] text-rmpg-500">
                    {vehicle && <span>#{vehicle.vehicle_number}</span>}
                    {unit && <span className="text-brand-400 font-mono">{unit.call_sign}</span>}
                    <span className="capitalize">{entry.classification}</span>
                    <span>{formatSize(entry.file.size)}</span>
                  </div>

                  {/* Progress bar for uploading state */}
                  {state?.status === 'uploading' && (
                    <div className="mt-1 w-full h-1.5 bg-rmpg-700 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-brand-500 transition-all duration-300"
                        style={{ width: `${state.progress}%` }}
                      />
                    </div>
                  )}

                  {/* Error message */}
                  {state?.status === 'error' && (
                    <p className="text-[9px] text-red-400 mt-0.5">{state.error}</p>
                  )}
                </div>

                {/* Status indicator */}
                <div className="flex-shrink-0 w-8 flex items-center justify-center">
                  {!state || state.status === 'queued' ? (
                    <span className="text-[9px] text-rmpg-500 font-mono">QUEUE</span>
                  ) : state.status === 'uploading' ? (
                    <div className="flex items-center gap-1">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-brand-400" />
                      <span className="text-[9px] text-brand-400 font-mono font-bold">
                        {state.progress}%
                      </span>
                    </div>
                  ) : state.status === 'complete' ? (
                    <div className="w-5 h-5 rounded-full bg-green-500/20 border border-green-500/40 flex items-center justify-center">
                      <Check className="w-3 h-3 text-green-400" />
                    </div>
                  ) : (
                    <div className="w-5 h-5 rounded-full bg-red-500/20 border border-red-500/40 flex items-center justify-center">
                      <AlertCircle className="w-3 h-3 text-red-400" />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // ── Footer Buttons ────────────────────────

  const renderFooter = () => {
    if (step === 1) {
      return (
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-rmpg-700">
          <button type="button" onClick={handleClose} className="toolbar-btn text-xs px-4 py-1.5">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => setStep(2)}
            disabled={files.length === 0}
            className="toolbar-btn-primary text-xs px-4 py-1.5 flex items-center gap-1.5 disabled:opacity-40"
          >
            Next <ArrowRight className="w-3 h-3" />
          </button>
        </div>
      );
    }

    if (step === 2) {
      const allHaveTitles = files.every((f) => f.title.trim().length > 0);
      return (
        <div className="flex items-center justify-between px-4 py-3 border-t border-rmpg-700">
          <button
            type="button"
            onClick={() => setStep(1)}
            className="toolbar-btn text-xs px-4 py-1.5 flex items-center gap-1.5"
          >
            <ArrowLeft className="w-3 h-3" /> Back
          </button>
          <button
            type="button"
            onClick={() => setStep(3)}
            disabled={!allHaveTitles}
            className="toolbar-btn-primary text-xs px-4 py-1.5 flex items-center gap-1.5 disabled:opacity-40"
          >
            Next <ArrowRight className="w-3 h-3" />
          </button>
        </div>
      );
    }

    // Step 3
    return (
      <div className="flex items-center justify-between px-4 py-3 border-t border-rmpg-700">
        {!isUploading && !allDone && (
          <button
            type="button"
            onClick={() => setStep(2)}
            className="toolbar-btn text-xs px-4 py-1.5 flex items-center gap-1.5"
          >
            <ArrowLeft className="w-3 h-3" /> Back
          </button>
        )}
        {allDone && <div />}
        {isUploading && <div />}

        {allDone ? (
          <button
            type="button"
            onClick={handleCloseAfterUpload}
            className="toolbar-btn-primary text-xs px-4 py-1.5"
          >
            Close
          </button>
        ) : (
          <button
            type="button"
            onClick={startUploadAll}
            disabled={isUploading}
            className="toolbar-btn-primary text-xs px-4 py-1.5 flex items-center gap-1.5 disabled:opacity-40"
          >
            {isUploading ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin" /> Uploading...
              </>
            ) : (
              <>
                <Upload className="w-3 h-3" /> Upload All
              </>
            )}
          </button>
        )}
      </div>
    );
  };

  // ── Main Render ───────────────────────────

  return (
    <div
      className="fixed inset-0 bg-black/80 z-[9990] flex items-start justify-center overflow-y-auto"
      onClick={handleClose}
    >
      <div
        className="bg-surface-base panel-beveled max-w-3xl w-full mx-auto my-8 max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="panel-title-bar flex items-center justify-between px-4 py-2 flex-shrink-0">
          <div className="flex items-center gap-2">
            <Upload className="w-4 h-4 text-brand-400" />
            <h2 className="text-sm font-bold text-rmpg-100">Upload Dash Camera Videos</h2>
          </div>
          <button type="button"
            onClick={handleClose}
            disabled={isUploading}
            className="toolbar-btn p-1 disabled:opacity-30">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Step Indicator */}
        <div className="flex-shrink-0 border-b border-rmpg-700 bg-surface-sunken">
          {stepIndicator}
        </div>

        {/* Step Content */}
        {step === 1 && renderStep1()}
        {step === 2 && renderStep2()}
        {step === 3 && renderStep3()}

        {/* Footer */}
        {renderFooter()}
      </div>
    </div>
  );
}
