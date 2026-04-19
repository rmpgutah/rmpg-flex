import { useEffect, useRef, useState } from 'react';
import 'ol/ol.css';
import Map from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import XYZ from 'ol/source/XYZ';
import { fromLonLat } from 'ol/proj';
import { defaults as defaultControls, ScaleLine, Attribution } from 'ol/control';
import { useOlBeatLayer } from './hooks/useOlBeatLayer';
import { useOlLiveMarkers } from './hooks/useOlLiveMarkers';
import { useOlGeoJsonLayer } from './hooks/useOlGeoJsonLayer';
import { useOlDrawTool, type DrawMode } from './hooks/useOlDrawTool';
import { useOlDragDispatch } from './hooks/useOlDragDispatch';
import { useOlHeatmap } from './hooks/useOlHeatmap';
import { useOlAddressSearch } from './hooks/useOlAddressSearch';
import { useOlSafetyZones, useOlEnforcementClusters } from './hooks/useOlTacticalLayers';
import { useOlBreadcrumbs } from './hooks/useOlBreadcrumbs';
import { useOlFieldInterviews } from './hooks/useOlFieldInterviews';
import {
  useOlIncidentReports,
  useOlPatrolCheckpoints,
  useOlFleetVehicles,
  useOlRepeatAddresses,
  useOlDwellTime,
  useOlCallHistory,
  useOlPredictions,
} from './hooks/useOlOperationalLayers';
import { useDaylightPhase } from './hooks/useDaylightPhase';
import { useOlScreenshot } from './hooks/useOlScreenshot';
import MapV2LayersPanel, { type LayerSection } from './components/MapV2LayersPanel';
import { useWebSocket } from '../../context/WebSocketContext';
import MapV2AddressSearch from './components/MapV2AddressSearch';
import MapV2DrawToolbar from './components/MapV2DrawToolbar';
import MapV2StatusBar from './components/MapV2StatusBar';

const SLC_LON_LAT: [number, number] = [-111.891, 40.760];

