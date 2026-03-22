// ============================================================
// RMPG Flex — useMapTrafficLayer Hook
// Toggles the Google Maps built-in TrafficLayer on/off.
// ============================================================

import { useRef, useState, useCallback, useEffect } from 'react';

export function useMapTrafficLayer() {
  const [showTraffic, setShowTraffic] = useState(false);
  const layerRef = useRef<google.maps.TrafficLayer | null>(null);

  const toggleTraffic = useCallback((map: google.maps.Map | null) => {
    setShowTraffic((prev) => {
      const next = !prev;
      if (next && map) {
        if (!layerRef.current) {
          layerRef.current = new google.maps.TrafficLayer();
        }
        layerRef.current.setMap(map);
      } else if (layerRef.current) {
        layerRef.current.setMap(null);
      }
      return next;
    });
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (layerRef.current) {
        layerRef.current.setMap(null);
        layerRef.current = null;
      }
    };
  }, []);

  return { showTraffic, toggleTraffic };
}
