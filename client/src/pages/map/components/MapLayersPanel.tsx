// ============================================================
// RMPG Flex — MapLayersPanel Component
// ============================================================
// Slide-out layers panel for the Mapbox map page. Replaces the
// Google Maps layers toolbar with toggleable GeoJSON overlays
// (beats, counties, municipalities, highways, places) and
// operational overlays (heatmap, traffic, breadcrumbs, etc.).
//
// Spillman Flex dark theme: #0a0a0a base, #d4a017 gold accent.
// ============================================================

import { useState } from 'react';
import {
  Layers, Eye, EyeOff, ChevronDown, ChevronRight,
  Map as MapIcon, Shield, Flame, Car, Navigation2,
  Sun, AlertTriangle, PenTool, Hexagon, Ruler, Satellite,
} from 'lucide-react';
import IconButton from '../../../components/IconButton';

// ── Types ─────────────────────────────────────────────────

export interface LayerToggle {
  id: string;
  label: string;
  enabled: boolean;
  onToggle: () => void;
  icon?: React.ReactNode;
  color?: string;
  description?: string;
}

export interface LayerGroup {
  id: string;
  label: string;
  layers: LayerToggle[];
}

interface MapLayersPanelProps {
  open: boolean;
  onClose: () => void;
  groups: LayerGroup[];
}

// ── Component ─────────────────────────────────────────────

export default function MapLayersPanel({ open, onClose, groups }: MapLayersPanelProps) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    new Set(groups.map(g => g.id))
  );

  const toggleGroup = (groupId: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  if (!open) return null;

  const enabledCount = groups.reduce(
    (sum, g) => sum + g.layers.filter(l => l.enabled).length,
    0
  );

  return (
    <div
      className="absolute top-0 right-0 z-30 h-full bg-surface-raised/95 border-l border-[#222222] backdrop-blur-sm flex flex-col"
      style={{ width: 260 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#222222]">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-[#d4a017]" />
          <span className="text-[#d4a017] text-xs font-semibold tracking-wider">LAYERS</span>
          <span className="text-rmpg-500 text-[10px]">({enabledCount} active)</span>
        </div>
        <IconButton
          aria-label="Close layers panel"
          onClick={onClose}
          className="text-rmpg-400 hover:text-rmpg-200 p-1"
        >
          <span className="text-sm">✕</span>
        </IconButton>
      </div>

      {/* Layer Groups */}
      <div className="flex-1 overflow-y-auto">
        {groups.map(group => {
          const isExpanded = expandedGroups.has(group.id);
          const activeInGroup = group.layers.filter(l => l.enabled).length;

          return (
            <div key={group.id} className="border-b border-[#1a1a1a]">
              {/* Group Header */}
              <button
                onClick={() => toggleGroup(group.id)}
                className="w-full flex items-center justify-between px-3 py-2 text-rmpg-300 hover:text-rmpg-200 hover:bg-[#1a1a1a] transition-colors"
              >
                <div className="flex items-center gap-2">
                  {isExpanded
                    ? <ChevronDown className="w-3 h-3 text-rmpg-500" />
                    : <ChevronRight className="w-3 h-3 text-rmpg-500" />
                  }
                  <span className="text-[11px] font-semibold tracking-wider uppercase">{group.label}</span>
                </div>
                {activeInGroup > 0 && (
                  <span className="text-[9px] text-[#d4a017] bg-[#d4a017]/10 px-1.5 py-0.5 rounded-sm font-mono">
                    {activeInGroup}
                  </span>
                )}
              </button>

              {/* Layer Toggles */}
              {isExpanded && (
                <div className="pb-1">
                  {group.layers.map(layer => (
                    <button
                      key={layer.id}
                      onClick={layer.onToggle}
                      className={`w-full flex items-center gap-2 px-4 py-1.5 text-left transition-colors ${
                        layer.enabled
                          ? 'bg-[#1a1a1a] text-rmpg-200'
                          : 'text-rmpg-400 hover:bg-[#141414] hover:text-rmpg-300'
                      }`}
                    >
                      {/* Toggle indicator */}
                      <span
                        className="w-2 h-2 shrink-0 rounded-sm"
                        style={{
                          background: layer.enabled ? (layer.color || '#d4a017') : '#333',
                          boxShadow: layer.enabled ? `0 0 4px ${layer.color || '#d4a017'}80` : 'none',
                        }}
                      />

                      {/* Icon */}
                      {layer.icon && (
                        <span className="shrink-0" style={{ color: layer.enabled ? (layer.color || '#d4a017') : '#555' }}>
                          {layer.icon}
                        </span>
                      )}

                      {/* Label */}
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] font-medium truncate">{layer.label}</div>
                        {layer.description && (
                          <div className="text-[9px] text-rmpg-500 truncate">{layer.description}</div>
                        )}
                      </div>

                      {/* Eye icon */}
                      {layer.enabled
                        ? <Eye className="w-3 h-3 text-[#d4a017] shrink-0" />
                        : <EyeOff className="w-3 h-3 text-rmpg-600 shrink-0" />
                      }
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Keyboard shortcuts hint */}
      <div className="border-t border-[#222222] px-3 py-2">
        <div className="text-[9px] text-rmpg-500 font-mono">
          H=Heatmap B=Trails C=Cluster D=Day/Night G=Grid
        </div>
      </div>
    </div>
  );
}
