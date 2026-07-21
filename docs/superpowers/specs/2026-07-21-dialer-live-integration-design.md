# Dialer (Dial Connect) live integration — design

Date: 2026-07-21

## Problem

`dialer.rmpgutah.us` ("Dial Connect", repo
[`rmpgutah/dispatch-app`](https://github.com/rmpgutah/dispatch-app)) is a
separate Next.js app (Twilio Voice/SMS, its own OIDC provider used today only
for "Sign in with Dialer" SSO *into* Flex). RMPG Flex has no visibility into
it beyond that login button — when a call rings on Dial Connect, nobody
looking at Flex knows about it unless they have a separate dialer tab open.

Goal: while Flex is open, Dial Connect should be embedded and live inside it,
and an inbound call should surface as an alert in Flex without the operator
tabbing away.

## Why cross-origin auth is the crux

Flex's existing "Sign in with Dialer" flow uses Dial Connect as an **OIDC
provider** to authenticate into Flex (`src/routes/oidc.ts`,
`DIALER_OIDC_*` bindings). That is the opposite direction from what this
feature needs — Flex must *read* Dial Connect's live session/event state, and
`rmpgutah.us` / `dialer.rmpgutah.us` do not share cookies, so Flex cannot
`fetch()` Dial Connect's `/api/stream` (its internal SSE endpoint, backed by
`src/lib/events-bus.ts` on the dispatch-app side) with credentials.

The chosen fix: keep an iframe of Dial Connect always mounted in Flex, using
Dial Connect's own cookies and its own `EventSource`, and have Dial Connect
relay selected events to the parent window via `window.postMessage`. No new
shared-auth mechanism is needed.

## Scope of this repo (rmpg-flex)

This spec covers the **Flex-side `DialerPanel`** only. The Dial Connect-side
bridge is a separate, small PR against `dispatch-app` (see "Dial Connect-side
contract" below) — out of this repo's tree, but documented here so both
halves stay in sync.

### `DialerPanel` component

- Location: `client/src/components/DialerPanel.tsx`, mounted once at the app
  shell level (same tier as other persistent global widgets), not per-route —
  so it (and its iframe's `EventSource`) stays alive across page navigation.
- Renders `<iframe src="https://dialer.rmpgutah.us/dialer">` inside a
  collapsible dock (default collapsed to a small tab/badge; expand on click
  or on an inbound-ring alert). Collapsing hides the iframe visually (CSS,
  e.g. reduced size/off-canvas) but never unmounts it — the whole point is
  the embedded page's `EventSource` must keep running while collapsed.
- No new Worker route or D1 schema needed — this is a pure client-side
  widget reading `postMessage` events from Dial Connect's origin.

### Message contract (Dial Connect → Flex)

Flex listens via a single `window.addEventListener('message', handler)`,
installed once inside `DialerPanel`, filtering strictly on
`event.origin === 'https://dialer.rmpgutah.us'` (reject anything else,
including same-origin noise from other Flex code — this listener must only
ever act on messages whose origin matches exactly).

Expected message shapes (mirrors Dial Connect's own `events-bus.ts` union,
plus a heartbeat Flex needs that Dial Connect does not otherwise emit):

```ts
type DialConnectMessage =
  | { source: 'dial-connect'; type: 'call_status'; callSid: string; status: string; from?: string }
  | { source: 'dial-connect'; type: 'duress_alert'; dispatcherName: string; timestamp: string }
  | { source: 'dial-connect'; type: 'heartbeat' };
```

`source: 'dial-connect'` is a required discriminant (belt-and-suspenders on
top of the origin check) so Flex never mistakes an unrelated same-shape
message from something else for a real event.

### Behavior

- `call_status` with `status === 'ringing'` → Flex shows a toast/alert using
  the existing toast pattern already used elsewhere in the app (see any
  existing toast/notification component client-side) — text like "Inbound
  call from `{from}`", with a click action that expands the `DialerPanel`
  dock. No other `call_status` values need a Flex-side reaction in this
  phase (answered/completed are visible once the panel is expanded).
- `duress_alert` → same toast treatment, higher-priority styling (this
  mirrors Dial Connect's own `DuressAlertBanner.tsx` severity).
- `heartbeat` → resets a "last seen" timestamp. A connectivity indicator in
  the `DialerPanel` header reads "Connected" if a heartbeat (or any message)
  arrived within the last 45s (matches Dial Connect's own 20s SSE heartbeat
  cadence with margin), else "Disconnected". No message ever arriving (e.g.
  the bridge patch below hasn't shipped yet, or the iframe never loaded) is
  the same "Disconnected" state — this is a client-only signal, not a proof
  of a live call channel.
- First-time / logged-out state: if the iframe loads Dial Connect's own
  login screen (a separate session from Flex's), that is expected and
  requires no special handling — the operator logs into Dial Connect once
  inside the iframe and the browser retains that session going forward, same
  as any other embedded app.

### Non-goals (this phase)

- No backend/Worker changes in rmpg-flex.
- No attempt to make Flex authenticate to Dial Connect's APIs directly
  (no token exchange, no proxying `/api/stream` through the Worker).
- No outbound call control from inside Flex beyond what the embedded iframe
  already offers natively.

## Dial Connect-side contract (separate `dispatch-app` PR, not built here)

For the message contract above to ever fire, `dispatch-app` needs a small,
targeted patch:

1. A bridge component, mounted only in the `(protected)/dialer` layout (so it
   only runs when that specific embeddable page is loaded, e.g. inside
   Flex's iframe), that:
   - No-ops immediately if `window.parent === window` (not embedded).
   - Subscribes the same way `GlobalEventToasts.tsx` / `useDispatchStream.ts`
     already do (`new EventSource('/api/stream')`), and forwards
     `call_status` and `duress_alert` events to
     `window.parent.postMessage({source: 'dial-connect', ...event}, 'https://rmpgutah.us')`.
   - Posts `{source: 'dial-connect', type: 'heartbeat'}` on the same cadence
     as the SSE heartbeat comment (~20s) or on every real event, so Flex's
     connectivity indicator has something to key off of.
2. Drive-by fix: `GlobalEventToasts.tsx` currently has no case for
   `call_status` at all — Dial Connect's own dispatchers get no toast for an
   inbound ring today either. Add one there independent of the bridge work,
   since it's a real gap in the app on its own merits.
3. Verify no CSP / `X-Frame-Options` gets added later that would block
   framing from `https://rmpgutah.us` (nothing currently sets either,
   confirmed via `next.config.ts` and no `middleware.ts` present as of
   2026-07-21 — if a CSP is added in the future for other reasons, it must
   include `frame-ancestors https://rmpgutah.us` for this to keep working).

This contract is written here so the two PRs (rmpg-flex `DialerPanel`,
dispatch-app bridge) can ship independently without either author guessing
the other's message shape.

## Testing

- rmpg-flex: component-level test/manual check that `DialerPanel` ignores
  messages from any origin other than `https://dialer.rmpgutah.us`, and that
  a `call_status: ringing` message produces a toast.
- End-to-end verification (manual, once both PRs are live): place a real or
  test inbound call to the Twilio number, confirm a toast appears in Flex
  within the SSE's normal latency, and confirm the connectivity indicator
  reads "Connected" during normal operation.
