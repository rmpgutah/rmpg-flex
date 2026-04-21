import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import 'ol/ol.css';
import OlMap from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import XYZ from 'ol/source/XYZ';
import { fromLonLat } from 'ol/proj';
import { defaults as defaultInteractions } from 'ol/interaction';
import { defaults as defaultControls } from 'ol/control';
import { useOlBeatLayer } from '../../map-v2/hooks/useOlBeatLayer';
import { useOlLiveMarkers } from '../../map-v2/hooks/useOlLiveMarkers';
import { useGeolocation } from '../hooks/useGeolocation';

const SLC_LON_LAT: [number, number] = [-111.891, 40.7608];

export default function MapSnippetCard() {
  const mapDivRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<OlMap | null>(null);
  const [map, setMap] = useState<OlMap | null>(null);
  const [error, setError] = useState(false);
  const { position } = useGeolocation({ enabled: true });

  useEffect(() => {
    if (!mapDivRef.current || mapInstanceRef.current) return;

    try {
      const tileLayer = new TileLayer({
        source: new XYZ({ url: '/tiles/{z}/{x}/{y}.png', maxZoom: 15 }),
      });

      const center: [number, number] = position
        ? [position.lng, position.lat]
        : SLC_LON_LAT;

      const instance = new OlMap({
        target: mapDivRef.current,
        layers: [tileLayer],
        view: new View({
          center: fromLonLat(center),
          zoom: 12,
          minZoom: 7,
          maxZoom: 15,
        }),
        // Read-only: disable all drag/zoom/rotate interactions.
        interactions: defaultInteractions({
          dragPan: false,
          mouseWheelZoom: false,
          doubleClickZoom: false,
          pinchRotate: false,
          pinchZoom: false,
          altShiftDragRotate: false,
          shiftDragZoom: false,
          keyboard: false,
        }),
        controls: defaultControls({ attribution: false, zoom: false, rotate: false }),
      });

      mapInstanceRef.current = instance;
      setMap(instance);
    } catch (e) {
      setError(true);
    }

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.setTarget(undefined);
        mapInstanceRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Recenter when geolocation becomes available after map init
  useEffect(() => {
    if (!map || !position) return;
    map.getView().setCenter(fromLonLat([position.lng, position.lat]));
  }, [map, position]);

  useOlBeatLayer(map, { visible: true });
  useOlLiveMarkers(map);

  return (
    <section className="bg-[#141414] border border-[#222] p-3">
      <h2 className="text-[#d4a017] text-[10px] font-bold tracking-widest mb-2">MAP</h2>
      <Link to="/map-v2" className="block">
        <div className="w-full h-[240px] bg-[#050505] border border-[#1a1a1a] relative overflow-hidden">
          {!map && !error && (
            <div className="absolute inset-0 animate-pulse bg-[#0a0a0a]" />
          )}
          {error && (
            <div className="absolute inset-0 flex items-center justify-center text-[#888] text-xs">
              Map unavailable
            </div>
          )}
          <div
            ref={mapDivRef}
            className="absolute inset-0"
            style={{ background: '#050505' }}
          />
        </div>
      </Link>
      <div className="mt-2 text-right text-[10px] text-[#d4a017] uppercase tracking-widest">
        <Link to="/map-v2">Open full map →</Link>
      </div>
    </section>
  );
}
