// ============================================================
// RMPG Flex — Dash Cameras Page (Standalone)
// Manage, upload, and view dash camera (MVR) video footage.
// Supports manual uploads and ClearPathGPS webhook ingest.
// ============================================================

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Car, Video, Upload, Search, Loader2, Trash2, Edit2, Link2,
  Filter, MapPin, Gauge, Clock, FileText, AlertTriangle,
  ChevronLeft, ChevronRight, Plus,
} from 'lucide-react';
import type { DashCamVideo } from '../types';
import PanelTitleBar from '../components/PanelTitleBar';
import RmpgLogo from '../components/RmpgLogo';
import PrintButton from '../components/PrintButton';
import ExportButton from '../components/ExportButton';
import DashCamUploadModal from '../components/DashCamUploadModal';
import DashCamVideoPlayer from '../components/DashCamVideoPlayer';
import DashCamVideoEditModal, { type DashCamVideoEditData } from '../components/DashCamVideoEditModal';
import DashCamLinkModal from '../components/DashCamLinkModal';
import { apiFetch } from '../hooks/useApi';
import { useToast } from '../components/ToastProvider';
import { useAuth } from '../context/AuthContext';
import { useLiveSync } from '../hooks/useLiveSync';

const PAGE_SIZE = 25;

const CLASSIFICATION_COLORS: Record<string, string> = {
  routine: 'bg-rmpg-700 text-rmpg-300 border-rmpg-600',
  evidence: 'bg-amber-900/40 text-amber-400 border-amber-700/40',
  flagged: 'bg-red-900/40 text-red-400 border-red-700/40',
  restricted: 'bg-purple-900/40 text-purple-400 border-purple-700/40',
};

const SOURCE_COLORS: Record<string, string> = {
  upload: 'bg-brand-500/20 text-brand-400 border-brand-500/30',
  clearpathgps: 'bg-green-900/40 text-green-400 border-green-700/40',
};

