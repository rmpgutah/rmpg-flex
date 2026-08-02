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
  it('keeps only allow-listed properties and adds cat', () => {
    const f = pt({
      emergency: 'fire_hydrant',
      colour: 'yellow',
      'fire_hydrant:type': 'pillar',
      'some:unlisted:tag': 'dropped',
      'created_by': 'JOSM',
    });
    const out = projectFeature(f, 'safety')!;
    expect(out.properties).toEqual({
      cat: 'hydrant',
      emergency: 'fire_hydrant',
      colour: 'yellow',
      'fire_hydrant:type': 'pillar',
    });
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
