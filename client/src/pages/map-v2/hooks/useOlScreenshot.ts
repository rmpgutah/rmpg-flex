import { useCallback } from 'react';
import type OlMap from 'ol/Map';
import { devWarn } from '../../../utils/devLog';

/**
 * Screenshot tool for /map-v2.
 *
 * Captures the current map canvas as a PNG and triggers a browser
 * download. Uses the OL pattern: schedule render, wait for
 * 'rendercomplete', then composite all tile/vector canvases into a
 * single canvas via toBlob().
 *
 * Why not the simpler getViewport() approach: OL renders each layer
 * to its own canvas and composites at paint time. Reading just one
 * canvas misses the other layers. Compositing manually mirrors what
 * the user sees.
 */
export function useOlScreenshot(map: OlMap | null) {
  const capture = useCallback(() => {
    if (!map) return;
    map.once('rendercomplete', () => {
      const size = map.getSize();
      if (!size) return;
      const [w, h] = size;
      const out = document.createElement('canvas');
      out.width = w;
      out.height = h;
      const ctx = out.getContext('2d');
      if (!ctx) return;

      const canvases = map.getViewport().querySelectorAll<HTMLCanvasElement>('canvas');
      canvases.forEach((c) => {
        if (c.width === 0 || c.height === 0) return;
        const opacity = (c.parentElement && (c.parentElement as HTMLElement).style.opacity) || c.style.opacity;
        ctx.globalAlpha = opacity === '' ? 1 : Number(opacity);
        const tx = c.style.transform;
        // Parse the matrix() transform OL applies to align canvases
        const matrix = (tx.match(/^matrix\(([^)]+)\)$/) || [])[1];
        if (matrix) {
          const parts = matrix.split(',').map((s) => Number(s));
          if (parts.length === 6 && parts.every(Number.isFinite)) {
            ctx.setTransform(parts[0], parts[1], parts[2], parts[3], parts[4], parts[5]);
          }
        }
        try {
          ctx.drawImage(c, 0, 0);
        } catch (err) {
          devWarn('[map-v2] screenshot drawImage failed (tainted canvas?):', err);
        }
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1;
      });

      out.toBlob((blob) => {
        if (!blob) return;
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `map-v2-${ts}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
      }, 'image/png');
    });
    map.renderSync();
  }, [map]);

  return capture;
}
