# iOS Field Workflows Platform — Design

**Date:** 2026-06-13
**Status:** Approved (brainstorming complete)
**App:** `ios/RMPGFlexTester` (native SwiftUI field-ops companion to the RMPG Flex CAD/RMS)
**Sub-project:** A of a 4-part "iOS significant upgrades" program (B/C/D summarized in §15)

> Supersedes the narrower "Field Reports & Citations" framing. Reports & citations are
> now the first two of ~13 workflows delivered by a shared **declarative workflow engine**.

---

## 1. Context

`RMPGFlexTester` is a mature SwiftUI field-ops companion: 7 tabs, JWT'd access to
`api.rmpgutah.us`, background duty/GPS, AAMVA/MRZ ID scanning, on-device field
calculators, a notifications inbox, person/plate lookup → dossier. It is signed with a
**free Apple ID / personal team** (7-day sideload), which rules out APNs push, an Apple
Watch companion, and data-sharing widgets — but everything in this sub-project is fully
buildable on free provisioning.

The phone can *read* records and *dispatch* itself, but it **cannot author the documents
and actions an officer produces on patrol**. RMPG is a **private-security company**, so
the daily core is not just police paperwork — it's **patrol tour checkpoint scans**,
**trespass/property** handling, **welfare checks**, and **daily activity**. The server
already exposes create endpoints for ~13 of these; the gap is purely client-side.

Rather than hand-build 13 screens, we build **one declarative workflow engine** plus a
**categorized workflow hub**. Adding a workflow becomes adding a *definition*.

---

## 2. Goal & non-goals

**Goal:** A field-workflows platform on the phone — a guided, dictation-capable,
photo-attaching, offline-tolerant engine that renders a registry of workflow definitions
against existing live APIs, shipping with ~13 workflows across reports, patrol/security,
people/cases, and civil/admin.

**Non-goals (deferred):**
- APNs / Apple Watch / widgets (paid Apple Developer Program) — sub-project B.
- Robust offline-first queue with replay — sub-project C (here: thin local autosave only).
- **Trespass-notice POST and Daily-Activity-Report backends** — no live create endpoint
  exists; these are a fast-follow with their own small spec (§15). The hub shows them as
  "coming" tiles, never as broken submits.
- Supervisor review actions (approve/return) — stay desktop-side for v1.
- Server-AI narrative assist (Anthropic credits blocked); dictation is 100% on-device.

---

## 3. The workflow engine (architecture)

The heart of the platform. Four well-bounded units:

### 3.1 `WorkflowDefinition` (data)
```
struct WorkflowDefinition {
  let id: String                 // "incident", "citation", "patrol_scan", …
  let title, icon: String        // SF Symbol
  let category: WorkflowCategory // .reports | .patrol | .people | .civil
  let roles: [String]            // visibility gate (e.g. ["admin","manager","supervisor","officer"])
  let submit: SubmitSpec         // .single(post:) | .lifecycle(create:update:finalize:)
  let encoding: BodyEncoding     // .json | .multipart
  let steps: [WorkflowStep]
  let prefill: [PrefillSource]   // .call | .scanSubject | .scanVehicle | .gps
  let success: SuccessSpec       // numberKeyPath + message template ("Issued {citation_number}")
}
struct WorkflowStep { let title: String; let fields: [WorkflowField]; let custom: CustomStep? }
struct WorkflowField {
  let key: String                // request body key
  let type: FieldType
  let label: String
  let required: Bool
  let options: [FieldOption]?    // chips/segmented/picker
  let defaultValue: FieldValue?
}
enum FieldType { case text, dictatableNarrative, chips, segmented, date, time,
                 number, toggle, photo, scanSubject, scanVehicle, statuteSearch,
                 signature, gpsLocation, picker }
enum SubmitSpec { case single(post: String)
                  case lifecycle(create: String, update: String, finalize: String) }
```

