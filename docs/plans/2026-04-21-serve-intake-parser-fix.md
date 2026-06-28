# Serve Intake Parser Fix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rewrite the Process Service Intake parser to produce correctly-formatted PS-201 Call-for-Service reports matching the `26-CFS00154` (Gutierrez) template, and fan out every intake into Records (persons for defendant/plaintiff/attorney, properties, civil case), Dispatch (calls_for_service + call_persons), and Detailing (serve_queue + 3 pre-planned serve_attempts).

**Architecture:** Pure, unit-testable extractor helpers anchored on reliable tokens in each source PDF (Info Sheet labels, Court Docket `Bar#` token, Field Sheet header). A single `/api/serve-intake/intake` route orchestrates: vendor fingerprint lookup → parse all three documents → create/match persons → create property → create case → create CFS → create serve_queue → create 3 planned serve_attempts → audit → broadcast → respond with all IDs.

**Tech Stack:** Express 5 + better-sqlite3 + vitest (TDD), pino for logging, existing `geocodeAddress` + `identifyBeat` utilities. No new dependencies.

**Context files the engineer should read first:**
- Design: [docs/plans/2026-04-21-serve-intake-parser-fix-design.md](2026-04-21-serve-intake-parser-fix-design.md)
- Current intake route: [server/src/routes/serveIntake.ts](../../server/src/routes/serveIntake.ts)
- Current client page: [client/src/pages/ServeIntakePage.tsx](../../client/src/pages/ServeIntakePage.tsx)
- Target format (a good PS-201 output) and broken output: the two CFS PDFs in user's Downloads (`26-CFS00154.pdf`, `26-CFS00168.pdf`) — do not need to re-read, fixtures will cover.
- DB patterns: `addCol` helper in [server/src/models/database.ts:40](../../server/src/models/database.ts) (approx)
- Project conventions: [CLAUDE.md](../../CLAUDE.md) — especially Gotcha #42 (don't use the child_process exec shortcut in DDL), Gotcha #40 (deploy.sh leaves zombies), Gotcha #43 (parallel worktree deploys)

---

## Task 0: Prepare golden-fixture test data

**Files:**
- Create: `server/src/routes/__tests__/fixtures/serveIntake/armstrong.fieldSheet.txt`
- Create: `server/src/routes/__tests__/fixtures/serveIntake/armstrong.infoSheet.txt`
- Create: `server/src/routes/__tests__/fixtures/serveIntake/armstrong.courtDocket.txt`
- Create: `server/src/routes/__tests__/fixtures/serveIntake/gutierrez.expectedExtract.json`

**Step 1: Create the fixture directory and save raw `pdftotext -layout` output**

Armstrong PDFs are at `/Users/rmpgutah/Desktop/ICU Investigations/15570133 - Armstrong/`. Run on the dev machine:

```bash
mkdir -p server/src/routes/__tests__/fixtures/serveIntake
pdftotext -layout "/Users/rmpgutah/Desktop/ICU Investigations/15570133 - Armstrong/15570133 Field Sheet.pdf" - > server/src/routes/__tests__/fixtures/serveIntake/armstrong.fieldSheet.txt
pdftotext -layout "/Users/rmpgutah/Desktop/ICU Investigations/15570133 - Armstrong/15570133 Info Sheet.pdf" - > server/src/routes/__tests__/fixtures/serveIntake/armstrong.infoSheet.txt
pdftotext -layout "/Users/rmpgutah/Desktop/ICU Investigations/15570133 - Armstrong/15570133 Court Docket.pdf" - > server/src/routes/__tests__/fixtures/serveIntake/armstrong.courtDocket.txt
```

If `pdftotext` is missing locally: `brew install poppler`. On VPS it's at `/usr/bin/pdftotext`.

**Step 2: Create the Gutierrez expected-extract JSON**

Based on `26-CFS00154.pdf` (already reviewed in the design session), the fields that should come out of parsing:

```json
{
  "defendant": { "first": "Jim", "middle": "", "last": "Gutierrez", "dob": "1957-05-19" },
  "address": "1176 EL MONTE DRIVE, SALT LAKE CITY, UT 84117",
  "addressParts": { "building": "1176", "floor": "1ST", "suite": "NOT APPLICABLE", "street": "1176 EL MONTE DRIVE", "city": "SALT LAKE CITY", "state": "UT", "zip": "84117" },
  "plaintiff": "Capital One, N.A., successor by merger to Discover Bank",
  "court": "THIRD JUDICIAL DISTRICT COURT",
  "attorney": { "name": "Heather Valerga", "barNumber": "14431", "firm": "GUGLIELMO & ASSOCIATES", "addressLine1": "PO Box 41688", "addressLine2": "Tucson, AZ 85717", "tel": "8773255700", "fax": "5203252480", "email": "Utah@guglielmolaw.com" },
  "documents": "Summons and Complaint; Bilingual Notice",
  "primaryDoc": "SUMMONS",
  "serviceType": "SUMMONS SERVICE",
  "jobNumber": "15570160",
  "clientJobNumber": "633764",
  "dueDate": "04/21/2026",
  "signedDate": "March 25, 2026",
  "responseDeadlineDays": 21,
  "clerkPhone": "(801) 238-7300",
  "courtAddress": "450 South State St, P.O. Box 1860, Salt Lake City UT 84114-1860",
  "vendor": { "name": "ICU INVESTIGATIONS, LLC.", "phone": "(435) 986-1200", "billingCode": "0175", "requestorEmail": "a1processserver@gmail.com" }
}
```

Save at `server/src/routes/__tests__/fixtures/serveIntake/gutierrez.expectedExtract.json`.

**Step 3: Commit**

```bash
git add server/src/routes/__tests__/fixtures/serveIntake/
git commit -m "test(serve-intake): golden-fixture source text + expected extract"
```

---

## Task 1: Schema migrations — clients, persons, cases columns

**Files:**
- Modify: `server/src/models/database.ts` (add addCol calls in the migration block after other addCol groups; grep for `addCol('clients',` or `addCol('persons',` to find a good spot)

**Step 1: Add the `addCol` migrations**

