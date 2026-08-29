// ============================================================
// RMPG Flex — Digital Evidence Page
// Rocky Mountain Protective Group
// Manage screenshots, videos, audio, and body-cam/dashcam clips
// attached to calls and cases.
// ============================================================

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  FileVideo,
  Image,
  Mic,
  Monitor,
  Upload,
  Download,
  Eye,
  Shield,
  Unlock,
  Link2,
  Loader2,
  AlertTriangle,
  X,
  ChevronRight,
  Search,
  Play,
} from 'lucide-react';
import PanelTitleBar from '../components/PanelTitleBar';
import { apiFetch, apiPostForm, authedImageUrl } from '../hooks/useApi';
import { officerFacingFileError } from '../utils/officerFacingFileError';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/ToastProvider';
import { parseTimestamp } from '../utils/dateUtils';
import { useSlashFocus } from '../hooks/useSlashFocus';
import { digitalEvidenceToCsv, downloadTextFile } from '../utils/rmsListExport';

// ─── Types ───────────────────────────────────────────────────

type EvidenceStatus = 'pending_review' | 'reviewed' | 'released' | 'sealed';
type EvidenceType = 'photo' | 'video' | 'audio' | 'screenshot';
type FilterType = 'all' | EvidenceType;

interface DigitalEvidenceItem {
  id: number;
  filename: string;
  original_filename?: string;
  evidence_type: EvidenceType;
  mime_type?: string;
  file_size?: number;
  status: EvidenceStatus;
  case_id?: number | null;
  call_id?: number | null;
  case_number?: string | null;
  call_number?: string | null;
  officer_id?: number | null;
  officer_name?: string | null;
  uploaded_by?: number | null;
  uploaded_by_name?: string | null;
  created_at: string;
  updated_at?: string;
  url?: string;
  thumbnail_url?: string;
  description?: string;
}

interface CustodyEntry {
  id: number;
  evidence_id: number;
  action: string;
  actor_name?: string;
  actor_id?: number;
  timestamp: string;
  notes?: string;
}

// ─── Helpers ─────────────────────────────────────────────────

function digitalEvidenceFilePath(item: Pick<DigitalEvidenceItem, 'id' | 'url'>): string {
  return item.url && item.url.includes(`/digital/${item.id}/file`)
    ? item.url
    : `/api/evidence/digital/${item.id}/file`;
}

