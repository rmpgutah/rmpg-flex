import { describe, it, expect } from 'vitest';
// @ts-expect-error - untyped .mjs module
import { assignCategory, projectFeature, projectFeatures } from '../scripts/osm/project.mjs';

const pt = (props: Record<string, string>) => ({
  type: 'Feature' as const,
  geometry: { type: 'Point' as const, coordinates: [-111.89, 40.76] },
  properties: props,
});

describe('assignCategory', () => {
  it('picks the more specific category first (ALPR before generic camera)', () => {
    expect(assignCategory({ man_made: 'surveillance', 'surveillance:type': 'ALPR' }, 'surveillance')).toBe('alpr');
  });

  it('falls back to the general category when the specific rule does not hold', () => {
    expect(assignCategory({ man_made: 'surveillance' }, 'surveillance')).toBe('camera');
    expect(assignCategory({ man_made: 'surveillance', 'surveillance:type': 'camera' }, 'surveillance')).toBe('camera');
  });

  it('returns null when nothing matches', () => {
    expect(assignCategory({ amenity: 'cafe' }, 'surveillance')).toBeNull();
  });

  it('ANDs match rules by default', () => {
    // surveillance/alpr requires BOTH man_made=surveillance AND surveillance:type=ALPR
    expect(assignCategory({ 'surveillance:type': 'ALPR' }, 'surveillance')).toBeNull();
  });

  it('ORs match rules under matchMode:any', () => {
    // safety/heli is matchMode:any — aeroway OR emergency alone is enough
    expect(assignCategory({ aeroway: 'helipad' }, 'safety')).toBe('heli');
    expect(assignCategory({ emergency: 'landing_site' }, 'safety')).toBe('heli');
  });

  it('treats present:true as "tag exists and is non-empty"', () => {
    expect(assignCategory({ maxspeed: '45 mph' }, 'traffic')).toBe('maxspeed');
    expect(assignCategory({ maxspeed: '' }, 'traffic')).toBeNull();
  });

  it('assigns hydrants correctly', () => {
    expect(assignCategory({ emergency: 'fire_hydrant' }, 'safety')).toBe('hydrant');
  });
});

