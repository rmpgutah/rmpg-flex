// ============================================================
// RMPG Flex — Dash Camera Video Detail Page
// Full-page video detail view with player, GPS speed timeline,
// metadata panel, and action controls. Route: /dash-cameras/:id
// ============================================================

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Camera, ArrowLeft, Edit2, Flame, Download, Maximize2,
  Loader2, AlertTriangle, ChevronLeft, ChevronRight,
  Car, MapPin, FileText, Link2, Clock, Gauge, Film,
  HardDrive, Shield, ChevronDown, ChevronUp,
} from 'lucide-react';
import type { DashCamVideo } from '../types';
import PanelTitleBar from '../components/PanelTitleBar';
import DashCamVideoPlayer from '../components/DashCamVideoPlayer';
import DashCamVideoEditModal, { type DashCamVideoEditData } from '../components/DashCamVideoEditModal';
import { apiFetch } from '../hooks/useApi';
import { useToast } from '../components/ToastProvider';
import { useAuth } from '../context/AuthContext';

// ── Color Constants ─────────────────────────────────────────

const CLASSIFICATION_COLORS: Record<string, { border: string; text: string; bg: string }> = {
  routine:    { border: 'border-green-600', text: 'text-green-400', bg: 'bg-green-900/40' },
  evidence:   { border: 'border-amber-700/60', text: 'text-amber-400', bg: 'bg-amber-900/40' },
  flagged:    { border: 'border-red-700/60', text: 'text-red-400', bg: 'bg-red-900/40' },
  restricted: { border: 'border-purple-700/60', text: 'text-purple-400', bg: 'bg-purple-900/40' },
};

const CLASSIFICATION_BADGE: Record<string, string> = {
  routine:    'bg-rmpg-700 text-rmpg-300 border-rmpg-600',
  evidence:   'bg-amber-900/40 text-amber-400 border-amber-700/40',
  flagged:    'bg-red-900/40 text-red-400 border-red-700/40',
  restricted: 'bg-purple-900/40 text-purple-400 border-purple-700/40',
};

const SOURCE_COLORS: Record<string, string> = {
  upload:       'bg-brand-500/20 text-brand-400 border-brand-500/30',
  clearpathgps: 'bg-green-900/40 text-green-400 border-green-700/40',
};

// ── GPS Track Types ─────────────────────────────────────────

interface GpsPoint {
  latitude: number;
  longitude: number;
  speed: number;
  altitude: number;
  timestamp: number;
}

// ── Helpers ─────────────────────────────────────────────────

const KMH_TO_MPH = 0.621371;

function channelLabel(ch?: string): string {
  if (!ch) return '';
  return ch === 'outside' ? 'FRONT' : 'REAR';
}
function channelBg(ch?: string): string {
  return ch === 'outside'
    ? 'bg-blue-900/80 text-blue-300 border border-blue-600/50'
    : 'bg-purple-900/80 text-purple-300 border border-purple-600/50';
}

function formatDate(d?: string): string {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatDuration(sec?: number): string {
  if (!sec) return '-';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatSize(bytes: number): string {
  if (!bytes) return '-';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function parseGpsTrack(raw?: string | null): GpsPoint[] | null {
  if (!raw) return null;
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr) || arr.length === 0) return null;
    return arr.sort((a: GpsPoint, b: GpsPoint) => a.timestamp - b.timestamp);
  } catch { return null; }
}

// ── Collapsible Section ─────────────────────────────────────

function Section({ title, icon: Icon, children, defaultOpen = true }: {
  title: string; icon: React.ElementType; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section>
      <button onClick={() => setOpen(!open)}
        className="flex items-center gap-1 w-full text-left mb-1.5 group">
        <Icon className="w-3 h-3 text-rmpg-500" />
        <span className="text-[10px] font-bold text-rmpg-500 uppercase tracking-wider flex-1">{title}</span>
        {open ? <ChevronUp className="w-3 h-3 text-rmpg-600" /> : <ChevronDown className="w-3 h-3 text-rmpg-600" />}
      </button>
      {open && children}
    </section>
  );
}

// ── Speed Timeline SVG ──────────────────────────────────────

