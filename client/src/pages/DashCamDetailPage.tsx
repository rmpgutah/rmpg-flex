// ============================================================
// RMPG Flex — Dash Camera Police HUD Video Player
// Full-screen HUD overlay with GPS sync, speed timeline,
// and expandable side panel. Route: /dash-cameras/:id
// ============================================================

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Camera, Edit2, Flame, Download, Maximize2, Minimize2,
  Loader2, AlertTriangle, ChevronLeft, ChevronRight,
  ChevronDown, ChevronUp, Info, SkipBack, SkipForward,
  Play, Pause, Volume2, VolumeX, Map, Shield, FileText,
  Link2, Car, User, Gauge, Copy, Check,
} from 'lucide-react';
import type { DashCamVideo } from '../types';
import DashCamVideoEditModal, { type DashCamVideoEditData } from '../components/DashCamVideoEditModal';
import { apiFetch } from '../hooks/useApi';
import { useToast } from '../components/ToastProvider';
import { useAuth } from '../context/AuthContext';
import { DARK_MAP_STYLE } from '../utils/googleMapsLoader';

// ── GPS Track Types ─────────────────────────────────────────

interface GpsPoint {
  latitude: number;
  longitude: number;
  speed: number;
  altitude: number;
  timestamp: number;
}

interface LiveTelemetry {
  lat: number;
  lng: number;
  speedMph: number;
  altitude: number;
}

// ── Constants ───────────────────────────────────────────────

const KMH_TO_MPH = 0.621371;

const CLASSIFICATION_BADGE: Record<string, string> = {
  routine:    'hud-class-routine',
  evidence:   'hud-class-evidence',
  flagged:    'hud-class-flagged',
  restricted: 'hud-class-restricted',
};

// ── Helpers ─────────────────────────────────────────────────

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function interpolateTelemetry(track: GpsPoint[], sec: number): LiveTelemetry | null {
  if (!track.length) return null;
  const startMs = track[0].timestamp;
  const target = startMs + sec * 1000;
  if (target <= track[0].timestamp) {
    const p = track[0];
    return { lat: p.latitude, lng: p.longitude, speedMph: Math.round(p.speed * KMH_TO_MPH), altitude: Math.round(p.altitude) };
  }
  const last = track[track.length - 1];
  if (target >= last.timestamp) {
    return { lat: last.latitude, lng: last.longitude, speedMph: Math.round(last.speed * KMH_TO_MPH), altitude: Math.round(last.altitude) };
  }
  for (let i = 0; i < track.length - 1; i++) {
    const a = track[i], b = track[i + 1];
    if (target >= a.timestamp && target <= b.timestamp) {
      const span = b.timestamp - a.timestamp;
      const t = span > 0 ? (target - a.timestamp) / span : 0;
      return {
        lat: lerp(a.latitude, b.latitude, t),
        lng: lerp(a.longitude, b.longitude, t),
        speedMph: Math.round(lerp(a.speed, b.speed, t) * KMH_TO_MPH),
        altitude: Math.round(lerp(a.altitude, b.altitude, t)),
      };
    }
  }
  return null;
}

function channelLabel(ch?: string): string {
  if (!ch) return '';
  return ch === 'outside' ? 'FRONT' : 'REAR';
}

function channelClass(ch?: string): string {
  return ch === 'outside' ? 'hud-channel-front' : 'hud-channel-rear';
}

function speedColorClass(mph: number): string {
  if (mph > 65) return 'hud-speed-red';
  if (mph > 45) return 'hud-speed-amber';
  return 'hud-speed-green';
}

