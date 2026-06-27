# Phase 4 — `/api/ws` envelope samples + cutover design (Step 1 recon)

> **Task 4.1 Step 1** of [docs/superpowers/plans/2026-06-12-worker-cutover.md](../2026-06-12-worker-cutover.md).
> Read-only reconnaissance captured 2026-06-12. **No code written, nothing flipped.** This grounds the
> Phase 4 *implementation* session, which should be its own focused session (see recommendation).

## How the client connects

| Socket | Client connect site | Path | Through proxy? | Server today |
|--------|--------------------|------|----------------|--------------|
| Main live-sync | `client/src/context/WebSocketContext.tsx:203` | same-origin `wss://rmpgutah.us/api/ws` | **YES** (zone proxy) → falls through to **legacy** | legacy `/api/ws` |
| Alerts/panic | `WebSocketContext.tsx:333-334` | direct `wss://api.rmpgutah.us/api/alerts-ws` | NO (bypasses proxy) | rewrite `AlertHubDO` |
| Voice | `client/src/utils/voiceWs.ts` | direct `wss://api.rmpgutah.us/api/voice-ws` | NO | rewrite `VoiceHubDO` |

→ Because `/api/ws` goes **through the proxy**, a proxy `API_ROUTES` rule CAN flip it to the rewrite
(unlike alerts/voice which the client points straight at `api.rmpgutah.us`).

## Handshake (captured live from the logged-in browser)

```
client → {type:'authenticate', token}
legacy → {type:'authenticated', userId, role}      ← captured live 2026-06-12
```

AlertHubDO's handshake is DIFFERENT: it replies `{type:'alerts_ready'}` (or `{type:'alerts_auth_error'}`)
and answers `{type:'ping'}`→`{type:'pong'}`. The rewrite's existing per-isolate `/api/ws`
(`src/routes/ws.ts`) replies `{type:'authenticated', userId, role}` — i.e. it already matches legacy's
handshake, but its `broadcastAll`/`sendToUser` are per-isolate and **dead** for real clients.

## Emitted envelope the rewrite `/api/ws` must reproduce (from the legacy bundle)

Broadcast to ALL authenticated clients (`broadcastAll(type, data)`):
- **`dispatch_update`** (10 emit sites) — `{action: 'call_status_changed' | 'call_updated' | 'unit_status_changed', call | unit}`. **This is the frame the SPA actually subscribes to** (`useLiveSync.ts:125` `subscribe('dispatch_update', …)`).
- **`data_changed`** — `{module, entity}` (generic cache-invalidation nudge).
- **`scraper_events`** (3 sites) — scraper status stream (ScrapersTab).

Targeted to ONE officer (`sendToUser(officerId, type, data)`):
- **`premise_alert_for_unit`** — premise auto-push to the assigned unit's MDT. **Broadcast-only DOs cannot do this** without per-user routing.

(The `broadcast({type: voice_presence|radio_recorded|radio_transmit_end|panic_audio_recorded})` frames
are on the VOICE socket, not `/api/ws` — out of scope for this flip.)

## The two real design decisions (why this is build work, not a flip)

1. **Protocol unification.** `/api/ws` (handshake `authenticated`, frame `dispatch_update`) and
   `AlertHubDO` (handshake `alerts_ready`, panic lifecycle) are different protocols the client treats as
   two separate sockets. Options:
   - **(A) New dedicated DO for `/api/ws`** (e.g. `LiveSyncDO`, one global instance) that speaks the
     `authenticated`/`dispatch_update` protocol + supports `sendToUser` targeting. Cleanest separation;
     keeps panic logic isolated in AlertHubDO. Requires a new `new_sqlite_classes` migration (append-only).
   - **(B) Extend AlertHubDO** to also accept `/api/ws` upgrades and emit `dispatch_update`/targeted
     frames. Fewer DOs but entangles officer-safety panic state with general live-sync; riskier blast radius.
   - Recommendation leans **(A)** — isolation matters on the officer-safety path.
2. **Targeted delivery (`sendToUser`).** The chosen DO must track `userId → Set<WebSocket>` and expose a
   `/emit` mode that targets one user (for `premise_alert_for_unit`), in addition to broadcast. Route
   handlers that today call the dead `broadcastAll`/`sendToUser` (`src/routes/ws.ts`) must be repointed to
   `env.<DO>.get(idFromName('global')).fetch('/emit', …)` — find every caller first.

## Implementation checklist for the dedicated Phase 4 session

- [ ] Decide design (A) vs (B); if (A), add `LiveSyncDO` + append-only `new_sqlite_classes` migration in `wrangler.toml` (mind the DO-migration ordering rules in CLAUDE.md / the existing AlertHubDO/VoiceHubDO tail).
- [ ] Implement the DO: `authenticate`→`authenticated` handshake, `broadcast` for dispatch_update/data_changed/scraper_events, `sendToUser` targeting for premise_alert_for_unit.
- [ ] Repoint every rewrite caller of the dead `broadcastAll`/`sendToUser` (`src/routes/ws.ts`) to the DO `/emit`. Grep for all call sites.
- [ ] Unit-test the envelope shaping (pure function) with vitest.
- [ ] Deploy rewrite (push) — **NO proxy flip yet**. Verify DIRECT: `new WebSocket('wss://api.rmpgutah.us/api/ws')` + authenticate → `authenticated`, then mutate a call in a 2nd browser → receive `dispatch_update`.
- [ ] Flip in proxy: add `/api/ws` rule to `API_ROUTES`. (Confirm WS upgrade headers traverse `env.API.fetch` — service bindings pass upgrades through.)
- [ ] **Two-device live drill** (the officer-safety acceptance test): board on machine A, change call status on machine B → A updates without the ~7s poll; trigger a test panic → instant popup. Record in `phase4-ws.md`.
- [ ] Rollback = remove the proxy `/api/ws` rule → clients reconnect to legacy WS on their normal retry.

## Recommendation

**Do Phase 4 as its own focused session, NOT bundled after a same-session auth flip.** It needs a DO
design decision, new code + a DO migration, caller repointing, and a two-device officer-safety drill —
on the path that carries panic alerts. Step 1 recon (this file) is complete and safe; the build/flip
should start fresh.
