# Serve Receipt — Recipient Wizard Redesign

**Date:** 2026-08-16
**Scope:** `client/src/pages/mobile/ServeReceiptPage.tsx` + new step components + expanded fingerprint utility
**Route:** `/m/serve-receipt/:token` (public, unauthenticated)

---

## Problem

The current page is a 1,441-line single-scroll form with 5 simultaneously visible sections. For a member of the public standing at their door on a stranger's phone, this is overwhelming and causes abandonment. ID scan is confusingly marked required while the code says it is optional. Attestations are individual legal-text checkboxes. Device fingerprinting is minimal.

---

## Solution

Replace the single-scroll form with a **5-step full-screen wizard**. Each step fills the viewport — one clear task at a time. Navigation: Back button (top-left) + Continue button (bottom, full-width, disabled until step is valid). 5-segment progress bar always visible in the header.

---

## Wizard Steps

### Step 1 — Who Is Signing

**Context panel (read-only):**
- Plaintiff / Defendant names
- Address of service
- Server name + badge

**"Signing does not mean you agree" notice** — displayed prominently above the question, always.

**Question flow:**
- If named party is an individual: large Yes / No buttons — "Are you [named party]?"
  - Yes → advance (variant = individual)
  - No → show role questions below
- If named party is a company: skip Yes/No, go straight to role questions (variant = business)

**Role questions (shown when signer is not the named party):**
- Premises type: Residence / Business / Other (3 large tap-target buttons)
- "I live at this address" checkbox
- "I am authorized to accept legal papers here" checkbox
- Relationship dropdown (Spouse, Parent, Adult child, Sibling, Roommate, Employee, Manager, Registered agent, Other)
- Business name field (shown only when premises type = Business)
- Job title field (shown only when premises type = Business)
- Optional: expected delivery date picker

**Validation:** Named-party question answered (or entity auto-resolved). If not named party: at least one of "lives here" or "authorized agent" checked.

---

### Step 2 — Your Identity

**Name field** — pre-filled from officer MDT intake if available. Always editable.

**ID capture — three cards, pick one:**

**Card A: Scan barcode**
- Opens camera, reads PDF417 from back of licence
- On success: name auto-filled, physical description auto-filled, green confirmation row shown
- Fields captured: first name, last name, middle name, DOB, DL number, DL state, gender, race, height, weight, hair color, eye color, REAL ID flag, DL class, expiry
- EXIF data extracted from the captured image

**Card B: Take a photo**
- Front of ID photo (required if this card chosen)
- Back of ID photo (optional but encouraged)
- Name field remains editable (required)
- Physical description fields become required: gender, height, weight, hair color, eye color
- EXIF data extracted from captured images

**Card C: Enter manually (required fields if no scan/photo)**
- First name *, Last name *, Middle name
- Date of birth *
- DL / ID number *, Issuing state *
- Gender *, Height *, Weight *, Eye color *, Hair color *

**Rule:** Exactly one card must be completed before Continue is enabled. Skipping all three is not permitted.

**Address confirmation** (shown after any ID method):
- "Is the address on your ID your current address?" Yes / No
- If No: current street, city, state, ZIP fields

---

### Step 3 — Documents

Clean list of every document handed to the signer. Each row:
- Document title
- +/− stepper for copy count (min 1)

If only one document and one copy: the list is read-only, no stepper shown.

Footer note: "If anything listed here was not handed to you, tell the process server before you continue."

No validation required — step is always passable. Copy counts default to officer-recorded values.

---

### Step 4 — Statements

Header: the form variant label (Individual / Co-Habitant / Business / Substitute Service).

All attestation statements rendered as a **numbered plain-English list** — no per-item checkboxes.

At the bottom, one large checkbox:

> ☐ I have read all the statements above and confirm they are true.

Continue is disabled until this checkbox is checked.

---

### Step 5 — Sign & Submit

**Location gate (hard block):**
- On entering Step 5, request GPS permission immediately
- If denied: show a full-screen message — "Location access is required to complete this form online. Please allow location access in your browser settings, or ask the process server for the paper form."
- If granted: GPS coordinates + accuracy recorded; proceed

**Signature pad** — large, full-width, finger-friendly. Clear button top-right.

**Phone number field** (required, auto-formats as typed)

**Email address field** (required — receipt copy sent here)

**"Sign and submit" button** — full-width, disabled until: location granted + signature drawn + phone filled + valid email.

On submit: spinner → confirmation screen (receipt number, Download PDF, Print buttons).

---

## Device + Location Fingerprint

