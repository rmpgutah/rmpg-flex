# Geography Naming Consistency + Beat Descriptor Duplicate-Label Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the system-wide beat-name duplicate-label bug ("Midvale A-1 — Midvale A-1"), rename the Sector/Zone tiers everywhere they're mislabeled "Section"/"City" in the map-overlay layer, and remove a numeric/string ID-field ambiguity in the `/dispatch/districts` endpoint.

**Architecture:** A new `client/src/utils/geographyLabels.ts` becomes the single source of truth for tier labels, tier colors, and beat-label formatting — both the live `SectorZoneBeatPicker` dropdown and the (currently unmounted) map hierarchy/choropleth/what's-here hooks import from it instead of each reimplementing the same logic. A new D1 migration nulls out the duplicate `beat_descriptor` data at the source. The `/dispatch/districts` endpoint gets one additive field (no breaking changes) plus a documenting comment.

**Tech Stack:** Cloudflare D1 (migration), Hono route (`src/routes/dispatch/geography.ts`), React hooks (`client/src/hooks/`), Vitest.

**Spec:** [docs/superpowers/specs/2026-07-07-geography-naming-and-beat-descriptor-fix-design.md](../specs/2026-07-07-geography-naming-and-beat-descriptor-fix-design.md)

---

## File Structure

| File | Change |
|---|---|
| `client/src/utils/geographyLabels.ts` | **Create.** `TIER_LABELS`, `getSectorColor`, `getZoneColor`, `formatBeatLabel` — single source of truth for Parts 1 and 2 of the spec. |
| `client/src/utils/__tests__/geographyLabels.test.ts` | **Create.** Unit tests for `formatBeatLabel` (the regression test for the duplicate bug) and the color helpers. |
| `migrations/0177_null_duplicate_beat_descriptor.sql` | **Create.** Nulls `beat_descriptor` where it duplicates `beat_name`. |
| `client/src/hooks/useDistrictLookup.ts` | **Modify** line 168 — use `formatBeatLabel` instead of inline duplicate-prone concatenation. |
| `client/src/hooks/useGeoJsonLayers.ts` | **Modify** — remove `SECTION_COLORS`/`getSectionColor`/`CITY_COLORS`/`getCityColor` (now in `geographyLabels.ts`), use `formatBeatLabel` in the beat popup, fix "Section:" → "Sector:" label. |
| `client/src/pages/map/utils/districtGeoData.ts` | **Modify** — `_section`/`_sectionName`/`_sectionColor` → `_sector`/`_sectorName`/`_sectorColor`; import color helpers from `geographyLabels.ts`. |
| `client/src/hooks/useDistrictHierarchyLayers.ts` | **Modify** — `HierarchyLevelId`, `HIERARCHY_CONFIGS`, `FIELD` map, popup label: `section` → `sector`. |
| `client/src/hooks/useActivityChoropleth.ts` | **Modify** — `ChoroLevel`, `LEVEL_PROP`: `section` → `sector`. |
| `client/src/hooks/useWhatsHere.ts` | **Modify** — `_sectionName`/`_sectionColor` → `_sectorName`/`_sectorColor`, "Section" label → "Sector". |
| `client/src/pages/map/components/UnifiedMapLegend.tsx` | **Modify** — `hierarchy.section` → `hierarchy.sector`, `HSWATCH`, `geoLevels` array. |
| `src/utils/districtResolver.ts` | **Modify** line 28 — fix stray "Area › Section › Zone › Beat" comment. |
| `src/routes/dispatch/geography.ts` | **Modify** `/districts` route — add `sector_db_id`, add documenting comment. |

**Note on scope:** `useDistrictHierarchyLayers.ts`, `useActivityChoropleth.ts`, `useWhatsHere.ts`, and `UnifiedMapLegend.tsx` are currently unmounted (verified via grep — no importer anywhere in `client/src` renders them), part of the orphaned map-panel set tracked in `client/src/pages/map/_ORPHANS.md`. Fixing their naming now is cheap and prevents the bug resurfacing when they're eventually wired in, but changes to them won't be visible in the running app today. `useDistrictLookup.ts` and `useGeoJsonLayers.ts` (Task 3, Task 4) ARE live — verified via grep that `SectorZoneBeatPicker` (which uses `useDistrictLookup`) is mounted in `PropertyFormModal.tsx` and `CitationsPage.tsx`, and `useGeoJsonLayers` is mounted in `MapboxMapPage.tsx`.

---

### Task 1: `geographyLabels.ts` — tier labels, colors, and beat-label formatting

