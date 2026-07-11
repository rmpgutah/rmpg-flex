# Mapbox Integration Gap Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the broken Search Box hook, verify the traffic congestion layer actually renders, and add a gated jurisdiction/county lookup via Mapbox's Boundaries API — the three real gaps identified in [`docs/superpowers/specs/2026-07-02-mapbox-integration-gaps-design.md`](../specs/2026-07-02-mapbox-integration-gaps-design.md).

**Architecture:** Everything routes through the existing `src/routes/mapbox.ts` server proxy (token stays server-side) and mirrors the existing hook/service-function pattern in `client/src/hooks/useMapbox*.ts` + `client/src/utils/mapboxServices.ts`. The new Boundaries route uses the shared `notConfigured()` 200-skip helper for entitlement gaps, while token-missing keeps the file's existing 503 local helper for consistency with sibling routes.

**Tech Stack:** Hono (Worker), Mapbox REST APIs (Geocoding v5, Boundaries v4), React hooks, Vitest + Miniflare (`test-workers/`) for route smoke tests.

---

### Task 1: Server — forward `proximity`/`country` on the geocode route

**Files:**
- Modify: `src/routes/mapbox.ts:71-84`

- [ ] **Step 1: Add the two passthrough params**

Replace the `/geocode` handler body:

```ts
mapbox.get('/geocode', async (c) => {
  const tk = token(c);
  if (!tk) return notConfigured(c);
  const q = (c.req.query('q') || '').trim();
  if (!q) return c.json({ error: 'q is required' }, 400);
  const limit = c.req.query('limit') || '5';
  const types = c.req.query('types');
  const proximity = c.req.query('proximity');
  const country = c.req.query('country');
  const params = new URLSearchParams({ access_token: tk, limit, autocomplete: 'true', country: country || 'us' });
  if (types) params.set('types', types);
  if (proximity) params.set('proximity', proximity);
  try {
    const data = await mbFetch(`${MB}/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?${params}`);
    return c.json({ features: data?.features ?? [] });
  } catch (err) { return fail(c, err, 'geocode'); }
});
```

Note: `country` already defaulted to `'us'` before — this just lets a caller override it. `proximity` is new: Mapbox Geocoding v5 accepts `lng,lat` biasing.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/routes/mapbox.ts
git commit -m "fix(mapbox): forward proximity/country params on geocode route"
```

---

### Task 2: Client — fix the Search Box hook's broken endpoint

**Files:**
- Modify: `client/src/hooks/useMapboxSearchBox.ts:84-97`

- [ ] **Step 1: Point at the real route and pass the new params**

Replace lines 84-97:

```ts
      // Route through server-side proxy to protect access token
      const params = new URLSearchParams({
        q: query.trim(),
        country,
        limit: String(limit),
        proximity: proximity.join(','),
      });
      if (options?.types?.length) params.set('types', options.types.join(','));

      // Use apiFetch for authenticated server-side geocoding
      const { apiFetch } = await import('../hooks/useApi');
      const data = await apiFetch<{ features: Array<{ place_name: string; text: string; center: [number, number]; place_type: string[]; relevance: number }> }>(
        `/mapbox/geocode?${params}`
      );

      if (abort.signal.aborted) return [];

      const mapped: SearchBoxResult[] = (data.features || []).map((f, idx) => ({
        id: `result-${idx}`,
        name: f.text || f.place_name || '',
        full_address: f.place_name || '',
        place_type: (f.place_type || [])[0] || '',
        latitude: f.center?.[1] ?? 0,
        longitude: f.center?.[0] ?? 0,
        properties: f as unknown as Record<string, unknown>,
      }));
