import React from 'react';
import { Siren, Shield, Navigation2, Crosshair, Plus, Minus } from 'lucide-react';
import type { UnitStatus } from '../../../types';
import { UNIT_STATUS_COLORS, UNIT_STATUS_LABELS, PRIORITY_COLORS, isLightMapStyle, isSatelliteStyle } from '../utils/mapConstants';
import type { MapStyleId } from '../utils/mapConstants';
import MapExportMenu from './MapExportMenu';

interface MapOverlaysProps {
  mapInstanceRef: React.MutableRefObject<google.maps.Map | null>;
  mapStyle: MapStyleId;
  isConnected: boolean;
  sidebarOpen: boolean;
  layersPanelOpen: boolean;
  isMobile: boolean;

  // Counts
  unitsWithCoords: { id: string; call_sign: string; latitude: number; longitude: number; status: string }[];
  callsWithCoords: { id: string; call_number: string; latitude: number; longitude: number; priority: string }[];
  unitsByStatus: Record<string, number>;
  callsByPriority: Record<string, number>;

  // Tracking lines
  showTrackingLines: boolean;
  trackingLinesRef: React.MutableRefObject<google.maps.Polyline[]>;

  // Route (routing result from useMapRouting hook)
  activeRoute: { unitCallSign: string; callNumber: string; eta: string; distance: string } | null;
  routeLoading: boolean;
  clearRoute: () => void;

  // GPS
  gps: {
    isTracking: boolean;
    latitude: number | null;
    longitude: number | null;
    unitCallSign?: string | null;
  };

  // Export
  onScreenshot: () => Promise<boolean>;
  onPrint: () => void;
}

