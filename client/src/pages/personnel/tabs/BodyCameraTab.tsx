// ============================================================
// RMPG Flex — Personnel: Body Camera Tab (All Cameras + Videos)
// Full-featured tab matching initial setup pattern: search,
// sub-tabs (Cameras / Videos), status filters, stats cards,
// print/export, and complete CRUD for cameras & videos.
// ============================================================

import React, { useEffect, useMemo, useState } from 'react';
import {
  Video, Plus, Edit3, Trash2, AlertTriangle, Camera, Search,
  Play, HardDrive, Film, Shield, Clock, Eye, CheckSquare, Square,
  Upload, Loader2,
} from 'lucide-react';
import type { BodyCamera, BodyCamVideo, CameraStatus, VideoClassification } from '../../../types';
import { CAMERA_STATUS_COLORS, EQUIPMENT_CONDITION_COLORS, VIDEO_CLASSIFICATION_COLORS } from '../utils/personnelConstants';
import PrintButton from '../../../components/PrintButton';
import ExportButton from '../../../components/ExportButton';
import RmpgLogo from '../../../components/RmpgLogo';

// ── Filters ──────────────────────────────────────────────────

const STATUS_FILTERS: { value: CameraStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'assigned', label: 'Assigned' },
  { value: 'available', label: 'Available' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'retired', label: 'Retired' },
  { value: 'lost', label: 'Lost' },
];

const VIDEO_CLASS_FILTERS: { value: VideoClassification | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'routine', label: 'Routine' },
  { value: 'evidence', label: 'Evidence' },
  { value: 'flagged', label: 'Flagged' },
  { value: 'restricted', label: 'Restricted' },
];

type SubTab = 'cameras' | 'videos';

// ── Props ────────────────────────────────────────────────────

interface Props {
  cameras: BodyCamera[];
  videos: BodyCamVideo[];
  onAddCamera: () => void;
  onEditCamera: (cam: BodyCamera) => void;
  onDeleteCamera: (camId: number) => void;
  onSelectOfficer?: (officerId: string) => void;
  onPlayVideo?: (video: BodyCamVideo) => void;
  onDeleteVideo?: (videoId: number) => void;
  onUploadVideo?: () => void;
  /** Role-gating: only admin/manager can add/edit/delete */
  canManage?: boolean;
  /** Bulk operations */
  onBulkDeleteVideos?: (ids: number[]) => Promise<void>;
  onBulkClassifyVideos?: (ids: number[], classification: VideoClassification) => Promise<void>;
  onBulkDeleteCameras?: (ids: number[]) => Promise<void>;
  bulkLoading?: boolean;
}

// ── Component ────────────────────────────────────────────────

