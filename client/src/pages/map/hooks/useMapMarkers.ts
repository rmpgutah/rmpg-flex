import { useEffect, useCallback, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import { apiFetch } from '../../../hooks/useApi';
import { formatIncidentType } from '../../../utils/caseNumbers';
import {
  buildUnitMarkerContent,
  buildIncidentMarkerContent,
  buildPropertyMarkerContent,
  buildSelfPositionMarker,
} from '../utils/mapMarkerBuilders';
import type { MapUnit as Unit, ActiveCall, MapProperty as Property } from '../utils/mapConstants';
import {
  buildUnitInfoWindow,
  buildCallInfoWindow,
  buildPropertyInfoWindow,
  buildPropertyFallbackWindow,
} from '../utils/infoWindowBuilder';
import type { CallInfoData, PropertyDetails } from '../utils/infoWindowBuilder';
import { useMarkerAnimation } from './useMarkerAnimation';

const MAX_UNIT_MARKERS = 500;
const MAX_CALL_MARKERS = 500;
const MAX_PROPERTY_MARKERS = 500;

interface UseMapMarkersParams {
  mapInstanceRef: React.MutableRefObject<mapboxgl.Map | null>;
  markersRef: React.MutableRefObject<any[]>;
  infoWindowRef: React.MutableRefObject<mapboxgl.Popup | null>;
  useAdvancedMarkersRef: React.MutableRefObject<boolean>;
  mapLoaded: boolean;
  layers: { units: boolean; incidents: boolean; properties: boolean };
  units: Unit[];
  calls: ActiveCall[];
  properties: Property[];
  showRoute: (unitCallSign: string, callNumber: string, uLat: number, uLng: number, cLat: number, cLng: number) => void;
  onFindClosest?: (callId: string) => void;
  gps: {
    isTracking: boolean;
    latitude: number | null;
    longitude: number | null;
    accuracy: number | null;
    heading: number | null;
    unitCallSign?: string | null;
  };
}

function createMapboxMarker(
  map: mapboxgl.Map,
  lng: number,
  lat: number,
  content: HTMLElement,
  zIndex: number,
  title: string,
  onClick?: () => void,
  anchor: mapboxgl.Anchor = 'bottom',
): mapboxgl.Marker {
  const marker = new mapboxgl.Marker({ element: content, anchor })
    .setLngLat([lng, lat])
    .addTo(map);
  if (onClick) {
    content.addEventListener('click', onClick);
  }
  return marker;
}

export function useMapMarkers({
  mapInstanceRef,
  markersRef,
  infoWindowRef,
  useAdvancedMarkersRef,
  mapLoaded,
  layers,
  units,
  calls,
  properties,
  showRoute,
  onFindClosest,
  gps,
}: UseMapMarkersParams) {
  const selfMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const unitMarkerMapRef = useRef<Map<string, mapboxgl.Marker>>(new Map());
  const { animateMarkerTo, cancelAnimation, cleanupAll: cleanupAnimations } = useMarkerAnimation();

  useEffect(() => {
    return () => { cleanupAnimations(); };
  }, [cleanupAnimations]);

  const removeMarker = useCallback((m: mapboxgl.Marker) => {
    if (m) m.remove();
  }, []);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapLoaded) return;

    const prevUnitMarkers = unitMarkerMapRef.current;
    const nextUnitIds = new Set<string>();

    markersRef.current.forEach((m) => {
      if (m._rmpgUnitId) return;
      removeMarker(m);
    });
    markersRef.current = [];
    if (infoWindowRef.current) infoWindowRef.current.remove();

    const seenCoords = new Set<string>();

    if (layers.units) {
      let unitCount = 0;
      units.forEach((unit) => {
        if (unitCount >= MAX_UNIT_MARKERS) return;
        if (unit.latitude == null || unit.longitude == null) return;
        if (!isFinite(unit.latitude) || !isFinite(unit.longitude)) return;

        const coordKey = `u:${unit.latitude.toFixed(6)},${unit.longitude.toFixed(6)}:${unit.call_sign}`;
        if (seenCoords.has(coordKey)) return;
        seenCoords.add(coordKey);

        nextUnitIds.add(unit.call_sign);
        const existingMarker = prevUnitMarkers.get(unit.call_sign);

        if (existingMarker) {
          try {
            const newContent = buildUnitMarkerContent(unit.call_sign, unit.status, unit.gps_source, unit.gps_heading);
            const el = existingMarker.getElement();
            if (el) {
              el.innerHTML = '';
              el.appendChild(newContent);
            }

            animateMarkerTo(unit.call_sign, unit.latitude, unit.longitude, (lat, lng) => {
              existingMarker.setLngLat([lng, lat]);
            });

            markersRef.current.push(existingMarker);
            unitCount++;
          } catch (err) {
            console.warn('[useMapMarkers] Error updating unit marker:', unit.call_sign, err);
          }
        } else {
          try {
            const content = buildUnitMarkerContent(unit.call_sign, unit.status, unit.gps_source, unit.gps_heading);

            const marker = createMapboxMarker(
              map,
              unit.longitude,
              unit.latitude,
              content,
              1000,
              `${unit.call_sign} - ${unit.officer_name}`,
              () => {
                const assignedCall = unit.current_call_id
                  ? calls.find(c => String(c.id) === String(unit.current_call_id))
                  : null;

                if (infoWindowRef.current) infoWindowRef.current.remove();
                infoWindowRef.current = new mapboxgl.Popup({ maxWidth: '320px', closeButton: true, closeOnClick: false })
                  .setLngLat([unit.longitude!, unit.latitude!])
                  .setHTML(buildUnitInfoWindow(unit, assignedCall))
                  .addTo(map);
              },
            );

            if (!marker) return;

            (marker as any)._rmpgUnitId = unit.call_sign;
            unitMarkerMapRef.current.set(unit.call_sign, marker);
            markersRef.current.push(marker);
            unitCount++;
          } catch (err) {
            console.warn('[useMapMarkers] Error creating unit marker:', unit.call_sign, err);
          }
        }
      });
    }

    prevUnitMarkers.forEach((marker, callSign) => {
      if (!nextUnitIds.has(callSign)) {
        removeMarker(marker);
        cancelAnimation(callSign);
        unitMarkerMapRef.current.delete(callSign);
      }
    });

    if (!layers.units) {
      prevUnitMarkers.forEach((marker, callSign) => {
        removeMarker(marker);
        cancelAnimation(callSign);
      });
      unitMarkerMapRef.current.clear();
    }

    if (layers.incidents) {
      let callCount = 0;
      calls.forEach((call) => {
        if (callCount >= MAX_CALL_MARKERS) return;
        if (call.latitude == null || call.longitude == null) return;
        if (!isFinite(call.latitude) || !isFinite(call.longitude)) return;

        try {
          const content = buildIncidentMarkerContent(call.priority, call.incident_type, call.call_number, call.created_at);

          const marker = createMapboxMarker(
            map,
            call.longitude,
            call.latitude,
            content,
            call.priority === 'P1' ? 2000 : 500,
            `${call.call_number} - ${formatIncidentType(call.incident_type)}`,
            () => {
              const assignedUnits = units.filter(u => String(u.current_call_id) === String(call.id));

              if (infoWindowRef.current) infoWindowRef.current.remove();
              infoWindowRef.current = new mapboxgl.Popup({ maxWidth: '320px', closeButton: true, closeOnClick: false })
                .setLngLat([call.longitude!, call.latitude!])
                .setHTML(buildCallInfoWindow(call as CallInfoData, assignedUnits))
                .addTo(map);
            },
          );

          if (!marker) return;
          markersRef.current.push(marker);
          callCount++;
        } catch (err) {
          console.warn('[useMapMarkers] Error creating call marker:', call.call_number, err);
        }
      });
    }

    if (layers.properties) {
      let propCount = 0;
      properties.forEach((prop) => {
        if (propCount >= MAX_PROPERTY_MARKERS) return;
        if (prop.latitude == null || prop.longitude == null) return;
        if (!isFinite(prop.latitude) || !isFinite(prop.longitude)) return;

        try {
          const content = buildPropertyMarkerContent(prop.name, prop.address, prop.client_name || undefined);

          const marker = createMapboxMarker(
            map,
            prop.longitude,
            prop.latitude,
            content,
            100,
            prop.name,
            async () => {
              if (infoWindowRef.current) infoWindowRef.current.remove();
              infoWindowRef.current = new mapboxgl.Popup({ maxWidth: '320px', closeButton: true, closeOnClick: false })
                .setLngLat([prop.longitude!, prop.latitude!])
                .setHTML(buildPropertyInfoWindow(prop))
                .addTo(map);

              try {
                const details = await apiFetch<PropertyDetails>(`/records/properties/${prop.id}`);
                if (infoWindowRef.current?.isOpen()) {
                  infoWindowRef.current.setHTML(buildPropertyInfoWindow(prop, details));
                }
              } catch (err) {
                console.warn('[useMapMarkers] Property details fetch failed:', err);
                if (infoWindowRef.current?.isOpen()) {
                  infoWindowRef.current.setHTML(buildPropertyFallbackWindow(prop));
                }
              }
            },
          );

          if (!marker) return;
          markersRef.current.push(marker);
          propCount++;
        } catch (err) {
          console.warn('[useMapMarkers] Error creating property marker:', prop.name, err);
        }
      });
    }
  }, [layers, units, calls, properties, mapLoaded, removeMarker, animateMarkerTo, cancelAnimation, mapInstanceRef, markersRef, infoWindowRef]);

  useEffect(() => {
    function handleRouteClick(e: MouseEvent) {
      const btn = (e.target as HTMLElement).closest('[data-route-unit]') as HTMLElement | null;
      if (!btn) return;
      const unitCallSign = btn.getAttribute('data-route-unit') || '';
      const callNumber = btn.getAttribute('data-route-call') || '';
      const uLat = parseFloat(btn.getAttribute('data-route-ulat') || '');
      const uLng = parseFloat(btn.getAttribute('data-route-ulng') || '');
      const cLat = parseFloat(btn.getAttribute('data-route-clat') || '');
      const cLng = parseFloat(btn.getAttribute('data-route-clng') || '');
      if (!isNaN(uLat) && !isNaN(uLng) && !isNaN(cLat) && !isNaN(cLng)) {
        showRoute(unitCallSign, callNumber, uLat, uLng, cLat, cLng);
        if (infoWindowRef.current) infoWindowRef.current.remove();
      }
    }
    document.addEventListener('click', handleRouteClick);
    return () => document.removeEventListener('click', handleRouteClick);
  }, [showRoute, infoWindowRef]);

  useEffect(() => {
    function handleFindClosestClick(e: MouseEvent) {
      const btn = (e.target as HTMLElement).closest('[data-find-closest]') as HTMLElement | null;
      if (!btn) return;
      const callId = btn.getAttribute('data-find-closest') || '';
      if (callId && onFindClosest) {
        onFindClosest(callId);
        if (infoWindowRef.current) infoWindowRef.current.remove();
      }
    }
    document.addEventListener('click', handleFindClosestClick);
    return () => document.removeEventListener('click', handleFindClosestClick);
  }, [onFindClosest, infoWindowRef]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapLoaded) return;

    if (gps.isTracking && gps.latitude != null && gps.longitude != null) {
      if (selfMarkerRef.current) {
        selfMarkerRef.current.setLngLat([gps.longitude, gps.latitude]);
        const el = selfMarkerRef.current.getElement();
        if (el) {
          el.innerHTML = '';
          el.appendChild(buildSelfPositionMarker(gps.accuracy, gps.heading));
        }
      } else {
        selfMarkerRef.current = createMapboxMarker(
          map,
          gps.longitude,
          gps.latitude,
          buildSelfPositionMarker(gps.accuracy, gps.heading),
          9999,
          `Your Position${gps.unitCallSign ? ` (${gps.unitCallSign})` : ''}`,
          undefined,
          'center',
        );
      }
    } else {
      if (selfMarkerRef.current) {
        removeMarker(selfMarkerRef.current);
        selfMarkerRef.current = null;
      }
    }
  }, [gps.isTracking, gps.latitude, gps.longitude, gps.accuracy, gps.heading, gps.unitCallSign, mapLoaded, removeMarker, mapInstanceRef]);

  return { removeMarker, animateMarkerTo, cancelAnimation };
}
