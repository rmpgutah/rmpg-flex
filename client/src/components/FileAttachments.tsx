import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Paperclip,
  Upload,
  Download,
  Trash2,
  FileText,
  Image,
  Film,
  Volume2,
  File,
  Loader2,
  X,
  Eye,
  ZoomIn,
  Clock,
  ArrowUp,
  ArrowDown,
  CheckCircle2,
  AlertCircle,
  XCircle,
} from 'lucide-react';
import {
  apiUploadFileWithProgress,
  apiDownloadFileWithProgress,
  apiFetchAttachments,
  apiDeleteAttachment,
  type UploadProgressInfo,
} from '../hooks/useApi';
import ConfirmDialog from './ConfirmDialog';

interface Attachment {
  id: number;
  file_id: string;
  original_name: string;
  mime_type: string;
  file_size: number;
  uploader_name?: string;
  created_at: string;
  access_sig?: string;
  access_exp?: number;
  access_nonce?: string;
}

interface FileAttachmentsProps {
  entityType: string;
  entityId: string | number;
  readOnly?: boolean;
  compact?: boolean;
}

// ── Per-file transfer tracking ──────────────────────────────
type TransferStatus = 'queued' | 'active' | 'complete' | 'error';
type TransferDirection = 'upload' | 'download';

interface TransferState {
  id: string;
  fileName: string;
  fileSize: number;
  direction: TransferDirection;
  status: TransferStatus;
  loaded: number;
  total: number;
  percent: number;
  speed: number;         // bytes/sec (rolling average)
  eta: number;           // seconds remaining
  error: string;
  startTime: number;
  abort: (() => void) | null;
}

// ── Helpers ─────────────────────────────────────────────────

const TOKEN_KEY = 'rmpg_token';

export function authUrl(path: string, sig?: string, exp?: number, nonce?: string): string {
  const separator = path.includes('?') ? '&' : '?';
  if (sig && exp) {
    const nonceParam = nonce ? `&nonce=${encodeURIComponent(nonce)}` : '';
    return `${path}${separator}sig=${encodeURIComponent(sig)}&exp=${exp}${nonceParam}`;
  }
  const token = localStorage.getItem(TOKEN_KEY) || '';
  return `${path}${separator}token=${encodeURIComponent(token)}`;
}

