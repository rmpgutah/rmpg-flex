// ============================================================
// RMPG Flex — MVR Review Station (Dash Cameras)
// Professional police Mobile Video Recorder review interface.
// Gallery/list browsing with inline detail panel for video
// evidence review, classification, and case linking.
// ============================================================

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Camera, Video, Upload, Search, Loader2, Trash2, Edit2, Link2,
  Filter, MapPin, Gauge, Clock, FileText, AlertTriangle,
  ChevronLeft, ChevronRight, Plus, Grid, List, Film,
  HardDrive, Maximize2, X, Zap, Car, Play,
} from 'lucide-react';
import type { DashCamVideo } from '../types';
import PanelTitleBar from '../components/PanelTitleBar';
import SplitPanel from '../components/SplitPanel';
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
import usePersistedState from '../hooks/usePersistedState';

const PAGE_SIZE = 25;

// ── Color Constants ─────────────────────────────────────────

const CLASSIFICATION_COLORS: Record<string, string> = {
  routine:    'bg-rmpg-700 text-rmpg-300 border-rmpg-600',
  evidence:   'bg-amber-900/40 text-amber-400 border-amber-700/40',
  flagged:    'bg-red-900/40 text-red-400 border-red-700/40',
  restricted: 'bg-purple-900/40 text-purple-400 border-purple-700/40',
};

const SOURCE_COLORS: Record<string, string> = {
  upload:       'bg-brand-500/20 text-brand-400 border-brand-500/30',
  clearpathgps: 'bg-green-900/40 text-green-400 border-green-700/40',
};

const EVENT_TYPE_COLORS: Record<string, string> = {
  'Harsh Braking':             'bg-orange-900/60 text-orange-300 border border-orange-600/50',
  'Frontal Collision Warning': 'bg-red-900/60 text-red-300 border border-red-600/50',
  'Harsh Acceleration':        'bg-amber-900/60 text-amber-300 border border-amber-600/50',
  'Speeding':                  'bg-yellow-900/60 text-yellow-300 border border-yellow-600/50',
  'Impact':                    'bg-red-900/80 text-red-200 border border-red-500/60',
  'Manual':                    'bg-brand-500/20 text-brand-400 border border-brand-500/30',
  default:                     'bg-rmpg-700/40 text-rmpg-300 border border-rmpg-600/30',
};

// ── Helpers ─────────────────────────────────────────────────

function channelLabel(ch?: string): string {
  if (!ch) return '';
  return ch === 'outside' ? 'FRONT' : 'REAR';
}
function channelColor(ch?: string): string {
  return ch === 'outside' ? 'text-blue-400' : 'text-purple-400';
}
function channelBg(ch?: string): string {
  return ch === 'outside'
    ? 'bg-blue-900/80 text-blue-300 border border-blue-600/50'
    : 'bg-purple-900/80 text-purple-300 border border-purple-600/50';
}

