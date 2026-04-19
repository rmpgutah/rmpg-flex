import { useState } from 'react';
import { Crosshair, Loader2 } from 'lucide-react';

interface MapV2GeolocateButtonProps {
  onLocate: () => Promise<{ ok: boolean; reason?: string }>;
  enabled: boolean;
}

/**
 * Find-me button (Google-Maps-style blue dot trigger) for /map-v2.
 * Bottom-right floating button above the style switcher. Loading state
 * during GPS fix; gold accent when actively tracking.
 */
export default function MapV2GeolocateButton({ onLocate, enabled }: MapV2GeolocateButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setLoading(true);
    setError(null);
    const res = await onLocate();
    setLoading(false);
    if (!res.ok) {
      setError(res.reason || 'failed');
      setTimeout(() => setError(null), 3500);
    }
  }

  return (
    <div className="absolute bottom-20 right-2 z-20 flex flex-col items-end gap-1 select-none">
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        title={enabled ? 'Tracking your location' : 'Find my location'}
        aria-label={enabled ? 'Currently tracking location' : 'Find my location'}
        className={
          'p-1.5 bg-[#141414] border border-[#222222] hover:bg-[#1a1a1a] disabled:opacity-50 ' +
          (enabled ? 'text-[#3b82f6]' : 'text-[#9ca3af]')
        }
      >
        {loading
          ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          : <Crosshair className="w-4 h-4" aria-hidden="true" />}
      </button>
      {error && (
        <div className="bg-[#141414] border border-[#ef4444] text-[9px] font-mono uppercase tracking-wider text-[#ef4444] px-2 py-0.5">
          {error === 'timeout' ? 'No GPS fix' :
           error === 'unsupported' ? 'GPS unavailable' :
           error === 'map-not-ready' ? 'Map loading' :
           'Location denied'}
        </div>
      )}
    </div>
  );
}
