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
import MapV2LayersPanel, { type LayerToggleConfig } from './components/MapV2LayersPanel';
import MapV2DrawToolbar from './components/MapV2DrawToolbar';

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

  const layers: LayerToggleConfig[] = [
    { key: 'county', label: 'Counties', color: '#888888', visible: showCounty, onToggle: () => setShowCounty(v => !v), count: 29 },
    { key: 'municipality', label: 'Municipalities', color: '#60a5fa', visible: showMunicipality, onToggle: () => setShowMunicipality(v => !v), count: 261 },
    { key: 'beats', label: 'Beats', color: '#22c55e', visible: showBeats, onToggle: () => setShowBeats(v => !v), count: 719 },
    { key: 'highway', label: 'Highways', color: '#fbbf24', visible: showHighway, onToggle: () => setShowHighway(v => !v), count: 3 },
    { key: 'places', label: 'Places', color: '#a78bfa', visible: showPlaces, onToggle: () => setShowPlaces(v => !v), count: 462 },
  ];

  return (
    <div className="relative w-full h-full bg-[#0a0a0a]">
      <div
        ref={mapDivRef}
        className="absolute inset-0"
        style={{ background: '#0a0a0a' }}
      />
      <div className="absolute top-2 left-2 z-10 px-2 py-1 bg-[#141414] border border-[#222222] text-[#d4a017] font-mono text-[10px] uppercase tracking-wider pointer-events-none">
        MAP V2 · OpenLayers · live units + calls
      </div>
      <MapV2LayersPanel layers={layers} />
      <MapV2DrawToolbar
        mode={drawMode}
        setMode={setDrawMode}
        onClear={() => setClearVersion(v => v + 1)}
      />
    </div>
  );
}
