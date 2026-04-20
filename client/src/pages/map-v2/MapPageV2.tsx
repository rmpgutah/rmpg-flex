import { useEffect, useRef, useState } from 'react';
import 'ol/ol.css';
import Map from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import XYZ from 'ol/source/XYZ';
import { fromLonLat } from 'ol/proj';
import { defaults as defaultControls, ScaleLine, Attribution, FullScreen, ZoomSlider, OverviewMap } from 'ol/control';
import { useOlBeatLayer } from './hooks/useOlBeatLayer';
import { useOlLiveMarkers } from './hooks/useOlLiveMarkers';
import { useOlFeaturePopup } from './hooks/useOlFeaturePopup';
import { useOlGeoJsonLayer } from './hooks/useOlGeoJsonLayer';
import { useOlDrawTool, type DrawMode } from './hooks/useOlDrawTool';
import { useOlDragDispatch } from './hooks/useOlDragDispatch';
import { useOlHeatmap } from './hooks/useOlHeatmap';
import { useOlAddressSearch } from './hooks/useOlAddressSearch';
import { useOlSafetyZones, useOlEnforcementClusters } from './hooks/useOlTacticalLayers';
import { useOlBreadcrumbs, type BreadcrumbColorMode } from './hooks/useOlBreadcrumbs';
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
import { useOlTrackingLines } from './hooks/useOlTrackingLines';
import { useOlAlerts } from './hooks/useOlAlerts';
import { useOlContextMenu } from './hooks/useOlContextMenu';
import { useOlGeolocation } from './hooks/useOlGeolocation';
import { useOlGeofences } from './hooks/useOlGeofences';
import MapV2StyleSwitcher, { type MapStyleKey } from './components/MapV2StyleSwitcher';
import MapV2ContextMenu from './components/MapV2ContextMenu';
import MapV2GeolocateButton from './components/MapV2GeolocateButton';
import MapV2RecenterButton from './components/MapV2RecenterButton';
import MapV2CoverageBar from './components/MapV2CoverageBar';
import MapV2CursorReadout from './components/MapV2CursorReadout';
import MapV2HoverTooltip from './components/MapV2HoverTooltip';
import MapV2Legend from './components/MapV2Legend';
import { useOlHoverTooltip } from './hooks/useOlHoverTooltip';
import MapV2PresetsButton from './components/MapV2PresetsButton';
import { useDispatchCoverageStats } from './hooks/useDispatchCoverageStats';
import { useOlCursorCoords } from './hooks/useOlCursorCoords';
import { useMapV2Shortcuts } from './hooks/useMapV2Shortcuts';
import { useLayerPresets, type LayerPreset } from './hooks/useLayerPresets';
import { useP1AudioAlert } from './hooks/useP1AudioAlert';
import MapV2Compass from './components/MapV2Compass';
import MapV2NowClock from './components/MapV2NowClock';
import MapV2ToastStack from './components/MapV2ToastStack';
import MapV2GpxExportButton from './components/MapV2GpxExportButton';
import { downloadGpx } from './utils/breadcrumbAnalysis';
import { useOlClickRipple } from './hooks/useOlClickRipple';
import { useOlBeatActivity } from './hooks/useOlBeatActivity';
import { useOlAutoPanToP1 } from './hooks/useOlAutoPanToP1';
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
  const [showBeatHeat, setShowBeatHeat] = useState(false);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [showSafety, setShowSafety] = useState(false);
  const [showEnforcement, setShowEnforcement] = useState(false);
  const [showBreadcrumbs, setShowBreadcrumbs] = useState(false);
  const [showTracking, setShowTracking] = useState(true);
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
  const [breadcrumbHours, setBreadcrumbHours] = useState<1 | 4 | 8 | 24 | 168 | 720>(8);
  const [breadcrumbColor, setBreadcrumbColor] = useState<BreadcrumbColorMode>('unit');
  const [bcShowStops, setBcShowStops] = useState(false);
  const [bcShowSpeedWarnings, setBcShowSpeedWarnings] = useState(false);
  const [bcShowHardBrakes, setBcShowHardBrakes] = useState(false);
  const [bcShowStatusChanges, setBcShowStatusChanges] = useState(false);
  const [bcShowArrows, setBcShowArrows] = useState(false);
  const [bcShowMilestones, setBcShowMilestones] = useState(false);
  const [bcShowHull, setBcShowHull] = useState(false);
  const [bcHideOffDuty, setBcHideOffDuty] = useState(false);
  const [fiDays, setFiDays] = useState<7 | 30 | 90>(30);
  const [incidentDays, setIncidentDays] = useState<7 | 30 | 90>(30);
  const [repeatDays, setRepeatDays] = useState<7 | 30 | 90>(30);
  const [repeatMinCount, setRepeatMinCount] = useState<2 | 3 | 5 | 10>(3);
  const [historyDays, setHistoryDays] = useState<1 | 7 | 30>(7);
  const [showAlerts, setShowAlerts] = useState(true);
  const [showGeofences, setShowGeofences] = useState(false);
  const [mapStyle, setMapStyle] = useState<MapStyleKey>('dark');
  const tileLayerRef = useRef<TileLayer<XYZ> | null>(null);
  const highZoomLayerRef = useRef<TileLayer<XYZ> | null>(null);
  const referenceOverlayRef = useRef<TileLayer<XYZ> | null>(null);

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
    tileLayerRef.current = tileLayer;

    // High-zoom overlay — kicks in above Z15 where the offline cache
    // ends. Live CartoDB dark_all carries street/water/park/building
    // detail through Z20 so dispatchers can drill into block-level views
    // without hitting a wall. Falls back gracefully when offline (just
    // shows the cached Z15 tile stretched).
    const highZoomLayerRef_local = new TileLayer({
      source: new XYZ({
        url: 'https://{a-d}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
        maxZoom: 20,
      }),
      minZoom: 15,
      maxZoom: 20,
    });
    highZoomLayerRef.current = highZoomLayerRef_local;

    // Reference overlay — Esri's transparent label/road-shield/transit/
    // address-point/parcel-label tile layer. Renders on top of the base
    // for the "Detail" style only (toggled via the swap effect below).
    // zIndex 50 puts it above the base tiles but below feature data
    // (markers/beats are zIndex 100+) so it never occludes operational
    // glyphs.
    const referenceOverlay = new TileLayer({
      source: new XYZ({
        url: 'https://services.arcgisonline.com/arcgis/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
        maxZoom: 19,
        crossOrigin: 'anonymous',
      }),
      zIndex: 50,
      visible: false,
    });
    referenceOverlayRef.current = referenceOverlay;

    // Mini-map (top-right corner) — uses the same tile cache to stay
    // offline-capable.
    const overviewTileLayer = new TileLayer({
      source: new XYZ({ url: '/tiles/{z}/{x}/{y}.png', maxZoom: 15 }),
    });

    const instance = new Map({
      target: mapDivRef.current,
      layers: [tileLayer, highZoomLayerRef_local, referenceOverlay],
      view: new View({
        center: fromLonLat(SLC_LON_LAT),
        zoom: 11,
        minZoom: 7,
        maxZoom: 20,
      }),
      controls: defaultControls({ attribution: false }).extend([
        new ScaleLine({ units: 'us', minWidth: 80 }),
        new Attribution({ collapsible: false }),
        new FullScreen({ tipLabel: 'Toggle full-screen' }),
        new ZoomSlider(),
        new OverviewMap({
          collapsed: true,
          collapseLabel: '\u00BB',
          label: '\u00AB',
          tipLabel: 'Overview map',
          layers: [overviewTileLayer],
        }),
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

  const beatActivity = useOlBeatActivity();
  useOlBeatLayer(map, { visible: showBeats, heatMode: showBeatHeat, beatActivity });
  useOlClickRipple(map);
  useOlLiveMarkers(map);
  useOlFeaturePopup(map);
  useOlDrawTool(map, { mode: drawMode, clearVersion });
  useOlDragDispatch(map);
  useOlHeatmap(map, { visible: showHeatmap, days: heatmapDays, mode: heatmapMode });
  useOlSafetyZones(map, { visible: showSafety, days: safetyDays });
  useOlEnforcementClusters(map, { visible: showEnforcement, days: enforcementDays, type: enforcementType });
  const breadcrumbResult = useOlBreadcrumbs(map, {
    visible: showBreadcrumbs, hours: breadcrumbHours, colorMode: breadcrumbColor,
    showStops: bcShowStops, showSpeedWarnings: bcShowSpeedWarnings,
    showHardBrakes: bcShowHardBrakes, showStatusChanges: bcShowStatusChanges,
    showArrows: bcShowArrows, showMilestones: bcShowMilestones, showHull: bcShowHull,
    hideOffDuty: bcHideOffDuty,
  });
  useOlTrackingLines(map, { visible: showTracking });
  useOlAlerts(map, { visible: showAlerts });
  useOlGeofences(map, { visible: showGeofences });
  const geo = useOlGeolocation(map);
  const coverageStats = useDispatchCoverageStats();
  useOlAutoPanToP1(map, { enabled: true });
  useP1AudioAlert({ enabled: true });
  const cursorCoords = useOlCursorCoords(map);
  const hoverTooltip = useOlHoverTooltip(map);
  const { presets, save: savePreset, remove: removePreset } = useLayerPresets();

  const recenter = () => {
    if (!map) return;
    map.getView().animate({ center: fromLonLat(SLC_LON_LAT), zoom: 11, duration: 500 });
  };

  // Layer-preset save/apply: capture current visibility into a flat map,
  // and apply by routing each key to its setter.
  const captureVisibility = (): Record<string, boolean> => ({
    beats: showBeats, county: showCounty, municipality: showMunicipality,
    highway: showHighway, places: showPlaces,
    heatmap: showHeatmap, safety: showSafety, enforcement: showEnforcement,
    predictions: showPredictions,
    incidents: showIncidents, fi: showFi, checkpoints: showCheckpoints,
    fleet: showFleet,
    breadcrumbs: showBreadcrumbs, history: showCallHistory,
    repeat: showRepeat, dwell: showDwell,
    tracking: showTracking, alerts: showAlerts, geofences: showGeofences,
  });
  const applyPreset = (preset: LayerPreset) => {
    const setters: Record<string, (v: boolean) => void> = {
      beats: setShowBeats, county: setShowCounty, municipality: setShowMunicipality,
      highway: setShowHighway, places: setShowPlaces,
      heatmap: setShowHeatmap, safety: setShowSafety, enforcement: setShowEnforcement,
      predictions: setShowPredictions,
      incidents: setShowIncidents, fi: setShowFi, checkpoints: setShowCheckpoints,
      fleet: setShowFleet,
      breadcrumbs: setShowBreadcrumbs, history: setShowCallHistory,
      repeat: setShowRepeat, dwell: setShowDwell,
      tracking: setShowTracking, alerts: setShowAlerts, geofences: setShowGeofences,
    };
    for (const [key, val] of Object.entries(preset.visibility)) {
      setters[key]?.(val);
    }
  };
  const contextMenu = useOlContextMenu(map);

  function toggleFullscreen() {
    if (!mapDivRef.current) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      mapDivRef.current.requestFullscreen().catch(() => {});
    }
  }
  // Note: useMapV2Shortcuts is wired below after screenshot/geo are defined,
  // since hook declaration order matters for the closures.

  // Tile-source swapping for the style switcher
  useEffect(() => {
    if (!tileLayerRef.current) return;
    let url: string;
    let attributions: string;
    let highZoomUrl: string | null = null;
    const cartoAttrib = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> © <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>';
    if (mapStyle === 'light') {
      url = 'https://{a-d}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png';
      attributions = cartoAttrib;
      highZoomUrl = url;
    } else if (mapStyle === 'voyager') {
      url = 'https://{a-d}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png';
      attributions = cartoAttrib;
      highZoomUrl = url;
    } else if (mapStyle === 'streets') {
      // OSM standard — full streets, water, parks, building footprints,
      // place labels. Highest detail of any free tile source. Live only.
      url = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
      attributions = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';
      highZoomUrl = url;
    } else if (mapStyle === 'detail') {
      // Esri Dark Gray Canvas — denser building/road detail than CartoDB
      // dark_matter while preserving the all-black aesthetic. Live only.
      url = 'https://services.arcgisonline.com/arcgis/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}';
      attributions = '© <a href="https://www.esri.com/" target="_blank" rel="noopener">Esri</a>, HERE, Garmin, Foursquare, FAO, METI/NASA, USGS';
      highZoomUrl = url;
    } else {
      url = '/tiles/{z}/{x}/{y}.png';
      attributions = cartoAttrib;
      // Dark style: keep offline cache as primary, live dark_all carries
      // the deeper-zoom (Z16-20) detail above the cache ceiling.
      highZoomUrl = 'https://{a-d}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png';
    }
    tileLayerRef.current.setSource(new XYZ({ url, maxZoom: 20, attributions }));
    if (highZoomLayerRef.current) {
      highZoomLayerRef.current.setSource(new XYZ({ url: highZoomUrl, maxZoom: 20 }));
    }
    // Esri reference overlay (parcel labels, road shields, transit lines,
    // address points) is enabled only for the Detail style — that's the
    // basemap it was designed to pair with, and the high-density labels
    // would clash with CartoDB's own label baking on the other styles.
    if (referenceOverlayRef.current) {
      referenceOverlayRef.current.setVisible(mapStyle === 'detail');
    }
  }, [mapStyle]);
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
  useMapV2Shortcuts(map, {
    onRecenter: recenter,
    onToggleFullscreen: toggleFullscreen,
    onScreenshot: () => screenshot(),
    onLocate: () => geo.locate(),
  });
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
      id: 'persisted',
      title: 'Persisted',
      layers: [
        { key: 'geofences', label: 'Geofences', color: '#a855f7', visible: showGeofences, onToggle: () => setShowGeofences(v => !v) },
      ],
    },
    {
      id: 'core',
      title: 'Core',
      layers: [
        {
          key: 'beats', label: showBeatHeat ? 'Beats (Heat)' : 'Beats', color: '#22c55e',
          visible: showBeats, onToggle: () => setShowBeats(v => !v), count: 719,
          controls: [
            { kind: 'segmented', label: 'COLOR', value: showBeatHeat ? 'heat' : 'sector',
              options: [{ value: 'sector', label: 'Sector' }, { value: 'heat', label: 'Calls' }],
              onChange: (v) => setShowBeatHeat(v === 'heat') },
          ],
        },
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
        { key: 'alerts', label: 'Active Panic Alerts', color: '#ef4444', visible: showAlerts, onToggle: () => setShowAlerts(v => !v) },
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
        { key: 'tracking', label: 'Tracking Lines', color: '#fbbf24', visible: showTracking, onToggle: () => setShowTracking(v => !v) },
        {
          key: 'breadcrumbs',
          label: `Breadcrumbs (${breadcrumbHours >= 720 ? '1mo' : breadcrumbHours >= 168 ? '1w' : breadcrumbHours + 'h'})`,
          color: '#14b8a6',
          visible: showBreadcrumbs, onToggle: () => setShowBreadcrumbs(v => !v),
          controls: [
            { kind: 'segmented', label: 'WIN', value: breadcrumbHours,
              options: [
                { value: 1, label: '1h' }, { value: 4, label: '4h' }, { value: 8, label: '8h' },
                { value: 24, label: '1d' }, { value: 168, label: '1w' }, { value: 720, label: '1mo' },
              ],
              onChange: (v) => setBreadcrumbHours(v as 1 | 4 | 8 | 24 | 168 | 720) },
            { kind: 'segmented', label: 'COLOR', value: breadcrumbColor,
              options: [{ value: 'unit', label: 'Unit' }, { value: 'speed', label: 'Speed' }, { value: 'status', label: 'Status' }],
              onChange: (v) => setBreadcrumbColor(v as BreadcrumbColorMode) },
          ],
        },
        // Advanced breadcrumb derived overlays — each toggleable independently
        { key: 'bc-stops', label: 'BC: Stops (\u22655min)', color: '#fbbf24', visible: bcShowStops, onToggle: () => setBcShowStops(v => !v) },
        { key: 'bc-warn', label: 'BC: Speed >80mph', color: '#ef4444', visible: bcShowSpeedWarnings, onToggle: () => setBcShowSpeedWarnings(v => !v) },
        { key: 'bc-brake', label: 'BC: Hard Brakes', color: '#dc2626', visible: bcShowHardBrakes, onToggle: () => setBcShowHardBrakes(v => !v) },
        { key: 'bc-status', label: 'BC: Status Changes', color: '#a855f7', visible: bcShowStatusChanges, onToggle: () => setBcShowStatusChanges(v => !v) },
        { key: 'bc-arrows', label: 'BC: Direction Arrows', color: '#14b8a6', visible: bcShowArrows, onToggle: () => setBcShowArrows(v => !v) },
        { key: 'bc-miles', label: 'BC: Mile Milestones', color: '#14b8a6', visible: bcShowMilestones, onToggle: () => setBcShowMilestones(v => !v) },
        { key: 'bc-hull', label: 'BC: Coverage Hull', color: '#14b8a6', visible: bcShowHull, onToggle: () => setBcShowHull(v => !v) },
        { key: 'bc-onduty', label: 'BC: Hide Off-Duty', color: '#888888', visible: bcHideOffDuty, onToggle: () => setBcHideOffDuty(v => !v) },
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
      <MapV2GeolocateButton onLocate={geo.locate} enabled={geo.enabled} />
      <MapV2RecenterButton onClick={recenter} />
      <MapV2CoverageBar stats={coverageStats} />
      <MapV2CursorReadout coords={cursorCoords} />
      <MapV2HoverTooltip tooltip={hoverTooltip} />
      <MapV2Legend bottomOffset={120} />
      <MapV2Compass map={map} />
      <MapV2NowClock />
      <MapV2ToastStack />
      <MapV2GpxExportButton
        trailCount={breadcrumbResult.trails.length}
        onExport={() => downloadGpx(breadcrumbResult.trails)}
      />
      <MapV2PresetsButton
        presets={presets}
        onSave={(name) => savePreset(name, captureVisibility())}
        onApply={applyPreset}
        onRemove={removePreset}
      />
      <MapV2StyleSwitcher value={mapStyle} onChange={setMapStyle} />
      <MapV2ContextMenu
        menu={contextMenu.menu}
        onClose={contextMenu.close}
        onSearchNearby={(lat, lng) => {
          // Reuse the address search bar's underlying mechanism — pan
          // and drop a pin at the right-click point so the user has
          // an immediate visual anchor.
          addressSearch.selectAddress({
            display_name: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
            latitude: lat,
            longitude: lng,
          });
        }}
      />
      <MapV2StatusBar daylight={daylight} onScreenshot={screenshot} />
    </div>
  );
}
