// ============================================================
// RMPG Flex — Record Avatar
// Identity glyph for record hero headers / list rows. Renders a
// photo when available, else a deterministic name-hashed initials
// tile. The ring is tinted by record posture (red+pulse for armed/
// wanted, etc.) so the threat read starts at the avatar itself.
// ============================================================

import React from 'react';
import { BADGE_TONES, type BadgeTone } from './recordVisuals';

interface RecordAvatarProps {
  /** Used for initials + deterministic fallback color. */
  name: string;
  /** Photo / ID image. Falls back to initials tile on missing or load error. */
  photoUrl?: string | null;
  /** Posture tone for the ring + glow. Omit for a neutral ring. */
  tone?: BadgeTone;
  /** Pulse the ring (critical posture). */
  pulse?: boolean;
  /** Edge length in px (square tile). */
  size?: number;
  className?: string;
}

// Same palette the persons list used inline — kept here so every record
// type now shares one deterministic color source.
const AVATAR_COLORS = [
  '#dc2626', '#d97706', '#059669', '#888888', '#7c3aed',
  '#db2777', '#22c55e', '#65a30d', '#ea580c', '#888888',
];

function hashColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const first = parts[0][0];
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

export default function RecordAvatar({
  name,
  photoUrl,
  tone,
  pulse = false,
  size = 56,
  className = '',
}: RecordAvatarProps) {
  const ring = tone ? BADGE_TONES[tone] : null;
  const ringColor = ring?.border ?? 'rgba(255,255,255,0.15)';
  const glow = ring?.glow;

  return (
    <div
      className={`relative flex-shrink-0 rounded-[2px] overflow-hidden flex items-center justify-center select-none ${pulse ? 'animate-led-pulse' : ''} ${className}`}
      style={{
        width: size,
        height: size,
        background: photoUrl ? '#000' : hashColor(name),
        border: `2px solid ${ringColor}`,
        // currentColor drives the led-pulse keyframe glow; the static halo
        // covers the non-pulsing case.
        color: ring?.text,
        boxShadow: glow && !pulse ? `0 0 0 1px ${ringColor}, 0 0 12px ${glow}` : undefined,
      }}
    >
      {photoUrl ? (
        <img
          src={photoUrl}
          alt={name}
          className="w-full h-full object-cover"
          onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }}
        />
      ) : (
        <span className="font-bold text-white tracking-wide" style={{ fontSize: Math.round(size * 0.38) }}>
          {initials(name)}
        </span>
      )}
    </div>
  );
}