Append to the existing `addCol()` migration sequence (search for a block that does multiple `addCol('persons', ...)` calls — add adjacent to persons' additions):

```typescript
// ── SERVE INTAKE: vendor lookup columns ──────────────────
addCol('clients', 'billing_code', 'TEXT');
addCol('clients', 'requestor_email', 'TEXT');
addCol('clients', 'vendor_fingerprint', 'TEXT');
addCol('clients', 'caller_phone', 'TEXT');

// ── SERVE INTAKE: role-tagged persons for legal parties ──
addCol('persons', 'role_tag', 'TEXT');        // 'defendant' | 'plaintiff' | 'attorney' | 'resident'
addCol('persons', 'entity_type', 'TEXT');     // 'individual' | 'organization'
addCol('persons', 'bar_number', 'TEXT');
addCol('persons', 'firm_name', 'TEXT');

// ── SERVE INTAKE: civil-case metadata ─────────────────────
addCol('cases', 'court_case_number', 'TEXT');
addCol('cases', 'court_id', 'INTEGER');
addCol('cases', 'plaintiff_person_id', 'INTEGER');
addCol('cases', 'defendant_person_id', 'INTEGER');
addCol('cases', 'attorney_person_id', 'INTEGER');
addCol('cases', 'signed_filed_date', 'TEXT');
addCol('cases', 'response_deadline_days', 'INTEGER');
addCol('cases', 'amount_demanded', 'REAL');
addCol('cases', 'cause_of_action', 'TEXT');

// ── SERVE INTAKE: pre-planned attempt windows ─────────────
addCol('serve_attempts', 'planned_at', 'TEXT');
addCol('serve_attempts', 'window', 'TEXT');
addCol('serve_attempts', 'status', 'TEXT');   // 'planned' | 'attempted' | 'served' | 'failed'
```

**Step 2: Seed the ICU vendor row**

In the same file, after the addCol block, add an idempotent seed:

```typescript
// Seed ICU Investigations vendor fingerprint (idempotent — only updates if fields are null)
try {
  const existing = db.prepare("SELECT id FROM clients WHERE name LIKE 'ICU Investigations%' OR vendor_fingerprint = ? LIMIT 1").get('ICU Investigations, LLC') as any;
  if (existing) {
    db.prepare(`UPDATE clients SET
      billing_code = COALESCE(NULLIF(billing_code, ''), '0175'),
      requestor_email = COALESCE(NULLIF(requestor_email, ''), 'a1processserver@gmail.com'),
      vendor_fingerprint = COALESCE(NULLIF(vendor_fingerprint, ''), 'ICU Investigations, LLC'),
      caller_phone = COALESCE(NULLIF(caller_phone, ''), '(435) 986-1200')
      WHERE id = ?`).run(existing.id);
  } else {
    db.prepare(`INSERT INTO clients (name, billing_code, requestor_email, vendor_fingerprint, caller_phone, status)
      VALUES (?, ?, ?, ?, ?, 'active')`).run(
      'ICU Investigations, LLC', '0175', 'a1processserver@gmail.com', 'ICU Investigations, LLC', '(435) 986-1200');
  }
} catch (err) {
  // Non-fatal — column may not exist yet on first run before addCol completes
}
```

**Step 3: Typecheck**

```bash
cd server && npx tsc --noEmit
```

Expected: 0 errors (if there are pre-existing errors unrelated to this change, just confirm you didn't add new ones).

**Step 4: Run the server locally to smoke-test the migration**

```bash
cd server && npx tsx src/index.ts &
sleep 3
curl -sf http://localhost:3001/api/health && echo "OK" || echo "FAIL"
pkill -f "tsx src/index.ts"
```

Expected: `OK`. Then verify the columns were added:

```bash
sqlite3 server/data/rmpg-flex.db "PRAGMA table_info(clients);" | grep -E 'billing_code|requestor_email|vendor_fingerprint|caller_phone'
sqlite3 server/data/rmpg-flex.db "PRAGMA table_info(persons);" | grep -E 'role_tag|entity_type|bar_number|firm_name'
sqlite3 server/data/rmpg-flex.db "PRAGMA table_info(cases);" | grep -E 'court_case_number|plaintiff_person_id|signed_filed_date'
```

Expected: each grep returns matching rows.

**Step 5: Commit**

```bash
git add server/src/models/database.ts
git commit -m "feat(db): serve-intake schema — vendor lookup, role-tagged persons, civil-case metadata"
```

---

## Task 2: Pure helper — `parseAddressParts`

**Files:**
- Create: `server/src/utils/serveIntakeHelpers.ts`
- Create: `server/src/utils/__tests__/serveIntakeHelpers.test.ts`

**Step 1: Write the failing tests**

```typescript
// server/src/utils/__tests__/serveIntakeHelpers.test.ts
import { describe, it, expect } from 'vitest';
import { parseAddressParts } from '../serveIntakeHelpers';

describe('parseAddressParts', () => {
  it('parses a unit-qualified address', () => {
    const r = parseAddressParts('1812 WEST 4100 SOUTH UNIT E215, WEST VALLEY CITY, UT 84119');
    expect(r).toEqual({
      building: '1812', floor: '1ST', suite: 'E215',
      street: '1812 WEST 4100 SOUTH UNIT E215',
      city: 'WEST VALLEY CITY', state: 'UT', zip: '84119',
    });
  });

  it('parses a plain single-family address', () => {
    const r = parseAddressParts('1176 EL MONTE DRIVE, SALT LAKE CITY, UT 84117');
    expect(r).toEqual({
      building: '1176', floor: '1ST', suite: 'NOT APPLICABLE',
      street: '1176 EL MONTE DRIVE',
      city: 'SALT LAKE CITY', state: 'UT', zip: '84117',
    });
  });

  it('handles APT', () => {
    const r = parseAddressParts('500 MAIN ST APT 12B, LOGAN, UT 84321');
    expect(r.suite).toBe('12B');
    expect(r.building).toBe('500');
  });

  it('handles #', () => {
    const r = parseAddressParts('500 MAIN ST #7, LOGAN, UT 84321');
    expect(r.suite).toBe('7');
  });

  it('returns empty parts for unparseable input', () => {
    const r = parseAddressParts('gibberish');
    expect(r.building).toBe('');
    expect(r.city).toBe('');
  });
});
```

**Step 2: Run the test, confirm failure**

```bash
cd server && npx vitest run src/utils/__tests__/serveIntakeHelpers.test.ts
```

Expected: file-not-found error for `../serveIntakeHelpers`.

**Step 3: Implement `parseAddressParts`**

```typescript
// server/src/utils/serveIntakeHelpers.ts
export interface AddressParts {
  building: string;
  floor: string;
  suite: string;
  street: string;
  city: string;
  state: string;
  zip: string;
}

export function parseAddressParts(address: string): AddressParts {
  const empty: AddressParts = { building: '', floor: '', suite: '', street: '', city: '', state: '', zip: '' };
  if (!address) return empty;
  // Split off ", CITY, ST ZIP" tail
  const tailMatch = address.match(/^(.+?),\s*([^,]+),\s*([A-Z]{2})\s*(\d{5}(?:-\d{4})?)$/);
  if (!tailMatch) return { ...empty, street: address };
  const street = tailMatch[1].trim();
  const city = tailMatch[2].trim();
  const state = tailMatch[3];
  const zip = tailMatch[4];
  const buildingMatch = street.match(/^(\d+[A-Z]?)\b/);
  const building = buildingMatch ? buildingMatch[1] : '';
  // Unit / suite / apt / # — first match wins
  const unitMatch = street.match(/\b(?:UNIT|STE|SUITE|APT|APARTMENT|#)\s*([A-Z0-9-]+)\b/i);
  const suite = unitMatch ? unitMatch[1].toUpperCase() : 'NOT APPLICABLE';
  const floor = '1ST';
  return { building, floor, suite, street, city: city.toUpperCase(), state, zip };
}
```

**Step 4: Run the tests, confirm all pass**

```bash
cd server && npx vitest run src/utils/__tests__/serveIntakeHelpers.test.ts
```

Expected: 5 passed.

**Step 5: Commit**

```bash
git add server/src/utils/serveIntakeHelpers.ts server/src/utils/__tests__/serveIntakeHelpers.test.ts
git commit -m "feat(serve-intake): parseAddressParts helper w/ tests"
```

---

## Task 3: Pure helper — `extractAttorneyBlock`

**Files:**
- Modify: `server/src/utils/serveIntakeHelpers.ts`
- Modify: `server/src/utils/__tests__/serveIntakeHelpers.test.ts`

**Step 1: Add failing tests**

Append to the existing test file:

```typescript
import { extractAttorneyBlock } from '../serveIntakeHelpers';

describe('extractAttorneyBlock', () => {
  const armstrongDocket = `
                                                             This document requires you to
                                                     respond. Please see the Notice to Responding Party
    GUGLIELMO & ASSOCIATES
    Heather Valerga, (Utah Attorney Bar#  14431)
    PO Box 41688
    Tucson, AZ 85717
    Tel: (877)325-5700
    FAX: (520)325-2480
    Utah@guglielmolaw.com
    Attorney for Plaintiff
  `;

  it('extracts the Utah attorney block anchored on Bar#', () => {
    const r = extractAttorneyBlock(armstrongDocket);
    expect(r.name).toBe('Heather Valerga');
    expect(r.barNumber).toBe('14431');
    expect(r.firm).toBe('GUGLIELMO & ASSOCIATES');
    expect(r.addressLine1).toBe('PO Box 41688');
    expect(r.addressLine2).toBe('Tucson, AZ 85717');
    expect(r.tel).toBe('8773255700');
    expect(r.fax).toBe('5203252480');
    expect(r.email).toBe('Utah@guglielmolaw.com');
  });

  it('returns empty struct when no Bar# token present', () => {
    const r = extractAttorneyBlock('unrelated pdf text with no bar number');
    expect(r.barNumber).toBe('');
    expect(r.name).toBe('');
  });
});
```

**Step 2: Run tests, confirm failure (extractAttorneyBlock not defined).**

```bash
cd server && npx vitest run src/utils/__tests__/serveIntakeHelpers.test.ts
```

**Step 3: Implement**

Append to `serveIntakeHelpers.ts`:

```typescript
export interface AttorneyBlock {
  firm: string;
  name: string;
  barNumber: string;
  addressLine1: string;
  addressLine2: string;
  tel: string;
  fax: string;
  email: string;
}

export function extractAttorneyBlock(docketText: string): AttorneyBlock {
  const empty: AttorneyBlock = { firm: '', name: '', barNumber: '', addressLine1: '', addressLine2: '', tel: '', fax: '', email: '' };
  if (!docketText) return empty;
  const barMatch = docketText.match(/([A-Z][a-zA-Z.'\- ]+?),?\s*\(?(?:Utah\s+Attorney\s+)?Bar#?\s*(\d+)\)?/);
  if (!barMatch) return empty;
  const name = barMatch[1].trim();
  const barNumber = barMatch[2];
  const barIdx = docketText.indexOf(barMatch[0]);

  // Firm = nearest prior non-empty line that looks like a firm name (all caps or title case; not boilerplate)
  const before = docketText.slice(Math.max(0, barIdx - 400), barIdx).split('\n').map(l => l.trim());
  const firm = [...before].reverse().find(l =>
    l.length > 3 &&
    !/respond|notice|summons|complaint|judicial|state of|court/i.test(l) &&
    /[A-Z]/.test(l) &&
    l === l.toUpperCase().replace(/[^A-Z& .,]/g, '').trim() ? l.length === l.replace(/[^A-Z& .,]/g, '').length : false
  ) || '';
  // Fallback: any all-caps line (looser)
  const firmFallback = firm || [...before].reverse().find(l => /^[A-Z&. ,]+$/.test(l) && l.trim().length > 3) || '';

  // Address lines after Bar# line, before Tel/FAX/email/"Attorney for"
  const after = docketText.slice(barIdx + barMatch[0].length).split('\n').map(l => l.trim());
  const addrLines: string[] = [];
  for (const line of after) {
    if (!line) continue;
    if (/^Tel[:\s]/i.test(line) || /^FAX[:\s]/i.test(line) || /@/.test(line) || /Attorney for/i.test(line)) break;
    addrLines.push(line);
    if (addrLines.length === 2) break;
  }

  const telM = docketText.match(/Tel[:\s]*\(?(\d{3})\)?[-.\s]?(\d{3})[-.\s]?(\d{4})/i);
  const faxM = docketText.match(/FAX[:\s]*\(?(\d{3})\)?[-.\s]?(\d{3})[-.\s]?(\d{4})/i);
  const emailM = docketText.slice(0, barIdx + 2000).match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
  const tel = telM ? telM.slice(1).join('') : '';
  const fax = faxM ? faxM.slice(1).join('') : '';
  const email = emailM ? emailM[1] : '';

  return {
    firm: firmFallback,
    name,
    barNumber,
    addressLine1: addrLines[0] || '',
    addressLine2: addrLines[1] || '',
    tel,
    fax,
    email,
  };
}
```

**Step 4: Run tests; adjust firm regex until both cases pass.**

The firm detector is fiddly — if the first test fails on `firm`, simplify the predicate:

```typescript
const firm = [...before].reverse().find(l =>
  l.length > 3 &&
  /^[A-Z][A-Z& .,]{3,}$/.test(l) &&
  !/JUDICIAL|COURT|SUMMONS|NOTICE/.test(l)
) || '';
```

Expected: 7 passed (original 5 + 2 new).

**Step 5: Commit**

```bash
git add server/src/utils/serveIntakeHelpers.ts server/src/utils/__tests__/serveIntakeHelpers.test.ts
git commit -m "feat(serve-intake): extractAttorneyBlock anchored on Bar# token"
```

---

## Task 4: Pure helper — `parseInfoSheetLabels`

**Files:**
- Modify: `server/src/utils/serveIntakeHelpers.ts`
- Modify: `server/src/utils/__tests__/serveIntakeHelpers.test.ts`

The Info Sheet's right-side panel in `pdftotext -layout` output has clean `Label value` pairs. Parse them.

**Step 1: Add failing tests**

```typescript
import { parseInfoSheetLabels } from '../serveIntakeHelpers';

describe('parseInfoSheetLabels', () => {
  const infoSheet = `
    Court Case
    Case                [not provided]
    Plaintiff           Capital One, N.A., successor by merger to
                        Discover Bank
    Defendant           Abbey Armstrong
    Filed               —
    Court Date          —
    Court               THIRD JUDICIAL DISTRICT COURT, STATE
                        OF UTAH - MATHESON
    Address             450 S STATE ST PO BOX 1860
                        SALT LAKE CITY, UT 84114
    County              SALT LAKE

    Job Created         Apr 1, 2026
    Created By          ICU Investigations, LLC
  `;

  it('parses labelled fields including multi-line values', () => {
    const r = parseInfoSheetLabels(infoSheet);
    expect(r.plaintiff).toBe('Capital One, N.A., successor by merger to Discover Bank');
    expect(r.defendant).toBe('Abbey Armstrong');
    expect(r.court).toBe('THIRD JUDICIAL DISTRICT COURT, STATE OF UTAH - MATHESON');
    expect(r.courtAddress).toBe('450 S STATE ST PO BOX 1860 SALT LAKE CITY, UT 84114');
    expect(r.county).toBe('SALT LAKE');
    expect(r.createdBy).toBe('ICU Investigations, LLC');
  });

  it('returns empty strings when sheet is blank or missing labels', () => {
    const r = parseInfoSheetLabels('');
    expect(r.plaintiff).toBe('');
  });
});
```

**Step 2: Run, confirm fail.**

**Step 3: Implement**

```typescript
export interface InfoSheetLabels {
  plaintiff: string;
  defendant: string;
  court: string;
  courtAddress: string;
  county: string;
  filed: string;
  courtDate: string;
  createdBy: string;
}

export function parseInfoSheetLabels(text: string): InfoSheetLabels {
  const out: InfoSheetLabels = { plaintiff: '', defendant: '', court: '', courtAddress: '', county: '', filed: '', courtDate: '', createdBy: '' };
  if (!text) return out;
  // Known labels in the Info Sheet right panel, in the order they appear.
  const labels: Array<{ key: keyof InfoSheetLabels; label: string; next: string[] }> = [
    { key: 'plaintiff',    label: 'Plaintiff',    next: ['Defendant', 'Filed', 'Court Date', 'Court', 'Address', 'County'] },
    { key: 'defendant',    label: 'Defendant',    next: ['Filed', 'Court Date', 'Court', 'Address', 'County'] },
    { key: 'filed',        label: 'Filed',        next: ['Court Date', 'Court', 'Address', 'County'] },
    { key: 'courtDate',    label: 'Court Date',   next: ['Court', 'Address', 'County'] },
    { key: 'court',        label: 'Court',        next: ['Address', 'County', 'Job Created'] },
    { key: 'courtAddress', label: 'Address',      next: ['County', 'Job Created', 'Created By'] },
    { key: 'county',       label: 'County',       next: ['Job Created', 'Created By'] },
    { key: 'createdBy',    label: 'Created By',   next: ['Last Update', 'Archive', '\n\n'] },
  ];
  for (const { key, label, next } of labels) {
    const labelIdx = text.search(new RegExp(`^\\s*${label}\\b`, 'm'));
    if (labelIdx === -1) continue;
    // Find end of this field = start of next known label (or EOF)
    let endIdx = text.length;
    for (const n of next) {
      const m = text.slice(labelIdx + label.length).search(new RegExp(`^\\s*${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'm'));
      if (m !== -1) {
        endIdx = Math.min(endIdx, labelIdx + label.length + m);
        break;
      }
    }
    // Extract raw, drop the label word, collapse whitespace/newlines
    const raw = text.slice(labelIdx, endIdx).replace(new RegExp(`^\\s*${label}\\b`), '').trim();
    const value = raw.replace(/\s*\n\s*/g, ' ').replace(/\s+/g, ' ').trim();
    if (value && value !== '—' && value !== '[not provided]') out[key] = value;
  }
  return out;
}
```

**Step 4: Run until green.**

Note the regex-quoted `Address` label — if the info sheet has `Address` appearing under Service Instructions too, this might misfire. If tests fail, anchor to the `Court Case` section header: pre-slice `text` to start at `indexOf('Court Case')`.

**Step 5: Commit**

```bash
git add server/src/utils/serveIntakeHelpers.ts server/src/utils/__tests__/serveIntakeHelpers.test.ts
git commit -m "feat(serve-intake): parseInfoSheetLabels — structured label→value extraction"
```

---

## Task 5: Pure helper — `parseJobActivity`

**Files:** same.

**Step 1: Add failing test**

```typescript
import { parseJobActivity } from '../serveIntakeHelpers';

