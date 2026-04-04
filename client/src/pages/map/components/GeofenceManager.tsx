// ============================================================
// RMPG Flex — GeofenceManager Component
// Panel for managing geofence zones: list, draw, toggle,
// delete, navigate-to, and alert history display.
// ============================================================

import React, { useState, useMemo } from 'react';
import { Plus, Trash2, Pencil, Shield, Loader2, MapPin, ChevronDown, ChevronRight, Bell, Navigation } from 'lucide-react';
import type { Geofence, GeofenceAlert } from '../hooks/useMapGeofences';

interface GeofenceManagerProps {
  geofences: Geofence[];
  loading?: boolean;
  onDraw: () => void;
  onDelete: (id: number) => void;
  onToggle: (id: number) => void;
  drawingMode?: boolean;
  onClose?: () => void;
  alerts?: GeofenceAlert[];
  onNavigate?: (lat: number, lng: number) => void;
}

// ─── Zone type badge colors ─────────────────────────────────

const ZONE_TYPE_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  school:     { bg: '#88888822', border: '#88888844', text: '#aaaaaa' },
  restricted: { bg: '#dc262622', border: '#dc262644', text: '#f87171' },
  custom:     { bg: '#8b5cf622', border: '#8b5cf644', text: '#a78bfa' },
  patrol:     { bg: '#22c55e22', border: '#22c55e44', text: '#4ade80' },
  perimeter:  { bg: '#f59e0b22', border: '#f59e0b44', text: '#fbbf24' },
};

function getZoneTypeStyle(zoneType: string) {
  return ZONE_TYPE_COLORS[zoneType?.toLowerCase()] || ZONE_TYPE_COLORS.custom;
}

// ─── Parse vertex count from polygon_coords ─────────────────

function getVertexCount(coordStr: string): number {
  if (!coordStr) return 0;
  try {
    const parsed = JSON.parse(coordStr);
    if (Array.isArray(parsed)) return parsed.length;
  } catch {
    return coordStr.split(';').filter(Boolean).length;
  }
  return 0;
}

// ─── Parse polygon coords and compute centroid ──────────────

function getCentroid(coordStr: string): { lat: number; lng: number } | null {
  if (!coordStr) return null;
  let points: { lat: number; lng: number }[] = [];
  try {
    const parsed = JSON.parse(coordStr);
    if (Array.isArray(parsed)) {
      points = parsed
        .map((p: any) => {
          if (typeof p.lat === 'number' && typeof p.lng === 'number') return { lat: p.lat, lng: p.lng };
          if (Array.isArray(p) && p.length >= 2) return { lat: p[0], lng: p[1] };
          return null;
        })
        .filter(Boolean) as { lat: number; lng: number }[];
    }
  } catch {
    points = coordStr
      .split(';')
      .filter(Boolean)
      .map((s) => {
        const [lat, lng] = s.split(',').map(Number);
        return !isNaN(lat) && !isNaN(lng) ? { lat, lng } : null;
      })
      .filter(Boolean) as { lat: number; lng: number }[];
  }
  if (points.length === 0) return null;
  const sumLat = points.reduce((s, p) => s + p.lat, 0);
  const sumLng = points.reduce((s, p) => s + p.lng, 0);
  return { lat: sumLat / points.length, lng: sumLng / points.length };
}

// ─── Time-ago helper ────────────────────────────────────────

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// ─── Component ──────────────────────────────────────────────

