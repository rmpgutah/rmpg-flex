// ============================================================
// RMPG Flex — useMapRepeatAddresses Hook
// Flags addresses with repeated calls for service, displaying
// color-coded circle markers with call counts and info windows.
// ============================================================

import { useEffect, useRef, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import { apiFetch } from '../../../hooks/useApi';

// ─── Types ──────────────────────────────────────────────────

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

// ─── Color thresholds ───────────────────────────────────────

function getColor(count: number): string {
  if (count >= 20) return '#991b1b';
  if (count >= 11) return '#dc2626';
  if (count >= 6) return '#f97316';
  if (count >= 4) return '#f59e0b';
  return '#eab308';
}

// ─── Create circle marker element using DOM API ─────────────

function createCountMarker(count: number): HTMLDivElement {
  const color = getColor(count);
  const size = count >= 20 ? 38 : count >= 11 ? 32 : count >= 6 ? 28 : 24;

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
    box-shadow: 0 2px 4px rgba(0,0,0,0.5);
    cursor: pointer;
  `;

  const label = document.createElement('span');
  label.style.cssText = 'color: white; font-size: 11px; font-weight: bold; line-height: 1;';
  label.textContent = String(count);
  el.appendChild(label);

  return el;
}

// ─── Build info window content using DOM API ────────────────

function buildInfoContent(addr: RepeatAddress): HTMLDivElement {
  const color = getColor(addr.call_count);

  const container = document.createElement('div');
  container.style.cssText = 'font-family:monospace;font-size:11px;color:#e0e0e0;min-width:220px;line-height:1.6;background:#050505;padding:10px 12px;border-radius:4px;border:1px solid #222222';

  const heading = document.createElement('div');
  heading.style.cssText = `font-weight:bold;font-size:13px;margin-bottom:6px;color:${color}`;
  heading.textContent = 'Repeat Call Address';
  container.appendChild(heading);

  const table = document.createElement('table');
  table.style.cssText = 'width:100%;font-size:11px;border-collapse:collapse';

  const addRow = (lbl: string, value: string, valColor?: string) => {
    const tr = document.createElement('tr');
    const tdLabel = document.createElement('td');
    tdLabel.style.cssText = 'color:#888888;padding:1px 6px 1px 0;white-space:nowrap';
    tdLabel.textContent = lbl;
    const tdVal = document.createElement('td');
    tdVal.style.cssText = `color:${valColor || '#e0e0e0'}`;
    tdVal.textContent = value;
    tr.appendChild(tdLabel);
    tr.appendChild(tdVal);
    table.appendChild(tr);
  };

  addRow('Address', addr.location_address || 'Unknown');
  addRow('Call Count', String(addr.call_count), color);

  if (addr.incident_types) {
    const types = addr.incident_types.split(',').map((t) => t.trim());
    addRow('Incident Types', types.join(', '));
  }

  if (addr.last_call) {
    const lastDate = new Date(addr.last_call).toLocaleDateString();
    addRow('Last Call', lastDate);
  }

  container.appendChild(table);
  return container;
}

// ─── Hook ───────────────────────────────────────────────────

export function useMapRepeatAddresses(
  map: mapboxgl.Map | null,
  enabled: boolean,
  days: number,
  minCount: number,
): UseMapRepeatAddressesReturn {
  const [addresses, setAddresses] = useState<RepeatAddress[]>([]);
  const [loading, setLoading] = useState(false);

  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const infoWindowRef = useRef<mapboxgl.Popup | null>(null);

  // ── Clear markers ─────────────────────────────────────────

  const clearMarkers = useCallback(() => {
    markersRef.current.forEach((m) => {
      m.remove();
    });
    markersRef.current = [];
  }, []);

  // ── Fetch data ────────────────────────────────────────────

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

  // ── Render markers ────────────────────────────────────────

  useEffect(() => {
    if (!map) return;

    clearMarkers();

    if (!enabled || addresses.length === 0) return;

    if (!infoWindowRef.current) {
      infoWindowRef.current = new mapboxgl.Popup({
        closeButton: true,
        closeOnClick: false,
        maxWidth: '360px',
        offset: 15,
      });
    }

    addresses.forEach((addr) => {
      if (addr.lat == null || addr.lng == null) return;

      const lat = Number(addr.lat);
      const lng = Number(addr.lng);
      if (isNaN(lat) || isNaN(lng)) return;

      const content = createCountMarker(addr.call_count);
      content.style.cursor = 'pointer';
      content.title = `${addr.call_count} calls — ${addr.location_address || 'Unknown'}`;

      content.addEventListener('click', () => {
        const infoContent = buildInfoContent(addr);
        const popup = infoWindowRef.current;
        if (popup) {
          popup.remove();
          popup.setLngLat([lng, lat]).setDOMContent(infoContent).addTo(map);
        }
      });

      const marker = new mapboxgl.Marker({ element: content })
        .setLngLat([lng, lat])
        .addTo(map);

      markersRef.current.push(marker);
    });

    return () => {
      clearMarkers();
    };
  }, [map, enabled, addresses, clearMarkers]);

  // ── Cleanup on unmount ────────────────────────────────────

  useEffect(() => {
    return () => {
      markersRef.current.forEach((m) => { m.remove(); });
      markersRef.current = [];
      if (infoWindowRef.current) {
        infoWindowRef.current.remove();
        infoWindowRef.current = null;
      }
    };
  }, []);

  return { addresses, loading, count: addresses.length };
}
