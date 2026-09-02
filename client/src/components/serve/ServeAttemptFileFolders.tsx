import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera, ChevronDown, ChevronRight, FileText, Folder, Loader2, Pencil, Trash2, Upload, Volume2,
} from 'lucide-react';
import { apiFetch, apiPostForm, authedImageUrl } from '../../hooks/useApi';
import { officerFacingFileError } from '../../utils/officerFacingFileError';
import { formatEnumValue } from '../../utils/formatters';
import { safeDateStr } from '../../utils/dateUtils';
import {
  inferServeFileKind,
  SERVE_ATTEMPT_FILE_ACCEPT,
  SERVE_DOCUMENT_TYPE_LABELS,
  SERVE_DOCUMENT_TYPES,
  type ServeDocumentType,
  type ServeFileKind,
} from '../../utils/serveAttemptFileMeta';
import ConfirmDialog from '../ConfirmDialog';
import InlineAudioPlayer from './InlineAudioPlayer';

export interface ServeAttemptFileRecord {
  id: number;
  serve_queue_id: number;
  serve_attempt_id: number;
  file_id: string;
  kind: ServeFileKind;
  title: string | null;
  description: string | null;
  document_type: string | null;
  copies: number | null;
  original_name: string | null;
  mime_type: string | null;
  file_size: number | null;
  uploader_name?: string | null;
  created_at: string;
}

export interface ServeAttemptFolder {
  attempt_id: number;
  attempt_number: number;
  attempt_at: string;
  result: string | null;
  officer_name: string | null;
  files: ServeAttemptFileRecord[];
}

interface IntakeDoc {
  id: number;
  file_name: string | null;
  file_type: string | null;
  size_bytes: number | null;
  page_count: number | null;
  doc_type: string | null;
  status: string | null;
  created_at: string | null;
}

interface FoldersResponse {
  queue_id: number;
  intake: IntakeDoc[];
  folders: ServeAttemptFolder[];
}

function formatBytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function KindIcon({ kind }: { kind: ServeFileKind }) {
  if (kind === 'photo') return <Camera size={12} className="text-text-secondary" />;
  if (kind === 'audio') return <Volume2 size={12} className="text-text-secondary" />;
  return <FileText size={12} className="text-text-secondary" />;
}

