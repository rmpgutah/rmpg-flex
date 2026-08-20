import React, { useState, useCallback } from 'react';

interface RmpgLogoProps {
  className?: string;
  /** Height in pixels — width auto-scales to preserve aspect ratio */
  height?: number;
  /** Show as icon-only (circular emblem) for compact spaces */
  iconOnly?: boolean;
  /**
   * Logo variant:
   *   'dark-bg'  — silver horizontal logo for dark-themed surfaces (default)
   *   'light-bg' — black transparent logo for light/print surfaces
   *   'icon'     — the RMPG "R" emblem icon only, any background
   *
   * Drop logo files into client/public/:
   *   rmpg-logo-silver.png  — silver logo, transparent bg (dark-bg variant)
   *   rmpg-logo-black.png   — black logo, transparent bg (light-bg variant)
   *   rmpg-icon.png         — "R" emblem icon (icon variant)
   */
  variant?: 'dark-bg' | 'light-bg' | 'icon';
}

const LOGO_SOURCES: Record<'dark-bg' | 'light-bg' | 'icon', string[]> = {
  'dark-bg':  ['/rmpg-logo-silver.png', '/rmpg-logo-blue-dark.png', '/rmpg flex.png', '/rmpg-logo.png'],
  'light-bg': ['/rmpg-logo-black.png', '/rmpg-logo-bw.png', '/Logo Official.png', '/rmpg flex.png'],
  'icon':     ['/rmpg-icon.png', '/rmpg flex.png', '/rmpg-seal.png'],
};

/** SVG fallback when the logo image fails to load */
function LogoFallback({ height, className }: { height: number; className: string }) {
  return (
    <div
      className={`flex-shrink-0 flex items-center justify-center ${className}`}
      style={{ height, width: height, background: 'var(--surface-base)', border: '1px solid var(--border-subtle)', borderRadius: 2 }}
    >
      <span className="text-[10px] font-black uppercase tracking-wider" style={{ color: 'var(--field-label-color)' }}>
        RMPG
      </span>
    </div>
  );
}

/**
 * RMPG Logo — Rocky Mountain Protective Group branding.
 *
 * Supports three variants for different surfaces:
 *   - dark-bg  (default): silver horizontal logo for the dark blue-silver UI
 *   - light-bg: black transparent logo for light surfaces or print contexts
 *   - icon: compact emblem for toolbars
 *
 * Each variant tries a priority-ordered list of filenames with fallback
 * so the component is graceful while new logo files are being staged.
 */
export default function RmpgLogo({
  className = '',
  height = 40,
  iconOnly = false,
  variant = 'dark-bg',
}: RmpgLogoProps) {
  const resolvedVariant: 'dark-bg' | 'light-bg' | 'icon' = iconOnly ? 'icon' : variant;
  const sources = LOGO_SOURCES[resolvedVariant];
  const [srcIndex, setSrcIndex] = useState(0);
  const [failed, setFailed] = useState(false);

  const handleError = useCallback(() => {
    const next = srcIndex + 1;
    if (next < sources.length) {
      setSrcIndex(next);
    } else {
      setFailed(true);
    }
  }, [srcIndex, sources.length]);

  if (failed) {
    return <LogoFallback height={height} className={className} />;
  }

  const isIcon = resolvedVariant === 'icon';

  return (
    <img
      src={sources[srcIndex]}
      alt={isIcon ? 'RMPG' : 'Rocky Mountain Protective Group — RMPG Flex'}
      className={`flex-shrink-0 ${className}`}
      style={isIcon
        ? { height, width: height, objectFit: 'contain' }
        : { height, objectFit: 'contain' }}
      draggable={false}
      onError={handleError}
    />
  );
}
