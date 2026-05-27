import { useEffect, useRef, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import { apiFetch } from '../../../hooks/useApi';
import { getOverlayMarkerClass } from '../utils/mapMarkerBuilders';
import { whenStyleReady } from '../utils/safeAddSource';

interface RepeatAddress {
  location_address: string;
  lat: number;
  lng: number;
  call_count: number;
  incident_types: string;
  last_call: string;
}

interface UseMapRepeatAddressesReturn {
  addresses: RepeatAddress[];
  loading: boolean;
  count: number;
}

function getColor(count: number): string {
  if (count >= 20) return '#991b1b';
  if (count >= 11) return '#dc2626';
  if (count >= 6) return '#f97316';
  if (count >= 4) return '#f59e0b';
  return '#eab308';
}

function buildInfoContent(addr: RepeatAddress): string {
  const color = getColor(addr.call_count);
  const types = addr.incident_types ? addr.incident_types.split(',').map((t) => t.trim()).join(', ') : '';
  const lastDate = addr.last_call ? new Date(addr.last_call).toLocaleDateString() : '';

  return `
    <div style="font-family:monospace;font-size:11px;color:#e0e0e0;min-width:220px;line-height:1.6;background:#050505;padding:10px 12px;border-radius:4px;border:1px solid #222222">
      <div style="font-weight:bold;font-size:13px;margin-bottom:6px;color:${color}">Repeat Call Address</div>
      <table style="width:100%;font-size:11px;border-collapse:collapse">
        <tr><td style="color:#888888;padding:1px 6px 1px 0;white-space:nowrap">Address</td><td style="color:#e0e0e0">${addr.location_address || 'Unknown'}</td></tr>
        <tr><td style="color:#888888;padding:1px 6px 1px 0;white-space:nowrap">Call Count</td><td style="color:${color}">${addr.call_count}</td></tr>
        ${types ? `<tr><td style="color:#888888;padding:1px 6px 1px 0;white-space:nowrap">Incident Types</td><td style="color:#e0e0e0">${types}</td></tr>` : ''}
        ${lastDate ? `<tr><td style="color:#888888;padding:1px 6px 1px 0;white-space:nowrap">Last Call</td><td style="color:#e0e0e0">${lastDate}</td></tr>` : ''}
      </table>
    </div>
  `;
}

export function useMapRepeatAddresses(
  map: mapboxgl.Map | null,
  enabled: boolean,
  days: number,
  minCount: number,
): UseMapRepeatAddressesReturn {
  const [addresses, setAddresses] = useState<RepeatAddress[]>([]);
  const [loading, setLoading] = useState(false);

  const popupRef = useRef<mapboxgl.Popup | null>(null);
  const sourceId = 'repeat-addresses';

  const clearMarkers = useCallback(() => {
    if (map) {
      if (map.getLayer(sourceId)) map.removeLayer(sourceId);
      if (map.getSource(sourceId)) map.removeSource(sourceId);
    }
  }, [map]);

  useEffect(() => {
    if (!enabled) {
      setAddresses([]);
      return;
    }

    let cancelled = false;
    setLoading(true);

    apiFetch<RepeatAddress[]>(`/dispatch/repeat-addresses?days=${days}&min_count=${minCount}`)
      .then((data) => {
        if (!cancelled) {
          setAddresses(Array.isArray(data) ? data : []);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.warn('[useMapRepeatAddresses] Repeat addresses fetch failed:', err);
          setAddresses([]);
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [enabled, days, minCount]);

  useEffect(() => {
    if (!map) return;

    clearMarkers();

    if (!enabled || addresses.length === 0) return;

    if (!popupRef.current) {
      popupRef.current = new mapboxgl.Popup({ maxWidth: '320px', closeButton: true, closeOnClick: false });
    }

    const features = addresses
      .filter((addr) => addr.lat != null && addr.lng != null && !isNaN(addr.lat) && !isNaN(addr.lng))
      .map((addr) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [addr.lng, addr.lat] as [number, number] },
        properties: { call_count: addr.call_count, location_address: addr.location_address },
      }));

    if (features.length === 0) return;

    whenStyleReady(map, () => {
      map.addSource(sourceId, { type: 'geojson', data: { type: 'FeatureCollection', features } });
      map.addLayer({
        id: sourceId,
        type: 'circle',
        source: sourceId,
        paint: {
          'circle-color': [
            'case',
            ['>=', ['get', 'call_count'], 20], '#991b1b',
            ['>=', ['get', 'call_count'], 11], '#dc2626',
            ['>=', ['get', 'call_count'], 6], '#f97316',
            ['>=', ['get', 'call_count'], 4], '#f59e0b',
            '#eab308',
          ],
          'circle-radius': [
            'case',
            ['>=', ['get', 'call_count'], 20], 19,
            ['>=', ['get', 'call_count'], 11], 16,
            ['>=', ['get', 'call_count'], 6], 14,
            12,
          ],
          'circle-stroke-color': '#fff',
          'circle-stroke-width': 2,
        },
      });

      map.on('click', sourceId, (e) => {
        const feature = e.features?.[0];
        if (!feature || !feature.properties) return;
        const addr = addresses.find(a => a.lat === e.lngLat.lat && a.lng === e.lngLat.lng);
        if (!addr) return;
        if (popupRef.current) {
          popupRef.current.setLngLat(e.lngLat).setHTML(buildInfoContent(addr)).addTo(map);
        }
      });
    });

    return () => {
      clearMarkers();
    };
  }, [map, enabled, addresses, clearMarkers]);

  useEffect(() => {
    return () => {
      if (popupRef.current) {
        popupRef.current.remove();
        popupRef.current = null;
      }
    };
  }, []);

  return { addresses, loading, count: addresses.length };
}