describe('projectFeature', () => {
  it('keeps only allow-listed properties on an allow-list group', () => {
    // `traffic` keeps an explicit array to bound tile size.
    const way = {
      type: 'Feature' as const,
      geometry: { type: 'LineString' as const, coordinates: [[-111.89, 40.76], [-111.88, 40.77]] },
      properties: { maxspeed: '45 mph', name: 'State St', 'some:unlisted:tag': 'dropped' },
    };
    const out = projectFeature(way, 'traffic')!;
    expect(out.properties).toEqual({ cat: 'maxspeed', maxspeed: '45 mph', name: 'State St' });
  });

  it("captures EVERY non-noise tag on a '*' group, matching openstreetmap.org", () => {
    // `safety` captures '*': the popup should be able to show the same detail
    // the OSM website shows — full address, phone, website, operator.
    const f = pt({
      emergency: 'fire_hydrant',
      colour: 'yellow',
      'fire_hydrant:type': 'pillar',
      'addr:street': 'East 80 North',
      'contact:phone': '+1 801-763-3020',
      'some:unlisted:tag': 'kept now',
    });
    const out = projectFeature(f, 'safety')!;
    expect(out.properties['addr:street']).toBe('East 80 North');
    expect(out.properties['contact:phone']).toBe('+1 801-763-3020');
    expect(out.properties['some:unlisted:tag']).toBe('kept now');
    expect(out.properties.cat).toBe('hydrant');
  });

  it("still drops noise tags under '*' so tiles do not carry editor cruft", () => {
    const f = pt({
      emergency: 'fire_hydrant',
      created_by: 'JOSM',
      source: 'survey',
      'tiger:tlid': '123456',
      note: 'check this',
      '@version': '7',
    });
    const out = projectFeature(f, 'safety')!;
    for (const junk of ['created_by', 'source', 'tiger:tlid', 'note', '@version']) {
      expect(out.properties[junk], `${junk} should be dropped as noise`).toBeUndefined();
    }
  });

  it('carries the OSM element id so a feature is addressable', () => {
    // Without a stable id, an internal edit cannot attach to a specific
    // feature, and nothing can be diffed across extract refreshes.
    const f = { ...pt({ emergency: 'fire_hydrant' }), id: 'n83099358' };
    const out = projectFeature(f as any, 'safety')!;
    expect(out.properties.osm_id).toBe('n83099358');
  });

  it('re-exports OSM metadata under stable names', () => {
    const f = { ...pt({ emergency: 'fire_hydrant', '@version': '15', '@timestamp': '1707809666' }), id: 'n1' };
    const out = projectFeature(f as any, 'safety')!;
    expect(out.properties.osm_version).toBe('15');
    expect(out.properties.osm_timestamp).toBe('1707809666');
    // The raw @-prefixed forms must not leak into the tiles.
    expect(out.properties['@version']).toBeUndefined();
  });

  it('omits allow-listed properties that are absent or empty', () => {
    const out = projectFeature(pt({ emergency: 'fire_hydrant', colour: '' }), 'safety')!;
    expect(out.properties).not.toHaveProperty('colour');
    expect(out.properties.cat).toBe('hydrant');
  });

  it('preserves geometry untouched', () => {
    const f = pt({ emergency: 'fire_hydrant' });
    const out = projectFeature(f, 'safety')!;
    expect(out.geometry).toEqual({ type: 'Point', coordinates: [-111.89, 40.76] });
  });

  it('returns null for a feature that matches no category', () => {
    expect(projectFeature(pt({ amenity: 'cafe' }), 'safety')).toBeNull();
  });

  it('does not mutate the input feature', () => {
    const f = pt({ emergency: 'fire_hydrant', 'created_by': 'JOSM' });
    projectFeature(f, 'safety');
    expect(f.properties['created_by']).toBe('JOSM');
  });
});

describe('projectFeatures (multi-emit)', () => {
  it('emits one feature per matching category for a `multi` group, with distinct cat and identical geometry', () => {
    // traffic/maxspeed + traffic/restriction both match a way tagged with both.
    const f = pt({ highway: 'residential', maxspeed: '25 mph', oneway: 'yes' });
    const out = projectFeatures(f, 'traffic');
    expect(out).toHaveLength(2);
    const cats = out.map((o: any) => o.properties.cat).sort();
    expect(cats).toEqual(['maxspeed', 'restriction']);
    for (const o of out) {
      expect(o.geometry).toEqual(f.geometry);
    }
  });

  it('returns exactly one feature for a `first-match` group', () => {
    const f = pt({ emergency: 'fire_hydrant' });
    const out = projectFeatures(f, 'safety');
    expect(out).toHaveLength(1);
    expect(out[0].properties.cat).toBe('hydrant');
  });

  it('the surveillance regression: an ALPR camera returns exactly ONE feature (cat=alpr), never two', () => {
    const f = pt({ man_made: 'surveillance', 'surveillance:type': 'ALPR' });
    const out = projectFeatures(f, 'surveillance');
    expect(out).toHaveLength(1);
    expect(out[0].properties.cat).toBe('alpr');
  });

  it('returns [] when nothing matches', () => {
    expect(projectFeatures(pt({ amenity: 'cafe' }), 'safety')).toEqual([]);
  });
});

describe('projectFeature contract is unchanged by multi-emit', () => {
  it('still returns only the first match for a `multi` group', () => {
    const f = pt({ highway: 'residential', maxspeed: '25 mph', oneway: 'yes' });
    const out = projectFeature(f, 'traffic');
    expect(out!.properties.cat).toBe('maxspeed');
  });

  it('still returns null when nothing matches', () => {
    expect(projectFeature(pt({ amenity: 'cafe' }), 'traffic')).toBeNull();
  });
});
