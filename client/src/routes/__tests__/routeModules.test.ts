import { describe, it, expect } from 'vitest';
import { ROUTE_MODULES, getRouteImporter } from '../routeModules';
import { NAV_CATEGORIES } from '../../data/navCatalog';

describe('routeModules', () => {
  it('maps every path to a function', () => {
    for (const [path, importer] of Object.entries(ROUTE_MODULES)) {
      expect(typeof importer, `${path} importer`).toBe('function');
    }
  });

  it('resolves an exact path', () => {
    expect(getRouteImporter('/dispatch')).toBeTypeOf('function');
  });

  it('resolves a nested path via its longest registered prefix', () => {
    // /fleet/dashboard has no own entry but must resolve through /fleet.
    expect(getRouteImporter('/fleet/dashboard')).toBeTypeOf('function');
  });

  it('returns null for an unregistered path', () => {
    expect(getRouteImporter('/definitely-not-a-route')).toBeNull();
  });

  it('never returns the root importer for an unrelated path', () => {
    // '/' is a registered prefix of everything — the prefix match must not
    // degenerate into "always matches root".
    expect(getRouteImporter('/definitely-not-a-route')).toBeNull();
  });

  it('covers the nav catalog entries that are in-app routes', () => {
    const navPaths = NAV_CATEGORIES.flatMap((c) =>
      c.functions.filter((f) => !f.electronOnly && f.path.startsWith('/')).map((f) => f.path),
    );
    const missing = navPaths.filter((p) => getRouteImporter(p) === null);
    expect(missing, `nav paths with no importer: ${missing.join(', ')}`).toEqual([]);
  });
});
