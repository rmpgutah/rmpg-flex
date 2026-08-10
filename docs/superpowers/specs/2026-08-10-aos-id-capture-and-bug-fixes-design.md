# Acknowledgement of Service — ID Capture, Bug Fixes & Data Collection Enhancement

> **Date**: 2026-08-10
> **Status**: Design
> **Scope**: ServeReceiptPage (public form), ServeReceiptActions (officer MDT), serveReceipt.ts (Worker routes), servePdfGenerator.ts (PDF output), D1 schema, persons integration

## Problem Statement

The AoS (Acknowledgement of Service) system has four interconnected bugs and an incomplete data model:

1. **Barcode scan fails on ALL IDs** — the zxing-wasm PDF417 decoder never successfully reads a driver's license barcode in the field, likely due to WASM loading/CSP issues on mobile browsers.
2. **Form submission always blocked** — validation in `ServeReceiptPage.tsx` requires a successful ID scan (`idScanned === true`). Since scanning always fails, no recipient can ever submit the form.
3. **Paper form server rejection** — the paper recording route passes a photographed page through `validSignature()`, which caps at 500KB. A 1600px page photo at JPEG 0.7 quality is typically 300–800KB as a base64 data URL, exceeding the cap.
4. **Incomplete data capture** — the system captures name, phone, email, and signature but discards the full AAMVA identity dataset from the barcode, never stores ID photos, and never connects the recipient to the RMS `persons` table.

## Design

### 1. D1 Schema Changes

#### 1.1 New columns on `serve_receipts`

Five new columns (table is at ~55 columns, well under the 100-col cap):

```sql
ALTER TABLE serve_receipts ADD COLUMN recipient_person_id INTEGER
  REFERENCES persons(id);
ALTER TABLE serve_receipts ADD COLUMN recipient_aamva_json TEXT;
ALTER TABLE serve_receipts ADD COLUMN id_scan_method TEXT;
ALTER TABLE serve_receipts ADD COLUMN id_front_r2_key TEXT;
ALTER TABLE serve_receipts ADD COLUMN id_back_r2_key TEXT;
```

- `recipient_person_id` — FK to the matched/created person record.
- `recipient_aamva_json` — immutable point-in-time snapshot of the full `AamvaResult` including `raw_elements`. What the barcode said at the moment of signing, never updated.
- `id_scan_method` — `'barcode'` or `'manual'`.
- `id_front_r2_key` / `id_back_r2_key` — R2 object keys for the ID card photos.

#### 1.2 New junction table: `serve_receipt_persons`

Links receipts to person records with a role. A receipt can involve multiple people (the signer and the named party); the same person can appear on multiple receipts.

```sql
CREATE TABLE IF NOT EXISTS serve_receipt_persons (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_id       INTEGER NOT NULL,
  person_id        INTEGER NOT NULL,
  role             TEXT NOT NULL DEFAULT 'recipient',
  id_scan_method   TEXT,
  id_front_r2_key  TEXT,
  id_back_r2_key   TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (receipt_id) REFERENCES serve_receipts(id) ON DELETE CASCADE,
  FOREIGN KEY (person_id)  REFERENCES persons(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_srp_receipt_person_role
  ON serve_receipt_persons(receipt_id, person_id, role);
CREATE INDEX IF NOT EXISTS idx_srp_person
  ON serve_receipt_persons(person_id);
```

Roles: `'recipient'` (the person who signed), `'subject'` (the named party/defendant).

#### 1.3 New columns on `persons_ext`

These capture AAMVA fields that are currently decoded by the parser but dropped before reaching D1:

```sql
ALTER TABLE persons_ext ADD COLUMN place_of_birth TEXT;
ALTER TABLE persons_ext ADD COLUMN name_prefix TEXT;
ALTER TABLE persons_ext ADD COLUMN is_veteran INTEGER;
ALTER TABLE persons_ext ADD COLUMN non_resident_indicator INTEGER;
ALTER TABLE persons_ext ADD COLUMN limited_duration_doc INTEGER;
ALTER TABLE persons_ext ADD COLUMN card_revision_date TEXT;
ALTER TABLE persons_ext ADD COLUMN dl_hazmat_expiry TEXT;
ALTER TABLE persons_ext ADD COLUMN card_type TEXT;
```

#### 1.4 Data flow

```
ID Scan (barcode or manual + front/back photos)
    ↓
serve_receipts  ←── stores the CAPTURE snapshot (recipient_aamva_json, id_scan_method, R2 keys)
    ↓
persons + persons_ext  ←── UPSERT: create or enrich the person record
    ↓
serve_receipt_persons  ←── links the receipt to the person with role='recipient'
    ↓
serve_queue_persons  ←── also links the person to the serve job with role='recipient'
```

