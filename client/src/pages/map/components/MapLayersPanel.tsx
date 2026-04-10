import React, { useState } from 'react';
import {
  Layers, Eye, EyeOff, Shield, AlertTriangle, Building2, Thermometer,
  Navigation2, Route, MapPin, Pencil, Square, Type, Trash2, Plus, X, Check,
  FileText, MousePointer2, CalendarDays, UserCheck, Copy, Save, Play, Pause,
  SkipForward, Gauge, Palette, PanelLeftClose, PanelLeftOpen, ChevronDown,
  ChevronUp, Globe2, Loader2, Map as MapIcon, Car, Ruler, Maximize2,
  Brain, ShieldAlert, Grab, Radar,
  Crosshair, FileSearch, Timer, Target, Scale, AlertOctagon, Sun,
} from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';
import { formatIncidentType } from '../../../utils/caseNumbers';
import { generatePatrolTrackingPdf } from '../../../utils/patrolTrackingPdfGenerator';
import { localToday, dateToLocalYMD } from '../../../utils/dateUtils';
import { useToast } from '../../../components/ToastProvider';
import { SHIFT_TYPES, type ShiftType } from '../../../hooks/useShiftPlanning';
import { PLAN_COLORS, PLAN_TYPE_LABELS, type PlanItemType } from '../../../hooks/useEventPlanning';
import { getSectionColor, type BeatDistrictEntry } from '../../../hooks/useGeoJsonLayers';
import type { MapStyleId } from '../utils/mapConstants';
import { MAP_STYLE_LABELS, MAP_STYLE_DESCRIPTIONS } from '../utils/mapConstants';
import type { MeasureMode } from '../hooks/useMapMeasurement';

interface MapLayersPanelProps {
  isConnected: boolean;
  layersPanelOpen: boolean;
  setLayersPanelOpen: (v: boolean) => void;
  layers: { units: boolean; incidents: boolean; properties: boolean };
  toggleLayer: (key: 'units' | 'incidents' | 'properties') => void;
  unitsWithCoords: any[];
  callsWithCoords: any[];
  propertiesWithCoords: any[];

  // Heatmap
  showHeatmap: boolean;
  setShowHeatmap: (v: boolean) => void;
  heatmapData: any[];
  heatmapDays: number;
  setHeatmapDays: (v: number) => void;
  heatmapMode: 'all' | 'risk' | 'type';
  setHeatmapMode: (v: 'all' | 'risk' | 'type') => void;
  heatmapTypeFilter: string;
  setHeatmapTypeFilter: (v: string) => void;
  heatmapTypes: { incident_type: string; count: number }[];

  // Tracking lines
  showTrackingLines: boolean;
  setShowTrackingLines: (v: boolean) => void;

  // Breadcrumbs
  showBreadcrumbs: boolean;
  setShowBreadcrumbs: (v: boolean) => void;
  breadcrumbHours: number;
  setBreadcrumbHours: (v: number) => void;
  exportingPdf: boolean;
  setExportingPdf: (v: boolean) => void;
  breadcrumbColorMode: 'unit' | 'speed' | 'status';
  setBreadcrumbColorMode: (v: 'unit' | 'speed' | 'status') => void;
  playbackTrails: any[];
  playbackUnit: number | null;
  setPlaybackUnit: (v: number | null) => void;
  playbackIdx: number;
  setPlaybackIdx: (v: number) => void;
  isPlaying: boolean;
  setIsPlaying: (v: boolean) => void;
  playbackSpeed: number;
  setPlaybackSpeed: (v: number) => void;
  playbackAnimRef: React.MutableRefObject<number | null>;
  playbackMarkerRef: React.MutableRefObject<any>;

  // Map style
  mapStyle: MapStyleId;
  setMapStyle: (v: MapStyleId) => void;

  // GeoJSON layers
  geoLayerStates: Record<string, any>;
  geoConfigs: any[];
  toggleGeoLayer: (id: string) => void;
  ensureLayerLoaded: (id: string) => void;

  // District legend
  districtSections: { id: string; name: string }[];
  beatDistrictMap: Map<string, Map<string, BeatDistrictEntry>> | undefined;

  // Shift planning (complex nested state from useShiftPlanning hook)
  shiftPlanning: any; // eslint-disable-line @typescript-eslint/no-explicit-any

  // Event planning (complex nested state from useEventPlanning hook)
  eventPlanning: any; // eslint-disable-line @typescript-eslint/no-explicit-any

  // Traffic layer (optional — wired up when traffic layer feature is enabled)
  showTraffic?: boolean;
  onToggleTraffic?: () => void;

  // Measurement tool (optional — wired up when measurement feature is enabled)
  measuring?: boolean;
  measureMode?: MeasureMode | null;
  onStartMeasure?: (mode: MeasureMode) => void;
  onClearMeasurement?: () => void;

  // Tactical map features (optional — wired when tactical upgrade is enabled)
  showTimelapse?: boolean;
  setShowTimelapse?: (v: boolean) => void;
  timelapse?: { isPlaying: boolean; setIsPlaying: (v: boolean) => void; speed: 1 | 2 | 4; setSpeed: (v: 1 | 2 | 4) => void; currentIndex: number; setCurrentIndex: (v: number) => void; totalSlices: number; currentLabel: string; loading: boolean };
  showPredictions?: boolean;
  setShowPredictions?: (v: boolean) => void;
  predictionsCount?: number;
  showSafetyZones?: boolean;
  setShowSafetyZones?: (v: boolean) => void;
  safetyZonesCount?: number;
  showGeofences?: boolean;
  setShowGeofences?: (v: boolean) => void;
  geofencesCount?: number;
  geofenceDrawingMode?: boolean;
  onToggleGeofenceDraw?: () => void;
  dragDispatchMode?: boolean;
  setDragDispatchMode?: (v: boolean) => void;
  intelLayers?: { warrants: boolean; trespass: boolean; offenders: boolean; bolos: boolean };
  toggleIntelLayer?: (layer: 'warrants' | 'trespass' | 'offenders' | 'bolos') => void;
  intelCounts?: { warrants: number; trespass: number; offenders: number; bolos: number };

  // Patrol Checkpoints
  showPatrolCheckpoints?: boolean;
  setShowPatrolCheckpoints?: (v: boolean) => void;
  patrolCheckpointsOverdue?: number;
  patrolCheckpointsCount?: number;

  // Field Interviews
  showFieldInterviews?: boolean;
  setShowFieldInterviews?: (v: boolean) => void;
  fiDays?: number;
  setFiDays?: (v: number) => void;
  fieldInterviewCount?: number;

  // Dwell Time
  showDwellTime?: boolean;
  setShowDwellTime?: (v: boolean) => void;
  dwellAlertCount?: number;

  // Response Radius
  showResponseRadius?: boolean;
  setShowResponseRadius?: (v: boolean) => void;
  responseRadiusActive?: boolean;

  // Enforcement Clusters
  showEnforcementClusters?: boolean;
  setShowEnforcementClusters?: (v: boolean) => void;
  enforcementType?: 'citations' | 'arrests';
  setEnforcementType?: (v: 'citations' | 'arrests') => void;
  enforcementDays?: number;
  setEnforcementDays?: (v: number) => void;
  enforcementTotalRecords?: number;

  // Coverage Map
  showCoverage?: boolean;
  setShowCoverage?: (v: boolean) => void;
  coverageRadius?: number;
  setCoverageRadius?: (v: number) => void;
  coverageCount?: number;

  // Fleet Vehicles
  showFleetVehicles?: boolean;
  setShowFleetVehicles?: (v: boolean) => void;
  fleetVehicleCount?: number;

  // Repeat Addresses
  showRepeatAddresses?: boolean;
  setShowRepeatAddresses?: (v: boolean) => void;
  repeatDays?: number;
  setRepeatDays?: (v: number) => void;
  repeatMinCount?: number;
  setRepeatMinCount?: (v: number) => void;
  repeatAddressCount?: number;

  // Panic Zone
  showPanicZone?: boolean;
  setShowPanicZone?: (v: boolean) => void;
  panicActive?: boolean;

  // Daylight Overlay
  showDaylight?: boolean;
  setShowDaylight?: (v: boolean) => void;
  daylightPhase?: string;
}

