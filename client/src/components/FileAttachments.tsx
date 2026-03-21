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
} from 'lucide-react';
import {
  apiFetch,
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
  /** HMAC signature for session-independent file access (24h TTL) */
  access_sig?: string;
  /** Expiry timestamp (unix seconds) for access_sig */
  access_exp?: number;
  /** Nonce for HMAC signature uniqueness */
  access_nonce?: string;
}

interface FileAttachmentsProps {
  entityType: string;
  entityId: string | number;
  readOnly?: boolean;
  compact?: boolean;
}

const TOKEN_KEY = 'rmpg_token';

/**
 * Build an authenticated URL for img/iframe/download tags.
 *
 * Prefers HMAC-signed file access (`sig` + `exp`) which is session-independent
 * and lasts 24 hours.  Falls back to the JWT access token for backwards
 * compatibility (but this is what caused TOKEN_EXPIRED errors).
 */
export function authUrl(path: string, sig?: string, exp?: number, nonce?: string): string {
  const separator = path.includes('?') ? '&' : '?';

  // Prefer HMAC signature — session-independent, 24h TTL
  if (sig && exp) {
    const nonceParam = nonce ? `&nonce=${encodeURIComponent(nonce)}` : '';
    return `${path}${separator}sig=${encodeURIComponent(sig)}&exp=${exp}${nonceParam}`;
  }

  // Fallback to JWT token (short-lived, same session only)
  const token = localStorage.getItem(TOKEN_KEY) || '';
  return `${path}${separator}token=${encodeURIComponent(token)}`;
}

/**
 * Fetch a fresh HMAC signature from the server for a given file.
 * Used when an existing signature has expired (e.g. page open > 24h).
 */
