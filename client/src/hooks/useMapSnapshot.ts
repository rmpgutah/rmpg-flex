/**
 * useMapSnapshot — Mapbox Static Images API playground equivalent.
 *
 * Generate static image previews of map locations using the Mapbox
 * Static Images API. Useful for PDF reports, call cards, thumbnails.
 * Replaces Google Maps Static Map API.
 */

import { useState, useCallback } from 'react';
import { mapboxStaticImageUrl } from '../services/mapboxApiService';

// ── Types ─────────────────────────────────────────────────

export interface SnapshotConfig {
  lng: number;
  lat: number;
  zoom?: number;
  width?: number;
  height?: number;
  style?: string;
  markers?: Array<{ lng: number; lat: number; color?: string; label?: string }>;
  retina?: boolean;
}

export interface SnapshotResult {
  url: string;
  config: SnapshotConfig;
  timestamp: number;
}

// ── Hook ──────────────────────────────────────────────────

export function useMapSnapshot() {
  const [snapshots, setSnapshots] = useState<SnapshotResult[]>([]);
  const [loading, setLoading] = useState(false);

  const captureSnapshot = useCallback(async (config: SnapshotConfig) => {
    setLoading(true);
    try {
      const url = await mapboxStaticImageUrl({
        lng: config.lng,
        lat: config.lat,
        zoom: config.zoom ?? 14,
        width: config.width ?? 600,
        height: config.height ?? 400,
        style: config.style,
        markers: config.markers,
        retina: config.retina,
      });

      const result: SnapshotResult = {
        url,
        config,
        timestamp: Date.now(),
      };

      setSnapshots(prev => [result, ...prev].slice(0, 10));
      return result;
    } catch (err) {
      console.warn('[MapSnapshot] capture failed:', err);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const clearSnapshots = useCallback(() => {
    setSnapshots([]);
  }, []);

  const removeSnapshot = useCallback((timestamp: number) => {
    setSnapshots(prev => prev.filter(s => s.timestamp !== timestamp));
  }, []);

  return {
    snapshots,
    loading,
    captureSnapshot,
    clearSnapshots,
    removeSnapshot,
  };
}
