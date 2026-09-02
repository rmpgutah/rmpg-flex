import { describe, it, expect } from 'vitest';
import {
  parseBearingToken, parseCameraDirections, formatCameraBearing,
  isOmnidirectionalHousing, cameraIconRotateExpression,
  cameraConeFillPaint, ALPR_COLOR, CCTV_COLOR,
} from '../osmCamera';
import { osmColorFor, OSM_LINE_DASH, OSM_CAT_DESCRIPTION } from '../osmOverlayStyle';
import { OSM_GROUPS } from '../../config/osmLayers.generated';

describe('camera direction parsing', () => {
  it('reads integer degrees and cardinals', () => {
    expect(parseBearingToken('225')).toBe(225);
    expect(parseBearingToken('NE')).toBe(45);
    expect(parseBearingToken(' n ')).toBe(0);
    expect(parseBearingToken('southwest')).toBe(225);
    expect(parseBearingToken('north-ish')).toBeNull();
  });

  it('splits multi-housing tags and coverage sweeps', () => {
    expect(parseCameraDirections('45;225').map((d) => d.bearing)).toEqual([45, 225]);
    const sweep = parseCameraDirections('0-90')[0];
    expect(sweep.bearing).toBe(45);
    expect(sweep.fov).toBe(90);
  });

  it('formats cardinals the same way as numeric bearings', () => {
    expect(formatCameraBearing('90')).toBe('E (90°)');
    expect(formatCameraBearing('NE')).toBe('NE (45°)');
    expect(formatCameraBearing('north-ish')).toBeNull();
  });

  it('treats dome / 360 housings as omnidirectional (no wedge)', () => {
    expect(isOmnidirectionalHousing({ 'camera:type': 'dome' })).toBe(true);
    expect(isOmnidirectionalHousing({ 'camera:direction': '360' })).toBe(true);
    expect(isOmnidirectionalHousing({ 'camera:type': 'fixed', 'camera:direction': '225' })).toBe(false);
  });
});

describe('camera map expressions', () => {
  it('does not rotate a dome housing', () => {
    expect(JSON.stringify(cameraIconRotateExpression())).toContain('dome');
  });

  it('picks cone fill by parent_cat', () => {
    const json = JSON.stringify(cameraConeFillPaint());
    expect(json).toContain(ALPR_COLOR);
    expect(json).toContain(CCTV_COLOR);
    expect(json).toContain('parent_cat');
  });
});

describe('OSM overlay style kit', () => {
  it('gives every catalog category a description', () => {
    for (const g of OSM_GROUPS) {
      for (const c of g.categories) {
        expect(OSM_CAT_DESCRIPTION[c.cat], c.cat).toBeTruthy();
      }
    }
  });

  it('never uses the banned gold', () => {
    const blob = JSON.stringify({ OSM_LINE_DASH, colors: OSM_GROUPS.flatMap((g) => g.categories.map((c) => osmColorFor(c.cat, g.name))) });
    expect(blob.toLowerCase()).not.toContain('d4a017');
  });

  it('dashes unpaved / 4WD / seasonal / pipeline so they do not look like basemap roads', () => {
    expect(OSM_LINE_DASH.unpaved).toBeTruthy();
    expect(OSM_LINE_DASH.fourwd).toBeTruthy();
    expect(OSM_LINE_DASH.seasonal).toBeTruthy();
    expect(OSM_LINE_DASH.pipeline).toBeTruthy();
  });
});
