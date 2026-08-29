import { describe, it, expect } from 'vitest';
import { OSM_VECTOR_CONFIGS, buildOsmLayerSpecs } from '../useVectorTileLayers';

const specsFor = (id: string) => {
  const cfg = OSM_VECTOR_CONFIGS.find((c) => c.id === id);
  if (!cfg) throw new Error(`no config ${id}`);
  return buildOsmLayerSpecs(cfg, false);
};
const labelFor = (id: string) => specsFor(id).find((s) => s.id.endsWith('-label')) ?? null;

describe('on-map labels', () => {
  it('labels speed limits along the road line', () => {
    const l = labelFor('osm_traffic_maxspeed');
    expect(l).toBeTruthy();
    expect(l!.type).toBe('symbol');
    expect(l!.layout['symbol-placement']).toBe('line-center');
  });

  it('labels exit numbers, clearances, and transit stops', () => {
    for (const id of ['osm_traffic_junction', 'osm_access_clearance', 'osm_access_transit']) {
      expect(labelFor(id), `${id} should be labelled`).toBeTruthy();
    }
  });

  it('does NOT label high-density categories that would become clutter', () => {
    // 27,897 power poles, 113,885 crossings, 14,511 barriers — a name on each
    // would be unreadable soup at any zoom where they are visible.
    for (const id of ['osm_utility_pole', 'osm_traffic_crossing', 'osm_access_barrier']) {
      expect(labelFor(id), `${id} must not be labelled`).toBeNull();
    }
  });

  it('labels hydrant colour, building floors, and jurisdiction names', () => {
    expect(JSON.stringify(labelFor('osm_safety_hydrant')!.layout['text-field'])).toContain('colour');
    expect(JSON.stringify(labelFor('osm_sites_bldg_height')!.layout['text-field'])).toContain('building:levels');
    expect(labelFor('osm_jurisdiction_tribal')).toBeTruthy();
    expect(labelFor('osm_jurisdiction_protected')).toBeTruthy();
    expect(labelFor('osm_jurisdiction_military')).toBeTruthy();
  });

  it('gates a label no earlier than its own geometry', () => {
    for (const cfg of OSM_VECTOR_CONFIGS) {
      const l = buildOsmLayerSpecs(cfg, false).find((s) => s.id.endsWith('-label'));
      if (l) expect(l.minzoom, `${cfg.id} label`).toBeGreaterThanOrEqual(cfg.minzoom);
    }
  });

  it('starts every label hidden, like every other layer', () => {
    for (const cfg of OSM_VECTOR_CONFIGS) {
      for (const s of buildOsmLayerSpecs(cfg, false)) {
        expect(s.layout.visibility, `${s.id}`).toBe('none');
      }
    }
  });

  it('keeps every label filtered to its own category', () => {
    const l = labelFor('osm_traffic_maxspeed')!;
    expect(JSON.stringify(l.filter)).toContain('maxspeed');
  });

  it('gives every label a halo so it stays legible on the dark basemap', () => {
    for (const cfg of OSM_VECTOR_CONFIGS) {
      const l = buildOsmLayerSpecs(cfg, false).find((s) => s.id.endsWith('-label'));
      if (l) {
        expect(l.paint['text-halo-width'], `${cfg.id}`).toBeGreaterThan(0);
        expect(l.paint['text-halo-color'], `${cfg.id}`).toBeTruthy();
      }
    }
  });
});

describe('speed-limit label unit conversion', () => {
  const field = () => JSON.stringify(labelFor('osm_traffic_maxspeed')!.layout['text-field']);

  it('converts km/h to mph rather than printing the raw number', () => {
    // A bare OSM maxspeed is km/h. Printing "80" beside a US address reads as
    // 80 mph — a 30 mph error on a speed limit.
    expect(field()).toContain('0.621371');
  });

  it('handles an already-imperial value without double-converting', () => {
    expect(field()).toContain('mph');
    expect(field()).toContain('index-of');
  });

  it('fails CLOSED — an unparseable value yields an empty label, never a wrong number', () => {
    // "walk", "RU:urban" and "40;60" must produce no label at all. A wrong
    // speed limit on screen is worse than no speed limit.
    const f = labelFor('osm_traffic_maxspeed')!.layout['text-field'] as unknown[];
    expect(f[0]).toBe('case');
    expect(f[f.length - 1], 'the case fallback must be an empty string').toBe('');
  });
});

describe('clearance label unit conversion', () => {
  it('converts metres to feet and fails closed', () => {
    const f = labelFor('osm_access_clearance')!.layout['text-field'] as unknown[];
    expect(JSON.stringify(f)).toContain('3.28084');
    expect(JSON.stringify(f)).toContain('ft');
    expect(f[f.length - 1], 'must fall back to no label').toBe('');
  });
});
