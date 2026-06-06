// ============================================================
// RMPG Flex — 3D map rendering (terrain + sky + extruded buildings)
// ============================================================
// Turns the flat top-down basemap into a pitched 3D scene:
//   • TERRAIN  — mapbox-dem raster-dem source + setTerrain() so the Wasatch
//     front actually has elevation (matters for line-of-sight / canyon calls).
//   • SKY      — atmospheric horizon so a pitched camera doesn't show void.
//   • BUILDINGS— fill-extrusion from the vector `composite` → `building`
//     source-layer, height-ramped and tinted to the Spillman pure-black theme.
//
// Two hard Mapbox facts this hook is built around:
//   1. setStyle() WIPES every custom source/layer (terrain included). So we
//      re-apply the whole 3D stack on EVERY `style.load`, gated on the live
//      enabled flag — otherwise 3D vanishes the moment an operator switches
//      basemap. This is the classic "my 3D disappeared" bug.
//   2. Source/layer mutations throw "Style is not done loading" if they race
//      the first paint, so every apply runs through whenStyleReady().
//
// The camera pitch + drag-rotate are toggled here too: 3D is meaningless at
// pitch 0, and the map is created with rotation disabled (rotation_enabled),
// so we explicitly enable orbiting while 3D is on.
// ============================================================

import { useEffect, useRef } from 'react';
import type mapboxgl from 'mapbox-gl';
import { whenStyleReady } from '../utils/safeAddSource';
import { devWarn } from '../../../utils/devLog';
import { hasLayer, hasSource, safeRemoveLayer, safeRemoveSource } from '../../../utils/mapboxSafeLayer';

const DEM_SOURCE = 'mapbox-dem';
const SKY_LAYER = 'rmpg-sky';
const BUILDING_LAYER = 'rmpg-3d-buildings';
const PITCH_3D = 60;

// Mapbox's documented default light — what a flat (3D-off) map expects. We
// restore this on teardown so disabling 3D doesn't leave the basemap oddly lit.
// Uses the new setLights API (flat type) to avoid the setLight deprecation.
const DEFAULT_LIGHT: mapboxgl.FlatLightSpecification = {
  id: 'default_light',
  type: 'flat',
  properties: {
    anchor: 'viewport', color: '#ffffff', intensity: 0.5, position: [1.15, 210, 30],
  },
};

// ── Directional key light ────────────────────────────────────────────────────
// Without this, every extruded face is the SAME flat shade and the skyline reads
// as a gray smear. A single low key light makes each face catch light at a
// different angle, so building massing actually reads in 3D.
// direction is [azimuth°, polar°]; polar 78 = a low, raking light that
// throws long facade shadows. Cool moonlight on the dark theme, warm key on light.
export function sceneLight(isLight: boolean): mapboxgl.DirectionalLightSpecification {
  return {
    id: 'scene_light',
    type: 'directional',
    properties: {
      color: isLight ? '#fff4e0' : '#c8d4ff',
      intensity: isLight ? 0.5 : 0.34,
      direction: [205, 78],
    },
  };
}

// ── Atmospheric fog ──────────────────────────────────────────────────────────
// Gives the pitched scene real depth: distant terrain + towers fade into haze
// instead of floating on a flat black void, and the horizon gains a graded sky
// dome. Tuned to the pure-black Spillman theme (near-black near-haze, faint
// stars overhead); a pale daylight blue on light/satellite basemaps.
export function sceneFog(isLight: boolean): mapboxgl.FogSpecification {
  return isLight
    ? { range: [1, 14], color: '#d4dbe7', 'high-color': '#a9c1e2', 'space-color': '#5d7cb0', 'horizon-blend': 0.05, 'star-intensity': 0 }
    : { range: [1.2, 13], color: '#0b0e15', 'high-color': '#11151f', 'space-color': '#05070d', 'horizon-blend': 0.07, 'star-intensity': 0.1 };
}

interface Opts {
  map: mapboxgl.Map | null;
  enabled: boolean;
  mapLoaded: boolean;
  /** Light/satellite basemaps need a lighter building tint to read against imagery. */
  isLight: boolean;
}

