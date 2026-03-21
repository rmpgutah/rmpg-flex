import { useEffect, useCallback, useRef } from 'react';
import { apiFetch } from '../../../hooks/useApi';
import { formatIncidentType } from '../../../utils/caseNumbers';
import { escapeHtml } from '../../../utils/sanitize';
import {
  buildUnitMarkerContent,
  buildIncidentMarkerContent,
  buildPropertyMarkerContent,
  buildSelfPositionMarker,
  getOverlayMarkerClass,
} from '../utils/mapMarkerBuilders';
import { UNIT_STATUS_COLORS, PRIORITY_COLORS } from '../utils/mapConstants';
import type { MapUnit as Unit, ActiveCall, MapProperty as Property } from '../utils/mapConstants';
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
          const statusColor = UNIT_STATUS_COLORS[unit.status];
          const location = unit.current_call_location || 'No active assignment';

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
              const routeBtnHtml = (assignedCall && assignedCall.latitude != null && assignedCall.longitude != null && unit.latitude != null && unit.longitude != null)
                ? `<button data-route-unit="${escapeHtml(unit.call_sign)}" data-route-call="${escapeHtml(assignedCall.call_number)}"
                     data-route-ulat="${unit.latitude}" data-route-ulng="${unit.longitude}"
                     data-route-clat="${assignedCall.latitude}" data-route-clng="${assignedCall.longitude}"
                     style="margin-top:6px;width:100%;padding:3px 0;background:#3b82f620;border:1px solid #3b82f650;color:#60a5fa;font-size:9px;font-weight:900;font-family:monospace;cursor:pointer;letter-spacing:0.5px;text-transform:uppercase;">
                     ▶ Route to ${escapeHtml(assignedCall.call_number)}
                   </button>`
                : '';

              infoWindowRef.current?.setContent(`
                <div style="min-width:200px;font-family:'Courier New',monospace;background:#0d1520;color:#e5e7eb;padding:10px;border:1px solid ${statusColor}50;border-radius:4px;">
                  <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid #1e3048;">
                    <div style="width:10px;height:10px;border-radius:50%;background:${statusColor};box-shadow:0 0 8px ${statusColor}80;"></div>
                    <span style="font-weight:900;font-size:15px;color:${statusColor};letter-spacing:-0.5px;">${escapeHtml(unit.call_sign)}</span>
                    <span style="margin-left:auto;font-size:9px;text-transform:uppercase;color:${statusColor};font-weight:800;letter-spacing:1px;padding:1px 6px;background:${statusColor}20;border:1px solid ${statusColor}30;border-radius:2px;">${escapeHtml(unit.status.replace(/_/g, ' '))}</span>
                  </div>
                  <div style="font-size:11px;color:#d1d5db;margin-bottom:2px;">${escapeHtml(unit.officer_name)}</div>
                  ${unit.vehicle ? `<div style="font-size:10px;color:#5a6e80;margin-bottom:6px;">Vehicle: ${escapeHtml(unit.vehicle)}</div>` : ''}
                  ${unit.call_number ? `
                    <div style="margin-top:6px;padding-top:6px;border-top:1px solid #1e3048;">
                      <div style="font-size:10px;color:#60a5fa;font-weight:bold;">${escapeHtml(unit.call_number)}</div>
                      ${unit.current_call_type ? `<div style="font-size:10px;color:#d1d5db;">${escapeHtml(formatIncidentType(unit.current_call_type))}</div>` : ''}
                      <div style="font-size:9px;color:#5a6e80;margin-top:2px;">${escapeHtml(location)}</div>
                    </div>
                  ` : `<div style="font-size:9px;color:#5a6e80;margin-top:4px;">${escapeHtml(location)}</div>`}
                  ${routeBtnHtml}
                </div>
              `);
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
          const pColor = PRIORITY_COLORS[call.priority] || '#5a6e80';

          const marker = createMarker({
            map,
            position: { lat: call.latitude, lng: call.longitude },
            content,
            zIndex: call.priority === 'P1' ? 2000 : 500,
            title: `${call.call_number} - ${formatIncidentType(call.incident_type)}`,
            onClick: () => {
              const assignedUnits = units.filter(u => String(u.current_call_id) === String(call.id));
              let unitsHtml = '';
              if (assignedUnits.length > 0) {
                unitsHtml = `<div style="margin-top:6px;padding-top:6px;border-top:1px solid #1e3048;">
                  <div style="font-size:9px;color:#5a6e80;margin-bottom:4px;font-weight:bold;text-transform:uppercase;letter-spacing:1px;">ASSIGNED UNITS (${assignedUnits.length})</div>
                  ${assignedUnits.map(u => {
                    const uc = UNIT_STATUS_COLORS[u.status] || '#5a6e80';
                    const routeBtn = (u.latitude != null && u.longitude != null && call.latitude != null && call.longitude != null)
                      ? `<button data-route-unit="${escapeHtml(u.call_sign)}" data-route-call="${escapeHtml(call.call_number)}"
                           data-route-ulat="${u.latitude}" data-route-ulng="${u.longitude}"
                           data-route-clat="${call.latitude}" data-route-clng="${call.longitude}"
                           style="margin-left:auto;padding:1px 5px;background:#3b82f620;border:1px solid #3b82f650;color:#60a5fa;font-size:8px;font-weight:900;font-family:monospace;cursor:pointer;">
                           ▶ ROUTE
                         </button>`
                      : '';
                    return `<div style="display:flex;align-items:center;gap:6px;margin-bottom:2px;">
                      <div style="width:6px;height:6px;border-radius:50%;background:${uc};box-shadow:0 0 4px ${uc}80;"></div>
                      <span style="font-size:10px;color:${uc};font-weight:bold;font-family:monospace;">${escapeHtml(u.call_sign)}</span>
                      <span style="font-size:9px;color:#9ca3af;">${escapeHtml(u.officer_name)}</span>
                      ${routeBtn}
                    </div>`;
                  }).join('')}
                </div>`;
              } else {
                unitsHtml = `<div style="margin-top:6px;padding-top:6px;border-top:1px solid #1e3048;font-size:9px;color:#5a6e80;">No units assigned</div>`;
              }

              infoWindowRef.current?.setContent(`
                <div style="min-width:200px;font-family:'Courier New',monospace;background:#0d1520;color:#e5e7eb;padding:10px;border:1px solid ${pColor}50;border-radius:4px;">
                  <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
                    <span style="background:${pColor};color:white;padding:2px 8px;font-size:10px;font-weight:900;letter-spacing:0.5px;">${escapeHtml(call.priority)}</span>
                    <span style="font-weight:900;font-size:13px;color:${pColor};">${escapeHtml(formatIncidentType(call.incident_type))}</span>
                  </div>
                  <div style="font-size:12px;color:#60a5fa;font-weight:bold;">${escapeHtml(call.call_number)}</div>
                  <div style="font-size:10px;margin-top:4px;color:#d1d5db;">${escapeHtml(call.location_address)}</div>
                  ${call.property_name ? `<div style="font-size:10px;margin-top:4px;color:#3b82f6;">\u{1F3E2} ${escapeHtml(call.property_name)}</div>` : ''}
                  <div style="font-size:9px;margin-top:6px;text-transform:uppercase;color:#5a6e80;letter-spacing:1px;font-weight:800;">${escapeHtml(call.status.replace(/_/g, ' '))}</div>
                  ${unitsHtml}
                </div>
              `);
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
              infoWindowRef.current?.setContent(`
                <div style="min-width:200px;font-family:'JetBrains Mono',monospace;background:#0d1520;color:#e5e7eb;padding:12px;border:1px solid #3b82f650;border-radius:4px;">
                  <div style="font-weight:900;font-size:13px;color:#60a5fa;margin-bottom:4px;">${escapeHtml(prop.name)}</div>
                  <div style="font-size:10px;color:#9ca3af;">Loading details...</div>
                </div>
              `);
              infoWindowRef.current?.setPosition({ lat: prop.latitude!, lng: prop.longitude! });
              infoWindowRef.current?.open(map);

              try {
                const details = await apiFetch<any>(`/records/properties/${prop.id}`);
                const recentCalls = details.recentCalls || [];
                const schedules = details.todaySchedules || [];
                const linkedPersons: any[] = details.linkedPersons || [];

                const RELATIONSHIP_COLORS: Record<string, string> = {
                  employee: '#22d3ee', contact: '#60a5fa', tenant: '#a78bfa', owner: '#4ade80',
                  manager: '#d4a017', subject: '#f59e0b', trespass_warning: '#ef4444',
                  banned: '#ef4444', frequent_visitor: '#9ca3af', associated: '#6b7280',
                };
                const personRows = linkedPersons.slice(0, 8).map((p: any) => {
                  const relColor = RELATIONSHIP_COLORS[p.relationship] || '#6b7280';
                  const name = escapeHtml(`${p.first_name} ${p.last_name}`);
                  const rel = escapeHtml((p.relationship || '').replace(/_/g, ' '));
                  const flagsArr = (() => { try { return JSON.parse(p.flags || '[]'); } catch { return []; } })();
                  const hasWarning = flagsArr.includes('trespass') || flagsArr.includes('violent') || flagsArr.includes('armed') || p.relationship === 'trespass_warning' || p.relationship === 'banned';
                  return `<div style="display:flex;justify-content:space-between;align-items:center;padding:3px 0;border-bottom:1px solid #1e304820;">
                    <div style="display:flex;align-items:center;gap:4px;">
                      ${hasWarning ? '<span style="color:#ef4444;font-size:8px;">⚠</span>' : ''}
                      <span style="color:#e0e8f0;font-size:9px;font-weight:700;">${name}</span>
                      ${p.title ? `<span style="color:#6b7280;font-size:7px;">${escapeHtml(p.title)}</span>` : ''}
                    </div>
                    <span style="color:${relColor};font-size:7px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">${rel}</span>
                  </div>`;
                }).join('');

                const callRows = recentCalls.slice(0, 5).map((c: any) => {
                  const date = c.created_at ? new Date(c.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
                  const time = c.created_at ? new Date(c.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
                  const statusColor = c.status === 'cleared' || c.status === 'closed' ? '#4ade80' : c.status === 'pending' ? '#fbbf24' : '#60a5fa';
                  return `<div style="display:flex;justify-content:space-between;align-items:center;padding:3px 0;border-bottom:1px solid #1e304820;">
                    <div>
                      <span style="color:#93c5fd;font-size:9px;font-weight:700;">${escapeHtml(c.call_number || '')}</span>
                      <span style="color:#6b7280;font-size:8px;margin-left:4px;">${escapeHtml(c.incident_type?.replace(/_/g, ' ') || '')}</span>
                    </div>
                    <div style="text-align:right;">
                      <span style="color:${statusColor};font-size:8px;font-weight:600;">${escapeHtml(c.status || '')}</span>
                      <span style="color:#6b7280;font-size:7px;margin-left:4px;">${date} ${time}</span>
                    </div>
                  </div>`;
                }).join('');

                const scheduleRows = schedules.map((s: any) =>
                  `<div style="font-size:8px;color:#d1d5db;padding:2px 0;">
                    <span style="color:#22d3ee;">⦿</span> ${escapeHtml(s.officer_name || 'Unassigned')}
                    <span style="color:#6b7280;margin-left:4px;">${escapeHtml(s.shift_type || '')}</span>
                  </div>`
                ).join('');

                infoWindowRef.current?.setContent(`
                  <div style="min-width:280px;max-width:360px;font-family:'JetBrains Mono',monospace;background:#0d1520;color:#e5e7eb;padding:12px;border:1px solid #3b82f650;border-radius:4px;">
                    <div style="font-weight:900;font-size:13px;color:#60a5fa;margin-bottom:2px;">${escapeHtml(prop.name)}</div>
                    <div style="font-size:10px;color:#d1d5db;margin-bottom:2px;">${escapeHtml(prop.address)}</div>
                    ${prop.client_name ? `<div style="font-size:9px;color:#d4a017;font-weight:600;margin-bottom:6px;">Client: ${escapeHtml(prop.client_name)}</div>` : ''}

                    ${details.property_type ? `<div style="font-size:8px;color:#9ca3af;margin-bottom:2px;">Type: ${escapeHtml(details.property_type)}</div>` : ''}
                    ${details.emergency_contact ? `<div style="font-size:8px;color:#f87171;margin-bottom:2px;">Emergency: ${escapeHtml(details.emergency_contact)}</div>` : ''}
                    ${details.gate_code ? `<div style="font-size:8px;color:#9ca3af;margin-bottom:2px;">Gate: ${escapeHtml(details.gate_code)}</div>` : ''}
                    ${details.access_instructions ? `<div style="font-size:8px;color:#9ca3af;margin-bottom:6px;">Access: ${escapeHtml(details.access_instructions)}</div>` : ''}

                    ${schedules.length > 0 ? `
                      <div style="border-top:1px solid #1e3048;padding-top:6px;margin-top:4px;">
                        <div style="font-size:9px;color:#22d3ee;font-weight:700;margin-bottom:3px;">TODAY'S OFFICERS</div>
                        ${scheduleRows}
                      </div>
                    ` : ''}

                    ${linkedPersons.length > 0 ? `
                      <div style="border-top:1px solid #1e3048;padding-top:6px;margin-top:6px;">
                        <div style="font-size:9px;color:#e879f9;font-weight:700;margin-bottom:3px;">LINKED PERSONS (${linkedPersons.length})</div>
                        ${personRows}
                        ${linkedPersons.length > 8 ? `<div style="font-size:8px;color:#6b7280;text-align:center;margin-top:4px;">+${linkedPersons.length - 8} more</div>` : ''}
                      </div>
                    ` : ''}

                    ${recentCalls.length > 0 ? `
                      <div style="border-top:1px solid #1e3048;padding-top:6px;margin-top:6px;">
                        <div style="font-size:9px;color:#f59e0b;font-weight:700;margin-bottom:3px;">CALL HISTORY (${recentCalls.length})</div>
                        ${callRows}
                        ${recentCalls.length > 5 ? `<div style="font-size:8px;color:#6b7280;text-align:center;margin-top:4px;">+${recentCalls.length - 5} more</div>` : ''}
                      </div>
                    ` : `
                      <div style="border-top:1px solid #1e3048;padding-top:6px;margin-top:6px;">
                        <div style="font-size:9px;color:#6b7280;">No recent calls</div>
                      </div>
                    `}

                    ${details.client_contact ? `
                      <div style="border-top:1px solid #1e3048;padding-top:6px;margin-top:6px;">
                        <div style="font-size:9px;color:#a78bfa;font-weight:700;margin-bottom:3px;">CLIENT CONTACT</div>
                        <div style="font-size:9px;color:#d1d5db;">${escapeHtml(details.client_contact)}</div>
                        ${details.client_phone ? `<div style="font-size:9px;color:#93c5fd;">${escapeHtml(details.client_phone)}</div>` : ''}
                      </div>
                    ` : ''}

                    ${details.sla_response_minutes ? `<div style="font-size:8px;color:#4ade80;margin-top:4px;">SLA: ${details.sla_response_minutes} min response</div>` : ''}
                    ${details.hazard_notes ? `<div style="font-size:8px;color:#f87171;margin-top:4px;padding:3px 5px;background:#f8717110;border:1px solid #f8717130;border-radius:2px;">⚠ ${escapeHtml(details.hazard_notes)}</div>` : ''}
                    ${details.post_orders ? `<div style="font-size:8px;color:#9ca3af;margin-top:4px;">Post Orders: ${escapeHtml(details.post_orders.substring(0, 100))}${details.post_orders.length > 100 ? '…' : ''}</div>` : ''}
                  </div>
                `);
              } catch {
                infoWindowRef.current?.setContent(`
                  <div style="min-width:160px;font-family:'JetBrains Mono',monospace;background:#0d1520;color:#e5e7eb;padding:10px;border:1px solid #3b82f650;border-radius:4px;">
                    <div style="font-weight:900;font-size:13px;color:#60a5fa;margin-bottom:4px;">${escapeHtml(prop.name)}</div>
                    <div style="font-size:10px;color:#d1d5db;">${escapeHtml(prop.address)}</div>
                    ${prop.client_name ? `<div style="font-size:9px;margin-top:6px;color:#d4a017;font-weight:600;">Client: ${escapeHtml(prop.client_name)}</div>` : ''}
                  </div>
                `);
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