export default function BodyCameraTab({
  cameras, videos,
  onAddCamera, onEditCamera, onDeleteCamera,
  onSelectOfficer, onPlayVideo, onDeleteVideo,
  onUploadVideo, canManage = true,
  onBulkDeleteVideos, onBulkClassifyVideos, onBulkDeleteCameras,
  bulkLoading = false,
}: Props) {
  const [subTab, setSubTab] = useState<SubTab>('cameras');
  const [statusFilter, setStatusFilter] = useState<CameraStatus | 'all'>('all');
  const [classFilter, setClassFilter] = useState<VideoClassification | 'all'>('all');
  const [search, setSearch] = useState('');

  // ── Bulk selection state ──────────────────────────────────
  const [selectedCameraIds, setSelectedCameraIds] = useState<Set<number>>(new Set());
  const [selectedVideoIds, setSelectedVideoIds] = useState<Set<number>>(new Set());
  const [bulkClassification, setBulkClassification] = useState<VideoClassification>('routine');

  // ── Stats ────────────────────────────────────────────────

  const stats = useMemo(() => {
    const assigned = cameras.filter(c => c.status === 'assigned').length;
    const available = cameras.filter(c => c.status === 'available').length;
    const maintenance = cameras.filter(c => c.status === 'maintenance').length;
    const lostRetired = cameras.filter(c => c.status === 'lost' || c.status === 'retired').length;
    const totalStorageGB = cameras.reduce((s, c) => s + (c.storage_capacity_gb || 0), 0);
    const evidenceVideos = videos.filter(v => v.classification === 'evidence').length;
    const flaggedVideos = videos.filter(v => v.classification === 'flagged').length;
    const totalVideoSizeBytes = videos.reduce((s, v) => s + (v.file_size || 0), 0);
    return { total: cameras.length, assigned, available, maintenance, lostRetired, totalStorageGB, videoCount: videos.length, evidenceVideos, flaggedVideos, totalVideoSizeBytes };
  }, [cameras, videos]);

  // ── Filtered lists ───────────────────────────────────────

  const filteredCameras = useMemo(() => {
    let list = cameras;
    if (statusFilter !== 'all') list = list.filter(c => c.status === statusFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(c =>
        c.camera_id?.toLowerCase().includes(q) ||
        c.officer_name?.toLowerCase().includes(q) ||
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
        v.officer_name?.toLowerCase().includes(q) ||
        v.camera_serial?.toLowerCase().includes(q) ||
        v.case_number?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [videos, classFilter, search]);

  // ── Helpers ──────────────────────────────────────────────

  function formatDate(dateStr?: string): string {
    if (!dateStr) return '-';
    return new Date(dateStr.includes('T') ? dateStr : dateStr + 'T00:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function statusLabel(status: string): string {
    return status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  function statusLedClass(status: string): string {
    switch (status) {
      case 'assigned': return 'led-dot led-blue';
      case 'available': return 'led-dot led-green';
      case 'maintenance': return 'led-dot led-amber';
      case 'lost': return 'led-dot led-red';
      case 'retired': return 'led-dot led-off';
      default: return 'led-dot led-off';
    }
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

  // ── Summary Cards ────────────────────────────────────────

  const SUMMARY_CARDS = [
    { label: 'Total', value: stats.total, color: 'text-rmpg-300', bgClass: 'bg-surface-base', border: 'border-rmpg-700', topBorder: 'border-t-rmpg-500' },
    { label: 'Assigned', value: stats.assigned, color: 'text-blue-400', bgClass: 'bg-[#0a0f1a]', border: 'border-blue-700/30', topBorder: 'border-t-blue-500' },
    { label: 'Available', value: stats.available, color: 'text-green-400', bgClass: 'bg-[#0a1a0a]', border: 'border-green-700/30', topBorder: 'border-t-green-500' },
    { label: 'Maintenance', value: stats.maintenance, color: 'text-amber-400', bgClass: 'bg-[#1a150a]', border: 'border-amber-700/30', topBorder: 'border-t-amber-500' },
    { label: 'Lost / Retired', value: stats.lostRetired, color: 'text-red-400', bgClass: 'bg-[#1a0a0a]', border: 'border-red-700/30', topBorder: 'border-t-red-500' },
    { label: 'Videos', value: stats.videoCount, color: 'text-purple-400', bgClass: 'bg-[#140a1a]', border: 'border-purple-700/30', topBorder: 'border-t-purple-500' },
  ];

  // ── Selection helpers ──────────────────────────────────

  const toggleCamera = (id: number) => {
    setSelectedCameraIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAllCameras = () => {
    if (selectedCameraIds.size === filteredCameras.length) {
      setSelectedCameraIds(new Set());
    } else {
      setSelectedCameraIds(new Set(filteredCameras.map(c => c.id)));
    }
  };

  const toggleVideo = (id: number) => {
    setSelectedVideoIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAllVideos = () => {
    if (selectedVideoIds.size === filteredVideos.length) {
      setSelectedVideoIds(new Set());
    } else {
      setSelectedVideoIds(new Set(filteredVideos.map(v => v.id)));
    }
  };

  const allCamerasSelected = filteredCameras.length > 0 && selectedCameraIds.size === filteredCameras.length;
  const allVideosSelected = filteredVideos.length > 0 && selectedVideoIds.size === filteredVideos.length;

  // ── Render ───────────────────────────────────────────────

  // Set document title
  useEffect(() => { document.title = 'Personnel - Body Cameras \u2014 RMPG Flex'; }, []);

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Video className="w-4 h-4 text-brand-400" />
          <h2 className="text-sm font-bold text-rmpg-200 uppercase tracking-wider">Body Cameras</h2>
        </div>
        <div className="flex items-center gap-1.5">
          <RmpgLogo height={20} iconOnly />
          <PrintButton />
          <ExportButton exportUrl={subTab === 'cameras' ? '/personnel/body-cameras/export?format=csv' : '/personnel/bodycam-videos/export?format=csv'} exportFilename={subTab === 'cameras' ? 'body-cameras.csv' : 'bodycam-videos.csv'} />
          {canManage && onUploadVideo && (
            <button type="button" onClick={onUploadVideo} className="toolbar-btn text-[10px] px-3 py-1.5 flex items-center gap-1.5">
              <Upload className="w-3 h-3" />
              Upload Video
            </button>
          )}
          {canManage && (
            <button type="button" onClick={onAddCamera} className="toolbar-btn-primary text-[10px] px-3 py-1.5 flex items-center gap-1.5">
              <Plus className="w-3 h-3" />
              Assign Camera
            </button>
          )}
        </div>
      </div>

      {/* ── Alert Banner ── */}
      {stats.lostRetired > 0 && (
        <div className="panel-beveled p-3 flex items-center gap-3 border border-red-700/40 border-l-2 border-l-red-500 bg-[#1a0a0a]">
          <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
          <span className="text-xs text-red-400 font-semibold">
            {stats.lostRetired} camera{stats.lostRetired !== 1 ? 's' : ''} lost or retired
          </span>
        </div>
      )}

      {/* ── Summary Cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {SUMMARY_CARDS.map(card => (
          <div
            key={card.label}
            className={`panel-beveled p-2.5 text-center border border-t-2 ${card.border} ${card.bgClass} ${card.topBorder}`}
          >
            <div className={`text-sm font-bold font-mono ${card.color}`}>{card.value}</div>
            <div className="text-[7px] text-rmpg-500 uppercase">{card.label}</div>
          </div>
        ))}
      </div>

      {/* ── Sub-Tabs (Cameras / Videos) ── */}
      <div className="flex items-center gap-0 border-b border-rmpg-700">
        <button type="button"
          onClick={() => setSubTab('cameras')}
          className={`flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-4 py-2 border-b-2 transition-colors ${
            subTab === 'cameras'
              ? 'text-brand-400 border-brand-500'
              : 'text-rmpg-500 border-transparent hover:text-rmpg-300'
          }`}
        >
          <Camera className="w-3 h-3" />
          Cameras ({cameras.length})
        </button>
        <button type="button"
          onClick={() => setSubTab('videos')}
          className={`flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-4 py-2 border-b-2 transition-colors ${
            subTab === 'videos'
              ? 'text-purple-400 border-purple-500'
              : 'text-rmpg-500 border-transparent hover:text-rmpg-300'
          }`}
        >
          <Film className="w-3 h-3" />
          Videos ({videos.length})
          {stats.flaggedVideos > 0 && (
            <span className="ml-1 px-1.5 py-0.5 bg-red-900/60 text-red-400 text-[8px] font-bold border border-red-700/50">
              {stats.flaggedVideos} FLAGGED
            </span>
          )}
        </button>
      </div>

      {/* ── Search + Filters ── */}
      <div className="panel-inset p-2 flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[180px] max-w-[280px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-rmpg-500 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={subTab === 'cameras' ? 'Search cameras, officers...' : 'Search videos, cases...'}
            className="input-dark text-[10px] pl-7 pr-2 py-1 w-full min-h-[36px]"
          />
        </div>
        <div className="h-4 w-px bg-rmpg-700" />
        {subTab === 'cameras' ? (
          STATUS_FILTERS.map(f => (
            <button type="button"
              key={f.value}
              onClick={() => setStatusFilter(f.value)}
              className={`text-[10px] px-2.5 py-1 ${
                statusFilter === f.value ? 'toolbar-btn-primary' : 'toolbar-btn'
              }`}
            >
              {f.label}
            </button>
          ))
        ) : (
          VIDEO_CLASS_FILTERS.map(f => (
            <button type="button"
              key={f.value}
              onClick={() => setClassFilter(f.value)}
              className={`text-[10px] px-2.5 py-1 ${
                classFilter === f.value ? 'toolbar-btn-primary' : 'toolbar-btn'
              }`}
            >
              {f.label}
            </button>
          ))
        )}
      </div>

      {/* ── Bulk Action Toolbar ── */}
      {canManage && subTab === 'cameras' && selectedCameraIds.size > 0 && (
        <div className="panel-beveled p-2 flex items-center gap-2 border border-brand-700/40 bg-brand-900/10">
          <CheckSquare className="w-3.5 h-3.5 text-brand-400" />
          <span className="text-[10px] font-bold text-brand-300">
            {selectedCameraIds.size} camera{selectedCameraIds.size !== 1 ? 's' : ''} selected
          </span>
          <span className="text-rmpg-600">|</span>
          {onBulkDeleteCameras && (
            <button type="button"
              onClick={async () => {
                if (!confirm(`Delete ${selectedCameraIds.size} camera(s) and all their videos?`)) return;
                try { await onBulkDeleteCameras(Array.from(selectedCameraIds)); setSelectedCameraIds(new Set()); } catch { /* handled by parent */ }
              }}
              disabled={bulkLoading}
              className="toolbar-btn toolbar-btn-danger text-[10px] px-2.5 py-1 flex items-center gap-1"
            >
              {bulkLoading ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> : <Trash2 className="w-3 h-3" />}
              Delete Selected
            </button>
          )}
          <button type="button"
            onClick={() => setSelectedCameraIds(new Set())}
            className="toolbar-btn text-[10px] px-2 py-1 ml-auto"
          >
            Clear Selection
          </button>
        </div>
      )}

      {canManage && subTab === 'videos' && selectedVideoIds.size > 0 && (
        <div className="panel-beveled p-2 flex items-center gap-2 border border-purple-700/40 bg-purple-900/10">
          <CheckSquare className="w-3.5 h-3.5 text-purple-400" />
          <span className="text-[10px] font-bold text-purple-300">
            {selectedVideoIds.size} video{selectedVideoIds.size !== 1 ? 's' : ''} selected
          </span>
          <span className="text-rmpg-600">|</span>
          {onBulkDeleteVideos && (
            <button type="button"
              onClick={async () => {
                if (!confirm(`Delete ${selectedVideoIds.size} video(s)? This cannot be undone.`)) return;
                try { await onBulkDeleteVideos(Array.from(selectedVideoIds)); setSelectedVideoIds(new Set()); } catch { /* handled by parent */ }
              }}
              disabled={bulkLoading}
              className="toolbar-btn toolbar-btn-danger text-[10px] px-2.5 py-1 flex items-center gap-1"
            >
              {bulkLoading ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> : <Trash2 className="w-3 h-3" />}
              Delete Selected
            </button>
          )}
          {onBulkClassifyVideos && (
            <div className="flex items-center gap-1">
              <select
                value={bulkClassification}
                onChange={e => setBulkClassification(e.target.value as VideoClassification)}
                className="select-dark text-[10px] py-1 px-2"
              >
                <option value="routine">Routine</option>
                <option value="evidence">Evidence</option>
                <option value="flagged">Flagged</option>
                <option value="restricted">Restricted</option>
              </select>
              <button type="button"
                onClick={async () => {
                  try { await onBulkClassifyVideos(Array.from(selectedVideoIds), bulkClassification); setSelectedVideoIds(new Set()); } catch { /* handled by parent */ }
                }}
                disabled={bulkLoading}
                className="toolbar-btn-primary text-[10px] px-2.5 py-1 flex items-center gap-1"
              >
                {bulkLoading ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> : <Shield className="w-3 h-3" />}
                Classify
              </button>
            </div>
          )}
          <button type="button"
            onClick={() => setSelectedVideoIds(new Set())}
            className="toolbar-btn text-[10px] px-2 py-1 ml-auto"
          >
            Clear Selection
          </button>
        </div>
      )}

      {/* ── Camera Table ── */}
      {subTab === 'cameras' && (
        <div className="panel-beveled overflow-x-auto bg-surface-sunken">
          <table className="table-dark w-full">
            <thead className="sticky top-0 z-10">
              <tr>
                {canManage && (
                  <th className="w-8 text-center">
                    <button type="button" onClick={toggleAllCameras} className="p-0.5 hover:text-brand-400 transition-colors">
                      {allCamerasSelected ? <CheckSquare className="w-3.5 h-3.5 text-brand-400" /> : <Square className="w-3.5 h-3.5 text-rmpg-500" />}
                    </button>
                  </th>
                )}
                <th className="text-left">Camera ID</th>
                <th className="text-left">Make / Model</th>
                <th className="text-left">Firmware</th>
                <th className="text-left">Storage</th>
                <th className="text-left">Condition</th>
                <th className="text-left">Assigned To</th>
                <th className="text-left">Assigned Date</th>
                <th className="text-left">Status</th>
                {canManage && <th className="text-center">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {filteredCameras.length === 0 ? (
                <tr>
                  <td colSpan={canManage ? 10 : 8} className="text-center py-8">
                    <div className="w-12 h-12 mx-auto mb-2 rounded-full border border-rmpg-700 flex items-center justify-center bg-surface-base">
                      <Camera className="w-6 h-6 text-rmpg-600" />
                    </div>
                    <p className="text-[10px] text-rmpg-500">No body cameras found.</p>
                    <p className="text-[9px] text-rmpg-600 mt-0.5">Assign cameras to track officer body-worn devices.</p>
                  </td>
                </tr>
              ) : (
                filteredCameras.map(cam => (
                  <tr
                    key={cam.id}
                    className={`cursor-pointer hover:bg-surface-hover ${cam.status === 'lost' ? 'bg-red-900/10' : ''} ${selectedCameraIds.has(cam.id) ? 'bg-brand-900/20' : ''}`}
                    onClick={() => onSelectOfficer?.(String(cam.officer_id))}
                  >
                    {canManage && (
                      <td className="text-center" onClick={e => e.stopPropagation()}>
                        <button type="button" onClick={() => toggleCamera(cam.id)} className="p-0.5 hover:text-brand-400 transition-colors">
                          {selectedCameraIds.has(cam.id) ? <CheckSquare className="w-3.5 h-3.5 text-brand-400" /> : <Square className="w-3.5 h-3.5 text-rmpg-600" />}
                        </button>
                      </td>
                    )}
                    <td>
                      <span className="text-xs font-mono text-brand-400 font-semibold">{cam.camera_id}</span>
                    </td>
                    <td>
                      <span className="text-xs text-rmpg-300">
                        {[cam.make, cam.model].filter(Boolean).join(' ') || '-'}
                      </span>
                    </td>
                    <td>
                      <span className="text-xs font-mono text-rmpg-400">{cam.firmware_version || '-'}</span>
                    </td>
                    <td>
                      <span className="text-xs font-mono text-rmpg-400">{cam.storage_capacity_gb}GB</span>
                    </td>
                    <td>
                      <span className={`text-xs font-medium capitalize ${(cam.condition && EQUIPMENT_CONDITION_COLORS[cam.condition]) || 'text-rmpg-400'}`}>
                        {cam.condition || '-'}
                      </span>
                    </td>
                    <td>
                      <span className="text-xs text-rmpg-200">{cam.officer_name || '-'}</span>
                    </td>
                    <td>
                      <span className="text-xs font-mono text-rmpg-400">{formatDate(cam.assigned_at)}</span>
                    </td>
                    <td>
                      <div className="flex items-center gap-1.5">
                        <span className={statusLedClass(cam.status)} />
                        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-bold ${
                          CAMERA_STATUS_COLORS[cam.status] || 'bg-rmpg-700 text-rmpg-400 border border-rmpg-600'
                        }`}>
                          {statusLabel(cam.status)}
                        </span>
                      </div>
                    </td>
                    {canManage && (
                      <td className="text-center" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-center gap-1">
                          <button type="button" onClick={() => onEditCamera(cam)} className="toolbar-btn p-1" title="Edit camera">
                            <Edit3 className="w-3 h-3" />
                          </button>
                          <button type="button" onClick={() => onDeleteCamera(cam.id)} className="toolbar-btn toolbar-btn-danger p-1" title="Delete camera">
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Video Table ── */}
      {subTab === 'videos' && (
        <>
          {/* Video Stat Bar */}
          <div className="flex items-center gap-4 text-[10px] text-rmpg-400">
            <span className="flex items-center gap-1">
              <HardDrive className="w-3 h-3" />
              Total: <span className="font-mono text-rmpg-200">{formatFileSize(stats.totalVideoSizeBytes)}</span>
            </span>
            <span className="flex items-center gap-1">
              <Shield className="w-3 h-3 text-amber-400" />
              Evidence: <span className="font-mono text-amber-300">{stats.evidenceVideos}</span>
            </span>
            <span className="flex items-center gap-1">
              <AlertTriangle className="w-3 h-3 text-red-400" />
              Flagged: <span className="font-mono text-red-300">{stats.flaggedVideos}</span>
            </span>
          </div>

          <div className="panel-beveled overflow-x-auto bg-surface-sunken">
            <table className="table-dark w-full">
              <thead className="sticky top-0 z-10">
                <tr>
                  {canManage && (
                    <th className="w-8 text-center">
                      <button type="button" onClick={toggleAllVideos} className="p-0.5 hover:text-purple-400 transition-colors">
                        {allVideosSelected ? <CheckSquare className="w-3.5 h-3.5 text-purple-400" /> : <Square className="w-3.5 h-3.5 text-rmpg-500" />}
                      </button>
                    </th>
                  )}
                  <th className="text-left">Title</th>
                  <th className="text-left">Officer</th>
                  <th className="text-left">Camera</th>
                  <th className="text-left">Duration</th>
                  <th className="text-left">Size</th>
                  <th className="text-left">Recorded</th>
                  <th className="text-left">Classification</th>
                  <th className="text-left">Retention</th>
                  <th className="text-left">Case #</th>
                  <th className="text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredVideos.length === 0 ? (
                  <tr>
                    <td colSpan={canManage ? 11 : 10} className="text-center py-8">
                      <div className="w-12 h-12 mx-auto mb-2 rounded-full border border-rmpg-700 flex items-center justify-center bg-surface-base">
                        <Film className="w-6 h-6 text-rmpg-600" />
                      </div>
                      <p className="text-[10px] text-rmpg-500">No video footage found.</p>
                      <p className="text-[9px] text-rmpg-600 mt-0.5">Videos are uploaded from individual officer detail views.</p>
                    </td>
                  </tr>
                ) : (
                  filteredVideos.map(vid => (
                    <tr key={vid.id} className={`${vid.classification === 'flagged' ? 'bg-red-900/10' : ''} ${selectedVideoIds.has(vid.id) ? 'bg-purple-900/20' : ''}`}>
                      {canManage && (
                        <td className="text-center">
                          <button type="button" onClick={() => toggleVideo(vid.id)} className="p-0.5 hover:text-purple-400 transition-colors">
                            {selectedVideoIds.has(vid.id) ? <CheckSquare className="w-3.5 h-3.5 text-purple-400" /> : <Square className="w-3.5 h-3.5 text-rmpg-600" />}
                          </button>
                        </td>
                      )}
                      <td>
                        <span className="text-xs text-rmpg-200 font-medium">{vid.title}</span>
                      </td>
                      <td>
                        <button type="button"
                          className="text-xs text-brand-400 hover:underline"
                          onClick={() => onSelectOfficer?.(String(vid.officer_id))}
                        >
                          {vid.officer_name || '-'}
                        </button>
                      </td>
                      <td>
                        <span className="text-xs font-mono text-rmpg-400">{vid.camera_serial || '-'}</span>
                      </td>
                      <td>
                        <span className="text-xs font-mono text-rmpg-400 flex items-center gap-1">
                          <Clock className="w-2.5 h-2.5 text-rmpg-500" />
                          {formatDuration(vid.duration_seconds)}
                        </span>
                      </td>
                      <td>
                        <span className="text-xs font-mono text-rmpg-400">{formatFileSize(vid.file_size)}</span>
                      </td>
                      <td>
                        <span className="text-xs font-mono text-rmpg-400">{formatDate(vid.recorded_at)}</span>
                      </td>
                      <td>
                        <span className={`inline-flex items-center px-1.5 py-0.5 text-[9px] font-bold ${
                          VIDEO_CLASSIFICATION_COLORS[vid.classification] || 'bg-rmpg-700 text-rmpg-300'
                        }`}>
                          {statusLabel(vid.classification)}
                        </span>
                      </td>
                      <td>
                        <span className={`text-[9px] font-bold uppercase ${
                          vid.retention_status === 'active' ? 'text-green-400' :
                          vid.retention_status === 'archived' ? 'text-rmpg-500' :
                          'text-amber-400'
                        }`}>
                          {vid.retention_status}
                        </span>
                      </td>
                      <td>
                        <span className="text-xs font-mono text-rmpg-400">{vid.case_number || '-'}</span>
                      </td>
                      <td className="text-center">
                        <div className="flex items-center justify-center gap-1">
                          {onPlayVideo && (
                            <button type="button"
                              onClick={() => onPlayVideo(vid)}
                              className="toolbar-btn p-1"
                              title="Play video"
                            >
                              <Play className="w-3 h-3" />
                            </button>
                          )}
                          {canManage && onDeleteVideo && (
                            <button type="button"
                              onClick={() => onDeleteVideo(vid.id)}
                              className="toolbar-btn toolbar-btn-danger p-1"
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
        </>
      )}
    </div>
  );
}
