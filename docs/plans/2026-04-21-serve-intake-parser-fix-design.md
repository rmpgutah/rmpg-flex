# Serve Intake Parser Fix — Design

Date: 2026-04-21
Author: chzamo@rmpgutah.us
Scope: `server/src/routes/serveIntake.ts`, `client/src/pages/ServeIntakePage.tsx`, `clients` table schema

## Problem

The Process Service Intake page at `/serve-intake` produces malformed Call-for-Service reports. Comparing the current output `26-CFS00168` (broken, Teoyotl) to the target format `26-CFS00154` (correct, Gutierrez), the parser mis-identifies caller, attorney, plaintiff, and billing code; skips geocode, beat, weather, and building-level fields; and produces flat unstructured notes instead of the 8-section pipe-delimited narrative the CFS form is designed for.

## Target format

Notes narrative is 8 ordered entries, each with an ALL-CAPS section prefix and pipe-delimited fields:

1. `CASE -- PLAINTIFF: … | ORDERING CLIENT: … | CASE #… | DOCUMENTS: N DOCS (A + B + C), N PAGES[, BILINGUAL] | SIGNED/FILED: … | RESPONSE DEADLINE: 21 DAYS AFTER SERVICE`
2. `COURT -- [NAME] | ADDRESS: … | CLERK: (801) 238-7300`
3. `ATTORNEY -- [Name] ([Firm]) BAR#[N] | [address] | TEL: … | EMAIL: …`
4. `SERVICE RULES -- [normalized human summary of instructions]`
5. `SCHEDULE -- WINDOWS: … | DUE: mm/dd/yyyy (Nd REMAINING)`
6. `RECOMMENDED SCHEDULE -- DILIGENCE-COMPLIANT ATTEMPT PLAN:` + 3 numbered attempts
7. `CLIENT HISTORY -- IMPORTED FROM JOB ACTIVITY LOG:` + each entry from Info Sheet
8. `INSTRUCTIONS (VERBATIM) -- [original unmodified text]`

CFS header fields:
- `CALLER NAME` = vendor (ICU Investigations, LLC. from `clients` row), not the court caption heading
- `BILLING CODE` / `REQUESTOR EMAIL` from `clients` row lookup, not from free-text
- `DOCUMENT TYPE` = primary token of the Documents list (e.g. `SUMMONS` not `COMPLAINT`)
- `SERVICE TYPE` = derived label (e.g. `SUMMONS SERVICE`)
- `PROPERTY` = `${street} -- ${LASTNAME} RESIDENCE`
- `BUILDING` / `FLOOR` / `SUITE` populated from address tokens; defaults `1ST` / `NOT APPLICABLE`
- `SECTION` / `ZONE` / `BEAT` / `DISPATCH CODE` populated from geocode + `identifyBeat`
- `WEATHER` / `LIGHTING` populated from geocode + open-meteo

## Changes

### 1. Source-of-truth priority (reorder extraction)

