import { describe, it, expect } from 'vitest';
import {
  buildOsmPopupHtml, formatSpeed, formatClearance, formatWeight,
  formatElevation, formatBearing, formatVoltage, formatOsmTimestamp,
} from '../osmPopup';

describe('US unit formatting', () => {
  it('passes mph through and converts a bare km/h number', () => {
    expect(formatSpeed('45 mph')).toBe('45 mph');
    // A bare OSM maxspeed is km/h. Rendering "80" next to a US address would
    // read as 80 mph — a 30 mph error.
    expect(formatSpeed('80')).toBe('50 mph (80 km/h)');
  });

  it('keeps non-numeric speed values intelligible', () => {
    expect(formatSpeed('walk')).toBe('walk');
    expect(formatSpeed('')).toBeNull();
  });

  it('converts a bare metric clearance to feet and inches', () => {
    // 4.1 m is a real bridge clearance; "4.1" alone is dangerously ambiguous.
    expect(formatClearance('4.1')).toBe('13\' 5"');
    expect(formatClearance('3')).toBe('9\' 10"');
  });

  it('leaves an already-imperial clearance alone', () => {
    expect(formatClearance('12\'6"')).toBe('12\'6"');
    expect(formatClearance('13 ft')).toBe('13 ft');
  });

  it('never rolls inches up to 12', () => {
    for (let cm = 0; cm <= 1500; cm += 7) {
      const out = formatClearance(String(cm / 100));
      expect(out, `${cm}cm -> ${out}`).not.toMatch(/ 12"$/);
    }
  });

  it('converts tonnes to US tons', () => {
    expect(formatWeight('10')).toBe('11.0 tons');
    expect(formatWeight('5 tons')).toBe('5 tons');
  });

  it('converts elevation to feet', () => {
    expect(formatElevation('1288')).toBe('4,226 ft');
    expect(formatElevation('nope')).toBeNull();
  });

  it('converts a bearing to a compass point', () => {
    expect(formatBearing('0')).toBe('N (0°)');
    expect(formatBearing('90')).toBe('E (90°)');
    expect(formatBearing('180')).toBe('S (180°)');
    expect(formatBearing('270')).toBe('W (270°)');
    expect(formatBearing('45')).toBe('NE (45°)');
    expect(formatBearing('NE')).toBe('NE (45°)');
  });

  it('normalises out-of-range and junk bearings', () => {
    expect(formatBearing('450')).toBe('E (90°)');
    expect(formatBearing('-90')).toBe('W (270°)');
    expect(formatBearing('north-ish')).toBeNull();
  });

  it('shows voltage in kV once volts stop reading well', () => {
    expect(formatVoltage('138000')).toBe('138 kV');
    expect(formatVoltage('480')).toBe('480 V');
  });

  it('formats an epoch timestamp as a date', () => {
    expect(formatOsmTimestamp('1707809666')).toBe('2024-02-13');
    expect(formatOsmTimestamp('')).toBeNull();
  });
});

describe('buildOsmPopupHtml', () => {
  it('surfaces what a camera actually captures', () => {
    const html = buildOsmPopupHtml({
      cat: 'alpr',
      name: 'SB 500 W ALPR',
      'surveillance:type': 'ALPR',
      'surveillance:zone': 'traffic',
      'camera:direction': '90',
      'camera:mount': 'pole',
      operator: 'UDOT',
    }, { categoryLabel: 'Cameras (ALPR)' });

    expect(html).toContain('SB 500 W ALPR');
    expect(html).toContain('Covers');       // surveillance:zone — the "what it captures" field
    expect(html).toContain('traffic');
    expect(html).toContain('Facing');
    expect(html).toContain('E (90°)');      // bearing as a compass point
    expect(html).toContain('UDOT');
  });

  it('shows hydrant detail a firefighter needs', () => {
    const html = buildOsmPopupHtml({
      cat: 'hydrant', 'fire_hydrant:type': 'pillar', colour: 'yellow', couplings: '2',
    }, { categoryLabel: 'Fire hydrants' });
    expect(html).toContain('Hydrant type');
    expect(html).toContain('pillar');
    expect(html).toContain('Bonnet colour');
    expect(html).toContain('Couplings');
  });

  it('omits absent fields entirely rather than saying Unknown', () => {
    const html = buildOsmPopupHtml({ cat: 'hydrant' }, { categoryLabel: 'Fire hydrants' });
    expect(html).not.toContain('Unknown');
    expect(html).not.toContain('undefined');
    expect(html).not.toContain('Bonnet colour');
  });

  it('never renders a bare metric clearance', () => {
    const html = buildOsmPopupHtml({ cat: 'clearance', maxheight: '4.1' });
    // escapeHtml encodes the feet/inches marks: 13' 5" -> 13&#39; 5&quot;
    expect(html).toContain('13&#39; 5&quot;');
    expect(html).toContain('Clearance');
    // The raw metric value must not appear as the rendered clearance.
    expect(html).not.toMatch(/Clearance<\/span><span[^>]*>\s*4\.1\s*</);
  });

  it('escapes user-generated OSM text', () => {
    const html = buildOsmPopupHtml({
      cat: 'station',
      name: '<img src=x onerror=alert(1)>',
      operator: '"><script>alert(2)</script>',
    });
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;img');
  });

  it('always carries OSM provenance', () => {
    const html = buildOsmPopupHtml({ cat: 'hydrant' });
    expect(html).toContain('Source: OpenStreetMap');
  });

  it('deep-links to the canonical OSM record using osm_id', () => {
    const node = buildOsmPopupHtml({ cat: 'hydrant', osm_id: 'n83099358' });
    expect(node).toContain('openstreetmap.org/node/83099358');
    const way = buildOsmPopupHtml({ cat: 'maxspeed', osm_id: 'w1234' });
    expect(way).toContain('openstreetmap.org/way/1234');
    const rel = buildOsmPopupHtml({ cat: 'protected', osm_id: 'r99' });
    expect(rel).toContain('openstreetmap.org/relation/99');
  });

  it('omits the deep link when the feature has no id', () => {
    expect(buildOsmPopupHtml({ cat: 'hydrant' })).not.toContain('openstreetmap.org/node');
  });

  it('shows the coverage caveat when the layer has one', () => {
    const caption = 'Crowd-sourced — coverage is incomplete. Absence does not indicate none present.';
    expect(buildOsmPopupHtml({ cat: 'hydrant' }, { coverage: caption })).toContain('Absence does not indicate');
  });

  it('does not print the same label twice for aliased tags', () => {
    const html = buildOsmPopupHtml({ cat: 'station', phone: '+1 555', 'contact:phone': '+1 666' });
    expect(html.match(/Phone/g)?.length).toBe(1);
  });

  it('surfaces captured tags that the field table does not name', () => {
    // Full-capture groups keep tags we have not enumerated; they must still be
    // visible rather than silently dropped by an incomplete table.
    const html = buildOsmPopupHtml({ cat: 'station', 'some:unmapped:tag': 'visible value' });
    expect(html).toContain('some:unmapped:tag');
    expect(html).toContain('visible value');
  });

  it('never leaks internal plumbing fields as detail rows', () => {
    const html = buildOsmPopupHtml({ cat: 'camera_cone', parent_cat: 'alpr', osm_id: 'n1' });
    expect(html).not.toContain('parent_cat');
    expect(html).not.toMatch(/>cat</);
  });
});
