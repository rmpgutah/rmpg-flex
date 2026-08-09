// ============================================================
// RMPG Flex — Serve Intake Map
// Plots all active serve queue items with business/individual
// differentiation and location notation badges. Constraint-
// aware markers show when a notation has shaped the schedule.
// ============================================================

import { useEffect, useRef, useState, useCallback } from 'react';
import { MapPin, Building2, User, AlertTriangle, RefreshCw, Plus, Printer, Radio } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { parseTimestamp } from '../../utils/dateUtils';
import { mapboxgl, MAPBOX_STYLE_DARK, registerMapInstance, unregisterMapInstance } from '../../utils/mapboxLoader';
import { applyRmpgBasemap } from '../../utils/mapboxBasemap';
import { useWebglMapRecovery } from '../../hooks/useWebglMapRecovery';
import LocationNoteModal from './LocationNoteModal';
import { escapeHtml } from '../../utils/sanitize';
import { withAlpha } from '../../utils/withAlpha';
import { clusterByGrid, type ClusterableItem, type ClusterPositionCache } from '../../utils/serveMapClustering';
import { urgencyTierForDeadline, isRiskFlagged, matchesDeadlineFilter, type DeadlineFilter } from '../../utils/serveMapOverlays';
import { fetchMapboxRoute } from '../../utils/mapboxRouting';
import { exportServeMapSheet } from '../../utils/serveMapExport';
import type { MapUnit as Unit } from '../../pages/map/utils/mapConstants';
import {
  buildUnitMarkerEl, applyUnitMarkerState, buildUnitPopupHtml, shouldAnimateMarkerMove,
} from '../../pages/map/utils/mapMarkers';

// Dispatch units poll — matches the Map module's UNITS_FAST_POLL_MS so a
// server standing at a job site and a unit converging on it read as
// similarly "live" whichever surface a dispatcher is watching.
const UNITS_POLL_MS = 5_000;

// One-time stylesheet injection for pulse-ring keyframes
if (typeof document !== 'undefined' && !document.getElementById('srv-pulse-styles')) {
  const style = document.createElement('style');
  style.id = 'srv-pulse-styles';
  style.textContent = `
    @keyframes srv-pulse-critical { 0% { opacity:1; transform:scale(0.9);} 100% { opacity:0; transform:scale(1.6);} }
    @keyframes srv-pulse-warning { 0% { opacity:0.7; transform:scale(0.9);} 100% { opacity:0; transform:scale(1.4);} }
  `;
  document.head.appendChild(style);
}

interface QueueMapItem {
  id: number;
  status: string;
  priority: string;
  recipient_name: string | null;
  recipient_address: string | null;
  recipient_city: string | null;
  recipient_state: string | null;
  document_type: string | null;
  case_number: string | null;
  deadline: string | null;
  attempt_count: number;
  recipient_type: string | null;
  recipient_lat: number | null;
  recipient_lng: number | null;
  location_note_id: number | null;
  location_note_text: string | null;
  next_attempt_date: string | null;
  next_attempt_window: string | null;
}

interface LocationNote {
  id: number;
  entity_type: string;
  entity_name: string | null;
  address_norm: string | null;
  note_text: string;
  note_type: string;
  days_available: number[] | null;
  hours_start: string | null;
  hours_end: string | null;
  cutoff_time: string | null;
  active: number;
}

const PRIORITY_COLORS: Record<string, string> = {
  urgent: '#ef4444',
  rush:   '#f97316',
  normal: '#3b82f6',
  routine:'#6b7280',
};
const PRIORITY_GLOW: Record<string, string> = {
  urgent: 'rgba(239,68,68,0.5)',
  rush:   'rgba(249,115,22,0.4)',
  normal: 'rgba(59,130,246,0.3)',
  routine:'rgba(107,114,128,0.2)',
};

