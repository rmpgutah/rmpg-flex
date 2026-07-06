# Mapbox Contract Fixes (Part 0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix six live, currently-mounted Mapbox tools (Places Search, Street View, Directions, Nearest Unit, Route Optimizer, Map Match Trace) that silently 404 today because `client/src/services/mapboxApiService.ts` calls the wrong HTTP method/path/body-shape against `src/routes/mapbox.ts`.

**Architecture:** `mapboxApiService.ts` is a thin typed wrapper — no React state, no side effects beyond the HTTP call. Every fix in this plan is confined to rewriting the body of one exported function to match the real server contract; no exported function signature changes, so every caller (`useMapPlacesSearch.ts`, `useMapStreetView.ts`, `useMapDirectionsPanel.ts`, `useMapOptimization.ts`, `useMapMatchTrace.ts`, `findNearestUnits()`'s caller in `MapboxMapPage.tsx`) needs zero changes.

**Tech Stack:** TypeScript, `apiFetch` (client/src/hooks/useApi.ts), Hono (server, unchanged in this plan — `src/routes/mapbox.ts` is already correct, only the client is wrong).

**Reference spec:** [docs/superpowers/specs/2026-07-03-mapbox-second-integration-cleanup-design.md](../specs/2026-07-03-mapbox-second-integration-cleanup-design.md), Part 0.

---

## File Structure

- Modify: `client/src/services/mapboxApiService.ts` — all 6 fixes land here. One file, ~364 lines today; stays roughly the same size (rewriting function bodies, not adding new files).
- No test file exists for this service today and none of the 6 broken functions have unit tests. This plan adds a `client/src/services/__tests__/mapboxApiService.test.ts` covering the URL/param construction for each fixed function (mocking `apiFetch`), since these are pure request-shape bugs — a unit test is the cheapest way to pin the fix and prevent regression.

---

### Task 1: Add a shared coordinate-string helper + write its test first

**Files:**
- Modify: `client/src/services/mapboxApiService.ts`
- Test: `client/src/services/__tests__/mapboxApiService.test.ts` (new file)

Directions, Matrix, and Optimization all need the same `"lng,lat;lng,lat"` string the server expects (see `src/routes/mapbox.ts:108` — `const coordinates = c.req.query('coordinates')`, interpolated directly into the upstream Mapbox URL). Today's client sends a raw `Array<[number, number]>` as a POST body instead. Add one small helper and pin it with a test before touching the three call sites that use it.

- [ ] **Step 1: Write the failing test**

Create `client/src/services/__tests__/mapboxApiService.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../hooks/useApi', () => ({
  apiFetch: vi.fn(),
}));

import { apiFetch } from '../../hooks/useApi';
import { coordsToParam } from '../mapboxApiService';

describe('coordsToParam', () => {
  it('joins [lng, lat] pairs with commas and semicolons', () => {
    expect(coordsToParam([[-111.891, 40.7608], [-111.9, 40.75]])).toBe(
      '-111.891,40.7608;-111.9,40.75'
    );
  });

  it('handles a single coordinate pair with no trailing semicolon', () => {
    expect(coordsToParam([[-111.891, 40.7608]])).toBe('-111.891,40.7608');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/services/__tests__/mapboxApiService.test.ts`
Expected: FAIL — `coordsToParam` is not exported (module has no such export yet).

- [ ] **Step 3: Add the helper**

In `client/src/services/mapboxApiService.ts`, add near the top (after the type definitions, before `mapboxForwardGeocode`):

```ts
// ── Shared coordinate encoding ────────────────────────────
// The server's directions/matrix/optimization routes all take
// `coordinates` as a single "lng,lat;lng,lat" query string (they pass it
// straight through to the upstream Mapbox REST path), not a JSON array.
export function coordsToParam(coords: Array<[number, number]>): string {
  return coords.map(([lng, lat]) => `${lng},${lat}`).join(';');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/services/__tests__/mapboxApiService.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add client/src/services/mapboxApiService.ts client/src/services/__tests__/mapboxApiService.test.ts
git commit -m "fix(mapbox): add shared lng,lat;lng,lat coordinate encoder"
```

---

### Task 2: Fix `mapboxDirections` (POST+JSON → GET+query, "Directions" tool)

**Files:**
- Modify: `client/src/services/mapboxApiService.ts:168-177`
- Test: `client/src/services/__tests__/mapboxApiService.test.ts`

Server contract (`src/routes/mapbox.ts:105`): `GET /mapbox/directions?coordinates=&profile=&alternatives=&overview=&geometries=&steps=`, returns `{ routes, waypoints, code }`.

- [ ] **Step 1: Write the failing test**

Add to `client/src/services/__tests__/mapboxApiService.test.ts`:

```ts
import { mapboxDirections } from '../mapboxApiService';

describe('mapboxDirections', () => {
  beforeEach(() => { vi.mocked(apiFetch).mockReset(); });

  it('issues a GET with a coordinate-string query param, not a POST body', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ routes: [], waypoints: [], code: 'Ok' });

    await mapboxDirections([[-111.891, 40.7608], [-111.9, 40.75]], { profile: 'driving', alternatives: true });

    expect(apiFetch).toHaveBeenCalledWith(
      expect.stringContaining('/mapbox/directions?'),
      undefined,
    );
    const [url] = vi.mocked(apiFetch).mock.calls[0];
    expect(url).toContain('coordinates=-111.891%2C40.7608%3B-111.9%2C40.75');
    expect(url).toContain('profile=driving');
    expect(url).toContain('alternatives=true');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/services/__tests__/mapboxApiService.test.ts -t mapboxDirections`
Expected: FAIL — current implementation calls `apiFetch('/mapbox/directions', { method: 'POST', ... })`, a 2-arg call with a body, not matching the GET-with-query-only assertion.

- [ ] **Step 3: Rewrite `mapboxDirections`**

Replace in `client/src/services/mapboxApiService.ts`:

```ts
// ── Directions ────────────────────────────────────────────

export async function mapboxDirections(
  coordinates: Array<[number, number]>,
  options?: { profile?: string; steps?: boolean; alternatives?: boolean }
): Promise<MapboxDirectionsResponse> {
  const params = new URLSearchParams({ coordinates: coordsToParam(coordinates) });
  if (options?.profile) params.set('profile', options.profile);
  if (options?.alternatives != null) params.set('alternatives', String(options.alternatives));
  if (options?.steps != null) params.set('steps', String(options.steps));
  return apiFetch<MapboxDirectionsResponse>(`/mapbox/directions?${params}`);
}
```

(This replaces the existing function at lines 168-177 — same signature, same return type, only the body changes.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/services/__tests__/mapboxApiService.test.ts -t mapboxDirections`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add client/src/services/mapboxApiService.ts client/src/services/__tests__/mapboxApiService.test.ts
git commit -m "fix(mapbox): mapboxDirections was POSTing JSON to a GET-only route"
```

---

### Task 3: Fix `mapboxMatrix` (powers "Nearest Unit" — core dispatch)

**Files:**
- Modify: `client/src/services/mapboxApiService.ts:128-137`
- Test: `client/src/services/__tests__/mapboxApiService.test.ts`

Server contract (`src/routes/mapbox.ts:145`): `GET /mapbox/matrix?coordinates=&profile=&sources=&destinations=` (sources/destinations are comma-separated index lists, e.g. `"0"` or `"1,2,3"`).

- [ ] **Step 1: Write the failing test**

Add to `client/src/services/__tests__/mapboxApiService.test.ts`:

```ts
import { mapboxMatrix } from '../mapboxApiService';

describe('mapboxMatrix', () => {
  beforeEach(() => { vi.mocked(apiFetch).mockReset(); });

  it('issues a GET with comma-separated sources/destinations, not a POST body', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ durations: [[100]], distances: [[500]], sources: [], destinations: [] });

    await mapboxMatrix(
      [[-111.891, 40.7608], [-111.9, 40.75], [-111.95, 40.8]],
      { sources: [0], destinations: [1, 2] },
    );

    const [url] = vi.mocked(apiFetch).mock.calls[0];
    expect(url).toContain('/mapbox/matrix?');
    expect(url).toContain('sources=0');
    expect(url).toContain('destinations=1%2C2');
    expect(vi.mocked(apiFetch).mock.calls[0][1]).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/services/__tests__/mapboxApiService.test.ts -t mapboxMatrix`
Expected: FAIL — current implementation POSTs a JSON body with `sources`/`destinations` as arrays, not query params.

- [ ] **Step 3: Rewrite `mapboxMatrix`**

Replace in `client/src/services/mapboxApiService.ts`:

```ts
// ── Matrix ────────────────────────────────────────────────

export async function mapboxMatrix(
  coordinates: Array<[number, number]>,
  options?: { profile?: string; sources?: number[]; destinations?: number[] }
): Promise<MapboxMatrixResponse> {
  const params = new URLSearchParams({ coordinates: coordsToParam(coordinates) });
  if (options?.profile) params.set('profile', options.profile);
  if (options?.sources?.length) params.set('sources', options.sources.join(','));
  if (options?.destinations?.length) params.set('destinations', options.destinations.join(','));
  return apiFetch<MapboxMatrixResponse>(`/mapbox/matrix?${params}`);
}
```

(Replaces the existing function at lines 128-137. `findNearestUnits()` just below it calls `mapboxMatrix(coordinates, { sources, destinations })` already — no change needed there, since the exported signature is unchanged.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/services/__tests__/mapboxApiService.test.ts -t mapboxMatrix`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add client/src/services/mapboxApiService.ts client/src/services/__tests__/mapboxApiService.test.ts
git commit -m "fix(mapbox): mapboxMatrix was POSTing JSON, breaking Nearest Unit dispatch"
```

---

### Task 4: Fix `mapboxOptimization` ("Route Optimizer" tool)

**Files:**
- Modify: `client/src/services/mapboxApiService.ts:277-286`
- Test: `client/src/services/__tests__/mapboxApiService.test.ts`

Server contract (`src/routes/mapbox.ts:161`): `GET /mapbox/optimization?coordinates=&profile=&source=&destination=&roundtrip=`.

- [ ] **Step 1: Write the failing test**

Add to `client/src/services/__tests__/mapboxApiService.test.ts`:

```ts
import { mapboxOptimization } from '../mapboxApiService';

describe('mapboxOptimization', () => {
  beforeEach(() => { vi.mocked(apiFetch).mockReset(); });

  it('issues a GET with source/destination/roundtrip as query params', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ trips: [], waypoints: [] });

    await mapboxOptimization(
      [[-111.891, 40.7608], [-111.9, 40.75]],
      { roundtrip: true, source: 'first', destination: 'last' },
    );

    const [url] = vi.mocked(apiFetch).mock.calls[0];
    expect(url).toContain('/mapbox/optimization?');
    expect(url).toContain('roundtrip=true');
    expect(url).toContain('source=first');
    expect(url).toContain('destination=last');
    expect(vi.mocked(apiFetch).mock.calls[0][1]).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/services/__tests__/mapboxApiService.test.ts -t mapboxOptimization`
Expected: FAIL — current implementation POSTs JSON.

- [ ] **Step 3: Rewrite `mapboxOptimization`**

Replace in `client/src/services/mapboxApiService.ts`:

```ts
export async function mapboxOptimization(
  coordinates: Array<[number, number]>,
  options?: { profile?: string; steps?: boolean; roundtrip?: boolean; source?: string; destination?: string }
): Promise<MapboxOptimizationResponse> {
  const params = new URLSearchParams({ coordinates: coordsToParam(coordinates) });
  if (options?.profile) params.set('profile', options.profile);
  if (options?.source) params.set('source', options.source);
  if (options?.destination) params.set('destination', options.destination);
  if (options?.roundtrip != null) params.set('roundtrip', String(options.roundtrip));
  return apiFetch<MapboxOptimizationResponse>(`/mapbox/optimization?${params}`);
}
```

(Replaces the existing function at lines 277-286.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/services/__tests__/mapboxApiService.test.ts -t mapboxOptimization`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add client/src/services/mapboxApiService.ts client/src/services/__tests__/mapboxApiService.test.ts
git commit -m "fix(mapbox): mapboxOptimization was POSTing JSON to a GET-only route"
```

---

### Task 5: Fix `mapboxMapMatch` (wrong path — "Map Match Trace" tool)

**Files:**
- Modify: `client/src/services/mapboxApiService.ts:181-190`
- Test: `client/src/services/__tests__/mapboxApiService.test.ts`

Server contract (`src/routes/mapbox.ts:184`): `POST /mapbox/map-matching` (note: `-matching`, not `-match`). Method and body shape (`{ coordinates, profile }` JSON) already match — this is a pure path typo.

- [ ] **Step 1: Write the failing test**

Add to `client/src/services/__tests__/mapboxApiService.test.ts`:

```ts
import { mapboxMapMatch } from '../mapboxApiService';

describe('mapboxMapMatch', () => {
  beforeEach(() => { vi.mocked(apiFetch).mockReset(); });

  it('POSTs to /mapbox/map-matching, not /mapbox/map-match', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ matchings: [], tracepoints: [] });

    await mapboxMapMatch([[-111.891, 40.7608], [-111.9, 40.75]]);

    const [url] = vi.mocked(apiFetch).mock.calls[0];
    expect(url).toBe('/mapbox/map-matching');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/services/__tests__/mapboxApiService.test.ts -t mapboxMapMatch`
Expected: FAIL — current URL is `/mapbox/map-match`.

- [ ] **Step 3: Fix the path**

In `client/src/services/mapboxApiService.ts`, change only the URL string in `mapboxMapMatch` (lines 181-190):

```ts
export async function mapboxMapMatch(
  coordinates: Array<[number, number]>,
  options?: { profile?: string; timestamps?: number[]; radiuses?: number[] }
): Promise<MapboxMapMatchResponse> {
  return apiFetch<MapboxMapMatchResponse>('/mapbox/map-matching', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ coordinates, ...options }),
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/services/__tests__/mapboxApiService.test.ts -t mapboxMapMatch`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add client/src/services/mapboxApiService.ts client/src/services/__tests__/mapboxApiService.test.ts
git commit -m "fix(mapbox): mapboxMapMatch pointed at /map-match, real route is /map-matching"
```

---

### Task 6: Fix `mapboxForwardGeocode` + `mapboxReverseGeocode` (wrong path + wrong response key)

**Files:**
- Modify: `client/src/services/mapboxApiService.ts:82-111`
- Test: `client/src/services/__tests__/mapboxApiService.test.ts`

Server contracts:
- `GET /mapbox/geocode?q=&limit=&types=&proximity=&country=` (`src/routes/mapbox.ts:72`) → `{ features: [...] }`
- `GET /mapbox/reverse-geocode?lng=&lat=` (`src/routes/mapbox.ts:91`) → `{ features: [...] }`

Both current implementations call the wrong path (`/geocode/forward`, `/geocode/reverse`) and read `data.results` instead of `data.features`. The raw Mapbox `feature` shape is `{ place_name, text, center: [lng, lat], place_type: string[], relevance }` (confirmed in the already-fixed `useMapboxSearchBox.ts:95-109`, which maps this exact shape) — add one small mapper shared by both functions instead of duplicating the mapping twice.

- [ ] **Step 1: Write the failing tests**

Add to `client/src/services/__tests__/mapboxApiService.test.ts`:

```ts
import { mapboxForwardGeocode, mapboxReverseGeocode } from '../mapboxApiService';

const FAKE_FEATURE = {
  place_name: '123 Main St, Salt Lake City, UT 84111',
  text: '123 Main St',
  center: [-111.891, 40.7608] as [number, number],
  place_type: ['address'],
  relevance: 0.98,
};

describe('mapboxForwardGeocode', () => {
  beforeEach(() => { vi.mocked(apiFetch).mockReset(); });

  it('calls GET /mapbox/geocode and maps the features array', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ features: [FAKE_FEATURE] });

    const results = await mapboxForwardGeocode('123 Main St');

    const [url] = vi.mocked(apiFetch).mock.calls[0];
    expect(url).toContain('/mapbox/geocode?');
    expect(url).not.toContain('/geocode/forward');
    expect(results).toEqual([{
      name: '123 Main St',
      full_address: '123 Main St, Salt Lake City, UT 84111',
      latitude: 40.7608,
      longitude: -111.891,
      place_type: 'address',
      relevance: 0.98,
    }]);
  });
});

describe('mapboxReverseGeocode', () => {
  beforeEach(() => { vi.mocked(apiFetch).mockReset(); });

  it('calls GET /mapbox/reverse-geocode and maps the features array', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ features: [FAKE_FEATURE] });

    const results = await mapboxReverseGeocode(-111.891, 40.7608);

    const [url] = vi.mocked(apiFetch).mock.calls[0];
    expect(url).toContain('/mapbox/reverse-geocode?');
    expect(url).not.toContain('/geocode/reverse');
    expect(results[0].name).toBe('123 Main St');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/services/__tests__/mapboxApiService.test.ts -t "Geocode"`
Expected: FAIL — wrong URL and `data.results` is `undefined` on the mocked `{ features }` response, so `.map` throws.

- [ ] **Step 3: Add the shared feature mapper + fix both functions**

In `client/src/services/mapboxApiService.ts`, add this type + helper right before `mapboxForwardGeocode` (reusing the exact shape `useMapboxSearchBox.ts` already normalizes):

```ts
interface RawMapboxFeature {
  place_name: string;
  text: string;
  center: [number, number];
  place_type: string[];
  relevance: number;
}

function mapRawFeature(f: RawMapboxFeature): MapboxGeocodingResult {
  return {
    name: f.text || f.place_name || '',
    full_address: f.place_name || '',
    latitude: f.center?.[1] ?? 0,
    longitude: f.center?.[0] ?? 0,
    place_type: (f.place_type || [])[0] || '',
    relevance: f.relevance ?? 0,
  };
}
```

Then replace `mapboxForwardGeocode` (lines 82-95):

```ts
export async function mapboxForwardGeocode(
  query: string,
  options?: { limit?: number; proximity?: [number, number]; country?: string }
): Promise<MapboxGeocodingResult[]> {
  const params = new URLSearchParams({ q: query });
  if (options?.limit) params.set('limit', String(options.limit));
  if (options?.proximity) params.set('proximity', options.proximity.join(','));
  if (options?.country) params.set('country', options.country);

  const data = await apiFetch<{ features: RawMapboxFeature[] }>(`/mapbox/geocode?${params}`);
  return (data.features || []).map(mapRawFeature);
}
```

And `mapboxReverseGeocode` (lines 99-111):

```ts
export async function mapboxReverseGeocode(
  lng: number, lat: number,
  options?: { types?: string; limit?: number }
): Promise<MapboxGeocodingResult[]> {
  const params = new URLSearchParams({ lng: String(lng), lat: String(lat) });
  if (options?.types) params.set('types', options.types);
  if (options?.limit) params.set('limit', String(options.limit));

  const data = await apiFetch<{ features: RawMapboxFeature[] }>(`/mapbox/reverse-geocode?${params}`);
  return (data.features || []).map(mapRawFeature);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/services/__tests__/mapboxApiService.test.ts -t "Geocode"`
Expected: PASS (both tests)

- [ ] **Step 5: Commit**

```bash
git add client/src/services/mapboxApiService.ts client/src/services/__tests__/mapboxApiService.test.ts
git commit -m "fix(mapbox): forward/reverse geocode hit wrong path + wrong response key"
```

---

### Task 7: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full new test file**

Run: `cd client && npx vitest run src/services/__tests__/mapboxApiService.test.ts`
Expected: PASS — 9 tests (2 from Task 1 + 1 each from Tasks 2-4 + 1 from Task 5 + 2 from Task 6, i.e. 2+1+1+1+1+2 = 8; confirm actual count matches what you wrote, all green).

- [ ] **Step 2: Run full client typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: PASS — no new errors (this plan doesn't change any exported function's type signature, so no caller should need edits).

- [ ] **Step 3: Run full client test suite**

Run: `cd client && npx vitest run`
Expected: PASS — same pass count as before this plan, plus the new file's tests.

- [ ] **Step 4: Manual smoke test (requires `npm run dev` + a real Mapbox token)**

Run: `npm run dev` (Worker) and `cd client && npm run dev` (Vite), then in the browser on `/map`:
1. Use the Places Search tool — confirm real results appear (not empty).
2. Click the Street View tool on a point with imagery — confirm it opens (not stuck loading).
3. Use Directions between two points — confirm a route line + ETA renders.
4. Select a call with an available unit and click "Nearest Unit" — confirm it reports a real unit + ETA, not an error toast.
5. Run Route Optimizer with 3+ stops — confirm an optimized route renders.
6. Start a Map Match Trace, drive/simulate a short path, stop it — confirm a snapped route renders.

Expected: all six work end-to-end with real data. If a client secret/token isn't configured in this environment, note which steps couldn't be exercised rather than skip verification silently.

- [ ] **Step 5: Final commit (if manual verification surfaced any follow-up note)**

Only if Step 4 found something — otherwise this plan is done after Task 6's commit.
