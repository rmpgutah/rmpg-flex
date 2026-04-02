import React, { useMemo } from 'react';
import { Shield, AlertTriangle, Search, ChevronUp, ChevronDown, AlertCircle, Radio, PhoneOff } from 'lucide-react';
import { formatIncidentType } from '../../../utils/caseNumbers';
import type { UnitStatus } from '../../../types';
import { UNIT_STATUS_COLORS, UNIT_STATUS_LABELS, PRIORITY_COLORS, getIncidentCategory } from '../utils/mapConstants';
import type { MapUnit as Unit, ActiveCall } from '../utils/mapConstants';

// Fix 98: unit status sort order (available first, then dispatched, etc.)
const STATUS_SORT_ORDER: Record<string, number> = {
  available: 0, dispatched: 1, enroute: 2, onscene: 3, busy: 4, off_duty: 5,
};

// Fix 99: priority sort order (P1 first)
const PRIORITY_SORT_ORDER: Record<string, number> = {
  P1: 0, P2: 1, P3: 2, P4: 3,
};

// Fix 100: stale threshold in ms (5 minutes)
const GPS_STALE_THRESHOLD_MS = 5 * 60 * 1000;

interface MapSidebarProps {
  sidebarOpen: boolean;
  setSidebarOpen: (v: boolean) => void;
  sidebarTab: string;
  setSidebarTab: (v: 'units' | 'calls') => void;
  searchQuery: string;
  setSearchQuery: (v: string) => void;
  filteredUnits: Unit[];
  filteredCalls: ActiveCall[];
  unitsByStatus: Record<string, number>;
  callsByPriority: Record<string, number>;
  panTo: (lat: number, lng: number) => void;
  handleCallStatusChange: (callId: string, newStatus: string) => void;
}

