# Map Tab Small Fixes Bundle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close out four small, previously-identified-but-unfixed Map-tab gaps: a z-index outlier, a missed hardcoded-hex spot, missing error surfacing on the Tilequery identify hook, and an untracked orphaned hook.

**Architecture:** Four independent, small edits across 3 files — no shared state, no new components, no new dependencies. Each task stands alone.

**Tech Stack:** React 18 + TypeScript, existing hook/dock patterns already in the codebase.

## Global Constraints

- No other hardcoded-hex cleanup beyond the one specific Ruler-icon spot named in this plan — the ~57 other hardcoded hex values in `MapboxMapPage.tsx`'s dock arrays are explicitly out of scope.
- No wiring-in of `useMapboxSearchBox.ts` itself — this plan only adds it to the orphan tracker.
- No retry/backoff logic added anywhere in this plan.
- `useMapboxTilequery.ts`'s new `error` state follows the identical pattern used in the prior hook-error-surfacing round: cleared at query start, set in catch alongside the existing `console.warn`, returned from the hook.

---

### Task 1: `UnifiedMapLegend.tsx` z-index fix

**Files:**
- Modify: `client/src/pages/map/components/UnifiedMapLegend.tsx:62`

**Interfaces:**
- None — pure class-name swap, no signature changes.

- [ ] **Step 1: Change the z-index class**

Change:
```tsx
      className="absolute z-[900] backdrop-blur-md"
```
to:
```tsx
      className="absolute z-40 backdrop-blur-md"
```

- [ ] **Step 2: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no new errors (this is a JSX className string, not typed).

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/map/components/UnifiedMapLegend.tsx
git commit -m "fix(map): renumber UnifiedMapLegend z-index into the standard z-40 tier"
```

---

### Task 2: Measurement Result Banner hex fix

**Files:**
- Modify: `client/src/pages/map/MapboxMapPage.tsx:1459`

**Interfaces:**
- None — pure class-name swap.

- [ ] **Step 1: Change the Ruler icon's color class**

Change:
```tsx
          <Ruler className="w-3.5 h-3.5 text-[#3b82f6]" />
```
to:
```tsx
          <Ruler className="w-3.5 h-3.5 text-brand-gold-500" />
```

- [ ] **Step 2: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/map/MapboxMapPage.tsx
git commit -m "fix(map): de-hex the Measurement Result Banner's Ruler icon"
```

---

### Task 3: `useMapboxTilequery.ts` error surfacing + Identify handler wiring

**Files:**
- Modify: `client/src/hooks/useMapboxTilequery.ts`
- Modify: `client/src/pages/map/MapboxMapPage.tsx:449-453`

**Interfaces:**
- Produces: `useMapboxTilequery(map)` now returns `error: string | null` alongside `pointInfo`/`loading`/`query`/`queryFromMapClick` — consumed by the Identify click handler in `MapboxMapPage.tsx`.

- [ ] **Step 1: Add `error` state to `useMapboxTilequery.ts`**

Change:
```ts
export function useMapboxTilequery(map: mapboxgl.Map | null) {
  const [pointInfo, setPointInfo] = useState<PointDistrictInfo | null>(null);
  const [loading, setLoading] = useState(false);

  const query = useCallback(async (
    lng: number,
    lat: number,
    radius = 50,
    layers?: string[],
  ) => {
    setLoading(true);
    try {
```
to:
```ts
export function useMapboxTilequery(map: mapboxgl.Map | null) {
  const [pointInfo, setPointInfo] = useState<PointDistrictInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const query = useCallback(async (
    lng: number,
    lat: number,
    radius = 50,
    layers?: string[],
  ) => {
    setLoading(true);
    setError(null);
    try {
```

- [ ] **Step 2: Set `error` in the catch block**

Change:
```ts
      setPointInfo(info);
      return info;
    } catch (err) {
      console.warn('[useMapboxTilequery] query failed:', err);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);
```
to:
```ts
      setPointInfo(info);
      return info;
    } catch (err: any) {
      console.warn('[useMapboxTilequery] query failed:', err);
      setError(err?.message || 'Failed to identify point');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);
```

- [ ] **Step 3: Return `error` from the hook**

Change:
```ts
  return { pointInfo, loading, query, queryFromMapClick };
}
```
to:
```ts
  return { pointInfo, loading, error, query, queryFromMapClick };
}
```

- [ ] **Step 4: Typecheck the hook change in isolation**

