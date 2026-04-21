// ============================================================
// RMPG Flex — useMapFleetVehicles Hook
// Fleet vehicle location markers on the map with color-coded
// status indicators and GPS staleness detection.
// ============================================================

import { useEffect, useRef, useState, useCallback } from 'react';
import { apiFetch } from '../../../hooks/useApi';
import { getOverlayMarkerClass } from '../utils/mapMarkerBuilders';

// ─── Types ──────────────────────────────────────────────────

interface FleetVehicle {
  id: number;
  vehicle_number: string;
  make: string | null;
  model: string | null;
  year: number | null;
  plate_number: string | null;
  status: string;
  current_mileage: number | null;
  next_service_due: string | null;
  assigned_unit_id: number | null;
  assigned_call_sign: string | null;
  gps_lat: number | null;
  gps_lon: number | null;
  gps_speed: number | null;
  gps_heading: number | null;
  gps_reported_at: string | null;
}

interface UseMapFleetVehiclesReturn {
  vehicles: FleetVehicle[];
  loading: boolean;
  count: number;
}

// ─── Status color mapping ───────────────────────────────────

function getVehicleColor(status: string, gpsReportedAt: string | null): string {
  // If GPS data is stale (> 1 hour), show gray regardless of status
  if (gpsReportedAt) {
    const reportedTime = new Date(gpsReportedAt).getTime();
    if (isNaN(reportedTime)) return '#666666'; // invalid date — gray
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    if (reportedTime < oneHourAgo) return '#666666'; // gray
  } else {
    // No GPS time at all — stale
    return '#666666';
  }

  switch (status) {
    case 'in_service': return '#22c55e';      // green
    case 'maintenance': return '#f59e0b';      // amber (maintenance_due equivalent)
    case 'out_of_service': return '#dc2626';   // red
    default: return '#666666';                 // gray
  }
}

// ─── Create marker HTML element ─────────────────────────────

function createVehicleMarkerElement(vehicle: FleetVehicle): HTMLDivElement {
  const color = getVehicleColor(vehicle.status, vehicle.gps_reported_at);

  const el = document.createElement('div');
  el.style.cssText = `
    background: ${color};
    width: 28px;
    height: 28px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 2px solid white;
    box-shadow: 0 2px 4px rgba(0,0,0,0.5);
    cursor: pointer;
    position: relative;
  `;

  // Fix 78: add direction arrow based on heading
  if (vehicle.gps_heading != null && vehicle.gps_speed != null && vehicle.gps_speed > 1) {
    const arrow = document.createElement('div');
    arrow.style.cssText = `
      position: absolute;
      top: -4px;
      left: 50%;
      transform: translateX(-50%) rotate(${vehicle.gps_heading || 0}deg);
      transform-origin: center bottom;
      width: 0;
      height: 0;
      border-left: 4px solid transparent;
      border-right: 4px solid transparent;
      border-bottom: 8px solid ${color};
    `;
    el.appendChild(arrow);
  }

  const label = document.createElement('span');
  label.style.cssText = 'color: white; font-size: 14px; font-weight: bold; line-height: 1;';
  label.textContent = 'V';
  el.appendChild(label);

  return el;
}

// ─── Build info window content ──────────────────────────────

function buildVehicleInfoContent(vehicle: FleetVehicle): HTMLDivElement {
  const color = getVehicleColor(vehicle.status, vehicle.gps_reported_at);

  const container = document.createElement('div');
  container.style.cssText = 'font-family:monospace;font-size:11px;color:#e0e0e0;min-width:220px;line-height:1.6;background:#050505;padding:10px 12px;border-radius:4px;border:1px solid #222222';

  const heading = document.createElement('div');
  heading.style.cssText = `font-weight:bold;font-size:13px;margin-bottom:6px;color:${color}`;
  heading.textContent = `Vehicle ${vehicle.vehicle_number}`;
  container.appendChild(heading);

  const table = document.createElement('table');
  table.style.cssText = 'width:100%;font-size:11px;border-collapse:collapse';

  const addRow = (lbl: string, value: unknown, valColor?: string) => {
    if (value == null || value === '') return;
    const tr = document.createElement('tr');
    const tdLabel = document.createElement('td');
    tdLabel.style.cssText = 'color:#888888;padding:1px 6px 1px 0';
    tdLabel.textContent = lbl;
    const tdValue = document.createElement('td');
    tdValue.style.cssText = `color:${valColor || '#e0e0e0'}`;
    tdValue.textContent = String(value);
    tr.appendChild(tdLabel);
    tr.appendChild(tdValue);
    table.appendChild(tr);
  };

  // Vehicle details
  const makeModel = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ');
  addRow('Vehicle', makeModel || undefined);
  addRow('Plate', vehicle.plate_number);
  addRow('Status', vehicle.status?.replace(/_/g, ' '));
  addRow('Mileage', vehicle.current_mileage ? `${vehicle.current_mileage.toLocaleString()} mi` : undefined);
  addRow('Next Service', vehicle.next_service_due);
  addRow('Assigned Unit', vehicle.assigned_call_sign);

  // GPS info
  if (vehicle.gps_reported_at) {
    const gpsTime = new Date(vehicle.gps_reported_at);
    addRow('GPS Time', gpsTime.toLocaleString());
    if (vehicle.gps_speed != null) {
      addRow('Speed', `${Math.round(vehicle.gps_speed)} mph`);
    }
  }

  container.appendChild(table);
  return container;
}

