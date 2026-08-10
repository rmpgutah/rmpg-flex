# AoS ID Capture, Bug Fixes & Data Collection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix four interconnected AoS bugs (barcode scan, form validation, paper form rejection, PDF layout) and add full AAMVA ID data capture with persons integration and front/back ID photos.

**Architecture:** The recipient form captures ID data via barcode scan or manual entry, plus front/back ID photos. The server upserts a `persons` record (match by DL# then name+DOB, FILL-ONLY write policy), stores the AAMVA snapshot on `serve_receipts`, links via a new `serve_receipt_persons` junction table, and writes ID photos to R2. Bug fixes are surgical: separate `validPageImage()` for paper route, flexible ID validation, WASM diagnostic logging.

**Tech Stack:** Hono (Worker routes), D1 (schema), R2 (ID photos), zxing-wasm (barcode), React (form), jsPDF (PDF output)

## Global Constraints

- D1 100-column SELECT cap: `persons` is AT the cap — new fields go to `persons_ext` only
- D1 100-bound-parameter cap: use `queryInChunks` for any IN-list from unbounded arrays
- Person write policy: FILL-ONLY via `COALESCE(existing, new)` — barcode fills blanks, never overwrites officer-entered data. Exception: physical description fields (height/weight/hair/eye) from a government ID DO overwrite.
- ID photos: R2 (bound as `UPLOADS`), max 2MB, JPEG/PNG only
- `recipient_aamva_json`: immutable point-in-time snapshot, never updated after insert
- All DDL must be idempotent (`IF NOT EXISTS`, swallowed ALTER failures)
- Apply migration to live D1 via `scripts/apply-migration.sh` after merge
- Never hardcode hex — use CSS variable-backed Tailwind tokens
- Run full test suites (worker + client) before declaring any task complete
- Pre-push hook runs desktop tests too — budget for the 5–15 min native rebuild

---

### Task 1: D1 Migration — Schema Changes

**Files:**
- Create: `migrations/0236_aos_id_capture.sql`

**Interfaces:**
- Produces: `serve_receipts` columns `recipient_person_id`, `recipient_aamva_json`, `id_scan_method`, `id_front_r2_key`, `id_back_r2_key`; table `serve_receipt_persons` with columns `id`, `receipt_id`, `person_id`, `role`, `id_scan_method`, `id_front_r2_key`, `id_back_r2_key`, `created_at`; `persons_ext` columns `place_of_birth`, `name_prefix`, `is_veteran`, `non_resident_indicator`, `limited_duration_doc`, `card_revision_date`, `dl_hazmat_expiry`, `card_type`

- [ ] **Step 1: Check migration high-water mark**

```bash
ls migrations/ | grep -E '^[0-9]+' | sort | tail -3
```

Expect the highest prefix is `0235`. Next free is `0236`.

- [ ] **Step 2: Create the migration file**

Create `migrations/0236_aos_id_capture.sql`:

```sql
-- 0236_aos_id_capture.sql
-- AoS ID capture: full AAMVA data, persons integration, front/back ID photos.
--
-- serve_receipts: 5 new columns (FK to persons, AAMVA snapshot, scan method, R2 keys)
-- serve_receipt_persons: new junction table linking receipts to person records
-- persons_ext: 8 new columns for lesser-known AAMVA fields

-- ── serve_receipts additions ────────────────────────────────
ALTER TABLE serve_receipts ADD COLUMN recipient_person_id INTEGER
  REFERENCES persons(id);
ALTER TABLE serve_receipts ADD COLUMN recipient_aamva_json TEXT;
ALTER TABLE serve_receipts ADD COLUMN id_scan_method TEXT;
ALTER TABLE serve_receipts ADD COLUMN id_front_r2_key TEXT;
ALTER TABLE serve_receipts ADD COLUMN id_back_r2_key TEXT;

-- ── serve_receipt_persons junction ──────────────────────────
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

-- ── persons_ext: lesser-known AAMVA fields ──────────────────
ALTER TABLE persons_ext ADD COLUMN place_of_birth TEXT;
ALTER TABLE persons_ext ADD COLUMN name_prefix TEXT;
ALTER TABLE persons_ext ADD COLUMN is_veteran INTEGER;
ALTER TABLE persons_ext ADD COLUMN non_resident_indicator INTEGER;
ALTER TABLE persons_ext ADD COLUMN limited_duration_doc INTEGER;
ALTER TABLE persons_ext ADD COLUMN card_revision_date TEXT;
ALTER TABLE persons_ext ADD COLUMN dl_hazmat_expiry TEXT;
ALTER TABLE persons_ext ADD COLUMN card_type TEXT;
```

- [ ] **Step 3: Test locally**

```bash
npm run migrate:local
```

Expected: migration applies without error.

- [ ] **Step 4: Commit**

```bash
git add migrations/0236_aos_id_capture.sql
git commit -m "feat(db): AoS ID capture schema — receipts, persons junction, AAMVA ext fields"
```

---

### Task 2: AAMVA Parser — Extract Additional Named Fields

**Files:**
- Modify: `client/src/utils/aamvaParser.ts:15-50` (AamvaResult interface)
- Modify: `client/src/utils/aamvaParser.ts:267-301` (parseAamva result assembly)
- Test: `client/src/utils/__tests__/aamvaParser.test.ts` (create if not exists, or add to existing)

**Interfaces:**
- Consumes: existing `AamvaResult` interface, `ELEMENT_LABELS` dictionary
- Produces: `AamvaResult` with new fields: `place_of_birth: string`, `race: string`, `name_prefix: string`, `card_revision_date: string`, `dl_hazmat_expiry: string`, `non_resident_indicator: boolean | null`, `limited_duration_doc: boolean | null`, `audit_info: string`

- [ ] **Step 1: Write the failing test**

Check if a test file exists:
```bash
ls client/src/utils/__tests__/aamvaParser* 2>/dev/null || echo "none"
```

Create or append to the test file `client/src/utils/__tests__/aamvaParser.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseAamva } from '../aamvaParser';

describe('parseAamva — additional AAMVA fields', () => {
  // Minimal valid AAMVA v9 payload with the new elements
  const raw = [
    '@\n\x1e\rANSI 636040090002DL00410278ZU03410024DLDCI Salt Lake City',
    'DCLDBB01151990DBCSalt Lake',
    'DCS PETERSON',
    'DACANDREW',
    'DADSCOTT',
    'DBB01151990',
    'DBC1',
    'DAYBRN',
    'DAZBRO',
    'DAU510',
    'DAW180',
    'DAGTEST ST',
    'DAISLC',
    'DAJUT',
    'DAK84101',
    'DAQ123456789',
    'DBA01152030',
    'DBD01152020',
    'DCINew York',
    'DCLW',
    'DAFMr',
    'DDB01152023',
    'DDC01152025',
    'DBI1',
    'DDD1',
    'DCJAUDIT123',
  ].join('\r');

  it('extracts place_of_birth from DCI', () => {
    const r = parseAamva(raw);
    expect(r.place_of_birth).toBe('New York');
  });

  it('extracts race from DCL', () => {
    const r = parseAamva(raw);
    expect(r.race).toBe('White');
  });

  it('extracts name_prefix from DAF', () => {
    const r = parseAamva(raw);
    expect(r.name_prefix).toBe('Mr');
  });

  it('extracts card_revision_date from DDB', () => {
    const r = parseAamva(raw);
    expect(r.card_revision_date).toBeTruthy();
  });

  it('extracts dl_hazmat_expiry from DDC', () => {
    const r = parseAamva(raw);
    expect(r.dl_hazmat_expiry).toBeTruthy();
  });

  it('extracts non_resident_indicator from DBI', () => {
    const r = parseAamva(raw);
    expect(r.non_resident_indicator).toBe(true);
  });

  it('extracts limited_duration_doc from DDD', () => {
    const r = parseAamva(raw);
    expect(r.limited_duration_doc).toBe(true);
  });

  it('extracts audit_info from DCJ', () => {
    const r = parseAamva(raw);
    expect(r.audit_info).toBe('AUDIT123');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd client && npx vitest run src/utils/__tests__/aamvaParser.test.ts
```

Expected: FAIL — `place_of_birth`, `race`, etc. do not exist on `AamvaResult`.

- [ ] **Step 3: Add new fields to AamvaResult interface**

In `client/src/utils/aamvaParser.ts`, add these fields after `raw_elements` (line ~49):

```ts
  place_of_birth: string;
  race: string;
  name_prefix: string;
  card_revision_date: string;
  dl_hazmat_expiry: string;
  non_resident_indicator: boolean | null;
  limited_duration_doc: boolean | null;
  audit_info: string;
```

- [ ] **Step 4: Add RACE_MAP after HAIR_MAP (~line 64)**

```ts
const RACE_MAP: Record<string, string> = {
  AP: 'Asian or Pacific Islander', BK: 'Black', H: 'Hispanic',
  AI: 'American Indian / Alaskan Native', W: 'White', U: 'Unknown',
};
```

- [ ] **Step 5: Populate new fields in parseAamva result assembly (~line 298)**

Add these lines before the `raw_elements` line in the result object:

```ts
    place_of_birth: clean(elements.DCI),
    race: RACE_MAP[clean(elements.DCL)] || clean(elements.DCL),
    name_prefix: clean(elements.DAF),
    card_revision_date: date(elements.DDB),
    dl_hazmat_expiry: date(elements.DDC),
    non_resident_indicator: flag(elements.DBI),
    limited_duration_doc: flag(elements.DDD),
    audit_info: clean(elements.DCJ),
```

- [ ] **Step 6: Run test to verify it passes**

```bash
cd client && npx vitest run src/utils/__tests__/aamvaParser.test.ts
```

Expected: all new tests PASS.

- [ ] **Step 7: Run full client test suite**

```bash
cd client && npx vitest run
```

Expected: all tests pass, no regressions.

- [ ] **Step 8: Commit**

```bash
git add client/src/utils/aamvaParser.ts client/src/utils/__tests__/aamvaParser.test.ts
git commit -m "feat(aamva): extract place_of_birth, race, name_prefix, and 5 more AAMVA fields"
```

---

### Task 3: Server — validPageImage, validIdPhoto, Person Upsert Helper

**Files:**
- Modify: `src/routes/serveReceipt.ts:67` (add `MAX_PAGE_IMAGE_BYTES` constant)
- Modify: `src/routes/serveReceipt.ts:159-169` (add `validPageImage` and `validIdPhoto` after `validSignature`)
- Create: `src/utils/serveReceiptPersons.ts` (person match + upsert + R2 photo storage)
- Modify: `src/routes/records.ts:272-282` (add new `persons_ext` columns to `PERSON_EXT_COLUMNS`)
- Test: `tests/serveReceiptPersons.test.ts`

**Interfaces:**
- Consumes: `getDb`, `query`, `queryFirst`, `execute` from `src/utils/db.ts`; `writePersonExt` from `src/routes/records.ts` (note: this is not currently exported — will need to export it or duplicate the helper)
- Produces:
  - `validPageImage(v: unknown): v is string` — same as `validSignature` but 2MB cap
  - `validIdPhoto(v: unknown): v is string` — PNG/JPEG data URL, > 100 bytes, ≤ 2MB
  - `upsertPersonFromAos(db, env, data: AosPersonData): Promise<{ personId: number; created: boolean }>` — matches by DL# then name+DOB, creates or enriches, returns the person ID
  - `storeIdPhotos(env, receiptId: number, front: string | null, back: string | null): Promise<{ frontKey: string | null; backKey: string | null }>` — writes base64 images to R2, returns keys

- [ ] **Step 1: Write failing tests for validPageImage and validIdPhoto**

Create `tests/serveReceiptValidation.test.ts`:

```ts
import { describe, it, expect } from 'vitest';

// These will be extracted as exported functions; for now test via import
// once they exist. The test validates the boundary behavior.
describe('validPageImage', () => {
  it('accepts a JPEG data URL under 2MB', async () => {
    const { validPageImage } = await import('../src/routes/serveReceipt');
    const small = 'data:image/jpeg;base64,' + 'A'.repeat(200);
    expect(validPageImage(small)).toBe(true);
  });

  it('rejects a data URL over 2MB', async () => {
    const { validPageImage } = await import('../src/routes/serveReceipt');
    const big = 'data:image/jpeg;base64,' + 'A'.repeat(2_100_000);
    expect(validPageImage(big)).toBe(false);
  });

  it('rejects SVG (XSS vector)', async () => {
    const { validPageImage } = await import('../src/routes/serveReceipt');
    const svg = 'data:image/svg+xml;base64,' + btoa('<svg></svg>');
    expect(validPageImage(svg)).toBe(false);
  });
});

describe('validIdPhoto', () => {
  it('accepts a PNG data URL under 2MB', async () => {
    const { validIdPhoto } = await import('../src/routes/serveReceipt');
    const small = 'data:image/png;base64,' + 'A'.repeat(200);
    expect(validIdPhoto(small)).toBe(true);
  });

  it('rejects non-string input', async () => {
    const { validIdPhoto } = await import('../src/routes/serveReceipt');
    expect(validIdPhoto(null)).toBe(false);
    expect(validIdPhoto(42)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/serveReceiptValidation.test.ts
```

Expected: FAIL — `validPageImage` and `validIdPhoto` are not exported.

- [ ] **Step 3: Add validPageImage and validIdPhoto to serveReceipt.ts**

After `MAX_SIGNATURE_BYTES` (line 67), add:

```ts
const MAX_PAGE_IMAGE_BYTES = 2_000_000;
const MAX_ID_PHOTO_BYTES = 2_000_000;
```

After `validSignature` (line 169), add and export:

```ts
export function validPageImage(v: unknown): v is string {
  return typeof v === 'string'
    && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(v)
    && v.length > 100
    && v.length <= MAX_PAGE_IMAGE_BYTES
    && decodesToImage(v);
}

export function validIdPhoto(v: unknown): v is string {
  return typeof v === 'string'
    && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(v)
    && v.length > 100
    && v.length <= MAX_ID_PHOTO_BYTES
    && decodesToImage(v);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/serveReceiptValidation.test.ts
```

Expected: PASS.

- [ ] **Step 5: Add new persons_ext columns to PERSON_EXT_COLUMNS in records.ts**

In `src/routes/records.ts` at line ~281, after `'raw_aamva_elements',` add:

```ts
  // AoS ID capture — additional AAMVA fields (mig 0236)
  'place_of_birth', 'name_prefix', 'is_veteran', 'non_resident_indicator',
  'limited_duration_doc', 'card_revision_date', 'dl_hazmat_expiry', 'card_type',
```

- [ ] **Step 6: Export writePersonExt from records.ts**

Change `async function writePersonExt(` (line 292) to `export async function writePersonExt(`. Also export `mergePersonExt` the same way.

- [ ] **Step 7: Create src/utils/serveReceiptPersons.ts**

```ts
import { getDb, queryFirst, execute } from './db';
import { writePersonExt } from '../routes/records';
import { log } from './logger';

export interface AosPersonData {
  first_name: string;
  last_name: string;
  middle_name?: string | null;
  suffix?: string | null;
  name_prefix?: string | null;
  dob?: string | null;
  gender?: string | null;
  race?: string | null;
  height?: string | null;
  weight?: string | null;
  eye_color?: string | null;
  hair_color?: string | null;
  address?: string | null;
  address2?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  phone?: string | null;
  email?: string | null;
  dl_number?: string | null;
  dl_state?: string | null;
  dl_class?: string | null;
  dl_expiry?: string | null;
  dl_issue_date?: string | null;
  dl_restrictions?: string | null;
  dl_endorsements?: string | null;
  country?: string | null;
  document_discriminator?: string | null;
  is_real_id?: boolean | null;
  is_organ_donor?: boolean | null;
  is_veteran?: boolean | null;
  under_18_until?: string | null;
  under_21_until?: string | null;
  aamva_version?: number | null;
  issuer_id?: string | null;
  place_of_birth?: string | null;
  non_resident_indicator?: boolean | null;
  limited_duration_doc?: boolean | null;
  card_revision_date?: string | null;
  dl_hazmat_expiry?: string | null;
  card_type?: string | null;
  raw_aamva_elements?: Record<string, string> | null;
}

const boolToInt = (v: unknown): number | null => (v == null ? null : (v ? 1 : 0));

export async function upsertPersonFromAos(
  db: ReturnType<typeof getDb>,
  data: AosPersonData,
): Promise<{ personId: number; created: boolean }> {
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

  // Match order: DL# first, then name+DOB
  let person: Record<string, unknown> | null = null;
  if (data.dl_number) {
    person = await queryFirst<Record<string, unknown>>(db,
      'SELECT * FROM persons WHERE dl_number = ? LIMIT 1', data.dl_number);
  }
  if (!person && data.dob) {
    person = await queryFirst<Record<string, unknown>>(db,
      `SELECT * FROM persons WHERE lower(first_name) = lower(?) AND lower(last_name) = lower(?) AND dob = ? LIMIT 1`,
      data.first_name, data.last_name, data.dob);
  }

  if (person) {
    // FILL-ONLY: COALESCE(existing, new) for most fields.
    // Exception: physical description from govt ID overwrites.
    const fills: string[] = [];
    const overwrites: string[] = [];
    const params: unknown[] = [];

    const fillField = (col: string, val: unknown) => {
      if (val == null) return;
      fills.push(`${col} = COALESCE(NULLIF(${col}, ''), ?)`);
      params.push(val);
    };
    const overwriteField = (col: string, val: unknown) => {
      if (val == null) return;
      overwrites.push(`${col} = ?`);
      params.push(val);
    };

    fillField('first_name', str(data.first_name));
    fillField('middle_name', str(data.middle_name));
    fillField('last_name', str(data.last_name));
    fillField('dob', str(data.dob));
    fillField('address', str(data.address));
    fillField('phone', str(data.phone));
    fillField('email', str(data.email));
    fillField('dl_number', str(data.dl_number));
    fillField('dl_state', str(data.dl_state));
    fillField('dl_class', str(data.dl_class));
    fillField('dl_expiry', str(data.dl_expiry));
    fillField('race', str(data.race));

    // Physical description from govt ID is authoritative — overwrites
    overwriteField('gender', str(data.gender));
    overwriteField('height', str(data.height));
    overwriteField('weight', str(data.weight));
    overwriteField('eye_color', str(data.eye_color));
    overwriteField('hair_color', str(data.hair_color));

    const sets = [...fills, ...overwrites];
    if (sets.length > 0) {
      params.push(person.id);
      await execute(db,
        `UPDATE persons SET ${sets.join(', ')} WHERE id = ?`,
        ...params);
    }

    // Write ext fields
    await writePersonExt(db, Number(person.id), {
      suffix: str(data.suffix),
      name_prefix: str(data.name_prefix),
      dl_restrictions: str(data.dl_restrictions),
      dl_endorsements: str(data.dl_endorsements),
      dl_issue_date: str(data.dl_issue_date),
      country: str(data.country),
      document_discriminator: str(data.document_discriminator),
      is_real_id: boolToInt(data.is_real_id),
      is_organ_donor: boolToInt(data.is_organ_donor),
      is_veteran: boolToInt(data.is_veteran),
      under_18_until: str(data.under_18_until),
      under_21_until: str(data.under_21_until),
      aamva_version: data.aamva_version ?? null,
      issuer_id: str(data.issuer_id),
      address2: str(data.address2),
      place_of_birth: str(data.place_of_birth),
      non_resident_indicator: boolToInt(data.non_resident_indicator),
      limited_duration_doc: boolToInt(data.limited_duration_doc),
      card_revision_date: str(data.card_revision_date),
      dl_hazmat_expiry: str(data.dl_hazmat_expiry),
      card_type: str(data.card_type),
      raw_aamva_elements: data.raw_aamva_elements ?? null,
    });

    return { personId: Number(person.id), created: false };
  }

  // Create new person
  const result = await execute(db, `
    INSERT INTO persons (first_name, middle_name, last_name, dob, gender, race,
      height, weight, eye_color, hair_color, address, city, state, zip, phone, email,
      dl_number, dl_state, dl_class, dl_expiry, is_veteran, flags, notes, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, datetime('now'))`,
    data.first_name, str(data.middle_name), data.last_name, str(data.dob),
    str(data.gender), str(data.race), str(data.height), str(data.weight),
    str(data.eye_color), str(data.hair_color), str(data.address),
    str(data.city), str(data.state), str(data.zip), str(data.phone), str(data.email),
    str(data.dl_number), str(data.dl_state), str(data.dl_class), str(data.dl_expiry),
    boolToInt(data.is_veteran),
    JSON.stringify(['aos_id_capture']), 'Created from AoS ID capture');
  const newPersonId = Number(result.meta.last_row_id);

  await writePersonExt(db, newPersonId, {
    suffix: str(data.suffix),
    name_prefix: str(data.name_prefix),
    dl_restrictions: str(data.dl_restrictions),
    dl_endorsements: str(data.dl_endorsements),
    dl_issue_date: str(data.dl_issue_date),
    country: str(data.country),
    document_discriminator: str(data.document_discriminator),
    is_real_id: boolToInt(data.is_real_id),
    is_organ_donor: boolToInt(data.is_organ_donor),
    is_veteran: boolToInt(data.is_veteran),
    under_18_until: str(data.under_18_until),
    under_21_until: str(data.under_21_until),
    aamva_version: data.aamva_version ?? null,
    issuer_id: str(data.issuer_id),
    address2: str(data.address2),
    place_of_birth: str(data.place_of_birth),
    non_resident_indicator: boolToInt(data.non_resident_indicator),
    limited_duration_doc: boolToInt(data.limited_duration_doc),
    card_revision_date: str(data.card_revision_date),
    dl_hazmat_expiry: str(data.dl_hazmat_expiry),
    card_type: str(data.card_type),
    raw_aamva_elements: data.raw_aamva_elements ?? null,
  });

  return { personId: newPersonId, created: true };
}

export async function storeIdPhotos(
  env: { UPLOADS?: R2Bucket },
  receiptId: number,
  front: string | null,
  back: string | null,
): Promise<{ frontKey: string | null; backKey: string | null }> {
  if (!env.UPLOADS) {
    log.warn('UPLOADS R2 bucket not bound — ID photos not stored', { receiptId });
    return { frontKey: null, backKey: null };
  }

  const store = async (dataUrl: string, side: string): Promise<string> => {
    const match = dataUrl.match(/^data:image\/(png|jpeg);base64,(.+)$/);
    if (!match) throw new Error(`Invalid ${side} photo data URL`);
    const [, ext, b64] = match;
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const key = `serve-receipts/${receiptId}/id-${side}.${ext === 'jpeg' ? 'jpg' : 'png'}`;
    await env.UPLOADS.put(key, bytes, {
      httpMetadata: { contentType: `image/${ext}` },
    });
    return key;
  };

  const frontKey = front ? await store(front, 'front').catch((e) => {
    log.error('Failed to store ID front photo', { receiptId }, e as Error);
    return null;
  }) : null;

  const backKey = back ? await store(back, 'back').catch((e) => {
    log.error('Failed to store ID back photo', { receiptId }, e as Error);
    return null;
  }) : null;

  return { frontKey, backKey };
}

export async function linkReceiptToPerson(
  db: ReturnType<typeof getDb>,
  receiptId: number,
  personId: number,
  role: 'recipient' | 'subject',
  scanMethod: string | null,
  frontKey: string | null,
  backKey: string | null,
): Promise<void> {
  await execute(db,
    `INSERT OR IGNORE INTO serve_receipt_persons
       (receipt_id, person_id, role, id_scan_method, id_front_r2_key, id_back_r2_key)
     VALUES (?, ?, ?, ?, ?, ?)`,
    receiptId, personId, role, scanMethod, frontKey, backKey);
}
```

- [ ] **Step 8: Run tests**

```bash
npx vitest run tests/serveReceiptValidation.test.ts
npm run typecheck
```

Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add src/routes/serveReceipt.ts src/utils/serveReceiptPersons.ts src/routes/records.ts tests/serveReceiptValidation.test.ts
git commit -m "feat(server): validPageImage, validIdPhoto, person upsert helper for AoS"
```

---

### Task 4: Server — Wire ID Capture into Public and Paper Routes

**Files:**
- Modify: `src/routes/serveReceipt.ts:320-336` (expand `ServeReceiptSubmission` interface)
- Modify: `src/routes/serveReceipt.ts:367-408` (relax `validateReceiptSubmission` — ID scan OR manual entry)
- Modify: `src/routes/serveReceipt.ts:575-820` (public POST — accept ID data, upsert person, store photos)
- Modify: `src/routes/serveReceipt.ts:1361-1460` (paper POST — use `validPageImage`, accept ID data)

**Interfaces:**
- Consumes: `upsertPersonFromAos`, `storeIdPhotos`, `linkReceiptToPerson` from `src/utils/serveReceiptPersons.ts`; `validPageImage`, `validIdPhoto` from this file
- Produces: updated public POST response includes `person_id`; paper POST accepts page images up to 2MB

- [ ] **Step 1: Expand ServeReceiptSubmission to accept ID data**

At `src/routes/serveReceipt.ts:320`, add to the `ServeReceiptSubmission` interface:

```ts
  id_scan_method: 'barcode' | 'manual' | null;
  aamva_data: Record<string, unknown> | null;
  manual_id: Record<string, unknown> | null;
  id_front_image: unknown;
  id_back_image: unknown;
  recipient_address_current: Record<string, unknown> | null;
  recipient_relationship: string | null;
```

- [ ] **Step 2: Relax validateReceiptSubmission**

At line 376, change:
```ts
  if (!s.recipient_id_verified) return 'A scanned photo ID is required';
```
to:
```ts
  // ID verified via barcode scan OR manual entry with at least a front photo
  if (!s.recipient_id_verified && s.id_scan_method !== 'manual') {
    return 'Please scan your ID or enter your information manually';
  }
```

- [ ] **Step 3: Wire ID data into public POST route**

In the public POST handler (~line 620), after the `submission` object is built, add the new fields:

```ts
  const idScanMethod = str(body.id_scan_method, 20) as 'barcode' | 'manual' | null;
  const aamvaData = (typeof body.aamva_data === 'object' && body.aamva_data) ? body.aamva_data as Record<string, unknown> : null;
  const manualId = (typeof body.manual_id === 'object' && body.manual_id) ? body.manual_id as Record<string, unknown> : null;
  const idFrontImage = body.id_front_image;
  const idBackImage = body.id_back_image;
```

Update the submission object to include the new fields.

After the receipt INSERT succeeds (after `const receiptId = Number(ins.meta.last_row_id);` at line 725), add the person upsert and photo storage in a `waitUntil` block:

```ts
  // Person upsert + ID photo storage — fire-and-forget via waitUntil.
  // A failure here must NOT block the receipt response: the signer is
  // standing at a door and the signature is the legally operative event.
  c.executionCtx.waitUntil((async () => {
    try {
      const idData = aamvaData ?? manualId;
      if (!idData) return;

      const firstName = str(idData.first_name, 100);
      const lastName = str(idData.last_name, 100);
      if (!firstName || !lastName) return;

      const { personId, created } = await upsertPersonFromAos(db, {
        first_name: firstName,
        last_name: lastName,
        middle_name: str(idData.middle_name, 100),
        suffix: str(idData.suffix, 20),
        name_prefix: str(idData.name_prefix, 20),
        dob: str(idData.date_of_birth, 10) || str(idData.dob, 10),
        gender: str(idData.gender, 20),
        race: str(idData.race, 40),
        height: str(idData.height, 20),
        weight: str(idData.weight, 20),
        eye_color: str(idData.eye_color, 30),
        hair_color: str(idData.hair_color, 30),
        address: str(idData.address, 200),
        address2: str(idData.address2, 100),
        city: str(idData.city, 100),
        state: str(idData.state, 2),
        zip: str(idData.zip, 10),
        phone: str(body.recipient_phone, 40),
        email: str(body.recipient_email, 254),
        dl_number: str(idData.dl_number, 30),
        dl_state: str(idData.dl_state, 5),
        dl_class: str(idData.dl_class, 10),
        dl_expiry: str(idData.dl_expiry, 10),
        dl_issue_date: str(idData.dl_issue_date, 10),
        dl_restrictions: str(idData.dl_restrictions, 100),
        dl_endorsements: str(idData.dl_endorsements, 100),
        country: str(idData.country, 10),
        document_discriminator: str(idData.document_discriminator, 60),
        is_real_id: idData.is_real_id as boolean | null,
        is_organ_donor: idData.is_organ_donor as boolean | null,
        is_veteran: idData.is_veteran as boolean | null,
        under_18_until: str(idData.under_18_until, 10),
        under_21_until: str(idData.under_21_until, 10),
        aamva_version: typeof idData.aamva_version === 'number' ? idData.aamva_version : null,
        issuer_id: str(idData.issuer_id, 10),
        place_of_birth: str(idData.place_of_birth, 100),
        non_resident_indicator: idData.non_resident_indicator as boolean | null,
        limited_duration_doc: idData.limited_duration_doc as boolean | null,
        card_revision_date: str(idData.card_revision_date, 10),
        dl_hazmat_expiry: str(idData.dl_hazmat_expiry, 10),
        card_type: str(idData.card_type, 10),
        raw_aamva_elements: idData.raw_elements as Record<string, string> | null,
      });

      const frontPhoto = validIdPhoto(idFrontImage) ? (idFrontImage as string) : null;
      const backPhoto = validIdPhoto(idBackImage) ? (idBackImage as string) : null;
      const { frontKey, backKey } = await storeIdPhotos(c.env, receiptId, frontPhoto, backPhoto);

      // Update receipt with person link and R2 keys
      await execute(db,
        `UPDATE serve_receipts SET
           recipient_person_id = ?, recipient_aamva_json = ?,
           id_scan_method = ?, id_front_r2_key = ?, id_back_r2_key = ?
         WHERE id = ?`,
        personId, aamvaData ? JSON.stringify(aamvaData) : null,
        idScanMethod, frontKey, backKey, receiptId);

      await linkReceiptToPerson(db, receiptId, personId, 'recipient', idScanMethod, frontKey, backKey);

      // Also link person to the serve job
      await execute(db,
        `INSERT OR IGNORE INTO serve_queue_persons (serve_queue_id, person_id, role)
         VALUES (?, ?, 'recipient')`,
        tok.serve_queue_id, personId);

      log.info('AoS person upsert complete', { receiptId, personId, created, scanMethod: idScanMethod });
    } catch (err) {
      log.error('AoS person upsert failed', { receiptId }, err as Error);
    }
  })());
```

- [ ] **Step 4: Fix paper route to use validPageImage**

At `src/routes/serveReceipt.ts:1399`, change:
```ts
    if (!validSignature(pageImage)) {
```
to:
```ts
    if (!validPageImage(pageImage)) {
```

- [ ] **Step 5: Add import for the new helpers at the top of serveReceipt.ts**

```ts
import { upsertPersonFromAos, storeIdPhotos, linkReceiptToPerson } from '../utils/serveReceiptPersons';
```

- [ ] **Step 6: Run typecheck and tests**

```bash
npm run typecheck
npx vitest run
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/routes/serveReceipt.ts src/utils/serveReceiptPersons.ts
git commit -m "feat(server): wire AoS ID capture into public and paper routes"
```

---

### Task 5: Client — Barcode Scanner Diagnostics + Manual ID Fallback

**Files:**
- Modify: `client/src/utils/pdf417Decoder.ts:19-29` (add diagnostic logging to `ensureModule`)
- Modify: `client/src/pages/mobile/ServeReceiptPage.tsx:201-218` (add state for manual ID, front/back photos, AAMVA data)
- Modify: `client/src/pages/mobile/ServeReceiptPage.tsx:446-465` (relax `fieldErrors.id` validation)
- Modify: `client/src/pages/mobile/ServeReceiptPage.tsx:503-524` (expand `scanId` to store full AAMVA result)
- Modify: `client/src/pages/mobile/ServeReceiptPage.tsx:595-634` (expand submit payload)
- Modify: `client/src/pages/mobile/ServeReceiptPage.tsx` (add ID capture section to the JSX)

**Interfaces:**
- Consumes: `decodePdf417` from `client/src/utils/pdf417Decoder.ts`; `parseAamva`, `AamvaResult` from `client/src/utils/aamvaParser.ts`
- Produces: updated submit payload includes `id_scan_method`, `aamva_data`, `manual_id`, `id_front_image`, `id_back_image`, `recipient_address_current`, `recipient_relationship`

This is the largest task. The steps below are ordered to keep each edit self-contained.

- [ ] **Step 1: Add WASM diagnostic logging to pdf417Decoder.ts**

In `client/src/utils/pdf417Decoder.ts`, change `ensureModule()` (lines 20-29):

```ts
let prepared = false;
let moduleError: string | null = null;

function ensureModule(): void {
  if (prepared) return;
  prepared = true;
  try {
    prepareZXingModule({
      overrides: {
        locateFile: (path: string, prefix: string) =>
          path.endsWith('.wasm') ? wasmUrl : prefix + path,
      },
    });
  } catch (err) {
    moduleError = (err as Error)?.message ?? String(err);
    console.error('[pdf417] WASM module init failed:', err);
  }
}

export function getModuleError(): string | null {
  ensureModule();
  return moduleError;
}
```

- [ ] **Step 2: Add new state variables to ServeReceiptPage.tsx**

After line 218 (`const [idDescription, setIdDescription] = useState('');`), add:

```tsx
  const [idManualMode, setIdManualMode] = useState(false);
  const [aamvaResult, setAamvaResult] = useState<Record<string, unknown> | null>(null);
  const [manualFirstName, setManualFirstName] = useState('');
  const [manualLastName, setManualLastName] = useState('');
  const [manualMiddleName, setManualMiddleName] = useState('');
  const [manualDob, setManualDob] = useState('');
  const [manualDlNumber, setManualDlNumber] = useState('');
  const [manualDlState, setManualDlState] = useState('');
  const [manualGender, setManualGender] = useState('');
  const [manualHeight, setManualHeight] = useState('');
  const [manualWeight, setManualWeight] = useState('');
  const [manualEyeColor, setManualEyeColor] = useState('');
  const [manualHairColor, setManualHairColor] = useState('');
  const [idFrontImage, setIdFrontImage] = useState<string | null>(null);
  const [idBackImage, setIdBackImage] = useState<string | null>(null);
  const [idScanMethod, setIdScanMethod] = useState<'barcode' | 'manual' | null>(null);
  const [addressCurrent, setAddressCurrent] = useState(true);
  const [currentAddress, setCurrentAddress] = useState('');
  const [currentCity, setCurrentCity] = useState('');
  const [currentState, setCurrentState] = useState('');
  const [currentZip, setCurrentZip] = useState('');
```

- [ ] **Step 3: Update scanId callback to store full AAMVA result**

Replace the `scanId` callback (lines 503-524):

```tsx
  const scanId = useCallback(async (file: File) => {
    setIdScanning(true);
    setIdScanError(null);
    try {
      const outcome = await decodePdf417(file);
      if (!outcome) {
        setIdScanError('Could not read the barcode. You can enter your ID information manually below.');
        return;
      }
      const dl = parseAamva(outcome.text);
      const full = [dl.first_name, dl.middle_name, dl.last_name, dl.suffix]
        .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
      if (full) setRecipientName(full);
      setIdDescription([dl.gender, dl.race, dl.height, dl.weight && `${dl.weight} lbs`, dl.hair_color, dl.eye_color]
        .filter(Boolean).join(', '));
      setAamvaResult(dl as unknown as Record<string, unknown>);
      setIdScanMethod('barcode');
      setIdVerified(true);
    } catch (err) {
      console.error('[aos] barcode scan error:', err);
      setIdScanError('Could not read the barcode. You can enter your ID information manually below.');
    } finally {
      setIdScanning(false);
    }
  }, []);
```

- [ ] **Step 4: Add ID photo capture helper**

After the `scanId` callback, add:

```tsx
  const captureIdPhoto = useCallback((file: File, side: 'front' | 'back') => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        if (side === 'front') setIdFrontImage(dataUrl);
        else setIdBackImage(dataUrl);
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  }, []);
```

- [ ] **Step 5: Add manual ID completion handler**

```tsx
  const completeManualId = useCallback(() => {
    if (!manualFirstName.trim() || !manualLastName.trim()) return;
    const full = [manualFirstName, manualMiddleName, manualLastName]
      .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    setRecipientName(full);
    setIdDescription([manualGender, manualHeight, manualWeight && `${manualWeight} lbs`, manualHairColor, manualEyeColor]
      .filter(Boolean).join(', '));
    setIdScanMethod('manual');
    setIdVerified(true);
    setIdManualMode(false);
  }, [manualFirstName, manualMiddleName, manualLastName, manualGender, manualHeight, manualWeight, manualHairColor, manualEyeColor]);
```

- [ ] **Step 6: Relax fieldErrors.id validation**

Change line 459:
```ts
      id: !idVerified,
```
to:
```ts
      id: !idVerified && !idFrontImage,
```

This allows submission when either: barcode scanned, manual entry completed, or at minimum a front ID photo is captured.

- [ ] **Step 7: Update submit payload**

In the `submit` callback (~line 595), expand the `payload` object to include:

```ts
          id_scan_method: idScanMethod,
          aamva_data: aamvaResult,
          manual_id: idScanMethod === 'manual' ? {
            first_name: manualFirstName.trim(),
            last_name: manualLastName.trim(),
            middle_name: manualMiddleName.trim() || null,
            dob: manualDob || null,
            dl_number: manualDlNumber || null,
            dl_state: manualDlState || null,
            gender: manualGender || null,
            height: manualHeight || null,
            weight: manualWeight || null,
            eye_color: manualEyeColor || null,
            hair_color: manualHairColor || null,
          } : null,
          id_front_image: idFrontImage,
          id_back_image: idBackImage,
          recipient_address_current: !addressCurrent ? {
            address: currentAddress, city: currentCity,
            state: currentState, zip: currentZip,
          } : null,
```

- [ ] **Step 8: Add ID capture section to JSX**

After the "Who is signing" panel and before the attestations panel, add a new `<Panel>` for ID capture. This panel contains:
1. A file input for barcode photo scanning (existing, moved here)
2. An "Enter ID manually" button that shows when scan fails
3. Manual ID entry fields (name, DOB, DL#, state, physical description dropdowns)
4. Front and back ID photo capture buttons
5. Address confirmation section

The exact JSX will be substantial — the implementer should model it on the existing `Panel` component pattern used throughout the page, with the same `inputCls`, `Field`, `YesNo`, and `CheckRow` components.

Key UI requirements:
- Large touch targets (outdoor/doorstep use)
- The barcode scan button should be prominent at the top
- Manual entry should be clearly offered when scan fails, not hidden
- Front/back photo captures should use `accept="image/*" capture="environment"` for camera
- Physical description fields auto-fill from scan and display as read-only; in manual mode they are editable dropdowns
- Address confirmation: show ID address, ask "Is this your current address?", reveal edit fields on No

- [ ] **Step 9: Run client typecheck and tests**

```bash
cd client && npx tsc --noEmit && npx vitest run
```

Expected: all pass.

- [ ] **Step 10: Commit**

```bash
git add client/src/utils/pdf417Decoder.ts client/src/pages/mobile/ServeReceiptPage.tsx
git commit -m "feat(client): AoS ID capture — barcode diagnostics, manual fallback, front/back photos"
```

---

### Task 6: Client — Paper Form Route Fix + ID Data on Officer MDT

**Files:**
- Modify: `client/src/components/serve/ServeReceiptActions.tsx:421-436` (bump JPEG quality to 0.8)
- Modify: `client/src/components/serve/ServeReceiptActions.tsx:438-475` (add ID data fields to paper submission)

**Interfaces:**
- Consumes: `AosPersonData` shape from server (the same field names used in the paper POST body)
- Produces: paper submission includes ID data and passes `validPageImage` on the server (2MB cap)

- [ ] **Step 1: Bump readPageImage JPEG quality from 0.7 to 0.8**

In `client/src/components/serve/ServeReceiptActions.tsx:431`, change:
```ts
        setPaperImage(canvas.toDataURL('image/jpeg', 0.7));
```
to:
```ts
        setPaperImage(canvas.toDataURL('image/jpeg', 0.8));
```

- [ ] **Step 2: Run client tests**

```bash
cd client && npx vitest run
```

Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/serve/ServeReceiptActions.tsx
git commit -m "fix(client): bump paper form JPEG quality to 0.8 for text legibility"
```

---

### Task 7: PDF Generator — Add ID Data to Printed Forms

**Files:**
- Modify: `client/src/utils/servePdfGenerator.ts` (add recipient physical description block, DL info, ID verification method to all four form variants)

**Interfaces:**
- Consumes: `ReceiptOfServiceData` interface in `servePdfGenerator.ts` — needs new optional fields for physical description, DL data, ID scan method, ID photo thumbnail
- Produces: updated PDF output with ID data section

- [ ] **Step 1: Read the current ReceiptOfServiceData interface**

```bash
grep -n 'ReceiptOfServiceData' client/src/utils/servePdfGenerator.ts | head -5
```

- [ ] **Step 2: Add new fields to ReceiptOfServiceData**

Add after the existing fields:

```ts
  recipientGender?: string;
  recipientRace?: string;
  recipientHeight?: string;
  recipientWeight?: string;
  recipientHairColor?: string;
  recipientEyeColor?: string;
  recipientDlNumber?: string;
  recipientDlState?: string;
  recipientDlClass?: string;
  recipientDlExpiry?: string;
  recipientIsRealId?: boolean | null;
  idScanMethod?: 'barcode' | 'manual' | null;
  idFrontThumbnail?: string;
```

- [ ] **Step 3: Add physical description + DL block to the PDF generation function**

In the `generateReceiptOfService` function, after the recipient name/contact section and before the attestations section, add a new section:

```ts
  // ── Recipient Identification ──────────────────────────────
  if (data.recipientDlNumber || data.recipientGender || data.idScanMethod) {
    openAutoSection(doc, 'RECIPIENT IDENTIFICATION');

    if (data.idScanMethod) {
      addFieldPair(doc, 'ID Verification',
        data.idScanMethod === 'barcode' ? 'Barcode scanned (PDF417)' : 'Manually entered',
        '', '');
    }

    if (data.recipientDlNumber) {
      addFieldPair(doc, 'DL/ID Number', data.recipientDlNumber,
        'Issuing State', data.recipientDlState || '');
      addFieldPair(doc, 'DL Class', data.recipientDlClass || '',
        'Expiry', data.recipientDlExpiry || '');
      if (data.recipientIsRealId != null) {
        addFieldPair(doc, 'REAL ID', data.recipientIsRealId ? 'Yes' : 'No', '', '');
      }
    }

    const descParts = [
      data.recipientGender, data.recipientRace,
      data.recipientHeight, data.recipientWeight ? `${data.recipientWeight} lbs` : null,
      data.recipientHairColor ? `${data.recipientHairColor} hair` : null,
      data.recipientEyeColor ? `${data.recipientEyeColor} eyes` : null,
    ].filter(Boolean);
    if (descParts.length) {
      addFieldPair(doc, 'Physical Description', descParts.join(', '), '', '');
    }

    closeAutoSection(doc);
  }
```

- [ ] **Step 4: Update buildPdfData in ServeReceiptPage.tsx to pass the new fields**

In `ServeReceiptPage.tsx`, expand the `buildPdfData` callback to include the new AAMVA fields from `aamvaResult` or manual entry state.

- [ ] **Step 5: Run client build to ensure PDF generation doesn't break**

```bash
cd client && npx vite build
```

Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add client/src/utils/servePdfGenerator.ts client/src/pages/mobile/ServeReceiptPage.tsx
git commit -m "feat(pdf): add recipient ID data, physical description, and DL info to AoS PDF"
```

---

### Task 8: Admin Route — ID Photo Retrieval

**Files:**
- Modify: `src/routes/serveReceipt.ts` (add `GET /:id/id-photo/:side` to `serveReceiptAdmin`)

**Interfaces:**
- Consumes: `serve_receipts.id_front_r2_key` / `id_back_r2_key` columns; `UPLOADS` R2 binding
- Produces: `GET /api/serve-receipts/:id/id-photo/:side` returns a redirect to a signed R2 URL or the image bytes directly

- [ ] **Step 1: Add the route to serveReceiptAdmin**

After the existing admin routes in `serveReceipt.ts`, add:

```ts
serveReceiptAdmin.get(
  '/:id/id-photo/:side',
  requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'),
  async (c) => {
    const id = parseInt(c.req.param('id') || '', 10);
    const side = c.req.param('side');
    if (!id || (side !== 'front' && side !== 'back')) {
      return c.json({ error: 'Invalid request' }, 400);
    }

    const col = side === 'front' ? 'id_front_r2_key' : 'id_back_r2_key';
    const row = await queryFirst<{ key: string | null }>(
      getDb(c.env),
      `SELECT ${col} as key FROM serve_receipts WHERE id = ?`,
      id,
    );
    if (!row?.key) return c.json({ error: 'No ID photo found' }, 404);

    const uploads = c.env.UPLOADS as R2Bucket | undefined;
    if (!uploads) return c.json({ error: 'Storage not configured' }, 503);

    const obj = await uploads.get(row.key);
    if (!obj) return c.json({ error: 'Photo not found in storage' }, 404);

    return new Response(obj.body, {
      headers: {
        'Content-Type': obj.httpMetadata?.contentType || 'image/jpeg',
        'Cache-Control': 'private, max-age=300',
      },
    });
  },
);
```

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add src/routes/serveReceipt.ts
git commit -m "feat(server): admin route to retrieve AoS ID photos from R2"
```

---

### Task 9: Integration Testing & Final Verification

**Files:**
- Run: all test suites
- Run: typecheck for both worker and client

- [ ] **Step 1: Run worker typecheck**

```bash
npm run typecheck
```

- [ ] **Step 2: Run worker tests**

```bash
npx vitest run
```

- [ ] **Step 3: Run client typecheck**

```bash
cd client && npx tsc --noEmit
```

- [ ] **Step 4: Run client tests**

```bash
cd client && npx vitest run
```

- [ ] **Step 5: Run client build**

```bash
cd client && npx vite build
```

- [ ] **Step 6: Verify no regressions**

All steps must pass with zero failures. Any failure is caused by these changes (baseline is clean as of 2026-07-24).

- [ ] **Step 7: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: integration test fixes for AoS ID capture"
```
