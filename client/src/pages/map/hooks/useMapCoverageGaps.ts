// ============================================================
// RMPG Flex — useMapCoverageGaps Hook
// Unit coverage map: draws radius circles around on-duty units
// to visualize patrol coverage and identify gaps.
// ============================================================

import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';

// ─── Types ──────────────────────────────────────────────────

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

// ─── On-duty statuses ───────────────────────────────────────

const ON_DUTY_STATUSES = new Set([
  'available', 'dispatched', 'enroute', 'onscene', 'busy',
]);

// ─── Meters per mile ────────────────────────────────────────

const METERS_PER_MILE = 1609.34;

// ─── Hook ───────────────────────────────────────────────────

// ── Haversine distance (meters) for coverage calculations ───
function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Response time estimate: ~30 mph average patrol speed
const RESPONSE_SPEED_MPS = 13.4;
const FIVE_MINUTE_METERS = RESPONSE_SPEED_MPS * 300;

function circleToPolygon(center: [number, number], radiusM: number, segments = 32): [number, number][] {
  const coords: [number, number][] = [];
  const metersPerDegLat = 111320;
  const metersPerDegLng = 111320 * Math.cos(center[1] * Math.PI / 180);
  const dLat = radiusM / metersPerDegLat;
  const dLng = radiusM / metersPerDegLng;
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * 2 * Math.PI;
    coords.push([center[0] + dLng * Math.cos(angle), center[1] + dLat * Math.sin(angle)]);
  }
  return coords;
}

const COVERAGE_SOURCE = 'coverage-source';
const COVERAGE_LAYER = 'coverage-layer';
const DEADZONE_SOURCE = 'deadzone-source';
const DEADZONE_LAYER = 'deadzone-layer';
const ARROWS_SOURCE = 'reposition-arrows-source';
const ARROWS_LAYER = 'reposition-arrows-layer';

