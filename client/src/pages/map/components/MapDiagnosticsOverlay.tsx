import { useEffect, useRef, useState } from 'react';
import type mapboxgl from 'mapbox-gl';

interface Props {
  map: mapboxgl.Map;
}

interface Metrics {
  zoom: string;
  pitch: string;
  bearing: string;
  lat: string;
  lng: string;
  layers: number;
  fps: string;
  renderMs: string;
}

export default function MapDiagnosticsOverlay({ map }: Props) {
  const [metrics, setMetrics] = useState<Metrics>({
    zoom: '—', pitch: '—', bearing: '—', lat: '—', lng: '—',
    layers: 0, fps: '—', renderMs: '—',
  });
  const lastFrameRef = useRef<number>(0);
  const lastRenderRef = useRef<number>(0);

  useEffect(() => {
    let frameId: number;
    let frameCount = 0;
    let lastFpsTime = performance.now();

    const loop = (now: number) => {
      frameCount++;
      if (now - lastFpsTime >= 1000) {
        const fps = Math.round(frameCount * 1000 / (now - lastFpsTime));
        lastFrameRef.current = fps;
        frameCount = 0;
        lastFpsTime = now;
      }
      frameId = requestAnimationFrame(loop);
    };
    frameId = requestAnimationFrame(loop);

    const onRender = () => {
      lastRenderRef.current = performance.now();
    };
    map.on('render', onRender);

    const interval = setInterval(() => {
      try {
        const center = map.getCenter();
        const style = map.getStyle();
        setMetrics({
          zoom: map.getZoom().toFixed(2),
          pitch: map.getPitch().toFixed(1),
          bearing: map.getBearing().toFixed(1),
          lat: center.lat.toFixed(6),
          lng: center.lng.toFixed(6),
          layers: style?.layers?.length ?? 0,
          fps: lastFrameRef.current > 0 ? String(lastFrameRef.current) : '—',
          renderMs: lastRenderRef.current > 0
            ? `${(performance.now() - lastRenderRef.current).toFixed(1)}`
            : '—',
        });
      } catch {}
    }, 500);

    return () => {
      cancelAnimationFrame(frameId);
      clearInterval(interval);
      map.off('render', onRender);
    };
  }, [map]);

  return (
    <div className="absolute top-12 right-12 z-40 tactical-dark border border-surface-raised rounded p-2 text-[10px] space-y-0.5 opacity-90 pointer-events-none select-none shadow-lg min-w-[160px]">
      <div className="text-brand-400 font-bold text-[9px] uppercase tracking-wider mb-1">Diagnostics</div>
      <div className="flex justify-between gap-4">
        <span className="text-rmpg-400">Zoom</span>
        <span className="text-rmpg-200 font-mono">{metrics.zoom}</span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-rmpg-400">Pitch</span>
        <span className="text-rmpg-200 font-mono">{metrics.pitch}°</span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-rmpg-400">Bearing</span>
        <span className="text-rmpg-200 font-mono">{metrics.bearing}°</span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-rmpg-400">Lat</span>
        <span className="text-rmpg-200 font-mono">{metrics.lat}</span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-rmpg-400">Lng</span>
        <span className="text-rmpg-200 font-mono">{metrics.lng}</span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-rmpg-400">Layers</span>
        <span className="text-rmpg-200 font-mono">{metrics.layers}</span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-rmpg-400">FPS</span>
        <span className={`font-mono ${
          metrics.fps !== '—' && Number(metrics.fps) < 30 ? 'text-red-400' : 'text-rmpg-200'
        }`}>{metrics.fps}</span>
      </div>
    </div>
  );
}
