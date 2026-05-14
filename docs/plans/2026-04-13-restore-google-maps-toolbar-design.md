# Restore Google Maps Toolbar — Design Doc

**Date**: 2026-04-13
**Status**: Approved
**Author**: Claude (with rmpgutah)
**Related**: Fixes the downstream half of the `/map` UX regression first addressed by PR #174 (CSP fix for CartoDB tiles)

## Problem

Commit `cc35c952` (2026-04-13) disabled Google Maps entirely by making `getGoogleMapsApiKey()` unconditionally throw. The intent was cost avoidance — the Google Maps API key had been removed server-side to stop API billing, but cached browser keys were still triggering the Google Maps script loader. Hard-disabling the function was the blunt instrument that guaranteed Leaflet took over.

Side effect: `OfflineMapFallback` (a sparse Leaflet component designed to be a fallback) became the *primary* map experience. It has no layers panel, no drawing tools, no stats bar, no legend, no compass rose, no address search — none of the ~40 tool sections and 30+ feature hooks that `MapPage.tsx` contains. Users lost every map-side operational tool: unit/call/property layer toggles, heatmap, tracking lines, breadcrumbs, intel layers, history layers, tactical tools, safety dashboards, threat assessment, perimeter drawing, corridor analysis, event planning, shift planning, geofences, predictions, weather overlay, and more.

## Approach

### Chosen option: Hybrid (Option C from brainstorm)

Restore Google Maps as primary **when the API key env var is set**, keep `OfflineMapFallback` as the fallback path when no key is configured. This was the pre-`cc35c952` design and is what every downstream code path already assumes.

Rationale: porting 30+ Google-Maps-specific hooks (they use `google.maps.Polygon`, `google.maps.LatLng`, `google.maps.visualization.HeatmapLayer`, etc.) to Leaflet would be a multi-week engineering project with high risk of regression. The hybrid path restores full functionality in 2 lines of code while preserving the existing Leaflet fallback for deployments without a Google key.

### Rejected: Option A (unconditional re-enable) and Option B (port tools to Leaflet)

Option A is a subset of C — same code change minus the conditional. Since the conditional already exists in the pre-disable code, Option A is strictly worse (forces billing even when no key is desired).

Option B is too large — 30+ hooks and 20+ panels would need rewrites, and Leaflet lacks some features Google Maps provides (places autocomplete, Street View, directions API). Not a good ROI when the conditional path already works.

### Rejected variant: C3 (add MAP_PROVIDER toggle)

Would add a new env var or localStorage flag to force provider selection. This is premature — the implicit "key present → Google, key absent → Leaflet" logic is already sufficient and testable. If a future use case requires forcing Leaflet despite a key being set, C3 can be added then. YAGNI for now.

### Implementation: C1 — `git revert cc35c952`

The disable was a single commit touching one function. Reverting it is cleaner than rewriting the function body manually:

- Documents intent in git log: "Revert fix(map): disable Google Maps entirely — no longer need to block cached keys; hybrid path restored."
- Symmetric rollback: if this turns out to break something, `git revert <revert-commit>` restores the disable.
- Avoids hand-copying the pre-disable function body (risk of transcription error).

Side effect: `cc35c952` also bumped `CACHE_NAME` v214→v215. The revert will undo that bump, but current production is at v221 (my own v220→v221 bump from the CSP fix deploy). After revert, manually bump to v222 so the new bundle propagates.

## Architecture

Two file edits, one logical change:

1. **`client/src/utils/googleMapsApiKey.ts`** — revert to pre-`cc35c952` body.
   - Checks `VITE_GOOGLE_MAPS_API_KEY` build-time env first
   - Falls back to `apiFetch('/integrations/google-maps/client-key')` which hits a server endpoint (already exists, already wired to the Admin Integrations panel)
   - Throws `MISSING_KEY_MESSAGE` if no key is configured anywhere
2. **`client/public/sw.js`** — bump `CACHE_NAME` from `rmpg-flex-v221` to `rmpg-flex-v222` so clients pick up the new `index.html` + bundle.

No changes to:
- `MapPage.tsx` — already has conditional rendering for `mapError` → `OfflineMapFallback`.
- `OfflineMapFallback.tsx` — still functions as-is.
- Server code — `/integrations/google-maps/client-key` endpoint exists and works.
- CSP headers or meta tags — Google Maps origins are already in the allowlists.

## Data Flow