**Files:**
- Create: `client/src/utils/geographyLabels.ts`
- Test: `client/src/utils/__tests__/geographyLabels.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// client/src/utils/__tests__/geographyLabels.test.ts
import { describe, it, expect } from 'vitest';
import { TIER_LABELS, getSectorColor, getZoneColor, formatBeatLabel } from '../geographyLabels';

describe('TIER_LABELS', () => {
  it('uses the DB-canonical tier names, not Section/City', () => {
    expect(TIER_LABELS).toEqual({ area: 'Area', sector: 'Sector', zone: 'Zone', beat: 'Beat' });
  });
});

// Regression test: migrations/0012_seed_geography.sql seeded beat_descriptor
// as an exact copy of beat_name for all 719 beats, so every beat rendered as
// "Midvale A-1 — Midvale A-1" wherever this concatenation ran unguarded.
describe('formatBeatLabel', () => {
  it('does not append a descriptor identical to the name', () => {
    expect(formatBeatLabel('Midvale A-1', 'Midvale A-1')).toBe('Midvale A-1');
  });

  it('appends a descriptor that differs from the name', () => {
    expect(formatBeatLabel('Midvale A-1', 'Downtown corridor')).toBe('Midvale A-1 — Downtown corridor');
  });

  it('does not append when descriptor is null', () => {
    expect(formatBeatLabel('Midvale A-1', null)).toBe('Midvale A-1');
  });

  it('does not append when descriptor is undefined', () => {
    expect(formatBeatLabel('Midvale A-1', undefined)).toBe('Midvale A-1');
  });

  it('does not append when descriptor is an empty string', () => {
    expect(formatBeatLabel('Midvale A-1', '')).toBe('Midvale A-1');
  });
});

describe('getSectorColor', () => {
  it('returns the mapped color for a known sector code', () => {
    expect(getSectorColor('SL1')).toBe('#22c55e');
  });

  it('returns a deterministic fallback color for an unknown code', () => {
    expect(getSectorColor('ZZ9')).toBe(getSectorColor('ZZ9'));
  });

  it('returns a fallback for an empty code without throwing', () => {
    expect(typeof getSectorColor('')).toBe('string');
  });
});

describe('getZoneColor', () => {
  it('returns a deterministic color for a given zone code', () => {
    expect(getZoneColor('MID')).toBe(getZoneColor('MID'));
  });

  it('returns a non-empty string for an empty code without throwing', () => {
    expect(typeof getZoneColor('')).toBe('string');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/utils/__tests__/geographyLabels.test.ts`