### 3.2 `WorkflowRenderer` (one SwiftUI view)
Renders any definition as a stepped flow: progress pills, a single pinned gold primary
action per step, autosave, prefill hydration, and submit. Responsibilities:
- Map each `FieldType` → its field-type view (§4); collect `[String: FieldValue]`.
- Encode the collected values → JSON or multipart body per `encoding`.
- **`.single`**: POST at the final step. **`.lifecycle`**: POST a `draft` on first
  meaningful input (capture id + number), PUT edits debounced, finalize on submit.
- **Generic validation handling:** on a 4xx with a `{ validation: { errors } }` or
  field-error body (read via `RMPGAPIClient.apiBody`), render a **readiness checklist**
  and let the officer fix-or-save-draft. This is one code path for all 13 workflows.
- 401 → reuse the shared re-login-on-401 helper (§11).

### 3.3 `WorkflowRegistry` (the catalog)
A static array of `WorkflowDefinition`s (§5). Pure data; unit-testable. Adding a workflow
edits this array (+ a new field-type view only if a genuinely new input appears).

### 3.4 `WorkflowHubView`
Renders the registry grouped by `category`, gated by the signed-in role, with search,
"Continue draft", and "On this call" context. The single entry surface.

**Why this shape:** each unit answers "what does it do / how is it used / what it depends
on" in isolation; the renderer is the only place that touches networking; definitions hold
no logic. New workflows can't destabilize existing ones.

---

## 4. Field-type library (reusable SwiftUI views)

One view per `FieldType`, each independently understandable + testable, all built from
`Theme.swift` tokens:

| View | FieldType | Notes |
|---|---|---|
| `TextFieldRow` | `text` | single/multi-line plain |
| `DictationBar` | `dictatableNarrative` | mic + waveform bound to `Dictation.transcript` (§9) |
| `ChipRow` | `chips` | tappable suggestion chips (incident types, common violations) |
| `SegmentedRow` | `segmented` | e.g. Warning ⇄ Citation |
| `DateRow` / `TimeRow` | `date`/`time` | default = now; `YYYY-MM-DD` / `HH:MM` |
| `NumberRow` | `number` | fine, speed, bond — non-negative validation |
| `ToggleRow` | `toggle` | booleans (school_zone, dui_related, …) |
| `PhotoStrip` | `photo` | camera capture → `MultipartUpload`, linked by `incident_id`/`call_id` |
| `ScanSubjectCard` | `scanSubject` | confirm/prefill from a prior ID scan |
| `ScanVehicleCard` | `scanVehicle` | confirm/prefill from a prior plate scan |
| `StatuteSearchField` | `statuteSearch` | search `/api/statutes`, fill `statute_citation` |
| `SignaturePad` | `signature` | on-device signature → base64 (reused for civil notices later) |
| `GPSLocationField` | `gpsLocation` | address + auto-GPS lat/lng from `LocationManager` |
| `PickerRow` | `picker` | enumerated options |

Plus the shared **`MultipartUpload`** helper extracted from the duplicated bodies in
`FieldPhotoView.swift:110` and `FuelAndPhotos.swift:19` (both refactored onto it — DRY
cleanup).

---

## 5. Workflow catalog — first batch (~13, all live-backend)

Each row is one `WorkflowDefinition`. `LC` = `.lifecycle`, `1` = single POST.

### Field reports (`.reports`)
| id | Title | Submit | Endpoint(s) | Key fields |
|---|---|---|---|---|
| `incident` | Incident report | LC | `POST /api/incidents` → `PUT /:id` → `PUT /:id/submit` | type(chips), location(gps), priority(seg), narrative(dictate), photos |
| `citation` | Citation / warning | 1 | `POST /api/citations` | warning⇄citation(seg), subject(scan), vehicle(scan), violation_description(dictate), violation_date, statute(search), fine(number), notes |
| `field_interview` | Field interview | 1 | `POST /api/field-interviews` | subject(scan), location(gps), reason(chips), narrative(dictate), photos |
| `use_of_force` | Use of force | 1 | `POST /api/use-of-force` | subject(scan), force_type(chips), narrative(dictate), injuries(toggle), photos |
| `incident_supplement` | Supplement (DV/pursuit) | 1 | `POST /api/incidents/:id/supplements/{dv,pursuit}` | reached from an incident; type(seg) + structured fields |