function SpeedTimeline({ track, duration, currentTime, onSeek }: {
  track: GpsPoint[]; duration: number; currentTime: number;
  onSeek: (time: number) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const speeds = useMemo(() => track.map(p => Math.round(p.speed * KMH_TO_MPH)), [track]);
  const maxSpeed = useMemo(() => Math.max(...speeds, 1), [speeds]);
  const startMs = track[0].timestamp;
  const endMs = track[track.length - 1].timestamp;
  const totalMs = endMs - startMs || 1;

  const points = useMemo(() => {
    return track.map((p, i) => {
      const x = ((p.timestamp - startMs) / totalMs) * 100;
      const y = 48 - (speeds[i] / maxSpeed) * 40;
      return `${x}%,${y}`;
    }).join(' ');
  }, [track, speeds, maxSpeed, startMs, totalMs]);

  const progressX = duration > 0 ? (currentTime / duration) * 100 : 0;

  const handleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    onSeek(pct * duration);
  };

  return (
    <svg ref={svgRef} viewBox="0 0 100 48" preserveAspectRatio="none"
      className="w-full cursor-pointer" style={{ height: 48 }}
      onClick={handleClick}>
      {/* Speed zones */}
      <rect x="0" y={48 - (60 / maxSpeed) * 40} width="100" height="1" fill="#fbbf24" opacity="0.15" />
      <rect x="0" y={48 - (80 / maxSpeed) * 40} width="100" height="1" fill="#f87171" opacity="0.15" />
      {/* Speed line */}
      <polyline points={points} fill="none" stroke="#4ade80" strokeWidth="0.8" vectorEffect="non-scaling-stroke" />
      {/* Colored segments for speeding */}
      {track.map((p, i) => {
        if (i === 0) return null;
        const mph = speeds[i];
        if (mph <= 60) return null;
        const x1 = ((track[i - 1].timestamp - startMs) / totalMs) * 100;
        const x2 = ((p.timestamp - startMs) / totalMs) * 100;
        const y1 = 48 - (speeds[i - 1] / maxSpeed) * 40;
        const y2 = 48 - (mph / maxSpeed) * 40;
        const color = mph > 80 ? '#f87171' : '#fbbf24';
        return <line key={i} x1={`${x1}%`} y1={y1} x2={`${x2}%`} y2={y2} stroke={color} strokeWidth="0.8" vectorEffect="non-scaling-stroke" />;
      })}
      {/* Playback position */}
      <line x1={`${progressX}%`} y1="0" x2={`${progressX}%`} y2="48" stroke="#1a5a9e" strokeWidth="1" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// ── Main Component ──────────────────────────────────────────

export default function DashCamDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { addToast } = useToast();
  const { user } = useAuth();
  const canManage = ['admin', 'manager', 'supervisor'].includes(user?.role || '');
  const videoRef = useRef<HTMLVideoElement>(null);

  const [video, setVideo] = useState<DashCamVideo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [neighbors, setNeighbors] = useState<{ prev?: number; next?: number } | null>(null);
  const [links, setLinks] = useState<any[]>([]);
  const [showFullPlayer, setShowFullPlayer] = useState(false);
  const [editingVideo, setEditingVideo] = useState<DashCamVideo | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [classifying, setClassifying] = useState(false);

  const apiBase = window.location.origin + '/api';
  const getAuthHeaders = (): Record<string, string> => {
    const token = localStorage.getItem('rmpg_token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  // ── Data Fetching ────────────────────────────

  const fetchVideo = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<DashCamVideo>(`/fleet/dashcam-videos/${id}`);
      setVideo(data);
    } catch (err: any) {
      setError(err?.message || 'Video not found');
    } finally {
      setLoading(false);
    }
  }, [id]);

  const fetchNeighbors = useCallback(async () => {
    if (!id) return;
    try {
      const data = await apiFetch<{ prev?: number; next?: number }>(`/fleet/dashcam-videos/${id}/neighbors`);
      setNeighbors(data);
    } catch { setNeighbors(null); }
  }, [id]);

  const fetchLinks = useCallback(async () => {
    if (!id) return;
    try {
      const data = await apiFetch<any[]>(`/fleet/dashcam-videos/${id}/links`);
      setLinks(Array.isArray(data) ? data : []);
    } catch { setLinks([]); }
  }, [id]);

  useEffect(() => { fetchVideo(); fetchNeighbors(); fetchLinks(); }, [fetchVideo, fetchNeighbors, fetchLinks]);

  useEffect(() => {
    const vid = videoRef.current;
    if (!vid) return;
    const onTime = () => setCurrentTime(vid.currentTime);
    vid.addEventListener('timeupdate', onTime);
    return () => vid.removeEventListener('timeupdate', onTime);
  }, [video]);

  // ── Actions ────────────────────────────────

  const handleClassify = async (cls: string) => {
    if (!video) return;
    setClassifying(true);
    try {
      await apiFetch(`/fleet/dashcam-videos/${video.id}`, {
        method: 'PUT', body: JSON.stringify({ classification: cls }),
      });
      setVideo(prev => prev ? { ...prev, classification: cls as any } : null);
      addToast(`Classified as ${cls}`, 'success');
    } catch { addToast('Failed to update classification', 'error'); }
    finally { setClassifying(false); }
  };

  const handleBurn = async () => {
    if (!video) return;
    try {
      await apiFetch(`/fleet/dashcam-videos/${video.id}/burn`, { method: 'POST' });
      addToast('HUD burn started', 'success');
      fetchVideo();
    } catch (err: any) { addToast(err?.message || 'Burn failed', 'error'); }
  };

  const handleEditSave = async (videoId: number, data: DashCamVideoEditData) => {
    setEditSubmitting(true);
    try {
      await apiFetch(`/fleet/dashcam-videos/${videoId}`, {
        method: 'PUT', body: JSON.stringify(data),
      });
      setEditingVideo(null);
      addToast('Video updated', 'success');
      fetchVideo();
    } catch { addToast('Failed to update video', 'error'); }
    finally { setEditSubmitting(false); }
  };

  const handleSeek = (time: number) => {
    if (videoRef.current) videoRef.current.currentTime = time;
  };

  // ── Derived ────────────────────────────────

  const gpsTrack = useMemo(() => parseGpsTrack(video?.cpg_gps_track), [video?.cpg_gps_track]);
  const token = localStorage.getItem('rmpg_token') || '';
  const streamUrl = video ? `${apiBase}/fleet/dashcam-videos/${video.id}/stream?token=${encodeURIComponent(token)}` : '';
  const vehDesc = video ? [video.vehicle_year, video.vehicle_make, video.vehicle_model].filter(Boolean).join(' ') : '';
  const clsColors = CLASSIFICATION_COLORS[video?.classification || 'routine'] || CLASSIFICATION_COLORS.routine;

  // ── Loading / Error ────────────────────────

  if (loading) {
    return (
      <div className="flex flex-col h-full">
        <PanelTitleBar icon={Camera} title="MVR Video Detail" />
        <div className="flex-1 flex items-center justify-center">
          <div className="flex items-center gap-2">
            <Loader2 className="w-5 h-5 animate-spin text-brand-400" />
            <span className="text-[11px] text-rmpg-400">Loading video...</span>
          </div>
        </div>
      </div>
    );
  }

  if (error || !video) {
    return (
      <div className="flex flex-col h-full">
        <PanelTitleBar icon={Camera} title="MVR Video Detail">
          <button onClick={() => navigate('/dash-cameras')} className="toolbar-btn text-[10px] px-3 py-1 flex items-center gap-1">
            <ArrowLeft className="w-3 h-3" /> Back to Gallery
          </button>
        </PanelTitleBar>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <AlertTriangle className="w-8 h-8 text-red-400 mx-auto mb-2" />
            <p className="text-xs text-rmpg-400">{error || 'Video not found'}</p>
          </div>
        </div>
      </div>
    );
  }

  // ── Render ─────────────────────────────────

  return (
    <div className="flex flex-col h-full">
      {/* ── Title Bar ── */}
      <PanelTitleBar icon={Camera} title="MVR Video Detail">
        <button onClick={() => navigate('/dash-cameras')}
          className="toolbar-btn text-[10px] px-3 py-1 flex items-center gap-1">
          <ArrowLeft className="w-3 h-3" /> Gallery
        </button>
        <div className="h-4 w-px bg-rmpg-700" />
        {canManage && (
          <button onClick={() => setEditingVideo(video)}
            className="toolbar-btn text-[10px] px-3 py-1 flex items-center gap-1">
            <Edit2 className="w-3 h-3" /> Edit
          </button>
        )}
        {canManage && (
          <button onClick={handleBurn}
            className="toolbar-btn text-[10px] px-3 py-1 flex items-center gap-1"
            disabled={video.burn_status === 'processing' || video.burn_status === 'pending'}>
            <Flame className="w-3 h-3" /> Burn HUD
          </button>
        )}
        <a href={`${apiBase}/fleet/dashcam-videos/${video.id}/stream?token=${encodeURIComponent(token)}`}
          download className="toolbar-btn text-[10px] px-3 py-1 flex items-center gap-1">
          <Download className="w-3 h-3" /> Original
        </a>
        {video.burned_file_path && (
          <a href={`${apiBase}/fleet/dashcam-videos/${video.id}/burned?token=${encodeURIComponent(token)}`}
            download className="toolbar-btn-primary text-[10px] px-3 py-1 flex items-center gap-1">
            <Download className="w-3 h-3" /> Burned
          </a>
        )}
        <button onClick={() => setShowFullPlayer(true)}
          className="toolbar-btn text-[10px] px-3 py-1 flex items-center gap-1">
          <Maximize2 className="w-3 h-3" /> Full Screen
        </button>
      </PanelTitleBar>

      {/* ── Content: Two-column layout ── */}
      <div className="flex-1 flex min-h-0 overflow-hidden">

        {/* ── Left 2/3: Video Player Area ── */}
        <div className="flex-[2] flex flex-col min-w-0 overflow-y-auto" style={{ background: '#0a0a0a' }}>
          {/* Video element */}
          <div className="relative bg-black flex-shrink-0">
            <video
              ref={videoRef} controls autoPlay key={video.id}
              className="w-full" style={{ maxHeight: '70vh' }}
              src={streamUrl}
            />
            {/* Camera channel overlay */}
            {video.cpg_channel && (
              <span className={`absolute top-2 left-2 px-2 py-0.5 text-[9px] font-mono font-bold uppercase tracking-wider ${channelBg(video.cpg_channel)}`}>
                {channelLabel(video.cpg_channel)}
              </span>
            )}
            {/* REC indicator */}
            <div className="absolute top-2 right-2 flex items-center gap-1">
              <span className="led-dot led-red animate-led-blink" style={{ width: 5, height: 5 }} />
              <span className="font-mono text-[9px] text-red-400 font-bold tracking-wider">REC</span>
            </div>
          </div>

          {/* GPS Speed Timeline */}
          {gpsTrack && gpsTrack.length > 1 && video.duration_seconds && (
            <div className="flex-shrink-0 panel-inset" style={{ borderTop: '1px solid #141e2b' }}>
              <div className="flex items-center justify-between px-2 py-0.5">
                <span className="text-[8px] font-mono text-rmpg-500 uppercase tracking-wider flex items-center gap-1">
                  <Gauge className="w-3 h-3" /> Speed Timeline
                </span>
                <span className="text-[8px] font-mono text-rmpg-600">
                  {gpsTrack.length} GPS pts
                </span>
              </div>
              <SpeedTimeline
                track={gpsTrack}
                duration={video.duration_seconds}
                currentTime={currentTime}
                onSeek={handleSeek}
              />
            </div>
          )}
        </div>

        {/* ── Right 1/3: Metadata Panel ── */}
        <div className="flex-[1] flex flex-col min-w-[280px] max-w-[400px] overflow-y-auto border-l border-[#141e2b]"
          style={{ background: '#0d1520' }}>
          <div className="p-3 space-y-3">

            {/* 1. Video Info */}
            <Section title="Video Info" icon={Film}>
              <div className="panel-inset p-2 space-y-2">
                <h2 className="text-[13px] font-bold text-rmpg-100 leading-tight">{video.title}</h2>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {/* Classification badge — clickable */}
                  <div className="relative group">
                    <span className={`inline-flex px-1.5 py-0.5 text-[9px] font-bold border capitalize cursor-pointer ${
                      CLASSIFICATION_BADGE[video.classification] || CLASSIFICATION_BADGE.routine
                    }`}>
                      {video.classification}
                    </span>
                    {canManage && (
                      <div className="hidden group-hover:flex absolute top-full left-0 z-20 mt-1 gap-1 p-1 panel-beveled">
                        {(['routine', 'evidence', 'flagged', 'restricted'] as const).map(cls => (
                          <button key={cls} onClick={() => handleClassify(cls)} disabled={classifying}
                            className={`text-[8px] px-1.5 py-0.5 capitalize ${video.classification === cls ? 'toolbar-btn-primary' : 'toolbar-btn'}`}>
                            {cls}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {/* Source badge */}
                  <span className={`inline-flex px-1.5 py-0.5 text-[9px] font-bold border ${
                    SOURCE_COLORS[video.source || 'upload'] || SOURCE_COLORS.upload
                  }`}>
                    {video.source === 'clearpathgps' ? 'ClearPathGPS' : 'Upload'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-y-1.5 gap-x-3">
                  <div>
                    <span className="text-[9px] text-rmpg-500 uppercase block">File Size</span>
                    <span className="text-[11px] text-rmpg-200 font-mono">{formatSize(video.file_size)}</span>
                  </div>
                  <div>
                    <span className="text-[9px] text-rmpg-500 uppercase block">Duration</span>
                    <span className="text-[11px] text-rmpg-200 font-mono">{formatDuration(video.duration_seconds)}</span>
                  </div>
                  <div>
                    <span className="text-[9px] text-rmpg-500 uppercase block">Recorded</span>
                    <span className="text-[11px] text-rmpg-200 font-mono">{formatDate(video.recorded_at)}</span>
                  </div>
                  <div>
                    <span className="text-[9px] text-rmpg-500 uppercase block">Uploaded By</span>
                    <span className="text-[11px] text-rmpg-200 font-mono">{video.uploaded_by || '-'}</span>
                  </div>
                </div>
              </div>
            </Section>

            {/* 2. Vehicle & Unit */}
            <Section title="Vehicle & Unit" icon={Car}>
              <div className="panel-inset p-2 grid grid-cols-2 gap-y-1.5 gap-x-3">
                <div>
                  <span className="text-[9px] text-rmpg-500 uppercase block">Vehicle</span>
                  <span className="text-[11px] text-rmpg-200">
                    {video.vehicle_number ? `#${video.vehicle_number}` : '--'}
                    {vehDesc && ` ${vehDesc}`}
                  </span>
                </div>
                <div>
                  <span className="text-[9px] text-rmpg-500 uppercase block">Unit</span>
                  <span className="text-[11px] text-brand-400 font-mono font-bold">{video.unit_call_sign || '--'}</span>
                </div>
                {video.cpg_channel && (
                  <div>
                    <span className="text-[9px] text-rmpg-500 uppercase block">Camera</span>
                    <span className={`text-[11px] font-mono font-bold ${video.cpg_channel === 'outside' ? 'text-blue-400' : 'text-purple-400'}`}>
                      {channelLabel(video.cpg_channel)}
                    </span>
                  </div>
                )}
                {video.speed_mph != null && (
                  <div>
                    <span className="text-[9px] text-rmpg-500 uppercase block">Speed</span>
                    <span className={`text-[11px] font-mono font-bold ${
                      video.speed_mph > 80 ? 'text-red-400' : video.speed_mph > 60 ? 'text-amber-400' : 'text-green-400'
                    }`}>
                      {video.speed_mph} MPH
                    </span>
                  </div>
                )}
              </div>
            </Section>

            {/* 3. Location */}
            {(video.address || video.latitude != null) && (
              <Section title="Location" icon={MapPin}>
                <div className="panel-inset p-2 space-y-1">
                  {video.address && (
                    <div className="text-[11px] text-rmpg-200">{video.address}</div>
                  )}
                  {video.latitude != null && video.longitude != null && (
                    <div className="text-[10px] font-mono text-rmpg-400">
                      {video.latitude.toFixed(5)}, {video.longitude.toFixed(5)}
                    </div>
                  )}
                </div>
              </Section>
            )}

            {/* 4. Evidence */}
            <Section title="Evidence" icon={FileText}>
              <div className="panel-inset p-2 space-y-1">
                {video.case_number ? (
                  <div>
                    <span className="text-[9px] text-rmpg-500">Case #: </span>
                    <span className="text-[11px] text-amber-400 font-mono font-bold">{video.case_number}</span>
                  </div>
                ) : (
                  <div className="text-[10px] text-rmpg-500 italic">No case linked</div>
                )}
                <div>
                  <span className="text-[9px] text-rmpg-500 uppercase block">Classification</span>
                  <span className={`inline-flex px-1.5 py-0.5 text-[9px] font-bold border capitalize ${
                    CLASSIFICATION_BADGE[video.classification] || CLASSIFICATION_BADGE.routine
                  }`}>
                    {video.classification}
                  </span>
                </div>
                {video.notes && (
                  <div>
                    <span className="text-[9px] text-rmpg-500 uppercase block">Notes</span>
                    <span className="text-[11px] text-rmpg-300">{video.notes}</span>
                  </div>
                )}
              </div>
            </Section>

            {/* 5. Burn Status */}
            <Section title="Burn Status" icon={Flame} defaultOpen={video.burn_status !== 'none'}>
              <div className="panel-inset p-2 space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-[9px] text-rmpg-500 uppercase">Status:</span>
                  <span className={`text-[10px] font-mono font-bold capitalize ${
                    video.burn_status === 'complete' ? 'text-green-400' :
                    video.burn_status === 'error' ? 'text-red-400' :
                    video.burn_status === 'processing' ? 'text-amber-400' :
                    'text-rmpg-400'
                  }`}>
                    {video.burn_status || 'none'}
                  </span>
                </div>
                {(video.burn_status === 'processing' || video.burn_status === 'pending') && (
                  <div className="h-1.5 bg-rmpg-800 rounded overflow-hidden">
                    <div className="h-full bg-brand-500 transition-all" style={{ width: `${video.burn_progress || 0}%` }} />
                  </div>
                )}
                {video.burn_error && (
                  <p className="text-[9px] text-red-400 font-mono">{video.burn_error}</p>
                )}
                {video.burn_status === 'complete' && video.burned_file_path && (
                  <a href={`${apiBase}/fleet/dashcam-videos/${video.id}/burned?token=${encodeURIComponent(token)}`}
                    download className="toolbar-btn-primary text-[9px] px-3 py-1 inline-flex items-center gap-1">
                    <Download className="w-3 h-3" /> Download Burned
                  </a>
                )}
              </div>
            </Section>

            {/* 6. Linked Entities */}
            <Section title="Linked Entities" icon={Link2}>
              <div className="panel-inset p-2">
                {links.length === 0 ? (
                  <p className="text-[10px] text-rmpg-500 italic">No linked entities</p>
                ) : (
                  <div className="space-y-1">
                    {links.map((link: any, i: number) => (
                      <div key={i} className="flex items-center gap-2 text-[10px]">
                        <span className="text-rmpg-500 uppercase font-mono text-[9px]">{link.entity_type || link.type}</span>
                        <span className="text-rmpg-200 font-mono">#{link.entity_id || link.id}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Section>

            {/* 7. Navigation */}
            {neighbors && (
              <Section title="Navigation" icon={Clock}>
                <div className="flex items-center gap-2">
                  <button disabled={!neighbors.prev}
                    onClick={() => neighbors.prev && navigate(`/dash-cameras/${neighbors.prev}`)}
                    className="toolbar-btn text-[10px] px-3 py-1 flex items-center gap-1 flex-1 justify-center disabled:opacity-30">
                    <ChevronLeft className="w-3 h-3" /> Previous
                  </button>
                  <button disabled={!neighbors.next}
                    onClick={() => neighbors.next && navigate(`/dash-cameras/${neighbors.next}`)}
                    className="toolbar-btn text-[10px] px-3 py-1 flex items-center gap-1 flex-1 justify-center disabled:opacity-30">
                    Next <ChevronRight className="w-3 h-3" />
                  </button>
                </div>
              </Section>
            )}
          </div>
        </div>
      </div>

      {/* ── Modals ── */}
      <DashCamVideoPlayer
        isOpen={showFullPlayer}
        onClose={() => setShowFullPlayer(false)}
        video={video}
        apiBase={apiBase}
        getAuthHeaders={getAuthHeaders}
        onEditVideo={canManage ? (v) => { setShowFullPlayer(false); setEditingVideo(v); } : undefined}
      />

      <DashCamVideoEditModal
        isOpen={!!editingVideo}
        onClose={() => setEditingVideo(null)}
        video={editingVideo}
        onSave={handleEditSave}
        isSubmitting={editSubmitting}
      />
    </div>
  );
}
