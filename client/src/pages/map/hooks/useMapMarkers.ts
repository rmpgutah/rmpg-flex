import { useEffect, useCallback, useRef } from 'react';
import { apiFetch } from '../../../hooks/useApi';
import { formatIncidentType } from '../../../utils/caseNumbers';
import {
  buildUnitMarkerContent,
  buildIncidentMarkerContent,
  buildPropertyMarkerContent,
  buildSelfPositionMarker,
  getOverlayMarkerClass,
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
  mapInstanceRef: React.MutableRefObject<google.maps.Map | null>;
  markersRef: React.MutableRefObject<any[]>;
  infoWindowRef: React.MutableRefObject<google.maps.InfoWindow | null>;
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
  const selfMarkerRef = useRef<any>(null);
  const unitMarkerMapRef = useRef<Map<string, any>>(new Map());
  const { animateMarkerTo, cancelAnimation, cleanupAll: cleanupAnimations } = useMarkerAnimation();

  // Cleanup animations on unmount
  useEffect(() => {
    return () => { cleanupAnimations(); };
  }, [cleanupAnimations]);

  // Helper: create a marker using AdvancedMarkerElement or OverlayView fallback
  const createMarker = useCallback((opts: {
    map: google.maps.Map;
    position: google.maps.LatLngLiteral;
    content: HTMLElement;
    zIndex?: number;
    title?: string;
    onClick?: () => void;
  }): any => {
    if (useAdvancedMarkersRef.current) {
      try {
        const marker = new google.maps.marker.AdvancedMarkerElement({
          map: opts.map,
          position: opts.position,
          content: opts.content,
          zIndex: opts.zIndex,
          title: opts.title,
        });
        if (opts.onClick) marker.addListener('click', opts.onClick);
        return marker;
      } catch (err) {
        console.warn('[useMapMarkers] AdvancedMarkerElement creation failed, falling back to overlay:', err);
      }
    }
    const Cls = getOverlayMarkerClass();
    if (!Cls) return null as any;
    return new Cls(opts);
  }, [useAdvancedMarkersRef]);

  // Helper: remove a marker (works for both types)
  const removeMarker = useCallback((m: any) => {
    if (m && typeof m.remove === 'function') m.remove();
    else if (m) m.map = null;
  }, []);

  // Update Markers
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapLoaded) return; // Fix 6: guard on mapInstanceRef

    // Clear existing non-unit markers, and track which units are still present
    const prevUnitMarkers = unitMarkerMapRef.current;
    const nextUnitIds = new Set<string>();

    // Remove non-unit markers (incidents, properties)
    markersRef.current.forEach((m) => {
      // Unit markers are tracked separately; skip them during bulk removal
      if (m._rmpgUnitId) return;
      removeMarker(m);
    });
    markersRef.current = [];
    infoWindowRef.current?.close(); // Fix 5: close before re-rendering

    // Fix 7: coordinate deduplication set
    const seenCoords = new Set<string>();

    // Add / update unit markers with smooth position animation
    if (layers.units) {
      let unitCount = 0;
      units.forEach((unit) => {
        if (unitCount >= MAX_UNIT_MARKERS) return; // Fix 8: cap at 500
        // Fix 2: validate lat/lng are finite numbers
        if (unit.latitude == null || unit.longitude == null) return;
        if (!isFinite(unit.latitude) || !isFinite(unit.longitude)) return;

        // Fix 7: skip markers with identical coordinates
        const coordKey = `u:${unit.latitude.toFixed(6)},${unit.longitude.toFixed(6)}:${unit.call_sign}`;
        if (seenCoords.has(coordKey)) return;
        seenCoords.add(coordKey);

        nextUnitIds.add(unit.call_sign);
        const existingMarker = prevUnitMarkers.get(unit.call_sign);

        if (existingMarker) {
          // Update content (status may have changed)
          try { // Fix 1: try/catch around marker operations
            const newContent = buildUnitMarkerContent(unit.call_sign, unit.status, unit.gps_source);
            if (typeof existingMarker.updateContent === 'function') {
              existingMarker.updateContent(newContent);
            } else {
              existingMarker.content = newContent;
            }

            // Animate position change
            animateMarkerTo(unit.call_sign, unit.latitude, unit.longitude, (lat, lng) => {
              if (typeof existingMarker.updatePosition === 'function') {
                existingMarker.updatePosition(lat, lng);
              } else {
                existingMarker.position = { lat, lng };
              }
            });

            markersRef.current.push(existingMarker);
            unitCount++;
          } catch (err) {
            console.warn('[useMapMarkers] Error updating unit marker:', unit.call_sign, err);
          }
        } else {
          try { // Fix 1: try/catch around each marker creation
            const content = buildUnitMarkerContent(unit.call_sign, unit.status, unit.gps_source);

            const marker = createMarker({
              map,
              position: { lat: unit.latitude, lng: unit.longitude },
              content,
              zIndex: 1000,
              title: `${unit.call_sign} - ${unit.officer_name}`,
              onClick: () => {
                const assignedCall = unit.current_call_id
                  ? calls.find(c => String(c.id) === String(unit.current_call_id))
                  : null;

                infoWindowRef.current?.close(); // Fix 5: close before opening new
                infoWindowRef.current?.setContent(buildUnitInfoWindow(unit, assignedCall));
                infoWindowRef.current?.setPosition({ lat: unit.latitude!, lng: unit.longitude! });
                infoWindowRef.current?.open(map);
              },
            });

            // Fix 3: guard for createMarker returning null
            if (!marker) return;

            marker._rmpgUnitId = unit.call_sign;
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
        if (callCount >= MAX_CALL_MARKERS) return; // Fix 8: cap at 500
        if (call.latitude == null || call.longitude == null) return;
        // Fix 2: validate finite coordinates
        if (!isFinite(call.latitude) || !isFinite(call.longitude)) return;

        try { // Fix 1: try/catch per marker
          const content = buildIncidentMarkerContent(call.priority, call.incident_type, call.call_number);

          const marker = createMarker({
            map,
            position: { lat: call.latitude, lng: call.longitude },
            content,
            zIndex: call.priority === 'P1' ? 2000 : 500,
            title: `${call.call_number} - ${formatIncidentType(call.incident_type)}`,
            onClick: () => {
              const assignedUnits = units.filter(u => String(u.current_call_id) === String(call.id));

              infoWindowRef.current?.close(); // Fix 5: close before opening new
              infoWindowRef.current?.setContent(buildCallInfoWindow(call as CallInfoData, assignedUnits));
              infoWindowRef.current?.setPosition({ lat: call.latitude!, lng: call.longitude! });
              infoWindowRef.current?.open(map);
            },
          });

          if (!marker) return; // Fix 3: guard null
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
        if (propCount >= MAX_PROPERTY_MARKERS) return; // Fix 8: cap at 500
        if (prop.latitude == null || prop.longitude == null) return;
        // Fix 2: validate finite coordinates
        if (!isFinite(prop.latitude) || !isFinite(prop.longitude)) return;

        try { // Fix 1: try/catch per marker
          const content = buildPropertyMarkerContent(prop.name, prop.address, prop.client_name || undefined);

          const marker = createMarker({
            map,
            position: { lat: prop.latitude, lng: prop.longitude },
            content,
            zIndex: 100,
            title: prop.name,
            onClick: async () => {
              infoWindowRef.current?.close(); // Fix 5: close before opening new
              infoWindowRef.current?.setContent(buildPropertyInfoWindow(prop));
              infoWindowRef.current?.setPosition({ lat: prop.latitude!, lng: prop.longitude! });
              infoWindowRef.current?.open(map);

              try {
                const details = await apiFetch<PropertyDetails>(`/records/properties/${prop.id}`);
                // Only update content if info window is still open (user hasn't closed it)
                if ((infoWindowRef.current as any)?.getMap?.()) {
                  infoWindowRef.current?.setContent(buildPropertyInfoWindow(prop, details));
                }
              } catch (err) {
                console.warn('[useMapMarkers] Property details fetch failed:', err);
                if ((infoWindowRef.current as any)?.getMap?.()) {
                  infoWindowRef.current?.setContent(buildPropertyFallbackWindow(prop));
                }
              }
            },
          });

          if (!marker) return; // Fix 3: guard null
          markersRef.current.push(marker);
          propCount++;
        } catch (err) {
          console.warn('[useMapMarkers] Error creating property marker:', prop.name, err);
        }
      });
    }
  }, [layers, units, calls, properties, mapLoaded, createMarker, removeMarker, animateMarkerTo, cancelAnimation, mapInstanceRef, markersRef, infoWindowRef]);

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
        infoWindowRef.current?.close();
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
        infoWindowRef.current?.close();
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
      const pos = { lat: gps.latitude, lng: gps.longitude };
      if (selfMarkerRef.current) {
        if (typeof selfMarkerRef.current.updatePosition === 'function') {
          selfMarkerRef.current.updatePosition(gps.latitude, gps.longitude);
          selfMarkerRef.current.updateContent(buildSelfPositionMarker(gps.accuracy, gps.heading));
        } else {
          selfMarkerRef.current.position = pos;
          selfMarkerRef.current.content = buildSelfPositionMarker(gps.accuracy, gps.heading);
        }
      } else {
        selfMarkerRef.current = createMarker({
          map,
          position: pos,
          content: buildSelfPositionMarker(gps.accuracy, gps.heading),
          zIndex: 9999,
          title: `Your Position${gps.unitCallSign ? ` (${gps.unitCallSign})` : ''}`,
        });
      }
    } else {
      if (selfMarkerRef.current) {
        removeMarker(selfMarkerRef.current);
        selfMarkerRef.current = null;
      }
    }
  }, [gps.isTracking, gps.latitude, gps.longitude, gps.accuracy, gps.heading, gps.unitCallSign, mapLoaded, createMarker, removeMarker, mapInstanceRef]);

  return { createMarker, removeMarker, animateMarkerTo, cancelAnimation };
}