describe('parseJobActivity', () => {
  const infoSheet = `
    Job Activity
    4/13/26, 2:10 pm   Process server assigned   Christopher Zamora was assigned to the job   Jason Currie
    4/7/26, 12:12 pm   Due Date Changed          Due date was changed from Apr 15, 2026 to Apr 21, 2026
    4/2/26, 6:07 am    Job Data Updated          David Blake
    4/1/26, 12:01 pm   Due Date Changed          Due date was set to Apr 15, 2026

    Job Type           G&A Service Type
  `;

  it('parses timestamped activity entries', () => {
    const r = parseJobActivity(infoSheet);
    expect(r).toHaveLength(4);
    expect(r[0].when).toBe('4/13/26, 2:10 pm');
    expect(r[0].action).toBe('Process server assigned');
    expect(r[1].action).toBe('Due Date Changed');
    expect(r[1].detail).toContain('Apr 15, 2026 to Apr 21, 2026');
  });

  it('returns [] when no Job Activity section', () => {
    expect(parseJobActivity('nothing relevant')).toEqual([]);
  });
});
```

**Step 2: Fail.**

**Step 3: Implement**

```typescript
export interface JobActivityEntry { when: string; action: string; detail: string; actor?: string; }

export function parseJobActivity(text: string): JobActivityEntry[] {
  const startIdx = text.search(/^\s*Job Activity\b/m);
  if (startIdx === -1) return [];
  // Stop at the next blank line followed by a capitalized non-date line (heuristic end of activity block)
  const block = text.slice(startIdx).split('\n').slice(1); // skip "Job Activity" line itself
  const entries: JobActivityEntry[] = [];
  const rowRe = /^(\d{1,2}\/\d{1,2}\/\d{2},\s+\d{1,2}:\d{2}\s*[ap]m)\s{2,}(.+?)\s{2,}(.+)$/;
  for (const rawLine of block) {
    const line = rawLine.trimEnd();
    if (!line.trim()) { if (entries.length > 0) continue; else continue; }
    const m = line.match(rowRe);
    if (m) {
      entries.push({ when: m[1].trim(), action: m[2].trim(), detail: m[3].trim() });
      continue;
    }
    // Non-matching line after we started collecting — likely end of block
    if (entries.length > 0 && !/^\s*\d/.test(line)) break;
  }
  return entries;
}
```

**Step 4: Run until green.**

**Step 5: Commit**

```bash
git add server/src/utils/serveIntakeHelpers.ts server/src/utils/__tests__/serveIntakeHelpers.test.ts
git commit -m "feat(serve-intake): parseJobActivity — timeline entries from Info Sheet"
```

---

## Task 6: Pure helper — `computeDiligenceSchedule`

**Files:** same.

**Step 1: Add failing test**

```typescript
import { computeDiligenceSchedule } from '../serveIntakeHelpers';

describe('computeDiligenceSchedule', () => {
  it('returns 3 attempts with the required weekend slot across a multi-day window', () => {
    // Intake Sun 4/19 @ 07:30, due Tue 4/21 — mirrors Gutierrez
    const now = new Date('2026-04-19T07:30:00-06:00');
    const due = new Date('2026-04-21T23:59:59-06:00');
    const plan = computeDiligenceSchedule(due, now);
    expect(plan).toHaveLength(3);
    expect(plan.map(p => p.window).sort()).toEqual(['6AM-9AM', '6PM-9PM', '9AM-6PM'].sort());
    // At least one attempt must fall on a weekend day (Sat=6 or Sun=0)
    expect(plan.some(p => { const d = p.date.getDay(); return d === 0 || d === 6; })).toBe(true);
  });

  it('fits all 3 attempts into a same-day window if that is all thats left', () => {
    const now = new Date('2026-04-19T07:00:00-06:00');
    const due = new Date('2026-04-19T21:00:00-06:00');
    const plan = computeDiligenceSchedule(due, now);
    expect(plan).toHaveLength(3);
  });
});
```

**Step 2: Fail.**

**Step 3: Implement**

```typescript
export interface ScheduledAttempt { date: Date; window: '6AM-9AM' | '9AM-6PM' | '6PM-9PM'; isWeekendSlot: boolean; }

export function computeDiligenceSchedule(due: Date, now: Date): ScheduledAttempt[] {
  const msPerDay = 86_400_000;
  const dueDay = new Date(Math.floor(due.getTime() / msPerDay) * msPerDay);
  const nowDay = new Date(Math.floor(now.getTime() / msPerDay) * msPerDay);
  const windows: Array<{ w: ScheduledAttempt['window']; hour: number }> = [
    { w: '6AM-9AM', hour: 8 },
    { w: '9AM-6PM', hour: 12 },
    { w: '6PM-9PM', hour: 19 },
  ];
  // Collect candidate days from today through due, stop at 3 days.
  const days: Date[] = [];
  for (let d = new Date(nowDay); d <= dueDay && days.length < 7; d = new Date(d.getTime() + msPerDay)) {
    days.push(new Date(d));
  }
  if (days.length === 0) days.push(new Date(nowDay));

  // Prefer weekend day for at least one slot
  const weekendDays = days.filter(d => d.getDay() === 0 || d.getDay() === 6);
  const weekdayDays = days.filter(d => d.getDay() !== 0 && d.getDay() !== 6);
  const pickOrder: Date[] = [
    ...(weekendDays.length ? [weekendDays[0]] : []),
    ...weekdayDays,
    ...weekendDays.slice(1),
  ];
  // If only 1 day in window, use it 3x.
  while (pickOrder.length < 3) pickOrder.push(pickOrder[pickOrder.length - 1] || days[0]);

  const plan: ScheduledAttempt[] = [];
  for (let i = 0; i < 3; i++) {
    const day = pickOrder[i];
    const w = windows[i];
    const date = new Date(day);
    date.setHours(w.hour, 30, 0, 0);
    plan.push({ date, window: w.w, isWeekendSlot: date.getDay() === 0 || date.getDay() === 6 });
  }
  return plan;
}
```

**Step 4: Run tests.**

**Step 5: Commit**

```bash
git add server/src/utils/serveIntakeHelpers.ts server/src/utils/__tests__/serveIntakeHelpers.test.ts
git commit -m "feat(serve-intake): computeDiligenceSchedule — 3-attempt plan w/ weekend slot"
```

---

## Task 7: Pure helper — `deriveServiceType` + `primaryDocToken` + `classifyEntityType`

**Files:** same.

**Step 1: Test**

```typescript
import { deriveServiceType, primaryDocToken, classifyEntityType } from '../serveIntakeHelpers';

