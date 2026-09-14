# Native Softphone (Dial Connect port, P1) — Design

**Date:** 2026-09-14
**Status:** Approved in session; implementation plan follows.
**Program:** Port everything Dial Connect shows into RMPG Flex. P1 = softphone core.
Later: P2 in-call workspace, P3 history/voicemail/callbacks gaps, P4 SMS,
P5 board/incidents/units/wallboard, P6 admin + delete the iframe.

## Goal

RMPG Flex hosts the Twilio Voice client itself. The Dialer Connect page's
native UI (keypad, speed dial, caller lookup, wrap-up, presence) becomes the
dialer; the embedded Dial Connect iframe is no longer needed for calls.
Every button on the page performs its real action. Call archive
(`dialer_calls`, voicemail rows) and all PDF output stay byte-for-byte the same.

Non-goals for P1: the dispatch-app side panels (caller card, incident link,
in-call SMS, etc.), SMS, board, admin. dispatch-app keeps owning TwiML,
IVR, ring groups, recordings, CallLog.

## Context (measured)

- Dial Connect = `~/Call Center/dispatch-app` (Next 16 / OpenNext), Cloudflare
  Worker `dialer`, routes `rmpgutah.us/dialer{,/*}`. No CI; deploy is
  `npm run deploy` from that directory.
- Ring groups dial `client:dispatcher_<dispatch-app User.id>`
  (`api/voice/ivr-select`) and only consider dispatchers whose
  `User.lastSeenAt` is fresh (`api/voice/presence/heartbeat`).
- The OIDC `sub` issued by dispatch-app is `User.id`
  (`lib/oidc-account-adapter.ts`). RMPG Flex stores it in
  `users.dialer_oidc_sub` (migration 0184); the SSO callback in
  `src/routes/oidc.ts` self-links on first login by matching e-mail.
- Live D1 (2026-09-14): 4 active Flex users, 0 linked.
- `@twilio/voice-sdk` ^2.18 is used by dispatch-app; rmpg-flex client has no
  Twilio dependency yet.
- dispatch-app has no on-demand recording control — `api/voice/recording` is
  the Twilio *webhook*.

## Architecture

```
Browser (RMPG Flex SPA)               rmpg-flex-api Worker                dispatch-app Worker ("dialer")
SoftphoneProvider ── POST /api/dialer/token ──▶ /api/dialer/* ── X-RMPG-Service-Key ──▶ /dialer/api/voice/token
  Device.register(identity)              (JWT auth, maps user →               X-RMPG-Dispatcher-Id     /dialer/api/voice/{hold,transfer,
  Device.connect({To,DispatcherId})       dialer_oidc_sub → dispatcher_<id>)                            conference/*,recording/control,
  EventSource /api/dialer/stream ◀── SSE passthrough ◀─────────────────────────────────────────────── /dialer/api/stream (EVENTS_BUS DO)
  call_status/recording_ready ──▶ POST /api/dialer-connect/events   (existing archive + PDFs, unchanged)
```

Twilio signaling/media is browser ↔ Twilio directly. Only tokens, control
calls and the event stream hop through the Flex Worker.

### Identity

Worker resolves JWT user → `users.dialer_oidc_sub`. Present → identity
`dispatcher_<sub>` and header `X-RMPG-Dispatcher-Id: <sub>`. Absent →
`409 { code: 'dialer_unlinked' }`; the client shows `LinkDialerGate` with the
existing "Sign in with Dialer" flow (`/api/oidc/dialer/login`). The SSO
callback links by e-mail, so each dispatcher sees the gate once. If the e-mail
does not match a dispatch-app user, the existing SSO error text tells them to
contact an administrator.

### Rollout switch

`localStorage.rmpg_dialer_iframe === '1'` → `Layout` mounts the legacy
`DialerPanel` iframe instead of `SoftphoneProvider` + global toasts. Default
is native. Same pattern as the legacy-theme kill-switch; no deploy needed to
fall back. `DialerPanel` is deleted in P6.

## rmpg-flex client