function buildServeMarker(item: QueueMapItem, selected: boolean = false): HTMLElement {
  const isBusiness = (item.recipient_type || '').toLowerCase() === 'business';
  const color = PRIORITY_COLORS[item.priority] ?? PRIORITY_COLORS.routine;
  const glow  = PRIORITY_GLOW[item.priority]  ?? PRIORITY_GLOW.routine;
  const hasNote = !!item.location_note_id;
  const tier = urgencyTierForDeadline(item.deadline, Date.now());

  const el = document.createElement('div');
  // Build box-shadow upfront: base glow + optional risk halo
  // (allows safe composition of urgency ring, notation badge, and risk icon without overlap)
  const hasRisk = isRiskFlagged(item);
  const boxShadowValue = hasRisk
    ? `0 0 8px ${glow}, 0 0 0 3px rgba(239,68,68,0.6)`
    : `0 0 8px ${glow}`;
  // Selected markers get an extra outline ring so a bulk action's scope is
  // visually obvious before the user confirms it.
  const border = selected
    ? '3px solid #22c55e'
    : '2px solid rgba(255,255,255,0.7)';

  // ROOT: position-neutral only. This is the element handed to
  // `new mapboxgl.Marker({ element: el })`, and Mapbox GL REWRITES its
  // `style.transform` on every render frame. Two things must therefore never
  // live here: a `transition:transform` (each frame's reposition becomes an
  // animation the pin chases) and any literal `transform` of our own (it
  // overwrites Mapbox's `translate(...)`, teleporting the pin to the map's
  // origin until the next frame restores it). Both were present before; the
  // hover scale below now targets the inner wrapper instead.
  el.style.cssText = 'display:block;cursor:pointer;';
  el.title = item.recipient_name || 'serve target';

  // INNER: every visual style, and the only element we may transform.
  const inner = document.createElement('div');
  inner.setAttribute('data-role', 'marker-inner');
  inner.style.cssText = `
    position:relative;
    width:28px;height:28px;
    border-radius:50%;
    background:${color};
    border:${border};
    box-shadow:${boxShadowValue}${selected ? ', 0 0 0 2px rgba(34,197,94,0.5)' : ''};
    display:flex;align-items:center;justify-content:center;
    transition:transform 0.15s;
  `;
  el.appendChild(inner);

  // Icon — building for business, person pin for individual
  const icon = document.createElement('div');
  icon.style.cssText = 'color:#fff;font-size:12px;line-height:1;font-weight:700;';
  icon.textContent = isBusiness ? '🏢' : '👤';
  inner.appendChild(icon);

  // Notation badge — yellow dot in corner when a system constraint exists
  if (hasNote) {
    const badge = document.createElement('div');
    badge.style.cssText = `
      position:absolute;top:-3px;right:-3px;
      width:9px;height:9px;
      border-radius:50%;
      background:#d4a017;
      border:1px solid #000;
      box-shadow:0 0 4px rgba(212,160,23,0.8);
    `;
    badge.title = 'Recorded service notation — see popup';
    inner.appendChild(badge);
  }

  // Deadline urgency pulse ring
  if (tier === 'critical' || tier === 'warning') {
    const ring = document.createElement('div');
    const ringColor = tier === 'critical' ? '#ef4444' : '#f59e0b';
    ring.style.cssText = `
      position:absolute;inset:-6px;border-radius:50%;
      border:2px solid ${ringColor};
      animation:srv-pulse-${tier} 1.6s ease-out infinite;
    `;
    inner.appendChild(ring);
  }

  // Officer-safety risk halo
  // Note: box-shadow already includes risk halo (computed upfront to avoid unsafe += on style.boxShadow).
  // Risk icon positioned at bottom-right to avoid notation badge (top-right) and urgency ring (inset:-6px).
  if (hasRisk) {
    const warningIcon = document.createElement('div');
    warningIcon.style.cssText = 'position:absolute;bottom:-4px;right:-4px;font-size:10px;';
    warningIcon.textContent = '⚠';
    warningIcon.title = 'Officer safety flag';
    inner.appendChild(warningIcon);
  }

  // Hover scale targets the INNER wrapper. Writing it on `el` clobbered the
  // translate Mapbox owns, so hovering a pin visibly threw it to the corner
  // of the map until the next render frame snapped it back.
  el.addEventListener('mouseenter', () => { inner.style.transform = 'scale(1.2)'; });
  el.addEventListener('mouseleave', () => { inner.style.transform = 'scale(1)'; });

  return el;
}

function buildClusterMarker(cluster: { count: number; dominantPriority: string }): HTMLElement {
  const color = PRIORITY_COLORS[cluster.dominantPriority] ?? PRIORITY_COLORS.routine;
  const el = document.createElement('div');
  el.style.cssText = `
    width:34px;height:34px;border-radius:50%;
    background:${color};border:2px solid rgba(255,255,255,0.85);
    display:flex;align-items:center;justify-content:center;
    font-family:monospace;font-weight:700;font-size:12px;color:#fff;
    cursor:pointer;
  `;
  el.textContent = String(cluster.count);
  el.title = `${cluster.count} serve jobs`;
  return el;
}

interface Props {
  onSelectQueue?: (queueId: number) => void;
}

