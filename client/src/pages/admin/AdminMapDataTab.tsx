// ============================================================
// RMPG Flex — Admin → Map Data tab
// ------------------------------------------------------------
// Lists/uploads/deletes objects in the system-essentials R2 bucket
// (map overlays + PMTiles tile archives) via the admin-only routes in
// src/routes/adminMapData.ts. Uploads go straight to R2 via a presigned
// PUT (src/utils/r2Presign.ts) — the Worker never buffers the file.
// ============================================================
import { useState, useEffect, useCallback, useRef } from 'react';
import { Map, Upload, Trash2, RefreshCw } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { putFileDirect, formatBytes } from '../../utils/uploadWithProgress';
import { useToast } from '../../components/ToastProvider';

interface MapDataFile {
  key: string;
  size: number;
  uploaded: string;
}

type DestPrefix = 'Map Overlay Database/' | 'tiles/';

export default function AdminMapDataTab() {
  const { addToast } = useToast();
  const [files, setFiles] = useState<MapDataFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [destPrefix, setDestPrefix] = useState<DestPrefix>('Map Overlay Database/');
  const [uploading, setUploading] = useState(false);
  const [uploadPercent, setUploadPercent] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    setLoading(true);
    return apiFetch<{ files: MapDataFile[] }>('/admin/map-data/files')
      .then((r) => setFiles(Array.isArray(r?.files) ? r.files : []))
      .catch(() => addToast('Failed to load map-data files', 'error'))
      .finally(() => setLoading(false));
  }, [addToast]);

  useEffect(() => { load(); }, [load]);

  const uploadFile = useCallback(async (file: File) => {
    setUploading(true);
    setUploadPercent(0);
    try {
      const key = `${destPrefix}${file.name}`;
      const presign = await apiFetch<{ ok?: boolean; code?: string; upload_url?: string }>(
        '/admin/map-data/presign',
        { method: 'POST', body: JSON.stringify({ key, contentType: file.type || 'application/octet-stream', size: file.size }) },
      );
      if (presign.ok === false) {
        addToast('R2 direct-upload credentials are not configured yet.', 'error');
        return;
      }
      await putFileDirect(presign.upload_url as string, file, (p) => setUploadPercent(p.percent));
      addToast(`Uploaded ${file.name}`, 'success');
      await load();
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Upload failed', 'error');
    } finally {
      setUploading(false);
      setUploadPercent(0);
    }
  }, [destPrefix, addToast, load]);

  const deleteFile = useCallback((key: string) => {
    if (!confirm(`Delete ${key}? This cannot be undone.`)) return;
    apiFetch(`/admin/map-data/files/${encodeURIComponent(key)}`, { method: 'DELETE' })
      .then(() => load())
      .catch((e) => addToast(e instanceof Error ? e.message : 'Delete failed', 'error'));
  }, [load, addToast]);

  return (
    <div className="p-3 space-y-4">
      <div className="panel-beveled p-3 bg-surface-base">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-[9px] text-rmpg-400 uppercase font-bold tracking-wider flex items-center gap-1.5">
            <Map className="w-3 h-3" /> Map Data Files ({files.length})
          </h4>
          <button
            onClick={() => load()}
            aria-label="Refresh file list"
            className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold rounded bg-surface-sunken hover:bg-rmpg-700 text-rmpg-100"
          >
            <RefreshCw className="w-3 h-3" /> Refresh
          </button>
        </div>

        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f) uploadFile(f);
          }}
          className={`flex items-center gap-2 p-3 mb-3 rounded border border-dashed ${dragOver ? 'border-brand-400 bg-surface-sunken' : 'border-border-default'}`}
        >
          <select
            className="input-dark"
            value={destPrefix}
            onChange={(e) => setDestPrefix(e.target.value as DestPrefix)}
            disabled={uploading}
          >
            <option value="Map Overlay Database/">Overlay</option>
            <option value="tiles/">Tile archive</option>
          </select>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold rounded bg-brand-700 hover:bg-brand-600 text-white disabled:opacity-50"
          >
            <Upload className="w-3 h-3" /> {uploading ? `Uploading… ${uploadPercent}%` : 'Choose file (or drop it here)'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = ''; }}
          />
        </div>

        {loading ? (
          <div className="text-[10px] text-rmpg-500 p-2">Loading…</div>
        ) : files.length === 0 ? (
          <div className="text-[10px] text-rmpg-500 p-2">No map-data files on file.</div>
        ) : (
          <div className="space-y-0.5 max-h-[400px] overflow-y-auto">
            {files.map((f) => (
              <div key={f.key} className="flex items-center justify-between px-2 py-1 bg-surface-sunken rounded text-[10px]">
                <span className="font-mono text-rmpg-100 flex-1 truncate">{f.key}</span>
                <span className="text-rmpg-400 w-20 text-right">{formatBytes(f.size)}</span>
                <span className="text-rmpg-500 w-32 text-right">{(f.uploaded || '').slice(0, 10)}</span>
                <button
                  onClick={() => deleteFile(f.key)}
                  aria-label={`Delete ${f.key}`}
                  className="p-1 ml-2 hover:text-red-400"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
