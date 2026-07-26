// ============================================================
// RMPG Flex — Map Roster Dock
// Units/Calls tabbed roster, extracted from MapboxMapPage.tsx's
// inline Sidebar block. Same content/behavior, now a standalone
// component so it can be rendered as a dock (desktop) or a tray
// tab (narrow viewport) from MapBottomTray.
// ============================================================

import { Shield, AlertTriangle, Locate, PanelLeftOpen, PanelLeftClose, RefreshCw, Crosshair } from 'lucide-react';
import RmpgLogo from '../../../components/RmpgLogo';
import IconButton from '../../../components/IconButton';
import { UNIT_STATUS_COLORS, priorityHex } from '../utils/mapConstants';
import { HAZARD_FLAGS } from '../utils/mapMarkers';
import { formatIncidentType } from '../../../utils/caseNumbers';
import { withAlpha } from '../../../utils/withAlpha';

export interface RosterUnit {
  id: number;
  call_sign: string;
  officer_name: string;
  status: string;
  latitude: number | null;
  longitude: number | null;
  current_call_type: string | null;
  call_number: string | null;
}

export interface RosterCall {
  id: number;
  call_number: string;
  priority: number;
  incident_type: string;
  location_address: string;
  latitude: number | null;
  longitude: number | null;
  [key: string]: unknown; // hazard-flag boolean keys (HAZARD_FLAGS[].key), read dynamically
}

export interface MapRosterDockProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  units: RosterUnit[];
  calls: RosterCall[];
  activeTab: 'units' | 'calls';
  onTabChange: (tab: 'units' | 'calls') => void;
  isMobile: boolean;
  onFlyToUnit: (unit: RosterUnit) => void;
  onFlyToCall: (call: RosterCall) => void;
  onShowNearestUnit: (call: RosterCall) => void;
  onRefresh: () => void;
  onFlyToSelf: () => void;
}

