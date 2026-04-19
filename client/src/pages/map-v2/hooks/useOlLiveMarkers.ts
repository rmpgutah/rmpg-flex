import { useEffect, useRef, useCallback } from 'react';
import type Map from 'ol/Map';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import Style from 'ol/style/Style';
import CircleStyle from 'ol/style/Circle';
import StrokeStyle from 'ol/style/Stroke';
import FillStyle from 'ol/style/Fill';
import TextStyle from 'ol/style/Text';
import Overlay from 'ol/Overlay';
import { fromLonLat } from 'ol/proj';
import { apiFetch } from '../../../hooks/useApi';
import { useWebSocket } from '../../../context/WebSocketContext';
import { UNIT_STATUS_HEX, PRIORITY_HEX, UNIT_STATUS_LABELS } from '../../../utils/statusColors';
import type { Unit, CallForService, UnitStatus, CallPriority } from '../../../types';
import { devWarn } from '../../../utils/devLog';

type MarkerKind = 'unit' | 'call';

function unitStyle(u: Unit): Style {
  const color = UNIT_STATUS_HEX[u.status as UnitStatus] || '#888888';
  return new Style({
    image: new CircleStyle({
      radius: 7,
      fill: new FillStyle({ color }),
      stroke: new StrokeStyle({ color: '#0a0a0a', width: 2 }),
    }),
    text: new TextStyle({
      text: u.call_sign,
      offsetY: -16,
      font: '600 10px ui-monospace, monospace',
      fill: new FillStyle({ color: '#e5e7eb' }),
      stroke: new StrokeStyle({ color: '#000000', width: 3 }),
    }),
  });
}

function callStyle(c: CallForService): Style {
  const color = PRIORITY_HEX[c.priority as CallPriority] || '#888888';
  return new Style({
    image: new CircleStyle({
      radius: 6,
      fill: new FillStyle({ color: `${color}88` }),
      stroke: new StrokeStyle({ color, width: 2 }),
    }),
    text: new TextStyle({
      text: c.call_number,
      offsetY: 14,
      font: '600 9px ui-monospace, monospace',
      fill: new FillStyle({ color }),
      stroke: new StrokeStyle({ color: '#000000', width: 3 }),
    }),
  });
}

function buildUnitFeature(u: Unit): Feature<Point> | null {
  if (u.latitude == null || u.longitude == null) return null;
  const f = new Feature({
    geometry: new Point(fromLonLat([u.longitude, u.latitude])),
    kind: 'unit' as MarkerKind,
    payload: u,
  });
  f.setId(`unit:${u.id}`);
  f.setStyle(unitStyle(u));
  return f;
}

function buildCallFeature(c: CallForService): Feature<Point> | null {
  if (c.latitude == null || c.longitude == null) return null;
  const f = new Feature({
    geometry: new Point(fromLonLat([c.longitude, c.latitude])),
    kind: 'call' as MarkerKind,
    payload: c,
  });
  f.setId(`call:${c.id}`);
  f.setStyle(callStyle(c));
  return f;
}

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

// Build the popup as DOM nodes (textContent-only) so user-influenced
// fields like incident_type / location can never inject HTML.
function buildPopupNode(kind: MarkerKind, payload: Unit | CallForService): HTMLDivElement {
  const root = document.createElement('div');
  root.style.minWidth = '160px';
  root.style.fontFamily = 'ui-monospace, monospace';
  root.style.background = '#0a0a0a';
  root.style.color = '#e5e7eb';
  root.style.padding = '8px';

  if (kind === 'unit') {
    const u = payload as Unit;
    const color = UNIT_STATUS_HEX[u.status as UnitStatus] || '#888888';
    root.style.border = `1px solid ${color}80`;
    root.appendChild(makeRow(u.call_sign, color, 11, 700, { marginTop: '0' }));
    root.appendChild(makeRow(u.officer_name || '', '#9ca3af', 9, 400));
    const status = makeRow(UNIT_STATUS_LABELS[u.status as UnitStatus] || u.status, color, 9, 400, { marginTop: '4px' });
    status.style.textTransform = 'uppercase';
    status.style.letterSpacing = '0.5px';
    root.appendChild(status);
  } else {
    const c = payload as CallForService;
    const color = PRIORITY_HEX[c.priority as CallPriority] || '#888888';
    root.style.border = `1px solid ${color}80`;
    root.style.minWidth = '180px';
    root.appendChild(makeRow(`${c.call_number} · ${c.priority}`, color, 11, 700, { marginTop: '0' }));
    root.appendChild(makeRow(c.incident_type, '#e5e7eb', 9, 400));
    root.appendChild(makeRow(c.location || '', '#9ca3af', 9, 400));
    const status = makeRow(c.status, color, 9, 400, { marginTop: '4px' });
    status.style.textTransform = 'uppercase';
    status.style.letterSpacing = '0.5px';
    root.appendChild(status);
  }
  return root;
}

