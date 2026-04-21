import { useEffect, useRef, useState } from 'react';
import type OlMap from 'ol/Map';
import type Feature from 'ol/Feature';
import type Geometry from 'ol/geom/Geometry';

export interface HoverTooltipState {
  /** Pixel position relative to the map viewport (translate the chrome) */
  x: number;
  y: number;
  /** Single-line label */
  label: string;
}

/** Build the tooltip label per feature kind. Keep concise — 1 short line. */
function labelForFeature(f: Feature<Geometry>): string | null {
  const kind = f.get('kind');
  const p: any = f.get('payload');
  if (!kind || !p) return null;
  switch (kind) {
    case 'unit':
      return `${p.call_sign || 'Unit'}\u00A0\u00B7\u00A0${p.status || ''}`.trim();
    case 'call':
      return `${p.call_number || 'Call'}\u00A0\u00B7\u00A0${p.priority || ''}\u00A0${p.incident_type || ''}`.trim();
    case 'fi':
      return `FI ${p.fi_number || ''}`.trim();
    case 'incident':
      return `${p.incident_number || 'Incident'}\u00A0${p.incident_type ? '\u00B7\u00A0' + p.incident_type : ''}`;
    case 'checkpoint':
      return `${p.name || 'Checkpoint'}`;
    case 'fleet':
      return `${p.vehicle_number || 'Vehicle'}\u00A0${p.year || ''}\u00A0${p.make || ''}`.trim();
    case 'repeat_address':
      return `${p.call_count || 0} calls\u00A0\u00B7\u00A0${p.location_address || ''}`;
    case 'dwell':
      return `${p.call_sign || 'Unit'}\u00A0\u00B7\u00A0${p.dwell_minutes || 0}m dwell`;
    case 'prediction':
      return `Hotspot\u00A0\u00B7\u00A0score ${(p.score ?? 0).toFixed(2)}`;
    case 'call_history':
      return `${p.call_number || ''}\u00A0\u00B7\u00A0${p.disposition || p.status || ''}`;
    case 'panic':
      return `\u26A0 PANIC\u00A0\u00B7\u00A0${p.officer_name || ''}`;
    case 'breadcrumb':
      return `${p.call_sign || ''}\u00A0\u00B7\u00A0${typeof p.speed === 'number' ? (p.speed * 2.237).toFixed(0) + ' mph' : ''}`;
    case 'geofence':
      return `${p.name || 'Geofence'}`;
    default:
      return null;
  }
}

/**
 * Lightweight hover tooltip for /map-v2 markers — separate from the
 * click popup. Shows a 1-line label following the cursor when hovering
 * any feature with kind+payload props. Clears on mouseleave or when
 * hovering empty map.
 *
 * Throttled to OL pointermove (browser-coalesced ~30Hz) — no manual
 * debounce. Only does hit-tests on layers that have markers; tile layer
 * and basemap chrome don't trigger.
 */
export function useOlHoverTooltip(map: OlMap | null): HoverTooltipState | null {
  const [tooltip, setTooltip] = useState<HoverTooltipState | null>(null);
  const lastFeatureRef = useRef<Feature<Geometry> | null>(null);

  useEffect(() => {
    if (!map) return;
    const target = map.getViewport();

    const onMove = (evt: any) => {
      if (evt.dragging) { setTooltip(null); return; }
      const feature = map.forEachFeatureAtPixel(
        evt.pixel,
        (f) => (f.get('kind') ? f as Feature<Geometry> : undefined),
        { hitTolerance: 4 },
      );
      if (!feature) {
        if (lastFeatureRef.current) {
          lastFeatureRef.current = null;
          setTooltip(null);
          target.style.cursor = '';
        }
        return;
      }
      const label = labelForFeature(feature);
      if (!label) return;
      lastFeatureRef.current = feature;
      target.style.cursor = 'pointer';
      // OL pixel is relative to the viewport — convert to absolute via getBoundingClientRect
      const rect = target.getBoundingClientRect();
      setTooltip({ x: rect.left + evt.pixel[0], y: rect.top + evt.pixel[1], label });
    };
    const onLeave = () => {
      lastFeatureRef.current = null;
      setTooltip(null);
      target.style.cursor = '';
    };
    map.on('pointermove', onMove);
    target.addEventListener('mouseleave', onLeave);
    return () => {
      map.un('pointermove', onMove);
      target.removeEventListener('mouseleave', onLeave);
      target.style.cursor = '';
    };
  }, [map]);

  return tooltip;
}
