# Map Tab Small Fixes Bundle

**Date:** 2026-07-21
**Status:** Approved, pending implementation plan

## Context

After several rounds of Map-tab audit-and-fix work this session (visual consistency
reorg, real-bugs-and-orphan cleanup, MapboxDispatchConnections wiring, hook error
surfacing), a survey of the accumulated specs' Non-goals sections plus
`client/src/pages/map/_ORPHANS.md` turned up a handful of small, low-risk items
that were either explicitly deferred or simply missed by an earlier pass claiming
completion. This spec closes out the smallest of those:

1. **`UnifiedMapLegend.tsx`'s `z-[900]` z-index outlier** — explicitly called out
   in the visual-consistency-reorg spec as "not touched by this spec... noted for
   completeness," and never revisited even after a later spec wired the component
   in. Every other floating info panel on the map (`MinimapControl.tsx:41`,
   `SpeedGraphOverlay.tsx:75/113`, `SpeedAnalyticsPanel.tsx:20`,
   `MapDiagnosticsOverlay.tsx:76`) uses the established `z-40` tier from the
   dock-reorg's z-index scale (`z-20` shell docks, `z-30` floating tool panels,
   `z-40` floating info/diagnostic overlays); `z-[900]` is an arbitrary leftover
   value with no relationship to that scale.

2. **`MapboxMapPage.tsx:1459`'s Measurement Result Banner `Ruler` icon** —
   `text-[#3b82f6]`, a raw hex value. The visual-consistency-reorg spec's D3 task
   ("Measure dropdown active color") and its commit message both describe this
   class of fix as complete, but only the Measure *dropdown itself* (lines
   1386-1402) was actually converted to `text-brand-gold-500` — this separate
   `Ruler` icon in the result banner, a different UI element entirely, was missed.
   Every sibling banner in the same file (Drawing Mode Indicator `PenTool` icon,
   GL Draw Feature Count `Grid3X3` icon, Active Route Panel `Route` icon) already
   uses `text-brand-gold-500` for its icon — this is the one outlier.

3. **`useMapboxTilequery.ts` has no error surfacing** — explicitly named as a
   deferred non-goal in the hook-error-surfacing spec ("lower severity... one-shot
   actions... left untouched"), alongside `useMapboxSearchBox.ts`. Its `query()`
   catches fetch failures with only a `console.warn` and returns `null` — visually
   identical to "no district data at this point," the same silent-failure shape
   the other 9 hooks had before being fixed. Its one caller,
   `MapboxMapPage.tsx`'s Identify-tool click handler (`~line 449`), currently
   treats a `null` return by doing nothing (no popup, side panel still opens via
   `infoPanel.showLocationInfo`) — an officer clicking to identify a point during
   a Mapbox outage gets total silence instead of an error indication.

4. **`useMapboxSearchBox.ts` is fully orphaned, not merely under-erroring** —
   confirmed via `grep -rl "useMapboxSearchBox" client/src`: the only match is the
   hook's own file. It has zero consumers anywhere in the app and was never added
   to `_ORPHANS.md`'s hooks table (13 entries today, this one missing). Adding
   error-state work to code nothing reads would be pointless busywork; the
   correct fix is tracking it as an orphan like its 13 siblings, so a future
   wire-in pass finds it.

## Design

### 1. `UnifiedMapLegend.tsx` z-index fix

Change `className="absolute z-[900] backdrop-blur-md"` (line 62) to
`className="absolute z-40 backdrop-blur-md"`. Pure class-name swap, no other
changes — the component's stacking order relative to its siblings (all floating
`z-40` info panels) becomes consistent instead of arbitrarily always-on-top.

### 2. Measurement Result Banner hex fix

Change `<Ruler className="w-3.5 h-3.5 text-[#3b82f6]" />` (line 1459) to
`<Ruler className="w-3.5 h-3.5 text-brand-gold-500" />`. Matches the
`text-brand-gold-500` convention already used by every sibling banner's icon in
the same file.

### 3. `useMapboxTilequery.ts` error surfacing

Add `error: string | null` state to the hook, following the identical pattern
used for the 9 hooks fixed in the prior round:
- `setError(null)` at the start of `query()`, alongside `setLoading(true)`.
- `setError(err?.message || 'Failed to identify point')` in the existing catch
  block, in addition to (not replacing) the existing `console.warn`.
- Returned alongside `loading`/`pointInfo` from the hook.

In `MapboxMapPage.tsx`'s Identify click handler, the current code:
```tsx
const info = await tilequery.queryFromMapClick(e);
if (identifyPopupRef.current) { identifyPopupRef.current.remove(); identifyPopupRef.current = null; }
infoPanel.showLocationInfo(e.lngLat.lng, e.lngLat.lat);
if (!info) return;
```
gains an error-aware branch: when `info` is `null` AND `tilequery.error` is set
(a real failure, not just "no features at this point"), show a popup with the
error message instead of silently returning. The `infoPanel.showLocationInfo`
side-panel call is unaffected either way — it's a separate, independent code
path unrelated to the Tilequery popup.

### 4. `useMapboxSearchBox.ts` orphan tracking

Add one row to `_ORPHANS.md`'s "Orphan hooks" table, alphabetically ordered
alongside the other 13 (it sorts between `useMapRepeatAddresses` and
`useMapSafetyZones`... actually alphabetically `useMapboxSearchBox` sorts before
all the `useMap*` entries since `useMapb` < `useMapC`/`useMapR`/etc. — insert at
the top of the table, first row):
```
| `useMapboxSearchBox` | Headless programmatic search (wraps Mapbox Search Box), never mounted anywhere |
```
No code changes to the hook itself — this is bookkeeping only, matching
`_ORPHANS.md`'s own house rule ("No silent edits — touching an orphan requires a
PR comment" is about *code* changes; a tracking-table addition documenting an
already-existing orphan is not a code touch and needs no such comment).

## Non-goals

- No other hardcoded-hex cleanup beyond the one specific Ruler-icon spot named
  above — the ~57 other hardcoded hex values in `MapboxMapPage.tsx`'s dock arrays
  are a separate, much larger tracked debt item, explicitly out of scope here.
- No wiring-in of `useMapboxSearchBox.ts` itself — this spec only adds it to the
  orphan tracker; actually mounting it is a future wire-in pass's job.
- No changes to `ToolbarDropdownGroup` or any other orphan panel/hook — those are
  a separate, larger effort by explicit user choice (this spec is scoped to the
  smallest bundle only).
- No retry/backoff logic added to `useMapboxTilequery.ts` — matches this
  session's established constraint from the hook-error-surfacing spec.
