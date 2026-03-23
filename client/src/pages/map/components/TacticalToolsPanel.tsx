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
} from 'lucide-react';

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
      className="panel-beveled rounded-sm absolute z-30 w-[280px] max-h-[calc(100vh-160px)] overflow-y-auto bg-surface-base border border-rmpg-700 shadow-lg"
      style={{ top: 8, right: 8 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-[10px] uppercase tracking-widest text-rmpg-300 font-semibold">
          Tactical Tools
        </span>
        <button
          onClick={onClose}
          className="text-rmpg-400 hover:text-white transition-colors"
          title="Close"
        >
          <X size={14} />
        </button>
      </div>

      {/* Rally Point */}
      <div className="border-t border-rmpg-700 px-3 py-2 space-y-1.5">
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
          <button
            onClick={onSetRallyPoint}
            className="toolbar-btn text-[9px] px-2 py-0.5"
          >
            Set at Center
          </button>
          {rallyPoint && (
            <button
              onClick={onClearRallyPoint}
              className="toolbar-btn text-[9px] px-2 py-0.5 text-red-400 hover:text-red-300"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Command Rings */}
      <div className="border-t border-rmpg-700 px-3 py-2 space-y-1.5">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-rmpg-300 font-semibold">
          <Circle size={11} className="text-blue-400" />
          Command Rings
        </div>
        <div className="text-[9px] font-mono text-rmpg-400">
          100m / 300m / 500m perimeter
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={onShowCommandRings}
            className="toolbar-btn text-[9px] px-2 py-0.5"
          >
            Deploy at Center
          </button>
          <button
            onClick={onClearCommandRings}
            className="toolbar-btn text-[9px] px-2 py-0.5 text-red-400 hover:text-red-300"
          >
            Clear
          </button>
        </div>
      </div>

      {/* K9 Deployment Radius */}
      <div className="border-t border-rmpg-700 px-3 py-2 space-y-1.5">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-rmpg-300 font-semibold">
          <Dog size={11} className="text-green-400" />
          K9 Deployment Radius
        </div>
        <div className="text-[9px] font-mono text-rmpg-400">
          800m green circle
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={onShowK9Radius}
            className="toolbar-btn text-[9px] px-2 py-0.5"
          >
            Show at Center
          </button>
          <button
            onClick={onClearK9Radius}
            className="toolbar-btn text-[9px] px-2 py-0.5 text-red-400 hover:text-red-300"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Emergency Services */}
      <div className="border-t border-rmpg-700 px-3 py-2 space-y-1.5">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-rmpg-300 font-semibold">
          <Building2 size={11} className="text-cyan-400" />
          Emergency Services
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            onClick={onShowHospitals}
            className="toolbar-btn text-[9px] px-2 py-0.5 inline-flex items-center gap-1"
          >
            <Building2 size={9} />
            Show Hospitals
          </button>
          <button
            onClick={onShowFireStations}
            className="toolbar-btn text-[9px] px-2 py-0.5 inline-flex items-center gap-1"
          >
            <Flame size={9} />
            Show Fire Stations
          </button>
          <button
            onClick={onHideEmergencyServices}
            className="toolbar-btn text-[9px] px-2 py-0.5 text-red-400 hover:text-red-300"
          >
            Hide All
          </button>
        </div>
      </div>

      {/* Entry/Exit Points */}
      <div className="border-t border-rmpg-700 px-3 py-2 space-y-1.5">
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
          <button
            onClick={handleAddEntry}
            className="toolbar-btn text-[9px] px-1.5 py-0.5 inline-flex items-center gap-0.5"
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
            <button
              onClick={onClearEntryPoints}
              className="toolbar-btn text-[9px] px-2 py-0.5 text-red-400 hover:text-red-300 inline-flex items-center gap-0.5"
            >
              <Trash2 size={9} />
              Clear All
            </button>
          </>
        )}
      </div>

      {/* Crowd Density */}
      <div className="border-t border-rmpg-700 px-3 py-2 space-y-1.5">
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
