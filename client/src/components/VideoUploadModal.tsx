// ============================================================
// RMPG Flex — Body Camera Video Upload Modal
// Chunked upload for reliable large file transfers.
// Files are split into 10MB chunks, each uploaded independently
// with retry. Supports abort, speed display, and ETA.
// ============================================================

import React, { useState, useRef } from 'react';
import { Upload, X, Video, Loader2, XCircle, CheckCircle2, Zap, Radio } from 'lucide-react';
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

const ACTIVATION_TYPES: { value: string; label: string }[] = [
  { value: 'MANUAL', label: 'Manual' },
  { value: 'AUTOMATIC', label: 'Automatic' },
  { value: 'EMERGENCY', label: 'Emergency' },
  { value: 'PRE_EVENT', label: 'Pre-Event' },
  { value: 'POST_EVENT', label: 'Post-Event' },
];

const CHUNK_SIZE = 10 * 1024 * 1024; // 10 MB chunks
const MAX_RETRIES = 3;

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
  const abortRef = useRef(false);
  const activeXhrRef = useRef<XMLHttpRequest | null>(null);
  const uploadIdRef = useRef<string | null>(null);

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
    abortRef.current = false;
    uploadIdRef.current = null;
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

  const apiFetchJson = async (url: string, opts: RequestInit = {}) => {
    const headers: Record<string, string> = { ...getAuthHeaders() };
    if (!(opts.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
    }
    const res = await fetch(`${apiBase}${url}`, { ...opts, headers: { ...headers, ...(opts.headers as Record<string, string> || {}) } });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `HTTP ${res.status}`);
    }
    return await res.json();
  };

  /** Upload a single chunk via XHR (for progress tracking per chunk) */
  const uploadChunk = (uploadId: string, chunkIndex: number, blob: Blob): Promise<void> => {
    return new Promise((resolve, reject) => {
      const formData = new FormData();
      formData.append('chunk', blob, `chunk_${chunkIndex}`);
      formData.append('uploadId', uploadId);
      formData.append('chunkIndex', String(chunkIndex));

      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${apiBase}/personnel/bodycam-videos/upload-chunk`);
      xhr.timeout = 120000; // 2 min per chunk

      const headers = getAuthHeaders();
      for (const [key, val] of Object.entries(headers)) xhr.setRequestHeader(key, val);

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else {
          try {
            const resp = JSON.parse(xhr.responseText);
            reject(new Error(resp.error || `Chunk ${chunkIndex} failed (HTTP ${xhr.status})`));
          } catch {
            reject(new Error(`Chunk ${chunkIndex} failed (HTTP ${xhr.status})`));
          }
        }
      };
      xhr.onerror = () => reject(new Error(`Network error on chunk ${chunkIndex}`));
      xhr.ontimeout = () => reject(new Error(`Chunk ${chunkIndex} timed out`));
      xhr.send(formData);
    });
  };

  const handleAbort = async () => {
    abortRef.current = true;
    if (activeXhrRef.current) { activeXhrRef.current.abort(); activeXhrRef.current = null; }
    setPhase('idle');
    setChunkStatus('Upload cancelled');
    if (uploadIdRef.current) {
      try {
        await fetch(`${apiBase}/personnel/bodycam-videos/upload-abort/${uploadIdRef.current}`, {
          method: 'DELETE',
          headers: getAuthHeaders(),
        });
      } catch { /* best effort cleanup */ }
    }
    uploadIdRef.current = null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !title || !cameraId) {
      setError('File, title, and camera are required');
      return;
    }

    abortRef.current = false;
    setError('');
    setProgress(0);
    setBytesUploaded(0);
    setSpeed(0);
    setEta(0);

    const selectedCamera = cameras.find(c => String(c.id) === cameraId);
    const resolvedOfficerId = selectedCamera?.officer_id || officerId;

    // For small files (< 50MB), use legacy single-file upload
    if (file.size < 50 * 1024 * 1024) {
      setPhase('uploading');
      setChunkStatus('Uploading file...');

      const formData = new FormData();
      formData.append('video', file);
      formData.append('title', title);
      formData.append('camera_id', cameraId);
      formData.append('officer_id', String(resolvedOfficerId));
      formData.append('classification', classification);
      if (duration != null) formData.append('duration_seconds', String(duration));
      if (recordedAt) formData.append('recorded_at', recordedAt);
      if (caseNumber) formData.append('case_number', caseNumber);
      if (notes) formData.append('notes', notes);

      const xhr = new XMLHttpRequest();
      activeXhrRef.current = xhr;
      xhr.open('POST', `${apiBase}/personnel/bodycam-videos`);
      xhr.timeout = 600000;
      const headers = getAuthHeaders();
      for (const [key, val] of Object.entries(headers)) xhr.setRequestHeader(key, val);

      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable) setProgress(Math.round((ev.loaded / ev.total) * 100));
      };
      xhr.onload = () => {
        activeXhrRef.current = null;
        if (xhr.status >= 200 && xhr.status < 300) {
          setPhase('done');
          setTimeout(() => { reset(); onUploaded(); onClose(); }, 500);
        } else {
          setPhase('error');
          try {
            const resp = JSON.parse(xhr.responseText);
            setError(resp.error || `Upload failed (HTTP ${xhr.status})`);
          } catch {
            setError(`Upload failed (HTTP ${xhr.status})`);
          }
        }
      };
      xhr.onerror = () => { activeXhrRef.current = null; setPhase('error'); setError('Network error — upload failed.'); };
      xhr.ontimeout = () => { activeXhrRef.current = null; setPhase('error'); setError('Upload timed out.'); };
      xhr.send(formData);
      return;
    }

    // ── Chunked upload for large files ──────────────────────────
    try {
      // Phase 1: Initialize
      setPhase('initializing');
      setChunkStatus('Initializing upload session...');

      const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
      const initData = await apiFetchJson('/personnel/bodycam-videos/upload-init', {
        method: 'POST',
        body: JSON.stringify({
          fileName: file.name,
          fileSize: file.size,
          totalChunks,
          mimeType: file.type || 'video/mp4',
        }),
      });

      const uploadId = initData.uploadId;
      uploadIdRef.current = uploadId;

      // Phase 2: Upload chunks
      setPhase('uploading');
      const startTime = Date.now();
      let totalSent = 0;

      for (let i = 0; i < totalChunks; i++) {
        if (abortRef.current) return;

        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);
        const blob = file.slice(start, end);

        setChunkStatus(`Uploading chunk ${i + 1} of ${totalChunks}...`);

        // Retry logic
        let lastErr: Error | null = null;
        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
          if (abortRef.current) return;
          try {
            await uploadChunk(uploadId, i, blob);
            lastErr = null;
            break;
          } catch (err: any) {
            lastErr = err;
            if (attempt < MAX_RETRIES - 1) {
              setChunkStatus(`Chunk ${i + 1} failed, retrying (${attempt + 2}/${MAX_RETRIES})...`);
              await new Promise(r => setTimeout(r, 1000 * (attempt + 1))); // backoff
            }
          }
        }

        if (lastErr) throw lastErr;

        totalSent += (end - start);
        setBytesUploaded(totalSent);
        setProgress(Math.round((totalSent / file.size) * 100));

        // Calculate speed and ETA
        const elapsed = (Date.now() - startTime) / 1000;
        const currentSpeed = elapsed > 0 ? totalSent / elapsed : 0;
        setSpeed(currentSpeed);
        const remaining = file.size - totalSent;
        setEta(currentSpeed > 0 ? Math.round(remaining / currentSpeed) : 0);
      }

      if (abortRef.current) return;

      // Phase 3: Finalize
      setPhase('finalizing');
      setChunkStatus('Assembling file on server...');

      await apiFetchJson('/personnel/bodycam-videos/upload-complete', {
        method: 'POST',
        body: JSON.stringify({
          uploadId,
          camera_id: cameraId,
          officer_id: resolvedOfficerId,
          title,
          duration_seconds: duration,
          recorded_at: recordedAt || undefined,
          case_number: caseNumber || undefined,
          classification,
          notes: notes || undefined,
        }),
      });

      setPhase('done');
      setChunkStatus('Upload complete!');
      setTimeout(() => { reset(); onUploaded(); onClose(); }, 800);

    } catch (err: any) {
      if (!abortRef.current) {
        setPhase('error');
        setError(err?.message || 'Upload failed');
      }
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={handleClose}>
      <div className="bg-surface-base border border-rmpg-700 rounded-lg shadow-xl w-[520px] max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-rmpg-700 bg-surface-raised">
          <div className="flex items-center gap-2">
            <Upload className="w-4 h-4 text-brand-400" />
            <h2 className="text-sm font-bold text-rmpg-100">Upload Body Camera Video</h2>
          </div>
          <button onClick={handleClose} disabled={isUploading} className="toolbar-btn p-1">
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
                        &bull; Chunked upload ({Math.ceil(file.size / CHUNK_SIZE)} parts)
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
                className="w-full py-6 border-2 border-dashed border-rmpg-600 rounded-lg hover:border-brand-500 transition-colors flex flex-col items-center gap-2"
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
