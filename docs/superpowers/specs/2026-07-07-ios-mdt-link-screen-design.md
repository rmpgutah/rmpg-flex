# iOS MDT Link screen

**Date:** 2026-07-07
**Status:** Approved

## Problem

`RMPGFlexConnect` (the native iOS app) can only push one-way to the in-vehicle
MDT (`QuickActionsView.pushToMDT`, sending a scanned ID). It has no way to see
whether the vehicle's MDT is currently online, or to see/send free-text
messages — capability the web client already has via `MDTBridge.tsx` and
`MdtPage.tsx`. This means an officer away from the vehicle (a "remote
position") has no visibility into or ability to communicate with their unit's
MDT.

## Contract (existing, no server changes)

- `POST /api/mdt/send` `{to:'mdt', type:'text', payload:{text}}` → `201 {success, id}`
- `GET /api/mdt/inbox?endpoint=phone` → `{messages:[{id,type,payload,created_at}], counterpart_online}` — consumes pending messages and refreshes the phone's own presence row
- `GET /api/mdt/status?endpoint=phone` → `{endpoint, counterpart, counterpart_online}` — non-consuming status check

Messages inbound to the phone use `direction: to_phone`. The web client polls
`/inbox` every 8 seconds (`MDTBridge.tsx`); the iOS screen matches that
interval so both ends of the link behave consistently.

## Design

Add a new screen, `MDTLinkView`, reachable from Quick Actions (next to the
existing "Push to MDT" action). Scoped to `FeatureQuickActions` — no new
package, reuses the `APIClient` that `QuickActionsViewModel` already holds.

**UI:**
- Status pill at top: "MDT ONLINE" / "MDT OFFLINE" from `counterpart_online`.
- Scrollable message list, oldest → newest (matches web ordering), each row
  showing the message text and a relative timestamp.
- Text field + Send button at the bottom, posting `type: 'text'`.

**Polling:** a `Task` loop started in `.onAppear`, cancelled in
`.onDisappear` — calls `/inbox` every 8 seconds while the screen is visible,
appending any new messages to local state and updating the online pill.
Not a background/always-on service in this pass (see Alternatives below).

**Error handling:** polling failures fail silently (a transient network blip
during a passive background poll shouldn't interrupt the officer — same
philosophy as `LocationTracker`'s flush loop). A failed *send* surfaces an
inline error banner, since that's an action the officer is actively waiting
on and needs to know didn't go through.

## Alternatives considered (not building now)

- **App-wide shared `MDTLinkService` singleton** — would let link status
  surface elsewhere (e.g. a badge on the Quick Actions tab) without
  re-plumbing. Deferred until there's a concrete second surface that needs
  it — YAGNI for this pass.
- **Push-notification-driven inbox** (via `CorePush`) instead of polling —
  more real-time, but needs new server-side wiring to trigger a push on
  `to_phone` inserts. Bigger scope than what was asked for here.

## Testing

- Unit test the payload-building/parsing helpers (pure functions, no network)
  the same way `mdtSignal.ts` is unit-tested on the web side.
- Manual verification: this feature cannot be end-to-end verified in the
  current sandboxed session (no way to run a live MDT-side counterpart or a
  simulator); relies on `swift build`/`swift test` for compile-correctness
  and matching the existing server contract exactly.