### Patrol & security (`.patrol`)
| id | Title | Submit | Endpoint(s) | Key fields |
|---|---|---|---|---|
| `patrol_scan` | Tour checkpoint scan | 1 | `POST /api/patrol/scan` | checkpoint(picker/QR), notes(dictate), gps, photo |
| `property` | Property / evidence intake | 1 | `POST /api/properties` | type(chips), description(dictate), location(gps), photos |
| `welfare` | Welfare check | 1 | `POST /api/dispatch/welfare/start` (+ `/activity`,`/ack`) | subject, location(gps), notes(dictate) |

### People & cases (`.people`)
| id | Title | Submit | Endpoint(s) | Key fields |
|---|---|---|---|---|
| `arrest` | Arrest / booking | LC+custom | `POST /api/arrests/manual` (+ `/:id/miranda`, `/:id/property`) | subject(scan), charges(chips), narrative(dictate); custom steps: Miranda ack, property list |
| `case` | Case open + note | 1 | `POST /api/cases` (+ `/:id/notes`) | title, type(chips), summary(dictate) |
| `task` | Task / follow-up | 1 | `POST /api/tasks` | title, priority(seg), due(date), notes(dictate) |

### Civil / admin (`.civil`)
| id | Title | Submit | Endpoint(s) | Key fields |
|---|---|---|---|---|
| `community` | Community tip / event | 1 | `POST /api/community/{tips,events}` | type(seg), location(gps), description(dictate), photos |
| `code_enforcement` | Code violation / tow | 1 | `POST /api/code-enforcement/{violations,tows}` | type(seg), location(gps), description(dictate), vehicle(scan), photos |
| `crisis_specialops` | Crisis / special-ops callout | 1 | `POST /api/crisis-response/incidents` or `/api/special-ops/callouts` | type(chips), location(gps), narrative(dictate) |

**Exact field lists per workflow are finalized in the implementation plan** by reading
each route's body allow-list (the contracts in §6); the table above is the agreed shape,
not the final field set.

### Roadmap (needs backend; shown as "coming" tiles, not built here)
Trespass notice (`POST /api/trespass-orders` — only `/check` + list exist today), Daily
Activity Report (no backend), BOLO create. Each is a fast-follow with its own small spec.

---

## 6. Server contracts consumed (verified live)

- **Incidents** (`officer` ∈ WRITE_ROLES): `POST /` requires `incident_type` +
  `location_address`, creates a `draft` with auto `incident_number` (`YY-RMP-NNNNN`),
  geocode, geofence. `PUT /:id` edits draft/returned. `PUT /:id/submit` runs the **NIBRS
  gate** — narrative required; on fail returns **HTTP 422** `{ code:'NIBRS_VALIDATION_FAILED',
  validation }`.
- **Citations** (`officer`+): `POST /` requires non-empty `violation_description` +
  `violation_date` (`YYYY-MM-DD`); `fine_amount` ≥ 0; large optional allow-list
  (person/vehicle/speed/court/etc.). Returns `{ data, citation_number }`.
- **Patrol** (`officer`+): `POST /api/patrol/scan` logs a checkpoint scan (auto on-time/late).
- **Use of force / properties / field-interviews / arrests / cases / tasks / community /
  code-enforcement / crisis-response / special-ops / welfare** — all expose `POST` create
  endpoints (verified by route scan 2026-06-13). The plan reads each body allow-list to
  pin field keys.
- **Field photos**: `POST /api/field-photos` multipart `{ photo, lat?, lng?, call_id?,
  notes? }` → R2 + `field_photos`. **Server change in §7.**

