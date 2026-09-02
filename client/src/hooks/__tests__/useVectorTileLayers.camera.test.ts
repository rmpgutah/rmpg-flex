import { describe, it, expect } from 'vitest';
import { OSM_VECTOR_CONFIGS, buildOsmLayerSpecs } from '../useVectorTileLayers';
import { ALPR_COLOR, CCTV_COLOR, cameraIconRotateExpression } from '../../utils/osmCamera';

const specsFor = (id: string) => {
  const cfg = OSM_VECTOR_CONFIGS.find((c) => c.id === id);
  if (!cfg) throw new Error(`no config ${id}`);
  return buildOsmLayerSpecs(cfg, false);
};

function numbersAtMostOne(value: unknown): number[] {
  const out: number[] = [];
  const walk = (v: unknown) => {
    if (typeof v === 'number' && v <= 1) out.push(v);
    if (Array.isArray(v)) v.forEach(walk);
  };
  walk(value);
  return out;
}

describe('OSM camera layers — utilitarian CAD', () => {
  it('gives ALPR and public cameras different identity colors', () => {
    const alpr = OSM_VECTOR_CONFIGS.find((c) => c.id === 'osm_surveillance_alpr')!;
    const camera = OSM_VECTOR_CONFIGS.find((c) => c.id === 'osm_surveillance_camera')!;
    expect(alpr.color).toBe(ALPR_COLOR);
    expect(camera.color).toBe(CCTV_COLOR);
    expect(alpr.color).not.toBe(camera.color);
  });

  it('renders ALPR as a symbol with a status ring under the glyph', () => {
    const specs = specsFor('osm_surveillance_alpr');
    expect(specs.find((s) => s.id.endsWith('-halo'))?.type).toBe('circle');
    expect(specs.find((s) => s.id.endsWith('-symbol'))?.type).toBe('symbol');
    const haloIdx = specs.findIndex((s) => s.id.endsWith('-halo'));
    const symbolIdx = specs.findIndex((s) => s.id.endsWith('-symbol'));
    expect(haloIdx).toBeGreaterThanOrEqual(0);
    expect(symbolIdx).toBeGreaterThan(haloIdx);
  });

  it('rotates camera glyphs to map-north bearing and does not rotate a dome', () => {
    const layout = specsFor('osm_surveillance_alpr').find((s) => s.type === 'symbol')!.layout;
    expect(layout['icon-rotation-alignment']).toBe('map');
    expect(layout['icon-pitch-alignment']).toBe('map');
    const rotate = JSON.stringify(layout['icon-rotate']);
    expect(rotate).toContain('camera:bearing');
    expect(rotate).toContain('camera:direction');
    expect(rotate).toContain('dome');
    expect(JSON.stringify(cameraIconRotateExpression())).toContain('dome');
  });

  it('still draws a camera that has no bearing (unrotated icon, no fabricated north)', () => {
    const symbol = specsFor('osm_surveillance_camera').find((s) => s.type === 'symbol');
    expect(symbol).toBeTruthy();
    expect(JSON.stringify(symbol!.filter)).toContain('camera');
  });

  it('paints ALPR cones and public CCTV cones as different fills', () => {
    const fill = specsFor('osm_surveillance_camera_cone').find((s) => s.type === 'fill')!;
    const json = JSON.stringify(fill.paint);
    expect(json).toContain(ALPR_COLOR);
    expect(json).toContain(CCTV_COLOR);
    expect(json).toContain('parent_cat');
  });

  it('keeps cone fill opacity at or below 0.35 so the basemap stays readable', () => {
    const fill = specsFor('osm_surveillance_camera_cone').find((s) => s.type === 'fill')!;
    const opacities = numbersAtMostOne(fill.paint['fill-opacity']);
    expect(opacities.length).toBeGreaterThan(0);
    expect(Math.max(...opacities)).toBeLessThanOrEqual(0.35);
  });

  it('emits cone fill before cone outlines (coverage under the edge)', () => {
    const specs = specsFor('osm_surveillance_camera_cone');
    expect(specs[0].type).toBe('fill');
    expect(specs.some((s) => s.id.endsWith('-outline-alpr'))).toBe(true);
    expect(specs.some((s) => s.id.endsWith('-outline-camera'))).toBe(true);
  });

  it('dashes public-CCTV cone edges and keeps ALPR cone edges solid', () => {
    const specs = specsFor('osm_surveillance_camera_cone');
    const alpr = specs.find((s) => s.id.endsWith('-outline-alpr'))!;
    const cctv = specs.find((s) => s.id.endsWith('-outline-camera'))!;
    expect(alpr.paint['line-dasharray']).toBeUndefined();
    expect(cctv.paint['line-dasharray']).toBeTruthy();
  });

  it('does not label the cone polygons', () => {
    expect(specsFor('osm_surveillance_camera_cone').some((s) => s.id.endsWith('-label'))).toBe(false);
  });

  it('never uses the banned gold on surveillance paint', () => {
    const json = JSON.stringify([
      specsFor('osm_surveillance_alpr'),
      specsFor('osm_surveillance_camera'),
      specsFor('osm_surveillance_camera_cone'),
    ]);
    expect(json.toLowerCase()).not.toContain('d4a017');
  });
});
