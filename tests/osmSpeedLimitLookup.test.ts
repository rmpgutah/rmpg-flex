import { describe, it, expect } from 'vitest';
import Pbf from 'pbf';
import { nearestMaxspeedInTile, parseMaxspeedMphServer } from '../src/utils/osm/speedLimitLookup';
import { lngLatToTile } from '../src/utils/osm/tileGeometry';

// ── Minimal MVT writer ───────────────────────────────────────────────────────
// Building a real fixture archive would make this test depend on tippecanoe.
// Instead we hand-encode a single-layer vector tile with the MVT v2 wire format,
// which is small and fully specified. One LineString feature, two properties.
function encodeTile(opts: {
  layer: string;
  extent: number;
  props: Record<string, string>;
  // MVT-local coordinates, 0..extent
  line: [number, number][];
}): Uint8Array {
  const keys = Object.keys(opts.props);
  const values = keys.map((k) => opts.props[k]);

  const pbf = new Pbf();
  pbf.writeMessage(3, (layerObj: typeof opts, p: Pbf) => {
    p.writeVarintField(15, 2);              // version
    p.writeStringField(1, layerObj.layer);  // name
    p.writeVarintField(5, layerObj.extent); // extent

    // feature
    p.writeMessage(2, (_: unknown, fp: Pbf) => {
      fp.writeVarintField(1, 1); // id
      // tags: [keyIdx, valueIdx, ...]
      const tags: number[] = [];
      keys.forEach((_k, i) => { tags.push(i, i); });
      fp.writePackedVarint(2, tags);
      fp.writeVarintField(3, 2); // geometry type: LINESTRING
      // geometry: MoveTo(1) + LineTo(n-1), zigzag deltas
      const geom: number[] = [];
      const zig = (v: number) => (v << 1) ^ (v >> 31);
      geom.push((1 & 0x7) | (1 << 3)); // MoveTo, count 1
      let cx = 0, cy = 0;
      const [first, ...rest] = layerObj.line;
      geom.push(zig(first[0] - cx), zig(first[1] - cy));
      cx = first[0]; cy = first[1];
      geom.push((2 & 0x7) | (rest.length << 3)); // LineTo, count rest
      for (const [x, y] of rest) {
        geom.push(zig(x - cx), zig(y - cy));
        cx = x; cy = y;
      }
      fp.writePackedVarint(4, geom);
    }, layerObj);

    for (const k of keys) p.writeStringField(3, k);
    for (const v of values) {
      p.writeMessage(4, (val: string, vp: Pbf) => { vp.writeStringField(1, val); }, v);
    }
  }, opts);

  return pbf.finish();
}

const Z = 13;
const SLC = { lng: -111.891, lat: 40.7608 };
const { x: TX, y: TY } = lngLatToTile(SLC.lng, SLC.lat, Z);

describe('parseMaxspeedMphServer', () => {
  it('matches the client parser on the shapes that matter', () => {
    expect(parseMaxspeedMphServer('35 mph')).toBe(35);
    expect(parseMaxspeedMphServer('50 km/h')).toBe(31);
    expect(parseMaxspeedMphServer(45)).toBe(45);
    expect(parseMaxspeedMphServer('none')).toBeNull();
    expect(parseMaxspeedMphServer(null)).toBeNull();
    expect(parseMaxspeedMphServer('-20')).toBeNull();
    expect(parseMaxspeedMphServer('-20 km/h')).toBeNull();
    expect(parseMaxspeedMphServer('-5')).toBeNull();
  });
});

describe('nearestMaxspeedInTile', () => {
  it('returns the limit and name of a way passing through the query point', () => {
    const tile = encodeTile({
      layer: 'traffic',
      extent: 4096,
      props: { cat: 'maxspeed', maxspeed: '35 mph', name: 'S Main St' },
      line: [[2000, 2000], [2100, 2000]],
    });
    // Query at the tile-local coordinate the line passes through.
    const hit = nearestMaxspeedInTile(tile, Z, TX, TY, SLC.lng, SLC.lat, 'traffic');
    expect(hit).not.toBeNull();
    expect(hit!.limitMph).toBe(35);
    expect(hit!.roadName).toBe('S Main St');
  });

  it('ignores features whose cat is not maxspeed', () => {
    const tile = encodeTile({
      layer: 'traffic',
      extent: 4096,
      props: { cat: 'restriction', maxspeed: '35 mph', name: 'Not A Limit' },
      line: [[2000, 2000], [2100, 2000]],
    });
    expect(nearestMaxspeedInTile(tile, Z, TX, TY, SLC.lng, SLC.lat, 'traffic')).toBeNull();
  });

  it('ignores maxspeed features whose value does not parse', () => {
    const tile = encodeTile({
      layer: 'traffic',
      extent: 4096,
      props: { cat: 'maxspeed', maxspeed: 'signals', name: 'Signals Rd' },
      line: [[2000, 2000], [2100, 2000]],
    });
    expect(nearestMaxspeedInTile(tile, Z, TX, TY, SLC.lng, SLC.lat, 'traffic')).toBeNull();
  });

  it('returns null when the requested source-layer is absent', () => {
    const tile = encodeTile({
      layer: 'something_else',
      extent: 4096,
      props: { cat: 'maxspeed', maxspeed: '35 mph' },
      line: [[2000, 2000], [2100, 2000]],
    });
    expect(nearestMaxspeedInTile(tile, Z, TX, TY, SLC.lng, SLC.lat, 'traffic')).toBeNull();
  });

  it('returns null on undecodable bytes rather than throwing', () => {
    const junk = new Uint8Array([1, 2, 3, 4, 5]);
    expect(() => nearestMaxspeedInTile(junk, Z, TX, TY, SLC.lng, SLC.lat, 'traffic')).not.toThrow();
    expect(nearestMaxspeedInTile(junk, Z, TX, TY, SLC.lng, SLC.lat, 'traffic')).toBeNull();
  });

  it('reports a distance for a nearby but not coincident way', () => {
    const tile = encodeTile({
      layer: 'traffic',
      extent: 4096,
      props: { cat: 'maxspeed', maxspeed: '25 mph', name: 'Side St' },
      line: [[0, 0], [50, 0]],
    });
    const hit = nearestMaxspeedInTile(tile, Z, TX, TY, SLC.lng, SLC.lat, 'traffic');
    expect(hit).not.toBeNull();
    expect(hit!.distanceM).toBeGreaterThan(0);
  });
});
