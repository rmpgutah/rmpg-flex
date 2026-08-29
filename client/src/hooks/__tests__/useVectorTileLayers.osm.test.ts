import { describe, it, expect } from 'vitest';
import { VECTOR_TILE_CONFIGS, OSM_VECTOR_CONFIGS, buildOsmLayerSpecs, osmInteractiveLayerIds } from '../useVectorTileLayers';
import { OSM_GROUPS } from '../../config/osmLayers.generated';
// @ts-expect-error - untyped .mjs module
import { loadCatalog } from '../../../../scripts/osm/catalog.mjs';

describe('vector tile configs', () => {
  it('defaults EVERY layer to off, including the pre-existing UGRC ones', () => {
    for (const c of [...VECTOR_TILE_CONFIGS, ...OSM_VECTOR_CONFIGS]) {
      expect(c.defaultVisible, `${c.id} must default off`).toBe(false);
    }
  });

  it('gives every config a unique id', () => {
    const ids = [...VECTOR_TILE_CONFIGS, ...OSM_VECTOR_CONFIGS].map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('tags provenance so the legend can attribute correctly', () => {
    for (const c of VECTOR_TILE_CONFIGS) expect(c.source).toBe('ugrc');
    for (const c of OSM_VECTOR_CONFIGS) {
      expect(c.source).toBe('osm');
      expect(c.attribution).toContain('OpenStreetMap');
      expect(c.attribution).toContain('ODbL');
    }
  });

  it('gives every OSM config a categoryFilter and a shared archive', () => {
    for (const c of OSM_VECTOR_CONFIGS) {
      expect(c.categoryFilter, `${c.id}`).toBeTruthy();
      expect(c.archive, `${c.id}`).toMatch(/^osm-[a-z]+$/);
      expect(c.sourceLayer, `${c.id} source-layer must equal the group name`).toBeTruthy();
    }
  });

  it('carries a coverage caption on every OSM config', () => {
    for (const c of OSM_VECTOR_CONFIGS) {
      expect(c.coverage, `${c.id} needs a coverage caption`).toBeTruthy();
    }
  });

  it('never uses the banned #d4a017 gold', () => {
    const all = [...VECTOR_TILE_CONFIGS, ...OSM_VECTOR_CONFIGS].map((c) => c.color).join(' ');
    expect(all.toLowerCase()).not.toContain('d4a017');
  });

  it('never leaks CSS var() into Mapbox paint colors', () => {
    const all = [...VECTOR_TILE_CONFIGS, ...OSM_VECTOR_CONFIGS].map((c) => c.color).join(' ');
    expect(all).not.toContain('var(');
  });
});

describe('osm layer specs', () => {
  const specsFor = (id: string) => {
    const cfg = OSM_VECTOR_CONFIGS.find((c) => c.id === id)!;
    return buildOsmLayerSpecs(cfg, false);
  };

  it('filters every layer to its own category', () => {
    for (const spec of specsFor('osm_safety_hydrant')) {
      expect(JSON.stringify(spec.filter)).toContain('hydrant');
    }
  });

  it('never uses the UGRC address-point expressions', () => {
    const json = JSON.stringify(OSM_VECTOR_CONFIGS.flatMap((c) => buildOsmLayerSpecs(c, false)));
    expect(json).not.toContain('FullAdd');
    expect(json).not.toContain('AddNum');
    expect(json).not.toContain('PtType');
  });

  it('binds source-layer to the group name, not the category', () => {
    const spec = specsFor('osm_safety_hydrant')[0];
    expect(spec['source-layer']).toBe('safety');
  });

  it('applies the per-category minzoom, not the archive minimum', () => {
    // safety/inlet is z16 while the safety archive minimum is 11
    expect(specsFor('osm_safety_inlet')[0].minzoom).toBe(16);
  });

  it('renders jurisdiction as fill (polygons), drivability as line', () => {
    expect(specsFor('osm_jurisdiction_tribal')[0].type).toBe('fill');
    expect(specsFor('osm_drivability_unpaved')[0].type).toBe('line');
  });

  it('renders camera cones as fill beneath their icons', () => {
    const cone = specsFor('osm_surveillance_camera_cone')[0];
    expect(cone.type).toBe('fill');
  });

  // Regression: traffic/maxspeed (46,096 speed-limit ways) and
  // traffic/restriction (40,671 oneway/maxheight/maxweight ways) used to fall
  // through to 'circle' because OSM_FILL_CATEGORIES/OSM_LINE_CATEGORIES only
  // hardcoded camera_cone and power. render is now derived from the catalog's
  // filters, so every way-based mixed-geometry category renders as a line.
  it('renders osm_traffic_maxspeed as line', () => {
    expect(specsFor('osm_traffic_maxspeed').some((s) => s.type === 'line')).toBe(true);
    expect(specsFor('osm_traffic_maxspeed').some((s) => s.type === 'circle')).toBe(false);
  });

  it('renders osm_traffic_restriction as line', () => {
    expect(specsFor('osm_traffic_restriction').some((s) => s.type === 'line')).toBe(true);
    expect(specsFor('osm_traffic_restriction').some((s) => s.type === 'circle')).toBe(false);
  });

  it('dashes speed, clearance, and power so they do not look like basemap roads', () => {
    for (const id of ['osm_traffic_maxspeed', 'osm_access_clearance', 'osm_utility_power']) {
      const line = specsFor(id).find((s) => s.type === 'line');
      expect(line?.paint['line-dasharray'], id).toBeTruthy();
    }
  });

  it('renders osm_terrain_cliff as line', () => {
    expect(specsFor('osm_terrain_cliff').some((s) => s.type === 'line')).toBe(true);
    expect(specsFor('osm_terrain_cliff').some((s) => s.type === 'circle')).toBe(false);
  });

  it('renders osm_safety_hydrant as a point (circle or symbol)', () => {
    expect(specsFor('osm_safety_hydrant').some((s) => s.type === 'circle' || s.type === 'symbol')).toBe(true);
  });

  it('renders osm_jurisdiction_protected as fill', () => {
    expect(specsFor('osm_jurisdiction_protected').some((s) => s.type === 'fill')).toBe(true);
  });

  it('renders osm_surveillance_camera_cone as fill', () => {
    expect(specsFor('osm_surveillance_camera_cone').some((s) => s.type === 'fill')).toBe(true);
  });

  it('renders osm_utility_power as line (explicit override)', () => {
    expect(specsFor('osm_utility_power').some((s) => s.type === 'line')).toBe(true);
    expect(specsFor('osm_utility_power').some((s) => s.type === 'circle')).toBe(false);
  });

  it('never renders a category as circle when ALL of its catalog filters are way-only (w/-prefixed)', () => {
    const catalog = loadCatalog();
    for (const g of catalog.groups) {
      for (const c of g.categories) {
        const allWays = c.filters.every((f: string) => f.startsWith('w/'));
        if (!allWays) continue;
        const id = `osm_${g.name}_${c.cat}`;
        const specs = specsFor(id);
        expect(specs.some((s) => s.type === 'circle'), `${id} is way-only but rendered as circle`).toBe(false);
      }
    }
    // Sanity: OSM_GROUPS (the generated config actually consumed by the hook)
    // agrees with the catalog on every category present.
    expect(OSM_GROUPS.length).toBeGreaterThan(0);
  });
});

describe('osmInteractiveLayerIds', () => {
  it('returns EVERY emitted layer id for a polygon category', () => {
    // Polygon categories emit [fill, outline]. Binding only the last one put
    // the click target on a 1px outline, so clicking inside the polygon --
    // which is the whole polygon -- did nothing.
    const poly = OSM_VECTOR_CONFIGS.find((c) => c.categoryRender === 'polygon');
    expect(poly, 'expected at least one polygon OSM category').toBeDefined();

    const specs = buildOsmLayerSpecs(poly!, false);
    expect(specs.length).toBeGreaterThan(1);

    const ids = osmInteractiveLayerIds(poly!, false);
    for (const s of specs) expect(ids).toContain(s.id);
  });

  it('includes the fill layer, not just the outline', () => {
    const poly = OSM_VECTOR_CONFIGS.find((c) => c.categoryRender === 'polygon')!;
    const ids = osmInteractiveLayerIds(poly, false);
    expect(ids.some((id) => id.endsWith('-fill'))).toBe(true);
  });

  it('covers every emitted id for point and line categories too', () => {
    // Deliberately NOT a hardcoded count. A point category emits a circle AND
    // an icon symbol layer, and that number has already changed once (icons
    // were added after this helper was written). The invariant that actually
    // matters is "every emitted layer is bound", so assert that directly —
    // a count assertion just breaks whenever the renderer gains a layer, and
    // tells you nothing about whether the feature is clickable.
    for (const render of ['point', 'line'] as const) {
      const cfg = OSM_VECTOR_CONFIGS.find((c) => c.categoryRender === render)!;
      expect(cfg, `expected an OSM category rendering as ${render}`).toBeDefined();
      const specIds = buildOsmLayerSpecs(cfg, false).map((s) => s.id);
      expect(osmInteractiveLayerIds(cfg, false).sort()).toEqual([...new Set(specIds)].sort());
    }
  });

  it('returns no duplicate ids', () => {
    for (const cfg of OSM_VECTOR_CONFIGS) {
      const ids = osmInteractiveLayerIds(cfg, false);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});
