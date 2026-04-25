import React, { useState, useEffect, useCallback } from 'react';
import {
  FolderOpen, File, ChevronRight, Plus, Trash2, Edit2, Download,
  ArrowLeft, Loader2, Upload, X, FolderPlus, Home, Search, Eye,
} from 'lucide-react';
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
  const uploadInputRef = React.useRef<HTMLInputElement>(null);
  const isAdmin = user?.role === 'admin' || user?.role === 'manager' || user?.role === 'supervisor';

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

  // Filter
  const q = searchQuery.toLowerCase();
  const filteredFolders = q ? folders.filter(f => f.name.toLowerCase().includes(q)) : folders;
  const filteredFiles = q ? files.filter(f => f.original_name.toLowerCase().includes(q)) : files;

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

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-rmpg-400" /></div>
        ) : (
          <div className="space-y-1">
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

            {/* Files */}
            {filteredFiles.map(file => (
              <div key={file.file_id}
                className="flex items-center gap-3 px-3 py-2 hover:bg-rmpg-700/20 transition-colors border-b border-rmpg-800/20"
              >
                <span className="text-lg flex-shrink-0">{getFileIcon(file.mime_type)}</span>
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-medium text-rmpg-200 truncate block">{file.original_name}</span>
                  <span className="text-[9px] text-rmpg-500">{formatSize(file.file_size)} · {new Date(file.created_at).toLocaleDateString()}</span>
                </div>
                <div className="flex items-center gap-1">
                  {canPreview(file.mime_type) && (
                    <a href={authedImageUrl(`/api/uploads/${file.file_id}`)} target="_blank" rel="noopener noreferrer"
                      className="p-1 hover:bg-rmpg-600 text-rmpg-400 hover:text-brand-400 transition-colors" title="View">
                      <Eye className="w-3 h-3" />
                    </a>
                  )}
                  <a href={authedImageUrl(`/api/uploads/${file.file_id}/download`)}
                    className="p-1 hover:bg-rmpg-600 text-rmpg-400 hover:text-green-400 transition-colors" title="Download">
                    <Download className="w-3 h-3" />
                  </a>
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
    </div>
  );
}
