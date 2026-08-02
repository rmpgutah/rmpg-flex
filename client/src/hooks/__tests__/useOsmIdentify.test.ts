import { describe, it, expect } from 'vitest';
import { buildIdentifyGroups } from '../useOsmIdentify';
import { OSM_VECTOR_CONFIGS } from '../useVectorTileLayers';

const byId = new Map(OSM_VECTOR_CONFIGS.map((c) => [c.id, c]));
const cfg = OSM_VECTOR_CONFIGS.find((c) => c.id.startsWith('osm_traffic_'))!;

describe('buildIdentifyGroups', () => {
  it('returns nothing for no features', () => {
    expect(buildIdentifyGroups([], byId)).toEqual([]);
  });

  it('groups one feature under its config label', () => {
    const groups = buildIdentifyGroups(
      [{ layer: { id: `vt-${cfg.id}-circle` }, properties: { name: 'Main St' } }],
      byId,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe(cfg.label);
  });

  it('renders declared detailProps as labelled rows', () => {
    const withMaxspeed = OSM_VECTOR_CONFIGS.find(
      (c) => c.detailProps.some((d) => d.key === 'maxspeed'),
    )!;
    const groups = buildIdentifyGroups(
      [{ layer: { id: `vt-${withMaxspeed.id}-line` }, properties: { maxspeed: '35 mph' } }],
      byId,
    );
    expect(groups[0].rows).toContainEqual({ label: 'Speed limit', value: '35 mph' });
  });

  it('omits properties that are absent or blank', () => {
    const groups = buildIdentifyGroups(
      [{ layer: { id: `vt-${cfg.id}-circle` }, properties: { name: 'X', maxspeed: '' } }],
      byId,
    );
    expect(groups[0].rows.some((r) => r.label === 'Speed limit')).toBe(false);
  });

  it('collapses several features of the same layer into one group', () => {
    const f = { layer: { id: `vt-${cfg.id}-circle` }, properties: { name: 'A' } };
    expect(buildIdentifyGroups([f, f, f], byId)).toHaveLength(1);
  });

  it('ignores features from non-OSM layers', () => {
    expect(buildIdentifyGroups(
      [{ layer: { id: 'some-basemap-layer' }, properties: {} }], byId,
    )).toEqual([]);
  });

  it('handles a polygon feature hit on its FILL layer', () => {
    // The whole point of Task 6 -- a polygon body click must identify.
    const poly = OSM_VECTOR_CONFIGS.find((c) => c.categoryRender === 'polygon')!;
    const groups = buildIdentifyGroups(
      [{ layer: { id: `vt-${poly.id}-fill` }, properties: { name: 'Zone' } }], byId,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe(poly.label);
  });
});
