import React from 'react';
import { Layers, Eye, EyeOff, Shield, AlertTriangle, Building2, Thermometer, Route, Navigation2 } from 'lucide-react';
import { formatIncidentType } from '../../../utils/caseNumbers';
import MobileBottomSheet from '../../../components/mobile/MobileBottomSheet';
import { UNIT_STATUS_COLORS, UNIT_STATUS_LABELS, PRIORITY_COLORS, getIncidentCategory, MAP_STYLE_LABELS } from '../utils/mapConstants';
import type { MapUnit as Unit, ActiveCall, MapStyleId } from '../utils/mapConstants';

interface MapMobileSheetProps {
  mobileLayersOpen: boolean;
  setMobileLayersOpen: (v: boolean) => void;
  mobileSheetTab: 'layers' | 'units' | 'calls';
  setMobileSheetTab: (v: 'layers' | 'units' | 'calls') => void;
  layers: { units: boolean; incidents: boolean; properties: boolean };
  toggleLayer: (key: 'units' | 'incidents' | 'properties') => void;
  showHeatmap: boolean;
  setShowHeatmap: (v: boolean) => void;
  showBreadcrumbs: boolean;
  setShowBreadcrumbs: (v: boolean) => void;
  breadcrumbHours: number;
  setBreadcrumbHours: (v: number) => void;
  breadcrumbColorMode: 'unit' | 'speed' | 'status';
  setBreadcrumbColorMode: (v: 'unit' | 'speed' | 'status') => void;
  mapStyle: MapStyleId;
  setMapStyle: (v: MapStyleId) => void;
  filteredUnits: Unit[];
  filteredCalls: ActiveCall[];
  panTo: (lat: number, lng: number) => void;
  gps: {
    latitude: number | null;
    longitude: number | null;
  };
  mapInstanceRef: React.MutableRefObject<google.maps.Map | null>;
}

