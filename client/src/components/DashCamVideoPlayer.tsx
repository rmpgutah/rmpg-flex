// ============================================================
// RMPG Flex — Dash Camera Video Player Modal
// Police-style MVR HUD overlay rendered as CSS over the video
// element. Original files are never modified (no FFmpeg burn).
// ============================================================

import React, { useRef, useState, useEffect } from 'react';
import { X, Car, MapPin, Gauge, Maximize2, Minimize2, Edit2 } from 'lucide-react';
import type { DashCamVideo } from '../types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  video: DashCamVideo | null;
  apiBase: string;
  getAuthHeaders: () => Record<string, string>;
  onEditVideo?: (video: DashCamVideo) => void;
}

export default function DashCamVideoPlayer({ isOpen, onClose, video, apiBase, getAuthHeaders, onEditVideo }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [hudVisible, setHudVisible] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const vid = videoRef.current;
    if (!vid) return;
    const onTime = () => setCurrentTime(vid.currentTime);
    vid.addEventListener('timeupdate', onTime);
    return () => vid.removeEventListener('timeupdate', onTime);
  }, [isOpen, video]);

  if (!isOpen || !video) return null;

  const formatHudTime = (seconds: number) => {
    const d = video.recorded_at ? new Date(video.recorded_at) : new Date();
    const playback = new Date(d.getTime() + seconds * 1000);
    return playback.toLocaleString('en-US', {
      month: '2-digit', day: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).replace(',', '');
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

  const formatCoords = (lat: number | null | undefined, lon: number | null | undefined) => {
    if (lat == null || lon == null) return null;
    const latDir = lat >= 0 ? 'N' : 'S';
    const lonDir = lon >= 0 ? 'E' : 'W';
    return `${Math.abs(lat).toFixed(4)}${latDir}  ${Math.abs(lon).toFixed(4)}${lonDir}`;
  };

  const formatDate = (d?: string) => {
    if (!d) return '-';
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const headers = getAuthHeaders();
  const token = headers['Authorization']?.replace('Bearer ', '') || '';
  const streamUrl = `${apiBase}/fleet/dashcam-videos/${video.id}/stream?token=${encodeURIComponent(token)}`;

  const vehDesc = [video.vehicle_year, video.vehicle_make, video.vehicle_model].filter(Boolean).join(' ');
  const coords = formatCoords(video.latitude, video.longitude);

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90" onClick={onClose}>
      <div
        ref={containerRef}
        className={`bg-black border border-rmpg-800 rounded-lg shadow-2xl overflow-hidden ${
          isFullscreen ? 'w-full h-full' : 'w-[900px] max-h-[90vh]'
        }`}
        onClick={e => e.stopPropagation()}
      >
        {/* Compact header */}
        <div className="flex items-center justify-between px-3 py-1.5 bg-[#0a0a0a] border-b border-rmpg-800">
          <div className="flex items-center gap-2 min-w-0">
            <Car className="w-3.5 h-3.5 text-cyan-400 flex-shrink-0" />
            <span className="text-[10px] font-mono font-bold text-rmpg-200 uppercase tracking-wider truncate">
              MVR — {video.title}
            </span>
            {video.unit_call_sign && (
              <span className="text-[8px] px-1 py-0.5 font-bold bg-brand-500/20 text-brand-400 border border-brand-500/30 flex-shrink-0">
                {video.unit_call_sign}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setHudVisible(!hudVisible)} className="text-[9px] font-mono text-rmpg-500 hover:text-rmpg-200 px-1.5 py-0.5 transition-colors" title="Toggle HUD overlay">
              HUD {hudVisible ? 'ON' : 'OFF'}
            </button>
            {onEditVideo && (
              <button onClick={() => onEditVideo(video)} className="toolbar-btn p-1" title="Edit video metadata">
                <Edit2 className="w-3.5 h-3.5" />
              </button>
            )}
            <button onClick={toggleFullscreen} className="toolbar-btn p-1" title="Toggle fullscreen">
              {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            </button>
            <button onClick={onClose} className="toolbar-btn p-1">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Video + HUD Overlay */}
        <div className="relative bg-black">
          <video
            ref={videoRef}
            controls
            autoPlay
            className="w-full max-h-[70vh]"
            src={streamUrl}
          >
            Your browser does not support the video tag.
          </video>

          {/* ── Police-Style MVR HUD Overlay ── */}
          {hudVisible && (
            <>
              {/* Top-left: Agency & Unit info */}
              <div className="absolute top-2 left-3 pointer-events-none select-none">
                <div className="bg-black/60 backdrop-blur-sm px-2.5 py-1.5 border border-white/10 rounded-sm">
                  <p className="font-mono text-[11px] text-white font-bold tracking-wider leading-tight">
                    ROCKY MOUNTAIN PROTECTIVE GROUP
                  </p>
                  <p className="font-mono text-[10px] text-cyan-400 leading-tight">
                    MVR | {video.unit_call_sign || 'UNIT N/A'} | VEH #{video.vehicle_number || 'N/A'}
                    {vehDesc ? ` ${vehDesc}` : ''}
                  </p>
                </div>
              </div>

              {/* Top-right: Speed + Case */}
              <div className="absolute top-2 right-3 pointer-events-none select-none">
                <div className="bg-black/60 backdrop-blur-sm px-2.5 py-1.5 border border-white/10 rounded-sm text-right">
                  {video.speed_mph != null && (
                    <p className={`font-mono text-[14px] font-bold tracking-wider leading-tight ${
                      video.speed_mph > 80 ? 'text-red-400' :
                      video.speed_mph > 60 ? 'text-amber-400' :
                      'text-green-400'
                    }`}>
                      {video.speed_mph} MPH
                    </p>
                  )}
                  {video.case_number && (
                    <p className="font-mono text-[10px] text-white/80 leading-tight">
                      CASE: {video.case_number}
                    </p>
                  )}
                </div>
              </div>

              {/* Bottom-left: Timestamp */}
              <div className="absolute bottom-12 left-3 pointer-events-none select-none">
                <div className="bg-black/60 backdrop-blur-sm px-2.5 py-1 border border-white/10 rounded-sm">
                  <p className="font-mono text-[12px] text-white font-bold tabular-nums tracking-wide">
                    {formatHudTime(currentTime)}
                  </p>
                  {coords && (
                    <p className="font-mono text-[9px] text-green-400/80 leading-tight">
                      GPS: {coords}
                    </p>
                  )}
                </div>
              </div>

              {/* Bottom-right: REC + Address */}
              <div className="absolute bottom-12 right-3 pointer-events-none select-none">
                <div className="bg-black/60 backdrop-blur-sm px-2.5 py-1 border border-white/10 rounded-sm flex flex-col items-end gap-0.5">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                    <span className="font-mono text-[10px] text-red-400 font-bold">REC</span>
                  </div>
                  {video.address && (
                    <p className="font-mono text-[8px] text-white/60 max-w-[200px] truncate">
                      {video.address}
                    </p>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Compact Metadata Bar */}
        <div className="px-3 py-2 bg-[#0a0a0a] border-t border-rmpg-800">
          <div className="flex items-center justify-between text-[10px] font-mono text-rmpg-400 gap-4 flex-wrap">
            <span className="flex items-center gap-1">
              <Car className="w-2.5 h-2.5 text-cyan-400" />
              <span className="text-rmpg-200">{video.vehicle_number ? `#${video.vehicle_number}` : '-'}</span>
              {vehDesc && <span className="text-rmpg-500">{vehDesc}</span>}
            </span>
            <span>UNIT: <span className="text-brand-400 font-semibold">{video.unit_call_sign || '-'}</span></span>
            <span>DUR: <span className="text-rmpg-200">{formatDuration(video.duration_seconds)}</span></span>
            <span>SIZE: <span className="text-rmpg-200">{formatSize(video.file_size)}</span></span>
            {video.speed_mph != null && (
              <span className="flex items-center gap-1">
                <Gauge className="w-2.5 h-2.5" />
                <span className="text-rmpg-200">{video.speed_mph} MPH</span>
              </span>
            )}
            {coords && (
              <span className="flex items-center gap-1">
                <MapPin className="w-2.5 h-2.5" />
                <span className="text-rmpg-200">{coords}</span>
              </span>
            )}
            <span>REC: <span className="text-rmpg-200">{formatDate(video.recorded_at)}</span></span>
          </div>
          {video.address && (
            <p className="text-[9px] text-rmpg-500 mt-1 truncate">LOC: {video.address}</p>
          )}
          {video.notes && (
            <p className="text-[9px] text-rmpg-500 italic mt-0.5 truncate">{video.notes}</p>
          )}
        </div>
      </div>
    </div>
  );
}