// ── Building color ramp (height in meters → color) ──────────────────────────
// EXPORTED so the treatment is easy to find and tune. This is a deliberate
// design choice for the pure-black Spillman/Motorola theme: low structures sit
// just above the #0a0a0a base, mid-rises lift to neutral gray, and only the
// tallest towers pick up a faint brand-gold warmth so downtown SLC reads as a
// skyline rather than a gray smear. Light/satellite basemaps invert toward a
// pale concrete gray so extrusions don't disappear into bright imagery.
export function buildingColorRamp(isLight: boolean): mapboxgl.ExpressionSpecification {
  if (isLight) {
    return [
      'interpolate', ['linear'], ['get', 'height'],
      0, '#cfcfcf',
      40, '#bdbdbd',
      120, '#a6a6a6',
      280, '#9a958a',
    ] as unknown as mapboxgl.ExpressionSpecification;
  }
  return [
    'interpolate', ['linear'], ['get', 'height'],
    0, '#1b1b1b',
    40, '#262626',
    120, '#343434',
    280, '#3c382c', // faint gold-warm on the tallest towers
  ] as unknown as mapboxgl.ExpressionSpecification;
}

/** Find the first label (symbol+text) layer so buildings extrude beneath labels. */
function firstLabelLayerId(map: mapboxgl.Map): string | undefined {
  const layers = map.getStyle()?.layers || [];
  for (const l of layers) {
    if (l.type === 'symbol' && (l.layout as any)?.['text-field']) return l.id;
  }
  return undefined;
}

/** Idempotently add terrain + sky + 3D buildings to the CURRENT style. */
function apply3D(map: mapboxgl.Map, isLight: boolean): void {
  try {
    // Terrain (works on every style — it's an independent raster-dem source).
    if (!hasSource(map, DEM_SOURCE)) {
      map.addSource(DEM_SOURCE, {
        type: 'raster-dem',
        url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
        tileSize: 512,
        maxzoom: 14,
      });
    }
    map.setTerrain({ source: DEM_SOURCE, exaggeration: 1.15 });

    // Sky / atmospheric horizon.
    if (!hasLayer(map, SKY_LAYER)) {
      map.addLayer({
        id: SKY_LAYER,
        type: 'sky',
        paint: {
          'sky-type': 'atmosphere',
          'sky-atmosphere-sun': [0.0, 90.0],
          'sky-atmosphere-sun-intensity': 5,
        },
      });
    }

    // Atmospheric depth + a directional key light. Both are scene-wide (not
    // layers), so they're set every apply and reset on teardown. Together they
    // turn the flat extrusions into a lit, hazy skyline with real perspective.
    map.setFog(sceneFog(isLight));
    map.setLights([sceneLight(isLight)]);

    // Extruded buildings — only where the vector building source-layer exists.
    if (!hasLayer(map, BUILDING_LAYER) && hasSource(map, 'composite')) {
      map.addLayer(
        {
          id: BUILDING_LAYER,
          source: 'composite',
          'source-layer': 'building',
          filter: ['==', ['get', 'extrude'], 'true'],
          type: 'fill-extrusion',
          minzoom: 13,
          paint: {
            'fill-extrusion-color': buildingColorRamp(isLight),
            // Grow the extrusion in over zoom 13→15 so buildings don't pop.
            'fill-extrusion-height': [
              'interpolate', ['linear'], ['zoom'],
              13, 0,
              15.05, ['get', 'height'],
            ],
            'fill-extrusion-base': [
              'interpolate', ['linear'], ['zoom'],
              13, 0,
              15.05, ['get', 'min_height'],
            ],
            'fill-extrusion-opacity': isLight ? 0.9 : 0.82,
            // Realism stack: a top→bottom face gradient (so walls aren't flat
            // fills) plus ambient occlusion — soft contact shadows where walls
            // meet the ground and each other. This is what makes the massing
            // read as solid volumes instead of colored cardboard.
            'fill-extrusion-vertical-gradient': true,
            'fill-extrusion-ambient-occlusion-intensity': isLight ? 0.3 : 0.45,
            'fill-extrusion-ambient-occlusion-radius': 3.2,
          },
        },
        firstLabelLayerId(map),
      );
    }
  } catch (err) {
    // A raster-only style (or a style mid-swap) can lack `composite`; terrain +
    // sky still applied. Never let a 3D apply crash the map.
    devWarn('[useMap3D] apply3D skipped a layer:', (err as any)?.message || err);
  }
}

