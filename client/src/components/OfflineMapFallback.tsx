// ============================================================
// RMPG Flex — Offline Map Fallback (Leaflet-based)
//
// Renders when Google Maps fails to load (vehicle WiFi dead zones).
// Uses Leaflet with pre-cached CartoDB dark_matter tiles from
// /tiles/{z}/{x}/{y}.png (served by service worker from cache).
//
// Features:
//  - Full pan/zoom with touch support (greedy single-finger)
//  - GPS self-position tracking (pulsing blue dot + heading cone)
//  - Live unit markers with status colors & call_sign labels
//  - Active call markers with priority colors
//  - "Offline Mode" badge with manual + auto-retry for Google Maps
//  - Status legend for quick reference
//  - Auto-retry every 30s + on browser `online` event
//
// The tiles are pre-cached by sw.js v45 (~1,738 tiles, ~11 MB)
// covering Utah Z7-15.  When connectivity returns, MapPage will
// auto-retry Google Maps and this component unmounts.
// ============================================================

import { useEffect, useRef, useState, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { WifiOff, Navigation, RefreshCw, Signal } from 'lucide-react';
import { OFFLINE_TILE_MIN_ZOOM, OFFLINE_TILE_MAX_ZOOM } from '../utils/googleMapsLoader';

// SLC default center
const DEFAULT_CENTER: L.LatLngExpression = [40.7608, -111.8910];
const DEFAULT_ZOOM = 12;

// Auto-retry interval (ms) — try to reload Google Maps periodically
const AUTO_RETRY_INTERVAL = 30_000;

interface UnitPosition {
  call_sign: string;
  lat: number;
  lng: number;
  status?: string;
  heading?: number;
  speed?: number;
  timestamp?: string;
}

interface ActiveCall {
  id: string;
  call_number: string;
  incident_type: string;
  location_address: string;
  latitude?: number | null;
  longitude?: number | null;
  priority: string;
}

interface PropertyMarker {
  id: string;
  name: string;
  lat: number;
  lng: number;
  address?: string;
  client_name?: string;
}

interface OfflineMapFallbackProps {
  /** Current GPS position from the device */
  selfPosition?: { lat: number; lng: number; accuracy?: number; heading?: number } | null;
  /** Live unit positions from WebSocket */
  unitPositions?: UnitPosition[];
  /** Active dispatch calls with locations */
  activeCalls?: ActiveCall[];
  /** Property locations */
  properties?: PropertyMarker[];
  /** Callback when user clicks "Retry Google Maps" */
  onRetry?: () => void;
  /** Whether a retry is in progress */
  retrying?: boolean;
  /** Extra CSS class for the container */
  className?: string;
  /** Compact mode for mini-map (hides some controls) */
  compact?: boolean;
}

// Unit status → marker color (matches MapPage constants)
const STATUS_COLORS: Record<string, string> = {
  available: '#22c55e',
  dispatched: '#f59e0b',
  enroute: '#3b82f6',
  onscene: '#a855f7',
  busy: '#ef4444',
  off_duty: '#6b7280',
};

const STATUS_LABELS: Record<string, string> = {
  available: 'AVL',
  dispatched: 'DSP',
  enroute: 'ENR',
  onscene: 'ONS',
  busy: 'BSY',
  off_duty: 'OFD',
};

const PRIORITY_COLORS: Record<string, string> = {
  P1: '#ef4444',
  P2: '#f59e0b',
  P3: '#3b82f6',
  P4: '#6b7280',
};

export default function OfflineMapFallback({
  selfPosition,
  unitPositions = [],
  activeCalls = [],
  properties = [],
  onRetry,
  retrying = false,
  className = '',
  compact = false,
}: OfflineMapFallbackProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const selfMarkerRef = useRef<L.Marker | null>(null);
  const selfAccuracyRef = useRef<L.Circle | null>(null);
  const unitMarkersRef = useRef<Map<string, L.Marker>>(new Map());
  const callMarkersRef = useRef<Map<string, L.Marker>>(new Map());
  const propMarkersRef = useRef<Map<string, L.Marker>>(new Map());
  const [isReady, setIsReady] = useState(false);
  const autoRetryRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const firstPositionRef = useRef(false);

  // ── Inject CSS keyframes once ─────────────────────────────
  useEffect(() => {
    const styleId = '__rmpg_offline_map_keyframes__';
    if (document.getElementById(styleId)) return;
    const s = document.createElement('style');
    s.id = styleId;
    s.textContent = `
      @keyframes rmpg-pulse-ring {
        0%   { transform: translate(-50%, -50%) scale(1); opacity: 0.6; }
        100% { transform: translate(-50%, -50%) scale(2.5); opacity: 0; }
      }
      @keyframes rmpg-gps-glow {
        0%, 100% { box-shadow: 0 0 4px #3b82f6, 0 0 8px #3b82f680; }
        50%      { box-shadow: 0 0 8px #3b82f6, 0 0 16px #3b82f680; }
      }
    `;
    document.head.appendChild(s);
  }, []);

  // ── Auto-retry: try Google Maps every 30s + on `online` event ─
  useEffect(() => {
    if (!onRetry) return;

    // Periodic retry
    autoRetryRef.current = setInterval(() => {
      if (!retrying) onRetry();
    }, AUTO_RETRY_INTERVAL);

    // Immediate retry when device comes back online
    const onOnline = () => {
      if (!retrying) onRetry();
    };
    window.addEventListener('online', onOnline);

    return () => {
      if (autoRetryRef.current) clearInterval(autoRetryRef.current);
      window.removeEventListener('online', onOnline);
    };
  }, [onRetry, retrying]);

  // ── Initialize Leaflet map ──────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      minZoom: OFFLINE_TILE_MIN_ZOOM,
      maxZoom: OFFLINE_TILE_MAX_ZOOM,
      zoomControl: false,
      attributionControl: false,
      // Touch: single-finger drag (critical for in-vehicle use)
      dragging: true,
      touchZoom: true,
      scrollWheelZoom: true,
      doubleClickZoom: true,
      boxZoom: false,
      keyboard: true,
    });

    // Add our pre-cached offline tile layer
    L.tileLayer('/tiles/{z}/{x}/{y}.png', {
      minZoom: OFFLINE_TILE_MIN_ZOOM,
      maxZoom: OFFLINE_TILE_MAX_ZOOM,
      tileSize: 256,
      errorTileUrl: '', // Don't show broken image icons
    }).addTo(map);

    // Zoom control in bottom-right (out of the way of sidebar)
    if (!compact) {
      L.control.zoom({ position: 'bottomright' }).addTo(map);
    }

    mapRef.current = map;
    firstPositionRef.current = false;
    setIsReady(true);

    return () => {
      map.remove();
      mapRef.current = null;
      selfMarkerRef.current = null;
      selfAccuracyRef.current = null;
      unitMarkersRef.current.clear();
      callMarkersRef.current.clear();
      propMarkersRef.current.clear();
      firstPositionRef.current = false;
      setIsReady(false);
    };
  }, [compact]);

  // ── Self position (pulsing blue dot + heading cone) ───────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isReady) return;

    if (!selfPosition) {
      if (selfMarkerRef.current) {
        map.removeLayer(selfMarkerRef.current);
        selfMarkerRef.current = null;
      }
      if (selfAccuracyRef.current) {
        map.removeLayer(selfAccuracyRef.current);
        selfAccuracyRef.current = null;
      }
      return;
    }

    const latlng: L.LatLngExpression = [selfPosition.lat, selfPosition.lng];

    if (selfMarkerRef.current) {
      // Update existing marker position
      selfMarkerRef.current.setLatLng(latlng);
      // Update heading rotation on the icon
      const el = selfMarkerRef.current.getElement();
      if (el) {
        const cone = el.querySelector('.rmpg-heading-cone') as HTMLElement;
        if (cone) {
          if (selfPosition.heading != null && selfPosition.heading >= 0) {
            cone.style.display = 'block';
            cone.style.transform = `rotate(${selfPosition.heading}deg)`;
          } else {
            cone.style.display = 'none';
          }
        }
      }
      if (selfAccuracyRef.current && selfPosition.accuracy) {
        selfAccuracyRef.current.setLatLng(latlng);
        selfAccuracyRef.current.setRadius(selfPosition.accuracy);
      }
    } else {
      // Create accuracy ring
      if (selfPosition.accuracy && selfPosition.accuracy < 500) {
        selfAccuracyRef.current = L.circle(latlng, {
          radius: selfPosition.accuracy,
          color: '#3b82f6',
          fillColor: '#3b82f6',
          fillOpacity: 0.08,
          weight: 1,
          opacity: 0.25,
        }).addTo(map);
      }

      // Build self-position marker with pulse + heading
      const headingDeg = selfPosition.heading != null && selfPosition.heading >= 0
        ? selfPosition.heading : -1;

      const icon = L.divIcon({
        className: 'rmpg-self-marker',
        html: `
          <div style="position:relative;width:28px;height:28px;">
            <!-- Pulse ring -->
            <div style="
              position:absolute;top:50%;left:50%;
              width:20px;height:20px;
              background:transparent;
              border:2px solid #3b82f6;
              border-radius:50%;
              animation:rmpg-pulse-ring 2s ease-out infinite;
              pointer-events:none;
            "></div>
            <!-- Heading cone (direction of travel) -->
            <div class="rmpg-heading-cone" style="
              position:absolute;top:50%;left:50%;
              width:0;height:0;
              border-left:9px solid transparent;
              border-right:9px solid transparent;
              border-bottom:24px solid rgba(59,130,246,0.5);
              transform-origin:center bottom;
              transform:rotate(${headingDeg >= 0 ? headingDeg : 0}deg);
              margin-left:-9px;margin-top:-38px;
              display:${headingDeg >= 0 ? 'block' : 'none'};
              pointer-events:none;
            "></div>
            <!-- Blue dot -->
            <div style="
              position:absolute;top:50%;left:50%;
              width:14px;height:14px;
              background:#3b82f6;
              border:2.5px solid #fff;
              border-radius:50%;
              transform:translate(-50%,-50%);
              animation:rmpg-gps-glow 2s ease-in-out infinite;
            "></div>
          </div>
        `,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      });

      selfMarkerRef.current = L.marker(latlng, { icon, zIndexOffset: 1000 }).addTo(map);
      selfMarkerRef.current.bindTooltip('YOU', {
        permanent: false,
        direction: 'top',
        offset: [0, -16],
        className: 'leaflet-tooltip-dark',
      });

      // Center map on first position only
      if (!firstPositionRef.current) {
        firstPositionRef.current = true;
        map.setView(latlng, Math.max(map.getZoom(), 13));
      }
    }
  }, [selfPosition, isReady]);

  // ── Unit markers (status-colored with call_sign labels) ───
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isReady) return;

    const currentCallSigns = new Set(unitPositions.map(u => u.call_sign));

    // Remove stale markers
    for (const [callSign, marker] of unitMarkersRef.current) {
      if (!currentCallSigns.has(callSign)) {
        map.removeLayer(marker);
        unitMarkersRef.current.delete(callSign);
      }
    }

    // Update or create unit markers
    for (const unit of unitPositions) {
      const latlng: L.LatLngExpression = [unit.lat, unit.lng];
      const color = STATUS_COLORS[unit.status || ''] || '#6b7280';
      const label = STATUS_LABELS[unit.status || ''] || '???';
      const existing = unitMarkersRef.current.get(unit.call_sign);

      if (existing) {
        existing.setLatLng(latlng);
        // Update icon color if status changed
        const el = existing.getElement();
        if (el) {
          const dot = el.querySelector('.rmpg-unit-dot') as HTMLElement;
          if (dot) {
            dot.style.background = color;
            dot.style.borderColor = color;
          }
          const statusBadge = el.querySelector('.rmpg-unit-status') as HTMLElement;
          if (statusBadge) statusBadge.textContent = label;
        }
      } else {
        const icon = L.divIcon({
          className: 'rmpg-unit-marker',
          html: `
            <div style="display:flex;align-items:center;gap:3px;pointer-events:auto;">
              <div class="rmpg-unit-dot" style="
                width:10px;height:10px;
                background:${color};
                border:2px solid ${color};
                border-radius:50%;
                box-shadow:0 0 4px ${color}80;
                flex-shrink:0;
              "></div>
              <div style="
                background:rgba(6,12,20,0.92);
                border:1px solid #1e3048;
                padding:1px 4px;
                display:flex;align-items:center;gap:3px;
                border-radius:2px;
                white-space:nowrap;
              ">
                <span style="
                  color:#e0e8f0;
                  font-family:'JetBrains Mono',monospace;
                  font-size:8px;font-weight:800;
                  letter-spacing:0.08em;
                ">${unit.call_sign}</span>
                <span class="rmpg-unit-status" style="
                  color:${color};
                  font-family:'JetBrains Mono',monospace;
                  font-size:7px;font-weight:700;
                  opacity:0.8;
                ">${label}</span>
              </div>
            </div>
          `,
          iconSize: [80, 16],
          iconAnchor: [5, 8],
        });

        const marker = L.marker(latlng, { icon, zIndexOffset: 500 }).addTo(map);
        unitMarkersRef.current.set(unit.call_sign, marker);
      }
    }
  }, [unitPositions, isReady]);

  // ── Call markers (priority-colored pins) ───────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isReady) return;

    const currentCallIds = new Set(
      activeCalls.filter(c => c.latitude != null && c.longitude != null).map(c => c.id)
    );

    // Remove stale call markers
    for (const [callId, marker] of callMarkersRef.current) {
      if (!currentCallIds.has(callId)) {
        map.removeLayer(marker);
        callMarkersRef.current.delete(callId);
      }
    }

    // Update or create call markers
    for (const call of activeCalls) {
      if (call.latitude == null || call.longitude == null) continue;
      const latlng: L.LatLngExpression = [call.latitude, call.longitude];
      const color = PRIORITY_COLORS[call.priority] || '#6b7280';

      if (!callMarkersRef.current.has(call.id)) {
        const icon = L.divIcon({
          className: 'rmpg-call-marker',
          html: `
            <div style="display:flex;flex-direction:column;align-items:center;">
              <div style="
                background:${color};color:#fff;
                font-family:'JetBrains Mono',monospace;
                font-size:8px;font-weight:900;
                padding:2px 5px;
                border:1.5px solid #fff;
                white-space:nowrap;
                letter-spacing:0.04em;
                box-shadow:0 0 8px ${color}60;
              ">${call.call_number || 'CALL'}</div>
              <div style="
                width:0;height:0;
                border-left:5px solid transparent;
                border-right:5px solid transparent;
                border-top:6px solid ${color};
              "></div>
            </div>
          `,
          iconSize: [60, 26],
          iconAnchor: [30, 26],
        });

        const marker = L.marker(latlng, { icon, zIndexOffset: 800 }).addTo(map);
        marker.bindTooltip(
          `<div style="text-align:center;">
            <div style="font-weight:900;font-size:9px;">${call.call_number}</div>
            <div style="font-size:8px;opacity:0.7;">${call.incident_type}</div>
            <div style="font-size:7px;opacity:0.5;margin-top:1px;">${call.location_address || ''}</div>
          </div>`,
          { direction: 'top', offset: [0, -4], className: 'leaflet-tooltip-dark' }
        );
        callMarkersRef.current.set(call.id, marker);
      } else {
        callMarkersRef.current.get(call.id)?.setLatLng(latlng);
      }
    }
  }, [activeCalls, isReady]);

  // ── Property markers (small blue dots with tooltips) ────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isReady) return;

    const currentIds = new Set(properties.map(p => p.id));

    // Remove stale property markers
    for (const [id, marker] of propMarkersRef.current) {
      if (!currentIds.has(id)) {
        map.removeLayer(marker);
        propMarkersRef.current.delete(id);
      }
    }

    // Create property markers
    for (const prop of properties) {
      if (propMarkersRef.current.has(prop.id)) continue;

      const icon = L.divIcon({
        className: 'rmpg-prop-marker',
        html: `<div style="
          width:10px;height:10px;border-radius:50%;
          background:radial-gradient(circle at 35% 35%, #60a5fa, #1e3a5f);
          border:2px solid rgba(255,255,255,0.9);
          box-shadow:0 0 6px rgba(59,130,246,0.6), 0 1px 3px rgba(0,0,0,0.4);
        "></div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      });

      const marker = L.marker([prop.lat, prop.lng], { icon, zIndexOffset: 200 }).addTo(map);
      const tooltipHtml = `<div style="text-align:center;">
        <div style="font-weight:900;font-size:9px;color:#60a5fa;">${prop.name}</div>
        ${prop.address ? `<div style="font-size:7px;opacity:0.7;">${prop.address}</div>` : ''}
        ${prop.client_name ? `<div style="font-size:7px;color:#d4a017;">Client: ${prop.client_name}</div>` : ''}
      </div>`;
      marker.bindTooltip(tooltipHtml, { direction: 'top', offset: [0, -4], className: 'leaflet-tooltip-dark' });
      propMarkersRef.current.set(prop.id, marker);
    }
  }, [properties, isReady]);

  // ── Center on self ──────────────────────────────────────────
  const centerOnSelf = useCallback(() => {
    if (mapRef.current && selfPosition) {
      mapRef.current.setView([selfPosition.lat, selfPosition.lng], 14, { animate: true });
    }
  }, [selfPosition]);

  // ── Count active units by status for legend ─────────────────
  const statusCounts: Record<string, number> = {};
  for (const u of unitPositions) {
    const s = u.status || 'off_duty';
    statusCounts[s] = (statusCounts[s] || 0) + 1;
  }

  return (
    <div role="application" aria-label="Offline map fallback" className={`relative w-full h-full ${className}`} style={{ background: '#060c14' }}>
      {/* Leaflet map container */}
      <div ref={containerRef} className="absolute inset-0 z-0" />

      {/* Offline mode badge */}
      <div
        className="absolute top-3 left-3 z-[1000] flex items-center gap-2 px-3 py-2"
        style={{
          background: 'rgba(6, 12, 20, 0.95)',
          border: '1px solid #f59e0b40',
          borderRadius: 2,
          backdropFilter: 'blur(4px)',
        }}
      >
        <WifiOff style={{ width: 14, height: 14, color: '#f59e0b' }} />
        <div className="flex flex-col">
          <span className="text-[10px] text-amber-400 font-bold uppercase tracking-wider font-mono leading-none">
            OFFLINE MODE
          </span>
          <span className="text-[8px] text-rmpg-400 font-mono leading-none mt-0.5">
            Cached tiles · Auto-retrying
          </span>
        </div>
        {onRetry && (
          <button type="button"
            onClick={onRetry}
            disabled={retrying}
            className="ml-2 flex items-center gap-1 px-2 py-1 text-[9px] font-bold uppercase tracking-wider transition-colors"
            style={{
              background: retrying ? '#1e3048' : '#1a5a9e',
              color: retrying ? '#5a6e80' : '#fff',
              borderRadius: 2,
            }}
          >
            {retrying ? (
              <RefreshCw style={{ width: 10, height: 10 }} className="animate-spin" />
            ) : (
              <Signal style={{ width: 10, height: 10 }} />
            )}
            {retrying ? 'RETRYING...' : 'RETRY'}
          </button>
        )}
      </div>

      {/* Center on self button */}
      {selfPosition && !compact && (
        <button type="button"
          onClick={centerOnSelf}
          className="absolute bottom-20 right-3 z-[1000] p-2 transition-colors hover:border-blue-500"
          style={{
            background: 'rgba(6, 12, 20, 0.95)',
            border: '1px solid #2a3e58',
            borderRadius: 2,
          }}
          title="Center on your position"
        >
          <Navigation style={{ width: 18, height: 18, color: '#3b82f6' }} />
        </button>
      )}

      {/* Status legend + counts (bottom-left) */}
      <div
        className="absolute bottom-3 left-3 z-[1000] flex flex-col gap-1"
        style={{
          background: 'rgba(6, 12, 20, 0.92)',
          border: '1px solid #1e3048',
          borderRadius: 2,
          padding: compact ? '3px 6px' : '4px 8px',
        }}
      >
        {/* Summary line */}
        <div className="flex items-center gap-3">
          {unitPositions.length > 0 && (
            <span className="text-[9px] font-mono text-rmpg-300">
              <span className="text-green-400 font-bold">{unitPositions.length}</span> units
            </span>
          )}
          {activeCalls.length > 0 && (
            <span className="text-[9px] font-mono text-rmpg-300">
              <span className="text-amber-400 font-bold">{activeCalls.length}</span> calls
            </span>
          )}
          {unitPositions.length === 0 && activeCalls.length === 0 && (
            <span className="text-[9px] font-mono text-rmpg-500">No live data</span>
          )}
        </div>

        {/* Status breakdown (only show when we have units and not in compact mode) */}
        {!compact && unitPositions.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            {Object.entries(statusCounts).map(([status, count]) => (
              <span key={status} className="flex items-center gap-1">
                <span
                  style={{
                    width: 6, height: 6, borderRadius: '50%',
                    background: STATUS_COLORS[status] || '#6b7280',
                    display: 'inline-block',
                  }}
                />
                <span style={{
                  fontSize: 7, fontFamily: "'JetBrains Mono', monospace",
                  fontWeight: 700, color: STATUS_COLORS[status] || '#6b7280',
                }}>
                  {count} {STATUS_LABELS[status] || status.toUpperCase()}
                </span>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Inject dark tooltip + marker styles for Leaflet */}
      <style>{`
        .leaflet-tooltip-dark {
          background: rgba(6, 12, 20, 0.95) !important;
          border: 1px solid #2a3e58 !important;
          color: #fff !important;
          font-family: 'JetBrains Mono', monospace !important;
          font-size: 9px !important;
          font-weight: 700 !important;
          text-transform: uppercase !important;
          letter-spacing: 0.05em !important;
          padding: 2px 6px !important;
          border-radius: 2px !important;
          box-shadow: 0 2px 8px rgba(0,0,0,0.5) !important;
        }
        .leaflet-tooltip-dark::before {
          border-top-color: rgba(6, 12, 20, 0.95) !important;
        }
        /* Remove Leaflet's default icon backgrounds from our custom markers */
        .rmpg-self-marker,
        .rmpg-unit-marker,
        .rmpg-call-marker,
        .rmpg-prop-marker {
          background: transparent !important;
          border: none !important;
        }
        /* Dark theme for Leaflet zoom controls */
        .leaflet-control-zoom a {
          background: rgba(6, 12, 20, 0.95) !important;
          border-color: #2a3e58 !important;
          color: #b0bcc8 !important;
          width: 30px !important;
          height: 30px !important;
          line-height: 30px !important;
          font-size: 16px !important;
        }
        .leaflet-control-zoom a:hover {
          background: #1e3048 !important;
          color: #fff !important;
        }
        /* Hide Leaflet's default tile error styling */
        .leaflet-tile-container img.leaflet-tile {
          border: none !important;
        }
        /* Match background to our theme */
        .leaflet-container {
          background: #060c14 !important;
          font-family: 'JetBrains Mono', monospace !important;
        }
        /* Touch-friendly: prevent 300ms click delay on mobile */
        .leaflet-container {
          touch-action: manipulation;
        }
      `}</style>
    </div>
  );
}
