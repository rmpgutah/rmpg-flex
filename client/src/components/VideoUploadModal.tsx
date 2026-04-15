// ============================================================
// RMPG Flex — Body Camera Video Upload Modal
// Chunked upload for reliable large file transfers.
// Files are split into 10MB chunks, each uploaded independently
// with retry. Supports abort, speed display, and ETA.
// ============================================================

import React, { useState, useRef } from 'react';
import { Upload, X, Video, Loader2, XCircle, CheckCircle2, Zap, Radio } from 'lucide-react';
import type { BodyCamera, VideoClassification } from '../types';
import { chunkedVideoUpload, DEFAULT_CHUNK_SIZE } from '../utils/chunkedVideoUpload';

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

const ACTIVATION_TYPES: { value: string; label: string }[] = [
  { value: 'MANUAL', label: 'Manual' },
  { value: 'AUTOMATIC', label: 'Automatic' },
  { value: 'EMERGENCY', label: 'Emergency' },
  { value: 'PRE_EVENT', label: 'Pre-Event' },
  { value: 'POST_EVENT', label: 'Post-Event' },
];

type UploadPhase = 'idle' | 'initializing' | 'uploading' | 'finalizing' | 'done' | 'error';

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
  const [duration, setDuration] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Upload state
  const [phase, setPhase] = useState<UploadPhase>('idle');
  const [progress, setProgress] = useState(0);
  const [bytesUploaded, setBytesUploaded] = useState(0);
  const [speed, setSpeed] = useState(0); // bytes/sec
  const [eta, setEta] = useState(0); // seconds remaining
  const [chunkStatus, setChunkStatus] = useState('');
  const [error, setError] = useState('');
  // The shared chunkedVideoUpload util owns the in-flight XHRs, the upload
  // session id, and the abort DELETE — we only need an AbortController here
  // to fire when the user clicks Cancel.
  const abortControllerRef = useRef<AbortController | null>(null);

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
    setBytesUploaded(0);
    setSpeed(0);
    setEta(0);
    setChunkStatus('');
    setError('');
    setDuration(null);
    setPhase('idle');
    abortControllerRef.current = null;
  };

  const handleClose = () => {
    if (phase === 'uploading' || phase === 'initializing' || phase === 'finalizing') return;
    reset();
    onClose();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      setFile(f);
      setError('');
      setDuration(null);
      if (!title) setTitle(f.name.replace(/\.[^.]+$/, ''));
      const videoEl = document.createElement('video');
      videoEl.preload = 'metadata';
      videoEl.onloadedmetadata = () => {
        if (videoEl.duration && isFinite(videoEl.duration)) setDuration(Math.round(videoEl.duration));
        URL.revokeObjectURL(videoEl.src);
      };
      videoEl.onerror = () => URL.revokeObjectURL(videoEl.src);
      videoEl.src = URL.createObjectURL(f);
    }
  };

  const handleAbort = () => {
    abortControllerRef.current?.abort();
    setPhase('idle');
    setChunkStatus('Upload cancelled');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !title || !cameraId) {
      setError('File, title, and camera are required');
      return;
    }

    setError('');
    setProgress(0);
    setBytesUploaded(0);
    setSpeed(0);
    setEta(0);
    setPhase('initializing');
    setChunkStatus('Preparing upload...');

    const controller = new AbortController();
    abortControllerRef.current = controller;

    const selectedCamera = cameras.find(c => String(c.id) === cameraId);
    const resolvedOfficerId = selectedCamera?.officer_id || officerId;

    // The shared util handles the small-file (single-POST) vs chunked
    // branching internally at file.size ≥ 50 MB, runs 4 concurrent chunk
    // uploads by default (~2–4× faster on broadband), retries each chunk
    // up to 3× with backoff, and cancels all workers + fires the server
    // abort DELETE when `controller.abort()` is called.
    try {
      await chunkedVideoUpload({
        endpoint: '/personnel/bodycam-videos',
        file,
        headers: getAuthHeaders(),
        abortSignal: controller.signal,
        metadata: {
          title,
          camera_id: cameraId,
          officer_id: resolvedOfficerId,
          classification,
          duration_seconds: duration ?? undefined,
          recorded_at: recordedAt,
          case_number: caseNumber,
          notes,
        },
        onProgress: (p) => {
          setPhase(p.phase);
          setProgress(p.percent);
          setBytesUploaded(p.bytesUploaded);
          setSpeed(p.speed);
          setEta(p.eta);
          setChunkStatus(p.message);
        },
      });
      setPhase('done');
      setChunkStatus('Upload complete!');
      setTimeout(() => { reset(); onUploaded(); onClose(); }, 800);
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        // Already handled by handleAbort — keep UI in idle state.
        return;
      }
      setPhase('error');
      setError(err?.message || 'Upload failed');
    }
  };

  const formatSize = (bytes: number) => {
    if (!bytes) return '-';
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const formatSpeed = (bytesPerSec: number) => {
    if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(0)} KB/s`;
    return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
  };

  const formatEta = (seconds: number) => {
    if (seconds <= 0) return '--:--';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  };

  const formatDurationHMS = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const isUploading = phase === 'uploading' || phase === 'initializing' || phase === 'finalizing';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" role="dialog" aria-modal="true" onClick={handleClose}>
      <div className="bg-surface-base border border-rmpg-700 rounded-sm shadow-xl w-[520px] max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-rmpg-700 bg-surface-raised">
          <div className="flex items-center gap-2">
            <Upload className="w-4 h-4 text-brand-400" />
            <h2 className="text-sm font-bold text-rmpg-100">Upload Body Camera Video</h2>
          </div>
          <button type="button" onClick={handleClose} disabled={isUploading} className="toolbar-btn p-1" aria-label="Close" title="Close">
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
                    {file.size >= 50 * 1024 * 1024 && (
                      <span className="ml-1 text-brand-400">
                        &bull; Chunked upload ({Math.ceil(file.size / DEFAULT_CHUNK_SIZE)} parts, 4 parallel)
                      </span>
                    )}
                  </p>
                </div>
                {!isUploading && (
                  <button type="button" onClick={() => { setFile(null); if (fileRef.current) fileRef.current.value = ''; }} className="toolbar-btn p-1">
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="w-full py-6 border-2 border-dashed border-rmpg-600 rounded-sm hover:border-brand-500 transition-colors flex flex-col items-center gap-2"
              >
                <Upload className="w-6 h-6 text-rmpg-500" />
                <span className="text-xs text-rmpg-400">Click to select video</span>
                <span className="text-[9px] text-rmpg-600">MP4, MOV, AVI, WebM — Up to 10 GB</span>
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
              <input type="text" value={title} onChange={e => setTitle(e.target.value)} required placeholder="Video title" className="input-dark" disabled={isUploading} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="field-label">Camera <span className="text-red-400">*</span></label>
                <select value={cameraId} onChange={e => setCameraId(e.target.value)} required className="select-dark" disabled={isUploading}>
                  <option value="">Select camera...</option>
                  {cameras.map(c => <option key={c.id} value={c.id}>{c.camera_id} — {[c.make, c.model].filter(Boolean).join(' ') || 'Unknown'}</option>)}
                </select>
              </div>
              <div>
                <label className="field-label">Classification</label>
                <select value={classification} onChange={e => setClassification(e.target.value as VideoClassification)} className="select-dark" disabled={isUploading}>
                  {CLASSIFICATIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="field-label">Recorded Date</label>
                <input type="datetime-local" value={recordedAt} onChange={e => setRecordedAt(e.target.value)} className="input-dark" disabled={isUploading} />
              </div>
              <div>
                <label className="field-label">Case Number</label>
                <input type="text" value={caseNumber} onChange={e => setCaseNumber(e.target.value)} placeholder="e.g. 2026-0001" className="input-dark" disabled={isUploading} />
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
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Additional notes..." className="textarea-dark" disabled={isUploading} />
            </div>
          </div>

          {/* Upload Progress Panel */}
          {isUploading && (
            <div className="panel-inset p-3 space-y-2">
              {/* Phase & chunk status */}
              <div className="flex items-center justify-between">
                <span className="text-rmpg-400 text-[10px] flex items-center gap-1.5">
                  {phase === 'finalizing' ? (
                    <Zap className="w-3 h-3 text-amber-400 animate-pulse" />
                  ) : (
                    <Loader2 className="w-3 h-3 animate-spin text-brand-400" />
                  )}
                  {chunkStatus}
                </span>
                <span className="text-brand-400 font-mono font-bold text-xs">{progress}%</span>
              </div>

              {/* Progress bar */}
              <div className="w-full h-2.5 bg-surface-sunken rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${
                    phase === 'finalizing'
                      ? 'bg-gradient-to-r from-amber-600 to-amber-400 animate-pulse'
                      : 'bg-gradient-to-r from-brand-600 to-brand-400'
                  }`}
                  style={{ width: `${progress}%` }}
                />
              </div>

              {/* Speed / ETA / Bytes */}
              {phase === 'uploading' && (
                <div className="flex items-center justify-between text-[9px] font-mono text-rmpg-500">
                  <span>{formatSize(bytesUploaded)} / {file ? formatSize(file.size) : '-'}</span>
                  <span className="flex items-center gap-3">
                    <span>{formatSpeed(speed)}</span>
                    <span>ETA: {formatEta(eta)}</span>
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Upload complete indicator */}
          {phase === 'done' && (
            <div className="flex items-center gap-2 px-3 py-2 bg-green-900/20 border border-green-700/40 text-green-400 text-xs">
              <CheckCircle2 className="w-4 h-4" />
              Upload complete!
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-2">
            {isUploading ? (
              <button type="button" onClick={handleAbort}
                className="toolbar-btn text-xs px-4 py-1.5 flex items-center gap-1.5 text-red-400 hover:text-red-300 border-red-700/40 hover:border-red-600/60">
                <XCircle className="w-3 h-3" />
                Cancel Upload
              </button>
            ) : (
              <>
                <button type="button" onClick={handleClose} className="toolbar-btn text-xs px-4 py-1.5">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!file || !title || !cameraId || phase === 'done'}
                  className="toolbar-btn-primary text-xs px-4 py-1.5 flex items-center gap-1.5"
                >
                  <Upload className="w-3 h-3" />
                  {phase === 'error' ? 'Retry Upload' : 'Upload Video'}
                </button>
              </>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
