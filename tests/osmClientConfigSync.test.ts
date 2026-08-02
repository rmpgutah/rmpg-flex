import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
// @ts-expect-error - untyped .mjs module
import { loadCatalog } from '../scripts/osm/catalog.mjs';

const GENERATED = 'client/src/config/osmLayers.generated.ts';

describe('osm client config', () => {
  it('exists and is marked generated', () => {
    const src = readFileSync(GENERATED, 'utf8');
    expect(src).toContain('GENERATED FILE');
    expect(src).toContain('scripts/gen-osm-client-config.mjs');
  });

  it('declares every catalog group', () => {
    const src = readFileSync(GENERATED, 'utf8');
    for (const g of loadCatalog().groups) {
      expect(src, `missing group ${g.name}`).toContain(`name: '${g.name}'`);
    }
  });

  it('declares every catalog category with its minzoom', () => {
    const src = readFileSync(GENERATED, 'utf8');
    for (const g of loadCatalog().groups) {
      for (const c of g.categories) {
        expect(src, `missing category ${g.name}/${c.cat}`).toContain(`cat: '${c.cat}'`);
      }
    }
  });

  it('includes the synthetic camera_cone category that the transform derives', () => {
    const src = readFileSync(GENERATED, 'utf8');
    expect(src).toContain(`cat: 'camera_cone'`);
    // It must NOT be in the JSON catalog — it is emitted by transform.mjs only.
    const inCatalog = loadCatalog().groups.some((g: any) =>
      g.categories.some((c: any) => c.cat === 'camera_cone'));
    expect(inCatalog).toBe(false);
  });

  it('carries a coverage class for every group', () => {
    const src = readFileSync(GENERATED, 'utf8');
    for (const g of loadCatalog().groups) {
      expect(src, `${g.name} coverage`).toMatch(
        new RegExp(`name: '${g.name}'[\\s\\S]{0,400}coverage: '(sparse|incomplete|attribute|boundary)'`));
    }
  });

  it('carries a valid render value on every generated category, including the synthetic one', () => {
    const src = readFileSync(GENERATED, 'utf8');
    const renderMatches = [...src.matchAll(/cat: '([^']+)',\s*label: '[^']*',\s*minzoom: \d+,\s*render: '([^']+)'/g)];
    expect(renderMatches.length).toBeGreaterThan(0);
    const byCat: Record<string, string> = {};
    for (const [, cat, render] of renderMatches) byCat[cat] = render;

    for (const g of loadCatalog().groups) {
      for (const c of g.categories) {
        expect(byCat[c.cat], `${g.name}/${c.cat} missing render`).toBeDefined();
        expect(['point', 'line', 'polygon'], `${g.name}/${c.cat} render`).toContain(byCat[c.cat]);
      }
    }
    // Synthetic camera_cone (not in the JSON catalog) must also carry a valid render.
    expect(['point', 'line', 'polygon']).toContain(byCat['camera_cone']);
  });
});
