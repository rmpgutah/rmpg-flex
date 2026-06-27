// Windows-style desktop icon grid for files and folders.
// Used by DocumentsPage as the default view; re-exported for use in
// case/person/evidence detail panels systemwide.

import React, { useRef } from 'react';
import {
  FolderOpen, FileText, Film, Music, Image, Archive,
  FileSpreadsheet, FileCode, FileJson, File,
} from 'lucide-react';
import { authedImageUrl } from '../../hooks/useApi';

export interface DossierFolder {
  id: number;
  name: string;
  child_count: number;
  file_count: number;
}

export interface DossierFile {
  id: number;
  file_id: string;
  original_name: string;
  mime_type: string;
  file_size: number;
  created_at: string;
}

interface Props {
  folders: DossierFolder[];
  files: DossierFile[];
  selectedFiles: Set<string>;
  onFolderOpen: (id: number) => void;
  onFileOpen: (file: DossierFile) => void;
  onFileSelect: (fileId: string, multi: boolean) => void;
  onFolderContextMenu: (e: React.MouseEvent, folder: DossierFolder) => void;
  onFileContextMenu: (e: React.MouseEvent, file: DossierFile) => void;
  // Optional: rendered before tiles (back button, shelf widgets, etc.)
  headerSlot?: React.ReactNode;
  // 3-state empty: loading hides the tile area, searchQuery differentiates
  // "no results" from "folder is empty".
  isLoading?: boolean;
  searchQuery?: string;
}

// ── Type metadata ──────────────────────────────────────────────────────────
interface TypeMeta {
  bg: string;
  border: string;
  label: string;
  Icon: React.FC<{ size?: number; className?: string }>;
}

function getTypeMeta(mime: string): TypeMeta {
  if (!mime) return { bg: 'bg-rmpg-700', border: 'border-rmpg-600', label: 'FILE', Icon: File };
  if (mime === 'application/pdf') return { bg: 'bg-red-900/70', border: 'border-red-700/60', label: 'PDF', Icon: FileText };
  if (mime.startsWith('image/')) return { bg: 'bg-blue-900/70', border: 'border-blue-700/60', label: mime.split('/')[1]?.toUpperCase().slice(0, 4) || 'IMG', Icon: Image };
  if (mime.startsWith('video/')) return { bg: 'bg-purple-900/70', border: 'border-purple-700/60', label: mime.split('/')[1]?.toUpperCase().slice(0, 4) || 'VID', Icon: Film };
  if (mime.startsWith('audio/')) return { bg: 'bg-teal-900/70', border: 'border-teal-700/60', label: mime.split('/')[1]?.toUpperCase().slice(0, 4) || 'AUD', Icon: Music };
  if (mime.includes('word') || mime.includes('document')) return { bg: 'bg-blue-800/70', border: 'border-blue-600/60', label: 'DOC', Icon: FileText };
  if (mime.includes('sheet') || mime.includes('excel') || mime.includes('csv')) return { bg: 'bg-green-900/70', border: 'border-green-700/60', label: 'XLS', Icon: FileSpreadsheet };
  if (mime.includes('zip') || mime.includes('compressed') || mime.includes('tar') || mime.includes('gzip')) return { bg: 'bg-amber-900/70', border: 'border-amber-700/60', label: 'ZIP', Icon: Archive };
  if (mime.includes('json')) return { bg: 'bg-indigo-900/70', border: 'border-indigo-700/60', label: 'JSON', Icon: FileJson };
  if (mime.includes('text/') || mime.includes('plain')) return { bg: 'bg-rmpg-700/80', border: 'border-rmpg-600', label: 'TXT', Icon: FileCode };
  if (mime.includes('html') || mime.includes('xml')) return { bg: 'bg-orange-900/70', border: 'border-orange-700/60', label: 'HTML', Icon: FileCode };
  return { bg: 'bg-rmpg-700', border: 'border-rmpg-600', label: 'FILE', Icon: File };
}

// ── Tile sub-components ────────────────────────────────────────────────────

