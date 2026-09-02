import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const TRANSFORM = join(ROOT, 'scripts', 'osm', 'transform.mjs');

function runTransform(group: string, lines: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      process.execPath,
      [TRANSFORM, '--group', group],
      { cwd: ROOT },
      (err, stdout, stderr) => {
        // transform.mjs exits 0 on success; a non-zero exit with no error
        // content would still be a real failure worth surfacing.
        if (err && !stdout && !stderr) return reject(err);
        resolve({ stdout, stderr });
      },
    );
    child.stdin!.write(lines.join('\n') + '\n');
    child.stdin!.end();
  });
}

function parseFeatures(stdout: string) {
  return stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

const hydrant = JSON.stringify({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [-111.89, 40.76] },
  properties: { emergency: 'fire_hydrant', created_by: 'JOSM' },
});

const noMatch = JSON.stringify({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [-111.89, 40.76] },
  properties: { amenity: 'cafe' },
});

const alprCamera = JSON.stringify({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [-111.89, 40.76] },
  properties: {
    man_made: 'surveillance',
    'surveillance:type': 'ALPR',
    'camera:direction': '90',
  },
});

const genericCamera = JSON.stringify({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [-111.89, 40.76] },
  properties: {
    man_made: 'surveillance',
    'camera:direction': '90',
  },
});

const maxspeedAndOneway = JSON.stringify({
  type: 'Feature',
  geometry: { type: 'LineString', coordinates: [[-111.89, 40.76], [-111.88, 40.77]] },
  properties: { highway: 'residential', maxspeed: '25 mph', oneway: 'yes' },
});

describe('transform.mjs (spawned child process)', () => {
  it('stamps tippecanoe.minzoom at the TOP level of the feature, not inside properties', async () => {
    const { stdout } = await runTransform('safety', [hydrant]);
    const features = parseFeatures(stdout);
    expect(features).toHaveLength(1);
    const [f] = features;
    expect(f.tippecanoe).toEqual({ minzoom: 14 });
    expect(f.properties.cat).toBe('hydrant');
    expect(f.properties.tippecanoe).toBeUndefined();
  });

  it('drops an unlisted tag such as created_by', async () => {
    const { stdout } = await runTransform('safety', [hydrant]);
    const [f] = parseFeatures(stdout);
    expect(f.properties.created_by).toBeUndefined();
  });

  it('drops a feature matching no category', async () => {
    const { stdout } = await runTransform('safety', [noMatch]);
    expect(parseFeatures(stdout)).toHaveLength(0);
  });

  it('emits an ALPR point plus a camera_cone polygon carrying parent_cat=alpr', async () => {
    const { stdout } = await runTransform('surveillance', [alprCamera]);
    const features = parseFeatures(stdout);
    expect(features).toHaveLength(2);

    const [alpr, cone] = features;
    expect(alpr.properties.cat).toBe('alpr');
    expect(alpr.geometry.type).toBe('Point');

    expect(cone.properties.cat).toBe('camera_cone');
    expect(cone.properties.parent_cat).toBe('alpr');
    expect(cone.geometry.type).toBe('Polygon');
    expect(alpr.properties['camera:bearing']).toBe('90');
    expect(cone.tippecanoe).toBeDefined();
    expect(cone.properties.tippecanoe).toBeUndefined();
  });

  it('bug 2: stamps a camera_cone with its PARENT category minzoom, not the group minimum', async () => {
    // alpr minzoom=14 (== group min, so this alone wouldn't catch the bug).
    const { stdout: alprOut } = await runTransform('surveillance', [alprCamera]);
    const [, alprCone] = parseFeatures(alprOut);
    expect(alprCone.tippecanoe.minzoom).toBe(14);

    // camera minzoom=15 — must NOT be pulled down to the group min of 14.
    const { stdout: camOut } = await runTransform('surveillance', [genericCamera]);
    const [cam, camCone] = parseFeatures(camOut);
    expect(cam.properties.cat).toBe('camera');
    expect(camCone.properties.parent_cat).toBe('camera');
    expect(camCone.tippecanoe.minzoom).toBe(15);
  });

  it('bug 1: a way tagged with BOTH maxspeed and oneway=yes emits TWO features under a `multi` group, each with its own category minzoom', async () => {
    const { stdout } = await runTransform('traffic', [maxspeedAndOneway]);
    const features = parseFeatures(stdout);
    expect(features).toHaveLength(2);

    const byCat = Object.fromEntries(features.map((f: any) => [f.properties.cat, f]));
    expect(Object.keys(byCat).sort()).toEqual(['maxspeed', 'restriction']);
    expect(byCat.maxspeed.tippecanoe.minzoom).toBe(13);
    expect(byCat.restriction.tippecanoe.minzoom).toBe(14);
  });
});
