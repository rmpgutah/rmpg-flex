import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  X, Route, MapPin, ChevronUp, ChevronDown, CheckSquare, Square,
  Loader2, Navigation, Clock, DollarSign, Gauge, User,
} from 'lucide-react';
import { loadGoogleMaps, DARK_MAP_STYLE } from '../../utils/googleMapsLoader';
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
    totalDistance: number; // miles
    totalDuration: number; // minutes
    fuelCost: number;
  }) => void;
}

interface StopItem {
  job: ServeJob;
  selected: boolean;
  order: number;
}

const IRS_MILEAGE_RATE = 0.67; // $/mile

const GMAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';

// ─── Marker Colors ──────────────────────────────────────────────────────

function markerColor(status: ServeJob['status']): string {
  switch (status) {
    case 'served': return '#22c55e';      // green
    case 'in_progress': return '#eab308'; // yellow
    case 'failed': return '#ef4444';      // red
    default: return '#888888';            // blue — pending/unvisited
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
  switch (p) {
    case 'rush': return 0;
    case 'high': return 1;
    case 'normal': return 2;
    case 'low': return 3;
  }
}

// ─── Geographic Clustering for >25 Stops ────────────────────────────────

function clusterStops(stops: StopItem[]): StopItem[][] {
  if (stops.length <= 25) return [stops];
  if (stops.length === 0) return [];

  const lats = stops.map(s => s.job.recipient_lat!);
  const lngs = stops.map(s => s.job.recipient_lng!);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const midLat = (minLat + maxLat) / 2;
  const midLng = (minLng + maxLng) / 2;

  // Split into quadrants
  const quadrants: StopItem[][] = [[], [], [], []];
  for (const stop of stops) {
    const lat = stop.job.recipient_lat!;
    const lng = stop.job.recipient_lng!;
    const qi = (lat >= midLat ? 0 : 2) + (lng >= midLng ? 0 : 1);
    quadrants[qi].push(stop);
  }

  // Recursively split quadrants that are still >25
  const result: StopItem[][] = [];
  for (const q of quadrants) {
    if (q.length === 0) continue;
    if (q.length <= 25) {
      result.push(q);
    } else {
      result.push(...clusterStops(q));
    }
  }
  return result;
}

// ─── Nearest Neighbor for Cluster Chaining ──────────────────────────────

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
    let bestDist = Infinity;
    let bestIdx = -1;
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

// ─── Badge Components ───────────────────────────────────────────────────

function TimeWindowBadge({ tw }: { tw: ServeJob['time_window'] }) {
  const colors: Record<string, string> = {
    morning: 'bg-amber-900/40 text-amber-400 border-amber-700/50',
    afternoon: 'bg-gray-900/40 text-gray-400 border-gray-700/50',
    evening: 'bg-purple-900/40 text-purple-400 border-purple-700/50',
    anytime: 'bg-rmpg-800/40 text-rmpg-400 border-rmpg-700/50',
  };
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded-[2px] border font-mono ${colors[tw] || colors.anytime}`}>
      {tw}
    </span>
  );
}

function PriorityBadge({ p }: { p: ServeJob['priority'] }) {
  const colors: Record<string, string> = {
    rush: 'bg-red-900/40 text-red-400 border-red-700/50',
    high: 'bg-orange-900/40 text-orange-400 border-orange-700/50',
    normal: 'bg-rmpg-800/40 text-rmpg-400 border-rmpg-700/50',
    low: 'bg-rmpg-800/30 text-rmpg-500 border-rmpg-700/30',
  };
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded-[2px] border font-mono uppercase ${colors[p] || colors.normal}`}>
      {p}
    </span>
  );
}

// ─── Component ──────────────────────────────────────────────────────────

