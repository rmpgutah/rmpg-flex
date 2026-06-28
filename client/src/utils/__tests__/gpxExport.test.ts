import { describe, it, expect } from 'vitest';
import { trackToGpx } from '../gpxExport';

describe('gpxExport — trackToGpx', () => {
  it('emits a valid GPX 1.1 header and structure', () => {
    const xml = trackToGpx(
      [{ lat: 40.7608, lng: -111.891, t: 0, ele: 1288, speed: 12.3 }],
      { name: 'Patrol 1', unit: 'A-12' },
    );
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('version="1.1"');
    expect(xml).toContain('http://www.topografix.com/GPX/1/1');
    expect(xml).toContain('<trk>');
    expect(xml).toContain('<trkseg>');
  });

  it('emits trkpt with lat/lon attrs, ele, ISO time, speed', () => {
    const xml = trackToGpx(
      [{ lat: 40.5, lng: -111.5, t: 0, ele: 1300, speed: 5 }],
      { name: 'T' },
    );
    expect(xml).toContain('<trkpt lat="40.5" lon="-111.5">');
    expect(xml).toContain('<ele>1300</ele>');
    expect(xml).toContain('<time>1970-01-01T00:00:00.000Z</time>');
    expect(xml).toContain('<speed>5</speed>');
  });

  it('escapes XML special chars in names', () => {
    const xml = trackToGpx([], { name: 'A & B <"C">' });
    expect(xml).toContain('A &amp; B &lt;&quot;C&quot;&gt;');
    expect(xml).not.toContain('A & B <"C">');
  });

  it('skips points with non-finite coords', () => {
    const xml = trackToGpx(
      [{ lat: NaN, lng: 0 }, { lat: 1, lng: 2 }],
      { name: 'T' },
    );
    const count = (xml.match(/<trkpt /g) || []).length;
    expect(count).toBe(1);
  });

  it('omits time element for missing/invalid timestamps', () => {
    const xml = trackToGpx([{ lat: 1, lng: 2 }], { name: 'T' });
    expect(xml).not.toContain('<time>');
  });
});