describe('deriveServiceType', () => {
  it('maps SUMMONS → SUMMONS SERVICE', () => { expect(deriveServiceType('SUMMONS')).toBe('SUMMONS SERVICE'); });
  it('maps SUBPOENA', () => { expect(deriveServiceType('SUBPOENA')).toBe('SUBPOENA SERVICE'); });
  it('maps UNLAWFUL DETAINER → EVICTION SERVICE', () => { expect(deriveServiceType('UNLAWFUL DETAINER')).toBe('EVICTION SERVICE'); });
  it('defaults to PROCESS SERVICE', () => { expect(deriveServiceType('RANDOM')).toBe('PROCESS SERVICE'); });
});

describe('primaryDocToken', () => {
  it('takes the first meaningful token of a semi-colon-separated docs list', () => {
    expect(primaryDocToken('Summons and Complaint; Bilingual Notice')).toBe('SUMMONS');
  });
  it('strips " and " joiners', () => {
    expect(primaryDocToken('Summons and Complaint')).toBe('SUMMONS');
  });
});

describe('classifyEntityType', () => {
  it('individuals', () => { expect(classifyEntityType('Abbey Armstrong')).toBe('individual'); });
  it('orgs by suffix', () => {
    for (const org of ['Capital One, N.A.', 'Acme LLC', 'Foo Inc.', 'Discover Bank', 'GUGLIELMO & ASSOCIATES']) {
      expect(classifyEntityType(org)).toBe('organization');
    }
  });
});
```

**Step 2: Fail.**

**Step 3: Implement**

```typescript
export function primaryDocToken(docs: string): string {
  if (!docs) return '';
  // Take first clause before ';', drop " and " joiners, take first word
  const first = docs.split(';')[0].replace(/\s+and\s+.+$/i, '').trim();
  const tok = first.split(/\s+/)[0] || '';
  return tok.toUpperCase();
}

export function deriveServiceType(primaryDoc: string): string {
  const d = (primaryDoc || '').toUpperCase();
  if (/SUMMONS/.test(d)) return 'SUMMONS SERVICE';
  if (/SUBPOENA/.test(d)) return 'SUBPOENA SERVICE';
  if (/EVICTION|UNLAWFUL\s+DETAINER/.test(d)) return 'EVICTION SERVICE';
  if (/RESTRAINING|PROTECTIVE/.test(d)) return 'RESTRAINING ORDER SERVICE';
  if (/CITATION/.test(d)) return 'CITATION SERVICE';
  return 'PROCESS SERVICE';
}

export function classifyEntityType(name: string): 'individual' | 'organization' {
  if (/\b(LLC|L\.L\.C\.|INC\.?|CORP\.?|CORPORATION|N\.A\.|BANK|ASSOCIATES|PARTNERS|LP|L\.P\.|PLC|TRUST|COMPANY|CO\.?)\b/i.test(name)) return 'organization';
  if (/&/.test(name)) return 'organization';
  return 'individual';
}
```

**Step 4: Green.**

**Step 5: Commit**

```bash
git add server/src/utils/serveIntakeHelpers.ts server/src/utils/__tests__/serveIntakeHelpers.test.ts
git commit -m "feat(serve-intake): service-type + primary-doc + entity-type classifiers"
```

---

## Task 8: Pure helper — `buildNotesNarrative`

**Files:** same.

Produces the 8-entry JSON array that goes into `calls_for_service.notes`.

**Step 1: Test**

```typescript
import { buildNotesNarrative, NotesInput } from '../serveIntakeHelpers';

describe('buildNotesNarrative', () => {
  const input: NotesInput = {
    plaintiff: 'Capital One, N.A., successor by merger to Discover Bank',
    orderingClientRule: 'Sub-serve on 1st attempt to any occupant 16+.',
    clientJobNumber: '633570',
    documents: 'Summons and Complaint; Bilingual Notice',
    documentPages: 11,
    bilingual: true,
    signedDate: 'March 25, 2026',
    responseDeadlineDays: 21,
    court: 'THIRD JUDICIAL DISTRICT COURT',
    courtAddress: '450 SOUTH STATE ST, P.O. BOX 1860, SALT LAKE CITY UT 84114',
    clerkPhone: '(801) 238-7300',
    attorney: { name: 'Heather Valerga', firm: 'GUGLIELMO & ASSOCIATES', barNumber: '14431', addressLine1: 'PO Box 41688', addressLine2: 'Tucson, AZ 85717', tel: '(877)325-5700', fax: '', email: 'Utah@guglielmolaw.com' },
    serviceRulesSummary: 'SUB-SERVE OK TO OCCUPANT 16+. PERSONAL SERVICE ONLY AT PLACE OF EMPLOYMENT. …',
    serviceWindows: '6AM-9AM, 9AM-6PM, 6PM-9PM, WEEKEND REQUIRED',
    dueDate: '04/21/2026',
    daysRemaining: 2,
    recommendedAttempts: [
      { label: 'SUN, APR 19, 8:30 AM (6AM-9AM)', weekend: true },
      { label: 'MON, APR 20, 12:00 PM (9AM-6PM)', weekend: false },
      { label: 'TUE, APR 21, 7:30 PM (6PM-9PM)', weekend: false },
    ],
    jobActivity: [
      { when: '4/13/26, 2:10 PM', action: 'Process server assigned', detail: 'Christopher Zamora was assigned to the job' },
    ],
    instructionsVerbatim: 'Sub-serve on 1st attempt to any occupant 16+. …',
    timestamp: '2026-04-19 07:30:12',
  };

  it('produces 8 entries in the documented order', () => {
    const notes = buildNotesNarrative(input);
    expect(notes).toHaveLength(8);
    expect(notes[0].text).toMatch(/^CASE --/);
    expect(notes[1].text).toMatch(/^COURT --/);
    expect(notes[2].text).toMatch(/^ATTORNEY --/);
    expect(notes[3].text).toMatch(/^SERVICE RULES --/);
    expect(notes[4].text).toMatch(/^SCHEDULE --/);
    expect(notes[5].text).toMatch(/^RECOMMENDED SCHEDULE --/);
    expect(notes[6].text).toMatch(/^CLIENT HISTORY --/);
    expect(notes[7].text).toMatch(/^INSTRUCTIONS \(VERBATIM\) --/);
  });

  it('CASE line contains pipe-delimited plaintiff/client/case#/documents/signed/deadline', () => {
    const notes = buildNotesNarrative(input);
    const caseText = notes[0].text;
    expect(caseText).toContain('PLAINTIFF: CAPITAL ONE');
    expect(caseText).toContain('CASE #633570');
    expect(caseText).toContain('2 DOCS');
    expect(caseText).toContain('11 PAGES');
    expect(caseText).toContain('BILINGUAL');
    expect(caseText).toContain('SIGNED/FILED: MARCH 25, 2026');
    expect(caseText).toContain('RESPONSE DEADLINE: 21 DAYS AFTER SERVICE');
  });

  it('ATTORNEY line uses Firm parenthetical + BAR#', () => {
    const notes = buildNotesNarrative(input);
    expect(notes[2].text).toContain('HEATHER VALERGA (GUGLIELMO & ASSOCIATES) BAR#14431');
    expect(notes[2].text).toContain('PO BOX 41688, TUCSON, AZ 85717');
    expect(notes[2].text).toContain('TEL: (877)325-5700');
    expect(notes[2].text).toContain('EMAIL: UTAH@GUGLIELMOLAW.COM');
  });
});
```

**Step 2: Fail.**

**Step 3: Implement**

```typescript
export interface NotesInput {
  plaintiff: string;
  orderingClientRule: string;
  clientJobNumber: string;
  documents: string;
  documentPages: number;
  bilingual: boolean;
  signedDate: string;
  responseDeadlineDays: number;
  court: string;
  courtAddress: string;
  clerkPhone: string;
  attorney: AttorneyBlock;
  serviceRulesSummary: string;
  serviceWindows: string;
  dueDate: string;
  daysRemaining: number;
  recommendedAttempts: Array<{ label: string; weekend: boolean }>;
  jobActivity: JobActivityEntry[];
  instructionsVerbatim: string;
  timestamp: string;
}

export interface NoteEntry { id: string; author: string; text: string; timestamp: string; }

