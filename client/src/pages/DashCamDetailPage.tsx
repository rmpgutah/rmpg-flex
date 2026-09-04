// ============================================================
// RMPG Flex — Dash Camera Police HUD Video Player
// Full-screen HUD overlay with GPS sync, speed timeline,
// and expandable side panel. Route: /dash-cameras/:id
// ============================================================

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router';
import {
  Edit2, Flame, Download, Maximize2, Minimize2, Loader2, AlertTriangle,
  ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Info, SkipBack, SkipForward,
  Play, Pause, Volume2, VolumeX, Map, Shield, FileText, Link2, Car, User, Gauge,
  Copy, Check, Video,
} from 'lucide-react';
import DashCamVideoEditModal, { type DashCamVideoEditData } from '../components/DashCamVideoEditModal';
import ConfirmDialog from '../components/ConfirmDialog';
import { apiFetch } from '../hooks/useApi';
import { WORKER_HTTP_ORIGIN } from '../utils/apiOrigin';
import { useToast } from '../components/ToastProvider';
import { useAuth } from '../context/AuthContext';
import { initMapbox, getMapboxInstance, mapboxgl, MAPBOX_STYLE_DARK } from '../utils/mapboxLoader';
import { applyRmpgBasemap } from '../utils/mapboxBasemap';
import { installWebglContextRecovery } from '../utils/webglRecovery';
import { getMapboxAccessToken } from '../utils/mapboxApiKey';
import { parseTimestamp } from '../utils/dateUtils';
import { formatEnumValue, toDisplayLabel } from '../utils/formatters';

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
  const base = parseTimestamp(isoStr);
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
  return parseTimestamp(d).toLocaleDateString('en-US', {
    timeZone: 'America/Denver', month: 'short', day: 'numeric', year: 'numeric',
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
      // Speed colors: red >65, amber >45, green ≤45
      const root = document.documentElement;
      const criticalColor = getComputedStyle(root).getPropertyValue('--sev-critical').trim() || '#ef4444';
      const warnColor = getComputedStyle(root).getPropertyValue('--sev-warn').trim() || '#f59e0b';
      const okColor = getComputedStyle(root).getPropertyValue('--sev-ok').trim() || '#22c55e';
      const color = mph > 65 ? criticalColor : mph > 45 ? warnColor : okColor;
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
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
        style={{ stroke: 'var(--text-muted)' }}
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
  const [searchParams, setSearchParams] = useSearchParams();
  const { addToast } = useToast();
  const { user } = useAuth();
  const canManage = ['admin', 'manager', 'supervisor'].includes(user?.role || '');
  const isAdminOrManager = ['admin', 'manager'].includes(user?.role || '');

  // Set document title
  useEffect(() => { document.title = 'Dash Cam Player — RMPG Flex'; }, []);

  // Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const animFrameRef = useRef<number>(0);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);
  const downloadRef = useRef<HTMLAnchorElement>(null);
  const deepLinkRef = useRef(false);

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
  // WebGL context-loss recovery (rebuilds the map after a GPU context drop).
  const [mapRecoverNonce, setMapRecoverNonce] = useState(0);
  const [isMapRecovering, setIsMapRecovering] = useState(false);
  const [mapNeedsManualReload, setMapNeedsManualReload] = useState(false);
  const mapRecoveryCleanupRef = useRef<(() => void) | null>(null);

  // ConfirmDialog state — burn HUD overlay
  const [burnConfirmOpen, setBurnConfirmOpen] = useState(false);
  const [burning, setBurning] = useState(false);

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

  const apiBase = WORKER_HTTP_ORIGIN + '/api';
  const token = localStorage.getItem('rmpg_token') || '';
  const streamUrl = video ? `${apiBase}/fleet/dashcam-videos/${video.id}/stream?token=${encodeURIComponent(token)}` : '';

  // ── Data Fetching ────────────────────────────

  const fetchVideo = useCallback(async () => {
    if (!id) { setError('Invalid camera ID'); setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<any>(`/fleet/dashcam-videos/${id}`);
      // Unwrap .data envelope if present
      setVideo(res?.data ?? res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Video not found');
    } finally {
      setLoading(false);
    }
  }, [id]);

  const fetchNeighbors = useCallback(async () => {
    if (!id) return;
    try {
      const res = await apiFetch<any>(`/fleet/dashcam-videos/${id}/neighbors`);
      const data: { prev?: number; next?: number } = res?.data ?? res;
      setNeighbors(data);
    } catch { setNeighbors(null); }
  }, [id]);

  useEffect(() => { fetchVideo(); fetchNeighbors(); }, [fetchVideo, fetchNeighbors]);

  // ── Deep-link: ?clip_id=<id> ─────────────────
  // Navigates to the referenced clip and strips the param.

  useEffect(() => {
    if (deepLinkRef.current) return;
    const clipId = searchParams.get('clip_id');
    if (!clipId) return;
    deepLinkRef.current = true;
    const numId = parseInt(clipId, 10);
    if (!numId || isNaN(numId)) {
      addToast('Clip not found', 'error');
      setSearchParams(prev => { const n = new URLSearchParams(prev); n.delete('clip_id'); return n; }, { replace: true });
      return;
    }
    if (String(numId) !== id) {
      // Navigate to the targeted clip
      navigate(`/dash-cameras/${numId}`, { replace: true });
      return;
    }
    // Same page — just strip param and toast
    setSearchParams(prev => { const n = new URLSearchParams(prev); n.delete('clip_id'); return n; }, { replace: true });
    addToast(`Clip #${numId} loaded`, 'info');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // ── Mapbox Map ───────────────────────────────

  useEffect(() => {
    if (!mapSectionOpen || !mapContainerRef.current || mapRef.current) return;
    if (!mapboxgl || !mapboxgl.accessToken) return;

    const centerLng = telemetry
      ? telemetry.lng
      : video?.longitude
        ? video.longitude
        : -111.89;
    const centerLat = telemetry
      ? telemetry.lat
      : video?.latitude
        ? video.latitude
        : 40.76;

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: MAPBOX_STYLE_DARK,
      center: [centerLng, centerLat],
      zoom: 15,
      projection: 'mercator',
    });
    map.on('style.load', () => applyRmpgBasemap(map, { variant: 'dark' }));

    mapRef.current = map;

    // Rebuild in place if the GPU drops the context. The load handler below
    // re-adds the marker + GPS-track layer, so a rebuild fully restores.
    mapRecoveryCleanupRef.current = installWebglContextRecovery(map, {
      label: 'DashCamDetail',
      onRebuild: () => {
        setIsMapRecovering(false);
        setMapNeedsManualReload(false);
        if (mapRecoveryCleanupRef.current) { mapRecoveryCleanupRef.current(); mapRecoveryCleanupRef.current = null; }
        try { markerRef.current?.remove(); } catch { /* gone */ }
        markerRef.current = null;
        if (mapRef.current) { try { mapRef.current.remove(); } catch { /* gone */ } mapRef.current = null; }
        setMapReady(false);
        setMapRecoverNonce((n) => n + 1);
      },
      onContextLost: () => setIsMapRecovering(true),
      onContextRestored: () => setIsMapRecovering(false),
      onGiveUp: () => { setIsMapRecovering(false); setMapNeedsManualReload(true); },
    });

    map.on('load', () => {
      // Marker
      const marker = new mapboxgl.Marker({
        color: '#8a9bb8',
      })
        .setLngLat([centerLng, centerLat])
        .addTo(map);
      markerRef.current = marker;

      // Route polyline from GPS track
      if (gpsTrack && gpsTrack.length > 1) {
        const coords = gpsTrack.map(p => [p.longitude, p.latitude] as [number, number]);
        map.addSource('gps-track', {
          type: 'geojson',
          data: {
            type: 'Feature',
            properties: {},
            geometry: { type: 'LineString', coordinates: coords },
          },
        });
        map.addLayer({
          id: 'gps-track-line',
          type: 'line',
          source: 'gps-track',
          paint: {
            // Night-theme literal for --text-muted (#8fa3b8). Mapbox paint
            // properties don't resolve CSS variables — the layer fails to
            // add at all if we pass one, so we use the literal here.
            'line-color': '#8fa3b8',
            'line-opacity': 0.5,
            'line-width': 2,
          },
        });

        // Fit bounds to track
        const bounds = new mapboxgl.LngLatBounds();
        coords.forEach(c => bounds.extend(c));
        map.fitBounds(bounds, { padding: 20 });
      }

      setMapReady(true);
    });
  }, [mapSectionOpen, video, gpsTrack, mapRecoverNonce]);

  // Tear down the map + recovery listener on unmount
  useEffect(() => () => {
    if (mapRecoveryCleanupRef.current) { mapRecoveryCleanupRef.current(); mapRecoveryCleanupRef.current = null; }
    try { markerRef.current?.remove(); } catch { /* gone */ }
    markerRef.current = null;
    if (mapRef.current) { try { mapRef.current.remove(); } catch { /* gone */ } mapRef.current = null; }
  }, []);

  // Update marker position during playback
  useEffect(() => {
    if (!mapReady || !markerRef.current || !telemetry) return;
    const lngLat: [number, number] = [telemetry.lng, telemetry.lat];
    markerRef.current.setLngLat(lngLat);
    if (isPlaying) {
      mapRef.current?.panTo(lngLat);
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

  const handleBurnConfirmed = async () => {
    if (!video) return;
    setBurning(true);
    try {
      await apiFetch(`/fleet/dashcam-videos/${video.id}/burn`, { method: 'POST' });
      addToast('HUD burn started', 'success');
      setBurnConfirmOpen(false);
      fetchVideo();
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Burn failed', 'error');
    } finally {
      setBurning(false);
    }
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

      // Esc cascade: burnConfirm → editModal → fullscreen → back
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (burnConfirmOpen) { setBurnConfirmOpen(false); return; }
        if (editingVideo) { setEditingVideo(null); return; }
        if (isFullscreen) { toggleFullscreen(); return; }
        navigate(-1);
        return;
      }

      // N shortcut — primary action: trigger download of original clip
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        downloadRef.current?.click();
        return;
      }

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
  }, [
    togglePlayPause, skip, toggleFullscreen, setSpeed,
    burnConfirmOpen, editingVideo, isFullscreen, navigate,
    playbackRate,
  ]);

  // ── Derived Values ───────────────────────────

  const liveSpeed = telemetry?.speedMph ?? null;
  const speedClass = liveSpeed !== null ? speedColorClass(liveSpeed) : '';
  const vehDesc = video ? [video.vehicle_year, video.vehicle_make, video.vehicle_model].filter(Boolean).join(' ') : '';
  const links: any[] = video?.links || [];
  const incidentLink = links.find((l: any) => l.entity_type === 'call');
  const otherLinks = links.filter((l: any) => l.entity_type !== 'call');

  // ── Loading / Error / Empty States ──────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center" style={{ height: 'calc(100dvh - 120px)' }}>
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-6 h-6 animate-spin text-brand-400" role="status" aria-label="Loading" />
          <span className="text-[11px] text-rmpg-400">Loading video&hellip;</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center" style={{ height: 'calc(100dvh - 120px)' }}>
        <div className="text-center">
          <AlertTriangle className="w-8 h-8 text-red-400 mx-auto mb-2" />
          <p className="text-xs text-rmpg-400 mb-1">{error}</p>
          <p className="text-[10px] text-rmpg-500 mb-3">The video could not be loaded.</p>
          <button type="button" onClick={() => navigate('/dash-cameras')}
            className="toolbar-btn text-[10px] px-4 py-1.5 inline-flex items-center gap-1">
            <ChevronLeft className="w-3 h-3" /> Back to Gallery
          </button>
        </div>
      </div>
    );
  }

  if (!video) {
    return (
      <div className="flex items-center justify-center" style={{ height: 'calc(100dvh - 120px)' }}>
        <div className="text-center">
          <Video className="w-8 h-8 text-rmpg-500 mx-auto mb-2" />
          <p className="text-xs text-rmpg-400 mb-3">No video found for this ID.</p>
          <button type="button" onClick={() => navigate('/dash-cameras')}
            className="toolbar-btn text-[10px] px-4 py-1.5 inline-flex items-center gap-1">
            <ChevronLeft className="w-3 h-3" /> Back to Gallery
          </button>
        </div>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────

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
              <span className="text-rmpg-400 font-bold tracking-wide">
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
              className="text-rmpg-400 hover:text-rmpg-100 transition-colors p-0.5" title="Toggle panel (I)">
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
              {formatEnumValue(video.classification)}
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
          <input id="ff-dashcamdetailpage-0" type="range" min="0" max="1" step="0.05"
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
          <div className="flex-1 min-h-0 overflow-y-auto">

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
                        {toDisplayLabel(video.unit_status || '').toUpperCase()}
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
              <div className="relative w-full rounded-sm" style={{ height: 200 }}>
                <div ref={mapContainerRef}
                  className="absolute inset-0 rounded-sm"
                  style={{ background: 'var(--surface-deep)' }}>
                  {!mapboxgl?.accessToken && (
                    <div className="flex items-center justify-center h-full">
                      <span className="text-[9px] text-rmpg-500">Maps unavailable</span>
                    </div>
                  )}
                </div>
                {isMapRecovering && (
                  <div className="absolute inset-0 z-50 flex items-center justify-center bg-surface-base/80 pointer-events-none rounded-sm">
                    <div className="flex flex-col items-center gap-1">
                      <Loader2 size={14} className="animate-spin text-brand-400" />
                      <span className="text-[9px] font-mono text-rmpg-300">MAP RECONNECTING…</span>
                    </div>
                  </div>
                )}
                {mapNeedsManualReload && (
                  <div className="absolute inset-0 z-50 flex items-center justify-center bg-surface-base/90 rounded-sm">
                    <div className="flex flex-col items-center gap-2 text-center px-3">
                      <span className="text-rmpg-100 text-[10px] font-mono">MAP GPU CRASH</span>
                      <button onClick={() => window.location.reload()} className="px-2 py-1 bg-brand-600 hover:bg-brand-500 text-white text-[9px] font-mono" style={{ borderRadius: 2 }}>
                        RELOAD
                      </button>
                    </div>
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
                      <span className="text-[11px] text-rmpg-200">{toDisplayLabel(incidentLink.incident_type || '')}</span>
                    </div>
                  )}
                  {incidentLink.status && (
                    <div>
                      <span className="text-[9px] text-rmpg-500 uppercase block">Status</span>
                      <span className="text-[11px] text-rmpg-200 capitalize">{toDisplayLabel(incidentLink.status || '')}</span>
                    </div>
                  )}
                  {incidentLink.disposition && (
                    <div>
                      <span className="text-[9px] text-rmpg-500 uppercase block">Disposition</span>
                      <span className="text-[11px] text-rmpg-200">{toDisplayLabel(incidentLink.disposition || '').toUpperCase()}</span>
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
                      {formatEnumValue(video.classification)}
                    </span>
                    {/* Role gate: admin/manager only may reclassify */}
                    {isAdminOrManager && (
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
                      <span className="text-rmpg-500 uppercase font-mono text-[9px]">{toDisplayLabel(link.entity_type)}</span>
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
          <div className="border-t border-border-subtle p-2 space-y-1.5" style={{ background: 'var(--surface-raised)' }}>
            {/* File info */}
            <div className="flex items-center justify-between text-[9px] text-rmpg-500 font-mono mb-1">
              <span>{formatSize(video.file_size)}</span>
              <span>{formatDuration(video.duration_seconds)}</span>
            </div>

            {/* Role gate: admin/manager only for burn */}
            {isAdminOrManager && (
              <button type="button" onClick={() => setBurnConfirmOpen(true)}
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

            {/* Hidden anchor target for N-shortcut — same href as the visible button below */}
            {/* eslint-disable-next-line jsx-a11y/anchor-has-content */}
            <a ref={downloadRef} href={streamUrl} download aria-hidden="true" tabIndex={-1} className="sr-only" />

            <a href={streamUrl} download
              className="toolbar-btn text-[10px] w-full py-1.5 flex items-center justify-center gap-1.5 no-underline"
              title="Download original (N)">
              <Download className="w-3.5 h-3.5" /> Download Original
            </a>

            {video.burned_file_path && (
              <a href={`${apiBase}/fleet/dashcam-videos/${video.id}/download-burned?token=${encodeURIComponent(localStorage.getItem('rmpg_token') || '')}`}
                download
                className="toolbar-btn toolbar-btn-primary text-[10px] w-full py-1.5 flex items-center justify-center gap-1.5 no-underline">
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

      {/* ── Burn HUD Confirm Dialog ── */}
      <ConfirmDialog
        isOpen={burnConfirmOpen}
        onClose={() => setBurnConfirmOpen(false)}
        onConfirm={handleBurnConfirmed}
        title="Burn HUD Overlay"
        message="This will permanently burn the on-screen HUD overlay (GPS, speed, timestamp, unit) into a new copy of the video. The original is preserved. Continue?"
        details={
          <>
            <div>Clip: {video.unit_call_sign || '—'} &middot; {formatDate(video.recorded_at)}</div>
            {video.case_number && <div>Case #: {video.case_number}</div>}
          </>
        }
        confirmLabel="Start Burn"
        confirmVariant="warning"
        isLoading={burning}
      />
    </div>
  );
}
