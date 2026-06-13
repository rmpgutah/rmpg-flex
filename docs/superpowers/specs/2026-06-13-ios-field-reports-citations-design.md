# iOS Field Reports & Citations — Design

**Date:** 2026-06-13
**Status:** Approved (brainstorming complete)
**App:** `ios/RMPGFlexTester` (native SwiftUI field-ops companion to the RMPG Flex CAD/RMS)
**Sub-project:** A of a 4-part "iOS significant upgrades" program (see Roadmap below)

---

## 1. Context

The iOS app (`RMPGFlexTester`) is a mature SwiftUI field-ops companion: 7 tabs, JWT'd
access to `api.rmpgutah.us`, background duty/GPS, AAMVA/MRZ ID scanning, on-device
field calculators, and a notifications inbox. It is signed with a **free Apple ID /
personal team** (7-day sideload), which rules out APNs remote push, an Apple Watch
companion, and data-sharing widgets — but leaves everything in this sub-project fully
buildable.

Today the phone can *read* records and *dispatch* itself, but it **cannot author the
two documents officers produce most in the field**: incident reports and citations.
Both already have complete server APIs; the gap is purely client-side.

### Roadmap (for context; only sub-project A is in scope here)
- **A — Field Reports & Citations** ← this spec
- B — Always-On Officer Safety (App Intents + local Live Activity)
- C — Live & Resilient Dispatch (WebSocket feed + offline-first queue)
- D — Navigate & Know (Mapbox turn-by-turn + units map + BOLO feed)

---

## 2. Goal & non-goals

**Goal:** Let an officer write, dictate, photo-document, and submit an **incident
report** and a **citation** entirely from the phone, against the existing server APIs,
with honest handling of the server's NIBRS validation gate.

**Non-goals (banked for later):**
- APNs / Apple Watch / Home Screen widgets (require paid Apple Developer Program).
- Robust offline-first queue with replay (that is sub-project C; here we add only thin
  local autosave as crash insurance — the server `draft` status is the real persistence).
- Supervisor **approve/return** UI (stays desktop-side for v1; those are `REVIEW_ROLES`).
- Server-side AI narrative cleanup (blocked on the Anthropic $0-credit issue noted in
  project memory; dictation is 100% on-device Apple Speech, no Anthropic dependency).

---

## 3. Server contracts being consumed (already live)

### Incidents (`/api/incidents`, `officer` ∈ WRITE_ROLES)
- `POST /` — body `{ incident_type, location_address, priority?, call_id?, narrative?,
  latitude?, longitude? }`. Creates a **`draft`** with auto `incident_number`
  (`YY-RMP-NNNNN`), auto-geocode, auto-geofence. Returns the created row (201).
  Required: `incident_type`, `location_address`.
- `PUT /:id` — edits a `draft`/`returned` incident. Editable:
  `incident_type, priority, location_address, latitude, longitude, narrative`.
- `PUT /:id/submit` — **NIBRS gate.** Requires non-empty `narrative`. On failure returns
  **HTTP 422** `{ error, code: 'NIBRS_VALIDATION_FAILED', validation }`. On success
  flips status to `submitted` and returns the row + `validation`. (`force=1` is admin-only;
  the field app never forces.)
- `GET /` and `GET /:id` — list/detail for "My Drafts / Returned".

### Citations (`/api/citations`, `officer` ∈ allowed roles)
- `POST /` — required `violation_description` (non-empty) and `violation_date`
  (`YYYY-MM-DD`). `type` defaults to `traffic` (must be in server `VALID_TYPES`).
  `fine_amount`, if present, must be a non-negative number. Large optional allow-list:
  `person_{name,dob,dl,address,id}`, `vehicle_{plate,state,year,make,model,color,vin,description,id}`,
  `statute_citation`, `offense_level`, `fine_amount`, `bond_amount`, `speed_recorded`,
  `speed_limit`, `radar_type`, `is_warning`, `school_zone`, `construction_zone`,
  `dui_related`, `accident_related`, `violation_time`, `location`, `latitude`, `longitude`,
  `court_{date,time,room,name,address}`, `appearance_required`, `notes`, `call_id`,
  `incident_id`. Returns `{ data, citation_number }` (201).

### Field photos (`/api/field-photos`)
- `POST /` — **multipart** `{ photo, lat?, lng?, call_id?, notes? }`, R2-backed,
  table `field_photos`. **Server change required (see §6):** add `incident_id`.

---

## 4. Architecture — new iOS components (all in the main app target)

