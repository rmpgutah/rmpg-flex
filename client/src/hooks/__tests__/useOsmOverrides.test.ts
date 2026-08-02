import { describe, it, expect } from 'vitest';
import { mergeOverride, hiddenFilterClause, type OsmOverride } from '../useOsmOverrides';
import { buildOsmPopupHtml } from '../../utils/osmPopup';

const override = (p: Partial<OsmOverride> = {}): OsmOverride => ({
  osm_id: 'n83099358',
  group: 'safety',
  cat: 'hydrant',
  note: null,
  fields: {},
  hidden: false,
  verified: false,
  verified_at: null,
  updated_at: '2026-08-02 00:00:00',
  ...p,
});

describe('mergeOverride', () => {
  it('returns the original props untouched when there is no override', () => {
    const props = { cat: 'hydrant', colour: 'yellow' };
    expect(mergeOverride(props, undefined)).toBe(props);
  });

  it('overlays corrected fields without dropping the other OSM tags', () => {
    // A correction overlays; it does not replace the record.
    const out = mergeOverride(
      { cat: 'hydrant', colour: 'yellow', couplings: '2', operator: 'SLC' },
      override({ fields: { colour: 'red' } }),
    );
    expect(out.colour).toBe('red');
    expect(out.couplings).toBe('2');
    expect(out.operator).toBe('SLC');
  });

  it('never mutates the input props', () => {
    const props = { cat: 'hydrant', colour: 'yellow' };
    mergeOverride(props, override({ fields: { colour: 'red' } }));
    expect(props.colour, 'the tile feature must be untouched').toBe('yellow');
  });

  it('records WHICH fields RMPG changed', () => {
    // Showing a corrected value as if OSM published it would misattribute it.
    const out = mergeOverride({ cat: 'hydrant' }, override({ fields: { colour: 'red', couplings: '4' } }));
    expect(String(out.__rmpg_overridden).split(',').sort()).toEqual(['colour', 'couplings']);
  });

  it('carries the note and the verified stamp through', () => {
    const out = mergeOverride({ cat: 'hydrant' }, override({
      note: 'Capped — out of service', verified: true, verified_at: '2026-07-01 12:00:00',
    }));
    expect(out.__rmpg_note).toBe('Capped — out of service');
    expect(out.__rmpg_verified).toBe(true);
    expect(out.__rmpg_verified_at).toBe('2026-07-01 12:00:00');
  });

  it('adds no markers when the override is empty', () => {
    const out = mergeOverride({ cat: 'hydrant' }, override());
    expect(out.__rmpg_note).toBeUndefined();
    expect(out.__rmpg_verified).toBeUndefined();
    expect(out.__rmpg_overridden).toBeUndefined();
  });
});

describe('hiddenFilterClause', () => {
  it('returns null when nothing is hidden', () => {
    // Callers must leave the base filter alone rather than wrap it in a no-op
    // `all`, which would churn the style on every render.
    expect(hiddenFilterClause([])).toBeNull();
  });

  it('excludes the hidden ids', () => {
    const clause = hiddenFilterClause(['n1', 'w2'])!;
    expect(clause[0]).toBe('!');
    expect(JSON.stringify(clause)).toContain('osm_id');
    expect(JSON.stringify(clause)).toContain('n1');
    expect(JSON.stringify(clause)).toContain('w2');
  });

  it('uses a literal list rather than interpolating ids into the expression', () => {
    expect(JSON.stringify(hiddenFilterClause(['n1']))).toContain('literal');
  });
});

describe('popup rendering of overrides', () => {
  it('badges a verified feature so ground-truth is distinguishable', () => {
    const props = mergeOverride({ cat: 'hydrant' }, override({ verified: true, verified_at: '2026-07-01 12:00:00' }));
    const html = buildOsmPopupHtml(props, { categoryLabel: 'Fire hydrants' });
    expect(html).toContain('RMPG VERIFIED');
    expect(html).toContain('2026-07-01');
  });

  it('shows the operational note', () => {
    const props = mergeOverride({ cat: 'hydrant' }, override({ note: 'Capped — out of service' }));
    expect(buildOsmPopupHtml(props)).toContain('Capped — out of service');
  });

  it('names the corrected fields rather than passing them off as OSM data', () => {
    const props = mergeOverride({ cat: 'hydrant', colour: 'yellow' }, override({ fields: { colour: 'red' } }));
    const html = buildOsmPopupHtml(props);
    expect(html).toContain('Corrected by RMPG');
    expect(html).toContain('colour');
  });

  it('never renders the internal merge markers as ordinary detail rows', () => {
    const props = mergeOverride({ cat: 'hydrant' }, override({ note: 'x', verified: true, fields: { colour: 'red' } }));
    const html = buildOsmPopupHtml(props);
    expect(html).not.toContain('__rmpg_note');
    expect(html).not.toContain('__rmpg_verified');
    expect(html).not.toContain('__rmpg_overridden');
  });

  it('escapes a malicious note', () => {
    const props = mergeOverride({ cat: 'hydrant' }, override({ note: '<script>alert(1)</script>' }));
    const html = buildOsmPopupHtml(props);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('still shows OSM provenance on an overridden feature', () => {
    // A correction does not make the feature ours; it is still OSM data.
    const props = mergeOverride({ cat: 'hydrant', osm_id: 'n1' }, override({ verified: true }));
    const html = buildOsmPopupHtml(props);
    expect(html).toContain('Source: OpenStreetMap');
    expect(html).toContain('openstreetmap.org/node/1');
  });
});
