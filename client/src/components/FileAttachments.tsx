import React, { useState, useEffect, useCallback, useRef } from 'react';
import { parseTimestamp, toDatetimeLocalValue, mtDatetimeLocalToUtc } from '../utils/dateUtils';
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
  Camera,
  MapPin,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Check,
} from 'lucide-react';
import { apiUploadFilesWithProgress, apiFetchAttachments, apiDeleteAttachment, apiFetch } from '../hooks/useApi';
import type { UploadProgress, EvidenceMeta } from '../hooks/useApi';
import UploadProgressBar from './ui/UploadProgressBar';
import ConfirmDialog from './ConfirmDialog';
import { useAuth } from '../context/AuthContext';
import { getGeoFix, contextLabelForEntity, formatStampTimestampMountain } from '../utils/photoStamp';
import { readImageExifFromBlob } from '../utils/imageExif';
import { deStampOne } from '../utils/deStampImage';
import { Eraser } from 'lucide-react';
import { officerFacingFileError } from '../utils/officerFacingFileError';

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
  // Evidence metadata
  latitude?: number | null;
  longitude?: number | null;
  taken_at?: string | null;
  reference_notes?: string | null;
}

interface FileAttachmentsProps {
  entityType: string;
  entityId: string | number;
  readOnly?: boolean;
  compact?: boolean;
  /** Context label shown in the evidence overlay reference line. */
  photoContext?: string;
  /** Case/incident number shown in the evidence overlay reference line. */
  caseNumber?: string;
}

const TOKEN_KEY = 'rmpg_token';

export function authUrl(path: string, sig?: string, exp?: number): string {
  const cleanPath = path.replace(/([?&])token=[^&]*&?/g, '$1').replace(/[?&]$/, '');
  const separator = cleanPath.includes('?') ? '&' : '?';
  if (sig && exp) return `${cleanPath}${separator}sig=${encodeURIComponent(sig)}&exp=${exp}`;
  const token = localStorage.getItem(TOKEN_KEY) || '';
  return `${cleanPath}${separator}token=${encodeURIComponent(token)}`;
}

