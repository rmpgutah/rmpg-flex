// ============================================================
// RMPG Flex — Dash Camera Video Player Modal
// Police MVR evidence overlay with bottom evidence strip,
// agency watermark, and REC LED — matching real Axon Fleet /
// Motorola 4RE / WatchGuard burned-in overlay patterns.
//
// When a GPS track is available (ClearPathGPS synced clips),
// all telemetry updates second-by-second during playback.
// ============================================================

import React, { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import { X, Maximize2, Minimize2, Edit2 } from 'lucide-react';
import type { DashCamVideo } from '../types';

// ── GPS Track Types ─────────────────────────────────────────

interface GpsPoint {
  latitude: number;
  longitude: number;
  speed: number;
  altitude: number;
  timestamp: number;
  accuracy?: number | null;
  bearing?: number | null;
}

interface LiveTelemetry {
  lat: number;
  lng: number;
  speedMph: number;
  altitude: number;
  bearing: number | null;
}

// ── Props ───────────────────────────────────────────────────

interface Props {
  isOpen: boolean;
  onClose: () => void;
  video: DashCamVideo | null;
  apiBase: string;
  getAuthHeaders: () => Record<string, string>;
  onEditVideo?: (video: DashCamVideo) => void;
}

// ── Constants & Helpers ─────────────────────────────────────

const KMH_TO_MPH = 0.621371;

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function parseGpsTrack(raw?: string | null): GpsPoint[] | null {
  if (!raw) return null;
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr) || arr.length === 0) return null;
    return arr.sort((a: GpsPoint, b: GpsPoint) => a.timestamp - b.timestamp);
  } catch { return null; }
}

function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }

function interpolateTelemetry(track: GpsPoint[], sec: number): LiveTelemetry | null {
  if (!track.length) return null;
  const startMs = track[0].timestamp;
  const target = startMs + sec * 1000;
  if (target <= track[0].timestamp) { const p = track[0]; return { lat: p.latitude, lng: p.longitude, speedMph: Math.round(p.speed * KMH_TO_MPH), altitude: p.altitude, bearing: p.bearing ?? null }; }
  const last = track[track.length - 1];
  if (target >= last.timestamp) return { lat: last.latitude, lng: last.longitude, speedMph: Math.round(last.speed * KMH_TO_MPH), altitude: last.altitude, bearing: last.bearing ?? null };
  for (let i = 0; i < track.length - 1; i++) {
    const a = track[i], b = track[i + 1];
    if (target >= a.timestamp && target <= b.timestamp) {
      const t = (b.timestamp - a.timestamp) > 0 ? (target - a.timestamp) / (b.timestamp - a.timestamp) : 0;
      return { lat: lerp(a.latitude, b.latitude, t), lng: lerp(a.longitude, b.longitude, t), speedMph: Math.round(lerp(a.speed, b.speed, t) * KMH_TO_MPH), altitude: Math.round(lerp(a.altitude, b.altitude, t)), bearing: a.bearing != null && b.bearing != null ? Math.round(lerp(a.bearing, b.bearing, t)) : (a.bearing ?? b.bearing ?? null) };
    }
  }
  return null;
}

const MAX_GEOCODE_CACHE = 500;
const geocodeCache = new Map<string, string>();
function cacheKey(lat: number, lng: number): string { return `${lat.toFixed(4)},${lng.toFixed(4)}`; }
/** LRU-style eviction: when cache exceeds limit, drop oldest half */
function geocodeCacheSet(key: string, value: string): void {
  geocodeCache.set(key, value);
  if (geocodeCache.size > MAX_GEOCODE_CACHE) {
    const toDelete = Math.floor(MAX_GEOCODE_CACHE / 2);
    let count = 0;
    for (const k of geocodeCache.keys()) {
      if (count++ >= toDelete) break;
      geocodeCache.delete(k);
    }
  }
}

// ── Component ───────────────────────────────────────────────

