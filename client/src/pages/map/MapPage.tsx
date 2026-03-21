import React, { useEffect, useState, useCallback } from 'react';
import { Search, MapPin, Plus, Minus, X, Loader2, AlertTriangle } from 'lucide-react';
import type { UnitStatus } from '../../types';
import RmpgLogo from '../../components/RmpgLogo';
import { apiFetch } from '../../hooks/useApi';
import { useLiveSync } from '../../hooks/useLiveSync';
import { usePersistedTab } from '../../hooks/usePersistedState';
import { useUserPreferences } from '../../context/UserPreferencesContext';
import { useWebSocket } from '../../context/WebSocketContext';
import { useGpsTracking } from '../../hooks/useGpsTracking';
import { useToast } from '../../components/ToastProvider';
import { useGeoJsonLayers, type BeatDistrictEntry } from '../../hooks/useGeoJsonLayers';
import { useEventPlanning } from '../../hooks/useEventPlanning';
import { useShiftPlanning } from '../../hooks/useShiftPlanning';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useMapRouting } from '../../hooks/useMapRouting';
import OfflineMapFallback from '../../components/OfflineMapFallback';
import GpsBreadcrumbPanel from './GpsBreadcrumbPanel';
import type { MapUnit as Unit, ActiveCall, MapProperty as Property, MapStyleId } from './utils/mapConstants';
import { isLightMapStyle } from './utils/mapConstants';

// Hooks
import { useMapInit } from './hooks/useMapInit';
import { useMapMarkers } from './hooks/useMapMarkers';
import { useMapHeatmap } from './hooks/useMapHeatmap';
import { useMapBreadcrumbs } from './hooks/useMapBreadcrumbs';
import { useMapTrackingLines } from './hooks/useMapTrackingLines';
import { useMapAddressSearch } from './hooks/useMapAddressSearch';

// Components
import MapLayersPanel from './components/MapLayersPanel';
import MapSidebar from './components/MapSidebar';
import MapOverlays from './components/MapOverlays';
import MapMobileSheet from './components/MapMobileSheet';

// ============================================================
// Main Component
// ============================================================

