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

// ── Constants ─────────────────────────────────────────────
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

  // Cleanup animations on unmount
  useEffect(() => {
    return () => { cleanupAnimations(); };
  }, [cleanupAnimations]);

  // Helper: remove a marker
  const removeMarker = useCallback((m: any) => {
    if (m && typeof m.remove === 'function') m.remove();
  }, []);

  // Update Markers
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapLoaded) return;

    const prevUnitMarkers = unitMarkerMapRef.current;
    const nextUnitIds = new Set<string>();

    // Remove non-unit markers (incidents, properties)
    markersRef.current.forEach((m) => {
      if (m._rmpgUnitId) return;
      removeMarker(m);
    });
    markersRef.current = [];
    if (infoWindowRef.current) infoWindowRef.current.remove();

    // Coordinate deduplication set
    const seenCoords = new Set<string>();

    // Add / update unit markers with smooth position animation
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
            existingMarker.getElement().innerHTML = '';
            existingMarker.getElement().appendChild(newContent);

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

            const marker = new mapboxgl.Marker({ element: content, anchor: 'center' })
              .setLngLat([unit.longitude, unit.latitude])
              .addTo(map);

            marker.getElement().addEventListener('click', () => {
              const assignedCall = unit.current_call_id
                ? calls.find(c => String(c.id) === String(unit.current_call_id))
                : null;

              if (infoWindowRef.current) infoWindowRef.current.remove();
              const popup = new mapboxgl.Popup({ closeButton: true, closeOnClick: false, maxWidth: '360px', offset: 15 })
                .setLngLat([unit.longitude!, unit.latitude!])
                .setHTML(buildUnitInfoWindow(unit, assignedCall))
                .addTo(map);
              infoWindowRef.current = popup;
            });

            (marker as any).__rmpgUnitId = unit.call_sign;
            unitMarkerMapRef.current.set(unit.call_sign, marker);
            markersRef.current.push(marker);
            unitCount++;
          } catch (err) {
            console.warn('[useMapMarkers] Error creating unit marker:', unit.call_sign, err);
          }
        }
      });
    }

    // Remove unit markers for units no longer present
    prevUnitMarkers.forEach((marker, callSign) => {
      if (!nextUnitIds.has(callSign)) {
        removeMarker(marker);
        cancelAnimation(callSign);
        unitMarkerMapRef.current.delete(callSign);
      }
    });

    // If units layer is off, clear all unit markers
    if (!layers.units) {
      prevUnitMarkers.forEach((marker, callSign) => {
        removeMarker(marker);
        cancelAnimation(callSign);
      });
      unitMarkerMapRef.current.clear();
    }

    // Add incident markers
    if (layers.incidents) {
      let callCount = 0;
      calls.forEach((call) => {
        if (callCount >= MAX_CALL_MARKERS) return;
        if (call.latitude == null || call.longitude == null) return;
        if (!isFinite(call.latitude) || !isFinite(call.longitude)) return;

        try {
          const content = buildIncidentMarkerContent(call.priority, call.incident_type, call.call_number, call.created_at);

          const marker = new mapboxgl.Marker({ element: content, anchor: 'center' })
            .setLngLat([call.longitude, call.latitude])
            .addTo(map);

          marker.getElement().addEventListener('click', () => {
            const assignedUnits = units.filter(u => String(u.current_call_id) === String(call.id));

            if (infoWindowRef.current) infoWindowRef.current.remove();
            const popup = new mapboxgl.Popup({ closeButton: true, closeOnClick: false, maxWidth: '360px', offset: 15 })
              .setLngLat([call.longitude!, call.latitude!])
              .setHTML(buildCallInfoWindow(call as CallInfoData, assignedUnits))
              .addTo(map);
            infoWindowRef.current = popup;
          });

          markersRef.current.push(marker);
          callCount++;
        } catch (err) {
          console.warn('[useMapMarkers] Error creating call marker:', call.call_number, err);
        }
      });
    }

    // Add property markers
    if (layers.properties) {
      let propCount = 0;
      properties.forEach((prop) => {
        if (propCount >= MAX_PROPERTY_MARKERS) return;
        if (prop.latitude == null || prop.longitude == null) return;
        if (!isFinite(prop.latitude) || !isFinite(prop.longitude)) return;

        try {
          const content = buildPropertyMarkerContent(prop.name, prop.address, prop.client_name || undefined);

          const marker = new mapboxgl.Marker({ element: content, anchor: 'center' })
            .setLngLat([prop.longitude, prop.latitude])
            .addTo(map);

          marker.getElement().addEventListener('click', async () => {
            if (infoWindowRef.current) infoWindowRef.current.remove();
            const popup = new mapboxgl.Popup({ closeButton: true, closeOnClick: false, maxWidth: '360px', offset: 15 })
              .setLngLat([prop.longitude!, prop.latitude!])
              .setHTML(buildPropertyInfoWindow(prop))
              .addTo(map);
            infoWindowRef.current = popup;

            try {
              const details = await apiFetch<PropertyDetails>(`/records/properties/${prop.id}`);
              if (infoWindowRef.current && infoWindowRef.current.isOpen()) {
                infoWindowRef.current.setHTML(buildPropertyInfoWindow(prop, details));
              }
            } catch (err) {
              console.warn('[useMapMarkers] Property details fetch failed:', err);
              if (infoWindowRef.current && infoWindowRef.current.isOpen()) {
                infoWindowRef.current.setHTML(buildPropertyFallbackWindow(prop));
              }
            }
          });

          markersRef.current.push(marker);
          propCount++;
        } catch (err) {
          console.warn('[useMapMarkers] Error creating property marker:', prop.name, err);
        }
      });
    }
  }, [layers, units, calls, properties, mapLoaded, removeMarker, animateMarkerTo, cancelAnimation, mapInstanceRef, markersRef, infoWindowRef]);

  // Route Button Click Handler (delegated from info window HTML)
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

  // Find Closest Unit Button Click Handler (delegated from info window HTML)
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

  // GPS Self-Position Marker
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapLoaded) return;

    if (gps.isTracking && gps.latitude != null && gps.longitude != null) {
      if (selfMarkerRef.current) {
        selfMarkerRef.current.setLngLat([gps.longitude, gps.latitude]);
        const el = selfMarkerRef.current.getElement();
        el.innerHTML = '';
        el.appendChild(buildSelfPositionMarker(gps.accuracy, gps.heading));
      } else {
        const content = buildSelfPositionMarker(gps.accuracy, gps.heading);
        selfMarkerRef.current = new mapboxgl.Marker({ element: content, anchor: 'center' })
          .setLngLat([gps.longitude, gps.latitude])
          .addTo(map);
      }
    } else {
      if (selfMarkerRef.current) {
        removeMarker(selfMarkerRef.current);
        selfMarkerRef.current = null;
      }
    }
  }, [gps.isTracking, gps.latitude, gps.longitude, gps.accuracy, gps.heading, gps.unitCallSign, mapLoaded, removeMarker, mapInstanceRef]);

  return { createMarker: null as any, removeMarker, animateMarkerTo, cancelAnimation };
}