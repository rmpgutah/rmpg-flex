# Geospatial Intel Map — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline). Steps use `- [ ]`.

**Goal:** Replace the `/intel/map` stub with a real Mapbox geospatial intelligence map: coordinate-bearing intel (sightings, calls, incidents, field interviews) plus geocoded address-only intel (warrants, BOLOs, trespass), with click→dossier-panel integration inside the portal.

**Architecture:** One new Worker endpoint `GET /api/intel/geo?days=30` aggregates all map-able intel into typed feature arrays. Address-only sources are geocoded cache-first via the existing `geocodeAddress()` (Nominatim + KV cache), capped per-request with a surfaced `pending` count so the cache warms over visits. A new `IntelMapPage.tsx` (inside `IntelPortalLayout`, using `useIntelContext`) renders toggleable circle layers, a legend, a time-window control, and wires point-clicks to `selectEntity()` (persons/vehicles → right dossier panel) or navigation (warrants/cases).

**Tech Stack:** Hono/D1 Worker; React + `mapbox-gl` via existing `mapboxLoader`/`mapboxApiKey`/`mapboxSafeLayer`; Vitest.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `src/utils/intelGeo.ts` | Pure helpers: `daysCutoff`, `finiteCoord`, `toFeature`, feature typing | Create |
| `src/routes/intel.ts` | Add `GET /geo` handler (DB queries + cache-first geocode) | Modify |
| `tests/intelGeo.test.ts` | Unit-test the pure helpers | Create |
| `client/src/pages/intel/useIntelGeo.ts` | Fetch `/intel/geo`, expose layers + pending + setDays | Create |
| `client/src/pages/intel/IntelMapPage.tsx` | The map page (replaces stub) | Create |
| `client/src/pages/intel/map/geoLayers.ts` | Layer config (id, color, label) + pure feature→GeoJSON | Create |
| `client/src/App.tsx` | Route `/intel/map` → IntelMapPage (replace IntelComingSoon) | Modify |
| `client/src/pages/intel/__tests__/*` | Vitest for hook + geoLayers | Create |
| `client/public/sw.js` | Bump CACHE_NAME v956 → v957 | Modify |

**Endpoint shape (`GET /api/intel/geo?days=30`):**
```jsonc
{
  "layers": {
    "sightings":        [{ "entity_type":"vehicle", "entity_id":12, "lat":40.7, "lng":-111.9, "label":"ABC123", "when":"2026-06-10" }],
    "calls":            [{ "entity_type":"call",     "entity_id":5,  "lat":..., "lng":..., "label":"CFS-5 · Theft", "when":"..." }],
    "incidents":        [{ "entity_type":"incident", "entity_id":3,  "lat":..., "lng":..., "label":"INC-3 · Burglary", "when":"..." }],
    "field_interviews": [{ "entity_type":"field_interview", "entity_id":2, "lat":..., "lng":..., "label":"FI-2", "when":"..." }],
    "warrants":         [{ "entity_type":"warrant",  "entity_id":9,  "lat":..., "lng":..., "label":"WAR-9", "geocoded":true }],
    "bolos":            [{ "entity_type":"bolo",     "entity_id":4,  "lat":..., "lng":..., "label":"BOLO: red sedan", "geocoded":true }],
    "trespass":         [{ "entity_type":"trespass_order", "entity_id":1, "lat":..., "lng":..., "label":"TRES-1", "geocoded":true }]
  },
  "geocoding": { "pending": 7 }   // address-only rows not yet in KV cache this request
}
```

**Coordinate sources (verified):** `vehicle_sightings.lat/lng`, `calls_for_service.latitude/longitude`, `incidents.latitude/longitude`, `field_interviews.latitude/longitude`. **Address-only (geocode):** `warrants` (subject person address via `persons`), `bolos` (location text), `trespass_orders` (location / property_address).

---

## Task 1: Pure geo helpers + tests

**Files:** Create `src/utils/intelGeo.ts`, `tests/intelGeo.test.ts`.

- [ ] **Step 1: Write failing tests**

