import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { buildDockSections, findUnboundLayers, type LayerBindingMap } from '../useLayerBindings';
import { MAP_LAYER_REGISTRY, LEFT_DOCK_GROUPS, RIGHT_DOCK_GROUPS } from '../../config/layerRegistry';

function allBindings(): LayerBindingMap {
  const map: LayerBindingMap = {};
  for (const layer of MAP_LAYER_REGISTRY) {
    map[layer.id] = { active: false, onToggle: vi.fn() };
  }
  return map;
}

describe('buildDockSections', () => {
  it('emits one section per requested group, in order', () => {
    const sections = buildDockSections(LEFT_DOCK_GROUPS, allBindings());
    expect(sections.map((s) => s.title)).toEqual(LEFT_DOCK_GROUPS);
  });

  it('places every registry entry into exactly one dock section', () => {
    const bindings = allBindings();
    const all = [
      ...buildDockSections(LEFT_DOCK_GROUPS, bindings),
      ...buildDockSections(RIGHT_DOCK_GROUPS, bindings),
    ];
    const ids = all.flatMap((s) => s.items.map((i) => i.id));
    expect(ids.sort()).toEqual(MAP_LAYER_REGISTRY.map((l) => l.id).sort());
  });

  it('carries icon, color, and description through from the registry', () => {
    const [section] = buildDockSections(['Live Conditions'], allBindings());
    const traffic = section.items.find((i) => i.id === 'traffic')!;
    expect(traffic.icon).toBeTruthy();
    expect(traffic.color).toBe('var(--sev-ok)');
    expect(traffic.description).toBe('Real-time congestion');
  });

  it('lets a binding override the label for computed-label layers', () => {
    const bindings = allBindings();
    bindings.heatmap = { ...bindings.heatmap, label: 'Crime Heatmap (Live)' };
    const [section] = buildDockSections(['Historical Analysis'], bindings);
    expect(section.items.find((i) => i.id === 'heatmap')!.label).toBe('Crime Heatmap (Live)');
  });

  it('falls back to the registry label when no override is supplied', () => {
    const [section] = buildDockSections(['Historical Analysis'], allBindings());
    expect(section.items.find((i) => i.id === 'heatmap')!.label).toBe('Crime Heatmap');
  });

  it('lets a binding override the description for state-dependent help text', () => {
    const bindings = allBindings();
    bindings.deck = {
      ...bindings.deck,
      description: 'Deck.gl accelerated rendering (requires Mercator or Globe projection)',
    };
    const [section] = buildDockSections(['Diagnostics'], bindings);
    expect(section.items.find((i) => i.id === 'deck')!.description)
      .toBe('Deck.gl accelerated rendering (requires Mercator or Globe projection)');
  });

  it('falls back to the registry description when no override is supplied', () => {
    const [section] = buildDockSections(['Diagnostics'], allBindings());
    expect(section.items.find((i) => i.id === 'deck')!.description)
      .toBe('Deck.gl accelerated rendering');
  });

  it('omits a layer that has no binding rather than rendering a dead toggle', () => {
    const bindings = allBindings();
    delete bindings.traffic;
    const [section] = buildDockSections(['Live Conditions'], bindings);
    expect(section.items.some((i) => i.id === 'traffic')).toBe(false);
  });

  it('keeps Live Conditions non-collapsible so safety toggles stay visible', () => {
    const [section] = buildDockSections(['Live Conditions'], allBindings());
    expect(section.collapsible).toBe(false);
  });

  it('starts OSM groups collapsed with All/None ops', () => {
    const sections = buildDockSections(LEFT_DOCK_GROUPS, allBindings());
    const osm = sections.filter((s) => s.title.startsWith('OSM'));
    expect(osm.length).toBeGreaterThan(0);
    for (const s of osm) {
      expect(s.defaultOpen).toBe(false);
      expect(s.onEnableAll).toBeTypeOf('function');
      expect(s.onDisableAll).toBeTypeOf('function');
    }
  });

  it('gives Administrative Boundaries All/None bulk controls', () => {
    const [section] = buildDockSections(['Administrative Boundaries'], allBindings());
    expect(section.onEnableAll).toBeTypeOf('function');
    expect(section.onDisableAll).toBeTypeOf('function');
  });

  it('All enables only inactive OSM toggles; None disables only active ones', () => {
    const bindings = allBindings();
    const hydrant = MAP_LAYER_REGISTRY.find((l) => l.id.includes('hydrant'))!;
    bindings[hydrant.id] = { ...bindings[hydrant.id], active: true };
    const [section] = buildDockSections(['OSM Fire & Safety'], bindings);
    section.onEnableAll?.();
    for (const item of section.items) {
      if (item.id === hydrant.id) expect(bindings[item.id].onToggle).not.toHaveBeenCalled();
      else expect(bindings[item.id].onToggle).toHaveBeenCalledTimes(1);
    }
    vi.clearAllMocks();
    section.onDisableAll?.();
    expect(bindings[hydrant.id].onToggle).toHaveBeenCalledTimes(1);
    for (const item of section.items) {
      if (item.id !== hydrant.id) expect(bindings[item.id].onToggle).not.toHaveBeenCalled();
    }
  });
});