export default function MapMobileSheet({
  mobileLayersOpen, setMobileLayersOpen, mobileSheetTab, setMobileSheetTab,
  layers, toggleLayer, showHeatmap, setShowHeatmap,
  showBreadcrumbs, setShowBreadcrumbs, breadcrumbHours, setBreadcrumbHours,
  breadcrumbColorMode, setBreadcrumbColorMode,
  mapStyle, setMapStyle, filteredUnits, filteredCalls, panTo, gps, mapInstanceRef,
}: MapMobileSheetProps) {
  return (
    <>
      <button type="button"
        className="mobile-fab transition-all duration-200 ease-out active:scale-[0.97] shadow-[0_4px_16px_rgba(0,0,0,0.4)]"
        style={{
          position: 'absolute',
          bottom: 'calc(88px + env(safe-area-inset-bottom))',
          left: 16,
          zIndex: 20,
          width: 48,
          height: 48,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(13, 21, 32, 0.9)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          border: '1px solid #1e3048',
          borderRadius: 2,
        }}
        onClick={() => setMobileLayersOpen(!mobileLayersOpen)}
        aria-label="Toggle layers"
      >
        {/* #49: FAB icon with consistent sizing */}
        <Layers style={{ width: 20, height: 20, color: '#3b82f6' }} />
      </button>

      <MobileBottomSheet
        open={mobileLayersOpen}
        onClose={() => setMobileLayersOpen(false)}
        initialSnap="half"
        collapsedHeight={0}
        header={
          <div className="flex items-center gap-1" role="tablist">
            {([
              { id: 'layers' as const, icon: Layers, label: 'Layers', color: '#3b82f6' },
              { id: 'units' as const, icon: Shield, label: `Units (${filteredUnits.length})`, color: '#22c55e' },
              { id: 'calls' as const, icon: AlertTriangle, label: `Calls (${filteredCalls.length})`, color: '#ef4444' },
            ] as const).map(({ id, icon: Icon, label, color }) => (
              <button type="button"
                key={id}
                onClick={() => setMobileSheetTab(id)}
                role="tab"
                aria-selected={mobileSheetTab === id}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-all duration-150 active:scale-[0.97]"
                style={{
                  minHeight: 44,
                  color: mobileSheetTab === id ? color : '#6a7a8a',
                  background: mobileSheetTab === id ? `${color}10` : 'transparent',
                  borderBottom: mobileSheetTab === id ? `2px solid ${color}` : '2px solid transparent',
                }}
              >
                <Icon style={{ width: 12, height: 12 }} />
                {label}
              </button>
            ))}
          </div>
        }
      >
        {/* Layers Tab */}
        {mobileSheetTab === 'layers' && (
          <div className="px-4 py-3 space-y-2">
            {[
              { key: 'units' as const, icon: Shield, label: 'Units', color: '#22c55e' },
              { key: 'incidents' as const, icon: AlertTriangle, label: 'Active Calls', color: '#ef4444' },
              { key: 'properties' as const, icon: Building2, label: 'Properties', color: '#3b82f6' },
            ].map(({ key, icon: Icon, label, color }) => (
              <button type="button"
                key={key}
                onClick={() => toggleLayer(key)}
                aria-label={`Toggle ${label} layer`}
                role="switch"
                aria-checked={layers[key]}
                className="flex items-center gap-3 w-full px-4 py-3 text-left transition-all duration-150 active:scale-[0.98] hover:bg-[#1a2636]"
                style={{
                  background: layers[key] ? 'rgba(34,197,94,0.08)' : '#141e2b',
                  border: '1px solid #1e3048',
                  minHeight: 44,
                  borderRadius: 2,
                }}
              >
                {layers[key] ? <Eye className="w-4 h-4 text-green-400" /> : <EyeOff className="w-4 h-4 text-rmpg-500" />}
                <Icon style={{ width: 16, height: 16, color: layers[key] ? color : '#5a6e80' }} />
                <span className="text-sm text-rmpg-200 flex-1">{label}</span>
                {/* #50: Layer active indicator with LED glow */}
                {layers[key] && <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color, boxShadow: `0 0 8px ${color}80` }} />}
              </button>
            ))}

            <button type="button"
              onClick={() => setShowHeatmap(!showHeatmap)}
              role="switch"
              aria-checked={showHeatmap}
              aria-label="Toggle heat map"
              className="flex items-center gap-3 w-full px-4 py-3 text-left transition-all duration-150 active:scale-[0.98] hover:bg-[#1a2636]"
              style={{
                background: showHeatmap ? 'rgba(239,68,68,0.08)' : '#141e2b',
                border: '1px solid #1e3048',
                minHeight: 44,
                borderRadius: 2,
              }}
            >
              {showHeatmap ? <Eye className="w-4 h-4 text-red-400" /> : <EyeOff className="w-4 h-4 text-rmpg-500" />}
              <Thermometer style={{ width: 16, height: 16 }} className="text-red-400" />
              <span className="text-sm text-rmpg-200 flex-1">Heat Map</span>
              {showHeatmap && <div className="w-2 h-2 rounded-full bg-red-400" style={{ boxShadow: '0 0 6px rgba(239,68,68,0.8)' }} />}
            </button>

            <button type="button"
              onClick={() => setShowBreadcrumbs(!showBreadcrumbs)}
              role="switch"
              aria-checked={showBreadcrumbs}
              aria-label="Toggle breadcrumbs"
              className="flex items-center gap-3 w-full px-4 py-3 text-left transition-all duration-150 active:scale-[0.98] hover:bg-[#1a2636]"
              style={{
                background: showBreadcrumbs ? 'rgba(34,211,238,0.08)' : '#141e2b',
                border: '1px solid #1e3048',
                minHeight: 44,
                borderRadius: 2,
              }}
            >
              {showBreadcrumbs ? <Eye className="w-4 h-4 text-cyan-400" /> : <EyeOff className="w-4 h-4 text-rmpg-500" />}
              <Route style={{ width: 16, height: 16 }} className="text-cyan-400" />
              <span className="text-sm text-rmpg-200 flex-1">Breadcrumbs</span>
              {showBreadcrumbs && <div className="w-2 h-2 rounded-full bg-cyan-400" style={{ boxShadow: '0 0 6px rgba(34,211,238,0.8)' }} />}
            </button>

            {showBreadcrumbs && (
              <div className="px-4 py-3 space-y-2" style={{ background: '#0d1520', border: '1px solid #1e3048', borderRadius: 2 }}>
                <div className="flex gap-1">
                  {[2, 4, 8, 12, 24].map((h) => (
                    <button type="button"
                      key={h}
                      onClick={() => setBreadcrumbHours(h)}
                      className={`flex-1 py-2 text-xs font-bold rounded-sm ${
                        breadcrumbHours === h
                          ? 'bg-cyan-600 text-white'
                          : 'bg-rmpg-800 text-rmpg-400 hover:bg-rmpg-700'
                      }`}
                      style={{ minHeight: 44 }}
                    >
                      {h}h
                    </button>
                  ))}
                </div>
                <div className="flex gap-1">
                  {([['unit', 'Unit'], ['speed', 'Speed'], ['status', 'Status']] as const).map(([mode, label]) => (
                    <button type="button"
                      key={mode}
                      onClick={() => setBreadcrumbColorMode(mode)}
                      className={`flex-1 py-1.5 text-[10px] font-bold rounded-sm ${
                        breadcrumbColorMode === mode
                          ? 'bg-cyan-600 text-white'
                          : 'bg-rmpg-800 text-rmpg-400 hover:bg-rmpg-700'
                      }`}
                      style={{ minHeight: 44 }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Map Style Selector (mobile) */}
            <div className="px-4 py-3 space-y-1.5" style={{ background: '#0d1520', border: '1px solid #1e3048', borderRadius: 2 }}>
              <div className="text-[10px] font-bold text-rmpg-400 uppercase tracking-widest mb-1">Map Style</div>
              <div className="grid grid-cols-3 gap-1.5">
                {(Object.entries(MAP_STYLE_LABELS) as [MapStyleId, string][]).map(([key, label]) => {
                  const isActive = mapStyle === key;
                  return (
                    <button type="button"
                      key={key}
                      onClick={() => setMapStyle(key)}
                      className={`py-2 text-[10px] font-bold rounded-sm transition-all ${
                        isActive
                          ? 'bg-brand-600 text-white'
                          : 'bg-rmpg-800 text-rmpg-400 hover:bg-rmpg-700'
                      }`}
                      style={{ minHeight: 44 }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            <button type="button"
              onClick={() => {
                const map = mapInstanceRef.current;
                if (map && gps.latitude != null && gps.longitude != null) {
                  map.panTo({ lat: gps.latitude, lng: gps.longitude });
                  map.setZoom(16);
                }
              }}
              disabled={!gps?.latitude}
              aria-label="Center on my location"
              className="flex items-center gap-3 w-full px-4 py-3 text-left transition-all duration-150 active:scale-[0.98] hover:bg-[#1a2636]"
              style={{
                background: '#141e2b',
                border: '1px solid #1e3048',
                minHeight: 44,
                opacity: !gps?.latitude ? 0.5 : 1,
                borderRadius: 2,
              }}
            >
              <Navigation2 style={{ width: 16, height: 16 }} className="text-green-400" />
              <span className="text-sm text-rmpg-200 flex-1">Center on My Location</span>
            </button>
          </div>
        )}

        {/* Units Tab */}
        {mobileSheetTab === 'units' && (
          <div className="divide-y divide-rmpg-700/50">
            {filteredUnits.map((unit) => {
              const hasCoords = unit.latitude != null && unit.longitude != null;
              const statusColor = UNIT_STATUS_COLORS[unit.status];
              return (
                <button type="button"
                  key={unit.id}
                  onClick={() => { if (hasCoords) { panTo(unit.latitude!, unit.longitude!); setMobileLayersOpen(false); } }}
                  className={`w-full text-left px-4 py-3 transition-all duration-150 ${hasCoords ? 'active:bg-rmpg-700/30 active:scale-[0.99]' : 'opacity-60'}`}
                  style={{ minHeight: 44 }}
                >
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: statusColor, boxShadow: `0 0 6px ${statusColor}80` }} />
                    <span className="text-[12px] font-mono font-bold text-rmpg-100">{unit.call_sign}</span>
                    {unit.gps_source === 'clearpathgps' && (
                      <span className="text-[7px] font-bold px-1 py-0 bg-blue-900/40 text-blue-400 border border-blue-700/30" title="ClearPathGPS Hardware Tracker">CPG</span>
                    )}
                    <span className="text-[10px] font-mono ml-auto uppercase font-bold" style={{ color: statusColor }}>{UNIT_STATUS_LABELS[unit.status]}</span>
                  </div>
                  <div className="ml-5 mt-0.5 text-[10px] text-rmpg-400">{unit.officer_name}</div>
                  {unit.current_call_type && (
                    <div className="ml-5 text-[9px] text-rmpg-500">{formatIncidentType(unit.current_call_type)}</div>
                  )}
                </button>
              );
            })}
            {filteredUnits.length === 0 && (
              <div className="py-8 text-center text-[11px] text-rmpg-500">No active units</div>
            )}
          </div>
        )}

        {/* Calls Tab */}
        {mobileSheetTab === 'calls' && (
          <div className="divide-y divide-rmpg-700/50">
            {filteredCalls.map((call) => {
              const hasCoords = call.latitude != null && call.longitude != null;
              const pColor = PRIORITY_COLORS[call.priority] || '#5a6e80';
              const { category } = getIncidentCategory(call.incident_type);
              return (
                <button type="button"
                  key={call.id}
                  onClick={() => { if (hasCoords) { panTo(call.latitude!, call.longitude!); setMobileLayersOpen(false); } }}
                  className={`w-full text-left px-4 py-3 transition-all duration-150 ${hasCoords ? 'active:bg-rmpg-700/30 active:scale-[0.99]' : 'opacity-60'}`}
                  style={{ minHeight: 44 }}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded-sm" style={{ background: pColor + '25', color: pColor, border: `1px solid ${pColor}40` }}>{call.priority}</span>
                    <span className="text-[11px] font-mono font-bold text-rmpg-100 flex-1">{call.call_number}</span>
                    <span className="text-[9px] font-mono text-rmpg-400 uppercase font-bold">{call.status.replace(/_/g, ' ')}</span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-1 ml-8">
                    <span className="text-[8px] font-bold px-1 py-0.5 rounded-sm" style={{ background: pColor + '15', color: pColor }}>{category}</span>
                    <span className="text-[10px]" style={{ color: pColor }}>{formatIncidentType(call.incident_type)}</span>
                  </div>
                  <div className="ml-8 text-[9px] text-rmpg-500 truncate mt-0.5">{call.location_address}</div>
                </button>
              );
            })}
            {filteredCalls.length === 0 && (
              <div className="py-8 text-center text-[11px] text-rmpg-500">No active calls</div>
            )}
          </div>
        )}
      </MobileBottomSheet>
    </>
  );
}