async function fetchFreshSignature(fileId: string): Promise<{ sig: string; exp: number; nonce?: string } | null> {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return null;
    const res = await fetch(`/api/uploads/sign/${fileId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      return { sig: data.sig, exp: data.exp, nonce: data.nonce };
    }
  } catch { /* silent */ }
  return null;
}

/** Format bytes into human-readable size with appropriate unit */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Format transfer progress: "125.50 MB / 4.20 GB" */
function formatProgress(loaded: number, total: number): string {
  return `${formatFileSize(loaded)} / ${formatFileSize(total)}`;
}

/** Format speed in human-readable: "12.5 MB/s" */
function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec <= 0) return '--';
  if (bytesPerSec < 1024) return `${bytesPerSec.toFixed(0)} B/s`;
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
  if (bytesPerSec < 1024 * 1024 * 1024) return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
  return `${(bytesPerSec / (1024 * 1024 * 1024)).toFixed(2)} GB/s`;
}

/** Format ETA: "2m 15s", "1h 3m", "< 1s" */
function formatEta(seconds: number): string {
  if (seconds <= 0 || !isFinite(seconds)) return '--';
  if (seconds < 1) return '< 1s';
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = Math.ceil(seconds % 60);
    return `${m}m ${s}s`;
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.ceil((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function getFileIcon(mime: string) {
  if (mime.startsWith('image/')) return Image;
  if (mime.startsWith('video/')) return Film;
  if (mime.startsWith('audio/')) return Volume2;
  if (mime === 'application/pdf') return FileText;
  return File;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

let _transferIdCounter = 0;
function nextTransferId(): string {
  return `xfer-${++_transferIdCounter}-${Date.now()}`;
}

// ── Progress Bar Sub-Component ──────────────────────────────

function TransferProgressItem({ t, onCancel }: { t: TransferState; onCancel: (id: string) => void }) {
  const isUpload = t.direction === 'upload';
  const DirIcon = isUpload ? ArrowUp : ArrowDown;
  const dirLabel = isUpload ? 'Uploading' : 'Downloading';

  const barColor = t.status === 'error' ? 'bg-red-500'
    : t.status === 'complete' ? 'bg-green-500'
    : isUpload ? 'bg-brand-500' : 'bg-blue-500';

  const statusColor = t.status === 'error' ? 'text-red-400'
    : t.status === 'complete' ? 'text-green-400'
    : 'text-rmpg-300';

  return (
    <div className="px-2 py-1.5 bg-rmpg-900/80 border border-rmpg-700 space-y-1">
      {/* Row 1: Icon + filename + status/cancel */}
      <div className="flex items-center gap-1.5">
        <DirIcon className={`w-3 h-3 flex-shrink-0 ${isUpload ? 'text-brand-400' : 'text-blue-400'}`} />
        <span className="text-[11px] text-gray-200 truncate flex-1">{t.fileName}</span>
        {t.status === 'active' && (
          <button
            onClick={() => onCancel(t.id)}
            className="p-0.5 hover:bg-rmpg-700 text-rmpg-400 hover:text-red-400 transition-colors"
            title="Cancel"
          >
            <XCircle className="w-3 h-3" />
          </button>
        )}
        {t.status === 'complete' && <CheckCircle2 className="w-3 h-3 text-green-400 flex-shrink-0" />}
        {t.status === 'error' && <AlertCircle className="w-3 h-3 text-red-400 flex-shrink-0" />}
      </div>

      {/* Row 2: Progress bar */}
      <div className="h-1.5 bg-rmpg-800 overflow-hidden">
        <div
          className={`h-full transition-all duration-300 ${barColor}`}
          style={{ width: `${t.percent}%` }}
        />
      </div>

      {/* Row 3: Stats line */}
      <div className={`flex items-center gap-2 text-[10px] ${statusColor} font-mono`}>
        {t.status === 'active' && (
          <>
            <span>{formatProgress(t.loaded, t.total)}</span>
            <span className="text-rmpg-500">|</span>
            <span>{t.percent}%</span>
            <span className="text-rmpg-500">|</span>
            <span>{formatSpeed(t.speed)}</span>
            <span className="text-rmpg-500">|</span>
            <span className="flex items-center gap-0.5">
              <Clock className="w-2.5 h-2.5" />
              {formatEta(t.eta)}
            </span>
          </>
        )}
        {t.status === 'queued' && (
          <span className="flex items-center gap-1">
            <Loader2 className="w-2.5 h-2.5 animate-spin" />
            Queued &middot; {formatFileSize(t.fileSize)}
          </span>
        )}
        {t.status === 'complete' && (
          <span>{dirLabel} complete &middot; {formatFileSize(t.total)}</span>
        )}
        {t.status === 'error' && (
          <span className="truncate">{t.error || `${dirLabel} failed`}</span>
        )}
      </div>
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────

export default function FileAttachments({
  entityType,
  entityId,
  readOnly = false,
  compact = false,
}: FileAttachmentsProps) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [previewAttachment, setPreviewAttachment] = useState<Attachment | null>(null);
  const [transfers, setTransfers] = useState<TransferState[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Track speed via rolling average
  const speedSamplesRef = useRef<Map<string, { loaded: number; time: number }[]>>(new Map());

  const hasActiveUploads = transfers.some((t) => t.direction === 'upload' && (t.status === 'active' || t.status === 'queued'));

  const fetchFiles = useCallback(async () => {
    try {
      setError(null);
      const data = await apiFetchAttachments(entityType, entityId);
      setAttachments(data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load attachments');
    } finally {
      setLoading(false);
    }
  }, [entityType, entityId]);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  // Clean up completed/errored transfers after 5 seconds
  useEffect(() => {
    const done = transfers.filter((t) => t.status === 'complete' || t.status === 'error');
    if (done.length === 0) return;
    const timer = setTimeout(() => {
      setTransfers((prev) => prev.filter((t) => t.status === 'active' || t.status === 'queued'));
      // Clean speed samples for finished transfers
      for (const t of done) {
        speedSamplesRef.current.delete(t.id);
      }
    }, 5000);
    return () => clearTimeout(timer);
  }, [transfers]);

  const updateTransfer = useCallback((id: string, patch: Partial<TransferState>) => {
    setTransfers((prev) => prev.map((t) => t.id === id ? { ...t, ...patch } : t));
  }, []);

  const cancelTransfer = useCallback((id: string) => {
    setTransfers((prev) => {
      const t = prev.find((x) => x.id === id);
      if (t?.abort) t.abort();
      return prev.map((x) => x.id === id ? { ...x, status: 'error' as const, error: 'Cancelled' } : x);
    });
  }, []);

  const computeSpeedAndEta = useCallback((transferId: string, loaded: number, total: number): { speed: number; eta: number } => {
    const now = performance.now();
    let samples = speedSamplesRef.current.get(transferId);
    if (!samples) {
      samples = [];
      speedSamplesRef.current.set(transferId, samples);
    }
    samples.push({ loaded, time: now });
    // Keep last 5 seconds of samples
    const cutoff = now - 5000;
    while (samples.length > 1 && samples[0].time < cutoff) samples.shift();

    if (samples.length < 2) return { speed: 0, eta: 0 };
    const oldest = samples[0];
    const elapsed = (now - oldest.time) / 1000;
    if (elapsed <= 0) return { speed: 0, eta: 0 };
    const speed = (loaded - oldest.loaded) / elapsed;
    const remaining = total - loaded;
    const eta = speed > 0 ? remaining / speed : 0;
    return { speed, eta };
  }, []);

  // ── Upload handler (per-file with progress) ──────────────
  const handleUpload = useCallback(async (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    if (fileArray.length === 0) return;
    setError(null);

    // Create transfer entries for all files
    const newTransfers: TransferState[] = fileArray.map((f) => ({
      id: nextTransferId(),
      fileName: f.name,
      fileSize: f.size,
      direction: 'upload' as const,
      status: 'queued' as const,
      loaded: 0,
      total: f.size,
      percent: 0,
      speed: 0,
      eta: 0,
      error: '',
      startTime: Date.now(),
      abort: null,
    }));

    setTransfers((prev) => [...prev, ...newTransfers]);

    // Upload sequentially (to avoid overwhelming the server)
    for (let i = 0; i < fileArray.length; i++) {
      const file = fileArray[i];
      const tid = newTransfers[i].id;

      updateTransfer(tid, { status: 'active', startTime: Date.now() });

      try {
        const { promise, abort } = apiUploadFileWithProgress(
          file,
          entityType,
          entityId,
          (info: UploadProgressInfo) => {
            const { speed, eta } = computeSpeedAndEta(tid, info.loaded, info.total);
            updateTransfer(tid, {
              loaded: info.loaded,
              total: info.total,
              percent: info.percent,
              speed,
              eta,
            });
          },
        );

        updateTransfer(tid, { abort });
        await promise;
        updateTransfer(tid, { status: 'complete', percent: 100, loaded: file.size, total: file.size });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Upload failed';
        updateTransfer(tid, { status: 'error', error: msg });
      }
    }

    // Refresh attachment list
    await fetchFiles();
  }, [entityType, entityId, fetchFiles, updateTransfer, computeSpeedAndEta]);

  // ── Download handler with progress ────────────────────────
  const handleDownloadWithProgress = useCallback((att: Attachment) => {
    const tid = nextTransferId();
    const url = authUrl(`/api/uploads/${att.file_id}/download`, att.access_sig, att.access_exp, att.access_nonce);

    const newTransfer: TransferState = {
      id: tid,
      fileName: att.original_name,
      fileSize: att.file_size,
      direction: 'download',
      status: 'active',
      loaded: 0,
      total: att.file_size,
      percent: 0,
      speed: 0,
      eta: 0,
      error: '',
      startTime: Date.now(),
      abort: null,
    };

    setTransfers((prev) => [...prev, newTransfer]);

    const { promise, abort } = apiDownloadFileWithProgress(
      url,
      att.original_name,
      (info: UploadProgressInfo) => {
        const { speed, eta } = computeSpeedAndEta(tid, info.loaded, info.total);
        updateTransfer(tid, {
          loaded: info.loaded,
          total: info.total,
          percent: info.percent,
          speed,
          eta,
        });
      },
    );

    updateTransfer(tid, { abort });

    promise
      .then(() => updateTransfer(tid, { status: 'complete', percent: 100, loaded: att.file_size }))
      .catch((err) => updateTransfer(tid, { status: 'error', error: err instanceof Error ? err.message : 'Download failed' }));
  }, [updateTransfer, computeSpeedAndEta]);

  const handleDelete = async (fileId: string) => {
    try {
      await apiDeleteAttachment(fileId);
      setAttachments((prev) => prev.filter((a) => a.file_id !== fileId));
      setDeleteTarget(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (readOnly) return;
    if (e.dataTransfer.files.length > 0) {
      handleUpload(e.dataTransfer.files);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!readOnly) setDragOver(true);
  };

  const handleDragLeave = () => setDragOver(false);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleUpload(e.target.files);
      e.target.value = '';
    }
  };

  const openPreview = (attachment: Attachment) => {
    if (attachment.mime_type.startsWith('image/') || attachment.mime_type === 'application/pdf') {
      setPreviewAttachment(attachment);
    } else {
      handleDownloadWithProgress(attachment);
    }
  };

  const imageAttachments = attachments.filter((a) => a.mime_type.startsWith('image/'));
  const otherAttachments = attachments.filter((a) => !a.mime_type.startsWith('image/'));

  if (compact && attachments.length === 0 && readOnly) {
    return null;
  }

  return (
    <div className="space-y-2">
      <label className="text-[10px] text-rmpg-400 uppercase font-semibold flex items-center gap-1">
        <Paperclip className="w-3 h-3" />
        Attachments ({attachments.length})
      </label>

      {error && (
        <div className="px-2 py-1 bg-red-900/40 border border-red-700/50 text-red-300 text-xs flex items-center justify-between">
          {error}
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-300">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* ── Active Transfers ── */}
      {transfers.length > 0 && (
        <div className="space-y-1">
          {transfers.map((t) => (
            <TransferProgressItem key={t.id} t={t} onCancel={cancelTransfer} />
          ))}
        </div>
      )}

      {/* Upload Zone */}
      {!readOnly && (
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => !hasActiveUploads && fileInputRef.current?.click()}
          className={`
            border-2 border-dashed transition-all p-3 text-center
            ${hasActiveUploads ? 'border-rmpg-700 opacity-50 cursor-not-allowed' :
              dragOver
                ? 'border-brand-500 bg-brand-900/20 cursor-pointer'
                : 'border-rmpg-600 hover:border-rmpg-400 hover:bg-rmpg-800/30 cursor-pointer'
            }
          `}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFileInput}
            accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,.mp4,.mov,.avi,.webm,.mkv,.mp3,.wav,.ogg"
          />
          {hasActiveUploads ? (
            <div className="flex items-center justify-center gap-2 text-brand-400 text-xs">
              <Loader2 className="w-4 h-4 animate-spin" />
              Upload in progress...
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center gap-1 text-rmpg-300 text-xs">
              <Upload className="w-5 h-5" />
              {dragOver ? 'Drop files here' : 'Click or drag files to upload'}
              <span className="text-[10px] text-rmpg-500">
                Supports photos, videos, documents up to 3 GB
              </span>
            </div>
          )}
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="flex items-center gap-2 text-xs text-rmpg-400 py-2">
          <Loader2 className="w-3 h-3 animate-spin" />
          Loading files...
        </div>
      ) : attachments.length > 0 ? (
        <div className="space-y-2">
          {/* ── Image Grid ── */}
          {imageAttachments.length > 0 && (
            <div className={`grid gap-2 ${imageAttachments.length === 1 ? 'grid-cols-1' : imageAttachments.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
              {imageAttachments.map((att) => (
                <div
                  key={att.file_id}
                  className="relative group bg-rmpg-900 border border-rmpg-700 hover:border-brand-500/50 transition-colors cursor-pointer overflow-hidden"
                  onClick={() => openPreview(att)}
                >
                  <img
                    src={authUrl(`/api/uploads/${att.file_id}/thumbnail`, att.access_sig, att.access_exp, att.access_nonce)}
                    alt={att.original_name}
                    className="w-full h-28 object-cover"
                    loading="lazy"
                    onError={async (e) => {
                      const target = e.target as HTMLImageElement;
                      if (!target.dataset.retried) {
                        target.dataset.retried = '1';
                        const fresh = await fetchFreshSignature(att.file_id);
                        if (fresh) {
                          target.src = authUrl(`/api/uploads/${att.file_id}/thumbnail`, fresh.sig, fresh.exp);
                          return;
                        }
                      }
                      target.style.display = 'none';
                      const fallback = target.nextElementSibling as HTMLElement;
                      if (fallback) fallback.style.display = 'flex';
                    }}
                  />
                  <div className="w-full h-28 items-center justify-center bg-rmpg-800" style={{ display: 'none' }}>
                    <Image className="w-8 h-8 text-rmpg-500" />
                  </div>
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all flex items-center justify-center">
                    <ZoomIn className="w-5 h-5 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-2 py-1">
                    <p className="text-[10px] text-rmpg-200 truncate">{att.original_name}</p>
                    <p className="text-[9px] text-rmpg-400">{formatFileSize(att.file_size)}</p>
                  </div>
                  {!readOnly && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setDeleteTarget({ id: att.file_id, name: att.original_name }); }}
                      className="absolute top-1 right-1 p-0.5 bg-black/60 hover:bg-red-900/80 text-rmpg-300 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                      title="Delete"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* ── Other Files List ── */}
          {otherAttachments.length > 0 && (
            <div className="space-y-1">
              {otherAttachments.map((att) => {
                const Icon = getFileIcon(att.mime_type);

                return (
                  <div
                    key={att.file_id}
                    className="flex items-center gap-2 px-2 py-1.5 bg-rmpg-900 border border-rmpg-700 hover:border-rmpg-600 transition-colors group"
                  >
                    <Icon className="w-4 h-4 flex-shrink-0 text-brand-400" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-gray-200 truncate">{att.original_name}</p>
                      <p className="text-[10px] text-rmpg-400">
                        {formatFileSize(att.file_size)}
                        {att.uploader_name && <> &middot; {att.uploader_name}</>}
                        {' '}&middot; {formatDate(att.created_at)}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {att.mime_type === 'application/pdf' && (
                        <button
                          onClick={() => openPreview(att)}
                          className="p-1 hover:bg-rmpg-700 text-rmpg-300 hover:text-brand-400 transition-colors"
                          title="Preview"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDownloadWithProgress(att); }}
                        className="p-1 hover:bg-rmpg-700 text-rmpg-300 hover:text-green-400 transition-colors"
                        title={`Download (${formatFileSize(att.file_size)})`}
                      >
                        <Download className="w-3.5 h-3.5" />
                      </button>
                      {!readOnly && (
                        <button
                          onClick={() => setDeleteTarget({ id: att.file_id, name: att.original_name })}
                          className="p-1 hover:bg-rmpg-700 text-rmpg-300 hover:text-red-400 transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        !readOnly && (
          <p className="text-[10px] text-rmpg-500 text-center py-1">No files attached</p>
        )
      )}

      {/* Preview Modal */}
      {previewAttachment && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-8"
          onClick={() => setPreviewAttachment(null)}
        >
          <div className="relative max-w-4xl max-h-full" onClick={(e) => e.stopPropagation()}>
            <div className="absolute -top-8 left-0 right-0 flex items-center justify-between">
              <span className="text-sm text-rmpg-200 truncate mr-4">
                {previewAttachment.original_name}
                <span className="text-rmpg-500 ml-2 text-xs">{formatFileSize(previewAttachment.file_size)}</span>
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleDownloadWithProgress(previewAttachment)}
                  className="p-1 hover:bg-rmpg-700 text-rmpg-300 hover:text-green-400 transition-colors"
                  title={`Download (${formatFileSize(previewAttachment.file_size)})`}
                >
                  <Download className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setPreviewAttachment(null)}
                  className="p-1 hover:bg-rmpg-700 text-rmpg-200 hover:text-white transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            {previewAttachment.mime_type === 'application/pdf' ? (
              <iframe
                src={authUrl(`/api/uploads/${previewAttachment.file_id}`, previewAttachment.access_sig, previewAttachment.access_exp, previewAttachment.access_nonce)}
                className="w-[800px] h-[600px] bg-white"
                title="PDF Preview"
              />
            ) : (
              <img
                src={authUrl(`/api/uploads/${previewAttachment.file_id}`, previewAttachment.access_sig, previewAttachment.access_exp, previewAttachment.access_nonce)}
                alt={previewAttachment.original_name}
                className="max-w-full max-h-[80vh] object-contain border border-rmpg-600"
              />
            )}
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && handleDelete(deleteTarget.id)}
        title="Delete File"
        message={`Delete "${deleteTarget?.name || 'this file'}"? This cannot be undone.`}
        confirmLabel="Delete"
        confirmVariant="danger"
      />
    </div>
  );
}