export function useOlLiveMarkers(map: Map | null): void {
  const sourceRef = useRef<VectorSource | null>(null);
  const overlayRef = useRef<Overlay | null>(null);
  const overlayElRef = useRef<HTMLDivElement | null>(null);
  const { subscribe } = useWebSocket();

  const refetch = useCallback(async () => {
    const source = sourceRef.current;
    if (!source) return;
    try {
      const [callsRes, unitsRes] = await Promise.all([
        apiFetch<any>('/dispatch/calls?limit=200'),
        apiFetch<Unit[]>('/dispatch/units'),
      ]);
      const callsRaw: any[] = Array.isArray(callsRes?.data) ? callsRes.data : Array.isArray(callsRes) ? callsRes : [];

      // Build target feature map keyed by feature ID. We diff against the
      // current source instead of clear+rebuild so live WS-driven refetches
      // (~4Hz under busy patrol) don't strobe the markers off-and-on.
      const target = new Map<string, Feature<Point>>();
      for (const u of (unitsRes || [])) {
        const f = buildUnitFeature(u);
        if (f) target.set(f.getId() as string, f);
      }
      for (const c of callsRaw) {
        const f = buildCallFeature(c as CallForService);
        if (f) target.set(f.getId() as string, f);
      }

      const current = new Map<string, Feature<Point>>();
      for (const f of source.getFeatures()) {
        const id = f.getId();
        if (typeof id === 'string') current.set(id, f as Feature<Point>);
      }

      // Remove features no longer present
      for (const [id, f] of current) {
        if (!target.has(id)) source.removeFeature(f);
      }

      // Add new features; update existing in place (no removeFeature flicker)
      for (const [id, newF] of target) {
        const existing = current.get(id);
        if (!existing) {
          source.addFeature(newF);
          continue;
        }
        const newGeom = newF.getGeometry();
        if (newGeom) existing.setGeometry(newGeom);
        existing.setStyle(newF.getStyle() as any);
        existing.set('payload', newF.get('payload'));
      }
    } catch (err) {
      devWarn('[map-v2] live refetch failed:', err);
    }
  }, []);

  useEffect(() => {
    if (!map || sourceRef.current) return;

    const source = new VectorSource();
    sourceRef.current = source;
    const layer = new VectorLayer({ source, zIndex: 100 });
    map.addLayer(layer);

    const el = document.createElement('div');
    el.style.position = 'absolute';
    el.style.transform = 'translate(-50%, calc(-100% - 12px))';
    el.style.pointerEvents = 'auto';
    overlayElRef.current = el;
    const overlay = new Overlay({ element: el, autoPan: { animation: { duration: 200 } } });
    overlayRef.current = overlay;
    map.addOverlay(overlay);

    const onClick = (evt: any) => {
      const feature = map.forEachFeatureAtPixel(evt.pixel, (f) => f as Feature<Point>);
      if (!feature) {
        overlay.setPosition(undefined);
        while (el.firstChild) el.removeChild(el.firstChild);
        return;
      }
      const kind = feature.get('kind') as MarkerKind;
      const payload = feature.get('payload');
      if (!payload) return;
      while (el.firstChild) el.removeChild(el.firstChild);
      el.appendChild(buildPopupNode(kind, payload));
      const geom = feature.getGeometry();
      if (geom) overlay.setPosition(geom.getCoordinates());
    };
    map.on('click', onClick);

    refetch();

    return () => {
      map.un('click', onClick);
      map.removeLayer(layer);
      map.removeOverlay(overlay);
      sourceRef.current = null;
      overlayRef.current = null;
      overlayElRef.current = null;
    };
  }, [map, refetch]);

  // Live updates — debounced refetch on any dispatch event. V2 is
  // read-only; a full /dispatch/calls + /dispatch/units round-trip
  // for the SLC operational footprint is < 50 KB.
  useEffect(() => {
    if (!map) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const debounced = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { refetch(); }, 1000);
    };
    const unsubUnit = subscribe('unit_update', debounced);
    const unsubDispatch = subscribe('dispatch_update', debounced);
    return () => {
      if (timer) clearTimeout(timer);
      unsubUnit();
      unsubDispatch();
    };
  }, [map, subscribe, refetch]);
}
