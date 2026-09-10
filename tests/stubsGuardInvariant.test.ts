// Companion to test-workers/stubsPublicMountLeak.test.ts.
//
// That test drives real requests, so it can only pin the paths it names. This
// one closes the other half: it reads src/routes/stubs.ts and asserts the
// INVARIANT that every DB-touching route guards on an authenticated user —
// including routes added tomorrow, which no request-level test would know to
// try.
//
// The shared compatibility router must only be mounted behind authenticated
// prefixes. Public diagnostics and update discovery use dedicated narrow
// routers so adding a compatibility handler cannot create a public alias.
//
// Source-level assertions are the established pattern here (see
// scripts/check-column-cap.js and the Static guard checks CI job) precisely for
// invariants a runtime test cannot enumerate.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(__dirname, '..', 'src', 'routes', 'stubs.ts'), 'utf8');
const REGISTRY = readFileSync(join(__dirname, '..', 'src', 'routesConfig.ts'), 'utf8');

/** Reads the DB directly, so its response is real data rather than a constant. */
const TOUCHES_DB = /c\.env\.DB|getDb\(|\bdb\.prepare/;

/**
 * Refuses to act on an absent session. Accepts the shapes actually used in this
 * file — `c.get('userId') == null`, a hoisted `userId == null`, `!user`, or a
 * `requireRole(...)` guard in the route signature.
 */
const GUARDS_ON_USER = new RegExp(
  [
    String.raw`c\.get\(\s*'(?:userId|user)'\s*\)\s*={2,3}\s*(?:null|undefined)`,
    String.raw`\b(?:userId|user)\s*={2,3}\s*(?:null|undefined)`,
    String.raw`!\s*(?:userId|user)\b`,
    String.raw`requireRole`,
  ].join('|'),
);

interface Route { method: string; path: string; key: string; body: string }

function parseRoutes(src: string): Route[] {
  const heads = [...src.matchAll(/^stubs\.(get|post|put|patch|delete|all)\('([^']+)'/gm)];
  return heads.map((m, i) => ({
    method: m[1].toUpperCase(),
    path: m[2],
    key: `${m[1].toUpperCase()} ${m[2]}`,
    body: src.slice(m.index!, i + 1 < heads.length ? heads[i + 1].index! : src.length),
  }));
}

const ROUTES = parseRoutes(SRC);

describe('stubs.ts — authenticated shared compatibility router', () => {
  it('parses its routes (guards the parser itself, so a silent 0 cannot pass)', () => {
    expect(ROUTES.length).toBeGreaterThan(40);
  });

  it('gates every DB-touching route on an authenticated user', () => {
    const dbRoutes = ROUTES.filter((r) => TOUCHES_DB.test(r.body));
    expect(dbRoutes.length).toBeGreaterThan(10); // the parser found real handlers

    const unguarded = dbRoutes
      .filter((r) => !GUARDS_ON_USER.test(r.body))
      .map((r) => r.key);

    // Retain per-handler defense in depth in addition to mount-level auth:
    //   if (c.get('userId') == null) return c.json({ error: 'unauthorized' }, 401);
    expect(unguarded).toEqual([]);
  });

  it('is never mounted at a public prefix', () => {
    expect(REGISTRY).not.toMatch(/router:\s*stubs,\s*auth:\s*'public'/);
  });

  it('has not lost the guards the leak tests depend on', () => {
    // Cross-check against the request-level suite: these four were the actual
    // disclosure (live call/unit/warrant posture) and each must keep its guard.
    for (const key of ['GET /', 'GET /dashboard', 'GET /messages', 'GET /messages/priority-stats']) {
      const route = ROUTES.find((r) => r.key === key);
      expect(route, `${key} disappeared from stubs.ts — update these tests deliberately`).toBeDefined();
      expect(GUARDS_ON_USER.test(route!.body), `${key} lost its authenticated-user guard`).toBe(true);
    }
  });
});