export default function DashCamerasPage() {
  const { addToast } = useToast();
  const { user } = useAuth();
  const canManage = ['admin', 'manager', 'supervisor'].includes(user?.role || '');
  const isAdmin = user?.role === 'admin';

  // State
  const [videos, setVideos] = useState<DashCamVideo[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [classFilter, setClassFilter] = useState('all');
  const [page, setPage] = useState(0);

  const [showUpload, setShowUpload] = useState(false);
  const [playingVideo, setPlayingVideo] = useState<DashCamVideo | null>(null);
  const [editingVideo, setEditingVideo] = useState<DashCamVideo | null>(null);
  const [linkingVideo, setLinkingVideo] = useState<DashCamVideo | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [units, setUnits] = useState<any[]>([]);

  // Fetch videos (server-side filtering + pagination)
  const fetchVideos = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(page * PAGE_SIZE),
      });
      if (search.trim()) params.set('search', search.trim());
      if (classFilter !== 'all') params.set('classification', classFilter);

      const data = await apiFetch<any>(`/fleet/dashcam-videos?${params}`);
      setVideos(Array.isArray(data?.videos) ? data.videos : []);
      setTotal(data?.total || 0);
    } catch (err: any) {
      addToast(err?.message || 'Failed to load videos', 'error');
    } finally {
      setLoading(false);
    }
  }, [page, search, classFilter, addToast]);

  // Fetch reference data (vehicles + units) for upload modal
  const fetchRefData = useCallback(async () => {
    try {
      const [vRes, u] = await Promise.all([
        apiFetch<any>('/fleet'),
        apiFetch<any[]>('/dispatch/units'),
      ]);
      const v = vRes?.data ?? vRes;
      setVehicles(Array.isArray(v) ? v : []);
      setUnits(Array.isArray(u) ? u : []);
    } catch {
      // non-critical — upload modal will show empty dropdowns
    }
  }, []);

  useEffect(() => { fetchVideos(); }, [fetchVideos]);
  useEffect(() => { fetchRefData(); }, [fetchRefData]);

  useLiveSync('dashcam', fetchVideos);

  // Videos are now filtered server-side via the classification query param.
  // `videos` state already contains only matching results.
  const filtered = videos;

  // Stats
  const stats = useMemo(() => ({
    total,
    evidence: videos.filter(v => v.classification === 'evidence').length,
    flagged: videos.filter(v => v.classification === 'flagged').length,
    cpg: videos.filter(v => (v as any).source === 'clearpathgps').length,
  }), [videos, total]);

  // Helpers
  const formatDate = (d?: string) => {
    if (!d) return '-';
    return new Date(d).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  };

  const formatDuration = (sec?: number) => {
    if (!sec) return '-';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  const formatSize = (bytes: number) => {
    if (!bytes) return '-';
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this video permanently? This cannot be undone.')) return;
    try {
      await apiFetch(`/fleet/dashcam-videos/${id}`, { method: 'DELETE' });
      addToast('Video deleted', 'success');
      fetchVideos();
    } catch {
      addToast('Failed to delete video', 'error');
    }
  };

  const handleEditSave = async (videoId: number, data: DashCamVideoEditData) => {
    setEditSubmitting(true);
    try {
      await apiFetch(`/fleet/dashcam-videos/${videoId}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      });
      setEditingVideo(null);
      addToast('Video updated', 'success');
      fetchVideos();
    } catch {
      addToast('Failed to update video', 'error');
    } finally {
      setEditSubmitting(false);
    }
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const apiBase = window.location.origin + '/api';
  const getAuthHeaders = (): Record<string, string> => {
    const token = localStorage.getItem('rmpg_token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  return (
    <div className="flex flex-col h-full">
      {/* Panel Title Bar */}
      <PanelTitleBar
        icon={Car}
        title={`Dash Cameras — ${total} video${total !== 1 ? 's' : ''}`}
      >
        <RmpgLogo height={20} iconOnly />
        <PrintButton />
        <ExportButton exportUrl="/fleet/dashcam-videos?limit=5000&format=csv" exportFilename="dashcam-videos.csv" />
        {canManage && (
          <button onClick={() => setShowUpload(true)} className="toolbar-btn-primary text-[10px] px-3 py-1.5 flex items-center gap-1.5">
            <Upload className="w-3 h-3" />
            Upload Video
          </button>
        )}
      </PanelTitleBar>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {/* Stats Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="panel-beveled p-2.5 text-center border border-t-2 border-rmpg-700 bg-surface-base border-t-cyan-500">
            <div className="text-sm font-bold font-mono text-cyan-400">{stats.total}</div>
            <div className="text-[7px] text-rmpg-500 uppercase">Total Videos</div>
          </div>
          <div className="panel-beveled p-2.5 text-center border border-t-2 border-amber-700/30 bg-[#1a150a] border-t-amber-500">
            <div className="text-sm font-bold font-mono text-amber-400">{stats.evidence}</div>
            <div className="text-[7px] text-rmpg-500 uppercase">Evidence</div>
          </div>
          <div className="panel-beveled p-2.5 text-center border border-t-2 border-red-700/30 bg-[#1a0a0a] border-t-red-500">
            <div className="text-sm font-bold font-mono text-red-400">{stats.flagged}</div>
            <div className="text-[7px] text-rmpg-500 uppercase">Flagged</div>
          </div>
          <div className="panel-beveled p-2.5 text-center border border-t-2 border-green-700/30 bg-[#0a1a0a] border-t-green-500">
            <div className="text-sm font-bold font-mono text-green-400">{stats.cpg}</div>
            <div className="text-[7px] text-rmpg-500 uppercase">ClearPathGPS</div>
          </div>
        </div>

        {/* Search & Filters */}
        <div className="panel-inset p-2 flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-[320px]">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-rmpg-500 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(0); }}
              placeholder="Search title, case #, unit, vehicle..."
              className="input-dark text-[10px] pl-7 pr-2 py-1 w-full"
            />
          </div>
          <div className="h-4 w-px bg-rmpg-700" />
          <Filter className="w-3 h-3 text-rmpg-500" />
          {['all', 'routine', 'evidence', 'flagged', 'restricted'].map(f => (
            <button
              key={f}
              onClick={() => { setClassFilter(f); setPage(0); }}
              className={`text-[10px] px-2.5 py-1 capitalize ${
                classFilter === f ? 'toolbar-btn-primary' : 'toolbar-btn'
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-12 gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-brand-400" />
            <span className="text-[10px] text-rmpg-400">Loading videos...</span>
          </div>
        )}

        {/* Video Table */}
        {!loading && (
          <div className="panel-beveled overflow-x-auto bg-surface-sunken">
            <table className="table-dark w-full">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th className="text-left">Title</th>
                  <th className="text-left">Vehicle / Unit</th>
                  <th className="text-left">Recorded</th>
                  <th className="text-left">Duration</th>
                  <th className="text-left">Size</th>
                  <th className="text-left">Class.</th>
                  <th className="text-left">Source</th>
                  <th className="text-left">Location</th>
                  <th className="text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="text-center py-12">
                      <div className="w-14 h-14 mx-auto mb-3 rounded-full border border-rmpg-700 flex items-center justify-center bg-surface-base">
                        <Video className="w-7 h-7 text-rmpg-600" />
                      </div>
                      <p className="text-xs text-rmpg-400">No dash camera videos found</p>
                      <p className="text-[9px] text-rmpg-600 mt-1">
                        {canManage
                          ? 'Upload a video or configure ClearPathGPS to auto-capture footage.'
                          : 'No videos have been uploaded yet.'}
                      </p>
                      {canManage && (
                        <button
                          onClick={() => setShowUpload(true)}
                          className="mt-3 toolbar-btn-primary text-[10px] px-4 py-1.5 inline-flex items-center gap-1.5"
                        >
                          <Plus className="w-3 h-3" /> Upload Video
                        </button>
                      )}
                    </td>
                  </tr>
                ) : (
                  filtered.map(v => (
                    <tr
                      key={v.id}
                      className="hover:bg-surface-hover cursor-pointer"
                      onClick={() => setPlayingVideo(v)}
                    >
                      <td>
                        <div className="flex items-center gap-1.5 min-w-0">
                          <Video className="w-3 h-3 text-cyan-400 flex-shrink-0" />
                          <span className="text-xs font-semibold text-rmpg-200 truncate max-w-[200px]" title={v.title}>
                            {v.title}
                          </span>
                        </div>
                        {v.case_number && (
                          <div className="flex items-center gap-1 mt-0.5">
                            <FileText className="w-2 h-2 text-rmpg-500" />
                            <span className="text-[9px] text-rmpg-400 font-mono">{v.case_number}</span>
                          </div>
                        )}
                      </td>
                      <td>
                        <div className="text-xs text-rmpg-200">
                          {v.vehicle_number ? `#${v.vehicle_number}` : '-'}
                          {v.vehicle_make && ` ${v.vehicle_make}`}
                        </div>
                        {v.unit_call_sign && (
                          <span className="text-[9px] text-brand-400 font-mono font-semibold">{v.unit_call_sign}</span>
                        )}
                      </td>
                      <td>
                        <span className="text-xs font-mono text-rmpg-300 flex items-center gap-1">
                          <Clock className="w-2.5 h-2.5 text-rmpg-500" />
                          {formatDate(v.recorded_at)}
                        </span>
                      </td>
                      <td>
                        <span className="text-xs font-mono text-rmpg-300">{formatDuration(v.duration_seconds)}</span>
                      </td>
                      <td>
                        <span className="text-xs font-mono text-rmpg-400">{formatSize(v.file_size)}</span>
                      </td>
                      <td>
                        <span className={`inline-flex items-center px-1.5 py-0.5 text-[9px] font-bold border capitalize ${
                          CLASSIFICATION_COLORS[v.classification] || CLASSIFICATION_COLORS.routine
                        }`}>
                          {v.classification}
                        </span>
                      </td>
                      <td>
                        <span className={`inline-flex items-center px-1.5 py-0.5 text-[9px] font-bold border ${
                          SOURCE_COLORS[(v as any).source] || SOURCE_COLORS.upload
                        }`}>
                          {(v as any).source === 'clearpathgps' ? 'CPG' : 'Upload'}
                        </span>
                      </td>
                      <td>
                        {v.address ? (
                          <span className="text-[9px] text-rmpg-400 max-w-[140px] truncate block" title={v.address}>
                            <MapPin className="w-2.5 h-2.5 inline mr-0.5 text-rmpg-500" />
                            {v.address}
                          </span>
                        ) : v.speed_mph != null ? (
                          <span className="text-[9px] text-rmpg-400 flex items-center gap-1">
                            <Gauge className="w-2.5 h-2.5" />
                            {v.speed_mph} mph
                          </span>
                        ) : (
                          <span className="text-[9px] text-rmpg-600">-</span>
                        )}
                      </td>
                      <td className="text-center" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => setPlayingVideo(v)}
                            className="toolbar-btn p-1"
                            title="Play video"
                          >
                            <Video className="w-3 h-3" />
                          </button>
                          {canManage && (
                            <>
                              <button
                                onClick={() => setEditingVideo(v)}
                                className="toolbar-btn p-1"
                                title="Edit metadata"
                              >
                                <Edit2 className="w-3 h-3" />
                              </button>
                              <button
                                onClick={() => setLinkingVideo(v)}
                                className="toolbar-btn p-1"
                                title="Link to case/call/incident"
                              >
                                <Link2 className="w-3 h-3" />
                              </button>
                            </>
                          )}
                          {isAdmin && (
                            <button
                              onClick={() => handleDelete(v.id)}
                              className="toolbar-btn p-1 text-red-400 hover:text-red-300"
                              title="Delete video"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {!loading && totalPages > 1 && (
          <div className="flex items-center justify-between pt-1">
            <span className="text-[10px] text-rmpg-500">
              Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
            </span>
            <div className="flex items-center gap-1">
              <button
                disabled={page === 0}
                onClick={() => setPage(p => p - 1)}
                className="toolbar-btn p-1 disabled:opacity-30"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <span className="text-[10px] text-rmpg-400 font-mono px-2">
                {page + 1} / {totalPages}
              </span>
              <button
                disabled={page >= totalPages - 1}
                onClick={() => setPage(p => p + 1)}
                className="toolbar-btn p-1 disabled:opacity-30"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* ClearPathGPS info banner */}
        <div className="panel-beveled p-2.5 flex items-center gap-2 border border-green-700/20 bg-green-900/5">
          <Car className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />
          <span className="text-[10px] text-rmpg-400">
            Videos from <span className="text-green-400 font-semibold">ClearPathGPS</span> cameras
            are automatically ingested via webhook when camera events (hard brake, impact, speeding) are detected.
            Configure webhooks in Admin &rarr; ClearPathGPS.
          </span>
        </div>
      </div>

      {/* Modals */}
      <DashCamUploadModal
        isOpen={showUpload}
        onClose={() => setShowUpload(false)}
        onUploaded={() => { setShowUpload(false); fetchVideos(); }}
        vehicles={vehicles}
        units={units}
        apiBase={apiBase}
        getAuthHeaders={getAuthHeaders}
      />

      <DashCamVideoPlayer
        isOpen={!!playingVideo}
        onClose={() => setPlayingVideo(null)}
        video={playingVideo}
        apiBase={apiBase}
        getAuthHeaders={getAuthHeaders}
        onEditVideo={canManage ? (v) => { setPlayingVideo(null); setEditingVideo(v); } : undefined}
      />

      <DashCamVideoEditModal
        isOpen={!!editingVideo}
        onClose={() => setEditingVideo(null)}
        video={editingVideo}
        onSave={handleEditSave}
        isSubmitting={editSubmitting}
      />

      <DashCamLinkModal
        isOpen={!!linkingVideo}
        onClose={() => setLinkingVideo(null)}
        videoId={linkingVideo?.id || 0}
        videoTitle={linkingVideo?.title || ''}
        canManage={canManage}
      />
    </div>
  );
}
