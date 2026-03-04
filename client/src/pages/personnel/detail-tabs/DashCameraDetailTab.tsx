// ============================================================
// RMPG Flex — Officer Dash Camera Detail Tab
// Per-officer view of Traccar GPS device mapping, events,
// and dashcam video library (locally stored footage).
// ============================================================

import React from 'react';
import {
  Car, Cpu, Zap, AlertTriangle, MapPin, Gauge,
  Video, Clock, Loader2, Play, Trash2, Film, Upload, Pencil,
} from 'lucide-react';
import type { DashcamEvent, CpgDeviceMapping, DashcamVideo } from '../../../types';
import {
  DASHCAM_EVENT_COLORS,
  DASHCAM_VIDEO_SOURCE_COLORS,
  VIDEO_CLASSIFICATION_COLORS,
} from '../utils/personnelConstants';

interface Props {
  events: DashcamEvent[];
  deviceMapping: CpgDeviceMapping | null;
  loading: boolean;
  videos?: DashcamVideo[];
  onPlayVideo?: (video: DashcamVideo) => void;
  onDeleteVideo?: (videoId: number) => void;
  onUploadVideo?: () => void;
  onEditVideo?: (video: DashcamVideo) => void;
}

export default function DashCameraDetailTab({
  events, deviceMapping, loading,
  videos = [], onPlayVideo, onDeleteVideo, onUploadVideo, onEditVideo,
}: Props) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-4 h-4 text-brand-400 animate-spin" />
        <span className="ml-2 text-xs text-rmpg-400">Loading dash camera data...</span>
      </div>
    );
  }

  const formatDateTime = (d?: string | null) => {
    if (!d) return '-';
    return new Date(d).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  };

  const formatDate = (d?: string | null) => {
    if (!d) return '-';
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const eventLabel = (t: string) => t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const classLabel = (cls: string) => cls.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const sourceLabel = (s: string) => s === 'cpg_sync' ? 'CPG Sync' : s === 'cpg_proxy' ? 'CPG Proxy' : 'Manual';

  const formatDuration = (seconds?: number | null) => {
    if (!seconds) return '-';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  const formatSize = (bytes: number) => {
    if (bytes <= 0) return '-';
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  // Stats
  const hardBrakes = events.filter(e => e.event_type === 'hard_brake').length;
  const speeding = events.filter(e => e.event_type === 'speeding').length;
  const impacts = events.filter(e => e.event_type === 'impact').length;
  const videoClips = events.filter(e => e.video_available).length;
  const mostRecent = events.length > 0 ? events[0] : null;

  // Most common event type
  const typeCounts: Record<string, number> = {};
  events.forEach(e => { typeCounts[e.event_type] = (typeCounts[e.event_type] || 0) + 1; });
  const mostCommonType = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0];

  return (
    <div className="space-y-4">
      {/* Device Section */}
      <h3 className="field-label text-brand-400 flex items-center gap-1.5">
        <Cpu className="w-3 h-3" />
        Traccar GPS Device
      </h3>

      {deviceMapping ? (
        <div className="panel-beveled p-3 bg-surface-base border-t-2 border-t-brand-500">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className={deviceMapping.is_active ? 'led-dot led-green' : 'led-dot led-off'} />
              <h4 className="text-xs font-semibold text-rmpg-100">{deviceMapping.cpg_display_name}</h4>
              <span className={`text-[9px] px-1.5 py-0.5 font-bold ${
                deviceMapping.is_active
                  ? 'bg-green-900/50 text-green-400 border border-green-700/50'
                  : 'bg-rmpg-700 text-rmpg-400 border border-rmpg-600'
              }`}>
                {deviceMapping.is_active ? 'ACTIVE' : 'INACTIVE'}
              </span>
            </div>
            <span className="text-[8px] text-rmpg-500 font-mono uppercase bg-surface-base px-1.5 py-0.5 border border-rmpg-700">
              Traccar GPS
            </span>
          </div>

          <div className="grid grid-cols-3 gap-x-4 gap-y-1">
            <div>
              <p className="field-label">Serial Number</p>
              <p className="text-xs text-rmpg-100 font-mono">{deviceMapping.cpg_serial_number || '-'}</p>
            </div>
            <div>
              <p className="field-label">Call Sign</p>
              <p className="text-xs text-brand-400 font-mono font-semibold">{deviceMapping.call_sign || '-'}</p>
            </div>
            <div>
              <p className="field-label">Last Synced</p>
              <p className="text-xs text-rmpg-100 font-mono">{formatDate(deviceMapping.last_synced_at)}</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="panel-beveled p-6 text-center bg-surface-base">
          <Car className="w-8 h-8 text-rmpg-600 mx-auto mb-2" />
          <p className="text-xs text-rmpg-400">No dash camera mapped to this officer's unit</p>
          <p className="text-[9px] text-rmpg-600 mt-0.5">Devices are auto-mapped when Traccar GPS is configured.</p>
        </div>
      )}

      {/* Stats Row */}
      <div className="grid grid-cols-5 gap-2">
        <div className="panel-beveled p-2 text-center bg-surface-base border-t-2 border-t-rmpg-500">
          <p className="text-lg font-bold text-rmpg-200 font-mono">{events.length}</p>
          <p className="field-label">Total Events</p>
        </div>
        <div className="panel-beveled p-2 text-center bg-surface-base border-t-2 border-t-red-500">
          <p className="text-lg font-bold text-red-400 font-mono">{hardBrakes}</p>
          <p className="field-label">Hard Brakes</p>
        </div>
        <div className="panel-beveled p-2 text-center bg-surface-base border-t-2 border-t-amber-500">
          <p className="text-lg font-bold text-amber-400 font-mono">{speeding}</p>
          <p className="field-label">Speeding</p>
        </div>
        <div className="panel-beveled p-2 text-center bg-surface-base border-t-2 border-t-purple-500">
          <p className="text-lg font-bold text-purple-400 font-mono">{videoClips}</p>
          <p className="field-label">Video Clips</p>
        </div>
        <div className="panel-beveled p-2 text-center bg-surface-base border-t-2 border-t-cyan-500">
          <p className="text-lg font-bold text-cyan-400 font-mono">{videos.length}</p>
          <p className="field-label">Videos</p>
        </div>
      </div>

      {/* Impact alert */}
      {impacts > 0 && (
        <div className="panel-beveled p-2.5 flex items-center gap-2 border border-red-700/40 border-l-2 border-l-red-500 bg-[#1a0a0a]">
          <AlertTriangle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
          <span className="text-[10px] text-red-400 font-semibold">
            {impacts} impact event{impacts !== 1 ? 's' : ''} — review immediately
          </span>
        </div>
      )}

      {/* Most recent + most common */}
      {events.length > 0 && (
        <div className="flex items-center gap-4 text-[10px] text-rmpg-400">
          {mostRecent && (
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              Most recent: <span className="font-mono text-rmpg-200">{formatDateTime(mostRecent.event_timestamp)}</span>
            </span>
          )}
          {mostCommonType && (
            <span className="flex items-center gap-1">
              <Zap className="w-3 h-3" />
              Most common: <span className="font-semibold text-rmpg-200">{eventLabel(mostCommonType[0])}</span>
              <span className="text-rmpg-500">({mostCommonType[1]})</span>
            </span>
          )}
        </div>
      )}

      {/* ── Dashcam Videos Section ── */}
      <div className="flex items-center gap-2 mt-2 mb-1">
        <span className="field-label text-purple-400 whitespace-nowrap flex items-center gap-1.5">
          <Film className="w-3 h-3" />
          Dash Camera Videos
        </span>
        <div className="flex-1 h-px bg-rmpg-700" />
        {onUploadVideo && (
          <button onClick={onUploadVideo} className="toolbar-btn text-[9px] px-2 py-1 flex items-center gap-1">
            <Upload className="w-2.5 h-2.5" /> Upload
          </button>
        )}
      </div>

      {videos.length > 0 ? (
        <div className="panel-beveled overflow-x-auto bg-surface-sunken">
          <table className="table-dark w-full">
            <thead>
              <tr>
                <th className="text-left">Title</th>
                <th className="text-left">Source</th>
                <th className="text-left">Event</th>
                <th className="text-right">Duration</th>
                <th className="text-right">Size</th>
                <th className="text-left">Recorded</th>
                <th className="text-left">Class</th>
                <th className="text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {videos.map(vid => (
                <tr key={vid.id} className="hover:bg-surface-hover">
                  <td>
                    <div className="flex items-center gap-1.5">
                      <Car className="w-2.5 h-2.5 text-brand-400 flex-shrink-0" />
                      <span className="text-xs font-semibold text-rmpg-200 max-w-[140px] truncate" title={vid.title}>
                        {vid.title}
                      </span>
                    </div>
                  </td>
                  <td>
                    <span className={`inline-flex items-center px-1.5 py-0.5 text-[9px] font-bold ${
                      DASHCAM_VIDEO_SOURCE_COLORS[vid.source] || 'bg-rmpg-700 text-rmpg-300'
                    }`}>
                      {sourceLabel(vid.source)}
                    </span>
                  </td>
                  <td>
                    {vid.event_type ? (
                      <span className={`inline-flex items-center px-1.5 py-0.5 text-[9px] font-bold ${
                        DASHCAM_EVENT_COLORS[vid.event_type] || 'bg-rmpg-700 text-rmpg-300 border border-rmpg-600'
                      }`}>
                        {eventLabel(vid.event_type)}
                      </span>
                    ) : (
                      <span className="text-xs text-rmpg-600">-</span>
                    )}
                  </td>
                  <td className="text-right">
                    <span className="text-xs font-mono text-rmpg-300">{formatDuration(vid.duration_seconds)}</span>
                  </td>
                  <td className="text-right">
                    <span className="text-xs font-mono text-rmpg-400">{formatSize(vid.file_size)}</span>
                  </td>
                  <td>
                    <span className="text-xs font-mono text-rmpg-300">{formatDateTime(vid.recorded_at)}</span>
                  </td>
                  <td>
                    <span className={`inline-flex items-center px-1.5 py-0.5 text-[9px] font-bold ${
                      VIDEO_CLASSIFICATION_COLORS[vid.classification] || 'bg-rmpg-700 text-rmpg-300'
                    }`}>
                      {classLabel(vid.classification)}
                    </span>
                  </td>
                  <td className="text-center">
                    <div className="flex items-center justify-center gap-1">
                      {onPlayVideo && (
                        <button onClick={() => onPlayVideo(vid)} className="toolbar-btn p-1" title="Play video">
                          <Play className="w-3 h-3 text-green-400" />
                        </button>
                      )}
                      {onEditVideo && (
                        <button onClick={() => onEditVideo(vid)} className="toolbar-btn p-1" title="Edit video">
                          <Pencil className="w-3 h-3 text-brand-400" />
                        </button>
                      )}
                      {onDeleteVideo && (
                        <button onClick={() => onDeleteVideo(vid.id)} className="toolbar-btn p-1" title="Delete video">
                          <Trash2 className="w-3 h-3 text-red-400" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="panel-beveled p-4 text-center bg-surface-base">
          <Film className="w-5 h-5 text-rmpg-600 mx-auto mb-1" />
          <p className="text-[10px] text-rmpg-500">No dash camera videos for this officer</p>
        </div>
      )}

      {/* Events List */}
      <div className="flex items-center gap-2 mt-2 mb-1">
        <span className="field-label text-brand-400 whitespace-nowrap flex items-center gap-1.5">
          <Zap className="w-3 h-3" />
          Dashcam Events
        </span>
        <div className="flex-1 h-px bg-rmpg-700" />
      </div>

      {events.length > 0 ? (
        <div className="panel-beveled overflow-x-auto bg-surface-sunken">
          <table className="table-dark w-full">
            <thead>
              <tr>
                <th className="text-left">Timestamp</th>
                <th className="text-left">Event</th>
                <th className="text-right">Speed</th>
                <th className="text-left">Address</th>
                <th className="text-left">Coords</th>
                <th className="text-center">Video</th>
              </tr>
            </thead>
            <tbody>
              {events.map(evt => {
                const linkedVideo = videos.find(v => v.cpg_event_id === evt.id);
                return (
                  <tr
                    key={evt.id}
                    className={
                      evt.event_type === 'impact' ? 'bg-red-900/10' :
                      evt.event_type === 'speeding' ? 'bg-amber-900/5' : ''
                    }
                  >
                    <td>
                      <span className="text-xs font-mono text-rmpg-300 flex items-center gap-1">
                        <Clock className="w-2.5 h-2.5 text-rmpg-500" />
                        {formatDateTime(evt.event_timestamp)}
                      </span>
                    </td>
                    <td>
                      <span className={`inline-flex items-center px-1.5 py-0.5 text-[9px] font-bold ${
                        DASHCAM_EVENT_COLORS[evt.event_type] || 'bg-rmpg-700 text-rmpg-300 border border-rmpg-600'
                      }`}>
                        {eventLabel(evt.event_type)}
                      </span>
                    </td>
                    <td className="text-right">
                      {evt.speed_mph != null ? (
                        <span className={`text-xs font-mono font-bold ${
                          evt.speed_mph > 80 ? 'text-red-400' :
                          evt.speed_mph > 60 ? 'text-amber-400' :
                          'text-rmpg-300'
                        }`}>
                          {evt.speed_mph} mph
                        </span>
                      ) : (
                        <span className="text-xs text-rmpg-600">-</span>
                      )}
                    </td>
                    <td>
                      <span className="text-xs text-rmpg-300 max-w-[160px] truncate block" title={evt.address || undefined}>
                        {evt.address || '-'}
                      </span>
                    </td>
                    <td>
                      {evt.latitude != null && evt.longitude != null ? (
                        <span className="text-[9px] font-mono text-rmpg-500 flex items-center gap-1">
                          <MapPin className="w-2.5 h-2.5" />
                          {evt.latitude.toFixed(4)}, {evt.longitude.toFixed(4)}
                        </span>
                      ) : (
                        <span className="text-xs text-rmpg-600">-</span>
                      )}
                    </td>
                    <td className="text-center">
                      {linkedVideo && onPlayVideo ? (
                        <button
                          onClick={() => onPlayVideo(linkedVideo)}
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-green-900/50 text-green-400 border border-green-700/50 text-[9px] font-bold hover:bg-green-800/50 transition-colors"
                          title="Play linked video"
                        >
                          <Play className="w-2.5 h-2.5" />
                          PLAY
                        </button>
                      ) : evt.video_available ? (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-purple-900/50 text-purple-400 border border-purple-700/50 text-[9px] font-bold" title="Video clip available">
                          <Video className="w-2.5 h-2.5" />
                          CLIP
                        </span>
                      ) : (
                        <span className="text-rmpg-600 text-[9px]">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="panel-beveled p-6 text-center bg-surface-base">
          <Zap className="w-6 h-6 text-rmpg-600 mx-auto mb-2" />
          <p className="text-xs text-rmpg-400">No dashcam events recorded</p>
          <p className="text-[9px] text-rmpg-600 mt-0.5">Events are automatically synced from Traccar GPS.</p>
        </div>
      )}
    </div>
  );
}
