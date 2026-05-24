import { useState, useEffect, useRef, useCallback } from 'react';
import {
  X, Route, MapPin, ChevronUp, ChevronDown, CheckSquare, Square,
  Loader2, Navigation, Clock, DollarSign, Gauge, User,
} from 'lucide-react';
import { initMapbox, mapboxgl, MAPBOX_STYLE_DARK } from '../../utils/mapboxLoader';
import { getMapboxAccessToken } from '../../utils/mapboxApiKey';
import { apiFetch } from '../../hooks/useApi';
import type { ServeJob } from '../../types';

// ─── Types ──────────────────────────────────────────────────────────────

interface OfficerOption {
  id: number;
  name: string;
}

interface ServeRoutePlannerProps {
  isOpen: boolean;
  onClose: () => void;
  jobs: ServeJob[];
  officers?: OfficerOption[];
  currentUserId?: number;
  onRouteOptimized: (orderedJobIds: number[], routeData: {
    totalDistance: number;
    totalDuration: number;
    fuelCost: number;
  }) => void;
}

interface StopItem {
  job: ServeJob;
  selected: boolean;
  order: number;
}

const IRS_MILEAGE_RATE = 0.67;

// ─── Marker Colors ──────────────────────────────────────────────────────

function markerColor(status: ServeJob['status']): string {
  switch (status) {
    case 'served': return '#22c55e';
    case 'in_progress': return '#eab308';
    case 'failed': return '#ef4444';
    default: return '#888888';
  }
}

// ─── Time Window Sorting ────────────────────────────────────────────────

function timeWindowPriority(tw: ServeJob['time_window']): number {
  const hour = new Date().getHours();
  const order: Record<string, ServeJob['time_window'][]> =
    hour < 12
      ? { primary: ['morning', 'anytime', 'afternoon', 'evening'] }
      : hour < 17
        ? { primary: ['afternoon', 'anytime', 'evening', 'morning'] }
        : { primary: ['evening', 'anytime', 'morning', 'afternoon'] };
  return order.primary.indexOf(tw);
}

function priorityWeight(p: ServeJob['priority']): number {
  switch (p) { case 'rush': return 0; case 'high': return 1; case 'normal': return 2; case 'low': return 3; }
}

// ─── Geographic Clustering for >25 Stops ────────────────────────────────

function clusterStops(stops: StopItem[]): StopItem[][] {
  if (stops.length <= 25) return [stops];
  if (stops.length === 0) return [];
  const lats = stops.map(s => s.job.recipient_lat!);
  const lngs = stops.map(s => s.job.recipient_lng!);
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const midLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;
  const quadrants: StopItem[][] = [[], [], [], []];
  for (const stop of stops) {
    const qi = (stop.job.recipient_lat! >= midLat ? 0 : 2) + (stop.job.recipient_lng! >= midLng ? 0 : 1);
    quadrants[qi].push(stop);
  }
  const result: StopItem[][] = [];
  for (const q of quadrants) {
    if (q.length === 0) continue;
    if (q.length <= 25) result.push(q);
    else result.push(...clusterStops(q));
  }
  return result;
}

