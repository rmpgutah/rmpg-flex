import React, { useState, useEffect, useCallback } from 'react';
import { X, Folder, FolderOpen, File, RefreshCw, ExternalLink, Trash2, Download, Copy, Search, ArrowUpDown } from 'lucide-react';
import { useDraggablePosition } from '../../../hooks/useDraggablePosition';
import { formatDateTime } from '../../../utils/dateUtils';
import { downloadTextFile, fileListingToCsv } from '../../../utils/rmsListExport';

const W = 620;
const H = 480;

interface DesktopFileManagerProps {
  onClose: () => void;
}

interface FileEntry {
  name: string;
  size: number;
  modified: string;
  path: string;
}

interface ElectronApi {
  fsListDir?: (subdir: string) => Promise<FileEntry[] | undefined>;
  fsOpenFolder?: (subdir: string) => Promise<void>;
}

const CATEGORIES = [
  { label: 'Logs', subdir: 'logs' },
  { label: 'Evidence', subdir: 'evidence' },
  { label: 'Exports', subdir: 'exports' },
  { label: 'Voice Memos', subdir: 'voice-memos' },
  { label: 'Crash Reports', subdir: 'Crashpad/reports' },
];

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function fmtDate(iso: string): string {
  try {
    return formatDateTime(iso);
  } catch {
    return iso;
  }
}