function formatBytes(bytes?: number): string {
  if (!bytes || bytes === 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatDate(ts?: string): string {
  if (!ts) return '—';
  try {
    return parseTimestamp(ts).toLocaleString('en-US', {
      timeZone: 'America/Denver',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return ts;
  }
}

const TYPE_ICONS: Record<EvidenceType, React.ElementType> = {
  photo: Image,
  video: FileVideo,
  audio: Mic,
  screenshot: Monitor,
};

const TYPE_LABELS: Record<EvidenceType, string> = {
  photo: 'Photo',
  video: 'Video',
  audio: 'Audio',
  screenshot: 'Screenshot',
};

const STATUS_STYLES: Record<EvidenceStatus, string> = {
  pending_review: 'bg-[color:var(--sev-warn)] text-[color:var(--text-primary)]',
  reviewed: 'bg-[color:var(--sev-ok)] text-[color:var(--text-primary)]',
  released: 'bg-[color:var(--sev-ok)] text-[color:var(--text-primary)]',
  sealed: 'bg-[color:var(--sev-critical)] text-[color:var(--text-primary)]',
};

const STATUS_LABELS: Record<EvidenceStatus, string> = {
  pending_review: 'Pending Review',
  reviewed: 'Reviewed',
  released: 'Released',
  sealed: 'Sealed',
};

// Detect media type from mime or filename
function detectType(item: Partial<DigitalEvidenceItem>): EvidenceType {
  if (item.evidence_type) return item.evidence_type;
  const mime = item.mime_type ?? '';
  if (mime.startsWith('image/')) return 'photo';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  const ext = (item.filename ?? '').split('.').pop()?.toLowerCase() ?? '';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'bmp'].includes(ext)) return 'photo';
  if (['mp4', 'mov', 'avi', 'mkv', 'webm', 'ts'].includes(ext)) return 'video';
  if (['mp3', 'wav', 'ogg', 'm4a', 'aac'].includes(ext)) return 'audio';
  return 'screenshot';
}

// ─── Sub-components ──────────────────────────────────────────

function TypeBadge({ type }: { type: EvidenceType }) {
  const Icon = TYPE_ICONS[type];
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-wide rounded-[2px]"
      style={{ background: 'var(--surface-sunken)', color: 'var(--brand-300)' }}
    >
      <Icon size={10} />
      {TYPE_LABELS[type]}
    </span>
  );
}

function StatusBadge({ status }: { status: EvidenceStatus }) {
  return (
    <span
      className={`inline-block px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-wide rounded-[2px] ${STATUS_STYLES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

// ─── Preview Modal ────────────────────────────────────────────

interface PreviewModalProps {
  item: DigitalEvidenceItem;
  onClose: () => void;
  onDownload: (item: DigitalEvidenceItem) => void;
  onChainOfCustody: (item: DigitalEvidenceItem) => void;
  canAdmin: boolean;
  onSeal: (item: DigitalEvidenceItem) => void;
  onRelease: (item: DigitalEvidenceItem) => void;
}

function PreviewModal({
  item,
  onClose,
  onDownload,
  onChainOfCustody,
  canAdmin,
  onSeal,
  onRelease,
}: PreviewModalProps) {
  const type = detectType(item);
  const mediaUrl = authedImageUrl(digitalEvidenceFilePath(item));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0 0 0 / 0.82)' }}
      onClick={onClose}
    >
      <div
        className="relative flex flex-col rounded-[2px] shadow-2xl overflow-hidden"
        style={{ background: 'var(--surface-raised)', maxWidth: '90vw', maxHeight: '90vh', minWidth: 360 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-3 py-2 shrink-0"
          style={{ background: 'var(--surface-sunken)', borderBottom: '1px solid var(--border-subtle)' }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <TypeBadge type={type} />
            <span className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>
              {item.original_filename ?? item.filename}
            </span>
          </div>
          <button type="button"
            onClick={onClose}
            className="shrink-0 p-1 rounded-[2px] hover:bg-[color:var(--surface-base)]"
            aria-label="Close preview"
          >
            <X size={14} style={{ color: 'var(--text-secondary)' }} />
          </button>
        </div>

        {/* Media area */}
        <div
          className="flex items-center justify-center overflow-auto"
          style={{ maxHeight: 'calc(90vh - 120px)', background: 'var(--surface-deep)' }}
        >
          {type === 'photo' || type === 'screenshot' ? (
            <img
              src={mediaUrl}
              alt={item.original_filename ?? item.filename}
              style={{ maxWidth: '100%', maxHeight: '70vh', objectFit: 'contain', display: 'block' }}
            />
          ) : type === 'video' ? (
            <video
              controls
              src={mediaUrl}
              style={{ maxWidth: '80vw', maxHeight: '70vh' }}
            />
          ) : (
            <div className="p-8 flex flex-col items-center gap-3">
              <Mic size={40} style={{ color: 'var(--brand-400)' }} />
              <audio controls src={mediaUrl} style={{ width: 320 }} />
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div
          className="flex items-center gap-2 px-3 py-2 shrink-0 flex-wrap"
          style={{ borderTop: '1px solid var(--border-subtle)', background: 'var(--surface-sunken)' }}
        >
          <span className="text-[10px] mr-auto" style={{ color: 'var(--text-secondary)' }}>
            {formatBytes(item.file_size)} · {formatDate(item.created_at)}
          </span>
          <button type="button"
            onClick={() => onChainOfCustody(item)}
            className="flex items-center gap-1 px-2 py-[3px] text-[11px] rounded-[2px] hover:bg-[color:var(--surface-base)]"
            style={{ border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}
          >
            <Link2 size={11} /> Chain of Custody
          </button>
          {canAdmin && item.status !== 'sealed' && (
            <button type="button"
              onClick={() => onSeal(item)}
              className="flex items-center gap-1 px-2 py-[3px] text-[11px] rounded-[2px] hover:bg-[color:var(--surface-base)]"
              style={{ border: '1px solid var(--border-subtle)', color: 'var(--sev-critical)' }}
            >
              <Shield size={11} /> Seal
            </button>
          )}
          {canAdmin && item.status === 'sealed' && (
            <button type="button"
              onClick={() => onRelease(item)}
              className="flex items-center gap-1 px-2 py-[3px] text-[11px] rounded-[2px] hover:bg-[color:var(--surface-base)]"
              style={{ border: '1px solid var(--border-subtle)', color: 'var(--sev-ok)' }}
            >
              <Unlock size={11} /> Release
            </button>
          )}
          <button type="button"
            onClick={() => onDownload(item)}
            className="flex items-center gap-1 px-2 py-[3px] text-[11px] rounded-[2px]"
            style={{ background: 'var(--brand-700)', color: 'var(--text-primary)', border: 'none' }}
          >
            <Download size={11} /> Download
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Chain of Custody Modal ───────────────────────────────────

interface CustodyModalProps {
  item: DigitalEvidenceItem;
  onClose: () => void;
}

function CustodyModal({ item, onClose }: CustodyModalProps) {
  const [entries, setEntries] = useState<CustodyEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<CustodyEntry[]>(`/evidence/digital/${item.id}/custody`)
      .then(setEntries)
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }, [item.id]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0 0 0 / 0.75)' }}
      onClick={onClose}
    >
      <div
        className="rounded-[2px] shadow-2xl overflow-hidden flex flex-col"
        style={{ background: 'var(--surface-raised)', width: 480, maxHeight: '80vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-3 py-2 shrink-0"
          style={{ background: 'var(--surface-sunken)', borderBottom: '1px solid var(--border-subtle)' }}
        >
          <span className="text-xs font-semibold" style={{ color: 'var(--panel-header-color)' }}>
            Chain of Custody — {item.original_filename ?? item.filename}
          </span>
          <button type="button" onClick={onClose} className="p-1" aria-label="Close">
            <X size={13} style={{ color: 'var(--text-secondary)' }} />
          </button>
        </div>
        <div className="overflow-y-auto flex-1 p-3">
          {loading ? (
            <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
              <Loader2 size={13} className="animate-spin" /> Loading...
            </div>
          ) : entries.length === 0 ? (
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>No custody log entries found.</p>
          ) : (
            <ol className="relative" style={{ borderLeft: '2px solid var(--border-subtle)', paddingLeft: 16 }}>
              {entries.map((e) => (
                <li key={e.id} className="mb-3 relative">
                  <span
                    className="absolute -left-[21px] top-0.5 w-2.5 h-2.5 rounded-full border-2"
                    style={{ background: 'var(--brand-600)', borderColor: 'var(--brand-400)' }}
                  />
                  <p className="text-[11px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {e.action}
                    {e.actor_name ? ` — ${e.actor_name}` : ''}
                  </p>
                  <p className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>{formatDate(e.timestamp)}</p>
                  {e.notes && (
                    <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-secondary)' }}>{e.notes}</p>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Upload Modal ─────────────────────────────────────────────

interface UploadModalProps {
  onClose: () => void;
  onUploaded: () => void;
}

function UploadModal({ onClose, onUploaded }: UploadModalProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [caseId, setCaseId] = useState('');
  const [callId, setCallId] = useState('');
  const [description, setDescription] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = Array.from(e.dataTransfer.files);
    if (dropped.length > 0) setFiles((prev) => [...prev, ...dropped]);
  }, []);

  const handleBrowse = useCallback(() => {
    const el = document.createElement('input');
    el.type = 'file';
    el.multiple = true;
    el.accept = 'image/*,video/*,audio/*';
    el.onchange = () => {
      const selected = Array.from(el.files ?? []);
      if (selected.length > 0) setFiles((prev) => [...prev, ...selected]);
    };
    el.click();
  }, []);

  const handleElectronBrowse = useCallback(() => {
    const electron = (window as any).electron;
    if (electron?.openFileDialog) {
      electron.openFileDialog({ types: ['image', 'video', 'audio'] }).then((paths: string[]) => {
        // In Electron, paths are local file paths; convert to File objects via fetch
        // For simplicity, fall back to the standard file input if the bridge
        // doesn't return File objects directly.
        if (!paths || paths.length === 0) return;
        handleBrowse();
      }).catch(() => handleBrowse());
    } else {
      handleBrowse();
    }
  }, [handleBrowse]);

  const removeFile = (idx: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = async () => {
    if (files.length === 0) { setError('Select at least one file.'); return; }
    setUploading(true);
    setError(null);
    try {
      for (const file of files) {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('filename', file.name);
        fd.append('evidence_type', deriveType(file));
        if (caseId.trim()) fd.append('case_id', caseId.trim());
        if (callId.trim()) fd.append('call_id', callId.trim());
        if (description.trim()) fd.append('description', description.trim());
        await apiPostForm('/evidence/digital', fd);
      }
      onUploaded();
      onClose();
    } catch (err: unknown) {
      setError(officerFacingFileError(err, 'Upload failed'));
    } finally {
      setUploading(false);
    }
  };

  function deriveType(file: File): EvidenceType {
    if (file.type.startsWith('image/')) return 'photo';
    if (file.type.startsWith('video/')) return 'video';
    if (file.type.startsWith('audio/')) return 'audio';
    return 'screenshot';
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0 0 0 / 0.75)' }}
      onClick={onClose}
    >
      <div
        className="rounded-[2px] shadow-2xl overflow-hidden flex flex-col"
        style={{ background: 'var(--surface-raised)', width: 500, maxHeight: '90vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-3 py-2 shrink-0"
          style={{ background: 'var(--surface-sunken)', borderBottom: '1px solid var(--border-subtle)' }}
        >
          <span className="text-xs font-semibold" style={{ color: 'var(--panel-header-color)' }}>
            Upload Digital Evidence
          </span>
          <button type="button" onClick={onClose} className="p-1" aria-label="Close">
            <X size={13} style={{ color: 'var(--text-secondary)' }} />
          </button>
        </div>
        <div className="overflow-y-auto flex-1 p-3 space-y-3">
          {/* Drop zone */}
          <div
            className="flex flex-col items-center justify-center gap-2 py-6 border-2 border-dashed rounded-[2px] cursor-pointer transition-colors"
            style={{
              borderColor: dragOver ? 'var(--brand-400)' : 'var(--border-subtle)',
              background: dragOver ? 'var(--surface-sunken)' : 'transparent',
            }}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={handleElectronBrowse}
          >
            <Upload size={24} style={{ color: 'var(--brand-400)' }} />
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              Drag files here or <span style={{ color: 'var(--brand-300)' }}>click to browse</span>
            </p>
            <p className="text-[10px]" style={{ color: 'var(--text-tertiary, var(--text-secondary))' }}>
              Photos, videos, audio recordings accepted
            </p>
          </div>
          {files.length > 0 && (
            <ul className="space-y-1">
              {files.map((f, i) => (
                <li
                  key={i}
                  className="flex items-center justify-between px-2 py-[3px] rounded-[2px] text-[11px]"
                  style={{ background: 'var(--surface-sunken)', color: 'var(--text-primary)' }}
                >
                  <span className="truncate mr-2">{f.name}</span>
                  <span className="shrink-0 mr-2" style={{ color: 'var(--text-secondary)' }}>{formatBytes(f.size)}</span>
                  <button type="button"
                    onClick={(e) => { e.stopPropagation(); removeFile(i); }}
                    className="shrink-0"
                    aria-label="Remove file"
                  >
                    <X size={11} style={{ color: 'var(--text-secondary)' }} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] font-semibold mb-0.5" style={{ color: 'var(--field-label-color)' }}>
                Case ID (optional)
              </label>
              <input
                type="text"
                value={caseId}
                onChange={(e) => setCaseId(e.target.value)}
                className="w-full px-2 py-[3px] text-xs rounded-[2px]"
                style={{ background: 'var(--surface-sunken)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}
                placeholder="e.g. 2026-0042"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold mb-0.5" style={{ color: 'var(--field-label-color)' }}>
                Call ID (optional)
              </label>
              <input
                type="text"
                value={callId}
                onChange={(e) => setCallId(e.target.value)}
                className="w-full px-2 py-[3px] text-xs rounded-[2px]"
                style={{ background: 'var(--surface-sunken)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}
                placeholder="e.g. 10421"
              />
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-semibold mb-0.5" style={{ color: 'var(--field-label-color)' }}>
              Description (optional)
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-2 py-[3px] text-xs rounded-[2px]"
              style={{ background: 'var(--surface-sunken)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}
              placeholder="Brief description of this evidence"
            />
          </div>
          {error && (
            <p className="text-[11px] flex items-center gap-1" style={{ color: 'var(--sev-critical)' }}>
              <AlertTriangle size={11} /> {error}
            </p>
          )}
        </div>
        <div
          className="flex justify-end gap-2 px-3 py-2 shrink-0"
          style={{ borderTop: '1px solid var(--border-subtle)', background: 'var(--surface-sunken)' }}
        >
          <button type="button"
            onClick={onClose}
            className="px-3 py-[3px] text-xs rounded-[2px]"
            style={{ border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}
            disabled={uploading}
          >
            Cancel
          </button>
          <button type="button"
            onClick={handleSubmit}
            disabled={uploading || files.length === 0}
            className="flex items-center gap-1 px-3 py-[3px] text-xs rounded-[2px]"
            style={{ background: 'var(--brand-700)', color: 'var(--text-primary)', opacity: uploading || files.length === 0 ? 0.55 : 1 }}
          >
            {uploading ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
            {uploading ? 'Uploading…' : `Upload ${files.length > 0 ? `(${files.length})` : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────

const FILTER_TABS: { id: FilterType; label: string; icon: React.ElementType }[] = [
  { id: 'all', label: 'All', icon: FileVideo },
  { id: 'photo', label: 'Photos', icon: Image },
  { id: 'video', label: 'Videos', icon: Play },
  { id: 'audio', label: 'Audio', icon: Mic },
  { id: 'screenshot', label: 'Screenshots', icon: Monitor },
];

export default function DigitalEvidencePage() {
  const { user } = useAuth();
  const { addToast } = useToast();
  const canAdmin = user?.role === 'admin' || user?.role === 'manager';

  const [items, setItems] = useState<DigitalEvidenceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterType>('all');
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  useSlashFocus(searchRef);
  const [previewItem, setPreviewItem] = useState<DigitalEvidenceItem | null>(null);
  const [custodyItem, setCustodyItem] = useState<DigitalEvidenceItem | null>(null);
  const [showUpload, setShowUpload] = useState(false);

  // ─── Fetch ─────────────────────────────────────────────────

  const fetchItems = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ limit: '200' });
      if (filter !== 'all') qs.set('type', filter);
      const data = await apiFetch<DigitalEvidenceItem[] | { items?: DigitalEvidenceItem[]; results?: DigitalEvidenceItem[] }>(
        `/evidence/digital?${qs}`,
      );
      // Normalize response shape
      if (Array.isArray(data)) {
        setItems(data);
      } else if (data && Array.isArray((data as any).items)) {
        setItems((data as any).items);
      } else if (data && Array.isArray((data as any).results)) {
        setItems((data as any).results);
      } else {
        setItems([]);
      }
    } catch (err: any) {
      setError(err.message ?? 'Failed to load evidence');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  // ─── Actions ────────────────────────────────────────────────

  const handleDownload = useCallback((item: DigitalEvidenceItem) => {
    const electron = (window as any).electron;
    const fileUrl = digitalEvidenceFilePath(item);
    const authed = authedImageUrl(fileUrl);
    if (electron?.downloadFile) {
      electron.downloadFile(authed, item.original_filename ?? item.filename);
    } else {
      const a = document.createElement('a');
      a.href = authed;
      a.download = item.original_filename ?? item.filename;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.click();
    }
  }, []);

  const handleSeal = useCallback(async (item: DigitalEvidenceItem) => {
    try {
      await apiFetch(`/evidence/digital/${item.id}/seal`, { method: 'POST' });
      addToast(`Evidence sealed: ${item.original_filename ?? item.filename}`, 'success');
      setPreviewItem(null);
      fetchItems();
    } catch (err: any) {
      addToast(err.message ?? 'Failed to seal evidence', 'error');
    }
  }, [addToast, fetchItems]);

  const handleRelease = useCallback(async (item: DigitalEvidenceItem) => {
    try {
      await apiFetch(`/evidence/digital/${item.id}/release`, { method: 'POST' });
      addToast(`Evidence released: ${item.original_filename ?? item.filename}`, 'success');
      setPreviewItem(null);
      fetchItems();
    } catch (err: any) {
      addToast(err.message ?? 'Failed to release evidence', 'error');
    }
  }, [addToast, fetchItems]);

  // ─── Filtering ──────────────────────────────────────────────

  const filtered = items.filter((item) => {
    if (filter !== 'all' && detectType(item) !== filter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        (item.filename ?? '').toLowerCase().includes(q) ||
        (item.original_filename ?? '').toLowerCase().includes(q) ||
        (item.officer_name ?? '').toLowerCase().includes(q) ||
        (item.uploaded_by_name ?? '').toLowerCase().includes(q) ||
        (item.case_number ?? '').toLowerCase().includes(q) ||
        (item.call_number ?? '').toLowerCase().includes(q) ||
        (item.description ?? '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  // ─── Render ─────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full min-h-0" style={{ background: 'var(--surface-base)' }}>
      {/* Title bar */}
      <PanelTitleBar title="DIGITAL EVIDENCE" icon={FileVideo}>
        <button
          type="button"
          className="toolbar-btn"
          disabled={filtered.length === 0}
          onClick={() => downloadTextFile('digital-evidence.csv', digitalEvidenceToCsv(filtered.map((item) => ({
            filename: item.filename,
            evidence_type: item.evidence_type,
            status: item.status,
            case_number: item.case_number,
            call_number: item.call_number,
            created_at: item.created_at,
          }))))}
        >CSV</button>
        <div className="flex items-center gap-2 ml-auto">
          {/* Search */}
          <div
            className="flex items-center gap-1.5 px-2 py-[3px] rounded-[2px]"
            style={{ background: 'var(--surface-sunken)', border: '1px solid var(--border-subtle)' }}
          >
            <Search size={11} style={{ color: 'var(--text-secondary)' }} />
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search evidence… (/)"
              aria-label="Search digital evidence"
              className="bg-transparent text-xs outline-none w-40"
              style={{ color: 'var(--text-primary)' }}
            />
          </div>
          {/* Upload button */}
          <button type="button"
            onClick={() => setShowUpload(true)}
            className="flex items-center gap-1 px-2 py-[3px] text-xs rounded-[2px]"
            style={{ background: 'var(--brand-700)', color: 'var(--text-primary)' }}
          >
            <Upload size={11} /> Upload
          </button>
        </div>
      </PanelTitleBar>

      {/* Filter tabs */}
      <div
        className="flex items-center gap-0 shrink-0 px-2 pt-2 pb-0"
        style={{ borderBottom: '1px solid var(--border-subtle)' }}
      >
        {FILTER_TABS.map((tab) => {
          const Icon = tab.icon;
          const active = filter === tab.id;
          return (
            <button type="button"
              key={tab.id}
              onClick={() => setFilter(tab.id)}
              className="flex items-center gap-1 px-3 py-[4px] text-[11px] font-semibold transition-colors rounded-t-[2px]"
              style={{
                color: active ? 'var(--brand-300)' : 'var(--text-secondary)',
                borderBottom: active ? '2px solid var(--brand-400)' : '2px solid transparent',
                background: active ? 'var(--surface-raised)' : 'transparent',
              }}
            >
              <Icon size={11} />
              {tab.label}
              {tab.id !== 'all' && (
                <span
                  className="ml-0.5 px-1 rounded-[2px] text-[9px]"
                  style={{ background: 'var(--surface-sunken)', color: 'var(--text-secondary)' }}
                >
                  {items.filter((i) => detectType(i) === tab.id).length}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center gap-2 py-12">
            <Loader2 size={16} className="animate-spin" style={{ color: 'var(--brand-400)' }} />
            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Loading evidence…</span>
          </div>
        )}
        {!loading && error && (
          <div className="flex items-center gap-2 m-4 p-3 rounded-[2px]" style={{ background: 'var(--surface-raised)', border: '1px solid var(--border-subtle)' }}>
            <AlertTriangle size={14} style={{ color: 'var(--sev-critical)' }} />
            <span className="text-xs" style={{ color: 'var(--sev-critical)' }}>{error}</span>
            <button type="button"
              onClick={fetchItems}
              className="ml-auto text-xs px-2 py-[2px] rounded-[2px]"
              style={{ border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}
            >
              Retry
            </button>
          </div>
        )}
        {!loading && !error && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-3 py-16">
            <FileVideo size={28} style={{ color: 'var(--text-secondary)', opacity: 0.4 }} />
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              {search ? 'No evidence matches your search.' : 'No digital evidence on file.'}
            </p>
          </div>
        )}
        {!loading && !error && filtered.length > 0 && (
          <table className="w-full border-collapse text-[11px]" style={{ color: 'var(--text-primary)' }}>
            <thead>
              <tr style={{ background: 'var(--surface-sunken)', borderBottom: '1px solid var(--border-subtle)' }}>
                <th className="px-2 py-[3px] text-left font-semibold w-10" style={{ color: 'var(--text-secondary)' }}>
                  Thumb
                </th>
                <th className="px-2 py-[3px] text-left font-semibold" style={{ color: 'var(--text-secondary)' }}>
                  Filename
                </th>
                <th className="px-2 py-[3px] text-left font-semibold" style={{ color: 'var(--text-secondary)' }}>
                  Type
                </th>
                <th className="px-2 py-[3px] text-left font-semibold" style={{ color: 'var(--text-secondary)' }}>
                  Case / Call
                </th>
                <th className="px-2 py-[3px] text-left font-semibold" style={{ color: 'var(--text-secondary)' }}>
                  Officer
                </th>
                <th className="px-2 py-[3px] text-left font-semibold" style={{ color: 'var(--text-secondary)' }}>
                  Date
                </th>
                <th className="px-2 py-[3px] text-left font-semibold" style={{ color: 'var(--text-secondary)' }}>
                  Size
                </th>
                <th className="px-2 py-[3px] text-left font-semibold" style={{ color: 'var(--text-secondary)' }}>
                  Status
                </th>
                <th className="px-2 py-[3px] text-left font-semibold" style={{ color: 'var(--text-secondary)' }}>
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item, idx) => {
                const type = detectType(item);
                const TypeIcon = TYPE_ICONS[type];
                const thumbUrl = item.thumbnail_url
                  ? authedImageUrl(item.thumbnail_url)
                  : type === 'photo' || type === 'screenshot'
                  ? authedImageUrl(digitalEvidenceFilePath(item))
                  : null;

                return (
                  <tr
                    key={item.id}
                    className="hover:bg-[color:var(--surface-raised)] transition-colors cursor-pointer"
                    style={{ borderBottom: '1px solid var(--border-subtle)', background: idx % 2 === 1 ? 'var(--surface-sunken)' : 'transparent' }}
                    onClick={() => setPreviewItem(item)}
                  >
                    {/* Thumbnail */}
                    <td className="px-2 py-[2px] w-10">
                      {thumbUrl ? (
                        <img
                          src={thumbUrl}
                          alt=""
                          className="rounded-[2px] object-cover"
                          style={{ width: 32, height: 32 }}
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                        />
                      ) : (
                        <div
                          className="flex items-center justify-center rounded-[2px]"
                          style={{ width: 32, height: 32, background: 'var(--surface-sunken)' }}
                        >
                          <TypeIcon size={14} style={{ color: 'var(--brand-400)' }} />
                        </div>
                      )}
                    </td>
                    {/* Filename */}
                    <td className="px-2 py-[2px] max-w-[200px]">
                      <span className="block truncate font-medium" title={item.original_filename ?? item.filename}>
                        {item.original_filename ?? item.filename}
                      </span>
                      {item.description && (
                        <span className="block truncate text-[10px]" style={{ color: 'var(--text-secondary)' }}>
                          {item.description}
                        </span>
                      )}
                    </td>
                    {/* Type */}
                    <td className="px-2 py-[2px] whitespace-nowrap">
                      <TypeBadge type={type} />
                    </td>
                    {/* Case / Call */}
                    <td className="px-2 py-[2px] whitespace-nowrap">
                      {item.case_number ? (
                        <span className="flex items-center gap-0.5 text-[10px]" style={{ color: 'var(--brand-300)' }}>
                          <ChevronRight size={9} /> Case {item.case_number}
                        </span>
                      ) : item.call_id ? (
                        <span className="flex items-center gap-0.5 text-[10px]" style={{ color: 'var(--brand-300)' }}>
                          <ChevronRight size={9} /> Call #{item.call_id}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-secondary)' }}>—</span>
                      )}
                    </td>
                    {/* Officer */}
                    <td className="px-2 py-[2px] whitespace-nowrap">
                      {item.officer_name ?? item.uploaded_by_name ?? <span style={{ color: 'var(--text-secondary)' }}>—</span>}
                    </td>
                    {/* Date */}
                    <td className="px-2 py-[2px] whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
                      {formatDate(item.created_at)}
                    </td>
                    {/* Size */}
                    <td className="px-2 py-[2px] whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
                      {formatBytes(item.file_size)}
                    </td>
                    {/* Status */}
                    <td className="px-2 py-[2px] whitespace-nowrap">
                      <StatusBadge status={item.status ?? 'pending_review'} />
                    </td>
                    {/* Actions */}
                    <td
                      className="px-2 py-[2px] whitespace-nowrap"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center gap-1">
                        <button type="button"
                          onClick={() => setPreviewItem(item)}
                          className="p-1 rounded-[2px] hover:bg-[color:var(--surface-sunken)]"
                          aria-label="Preview"
                          title="Preview"
                        >
                          <Eye size={11} style={{ color: 'var(--brand-400)' }} />
                        </button>
                        <button type="button"
                          onClick={() => handleDownload(item)}
                          className="p-1 rounded-[2px] hover:bg-[color:var(--surface-sunken)]"
                          aria-label="Download"
                          title="Download"
                        >
                          <Download size={11} style={{ color: 'var(--text-secondary)' }} />
                        </button>
                        <button type="button"
                          onClick={() => setCustodyItem(item)}
                          className="p-1 rounded-[2px] hover:bg-[color:var(--surface-sunken)]"
                          aria-label="Chain of custody"
                          title="Chain of Custody"
                        >
                          <Link2 size={11} style={{ color: 'var(--text-secondary)' }} />
                        </button>
                        {canAdmin && item.status !== 'sealed' && (
                          <button type="button"
                            onClick={() => handleSeal(item)}
                            className="p-1 rounded-[2px] hover:bg-[color:var(--surface-sunken)]"
                            aria-label="Seal evidence"
                            title="Seal"
                          >
                            <Shield size={11} style={{ color: 'var(--sev-critical)' }} />
                          </button>
                        )}
                        {canAdmin && item.status === 'sealed' && (
                          <button type="button"
                            onClick={() => handleRelease(item)}
                            className="p-1 rounded-[2px] hover:bg-[color:var(--surface-sunken)]"
                            aria-label="Release evidence"
                            title="Release"
                          >
                            <Unlock size={11} style={{ color: 'var(--sev-ok)' }} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Row count footer */}
      {!loading && !error && (
        <div
          className="shrink-0 px-3 py-[4px] text-[10px] flex items-center gap-3"
          style={{ borderTop: '1px solid var(--border-subtle)', background: 'var(--surface-sunken)', color: 'var(--text-secondary)' }}
        >
          <span>{filtered.length} of {items.length} items</span>
          {filter !== 'all' && (
            <button type="button"
              onClick={() => setFilter('all')}
              className="underline"
              style={{ color: 'var(--brand-300)' }}
            >
              Show all
            </button>
          )}
        </div>
      )}

      {/* Modals */}
      {previewItem && (
        <PreviewModal
          item={previewItem}
          onClose={() => setPreviewItem(null)}
          onDownload={handleDownload}
          onChainOfCustody={(item) => { setCustodyItem(item); setPreviewItem(null); }}
          canAdmin={canAdmin}
          onSeal={handleSeal}
          onRelease={handleRelease}
        />
      )}
      {custodyItem && (
        <CustodyModal
          item={custodyItem}
          onClose={() => setCustodyItem(null)}
        />
      )}
      {showUpload && (
        <UploadModal
          onClose={() => setShowUpload(false)}
          onUploaded={() => { fetchItems(); addToast('Evidence uploaded successfully.', 'success'); }}
        />
      )}
    </div>
  );
}
