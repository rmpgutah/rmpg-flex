import { useEffect, useRef } from 'react';
import type OlMap from 'ol/Map';
import type Feature from 'ol/Feature';
import type Geometry from 'ol/geom/Geometry';
import Overlay from 'ol/Overlay';
import { UNIT_STATUS_HEX, PRIORITY_HEX, UNIT_STATUS_LABELS } from '../../../utils/statusColors';
import type { Unit, CallForService, UnitStatus, CallPriority } from '../../../types';

// ─── Popup-content builders (one per kind) ────────────────

function makeRow(value: string, color: string, fontSize: number, weight: number, extra?: Partial<CSSStyleDeclaration>): HTMLDivElement {
  const div = document.createElement('div');
  div.textContent = value;
  div.style.color = color;
  div.style.fontSize = `${fontSize}px`;
  div.style.fontWeight = String(weight);
  div.style.marginTop = '2px';
  if (extra) Object.assign(div.style, extra);
  return div;
}

function buildContainer(borderColor: string, minWidth = 180): HTMLDivElement {
  const root = document.createElement('div');
  root.style.minWidth = `${minWidth}px`;
  root.style.fontFamily = 'ui-monospace, monospace';
  root.style.background = '#0a0a0a';
  root.style.color = '#e5e7eb';
  root.style.padding = '8px';
  root.style.border = `1px solid ${borderColor}`;
  return root;
}