export function useMapCoverageGaps(
  map: mapboxgl.Map | null,
  units: UnitPosition[],
  enabled: boolean,
  radiusMiles: number,
): UseMapCoverageGapsReturn {
  const popupRef = useRef<mapboxgl.Popup | null>(null);
  const [coverageCount, setCoverageCount] = useState(0);
  const [deadZones, setDeadZones] = useState<DeadZone[]>([]);
  const [repositionSuggestions, setRepositionSuggestions] = useState<RepositionSuggestion[]>([]);

  function removeOverlays() {
    if (!map) return;
    try {
      if (map.getLayer(COVERAGE_LAYER)) map.removeLayer(COVERAGE_LAYER);
      if (map.getSource(COVERAGE_SOURCE)) map.removeSource(COVERAGE_SOURCE);
      if (map.getLayer(DEADZONE_LAYER)) map.removeLayer(DEADZONE_LAYER);
      if (map.getSource(DEADZONE_SOURCE)) map.removeSource(DEADZONE_SOURCE);
      if (map.getLayer(ARROWS_LAYER)) map.removeLayer(ARROWS_LAYER);
      if (map.getSource(ARROWS_SOURCE)) map.removeSource(ARROWS_SOURCE);
    } catch { /* ignore */ }
    popupRef.current?.remove();
    popupRef.current = null;
  }

  // ── Render / clear overlays ───────────────────────────────

  useEffect(() => {
    removeOverlays();
    setCoverageCount(0);
    setDeadZones([]);
    setRepositionSuggestions([]);

    if (!map || !enabled) return;

    const radiusMeters = radiusMiles * METERS_PER_MILE;

    const onDutyWithCoords = units.filter(
      (u) =>
        u.latitude != null &&
        u.longitude != null &&
        !isNaN(Number(u.latitude)) &&
        !isNaN(Number(u.longitude)) &&
        ON_DUTY_STATUSES.has(u.status || ''),
    );

    // Compute coverage density using heat-style gradient
    const coverageFeatures: GeoJSON.Feature[] = [];
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
        color = '#22c55e';
        opacity = 0.12;
        strokeOpacity = 0.5;
      } else if (nearbyCount === 2) {
        color = '#4ade80';
        opacity = 0.10;
        strokeOpacity = 0.4;
      } else if (nearbyCount === 1) {
        color = '#fbbf24';
        opacity = 0.08;
        strokeOpacity = 0.35;
      } else {
        color = '#f97316';
        opacity = 0.06;
        strokeOpacity = 0.3;
      }

      const poly = circleToPolygon([lng, lat], radiusMeters);
      coverageFeatures.push({
        type: 'Feature',
        properties: { color, fillOpacity: opacity, strokeOpacity, callSign: unit.call_sign, nearbyCount, lat, lng },
        geometry: { type: 'Polygon', coordinates: [poly] },
      });
    });

    if (coverageFeatures.length > 0) {
      map.addSource(COVERAGE_SOURCE, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: coverageFeatures },
      });
      map.addLayer({
        id: COVERAGE_LAYER,
        type: 'fill',
        source: COVERAGE_SOURCE,
        paint: {
          'fill-color': ['get', 'color'],
          'fill-opacity': ['get', 'fillOpacity'],
          'fill-outline-color': ['get', 'color'],
        },
      });

      map.on('click', COVERAGE_LAYER, (e) => {
        if (!e.features || e.features.length === 0) return;
        const props = e.features[0].properties;
        if (!props) return;
        const color = props.color;
        const nearbyCount = props.nearbyCount;
        const callSign = props.callSign;
        const lat = props.lat;
        const lng = props.lng;

        popupRef.current?.remove();
        const container = document.createElement('div');
        container.style.cssText = "font-family:'JetBrains Mono',monospace;font-size:11px;color:#e0e0e0;min-width:200px;line-height:1.6;background:#050505;padding:10px 12px;border-radius:4px;border:1px solid #222222";
        const heading = document.createElement('div');
        heading.style.cssText = `font-weight:bold;font-size:12px;margin-bottom:4px;color:${color}`;
        heading.textContent = `Coverage \u2014 ${callSign}`;
        container.appendChild(heading);

        const densityLabel = nearbyCount >= 3 ? 'Excellent' : nearbyCount === 2 ? 'Good' : nearbyCount === 1 ? 'Moderate' : 'Sparse';
        const density = document.createElement('div');
        density.style.cssText = `font-size:10px;color:${color};font-weight:700;margin-bottom:2px;`;
        density.textContent = `${densityLabel} (${nearbyCount} nearby unit${nearbyCount !== 1 ? 's' : ''})`;
        container.appendChild(density);

        const radius = document.createElement('div');
        radius.style.cssText = 'font-size:9px;color:#6b7280;';
        radius.textContent = `Radius: ${radiusMiles} mi (${Math.round(radiusMeters)} m)`;
        container.appendChild(radius);

        popupRef.current = new mapboxgl.Popup({ closeButton: true, closeOnClick: false, maxWidth: '360px', offset: 15 })
          .setLngLat([lng, lat])
          .setDOMContent(container)
          .addTo(map);
      });
    }

    // ── Dead zone detection ─────────────────────────────────
    const bounds = map.getBounds();
    if (bounds && onDutyWithCoords.length > 0) {
      const ne = bounds.getNorthEast();
      const sw = bounds.getSouthWest();
      const latStep = (ne.lat - sw.lat) / 8;
      const lngStep = (ne.lng - sw.lng) / 8;
      const foundDeadZones: DeadZone[] = [];
      const dzFeatures: GeoJSON.Feature[] = [];

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

            const dzPoly = circleToPolygon([testLng, testLat], FIVE_MINUTE_METERS * 0.5);
            dzFeatures.push({
              type: 'Feature',
              properties: { minDist, lat: testLat, lng: testLng },
              geometry: { type: 'Polygon', coordinates: [dzPoly] },
            });
          }
        }
      }
      setDeadZones(foundDeadZones);

      if (dzFeatures.length > 0) {
        map.addSource(DEADZONE_SOURCE, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: dzFeatures },
        });
        map.addLayer({
          id: DEADZONE_LAYER,
          type: 'fill',
          source: DEADZONE_SOURCE,
          paint: {
            'fill-color': '#ef4444',
            'fill-opacity': 0.06,
            'fill-outline-color': '#ef4444',
          },
        });

        map.on('click', DEADZONE_LAYER, (e) => {
          if (!e.features || e.features.length === 0) return;
          const props = e.features[0].properties;
          if (!props) return;
          const testLat = props.lat;
          const testLng = props.lng;

          popupRef.current?.remove();
          const container = document.createElement('div');
          container.style.cssText = "font-family:'JetBrains Mono',monospace;font-size:11px;color:#e0e0e0;min-width:180px;line-height:1.6;background:#050505;padding:10px 12px;border-radius:4px;border:1px solid #ef444440";
          const heading = document.createElement('div');
          heading.style.cssText = 'font-weight:bold;font-size:12px;margin-bottom:4px;color:#ef4444';
          heading.textContent = 'Dead Zone';
          container.appendChild(heading);
          const info = document.createElement('div');
          info.style.cssText = 'font-size:9px;color:#f87171;';
          info.textContent = 'No unit within 5-min response time';
          container.appendChild(info);
          const dist = document.createElement('div');
          dist.style.cssText = 'font-size:9px;color:#6b7280;margin-top:2px;';
          dist.textContent = `${Math.round(props.minDist / METERS_PER_MILE * 10) / 10} mi from nearest unit`;
          container.appendChild(dist);
          popupRef.current = new mapboxgl.Popup({ closeButton: true, closeOnClick: false, maxWidth: '360px', offset: 15 })
            .setLngLat([testLng, testLat])
            .setDOMContent(container)
            .addTo(map);
        });
      }

      // ── Auto-suggest repositioning ────────────────────────
      if (foundDeadZones.length > 0) {
        const dzCenterLat = foundDeadZones.reduce((s, d) => s + d.lat, 0) / foundDeadZones.length;
        const dzCenterLng = foundDeadZones.reduce((s, d) => s + d.lng, 0) / foundDeadZones.length;

        const availableUnits = onDutyWithCoords.filter(u => u.status === 'available');
        const suggestions: RepositionSuggestion[] = [];
        const arrowFeatures: GeoJSON.Feature[] = [];

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

            suggestions.push({
              fromCallSign: unit.call_sign,
              fromLat,
              fromLng,
              toLat,
              toLng,
            });

            arrowFeatures.push({
              type: 'Feature',
              properties: {},
              geometry: { type: 'LineString', coordinates: [[fromLng, fromLat], [toLng, toLat]] },
            });
          });
        }
        setRepositionSuggestions(suggestions);

        if (arrowFeatures.length > 0) {
          map.addSource(ARROWS_SOURCE, {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: arrowFeatures },
          });
          map.addLayer({
            id: ARROWS_LAYER,
            type: 'line',
            source: ARROWS_SOURCE,
            paint: {
              'line-color': '#aaaaaa',
              'line-width': 2,
              'line-opacity': 0.6,
            },
          });
        }
      }
    }

    setCoverageCount(onDutyWithCoords.length);

    return () => {
      removeOverlays();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, units, enabled, radiusMiles]);

  // ── Cleanup on unmount ────────────────────────────────────

  useEffect(() => {
    return () => {
      removeOverlays();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { coverageCount, uncoveredArea: coverageCount === 0, deadZones, repositionSuggestions };
}
