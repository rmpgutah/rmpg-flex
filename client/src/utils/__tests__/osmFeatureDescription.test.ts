import { describe, it, expect } from 'vitest';
import {
  describeOsmFeature, formatHydrantDiameter, formatFlowRate,
} from '../osmFeatureDescription';

const rowFor = (d: ReturnType<typeof describeOsmFeature>, label: string) =>
  d.rows.find((r) => r.label === label)?.value;

describe('describeOsmFeature', () => {
  it('titles from name, falling back to the category label', () => {
    expect(describeOsmFeature({ name: 'Woodstock Elementary' }).title)
      .toBe('Woodstock Elementary');
    expect(describeOsmFeature({}, { categoryLabel: 'Fire hydrants' }).title)
      .toBe('Fire hydrants');
    expect(describeOsmFeature({}).title).toBe('Feature');
  });

  it('converts a bare metric clearance, which OSM stores in metres', () => {
    // "3.8" alone next to a US address is a clearance error waiting to happen.
    expect(rowFor(describeOsmFeature({ maxheight: '3.8' }), 'Clearance'))
      .toBe('12\' 6"');
  });

  it('converts a bare speed limit, which OSM stores in km/h', () => {
    expect(rowFor(describeOsmFeature({ maxspeed: '72' }), 'Speed limit'))
      .toBe('45 mph (72 km/h)');
    expect(rowFor(describeOsmFeature({ maxspeed: '45 mph' }), 'Speed limit'))
      .toBe('45 mph');
  });

  it('omits absent fields rather than reporting them as unknown', () => {
    // "Unknown" would imply we looked and found nothing.
    const d = describeOsmFeature({ name: 'X' });
    expect(d.rows.map((r) => r.label)).not.toContain('Clearance');
    expect(d.rows.some((r) => r.value === 'Unknown')).toBe(false);
  });

  it('collapses phone and contact:phone to a single row', () => {
    const d = describeOsmFeature({ phone: '801-555-0100', 'contact:phone': '801-555-0199' });
    expect(d.rows.filter((r) => r.label === 'Phone')).toHaveLength(1);
    expect(rowFor(d, 'Phone')).toBe('801-555-0100');
  });

  it('routes unknown tags to extras, capped at 8', () => {
    const props: Record<string, string> = { name: 'X' };
    for (let i = 0; i < 12; i++) props[`weird_tag_${i}`] = `v${i}`;
    const d = describeOsmFeature(props);
    expect(d.extras).toHaveLength(8);
    expect(d.extras[0].key).toMatch(/^weird_tag_/);
  });

  it('keeps RMPG edit-layer markers out of rows and extras', () => {
    // A correction must never be mistaken for OpenStreetMap's own data.
    const d = describeOsmFeature({
      name: 'X', __rmpg_note: 'Gate code 4412', __rmpg_verified: true,
      __rmpg_verified_at: '2026-07-30T12:00:00Z', __rmpg_overridden: 'maxheight,name',
    });
    expect(d.rmpg.verified).toBe(true);
    expect(d.rmpg.note).toBe('Gate code 4412');
    expect(d.rmpg.verifiedAt).toBe('2026-07-30');
    expect(d.rmpg.overriddenFields).toEqual(['maxheight', 'name']);
    const allKeys = [...d.rows, ...d.extras].map((r) => r.key);
    expect(allKeys.some((k) => k.startsWith('__rmpg'))).toBe(false);
  });

  it('builds a canonical OSM link from the element id', () => {
    expect(describeOsmFeature({ osm_id: 'w12345' }).osmLink?.url)
      .toBe('https://www.openstreetmap.org/way/12345');
    expect(describeOsmFeature({ osm_id: 'n99' }).osmLink?.url)
      .toBe('https://www.openstreetmap.org/node/99');
    expect(describeOsmFeature({ osm_id: 'r7' }).osmLink?.url)
      .toBe('https://www.openstreetmap.org/relation/7');
    expect(describeOsmFeature({}).osmLink).toBeUndefined();
  });

  it('returns values UNESCAPED — escaping is the renderer\'s job', () => {
    // The panel gets escaping free from JSX; osmPopup escapes into innerHTML.
    // Escaping here would double-escape in the popup.
    const d = describeOsmFeature({ name: 'A & B <script>' });
    expect(d.title).toBe('A & B <script>');
  });

  it('converts hydrant diameter millimetres to inches', () => {
    expect(formatHydrantDiameter('150')).toBe('5.9" (150 mm)');
    expect(formatHydrantDiameter('6 in')).toBe('6 in');
    expect(rowFor(describeOsmFeature({ 'fire_hydrant:diameter': '150' }), 'Main diameter'))
      .toBe('5.9" (150 mm)');
  });

  it('converts hydrant flow from L/s to GPM', () => {
    expect(formatFlowRate('20')).toMatch(/GPM/);
    expect(formatFlowRate('20')).toContain('20 L/s');
    expect(rowFor(describeOsmFeature({ flow_rate: '20' }), 'Flow rate')).toMatch(/GPM/);
  });
});
