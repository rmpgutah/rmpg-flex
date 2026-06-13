# iOS Shift Module — Admin-Level Duty Management (2026-06-12)

## Goal
Make the iOS field app (`ios/RMPGFlexTester`) fully admin-functional for shift
management: dispatch-tier users (admin / manager / supervisor / dispatcher) can
see who is on duty, start/end shifts on another officer's behalf, and correct
time entries — while the officer's own start/end flow gains full parity with
the server's 409 contract.

## What already exists (reused, not rebuilt)
- Worker `src/routes/dispatch/duty.ts`: `GET /me`, `POST /start`, `POST /end`
  with on-behalf support (`officer_id` body/query param, gated by
  `ON_BEHALF_ROLES`), mileage validation (409 codes `NEEDS_VEHICLE`,
  `NEEDS_MILEAGE`, `MILEAGE_TOO_HIGH`, `MILEAGE_DECREASING`), resume guard.
- Worker `src/routes/personnel.ts`: `GET/POST /personnel/time`,
  `PUT /personnel/time/:id` — audited (`time_entry_edits`), reason required,
  gated by `requireTimeWriter` (`TIME_WRITE_ROLES`).
- iOS: `FieldOpsView` (duty card, 10 s poll, GPS push), `ShiftStartSheet` /
  `ShiftEndSheet` (pre/post-trip inspections), `RMPGAPIClient`, `BackgroundDuty`.
- `units` table mirrors last GPS fix (`latitude`, `longitude`, `gps_updated_at`).

## New Worker code (only one route file touched: `duty.ts`)
`GET /api/dispatch/duty/roster` — dispatch-tier only (reuse `ON_BEHALF_ROLES`;
403 otherwise). Returns `{ officers: [...] }` where each row is:
`officer_id, name, role, on_shift, clock_in, entry_id, hours_so_far,
unit {id, call_sign, status, current_call_id}, vehicle {id, vehicle_number,
vehicle_name}, last_gps {lat, lng, at}`.
Implementation: active users (`status != 'terminated'`/inactive excluded) LEFT
JOIN open `time_entries` (clock_out IS NULL) LEFT JOIN `units` (officer claim)
LEFT JOIN `fleet_vehicles` (assigned_unit_id). GPS from the units mirror — no
breadcrumb scan. On-shift first, then alphabetical.

## iOS changes
1. **`JWTClaims.swift`** (new): base64url-decode the JWT payload → `role`,
   `userId`, `name`, `exp`. Pure function, unit-tested. Dispatch-tier check
   mirrors `ON_BEHALF_ROLES`.
2. **`DutyRosterView.swift`** (new): new "Roster" tab. If the logged-in role is
   not dispatch-tier, shows a locked message. Otherwise: 10 s-polled roster
   list (on-duty section with hours / unit status / vehicle / GPS age, off-duty
   section), per-row actions:
   - Start Shift → `ShiftStartSheet` in on-behalf mode
   - End Shift → `ShiftEndSheet` in on-behalf mode
   - Edit Times → `TimeEntryEditSheet` (new): pick from the officer's recent
     entries (`GET /personnel/time?officer_id=`), edit clock_in / clock_out /
     break_minutes, **reason required**, `PUT /personnel/time/:id`.
3. **`ShiftVehicleSheets.swift` hardening**: both sheets accept an optional
   `onBehalfOfficerId` (sent as `officer_id`); 409 handling becomes
   code-driven: `NEEDS_VEHICLE` re-presents the picker with the returned list,
   `NEEDS_MILEAGE` focuses the odometer field, `MILEAGE_DECREASING` prompts for
   an `override_reason` and retries, `MILEAGE_TOO_HIGH` shows the typo warning.
4. **`App.swift`**: add the Roster tab.

## Security
Server-authoritative: iOS role decoding is UI-gating only; every admin write is
re-checked by `ON_BEHALF_ROLES` / `TIME_WRITE_ROLES` on the Worker.

## Testing / verification
- Worker: `npm run typecheck` (no Worker test suite exists yet).
- iOS: XCTest additions for `JWTClaims` decode + roster JSON parse; compiled
  via `swiftc` on this Mac (xcodebuild hangs here); app build happens in the
  user's Xcode.
- Post-deploy: authenticated probe of `/api/dispatch/duty/roster`; D1 check of
  an edited entry's `time_entry_edits` rows.

## Out of scope
Web ShiftCard changes, future-shift scheduling, payroll exports, Android,
push notifications for shift events.