export default function MapOverlays({
  mapInstanceRef, mapStyle, isConnected, sidebarOpen, layersPanelOpen, isMobile,
  unitsWithCoords, callsWithCoords, unitsByStatus, callsByPriority,
  showTrackingLines, trackingLinesRef,
  activeRoute, routeLoading, clearRoute,
  gps,
  onScreenshot, onPrint,
}: MapOverlaysProps) {
  return (
    <>
      {/* Status Legend - Bottom Left (desktop only) */}
      {!isMobile && <div className="absolute bottom-2 left-2 z-[1000]">
        <div
          className="backdrop-blur-md shadow-xl transition-all duration-200"
          role="region"
          aria-label="Map legend"
          style={{
            borderRadius: 2,
            background: isLightMapStyle(mapStyle) ? 'rgba(255,255,255,0.85)' : isSatelliteStyle(mapStyle) ? 'rgba(6,12,20,0.88)' : 'rgba(6,12,20,0.92)',
            border: isLightMapStyle(mapStyle) ? '1px solid rgba(0,0,0,0.12)' : '1px solid rgba(30,48,72,0.5)',
            padding: '4px 8px',
          }}
        >
          <div className="flex items-center gap-2.5">
            {(Object.entries(UNIT_STATUS_COLORS) as [UnitStatus, string][])
              .filter(([k]) => k !== 'off_duty')
              .map(([status, color]) => (
                <div key={status} className="flex items-center gap-1">
                  <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color, boxShadow: `0 0 5px ${color}80` }} />
                  <span className={`text-[8px] font-mono font-bold ${isLightMapStyle(mapStyle) ? 'text-gray-600' : 'text-rmpg-300'}`}>
                    {UNIT_STATUS_LABELS[status as UnitStatus]}
                  </span>
                </div>
              ))}
            <div className={`w-px h-3 ${isLightMapStyle(mapStyle) ? 'bg-gray-300' : 'bg-rmpg-600'}`} />
            {(['P1', 'P2', 'P3', 'P4'] as const).map(p => (
              <div key={p} className="flex items-center gap-0.5">
                <div className="w-1.5 h-1.5 rounded-sm shrink-0" style={{ backgroundColor: PRIORITY_COLORS[p] }} />
                <span className={`text-[7px] font-mono font-bold ${isLightMapStyle(mapStyle) ? 'text-gray-500' : 'text-rmpg-400'}`}>{p}</span>
              </div>
            ))}
          </div>
        </div>
      </div>}

      {/* Stats Bar - Top Left (after layers panel, desktop only) */}
      {!isMobile && <div
        className="absolute top-2 z-[1000] transition-all duration-200 ease-out"
        style={{ left: layersPanelOpen ? 'calc(clamp(160px, 14vw, 200px) + 24px)' : 52 }}
      >
        <div
          className="backdrop-blur-md shadow-md transition-all duration-200"
          role="status"
          aria-label="Map statistics"
          style={{
            borderRadius: 2,
            background: isLightMapStyle(mapStyle) ? 'rgba(255,255,255,0.88)' : isSatelliteStyle(mapStyle) ? 'rgba(6,12,20,0.92)' : 'rgba(6,12,20,0.95)',
            border: isLightMapStyle(mapStyle) ? '1px solid rgba(0,0,0,0.15)' : '1px solid rgba(30,48,72,0.6)',
          }}
        >
          <div className="flex items-center gap-0.5 px-1.5 py-1">
            {/* #9: Connection status LED with glow effect */}
            <div className="flex items-center gap-1 px-2 py-0.5" style={{ borderRight: isLightMapStyle(mapStyle) ? '1px solid rgba(0,0,0,0.1)' : '1px solid #1e3048' }}>
              <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} style={{ boxShadow: isConnected ? '0 0 6px #22c55e80' : '0 0 6px #ef444480' }} />
              <span className={`text-[9px] font-mono font-black tracking-wider ${isConnected ? (isLightMapStyle(mapStyle) ? 'text-green-700' : 'text-green-400') : 'text-red-400'}`}>
                {isConnected ? 'LIVE' : 'DISC'}
              </span>
            </div>

            <div className="flex items-center gap-1 px-2 py-0.5" style={{ borderRight: isLightMapStyle(mapStyle) ? '1px solid rgba(0,0,0,0.1)' : '1px solid #1e3048' }}>
              <Siren className={`w-3 h-3 shrink-0 ${isLightMapStyle(mapStyle) ? 'text-red-600' : 'text-red-400'}`} />
              {/* #10: Tabular-nums for monospaced number alignment in stats bar */}
              <span className={`text-[13px] font-mono font-black tabular-nums ${isLightMapStyle(mapStyle) ? 'text-gray-900' : 'text-white'}`}>{callsWithCoords.length}</span>
              {callsByPriority['P1'] ? <span className="text-[8px] font-mono font-bold tabular-nums text-red-500 bg-red-500/15 px-1 rounded-sm">P1:{callsByPriority['P1']}</span> : null}
              {callsByPriority['P2'] ? <span className="text-[8px] font-mono font-bold tabular-nums text-amber-500 bg-amber-500/15 px-1 rounded-sm">P2:{callsByPriority['P2']}</span> : null}
            </div>

            <div className="flex items-center gap-1 px-2 py-0.5">
              <Shield className={`w-3 h-3 shrink-0 ${isLightMapStyle(mapStyle) ? 'text-green-600' : 'text-green-400'}`} />
              <span className={`text-[13px] font-mono font-black tabular-nums ${isLightMapStyle(mapStyle) ? 'text-gray-900' : 'text-white'}`}>{unitsWithCoords.length}</span>
              <div className="flex items-center gap-1.5 ml-1">
                {([
                  { key: 'available', label: 'AVL', color: '#22c55e' },
                  { key: 'dispatched', label: 'DSP', color: '#f59e0b' },
                  { key: 'enroute', label: 'ENR', color: '#888888' },
                  { key: 'onscene', label: 'ONS', color: '#a855f7' },
                ] as const).filter(s => (unitsByStatus[s.key] || 0) > 0).map(({ key, label, color }) => (
                  <span key={key} className="text-[8px] font-mono font-bold px-1 rounded-sm" style={{ color, background: color + '15' }}>
                    {label}:{unitsByStatus[key] || 0}
                  </span>
                ))}
              </div>
            </div>

            {showTrackingLines && trackingLinesRef.current.length > 0 && (
              <div className="flex items-center gap-1 px-1.5">
                <Navigation2 className="w-2.5 h-2.5 text-cyan-400" />
                <span className="text-cyan-400 text-[8px] font-mono font-bold">{trackingLinesRef.current.length}</span>
              </div>
            )}
          </div>
        </div>
      </div>}

      {/* Route Info Panel */}
      {activeRoute && (
        <div
          className="absolute z-[1000] backdrop-blur-md transition-all duration-200 ease-out shadow-lg"
          role="region"
          aria-label="Active route information"
          style={{
            ...(isMobile
              ? { top: 56, left: 8, right: 8 }
              : { bottom: 48, left: 16, minWidth: 200 }),
            background: isLightMapStyle(mapStyle) ? 'rgba(255,255,255,0.92)' : 'rgba(6,12,20,0.95)',
            border: isLightMapStyle(mapStyle) ? '1px solid rgba(59,130,246,0.3)' : '1px solid #3b82f650',
            padding: '8px 14px',
            fontFamily: "'JetBrains Mono', 'Courier New', monospace",
            borderRadius: 2,
            boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontSize: 10, color: '#888888', fontWeight: 900, letterSpacing: '0.05em' }}>
              {activeRoute.unitCallSign} → {activeRoute.callNumber}
            </span>
            <button type="button"
              onClick={clearRoute}
              className="hover:bg-[#1a2636] transition-all duration-150 active:scale-[0.97] rounded-sm"
              style={{ background: 'none', border: 'none', color: '#666666', cursor: 'pointer', fontSize: 12, padding: '2px 4px 2px 8px' }}
              aria-label="Clear route"
              title="Clear route"
            >
              ✕
            </button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 16, color: isLightMapStyle(mapStyle) ? '#111827' : '#fff', fontWeight: 900 }}>{activeRoute.eta}</span>
            <span style={{ fontSize: 11, color: isLightMapStyle(mapStyle) ? '#666666' : '#999999' }}>{activeRoute.distance}</span>
          </div>
          {routeLoading && (
            <div style={{ fontSize: 8, color: '#f59e0b', marginTop: 4 }}>Updating route…</div>
          )}
        </div>
      )}

      {/* Bottom Right Buttons (Recenter + GPS Locate) */}
      <div
        className="absolute z-[1000] flex flex-col gap-2"
        style={isMobile
          ? { bottom: 'calc(88px + env(safe-area-inset-bottom))', right: 16 }
          : { bottom: 16, right: 16, marginRight: sidebarOpen ? 'clamp(200px, 20vw, 280px)' : 36 }
        }
      >
        {isMobile && (
          <div
            className="flex flex-col overflow-hidden"
            style={{
              borderRadius: 2,
              background: 'rgba(13, 21, 32, 0.9)',
              border: '1px solid #1e3048',
            }}
          >
            <button type="button"
              onClick={() => {
                const map = mapInstanceRef.current;
                if (map) map.setZoom((map.getZoom() || 12) + 1);
              }}
              className="flex items-center justify-center transition-all duration-150 hover:bg-white/10 active:bg-white/20 active:scale-[0.97]"
              style={{ width: 48, height: 48, borderBottom: '1px solid #1e3048' }}
              aria-label="Zoom in"
              title="Zoom in"
            >
              {/* #11: Consistent zoom button icon weight */}
              <Plus className="w-5 h-5 text-white/80" strokeWidth={2.5} />
            </button>
            <button type="button"
              onClick={() => {
                const map = mapInstanceRef.current;
                if (map) map.setZoom((map.getZoom() || 12) - 1);
              }}
              className="flex items-center justify-center transition-all duration-150 hover:bg-white/10 active:bg-white/20 active:scale-[0.97]"
              style={{ width: 48, height: 48 }}
              aria-label="Zoom out"
              title="Zoom out"
            >
              <Minus className="w-5 h-5 text-white/80" strokeWidth={2.5} />
            </button>
          </div>
        )}
        {gps.isTracking && gps.latitude != null && gps.longitude != null && (
          <button type="button"
            onClick={() => {
              if (gps.latitude != null && gps.longitude != null) {
                mapInstanceRef.current?.panTo({ lat: gps.latitude, lng: gps.longitude });
                mapInstanceRef.current?.setZoom(16);
              }
            }}
            className={`backdrop-blur-md shadow-xl transition-colors ${
              isLightMapStyle(mapStyle)
                ? 'bg-white/90 border border-blue-300 hover:bg-blue-50'
                : 'bg-surface-deep/95 border border-blue-500/50 hover:bg-blue-900/30'
            }`}
            style={isMobile
              ? { borderRadius: 2, width: 48, height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center' }
              : { borderRadius: 2, padding: 10 }
            }
            title={`Center on my position${gps.unitCallSign ? ` (${gps.unitCallSign})` : ''}`}
          >
            <Navigation2 className={`${isMobile ? 'w-5 h-5' : 'w-4 h-4'} ${isLightMapStyle(mapStyle) ? 'text-blue-600' : 'text-blue-400'}`} />
          </button>
        )}
        <MapExportMenu
          mapStyle={mapStyle}
          isMobile={isMobile}
          onScreenshot={onScreenshot}
          onPrint={onPrint}
        />
        <button type="button"
          onClick={() => {
            mapInstanceRef.current?.panTo({ lat: 40.7608, lng: -111.8910 });
            mapInstanceRef.current?.setZoom(12);
          }}
          className={`backdrop-blur-md shadow-xl transition-colors ${
            isLightMapStyle(mapStyle)
              ? 'bg-white/90 border border-gray-300 hover:bg-[#1a2636]'
              : 'bg-surface-deep/95 border border-rmpg-600 hover:bg-rmpg-700/40'
          }`}
          style={isMobile
            ? { borderRadius: 2, width: 48, height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center' }
            : { borderRadius: 2, padding: 10 }
          }
          title="Reset view"
        >
          <Crosshair className={`${isMobile ? 'w-5 h-5' : 'w-4 h-4'} ${isLightMapStyle(mapStyle) ? 'text-gray-600' : 'text-rmpg-300'}`} />
        </button>
      </div>
    </>
  );
}
