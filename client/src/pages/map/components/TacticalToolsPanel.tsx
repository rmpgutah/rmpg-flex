import React, { useState } from 'react';
import {
  X,
  Star,
  Circle,
  Dog,
  Building2,
  Flame,
  MapPin,
  Users,
  Plus,
  Trash2,
  Zap,
  Car,
  Search,
  AlertOctagon,
  Shield,
} from 'lucide-react';

// ─── Quick Deploy Preset Types ─────────────────────────────

export type QuickDeployPreset = 'traffic_stop' | 'building_search' | 'active_threat' | 'crowd_control';

interface QuickDeployConfig {
  key: QuickDeployPreset;
  label: string;
  icon: React.ElementType;
  accent: string;
  description: string;
}

const QUICK_DEPLOY_PRESETS: QuickDeployConfig[] = [
  { key: 'traffic_stop', label: 'Traffic Stop', icon: Car, accent: '#f59e0b', description: '1 rally point, 100m perimeter' },
  { key: 'building_search', label: 'Building Search', icon: Search, accent: '#888888', description: '4 entry pts (N/S/E/W), 200m K9' },
  { key: 'active_threat', label: 'Active Threat', icon: AlertOctagon, accent: '#ef4444', description: '300m inner, 500m outer, rally pt' },
  { key: 'crowd_control', label: 'Crowd Control', icon: Shield, accent: '#a855f7', description: '4 corner rally pts, 500m perimeter' },
];

interface TacticalToolsPanelProps {
  rallyPoint: { lat: number; lng: number; label: string } | null;
  entryPoints: { lat: number; lng: number; label: string; number: number }[];
  crowdDensity: string;
  onSetRallyPoint: () => void;
  onClearRallyPoint: () => void;
  onShowCommandRings: () => void;
  onClearCommandRings: () => void;
  onShowK9Radius: () => void;
  onClearK9Radius: () => void;
  onShowHospitals: () => void;
  onShowFireStations: () => void;
  onHideEmergencyServices: () => void;
  onAddEntryPoint: (label: string) => void;
  onClearEntryPoints: () => void;
  onQuickDeploy?: (preset: QuickDeployPreset) => void;
  onClose: () => void;
}

function getDensityColor(density: string): string {
  switch (density.toLowerCase()) {
    case 'high':
      return 'text-red-400';
    case 'medium':
      return 'text-yellow-400';
    case 'low':
      return 'text-green-400';
    default:
      return 'text-rmpg-400';
  }
}

