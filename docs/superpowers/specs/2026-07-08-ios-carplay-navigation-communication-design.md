# iOS CarPlay — Navigation + Communication

**Date:** 2026-07-08
**Status:** Approved

## Problem

Officers can't use RMPG Flex Connect from the CarPlay dash at all today.
There's no CarPlay scene in the app, and — despite "En Route" existing as a
call-status label (`CallDetailView.swift`) — there is **no actual
turn-by-turn routing anywhere in the app**. This is new capability, not a
port of something that already exists.

## Platform constraint (read this first)

CarPlay entitlements are restricted and category-gated by Apple
(Navigation, Communication, Audio, EV Charging, Parking, Quick Food
Ordering, Driver Profile — a generic CAD/RMS app doesn't obviously fit any
single one). This design targets **both Navigation and Communication**,
since the app genuinely does both (turn-by-turn to a call; two-way
dispatch messaging). Apple's approval of the CarPlay entitlement request
is a prerequisite for shipping this on a real dash and is entirely outside
this repo's control — code here can be complete and correct while still
being blocked on that approval. The CarPlay Simulator (via Xcode's
"Additional Tools" download) can exercise the scene without the entitlement
approved yet, which is enough to validate template flow before submitting
the request.

## Design

CarPlay templates are UIKit-only (no SwiftUI CarPlay template API exists).
This lives in the main `RMPGFlexConnect` app target — CarPlay does not
need a separate app-extension target the way widgets/Live Activities do.

**New scene delegate**: `CarPlaySceneDelegate` conforming to
`CPTemplateApplicationSceneDelegate`, registered via a new
`UIApplicationSceneManifest` entry in `App/Info.plist` for the
`CPTemplateApplicationSceneSessionRoleApplication` role.

**Root template — `CPListTemplate`**: the officer's active/assigned calls,
sourced from `FeatureDispatch`'s existing call data (`DispatchAPI`) — no
new backend endpoint.

**Navigation — `CPMapTemplate`**: tapping a call in the list starts a
CarPlay navigation session to that call's address using `MKDirections`
(MapKit, not Mapbox — its route/step model maps directly onto
`CPManeuver`/`CPTravelEstimates`/`CPRouteInformation` with no translation
layer, and needs no API token). This is genuinely new routing logic; there
is nothing to port from elsewhere in the app.

**Communication — `CPGridTemplate`**: a "Send Update" screen alongside
navigation with canned buttons (En Route / On Scene / Clear / Need
Backup). Each posts to the **existing** `/api/mdt/send` endpoint —
`{to: 'mdt', type: 'text', payload: {text: "..."}}` — the identical
contract `MDTLinkView` (Quick Actions) already uses to send phone→MDT
messages. No new server work; the vehicle MDT terminal displays these the
same way it displays any other phone→MDT text message.

## Alternatives considered (not building)

- **Mapbox Directions hand-mapped to `CPManeuver`** — more visually
  consistent with the rest of the app's map experience, but real added
  integration work for a first version with no proven need for
  Mapbox-specific routing features (traffic-aware ETAs, custom styling)
  inside the CarPlay template itself.
- **No live turn-by-turn, just an "open in Maps" handoff** — much less
  work, but doesn't constitute a real Navigation-category capability in
  its own right; unlikely to support the entitlement request.

## Testing

- Unit-testable pieces: the canned-message payload builder (pure function,
  same pattern as `MDTLinkView`'s send logic) and any call→CLLocationCoordinate2D
  mapping used to kick off `MKDirections`.
- End-to-end CarPlay scene behavior can only be verified via the CarPlay
  Simulator (Xcode "Additional Tools") or a real head unit — neither is
  available in the current sandboxed session; this needs local Xcode
  verification, same constraint as every other iOS change this session.