```ts
// tests/intelGeo.test.ts
import { describe, it, expect } from 'vitest';
import { daysCutoffISO, finiteCoord, geoFeature } from '../src/utils/intelGeo';

describe('intelGeo helpers', () => {
  it('finiteCoord accepts finite pairs, rejects junk', () => {
    expect(finiteCoord(40.7, -111.9)).toBe(true);
    expect(finiteCoord(null, -111.9)).toBe(false);
    expect(finiteCoord(40.7, NaN)).toBe(false);
    expect(finiteCoord(0, 0)).toBe(false); // null island → treat as missing
  });
  it('daysCutoffISO returns an ISO date N days before the given now', () => {
    expect(daysCutoffISO(7, new Date('2026-06-14T00:00:00Z'))).toBe('2026-06-07');
  });
  it('geoFeature shapes a typed feature with numeric coords', () => {
    expect(geoFeature('vehicle', 12, '40.70', '-111.90', 'ABC123', { when: '2026-06-10' }))
      .toEqual({ entity_type: 'vehicle', entity_id: 12, lat: 40.7, lng: -111.9, label: 'ABC123', when: '2026-06-10' });
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run tests/intelGeo.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/utils/intelGeo.ts
// Pure helpers for the intel geo endpoint. No I/O — easy to unit-test.
export interface GeoFeature {
  entity_type: string; entity_id: number; lat: number; lng: number; label: string;
  when?: string | null; geocoded?: boolean;
}

export function finiteCoord(lat: unknown, lng: unknown): boolean {
  const a = Number(lat), b = Number(lng);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  if (a === 0 && b === 0) return false; // null island = missing data
  return true;
}

// ISO yyyy-mm-dd N days before `now` (defaults handled by caller passing a Date).
export function daysCutoffISO(days: number, now: Date): string {
  const d = new Date(now.getTime() - days * 86400000);
  return d.toISOString().slice(0, 10);
}

export function geoFeature(
  entity_type: string, entity_id: number, lat: unknown, lng: unknown, label: string,
  extra: { when?: string | null; geocoded?: boolean } = {},
): GeoFeature {
  return { entity_type, entity_id, lat: Number(lat), lng: Number(lng), label, ...extra };
}
```

- [ ] **Step 4: Run, verify pass** — `npx vitest run tests/intelGeo.test.ts`
- [ ] **Step 5: Commit** — `feat(intel): pure geo helpers for the intel map endpoint`

---

## Task 2: `GET /api/intel/geo` endpoint