export default function ServeRoutePlanner({
  isOpen,
  onClose,
  jobs,
  officers,
  currentUserId,
  onRouteOptimized,
}: ServeRoutePlannerProps) {
  // Filter to jobs with valid coords
  const geocodedJobs = jobs.filter(j => j.recipient_lat != null && j.recipient_lng != null);

  const [stops, setStops] = useState<StopItem[]>([]);
  const [optimizing, setOptimizing] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [totalDistance, setTotalDistance] = useState(0); // miles
  const [totalDuration, setTotalDuration] = useState(0); // minutes
  const [currentLocation, setCurrentLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedOfficerId, setSelectedOfficerId] = useState<number>(currentUserId || 0);
  const [routeDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const [savedRouteLoaded, setSavedRouteLoaded] = useState(false);

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const directionsRendererRef = useRef<google.maps.DirectionsRenderer | null>(null);
  const currentLocMarkerRef = useRef<google.maps.Marker | null>(null);

  // Initialize stops from jobs
  useEffect(() => {
    if (!isOpen) return;
    const items: StopItem[] = geocodedJobs.map((job, i) => ({
      job,
      selected: job.status !== 'served' && job.status !== 'failed',
      order: i,
    }));
    // Sort by time window priority, then priority weight
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

  // Get current location
  useEffect(() => {
    if (!isOpen) return;
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      pos => setCurrentLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => { /* ignore error — current location is optional */ },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }, [isOpen]);

  // Load saved route on open (Step 3.3)
  useEffect(() => {
    if (!isOpen || savedRouteLoaded) return;
    const officerId = selectedOfficerId || currentUserId;
    if (!officerId) { setSavedRouteLoaded(true); return; }
    let cancelled = false;
    (async () => {
      try {
        const saved = await apiFetch<any>(`/process-server/routes/${routeDate}?officer_id=${officerId}`);
        if (cancelled || !saved?.optimized_order_json) return;
        const orderJson = typeof saved.optimized_order_json === 'string'
          ? JSON.parse(saved.optimized_order_json)
          : saved.optimized_order_json;
        if (Array.isArray(orderJson) && orderJson.length > 0) {
          // Reorder stops to match saved ordering
          setStops(prev => {
            const idToStop = new Map(prev.map(s => [s.job.id, s]));
            const ordered: StopItem[] = [];
            for (const id of orderJson) {
              const s = idToStop.get(id);
              if (s) { ordered.push({ ...s, selected: true }); idToStop.delete(id); }
            }
            // Append remaining stops not in saved order
            for (const s of idToStop.values()) ordered.push(s);
            return ordered.map((s, i) => ({ ...s, order: i }));
          });
        }
        if (saved.total_distance_miles) setTotalDistance(saved.total_distance_miles);
        if (saved.total_time_minutes) setTotalDuration(saved.total_time_minutes);
      } catch { /* no saved route — that's fine */ }
      setSavedRouteLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [isOpen, savedRouteLoaded, selectedOfficerId, currentUserId, routeDate]);

  // Initialize Google Maps
  useEffect(() => {
    if (!isOpen || !GMAPS_API_KEY) return;

    let cancelled = false;

    loadGoogleMaps(GMAPS_API_KEY).then(() => {
      if (cancelled || !mapContainerRef.current) return;

      const center = currentLocation
        || (geocodedJobs.length > 0
          ? { lat: geocodedJobs[0].recipient_lat!, lng: geocodedJobs[0].recipient_lng! }
          : { lat: 40.7608, lng: -111.891 }); // SLC fallback

      const map = new google.maps.Map(mapContainerRef.current, {
        center,
        zoom: 11,
        styles: DARK_MAP_STYLE,
        disableDefaultUI: true,
        zoomControl: true,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
      });

      mapRef.current = map;
      directionsRendererRef.current = new google.maps.DirectionsRenderer({
        map,
        suppressMarkers: true, // we draw our own numbered markers
        polylineOptions: {
          strokeColor: '#888888',
          strokeWeight: 4,
          strokeOpacity: 0.8,
        },
      });

      setMapReady(true);
    }).catch(() => {
      if (!cancelled) setError('Failed to load Google Maps');
    });

    return () => {
      cancelled = true;
      setMapReady(false);
    };
  }, [isOpen]);

  // Update markers when stops change
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;

    // Clear old markers
    markersRef.current.forEach(m => m.setMap(null));
    markersRef.current = [];

    const bounds = new google.maps.LatLngBounds();

    stops.forEach((stop, idx) => {
      if (!stop.selected) return;
      const pos = { lat: stop.job.recipient_lat!, lng: stop.job.recipient_lng! };
      bounds.extend(pos);

      const color = markerColor(stop.job.status);
      const marker = new google.maps.Marker({
        position: pos,
        map: mapRef.current!,
        label: {
          text: String(idx + 1),
          color: '#ffffff',
          fontSize: '11px',
          fontWeight: 'bold',
        },
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          fillColor: color,
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 1.5,
          scale: 14,
        },
        title: `${stop.job.recipient_name}\n${stop.job.recipient_address || ''}`,
      });
      markersRef.current.push(marker);
    });

    // Current location marker
    if (currentLocation) {
      if (currentLocMarkerRef.current) currentLocMarkerRef.current.setMap(null);
      currentLocMarkerRef.current = new google.maps.Marker({
        position: currentLocation,
        map: mapRef.current,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          fillColor: '#888888',
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 2,
          scale: 8,
        },
        title: 'Your Location',
        zIndex: 999,
      });
      bounds.extend(currentLocation);
    }

    if (stops.some(s => s.selected)) {
      mapRef.current.fitBounds(bounds, 60);
    }
  }, [stops, mapReady, currentLocation]);

  // ─── Actions ────────────────────────────────────────────────────────

  const toggleStop = useCallback((idx: number) => {
    setStops(prev => prev.map((s, i) => i === idx ? { ...s, selected: !s.selected } : s));
  }, []);

  const selectAll = useCallback(() => {
    setStops(prev => prev.map(s => ({ ...s, selected: true })));
  }, []);

  const deselectAll = useCallback(() => {
    setStops(prev => prev.map(s => ({ ...s, selected: false })));
  }, []);

  const moveStop = useCallback((idx: number, dir: -1 | 1) => {
    setStops(prev => {
      const next = [...prev];
      const targetIdx = idx + dir;
      if (targetIdx < 0 || targetIdx >= next.length) return prev;
      [next[idx], next[targetIdx]] = [next[targetIdx], next[idx]];
      return next.map((s, i) => ({ ...s, order: i }));
    });
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

    try {
      const directionsService = new google.maps.DirectionsService();
      const clusters = chainClusters(clusterStops(selected));

      let allOrderedStops: StopItem[] = [];
      let totalDistM = 0;
      let totalDurS = 0;

      for (const cluster of clusters) {
        if (cluster.length === 1) {
          allOrderedStops.push(cluster[0]);
          continue;
        }

        // Determine origin: for first cluster, use current location if available
        const isFirstCluster = clusters.indexOf(cluster) === 0;
        const origin = isFirstCluster && currentLocation
          ? currentLocation
          : { lat: cluster[0].job.recipient_lat!, lng: cluster[0].job.recipient_lng! };

        const destination = {
          lat: cluster[cluster.length - 1].job.recipient_lat!,
          lng: cluster[cluster.length - 1].job.recipient_lng!,
        };

        // Build waypoints (excluding origin stop if it's the first cluster with current location)
        const waypointStops = isFirstCluster && currentLocation
          ? cluster
          : cluster.slice(1, -1);

        const waypoints: google.maps.DirectionsWaypoint[] = waypointStops.map(s => ({
          location: new google.maps.LatLng(s.job.recipient_lat!, s.job.recipient_lng!),
          stopover: true,
        }));

        const destLocation = isFirstCluster && currentLocation
          ? new google.maps.LatLng(cluster[cluster.length - 1].job.recipient_lat!, cluster[cluster.length - 1].job.recipient_lng!)
          : new google.maps.LatLng(destination.lat, destination.lng);

        const result = await new Promise<google.maps.DirectionsResult>((resolve, reject) => {
          directionsService.route(
            {
              origin: isFirstCluster && currentLocation
                ? new google.maps.LatLng(currentLocation.lat, currentLocation.lng)
                : new google.maps.LatLng(cluster[0].job.recipient_lat!, cluster[0].job.recipient_lng!),
              destination: destLocation,
              waypoints: waypoints.length > 0 ? waypoints : undefined,
              optimizeWaypoints: true,
              travelMode: google.maps.TravelMode.DRIVING,
            },
            (res: google.maps.DirectionsResult | null, status: google.maps.DirectionsStatus) => {
              if (status === 'OK' && res) resolve(res);
              else reject(new Error(`Directions request failed: ${status}`));
            },
          );
        });

        // Apply waypoint order
        const waypointOrder = result.routes[0]?.waypoint_order || [];
        const reorderedWaypoints = waypointOrder.map((i: number) => waypointStops[i]);

        if (isFirstCluster && currentLocation) {
          // All stops were waypoints + destination
          const reorderedClusterStops = [...reorderedWaypoints];
          // The destination is the last stop (not reordered)
          // But we need to check if destination was included in waypoints
          allOrderedStops.push(...reorderedClusterStops);
          // Add the destination stop (last in cluster)
          if (!reorderedClusterStops.includes(cluster[cluster.length - 1])) {
            allOrderedStops.push(cluster[cluster.length - 1]);
          }
        } else {
          allOrderedStops.push(cluster[0], ...reorderedWaypoints, cluster[cluster.length - 1]);
        }

        // Sum distances and durations
        const legs = result.routes[0]?.legs || [];
        for (const leg of legs) {
          totalDistM += leg.distance?.value || 0;
          totalDurS += leg.duration?.value || 0;
        }

        // Render directions for the last cluster (show the full route)
        if (clusters.indexOf(cluster) === clusters.length - 1 || clusters.length === 1) {
          directionsRendererRef.current?.setDirections(result);
        }
      }

      // If multiple clusters, re-render the full route for display
      if (clusters.length > 1 && allOrderedStops.length >= 2) {
        try {
          const fullWaypoints = allOrderedStops.slice(1, -1).slice(0, 23).map(s => ({
            location: new google.maps.LatLng(s.job.recipient_lat!, s.job.recipient_lng!),
            stopover: true,
          }));

          const fullResult = await new Promise<google.maps.DirectionsResult>((resolve, reject) => {
            directionsService.route(
              {
                origin: currentLocation
                  ? new google.maps.LatLng(currentLocation.lat, currentLocation.lng)
                  : new google.maps.LatLng(allOrderedStops[0].job.recipient_lat!, allOrderedStops[0].job.recipient_lng!),
                destination: new google.maps.LatLng(
                  allOrderedStops[allOrderedStops.length - 1].job.recipient_lat!,
                  allOrderedStops[allOrderedStops.length - 1].job.recipient_lng!,
                ),
                waypoints: fullWaypoints,
                optimizeWaypoints: false, // already optimized
                travelMode: google.maps.TravelMode.DRIVING,
              },
              (res: google.maps.DirectionsResult | null, status: google.maps.DirectionsStatus) => {
                if (status === 'OK' && res) resolve(res);
                else reject(new Error(`Full route render failed: ${status}`));
              },
            );
          });
          directionsRendererRef.current?.setDirections(fullResult);
        } catch {
          // Non-fatal — individual cluster routes still valid
        }
      }

      const distMiles = totalDistM * 0.000621371;
      const durMinutes = totalDurS / 60;

      setTotalDistance(distMiles);
      setTotalDuration(durMinutes);

      // Update stop list order
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
  }, [stops, mapReady, currentLocation]);

  const handleApplyAndClose = useCallback(async () => {
    const selectedStops = stops.filter(s => s.selected);
    const selectedIds = selectedStops.map(s => s.job.id);
    onRouteOptimized(selectedIds, {
      totalDistance,
      totalDuration,
      fuelCost: totalDistance * IRS_MILEAGE_RATE,
    });

    // Persist route to server (Step 3.2)
    const officerId = selectedOfficerId || currentUserId;
    if (officerId && selectedIds.length > 0) {
      try {
        const waypoints = selectedStops
          .filter(s => s.job.recipient_lat != null && s.job.recipient_lng != null)
          .map(s => ({ id: s.job.id, lat: s.job.recipient_lat, lng: s.job.recipient_lng, name: s.job.recipient_name }));
        await apiFetch('/process-server/routes', {
          method: 'POST',
          body: JSON.stringify({
            officer_id: officerId,
            route_date: routeDate,
            optimized_order_json: JSON.stringify(selectedIds),
            waypoints_json: JSON.stringify(waypoints),
            total_distance_miles: totalDistance,
            total_time_minutes: totalDuration,
          }),
        });
      } catch {
        // Route save failed — non-fatal, local state still applied
      }
    }

    onClose();
  }, [stops, totalDistance, totalDuration, selectedOfficerId, currentUserId, routeDate, onRouteOptimized, onClose]);

  // ─── Render ─────────────────────────────────────────────────────────

  if (!isOpen) return null;

  const selectedCount = stops.filter(s => s.selected).length;
  const fuelCost = totalDistance * IRS_MILEAGE_RATE;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-in fade-in duration-200" role="dialog" aria-modal="true" aria-label="Route Planner">
      <div className="bg-[#0a0a0a] border border-[#222222] rounded-[2px] w-full h-full max-w-[1400px] max-h-[95vh] flex flex-col shadow-md animate-in zoom-in-95 duration-200">
        {/* ─── Header ─────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#222222] bg-[#050505]">
          <div className="flex items-center gap-2">
            <Route size={16} className="text-[#d4a017]" />
            <h2 className="text-sm font-semibold text-white tracking-wider">ROUTE PLANNER</h2>
            <span className="text-[11px] text-rmpg-500 ml-2">
              {selectedCount} of {stops.length} stops selected
            </span>
            {/* Officer selector (Step 3.1) */}
            {officers && officers.length > 0 && (
              <div className="flex items-center gap-1.5 ml-3 pl-3 border-l border-[#222222]">
                <User size={12} className="text-rmpg-400" />
                <select
                  value={selectedOfficerId || ''}
                  onChange={e => { setSelectedOfficerId(Number(e.target.value)); setSavedRouteLoaded(false); }}
                  className="px-2 py-0.5 text-[11px] bg-[#050505] border border-[#222222] rounded-[2px] text-white focus:border-[#888888] focus:outline-none focus:ring-1 focus:ring-[#888888]/40 transition-colors"
                  aria-label="Select officer for route"
                >
                  {officers.map(o => (
                    <option key={o.id} value={o.id}>{o.name}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button type="button"
              onClick={handleApplyAndClose}
              className="px-3 py-1 text-xs font-medium text-white bg-[#888888] hover:bg-[#888888]/80 rounded-[2px] border border-[#888888] transition-all duration-150 focus:outline-none focus:ring-1 focus:ring-[#888888]/50 hover:shadow-[0_0_8px_rgba(136,136,136,0.2)]"
            >
              Apply Route
            </button>
            <button type="button"
              onClick={onClose}
              className="p-1 text-rmpg-500 hover:text-white transition-colors rounded-[2px] hover:bg-[#141414] focus:outline-none focus:ring-1 focus:ring-[#888888]/50"
              aria-label="Close route planner"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* ─── Body (responsive: stacked mobile, side-by-side desktop) ─── */}
        <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
          {/* ─── Left Panel: Stop List ─────────────────────────────── */}
          <div className="w-full lg:w-[380px] flex flex-col border-b lg:border-b-0 lg:border-r border-[#222222] bg-[#050505]">
            {/* Controls */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-[#222222]">
              <div className="flex items-center gap-2">
                <button type="button"
                  onClick={selectAll}
                  className="text-[10px] text-gray-400 hover:text-gray-300 transition-colors focus:outline-none focus:ring-1 focus:ring-[#888888]/50 rounded-[2px]"
                >
                  Select All
                </button>
                <span className="text-rmpg-600">|</span>
                <button type="button"
                  onClick={deselectAll}
                  className="text-[10px] text-gray-400 hover:text-gray-300 transition-colors focus:outline-none focus:ring-1 focus:ring-[#888888]/50 rounded-[2px]"
                >
                  Deselect All
                </button>
              </div>
              <button type="button"
                onClick={optimizeRoute}
                disabled={optimizing || selectedCount < 2}
                className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-white bg-[#d4a017] hover:bg-[#d4a017]/80 disabled:bg-rmpg-700 disabled:text-rmpg-500 rounded-[2px] border border-[#d4a017] disabled:border-rmpg-600 transition-all duration-150 focus:outline-none focus:ring-1 focus:ring-[#d4a017]/50 hover:shadow-[0_0_8px_rgba(212,160,23,0.2)]"
              >
                {optimizing ? (
                  <><Loader2 size={12} className="animate-spin" /> Optimizing...</>
                ) : (
                  <><Navigation size={12} /> Optimize Route</>
                )}
              </button>
            </div>

            {/* Error */}
            {error && (
              <div className="px-3 py-1.5 text-[11px] text-red-400 bg-red-900/20 border-b border-[#222222]">
                {error}
              </div>
            )}

            {/* Stop List */}
            <div className="flex-1 overflow-y-auto scrollbar-dark">
              {stops.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-32 text-xs text-rmpg-500">
                  <MapPin size={20} className="text-rmpg-600 mb-2" />
                  No geocoded stops available
                </div>
              ) : (
                stops.map((stop, idx) => (
                  <div
                    key={stop.job.id}
                    className={`flex items-center gap-2 px-3 py-2 border-b border-[#141414]/50 hover:bg-[#141414]/60 transition-all duration-100 ${
                      !stop.selected ? 'opacity-40' : ''
                    } ${stop.job.status === 'served' ? 'bg-green-900/10' : ''}`}
                  >
                    {/* Checkbox */}
                    <button type="button" onClick={() => toggleStop(idx)} className="shrink-0 text-rmpg-400 hover:text-white transition-colors" aria-label={stop.selected ? 'Deselect stop' : 'Select stop'}>
                      {stop.selected ? (
                        <CheckSquare size={14} className="text-gray-400" />
                      ) : (
                        <Square size={14} />
                      )}
                    </button>

                    {/* Order Number */}
                    <span className="shrink-0 w-5 h-5 flex items-center justify-center rounded-full text-[10px] font-bold text-[#d4a017] tabular-nums"
                      style={{ backgroundColor: stop.selected ? markerColor(stop.job.status) : '#444444', boxShadow: stop.selected ? `0 0 6px ${markerColor(stop.job.status)}80` : 'none' }}
                    >
                      {idx + 1}
                    </span>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-white truncate">
                        {stop.job.recipient_name}
                      </div>
                      <div className={`text-[10px] text-rmpg-500 truncate ${stop.job.status === 'served' ? 'line-through' : ''}`}>
                        {stop.job.recipient_address || 'No address'}
                        {stop.job.recipient_city ? `, ${stop.job.recipient_city}` : ''}
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <TimeWindowBadge tw={stop.job.time_window} />
                        <PriorityBadge p={stop.job.priority} />
                      </div>
                    </div>

                    {/* Reorder Buttons */}
                    <div className="shrink-0 flex flex-col gap-0.5">
                      <button type="button"
                        onClick={() => moveStop(idx, -1)}
                        disabled={idx === 0}
                        className="p-0.5 text-rmpg-500 hover:text-white disabled:text-rmpg-700 transition-colors focus:outline-none focus:ring-1 focus:ring-[#888888]/50 rounded-[2px]"
                      >
                        <ChevronUp size={12} />
                      </button>
                      <button type="button"
                        onClick={() => moveStop(idx, 1)}
                        disabled={idx === stops.length - 1}
                        className="p-0.5 text-rmpg-500 hover:text-white disabled:text-rmpg-700 transition-colors focus:outline-none focus:ring-1 focus:ring-[#888888]/50 rounded-[2px]"
                      >
                        <ChevronDown size={12} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* ─── Right Panel: Map ──────────────────────────────────── */}
          <div className="flex-1 relative min-h-[300px]">
            <div ref={mapContainerRef} className="absolute inset-0" />
            {!mapReady && (
              <div className="absolute inset-0 flex items-center justify-center bg-[#050505]">
                <div className="flex items-center gap-2 text-xs text-rmpg-400">
                  <Loader2 size={14} className="animate-spin" />
                  Loading map...
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ─── Stats Bar ──────────────────────────────────────────── */}
        <div className="flex items-center gap-6 px-4 py-2 border-t border-[#222222] bg-[#050505] text-xs" role="status" aria-label="Route statistics">
          <div className="flex items-center gap-1.5 text-rmpg-400">
            <MapPin size={12} className="text-gray-400" />
            <span>Total stops:</span>
            <span className="text-white font-medium tabular-nums font-mono">{selectedCount}</span>
          </div>
          <div className="flex items-center gap-1.5 text-rmpg-400">
            <Gauge size={12} className="text-emerald-400" />
            <span>Distance:</span>
            <span className="text-white font-medium tabular-nums font-mono">
              {totalDistance > 0 ? `${totalDistance.toFixed(1)} mi` : '--'}
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-rmpg-400">
            <Clock size={12} className="text-amber-400" />
            <span>Est. time:</span>
            <span className="text-white font-medium tabular-nums font-mono">
              {totalDuration > 0
                ? `${Math.floor(totalDuration / 60)} hr ${Math.round(totalDuration % 60)} min`
                : '--'}
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-rmpg-400">
            <DollarSign size={12} className="text-green-400" />
            <span>Fuel cost:</span>
            <span className="text-white font-medium tabular-nums font-mono">
              {fuelCost > 0 ? `$${fuelCost.toFixed(2)}` : '--'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