// ─── Hook ───────────────────────────────────────────────────

const REFRESH_INTERVAL = 2 * 60 * 1000; // 2 minutes

export function useMapFleetVehicles(
  map: google.maps.Map | null,
  enabled: boolean,
): UseMapFleetVehiclesReturn {
  const [vehicles, setVehicles] = useState<FleetVehicle[]>([]);
  const [loading, setLoading] = useState(false);

  const markersRef = useRef<google.maps.OverlayView[]>([]);
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Clear all markers ─────────────────────────────────────

  const clearMarkers = useCallback(() => {
    markersRef.current.forEach((m) => {
      m.setMap(null);
    });
    markersRef.current = [];
  }, []);

  // ── Render markers ────────────────────────────────────────

  const renderMarkers = useCallback((data: FleetVehicle[]) => {
    const OverlayMarkerClass = getOverlayMarkerClass();
    if (!map || !OverlayMarkerClass) return;

    clearMarkers();

    if (!infoWindowRef.current) {
      infoWindowRef.current = new google.maps.InfoWindow();
    }

    const withCoords = data.filter(
      (v) => v.gps_lat != null && v.gps_lon != null && !isNaN(Number(v.gps_lat)) && !isNaN(Number(v.gps_lon))
    );

    withCoords.forEach((vehicle) => {
      const lat = Number(vehicle.gps_lat);
      const lng = Number(vehicle.gps_lon);

      const content = createVehicleMarkerElement(vehicle);

      const marker = new OverlayMarkerClass({
        map,
        position: { lat, lng },
        content,
        title: `Vehicle ${vehicle.vehicle_number}`,
        zIndex: 15,
        onClick: () => {
          const infoContent = buildVehicleInfoContent(vehicle);
          infoWindowRef.current?.setContent(infoContent);
          infoWindowRef.current?.setPosition({ lat, lng });
          infoWindowRef.current?.open(map);
        },
      });

      markersRef.current.push(marker as unknown as google.maps.OverlayView);
    });
  }, [map, clearMarkers]);

  // ── Fetch fleet data ──────────────────────────────────────

  const fetchFleetData = useCallback(() => {
    if (!enabled) return;

    let cancelled = false;
    setLoading(true);

    apiFetch<FleetVehicle[]>('/fleet/map')
      .then((data) => {
        if (cancelled) return;
        const records = Array.isArray(data) ? data : [];
        setVehicles(records);
        if (enabled) {
          renderMarkers(records);
        }
        setLoading(false);
      })
      .catch((err) => {
        if (!cancelled) {
          console.warn('[useMapFleetVehicles] Fleet data fetch failed:', err);
          setLoading(false);
        }
      });
  }, [enabled, renderMarkers]);

  // ── Enable/disable + refresh cycle ────────────────────────

  useEffect(() => {
    if (!map || !window.google?.maps) return;

    if (!enabled) {
      clearMarkers();
      setVehicles([]);
      if (refreshTimerRef.current) {
        clearInterval(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      return;
    }

    // Initial fetch
    fetchFleetData();

    // Refresh every 2 minutes
    refreshTimerRef.current = setInterval(fetchFleetData, REFRESH_INTERVAL);

    return () => {
      if (refreshTimerRef.current) {
        clearInterval(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [map, enabled, fetchFleetData, clearMarkers]);

  // ── Cleanup on unmount ────────────────────────────────────

  useEffect(() => {
    return () => {
      markersRef.current.forEach((m) => { m.setMap(null); });
      markersRef.current = [];
      if (infoWindowRef.current) {
        infoWindowRef.current.close();
        infoWindowRef.current = null;
      }
      if (refreshTimerRef.current) {
        clearInterval(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, []);

  return { vehicles, loading, count: vehicles.filter(
    (v) => v.gps_lat != null && v.gps_lon != null
  ).length };
}