#### 1.5 Person upsert rules

Match order (same as CarsXE `resolveVehicleRecord`):
1. `dl_number + dl_state` (exact, case-insensitive)
2. `first_name + last_name + dob` (exact, case-insensitive)

Write policy: **FILL-ONLY** — `COALESCE(existing, new)` for every field. The barcode populates blanks but never overwrites officer-entered data. Exceptions:
- Physical description fields (height, weight, hair, eye color) from a government-issued ID ARE authoritative and DO overwrite, because a DL is a more recent measurement than whatever was previously recorded.
- `is_stolen` / stolen-status equivalent: N/A for persons.

Fields that flow to the person record:

| Target | Fields |
|--------|--------|
| `persons` (base) | first_name, last_name, dob, gender, race, height, weight, hair_color, eye_color, address, phone, email, dl_number, dl_state, dl_class, dl_expiry |
| `persons_ext` | suffix, name_prefix, address_2, dl_restrictions, dl_endorsements, dl_issue_date, country, document_discriminator, is_real_id, is_organ_donor, is_veteran, under_18_until, under_21_until, aamva_version, issuer_id, place_of_birth, non_resident_indicator, limited_duration_doc, card_revision_date, dl_hazmat_expiry, card_type, raw_aamva_elements |

#### 1.6 ID photo storage

Front and back photos are stored in R2 (bound as `UPLOADS`):
- Path: `serve-receipts/{receipt_id}/id-front.jpg` and `id-back.jpg`
- Also accessible via person: `persons/{person_id}/id-front-{receipt_id}.jpg` (symlink pattern — store R2 key on both the receipt and the junction row)
- Client downscales to 1600px max, JPEG 0.8 quality before upload
- Server validates: PNG or JPEG data URL, > 100 bytes, ≤ 2MB (new `validIdPhoto()` function)

### 2. Bug Fixes

#### 2.1 Barcode scanner — debug WASM + manual fallback

**Diagnosis steps** (in the implementation):
- Add `try/catch` with `console.error` around `prepareZXingModule()` in `pdf417Decoder.ts` to surface WASM load failures
- Check CSP headers on the Pages deploy for `wasm-unsafe-eval` in `script-src`
- Test whether the Vite `?url` import resolves to a valid same-origin path in production

**Manual fallback**: When barcode scan fails, show an "Enter ID manually" button that reveals:
- First name, last name, middle name, suffix (text inputs)
- DOB (date input)
- DL number, issuing state (text + state dropdown)
- Gender, height, weight, eye color, hair color (dropdowns matching AAMVA code maps)

The manual path still requires front and back ID photos. `id_scan_method` is set to `'manual'` instead of `'barcode'`.

The scan flow:
1. Attempt barcode scan (camera viewfinder or photo upload)
2. If successful → auto-fill all fields, show as confirmed read-only, `id_scan_method = 'barcode'`
3. If failed → show error + "Enter ID manually" option
4. Manual entry → fields appear for typing, `id_scan_method = 'manual'`
5. In both paths → prompt for front and back ID photos via camera capture

#### 2.2 Form submission validation — make ID scan requirement flexible

Current: `fieldErrors` requires `idScanned === true` at `ServeReceiptPage.tsx:446`.

Change to: ID is verified when ANY of these is true:
- Barcode scan succeeded (`idScanned === true`)
- Manual entry completed (first name + last name + DOB filled AND at least the front ID photo captured)

Phone, email, attestations, and signature remain required as-is.

#### 2.3 Paper form — separate page image validation

New `validPageImage()` function in `serveReceipt.ts`:
```ts
function validPageImage(v: unknown): v is string {
  return typeof v === 'string'
    && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(v)
    && v.length > 100
    && v.length <= 2_000_000  // 2MB — page photos are larger than signatures
    && decodesToImage(v);
}
```

The paper route (`POST /:queueId/paper`) calls `validPageImage(pageImage)` instead of `validSignature(pageImage)`.

Client-side `readPageImage()` bumps JPEG quality from 0.7 to 0.8 for text legibility while keeping the 1600px max dimension cap.

#### 2.4 PDF layout fixes

Audit `servePdfGenerator.ts` during implementation. Known additions:
- Recipient physical description block (gender, race, height, weight, hair, eye color)
- DL information line (number, state, class, expiry, REAL ID status)
- ID verification method indicator (barcode-scanned vs manually entered)
- Thumbnail of the ID front photo (if captured), sized to fit the signature/ID section
- All four form variants (Individual, Co-Habitant, Business, Substitute) get the same additions

### 3. Enhanced Data Collection — Recipient Form Flow

The public form at `/m/serve-receipt/:token` gets a revised flow:

