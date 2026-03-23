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
      } catch {
        // Fall through to overlay
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
    if (!map || !mapLoaded) return;

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
    infoWindowRef.current?.close();

    // Add / update unit markers with smooth position animation
    if (layers.units) {
      units.forEach((unit) => {
        if (unit.latitude != null && unit.longitude != null) {
          nextUnitIds.add(unit.call_sign);
          const existingMarker = prevUnitMarkers.get(unit.call_sign);

          if (existingMarker) {
            // Update content (status may have changed)
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
          } else {
            // Create new unit marker
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

              infoWindowRef.current?.setContent(buildUnitInfoWindow(unit, assignedCall));
              infoWindowRef.current?.setPosition({ lat: unit.latitude!, lng: unit.longitude! });
              infoWindowRef.current?.open(map);
            },
          });

          marker._rmpgUnitId = unit.call_sign;
          unitMarkerMapRef.current.set(unit.call_sign, marker);
          markersRef.current.push(marker);
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
      calls.forEach((call) => {
        if (call.latitude != null && call.longitude != null) {
          const content = buildIncidentMarkerContent(call.priority, call.incident_type, call.call_number);

          const marker = createMarker({
            map,
            position: { lat: call.latitude, lng: call.longitude },
            content,
            zIndex: call.priority === 'P1' ? 2000 : 500,
            title: `${call.call_number} - ${formatIncidentType(call.incident_type)}`,
            onClick: () => {
              const assignedUnits = units.filter(u => String(u.current_call_id) === String(call.id));

              infoWindowRef.current?.setContent(buildCallInfoWindow(call as CallInfoData, assignedUnits));
              infoWindowRef.current?.setPosition({ lat: call.latitude!, lng: call.longitude! });
              infoWindowRef.current?.open(map);
            },
          });

          markersRef.current.push(marker);
        }
      });
    }

    // Add property markers
    if (layers.properties) {
      properties.forEach((prop) => {
        if (prop.latitude != null && prop.longitude != null) {
          const content = buildPropertyMarkerContent(prop.name, prop.address, prop.client_name || undefined);

          const marker = createMarker({
            map,
            position: { lat: prop.latitude, lng: prop.longitude },
            content,
            zIndex: 100,
            title: prop.name,
            onClick: async () => {
              infoWindowRef.current?.setContent(buildPropertyInfoWindow(prop));
              infoWindowRef.current?.setPosition({ lat: prop.latitude!, lng: prop.longitude! });
              infoWindowRef.current?.open(map);

              try {
                const details = await apiFetch<PropertyDetails>(`/records/properties/${prop.id}`);
                // Only update content if info window is still open (user hasn't closed it)
                if ((infoWindowRef.current as any)?.getMap?.()) {
                  infoWindowRef.current?.setContent(buildPropertyInfoWindow(prop, details));
                }
              } catch {
                if ((infoWindowRef.current as any)?.getMap?.()) {
                  infoWindowRef.current?.setContent(buildPropertyFallbackWindow(prop));
                }
              }
            },
          });

          markersRef.current.push(marker);
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