function formatDuration(sec?: number): string {
  if (!sec && sec !== 0) return '-:--';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatTimestamp(isoStr: string | undefined, offsetSec: number): string {
  if (!isoStr) return '--:--:--';
  const base = new Date(isoStr.includes('T') ? isoStr : isoStr + 'T00:00:00');
  const d = new Date(base.getTime() + offsetSec * 1000);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${mm}/${dd}/${yyyy} ${hh}:${min}:${ss} MT`;
}

function formatDate(d?: string): string {
  if (!d) return '-';
  return new Date(d.includes('T') ? d : d + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
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

// ── Speed Timeline SVG ──────────────────────────────────────

function SpeedTimeline({ track, duration, currentTime, onSeek }: {
  track: GpsPoint[]; duration: number; currentTime: number;
  onSeek: (time: number) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const speeds = useMemo(() => track.map(p => Math.round(p.speed * KMH_TO_MPH)), [track]);
  const maxSpeed = useMemo(() => Math.max(...speeds, 1), [speeds]);
  const startMs = track.length ? track[0].timestamp : 0;
  const endMs = track.length ? track[track.length - 1].timestamp : 0;
  const totalMs = endMs - startMs || 1;
  const h = 24;

  const segments = useMemo(() => {
    if (!track.length) return [];
    return track.map((p, i) => {
      const x = ((p.timestamp - startMs) / totalMs) * 100;
      const y = h - (speeds[i] / maxSpeed) * (h - 4);
      const mph = speeds[i];
      const color = mph > 65 ? '#ef4444' : mph > 45 ? '#f59e0b' : '#22c55e';
      return { x, y, color };
    });
  }, [track, speeds, maxSpeed, startMs, totalMs, h]);

  if (!track.length) return null;

  const progressX = duration > 0 ? (currentTime / duration) * 100 : 0;

  const handleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    onSeek(Math.max(0, Math.min(pct * duration, duration)));
  };

  return (
    <svg ref={svgRef} viewBox={`0 0 100 ${h}`} preserveAspectRatio="none"
      className="w-full cursor-pointer hud-timeline" style={{ height: h }}
      onClick={handleClick}>
      {/* Speed line segments (color-coded) */}
      {segments.map((seg, i) => {
        if (i === 0) return null;
        const prev = segments[i - 1];
        return (
          <line key={i}
            x1={`${prev.x}%`} y1={prev.y}
            x2={`${seg.x}%`} y2={seg.y}
            stroke={seg.color} strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
      {/* Playhead */}
      <line
        x1={`${progressX}%`} y1="0"
        x2={`${progressX}%`} y2={h}
        stroke="#aaaaaa" strokeWidth="2"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

// ── Collapsible Panel Section ───────────────────────────────

function HudSection({ title, icon: Icon, children, defaultOpen = false, isOpen, onToggle }: {
  title: string; icon: React.ElementType; children: React.ReactNode;
  defaultOpen?: boolean; isOpen?: boolean; onToggle?: () => void;
}) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const open = isOpen !== undefined ? isOpen : internalOpen;
  const toggle = onToggle || (() => setInternalOpen(!internalOpen));

  return (
    <div>
      <button type="button" onClick={toggle} className="hud-section-header w-full">
        <Icon className="w-3.5 h-3.5" style={{ flexShrink: 0 }} />
        <span className="flex-1 text-left">{title}</span>
        {open
          ? <ChevronUp className="w-3 h-3 opacity-50" />
          : <ChevronDown className="w-3 h-3 opacity-50" />}
      </button>
      {open && <div className="hud-section-content">{children}</div>}
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────

export default function DashCamDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { addToast } = useToast();
  const { user } = useAuth();
  const canManage = ['admin', 'manager', 'supervisor'].includes(user?.role || '');

  // Set document title
  useEffect(() => { document.title = 'Dash Cam Player \u2014 RMPG Flex'; }, []);

  // Keyboard shortcut: Escape to go back
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { navigate(-1); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [navigate]);

  // Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const animFrameRef = useRef<number>(0);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);
  const polylineRef = useRef<google.maps.Polyline | null>(null);

  // State
  const [video, setVideo] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [panelOpen, setPanelOpen] = useState(true);
  const [neighbors, setNeighbors] = useState<{ prev?: number; next?: number } | null>(null);
  const [editingVideo, setEditingVideo] = useState<any>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [classifying, setClassifying] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [mapSectionOpen, setMapSectionOpen] = useState(false);
  const [mapReady, setMapReady] = useState(false);

  // Section open states
  const [sections, setSections] = useState({
    officer: true,
    vehicle: true,
    speed: true,
    gps: false,
    incident: false,
    evidence: false,
    linked: false,
  });

  const toggleSection = (key: keyof typeof sections) => {
    setSections(prev => {
      const next = { ...prev, [key]: !prev[key] };
      if (key === 'gps') setMapSectionOpen(next.gps);
      return next;
    });
  };

  const apiBase = window.location.origin + '/api';
  const token = localStorage.getItem('rmpg_token') || '';
  const streamUrl = video ? `${apiBase}/fleet/dashcam-videos/${video.id}/stream?token=${encodeURIComponent(token)}` : '';

  // ── Data Fetching ────────────────────────────

  const fetchVideo = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<any>(`/fleet/dashcam-videos/${id}`);
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

  useEffect(() => { fetchVideo(); fetchNeighbors(); }, [fetchVideo, fetchNeighbors]);

  // ── GPS Track ────────────────────────────────

  const gpsTrack = useMemo(() => parseGpsTrack(video?.cpg_gps_track), [video?.cpg_gps_track]);

  const telemetry = useMemo(() => {
    if (!gpsTrack) return null;
    return interpolateTelemetry(gpsTrack, currentTime);
  }, [gpsTrack, currentTime]);

  // ── Video Event Handlers ─────────────────────

  useEffect(() => {
    const vid = videoRef.current;
    if (!vid) return;
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onDurationChange = () => setDuration(vid.duration || 0);
    const onEnded = () => setIsPlaying(false);
    const onVolumeChange = () => {
      setVolume(vid.volume);
      setIsMuted(vid.muted);
    };
    vid.addEventListener('play', onPlay);
    vid.addEventListener('pause', onPause);
    vid.addEventListener('durationchange', onDurationChange);
    vid.addEventListener('ended', onEnded);
    vid.addEventListener('volumechange', onVolumeChange);
    return () => {
      vid.removeEventListener('play', onPlay);
      vid.removeEventListener('pause', onPause);
      vid.removeEventListener('durationchange', onDurationChange);
      vid.removeEventListener('ended', onEnded);
      vid.removeEventListener('volumechange', onVolumeChange);
    };
  }, [video]);

  // ── RAF Loop for Smooth GPS Sync ─────────────

  useEffect(() => {
    if (!isPlaying) return;
    const tick = () => {
      if (videoRef.current) {
        setCurrentTime(videoRef.current.currentTime);
      }
      animFrameRef.current = requestAnimationFrame(tick);
    };
    animFrameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [isPlaying]);

  // Also sync when paused (for seeking)
  useEffect(() => {
    const vid = videoRef.current;
    if (!vid) return;
    const onSeeked = () => setCurrentTime(vid.currentTime);
    vid.addEventListener('seeked', onSeeked);
    return () => vid.removeEventListener('seeked', onSeeked);
  }, [video]);

  // ── Google Map ───────────────────────────────

  useEffect(() => {
    if (!mapSectionOpen || !mapContainerRef.current || mapRef.current) return;
    if (!window.google?.maps) return;

    const center = telemetry
      ? { lat: telemetry.lat, lng: telemetry.lng }
      : video?.latitude && video?.longitude
        ? { lat: video.latitude, lng: video.longitude }
        : { lat: 40.76, lng: -111.89 };

    const map = new google.maps.Map(mapContainerRef.current, {
      center,
      zoom: 15,
      renderingType: 'RASTER' as any,
      disableDefaultUI: true,
      zoomControl: true,
      styles: DARK_MAP_STYLE,
      backgroundColor: '#171717',
    });
    mapRef.current = map;

    // Marker
    const marker = new google.maps.Marker({
      position: center,
      map,
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 7,
        fillColor: '#888888',
        fillOpacity: 1,
        strokeColor: '#cccccc',
        strokeWeight: 2,
      },
    });
    markerRef.current = marker;

    // Route polyline from GPS track
    if (gpsTrack && gpsTrack.length > 1) {
      const path = gpsTrack.map(p => ({ lat: p.latitude, lng: p.longitude }));
      const polyline = new google.maps.Polyline({
        path,
        strokeColor: '#888888',
        strokeOpacity: 0.5,
        strokeWeight: 2,
        map,
      });
      polylineRef.current = polyline;

      // Fit bounds to track
      const bounds = new google.maps.LatLngBounds();
      path.forEach(p => bounds.extend(p));
      map.fitBounds(bounds, 20);
    }

    setMapReady(true);
  }, [mapSectionOpen, video, gpsTrack]);

  // Cleanup Google Maps on unmount to prevent memory leak
  useEffect(() => {
    return () => {
      markerRef.current?.setMap(null);
      polylineRef.current?.setMap(null);
      markerRef.current = null;
      polylineRef.current = null;
      mapRef.current = null;
    };
  }, []);

  // Update marker position during playback
  useEffect(() => {
    if (!mapReady || !markerRef.current || !telemetry) return;
    const pos = { lat: telemetry.lat, lng: telemetry.lng };
    markerRef.current.setPosition(pos);
    if (isPlaying) {
      mapRef.current?.panTo(pos);
    }
  }, [telemetry, mapReady, isPlaying]);

  // ── Actions ──────────────────────────────────

  const togglePlayPause = useCallback(() => {
    const vid = videoRef.current;
    if (!vid) return;
    if (vid.paused) vid.play(); else vid.pause();
  }, []);

  const skip = useCallback((delta: number) => {
    const vid = videoRef.current;
    if (!vid) return;
    vid.currentTime = Math.max(0, Math.min(vid.currentTime + delta, vid.duration || 0));
  }, []);

  const setSpeed = useCallback((rate: number) => {
    const vid = videoRef.current;
    if (vid) vid.playbackRate = rate;
    setPlaybackRate(rate);
  }, []);

  const toggleMute = useCallback(() => {
    const vid = videoRef.current;
    if (vid) vid.muted = !vid.muted;
  }, []);

  const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const vid = videoRef.current;
    const val = parseFloat(e.target.value);
    if (vid) {
      vid.volume = val;
      vid.muted = val === 0;
    }
  }, []);

  const handleSeek = useCallback((time: number) => {
    if (videoRef.current) videoRef.current.currentTime = time;
  }, []);

  const toggleFullscreen = useCallback(() => {
    const container = document.getElementById('hud-container');
    if (!container) return;
    if (!document.fullscreenElement) {
      container.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  }, []);

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const handleClassify = async (cls: string) => {
    if (!video) return;
    setClassifying(true);
    try {
      await apiFetch(`/fleet/dashcam-videos/${video.id}`, {
        method: 'PUT', body: JSON.stringify({ classification: cls }),
      });
      setVideo((prev: any) => prev ? { ...prev, classification: cls } : null);
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

  // ── Keyboard Shortcuts ───────────────────────

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Don't capture when typing in inputs
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      switch (e.key) {
        case ' ':
          e.preventDefault();
          togglePlayPause();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          skip(-10);
          break;
        case 'ArrowRight':
          e.preventDefault();
          skip(10);
          break;
        case 'j':
        case 'J':
          skip(-10);
          break;
        case 'k':
        case 'K':
          togglePlayPause();
          break;
        case 'l':
        case 'L': {
          // L stacks playback speed (pro review pattern)
          const speeds = [1, 1.5, 2];
          const curIdx = speeds.indexOf(playbackRate);
          const nextRate = curIdx < speeds.length - 1 ? speeds[curIdx + 1] : speeds[speeds.length - 1];
          setPlaybackRate(nextRate);
          if (videoRef.current) videoRef.current.playbackRate = nextRate;
          if (videoRef.current?.paused) { videoRef.current.play(); setIsPlaying(true); }
          break;
        }
        case 'f':
        case 'F':
          toggleFullscreen();
          break;
        case 'i':
        case 'I':
          setPanelOpen(p => !p);
          break;
        case '1':
          setSpeed(0.5);
          break;
        case '2':
          setSpeed(1);
          break;
        case '3':
          setSpeed(1.5);
          break;
        case '4':
          setSpeed(2);
          break;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [togglePlayPause, skip, toggleFullscreen, setSpeed]);

  // ── Derived Values ───────────────────────────

  const liveSpeed = telemetry?.speedMph ?? null;
  const speedClass = liveSpeed !== null ? speedColorClass(liveSpeed) : '';
  const vehDesc = video ? [video.vehicle_year, video.vehicle_make, video.vehicle_model].filter(Boolean).join(' ') : '';
  const links: any[] = video?.links || [];
  const incidentLink = links.find((l: any) => l.entity_type === 'call');
  const otherLinks = links.filter((l: any) => l.entity_type !== 'call');

  // ── Loading / Error ──────────────────────────

  // ── Render ────────────────────────────────────

  // Set document title
  useEffect(() => { document.title = 'Dash Cam Player \u2014 RMPG Flex'; }, []);

  // Keyboard shortcut: Escape to close modals
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setEditingVideo(null); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center" style={{ height: 'calc(100dvh - 120px)' }}>
        <div className="flex items-center gap-2">
          <Loader2 className="w-5 h-5 animate-spin text-brand-400" role="status" aria-label="Loading" />
          <span className="text-[11px] text-rmpg-400">Loading video...</span>
        </div>
      </div>
    );
  }

  if (error || !video) {
    return (
      <div className="flex items-center justify-center" style={{ height: 'calc(100dvh - 120px)' }}>
        <div className="text-center">
          <AlertTriangle className="w-8 h-8 text-red-400 mx-auto mb-2" />
          <p className="text-xs text-rmpg-400 mb-3">{error || 'Video not found'}</p>
          <button type="button" onClick={() => navigate('/dash-cameras')}
            className="toolbar-btn text-[10px] px-4 py-1.5 inline-flex items-center gap-1">
            <ChevronLeft className="w-3 h-3" /> Back to Gallery
          </button>
        </div>
      </div>
    );
  }


  return (
    <div id="hud-container" className="relative flex" style={{ height: 'calc(100dvh - 120px)', background: '#000' }}>

      {/* ── Video Area (fills available space) ── */}
      <div className="flex-1 flex flex-col min-w-0 relative">

        {/* Video wrapper with overlay bars */}
        <div className="flex-1 relative overflow-hidden flex items-center justify-center bg-black">

          {/* Video element */}
          <video
            ref={videoRef}
            key={video.id}
            className="w-full h-full object-contain"
            src={streamUrl}
            autoPlay
            playsInline
            onClick={togglePlayPause}
          />

          {/* ── Top Overlay Bar ── */}
          <div className="hud-bar hud-bar-top">
            {/* REC indicator */}
            <div className="flex items-center gap-1.5">
              <span className={`hud-rec-dot ${!isPlaying ? 'paused' : ''}`} />
              <span className="font-bold text-red-400 tracking-wider" style={{ fontSize: 10 }}>REC</span>
            </div>

            {/* Timestamp */}
            <span className="text-rmpg-300" style={{ letterSpacing: '0.03em' }}>
              {formatTimestamp(video.recorded_at, currentTime)}
            </span>

            <div className="flex-1" />

            {/* Unit call sign */}
            {video.unit_call_sign && (
              <span className="text-gray-400 font-bold tracking-wide">
                {video.unit_call_sign}
              </span>
            )}

            {/* Speed */}
            <span className={`font-bold ${liveSpeed !== null ? speedClass : 'text-rmpg-500'}`}>
              {liveSpeed !== null ? `${liveSpeed} MPH` : '-- MPH'}
            </span>

            {/* Channel badge */}
            {video.cpg_channel && (
              <span className={channelClass(video.cpg_channel)}>
                {channelLabel(video.cpg_channel)}
              </span>
            )}

            {/* Info panel toggle */}
            <button type="button" onClick={() => setPanelOpen(p => !p)}
              className="text-rmpg-400 hover:text-white transition-colors p-0.5" title="Toggle panel (I)">
              <Info className="w-4 h-4" />
            </button>
          </div>

          {/* ── Bottom Overlay Bar ── */}
          <div className="hud-bar hud-bar-bottom">
            {/* Case number */}
            {video.case_number ? (
              <span className="text-amber-400 font-bold tracking-wide">
                CASE {video.case_number}
              </span>
            ) : (
              <span className="text-rmpg-600 italic">NO CASE</span>
            )}

            {/* Classification badge */}
            <span className={`font-bold uppercase tracking-wider ${CLASSIFICATION_BADGE[video.classification] || CLASSIFICATION_BADGE.routine}`}
              style={{ fontSize: 9 }}>
              {video.classification}
            </span>

            {/* Address */}
            {video.address && (
              <span className="text-rmpg-300 truncate max-w-[200px]" title={video.address}>
                {video.address}
              </span>
            )}

            <div className="flex-1" />

            {/* GPS coordinates */}
            {telemetry ? (
              <span className="text-rmpg-400" style={{ fontSize: 9 }}>
                {telemetry.lat.toFixed(4)}&deg;N {Math.abs(telemetry.lng).toFixed(4)}&deg;W
              </span>
            ) : video.latitude != null && video.longitude != null ? (
              <span className="text-rmpg-500" style={{ fontSize: 9 }}>
                {video.latitude.toFixed(4)}&deg;N {Math.abs(video.longitude).toFixed(4)}&deg;W
              </span>
            ) : null}
          </div>
        </div>

        {/* ── Speed Timeline ── */}
        {gpsTrack && gpsTrack.length > 1 && duration > 0 && (
          <SpeedTimeline
            track={gpsTrack}
            duration={duration}
            currentTime={currentTime}
            onSeek={handleSeek}
          />
        )}

        {/* ── Playback Controls ── */}
        <div className="hud-controls">
          {/* Prev video */}
          <button type="button" onClick={() => neighbors?.prev && navigate(`/dash-cameras/${neighbors.prev}`)}
            disabled={!neighbors?.prev} title="Previous video"
            style={{ opacity: neighbors?.prev ? 1 : 0.3 }}>
            <ChevronLeft className="w-4 h-4" />
          </button>

          {/* Skip back */}
          <button type="button" onClick={() => skip(-10)} title="Back 10s (Left arrow)">
            <SkipBack className="w-4 h-4" />
          </button>

          {/* Play/Pause */}
          <button type="button" onClick={togglePlayPause} title="Play/Pause (Space)">
            {isPlaying
              ? <Pause className="w-5 h-5" />
              : <Play className="w-5 h-5" />}
          </button>

          {/* Skip forward */}
          <button type="button" onClick={() => skip(10)} title="Forward 10s (Right arrow)">
            <SkipForward className="w-4 h-4" />
          </button>

          {/* Next video */}
          <button type="button" onClick={() => neighbors?.next && navigate(`/dash-cameras/${neighbors.next}`)}
            disabled={!neighbors?.next} title="Next video"
            style={{ opacity: neighbors?.next ? 1 : 0.3 }}>
            <ChevronRight className="w-4 h-4" />
          </button>

          {/* Separator */}
          <div className="w-px h-4 bg-white/10 mx-1" />

          {/* Time display */}
          <span className="text-[11px] font-mono text-rmpg-300 min-w-[80px]">
            {formatDuration(currentTime)} / {formatDuration(duration)}
          </span>

          {/* Separator */}
          <div className="w-px h-4 bg-white/10 mx-1" />

          {/* Volume */}
          <button type="button" onClick={toggleMute} title="Mute/Unmute">
            {isMuted || volume === 0
              ? <VolumeX className="w-4 h-4" />
              : <Volume2 className="w-4 h-4" />}
          </button>
          <input type="range" min="0" max="1" step="0.05"
            value={isMuted ? 0 : volume}
            onChange={handleVolumeChange}
            className="w-16 h-1 accent-brand-500 cursor-pointer"
            style={{ accentColor: '#aaaaaa' }}
          />

          {/* Separator */}
          <div className="w-px h-4 bg-white/10 mx-1" />

          {/* Playback speed */}
          {[0.5, 1, 1.5, 2].map(rate => (
            <button type="button" key={rate}
              onClick={() => setSpeed(rate)}
              className={playbackRate === rate ? 'active' : ''}
              title={`${rate}x speed`}>
              {rate}x
            </button>
          ))}

          <div className="flex-1" />

          {/* Fullscreen */}
          <button type="button" onClick={toggleFullscreen} title="Fullscreen (F)">
            {isFullscreen
              ? <Minimize2 className="w-4 h-4" />
              : <Maximize2 className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* ── Side Panel ── */}
      <div className={`hud-panel ${panelOpen ? 'open' : ''}`}
        style={{ position: panelOpen ? 'relative' : 'absolute', transform: panelOpen ? 'none' : undefined }}>
        <div className="flex flex-col h-full">
          <div className="flex-1 overflow-y-auto">

            {/* 1. OFFICER & UNIT */}
            <HudSection title="Officer & Unit" icon={User}
              isOpen={sections.officer} onToggle={() => toggleSection('officer')}
              defaultOpen>
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-y-1.5 gap-x-3">
                  <div>
                    <span className="text-[9px] text-rmpg-500 uppercase block">Officer</span>
                    <span className="text-[11px] text-rmpg-100 font-medium">{video.officer_name || '--'}</span>
                  </div>
                  <div>
                    <span className="text-[9px] text-rmpg-500 uppercase block">Badge</span>
                    <span className="text-[11px] text-rmpg-200 font-mono">{video.officer_badge || '--'}</span>
                  </div>
                  <div>
                    <span className="text-[9px] text-rmpg-500 uppercase block">Rank</span>
                    <span className="text-[11px] text-rmpg-200 capitalize">{video.officer_rank || '--'}</span>
                  </div>
                  <div>
                    <span className="text-[9px] text-rmpg-500 uppercase block">Unit</span>
                    <span className="text-[11px] text-brand-400 font-mono font-bold">{video.unit_call_sign || '--'}</span>
                  </div>
                </div>
                {video.unit_status && (
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] text-rmpg-500 uppercase">Status</span>
                    <div className="flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full ${
                        video.unit_status === 'available' ? 'bg-green-500' :
                        video.unit_status === 'busy' ? 'bg-amber-500' :
                        video.unit_status === 'out_of_service' ? 'bg-red-500' :
                        'bg-rmpg-500'
                      }`} />
                      <span className="text-[10px] text-rmpg-200 capitalize font-mono">
                        {(video.unit_status || '').replace(/_/g, ' ')}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </HudSection>

            {/* 2. VEHICLE */}
            <HudSection title="Vehicle" icon={Car}
              isOpen={sections.vehicle} onToggle={() => toggleSection('vehicle')}
              defaultOpen>
              <div className="grid grid-cols-2 gap-y-1.5 gap-x-3">
                <div>
                  <span className="text-[9px] text-rmpg-500 uppercase block">Vehicle #</span>
                  <span className="text-[11px] text-rmpg-200 font-mono">{video.vehicle_number ? `#${video.vehicle_number}` : '--'}</span>
                </div>
                <div>
                  <span className="text-[9px] text-rmpg-500 uppercase block">Description</span>
                  <span className="text-[11px] text-rmpg-200">{vehDesc || '--'}</span>
                </div>
                {video.vehicle_color && (
                  <div>
                    <span className="text-[9px] text-rmpg-500 uppercase block">Color</span>
                    <span className="text-[11px] text-rmpg-200 capitalize">{video.vehicle_color}</span>
                  </div>
                )}
                {video.vehicle_plate && (
                  <div>
                    <span className="text-[9px] text-rmpg-500 uppercase block">Plate</span>
                    <span className="text-[11px] text-rmpg-200 font-mono">
                      {video.vehicle_plate}
                      {video.vehicle_plate_state && <span className="text-rmpg-500 ml-1">{video.vehicle_plate_state}</span>}
                    </span>
                  </div>
                )}
              </div>
            </HudSection>

            {/* 3. SPEED */}
            <HudSection title="Speed" icon={Gauge}
              isOpen={sections.speed} onToggle={() => toggleSection('speed')}
              defaultOpen>
              <div className="text-center py-1">
                <div className={`hud-speed-gauge ${liveSpeed !== null ? speedColorClass(liveSpeed) : 'text-rmpg-600'}`}>
                  {liveSpeed !== null ? liveSpeed : '--'}
                </div>
                <div className={`hud-speed-unit ${liveSpeed !== null ? speedColorClass(liveSpeed) : 'text-rmpg-600'}`}>
                  MPH
                </div>
                {telemetry?.altitude != null && (
                  <div className="text-[9px] text-rmpg-500 font-mono mt-1">
                    ALT {telemetry.altitude} ft
                  </div>
                )}
              </div>
            </HudSection>

            {/* 4. GPS MAP */}
            <HudSection title="GPS Map" icon={Map}
              isOpen={sections.gps} onToggle={() => toggleSection('gps')}>
              <div ref={mapContainerRef}
                className="w-full rounded-sm"
                style={{ height: 200, background: '#050505' }}>
                {!window.google?.maps && (
                  <div className="flex items-center justify-center h-full">
                    <span className="text-[9px] text-rmpg-500">Maps unavailable</span>
                  </div>
                )}
              </div>
              {telemetry && (
                <div className="mt-2 text-[9px] text-rmpg-400 font-mono text-center">
                  {telemetry.lat.toFixed(5)}, {telemetry.lng.toFixed(5)}
                </div>
              )}
            </HudSection>

            {/* 5. INCIDENT */}
            <HudSection title="Incident" icon={Shield}
              isOpen={sections.incident} onToggle={() => toggleSection('incident')}>
              {incidentLink ? (
                <div className="space-y-1.5">
                  {incidentLink.priority && (
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] text-rmpg-500 uppercase">Priority</span>
                      <span className={`text-[10px] font-mono font-bold ${
                        incidentLink.priority === 1 ? 'text-red-400' :
                        incidentLink.priority === 2 ? 'text-amber-400' :
                        'text-green-400'
                      }`}>
                        P{incidentLink.priority}
                      </span>
                    </div>
                  )}
                  {incidentLink.incident_type && (
                    <div>
                      <span className="text-[9px] text-rmpg-500 uppercase block">Type</span>
                      <span className="text-[11px] text-rmpg-200">{(incidentLink.incident_type || '').replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}</span>
                    </div>
                  )}
                  {incidentLink.status && (
                    <div>
                      <span className="text-[9px] text-rmpg-500 uppercase block">Status</span>
                      <span className="text-[11px] text-rmpg-200 capitalize">{(incidentLink.status || '').replace(/_/g, ' ')}</span>
                    </div>
                  )}
                  {incidentLink.disposition && (
                    <div>
                      <span className="text-[9px] text-rmpg-500 uppercase block">Disposition</span>
                      <span className="text-[11px] text-rmpg-200">{(incidentLink.disposition || '').replace(/_/g, ' ')}</span>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-[10px] text-rmpg-500 italic">No linked incident</p>
              )}
            </HudSection>

            {/* 6. EVIDENCE */}
            <HudSection title="Evidence" icon={FileText}
              isOpen={sections.evidence} onToggle={() => toggleSection('evidence')}>
              <div className="space-y-1.5">
                <div>
                  <span className="text-[9px] text-rmpg-500 uppercase block">Case #</span>
                  {video.case_number ? (
                    <span className="text-[11px] text-amber-400 font-mono font-bold">{video.case_number}</span>
                  ) : (
                    <span className="text-[10px] text-rmpg-500 italic">None</span>
                  )}
                </div>
                <div>
                  <span className="text-[9px] text-rmpg-500 uppercase block">Classification</span>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className={`text-[10px] font-bold uppercase ${CLASSIFICATION_BADGE[video.classification] || ''}`}>
                      {video.classification}
                    </span>
                    {canManage && (
                      <div className="flex gap-0.5 ml-1">
                        {(['routine', 'evidence', 'flagged', 'restricted'] as const).map(cls => (
                          <button type="button" key={cls} onClick={() => handleClassify(cls)} disabled={classifying}
                            className={`text-[8px] px-1 py-0.5 capitalize rounded-sm ${
                              video.classification === cls
                                ? 'bg-brand-500/30 text-brand-300'
                                : 'text-rmpg-500 hover:text-rmpg-300 hover:bg-surface-raised/50'
                            }`}>
                            {cls.slice(0, 3)}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div>
                  <span className="text-[9px] text-rmpg-500 uppercase block">Source</span>
                  <span className="text-[11px] text-rmpg-200">
                    {video.source === 'clearpathgps' ? 'ClearPathGPS' : video.uploaded_by || 'Upload'}
                  </span>
                </div>
                <div>
                  <span className="text-[9px] text-rmpg-500 uppercase block">Created</span>
                  <span className="text-[10px] text-rmpg-300 font-mono">{formatDate(video.created_at)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[9px] text-rmpg-500 uppercase">Burn</span>
                  <span className={`text-[10px] font-mono font-bold capitalize ${
                    video.burn_status === 'complete' ? 'text-green-400' :
                    video.burn_status === 'error' ? 'text-red-400' :
                    video.burn_status === 'processing' ? 'text-amber-400' :
                    'text-rmpg-500'
                  }`}>
                    {video.burn_status || 'none'}
                  </span>
                </div>
                {video.notes && (
                  <div>
                    <span className="text-[9px] text-rmpg-500 uppercase block">Notes</span>
                    <span className="text-[10px] text-rmpg-300">{video.notes}</span>
                  </div>
                )}
              </div>
            </HudSection>

            {/* 7. LINKED */}
            <HudSection title="Linked Entities" icon={Link2}
              isOpen={sections.linked} onToggle={() => toggleSection('linked')}>
              {otherLinks.length > 0 ? (
                <div className="space-y-1">
                  {otherLinks.map((link: any) => (
                    <button type="button" key={`${link.entity_type}-${link.entity_id}`}
                      className="flex items-center gap-2 text-[10px] w-full text-left hover:bg-surface-raised/50 px-1 py-0.5 rounded-sm"
                      onClick={() => {
                        if (link.entity_type === 'warrant') navigate(`/warrants/${link.entity_id}`);
                        else if (link.entity_type === 'citation') navigate(`/citations/${link.entity_id}`);
                      }}>
                      <span className="text-rmpg-500 uppercase font-mono text-[9px]">{link.entity_type}</span>
                      <span className="text-rmpg-200 font-mono">#{link.entity_id}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-[10px] text-rmpg-500 italic">No linked entities</p>
              )}
            </HudSection>
          </div>

          {/* ── Panel Bottom Actions ── */}
          <div className="border-t border-[#181818] p-2 space-y-1.5" style={{ background: 'var(--surface-raised)' }}>
            {/* File info */}
            <div className="flex items-center justify-between text-[9px] text-rmpg-500 font-mono mb-1">
              <span>{formatSize(video.file_size)}</span>
              <span>{formatDuration(video.duration_seconds)}</span>
            </div>

            {canManage && (
              <button type="button" onClick={handleBurn}
                disabled={video.burn_status === 'processing' || video.burn_status === 'pending'}
                className="toolbar-btn text-[10px] w-full py-1.5 flex items-center justify-center gap-1.5 disabled:opacity-30">
                <Flame className="w-3.5 h-3.5" /> Burn HUD Overlay
              </button>
            )}

            <button type="button" onClick={() => {
              navigator.clipboard.writeText(window.location.href);
              setLinkCopied(true);
              setTimeout(() => setLinkCopied(false), 2000);
            }}
              className="toolbar-btn text-[10px] w-full py-1.5 flex items-center justify-center gap-1.5">
              {linkCopied ? <><Check className="w-3.5 h-3.5 text-green-400" /> Copied!</> : <><Copy className="w-3.5 h-3.5" /> Copy Link</>}
            </button>

            <a href={streamUrl} download
              className="toolbar-btn text-[10px] w-full py-1.5 flex items-center justify-center gap-1.5 no-underline">
              <Download className="w-3.5 h-3.5" /> Download Original
            </a>

            {video.burned_file_path && (
              <a href={`${apiBase}/fleet/dashcam-videos/${video.id}/download-burned?token=${encodeURIComponent(token)}`}
                download
                className="toolbar-btn-primary text-[10px] w-full py-1.5 flex items-center justify-center gap-1.5 no-underline">
                <Download className="w-3.5 h-3.5" /> Download Burned
              </a>
            )}

            {canManage && (
              <button type="button" onClick={() => setEditingVideo(video)}
                className="toolbar-btn text-[10px] w-full py-1.5 flex items-center justify-center gap-1.5">
                <Edit2 className="w-3.5 h-3.5" /> Edit Details
              </button>
            )}

            {/* Navigation */}
            {neighbors && (
              <div className="flex gap-1.5 pt-1">
                <button type="button" disabled={!neighbors.prev}
                  onClick={() => neighbors.prev && navigate(`/dash-cameras/${neighbors.prev}`)}
                  className="toolbar-btn text-[10px] flex-1 py-1 flex items-center justify-center gap-1 disabled:opacity-30">
                  <ChevronLeft className="w-3 h-3" /> Prev
                </button>
                <button type="button" disabled={!neighbors.next}
                  onClick={() => neighbors.next && navigate(`/dash-cameras/${neighbors.next}`)}
                  className="toolbar-btn text-[10px] flex-1 py-1 flex items-center justify-center gap-1 disabled:opacity-30">
                  Next <ChevronRight className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Edit Modal ── */}
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
