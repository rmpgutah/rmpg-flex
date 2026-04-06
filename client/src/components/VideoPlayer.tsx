// ============================================================
// RMPG Flex — Body Camera Video Player
// ============================================================
// Modal video player for BWC footage with a minimal two-bar
// HUD overlay showing timestamp, officer, camera serial,
// case number, and REC indicator.

import React, { useState, useRef, useEffect } from 'react';
import {
  X, Video, Shield, FileText, AlertTriangle, RefreshCw,
  Clock, Eye, EyeOff, Download, Loader2,
} from 'lucide-react';
import type { BodyCamVideo } from '../types';
import { VIDEO_CLASSIFICATION_COLORS } from '../pages/personnel/utils/personnelConstants';
import BodyCamHudOverlay from './BodyCamHudOverlay';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  video: BodyCamVideo | null;
  apiBase: string;
  getAuthHeaders: () => Record<string, string>;
}

export default function VideoPlayer({ isOpen, onClose, video, apiBase, getAuthHeaders }: Props) {
  const [videoError, setVideoError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showHud, setShowHud] = useState(true);
  const [burning, setBurning] = useState(false);
  const [burnError, setBurnError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => { setVideoError(null); setIsPlaying(false); }, [video?.id]);

  // Track play/pause state from the <video> element
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => setIsPlaying(false);
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    el.addEventListener('ended', onEnded);
    return () => {
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('ended', onEnded);
    };
  }, [video?.id, videoError]);

  if (!isOpen || !video) return null;

  // ── Formatters ────────────────────────────────────────

  const fmtDate = (d?: string) => {
    if (!d) return '-';
    return new Date(d).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  };

  const fmtDuration = (s?: number) => {
    if (!s) return '-';
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return h > 0
      ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
      : `${m}:${String(sec).padStart(2, '0')}`;
  };

  const fmtSize = (b: number) => {
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
    if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
    return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const classLabel = (cls: string) => cls.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  const headers = getAuthHeaders();
  const token = headers['Authorization']?.replace('Bearer ', '') || '';
  const streamUrl = `${apiBase}/personnel/bodycam-videos/${video.id}/stream?token=${encodeURIComponent(token)}`;

  /** Download video with HUD overlay burned into pixels via FFmpeg */
  const handleBurnDownload = async () => {
    setBurning(true);
    setBurnError(null);
    try {
      const burnUrl = `${apiBase}/personnel/bodycam-videos/${video.id}/download-burned?token=${encodeURIComponent(token)}`;
      const resp = await fetch(burnUrl, { signal: AbortSignal.timeout(600000) });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Download failed' }));
        throw new Error(err.error || `HTTP ${resp.status}`);
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = resp.headers.get('content-disposition')?.match(/filename="(.+)"/)?.[1] || 'BWC_overlay.mp4';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setBurnError(err?.message || 'Download failed');
    } finally {
      setBurning(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85" onClick={onClose}>
      <div
        className="bg-surface-base border border-rmpg-700 rounded-lg shadow-2xl w-[800px] max-h-[95vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-rmpg-700 bg-surface-raised">
          <div className="flex items-center gap-2 min-w-0">
            <Video className="w-4 h-4 text-brand-400 flex-shrink-0" />
            <h2 className="text-sm font-bold text-rmpg-100 truncate">{video.title}</h2>
            <span className={`text-[9px] px-1.5 py-0.5 font-bold flex-shrink-0 ${
              VIDEO_CLASSIFICATION_COLORS[video.classification] || 'bg-rmpg-700 text-rmpg-300'
            }`}>
              {classLabel(video.classification)}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={handleBurnDownload}
              disabled={burning}
              className="toolbar-btn p-1"
              title="Download with overlay burned in"
            >
              {burning
                ? <Loader2 className="w-3.5 h-3.5 text-amber-400 animate-spin" />
                : <Download className="w-3.5 h-3.5 text-green-400" />}
            </button>
            <button
              onClick={() => setShowHud(h => !h)}
              className="toolbar-btn p-1"
              title={showHud ? 'Hide overlay' : 'Show overlay'}
            >
              {showHud
                ? <Eye className="w-3.5 h-3.5 text-cyan-400" />
                : <EyeOff className="w-3.5 h-3.5 text-rmpg-500" />}
            </button>
            <button onClick={onClose} className="toolbar-btn p-1">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ── Video + HUD ── */}
        <div className="bg-black relative">
          {videoError ? (
            <div className="flex flex-col items-center justify-center py-14 px-4 text-center">
              <AlertTriangle className="w-10 h-10 text-amber-500 mb-3" />
              <p className="text-sm font-bold text-rmpg-200 mb-1">Video Unavailable</p>
              <p className="text-[11px] text-rmpg-400 mb-4 max-w-sm">{videoError}</p>
              <button
                onClick={() => { setVideoError(null); videoRef.current?.load(); }}
                className="toolbar-btn toolbar-btn-primary"
              >
                <RefreshCw className="w-3 h-3" /> Retry
              </button>
            </div>
          ) : (
            <>
              <video
                ref={videoRef}
                controls
                autoPlay
                className="w-full max-h-[55vh]"
                src={streamUrl}
                onError={() => setVideoError('Could not load video. File may have been deleted or moved.')}
              />
              {showHud && (
                <BodyCamHudOverlay
                  video={video}
                  videoRef={videoRef}
                  isPlaying={isPlaying}
                />
              )}
            </>
          )}
        </div>

        {/* ── Burn status ── */}
        {(burning || burnError) && (
          <div className={`px-4 py-2 border-t border-rmpg-700 text-[11px] flex items-center gap-2 ${
            burnError ? 'bg-red-900/20 text-red-400' : 'bg-amber-900/20 text-amber-300'
          }`}>
            {burning && <><Loader2 className="w-3 h-3 animate-spin" /> Processing video with overlay — this may take a few minutes...</>}
            {burnError && <><AlertTriangle className="w-3 h-3" /> {burnError}</>}
          </div>
        )}

        {/* ── Metadata ── */}
        <div className="p-4 space-y-2.5 border-t border-rmpg-700">
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
              <p className="text-xs text-rmpg-100 font-mono">{fmtDuration(video.duration_seconds)}</p>
            </div>
            <div>
              <p className="field-label">Size</p>
              <p className="text-xs text-rmpg-100 font-mono">{fmtSize(video.file_size)}</p>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-4">
            <div>
              <p className="field-label flex items-center gap-1"><Clock className="w-2.5 h-2.5" /> Recorded</p>
              <p className="text-xs text-rmpg-100 font-mono">{fmtDate(video.recorded_at)}</p>
            </div>
            <div>
              <p className="field-label">Uploaded</p>
              <p className="text-xs text-rmpg-100 font-mono">{fmtDate(video.created_at)}</p>
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
