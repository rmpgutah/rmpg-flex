import { describe, it, expect } from 'vitest';
import { OSM_ICON_BY_CAT, iconIdForCat } from '../osmIcons';
import { OSM_GROUPS } from '../../config/osmLayers.generated';

const POINT_CATS = OSM_GROUPS.flatMap((g) =>
  g.categories.filter((c) => (c as { render?: string }).render === 'point').map((c) => c.cat));

describe('osm icons', () => {
  it('covers every point-rendered category', () => {
    const missing = POINT_CATS.filter((c) => !iconIdForCat(c));
    expect(missing, `categories with no icon (they fall back to a circle): ${missing.join(', ')}`)
      .toEqual([]);
  });

  it('gives every icon a unique id', () => {
    const ids = Object.values(OSM_ICON_BY_CAT).map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('emits valid standalone SVG with a viewBox', () => {
    for (const [cat, spec] of Object.entries(OSM_ICON_BY_CAT)) {
      expect(spec.svg, cat).toMatch(/^<svg[\s\S]*<\/svg>$/);
      expect(spec.svg, `${cat} needs a viewBox`).toContain('viewBox');
      expect(spec.size, `${cat} size`).toBeGreaterThan(0);
    }
  });

  it('distinguishes categories by SHAPE, not colour alone', () => {
    // Colour-only coding fails colour-blind operators and washes out on a dark
    // basemap at night. Strip colour; the geometry must still be unique.
    const byShape = new Map<string, string[]>();
    for (const [cat, spec] of Object.entries(OSM_ICON_BY_CAT)) {
      const shape = spec.svg.replace(/(fill|stroke)="[^"]*"/g, '');
      byShape.set(shape, [...(byShape.get(shape) ?? []), cat]);
    }
    const collisions = [...byShape.values()].filter((v) => v.length > 1);
    expect(collisions, `icons differing only by colour: ${JSON.stringify(collisions)}`).toEqual([]);
  });

  it('never uses the banned #d4a017 gold', () => {
    const all = Object.values(OSM_ICON_BY_CAT).map((s) => s.svg).join(' ').toLowerCase();
    expect(all).not.toContain('d4a017');
  });

  it('reserves red for genuine hazards, not decoration', () => {
    // #ef4444 is --sev-critical. In a CAD system it must mean danger.
    const HAZARD_OK = new Set(['hazard', 'hydrant', 'inlet']);
    for (const [cat, spec] of Object.entries(OSM_ICON_BY_CAT)) {
      if (spec.svg.includes('#ef4444')) {
        expect(HAZARD_OK.has(cat), `${cat} uses the critical red decoratively`).toBe(true);
      }
    }
  });

  it('returns null for an unknown category rather than throwing', () => {
    expect(iconIdForCat('not-a-real-category')).toBeNull();
  });
});
