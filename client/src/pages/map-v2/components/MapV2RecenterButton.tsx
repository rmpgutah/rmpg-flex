import { Home } from 'lucide-react';

interface MapV2RecenterButtonProps {
  onClick: () => void;
}

/**
 * Recenter-to-SLC button for /map-v2. Bottom-right floating button next
 * to the geolocation Crosshair, animates the view back to the operational
 * center (Salt Lake City) at the default zoom. Useful after panning far
 * to follow a unit or chase a P1 auto-pan.
 */
export default function MapV2RecenterButton({ onClick }: MapV2RecenterButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Recenter map"
      aria-label="Recenter map to default view"
      className="absolute bottom-32 right-2 z-20 p-1.5 bg-[#141414] border border-[#222222] hover:bg-[#1a1a1a] text-[#9ca3af]"
    >
      <Home className="w-4 h-4" aria-hidden="true" />
    </button>
  );
}