function chainClusters(clusters: StopItem[][]): StopItem[][] {
  if (clusters.length <= 1) return clusters;
  const clusterCenters = clusters.map(c => {
    const avgLat = c.reduce((s, st) => s + st.job.recipient_lat!, 0) / c.length;
    const avgLng = c.reduce((s, st) => s + st.job.recipient_lng!, 0) / c.length;
    return { lat: avgLat, lng: avgLng };
  });
  const ordered: number[] = [0];
  const used = new Set([0]);
  while (ordered.length < clusters.length) {
    const last = clusterCenters[ordered[ordered.length - 1]];
    let bestDist = Infinity, bestIdx = -1;
    for (let i = 0; i < clusters.length; i++) {
      if (used.has(i)) continue;
      const d = Math.hypot(clusterCenters[i].lat - last.lat, clusterCenters[i].lng - last.lng);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    ordered.push(bestIdx);
    used.add(bestIdx);
  }
  return ordered.map(i => clusters[i]);
}

// ─── Mapbox Directions API Helper ───────────────────────────────────────

async function fetchDirections(coordSets: [number, number][][]): Promise<{ legs: any[]; geometry: any } | null> {
  const token = await getMapboxAccessToken();
  if (!token) return null;
  const allResults: any[] = [];
  for (const coords of coordSets) {
    if (coords.length < 2) continue;
    const coordStr = coords.map(c => c.join(',')).join(';');
    const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${coordStr}?access_token=${token}&geometries=geojson&steps=false&overview=full`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Directions HTTP ${res.status}`);
    const data = await res.json();
    const route = data.routes?.[0];
    if (!route) continue;
    allResults.push(route);
  }
  if (allResults.length === 0) return null;
  const legs = allResults.flatMap(r => r.legs || []);
  const geometry = allResults.length === 1 ? allResults[0].geometry : null;
  return { legs, geometry };
}

// ─── Badge Components ───────────────────────────────────────────────────

function TimeWindowBadge({ tw }: { tw: ServeJob['time_window'] }) {
  const colors: Record<string, string> = {
    morning: 'bg-amber-900/40 text-amber-400 border-amber-700/50',
    afternoon: 'bg-gray-900/40 text-gray-400 border-gray-700/50',
    evening: 'bg-purple-900/40 text-purple-400 border-purple-700/50',
    anytime: 'bg-rmpg-800/40 text-rmpg-400 border-rmpg-700/50',
  };
  return <span className={`text-[10px] px-1.5 py-0.5 rounded-[2px] border font-mono ${colors[tw] || colors.anytime}`}>{tw}</span>;
}

function PriorityBadge({ p }: { p: ServeJob['priority'] }) {
  const colors: Record<string, string> = {
    rush: 'bg-red-900/40 text-red-400 border-red-700/50',
    high: 'bg-orange-900/40 text-orange-400 border-orange-700/50',
    normal: 'bg-rmpg-800/40 text-rmpg-400 border-rmpg-700/50',
    low: 'bg-rmpg-800/30 text-rmpg-500 border-rmpg-700/30',
  };
  return <span className={`text-[10px] px-1.5 py-0.5 rounded-[2px] border font-mono uppercase ${colors[p] || colors.normal}`}>{p}</span>;
}

// ─── Component ──────────────────────────────────────────────────────────

