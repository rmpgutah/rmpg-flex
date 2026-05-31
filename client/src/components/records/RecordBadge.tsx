// ============================================================
// RMPG Flex — Record Badge
// Toned status chip for record flags (Wanted / RSO / Gang / BOLO …).
// Replaces ad-hoc <span> flag pills with a consistent, glowing,
// optionally-pulsing chip driven by recordVisuals tones.
// ============================================================

import React from 'react';
import { toneStyle, classifyFlag, type BadgeTone } from './recordVisuals';

interface RecordBadgeProps {
  children: React.ReactNode;
  /** Explicit tone. If omitted, `flag` is classified to pick one. */
  tone?: BadgeTone;
  /** Raw flag text — used to auto-classify tone + pulse when `tone` is unset. */
  flag?: string;
  /** Force / suppress the pulse animation (defaults from classifyFlag). */
  pulse?: boolean;
  /** Add the glow halo. High-signal badges glow; quiet ones stay flat. */
  glow?: boolean;
  icon?: React.ElementType;
  size?: 'xs' | 'sm';
  title?: string;
  className?: string;
}

function RecordBadge({
  children,
  tone,
  flag,
  pulse,
  glow = true,
  icon: Icon,
  size = 'xs',
  title,
  className = '',
}: RecordBadgeProps) {
  // Resolve tone/pulse: explicit prop wins, else classify the flag text.
  const classified = flag ? classifyFlag(flag) : null;
  const resolvedTone: BadgeTone = tone ?? classified?.tone ?? 'gray';
  const resolvedPulse = pulse ?? classified?.pulse ?? false;

  const sizeCls = size === 'sm' ? 'text-[11px] px-2 py-0.5 gap-1.5' : 'text-[10px] px-1.5 py-[3px] gap-1';

  return (
    <span
      title={title}
      style={toneStyle(resolvedTone, glow)}
      className={`
        inline-flex items-center font-bold uppercase tracking-wide
        whitespace-nowrap select-none transition-all duration-150
        ${sizeCls}
        ${resolvedPulse ? 'animate-led-pulse' : ''}
        ${className}
      `}
    >
      {Icon && <Icon className={size === 'sm' ? 'w-3 h-3' : 'w-2.5 h-2.5'} aria-hidden="true" />}
      {children}
    </span>
  );
}

export default React.memo(RecordBadge);
