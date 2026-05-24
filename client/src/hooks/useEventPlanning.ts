import { useState, useRef, useCallback, useEffect } from 'react';
import mapboxgl from 'mapbox-gl';

export type PlanItemType = 'perimeter' | 'route' | 'staging' | 'annotation';

export interface PlanItem {
  id: string;
  type: PlanItemType;
  label: string;
  color: string;
  path?: Array<{ lat: number; lng: number }>;
  position?: { lat: number; lng: number };
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

function polygonCoordsToGeoJson(coords: Array<{ lat: number; lng: number }>) {
  const ring = [...coords.map((p) => [p.lng, p.lat])];
  ring.push(ring[0]);
  return {
    type: 'Feature' as const,
    geometry: { type: 'Polygon' as const, coordinates: [ring] },
    properties: {} as Record<string, any>,
  };
}

function lineCoordsToGeoJson(coords: Array<{ lat: number; lng: number }>) {
  return {
    type: 'Feature' as const,
    geometry: { type: 'LineString' as const, coordinates: coords.map((p) => [p.lng, p.lat]) },
    properties: {} as Record<string, any>,
  };
}

interface UseEventPlanningOptions {
  map: mapboxgl.Map | null;
  infoWindow: mapboxgl.Popup | null;
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

  const clickListenerRef = useRef<((e: mapboxgl.MapMouseEvent) => void) | null>(null);
  const mapClickListenerRef = useRef<mapboxgl.Map | null>(null);
  const drawPointsRef = useRef<Array<{ lat: number; lng: number }>>([]);
  const drawLineSourceRef = useRef<string | null>(null);
  const drawLineLayerRef = useRef<string | null>(null);
  // Track all overlay IDs for cleanup
  const overlaySourceIds = useRef<Set<string>>(new Set());
  const overlayLayerIds = useRef<Set<string>>(new Set());
  const overlayMarkers = useRef<mapboxgl.Marker[]>([]);

  const addItemToPlanRef = useRef<(item: PlanItem) => void>(() => {});
  const finishDrawingRef = useRef<() => void>(() => {});
  const cancelDrawingRef = useRef<() => void>(() => {});

  const activePlan = plans.find((p) => p.id === activePlanId) ?? null;

