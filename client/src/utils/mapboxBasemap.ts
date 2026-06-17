// client/src/utils/mapboxBasemap.ts
// Runtime re-skin of a stock Mapbox style into the RMPG pure-black/gold theme.
// Call on the map's `style.load` event so it re-applies after every style swap.
// Every mutation is guarded: a layer missing from a given stock style is skipped,
// never thrown — the restyler must never blank the map.

import type mapboxgl from 'mapbox-gl';

export type BasemapVariant = 'dark' | 'satellite' | 'light';

const GOLD = '#d4a017';

function setPaint(map: mapboxgl.Map, id: string, prop: string, value: unknown): void {
  try {
    if (map.getLayer(id)) map.setPaintProperty(id, prop as never, value as never);
  } catch { /* layer absent or prop invalid for this style — skip */ }
}

function setLayout(map: mapboxgl.Map, id: string, prop: string, value: unknown): void {
  try {
    if (map.getLayer(id)) map.setLayoutProperty(id, prop as never, value as never);
  } catch { /* skip */ }
}

/** Apply theme to layers matched by predicate across all style layers. */
function forEachLayer(
  map: mapboxgl.Map,
  match: (id: string, type: string) => boolean,
  apply: (id: string, type: string) => void,
): void {
  let layers: mapboxgl.AnyLayer[] = [];
  try {
    layers = (map.getStyle()?.layers ?? []) as mapboxgl.AnyLayer[];
  } catch { return; }
  for (const layer of layers) {
    const id = layer.id;
    const type = (layer as { type?: string }).type ?? '';
    try { if (match(id, type)) apply(id, type); } catch { /* skip */ }
  }
}

function applyDark(map: mapboxgl.Map): void {
  // Background / land
  setPaint(map, 'background', 'background-color', '#000000');
  forEachLayer(map,
    (id, type) => type === 'background' || /land|landcover|landuse|national-park|park/i.test(id),
    (id, type) => {
      if (type === 'fill') setPaint(map, id, 'fill-color', '#0b0b0b');
      if (type === 'background') setPaint(map, id, 'background-color', '#000000');
    });

  // Water → near-black, zero blue
  forEachLayer(map, (id) => /water|ocean|river|bathymetry/i.test(id),
    (id, type) => {
      if (type === 'fill') setPaint(map, id, 'fill-color', '#050608');
      if (type === 'line') setPaint(map, id, 'line-color', '#050608');
    });

  // Roads — muted, with gold major arterials
  forEachLayer(map, (id, type) => type === 'line' && /road|street|bridge|tunnel|motorway|trunk|primary|secondary/i.test(id),
    (id) => {
      if (/motorway|trunk|primary/i.test(id)) {
        setPaint(map, id, 'line-color', GOLD);
        setPaint(map, id, 'line-opacity', 0.55);
      } else if (/secondary|tertiary/i.test(id)) {
        setPaint(map, id, 'line-color', '#262626');
      } else {
        setPaint(map, id, 'line-color', 'var(--surface-raised)');
      }
    });

  // Admin / boundaries
  forEachLayer(map, (id, type) => type === 'line' && /admin|boundary/i.test(id),
    (id) => setPaint(map, id, 'line-color', 'var(--border-subtle)'));

  // Labels: gold major, neutral minor, black halo; hide POI noise
  forEachLayer(map, (id, type) => type === 'symbol',
    (id) => {
      if (/poi|transit|airport|natural-point/i.test(id)) {
        setLayout(map, id, 'visibility', 'none');
        return;
      }
      setPaint(map, id, 'text-halo-color', '#000000');
      setPaint(map, id, 'text-halo-width', 1.2);
      if (/motorway|trunk|primary|place-(city|town)|settlement-major/i.test(id)) {
        setPaint(map, id, 'text-color', GOLD);
      } else {
        setPaint(map, id, 'text-color', '#888888');
      }
    });
}

function applySatellite(map: mapboxgl.Map): void {
  // Leave imagery; just make overlay roads/labels legible & on-brand.
  forEachLayer(map, (id, type) => type === 'line' && /road|motorway|trunk|primary/i.test(id),
    (id) => { if (/motorway|trunk|primary/i.test(id)) setPaint(map, id, 'line-color', GOLD); });
  forEachLayer(map, (id, type) => type === 'symbol',
    (id) => {
      setPaint(map, id, 'text-halo-color', '#000000');
      setPaint(map, id, 'text-halo-width', 1.4);
      setPaint(map, id, 'text-color', '#ffffff');
    });
}

/** Re-skin the loaded style. Safe to call repeatedly and on any stock style. */
export function applyRmpgBasemap(
  map: mapboxgl.Map | null | undefined,
  opts?: { variant?: BasemapVariant },
): void {
  if (!map) return;
  const variant = opts?.variant ?? 'dark';
  try {
    if (variant === 'satellite') applySatellite(map);
    else if (variant === 'dark') applyDark(map);
    // 'light' = print path: intentionally minimal, leave stock light style as-is.
  } catch { /* never throw from a cosmetic restyle */ }
}
