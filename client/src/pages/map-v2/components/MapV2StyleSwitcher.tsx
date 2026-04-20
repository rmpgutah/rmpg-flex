import { Map as MapIcon } from 'lucide-react';

export type MapStyleKey = 'dark' | 'detail' | 'streets' | 'light' | 'voyager';

interface MapV2StyleSwitcherProps {
  value: MapStyleKey;
  onChange: (v: MapStyleKey) => void;
}

const OPTIONS: { value: MapStyleKey; label: string; cached: boolean }[] = [
  { value: 'dark', label: 'Dark', cached: true },
  { value: 'detail', label: 'Detail', cached: false },
  { value: 'streets', label: 'Streets', cached: false },
  { value: 'light', label: 'Light', cached: false },
  { value: 'voyager', label: 'Voyager', cached: false },
];

/**
 * Tile-style picker — bottom-right chrome row, just above the status
 * bar. Lets dispatchers swap the basemap between Dark (offline-cached),
 * Light, and Voyager. Light and Voyager are live-only (cartocdn);
 * Dark is the only style guaranteed to work in vehicle dead zones.
 */
export default function MapV2StyleSwitcher({ value, onChange }: MapV2StyleSwitcherProps) {
  return (
    <div
      className="absolute bottom-12 right-2 z-20 flex items-center bg-[#141414] border border-[#222222] font-mono text-[10px] uppercase tracking-wider select-none"
      title="Map style"
    >
      <MapIcon className="w-3 h-3 mx-1.5 text-[#888888]" aria-hidden="true" />
      {OPTIONS.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={active}
            aria-label={`${o.label}${o.cached ? ' (offline)' : ''}`}
            title={o.cached ? `${o.label} (offline-cached)` : `${o.label} (live)`}
            className={
              'px-2 py-1 border-l border-[#1a1a1a] hover:bg-[#1a1a1a] ' +
              (active ? 'bg-[#1a1a1a] text-[#d4a017]' : 'text-[#9ca3af]')
            }
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
