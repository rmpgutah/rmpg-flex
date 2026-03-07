// ============================================================
// RMPG Flex — Dash Cameras Page (Standalone)
// Dedicated page for managing dash camera (MVR) videos,
// accessible from the Personnel/Fleet dropdown in the sidebar.
// ============================================================

import React, { useState, useEffect, useCallback } from 'react';
import {
  Car, Loader2, AlertTriangle, Video, Upload, Search, Filter,
  MapPin, Gauge, Clock, Tag, Play, Edit2, Trash2, Eye, CheckCircle,
  Download, RotateCcw, X,
} from 'lucide-react';
import type { DashCamVideo, VideoClassification, FleetVehicle } from '../types';
import PanelTitleBar from '../components/PanelTitleBar';
import RmpgLogo from '../components/RmpgLogo';
import PrintButton from '../components/PrintButton';
import DashCamUploadModal from '../components/DashCamUploadModal';
import DashCamVideoPlayer from '../components/DashCamVideoPlayer';
import DashCamVideoEditModal from '../components/DashCamVideoEditModal';
import type { DashCamVideoEditData } from '../components/DashCamVideoEditModal';
import ConfirmDialog from '../components/ConfirmDialog';
import { apiFetch } from '../hooks/useApi';
import { useToast } from '../components/ToastProvider';
import { useAuth } from '../context/AuthContext';
import { useLiveSync } from '../hooks/useLiveSync';

// ── Constants ──────────────────────────────────────────────

const CLASSIFICATIONS: { value: string; label: string; color: string }[] = [
  { value: 'routine', label: 'Routine', color: 'text-rmpg-400 border-rmpg-600 bg-rmpg-800/40' },
  { value: 'evidence', label: 'Evidence', color: 'text-yellow-400 border-yellow-700/40 bg-yellow-900/20' },
  { value: 'flagged', label: 'Flagged', color: 'text-orange-400 border-orange-700/40 bg-orange-900/20' },
  { value: 'restricted', label: 'Restricted', color: 'text-red-400 border-red-700/40 bg-red-900/20' },
];

const OVERLAY_STATUS_BADGE: Record<string, { label: string; cls: string; icon: React.ElementType }> = {
  complete:   { label: 'Overlay Applied',    cls: 'bg-green-900/40 text-green-400 border-green-700/40', icon: CheckCircle },
  processing: { label: 'Processing...',     cls: 'bg-amber-900/40 text-amber-400 border-amber-700/40', icon: Loader2 },
  pending:    { label: 'Pending',           cls: 'bg-amber-900/30 text-amber-500 border-amber-700/30', icon: Loader2 },
  error:      { label: 'Failed',            cls: 'bg-red-900/40 text-red-400 border-red-700/40',       icon: AlertTriangle },
};

interface UnitOption {
  id: number;
  call_sign: string;
}

// ── Helpers ────────────────────────────────────────────────

