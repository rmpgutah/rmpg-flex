// ============================================================
// RMPG Flex — Dash Camera Tab (All Cameras + Videos)
// Camera cards, video grid, search, filters, bulk operations.
// ============================================================

import React, { useMemo, useState } from 'react';
import {
  Video, Plus, Edit3, Trash2, AlertTriangle, Camera, Search,
  Play, HardDrive, Film, Shield, Clock, Eye, CheckSquare, Square,
  Upload, Loader2, Car,
} from 'lucide-react';
import type { DashCamera, DashCamVideo, DashCameraStatus, VideoClassification } from '../../types';
import PrintButton from '../../components/PrintButton';
import RmpgLogo from '../../components/RmpgLogo';

// ── Filters ──────────────────────────────────────────────────

const STATUS_FILTERS: { value: DashCameraStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'installed', label: 'Installed' },
  { value: 'available', label: 'Available' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'damaged', label: 'Damaged' },
  { value: 'lost', label: 'Lost' },
];

const VIDEO_CLASS_FILTERS: { value: VideoClassification | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'routine', label: 'Routine' },
  { value: 'evidence', label: 'Evidence' },
  { value: 'flagged', label: 'Flagged' },
  { value: 'restricted', label: 'Restricted' },
];

const STATUS_LED: Record<string, string> = {
  installed: 'led-dot led-blue',
  available: 'led-dot led-green',
  maintenance: 'led-dot led-amber',
  damaged: 'led-dot led-red',
  lost: 'led-dot led-off',
};

const CLASS_COLORS: Record<string, string> = {
  routine: 'text-rmpg-400 bg-rmpg-800',
  evidence: 'text-amber-400 bg-amber-900/40',
  flagged: 'text-red-400 bg-red-900/40',
  restricted: 'text-purple-400 bg-purple-900/40',
};

type SubTab = 'cameras' | 'videos';

// ── Props ────────────────────────────────────────────────────

interface Props {
  cameras: DashCamera[];
  videos: DashCamVideo[];
  onAddCamera: () => void;
  onEditCamera: (cam: DashCamera) => void;
  onDeleteCamera: (camId: number) => void;
  onPlayVideo?: (video: DashCamVideo) => void;
  onDeleteVideo?: (videoId: number) => void;
  onUploadVideo?: () => void;
  canManage?: boolean;
  onBulkDeleteVideos?: (ids: number[]) => Promise<void>;
  onBulkClassifyVideos?: (ids: number[], classification: VideoClassification) => Promise<void>;
  onBulkDeleteCameras?: (ids: number[]) => Promise<void>;
  bulkLoading?: boolean;
}

// ── Helpers ──────────────────────────────────────────────────

