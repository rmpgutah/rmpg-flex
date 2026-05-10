// ============================================================
// Map Page — Mapbox GL JS (mandatory engine)
// ============================================================
// Always renders MapboxMapPage. Google Maps has been fully
// removed from the system. MapLibre GL is the free fallback
// when no Mapbox token is configured.
// ============================================================

import { lazy, Suspense } from 'react';

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
  return (
    <Suspense fallback={LOADING_FALLBACK}>
      <MapboxMapPage />
    </Suspense>
  );
}