async function fetchFreshSignature(fileId: string): Promise<{ sig: string; exp: number } | null> {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return null;
    const res = await fetch(`/api/uploads/sign/${fileId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      return { sig: data.sig, exp: data.exp };
    }
  } catch { /* silent */ }
  return null;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(mime: string) {
  if (mime.startsWith('image/')) return Image;
  if (mime.startsWith('video/')) return Film;
  if (mime.startsWith('audio/')) return Volume2;
  if (mime === 'application/pdf') return FileText;
  return File;
}

function formatDate(dateStr: string): string {
  return parseTimestamp(dateStr).toLocaleString('en-US', {
    timeZone: 'America/Denver',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** Format a timestamp as the evidence stamp line (MM-DD-YYYY at HH:MM:SS TZ) */
function formatEvidenceDate(iso: string): string {
  return formatStampTimestampMountain(parseTimestamp(iso));
}

// ─── Evidence Overlay Strip ────────────────────────────────────────────────
// Renders the bottom metadata bar in the same style as the ALPR stamp:
// dark semi-transparent bar, amber monospace text, 3 lines.
function EvidenceOverlay({ att, className = '' }: { att: Attachment; className?: string }) {
  const dateStr = att.taken_at ?? att.created_at;
  const line1 = dateStr ? formatEvidenceDate(dateStr) : null;
  const line2 = (att.latitude != null && att.longitude != null)
    ? `GEO  ${att.latitude.toFixed(6)}, ${att.longitude.toFixed(6)}`
    : 'GEO  UNAVAILABLE';
  const line3Parts: string[] = [];
  if (att.uploader_name) line3Parts.push(`FI. ${att.uploader_name.toUpperCase()}`);
  if (att.reference_notes) line3Parts.push(att.reference_notes.toUpperCase());
  const line3 = line3Parts.join('  —  ') || null;

  return (
    <div
      className={`absolute bottom-0 left-0 right-0 select-none ${className}`}
      style={{
        background: 'linear-gradient(to top, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.60) 70%, transparent 100%)',
        padding: '18px 12px 8px',
        fontFamily: 'Arial, sans-serif',
      }}
    >
      {/* Agency badge top-right — mirroring RMPG in the ALPR photos */}
      <div style={{
        position: 'absolute', top: 8, right: 10,
        fontSize: 10, fontWeight: 700, letterSpacing: '0.12em',
        color: 'rgba(255,200,80,0.90)',
        fontFamily: 'Arial, sans-serif',
      }}>RMPG</div>

      {line1 && (
        <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,200,80,0.95)', lineHeight: 1.4, letterSpacing: '0.04em' }}>
          {line1}
        </div>
      )}
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.80)', lineHeight: 1.4, letterSpacing: '0.03em' }}>
        {line2}
      </div>
      {line3 && (
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.80)', lineHeight: 1.4, letterSpacing: '0.03em' }}>
          {line3}
        </div>
      )}
    </div>
  );
}

// ─── Admin Metadata Edit Panel ─────────────────────────────────────────────
interface MetaEditPanelProps {
  att: Attachment;
  onSaved: (updated: Partial<Attachment>) => void;
  onClose: () => void;
}

function MetaEditPanel({ att, onSaved, onClose }: MetaEditPanelProps) {
  const [lat, setLat] = useState(att.latitude != null ? String(att.latitude) : '');
  const [lon, setLon] = useState(att.longitude != null ? String(att.longitude) : '');
  const [takenAt, setTakenAt] = useState(
    toDatetimeLocalValue(att.taken_at ?? att.created_at ?? ''),
  );
  const [ref, setRef] = useState(att.reference_notes ?? '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setErr(null);
    try {
      const utcTaken = takenAt ? mtDatetimeLocalToUtc(takenAt).replace(' ', 'T') + 'Z' : null;
      const payload = {
        latitude: lat ? parseFloat(lat) : null,
        longitude: lon ? parseFloat(lon) : null,
        taken_at: utcTaken,
        reference_notes: ref || null,
      };
      await apiFetch(`/uploads/${att.file_id}/metadata`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      onSaved(payload);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'w-full bg-black/60 border border-white/20 text-white text-xs px-2 py-1 focus:outline-none focus:border-amber-400/60';
  const labelCls = 'text-[9px] uppercase tracking-widest text-amber-400/80 font-bold mb-0.5 block';

  return (
    <div
      style={{
        position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.92)',
        display: 'flex', flexDirection: 'column', padding: 16, zIndex: 10,
        fontFamily: 'Arial, sans-serif',
      }}
      onClick={e => e.stopPropagation()}
    >
      <div className="flex items-center justify-between mb-4">
        <span style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,200,80,0.95)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
          Edit Evidence Metadata
        </span>
        <button type="button" onClick={onClose} aria-label="Close edit panel"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#fff', padding: 2 }}>
          <X size={16} />
        </button>
      </div>

      <div className="space-y-3 flex-1">
        <div>
          <label className={labelCls}>Date / Time Taken (Mountain Time)</label>
          <input type="datetime-local" step="1" className={inputCls} value={takenAt}
            onChange={e => setTakenAt(e.target.value)}
            placeholder="2026-08-21T14:59:40" />
        </div>
        <div className="flex gap-2">
          <div className="flex-1">
            <label className={labelCls}>Latitude</label>
            <input type="text" className={inputCls} value={lat}
              onChange={e => setLat(e.target.value)} placeholder="40.694518" />
          </div>
          <div className="flex-1">
            <label className={labelCls}>Longitude</label>
            <input type="text" className={inputCls} value={lon}
              onChange={e => setLon(e.target.value)} placeholder="-111.881781" />
          </div>
        </div>
        <div>
          <label className={labelCls}>Reference / Context</label>
          <input type="text" className={inputCls} value={ref}
            onChange={e => setRef(e.target.value)}
            placeholder="VEHICLES RECORD / CASE NO. 26-0142 / etc." />
        </div>
      </div>

      {err && <p style={{ fontSize: 10, color: '#f87171', marginTop: 8 }}>{err}</p>}

      <div className="flex gap-2 mt-4">
        <button type="button" onClick={onClose} disabled={saving}
          style={{ flex: 1, fontSize: 11, padding: '6px 0', border: '1px solid rgba(255,255,255,0.2)', background: 'none', color: '#fff', cursor: 'pointer' }}>
          Cancel
        </button>
        <button type="button" onClick={save} disabled={saving}
          style={{ flex: 2, fontSize: 11, padding: '6px 0', background: 'rgba(255,190,60,0.2)', border: '1px solid rgba(255,200,80,0.5)', color: 'rgba(255,200,80,0.95)', cursor: saving ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
          Save
        </button>
      </div>
    </div>
  );
}

// ─── Evidence Lightbox ────────────────────────────────────────────────────
interface LightboxProps {
  attachments: Attachment[];
  startIdx: number;
  onClose: () => void;
  canEdit: boolean;
  onMetaSaved: (fileId: string, update: Partial<Attachment>) => void;
}

function EvidenceLightbox({ attachments, startIdx, onClose, canEdit, onMetaSaved }: LightboxProps) {
  const [idx, setIdx] = useState(startIdx);
  const [editing, setEditing] = useState(false);
  const [destamping, setDestamping] = useState(false);
  const [destampMsg, setDestampMsg] = useState<string | null>(null);
  // imgKey increments to bust the <img> cache after a de-stamp re-upload
  const [imgKey, setImgKey] = useState(0);
  const overlayRef = useRef<HTMLDivElement>(null);

  const att = attachments[idx];
  const imgUrl = att
    ? authUrl(`/api/uploads/${att.file_id}`, att.access_sig, att.access_exp) + `&_k=${imgKey}`
    : '';

  const isStamped = att?.original_name?.includes('_stamped');

  const handleDeStamp = async () => {
    if (!att || destamping) return;
    setDestamping(true);
    setDestampMsg(null);
    try {
      const url = authUrl(`/api/uploads/${att.file_id}`, att.access_sig, att.access_exp);
      const result = await deStampOne(att.file_id, url);
      if (result.ok) {
        setImgKey(k => k + 1);
        setDestampMsg(`Stamp removed — image cropped from ${result.originalSize.h}px → ${result.croppedHeight}px`);
      } else {
        setDestampMsg(`Failed: ${result.error}`);
      }
    } catch (e) {
      setDestampMsg(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setDestamping(false);
    }
  };

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') setIdx(i => Math.max(0, i - 1));
      if (e.key === 'ArrowRight') setIdx(i => Math.min(attachments.length - 1, i + 1));
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [attachments.length, onClose]);

  if (!att) return null;

  return (
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-label={`Evidence photo: ${att.original_name}`}
      onClick={e => { if (e.target === overlayRef.current && !editing) onClose(); }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.94)',
        zIndex: 50000, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      {/* Close */}
      <button type="button" aria-label="Close" onClick={onClose}
        style={{ position: 'absolute', top: 12, right: 14, background: 'none', border: 'none', cursor: 'pointer', color: '#fff', zIndex: 1 }}>
        <X size={22} />
      </button>

      {/* Counter */}
      <div style={{
        position: 'absolute', top: 14, left: '50%', transform: 'translateX(-50%)',
        fontSize: 10, color: 'rgba(255,255,255,0.45)',
        fontFamily: 'Arial, sans-serif', letterSpacing: '0.1em',
      }}>
        {idx + 1} / {attachments.length}
      </div>

      {/* Prev */}
      {idx > 0 && !editing && (
        <button type="button" aria-label="Previous" onClick={() => setIdx(i => i - 1)}
          style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 2, cursor: 'pointer', color: '#fff', padding: 8 }}>
          <ChevronLeft size={20} />
        </button>
      )}

      {/* Next */}
      {idx < attachments.length - 1 && !editing && (
        <button type="button" aria-label="Next" onClick={() => setIdx(i => i + 1)}
          style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 2, cursor: 'pointer', color: '#fff', padding: 8 }}>
          <ChevronRight size={20} />
        </button>
      )}

      {/* Photo frame — mimics the evidence-photo card */}
      <div style={{
        position: 'relative',
        maxWidth: '78vw', maxHeight: '88vh',
        display: 'flex', flexDirection: 'column',
        border: '1px solid rgba(255,255,255,0.08)',
        background: '#000',
        boxShadow: '0 0 60px rgba(0,0,0,0.9)',
      }}>
        {/* Image */}
        <div style={{ position: 'relative', overflow: 'hidden', flex: 1 }}>
          <img
            key={att.file_id}
            src={imgUrl}
            alt={att.original_name}
            style={{ display: 'block', maxWidth: '78vw', maxHeight: 'calc(88vh - 44px)', objectFit: 'contain' }}
          />

          {/* Evidence overlay strip */}
          <EvidenceOverlay att={att} />

          {/* Meta edit panel (admin only) */}
          {editing && (
            <MetaEditPanel
              att={att}
              onClose={() => setEditing(false)}
              onSaved={update => {
                onMetaSaved(att.file_id, update);
                setEditing(false);
              }}
            />
          )}
        </div>

        {/* Bottom toolbar */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '6px 10px',
          background: 'rgba(255,255,255,0.04)',
          borderTop: '1px solid rgba(255,255,255,0.06)',
          flexShrink: 0,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.55)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'Arial, sans-serif' }}>
              {att.original_name}
            </div>
          </div>

          {canEdit && isStamped && (
            <button
              type="button"
              title="Remove burned-in stamp from image pixels"
              onClick={handleDeStamp}
              disabled={destamping}
              style={{ background: 'none', border: '1px solid rgba(255,100,100,0.4)', borderRadius: 2, cursor: destamping ? 'not-allowed' : 'pointer', color: 'rgba(255,150,150,0.85)', padding: '3px 8px', display: 'flex', alignItems: 'center', gap: 4, fontSize: 10 }}
            >
              {destamping ? <Loader2 size={10} className="animate-spin" /> : <Eraser size={10} />}
              {destamping ? 'Removing…' : 'De-stamp'}
            </button>
          )}
          {canEdit && (
            <button type="button" title="Edit evidence metadata" onClick={() => setEditing(e => !e)}
              style={{ background: editing ? 'rgba(255,200,80,0.15)' : 'none', border: '1px solid rgba(255,200,80,0.3)', borderRadius: 2, cursor: 'pointer', color: 'rgba(255,200,80,0.80)', padding: '3px 8px', display: 'flex', alignItems: 'center', gap: 4, fontSize: 10 }}>
              <Pencil size={10} /> Edit
            </button>
          )}

          <a
            href={authUrl(`/api/uploads/${att.file_id}/download`, att.access_sig, att.access_exp)}
            target="_blank" rel="noopener noreferrer"
            style={{ background: 'none', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 2, cursor: 'pointer', color: 'rgba(255,255,255,0.55)', padding: '3px 8px', display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, textDecoration: 'none' }}
            title="Download"
          >
            <Download size={10} />
          </a>
        </div>
        {destampMsg && (
          <div style={{ padding: '4px 10px', fontSize: 9, fontFamily: 'Arial, sans-serif', color: destampMsg.startsWith('Failed') || destampMsg.startsWith('Error') ? 'rgba(255,120,120,0.9)' : 'rgba(120,255,150,0.9)', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
            {destampMsg}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────
export default function FileAttachments({
  entityType,
  entityId,
  readOnly = false,
  compact = false,
  photoContext,
  caseNumber,
}: FileAttachmentsProps) {
  const { user } = useAuth();
  const canEditMeta = user?.role === 'admin' || user?.role === 'manager';

  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [pdfPreview, setPdfPreview] = useState<Attachment | null>(null);
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [currentFileIndex, setCurrentFileIndex] = useState(0);
  const [totalUploadFiles, setTotalUploadFiles] = useState(0);
  const [currentFileName, setCurrentFileName] = useState<string | undefined>();
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const [referenceInput, setReferenceInput] = useState('');
  const [showRefInput, setShowRefInput] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const fetchFiles = useCallback(async () => {
    try {
      setError(null);
      const data = await apiFetchAttachments(entityType, entityId);
      setAttachments(data || []);
    } catch (err) {
      setError(officerFacingFileError(err, 'Failed to load attachments'));
    } finally {
      setLoading(false);
    }
  }, [entityType, entityId]);

  useEffect(() => { fetchFiles(); }, [fetchFiles]);

  const handleUpload = async (files: FileList | File[]) => {
    let fileArray = Array.from(files);
    if (fileArray.length === 0) return;

    // Device GPS is fallback only — the photograph's own EXIF wins per file.
    let geo: { lat: number; lon: number } | null = null;
    try { geo = await getGeoFix(); } catch { /* none */ }
    const uploadedAt = new Date().toISOString();
    const defaultRef = referenceInput.trim() || photoContext || contextLabelForEntity(entityType, caseNumber) || undefined;

    setUploading(true);
    setError(null);
    setTotalUploadFiles(fileArray.length);
    setCurrentFileIndex(0);
    setCurrentFileName(fileArray[0]?.name);
    setUploadProgress(null);

    try {
      for (let i = 0; i < fileArray.length; i++) {
        const file = fileArray[i];
        setCurrentFileIndex(i);
        setCurrentFileName(file.name);
        const exif = file.type.startsWith('image/') ? await readImageExifFromBlob(file) : null;
        const evidenceMeta: EvidenceMeta = {
          latitude: exif?.latitude ?? geo?.lat,
          longitude: exif?.longitude ?? geo?.lon,
          taken_at: exif?.takenAtIso ?? uploadedAt,
          reference_notes: defaultRef,
        };
        await apiUploadFilesWithProgress(
          [file],
          entityType,
          entityId,
          (progress) => {
            setUploadProgress(progress);
          },
          evidenceMeta,
        );
      }
      await fetchFiles();
      setReferenceInput('');
      setShowRefInput(false);
    } catch (err) {
      setError(officerFacingFileError(err, 'Upload failed'));
    } finally {
      setUploading(false);
      setUploadProgress(null);
      setCurrentFileName(undefined);
    }
  };

  const handleDelete = async (fileId: string) => {
    try {
      await apiDeleteAttachment(fileId);
      setAttachments(prev => prev.filter(a => a.file_id !== fileId));
      setDeleteTarget(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (readOnly) return;
    if (e.dataTransfer.files.length > 0) handleUpload(e.dataTransfer.files);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleUpload(e.target.files);
      e.target.value = '';
    }
  };

  const handleMetaSaved = (fileId: string, update: Partial<Attachment>) => {
    setAttachments(prev => prev.map(a => a.file_id === fileId ? { ...a, ...update } : a));
  };

  const imageAttachments = attachments.filter(a => a.mime_type.startsWith('image/'));
  const otherAttachments = attachments.filter(a => !a.mime_type.startsWith('image/'));

  if (compact && attachments.length === 0 && readOnly) return null;

  return (
    <div className="space-y-2">
      <label className="text-[10px] text-rmpg-400 uppercase font-semibold flex items-center gap-1">
        <Paperclip className="w-3 h-3" />
        Attachments ({attachments.length})
      </label>

      {error && (
        <div className="px-2 py-1.5 bg-red-900/40 border border-red-700/50 text-red-300 text-xs flex items-center justify-between" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} className="text-red-400 hover:text-red-300 p-0.5 ml-2" aria-label="Dismiss error">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Upload zone */}
      {!readOnly && (
        <>
          {/* Reference notes input — shown above drag zone when toggled */}
          {showRefInput && (
            <div className="flex gap-1 items-center">
              <MapPin className="w-3 h-3 text-rmpg-400 flex-shrink-0" />
              <input
                type="text"
                placeholder="Reference / context (e.g. CASE NO. 26-0142)"
                value={referenceInput}
                onChange={e => setReferenceInput(e.target.value)}
                className="flex-1 text-xs bg-surface-sunken border border-rmpg-600 px-2 py-1 text-rmpg-200 focus:outline-none focus:border-rmpg-400"
              />
              <button type="button" onClick={() => { setShowRefInput(false); setReferenceInput(''); }}
                className="text-rmpg-500 hover:text-rmpg-300" aria-label="Cancel reference">
                <X className="w-3 h-3" />
              </button>
            </div>
          )}

          <div
            onDrop={handleDrop}
            onDragOver={e => { e.preventDefault(); if (!readOnly) setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed cursor-pointer transition-all p-3 text-center ${dragOver ? 'border-brand-500 bg-brand-900/20' : 'border-rmpg-600 hover:border-rmpg-400 hover:bg-rmpg-800/30'}`}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleFileInput}
              accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,.mp4,.mov,.avi,.mp3,.wav,.ogg"
            />
            {uploading ? (
              <div className="py-1">
                <UploadProgressBar
                  progress={uploadProgress}
                  fileName={currentFileName}
                  fileCount={currentFileIndex + 1}
                  totalFiles={totalUploadFiles}
                />
              </div>
            ) : (
              <div className="flex items-center justify-center gap-2 text-rmpg-300 text-xs">
                <Upload className="w-4 h-4" />
                {dragOver ? 'Drop files here' : 'Click or drag files to upload'}
              </div>
            )}
          </div>

          {/* Mobile controls */}
          <input
            ref={cameraInputRef}
            type="file"
            className="hidden"
            onChange={handleFileInput}
            accept="image/*"
            capture="environment"
          />
          {!uploading && (
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => cameraInputRef.current?.click()}
                className="md:hidden flex-1 flex items-center justify-center gap-2 py-2 border border-rmpg-600 text-rmpg-200 text-xs font-bold uppercase tracking-wider hover:border-rmpg-400"
              >
                <Camera className="w-4 h-4" />
                Take photo
              </button>
              <button
                type="button"
                onClick={() => setShowRefInput(v => !v)}
                className="flex items-center gap-1 py-1.5 px-2 border border-rmpg-700 text-rmpg-400 text-xs hover:border-rmpg-500 hover:text-rmpg-300"
                title="Set reference / case number for next upload"
              >
                <MapPin className="w-3 h-3" />
                <span className="hidden md:inline">Reference</span>
              </button>
            </div>
          )}
        </>
      )}

      {/* Content */}
      {loading ? (
        <div className="flex items-center gap-2 text-xs text-rmpg-400 py-2">
          <Loader2 className="w-3 h-3 animate-spin" />
          Loading files...
        </div>
      ) : attachments.length > 0 ? (
        <div className="space-y-2">
          {/* ── Evidence Photo Grid ── */}
          {imageAttachments.length > 0 && (
            <div className={`grid gap-1.5 ${imageAttachments.length === 1 ? 'grid-cols-1' : imageAttachments.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
              {imageAttachments.map((att) => {
                const thumbIdx = imageAttachments.indexOf(att);
                return (
                  <EvidenceThumb
                    key={att.file_id}
                    att={att}
                    onClick={() => setLightboxIdx(thumbIdx)}
                    onDelete={readOnly ? undefined : () => setDeleteTarget({ id: att.file_id, name: att.original_name })}
                  />
                );
              })}
            </div>
          )}

          {/* ── Other Files List ── */}
          {otherAttachments.length > 0 && (
            <div className="space-y-1">
              {otherAttachments.map((att) => {
                const Icon = getFileIcon(att.mime_type);
                return (
                  <div key={att.file_id} className="flex items-center gap-2 px-2 py-1.5 bg-rmpg-900 border border-rmpg-700 hover:border-rmpg-600 transition-colors group">
                    <Icon className="w-4 h-4 flex-shrink-0 text-brand-400" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-rmpg-200 truncate">{att.original_name}</p>
                      <p className="text-[10px] text-rmpg-400">
                        {formatFileSize(att.file_size)}
                        {att.uploader_name && <> &middot; {att.uploader_name}</>}
                        {' '}&middot; {formatDate(att.created_at)}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity">
                      {att.mime_type === 'application/pdf' && (
                        <button type="button"
                          onClick={async () => {
                            setPdfPreview(att);
                            setPdfBlobUrl(null);
                            try {
                              const url = authUrl(`/api/uploads/${att.file_id}`, att.access_sig, att.access_exp);
                              const res = await fetch(url);
                              if (res.ok) setPdfBlobUrl(URL.createObjectURL(await res.blob()));
                            } catch { /* iframe fallback */ }
                          }}
                          className="p-1 hover:bg-rmpg-700 text-rmpg-300 hover:text-brand-400 transition-colors"
                          title="Preview"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <a
                        href={authUrl(`/api/uploads/${att.file_id}/download`, att.access_sig, att.access_exp)}
                        target="_blank" rel="noopener noreferrer"
                        className="p-1 hover:bg-rmpg-700 text-rmpg-300 hover:text-green-400 transition-colors"
                        title="Download"
                        onClick={e => e.stopPropagation()}
                      >
                        <Download className="w-3.5 h-3.5" />
                      </a>
                      {!readOnly && (
                        <button type="button"
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
          <div className="flex flex-col items-center gap-1 py-3 text-fg-muted">
            <Paperclip className="w-4 h-4 opacity-40" aria-hidden="true" />
            <p className="text-[10px]">No files attached</p>
          </div>
        )
      )}

      {/* Evidence photo lightbox */}
      {lightboxIdx !== null && (
        <EvidenceLightbox
          attachments={imageAttachments}
          startIdx={lightboxIdx}
          onClose={() => setLightboxIdx(null)}
          canEdit={canEditMeta}
          onMetaSaved={handleMetaSaved}
        />
      )}

      {/* PDF preview */}
      {pdfPreview && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Preview: ${pdfPreview.original_name}`}
          className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-8"
          onClick={() => { if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl); setPdfBlobUrl(null); setPdfPreview(null); }}
        >
          <div className="relative max-w-4xl max-h-full" onClick={e => e.stopPropagation()}>
            <div className="absolute -top-8 left-0 right-0 flex items-center justify-between">
              <span className="text-sm text-rmpg-200 truncate mr-4">{pdfPreview.original_name}</span>
              <button type="button"
                onClick={() => { if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl); setPdfBlobUrl(null); setPdfPreview(null); }}
                className="p-2 hover:bg-rmpg-700 text-rmpg-200 hover:text-rmpg-100"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            {pdfBlobUrl ? (
              <iframe src={pdfBlobUrl} className="w-[800px] max-w-[calc(100vw-4rem)] h-[600px] max-h-[70dvh] bg-white" title="PDF Preview" />
            ) : (
              <div className="w-[800px] h-[600px] bg-white flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-rmpg-400" />
              </div>
            )}
          </div>
        </div>
      )}

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

