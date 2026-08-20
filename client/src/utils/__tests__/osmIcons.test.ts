import { describe, it, expect } from 'vitest';
import {
  OSM_ICON_BY_CAT, OSM_ICON_SPECS, iconIdForCat, iconSvgForCat,
  iconImageExpression, symbolSortKeyFor, baseId, lowZoomId, mutedId,
} from '../osmIcons';
import { GLYPHS, MUTABLE_CATS, NFPA_BONNET } from '../osmIconArt';
import { OSM_GROUPS } from '../../config/osmLayers.generated';

const POINT_CATS = OSM_GROUPS.flatMap((g) =>
  g.categories.filter((c) => (c as { render?: string }).render === 'point').map((c) => c.cat));

/** Every sprite id reachable as an icon-image from an expression. */
function spriteIdsIn(expr: unknown, out: string[] = []): string[] {
  if (typeof expr === 'string') {
    if (expr.startsWith('osm-')) out.push(expr);
    return out;
  }
  if (Array.isArray(expr)) for (const v of expr) spriteIdsIn(v, out);
  return out;
}

describe('osm icons — coverage', () => {
  it('covers every point-rendered category', () => {
    const missing = POINT_CATS.filter((c) => !iconIdForCat(c));
    expect(missing, `categories with no icon (they fall back to a circle): ${missing.join(', ')}`)
      .toEqual([]);
  });

  it('draws no glyph for a category that does not exist', () => {
    const orphans = Object.keys(GLYPHS).filter((c) => !POINT_CATS.includes(c));
    expect(orphans, `glyphs with no point category to render them: ${orphans.join(', ')}`).toEqual([]);
  });

  it('gives every sprite a unique id', () => {
    const ids = Object.values(OSM_ICON_SPECS).map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('returns null for an unknown category rather than throwing', () => {
    expect(iconIdForCat('not-a-real-category')).toBeNull();
    expect(iconSvgForCat('not-a-real-category')).toBeNull();
    expect(iconImageExpression('not-a-real-category', 12)).toBeNull();
  });
});

describe('osm icons — artwork', () => {
  it('emits valid standalone SVG with a viewBox', () => {
    for (const [id, spec] of Object.entries(OSM_ICON_SPECS)) {
      expect(spec.svg, id).toMatch(/^<svg[\s\S]*<\/svg>$/);
      expect(spec.svg, `${id} needs a viewBox`).toContain('viewBox');
      expect(spec.size, `${id} size`).toBeGreaterThan(0);
    }
  });

  it('balances every SVG tag', () => {
    // A malformed SVG does not throw — it decodes to a transparent bitmap and
    // the symbol layer silently renders nothing, which is the hardest failure
    // in this subsystem to notice.
    for (const [id, spec] of Object.entries(OSM_ICON_SPECS)) {
      const open = (spec.svg.match(/<(?!\/)[a-zA-Z]/g) ?? []).length;
      const close = (spec.svg.match(/<\/[a-zA-Z]/g) ?? []).length
        + (spec.svg.match(/\/>/g) ?? []).length;
      expect(close, `${id} has unbalanced tags`).toBe(open);
    }
  });

  it('distinguishes categories by SHAPE, not colour alone', () => {
    // The set is single-ink line art precisely so this holds: with one colour
    // for every glyph, silhouette is the only channel left. Strip colour; the
    // remaining geometry must still be unique.
    const byShape = new Map<string, string[]>();
    for (const [cat, spec] of Object.entries(OSM_ICON_BY_CAT)) {
      const shape = spec.svg.replace(/(fill|stroke)="[^"]*"/g, '');
      byShape.set(shape, [...(byShape.get(shape) ?? []), cat]);
    }
    const collisions = [...byShape.values()].filter((v) => v.length > 1);
    expect(collisions, `icons differing only by colour: ${JSON.stringify(collisions)}`).toEqual([]);
  });

  it('never uses the banned #d4a017 gold', () => {
    const all = Object.values(OSM_ICON_SPECS).map((s) => s.svg).join(' ').toLowerCase();
    expect(all).not.toContain('d4a017');
  });

  it('keeps colour out of glyph bodies except on the semantic allowlist', () => {
    // The plate rim is group-tinted and may carry any group hue. The GLYPH is
    // single-ink, so a coloured fill inside one is a claim that the colour
    // means something. Only these categories may make that claim, and each is
    // a real-world colour a responder already reads: NFPA hydrant bonnets,
    // signal lenses, the STOP/yield red, crossbuck flashers, the lamp's warm
    // cast, the EV green, hazard amber.
    const ALLOWED = new Set(['hydrant', 'control', 'rail_x', 'lamp', 'charging', 'hazard']);
    for (const [cat, art] of Object.entries(GLYPHS)) {
      if (ALLOWED.has(cat)) continue;
      const body = `${art.main}${art.det ?? ''}${art.over ?? ''}`;
      expect(body, `${cat} puts colour in its glyph without being on the allowlist`)
        .not.toMatch(/#[0-9a-f]{3,8}/i);
    }
  });

  it('reserves the critical red for genuine hazards', () => {
    // #ef4444 is --sev-critical. In a CAD system it must mean danger, so it is
    // confined to the fire/life-safety plate rim and to glyphs about danger.
    const HAZARD_OK = new Set(['hydrant', 'rail_x', 'control']);
    for (const [cat, art] of Object.entries(GLYPHS)) {
      const body = `${art.main}${art.det ?? ''}${art.over ?? ''}`;
      if (body.includes('#ef4444')) {
        expect(HAZARD_OK.has(cat), `${cat} uses the critical red decoratively`).toBe(true);
      }
    }
  });
});

describe('osm icons — dynamic selection', () => {
  it('only ever resolves to a sprite that is actually registered', () => {
    // A bare icon-image name the sprite does not have renders NOTHING, with no
    // error and no console line. Every branch of every expression has to land
    // on a registered id or a whole category silently disappears.
    for (const cat of POINT_CATS) {
      const ids = spriteIdsIn(iconImageExpression(cat, 14));
      expect(ids.length, `${cat} produced no sprite id`).toBeGreaterThan(0);
      for (const id of ids) {
        expect(OSM_ICON_SPECS[id], `${cat} can resolve to unregistered sprite "${id}"`).toBeDefined();
      }
    }
  });

  it('registers a low-zoom sprite for every category', () => {
    for (const cat of POINT_CATS) {
      expect(OSM_ICON_SPECS[lowZoomId(cat)], `${cat} has no low-zoom sprite`).toBeDefined();
    }
  });

  it('steps from the simple sprite to the detailed one above the minzoom', () => {
    const expr = iconImageExpression('school', 12) as unknown[];
    expect(expr[0]).toBe('step');
    expect(expr[2]).toBe(lowZoomId('school'));
    expect(expr[3]).toBe(14.5);
    expect(expr[4]).toBe(baseId('school'));
  });

  it('offers an NFPA bonnet sprite for each flow class', () => {
    const ids = spriteIdsIn(iconImageExpression('hydrant', 14));
    for (const cls of Object.keys(NFPA_BONNET)) {
      expect(ids, `hydrant is missing the ${cls} NFPA class`).toContain(`osm-hydrant-${cls}`);
    }
    // An untagged hydrant must fall through to the uncoloured sprite: a missing
    // flow class has to read as unknown, never as a fabricated class.
    expect(ids).toContain(baseId('hydrant'));
  });

  it('splits traffic control into signal, stop and yield', () => {
    const ids = spriteIdsIn(iconImageExpression('control', 14));
    expect(ids).toContain('osm-control-stop');
    expect(ids).toContain('osm-control-yield');
    expect(ids).toContain(baseId('control'));
  });

  it('mutes only the categories where being out of service changes the response', () => {
    for (const cat of MUTABLE_CATS) {
      expect(OSM_ICON_SPECS[mutedId(cat)], `${cat} has no muted sprite`).toBeDefined();
      expect(spriteIdsIn(iconImageExpression(cat, 14))).toContain(mutedId(cat));
    }
    // Terrain is absent by design — a disused cave entrance is not an
    // operational fact the way a locked gate is.
    expect(MUTABLE_CATS).not.toContain('cave');
    expect(spriteIdsIn(iconImageExpression('cave', 14))).not.toContain(mutedId('cave'));
  });
});

describe('osm icons — placement priority', () => {
  it('places life safety ahead of street furniture', () => {
    // Lower sorts first, and first-placed wins the collision.
    for (const safety of ['hydrant', 'inlet', 'emerg', 'station']) {
      for (const furniture of ['lamp', 'pole', 'entrance', 'parking']) {
        expect(
          symbolSortKeyFor(safety),
          `${furniture} can beat ${safety} for the same pixels`,
        ).toBeLessThan(symbolSortKeyFor(furniture));
      }
    }
  });

  it('ranks immediate hazards with life safety, not with their own group', () => {
    expect(symbolSortKeyFor('hazard')).toBeLessThan(symbolSortKeyFor('cave'));
    expect(symbolSortKeyFor('rail_x')).toBeLessThan(symbolSortKeyFor('rail_infra'));
  });

  it('gives every point category a priority', () => {
    for (const cat of POINT_CATS) {
      expect(symbolSortKeyFor(cat), `${cat} fell through to the default`).toBeLessThan(99);
    }
  });
});
