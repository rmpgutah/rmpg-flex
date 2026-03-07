// ============================================================
// RMPG Flex — Body Camera Video Player Modal
// ============================================================
// Enhanced player with police-style HUD preview, playback
// controls, frame capture, download, and quick-classify.
// ============================================================

import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  X, Video, Shield, FileText, CheckCircle, AlertTriangle, Loader2, Edit2,
  Eye, EyeOff, Maximize, Minimize, Camera, Download, Tag,
} from 'lucide-react';
import type { BodyCamVideo, VideoClassification } from '../types';
import { VIDEO_CLASSIFICATION_COLORS } from '../pages/personnel/utils/personnelConstants';
import VideoHudOverlay from './VideoHudOverlay';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  video: BodyCamVideo | null;
  apiBase: string;
  getAuthHeaders: () => Record<string, string>;
  onEditVideo?: (video: BodyCamVideo) => void;
  onClassify?: (videoId: number, classification: VideoClassification) => void;
}

const OVERLAY_STATUS_BADGE: Record<string, { label: string; cls: string; icon: React.ElementType }> = {
  complete:   { label: 'Overlay Applied',     cls: 'bg-green-900/40 text-green-400 border-green-700/40',  icon: CheckCircle },
  processing: { label: 'Burning Overlay...',  cls: 'bg-amber-900/40 text-amber-400 border-amber-700/40',  icon: Loader2 },
  pending:    { label: 'Overlay Pending',     cls: 'bg-amber-900/30 text-amber-500 border-amber-700/30',  icon: Loader2 },
  error:      { label: 'Overlay Failed',      cls: 'bg-red-900/40 text-red-400 border-red-700/40',        icon: AlertTriangle },
};

const PLAYBACK_RATES = [0.25, 0.5, 1, 1.5, 2];
const CLASSIFICATIONS: VideoClassification[] = ['routine', 'evidence', 'flagged', 'restricted'];

export default function VideoPlayer({ isOpen, onClose, video, apiBase, getAuthHeaders, onEditVideo, onClassify }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [hudVisible, setHudVisible] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [showClassifyMenu, setShowClassifyMenu] = useState(false);

  // Track fullscreen changes
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  // Reset state when video changes
  useEffect(() => {
    setPlaybackRate(1);
    setShowClassifyMenu(false);
    setHudVisible(true);
  }, [video?.id]);

  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen();
    }
  }, []);

  const changeSpeed = useCallback((rate: number) => {
    if (videoRef.current) videoRef.current.playbackRate = rate;
    setPlaybackRate(rate);
  }, []);

  const captureFrame = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(v, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `BWC_frame_${video?.id || 'unknown'}_${Date.now()}.png`;
      a.click();
      URL.revokeObjectURL(url);
    }, 'image/png');
  }, [video?.id]);

  const downloadVideo = useCallback(() => {
    if (!video) return;
    const headers = getAuthHeaders();
    const token = headers['Authorization']?.replace('Bearer ', '') || '';
    const url = `${apiBase}/personnel/bodycam-videos/${video.id}/stream?token=${encodeURIComponent(token)}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = `BWC_${video.title || video.id}.mp4`;
    a.click();
  }, [video, apiBase, getAuthHeaders]);

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

  const headers = getAuthHeaders();
  const token = headers['Authorization']?.replace('Bearer ', '') || '';
  const streamUrl = `${apiBase}/personnel/bodycam-videos/${video.id}/stream?token=${encodeURIComponent(token)}`;

  const overlayInfo = OVERLAY_STATUS_BADGE[video.overlay_status || 'pending'];
  const OverlayIcon = overlayInfo?.icon || Loader2;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80" onClick={onClose}>
      <div className="bg-surface-base border border-rmpg-700 rounded-lg shadow-xl w-[900px] max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
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

        {/* Video Player with HUD */}
        <div ref={containerRef} className="bg-black relative">
          <video
            ref={videoRef}
            controls
            autoPlay
            className="w-full max-h-[55vh]"
            src={streamUrl}
          >
            Your browser does not support the video tag.
          </video>
          <VideoHudOverlay
            type="bodycam"
            visible={hudVisible}
            videoRef={videoRef}
            recordedAt={video.recorded_at}
            officerName={video.officer_name}
            badgeNumber={(video as any).badge_number}
            cameraSerial={video.camera_serial}
            caseNumber={video.case_number}
            classification={video.classification}
          />
        </div>

        {/* Toolbar */}
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-rmpg-700 bg-surface-raised">
          <div className="flex items-center gap-1">
            {/* HUD Toggle */}
            <button
              onClick={() => setHudVisible(!hudVisible)}
              className={`toolbar-btn p-1 text-[10px] flex items-center gap-1 ${hudVisible ? 'text-brand-400' : 'text-rmpg-400'}`}
              title={hudVisible ? 'Hide HUD Preview' : 'Show HUD Preview'}
            >
              {hudVisible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">HUD</span>
            </button>

            {/* Fullscreen */}
            <button onClick={toggleFullscreen} className="toolbar-btn p-1" title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
              {isFullscreen ? <Minimize className="w-3.5 h-3.5" /> : <Maximize className="w-3.5 h-3.5" />}
            </button>

            {/* Playback Speed */}
            <div className="flex items-center gap-0.5 ml-1 border-l border-rmpg-700 pl-1.5">
              {PLAYBACK_RATES.map(rate => (
                <button
                  key={rate}
                  onClick={() => changeSpeed(rate)}
                  className={`text-[9px] px-1.5 py-0.5 rounded font-mono ${
                    playbackRate === rate
                      ? 'bg-brand-600 text-white'
                      : 'text-rmpg-400 hover:text-rmpg-200 hover:bg-rmpg-700'
                  }`}
                >
                  {rate}x
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-1">
            {/* Frame Capture */}
            <button onClick={captureFrame} className="toolbar-btn p-1" title="Capture frame">
              <Camera className="w-3.5 h-3.5" />
            </button>

            {/* Download */}
            <button onClick={downloadVideo} className="toolbar-btn p-1" title="Download video">
              <Download className="w-3.5 h-3.5" />
            </button>

            {/* Quick Classify */}
            {onClassify && (
              <div className="relative">
                <button
                  onClick={() => setShowClassifyMenu(!showClassifyMenu)}
                  className="toolbar-btn p-1"
                  title="Quick classify"
                >
                  <Tag className="w-3.5 h-3.5" />
                </button>
                {showClassifyMenu && (
                  <div className="absolute right-0 top-full mt-1 bg-surface-overlay border border-rmpg-700 rounded shadow-xl z-10 py-1 min-w-[120px]">
                    {CLASSIFICATIONS.map(cls => (
                      <button
                        key={cls}
                        onClick={() => {
                          onClassify(video.id, cls);
                          setShowClassifyMenu(false);
                        }}
                        className={`w-full text-left text-[10px] px-3 py-1 hover:bg-rmpg-700 ${
                          video.classification === cls ? 'text-brand-400 font-bold' : 'text-rmpg-200'
                        }`}
                      >
                        {classLabel(cls)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
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
