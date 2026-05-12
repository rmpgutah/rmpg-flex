/**
 * useMapPrintExport — Google Maps print/static map equivalent for Mapbox GL.
 *
 * Exports the current map canvas as a downloadable PNG image.
 * Adds watermark with timestamp and coordinates. Replaces Google Maps
 * Static Maps API / print functionality.
 */

import { useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';

// ── Hook ──────────────────────────────────────────────────

export function useMapPrintExport(
  map: mapboxgl.Map | null,
  mapLoaded: boolean,
) {
  const [exporting, setExporting] = useState(false);

  const exportImage = useCallback(async (options?: {
    filename?: string;
    includeWatermark?: boolean;
    format?: 'png' | 'jpeg';
    quality?: number;
  }) => {
    if (!map || !mapLoaded) return;

    setExporting(true);
    try {
      // Force a render to ensure canvas is current
      map.triggerRepaint();
      await new Promise(r => setTimeout(r, 100));

      const canvas = map.getCanvas();
      const { width, height } = canvas;

      // Create offscreen canvas for watermark
      const offscreen = document.createElement('canvas');
      offscreen.width = width;
      offscreen.height = height;
      const ctx = offscreen.getContext('2d')!;

      // Draw map
      ctx.drawImage(canvas, 0, 0);

      // Add watermark
      if (options?.includeWatermark !== false) {
        const center = map.getCenter();
        const zoom = map.getZoom().toFixed(1);
        const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
        const watermark = `RMPG FLEX  ${ts} UTC  ${center.lat.toFixed(5)},${center.lng.toFixed(5)}  Z${zoom}`;

        // Background bar
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(0, height - 28, width, 28);

        // Text
        ctx.font = '11px ui-monospace, monospace';
        ctx.fillStyle = '#d4a017';
        ctx.textBaseline = 'middle';
        ctx.fillText(watermark, 10, height - 14);

        // Right side
        ctx.textAlign = 'right';
        ctx.fillStyle = '#888';
        ctx.fillText('OFFICIAL USE ONLY', width - 10, height - 14);
        ctx.textAlign = 'left';
      }

      // Export
      const format = options?.format === 'jpeg' ? 'image/jpeg' : 'image/png';
      const quality = options?.quality ?? 0.95;
      const blob = await new Promise<Blob | null>(resolve =>
        offscreen.toBlob(resolve, format, quality)
      );

      if (blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = options?.filename ?? `rmpg-map-${Date.now()}.${format === 'image/jpeg' ? 'jpg' : 'png'}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.warn('[PrintExport] export failed:', err);
    } finally {
      setExporting(false);
    }
  }, [map, mapLoaded]);

  const copyToClipboard = useCallback(async () => {
    if (!map || !mapLoaded) return;

    setExporting(true);
    try {
      map.triggerRepaint();
      await new Promise(r => setTimeout(r, 100));

      const canvas = map.getCanvas();
      const blob = await new Promise<Blob | null>(resolve =>
        canvas.toBlob(resolve, 'image/png')
      );

      if (blob && navigator.clipboard?.write) {
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': blob }),
        ]);
      }
    } catch (err) {
      console.warn('[PrintExport] clipboard copy failed:', err);
    } finally {
      setExporting(false);
    }
  }, [map, mapLoaded]);

  return {
    exporting,
    exportImage,
    copyToClipboard,
  };
}