export default function MapPageV2() {
  const mapDivRef = useRef<HTMLDivElement | null>(null);
  // Map instance lives in a ref so the mount-effect can run with an
  // empty dep array — putting `map` in the deps caused a render loop
  // (cleanup destroyed the instance on every state change, which
  // re-ran the effect, which created a new instance, etc).
  const mapInstanceRef = useRef<Map | null>(null);
  const [map, setMap] = useState<Map | null>(null);

  // Drawing-tool state
  const [drawMode, setDrawMode] = useState<DrawMode>(null);
  const [clearVersion, setClearVersion] = useState(0);

  // Layer visibility toggles (default: county off, others on for situational orientation)
  const [showCounty, setShowCounty] = useState(false);
  const [showHighway, setShowHighway] = useState(true);
  const [showMunicipality, setShowMunicipality] = useState(true);
  const [showPlaces, setShowPlaces] = useState(false);
  const [showBeats, setShowBeats] = useState(true);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [showSafety, setShowSafety] = useState(false);
  const [showEnforcement, setShowEnforcement] = useState(false);
  const [showBreadcrumbs, setShowBreadcrumbs] = useState(false);
  const [showFi, setShowFi] = useState(false);
  const [showIncidents, setShowIncidents] = useState(false);
  const [showCheckpoints, setShowCheckpoints] = useState(false);
  const [showFleet, setShowFleet] = useState(false);
  const [showRepeat, setShowRepeat] = useState(false);
  const [showDwell, setShowDwell] = useState(false);
  const [showCallHistory, setShowCallHistory] = useState(false);
  const [showPredictions, setShowPredictions] = useState(false);

  // Per-layer settings (days, modes, etc.) — exposed via inline controls
  // beneath each layer toggle in the panel. Defaults match v1.
  const [heatmapDays, setHeatmapDays] = useState<7 | 14 | 30 | 90>(30);
  const [heatmapMode, setHeatmapMode] = useState<'all' | 'risk' | 'type'>('all');
  const [safetyDays, setSafetyDays] = useState<30 | 90 | 180>(90);
  const [enforcementDays, setEnforcementDays] = useState<7 | 30 | 90>(30);
  const [enforcementType, setEnforcementType] = useState<'all' | 'traffic' | 'criminal'>('all');
  const [breadcrumbHours, setBreadcrumbHours] = useState<1 | 4 | 8 | 24>(8);
  const [fiDays, setFiDays] = useState<7 | 30 | 90>(30);
  const [incidentDays, setIncidentDays] = useState<7 | 30 | 90>(30);
  const [repeatDays, setRepeatDays] = useState<7 | 30 | 90>(30);
  const [repeatMinCount, setRepeatMinCount] = useState<2 | 3 | 5 | 10>(3);
  const [historyDays, setHistoryDays] = useState<1 | 7 | 30>(7);

  useEffect(() => {
    if (!mapDivRef.current || mapInstanceRef.current) return;

    const tileLayer = new TileLayer({
      source: new XYZ({
        url: '/tiles/{z}/{x}/{y}.png',
        maxZoom: 15,
        attributions:
          '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>',
      }),
    });

    const instance = new Map({
      target: mapDivRef.current,
      layers: [tileLayer],
      view: new View({
        center: fromLonLat(SLC_LON_LAT),
        zoom: 11,
        minZoom: 7,
        maxZoom: 15,
      }),
      controls: defaultControls({ attribution: false }).extend([
        new ScaleLine({ units: 'us', minWidth: 80 }),
        new Attribution({ collapsible: false }),
      ]),
    });
    mapInstanceRef.current = instance;
    setMap(instance);

    return () => {
      instance.setTarget(undefined);
      mapInstanceRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useOlBeatLayer(map, { visible: showBeats });
  useOlLiveMarkers(map);
  useOlDrawTool(map, { mode: drawMode, clearVersion });
  useOlDragDispatch(map);
  useOlHeatmap(map, { visible: showHeatmap, days: heatmapDays, mode: heatmapMode });
  useOlSafetyZones(map, { visible: showSafety, days: safetyDays });
  useOlEnforcementClusters(map, { visible: showEnforcement, days: enforcementDays, type: enforcementType });
  useOlBreadcrumbs(map, { visible: showBreadcrumbs, hours: breadcrumbHours });
  useOlFieldInterviews(map, { visible: showFi, days: fiDays });
  useOlIncidentReports(map, { visible: showIncidents, days: incidentDays });
  useOlPatrolCheckpoints(map, { visible: showCheckpoints });
  useOlFleetVehicles(map, { visible: showFleet });
  useOlRepeatAddresses(map, { visible: showRepeat, days: repeatDays, minCount: repeatMinCount });
  useOlDwellTime(map, { visible: showDwell });
  useOlCallHistory(map, { visible: showCallHistory, days: historyDays });
  useOlPredictions(map, { visible: showPredictions });
  const addressSearch = useOlAddressSearch(map);
  const daylight = useDaylightPhase();
  const screenshot = useOlScreenshot(map);
  const { isConnected } = useWebSocket();
  useOlGeoJsonLayer(map, {
    url: '/geojson/county.geojson',
    visible: showCounty,
    stroke: '#888888',
    strokeWidth: 1,
    zIndex: 4,
  });
  useOlGeoJsonLayer(map, {
    url: '/geojson/municipality.geojson',
    visible: showMunicipality,
    stroke: '#60a5fa',
    strokeWidth: 1,
    fill: '#60a5fa0a',
    zIndex: 6,
  });
  useOlGeoJsonLayer(map, {
    url: '/geojson/highway.geojson',
    visible: showHighway,
    stroke: '#fbbf24',
    strokeWidth: 2,
    zIndex: 8,
  });
  useOlGeoJsonLayer(map, {
    url: '/geojson/place.geojson',
    visible: showPlaces,
    stroke: '#a78bfa',
    pointRadius: 3,
    zIndex: 9,
  });

  const sections: LayerSection[] = [
    {
      id: 'core',
      title: 'Core',
      layers: [
        { key: 'beats', label: 'Beats', color: '#22c55e', visible: showBeats, onToggle: () => setShowBeats(v => !v), count: 719 },
        { key: 'municipality', label: 'Municipalities', color: '#60a5fa', visible: showMunicipality, onToggle: () => setShowMunicipality(v => !v), count: 261 },
        { key: 'highway', label: 'Highways', color: '#fbbf24', visible: showHighway, onToggle: () => setShowHighway(v => !v), count: 3 },
        { key: 'county', label: 'Counties', color: '#888888', visible: showCounty, onToggle: () => setShowCounty(v => !v), count: 29 },
        { key: 'places', label: 'Places', color: '#a78bfa', visible: showPlaces, onToggle: () => setShowPlaces(v => !v), count: 462 },
      ],
    },
    {
      id: 'intel',
      title: 'Intelligence',
      layers: [
        {
          key: 'heatmap', label: `Heatmap (${heatmapDays}d)`, color: '#ef4444',
          visible: showHeatmap, onToggle: () => setShowHeatmap(v => !v),
          controls: [
            { kind: 'segmented', label: 'DAYS', value: heatmapDays,
              options: [{ value: 7, label: '7' }, { value: 14, label: '14' }, { value: 30, label: '30' }, { value: 90, label: '90' }],
              onChange: (v) => setHeatmapDays(v as 7 | 14 | 30 | 90) },
            { kind: 'segmented', label: 'MODE', value: heatmapMode,
              options: [{ value: 'all', label: 'All' }, { value: 'risk', label: 'Risk' }, { value: 'type', label: 'Type' }],
              onChange: (v) => setHeatmapMode(v as 'all' | 'risk' | 'type') },
          ],
        },
        {
          key: 'safety', label: `Safety Zones (${safetyDays}d)`, color: '#ef4444',
          visible: showSafety, onToggle: () => setShowSafety(v => !v),
          controls: [
            { kind: 'segmented', label: 'DAYS', value: safetyDays,
              options: [{ value: 30, label: '30' }, { value: 90, label: '90' }, { value: 180, label: '180' }],
              onChange: (v) => setSafetyDays(v as 30 | 90 | 180) },
          ],
        },
        {
          key: 'enforcement', label: `Enforcement (${enforcementDays}d)`, color: '#a855f7',
          visible: showEnforcement, onToggle: () => setShowEnforcement(v => !v),
          controls: [
            { kind: 'segmented', label: 'DAYS', value: enforcementDays,
              options: [{ value: 7, label: '7' }, { value: 30, label: '30' }, { value: 90, label: '90' }],
              onChange: (v) => setEnforcementDays(v as 7 | 30 | 90) },
            { kind: 'segmented', label: 'TYPE', value: enforcementType,
              options: [{ value: 'all', label: 'All' }, { value: 'traffic', label: 'Traffic' }, { value: 'criminal', label: 'Crim' }],
              onChange: (v) => setEnforcementType(v as 'all' | 'traffic' | 'criminal') },
          ],
        },
        { key: 'predictions', label: 'Predicted Hotspots', color: '#ec4899', visible: showPredictions, onToggle: () => setShowPredictions(v => !v) },
      ],
    },
    {
      id: 'operational',
      title: 'Operational',
      layers: [
        {
          key: 'incidents', label: `Incident Reports (${incidentDays}d)`, color: '#ef4444',
          visible: showIncidents, onToggle: () => setShowIncidents(v => !v),
          controls: [
            { kind: 'segmented', label: 'DAYS', value: incidentDays,
              options: [{ value: 7, label: '7' }, { value: 30, label: '30' }, { value: 90, label: '90' }],
              onChange: (v) => setIncidentDays(v as 7 | 30 | 90) },
          ],
        },
        {
          key: 'fi', label: `Field Interviews (${fiDays}d)`, color: '#06b6d4',
          visible: showFi, onToggle: () => setShowFi(v => !v),
          controls: [
            { kind: 'segmented', label: 'DAYS', value: fiDays,
              options: [{ value: 7, label: '7' }, { value: 30, label: '30' }, { value: 90, label: '90' }],
              onChange: (v) => setFiDays(v as 7 | 30 | 90) },
          ],
        },
        { key: 'checkpoints', label: 'Patrol Checkpoints', color: '#22c55e', visible: showCheckpoints, onToggle: () => setShowCheckpoints(v => !v) },
        { key: 'fleet', label: 'Fleet Vehicles', color: '#fbbf24', visible: showFleet, onToggle: () => setShowFleet(v => !v) },
      ],
    },
    {
      id: 'history',
      title: 'History',
      layers: [
        {
          key: 'breadcrumbs', label: `Breadcrumbs (${breadcrumbHours}h)`, color: '#14b8a6',
          visible: showBreadcrumbs, onToggle: () => setShowBreadcrumbs(v => !v),
          controls: [
            { kind: 'segmented', label: 'HRS', value: breadcrumbHours,
              options: [{ value: 1, label: '1' }, { value: 4, label: '4' }, { value: 8, label: '8' }, { value: 24, label: '24' }],
              onChange: (v) => setBreadcrumbHours(v as 1 | 4 | 8 | 24) },
          ],
        },
        {
          key: 'history', label: `Call History (${historyDays}d)`, color: '#9ca3af',
          visible: showCallHistory, onToggle: () => setShowCallHistory(v => !v),
          controls: [
            { kind: 'segmented', label: 'DAYS', value: historyDays,
              options: [{ value: 1, label: '1' }, { value: 7, label: '7' }, { value: 30, label: '30' }],
              onChange: (v) => setHistoryDays(v as 1 | 7 | 30) },
          ],
        },
        {
          key: 'repeat', label: `Repeat Addresses (${repeatDays}d, \u2265${repeatMinCount})`, color: '#f97316',
          visible: showRepeat, onToggle: () => setShowRepeat(v => !v),
          controls: [
            { kind: 'segmented', label: 'DAYS', value: repeatDays,
              options: [{ value: 7, label: '7' }, { value: 30, label: '30' }, { value: 90, label: '90' }],
              onChange: (v) => setRepeatDays(v as 7 | 30 | 90) },
            { kind: 'segmented', label: 'MIN', value: repeatMinCount,
              options: [{ value: 2, label: '2' }, { value: 3, label: '3' }, { value: 5, label: '5' }, { value: 10, label: '10' }],
              onChange: (v) => setRepeatMinCount(v as 2 | 3 | 5 | 10) },
          ],
        },
        { key: 'dwell', label: 'Dwell Time', color: '#fbbf24', visible: showDwell, onToggle: () => setShowDwell(v => !v) },
      ],
    },
  ];

  return (
    <div className="relative w-full h-full bg-[#0a0a0a]">
      <div
        ref={mapDivRef}
        className="absolute inset-0"
        style={{ background: '#0a0a0a' }}
      />
      <MapV2AddressSearch
        results={addressSearch.results}
        searching={addressSearch.searching}
        onSearch={addressSearch.search}
        onSelect={addressSearch.selectAddress}
        onClear={addressSearch.clearPin}
      />
      <MapV2LayersPanel sections={sections} isConnected={isConnected} />
      <MapV2DrawToolbar
        mode={drawMode}
        setMode={setDrawMode}
        onClear={() => setClearVersion(v => v + 1)}
      />
      <MapV2StatusBar daylight={daylight} onScreenshot={screenshot} />
    </div>
  );
}
