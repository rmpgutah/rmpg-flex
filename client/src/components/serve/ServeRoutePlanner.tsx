import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  X, Route, MapPin, ChevronUp, ChevronDown, CheckSquare, Square,
  Loader2, Navigation, Clock, DollarSign, Gauge,
} from 'lucide-react';
import { loadGoogleMaps, DARK_MAP_STYLE } from '../../utils/googleMapsLoader';
import type { ServeJob } from '../../types';

// ─── Types ──────────────────────────────────────────────────────────────

interface ServeRoutePlannerProps {
  isOpen: boolean;
  onClose: () => void;
  jobs: ServeJob[];
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
    default: return '#3b82f6';            // blue — pending/unvisited
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
    afternoon: 'bg-blue-900/40 text-blue-400 border-blue-700/50',
    evening: 'bg-purple-900/40 text-purple-400 border-purple-700/50',
    anytime: 'bg-gray-800/40 text-gray-400 border-gray-700/50',
  };
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${colors[tw] || colors.anytime}`}>
      {tw}
    </span>
  );
}

function PriorityBadge({ p }: { p: ServeJob['priority'] }) {
  const colors: Record<string, string> = {
    rush: 'bg-red-900/40 text-red-400 border-red-700/50',
    high: 'bg-orange-900/40 text-orange-400 border-orange-700/50',
    normal: 'bg-gray-800/40 text-gray-400 border-gray-700/50',
    low: 'bg-gray-800/30 text-gray-500 border-gray-700/30',
  };
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${colors[p] || colors.normal}`}>
      {p}
    </span>
  );
}

// ─── Component ──────────────────────────────────────────────────────────

