import { useEffect, useRef, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';

interface ClusterGroup {
  lat: number;
  lng: number;
  count: number;
  highestPriority: number;
  markerIndices: number[];
}

const PRIORITY_COLORS: Record<number, string> = {
  1: '#dc2626',
  2: '#f59e0b',
  3: '#888888',
  4: '#666666',
};

function getPriorityColor(priority: number): string {
  return PRIORITY_COLORS[priority] || PRIORITY_COLORS[4];
}

const CLUSTER_ZOOM_THRESHOLD = 14;
const GRID_SIZE_PX = 80;

export function useMapClustering(
  map: mapboxgl.Map | null,
  enabled: boolean,
  callMarkers: mapboxgl.Marker[],
): { clustered: boolean } {
  const [clustered, setClustered] = useState(false);
  const clusterMarkersRef = useRef<mapboxgl.Marker[]>([]);
  const hiddenMarkersRef = useRef<Set<mapboxgl.Marker>>(new Set());

  const clearClusters = useCallback(() => {
    clusterMarkersRef.current.forEach((m) => m.remove());
    clusterMarkersRef.current = [];

    hiddenMarkersRef.current.forEach((m) => {
      if (map) m.addTo(map);
    });
    hiddenMarkersRef.current.clear();
  }, [map]);

  const buildClusters = useCallback(() => {
    if (!map || !enabled) return;

    const zoom = map.getZoom();
    if (zoom == null || zoom >= CLUSTER_ZOOM_THRESHOLD) {
      clearClusters();
      setClustered(false);
      return;
    }

    const mapCanvas = map.getCanvas();
    const mapWidth = mapCanvas.width;
    const mapHeight = mapCanvas.height;
    if (!mapWidth || !mapHeight) return;

    interface MarkerInfo {
      marker: mapboxgl.Marker;
      px: number;
      py: number;
      priority: number;
    }

    const markerInfos: MarkerInfo[] = [];

    callMarkers.forEach((marker) => {
      const lngLat = marker.getLngLat();
      if (!lngLat) return;

      const point = map.project(lngLat);

      let priority = 4;
      const el = marker.getElement();
      const title = el.getAttribute('title') || '';
      const pMatch = title.match(/P(\d)/);
      if (pMatch) priority = parseInt(pMatch[1], 10);

      markerInfos.push({
        marker,
        px: point.x,
        py: point.y,
        priority,
      });
    });

    if (markerInfos.length < 2) {
      clearClusters();
      setClustered(false);
      return;
    }

    const assigned = new Set<number>();
    const groups: ClusterGroup[] = [];

    for (let i = 0; i < markerInfos.length; i++) {
      if (assigned.has(i)) continue;

      const group: ClusterGroup = {
        lat: 0,
        lng: 0,
        count: 0,
        highestPriority: markerInfos[i].priority,
        markerIndices: [],
      };

      for (let j = i; j < markerInfos.length; j++) {
        if (assigned.has(j)) continue;

        const dx = markerInfos[j].px - markerInfos[i].px;
        const dy = markerInfos[j].py - markerInfos[i].py;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (j === i || dist < GRID_SIZE_PX) {
          assigned.add(j);
          group.markerIndices.push(j);
          group.count++;

          const lngLat = markerInfos[j].marker.getLngLat();
          if (lngLat) {
            group.lat += lngLat.lat;
            group.lng += lngLat.lng;
          }

          if (markerInfos[j].priority < group.highestPriority) {
            group.highestPriority = markerInfos[j].priority;
          }
        }
      }

      if (group.count > 0) {
        group.lat /= group.count;
        group.lng /= group.count;
      }

      groups.push(group);
    }

    clusterMarkersRef.current.forEach((m) => m.remove());
    clusterMarkersRef.current = [];

    hiddenMarkersRef.current.forEach((m) => {
      if (map) m.addTo(map);
    });
    hiddenMarkersRef.current.clear();

    let anyClustered = false;

    groups.forEach((group) => {
      if (group.count <= 1) return;

      anyClustered = true;

      group.markerIndices.forEach((idx) => {
        const m = markerInfos[idx].marker;
        m.remove();
        hiddenMarkersRef.current.add(m);
      });

      const color = getPriorityColor(group.highestPriority);
      const size = Math.min(24 + group.count * 2, 48);

      const el = document.createElement('div');
      el.style.cssText = `
        background: ${color};
        width: ${size}px;
        height: ${size}px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        border: 2px solid white;
        box-shadow: 0 2px 6px rgba(0,0,0,0.5);
        cursor: pointer;
        font-family: monospace;
        font-size: ${size > 36 ? 14 : 12}px;
        font-weight: bold;
        color: white;
      `;
      el.textContent = String(group.count);

      const clusterMarker = new mapboxgl.Marker({ element: el, anchor: 'center' })
        .setLngLat([group.lng, group.lat])
        .addTo(map);

      el.addEventListener('click', () => {
        const bounds = new mapboxgl.LngLatBounds();
        group.markerIndices.forEach((idx) => {
          const lngLat = markerInfos[idx].marker.getLngLat();
          if (lngLat) bounds.extend(lngLat);
        });
        map.fitBounds(bounds, { padding: 50 });
      });

      clusterMarkersRef.current.push(clusterMarker);
    });

    setClustered(anyClustered);
  }, [map, enabled, callMarkers, clearClusters]);

  useEffect(() => {
    if (!map || !enabled) {
      clearClusters();
      setClustered(false);
      return;
    }

    buildClusters();

    const onZoom = () => buildClusters();
    map.on('zoom', onZoom);

    return () => {
      map.off('zoom', onZoom);
      clearClusters();
      setClustered(false);
    };
  }, [map, enabled, buildClusters, clearClusters]);

  useEffect(() => {
    if (!map || !enabled) return;
    buildClusters();
  }, [callMarkers, buildClusters, map, enabled]);

  useEffect(() => {
    return () => {
      clusterMarkersRef.current.forEach((m) => m.remove());
      clusterMarkersRef.current = [];
      hiddenMarkersRef.current.clear();
    };
  }, []);

  return { clustered };
}