function formatDate(dateStr?: string): string {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function statusLabel(status: string): string {
  return status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function formatFileSize(bytes: number): string {
  if (!bytes) return '-';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDuration(seconds?: number): string {
  if (!seconds) return '-';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ── Component ────────────────────────────────────────────────

export default function DashCameraTab({
  cameras, videos,
  onAddCamera, onEditCamera, onDeleteCamera,
  onPlayVideo, onDeleteVideo, onUploadVideo,
  canManage = true,
  onBulkDeleteVideos, onBulkClassifyVideos, onBulkDeleteCameras,
  bulkLoading = false,
}: Props) {
  const [subTab, setSubTab] = useState<SubTab>('cameras');
  const [statusFilter, setStatusFilter] = useState<DashCameraStatus | 'all'>('all');
  const [classFilter, setClassFilter] = useState<VideoClassification | 'all'>('all');
  const [search, setSearch] = useState('');
  const [selectedCameraIds, setSelectedCameraIds] = useState<Set<number>>(new Set());
  const [selectedVideoIds, setSelectedVideoIds] = useState<Set<number>>(new Set());
  const [bulkClassification, setBulkClassification] = useState<VideoClassification>('routine');

  // ── Stats ────────────────────────────────────────────────
  const stats = useMemo(() => {
    const installed = cameras.filter(c => c.status === 'installed').length;
    const available = cameras.filter(c => c.status === 'available').length;
    const maintenance = cameras.filter(c => c.status === 'maintenance').length;
    const damaged = cameras.filter(c => c.status === 'damaged' || c.status === 'lost').length;
    const evidenceVideos = videos.filter(v => v.classification === 'evidence').length;
    const totalVideoSize = videos.reduce((s, v) => s + (v.file_size || 0), 0);
    return { total: cameras.length, installed, available, maintenance, damaged, videoCount: videos.length, evidenceVideos, totalVideoSize };
  }, [cameras, videos]);

  // ── Filtered lists ───────────────────────────────────────
  const filteredCameras = useMemo(() => {
    let list = cameras;
    if (statusFilter !== 'all') list = list.filter(c => c.status === statusFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(c =>
        c.camera_id?.toLowerCase().includes(q) ||
        c.vehicle_number?.toLowerCase().includes(q) ||
        c.make?.toLowerCase().includes(q) ||
        c.model?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [cameras, statusFilter, search]);

  const filteredVideos = useMemo(() => {
    let list = videos;
    if (classFilter !== 'all') list = list.filter(v => v.classification === classFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(v =>
        v.title?.toLowerCase().includes(q) ||
        v.vehicle_number?.toLowerCase().includes(q) ||
        v.camera_serial?.toLowerCase().includes(q) ||
        v.case_number?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [videos, classFilter, search]);

  // ── Selection ────────────────────────────────────────────
  const toggleCamera = (id: number) => {
    setSelectedCameraIds(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  };
  const toggleAllCameras = () => {
    setSelectedCameraIds(selectedCameraIds.size === filteredCameras.length ? new Set() : new Set(filteredCameras.map(c => c.id)));
  };
  const toggleVideo = (id: number) => {
    setSelectedVideoIds(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  };
  const toggleAllVideos = () => {
    setSelectedVideoIds(selectedVideoIds.size === filteredVideos.length ? new Set() : new Set(filteredVideos.map(v => v.id)));
  };

  const SUMMARY_CARDS = [
    { label: 'Total', value: stats.total, color: 'text-rmpg-300', bgClass: 'bg-surface-base', border: 'border-rmpg-700', topBorder: 'border-t-rmpg-500' },
    { label: 'Installed', value: stats.installed, color: 'text-gray-400', bgClass: 'bg-surface-base', border: 'border-gray-600/30', topBorder: 'border-t-gray-500' },
    { label: 'Available', value: stats.available, color: 'text-green-400', bgClass: 'bg-[#0a1a0a]', border: 'border-green-700/30', topBorder: 'border-t-green-500' },
    { label: 'Maintenance', value: stats.maintenance, color: 'text-amber-400', bgClass: 'bg-[#1a150a]', border: 'border-amber-700/30', topBorder: 'border-t-amber-500' },
    { label: 'Damaged/Lost', value: stats.damaged, color: 'text-red-400', bgClass: 'bg-[#1a0a0a]', border: 'border-red-700/30', topBorder: 'border-t-red-500' },
    { label: 'Videos', value: stats.videoCount, color: 'text-purple-400', bgClass: 'bg-[#140a1a]', border: 'border-purple-700/30', topBorder: 'border-t-purple-500' },
  ];

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Camera className="w-4 h-4 text-brand-400" />
          <h2 className="text-sm font-bold text-rmpg-200 uppercase tracking-wider">Dash Cameras</h2>
        </div>
        <div className="flex items-center gap-1.5">
          <RmpgLogo height={20} iconOnly />
          <PrintButton />
          {canManage && onUploadVideo && (
            <button onClick={onUploadVideo} className="toolbar-btn text-[10px] px-3 py-1.5 flex items-center gap-1.5">
              <Upload className="w-3 h-3" /> Upload Video
            </button>
          )}
          {canManage && (
            <button onClick={onAddCamera} className="toolbar-btn-primary text-[10px] px-3 py-1.5 flex items-center gap-1.5">
              <Plus className="w-3 h-3" /> Install Camera
            </button>
          )}
        </div>
      </div>

      {/* Alert Banner */}
      {stats.damaged > 0 && (
        <div className="panel-beveled p-3 flex items-center gap-3 border border-red-700/40 border-l-2 border-l-red-500 bg-[#1a0a0a]">
          <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
          <span className="text-xs text-red-400 font-semibold">
            {stats.damaged} camera{stats.damaged !== 1 ? 's' : ''} damaged or lost
          </span>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-6 gap-2">
        {SUMMARY_CARDS.map(card => (
          <div key={card.label} className={`panel-beveled p-2.5 text-center border border-t-2 ${card.border} ${card.bgClass} ${card.topBorder}`}>
            <div className={`text-sm font-bold font-mono ${card.color}`}>{card.value}</div>
            <div className="text-[7px] text-rmpg-500 uppercase">{card.label}</div>
          </div>
        ))}
      </div>

      {/* Sub-Tabs */}
      <div className="flex items-center gap-0 border-b border-rmpg-700">
        <button onClick={() => setSubTab('cameras')} className={`flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-4 py-2 border-b-2 transition-colors ${subTab === 'cameras' ? 'text-brand-400 border-brand-500' : 'text-rmpg-500 border-transparent hover:text-rmpg-300'}`}>
          <Camera className="w-3 h-3" /> Cameras ({cameras.length})
        </button>
        <button onClick={() => setSubTab('videos')} className={`flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-4 py-2 border-b-2 transition-colors ${subTab === 'videos' ? 'text-brand-400 border-brand-500' : 'text-rmpg-500 border-transparent hover:text-rmpg-300'}`}>
          <Film className="w-3 h-3" /> Videos ({videos.length})
        </button>
      </div>

      {/* Search + Filter */}
      <div className="flex items-center gap-2">
        <div className="flex-1 relative">
          <Search className="w-3.5 h-3.5 text-rmpg-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input type="text" placeholder={subTab === 'cameras' ? 'Search cameras...' : 'Search videos...'} value={search} onChange={e => setSearch(e.target.value)} className="input-dark pl-8 text-xs w-full" />
        </div>
        {subTab === 'cameras' ? (
          <div className="flex items-center gap-1">
            {STATUS_FILTERS.map(f => (
              <button key={f.value} onClick={() => setStatusFilter(f.value)} className={`text-[10px] px-2 py-1 rounded ${statusFilter === f.value ? 'bg-brand-600 text-white' : 'text-rmpg-400 hover:text-rmpg-200'}`}>
                {f.label}
              </button>
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-1">
            {VIDEO_CLASS_FILTERS.map(f => (
              <button key={f.value} onClick={() => setClassFilter(f.value)} className={`text-[10px] px-2 py-1 rounded ${classFilter === f.value ? 'bg-brand-600 text-white' : 'text-rmpg-400 hover:text-rmpg-200'}`}>
                {f.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Cameras Tab */}
      {subTab === 'cameras' && (
        <>
          {/* Bulk toolbar */}
          {selectedCameraIds.size > 0 && canManage && (
            <div className="flex items-center gap-2 p-2 panel-beveled border border-brand-700/30 bg-brand-900/20">
              <span className="text-[10px] text-brand-400 font-mono">{selectedCameraIds.size} selected</span>
              <div className="flex-1" />
              {onBulkDeleteCameras && (
                <button onClick={() => onBulkDeleteCameras(Array.from(selectedCameraIds)).then(() => setSelectedCameraIds(new Set()))}
                  disabled={bulkLoading} className="toolbar-btn text-[10px] text-red-400 hover:text-red-300">
                  {bulkLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                  Delete
                </button>
              )}
            </div>
          )}

          {/* Select all */}
          {filteredCameras.length > 0 && canManage && (
            <div className="flex items-center gap-2 px-1">
              <button onClick={toggleAllCameras} className="text-rmpg-500 hover:text-rmpg-300">
                {selectedCameraIds.size === filteredCameras.length ? <CheckSquare className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
              </button>
              <span className="text-[9px] text-rmpg-500 uppercase">Select All</span>
            </div>
          )}

          {/* Camera cards */}
          <div className="space-y-2">
            {filteredCameras.length === 0 && (
              <div className="text-center py-8 text-rmpg-500 text-xs">No dash cameras found</div>
            )}
            {filteredCameras.map(cam => (
              <div key={cam.id} className="panel-beveled p-3 flex items-center gap-3 hover:bg-rmpg-800/40 transition-colors">
                {canManage && (
                  <button onClick={() => toggleCamera(cam.id)} className="text-rmpg-500 hover:text-rmpg-300">
                    {selectedCameraIds.has(cam.id) ? <CheckSquare className="w-3.5 h-3.5 text-brand-400" /> : <Square className="w-3.5 h-3.5" />}
                  </button>
                )}
                <div className={STATUS_LED[cam.status] || 'led-dot led-off'} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-rmpg-200">{cam.camera_id}</span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-rmpg-800 text-rmpg-400 uppercase">{statusLabel(cam.status)}</span>
                    <span className="text-[9px] text-rmpg-500">{cam.channel_count}ch</span>
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 text-[10px] text-rmpg-500">
                    <span className="flex items-center gap-1"><Car className="w-3 h-3" />{cam.vehicle_number || 'Unassigned'}</span>
                    {cam.make && <span>{cam.make} {cam.model}</span>}
                    <span className="flex items-center gap-1"><HardDrive className="w-3 h-3" />{cam.storage_capacity_gb}GB</span>
                    {cam.installed_at && <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{formatDate(cam.installed_at)}</span>}
                  </div>
                </div>
                {canManage && (
                  <div className="flex items-center gap-1">
                    <button onClick={() => onEditCamera(cam)} className="toolbar-btn p-1"><Edit3 className="w-3 h-3" /></button>
                    <button onClick={() => { if (confirm('Delete this dash camera?')) onDeleteCamera(cam.id); }} className="toolbar-btn p-1 text-red-400 hover:text-red-300"><Trash2 className="w-3 h-3" /></button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/* Videos Tab */}
      {subTab === 'videos' && (
        <>
          {/* Bulk toolbar */}
          {selectedVideoIds.size > 0 && canManage && (
            <div className="flex items-center gap-2 p-2 panel-beveled border border-brand-700/30 bg-brand-900/20">
              <span className="text-[10px] text-brand-400 font-mono">{selectedVideoIds.size} selected</span>
              <div className="flex-1" />
              {onBulkClassifyVideos && (
                <div className="flex items-center gap-1">
                  <select value={bulkClassification} onChange={e => setBulkClassification(e.target.value as VideoClassification)} className="select-dark text-[10px] py-0.5 w-24">
                    <option value="routine">Routine</option>
                    <option value="evidence">Evidence</option>
                    <option value="flagged">Flagged</option>
                    <option value="restricted">Restricted</option>
                  </select>
                  <button onClick={() => onBulkClassifyVideos(Array.from(selectedVideoIds), bulkClassification).then(() => setSelectedVideoIds(new Set()))}
                    disabled={bulkLoading} className="toolbar-btn text-[10px]">
                    {bulkLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Shield className="w-3 h-3" />}
                    Classify
                  </button>
                </div>
              )}
              {onBulkDeleteVideos && (
                <button onClick={() => onBulkDeleteVideos(Array.from(selectedVideoIds)).then(() => setSelectedVideoIds(new Set()))}
                  disabled={bulkLoading} className="toolbar-btn text-[10px] text-red-400 hover:text-red-300">
                  {bulkLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                  Delete
                </button>
              )}
            </div>
          )}

          {/* Select all */}
          {filteredVideos.length > 0 && canManage && (
            <div className="flex items-center gap-2 px-1">
              <button onClick={toggleAllVideos} className="text-rmpg-500 hover:text-rmpg-300">
                {selectedVideoIds.size === filteredVideos.length ? <CheckSquare className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
              </button>
              <span className="text-[9px] text-rmpg-500 uppercase">Select All</span>
            </div>
          )}

          {/* Video cards */}
          <div className="space-y-2">
            {filteredVideos.length === 0 && (
              <div className="text-center py-8 text-rmpg-500 text-xs">No dash cam videos found</div>
            )}
            {filteredVideos.map(vid => (
              <div key={vid.id} className="panel-beveled p-3 flex items-center gap-3 hover:bg-rmpg-800/40 transition-colors">
                {canManage && (
                  <button onClick={() => toggleVideo(vid.id)} className="text-rmpg-500 hover:text-rmpg-300">
                    {selectedVideoIds.has(vid.id) ? <CheckSquare className="w-3.5 h-3.5 text-brand-400" /> : <Square className="w-3.5 h-3.5" />}
                  </button>
                )}
                <button onClick={() => onPlayVideo?.(vid)} className="flex-shrink-0 w-10 h-10 rounded bg-rmpg-800 border border-rmpg-700 flex items-center justify-center hover:bg-rmpg-700 transition-colors">
                  <Play className="w-4 h-4 text-brand-400" />
                </button>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-rmpg-200 truncate">{vid.title}</span>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded uppercase ${CLASS_COLORS[vid.classification] || 'text-rmpg-400 bg-rmpg-800'}`}>
                      {vid.classification}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 text-[10px] text-rmpg-500">
                    <span className="flex items-center gap-1"><Car className="w-3 h-3" />{vid.vehicle_number || '-'}</span>
                    <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{formatDuration(vid.duration_seconds)}</span>
                    <span className="flex items-center gap-1"><HardDrive className="w-3 h-3" />{formatFileSize(vid.file_size)}</span>
                    {vid.case_number && <span className="flex items-center gap-1"><Shield className="w-3 h-3" />{vid.case_number}</span>}
                    {vid.recorded_at && <span>{formatDate(vid.recorded_at)}</span>}
                  </div>
                </div>
                {canManage && onDeleteVideo && (
                  <button onClick={() => { if (confirm('Delete this video?')) onDeleteVideo(vid.id); }} className="toolbar-btn p-1 text-red-400 hover:text-red-300">
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