**Files:** Modify `src/routes/intel.ts`. (No worker test harness — covered by helper tests + manual curl/D1 verify. Each query try/catch-isolated, matching the file's pattern.)

- [ ] **Step 1: Add the handler** near the other intel GETs (after `/overview`).

```ts
import { daysCutoffISO, finiteCoord, geoFeature, type GeoFeature } from '../utils/intelGeo';
import { geocodeAddress } from './geocode';

// GET /geo?days=30 — map-able intel as typed feature arrays. Coordinate-bearing
// sources return directly; address-only sources geocode cache-first with a small
// inline cap (Nominatim is 1 req/s) and report how many remain pending.
intel.get('/geo', operational, async (c) => {
  const db = getDb(c.env);
  const days = Math.min(Math.max(parseInt(c.req.query('days') || '30', 10) || 30, 1), 90);
  const cutoff = daysCutoffISO(days, new Date());
  const cap = 250;
  const layers: Record<string, GeoFeature[]> = {
    sightings: [], calls: [], incidents: [], field_interviews: [], warrants: [], trespass: [],
  };
  // NOTE: `bolos` dropped — the live table has NO location column (verified
  // pragma_table_info 2026-06-14: only descriptions). Nothing to geocode.

  const coordQuery = async (key: string, sql: string, map: (r: any) => GeoFeature | null) => {
    try {
      for (const r of await query<any>(db, sql, cutoff, cap)) {
        const f = map(r);
        if (f && finiteCoord(f.lat, f.lng)) layers[key].push(f);
      }
    } catch (e: any) { console.error(`[geo] ${key}:`, e?.message); }
  };

  await coordQuery('sightings',
    `SELECT id, plate, vehicle_id, lat, lng, location_text, created_at FROM vehicle_sightings
      WHERE created_at >= ? ORDER BY created_at DESC LIMIT ?`,
    (r) => geoFeature('vehicle', r.vehicle_id || r.id, r.lat, r.lng, r.plate || r.location_text || `Sighting #${r.id}`, { when: r.created_at }));

  await coordQuery('calls',
    `SELECT id, call_number, incident_type, latitude, longitude, created_at FROM calls_for_service
      WHERE created_at >= ? AND latitude IS NOT NULL ORDER BY created_at DESC LIMIT ?`,
    (r) => geoFeature('call', r.id, r.latitude, r.longitude, [r.call_number, r.incident_type].filter(Boolean).join(' · ') || `CFS-${r.id}`, { when: r.created_at }));

  await coordQuery('incidents',
    `SELECT id, incident_number, incident_type, latitude, longitude, created_at FROM incidents
      WHERE created_at >= ? AND latitude IS NOT NULL ORDER BY created_at DESC LIMIT ?`,
    (r) => geoFeature('incident', r.id, r.latitude, r.longitude, [r.incident_number, r.incident_type].filter(Boolean).join(' · ') || `INC-${r.id}`, { when: r.created_at }));

  await coordQuery('field_interviews',
    `SELECT id, fi_number, latitude, longitude, created_at FROM field_interviews
      WHERE created_at >= ? AND latitude IS NOT NULL ORDER BY created_at DESC LIMIT ?`,
    (r) => geoFeature('field_interview', r.id, r.latitude, r.longitude, r.fi_number || `FI-${r.id}`, { when: r.created_at }));

  // --- Address-only sources: geocode cache-first, capped inline ---
  let geocodeBudget = 12;     // uncached geocodes allowed THIS request
  let pending = 0;
  const geo = async (addr: string | null | undefined): Promise<{ lat: number; lng: number } | null> => {
    const a = (addr || '').trim();
    if (a.length < 4) return null;
    // Probe the KV cache directly (no geocode) to keep most rows instant.
    const cacheKey = `geocode:fwd:${a.toLowerCase()}`;
    const cached = (await c.env.KV.get(cacheKey, 'json').catch(() => null)) as { lat: number; lng: number } | null;
    if (cached && finiteCoord(cached.lat, cached.lng)) return cached;
    if (geocodeBudget <= 0) { pending++; return null; }
    geocodeBudget--;
    const res = await geocodeAddress(c.env, a); // best-effort; writes KV on success
    if (!res) { pending++; return null; }
    return res;
  };

  const addrLayer = async (key: string, sql: string, addrOf: (r: any) => string | null, mk: (r: any, lat: number, lng: number) => GeoFeature) => {
    try {
      for (const r of await query<any>(db, sql, cap)) {
        const coords = await geo(addrOf(r));
        if (coords && finiteCoord(coords.lat, coords.lng)) layers[key].push(mk(r, coords.lat, coords.lng));
      }
    } catch (e: any) { console.error(`[geo] ${key}:`, e?.message); }
  };

  await addrLayer('warrants',
    `SELECT w.id, w.warrant_number, p.address, p.city FROM warrants w
       LEFT JOIN persons p ON p.id = w.person_id
      WHERE w.status = 'active' LIMIT ?`,
    (r) => [r.address, r.city].filter(Boolean).join(', '),
    (r, lat, lng) => geoFeature('warrant', r.id, lat, lng, r.warrant_number || `WAR-${r.id}`, { geocoded: true }));

  await addrLayer('trespass',
    `SELECT id, order_number, location, property_address FROM trespass_orders
      WHERE status = 'active' OR status IS NULL LIMIT ?`,
    (r) => r.property_address || r.location,
    (r, lat, lng) => geoFeature('trespass_order', r.id, lat, lng, r.order_number || `TRES-${r.id}`, { geocoded: true }));

  return c.json({ layers, geocoding: { pending } });
});
```

NOTE: `warrants.person_id`, `bolos.location`, `bolos.status`, `trespass_orders.property_address/location/status` column names must be verified against live D1 before relying on them; each block is try/catch-isolated so a wrong column yields `[]` for that layer, not a 500. Verify with `pragma_table_info` during Step 2.

- [ ] **Step 2: Verify columns + smoke the endpoint against live D1**

Run (Cloudflare D1 API): `pragma_table_info('warrants')`, `('bolos')`, `('trespass_orders')`, `('vehicle_sightings')` — adjust the SQL above to the real column names (e.g. if `bolos` has no `location`, drop that addr and label by description only; if `warrants` links via a different column, fix the JOIN). Re-run worker typecheck.

- [ ] **Step 3: Worker typecheck** — `npm run typecheck` → clean.
- [ ] **Step 4: Commit** — `feat(intel): GET /api/intel/geo aggregates map-able intel (geocode cache-first)`

---

## Task 3: Client geo layer config + hook

**Files:** Create `client/src/pages/intel/map/geoLayers.ts`, `client/src/pages/intel/useIntelGeo.ts`, tests.

- [ ] **Step 1: Write failing test for `toGeoJSON`**

```ts
// client/src/pages/intel/__tests__/geoLayers.test.ts
import { describe, it, expect } from 'vitest';
import { LAYER_DEFS, toGeoJSON } from '../map/geoLayers';

