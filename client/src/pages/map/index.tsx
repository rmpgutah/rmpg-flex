// ============================================================
// Map Page — Engine-aware wrapper
// ============================================================
// Routes to MapboxMapPage when the provider detection selects
// 'mapbox', otherwise falls back to the existing Google Maps
// MapPage. MapLibre also routes through MapboxMapPage since
// the Mapbox GL API is compatible.
// ============================================================

import { lazy, Suspense } from 'react';
import { useMapProvider } from './hooks/useMapProvider';

const GoogleMapPage = lazy(() => import('./MapPage'));
const MapboxMapPage = lazy(() => import('./MapboxMapPage'));

const LOADING_FALLBACK = (
  <div className="flex items-center justify-center h-full w-full bg-surface-base">
    <div className="flex items-center gap-3">
      <div className="w-5 h-5 border-2 border-brand-400 border-t-transparent rounded-full animate-spin" />
      <span className="text-white text-sm font-mono">Loading map…</span>
    </div>
  </div>
);

export default function MapPageRouter() {
  const { engine, detecting } = useMapProvider();

  if (detecting) return LOADING_FALLBACK;

  // Only Mapbox uses the Mapbox GL renderer (requires a Mapbox token)
  if (engine === 'mapbox') {
    return (
      <Suspense fallback={LOADING_FALLBACK}>
        <MapboxMapPage />
      </Suspense>
    );
  }

  // Google Maps, MapLibre, or unknown — use the existing full-featured MapPage
  // (MapLibre has no Mapbox token and cannot use MapboxMapPage)
  return (
    <Suspense fallback={LOADING_FALLBACK}>
      <GoogleMapPage />
    </Suspense>
  );
}
