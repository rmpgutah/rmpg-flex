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

const SLC_LON_LAT: [number, number] = [-111.891, 40.760];

export default function MapPageV2() {
  const mapDivRef = useRef<HTMLDivElement | null>(null);
  const [map, setMap] = useState<Map | null>(null);

  useEffect(() => {
    if (!mapDivRef.current || map) return;

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
    setMap(instance);

    return () => {
      instance.setTarget(undefined);
      setMap(null);
    };
  }, [map]);

  useOlBeatLayer(map);
  useOlLiveMarkers(map);

  return (
    <div className="relative w-full h-full bg-[#0a0a0a]">
      <div
        ref={mapDivRef}
        className="absolute inset-0"
        style={{ background: '#0a0a0a' }}
      />
      <div className="absolute top-2 left-2 z-10 px-2 py-1 bg-[#141414] border border-[#222222] text-[#d4a017] font-mono text-[10px] uppercase tracking-wider pointer-events-none">
        MAP V2 · OpenLayers · Beta · 719 beats · live units + calls
      </div>
    </div>
  );
}