export default function MapSidebar({
  sidebarOpen, setSidebarOpen, sidebarTab, setSidebarTab,
  searchQuery, setSearchQuery, filteredUnits, filteredCalls,
  unitsByStatus, callsByPriority, panTo, handleCallStatusChange,
}: MapSidebarProps) {
  // Fix 98: sort units by status (available first, then dispatched, etc.)
  const sortedUnits = useMemo(() =>
    [...filteredUnits].sort((a, b) =>
      (STATUS_SORT_ORDER[a.status] ?? 9) - (STATUS_SORT_ORDER[b.status] ?? 9)
    ),
    [filteredUnits]
  );

  // Fix 99: sort calls by priority (P1 first)
  const sortedCalls = useMemo(() =>
    [...filteredCalls].sort((a, b) =>
      (PRIORITY_SORT_ORDER[a.priority] ?? 9) - (PRIORITY_SORT_ORDER[b.priority] ?? 9)
    ),
    [filteredCalls]
  );

  return (
    <div
      className={`flex flex-col panel-beveled transition-all duration-200 overflow-hidden ${sidebarOpen ? 'shadow-lg' : ''}`}
      style={{
        width: sidebarOpen ? 'clamp(220px, 20vw, 300px)' : 36,
        background: '#060c14',
        flexShrink: 0,
      }}
      aria-label="Map sidebar"
    >
      {/* #1: Collapse/expand toggle with smooth icon rotation */}
      <button type="button"
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="toolbar-btn flex items-center justify-center h-7 hover:bg-[#1a2636] transition-colors duration-150"
        style={{ borderRadius: 0 }}
        aria-expanded={sidebarOpen}
        aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
      >
        <ChevronDown className="w-3.5 h-3.5 text-rmpg-400 transition-transform duration-200" style={{ transform: sidebarOpen ? 'rotate(90deg)' : 'rotate(-90deg)' }} />
      </button>

      {sidebarOpen && (
        <>
          {/* Compact status counters */}
          <div className="flex items-center justify-center gap-2 px-2 py-1.5 panel-inset" style={{ background: '#0d1520' }}>
            {([
              { label: 'AVL', count: unitsByStatus['available'] || 0, color: '#22c55e' },
              { label: 'DSP', count: unitsByStatus['dispatched'] || 0, color: '#f59e0b' },
              { label: 'ENR', count: unitsByStatus['enroute'] || 0, color: '#3b82f6' },
              { label: 'ONS', count: unitsByStatus['onscene'] || 0, color: '#a855f7' },
              { label: 'BSY', count: unitsByStatus['busy'] || 0, color: '#ef4444' },
            ]).map(({ label, count, color }) => (
              <div key={label} className="flex items-center gap-0.5 transition-all duration-150 hover:scale-105" title={label}>
                {/* #2: LED dots with subtle glow matching status color */}
                <div className="led-dot" style={{ backgroundColor: color, width: 6, height: 6, boxShadow: count > 0 ? `0 0 4px ${color}80` : 'none' }} />
                <span className="text-[8px] font-mono font-bold tabular-nums" style={{ color }}>{count}</span>
              </div>
            ))}
            <div className="w-px h-3 bg-rmpg-700" />
            {callsByPriority['P1'] ? <span className="text-[8px] font-mono font-bold text-red-400">P1:{callsByPriority['P1']}</span> : null}
            {callsByPriority['P2'] ? <span className="text-[8px] font-mono font-bold text-amber-400">P2:{callsByPriority['P2']}</span> : null}
            {callsByPriority['P3'] ? <span className="text-[8px] font-mono font-bold text-blue-400">P3:{callsByPriority['P3']}</span> : null}
          </div>

          {/* #3: Tab bar with smooth active indicator transition */}
          <div className="tab-bar" role="tablist">
            <button type="button"
              onClick={() => setSidebarTab('units')}
              className={`tab-bar-item flex items-center justify-center gap-1.5 transition-all duration-200 ${sidebarTab === 'units' ? 'active border-b-2 border-[#60a5fa] text-rmpg-100' : 'text-rmpg-400 hover:text-rmpg-200'}`}
              role="tab"
              aria-selected={sidebarTab === 'units'}
            >
              <Shield className="w-3 h-3" /> Units <span className="text-[8px] font-mono font-bold text-green-400 tabular-nums">({sortedUnits.length})</span>
            </button>
            <button type="button"
              onClick={() => setSidebarTab('calls')}
              className={`tab-bar-item flex items-center justify-center gap-1.5 transition-all duration-200 ${sidebarTab === 'calls' ? 'active border-b-2 border-[#60a5fa] text-rmpg-100' : 'text-rmpg-400 hover:text-rmpg-200'}`}
              role="tab"
              aria-selected={sidebarTab === 'calls'}
            >
              <AlertTriangle className="w-3 h-3" /> Calls <span className="text-[8px] font-mono font-bold text-red-400 tabular-nums">({sortedCalls.length})</span>
            </button>
          </div>

          {/* #4: Search input with clear button and improved focus ring */}
          <div className="px-2 py-1.5" style={{ borderBottom: '1px solid #1e3048' }}>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-rmpg-500 pointer-events-none" />
              <input
                type="text"
                className="input-dark w-full text-[10px] py-1 pl-6 pr-6 focus:ring-1 focus:ring-[#888888] focus:border-[#888888] placeholder:text-[#5a6e80] transition-shadow duration-150"
                placeholder={sidebarTab === 'units' ? 'SEARCH UNITS...' : 'SEARCH CALLS...'}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label={sidebarTab === 'units' ? 'Search units' : 'Search calls'}
              />
              {searchQuery && (
                <button type="button" onClick={() => setSearchQuery('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 text-rmpg-500 hover:text-rmpg-300 transition-colors" aria-label="Clear search">
                  <span className="text-[9px] font-bold">&times;</span>
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-[#1e3048] scrollbar-track-transparent">
            {sidebarTab === 'units' && (
              <div className="divide-y divide-rmpg-700/50" role="tabpanel">
                {/* Fix 98: units sorted by status (available first) */}
                {sortedUnits.map((unit) => {
                  const hasCoords = unit.latitude != null && unit.longitude != null;
                  const statusColor = UNIT_STATUS_COLORS[unit.status];
                  // Fix 100: visual indicator for stale unit positions
                  const isStale = hasCoords && (unit as any).gps_updated_at
                    ? (Date.now() - new Date((unit as any).gps_updated_at).getTime()) > GPS_STALE_THRESHOLD_MS
                    : false;
                  return (
                    <button type="button"
                      key={unit.id}
                      onClick={() => hasCoords && panTo(unit.latitude!, unit.longitude!)}
                      className={`w-full text-left px-3 py-2.5 hover:bg-[#1a2636] transition-colors duration-100 ${
                        hasCoords ? 'cursor-pointer' : 'cursor-default opacity-60'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <div
                          className="led-dot flex-shrink-0"
                          style={{ backgroundColor: statusColor, boxShadow: `0 0 6px ${statusColor}80`, width: 10, height: 10 }}
                        />
                        <span className="text-[11px] font-mono font-bold text-rmpg-100">{unit.call_sign}</span>
                        {unit.gps_source === 'clearpathgps' && (
                          <span className="text-[7px] font-bold px-1 py-0 bg-blue-900/40 text-blue-400 border border-blue-700/30" title="ClearPathGPS Hardware Tracker">CPG</span>
                        )}
                        {/* #6: Stale GPS indicator with tooltip text */}
                        {isStale && (
                          <span title="GPS stale (>5m)" className="flex items-center"><AlertCircle className="w-3 h-3 text-amber-500 shrink-0 animate-pulse" /></span>
                        )}
                        {/* #7: GPS active indicator for units with coords */}
                        {hasCoords && !isStale && (
                          <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" style={{ boxShadow: '0 0 3px #22c55e80' }} title="GPS active" />
                        )}
                        {/* #5: Status badge with border for better contrast */}
                        <span className="text-[9px] font-mono ml-auto uppercase font-bold rounded-sm px-1 py-px" style={{ color: statusColor, background: `${statusColor}15`, border: `1px solid ${statusColor}30` }}>{UNIT_STATUS_LABELS[unit.status]}</span>
                      </div>
                      <div className="ml-5 mt-0.5">
                        <span className="text-[9px] text-rmpg-400">{unit.officer_name}</span>
                        {unit.call_number && (
                          <span className="text-[9px] text-blue-400 ml-2 font-mono">{unit.call_number}</span>
                        )}
                      </div>
                      {unit.current_call_type && (
                        <div className="ml-5 text-[8px] text-rmpg-500">{formatIncidentType(unit.current_call_type)}</div>
                      )}
                    </button>
                  );
                })}
                {sortedUnits.length === 0 && searchQuery && (
                  <div className="py-8 text-center">
                    <Search className="w-5 h-5 text-rmpg-600 mx-auto mb-2 opacity-50" />
                    <div className="text-[10px] text-rmpg-500 font-mono">No matches found</div>
                  </div>
                )}
                {sortedUnits.length === 0 && !searchQuery && (
                  <div className="py-8 text-center">
                    <Radio className="w-5 h-5 text-rmpg-600 mx-auto mb-2 opacity-50" />
                    <div className="text-[10px] text-rmpg-500 font-mono">No active units</div>
                  </div>
                )}
              </div>
            )}

            {sidebarTab === 'calls' && (
              <div className="divide-y divide-rmpg-700/50" role="tabpanel">
                {/* Fix 99: calls sorted by priority (P1 first) */}
                {sortedCalls.map((call) => {
                  const hasCoords = call.latitude != null && call.longitude != null;
                  const pColor = PRIORITY_COLORS[call.priority] || '#5a6e80';
                  const { category } = getIncidentCategory(call.incident_type);
                  return (
                    <button type="button"
                      key={call.id}
                      onClick={() => hasCoords && panTo(call.latitude!, call.longitude!)}
                      className={`w-full text-left px-3 py-2.5 hover:bg-[#1a2636] transition-colors duration-100 border-l-2 ${
                        hasCoords ? 'cursor-pointer' : 'cursor-default opacity-60'
                      }`}
                      style={{ borderLeftColor: pColor, borderLeftWidth: 3 }}
                    >
                      {/* #8: Priority badge with improved left border width */}
                      <div className="flex items-center gap-2">
                        <span
                          className="text-[8px] font-mono font-bold px-1.5 py-0.5 rounded-sm"
                          style={{ background: pColor + '25', color: pColor, border: `1px solid ${pColor}40` }}
                        >{call.priority}</span>
                        <span className="text-[10px] font-mono font-bold text-rmpg-100 flex-1">{call.call_number}</span>
                        <span className="text-[8px] font-mono text-rmpg-400 uppercase font-bold">{call.status.replace(/_/g, ' ')}</span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-1 ml-8">
                        <span className="text-[9px] font-bold px-1 py-0.5" style={{ background: pColor + '15', color: pColor, fontSize: '8px' }}>{category}</span>
                        <span className="text-[9px]" style={{ color: pColor }}>{formatIncidentType(call.incident_type)}</span>
                      </div>
                      <div className="ml-8 text-[8px] text-rmpg-500 truncate mt-0.5">{call.location_address}</div>
                      {call.property_name && (
                        <div className="ml-8 text-[8px] text-blue-400 truncate mt-0.5">{call.property_name}</div>
                      )}
                      {/* Quick actions */}
                      <div className="ml-8 mt-1.5 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        {call.status === 'pending' && (
                          <button type="button"
                            onClick={(e) => { e.stopPropagation(); handleCallStatusChange(call.id, 'dispatched'); }}
                            className="px-1.5 py-0.5 text-[8px] font-bold font-mono bg-amber-900/30 text-amber-400 border border-amber-700/40 hover:bg-amber-800/40 transition-colors"
                          >
                            DISPATCH
                          </button>
                        )}
                        {call.status === 'dispatched' && (
                          <button type="button"
                            onClick={(e) => { e.stopPropagation(); handleCallStatusChange(call.id, 'enroute'); }}
                            className="px-1.5 py-0.5 text-[8px] font-bold font-mono bg-blue-900/30 text-blue-400 border border-blue-700/40 hover:bg-blue-800/40 transition-colors"
                          >
                            EN ROUTE
                          </button>
                        )}
                        {call.status === 'enroute' && (
                          <button type="button"
                            onClick={(e) => { e.stopPropagation(); handleCallStatusChange(call.id, 'onscene'); }}
                            className="px-1.5 py-0.5 text-[8px] font-bold font-mono bg-purple-900/30 text-purple-400 border border-purple-700/40 hover:bg-purple-800/40 transition-colors"
                          >
                            ON SCENE
                          </button>
                        )}
                        {['dispatched', 'enroute', 'onscene'].includes(call.status) && (
                          <button type="button"
                            onClick={(e) => { e.stopPropagation(); handleCallStatusChange(call.id, 'cleared'); }}
                            className="px-1.5 py-0.5 text-[8px] font-bold font-mono bg-rmpg-700/30 text-rmpg-300 border border-rmpg-600/40 hover:bg-rmpg-600/40 transition-colors"
                          >
                            CLEAR
                          </button>
                        )}
                      </div>
                    </button>
                  );
                })}
                {sortedCalls.length === 0 && searchQuery && (
                  <div className="py-8 text-center">
                    <Search className="w-5 h-5 text-rmpg-600 mx-auto mb-2 opacity-50" />
                    <div className="text-[10px] text-rmpg-500 font-mono">No matches found</div>
                  </div>
                )}
                {sortedCalls.length === 0 && !searchQuery && (
                  <div className="py-8 text-center">
                    <PhoneOff className="w-5 h-5 text-rmpg-600 mx-auto mb-2 opacity-50" />
                    <div className="text-[10px] text-rmpg-500 font-mono">No active calls</div>
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