function FolderTile({ folder, onOpen, onContextMenu }: {
  folder: DossierFolder;
  onOpen: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const count = folder.child_count + folder.file_count;
  return (
    <button
      type="button"
      className="dossier-tile group"
      onDoubleClick={onOpen}
      onContextMenu={onContextMenu}
      title={folder.name}
      aria-label={`Folder: ${folder.name}`}
    >
      <div className="dossier-tile-icon bg-amber-900/50 border border-amber-600/40 group-hover:bg-amber-900/70 group-hover:border-amber-500/60">
        <FolderOpen size={30} className="text-amber-400" />
        {count > 0 && (
          <span className="absolute bottom-1 right-1 text-[8px] font-bold text-amber-300/80 leading-none tabular-nums">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </div>
      <span className="dossier-tile-label">{folder.name}</span>
    </button>
  );
}

function FileTile({ file, selected, onSingleClick, onDoubleClick, onContextMenu }: {
  file: DossierFile;
  selected: boolean;
  onSingleClick: (multi: boolean) => void;
  onDoubleClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const meta = getTypeMeta(file.mime_type);
  const isImage = file.mime_type?.startsWith('image/');
  const isVideo = file.mime_type?.startsWith('video/');
  const lastClickRef = useRef<{ time: number; id: string } | null>(null);

  const handleClick = (e: React.MouseEvent) => {
    const now = Date.now();
    const last = lastClickRef.current;
    if (last && last.id === file.file_id && now - last.time < 350) {
      onDoubleClick();
      lastClickRef.current = null;
    } else {
      lastClickRef.current = { time: now, id: file.file_id };
      onSingleClick(e.ctrlKey || e.metaKey || e.shiftKey);
    }
  };

  return (
    <button
      type="button"
      className={`dossier-tile group ${selected ? 'dossier-tile-selected' : ''}`}
      onClick={handleClick}
      onContextMenu={onContextMenu}
      title={file.original_name}
      aria-label={`File: ${file.original_name}`}
      aria-pressed={selected}
    >
      <div className={`dossier-tile-icon relative ${selected ? 'ring-2 ring-brand-400' : ''} ${meta.bg} border ${meta.border} group-hover:brightness-110`}>
        {isImage ? (
          <img
            src={authedImageUrl(`/api/uploads/${file.file_id}/thumbnail`)}
            alt=""
            className="w-full h-full object-cover"
            loading="lazy"
            onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
          />
        ) : isVideo ? (
          <div className="w-full h-full flex items-center justify-center relative">
            <Film size={28} className="text-purple-300/80" />
            <span className="absolute bottom-1 right-1 text-[8px] font-bold text-purple-300/80 leading-none uppercase">
              {meta.label}
            </span>
          </div>
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-1">
            <meta.Icon size={26} className="text-white/70" />
            <span className="text-[9px] font-bold text-white/50 leading-none uppercase tracking-wide">{meta.label}</span>
          </div>
        )}
      </div>
      <span className="dossier-tile-label">{file.original_name}</span>
    </button>
  );
}

// ── Grid ──────────────────────────────────────────────────────────────────

export default function DossierGrid({
  folders, files, selectedFiles,
  onFolderOpen, onFileOpen, onFileSelect,
  onFolderContextMenu, onFileContextMenu,
  headerSlot,
  isLoading = false,
  searchQuery = '',
}: Props) {
  const isEmpty = folders.length === 0 && files.length === 0;

  return (
    <div className="flex flex-wrap content-start gap-2 p-4 select-none">
      {headerSlot}

      {!isLoading && folders.map(folder => (
        <FolderTile
          key={`folder-${folder.id}`}
          folder={folder}
          onOpen={() => onFolderOpen(folder.id)}
          onContextMenu={e => onFolderContextMenu(e, folder)}
        />
      ))}

      {!isLoading && files.map(file => (
        <FileTile
          key={`file-${file.file_id}`}
          file={file}
          selected={selectedFiles.has(file.file_id)}
          onSingleClick={multi => onFileSelect(file.file_id, multi)}
          onDoubleClick={() => onFileOpen(file)}
          onContextMenu={e => onFileContextMenu(e, file)}
        />
      ))}

      {/* 3-state empty: loading / no-results / no-data */}
      {isLoading && (
        <div className="w-full py-16 flex flex-col items-center justify-center gap-2 text-rmpg-500">
          <FolderOpen size={40} className="text-rmpg-700 animate-pulse" />
          <span className="text-[11px]">Loading…</span>
        </div>
      )}
      {!isLoading && isEmpty && searchQuery.trim() !== '' && (
        <div className="w-full py-16 flex flex-col items-center justify-center gap-2 text-rmpg-500">
          <FolderOpen size={40} className="text-rmpg-700" />
          <span className="text-[11px]">No results match your search</span>
        </div>
      )}
      {!isLoading && isEmpty && searchQuery.trim() === '' && (
        <div className="w-full py-16 flex flex-col items-center justify-center gap-2 text-rmpg-500">
          <FolderOpen size={40} className="text-rmpg-700" />
          <span className="text-[11px]">This folder is empty</span>
        </div>
      )}
    </div>
  );
}