function formatDate(d?: string): string {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatDuration(sec?: number): string {
  if (!sec) return '-';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatSize(bytes: number): string {
  if (!bytes) return '-';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

const timeAgo = (date: string): string => {
  if (!date) return '—';
  const parsed = new Date(date).getTime();
  if (Number.isNaN(parsed)) return '—';
  const ms = Date.now() - parsed;
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
};

// ── Component ───────────────────────────────────────────────

export default function DashCamerasPage() {
  const { addToast } = useToast();
  const { user } = useAuth();
  const canManage = ['admin', 'manager', 'supervisor'].includes(user?.role || '');
  const isAdmin = user?.role === 'admin';

  // ── State ────────────────────────────────
  const [videos, setVideos] = useState<DashCamVideo[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [classFilter, setClassFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [channelFilter, setChannelFilter] = useState('all');
  const [eventTypeFilter, setEventTypeFilter] = useState('all');
  const [page, setPage] = useState(0);

  const [viewMode, setViewMode] = usePersistedState<'gallery' | 'list'>('rmpg_dashcam_view', 'gallery');
  const [selectedVideo, setSelectedVideo] = useState<DashCamVideo | null>(null);
  const [playingVideo, setPlayingVideo] = useState<DashCamVideo | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [editingVideo, setEditingVideo] = useState<DashCamVideo | null>(null);
  const [linkingVideo, setLinkingVideo] = useState<DashCamVideo | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [units, setUnits] = useState<any[]>([]);

  // ═══ NEW: Quality + Storage Stats ═══
  const [storageStats, setStorageStats] = useState<{
    total_storage_gb: number; total_videos: number;
    disk?: { free_gb: number; used_pct: number } | null;
  } | null>(null);

  // ── Data Fetching ────────────────────────
  const fetchVideos = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(page * PAGE_SIZE),
      });
      if (search.trim()) params.set('search', search.trim());
      const data = await apiFetch<any>(`/fleet/dashcam-videos?${params}`);
      setVideos(Array.isArray(data?.videos) ? data.videos : []);
      setTotal(data?.total || 0);
    } catch (err: any) {
      addToast(err?.message || 'Failed to load videos', 'error');
    } finally {
      setLoading(false);
    }
  }, [page, search, addToast]);

  const fetchRefData = useCallback(async () => {
    try {
      const [vRes, u] = await Promise.all([
        apiFetch<any>('/fleet'),
        apiFetch<any[]>('/dispatch/units'),
      ]);
      const v = vRes?.data ?? vRes;
      setVehicles(Array.isArray(v) ? v : []);
      setUnits(Array.isArray(u) ? u : []);
    } catch { /* non-critical */ }
  }, []);

  useEffect(() => { fetchVideos(); }, [fetchVideos]);
  useEffect(() => { fetchRefData(); }, [fetchRefData]);
  useLiveSync('dashcam', fetchVideos);

  // Fetch storage stats
  useEffect(() => {
    apiFetch<any>('/fleet/dashcam-videos/storage/usage')
      .then(data => {
        if (data) setStorageStats({
          total_storage_gb: data.total_storage_gb || 0,
          total_videos: data.total_videos || 0,
          disk: data.disk || null,
        });
      })
      .catch(() => { /* non-critical */ });
  }, []);

  // ── Filters & Stats ─────────────────────
  const filtered = useMemo(() => {
    let result = videos;
    if (classFilter !== 'all') result = result.filter(v => v.classification === classFilter);
    if (sourceFilter !== 'all') result = result.filter(v => (v.source || 'upload') === sourceFilter);
    if (channelFilter !== 'all') result = result.filter(v => v.cpg_channel === channelFilter);
    if (eventTypeFilter !== 'all') result = result.filter(v => (v.cpg_event_type || 'Manual') === eventTypeFilter);
    return result;
  }, [videos, classFilter, sourceFilter, channelFilter, eventTypeFilter]);

  const stats = useMemo(() => ({
    total,
    frontCam: videos.filter(v => v.cpg_channel === 'outside').length,
    rearCam: videos.filter(v => v.cpg_channel === 'inside').length,
    evidence: videos.filter(v => v.classification === 'evidence').length,
    flagged: videos.filter(v => v.classification === 'flagged').length,
    cpg: videos.filter(v => v.source === 'clearpathgps').length,
    totalStorage: videos.reduce((sum, v) => sum + (v.file_size || 0), 0),
  }), [videos, total]);

  const eventTypes = useMemo(() => {
    const types = new Set<string>();
    videos.forEach(v => { if (v.cpg_event_type) types.add(v.cpg_event_type); });
    return Array.from(types).sort();
  }, [videos]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  // ── Handlers ────────────────────────────
  const apiBase = window.location.origin + '/api';
  const getAuthHeaders = (): Record<string, string> => {
    const token = localStorage.getItem('rmpg_token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this video permanently? This cannot be undone.')) return;
    try {
      await apiFetch(`/fleet/dashcam-videos/${id}`, { method: 'DELETE' });
      addToast('Video deleted', 'success');
      if (selectedVideo?.id === id) setSelectedVideo(null);
      fetchVideos();
    } catch { addToast('Failed to delete video', 'error'); }
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
    } catch { addToast('Failed to update video', 'error'); }
    finally { setEditSubmitting(false); }
  };

  const handleQuickClassify = async (id: number, cls: string) => {
    try {
      await apiFetch(`/fleet/dashcam-videos/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ classification: cls }),
      });
      addToast(`Classified as ${cls}`, 'success');
      setSelectedVideo(prev => prev ? { ...prev, classification: cls as any } : null);
      fetchVideos();
    } catch { addToast('Failed to update classification', 'error'); }
  };

  // ── Gallery View (Left Panel) ────────────
  const galleryView = (
    <div className="h-full overflow-y-auto p-2">
      {loading ? (
        <div className="flex items-center justify-center py-16 gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-brand-400" role="status" aria-label="Loading" />
          <span className="text-[10px] text-rmpg-400">Loading videos...</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <div className="w-14 h-14 mx-auto mb-3 rounded-full border border-rmpg-700 flex items-center justify-center bg-surface-base">
            <Film className="w-7 h-7 text-rmpg-600" />
          </div>
          <p className="text-xs text-rmpg-400">No dash camera videos found</p>
          {canManage && (
            <button type="button" onClick={() => setShowUpload(true)}
              className="mt-3 toolbar-btn-primary text-[10px] px-4 py-1.5 inline-flex items-center gap-1.5">
              <Plus className="w-3 h-3" /> Upload Video
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
          {filtered.map(v => (
            <div
              key={v.id}
              onClick={() => setSelectedVideo(v)}
              className={`panel-beveled cursor-pointer transition-all duration-150 hover:border-brand-400 ${
                selectedVideo?.id === v.id ? 'border-brand-400 ring-1 ring-brand-500/30' : ''
              }`}
            >
              {/* Thumbnail area */}
              <div className="relative aspect-video bg-surface-sunken overflow-hidden group">
                {v.cpg_thumbnail_url ? (
                  <img src={v.cpg_thumbnail_url} alt={v.title}
                    className="w-full h-full object-cover" />
                ) : (
                  <div className="flex items-center justify-center h-full"
                    style={{ background: 'linear-gradient(135deg, #0d1520 0%, #141e2b 100%)' }}>
                    <Film className="w-8 h-8 text-rmpg-600" />
                  </div>
                )}

                {/* Camera channel badge — top-left */}
                {v.cpg_channel && (
                  <span className={`absolute top-1 left-1 px-1.5 py-0.5 text-[8px] font-bold font-mono uppercase tracking-wider ${channelBg(v.cpg_channel)}`}>
                    {channelLabel(v.cpg_channel)}
                  </span>
                )}

                {/* Event type badge — top-right */}
                {v.cpg_event_type && (
                  <span className={`absolute top-1 right-1 px-1.5 py-0.5 text-[8px] font-bold ${
                    EVENT_TYPE_COLORS[v.cpg_event_type] || EVENT_TYPE_COLORS.default
                  }`}>
                    {v.cpg_event_type}
                  </span>
                )}

                {/* Duration overlay — bottom-right */}
                {v.duration_seconds != null && v.duration_seconds > 0 && (
                  <span className="absolute bottom-1 right-1 px-1.5 py-0.5 bg-black/80 text-[9px] font-mono font-bold text-white">
                    {formatDuration(v.duration_seconds)}
                  </span>
                )}

                {/* Play overlay on hover */}
                <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/40 transition-colors">
                  <Play className="w-8 h-8 text-white opacity-0 group-hover:opacity-80 transition-opacity" />
                </div>
              </div>

              {/* Card metadata */}
              <div className="p-1.5 space-y-0.5">
                <div className="text-[10px] font-semibold text-rmpg-200 truncate" title={v.title}>
                  {v.title}
                </div>
                <div className="flex items-center gap-1.5 text-[9px] text-rmpg-400">
                  {v.unit_call_sign && (
                    <span className="text-brand-400 font-mono font-semibold">{v.unit_call_sign}</span>
                  )}
                  <span className="font-mono">{formatDate(v.recorded_at)}</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className={`inline-flex px-1 py-0.5 text-[8px] font-bold border capitalize ${
                    CLASSIFICATION_COLORS[v.classification] || CLASSIFICATION_COLORS.routine
                  }`}>
                    {v.classification}
                  </span>
                  {v.case_number && (
                    <span className="text-[8px] font-mono text-rmpg-500">Case: {v.case_number}</span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  // ── List View (Left Panel) ───────────────
  const listView = (
    <div className="h-full overflow-y-auto">
      {loading ? (
        <div className="flex items-center justify-center py-16 gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-brand-400" role="status" aria-label="Loading" />
          <span className="text-[10px] text-rmpg-400">Loading videos...</span>
        </div>
      ) : (
        <table className="table-dark w-full">
          <thead className="sticky top-0 z-10">
            <tr>
              <th className="text-left">Title</th>
              <th className="text-left">Cam</th>
              <th className="text-left">Unit</th>
              <th className="text-left">Recorded</th>
              <th className="text-left">Dur.</th>
              <th className="text-left">Class.</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-12">
                  <Film className="w-6 h-6 mx-auto mb-2 text-rmpg-600" />
                  <p className="text-xs text-rmpg-400">No videos found</p>
                </td>
              </tr>
            ) : filtered.map(v => (
              <tr key={v.id}
                onClick={() => setSelectedVideo(v)}
                className={`hover:bg-surface-hover cursor-pointer ${
                  selectedVideo?.id === v.id ? 'bg-brand-500/10 border-l-2 border-l-brand-400' : ''
                }`}
              >
                <td>
                  <div className="flex items-center gap-1.5 min-w-0">
                    <Video className="w-3 h-3 text-cyan-400 flex-shrink-0" />
                    <span className="text-xs font-semibold text-rmpg-200 truncate max-w-[180px]" title={v.title}>
                      {v.title}
                    </span>
                  </div>
                  {v.case_number && (
                    <div className="text-[8px] text-rmpg-500 font-mono mt-0.5">Case: {v.case_number}</div>
                  )}
                </td>
                <td>
                  {v.cpg_channel ? (
                    <span className={`text-[9px] font-mono font-bold ${channelColor(v.cpg_channel)}`}>
                      {channelLabel(v.cpg_channel)}
                    </span>
                  ) : <span className="text-[9px] text-rmpg-600">-</span>}
                </td>
                <td>
                  <span className="text-[9px] text-brand-400 font-mono font-semibold">
                    {v.unit_call_sign || '-'}
                  </span>
                </td>
                <td className="whitespace-nowrap">
                  <span className="text-[9px] font-mono text-rmpg-300">{formatDate(v.recorded_at)}</span>
                </td>
                <td className="whitespace-nowrap">
                  <span className="text-[9px] font-mono text-rmpg-400">{formatDuration(v.duration_seconds)}</span>
                </td>
                <td>
                  <span className={`inline-flex px-1 py-0.5 text-[8px] font-bold border capitalize ${
                    CLASSIFICATION_COLORS[v.classification] || CLASSIFICATION_COLORS.routine
                  }`}>
                    {v.classification}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );

  // ── Detail Panel (Right Panel) ───────────
  const detailPanel = selectedVideo ? (
    <div className="flex flex-col h-full overflow-y-auto" style={{ background: '#0d1520' }}>
      {/* Detail Header */}
      <div className="flex items-center gap-2 px-2 py-1.5 flex-shrink-0"
        style={{ background: 'linear-gradient(180deg, #1e3048, #1a2636)', borderBottom: '1px solid #141e2b' }}>
        <Video className="w-3 h-3 text-cyan-400 flex-shrink-0" />
        <span className="text-[10px] font-semibold text-rmpg-200 truncate flex-1">{selectedVideo.title}</span>
        <button type="button" onClick={() => setPlayingVideo(selectedVideo)} className="toolbar-btn p-1" title="Full screen player with HUD">
          <Maximize2 className="w-3 h-3" />
        </button>
        <button type="button" onClick={() => setSelectedVideo(null)} className="toolbar-btn p-1" title="Close panel">
          <X className="w-3 h-3" />
        </button>
      </div>

      {/* Inline Video Player */}
      <div className="relative bg-black flex-shrink-0">
        <video
          controls autoPlay key={selectedVideo.id}
          className="w-full"
          style={{ maxHeight: '320px' }}
          src={`${apiBase}/fleet/dashcam-videos/${selectedVideo.id}/stream?token=${encodeURIComponent(localStorage.getItem('rmpg_token') || '')}`}
        />
        {/* Camera channel overlay */}
        {selectedVideo.cpg_channel && (
          <div className="absolute top-2 left-2 px-2 py-0.5 bg-black/70 text-[9px] font-mono font-bold uppercase tracking-wider"
            style={{
              color: selectedVideo.cpg_channel === 'outside' ? '#60a5fa' : '#c084fc',
              border: `1px solid ${selectedVideo.cpg_channel === 'outside' ? '#2563eb40' : '#7c3aed40'}`,
            }}>
            {selectedVideo.cpg_channel === 'outside' ? 'FRONT CAM' : 'REAR CAM'}
          </div>
        )}
        {/* REC indicator */}
        <div className="absolute top-2 right-2 flex items-center gap-1">
          <span className="led-dot led-red animate-led-blink" style={{ width: 5, height: 5 }} />
          <span className="font-mono text-[9px] text-red-400 font-bold tracking-wider">REC</span>
        </div>
      </div>

      {/* Metadata Sections */}
      <div className="p-3 space-y-3 flex-1">

        {/* Event Info */}
        <section>
          <h4 className="text-[9px] font-bold text-rmpg-500 uppercase tracking-wider mb-1.5 flex items-center gap-1">
            <Zap className="w-3 h-3" /> Event Information
          </h4>
          <div className="panel-inset p-2 grid grid-cols-2 gap-y-1.5 gap-x-3 text-[10px]">
            <div>
              <span className="text-rmpg-500 block text-[8px] uppercase">Event Type</span>
              {selectedVideo.cpg_event_type ? (
                <span className={`inline-flex px-1 py-0.5 text-[8px] font-bold ${
                  EVENT_TYPE_COLORS[selectedVideo.cpg_event_type] || EVENT_TYPE_COLORS.default
                }`}>
                  {selectedVideo.cpg_event_type}
                </span>
              ) : <span className="text-rmpg-400 font-mono">Manual</span>}
            </div>
            <div>
              <span className="text-rmpg-500 block text-[8px] uppercase">Classification</span>
              <span className={`inline-flex px-1.5 py-0.5 text-[9px] font-bold border capitalize ${
                CLASSIFICATION_COLORS[selectedVideo.classification] || CLASSIFICATION_COLORS.routine
              }`}>
                {selectedVideo.classification}
              </span>
            </div>
            <div>
              <span className="text-rmpg-500 block text-[8px] uppercase">Recorded</span>
              <span className="font-mono text-rmpg-300">{formatDate(selectedVideo.recorded_at)}</span>
            </div>
            <div>
              <span className="text-rmpg-500 block text-[8px] uppercase">Duration</span>
              <span className="font-mono text-rmpg-300">{formatDuration(selectedVideo.duration_seconds)}</span>
            </div>
            <div>
              <span className="text-rmpg-500 block text-[8px] uppercase">File Size</span>
              <span className="font-mono text-rmpg-300">{formatSize(selectedVideo.file_size)}</span>
            </div>
            <div>
              <span className="text-rmpg-500 block text-[8px] uppercase">Source</span>
              <span className={`inline-flex px-1.5 py-0.5 text-[9px] font-bold border ${
                SOURCE_COLORS[selectedVideo.source || 'upload'] || SOURCE_COLORS.upload
              }`}>
                {selectedVideo.source === 'clearpathgps' ? 'ClearPathGPS' : 'Manual Upload'}
              </span>
            </div>
          </div>
        </section>

        {/* Vehicle & Unit */}
        <section>
          <h4 className="text-[9px] font-bold text-rmpg-500 uppercase tracking-wider mb-1.5 flex items-center gap-1">
            <Car className="w-3 h-3" /> Vehicle & Unit
          </h4>
          <div className="panel-inset p-2 grid grid-cols-2 gap-y-1.5 gap-x-3 text-[10px]">
            <div>
              <span className="text-rmpg-500 block text-[8px] uppercase">Vehicle</span>
              <span className="text-rmpg-200">
                {selectedVideo.vehicle_number ? `#${selectedVideo.vehicle_number}` : '--'}
                {selectedVideo.vehicle_make && ` ${selectedVideo.vehicle_year || ''} ${selectedVideo.vehicle_make} ${selectedVideo.vehicle_model || ''}`}
              </span>
            </div>
            <div>
              <span className="text-rmpg-500 block text-[8px] uppercase">Unit</span>
              <span className="text-brand-400 font-mono font-bold">{selectedVideo.unit_call_sign || '--'}</span>
            </div>
            {selectedVideo.cpg_channel && (
              <div>
                <span className="text-rmpg-500 block text-[8px] uppercase">Camera</span>
                <span className={`font-mono font-bold ${channelColor(selectedVideo.cpg_channel)}`}>
                  {selectedVideo.cpg_channel === 'outside' ? 'FRONT CAM' : 'REAR CAM'}
                </span>
              </div>
            )}
            {selectedVideo.speed_mph != null && (
              <div>
                <span className="text-rmpg-500 block text-[8px] uppercase">Speed</span>
                <span className={`font-mono font-bold ${
                  selectedVideo.speed_mph > 80 ? 'text-red-400' : selectedVideo.speed_mph > 60 ? 'text-amber-400' : 'text-green-400'
                }`}>
                  {selectedVideo.speed_mph} MPH
                </span>
              </div>
            )}
          </div>
        </section>

        {/* Location */}
        {(selectedVideo.address || selectedVideo.latitude != null) && (
          <section>
            <h4 className="text-[9px] font-bold text-rmpg-500 uppercase tracking-wider mb-1.5 flex items-center gap-1">
              <MapPin className="w-3 h-3" /> Location
            </h4>
            <div className="panel-inset p-2 space-y-1 text-[10px]">
              {selectedVideo.address && (
                <div className="text-rmpg-200">{selectedVideo.address}</div>
              )}
              {selectedVideo.latitude != null && (
                <div className="font-mono text-rmpg-400 text-[9px]">
                  {selectedVideo.latitude.toFixed(5)}, {selectedVideo.longitude?.toFixed(5)}
                </div>
              )}
            </div>
          </section>
        )}

        {/* Evidence */}
        <section>
          <h4 className="text-[9px] font-bold text-rmpg-500 uppercase tracking-wider mb-1.5 flex items-center gap-1">
            <FileText className="w-3 h-3" /> Evidence
          </h4>
          <div className="panel-inset p-2 space-y-1 text-[10px]">
            {selectedVideo.case_number ? (
              <div>
                <span className="text-rmpg-500">Case #: </span>
                <span className="text-amber-400 font-mono font-bold">{selectedVideo.case_number}</span>
              </div>
            ) : (
              <div className="text-rmpg-500 italic text-[9px]">No case linked</div>
            )}
            {selectedVideo.notes && (
              <div>
                <span className="text-rmpg-500">Notes: </span>
                <span className="text-rmpg-300">{selectedVideo.notes}</span>
              </div>
            )}
          </div>
        </section>

        {/* Quick Actions */}
        {canManage && (
          <section>
            <h4 className="text-[9px] font-bold text-rmpg-500 uppercase tracking-wider mb-1.5">
              Quick Actions
            </h4>
            <div className="flex flex-wrap gap-1.5">
              {(['routine', 'evidence', 'flagged', 'restricted'] as const).map(cls => (
                <button type="button" key={cls}
                  onClick={() => handleQuickClassify(selectedVideo.id, cls)}
                  className={`text-[9px] px-2.5 py-1 capitalize ${
                    selectedVideo.classification === cls ? 'toolbar-btn-primary' : 'toolbar-btn'
                  }`}>
                  {cls}
                </button>
              ))}
            </div>
            <div className="flex gap-1.5 mt-2">
              <button type="button" onClick={() => setEditingVideo(selectedVideo)}
                className="toolbar-btn text-[9px] px-2.5 py-1 flex items-center gap-1">
                <Edit2 className="w-3 h-3" /> Edit
              </button>
              <button type="button" onClick={() => setLinkingVideo(selectedVideo)}
                className="toolbar-btn text-[9px] px-2.5 py-1 flex items-center gap-1">
                <Link2 className="w-3 h-3" /> Link Case
              </button>
              {isAdmin && (
                <button type="button" onClick={() => handleDelete(selectedVideo.id)}
                  className="toolbar-btn text-[9px] px-2.5 py-1 flex items-center gap-1 text-red-400 hover:text-red-300">
                  <Trash2 className="w-3 h-3" /> Delete
                </button>
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  ) : null;

  // ── Render ───────────────────────────────
  // Set document title
  useEffect(() => { document.title = 'Dash Cameras \u2014 RMPG Flex'; }, []);

  // Keyboard shortcut: Escape to close modals
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setEditingVideo(null); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <div className="flex flex-col h-full">
      {/* ── Title Bar ────────────────────── */}
      <PanelTitleBar icon={Camera} title="MVR Review Station">
        {/* System status */}
        <div className="flex items-center gap-1.5 mr-2">
          <span className="led-dot led-green animate-led-pulse" style={{ width: 5, height: 5 }} />
          <span className="text-[8px] font-mono text-rmpg-500 uppercase tracking-wider">
            {stats.total} Videos
          </span>
          <span className="text-[8px] font-mono text-rmpg-600">|</span>
          <span className="text-[8px] font-mono text-rmpg-500">
            {formatSize(stats.totalStorage)}
          </span>
          {storageStats?.disk && (
            <>
              <span className="text-[8px] font-mono text-rmpg-600">|</span>
              <HardDrive className="w-2.5 h-2.5 text-rmpg-500" />
              <span className={`text-[8px] font-mono ${(storageStats.disk.used_pct || 0) > 85 ? 'text-red-400' : 'text-rmpg-500'}`}>
                {storageStats.disk.free_gb}GB free ({storageStats.disk.used_pct}% used)
              </span>
            </>
          )}
        </div>

        {/* View toggle */}
        <div className="flex items-center">
          <button type="button" onClick={() => setViewMode('gallery')} title="Gallery view"
            className={`p-1 ${viewMode === 'gallery' ? 'toolbar-btn-primary' : 'toolbar-btn'}`}>
            <Grid className="w-3 h-3" />
          </button>
          <button type="button" onClick={() => setViewMode('list')} title="List view"
            className={`p-1 ${viewMode === 'list' ? 'toolbar-btn-primary' : 'toolbar-btn'}`}>
            <List className="w-3 h-3" />
          </button>
        </div>
        <div className="h-4 w-px bg-rmpg-700" />
        <RmpgLogo height={20} iconOnly />
        <PrintButton />
        <ExportButton exportUrl="/fleet/dashcam-videos?limit=5000&format=csv" exportFilename="dashcam-videos.csv" />
        {canManage && (
          <button type="button" onClick={() => setShowUpload(true)}
            className="toolbar-btn-primary text-[10px] px-3 py-1.5 flex items-center gap-1.5">
            <Upload className="w-3 h-3" /> Upload
          </button>
        )}
      </PanelTitleBar>

      {/* ── Stats Strip ──────────────────── */}
      <div className="panel-inset flex items-center h-8 overflow-x-auto flex-shrink-0"
        style={{ borderBottom: '1px solid #141e2b' }}>
        <div className="px-3 flex items-center gap-1.5 whitespace-nowrap">
          <Film className="w-3 h-3 text-cyan-400" />
          <span className="text-[10px] font-mono font-bold text-cyan-400">{stats.total}</span>
          <span className="text-[8px] text-rmpg-500 uppercase">Videos</span>
        </div>
        <div className="w-px h-4 bg-rmpg-700 flex-shrink-0" />

        <div className="px-3 flex items-center gap-1.5 whitespace-nowrap">
          <span className="led-dot" style={{ width: 5, height: 5, background: '#60a5fa', boxShadow: '0 0 4px #60a5fa80' }} />
          <span className="text-[10px] font-mono font-bold text-blue-400">{stats.frontCam}</span>
          <span className="text-[8px] text-rmpg-500 uppercase">Front</span>
        </div>
        <div className="w-px h-4 bg-rmpg-700 flex-shrink-0" />

        <div className="px-3 flex items-center gap-1.5 whitespace-nowrap">
          <span className="led-dot" style={{ width: 5, height: 5, background: '#c084fc', boxShadow: '0 0 4px #c084fc80' }} />
          <span className="text-[10px] font-mono font-bold text-purple-400">{stats.rearCam}</span>
          <span className="text-[8px] text-rmpg-500 uppercase">Rear</span>
        </div>
        <div className="w-px h-4 bg-rmpg-700 flex-shrink-0" />

        <div className="px-3 flex items-center gap-1.5 whitespace-nowrap">
          <span className="led-dot led-amber animate-led-pulse" style={{ width: 5, height: 5 }} />
          <span className="text-[10px] font-mono font-bold text-amber-400">{stats.evidence}</span>
          <span className="text-[8px] text-rmpg-500 uppercase">Evidence</span>
        </div>
        <div className="w-px h-4 bg-rmpg-700 flex-shrink-0" />

        <div className="px-3 flex items-center gap-1.5 whitespace-nowrap">
          <span className="led-dot led-red" style={{ width: 5, height: 5 }} />
          <span className="text-[10px] font-mono font-bold text-red-400">{stats.flagged}</span>
          <span className="text-[8px] text-rmpg-500 uppercase">Flagged</span>
        </div>
        <div className="w-px h-4 bg-rmpg-700 flex-shrink-0" />

        <div className="px-3 flex items-center gap-1.5 whitespace-nowrap">
          <span className="led-dot led-green" style={{ width: 5, height: 5 }} />
          <span className="text-[10px] font-mono font-bold text-green-400">{stats.cpg}</span>
          <span className="text-[8px] text-rmpg-500 uppercase">CPG</span>
        </div>

        <div className="ml-auto px-3 flex items-center gap-1.5 whitespace-nowrap">
          <HardDrive className="w-3 h-3 text-rmpg-500" />
          <span className="text-[10px] font-mono text-rmpg-400">{formatSize(stats.totalStorage)}</span>
        </div>
      </div>

      {/* ── Filter Bar ───────────────────── */}
      <div className="panel-inset p-1.5 flex items-center gap-2 flex-wrap flex-shrink-0"
        style={{ borderBottom: '1px solid #141e2b' }}>
        {/* Search */}
        <div className="relative flex-1 min-w-[160px] max-w-[260px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-rmpg-500 pointer-events-none" />
          <input type="text" value={search}
            onChange={e => { setSearch(e.target.value); setPage(0); }}
            placeholder="Search title, case #, unit..." aria-label="Search dash camera videos"
            autoComplete="off"
            className="input-dark text-[10px] pl-7 pr-2 py-1 w-full min-h-[36px]" />
        </div>

        <div className="h-4 w-px bg-rmpg-700" />

        {/* Camera Channel */}
        <span className="text-[8px] text-rmpg-500 uppercase font-bold">Cam:</span>
        {([
          { key: 'all', label: 'All' },
          { key: 'outside', label: 'FRONT' },
          { key: 'inside', label: 'REAR' },
        ] as const).map(ch => (
          <button type="button" key={ch.key}
            onClick={() => { setChannelFilter(ch.key); setPage(0); }}
            className={`text-[10px] px-2 py-1 ${channelFilter === ch.key ? 'toolbar-btn-primary' : 'toolbar-btn'}`}>
            {ch.label}
          </button>
        ))}

        <div className="h-4 w-px bg-rmpg-700" />

        {/* Event Type */}
        {eventTypes.length > 0 && (
          <>
            <span className="text-[8px] text-rmpg-500 uppercase font-bold">Event:</span>
            <select value={eventTypeFilter}
              onChange={e => { setEventTypeFilter(e.target.value); setPage(0); }}
              className="select-dark text-[10px] py-1 w-auto max-w-[150px]">
              <option value="all">All Events</option>
              {eventTypes.map(et => (
                <option key={et} value={et}>{et}</option>
              ))}
            </select>
            <div className="h-4 w-px bg-rmpg-700" />
          </>
        )}

        {/* Classification */}
        <Filter className="w-3 h-3 text-rmpg-500 flex-shrink-0" />
        {['all', 'routine', 'evidence', 'flagged', 'restricted'].map(f => (
          <button type="button" key={f}
            onClick={() => { setClassFilter(f); setPage(0); }}
            className={`text-[10px] px-2 py-1 capitalize ${classFilter === f ? 'toolbar-btn-primary' : 'toolbar-btn'}`}>
            {f}
          </button>
        ))}

        <div className="h-4 w-px bg-rmpg-700" />

        {/* Source */}
        {[
          { key: 'all', label: 'All' },
          { key: 'upload', label: 'Manual' },
          { key: 'clearpathgps', label: 'CPG' },
        ].map(f => (
          <button type="button" key={f.key}
            onClick={() => { setSourceFilter(f.key); setPage(0); }}
            className={`text-[10px] px-2 py-1 ${sourceFilter === f.key ? 'toolbar-btn-primary' : 'toolbar-btn'}`}>
            {f.label}
          </button>
        ))}
      </div>

      {/* ── Split Panel: Gallery/List + Detail ── */}
      <SplitPanel
        left={viewMode === 'gallery' ? galleryView : listView}
        right={detailPanel}
        initialRatio={0.45}
        minLeftPx={320}
        minRightPx={380}
        rightVisible={!!selectedVideo}
        persistKey="dashcam-split"
        leftLabel="Videos"
        rightLabel="Player"
        className="flex-1 min-h-0"
      />

      {/* ── Pagination ───────────────────── */}
      {!loading && totalPages > 1 && (
        <div className="flex items-center justify-between px-3 py-1 flex-shrink-0"
          style={{ borderTop: '1px solid #141e2b', background: '#0d1520' }}>
          <span className="text-[10px] text-rmpg-500">
            Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
          </span>
          <div className="flex items-center gap-1">
            <button type="button" disabled={page === 0} onClick={() => setPage(p => p - 1)}
              className="toolbar-btn p-1 disabled:opacity-30">
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <span className="text-[10px] text-rmpg-400 font-mono px-2">{page + 1} / {totalPages}</span>
            <button type="button" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}
              className="toolbar-btn p-1 disabled:opacity-30">
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* ── Modals ───────────────────────── */}
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
