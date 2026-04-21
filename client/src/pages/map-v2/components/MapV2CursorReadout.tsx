interface MapV2CursorReadoutProps {
  coords: { lat: number; lng: number } | null;
}

function fmt(n: number, axis: 'lat' | 'lng'): string {
  const dir = axis === 'lat' ? (n >= 0 ? 'N' : 'S') : (n >= 0 ? 'E' : 'W');
  return `${Math.abs(n).toFixed(5)}\u00B0${dir}`;
}

/**
 * Live cursor coordinate readout — bottom-left chrome, monospace.
 * Hidden when the cursor leaves the map viewport.
 */
export default function MapV2CursorReadout({ coords }: MapV2CursorReadoutProps) {
  if (!coords) return null;
  return (
    <div
      className="absolute bottom-2 left-2 z-10 px-2 py-1 bg-[#141414] border border-[#222222] text-[#9ca3af] font-mono text-[10px] tabular-nums pointer-events-none"
      aria-hidden="true"
    >
      {fmt(coords.lat, 'lat')} {fmt(coords.lng, 'lng')}
    </div>
  );
}
