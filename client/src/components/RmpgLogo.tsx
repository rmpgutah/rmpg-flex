interface RmpgLogoProps {
  className?: string;
  /** Height in pixels — width auto-scales to preserve aspect ratio */
  height?: number;
  /** Show as icon-only (circular emblem) for compact spaces */
  iconOnly?: boolean;
}

/**
 * RMPG Logo — Rocky Mountain Protective Group branding.
 * Uses the official RMPG Flex emblem (eagle + mountains + company name).
 * Full mode: displays the emblem at larger size.
 * Icon-only mode: compact emblem for toolbars and headers.
 */
export default function RmpgLogo({ className = '', height = 40, iconOnly = false }: RmpgLogoProps) {
  if (iconOnly) {
    return (
      <img
        src="/rmpg flex.png"
        alt="RMPG Flex"
        className={`flex-shrink-0 ${className}`}
        style={{ height, width: height, objectFit: 'contain' }}
        draggable={false}
      />
    );
  }

  return (
    <img
      src="/rmpg flex.png"
      alt="Rocky Mountain Protective Group — RMPG Flex"
      className={`flex-shrink-0 ${className}`}
      style={{ height, objectFit: 'contain' }}
      draggable={false}
    />
  );
}
