import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import { whenStyleReady } from '../utils/safeAddSource';

interface UnitPosition {
  call_sign: string;
  latitude?: number;
  longitude?: number;
  status?: string;
}

interface DeadZone {
  lat: number;
  lng: number;
  label: string;
}

interface RepositionSuggestion {
  fromCallSign: string;
  fromLat: number;
  fromLng: number;
  toLat: number;
  toLng: number;
}

interface UseMapCoverageGapsReturn {
  coverageCount: number;
  uncoveredArea: boolean;
  deadZones: DeadZone[];
  repositionSuggestions: RepositionSuggestion[];
}

const ON_DUTY_STATUSES = new Set([
  'available', 'dispatched', 'enroute', 'onscene', 'busy',
]);

const METERS_PER_MILE = 1609.34;

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const RESPONSE_SPEED_MPS = 13.4;
const FIVE_MINUTE_METERS = RESPONSE_SPEED_MPS * 300;

export function useMapCoverageGaps(
  map: mapboxgl.Map | null,
  units: UnitPosition[],
  enabled: boolean,
  radiusMiles: number,
): UseMapCoverageGapsReturn {
  const [coverageCount, setCoverageCount] = useState(0);
  const [deadZones, setDeadZones] = useState<DeadZone[]>([]);
  const [repositionSuggestions, setRepositionSuggestions] = useState<RepositionSuggestion[]>([]);

  const popupRef = useRef<mapboxgl.Popup | null>(null);
  const coverageSourceId = 'coverage-circles';
  const deadZoneSourceId = 'dead-zones';
  const repositionSourceId = 'reposition-lines';

  useEffect(() => {
    if (!map) return;

    [coverageSourceId, deadZoneSourceId, repositionSourceId].forEach(id => {
      if (map.getLayer(id)) map.removeLayer(id);
      if (map.getSource(id)) map.removeSource(id);
    });
    setCoverageCount(0);
    setDeadZones([]);
    setRepositionSuggestions([]);

    if (!enabled) return;

    const radiusMeters = radiusMiles * METERS_PER_MILE;

    const onDutyWithCoords = units.filter(
      (u) =>
        u.latitude != null &&
        u.longitude != null &&
        !isNaN(Number(u.latitude)) &&
        !isNaN(Number(u.longitude)) &&
        ON_DUTY_STATUSES.has(u.status || ''),
    );

    if (!popupRef.current) {
      popupRef.current = new mapboxgl.Popup({ maxWidth: '320px', closeButton: true, closeOnClick: false });
    }

    const coverageFeatures: any[] = [];

    onDutyWithCoords.forEach((unit) => {
      const lat = Number(unit.latitude);
      const lng = Number(unit.longitude);

      const nearbyCount = onDutyWithCoords.filter((other) => {
        if (other.call_sign === unit.call_sign) return false;
        const dist = haversineMeters(lat, lng, Number(other.latitude), Number(other.longitude));
        return dist < radiusMeters * 1.5;
      }).length;

      let color: string;
      let opacity: number;
      let strokeOpacity: number;
      if (nearbyCount >= 3) {
        color = '#22c55e'; opacity = 0.12; strokeOpacity = 0.5;
      } else if (nearbyCount === 2) {
        color = '#4ade80'; opacity = 0.10; strokeOpacity = 0.4;
      } else if (nearbyCount === 1) {
        color = '#fbbf24'; opacity = 0.08; strokeOpacity = 0.35;
      } else {
        color = '#f97316'; opacity = 0.06; strokeOpacity = 0.3;
      }

      coverageFeatures.push({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [lng, lat] as [number, number] },
        properties: {
          call_sign: unit.call_sign,
          color,
          radius: radiusMeters,
          nearbyCount,
          densityLabel: nearbyCount >= 3 ? 'Excellent' : nearbyCount === 2 ? 'Good' : nearbyCount === 1 ? 'Moderate' : 'Sparse',
        },
      });
    });

    if (coverageFeatures.length > 0) {
      whenStyleReady(map, () => {
        map.addSource(coverageSourceId, { type: 'geojson', data: { type: 'FeatureCollection', features: coverageFeatures } });
        map.addLayer({
          id: coverageSourceId,
          type: 'circle',
          source: coverageSourceId,
          paint: {
            'circle-color': ['get', 'color'],
            'circle-radius': ['get', 'radius'],
            'circle-opacity': ['get', 'color'],
            'circle-stroke-color': ['get', 'color'],
            'circle-stroke-width': 1.5,
            'circle-stroke-opacity': 0.35,
          },
        });

        map.on('click', coverageSourceId, (e) => {
          const feature = e.features?.[0];
          if (!feature || !feature.properties) return;
          const p = feature.properties;
          const color = p.color as string;
          const nearbyCount = p.nearbyCount as number;

          const html = `
            <div style="font-family:'JetBrains Mono',monospace;font-size:11px;color:#e0e0e0;min-width:200px;line-height:1.6;background:#050505;padding:10px 12px;border-radius:4px;border:1px solid #222222">
              <div style="font-weight:bold;font-size:12px;margin-bottom:4px;color:${color}">Coverage \u2014 ${p.call_sign}</div>
              <div style="font-size:10px;color:${color};font-weight:700;margin-bottom:2px;">${p.densityLabel} (${nearbyCount} nearby unit${nearbyCount !== 1 ? 's' : ''})</div>
              <div style="font-size:9px;color:#6b7280;">Radius: ${radiusMiles} mi (${Math.round(radiusMeters)} m)</div>
            </div>
          `;
          if (popupRef.current) {
            popupRef.current.setLngLat(e.lngLat).setHTML(html).addTo(map);
          }
        });
      });
    }

    const bounds = map.getBounds();
    if (bounds && onDutyWithCoords.length > 0) {
      const ne = bounds.getNorthEast();
      const sw = bounds.getSouthWest();
      const latStep = (ne.lat - sw.lat) / 8;
      const lngStep = (ne.lng - sw.lng) / 8;
      const foundDeadZones: DeadZone[] = [];
      const deadZoneFeatures: any[] = [];

      for (let latI = 0; latI <= 8; latI++) {
        for (let lngI = 0; lngI <= 8; lngI++) {
          const testLat = sw.lat + latI * latStep;
          const testLng = sw.lng + lngI * lngStep;

          let minDist = Infinity;
          for (const u of onDutyWithCoords) {
            const d = haversineMeters(testLat, testLng, Number(u.latitude), Number(u.longitude));
            if (d < minDist) minDist = d;
          }

          if (minDist > FIVE_MINUTE_METERS) {
            foundDeadZones.push({
              lat: testLat,
              lng: testLng,
              label: `${Math.round(minDist / METERS_PER_MILE * 10) / 10} mi from nearest unit`,
            });

            deadZoneFeatures.push({
              type: 'Feature' as const,
              geometry: { type: 'Point' as const, coordinates: [testLng, testLat] as [number, number] },
              properties: { label: `${Math.round(minDist / METERS_PER_MILE * 10) / 10} mi from nearest unit` },
            });
          }
        }
      }
      setDeadZones(foundDeadZones);

      if (deadZoneFeatures.length > 0) {
        whenStyleReady(map, () => {
          map.addSource(deadZoneSourceId, { type: 'geojson', data: { type: 'FeatureCollection', features: deadZoneFeatures } });
          map.addLayer({
            id: deadZoneSourceId,
            type: 'circle',
            source: deadZoneSourceId,
            paint: {
              'circle-color': '#ef4444',
              'circle-radius': FIVE_MINUTE_METERS * 0.5,
              'circle-opacity': 0.06,
              'circle-stroke-color': '#ef4444',
              'circle-stroke-width': 1,
              'circle-stroke-opacity': 0.25,
            },
          });

          map.on('click', deadZoneSourceId, (e) => {
            const feature = e.features?.[0];
            if (!feature || !feature.properties) return;
            const html = `
              <div style="font-family:'JetBrains Mono',monospace;font-size:11px;color:#e0e0e0;min-width:180px;line-height:1.6;background:#050505;padding:10px 12px;border-radius:4px;border:1px solid #ef444440">
                <div style="font-weight:bold;font-size:12px;margin-bottom:4px;color:#ef4444">Dead Zone</div>
                <div style="font-size:9px;color:#f87171;">No unit within 5-min response time</div>
                <div style="font-size:9px;color:#6b7280;margin-top:2px;">${feature.properties.label}</div>
              </div>
            `;
            if (popupRef.current) {
              popupRef.current.setLngLat(e.lngLat).setHTML(html).addTo(map);
            }
          });
        });
      }

      if (foundDeadZones.length > 0) {
        const dzCenterLat = foundDeadZones.reduce((s, d) => s + d.lat, 0) / foundDeadZones.length;
        const dzCenterLng = foundDeadZones.reduce((s, d) => s + d.lng, 0) / foundDeadZones.length;

        const availableUnits = onDutyWithCoords.filter(u => u.status === 'available');
        const suggestions: RepositionSuggestion[] = [];
        const repositionFeatures: any[] = [];

        if (availableUnits.length > 0) {
          const sorted = [...availableUnits].sort((a, b) => {
            const dA = haversineMeters(Number(a.latitude), Number(a.longitude), dzCenterLat, dzCenterLng);
            const dB = haversineMeters(Number(b.latitude), Number(b.longitude), dzCenterLat, dzCenterLng);
            return dA - dB;
          });

          sorted.slice(0, 2).forEach((unit) => {
            const fromLat = Number(unit.latitude);
            const fromLng = Number(unit.longitude);
            const toLat = (fromLat + dzCenterLat) / 2;
            const toLng = (fromLng + dzCenterLng) / 2;

            suggestions.push({ fromCallSign: unit.call_sign, fromLat, fromLng, toLat, toLng });

            repositionFeatures.push({
              type: 'Feature' as const,
              geometry: { type: 'LineString' as const, coordinates: [[fromLng, fromLat], [toLng, toLat]] as [number, number][] },
              properties: {},
            });
          });
        }
        setRepositionSuggestions(suggestions);

        if (repositionFeatures.length > 0) {
          whenStyleReady(map, () => {
            map.addSource(repositionSourceId, { type: 'geojson', data: { type: 'FeatureCollection', features: repositionFeatures } });
            map.addLayer({
              id: repositionSourceId,
              type: 'line',
              source: repositionSourceId,
              paint: {
                'line-color': '#aaaaaa',
                'line-width': 2,
                'line-opacity': 0.6,
              },
            });
          });
        }
      }
    }

    setCoverageCount(onDutyWithCoords.length);

    return () => {
      [coverageSourceId, deadZoneSourceId, repositionSourceId].forEach(id => {
        if (map.getLayer(id)) map.removeLayer(id);
        if (map.getSource(id)) map.removeSource(id);
      });
    };
  }, [map, units, enabled, radiusMiles]);

  useEffect(() => {
    return () => {
      if (popupRef.current) {
        popupRef.current.remove();
        popupRef.current = null;
      }
    };
  }, []);

  return { coverageCount, uncoveredArea: coverageCount === 0, deadZones, repositionSuggestions };
}
