# Citation Module — Utah Uniform Citation Master Form Redesign

**Status:** Design — ready for implementation
**Author:** Claude (brainstormed with Christopher Zamora)
**Date:** 2026-06-22
**Program scope:** 7 PRs over ~3 months — MVP detailed below (PRs 1–3); follow-ups (PRs 4–7) roadmapped only.

---

## 1. Context & Goals

### Current state

The citation module is already live across the Worker (`src/routes/citations.ts`, 720 LOC, 16 endpoints) and React SPA (`client/src/pages/CitationsPage.tsx` 1,938 LOC, `client/src/components/CitationAuthor.tsx` 922 LOC). Storage: 3 D1 tables (`citations`, `citation_violations`, `citation_payments`), seeded via migration `0027_citations.sql`. PDFs are generated client-side through the v2 schema engine (`client/src/utils/pdf/v2/forms/citation.ts`) which produces a generic sectioned "RMPG Form PS-209" layout.

### Problem

The PS-209 form looks like a generic government form, not an authoritative Utah-issued citation. When an RMPG officer hands a defendant a printed copy, it doesn't carry the visual weight or jurisdictional signaling of a real Utah Uniform Citation (Rule 4-704 / Form 4-704). This affects:

- **Legal defensibility** — defendants and their counsel can argue the form's authority
- **Court intake** — Utah Justice Courts accept the citation but the unusual format slows manual entry
- **Officer pride / muscle memory** — operators want a citation that looks like the one Spillman Flex / Tyler New World / Mark43 produce for real LE agencies

### Goal

Replace the generic PS-209 PDF with an authentic **Utah Uniform Citation** master form that:

