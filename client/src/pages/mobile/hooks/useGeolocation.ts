import { useEffect, useState } from 'react';

export type GeoStatus = 'idle' | 'requesting' | 'granted' | 'denied' | 'unavailable';

export interface GeoPosition {
  lat: number;
  lng: number;
  accuracy: number;
}

export function useGeolocation(opts: { enabled: boolean }): {
  status: GeoStatus;
  position: GeoPosition | null;
} {
  const [status, setStatus] = useState<GeoStatus>('idle');
  const [position, setPosition] = useState<GeoPosition | null>(null);

  useEffect(() => {
    if (!opts.enabled) return;
    if (!('geolocation' in navigator)) { setStatus('unavailable'); return; }
    setStatus('requesting');
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        setPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy });
        setStatus('granted');
      },
      (err) => { setStatus(err.code === 1 ? 'denied' : 'unavailable'); },
      { enableHighAccuracy: true, maximumAge: 10000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [opts.enabled]);

  return { status, position };
}
