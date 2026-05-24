interface RmpgLogoProps {
  className?: string;
  /** Height in pixels — width auto-scales to preserve aspect ratio */
  height?: number;
  /** Show as icon-only (circular emblem) for compact spaces */
  iconOnly?: boolean;
}

/** SVG fallback when the logo image fails to load */
function LogoFallback({ height, className }: { height: number; className: string }) {
  return (
    <div
      className={`flex-shrink-0 flex items-center justify-center ${className}`}
      style={{ height, width: height, background: '#141414', border: '1px solid #222222', borderRadius: 2 }}
    >
      <span className="text-[10px] font-black uppercase tracking-wider" style={{ color: '#d4a017' }}>
        RMPG
      </span>
    </div>
  );
}

/**
 * RMPG Logo — Rocky Mountain Protective Group branding.
 * Uses the official RMPG Flex emblem (eagle + mountains + company name).
 * Full mode: displays the emblem at larger size.
 * Icon-only mode: compact emblem for toolbars and headers.
 * Gracefully falls back to text placeholder if the image fails to load.
 */
export default function RmpgLogo({ className = '', height = 40, iconOnly = false }: RmpgLogoProps) {
  const [imgError, setImgError] = useState(false);
  const handleError = useCallback(() => setImgError(true), []);

  if (imgError) {
    return <LogoFallback height={height} className={className} />;
  }

  if (iconOnly) {
    return (
      <img
        src="/rmpg flex.png"
        alt="RMPG Flex"
        className={`flex-shrink-0 ${className}`}
        style={{ height, width: height, objectFit: 'contain' }}
        draggable={false}
        onError={handleError}
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
      onError={handleError}
    />
  );
}