export default function GeofenceManager({
  geofences,
  loading,
  onDraw,
  onDelete,
  onToggle,
  drawingMode,
  onClose,
  alerts,
  onNavigate,
}: GeofenceManagerProps) {
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  // Build per-geofence alert lookup
  const alertsByFence = useMemo(() => {
    if (!alerts || alerts.length === 0) return new Map<number, GeofenceAlert[]>();
    const map = new Map<number, GeofenceAlert[]>();
    for (const a of alerts) {
      const list = map.get(a.geofenceId) || [];
      list.push(a);
      map.set(a.geofenceId, list);
    }
    // Sort each list newest-first
    for (const [, list] of map) {
      list.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    }
    return map;
  }, [alerts]);

  function toggleExpand(id: number) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="panel-beveled bg-surface-base overflow-hidden transition-all duration-200" style={{ width: 280 }}>
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2"
        style={{ background: '#050505', borderBottom: '1px solid #1e2a3a' }}
      >
        <div className="flex items-center gap-2">
          <Shield size={14} className="text-rmpg-400" />
          <span className="text-xs font-bold uppercase tracking-wider text-rmpg-200">
            Geofence Zones
          </span>
        </div>
        {/* #26: Close button with hover highlight */}
        {onClose && (
          <button type="button"
            onClick={onClose}
            className="toolbar-btn p-1 hover:bg-[#1a2636] transition-colors duration-150 rounded-sm"
            aria-label="Close"
            title="Close"
          >
            <span className="text-rmpg-400 hover:text-rmpg-200 text-xs">&times;</span>
          </button>
        )}
      </div>

      {/* Draw button */}
      <div className="px-2 pt-2">
        <button type="button"
          onClick={onDraw}
          className={`toolbar-btn flex items-center gap-1.5 px-3 py-1.5 text-xs w-full justify-center hover:shadow-md transition-all duration-150 active:scale-[0.97] ${
            drawingMode ? 'toolbar-btn-primary ring-1 ring-gray-400/40' : ''
          }`}
          aria-label={drawingMode ? 'Stop drawing' : 'Draw geofence'}
          title={drawingMode ? 'Drawing mode active — click map to add vertices, double-click to finish' : 'Draw a new geofence zone'}
        >
          {drawingMode ? (
            <>
              <Pencil size={12} />
              <span>Drawing... (dbl-click to finish)</span>
            </>
          ) : (
            <>
              <Plus size={12} />
              <span>Draw New Zone</span>
            </>
          )}
        </button>
      </div>

      {/* Geofence list */}
      <div className="p-2 space-y-1 max-h-[400px] overflow-y-auto scrollbar-thin scrollbar-thumb-[#1e3048]" style={{ scrollbarWidth: 'thin' }}>
        {loading && (
          <div className="flex items-center justify-center py-6 text-rmpg-500 animate-pulse">
            <Loader2 size={16} className="animate-spin" />
            <span className="ml-2 text-xs">Loading geofences...</span>
          </div>
        )}

        {!loading && geofences.length === 0 && (
          <div className="text-center py-6">
            <MapPin size={20} className="mx-auto mb-2 text-rmpg-600 opacity-50" />
            <div className="text-xs text-rmpg-500">No geofences defined.</div>
            <div className="text-[10px] text-rmpg-600 mt-0.5">Draw one to get started.</div>
          </div>
        )}

        {geofences.map((fence) => {
          const typeStyle = getZoneTypeStyle(fence.zone_type);
          const vertexCount = getVertexCount(fence.polygon_coords);
          const isActive = Boolean(fence.is_active);
          const expanded = expandedIds.has(fence.id);
          const fenceAlerts = alertsByFence.get(fence.id) || [];
          const alertCount = fenceAlerts.length;
          const centroid = getCentroid(fence.polygon_coords);

          return (
            <div
              key={fence.id}
              className="rounded-sm hover:bg-[#1a2636]/50 transition-colors duration-100 cursor-pointer"
              style={{
                background: '#050505',
                border: '1px solid #1e2a3a',
                borderLeft: `2px solid ${fence.color || typeStyle.text}`,
                opacity: isActive ? 1 : 0.5,
              }}
            >
              {/* Collapsed header row — click to expand */}
              <button type="button"
                onClick={() => toggleExpand(fence.id)}
                className="flex items-center justify-between w-full px-2 py-1.5 text-left"
                title={expanded ? 'Collapse' : 'Expand details'}
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <ChevronRight size={10} className={`text-rmpg-500 flex-shrink-0 transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`} />
                  <div
                    className="w-2 h-2 rounded-sm flex-shrink-0"
                    style={{ background: fence.color || '#888888' }}
                  />
                  <span className="text-[10px] text-rmpg-200 font-mono truncate" title={fence.name}>
                    {fence.name}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0 ml-1">
                  <span
                    className="text-[9px] font-mono px-1 py-0.5 rounded-sm uppercase"
                    style={{
                      background: typeStyle.bg,
                      border: `1px solid ${typeStyle.border}`,
                      color: typeStyle.text,
                      boxShadow: `0 0 4px ${typeStyle.text}20`,
                    }}
                  >
                    {fence.zone_type || 'custom'}
                  </span>
                  {alerts && alertCount > 0 && (
                    <span className="text-[9px] font-mono font-bold text-amber-400 bg-amber-900/30 px-1 py-0.5 rounded-sm">
                      {alertCount}
                    </span>
                  )}
                </div>
              </button>

              {/* Expanded details */}
              {expanded && (
                <div className="px-2 pb-2 pt-0.5 space-y-1.5" style={{ borderTop: '1px solid #1e2a3a' }}>
                  {/* Meta row */}
                  <div className="flex items-center gap-3 text-[10px] text-rmpg-500 font-mono">
                    <span className="flex items-center gap-1">
                      <MapPin size={9} />
                      {vertexCount} vertices
                    </span>
                    {fence.alert_on_enter ? (
                      <span className="text-amber-500">enter alert</span>
                    ) : null}
                    {fence.alert_on_exit ? (
                      <span className="text-gray-400">exit alert</span>
                    ) : null}
                  </div>

                  {/* Alert history */}
                  {alerts && alertCount > 0 && (
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-1 text-[9px] font-mono text-amber-400/70 uppercase border-b border-[#1e3048]/50 pb-0.5 mb-1">
                        <Bell size={8} />
                        <span className="flex-1">Recent alerts</span>
                        <span className="text-[8px] font-bold text-amber-400 bg-amber-900/30 px-1 py-0.5 rounded-sm">{alertCount}</span>
                      </div>
                      {fenceAlerts.slice(0, 2).map((a, i) => (
                        <div
                          key={i}
                          className="flex items-center justify-between text-[9px] font-mono px-1.5 py-0.5 rounded-sm"
                          style={{ background: '#0a0a0a' }}
                        >
                          <span className="text-rmpg-300">{a.unitCallSign}</span>
                          <span className={a.eventType === 'enter' ? 'text-amber-400' : 'text-gray-400'}>
                            {a.eventType}
                          </span>
                          <span className="text-rmpg-600">{timeAgo(a.timestamp)}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex items-center gap-1">
                    <button type="button"
                      onClick={() => onToggle(fence.id)}
                      className="toolbar-btn flex-1 py-1 text-[10px] transition-colors duration-200"
                      role="switch"
                      aria-checked={isActive}
                      aria-label={`Toggle ${fence.name} ${isActive ? 'off' : 'on'}`}
                      title={isActive ? 'Deactivate zone' : 'Activate zone'}
                    >
                      {isActive ? 'Active' : 'Inactive'}
                    </button>
                    {onNavigate && centroid && (
                      <button type="button"
                        onClick={() => onNavigate(centroid.lat, centroid.lng)}
                        className="toolbar-btn p-1 text-gray-400 hover:text-gray-300"
                        title="Navigate to zone"
                      >
                        <Navigation size={12} />
                      </button>
                    )}
                    <button type="button"
                      onClick={() => { if (window.confirm('Delete this geofence?')) onDelete(fence.id); }}
                      className="toolbar-btn p-1 text-red-400 hover:text-red-300 hover:bg-red-900/30 transition-colors duration-150"
                      aria-label={`Delete ${fence.name}`}
                      title="Delete geofence"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      {geofences.length > 0 && (
        <div
          className="px-3 py-1.5 text-[9px] text-rmpg-600 font-mono"
          style={{ borderTop: '1px solid #1e2a3a' }}
        >
          {geofences.filter((f) => f.is_active).length} active of {geofences.length} zone{geofences.length !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
}