export default function MapPage() {
  const isMobile = useIsMobile();
  const { addToast } = useToast();
  const { prefs: userPrefs } = useUserPreferences();
  const [mobileLayersOpen, setMobileLayersOpen] = useState(false);
  const [mobileSheetTab, setMobileSheetTab] = useState<'layers' | 'units' | 'calls'>('layers');

  // Data state
  const [units, setUnits] = useState<Unit[]>([]);
  const [calls, setCalls] = useState<ActiveCall[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Layer visibility
  const [layers, setLayers] = useState({ units: true, incidents: true, properties: true });

  // Layers panel (left) collapsed/expanded
  const [layersPanelOpen, setLayersPanelOpen] = useState(true);

  // GPS History panel
  const [historyPanelOpen, setHistoryPanelOpen] = useState(false);

  // Sidebar state
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarTab, setSidebarTab] = usePersistedTab('rmpg_map_sidebar', 'units', ['units', 'calls'] as const);

  // Map style
  const serverDefaultStyle = (userPrefs?.default_map_style || 'dark') as MapStyleId;
  const [mapStyle, setMapStyle] = usePersistedTab('rmpg_map_style', serverDefaultStyle, ['dark', 'satellite', 'hybrid', 'streets', 'terrain', 'night_nav'] as const);

  // Search (sidebar)
  const [searchQuery, setSearchQuery] = useState('');

  // GPS own-position
  const gps = useGpsTracking();

  // WebSocket
  const { isConnected, subscribe } = useWebSocket();

  // District enrichment data for beat map coloring
  const [beatDistrictMap, setBeatDistrictMap] = useState<Map<string, Map<string, BeatDistrictEntry>> | undefined>(undefined);
  const [districtSections, setDistrictSections] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    let cancelled = false;
    apiFetch<any[]>('/dispatch/districts').then((districts) => {
      if (cancelled || !districts) return;
      const map = new Map<string, Map<string, BeatDistrictEntry>>();
      const sectionSet = new Map<string, string>();
      for (const d of districts) {
        if (!map.has(d.zone_id)) map.set(d.zone_id, new Map());
        map.get(d.zone_id)!.set(d.beat_id, {
          sectionId: d.section_id,
          sectionName: d.section_name,
          zoneId: d.zone_id,
          zoneName: d.zone_name,
          beatId: d.beat_id,
          beatName: d.beat_name,
          beatDescriptor: d.beat_descriptor || '',
          dispatchCode: d.dispatch_code,
        });
        sectionSet.set(d.section_id, d.section_name);
      }
      setBeatDistrictMap(map);
      setDistrictSections(Array.from(sectionSet.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.id.localeCompare(b.id)));
    }).catch((err) => { console.warn('[MapPage] fetch districts failed:', err); });
    return () => { cancelled = true; };
  }, []);

  // ============================================================
  // Map Init Hook
  // ============================================================

  const {
    mapRef,
    mapInstanceRef,
    infoWindowRef,
    markersRef,
    useAdvancedMarkersRef,
    mapLoaded,
    mapError,
    tilesStalled,
    retryingGmaps,
    isAuthError,
    showOfflineFallback,
    setMapRetry,
    setRetryingGmaps,
  } = useMapInit(mapStyle);

  // Routing
  const { activeRoute, routeLoading, showRoute, clearRoute, updateOrigin } = useMapRouting({ map: mapInstanceRef.current });

  // Shift planning
  const shiftPlanning = useShiftPlanning();

  // GeoJSON spatial layers
  const { layerStates: geoLayerStates, toggleGeoLayer, ensureLayerLoaded, configs: geoConfigs } = useGeoJsonLayers({
    map: mapInstanceRef.current,
    infoWindow: infoWindowRef.current,
    selectionMode: shiftPlanning.selectionMode,
    onFeatureClick: shiftPlanning.handleFeatureClick,
    selectedFeatures: shiftPlanning.selectedAreas,
    assignedFeatures: shiftPlanning.assignedFeatures,
    beatDistrictMap,
  });

  // Event planning overlays
  const eventPlanning = useEventPlanning({
    map: mapInstanceRef.current,
    infoWindow: infoWindowRef.current,
  });

  // ============================================================
  // Data Fetching
  // ============================================================

  const fetchUnits = useCallback(async () => {
    try {
      const data = await apiFetch<Unit[]>('/dispatch/units');
      setUnits(data || []);
    } catch (err) {
      console.error('Error fetching units:', err);
      setError('Failed to load units');
    }
  }, []);

  const fetchCalls = useCallback(async () => {
    try {
      const data = await apiFetch<ActiveCall[]>('/dispatch/queue');
      setCalls(data || []);
    } catch (err) {
      console.error('Error fetching calls:', err);
      setError('Failed to load active calls');
    }
  }, []);

  const fetchProperties = useCallback(async () => {
    try {
      const data = await apiFetch<Property[]>('/records/properties');
      setProperties(data || []);
    } catch (err) {
      console.error('Error fetching properties:', err);
      setError('Failed to load properties');
    }
  }, []);

  const fetchAllData = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) { setLoading(true); setError(null); }
    await Promise.all([fetchUnits(), fetchCalls(), fetchProperties()]);
    if (!options?.silent) setLoading(false);
  }, [fetchUnits, fetchCalls, fetchProperties]);

  // Initial Load & Auto-Refresh
  useEffect(() => {
    fetchAllData();
    const interval = setInterval(() => { fetchAllData({ silent: true }); }, 30000);
    return () => clearInterval(interval);
  }, [fetchAllData]);

  // Live sync
  const silentRefreshMap = useCallback(() => fetchAllData({ silent: true }), [fetchAllData]);
  useLiveSync('dispatch', silentRefreshMap);

  // ============================================================
  // WebSocket Subscriptions
  // ============================================================

  useEffect(() => {
    const unsubscribeUnit = subscribe('unit_update', (msg: any) => {
      const data = msg.data || msg;
      if (data?.action === 'unit_deleted' && data.unit_id) {
        setUnits((prev) => prev.filter((u) => u.id !== data.unit_id));
        return;
      }
      if (data?.unit) {
        setUnits((prev) => {
          const index = prev.findIndex((u) => u.id === data.unit.id);
          if (index >= 0) {
            const updated = [...prev];
            updated[index] = { ...updated[index], ...data.unit };
            return updated;
          }
          return [...prev, data.unit];
        });
      }
    });

    const unsubscribeCall = subscribe('dispatch_update', (msg: any) => {
      const evtData = msg.data || msg;
      if (evtData && evtData.call) {
        setCalls((prev) => {
          const index = prev.findIndex((c) => c.id === evtData.call.id);
          if (index >= 0) {
            const updated = [...prev];
            updated[index] = { ...updated[index], ...evtData.call };
            if (evtData.call.status === 'closed' || evtData.call.status === 'completed') {
              return updated.filter((c) => c.id !== evtData.call.id);
            }
            return updated;
          }
          if (evtData.call.status !== 'closed' && evtData.call.status !== 'completed') {
            return [...prev, evtData.call];
          }
          return prev;
        });
      }
    });

    return () => { unsubscribeUnit(); unsubscribeCall(); };
  }, [subscribe]);

  // ============================================================
  // Map Feature Hooks
  // ============================================================

  const { createMarker, removeMarker } = useMapMarkers({
    mapInstanceRef,
    markersRef,
    infoWindowRef,
    useAdvancedMarkersRef,
    mapLoaded,
    layers,
    units,
    calls,
    properties,
    showRoute,
    gps,
  });

  const heatmap = useMapHeatmap({ mapInstanceRef, mapLoaded });

  const breadcrumbs = useMapBreadcrumbs({ mapInstanceRef, mapLoaded });

  const trackingLines = useMapTrackingLines({ mapInstanceRef, mapLoaded, units, calls });

  const addressSearch = useMapAddressSearch({ mapInstanceRef, createMarker, removeMarker });

  // Update Route When Routed Unit GPS Changes
  useEffect(() => {
    if (!activeRoute) return;
    const routedUnit = units.find(u => u.call_sign === activeRoute.unitCallSign);
    if (routedUnit?.latitude != null && routedUnit?.longitude != null) {
      updateOrigin(routedUnit.latitude, routedUnit.longitude);
    }
  }, [activeRoute, units, updateOrigin]);

  // ============================================================
  // Helpers
  // ============================================================

  const toggleLayer = (layer: keyof typeof layers) => {
    setLayers((prev) => ({ ...prev, [layer]: !prev[layer] }));
  };

  const panTo = (lat: number, lng: number) => {
    mapInstanceRef.current?.panTo({ lat, lng });
    mapInstanceRef.current?.setZoom(16);
  };

  // Quick call status change from map sidebar
  const handleCallStatusChange = useCallback(async (callId: string, newStatus: string) => {
    try {
      await apiFetch(`/dispatch/calls/${callId}/status`, {
        method: 'POST',
        body: JSON.stringify({ status: newStatus }),
      });
      await Promise.all([fetchCalls(), fetchUnits()]);
    } catch (err) {
      console.error('Failed to update call status from map:', err);
      addToast('Failed to update call status', 'error');
    }
  }, [fetchCalls, fetchUnits, addToast]);

  // ============================================================
  // Derived Counts
  // ============================================================

  const unitsWithCoords = units.filter(u => u.latitude != null && u.longitude != null);
  const callsWithCoords = calls.filter(c => c.latitude != null && c.longitude != null);
  const propertiesWithCoords = properties.filter(p => p.latitude != null && p.longitude != null);

  const unitsByStatus = units.reduce((acc, u) => {
    acc[u.status] = (acc[u.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const callsByPriority = calls.reduce((acc, c) => {
    acc[c.priority] = (acc[c.priority] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const filteredUnits = units.filter(u => {
    if (u.status === 'off_duty') return false;
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return u.call_sign.toLowerCase().includes(q) || u.officer_name.toLowerCase().includes(q);
  });

  const filteredCalls = calls.filter(c => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return c.call_number.toLowerCase().includes(q) || c.incident_type.toLowerCase().includes(q) || c.location_address.toLowerCase().includes(q);
  });

  // ============================================================
  // Render
  // ============================================================

  return (
    <div className={`relative h-full flex ${isMobile ? 'overflow-hidden' : ''}`}>
      {/* Map Container */}
      <div className="flex-1 relative" style={isMobile ? { flex: 1, minHeight: 0 } : undefined}>
        <div ref={mapRef} className="absolute inset-0 bg-surface-deep" />

        {/* Tile stall badge */}
        {mapLoaded && tilesStalled && (
          <div
            className={`absolute left-3 z-[10] flex items-center gap-2 px-3 py-2 ${isMobile ? 'top-16' : 'top-12'}`}
            style={{
              background: 'rgba(6,12,20,0.95)',
              border: '1px solid #f59e0b40',
              backdropFilter: 'blur(4px)',
              borderRadius: 2,
            }}
          >
            <Loader2 style={{ width: 14, height: 14, color: '#f59e0b' }} className="animate-spin" />
            <div className="flex flex-col">
              <span className="text-[10px] text-amber-400 font-bold uppercase tracking-wider font-mono leading-none">
                CACHED MAP
              </span>
              <span className="text-[8px] text-gray-500 font-mono leading-none mt-0.5">
                Using offline tiles · Map fully interactive
              </span>
            </div>
            <button
              onClick={() => {
                const map = mapInstanceRef.current;
                if (map) {
                  const center = map.getCenter();
                  if (center) {
                    map.panTo({ lat: center.lat() + 0.0001, lng: center.lng() });
                    setTimeout(() => map.panTo(center), 200);
                  }
                }
              }}
              className="ml-1 px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-blue-400 hover:text-white hover:bg-brand-600 transition-colors"
              style={{ borderRadius: 2 }}
            >
              Retry
            </button>
          </div>
        )}

        {/* RMPG Brand Watermark */}
        <div className={`absolute left-2 z-10 pointer-events-none opacity-40 ${isMobile ? 'top-14' : 'top-2'}`}>
          <RmpgLogo height={20} iconOnly />
        </div>

        {/* GPS History Playback Panel */}
        {!isMobile && (
          <GpsBreadcrumbPanel
            map={mapInstanceRef.current}
            mapLoaded={mapLoaded}
            isOpen={historyPanelOpen}
            onToggle={() => setHistoryPanelOpen(!historyPanelOpen)}
          />
        )}

        {/* Offline fallback */}
        {showOfflineFallback && (
          <OfflineMapFallback
            className="absolute inset-0 z-[2000]"
            selfPosition={
              gps.isTracking && gps.latitude != null && gps.longitude != null
                ? { lat: gps.latitude, lng: gps.longitude, accuracy: gps.accuracy ?? undefined, heading: gps.heading ?? undefined }
                : null
            }
            unitPositions={units
              .filter(u => u.latitude != null && u.longitude != null)
              .map(u => ({
                call_sign: u.call_sign,
                lat: u.latitude!,
                lng: u.longitude!,
                status: u.status,
              }))}
            activeCalls={calls.filter(c => c.latitude != null && c.longitude != null)}
            properties={properties
              .filter(p => p.latitude != null && p.longitude != null)
              .map(p => ({
                id: p.id,
                name: p.name,
                lat: p.latitude!,
                lng: p.longitude!,
                address: p.address,
                client_name: p.client_name || undefined,
              }))}
            onRetry={() => {
              setRetryingGmaps(true);
              setMapRetry((n) => n + 1);
              setTimeout(() => setRetryingGmaps(false), 5000);
            }}
            retrying={retryingGmaps}
          />
        )}

        {/* API key / auth error dialog */}
        {isAuthError && (
          <div className="absolute inset-0 z-[2000] flex items-center justify-center bg-black/80 backdrop-blur-sm">
            <div className="bg-surface-overlay/95 border border-red-600 p-8 shadow-xl max-w-lg text-center" style={{ borderRadius: 2 }}>
              <AlertTriangle className="w-8 h-8 text-red-400 mx-auto mb-3" />
              <h3 className="text-white text-sm font-bold mb-2">Map Configuration Required</h3>
              <pre className="text-rmpg-300 text-xs leading-relaxed mb-4 whitespace-pre-wrap text-left">{mapError}</pre>
              <div className="bg-surface-deep border border-rmpg-600 p-3 text-left mb-4" style={{ borderRadius: 2 }}>
                <p className="text-[10px] text-rmpg-400 font-mono leading-relaxed">
                  <span className="text-amber-400 font-bold">Checklist:</span><br/>
                  1. Go to <span className="text-blue-400">console.cloud.google.com/apis/library</span><br/>
                  2. Enable <span className="text-amber-400">Maps JavaScript API</span><br/>
                  3. Enable <span className="text-amber-400">Places API (New)</span><br/>
                  4. Go to <span className="text-blue-400">Billing</span> → ensure billing is active<br/>
                  5. Go to <span className="text-blue-400">Credentials</span> → check key restrictions<br/>
                  6. Add key to <span className="text-brand-400">client/.env</span>:<br/>
                  <span className="text-green-400 ml-2">VITE_GOOGLE_MAPS_API_KEY=your_key</span><br/>
                  7. Restart the dev server
                </p>
              </div>
              <div className="flex gap-3 justify-center">
                <button
                  onClick={() => setMapRetry((n) => n + 1)}
                  className="px-4 py-1.5 bg-brand-600 hover:bg-brand-500 text-white text-xs font-bold uppercase tracking-wider transition-colors"
                  style={{ borderRadius: 2 }}
                >
                  Retry
                </button>
                <button
                  onClick={() => window.location.reload()}
                  className="px-4 py-1.5 bg-surface-deep hover:bg-surface-overlay text-rmpg-300 text-xs font-bold uppercase tracking-wider border border-rmpg-600 transition-colors"
                  style={{ borderRadius: 2 }}
                >
                  Hard Reload
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Loading Overlay */}
        {loading && !mapError && (
          <div className="absolute inset-0 z-[2000] flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-surface-overlay/95 border border-rmpg-600 p-6 shadow-xl" style={{ borderRadius: 2 }}>
              <div className="flex items-center gap-3">
                <div className="w-5 h-5 border-2 border-brand-400 border-t-transparent rounded-full animate-spin" />
                <span className="text-white text-sm font-mono">Initializing tactical map...</span>
              </div>
            </div>
          </div>
        )}

        {/* Error Banner */}
        {error && !loading && (
          <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-[1000]">
            <div className="bg-red-900/95 border border-red-600 px-4 py-2 backdrop-blur-sm shadow-xl" style={{ borderRadius: 2 }}>
              <span className="text-white text-sm">{error}</span>
            </div>
          </div>
        )}

        {/* Mobile Address Search Bar */}
        {isMobile && (
          <div className="absolute top-2 left-2 right-2 z-[1001]">
            <div className="relative">
              <div className="relative flex items-center">
                <Search className="absolute left-3 w-4 h-4 text-white/50 pointer-events-none" />
                <input
                  type="text"
                  value={addressSearch.addressSearch}
                  onChange={(e) => addressSearch.handleAddressSearch(e.target.value)}
                  onFocus={() => addressSearch.addressResults.length > 0 && addressSearch.setShowAddressResults(true)}
                  onBlur={() => setTimeout(() => addressSearch.setShowAddressResults(false), 200)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') addressSearch.clearAddressSearch();
                  }}
                  placeholder="Search address..."
                  className="w-full text-[13px] pl-10 pr-10 bg-black/60 border border-white/15 text-white placeholder:text-white/40 focus:border-white/40 focus:bg-black/70 focus:outline-none backdrop-blur-md shadow-lg font-mono"
                  style={{ borderRadius: 2, height: 44 }}
                />
                {addressSearch.addressSearch && (
                  <button onClick={addressSearch.clearAddressSearch} className="absolute right-3 text-white/40 hover:text-white/80 p-1">
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
              {addressSearch.showAddressResults && addressSearch.addressResults.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-black/90 border border-white/15 shadow-2xl backdrop-blur-md overflow-hidden" style={{ borderRadius: 2 }}>
                  {addressSearch.addressResults.map((r) => (
                    <button
                      key={r.place_id}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => addressSearch.handleAddressSelect(r.place_id, r.description)}
                      className="w-full text-left px-4 py-3 text-[12px] text-white/80 hover:bg-white/10 hover:text-white transition-colors border-b border-white/10 last:border-0 flex items-center gap-2"
                      style={{ minHeight: 44 }}
                    >
                      <MapPin className="w-4 h-4 text-blue-400 shrink-0" />
                      <span className="truncate">{r.description}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Desktop Address Search Bar + Zoom Controls */}
        {!isMobile && (
          <div
            className="absolute top-2 z-[1001] flex items-start gap-1.5"
            style={{ right: sidebarOpen ? 'calc(clamp(220px, 20vw, 300px) + 12px)' : 52 }}
          >
            <div className="relative">
              <div className="relative flex items-center">
                <Search className="absolute left-2.5 w-3.5 h-3.5 text-rmpg-500 pointer-events-none" />
                <input
                  type="text"
                  value={addressSearch.addressSearch}
                  onChange={(e) => addressSearch.handleAddressSearch(e.target.value)}
                  onFocus={() => addressSearch.addressResults.length > 0 && addressSearch.setShowAddressResults(true)}
                  onBlur={() => setTimeout(() => addressSearch.setShowAddressResults(false), 200)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') addressSearch.clearAddressSearch();
                  }}
                  placeholder="Search address..."
                  className={`text-[11px] pl-8 pr-8 py-1.5 w-[240px] focus:outline-none backdrop-blur-md shadow-lg font-mono transition-colors ${
                    isLightMapStyle(mapStyle)
                      ? 'bg-white/80 border border-gray-300 text-gray-900 placeholder:text-gray-400 focus:border-blue-400 focus:bg-white/90'
                      : 'bg-black/30 border border-white/15 text-white placeholder:text-white/40 focus:border-white/40 focus:bg-black/50'
                  }`}
                  style={{ borderRadius: 2 }}
                />
                {addressSearch.addressSearch && (
                  <button onClick={addressSearch.clearAddressSearch} className="absolute right-2 text-white/40 hover:text-white/80">
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
              {addressSearch.showAddressResults && addressSearch.addressResults.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-black/80 border border-white/15 shadow-2xl backdrop-blur-md overflow-hidden" style={{ borderRadius: 2 }}>
                  {addressSearch.addressResults.map((r) => (
                    <button
                      key={r.place_id}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => addressSearch.handleAddressSelect(r.place_id, r.description)}
                      className="w-full text-left px-3 py-2 text-[10px] text-rmpg-200 hover:bg-rmpg-700/50 hover:text-white transition-colors border-b border-rmpg-700 last:border-0 flex items-center gap-2"
                    >
                      <MapPin className="w-3 h-3 text-blue-400 shrink-0" />
                      <span className="truncate">{r.description}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {/* Zoom +/- controls */}
            <div className="flex flex-col" style={{ borderRadius: 2, overflow: 'hidden' }}>
              <button
                onClick={() => {
                  const map = mapInstanceRef.current;
                  if (map) map.setZoom((map.getZoom() || 12) + 1);
                }}
                className={`border border-b-0 backdrop-blur-md px-2 py-1.5 transition-colors ${
                  isLightMapStyle(mapStyle) ? 'bg-white/80 border-gray-300 hover:bg-white/95' : 'bg-black/30 border-white/15 hover:bg-black/50'
                }`}
                style={{ borderRadius: '2px 2px 0 0' }}
                title="Zoom in"
              >
                <Plus className={`w-3.5 h-3.5 ${isLightMapStyle(mapStyle) ? 'text-gray-600' : 'text-white/70'}`} />
              </button>
              <button
                onClick={() => {
                  const map = mapInstanceRef.current;
                  if (map) map.setZoom((map.getZoom() || 12) - 1);
                }}
                className={`border backdrop-blur-md px-2 py-1.5 transition-colors ${
                  isLightMapStyle(mapStyle) ? 'bg-white/80 border-gray-300 hover:bg-white/95' : 'bg-black/30 border-white/15 hover:bg-black/50'
                }`}
                style={{ borderRadius: '0 0 2px 2px' }}
                title="Zoom out"
              >
                <Minus className={`w-3.5 h-3.5 ${isLightMapStyle(mapStyle) ? 'text-gray-600' : 'text-white/70'}`} />
              </button>
            </div>
          </div>
        )}

        {/* Layer Controls Panel - Top Left (Desktop only) */}
        {!isMobile && <div className="absolute top-4 left-4 z-[1000]">
          <MapLayersPanel
            isConnected={isConnected}
            layersPanelOpen={layersPanelOpen}
            setLayersPanelOpen={setLayersPanelOpen}
            layers={layers}
            toggleLayer={toggleLayer}
            unitsWithCoords={unitsWithCoords}
            callsWithCoords={callsWithCoords}
            propertiesWithCoords={propertiesWithCoords}
            showHeatmap={heatmap.showHeatmap}
            setShowHeatmap={heatmap.setShowHeatmap}
            heatmapData={heatmap.heatmapData}
            heatmapDays={heatmap.heatmapDays}
            setHeatmapDays={heatmap.setHeatmapDays}
            heatmapMode={heatmap.heatmapMode}
            setHeatmapMode={heatmap.setHeatmapMode}
            heatmapTypeFilter={heatmap.heatmapTypeFilter}
            setHeatmapTypeFilter={heatmap.setHeatmapTypeFilter}
            heatmapTypes={heatmap.heatmapTypes}
            showTrackingLines={trackingLines.showTrackingLines}
            setShowTrackingLines={trackingLines.setShowTrackingLines}
            showBreadcrumbs={breadcrumbs.showBreadcrumbs}
            setShowBreadcrumbs={breadcrumbs.setShowBreadcrumbs}
            breadcrumbHours={breadcrumbs.breadcrumbHours}
            setBreadcrumbHours={breadcrumbs.setBreadcrumbHours}
            exportingPdf={breadcrumbs.exportingPdf}
            setExportingPdf={breadcrumbs.setExportingPdf}
            breadcrumbColorMode={breadcrumbs.breadcrumbColorMode}
            setBreadcrumbColorMode={breadcrumbs.setBreadcrumbColorMode}
            playbackTrails={breadcrumbs.playbackTrails}
            playbackUnit={breadcrumbs.playbackUnit}
            setPlaybackUnit={breadcrumbs.setPlaybackUnit}
            playbackIdx={breadcrumbs.playbackIdx}
            setPlaybackIdx={breadcrumbs.setPlaybackIdx}
            isPlaying={breadcrumbs.isPlaying}
            setIsPlaying={breadcrumbs.setIsPlaying}
            playbackSpeed={breadcrumbs.playbackSpeed}
            setPlaybackSpeed={breadcrumbs.setPlaybackSpeed}
            playbackAnimRef={breadcrumbs.playbackAnimRef}
            playbackMarkerRef={breadcrumbs.playbackMarkerRef}
            mapStyle={mapStyle}
            setMapStyle={setMapStyle}
            geoLayerStates={geoLayerStates}
            geoConfigs={geoConfigs}
            toggleGeoLayer={toggleGeoLayer}
            ensureLayerLoaded={ensureLayerLoaded}
            districtSections={districtSections}
            beatDistrictMap={beatDistrictMap}
            shiftPlanning={shiftPlanning}
            eventPlanning={eventPlanning}
          />
        </div>}

        {/* Floating overlays */}
        <MapOverlays
          mapInstanceRef={mapInstanceRef}
          mapStyle={mapStyle}
          isConnected={isConnected}
          sidebarOpen={sidebarOpen}
          layersPanelOpen={layersPanelOpen}
          isMobile={isMobile}
          unitsWithCoords={unitsWithCoords}
          callsWithCoords={callsWithCoords}
          unitsByStatus={unitsByStatus}
          callsByPriority={callsByPriority}
          showTrackingLines={trackingLines.showTrackingLines}
          trackingLinesRef={trackingLines.trackingLinesRef}
          activeRoute={activeRoute}
          routeLoading={routeLoading}
          clearRoute={clearRoute}
          gps={gps}
        />
      </div>

      {/* Right Sidebar (Desktop only) */}
      {!isMobile && (
        <MapSidebar
          sidebarOpen={sidebarOpen}
          setSidebarOpen={setSidebarOpen}
          sidebarTab={sidebarTab}
          setSidebarTab={setSidebarTab}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          filteredUnits={filteredUnits}
          filteredCalls={filteredCalls}
          unitsByStatus={unitsByStatus}
          callsByPriority={callsByPriority}
          panTo={panTo}
          handleCallStatusChange={handleCallStatusChange}
        />
      )}

      {/* Mobile: Floating layer button + bottom sheet */}
      {isMobile && (
        <MapMobileSheet
          mobileLayersOpen={mobileLayersOpen}
          setMobileLayersOpen={setMobileLayersOpen}
          mobileSheetTab={mobileSheetTab}
          setMobileSheetTab={setMobileSheetTab}
          layers={layers}
          toggleLayer={toggleLayer}
          showHeatmap={heatmap.showHeatmap}
          setShowHeatmap={heatmap.setShowHeatmap}
          showBreadcrumbs={breadcrumbs.showBreadcrumbs}
          setShowBreadcrumbs={breadcrumbs.setShowBreadcrumbs}
          breadcrumbHours={breadcrumbs.breadcrumbHours}
          setBreadcrumbHours={breadcrumbs.setBreadcrumbHours}
          breadcrumbColorMode={breadcrumbs.breadcrumbColorMode}
          setBreadcrumbColorMode={breadcrumbs.setBreadcrumbColorMode}
          mapStyle={mapStyle}
          setMapStyle={setMapStyle}
          filteredUnits={filteredUnits}
          filteredCalls={filteredCalls}
          panTo={panTo}
          gps={gps}
          mapInstanceRef={mapInstanceRef}
        />
      )}
    </div>
  );
}