```
Step 1: Welcome / case info (existing, unchanged)
Step 2: "Are you the named party?" questions (existing — drives variant resolution)
Step 3: ID capture (NEW)
        ├── Attempt barcode scan
        ├── On failure: manual ID entry fallback
        └── Front + back photo capture (required)
Step 4: Contact info — phone, email (existing)
Step 5: Address confirmation (NEW)
        ├── Show address from ID: "Is this your current address?"
        └── If no: enter current address
Step 6: Relationship to party (NEW for mobile path)
        └── Dropdown: self, spouse, parent, child, roommate,
            employee, registered agent, other + free text
Step 7: Attestations (existing — variant-specific, unchanged)
Step 8: Signature (existing, unchanged)
Step 9: Review & submit
```

The physical description fields (gender, height, weight, hair, eyes, race) auto-populate from the barcode scan and display as read-only confirmed values. In manual mode, these become editable dropdowns.

### 4. Server Route Changes

#### 4.1 Public POST `/api/serve-receipts/:token` (receipt submission)

New fields accepted in the request body:
- `id_scan_method` — `'barcode'` | `'manual'`
- `aamva_data` — full `AamvaResult` object (when barcode scanned)
- `manual_id` — `{ first_name, last_name, middle_name, suffix, dob, dl_number, dl_state, gender, height, weight, eye_color, hair_color }` (when manually entered)
- `id_front_image` — base64 data URL (PNG/JPEG, ≤ 2MB)
- `id_back_image` — base64 data URL (PNG/JPEG, ≤ 2MB)
- `recipient_address_current` — `{ address, city, state, zip }` (if different from ID)
- `recipient_relationship` — string

Server processing on receipt submission:
1. Validate signature (existing `validSignature`)
2. Validate ID photos (new `validIdPhoto`, ≤ 2MB)
3. Write ID photos to R2, store keys
4. Resolve person: match by DL# or name+DOB → upsert `persons` + `persons_ext` (FILL-ONLY)
5. Store `recipient_aamva_json` snapshot on the receipt
6. Insert `serve_receipt_persons` junction row
7. Insert/update `serve_queue_persons` junction row
8. Existing: store attestations, variant, signature, burn token

#### 4.2 Admin paper route `POST /:queueId/paper`

- Use `validPageImage()` (2MB cap) for the page photo
- Accept the same ID data fields as the public route (the officer transcribes from the paper form)
- Same person upsert flow

#### 4.3 New admin route: `GET /api/serve-receipts/:id/id-photo/:side`

Returns a signed R2 URL for the ID front or back photo. Auth required, `client_viewer` excluded.

### 5. Migration Plan

Single migration file (next free number after checking `ls migrations/ | tail`):

```
migrations/NNNN_aos_id_capture.sql
```

Contains:
- `ALTER TABLE serve_receipts ADD COLUMN` × 5
- `CREATE TABLE serve_receipt_persons` + indexes
- `ALTER TABLE persons_ext ADD COLUMN` × 8
- All DDL is idempotent (`IF NOT EXISTS` on tables/indexes; ALTER failures are swallowed by `continue-on-error`)
- Apply to live D1 via `scripts/apply-migration.sh` after merge

### 6. Files Modified

| File | Change |
|------|--------|
| `migrations/NNNN_aos_id_capture.sql` | New migration |
| `src/routes/serveReceipt.ts` | `validPageImage()`, person upsert, ID photo R2 storage, new fields on POST |
| `src/routes/records.ts` | Add new `persons_ext` columns to `PERSON_EXT_COLUMNS` and `PERSON_WRITABLE_COLUMNS` |
| `client/src/pages/mobile/ServeReceiptPage.tsx` | Manual ID fallback, front/back photo capture, address confirmation, relationship field, revised validation |
| `client/src/components/serve/ServeReceiptActions.tsx` | Paper route: bump quality, add ID data transcription fields |
| `client/src/utils/pdf417Decoder.ts` | Diagnostic logging on WASM load failure |
| `client/src/utils/servePdfGenerator.ts` | Add ID data block, physical description, DL info, ID photo thumbnail to PDF |
| `client/src/utils/aamvaParser.ts` | Extract `place_of_birth`, `race`, `name_prefix`, `card_revision_date`, `hazmat_expiry`, `non_resident`, `limited_duration`, `audit_info` into named fields |

### 7. Testing

- Unit tests for `validPageImage()` (size boundary at 2MB)
- Unit tests for person upsert match logic (DL#, name+DOB, no match → create)
- Unit tests for FILL-ONLY write policy (existing values not overwritten, blanks filled)
- Smoke test for the paper route with a 1MB page image (currently rejected, must pass)
- Manual test: barcode scan on a real device, manual fallback, front/back photo capture
- Manual test: paper form flow end-to-end
- Existing client + worker test suites must remain green
