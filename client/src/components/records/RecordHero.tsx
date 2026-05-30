// ============================================================
// RMPG Flex — Record Hero
// "Booking-card" identity band for the top of every record detail
// panel. Composes RecordAvatar + a posture-driven threat bar + the
// subject name / identity line, with a slot for the existing flag
// badge row. The whole band's color is driven by recordPosture() —
// the single worst flag on the record — so the threat read lands
// before the operator parses any individual badge.
// ============================================================

import React from 'react';
import RecordAvatar from './RecordAvatar';
import { recordPosture, BADGE_TONES, type BadgeTone } from './recordVisuals';

interface RecordHeroProps {
  /** Subject / record name (Person, plate, business, address…). */
  name: string;
  /** Secondary identity line — DOB/age/sex, VIN, client, etc. */
  subtitle?: React.ReactNode;
  /** Photo / ID image; falls back to initials tile. */
  photoUrl?: string | null;
  /**
   * Raw flag strings — drives the overall posture (threat bar + ring +
   * label). Splat in optional synthetic flags freely; nullish entries are
   * ignored by recordPosture().
   */
  flags?: Array<string | null | undefined>;
  /**
   * Fallback ring tone when the record carries no flags (e.g. a record-type
   * accent). Posture from `flags` always wins when present.
   */
  tone?: BadgeTone;
  /** Existing badge row / actions rendered under the identity line. */
  children?: React.ReactNode;
}

export default function RecordHero({
  name,
  subtitle,
  photoUrl,
  flags = [],
  tone,
  children,
}: RecordHeroProps) {
  const posture = recordPosture(flags);
  const hasFlags = flags.some(Boolean);

  // Posture wins when the record has flags; otherwise fall back to the
  // caller's record-type tone, then a quiet gray.
  const activeTone: BadgeTone = hasFlags ? posture.tone : (tone ?? 'gray');
  const t = BADGE_TONES[activeTone];
  const isClear = !hasFlags || posture.level === 'clear';

  return (
    <div className="relative bg-surface-sunken">
      {/* Threat bar — top edge glows the dominant posture color. Quiet
          (no halo) when the record is clear so calm records stay calm. */}
      <div
        className={`h-[3px] w-full ${posture.pulse ? 'animate-led-pulse' : ''}`}
        style={{
          background: t.border,
          color: t.glow, // currentColor → led-pulse halo
          boxShadow: isClear ? undefined : `0 0 10px ${t.glow}`,
        }}
      />

      <div className="flex items-start gap-3 px-4 pt-3 pb-2">
        <RecordAvatar
          name={name}
          photoUrl={photoUrl}
          tone={hasFlags ? posture.tone : tone}
          pulse={posture.pulse}
          size={52}
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-sm font-bold text-white truncate tracking-wide uppercase">
              {name}
            </h2>
            <span
              className={`text-[8px] font-bold uppercase tracking-widest px-1.5 py-[2px] rounded-[2px] leading-none whitespace-nowrap ${posture.pulse ? 'animate-led-pulse' : ''}`}
              style={{
                color: isClear ? '#8a8a8a' : t.text,
                background: isClear ? 'rgba(255,255,255,0.04)' : t.bg,
                border: `1px solid ${isClear ? '#2b2b2b' : t.border}`,
              }}
              title={`Record posture: ${posture.label}`}
            >
              {posture.label}
            </span>
          </div>

          {subtitle && (
            <div className="text-[10px] text-rmpg-400 mt-0.5 leading-snug">{subtitle}</div>
          )}

          {children && <div className="flex flex-wrap gap-1.5 mt-1.5">{children}</div>}
        </div>
      </div>
    </div>
  );
}