function fmtDate(s?: string | null): string {
  if (!s) return '';
  try {
    const d = new Date(s);
    if (isNaN(d.getTime())) return s;
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch { return s; }
}

function popupForUnit(p: Unit): HTMLDivElement {
  const color = UNIT_STATUS_HEX[p.status as UnitStatus] || '#888888';
  const root = buildContainer(`${color}80`, 160);
  root.appendChild(makeRow(p.call_sign, color, 11, 700, { marginTop: '0' }));
  root.appendChild(makeRow(p.officer_name || '', '#9ca3af', 9, 400));
  const status = makeRow(UNIT_STATUS_LABELS[p.status as UnitStatus] || p.status, color, 9, 400, { marginTop: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' });
  root.appendChild(status);
  return root;
}

function popupForCall(p: CallForService): HTMLDivElement {
  const color = PRIORITY_HEX[p.priority as CallPriority] || '#888888';
  const root = buildContainer(`${color}80`);
  root.appendChild(makeRow(`${p.call_number} · ${p.priority}`, color, 11, 700, { marginTop: '0' }));
  root.appendChild(makeRow(p.incident_type, '#e5e7eb', 9, 400));
  root.appendChild(makeRow(p.location || '', '#9ca3af', 9, 400));
  const status = makeRow(p.status, color, 9, 400, { marginTop: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' });
  root.appendChild(status);
  return root;
}

interface FIRow { fi_number: string; subject_first_name?: string | null; subject_last_name?: string | null; officer_name?: string | null; contact_reason?: string; created_at?: string; }
function popupForFI(p: FIRow): HTMLDivElement {
  const root = buildContainer('#06b6d480');
  const subject = [p.subject_first_name, p.subject_last_name].filter(Boolean).join(' ');
  root.appendChild(makeRow(`FI ${p.fi_number}`, '#06b6d4', 11, 700, { marginTop: '0' }));
  if (subject) root.appendChild(makeRow(subject, '#e5e7eb', 9, 400));
  if (p.contact_reason) root.appendChild(makeRow(p.contact_reason, '#9ca3af', 9, 400));
  if (p.officer_name) root.appendChild(makeRow(`Officer: ${p.officer_name}`, '#888888', 8, 400, { marginTop: '4px' }));
  if (p.created_at) root.appendChild(makeRow(fmtDate(p.created_at), '#666666', 8, 400));
  return root;
}

interface IncidentRow { incident_number: string; incident_type?: string; priority?: string; status?: string; location_address?: string; created_at?: string; }
function popupForIncident(p: IncidentRow): HTMLDivElement {
  const root = buildContainer('#ef444480');
  root.appendChild(makeRow(p.incident_number, '#ef4444', 11, 700, { marginTop: '0' }));
  if (p.incident_type) root.appendChild(makeRow(p.incident_type, '#e5e7eb', 9, 400));
  if (p.location_address) root.appendChild(makeRow(p.location_address, '#9ca3af', 9, 400));
  const meta: string[] = [];
  if (p.priority) meta.push(p.priority);
  if (p.status) meta.push(p.status);
  if (meta.length) root.appendChild(makeRow(meta.join(' · '), '#ef4444', 9, 400, { marginTop: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }));
  if (p.created_at) root.appendChild(makeRow(fmtDate(p.created_at), '#666666', 8, 400));
  return root;
}

interface CheckpointRow { name: string; property_name?: string | null; sequence_order?: number; scan_required_interval_minutes?: number; }
function popupForCheckpoint(p: CheckpointRow): HTMLDivElement {
  const root = buildContainer('#22c55e80');
  root.appendChild(makeRow(p.name, '#22c55e', 11, 700, { marginTop: '0' }));
  if (p.property_name) root.appendChild(makeRow(p.property_name, '#9ca3af', 9, 400));
  if (p.sequence_order != null) root.appendChild(makeRow(`Stop #${p.sequence_order}`, '#888888', 8, 400, { marginTop: '4px' }));
  if (p.scan_required_interval_minutes) root.appendChild(makeRow(`${p.scan_required_interval_minutes}m interval`, '#666666', 8, 400));
  return root;
}

interface FleetRow { vehicle_number: string; make?: string | null; model?: string | null; year?: number | null; status?: string; }
function popupForFleet(p: FleetRow): HTMLDivElement {
  const root = buildContainer('#fbbf2480');
  root.appendChild(makeRow(p.vehicle_number, '#fbbf24', 11, 700, { marginTop: '0' }));
  const desc = [p.year, p.make, p.model].filter(Boolean).join(' ');
  if (desc) root.appendChild(makeRow(desc, '#9ca3af', 9, 400));
  if (p.status) root.appendChild(makeRow(p.status, '#fbbf24', 9, 400, { marginTop: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }));
  return root;
}

interface RepeatRow { location_address?: string; call_count: number; incident_types?: string; last_call?: string; }
function popupForRepeat(p: RepeatRow): HTMLDivElement {
  const root = buildContainer('#f9731680');
  root.appendChild(makeRow(`${p.call_count} calls`, '#f97316', 11, 700, { marginTop: '0' }));
  if (p.location_address) root.appendChild(makeRow(p.location_address, '#e5e7eb', 9, 400));
  if (p.incident_types) root.appendChild(makeRow(p.incident_types, '#9ca3af', 8, 400, { marginTop: '4px' }));
  if (p.last_call) root.appendChild(makeRow(`Last: ${fmtDate(p.last_call)}`, '#666666', 8, 400));
  return root;
}

interface DwellRow { call_sign: string; dwell_minutes: number; status: string; }
function popupForDwell(p: DwellRow): HTMLDivElement {
  const root = buildContainer('#fbbf2480');
  root.appendChild(makeRow(p.call_sign, '#fbbf24', 11, 700, { marginTop: '0' }));
  root.appendChild(makeRow(`Dwell: ${p.dwell_minutes}m`, '#e5e7eb', 9, 400));
  root.appendChild(makeRow(p.status, '#9ca3af', 9, 400, { marginTop: '4px', textTransform: 'uppercase' }));
  return root;
}

interface PredictionRow { score: number; incident_count: number; top_types?: string; weapons_count?: number; dv_count?: number; }
function popupForPrediction(p: PredictionRow): HTMLDivElement {
  const root = buildContainer('#ec489980');
  root.appendChild(makeRow(`Score ${(p.score ?? 0).toFixed(2)}`, '#ec4899', 11, 700, { marginTop: '0' }));
  root.appendChild(makeRow(`${p.incident_count} incidents`, '#e5e7eb', 9, 400));
  if (p.top_types) root.appendChild(makeRow(p.top_types, '#9ca3af', 8, 400, { marginTop: '4px' }));
  const flags: string[] = [];
  if (p.weapons_count) flags.push(`${p.weapons_count} weapons`);
  if (p.dv_count) flags.push(`${p.dv_count} DV`);
  if (flags.length) root.appendChild(makeRow(flags.join(' · '), '#ef4444', 8, 400));
  return root;
}

interface HistoryRow { call_number: string; incident_type?: string; priority?: string; disposition?: string | null; location_address?: string; }
function popupForHistory(p: HistoryRow): HTMLDivElement {
  const root = buildContainer('#9ca3af80');
  root.appendChild(makeRow(p.call_number, '#9ca3af', 11, 700, { marginTop: '0' }));
  if (p.incident_type) root.appendChild(makeRow(p.incident_type, '#e5e7eb', 9, 400));
  if (p.location_address) root.appendChild(makeRow(p.location_address, '#888888', 9, 400));
  if (p.disposition) root.appendChild(makeRow(`Disp: ${p.disposition}`, '#666666', 8, 400, { marginTop: '4px' }));
  return root;
}

interface BreadcrumbRow {
  call_sign?: string;
  officer_name?: string;
  speed?: number | null;
  heading?: number | null;
  status?: string | null;
  call_number?: string | null;
  call_type?: string | null;
  time?: string;
  road_name?: string | null;
  intersection?: string | null;
}
function popupForBreadcrumb(p: BreadcrumbRow): HTMLDivElement {
  const root = buildContainer('#14b8a680', 200);
  root.appendChild(makeRow(p.call_sign || 'Unit', '#14b8a6', 11, 700, { marginTop: '0' }));
  if (p.officer_name) root.appendChild(makeRow(p.officer_name, '#9ca3af', 9, 400));

  // Speed (m/s → mph) + heading + status, all on one informational line block
  const speedMph = (typeof p.speed === 'number' && Number.isFinite(p.speed))
    ? (p.speed * 2.237).toFixed(0) + ' mph'
    : null;
  const headingDeg = (typeof p.heading === 'number' && Number.isFinite(p.heading))
    ? Math.round(p.heading) + '°'
    : null;

  const metricLine: string[] = [];
  if (speedMph) metricLine.push(speedMph);
  if (headingDeg) metricLine.push(`hdg ${headingDeg}`);
  if (metricLine.length) {
    root.appendChild(makeRow(metricLine.join(' · '), '#e5e7eb', 9, 700, { marginTop: '4px' }));
  }
  if (p.status) {
    root.appendChild(makeRow(p.status, '#888888', 9, 400, { textTransform: 'uppercase', letterSpacing: '0.5px' }));
  }
  if (p.call_number) {
    const callLine = p.call_type ? `${p.call_number} · ${p.call_type}` : p.call_number;
    root.appendChild(makeRow(callLine, '#fbbf24', 9, 400, { marginTop: '4px' }));
  }
  if (p.road_name) {
    const roadLine = p.intersection ? `${p.road_name} @ ${p.intersection}` : p.road_name;
    root.appendChild(makeRow(roadLine, '#888888', 8, 400));
  }
  if (p.time) root.appendChild(makeRow(fmtDate(p.time), '#666666', 8, 400, { marginTop: '4px' }));
  return root;
}

// ─── Hook ─────────────────────────────────────────────────

const POPUP_BUILDERS: Record<string, (payload: any) => HTMLDivElement> = {
  unit: popupForUnit,
  call: popupForCall,
  fi: popupForFI,
  incident: popupForIncident,
  checkpoint: popupForCheckpoint,
  fleet: popupForFleet,
  repeat_address: popupForRepeat,
  dwell: popupForDwell,
  prediction: popupForPrediction,
  call_history: popupForHistory,
  breadcrumb: popupForBreadcrumb,
};

/**
 * Single shared click-to-popup overlay for /map-v2 features.
 *
 * Replaces the per-hook click handler that previously lived only in
 * useOlLiveMarkers (units/calls). Every Feature in the map carrying
 * a `kind` + `payload` prop gets a popup automatically; new layers
 * just need to set those two props (already wired for fi/incident/
 * checkpoint/fleet/repeat_address/dwell/prediction/call_history).
 *
 * Uses textContent-only DOM construction so user-influenced fields
 * like incident_type, location, etc. cannot inject HTML.
 */
export function useOlFeaturePopup(map: OlMap | null): void {
  const overlayRef = useRef<Overlay | null>(null);
  const elRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!map || overlayRef.current) return;

    const el = document.createElement('div');
    el.style.position = 'absolute';
    el.style.transform = 'translate(-50%, calc(-100% - 12px))';
    el.style.pointerEvents = 'auto';
    elRef.current = el;
    const overlay = new Overlay({ element: el, autoPan: { animation: { duration: 200 } } });
    overlayRef.current = overlay;
    map.addOverlay(overlay);

    const onClick = (evt: any) => {
      const feature = map.forEachFeatureAtPixel(
        evt.pixel,
        (f) => (f.get('kind') ? (f as Feature<Geometry>) : undefined),
        { hitTolerance: 4 },
      );
      if (!feature) {
        overlay.setPosition(undefined);
        while (el.firstChild) el.removeChild(el.firstChild);
        return;
      }
      const kind = feature.get('kind') as string;
      const payload = feature.get('payload');
      const builder = POPUP_BUILDERS[kind];
      if (!builder || !payload) {
        overlay.setPosition(undefined);
        return;
      }
      while (el.firstChild) el.removeChild(el.firstChild);
      el.appendChild(builder(payload));
      const geom: any = feature.getGeometry();
      // Position the popup at the feature's coordinate (works for points
      // and uses a reasonable fallback for non-points).
      if (geom && typeof geom.getCoordinates === 'function') {
        overlay.setPosition(geom.getCoordinates());
      } else if (geom && typeof geom.getExtent === 'function') {
        const ext = geom.getExtent();
        overlay.setPosition([(ext[0] + ext[2]) / 2, (ext[1] + ext[3]) / 2]);
      }
    };
    map.on('click', onClick);

    return () => {
      map.un('click', onClick);
      if (overlayRef.current) {
        map.removeOverlay(overlayRef.current);
        overlayRef.current = null;
      }
      elRef.current = null;
    };
  }, [map]);
}