---

## 7. Server change — generic evidence-photo linkage

Add `incident_id` to `field_photos` so report/use-of-force/property evidence binds to the
owning record (not only to a call). In `src/routes/fieldPhotos.ts`:
1. Add `incident_id INTEGER` to the `CREATE TABLE IF NOT EXISTS` in `ensureTable()`.
2. Best-effort `ALTER TABLE field_photos ADD COLUMN incident_id INTEGER` wrapped in
   try/catch (D1 has no `IF NOT EXISTS` on ADD COLUMN; swallow re-apply error — same
   boot-reconciler posture already in this file).
3. Parse `incident_id` from the multipart form (same int-coercion as `call_id`).
4. Include it in the `INSERT` columns/values and the `GET /` filter allow-list.

**Live D1:** apply the `ALTER` directly to live `rmpg-flex` (`785de7ae-…`) post-merge and
verify with `pragma_table_info('field_photos')` (migrations routinely fail to reach live
silently). `field_photos` is ~11 cols — no 100-col-cap concern; code-bootstrapped, so a
`migrations/` file is optional.

This is the **only** server change in this sub-project.

---

## 8. UX & workflow design

**Design stance: guided workflow over forms.** One-handed, sunlit, sometimes-gloved use →
large tap targets, minimal typing, thumb-zone primary actions, honest status.

### Principles
1. **Stepped, not sprawling** — multi-input workflows (incident, arrest) use steps +
   progress pills; short ones (task, patrol scan) are a single card-stack.
2. **Thumb-zone primary action** — one pinned gold button per step; secondary/destructive
   actions are quiet text.
3. **One-tap common cases** — chips for incident types, charges, violations, force types;
   prominent segmented toggles (Warning⇄Citation, DV⇄Pursuit).
4. **Dictation-first narrative** — a large mic at the center of every narrative field.
5. **Always-saved** — persistent "Saved" indicator (server draft + local autosave).
6. **Honest readiness** — green checks / amber fixes from the generic validation mapping;
   never a silent failure.
7. **Prefill is the glue** — "On this call" seeds `call_id`/location/coords; an ID/plate
   scan seeds subject/vehicle. Confirm, don't retype.

### Screen flow
- **Workflow hub** — search, "Continue draft", "On this call" context, then tiles grouped
  by category (role-gated). Reached via a Field Ops card + a "Workflows" entry; whether it
  earns a dedicated bottom tab (vs. living under Field Ops/System to avoid iOS's >5-tab
  "More" fold) is a plan-time call.
- **Renderer flow** — step pills → typed field views → pinned primary; review step shows
  the readiness checklist before submit; success shows the assigned number.
- **Citation / scan-driven flows** lead with the segmented toggle + scan-prefilled cards.

### Readiness model
Computed client-side from each workflow's known required fields so it shows proactively;
the server submit stays authoritative (a 4xx validation body remaps onto the same
checklist). Client mirror is a hint, never a gate.

This UX is the engine's render output — **no per-workflow UI code**, no contract changes.

---

## 9. Voice dictation (on-device)

`Dictation.swift`: `SFSpeechRecognizer` (+ `AVAudioEngine`), `requiresOnDeviceRecognition`
where supported (offline, private), default fallback otherwise. `@Published transcript`
streams into any `dictatableNarrative` field via `DictationBar`. No Anthropic/network.

**Info.plist** (project uses a generated plist → set via `INFOPLIST_KEY_*` build settings):
- `NSMicrophoneUsageDescription` — "RMPG Flex uses the microphone to dictate report and
  workflow narratives."
- `NSSpeechRecognitionUsageDescription` — "RMPG Flex transcribes dictation on-device to
  fill workflow narratives."

---

## 10. Error handling & honesty

- **Validation 4xx** (NIBRS 422 and any `{ validation }`/field-error body) → actionable
  checklist with Fix-now / Save-draft. One engine path.