function FileRow({
  file,
  queueId,
  attemptId,
  readOnly,
  onChanged,
}: {
  file: ServeAttemptFileRecord;
  queueId: number;
  attemptId: number;
  readOnly?: boolean;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(file.title ?? '');
  const [description, setDescription] = useState(file.description ?? '');
  const [documentType, setDocumentType] = useState(file.document_type ?? '');
  const [copies, setCopies] = useState(file.copies != null ? String(file.copies) : '');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const href = authedImageUrl(`/api/uploads/${encodeURIComponent(file.file_id)}`);
  const isImage = (file.mime_type || '').startsWith('image/');
  const isAudio = file.kind === 'audio' || (file.mime_type || '').startsWith('audio/');

  const save = async () => {
    setSaving(true);
    try {
      await apiFetch(`/process-server/${queueId}/attempts/${attemptId}/files/${file.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title,
          description,
          document_type: documentType || null,
          copies: copies ? Number(copies) : null,
        }),
      });
      setEditing(false);
      onChanged();
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    await apiFetch(`/process-server/${queueId}/attempts/${attemptId}/files/${file.id}`, { method: 'DELETE' });
    setConfirmDelete(false);
    onChanged();
  };

  return (
    <div className="border border-border-subtle bg-surface-raised px-2 py-2 space-y-2">
      <div className="flex items-start gap-2">
        {isImage ? (
          <a href={href} target="_blank" rel="noopener noreferrer" className="shrink-0">
            <img src={href} alt={file.title || file.original_name || 'Photo'} className="w-12 h-12 object-cover border border-border-subtle" />
          </a>
        ) : (
          <div className="w-12 h-12 shrink-0 border border-border-subtle flex items-center justify-center bg-surface-sunken">
            <KindIcon kind={file.kind} />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="text-[11px] text-text-primary truncate">{file.title || file.original_name || 'Untitled'}</div>
          <div className="text-[9px] text-text-secondary">
            {file.document_type ? SERVE_DOCUMENT_TYPE_LABELS[file.document_type as ServeDocumentType] ?? formatEnumValue(file.document_type) : formatEnumValue(file.kind)}
            {file.copies != null ? ` · ${file.copies} cop${file.copies === 1 ? 'y' : 'ies'}` : ''}
            {file.file_size != null ? ` · ${formatBytes(file.file_size)}` : ''}
          </div>
          {file.description && !editing && (
            <div className="text-[10px] text-text-secondary mt-0.5">{file.description}</div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {!isAudio && (
            <a href={href} target="_blank" rel="noopener noreferrer" className="text-[9px] text-brand-400 hover:text-brand-300 px-1">Open</a>
          )}
          {!readOnly && (
            <>
              <button type="button" aria-label="Edit details" onClick={() => setEditing((v) => !v)} className="p-1 text-text-secondary hover:text-text-primary">
                <Pencil size={11} />
              </button>
              {file.kind !== 'photo' && (
                <button type="button" aria-label="Remove file" onClick={() => setConfirmDelete(true)} className="p-1 text-text-secondary hover:text-red-400">
                  <Trash2 size={11} />
                </button>
              )}
            </>
          )}
        </div>
      </div>
      {isAudio && (
        <InlineAudioPlayer src={href} title={file.title || file.original_name || 'Recording'} />
      )}
      {editing && (
        <div className="grid grid-cols-2 gap-2">
          <label className="col-span-2 flex flex-col gap-0.5">
            <span className="text-[9px] font-semibold uppercase tracking-wide" style={{ color: 'var(--field-label-color)' }}>Title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="input-dark text-[11px] w-full" />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[9px] font-semibold uppercase tracking-wide" style={{ color: 'var(--field-label-color)' }}>Document type</span>
            <select value={documentType} onChange={(e) => setDocumentType(e.target.value)} className="input-dark text-[11px] w-full">
              <option value="">Select…</option>
              {SERVE_DOCUMENT_TYPES.map((t) => (
                <option key={t} value={t}>{SERVE_DOCUMENT_TYPE_LABELS[t]}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[9px] font-semibold uppercase tracking-wide" style={{ color: 'var(--field-label-color)' }}>Copies</span>
            <input type="number" min={1} max={99} value={copies} onChange={(e) => setCopies(e.target.value)} className="input-dark text-[11px] w-full" />
          </label>
          <label className="col-span-2 flex flex-col gap-0.5">
            <span className="text-[9px] font-semibold uppercase tracking-wide" style={{ color: 'var(--field-label-color)' }}>Details</span>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="input-dark text-[11px] w-full" />
          </label>
          <div className="col-span-2 flex justify-end gap-2">
            <button type="button" onClick={() => setEditing(false)} className="text-[10px] text-text-secondary">Cancel</button>
            <button type="button" onClick={save} disabled={saving} className="text-[10px] text-brand-400">{saving ? 'Saving…' : 'Save details'}</button>
          </div>
        </div>
      )}
      <ConfirmDialog
        isOpen={confirmDelete}
        title="Remove file"
        message="Remove this document or recording from the attempt folder?"
        confirmLabel="Remove"
        onConfirm={() => { void remove(); }}
        onClose={() => setConfirmDelete(false)}
      />
    </div>
  );
}

function UploadForm({
  queueId,
  attemptId,
  onUploaded,
}: {
  queueId: number;
  attemptId: number;
  onUploaded: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [documentType, setDocumentType] = useState('');
  const [copies, setCopies] = useState('1');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setBusy(true);
    setErr(null);
    try {
      const fd = new FormData();
      Array.from(fileList).forEach((f) => fd.append('files', f));
      if (title.trim()) fd.append('title', title.trim());
      if (description.trim()) fd.append('description', description.trim());
      if (documentType) fd.append('document_type', documentType);
      if (copies) fd.append('copies', copies);
      const first = fileList[0];
      fd.append('kind', inferServeFileKind(first.type, first.name));
      await apiPostForm(`/process-server/${queueId}/attempts/${attemptId}/files`, fd);
      setTitle('');
      setDescription('');
      onUploaded();
    } catch (e) {
      setErr(officerFacingFileError(e, 'Upload failed'));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="border border-dashed border-border-subtle p-2 space-y-2 bg-surface-sunken">
      <div className="grid grid-cols-2 gap-2">
        <label className="col-span-2 flex flex-col gap-0.5">
          <span className="text-[9px] font-semibold uppercase tracking-wide" style={{ color: 'var(--field-label-color)' }}>Title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Summons — copy left with occupant" className="input-dark text-[11px] w-full" />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[9px] font-semibold uppercase tracking-wide" style={{ color: 'var(--field-label-color)' }}>Document type</span>
          <select value={documentType} onChange={(e) => setDocumentType(e.target.value)} className="input-dark text-[11px] w-full">
            <option value="">Auto / other</option>
            {SERVE_DOCUMENT_TYPES.map((t) => (
              <option key={t} value={t}>{SERVE_DOCUMENT_TYPE_LABELS[t]}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[9px] font-semibold uppercase tracking-wide" style={{ color: 'var(--field-label-color)' }}>Copies</span>
          <input type="number" min={1} max={99} value={copies} onChange={(e) => setCopies(e.target.value)} className="input-dark text-[11px] w-full" />
        </label>
        <label className="col-span-2 flex flex-col gap-0.5">
          <span className="text-[9px] font-semibold uppercase tracking-wide" style={{ color: 'var(--field-label-color)' }}>Details</span>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Who received it, where posted, what the recording covers…" className="input-dark text-[11px] w-full" />
        </label>
      </div>
      <label className={`flex items-center justify-center gap-2 px-3 py-2 border border-dashed cursor-pointer text-[11px] ${busy ? 'opacity-50' : 'hover:border-brand-400 text-text-secondary'}`}>
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
        {busy ? 'Uploading…' : 'Upload documents, photos, or MP3'}
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={SERVE_ATTEMPT_FILE_ACCEPT}
          disabled={busy}
          className="hidden"
          onChange={(e) => submit(e.target.files)}
        />
      </label>
      {err && <div className="text-[10px] text-red-400">{err}</div>}
    </div>
  );
}

export default function ServeAttemptFileFolders({
  queueId,
  attemptId,
  readOnly,
}: {
  queueId: number;
  /** When set, only this attempt's folder is shown (edit-attempt modal). */
  attemptId?: number;
  readOnly?: boolean;
}) {
  const [data, setData] = useState<FoldersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<Record<string, boolean>>({ intake: true });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<FoldersResponse>(`/process-server/${queueId}/file-folders`);
      setData(res);
      setOpen((prev) => {
        const next = { ...prev };
        for (const folder of res.folders ?? []) {
          const key = `a-${folder.attempt_id}`;
          if (next[key] === undefined) next[key] = true;
        }
        return next;
      });
    } finally {
      setLoading(false);
    }
  }, [queueId]);

  useEffect(() => { load(); }, [load]);

  const toggle = (key: string) => setOpen((p) => ({ ...p, [key]: !p[key] }));

  const grouped = useMemo(() => {
    if (!data) return [];
    const allFolders = data.folders ?? [];
    const folders = attemptId != null ? allFolders.filter((f) => f.attempt_id === attemptId) : allFolders;
    return folders.map((folder) => {
      const byKind: Record<ServeFileKind, ServeAttemptFileRecord[]> = { document: [], photo: [], audio: [] };
      for (const f of folder.files ?? []) {
        (byKind[f.kind] ?? byKind.document).push(f);
      }
      return { folder, byKind };
    });
  }, [data, attemptId]);

  if (loading && !data) {
    return <div className="text-[11px] text-text-secondary px-2 py-3">Loading attempt folders…</div>;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Folder size={12} style={{ color: 'var(--panel-header-color)' }} />
        <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--panel-header-color)' }}>
          Attempt folders
        </span>
      </div>

      {attemptId == null && (
      <div className="border border-border-subtle overflow-hidden">
        <button type="button" onClick={() => toggle('intake')} className="w-full flex items-center gap-2 px-3 py-2 bg-surface-raised hover:bg-surface-hover text-left">
          {open.intake ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <span className="text-[11px] text-text-primary">Court packet / intake</span>
          <span className="text-[9px] text-text-secondary ml-auto">{data?.intake.length ?? 0} file{(data?.intake.length ?? 0) === 1 ? '' : 's'}</span>
        </button>
        {open.intake && (
          <div className="px-3 py-2 space-y-1 bg-surface-base">
            {(data?.intake.length ?? 0) === 0 && (
              <div className="text-[11px] text-text-secondary">No intake packet files on this job.</div>
            )}
            {data?.intake.map((doc) => (
              <a
                key={doc.id}
                href={authedImageUrl(`/api/serve-intake/documents/${doc.id}/file`)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-2 py-1.5 border border-border-subtle hover:border-brand-400 text-[11px] text-text-primary"
              >
                <FileText size={12} className="text-text-secondary" />
                <span className="truncate flex-1">{doc.file_name || `Document ${doc.id}`}</span>
                <span className="text-[9px] text-text-secondary">{doc.doc_type ? formatEnumValue(doc.doc_type) : ''}{doc.page_count ? ` · ${doc.page_count}p` : ''}</span>
              </a>
            ))}
          </div>
        )}
      </div>
      )}

      {grouped.length === 0 && (
        <div className="text-[11px] text-text-secondary px-1">Log an attempt to create an attempt folder for photos, documents, and recordings.</div>
      )}

      {grouped.map(({ folder, byKind }) => {
        const key = `a-${folder.attempt_id}`;
        const isOpen = open[key] !== false;
        return (
          <div key={folder.attempt_id} className="border border-border-subtle overflow-hidden">
            <button type="button" onClick={() => toggle(key)} className="w-full flex items-center gap-2 px-3 py-2 bg-surface-raised hover:bg-surface-hover text-left">
              {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              <span className="text-[11px] font-mono text-text-secondary">#{folder.attempt_number}</span>
              <span className="text-[11px] text-text-primary">{formatEnumValue(folder.result || 'attempt')}</span>
              <span className="text-[9px] text-text-secondary">{safeDateStr(folder.attempt_at)}</span>
              <span className="text-[9px] text-text-secondary ml-auto">{folder.files.length} file{folder.files.length === 1 ? '' : 's'}</span>
            </button>
            {isOpen && (
              <div className="px-3 py-2 space-y-3 bg-surface-base">
                {(['document', 'photo', 'audio'] as ServeFileKind[]).map((kind) => (
                  <div key={kind}>
                    <div className="flex items-center gap-1 mb-1">
                      <KindIcon kind={kind} />
                      <span className="text-[9px] font-semibold uppercase tracking-wide" style={{ color: 'var(--field-label-color)' }}>
                        {kind === 'audio' ? 'Recordings (MP3)' : kind === 'photo' ? 'Photos' : 'Documents'} ({byKind[kind].length})
                      </span>
                    </div>
                    {byKind[kind].length === 0 ? (
                      <div className="text-[10px] text-text-secondary px-1">None</div>
                    ) : (
                      <div className="space-y-1">
                        {byKind[kind].map((file) => (
                          <FileRow
                            key={file.id}
                            file={file}
                            queueId={queueId}
                            attemptId={folder.attempt_id}
                            readOnly={readOnly}
                            onChanged={load}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                {!readOnly && <UploadForm queueId={queueId} attemptId={folder.attempt_id} onUploaded={load} />}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