// ─── Evidence thumbnail ────────────────────────────────────────────────────
function EvidenceThumb({
  att,
  onClick,
  onDelete,
}: {
  att: Attachment;
  onClick: () => void;
  onDelete?: () => void;
}) {
  const [imgSrc, setImgSrc] = useState(
    authUrl(`/api/uploads/${att.file_id}/thumbnail`, att.access_sig, att.access_exp),
  );

  return (
    <div
      className="relative group cursor-pointer overflow-hidden bg-black border border-rmpg-800 hover:border-rmpg-500 transition-colors"
      style={{ aspectRatio: '4/3' }}
      onClick={onClick}
    >
      <img
        src={imgSrc}
        alt={att.original_name}
        className="w-full h-full object-cover"
        loading="lazy"
        onError={async e => {
          const target = e.target as HTMLImageElement;
          if (!target.dataset.retried) {
            target.dataset.retried = '1';
            const fresh = await fetchFreshSignature(att.file_id);
            if (fresh) {
              target.src = authUrl(`/api/uploads/${att.file_id}/thumbnail`, fresh.sig, fresh.exp);
              setImgSrc(target.src);
              return;
            }
          }
          target.style.display = 'none';
        }}
      />

      {/* Compact evidence overlay on thumbnail */}
      <div
        className="absolute bottom-0 left-0 right-0"
        style={{
          background: 'linear-gradient(to top, rgba(0,0,0,0.82) 0%, transparent 100%)',
          padding: '10px 5px 4px',
          fontFamily: 'Arial, sans-serif',
          pointerEvents: 'none',
        }}
      >
        {att.taken_at || att.created_at ? (
          <div style={{ fontSize: 7.5, color: 'rgba(255,200,80,0.90)', lineHeight: 1.3, letterSpacing: '0.02em' }}>
            {formatEvidenceDate(att.taken_at ?? att.created_at)}
          </div>
        ) : null}
        {att.latitude != null && att.longitude != null && (
          <div style={{ fontSize: 7, color: 'rgba(255,255,255,0.65)', lineHeight: 1.3 }}>
            {att.latitude.toFixed(5)}, {att.longitude.toFixed(5)}
          </div>
        )}
      </div>

      {/* RMPG badge top-right */}
      <div style={{
        position: 'absolute', top: 4, right: 5,
        fontSize: 7, fontWeight: 700, letterSpacing: '0.12em',
        color: 'rgba(255,200,80,0.75)',
        fontFamily: 'Arial, sans-serif',
        pointerEvents: 'none',
      }}>RMPG</div>

      {/* Hover overlay */}
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all" />

      {/* Delete button */}
      {onDelete && (
        <button type="button"
          onClick={e => { e.stopPropagation(); onDelete(); }}
          className="absolute top-1 left-1 p-0.5 bg-black/60 hover:bg-red-900/80 text-rmpg-300 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
          title="Delete"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}
