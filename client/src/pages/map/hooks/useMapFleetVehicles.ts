import { useEffect, useRef, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import { apiFetch } from '../../../hooks/useApi';
import { getOverlayMarkerClass } from '../utils/mapMarkerBuilders';
import { safeDateTimeStr } from '../../../utils/dateUtils';

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

function getVehicleColor(status: string, gpsReportedAt: string | null): string {
  if (gpsReportedAt) {
    const reportedTime = new Date(gpsReportedAt).getTime();
    if (isNaN(reportedTime)) return '#666666';
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    if (reportedTime < oneHourAgo) return '#666666';
  } else {
    return '#666666';
  }

  switch (status) {
    case 'in_service': return '#22c55e';
    case 'maintenance': return '#f59e0b';
    case 'out_of_service': return '#dc2626';
    default: return '#666666';
  }
}

function buildVehicleInfoContent(vehicle: FleetVehicle): string {
  const color = getVehicleColor(vehicle.status, vehicle.gps_reported_at);
  const makeModel = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ');

  return `
    <div style="font-family:monospace;font-size:11px;color:#e0e0e0;min-width:220px;line-height:1.6;background:#050505;padding:10px 12px;border-radius:4px;border:1px solid #222222">
      <div style="font-weight:bold;font-size:13px;margin-bottom:6px;color:${color}">Vehicle ${vehicle.vehicle_number}</div>
      <table style="width:100%;font-size:11px;border-collapse:collapse">
        ${makeModel ? `<tr><td style="color:#888888;padding:1px 6px 1px 0">Vehicle</td><td style="color:#e0e0e0">${makeModel}</td></tr>` : ''}
        ${vehicle.plate_number ? `<tr><td style="color:#888888;padding:1px 6px 1px 0">Plate</td><td style="color:#e0e0e0">${vehicle.plate_number}</td></tr>` : ''}
        <tr><td style="color:#888888;padding:1px 6px 1px 0">Status</td><td style="color:#e0e0e0">${vehicle.status?.replace(/_/g, ' ')}</td></tr>
        ${vehicle.current_mileage != null ? `<tr><td style="color:#888888;padding:1px 6px 1px 0">Mileage</td><td style="color:#e0e0e0">${vehicle.current_mileage.toLocaleString()} mi</td></tr>` : ''}
        ${vehicle.next_service_due ? `<tr><td style="color:#888888;padding:1px 6px 1px 0">Next Service</td><td style="color:#e0e0e0">${vehicle.next_service_due}</td></tr>` : ''}
        ${vehicle.assigned_call_sign ? `<tr><td style="color:#888888;padding:1px 6px 1px 0">Assigned Unit</td><td style="color:#e0e0e0">${vehicle.assigned_call_sign}</td></tr>` : ''}
        ${vehicle.gps_reported_at ? `<tr><td style="color:#888888;padding:1px 6px 1px 0">GPS Time</td><td style="color:#e0e0e0">${safeDateTimeStr(vehicle.gps_reported_at)}</td></tr>` : ''}
        ${vehicle.gps_speed != null ? `<tr><td style="color:#888888;padding:1px 6px 1px 0">Speed</td><td style="color:#e0e0e0">${Math.round(vehicle.gps_speed)} mph</td></tr>` : ''}
      </table>
    </div>
  `;
}

const REFRESH_INTERVAL = 2 * 60 * 1000;

export function useMapFleetVehicles(
  map: mapboxgl.Map | null,
  enabled: boolean,
): UseMapFleetVehiclesReturn {
  const [vehicles, setVehicles] = useState<FleetVehicle[]>([]);
  const [loading, setLoading] = useState(false);

  const popupRef = useRef<mapboxgl.Popup | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sourceId = 'fleet-vehicles';

  const clearMarkers = useCallback(() => {
    if (map) {
      if (map.getLayer(sourceId)) map.removeLayer(sourceId);
      if (map.getSource(sourceId)) map.removeSource(sourceId);
    }
  }, [map]);

  const renderMarkers = useCallback((data: FleetVehicle[]) => {
    if (!map) return;

    clearMarkers();

    if (!popupRef.current) {
      popupRef.current = new mapboxgl.Popup({ maxWidth: '320px', closeButton: true, closeOnClick: false });
    }

    const withCoords = data.filter(
      (v) => v.gps_lat != null && v.gps_lon != null && !isNaN(Number(v.gps_lat)) && !isNaN(Number(v.gps_lon))
    );

    if (withCoords.length === 0) return;

    const features = withCoords.map((vehicle) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [Number(vehicle.gps_lon), Number(vehicle.gps_lat)] as [number, number] },
      properties: { id: vehicle.id, vehicle_number: vehicle.vehicle_number, status: vehicle.status, gps_reported_at: vehicle.gps_reported_at },
    }));

    map.addSource(sourceId, { type: 'geojson', data: { type: 'FeatureCollection', features } });
    map.addLayer({
      id: sourceId,
      type: 'circle',
      source: sourceId,
      paint: {
        'circle-color': [
          'case',
          ['==', ['get', 'status'], 'in_service'], '#22c55e',
          ['==', ['get', 'status'], 'maintenance'], '#f59e0b',
          ['==', ['get', 'status'], 'out_of_service'], '#dc2626',
          '#666666',
        ],
        'circle-radius': 12,
        'circle-stroke-color': '#fff',
        'circle-stroke-width': 2,
      },
    });

    map.on('click', sourceId, (e) => {
      const feature = e.features?.[0];
      if (!feature || !feature.properties) return;
      const vehicle = withCoords.find(v => v.id === feature.properties?.id);
      if (!vehicle) return;
      if (popupRef.current) {
        popupRef.current.setLngLat(e.lngLat).setHTML(buildVehicleInfoContent(vehicle)).addTo(map);
      }
    });
  }, [map, clearMarkers]);

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

  useEffect(() => {
    if (!map) return;

    if (!enabled) {
      clearMarkers();
      setVehicles([]);
      if (refreshTimerRef.current) {
        clearInterval(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      return;
    }

    fetchFleetData();
    refreshTimerRef.current = setInterval(fetchFleetData, REFRESH_INTERVAL);

    return () => {
      if (refreshTimerRef.current) {
        clearInterval(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [map, enabled, fetchFleetData, clearMarkers]);

  useEffect(() => {
    return () => {
      if (popupRef.current) {
        popupRef.current.remove();
        popupRef.current = null;
      }
      if (refreshTimerRef.current) {
        clearInterval(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, []);

  return { vehicles, loading, count: vehicles.filter((v) => v.gps_lat != null && v.gps_lon != null).length };
}