| File | Responsibility | Public interface |
|---|---|---|
| `Dictation.swift` | On-device speech-to-text. `SFSpeechRecognizer` + `AVAudioEngine`. Streams live partial transcripts; caller appends them into any field. | `final class Dictation: ObservableObject` — `@Published transcript: String`, `@Published isListening: Bool`, `@Published authorized: Bool`; `func requestAuth()`, `func start()`, `func stop()`. |
| `MultipartUpload.swift` | One shared multipart-body builder + POST. Extracted from the duplicated logic in `FieldPhotoView` and `FuelAndPhotos`; both refactored onto it. | `static func upload(_ client: RMPGAPIClient, path: String, fields: [String:String], jpeg: Data, fileField: String, filename: String) async throws -> [String:Any]` |
| `ReportsHubView.swift` | New entry surface. "My Drafts / Returned" list (`GET /api/incidents`), "New Incident Report", "New Citation", recent submitted. | SwiftUI `View` |
| `IncidentReportView.swift` | The report workflow: create draft → structured fields + dictatable narrative → evidence photos → submit with NIBRS-422 handling. | SwiftUI `View`; optional `init(prefill: CallPrefill?)` |
| `CitationWriterView.swift` | E-citation form → `POST /api/citations`. Pre-fills person/vehicle from a prior scan when handed one. | SwiftUI `View`; optional `init(prefill: ScanPrefill?)` |

**Integration points:**
- New **Reports** entry in the app. Primary placement: a card on `FieldOpsView` and an
  entry in the `SystemHubView` list (final tab placement decided in the plan — the tab
  bar is already at 7 items, so Reports is reached via Field Ops + System rather than a
  new root tab, to avoid iOS folding tabs into the unthemeable "More" list).
- Contextual entry from the **assigned-call card** in `FieldOpsView`: a "Write report on
  this call" action constructs a `CallPrefill` (`call_id`, `location_address`, `lat/lng`,
  `incident_type` seeded from the call type) and pushes `IncidentReportView`.
- Reuse existing: `RMPGAPIClient` (incl. `apiBody(error)` for the 422 payload),
  `KeychainStore`, `LocationManager`, `Theme.swift` (`GoldButtonStyle`, `RaisedButtonStyle`,
  `.themeCard()`, `SectionHeader`, `StatusLine`), and the camera capture from `FieldPhotoView`.

---

## 5. UX & workflow design

**Design stance: guided workflow over forms.** The app is used one-handed, in sunlight,
sometimes gloved — so large tap targets, minimal typing, thumb-zone primary actions, and
honest status take priority over field density.

### Principles
1. **Stepped, not sprawling.** Incident report flows `Type → Location → Narrative → Photos
   → Review` with progress pills; citation is a short scrollable card-stack
   (subject → vehicle → violation → issue) because it's a one-screen task.
2. **Thumb-zone primary action.** A single gold primary button is pinned at the bottom of
   every step; secondary/destructive actions are de-emphasized text.
3. **One-tap common cases.** Incident-type chips and common-violation chips short-circuit
   typing for the 80% case; a prominent Warning ⇄ Citation segmented toggle leads the
   citation screen.
4. **Dictation-first narrative.** A large mic sits at the center of the narrative step — the
   report's heaviest field becomes its easiest, hands-busy input.
5. **Always-saved.** A persistent "Saved" indicator (server `draft` + local autosave) so
   work is never lost in a dead zone.
6. **Honest readiness.** Green checks / amber fixes — never a silent failure.
7. **Prefill is the glue.** "On this call" carries `call_id`/location/coords into a report;
   an ID/plate scan carries subject + vehicle into a citation. The officer confirms, doesn't
   retype.

### Screen flow (4 key surfaces)
1. **Reports hub** — an "On this call" contextual card, two large action tiles (Incident
   report / Citation), and "Continue draft" rows with a readiness ring. Reached via a Field
   Ops card + the System hub (no 8th root tab — iOS folds >5 tabs into the unthemeable "More"
   list; final placement is a plan-time call).
2. **Compose (narrative step)** — step pills, a live-transcript narrative card, a large gold
   mic + waveform, inline evidence-photo thumbnails + an add tile, and a pinned "Next: review".
3. **Review & submit** — a NIBRS-readiness checklist (present = green check, missing = amber +
   a one-tap **Fix**) shown **before** submit; a report summary; a pinned "Submit report" with
   a quieter "Save as draft".