```

This was previously calling a nonexistent `/mapbox/geocode/forward` route (real route is `/mapbox/geocode`, confirmed in `src/routes/mapbox.ts:71`) and mapping a response shape (`results: [...]` with flat `latitude`/`longitude`) that the server never returns — the actual server response is `{ features: GeocodeFeature[] }` matching Mapbox's native Geocoding v5 shape (`place_name`, `center: [lng, lat]`, `place_type: string[]`). Both the URL and the shape were wrong.

- [ ] **Step 2: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Manual verification**

Run: use the dev server (see Task 9) and call `useMapboxSearchBox().search('salt lake city')` from a scratch component or the browser console via React DevTools; confirm `results` populates with real addresses instead of staying empty.

- [ ] **Step 4: Commit**

```bash
git add client/src/hooks/useMapboxSearchBox.ts
git commit -m "fix(mapbox): point useMapboxSearchBox at the real /geocode endpoint"
```

---

### Task 3: Boundaries — server route

**Files:**
- Modify: `src/routes/mapbox.ts` (add new route)
- Create: `test-workers/mapboxBoundaries.test.ts`

Mapbox's Boundaries API (`https://api.mapbox.com/boundaries/v4/{tileset}/tilequery/{lng},{lat}.json`) resolves administrative boundaries for a point given a boundary tileset ID (e.g. `admin-1` for counties/states via the `country_boundaries_admin_1` line, or place/county-level `boundaries-county-v1` style IDs depending on account provisioning). Because access is unconfirmed, the route must distinguish "token missing" (existing 503 pattern, same as every other route in this file) from "token present but Boundaries entitlement missing" (new 200-skip pattern via the shared helper) so the client can tell the two apart.

- [ ] **Step 1: Import the shared helper and add the route**

Add near the top of `src/routes/mapbox.ts`, alongside the existing imports:

```ts
import { notConfigured as notConfiguredSkip } from '../utils/notConfigured';
```

