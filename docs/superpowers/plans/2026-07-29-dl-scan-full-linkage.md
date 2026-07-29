# DL Scan Full Field Coverage + Auto-Linking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `POST /records/from-dl-scan` persist every AAMVA field it already parses, auto-populate `dl_records` in the same call, and auto-link the resolved person to the current call, that call's case, and any matching warrants (backfilling orphaned warrant rows and surfacing active-warrant alerts).

**Architecture:** All work lands in one existing endpoint (`src/routes/records.ts`'s `POST /from-dl-scan`) plus its supporting `writePersonExt`/`PERSON_EXT_COLUMNS` machinery, one new migration adding overflow columns to `persons_ext`, a small helper extracted from `src/routes/dlRecords.ts` for the `dl_records` upsert, and two client files (`scanIdToRecipient.ts`, `FieldCameraPage.tsx`) updated to send/consume the expanded payload. No new tables, no new routes.

**Tech Stack:** Cloudflare D1 (SQLite), Hono routes (`src/routes/records.ts`, `src/routes/dlRecords.ts`), `src/utils/db.ts` (`execute`/`query`/`queryFirst`), React 18 + TypeScript client, Vitest + `@cloudflare/vitest-pool-workers` (Miniflare) for route-level tests.

## Global Constraints

- `persons` is at the D1 100-column SELECT cap — every new AAMVA field goes to `persons_ext` (1:1 overflow table), never to `persons`, except `is_veteran` which already exists as an unused column on `persons` itself.
- D1 does not support `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` — migrations use bare `ADD COLUMN` and accept re-apply failure as normal (per `migrations/README.md`).
- D1 `bind()` throws `D1_TYPE_ERROR` on raw JS objects/arrays — always `JSON.stringify()` before binding (existing pattern in `writePersonExt`, `src/routes/records.ts:274-275`).
- All D1 reads/writes are async — always `await`.
- New/changed linking behavior (call, case, warrant) must be best-effort per-step: a failure in one step must not fail person/`dl_records` creation or block the response.
- Route-level Worker tests live in `test-workers/*.test.ts` (Miniflare via `@cloudflare/vitest-pool-workers`, run with `npm run test:worker`) — this test DB starts empty per test file; tests create their own minimal tables with `CREATE TABLE` (not the real migrations), matching the existing pattern in `test-workers/warrantWatchlistSweep.test.ts`.
- `/api/records` requires a valid JWT (`ROUTE_REGISTRY` entry in `src/routesConfig.ts:408`, `auth: 'required'`) — route tests mint one with `sign()` from `hono/jwt`, matching `test-workers/auth.test.ts`'s `mintAccessToken` helper.

---

## File Structure

- **Create:** `migrations/0211_persons_ext_full_aamva_fields.sql` — adds 10 new overflow columns to `persons_ext`.
- **Modify:** `src/routes/records.ts` — extend `PERSON_EXT_COLUMNS`, extend the `from-dl-scan` create-branch writes, add `is_veteran` to the base `persons` INSERT, add call/case/warrant auto-linking, extend the response shape.
- **Modify:** `src/routes/dlRecords.ts` — extract the upsert-on-`(dl_number, dl_state)` logic (currently inline in `POST /`) into an exported `upsertDlRecord(db, userId, body)` helper so `records.ts` can call it without an internal HTTP round-trip.
- **Modify:** `client/src/utils/scanIdToRecipient.ts` — extend `DlScanResultObj`/`aamvaToScanResultObj` with the 8 fields not yet sent from the client (`is_real_id`, `is_organ_donor`, `is_veteran`, `under_18_until`, `under_21_until`, `aamva_version`, `issuer_id`, `address2`, `raw_elements`) — `country`/`document_discriminator`/`suffix` are already sent by the client, only their backend persistence was missing.
- **Modify:** `client/src/pages/mobile/FieldCameraPage.tsx` — pass `call_id` in the POST body, fix the response-shape mismatch (`resp.personId`/`resp.personCreated` don't exist on the real API response — it returns `person.id`/`person_created` — this is a pre-existing bug from the prior PR that this task corrects while already touching this exact call site), render `warrant_hits`/`prior_calls`/`open_cases`.
- **Test:** `test-workers/fromDlScanLinking.test.ts` — route-level Miniflare tests for the full linking behavior.
- **Test:** `client/src/utils/__tests__/scanIdToRecipient.test.ts` — extend existing tests for the newly-mapped fields.

---

### Task 1: Migration — `persons_ext` full AAMVA overflow columns

**Files:**
- Create: `migrations/0211_persons_ext_full_aamva_fields.sql`

**Interfaces:**
- Produces: 10 new nullable columns on `persons_ext`, consumed by Task 2's `PERSON_EXT_COLUMNS` set.

- [ ] **Step 1: Write the migration**

Create `migrations/0211_persons_ext_full_aamva_fields.sql`:

```sql
-- Overflow columns for AAMVA fields the DL barcode scanner already parses
-- but POST /records/from-dl-scan never persists. persons is at the D1
-- 100-column SELECT cap, so all of these go on persons_ext (the existing
-- 1:1 overflow table, migration 0081/0155), never on persons.
-- suffix already exists on persons_ext (migration 0081) but is unused by
-- the from-dl-scan write path — that gap is closed in code (Task 2), not schema.
ALTER TABLE persons_ext ADD COLUMN country TEXT;
ALTER TABLE persons_ext ADD COLUMN document_discriminator TEXT;
ALTER TABLE persons_ext ADD COLUMN is_real_id INTEGER;
ALTER TABLE persons_ext ADD COLUMN is_organ_donor INTEGER;
ALTER TABLE persons_ext ADD COLUMN under_18_until TEXT;
ALTER TABLE persons_ext ADD COLUMN under_21_until TEXT;
ALTER TABLE persons_ext ADD COLUMN aamva_version INTEGER;
ALTER TABLE persons_ext ADD COLUMN issuer_id TEXT;
ALTER TABLE persons_ext ADD COLUMN address2 TEXT;
ALTER TABLE persons_ext ADD COLUMN raw_aamva_elements TEXT;
```

- [ ] **Step 2: Apply locally and verify**

Run: `npm run migrate:local`
Expected: migration applies with no error (or the expected "duplicate column" only if re-run — first run must be clean).

Run: `wrangler d1 execute rmpg-flex --local --command "PRAGMA table_info(persons_ext)"` (or the project's equivalent local D1 name — check `wrangler.toml` for the exact local binding name used by `npm run migrate:local`)
Expected: output includes all 10 new column names.

- [ ] **Step 3: Commit**

```bash
git add migrations/0211_persons_ext_full_aamva_fields.sql
git commit -m "feat(db): add persons_ext overflow columns for full AAMVA field coverage"
```

---

### Task 2: Backend — persist every AAMVA field to persons/persons_ext

**Files:**
- Modify: `src/routes/records.ts:255-260` (`PERSON_EXT_COLUMNS`), `:399-418` (the `from-dl-scan` person-create branch)

**Interfaces:**
- Consumes: the 10 new `persons_ext` columns from Task 1; the existing `writePersonExt(db, personId, body)` helper (`records.ts:265-285`, unchanged signature — it's already generic over `PERSON_EXT_COLUMNS`).
- Produces: no new exported symbols — this task only changes what data reaches D1 from the same endpoint.

- [ ] **Step 1: Extend `PERSON_EXT_COLUMNS`**

In `src/routes/records.ts`, change:

```ts
const PERSON_EXT_COLUMNS = new Set([
  'suffix', 'nationality', 'voice_description', 'religion', 'dietary_restrictions',
  'address_2', // apartment/unit number (persons at 96 cols — overflow only)
  // DL barcode fields (AAMVA PDF417 elements DCB/DCD/DBD) — mig 0155
  'dl_restrictions', 'dl_endorsements', 'dl_issue_date',
]);
```

to:

```ts
const PERSON_EXT_COLUMNS = new Set([
  'suffix', 'nationality', 'voice_description', 'religion', 'dietary_restrictions',
  'address_2', // apartment/unit number (persons at 96 cols — overflow only)
  // DL barcode fields (AAMVA PDF417 elements DCB/DCD/DBD) — mig 0155
  'dl_restrictions', 'dl_endorsements', 'dl_issue_date',
  // Full AAMVA field coverage (mig 0211) — was parsed by the scanner but
  // dropped on the way to D1 before this change.
  'country', 'document_discriminator', 'is_real_id', 'is_organ_donor',
  'under_18_until', 'under_21_until', 'aamva_version', 'issuer_id',
  'address2', 'raw_aamva_elements',
]);
```

- [ ] **Step 2: Write all fields on person-create in `from-dl-scan`**

In `src/routes/records.ts`, find the `from-dl-scan` handler's person-create branch (`if (!person) { ... }`, currently around line 389-419). Change the base `persons` INSERT to include `is_veteran`, and the `writePersonExt` call to include all newly-covered fields with correct type coercion:

Replace:

```ts
      const result = await execute(db, `
        INSERT INTO persons (first_name, middle_name, last_name, dob, gender, height, weight,
          eye_color, hair_color, address, city, state, zip, dl_number, dl_state,
          dl_expiry, dl_class, flags, notes, created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, datetime('now'))`,
        first, str(scan.middle_name), last, dob, str(scan.gender), str(scan.height),
        str(scan.weight), str(scan.eye_color), str(scan.hair_color), str(scan.address),
        str(scan.city), str(scan.state), str(scan.zip), dlNumber, str(scan.dl_state),
        str(scan.dl_expiry), str(scan.dl_class),
        JSON.stringify(['dl_scan_imported']), note);
      const newPersonId = Number(result.meta.last_row_id);
      // Write AAMVA overflow fields (restrictions/endorsements/issue_date) to persons_ext
      await writePersonExt(db, newPersonId, {
        dl_restrictions: str(scan.dl_restrictions),
        dl_endorsements: str(scan.dl_endorsements),
        dl_issue_date:   str(scan.dl_issue_date),
      });
```

with:

```ts
      // Booleans arrive from AamvaResult as `boolean | null`; coerce to
      // 0/1/null explicitly rather than binding a JS boolean (D1's bind()
      // behavior on raw booleans is not something to rely on).
      const boolToInt = (v: unknown): number | null => (v == null ? null : (v ? 1 : 0));
      const isVeteran = boolToInt(scan.is_veteran);

      const result = await execute(db, `
        INSERT INTO persons (first_name, middle_name, last_name, dob, gender, height, weight,
          eye_color, hair_color, address, city, state, zip, dl_number, dl_state,
          dl_expiry, dl_class, is_veteran, flags, notes, created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, datetime('now'))`,
        first, str(scan.middle_name), last, dob, str(scan.gender), str(scan.height),
        str(scan.weight), str(scan.eye_color), str(scan.hair_color), str(scan.address),
        str(scan.city), str(scan.state), str(scan.zip), dlNumber, str(scan.dl_state),
        str(scan.dl_expiry), str(scan.dl_class), isVeteran,
        JSON.stringify(['dl_scan_imported']), note);
      const newPersonId = Number(result.meta.last_row_id);
      // Write every AAMVA overflow field to persons_ext — full field
      // coverage (mig 0211), not just the restrictions/endorsements/issue_date
      // subset from mig 0155.
      await writePersonExt(db, newPersonId, {
        suffix:                 str(scan.suffix),
        dl_restrictions:        str(scan.dl_restrictions),
        dl_endorsements:        str(scan.dl_endorsements),
        dl_issue_date:          str(scan.dl_issue_date),
        country:                str(scan.country),
        document_discriminator: str(scan.document_discriminator),
        is_real_id:             boolToInt(scan.is_real_id),
        is_organ_donor:         boolToInt(scan.is_organ_donor),
        under_18_until:         str(scan.under_18_until),
        under_21_until:         str(scan.under_21_until),
        aamva_version:          typeof scan.aamva_version === 'number' ? scan.aamva_version : null,
        issuer_id:              str(scan.issuer_id),
        address2:               str(scan.address2),
        raw_aamva_elements:     scan.raw_elements ?? null,
      });
```

Note: `writePersonExt` already JSON-stringifies any object value it receives (`records.ts:274-275`), so passing `scan.raw_elements` (a plain object from the client) directly is correct — do not `JSON.stringify()` it again here.

- [ ] **Step 3: Extend the client-sent payload to match**

In `client/src/utils/scanIdToRecipient.ts`, extend `DlScanResultObj` and `aamvaToScanResultObj` (this overlaps with Task 5 below — do this now so Task 2's backend write path has real data to test against end-to-end; Task 5 formalizes it with its own test). Change:

```ts
export interface DlScanResultObj {
  first_name: string; middle_name: string; last_name: string; suffix: string;
  date_of_birth: string; gender: string; height: string; weight: string;
  eye_color: string; hair_color: string;
  address: string; city: string; state: string; zip: string;
  dl_number: string; dl_state: string; dl_class: string;
  dl_expiry: string; dl_issue_date: string;
  dl_restrictions: string; dl_endorsements: string;
  country: string; document_discriminator: string;
}
```

to:

```ts
export interface DlScanResultObj {
  first_name: string; middle_name: string; last_name: string; suffix: string;
  date_of_birth: string; gender: string; height: string; weight: string;
  eye_color: string; hair_color: string;
  address: string; address2: string; city: string; state: string; zip: string;
  dl_number: string; dl_state: string; dl_class: string;
  dl_expiry: string; dl_issue_date: string;
  dl_restrictions: string; dl_endorsements: string;
  country: string; document_discriminator: string;
  is_real_id: boolean | null; is_organ_donor: boolean | null; is_veteran: boolean | null;
  under_18_until: string; under_21_until: string;
  aamva_version: number; issuer_id: string;
  raw_elements: Record<string, string>;
}
```

and `aamvaToScanResultObj`'s return object, adding after `document_discriminator: parsed.document_discriminator,`:

```ts
    address2: parsed.address2,
    is_real_id: parsed.is_real_id,
    is_organ_donor: parsed.is_organ_donor,
    is_veteran: parsed.is_veteran,
    under_18_until: parsed.under_18_until,
    under_21_until: parsed.under_21_until,
    aamva_version: parsed.aamva_version,
    issuer_id: parsed.issuer_id,
    raw_elements: parsed.raw_elements,
```

- [ ] **Step 4: Update the existing client test file for the new fields**

In `client/src/utils/__tests__/scanIdToRecipient.test.ts`, the `makeAamva()` fixture already sets every one of these fields on `AamvaResult` (it was written against the full interface). Add one assertion to the existing `aamvaToScanResultObj` test:

```ts
  it('maps AAMVA fields to the /records/from-dl-scan payload shape', () => {
    const out = aamvaToScanResultObj(makeAamva());
    expect(out.first_name).toBe('JANE');
    expect(out.last_name).toBe('DOE');
    expect(out.dl_number).toBe('D1234567');
    expect(out.dl_state).toBe('UT');
    expect(out.date_of_birth).toBe('1990-05-14');
    // dl_class/restrictions/endorsements go through the describe* translators
    expect(out.dl_class).toMatch(/Class D/);
    // Full-field-coverage additions
    expect(out.address2).toBe('');
    expect(out.is_real_id).toBe(true);
    expect(out.aamva_version).toBe(9);
    expect(out.issuer_id).toBe('636040');
    expect(out.raw_elements).toEqual({});
  });
```

- [ ] **Step 5: Run tests to verify**

Run: `cd client && npx vitest run src/utils/__tests__/scanIdToRecipient.test.ts`
Expected: PASS (5 tests in the `aamvaToScanResultObj` describe block).

Run: `cd client && npx tsc --noEmit`
Expected: 0 errors — this confirms `FieldCameraPage.tsx`'s existing call to `aamvaToScanResultObj` still typechecks (it only reads `.first_name` etc. off the return value, so widening the interface is additive and safe).

- [ ] **Step 6: Commit**

```bash
git add src/routes/records.ts client/src/utils/scanIdToRecipient.ts client/src/utils/__tests__/scanIdToRecipient.test.ts
git commit -m "feat(dl-scan): persist every parsed AAMVA field, not just a subset"
```

---

### Task 3: Backend — extract shared `dl_records` upsert helper, auto-populate on scan

**Files:**
- Modify: `src/routes/dlRecords.ts:88-189` (extract `upsertDlRecord` helper from the existing `POST /` handler)
- Modify: `src/routes/records.ts` (call the new helper from `from-dl-scan`)

**Interfaces:**
- Produces: `export async function upsertDlRecord(db: ReturnType<typeof getDb>, userId: number | null, body: Record<string, any>): Promise<{ recordId: number; created: boolean }>` from `src/routes/dlRecords.ts`.
- Consumes (in Task 4): `upsertDlRecord` is imported into `records.ts` and called after the person is resolved.

- [ ] **Step 1: Extract the upsert logic in `dlRecords.ts`**

In `src/routes/dlRecords.ts`, the current `dlRecords.post('/', async (c) => { ... })` handler (lines 88-189) contains the upsert-on-`(dl_number, dl_state)` logic inline, including the audit-log call at the end. Extract everything between `const db = getDb(c.env);` / `const userId = ...;` and the final `await audit(...)` + `return c.json(...)` into a standalone exported function, keeping the route handler as a thin wrapper. The audit call and the final HTTP response stay in the route handler (the helper's callers may want different audit semantics), but everything else — the existence check, INSERT/UPDATE, and the `dl_addresses` write — moves into the helper.

Change the top of the file to export:

```ts
export async function upsertDlRecord(
  db: ReturnType<typeof getDb>, body: Record<string, any>,
): Promise<{ recordId: number; created: boolean }> {
  if (!body.dl_number || !body.dl_state) {
    throw new Error('DL number and state are required');
  }
  if (!body.last_name || !body.first_name) {
    throw new Error('First and last name are required');
  }

  const fullName = `${body.first_name || ''} ${body.middle_name || ''} ${body.last_name || ''}`
    .replace(/\s+/g, ' ').trim();
  const source = typeof body.source === 'string' && body.source ? body.source : 'MANUAL_ENTRY';
  const dlExpiration = body.dl_expiration || body.dl_expiry || '';
  const rawRecord = typeof body.raw_record === 'string'
    ? body.raw_record.slice(0, 32_000)
    : JSON.stringify(body).slice(0, 32_000);

  const existing = await queryFirst<{ id: number }>(
    db, 'SELECT id FROM dl_records WHERE dl_number = ? AND dl_state = ?',
    body.dl_number, body.dl_state,
  );

  let recordId: number;
  let created = false;
  if (existing) {
    await execute(
      db,
      `UPDATE dl_records SET
         dl_class = ?, dl_status = ?, dl_expiration = ?, dl_issue_date = ?,
         dl_restrictions = ?, dl_endorsements = ?,
         first_name = ?, middle_name = ?, last_name = ?, full_name = ?, suffix = ?,
         date_of_birth = ?, gender = ?, height = ?, weight = ?,
         eye_color = ?, hair_color = ?, race = ?,
         source = ?, raw_record = ?, updated_at = datetime('now')
       WHERE id = ?`,
      body.dl_class || '', body.dl_status || '', dlExpiration, body.dl_issue_date || '',
      body.dl_restrictions || '', body.dl_endorsements || '',
      body.first_name || '', body.middle_name || '', body.last_name || '', fullName, body.suffix || '',
      body.date_of_birth || '', body.gender || '', body.height || '', body.weight || '',
      body.eye_color || '', body.hair_color || '', body.race || '',
      source, rawRecord, existing.id,
    );
    recordId = existing.id;
    await execute(db, 'DELETE FROM dl_addresses WHERE dl_record_id = ?', recordId);
  } else {
    const result = await execute(
      db,
      `INSERT INTO dl_records (
         dl_number, dl_state, dl_class, dl_status, dl_expiration, dl_issue_date,
         dl_restrictions, dl_endorsements,
         first_name, middle_name, last_name, full_name, suffix,
         date_of_birth, gender, height, weight, eye_color, hair_color, race,
         source, raw_record, fetched_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      body.dl_number, body.dl_state, body.dl_class || '', body.dl_status || '',
      dlExpiration, body.dl_issue_date || '',
      body.dl_restrictions || '', body.dl_endorsements || '',
      body.first_name || '', body.middle_name || '', body.last_name || '', fullName, body.suffix || '',
      body.date_of_birth || '', body.gender || '', body.height || '', body.weight || '',
      body.eye_color || '', body.hair_color || '', body.race || '',
      source, rawRecord,
    );
    recordId = Number(result.meta.last_row_id);
    created = true;
  }

  if (body.address || body.city) {
    const addr: DlAddress = {
      address: body.address || '', address2: body.address2 || '', city: body.city || '',
      state: body.address_state || body.dl_state || '', postal_code: body.postal_code || '',
      country: 'US',
    };
    await execute(
      db,
      `INSERT INTO dl_addresses (dl_record_id, address, address2, city, state, postal_code, country)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      recordId, addr.address, addr.address2, addr.city, addr.state, addr.postal_code, addr.country,
    );
  }

  return { recordId, created };
}
```

Then change the route handler to:

```ts
dlRecords.post('/', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'officer');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const userId = (c.get('userId') as number) ?? null;
    const b = await c.req.json<Record<string, any>>();

    let recordId: number;
    let created: boolean;
    try {
      ({ recordId, created } = await upsertDlRecord(db, b));
    } catch (validationErr: any) {
      const code = validationErr.message.includes('name') ? 'FIRST_AND_LAST_NAME' : 'DL_NUMBER_AND_STATE';
      return c.json({ error: validationErr.message, code }, 400);
    }

    await audit(
      db, userId, 'dl_record_manual_entry', recordId,
      `Manual DL entry: ${b.dl_number} (${b.dl_state}) — ${b.last_name}, ${b.first_name}`,
    );

    return c.json({ success: true, recordId, message: 'DL record saved' });
  } catch (err) {
    return dbErrorResponse(c, err, 'Failed to save DL record', 'FAILED_TO_SAVE_DL');
  }
});
```

Read the actual current file to confirm the exact validation-error-message strings and the `DlAddress` type import location before making this edit — the code above assumes the messages currently thrown inline (`'DL number and state are required'`, `'First and last name are required'`) match what's read back in `POST /`'s existing 400 responses (`DL_NUMBER_AND_STATE`, `FIRST_AND_LAST_NAME` per `dlRecords.ts:96-101`); preserve those exact codes.

- [ ] **Step 2: Run the existing DL-records test coverage**

Check for an existing test file covering `POST /dl-records` (grep `test-workers/` and `tests/` for `dl-records` or `dlRecords`). If one exists, run it now to confirm the extraction didn't change behavior:

Run: `npm run test:worker` (or the specific file if found, e.g. `npx vitest run --config vitest.workers.config.mts test-workers/<foundFile>.test.ts`)
Expected: all existing tests for this route still pass — the extraction must be behavior-preserving.

- [ ] **Step 3: Wire the helper into `from-dl-scan`**

In `src/routes/records.ts`, add the import at the top of the file:

```ts
import { upsertDlRecord } from './dlRecords';
```

In the `from-dl-scan` handler, after the person is resolved (`const personId = Number(person!.id);` and the `screenPersonForSor` `waitUntil` block, i.e. after line ~427 in the current file), add the `dl_records` upsert — only when a `dl_number` was actually scanned (a passport/ID-card scan with no `dl_number` has nothing to upsert):

```ts
    // ── DL record: upsert in the same request so a scan populates both
    // persons and dl_records — previously two disconnected write paths. ──
    let dlRecordId: number | null = null;
    let dlRecordCreated = false;
    if (dlNumber) {
      try {
        const dlUpsert = await upsertDlRecord(db, {
          dl_number: dlNumber, dl_state: str(scan.dl_state),
          dl_class: str(scan.dl_class), dl_expiry: str(scan.dl_expiry),
          dl_issue_date: str(scan.dl_issue_date),
          dl_restrictions: str(scan.dl_restrictions), dl_endorsements: str(scan.dl_endorsements),
          first_name: first, middle_name: str(scan.middle_name), last_name: last, suffix: str(scan.suffix),
          date_of_birth: dob, gender: str(scan.gender), height: str(scan.height), weight: str(scan.weight),
          eye_color: str(scan.eye_color), hair_color: str(scan.hair_color),
          address: str(scan.address), address2: str(scan.address2), city: str(scan.city),
          address_state: str(scan.state), postal_code: str(scan.zip),
          source: 'DL_SCAN',
        });
        dlRecordId = dlUpsert.recordId;
        dlRecordCreated = dlUpsert.created;
      } catch (err) {
        console.warn('[from-dl-scan] dl_records upsert failed (non-fatal):', err);
      }
    }
```

- [ ] **Step 4: Add `dl_records` fields to the response**

At the end of the handler, extend the `return c.json({...}, 201)` call to include `dl_record_id: dlRecordId, dl_record_created: dlRecordCreated,` alongside the existing `person`/`vehicle`/`property` fields (Task 4 finalizes the full response shape — this task just adds these two fields without disturbing the rest).

- [ ] **Step 5: Run the worker typecheck**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/routes/dlRecords.ts src/routes/records.ts
git commit -m "feat(dl-scan): auto-upsert dl_records from the same scan that creates the person"
```

---

### Task 4: Backend — auto-link call/case/warrants, surface prior history, finalize response

**Files:**
- Modify: `src/routes/records.ts` (the `from-dl-scan` handler — request body, linking logic, response shape)

**Interfaces:**
- Consumes: `personId` (resolved earlier in the handler), `dlRecordId`/`dlRecordCreated` (from Task 3), `execute`/`query`/`queryFirst` (already imported in this file), `normalizeDob` (already imported).
- Produces: the final response shape for `POST /records/from-dl-scan`:
  ```ts
  {
    person: Record<string, unknown>, person_created: boolean,
    vehicle: Record<string, unknown> | null, vehicle_created: boolean,
    property: Record<string, unknown> | null, property_created: boolean,
    dl_record_id: number | null, dl_record_created: boolean,
    call_linked: boolean,
    case_linked_id: number | null,
    warrant_hits: Array<{ id: number; warrant_number: string | null; warrant_type: string | null; offense_description: string | null; bond_amount: number | null; issuing_agency: string | null }>,
    prior_calls: Array<{ id: number; call_number: string | null; incident_type: string | null; status: string | null; created_at: string }>,
    open_cases: Array<{ id: number; case_number: string | null; title: string | null; status: string | null }>,
  }
  ```
  Task 6 (client) reads `person.id`/`person_created` (fixing the existing client bug) and the new fields.

- [ ] **Step 1: Accept `call_id` in the request body**

In `src/routes/records.ts`, change the `from-dl-scan` handler's body type:

```ts
    const body = await c.req.json<{
      scan?: Record<string, unknown>;
      vehicle?: Record<string, unknown>;
      create_property?: boolean;
      call_id?: number;
    }>();
```

- [ ] **Step 2: Write the current-call and current-case links**

After the vehicle/property blocks (i.e. after the existing `propertyCreated` logic, before the final `return c.json(...)`), add:

```ts
    // ── Current call: auto-link the scanned subject to the call the
    // officer is scanning during, mirroring the existing ALPR call_vehicles
    // auto-link for scanned vehicles. Best-effort — a failure here must not
    // block person/dl_records/vehicle/property creation. ──
    let callLinked = false;
    let caseLinkedId: number | null = null;
    const callId = typeof body.call_id === 'number' ? body.call_id : null;
    if (callId) {
      try {
        await execute(db,
          `INSERT OR IGNORE INTO call_persons (call_id, person_id, person_type, added_at) VALUES (?, ?, 'subject', datetime('now'))`,
          callId, personId);
        callLinked = true;
      } catch (err) {
        console.warn('[from-dl-scan] call_persons link failed (non-fatal):', err);
      }
      try {
        const caseRow = await queryFirst<{ case_id: number }>(db,
          'SELECT case_id FROM case_calls WHERE call_id = ? LIMIT 1', callId);
        if (caseRow) {
          await execute(db,
            `INSERT OR IGNORE INTO case_person_links (case_id, person_id, relationship) VALUES (?, ?, 'linked')`,
            caseRow.case_id, personId);
          caseLinkedId = caseRow.case_id;
        }
      } catch (err) {
        console.warn('[from-dl-scan] case_person_links link failed (non-fatal):', err);
      }
    }
```

- [ ] **Step 3: Backfill orphan warrants and surface active ones**

Immediately after the call/case block, add:

```ts
    // ── Warrants: backfill any orphaned warrant (entered by name/DOB text
    // only, never linked to a person row) that matches this subject, then
    // surface every active warrant now linked to them — whether just
    // backfilled or already linked before this scan. Best-effort. ──
    let warrantHits: Array<Record<string, unknown>> = [];
    if (dob) {
      try {
        await execute(db,
          `UPDATE warrants SET subject_person_id = ?
           WHERE subject_person_id IS NULL AND LOWER(status) = 'active'
             AND LOWER(subject_first_name) = LOWER(?) AND LOWER(subject_last_name) = LOWER(?)
             AND subject_dob = ?`,
          personId, first, last, dob);
      } catch (err) {
        console.warn('[from-dl-scan] warrant backfill failed (non-fatal):', err);
      }
      try {
        warrantHits = await query<Record<string, unknown>>(db,
          `SELECT id, warrant_number, warrant_type, offense_description, bond_amount, issuing_agency
           FROM warrants WHERE subject_person_id = ? AND LOWER(status) = 'active'`,
          personId);
      } catch (err) {
        console.warn('[from-dl-scan] warrant hit query failed (non-fatal):', err);
      }
    }
```

- [ ] **Step 4: Surface prior calls and open cases (read-only)**

Immediately after the warrants block, add:

```ts
    // ── Prior calls / open cases: surfaced for officer awareness only —
    // never auto-written. A scan should not assert new case involvement
    // beyond the current call it's actually happening in (handled above). ──
    let priorCalls: Array<Record<string, unknown>> = [];
    let openCases: Array<Record<string, unknown>> = [];
    try {
      priorCalls = await query<Record<string, unknown>>(db,
        `SELECT c.id, c.call_number, c.incident_type, c.status, c.created_at
         FROM calls_for_service c JOIN call_persons cp ON c.id = cp.call_id
         WHERE cp.person_id = ? ORDER BY c.created_at DESC LIMIT 10`,
        personId);
    } catch (err) {
      console.warn('[from-dl-scan] prior calls query failed (non-fatal):', err);
    }
    try {
      openCases = await query<Record<string, unknown>>(db,
        `SELECT DISTINCT ca.id, ca.case_number, ca.title, ca.status
         FROM cases ca JOIN case_person_links cpl ON ca.id = cpl.case_id
         WHERE cpl.person_id = ? AND LOWER(ca.status) NOT IN ('closed', 'archived')
         ORDER BY ca.id DESC LIMIT 10`,
        personId);
    } catch (err) {
      console.warn('[from-dl-scan] open cases query failed (non-fatal):', err);
    }
```

Read the actual `cases` table schema (`migrations/baseline/schema.sql`, search `CREATE TABLE IF NOT EXISTS cases`) before this step to confirm the exact column names (`case_number`, `title`, `status`) — adapt the SELECT list to match if any differ; the join shape (`cases` ⋈ `case_person_links` on `case_id`) is confirmed correct from prior research.

- [ ] **Step 5: Finalize the response shape**

Replace the existing `return c.json({...}, 201)` with:

```ts
    return c.json({
      person, person_created: personCreated,
      vehicle, vehicle_created: vehicleCreated,
      property, property_created: propertyCreated,
      dl_record_id: dlRecordId, dl_record_created: dlRecordCreated,
      call_linked: callLinked,
      case_linked_id: caseLinkedId,
      warrant_hits: warrantHits,
      prior_calls: priorCalls,
      open_cases: openCases,
    }, 201);
```

- [ ] **Step 6: Run the worker typecheck**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add src/routes/records.ts
git commit -m "feat(dl-scan): auto-link current call/case, backfill and surface active warrants"
```

---

### Task 5: Backend test — full linking behavior (Miniflare route test)

**Files:**
- Create: `test-workers/fromDlScanLinking.test.ts`

**Interfaces:**
- Consumes: `app` from `./entry` (the full mounted Worker, same pattern as `test-workers/alprCapture.test.ts`), `sign` from `hono/jwt` (token minting, same pattern as `test-workers/auth.test.ts`'s `mintAccessToken`), `execute`/`query`/`queryFirst` from `../src/utils/db`.
- Produces: nothing consumed by other tasks — this is the terminal verification task for the backend work (Tasks 1-4).

- [ ] **Step 1: Write the test file**

Create `test-workers/fromDlScanLinking.test.ts`:

```ts
// test-workers/fromDlScanLinking.test.ts
// Route-level test (Miniflare/workerd) for POST /api/records/from-dl-scan's
// full field persistence + auto-linking: dl_records upsert, current-call/case
// linking, warrant backfill + surfacing, prior-call/open-case surfacing.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { sign } from 'hono/jwt';
import { execute, query } from '../src/utils/db';
import app from './entry';

const SECRET = 'test-jwt-secret-do-not-use-in-prod';

async function mintAccessToken(userId: number, role: string, username: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return sign({ sub: String(userId), user_id: userId, userId, username, role, iat: now, exp: now + 900, type: 'access' }, SECRET);
}

function envWithSecret() {
  return { ...(env as unknown as Record<string, unknown>), JWT_SECRET: SECRET };
}

async function resetTables() {
  const db = (env as unknown as { DB: D1Database }).DB;
  for (const t of [
    'persons_ext', 'persons', 'dl_records', 'dl_addresses', 'vehicles_records', 'properties',
    'warrants', 'call_persons', 'calls_for_service', 'case_person_links', 'case_calls', 'cases', 'users',
  ]) {
    await execute(db, `DROP TABLE IF EXISTS ${t}`);
  }
  await execute(db, `CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, role TEXT)`);
  await execute(db, `CREATE TABLE persons (
    id INTEGER PRIMARY KEY AUTOINCREMENT, first_name TEXT, middle_name TEXT, last_name TEXT, dob TEXT,
    gender TEXT, height TEXT, weight TEXT, eye_color TEXT, hair_color TEXT,
    address TEXT, city TEXT, state TEXT, zip TEXT, dl_number TEXT, dl_state TEXT,
    dl_expiry TEXT, dl_class TEXT, is_veteran INTEGER, flags TEXT, notes TEXT, created_at TEXT
  )`);
  await execute(db, `CREATE TABLE persons_ext (
    person_id INTEGER PRIMARY KEY, suffix TEXT, nationality TEXT, voice_description TEXT,
    religion TEXT, dietary_restrictions TEXT, address_2 TEXT,
    dl_restrictions TEXT, dl_endorsements TEXT, dl_issue_date TEXT,
    country TEXT, document_discriminator TEXT, is_real_id INTEGER, is_organ_donor INTEGER,
    under_18_until TEXT, under_21_until TEXT, aamva_version INTEGER, issuer_id TEXT,
    address2 TEXT, raw_aamva_elements TEXT
  )`);
  await execute(db, `CREATE TABLE dl_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT, dl_number TEXT, dl_state TEXT, dl_class TEXT, dl_status TEXT,
    dl_expiration TEXT, dl_issue_date TEXT, dl_restrictions TEXT, dl_endorsements TEXT,
    first_name TEXT, middle_name TEXT, last_name TEXT, full_name TEXT, suffix TEXT,
    date_of_birth TEXT, gender TEXT, height TEXT, weight TEXT, eye_color TEXT, hair_color TEXT, race TEXT,
    source TEXT, raw_record TEXT, fetched_at TEXT, updated_at TEXT
  )`);
  await execute(db, `CREATE TABLE dl_addresses (
    id INTEGER PRIMARY KEY AUTOINCREMENT, dl_record_id INTEGER, address TEXT, address2 TEXT,
    city TEXT, state TEXT, postal_code TEXT, country TEXT
  )`);
  await execute(db, `CREATE TABLE vehicles_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT, plate_number TEXT, state TEXT, vin TEXT, make TEXT,
    model TEXT, year TEXT, color TEXT, owner_person_id INTEGER, registered_owner TEXT,
    notes TEXT, created_at TEXT
  )`);
  await execute(db, `CREATE TABLE properties (
    id INTEGER PRIMARY KEY AUTOINCREMENT, client_id INTEGER, name TEXT, address TEXT, city TEXT,
    state TEXT, zip TEXT, property_type TEXT, occupancy_status TEXT, owner_name TEXT,
    notes TEXT, is_active INTEGER, created_at TEXT
  )`);
  await execute(db, `CREATE TABLE warrants (
    id INTEGER PRIMARY KEY AUTOINCREMENT, warrant_number TEXT, warrant_type TEXT, status TEXT DEFAULT 'active',
    subject_person_id INTEGER, subject_first_name TEXT, subject_last_name TEXT, subject_dob TEXT,
    offense_description TEXT, bond_amount REAL, issuing_agency TEXT
  )`);
  await execute(db, `CREATE TABLE calls_for_service (
    id INTEGER PRIMARY KEY AUTOINCREMENT, call_number TEXT, incident_type TEXT, status TEXT, created_at TEXT
  )`);
  await execute(db, `CREATE TABLE call_persons (
    id INTEGER PRIMARY KEY AUTOINCREMENT, call_id INTEGER, person_id INTEGER, person_type TEXT, added_at TEXT
  )`);
  await execute(db, `CREATE TABLE cases (
    id INTEGER PRIMARY KEY AUTOINCREMENT, case_number TEXT, title TEXT, status TEXT DEFAULT 'open'
  )`);
  await execute(db, `CREATE TABLE case_calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT, case_id INTEGER, call_id INTEGER
  )`);
  await execute(db, `CREATE TABLE case_person_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT, case_id INTEGER, person_id INTEGER, relationship TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);
}

function scanBody(overrides: Record<string, unknown> = {}) {
  return {
    scan: {
      first_name: 'Jane', last_name: 'Doe', date_of_birth: '1990-05-14',
      dl_number: 'D1234567', dl_state: 'UT', address: '123 Main St',
      is_veteran: true, suffix: 'Jr', country: 'USA', document_discriminator: 'ABC123',
      is_real_id: true, is_organ_donor: false, aamva_version: 9, issuer_id: '636040',
      address2: 'Apt 4', raw_elements: { DAQ: 'D1234567' },
      ...overrides,
    },
  };
}

describe('POST /api/records/from-dl-scan — full field persistence + auto-linking', () => {
  beforeEach(resetTables);

  it('persists every AAMVA field (persons + persons_ext) and upserts dl_records', async () => {
    const token = await mintAccessToken(1, 'officer', 'officer1');
    const res = await app.request('/api/records/from-dl-scan', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(scanBody()),
    }, envWithSecret());

    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.person_created).toBe(true);
    expect(body.dl_record_created).toBe(true);
    expect(body.dl_record_id).not.toBeNull();

    const db = (env as unknown as { DB: D1Database }).DB;
    const ext = await query<any>(db, 'SELECT * FROM persons_ext WHERE person_id = ?', body.person.id);
    expect(ext[0].suffix).toBe('Jr');
    expect(ext[0].country).toBe('USA');
    expect(ext[0].is_real_id).toBe(1);
    expect(ext[0].is_organ_donor).toBe(0);
    expect(ext[0].aamva_version).toBe(9);
    expect(JSON.parse(ext[0].raw_aamva_elements)).toEqual({ DAQ: 'D1234567' });

    const dlRows = await query<any>(db, 'SELECT * FROM dl_records WHERE dl_number = ?', 'D1234567');
    expect(dlRows.length).toBe(1);
    expect(dlRows[0].last_name).toBe('Doe');
  });

  it('re-scanning the same DL updates dl_records instead of duplicating it', async () => {
    const token = await mintAccessToken(1, 'officer', 'officer1');
    await app.request('/api/records/from-dl-scan', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(scanBody()),
    }, envWithSecret());
    const res2 = await app.request('/api/records/from-dl-scan', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(scanBody({ dl_class: 'C' })),
    }, envWithSecret());
    const body2 = await res2.json() as any;
    expect(body2.dl_record_created).toBe(false);

    const db = (env as unknown as { DB: D1Database }).DB;
    const dlRows = await query<any>(db, 'SELECT * FROM dl_records WHERE dl_number = ?', 'D1234567');
    expect(dlRows.length).toBe(1);
  });

  it('links the scanned subject to the current call when call_id is provided', async () => {
    const db = (env as unknown as { DB: D1Database }).DB;
    await execute(db, `INSERT INTO calls_for_service (id, call_number) VALUES (42, 'C-42')`);
    const token = await mintAccessToken(1, 'officer', 'officer1');
    const res = await app.request('/api/records/from-dl-scan', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...scanBody(), call_id: 42 }),
    }, envWithSecret());
    const body = await res.json() as any;
    expect(body.call_linked).toBe(true);

    const links = await query<any>(db, 'SELECT * FROM call_persons WHERE call_id = 42');
    expect(links.length).toBe(1);
    expect(links[0].person_id).toBe(body.person.id);
  });

  it('also links the case when the current call already belongs to one', async () => {
    const db = (env as unknown as { DB: D1Database }).DB;
    await execute(db, `INSERT INTO calls_for_service (id, call_number) VALUES (42, 'C-42')`);
    await execute(db, `INSERT INTO cases (id, case_number) VALUES (7, 'CASE-7')`);
    await execute(db, `INSERT INTO case_calls (case_id, call_id) VALUES (7, 42)`);
    const token = await mintAccessToken(1, 'officer', 'officer1');
    const res = await app.request('/api/records/from-dl-scan', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...scanBody(), call_id: 42 }),
    }, envWithSecret());
    const body = await res.json() as any;
    expect(body.case_linked_id).toBe(7);

    const links = await query<any>(db, 'SELECT * FROM case_person_links WHERE case_id = 7');
    expect(links.length).toBe(1);
    expect(links[0].person_id).toBe(body.person.id);
  });

  it('backfills an orphaned warrant matching name+DOB and surfaces it as a hit', async () => {
    const db = (env as unknown as { DB: D1Database }).DB;
    await execute(db,
      `INSERT INTO warrants (warrant_number, status, subject_first_name, subject_last_name, subject_dob)
       VALUES ('W-1', 'active', 'Jane', 'Doe', '1990-05-14')`);
    const token = await mintAccessToken(1, 'officer', 'officer1');
    const res = await app.request('/api/records/from-dl-scan', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(scanBody()),
    }, envWithSecret());
    const body = await res.json() as any;

    expect(body.warrant_hits.length).toBe(1);
    expect(body.warrant_hits[0].warrant_number).toBe('W-1');

    const warrantRow = await query<any>(db, `SELECT subject_person_id FROM warrants WHERE warrant_number = 'W-1'`);
    expect(warrantRow[0].subject_person_id).toBe(body.person.id);
  });

  it('does not backfill or surface a warrant with a different DOB', async () => {
    const db = (env as unknown as { DB: D1Database }).DB;
    await execute(db,
      `INSERT INTO warrants (warrant_number, status, subject_first_name, subject_last_name, subject_dob)
       VALUES ('W-2', 'active', 'Jane', 'Doe', '1985-01-01')`);
    const token = await mintAccessToken(1, 'officer', 'officer1');
    const res = await app.request('/api/records/from-dl-scan', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(scanBody()),
    }, envWithSecret());
    const body = await res.json() as any;
    expect(body.warrant_hits.length).toBe(0);
  });

  it('surfaces prior calls and open cases without writing new links to them', async () => {
    const db = (env as unknown as { DB: D1Database }).DB;
    const token = await mintAccessToken(1, 'officer', 'officer1');
    const first = await app.request('/api/records/from-dl-scan', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(scanBody()),
    }, envWithSecret());
    const firstBody = await first.json() as any;
    const personId = firstBody.person.id;

    await execute(db, `INSERT INTO calls_for_service (id, call_number, created_at) VALUES (99, 'C-99', datetime('now'))`);
    await execute(db, `INSERT INTO call_persons (call_id, person_id) VALUES (99, ?)`, personId);
    await execute(db, `INSERT INTO cases (id, case_number, status) VALUES (55, 'CASE-55', 'open')`);
    await execute(db, `INSERT INTO case_person_links (case_id, person_id) VALUES (55, ?)`, personId);

    const second = await app.request('/api/records/from-dl-scan', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(scanBody()),
    }, envWithSecret());
    const secondBody = await second.json() as any;

    expect(secondBody.prior_calls.some((c: any) => c.id === 99)).toBe(true);
    expect(secondBody.open_cases.some((c: any) => c.id === 55)).toBe(true);
    // Re-scanning must not create a duplicate call_persons/case_person_links row.
    const callLinks = await query<any>(db, 'SELECT * FROM call_persons WHERE call_id = 99');
    expect(callLinks.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test file to verify it fails first, then passes**

Run: `npx vitest run --config vitest.workers.config.mts test-workers/fromDlScanLinking.test.ts`
Expected before Tasks 1-4 land: this task is written last in the plan and run against already-implemented code, so it should PASS immediately if Tasks 1-4 are correct. If run standalone against unmodified code (e.g. while developing this test in isolation), it will FAIL with column/table mismatches — confirming the test actually exercises the new behavior rather than trivially passing.

Expected after: all 7 tests PASS.

- [ ] **Step 3: Run the full worker suite**

Run: `npm run typecheck && npx vitest run && npm run test:worker`
Expected: 0 typecheck errors, all Node-suite tests pass, all Miniflare worker-suite tests pass (including the 7 new ones and no regressions in existing `test-workers/*.test.ts` files).

- [ ] **Step 4: Commit**

```bash
git add test-workers/fromDlScanLinking.test.ts
git commit -m "test(dl-scan): route-level coverage for full field persistence + auto-linking"
```

---

### Task 6: Client — pass `call_id`, fix response-shape consumption, render new signals

**Files:**
- Modify: `client/src/pages/mobile/FieldCameraPage.tsx`

**Interfaces:**
- Consumes: the finalized `POST /records/from-dl-scan` response shape from Task 4 (`person.id`, `person_created`, `warrant_hits`, `prior_calls`, `open_cases`); `AamvaResult`/`ScanAlert` (already imported); `aamvaToScanResultObj` (already imported, from Task 2's extended `scanIdToRecipient.ts`).
- Produces: no new exports — leaf page component.

- [ ] **Step 1: Read the current file to find the exact `idScanResult` state and `handleIdScanComplete`/render-overlay code**

The prior PR's implementation is at roughly `client/src/pages/mobile/FieldCameraPage.tsx:140-141` (state) and `:400-410` (POST + state-set), `:745-780` (result overlay JSX) — verify exact current line numbers before editing, since Task 2/3/4's backend changes don't touch this file and line numbers should be stable, but confirm before editing.

- [ ] **Step 2: Fix the state shape and the POST call**

Change the `idScanResult` state type from:

```tsx
  const [idScanResult, setIdScanResult] = useState<{
    parsed: AamvaResult; alerts: ScanAlert[]; personId: number; personCreated: boolean;
  } | null>(null);
```

to:

```tsx
  const [idScanResult, setIdScanResult] = useState<{
    parsed: AamvaResult; alerts: ScanAlert[]; personId: number; personCreated: boolean;
    warrantHits: Array<{ id: number; warrant_number: string | null; offense_description: string | null }>;
    priorCallCount: number; openCaseCount: number;
  } | null>(null);
```

Change the POST call and its `resp` type — currently:

```tsx
      const resp = await apiFetch<{ personId: number; personCreated: boolean }>('/records/from-dl-scan', {
        method: 'POST',
        body: JSON.stringify({ scan: { ...scanPayload, aamva_raw: barcodeText } }),
      });
      setIdScanResult({ parsed, alerts, personId: resp.personId, personCreated: resp.personCreated });
      addToast(resp.personCreated ? 'New person record created from scan' : 'Matched existing person record', 'success');
```

Note: the current code posts `aamva_raw: barcodeText`, which the final review of the prior PR (commit `0c0a65a0d8`) already removed — if that field is not present, don't reintroduce it. Change to:

```tsx
      const resp = await apiFetch<{
        person: { id: number }; person_created: boolean;
        warrant_hits: Array<{ id: number; warrant_number: string | null; offense_description: string | null }>;
        prior_calls: unknown[]; open_cases: unknown[];
      }>('/records/from-dl-scan', {
        method: 'POST',
        body: JSON.stringify({ scan: scanPayload, call_id: callId ? Number(callId) : undefined }),
      });
      setIdScanResult({
        parsed, alerts, personId: resp.person.id, personCreated: resp.person_created,
        warrantHits: resp.warrant_hits, priorCallCount: resp.prior_calls.length, openCaseCount: resp.open_cases.length,
      });
      addToast(resp.person_created ? 'New person record created from scan' : 'Matched existing person record', 'success');
      if (resp.warrant_hits.length > 0) {
        addToast(`⚠ ${resp.warrant_hits.length} active warrant(s) found`, 'error');
      }
```

`callId` is the existing `const callId = searchParams.get('call_id');` already in scope in this component (used by the ALPR path) — confirm its exact variable name in the current file before this edit.

- [ ] **Step 3: Render warrant hits and prior-history counts in the result overlay**

In the result overlay JSX (the block rendering `idScanResult.alerts.map(...)`), add a warrant-hits section before the alerts map, and a prior-history line after the address line:

```tsx
            {idScanResult.warrantHits.length > 0 && (
              <div className="bg-red-950 border border-red-600 text-red-300 text-xs font-bold px-2 py-1.5 space-y-1">
                <div className="uppercase tracking-wider">⚠ Active Warrant{idScanResult.warrantHits.length > 1 ? 's' : ''}</div>
                {idScanResult.warrantHits.map((w) => (
                  <div key={w.id}>{w.warrant_number || `#${w.id}`} — {w.offense_description || 'no offense on file'}</div>
                ))}
              </div>
            )}
            {(idScanResult.priorCallCount > 0 || idScanResult.openCaseCount > 0) && (
              <div className="text-[10px] text-rmpg-400">
                {idScanResult.priorCallCount} prior call(s) · {idScanResult.openCaseCount} open case(s)
              </div>
            )}
