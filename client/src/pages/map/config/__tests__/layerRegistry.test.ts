import { describe, it, expect } from 'vitest';
import {
  MAP_LAYER_REGISTRY, LAYER_BY_ID, LEFT_DOCK_GROUPS, RIGHT_DOCK_GROUPS,
} from '../layerRegistry';
import { HIERARCHY_CONFIGS } from '../../../../hooks/useDistrictHierarchyLayers';
import { OSM_VECTOR_CONFIGS } from '../../../../hooks/useVectorTileLayers';

describe('MAP_LAYER_REGISTRY', () => {
  it('has a unique id for every entry', () => {
    const ids = MAP_LAYER_REGISTRY.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every entry an icon, a label, and a description', () => {
    for (const layer of MAP_LAYER_REGISTRY) {
      expect(layer.icon, `${layer.id} is missing an icon`).toBeTruthy();
      expect(layer.label.length, `${layer.id} has an empty label`).toBeGreaterThan(0);
      expect(layer.description.length, `${layer.id} has an empty description`).toBeGreaterThan(0);
    }
  });

  // The whole point of the registry is that colors re-theme. A literal hex here
  // would silently escape the theme system exactly the way the old inline
  // toggle arrays did.
  it('uses only CSS variables for color, never a literal hex', () => {
    for (const layer of MAP_LAYER_REGISTRY) {
      expect(layer.colorVar, `${layer.id} must use var(--x)`).toMatch(/^var\(--[a-z0-9-]+\)$/);
    }
  });

  it('never uses the banned #d4a017 gold', () => {
    const serialized = MAP_LAYER_REGISTRY.map((l) => l.colorVar).join(' ');
    expect(serialized.toLowerCase()).not.toContain('d4a017');
  });

  // --accent-gold-* is defined ONLY in the blue-silver theme block, so it would
  // render colorless in the other three. Gold is also restricted app-wide to
  // field labels and panel headers; a layer dot is neither.
  it('never uses a gold accent for a layer dot', () => {
    for (const layer of MAP_LAYER_REGISTRY) {
      expect(layer.colorVar, `${layer.id} must not use gold`).not.toContain('gold');
    }
  });

  it('assigns every entry to a declared dock group', () => {
    const declared = new Set<string>([...LEFT_DOCK_GROUPS, ...RIGHT_DOCK_GROUPS]);
    for (const layer of MAP_LAYER_REGISTRY) {
      expect(declared.has(layer.group), `${layer.id} has undeclared group ${layer.group}`).toBe(true);
    }
  });

  it('indexes every entry in LAYER_BY_ID', () => {
    expect(LAYER_BY_ID.size).toBe(MAP_LAYER_REGISTRY.length);
    for (const layer of MAP_LAYER_REGISTRY) {
      expect(LAYER_BY_ID.get(layer.id)).toBe(layer);
    }
  });

  // Boundary entries are DERIVED from the same config arrays the page consumes,
  // so the registry cannot drift from them when a district level is added.
  it('derives a boundary entry for every hierarchy config', () => {
    for (const cfg of HIERARCHY_CONFIGS) {
      expect(LAYER_BY_ID.has(`district-${cfg.id}`), `missing district-${cfg.id}`).toBe(true);
    }
  });

  it('derives a registry entry for EVERY OSM category, with none left over', () => {
    // Derived from the catalog rather than pinned to a magic number: the
    // catalog legitimately gains and loses categories (the seasonal/restricted
    // split added one), and a hardcoded count turns every such change into a
    // spurious failure that gets "fixed" by bumping the number — which would
    // also mask a category genuinely going missing.
    const osmEntries = MAP_LAYER_REGISTRY.filter((l) => l.group.startsWith('OSM'));
    expect(osmEntries.length).toBe(OSM_VECTOR_CONFIGS.length);
    for (const cfg of OSM_VECTOR_CONFIGS) {
      expect(LAYER_BY_ID.has(cfg.id), `missing registry entry for ${cfg.id}`).toBe(true);
    }
  });

  it('keeps the non-OSM toggles intact', () => {
    // A floor on the pre-existing set, so a refactor that silently drops the
    // original toggles cannot hide behind the derived OSM count above.
    const nonOsm = MAP_LAYER_REGISTRY.filter((l) => !l.group.startsWith('OSM'));
    expect(nonOsm.length).toBeGreaterThanOrEqual(56);
  });

  // The six GeoJSON boundary layers (geo-*) previously all collapsed onto one
  // hardcoded silver color, a visible regression from the per-layer stroke
  // colors MapboxMapPage used to derive from useGeoJsonLayers configs.
  it('gives the geo-* boundary layers distinct colors, not one flat silver', () => {
    const geoLayers = MAP_LAYER_REGISTRY.filter((l) => l.id.startsWith('geo-'));
    expect(geoLayers.length).toBeGreaterThan(0);
    const distinctColors = new Set(geoLayers.map((l) => l.colorVar));
    expect(distinctColors.size).toBeGreaterThan(1);

    expect(LAYER_BY_ID.get('geo-highway')?.colorVar).toBe('var(--sev-critical)');
    expect(LAYER_BY_ID.get('geo-beat')?.colorVar).toBe('var(--sev-ok)');
  });

  it('puts UGRC roads and addresses in Administrative Boundaries', () => {
    expect(LAYER_BY_ID.get('utah_roads')?.group).toBe('Administrative Boundaries');
    expect(LAYER_BY_ID.get('utah_addresses')?.group).toBe('Administrative Boundaries');
    expect(LAYER_BY_ID.get('utah_roads')?.label).toBe('Utah Roads');
  });

  it('pins safety-critical OSM overlays (ALPR, hydrants, rail crossings)', () => {
    expect(LAYER_BY_ID.get('osm_surveillance_alpr')?.pinned).toBe(true);
    expect(LAYER_BY_ID.get('osm_safety_hydrant')?.pinned).toBe(true);
    expect(LAYER_BY_ID.get('osm_access_rail_x')?.pinned).toBe(true);
  });
});