4. **Citation** — the Warning ⇄ Citation toggle, scan-prefilled subject + vehicle cards (with a
   "Scanned" badge), a statute search + common-violation chips, and a pinned "Issue citation".

### New reusable views (small, single-purpose)
`StepPills`, `ReadinessRow` (check/alert + optional Fix action), `DictationBar` (mic +
waveform bound to `Dictation.transcript`), `ChipRow` (tappable suggestion chips), and
`PrefillCard` (subject/vehicle confirm card). These compose with existing `Theme.swift`
tokens and `GoldButtonStyle`/`.themeCard()` — no new visual language.

### Readiness model (screen 3)
The checklist is computed **client-side** from the same requirements the server's
`validateIncidentForNibrs` enforces (type, location, non-empty narrative, offense/victim
data), so it can be shown proactively. The server `submit` stays authoritative: a 422 maps
its `validation.errors` onto the same checklist rows. The client mirror is a *hint*, never a
gate.

This UX layer adds **no contract changes** — it sits entirely on top of §3 and §7.

---

## 6. Server change — link evidence photos to incidents

Add `incident_id` to `field_photos` so a report's evidence binds to the report itself
(not only to a call — a report is not always tied to a call).

In `src/routes/fieldPhotos.ts`:
1. Add `incident_id INTEGER` to the `CREATE TABLE IF NOT EXISTS` in `ensureTable()`.
2. In `ensureTable()`, add a best-effort `ALTER TABLE field_photos ADD COLUMN incident_id INTEGER`
   wrapped in try/catch (D1 has no `IF NOT EXISTS` on ADD COLUMN; swallow the re-apply error —
   same boot-reconciler posture already used in this file).
