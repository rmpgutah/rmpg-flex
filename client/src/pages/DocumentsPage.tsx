import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  FolderOpen, ChevronRight, Trash2, Edit2, Download, ArrowLeft, Loader2, Upload,
  X, FolderPlus, Home, Search, Eye, Info, FileText, HardDrive, Clock, Hash, Shield,
  Film, Image as ImageIcon, Music, Grid3X3, List, ArrowUpDown, CheckSquare, Square, Filter,
  Pencil, LayoutGrid, FileSpreadsheet, FileArchive, FileCode, FileAudio, FileVideo,
  FileImage, File as FileIcon,
} from 'lucide-react';
import DossierGrid from './documents/DossierGrid';
import { useNavigate, useSearchParams } from 'react-router';
import { apiFetch, authedImageUrl, apiUploadFiles } from '../hooks/useApi';
import DocumentsAppsShelf from './documents/DocumentsAppsShelf';
import PanelTitleBar from '../components/PanelTitleBar';
import ConfirmDialog from '../components/ConfirmDialog';
import { useToast } from '../components/ToastProvider';
import { useAuth } from '../context/AuthContext';
import { useContextMenu, type ContextMenuItem } from '../context/ContextMenuContext';
import { useMenuActions } from '../utils/contextMenuActions';
import { parseTimestamp } from '../utils/dateUtils';
import { fileListingToCsv, downloadTextFile } from '../utils/rmsListExport';

interface Folder {
  id: number;
  name: string;
  parent_id: number | null;
  folder_path: string;
  child_count: number;
  file_count: number;
  created_at: string;
}

interface FileItem {
  id: number;
  file_id: string;
  original_name: string;
  mime_type: string;
  file_size: number;
  created_at: string;
  folder_id: number | null;
}

