# Admin Downloads Tab

**Date:** 2026-07-22
**Status:** Approved, pending implementation plan

## Context

The public `/downloads` page (`client/src/pages/DownloadsPage.tsx`) already serves
real Windows/Mac/Android installer downloads, backed by a real `/api/downloads/info`
endpoint and `/downloads/<filename>` file routes — this is not new infrastructure,
it already ships today. It is not linked from anywhere inside the Admin console
(`client/src/pages/AdminPage.tsx`), so an admin has no quick way to find/share the
current installer without knowing the standalone URL exists.

This is a small, narrowly-scoped addition to the existing Admin tab system (a
`VALID_TABS` array + a tab-config array of `{ id, label, icon }` entries, already
containing ~35 tabs like `users`, `system`, `health`, etc.).

## Non-goals

- Not rebuilding or embedding the full public `DownloadsPage` inside the Admin shell
  — that page has its own standalone header/footer/hero designed for an
  unauthenticated, full-page experience; duplicating that chrome inside the Admin
  tab content area would look wrong and is unnecessary scope.
- No new backend work — `/api/downloads/info` and `/downloads/<filename>` already
  exist and already work; this tab only calls the existing endpoint.
- No changes to the public `/downloads` page itself.
- No new installer-management features (uploading a new build, changing versions,
  etc.) — this tab is read-only: it shows what's currently available and links out.

## Overview

A new Admin tab, `downloads` (added to `VALID_TABS` and the tab-config array,
grouped near `system`/`health` since it's an operational/IT-facing concern), backed
by a new `AdminDownloadsTab.tsx` component (matching the existing
`Admin<Name>Tab.tsx` file-per-tab convention already used by all ~35 other tabs).

The tab content:
- Calls the existing `apiFetch<DownloadsInfo>('/api/downloads/info')` (same call
  `DownloadsPage.tsx` already makes) to get current Windows/Mac/Android installer
  metadata (version, size, filename).
- Renders one row per platform showing version + size, with a direct download
  button (`href="/downloads/<filename>"`, same URL pattern the public page uses).
- Includes a link to the full public `/downloads` page, for the complete
  install-instructions experience (SmartScreen/Gatekeeper notes, step-by-step guides)
  that this focused admin view deliberately doesn't duplicate.

## Data flow

```
Admin clicks "Downloads" tab
  → AdminDownloadsTab mounts
  → apiFetch('/api/downloads/info')  [existing endpoint, unmodified]
  → renders version/size + download button per platform
  → "Open full Downloads page" link → /downloads (existing public page, unmodified)
```

## Error handling

- Same failure mode as the existing public page: if `/api/downloads/info` fails,
  show an inline "Could not load download info" message — reuse the exact same
  error-state pattern `DownloadsPage.tsx` already has, don't invent a new one.
- If a given platform's installer metadata is absent (the existing API already
  supports partial results — `DownloadsInfo` fields are all optional), show
  "Not available" for that platform, matching the public page's existing behavior.

## Testing

- Component-level test asserting: loading state, successful fetch renders all
  present platforms with correct download `href`s, error state renders on fetch
  failure, missing-platform renders "Not available" — mirroring whatever test
  coverage (if any) exists for other `Admin<Name>Tab` components, checked before
  writing this task's tests so it follows the same convention.
- No backend testing needed (no backend changes).

## Rollout

Ships through the existing Cloudflare Pages deploy (`client/` build), no new
routes, no new bindings, no migration.