export default function DesktopFileManager({ onClose }: DesktopFileManagerProps) {
  const [pos, setPos] = useState({ x: Math.max(0, (window.innerWidth - W) / 2), y: Math.max(0, (window.innerHeight - H) / 4) });
  const { onPointerDown } = useDraggablePosition(pos.x, pos.y, (x, y) => setPos({ x, y }));
  const [selectedCat, setSelectedCat] = useState(0);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<FileEntry | null>(null);
  const [fileQuery, setFileQuery] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'size' | 'modified'>('name');

  const api = (window as unknown as Record<string, unknown>).electron as ElectronApi | undefined;
  const hasElectron = !!api?.fsListDir;

  const load = useCallback(async () => {
    if (!hasElectron || !api?.fsListDir) { setError('Feature requires the Rocky Mountain Protective Group desktop app.'); return; }
    setLoading(true);
    setError('');
    const subdir = CATEGORIES[selectedCat].subdir;
    try {
      const result = await api.fsListDir(subdir);
      if (!result) { setFiles([]); setError('Directory not found or not accessible.'); }
      else { setFiles(result); }
    } catch (e) {
      setFiles([]);
      setError('Unable to list directory.');
      console.error('[DesktopFileManager] fsListDir error:', e);
    } finally {
      setLoading(false);
    }
  }, [hasElectron, api, selectedCat]);

  useEffect(() => { load(); }, [load]);

  const openFolder = useCallback(async () => {
    if (!api?.fsOpenFolder) return;
    await api.fsOpenFolder(CATEGORIES[selectedCat].subdir).catch(() => {});
  }, [api, selectedCat]);

  const totalSize = files.reduce((acc, f) => acc + f.size, 0);
  const visibleFiles = files
    .filter((f) => {
      const q = fileQuery.trim().toLowerCase();
      if (!q) return true;
      return f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q);
    })
    .sort((a, b) => {
      if (sortBy === 'size') return b.size - a.size;
      if (sortBy === 'modified') return String(b.modified).localeCompare(String(a.modified));
      return a.name.localeCompare(b.name);
    });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (deleteTarget) setDeleteTarget(null);
        else onClose();
      }
      if ((e.key === 'r' || e.key === 'R') && !['INPUT'].includes((e.target as HTMLElement)?.tagName)) load();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [deleteTarget, onClose, load]);

  const handleDeleteConfirm = useCallback(() => {
    // File deletion is not exposed via current IPC — inform user
    setDeleteTarget(null);
    setError('File deletion is not supported in this version. Use "Open Folder" to manage files directly.');
    setTimeout(() => setError(''), 4000);
  }, []);

  const leftStyle: React.CSSProperties = {
    width: 160, flexShrink: 0, background: 'var(--surface-sunken)',
    borderRight: '1px solid var(--border-subtle)', overflowY: 'auto',
    display: 'flex', flexDirection: 'column',
  };

  return (
    <div style={{
      position: 'fixed', left: pos.x, top: pos.y, width: W, height: H,
      background: 'var(--surface-raised)', border: '1px solid var(--border-default)',
      borderRadius: 2, boxShadow: '0 8px 32px rgba(0 0 0 / 0.45)', zIndex: 20100,
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      {/* Title bar */}
      <div onPointerDown={onPointerDown} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px', height: 32, background: 'var(--surface-sunken)', cursor: 'move', flexShrink: 0, borderBottom: '1px solid var(--border-default)' }}>
        <FolderOpen size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-primary)', flex: 1 }}>File Manager</span>
        <button aria-label="Close File Manager" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}>
          <X size={14} />
        </button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Left panel */}
        <div style={leftStyle}>
          <div style={{ padding: '6px 8px', fontSize: 9, fontWeight: 600, color: 'var(--field-label-color)', letterSpacing: '0.08em', textTransform: 'uppercase', borderBottom: '1px solid var(--border-subtle)' }}>Locations</div>
          {CATEGORIES.map((c, i) => (
            <button
              key={c.subdir}
              type="button"
              onClick={() => setSelectedCat(i)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px', fontSize: 11,
                background: selectedCat === i ? 'var(--surface-base)' : 'none',
                border: 'none', cursor: 'pointer', width: '100%', textAlign: 'left',
                color: selectedCat === i ? 'var(--text-primary)' : 'var(--text-secondary)',
                borderLeft: selectedCat === i ? '2px solid var(--brand-400)' : '2px solid transparent',
              }}
            >
              <Folder size={12} style={{ flexShrink: 0 }} />
              {c.label}
            </button>
          ))}
        </div>

        {/* Right panel */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Toolbar */}
          <div style={{ display: 'flex', gap: 6, padding: '5px 10px', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0, alignItems: 'center' }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)', flex: 1 }}>{CATEGORIES[selectedCat].label}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1 }}>
              <Search size={10} style={{ color: 'var(--text-muted)' }} />
              <input value={fileQuery} onChange={e => setFileQuery(e.target.value)} placeholder="Filter files"
                style={{ flex: 1, fontSize: 10, background: 'var(--surface-base)', border: '1px solid var(--border-subtle)', borderRadius: 2, color: 'var(--text-primary)', padding: '2px 6px' }} />
            </div>
            <button type="button" onClick={() => setSortBy(s => s === 'name' ? 'size' : s === 'size' ? 'modified' : 'name')}
              title={`Sort: ${sortBy}`}
              style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, padding: '3px 8px', background: 'none', border: '1px solid var(--border-subtle)', borderRadius: 2, cursor: 'pointer', color: 'var(--text-secondary)' }}>
              <ArrowUpDown size={10} /> {sortBy}
            </button>
            <button type="button" disabled={visibleFiles.length === 0}
              onClick={() => downloadTextFile(`${CATEGORIES[selectedCat].label.replace(/\s+/g, '-').toLowerCase()}.csv`, fileListingToCsv(visibleFiles))}
              style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, padding: '3px 8px', background: 'none', border: '1px solid var(--border-subtle)', borderRadius: 2, cursor: 'pointer', color: 'var(--text-secondary)', opacity: visibleFiles.length === 0 ? 0.4 : 1 }}>
              <Download size={10} /> CSV
            </button>
            <button onClick={openFolder} title="Open in system file manager" style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, padding: '3px 8px', background: 'none', border: '1px solid var(--border-subtle)', borderRadius: 2, cursor: 'pointer', color: 'var(--text-secondary)' }}>
              <ExternalLink size={10} /> Open Folder
            </button>
            <button onClick={load} style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, padding: '3px 8px', background: 'none', border: '1px solid var(--border-subtle)', borderRadius: 2, cursor: 'pointer', color: 'var(--text-secondary)' }}>
              <RefreshCw size={10} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
          </div>

          {error && <div style={{ padding: '6px 10px', fontSize: 11, color: 'var(--sev-warn)', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>{error}</div>}

          {/* File list */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {loading ? (
              <div style={{ padding: 20, textAlign: 'center', fontSize: 11, color: 'var(--text-muted)' }}>Loading…</div>
            ) : !hasElectron ? (
              <div style={{ padding: 20, textAlign: 'center', fontSize: 11, color: 'var(--text-muted)' }}>Feature requires the Rocky Mountain Protective Group desktop app.</div>
            ) : visibleFiles.length === 0 ? (
              <div style={{ padding: 20, textAlign: 'center', fontSize: 11, color: 'var(--text-muted)' }}>{files.length === 0 ? 'No files in this directory.' : 'No files match the filter.'}</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead style={{ position: 'sticky', top: 0, background: 'var(--surface-sunken)', zIndex: 1 }}>
                  <tr>
                    {['Name', 'Size', 'Modified', ''].map((h, i) => (
                      <th key={i} style={{ padding: '4px 8px', textAlign: i === 0 ? 'left' : i === 3 ? 'center' : 'right', fontSize: 9, fontWeight: 600, color: 'var(--field-label-color)', letterSpacing: '0.06em', textTransform: 'uppercase', borderBottom: '1px solid var(--border-subtle)', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleFiles.map(f => (
                    <tr key={f.path} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      <td style={{ padding: '4px 8px', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <File size={11} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                        <span style={{ color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }} title={f.name}>{f.name}</span>
                      </td>
                      <td style={{ padding: '4px 8px', textAlign: 'right', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{fmtSize(f.size)}</td>
                      <td style={{ padding: '4px 8px', textAlign: 'right', color: 'var(--text-secondary)', whiteSpace: 'nowrap', fontSize: 10 }}>{fmtDate(f.modified)}</td>
                      <td style={{ padding: '4px 8px', textAlign: 'center', display: 'flex', justifyContent: 'center', gap: 4 }}>
                        <button
                          aria-label={`Copy path ${f.name}`}
                          onClick={() => navigator.clipboard.writeText(f.path).catch(() => undefined)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}
                        >
                          <Copy size={11} />
                        </button>
                        <button
                          aria-label={`Delete ${f.name}`}
                          onClick={() => setDeleteTarget(f)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}
                        >
                          <Trash2 size={11} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Footer */}
          <div style={{ padding: '3px 10px', borderTop: '1px solid var(--border-subtle)', fontSize: 9, color: 'var(--text-muted)', display: 'flex', gap: 10, flexShrink: 0 }}>
            <span>{visibleFiles.length}/{files.length} files</span>
            {files.length > 0 && <span>Total: {fmtSize(totalSize)}</span>}
          </div>
        </div>
      </div>

      {/* Delete confirmation overlay */}
      {deleteTarget && (
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(0 0 0 / 0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10 }}>
          <div style={{ background: 'var(--surface-raised)', border: '1px solid var(--border-default)', borderRadius: 2, padding: 20, maxWidth: 320, width: '90%' }}>
            <p style={{ fontSize: 12, color: 'var(--text-primary)', marginBottom: 8 }}>Delete <strong>{deleteTarget.name}</strong>?</p>
            <p style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 16 }}>This action cannot be undone.</p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setDeleteTarget(null)} style={{ fontSize: 11, padding: '4px 12px', background: 'none', border: '1px solid var(--border-subtle)', borderRadius: 2, cursor: 'pointer', color: 'var(--text-secondary)' }}>Cancel</button>
              <button onClick={handleDeleteConfirm} style={{ fontSize: 11, padding: '4px 12px', background: 'var(--sev-critical)', border: 'none', borderRadius: 2, cursor: 'pointer', color: '#fff' }}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
