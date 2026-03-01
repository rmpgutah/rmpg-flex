// ============================================================
// RMPG Flex — Body Camera Video Player Modal
// ============================================================

import React from 'react';
import { X, Video, Shield, FileText } from 'lucide-react';
import type { BodyCamVideo } from '../types';
import { VIDEO_CLASSIFICATION_COLORS } from '../pages/personnel/utils/personnelConstants';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  video: BodyCamVideo | null;
  apiBase: string;
  getAuthHeaders: () => Record<string, string>;
}

export default function VideoPlayer({ isOpen, onClose, video, apiBase, getAuthHeaders }: Props) {
  if (!isOpen || !video) return null;

  const formatDate = (d?: string) => {
    if (!d) return '-';
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const formatDuration = (seconds?: number) => {
    if (!seconds) return '-';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const classLabel = (cls: string) => cls.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  // Build a stream URL with auth token in query param for <video> element
  const headers = getAuthHeaders();
  const token = headers['Authorization']?.replace('Bearer ', '') || '';
  const streamUrl = `${apiBase}/personnel/bodycam-videos/${video.id}/stream?token=${encodeURIComponent(token)}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80" onClick={onClose}>
      <div className="bg-surface-base border border-rmpg-700 rounded-lg shadow-xl w-[760px] max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-rmpg-700 bg-surface-raised">
          <div className="flex items-center gap-2 min-w-0">
            <Video className="w-4 h-4 text-brand-400 flex-shrink-0" />
            <h2 className="text-sm font-bold text-rmpg-100 truncate">{video.title}</h2>
            <span className={`text-[9px] px-1.5 py-0.5 font-bold flex-shrink-0 ${
              VIDEO_CLASSIFICATION_COLORS[video.classification] || 'bg-rmpg-700 text-rmpg-300'
            }`}>
              {classLabel(video.classification)}
            </span>
          </div>
          <button onClick={onClose} className="toolbar-btn p-1">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Video Player */}
        <div className="bg-black">
          <video
            controls
            autoPlay
            className="w-full max-h-[50vh]"
            src={streamUrl}
          >
            Your browser does not support the video tag.
          </video>
        </div>

        {/* Metadata */}
        <div className="p-4 space-y-3">
          <div className="grid grid-cols-4 gap-4">
            <div>
              <p className="field-label flex items-center gap-1"><Shield className="w-2.5 h-2.5" /> Officer</p>
              <p className="text-xs text-rmpg-100">{video.officer_name || '-'}</p>
            </div>
            <div>
              <p className="field-label">Camera</p>
              <p className="text-xs text-rmpg-100 font-mono">{video.camera_serial || '-'}</p>
            </div>
            <div>
              <p className="field-label">Duration</p>
              <p className="text-xs text-rmpg-100 font-mono">{formatDuration(video.duration_seconds)}</p>
            </div>
            <div>
              <p className="field-label">File Size</p>
              <p className="text-xs text-rmpg-100 font-mono">{formatSize(video.file_size)}</p>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-4">
            <div>
              <p className="field-label">Recorded</p>
              <p className="text-xs text-rmpg-100 font-mono">{formatDate(video.recorded_at)}</p>
            </div>
            <div>
              <p className="field-label">Uploaded</p>
              <p className="text-xs text-rmpg-100 font-mono">{formatDate(video.created_at)}</p>
            </div>
            <div>
              <p className="field-label flex items-center gap-1"><FileText className="w-2.5 h-2.5" /> Case #</p>
              <p className="text-xs text-rmpg-100 font-mono">{video.case_number || '-'}</p>
            </div>
            <div>
              <p className="field-label">Retention</p>
              <p className="text-xs text-rmpg-100 capitalize">{video.retention_status?.replace(/_/g, ' ') || '-'}</p>
            </div>
          </div>

          {video.notes && (
            <div className="panel-inset px-3 py-2">
              <p className="text-[10px] text-rmpg-400 italic">{video.notes}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