export function buildNotesNarrative(i: NotesInput): NoteEntry[] {
  const upper = (s: string) => (s || '').toUpperCase();
  const author = 'Serve Intake';
  const ts = i.timestamp;

  const docCount = i.documents ? i.documents.split(/[;,]|\band\b/i).map(s => s.trim()).filter(Boolean).length : 0;
  const docList = i.documents.split(/[;,]|\band\b/i).map(s => s.trim()).filter(Boolean).join(' + ').toUpperCase();

  const caseLine = [
    `PLAINTIFF: ${upper(i.plaintiff)}`,
    i.orderingClientRule ? `ORDERING CLIENT: ${upper(i.orderingClientRule)}` : null,
    i.clientJobNumber ? `CASE #${i.clientJobNumber}` : null,
    docCount ? `DOCUMENTS: ${docCount} DOCS (${docList})${i.documentPages ? `, ${i.documentPages} PAGES` : ''}${i.bilingual ? ', BILINGUAL' : ''}` : null,
    i.signedDate ? `SIGNED/FILED: ${upper(i.signedDate)}` : null,
    i.responseDeadlineDays ? `RESPONSE DEADLINE: ${i.responseDeadlineDays} DAYS AFTER SERVICE` : null,
  ].filter(Boolean).join(' | ');

  const courtLine = [
    upper(i.court),
    i.courtAddress ? `ADDRESS: ${upper(i.courtAddress)}` : null,
    i.clerkPhone ? `CLERK: ${i.clerkPhone}` : null,
  ].filter(Boolean).join(' | ');

  const attyLine = [
    i.attorney.name ? `${upper(i.attorney.name)}${i.attorney.firm ? ` (${upper(i.attorney.firm)})` : ''}${i.attorney.barNumber ? ` BAR#${i.attorney.barNumber}` : ''}` : null,
    [i.attorney.addressLine1, i.attorney.addressLine2].filter(Boolean).join(', ').toUpperCase() || null,
    i.attorney.tel ? `TEL: ${i.attorney.tel}` : null,
    i.attorney.email ? `EMAIL: ${i.attorney.email.toUpperCase()}` : null,
  ].filter(Boolean).join(' | ');

  const scheduleLine = [
    `WINDOWS: ${upper(i.serviceWindows)}`,
    i.dueDate ? `DUE: ${i.dueDate} (${i.daysRemaining}D REMAINING)` : null,
  ].filter(Boolean).join(' | ');

  const recSchedLines = ['DILIGENCE-COMPLIANT ATTEMPT PLAN:', ...i.recommendedAttempts.map((a, idx) =>
    ` ATTEMPT ${idx + 1} -- ${upper(a.label)}${a.weekend ? ' -- WEEKEND SLOT' : ''}`
  )].join('\n');

  const historyLines = i.jobActivity.length
    ? ['IMPORTED FROM JOB ACTIVITY LOG:', ...i.jobActivity.map(e => ` ${upper(e.when)} -- ${upper(e.action)}: ${upper(e.detail)}`)].join('\n')
    : 'NO ACTIVITY LOG FOUND';

  return [
    { id: `${Date.now()}-1`, author, text: `CASE -- ${caseLine}`, timestamp: ts },
    { id: `${Date.now()}-2`, author, text: `COURT -- ${courtLine}`, timestamp: ts },
    { id: `${Date.now()}-3`, author, text: `ATTORNEY -- ${attyLine}`, timestamp: ts },
    { id: `${Date.now()}-4`, author, text: `SERVICE RULES -- ${upper(i.serviceRulesSummary)}`, timestamp: ts },
    { id: `${Date.now()}-5`, author, text: `SCHEDULE -- ${scheduleLine}`, timestamp: ts },
    { id: `${Date.now()}-6`, author, text: `RECOMMENDED SCHEDULE -- ${recSchedLines}`, timestamp: ts },
    { id: `${Date.now()}-7`, author, text: `CLIENT HISTORY -- ${historyLines}`, timestamp: ts },
    { id: `${Date.now()}-8`, author, text: `INSTRUCTIONS (VERBATIM) -- ${i.instructionsVerbatim}`, timestamp: ts },
  ];
}
```

**Step 4: Green.**

**Step 5: Commit**

```bash
git add server/src/utils/serveIntakeHelpers.ts server/src/utils/__tests__/serveIntakeHelpers.test.ts
git commit -m "feat(serve-intake): buildNotesNarrative — 8-entry pipe-delimited structure"
```

---

## Task 9: End-to-end parser integration test against Armstrong golden fixtures

**Files:**
- Create: `server/src/routes/__tests__/serveIntake.parse.test.ts`
- Modify: `server/src/utils/serveIntakeHelpers.ts` (add `parseAllDocuments` composite)

**Step 1: Add failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseAllDocuments } from '../../utils/serveIntakeHelpers';

const f = (n: string) => readFileSync(join(__dirname, 'fixtures/serveIntake', n), 'utf-8');

describe('parseAllDocuments — Armstrong case', () => {
  const out = parseAllDocuments({
    fieldSheet: f('armstrong.fieldSheet.txt'),
    infoSheet: f('armstrong.infoSheet.txt'),
    courtDocket: f('armstrong.courtDocket.txt'),
  });

  it('extracts defendant identity', () => {
    expect(out.defendant.first).toBe('Abbey');
    expect(out.defendant.last).toBe('Armstrong');
    expect(out.defendant.dob).toBe('1997-10-13');
  });

  it('extracts service address with parts', () => {
    expect(out.address).toMatch(/2361 E 3395 S.*SALT LAKE CITY.*UT 84109/i);
    expect(out.addressParts.building).toBe('2361');
  });

  it('extracts plaintiff from info sheet', () => {
    expect(out.plaintiff).toMatch(/Capital One, N\.A\., successor by merger to Discover Bank/);
  });

  it('extracts attorney Heather Valerga + Bar# 14431 from docket', () => {
    expect(out.attorney.name).toBe('Heather Valerga');
    expect(out.attorney.barNumber).toBe('14431');
    expect(out.attorney.firm).toBe('GUGLIELMO & ASSOCIATES');
    expect(out.attorney.email.toLowerCase()).toBe('utah@guglielmolaw.com');
  });

  it('extracts documents list + primary doc + service type', () => {
    expect(out.documents).toMatch(/Summons and Complaint; Bilingual Notice/);
    expect(out.primaryDoc).toBe('SUMMONS');
    expect(out.serviceType).toBe('SUMMONS SERVICE');
  });

  it('extracts job numbers (ICU 15570133 + client 633570)', () => {
    expect(out.jobNumber).toBe('15570133');
    expect(out.clientJobNumber).toBe('633570');
  });

  it('extracts court metadata from info sheet', () => {
    expect(out.court).toMatch(/THIRD JUDICIAL DISTRICT COURT/);
    expect(out.courtAddress).toMatch(/450 S STATE ST/i);
    expect(out.county.toUpperCase()).toBe('SALT LAKE');
  });

  it('extracts signed date + response deadline from docket URCP 4 boilerplate', () => {
    expect(out.signedDate).toBe('March 25, 2026');
    expect(out.responseDeadlineDays).toBe(21);
  });

  it('extracts clerk phone', () => {
    expect(out.clerkPhone).toBe('(801) 238-7300');
  });
});
```

**Step 2: Fail — `parseAllDocuments` not defined.**

**Step 3: Implement the composite**

Append to `serveIntakeHelpers.ts`. This is the orchestration layer that replaces the ad-hoc extractors in the current `intake` route:

```typescript
export interface ParseInput { fieldSheet: string; infoSheet: string; courtDocket: string; }
export interface ParseOutput {
  defendant: { first: string; middle: string; last: string; dob: string };
  address: string;
  addressParts: AddressParts;
  plaintiff: string;
  court: string;
  courtAddress: string;
  county: string;
  attorney: AttorneyBlock;
  documents: string;
  primaryDoc: string;
  serviceType: string;
  instructions: string;
  jobNumber: string;      // ICU internal job number
  clientJobNumber: string; // Client's case/job number
  dueDate: string;
  signedDate: string;
  responseDeadlineDays: number;
  clerkPhone: string;
  documentPages: number;
  bilingual: boolean;
  orderingClientRule: string;
  serviceWindows: string;
  serviceRulesSummary: string;
  jobActivity: JobActivityEntry[];
  courtCaseNumber: string;
  vendorFingerprint: string;
}

export function parseAllDocuments(src: ParseInput): ParseOutput {
  const { fieldSheet, infoSheet, courtDocket } = src;
  const allText = [fieldSheet, infoSheet, courtDocket].filter(Boolean).join('\n\n');

  const info = parseInfoSheetLabels(infoSheet);
  const attorney = extractAttorneyBlock(courtDocket);

  // Defendant from Field Sheet "Party to Serve:"
  const ptsMatch = fieldSheet.match(/Party to Serve[:\s]+([^\n]+)/i) || infoSheet.match(/Recipient[:\s]+([^\n]+)/i);
  const rawPartyName = (ptsMatch?.[1] || info.defendant || '').replace(/,\s*an\s+individual.*$/i, '').trim();
  const parts = rawPartyName.split(/\s+/);
  const defendant = {
    first: parts[0] || '',
    middle: parts.length >= 3 ? parts.slice(1, -1).join(' ') : '',
    last: parts[parts.length - 1] || '',
    dob: (fieldSheet.match(/DOB[:\s]*(\d{1,2}\/\d{1,2}\/\d{4})/i) || infoSheet.match(/DOB[:\s]*(\d{1,2}\/\d{1,2}\/\d{4})/i) || [])?.[1]?.split('/').reverse().map((p, i) => i === 0 ? p : p.padStart(2, '0')).reverse().join('-') || '',
  };
  // Re-normalize dob to YYYY-MM-DD
  if (defendant.dob && defendant.dob.includes('/')) {
    const [m, d, y] = defendant.dob.split('/');
    defendant.dob = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // Address from Field Sheet block
  const addrMatch = fieldSheet.match(/^Address\s*\n\s*(.+(?:,\s*[A-Z]{2}\s*\d{5}).*)$/im)
    || fieldSheet.match(/(\d+\s+[A-Za-z].*?,\s*[A-Za-z ]+,\s*[A-Z]{2}\s*\d{5}[-\d]*)/);
  const address = addrMatch ? addrMatch[1].trim() : '';
  const addressParts = parseAddressParts(address);

  // Plaintiff — info sheet first, then docket caption
  let plaintiff = info.plaintiff;
  if (!plaintiff) {
    const m = courtDocket.match(/([A-Z][^\n]{5,200}?),\s*\n\s*Plaintiff,/);
    if (m) plaintiff = m[1].replace(/\s+/g, ' ').trim();
  }

  // Court / clerk / court address
  const court = info.court || (courtDocket.match(/(THIRD|FIRST|SECOND|FOURTH|FIFTH|SIXTH|SEVENTH|EIGHTH)\s+JUDICIAL\s+DISTRICT\s+COURT[^,\n]*/i)?.[0].trim() || '');
  const courtAddress = info.courtAddress || (courtDocket.match(/(\d+\s+South\s+State\s+St[^,\n]*,\s*[^,\n]*\d{5}(?:-\d{4})?)/i)?.[1] || '');
  const clerkMatch = courtDocket.match(/call\s+the\s+clerk.*?at\s*\((\d{3})\)\s*(\d{3})[-.\s]?(\d{4})/i);
  const clerkPhone = clerkMatch ? `(${clerkMatch[1]}) ${clerkMatch[2]}-${clerkMatch[3]}` : '';

  // Documents
  const documents = (fieldSheet.match(/Documents[:\s]+([^\n]+)/i)?.[1] || '').trim();
  const primaryDoc = primaryDocToken(documents);
  const serviceType = deriveServiceType(primaryDoc);
  const bilingual = /bilingual/i.test(documents);
  const documentPages = parseInt((infoSheet.match(/(\d+)\s*pages/i)?.[1] || '0'), 10);

  // Instructions verbatim
  const instrMatch = fieldSheet.match(/Instructions\s*\n([\s\S]*?)(?:\n\s*\n\s*Address|\n\s*\n\s*\n|$)/i);
  const instructions = instrMatch ? instrMatch[1].replace(/\n/g, ' ').replace(/\s+/g, ' ').trim() : '';
  // Ordering client rule = first sentence of instructions
  const orderingClientRule = instructions.split('.')[0].trim() + (instructions ? '.' : '');

  // Job numbers
  const jobMatch = fieldSheet.match(/Job[:\s]+(\d+)\s*\((\d+)\)/i) || fieldSheet.match(/(\d{7,})\s*\((\d{5,})\)/);
  const jobNumber = jobMatch?.[1] || '';
  const clientJobNumber = jobMatch?.[2] || (courtDocket.match(/\*S\d+(\d{6})\*/)?.[1] || '');

  const dueDate = (fieldSheet.match(/Due[:\s]*(\d{1,2}\/\d{1,2}\/\d{4})/i)?.[1] || '');

  // Signed date + response deadline from docket
  const signedDate = (courtDocket.match(/DATED\s+([A-Z][a-z]+\s+\d{1,2},\s*\d{4})/)?.[1] || '').replace(/,\s*$/, '');
  const responseDeadlineDays = parseInt((courtDocket.match(/[Ww]ithin\s+(\d+)\s+days\s+after\s+service/)?.[1] || '21'), 10);

  // Service windows
  const windows: string[] = [];
  if (/6AM-9AM|6am.*9am/i.test(allText)) windows.push('6AM-9AM');
  if (/9AM-6PM|9am.*6pm/i.test(allText)) windows.push('9AM-6PM');
  if (/6PM-9PM|6pm.*9pm/i.test(allText)) windows.push('6PM-9PM');
  if (/weekend/i.test(allText)) windows.push('WEEKEND REQUIRED');
  const serviceWindows = windows.join(', ');

  const serviceRulesSummary = summarizeRules(instructions);
  const jobActivity = parseJobActivity(infoSheet);
  const courtCaseNumber = (courtDocket.match(/Civil\s+No\.\s*([A-Z0-9-]+)/i)?.[1] || '').trim();
  const vendorFingerprint = info.createdBy || (fieldSheet.match(/(ICU\s+Investigations[^,\n]*)/i)?.[1] || '');

  return {
    defendant, address, addressParts, plaintiff, court, courtAddress, county: info.county,
    attorney, documents, primaryDoc, serviceType, instructions,
    jobNumber, clientJobNumber, dueDate, signedDate, responseDeadlineDays, clerkPhone,
    documentPages, bilingual, orderingClientRule, serviceWindows, serviceRulesSummary,
    jobActivity, courtCaseNumber, vendorFingerprint,
  };
}

function summarizeRules(instructions: string): string {
  // Normalize the common ICU rule set into a concise summary.
  const bits: string[] = [];
  if (/sub-?serve.*?occupant\s*16\+/i.test(instructions)) bits.push('SUB-SERVE OK TO OCCUPANT 16+');
  if (/personal.*?place\s+of\s+employment|personal.*?POE/i.test(instructions)) bits.push('PERSONAL SERVICE ONLY AT PLACE OF EMPLOYMENT');
  if (/call.*?phone|call.*?status/i.test(instructions)) bits.push('CALL CLIENT WITH STATUS AFTER EACH ATTEMPT');
  if (/hospitals?.*?churches?.*?jails?/i.test(instructions)) bits.push('NEVER SERVE AT: HOSPITALS, CHURCHES, JAILS');
  if (/BK\s*case\s*#/i.test(instructions)) bits.push('IF SUBJECT PRESENTS A BK CASE # -> STOP, DO NOT SERVE');
  return bits.join('. ') + (bits.length ? '.' : '');
}
```