export default function MapRosterDock({
  open, onOpenChange, units, calls, activeTab, onTabChange, isMobile,
  onFlyToUnit, onFlyToCall, onShowNearestUnit, onRefresh, onFlyToSelf,
}: MapRosterDockProps) {
  if (!open) {
    return (
      <IconButton
        aria-label="Open sidebar"
        onClick={() => onOpenChange(true)}
        className="absolute top-3 left-3 z-30 bg-surface-raised/95 border border-border-default p-2 text-rmpg-300 hover:text-brand-gold-500 backdrop-blur-sm"
        style={{ borderRadius: 2 }}
      >
        <PanelLeftOpen className="w-4 h-4" />
      </IconButton>
    );
  }

  return (
    <div
      className={`relative z-20 h-full bg-surface-raised/95 border-r border-border-default backdrop-blur-sm flex flex-col ${isMobile ? 'w-full' : 'w-[280px]'}`}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-default">
        <div className="flex items-center gap-2">
          <RmpgLogo height={20} iconOnly />
          <span className="text-brand-gold-500 text-xs font-semibold tracking-wider">FLEX MAP</span>
        </div>
        <IconButton
          aria-label="Close sidebar"
          onClick={() => onOpenChange(false)}
          className="text-rmpg-400 hover:text-rmpg-200 p-1"
        >
          <PanelLeftClose className="w-4 h-4" />
        </IconButton>
      </div>

      <div className="flex border-b border-border-default">
        <button
          onClick={() => onTabChange('units')}
          className={`flex-1 py-2 text-xs font-semibold tracking-wider transition-colors ${
            activeTab === 'units' ? 'text-brand-gold-500 border-b-2 border-brand-gold-500' : 'text-rmpg-400 hover:text-rmpg-300'
          }`}
        >
          <Shield className="w-3 h-3 inline mr-1" />
          UNITS ({units.length})
        </button>
        <button
          onClick={() => onTabChange('calls')}
          className={`flex-1 py-2 text-xs font-semibold tracking-wider transition-colors ${
            activeTab === 'calls' ? 'text-brand-gold-500 border-b-2 border-brand-gold-500' : 'text-rmpg-400 hover:text-rmpg-300'
          }`}
        >
          <AlertTriangle className="w-3 h-3 inline mr-1" />
          CALLS ({calls.length})
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {activeTab === 'units' && (
          <div className="divide-y divide-border-subtle">
            {units.length === 0 && (
              <div className="px-3 py-6 text-center text-rmpg-500 text-xs">No units available</div>
            )}
            {units.map((unit) => {
              const color = UNIT_STATUS_COLORS[unit.status as keyof typeof UNIT_STATUS_COLORS] || '#888888';
              const hasGps = unit.latitude != null && unit.longitude != null;
              return (
                <button
                  key={unit.id}
                  onClick={() => onFlyToUnit(unit)}
                  disabled={!hasGps}
                  className={`w-full text-left px-3 py-1.5 transition-colors ${hasGps ? 'hover:bg-surface-overlay cursor-pointer' : 'opacity-50 cursor-default'}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 shrink-0" style={{ borderRadius: '50%', background: color, boxShadow: `0 0 4px ${withAlpha(color, '80')}` }} />
                    <span className="text-rmpg-200 text-[11px] font-mono font-semibold">{unit.call_sign}</span>
                    <span className="text-rmpg-400 text-[10px] truncate flex-1">{unit.officer_name}</span>
                    {!hasGps && <span className="text-rmpg-500 text-[9px]">NO GPS</span>}
                  </div>
                  {unit.current_call_type && (
                    <div className="ml-4 text-[10px] text-rmpg-500 truncate">
                      {unit.call_number} — {formatIncidentType(unit.current_call_type)}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {activeTab === 'calls' && (
          <div className="divide-y divide-border-subtle">
            {calls.length === 0 && (
              <div className="px-3 py-6 text-center text-rmpg-500 text-xs">No active calls</div>
            )}
            {calls.map((call) => {
              const color = priorityHex(call.priority);
              const hasGps = call.latitude != null && call.longitude != null;
              const hasFlags = HAZARD_FLAGS.some((f) => call[f.key]);
              return (
                <button
                  key={call.id}
                  onClick={() => onFlyToCall(call)}
                  disabled={!hasGps}
                  className={`w-full text-left px-3 py-1.5 transition-colors ${hasGps ? 'hover:bg-surface-overlay cursor-pointer' : 'opacity-50 cursor-default'}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 text-[8px] font-bold px-1 py-px" style={{ background: withAlpha(color, '22'), color, borderRadius: 2 }}>
                      P{call.priority}
                    </span>
                    <span className="text-rmpg-200 text-[11px] font-mono font-semibold">{call.call_number}</span>
                    <span className="text-rmpg-400 text-[10px] truncate flex-1">{formatIncidentType(call.incident_type)}</span>
                  </div>
                  <div className="ml-4 text-[10px] text-rmpg-500 truncate">{call.location_address}</div>
                  {hasFlags && (
                    <div className="ml-4 mt-0.5 flex flex-wrap gap-0.5">
                      {HAZARD_FLAGS.filter((f) => call[f.key]).map((f) => (
                        <span key={f.key} className="text-[7px] font-bold px-1 py-px" style={{ background: withAlpha(f.color, '22'), color: f.color, borderRadius: 2 }}>
                          {f.label}
                        </span>
                      ))}
                    </div>
                  )}
                  {hasGps && (
                    <div className="ml-4 mt-0.5">
                      <span
                        className="text-[8px] text-rmpg-400 hover:text-brand-gold-500 cursor-pointer inline-flex items-center gap-0.5"
                        onClick={(e) => { e.stopPropagation(); onShowNearestUnit(call); }}
                      >
                        <Locate className="w-2.5 h-2.5" /> NEAREST UNIT
                      </span>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="border-t border-border-default px-3 py-2">
        <div className="flex items-center gap-1 flex-wrap">
          <IconButton aria-label="Refresh data" onClick={onRefresh} className="text-rmpg-400 hover:text-brand-gold-500 p-1.5">
            <RefreshCw className="w-3.5 h-3.5" />
          </IconButton>
          <IconButton aria-label="Fly to my position" onClick={onFlyToSelf} className="text-rmpg-400 hover:text-brand-gold-500 p-1.5">
            <Crosshair className="w-3.5 h-3.5" />
          </IconButton>
        </div>
      </div>
    </div>
  );
}
