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
    expect(cone.tippecanoe).toBeDefined();
    expect(cone.properties.tippecanoe).toBeUndefined();
  });
});