export default function DocumentsPage() {
  const { user } = useAuth();
  const { addToast } = useToast();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [folders, setFolders] = useState<Folder[]>([]);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [breadcrumbs, setBreadcrumbs] = useState<{ id: number; name: string }[]>([]);
  // Hydrate the initial folder from ?folder=<id> so a cross-page deep-link
  // (e.g. Serve Intake "View case folder", Search results) lands the operator
  // in the right directory instead of dumping them at root and forcing a
  // manual breadcrumb climb. Same one-shot URL contract used by Equipment /
  // FlexCam / AuditLog audits.
  const initialFolderId = (() => {
    const raw = searchParams.get('folder');
    if (!raw) return null;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  })();
  const [currentFolderId, setCurrentFolderId] = useState<number | null>(initialFolderId);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get('q') || '');
  // Modal state
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [renamingFolder, setRenamingFolder] = useState<Folder | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [uploading, setUploading] = useState(false);
  const [infoFile, setInfoFile] = useState<FileItem | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'grid' | 'desktop'>('desktop');
  const [sortBy, setSortBy] = useState<'name' | 'size' | 'date' | 'type'>('name');
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [windowDragOver, setWindowDragOver] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<Array<{ name: string; done: boolean; error: boolean }>>([]);
  const [filterType, setFilterType] = useState<string | null>(null);
  // ConfirmDialog state — replaces three native window.confirm() calls
  // (deleteFolder / deleteFile / bulkDelete). Native prompts are mobile-
  // hostile, can't show identifying detail, and were already migrated away
  // from across the rest of the app (see CRM / Notifications / Equipment
  // audits). All destructive flows now go through ConfirmDialog with a
  // danger variant so Cancel is pre-focused and Enter doesn't accidentally
  // destroy.
  const [pendingDeleteFolder, setPendingDeleteFolder] = useState<Folder | null>(null);
  const [pendingDeleteFile, setPendingDeleteFile] = useState<FileItem | null>(null);
  const [pendingBulkDelete, setPendingBulkDelete] = useState(false);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);
  const isAdmin = user?.role === 'admin' || user?.role === 'manager' || user?.role === 'supervisor';

  // ── Right-click context menu ──
  const { openMenu } = useContextMenu();
  const m = useMenuActions();

  // Clear selection when navigating
  useEffect(() => { setSelectedFiles(new Set()); }, [currentFolderId]);

  const fetchContents = useCallback(async (folderId: number | null) => {
    setLoading(true);
    setLoadError(false);
    try {
      const params = folderId ? `?parent_id=${folderId}` : '';
      const data = await apiFetch<{ folders: Folder[]; files: FileItem[]; breadcrumbs: { id: number; name: string }[] }>(`/documents/folders${params}`);
      setFolders(data.folders || []);
      setFiles(data.files || []);
      setBreadcrumbs(data.breadcrumbs || []);
    } catch (err: any) {
      setLoadError(true);
      addToast(err.message || 'Failed to load documents', 'error');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => { fetchContents(currentFolderId); }, [currentFolderId, fetchContents]);

  // ── URL ↔ state sync ──────────────────────────────────────────────────────
  // Mirror the visible folder + search query into ?folder=&q= so a refresh,
  // back-button, or shared link reproduces the exact view the operator was
  // looking at. `replace: true` keeps the history clean (one entry per real
  // navigation, not one per keystroke).
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (currentFolderId != null) next.set('folder', String(currentFolderId));
    else next.delete('folder');
    if (searchQuery.trim()) next.set('q', searchQuery.trim());
    else next.delete('q');
    // Avoid a no-op replace (would still bump history listeners).
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [currentFolderId, searchQuery, searchParams, setSearchParams]);

  // ── Deep-link: ?file_id=<uuid> opens that file once contents are loaded.
  // One-shot per page load — clear the param after applying so a refresh
  // doesn't re-pop the modal on every load. Mirrors the FlexCam
  // (?request_id=) and AuditLog row-click contracts.
  const pendingFileIdRef = useRef<string | null>(searchParams.get('file_id'));
  useEffect(() => {
    const target = pendingFileIdRef.current;
    if (!target || loading) return;
    const match = files.find(f => f.file_id === target);
    if (match) {
      // PDFs / text / previewable open in their respective viewers; everything
      // else surfaces the File Info modal so the operator at least sees the
      // record exists, even if it can't be previewed inline.
      openFile(match);
      pendingFileIdRef.current = null;
      const next = new URLSearchParams(searchParams);
      next.delete('file_id');
      setSearchParams(next, { replace: true });
    }
    // If the file isn't in the current folder, we don't have enough info
    // here to navigate elsewhere — leaving the pending ref intact would
    // keep re-firing, so we clear it once the folder finishes loading.
    else if (!loading) {
      pendingFileIdRef.current = null;
      const next = new URLSearchParams(searchParams);
      next.delete('file_id');
      setSearchParams(next, { replace: true });
    }
    // openFile is defined below; we intentionally close over the current
    // closure each render and only re-run when contents arrive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, loading]);

  const handleFileUpload = useCallback(async (fileList: FileList) => {
    if (!fileList.length) return;
    setUploading(true);
    const items = Array.from(fileList);
    setUploadProgress(items.map(f => ({ name: f.name, done: false, error: false })));
    let successCount = 0;
    try {
      for (let i = 0; i < items.length; i++) {
        const file = items[i];
        try {
          const results = await apiUploadFiles(
            [file],
            currentFolderId ? 'document_folder' : undefined,
            currentFolderId ?? undefined,
          );
          if (currentFolderId && results?.[0]?.file_id) {
            await apiFetch(`/documents/folders/${currentFolderId}/move-file`, {
              method: 'POST',
              body: JSON.stringify({ file_id: results[0].file_id }),
            }).catch(() => {});
          }
          successCount++;
          setUploadProgress(prev => prev.map((p, idx) => idx === i ? { ...p, done: true } : p));
        } catch {
          setUploadProgress(prev => prev.map((p, idx) => idx === i ? { ...p, done: true, error: true } : p));
        }
      }
      if (successCount > 0) {
        addToast(`${successCount} file${successCount > 1 ? 's' : ''} uploaded`, 'success');
        fetchContents(currentFolderId);
      }
      setTimeout(() => setUploadProgress([]), 3000);
    } finally {
      setUploading(false);
    }
  }, [currentFolderId, addToast, fetchContents]);

  const navigateTo = (folderId: number | null) => {
    setCurrentFolderId(folderId);
    setSearchQuery('');
  };

  const createFolder = async () => {
    if (!newFolderName.trim()) return;
    try {
      await apiFetch('/documents/folders', { method: 'POST', body: JSON.stringify({ name: newFolderName.trim(), parent_id: currentFolderId }) });
      setNewFolderName('');
      setShowNewFolder(false);
      fetchContents(currentFolderId);
      addToast('Folder created', 'success');
    } catch (err: any) { addToast(err.message || 'Failed to create folder', 'error'); }
  };

  const renameFolder = async () => {
    if (!renamingFolder || !renameValue.trim()) return;
    try {
      await apiFetch(`/documents/folders/${renamingFolder.id}`, { method: 'PUT', body: JSON.stringify({ name: renameValue.trim() }) });
      setRenamingFolder(null);
      fetchContents(currentFolderId);
      addToast('Folder renamed', 'success');
    } catch (err: any) { addToast(err.message || 'Failed to rename', 'error'); }
  };

  // Stages a folder for deletion via ConfirmDialog (replaces window.confirm).
  const requestDeleteFolder = (folder: Folder) => setPendingDeleteFolder(folder);
  const performDeleteFolder = async () => {
    const folder = pendingDeleteFolder;
    if (!folder) return;
    setConfirmBusy(true);
    try {
      await apiFetch(`/documents/folders/${folder.id}`, { method: 'DELETE' });
      fetchContents(currentFolderId);
      addToast('Folder deleted', 'success');
      setPendingDeleteFolder(null);
    } catch (err: any) { addToast(err.message || 'Failed to delete', 'error'); }
    finally { setConfirmBusy(false); }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  };

  // Stages a file for deletion via ConfirmDialog (replaces window.confirm).
  const requestDeleteFile = (file: FileItem) => setPendingDeleteFile(file);
  const performDeleteFile = async () => {
    const file = pendingDeleteFile;
    if (!file) return;
    setConfirmBusy(true);
    try {
      await apiFetch(`/uploads/${file.file_id}`, { method: 'DELETE' });
      fetchContents(currentFolderId);
      addToast('File deleted', 'success');
      setSelectedFiles(prev => { const n = new Set(prev); n.delete(file.file_id); return n; });
      setPendingDeleteFile(null);
    } catch (err: any) { addToast(err.message || 'Failed to delete', 'error'); }
    finally { setConfirmBusy(false); }
  };

  // Stages a bulk delete via ConfirmDialog.
  const requestBulkDelete = () => { if (selectedFiles.size > 0) setPendingBulkDelete(true); };
  const performBulkDelete = async () => {
    if (selectedFiles.size === 0) { setPendingBulkDelete(false); return; }
    setConfirmBusy(true);
    let count = 0;
    for (const fid of selectedFiles) {
      try { await apiFetch(`/uploads/${fid}`, { method: 'DELETE' }); count++; } catch { /* continue */ }
    }
    setSelectedFiles(new Set());
    fetchContents(currentFolderId);
    addToast(`${count} file${count > 1 ? 's' : ''} deleted`, 'success');
    setPendingBulkDelete(false);
    setConfirmBusy(false);
  };

  // Toggle file selection
  const toggleSelect = (fileId: string) => {
    setSelectedFiles(prev => {
      const n = new Set(prev);
      if (n.has(fileId)) n.delete(fileId); else n.add(fileId);
      return n;
    });
  };
  const selectAll = () => {
    if (selectedFiles.size === filteredFiles.length) setSelectedFiles(new Set());
    else setSelectedFiles(new Set(filteredFiles.map(f => f.file_id)));
  };

  // Window-level drag-and-drop: counter ref prevents child-element flicker
  useEffect(() => {
    const onEnter = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      e.preventDefault();
      dragCounterRef.current++;
      setWindowDragOver(true);
    };
    const onLeave = () => {
      dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
      if (dragCounterRef.current === 0) setWindowDragOver(false);
    };
    const onOver = (e: DragEvent) => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      dragCounterRef.current = 0;
      setWindowDragOver(false);
      if (e.dataTransfer?.files.length) handleFileUpload(e.dataTransfer.files);
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('dragover', onOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('drop', onDrop);
    };
  }, [handleFileUpload]);

  // ── Keyboard cascade ──────────────────────────────────────────────────────
  // - Esc: peel one layer of state at a time, modal-first, so the operator
  //   doesn't have to mouse-click to back out:
  //     file-info modal → rename modal → new-folder modal → confirm dialogs
  //     → clear search → clear selection → drop one folder breadcrumb.
  //   Matches the page-wide audit contract (CRM, FlexCam, AuditLog).
  //   NOTE: each individual delete-confirm dialog manages its own Esc via
  //   ConfirmDialog's focus trap, but we still gate the cascade on its
  //   pending state so Esc here doesn't fire two layers in one keystroke.
  // - 'N': opens the file picker (primary "new" action for a file browser).
  //   Skipped while typing into an input/textarea or with any modal open.
  useEffect(() => {
    const isTypingInField = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
    };
    const anyModalOpen = () =>
      !!infoFile || !!renamingFolder || showNewFolder ||
      !!pendingDeleteFile || !!pendingDeleteFolder || pendingBulkDelete;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Delegate Esc to whichever ConfirmDialog/modal owns it first;
        // we only intervene when none of them did.
        if (infoFile) { setInfoFile(null); return; }
        if (renamingFolder) { setRenamingFolder(null); return; }
        if (showNewFolder) { setShowNewFolder(false); return; }
        if (pendingDeleteFile) { setPendingDeleteFile(null); return; }
        if (pendingDeleteFolder) { setPendingDeleteFolder(null); return; }
        if (pendingBulkDelete) { setPendingBulkDelete(false); return; }
        if (searchQuery) { setSearchQuery(''); return; }
        if (selectedFiles.size > 0) { setSelectedFiles(new Set()); return; }
        if (currentFolderId != null) {
          // "Up one level" — drop to parent breadcrumb, root if none.
          const parent = breadcrumbs.length > 1 ? breadcrumbs[breadcrumbs.length - 2].id : null;
          setCurrentFolderId(parent);
          return;
        }
        return;
      }
      if ((e.key === 'n' || e.key === 'N') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (isTypingInField(e.target)) return;
        if (anyModalOpen()) return;
        e.preventDefault();
        // Upload Files is the primary action on this page — same surface as
        // the toolbar button, so muscle memory is "N = new upload".
        uploadInputRef.current?.click();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [infoFile, renamingFolder, showNewFolder, pendingDeleteFile, pendingDeleteFolder, pendingBulkDelete, searchQuery, selectedFiles, currentFolderId, breadcrumbs]);

  // Storage stats
  const storageStats = React.useMemo(() => {
    const totalSize = files.reduce((sum, f) => sum + f.file_size, 0);
    const byType: Record<string, { count: number; size: number }> = {};
    files.forEach(f => {
      const cat = f.mime_type?.startsWith('image/') ? 'Images' : f.mime_type?.startsWith('video/') ? 'Videos' : f.mime_type?.startsWith('audio/') ? 'Audio' : f.mime_type === 'application/pdf' ? 'PDFs' : 'Other';
      if (!byType[cat]) byType[cat] = { count: 0, size: 0 };
      byType[cat].count++;
      byType[cat].size += f.file_size;
    });
    return { totalSize, totalFiles: files.length, byType };
  }, [files]);

  // Lucide-icon resolver for files. Replaces the previous emoji map (🖼️ 📄 🎬
  // …) which (a) rendered inconsistently across the Spillman day/night theme —
  // emojis don't pick up `text-rmpg-*` color — and (b) violated the page-audit
  // rule against emoji chrome. Returns the component + a sensible tint per
  // category so the dossier / list / grid views all look like the rest of the
  // Records skin.
  const getFileIconMeta = (mime: string): { Icon: React.ComponentType<{ className?: string }>; tint: string } => {
    if (mime?.startsWith('image/')) return { Icon: FileImage, tint: 'text-blue-400' };
    if (mime === 'application/pdf') return { Icon: FileText, tint: 'text-red-400' };
    if (mime?.startsWith('video/')) return { Icon: FileVideo, tint: 'text-purple-400' };
    if (mime?.startsWith('audio/')) return { Icon: FileAudio, tint: 'text-amber-400' };
    if (mime?.includes('word') || mime?.includes('document')) return { Icon: FileText, tint: 'text-brand-400' };
    if (mime?.includes('sheet') || mime?.includes('excel')) return { Icon: FileSpreadsheet, tint: 'text-emerald-400' };
    if (mime?.includes('zip') || mime?.includes('compressed') || mime?.includes('archive')) return { Icon: FileArchive, tint: 'text-amber-500' };
    if (mime?.includes('json') || mime?.includes('xml') || mime?.includes('javascript') || mime?.includes('text/x-')) return { Icon: FileCode, tint: 'text-cyan-400' };
    if (mime?.startsWith('text/')) return { Icon: FileText, tint: 'text-rmpg-300' };
    return { Icon: FileIcon, tint: 'text-rmpg-400' };
  };

  const canPreview = (mime: string) => {
    return mime === 'application/pdf' || mime?.startsWith('image/') || mime?.startsWith('video/') || mime?.startsWith('audio/');
  };

  // Filter + sort
  const q = searchQuery.toLowerCase();
  const filteredFolders = q ? folders.filter(f => f.name.toLowerCase().includes(q)) : folders;
  const filteredFiles = React.useMemo(() => {
    let list = q ? files.filter(f => f.original_name.toLowerCase().includes(q)) : [...files];
    // Type filter
    if (filterType) {
      list = list.filter(f => {
        if (filterType === 'pdf') return f.mime_type === 'application/pdf';
        if (filterType === 'image') return f.mime_type?.startsWith('image/');
        if (filterType === 'video') return f.mime_type?.startsWith('video/');
        if (filterType === 'audio') return f.mime_type?.startsWith('audio/');
        if (filterType === 'doc') return f.mime_type?.includes('word') || f.mime_type?.includes('document');
        return true;
      });
    }
    // Sort
    if (sortBy === 'name') list.sort((a, b) => a.original_name.localeCompare(b.original_name));
    else if (sortBy === 'size') list.sort((a, b) => b.file_size - a.file_size);
    else if (sortBy === 'date') list.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    else if (sortBy === 'type') list.sort((a, b) => (a.mime_type || '').localeCompare(b.mime_type || ''));
    return list;
  }, [files, q, filterType, sortBy]);

  // Open a file the same way the row buttons do: PDFs route through the
  // internal pdf-editor viewer, other previewables open in a new tab, text files in the text editor.
  const TEXT_MIMES = new Set([
    'text/plain', 'text/csv', 'text/markdown', 'text/x-markdown',
    'application/json', 'text/xml', 'application/xml',
    'text/javascript', 'application/javascript',
    'text/x-python', 'text/x-sh', 'text/x-yaml', 'application/x-yaml',
  ]);

  const openFile = (file: FileItem) => {
    if (file.mime_type === 'application/pdf') {
      const params = new URLSearchParams({ fileId: file.file_id, name: file.original_name, view: '1' });
      if (currentFolderId != null) params.set('folderId', String(currentFolderId));
      navigate(`/pdf-editor?${params.toString()}`);
    } else if (file.mime_type === 'text/html') {
      const params = new URLSearchParams({ fileId: file.file_id, name: file.original_name });
      if (currentFolderId != null) params.set('folderId', String(currentFolderId));
      navigate(`/document-writer?${params.toString()}`);
    } else if (TEXT_MIMES.has(file.mime_type)) {
      const params = new URLSearchParams({ fileId: file.file_id, name: file.original_name, mime: file.mime_type });
      if (currentFolderId != null) params.set('folderId', String(currentFolderId));
      navigate(`/text-editor?${params.toString()}`);
    } else if (canPreview(file.mime_type)) {
      window.open(authedImageUrl(`/api/uploads/${file.file_id}`), '_blank', 'noopener,noreferrer');
    } else {
      setInfoFile(file);
    }
  };

  const buildFolderMenu = (folder: Folder): ContextMenuItem[] => [
    m.action('Open', () => navigateTo(folder.id), { icon: <FolderOpen size={12} /> }),
    ...(isAdmin ? [m.action('Rename', () => { setRenamingFolder(folder); setRenameValue(folder.name); }, { icon: <Pencil size={12} /> })] : []),
    m.separator(),
    m.copy('Copy name', folder.name),
    m.copyId(folder.id),
    ...(isAdmin ? [m.separator(), m.action('Delete', () => requestDeleteFolder(folder), { icon: <Trash2 size={12} />, danger: true })] : []),
  ];

  const buildFileMenu = (file: FileItem): ContextMenuItem[] => [
    m.action(canPreview(file.mime_type) ? 'Open' : 'File details', () => openFile(file), { icon: <Eye size={12} /> }),
    ...(file.mime_type === 'application/pdf'
      ? [m.action('Edit PDF', () => {
          const params = new URLSearchParams({ fileId: file.file_id, name: file.original_name });
          if (currentFolderId != null) params.set('folderId', String(currentFolderId));
          navigate(`/pdf-editor?${params.toString()}`);
        }, { icon: <Pencil size={12} /> })]
      : []),
    m.action('File details', () => setInfoFile(file), { icon: <Info size={12} /> }),
    m.openExternal('Download', authedImageUrl(`/api/uploads/${file.file_id}/download`), <Download size={12} />),
    m.separator(),
    m.copy('Copy name', file.original_name),
    m.copyId(file.file_id),
    ...(isAdmin ? [m.separator(), m.action('Delete', () => requestDeleteFile(file), { icon: <Trash2 size={12} />, danger: true })] : []),
  ];

  return (
    <div className="h-full flex flex-col">
      <PanelTitleBar title="DOCUMENTS / UPLOAD RECORDS" icon={FolderOpen}>
        <button
          type="button"
          className="toolbar-btn"
          disabled={files.length === 0}
          onClick={() => downloadTextFile('documents.csv', fileListingToCsv(files.map((f) => ({
            name: f.original_name, size: f.file_size, modified: f.created_at, path: f.file_id,
          }))))}
        >CSV</button>
        <button type="button" onClick={() => uploadInputRef.current?.click()} disabled={uploading} className="toolbar-btn toolbar-btn-primary">
          {uploading ? <Loader2 style={{ width: 10, height: 10 }} className="animate-spin" /> : <Upload style={{ width: 10, height: 10 }} />}
          {uploading ? 'Uploading...' : 'Upload Files'}
        </button>
        <input id="ff-documentspage-0" ref={uploadInputRef} type="file" multiple className="hidden"
          onChange={e => { if (e.target.files) handleFileUpload(e.target.files); e.target.value = ''; }} />
        {isAdmin && (
          <button type="button" onClick={() => setShowNewFolder(true)} className="toolbar-btn">
            <FolderPlus style={{ width: 10, height: 10 }} /> New Folder
          </button>
        )}
      </PanelTitleBar>

      {loadError && (
        <div className="px-4 py-2 text-xs text-red-400 flex items-center justify-between border-b border-red-700/40">
          <span>Failed to load this folder.</span>
          <button type="button" className="toolbar-btn" onClick={() => void fetchContents(currentFolderId)}>Retry</button>
        </div>
      )}

      {/* Breadcrumb navigation */}
      <div className="px-4 py-2 border-b border-rmpg-700 flex items-center gap-1 text-[11px] bg-surface-sunken overflow-x-auto tab-scroll">
        <button type="button" onClick={() => navigateTo(null)} className="flex items-center gap-1 text-brand-400 hover:text-brand-300 font-medium">
          <Home className="w-3 h-3" /> Root
        </button>
        {breadcrumbs.map((bc) => (
          <React.Fragment key={bc.id}>
            <ChevronRight className="w-3 h-3 text-rmpg-600 flex-shrink-0" />
            <button type="button" onClick={() => navigateTo(bc.id)} className="text-brand-400 hover:text-brand-300 font-medium truncate max-w-[200px]">
              {bc.name}
            </button>
          </React.Fragment>
        ))}
      </div>

      {/* Search */}
      <div className="px-4 py-2 border-b border-rmpg-700">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-rmpg-400 pointer-events-none" />
          <input id="ff-documentspage-1" type="text" className="input-dark pl-9 w-full text-[11px]" placeholder="Search folders and files..."
            aria-label="Search folders and files"
            value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
          {searchQuery && (
            <button aria-label="Close" type="button" onClick={() => setSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-rmpg-400 hover:text-rmpg-100">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Toolbar: view toggle + sort + filter + bulk actions + stats */}
      <div className="px-4 py-1.5 border-b border-rmpg-700/50 bg-surface-sunken flex items-center gap-2 text-[9px] flex-wrap">
        {/* View toggle */}
        {(['desktop', 'grid', 'list'] as const).map(mode => (
          <button key={mode} type="button" onClick={() => setViewMode(mode)}
            title={mode === 'desktop' ? 'Dossier (icon) view' : mode === 'grid' ? 'Grid view' : 'List view'}
            className={`p-1 transition-colors ${viewMode === mode ? 'text-brand-400 bg-brand-900/30' : 'text-rmpg-400 hover:bg-rmpg-600 hover:text-rmpg-100'}`}>
            {mode === 'desktop' ? <LayoutGrid className="w-3.5 h-3.5" /> : mode === 'grid' ? <Grid3X3 className="w-3.5 h-3.5" /> : <List className="w-3.5 h-3.5" />}
          </button>
        ))}
        <span className="w-px h-3 bg-rmpg-700" />
        {/* Sort */}
        <ArrowUpDown className="w-3 h-3 text-rmpg-500" />
        {(['name', 'size', 'date', 'type'] as const).map(s => (
          <button key={s} type="button" onClick={() => setSortBy(s)}
            className={`px-1.5 py-0.5 font-medium border transition-all ${sortBy === s ? 'bg-brand-900/30 border-brand-500/50 text-brand-400' : 'bg-transparent border-transparent text-rmpg-500 hover:text-rmpg-300'}`}>
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
        <span className="w-px h-3 bg-rmpg-700" />
        {/* Type filter */}
        <Filter className="w-3 h-3 text-rmpg-500" />
        {[{ key: null, label: 'All' }, { key: 'pdf', label: 'PDF' }, { key: 'image', label: 'Image' }, { key: 'video', label: 'Video' }, { key: 'audio', label: 'Audio' }, { key: 'doc', label: 'Doc' }].map(f => (
          <button key={f.key || 'all'} type="button" onClick={() => setFilterType(f.key)}
            className={`px-1.5 py-0.5 font-medium border transition-all ${filterType === f.key ? 'bg-brand-900/30 border-brand-500/50 text-brand-400' : 'bg-transparent border-rmpg-700/50 text-rmpg-500 hover:text-rmpg-300'}`}>
            {f.label}
          </button>
        ))}
        {/* Bulk actions */}
        {selectedFiles.size > 0 && (
          <>
            <span className="w-px h-3 bg-rmpg-700 ml-1" />
            <span className="text-brand-400 font-bold">{selectedFiles.size} selected</span>
            <button type="button" onClick={requestBulkDelete} className="px-1.5 py-0.5 text-red-400 hover:text-red-300 border border-red-700/50 hover:bg-red-900/20 font-medium">
              <Trash2 className="w-3 h-3 inline mr-0.5" /> Delete
            </button>
          </>
        )}
        {/* Storage stats (right) */}
        <div className="ml-auto flex items-center gap-3 text-rmpg-500">
          {files.length > 0 && (
            <>
              <span><strong className="text-rmpg-300">{storageStats.totalFiles}</strong> files</span>
              <span><strong className="text-rmpg-300">{formatSize(storageStats.totalSize)}</strong> total</span>
              {Object.entries(storageStats.byType).slice(0, 3).map(([type, { count }]) => (
                <span key={type} className="hidden lg:inline">{type}: {count}</span>
              ))}
            </>
          )}
        </div>
      </div>

      {/* Content */}
      <div className={`flex-1 overflow-auto transition-colors ${windowDragOver ? 'bg-brand-900/10 ring-2 ring-brand-500/50 ring-inset' : ''}`}>
        {windowDragOver && (
          <div className="flex items-center justify-center py-8 m-4 border-2 border-dashed border-brand-500/50 bg-brand-900/5 text-brand-400 text-sm font-bold">
            <Upload className="w-5 h-5 mr-2" /> Drop files here to upload
          </div>
        )}
        {loading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-rmpg-400" /></div>
        ) : viewMode === 'desktop' ? (
          /* ── DOSSIER (desktop icon) VIEW ── */
          <DossierGrid
            folders={filteredFolders as import('./documents/DossierGrid').DossierFolder[]}
            files={filteredFiles as import('./documents/DossierGrid').DossierFile[]}
            selectedFiles={selectedFiles}
            isLoading={loading}
            searchQuery={searchQuery}
            onFolderOpen={navigateTo}
            onFileOpen={file => openFile(file as FileItem)}
            onFileSelect={(fileId, multi) => {
              if (multi) toggleSelect(fileId);
              else setSelectedFiles(prev => prev.has(fileId) && prev.size === 1 ? new Set() : new Set([fileId]));
            }}
            onFolderContextMenu={(e, folder) => openMenu(e, buildFolderMenu(folder as Folder))}
            onFileContextMenu={(e, file) => openMenu(e, buildFileMenu(file as FileItem))}
            headerSlot={<>
              {currentFolderId && (
                <button type="button"
                  onClick={() => navigateTo(breadcrumbs.length > 1 ? breadcrumbs[breadcrumbs.length - 2].id : null)}
                  className="dossier-tile group"
                  aria-label="Go up">
                  <div className="dossier-tile-icon bg-rmpg-800 border border-rmpg-700 group-hover:bg-rmpg-700">
                    <ArrowLeft size={26} className="text-rmpg-400" />
                  </div>
                  <span className="dossier-tile-label text-rmpg-500">Up</span>
                </button>
              )}
              {!searchQuery && (
                <div className="w-full">
                  <DocumentsAppsShelf currentFolderId={currentFolderId} />
                </div>
              )}
            </>}
          />
        ) : (
          <div className={`p-4 ${viewMode === 'grid' ? 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2' : 'space-y-1'}`}>
            {/* Back button */}
            {currentFolderId && (
              <button type="button"
                onClick={() => navigateTo(breadcrumbs.length > 1 ? breadcrumbs[breadcrumbs.length - 2].id : null)}
                className="flex items-center gap-2 px-3 py-2 w-full text-left hover:bg-rmpg-700/30 transition-colors text-xs text-rmpg-400"
              >
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
            )}

            {/* Apps shelf */}
            {!searchQuery && (
              <DocumentsAppsShelf currentFolderId={currentFolderId} />
            )}

            {/* Folders */}
            {filteredFolders.map(folder => (
              <div key={folder.id}
                className="flex items-center gap-3 px-3 py-2.5 hover:bg-rmpg-700/30 cursor-pointer transition-colors group border-b border-rmpg-800/30"
                onClick={() => navigateTo(folder.id)}
                onContextMenu={(e) => openMenu(e, buildFolderMenu(folder))}
                onKeyDown={e => { if (e.key === 'Enter') navigateTo(folder.id); }}
                tabIndex={0} role="button"
              >
                <FolderOpen className="w-5 h-5 text-amber-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-rmpg-100 truncate block">{folder.name}</span>
                  <span className="text-[9px] text-rmpg-500">
                    {folder.child_count > 0 ? `${folder.child_count} folder${folder.child_count !== 1 ? 's' : ''}` : ''}
                    {folder.child_count > 0 && folder.file_count > 0 ? ' · ' : ''}
                    {folder.file_count > 0 ? `${folder.file_count} file${folder.file_count !== 1 ? 's' : ''}` : ''}
                    {!folder.child_count && !folder.file_count ? 'Empty' : ''}
                  </span>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                  {isAdmin && (
                    <>
                      <button type="button" onClick={() => { setRenamingFolder(folder); setRenameValue(folder.name); }}
                        className="p-1 hover:bg-rmpg-600 text-rmpg-400 hover:text-brand-400 transition-colors" title="Rename">
                        <Edit2 className="w-3 h-3" />
                      </button>
                      <button type="button" onClick={() => requestDeleteFolder(folder)}
                        className="p-1 hover:bg-rmpg-600 text-rmpg-400 hover:text-red-400 transition-colors" title="Delete">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </>
                  )}
                </div>
                <ChevronRight className="w-4 h-4 text-rmpg-600 flex-shrink-0" />
              </div>
            ))}

            {/* Select all (list view only) */}
            {viewMode === 'list' && filteredFiles.length > 0 && (
              <div className="flex items-center gap-2 px-3 py-1 text-[9px] text-rmpg-500">
                <button type="button" onClick={selectAll} className="flex items-center gap-1 hover:text-rmpg-300">
                  {selectedFiles.size === filteredFiles.length ? <CheckSquare className="w-3 h-3 text-brand-400" /> : <Square className="w-3 h-3" />}
                  {selectedFiles.size === filteredFiles.length ? 'Deselect all' : 'Select all'}
                </button>
                <span className="text-rmpg-600">|</span>
                <span>{filteredFiles.length} file{filteredFiles.length !== 1 ? 's' : ''}</span>
              </div>
            )}

            {/* Files */}
            {filteredFiles.map(file => viewMode === 'grid' ? (
              /* ── GRID VIEW ── */
              <div key={file.file_id}
                className={`panel-beveled p-3 flex flex-col items-center gap-2 cursor-pointer hover:bg-rmpg-700/30 transition-colors relative group ${selectedFiles.has(file.file_id) ? 'ring-1 ring-brand-500/50 bg-brand-900/10' : ''}`}
                onClick={() => toggleSelect(file.file_id)}
                onContextMenu={(e) => openMenu(e, buildFileMenu(file))}
              >
                {(() => { const { Icon, tint } = getFileIconMeta(file.mime_type); return <Icon className={`w-8 h-8 ${tint}`} />; })()}
                <span className="text-[10px] text-rmpg-200 text-center truncate w-full font-medium">{file.original_name}</span>
                <span className="text-[8px] text-rmpg-500">{formatSize(file.file_size)}</span>
                {/* Hover actions */}
                <div className="absolute top-1 right-1 flex gap-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                  <button aria-label="File info" type="button" onClick={() => setInfoFile(file)} className="p-0.5 bg-rmpg-800/80 hover:bg-rmpg-600 text-rmpg-400 hover:text-amber-400"><Info className="w-3 h-3" /></button>
                  {file.mime_type === 'application/pdf' && (
                    <button type="button"
                      title="Edit PDF"
                      onClick={() => {
                        const params = new URLSearchParams({ fileId: file.file_id, name: file.original_name });
                        if (currentFolderId != null) params.set('folderId', String(currentFolderId));
                        navigate(`/pdf-editor?${params.toString()}`);
                      }}
                      className="p-0.5 bg-rmpg-800/80 hover:bg-rmpg-600 text-rmpg-400 hover:text-brand-400"><Pencil className="w-3 h-3" /></button>
                  )}
                  <a href={authedImageUrl(`/api/uploads/${file.file_id}/download`)} className="p-0.5 bg-rmpg-800/80 hover:bg-rmpg-600 text-rmpg-400 hover:text-green-400"><Download className="w-3 h-3" /></a>
                  {isAdmin && <button aria-label="Delete" type="button" onClick={() => requestDeleteFile(file)} className="p-0.5 bg-rmpg-800/80 hover:bg-rmpg-600 text-rmpg-400 hover:text-red-400"><Trash2 className="w-3 h-3" /></button>}
                </div>
              </div>
            ) : (
              /* ── LIST VIEW ── */
              <div key={file.file_id}
                className={`flex items-center gap-3 px-3 py-2 hover:bg-rmpg-700/20 transition-colors border-b border-rmpg-800/20 ${selectedFiles.has(file.file_id) ? 'bg-brand-900/10' : ''}`}
                onContextMenu={(e) => openMenu(e, buildFileMenu(file))}
              >
                <button type="button" onClick={() => toggleSelect(file.file_id)} className="flex-shrink-0 text-rmpg-500 hover:text-brand-400">
                  {selectedFiles.has(file.file_id) ? <CheckSquare className="w-4 h-4 text-brand-400" /> : <Square className="w-4 h-4" />}
                </button>
                {(() => { const { Icon, tint } = getFileIconMeta(file.mime_type); return <Icon className={`w-4 h-4 flex-shrink-0 ${tint}`} />; })()}
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-medium text-rmpg-200 truncate block">{file.original_name}</span>
                  <span className="text-[9px] text-rmpg-500">{formatSize(file.file_size)} · {parseTimestamp(file.created_at).toLocaleDateString('en-US', { timeZone: 'America/Denver' })} · {file.mime_type?.split('/')[1]?.toUpperCase()}</span>
                </div>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => setInfoFile(file)}
                    className="p-1 hover:bg-rmpg-600 text-rmpg-400 hover:text-amber-400 transition-colors" title="File details">
                    <Info className="w-3 h-3" />
                  </button>
                  {file.mime_type === 'application/pdf' ? (
                    /* Route PDF previews through the internal viewer (PDF.js
                       loaded as a Web Worker, runs locally) instead of the
                       browser's native viewer (Chrome's PDFium / etc). This
                       keeps the entire view + edit experience consistent
                       across browsers and platforms, with no Google
                       components in the loop. */
                    <button type="button"
                      title="View"
                      onClick={() => {
                        const params = new URLSearchParams({ fileId: file.file_id, name: file.original_name, view: '1' });
                        if (currentFolderId != null) params.set('folderId', String(currentFolderId));
                        navigate(`/pdf-editor?${params.toString()}`);
                      }}
                      className="p-1 hover:bg-rmpg-600 text-rmpg-400 hover:text-brand-400 transition-colors">
                      <Eye className="w-3 h-3" />
                    </button>
                  ) : canPreview(file.mime_type) ? (
                    <a href={authedImageUrl(`/api/uploads/${file.file_id}`)} target="_blank" rel="noopener noreferrer"
                      className="p-1 hover:bg-rmpg-600 text-rmpg-400 hover:text-brand-400 transition-colors" title="View">
                      <Eye className="w-3 h-3" />
                    </a>
                  ) : null}
                  {file.mime_type === 'application/pdf' && (
                    <button type="button"
                      onClick={() => {
                        const params = new URLSearchParams({ fileId: file.file_id, name: file.original_name });
                        if (currentFolderId != null) params.set('folderId', String(currentFolderId));
                        navigate(`/pdf-editor?${params.toString()}`);
                      }}
                      className="p-1 hover:bg-rmpg-600 text-rmpg-400 hover:text-brand-400 transition-colors" title="Edit PDF">
                      <Pencil className="w-3 h-3" />
                    </button>
                  )}
                  <a href={authedImageUrl(`/api/uploads/${file.file_id}/download`)}
                    className="p-1 hover:bg-rmpg-600 text-rmpg-400 hover:text-green-400 transition-colors" title="Download">
                    <Download className="w-3 h-3" />
                  </a>
                  {isAdmin && (
                    <button type="button" onClick={() => requestDeleteFile(file)}
                      className="p-1 hover:bg-rmpg-600 text-rmpg-400 hover:text-red-400 transition-colors" title="Delete">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            ))}

            {/* Empty state */}
            {filteredFolders.length === 0 && filteredFiles.length === 0 && !loading && (
              <div className="text-center py-12">
                <FolderOpen className="w-10 h-10 text-rmpg-600 mx-auto mb-3" />
                <p className="text-sm text-rmpg-400 font-medium">
                  {searchQuery ? 'No results match your search' : currentFolderId ? 'This folder is empty' : 'No document folders yet'}
                </p>
                {!currentFolderId && !searchQuery && (
                  <p className="text-[10px] text-rmpg-600 mt-1">Folders are auto-created when process service documents are uploaded via Serve Intake</p>
                )}
                {/* Clickable drop zone for empty folders */}
                {!searchQuery && (
                  <button
                    type="button"
                    onClick={() => uploadInputRef.current?.click()}
                    className="mt-6 mx-auto flex flex-col items-center gap-3 px-12 py-10 border-2 border-dashed border-rmpg-700 hover:border-brand-500/60 hover:bg-brand-900/10 transition-colors group max-w-xs w-full"
                  >
                    <Upload className="w-8 h-8 text-rmpg-600 group-hover:text-brand-400 transition-colors" />
                    <span className="text-xs text-rmpg-500 group-hover:text-rmpg-300 transition-colors">Drop files here or click to browse</span>
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Status bar — shown in all view modes */}
      <div className="flex items-center gap-3 px-4 py-1 border-t border-rmpg-800/50 bg-surface-sunken text-[9px] text-rmpg-500 flex-shrink-0">
        <span>{filteredFolders.length > 0 ? `${filteredFolders.length} folder${filteredFolders.length !== 1 ? 's' : ''}` : ''}</span>
        {filteredFolders.length > 0 && filteredFiles.length > 0 && <span className="text-rmpg-700">·</span>}
        <span>{filteredFiles.length > 0 ? `${filteredFiles.length} file${filteredFiles.length !== 1 ? 's' : ''}` : ''}</span>
        {selectedFiles.size > 0 && (
          <>
            <span className="text-rmpg-700">·</span>
            <span className="text-brand-400">{selectedFiles.size} selected</span>
            <button type="button" onClick={requestBulkDelete} className="text-red-400 hover:text-red-300 ml-1">Delete selected</button>
          </>
        )}
        <span className="ml-auto">{storageStats.totalSize > 0 ? formatSize(storageStats.totalSize) : ''}</span>
      </div>

      {/* New Folder Modal */}
      {showNewFolder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="panel-surface w-full max-w-sm mx-4 p-4 space-y-3">
            <h3 className="text-xs font-bold text-rmpg-100 uppercase">New Folder</h3>
            <input id="ff-documentspage-2" type="text" className="input-dark text-xs w-full" placeholder="Folder name..."
              value={newFolderName} onChange={e => setNewFolderName(e.target.value)} autoFocus
              onKeyDown={e => { if (e.key === 'Enter') createFolder(); if (e.key === 'Escape') setShowNewFolder(false); }} />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowNewFolder(false)} className="toolbar-btn">Cancel</button>
              <button type="button" onClick={createFolder} className="toolbar-btn toolbar-btn-primary"><FolderPlus className="w-3 h-3" /> Create</button>
            </div>
          </div>
        </div>
      )}

      {/* Rename Folder Modal */}
      {renamingFolder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="panel-surface w-full max-w-sm mx-4 p-4 space-y-3">
            <h3 className="text-xs font-bold text-rmpg-100 uppercase">Rename Folder</h3>
            <input id="ff-documentspage-3" type="text" className="input-dark text-xs w-full" value={renameValue} onChange={e => setRenameValue(e.target.value)} autoFocus
              onKeyDown={e => { if (e.key === 'Enter') renameFolder(); if (e.key === 'Escape') setRenamingFolder(null); }} />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setRenamingFolder(null)} className="toolbar-btn">Cancel</button>
              <button type="button" onClick={renameFolder} className="toolbar-btn toolbar-btn-primary"><Edit2 className="w-3 h-3" /> Rename</button>
            </div>
          </div>
        </div>
      )}

      {/* File Info Panel */}
      {infoFile && (() => {
        const f = infoFile;
        const ext = f.original_name.split('.').pop()?.toUpperCase() || '?';
        const isImage = f.mime_type?.startsWith('image/');
        const isVideo = f.mime_type?.startsWith('video/');
        const isAudio = f.mime_type?.startsWith('audio/');
        const isPdf = f.mime_type === 'application/pdf';
        const category = isImage ? 'Image' : isVideo ? 'Video' : isAudio ? 'Audio' : isPdf ? 'PDF Document' : f.mime_type?.includes('word') ? 'Word Document' : f.mime_type?.includes('sheet') ? 'Spreadsheet' : 'File';
        const sizeKB = (f.file_size / 1024).toFixed(1);
        const sizeMB = (f.file_size / 1048576).toFixed(2);
        const created = parseTimestamp(f.created_at);

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setInfoFile(null)}>
            <div className="panel-surface w-full max-w-lg mx-4 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              {/* Header */}
              <div className="flex items-center gap-3 p-4 border-b border-rmpg-700">
                <div className="w-12 h-12 flex items-center justify-center bg-brand-900/30 border border-brand-700/50">
                  {(() => { const { Icon, tint } = getFileIconMeta(f.mime_type); return <Icon className={`w-7 h-7 ${tint}`} />; })()}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-bold text-rmpg-100 truncate">{f.original_name}</h3>
                  <p className="text-[10px] text-rmpg-400">{category} · .{ext}</p>
                </div>
                <button aria-label="Close" type="button" onClick={() => setInfoFile(null)} className="p-1 hover:bg-rmpg-600 text-rmpg-400 hover:text-rmpg-100">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Preview thumbnail */}
              {isImage && (
                <div className="p-4 border-b border-rmpg-700 bg-surface-sunken flex items-center justify-center">
                  <img src={authedImageUrl(`/api/uploads/${f.file_id}`)} alt={f.original_name}
                    className="max-h-[200px] max-w-full object-contain rounded-sm border border-rmpg-700" />
                </div>
              )}

              {/* Detail rows */}
              <div className="p-4 space-y-0.5">
                {/* File Identity */}
                <div className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wider mb-2 flex items-center gap-1"><FileText className="w-3 h-3" /> File Identity</div>
                <DetailRow icon={FileText} label="File Name" value={f.original_name} />
                <DetailRow icon={Hash} label="File ID" value={f.file_id} mono />
                <DetailRow icon={Shield} label="MIME Type" value={f.mime_type} mono />
                <DetailRow icon={FileText} label="Extension" value={`.${ext}`} />
                <DetailRow icon={FileText} label="Category" value={category} />

                {/* Size & Storage */}
                <div className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wider mt-4 mb-2 flex items-center gap-1"><HardDrive className="w-3 h-3" /> Size & Storage</div>
                <DetailRow icon={HardDrive} label="File Size" value={`${f.file_size.toLocaleString()} bytes`} />
                <DetailRow icon={HardDrive} label="Size (KB)" value={`${sizeKB} KB`} />
                <DetailRow icon={HardDrive} label="Size (MB)" value={`${sizeMB} MB`} />
                <DetailRow icon={HardDrive} label="Size Ratio" value={
                  f.file_size < 102400 ? 'Tiny (< 100 KB)' :
                  f.file_size < 1048576 ? 'Small (< 1 MB)' :
                  f.file_size < 10485760 ? 'Medium (< 10 MB)' :
                  f.file_size < 104857600 ? 'Large (< 100 MB)' : 'Very Large (100+ MB)'
                } />

                {/* Timestamps */}
                <div className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wider mt-4 mb-2 flex items-center gap-1"><Clock className="w-3 h-3" /> Timestamps</div>
                <DetailRow icon={Clock} label="Uploaded" value={created.toLocaleString('en-US', { timeZone: 'America/Denver', dateStyle: 'full', timeStyle: 'medium' })} />
                <DetailRow icon={Clock} label="Date" value={created.toLocaleDateString('en-US', { timeZone: 'America/Denver' })} />
                <DetailRow icon={Clock} label="Time" value={created.toLocaleTimeString('en-US', { timeZone: 'America/Denver', hour12: true })} />
                <DetailRow icon={Clock} label="Age" value={(() => {
                  const ms = Date.now() - created.getTime();
                  const days = Math.floor(ms / 86400000);
                  if (days === 0) return 'Today';
                  if (days === 1) return 'Yesterday';
                  if (days < 30) return `${days} days ago`;
                  if (days < 365) return `${Math.floor(days / 30)} months ago`;
                  return `${Math.floor(days / 365)} years ago`;
                })()} />

                {/* Media Info (type-specific) */}
                {(isImage || isVideo || isAudio || isPdf) && (
                  <>
                    <div className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wider mt-4 mb-2 flex items-center gap-1">
                      {isVideo ? <Film className="w-3 h-3" /> : isImage ? <ImageIcon className="w-3 h-3" /> : isAudio ? <Music className="w-3 h-3" /> : <FileText className="w-3 h-3" />}
                      Media Details
                    </div>
                    <DetailRow icon={FileText} label="Content Type" value={
                      isImage ? 'Raster Image' :
                      isVideo ? 'Video Recording' :
                      isAudio ? 'Audio Recording' :
                      'Portable Document Format'
                    } />
                    <DetailRow icon={FileText} label="Encoding" value={f.mime_type.split('/')[1]?.toUpperCase() || 'Unknown'} />
                    {isPdf && <DetailRow icon={FileText} label="Searchable" value="Yes (text layer)" />}
                    {isVideo && <DetailRow icon={Film} label="Playback" value="Browser native player" />}
                  </>
                )}

                {/* Folder Location */}
                {f.folder_id && (
                  <>
                    <div className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wider mt-4 mb-2 flex items-center gap-1"><FolderOpen className="w-3 h-3" /> Location</div>
                    <DetailRow icon={FolderOpen} label="Folder ID" value={String(f.folder_id)} mono />
                  </>
                )}
              </div>

              {/* Actions */}
              <div className="p-4 border-t border-rmpg-700 flex items-center gap-2">
                {canPreview(f.mime_type) && (
                  <a href={authedImageUrl(`/api/uploads/${f.file_id}`)} target="_blank" rel="noopener noreferrer" className="toolbar-btn flex-1 justify-center">
                    <Eye className="w-3 h-3" /> View
                  </a>
                )}
                <a href={authedImageUrl(`/api/uploads/${f.file_id}/download`)} className="toolbar-btn toolbar-btn-primary flex-1 justify-center">
                  <Download className="w-3 h-3" /> Download
                </a>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Destructive-action ConfirmDialogs ── */}
      <ConfirmDialog
        isOpen={!!pendingDeleteFolder}
        onClose={() => { if (!confirmBusy) setPendingDeleteFolder(null); }}
        onConfirm={performDeleteFolder}
        title="Delete Folder"
        message={pendingDeleteFolder
          ? `Delete "${pendingDeleteFolder.name}" and all subfolders? Files inside will be unlinked from this folder but not deleted from storage.`
          : ''}
        details={pendingDeleteFolder && (
          <>
            {pendingDeleteFolder.child_count > 0 && (
              <div>{pendingDeleteFolder.child_count} subfolder{pendingDeleteFolder.child_count !== 1 ? 's' : ''}</div>
            )}
            {pendingDeleteFolder.file_count > 0 && (
              <div>{pendingDeleteFolder.file_count} file{pendingDeleteFolder.file_count !== 1 ? 's' : ''} (will be unlinked, not deleted)</div>
            )}
          </>
        )}
        confirmLabel="Delete folder"
        confirmVariant="danger"
        isLoading={confirmBusy}
      />
      <ConfirmDialog
        isOpen={!!pendingDeleteFile}
        onClose={() => { if (!confirmBusy) setPendingDeleteFile(null); }}
        onConfirm={performDeleteFile}
        title="Delete File"
        message={pendingDeleteFile
          ? `Delete "${pendingDeleteFile.original_name}"? This removes the underlying R2 object and cannot be undone.`
          : ''}
        details={pendingDeleteFile && (
          <>
            <div>{formatSize(pendingDeleteFile.file_size)} · {pendingDeleteFile.mime_type}</div>
          </>
        )}
        confirmLabel="Delete file"
        confirmVariant="danger"
        isLoading={confirmBusy}
      />
      <ConfirmDialog
        isOpen={pendingBulkDelete}
        onClose={() => { if (!confirmBusy) setPendingBulkDelete(false); }}
        onConfirm={performBulkDelete}
        title="Delete Selected Files"
        message={`Delete ${selectedFiles.size} selected file${selectedFiles.size > 1 ? 's' : ''}? Each file is removed from R2 and cannot be recovered.`}
        confirmLabel={`Delete ${selectedFiles.size}`}
        confirmVariant="danger"
        isLoading={confirmBusy}
      />
    </div>
  );
}

// ── Detail Row component (outside main component to prevent re-render) ──
function DetailRow({ icon: Icon, label, value, mono }: { icon: React.ElementType; label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center gap-2 py-1.5 border-b border-rmpg-800/30 text-[11px]">
      <Icon className="w-3 h-3 text-rmpg-500 flex-shrink-0" />
      <span className="text-rmpg-400 w-24 flex-shrink-0">{label}</span>
      <span className={`text-rmpg-200 min-w-0 flex-1 truncate ${mono ? 'font-mono text-[10px]' : ''}`}>{value}</span>
    </div>
  );
}
