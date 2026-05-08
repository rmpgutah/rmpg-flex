import { useEffect, useState, useRef, useCallback } from 'react';
import { Copy, Check } from 'lucide-react';

interface MapCoordinateReadoutProps {
  mapInstance: google.maps.Map | null;
}

/** Format decimal degrees to DMS notation */
function toDMS(decimal: number, isLat: boolean): string {
  const abs = Math.abs(decimal);
  const deg = Math.floor(abs);
  const minFull = (abs - deg) * 60;
  const min = Math.floor(minFull);
  const secVal = (minFull - min) * 60;
  const sec = `${String(Math.floor(secVal)).padStart(2, '0')}.${Math.round((secVal % 1) * 10)}`;
  const dir = isLat ? (decimal >= 0 ? 'N' : 'S') : (decimal >= 0 ? 'E' : 'W');
  return `${deg}°${String(min).padStart(2, '0')}'${sec}"${dir}`;
}

export default function MapCoordinateReadout({ mapInstance }: MapCoordinateReadoutProps) {
  const [lat, setLat] = useState(0);
  const [lng, setLng] = useState(0);
  const [showDMS, setShowDMS] = useState(false);
  const [copied, setCopied] = useState(false);
  const listenerRef = useRef<google.maps.MapsEventListener | null>(null);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!mapInstance) return;

    const update = () => {
      const center = mapInstance.getCenter();
      if (!center) return;
      setLat(center.lat());
      setLng(center.lng());
    };

    update();
    listenerRef.current = google.maps.event.addListener(mapInstance, 'center_changed', update);

    return () => {
      if (listenerRef.current) {
        google.maps.event.removeListener(listenerRef.current);
        listenerRef.current = null;
      }
    };
  }, [mapInstance]);

  const handleCopy = useCallback(() => {
    const text = showDMS
      ? `${toDMS(lat, true)} ${toDMS(lng, false)}`
      : `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = setTimeout(() => setCopied(false), 1500);
    });
  }, [lat, lng, showDMS]);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    };
  }, []);

  if (!mapInstance) return null;

  const coordText = showDMS
    ? `${toDMS(lat, true)}  ${toDMS(lng, false)}`
    : `${lat.toFixed(6)}, ${lng.toFixed(6)}`;

  return (
    <div
      className="absolute z-[999] flex items-center gap-1.5"
      style={{
        bottom: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        background: 'rgba(6,12,20,0.85)',
        backdropFilter: 'blur(4px)',
        border: '1px solid rgba(30,48,72,0.4)',
        padding: '2px 8px',
        borderRadius: 2,
        pointerEvents: 'auto',
      }}
    >
      <button
        type="button"
        onClick={() => setShowDMS(d => !d)}
        className="font-mono text-[9px] font-bold tabular-nums tracking-wider text-rmpg-400 hover:text-rmpg-200 transition-colors cursor-pointer"
        title={`Click to switch to ${showDMS ? 'decimal degrees' : 'DMS'}`}
        style={{ background: 'none', border: 'none', padding: 0 }}
      >
        {coordText}
      </button>
      <button
        type="button"
        onClick={handleCopy}
        className="text-rmpg-500 hover:text-rmpg-200 transition-colors"
        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '1px 2px' }}
        title="Copy coordinates"
        aria-label="Copy coordinates to clipboard"
      >
        {copied
          ? <Check style={{ width: 9, height: 9, color: '#22c55e' }} />
          : <Copy style={{ width: 9, height: 9 }} />
        }
      </button>
    </div>
  );
}