- **401** → shared re-login-on-401 helper; retry once.
- **Offline** → lifecycle drafts already exist server-side; single-POST workflows keep a
  local autosave and tell the officer it's saved to retry — never a silent failure.
- All branching reads the server `code`/`json` via `RMPGAPIClient.apiCode`/`apiBody`,
  never string-matching messages.

---

## 11. Security & roles

- All calls JWT-bearer'd. The hub hides workflows whose `roles` exclude the signed-in role
  (e.g. use-of-force/arrest gating mirrors the server). The renderer never shows
  supervisor-only review actions.
- Factor the existing `client()` → `authed { }` re-login-on-401 pattern (from
  `FieldOpsView`/`BackgroundDuty`) into a shared helper the engine uses.
- Evidence photos stay Worker-streamed (private R2), unchanged.

---

## 12. Offline & autosave

- **Lifecycle workflows:** the server `draft` is the persistence; a local autosave of the
  in-progress narrative (keyed by record id) is crash insurance.
- **Single-POST workflows:** the whole collected `[String:FieldValue]` is autosaved locally
  (keyed by workflow id + a local uuid) until a successful POST clears it.
- This is intentionally thin — the robust replay queue is sub-project C.

---

## 13. Testing & verification

Per the README's `xcodebuild`-deadlock workaround (`swift test` + `swiftc`; **no new Xcode
target** is introduced, so this holds):
- **Engine unit tests:** field-value → JSON/multipart encoding; `.lifecycle` vs `.single`
  submit sequencing; generic validation-body → checklist mapping; required-field gating.
- **Registry tests:** every definition's endpoint path is well-formed; referenced field
  types exist; role lists non-empty.
- **Field-type tests:** `Dictation` state machine; `MultipartUpload` body framing; citation
  date/`fine ≥ 0` validation; `NumberRow` non-negative.
- **Compile:** `xcrun -sdk iphonesimulator swiftc` over new files.
- **Server:** `npm run typecheck` for `fieldPhotos.ts`.
- **Live smoke (post-merge):** drive 3-4 representative workflows (incident submit w/ NIBRS
  path, citation, patrol scan, a single-POST civil one); apply + verify the live-D1 `ALTER`.

---

## 14. Acceptance criteria

1. A `WorkflowRenderer` drives any registry definition through a stepped flow with a single
   pinned primary action, autosave, and prefill — no per-workflow UI code.
2. The first-batch registry contains the ~13 live workflows across all four categories
   (§5), each gated by role and grouped in the hub.
3. Incident submit surfaces the NIBRS readiness checklist before submit and maps a 422 onto
   it; the same mapping works for any other workflow returning a validation body.
4. From the phone, an officer can: file an incident (dictated narrative + `incident_id`-linked
   photos), issue a citation, log a patrol checkpoint scan, and complete ≥1 workflow per
   remaining category.
5. Dictation runs on-device with clear permission strings and streams partial transcripts.
6. Prefill works: "On this call" seeds report context; an ID/plate scan seeds subject/vehicle.
7. `FieldPhotoView` + `FuelAndPhotos` are refactored onto `MultipartUpload` (no behavior change).
8. Engine + registry + field-type unit tests pass via `swift test`; `swiftc` clean; server
   `typecheck` passes.
9. `field_photos.incident_id` exists on live D1 (verified via `pragma_table_info`).

---

## 15. Out of scope / roadmap

- **Fast-follow (own small specs):** Trespass-notice `POST` backend, Daily Activity Report
  backend (could aggregate patrol scans + activity), BOLO create — then their hub tiles
  activate.
- **Sub-project B** — Always-On Officer Safety (App Intents + local Live Activity).
- **Sub-project C** — Live & Resilient Dispatch (WebSocket feed + offline-first replay queue).
- **Sub-project D** — Navigate & Know (Mapbox turn-by-turn + units map + BOLO feed).
- Supervisor approve/return on phone; server-AI narrative assist (Anthropic credits).