export default function DashCamVideoPlayer({ isOpen, onClose, video, apiBase, getAuthHeaders, onEditVideo }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [hudVisible, setHudVisible] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [liveAddress, setLiveAddress] = useState<string | null>(null);
  const lastGeocodedPos = useRef<{ lat: number; lng: number } | null>(null);
  const geocoderRef = useRef<google.maps.Geocoder | null>(null);
  const geocodeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const gpsTrack = useMemo(() => parseGpsTrack(video?.cpg_gps_track), [video?.cpg_gps_track]);
  const liveTelemetry = useMemo(() => gpsTrack ? interpolateTelemetry(gpsTrack, currentTime) : null, [gpsTrack, currentTime]);

  useEffect(() => { setLiveAddress(null); lastGeocodedPos.current = null; }, [video?.id]);

  const reverseGeocode = useCallback((lat: number, lng: number) => {
    const key = cacheKey(lat, lng);
    const cached = geocodeCache.get(key);
    if (cached) { setLiveAddress(cached); lastGeocodedPos.current = { lat, lng }; return; }
    if (typeof google === 'undefined' || !google.maps) return;
    if (!geocoderRef.current) geocoderRef.current = new google.maps.Geocoder();
    geocoderRef.current.geocode({ location: { lat, lng } }, (results, status) => {
      if (status === 'OK' && results?.[0]) {
        const c = results[0].address_components;
        const num = c?.find(x => x.types.includes('street_number'))?.short_name || '';
        const route = c?.find(x => x.types.includes('route'))?.short_name || '';
        const city = c?.find(x => x.types.includes('locality'))?.short_name || '';
        let addr = num && route ? `${num} ${route}` : route || (results[0].formatted_address || '').split(',')[0];
        if (city) addr += `, ${city}`;
        geocodeCacheSet(key, addr);
        setLiveAddress(addr);
        lastGeocodedPos.current = { lat, lng };
      }
    });
  }, []);

  useEffect(() => {
    if (!liveTelemetry) return;
    const { lat, lng } = liveTelemetry;
    const prev = lastGeocodedPos.current;
    if (!prev || haversineMeters(prev.lat, prev.lng, lat, lng) > 50) {
      if (geocodeTimerRef.current) clearTimeout(geocodeTimerRef.current);
      geocodeTimerRef.current = setTimeout(() => reverseGeocode(lat, lng), 300);
    }
    return () => { if (geocodeTimerRef.current) clearTimeout(geocodeTimerRef.current); };
  }, [liveTelemetry?.lat, liveTelemetry?.lng, reverseGeocode]);

  useEffect(() => {
    const vid = videoRef.current;
    if (!vid) return;
    const onTime = () => setCurrentTime(vid.currentTime);
    vid.addEventListener('timeupdate', onTime);
    return () => vid.removeEventListener('timeupdate', onTime);
  }, [isOpen, video]);

  if (!isOpen || !video) return null;

  // ── Format helpers ──────────────────────────────────────────

  const formatHudTime = (seconds: number) => {
    const d = video.recorded_at ? new Date(video.recorded_at) : new Date();
    const p = new Date(d.getTime() + seconds * 1000);
    return p.toLocaleString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).replace(',', '');
  };

  const formatDuration = (s?: number) => {
    if (!s) return '--:--';
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
  };

  const formatSize = (b: number) => {
    if (!b) return '-';
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
    if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
    return `${(b / 1024 ** 3).toFixed(2)} GB`;
  };

  const formatAlt = (m: number) => `${Math.round(m * 3.28084).toLocaleString()}'`;

  // ── Derived values ──────────────────────────────────────────

  const headers = getAuthHeaders();
  const token = headers['Authorization']?.replace('Bearer ', '') || '';
  const streamUrl = `${apiBase}/fleet/dashcam-videos/${video.id}/stream?token=${encodeURIComponent(token)}`;
  const vehDesc = [video.vehicle_year, video.vehicle_make, video.vehicle_model].filter(Boolean).join(' ');
  const displaySpeed = liveTelemetry?.speedMph ?? video.speed_mph;
  const displayLat = liveTelemetry?.lat ?? video.latitude;
  const displayLng = liveTelemetry?.lng ?? video.longitude;
  const displayAddress = liveAddress ?? video.address;
  const hasLiveGps = gpsTrack !== null && gpsTrack.length > 1;

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) containerRef.current.requestFullscreen().then(() => setIsFullscreen(true)).catch((err) => { console.warn('[DashCamVideoPlayer] enter fullscreen failed:', err); });
    else document.exitFullscreen().then(() => setIsFullscreen(false)).catch((err) => { console.warn('[DashCamVideoPlayer] exit fullscreen failed:', err); });
  };

  // Speed → color + subtle background for evidence strip
  const spdClr = displaySpeed == null ? '#6b7280' : displaySpeed > 80 ? '#f87171' : displaySpeed > 60 ? '#fbbf24' : '#4ade80';
  const speedBg = (mph: number | null | undefined): string => {
    if (mph == null) return '';
    if (mph > 80) return 'bg-red-500/10';
    if (mph > 60) return 'bg-amber-500/10';
    return '';
  };

  // ── Render ────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/95" role="dialog" aria-modal="true" onClick={onClose}>
      <div
        ref={containerRef}
        className={`bg-black overflow-hidden ${isFullscreen ? 'w-full h-full' : 'w-[960px] max-h-[92vh]'}`}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header Bar ── */}
        <div className="flex items-center justify-between h-7 px-2 bg-[var(--surface-sunken)] border-b border-[#1e3048]">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[9px] font-mono font-bold text-amber-500/80 uppercase tracking-widest truncate">
              {video.title}
            </span>
            {video.unit_call_sign && (
              <span className="text-[8px] font-mono font-bold text-white/30">
                [{video.unit_call_sign}]
              </span>
            )}
            {hasLiveGps && (
              <span className="flex items-center gap-1 text-[8px] font-mono text-green-400/60 font-bold tracking-wider">
                <span className="led-dot led-green animate-led-pulse" style={{ width: 5, height: 5 }} />
                LIVE GPS
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => setHudVisible(!hudVisible)} className="toolbar-btn h-5 flex items-center gap-1">
              <span className={`led-dot ${hudVisible ? 'led-green' : 'led-off'}`} style={{ width: 5, height: 5 }} />
              <span className="text-[8px]">HUD</span>
            </button>
            {onEditVideo && (
              <button type="button" onClick={() => onEditVideo(video)} className="toolbar-btn h-5 px-1">
                <Edit2 className="w-3 h-3" />
              </button>
            )}
            <button type="button" onClick={toggleFullscreen} className="toolbar-btn h-5 px-1">
              {isFullscreen ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
            </button>
            <button type="button" onClick={onClose} className="toolbar-btn h-5 px-1" aria-label="Close" title="Close">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* ── Video + Tactical HUD ── */}
        <div className="relative bg-black">
          <video ref={videoRef} controls autoPlay className="w-full max-h-[75vh]" src={streamUrl}>
            Your browser does not support the video tag.
          </video>

          {hudVisible && (
            <div className="absolute inset-0 pointer-events-none select-none">

              {/* ── Top-left: Agency Watermark (burned-in text, no box) ── */}
              <p className="absolute top-3 left-4 font-mono text-[10px] text-white/40 uppercase tracking-[0.15em] leading-none"
                 style={{ textShadow: '0 0 6px rgba(0,0,0,1), 0 1px 8px rgba(0,0,0,0.9)' }}>
                ROCKY MOUNTAIN PROTECTIVE GROUP
              </p>

              {/* ── Top-right: REC indicator + Case (raw LED, no box) ── */}
              <div className="absolute top-3 right-4 flex items-center gap-1.5"
                   style={{ textShadow: '0 0 6px rgba(0,0,0,1), 0 1px 8px rgba(0,0,0,0.9)' }}>
                <span className="led-dot led-red animate-led-blink" style={{ width: 6, height: 6 }} />
                <span className="font-mono text-[11px] text-red-400 font-bold tracking-[0.15em]">REC</span>
                {video.case_number && (
                  <>
                    <span className="text-white/20 mx-0.5">│</span>
                    <span className="font-mono text-[10px] text-white/40 tracking-wider">CASE: {video.case_number}</span>
                  </>
                )}
              </div>

              {/* ── Bottom: Evidence Strip (full-width, 2-row, solid) ── */}
              <div className={`absolute left-0 right-0 ${isFullscreen ? 'bottom-14' : 'bottom-10'} bg-black/90 border-t border-[#1e3048]`}>
                {/* Row 1 — Primary evidence data */}
                <div className="flex items-center h-6 divide-x divide-[#1e3048]">
                  {/* Timestamp */}
                  <div className="px-2 font-mono text-[11px] text-white/80 font-bold tabular-nums tracking-wider whitespace-nowrap">
                    {formatHudTime(currentTime)}
                  </div>
                  {/* Speed */}
                  <div className={`px-3 font-mono tabular-nums flex items-baseline gap-1 ${speedBg(displaySpeed)}`}>
                    <span className="text-[13px] font-black" style={{ color: spdClr }}>{displaySpeed ?? '--'}</span>
                    <span className="text-[9px] font-bold tracking-widest" style={{ color: `${spdClr}80` }}>MPH</span>
                  </div>
                  {/* Coordinates + GPS LED */}
                  <div className="px-2 font-mono text-[10px] text-green-400/90 font-bold tabular-nums tracking-wide flex items-center gap-1 whitespace-nowrap">
                    {displayLat != null && displayLng != null ? (
                      <>
                        {Math.abs(displayLat).toFixed(4)}{displayLat >= 0 ? 'N' : 'S'}
                        <span className="text-white/15">/</span>
                        {Math.abs(displayLng).toFixed(4)}{displayLng >= 0 ? 'E' : 'W'}
                        {hasLiveGps && (
                          <span className="led-dot led-green animate-led-pulse ml-0.5" style={{ width: 5, height: 5 }} />
                        )}
                      </>
                    ) : (
                      <span className="text-white/20">NO GPS</span>
                    )}
                  </div>
                  {/* Unit */}
                  <div className="px-2 font-mono text-[11px] text-amber-500/80 font-bold tracking-wider whitespace-nowrap">
                    UNIT {video.unit_call_sign || '--'}
                  </div>
                </div>

                {/* Row 2 — Secondary context */}
                <div className="flex items-center h-5 divide-x divide-[#1e3048] border-t border-[#1e3048]/50">
                  {/* Vehicle */}
                  <div className="flex-1 px-2 font-mono text-[9px] text-white/40 tracking-wider truncate">
                    VEH #{video.vehicle_number || '--'} {vehDesc}
                  </div>
                  {/* Altitude */}
                  <div className="px-2 font-mono text-[9px] text-white/40 tabular-nums whitespace-nowrap">
                    ALT: {liveTelemetry?.altitude != null ? formatAlt(liveTelemetry.altitude) : '--'}
                  </div>
                  {/* Address */}
                  <div className="flex-1 px-2 font-mono text-[9px] text-white/40 truncate">
                    {displayAddress ? displayAddress.toUpperCase() : '--'}
                  </div>
                  {/* GPS status LED */}
                  <div className="px-2 font-mono text-[9px] text-white/40 flex items-center gap-1 whitespace-nowrap">
                    <span className={`led-dot ${hasLiveGps ? 'led-green' : 'led-off'}`} style={{ width: 5, height: 5 }} />
                    GPS
                  </div>
                </div>
              </div>

              {/* ── Subtle scan lines (cosmetic) ── */}
              <div className="absolute inset-0 opacity-[0.03]"
                   style={{
                     backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.03) 2px, rgba(255,255,255,0.03) 4px)',
                     pointerEvents: 'none',
                   }} />
            </div>
          )}
        </div>

        {/* ── Metadata Bar (below video) ── */}
        <div className="panel-inset bg-[var(--surface-sunken)]">
          {/* Primary data row */}
          <div className="flex items-center h-6 divide-x divide-[#1e3048]">
            <span className="px-2 text-[9px] font-mono text-white/30 uppercase tracking-wider">
              <span className="text-white/15 mr-1">VEH</span>
              <span className="text-white/50">{video.vehicle_number ? `#${video.vehicle_number}` : '--'}</span>
              {vehDesc && <span className="text-white/20 ml-1">{vehDesc}</span>}
            </span>
            <span className="px-2 text-[9px] font-mono uppercase tracking-wider">
              <span className="text-white/15 mr-1">UNIT</span>
              <span className="text-amber-500/60 font-bold">{video.unit_call_sign || '--'}</span>
            </span>
            <span className="px-2 text-[9px] font-mono uppercase tracking-wider">
              <span className="text-white/15 mr-1">DUR</span>
              <span className="text-white/50 tabular-nums">{formatDuration(video.duration_seconds)}</span>
            </span>
            <span className="px-2 text-[9px] font-mono uppercase tracking-wider">
              <span className="text-white/15 mr-1">SIZE</span>
              <span className="text-white/50">{formatSize(video.file_size)}</span>
            </span>
            {video.cpg_channel && (
              <span className="px-2 text-[9px] font-mono uppercase tracking-wider">
                <span className="text-white/15 mr-1">CAM</span>
                <span className="text-white/50">{video.cpg_channel}</span>
              </span>
            )}
            <span className="px-2 text-[9px] font-mono uppercase tracking-wider ml-auto">
              <span className="text-white/15 mr-1">REC</span>
              <span className="text-white/50">
                {video.recorded_at ? new Date(video.recorded_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '--'}
              </span>
            </span>
          </div>

          {/* Detail lines */}
          {(displayAddress || video.notes || hasLiveGps) && (
            <div className="px-2 pb-1.5 space-y-0.5 border-t border-[#1e3048]/50">
              {displayAddress && (
                <div className="flex items-center gap-1 text-[8px] font-mono text-white/25 pt-1">
                  <span className="text-white/12">LOC</span>
                  <span className="text-white/40 truncate">{displayAddress}</span>
                  {liveAddress && hasLiveGps && (
                    <span className="text-green-500/40 flex items-center gap-0.5 shrink-0">
                      <span className="led-dot led-green animate-led-pulse" style={{ width: 4, height: 4 }} /> LIVE
                    </span>
                  )}
                </div>
              )}
              {video.notes && (
                <p className="text-[8px] font-mono text-white/20 italic truncate">{video.notes}</p>
              )}
              {hasLiveGps && (
                <div className="flex items-center gap-1 text-[7px] font-mono text-green-500/30">
                  <span className="led-dot led-green animate-led-pulse" style={{ width: 4, height: 4 }} />
                  GPS TELEMETRY — {gpsTrack?.length ?? 0} PTS — LIVE
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