**Step 4: Run tests; iterate on failures.** Expected: 9 passing Armstrong assertions.

If specific assertions fail, fix the helper regex rather than weakening the test. Common fixes:
- Date of birth parsing: ensure `MM/DD/YYYY` → `YYYY-MM-DD` path runs.
- Plaintiff: if docket caption pattern fails, dump `courtDocket.slice(0, 2000)` and adjust the regex to match the actual whitespace pattern.

**Step 5: Commit**

```bash
git add server/src/utils/serveIntakeHelpers.ts server/src/routes/__tests__/serveIntake.parse.test.ts
git commit -m "feat(serve-intake): parseAllDocuments composite + Armstrong golden fixture test"
```

---

## Task 10: Refactor `/intake` route — vendor fingerprint + full fanout

**Files:**
- Modify: `server/src/routes/serveIntake.ts` (significant rewrite — replace lines ~26-176 and lines ~224-568)

**Step 1: Replace the extraction block (lines 26-176) with calls to the new helpers**

Delete the old `detectDocType`, `extractField`, `extractBetween`, `extractName`, `extractDOB`, `extractAddress`, `extractPlaintiff`, `extractCourt`, `extractDocuments`, `extractInstructions`, `extractJobNumber`, `extractCaseNumber`, `extractDueDate`, `extractAttorney`, `extractFee`, `extractServiceWindows`, `extractServeInstructions`, `extractCaseNotes`, `extractClientAddress` functions. Keep `detectDocType` but simplify it (or drop — the client already classifies).

Replace with a single import block near the top:

```typescript
import { parseAllDocuments, parseAddressParts, computeDiligenceSchedule, classifyEntityType, buildNotesNarrative, primaryDocToken, deriveServiceType } from '../utils/serveIntakeHelpers';
```

**Step 2: Rewrite the `/intake` route body (replace lines 224-568)**

The new route structure:

