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
  route: '#3b82f6',       // Blue
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
  map: google.maps.Map | null;
  infoWindow: google.maps.InfoWindow | null;
}

export function useEventPlanning({ map, infoWindow }: UseEventPlanningOptions) {
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

  // Map overlay references
  const overlaysRef = useRef<Array<google.maps.Polygon | google.maps.Polyline | google.maps.Marker>>([]);
  const drawPointsRef = useRef<google.maps.LatLng[]>([]);
  const drawPolylineRef = useRef<google.maps.Polyline | null>(null);
  const clickListenerRef = useRef<google.maps.MapsEventListener | null>(null);
  const dblClickListenerRef = useRef<google.maps.MapsEventListener | null>(null);

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

  // ── Start drawing mode ─────────────────────────────────────

  const startDrawing = useCallback((type: PlanItemType) => {
    if (!map || !activePlanId) return;
    // Cancel any existing draw
    cancelDrawing();
    setDrawMode(type);

    if (type === 'staging' || type === 'annotation') {
      // Single-click to place
      setIsDrawing(true);
      const listener = map.addListener('click', (e: google.maps.MapMouseEvent) => {
        if (!e.latLng) return;
        const position = { lat: e.latLng.lat(), lng: e.latLng.lng() };

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

        addItemToPlan(item);
        stopDrawingListeners();
        setDrawMode(null);
        setIsDrawing(false);
      });
      clickListenerRef.current = listener;
    } else {
      // Multi-click polygon/polyline
      setIsDrawing(true);
      drawPointsRef.current = [];

      // Preview polyline while drawing
      const previewLine = new google.maps.Polyline({
        map,
        path: [],
        strokeColor: PLAN_COLORS[type],
        strokeOpacity: 0.8,
        strokeWeight: 2,
        icons: type === 'route' ? [{ icon: { path: google.maps.SymbolPath.FORWARD_OPEN_ARROW, scale: 2 }, offset: '50%' }] : [],
      });
      drawPolylineRef.current = previewLine;

      const listener = map.addListener('click', (e: google.maps.MapMouseEvent) => {
        if (!e.latLng) return;
        drawPointsRef.current.push(e.latLng);
        previewLine.setPath(drawPointsRef.current);
      });

      const dblListener = map.addListener('dblclick', (e: google.maps.MapMouseEvent) => {
        e.stop?.();
        finishDrawing();
      });

      clickListenerRef.current = listener;
      dblClickListenerRef.current = dblListener;
    }
  }, [map, activePlanId]);

  // ── Finish multi-point drawing ─────────────────────────────

  const finishDrawing = useCallback(() => {
    if (!drawMode || !activePlanId) return;
    const points = drawPointsRef.current;
    if (points.length < 2) {
      cancelDrawing();
      return;
    }

    const path = points.map((p) => ({ lat: p.lat(), lng: p.lng() }));

    const defaultLabel = drawMode === 'perimeter' ? 'Perimeter' : 'Route';
    const item: PlanItem = {
      id: `item_${Date.now()}`,
      type: drawMode,
      label: defaultLabel,
      color: PLAN_COLORS[drawMode],
      path,
      createdAt: new Date().toISOString(),
    };

    addItemToPlan(item);
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
    if (clickListenerRef.current) {
      google.maps.event.removeListener(clickListenerRef.current);
      clickListenerRef.current = null;
    }
    if (dblClickListenerRef.current) {
      google.maps.event.removeListener(dblClickListenerRef.current);
      dblClickListenerRef.current = null;
    }
    if (drawPolylineRef.current) {
      drawPolylineRef.current.setMap(null);
      drawPolylineRef.current = null;
    }
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
    for (const ol of overlaysRef.current) {
      if ('setMap' in ol) (ol as any).setMap(null);
    }
    overlaysRef.current = [];

    if (!map || !activePlan || !planVisible) return;

    for (const item of activePlan.items) {
      if (item.type === 'perimeter' && item.path && item.path.length >= 3) {
        const polygon = new google.maps.Polygon({
          map,
          paths: item.path,
          strokeColor: item.color,
          strokeOpacity: 0.8,
          strokeWeight: 2,
          fillColor: item.color,
          fillOpacity: 0.12,
          clickable: true,
        });
        polygon.addListener('click', (e: google.maps.PolyMouseEvent) => {
          if (infoWindow && e.latLng) {
            infoWindow.setContent(makeInfoHtml(item));
            infoWindow.setPosition(e.latLng);
            infoWindow.open(map);
          }
        });
        overlaysRef.current.push(polygon);
      }

      if (item.type === 'route' && item.path && item.path.length >= 2) {
        const polyline = new google.maps.Polyline({
          map,
          path: item.path,
          strokeColor: item.color,
          strokeOpacity: 0.9,
          strokeWeight: 3,
          icons: [{ icon: { path: google.maps.SymbolPath.FORWARD_OPEN_ARROW, scale: 3, strokeColor: item.color }, offset: '50%' }],
          clickable: true,
        });
        polyline.addListener('click', (e: google.maps.PolyMouseEvent) => {
          if (infoWindow && e.latLng) {
            infoWindow.setContent(makeInfoHtml(item));
            infoWindow.setPosition(e.latLng);
            infoWindow.open(map);
          }
        });
        overlaysRef.current.push(polyline);
      }

      if ((item.type === 'staging' || item.type === 'annotation') && item.position) {
        const marker = new google.maps.Marker({
          map,
          position: item.position,
          title: item.label,
          icon: {
            path: item.type === 'staging'
              ? google.maps.SymbolPath.BACKWARD_CLOSED_ARROW
              : google.maps.SymbolPath.CIRCLE,
            scale: item.type === 'staging' ? 8 : 6,
            fillColor: item.color,
            fillOpacity: 0.9,
            strokeColor: '#ffffff',
            strokeWeight: 2,
          },
          label: item.type === 'annotation' ? {
            text: item.text || item.label,
            color: '#ffffff',
            fontSize: '10px',
            fontWeight: 'bold',
            className: 'event-plan-label',
          } : undefined,
        });
        marker.addListener('click', () => {
          if (infoWindow) {
            infoWindow.setContent(makeInfoHtml(item));
            infoWindow.setPosition(item.position!);
            infoWindow.open(map);
          }
        });
        overlaysRef.current.push(marker);
      }
    }
  }, [map, activePlan, planVisible, infoWindow]);

  // ── Cleanup on unmount ─────────────────────────────────────

  useEffect(() => {
    return () => {
      stopDrawingListeners();
      for (const ol of overlaysRef.current) {
        if ('setMap' in ol) (ol as any).setMap(null);
      }
      overlaysRef.current = [];
    };
  }, []);

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
