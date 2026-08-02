import { describe, it, expect, vi } from 'vitest';

vi.mock('mapbox-gl', () => ({ default: { Popup: class {} } }));

import { buildAlertFeatures, formatExpiry, SEVERITY_COLORS } from '../useMapWeatherAlerts';
import type { WeatherAlert } from '../useMapWeatherAlerts';

const poly = (x: number): GeoJSON.Polygon => ({
  type: 'Polygon',
  coordinates: [[[x, 0], [x + 1, 0], [x + 1, 1], [x, 0]]],
});

function alert(over: Partial<WeatherAlert> = {}): WeatherAlert {
  return {
    id: 'a1', event: 'Red Flag Warning', severity: 'Severe',
    urgency: null, certainty: null, headline: null, description: null,
    instruction: null, area_desc: null, sender: null,
    effective: null, onset: null, expires: null, ends: null,
    zone_ids: ['fire/UTZ479'], geometry: null, ...over,
  };
}

const ZONES = {
  'fire/UTZ479': { key: 'fire/UTZ479', id: 'UTZ479', name: 'Wasatch', geometry: poly(0) },
  'fire/UTZ488': { key: 'fire/UTZ488', id: 'UTZ488', name: 'Oquirrh', geometry: poly(5) },
};

describe('buildAlertFeatures', () => {
  it('merges an alert\'s zone polygons into one MultiPolygon', () => {
    const [f] = buildAlertFeatures([alert({ zone_ids: ['fire/UTZ479', 'fire/UTZ488'] })], ZONES);
    expect(f.geometry.type).toBe('MultiPolygon');
    expect((f.geometry as GeoJSON.MultiPolygon).coordinates).toHaveLength(2);
  });

  // Storm-based warnings carry a precise polygon; the zone is the whole
  // administrative region. Drawing the zone when a precise shape exists
  // over-warns by an enormous area.
  it('prefers an inline polygon over the zone shape', () => {
    const inline = poly(99);
    const [f] = buildAlertFeatures([alert({ geometry: inline })], ZONES);
    expect(f.geometry).toEqual(inline);
  });

  // Mapbox paints in source order, so the LAST feature draws on top. An
  // Extreme warning hidden beneath a Heat Advisory is the failure that matters.
  it('orders features so the most severe draws on top', () => {
    const out = buildAlertFeatures([
      alert({ id: 'extreme', severity: 'Extreme' }),
      alert({ id: 'minor', severity: 'Minor' }),
      alert({ id: 'moderate', severity: 'Moderate' }),
    ], ZONES);
    expect(out.map((f) => f.properties?.alert_id)).toEqual(['minor', 'moderate', 'extreme']);
  });

  it('assigns a severity colour to every feature', () => {
    const [f] = buildAlertFeatures([alert({ severity: 'Extreme' })], ZONES);
    expect(f.properties?.color).toBe(SEVERITY_COLORS.Extreme);
  });

  it('omits alerts whose zones have no geometry yet (list-only, not a crash)', () => {
    const out = buildAlertFeatures([alert({ zone_ids: ['fire/UNRESOLVED'] })], ZONES);
    expect(out).toEqual([]);
  });

  it('uses only the zones it can resolve when an alert spans several', () => {
    const [f] = buildAlertFeatures(
      [alert({ zone_ids: ['fire/UTZ479', 'fire/MISSING'] })],
      ZONES,
    );
    expect((f.geometry as GeoJSON.MultiPolygon).coordinates).toHaveLength(1);
  });

  it('flattens a MultiPolygon zone rather than nesting it one level too deep', () => {
    const multi: Record<string, { key: string; id: string; name: null; geometry: GeoJSON.Geometry }> = {
      'fire/M': {
        key: 'fire/M', id: 'M', name: null,
        geometry: { type: 'MultiPolygon', coordinates: [poly(0).coordinates, poly(2).coordinates] },
      },
    };
    const [f] = buildAlertFeatures([alert({ zone_ids: ['fire/M'] })], multi);
    const coords = (f.geometry as GeoJSON.MultiPolygon).coordinates;
    expect(coords).toHaveLength(2);
    // Each entry must be a polygon (array of rings), not an array of polygons.
    expect(coords[0][0][0]).toEqual([0, 0]);
  });

  it('carries the fields the popup renders', () => {
    const [f] = buildAlertFeatures([alert({
      event: 'Extreme Heat Warning', area_desc: 'Salt Lake Valley',
      expires: '2026-08-02T22:00:00-06:00', sender: 'NWS SLC', instruction: 'Stay hydrated.',
    })], ZONES);
    expect(f.properties).toMatchObject({
      event: 'Extreme Heat Warning',
      area_desc: 'Salt Lake Valley',
      sender: 'NWS SLC',
      instruction: 'Stay hydrated.',
    });
  });

  it('handles an empty alert list', () => {
    expect(buildAlertFeatures([], ZONES)).toEqual([]);
  });
});

describe('formatExpiry', () => {
  // Asserted by parts, not exact punctuation: ICU varies the weekday separator
  // between Node versions, and pinning "Sun, 10:00 PM" would fail on an
  // upgrade for a purely cosmetic reason.
  it('renders NWS ISO timestamps in Mountain Time', () => {
    // 22:00 MDT (-06:00) on a Sunday.
    expect(formatExpiry('2026-08-02T22:00:00-06:00')).toMatch(/^Sun.*10:00 ?\s?PM$/);
  });

  it('converts a UTC-stamped expiry into local Mountain Time', () => {
    // 04:00Z Monday = 22:00 MDT Sunday — proves the zone conversion happens
    // rather than the raw string being echoed.
    expect(formatExpiry('2026-08-03T04:00:00Z')).toMatch(/^Sun.*10:00 ?\s?PM$/);
  });

  it('returns null for missing or unparseable input instead of "Invalid Date"', () => {
    expect(formatExpiry(null)).toBeNull();
    expect(formatExpiry(undefined)).toBeNull();
    expect(formatExpiry('not a date')).toBeNull();
  });
});