```typescript
router.post('/intake', requireRole('admin', 'manager', 'supervisor', 'dispatcher', 'officer'), async (req: Request, res: Response) => {
  const log = (req as any).log || { info: console.log, warn: console.warn, error: console.error };
  try {
    const db = getDb();
    const userId = req.user!.userId;
    const now = localNow();

    const { documents } = req.body;
    if (!documents || !Array.isArray(documents) || documents.length === 0) {
      res.status(400).json({ error: 'documents array required' });
      return;
    }

    // Auto-detect document types by content
    let fieldSheet = '', infoSheet = '', courtDocket = '';
    for (const d of documents) {
      const txt = d.text || '';
      if (/Party to Serve|Date & Time.*Description of Service/i.test(txt)) fieldSheet = fieldSheet || txt;
      else if (/^JOB\b|Service Attempts|Job Activity/im.test(txt)) infoSheet = infoSheet || txt;
      else if (/SUMMONS|COMPLAINT|JUDICIAL DISTRICT COURT|Attorney for Plaintiff/i.test(txt)) courtDocket = courtDocket || txt;
      else { if (!fieldSheet) fieldSheet = txt; else if (!infoSheet) infoSheet = txt; else courtDocket = txt; }
    }

    const parsed = parseAllDocuments({ fieldSheet, infoSheet, courtDocket });
    if (!parsed.defendant.last) { res.status(400).json({ error: 'Could not extract defendant name' }); return; }

    // ── 1. Vendor lookup (caller) ─────────────────────────
    let vendor: any = db.prepare(`SELECT id, name, billing_code, requestor_email, caller_phone FROM clients WHERE vendor_fingerprint = ? OR name = ? LIMIT 1`).get(parsed.vendorFingerprint, parsed.vendorFingerprint) as any;
    if (!vendor) { vendor = db.prepare(`SELECT id, name, billing_code, requestor_email, caller_phone FROM clients ORDER BY id LIMIT 1`).get() as any; }
    const vendorName = (vendor?.name || 'ICU INVESTIGATIONS, LLC.').toUpperCase();
    const vendorPhone = vendor?.caller_phone || '(435) 986-1200';
    const billingCode = vendor?.billing_code || '';
    const requestorEmail = vendor?.requestor_email || '';

    // ── 2. Defendant person ───────────────────────────────
    const defName = parsed.defendant;
    const fullName = `${defName.first}${defName.middle ? ' ' + defName.middle : ''} ${defName.last}`.trim();
    let defendantId: number;
    const existingDef = db.prepare('SELECT id FROM persons WHERE LOWER(first_name)=LOWER(?) AND LOWER(last_name)=LOWER(?) AND (dob = ? OR dob IS NULL OR dob = "") LIMIT 1').get(defName.first, defName.last, defName.dob) as any;
    if (existingDef) {
      defendantId = existingDef.id;
      if (defName.dob) db.prepare('UPDATE persons SET dob=COALESCE(NULLIF(dob,""), ?), role_tag=COALESCE(role_tag, "defendant"), entity_type=COALESCE(entity_type, "individual"), updated_at=? WHERE id=?').run(defName.dob, now, defendantId);
    } else {
      defendantId = db.prepare('INSERT INTO persons (first_name, middle_name, last_name, dob, address, role_tag, entity_type, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run(
        defName.first, defName.middle, defName.last, defName.dob || null, parsed.address || null, 'defendant', 'individual', now, now,
      ).lastInsertRowid as number;
    }

    // ── 3. Plaintiff person (organization) ────────────────
    let plaintiffId: number | null = null;
    if (parsed.plaintiff) {
      const entityType = classifyEntityType(parsed.plaintiff);
      const existing = db.prepare('SELECT id FROM persons WHERE last_name = ? AND entity_type = ? LIMIT 1').get(parsed.plaintiff, entityType) as any;
      if (existing) plaintiffId = existing.id;
      else {
        plaintiffId = db.prepare('INSERT INTO persons (first_name, last_name, role_tag, entity_type, created_at, updated_at) VALUES (?,?,?,?,?,?)').run(
          '', parsed.plaintiff, 'plaintiff', entityType, now, now,
        ).lastInsertRowid as number;
      }
    }

    // ── 4. Attorney person ────────────────────────────────
    let attorneyId: number | null = null;
    if (parsed.attorney.name) {
      const [afirst, ...arest] = parsed.attorney.name.split(/\s+/);
      const alast = arest.pop() || '';
      const amiddle = arest.join(' ');
      const existing = db.prepare('SELECT id FROM persons WHERE LOWER(first_name)=LOWER(?) AND LOWER(last_name)=LOWER(?) AND bar_number = ? LIMIT 1').get(afirst, alast, parsed.attorney.barNumber) as any;
      if (existing) attorneyId = existing.id;
      else {
        attorneyId = db.prepare('INSERT INTO persons (first_name, middle_name, last_name, bar_number, firm_name, role_tag, entity_type, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run(
          afirst, amiddle, alast, parsed.attorney.barNumber || null, parsed.attorney.firm || null, 'attorney', 'individual', now, now,
        ).lastInsertRowid as number;
      }
    }

    // ── 5. Property ───────────────────────────────────────
    let propertyId: number | null = null;
    let latitude: number | null = null, longitude: number | null = null;
    if (parsed.address) {
      if (!/geocode_skip/i.test(parsed.address)) {
        try {
          const geo = await geocodeAddress(parsed.address);
          if (geo) { latitude = geo.latitude; longitude = geo.longitude; }
          else log.warn({ address: parsed.address }, 'serve intake geocode returned no result');
        } catch (err) { log.warn({ err, address: parsed.address }, 'serve intake geocode threw'); }
      }
      const addr = parsed.addressParts;
      const propName = `${addr.street.toUpperCase()} -- ${defName.last.toUpperCase()} RESIDENCE`;
      const existing = db.prepare('SELECT id FROM properties WHERE address = ? LIMIT 1').get(parsed.address) as any;
      if (existing) {
        propertyId = existing.id;
        if (latitude && longitude) db.prepare('UPDATE properties SET latitude=?, longitude=? WHERE id=? AND (latitude IS NULL OR latitude=0)').run(latitude, longitude, propertyId);
      } else {
        propertyId = db.prepare('INSERT INTO properties (client_id, name, address, latitude, longitude, property_type, created_at) VALUES (?,?,?,?,?,?,?)').run(
          vendor?.id || 1, propName, parsed.address, latitude, longitude, 'residential', now,
        ).lastInsertRowid as number;
      }
      try { db.prepare('INSERT OR IGNORE INTO record_links (source_type, source_id, target_type, target_id, relationship, created_by) VALUES (?,?,?,?,?,?)').run('person', defendantId, 'property', propertyId, 'resident', userId); } catch { /* already linked */ }
    }

    // ── 6. Section/Zone/Beat ──────────────────────────────
    let sectorId = '', zoneId = '', beatId = '', zoneBeat = '', dispatchCode = '';
    if (latitude && longitude) {
      try {
        const beat = identifyBeat(latitude, longitude);
        if (beat) {
          const row = db.prepare(`SELECT db2.beat_code, dz.zone_code, ds.sector_code FROM dispatch_beats db2 JOIN dispatch_zones dz ON dz.id=db2.zone_id JOIN dispatch_sectors ds ON ds.id=dz.sector_id WHERE db2.beat_code = ? LIMIT 1`).get(beat.beat_code) as any;
          if (row) { sectorId = row.sector_code || ''; zoneId = row.zone_code || ''; beatId = row.beat_code || ''; dispatchCode = `${sectorId}-${zoneId}/${beatId}`; }
        } else log.warn({ latitude, longitude }, 'serve intake identifyBeat returned null');
      } catch (err) { log.warn({ err, latitude, longitude }, 'serve intake identifyBeat threw'); }
    }

    // ── 7. Weather / Lighting ─────────────────────────────
    let weather = '', lighting = '';
    if (latitude && longitude) {
      try {
        const wxUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code,relative_humidity_2m,wind_speed_10m&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=America/Denver`;
        const r = await fetch(wxUrl);
        if (r.ok) {
          const wx = await r.json();
          const codes: Record<number, string> = { 0:'CLEAR',1:'MAINLY CLEAR',2:'PARTLY CLOUDY',3:'OVERCAST',45:'FOGGY',51:'LIGHT DRIZZLE',61:'RAIN',71:'SNOW',80:'RAIN SHOWERS',95:'THUNDERSTORM' };
          weather = codes[wx.current?.weather_code] || 'CLEAR';
        } else log.warn({ status: r.status }, 'serve intake weather fetch non-OK');
      } catch (err) { log.warn({ err }, 'serve intake weather fetch threw'); }
      const h = new Date().getHours();
      lighting = h >= 6 && h < 8 ? 'DAWN' : h >= 8 && h < 17 ? 'DAYLIGHT' : h >= 17 && h < 19 ? 'DUSK' : 'DARK';
    }

    // ── 8. Case (civil) ───────────────────────────────────
    const caseTitle = `${(parsed.plaintiff.split(/[\s,]/)[0] || 'Plaintiff').replace(/[^A-Za-z]/g, '')} v. ${defName.last}`;
    const responseDue = parsed.signedDate ? new Date(parsed.signedDate) : new Date(now);
    responseDue.setDate(responseDue.getDate() + (parsed.responseDeadlineDays || 21));
    const caseNumber = parsed.clientJobNumber || parsed.jobNumber || `CIVIL-${Date.now()}`;
    const linkedPersons = JSON.stringify([defendantId, plaintiffId, attorneyId].filter(Boolean));
    let caseId: number;
    const existingCase = db.prepare('SELECT id FROM cases WHERE case_number = ? LIMIT 1').get(caseNumber) as any;
    if (existingCase) caseId = existingCase.id;
    else {
      caseId = db.prepare(`INSERT INTO cases (case_number, title, case_type, status, summary, narrative, linked_persons, court_case_number, plaintiff_person_id, defendant_person_id, attorney_person_id, signed_filed_date, response_deadline_days, cause_of_action, due_date, created_by, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        caseNumber, caseTitle, 'civil_process', 'active',
        parsed.plaintiff ? `${parsed.plaintiff} v. ${fullName}` : caseTitle,
        parsed.instructions.slice(0, 500) || null,
        linkedPersons, parsed.courtCaseNumber || null,
        plaintiffId, defendantId, attorneyId,
        parsed.signedDate || null, parsed.responseDeadlineDays || 21, parsed.serviceType || null,
        responseDue.toISOString().slice(0, 10), userId, now, now,
      ).lastInsertRowid as number;
    }

    // ── 9. CFS call ───────────────────────────────────────
    const year = new Date().getFullYear().toString().slice(-2);
    const lastCall = db.prepare("SELECT call_number FROM calls_for_service WHERE call_number LIKE ? ORDER BY id DESC LIMIT 1").get(`${year}-CFS%`) as any;
    let seq = 1;
    if (lastCall) { const m = lastCall.call_number.match(/CFS(\d+)/); if (m) seq = parseInt(m[1], 10) + 1; }
    const callNumber = `${year}-CFS${String(seq).padStart(5, '0')}`;

    const schedule = computeDiligenceSchedule(
      parsed.dueDate ? new Date(parsed.dueDate.split('/').reverse().join('-').replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$1-$3-$2')) : new Date(Date.now() + 2 * 86400000),
      new Date(),
    );
    const fmtDay = (d: Date) => d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase();
    const fmtTime = (d: Date) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    const recommendedAttempts = schedule.map(s => ({ label: `${fmtDay(s.date)}, ${fmtTime(s.date)} (${s.window})`, weekend: s.isWeekendSlot }));

    const daysRemaining = parsed.dueDate ? Math.max(1, Math.ceil((new Date(parsed.dueDate).getTime() - Date.now()) / 86400000)) : 0;
    const notesArr = buildNotesNarrative({
      plaintiff: parsed.plaintiff,
      orderingClientRule: parsed.orderingClientRule,
      clientJobNumber: parsed.clientJobNumber,
      documents: parsed.documents,
      documentPages: parsed.documentPages,
      bilingual: parsed.bilingual,
      signedDate: parsed.signedDate,
      responseDeadlineDays: parsed.responseDeadlineDays,
      court: parsed.court,
      courtAddress: parsed.courtAddress,
      clerkPhone: parsed.clerkPhone,
      attorney: parsed.attorney,
      serviceRulesSummary: parsed.serviceRulesSummary,
      serviceWindows: parsed.serviceWindows,
      dueDate: parsed.dueDate,
      daysRemaining,
      recommendedAttempts,
      jobActivity: parsed.jobActivity,
      instructionsVerbatim: parsed.instructions,
      timestamp: now,
    });

    const description = [
      `SERVE ${(parsed.documents || parsed.primaryDoc).toUpperCase()} TO ${fullName.toUpperCase()}`,
      `AT ${parsed.address.toUpperCase()}`,
      parsed.clientJobNumber ? `CASE #${parsed.clientJobNumber} -- ${parsed.court.toUpperCase()}` : null,
      parsed.dueDate ? `DUE: ${parsed.dueDate} (${daysRemaining}D)` : null,
    ].filter(Boolean).join('\n');

    const callId = db.prepare(`INSERT INTO calls_for_service (
      call_number, case_number, incident_type, priority, status,
      caller_name, caller_phone, caller_relationship,
      location_address, property_id, latitude, longitude,
      weather_conditions, lighting_conditions,
      sector_id, zone_id, beat_id, zone_beat, dispatch_code,
      description, notes, source, dispatcher_id,
      subject_description,
      pso_requestor_name, pso_requestor_phone, pso_requestor_email,
      pso_service_type, pso_billing_code, pso_authorization, pso_service_windows,
      process_service_type, process_served_to, process_served_address, process_attempts,
      client_id, contract_id, secondary_type, contact_method,
      created_at, updated_at
    ) VALUES (?,?,?,?,?, ?,?,?, ?,?,?,?, ?,?, ?,?,?,?,?, ?,?,?,?, ?, ?,?,?, ?,?,?,?, ?,?,?,?, ?,?,?,?, ?,?)`).run(
      callNumber, parsed.clientJobNumber || null, 'pso_client_request', 'P4', 'pending',
      vendorName, vendorPhone, 'client',
      parsed.address || 'UNKNOWN', propertyId, latitude, longitude,
      weather || null, lighting || null,
      sectorId || null, zoneId || null, beatId || null, null, dispatchCode || null,
      description, JSON.stringify(notesArr), 'intake', userId,
      `${fullName}, DOB ${defName.dob}`,
      vendorName, vendorPhone, requestorEmail,
      parsed.serviceType, billingCode, parsed.jobNumber || null, parsed.serviceWindows || null,
      parsed.primaryDoc.toLowerCase() || 'summons', fullName, parsed.address || null, 0,
      vendor?.id || 1, parsed.jobNumber || null, parsed.primaryDoc, 'email',
      now, now,
    ).lastInsertRowid as number;

    // ── 10. call_persons links ────────────────────────────
    try { db.prepare('INSERT OR IGNORE INTO call_persons (call_id, person_id, role, added_by, created_at) VALUES (?,?,?,?,?)').run(callId, defendantId, 'subject', userId, now); } catch { /* ignore */ }
    if (plaintiffId) try { db.prepare('INSERT OR IGNORE INTO call_persons (call_id, person_id, role, added_by, created_at) VALUES (?,?,?,?,?)').run(callId, plaintiffId, 'complainant', userId, now); } catch {}
    if (attorneyId) try { db.prepare('INSERT OR IGNORE INTO call_persons (call_id, person_id, role, added_by, created_at) VALUES (?,?,?,?,?)').run(callId, attorneyId, 'reporting_party', userId, now); } catch {}

    // ── 11. Serve queue ───────────────────────────────────
    const addrMatch2 = parsed.address ? parsed.address.slice(0, 1000).match(/,\s*([^,]+),\s*([A-Z]{2})\s*(\d{5})/) : null;
    const sqId = db.prepare(`INSERT INTO serve_queue (call_id, recipient_name, recipient_address, recipient_city, recipient_state, recipient_zip, recipient_lat, recipient_lng, document_type, case_number, court_name, client_name, attorney_name, priority, deadline, service_instructions, notes, sm_job_id, status, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      callId, fullName, parsed.address || null,
      addrMatch2?.[1]?.trim() || null, addrMatch2?.[2] || 'UT', addrMatch2?.[3] || null,
      latitude, longitude,
      parsed.primaryDoc.toLowerCase(), parsed.clientJobNumber || null, parsed.court || null,
      parsed.plaintiff || null, parsed.attorney.name || null,
      'normal', parsed.dueDate || null, parsed.instructions || null,
      `Case ${parsed.clientJobNumber}; Due ${parsed.dueDate}; ${parsed.serviceWindows}`,
      parsed.jobNumber || null, 'pending', now, now,
    ).lastInsertRowid as number;

    // ── 12. Pre-planned serve_attempts (3 rows) ──────────
    const attemptIds: number[] = [];
    for (let i = 0; i < schedule.length; i++) {
      const s = schedule[i];
      const aid = db.prepare(`INSERT INTO serve_attempts (serve_queue_id, attempt_number, attempt_at, planned_at, window, status, notes, created_at)
        VALUES (?,?,?,?,?,?,?,?)`).run(
        sqId, i + 1, s.date.toISOString(), s.date.toISOString(), s.window, 'planned',
        s.isWeekendSlot ? 'Weekend slot (diligence required)' : null, now,
      ).lastInsertRowid as number;
      attemptIds.push(aid);
    }

    // ── 13. Audit + broadcast ─────────────────────────────
    auditLog(req, 'SERVE_INTAKE', 'calls_for_service', callId, JSON.stringify({
      defendant_person_id: defendantId, plaintiff_person_id: plaintiffId, attorney_person_id: attorneyId,
      property_id: propertyId, case_id: caseId, call_id: callId, serve_queue_id: sqId, serve_attempt_ids: attemptIds,
      job_number: parsed.jobNumber, client_job_number: parsed.clientJobNumber,
    }));
    broadcastDispatchUpdate({ action: 'call_created', call: { id: callId, call_number: callNumber, incident_type: 'pso_client_request' } });

    res.json({
      success: true,
      defendant_person_id: defendantId,
      plaintiff_person_id: plaintiffId,
      attorney_person_id: attorneyId,
      property_id: propertyId,
      case_id: caseId,
      call_id: callId,
      call_number: callNumber,
      serve_queue_id: sqId,
      serve_attempt_ids: attemptIds,
      latitude, longitude,
      weather: weather || null, lighting: lighting || null,
      extracted: parsed,
      warnings: [],
    });
  } catch (err: any) {
    log.error({ err }, 'serve intake failed');
    res.status(500).json({ error: 'Intake processing failed: ' + (err?.message || 'Unknown error') });
  }
});
```

**Step 3: Typecheck**

```bash
cd server && npx tsc --noEmit
```

Fix any type errors (likely candidates: `req.log` typing, `better-sqlite3` `run(...)` arg count).

**Step 4: Run the full server test suite**

```bash
cd server && npx vitest run
```

Expected: all previously-passing tests still pass; new serveIntake parse tests pass.

**Step 5: Commit**

```bash
git add server/src/routes/serveIntake.ts
git commit -m "refactor(serve-intake): rewrite /intake w/ helpers + full fanout (persons, case, property, queue, attempts)"
```

---

## Task 11: Client — surface new response IDs as contextual links

**Files:**
- Modify: `client/src/pages/ServeIntakePage.tsx` (update `IntakeResult` interface + the result panel)

**Step 1: Extend the TypeScript interface**

Replace the `IntakeResult` interface (around line 22) with:

```tsx
interface IntakeResult {
  success: boolean;
  defendant_person_id: number;
  plaintiff_person_id: number | null;
  attorney_person_id: number | null;
  property_id: number | null;
  case_id: number;
  call_id: number;
  call_number: string;
  serve_queue_id: number | null;
  serve_attempt_ids: number[];
  latitude: number | null;
  longitude: number | null;
  weather: string | null;
  lighting: string | null;
  warnings: string[];
  extracted: {
    defendant: { first: string; middle: string; last: string; dob: string };
    address: string;
    plaintiff: string;
    court: string;
    documents: string;
    primaryDoc: string;
    serviceType: string;
    clientJobNumber: string;
    jobNumber: string;
    dueDate: string;
    attorney: { name: string; firm: string; barNumber: string; tel: string; email: string };
  };
}
```

Rename any old references (`result.person_id` → `result.defendant_person_id`, etc.).

**Step 2: Add the four new link buttons in the result panel**

Below the existing 3-card grid (Person / Property / Call), add:

```tsx
{result && (
  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2 text-[10px]">
    <button onClick={() => navigate(`/records/persons/${result.defendant_person_id}`)} className="toolbar-btn justify-center"><User className="w-3 h-3" /> Defendant</button>
    {result.plaintiff_person_id && <button onClick={() => navigate(`/records/persons/${result.plaintiff_person_id}`)} className="toolbar-btn justify-center"><Building2 className="w-3 h-3" /> Plaintiff</button>}
    {result.attorney_person_id && <button onClick={() => navigate(`/records/persons/${result.attorney_person_id}`)} className="toolbar-btn justify-center"><User className="w-3 h-3" /> Attorney</button>}
    <button onClick={() => navigate(`/cases/${result.case_id}`)} className="toolbar-btn justify-center"><FileText className="w-3 h-3" /> Case</button>
    {result.serve_queue_id && <button onClick={() => navigate(`/serve?queue=${result.serve_queue_id}`)} className="toolbar-btn justify-center"><Phone className="w-3 h-3" /> Serve Queue</button>}
  </div>
)}

{result?.warnings?.length > 0 && (
  <div className="bg-amber-900/20 border border-amber-700/40 rounded-sm p-2 text-[10px] text-amber-300">
    <AlertTriangle className="w-3 h-3 inline mr-1" /> Warnings:
    <ul className="list-disc list-inside">{result.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
  </div>
)}
```

**Step 3: Typecheck**

```bash
cd client && npx tsc --noEmit
```

Expected: 0 errors.

**Step 4: Local smoke test** — run `npm run dev` from repo root, log in, navigate to `/serve-intake`, drag the 3 Armstrong PDFs in, click Create. Verify:
- Result card shows all 5 buttons
- Clicking Defendant/Plaintiff/Attorney opens Records with correct person
- Clicking Case opens the civil case
- Clicking Dispatch shows the new P4 call with 8-section notes in the drawer
- Service address map pin appears on `/map`

**Step 5: Commit**

```bash
git add client/src/pages/ServeIntakePage.tsx
git commit -m "feat(serve-intake): surface all created IDs + warnings in result panel"
```

---

## Task 12: Bump service worker CACHE_NAME

**Files:**
- Modify: `client/public/sw.js`

**Step 1:** Grep current version and bump by 1.

```bash
grep -n CACHE_NAME client/public/sw.js
```

Edit the version string (e.g. `v273` → `v274`).

**Step 2: Commit**

```bash
git add client/public/sw.js
git commit -m "chore(sw): bump CACHE_NAME for serve-intake release"
```

---

## Task 13: Deploy + verify on production

**Step 1: Deploy**

```bash
bash deploy/deploy.sh
```

Watch for typecheck gate failures (server + client). Fix any before rerunning.

**Step 2: Verify**

```bash
curl -sf https://rmpgutah.us/api/health | python3 -m json.tool
ssh root@194.113.64.90 "grep CACHE_NAME /opt/rmpg-flex/client/dist/sw.js"
ssh root@194.113.64.90 "sqlite3 /opt/rmpg-flex/server/data/rmpg-flex.db 'PRAGMA table_info(clients);' | grep billing_code"
ssh root@194.113.64.90 "sqlite3 /opt/rmpg-flex/server/data/rmpg-flex.db \"SELECT billing_code, requestor_email FROM clients WHERE name LIKE '%ICU%';\""
```

Expected: health OK, SW version matches local, `billing_code` column present, ICU row has `0175` / `a1processserver@gmail.com`.

**Step 3: End-to-end live test**

Log into https://rmpgutah.us, navigate to `/serve-intake`, drag the 3 Armstrong PDFs, create the intake. Download the generated CFS PDF from Dispatch and compare side-by-side to `26-CFS00154.pdf` — every field group (CALLER/PSO/PROCESS/INCIDENT LOCATION/SCENE) should have the same shape with Armstrong-substituted values.

**Step 4: Regression check**

- `/records` — search `Armstrong` → defendant person card appears with linked property and case
- `/records` — search `Heather Valerga` → attorney person card appears with bar# 14431
- `/records` — search `Capital One` → plaintiff entity appears
- `/cases` — new civil case with title `Capital v. Armstrong`, plaintiff/defendant/attorney all linked
- `/serve` — pending row with 3 pre-planned attempts
- `/map` — pin at 2361 E 3395 S with resident popup
- `/dispatch` — new P4 call in Active Calls with 8-section notes in the drawer

**Step 5: Commit nothing (verification only).** If any regression, branch and fix before moving on.

---

## Task 14: Follow-ups (flag, don't implement)

Open these as separate issues (or as `mcp__ccd_session__spawn_task` calls):

1. **CFS renderer mapping** — intake writes `caller_relationship='client'` but the PS-201 PDF generator renders `MANAGEMENT`. Fix in the renderer, not intake.
2. **Barcode mismatch warning** — if `*S10000NNNNNN*` on docket disagrees with Field Sheet's `(NNNNNN)`, surface a banner in intake UI.
3. **Multi-defendant support** — some dockets name multiple defendants. Current intake assumes one.
4. **Backfill existing CFS** — run a one-off script to re-parse recent PSO Client Request calls (last 30 days) through the new parser and overwrite their `notes` / `description` / `caller_name` if they come from the old broken extractor.

---

## Success Criteria

- [ ] Typecheck passes (`server && npx tsc --noEmit`, `client && npx tsc --noEmit`)
- [ ] All vitest tests pass (`cd server && npx vitest run`)
- [ ] Armstrong end-to-end intake produces CFS matching Gutierrez shape, with no `N/A` in the 15 fields that Gutierrez has filled
- [ ] Records search finds all 3 newly-created persons by name + attorney by bar#
- [ ] Civil case links plaintiff/defendant/attorney/property/call
- [ ] Serve queue has 3 pre-planned attempts including one weekend slot
- [ ] Map pin lights up at correct coordinates with beat overlay
- [ ] Production `/api/health` returns OK after deploy