export default function ServeRoutePlanner({
  isOpen, onClose, jobs, officers, currentUserId, onRouteOptimized,
}: ServeRoutePlannerProps) {
  const geocodedJobs = jobs.filter(j => j.recipient_lat != null && j.recipient_lng != null);

  const [stops, setStops] = useState<StopItem[]>([]);
  const [optimizing, setOptimizing] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [totalDistance, setTotalDistance] = useState(0);
  const [totalDuration, setTotalDuration] = useState(0);
  const [currentLocation, setCurrentLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedOfficerId, setSelectedOfficerId] = useState<number>(currentUserId || 0);
  const [routeDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const [savedRouteLoaded, setSavedRouteLoaded] = useState(false);

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const currentLocMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const routeSourceIdRef = useRef<string | null>(null);

  // Initialize stops from jobs
  useEffect(() => {
    if (!isOpen) return;
    const items: StopItem[] = geocodedJobs.map((job, i) => ({
      job, selected: job.status !== 'served' && job.status !== 'failed', order: i,
    }));
    items.sort((a, b) => {
      const twDiff = timeWindowPriority(a.job.time_window) - timeWindowPriority(b.job.time_window);
      if (twDiff !== 0) return twDiff;
      return priorityWeight(a.job.priority) - priorityWeight(b.job.priority);
    });
    items.forEach((item, i) => { item.order = i; });
    setStops(items);
    setTotalDistance(0);
    setTotalDuration(0);
    setError(null);
  }, [isOpen, jobs]);

  useEffect(() => {
    if (!isOpen) return;
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      pos => setCurrentLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || savedRouteLoaded) return;
    const officerId = selectedOfficerId || currentUserId;
    if (!officerId) { setSavedRouteLoaded(true); return; }
    let cancelled = false;
    (async () => {
      try {
        const saved = await apiFetch<any>(`/process-server/routes/${routeDate}?officer_id=${officerId}`);
        if (cancelled || !saved?.optimized_order_json) return;
        const orderJson = typeof saved.optimized_order_json === 'string' ? JSON.parse(saved.optimized_order_json) : saved.optimized_order_json;
        if (Array.isArray(orderJson) && orderJson.length > 0) {
          setStops(prev => {
            const idToStop = new Map(prev.map(s => [s.job.id, s]));
            const ordered: StopItem[] = [];
            for (const id of orderJson) {
              const s = idToStop.get(id);
              if (s) { ordered.push({ ...s, selected: true }); idToStop.delete(id); }
            }
            for (const s of idToStop.values()) ordered.push(s);
            return ordered.map((s, i) => ({ ...s, order: i }));
          });
        }
        if (saved.total_distance_miles) setTotalDistance(saved.total_distance_miles);
        if (saved.total_time_minutes) setTotalDuration(saved.total_time_minutes);
      } catch {}
      setSavedRouteLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [isOpen, savedRouteLoaded, selectedOfficerId, currentUserId, routeDate]);

  // Initialize Mapbox
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;

    const initMap = () => {
      if (cancelled || !mapContainerRef.current) return;
      const centerLng = currentLocation?.lng || geocodedJobs[0]?.recipient_lng || -111.891;
      const centerLat = currentLocation?.lat || geocodedJobs[0]?.recipient_lat || 40.7608;

      const map = new mapboxgl.Map({
        container: mapContainerRef.current,
        style: MAPBOX_STYLE_DARK,
        center: [centerLng, centerLat],
        zoom: 11,
        attributionControl: false,
      });
      mapRef.current = map;
      setMapReady(true);
    };

    (async () => {
      try {
        const token = await getMapboxAccessToken();
        if (cancelled) return;
        initMapbox(token);
        if (cancelled) return;
        initMap();
      } catch {
        if (!cancelled) setError('Failed to load Mapbox');
      }
    })();

    return () => { cancelled = true; setMapReady(false); };
  }, [isOpen]);

  // Update markers when stops change
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;

    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];

    const bounds = new mapboxgl.LngLatBounds();

    stops.forEach((stop, idx) => {
      if (!stop.selected) return;
      const lngLat: [number, number] = [stop.job.recipient_lng!, stop.job.recipient_lat!];
      bounds.extend(lngLat);

      const color = markerColor(stop.job.status);
      const el = document.createElement('div');
      el.style.cssText = `width:28px;height:28px;border-radius:50%;background:${color};border:2px solid #fff;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:bold;font-size:11px;box-shadow:0 2px 6px rgba(0,0,0,0.4);cursor:pointer;`;
      el.textContent = String(idx + 1);
      el.title = `${stop.job.recipient_name}\n${stop.job.recipient_address || ''}`;

      const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
        .setLngLat(lngLat)
        .addTo(mapRef.current!);
      markersRef.current.push(marker);
    });

    if (currentLocation) {
      const cl: [number, number] = [currentLocation.lng, currentLocation.lat];
      if (currentLocMarkerRef.current) currentLocMarkerRef.current.remove();
      const el = document.createElement('div');
      el.style.cssText = 'width:16px;height:16px;border-radius:50%;background:#888888;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.4);';
      currentLocMarkerRef.current = new mapboxgl.Marker({ element: el, anchor: 'center' })
        .setLngLat(cl).addTo(mapRef.current!);
      bounds.extend(cl);
    }

    if (stops.some(s => s.selected)) {
      mapRef.current.fitBounds(bounds, { padding: 60 });
    }
  }, [stops, mapReady, currentLocation]);

  // Actions
  const toggleStop = useCallback((idx: number) => {
    setStops(prev => prev.map((s, i) => i === idx ? { ...s, selected: !s.selected } : s));
  }, []);
  const selectAll = useCallback(() => setStops(prev => prev.map(s => ({ ...s, selected: true }))), []);
  const deselectAll = useCallback(() => setStops(prev => prev.map(s => ({ ...s, selected: false }))), []);
  const moveStop = useCallback((idx: number, dir: -1 | 1) => {
    setStops(prev => {
      const next = [...prev];
      const targetIdx = idx + dir;
      if (targetIdx < 0 || targetIdx >= next.length) return prev;
      [next[idx], next[targetIdx]] = [next[targetIdx], next[idx]];
      return next.map((s, i) => ({ ...s, order: i }));
    });
  }, []);

  const clearRouteFromMap = useCallback(() => {
    if (!mapRef.current) return;
    const srcId = routeSourceIdRef.current;
    if (srcId) {
      try { if (mapRef.current.getLayer(srcId)) mapRef.current.removeLayer(srcId); } catch {}
      try { if (mapRef.current.getSource(srcId)) mapRef.current.removeSource(srcId); } catch {}
      routeSourceIdRef.current = null;
    }
  }, []);

  const optimizeRoute = useCallback(async () => {
    if (!mapReady) return;

    const selected = stops.filter(s => s.selected);
    if (selected.length < 2) {
      setError('Select at least 2 stops to optimize');
      return;
    }

    setOptimizing(true);
    setError(null);
    clearRouteFromMap();

    try {
      const clusters = chainClusters(clusterStops(selected));
      let allOrderedStops: StopItem[] = [];
      let totalDistM = 0;
      let totalDurS = 0;
      let allGeometries: any[] = [];

      for (const cluster of clusters) {
        const isFirstCluster = clusters.indexOf(cluster) === 0;
        const origin = isFirstCluster && currentLocation
          ? [currentLocation.lng, currentLocation.lat] as [number, number]
          : [cluster[0].job.recipient_lng!, cluster[0].job.recipient_lat!] as [number, number];

        const waypointStops = isFirstCluster && currentLocation ? cluster : cluster.slice(1, -1);
        const waypointCoords = waypointStops.map(s => [s.job.recipient_lng!, s.job.recipient_lat!] as [number, number]);
        const destStop = cluster[cluster.length - 1];
        const destCoord: [number, number] = [destStop.job.recipient_lng!, destStop.job.recipient_lat!];

        // Build coordinates array with origin, waypoints, destination
        const allCoords = [origin, ...waypointCoords, destCoord];
        const token = await getMapboxAccessToken();
        if (!token) throw new Error('No Mapbox token');

        const coordStr = allCoords.map(c => c.join(',')).join(';');
        const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${coordStr}?access_token=${token}&geometries=geojson&steps=false&overview=full`;

        const res = await fetch(url);
        if (!res.ok) throw new Error(`Directions HTTP ${res.status}`);
        const data = await res.json();
        const route = data.routes?.[0];
        if (!route) continue;

        if (route.geometry) allGeometries.push(route.geometry);
        for (const leg of (route.legs || [])) {
          totalDistM += leg.distance || 0;
          totalDurS += leg.duration || 0;
        }

        allOrderedStops.push(...cluster);
      }

      // Render route on map
      if (allGeometries.length > 0 && mapRef.current) {
        const sourceId = `serve-route-${Date.now()}`;
        routeSourceIdRef.current = sourceId;

        const combinedCoords = allGeometries.flatMap(g => g.coordinates || []);
        if (combinedCoords.length > 1) {
          mapRef.current.addSource(sourceId, {
            type: 'geojson',
            data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: combinedCoords } },
          });
          mapRef.current.addLayer({
            id: sourceId,
            type: 'line',
            source: sourceId,
            paint: { 'line-color': '#888888', 'line-width': 4, 'line-opacity': 0.8 },
          });
        }
      }

      const distMiles = totalDistM * 0.000621371;
      const durMinutes = totalDurS / 60;
      setTotalDistance(distMiles);
      setTotalDuration(durMinutes);

      const unselected = stops.filter(s => !s.selected);
      const newStops: StopItem[] = [
        ...allOrderedStops.map((s, i) => ({ ...s, order: i })),
        ...unselected.map((s, i) => ({ ...s, order: allOrderedStops.length + i })),
      ];
      setStops(newStops);
    } catch (err: any) {
      setError(err?.message || 'Route optimization failed');
    } finally {
      setOptimizing(false);
    }
  }, [stops, mapReady, currentLocation, clearRouteFromMap]);

  const handleApplyAndClose = useCallback(async () => {
    const selectedStops = stops.filter(s => s.selected);
    const selectedIds = selectedStops.map(s => s.job.id);
    onRouteOptimized(selectedIds, { totalDistance, totalDuration, fuelCost: totalDistance * IRS_MILEAGE_RATE });

    const officerId = selectedOfficerId || currentUserId;
    if (officerId && selectedIds.length > 0) {
      try {
        const waypoints = selectedStops
          .filter(s => s.job.recipient_lat != null && s.job.recipient_lng != null)
          .map(s => ({ id: s.job.id, lat: s.job.recipient_lat, lng: s.job.recipient_lng, name: s.job.recipient_name }));
        await apiFetch('/process-server/routes', {
          method: 'POST',
          body: JSON.stringify({
            officer_id: officerId, route_date: routeDate,
            optimized_order_json: JSON.stringify(selectedIds),
            waypoints_json: JSON.stringify(waypoints),
            total_distance_miles: totalDistance, total_time_minutes: totalDuration,
          }),
        });
      } catch {}
    }
    onClose();
  }, [stops, totalDistance, totalDuration, selectedOfficerId, currentUserId, routeDate, onRouteOptimized, onClose]);

  if (!isOpen) return null;

  const selectedCount = stops.filter(s => s.selected).length;
  const fuelCost = totalDistance * IRS_MILEAGE_RATE;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-in fade-in duration-200" role="dialog" aria-modal="true" aria-label="Route Planner">
      <div className="bg-[#141414] border border-[#2b2b2b] rounded-[2px] w-full h-full max-w-[1400px] max-h-[95vh] flex flex-col shadow-md animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#2b2b2b] bg-[#0c0c0c]">
          <div className="flex items-center gap-2">
            <Route size={16} className="text-[#d4a017]" />
            <h2 className="text-sm font-semibold text-white tracking-wider">ROUTE PLANNER</h2>
            <span className="text-[11px] text-rmpg-500 ml-2">{selectedCount} of {stops.length} stops selected</span>
            {officers && officers.length > 0 && (
              <div className="flex items-center gap-1.5 ml-3 pl-3 border-l border-[#2b2b2b]">
                <User size={12} className="text-rmpg-400" />
                <select
                  value={selectedOfficerId || ''}
                  onChange={e => { setSelectedOfficerId(Number(e.target.value)); setSavedRouteLoaded(false); }}
                  className="px-2 py-0.5 text-[11px] bg-[#0c0c0c] border border-[#2b2b2b] rounded-[2px] text-white focus:border-[#888888] focus:outline-none focus:ring-1 focus:ring-[#888888]/40 transition-colors"
                >
                  {officers.map(o => (<option key={o.id} value={o.id}>{o.name}</option>))}
                </select>
              </div>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={selectAll} className="toolbar-btn text-xs px-2 py-1"><CheckSquare className="w-3 h-3" /> All</button>
            <button type="button" onClick={deselectAll} className="toolbar-btn text-xs px-2 py-1"><Square className="w-3 h-3" /> None</button>
            <X size={20} className="text-rmpg-400 hover:text-white cursor-pointer transition-colors" onClick={onClose} aria-label="Close route planner" />
          </div>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* Left: Stop list */}
          <div className="w-[380px] border-r border-[#2b2b2b] flex flex-col bg-[#0c0c0c]">
            <div className="flex items-center gap-1.5 px-3 py-2 border-b border-[#2b2b2b]">
              <button type="button" onClick={optimizeRoute} disabled={optimizing || !mapReady || selectedCount < 2}
                className="toolbar-btn toolbar-btn-primary text-xs px-3 py-1.5 flex items-center gap-1.5 disabled:opacity-40 flex-1 justify-center">
                {optimizing ? <><Loader2 className="w-3 h-3 animate-spin" /> Optimizing...</> : <><Route className="w-3 h-3" /> Optimize Route</>}
              </button>
            </div>
            {error && <div className="px-3 py-1.5 bg-red-900/30 border-b border-red-700/50 text-red-300 text-[10px]">{error}</div>}

            <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-[#222222] scrollbar-track-transparent">
              {stops.map((stop, idx) => (
                <div key={stop.job.id} className={`flex items-center gap-2 px-3 py-2 border-b border-[#222222] transition-colors ${stop.selected ? 'bg-[#141414]' : 'opacity-50'}`}>
                  <button type="button" onClick={() => toggleStop(idx)} className="flex-shrink-0 p-0.5">
                    {stop.selected ? <CheckSquare size={16} className="text-brand-400" /> : <Square size={16} className="text-rmpg-600" />}
                  </button>
                  <span className="w-5 text-xs font-mono font-bold text-rmpg-300 flex-shrink-0">{idx + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-white truncate">{stop.job.recipient_name}</div>
                    <div className="text-[10px] text-rmpg-500 truncate">{stop.job.recipient_address || 'No address'}</div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <PriorityBadge p={stop.job.priority} />
                    <TimeWindowBadge tw={stop.job.time_window} />
                    <div className="flex flex-col gap-0.5 ml-1">
                      <button type="button" onClick={() => moveStop(idx, -1)} disabled={idx === 0} className="text-rmpg-500 hover:text-white disabled:opacity-30">
                        <ChevronUp size={10} />
                      </button>
                      <button type="button" onClick={() => moveStop(idx, 1)} disabled={idx === stops.length - 1} className="text-rmpg-500 hover:text-white disabled:opacity-30">
                        <ChevronDown size={10} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="px-4 py-3 border-t border-[#2b2b2b] bg-[#0c0c0c] space-y-2">
              <div className="flex justify-between text-xs"><span className="text-rmpg-500 flex items-center gap-1.5"><MapPin size={12} /> Distance:</span><span className="text-white font-mono">{totalDistance.toFixed(1)} mi</span></div>
              <div className="flex justify-between text-xs"><span className="text-rmpg-500 flex items-center gap-1.5"><Clock size={12} /> Est. Time:</span><span className="text-white font-mono">{Math.floor(totalDuration / 60)}h {Math.round(totalDuration % 60)}m</span></div>
              <div className="flex justify-between text-xs"><span className="text-rmpg-500 flex items-center gap-1.5"><DollarSign size={12} /> Fuel:</span><span className="text-white font-mono">${fuelCost.toFixed(2)}</span></div>
              <div className="flex justify-between text-xs"><span className="text-rmpg-500 flex items-center gap-1.5"><Gauge size={12} /> Efficiency:</span><span className="text-white font-mono">{totalDistance > 0 ? `${(selectedCount / totalDistance).toFixed(1)} stops/mi` : '\u2014'}</span></div>

              <div className="flex gap-2 pt-1">
                <button type="button" onClick={handleApplyAndClose} className="toolbar-btn toolbar-btn-primary text-xs px-4 py-2 flex-1 justify-center">
                  <Navigation size={14} /> Apply Route
                </button>
                <button type="button" onClick={onClose} className="toolbar-btn text-xs px-4 py-2">Cancel</button>
              </div>
            </div>
          </div>

          {/* Right: Map */}
          <div className="flex-1 relative bg-[#050505]">
            <div ref={mapContainerRef} className="absolute inset-0" />
            {(!mapReady || optimizing) && (
              <div className="absolute inset-0 flex items-center justify-center bg-[rgba(0,0,0,0.5)]">
                <Loader2 size={24} className="animate-spin text-brand-400" />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