export default function ServeIntakeMap({ onSelectQueue }: Props) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const clusterPositionCacheRef = useRef<ClusterPositionCache>(new Map());
  const popupRef = useRef<mapboxgl.Popup | null>(null);
  const unitMarkersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());
  const webglRecoveryCleanupRef = useRef<(() => void) | null>(null);
  const { rebuildNonce, attach } = useWebglMapRecovery();

  const [items, setItems] = useState<QueueMapItem[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [showUnits, setShowUnits] = useState(false);
  const [notes, setNotes] = useState<LocationNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [geocoding, setGeocoding] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [currentZoom, setCurrentZoom] = useState(10);
  const [deadlineFilter, setDeadlineFilter] = useState<DeadlineFilter>('all');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const selectStartRef = useRef<{ x: number; y: number } | null>(null);
  const itemsRef = useRef<QueueMapItem[]>([]);
  useEffect(() => { itemsRef.current = items; }, [items]);
  const [noteModal, setNoteModal] = useState<{ open: boolean; noteId?: number; queueItem?: QueueMapItem }>({ open: false });
  const [trailQueueId, setTrailQueueId] = useState<number | null>(null);
  // Single-stop drive-time preview: right-click anywhere on the map to set a
  // simulated "current position" (no live officer position feed exists yet),
  // then pick a job via its popup to draw a driving route + ETA between them.
  const [previewOrigin, setPreviewOrigin] = useState<[number, number] | null>(null);
  const [previewTarget, setPreviewTarget] = useState<{ id: number; lng: number; lat: number } | null>(null);
  const [previewRoute, setPreviewRoute] = useState<{ eta: string; distance: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [queueRes, notesRes] = await Promise.all([
        apiFetch<QueueMapItem[]>('/serve-intake/map-items'),
        apiFetch<LocationNote[]>('/serve-intake/location-notes'),
      ]);
      setItems(queueRes);
      setNotes(notesRes);
    } catch {
      // non-fatal — map stays empty
    } finally {
      setLoading(false);
    }
  }, []);

  // Dispatch units overlay — opt-in via the "Show Units" toggle rather than
  // fetched unconditionally, so a server viewing their own job board isn't
  // paying a poll + marker-render cost they didn't ask for.
  useEffect(() => {
    if (!showUnits) return;
    let cancelled = false;
    const refreshUnits = async () => {
      try {
        const u = await apiFetch<Unit[]>('/dispatch/units');
        if (!cancelled) setUnits(u);
      } catch {
        // non-fatal — units overlay just stays stale/empty
      }
    };
    refreshUnits();
    const t = setInterval(refreshUnits, UNITS_POLL_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, [showUnits]);

  useEffect(() => { load(); }, [load]);

  // Init map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;
    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: MAPBOX_STYLE_DARK,
      center: [-111.891, 40.76],  // Salt Lake City
      zoom: 10,
      attributionControl: false,
      // Rectangle-select below also binds shift+drag — Mapbox's built-in
      // box-zoom (also shift+drag by default) would otherwise fight it.
      boxZoom: false,
    });
    mapRef.current = map;
    registerMapInstance(map, MAPBOX_STYLE_DARK);
    webglRecoveryCleanupRef.current = attach(map, 'ServeIntakeMap');
    map.on('load', () => {
      applyRmpgBasemap(map, { variant: 'dark' });
      setMapReady(true);
    });
    map.on('zoomend', () => setCurrentZoom(map.getZoom()));
    // Right-click sets the drive-time preview origin (simulating "my current
    // position" — there is no live officer position feed). Right-click rather
    // than left-click so it never conflicts with marker/cluster click handlers.
    map.on('contextmenu', (e: mapboxgl.MapMouseEvent) => {
      e.originalEvent?.preventDefault?.();
      setPreviewOrigin([e.lngLat.lng, e.lngLat.lat]);
    });

    // Shift-drag rectangle select: bulk-select job markers by drawing a box
    // in screen space, then converting the corners to lng/lat via unproject.
    const container = mapContainerRef.current;
    const onMouseDown = (e: MouseEvent) => {
      if (!e.shiftKey || !container) return;
      const rect = container.getBoundingClientRect();
      selectStartRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    const MIN_DRAG_PX = 5;
    const onMouseUp = (e: MouseEvent) => {
      if (!selectStartRef.current || !container) return;
      const start = selectStartRef.current;
      // Clear the origin unconditionally on mouseup — a stray shift-click or a
      // drag that started but never crossed the threshold shouldn't leave a
      // stale origin around for a later, unrelated mouseup to pick up.
      selectStartRef.current = null;
      if (!e.shiftKey) return;
      const rect = container.getBoundingClientRect();
      const end = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const dragDistance = Math.hypot(end.x - start.x, end.y - start.y);
      // A shift-click (start≈end) computes a degenerate box that would
      // silently clear any existing selection — require a real drag first.
      if (dragDistance < MIN_DRAG_PX) return;
      const sw = map.unproject([Math.min(start.x, end.x), Math.max(start.y, end.y)]);
      const ne = map.unproject([Math.max(start.x, end.x), Math.min(start.y, end.y)]);
      const newlySelected = new Set<number>();
      for (const it of itemsRef.current) {
        if (it.recipient_lat == null || it.recipient_lng == null) continue;
        if (it.recipient_lng >= sw.lng && it.recipient_lng <= ne.lng &&
            it.recipient_lat >= sw.lat && it.recipient_lat <= ne.lat) {
          newlySelected.add(it.id);
        }
      }
      setSelectedIds(newlySelected);
    };
    // If the pointer leaves the container before release, reset the drag
    // origin — otherwise a later, unrelated mouseup (e.g. after re-entering
    // the container) would compute a bogus box from a stale start point.
    const onMouseLeave = () => { selectStartRef.current = null; };
    container?.addEventListener('mousedown', onMouseDown);
    container?.addEventListener('mouseup', onMouseUp);
    container?.addEventListener('mouseleave', onMouseLeave);

    return () => {
      container?.removeEventListener('mousedown', onMouseDown);
      container?.removeEventListener('mouseup', onMouseUp);
      container?.removeEventListener('mouseleave', onMouseLeave);
      webglRecoveryCleanupRef.current?.();
      webglRecoveryCleanupRef.current = null;
      unregisterMapInstance(map);
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rebuildNonce]);

  // Fit bounds to the item set when the map first becomes ready or the
  // underlying items change — deliberately NOT dependent on currentZoom, so
  // zooming in on a cluster (via easeTo + zoomend) doesn't immediately snap
  // the view back out to fit everything again.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const mappable = items
      .filter((it) => it.recipient_lat != null && it.recipient_lng != null)
      .filter((it) => matchesDeadlineFilter(it.deadline, deadlineFilter, Date.now()));
    if (mappable.length > 0) {
      const bounds = new mapboxgl.LngLatBounds();
      for (const it of mappable) bounds.extend([it.recipient_lng!, it.recipient_lat!]);
      map.fitBounds(bounds, { padding: 60, maxZoom: 14 });
    }
  }, [mapReady, items, deadlineFilter]);

  // Plot markers when map + items are ready
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    // Clear old markers
    for (const m of markersRef.current) m.remove();
    markersRef.current = [];
    popupRef.current?.remove();

    const mappable = items
      .filter((it) => it.recipient_lat != null && it.recipient_lng != null)
      .filter((it) => matchesDeadlineFilter(it.deadline, deadlineFilter, Date.now()));

    const clusterInput: ClusterableItem[] = mappable.map((it) => ({
      id: it.id,
      lng: it.recipient_lng!,
      lat: it.recipient_lat!,
      priority: it.priority,
      status: it.status,
    }));
    const clusters = clusterByGrid(clusterInput, currentZoom, clusterPositionCacheRef.current);

    for (const cluster of clusters) {
      if (cluster.count === 1) {
        const item = mappable.find((it) => it.id === cluster.itemIds[0])!;
        const el = buildServeMarker(item, selectedIds.has(item.id));
        const popup = new mapboxgl.Popup({ offset: 18, closeButton: true, maxWidth: '280px' })
          .setHTML(buildPopupHtml(item));

        // Delegated popup handler, matching the pattern in MapboxMapPage.
        // Previously each button was wired by id inside a setTimeout(…, 50),
        // which raced Mapbox inserting the popup DOM: lose the race and
        // getElementById returned null, leaving every button silently dead
        // until the popup was reopened. Delegating to the popup container has
        // no race — the container exists before any click can reach it.
        //
        // Declared once per item so its identity is stable: addEventListener
        // ignores a duplicate (type, listener) pair, so re-opening the popup
        // cannot stack handlers and double-fire the action.
        const onPopupClick = (evt: MouseEvent) => {
          const action = (evt.target as HTMLElement).closest<HTMLElement>('[data-action]')
            ?.dataset.action;
          if (!action) return;
          if (action === 'open') onSelectQueue?.(item.id);
          else if (action === 'note') setNoteModal({ open: true, queueItem: item });
          else if (action === 'trail') setTrailQueueId(item.id);
          else if (action === 'preview') {
            setPreviewTarget({ id: item.id, lng: item.recipient_lng!, lat: item.recipient_lat! });
          }
        };

        el.addEventListener('click', () => {
          popupRef.current?.remove();
          popup.addTo(map);
          popupRef.current = popup;
          popup.getElement()?.addEventListener('click', onPopupClick);
        });

        // Pinned to the stored coordinate: `draggable` is deliberately OFF so a
        // serve target can never be nudged off its geocoded position by a
        // stray click-drag on the map. Relocating a job is an explicit records
        // edit, not a map gesture.
        const marker = new mapboxgl.Marker({ element: el, anchor: 'center', draggable: false })
          .setLngLat([item.recipient_lng!, item.recipient_lat!])
          .addTo(map);
        markersRef.current.push(marker);
      } else {
        const el = buildClusterMarker(cluster);
        el.addEventListener('click', () => {
          map.easeTo({ center: [cluster.lng, cluster.lat], zoom: currentZoom + 2 });
        });
        const marker = new mapboxgl.Marker({ element: el })
          .setLngLat([cluster.lng, cluster.lat])
          .addTo(map);
        markersRef.current.push(marker);
      }
    }
  }, [mapReady, items, onSelectQueue, currentZoom, deadlineFilter, selectedIds]);

  // Dispatch unit markers — reuses the same buildUnitMarkerEl/applyUnitMarkerState
  // pair the main Map module uses (mapMarkers.ts), so a unit reads identically
  // (status color, GPS-staleness dashing, heading rotation) on either surface.
  // Kept in its own effect from the queue-marker one above: units update on a
  // faster poll and must never trigger a full serve-job re-cluster.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    if (!showUnits) {
      for (const m of unitMarkersRef.current.values()) m.remove();
      unitMarkersRef.current.clear();
      return;
    }

    const currentIds = new Set<string>();
    for (const unit of units) {
      if (unit.latitude == null || unit.longitude == null) continue;
      currentIds.add(unit.id);

      const existing = unitMarkersRef.current.get(unit.id);
      if (existing) {
        const prevLngLat = existing.getLngLat();
        const el = existing.getElement();
        const innerEl = el.querySelector<HTMLElement>('[data-role="marker-inner"]') || el;
        const animate = shouldAnimateMarkerMove(prevLngLat.lat, prevLngLat.lng, unit.latitude, unit.longitude);
        if (!animate) innerEl.style.transitionDuration = '0ms';
        existing.setLngLat([unit.longitude, unit.latitude]);
        if (!animate) requestAnimationFrame(() => { innerEl.style.transitionDuration = ''; });
        applyUnitMarkerState(el, unit);
        const popup = existing.getPopup();
        if (popup) popup.setHTML(buildUnitPopupHtml(unit));
      } else {
        const el = buildUnitMarkerEl(unit);
        const popup = new mapboxgl.Popup({ offset: 16, closeButton: false, className: 'mapbox-popup-dark' })
          .setHTML(buildUnitPopupHtml(unit));
        const marker = new mapboxgl.Marker({ element: el })
          .setLngLat([unit.longitude, unit.latitude])
          .setPopup(popup)
          .addTo(map);
        unitMarkersRef.current.set(unit.id, marker);
      }
    }

    unitMarkersRef.current.forEach((marker, id) => {
      if (!currentIds.has(id)) {
        marker.remove();
        unitMarkersRef.current.delete(id);
      }
    });
  }, [units, showUnits, mapReady]);

  // Draw/clear the attempt-history trail overlay for a selected serve item.
  // GeoJSON line source/layer (not a marker) — kept separate from the
  // marker-plotting effect above so selecting a trail doesn't re-cluster markers.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const sourceId = 'srv-attempt-trail';
    const layerId = 'srv-attempt-trail-layer';

    // Defensive by design: this closure's `map` is captured at effect-run
    // time, but React runs passive-effect cleanups on unmount in the SAME
    // top-to-bottom declaration order as the effects themselves (not
    // reversed). The map-init effect is declared earlier in this component,
    // so on a full unmount its cleanup (map.remove(); mapRef.current = null)
    // can run before this effect's cleanup fires. Always read mapRef.current
    // fresh rather than trusting the closed-over `map`, no-op if it's already
    // null, and wrap the Mapbox calls in try/catch as a last-resort net since
    // a torn-down style can throw from getLayer/getSource/removeLayer.
    const clearTrail = () => {
      const currentMap = mapRef.current;
      if (!currentMap) return;
      try {
        if (currentMap.getLayer(layerId)) currentMap.removeLayer(layerId);
        if (currentMap.getSource(sourceId)) currentMap.removeSource(sourceId);
      } catch {
        // non-fatal — map/style already torn down (e.g. mid-unmount)
      }
    };

    if (trailQueueId == null) {
      clearTrail();
      return;
    }

    let cancelled = false;
    apiFetch<{ trail: Array<{ attempt_at: string; latitude: number; longitude: number; result: string }>; polyline: [number, number][] }>(
      `/process-server/${trailQueueId}/gps-trail`,
    ).then((res) => {
      if (cancelled || res.polyline.length < 2) return;
      const currentMap = mapRef.current;
      if (!currentMap) return;
      clearTrail();
      try {
        currentMap.addSource(sourceId, {
          type: 'geojson',
          data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: res.polyline } },
        });
        currentMap.addLayer({
          id: layerId,
          type: 'line',
          source: sourceId,
          paint: { 'line-color': '#94a3b8', 'line-width': 2, 'line-dasharray': [2, 2], 'line-opacity': 0.8 },
        });
      } catch {
        // non-fatal — map/style torn down before the fetch resolved
      }
    }).catch(() => { /* non-fatal — trail stays hidden */ });

    return () => { cancelled = true; clearTrail(); };
  }, [trailQueueId, mapReady]);

  // Draw/clear the single-stop drive-time preview route whenever both a
  // preview origin (right-click on the map) and a target job (popup button)
  // are set. Mirrors the attempt-trail effect above: read mapRef.current
  // fresh inside the cleanup (not the closed-over `map`) and wrap every
  // Mapbox call in try/catch, since the map-init effect's cleanup can null
  // mapRef.current / tear down the style before this effect's own cleanup runs.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const sourceId = 'srv-drive-preview';
    const layerId = 'srv-drive-preview-layer';

    const clearPreview = () => {
      const currentMap = mapRef.current;
      if (!currentMap) return;
      try {
        if (currentMap.getLayer(layerId)) currentMap.removeLayer(layerId);
        if (currentMap.getSource(sourceId)) currentMap.removeSource(sourceId);
      } catch {
        // non-fatal — map/style already torn down (e.g. mid-unmount)
      }
      setPreviewRoute(null);
    };

    if (!previewOrigin || !previewTarget) {
      clearPreview();
      return;
    }

    let cancelled = false;
    fetchMapboxRoute(
      { lng: previewOrigin[0], lat: previewOrigin[1] },
      { lng: previewTarget.lng, lat: previewTarget.lat },
    ).then((route) => {
      if (cancelled || !route) return;
      const currentMap = mapRef.current;
      if (!currentMap) return;
      clearPreview();
      try {
        currentMap.addSource(sourceId, {
          type: 'geojson',
          data: {
            type: 'Feature',
            properties: {},
            geometry: { type: 'LineString', coordinates: route.geometry.map((p) => [p.lng, p.lat]) },
          },
        });
        currentMap.addLayer({
          id: layerId,
          type: 'line',
          source: sourceId,
          paint: { 'line-color': '#22c55e', 'line-width': 3, 'line-opacity': 0.85 },
        });
        setPreviewRoute({ eta: route.eta, distance: route.distance });
      } catch {
        // non-fatal — map/style torn down before the fetch resolved
      }
    }).catch(() => { /* non-fatal — falls back to no preview */ });

    return () => { cancelled = true; clearPreview(); };
  }, [previewOrigin, previewTarget, mapReady]);

  const notMapped = items.filter((it) => it.recipient_lat == null || it.recipient_lng == null);

  const handleExport = () => {
    const filtered = items
      .filter((it) => it.recipient_lat != null && it.recipient_lng != null)
      .filter((it) => matchesDeadlineFilter(it.deadline, deadlineFilter, Date.now()));
    exportServeMapSheet(filtered.map((it) => ({
      id: it.id,
      recipient_name: it.recipient_name,
      recipient_address: it.recipient_address,
      priority: it.priority,
      deadline: it.deadline,
    }))).catch(() => { window.alert('Failed to export route sheet.'); });
  };

  const applyBulkStatus = async (status: string) => {
    if (selectedIds.size === 0) return;
    const confirmed = window.confirm(`Set ${selectedIds.size} job(s) to "${status}"?`);
    if (!confirmed) return;
    try {
      await apiFetch('/process-server/bulk-status', {
        method: 'PUT',
        body: JSON.stringify({ ids: Array.from(selectedIds), status }),
      });
      setSelectedIds(new Set());
      load();
    } catch {
      // Selection is preserved so the user can retry, but they need to know
      // it failed — an empty catch here previously left them with no feedback
      // and a UI that looked like nothing happened.
      window.alert(`Failed to update ${selectedIds.size} job(s). Please try again.`);
    }
  };

  return (
    <div className="flex flex-col h-full gap-2">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-3 text-[11px] text-brand-400">
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-full bg-red-500" /> Urgent
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-full bg-orange-500" /> Rush
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-full bg-blue-500" /> Normal
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-full bg-gray-500" /> Routine
          </span>
          <span className="flex items-center gap-1 ml-2">
            <span className="inline-block w-3 h-3 rounded-full bg-[#d4a017]" /> Has notation
          </span>
        </div>
        <div className="flex items-center gap-2">
          {previewRoute && (
            <span className="text-[11px] text-green-400 px-2 py-1 bg-surface-raised border border-border-subtle rounded">
              ETA {previewRoute.eta} · {previewRoute.distance} (right-click map to move origin)
            </span>
          )}
          <div className="flex items-center gap-1">
            {(['all', 'today', 'three_days', 'week', 'overdue'] as DeadlineFilter[]).map((f) => (
              <button
                key={f}
                onClick={() => setDeadlineFilter(f)}
                className={`px-2 py-1 text-[10px] border border-border-subtle rounded ${deadlineFilter === f ? 'bg-brand-700 text-white' : 'bg-surface-raised text-brand-400'}`}
              >
                {f === 'three_days' ? '3 Days' : f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
          <button
            onClick={() => setShowUnits((v) => !v)}
            aria-pressed={showUnits}
            className={`flex items-center gap-1 px-2 py-1 text-[11px] border rounded ${showUnits ? 'bg-brand-700 border-brand-700 text-white' : 'bg-surface-raised border-border-subtle text-brand-300 hover:text-brand-100'}`}
          >
            <Radio size={11} /> Show Units
          </button>
          <button
            onClick={() => setNoteModal({ open: true })}
            className="flex items-center gap-1 px-2 py-1 text-[11px] bg-surface-raised border border-border-subtle rounded text-brand-300 hover:text-brand-100"
          >
            <Plus size={11} /> Add Notation
          </button>
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1 px-2 py-1 text-[11px] bg-surface-raised border border-border-subtle rounded text-brand-300 hover:text-brand-100 disabled:opacity-50"
          >
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
          <button
            onClick={handleExport}
            className="flex items-center gap-1 px-2 py-1 text-[11px] bg-surface-raised border border-border-subtle rounded text-brand-300 hover:text-brand-100"
          >
            <Printer size={11} /> Export Sheet
          </button>
        </div>
      </div>

      {selectedIds.size > 0 && (
        <div className="flex items-center gap-2 px-2 py-1 bg-surface-raised border border-border-subtle rounded text-[11px]">
          <span className="text-brand-300">{selectedIds.size} selected (shift-drag to reselect)</span>
          <span className="text-brand-500">Apply to selected:</span>
          <button onClick={() => applyBulkStatus('archived')} className="px-2 py-0.5 border border-border-subtle rounded text-brand-300 hover:text-brand-100">Archive</button>
          <button onClick={() => setSelectedIds(new Set())} className="px-2 py-0.5 border border-border-subtle rounded text-brand-500 hover:text-brand-300 ml-auto">Clear</button>
        </div>
      )}

      {/* Map canvas */}
      <div className="relative flex-1 min-h-0 rounded overflow-hidden border border-border-subtle">
        <div ref={mapContainerRef} className="absolute inset-0" />
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-surface-base/70 z-10">
            <span className="text-[11px] text-brand-400">Loading serve queue…</span>
          </div>
        )}
        {!loading && items.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center z-10">
            <span className="text-[11px] text-brand-500">No active serve orders</span>
          </div>
        )}
      </div>

      {/* Unmapped items */}
      {notMapped.length > 0 && (
        <div className="rounded border border-border-subtle bg-surface-raised p-2">
          <div className="flex items-center gap-1 mb-1 text-[10px] text-brand-400 font-semibold uppercase tracking-wide">
            <MapPin size={10} />
            {notMapped.length} address{notMapped.length !== 1 ? 'es' : ''} not geocoded
          </div>
          <div className="flex flex-col gap-[2px] max-h-24 overflow-y-auto">
            {notMapped.map((it) => (
              <div key={it.id} className="flex items-center gap-2 text-[10px] text-brand-400">
                {(it.recipient_type || '').toLowerCase() === 'business'
                  ? <Building2 size={9} className="shrink-0 text-blue-400" />
                  : <User size={9} className="shrink-0 text-brand-400" />
                }
                <span className="truncate">
                  {it.recipient_name || '(no name)'} — {it.recipient_address || '(no address)'}
                </span>
                <span className={`ml-auto text-[9px] font-semibold uppercase px-1 rounded shrink-0 ${
                  it.priority === 'urgent' ? 'bg-red-900 text-red-300' :
                  it.priority === 'rush'   ? 'bg-orange-900 text-orange-300' :
                  it.priority === 'normal' ? 'bg-blue-900 text-blue-300' :
                  'bg-surface-muted text-brand-500'
                }`}>
                  {(it.priority || '').toUpperCase()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Location notes panel */}
      <div className="rounded border border-border-subtle bg-surface-raised p-2">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] text-brand-400 font-semibold uppercase tracking-wide">
            System Notations ({notes.filter((n) => n.active).length})
          </span>
        </div>
        {notes.length === 0 ? (
          <p className="text-[10px] text-brand-500">No recorded notations. Add one to constrain scheduling for a specific business, person, or address.</p>
        ) : (
          <div className="flex flex-col gap-[2px] max-h-28 overflow-y-auto">
            {notes.filter((n) => n.active).map((note) => (
              <div key={note.id} className="flex items-start gap-2 text-[10px] text-brand-300 py-[2px] border-b border-border-subtle/40 last:border-0">
                {note.entity_type === 'business'
                  ? <Building2 size={9} className="shrink-0 mt-[1px] text-blue-400" />
                  : note.entity_type === 'person'
                  ? <User size={9} className="shrink-0 mt-[1px] text-brand-400" />
                  : <MapPin size={9} className="shrink-0 mt-[1px] text-brand-500" />
                }
                <div className="flex-1 min-w-0">
                  <span className="font-semibold text-brand-200">{note.entity_name || note.address_norm || '(address)'}</span>
                  <span className="text-brand-500 mx-1">—</span>
                  <span className="text-brand-400">{note.note_text}</span>
                </div>
                <button
                  onClick={() => setNoteModal({ open: true, noteId: note.id })}
                  className="shrink-0 text-[9px] text-brand-500 hover:text-brand-300 px-1 py-0.5 border border-border-subtle rounded"
                >
                  Edit
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create/edit notation modal */}
      {noteModal.open && (
        <LocationNoteModal
          noteId={noteModal.noteId}
          prefill={noteModal.queueItem ? {
            entity_type: (noteModal.queueItem.recipient_type || 'address').toLowerCase() as 'business' | 'person' | 'address',
            entity_name: noteModal.queueItem.recipient_name || undefined,
            address: noteModal.queueItem.recipient_address || undefined,
          } : undefined}
          onClose={() => setNoteModal({ open: false })}
          onSaved={() => { setNoteModal({ open: false }); load(); }}
        />
      )}
    </div>
  );
}

function buildPopupHtml(item: QueueMapItem): string {
  const isBusiness = (item.recipient_type || '').toLowerCase() === 'business';
  const priorityColor = { urgent: '#ef4444', rush: '#f97316', normal: '#3b82f6', routine: '#6b7280' }[item.priority] ?? '#6b7280';
  // escapeHtml on every interpolation below: this string goes to Mapbox
  // Popup.setHTML(), a raw innerHTML sink. recipient_name/address/case_number/
  // document_type are populated by OCR of an uploaded intake document
  // (src/routes/serveIntake.ts), so a process-service client controls them
  // without needing an account — stored XSS firing in a dispatcher's session.
  const priorityLabel = escapeHtml((item.priority || 'routine').toUpperCase());

  const daysLeft = item.deadline
    ? Math.ceil((parseTimestamp(item.deadline).getTime() - Date.now()) / 86400000)
    : null;
  const deadlineStr = item.deadline
    ? `${item.deadline}${daysLeft != null ? ` (${daysLeft > 0 ? daysLeft + 'd left' : daysLeft === 0 ? 'DUE TODAY' : 'PAST DUE'})` : ''}`
    : '—';

  const noteBlock = item.location_note_id
    ? `<div style="margin-top:6px;padding:4px 6px;background:rgba(212,160,23,0.12);border:1px solid rgba(212,160,23,0.4);border-radius:2px;font-size:10px;color:#d4a017;">
        ⚠ RECORDED NOTATION: ${escapeHtml(item.location_note_text) || 'See system record'}
       </div>`
    : '';

  const nextStr = item.next_attempt_date
    ? `${item.next_attempt_date}  ${item.next_attempt_window || ''}`
    : '—';

  return `
    <div style="font-family:monospace;font-size:11px;color:#c9d6e3;min-width:200px;">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
        <span style="font-size:14px;">${isBusiness ? '🏢' : '👤'}</span>
        <div>
          <div style="font-weight:700;color:#e2e8f0;font-size:12px;">${escapeHtml(item.recipient_name) || '(no name)'}</div>
          <div style="color:#94a3b8;font-size:10px;">${isBusiness ? 'Business Service' : 'Individual Service'}</div>
        </div>
        <span style="margin-left:auto;padding:1px 5px;background:${withAlpha(priorityColor, '22')};border:1px solid ${priorityColor};border-radius:2px;color:${priorityColor};font-size:9px;font-weight:700;">${priorityLabel}</span>
      </div>
      <div style="color:#94a3b8;font-size:10px;margin-bottom:2px;">${escapeHtml(item.recipient_address)}${item.recipient_city ? ', ' + escapeHtml(item.recipient_city) : ''}${item.recipient_state ? ' ' + escapeHtml(item.recipient_state) : ''}</div>
      <div style="color:#64748b;font-size:10px;">Case: ${escapeHtml(item.case_number) || '—'} · Doc: ${escapeHtml(item.document_type) || '—'}</div>
      <div style="color:#64748b;font-size:10px;">Deadline: ${escapeHtml(deadlineStr)}</div>
      <div style="color:#64748b;font-size:10px;">Attempts: ${escapeHtml(item.attempt_count)}</div>
      <div style="color:#64748b;font-size:10px;">Next window: ${escapeHtml(nextStr)}</div>
      ${noteBlock}
      <div style="margin-top:8px;display:flex;gap:6px;">
        <button data-action="open" data-item-id="${item.id}" style="flex:1;padding:3px 6px;background:rgba(59,130,246,0.2);border:1px solid rgba(59,130,246,0.5);border-radius:2px;color:#93c5fd;font-size:10px;cursor:pointer;font-family:monospace;">
          Open Record
        </button>
        <button data-action="note" data-item-id="${item.id}" style="flex:1;padding:3px 6px;background:rgba(212,160,23,0.15);border:1px solid rgba(212,160,23,0.4);border-radius:2px;color:#d4a017;font-size:10px;cursor:pointer;font-family:monospace;">
          ${item.location_note_id ? 'View Notation' : 'Add Notation'}
        </button>
        <button data-action="trail" data-item-id="${item.id}" style="flex:1;padding:3px 6px;background:rgba(148,163,184,0.15);border:1px solid rgba(148,163,184,0.4);border-radius:2px;color:#cbd5e1;font-size:10px;cursor:pointer;font-family:monospace;">
          History
        </button>
        <button data-action="preview" data-item-id="${item.id}" style="flex:1;padding:3px 6px;background:rgba(34,197,94,0.15);border:1px solid rgba(34,197,94,0.4);border-radius:2px;color:#86efac;font-size:10px;cursor:pointer;font-family:monospace;">
          Preview drive time
        </button>
      </div>
    </div>
  `;
}