Run: `cd client && npx tsc --noEmit`
Expected: no new errors (the return-object addition is backward-compatible; existing destructuring in `MapboxMapPage.tsx` that doesn't request `error` still works).

- [ ] **Step 5: Wire the error into the Identify click handler**

In `client/src/pages/map/MapboxMapPage.tsx`, change:
```tsx
    const handler = async (e: mapboxgl.MapMouseEvent) => {
      const info = await tilequery.queryFromMapClick(e);
      if (identifyPopupRef.current) { identifyPopupRef.current.remove(); identifyPopupRef.current = null; }
      infoPanel.showLocationInfo(e.lngLat.lng, e.lngLat.lat);
      if (!info) return;
```
to:
```tsx
    const handler = async (e: mapboxgl.MapMouseEvent) => {
      const info = await tilequery.queryFromMapClick(e);
      if (identifyPopupRef.current) { identifyPopupRef.current.remove(); identifyPopupRef.current = null; }
      infoPanel.showLocationInfo(e.lngLat.lng, e.lngLat.lat);
      if (!info) {
        if (tilequery.error) {
          identifyPopupRef.current = new mapboxgl.Popup({ closeButton: true, closeOnClick: false, className: 'mapbox-popup-dark' })
            .setLngLat(e.lngLat)
            .setHTML(`<div style="font:11px monospace;color:#f87171;background:#0a0a0a;padding:4px 6px;">${tilequery.error}</div>`)
            .addTo(map);
        }
        return;
      }
```

Note: `info` being `null` with `tilequery.error` unset (the normal "no features at this point" case) still falls through to the plain `return;` with no popup, exactly as before — only a genuine fetch failure now shows a popup.

- [ ] **Step 6: Typecheck the full change**

Run: `cd client && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 7: Commit**

```bash
git add client/src/hooks/useMapboxTilequery.ts client/src/pages/map/MapboxMapPage.tsx
git commit -m "feat(map): surface fetch errors from Tilequery identify hook"
```

---

### Task 4: `useMapboxSearchBox.ts` orphan tracking

**Files:**
- Modify: `client/src/pages/map/_ORPHANS.md`

**Interfaces:**
- None — documentation-only change.

- [ ] **Step 1: Add the orphan-hook table row**

In `client/src/pages/map/_ORPHANS.md`, find the "Orphan hooks" table:
```markdown
## Orphan hooks (`hooks/`)

| Hook | Likely intent |
|------|---------------|
| `useMapCallHistory` | History query for a clicked location |
```

Change it to (new row inserted as the first data row, since `useMapboxSearchBox` sorts alphabetically before `useMapCallHistory` — `useMapb` < `useMapC`):
```markdown
## Orphan hooks (`hooks/`)

| Hook | Likely intent |
|------|---------------|
| `useMapboxSearchBox` | Headless programmatic search (wraps Mapbox Search Box), never mounted anywhere |
| `useMapCallHistory` | History query for a clicked location |
```

- [ ] **Step 2: Verify the grep-confirmed claim still holds**

Run: `grep -rl "useMapboxSearchBox" client/src`
Expected: only `client/src/hooks/useMapboxSearchBox.ts` itself matches (confirming zero consumers, as stated in the spec).

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/map/_ORPHANS.md
git commit -m "docs(map): track useMapboxSearchBox as an orphaned hook"
```

---

### Task 5: Final verification sweep

**Files:**
- None (verification only).

- [ ] **Step 1: Full Worker typecheck**

Run: `npm run typecheck`
Expected: passes (no Worker files touched by this plan, confirm no regression).

- [ ] **Step 2: Full client typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: passes with the same pre-existing error count as before this branch.

- [ ] **Step 3: Full client vitest suite**

Run: `cd client && npx vitest run`
Expected: 430 files / 2964 tests passing (the baseline established at the end of the prior hook-error-surfacing round) — confirm no regressions.

- [ ] **Step 4: Grep-confirm no remaining `z-[900]` or the specific hex spot**

Run:
```bash
grep -n "z-\[900\]" client/src/pages/map/components/UnifiedMapLegend.tsx
grep -n "text-\[#3b82f6\]" client/src/pages/map/MapboxMapPage.tsx
```
Expected: the first command returns no match (z-index fixed). The second command may still return matches elsewhere in the file (e.g. other unrelated `#3b82f6` usages are out of scope) — confirm specifically that line ~1459's `Ruler` icon is no longer among them by re-checking that exact line:
```bash
sed -n '1459p' client/src/pages/map/MapboxMapPage.tsx
```
Expected: shows `text-brand-gold-500`, not `text-[#3b82f6]`.

- [ ] **Step 5: Commit (if any fixes were needed)**

Only commit if Steps 1-4 surfaced something to fix. If everything passes cleanly, no commit is needed for this task.
