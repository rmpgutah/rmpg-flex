# GPS Hardening Design — Approach A
**Date:** 2026-08-18  
**Branch:** claude/gps-location-tracking-issues-42abb5  
**Pain points addressed:** C (lag), D (urban dropout/drift), B (erratic heading — already fixed via `blendAngle`)

---

## Background

The Toughbook FZ-55 exposes its u-blox GPS module as a virtual COM port. `desktop/internalGps.js` already parses GGA, RMC, VTG, GLL, GSV, implements dead reckoning, baud auto-detect, and fix quality classification. The gaps are purely in chip configuration and client-side quality policy.

**Root causes of the three pain points:**

| Pain | Root cause | Approach A fix |
|------|-----------|---------------|
| C — lag | Chip defaults to 1 Hz; batch interval 5 s → up to 6 s behind | UBX-CFG-RATE → 5 Hz; batch 1 s on Windows |
| D — urban drift | `fixQuality: 'poor'` fixes (HDOP > 5) accepted and overwrite last good fix | Gate ingestion: skip `poor` if last good fix < 30 s |
| B — erratic heading | `blendAngle(prev, candidate, 0.35)` already applied in `useGpsTracking.ts` | No change needed |

---

## Change 1 — `desktop/internalGps.js`: UBX-CFG-RATE at 5 Hz

After the baud rate locks onto the first valid NMEA sentence (`this.gotValidData = true`), write a 14-byte UBX binary frame to the serial port to set the chip's measurement rate to 200 ms (5 Hz):

```
B5 62 06 08 06 00 C8 00 01 00 01 00 DE 6A
│     │  │  │     │     │     │     │
│     │  │  │     │     │     │     └─ CK_A=DE, CK_B=6A (Fletcher over Class..Payload)
│     │  │  │     │     │     └─ timeRef=1 (GPS time), LE u16
│     │  │  │     │     └─ navRate=1 (1 nav solution per measurement), LE u16
│     │  │  │     └─ measRate=200 ms (0x00C8), LE u16
│     │  │  └─ Length=6 bytes, LE u16
│     │  └─ Message ID 0x08 (RATE)
│     └─ Class 0x06 (CFG)
└─ UBX sync chars B5 62
```

**Delivery:** `this.port.write(Buffer.from([0xB5,0x62,0x06,0x08,0x06,0x00,0xC8,0x00,0x01,0x00,0x01,0x00,0xDE,0x6A]))`

No ACK is parsed — fire-and-forget. If the chip doesn't support CFG-RATE (rare, only pre-8-series u-blox), it silently ignores the frame and stays at 1 Hz. Logged with `[INTERNAL-GPS] Sent UBX-CFG-RATE 5Hz` so field techs can confirm.

**Why 5 Hz and not 10 Hz?** The u-blox NEO-M8N's serial line at 9600 baud saturates above ~5 Hz with the default sentence mix (GGA+RMC+VTG+GSV). 10 Hz requires disabling GSV first via another UBX command; 5 Hz works with the default sentence set.

---

## Change 2 — `client/src/hooks/useGpsTracking.ts`: 1 s batch on Windows

`DEFAULT_BATCH_INTERVAL` stays at 5000 ms for all other platforms. On `IS_WINDOWS_ELECTRON`, the batch interval that arms in `startTracking()` and the auto-start effect is hardcoded to `WINDOWS_INTERNAL_BATCH_MS = 1000`.

This reduces server-side position latency from up to 5 s to 1 s, so the AlertHubDO `unit_position` fan-out reaches map clients roughly every 1–2 s instead of 5–6 s.

---

## Change 3 — `client/src/hooks/useGpsTracking.ts`: Quality-gated ingestion

`ingestPosition()` currently receives a `fixQuality` field (one of `'excellent' | 'good' | 'degraded' | 'poor'`) from the Electron GPS IPC event but ignores it. The fix:

- Extend the `coords` parameter type to accept optional `fixQuality`.
- Skip ingestion when `fixQuality === 'poor'` AND the last accepted fix is < `POOR_FIX_SKIP_WINDOW_MS` (30 000 ms). This prevents a parking-garage signal from overwriting the last good road fix during a brief signal loss.
- When no accepted fix exists yet, accept `'poor'` fixes anyway — something is better than nothing during initial acquisition.

The `shouldAcceptPoint` accuracy gate still applies independently; quality gating is additive.

---

## Change 4 — `client/src/hooks/useGpsTracking.ts`: Propagate `fixQuality` to upload

The `QueuedPoint` type gains an optional `fixQuality` field. `sendBatch` includes it in the JSON body sent to `POST /dispatch/gps`. The server currently ignores unknown fields, so no migration needed; the field is available if the server wants to log it in `gps_breadcrumbs` later.

---

## Files changed

| File | Change |
|------|--------|
| `desktop/internalGps.js` | Write UBX-CFG-RATE frame after baud lock (inside `_handleLine`) |
| `client/src/hooks/useGpsTracking.ts` | Windows 1 s batch; `fixQuality` gating in `ingestPosition`; `fixQuality` in `QueuedPoint` + upload |

No D1 migrations, no server routes, no new npm packages required.

---

## Fallback / degradation

- UBX write fails (port not writable): `port.write` callback receives an error → log warn, continue. GPS still works at 1 Hz.
- All fixes are `'poor'` for > 30 s (deep tunnel): `POOR_FIX_SKIP_WINDOW_MS` expires → `poor` fixes accepted again, so the officer is never location-less indefinitely.

---

## Success criteria

- After first valid NMEA lock, console shows `[INTERNAL-GPS] Sent UBX-CFG-RATE 5Hz`
- Position events arrive at ~5 Hz (confirm via `onInternalGpsUpdate` log cadence)
- Map unit marker updates ~every 1–2 s on the dispatcher console (was 5–6 s)
- A fix arriving with `fixQuality: 'poor'` within 30 s of a good fix is not sent to the server

---

## Out of scope

- UBX-ACK-ACK parsing (Approach C)
- 10 Hz output rate
- Kalman filter
- Server-side `gps_breadcrumbs` schema change to store `fixQuality`
