// ============================================================
// RMPG Flex — Street View lightbox
// ============================================================
// Expandable, INTERACTIVE ground-level view of a clicked location, opened
// from the "What's Here" popup. Two modes, picked automatically:
//
//   • MAPILLARY  — when crowd-sourced street imagery exists at the point, embed
//     the official Mapillary viewer (pan / look-around) in an iframe. No extra
//     JS dependency; the only cost is a CSP frame-src allowance. A "look toward
//     the address" hint tells the operator which way to drag, since the embed
//     URL can't preset the initial yaw.
//
//   • PERSPECTIVE — universal fallback (always available from the Mapbox token).
//     A high-res oblique Static Image of the property that the operator can
//     ORBIT with the N/E/S/W + rotate controls, so they can "look around" the
//     building even where no street photo exists. Defaults to the bearing that
//     faces the building from the street.
//
// Mapbox has no Google-style Street View; this is the closest interactive
// ground view the platform supports while staying Google-free.
// ============================================================

import { useEffect, useState } from 'react';
import { X, Compass, RotateCw, RotateCcw, Camera, Eye } from 'lucide-react';
import { getMapillaryViewerUrl, getStreetPerspectiveUrl, getAerialThumbUrl, compassCardinal } from '../../../utils/locationImagery';

export interface StreetViewTarget {
  lng: number;
  lat: number;
  label?: string;
  /** Mapillary image id, when ground imagery was found at the point. */
  imageId?: string;
  /** Direction (deg, 0=N) to look from the imagery toward the address. */
  bearingToAddress?: number;
}

interface Props {
  target: StreetViewTarget | null;
  onClose: () => void;
}

export default function StreetViewLightbox({ target, onClose }: Props) {
  // Orbit bearing for the perspective fallback; seed from the address-facing
  // bearing so the FRONT of the building leads.
  const [bearing, setBearing] = useState(0);
  // Operators with sparse Mapillary coverage may prefer the always-on
  // perspective even when an image exists — let them flip.
  const [forcePerspective, setForcePerspective] = useState(false);

  useEffect(() => {
    if (target) {
      setBearing(Math.round(target.bearingToAddress ?? 0));
      setForcePerspective(false);
    }
  }, [target]);

  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [target, onClose]);

  if (!target) return null;

  const useMapillary = !!target.imageId && !forcePerspective;
  const viewerUrl = useMapillary ? getMapillaryViewerUrl(target.imageId) : '';
  // Big oblique frame for the perspective mode (pitch 60 = Static API max).
  const perspectiveUrl = getStreetPerspectiveUrl(target.lng, target.lat, {
    bearing, pitch: 60, zoom: 18, width: 960, height: 600,
  });
  const aerialUrl = getAerialThumbUrl(target.lng, target.lat, { zoom: 18, width: 960, height: 360 });
  const facing = target.bearingToAddress != null
    ? `${compassCardinal(target.bearingToAddress)} (${Math.round(target.bearingToAddress)}°)`
    : null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Street view"
      className="fixed inset-0 z-[3000] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="panel-beveled bg-surface-deep border border-rmpg-600 shadow-2xl flex flex-col"
        style={{ borderRadius: 2, width: 'min(980px, 96vw)', maxHeight: '92vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-rmpg-700">
          <Eye className="w-3.5 h-3.5 text-brand-400" />
          <span className="text-[11px] font-bold text-rmpg-200 uppercase tracking-widest flex-1 truncate">
            Street View{target.label ? ` — ${target.label}` : ''}
          </span>
          {target.imageId && (
            <button
              onClick={() => setForcePerspective((v) => !v)}
              className="flex items-center gap-1 px-2 py-1 text-[9px] font-bold uppercase tracking-wide text-rmpg-300 hover:text-white bg-rmpg-800/60 hover:bg-rmpg-700/60 transition-colors"
              style={{ borderRadius: 2 }}
              title="Switch between Mapillary street imagery and the Mapbox oblique perspective"
            >
              <Camera className="w-3 h-3" /> {useMapillary ? 'Perspective' : 'Mapillary'}
            </button>
          )}
          <button onClick={onClose} className="toolbar-btn" title="Close" aria-label="Close street view" style={{ padding: '0 3px' }}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Facing hint */}
        {facing && (
          <div className="flex items-center gap-1.5 px-3 py-1 border-b border-rmpg-800 text-[10px] text-rmpg-400">
            <Compass className="w-3 h-3 text-brand-400" />
            <span>Address is <span className="text-brand-300 font-bold">{facing}</span> from the camera —{' '}
              {useMapillary ? 'drag to look that way.' : 'orbit to keep the building front in view.'}</span>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-auto p-2" style={{ minHeight: 320 }}>
          {useMapillary ? (
            <iframe
              title="Mapillary street view"
              src={viewerUrl}
              className="w-full"
              style={{ border: 0, borderRadius: 2, height: 'min(620px, 70vh)', background: '#000' }}
              allow="fullscreen"
              loading="lazy"
            />
          ) : (
            <div className="space-y-2">
              <div className="relative">
                {perspectiveUrl ? (
                  <img
                    src={perspectiveUrl}
                    alt="Street-level oblique perspective"
                    className="w-full block"
                    style={{ borderRadius: 2, border: '1px solid #2e2e2e' }}
                  />
                ) : (
                  <div className="text-[11px] text-rmpg-500 p-8 text-center">Imagery token not ready — retry shortly.</div>
                )}
                {/* Orbit controls overlaid bottom-center */}
                <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-black/60 backdrop-blur-md px-1.5 py-1" style={{ borderRadius: 2 }}>
                  <button onClick={() => setBearing((b) => (b - 45 + 360) % 360)} className="toolbar-btn" title="Rotate left 45°" aria-label="Rotate left">
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                  {(['N', 'E', 'S', 'W'] as const).map((c, i) => {
                    const deg = i * 90;
                    const active = Math.abs(((bearing - deg) % 360 + 360) % 360) < 23 || Math.abs(((bearing - deg) % 360 + 360) % 360) > 337;
                    return (
                      <button
                        key={c}
                        onClick={() => setBearing(deg)}
                        className={`px-2 py-0.5 text-[10px] font-bold font-mono transition-colors ${active ? 'bg-brand-600/50 text-brand-100' : 'text-white/70 hover:bg-white/10'}`}
                        style={{ borderRadius: 2 }}
                        title={`Look from ${c}`}
                      >{c}</button>
                    );
                  })}
                  <button onClick={() => setBearing((b) => (b + 45) % 360)} className="toolbar-btn" title="Rotate right 45°" aria-label="Rotate right">
                    <RotateCw className="w-3.5 h-3.5" />
                  </button>
                  {target.bearingToAddress != null && (
                    <button
                      onClick={() => setBearing(Math.round(target.bearingToAddress!))}
                      className="px-2 py-0.5 text-[9px] font-bold uppercase text-brand-300 hover:bg-brand-600/30 transition-colors"
                      style={{ borderRadius: 2 }}
                      title="Face the building front"
                    >Front</button>
                  )}
                </div>
              </div>
              {aerialUrl && (
                <div>
                  <img src={aerialUrl} alt="Aerial" className="w-full block" style={{ borderRadius: 2, border: '1px solid #2e2e2e' }} />
                  <div className="text-[8px] text-rmpg-600 uppercase tracking-wide mt-0.5">Aerial · Satellite (top-down context)</div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer coords */}
        <div className="px-3 py-1.5 border-t border-rmpg-800 text-[9px] font-mono text-rmpg-600">
          {target.lat.toFixed(5)}, {target.lng.toFixed(5)}
        </div>
      </div>
    </div>
  );
}
