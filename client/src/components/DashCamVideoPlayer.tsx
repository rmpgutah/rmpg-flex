// ============================================================
// RMPG Flex — Dash Camera Video Player Modal
// ============================================================

import React from 'react';
import { X, Video, Car, MapPin, Gauge, CheckCircle, AlertTriangle, Loader2, Edit2 } from 'lucide-react';
import type { DashCamVideo } from '../types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  video: DashCamVideo | null;
  apiBase: string;
  getAuthHeaders: () => Record<string, string>;
  onEditVideo?: (video: DashCamVideo) => void;
}

const OVERLAY_STATUS_BADGE: Record<string, { label: string; cls: string; icon: React.ElementType }> = {
  complete:   { label: 'Overlay Applied',     cls: 'bg-green-900/40 text-green-400 border-green-700/40',  icon: CheckCircle },
  processing: { label: 'Burning Overlay...',  cls: 'bg-amber-900/40 text-amber-400 border-amber-700/40',  icon: Loader2 },
  pending:    { label: 'Overlay Pending',     cls: 'bg-amber-900/30 text-amber-500 border-amber-700/30',  icon: Loader2 },
  error:      { label: 'Overlay Failed',      cls: 'bg-red-900/40 text-red-400 border-red-700/40',        icon: AlertTriangle },
};

export default function DashCamVideoPlayer({ isOpen, onClose, video, apiBase, getAuthHeaders, onEditVideo }: Props) {
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
    if (!bytes) return '-';
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const formatCoords = (lat: number | null, lon: number | null) => {
    if (lat == null || lon == null) return '-';
    const latDir = lat >= 0 ? 'N' : 'S';
    const lonDir = lon >= 0 ? 'E' : 'W';
    return `${Math.abs(lat).toFixed(4)}\u00B0 ${latDir}, ${Math.abs(lon).toFixed(4)}\u00B0 ${lonDir}`;
  };

  const headers = getAuthHeaders();
  const token = headers['Authorization']?.replace('Bearer ', '') || '';
  const streamUrl = `${apiBase}/fleet/dashcam-videos/${video.id}/stream?token=${encodeURIComponent(token)}`;

  const vehDesc = [video.vehicle_year, video.vehicle_make, video.vehicle_model].filter(Boolean).join(' ');
  const overlayInfo = OVERLAY_STATUS_BADGE[video.overlay_status || 'pending'];
  const OverlayIcon = overlayInfo?.icon || Loader2;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80" onClick={onClose}>
      <div className="bg-surface-base border border-rmpg-700 rounded-lg shadow-xl w-[760px] max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-rmpg-700 bg-surface-raised">
          <div className="flex items-center gap-2 min-w-0">
            <Car className="w-4 h-4 text-brand-400 flex-shrink-0" />
            <h2 className="text-sm font-bold text-rmpg-100 truncate">{video.title}</h2>
            {overlayInfo && (
              <span className={`text-[9px] px-1.5 py-0.5 font-semibold flex items-center gap-1 border rounded flex-shrink-0 ${overlayInfo.cls}`}>
                <OverlayIcon className={`w-2.5 h-2.5 ${video.overlay_status === 'processing' || video.overlay_status === 'pending' ? 'animate-spin' : ''}`} />
                {overlayInfo.label}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {onEditVideo && (
              <button onClick={() => onEditVideo(video)} className="toolbar-btn p-1" title="Edit video metadata">
                <Edit2 className="w-3.5 h-3.5" />
              </button>
            )}
            <button onClick={onClose} className="toolbar-btn p-1">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Video Player */}
        <div className="bg-black">
          <video controls autoPlay className="w-full max-h-[50vh]" src={streamUrl}>
            Your browser does not support the video tag.
          </video>
        </div>

        {/* Metadata */}
        <div className="p-4 space-y-3">
          <div className="grid grid-cols-4 gap-4">
            <div>
              <p className="field-label flex items-center gap-1"><Car className="w-2.5 h-2.5" /> Vehicle</p>
              <p className="text-xs text-rmpg-100">{video.vehicle_number ? `#${video.vehicle_number}` : '-'}{vehDesc ? ` — ${vehDesc}` : ''}</p>
            </div>
            <div>
              <p className="field-label">Unit</p>
              <p className="text-xs text-rmpg-100 font-mono">{video.unit_call_sign || '-'}</p>
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
              <p className="field-label flex items-center gap-1"><Gauge className="w-2.5 h-2.5" /> Speed</p>
              <p className="text-xs text-rmpg-100 font-mono">{video.speed_mph != null ? `${video.speed_mph} MPH` : '-'}</p>
            </div>
            <div>
              <p className="field-label flex items-center gap-1"><MapPin className="w-2.5 h-2.5" /> Coordinates</p>
              <p className="text-xs text-rmpg-100 font-mono">{formatCoords(video.latitude, video.longitude)}</p>
            </div>
            <div>
              <p className="field-label">Case #</p>
              <p className="text-xs text-rmpg-100 font-mono">{video.case_number || '-'}</p>
            </div>
          </div>

          {video.address && (
            <div className="panel-inset px-3 py-2">
              <p className="field-label flex items-center gap-1 mb-0.5"><MapPin className="w-2.5 h-2.5" /> Location</p>
              <p className="text-xs text-rmpg-100">{video.address}</p>
            </div>
          )}

          {video.overlay_status === 'error' && video.overlay_error && (
            <div className="panel-beveled p-2 border border-red-700/40 bg-red-900/20">
              <p className="text-[10px] text-red-400"><AlertTriangle className="w-3 h-3 inline mr-1" />Overlay Error: {video.overlay_error}</p>
            </div>
          )}

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