Expected: FAIL with `Cannot find module '../geographyLabels'` (module doesn't exist yet).

- [ ] **Step 3: Write the implementation**

```typescript
// client/src/utils/geographyLabels.ts
// ============================================================
// RMPG Flex — Canonical geography tier labels, colors, and label formatting
// ============================================================
// Single source of truth for how the Area/Sector/Zone/Beat hierarchy is
// labeled, colored, and formatted for display across the app. Sector and
// Zone were previously reimplemented independently as "Section"/"City" in
// the map-overlay layer, and the beat name/descriptor concatenation was
// duplicated in two places (one of which rendered every beat twice — see
// docs/superpowers/specs/2026-07-07-geography-naming-and-beat-descriptor-fix-design.md).
// Import from here instead of reimplementing.
// ============================================================

export const TIER_LABELS = {
  area: 'Area',
  sector: 'Sector',
  zone: 'Zone',
  beat: 'Beat',
} as const;

export type GeographyTier = keyof typeof TIER_LABELS;

const SECTOR_COLORS: Record<string, string> = {
  SL1: '#22c55e', SL2: '#d4a017', SL3: '#a855f7', SL4: '#f59e0b', SL5: '#ef4444', SL6: '#fbbf24',
  DV1: '#ec4899', DV2: '#14b8a6', DV3: '#f97316',
  WB1: '#8b5cf6', WB2: '#10b981',
  UC1: '#facc15', UC2: '#eab308', UC3: '#f43f5e',
};
const SECTOR_COLOR_FALLBACKS = ['#fb923c', '#d946ef', '#84cc16', '#facc15', '#e11d48', '#14b8a6', '#f59e0b', '#8b5cf6'];

export function getSectorColor(sectorId: string): string {
  if (!sectorId) return SECTOR_COLOR_FALLBACKS[0];
  if (SECTOR_COLORS[sectorId]) return SECTOR_COLORS[sectorId];
  let hash = 0;
  for (let i = 0; i < sectorId.length; i++) hash = ((hash << 5) - hash + sectorId.charCodeAt(i)) | 0;
  return SECTOR_COLOR_FALLBACKS[Math.abs(hash) % SECTOR_COLOR_FALLBACKS.length];
}

const ZONE_COLORS = [
  '#4ade80', '#60a5fa', '#f87171', '#fbbf24', '#c084fc', '#f472b6',
  '#2dd4bf', '#fb923c', '#a78bfa', '#34d399', '#22d3ee', '#fb7185',
  '#a3e635', '#818cf8', '#e879f9', '#38bdf8', '#fde047', '#fdba74',
  '#5eead4', '#f9a8d4', '#bef264', '#93c5fd', '#fcd34d', '#7dd3fc',
];

export function getZoneColor(zoneCode: string): string {
  let hash = 0;
  for (let i = 0; i < zoneCode.length; i++) hash = ((hash << 5) - hash + zoneCode.charCodeAt(i)) | 0;
  return ZONE_COLORS[Math.abs(hash) % ZONE_COLORS.length];
}

/**
 * Beat display label: name, plus " — descriptor" only when the descriptor
 * carries information the name doesn't already have. migrations/0012 seeded
 * beat_descriptor as an exact copy of beat_name for all 719 beats, so this
 * guard is required — without it every beat renders as "X — X".
 */
export function formatBeatLabel(beatName: string, beatDescriptor?: string | null): string {
  if (beatDescriptor && beatDescriptor !== beatName) return `${beatName} — ${beatDescriptor}`;
  return beatName;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/utils/__tests__/geographyLabels.test.ts`
Expected: PASS (13 tests).

- [ ] **Step 5: Commit**

```bash
git add client/src/utils/geographyLabels.ts client/src/utils/__tests__/geographyLabels.test.ts
git commit -m "feat(map): add geographyLabels — canonical tier labels/colors/beat formatting"
```

---

### Task 2: Migration — null duplicate `beat_descriptor` data

**Files:**
- Create: `migrations/0177_null_duplicate_beat_descriptor.sql`

- [ ] **Step 1: Write the migration**

```sql
-- migrations/0177_null_duplicate_beat_descriptor.sql
-- migrations/0012_seed_geography.sql seeded beat_descriptor as an exact copy
-- of beat_name for all 719 beats. Null it out so a real descriptor can be
-- added later without a guard, and so any UI that skips the empty-string
-- check on legacy data no longer shows "Midvale A-1 — Midvale A-1". Safe to
-- re-run: the WHERE clause matches nothing on a second run.
UPDATE dispatch_beats SET beat_descriptor = NULL WHERE beat_descriptor = beat_name;
```

- [ ] **Step 2: Apply locally and verify**

Run: `npm run migrate:local`
Expected: no errors; migration `0177_null_duplicate_beat_descriptor.sql` listed as applied.

Run: `npx wrangler d1 execute rmpg-flex --local --command "SELECT beat_code, beat_name, beat_descriptor FROM dispatch_beats WHERE beat_code = 'MID/A1'"`
Expected: `beat_descriptor` is `NULL` for beat `MID/A1`.

Run: `npx wrangler d1 execute rmpg-flex --local --command "SELECT COUNT(*) as remaining FROM dispatch_beats WHERE beat_descriptor = beat_name"`
Expected: `remaining` = 0.

- [ ] **Step 3: Commit**

```bash
git add migrations/0177_null_duplicate_beat_descriptor.sql
git commit -m "fix(geography): null out beat_descriptor duplicating beat_name (719 rows)"
```

---

### Task 3: Wire `formatBeatLabel` into `useDistrictLookup.ts` (live — `SectorZoneBeatPicker`)

**Files:**
- Modify: `client/src/hooks/useDistrictLookup.ts:168`

- [ ] **Step 1: Make the change**

In `client/src/hooks/useDistrictLookup.ts`, add the import at the top (after the existing `apiFetch` import on line 8):

```typescript
import { formatBeatLabel } from '../utils/geographyLabels';
```

Replace line 168:

```typescript
      m.set(`${d.zone_id}:${d.beat_id}`, `${d.beat_name}${d.beat_descriptor ? ' — ' + d.beat_descriptor : ''}`);
```

with:

```typescript
      m.set(`${d.zone_id}:${d.beat_id}`, formatBeatLabel(d.beat_name, d.beat_descriptor));
```

- [ ] **Step 2: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/hooks/useDistrictLookup.ts
git commit -m "fix(map): use formatBeatLabel in useDistrictLookup to stop duplicate beat labels"
```

---

### Task 4: Wire `formatBeatLabel` + shared colors into `useGeoJsonLayers.ts` (live — beat popup)

**Files:**
- Modify: `client/src/hooks/useGeoJsonLayers.ts`

- [ ] **Step 1: Replace the color helpers with imports from `geographyLabels.ts`**

Add the import near the top of `client/src/hooks/useGeoJsonLayers.ts` (after the existing `mapboxSafeLayer` import on line 14):

```typescript
import { getSectorColor, getZoneColor, formatBeatLabel } from '../utils/geographyLabels';
```

Delete lines 142–169 (the `SECTION_COLORS`, `SECTION_COLOR_FALLBACKS`, `getSectionColor`, `CITY_COLORS`, `getCityColor` definitions) — the block from:

```typescript
export const SECTION_COLORS: Record<string, string> = {
```

through:

```typescript
export function getCityColor(cityCode: string): string {
  let hash = 0;
  for (let i = 0; i < cityCode.length; i++) hash = ((hash << 5) - hash + cityCode.charCodeAt(i)) | 0;
  return CITY_COLORS[Math.abs(hash) % CITY_COLORS.length];
}
```

- [ ] **Step 2: Update the beat popup to use the shared helpers**

Replace this block (around line 495–501):

```typescript
          if (entry) {
            const sColor = getSectionColor(entry.sectionId);
            html += `<div style="font-weight:bold;font-size:13px;color:${sColor};margin-bottom:2px;letter-spacing:1px;">${escapeForHtml(entry.dispatchCode)}</div>`;
            html += `<div style="color:#fff;font-size:11px;margin-bottom:6px;border-bottom:1px solid #444;padding-bottom:4px;">${escapeForHtml(entry.beatName)}${entry.beatDescriptor ? ' — ' + escapeForHtml(entry.beatDescriptor) : ''}</div>`;
            html += `<div style="font-size:10px;color:#999;margin-top:2px;"><span style="color:${sColor};">Section:</span> <span style="color:#ddd;">${escapeForHtml(entry.sectionId)} — ${escapeForHtml(entry.sectionName)}</span></div>`;
            html += `<div style="font-size:10px;color:#999;margin-top:2px;"><span style="color:#bbb;">Zone:</span> <span style="color:#ddd;">${escapeForHtml(entry.zoneId)} — ${escapeForHtml(entry.zoneName)}</span></div>`;
            html += `<div style="font-size:10px;color:#999;margin-top:2px;"><span style="color:#bbb;">Beat:</span> <span style="color:#ddd;">${escapeForHtml(entry.beatId)}</span></div>`;
          } else {
```

with:

```typescript
          if (entry) {
            const sColor = getSectorColor(entry.sectionId);
            html += `<div style="font-weight:bold;font-size:13px;color:${sColor};margin-bottom:2px;letter-spacing:1px;">${escapeForHtml(entry.dispatchCode)}</div>`;
            html += `<div style="color:#fff;font-size:11px;margin-bottom:6px;border-bottom:1px solid #444;padding-bottom:4px;">${escapeForHtml(formatBeatLabel(entry.beatName, entry.beatDescriptor))}</div>`;
            html += `<div style="font-size:10px;color:#999;margin-top:2px;"><span style="color:${sColor};">Sector:</span> <span style="color:#ddd;">${escapeForHtml(entry.sectionId)} — ${escapeForHtml(entry.sectionName)}</span></div>`;
            html += `<div style="font-size:10px;color:#999;margin-top:2px;"><span style="color:#bbb;">Zone:</span> <span style="color:#ddd;">${escapeForHtml(entry.zoneId)} — ${escapeForHtml(entry.zoneName)}</span></div>`;
            html += `<div style="font-size:10px;color:#999;margin-top:2px;"><span style="color:#bbb;">Beat:</span> <span style="color:#ddd;">${escapeForHtml(entry.beatId)}</span></div>`;
          } else {
```

Note: `entry.sectionId`/`entry.sectionName` (the `BeatDistrictEntry` interface field names) are left unrenamed — see Task 6 note on why the wider `BeatDistrictEntry`/`lookupBeatDistrict` naming is out of scope for this plan. Only the *rendered label text* ("Section:" → "Sector:") and the *color function name* (`getSectionColor` → `getSectorColor`) change here.

- [ ] **Step 3: Find and update any other use of `getCityColor` in this file**

Run: `grep -n "getCityColor\|getSectionColor\|SECTION_COLORS\|CITY_COLORS" client/src/hooks/useGeoJsonLayers.ts`
Expected: no matches (all removed/replaced in Steps 1–2). If a match remains (e.g. in the zone-color paint expression elsewhere in the file), replace it with `getZoneColor` imported from `geographyLabels.ts`.

- [ ] **Step 4: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add client/src/hooks/useGeoJsonLayers.ts
git commit -m "fix(map): dedupe beat popup label + rename Section to Sector, consolidate color helpers"
```

---

### Task 5: Rename `_section*` → `_sector*` in `districtGeoData.ts`

**Files:**
- Modify: `client/src/pages/map/utils/districtGeoData.ts`

- [ ] **Step 1: Update the import**

Replace line 15:

```typescript
import { getCityColor, getSectionColor } from '../../../hooks/useGeoJsonLayers';
```

with:

```typescript
import { getZoneColor, getSectorColor } from '../../../utils/geographyLabels';
```

- [ ] **Step 2: Update the module header comment**

Replace lines 9–10:

```typescript
// `getTaggedBeats()` returns the 719 beat polygons with the full
// Area/Section/Zone hierarchy + display colors baked onto each feature's
```

with:

```typescript
// `getTaggedBeats()` returns the 719 beat polygons with the full
// Area/Sector/Zone hierarchy + display colors baked onto each feature's
```

- [ ] **Step 3: Rename the `TaggedBeatProps` interface fields**

Replace (line 96):

```typescript
  _section: string; _sectionName: string; _sectionColor: string;
```

with:

```typescript
  _sector: string; _sectorName: string; _sectorColor: string;
```

- [ ] **Step 4: Rename the properties in `getTaggedBeats()`**

Replace this block (the body of the `.map()` callback, roughly lines 125–160):

```typescript
        const zone = zoneCode || 'UNK';
        const section = info.sectorId || 'UNASSIGNED';
        const area = info.areaCode || 'UNASSIGNED';
        const zoneName = uninc
          ? unincorporatedZoneName(p, info.sectorName)
          : (info.zoneName || p.city || cityCode || '—');
        return {
          ...f,
          properties: {
            ...p,
            _uninc: uninc,
            _zone: zone,
            _zoneName: zoneName,
            _zoneColor: getCityColor(zone),
            _section: section,
            _sectionName: info.sectorName || (section === 'UNASSIGNED' ? 'Unassigned' : section),
            _sectionColor: getSectionColor(section),
            _area: area,
            _areaName: info.areaName || (area === 'UNASSIGNED' ? 'Unassigned' : area),
            _areaColor: getAreaColor(area),
          },
        };
```

with:

```typescript
        const zone = zoneCode || 'UNK';
        const sector = info.sectorId || 'UNASSIGNED';
        const area = info.areaCode || 'UNASSIGNED';
        const zoneName = uninc
          ? unincorporatedZoneName(p, info.sectorName)
          : (info.zoneName || p.city || cityCode || '—');
        return {
          ...f,
          properties: {
            ...p,
            _uninc: uninc,
            _zone: zone,
            _zoneName: zoneName,
            _zoneColor: getZoneColor(zone),
            _sector: sector,
            _sectorName: info.sectorName || (sector === 'UNASSIGNED' ? 'Unassigned' : sector),
            _sectorColor: getSectorColor(sector),
            _area: area,
            _areaName: info.areaName || (area === 'UNASSIGNED' ? 'Unassigned' : area),
            _areaColor: getAreaColor(area),
          },
        };
```

- [ ] **Step 5: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: errors pointing at every remaining `_section`/`getCityColor`/`getSectionColor` reference in downstream consumers (`useDistrictHierarchyLayers.ts`, `useActivityChoropleth.ts`, `useWhatsHere.ts`) — these are fixed in Tasks 6–8. If Task 5 is executed standalone, this is expected; do not attempt to fix downstream files here.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/map/utils/districtGeoData.ts
git commit -m "refactor(map): rename _section* to _sector* in tagged beat properties"
```

---

### Task 6: Rename `section` → `sector` in `useDistrictHierarchyLayers.ts`

**Files:**
- Modify: `client/src/hooks/useDistrictHierarchyLayers.ts`

- [ ] **Step 1: Update the module header comment**

Replace lines 1–2:

```typescript
// ============================================================
// RMPG Flex — District Hierarchy Layer Manager (Area/Section/Zone)
```

with:

```typescript
// ============================================================
// RMPG Flex — District Hierarchy Layer Manager (Area/Sector/Zone)
```

- [ ] **Step 2: Rename the type and configs**

Replace lines 24–37:

```typescript
export type HierarchyLevelId = 'area' | 'section' | 'zone';

export interface HierarchyLayerConfig {
  id: HierarchyLevelId;
  label: string;
  description: string;
  minzoom: number;
}

export const HIERARCHY_CONFIGS: HierarchyLayerConfig[] = [
  { id: 'area', label: 'Area', description: 'Top-level patrol areas', minzoom: 7 },
  { id: 'section', label: 'Section', description: 'Spillman sections (SL1, DV1…)', minzoom: 8 },
  { id: 'zone', label: 'Zone', description: 'Zones / communities', minzoom: 9 },
];

// Per-level feature-property names baked onto each beat at tag time.
const FIELD: Record<HierarchyLevelId, { key: string; name: string; color: string }> = {
  area: { key: '_area', name: '_areaName', color: '_areaColor' },
  section: { key: '_section', name: '_sectionName', color: '_sectionColor' },
  zone: { key: '_zone', name: '_zoneName', color: '_zoneColor' },
};
```

with:

```typescript
export type HierarchyLevelId = 'area' | 'sector' | 'zone';

export interface HierarchyLayerConfig {
  id: HierarchyLevelId;
  label: string;
  description: string;
  minzoom: number;
}

export const HIERARCHY_CONFIGS: HierarchyLayerConfig[] = [
  { id: 'area', label: 'Area', description: 'Top-level patrol areas', minzoom: 7 },
  { id: 'sector', label: 'Sector', description: 'Spillman sectors (SL1, DV1…)', minzoom: 8 },
  { id: 'zone', label: 'Zone', description: 'Zones / communities', minzoom: 9 },
];

// Per-level feature-property names baked onto each beat at tag time.
const FIELD: Record<HierarchyLevelId, { key: string; name: string; color: string }> = {
  area: { key: '_area', name: '_areaName', color: '_areaColor' },
  sector: { key: '_sector', name: '_sectorName', color: '_sectorColor' },
  zone: { key: '_zone', name: '_zoneName', color: '_zoneColor' },
};
```

- [ ] **Step 3: Fix the popup label**

Replace line 226:

```typescript
              + `<div style="font-size:10px;color:#999;margin-top:2px;"><span style="color:#bbb;">Section:</span> ${esc(String(p._sectionName || '—'))}</div>`
```

with:

```typescript
              + `<div style="font-size:10px;color:#999;margin-top:2px;"><span style="color:#bbb;">Sector:</span> ${esc(String(p._sectorName || '—'))}</div>`
```

- [ ] **Step 4: Update the "Area/Section/Zone" comment on line 12**

Replace:

```typescript
// The Area›Section›Zone›Beat mapping comes from
```

with:

```typescript
// The Area›Sector›Zone›Beat mapping comes from
```

- [ ] **Step 5: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no errors from this file (this hook has zero live importers, so nothing downstream depends on it — confirmed via `grep -rln "useDistrictHierarchyLayers" client/src`).

- [ ] **Step 6: Commit**

```bash
git add client/src/hooks/useDistrictHierarchyLayers.ts
git commit -m "refactor(map): rename Section to Sector in useDistrictHierarchyLayers"
```

---

### Task 7: Rename `section` → `sector` in `useActivityChoropleth.ts`

**Files:**
- Modify: `client/src/hooks/useActivityChoropleth.ts`

- [ ] **Step 1: Update the module header comment**

Replace line 5:

```typescript
// level (Beat / Zone / Section / Area). Each active call is binned into its
```

with:

```typescript
// level (Beat / Zone / Sector / Area). Each active call is binned into its
```

- [ ] **Step 2: Rename the type and level-property map**

Replace lines 17–18:

```typescript
export type ChoroLevel = 'beat' | 'zone' | 'section' | 'area';
const LEVEL_PROP: Record<ChoroLevel, string> = { beat: 'beat_id', zone: '_zone', section: '_section', area: '_area' };
```

with:

```typescript
export type ChoroLevel = 'beat' | 'zone' | 'sector' | 'area';
const LEVEL_PROP: Record<ChoroLevel, string> = { beat: 'beat_id', zone: '_zone', sector: '_sector', area: '_area' };
```

- [ ] **Step 3: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: an error in `client/src/pages/map/components/UnifiedMapLegend.tsx` (imports `ChoroLegend`/`ChoroLevel` — fixed in Task 9). If Task 7 is executed standalone before Task 9, this is expected.

- [ ] **Step 4: Commit**

```bash
git add client/src/hooks/useActivityChoropleth.ts
git commit -m "refactor(map): rename section to sector in useActivityChoropleth ChoroLevel"
```

---

### Task 8: Rename `_section*` → `_sector*` in `useWhatsHere.ts`

**Files:**
- Modify: `client/src/hooks/useWhatsHere.ts`

- [ ] **Step 1: Update the module header comment**

Replace line 5:

```typescript
// stack at that point in one popup: Area › Section › Zone › Beat (point-
```

with:

```typescript
// stack at that point in one popup: Area › Sector › Zone › Beat (point-
```

- [ ] **Step 2: Rename the property references and label**

Replace line 173:

```typescript
        baseRows.push({ label: 'Section', value: bp._sectionName || '—', color: bp._sectionColor });
```

with:

```typescript
        baseRows.push({ label: 'Sector', value: bp._sectorName || '—', color: bp._sectorColor });
```

- [ ] **Step 3: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no errors from this file.

- [ ] **Step 4: Commit**

```bash
git add client/src/hooks/useWhatsHere.ts
git commit -m "refactor(map): rename Section to Sector in useWhatsHere popup rows"
```

---

### Task 9: Rename `section` → `sector` in `UnifiedMapLegend.tsx`

**Files:**
- Modify: `client/src/pages/map/components/UnifiedMapLegend.tsx`

- [ ] **Step 1: Update the prop type and swatch map**

Replace line 16:

```typescript
  hierarchy: { area: boolean; section: boolean; zone: boolean; beat: boolean };
```

with:

```typescript
  hierarchy: { area: boolean; sector: boolean; zone: boolean; beat: boolean };
```

Replace line 20:

```typescript
  /** Categorical color list for the active Area/Section level (compact). */
```

with:

```typescript
  /** Categorical color list for the active Area/Sector level (compact). */
```

Replace line 29:

```typescript
const HSWATCH: Record<string, string> = { area: '#d4a017', section: '#f59e0b', zone: '#22c55e', beat: '#4ade80' };
```

with:

```typescript
const HSWATCH: Record<string, string> = { area: '#d4a017', sector: '#f59e0b', zone: '#22c55e', beat: '#4ade80' };
```

- [ ] **Step 2: Update the geo-levels array**

Replace line 49:

```typescript
    ['area', 'Area'], ['section', 'Section'], ['zone', 'Zone'], ['beat', 'Beat'],
```

with:

```typescript
    ['area', 'Area'], ['sector', 'Sector'], ['zone', 'Zone'], ['beat', 'Beat'],
```

- [ ] **Step 3: Update the categorical-key comment**

Replace line 88:

```typescript
              {/* Compact categorical key for Area/Section (few values). */}
```

with:

```typescript
              {/* Compact categorical key for Area/Sector (few values). */}
```

- [ ] **Step 4: Typecheck (full sweep of Parts 5–9)**

Run: `cd client && npx tsc --noEmit`
Expected: PASS with no errors — this is the last file in the `section`→`sector` rename chain (Tasks 5–9), so this confirms all downstream consumers are consistent.

Run: `grep -rn "_section\b\|_sectionName\|_sectionColor\|getSectionColor\|getCityColor\|'section'" client/src/hooks/useDistrictHierarchyLayers.ts client/src/hooks/useActivityChoropleth.ts client/src/hooks/useWhatsHere.ts client/src/pages/map/components/UnifiedMapLegend.tsx client/src/pages/map/utils/districtGeoData.ts client/src/hooks/useGeoJsonLayers.ts`
Expected: no matches (confirms the rename is complete across all six files).

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/map/components/UnifiedMapLegend.tsx
git commit -m "refactor(map): rename section to sector in UnifiedMapLegend"
```

---

### Task 10: Fix the stray "Section" comment in `districtResolver.ts`

**Files:**
- Modify: `src/utils/districtResolver.ts:28`

- [ ] **Step 1: Make the change**

Replace line 28:

```typescript
  // Area — top of the Area › Section › Zone › Beat hierarchy.
```

with:

```typescript
  // Area — top of the Area › Sector › Zone › Beat hierarchy.
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS (comment-only change).

- [ ] **Step 3: Commit**

```bash
git add src/utils/districtResolver.ts
git commit -m "docs(geography): fix stray Section reference in districtResolver comment"
```

---

### Task 11: `/dispatch/districts` — add `sector_db_id` + documenting comment

**Files:**
- Modify: `src/routes/dispatch/geography.ts:138-170`

- [ ] **Step 1: Make the change**

Replace lines 138–165:

```typescript
// GET /dispatch/districts
geography.get('/districts', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(db, `
      SELECT
        ds.id AS sector_id,
        ds.sector_code,
        ds.sector_name,
        ds.color AS sector_color,
        dz.id AS zone_db_id,
        dz.zone_code AS zone_id,
        dz.zone_name,
        db.id AS beat_db_id,
        db.beat_code AS beat_id,
        db.beat_name,
        db.beat_descriptor,
        db.dispatch_code,
        da.id AS area_id,
        da.area_name,
        da.area_code
      FROM dispatch_beats db
      JOIN dispatch_zones dz ON dz.id = db.zone_id
      JOIN dispatch_sectors ds ON ds.id = dz.sector_id
      JOIN dispatch_areas da ON da.id = ds.area_id
      WHERE db.active = 1 AND dz.active = 1 AND ds.active = 1
      ORDER BY da.sort_order, ds.sort_order, dz.sort_order, db.sort_order
    `);
    return c.json(rows);
  } catch (err) {
    return c.json({ error: 'Failed' }, 500);
  }
});
```

with:

```typescript
// GET /dispatch/districts
//
// Field-naming note: `sector_id`/`area_id` are the numeric dispatch_sectors.id
// / dispatch_areas.id row keys. `zone_id`/`beat_id` are NOT numeric row keys —
// they're the human-readable zone_code/beat_code strings. Their numeric PKs
// are separately exposed as `zone_db_id`/`beat_db_id`/`sector_db_id`. This
// asymmetry (same `_id` suffix, different semantics per field) already caused
// one production crash from a consumer assuming all four were the same kind
// of value (see client/src/hooks/useDistrictLookup.ts's normalizeSectorId).
// Existing consumers depend on this exact shape — do not rename sector_id/
// zone_id/beat_id without auditing every consumer first.
geography.get('/districts', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(db, `
      SELECT
        ds.id AS sector_id,
        ds.id AS sector_db_id,
        ds.sector_code,
        ds.sector_name,
        ds.color AS sector_color,
        dz.id AS zone_db_id,
        dz.zone_code AS zone_id,
        dz.zone_name,
        db.id AS beat_db_id,
        db.beat_code AS beat_id,
        db.beat_name,
        db.beat_descriptor,
        db.dispatch_code,
        da.id AS area_id,
        da.area_name,
        da.area_code
      FROM dispatch_beats db
      JOIN dispatch_zones dz ON dz.id = db.zone_id
      JOIN dispatch_sectors ds ON ds.id = dz.sector_id
      JOIN dispatch_areas da ON da.id = ds.area_id
      WHERE db.active = 1 AND dz.active = 1 AND ds.active = 1
      ORDER BY da.sort_order, ds.sort_order, dz.sort_order, db.sort_order
    `);
    return c.json(rows);
  } catch (err) {
    return c.json({ error: 'Failed' }, 500);
  }
});
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Verify locally**