async function fetchFreshSignature(fileId: string): Promise<{ sig: string; exp: number; nonce?: string } | null> {
  try {
    const data = await apiFetch<{ sig: string; exp: number; nonce?: string }>(`/uploads/sign/${fileId}`);
    return data;
  } catch { /* silent */ }
  return null;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatSpeed(bps: number): string {
  if (bps <= 0) return '--';
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(1)} KB/s`;
  return `${(bps / (1024 * 1024)).toFixed(1)} MB/s`;
}

function formatEta(sec: number): string {
  if (sec <= 0 || !isFinite(sec)) return '--';
  if (sec < 60) return `${Math.ceil(sec)}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${Math.ceil(sec % 60)}s`;
  return `${Math.floor(sec / 3600)}h ${Math.ceil((sec % 3600) / 60)}m`;
}

interface TransferState {
  id: string; name: string; size: number; dir: 'up' | 'down';
  status: 'active' | 'done' | 'error'; loaded: number; total: number;
  percent: number; speed: number; eta: number; error: string;
  abort: (() => void) | null; startTime: number;
}

let _xferId = 0;

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
  const speedRef = useRef<Map<string, { loaded: number; time: number }[]>>(new Map());
  const hasActiveUploads = transfers.some((t) => t.dir === 'up' && t.status === 'active');

  const updateXfer = useCallback((id: string, patch: Partial<TransferState>) => {
    setTransfers((prev) => prev.map((t) => t.id === id ? { ...t, ...patch } : t));
  }, []);

  const getSpeedEta = useCallback((id: string, loaded: number, total: number) => {
    const now = performance.now();
    let s = speedRef.current.get(id);
    if (!s) { s = []; speedRef.current.set(id, s); }
    s.push({ loaded, time: now });
    while (s.length > 1 && s[0].time < now - 5000) s.shift();
    if (s.length < 2) return { speed: 0, eta: 0 };
    const elapsed = (now - s[0].time) / 1000;
    const speed = elapsed > 0 ? (loaded - s[0].loaded) / elapsed : 0;
    return { speed, eta: speed > 0 ? (total - loaded) / speed : 0 };
  }, []);

  // Auto-clear finished transfers after 5s
  useEffect(() => {
    const done = transfers.filter((t) => t.status === 'done' || t.status === 'error');
    if (!done.length) return;
    const timer = setTimeout(() => {
      setTransfers((prev) => prev.filter((t) => t.status === 'active'));
      done.forEach((t) => speedRef.current.delete(t.id));
    }, 5000);
    return () => clearTimeout(timer);
  }, [transfers]);

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

  const handleUpload = async (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    if (fileArray.length === 0) return;
    setError(null);

    const newXfers: TransferState[] = fileArray.map((f) => ({
      id: `xfer-${++_xferId}`, name: f.name, size: f.size, dir: 'up' as const,
      status: 'active' as const, loaded: 0, total: f.size, percent: 0,
      speed: 0, eta: 0, error: '', abort: null, startTime: Date.now(),
    }));
    setTransfers((prev) => [...prev, ...newXfers]);

    for (let i = 0; i < fileArray.length; i++) {
      const file = fileArray[i];
      const tid = newXfers[i].id;
      try {
        const { promise, abort } = apiUploadFileWithProgress(file, entityType, entityId, (info: UploadProgressInfo) => {
          const { speed, eta } = getSpeedEta(tid, info.loaded, info.total);
          updateXfer(tid, { loaded: info.loaded, total: info.total, percent: info.percent, speed, eta });
        });
        updateXfer(tid, { abort });
        await promise;
        updateXfer(tid, { status: 'done', percent: 100, loaded: file.size });
      } catch (err) {
        updateXfer(tid, { status: 'error', error: err instanceof Error ? err.message : 'Upload failed' });
      }
    }
    await fetchFiles();
  };

  const handleDownloadWithProgress = useCallback((att: Attachment) => {
    const tid = `xfer-${++_xferId}`;
    const url = authUrl(`/api/uploads/${att.file_id}/download`, att.access_sig, att.access_exp, att.access_nonce);
    setTransfers((prev) => [...prev, {
      id: tid, name: att.original_name, size: att.file_size, dir: 'down' as const,
      status: 'active' as const, loaded: 0, total: att.file_size, percent: 0,
      speed: 0, eta: 0, error: '', abort: null, startTime: Date.now(),
    }]);
    const { promise, abort } = apiDownloadFileWithProgress(url, att.original_name, (info: UploadProgressInfo) => {
      const { speed, eta } = getSpeedEta(tid, info.loaded, info.total);
      updateXfer(tid, { loaded: info.loaded, total: info.total, percent: info.percent, speed, eta });
    });
    updateXfer(tid, { abort });
    promise
      .then(() => updateXfer(tid, { status: 'done', percent: 100, loaded: att.file_size }))
      .catch((err) => updateXfer(tid, { status: 'error', error: err instanceof Error ? err.message : 'Download failed' }));
  }, [updateXfer, getSpeedEta]);

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

  // Separate images from other files
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
            <div key={t.id} className="px-2 py-1.5 bg-rmpg-900/80 border border-rmpg-700 space-y-1">
              <div className="flex items-center gap-1.5">
                <span className={`text-[10px] ${t.dir === 'up' ? 'text-brand-400' : 'text-blue-400'}`}>{t.dir === 'up' ? '\u2191' : '\u2193'}</span>
                <span className="text-[11px] text-gray-200 truncate flex-1">{t.name}</span>
                {t.status === 'active' && t.abort && (
                  <button onClick={() => { t.abort?.(); updateXfer(t.id, { status: 'error', error: 'Cancelled' }); }}
                    className="p-0.5 hover:bg-rmpg-700 text-rmpg-400 hover:text-red-400"><X className="w-3 h-3" /></button>
                )}
                {t.status === 'done' && <span className="text-green-400 text-[10px]">Done</span>}
                {t.status === 'error' && <span className="text-red-400 text-[10px]">Failed</span>}
              </div>
              <div className="h-1.5 bg-rmpg-800 overflow-hidden">
                <div className={`h-full transition-all duration-300 ${t.status === 'error' ? 'bg-red-500' : t.status === 'done' ? 'bg-green-500' : t.dir === 'up' ? 'bg-brand-500' : 'bg-blue-500'}`}
                  style={{ width: `${t.percent}%` }} />
              </div>
              {t.status === 'active' && (
                <div className="flex items-center gap-2 text-[10px] text-rmpg-300 font-mono">
                  <span>{formatFileSize(t.loaded)} / {formatFileSize(t.total)}</span>
                  <span className="text-rmpg-500">|</span>
                  <span>{t.percent}%</span>
                  <span className="text-rmpg-500">|</span>
                  <span>{formatSpeed(t.speed)}</span>
                  <span className="text-rmpg-500">|</span>
                  <span>{formatEta(t.eta)}</span>
                </div>
              )}
              {t.status === 'error' && t.error && (
                <p className="text-[10px] text-red-400 truncate">{t.error}</p>
              )}
            </div>
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
              dragOver ? 'border-brand-500 bg-brand-900/20 cursor-pointer'
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
              <span className="text-[10px] text-rmpg-500">Photos, videos, documents up to 3 GB</span>
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
                      // Try once with a fresh signature before giving up
                      if (!target.dataset.retried) {
                        target.dataset.retried = '1';
                        const fresh = await fetchFreshSignature(att.file_id);
                        if (fresh) {
                          target.src = authUrl(`/api/uploads/${att.file_id}/thumbnail`, fresh.sig, fresh.exp);
                          return;
                        }
                      }
                      // Hide broken image, show icon instead
                      target.style.display = 'none';
                      const fallback = target.nextElementSibling as HTMLElement;
                      if (fallback) fallback.style.display = 'flex';
                    }}
                  />
                  {/* Fallback icon (hidden by default) */}
                  <div className="w-full h-28 items-center justify-center bg-rmpg-800" style={{ display: 'none' }}>
                    <Image className="w-8 h-8 text-rmpg-500" />
                  </div>
                  {/* Overlay */}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all flex items-center justify-center">
                    <ZoomIn className="w-5 h-5 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                  {/* Image name */}
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-2 py-1">
                    <p className="text-[10px] text-rmpg-200 truncate">{att.original_name}</p>
                  </div>
                  {/* Delete button */}
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
              <span className="text-sm text-rmpg-200 truncate mr-4">{previewAttachment.original_name}</span>
              <div className="flex items-center gap-2">
                <a
                  href={authUrl(`/api/uploads/${previewAttachment.file_id}/download`, previewAttachment.access_sig, previewAttachment.access_exp, previewAttachment.access_nonce)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1 hover:bg-rmpg-700 text-rmpg-300 hover:text-green-400 transition-colors"
                  title="Download"
                >
                  <Download className="w-4 h-4" />
                </a>
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
