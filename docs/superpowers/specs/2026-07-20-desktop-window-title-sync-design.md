# Desktop Launcher — Floating Window Title Sync Design Spec

**Date**: 2026-07-20
**Status**: Approved for implementation

## Purpose

A floating desktop window's title bar (and its taskbar button label) is set
once at creation time and never updated. When a user opens a window and then
navigates using the app's *own* in-page nav bar (rendered inside the iframe)
to a different route, the outer window chrome keeps showing the original
page's title — the parent desktop page has no visibility into client-side
route changes happening inside a same-origin iframe.

This was always true of the original v1/v2 desktop launcher's ~18-page
windowable set, but rarely surfaced: with few windowable pages and a
dedicated desktop icon per page, users mostly opened/closed rather than
browsing deeply inside one window. The
[windowable-apps expansion](2026-07-19-desktop-launcher-windowable-apps-expansion-design.md)
(83 of 85 pages now windowable) makes in-window browsing the natural way to
use the feature, so the staleness now shows up constantly — confirmed live
on rmpgutah.us/desktop: a window opened at `/` stayed titled "Dashboard"
while its content was navigated to Process Server, then NSOPW, then
Incidents via the in-app nav bar.

## Approach

Same-origin iframes let the parent read `iframe.contentWindow.location`
directly (no cross-origin restriction applies). `FloatingWindow.tsx` polls
`contentWindow.location.pathname` on an interval; when it changes, it looks
up a display label for the new path via the existing
`getWindowConfigByPath` helper (`windowManager.ts`) and, if a label is
found and differs from the window's current title, updates **only** the
window's `title` field.

**Deliberately does NOT update `DesktopWindowState.path`.** `path` is also
the value bound to the iframe's `src` prop — if polling wrote the observed
in-iframe URL back into `path`, the next render would set the iframe's
`src` attribute to a new value, which browsers treat as an explicit
navigation command (a reload), not a no-op even when the URL happens to
already match. That would fight the very navigation the poll is reacting
to. `path` keeps its original meaning: the URL the window was opened at,
used for dedup-on-reopen and as the fixed iframe `src`. Title sync is a
purely cosmetic side-channel.

**Polling, not `postMessage`, because:** a message-based approach would
require instrumenting the shared SPA router (`App.tsx`) to broadcast route
changes to `window.parent` on every navigation, touching code every one of
the 85 windowable pages runs through — much larger blast radius for a
cosmetic fix. Polling is entirely contained to `FloatingWindow.tsx` plus
one new context action.

**Interval**: 500ms. Each tick is a same-origin property read (cheap); only
fires a state update when the resolved pathname actually changes.

**Scope of what updates the title**: only pathnames with a real
`getWindowConfigByPath` match (i.e., a catalog entry) update the title;
navigating to a route with no catalog entry (a `:id` detail route, a query-
param-only change on the same path, etc.) leaves the title as its last
known good value rather than showing something worse than stale (e.g., a
raw path string).

## Data Model

`DesktopWindowManagerContextValue` gains one new action:

```ts
updateWindowTitle: (id: string, title: string) => void;
```

Implemented identically to the existing `moveResize`/`focusWindow` pattern
— reads `windowsRef.current`, maps the matching window's `title`, and
`commit()`s the result. No new fields on `DesktopWindowState`.

## Components

`FloatingWindow.tsx`:
- Gains a `useRef<HTMLIFrameElement>` on the iframe (none exists today).
- A `useEffect` (keyed on `win.id`, only runs while the iframe is mounted —
  i.e., not while `win.minimized`, since the iframe itself unmounts when
  minimized per existing behavior) sets a 500ms `setInterval` that:
  1. Reads `iframeRef.current?.contentWindow?.location?.pathname` inside a
     `try/catch` (defensive — `contentWindow` can be transiently null
     during navigation/unmount; a cross-origin access would throw, though
     that can't happen here since every windowed page is same-origin).
  2. If the pathname differs from a `lastPathRef` (local ref, not
     `DesktopWindowState.path` — see above), resolves
     `getWindowConfigByPath(pathname)?.title`. If found and different from
     `win.title`, calls `updateWindowTitle(win.id, resolvedTitle)`.
  3. Updates `lastPathRef` regardless (so an unresolvable path doesn't
     re-attempt resolution every tick).
  Cleans up the interval on unmount/`win.id` change.

## Error Handling

- `contentWindow` access wrapped in try/catch; any failure is a silent
  no-op for that tick (title just doesn't update that cycle — not worth a
  toast or log for a cosmetic sync).
- No error path changes anywhere else — this is purely additive.

## Testing

- **Client** (Vitest): unit test for the new `updateWindowTitle` context
  action (mirrors existing `DesktopWindowManager.test.tsx` coverage for
  `moveResize`/`focusWindow`). Component test for `FloatingWindow.tsx`
  using a fake timer (`vi.useFakeTimers()`) and a stubbed
  `contentWindow.location.pathname` to verify: (a) title updates when the
  polled pathname resolves to a different catalog label, (b) title is left
  alone when the polled pathname has no catalog match, (c) the iframe's
  `src` attribute is never touched by the polling (regression guard for
  the exact reload risk this design avoids).
- **Manual**: open a window, use its in-app nav bar to browse to 2-3
  different pages, confirm the title bar and taskbar button label update
  each time without the iframe visibly reloading/flashing.

## Non-goals

- Does not address any other item from the Phase 1 spec's backlog (Alt+Tab
  cycling, multi-monitor placement, wallpaper upload, etc.) — those are
  Phase 2+ of the broader desktop-system program, tracked separately.
- Does not update `path`/dedup behavior — reopening the same original path
  from a desktop icon still refocuses the existing window at its **first**
  path, even if the user has since navigated elsewhere inside it. That's
  existing, unchanged behavior; not part of this fix's scope.
