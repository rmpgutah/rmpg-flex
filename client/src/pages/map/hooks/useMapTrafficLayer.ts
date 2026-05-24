import { useState, useCallback, useEffect } from 'react';

export function useMapTrafficLayer() {
  const [showTraffic, setShowTraffic] = useState(false);

  const toggleTraffic = useCallback(() => {
    setShowTraffic((prev) => !prev);
  }, []);

  useEffect(() => {
    return () => { /* no clean-up needed — Mapbox GL JS has no built-in traffic layer */ };
  }, []);

  return { showTraffic, toggleTraffic };
}