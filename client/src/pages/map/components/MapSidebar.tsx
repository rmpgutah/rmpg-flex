import React from 'react';
import { Shield, AlertTriangle, Search, ChevronUp, ChevronDown } from 'lucide-react';
import { formatIncidentType } from '../../../utils/caseNumbers';
import type { UnitStatus } from '../../../types';
import { UNIT_STATUS_COLORS, UNIT_STATUS_LABELS, PRIORITY_COLORS, getIncidentCategory } from '../utils/mapConstants';
import type { MapUnit as Unit, ActiveCall } from '../utils/mapConstants';

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
  return (
    <div
      className="flex flex-col panel-beveled transition-all"
      style={{
        width: sidebarOpen ? 'clamp(220px, 20vw, 300px)' : 36,
        background: '#060c14',
        flexShrink: 0,
      }}
    >
      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="toolbar-btn flex items-center justify-center h-7"
        style={{ borderRadius: 0 }}
      >
        {sidebarOpen ? <ChevronUp className="w-3.5 h-3.5 text-rmpg-400 rotate-90" /> : <ChevronDown className="w-3.5 h-3.5 text-rmpg-400 -rotate-90" />}
      </button>

      {sidebarOpen && (
        <>
          {/* Compact status counters */}
          <div className="flex items-center justify-center gap-2 px-2 py-1.5 panel-inset" style={{ background: '#0a0a0a' }}>
            {([
              { label: 'AVL', count: unitsByStatus['available'] || 0, color: '#22c55e' },
              { label: 'DSP', count: unitsByStatus['dispatched'] || 0, color: '#f59e0b' },
              { label: 'ENR', count: unitsByStatus['enroute'] || 0, color: '#3b82f6' },
              { label: 'ONS', count: unitsByStatus['onscene'] || 0, color: '#a855f7' },
              { label: 'BSY', count: unitsByStatus['busy'] || 0, color: '#ef4444' },
            ]).map(({ label, count, color }) => (
              <div key={label} className="flex items-center gap-0.5" title={label}>
                <div className="led-dot" style={{ backgroundColor: color, width: 6, height: 6 }} />
                <span className="text-[8px] font-mono font-bold" style={{ color }}>{count}</span>
              </div>
            ))}
            <div className="w-px h-3 bg-rmpg-700" />
            {callsByPriority['P1'] ? <span className="text-[8px] font-mono font-bold text-red-400">P1:{callsByPriority['P1']}</span> : null}
            {callsByPriority['P2'] ? <span className="text-[8px] font-mono font-bold text-amber-400">P2:{callsByPriority['P2']}</span> : null}
            {callsByPriority['P3'] ? <span className="text-[8px] font-mono font-bold text-blue-400">P3:{callsByPriority['P3']}</span> : null}
          </div>

          <div className="tab-bar">
            <button
              onClick={() => setSidebarTab('units')}
              className={`tab-bar-item flex items-center justify-center gap-1.5 ${sidebarTab === 'units' ? 'active' : ''}`}
            >
              <Shield className="w-3 h-3" /> Units ({filteredUnits.length})
            </button>
            <button
              onClick={() => setSidebarTab('calls')}
              className={`tab-bar-item flex items-center justify-center gap-1.5 ${sidebarTab === 'calls' ? 'active' : ''}`}
            >
              <AlertTriangle className="w-3 h-3" /> Calls ({filteredCalls.length})
            </button>
          </div>

          <div className="px-2 py-1.5" style={{ borderBottom: '1px solid #303030' }}>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-rmpg-500" />
              <input
                type="text"
                className="input-dark w-full text-[10px] py-1 pl-6 pr-2"
                placeholder={sidebarTab === 'units' ? 'SEARCH UNITS...' : 'SEARCH CALLS...'}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {sidebarTab === 'units' && (
              <div className="divide-y divide-rmpg-700/50">
                {filteredUnits.map((unit) => {
                  const hasCoords = unit.latitude != null && unit.longitude != null;
                  const statusColor = UNIT_STATUS_COLORS[unit.status];
                  return (
                    <button
                      key={unit.id}
                      onClick={() => hasCoords && panTo(unit.latitude!, unit.longitude!)}
                      className={`w-full text-left px-3 py-2.5 hover:bg-rmpg-800/50 transition-colors ${
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
                        <span className="text-[9px] font-mono ml-auto uppercase font-bold" style={{ color: statusColor }}>{UNIT_STATUS_LABELS[unit.status]}</span>
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
                {filteredUnits.length === 0 && (
                  <div className="py-8 text-center text-[10px] text-rmpg-500 font-mono">No active units</div>
                )}
              </div>
            )}

            {sidebarTab === 'calls' && (
              <div className="divide-y divide-rmpg-700/50">
                {filteredCalls.map((call) => {
                  const hasCoords = call.latitude != null && call.longitude != null;
                  const pColor = PRIORITY_COLORS[call.priority] || '#5a6e80';
                  const { category } = getIncidentCategory(call.incident_type);
                  return (
                    <button
                      key={call.id}
                      onClick={() => hasCoords && panTo(call.latitude!, call.longitude!)}
                      className={`w-full text-left px-3 py-2.5 hover:bg-rmpg-800/50 transition-colors ${
                        hasCoords ? 'cursor-pointer' : 'cursor-default opacity-60'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className="text-[8px] font-mono font-bold px-1.5 py-0.5"
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
                          <button
                            onClick={(e) => { e.stopPropagation(); handleCallStatusChange(call.id, 'dispatched'); }}
                            className="px-1.5 py-0.5 text-[8px] font-bold font-mono bg-amber-900/30 text-amber-400 border border-amber-700/40 hover:bg-amber-800/40 transition-colors"
                          >
                            DISPATCH
                          </button>
                        )}
                        {call.status === 'dispatched' && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleCallStatusChange(call.id, 'enroute'); }}
                            className="px-1.5 py-0.5 text-[8px] font-bold font-mono bg-blue-900/30 text-blue-400 border border-blue-700/40 hover:bg-blue-800/40 transition-colors"
                          >
                            EN ROUTE
                          </button>
                        )}
                        {call.status === 'enroute' && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleCallStatusChange(call.id, 'onscene'); }}
                            className="px-1.5 py-0.5 text-[8px] font-bold font-mono bg-purple-900/30 text-purple-400 border border-purple-700/40 hover:bg-purple-800/40 transition-colors"
                          >
                            ON SCENE
                          </button>
                        )}
                        {['dispatched', 'enroute', 'onscene'].includes(call.status) && (
                          <button
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
                {filteredCalls.length === 0 && (
                  <div className="py-8 text-center text-[10px] text-rmpg-500 font-mono">No active calls</div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
