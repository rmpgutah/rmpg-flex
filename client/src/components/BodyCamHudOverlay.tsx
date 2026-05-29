// ============================================================
// RMPG Flex — Body Worn Camera HUD Overlay
// ============================================================
// Minimal overlay for BWC footage. Unlike dashcam overlays,
// there is no vehicle telemetry (no speed, GPS, heading).
// Shows chain-of-custody essentials + interaction context:
//
//   Top:     BWC label · Camera serial · Interaction type · REC
//   Bottom:  Date/time (ticking) · Officer · Case # + classification
//
// Monospace text on semi-transparent bars, pointer-events-none.
// ============================================================

import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { BodyCamVideo } from '../types';
import { parseTimestamp } from '../utils/dateUtils';

// ── Helpers ──────────────────────────────────────────────

function formatHudTimestamp(baseDate: string | null, offsetSec: number): string {
  const base = baseDate ? parseTimestamp(baseDate) : new Date();
  const ts = new Date(base.getTime() + offsetSec * 1000);
  const mm = String(ts.getMonth() + 1).padStart(2, '0');
  const dd = String(ts.getDate()).padStart(2, '0');
  const yy = ts.getFullYear();
  const hh = String(ts.getHours()).padStart(2, '0');
  const mi = String(ts.getMinutes()).padStart(2, '0');
  const ss = String(ts.getSeconds()).padStart(2, '0');
  return `${mm}/${dd}/${yy} ${hh}:${mi}:${ss}`;
}

function interactionLabel(type: string | null | undefined): string {
  if (!type) return '';
  return type.replace(/_/g, ' ').toUpperCase();
}

/** Color for the interaction type badge — severity-based */
function interactionColor(type: string | null | undefined): string {
  if (!type) return '';
  switch (type) {
    case 'use_of_force':
    case 'foot_pursuit':
    case 'vehicle_pursuit':
      return 'bg-red-500/80 text-white';
    case 'arrest':
    case 'search_warrant':
    case 'domestic_violence':
      return 'bg-amber-500/80 text-black';
    case 'evidence_collection':
    case 'interview':
      return 'bg-purple-500/70 text-white';
    case 'traffic_stop':
    case 'welfare_check':
    case 'community_contact':
    case 'field_training':
    default:
      return 'bg-[#888888]/70 text-white';
  }
}

/** Classification badge styling */
function classificationStyle(cls: string | null | undefined): string {
  switch (cls) {
    case 'evidence': return 'text-amber-400';
    case 'flagged': return 'text-red-400';
    case 'restricted': return 'text-red-300';
    default: return 'text-white/40';
  }
}

// ── Props ────────────────────────────────────────────────

interface Props {
  video: BodyCamVideo;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  isPlaying: boolean;
}

// ── Component ────────────────────────────────────────────

export default function BodyCamHudOverlay({ video, videoRef, isPlaying }: Props) {
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

  const timestamp = formatHudTimestamp(video.recorded_at, currentTime);
  const officer = video.officer_name || '';
  const camera = video.camera_serial || '';
  const caseNum = video.case_number || '';
  const interaction = video.interaction_type || null;
  const classification = video.classification || 'routine';
  const font = { fontFamily: "'Consolas', 'Monaco', 'Courier New', monospace" };

  return (
    <div className="absolute inset-0 pointer-events-none select-none z-10" style={font}>

      {/* ── TOP BAR — Camera serial + Interaction + REC ── */}
      <div className="absolute top-0 left-0 right-0 bg-black/55 px-3 py-1.5 flex items-center justify-between">
        {/* Left: BWC label + camera serial */}
        <div className="flex items-center gap-2">
          <span className="text-[9px] text-white/40 tracking-wider">BWC</span>
          {camera && (
            <span className="text-[10px] text-white/80">{camera}</span>
          )}
        </div>

        {/* Center: interaction type badge */}
        {interaction && (
          <span className={`text-[8px] font-bold tracking-wider px-1.5 py-0.5 rounded-sm ${interactionColor(interaction)}`}>
            {interactionLabel(interaction)}
          </span>
        )}

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

      {/* ── BOTTOM BAR — Timestamp + Officer + Case ──── */}
      <div className="absolute bottom-0 left-0 right-0 bg-black/55 px-3 py-1.5 flex items-center justify-between">
        {/* Left: timestamp */}
        <span className="text-[11px] text-white font-bold tracking-wide" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {timestamp}
        </span>

        {/* Center: officer name */}
        {officer && (
          <span className="text-[10px] text-white/85">{officer}</span>
        )}

        {/* Right: case + classification */}
        <div className="flex items-center gap-2">
          {classification !== 'routine' && (
            <span className={`text-[8px] font-bold tracking-wider uppercase ${classificationStyle(classification)}`}>
              {classification}
            </span>
          )}
          {caseNum ? (
            <span className="text-[10px] text-white/60">Case #{caseNum}</span>
          ) : (
            <span className="text-[10px] text-white/25">No Case</span>
          )}
        </div>
      </div>
    </div>
  );
}
