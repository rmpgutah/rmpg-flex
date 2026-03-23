// ============================================================
// RMPG Flex — useMapRepeatAddresses Hook
// Flags addresses with repeated calls for service, displaying
// color-coded circle markers with call counts and info windows.
// ============================================================

import { useEffect, useRef, useState, useCallback } from 'react';
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
  if (count >= 11) return '#dc2626'; // red
  if (count >= 6) return '#f97316';  // orange
  return '#f59e0b';                  // amber (3-5)
}

// ─── Create circle marker element using DOM API ─────────────

function createCountMarker(count: number): HTMLDivElement {
  const color = getColor(count);
  const size = count >= 11 ? 32 : count >= 6 ? 28 : 24;

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
  container.style.cssText = 'font-family:monospace;font-size:11px;color:#e0e0e0;min-width:220px;line-height:1.6;background:#0a0e14;padding:10px 12px;border-radius:4px;border:1px solid #1e2a3a';

  const heading = document.createElement('div');
  heading.style.cssText = `font-weight:bold;font-size:13px;margin-bottom:6px;color:${color}`;
  heading.textContent = 'Repeat Call Address';
  container.appendChild(heading);

  const table = document.createElement('table');
  table.style.cssText = 'width:100%;font-size:11px;border-collapse:collapse';

  const addRow = (lbl: string, value: string, valColor?: string) => {
    const tr = document.createElement('tr');
    const tdLabel = document.createElement('td');
    tdLabel.style.cssText = 'color:#6b7b8d;padding:1px 6px 1px 0;white-space:nowrap';
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

  // Incident types breakdown
  if (addr.incident_types) {
    const types = addr.incident_types.split(',').map((t) => t.trim());
    addRow('Incident Types', types.join(', '));
  }

  // Last call date
  if (addr.last_call) {
    const lastDate = new Date(addr.last_call).toLocaleDateString();
    addRow('Last Call', lastDate);
  }

  container.appendChild(table);
  return container;
}

// ─── Hook ───────────────────────────────────────────────────

export function useMapRepeatAddresses(
  map: google.maps.Map | null,
  enabled: boolean,
  days: number,
  minCount: number,
): UseMapRepeatAddressesReturn {
  const [addresses, setAddresses] = useState<RepeatAddress[]>([]);
  const [loading, setLoading] = useState(false);

  const markersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([]);
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);

  // ── Clear markers ─────────────────────────────────────────

  const clearMarkers = useCallback(() => {
    markersRef.current.forEach((m) => {
      if (window.google?.maps?.event) google.maps.event.clearInstanceListeners(m);
      m.map = null;
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
      .catch(() => {
        if (!cancelled) {
          setAddresses([]);
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [enabled, days, minCount]);

  // ── Render markers ────────────────────────────────────────

  useEffect(() => {
    if (!map || !window.google?.maps) return;

    clearMarkers();

    if (!enabled || addresses.length === 0) return;

    if (!infoWindowRef.current) {
      infoWindowRef.current = new google.maps.InfoWindow();
    }

    const hasAdvancedMarker = !!window.google?.maps?.marker?.AdvancedMarkerElement;

    addresses.forEach((addr) => {
      if (addr.lat == null || addr.lng == null) return;

      const lat = Number(addr.lat);
      const lng = Number(addr.lng);
      if (isNaN(lat) || isNaN(lng)) return;

      if (!hasAdvancedMarker) return;

      const content = createCountMarker(addr.call_count);

      const marker = new google.maps.marker.AdvancedMarkerElement({
        map,
        position: { lat, lng },
        content,
        title: `${addr.call_count} calls — ${addr.location_address || 'Unknown'}`,
        zIndex: 25,
      });

      marker.addListener('click', () => {
        const infoContent = buildInfoContent(addr);
        infoWindowRef.current?.setContent(infoContent);
        infoWindowRef.current?.setPosition({ lat, lng });
        infoWindowRef.current?.open(map);
      });

      markersRef.current.push(marker);
    });

    return () => {
      clearMarkers();
    };
  }, [map, enabled, addresses, clearMarkers]);

  // ── Cleanup on unmount ────────────────────────────────────

  useEffect(() => {
    return () => {
      markersRef.current.forEach((m) => { m.map = null; });
      markersRef.current = [];
      if (infoWindowRef.current) {
        infoWindowRef.current.close();
        infoWindowRef.current = null;
      }
    };
  }, []);

  return { addresses, loading, count: addresses.length };
}
