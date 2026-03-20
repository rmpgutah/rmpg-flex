// ============================================================
// RMPG Flex — Officer Body Camera Detail Tab
// ============================================================

import React, { useState } from 'react';
import { Video, Plus, Edit2, Trash2, Loader2, Camera, Play, Upload, Download, Eye } from 'lucide-react';
import type { BodyCamera, BodyCamVideo } from '../../../types';
import { CAMERA_STATUS_COLORS, EQUIPMENT_CONDITION_COLORS, VIDEO_CLASSIFICATION_COLORS } from '../utils/personnelConstants';

interface Props {
  cameras: BodyCamera[];
  videos: BodyCamVideo[];
  onAddCamera: () => void;
  onEditCamera: (cam: BodyCamera) => void;
  onDeleteCamera: (camId: number) => void;
  onUploadVideo: () => void;
  onDeleteVideo: (videoId: number) => void;
  onEditVideo: (video: BodyCamVideo) => void;
  onPlayVideo: (video: BodyCamVideo) => void;
  loading: boolean;
}

export default function BodyCameraDetailTab({
  cameras,
  videos,
  onAddCamera,
  onEditCamera,
  onDeleteCamera,
  onUploadVideo,
  onDeleteVideo,
  onEditVideo,
  onPlayVideo,
  loading,
}: Props) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-4 h-4 text-brand-400 animate-spin" />
        <span className="ml-2 text-xs text-rmpg-400">Loading body cameras...</span>
      </div>
    );
  }

  const [activeSubTab, setActiveSubTab] = useState<'cameras' | 'videos'>('cameras');

  const formatDate = (d?: string) => {
    if (!d) return '-';
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const formatFileSize = (bytes: number) => {
    if (!bytes) return '-';
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const formatDuration = (seconds?: number) => {
    if (!seconds) return '-';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const statusLabel = (status: string) => status.replace(/_/g, ' ').toUpperCase();
  const classLabel = (cls: string) => cls.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  const topBorderColor = (status: string) => {
    switch (status) {
      case 'assigned': return 'border-t-2 border-t-blue-500';
      case 'available': return 'border-t-2 border-t-green-500';
      case 'maintenance': return 'border-t-2 border-t-amber-500';
      case 'lost': return 'border-t-2 border-t-red-500';
      default: return 'border-t-2 border-t-rmpg-600';
    }
  };

  const ledClass = (status: string) => {
    switch (status) {
      case 'assigned': return 'led-dot led-blue';
      case 'available': return 'led-dot led-green';
      case 'maintenance': return 'led-dot led-amber';
      case 'lost': return 'led-dot led-red';
      default: return 'led-dot led-off';
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="section-header">
        <Camera className="w-3.5 h-3.5 section-icon" />
        <h3>Body Cameras</h3>
      </div>

      {/* Status Overview */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div className="stat-pod panel-beveled p-2 text-center bg-surface-base border-t-2 border-t-blue-500 summary-card-shimmer" style={{ '--pod-glow': 'rgba(59, 130, 246, 0.12)' } as React.CSSProperties}>
          <p className="text-lg font-bold text-blue-400 font-mono stat-value">{cameras.filter(c => c.status === 'assigned').length}</p>
          <p className="field-label">Assigned</p>
        </div>
        <div className="stat-pod panel-beveled p-2 text-center bg-surface-base border-t-2 border-t-rmpg-500 summary-card-shimmer" style={{ '--pod-glow': 'rgba(148, 163, 184, 0.08)' } as React.CSSProperties}>
          <p className="text-lg font-bold text-rmpg-200 font-mono stat-value">{cameras.length}</p>
          <p className="field-label">Total Cameras</p>
        </div>
        <div className="stat-pod panel-beveled p-2 text-center bg-surface-base border-t-2 border-t-purple-500 summary-card-shimmer" style={{ '--pod-glow': 'rgba(147, 51, 234, 0.12)' } as React.CSSProperties}>
          <p className="text-lg font-bold text-purple-400 font-mono stat-value">{videos.length}</p>
          <p className="field-label">Videos</p>
        </div>
      </div>

      {/* Sub-Tab Switcher */}
      <div className="flex items-center gap-4 border-b border-rmpg-700 pb-0">
        <button
          onClick={() => setActiveSubTab('cameras')}
          className={`sub-tab pb-2 text-[11px] font-bold uppercase tracking-wider transition-colors ${
            activeSubTab === 'cameras' ? 'sub-tab-active text-brand-400' : 'text-rmpg-500 hover:text-rmpg-300'
          }`}
        >
          <Camera className="w-3 h-3 inline mr-1" />
          Cameras ({cameras.length})
        </button>
        <button
          onClick={() => setActiveSubTab('videos')}
          className={`sub-tab pb-2 text-[11px] font-bold uppercase tracking-wider transition-colors ${
            activeSubTab === 'videos' ? 'sub-tab-active text-purple-400' : 'text-rmpg-500 hover:text-rmpg-300'
          }`}
          style={{ '--tab-color': '#9333ea' } as React.CSSProperties}
        >
          <Video className="w-3 h-3 inline mr-1" />
          Videos ({videos.length})
        </button>
        <div className="flex-1" />
        {activeSubTab === 'cameras' ? (
          <button
            onClick={onAddCamera}
            className="toolbar-btn toolbar-btn-primary flex items-center gap-1 text-[10px]"
          >
            <Plus className="w-3 h-3" />
            Assign Camera
          </button>
        ) : (
          <button
            onClick={onUploadVideo}
            className="toolbar-btn toolbar-btn-primary flex items-center gap-1 text-[10px]"
            disabled={cameras.length === 0}
            title={cameras.length === 0 ? 'Assign a camera first' : 'Upload video'}
          >
            <Upload className="w-3 h-3" />
            Upload Video
          </button>
        )}
      </div>

      {/* Cameras Sub-Tab */}
      {activeSubTab === 'cameras' && (
        <>
          {cameras.length > 0 ? (
            <div className="personnel-table panel-beveled overflow-x-auto bg-surface-sunken">
              <table className="table-dark w-full">
                <thead>
                  <tr>
                    <th className="text-left">Camera ID</th>
                    <th className="text-left">Make / Model</th>
                    <th className="text-left">Firmware</th>
                    <th className="text-right">Storage</th>
                    <th className="text-left">Condition</th>
                    <th className="text-left">Status</th>
                    <th className="text-left">Assigned</th>
                    <th className="text-center">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {cameras.map((cam) => (
                    <tr key={cam.id}>
                      <td>
                        <div className="flex items-center gap-1.5">
                          <span className={ledClass(cam.status)} />
                          <span className="text-xs font-semibold text-rmpg-100 font-mono">{cam.camera_id}</span>
                        </div>
                      </td>
                      <td>
                        <span className="text-xs text-rmpg-200">{[cam.make, cam.model].filter(Boolean).join(' ') || '-'}</span>
                      </td>
                      <td>
                        <span className="text-xs text-rmpg-200 font-mono">{cam.firmware_version || '-'}</span>
                      </td>
                      <td className="text-right">
                        <span className="text-xs text-rmpg-200 font-mono">{cam.storage_capacity_gb}GB</span>
                      </td>
                      <td>
                        <span className={`text-xs font-medium capitalize ${EQUIPMENT_CONDITION_COLORS[cam.condition] || 'text-rmpg-400'}`}>
                          {cam.condition}
                        </span>
                      </td>
                      <td>
                        <span className={`badge-pill text-[9px] px-1.5 py-0.5 font-bold ${CAMERA_STATUS_COLORS[cam.status] || 'bg-rmpg-700 text-rmpg-300'}`}>
                          {statusLabel(cam.status)}
                        </span>
                      </td>
                      <td>
                        <span className="text-xs text-rmpg-200 font-mono">{formatDate(cam.assigned_at)}</span>
                        {cam.returned_at && (
                          <span className="block text-[9px] text-rmpg-500 font-mono">ret: {formatDate(cam.returned_at)}</span>
                        )}
                      </td>
                      <td className="text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={() => onEditCamera(cam)} className="toolbar-btn p-1" title="Edit camera">
                            <Edit2 className="w-3 h-3" />
                          </button>
                          <button onClick={() => onDeleteCamera(cam.id)} className="toolbar-btn toolbar-btn-danger p-1" title="Delete camera">
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="panel-beveled p-8 text-center bg-surface-base">
              <Camera className="w-8 h-8 text-rmpg-600 mx-auto mb-2 empty-state-icon" />
              <p className="text-xs text-rmpg-400">No cameras assigned</p>
              <p className="text-[10px] text-rmpg-600 mt-1">Click &quot;Assign Camera&quot; to get started.</p>
            </div>
          )}
        </>
      )}

      {/* Videos Sub-Tab */}
      {activeSubTab === 'videos' && (
        <>
          {videos.length > 0 ? (
            <div className="personnel-table panel-beveled overflow-x-auto bg-surface-sunken">
              <table className="table-dark w-full">
                <thead>
                  <tr>
                    <th className="text-left">Title</th>
                    <th className="text-left">Camera</th>
                    <th className="text-left">Duration</th>
                    <th className="text-left">Size</th>
                    <th className="text-left">Recorded</th>
                    <th className="text-left">Class</th>
                    <th className="text-left">Case #</th>
                    <th className="text-center">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {videos.map((vid) => (
                    <tr key={vid.id}>
                      <td>
                        <span className="text-xs text-rmpg-200 font-medium">{vid.title}</span>
                      </td>
                      <td>
                        <span className="text-xs font-mono text-rmpg-400">{vid.camera_serial || '-'}</span>
                      </td>
                      <td>
                        <span className="text-xs font-mono text-rmpg-400">{formatDuration(vid.duration_seconds)}</span>
                      </td>
                      <td>
                        <span className="text-xs font-mono text-rmpg-400">{formatFileSize(vid.file_size)}</span>
                      </td>
                      <td>
                        <span className="text-xs font-mono text-rmpg-400">{formatDate(vid.recorded_at)}</span>
                      </td>
                      <td>
                        <span className={`badge-pill inline-flex items-center px-1.5 py-0.5 text-[9px] font-bold ${
                          VIDEO_CLASSIFICATION_COLORS[vid.classification] || 'bg-rmpg-700 text-rmpg-300'
                        }`}>
                          {classLabel(vid.classification)}
                        </span>
                      </td>
                      <td>
                        <span className="text-xs font-mono text-rmpg-400">{vid.case_number || '-'}</span>
                      </td>
                      <td className="text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => onPlayVideo(vid)}
                            className="toolbar-btn p-1"
                            title="Play video"
                          >
                            <Play className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => onEditVideo(vid)}
                            className="toolbar-btn p-1"
                            title="Edit video metadata"
                          >
                            <Edit2 className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => onDeleteVideo(vid.id)}
                            className="toolbar-btn toolbar-btn-danger p-1"
                            title="Delete video"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="panel-beveled p-6 text-center bg-surface-base">
              <Video className="w-6 h-6 text-rmpg-600 mx-auto mb-2 empty-state-icon" />
              <p className="text-xs text-rmpg-400">No video footage uploaded</p>
              {cameras.length === 0 && (
                <p className="text-[9px] text-rmpg-600 mt-0.5">Assign a camera first to upload videos.</p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