New directory `client/src/dialer/`. `DialerConnectPage.tsx` keeps its tabs,
Voicemail and Call History untouched; the Softphone card is replaced.

| Unit | Responsibility |
|---|---|
| `SoftphoneProvider` (context, mounted once in `Layout`) | Owns the single `Device`. State: `offline → registering → ready → incoming \| in_call \| call_waiting → error`, plus `unlinked`. Token refresh at 55 min, deferred while a call is active. Heartbeat every 30 s while registered. Emits archive events. |
| `useSoftphone()` | Read state + actions: `dial`, `answer`, `reject`, `hangup`, `mute`, `hold`, `sendDigits`, `transferBlind`, `transferWarm`, `addParty`, `recording`, `duress`, `setPresence`. |
| `useDialerStream()` | One `EventSource` to `/api/dialer/stream`; dispatches `call_status`, `duress_alert`, `presence`, `alarm`. Reconnects with backoff. |
| `SoftphoneCard` | Keypad, number display, contextual primary button (Call / Answer+Reject / Hang up), Mute, Hold/Resume, Record, Dial/DTMF toggle, Transfer (blind / warm picker), Conference add, caller-ID block, audio-device picker, live call timer, error line. |
| `IncomingCallToast`, `DuressBanner` | Global, in `Layout`. Click → `/dialer-connect`. Ring tone via existing `voiceAlerts`. |
| `LinkDialerGate` | Shown on `unlinked`: explanation + "Sign in with Dialer". |
| `PresenceBar` | My status → `PUT /api/dialer-connect/presence` (existing) and heartbeat; team list from `/api/dialer/presence` for warm transfer. |
| Pop-out | `window.open('/dialer-connect?popout=1', 'rmpg-dial-connect')`. The pop-out registers the Device; the opener's provider goes passive (`BroadcastChannel('rmpg-dialer')` leader election) so one Twilio client is registered per dispatcher. |

### Button → function map

| Button | Action |
|---|---|
| KEYPAD / PLACE CALL → Call | `Device.connect({ params: { To, DispatcherId, CallerIdBlocked } })` |
| Answer / Reject | `call.accept()` / `call.reject()` |
| HANG UP / MUTE | `call.disconnect()` / `call.mute(bool)` |
| HOLD / RESUME | `POST /api/dialer/voice/hold { callSid, hold }` |
| IN-CALL DTMF | keypad in DTMF mode → `call.sendDigits(d)` |
| BLIND TRANSFER | `POST /api/dialer/voice/transfer { callSid, targetDispatcherId }` |
| WARM TRANSFER | `POST /api/dialer/voice/conference/add-dispatcher { callSid, targetDispatcherId }` |
| ADD CONFERENCE PARTY | `POST /api/dialer/voice/conference/add { callSid, phoneNumber }` |
| START / STOP RECORDING | `POST /api/dialer/voice/recording { callSid, action }` |
| Duress (hotkey + button) | `POST /api/dialer/voice/duress` |
| CALLER ID LOOKUP | existing `/api/dialer-connect/lookup` |
| SPEED DIAL, LINK CALL TO CFS, CALL DISPOSITION, SCHEDULE CALLBACK, AGENT PRESENCE | existing `/api/dialer-connect/*`; wrap-up pre-fills `call_sid`, number, direction and duration from the live call |

