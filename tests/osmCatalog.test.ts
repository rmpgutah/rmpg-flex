import { describe, it, expect } from 'vitest';
// @ts-expect-error - untyped .mjs module
import { loadCatalog, groupNames, archiveMinZoom, osmiumFilterArgs } from '../scripts/osm/catalog.mjs';

const EXPECTED_GROUPS = [
  'surveillance', 'traffic', 'safety', 'utility',
  'sites', 'access', 'drivability', 'terrain', 'jurisdiction',
];

describe('osm layer catalog', () => {
  it('declares exactly the nine spec groups', () => {
    expect(groupNames().sort()).toEqual([...EXPECTED_GROUPS].sort());
  });

  it('gives every group an archive named osm-<group>.pmtiles', () => {
    for (const g of loadCatalog().groups) {
      expect(g.archive, `${g.name} archive name`).toBe(`osm-${g.name}.pmtiles`);
    }
  });

  it('gives every category a unique cat within its group', () => {
    for (const g of loadCatalog().groups) {
      const cats = g.categories.map((c: { cat: string }) => c.cat);
      expect(new Set(cats).size, `${g.name} has duplicate cat values`).toBe(cats.length);
    }
  });

  it('gives every category at least one osmium filter and one match rule', () => {
    for (const g of loadCatalog().groups) {
      for (const c of g.categories) {
        expect(c.filters.length, `${g.name}/${c.cat} has no filters`).toBeGreaterThan(0);
        expect(c.match.length, `${g.name}/${c.cat} has no match rules`).toBeGreaterThan(0);
      }
    }
  });

  it('uses valid osmium tags-filter syntax on every filter', () => {
    for (const g of loadCatalog().groups) {
      for (const c of g.categories) {
        for (const f of c.filters) {
          // osmium tags-filter object-type prefixes: any combination of n(ode)/w(ay)/
          // r(elation). `wr/` is used deliberately by the polygon-only jurisdiction
          // group — do not broaden those to `nwr/`, it would admit point features into
          // a polygon archive.
          expect(f, `${g.name}/${c.cat}: "${f}"`).toMatch(/^(n|w|r|nw|nr|wr|nwr)\/[a-zA-Z0-9_:]+(=[^\s]+)?$/);
        }
      }
    }
  });

  it('sets archive minzoom to the LOWEST category minzoom in the group', () => {
    for (const g of loadCatalog().groups) {
      const lowest = Math.min(...g.categories.map((c: { minzoom: number }) => c.minzoom));
      expect(archiveMinZoom(g.name), `${g.name}`).toBe(lowest);
    }
  });

  it('keeps every category minzoom in the mapbox-valid range', () => {
    for (const g of loadCatalog().groups) {
      for (const c of g.categories) {
        expect(c.minzoom).toBeGreaterThanOrEqual(0);
        expect(c.minzoom).toBeLessThanOrEqual(22);
      }
    }
  });

  it('always captures cat-independent identity properties', () => {
    for (const g of loadCatalog().groups) {
      expect(g.properties, `${g.name} must capture name`).toContain('name');
    }
  });

  it('emits one osmium filter arg list per group covering every category', () => {
    for (const g of loadCatalog().groups) {
      const args = osmiumFilterArgs(g.name);
      for (const c of g.categories) {
        for (const f of c.filters) expect(args).toContain(f);
      }
    }
  });

  it('constrains every group name to a safe charset (flows into R2 keys/paths)', () => {
    for (const g of loadCatalog().groups) {
      expect(g.name, `${g.name}`).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });

  it('gives every group a valid assignment mode ("first-match" or "multi")', () => {
    for (const g of loadCatalog().groups) {
      expect(['first-match', 'multi'], `${g.name}`).toContain(g.assignment);
    }
  });

  it('keeps surveillance as first-match (ALPR must never double-count into camera)', () => {
    const surveillance = loadCatalog().groups.find((g: { name: string }) => g.name === 'surveillance');
    expect(surveillance.assignment).toBe('first-match');
  });

  it('does not declare landuse=quarry in more than one group', () => {
    const owners: string[] = [];
    for (const g of loadCatalog().groups) {
      for (const c of g.categories) {
        if (c.filters.some((f: string) => f.includes('landuse=quarry'))) owners.push(`${g.name}/${c.cat}`);
      }
    }
    expect(owners, 'quarry must belong to exactly one group').toHaveLength(1);
  });
});
