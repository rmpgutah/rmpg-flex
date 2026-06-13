# Native iOS Background Interaction Recording

**Date:** 2026-06-12 · **Status:** Approved · **App:** `ios/RMPGFlexTester` · **Backend:** existing `/api/intel/recordings/*` (Wave 3b)

## Goal

The one thing the web can't do: record a full interaction with the **app
backgrounded / screen locked / app closed-to-the-user**, uploading audio to the
same R2-backed intel pipeline. Reuses the existing iOS app's JWT API client,
Keychain, and the background-mode precedent already used for duty location.

## Strategy: rotating segments + background audio mode

- `UIBackgroundModes = audio` + an active `AVAudioSession` (`.record`,
  `.mixWithOthers` off) keeps capture alive when the screen locks or the app is
  backgrounded — the same mechanism a music app uses.
- Record in **rotating 30-second segments** with `AVAudioRecorder` writing AAC
  `.m4a` files. On each rotation: finalize the segment, immediately upload it as
  the next chunk, start the next segment. A crash/kill loses at most the
  in-flight 30 s; everything else is already in R2.
- Segments map 1:1 onto the existing chunk API (`seq` = segment index).

## Backend touch (one small, backward-compatible change)

The chunk GET currently hard-codes `audio/webm`. Add an optional `mime` on
`POST /recordings/start` (stored in `interaction_recordings.mime`, already a
column) and have `GET /recordings/:id/chunk/:seq` return that stored mime so
iOS `.m4a` chunks play back correctly. Web recorder unchanged (defaults webm).

## iOS components (`ios/RMPGFlexTester/RMPGFlexTester/`)

- `AudioRecorder.swift` — `AVAudioSession` setup, segment rotation timer,
  `AVAudioRecorder` lifecycle, segment→chunk hand-off, start/stop. An
  `UploadQueue` (actor) holds pending segments and retries (3×) so a failed
  upload never blocks recording; persists pending segment file URLs so a relaunch
  resumes uploads.
- `RecordingAPI.swift` — thin calls on the existing `RMPGAPIClient`:
  `startRecording(meta) -> id`, `putChunk(id, seq, fileURL)` (raw PUT, m4a body),
  `stopRecording(id, duration)`. Adds a `putData` method to `RMPGAPIClient`
  (PUT with `Data` body + content-type) — the only client addition.
- `RecorderView.swift` — a new "Recorder" tab: REC button, elapsed timer,
  segment-uploaded counter, location/notes, a banner confirming background
  capture is enabled, and a recent-recordings list (from `GET /recordings`).
- `App.swift` — add the Recorder tab.
- Project config (`project.pbxproj`): `INFOPLIST_KEY_UIBackgroundModes = audio`,
  `INFOPLIST_KEY_NSMicrophoneUsageDescription`, applied to both build configs.

## Pure logic (unit-tested via SwiftPM — xcodebuild hangs on this Mac)

- `segmentFilename(recordingId, seq)`, `nextSeq(existing)`, upload-payload
  framing, retry/backoff decision. Tests live in the existing
  `/tmp/FlexTesterPkg`-style `swift test` harness mirrored under
  `ios/RMPGFlexTester/RMPGFlexTesterTests/RecordingTests.swift`.

## Error handling

- Mic-permission denial → clear state, no crash. Audio-session interruption
  (phone call) → pause + resume on `.ended`. Upload failure → queue + retry,
  recording continues. App relaunch → resume pending-segment uploads from disk.

## Verification (this Mac's xcodebuild deadlocks)

- `swift test` on the pure-logic package (per `ios/README.md` known-issue
  workaround) — must pass.
- Swift type-check the new files via `xcrun -sdk iphonesimulator swiftc
  -typecheck` where feasible.
- GUI build/run on device is the user's step (signing required); documented.

## Out of scope

Live streaming to dispatch (this is record-and-upload), transcription,
evidence-chain signing, Android.
