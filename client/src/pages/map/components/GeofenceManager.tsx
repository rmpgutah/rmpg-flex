// ============================================================
// RMPG Flex — GeofenceManager Component
// Panel for managing geofence zones: list, draw, toggle,
// and delete operations.
// ============================================================

import React from 'react';
import { Plus, Trash2, Pencil, Shield, Loader2, MapPin } from 'lucide-react';
import type { Geofence } from '../hooks/useMapGeofences';

interface GeofenceManagerProps {
  geofences: Geofence[];
  loading?: boolean;
  onDraw: () => void;
  onDelete: (id: number) => void;
  onToggle: (id: number) => void;
  drawingMode?: boolean;
  onClose?: () => void;
}

// ─── Zone type badge colors ─────────────────────────────────

const ZONE_TYPE_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  school:     { bg: '#3b82f622', border: '#3b82f644', text: '#60a5fa' },
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
    // Try semicolon-separated format
    return coordStr.split(';').filter(Boolean).length;
  }
  return 0;
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
}: GeofenceManagerProps) {
  return (
    <div className="panel-beveled bg-surface-base overflow-hidden" style={{ width: 280 }}>
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2"
        style={{ background: '#0d1520', borderBottom: '1px solid #1e2a3a' }}
      >
        <div className="flex items-center gap-2">
          <Shield size={14} className="text-rmpg-400" />
          <span className="text-xs font-bold uppercase tracking-wider text-rmpg-200">
            Geofence Zones
          </span>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="toolbar-btn p-1"
            title="Close"
          >
            <span className="text-rmpg-400 text-xs">&times;</span>
          </button>
        )}
      </div>

      {/* Draw button */}
      <div className="px-2 pt-2">
        <button
          onClick={onDraw}
          className={`toolbar-btn flex items-center gap-1.5 px-3 py-1.5 text-xs w-full justify-center ${
            drawingMode ? 'toolbar-btn-primary' : ''
          }`}
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
      <div className="p-2 space-y-1 max-h-[400px] overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
        {loading && (
          <div className="flex items-center justify-center py-6 text-rmpg-500">
            <Loader2 size={16} className="animate-spin" />
            <span className="ml-2 text-xs">Loading geofences...</span>
          </div>
        )}

        {!loading && geofences.length === 0 && (
          <div className="text-center py-6 text-rmpg-600 text-xs">
            No geofence zones configured.
          </div>
        )}

        {geofences.map((fence) => {
          const typeStyle = getZoneTypeStyle(fence.zone_type);
          const vertexCount = getVertexCount(fence.polygon_coords);
          const isActive = Boolean(fence.is_active);

          return (
            <div
              key={fence.id}
              className="rounded-sm p-2"
              style={{
                background: '#0d1520',
                border: '1px solid #1e2a3a',
                opacity: isActive ? 1 : 0.5,
              }}
            >
              {/* Name + type badge */}
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2 min-w-0">
                  <div
                    className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                    style={{ background: fence.color || '#3b82f6' }}
                  />
                  <span className="text-xs text-rmpg-200 font-mono truncate" title={fence.name}>
                    {fence.name}
                  </span>
                </div>
                <span
                  className="text-[9px] font-mono px-1.5 py-0.5 rounded-sm flex-shrink-0 uppercase"
                  style={{
                    background: typeStyle.bg,
                    border: `1px solid ${typeStyle.border}`,
                    color: typeStyle.text,
                  }}
                >
                  {fence.zone_type || 'custom'}
                </span>
              </div>

              {/* Meta row */}
              <div className="flex items-center gap-3 text-[10px] text-rmpg-500 font-mono mb-2">
                <span className="flex items-center gap-1">
                  <MapPin size={9} />
                  {vertexCount} vertices
                </span>
                {fence.alert_on_enter ? (
                  <span className="text-amber-500">enter alert</span>
                ) : null}
                {fence.alert_on_exit ? (
                  <span className="text-blue-400">exit alert</span>
                ) : null}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1">
                <button
                  onClick={() => onToggle(fence.id)}
                  className="toolbar-btn flex-1 py-1 text-[10px]"
                  title={isActive ? 'Deactivate zone' : 'Activate zone'}
                >
                  {isActive ? 'Active' : 'Inactive'}
                </button>
                <button
                  onClick={() => onDelete(fence.id)}
                  className="toolbar-btn p-1 text-red-400 hover:text-red-300"
                  title="Delete zone"
                >
                  <Trash2 size={12} />
                </button>
              </div>
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
