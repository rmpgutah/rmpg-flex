# Mapbox Dead Hook Cleanup (Part 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete 9 confirmed-dead files (8 `useMapbox*.ts` hooks + 1 component) left over from an abandoned first-pass Mapbox integration, each superseded by a live, currently-mounted equivalent.

**Architecture:** Pure deletion — no file imports any of these 9 (verified by exact function/component-name grep across `client/src`, not just filename, to rule out re-export indirection). Zero behavior change. This plan's only real risk is a stale import somewhere the audit missed, which typecheck + build catch immediately.

**Tech Stack:** TypeScript, Vite (client build).

**Reference spec:** [docs/superpowers/specs/2026-07-03-mapbox-second-integration-cleanup-design.md](../specs/2026-07-03-mapbox-second-integration-cleanup-design.md), Part 1.

---

## File Structure

Only deletions — no new files, no modifications to surviving files.

| Delete | Confirmed live replacement |
|---|---|
| `client/src/hooks/useMapboxTraffic.ts` | `client/src/hooks/useMapTraffic.ts` |
| `client/src/hooks/useMapboxHeatmap.ts` | `client/src/hooks/useMapHeatmap.ts` |
| `client/src/hooks/useMapboxMapMatching.ts` | `client/src/hooks/useMapMatchTrace.ts` |
| `client/src/hooks/useMapboxIsochrone.ts` | inline `mapboxApiService.mapboxIsochrone()` in `MapboxMapPage.tsx` |
| `client/src/hooks/useMapboxMatrix.ts` | inline `mapboxApiService.findNearestUnits()` in `MapboxMapPage.tsx` |
| `client/src/hooks/useMapboxStaticMap.ts` | `client/src/hooks/useMapSnapshot.ts` |
| `client/src/hooks/useMapboxRoutes.ts` | `client/src/hooks/useMapRouting.ts` |
| `client/src/hooks/useMapboxGeocode.ts` | inline `MapboxGeocoder` plugin in `MapboxMapPage.tsx` |
| `client/src/components/MapboxAddressAutofill.tsx` | `client/src/components/AddressAutocomplete.tsx` |

**Explicitly NOT touched in this plan** (verified live/intentional — do not delete): `useMapboxBoundaries.ts`, `useMapboxSearchBox.ts`, `useMapboxDraw.ts`, `useMapboxTilequery.ts`, `useMapboxIncidents.ts`, `useMapboxCoverageGaps.ts`, `useMapboxSafetyZones.ts`, `useMapboxHistoryCalls.ts`, `useMapboxRepeatAddresses.ts` — the last 6 are wired up in the companion "Mapbox Real Gaps" plan.

---

### Task 1: Re-verify zero importers immediately before deleting

**Files:** none (verification only) — this re-confirms the spec's audit hasn't gone stale since it was written, since this plan may run after other changes land.

- [ ] **Step 1: Run the verification grep**

Run this from the repo root:

```bash
cd client/src
for h in useMapboxTraffic useMapboxHeatmap useMapboxMapMatching useMapboxIsochrone useMapboxMatrix useMapboxStaticMap useMapboxRoutes useMapboxGeocode; do
  echo "=== $h ==="
  grep -rn "$h" --include="*.tsx" --include="*.ts" . | grep -v "^./hooks/$h.ts"
done
echo "=== MapboxAddressAutofill ==="
grep -rl "MapboxAddressAutofill" --include="*.tsx" | grep -v "components/MapboxAddressAutofill.tsx"
```

Expected: every hook's grep shows only its own file's internal `export function`/`console.warn` lines (no external importers); `MapboxAddressAutofill` grep shows no results at all.

- [ ] **Step 2: If any importer DOES show up**

Stop — do not delete that file. Note which file imports it and report back before continuing; the spec's audit may be stale (something changed since 2026-07-03) or this indicates a real regression risk. Re-run the rest of this plan only for files confirmed still-zero-importer.

---

### Task 2: Delete the 8 dead hooks

**Files:**
- Delete: `client/src/hooks/useMapboxTraffic.ts`
- Delete: `client/src/hooks/useMapboxHeatmap.ts`
- Delete: `client/src/hooks/useMapboxMapMatching.ts`
- Delete: `client/src/hooks/useMapboxIsochrone.ts`
- Delete: `client/src/hooks/useMapboxMatrix.ts`
- Delete: `client/src/hooks/useMapboxStaticMap.ts`
- Delete: `client/src/hooks/useMapboxRoutes.ts`
- Delete: `client/src/hooks/useMapboxGeocode.ts`

- [ ] **Step 1: Delete all 8 files**

```bash
cd client/src/hooks
git rm useMapboxTraffic.ts useMapboxHeatmap.ts useMapboxMapMatching.ts \
       useMapboxIsochrone.ts useMapboxMatrix.ts useMapboxStaticMap.ts \
       useMapboxRoutes.ts useMapboxGeocode.ts
```

- [ ] **Step 2: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: PASS — no "cannot find module" errors. If any appear, Task 1's verification missed a real importer; restore the specific file with `git checkout -- <path>` and investigate before re-deleting.

- [ ] **Step 3: Commit**

```bash
git commit -m "chore(mapbox): delete 8 dead useMapbox* hooks superseded by useMap*/mapboxApiService"
```

---

### Task 3: Delete the dead `MapboxAddressAutofill.tsx` component

**Files:**
- Delete: `client/src/components/MapboxAddressAutofill.tsx`

- [ ] **Step 1: Delete the file**

```bash
git rm client/src/components/MapboxAddressAutofill.tsx
```

- [ ] **Step 2: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git commit -m "chore(mapbox): delete unused MapboxAddressAutofill.tsx (zero importers, superseded by AddressAutocomplete.tsx)"
```

---

### Task 4: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Full client typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 2: Full client test suite**

Run: `cd client && npx vitest run`
Expected: PASS — same pass count as before this plan (no tests reference the deleted files, confirmed in the spec).

- [ ] **Step 3: Full client build**

Run: `cd client && npx vite build`
Expected: PASS — build succeeds, confirming no dynamic import or lazy-loaded reference to any deleted file either (typecheck alone doesn't catch a runtime-only `import()` string, but Vite's build does resolve those).
