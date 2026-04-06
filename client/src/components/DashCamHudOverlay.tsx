// ============================================================
// RMPG Flex — Dash Camera HUD Overlay (Simple)
// ============================================================
// Clean two-bar overlay rendered over the <video> element.
// Top bar:  Date/time · Officer · Unit/Vehicle
// Bottom bar:  Speed · GPS · Address
// Plus a small REC dot in the top-right corner.
//
// All monospace, semi-transparent black backgrounds, minimal.
// Timestamp ticks in real-time synced to video playback.
// ============================================================

import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { DashCamVideo as DashcamVideo } from '../types';

// ── Helpers ──────────────────────────────────────────────

function formatHudTimestamp(baseDate: string | null | undefined, offsetSec: number): string {
  const base = baseDate ? new Date(baseDate) : new Date();
  const ts = new Date(base.getTime() + offsetSec * 1000);
  const mm = String(ts.getMonth() + 1).padStart(2, '0');
  const dd = String(ts.getDate()).padStart(2, '0');
  const yy = ts.getFullYear();
  const hh = String(ts.getHours()).padStart(2, '0');
  const mi = String(ts.getMinutes()).padStart(2, '0');
  const ss = String(ts.getSeconds()).padStart(2, '0');
  return `${mm}/${dd}/${yy} ${hh}:${mi}:${ss}`;
}

function headingToCompass(deg: number | null | undefined): string {
  if (deg == null) return '';
  const dirs = ['N','NE','E','SE','S','SW','W','NW'];
  return dirs[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
}

// ── Props ────────────────────────────────────────────────

interface Props {
  video: DashcamVideo;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  isPlaying: boolean;
}

// ── Component ────────────────────────────────────────────

export default function DashCamHudOverlay({ video, videoRef, isPlaying }: Props) {
  const [currentTime, setCurrentTime] = useState(0);
  const [recVisible, setRecVisible] = useState(true);
  const rafRef = useRef<number>(0);

  // Sync overlay clock with video currentTime
  const tick = useCallback(() => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
    rafRef.current = requestAnimationFrame(tick);
  }, [videoRef]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [tick]);

  // Pulsing REC dot
  useEffect(() => {
    if (!isPlaying) { setRecVisible(true); return; }
    const id = setInterval(() => setRecVisible(v => !v), 700);
    return () => clearInterval(id);
  }, [isPlaying]);

  // Derived values
  const timestamp = formatHudTimestamp(video.recorded_at, currentTime);
  const officer = video.officer_name || '';
  const unit = video.call_sign || video.device_name || '';
  const speed = video.speed_mph;
  const compass = headingToCompass(video.heading);
  const lat = video.latitude != null ? video.latitude.toFixed(5) : '';
  const lng = video.longitude != null ? video.longitude.toFixed(5) : '';
  const gps = lat && lng ? `${lat}, ${lng}` : '';
  const addr = video.address || '';

  // Font style shared by both bars
  const font = { fontFamily: "'Consolas', 'Monaco', 'Courier New', monospace" };

  return (
    <div className="absolute inset-0 pointer-events-none select-none z-10" style={font}>

      {/* ── TOP BAR ─────────────────────────────────────── */}
      <div className="absolute top-0 left-0 right-0 bg-black/60 px-3 py-1.5 flex items-center justify-between">
        {/* Left: timestamp */}
        <span className="text-[11px] text-white font-bold tracking-wide" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {timestamp}
        </span>

        {/* Center: officer + unit */}
        <div className="flex items-center gap-4">
          {officer && (
            <span className="text-[10px] text-white/90">{officer}</span>
          )}
          {unit && (
            <span className="text-[10px] text-amber-400 font-bold">{unit}</span>
          )}
        </div>

        {/* Right: REC indicator */}
        <div className="flex items-center gap-1.5">
          {isPlaying ? (
            <>
              <div className={`w-2 h-2 rounded-full bg-red-500 ${recVisible ? 'opacity-100' : 'opacity-20'}`} />
              <span className="text-[9px] text-red-400 font-bold tracking-wider">REC</span>
            </>
          ) : (
            <span className="text-[9px] text-white/40 tracking-wider">PAUSED</span>
          )}
        </div>
      </div>

      {/* ── BOTTOM BAR ──────────────────────────────────── */}
      <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-3 py-1.5 flex items-center justify-between">
        {/* Left: speed */}
        <div className="flex items-center gap-1">
          {speed != null ? (
            <span className={`text-[11px] font-bold ${
              speed > 80 ? 'text-red-400' : speed > 60 ? 'text-amber-300' : 'text-white'
            }`} style={{ fontVariantNumeric: 'tabular-nums' }}>
              {speed} MPH
            </span>
          ) : (
            <span className="text-[11px] text-white/40">-- MPH</span>
          )}
          {compass && (
            <span className="text-[10px] text-white/50 ml-2">{compass}</span>
          )}
        </div>

        {/* Center: address */}
        {addr && (
          <span className="text-[9px] text-white/70 truncate max-w-[50%] text-center">
            {addr}
          </span>
        )}

        {/* Right: GPS coordinates */}
        {gps ? (
          <span className="text-[10px] text-white/60" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {gps}
          </span>
        ) : (
          <span className="text-[10px] text-white/30">NO GPS</span>
        )}
      </div>
    </div>
  );
}
