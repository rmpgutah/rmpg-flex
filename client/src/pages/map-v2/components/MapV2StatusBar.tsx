import { Sun, Camera } from 'lucide-react';
import type { DaylightInfo } from '../hooks/useDaylightPhase';

interface MapV2StatusBarProps {
  daylight: DaylightInfo;
  onScreenshot: () => void;
}

const PHASE_COLOR: Record<DaylightInfo['phase'], string> = {
  'Day': '#fbbf24',
  'Golden Hour': '#fb923c',
  'Civil Twilight': '#a78bfa',
  'Nautical Twilight': '#6366f1',
  'Night': '#888888',
};

/**
 * Bottom-right chrome row for /map-v2: daylight phase + sun elevation
 * status badge, screenshot button. Spillman dark, monospaced.
 */
export default function MapV2StatusBar({ daylight, onScreenshot }: MapV2StatusBarProps) {
  const phaseColor = PHASE_COLOR[daylight.phase] || '#888888';
  return (
    <div className="absolute bottom-2 right-2 z-20 flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider select-none">
      <div
        className="flex items-center gap-1.5 px-2 py-1 bg-[#141414] border border-[#222222]"
        title={`Sun ${daylight.sunElevation.toFixed(1)}° above horizon`}
      >
        <Sun className="w-3 h-3" style={{ color: phaseColor }} aria-hidden="true" />
        <span style={{ color: phaseColor }}>{daylight.phase}</span>
        <span className="text-[#666666]">{daylight.sunElevation.toFixed(0)}°</span>
      </div>
      <button
        type="button"
        onClick={onScreenshot}
        title="Save map as PNG"
        aria-label="Screenshot map"
        className="flex items-center gap-1.5 px-2 py-1 bg-[#141414] border border-[#222222] hover:bg-[#1a1a1a] text-[#9ca3af]"
      >
        <Camera className="w-3 h-3" aria-hidden="true" />
        Snap
      </button>
    </div>
  );
}
