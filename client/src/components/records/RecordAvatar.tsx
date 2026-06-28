// ============================================================
// RMPG Flex — Record Avatar
// Universal identity tile for record hero headers / list rows.
// Renders, in priority order:
//   1. the record photo (mugshot / DL / asset image) when present,
//   2. else a type glyph (person / vehicle / building / …) on a single
//      on-system STEEL-BLUE tile — one standard look across every record
//      family (replaces the old per-list colored-initials / plate-text tiles),
//   3. plus an optional CORNER TAB (WARRANT / SOR / STOLEN / …) pinned to the
//      bottom edge so the must-not-miss condition still reads from the list
//      without a full colored ring.
// Colors come from the --record-tile-* theme tokens so the tile re-themes
// night↔day↔legacy automatically — never hardcoded hex.
// ============================================================

import React, { useState } from 'react';
import { User } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { BADGE_TONES, type CornerBadge } from './recordVisuals';

interface RecordAvatarProps {
  /** Subject / record name — used only for the photo's alt text now. */
  name: string;
  /** Photo / ID image. Falls back to the type glyph on missing or load error. */
  photoUrl?: string | null;
  /** Glyph shown when there's no photo. Defaults to a generic person icon. */
  icon?: LucideIcon;
  /** Optional condition tab (warrant / SOR / stolen / …). Omit for a plain tile. */
  cornerBadge?: CornerBadge | null;
  /** Dim the tile (e.g. an inactive property / archived record). */
  muted?: boolean;
  /** Edge length in px (square tile). */
  size?: number;
  className?: string;
}

export default function RecordAvatar({
  name,
  photoUrl,
  icon: Icon = User,
  cornerBadge = null,
  muted = false,
  size = 56,
  className = '',
}: RecordAvatarProps) {
  const [imgError, setImgError] = useState(false);
  const showPhoto = !!photoUrl && !imgError;

  const tileBg = muted ? 'var(--record-tile-bg-muted)' : 'var(--record-tile-bg)';
  const tileBorder = muted ? 'var(--record-tile-border-muted)' : 'var(--record-tile-border)';
  const tileFg = muted ? 'var(--record-tile-fg-muted)' : 'var(--record-tile-fg)';

  // Corner tab geometry scales with the tile so it stays legible at 36px
  // (list) and 52px (hero) alike.
  const ribbonH = Math.max(11, Math.round(size * 0.3));
  const ribbonFont = Math.max(6, Math.round(size * 0.2));
  const tone = cornerBadge ? (BADGE_TONES[cornerBadge.tone] ?? BADGE_TONES.gray) : null;

  return (
    <div
      className={`relative flex-shrink-0 rounded-[2px] overflow-hidden select-none ${className}`}
      style={{
        width: size,
        height: size,
        background: tileBg,
        border: `1px solid ${tileBorder}`,
      }}
    >
      {showPhoto ? (
        <img
          src={photoUrl!}
          alt={name}
          className="w-full h-full object-cover"
          onError={() => setImgError(true)}
        />
      ) : (
        <div
          className="absolute inset-0 flex items-center justify-center"
          // Nudge the glyph up so it stays centered in the space above the tab.
          style={{ paddingBottom: cornerBadge ? ribbonH : 0, color: tileFg }}
        >
          <Icon size={Math.round(size * 0.5)} strokeWidth={1.75} />
        </div>
      )}

      {cornerBadge && tone && (
        <div
          className={`absolute bottom-0 left-0 right-0 flex items-center justify-center leading-none ${cornerBadge.pulse ? 'animate-led-pulse' : ''}`}
          style={{
            height: ribbonH,
            background: tone.border,
            color: tone.glow, // currentColor → led-pulse halo
            borderTop: `1px solid ${tone.border}`,
          }}
          title={cornerBadge.code}
        >
          <span
            className="font-bold uppercase tracking-tight px-0.5 truncate"
            style={{ fontSize: ribbonFont, color: '#fff', textShadow: '0 1px 1px rgba(0,0,0,0.55)' }}
          >
            {cornerBadge.code}
          </span>
        </div>
      )}
    </div>
  );
}