export default function TacticalToolsPanel({
  rallyPoint,
  entryPoints,
  crowdDensity,
  onSetRallyPoint,
  onClearRallyPoint,
  onShowCommandRings,
  onClearCommandRings,
  onShowK9Radius,
  onClearK9Radius,
  onShowHospitals,
  onShowFireStations,
  onHideEmergencyServices,
  onAddEntryPoint,
  onClearEntryPoints,
  onQuickDeploy,
  onClose,
}: TacticalToolsPanelProps) {
  const [entryLabel, setEntryLabel] = useState('');

  const handleAddEntry = () => {
    const label = entryLabel.trim();
    if (!label) return;
    onAddEntryPoint(label);
    setEntryLabel('');
  };

  const handleEntryKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddEntry();
    }
  };

  return (
    <div
      className="panel-beveled rounded-sm absolute z-30 w-[280px] max-h-[calc(100dvh-160px)] overflow-y-auto bg-surface-base border border-rmpg-700 shadow-lg transition-all duration-200 ease-out backdrop-blur-sm scrollbar-thin scrollbar-thumb-[#1e3048] scrollbar-track-transparent"
      style={{ top: 8, right: 8 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-[10px] uppercase tracking-widest text-rmpg-300 font-semibold">
          Tactical Tools
        </span>
        <button type="button"
          onClick={onClose}
          className="text-rmpg-400 hover:text-white hover:bg-[#1a2636] transition-colors duration-150 rounded-sm p-0.5"
          title="Close"
          aria-label="Close tactical tools"
        >
          <X size={14} />
        </button>
      </div>

      {/* Quick Deploy Presets */}
      {onQuickDeploy && (
        <div className="border-t border-rmpg-700 px-3 py-2 space-y-1.5" style={{ borderLeft: '3px solid #d4a017', background: 'rgba(212,160,23,0.02)' }}>
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-rmpg-300 font-semibold">
            <Zap size={11} className="text-yellow-400" />
            Quick Deploy
          </div>
          <div className="grid grid-cols-2 gap-1">
            {QUICK_DEPLOY_PRESETS.map((preset) => {
              const Icon = preset.icon;
              return (
                <button
                  type="button"
                  key={preset.key}
                  onClick={() => onQuickDeploy(preset.key)}
                  className="flex items-center gap-1.5 px-2 py-1.5 rounded-sm text-left transition-all duration-150 active:scale-[0.97] hover:brightness-125"
                  style={{
                    background: `${preset.accent}10`,
                    border: `1px solid ${preset.accent}30`,
                  }}
                  title={preset.description}
                >
                  <Icon size={10} style={{ color: preset.accent, flexShrink: 0 }} />
                  <div className="min-w-0">
                    <div className="text-[8px] font-bold uppercase tracking-wider truncate" style={{ color: preset.accent }}>
                      {preset.label}
                    </div>
                    <div className="text-[7px] text-rmpg-500 truncate">{preset.description}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* #30: Rally point section with left accent border glow */}
      <div className="border-t border-rmpg-700 px-3 py-2 space-y-1.5" style={{ borderLeft: '3px solid #d4a017', background: 'rgba(212,160,23,0.03)' }}>
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-rmpg-300 font-semibold">
          <Star size={11} className="text-yellow-400" />
          Rally Point
        </div>
        {rallyPoint && (
          <div className="text-[9px] font-mono text-rmpg-400">
            <span className="text-yellow-400">{rallyPoint.label}</span>
            <span className="ml-1">
              ({rallyPoint.lat.toFixed(5)}, {rallyPoint.lng.toFixed(5)})
            </span>
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <button type="button"
            onClick={onSetRallyPoint}
            className="toolbar-btn text-[9px] px-2 py-0.5 transition-all duration-150 active:scale-[0.97]"
          >
            Set at Center
          </button>
          {rallyPoint && (
            <button type="button"
              onClick={onClearRallyPoint}
              className="toolbar-btn text-[9px] px-2 py-0.5 text-red-400 hover:text-red-300 transition-all duration-150 active:scale-[0.97]"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* #31: Command rings section with blue accent */}
      <div className="border-t border-rmpg-700 px-3 py-2 space-y-1.5" style={{ borderLeft: '3px solid #888888', background: 'rgba(59,130,246,0.03)' }}>
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-rmpg-300 font-semibold">
          <Circle size={11} className="text-blue-400" />
          Command Rings
        </div>
        <div className="text-[9px] font-mono text-rmpg-400">
          100m / 300m / 500m perimeter
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button"
            onClick={onShowCommandRings}
            className="toolbar-btn text-[9px] px-2 py-0.5 transition-all duration-150 active:scale-[0.97]"
          >
            Deploy at Center
          </button>
          <button type="button"
            onClick={onClearCommandRings}
            className="toolbar-btn text-[9px] px-2 py-0.5 text-red-400 hover:text-red-300 transition-all duration-150 active:scale-[0.97]"
          >
            Clear
          </button>
        </div>
      </div>

      {/* #32: K9 section with green accent */}
      <div className="border-t border-rmpg-700 px-3 py-2 space-y-1.5" style={{ borderLeft: '3px solid #22c55e', background: 'rgba(34,197,94,0.03)' }}>
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-rmpg-300 font-semibold">
          <Dog size={11} className="text-green-400" />
          K9 Deployment Radius
        </div>
        <div className="text-[9px] font-mono text-rmpg-400">
          800m green circle
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button"
            onClick={onShowK9Radius}
            className="toolbar-btn text-[9px] px-2 py-0.5 transition-all duration-150 active:scale-[0.97]"
          >
            Show at Center
          </button>
          <button type="button"
            onClick={onClearK9Radius}
            className="toolbar-btn text-[9px] px-2 py-0.5 text-red-400 hover:text-red-300 transition-all duration-150 active:scale-[0.97]"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Emergency Services */}
      <div className="border-t border-rmpg-700 px-3 py-2 space-y-1.5" style={{ borderLeft: '2px solid #06b6d4' }}>
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-rmpg-300 font-semibold">
          <Building2 size={11} className="text-cyan-400" />
          Emergency Services
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <button type="button"
            onClick={onShowHospitals}
            className="toolbar-btn text-[9px] px-2 py-0.5 inline-flex items-center gap-1 transition-all duration-150 active:scale-[0.97]"
          >
            <Building2 size={9} />
            Show Hospitals
          </button>
          <button type="button"
            onClick={onShowFireStations}
            className="toolbar-btn text-[9px] px-2 py-0.5 inline-flex items-center gap-1 transition-all duration-150 active:scale-[0.97]"
          >
            <Flame size={9} />
            Show Fire Stations
          </button>
          <button type="button"
            onClick={onHideEmergencyServices}
            className="toolbar-btn text-[9px] px-2 py-0.5 text-red-400 hover:text-red-300 transition-all duration-150 active:scale-[0.97]"
          >
            Hide All
          </button>
        </div>
      </div>

      {/* Entry/Exit Points */}
      <div className="border-t border-rmpg-700 px-3 py-2 space-y-1.5" style={{ borderLeft: '2px solid #a855f7' }}>
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-rmpg-300 font-semibold">
          <MapPin size={11} className="text-purple-400" />
          Entry / Exit Points
        </div>
        <div className="flex items-center gap-1">
          <input
            type="text"
            value={entryLabel}
            onChange={(e) => setEntryLabel(e.target.value)}
            onKeyDown={handleEntryKeyDown}
            placeholder="Label..."
            className="flex-1 bg-surface-sunken border border-rmpg-700 rounded-sm px-1.5 py-0.5 text-[9px] font-mono text-rmpg-300 placeholder-rmpg-600 outline-none focus:border-rmpg-500"
          />
          <button type="button"
            onClick={handleAddEntry}
            className="toolbar-btn text-[9px] px-1.5 py-0.5 inline-flex items-center gap-0.5 transition-all duration-150 active:scale-[0.97]"
            title="Add at Center"
          >
            <Plus size={9} />
            Add
          </button>
        </div>
        {entryPoints.length > 0 && (
          <>
            <div className="space-y-0.5 max-h-24 overflow-y-auto">
              {entryPoints.map((pt) => (
                <div
                  key={pt.number}
                  className="text-[9px] font-mono text-rmpg-400 flex items-center gap-1"
                >
                  <span className="text-purple-400 font-semibold min-w-[14px]">
                    {pt.number}.
                  </span>
                  <span className="text-rmpg-300 truncate">{pt.label}</span>
                </div>
              ))}
            </div>
            <button type="button"
              onClick={onClearEntryPoints}
              className="toolbar-btn text-[9px] px-2 py-0.5 text-red-400 hover:text-red-300 inline-flex items-center gap-0.5 transition-all duration-150 active:scale-[0.97]"
            >
              <Trash2 size={9} />
              Clear All
            </button>
          </>
        )}
      </div>

      {/* Crowd Density */}
      <div className="border-t border-rmpg-700 px-3 py-2 space-y-1.5" style={{ borderLeft: '2px solid #f97316' }}>
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-rmpg-300 font-semibold">
          <Users size={11} className="text-orange-400" />
          Crowd Density
        </div>
        <div className="text-[9px] font-mono text-rmpg-400">
          Estimated at map center:{' '}
          <span className={`font-semibold ${getDensityColor(crowdDensity)}`}>
            {crowdDensity || 'Unknown'}
          </span>
        </div>
      </div>
    </div>
  );
}