Run: `npm run dev` (in one terminal), then in another:
Run: `curl -s http://localhost:8787/api/dispatch/districts | head -c 500`
Expected: JSON array where the first row includes both `"sector_id"` and `"sector_db_id"` with the same numeric value.

- [ ] **Step 4: Commit**

```bash
git add src/routes/dispatch/geography.ts
git commit -m "feat(geography): add sector_db_id to /dispatch/districts + document ID-field semantics"
```

---

### Task 12: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full Worker typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 2: Run the full client typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: PASS (0 errors introduced by this work — CLAUDE.md notes there are pre-existing unrelated errors in the client; confirm the count matches the pre-existing baseline, not higher).

- [ ] **Step 3: Run the full client test suite**

Run: `cd client && npx vitest run`
Expected: PASS, including the 13 new `geographyLabels.test.ts` tests.

- [ ] **Step 4: Run the full Worker test suite**

Run: `npx vitest run`
Expected: PASS (no Worker-side tests were added or should be broken by this change).

- [ ] **Step 5: Browser-verify the live fix (beat-descriptor duplicate)**

Start the client dev server and open a page that mounts `SectorZoneBeatPicker` (e.g. `CitationsPage.tsx` or a property record's `PropertyFormModal`). Open the Beat dropdown for zone "MID" (Midvale) and confirm beat "A1" reads `"MID/A1 — Midvale A-1"` (code — name once), not `"MID/A1 — Midvale A-1 — Midvale A-1"` or `"Midvale A-1 — Midvale A-1"`.

- [ ] **Step 6: Confirm migration 0177 is queued for live application**

Per CLAUDE.md's migration process: after this branch merges to `main` and `deploy.yml` runs (`continue-on-error: true` on the migration step), apply directly and verify:

```bash
scripts/apply-migration.sh 0177_null_duplicate_beat_descriptor.sql
npx wrangler d1 execute rmpg-flex --remote --command "SELECT COUNT(*) as remaining FROM dispatch_beats WHERE beat_descriptor = beat_name"
```

Expected: `remaining` = 0. **Do not run this against remote D1 during plan execution** — it happens post-merge per the project's PR-flow convention ([[feedback-use-pr-flow-not-direct-push]]).

---

## Self-Review Notes

- **Spec coverage:** Part 1 (beat descriptor) → Tasks 1–4. Part 2 (Sector/Zone naming) → Tasks 1, 5–9. Part 3 (ID aliasing) → Task 11. Testing section → Tasks 1 (unit), 12 (typecheck/suite/browser). All three spec sections have a task.
- **Placeholder scan:** no TBD/TODO; every step shows exact before/after code or an exact command with expected output.
- **Type consistency:** `formatBeatLabel(beatName: string, beatDescriptor?: string | null)` signature is defined once in Task 1 and used identically in Tasks 3 and 4. `getSectorColor`/`getZoneColor` signatures likewise defined once and reused. `HierarchyLevelId`, `ChoroLevel`, and the `hierarchy` prop shape are each renamed exactly once in their owning file (Tasks 6, 7, 9) with no divergent spelling.