/** Idempotently strip the 3D stack back to a flat basemap. */
function teardown3D(map: mapboxgl.Map): void {
  try {
    map.setTerrain(null);
    map.setFog(null);            // clear atmospheric haze
    map.setLights([DEFAULT_LIGHT]); // restore the flat-map default lighting
    safeRemoveLayer(map, BUILDING_LAYER);
    safeRemoveLayer(map, SKY_LAYER);
    safeRemoveSource(map, DEM_SOURCE);
  } catch (err) {
    devWarn('[useMap3D] teardown3D:', (err as any)?.message || err);
  }
}

export function useMap3D({ map, enabled, mapLoaded, isLight }: Opts): void {
  const enabledRef = useRef(enabled);
  const isLightRef = useRef(isLight);
  useEffect(() => { isLightRef.current = isLight; }, [isLight]);

  // Re-apply (or re-tint) on style switches while 3D is on. setStyle() wipes
  // every custom source/layer, so this listener is what keeps 3D persistent
  // across basemap changes. Lives for the whole map lifetime.
  useEffect(() => {
    if (!map) return;
    const onStyleLoad = () => {
      if (enabledRef.current) apply3D(map, isLightRef.current);
    };
    map.on('style.load', onStyleLoad);
    return () => { map.off('style.load', onStyleLoad); };
  }, [map]);

  // Respond to the toggle: build/tear-down the stack + animate the camera.
  useEffect(() => {
    enabledRef.current = enabled;
    if (!map || !mapLoaded) return;

    if (enabled) {
      // Operators need to orbit to make sense of extrusions; the map is created
      // with rotation disabled, so opt it back in while 3D is active.
      try {
        map.dragRotate.enable();
        map.touchZoomRotate.enableRotation();
        if ((map.getMaxPitch?.() ?? 0) < PITCH_3D) map.setMaxPitch(85);
      } catch { /* control may be absent on a torn-down map */ }
      whenStyleReady(map, () => apply3D(map, isLightRef.current));
      if ((map.getPitch?.() ?? 0) < 1) {
        map.easeTo({ pitch: PITCH_3D, duration: 800 });
      }
    } else {
      whenStyleReady(map, () => teardown3D(map));
      map.easeTo({ pitch: 0, bearing: 0, duration: 600 });
    }
  }, [enabled, map, mapLoaded]);

  // Live re-tint if the basemap brightness changes while 3D stays on (e.g.
  // dark → satellite without toggling 3D off). Re-applies the whole realism
  // stack — color/opacity/AO on the buildings plus the scene fog + light — so
  // a brightness swap doesn't leave dark-tuned haze over bright imagery.
  useEffect(() => {
    if (!map || !mapLoaded || !enabled) return;
    try {
      map.setFog(sceneFog(isLight));
      map.setLights([sceneLight(isLight)]);
    } catch { /* style mid-swap; style.load reapply will cover it */ }
    if (hasLayer(map, BUILDING_LAYER)) {
      try {
        map.setPaintProperty(BUILDING_LAYER, 'fill-extrusion-color', buildingColorRamp(isLight));
        map.setPaintProperty(BUILDING_LAYER, 'fill-extrusion-opacity', isLight ? 0.9 : 0.82);
        map.setPaintProperty(BUILDING_LAYER, 'fill-extrusion-ambient-occlusion-intensity', isLight ? 0.3 : 0.45);
      } catch { /* layer not ready; style.load reapply will cover it */ }
    }
  }, [isLight, map, mapLoaded, enabled]);
}