`callSid` sent to control routes is the caller's CallSid:
`call.customParameters.get('CallerCallSid') ?? call.parameters.CallSid`
(same rule dispatch-app's `useSoftphone` documents).

### Archive events

On `call.on('accept'|'disconnect'|'cancel'|'reject')` and on stream
`call_status` for the active call, the provider posts the same payloads
`DialerPanel` posts today (`type: 'call_status'`, `recording_ready`,
`voicemail`) to `POST /api/dialer-connect/events`. The Worker-side upsert
rules from CLAUDE.md are unchanged.

## rmpg-flex-api Worker

New router `src/routes/dialerVoice.ts`, mounted at `/api/dialer`
(`auth: 'required'`, `client_viewer` excluded via `readOnlyRoleGuard`).
Vars/secrets: `DIAL_CONNECT_API_BASE = "https://rmpgutah.us/dialer"`,
secret `DIAL_CONNECT_SERVICE_KEY`.

| Route | Upstream | Notes |
|---|---|---|
| `POST /token` | `POST /api/voice/token` | body `{ token, identity, expiresAt }` |
| `POST /presence/heartbeat` | `POST /api/voice/presence/heartbeat` | |
| `GET /presence` | `GET /api/voice/presence` | |
| `POST /voice/hold` | same | |
| `POST /voice/transfer` | same | |
| `POST /voice/conference/add-dispatcher` | same | |
| `POST /voice/conference/add` | same | |
| `POST /voice/recording` | `POST /api/voice/recording/control` | new upstream |
| `POST /voice/duress` | same | |
| `GET /stream` | `GET /api/stream` | return upstream `Response` body as-is (`text/event-stream`, `Cache-Control: no-cache`) |

Every upstream call sends `X-RMPG-Service-Key` and `X-RMPG-Dispatcher-Id`.
Bodies are validated with zod before forwarding (`callSid` non-empty string;
`hold` boolean; `phoneNumber` E.164 via existing normaliser;
`action` in `start|stop`).

Error contract (JSON, never a bare 5xx):

| Condition | Response |
|---|---|
| user has no `dialer_oidc_sub` | `409 { code: 'dialer_unlinked' }` |
| upstream unreachable / 5xx / timeout (8 s) | `503 { code: 'dialer_unreachable' }` |
| upstream 401/403 | `403 { code: 'dialer_forbidden', details }` |
| upstream 4xx other | pass status + body through |

Unset `DIAL_CONNECT_SERVICE_KEY` → `200 { ok: false, code: 'not_configured' }`
on `/token` (repo convention), so the UI shows a configuration notice.

## dispatch-app changes (small)

1. `src/lib/actor.ts#resolveActor(request)`: NextAuth session → user (as
   today); else if `X-RMPG-Service-Key` equals `RMPG_FLEX_SERVICE_KEY` and
   `X-RMPG-Dispatcher-Id` names an `active` `dispatcher|admin` User → that
   user; else `null` (→ 401). Used by: token, presence (GET + heartbeat),
   hold, transfer, conference/add, conference/add-dispatcher, duress,
   recording/control, stream.
2. `api/voice/recording/control` (new): `{ callSid, action }`. Looks up the
   conference for `callSid` as `hold` does; `start` →
   `POST /Conferences/{sid}/Recordings`, `stop` → update recording status
   `stopped`. Returns `{ status }`. Reuses `getTwilioClient()`.
3. Every browser URL keeps going through `apiUrl()` (basePath rule).

## Testing

- Worker (Miniflare): token linked/unlinked/upstream-500; header forwarding
  on `voice/hold`; SSE passthrough content-type; zod rejections.
- dispatch-app (vitest): `resolveActor` four cases; `recording/control`
  start/stop with mocked Twilio client, 404 when no conference.
- Client (vitest + jsdom): `SoftphoneProvider` state machine with a
  `MockDevice` (ported from dispatch-app `lib/mock-twilio.ts`); every
  `SoftphoneCard` button dispatches its mapped action; `LinkDialerGate` on
  409; kill-switch mounts `DialerPanel`; wrap-up pre-fill from live call.
- Manual acceptance before removing the kill-switch default: outbound call;
  inbound ring-group call answered in Flex; hold/resume; blind + warm
  transfer between two linked dispatchers; conference add; recording
  start/stop shows `Archived` in Call History; pop-out registers while the
  opener stays passive; duress banner in a second tab.

## Rollout

1. Set `RMPG_FLEX_SERVICE_KEY` on Worker `dialer`, `DIAL_CONNECT_SERVICE_KEY`
   on `rmpg-flex-api` (same random value).
2. Deploy dispatch-app (manual `npm run deploy`), then merge/deploy rmpg-flex.
3. Each dispatcher clicks "Sign in with Dialer" once.
4. Document `rmpg_dialer_iframe=1` in CLAUDE.md as the fallback.