A new utility `client/src/utils/deviceCapture.ts` replaces the current `deviceFingerprint.ts`. All captures are **best-effort** except GPS (hard gate). Each capture is wrapped in its own try/catch — one failed API never blocks others.

### Capture inventory

| Signal | API | Permission required |
|--------|-----|---------------------|
| GPS coordinates + accuracy | Geolocation API | Yes (hard gate) |
| Screen resolution, color depth | `screen` | No |
| Timezone, language, languages | `Intl` / `navigator` | No |
| Platform, user agent | `navigator` | No |
| Hardware concurrency, device memory | `navigator` | No |
| Max touch points | `navigator` | No |
| Network type, effectiveType, downlink, RTT | Network Information API | No |
| Battery level + charging state | Battery Status API | No |
| Accelerometer + gyroscope | DeviceMotion / DeviceOrientation events | Yes (iOS 13+) |
| Ambient light level | AmbientLightSensor API | Yes (Chrome) |
| Nearby Bluetooth device names | Web Bluetooth API | Yes |
| Camera EXIF from captured photos | EXIF reader (client-side) | No (photo already captured) |
| Installed font fingerprint | Canvas font probe | No |
| WebGL GPU renderer + vendor | WebGL `RENDERER` / `VENDOR` | No |
| Audio context fingerprint | AudioContext API | No |
| Canvas fingerprint | Canvas 2D rendering | No |
| CPU architecture | WASM / timing probe | No |
| Memory pressure | `performance.memory` heap snapshot | No |
| Media device IDs + labels | `navigator.mediaDevices.enumerateDevices` | No (labels need mic/cam permission) |
| Speech synthesis voice list | `speechSynthesis.getVoices()` | No |
| Pointer/touch precision from signature | PointerEvent pressure, tilt, twist, width, height per stroke point | No |
| Clipboard contents | Clipboard API | Yes (Chrome) |
| Storage availability | `localStorage` / `indexedDB` probe | No |
| Page visibility history | `visibilitychange` event counter (backgrounded N times, total hidden duration) | No |
| UTC timestamp | `Date.now()` | No |

All signals collected into a single `DeviceCapture` object and included in the POST payload alongside the signature.

### Signature stroke data

The `SignaturePad` component is extended to emit per-stroke `PointerEvent` metadata: pressure, tilt X/Y, twist, width, height, pointer type. This proves a human finger drew the signature rather than a programmatic call.

---

## Component Structure

```
ServeReceiptPage.tsx          — wizard controller, all state, step routing
  steps/
    Step1WhoIsSigning.tsx
    Step2Identity.tsx
    Step3Documents.tsx
    Step4Statements.tsx
    Step5SignSubmit.tsx
  WizardShell.tsx             — header (progress bar + back button) + footer (continue button)
utils/
  deviceCapture.ts            — replaces deviceFingerprint.ts; full capture bundle
```

Each step receives only the props it reads and the setters it writes. No step imports from another step.

---

## ID Optional — Required Fields Rule

| Method chosen | Fields required |
|---------------|-----------------|
| Barcode scan (success) | None — auto-filled |
| Photo taken | Name + gender + height + weight + hair + eye color |
| Manual entry | First name + last name + DOB + DL number + DL state + gender + height + weight + hair + eye color |
| Nothing chosen | Not permitted — Continue blocked |

`idVerified` flag set to `true` for barcode scan; `false` (but `idScanMethod` set) for photo/manual.

---

## Offline Handling

Unchanged from current implementation. Queue + flush pattern in `serveReceiptQueue.ts` is preserved. The pending/offline state screen is preserved as-is.

---

## What Does Not Change

- API endpoints (`GET /api/serve-receipt/:token`, `POST /api/serve-receipt/:token`, `POST /:token/email`, `POST /:token/delivery`)
- POST payload shape (additive only — new fingerprint fields appended)
- PDF generation (`generateReceiptOfService`)
- Variant resolution logic (`resolveReceiptVariant`)
- Attestation wording (`attestationsFor`)
- `.public-form` light theme
- Server-side rate limiting and token validation

---

## Migrations

None. New fingerprint fields land in existing `acknowledgement_of_service` columns or are appended to the JSON blob already stored. No schema change required.

---

## Testing

- Unit tests for `deviceCapture.ts` — each capture mocked independently, failure of one does not fail others
- Unit tests for `Step1WhoIsSigning` variant resolution (entity vs individual, named party vs not)
- Unit tests for `Step2Identity` required-field matrix (barcode / photo / manual)
- Existing `serveReceiptIdScan.test.ts` updated to reflect new component structure
- E2E: GPS denied → hard block shown; GPS granted → Step 5 completes