describe('findUnboundLayers', () => {
  it('reports nothing when every registry entry is bound', () => {
    expect(findUnboundLayers(allBindings())).toEqual({ missingBinding: [], unknownBinding: [] });
  });

  it('reports a registry entry that the page forgot to bind', () => {
    const bindings = allBindings();
    delete bindings.traffic;
    expect(findUnboundLayers(bindings).missingBinding).toContain('traffic');
  });

  it('reports a binding whose id is not in the registry', () => {
    const bindings = allBindings();
    bindings['ghost-layer'] = { active: false, onToggle: vi.fn() };
    expect(findUnboundLayers(bindings).unknownBinding).toContain('ghost-layer');
  });
});

// Guards the one silent failure mode of this refactor: a registry entry the
// page never binds (renders nothing, no error) or a typo'd binding key.
// Reading the source is deliberate — mounting MapboxMapPage requires a live
// Mapbox GL context, which is not available in jsdom.
describe('MapboxMapPage binding coverage', () => {
  it('binds every registry layer id', () => {
    const src = readFileSync(
      resolve(__dirname, '../../MapboxMapPage.tsx'),
      'utf8',
    );
    const bindingBlock = src.slice(
      src.indexOf('const layerBindings'),
      src.indexOf('const mapLeftDockSections'),
    );
    expect(bindingBlock.length, 'layerBindings block not found').toBeGreaterThan(0);

    const dynamic = new Set(['district-', 'geo-', 'osm_', 'utah_']);
    const missing = MAP_LAYER_REGISTRY
      .filter((l) => ![...dynamic].some((p) => l.id.startsWith(p)))
      .filter((l) => !bindingBlock.includes(`'${l.id}'`) && !new RegExp(`\\b${l.id}\\s*:`).test(bindingBlock))
      .map((l) => l.id);

    expect(missing, `unbound registry layers: ${missing.join(', ')}`).toEqual([]);
  });

  it('spreads district hierarchy configs into district-${cfg.id} bindings', () => {
    const src = readFileSync(
      resolve(__dirname, '../../MapboxMapPage.tsx'),
      'utf8',
    );
    const bindingBlock = src.slice(
      src.indexOf('const layerBindings'),
      src.indexOf('const mapLeftDockSections'),
    );
    expect(
      bindingBlock,
      'district-${cfg.id} spread (districtHierarchy.hierarchyConfigs) is missing from layerBindings — the Administrative Boundaries dock section will be missing its district toggles',
    ).toContain('`district-${cfg.id}`');
  });

  it('spreads geoJsonLayers configs into geo-${cfg.id} bindings', () => {
    const src = readFileSync(
      resolve(__dirname, '../../MapboxMapPage.tsx'),
      'utf8',
    );
    const bindingBlock = src.slice(
      src.indexOf('const layerBindings'),
      src.indexOf('const mapLeftDockSections'),
    );
    expect(
      bindingBlock,
      'geo-${cfg.id} spread (geoJsonLayers.configs) is missing from layerBindings — the Administrative Boundaries dock section will be missing its GeoJSON layer toggles',
    ).toContain('`geo-${cfg.id}`');
  });

  it('spreads vectorTiles configs (UGRC + OSM) into cfg.id-keyed bindings', () => {
    const src = readFileSync(
      resolve(__dirname, '../../MapboxMapPage.tsx'),
      'utf8',
    );
    const bindingBlock = src.slice(
      src.indexOf('const layerBindings'),
      src.indexOf('const mapLeftDockSections'),
    );
    expect(
      bindingBlock,
      'vectorTiles.vectorConfigs spread is missing from layerBindings — every OSM overlay dock section would be missing its toggles',
    ).toContain('vectorTiles.vectorConfigs.map');
  });

  it('does not wire Places Search to a category that is not in PLACE_CATEGORIES', () => {
    const src = readFileSync(
      resolve(__dirname, '../../MapboxMapPage.tsx'),
      'utf8',
    );
    expect(src).not.toContain("searchCategory('restaurant')");
    expect(src).toContain('PLACE_CATEGORIES');
  });
});