Add after the `/tilequery` route (find it via `grep -n "'/tilequery'" src/routes/mapbox.ts` and insert after that handler's closing `});`):

```ts
// ── Boundaries ─────────────────────────────────────────────
// GET /api/mapbox/boundaries?lng=&lat=  → { county, municipality, place, source }
// Resolves administrative jurisdiction for a point via the Mapbox Boundaries
// API. This is a paid Mapbox add-on — access is not guaranteed on every
// token. A 403/404 upstream is NOT a token-missing case (that's handled by
// the shared `token()`/`notConfigured()` pair above); it means the account
// lacks the Boundaries entitlement, so we return the 200 skip shape instead
// of a hard error — the client shows an "unavailable" badge, not a crash.
mapbox.get('/boundaries', async (c) => {
  const tk = token(c);
  if (!tk) return notConfigured(c);
  const lng = c.req.query('lng'); const lat = c.req.query('lat');
  if (lng == null || lat == null) return c.json({ error: 'lng and lat are required' }, 400);
  const params = new URLSearchParams({ access_token: tk });
  // Tileset ID 'adm2' is a best-guess (Mapbox's admin-2 = county-equivalent
  // level in the US). Confirm the exact tileset ID this account is
  // provisioned for in Task 10 Step 5 against the live token — adjust this
  // literal if the real ID differs (Mapbox docs: Boundaries v4 tilesets).
  try {
    const data = await mbFetch(`${MB}/boundaries/v4/adm2/tilequery/${encodeURIComponent(lng)},${encodeURIComponent(lat)}.json?${params}`);
    const feature = (data?.features ?? [])[0];
    if (!feature) {
      return c.json({ county: null, municipality: null, place: null, source: 'mapbox-boundaries' });
    }
    return c.json({
      county: feature.properties?.name ?? null,
      municipality: null,
      place: null,
      source: 'mapbox-boundaries',
    });
  } catch (err: any) {
    if (err?.status === 401 || err?.status === 403 || err?.status === 404) {
      return notConfiguredSkip(c, 'Mapbox Boundaries API not enabled on this account token');
    }
    return fail(c, err, 'boundaries');
  }
});
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no new errors.

- [ ] **Step 3: Write the Miniflare smoke test**

```ts
// Route-level smoke test (Miniflare/workerd) for GET /api/mapbox/boundaries.
// Verifies the not-configured paths respond correctly without a live
// Mapbox token — this environment never has MAPBOX_ACCESS_TOKEN set.
import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import mapbox from '../src/routes/mapbox';

const app = new Hono<{ Bindings: Record<string, unknown> }>();
app.route('/api/mapbox', mapbox);

describe('GET /api/mapbox/boundaries', () => {
  it('returns 503 with MAPBOX_TOKEN_UNSET when no token is configured', async () => {
    const res = await app.request('/api/mapbox/boundaries?lng=-111.89&lat=40.76', {}, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(503);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('MAPBOX_TOKEN_UNSET');
  });

  it('returns 400 when lng/lat are missing', async () => {
    const withToken = { ...(env as Record<string, unknown>), MAPBOX_ACCESS_TOKEN: 'pk.test-token' };
    const res = await app.request('/api/mapbox/boundaries', {}, withToken);
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run --config vitest.workers.config.mts test-workers/mapboxBoundaries.test.ts`
Expected: 2 passed. (The "entitlement missing" 200-skip path needs a live token to exercise for real — covered by manual verification in Task 8, not unit-tested here since it depends on an external account tier.)

- [ ] **Step 5: Commit**

```bash
git add src/routes/mapbox.ts test-workers/mapboxBoundaries.test.ts
git commit -m "feat(mapbox): add gated /boundaries route for jurisdiction lookup"
```

---

### Task 4: Boundaries — client service function

**Files:**
- Modify: `client/src/utils/mapboxServices.ts`

- [ ] **Step 1: Add the service function**

Add after the `tileQuery` function (after line 183):

```ts
// ─── Boundaries (jurisdiction lookup) ─────────────────────

export interface BoundariesResult {
  county: string | null;
  municipality: string | null;
  place: string | null;
  source?: string;
  ok?: boolean;
  skipped?: boolean;
  code?: string;
  reason?: string;
}

export async function lookupJurisdiction(lng: number, lat: number) {
  return apiFetch<BoundariesResult>(
    `/mapbox/boundaries?lng=${lng}&lat=${lat}`
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/utils/mapboxServices.ts
git commit -m "feat(mapbox): add lookupJurisdiction client service function"
```

---

### Task 5: Boundaries — `useMapboxBoundaries` hook

**Files:**
- Create: `client/src/hooks/useMapboxBoundaries.ts`

- [ ] **Step 1: Write the hook**

Mirrors the shape of `useMapboxTilequery.ts` (loading/result/query-function), plus an `available` flag driven by the `not_configured` skip response so consumers can render an honest "unavailable" state instead of guessing from an empty result.

```ts
// Jurisdiction Lookup — Mapbox Boundaries API for county/municipality
// resolution. Used on Cases/Warrants/Properties for cross-jurisdiction
// handoffs. Distinct from the beat/zone/sector dispatch system, which is
// resolved entirely by RMPG's own geofence polygons (see
// src/utils/districtResolver.ts) — this hook never touches that data.
import { useCallback, useState } from 'react';
import { lookupJurisdiction, type BoundariesResult } from '../utils/mapboxServices';

export interface JurisdictionInfo {
  county: string | null;
  municipality: string | null;
  place: string | null;
}

export function useMapboxBoundaries() {
  const [result, setResult] = useState<JurisdictionInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [available, setAvailable] = useState(true);

  const lookup = useCallback(async (lng: number, lat: number) => {
    setLoading(true);
    try {
      const data: BoundariesResult = await lookupJurisdiction(lng, lat);
      if (data.skipped) {
        setAvailable(false);
        setResult(null);
        return null;
      }
      const info: JurisdictionInfo = {
        county: data.county,
        municipality: data.municipality,
        place: data.place,
      };
      setAvailable(true);
      setResult(info);
      return info;
    } catch (err) {
      console.warn('[useMapboxBoundaries] lookup failed:', err);
      setResult(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return { result, loading, available, lookup };
}
```

- [ ] **Step 2: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/hooks/useMapboxBoundaries.ts
git commit -m "feat(mapbox): add useMapboxBoundaries hook"
```

---

### Task 6: Reusable `JurisdictionLookup` component

**Files:**
- Create: `client/src/components/JurisdictionLookup.tsx`

- [ ] **Step 1: Write the component**

Takes an address string, geocodes it (reusing `forwardGeocode` from `mapboxServices.ts`), then resolves jurisdiction via `useMapboxBoundaries`. Renders nothing if there's no address; shows a compact result or an "unavailable" note.

```tsx
// Jurisdiction lookup — resolves county/municipality for an address via
// Mapbox Geocoding + Boundaries. Used on Warrants/Properties detail panels
// for cross-jurisdiction handoffs. Not related to beat/zone/sector.
import { useState, useCallback } from 'react';
import { MapPin, Loader2 } from 'lucide-react';
import { forwardGeocode } from '../utils/mapboxServices';
import { useMapboxBoundaries } from '../hooks/useMapboxBoundaries';

export default function JurisdictionLookup({ address }: { address: string }) {
  const [error, setError] = useState<string | null>(null);
  const { result, loading, available, lookup } = useMapboxBoundaries();

  const run = useCallback(async () => {
    setError(null);
    try {
      const features = await forwardGeocode(address, 1);
      const first = features[0];
      if (!first) {
        setError('Could not geocode this address');
        return;
      }
      const [lng, lat] = first.center;
      await lookup(lng, lat);
    } catch {
      setError('Lookup failed');
    }
  }, [address, lookup]);

  if (!address?.trim()) return null;

  return (
    <div className="flex items-center gap-2 text-[10px]">
      <button
        type="button"
        onClick={run}
        disabled={loading}
        className="toolbar-btn text-[9px]"
      >
        {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <MapPin className="w-3 h-3" />}
        Jurisdiction
      </button>
      {!available && <span className="text-rmpg-500">unavailable</span>}
      {error && <span className="text-red-400">{error}</span>}
      {result && (
        <span className="text-rmpg-300">
          {[result.county, result.municipality].filter(Boolean).join(', ') || 'No jurisdiction found'}
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/JurisdictionLookup.tsx
git commit -m "feat(mapbox): add reusable JurisdictionLookup component"
```

---

### Task 7: Wire into WarrantsPage

**Files:**
- Modify: `client/src/pages/WarrantsPage.tsx:2573-2580`

- [ ] **Step 1: Add the import**

Near the top of the file with the other component imports:

```ts
import JurisdictionLookup from '../components/JurisdictionLookup';
```

- [ ] **Step 2: Render it next to the subject address**

Replace lines 2573-2580 (the `subject_address` block):

```tsx
                      {selectedWarrant.subject_address && (
                        <div className="col-span-2">
                          <span className="text-rmpg-500 text-[9px]">Address</span>
                          <div className="text-rmpg-300">{selectedWarrant.subject_address}</div>
                          <div className="mt-1">
                            <JurisdictionLookup address={selectedWarrant.subject_address} />
                          </div>
                        </div>
                      )}
```

- [ ] **Step 3: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/WarrantsPage.tsx
git commit -m "feat(mapbox): wire JurisdictionLookup into WarrantsPage subject address"
```

---

### Task 8: Wire into PropertiesTab

**Files:**
- Modify: `client/src/pages/records/PropertiesTab.tsx:493`

- [ ] **Step 1: Add the import**

Near the top of the file with the other component imports:

```ts
import JurisdictionLookup from '../../components/JurisdictionLookup';
```

- [ ] **Step 2: Render it near the composed property address**

Find the line building `propertyAddress` (line 493) and add the component immediately after wherever `propertyAddress` is first rendered in JSX (search for `{propertyAddress}` in the same file). Insert directly below it:

```tsx
<div className="mt-1">
  <JurisdictionLookup address={propertyAddress} />
</div>
```

- [ ] **Step 3: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/records/PropertiesTab.tsx
git commit -m "feat(mapbox): wire JurisdictionLookup into PropertiesTab"
```

---

### Task 9: Verify the traffic congestion layer renders

**Files:** none (verification only — see spec section 2)

- [ ] **Step 1: Start the dev servers**

Use `preview_start` for both the Worker (`npm run dev`, port 8787) and client (`cd client && npm run dev`, port 5173) per the project's launch config.

- [ ] **Step 2: Navigate to a map page and enable traffic**

Open the map page (`/map` or the Dispatch map), find the traffic toggle control that calls `useMapboxTraffic().toggle()` (search `useMapboxTraffic` usage: `grep -rn "useMapboxTraffic" client/src/pages`), and enable it.

- [ ] **Step 3: Inspect network + console**

Use `preview_network` filtered to requests containing `mapbox-traffic-v1`, and `preview_console_logs` filtered to `warn`/`error`.

- If the tile request returns 200 with vector tile data and colored congestion lines appear on the map (verify visually with `preview_screenshot`): no code change needed, layer is confirmed live.
- If the request 403s/404s or `[useMapboxTraffic] traffic layer unavailable` appears in console: proceed to Step 4.

- [ ] **Step 4 (only if Step 3 shows failure): disable the toggle honestly**

**Files:**
- Modify: `client/src/hooks/useMapboxTraffic.ts`

Add an `unavailable` flag surfaced from the catch block instead of only `console.warn`:

```ts
export function useMapboxTraffic(map: mapboxgl.Map | null) {
  const [visible, setVisible] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const addedRef = useRef(false);

  const addTrafficLayer = useCallback(() => {
    if (!map || addedRef.current) return;
    const m = map;
    whenStyleReady(m, () => {
      try {
        m.addSource(TRAFFIC_SOURCE_ID, {
          type: 'vector',
          url: 'mapbox://mapbox.mapbox-traffic-v1',
        });
        m.addLayer({
          id: TRAFFIC_LAYER_ID,
          type: 'line',
          source: TRAFFIC_SOURCE_ID,
          'source-layer': 'traffic',
          paint: {
            'line-color': [
              'match', ['get', 'congestion'],
              'low', '#64d264',
              'moderate', '#d4a017',
              'heavy', '#f07828',
              'severe', '#f03c3c',
              '#888888',
            ],
            'line-width': 2,
            'line-opacity': 0.7,
          },
          layout: { visibility: visible ? 'visible' : 'none' },
        });
        addedRef.current = true;
      } catch (err: any) {
        console.warn('[useMapboxTraffic] traffic layer unavailable:', err.message);
        setUnavailable(true);
      }
    });
  }, [map, visible]);
  // ... rest unchanged, add `unavailable` to the returned object
  return { visible, toggle, show, hide, addTrafficLayer, unavailable };
}
```

Then find the traffic toggle button (`grep -rn "useMapboxTraffic" client/src/pages`) and disable it with a tooltip when `unavailable` is true, matching the existing disabled-button pattern used elsewhere in the same toolbar file.

- [ ] **Step 5: Commit (only if Step 4 ran)**

```bash
git add client/src/hooks/useMapboxTraffic.ts <toolbar-file-touched>
git commit -m "fix(mapbox): surface traffic layer unavailability instead of silent warn"
```

---

### Task 10: Final verification pass

**Files:** none

- [ ] **Step 1: Full typecheck**

Run: `npm run typecheck && cd client && npx tsc --noEmit`
Expected: 0 errors in both.

- [ ] **Step 2: Full test suite**

Run: `npx vitest run` (root) and `cd client && npx vitest run`
Expected: all passing (matches the pre-existing baseline — 184 test files passed before this work per the spec commit).

- [ ] **Step 3: Browser verification of Search Box fix**

Per Task 2 Step 3 — confirm `useMapboxSearchBox` returns real results.

- [ ] **Step 4: Browser verification of Jurisdiction lookup**

Open WarrantsPage, select a warrant with a `subject_address`, click "Jurisdiction", confirm either a real county/municipality renders or an honest "unavailable" badge shows (not a crash, not a silent no-op).

- [ ] **Step 5: Confirm Boundaries access on the live token (production check, not local)**

Once this branch is deployed (or via `wrangler dev --remote` against the real `MAPBOX_ACCESS_TOKEN` secret), hit `GET /api/mapbox/boundaries?lng=-111.89&lat=40.76` directly and confirm whether the account has Boundaries entitlement. Record the result in the PR description either way — this is the "confirm access on a live token" step deferred from spec design time.