export default function ServeRoutePlanner({
  isOpen,
  onClose,
  jobs,
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
        renderingType: 'RASTER' as any,
        styles: DARK_MAP_STYLE,
        disableDefaultUI: true,
        zoomControl: true,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        backgroundColor: '#0a1220',
      });

      mapRef.current = map;
      directionsRendererRef.current = new google.maps.DirectionsRenderer({
        map,
        suppressMarkers: true, // we draw our own numbered markers
        polylineOptions: {
          strokeColor: '#3b82f6',
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
          fillColor: '#3b82f6',
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

        const waypoints: google.maps.DirectionsWaypoint[] = (
          isFirstCluster && currentLocation ? cluster : cluster.slice(1, -1)
        ).map(s => ({
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
            (res, status) => {
              if (status === 'OK' && res) resolve(res);
              else reject(new Error(`Directions request failed: ${status}`));
            },
          );
        });

        // Apply waypoint order
        const waypointOrder = result.routes[0]?.waypoint_order || [];
        const reorderedWaypoints = waypointOrder.map(i => waypointStops[i]);

        if (isFirstCluster && currentLocation) {
          // All stops were waypoints + destination
          const allClusterStops = [...reorderedWaypoints];
          // The destination is the last stop (not reordered)
          // But we need to check if destination was included in waypoints
          allOrderedStops.push(...allClusterStops);
          // Add the destination stop (last in cluster)
          if (!allClusterStops.includes(cluster[cluster.length - 1])) {
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
              (res, status) => {
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

  const handleApplyAndClose = useCallback(() => {
    const selectedIds = stops.filter(s => s.selected).map(s => s.job.id);
    onRouteOptimized(selectedIds, {
      totalDistance,
      totalDuration,
      fuelCost: totalDistance * IRS_MILEAGE_RATE,
    });
    onClose();
  }, [stops, totalDistance, totalDuration, onRouteOptimized, onClose]);

  // ─── Render ─────────────────────────────────────────────────────────

  if (!isOpen) return null;

  const selectedCount = stops.filter(s => s.selected).length;
  const fuelCost = totalDistance * IRS_MILEAGE_RATE;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="bg-[#141e2b] border border-[#1e3048] rounded w-full h-full max-w-[1400px] max-h-[95vh] flex flex-col shadow-2xl">
        {/* ─── Header ─────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#1e3048] bg-[#0d1520]">
          <div className="flex items-center gap-2">
            <Route size={16} className="text-blue-400" />
            <h2 className="text-sm font-semibold text-white">Route Planner</h2>
            <span className="text-[11px] text-gray-500 ml-2">
              {selectedCount} of {stops.length} stops selected
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleApplyAndClose}
              className="px-3 py-1 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 rounded border border-blue-500 transition-colors"
            >
              Apply Route
            </button>
            <button
              onClick={onClose}
              className="p-1 text-gray-500 hover:text-white transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* ─── Body (responsive: stacked mobile, side-by-side desktop) ─── */}
        <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
          {/* ─── Left Panel: Stop List ─────────────────────────────── */}
          <div className="w-full lg:w-[380px] flex flex-col border-b lg:border-b-0 lg:border-r border-[#1e3048] bg-[#0d1520]">
            {/* Controls */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-[#1e3048]">
              <div className="flex items-center gap-2">
                <button
                  onClick={selectAll}
                  className="text-[10px] text-blue-400 hover:text-blue-300 transition-colors"
                >
                  Select All
                </button>
                <span className="text-gray-600">|</span>
                <button
                  onClick={deselectAll}
                  className="text-[10px] text-blue-400 hover:text-blue-300 transition-colors"
                >
                  Deselect All
                </button>
              </div>
              <button
                onClick={optimizeRoute}
                disabled={optimizing || selectedCount < 2}
                className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 disabled:text-gray-500 rounded border border-emerald-500 disabled:border-gray-600 transition-colors"
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
              <div className="px-3 py-1.5 text-[11px] text-red-400 bg-red-900/20 border-b border-[#1e3048]">
                {error}
              </div>
            )}

            {/* Stop List */}
            <div className="flex-1 overflow-y-auto">
              {stops.length === 0 ? (
                <div className="flex items-center justify-center h-32 text-xs text-gray-500">
                  No geocoded stops available
                </div>
              ) : (
                stops.map((stop, idx) => (
                  <div
                    key={stop.job.id}
                    className={`flex items-center gap-2 px-3 py-2 border-b border-[#1a2636]/50 hover:bg-[#1a2636]/50 transition-colors ${
                      !stop.selected ? 'opacity-40' : ''
                    }`}
                  >
                    {/* Checkbox */}
                    <button onClick={() => toggleStop(idx)} className="shrink-0 text-gray-400 hover:text-white">
                      {stop.selected ? (
                        <CheckSquare size={14} className="text-blue-400" />
                      ) : (
                        <Square size={14} />
                      )}
                    </button>

                    {/* Order Number */}
                    <span className="shrink-0 w-5 h-5 flex items-center justify-center rounded-full text-[10px] font-bold text-white"
                      style={{ backgroundColor: stop.selected ? markerColor(stop.job.status) : '#374151' }}
                    >
                      {idx + 1}
                    </span>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-white truncate">
                        {stop.job.recipient_name}
                      </div>
                      <div className="text-[10px] text-gray-500 truncate">
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
                      <button
                        onClick={() => moveStop(idx, -1)}
                        disabled={idx === 0}
                        className="p-0.5 text-gray-500 hover:text-white disabled:text-gray-700 transition-colors"
                      >
                        <ChevronUp size={12} />
                      </button>
                      <button
                        onClick={() => moveStop(idx, 1)}
                        disabled={idx === stops.length - 1}
                        className="p-0.5 text-gray-500 hover:text-white disabled:text-gray-700 transition-colors"
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
              <div className="absolute inset-0 flex items-center justify-center bg-[#0d1520]">
                <div className="flex items-center gap-2 text-xs text-gray-400">
                  <Loader2 size={14} className="animate-spin" />
                  Loading map...
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ─── Stats Bar ──────────────────────────────────────────── */}
        <div className="flex items-center gap-6 px-4 py-2 border-t border-[#1e3048] bg-[#0d1520] text-xs">
          <div className="flex items-center gap-1.5 text-gray-400">
            <MapPin size={12} className="text-blue-400" />
            <span>Total stops:</span>
            <span className="text-white font-medium">{selectedCount}</span>
          </div>
          <div className="flex items-center gap-1.5 text-gray-400">
            <Gauge size={12} className="text-emerald-400" />
            <span>Distance:</span>
            <span className="text-white font-medium">
              {totalDistance > 0 ? `${totalDistance.toFixed(1)} mi` : '--'}
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-gray-400">
            <Clock size={12} className="text-amber-400" />
            <span>Est. time:</span>
            <span className="text-white font-medium">
              {totalDuration > 0
                ? `${Math.floor(totalDuration / 60)} hr ${Math.round(totalDuration % 60)} min`
                : '--'}
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-gray-400">
            <DollarSign size={12} className="text-green-400" />
            <span>Fuel cost:</span>
            <span className="text-white font-medium">
              {fuelCost > 0 ? `$${fuelCost.toFixed(2)}` : '--'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
