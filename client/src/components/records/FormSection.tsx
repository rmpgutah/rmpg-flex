// ============================================================
// RMPG Flex — Form Section
// Non-collapsible grouping header for record forms. Mirrors the
// detail-panel CollapsibleSection chrome (gold/severity left rail +
// gradient header + tinted title) so create/edit forms read with the
// same visual rhythm as the records they produce.
// ============================================================

import React from 'react';
import { BADGE_TONES, type BadgeTone } from './recordVisuals';

interface FormSectionProps {
  title: string;
  icon?: React.ElementType;
  /** Severity tint for the rail / icon / title. Omit = brand gold. */
  accent?: BadgeTone;
  children: React.ReactNode;
  className?: string;
}

const GOLD = '#d4a017';

function FormSection({ title, icon: Icon, accent, children, className = '' }: FormSectionProps) {
  const accentColor = accent ? BADGE_TONES[accent].text : GOLD;
  const accentGlow = accent ? BADGE_TONES[accent].glow : 'rgba(212,160,23,0.3)';
  const railColor = accent ? BADGE_TONES[accent].border : 'rgba(212,160,23,0.45)';

  return (
    <div className={`relative border border-[#2b2b2b] overflow-hidden ${className}`} style={{ background: '#050505' }}>
      <div
        className="absolute left-0 top-0 bottom-0 w-[2px] pointer-events-none"
        style={{ background: railColor, boxShadow: accent ? `0 0 6px ${accentGlow}` : undefined }}
      />
      <div
        className="flex items-center gap-2 px-2.5 py-1.5"
        style={{ background: 'linear-gradient(180deg, #2b2b2b 0%, #1f1f1f 100%)', borderBottom: '1px solid #0c0c0c' }}
      >
        {Icon && (
          <Icon className="w-3.5 h-3.5 shrink-0" style={{ color: accentColor, filter: `drop-shadow(0 0 3px ${accentGlow})` }} aria-hidden="true" />
        )}
        <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: accentColor, letterSpacing: '0.1em' }}>
          {title}
        </span>
      </div>
      <div className="p-2.5">{children}</div>
    </div>
  );
}

export default React.memo(FormSection);
