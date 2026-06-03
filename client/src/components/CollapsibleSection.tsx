// ============================================================
// RMPG Flex — Collapsible Section
// Expand/collapse wrapper for detail panel sections.
//
// Visual upgrade (2026-05-30): optional severity `accent` drives a
// left rail + chevron/icon/title tint + header underglow; the body
// now animates open/closed via grid-template-rows (true content
// height, no max-height guessing). All new props are optional —
// existing call sites render exactly as before (gold default).
// ============================================================

import React, { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { BADGE_TONES, type BadgeTone } from './records/recordVisuals';

interface CollapsibleSectionProps {
  title: string;
  icon?: React.ElementType;
  count?: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  /** Severity tint for the rail / chevron / icon / title. Omit = brand gold. */
  accent?: BadgeTone;
}

const GOLD = '#d4a017';

function CollapsibleSection({
  title,
  icon: Icon,
  count,
  defaultOpen = true,
  children,
  actions,
  className = '',
  accent,
}: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  // Accent resolves to brand gold when unset, so the default look is
  // identical to the pre-upgrade component.
  const accentColor = accent ? BADGE_TONES[accent].text : GOLD;
  const accentGlow = accent ? BADGE_TONES[accent].glow : 'rgba(212,160,23,0.3)';
  const railColor = accent ? BADGE_TONES[accent].border : 'rgba(212,160,23,0.45)';

  return (
    <div
      className={`relative border border-[#2b2b2b] overflow-hidden ${className}`}
      style={{ background: '#050505' }}
    >
      {/* Left severity rail — subtle gold by default, hot color when accented. */}
      <div
        className="absolute left-0 top-0 bottom-0 w-[2px] pointer-events-none"
        style={{ background: railColor, boxShadow: accent ? `0 0 6px ${accentGlow}` : undefined }}
      />

      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-label={`${title} section${count !== undefined ? ` (${count})` : ''}`}
        className="w-full flex items-center justify-between px-2.5 py-1.5 hover:brightness-125 transition-all"
        style={{
          background: 'linear-gradient(180deg, #2b2b2b 0%, #1f1f1f 100%)',
          borderBottom: isOpen ? '1px solid #0c0c0c' : 'none',
        }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <ChevronRight
            className={`w-3 h-3 transition-transform duration-200 ${isOpen ? 'rotate-90' : ''}`}
            style={{ color: accentColor }}
            aria-hidden="true"
          />
          {Icon && (
            <Icon
              className="w-3.5 h-3.5 shrink-0"
              style={{ color: accentColor, filter: `drop-shadow(0 0 3px ${accentGlow})` }}
              aria-hidden="true"
            />
          )}
          <span
            className="text-[10px] font-bold uppercase tracking-widest truncate"
            style={{ color: accentColor, letterSpacing: '0.1em' }}
          >
            {title}
          </span>
          {count !== undefined && (
            <span
              className="text-[9px] font-mono font-bold tabular-nums leading-none px-1 py-[2px] rounded-[2px] shrink-0"
              style={
                count > 0
                  ? { color: '#0a0a0a', background: accentColor }
                  : { color: '#666', background: 'rgba(255,255,255,0.04)', border: '1px solid #222' }
              }
            >
              {count}
            </span>
          )}
        </div>
        {actions && (
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex items-center gap-1 ml-auto pl-2 shrink-0"
          >
            {actions}
          </div>
        )}
      </button>

      {/* Body: grid-rows 1fr↔0fr animates to true content height. */}
      <div
        className="grid transition-[grid-template-rows] duration-200 ease-out"
        style={{ gridTemplateRows: isOpen ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden min-h-0">
          <div
            className={`pb-3 px-2.5 pt-2 transition-opacity duration-200 ${isOpen ? 'opacity-100' : 'opacity-0'}`}
            style={{ background: '#050505' }}
            aria-hidden={!isOpen}
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

export default React.memo(CollapsibleSection);
