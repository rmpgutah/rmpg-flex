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
      {/* Cameras Section */}
      <div className="flex items-center justify-between">
        <h3 className="field-label text-brand-400 flex items-center gap-1.5">
          <Camera className="w-3 h-3" />
          Assigned Cameras
        </h3>
        <button
          onClick={onAddCamera}
          className="toolbar-btn toolbar-btn-primary flex items-center gap-1 text-[10px]"
        >
          <Plus className="w-3 h-3" />
          Assign Camera
        </button>
      </div>

      {/* Camera Status Overview */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div className="panel-beveled p-2 text-center bg-surface-base border-t-2 border-t-blue-500">
          <p className="text-lg font-bold text-blue-400 font-mono">{cameras.filter(c => c.status === 'assigned').length}</p>
          <p className="field-label">Assigned</p>
        </div>
        <div className="panel-beveled p-2 text-center bg-surface-base border-t-2 border-t-rmpg-500">
          <p className="text-lg font-bold text-rmpg-200 font-mono">{cameras.length}</p>
          <p className="field-label">Total Cameras</p>
        </div>
        <div className="panel-beveled p-2 text-center bg-surface-base border-t-2 border-t-purple-500">
          <p className="text-lg font-bold text-purple-400 font-mono">{videos.length}</p>
          <p className="field-label">Videos</p>
        </div>
      </div>

      {/* Camera Cards */}
      {cameras.length > 0 ? (
        <div className="space-y-3">
          {cameras.map((cam) => (
            <div key={cam.id} className={`panel-beveled p-3 bg-surface-base ${topBorderColor(cam.status)}`}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className={ledClass(cam.status)} />
                  <h4 className="text-xs font-semibold text-rmpg-100 font-mono">{cam.camera_id}</h4>
                  <span className={`text-[9px] px-1.5 py-0.5 font-bold ${CAMERA_STATUS_COLORS[cam.status] || 'bg-rmpg-700 text-rmpg-300'}`}>
                    {statusLabel(cam.status)}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => onEditCamera(cam)} className="toolbar-btn p-1" title="Edit camera">
                    <Edit2 className="w-3 h-3" />
                  </button>
                  <button onClick={() => onDeleteCamera(cam.id)} className="toolbar-btn toolbar-btn-danger p-1" title="Delete camera">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 mb-2">
                <div>
                  <p className="field-label">Make / Model</p>
                  <p className="text-xs text-rmpg-100">{[cam.make, cam.model].filter(Boolean).join(' ') || '-'}</p>
                </div>
                <div>
                  <p className="field-label">Firmware</p>
                  <p className="text-xs text-rmpg-100 font-mono">{cam.firmware_version || '-'}</p>
                </div>
                <div>
                  <p className="field-label">Storage</p>
                  <p className="text-xs text-rmpg-100 font-mono">{cam.storage_capacity_gb}GB</p>
                </div>
                <div>
                  <p className="field-label">Condition</p>
                  <p className={`text-xs font-medium capitalize ${EQUIPMENT_CONDITION_COLORS[cam.condition] || 'text-rmpg-400'}`}>
                    {cam.condition}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-4 text-xs">
                <div className="flex items-center gap-1.5">
                  <span className="field-label">Assigned:</span>
                  <span className="text-rmpg-100 font-mono">{formatDate(cam.assigned_at)}</span>
                </div>
                {cam.returned_at && (
                  <div className="flex items-center gap-1.5">
                    <span className="field-label">Returned:</span>
                    <span className="text-rmpg-100 font-mono">{formatDate(cam.returned_at)}</span>
                  </div>
                )}
              </div>

              {cam.notes && (
                <div className="panel-inset px-2 py-1.5 mt-2">
                  <p className="text-[10px] text-rmpg-400 italic">{cam.notes}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="panel-beveled p-8 text-center bg-surface-base">
          <Camera className="w-8 h-8 text-rmpg-600 mx-auto mb-2" />
          <p className="text-xs text-rmpg-400">No cameras assigned</p>
        </div>
      )}

      {/* Video Section */}
      <div className="flex items-center gap-2 mt-6 mb-3">
        <span className="field-label text-brand-400 whitespace-nowrap flex items-center gap-1.5">
          <Video className="w-3 h-3" />
          Video Footage
        </span>
        <div className="flex-1 h-px bg-rmpg-700" />
        <button
          onClick={onUploadVideo}
          className="toolbar-btn toolbar-btn-primary flex items-center gap-1 text-[10px]"
          disabled={cameras.length === 0}
          title={cameras.length === 0 ? 'Assign a camera first' : 'Upload video'}
        >
          <Upload className="w-3 h-3" />
          Upload Video
        </button>
      </div>

      {videos.length > 0 ? (
        <div className="panel-beveled overflow-x-auto bg-surface-sunken">
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
                    <span className={`inline-flex items-center px-1.5 py-0.5 text-[9px] font-bold ${
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
          <Video className="w-6 h-6 text-rmpg-600 mx-auto mb-2" />
          <p className="text-xs text-rmpg-400">No video footage uploaded</p>
          {cameras.length === 0 && (
            <p className="text-[9px] text-rmpg-600 mt-0.5">Assign a camera first to upload videos.</p>
          )}
        </div>
      )}
    </div>
  );
}