```
Page load
  └─ MapPage mounts → loadGoogleMaps() → getGoogleMapsApiKey()
       ├─ [env var set] → return cached key → Google Maps script loads
       │    └─ MapPage renders with full toolbar (layers, stats, legend, 30+ tools)
       │
       ├─ [admin UI key set] → apiFetch returns key → Google Maps script loads
       │    └─ MapPage renders with full toolbar
       │
       ├─ [no key anywhere] → throws MISSING_KEY_MESSAGE
       │    └─ MapPage sets mapError → showOfflineFallback = true
       │         └─ <OfflineMapFallback> renders (Leaflet + CartoDB, current state)
       │
       └─ [runtime failure: gm_authFailure, billing disabled, quota exceeded]
            └─ MapPage sets mapError → same fallback path as "no key"
```

## Decision Point: `isAuthError` branching

`MapPage.tsx:226` currently has:
```ts
const isAuthError = mapError != null && (mapError.includes('API key') || mapError.includes('authentication') || mapError.includes('not configured'));
const showOfflineFallback = mapError != null && !isAuthError;
```

When `isAuthError = true`, MapPage shows a config-prompt dialog asking the user to set up Google Maps billing. When false (and `mapError` is set), it shows the Leaflet fallback.

With the revert, `MISSING_KEY_MESSAGE` starts with "Google Maps API key not configured" — so it matches `isAuthError` and would show the config prompt. That's the wrong UX for this project: we want silent Leaflet fallback, not a "please configure billing" dialog.

**Proposed sub-change**: remove `isAuthError` gating, or invert it so only truly unrecoverable errors (e.g., malformed JSON from Google) show a dialog, while "no key configured" + "auth failed" both quietly fall through to Leaflet.

Simplest expression: always route map errors through the Leaflet fallback. The config prompt was a holdover from an earlier era when Google Maps was mandatory.

## Error Handling

| Scenario | Current behavior | Post-revert behavior |
|---|---|---|
| No key in env, no key in admin UI | `throw → isAuthError=true → config dialog` | `throw → fall through → Leaflet (no dialog)` |
| `gm_authFailure` at runtime | `mapError set → showOfflineFallback=true → Leaflet` | unchanged |
| Quota/billing exceeded | handled by `gm_authFailure` path | unchanged |
| Network failure fetching key | `apiFetch` throws → `mapError` set → Leaflet | unchanged |
| Key present but invalid | `gm_authFailure` fires → Leaflet | unchanged |

## Testing

Manual QA on the deployed site, in this order:

1. **Deploy without adding a key** → visit `/map` → verify Leaflet fallback renders (current state). Confirms the revert didn't break the key-absent path.
2. **Add a key via Admin Integrations panel** (or set `GOOGLE_MAPS_API_KEY` in `server/.env` and restart) → hard-reload `/map` → verify Google Maps loads, layers panel appears, all toolbars visible.
3. **Revoke/remove the key** → reload → verify falls back to Leaflet cleanly.
4. **Simulate quota exceeded**: use an invalid but well-formed key → verify `gm_authFailure` triggers Leaflet fallback (no crash, no config dialog).

No new automated tests. Unit-testing this flow requires mocking `google.maps.*` globals — high effort, low value for a two-line revert.

## Rollback

```bash
# If the revert breaks something:
git log --oneline | grep 'Revert "fix(map): disable'
git revert <that-commit-hash>
bash deploy/deploy.sh
```

Symmetric and safe. The "revert-the-revert" restores the disable without any manual reconstruction.

## Out of Scope (explicit)

- Porting tools to Leaflet for the key-absent case. If a deployment never has a Google Maps key, it still gets the sparse Leaflet-only view. That's acceptable and was the state we shipped earlier today.
- Adding a `MAP_PROVIDER` override toggle. YAGNI until someone hits a case where the implicit key-presence detection is wrong.
- Touching the CSP, SW fetch handler, `googleMapsLoader.ts`, or `OfflineMapFallback.tsx`. All already work correctly.
- Adding any user-facing UI to toggle providers or show which provider is active. Current indicators (`"LIVE MAP · OpenStreetMap · CartoDB Dark"` in fallback, Google's own attribution in primary) are sufficient.

## Deliverables

1. Commit on `claude/restore-map-tools`: `Revert "fix(map): disable Google Maps entirely — force Leaflet fallback"` + `MapPage.tsx` `isAuthError` simplification + `sw.js` v221→v222 bump.
2. PR against `claude/strange-roentgen`.
3. Deploy via `bash deploy/deploy.sh` from the `restore-map-tools` worktree after merge.
4. Post-deploy verification with an API key added (user step — requires billing setup in Google Cloud Console).