1. Renders an exact visual replica of the Utah State Courts citation layout (Rule 4-704)
2. Carries Rocky Mountain Protective Group as the issuing agency (ORI, address, agency #)
3. Handles all four citation types (`traffic | criminal | parking | warning`) in **one unified master template** with conditional sections that show/hide by type
4. Splits the defendant copy from the court/agency/file copies — defendant copy is **printed and handed at scene**; the other three copies are **saved separately for later batch filing** with the court
5. Captures defendant signature on scene via two flows — officer-tablet handoff OR QR-to-defendant-phone — with a refusal escape hatch (per Utah Code 77-7-19)

### Non-goals (MVP)

- Replacing PS-209 for non-citation forms (incident reports, FI cards, etc.) — those keep the existing sectioned schema
- Utah statutes full-text search database — MVP uses a 80-row built-in dictionary; full seed is PR 5
- SMS delivery to defendant — MVP is email-only; SMS is PR 6
- Online payment — MVP includes a QR linking to a stub page; real Stripe Checkout is PR 7
- Scene/vehicle/plate photos embedded in PDF — already attached to call_id; embedding is PR 4
- Utah XCH/UJB ECF e-filing integration — manual ZIP export only; ECF is deferred indefinitely
- CitationsPage list-view replatform — covered by separate program [[project-spillman-flex-structural-replica]]

---

## 2. Approach (chosen of 3)

**Approach 2: Extend the PDF v2 schema engine with a `fixed-layout` section kind.**

Today's engine renders `FormSchema → sections → fields` with flowing vertical layout. The Utah master form needs every field at a specific (x, y, w, h) on the page — so we add a new section kind to the engine:

```ts
type FixedLayoutSection<T> = {
  kind: 'fixed-layout';
  pageSize: 'letter' | 'a4';                 // Utah uses letter
  fields: FixedField<T>[];
};
type FixedField<T> = {
  path?: string;                             // drives sidecar extraction (round-trip)
  accessor: (d: T) => string | { image: string };
  x: number; y: number; w: number; h: number;  // millimeters
  style: 'box' | 'underline' | 'checkbox' | 'signature' | 'barcode';
  fontSize?: number;
  align?: 'left' | 'center' | 'right';
};
```

The renderer gains one new method, `fixedLayout(fields, data)`, next to today's `section(...)` and `narrativeField(...)`. Existing sectioned forms keep working untouched.

**Rejected alternatives:**

- **Approach 1: Greenfield rewrite** — bypass the engine entirely, write `renderUtahCitation()` directly against jsPDF. Cleanest code per form but throws away multi-copy, sidecar extraction, and instructions overlay. The engine investment must keep paying off.
- **Approach 3: Static template + pdf-lib overlay** — ship a blank Utah-form PDF and stamp data on it. Most authentic-looking but adds pdf-lib alongside jsPDF to the client bundle (~150 KB extra) and loses sidecar round-trip extraction.

**Why Approach 2:** preserves the engine's multi-copy/sidecar/instructions infrastructure while enabling pixel-positioned forms. Other RMS forms (Utah Traffic Crash Report, Utah Arrest Report) become straightforward to add later.

---

## 3. Utah Master Form Layout

One letter page (8.5" × 11", 215.9 × 279.4 mm). Top-to-bottom layout:

```
┌─────────────────────────────────────────────────────────────────────┐
│ ROCKY MOUNTAIN PROTECTIVE GROUP              CITATION No.           │
│ <agency address — admin-configurable>        CIT-2026-0001 [BARCODE]│
│ Agency ID: <admin-configurable>  Agency Tel: (___) ___-____         │
├─────────────────────────────────────────────────────────────────────┤
│ IN THE JUSTICE COURT OF __________, SALT LAKE COUNTY, STATE OF UTAH │
│                                                                     │
│ <PLAINTIFF NAME>                         CASE No. _________________ │
│   Plaintiff,                                                        │
│ vs.                                                                 │
│ ____________________________                                        │
│   Defendant.                                                        │
├─────────────────────────────────────────────────────────────────────┤
│ DEFENDANT                                                           │
│ Last: ___________  First: __________  Middle: ____                  │
│ DOB: __/__/____  DL#: _________  State: __  Class: _  Endors: ___   │
│ Address: ____________________________________________________       │
│ City: _________  State: __  ZIP: ______  Phone: ____________        │
│ Sex: _  Race: _  Hgt: ___  Wgt: ___  Hair: __  Eyes: __             │
├─────────────────────────────────────────────────────────────────────┤
│ VEHICLE  (hidden when type='criminal' OR type='warning' w/o veh)    │
│ Plate: _______  State: __  Year: ____  Make: _____  Model: ______   │
│ Color: ______  VIN: ________________________  Style: _____          │
│ □ Commercial   □ Hazmat   □ Trailer   □ Rental                      │
├─────────────────────────────────────────────────────────────────────┤
│ INCIDENT                                                            │
│ Date: __/__/____  Time: __:__  Day: ___                             │
│ Location: ___________________________________________________       │
│ City: _________  County: ___________  Beat: __  Sector: __          │
├─────────────────────────────────────────────────────────────────────┤
│ OFFENSE(S) — Utah Code or Local Ordinance                           │
│ # │ Statute        │ Description                │ Class  │ Fine     │
│ 1 │ ______________ │ ________________________   │ ______ │ $______  │
│ 2 │ ______________ │ ________________________   │ ______ │ $______  │
│ 3 │ ______________ │ ________________________   │ ______ │ $______  │
│ 4 │ ______________ │ ________________________   │ ______ │ $______  │
│ Speed Recorded: ___  Posted: ___  Radar: _____   TOTAL: $_____.__   │
│ □ School Zone  □ Const Zone  □ Work Zone  □ Accident  □ DUI         │
│ □ Commercial   □ Property Damage  □ Bodily Injury  □ Fatality       │
├─────────────────────────────────────────────────────────────────────┤
│ COURT APPEARANCE  (hidden when type='warning')                      │
│ Court Name: __________________________  Room/Dept: ___              │
│ Court Address: ______________________________________________       │
│ Appearance Date: __/__/____  Time: __:__   □ MANDATORY APPEARANCE   │
│ □ Pay online: pay.utcourts.gov     □ Mail-in option permitted       │
├─────────────────────────────────────────────────────────────────────┤
│ OFFICER NOTES                                                       │
│ ______________________________________________________________      │
│ ______________________________________________________________      │
├─────────────────────────────────────────────────────────────────────┤
│ PROMISE TO APPEAR (Utah Code § 77-7-19)                             │
│   (hidden when type='warning')                                      │
│ I acknowledge receipt of this citation and promise to appear at the │
│ court named above on the date and time specified, or to satisfy any │
│ obligations imposed by the citation.                                │
│                                                                     │
│ X _____________________  Date: __________   □ REFUSED TO SIGN       │
│                                                                     │
│ ISSUING OFFICER                                                     │
│ Name: ____________  Badge: ___  ORI: ________  Date: __________     │
│ X _____________________                                              │
├─────────────────────────────────────────────────────────────────────┤
│        COPY 3 — DEFENDANT      (tint band: pink #fce7f3)            │
└─────────────────────────────────────────────────────────────────────┘
```

### Conditional sections (type-aware)

All four citation types use this master form. Sections show/hide based on `type` and field data:

| Section | Shown when |
|---|---|
| Vehicle | `type IN ('traffic','parking')` OR any vehicle field set |
| Speed/Radar row | `speed_recorded ≠ NULL` OR statute matches speed pattern |
| BAC/DUI flags | `dui_related = 1` OR statute matches DUI pattern |
| Property Damage / Injury / Fatality | `accident_related = 1` |
| Court Appearance | `type ≠ 'warning'` |
| Pay-online box | `type = 'parking'` OR `appearance_required = 0` |
| PROMISE TO APPEAR block | `type ≠ 'warning'` |

### Agency identity & plaintiff caption — admin-configurable

The Utah Uniform Citation traditionally names "STATE OF UTAH" as Plaintiff because authentic LE agencies are state actors and the ORI field references the FBI's NCIC originating-agency identifier. RMPG is a private security firm — it does not have an FBI-issued ORI and is not always a state actor.

To keep the master form legally accurate for RMPG's actual issuing posture, three header fields are **admin-configurable per `agency_court_zone`** (KV-backed workspace settings; fall back to a workspace-wide default):

| Field | Configurable per zone | Default |
|---|---|---|
| Agency ID label (replaces "ORI") | Yes | RMPG license # |
| Plaintiff name in case caption | Yes | "ROCKY MOUNTAIN PROTECTIVE GROUP" |
| Court of Justice block — included or omitted | Yes | Included for traffic, omitted for parking |

In RMPG's deputized contract zones (where municipal contracts grant arrest authority), the admin can set `Plaintiff = "STATE OF UTAH"` for that zone. In purely-private zones (HOA-only enforcement), `Plaintiff` defaults to the agency name. This is a configuration decision per contracted zone, not a hardcoded form template.

### Multi-copy bottom strip

All four copies share the layout; the only differences are the bottom-strip watermark and a tint band on the strip:

| Copy | Color band | Strip text | Destination |
|---|---|---|---|
| Copy 1 | White (#ffffff) | COURT COPY | Filed weekly to the Justice Court |
| Copy 2 | Yellow (#fef9c3) | AGENCY COPY — RMPG | RMPG records, internal |
| Copy 3 | Pink (#fce7f3) | DEFENDANT COPY | Printed & handed at scene; emailed if address provided |
| Copy 4 | Gold (#fef3c7) | OFFICER FILE COPY | Officer's report packet, attached to incident/case |

---

## 4. Data Model

### 4.1 Three new D1 tables (migration 0150)

```sql
-- citation_signatures: one row per signature event
CREATE TABLE IF NOT EXISTS citation_signatures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  citation_id INTEGER NOT NULL,
  method TEXT NOT NULL CHECK(method IN ('tablet','qr','refused')),
  status TEXT NOT NULL CHECK(status IN ('pending','signed','expired','cancelled')) DEFAULT 'pending',
  signature_url TEXT,           -- R2 key for PNG; NULL when refused
  signed_at TEXT,
  expires_at TEXT,              -- QR token TTL (default 10 min)
  token TEXT,                   -- 32-char random for public sign URL
  signed_by_name TEXT,          -- self-attested by defendant
  ip TEXT, user_agent TEXT, geo_lat REAL, geo_lng REAL,   -- audit, QR only
  refusal_reason TEXT,          -- when method='refused'
  officer_id INTEGER,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (citation_id) REFERENCES citations(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_citation_signatures_citation ON citation_signatures(citation_id);
CREATE INDEX IF NOT EXISTS idx_citation_signatures_token ON citation_signatures(token);

-- citation_filing: 1:1 with citations, holds R2 keys + filing lifecycle
CREATE TABLE IF NOT EXISTS citation_filing (
  citation_id INTEGER PRIMARY KEY,
  status TEXT NOT NULL CHECK(status IN ('pending','queued','filed','voided')) DEFAULT 'pending',
  defendant_copy_url TEXT,
  court_copy_url TEXT,
  agency_copy_url TEXT,
  file_copy_url TEXT,
  batch_id INTEGER,
  filed_at TEXT,
  filed_by INTEGER,
  generated_at TEXT,
  updated_at TEXT DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (citation_id) REFERENCES citations(id) ON DELETE CASCADE
);

-- citation_filing_batches: weekly auto-seal batches per court
CREATE TABLE IF NOT EXISTS citation_filing_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_number TEXT NOT NULL UNIQUE,         -- "BATCH-2026-W26-SLCJC"
  court_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('open','sealed','submitted','accepted','rejected')) DEFAULT 'open',
  citation_count INTEGER DEFAULT 0,
  total_fine REAL DEFAULT 0,
  zip_url TEXT,
  manifest_url TEXT,
  exported_at TEXT, exported_by INTEGER,
  submitted_at TEXT, submission_method TEXT,
  tracking_number TEXT,
  accepted_at TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

-- agency_court_zones: per-zone court + plaintiff/agency-ID identity
CREATE TABLE IF NOT EXISTS agency_court_zones (
  zone_id TEXT PRIMARY KEY,
  court_name TEXT NOT NULL,
  court_address TEXT,
  mandatory_appearance_default INTEGER DEFAULT 0,
  -- Identity fields stamped on Utah master form for citations in this zone:
  plaintiff_name TEXT,                  -- e.g., 'STATE OF UTAH' (deputized) or 'RMPG' (private)
  agency_id_label TEXT,                 -- e.g., 'ORI: UT0XXXXXX' (deputized) or 'License #: ...'
  include_court_caption INTEGER DEFAULT 1,
  updated_at TEXT DEFAULT (datetime('now','localtime'))
);
```

**Column-cap compliance** (CLAUDE.md gotcha #13): citations table sits at ~70 columns; no `ALTER TABLE citations ADD COLUMN` in this migration. New data goes to the 3 new tables.

**Why citation_signatures is a separate table** (not columns on citations): one citation can have multiple signature attempts (QR expires, officer retries, finally signed); refused/expired/cancelled are first-class events with their own audit trail.

### 4.2 R2 storage layout (binding `MAP_DATA`)

```
citations/
  <citation_id>/
    defendant.pdf         # Copy 3 — pink tint, QR to pay-online
    court.pdf             # Copy 1 — white, official, sealed when filed
    agency.pdf            # Copy 2 — yellow, RMPG internal
    file.pdf              # Copy 4 — gold, officer's report packet
    signature.png         # Defendant signature, when signed
filing-batches/
  <batch_id>/
    citations.zip         # All court PDFs zipped
    manifest.csv          # cit_no, def_name, statute, fine, date — one row per
```

---

## 5. PR 1 — Engine Extension + Master Form + Copy Upload

### 5.1 Scope

- Migration 0150 (the 4 tables above)
- Engine extension (`FixedLayoutSection`, `fixedLayout()` renderer method)
- `client/src/utils/pdf/v2/forms/citationUtahMaster.ts` — the Utah master form schema
- `POST /api/citations/:id/copies` — multipart upload endpoint
- R2 storage path
- `agency_court_zones` seeded for known RMPG zones (Daybreak HOA, etc.)
- Workspace feature flag `useUtahMaster` — default `false`; can be flipped on per-user for testing

### 5.2 Files touched

**Server**
- `migrations/0150_citation_filing.sql` — new
- `src/routes/citations.ts` — adds `POST /:id/copies`
- `src/index.ts` — no new mount
- `package.json` — add `pdf-lib`, `fflate`

**Client**
- `client/src/utils/pdf/v2/engine/types.ts` — add `FixedLayoutSection`, `FixedField`
- `client/src/utils/pdf/v2/engine/render.ts` — add `fixedLayout()` method
- `client/src/utils/pdf/v2/forms/citationUtahMaster.ts` — new (~400 LOC)
- `client/src/utils/pdf/v2/forms/citation.ts` — keep, route via feature flag
- `client/src/constants/utahJusticeCourts.ts` — new (~80 rows)
- `client/src/constants/utahStatutesCommon.ts` — new (~80 most-issued statutes)
- `client/src/components/CitationAuthor.tsx` — wire court block + statute picker + defendant phone/email
- `client/src/hooks/useCitationPreview.ts` — switch schema based on feature flag

### 5.3 Multi-copy rendering pipeline

```
┌─────────────────┐      ┌──────────────────┐      ┌─────────────────┐
│  Officer device │      │  Worker API      │      │  R2: MAP_DATA   │
│  (iPad/Safari)  │ ───► │  POST /citations │ ───► │  citations/<id>/│
│                 │      │  /:id/copies     │      │  {def,court,    │
│  Renders 4 PDFs │      │  (multipart)     │      │   agency,file}  │
│  via FormSchema │      │                  │      │  .pdf           │
│  with copyKind  │      │  Stores in R2,   │      └─────────────────┘
│  → 4 Blobs      │      │  creates         │
└─────────────────┘      │  citation_filing │
                         │  row             │
                         └──────────────────┘
```

Client renders all 4 copies in-browser (jsPDF is already there); server stores them in R2 and creates a `citation_filing` row with the four URLs.

### 5.4 Tests (PR 1)

- `tests/citationUtahLayout.test.ts` — render fixture data; assert field positions in mm; assert sidecar round-trip; assert multi-copy watermark bytes differ at expected y-coord
- `tests/citationFilingMigration.test.ts` — migration 0150 idempotency
- `client/src/utils/pdf/v2/forms/__tests__/citationUtahMaster.test.ts` — schema validation; type-aware section hide/show

---

## 6. PR 2 — Signature Flow (tablet / QR / refused)

### 6.1 Scope

- `citation_signatures` table active
- `<SignaturePad>` component (new, ~150 LOC; uses `signature_pad` npm lib — 11 KB gzipped)
- `<CitationSignatureCard>` (new, ~250 LOC; tablet/QR/refused buttons + modal + WebSocket listener)
- Public `/citation/sign/:token` page + endpoints (token-gated, no auth)
- Server-side **`pdf-lib`** stamping (Worker-compatible) — overlays signature PNG or "REFUSED TO SIGN" text on all 4 R2 PDFs at the signature box coordinates
- Switch default of `useUtahMaster` to `true` for officers
- Email defendant copy on signature complete (uses existing email infra; reads `defendant_email` from citation row)

### 6.2 API endpoints (PR 2)

| Method | Path | Purpose | Auth |
|---|---|---|---|
| `POST` | `/api/citations/:id/signature` | Initiate sig: `{method, signature_png?, refusal_reason?}` → stamps PDFs | officer+ |
| `GET` | `/api/citations/sign/:token` | Public read-only summary (no auth, token-gated) | none |
| `POST` | `/api/citations/sign/:token` | Defendant submits sig: `{signature_png, signed_by_name}` | none |
| `POST` | `/api/citations/:id/signature/cancel` | Officer cancels outstanding QR token | officer+ |

### 6.3 Officer UX (after Save)

```
┌─────────────────────────────────────────────────────────┐
│  CITATION CIT-2026-0001 — Awaiting Signature            │
│  John Doe • Speeding 41-6a-601 • $120.00                │
├─────────────────────────────────────────────────────────┤
│  How is the defendant signing?                          │
│                                                         │
│  ┌─────────────────────┐  ┌─────────────────────┐       │
│  │ ✋ Sign on this      │  │ 📱 Send QR to       │       │
│  │    device           │  │    defendant's phone│       │
│  └─────────────────────┘  └─────────────────────┘       │
│                                                         │
│  ┌───────────────────────────────────────────┐          │
│  │ ⨯ Defendant refused to sign               │          │
│  └───────────────────────────────────────────┘          │
└─────────────────────────────────────────────────────────┘
```

### 6.4 Three signature paths

**Tablet:**
1. Modal opens with `<SignaturePad>` canvas
2. Defendant signs → PNG dataURL captured
3. `POST /api/citations/:id/signature` with `{method:'tablet', signature_png}`
4. Server stores PNG in R2 (`citations/<id>/signature.png`) → pdf-lib stamps PNG on all 4 PDFs at (x=33mm, y=215mm)
5. Officer screen flips to "✓ Signed at 14:32"

**QR:**
1. Officer hits "Send QR" → `POST /api/citations/:id/signature` with `{method:'qr'}` → server creates row with token (32 random chars), `expires_at = now() + 10 min`, returns `{token, sign_url}`
2. Officer screen displays QR code generated client-side from `https://rmpgutah.us/citation/sign/<token>` (using `qrcode.react`, already in bundle)
3. Defendant scans → opens `/citation/sign/<token>` public page → signs + types name + acknowledges
4. `POST /api/citations/sign/:token` with `{signature_png, signed_by_name}` → server atomically flips token status → stores PNG → stamps PDFs → captures IP/UA/geo
5. WebSocket `citation:signed:<id>` → officer's device flips to "✓ Signed by John Doe at 14:32"
6. Officer can hit Cancel mid-flow to invalidate the token

**Refused:**
1. Officer hits "Refused" → modal asks for reason (dropdown or free text)
2. `POST /api/citations/:id/signature` with `{method:'refused', refusal_reason}`
3. Server creates row with `method='refused', status='signed'` → stamps "**X REFUSED TO SIGN**" text on PDFs
4. Officer proceeds to Issue

### 6.5 Token security

- 32-char random (`crypto.getRandomValues` → base64url)
- Single-use: server flips `status` atomically inside the same `UPDATE` that processes the submission (D1 serializable)
- 10-min TTL
- Public route resolves token to citation server-side; token itself encodes nothing (not a JWT)

### 6.6 Tests (PR 2)

- `tests/citationSignatures.test.ts` — tablet POST stores PNG + stamps; QR token issuance + single-use + TTL expiry; refusal stamps text; token brute-force safety (`crypto` RNG)
- `tests/pdfStamp.test.ts` — pdf-lib overlay at known coords on a fixture PDF; verify resulting PDF byte size + signature box content
- `client/src/components/__tests__/SignaturePad.test.tsx` — render + capture PNG dataURL
- `client/src/components/__tests__/CitationSignatureCard.test.tsx` — all three flows + WebSocket re-render

---

## 7. PR 3 — Filing Queue + Friday Auto-Seal + Export

### 7.1 Scope

- `citation_filing`, `citation_filing_batches` tables active
- `client/src/pages/CitationFilingPage.tsx` — new admin filing queue (~500 LOC)
- Friday 17:00 Denver-time auto-seal cron handler
- Export ZIP + manifest endpoint
- Admin status transitions (sealed → submitted → accepted/rejected)
- Manual off-cycle batch creation

### 7.2 Filing queue UI

```
╔══════════════════════════════════════════════════════════════╗
║ CITATION FILING                       [Create off-cycle...]  ║
╠══════════════════════════════════════════════════════════════╣
║ ┌──Pending──┬──Open Batches──┬──Sealed──┬──Exported──┬──Closed──┐
║ │  47       │  2             │  3       │  8         │  142     │
║ └───────────┴────────────────┴──────────┴────────────┴──────────┘
║                                                                ║
║ Active tab: SEALED                                             ║
║                                                                ║
║ BATCH NO            COURT                  CITATIONS   TOTAL   ║
║ BATCH-2026-W25-SLCJC  SL Co Justice Court  34          $5,210  ║
║ BATCH-2026-W25-SJC    Sandy Justice Court  8           $1,090  ║
║ BATCH-2026-W24-MJC    Murray Justice Court 12          $1,940  ║
║                                                                ║
║ Per-batch actions: [View contents] [Export ZIP] [Mark submit]  ║
║                    [Generate manifest]                         ║
╚══════════════════════════════════════════════════════════════╝
```

### 7.3 Friday auto-seal cron

Hooks into the existing `* * * * *` per-minute cron (don't add a new cron entry — per [[project-per-minute-cron-essential]]).

```ts
// src/utils/citationFilingSweep.ts
export async function citationFilingFridaySweep(env: Env, now: Date): Promise<void> {
  // Only at Friday 17:00 Denver time (cron is UTC; convert)
  const denver = new Date(now.toLocaleString('en-US', { timeZone: 'America/Denver' }));
  if (denver.getDay() !== 5 || denver.getHours() !== 17 || denver.getMinutes() !== 0) return;

  const db = getDb(env);
  const rows = await query<{ id: number; court_name: string; fine_amount: number | null }>(
    db,
    `SELECT c.id, c.court_name, c.fine_amount
       FROM citations c
       JOIN citation_filing f ON f.citation_id = c.id
      WHERE f.status = 'pending'
        AND c.status NOT IN ('voided','dismissed')`,
  );
  const byCourt = groupBy(rows, (r) => r.court_name || 'UNASSIGNED');
  const week = isoWeek(denver);
  for (const [court, citations] of Object.entries(byCourt)) {
    const batchNumber = `BATCH-${denver.getFullYear()}-W${week}-${slug(court)}`;
    const total = citations.reduce((s, c) => s + (c.fine_amount || 0), 0);
    const batchId = await createBatch(db, { batchNumber, court, count: citations.length, total });
    await execute(db,
      `UPDATE citation_filing SET status='queued', batch_id=?
         WHERE citation_id IN (${citations.map(() => '?').join(',')})`,
      batchId, ...citations.map((c) => c.id),
    );
  }
  emitAnalytics(/* citation_filing_swept event */);
}
```

### 7.4 Export flow (Monday admin)

1. Admin opens Filing → Sealed → clicks **Export ZIP** on a batch
2. `POST /api/citations/filing/batches/:id/export`
3. Worker fetches all court PDFs from R2 (`Promise.all`) → builds ZIP in memory using **`fflate`** (Worker-compatible, 12 KB) → uploads ZIP back to R2 at `filing-batches/<id>/citations.zip` → builds CSV manifest → uploads to `filing-batches/<id>/manifest.csv`
4. Returns presigned ZIP URL valid for 1 hour
5. Admin downloads → emails/prints/hand-delivers to court → hits **Mark Submitted** with `{tracking_number, submission_method}`
6. (Optional) court returns confirmation → admin marks **Accepted** or **Rejected** (rejected returns citations to `pending`)

### 7.5 API endpoints (PR 3)

| Method | Path | Purpose | Auth |
|---|---|---|---|
| `GET` | `/api/citations/filing/batches` | List batches (filter `status=`) | supervisor+ |
| `POST` | `/api/citations/filing/batches` | Create off-cycle batch manually | admin/manager |
| `POST` | `/api/citations/filing/batches/:id/export` | Generate ZIP + manifest, return presigned URL | admin/manager |
| `POST` | `/api/citations/filing/batches/:id/status` | Update status w/ tracking/notes | admin/manager |

### 7.6 Tests (PR 3)

- `tests/citationFiling.test.ts` — Friday auto-seal grouping by court; ISO week boundary; off-cycle batch; ZIP+manifest content; status transitions
- `client/src/pages/__tests__/CitationFilingPage.test.tsx` — tab rendering, action wire-up

---

## 8. Court Routing — Three-Layer Strategy

| Layer | Mechanism | Defaults |
|---|---|---|
| **1. Per-zone** | `agency_court_zones` table mapped to citation's `zone_id` | RMPG contracted zones seeded |
| **2. Manual override** | Officer picks from `utahJusticeCourts.ts` dropdown (~80 rows) | At issue time |
| **3. Workspace default** | KV-stored `default_court_name` for unassigned zones | "Salt Lake County Justice Court — West Jordan Branch" |

Geofenced lat/lng → court lookup is **out of scope** — too brittle without Utah Courts geocode data. Per-zone is sufficient for RMPG's known contract footprint.

---

## 9. UI Changes to CitationAuthor.tsx

Four surgical additions to the existing 922-LOC entry form — **no rewrite**:

1. **Court Block** — three new fields (Court Name dropdown, auto-fill Address, Mandatory Appearance checkbox)
2. **Statute Picker** — autocomplete suggestion list backed by `utahStatutesCommon.ts` (80 rows); free-text fallback retained
3. **Issue Citation 3-step wizard** — replaces single "Save & Print":
   - Step 1: Save (creates row, returns id)
   - Step 2: Sign (CitationSignatureCard — PR 2)
   - Step 3: Issue (renders 4 PDFs, uploads via `/copies`, opens defendant copy in Print/Share)
4. **Defendant Phone + Email** — two new optional fields; on sign complete, server fires email with presigned 30-day R2 link

---

## 10. Error Handling & Edge Cases

| Case | Behavior |
|---|---|
| QR token expired (>10 min) | Public sign page shows "This signing link has expired. Contact the issuing officer." Officer can re-issue a new token. |
| QR token already used | Same friendly error; officer flow shows already-signed status |
| pdf-lib stamp fails | Citation issuance succeeds with `status='pending'`; admin alert raised; manual re-stamp endpoint admin-only |
| R2 upload fails | Citation row stays; `citation_filing.status='pending'`, no R2 URLs; officer sees "PDFs failed — saved, retry from list" |
| WebSocket drop during QR flow | Officer can hit "Check status" — polls `/api/citations/:id/signature/status` |
| Officer refresh during signature | Tablet path: signature lost (acceptable — officer re-prompts); QR path: token still valid until TTL |
| Court rejection on batch | Batch status flips to `rejected` with notes; child citations return to `pending`; admin can re-seal into next week's batch |

---

## 11. Testing Strategy

| Layer | Tests | Notes |
|---|---|---|
| PDF engine | `tests/citationUtahLayout.test.ts` | Field positions, sidecar round-trip, multi-copy watermark |
| Signature flow | `tests/citationSignatures.test.ts` | All 3 methods + token security |
| Filing | `tests/citationFiling.test.ts` | Auto-seal, batch ops, ZIP/manifest |
| Migration | Idempotency tests | Repeat-apply safe |
| Client unit | `__tests__/SignaturePad`, `CitationSignatureCard`, `CitationFilingPage` | Component-level |
| Worker route | **None** | Per CLAUDE.md "no Worker test suite yet"; out of MVP scope |
| Manual | End-to-end: issue → sign → batch → export | Required pre-deploy; operator runs |

CI already runs `npm run typecheck` + `cd client && npx tsc --noEmit` + `cd client && npx vitest run` + `cd client && npx vite build` on every PR (`pr-tests.yml`). Pre-push husky mirrors. No CI changes needed.

---

## 12. Rollout & Migration Apply

### Per-PR migration checklist (gotcha #5)

After each PR merges to `main` and `deploy.yml` finishes:

1. **Apply migration:** `scripts/apply-migration.sh 0150_citation_filing.sql` (PR 1 only)
2. **Verify tables:** `wrangler d1 execute rmpg-flex --remote --command 'SELECT name FROM sqlite_master WHERE type="table" AND name LIKE "citation_%"'`
3. **Verify columns:** `pragma_table_info('citation_filing')` etc.
4. **Confirm health:** `curl -sf https://api.rmpgutah.us/api/health` → expect 200
5. **Confirm analytics:** new `citation_signed`, `citation_filed`, `citation_filing_swept` events emit to `flex_events`
6. **Browser-eyeball:** open `https://rmpgutah.us/citations` (operator-run; WAF challenge blocks headless)

### Feature flag rollout

- PR 1 merge: `useUtahMaster=false` workspace-wide
- After PR 1 + 2 land on main: flip `useUtahMaster=true` for one test officer
- Verify 3+ real citations issued end-to-end with the master form
- Flip to `useUtahMaster=true` workspace-wide
- After PR 3 lands + first Friday auto-seal verified: deprecate `citation.ts` (the old PS-209 schema)

---

## 13. Post-MVP Roadmap (PRs 4–7)

Each PR ships independently after PRs 1–3 are live. Sequenced by external-dependency surface (least → most) and value to operators. **Each gets its own detailed spec when starting that PR** — these are scope summaries only.

### PR 4 — Scene Photo Embedding (no external deps, ~400 LOC)
- Pull photos from `field_photos` linked to citation's `call_id`
- New "EVIDENCE PHOTOS" page appended (page 2 when photos present)
- Thumbnail grid + GPS + timestamp + caption + officer attribution
- New `citation_photos(citation_id, field_photo_id, caption, sort_order)` junction
- Photo selector UI between wizard steps 1 and 2

### PR 5 — Utah Statutes Database Seed (~700 LOC)
- New table `utah_statutes` (code, section, subsection, class, default_fine, mandatory_appearance, points)
- Seed from Utah Code Title 41 / 53 / 76 / 77 via one-time pull script from le.utah.gov
- Replaces the 80-row dict from PR 1 with ~3,500 rows
- Endpoints: `GET /api/statutes/search?q=`, `GET /api/statutes/:id`
- Auto-fine + mandatory-appearance from statute metadata
- Monthly cron re-seed (or admin "refresh" button)

### PR 6 — SMS + Email Defendant Delivery (Twilio, ~600 LOC)
- New `src/utils/sms.ts` Worker-safe client (mirrors `fleetio/client.ts` shape)
- Secrets: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`
- SMS template: "RMPG Citation CIT-2026-0001 — $120.00. Pay online: rmpgutah.us/c/<token>. STOP to opt out."
- Phone E.164 normalize via `libphonenumber-js`
- 503-anti-pattern shim: when Twilio unset, SMS skipped, citation still issues
- Email path activated (already wired)

### PR 7 — Pay-Online Page + Stripe Checkout (~900 LOC, money flow → high risk)
- Public `/citation/pay/<token>` route
- Token gen on citation issuance (separate from sign-token, 1-year TTL)
- Stripe Checkout Session (server-side, hosted) → simpler than custom card form
- Webhook `POST /api/citations/pay/webhook` (signature-verified, `STRIPE_WEBHOOK_SECRET`)
- On `payment_intent.succeeded` → insert `citation_payments` row → auto-flip citation status to `paid`
- Receipt PDF → R2 → emailed/SMSed
- Court copy gets a "PAID" stamp added retroactively via pdf-lib
- Admin "Mark Paid (Manual)" for cash payments
- Refunds + disputes as PR 7.5 follow-up

### Deferred indefinitely

- **Utah XCH/UJB ECF e-filing** — requires registered filer account + per-court XML schemas + contract relationship with Utah Courts. Queue for review after 3 months of production volume.
- **CitationsPage list-view Spillman replatform** — covered separately by [[project-spillman-flex-structural-replica]] program

### Program total

| PR | What | LOC delta | External deps | Risk |
|---|---|---|---|---|
| 1 | Engine + Master form + Copy upload | ~1,800 | pdf-lib, fflate | Low |
| 2 | Signature flow (tablet/QR/refused) | ~900 | None | Med (public route, token sec) |
| 3 | Filing queue + Friday auto-seal + ZIP | ~1,200 | None | Med (cron, batch ops) |
| 4 | Scene photo embedding | ~400 | None | Low |
| 5 | Utah statutes seed | ~700 | None | Low (data) |
| 6 | SMS + email delivery | ~600 | Twilio | Med (vendor setup) |
| 7 | Pay-online + Stripe Checkout | ~900 | Stripe | High (money flow) |

Total: **~6,500 LOC across 7 PRs**.

---

## 14. Open Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Utah Uniform Citation layout drifts when courts update Rule 4-704 | Engine extension is layout-agnostic; layout lives in one schema file — swap-out is a single-file change |
| pdf-lib bundle size on Worker (~80 KB) | Acceptable; current Worker is well under the 1 MB limit |
| Defendant rejects QR sign and demands paper-only | Refused-to-sign escape hatch + tablet path covers it |
| Friday cron firing late or skipping | Per-minute cron is essential; the sweep is idempotent (matches `f.status='pending'`) so a late firing still processes correctly |
| Auto-seal grouping by court_name when court_name is NULL on some citations | NULLs grouped under `UNASSIGNED` batch; admin manually re-routes |
| Defendant copy reaches violator before signature in tablet flow if officer prints first | Wizard enforces step order: Save → Sign → Issue; print only available in Step 3 |
| Court rejects format on first batch | PR 1 verification step includes operator review of generated PDF against a live Utah Justice Court submission |
| Plaintiff caption legally inaccurate (state vs private) | Configurable per zone via `agency_court_zones.plaintiff_name`; defaults to RMPG (the conservative choice) — only flipped to "STATE OF UTAH" where municipal contract grants deputization |

---

## 15. Acceptance Criteria

### PR 1
- [ ] Migration 0150 applied to live D1; 4 tables present (incl. `agency_court_zones`)
- [ ] `useUtahMaster=true` workspace flag produces an authentic Utah Uniform Citation PDF
- [ ] All 4 copies (defendant/court/agency/file) generated with correct bottom-strip tint + watermark
- [ ] `POST /api/citations/:id/copies` stores all 4 PDFs in R2 + creates `citation_filing` row
- [ ] `citation.ts` (old PS-209) still works when flag off

### PR 2
- [ ] Tablet sign path embeds PNG signature on all 4 R2 PDFs (verified via pdf-lib byte diff)
- [ ] QR sign path: token issuance + 10-min TTL + single-use + IP/UA/geo audit captured
- [ ] Public `/citation/sign/:token` page rejects expired and used tokens
- [ ] Refused-to-sign stamps text on all 4 PDFs; flow ends in success state
- [ ] WebSocket broadcasts `citation:signed:<id>` to officer device
- [ ] Email delivery to defendant fires on signature complete (when email provided)

### PR 3
- [ ] Friday 17:00 Denver auto-seal creates `BATCH-YYYY-Www-<court>` batches grouped by court
- [ ] Admin Filing page displays Pending/Open/Sealed/Exported/Closed tabs with counts
- [ ] Export ZIP endpoint produces a valid ZIP + CSV manifest on R2; presigned URL works
- [ ] Status transitions: open → sealed → submitted → accepted (and rejected returns citations to pending)
- [ ] Off-cycle batch creation works for admins

---

## 16. Memory & Reference

This spec extends:
- [[project-systemwide-runtime-sweep]] — orchestrated route audit shape; mirrors that for citation paths
- [[feedback-503-not-configured-anti-pattern]] — PR 6 SMS uses `notConfigured` shim
- [[project-per-minute-cron-essential]] — PR 3 hooks the existing per-minute cron
- [[project-systemwide-daynight-theme]] — all new UI uses theme tokens (`rmpg-*`, `brand-*`, `surface-*`), no hardcoded hex
- [[project-spillman-flex-structural-replica]] — citation list view replatform is part of that program, not this one

CLAUDE.md gotchas hit:
- #5 (deploy step is `continue-on-error`) — `scripts/apply-migration.sh` step in §12
- #6 (SW cache auto-stamp) — no manual `CACHE_NAME` bump
- #13 (D1 100-col cap) — no `ALTER TABLE citations`; new columns go to 3 new tables

---

End of spec.