| Datum | Primary source | Fallback | Cross-check |
|---|---|---|---|
| Party to serve | Field Sheet `Party to Serve` | Info Sheet `Recipient` | Docket `Defendant` caption |
| DOB | Field Sheet `Other: DOB:` | Info Sheet `DOB:` | — |
| Service address | Field Sheet `Address` block | Info Sheet `Recipient` block | Docket complaint ¶2 `who resides at` (verification only) |
| Documents list | Field Sheet `Documents` | Info Sheet `Docs to Be Served` | Docket page-1 header |
| Instructions | Field Sheet `Instructions` block | Info Sheet `Service Instructions` | — |
| Job # (ICU) | Field Sheet `Job:` header | Info Sheet `JOB` / barcode `*S1000…*` | — |
| Due date | Field Sheet `Due:` header | Info Sheet `Due` | — |
| Plaintiff | Info Sheet `Plaintiff` label | Docket caption (`$NAME,\s*\n\s*Plaintiff,` pattern) | — |
| Court name | Info Sheet `Court` label | Docket `IN THE \w+ JUDICIAL DISTRICT COURT` | — |
| Court address | Info Sheet `Court Address` | Docket `450 South State St…` URCP 4 text | — |
| County | Info Sheet `County` | Docket `\w+ COUNTY` caption | — |
| Firm | Info Sheet right-panel (pre-`Edit`/`Share` block) | Docket attorney block line 1 (all-caps, before Bar#) | — |
| Attorney name | Docket attorney block: tokens on same line as `Bar#` | `/s/` signature block at bottom | — |
| Bar # | Docket `Bar#\s*(\d+)` | — | — |
| Firm address | Docket attorney block lines 2-3 (`PO Box …` / `City, ST ZIP`) | — | — |
| Tel / Fax / Email | Docket attorney block labelled lines | — | — |
| Clerk phone | Docket URCP 4 boilerplate `call the clerk of the court at \((\d{3})\)(\d{3}-\d{4})` | — | — |
| Signed date | Docket `DATED\s+[A-Z][a-z]+ \d+, \d{4}` | — | — |
| Response deadline | Docket `Within (\d+) days after service` (first match) | default `21` | — |
| Civil case # | Docket `Civil No.\s*([A-Z0-9-]+)` | blank (often empty on filing) | — |
| Job activity log | Info Sheet `Job Activity` section — timestamped lines until end of block | — | — |
| Vendor (caller) | `clients` table row matched by fingerprint (Field Sheet letterhead or Info Sheet `Created By`) | fallback: first active vendor | — |

### 2. New attorney block extractor

```typescript
function extractAttorneyBlock(docketText: string): {
  firm: string; name: string; barNumber: string;
  addressLine1: string; addressLine2: string;
  tel: string; fax: string; email: string;
} {
  // Anchor on Bar# token — present exactly once per block, case-insensitive
  const barMatch = docketText.match(/([A-Z][a-zA-Z. ]+?),?\s*\(?(?:Utah\s+Attorney\s+)?Bar#?\s*(\d+)\)?/);
  if (!barMatch) return empty;
  const name = barMatch[1].trim();
  const barNumber = barMatch[2];
  // Firm = nearest prior non-empty ALL-CAPS line
  const barIdx = docketText.indexOf(barMatch[0]);
  const before = docketText.slice(Math.max(0, barIdx - 200), barIdx).split('\n').map(l => l.trim()).filter(Boolean);
  const firm = [...before].reverse().find(l => /^[A-Z&,. ]+$/.test(l) && l.length > 3) || '';
  // Address lines 1-2 immediately after the Bar# line, before Tel:
  const after = docketText.slice(barIdx + barMatch[0].length).split('\n').map(l => l.trim());
  const addrLines: string[] = [];
  for (const line of after) {
    if (/^Tel[:\s]/i.test(line) || /^FAX[:\s]/i.test(line) || /@/.test(line) || /Attorney for/i.test(line)) break;
    if (line) addrLines.push(line);
    if (addrLines.length === 2) break;
  }
  const tel = (docketText.match(/Tel[:\s]*\(?(\d{3})\)?[-.\s]?(\d{3})[-.\s]?(\d{4})/i) || []).slice(1).join('') || '';
  const fax = (docketText.match(/FAX[:\s]*\(?(\d{3})\)?[-.\s]?(\d{3})[-.\s]?(\d{4})/i) || []).slice(1).join('') || '';
  const email = (docketText.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i) || [])[1] || '';
  return { firm, name, barNumber, addressLine1: addrLines[0] || '', addressLine2: addrLines[1] || '', tel, fax, email };
}
```

### 3. New plaintiff extractor (caption-aware)

```typescript
function extractPlaintiffFromCaption(docketText: string): string {
  // Utah caption pattern: plaintiff name ends with comma, then newline, then " Plaintiff,"
  const m = docketText.match(/([A-Z][^\n]{5,200}?),\s*\n\s*Plaintiff,/);
  if (m) return m[1].replace(/\s+/g, ' ').trim();
  return '';
}
```

Info Sheet parser takes precedence because its `Plaintiff:` label is clean.

### 4. New `clients` table columns + vendor lookup

Add via `addCol()` in `database.ts`:
- `clients.billing_code TEXT`
- `clients.requestor_email TEXT`
- `clients.vendor_fingerprint TEXT` (e.g. `ICU Investigations, LLC`)
- `clients.caller_phone TEXT`

At intake, fingerprint-match against Info Sheet's `Created By` value (or Field Sheet letterhead). If no match, fall back to `client_id` supplied in request body (currently defaults to `1`).

Seed ICU row:
```sql
UPDATE clients SET billing_code='0175', requestor_email='a1processserver@gmail.com',
                   vendor_fingerprint='ICU Investigations, LLC', caller_phone='(435) 986-1200'
WHERE id = 1;
```
(Actual ID resolved at seed time.)

### 5. Info Sheet `Job Activity` parser

The Info Sheet's `Job Activity` block in `pdftotext -layout` output is a sequence of rows:
```
4/13/26, 2:10 pm  Process server assigned  Christopher Zamora was assigned to the job  Jason Currie
4/7/26, 12:12 pm  Due Date Changed         Due date was changed from Apr 15, 2026 to Apr 21, 2026
```

Parse pattern: `^(\d{1,2}\/\d{1,2}\/\d{2},\s+\d{1,2}:\d{2}\s*[ap]m)\s+([A-Z][^\n]{3,40}?)\s{2,}(.+)$`. Group into `{ when, action, detail }` and emit one line per entry in the `CLIENT HISTORY` note.

### 6. Recommended schedule algorithm

```typescript
function recommendedAttempts(dueDate: Date, now: Date): Array<{ date: Date; window: string; note: string }> {
  // Utah diligence rule: 1 attempt in each of (6AM-9AM, 9AM-6PM, 6PM-9PM), >=1 on weekend.
  const daysRemaining = Math.max(1, Math.ceil((dueDate.getTime() - now.getTime()) / 86400000));
  // Spread attempts evenly across remaining days, rotating through the 3 windows.
  // Prefer putting the weekend-required slot on the closest Sat/Sun.
  // (Implementation detail — see implementation plan.)
}
```

### 7. Observability — remove silent catches

Replace each `catch { /* … */ }` in the geocode/identifyBeat/weather paths with `logger.warn({ err, address, lat, lng }, 'serve intake geocode/beat/weather failed')` per the structured logging convention in CLAUDE.md. The current behaviour silently produces `N/A` for every spatial field and there's no way to diagnose.

### 8. Property / address field parsing

```typescript
function parseAddressParts(address: string): { building: string; floor: string; suite: string; street: string; city: string; state: string; zip: string } {
  // "1812 WEST 4100 SOUTH UNIT E215, WEST VALLEY CITY, UT 84119"
  //   building = leading number = "1812"
  //   suite = unit token after UNIT|STE|APT|#
  //   floor = "1ST" default unless suite contains floor digit (e.g. "2ND FLR")
  // "1176 EL MONTE DRIVE, SALT LAKE CITY, UT 84117"
  //   building = "1176", suite = "NOT APPLICABLE", floor = "1ST"
}
```

Property name: `${streetLine} -- ${lastName.toUpperCase()} RESIDENCE`.

### 9. Description formatter

```
SERVE ${primaryDoc} AND ${secondaryDoc[; tertiaryDoc]} TO ${FULL NAME UPPERCASE}
AT ${ADDRESS UPPERCASE}
CASE #${ICU_JOB} -- ${COURT NAME UPPERCASE}
DUE: ${DUE_DATE} (${Nd})
```

### 10. Service type derivation

| Primary doc token | Service type |
|---|---|
| `SUMMONS` | `SUMMONS SERVICE` |
| `SUBPOENA` | `SUBPOENA SERVICE` |
| `EVICTION` / `UNLAWFUL DETAINER` | `EVICTION SERVICE` |
| `RESTRAINING ORDER` / `PROTECTIVE ORDER` | `RESTRAINING ORDER SERVICE` |
| `CITATION` | `CITATION SERVICE` |
| else | `PROCESS SERVICE` |

## Records + Detailing fanout (full scope)

Every intake must fan out into Records (persons, properties, cases, contacts), Dispatch (calls_for_service + junctions), and Detailing (serve_queue + serve_attempts). The parser is only step 1; the DB writes are step 2.

### Newly created DB rows per intake (in order)

1. **`clients` (lookup only)** — fingerprint-match on `Created By` / letterhead → get `billing_code`, `requestor_email`, `caller_phone`.
2. **`persons` (defendant)** — first/middle/last, dob, address; match existing by name+dob before insert.
3. **`persons` (plaintiff)** — role=`plaintiff`, `entity_type='organization'` when name ends in `Inc.`, `LLC`, `N.A.`, `Bank`, etc.; otherwise `individual`.
4. **`persons` (attorney)** — role=`attorney`, new columns `bar_number TEXT`, `firm_name TEXT` on `persons` via `addCol()`.
5. **`contacts` (firm)** — name, address, tel, fax, email. If `contacts` table doesn't exist, reuse `persons` with `entity_type='organization'`.
6. **`properties`** — address, city/state/zip, lat/lng, building (street number), floor (`1ST` default), suite (parsed unit or `NOT APPLICABLE`), name = `${street} — ${LASTNAME} RESIDENCE`.
7. **`cases` (civil)** — `case_number`=ICU job#, `title`=`${plaintiff last token} v. ${defendant last name}`, `case_type='civil_process'`, `status='active'`, `summary`=cause of action (credit card debt, eviction, etc.), `narrative`=first 500 chars of complaint ¶s, `due_date`=signed/filed + response deadline. New columns on `cases` via `addCol()`: `court_case_number`, `court_id`, `plaintiff_person_id`, `defendant_person_id`, `attorney_person_id`, `signed_filed_date`, `response_deadline_days`, `amount_demanded`.
8. **`calls_for_service`** — as today but with correct caller/billing/service-type values and the 8-entry JSON notes.
9. **`call_persons`** — one row each for defendant (`role='subject'`), plaintiff (`role='complainant'`), attorney (`role='reporting_party'`).
10. **`record_links`** — `person(defendant)↔property`, `person(attorney)↔case`, `person(plaintiff)↔case`.
11. **`case_persons`** / **`case_properties`** / **`case_calls`** — junctions (per CLAUDE.md these 8 junctions exist; lazy-create if missing).
12. **`serve_queue`** — as today.
13. **`serve_attempts` (3 rows)** — pre-planned per diligence algorithm: `planned_at`, `window` (`6-9am`/`9am-6pm`/`6-9pm`), `status='planned'`. Weekend slot required on at least one.
14. **`audit_log`** — action `SERVE_INTAKE`, payload = summary of all created IDs.
15. **WebSocket broadcast** — `dispatch_update` (`call_created`) + `records_update` (`persons_created`, `case_created`) so all connected clients refresh.

### UI surfaces that light up automatically

| Module | Route | What the user sees |
|---|---|---|
| Dispatch | `/dispatch` | New P4 call in Active Calls; structured 8-section notes in drawer; pin on map at service address |
| Dispatch Map | `/map` | Property marker with resident + next-attempt popup; beat overlay highlights service sector |
| Records — Persons | `/records` | Defendant, plaintiff, attorney all searchable by name/dob/bar# |
| Records — Properties | `/records` (properties tab) | Service address with linked resident |
| Records — Cases | `/cases` (if route exists) or records cases tab | Civil case with plaintiff/defendant/attorney/property/call all linked |
| Serve Queue | `/serve` | Pending row with due date + 3 planned attempts + rules summary |
| Calendar | officer schedule view | 3 pre-planned attempts on diligence windows |
| MNI Dossier | `/records/persons/:id/dossier` | Case involvement shows up for defendant |
| Compound Search | `/api/records/compound-search` | All new persons/properties indexed |
| Audit | admin audit log | `SERVE_INTAKE` row per upload |

### Schema additions (via `addCol()` in `database.ts`)

```typescript
addCol('clients', 'billing_code', 'TEXT');
addCol('clients', 'requestor_email', 'TEXT');
addCol('clients', 'vendor_fingerprint', 'TEXT');
addCol('clients', 'caller_phone', 'TEXT');

addCol('persons', 'role_tag', 'TEXT');           // 'defendant' | 'plaintiff' | 'attorney' | 'resident' | null
addCol('persons', 'entity_type', 'TEXT');        // 'individual' | 'organization'
addCol('persons', 'bar_number', 'TEXT');
addCol('persons', 'firm_name', 'TEXT');

addCol('cases', 'court_case_number', 'TEXT');
addCol('cases', 'court_id', 'INTEGER');
addCol('cases', 'plaintiff_person_id', 'INTEGER');
addCol('cases', 'defendant_person_id', 'INTEGER');
addCol('cases', 'attorney_person_id', 'INTEGER');
addCol('cases', 'signed_filed_date', 'TEXT');
addCol('cases', 'response_deadline_days', 'INTEGER');
addCol('cases', 'amount_demanded', 'REAL');
addCol('cases', 'cause_of_action', 'TEXT');

addCol('serve_attempts', 'planned_at', 'TEXT');  // if existing serve_attempts lacks a 'planned' status row concept
addCol('serve_attempts', 'window', 'TEXT');
```

Create `case_persons` / `case_properties` / `case_calls` junction tables if they don't already exist (per CLAUDE.md they should, but verify at startup with `CREATE TABLE IF NOT EXISTS`).

### Response payload from `/api/serve-intake/intake`

Return all created IDs so the client can offer contextual "View in Records / View in Dispatch / View in Serve Queue" links immediately:

```json
{
  "success": true,
  "defendant_person_id": 1234,
  "plaintiff_person_id": 1235,
  "attorney_person_id": 1236,
  "property_id": 567,
  "case_id": 89,
  "call_id": 321,
  "call_number": "26-CFS00169",
  "serve_queue_id": 45,
  "serve_attempt_ids": [101, 102, 103],
  "extracted": { /* as before */ },
  "warnings": ["geocode returned no result for '1812 WEST 4100 SOUTH …'"]
}
```

The client [ServeIntakePage](../../client/src/pages/ServeIntakePage.tsx) result panel adds three new link buttons (Case, Plaintiff, Attorney) plus a Serve Queue link.

## Out of scope (flag for follow-up)

- `caller_relationship` CFS renderer mapping: intake writes `'client'`, CFS template renders `MANAGEMENT`. The rendering is in the PS-201 PDF generator, not intake. Address in a separate change.
- Barcode-based verification UX: if `*S10000NNNNNN*` on docket disagrees with Field Sheet's `(NNNNNN)`, surface a warning banner. Not in scope for this fix.
- Multi-defendant support: current intake assumes one party to serve. Some dockets name multiple defendants. Defer.

## Testing

- Add golden-fixture test: `tests/fixtures/serve-intake/armstrong/` with the three source PDF texts + expected `IntakeResult`. Assert deep-equal on every `extracted.*` field plus the generated notes structure.
- Add fixture for Gutierrez case (re-create from `26-CFS00154` — if original source PDFs aren't available, use the CFS output as the golden).
- Add fixture for Teoyotl case (currently-broken, will become a regression guard).
- Smoke test that geocode failure surfaces a warning log and still creates a call (don't regress the "N/A but record created" behaviour for offline dev).

## Rollout

1. DB migration: add the 4 `clients` columns and seed the ICU row.
2. Rewrite `serveIntake.ts` with the new extractors + structured notes.
3. Deploy with `bash deploy/deploy.sh`, bump `CACHE_NAME` in `sw.js`.
4. Re-run intake on Armstrong source PDFs; verify output matches the Gutierrez format.
5. Spot-check 3 most recent live intakes by regenerating their CFS PDF from the stored call row (read-only) and comparing to what's on file.

## Acceptance

Running the Armstrong intake with the three provided PDFs produces a CFS whose every CALLER/PSO/PROCESS/INCIDENT LOCATION/FLAGS/SCENE field and every NOTES entry matches the shape of `26-CFS00154` with the correct substituted values for Armstrong. Geocode populates Lat/Long and identifies a Beat. No `N/A` in the 15 fields the Gutierrez CFS has filled.