3. Parse `incident_id` from the multipart form (same int-coercion as `call_id`).
4. Include `incident_id` in the `INSERT` column list and value tuple.
5. Add `incident_id` to the `GET /` filter allow-list (so the desktop/report can list a
   report's photos).

**Live D1:** apply the `ALTER TABLE field_photos ADD COLUMN incident_id INTEGER` directly
to live `rmpg-flex` (`785de7ae-…`) via the Cloudflare D1 API after merge, and verify with
`pragma_table_info('field_photos')` — per the project rule that migrations routinely fail
to reach live silently. `field_photos` has ~11 columns; no 100-column-cap concern, no
migration-file needed (the table is bootstrapped by `ensureTable`, not by `migrations/`).

A migration file under `migrations/` is **optional** here (the table is code-bootstrapped);
if added for record-keeping it must be idempotent and is not relied upon for live.

---

## 7. Data flows

### Incident report
1. Open writer (blank, or with `CallPrefill`). On first meaningful input, **POST `/api/incidents`**
   to create the server `draft` → capture `id` + `incident_number`. Show the assigned number.
2. Field edits (type, location, priority, narrative) **PUT `/:id`** debounced (~1.5 s after
   typing/dictation stops). Narrative also mirrored to a local autosave key
   (`UserDefaults`/file, keyed by incident id) as crash insurance.
3. **Attach evidence photos** → camera capture → `MultipartUpload.upload` to
   `/api/field-photos` with `incident_id` (+ `call_id`, `lat/lng` when available).
4. **Submit** → `PUT /:id/submit`.
   - **201/200:** show success with `incident_number`; pop to Reports hub.
   - **422 `NIBRS_VALIDATION_FAILED`:** parse `apiBody(error)["validation"]`; render
     `validation.errors` as an actionable checklist with two choices: **Fix now** (stay) or
     **Save as draft** (leave server-side draft to finish on desktop/later). Never a dead-end.
   - **400 `INC_NARRATIVE_REQUIRED`:** focus the narrative field with a clear prompt.
5. Connectivity loss at submit: the draft already exists server-side; tell the officer it's
   saved as a draft to finish later (no data loss).

### Citation
1. Open writer (blank, or with `ScanPrefill` from a prior ID/plate scan → person/vehicle fields).
2. Fill violation (`violation_description`, `violation_date` default = today, `type`,
   `statute_citation`, speed/fine/court as applicable). Inline client validation mirrors the
   server: non-empty description, `violation_date` matches `YYYY-MM-DD`, `fine_amount` ≥ 0.
3. Optional dictation into `notes` / `violation_description`.
4. **POST `/api/citations`** → on 201 show `citation_number`; offer "Attach photo" (reuses
   `MultipartUpload` with `incident_id`/`call_id` when linked) and "New citation".

---

## 8. Voice dictation (on-device)

- `SFSpeechRecognizer(locale:)` + `AVAudioEngine` tap → `SFSpeechAudioBufferRecognitionRequest`
  with `requiresOnDeviceRecognition = true` where supported (offline + private), falling back
  to default recognition when on-device is unavailable for the locale.
- Mic button in the narrative/notes toolbar. Live partial results stream into `@Published transcript`;
  the view appends finalized segments to the field. Tap to stop; auto-stop on silence timeout.
- **Info.plist keys** (the project uses a generated Info.plist, so set via `INFOPLIST_KEY_*`
  build settings in `project.pbxproj`):
  - `NSMicrophoneUsageDescription` — "RMPG Flex uses the microphone to dictate report and
    citation narratives."
  - `NSSpeechRecognitionUsageDescription` — "RMPG Flex transcribes your dictation on-device
    to fill report narratives."
- No Anthropic / network dependency; works in dead zones for supported locales.

---

## 9. Error handling & honesty

- **NIBRS 422** surfaced as a concrete field checklist (from `validation.errors`), with
  Fix-now / Save-as-draft — not "submit failed".
- **401** reuses the existing re-login-on-401 pattern (`client()` → `authed { }` from
  `FieldOpsView`/`BackgroundDuty`); factor that pattern so the new views share it rather
  than re-implementing.
- **Offline:** writes that can't reach the server keep the draft locally + server-draft
  already created; surfaced as "saved as draft" rather than a silent failure.
- All server-error `code` values are read via `RMPGAPIClient.apiCode`/`apiBody` and mapped
  to human text (no string-matching of `error` messages).

---

## 10. Security & roles

- All calls JWT-bearer'd. `officer`+ may create/edit/submit incidents and create citations.
- The field app **never** renders approve/return (supervisor-only); v1 keeps review desktop-side.
- Evidence photos remain Worker-streamed (private R2), unchanged.

---

## 11. Testing & verification

Following the README's documented workaround for this Mac's `xcodebuild` deadlock
(SwiftPM `swift test` + `swiftc` compile; **no new Xcode target** is introduced, so this
stays valid):

- **Unit tests** (mirror `RMPGFlexTesterTests` style):
  - `Dictation` state machine (idle→listening→stopped; auth-denied path).
  - `MultipartUpload` body framing (boundary, field parts, file part headers).
  - NIBRS-422 parsing → `validation.errors` extraction from an `NSError` userInfo `json`.
  - Citation client validation (date regex, `fine_amount ≥ 0`, type fallback).
- **Compile check:** `xcrun -sdk iphonesimulator swiftc` over the new files (as in README).
- **Server:** `npm run typecheck` for the `fieldPhotos.ts` change.
- **Live smoke (post-merge):** create a draft incident from the phone, submit, observe the
  422-or-success path; upload an evidence photo and confirm the `incident_id` row via the D1
  Console tab. Apply + verify the live-D1 `ALTER` per §6.

---

## 12. Acceptance criteria

1. From the phone, an officer can create an incident draft, dictate/type a narrative, attach
   ≥1 geo-stamped evidence photo linked by `incident_id`, and submit it.
2. A NIBRS-incomplete submit shows the specific missing fields and offers Fix-now / Save-as-draft.
3. From the phone, an officer can issue a citation (with client-side validation matching the
   server) and receive a `citation_number`.
4. Dictation runs on-device, prompts for mic + speech permission with clear strings, and
   streams partial transcripts into the field.
5. `FieldPhotoView` and `FuelAndPhotos` are refactored onto the shared `MultipartUpload`
   helper with no behavior change.
6. The incident flow is presented as discrete steps with a single pinned gold primary action
   per step; the NIBRS-readiness checklist renders **before** submit; the citation screen leads
   with a Warning ⇄ Citation toggle and offers common-violation chips. (§5)
7. Prefill works end-to-end: "On this call" seeds `call_id`/location/coords into a report; an
   ID/plate scan seeds subject + vehicle into a citation.
8. New unit tests pass via `swift test`; `swiftc` compile is clean; server `typecheck` passes.
9. `field_photos.incident_id` exists on live D1 (verified via `pragma_table_info`).

---

## 13. Out of scope / explicitly deferred

- Sub-projects B/C/D (push/Watch/widgets, offline queue, Mapbox nav, AI).
- Supervisor approve/return on phone.
- Server-AI narrative assist (Anthropic credits blocked).
- Rich text / templated narratives (desktop Doc Writer territory).
