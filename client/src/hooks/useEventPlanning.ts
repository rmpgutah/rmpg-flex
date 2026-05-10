// ============================================================
// RMPG Flex — Event Planning Overlay Hook
// ============================================================
// Allows drawing operational planning overlays on the map:
//   - Perimeters / cordons (polygons)
//   - Routes / march paths (polylines)
//   - Staging areas / command posts (markers)
//   - Annotations (text labels)
// Supports save/load of plans via API or localStorage.
// ============================================================

import { useState, useRef, useCallback, useEffect } from 'react';
import mapboxgl from 'mapbox-gl';

// ── Types ────────────────────────────────────────────────────

export type PlanItemType = 'perimeter' | 'route' | 'staging' | 'annotation';

export interface PlanItem {
  id: string;
  type: PlanItemType;
  label: string;
  color: string;
  /** For polygons: array of LatLng coords */
  path?: Array<{ lat: number; lng: number }>;
  /** For markers/annotations: single point */
  position?: { lat: number; lng: number };
  /** For annotations: text content */
  text?: string;
  createdAt: string;
}

export interface EventPlan {
  id: string;
  name: string;
  description?: string;
  items: PlanItem[];
  createdAt: string;
  updatedAt: string;
}

// ── Drawing Colors ───────────────────────────────────────────

export const PLAN_COLORS: Record<PlanItemType, string> = {
  perimeter: '#ef4444',   // Red
  route: '#888888',       // Gray
  staging: '#22c55e',     // Green
  annotation: '#f59e0b',  // Amber
};

export const PLAN_TYPE_LABELS: Record<PlanItemType, string> = {
  perimeter: 'Perimeter / Cordon',
  route: 'Route / Path',
  staging: 'Staging Area / CP',
  annotation: 'Annotation',
};

const LS_KEY = 'rmpg_event_plans';

// ── Hook ─────────────────────────────────────────────────────

interface UseEventPlanningOptions {
  map: mapboxgl.Map | null;
}

/** Create a styled DOM element for a Mapbox marker */
function createMarkerEl(color: string, type: 'staging' | 'annotation', text?: string): HTMLElement {
  const el = document.createElement('div');
  const size = type === 'staging' ? 16 : 12;
  el.style.width = `${size}px`;
  el.style.height = `${size}px`;
  el.style.backgroundColor = color;
  el.style.border = '2px solid #ffffff';
  el.style.borderRadius = type === 'staging' ? '2px' : '50%';
  el.style.cursor = 'pointer';
  if (type === 'annotation' && text) {
    const label = document.createElement('span');
    label.textContent = text;
    label.style.cssText = 'position:absolute;left:18px;top:-4px;color:#fff;font-size:10px;font-weight:bold;white-space:nowrap;pointer-events:none;';
    el.style.position = 'relative';
    el.appendChild(label);
  }
  return el;
}

