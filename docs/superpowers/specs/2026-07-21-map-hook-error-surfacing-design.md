# Surface Silently-Failing Map-Tab Data Hooks

**Date:** 2026-07-21
**Status:** Approved, pending implementation plan

## Context

Two earlier Map tab specs ("Map Tab Visual Consistency & Dock Reorganization" and
"Map Tab — Real Bugs & Orphaned Feature Cleanup") both explicitly listed "the 10
silently-failing data hooks" and a "console.warn/devWarn sweep" as identified-but-
deferred non-goals — a real issue that was flagged twice and never actually fixed.
This spec fixes it.

Every Map-tab layer-data hook (Incidents, Repeat Addresses, Coverage Gaps, Response
Time by Beat, Safety Zones, Call History, Pursuit Tracks, Speed Violations, Speed
Heatmap — 9 total, confirmed via direct source inspection) shares the identical
shape: `setLoading(true)` at fetch start, a `catch (err) { console.warn(...) }`
block, `setLoading(false)` in `finally`, and no `error` state anywhere in the
returned object. If a dispatcher toggles a layer on and its fetch 404s, 500s, or
fails on the network, the dock toggle's loading spinner simply stops — visually
identical to "there's no data right now," with zero indication anything went
wrong. `apiFetch` itself (`client/src/hooks/useApi.ts`) is confirmed correct — it
throws on any non-2xx response — so the defect is entirely on the hook side: every
one of these 9 hooks catches that thrown error and discards it.

Two additional, more severe instances were found in the same sweep:
- **`useMapboxPursuitSegments.ts`**: beyond the outer hook's console-warn-only
  catch, the per-segment GPS-trail fetch inside `renderOnMap` has a completely
  bare `catch { /* comment only */ }` — not even a log line. An individual
  pursuit track can silently vanish with zero trace anywhere, console included.
- **`useMapboxBoundaries.ts`**: not a Map-tab hook (used by `JurisdictionLookup.tsx`
  on `WarrantsPage`/`PropertiesTab`/`WarrantsListTab` for cross-jurisdiction
  address lookups — confirmed via grep it's the ONLY caller anywhere), but found
  in the same audit and worth fixing here regardless. Its `lookup()` catches
  internally and returns `null` instead of rethrowing, which defeats an
  **already-written** error-handling path in the one place that calls it:
  `JurisdictionLookup.tsx`'s `run()` wraps `await lookup(...)` in its own
  `try/catch` expecting a thrown error to populate `setError(...)` — that catch
  block can currently never fire for a Boundaries-API failure.

## Design

### The shared pattern (9 Map-tab hooks)

Each hook gains an `error: string | null` state:
- Cleared (`setError(null)`) at the start of every fetch attempt, alongside the
  existing `setLoading(true)`.
- Set in the `catch` block (`setError(err?.message || '<fetch-specific fallback
  message>')`) — **in addition to**, not replacing, the existing `console.warn`
  (console logging stays for developer debugging; the new state is for the
  operator-facing UI).
- Returned alongside `loading` in the hook's return object.

`useMapboxResponseTime.ts` has two independent silent-catch points in one data
flow (the static `beat.geojson` load inside `renderOnMap`, and the beat-activity
`fetchResponseTimes` call) — both set the same `error` state, since either failure
means the layer has no usable data.

`useMapboxPursuitSegments.ts`'s bare per-segment catch gains at minimum a
`console.warn` (parity with every other hook's pattern) — individual per-segment
failures are not surfaced one-by-one on the toggle (too granular for a boolean
dock item), but the outer `fetchSegments` catch's new `error` state still catches
a total failure of the whole feature.

### UI treatment

`DockToggleItem`/`DockToggleRow` (`client/src/pages/map/components/DockSection.tsx`)
gains an optional `error?: string | null` field. When set, a small red `AlertCircle`
icon (lucide-react) renders in the same slot the existing `loading` spinner
(`Loader2`) uses — they're mutually exclusive in time, since a fetch always clears
its own `error` before setting `loading` true again. The toggle's tooltip
(currently `title={item.description}`) shows the error message instead of the
normal description when one is set: `title={item.error || item.description}`.

`MapboxMapPage.tsx` threads each of the 9 hooks' new `error` field into its
corresponding dock-array entry (the same entries that already thread `loading`
today), so the fix is purely additive to already-existing wiring — no new dock
entries, no layout changes.

### `useMapboxBoundaries.ts` fix (separate from the Map-tab pattern above)

Remove the internal catch-and-swallow. The `catch` block still resets `result` to
`null` (so stale data isn't shown), but rethrows instead of returning `null`;
`finally` still clears `loading`. Since `lookup()` has exactly one caller
anywhere in the app (confirmed via grep) and that caller already wraps it in
`try/catch`, rethrowing introduces no new unhandled-rejection risk.

## Non-goals

- `useMapboxTilequery.ts` and `useMapboxSearchBox.ts` (identified in the same
  audit, lower severity — they back one-shot click/type actions rather than a
  standing toggled layer, so a failed attempt is implicitly retriable and there's
  no lingering "layer is on but silently empty" confusion) are left untouched.
- No toast/banner notification system — the red-icon-on-the-toggle treatment is
  the entire UI surface for this spec, per the approved design.
- No retry/backoff logic added to any hook — this spec is about surfacing
  failure, not automatically recovering from it.
- `useMapboxDraw.ts` and any other non-fetching Map-tab hook are out of scope —
  this spec only touches hooks that make a server request.
