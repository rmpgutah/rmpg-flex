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
import { mapboxgl } from '../utils/mapboxLoader';

// ── Types ────────────────────────────────────────────────────

export type PlanItemType = 'perimeter' | 'route' | 'staging' | 'annotation';

export interface PlanItem {
  id: string;
  type: PlanItemType;
  label: string;
  color: string;
  /** For polygons/routes: array of [lng, lat] coords */
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
  perimeter: '#ef4444',
  route: '#888888',
  staging: '#22c55e',
  annotation: '#f59e0b',
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
  popup: mapboxgl.Popup | null;
}

export function useEventPlanning({ map, popup }: UseEventPlanningOptions) {
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

  // Map overlay tracking
  const overlayMarkersRef = useRef<mapboxgl.Marker[]>([]);
  const overlaySourceIdsRef = useRef<string[]>([]);
  const drawPointsRef = useRef<[number, number][]>([]);
  const drawSourceIdRef = useRef<string | null>(null);
  const drawLayerIdRef = useRef<string | null>(null);

  // Refs to break stale closure in listeners
  const addItemToPlanRef = useRef<(item: PlanItem) => void>(() => {});
  const finishDrawingRef = useRef<() => void>(() => {});
  const cancelDrawingRef = useRef<() => void>(() => {});
  const clickHandlerRef = useRef<((e: mapboxgl.MapMouseEvent) => void) | null>(null);
  const dblClickHandlerRef = useRef<((e: mapboxgl.MapMouseEvent) => void) | null>(null);

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

  // ── Cleanup drawing preview layers ────────────────────────
  const stopDrawingListeners = useCallback(() => {
    if (!map) return;
    if (drawLayerIdRef.current) {
      try { map.removeLayer(drawLayerIdRef.current); } catch {}
      drawLayerIdRef.current = null;
    }
    if (drawSourceIdRef.current) {
      try { map.removeSource(drawSourceIdRef.current); } catch {}
      drawSourceIdRef.current = null;
    }
    drawPointsRef.current = [];
  }, [map]);

  // ── Start drawing mode ─────────────────────────────────────
  const startDrawing = useCallback((type: PlanItemType) => {
    if (!map || !activePlanId) return;
    cancelDrawingRef.current();
    setDrawMode(type);

    if (type === 'staging' || type === 'annotation') {
      setIsDrawing(true);
      const onMapClick = (e: mapboxgl.MapMouseEvent) => {
        const lngLat = e.lngLat;
        const position = { lat: lngLat.lat, lng: lngLat.lng };
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
        map.off('click', onMapClick);
      };
      clickHandlerRef.current = onMapClick;
      dblClickHandlerRef.current = null;
      map.on('click', onMapClick);
      drawLayerIdRef.current = onMapClick as any;
    } else {
      setIsDrawing(true);
      drawPointsRef.current = [];

      const sourceId = `draw-preview-${Date.now()}`;
      const layerId = sourceId;
      drawSourceIdRef.current = sourceId;
      drawLayerIdRef.current = layerId;

      const onMapClick = (e: mapboxgl.MapMouseEvent) => {
        drawPointsRef.current.push([e.lngLat.lng, e.lngLat.lat]);

        map.addSource(sourceId, {
          type: 'geojson',
          data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: drawPointsRef.current } },
        });

        if (map.getLayer(layerId)) {
          (map.getSource(sourceId) as any)?.setData?.(
            { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: drawPointsRef.current } }
          );
        } else {
          const isPerimeter = type === 'perimeter';
          map.addLayer({
            id: layerId,
            type: isPerimeter ? 'fill' : 'line',
            source: sourceId,
            ...(isPerimeter ? {
              paint: {
                'fill-color': PLAN_COLORS[type],
                'fill-opacity': 0.12,
              },
            } : {
              paint: {
                'line-color': PLAN_COLORS[type],
                'line-width': 2,
                'line-opacity': 0.8,
              },
            }),
          });
        }
      };

      const onMapDblClick = () => {
        finishDrawingRef.current();
      };

      clickHandlerRef.current = onMapClick;
      dblClickHandlerRef.current = onMapDblClick;

      map.on('click', onMapClick);
      map.on('dblclick', onMapDblClick);
    }
  }, [map, activePlanId, stopDrawingListeners]);

  // ── Finish multi-point drawing ─────────────────────────────
  const finishDrawing = useCallback(() => {
    if (!drawMode || !activePlanId) return;
    const points = drawPointsRef.current;
    if (points.length < 2) {
      cancelDrawingRef.current();
      return;
    }

    const path = points.map(([lng, lat]) => ({ lat, lng }));

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
    if (map) {
      if (clickHandlerRef.current) map.off('click', clickHandlerRef.current);
      if (dblClickHandlerRef.current) map.off('dblclick', dblClickHandlerRef.current);
      clickHandlerRef.current = null;
      dblClickHandlerRef.current = null;
    }
    stopDrawingListeners();
    setDrawMode(null);
    setIsDrawing(false);
  }, [drawMode, activePlanId, map, stopDrawingListeners]);

  // ── Cancel current drawing ─────────────────────────────────
  const cancelDrawing = useCallback(() => {
    if (map) {
      if (clickHandlerRef.current) map.off('click', clickHandlerRef.current);
      if (dblClickHandlerRef.current) map.off('dblclick', dblClickHandlerRef.current);
      clickHandlerRef.current = null;
      dblClickHandlerRef.current = null;
    }
    stopDrawingListeners();
    setDrawMode(null);
    setIsDrawing(false);
  }, [map, stopDrawingListeners]);

  // ── Add item to active plan ────────────────────────────────
  const addItemToPlan = useCallback((item: PlanItem) => {
    setPlans((prev) => prev.map((p) =>
      p.id === activePlanId
        ? { ...p, items: [...p.items, item], updatedAt: new Date().toISOString() }
        : p
    ));
  }, [activePlanId]);

  // Keep refs in sync so map listeners always call the latest version
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

  // ── Render plan overlays on map ────────────────────────────
  useEffect(() => {
    // Clear existing overlays
    for (const m of overlayMarkersRef.current) m.remove();
    overlayMarkersRef.current = [];
    for (const id of overlaySourceIdsRef.current) {
      try {
        if (map) {
          if (map.getLayer(id)) map.removeLayer(id);
          if (map.getSource(id)) map.removeSource(id);
        }
      } catch {}
    }
    overlaySourceIdsRef.current = [];

    if (!map || !activePlan || !planVisible) return;

    let idx = 0;
    for (const item of activePlan.items) {
      if (item.type === 'perimeter' && item.path && item.path.length >= 3) {
        const coords = item.path.map(p => [p.lng, p.lat] as [number, number]);
        coords.push([item.path[0].lng, item.path[0].lat]); // close polygon
        const sourceId = `plan-perimeter-${idx++}`;
        overlaySourceIdsRef.current.push(sourceId);
        map.addSource(sourceId, {
          type: 'geojson',
          data: { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [coords] } },
        });
        map.addLayer({
          id: sourceId,
          type: 'fill',
          source: sourceId,
          paint: {
            'fill-color': item.color,
            'fill-opacity': 0.12,
          },
        });
        // Outline
        const outlineId = `${sourceId}-outline`;
        overlaySourceIdsRef.current.push(outlineId);
        map.addLayer({
          id: outlineId,
          type: 'line',
          source: sourceId,
          paint: {
            'line-color': item.color,
            'line-width': 2,
            'line-opacity': 0.8,
          },
        });
      }

      if (item.type === 'route' && item.path && item.path.length >= 2) {
        const coords = item.path.map(p => [p.lng, p.lat] as [number, number]);
        const sourceId = `plan-route-${idx++}`;
        overlaySourceIdsRef.current.push(sourceId);
        map.addSource(sourceId, {
          type: 'geojson',
          data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } },
        });
        map.addLayer({
          id: sourceId,
          type: 'line',
          source: sourceId,
          paint: {
            'line-color': item.color,
            'line-width': 3,
            'line-opacity': 0.9,
          },
        });
      }

      if ((item.type === 'staging' || item.type === 'annotation') && item.position) {
        const el = document.createElement('div');
        el.style.cssText = `width:16px;height:16px;text-align:center;line-height:16px;font-size:14px;`;
        el.textContent = item.type === 'staging' ? '◆' : '●';
        el.style.color = item.color;

        const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
          .setLngLat([item.position.lng, item.position.lat])
          .addTo(map);

        if (item.type === 'annotation' && (item.text || item.label)) {
          const labelDiv = document.createElement('div');
          labelDiv.style.cssText = 'color:#fff;font-size:10px;font-weight:bold;text-shadow:0 0 4px #000;white-space:nowrap;';
          labelDiv.textContent = item.text || item.label;
          elementAppendToMarker(marker, labelDiv);
        }

        marker.getElement().addEventListener('click', () => {
          if (popup) {
            popup.setLngLat([item.position!.lng, item.position!.lat])
              .setHTML(makeInfoHtml(item))
              .addTo(map);
          }
        });

        overlayMarkersRef.current.push(marker);
      }
    }
  }, [map, activePlan, planVisible, popup]);

  // ── Cleanup on unmount ─────────────────────────────────────
  useEffect(() => {
    return () => {
      stopDrawingListeners();
      for (const m of overlayMarkersRef.current) m.remove();
      overlayMarkersRef.current = [];
      for (const id of overlaySourceIdsRef.current) {
        try {
          if (map) {
            if (map.getLayer(id)) map.removeLayer(id);
            if (map.getSource(id)) map.removeSource(id);
          }
        } catch {}
      }
      overlaySourceIdsRef.current = [];
    };
  }, [map, stopDrawingListeners]);

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

function elementAppendToMarker(marker: mapboxgl.Marker, childEl: HTMLElement): void {
  const markerEl = marker.getElement();
  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'display:flex;flex-direction:column;align-items:center;';
  while (markerEl.firstChild) wrapper.appendChild(markerEl.firstChild);
  wrapper.appendChild(childEl);
  markerEl.appendChild(wrapper);
}