export function useEventPlanning({ map }: UseEventPlanningOptions) {
  const [plans, setPlans] = useState<EventPlan[]>(() => {
    try {
      const saved = localStorage.getItem(LS_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });

  const [activePlanId, setActivePlanId] = useState<string | null>(null);
  const [drawMode, setDrawMode] = useState<PlanItemType | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [planVisible, setPlanVisible] = useState(true);

  // Map overlay references — Mapbox markers + source/layer IDs
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const layerIdsRef = useRef<string[]>([]);
  const drawPointsRef = useRef<[number, number][]>([]);
  const previewSourceId = 'event-plan-draw-preview';
  const clickHandlerRef = useRef<((e: mapboxgl.MapMouseEvent) => void) | null>(null);
  const dblClickHandlerRef = useRef<((e: mapboxgl.MapMouseEvent) => void) | null>(null);

  // Refs to break stale closure in listeners
  const addItemToPlanRef = useRef<(item: PlanItem) => void>(() => {});
  const finishDrawingRef = useRef<() => void>(() => {});
  const cancelDrawingRef = useRef<() => void>(() => {});

  const activePlan = plans.find((p) => p.id === activePlanId) ?? null;

  // ── Persist plans to localStorage ──────────────────────────

  useEffect(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(plans)); } catch { /* ignore */ }
  }, [plans]);

  // ── Create a new plan ──────────────────────────────────────

  const createPlan = useCallback((name: string, description?: string) => {
    const plan: EventPlan = {
      id: `plan_${Date.now()}`,
      name,
      description,
      items: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setPlans((prev) => [...prev, plan]);
    setActivePlanId(plan.id);
    return plan;
  }, []);

  const deletePlan = useCallback((planId: string) => {
    setPlans((prev) => prev.filter((p) => p.id !== planId));
    if (activePlanId === planId) setActivePlanId(null);
  }, [activePlanId]);

  const renamePlan = useCallback((planId: string, name: string) => {
    setPlans((prev) => prev.map((p) =>
      p.id === planId ? { ...p, name, updatedAt: new Date().toISOString() } : p
    ));
  }, []);

  // ── Helpers: remove preview source/layer ───────────────────

  const removePreview = useCallback(() => {
    if (!map) return;
    try {
      if (map.getLayer(previewSourceId)) map.removeLayer(previewSourceId);
      if (map.getSource(previewSourceId)) map.removeSource(previewSourceId);
    } catch { /* ignore */ }
  }, [map]);

  // ── Start drawing mode ─────────────────────────────────────

  const startDrawing = useCallback((type: PlanItemType) => {
    if (!map || !activePlanId) return;
    cancelDrawingRef.current();
    setDrawMode(type);

    if (type === 'staging' || type === 'annotation') {
      setIsDrawing(true);
      const handler = (e: mapboxgl.MapMouseEvent) => {
        const position = { lat: e.lngLat.lat, lng: e.lngLat.lng };
        const label = type === 'staging' ? 'Staging Area' : 'Note';
        const text = type === 'annotation' ? prompt('Enter annotation text:') || 'Note' : undefined;

        const item: PlanItem = {
          id: `item_${Date.now()}`,
          type,
          label: text || label,
          color: PLAN_COLORS[type],
          position,
          text,
          createdAt: new Date().toISOString(),
        };

        addItemToPlanRef.current(item);
        stopDrawingListeners();
        setDrawMode(null);
        setIsDrawing(false);
      };
      map.on('click', handler);
      clickHandlerRef.current = handler;
    } else {
      // Multi-click polygon/polyline
      setIsDrawing(true);
      drawPointsRef.current = [];

      // Add preview line source
      removePreview();
      map.addSource(previewSourceId, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: previewSourceId,
        type: 'line',
        source: previewSourceId,
        paint: {
          'line-color': PLAN_COLORS[type],
          'line-width': 2,
          'line-opacity': 0.8,
        },
        layout: { 'line-join': 'round', 'line-cap': 'round' },
      });

      const clickHandler = (e: mapboxgl.MapMouseEvent) => {
        drawPointsRef.current.push([e.lngLat.lng, e.lngLat.lat]);
        const src = map.getSource(previewSourceId) as mapboxgl.GeoJSONSource | undefined;
        if (src) {
          src.setData({
            type: 'FeatureCollection',
            features: [{
              type: 'Feature',
              geometry: { type: 'LineString', coordinates: drawPointsRef.current },
              properties: {},
            }],
          });
        }
      };

      const dblHandler = (e: mapboxgl.MapMouseEvent) => {
        e.preventDefault();
        finishDrawingRef.current();
      };

      map.on('click', clickHandler);
      map.on('dblclick', dblHandler);
      clickHandlerRef.current = clickHandler;
      dblClickHandlerRef.current = dblHandler;
    }
  }, [map, activePlanId, removePreview]);

  // ── Finish multi-point drawing ─────────────────────────────

  const finishDrawing = useCallback(() => {
    if (!drawMode || !activePlanId) return;
    const points = drawPointsRef.current;
    if (points.length < 2) {
      cancelDrawingRef.current();
      return;
    }

    const path = points.map((p) => ({ lat: p[1], lng: p[0] }));

    const defaultLabel = drawMode === 'perimeter' ? 'Perimeter' : 'Route';
    const item: PlanItem = {
      id: `item_${Date.now()}`,
      type: drawMode,
      label: defaultLabel,
      color: PLAN_COLORS[drawMode],
      path,
      createdAt: new Date().toISOString(),
    };

    addItemToPlanRef.current(item);
    stopDrawingListeners();
    setDrawMode(null);
    setIsDrawing(false);
  }, [drawMode, activePlanId]);

  // ── Cancel current drawing ─────────────────────────────────

  const cancelDrawing = useCallback(() => {
    stopDrawingListeners();
    setDrawMode(null);
    setIsDrawing(false);
  }, []);

  const stopDrawingListeners = () => {
    if (map && clickHandlerRef.current) {
      map.off('click', clickHandlerRef.current);
      clickHandlerRef.current = null;
    }
    if (map && dblClickHandlerRef.current) {
      map.off('dblclick', dblClickHandlerRef.current);
      dblClickHandlerRef.current = null;
    }
    removePreview();
    drawPointsRef.current = [];
  };

  // ── Add item to active plan ────────────────────────────────

  const addItemToPlan = useCallback((item: PlanItem) => {
    setPlans((prev) => prev.map((p) =>
      p.id === activePlanId
        ? { ...p, items: [...p.items, item], updatedAt: new Date().toISOString() }
        : p
    ));
  }, [activePlanId]);

  // Keep refs in sync so listeners always call the latest version
  addItemToPlanRef.current = addItemToPlan;
  finishDrawingRef.current = finishDrawing;
  cancelDrawingRef.current = cancelDrawing;

  const removeItemFromPlan = useCallback((itemId: string) => {
    setPlans((prev) => prev.map((p) =>
      p.id === activePlanId
        ? { ...p, items: p.items.filter((i) => i.id !== itemId), updatedAt: new Date().toISOString() }
        : p
    ));
  }, [activePlanId]);

  const renameItem = useCallback((itemId: string, label: string) => {
    setPlans((prev) => prev.map((p) =>
      p.id === activePlanId
        ? { ...p, items: p.items.map((i) => i.id === itemId ? { ...i, label } : i), updatedAt: new Date().toISOString() }
        : p
    ));
  }, [activePlanId]);

  // ── Helper: remove all rendered overlays ───────────────────

  const clearOverlays = useCallback(() => {
    for (const m of markersRef.current) m.remove();
    markersRef.current = [];
    if (map) {
      for (const lid of layerIdsRef.current) {
        try {
          if (map.getLayer(lid)) map.removeLayer(lid);
          if (map.getSource(lid)) map.removeSource(lid);
        } catch { /* ignore */ }
      }
    }
    layerIdsRef.current = [];
  }, [map]);

  // ── Render plan overlays on map ────────────────────────────

  useEffect(() => {
    clearOverlays();
    if (!map || !activePlan || !planVisible) return;

    for (const item of activePlan.items) {
      if (item.type === 'perimeter' && item.path && item.path.length >= 3) {
        const coords: [number, number][] = item.path.map((p) => [p.lng, p.lat]);
        // Close the polygon ring
        if (coords.length > 0) coords.push(coords[0]);
        const fillId = `plan-fill-${item.id}`;
        const lineId = `plan-line-${item.id}`;
        const srcId = `plan-src-${item.id}`;

        map.addSource(srcId, {
          type: 'geojson',
          data: {
            type: 'Feature',
            geometry: { type: 'Polygon', coordinates: [coords] },
            properties: { label: item.label, itemId: item.id },
          },
        });
        map.addLayer({
          id: fillId, type: 'fill', source: srcId,
          paint: { 'fill-color': item.color, 'fill-opacity': 0.12 },
        });
        map.addLayer({
          id: lineId, type: 'line', source: srcId,
          paint: { 'line-color': item.color, 'line-width': 2, 'line-opacity': 0.8 },
        });
        layerIdsRef.current.push(fillId, lineId, srcId);
      }

      if (item.type === 'route' && item.path && item.path.length >= 2) {
        const coords: [number, number][] = item.path.map((p) => [p.lng, p.lat]);
        const lineId = `plan-route-${item.id}`;

        map.addSource(lineId, {
          type: 'geojson',
          data: {
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: coords },
            properties: { label: item.label, itemId: item.id },
          },
        });
        map.addLayer({
          id: lineId, type: 'line', source: lineId,
          paint: { 'line-color': item.color, 'line-width': 3, 'line-opacity': 0.9 },
          layout: { 'line-join': 'round', 'line-cap': 'round' },
        });
        layerIdsRef.current.push(lineId);
      }

      if ((item.type === 'staging' || item.type === 'annotation') && item.position) {
        const el = createMarkerEl(item.color, item.type, item.type === 'annotation' ? (item.text || item.label) : undefined);
        const popup = new mapboxgl.Popup({ offset: 15, closeButton: true, className: 'event-plan-popup' })
          .setHTML(makeInfoHtml(item));
        const marker = new mapboxgl.Marker({ element: el })
          .setLngLat([item.position.lng, item.position.lat])
          .setPopup(popup)
          .addTo(map);
        markersRef.current.push(marker);
      }
    }
  }, [map, activePlan, planVisible, clearOverlays]);

  // ── Cleanup on unmount ─────────────────────────────────────

  useEffect(() => {
    return () => {
      stopDrawingListeners();
      clearOverlays();
    };
  }, [clearOverlays]);

  return {
    plans,
    activePlan,
    activePlanId,
    setActivePlanId,
    drawMode,
    isDrawing,
    planVisible,
    setPlanVisible,
    createPlan,
    deletePlan,
    renamePlan,
    startDrawing,
    finishDrawing,
    cancelDrawing,
    removeItemFromPlan,
    renameItem,
  };
}

// ── Helpers ──────────────────────────────────────────────────

function escapeForHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function makeInfoHtml(item: PlanItem): string {
  const typeLabel = PLAN_TYPE_LABELS[item.type] || item.type;
  let html = `<div style="font-family:'Courier New',monospace;color:#d4d4d4;font-size:11px;min-width:140px;">`;
  html += `<div style="font-weight:bold;font-size:12px;color:#fff;margin-bottom:4px;border-bottom:1px solid ${item.color};padding-bottom:3px;">${escapeForHtml(item.label)}</div>`;
  html += `<div style="color:${item.color};font-size:9px;text-transform:uppercase;margin-bottom:4px;">${typeLabel}</div>`;
  if (item.text) {
    html += `<div style="font-size:10px;color:#bbb;margin-top:4px;">${escapeForHtml(item.text)}</div>`;
  }
  if (item.path) {
    html += `<div style="font-size:9px;color:#888;margin-top:4px;">${item.path.length} points</div>`;
  }
  html += `</div>`;
  return html;
}