describe('geoLayers', () => {
  it('has a def per layer key with a color', () => {
    expect(LAYER_DEFS.map((l) => l.key)).toContain('sightings');
    expect(LAYER_DEFS.every((l) => /^#/.test(l.color))).toBe(true);
  });
  it('builds a FeatureCollection with [lng,lat] coords', () => {
    const fc = toGeoJSON([{ entity_type: 'vehicle', entity_id: 1, lat: 40.7, lng: -111.9, label: 'X' }]);
    expect(fc.features[0].geometry.coordinates).toEqual([-111.9, 40.7]);
    expect(fc.features[0].properties.label).toBe('X');
  });
});
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement `geoLayers.ts`**

```ts
// client/src/pages/intel/map/geoLayers.ts
export interface GeoFeature {
  entity_type: string; entity_id: number; lat: number; lng: number; label: string;
  when?: string | null; geocoded?: boolean;
}
export interface LayerDef { key: string; label: string; color: string }

export const LAYER_DEFS: LayerDef[] = [
  { key: 'sightings', label: 'Plate Sightings', color: '#22d3ee' },
  { key: 'calls', label: 'Calls', color: '#d4a017' },
  { key: 'incidents', label: 'Incidents', color: '#f59e0b' },
  { key: 'field_interviews', label: 'Field Interviews', color: '#10b981' },
  { key: 'warrants', label: 'Warrants', color: '#ff6b5e' },
  { key: 'trespass', label: 'Trespass', color: '#888888' },
];

export function toGeoJSON(features: GeoFeature[]) {
  return {
    type: 'FeatureCollection' as const,
    features: features.map((f) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [f.lng, f.lat] },
      properties: { entity_type: f.entity_type, entity_id: f.entity_id, label: f.label, when: f.when ?? '' },
    })),
  };
}
```

- [ ] **Step 4: Implement `useIntelGeo.ts`**

```ts
// client/src/pages/intel/useIntelGeo.ts
import { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../../hooks/useApi';
import type { GeoFeature } from './map/geoLayers';

export interface GeoResponse { layers: Record<string, GeoFeature[]>; geocoding: { pending: number } }

export function useIntelGeo(initialDays = 30) {
  const [days, setDays] = useState(initialDays);
  const [data, setData] = useState<GeoResponse>({ layers: {}, geocoding: { pending: 0 } });
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    apiFetch<GeoResponse>(`/intel/geo?days=${days}`)
      .then((r) => setData(r && r.layers ? r : { layers: {}, geocoding: { pending: 0 } }))
      .catch(() => setData({ layers: {}, geocoding: { pending: 0 } }))
      .finally(() => setLoading(false));
  }, [days]);
  useEffect(load, [load]);

  return { data, loading, days, setDays, reload: load };
}
```

- [ ] **Step 5: Run test, verify pass.** `cd client && npx vitest run src/pages/intel/__tests__/geoLayers.test.ts`
- [ ] **Step 6: Commit** — `feat(intel): geo layer config + useIntelGeo hook`

---

## Task 4: `IntelMapPage` — render, layers, click→dossier

**Files:** Create `client/src/pages/intel/IntelMapPage.tsx`; modify `client/src/App.tsx`.

- [ ] **Step 1: Implement the page** (mirrors MapPage instantiation; uses safe-layer helpers).

```tsx
// client/src/pages/intel/IntelMapPage.tsx
// Geospatial intelligence map inside the Intel Portal. Coordinate-bearing +
// geocoded intel as toggleable circle layers; clicking a point selects the
// entity into the shared context (right dossier panel) or navigates.
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import mapboxgl from 'mapbox-gl';
import { getMapboxAccessToken, getMapboxTokenErrorMessage } from '../../utils/mapboxApiKey';
import { MAPBOX_STYLE_DARK, registerMapInstance, unregisterMapInstance } from '../../utils/mapboxLoader';
import { safeRemoveLayer, safeRemoveSource } from '../../utils/mapboxSafeLayer';
import { useIntelContext } from './IntelContext';
import { useIntelGeo } from './useIntelGeo';
import { LAYER_DEFS, toGeoJSON } from './map/geoLayers';

const DAYS_OPTS = [1, 7, 30];

export default function IntelMapPage() {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const popupRef = useRef<mapboxgl.Popup | null>(null);
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState('');
  const [active, setActive] = useState<Record<string, boolean>>(() => Object.fromEntries(LAYER_DEFS.map((l) => [l.key, true])));
  const { data, loading, days, setDays } = useIntelGeo(30);
  const { selectEntity } = useIntelContext();
  const navigate = useNavigate();

  // Create map once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = await getMapboxAccessToken().catch(() => '');
      if (cancelled) return;
      if (!token) { setErr(getMapboxTokenErrorMessage()); return; }
      mapboxgl.accessToken = token;
      const map = new mapboxgl.Map({
        container: ref.current!, style: MAPBOX_STYLE_DARK,
        center: [-111.891, 40.7608], zoom: 11,
      });
      mapRef.current = map;
      registerMapInstance(map);
      popupRef.current = new mapboxgl.Popup({ closeButton: true, closeOnClick: false, maxWidth: '260px' });
      map.on('load', () => { if (!cancelled) setReady(true); });
    })();
    return () => {
      cancelled = true;
      if (mapRef.current) { unregisterMapInstance(mapRef.current); mapRef.current.remove(); mapRef.current = null; }
    };
  }, []);

  // Sync layers whenever data / toggles change.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const allFeatures: Array<[number, number]> = [];
    for (const def of LAYER_DEFS) {
      const srcId = `intel-${def.key}`;
      safeRemoveLayer(map, srcId);
      safeRemoveSource(map, srcId);
      if (!active[def.key]) continue;
      const feats = data.layers[def.key] || [];
      feats.forEach((f) => allFeatures.push([f.lng, f.lat]));
      map.addSource(srcId, { type: 'geojson', data: toGeoJSON(feats) as any });
      map.addLayer({
        id: srcId, type: 'circle', source: srcId,
        paint: { 'circle-color': def.color, 'circle-radius': 6, 'circle-stroke-color': '#000', 'circle-stroke-width': 1, 'circle-opacity': 0.85 },
      });
      map.on('click', srcId, (e) => {
        const p = e.features?.[0]?.properties as any;
        if (!p) return;
        const type = p.entity_type, id = Number(p.entity_id);
        if (type === 'vehicle' || type === 'person') { selectEntity(type, id, p.label); return; }
        if (type === 'warrant') { navigate(`/warrants?id=${id}`); return; }
        popupRef.current?.setLngLat(e.lngLat).setHTML(`<div style="font:11px monospace;color:#111">${p.label || type}</div>`).addTo(map);
      });
      map.on('mouseenter', srcId, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', srcId, () => { map.getCanvas().style.cursor = ''; });
    }
    if (allFeatures.length) {
      const b = new mapboxgl.LngLatBounds();
      allFeatures.forEach((c) => b.extend(c));
      try { map.fitBounds(b, { padding: 60, maxZoom: 14, duration: 400 }); } catch { /* single point */ }
    }
  }, [data, active, ready, selectEntity, navigate]);

  const toggle = (k: string) => setActive((a) => ({ ...a, [k]: !a[k] }));

  if (err) return <div className="p-4 text-[11px] text-[#ff6b5e]">{err}</div>;

  return (
    <div className="relative h-full w-full">
      <div ref={ref} className="absolute inset-0" />
      {/* Controls */}
      <div className="absolute top-2 left-2 z-10 bg-[#000000cc] border border-[#232323] rounded-[2px] p-2 space-y-2">
        <div className="flex gap-1">
          {DAYS_OPTS.map((d) => (
            <button key={d} onClick={() => setDays(d)}
              className={`font-mono text-[9px] px-2 py-[2px] rounded-[2px] border ${days === d ? 'border-[#d4a017] text-[#d4a017]' : 'border-[#2a2a2a] text-[#888]'}`}>
              {d === 1 ? '24h' : `${d}d`}
            </button>
          ))}
          {loading && <span className="font-mono text-[9px] text-[#666] self-center">…</span>}
        </div>
        <div className="space-y-[2px]">
          {LAYER_DEFS.map((l) => {
            const n = (data.layers[l.key] || []).length;
            return (
              <button key={l.key} onClick={() => toggle(l.key)}
                className={`w-full flex items-center gap-2 px-1 py-[2px] rounded-[2px] ${active[l.key] ? '' : 'opacity-40'}`}>
                <span className="w-[8px] h-[8px] rounded-full shrink-0" style={{ background: l.color }} />
                <span className="text-[10px] text-[#cfcfcf] flex-1 text-left">{l.label}</span>
                <span className="font-mono text-[9px] text-[#666]">{n}</span>
              </button>
            );
          })}
        </div>
        {data.geocoding.pending > 0 && (
          <div className="text-[8px] text-[#777] font-mono pt-1 border-t border-[#1a1a1a]">{data.geocoding.pending} locating… revisit to resolve</div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Route it** — in `App.tsx` replace the `/intel/map` IntelComingSoon element with `<IntelMapPage/>` (lazy import). Find the nested intel route `path="map"` and swap the element; add `const IntelMapPage = lazyRetry(() => import('./pages/intel/IntelMapPage'));`.

- [ ] **Step 3: Client typecheck + intel tests** — `cd client && npx tsc --noEmit && npx vitest run src/pages/intel`
- [ ] **Step 4: Commit** — `feat(intel): geospatial intel map page (layers + click→dossier)`

---

## Task 5: Verify + SW bump + PR

- [ ] **Step 1:** Bump `client/public/sw.js` CACHE_NAME v956 → v957.
- [ ] **Step 2:** `npm run typecheck` (worker) → clean.
- [ ] **Step 3:** `npx vitest run` (worker) → green.
- [ ] **Step 4:** `cd client && npx tsc --noEmit && npx vitest run` → green.
- [ ] **Step 5:** `cd client && npx vite build` → succeeds.
- [ ] **Step 6:** Commit SW bump; push; `gh pr create`.

## Self-Review

- Endpoint shape consistent with `geoLayers.GeoFeature` (entity_type/entity_id/lat/lng/label/when/geocoded). ✓
- `toGeoJSON` emits `[lng,lat]` (Mapbox order). ✓
- Address-only geocoding is cache-first + capped + `pending` surfaced (no silent truncation). ✓
- Column-name risk flagged in Task 2 Step 2 with a live `pragma_table_info` verification gate; try/catch isolation prevents 500s. ✓
- Click integration: person/vehicle → `selectEntity` (dossier panel); warrant → navigate; others → popup. ✓
