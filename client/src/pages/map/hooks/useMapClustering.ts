// ============================================================
// RMPG Flex — useMapClustering Hook
// Simple grid-based marker clustering at low zoom levels.
// Hides individual call markers and shows cluster circles
// at zoom < 14, restores individual markers at zoom >= 14.
// ============================================================

import { useEffect, useRef, useState, useCallback } from 'react';

// ─── Types ──────────────────────────────────────────────────

interface ClusterGroup {
  lat: number;
  lng: number;
  count: number;
  highestPriority: number;
  markerIndices: number[];
}

// Priority colors: P1=red, P2=amber, P3=blue, P4=gray
const PRIORITY_COLORS: Record<number, string> = {
  1: '#dc2626',
  2: '#f59e0b',
  3: '#3b82f6',
  4: '#6b7280',
};

function getPriorityColor(priority: number): string {
  return PRIORITY_COLORS[priority] || PRIORITY_COLORS[4];
}

const CLUSTER_ZOOM_THRESHOLD = 14;
const GRID_SIZE_PX = 80; // pixels — markers within this distance are grouped

// ─── Hook ───────────────────────────────────────────────────

export function useMapClustering(
  map: google.maps.Map | null,
  enabled: boolean,
  callMarkers: google.maps.marker.AdvancedMarkerElement[],
): { clustered: boolean } {
  const [clustered, setClustered] = useState(false);
  const clusterMarkersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([]);
  const hiddenMarkersRef = useRef<Set<google.maps.marker.AdvancedMarkerElement>>(new Set());

  // ── Remove cluster markers ──────────────────────────────

  const clearClusters = useCallback(() => {
    clusterMarkersRef.current.forEach((m) => { m.map = null; });
    clusterMarkersRef.current = [];

    // Restore hidden markers
    hiddenMarkersRef.current.forEach((m) => {
      if (map) m.map = map;
    });
    hiddenMarkersRef.current.clear();
  }, [map]);

  // ── Build clusters ──────────────────────────────────────

  const buildClusters = useCallback(() => {
    if (!map || !window.google?.maps || !enabled) return;

    const zoom = map.getZoom();
    if (zoom == null || zoom >= CLUSTER_ZOOM_THRESHOLD) {
      clearClusters();
      setClustered(false);
      return;
    }

    // Project all marker positions to screen coordinates
    const projection = map.getProjection();
    if (!projection) {
      clearClusters();
      setClustered(false);
      return;
    }

    const bounds = map.getBounds();
    if (!bounds) return;

    const scale = Math.pow(2, zoom);

    interface MarkerInfo {
      marker: google.maps.marker.AdvancedMarkerElement;
      px: number;
      py: number;
      priority: number;
    }

    const markerInfos: MarkerInfo[] = [];

    callMarkers.forEach((marker) => {
      const pos = marker.position;
      if (!pos) return;

      const lat = typeof pos.lat === 'function' ? (pos as google.maps.LatLng).lat() : (pos as google.maps.LatLngLiteral).lat;
      const lng = typeof pos.lng === 'function' ? (pos as google.maps.LatLng).lng() : (pos as google.maps.LatLngLiteral).lng;

      const worldPoint = projection.fromLatLngToPoint(new google.maps.LatLng(lat, lng));
      if (!worldPoint) return;

      // Extract priority from title or data attribute
      let priority = 4;
      const title = marker.title || '';
      const pMatch = title.match(/P(\d)/);
      if (pMatch) priority = parseInt(pMatch[1], 10);

      markerInfos.push({
        marker,
        px: worldPoint.x * scale,
        py: worldPoint.y * scale,
        priority,
      });
    });

    if (markerInfos.length < 2) {
      clearClusters();
      setClustered(false);
      return;
    }

    // Grid-based clustering
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

      // Find all markers within grid distance
      for (let j = i; j < markerInfos.length; j++) {
        if (assigned.has(j)) continue;

        const dx = markerInfos[j].px - markerInfos[i].px;
        const dy = markerInfos[j].py - markerInfos[i].py;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (j === i || dist < GRID_SIZE_PX) {
          assigned.add(j);
          group.markerIndices.push(j);
          group.count++;

          const pos = markerInfos[j].marker.position;
          if (pos) {
            const lat = typeof pos.lat === 'function' ? (pos as google.maps.LatLng).lat() : (pos as google.maps.LatLngLiteral).lat;
            const lng = typeof pos.lng === 'function' ? (pos as google.maps.LatLng).lng() : (pos as google.maps.LatLngLiteral).lng;
            group.lat += lat;
            group.lng += lng;
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

    // Clear old clusters
    clusterMarkersRef.current.forEach((m) => { m.map = null; });
    clusterMarkersRef.current = [];

    // Restore previously hidden markers
    hiddenMarkersRef.current.forEach((m) => {
      if (map) m.map = map;
    });
    hiddenMarkersRef.current.clear();

    // Render cluster markers for groups with >1 marker
    let anyClustered = false;

    groups.forEach((group) => {
      if (group.count <= 1) return;

      anyClustered = true;

      // Hide individual markers in this cluster
      group.markerIndices.forEach((idx) => {
        const m = markerInfos[idx].marker;
        m.map = null;
        hiddenMarkersRef.current.add(m);
      });

      // Create cluster marker element
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

      if (window.google?.maps?.marker?.AdvancedMarkerElement) {
        const clusterMarker = new google.maps.marker.AdvancedMarkerElement({
          map,
          position: { lat: group.lat, lng: group.lng },
          content: el,
          zIndex: 100,
          title: `${group.count} incidents`,
        });

        // Click to zoom in and show individual markers
        clusterMarker.addListener('click', () => {
          const bounds = new google.maps.LatLngBounds();
          group.markerIndices.forEach((idx) => {
            const pos = markerInfos[idx].marker.position;
            if (pos) {
              const lat = typeof pos.lat === 'function' ? (pos as google.maps.LatLng).lat() : (pos as google.maps.LatLngLiteral).lat;
              const lng = typeof pos.lng === 'function' ? (pos as google.maps.LatLng).lng() : (pos as google.maps.LatLngLiteral).lng;
              bounds.extend(new google.maps.LatLng(lat, lng));
            }
          });
          map.fitBounds(bounds);
        });

        clusterMarkersRef.current.push(clusterMarker);
      }
    });

    setClustered(anyClustered);
  }, [map, enabled, callMarkers, clearClusters]);

  // ── Listen for zoom changes ─────────────────────────────

  useEffect(() => {
    if (!map || !enabled) {
      clearClusters();
      setClustered(false);
      return;
    }

    // Initial build
    buildClusters();

    // Rebuild on zoom change
    const listener = map.addListener('zoom_changed', () => {
      buildClusters();
    });

    return () => {
      google.maps.event.removeListener(listener);
      clearClusters();
      setClustered(false);
    };
  }, [map, enabled, buildClusters, clearClusters]);

  // ── Rebuild when markers change ─────────────────────────

  useEffect(() => {
    if (!map || !enabled) return;
    buildClusters();
  }, [callMarkers, buildClusters, map, enabled]);

  // ── Cleanup on unmount ──────────────────────────────────

  useEffect(() => {
    return () => {
      clusterMarkersRef.current.forEach((m) => { m.map = null; });
      clusterMarkersRef.current = [];
      hiddenMarkersRef.current.clear();
    };
  }, []);

  return { clustered };
}
