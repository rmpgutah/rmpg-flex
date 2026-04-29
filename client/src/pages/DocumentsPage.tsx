import React, { useState, useEffect, useCallback } from 'react';
import {
  FolderOpen, File, ChevronRight, Plus, Trash2, Edit2, Download,
  ArrowLeft, Loader2, Upload, X, FolderPlus, Home, Search, Eye,
  Info, FileText, HardDrive, Clock, User, Hash, Shield, Film, Image, Music,
  Grid3X3, List, ArrowUpDown, CheckSquare, Square, Copy, Move,
  BarChart3, Filter, Pencil,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { apiFetch, authedImageUrl } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import { useToast } from '../components/ToastProvider';
import { useAuth } from '../context/AuthContext';

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
  const [folders, setFolders] = useState<Folder[]>([]);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [breadcrumbs, setBreadcrumbs] = useState<{ id: number; name: string }[]>([]);
  const [currentFolderId, setCurrentFolderId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  // Modal state
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [renamingFolder, setRenamingFolder] = useState<Folder | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [uploading, setUploading] = useState(false);
  const [infoFile, setInfoFile] = useState<FileItem | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [sortBy, setSortBy] = useState<'name' | 'size' | 'date' | 'type'>('name');
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [dragOver, setDragOver] = useState(false);
  const [filterType, setFilterType] = useState<string | null>(null);
  const uploadInputRef = React.useRef<HTMLInputElement>(null);
  const dropZoneRef = React.useRef<HTMLDivElement>(null);
  const isAdmin = user?.role === 'admin' || user?.role === 'manager' || user?.role === 'supervisor';

  // Clear selection when navigating
  useEffect(() => { setSelectedFiles(new Set()); }, [currentFolderId]);

  const handleFileUpload = async (fileList: FileList) => {
    if (!fileList.length) return;
    setUploading(true);
    const token = localStorage.getItem('rmpg_token');
    let successCount = 0;
    for (const file of Array.from(fileList)) {
      const formData = new FormData();
      formData.append('files', file);
      if (currentFolderId) {
        formData.append('entity_type', 'document_folder');
        formData.append('entity_id', String(currentFolderId));
      }
      try {
        const resp = await fetch('/api/uploads', {
          method: 'POST',
          headers: token ? { 'Authorization': `Bearer ${token}` } : {},
          body: formData,
        });
        if (resp.ok) {
          const results = await resp.json();
          // Link the uploaded file to the current folder
          if (currentFolderId && results?.[0]?.file_id) {
            await apiFetch(`/documents/folders/${currentFolderId}/move-file`, {
              method: 'POST',
              body: JSON.stringify({ file_id: results[0].file_id }),
            }).catch(() => {});
          }
          successCount++;
        }
      } catch { /* continue with next file */ }
    }
    setUploading(false);
    if (successCount > 0) {
      addToast(`${successCount} file${successCount > 1 ? 's' : ''} uploaded`, 'success');
      fetchContents(currentFolderId);
    }
  };

  const fetchContents = useCallback(async (folderId: number | null) => {
    setLoading(true);
    try {
      const params = folderId ? `?parent_id=${folderId}` : '';
      const data = await apiFetch<{ folders: Folder[]; files: FileItem[]; breadcrumbs: { id: number; name: string }[] }>(`/documents/folders${params}`);
      setFolders(data.folders || []);
      setFiles(data.files || []);
      setBreadcrumbs(data.breadcrumbs || []);
    } catch (err: any) {
      addToast(err.message || 'Failed to load documents', 'error');
    }
    setLoading(false);
  }, [addToast]);

  useEffect(() => { fetchContents(currentFolderId); }, [currentFolderId, fetchContents]);

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

  const deleteFolder = async (folder: Folder) => {
    if (!confirm(`Delete folder "${folder.name}" and all subfolders? Files will be unlinked but not deleted.`)) return;
    try {
      await apiFetch(`/documents/folders/${folder.id}`, { method: 'DELETE' });
      fetchContents(currentFolderId);
      addToast('Folder deleted', 'success');
    } catch (err: any) { addToast(err.message || 'Failed to delete', 'error'); }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  };

  // File delete
  const deleteFile = async (file: FileItem) => {
    if (!confirm(`Delete "${file.original_name}"? This cannot be undone.`)) return;
    try {
      await apiFetch(`/uploads/${file.file_id}`, { method: 'DELETE' });
      fetchContents(currentFolderId);
      addToast('File deleted', 'success');
      setSelectedFiles(prev => { const n = new Set(prev); n.delete(file.file_id); return n; });
    } catch (err: any) { addToast(err.message || 'Failed to delete', 'error'); }
  };

  // Bulk delete
  const bulkDelete = async () => {
    if (selectedFiles.size === 0) return;
    if (!confirm(`Delete ${selectedFiles.size} selected file${selectedFiles.size > 1 ? 's' : ''}?`)) return;
    let count = 0;
    for (const fid of selectedFiles) {
      try { await apiFetch(`/uploads/${fid}`, { method: 'DELETE' }); count++; } catch { /* continue */ }
    }
    setSelectedFiles(new Set());
    fetchContents(currentFolderId);
    addToast(`${count} file${count > 1 ? 's' : ''} deleted`, 'success');
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

  // Drag and drop onto file area
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setDragOver(true); };
  const handleDragLeave = () => setDragOver(false);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setDragOver(false);
    if (e.dataTransfer.files.length > 0) handleFileUpload(e.dataTransfer.files);
  };

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

  const getFileIcon = (mime: string) => {
    if (mime?.startsWith('image/')) return '🖼️';
    if (mime === 'application/pdf') return '📄';
    if (mime?.startsWith('video/')) return '🎬';
    if (mime?.startsWith('audio/')) return '🎵';
    if (mime?.includes('word') || mime?.includes('document')) return '📝';
    if (mime?.includes('sheet') || mime?.includes('excel')) return '📊';
    if (mime?.includes('zip') || mime?.includes('compressed')) return '📦';
    if (mime?.includes('text/')) return '📃';
    return '📎';
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

  return (
    <div className="h-full flex flex-col">
      <PanelTitleBar title="DOCUMENTS / UPLOAD RECORDS" icon={FolderOpen}>
        <button type="button" onClick={() => uploadInputRef.current?.click()} disabled={uploading} className="toolbar-btn toolbar-btn-primary">
          {uploading ? <Loader2 style={{ width: 10, height: 10 }} className="animate-spin" /> : <Upload style={{ width: 10, height: 10 }} />}
          {uploading ? 'Uploading...' : 'Upload Files'}
        </button>
        <input ref={uploadInputRef} type="file" multiple className="hidden"
          onChange={e => { if (e.target.files) handleFileUpload(e.target.files); e.target.value = ''; }} />
        {isAdmin && (
          <button type="button" onClick={() => setShowNewFolder(true)} className="toolbar-btn">
            <FolderPlus style={{ width: 10, height: 10 }} /> New Folder
          </button>
        )}
      </PanelTitleBar>

      {/* Breadcrumb navigation */}
      <div className="px-4 py-2 border-b border-rmpg-700 flex items-center gap-1 text-[11px] bg-surface-sunken overflow-x-auto">
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
          <input type="text" className="input-dark pl-9 w-full text-[11px]" placeholder="Search folders and files..."
            value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
          {searchQuery && (
            <button type="button" onClick={() => setSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-rmpg-400 hover:text-white">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Toolbar: view toggle + sort + filter + bulk actions + stats */}
      <div className="px-4 py-1.5 border-b border-rmpg-700/50 bg-surface-sunken flex items-center gap-2 text-[9px] flex-wrap">
        {/* View toggle */}
        <button type="button" onClick={() => setViewMode(viewMode === 'list' ? 'grid' : 'list')}
          className="p-1 hover:bg-rmpg-600 text-rmpg-400 hover:text-white transition-colors" title={viewMode === 'list' ? 'Grid view' : 'List view'}>
          {viewMode === 'list' ? <Grid3X3 className="w-3.5 h-3.5" /> : <List className="w-3.5 h-3.5" />}
        </button>
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
            <button type="button" onClick={bulkDelete} className="px-1.5 py-0.5 text-red-400 hover:text-red-300 border border-red-700/50 hover:bg-red-900/20 font-medium">
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
      <div ref={dropZoneRef} className={`flex-1 overflow-auto p-4 transition-colors ${dragOver ? 'bg-brand-900/10 ring-2 ring-brand-500/50 ring-inset' : ''}`}
        onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
        {dragOver && (
          <div className="flex items-center justify-center py-8 mb-4 border-2 border-dashed border-brand-500/50 bg-brand-900/5 text-brand-400 text-sm font-bold">
            <Upload className="w-5 h-5 mr-2" /> Drop files here to upload
          </div>
        )}
        {loading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-rmpg-400" /></div>
        ) : (
          <div className={viewMode === 'grid' ? 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2' : 'space-y-1'}>
            {/* Back button */}
            {currentFolderId && (
              <button type="button"
                onClick={() => navigateTo(breadcrumbs.length > 1 ? breadcrumbs[breadcrumbs.length - 2].id : null)}
                className="flex items-center gap-2 px-3 py-2 w-full text-left hover:bg-rmpg-700/30 transition-colors text-xs text-rmpg-400"
              >
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
            )}

            {/* Folders */}
            {filteredFolders.map(folder => (
              <div key={folder.id}
                className="flex items-center gap-3 px-3 py-2.5 hover:bg-rmpg-700/30 cursor-pointer transition-colors group border-b border-rmpg-800/30"
                onClick={() => navigateTo(folder.id)}
                onKeyDown={e => { if (e.key === 'Enter') navigateTo(folder.id); }}
                tabIndex={0} role="button"
              >
                <FolderOpen className="w-5 h-5 text-amber-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-white truncate block">{folder.name}</span>
                  <span className="text-[9px] text-rmpg-500">
                    {folder.child_count > 0 ? `${folder.child_count} folder${folder.child_count !== 1 ? 's' : ''}` : ''}
                    {folder.child_count > 0 && folder.file_count > 0 ? ' · ' : ''}
                    {folder.file_count > 0 ? `${folder.file_count} file${folder.file_count !== 1 ? 's' : ''}` : ''}
                    {!folder.child_count && !folder.file_count ? 'Empty' : ''}
                  </span>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                  {isAdmin && (
                    <>
                      <button type="button" onClick={() => { setRenamingFolder(folder); setRenameValue(folder.name); }}
                        className="p-1 hover:bg-rmpg-600 text-rmpg-400 hover:text-brand-400 transition-colors" title="Rename">
                        <Edit2 className="w-3 h-3" />
                      </button>
                      <button type="button" onClick={() => deleteFolder(folder)}
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
              >
                <span className="text-3xl">{getFileIcon(file.mime_type)}</span>
                <span className="text-[10px] text-rmpg-200 text-center truncate w-full font-medium">{file.original_name}</span>
                <span className="text-[8px] text-rmpg-500">{formatSize(file.file_size)}</span>
                {/* Hover actions */}
                <div className="absolute top-1 right-1 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                  <button type="button" onClick={() => setInfoFile(file)} className="p-0.5 bg-rmpg-800/80 hover:bg-rmpg-600 text-rmpg-400 hover:text-amber-400"><Info className="w-3 h-3" /></button>
                  {file.mime_type === 'application/pdf' && (
                    <button type="button"
                      title="Edit PDF"
                      onClick={() => {
                        const params = new URLSearchParams({ fileId: file.file_id, name: file.original_name });
                        if (currentFolderId != null) params.set('folderId', String(currentFolderId));
                        navigate(`/pdf-editor?${params.toString()}`);
                      }}
                      className="p-0.5 bg-rmpg-800/80 hover:bg-rmpg-600 text-rmpg-400 hover:text-[#d4a017]"><Pencil className="w-3 h-3" /></button>
                  )}
                  <a href={authedImageUrl(`/api/uploads/${file.file_id}/download`)} className="p-0.5 bg-rmpg-800/80 hover:bg-rmpg-600 text-rmpg-400 hover:text-green-400"><Download className="w-3 h-3" /></a>
                  {isAdmin && <button type="button" onClick={() => deleteFile(file)} className="p-0.5 bg-rmpg-800/80 hover:bg-rmpg-600 text-rmpg-400 hover:text-red-400"><Trash2 className="w-3 h-3" /></button>}
                </div>
              </div>
            ) : (
              /* ── LIST VIEW ── */
              <div key={file.file_id}
                className={`flex items-center gap-3 px-3 py-2 hover:bg-rmpg-700/20 transition-colors border-b border-rmpg-800/20 ${selectedFiles.has(file.file_id) ? 'bg-brand-900/10' : ''}`}
              >
                <button type="button" onClick={() => toggleSelect(file.file_id)} className="flex-shrink-0 text-rmpg-500 hover:text-brand-400">
                  {selectedFiles.has(file.file_id) ? <CheckSquare className="w-4 h-4 text-brand-400" /> : <Square className="w-4 h-4" />}
                </button>
                <span className="text-lg flex-shrink-0">{getFileIcon(file.mime_type)}</span>
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-medium text-rmpg-200 truncate block">{file.original_name}</span>
                  <span className="text-[9px] text-rmpg-500">{formatSize(file.file_size)} · {new Date(file.created_at).toLocaleDateString()} · {file.mime_type?.split('/')[1]?.toUpperCase()}</span>
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
                      className="p-1 hover:bg-rmpg-600 text-rmpg-400 hover:text-[#d4a017] transition-colors" title="Edit PDF">
                      <Pencil className="w-3 h-3" />
                    </button>
                  )}
                  <a href={authedImageUrl(`/api/uploads/${file.file_id}/download`)}
                    className="p-1 hover:bg-rmpg-600 text-rmpg-400 hover:text-green-400 transition-colors" title="Download">
                    <Download className="w-3 h-3" />
                  </a>
                  {isAdmin && (
                    <button type="button" onClick={() => deleteFile(file)}
                      className="p-1 hover:bg-rmpg-600 text-rmpg-400 hover:text-red-400 transition-colors" title="Delete">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            ))}

            {/* Empty state */}
            {filteredFolders.length === 0 && filteredFiles.length === 0 && !loading && (
              <div className="text-center py-16">
                <FolderOpen className="w-10 h-10 text-rmpg-600 mx-auto mb-3" />
                <p className="text-sm text-rmpg-400 font-medium">
                  {searchQuery ? 'No results match your search' : currentFolderId ? 'This folder is empty' : 'No document folders yet'}
                </p>
                <p className="text-[10px] text-rmpg-600 mt-1">
                  {!currentFolderId && !searchQuery && 'Folders are auto-created when process service documents are uploaded via Serve Intake'}
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* New Folder Modal */}
      {showNewFolder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="panel-surface w-full max-w-sm mx-4 p-4 space-y-3">
            <h3 className="text-xs font-bold text-white uppercase">New Folder</h3>
            <input type="text" className="input-dark text-xs w-full" placeholder="Folder name..."
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
            <h3 className="text-xs font-bold text-white uppercase">Rename Folder</h3>
            <input type="text" className="input-dark text-xs w-full" value={renameValue} onChange={e => setRenameValue(e.target.value)} autoFocus
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
        const created = new Date(f.created_at);

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setInfoFile(null)}>
            <div className="panel-surface w-full max-w-lg mx-4 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              {/* Header */}
              <div className="flex items-center gap-3 p-4 border-b border-rmpg-700">
                <div className="w-12 h-12 flex items-center justify-center bg-brand-900/30 border border-brand-700/50 text-2xl">
                  {getFileIcon(f.mime_type)}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-bold text-white truncate">{f.original_name}</h3>
                  <p className="text-[10px] text-rmpg-400">{category} · .{ext}</p>
                </div>
                <button type="button" onClick={() => setInfoFile(null)} className="p-1 hover:bg-rmpg-600 text-rmpg-400 hover:text-white">
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
                      {isVideo ? <Film className="w-3 h-3" /> : isImage ? <Image className="w-3 h-3" /> : isAudio ? <Music className="w-3 h-3" /> : <FileText className="w-3 h-3" />}
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
    </div>
  );
}

// ── Detail Row component (outside main component to prevent re-render) ──
function DetailRow({ icon: Icon, label, value, mono }: { icon: React.ElementType; label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center gap-2 py-1.5 border-b border-rmpg-800/30 text-[11px]">
      <Icon className="w-3 h-3 text-rmpg-500 flex-shrink-0" />
      <span className="text-rmpg-400 w-24 flex-shrink-0">{label}</span>
      <span className={`text-rmpg-200 flex-1 truncate ${mono ? 'font-mono text-[10px]' : ''}`}>{value}</span>
    </div>
  );
}