export default function MapLayersPanel(props: MapLayersPanelProps) {
  const { addToast } = useToast();

  const [showMapStyles, setShowMapStyles] = useState(false);
  const [showGeoPanel, setShowGeoPanel] = useState(false);
  const [showDistrictLegend, setShowDistrictLegend] = useState(false);
  const [showShiftPanel, setShowShiftPanel] = useState(false);
  const [showEventPanel, setShowEventPanel] = useState(false);

  // Collapsible category group states
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem('rmpg_map_layer_groups');
      return saved ? JSON.parse(saved) : {};
    } catch { return {}; }
  });
  const toggleGroup = (group: string) => {
    setCollapsedGroups(prev => {
      const next = { ...prev, [group]: !prev[group] };
      try { localStorage.setItem('rmpg_map_layer_groups', JSON.stringify(next)); } catch { /* noop */ }
      return next;
    });
  };
  const [newPlanName, setNewPlanName] = useState('');
  const [newShiftPlanName, setNewShiftPlanName] = useState('');
  const [newShiftPlanDate, setNewShiftPlanDate] = useState(() => localToday());
  const [newShiftPlanType, setNewShiftPlanType] = useState<ShiftType>('day');
  const [assignOfficerIds, setAssignOfficerIds] = useState<string[]>([]);
  const [assignUnitIds, setAssignUnitIds] = useState<string[]>([]);
  const [assignNotes, setAssignNotes] = useState('');

  const {
    layersPanelOpen, setLayersPanelOpen, isConnected, layers, toggleLayer,
    unitsWithCoords, callsWithCoords, propertiesWithCoords,
    showHeatmap, setShowHeatmap, heatmapData, heatmapDays, setHeatmapDays,
    heatmapMode, setHeatmapMode, heatmapTypeFilter, setHeatmapTypeFilter, heatmapTypes,
    showTrackingLines, setShowTrackingLines,
    showBreadcrumbs, setShowBreadcrumbs, breadcrumbHours, setBreadcrumbHours,
    exportingPdf, setExportingPdf, breadcrumbColorMode, setBreadcrumbColorMode,
    playbackTrails, playbackUnit, setPlaybackUnit, playbackIdx, setPlaybackIdx,
    isPlaying, setIsPlaying, playbackSpeed, setPlaybackSpeed,
    playbackAnimRef, playbackMarkerRef,
    mapStyle, setMapStyle,
    geoLayerStates, geoConfigs, toggleGeoLayer, ensureLayerLoaded,
    districtSections,
    shiftPlanning, eventPlanning,
    showTraffic, onToggleTraffic,
    measuring, measureMode, onStartMeasure, onClearMeasurement,
    showTimelapse, setShowTimelapse, timelapse,
    showPredictions, setShowPredictions, predictionsCount,
    showSafetyZones, setShowSafetyZones, safetyZonesCount,
    showGeofences, setShowGeofences, geofencesCount, geofenceDrawingMode, onToggleGeofenceDraw,
    dragDispatchMode, setDragDispatchMode,
    intelLayers, toggleIntelLayer, intelCounts,
    showPatrolCheckpoints, setShowPatrolCheckpoints, patrolCheckpointsOverdue, patrolCheckpointsCount,
    showFieldInterviews, setShowFieldInterviews, fiDays, setFiDays, fieldInterviewCount,
    showDwellTime, setShowDwellTime, dwellAlertCount,
    showResponseRadius, setShowResponseRadius, responseRadiusActive,
    showEnforcementClusters, setShowEnforcementClusters, enforcementType, setEnforcementType, enforcementDays, setEnforcementDays, enforcementTotalRecords,
    showCoverage, setShowCoverage, coverageRadius, setCoverageRadius, coverageCount,
    showFleetVehicles, setShowFleetVehicles, fleetVehicleCount,
    showRepeatAddresses, setShowRepeatAddresses, repeatDays, setRepeatDays, repeatMinCount, setRepeatMinCount, repeatAddressCount,
    showPanicZone, setShowPanicZone, panicActive,
    showDaylight, setShowDaylight, daylightPhase,
  } = props;

  if (!layersPanelOpen) {
    return (
      <button type="button"
        onClick={() => setLayersPanelOpen(true)}
        className="bg-black/30 border border-white/15 backdrop-blur-md p-2 hover:bg-black/50 transition-colors shadow-lg"
        style={{ borderRadius: 2 }}
        title="Show layers"
      >
        <PanelLeftOpen className="w-4 h-4" />
      </button>
    );
  }

  return (
    <div className="bg-surface-deep/95 border border-rmpg-600 backdrop-blur-sm shadow-lg transition-all duration-200" style={{ width: 'clamp(160px, 14vw, 200px)', borderRadius: 2 }}>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-rmpg-700">
        <Layers className="w-3.5 h-3.5 text-brand-400" />
        <span className="text-[10px] font-bold text-rmpg-300 uppercase tracking-widest flex-1">Layers</span>
        <div className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-green-400 animate-pulse' : 'bg-red-500'}`} />
        <button type="button"
          onClick={() => setLayersPanelOpen(false)}
          className="toolbar-btn hover:bg-[#181818] transition-colors duration-150"
          style={{ padding: '0 2px' }}
          title="Hide layers"
        >
          <PanelLeftClose style={{ width: 10, height: 10 }} />
        </button>
      </div>

      <div className="p-1.5 space-y-0.5">
        {/* Fix 93: Core layers group with All On/Off */}
        <div className="flex items-center justify-between mb-0.5 px-1 pb-1 border-b border-[#2b2b2b]/50">
          <span className="text-[8px] text-rmpg-500 uppercase tracking-widest font-bold">Core</span>
          <div className="flex gap-1">
            <button type="button"
              onClick={() => { (['units', 'incidents', 'properties'] as const).forEach(k => { if (!layers[k]) toggleLayer(k); }); }}
              className="text-[7px] font-bold text-green-400 hover:text-green-300 px-1"
              title="Enable all core layers"
            >ON</button>
            <button type="button"
              onClick={() => { (['units', 'incidents', 'properties'] as const).forEach(k => { if (layers[k]) toggleLayer(k); }); }}
              className="text-[7px] font-bold text-red-400 hover:text-red-300 px-1"
              title="Disable all core layers"
            >OFF</button>
          </div>
        </div>
        {[
          { key: 'units' as const, icon: <Shield className="w-3 h-3" />, label: 'Units', count: unitsWithCoords.length, color: '#22c55e' },
          { key: 'incidents' as const, icon: <AlertTriangle className="w-3 h-3" />, label: 'Active Calls', count: callsWithCoords.length, color: '#ef4444' },
          { key: 'properties' as const, icon: <Building2 className="w-3 h-3" />, label: 'Properties', count: propertiesWithCoords.length, color: '#888888' },
        ].map(({ key, icon, label, count, color }) => (
          <button type="button"
            key={key}
            onClick={() => toggleLayer(key)}
            className={`flex items-center gap-2 w-full px-2 py-1.5 text-left transition-all duration-200 hover:bg-[#181818]/50 ${
              layers[key] ? 'panel-inset bg-surface-deep' : 'opacity-40 hover:opacity-70'
            }`}
            role="switch"
            aria-checked={layers[key]}
            aria-label={`Toggle ${label} layer`}
          >
            {layers[key] ? <Eye className="w-3 h-3 text-green-400" /> : <EyeOff className="w-3 h-3 text-rmpg-500" />}
            {layers[key] && <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color, boxShadow: `0 0 4px ${color}` }} />}
            <span style={{ color: layers[key] ? color : '#666666' }}>{icon}</span>
            <span className="text-[10px] text-rmpg-200 flex-1">{label}</span>
            {/* Fix 92: show feature count next to each toggle */}
            <span className="text-[9px] font-mono font-bold" style={{ color: layers[key] ? color : '#666666' }}>{count}</span>
          </button>
        ))}

        {/* Live Tracking group header */}
        <button type="button"
          onClick={() => toggleGroup('tracking')}
          className="flex items-center justify-between w-full px-1 py-0.5 mt-1 border-t border-[#2b2b2b]/50"
        >
          <span className="text-[8px] text-rmpg-500 uppercase tracking-widest font-bold">Live Tracking</span>
          {collapsedGroups.tracking ? <ChevronDown className="w-2.5 h-2.5 text-rmpg-500" /> : <ChevronUp className="w-2.5 h-2.5 text-rmpg-500" />}
        </button>

        {!collapsedGroups.tracking && <>
        {/* Heat Map */}
        <button type="button"
          onClick={() => setShowHeatmap(!showHeatmap)}
          className={`flex items-center gap-2 w-full px-2 py-1.5 text-left transition-all duration-200 hover:bg-[#181818]/50 ${
            showHeatmap ? 'panel-inset bg-surface-deep' : 'opacity-40 hover:opacity-70'
          }`}
          role="switch"
          aria-checked={showHeatmap}
          aria-label="Toggle Heat Map layer"
        >
          {showHeatmap ? <Eye className="w-3 h-3 text-red-400" /> : <EyeOff className="w-3 h-3 text-rmpg-500" />}
          <Thermometer className="w-3 h-3 text-red-400" />
          <span className="text-[10px] text-rmpg-200 flex-1">Heat Map</span>
          {showHeatmap && (
            <span className="text-[8px] text-red-400 font-mono font-bold">{heatmapData.length} pts</span>
          )}
        </button>
        {showHeatmap && (
          <div className="px-3 py-1 space-y-1">
            <div className="flex items-center gap-1">
              {[7, 14, 30, 90].map((days) => (
                <button type="button"
                  key={days}
                  onClick={() => setHeatmapDays(days)}
                  className={`px-1.5 py-0.5 text-[8px] font-mono font-bold rounded-sm transition-colors ${
                    heatmapDays === days
                      ? 'bg-red-900/50 text-red-400 border border-red-700/50'
                      : 'text-rmpg-500 hover:text-rmpg-300'
                  }`}
                >
                  {days}d
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1">
              {([['all', 'All'], ['risk', 'Risk'], ['type', 'Type']] as const).map(([mode, label]) => (
                <button type="button"
                  key={mode}
                  onClick={() => { setHeatmapMode(mode); if (mode !== 'type') setHeatmapTypeFilter(''); }}
                  className={`px-1.5 py-0.5 text-[8px] font-mono font-bold rounded-sm transition-colors ${
                    heatmapMode === mode
                      ? mode === 'risk' ? 'bg-orange-900/50 text-orange-400 border border-orange-700/50'
                      : 'bg-red-900/50 text-red-400 border border-red-700/50'
                      : 'text-rmpg-500 hover:text-rmpg-300'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {heatmapMode === 'type' && (
              <select
                value={heatmapTypeFilter}
                onChange={(e) => setHeatmapTypeFilter(e.target.value)}
                className="w-full bg-surface-deep border border-rmpg-600 text-[9px] text-rmpg-200 px-1.5 py-0.5 font-mono focus:outline-none focus:border-red-600"
                style={{ borderRadius: 2 }}
              >
                <option value="">Select type...</option>
                {heatmapTypes.map((t) => (
                  <option key={t.incident_type} value={t.incident_type}>
                    {formatIncidentType(t.incident_type)} ({t.count})
                  </option>
                ))}
              </select>
            )}

            {/* Timelapse controls */}
            {setShowTimelapse && timelapse && (
              <div className="border-t border-rmpg-700/50 pt-1 mt-1">
                <button type="button"
                  onClick={() => setShowTimelapse(!showTimelapse)}
                  className={`flex items-center gap-1.5 w-full text-[9px] font-bold transition-colors ${
                    showTimelapse ? 'text-orange-400' : 'text-rmpg-500 hover:text-rmpg-300'
                  }`}
                >
                  <SkipForward className="w-2.5 h-2.5" />
                  <span className="flex-1 text-left">Time-Lapse</span>
                  {showTimelapse && <span className="led-dot led-orange" style={{ width: 5, height: 5 }} />}
                </button>
                {showTimelapse && (
                  <div className="mt-1 space-y-1">
                    <div className="flex items-center gap-1">
                      <button type="button"
                        onClick={() => timelapse.setIsPlaying(!timelapse.isPlaying)}
                        className="p-0.5 rounded-sm hover:bg-orange-900/40 transition-colors"
                      >
                        {timelapse.isPlaying ? <Pause className="w-3 h-3 text-amber-400" /> : <Play className="w-3 h-3 text-green-400" />}
                      </button>
                      <input
                        type="range"
                        min={0}
                        max={Math.max(timelapse.totalSlices - 1, 0)}
                        value={timelapse.currentIndex}
                        onChange={(e) => { timelapse.setCurrentIndex(Number(e.target.value)); timelapse.setIsPlaying(false); }}
                        className="flex-1 h-1 accent-orange-400"
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[7px] font-mono text-orange-300">{timelapse.currentLabel}</span>
                      <div className="flex items-center gap-0.5">
                        {([1, 2, 4] as const).map((s) => (
                          <button type="button"
                            key={s}
                            onClick={() => timelapse.setSpeed(s)}
                            className={`px-1 py-0 text-[7px] font-mono font-bold rounded-sm transition-colors ${
                              timelapse.speed === s ? 'bg-orange-900/50 text-orange-400 border border-orange-700/50' : 'text-rmpg-500 hover:text-rmpg-300'
                            }`}
                          >
                            {s}x
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Traffic Layer */}
        <button type="button"
          onClick={() => onToggleTraffic?.()}
          className={`flex items-center gap-2 w-full px-2 py-1.5 text-left transition-all duration-200 hover:bg-[#181818]/50 ${
            showTraffic ? 'panel-inset bg-surface-deep' : 'opacity-40 hover:opacity-70'
          }`}
          role="switch"
          aria-checked={!!showTraffic}
          aria-label="Toggle Traffic layer"
        >
          {showTraffic ? <Eye className="w-3 h-3 text-amber-400" /> : <EyeOff className="w-3 h-3 text-rmpg-500" />}
          <Car className="w-3 h-3 text-amber-400" />
          <span className="text-[10px] text-rmpg-200 flex-1">Traffic</span>
        </button>

        {/* Tracking Lines */}
        <button type="button"
          onClick={() => setShowTrackingLines(!showTrackingLines)}
          className={`flex items-center gap-2 w-full px-2 py-1.5 text-left transition-all duration-200 hover:bg-[#181818]/50 ${
            showTrackingLines ? 'panel-inset bg-surface-deep' : 'opacity-40 hover:opacity-70'
          }`}
          role="switch"
          aria-checked={showTrackingLines}
          aria-label="Toggle Tracking Lines layer"
        >
          {showTrackingLines ? <Eye className="w-3 h-3 text-green-400" /> : <EyeOff className="w-3 h-3 text-rmpg-500" />}
          <Navigation2 className="w-3 h-3 text-green-400" />
          <span className="text-[10px] text-rmpg-200 flex-1">Tracking Lines</span>
        </button>

        {/* Breadcrumbs */}
        <button type="button"
          onClick={() => setShowBreadcrumbs(!showBreadcrumbs)}
          className={`flex items-center gap-2 w-full px-2 py-1.5 text-left transition-all duration-200 hover:bg-[#181818]/50 ${
            showBreadcrumbs ? 'panel-inset bg-surface-deep' : 'opacity-40 hover:opacity-70'
          }`}
          role="switch"
          aria-checked={showBreadcrumbs}
          aria-label="Toggle Breadcrumbs layer"
        >
          {showBreadcrumbs ? <Eye className="w-3 h-3 text-cyan-400" /> : <EyeOff className="w-3 h-3 text-rmpg-500" />}
          <Route className="w-3 h-3 text-cyan-400" />
          <span className="text-[10px] text-rmpg-200 flex-1">Breadcrumbs</span>
        </button>
        {showBreadcrumbs && (
          <div className="px-3 py-1 space-y-1">
            <div className="flex items-center gap-1">
              {[2, 4, 8, 12, 24].map((h) => (
                <button type="button"
                  key={h}
                  onClick={() => setBreadcrumbHours(h)}
                  className={`px-1.5 py-0.5 text-[8px] font-mono font-bold rounded-sm transition-colors ${
                    breadcrumbHours === h
                      ? 'bg-cyan-900/50 text-cyan-400 border border-cyan-700/50'
                      : 'text-rmpg-500 hover:text-rmpg-300'
                  }`}
                >
                  {h}h
                </button>
              ))}
              <button type="button"
                onClick={async () => {
                  setExportingPdf(true);
                  try {
                    const data = await apiFetch<any>(`/reports/patrol-tracking?hours=${breadcrumbHours}&geocode=true`);
                    if (!data?.trails?.length) { addToast('No tracking data for this period.', 'warning'); return; }
                    await generatePatrolTrackingPdf(data);
                  } catch (err: any) {
                    addToast(err?.message || 'Failed to export PDF', 'error');
                  } finally { setExportingPdf(false); }
                }}
                disabled={exportingPdf}
                className="px-1.5 py-0.5 text-[8px] font-mono font-bold rounded-sm transition-colors text-brand-400 hover:bg-brand-900/30 ml-1 flex items-center gap-0.5"
                title="Export patrol tracking PDF"
              >
                {exportingPdf ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <FileText className="w-2.5 h-2.5" />}
                PDF
              </button>
            </div>
            <div className="flex items-center gap-1">
              <Palette className="w-2.5 h-2.5 text-rmpg-400" />
              {([['unit', 'Unit'], ['speed', 'Speed'], ['status', 'Status']] as const).map(([mode, label]) => (
                <button type="button"
                  key={mode}
                  onClick={() => setBreadcrumbColorMode(mode)}
                  className={`px-1.5 py-0.5 text-[8px] font-mono font-bold rounded-sm transition-colors ${
                    breadcrumbColorMode === mode
                      ? 'bg-cyan-900/50 text-cyan-400 border border-cyan-700/50'
                      : 'text-rmpg-500 hover:text-rmpg-300'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {breadcrumbColorMode === 'speed' && (
              <div className="flex items-center gap-1.5 pl-1">
                {[['#22c55e', '<15'], ['#eab308', '15-35'], ['#f97316', '35-55'], ['#ef4444', '55+']].map(([color, label]) => (
                  <span key={label} className="flex items-center gap-0.5">
                    <span className="w-2 h-2 rounded-full" style={{ background: color }} />
                    <span className="text-[7px] text-rmpg-400 font-mono">{label}</span>
                  </span>
                ))}
                <span className="text-[7px] text-rmpg-500 font-mono">mph</span>
              </div>
            )}
            {playbackTrails.length > 0 && (
              <div className="space-y-1 pt-0.5">
                <div className="flex items-center gap-1">
                  <Play className="w-2.5 h-2.5 text-green-400" />
                  <select
                    value={playbackUnit ?? ''}
                    onChange={(e) => {
                      const val = e.target.value ? Number(e.target.value) : null;
                      setPlaybackUnit(val);
                      setPlaybackIdx(0);
                      setIsPlaying(false);
                    }}
                    className="flex-1 bg-surface-deep border border-rmpg-600 text-[9px] text-rmpg-200 px-1 py-0.5 font-mono focus:outline-none focus:border-cyan-600"
                    style={{ borderRadius: 2 }}
                  >
                    <option value="">Replay trail...</option>
                    {playbackTrails.map((t: { unit_id: string; call_sign: string; points: { length: number } }) => (
                      <option key={t.unit_id} value={t.unit_id}>
                        {t.call_sign} ({t.points.length} pts)
                      </option>
                    ))}
                  </select>
                </div>
                {playbackUnit != null && (() => {
                  const activeTrail = playbackTrails.find((t: any) => t.unit_id === playbackUnit);
                  const totalPts = activeTrail?.points?.length || 0;
                  const currentPt = activeTrail?.points?.[playbackIdx];
                  return (
                    <div className="space-y-1">
                      <div className="flex items-center gap-1">
                        <button type="button"
                          onClick={() => {
                            if (isPlaying) {
                              setIsPlaying(false);
                              if (playbackAnimRef.current) { clearTimeout(playbackAnimRef.current); playbackAnimRef.current = null; }
                            } else {
                              if (playbackIdx >= totalPts - 1) setPlaybackIdx(0);
                              setIsPlaying(true);
                            }
                          }}
                          className="p-0.5 rounded-sm hover:bg-cyan-900/40 transition-colors"
                          title={isPlaying ? 'Pause' : 'Play'}
                        >
                          {isPlaying ? <Pause className="w-3 h-3 text-amber-400" /> : <Play className="w-3 h-3 text-green-400" />}
                        </button>
                        <input
                          type="range"
                          min={0}
                          max={Math.max(totalPts - 1, 0)}
                          value={playbackIdx}
                          onChange={(e) => {
                            const idx = Number(e.target.value);
                            setPlaybackIdx(idx);
                            setIsPlaying(false);
                            if (playbackAnimRef.current) { clearTimeout(playbackAnimRef.current); playbackAnimRef.current = null; }
                            const pt = activeTrail?.points?.[idx];
                            if (pt && playbackMarkerRef.current) {
                              playbackMarkerRef.current.setPosition({ lat: pt.lat, lng: pt.lng });
                            }
                          }}
                          className="flex-1 h-1 accent-cyan-400"
                        />
                        <span className="text-[8px] font-mono text-rmpg-400 w-12 text-right">
                          {playbackIdx + 1}/{totalPts}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Gauge className="w-2.5 h-2.5 text-rmpg-400" />
                        {[1, 2, 5, 10].map((spd) => (
                          <button type="button"
                            key={spd}
                            onClick={() => setPlaybackSpeed(spd)}
                            className={`px-1 py-0 text-[7px] font-mono font-bold rounded-sm transition-colors ${
                              playbackSpeed === spd
                                ? 'bg-cyan-900/50 text-cyan-400 border border-cyan-700/50'
                                : 'text-rmpg-500 hover:text-rmpg-300'
                            }`}
                          >
                            {spd}x
                          </button>
                        ))}
                        {currentPt && (
                          <span className="text-[7px] font-mono text-rmpg-400 ml-auto">
                            {currentPt.speed != null ? `${(currentPt.speed * 2.237).toFixed(0)} mph` : ''}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        )}
      </>}
      </div>

      {/* Measurement Tools */}
      <div className="border-t border-rmpg-700 p-1.5">
        <div className="flex items-center gap-1 px-2 py-1 border-b border-[#2b2b2b]/50 pb-1 mb-0.5">
          <Ruler className="w-3 h-3" style={{ color: '#d4a017' }} />
          <span className="text-[10px] text-rmpg-300 flex-1">Measure</span>
        </div>
        <div className="flex items-center gap-1 px-2">
          <button type="button"
            onClick={() => onStartMeasure?.('distance')}
            className={`flex items-center gap-1 px-2 py-1 text-[9px] font-mono font-bold transition-colors ${
              measuring && measureMode === 'distance'
                ? 'bg-yellow-900/40 border border-yellow-700/50'
                : 'text-rmpg-400 hover:text-rmpg-200 hover:bg-rmpg-800/50 border border-transparent'
            }`}
            style={{ borderRadius: 2, color: measuring && measureMode === 'distance' ? '#d4a017' : undefined }}
            title="Measure distance"
          >
            <Ruler className="w-2.5 h-2.5" />
            Dist
          </button>
          <button type="button"
            onClick={() => onStartMeasure?.('area')}
            className={`flex items-center gap-1 px-2 py-1 text-[9px] font-mono font-bold transition-colors ${
              measuring && measureMode === 'area'
                ? 'bg-yellow-900/40 border border-yellow-700/50'
                : 'text-rmpg-400 hover:text-rmpg-200 hover:bg-rmpg-800/50 border border-transparent'
            }`}
            style={{ borderRadius: 2, color: measuring && measureMode === 'area' ? '#d4a017' : undefined }}
            title="Measure area"
          >
            <Maximize2 className="w-2.5 h-2.5" />
            Area
          </button>
          {measureMode && (
            <button type="button"
              onClick={onClearMeasurement}
              className="px-1.5 py-1 text-[9px] font-mono font-bold text-red-400 hover:bg-red-900/30 transition-colors ml-auto"
              style={{ borderRadius: 2 }}
              title="Clear measurement">
              <X className="w-2.5 h-2.5" />
            </button>
          )}
        </div>
      </div>

      <div className="border-t border-rmpg-700 p-1.5">
        <button type="button"
          onClick={() => setShowMapStyles(!showMapStyles)}
          className="flex items-center gap-2 w-full px-2 py-1.5 text-left transition-colors hover:bg-rmpg-800/50"
        >
          <MapIcon className="w-3 h-3 text-rmpg-400" />
          <span className="text-[10px] text-rmpg-300 flex-1">Map Style</span>
          <span className="text-[9px] text-brand-400 font-bold">{MAP_STYLE_LABELS[mapStyle]}</span>
          {showMapStyles ? <ChevronUp className="w-2.5 h-2.5 text-rmpg-500" /> : <ChevronDown className="w-2.5 h-2.5 text-rmpg-500" />}
        </button>
        {showMapStyles && (
          <div className="mt-1 grid grid-cols-2 gap-1 px-1">
            {(Object.entries(MAP_STYLE_LABELS) as [MapStyleId, string][]).map(([key, label]) => {
              const isActive = mapStyle === key;
              const desc = MAP_STYLE_DESCRIPTIONS[key];
              return (
                <button type="button"
                  key={key}
                  onClick={() => { setMapStyle(key); setShowMapStyles(false); }}
                  className={`text-left px-2 py-1.5 rounded-sm transition-all ${
                    isActive
                      ? 'bg-brand-900/30 border border-brand-500/50 ring-1 ring-brand-500/20'
                      : 'bg-rmpg-800/30 border border-rmpg-700/50 hover:bg-rmpg-700/40 hover:border-rmpg-600/50'
                  }`}
                >
                  <div className={`text-[10px] font-bold ${isActive ? 'text-brand-400' : 'text-rmpg-200'}`}>
                    {label}
                  </div>
                  <div className="text-[7px] text-[#5a6e80] leading-tight mt-0.5">{desc}</div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* GeoJSON Spatial Layers Section */}
      <div className="border-t border-rmpg-700 p-1.5">
        <button type="button"
          onClick={() => setShowGeoPanel(!showGeoPanel)}
          className="flex items-center gap-2 w-full px-2 py-1.5 text-left transition-colors hover:bg-rmpg-800/50"
        >
          <Globe2 className="w-3 h-3 text-cyan-400" />
          <span className="text-[10px] text-rmpg-300 flex-1">Spatial Layers</span>
          <span className="text-[9px] text-rmpg-500">
            {Object.values(geoLayerStates).filter((s: any) => s.visible).length}/{geoConfigs.length}
          </span>
          {showGeoPanel ? <ChevronUp className="w-2.5 h-2.5 text-rmpg-500" /> : <ChevronDown className="w-2.5 h-2.5 text-rmpg-500" />}
        </button>
        {showGeoPanel && (
          <div className="mt-1 space-y-0.5">
            {geoConfigs.map((cfg: any) => {
              const state = geoLayerStates[cfg.id];
              return (
                <button type="button"
                  key={cfg.id}
                  onClick={() => toggleGeoLayer(cfg.id)}
                  className={`flex items-center gap-2 w-full px-2 py-1 text-left transition-colors duration-100 hover:bg-[#181818]/50 ${
                    state?.visible ? 'panel-inset bg-surface-deep' : 'opacity-40 hover:opacity-70'
                  }`}
                  role="switch"
                  aria-checked={!!state?.visible}
                  aria-label={`Toggle ${cfg.label} layer`}
                >
                  {state?.visible ? <Eye className="w-2.5 h-2.5 text-green-400" /> : <EyeOff className="w-2.5 h-2.5 text-rmpg-500" />}
                  <div className="w-2 h-2 rounded-sm" style={{ backgroundColor: cfg.style.strokeColor, opacity: state?.visible ? 1 : 0.3 }} />
                  <span className="text-[9px] text-rmpg-200 flex-1">{cfg.label}</span>
                  {state?.loaded && state.featureCount > 0 && (
                    <span className="text-[8px] font-mono" style={{ color: state.visible ? cfg.style.strokeColor : '#666666' }}>
                      {state.featureCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* District Legend Section */}
      {geoLayerStates.beat?.visible && districtSections.length > 0 && (
        <div className="border-t border-rmpg-700 p-1.5">
          <button type="button"
            onClick={() => setShowDistrictLegend(!showDistrictLegend)}
            className="flex items-center gap-2 w-full px-2 py-1.5 text-left transition-colors rounded-sm hover:bg-rmpg-700/30"
          >
            <Shield className="w-3 h-3 text-brand-400" />
            <span className="text-[10px] text-rmpg-300 flex-1">District Legend</span>
            <span className="text-[9px] text-rmpg-500">{districtSections.length} sections</span>
            {showDistrictLegend ? <ChevronUp className="w-2.5 h-2.5 text-rmpg-500" /> : <ChevronDown className="w-2.5 h-2.5 text-rmpg-500" />}
          </button>
          {showDistrictLegend && (
            <div className="mt-1 space-y-0.5 max-h-[200px] overflow-y-auto scrollbar-thin scrollbar-thumb-[#2b2b2b]">
              {districtSections.map((sec) => (
                <div key={sec.id} className="flex items-center gap-2 px-2 py-0.5">
                  <div className="w-3 h-2 rounded-sm" style={{ backgroundColor: getSectionColor(sec.id), opacity: 0.8 }} />
                  <span className="text-[9px] font-mono font-bold" style={{ color: getSectionColor(sec.id) }}>{sec.id}</span>
                  <span className="text-[8px] text-rmpg-300 truncate flex-1">{sec.name}</span>
                </div>
              ))}
              <div className="px-2 pt-1 border-t border-rmpg-700/50">
                <div className="text-[7px] text-rmpg-500 uppercase tracking-widest">Format: SEC-ZONE/BEAT</div>
                <div className="text-[8px] text-rmpg-400 font-mono mt-0.5">e.g. SL1-SLC/A</div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Shift Planning Section */}
      <div className="border-t border-rmpg-700 p-1.5">
        <button type="button"
          onClick={() => setShowShiftPanel(!showShiftPanel)}
          className="flex items-center gap-2 w-full px-2 py-1.5 text-left transition-colors hover:bg-rmpg-800/50"
        >
          <CalendarDays className="w-3 h-3 text-emerald-400" />
          <span className="text-[10px] text-rmpg-300 flex-1">Shift Planning</span>
          {shiftPlanning.selectionMode && (
            <span className="text-[7px] px-1 py-0.5 bg-amber-900/40 text-amber-400 border border-amber-700/40 font-bold animate-pulse">SELECT</span>
          )}
          {shiftPlanning.activePlan && (
            <span className="text-[8px] text-emerald-400 font-mono font-bold truncate max-w-[60px]">
              {shiftPlanning.activePlan.name}
            </span>
          )}
          {showShiftPanel ? <ChevronUp className="w-2.5 h-2.5 text-rmpg-500" /> : <ChevronDown className="w-2.5 h-2.5 text-rmpg-500" />}
        </button>
        {showShiftPanel && (
          <div className="mt-1 space-y-1">
            {shiftPlanning.plans.length > 0 && (
              <div className="space-y-0.5 max-h-[100px] overflow-y-auto scrollbar-thin scrollbar-thumb-[#2b2b2b]">
                {shiftPlanning.plans.map((plan: any) => {
                  const shiftInfo = SHIFT_TYPES[plan.shiftType as ShiftType] || SHIFT_TYPES.custom;
                  return (
                    <div
                      key={plan.id}
                      className={`flex items-center gap-1.5 px-2 py-1 transition-colors cursor-pointer ${
                        shiftPlanning.activePlanId === plan.id
                          ? 'panel-inset bg-surface-deep'
                          : 'hover:bg-rmpg-800/50'
                      }`}
                      onClick={() => shiftPlanning.setActivePlanId(
                        shiftPlanning.activePlanId === plan.id ? null : plan.id
                      )}
                    >
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: shiftInfo.color }} />
                      <div className="flex-1 min-w-0">
                        <div className="text-[9px] text-rmpg-200 truncate">{plan.name}</div>
                        <div className="text-[7px] text-rmpg-500 font-mono">{plan.date} · {shiftInfo.label}</div>
                      </div>
                      <span className={`text-[7px] px-1 py-0.5 font-bold ${
                        plan.status === 'active' ? 'bg-green-900/30 text-green-400' :
                        plan.status === 'draft' ? 'bg-rmpg-700/30 text-rmpg-400' :
                        'bg-rmpg-800/30 text-rmpg-500'
                      }`}>
                        {plan.status.toUpperCase()}
                      </span>
                      <span className="text-[8px] text-rmpg-500 font-mono">{plan.assignments.length}</span>
                      <button type="button"
                        onClick={(e) => { e.stopPropagation(); shiftPlanning.deletePlan(plan.id); }}
                        className="p-0.5 hover:text-red-400 text-rmpg-600 transition-colors"
                      >
                        <Trash2 className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* New plan form */}
            <div className="space-y-1 px-1">
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  value={newShiftPlanName}
                  onChange={(e) => setNewShiftPlanName(e.target.value)}
                  placeholder="Plan name..."
                  className="input-dark flex-1 px-1.5 py-0.5 text-[9px]"
                />
                <input
                  type="date"
                  value={newShiftPlanDate}
                  onChange={(e) => setNewShiftPlanDate(e.target.value)}
                  className="input-dark px-1 py-0.5 text-[9px] w-[90px]"
                />
              </div>
              <div className="flex items-center gap-1">
                {(Object.entries(SHIFT_TYPES) as [ShiftType, typeof SHIFT_TYPES.day][]).map(([key, info]) => (
                  <button type="button"
                    key={key}
                    onClick={() => setNewShiftPlanType(key)}
                    className={`flex-1 text-[8px] py-0.5 font-bold transition-colors ${
                      newShiftPlanType === key
                        ? 'panel-inset text-white'
                        : 'text-rmpg-500 hover:text-rmpg-300'
                    }`}
                    style={newShiftPlanType === key ? { borderColor: info.color, backgroundColor: `${info.color}20`, color: info.color } : undefined}
                  >
                    {info.label.split(' ')[0]}
                  </button>
                ))}
                <button type="button"
                  onClick={() => {
                    if (newShiftPlanName.trim()) {
                      shiftPlanning.createPlan(newShiftPlanName.trim(), newShiftPlanDate, newShiftPlanType);
                      setNewShiftPlanName('');
                    }
                  }}
                  className="p-0.5 text-emerald-400 hover:text-emerald-300"
                  title="Create Plan"
                >
                  <Plus className="w-3 h-3" />
                </button>
              </div>
            </div>

            {/* Active plan tools */}
            {shiftPlanning.activePlan && (
              <>
                <div className="border-t border-rmpg-700 pt-1 mt-1 px-1">
                  <button type="button"
                    onClick={() => {
                      shiftPlanning.toggleSelectionMode();
                      if (!shiftPlanning.selectionMode) {
                        const beatState = geoLayerStates['beat'];
                        if (!beatState?.visible) {
                          toggleGeoLayer('beat');
                        }
                        ensureLayerLoaded('beat');
                      }
                    }}
                    className={`flex items-center gap-2 w-full px-2 py-1.5 transition-colors ${
                      shiftPlanning.selectionMode
                        ? 'panel-inset bg-amber-900/30 text-amber-300'
                        : 'hover:bg-rmpg-800/50 text-rmpg-400'
                    }`}
                  >
                    <MousePointer2 className="w-3 h-3" />
                    <span className="text-[9px] font-bold flex-1">
                      {shiftPlanning.selectionMode ? 'SELECTING AREAS...' : 'Select Areas'}
                    </span>
                    {shiftPlanning.selectedAreas.size > 0 && (
                      <span className="text-[8px] font-mono font-bold text-amber-400">
                        {shiftPlanning.selectedAreas.size}
                      </span>
                    )}
                  </button>

                  {shiftPlanning.selectionMode && (
                    <div className="mt-1 space-y-1">
                      <div className="text-[8px] text-amber-400/70 px-2">
                        Click beats, municipalities, or counties on the map to select areas
                      </div>

                      {shiftPlanning.pendingFeatures.length > 0 && (
                        <div className="space-y-0.5 max-h-[80px] overflow-y-auto">
                          {shiftPlanning.pendingFeatures.map((feat: any) => (
                            <div
                              key={`${feat.layerId}::${feat.featureKey}`}
                              className="flex items-center gap-1.5 px-2 py-0.5 bg-amber-900/20"
                            >
                              <div className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                              <span className="text-[8px] text-amber-300 flex-1 truncate">{feat.label}</span>
                              <span className="text-[7px] text-rmpg-500 uppercase">{feat.layerId}</span>
                              <button type="button"
                                onClick={() => shiftPlanning.handleFeatureClick(feat)}
                                className="text-rmpg-600 hover:text-red-400"
                              >
                                <X className="w-2 h-2" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      {shiftPlanning.pendingFeatures.length > 0 && (
                        <div className="border-t border-amber-700/30 pt-1 mt-1 space-y-1">
                          <span className="text-[8px] text-emerald-400 font-bold px-1 uppercase">Assign Personnel</span>

                          <div className="px-1">
                            <div className="text-[7px] text-rmpg-500 uppercase mb-0.5">Officers</div>
                            <div className="max-h-[60px] overflow-y-auto space-y-0.5">
                              {shiftPlanning.officers.slice(0, 30).map((officer: any) => (
                                <label
                                  key={officer.id}
                                  className={`flex items-center gap-1.5 px-1.5 py-0.5 cursor-pointer transition-colors ${
                                    assignOfficerIds.includes(officer.id)
                                      ? 'bg-emerald-900/30 text-emerald-300'
                                      : 'hover:bg-rmpg-800/50 text-rmpg-400'
                                  }`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={assignOfficerIds.includes(officer.id)}
                                    onChange={(e) => {
                                      if (e.target.checked) {
                                        setAssignOfficerIds((prev) => [...prev, officer.id]);
                                      } else {
                                        setAssignOfficerIds((prev) => prev.filter((id) => id !== officer.id));
                                      }
                                    }}
                                    className="w-2.5 h-2.5 accent-emerald-500"
                                  />
                                  <span className="text-[8px] flex-1 truncate">{officer.full_name}</span>
                                  {officer.badge_number && (
                                    <span className="text-[7px] font-mono text-rmpg-500">#{officer.badge_number}</span>
                                  )}
                                </label>
                              ))}
                            </div>
                          </div>

                          {shiftPlanning.units.length > 0 && (
                            <div className="px-1">
                              <div className="text-[7px] text-rmpg-500 uppercase mb-0.5">Units</div>
                              <div className="max-h-[50px] overflow-y-auto space-y-0.5">
                                {shiftPlanning.units.map((unit: any) => (
                                  <label
                                    key={unit.id}
                                    className={`flex items-center gap-1.5 px-1.5 py-0.5 cursor-pointer transition-colors ${
                                      assignUnitIds.includes(unit.id)
                                        ? 'bg-blue-900/30 text-blue-300'
                                        : 'hover:bg-rmpg-800/50 text-rmpg-400'
                                    }`}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={assignUnitIds.includes(unit.id)}
                                      onChange={(e) => {
                                        if (e.target.checked) {
                                          setAssignUnitIds((prev) => [...prev, unit.id]);
                                        } else {
                                          setAssignUnitIds((prev) => prev.filter((id) => id !== unit.id));
                                        }
                                      }}
                                      className="w-2.5 h-2.5 accent-blue-500"
                                    />
                                    <span className="text-[8px] flex-1">{unit.call_sign}</span>
                                    {unit.officer_name && (
                                      <span className="text-[7px] text-rmpg-500 truncate max-w-[60px]">{unit.officer_name}</span>
                                    )}
                                  </label>
                                ))}
                              </div>
                            </div>
                          )}

                          <div className="px-1">
                            <input
                              type="text"
                              value={assignNotes}
                              onChange={(e) => setAssignNotes(e.target.value)}
                              placeholder="Assignment notes..."
                              className="input-dark w-full px-1.5 py-0.5 text-[8px]"
                            />
                          </div>

                          <div className="flex items-center gap-1 px-1">
                            <button type="button"
                              onClick={() => {
                                const shiftInfo = SHIFT_TYPES[shiftPlanning.activePlan?.shiftType as ShiftType] || SHIFT_TYPES.custom;
                                shiftPlanning.assignAreasToOfficers(
                                  assignOfficerIds,
                                  assignUnitIds,
                                  shiftInfo.defaultStart,
                                  shiftInfo.defaultEnd,
                                  assignNotes || undefined,
                                );
                                setAssignOfficerIds([]);
                                setAssignUnitIds([]);
                                setAssignNotes('');
                              }}
                              disabled={assignOfficerIds.length === 0 && assignUnitIds.length === 0}
                              className="toolbar-btn-success flex-1 flex items-center justify-center gap-1 px-2 py-1 text-[8px] font-bold disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                            >
                              <UserCheck className="w-2.5 h-2.5" />
                              Assign
                            </button>
                            <button type="button"
                              onClick={() => shiftPlanning.clearSelection()}
                              className="toolbar-btn px-2 py-1 text-[8px] font-bold transition-colors"
                            >
                              Clear
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {shiftPlanning.activePlan?.assignments?.length > 0 && (
                  <div className="border-t border-rmpg-700 pt-1 mt-1">
                    <div className="flex items-center justify-between px-2 mb-1">
                      <span className="text-[8px] text-rmpg-500 uppercase tracking-wider font-bold">
                        Assignments ({shiftPlanning.activePlan?.assignments.length})
                      </span>
                      <div className="flex items-center gap-1">
                        <button type="button"
                          onClick={() => {
                            try { shiftPlanning.savePlanToServer(shiftPlanning.activePlanId!); } catch { addToast('Failed to save shift plan', 'error'); }
                          }}
                          className="text-rmpg-500 hover:text-emerald-400 transition-colors" title="Save to server"
                        >
                          <Save className="w-2.5 h-2.5" />
                        </button>
                        <button type="button"
                          onClick={() => shiftPlanning.updatePlanStatus(shiftPlanning.activePlanId!, 'active')}
                          className="text-rmpg-500 hover:text-green-400 transition-colors" title="Activate plan"
                        >
                          <Play className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    </div>
                    <div className="space-y-0.5 max-h-[120px] overflow-y-auto">
                      {shiftPlanning.activePlan?.assignments.map((assignment: any) => (
                        <div
                          key={assignment.id}
                          className="flex items-center gap-1.5 px-2 py-0.5 hover:bg-rmpg-800/50"
                        >
                          <div className="led-dot led-green" style={{ width: 6, height: 6 }} />
                          <div className="flex-1 min-w-0">
                            <div className="text-[8px] text-rmpg-300 truncate">{assignment.label}</div>
                            <div className="text-[7px] text-rmpg-500 truncate">
                              {assignment.officerNames.length > 0 && assignment.officerNames.join(', ')}
                              {assignment.unitCallSigns.length > 0 && ` [${assignment.unitCallSigns.join(', ')}]`}
                            </div>
                          </div>
                          <span className="text-[7px] text-rmpg-600 uppercase">{assignment.layerId}</span>
                          <button type="button"
                            onClick={() => shiftPlanning.removeAssignment(assignment.id)}
                            className="p-0.5 text-rmpg-600 hover:text-red-400"
                          >
                            <Trash2 className="w-2 h-2" />
                          </button>
                        </div>
                      ))}
                    </div>

                    {(() => {
                      const stats = shiftPlanning.getCoverageStats();
                      return (
                        <div className="flex items-center gap-3 px-2 pt-1 mt-1 border-t border-rmpg-800">
                          <span className="text-[7px] text-rmpg-500">
                            <span className="text-emerald-400 font-bold">{stats.assigned}</span> areas
                          </span>
                          <span className="text-[7px] text-rmpg-500">
                            <span className="text-blue-400 font-bold">{stats.officers}</span> officers
                          </span>
                          <span className="text-[7px] text-rmpg-500">
                            <span className="text-amber-400 font-bold">{stats.units}</span> units
                          </span>
                        </div>
                      );
                    })()}
                  </div>
                )}

                <div className="flex items-center gap-1 px-1 pt-1">
                  <button type="button"
                    onClick={() => {
                      const tomorrow = new Date();
                      tomorrow.setDate(tomorrow.getDate() + 1);
                      shiftPlanning.duplicatePlan(shiftPlanning.activePlanId!, dateToLocalYMD(tomorrow));
                    }}
                    className="toolbar-btn flex items-center gap-1 px-1.5 py-0.5 text-[8px] transition-colors"
                    title="Duplicate for next day"
                  >
                    <Copy className="w-2 h-2" /> Duplicate
                  </button>
                  {shiftPlanning.activePlan?.assignments.length > 0 && (
                    <button type="button"
                      onClick={() => shiftPlanning.removeAllAssignments()}
                      className="toolbar-btn-danger flex items-center gap-1 px-1.5 py-0.5 text-[8px] transition-colors"
                    >
                      <Trash2 className="w-2 h-2" /> Clear All
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Event Planning Section */}
      <div className="border-t border-rmpg-700 p-1.5">
        <button type="button"
          onClick={() => setShowEventPanel(!showEventPanel)}
          className="flex items-center gap-2 w-full px-2 py-1.5 text-left transition-colors hover:bg-rmpg-800/50"
        >
          <Pencil className="w-3 h-3 text-amber-400" />
          <span className="text-[10px] text-rmpg-300 flex-1">Event Planning</span>
          {eventPlanning.activePlan && (
            <span className="text-[8px] text-amber-400 font-mono font-bold truncate max-w-[60px]">
              {eventPlanning.activePlan.name}
            </span>
          )}
          {showEventPanel ? <ChevronUp className="w-2.5 h-2.5 text-rmpg-500" /> : <ChevronDown className="w-2.5 h-2.5 text-rmpg-500" />}
        </button>
        {showEventPanel && (
          <div className="mt-1 space-y-1">
            {eventPlanning.plans.length > 0 && (
              <div className="space-y-0.5">
                {eventPlanning.plans.map((plan: any) => (
                  <div
                    key={plan.id}
                    className={`flex items-center gap-1.5 px-2 py-1 transition-colors cursor-pointer ${
                      eventPlanning.activePlanId === plan.id
                        ? 'panel-inset bg-surface-deep'
                        : 'hover:bg-rmpg-800/50'
                    }`}
                    onClick={() => eventPlanning.setActivePlanId(
                      eventPlanning.activePlanId === plan.id ? null : plan.id
                    )}
                  >
                    <FileText className="w-2.5 h-2.5 text-amber-400" />
                    <span className="text-[9px] text-rmpg-200 flex-1 truncate">{plan.name}</span>
                    <span className="text-[8px] text-rmpg-500 font-mono">{plan.items.length}</span>
                    <button type="button"
                      onClick={(e) => { e.stopPropagation(); eventPlanning.deletePlan(plan.id); }}
                      className="p-0.5 hover:text-red-400 text-rmpg-600 transition-colors"
                    >
                      <Trash2 className="w-2.5 h-2.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center gap-1 px-1">
              <input
                type="text"
                value={newPlanName}
                onChange={(e) => setNewPlanName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newPlanName.trim()) {
                    eventPlanning.createPlan(newPlanName.trim());
                    setNewPlanName('');
                  }
                }}
                placeholder="New plan name..."
                className="input-dark flex-1 px-1.5 py-0.5 text-[9px]"
              />
              <button type="button"
                onClick={() => {
                  if (newPlanName.trim()) {
                    eventPlanning.createPlan(newPlanName.trim());
                    setNewPlanName('');
                  }
                }}
                className="p-0.5 text-amber-400 hover:text-amber-300"
              >
                <Plus className="w-3 h-3" />
              </button>
            </div>

            {eventPlanning.activePlan && (
              <>
                <div className="border-t border-rmpg-700 pt-1 mt-1">
                  <span className="text-[8px] text-rmpg-500 uppercase tracking-wider font-bold px-2">Draw Tools</span>
                  <div className="grid grid-cols-2 gap-0.5 mt-1 px-1">
                    {([
                      { type: 'perimeter' as PlanItemType, icon: <Square className="w-2.5 h-2.5" />, label: 'Perimeter' },
                      { type: 'route' as PlanItemType, icon: <Route className="w-2.5 h-2.5" />, label: 'Route' },
                      { type: 'staging' as PlanItemType, icon: <MapPin className="w-2.5 h-2.5" />, label: 'Staging' },
                      { type: 'annotation' as PlanItemType, icon: <Type className="w-2.5 h-2.5" />, label: 'Note' },
                    ]).map(({ type, icon, label }) => (
                      <button type="button"
                        key={type}
                        onClick={() => {
                          if (eventPlanning.drawMode === type) {
                            eventPlanning.cancelDrawing();
                          } else {
                            eventPlanning.startDrawing(type);
                          }
                        }}
                        className={`flex items-center gap-1 px-1.5 py-1 text-[9px] transition-colors ${
                          eventPlanning.drawMode === type
                            ? 'panel-inset bg-amber-900/30 text-amber-300'
                            : 'text-rmpg-400 hover:text-rmpg-200 hover:bg-rmpg-800/50'
                        }`}
                        style={{ color: eventPlanning.drawMode === type ? PLAN_COLORS[type] : undefined }}
                      >
                        {icon}
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {eventPlanning.isDrawing && eventPlanning.drawMode && (
                  <div className="mx-1 px-2 py-1.5 bg-amber-900/20 border border-amber-700/30">
                    <div className="text-[9px] text-amber-300 font-bold mb-0.5">
                      Drawing: {PLAN_TYPE_LABELS[eventPlanning.drawMode as keyof typeof PLAN_TYPE_LABELS]}
                    </div>
                    <div className="text-[8px] text-amber-400/70">
                      {eventPlanning.drawMode === 'staging' || eventPlanning.drawMode === 'annotation'
                        ? 'Click map to place'
                        : 'Click to add points, double-click to finish'}
                    </div>
                    <div className="flex items-center gap-1 mt-1">
                      {(eventPlanning.drawMode === 'perimeter' || eventPlanning.drawMode === 'route') && (
                        <button type="button"
                          onClick={() => eventPlanning.finishDrawing()}
                          className="toolbar-btn-success text-[8px] px-1.5 py-0.5"
                        >
                          <Check className="w-2.5 h-2.5 inline mr-0.5" />Finish
                        </button>
                      )}
                      <button type="button"
                        onClick={() => eventPlanning.cancelDrawing()}
                        className="toolbar-btn-danger text-[8px] px-1.5 py-0.5"
                      >
                        <X className="w-2.5 h-2.5 inline mr-0.5" />Cancel
                      </button>
                    </div>
                  </div>
                )}

                {eventPlanning.activePlan.items.length > 0 && (
                  <div className="border-t border-rmpg-700 pt-1 mt-1">
                    <div className="flex items-center justify-between px-2 mb-1">
                      <span className="text-[8px] text-rmpg-500 uppercase tracking-wider font-bold">Plan Items</span>
                      <button type="button"
                        onClick={() => eventPlanning.setPlanVisible(!eventPlanning.planVisible)}
                        className="text-rmpg-500 hover:text-rmpg-300"
                      >
                        {eventPlanning.planVisible
                          ? <Eye className="w-2.5 h-2.5" />
                          : <EyeOff className="w-2.5 h-2.5" />}
                      </button>
                    </div>
                    <div className="space-y-0.5 max-h-[120px] overflow-y-auto">
                      {eventPlanning.activePlan.items.map((item: any) => (
                        <div
                          key={item.id}
                          className="flex items-center gap-1.5 px-2 py-0.5 hover:bg-rmpg-800/50"
                        >
                          <div className="w-1.5 h-1.5" style={{ backgroundColor: item.color }} />
                          <span className="text-[9px] text-rmpg-300 flex-1 truncate">{item.label}</span>
                          <span className="text-[7px] text-rmpg-600 uppercase">{item.type}</span>
                          <button type="button"
                            onClick={() => eventPlanning.removeItemFromPlan(item.id)}
                            className="p-0.5 text-rmpg-600 hover:text-red-400"
                          >
                            <Trash2 className="w-2 h-2" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

      {/* ── Intelligence Layers ── */}
      {/* Fix 93: group related toggles (intelligence group) */}
      {intelLayers && toggleIntelLayer && (
        <div className="border-t border-rmpg-700 p-1.5">
          <button type="button" onClick={() => toggleGroup('intel')} className="flex items-center justify-between w-full px-1 mb-0.5">
            <span className="text-[8px] text-rmpg-500 uppercase tracking-widest font-bold">Intelligence</span>
            <div className="flex items-center gap-1">
              {collapsedGroups.intel && intelCounts && (
                <span className="text-[7px] font-mono text-rmpg-500">
                  {(intelCounts.warrants || 0) + (intelCounts.trespass || 0) + (intelCounts.offenders || 0) + (intelCounts.bolos || 0)}
                </span>
              )}
              {collapsedGroups.intel ? <ChevronDown className="w-2.5 h-2.5 text-rmpg-500" /> : <ChevronUp className="w-2.5 h-2.5 text-rmpg-500" />}
            </div>
          </button>
          {!collapsedGroups.intel && (<>
            <div className="flex items-center justify-between mb-1.5 px-1">
              <span className="text-[7px] text-rmpg-600" />
              <div className="flex gap-1">
                <button type="button"
                  onClick={() => { (['warrants', 'trespass', 'offenders', 'bolos'] as const).forEach(k => { if (!intelLayers[k]) toggleIntelLayer(k); }); }}
                  className="text-[7px] font-bold text-green-400 hover:text-green-300 px-1"
                  title="Enable all intelligence layers"
                >ON</button>
                <button type="button"
                  onClick={() => { (['warrants', 'trespass', 'offenders', 'bolos'] as const).forEach(k => { if (intelLayers[k]) toggleIntelLayer(k); }); }}
                  className="text-[7px] font-bold text-red-400 hover:text-red-300 px-1"
                  title="Disable all intelligence layers"
                >OFF</button>
              </div>
            </div>
            {([
              { key: 'warrants' as const, label: 'Active Warrants', color: 'red' },
              { key: 'trespass' as const, label: 'Trespass Orders', color: 'orange' },
              { key: 'offenders' as const, label: 'Sex Offenders', color: 'purple' },
              { key: 'bolos' as const, label: 'BOLOs', color: 'amber' },
            ] as const).map(({ key, label }) => (
              <button type="button"
                key={key}
                onClick={() => toggleIntelLayer(key)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 text-[10px] rounded-sm transition-colors ${
                  intelLayers[key] ? 'panel-inset bg-surface-deep text-rmpg-200' : 'text-rmpg-400 hover:bg-surface-raised'
                }`}
              >
                <Shield className="w-3 h-3" />
                <span className="flex-1 text-left">{label}</span>
                {intelCounts && (
                  <span className={`text-[9px] font-mono ${intelLayers[key] ? '' : 'opacity-50'}`}>
                    {intelCounts[key] || 0}
                  </span>
                )}
                {intelLayers[key] && intelCounts && intelCounts[key] === 0 && (
                  <span className="text-[7px] text-rmpg-500">none</span>
                )}
              </button>
            ))}
          </>)}
        </div>
      )}

      {/* ── Analysis ── */}
      {(setShowPredictions || setShowSafetyZones || setShowGeofences) && (
        <div className="border-t border-rmpg-700 p-1.5">
          <button type="button" onClick={() => toggleGroup('analysis')} className="flex items-center justify-between w-full px-1 mb-0.5">
            <span className="text-[8px] text-rmpg-500 uppercase tracking-widest font-bold">Analysis</span>
            {collapsedGroups.analysis ? <ChevronDown className="w-2.5 h-2.5 text-rmpg-500" /> : <ChevronUp className="w-2.5 h-2.5 text-rmpg-500" />}
          </button>
          {!collapsedGroups.analysis && <>

          {setShowPredictions && (
            <button type="button"
              onClick={() => setShowPredictions(!showPredictions)}
              className={`w-full flex items-center gap-2 px-2 py-1.5 text-[10px] rounded-sm transition-colors ${
                showPredictions ? 'panel-inset bg-purple-900/20 text-purple-400' : 'text-rmpg-400 hover:bg-surface-raised'
              }`}
            >
              <Brain className="w-3 h-3" />
              <span className="flex-1 text-left">Predictions</span>
              {showPredictions && predictionsCount != null && predictionsCount > 0 && (
                <span className="text-[9px] font-mono">{predictionsCount}</span>
              )}
            </button>
          )}

          {setShowSafetyZones && (
            <button type="button"
              onClick={() => setShowSafetyZones(!showSafetyZones)}
              className={`w-full flex items-center gap-2 px-2 py-1.5 text-[10px] rounded-sm transition-colors ${
                showSafetyZones ? 'panel-inset bg-red-900/20 text-red-400' : 'text-rmpg-400 hover:bg-surface-raised'
              }`}
            >
              <ShieldAlert className="w-3 h-3" />
              <span className="flex-1 text-left">Safety Zones</span>
              {showSafetyZones && safetyZonesCount != null && safetyZonesCount > 0 && (
                <span className="text-[9px] font-mono">{safetyZonesCount}</span>
              )}
            </button>
          )}

          {setShowGeofences && (
            <div className="flex items-center gap-0.5">
              <button type="button"
                onClick={() => setShowGeofences(!showGeofences)}
                className={`flex-1 flex items-center gap-2 px-2 py-1.5 text-[10px] rounded-sm transition-colors ${
                  showGeofences ? 'panel-inset bg-cyan-900/20 text-cyan-400' : 'text-rmpg-400 hover:bg-surface-raised'
                }`}
              >
                <Radar className="w-3 h-3" />
                <span className="flex-1 text-left">Geofences</span>
                {showGeofences && geofencesCount != null && geofencesCount > 0 && (
                  <span className="text-[9px] font-mono">{geofencesCount}</span>
                )}
              </button>
              {showGeofences && onToggleGeofenceDraw && (
                <button type="button"
                  onClick={onToggleGeofenceDraw}
                  className={`px-1.5 py-1 text-[8px] font-bold rounded-sm transition-colors ${
                    geofenceDrawingMode ? 'bg-cyan-900/50 text-cyan-300 border border-cyan-700/50' : 'text-rmpg-500 hover:text-rmpg-300'
                  }`}
                >
                  Draw
                </button>
              )}
            </div>
          )}
          </>}
        </div>
      )}

      {/* ── Tactical Layers ── */}
      {(setShowPatrolCheckpoints || setShowFieldInterviews || setShowDwellTime || setShowResponseRadius || setShowEnforcementClusters || setShowCoverage || setShowFleetVehicles || setShowRepeatAddresses || setShowPanicZone || setShowDaylight) && (
        <div className="border-t border-rmpg-700 p-1.5">
          <button type="button" onClick={() => toggleGroup('tactical')} className="flex items-center justify-between w-full px-1 mb-0.5">
            <span className="text-[8px] text-rmpg-500 uppercase tracking-widest font-bold">Tactical</span>
            {collapsedGroups.tactical ? <ChevronDown className="w-2.5 h-2.5 text-rmpg-500" /> : <ChevronUp className="w-2.5 h-2.5 text-rmpg-500" />}
          </button>
          {!collapsedGroups.tactical && <>

          {/* Patrol Checkpoints */}
          {setShowPatrolCheckpoints && (
            <button type="button"
              onClick={() => setShowPatrolCheckpoints(!showPatrolCheckpoints)}
              className={`w-full flex items-center gap-2 px-2 py-1.5 text-[10px] rounded-sm transition-colors ${
                showPatrolCheckpoints ? 'panel-inset bg-green-900/20 text-green-400' : 'text-rmpg-400 hover:bg-surface-raised'
              }`}
            >
              <Crosshair className="w-3 h-3" />
              <span className="flex-1 text-left">Patrol Checkpoints</span>
              {showPatrolCheckpoints && (patrolCheckpointsOverdue ?? 0) > 0 && (
                <span className="text-[9px] font-mono text-orange-400">{patrolCheckpointsOverdue} due</span>
              )}
              {showPatrolCheckpoints && !(patrolCheckpointsOverdue ?? 0) && (patrolCheckpointsCount ?? 0) > 0 && (
                <span className="text-[9px] font-mono">{patrolCheckpointsCount}</span>
              )}
            </button>
          )}

          {/* Field Interviews */}
          {setShowFieldInterviews && (
            <>
              <button type="button"
                onClick={() => setShowFieldInterviews(!showFieldInterviews)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 text-[10px] rounded-sm transition-colors ${
                  showFieldInterviews ? 'panel-inset bg-blue-900/20 text-blue-400' : 'text-rmpg-400 hover:bg-surface-raised'
                }`}
              >
                <FileSearch className="w-3 h-3" />
                <span className="flex-1 text-left">Field Interviews</span>
                {showFieldInterviews && (fieldInterviewCount ?? 0) > 0 && (
                  <span className="text-[9px] font-mono">{fieldInterviewCount}</span>
                )}
              </button>
              {showFieldInterviews && setFiDays && (
                <div className="px-3 py-1 flex items-center gap-1">
                  {[7, 14, 30, 90].map((d) => (
                    <button type="button"
                      key={d}
                      onClick={() => setFiDays(d)}
                      className={`px-1.5 py-0.5 text-[8px] font-mono font-bold rounded-sm transition-colors ${
                        fiDays === d
                          ? 'bg-blue-900/50 text-blue-400 border border-blue-700/50'
                          : 'text-rmpg-500 hover:text-rmpg-300'
                      }`}
                    >
                      {d}d
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {/* Dwell Time */}
          {setShowDwellTime && (
            <button type="button"
              onClick={() => setShowDwellTime(!showDwellTime)}
              className={`w-full flex items-center gap-2 px-2 py-1.5 text-[10px] rounded-sm transition-colors ${
                showDwellTime ? 'panel-inset bg-amber-900/20 text-amber-400' : 'text-rmpg-400 hover:bg-surface-raised'
              }`}
            >
              <Timer className="w-3 h-3" />
              <span className="flex-1 text-left">Dwell Time</span>
              {showDwellTime && (dwellAlertCount ?? 0) > 0 && (
                <span className="text-[9px] font-mono text-amber-400">{dwellAlertCount}</span>
              )}
            </button>
          )}

          {/* Response Radius */}
          {setShowResponseRadius && (
            <button type="button"
              onClick={() => setShowResponseRadius(!showResponseRadius)}
              className={`w-full flex items-center gap-2 px-2 py-1.5 text-[10px] rounded-sm transition-colors ${
                showResponseRadius ? 'panel-inset bg-indigo-900/20 text-indigo-400' : 'text-rmpg-400 hover:bg-surface-raised'
              }`}
            >
              <Target className="w-3 h-3" />
              <span className="flex-1 text-left">Response Radius</span>
              {showResponseRadius && responseRadiusActive && (
                <span className="led-dot led-indigo" style={{ width: 5, height: 5 }} />
              )}
            </button>
          )}

          {/* Enforcement Clusters */}
          {setShowEnforcementClusters && (
            <>
              <button type="button"
                onClick={() => setShowEnforcementClusters(!showEnforcementClusters)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 text-[10px] rounded-sm transition-colors ${
                  showEnforcementClusters ? 'panel-inset bg-rose-900/20 text-rose-400' : 'text-rmpg-400 hover:bg-surface-raised'
                }`}
              >
                <Scale className="w-3 h-3" />
                <span className="flex-1 text-left">Enforcement</span>
                {showEnforcementClusters && (enforcementTotalRecords ?? 0) > 0 && (
                  <span className="text-[9px] font-mono">{enforcementTotalRecords}</span>
                )}
              </button>
              {showEnforcementClusters && setEnforcementType && setEnforcementDays && (
                <div className="px-3 py-1 space-y-1">
                  <div className="flex items-center gap-1">
                    {(['citations', 'arrests'] as const).map((t) => (
                      <button type="button"
                        key={t}
                        onClick={() => setEnforcementType(t)}
                        className={`px-1.5 py-0.5 text-[8px] font-mono font-bold rounded-sm transition-colors ${
                          enforcementType === t
                            ? 'bg-rose-900/50 text-rose-400 border border-rose-700/50'
                            : 'text-rmpg-500 hover:text-rmpg-300'
                        }`}
                      >
                        {t === 'citations' ? 'Citations' : 'Arrests'}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-1">
                    {[30, 60, 90, 180].map((d) => (
                      <button type="button"
                        key={d}
                        onClick={() => setEnforcementDays(d)}
                        className={`px-1.5 py-0.5 text-[8px] font-mono font-bold rounded-sm transition-colors ${
                          enforcementDays === d
                            ? 'bg-rose-900/50 text-rose-400 border border-rose-700/50'
                            : 'text-rmpg-500 hover:text-rmpg-300'
                        }`}
                      >
                        {d}d
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Coverage Map */}
          {setShowCoverage && (
            <>
              <button type="button"
                onClick={() => setShowCoverage(!showCoverage)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 text-[10px] rounded-sm transition-colors ${
                  showCoverage ? 'panel-inset bg-teal-900/20 text-teal-400' : 'text-rmpg-400 hover:bg-surface-raised'
                }`}
              >
                <Radar className="w-3 h-3" />
                <span className="flex-1 text-left">Coverage Map</span>
                {showCoverage && (coverageCount ?? 0) > 0 && (
                  <span className="text-[9px] font-mono">{coverageCount}</span>
                )}
              </button>
              {showCoverage && setCoverageRadius && (
                <div className="px-3 py-1 flex items-center gap-1">
                  {[1, 2, 3, 5].map((r) => (
                    <button type="button"
                      key={r}
                      onClick={() => setCoverageRadius(r)}
                      className={`px-1.5 py-0.5 text-[8px] font-mono font-bold rounded-sm transition-colors ${
                        coverageRadius === r
                          ? 'bg-teal-900/50 text-teal-400 border border-teal-700/50'
                          : 'text-rmpg-500 hover:text-rmpg-300'
                      }`}
                    >
                      {r}mi
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {/* Fleet Vehicles */}
          {setShowFleetVehicles && (
            <button type="button"
              onClick={() => setShowFleetVehicles(!showFleetVehicles)}
              className={`w-full flex items-center gap-2 px-2 py-1.5 text-[10px] rounded-sm transition-colors ${
                showFleetVehicles ? 'panel-inset bg-sky-900/20 text-sky-400' : 'text-rmpg-400 hover:bg-surface-raised'
              }`}
            >
              <Car className="w-3 h-3" />
              <span className="flex-1 text-left">Fleet Vehicles</span>
              {showFleetVehicles && (fleetVehicleCount ?? 0) > 0 && (
                <span className="text-[9px] font-mono">{fleetVehicleCount}</span>
              )}
            </button>
          )}

          {/* Repeat Addresses */}
          {setShowRepeatAddresses && (
            <>
              <button type="button"
                onClick={() => setShowRepeatAddresses(!showRepeatAddresses)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 text-[10px] rounded-sm transition-colors ${
                  showRepeatAddresses ? 'panel-inset bg-orange-900/20 text-orange-400' : 'text-rmpg-400 hover:bg-surface-raised'
                }`}
              >
                <AlertOctagon className="w-3 h-3" />
                <span className="flex-1 text-left">Repeat Addresses</span>
                {showRepeatAddresses && (repeatAddressCount ?? 0) > 0 && (
                  <span className="text-[9px] font-mono">{repeatAddressCount}</span>
                )}
              </button>
              {showRepeatAddresses && setRepeatDays && setRepeatMinCount && (
                <div className="px-3 py-1 space-y-1">
                  <div className="flex items-center gap-1">
                    {[7, 14, 30, 90].map((d) => (
                      <button type="button"
                        key={d}
                        onClick={() => setRepeatDays(d)}
                        className={`px-1.5 py-0.5 text-[8px] font-mono font-bold rounded-sm transition-colors ${
                          repeatDays === d
                            ? 'bg-orange-900/50 text-orange-400 border border-orange-700/50'
                            : 'text-rmpg-500 hover:text-rmpg-300'
                        }`}
                      >
                        {d}d
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-[7px] text-rmpg-500">Min:</span>
                    {[2, 3, 5, 10].map((c) => (
                      <button type="button"
                        key={c}
                        onClick={() => setRepeatMinCount(c)}
                        className={`px-1.5 py-0.5 text-[8px] font-mono font-bold rounded-sm transition-colors ${
                          repeatMinCount === c
                            ? 'bg-orange-900/50 text-orange-400 border border-orange-700/50'
                            : 'text-rmpg-500 hover:text-rmpg-300'
                        }`}
                      >
                        {c}x
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Panic Zone */}
          {setShowPanicZone && (
            <button type="button"
              onClick={() => setShowPanicZone(!showPanicZone)}
              className={`w-full flex items-center gap-2 px-2 py-1.5 text-[10px] rounded-sm transition-colors ${
                showPanicZone ? 'panel-inset bg-red-900/20 text-red-400' : 'text-rmpg-400 hover:bg-surface-raised'
              }`}
            >
              <ShieldAlert className="w-3 h-3" />
              <span className="flex-1 text-left">Panic Zone</span>
              {showPanicZone && panicActive && (
                <span className="text-[8px] font-bold bg-red-600 text-white px-1 py-0.5 rounded-sm animate-pulse">ACTIVE</span>
              )}
            </button>
          )}

          {/* Daylight Overlay */}
          {setShowDaylight && (
            <button type="button"
              onClick={() => setShowDaylight(!showDaylight)}
              className={`w-full flex items-center gap-2 px-2 py-1.5 text-[10px] rounded-sm transition-colors ${
                showDaylight ? 'panel-inset bg-yellow-900/20 text-yellow-400' : 'text-rmpg-400 hover:bg-surface-raised'
              }`}
            >
              <Sun className="w-3 h-3" />
              <span className="flex-1 text-left">Daylight</span>
              {showDaylight && daylightPhase && (
                <span className="text-[8px] font-mono text-yellow-400">{daylightPhase}</span>
              )}
            </button>
          )}
          </>}
        </div>
      )}

      {/* ── Dispatch Mode ── */}
      {setDragDispatchMode && (
        <div className="border-t border-rmpg-700 p-1.5">
          <button type="button"
            onClick={() => setDragDispatchMode(!dragDispatchMode)}
            className={`w-full flex items-center gap-2 px-2 py-1.5 text-[10px] rounded-sm transition-colors ${
              dragDispatchMode ? 'panel-inset bg-amber-900/20 text-amber-400' : 'text-rmpg-400 hover:bg-surface-raised'
            }`}
          >
            <Grab className="w-3 h-3" />
            <span className="flex-1 text-left">Drag Dispatch</span>
            {dragDispatchMode && <span className="led-dot led-amber" style={{ width: 5, height: 5 }} />}
          </button>
        </div>
      )}
      </div>
    </div>
  );
}