  useEffect(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(plans)); } catch { /* ignore */ }
  }, [plans]);

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

  const addLayer = useCallback((sourceId: string, layerId: string, layerConfig: mapboxgl.AnyLayer) => {
    if (!map) return;
    if (!map.getSource(sourceId) && (layerConfig as any).source === sourceId) {
      map.addSource(sourceId, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
    }
    if (!map.getLayer(layerId)) {
      map.addLayer(layerConfig);
    }
    overlaySourceIds.current.add(sourceId);
    overlayLayerIds.current.add(layerId);
  }, [map]);

  const removeAllOverlays = useCallback(() => {
    if (!map) return;
    for (const layerId of overlayLayerIds.current) {
      try { if (map.getLayer(layerId)) map.removeLayer(layerId); } catch { /* ignore */ }
    }
    for (const sourceId of overlaySourceIds.current) {
      try { if (map.getSource(sourceId)) map.removeSource(sourceId); } catch { /* ignore */ }
    }
    overlayLayerIds.current.clear();
    overlaySourceIds.current.clear();
    for (const m of overlayMarkers.current) m.remove();
    overlayMarkers.current = [];
  }, [map]);

  const stopDrawingListeners = useCallback(() => {
    if (mapClickListenerRef.current && clickListenerRef.current) {
      mapClickListenerRef.current.off('click', clickListenerRef.current);
    }
    mapClickListenerRef.current = null;
    clickListenerRef.current = null;
    if (drawLineLayerRef.current && map) {
      try {
        if (map.getLayer(drawLineLayerRef.current)) map.removeLayer(drawLineLayerRef.current);
      } catch { /* ignore */ }
      overlayLayerIds.current.delete(drawLineLayerRef.current);
      drawLineLayerRef.current = null;
    }
    if (drawLineSourceRef.current && map) {
      try {
        if (map.getSource(drawLineSourceRef.current)) map.removeSource(drawLineSourceRef.current);
      } catch { /* ignore */ }
      overlaySourceIds.current.delete(drawLineSourceRef.current);
      drawLineSourceRef.current = null;
    }
    drawPointsRef.current = [];
  }, [map]);

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
      mapClickListenerRef.current = map;
      clickListenerRef.current = handler;
      map.on('click', handler);
    } else {
      setIsDrawing(true);
      drawPointsRef.current = [];

      const previewSourceId = `draw-preview-source-${Date.now()}`;
      const previewLayerId = `draw-preview-line-${Date.now()}`;

      map.addSource(previewSourceId, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      overlaySourceIds.current.add(previewSourceId);
      drawLineSourceRef.current = previewSourceId;

      map.addLayer({
        id: previewLayerId,
        type: 'line',
        source: previewSourceId,
        layout: {
          'line-join': 'round',
          'line-cap': 'round',
        },
        paint: {
          'line-color': PLAN_COLORS[type],
          'line-width': 2,
          'line-opacity': 0.8,
        },
      });
      overlayLayerIds.current.add(previewLayerId);
      drawLineLayerRef.current = previewLayerId;

      const handler = (e: mapboxgl.MapMouseEvent) => {
        drawPointsRef.current.push({ lat: e.lngLat.lat, lng: e.lngLat.lng });
        const source = map.getSource(previewSourceId) as mapboxgl.GeoJSONSource;
        if (source) {
          source.setData({
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: drawPointsRef.current.map((p) => [p.lng, p.lat]),
            },
            properties: {},
          });
        }
      };

      const dblHandler = () => {
        finishDrawingRef.current();
      };

      mapClickListenerRef.current = map;
      clickListenerRef.current = handler;
      map.on('click', handler);
      map.on('dblclick', dblHandler);
    }
  }, [map, activePlanId, stopDrawingListeners]);

  const finishDrawing = useCallback(() => {
    if (!drawMode || !activePlanId) return;
    const points = drawPointsRef.current;
    if (points.length < 2) {
      cancelDrawingRef.current();
      return;
    }

    const path = points.map((p) => ({ lat: p.lat, lng: p.lng }));

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
  }, [drawMode, activePlanId, stopDrawingListeners]);

  const cancelDrawing = useCallback(() => {
    stopDrawingListeners();
    setDrawMode(null);
    setIsDrawing(false);
  }, [stopDrawingListeners]);

  const addItemToPlan = useCallback((item: PlanItem) => {
    setPlans((prev) => prev.map((p) =>
      p.id === activePlanId
        ? { ...p, items: [...p.items, item], updatedAt: new Date().toISOString() }
        : p
    ));
  }, [activePlanId]);

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

  useEffect(() => {
    removeAllOverlays();
    if (!map || !activePlan || !planVisible) return;

    for (const item of activePlan.items) {
      if (item.type === 'perimeter' && item.path && item.path.length >= 3) {
        const sourceId = `ev-plan-perim-${item.id}`;
        const layerId = `ev-plan-perim-layer-${item.id}`;
        const outlineLayerId = `ev-plan-perim-outline-${item.id}`;

        if (!map.getSource(sourceId)) {
          map.addSource(sourceId, {
            type: 'geojson',
            data: polygonCoordsToGeoJson(item.path),
          });
        }
        overlaySourceIds.current.add(sourceId);

        if (!map.getLayer(layerId)) {
          map.addLayer({
            id: layerId,
            type: 'fill',
            source: sourceId,
            paint: {
              'fill-color': item.color,
              'fill-opacity': 0.12,
            },
          });
        }
        overlayLayerIds.current.add(layerId);

        if (!map.getLayer(outlineLayerId)) {
          map.addLayer({
            id: outlineLayerId,
            type: 'line',
            source: sourceId,
            paint: {
              'line-color': item.color,
              'line-opacity': 0.8,
              'line-width': 2,
            },
          });
        }
        overlayLayerIds.current.add(outlineLayerId);

        map.on('click', layerId, (e) => {
          if (infoWindow && e.lngLat) {
            infoWindow.setLngLat(e.lngLat).setHTML(makeInfoHtml(item)).addTo(map);
          }
        });
        map.on('click', outlineLayerId, (e) => {
          if (infoWindow && e.lngLat) {
            infoWindow.setLngLat(e.lngLat).setHTML(makeInfoHtml(item)).addTo(map);
          }
        });
      }

      if (item.type === 'route' && item.path && item.path.length >= 2) {
        const sourceId = `ev-plan-route-${item.id}`;
        const layerId = `ev-plan-route-layer-${item.id}`;

        if (!map.getSource(sourceId)) {
          map.addSource(sourceId, {
            type: 'geojson',
            data: lineCoordsToGeoJson(item.path),
          });
        }
        overlaySourceIds.current.add(sourceId);

        if (!map.getLayer(layerId)) {
          map.addLayer({
            id: layerId,
            type: 'line',
            source: sourceId,
            paint: {
              'line-color': item.color,
              'line-opacity': 0.9,
              'line-width': 3,
            },
          });
        }
        overlayLayerIds.current.add(layerId);

        map.on('click', layerId, (e) => {
          if (infoWindow && e.lngLat) {
            infoWindow.setLngLat(e.lngLat).setHTML(makeInfoHtml(item)).addTo(map);
          }
        });
      }

      if ((item.type === 'staging' || item.type === 'annotation') && item.position) {
        const markerColor = item.color;
        let marker: mapboxgl.Marker;

        if (item.type === 'annotation') {
          const el = document.createElement('div');
          el.style.cssText = `color:#fff;font-size:10px;font-weight:bold;font-family:'Courier New',monospace;background:${markerColor};padding:2px 4px;border-radius:2px;border:1px solid #fff;white-space:nowrap;`;
          el.textContent = item.text || item.label;
          marker = new mapboxgl.Marker({ element: el })
            .setLngLat([item.position.lng, item.position.lat])
            .addTo(map);
        } else {
          const el = document.createElement('div');
          el.style.cssText = `width:16px;height:16px;background:${markerColor};border:2px solid #fff;border-radius:0;transform:rotate(45deg);cursor:pointer;`;
          marker = new mapboxgl.Marker({ element: el })
            .setLngLat([item.position.lng, item.position.lat])
            .addTo(map);
        }

        marker.getElement().addEventListener('click', () => {
          if (infoWindow && item.position) {
            infoWindow.setLngLat([item.position.lng, item.position.lat]).setHTML(makeInfoHtml(item)).addTo(map!);
          }
        });

        overlayMarkers.current.push(marker);
      }
    }
  }, [map, activePlan, planVisible, infoWindow, removeAllOverlays]);

  useEffect(() => {
    return () => {
      stopDrawingListeners();
      removeAllOverlays();
    };
  }, [stopDrawingListeners, removeAllOverlays]);

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