```

Place the warrant-hits block using the same visual severity as the existing `assessAamva` danger-level alerts (`bg-red-950 border-red-600 text-red-300`, matching the existing alert-rendering pattern already in this file).

- [ ] **Step 4: Run typecheck and the full client suite**

Run: `cd client && npx tsc --noEmit`
Expected: 0 errors.

Run: `cd client && npx vitest run`
Expected: all tests pass, no regressions.

- [ ] **Step 5: Manual verification note**

Camera-dependent verification (scanning a real barcode and confirming the warrant banner/history line render correctly) cannot be exercised headlessly — note this explicitly in the implementer's report rather than claiming it was verified.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/mobile/FieldCameraPage.tsx
git commit -m "fix(field-camera): consume the real from-dl-scan response shape, pass call_id, surface warrant hits"
```

---

## Self-Review Notes

- **Spec coverage:** §1 (full field persistence) → Tasks 1-2. §2 (dl_records auto-link) → Task 3. §3a/b (call/case linking) → Task 4 Steps 1-2. §3c/d (warrant backfill + surfacing) → Task 4 Step 3. §3e (prior-call/open-case surfacing, read-only) → Task 4 Step 4. §4 (response shape) → Task 4 Step 5. §5 (client changes) → Tasks 2 Step 3, 6. §6 (best-effort error isolation) → Task 4's try/catch-per-step structure, tested in Task 5. §7 (testing) → Task 5 (worker), Task 2 Step 4 (client).
- **Bug fix bundled in scope:** the prior PR's `FieldCameraPage.tsx` reads `resp.personId`/`resp.personCreated`, which never existed on the real API response (`person.id`/`person_created`) — Task 6 corrects this while already rewriting this exact response-consumption code for the new fields; flagged explicitly rather than silently fixed, since it's outside this plan's spec but directly overlaps the code being changed.
- **No placeholders:** all code blocks are complete; the two "read the actual file to confirm exact names before editing" notes (Task 3's `DlAddress` type location, Task 4's `cases` table columns, Task 6's `callId` variable name and result-overlay line numbers) are verification instructions, not missing content — the surrounding code is fully specified either way.
- **Type consistency:** `dlRecordId`/`dlRecordCreated` (Task 3) flow into the `dl_record_id`/`dl_record_created` response keys (Task 4) unchanged; `warrant_hits`/`prior_calls`/`open_cases` shapes in Task 4's response match what Task 6's client code destructures field-for-field.