function formatDate(d?: string | null) {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatDuration(seconds?: number) {
  if (!seconds) return '-';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatSize(bytes: number) {
  if (!bytes) return '-';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function classLabel(cls: string) {
  return cls.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ── Component ──────────────────────────────────────────────

type ModalMode = 'none' | 'upload' | 'edit';

export default function DashCamerasPage() {
  const { addToast } = useToast();
  const { user } = useAuth();
  const canManage = user?.role === 'admin';

  // State
  const [videos, setVideos] = useState<DashCamVideo[]>([]);
  const [vehicles, setVehicles] = useState<FleetVehicle[]>([]);
  const [units, setUnits] = useState<UnitOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [modal, setModal] = useState<ModalMode>('none');
  const [playingVideo, setPlayingVideo] = useState<DashCamVideo | null>(null);
  const [editVideo, setEditVideo] = useState<DashCamVideo | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<DashCamVideo | null>(null);

  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [filterClassification, setFilterClassification] = useState('');
  const [filterVehicle, setFilterVehicle] = useState('');

  // Bulk selection
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);

  // ── Data Fetching ──────────────────────────────────────────

  const fetchData = useCallback(async () => {
    try {
      const [vids, vehs, unitList] = await Promise.all([
        apiFetch<any[]>('/fleet/dashcam-videos'),
        apiFetch<any[]>('/fleet'),
        apiFetch<any[]>('/dispatch/units'),
      ]);
      setVideos(Array.isArray(vids) ? vids : []);
      setVehicles(Array.isArray(vehs) ? vehs : []);
      setUnits(
        (Array.isArray(unitList) ? unitList : []).map((u: any) => ({
          id: u.id,
          call_sign: u.call_sign || u.callSign || `Unit ${u.id}`,
        }))
      );
      setError(null);
    } catch (err: any) {
      setError(err?.message || 'Failed to load dash camera data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  useLiveSync('dashcam_videos', fetchData);
  useLiveSync('fleet', fetchData);

  // ── Refresh ────────────────────────────────────────────────

  const refreshVideos = async () => {
    const vids = await apiFetch<any[]>('/fleet/dashcam-videos');
    setVideos(Array.isArray(vids) ? vids : []);
  };

  // ── CRUD ───────────────────────────────────────────────────

  const handleEditSave = async (videoId: number, data: DashCamVideoEditData) => {
    setEditSubmitting(true);
    try {
      await apiFetch(`/fleet/dashcam-videos/${videoId}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      });
      setModal('none');
      setEditVideo(null);
      await refreshVideos();
      addToast('Video updated', 'success');
    } catch (err: any) {
      addToast(err?.message || 'Failed to update video', 'error');
    } finally {
      setEditSubmitting(false);
    }
  };

  const handleDelete = async (video: DashCamVideo) => {
    try {
      await apiFetch(`/fleet/dashcam-videos/${video.id}`, { method: 'DELETE' });
      await refreshVideos();
      addToast('Video deleted', 'success');
    } catch {
      addToast('Failed to delete video', 'error');
    }
    setDeleteConfirm(null);
  };

  const handleClassify = async (videoId: number, classification: string) => {
    try {
      await apiFetch(`/fleet/dashcam-videos/${videoId}`, {
        method: 'PUT',
        body: JSON.stringify({ classification }),
      });
      await refreshVideos();
      setPlayingVideo(prev => prev ? { ...prev, classification } : null);
      addToast(`Video reclassified to ${classLabel(classification)}`, 'success');
    } catch {
      addToast('Failed to reclassify video', 'error');
    }
  };

  const handleReprocess = async (videoId: number) => {
    try {
      await apiFetch(`/fleet/dashcam-videos/${videoId}/reprocess`, { method: 'POST' });
      await refreshVideos();
      addToast('Overlay reprocessing queued', 'success');
    } catch {
      addToast('Failed to reprocess overlay', 'error');
    }
  };

  // ── Bulk Operations ────────────────────────────────────────

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    setBulkLoading(true);
    try {
      await Promise.all(
        Array.from(selectedIds).map(id =>
          apiFetch(`/fleet/dashcam-videos/${id}`, { method: 'DELETE' })
        )
      );
      await refreshVideos();
      addToast(`${selectedIds.size} video(s) deleted`, 'success');
      setSelectedIds(new Set());
    } catch (err: any) {
      addToast(err?.message || 'Bulk delete failed', 'error');
    } finally {
      setBulkLoading(false);
    }
  };

  const handleBulkClassify = async (classification: VideoClassification) => {
    if (selectedIds.size === 0) return;
    setBulkLoading(true);
    try {
      await Promise.all(
        Array.from(selectedIds).map(id =>
          apiFetch(`/fleet/dashcam-videos/${id}`, {
            method: 'PUT',
            body: JSON.stringify({ classification }),
          })
        )
      );
      await refreshVideos();
      addToast(`${selectedIds.size} video(s) reclassified`, 'success');
      setSelectedIds(new Set());
    } catch (err: any) {
      addToast(err?.message || 'Bulk classify failed', 'error');
    } finally {
      setBulkLoading(false);
    }
  };

  // ── Filtering ──────────────────────────────────────────────

  const filtered = videos.filter(v => {
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      const match = [v.title, v.case_number, v.address, v.unit_call_sign, v.vehicle_number]
        .filter(Boolean)
        .some(s => s!.toLowerCase().includes(term));
      if (!match) return false;
    }
    if (filterClassification && v.classification !== filterClassification) return false;
    if (filterVehicle && String(v.vehicle_id) !== filterVehicle) return false;
    return true;
  });

  const toggleSelect = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map(v => v.id)));
    }
  };

  // ── Summary Stats ──────────────────────────────────────────

  const totalSize = videos.reduce((sum, v) => sum + (v.file_size || 0), 0);
  const totalDuration = videos.reduce((sum, v) => sum + (v.duration_seconds || 0), 0);
  const evidenceCount = videos.filter(v => v.classification === 'evidence' || v.classification === 'flagged').length;

  // ── Auth helpers ───────────────────────────────────────────

  const apiBase = window.location.origin + '/api';
  const getAuthHeaders = () => {
    const token = localStorage.getItem('rmpg_token');
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
  };

  // ── Render ─────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full animate-fade-in">

      {/* Header */}
      <div className="flex-shrink-0 border-b border-rmpg-700" style={{ background: '#161616' }}>
        <PanelTitleBar title="DASH CAMERAS" icon={Car}>
          <RmpgLogo height={16} iconOnly />
          <span className="toolbar-separator" />
          <div className="flex items-center gap-2 text-[10px] font-mono text-rmpg-400 mr-3">
            <Video className="w-3 h-3" />
            <span>Videos: <strong className="text-white">{videos.length}</strong></span>
            <span className="text-rmpg-600">|</span>
            <span>Storage: <strong className="text-brand-400">{formatSize(totalSize)}</strong></span>
            <span className="text-rmpg-600">|</span>
            <span>Evidence: <strong className="text-yellow-400">{evidenceCount}</strong></span>
          </div>
          <PrintButton />
        </PanelTitleBar>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center flex-1 py-20">
            <Loader2 className="w-6 h-6 text-brand-400 animate-spin" />
          </div>
        )}

        {!loading && error && (
          <div className="flex items-center justify-center flex-1 py-20">
            <div className="text-center">
              <AlertTriangle className="w-8 h-8 text-amber-400 mx-auto mb-2" />
              <p className="text-sm text-rmpg-300">{error}</p>
              <button onClick={fetchData} className="toolbar-btn mt-3">Retry</button>
            </div>
          </div>
        )}

        {!loading && !error && (
          <div className="p-4 space-y-4">

            {/* Summary Cards */}
            <div className="grid grid-cols-4 gap-3">
              <SummaryCard icon={Video} label="Total Videos" value={String(videos.length)} />
              <SummaryCard icon={Clock} label="Total Duration" value={formatDuration(totalDuration)} />
              <SummaryCard icon={Download} label="Total Storage" value={formatSize(totalSize)} />
              <SummaryCard icon={Tag} label="Evidence / Flagged" value={String(evidenceCount)} color="text-yellow-400" />
            </div>

            {/* Toolbar */}
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 flex-1">
                {/* Search */}
                <div className="relative flex-1 max-w-xs">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-rmpg-500" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    placeholder="Search videos..."
                    className="input-dark pl-8 text-xs w-full"
                  />
                </div>

                {/* Classification Filter */}
                <select
                  value={filterClassification}
                  onChange={e => setFilterClassification(e.target.value)}
                  className="select-dark text-xs"
                >
                  <option value="">All Classifications</option>
                  {CLASSIFICATIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>

                {/* Vehicle Filter */}
                <select
                  value={filterVehicle}
                  onChange={e => setFilterVehicle(e.target.value)}
                  className="select-dark text-xs"
                >
                  <option value="">All Vehicles</option>
                  {vehicles.map(v => (
                    <option key={v.id} value={v.id}>
                      #{v.vehicle_number} — {[v.year, v.make, v.model].filter(Boolean).join(' ')}
                    </option>
                  ))}
                </select>

                {(searchTerm || filterClassification || filterVehicle) && (
                  <button
                    onClick={() => { setSearchTerm(''); setFilterClassification(''); setFilterVehicle(''); }}
                    className="toolbar-btn p-1 text-rmpg-400"
                    title="Clear filters"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2">
                {/* Bulk Actions */}
                {selectedIds.size > 0 && canManage && (
                  <div className="flex items-center gap-1 border-r border-rmpg-700 pr-2 mr-1">
                    <span className="text-[10px] text-rmpg-400">{selectedIds.size} selected</span>
                    <select
                      onChange={e => { if (e.target.value) handleBulkClassify(e.target.value as VideoClassification); e.target.value = ''; }}
                      className="select-dark text-[10px] py-0.5"
                      disabled={bulkLoading}
                    >
                      <option value="">Classify...</option>
                      {CLASSIFICATIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                    <button
                      onClick={handleBulkDelete}
                      disabled={bulkLoading}
                      className="toolbar-btn p-1 text-red-400 hover:text-red-300"
                      title="Delete selected"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}

                {canManage && (
                  <button
                    onClick={() => setModal('upload')}
                    className="toolbar-btn-primary text-xs px-3 py-1.5 flex items-center gap-1.5"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    Upload Video
                  </button>
                )}
              </div>
            </div>

            {/* Video Table */}
            {filtered.length === 0 ? (
              <div className="panel-inset p-8 text-center">
                <Car className="w-8 h-8 text-rmpg-600 mx-auto mb-2" />
                <p className="text-sm text-rmpg-400">
                  {videos.length === 0 ? 'No dash camera videos uploaded yet.' : 'No videos match your filters.'}
                </p>
                {canManage && videos.length === 0 && (
                  <button onClick={() => setModal('upload')} className="toolbar-btn-primary text-xs px-4 py-1.5 mt-3">
                    Upload First Video
                  </button>
                )}
              </div>
            ) : (
              <div className="panel-inset overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-rmpg-700 bg-surface-raised">
                      {canManage && (
                        <th className="w-8 px-2 py-2">
                          <input
                            type="checkbox"
                            checked={selectedIds.size === filtered.length && filtered.length > 0}
                            onChange={toggleSelectAll}
                            className="accent-brand-500"
                          />
                        </th>
                      )}
                      <th className="text-left px-3 py-2 text-rmpg-400 font-semibold">Title</th>
                      <th className="text-left px-3 py-2 text-rmpg-400 font-semibold">Vehicle / Unit</th>
                      <th className="text-left px-3 py-2 text-rmpg-400 font-semibold">Recorded</th>
                      <th className="text-center px-3 py-2 text-rmpg-400 font-semibold">Duration</th>
                      <th className="text-center px-3 py-2 text-rmpg-400 font-semibold">Size</th>
                      <th className="text-center px-3 py-2 text-rmpg-400 font-semibold">Speed</th>
                      <th className="text-center px-3 py-2 text-rmpg-400 font-semibold">Classification</th>
                      <th className="text-center px-3 py-2 text-rmpg-400 font-semibold">Overlay</th>
                      <th className="text-right px-3 py-2 text-rmpg-400 font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(v => {
                      const vehDesc = [v.vehicle_year, v.vehicle_make, v.vehicle_model].filter(Boolean).join(' ');
                      const clsInfo = CLASSIFICATIONS.find(c => c.value === v.classification) || CLASSIFICATIONS[0];
                      const overlayInfo = OVERLAY_STATUS_BADGE[v.overlay_status || 'pending'];
                      const OverlayIcon = overlayInfo?.icon || Loader2;

                      return (
                        <tr
                          key={v.id}
                          className="border-b border-rmpg-800 hover:bg-rmpg-800/40 transition-colors cursor-pointer"
                          onClick={() => setPlayingVideo(v)}
                        >
                          {canManage && (
                            <td className="w-8 px-2 py-2" onClick={e => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                checked={selectedIds.has(v.id)}
                                onChange={() => toggleSelect(v.id)}
                                className="accent-brand-500"
                              />
                            </td>
                          )}
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              <Play className="w-3.5 h-3.5 text-brand-400 flex-shrink-0" />
                              <div className="min-w-0">
                                <p className="text-rmpg-100 font-medium truncate max-w-[200px]">{v.title}</p>
                                {v.case_number && <p className="text-[9px] text-rmpg-500 font-mono">Case: {v.case_number}</p>}
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <p className="text-rmpg-200">
                              {v.vehicle_number ? `#${v.vehicle_number}` : '-'}
                              {vehDesc ? ` — ${vehDesc}` : ''}
                            </p>
                            {v.unit_call_sign && <p className="text-[9px] text-rmpg-500 font-mono">{v.unit_call_sign}</p>}
                          </td>
                          <td className="px-3 py-2 text-rmpg-300 font-mono">{formatDate(v.recorded_at)}</td>
                          <td className="px-3 py-2 text-center text-rmpg-300 font-mono">{formatDuration(v.duration_seconds)}</td>
                          <td className="px-3 py-2 text-center text-rmpg-300 font-mono">{formatSize(v.file_size)}</td>
                          <td className="px-3 py-2 text-center">
                            {v.speed_mph != null ? (
                              <span className="text-green-400 font-mono">{v.speed_mph} MPH</span>
                            ) : (
                              <span className="text-rmpg-600">-</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-center">
                            <span className={`text-[9px] px-1.5 py-0.5 font-semibold border rounded ${clsInfo.color}`}>
                              {clsInfo.label}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-center">
                            {overlayInfo && (
                              <span className={`text-[9px] px-1.5 py-0.5 font-semibold flex items-center justify-center gap-1 border rounded ${overlayInfo.cls}`}>
                                <OverlayIcon className={`w-2.5 h-2.5 ${v.overlay_status === 'processing' || v.overlay_status === 'pending' ? 'animate-spin' : ''}`} />
                                {overlayInfo.label}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right" onClick={e => e.stopPropagation()}>
                            <div className="flex items-center justify-end gap-1">
                              <button
                                onClick={() => setPlayingVideo(v)}
                                className="toolbar-btn p-1"
                                title="Play video"
                              >
                                <Play className="w-3 h-3" />
                              </button>
                              {canManage && (
                                <>
                                  <button
                                    onClick={() => { setEditVideo(v); setModal('edit'); }}
                                    className="toolbar-btn p-1"
                                    title="Edit metadata"
                                  >
                                    <Edit2 className="w-3 h-3" />
                                  </button>
                                  {v.overlay_status === 'error' && (
                                    <button
                                      onClick={() => handleReprocess(v.id)}
                                      className="toolbar-btn p-1 text-amber-400"
                                      title="Retry overlay"
                                    >
                                      <RotateCcw className="w-3 h-3" />
                                    </button>
                                  )}
                                  <button
                                    onClick={() => setDeleteConfirm(v)}
                                    className="toolbar-btn p-1 text-red-400 hover:text-red-300"
                                    title="Delete video"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Modals ───────────────────────────────────────────── */}

      <DashCamUploadModal
        isOpen={modal === 'upload'}
        onClose={() => setModal('none')}
        onUploaded={refreshVideos}
        vehicles={vehicles.map(v => ({
          id: Number(v.id),
          vehicle_number: v.vehicle_number,
          make: v.make,
          model: v.model,
          year: v.year,
        }))}
        units={units}
        apiBase={apiBase}
        getAuthHeaders={getAuthHeaders}
      />

      <DashCamVideoEditModal
        isOpen={modal === 'edit'}
        onClose={() => { setModal('none'); setEditVideo(null); }}
        onSave={handleEditSave}
        video={editVideo}
        isSubmitting={editSubmitting}
      />

      <DashCamVideoPlayer
        isOpen={!!playingVideo}
        onClose={() => setPlayingVideo(null)}
        video={playingVideo}
        apiBase={apiBase}
        getAuthHeaders={getAuthHeaders}
        onEditVideo={canManage ? (v) => { setEditVideo(v); setModal('edit'); } : undefined}
        onClassify={canManage ? handleClassify : undefined}
      />

      <ConfirmDialog
        isOpen={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={() => deleteConfirm && handleDelete(deleteConfirm)}
        title="Delete Dash Cam Video"
        message={`Are you sure you want to delete "${deleteConfirm?.title}"? This action cannot be undone.`}
        confirmLabel="Delete"
        confirmVariant="danger"
      />
    </div>
  );
}

// ── Summary Card ─────────────────────────────────────────────

function SummaryCard({ icon: Icon, label, value, color }: {
  icon: React.ElementType;
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="panel-inset p-3 flex items-center gap-3">
      <div className="p-2 bg-surface-sunken rounded">
        <Icon className={`w-4 h-4 ${color || 'text-brand-400'}`} />
      </div>
      <div>
        <p className="text-[9px] text-rmpg-500 uppercase tracking-wider">{label}</p>
        <p className={`text-sm font-bold font-mono ${color || 'text-rmpg-100'}`}>{value}</p>
      </div>
    </div>
  );
}
