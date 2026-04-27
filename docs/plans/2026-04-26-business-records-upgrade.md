# Business Records Upgrade Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Bring the Records → Business module to feature parity with Persons — enabling Business to fill any role on a call/incident, surface in a unified Subject picker, and present an operationally rich dossier — across 3 independently-deployable PRs.

**Architecture:** Three new junction tables (`incident_businesses`, `call_businesses`, `business_persons`) + three enrichment tables (`business_vehicles`, `business_visits`, `business_photos`) + 14 new columns on `businesses`. 18 new API routes mirroring Persons patterns. 13 new React components composing a 3-column dossier page. Unified `<SubjectPicker>` modal replacing `<PersonPicker>` in 5 locations.

**Tech Stack:** Express 5 + TypeScript (tsx) + better-sqlite3 + React 18 + TypeScript + Vite + Tailwind. Vitest for tests. Existing `auditLog`, `broadcastDispatchUpdate`, `useApi`, `useLiveSync` patterns reused throughout.

**Reference design:** `docs/plans/2026-04-26-business-records-upgrade-design.md`

---

## How to Use This Plan

Each PR is a discrete phase with its own deploy/rollback. **Do not start PR 2 tasks until PR 1 has merged AND deployed AND verified live.** The same applies between PR 2 and PR 3.

Within a PR, tasks are sequential — later tasks build on earlier ones. Each task uses TDD: write a failing test → verify it fails → implement → verify it passes → commit.

**Branching:**
- PR 1: `feat/business-records-backend`
- PR 2: `feat/business-detail-page`
- PR 3: `feat/unified-subject-picker`

Branch from latest `origin/main` for each PR.

**Pre-flight before starting:**

```bash
cd "/Users/rmpgutah/RMPG Flex"
git fetch origin
git status                                # expect clean
ssh root@194.113.64.90 "curl -sf https://localhost/api/health | head -c 100"  # confirm prod healthy
```

If prod is unhealthy, stop and stabilize before starting any PR.

**Important DDL pattern (CLAUDE.md Gotcha #42):** Use `db.prepare('CREATE TABLE ...').run()` for single-statement DDL. The better-sqlite3 bulk-execute shortcut method is blocked by the project's security hook. For multi-statement DDL, split into multiple `db.prepare().run()` calls or wrap in `db.transaction(() => { ... })()`. Examples in this plan follow that pattern.

---

# PHASE / PR 1 — Schema & Backend

**Branch:** `feat/business-records-backend`
**Estimate:** 2-3 days
**Bumps `CACHE_NAME`:** v448 → v449
**User-visible:** No (UI unchanged; backend ready)

### Task 1.0: Branch setup

**Step 1:** Branch from main

```bash
cd "/Users/rmpgutah/RMPG Flex"
git fetch origin
git checkout -b feat/business-records-backend origin/main
```

**Step 2:** Confirm clean baseline

```bash
cd server && npx vitest run 2>&1 | tail -5
```
Expected: all tests pass (current baseline ~461).

**Step 3:** Commit empty branch marker

```bash
git commit --allow-empty -m "feat(business): start PR 1 — backend & schema"
```

---

### Task 1.1: Add `incident_businesses` table

**Files:**
- Modify: `server/src/models/database.ts` (after the `incident_persons` CREATE TABLE block — currently around line 770)
- Test: `server/__tests__/businessLinking.test.ts` (CREATE NEW)

**Step 1: Write the failing test**

```typescript
// server/__tests__/businessLinking.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { initDatabase, getDb } from '../src/models/database';

describe('incident_businesses table', () => {
  beforeEach(() => initDatabase(':memory:'));

  it('creates the table with expected columns', () => {
    const db = getDb();
    const cols = db.prepare("PRAGMA table_info(incident_businesses)").all() as any[];
    const names = cols.map(c => c.name).sort();
    expect(names).toEqual(['added_by','business_id','created_at','id','incident_id','notes','role'].sort());
  });

  it('enforces UNIQUE(incident_id, business_id)', () => {
    const db = getDb();
    db.prepare('INSERT INTO incidents (incident_number, incident_type) VALUES (?, ?)').run('IR-T1', 'TEST');
    db.prepare('INSERT INTO businesses (name) VALUES (?)').run('Acme');
    db.prepare('INSERT INTO incident_businesses (incident_id, business_id, role) VALUES (1, 1, ?)').run('victim');
    expect(() =>
      db.prepare('INSERT INTO incident_businesses (incident_id, business_id, role) VALUES (1, 1, ?)').run('witness')
    ).toThrow(/UNIQUE/);
  });

  it('enforces role enum CHECK constraint', () => {
    const db = getDb();
    db.prepare('INSERT INTO incidents (incident_number, incident_type) VALUES (?, ?)').run('IR-T2', 'TEST');
    db.prepare('INSERT INTO businesses (name) VALUES (?)').run('Acme');
    expect(() =>
      db.prepare('INSERT INTO incident_businesses (incident_id, business_id, role) VALUES (1, 1, ?)').run('not_a_real_role')
    ).toThrow(/CHECK/);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd server && npx vitest run __tests__/businessLinking.test.ts 2>&1 | tail -10
```
Expected: FAIL with `no such table: incident_businesses`.

**Step 3: Write minimal implementation**

In `server/src/models/database.ts`, locate the `incident_persons` CREATE TABLE block. Immediately after its closing `);`, add:

```typescript
db.prepare(`
  CREATE TABLE IF NOT EXISTS incident_businesses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    incident_id INTEGER NOT NULL,
    business_id INTEGER NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('victim','reporting_party','witness','suspect_affiliated','involved','other')),
    notes TEXT,
    added_by INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    UNIQUE(incident_id, business_id),
    FOREIGN KEY (incident_id) REFERENCES incidents(id),
    FOREIGN KEY (business_id) REFERENCES businesses(id)
  )
`).run();

db.prepare(`CREATE INDEX IF NOT EXISTS idx_incident_businesses_incident ON incident_businesses(incident_id)`).run();
db.prepare(`CREATE INDEX IF NOT EXISTS idx_incident_businesses_business ON incident_businesses(business_id)`).run();
```

**Step 4: Run test to verify it passes**

```bash
cd server && npx vitest run __tests__/businessLinking.test.ts 2>&1 | tail -10
```
Expected: 3 passing tests.

**Step 5: Commit**

```bash
git add server/src/models/database.ts server/__tests__/businessLinking.test.ts
git commit -m "feat(business): add incident_businesses junction table"
```

---

### Task 1.2: Add `call_businesses` table

**Files:**
- Modify: `server/src/models/database.ts` (after `call_persons` block, ~line 4964)
- Test: extend `server/__tests__/businessLinking.test.ts`

**Step 1: Write failing tests** — mirror Task 1.1 structure with `call_businesses` table name and its columns. Note: `role` column is plain TEXT (no CHECK enum) to match existing `call_persons.role` pattern.

**Step 2: Verify failing.**

**Step 3: Implementation** — after the `call_persons` CREATE TABLE block:

```typescript
db.prepare(`
  CREATE TABLE IF NOT EXISTS call_businesses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    call_id INTEGER NOT NULL,
    business_id INTEGER NOT NULL,
    role TEXT NOT NULL,
    notes TEXT,
    added_by INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    UNIQUE(call_id, business_id)
  )
`).run();

db.prepare(`CREATE INDEX IF NOT EXISTS idx_call_businesses_call ON call_businesses(call_id)`).run();
db.prepare(`CREATE INDEX IF NOT EXISTS idx_call_businesses_business ON call_businesses(business_id)`).run();
```

**Step 4-5:** Verify pass, commit `feat(business): add call_businesses junction table`.

---

### Task 1.3: Add `business_persons` table

**Files:**
- Modify: `server/src/models/database.ts`
- Test: extend `server/__tests__/businessLinking.test.ts`

**Step 1: Failing tests**

```typescript
describe('business_persons table', () => {
  beforeEach(() => initDatabase(':memory:'));

  it('creates with expected columns', () => {
    const db = getDb();
    const cols = db.prepare("PRAGMA table_info(business_persons)").all() as any[];
    const names = cols.map(c => c.name).sort();
    expect(names).toEqual(['added_by','business_id','created_at','end_date','id','notes','person_id','role','start_date'].sort());
  });

  it('allows same person+business with different roles (manager AND key_holder)', () => {
    const db = getDb();
    db.prepare('INSERT INTO businesses (name) VALUES (?)').run('Acme');
    db.prepare('INSERT INTO persons (first_name, last_name) VALUES (?,?)').run('Jane', 'Doe');
    db.prepare('INSERT INTO business_persons (business_id, person_id, role) VALUES (1, 1, ?)').run('manager');
    expect(() =>
      db.prepare('INSERT INTO business_persons (business_id, person_id, role) VALUES (1, 1, ?)').run('key_holder')
    ).not.toThrow();
  });

  it('rejects duplicate (business, person, role)', () => {
    const db = getDb();
    db.prepare('INSERT INTO businesses (name) VALUES (?)').run('Acme');
    db.prepare('INSERT INTO persons (first_name, last_name) VALUES (?,?)').run('Jane', 'Doe');
    db.prepare('INSERT INTO business_persons (business_id, person_id, role) VALUES (1, 1, ?)').run('manager');
    expect(() =>
      db.prepare('INSERT INTO business_persons (business_id, person_id, role) VALUES (1, 1, ?)').run('manager')
    ).toThrow(/UNIQUE/);
  });
});
```

**Step 3: Implementation**

```typescript
db.prepare(`
  CREATE TABLE IF NOT EXISTS business_persons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL,
    person_id INTEGER NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('owner','officer_director','manager','key_holder','security_contact','employee','vendor','other')),
    start_date TEXT,
    end_date TEXT,
    notes TEXT,
    added_by INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    UNIQUE(business_id, person_id, role),
    FOREIGN KEY (business_id) REFERENCES businesses(id),
    FOREIGN KEY (person_id) REFERENCES persons(id)
  )
`).run();

db.prepare(`CREATE INDEX IF NOT EXISTS idx_business_persons_business ON business_persons(business_id)`).run();
db.prepare(`CREATE INDEX IF NOT EXISTS idx_business_persons_person ON business_persons(person_id)`).run();
db.prepare(`CREATE INDEX IF NOT EXISTS idx_business_persons_current ON business_persons(business_id) WHERE end_date IS NULL`).run();
```

**Step 4-5:** Verify, commit `feat(business): add business_persons junction with role + dates`.

---

### Task 1.4: Add 3 enrichment tables (`business_vehicles`, `business_visits`, `business_photos`)

**Files:**
- Modify: `server/src/models/database.ts`
- Test: extend `server/__tests__/businessLinking.test.ts`

**Step 1: Failing tests** (one parametrized test per table)

```typescript
describe('enrichment tables', () => {
  beforeEach(() => initDatabase(':memory:'));

  it.each([
    ['business_vehicles', ['added_by','business_id','created_at','id','notes','relationship','vehicle_id']],
    ['business_visits',   ['business_id','id','latitude','longitude','notes','officer_id','visit_at']],
    ['business_photos',   ['business_id','caption','category','id','uploaded_at','uploaded_by','url']],
  ])('table %s exists with expected columns', (table, expected) => {
    const db = getDb();
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as any[];
    expect(cols.map(c => c.name).sort()).toEqual(expected.sort());
  });
});
```

**Step 3: Implementation** — three CREATE TABLE blocks, each followed by appropriate indexes (see design doc for full SQL).

**Step 4-5:** Verify, commit `feat(business): add business_vehicles, business_visits, business_photos enrichment tables`.

---

### Task 1.5: Add 14 enrichment columns to `businesses` table

**Files:**
- Modify: `server/src/models/database.ts` (find or add `addCol` block for businesses)
- Test: extend `server/__tests__/businessLinking.test.ts`

**Step 1: Failing test**

```typescript
it('businesses table has all 14 new columns', () => {
  const db = getDb();
  const cols = (db.prepare("PRAGMA table_info(businesses)").all() as any[]).map(c => c.name);
  for (const col of [
    'alarm_company','alarm_panel_code','alarm_passphrase',
    'after_hours_contact_name','after_hours_contact_phone',
    'hours_of_operation','holiday_schedule',
    'loss_prevention_contact','insurance_carrier','insurance_policy_number',
    'parent_company','franchise_id','photo_storefront_url','archived_at'
  ]) {
    expect(cols).toContain(col);
  }
});
```

**Step 3: Implementation**

```typescript
// Business enrichment columns (PR 1, 2026-04-26)
addCol('businesses', 'alarm_company', 'TEXT');
addCol('businesses', 'alarm_panel_code', 'TEXT');           // encrypted at rest
addCol('businesses', 'alarm_passphrase', 'TEXT');           // encrypted at rest
addCol('businesses', 'after_hours_contact_name', 'TEXT');
addCol('businesses', 'after_hours_contact_phone', 'TEXT');
addCol('businesses', 'hours_of_operation', 'TEXT');         // JSON
addCol('businesses', 'holiday_schedule', 'TEXT');           // JSON array
addCol('businesses', 'loss_prevention_contact', 'TEXT');
addCol('businesses', 'insurance_carrier', 'TEXT');
addCol('businesses', 'insurance_policy_number', 'TEXT');
addCol('businesses', 'parent_company', 'TEXT');
addCol('businesses', 'franchise_id', 'TEXT');
addCol('businesses', 'photo_storefront_url', 'TEXT');
addCol('businesses', 'archived_at', 'TEXT');
```

**Step 4-5:** Verify, commit `feat(business): add 14 enrichment columns (alarm, hours, insurance, etc.)`.

---

### Task 1.6: Add `linked_business_id` to `bolos` and `protected_business_id` to `trespass_orders`

**Files:**
- Modify: `server/src/models/database.ts`
- Test: extend `businessLinking.test.ts`

**Step 1: Failing tests** assert both columns exist.

**Step 3: Implementation**

```typescript
addCol('bolos', 'linked_business_id', 'INTEGER');
addCol('trespass_orders', 'protected_business_id', 'INTEGER');
```

**Step 5: Commit** `feat(business): add bolos.linked_business_id + trespass_orders.protected_business_id`.

---

### Task 1.7: Field-level encryption helpers for alarm fields

**Files:**
- Create: `server/src/utils/businessEncryption.ts`
- Test: `server/__tests__/businessEncryption.test.ts`

**Step 1: Failing tests**

```typescript
import { describe, it, expect } from 'vitest';
import { encryptAlarmField, decryptAlarmField } from '../src/utils/businessEncryption';

describe('businessEncryption', () => {
  it('round-trips a string', () => {
    const ciphertext = encryptAlarmField('1234');
    expect(ciphertext).not.toBe('1234');
    expect(decryptAlarmField(ciphertext)).toBe('1234');
  });

  it('returns null for null input', () => {
    expect(encryptAlarmField(null)).toBeNull();
    expect(decryptAlarmField(null)).toBeNull();
  });

  it('produces different ciphertexts for same plaintext (IV randomness)', () => {
    const a = encryptAlarmField('secret');
    const b = encryptAlarmField('secret');
    expect(a).not.toBe(b);
    expect(decryptAlarmField(a)).toBe('secret');
    expect(decryptAlarmField(b)).toBe('secret');
  });
});
```

**Step 3: Implementation** — AES-256-GCM, key derived from `JWT_SECRET + ':business-alarm'` via SHA-256. Pattern matches existing `server/src/utils/totp.ts`. See design doc for full code.

**Step 5: Commit** `feat(business): AES-256-GCM helpers for alarm field encryption`.

---

### Task 1.8: Business search endpoint

**Files:**
- Modify: `server/src/routes/records.ts` — add ABOVE `/businesses/:id` route to avoid `:id` matching `/search`
- Test: `server/__tests__/businesses.test.ts` (CREATE NEW)

**Step 1: Failing tests**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { initDatabase, getDb } from '../src/models/database';
import { createApp } from '../src/app';
import { signTestToken } from './helpers/auth';

describe('GET /api/records/businesses/search', () => {
  let app: any;
  let token: string;

  beforeEach(() => {
    initDatabase(':memory:');
    app = createApp();
    token = signTestToken({ id: 1, role: 'officer' });
    const db = getDb();
    db.prepare('INSERT INTO businesses (name, dba_name, phone, address) VALUES (?,?,?,?)')
      .run('Walmart Store 321', 'Walmart', '555-1212', '1500 S State St');
    db.prepare('INSERT INTO businesses (name, phone) VALUES (?,?)').run('Acme Corp', '555-9999');
  });

  it('returns matches by name prefix', async () => {
    const r = await request(app).get('/api/records/businesses/search?q=walm').set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(1);
    expect(r.body[0].name).toBe('Walmart Store 321');
  });

  it('returns matches by phone exact', async () => {
    const r = await request(app).get('/api/records/businesses/search?q=555-9999').set('Authorization', `Bearer ${token}`);
    expect(r.body).toHaveLength(1);
    expect(r.body[0].name).toBe('Acme Corp');
  });

  it('returns empty array on no match', async () => {
    const r = await request(app).get('/api/records/businesses/search?q=nothing').set('Authorization', `Bearer ${token}`);
    expect(r.body).toEqual([]);
  });

  it('requires auth', async () => {
    const r = await request(app).get('/api/records/businesses/search?q=walm');
    expect(r.status).toBe(401);
  });
});
```

If `helpers/auth.ts` doesn't exist, look at how existing tests sign tokens (e.g., `server/__tests__/persons.test.ts`).

**Step 3: Implementation**

```typescript
router.get('/businesses/search',
  requireRole('admin','manager','supervisor','dispatcher','officer','client_viewer','human_resources','contract_manager'),
  (req: Request, res: Response) => {
    const q = paramStr(req.query.q || '').trim();
    const limit = Math.min(parseInt(paramStr(req.query.limit || '20'), 10) || 20, 100);
    if (q.length < 2) return res.json([]);

    const db = getDb();
    const like = `%${q}%`;
    const exact = q;
    const rows = db.prepare(`
      SELECT * FROM businesses
      WHERE archived_at IS NULL
        AND (name LIKE ? OR dba_name LIKE ? OR phone = ? OR ein = ? OR address LIKE ?)
      ORDER BY
        CASE WHEN name LIKE ? THEN 0 ELSE 1 END,
        name
      LIMIT ?
    `).all(like, like, exact, exact, like, q + '%', limit);
    res.json(rows);
  }
);
```

**Step 5: Commit** `feat(business): /businesses/search endpoint with prefix + exact ranking`.

---

### Task 1.9: Business person linking endpoints (POST/PUT/DELETE)

**Files:**
- Modify: `server/src/routes/records.ts`
- Test: extend `server/__tests__/businesses.test.ts`

**Step 1: Failing tests**

```typescript
describe('business_persons linking', () => {
  let app: any, token: string;
  beforeEach(() => {
    initDatabase(':memory:');
    app = createApp();
    token = signTestToken({ id: 1, role: 'officer' });
    const db = getDb();
    db.prepare('INSERT INTO businesses (name) VALUES (?)').run('Acme');
    db.prepare('INSERT INTO persons (first_name, last_name) VALUES (?,?)').run('John', 'Smith');
  });

  it('POST creates link', async () => {
    const r = await request(app)
      .post('/api/records/businesses/1/persons')
      .set('Authorization', `Bearer ${token}`)
      .send({ person_id: 1, role: 'manager', notes: 'hired 2024' });
    expect(r.status).toBe(201);
    expect(r.body.id).toBeDefined();
    expect(r.body.role).toBe('manager');
  });

  it('POST returns 409 on duplicate (business, person, role)', async () => {
    await request(app).post('/api/records/businesses/1/persons').set('Authorization', `Bearer ${token}`).send({ person_id: 1, role: 'manager' });
    const r = await request(app).post('/api/records/businesses/1/persons').set('Authorization', `Bearer ${token}`).send({ person_id: 1, role: 'manager' });
    expect(r.status).toBe(409);
  });

  it('POST returns 400 on invalid role', async () => {
    const r = await request(app).post('/api/records/businesses/1/persons').set('Authorization', `Bearer ${token}`).send({ person_id: 1, role: 'kingmaker' });
    expect(r.status).toBe(400);
  });

  it('PUT updates dates and notes', async () => {
    const created = await request(app).post('/api/records/businesses/1/persons').set('Authorization', `Bearer ${token}`).send({ person_id: 1, role: 'manager' });
    const r = await request(app).put(`/api/records/businesses/1/persons/${created.body.id}`).set('Authorization', `Bearer ${token}`).send({ end_date: '2025-06-01', notes: 'left for competitor' });
    expect(r.status).toBe(200);
    expect(r.body.end_date).toBe('2025-06-01');
  });

  it('DELETE removes link, leaves person record', async () => {
    const created = await request(app).post('/api/records/businesses/1/persons').set('Authorization', `Bearer ${token}`).send({ person_id: 1, role: 'manager' });
    const r = await request(app).delete(`/api/records/businesses/1/persons/${created.body.id}`).set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(204);
    const db = getDb();
    expect(db.prepare('SELECT COUNT(*) as c FROM persons').get()).toEqual({ c: 1 });  // person still exists
    expect(db.prepare('SELECT COUNT(*) as c FROM business_persons').get()).toEqual({ c: 0 });
  });
});
```

**Step 3: Implementation**

```typescript
const VALID_BIZ_PERSON_ROLES = ['owner','officer_director','manager','key_holder','security_contact','employee','vendor','other'];

router.post('/businesses/:id/persons',
  requireRole('admin','manager','supervisor','dispatcher','officer'),
  (req: Request, res: Response) => {
    const businessId = parseInt(paramStr(req.params.id), 10);
    const { person_id, role, start_date, end_date, notes } = req.body;
    if (!VALID_BIZ_PERSON_ROLES.includes(role)) {
      return res.status(400).json({ error: 'Invalid role', allowed: VALID_BIZ_PERSON_ROLES });
    }
    const db = getDb();
    try {
      const result = db.prepare(`
        INSERT INTO business_persons (business_id, person_id, role, start_date, end_date, notes, added_by)
        VALUES (?,?,?,?,?,?,?)
      `).run(businessId, person_id, role, start_date || null, end_date || null, notes || null, req.user.id);
      const row = db.prepare('SELECT * FROM business_persons WHERE id = ?').get(result.lastInsertRowid);
      auditLog(req, 'CREATE', 'business_person_link', result.lastInsertRowid, null, row);
      broadcastDispatchUpdate({ action: 'business_persons_updated', business_id: businessId });
      res.status(201).json(row);
    } catch (err: any) {
      if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return res.status(409).json({ error: 'Person already linked to this business with this role' });
      }
      throw err;
    }
  }
);

// PUT and DELETE follow identical patterns — see design doc for full code
```

**Step 5: Commit** `feat(business): person linking endpoints (POST/PUT/DELETE business_persons)`.

---

### Task 1.10: incident_businesses linking endpoints

**Files:**
- Modify: `server/src/routes/incidents.ts`
- Test: `server/__tests__/incidentBusinesses.test.ts` (CREATE NEW)

Mirror the structure of Task 1.9 but with `/api/incidents/:id/businesses` paths and the `incident_businesses` table. Use role enum from this design (victim/reporting_party/witness/suspect_affiliated/involved/other).

Reference pattern: `server/src/routes/incidents.ts:946` (`POST /:id/persons`).

Commit: `feat(business): incident_businesses linking endpoints`.

---

### Task 1.11: call_businesses linking endpoints

Mirror Task 1.10 in `server/src/routes/dispatch/callActions.ts:1086` (`POST /calls/:id/persons`). **Per CLAUDE.md Gotcha #30 the route prefix is `/calls/:id/businesses`, NOT `/:id/businesses`.**

Test file: `server/__tests__/callBusinesses.test.ts`.

Commit: `feat(business): call_businesses linking endpoints`.

---

### Task 1.12: Business archive/unarchive endpoints

**Files:**
- Modify: `server/src/routes/records.ts`
- Test: extend `businesses.test.ts`

**Step 1: Failing tests**

```typescript
it('POST /businesses/:id/archive sets archived_at', async () => {
  const r = await request(app).post('/api/records/businesses/1/archive').set('Authorization', `Bearer ${token}`);
  expect(r.status).toBe(200);
  const db = getDb();
  const row = db.prepare('SELECT archived_at FROM businesses WHERE id = 1').get() as any;
  expect(row.archived_at).toBeTruthy();
});

it('archived business excluded from search', async () => {
  await request(app).post('/api/records/businesses/1/archive').set('Authorization', `Bearer ${token}`);
  const r = await request(app).get('/api/records/businesses/search?q=Acme').set('Authorization', `Bearer ${token}`);
  expect(r.body).toHaveLength(0);
});

it('POST /businesses/:id/unarchive clears archived_at', async () => {
  await request(app).post('/api/records/businesses/1/archive').set('Authorization', `Bearer ${token}`);
  const r = await request(app).post('/api/records/businesses/1/unarchive').set('Authorization', `Bearer ${token}`);
  expect(r.status).toBe(200);
});
```

**Step 3: Implementation**

```typescript
router.post('/businesses/:id/archive', requireRole('admin','manager','supervisor'), (req, res) => {
  const id = parseInt(paramStr(req.params.id), 10);
  const db = getDb();
  db.prepare("UPDATE businesses SET archived_at = datetime('now','localtime') WHERE id = ?").run(id);
  auditLog(req, 'ARCHIVE', 'business', id, null, null);
  res.json({ success: true, id });
});

router.post('/businesses/:id/unarchive', requireRole('admin','manager','supervisor'), (req, res) => {
  const id = parseInt(paramStr(req.params.id), 10);
  const db = getDb();
  db.prepare("UPDATE businesses SET archived_at = NULL WHERE id = ?").run(id);
  auditLog(req, 'UNARCHIVE', 'business', id, null, null);
  res.json({ success: true, id });
});
```

**Step 5: Commit** `feat(business): archive/unarchive lifecycle endpoints`.

---

### Task 1.13: business_vehicles routes

**Files:**
- Create: `server/src/routes/businessVehicles.ts`
- Modify: `server/src/routes/index.ts` (mount at `/api/business-vehicles`)
- Test: `server/__tests__/businessVehicles.test.ts`

Three endpoints:
- `GET /api/business-vehicles/:businessId` — list
- `POST /api/business-vehicles` — body `{business_id, vehicle_id, relationship, notes}`
- `DELETE /api/business-vehicles/:linkId`

Pattern mirrors `business_persons` linking (Task 1.9). Validate `relationship` enum: `owner_employee | frequent_visitor | fleet | other`.

Commit: `feat(business): business_vehicles routes`.

---

### Task 1.14: business_visits routes

**Files:**
- Create: `server/src/routes/businessVisits.ts`
- Modify: `server/src/routes/index.ts`
- Test: `server/__tests__/businessVisits.test.ts`

Endpoints:
- `GET /api/business-visits/:businessId?since=YYYY-MM-DD` — paginated
- `POST /api/business-visits` — body `{business_id, lat?, lon?, notes?}` — `officer_id` from `req.user.id`, `visit_at` defaults to now

Commit: `feat(business): business_visits routes for patrol logging`.

---

### Task 1.15: business_photos routes

**Files:**
- Create: `server/src/routes/businessPhotos.ts`
- Test: `server/__tests__/businessPhotos.test.ts`

Endpoints:
- `GET /api/business-photos/:businessId`
- `POST /api/business-photos` — multipart upload, store URL in `business_photos.url`, write file to `server/uploads/business-photos/`
- `DELETE /api/business-photos/:photoId`

Reuse the existing multer/upload pattern from `server/src/routes/uploads.ts`.

Commit: `feat(business): business_photos routes with multipart upload`.

---

### Task 1.16: businessAggregation utilities

**Files:**
- Create: `server/src/utils/businessAggregation.ts`
- Test: `server/__tests__/businessAggregation.test.ts`

**Step 1: Failing tests** (test pure helpers before wiring into the dossier endpoint)

```typescript
import { describe, it, expect } from 'vitest';
import {
  computeIsCurrentlyOpen,
  computeHeatmap,
  computeTrend,
  computeRiskScore
} from '../src/utils/businessAggregation';

describe('computeIsCurrentlyOpen', () => {
  const monFri9to5 = JSON.stringify({
    mon: { open: '09:00', close: '17:00' },
    tue: { open: '09:00', close: '17:00' },
    wed: { open: '09:00', close: '17:00' },
    thu: { open: '09:00', close: '17:00' },
    fri: { open: '09:00', close: '17:00' },
  });

  it('returns true Mon 14:00 Mountain Time', () => {
    const fakeNow = new Date('2026-04-27T20:00:00Z'); // Mon 14:00 MDT
    expect(computeIsCurrentlyOpen(monFri9to5, fakeNow)).toBe(true);
  });

  it('returns false Sat anytime', () => {
    const fakeNow = new Date('2026-05-02T20:00:00Z'); // Sat
    expect(computeIsCurrentlyOpen(monFri9to5, fakeNow)).toBe(false);
  });

  it('returns false on holiday even if hours would say open', () => {
    const holidays = JSON.stringify(['2026-12-25']);
    const xmas = new Date('2026-12-25T20:00:00Z');
    expect(computeIsCurrentlyOpen(monFri9to5, xmas, holidays)).toBe(false);
  });

  it('handles cross-midnight hours (e.g., bar open 18:00-02:00)', () => {
    const lateBar = JSON.stringify({ fri: { open: '18:00', close: '02:00' } });
    const friNight = new Date('2026-05-01T08:00:00Z'); // Fri 02:00 MDT — still open
    expect(computeIsCurrentlyOpen(lateBar, friNight)).toBe(true);
  });
});

describe('computeHeatmap', () => {
  it('returns 7×6 matrix even with empty input', () => {
    const matrix = computeHeatmap([]);
    expect(matrix).toHaveLength(7);
    expect(matrix[0]).toHaveLength(6);
    expect(matrix.flat().every(n => n === 0)).toBe(true);
  });

  it('counts events into correct day/4-hour bucket', () => {
    const events = [
      { occurred_at: '2026-04-27T14:30:00-06:00' }, // Mon 14:30 → [1][3] (12-16 bucket)
      { occurred_at: '2026-04-27T15:00:00-06:00' }, // same bucket
      { occurred_at: '2026-04-28T08:00:00-06:00' }, // Tue 08:00 → [2][2]
    ];
    const m = computeHeatmap(events);
    expect(m[1][3]).toBe(2);
    expect(m[2][2]).toBe(1);
  });
});
```

**Step 3: Implementation** uses Luxon for timezone math (already in deps via TTS scheduling). See design doc for full code; helpers are:
- `computeIsCurrentlyOpen(hoursJson, now, holidaysJson?)` — handles cross-midnight + holiday + Mountain Time
- `computeHeatmap(events)` → `number[7][6]`
- `computeTrend(recent, prior)` → `{pct_change, week_buckets}`
- `computeRiskScore(business, linkedPersons, incidentCount30d)` → `{score, level}`

**Step 5: Commit** `feat(business): aggregation utilities (heatmap, trend, currently-open, risk score)`.

---

### Task 1.17: subjectSearch endpoint (powers the unified picker)

**Files:**
- Create: `server/src/routes/subjectSearch.ts`
- Modify: `server/src/routes/index.ts` — mount at `/api/records/subjects`
- Test: `server/__tests__/subjectSearch.test.ts`

**Step 1: Failing tests**

```typescript
describe('GET /api/records/subjects/search', () => {
  it('returns mixed person + business results', async () => {
    // Seed: person "John Smith", business "Smith Auto"
    const r = await request(app).get('/api/records/subjects/search?q=smith&types=person,business').set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(200);
    const types = r.body.map((x: any) => x.type).sort();
    expect(types).toEqual(['business', 'person']);
  });

  it('filters by types parameter', async () => {
    const r = await request(app).get('/api/records/subjects/search?q=smith&types=business').set('Authorization', `Bearer ${token}`);
    expect(r.body.every((x: any) => x.type === 'business')).toBe(true);
  });

  it('boosts results with active warrants', async () => {
    // Seed: two persons named "common", one with active warrant
    const r = await request(app).get('/api/records/subjects/search?q=common').set('Authorization', `Bearer ${token}`);
    expect(r.body[0].badges.some((b: any) => b.type === 'warrant')).toBe(true);
  });

  it('returns discriminated union shape', async () => {
    const r = await request(app).get('/api/records/subjects/search?q=smith').set('Authorization', `Bearer ${token}`);
    for (const item of r.body) {
      expect(item).toHaveProperty('type');
      expect(item).toHaveProperty('id');
      expect(item).toHaveProperty('display_name');
      expect(item).toHaveProperty('sub_text');
      expect(item).toHaveProperty('badges');
    }
  });
});
```

**Step 3: Implementation** — see design doc for full route code. Key behaviors: queries persons + businesses tables (filtered by `types` param), composes badges from active_warrant_count/flags/recent_calls, ranks results by score (warrants/flags +50, recency +20, base +50/+60), returns flat discriminated union.

**Step 5: Commit** `feat(business): subject search endpoint with discriminated union shape`.

---

### Task 1.18: Dossier endpoint

**Files:**
- Modify: `server/src/routes/records.ts` — add `/businesses/:id/dossier` route
- Modify: `server/src/utils/businessAggregation.ts` — add `buildBusinessDossier(businessId, userRole)` orchestrator
- Test: `server/__tests__/dossierEndpoint.test.ts`

**Step 1: Failing tests**

```typescript
describe('GET /api/records/businesses/:id/dossier', () => {
  beforeEach(() => {
    initDatabase(':memory:');
    // ... seed business + linked persons + incidents + calls + trespass + visits + photos
  });

  it('returns full dossier shape', async () => {
    const r = await request(app).get('/api/records/businesses/1/dossier').set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(200);
    for (const key of [
      'business','linked_persons','active_trespass_orders','recent_activity',
      'alarm_info','hours','photos','vehicles','visits','related_businesses',
      'active_bolos','heatmap','trend','meta'
    ]) {
      expect(r.body).toHaveProperty(key);
    }
  });

  it('strips alarm_info for client_viewer', async () => {
    const cvToken = signTestToken({ id: 2, role: 'client_viewer' });
    const r = await request(app).get('/api/records/businesses/1/dossier').set('Authorization', `Bearer ${cvToken}`);
    expect(r.body.alarm_info).toBeUndefined();
  });

  it('decrypts alarm fields for officer role', async () => {
    // seed business with encrypted alarm_panel_code
    const r = await request(app).get('/api/records/businesses/1/dossier').set('Authorization', `Bearer ${token}`);
    expect(r.body.alarm_info.panel_code).toBe('1234');  // decrypted
  });

  it('heatmap returns 7×6 matrix even with no data', async () => {
    const r = await request(app).get('/api/records/businesses/1/dossier').set('Authorization', `Bearer ${token}`);
    expect(r.body.heatmap).toHaveLength(7);
    expect(r.body.heatmap[0]).toHaveLength(6);
  });

  it('completes in <200ms for 100 incidents + 50 calls + 10 persons', async () => {
    // seed heavy fixture
    const start = Date.now();
    await request(app).get('/api/records/businesses/1/dossier').set('Authorization', `Bearer ${token}`);
    expect(Date.now() - start).toBeLessThan(200);
  });
});
```

**Step 3: Implementation** — `buildBusinessDossier(businessId, userRole)` runs ~12 indexed queries, composes the response per the shape in design Section 3, applies alarm decryption + role-based stripping. See design doc for full implementation.

Then in `records.ts`:

```typescript
router.get('/businesses/:id/dossier',
  requireRole('admin','manager','supervisor','dispatcher','officer','client_viewer','human_resources','contract_manager'),
  (req, res) => {
    const id = parseInt(paramStr(req.params.id), 10);
    const dossier = buildBusinessDossier(id, req.user.role);
    if (!dossier) return res.status(404).json({ error: 'Business not found' });
    auditLog(req, 'VIEW', 'business_dossier', id, null, { sections: Object.keys(dossier) });
    res.json(dossier);
  }
);
```

**Step 5: Commit** `feat(business): dossier endpoint aggregating 12 panels`.

---

### Task 1.19: Encrypt alarm fields on POST/PUT business writes

**Files:**
- Modify: `server/src/routes/records.ts` — wrap `alarm_panel_code` and `alarm_passphrase` with `encryptAlarmField()` on insert/update
- Test: extend `businesses.test.ts`

**Step 1: Failing test**

```typescript
it('encrypts alarm_panel_code on POST', async () => {
  const r = await request(app)
    .post('/api/records/businesses')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'TestBiz', alarm_panel_code: '1234' });
  expect(r.status).toBe(201);
  const db = getDb();
  const row = db.prepare('SELECT alarm_panel_code FROM businesses WHERE id = ?').get(r.body.id) as any;
  expect(row.alarm_panel_code).not.toBe('1234');
  expect(row.alarm_panel_code).toMatch(/^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);  // base64 IV:tag:data
});
```

**Step 3: Implementation** — modify the existing POST/PUT business handlers to wrap `alarm_panel_code` and `alarm_passphrase` with `encryptAlarmField()` before inserting.

**Step 5: Commit** `feat(business): encrypt alarm fields at rest on write`.

---

### Task 1.20: Bump CACHE_NAME, run full suite, deploy

**Step 1:** Bump `CACHE_NAME`

```bash
sed -i '' "s/rmpg-flex-v448/rmpg-flex-v449/" client/public/sw.js
git add client/public/sw.js
git commit -m "chore(sw): bump CACHE_NAME v448 → v449 for PR 1 deploy"
```

**Step 2:** Run FULL server suite

```bash
cd server && npx vitest run 2>&1 | tail -10
```
Expected: ALL pass (existing 461 + ~140 new = ~600+).

**Step 3:** Server typecheck

```bash
cd server && npx tsc --noEmit 2>&1 | tail -10
```
Expected: 0 errors.

**Step 4:** Route collision check

```bash
cd server && npm run check:routes 2>&1 | tail -5
```
Expected: 0 duplicates.

**Step 5:** Push branch + open PR

```bash
git push -u origin feat/business-records-backend
gh pr create --base main --title "feat(business): PR 1/3 — schema & backend" --body "$(cat <<'EOF'
Phase 1 of 3 from docs/plans/2026-04-26-business-records-upgrade-design.md.

Adds:
- 6 new tables (incident_businesses, call_businesses, business_persons, business_vehicles, business_visits, business_photos)
- 14 enrichment columns on businesses + 1 column each on bolos and trespass_orders
- 18 new API routes
- AES-256-GCM encryption for alarm fields
- Dossier endpoint with role-gated alarm visibility
- Subject search endpoint (powers PR 3 picker)

Zero user-visible change — all backend. UI ships in PR 2.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

**Step 6:** After review + merge, deploy

```bash
ssh root@194.113.64.90 "cd /opt/rmpg-flex && git pull origin main && bash deploy/deploy.sh"
ssh root@194.113.64.90 "curl -sf https://localhost/api/records/businesses/search?q=test"
```
Expected: returns `[]` with 200 status.

🛑 **STOP HERE. Do not proceed to PR 2 until PR 1 is verified live in production.**

---

# PHASE / PR 2 — Business Detail Page

**Branch:** `feat/business-detail-page`
**Estimate:** 5-6 days
**Bumps `CACHE_NAME`:** v449 → v450
**User-visible:** Yes (working dossier viewer)

### Task 2.0: Branch setup

```bash
git fetch origin
git checkout -b feat/business-detail-page origin/main
git commit --allow-empty -m "feat(business): start PR 2 — detail page"
```

### Task 2.1: TypeScript types for dossier shape

**Files:**
- Create: `client/src/types/business.ts`

Define `BusinessDossier` interface and all sub-types (`LinkedPersonEntry`, `TrespassOrderSummary`, `ActivityEntry`, `AlarmInfo`, `HoursMap`, `BusinessPhoto`, `LinkedVehicleEntry`, `VisitEntry`, `RelatedBusiness`, `BoloSummary`).

No tests — type definitions only. Compile check via `npx tsc --noEmit`.

Commit: `feat(business): TypeScript types for dossier shape`.

### Task 2.2: useBusinessDossier hook

**Files:**
- Create: `client/src/hooks/useBusinessDossier.ts`

Hook wrapping `apiFetch('/businesses/:id/dossier')` with React Query / SWR-style caching, loading state, and WebSocket invalidation via existing `useLiveSync`.

Smoke test: hook returns `{data, error, loading, refetch}`.

Commit: `feat(business): useBusinessDossier hook with live-sync invalidation`.

### Task 2.3: BusinessDetailPage shell + route

**Files:**
- Create: `client/src/pages/records/BusinessDetailPage.tsx`
- Modify: `client/src/App.tsx` — register route `/records/businesses/:id`

Render skeleton with all 13 panel placeholders (panels themselves come in Tasks 2.4-2.16). Confirm route works end-to-end via smoke test.

Commit: `feat(business): BusinessDetailPage shell + route registration`.

### Tasks 2.4-2.16: Panel components (13 tasks, one per component)

For each component below, follow this pattern:

**Step 1:** Write smoke test asserting component renders with minimal props
**Step 2:** Run failing
**Step 3:** Implement minimal version that satisfies smoke
**Step 4:** Run passing
**Step 5:** Commit `feat(business): <ComponentName>`

Components (each ~50-200 LoC):

- 2.4: `BusinessProfileCard.tsx`
- 2.5: `BusinessLinkedPersonsPanel.tsx` (with warrant/flag badges)
- 2.6: `BusinessTrespassPanel.tsx`
- 2.7: `BusinessActivityTimeline.tsx`
- 2.8: `BusinessHeatmap.tsx`
- 2.9: `BusinessAlarmCard.tsx` (auth-gated render based on `useAuth()`)
- 2.10: `BusinessLinkedVehiclesPanel.tsx`
- 2.11: `BusinessVisitLog.tsx`
- 2.12: `BusinessPhotoGallery.tsx`
- 2.13: `BusinessRiskCard.tsx`
- 2.14: `BusinessRelatedCard.tsx`
- 2.15: `BusinessFlagsCard.tsx` + `BusinessQuickFactsCard.tsx`
- 2.16: `BusinessHoursCard.tsx` + `BusinessActiveBolosCard.tsx` + `BusinessDocumentsCard.tsx`

### Task 2.17: Wire panels into BusinessDetailPage layout

Compose all 13 components into the 3-column layout (340px / flex / 340px). Mobile single-column at <768px. Reuse `PanelTitleBar` for header. Status pills computed from dossier data.

Smoke test: mount with full dossier fixture, assert all 13 panels render.

Commit: `feat(business): wire all dossier panels into BusinessDetailPage layout`.

### Task 2.18: Strip detail pane from BusinessTab, wire row click to navigate

**Files:**
- Modify: `client/src/pages/records/BusinessTab.tsx` (-150 LoC, +60 LoC)

Remove the in-tab read-only detail pane. Convert row click to `navigate(\`/records/businesses/${row.id}\`)`. Wire search bar to new `/businesses/search` endpoint.

Commit: `feat(business): wire BusinessTab list rows to navigate to detail page`.

### Task 2.19: Comprehensive smoke test suite

**Files:**
- Create: `client/src/pages/records/__tests__/BusinessDetailPage.smoke.test.tsx`

Cover variants:
- Empty dossier (new business, no data)
- Minimal dossier
- Full dossier (heavy fixture)
- Archived business
- client_viewer role (alarm panel absent)
- Mobile breakpoint

Stub `fetch` per existing pattern (CLAUDE.md "Client-side PDF smoke tests" section).

Commit: `test(business): smoke tests for BusinessDetailPage variants`.

### Task 2.20: Bump CACHE_NAME, run gates, deploy

```bash
sed -i '' "s/rmpg-flex-v449/rmpg-flex-v450/" client/public/sw.js
git add client/public/sw.js
git commit -m "chore(sw): bump CACHE_NAME v449 → v450 for PR 2 deploy"

cd client && npx tsc --noEmit
cd client && npx vitest run
cd server && npx vitest run

git push -u origin feat/business-detail-page
gh pr create --base main --title "feat(business): PR 2/3 — detail page (dossier viewer)" \
  --body "Phase 2 of 3. Standalone dossier viewer at /records/businesses/:id."
```

After merge + deploy, verify in browser: navigate Records → Business → click any row → detail page renders with live data.

🛑 **STOP HERE. Do not proceed to PR 3 until PR 2 is verified live.**

---

# PHASE / PR 3 — Unified Subject Picker

**Branch:** `feat/unified-subject-picker`
**Estimate:** 3-4 days
**Bumps `CACHE_NAME`:** v450 → v451
**User-visible:** Yes (closes the loop end-to-end)

### Task 3.0: Branch setup

```bash
git fetch origin
git checkout -b feat/unified-subject-picker origin/main
```

### Task 3.1: useSubjectSearch hook

**Files:**
- Create: `client/src/hooks/useSubjectSearch.ts`
- Test: smoke test for debounce + fetch wrapper

Debounced typeahead (250ms), wraps `apiFetch('/records/subjects/search?q=...')`. Stale-while-revalidate cache.

Commit: `feat(business): useSubjectSearch hook with debounce`.

### Task 3.2: SubjectResultRow component

**Files:**
- Create: `client/src/components/SubjectResultRow.tsx`

Renders a person OR business result with icon, name, sub-text, badges. ~130 LoC.

Smoke tests: mount with person fixture, mount with business fixture.

Commit: `feat(business): SubjectResultRow component`.

### Task 3.3: SubjectQuickCreateForm component

**Files:**
- Create: `client/src/components/SubjectQuickCreateForm.tsx`

Inline form for "+ Create New Person" / "+ Create New Business" — minimal fields (name, primary identifier).

Commit: `feat(business): SubjectQuickCreateForm component`.

### Task 3.4: SubjectPicker modal

**Files:**
- Create: `client/src/components/SubjectPicker.tsx` (~350 LoC)
- Test: `client/src/components/__tests__/SubjectPicker.test.tsx`

Full modal: search input, filter pills (All / Persons / Businesses), result list, role dropdown, notes field, action buttons. Keyboard shortcuts (↑↓ Enter 1-5 Esc ⌘+Enter).

Smoke + interaction tests:
- Renders with empty state
- Debounce fires after 250ms
- Selecting result reveals role section
- Role dropdown defaults based on `defaultRole` prop
- Multi-add mode keeps modal open
- Keyboard navigation works
- Inline create button hidden for `client_viewer`

Commit: `feat(business): SubjectPicker modal with full keyboard support`.

### Task 3.5: Convert PersonPicker into SubjectPicker wrapper

**Files:**
- Modify: `client/src/components/PersonPicker.tsx` (-200 LoC, +20 LoC)

Gut the existing `PersonPicker`. New body:

```tsx
import SubjectPicker from './SubjectPicker';

export default function PersonPicker(props: PersonPickerProps) {
  // Forward all props, restrict types to person only
  return (
    <SubjectPicker
      {...props}
      types={['person']}
      onSelect={(subject) => props.onSelect(subject as PersonSubject)}
    />
  );
}
```

This is the backwards-compat layer — every screen still using `<PersonPicker>` keeps working unchanged.

Commit: `refactor(business): PersonPicker becomes SubjectPicker wrapper (backwards compat)`.

### Tasks 3.6-3.10: Migrate 5 screens to SubjectPicker

For each screen below: replace `<PersonPicker>` with `<SubjectPicker>`. Update the linking-POST handler to also handle the case where `subject.type === 'business'` → POST to the business-flavored endpoint instead.

- 3.6: `client/src/pages/dispatch/DispatchPage.tsx` — also POST to `/dispatch/calls/:id/businesses` when business selected
- 3.7: `client/src/pages/IncidentsPage.tsx` — POST to `/incidents/:id/businesses`
- 3.8: `client/src/pages/FieldInterviewsPage.tsx` — FI subjects can now be Persons OR Businesses
- 3.9: `client/src/pages/CaseManagementPage.tsx` — evidence/case subjects
- 3.10: `client/src/pages/TrespassOrdersPage.tsx` — Trespass Orders now have `protected_business_id` (added in Task 1.6); when a Business is selected as the protected party, set that. Person-as-trespassed-subject flow unchanged.

Commit messages: `feat(business): migrate <screen> to SubjectPicker`.

### Task 3.11: Bump CACHE_NAME, full gates, deploy

```bash
sed -i '' "s/rmpg-flex-v450/rmpg-flex-v451/" client/public/sw.js
git add client/public/sw.js
git commit -m "chore(sw): bump CACHE_NAME v450 → v451 for PR 3 deploy"

cd client && npx tsc --noEmit && npx vitest run
cd server && npx vitest run

git push -u origin feat/unified-subject-picker
gh pr create --base main --title "feat(business): PR 3/3 — unified subject picker (closes loop)" \
  --body "Phase 3 of 3. Replaces PersonPicker with SubjectPicker in 5 locations. Officers can now attach Businesses as victim/RP/witness in calls and IRs."
```

After merge + deploy, **manual end-to-end smoke** documented in PR description:

1. Dispatcher logs into Flex
2. Creates new test call CFS-XXXX
3. Clicks "+ Add Subject", types "Walmart"
4. Walmart appears in results, dispatcher selects, role defaults to Victim, clicks "Add to Call"
5. Call subjects panel now shows Walmart with Victim badge
6. Dispatcher clicks Walmart → opens Business Detail page → recent activity panel shows the just-created CFS-XXXX
7. Loop closed end-to-end ✅

---

# Cross-PR Cleanup

### Task 4.1: Update CLAUDE.md

After all 3 PRs land:

- Update Records section to describe new Business module capabilities
- Add gotchas for business_persons junction patterns (e.g., "remember UNIQUE is on (business_id, person_id, role) — same person can have multiple roles")
- Note the SubjectPicker as the canonical subject-selection component

Commit: `docs(claude): update CLAUDE.md with business module changes`.

### Task 4.2: Capture lessons learned

If anything surprising happened during execution (data shapes that didn't match the design, performance issues, schema migration friction), add them as memory entries:

- `~/.claude/projects/-Users-rmpgutah-RMPG-Flex/memory/feedback_business_records_lessons.md`

---

## Verification at end of PR 3

After PR 3 deploy:

```bash
# Backend health
curl -sf https://rmpgutah.us/api/health
curl -sf https://rmpgutah.us/api/records/businesses/search?q=walmart
curl -sf https://rmpgutah.us/api/records/businesses/1/dossier

# Frontend smoke (manual)
# - Officer logs in
# - Records → Business → click any row → detail page renders with all panels
# - Open dispatch → new call → "+ Add Subject" → search "walmart" → both Persons and Businesses appear
# - Attach Walmart as Victim → save → verify in call subjects
# - Open the Walmart dossier → verify the just-created call appears in Recent Activity within 30s (WebSocket)

# Service worker retired
# - In Chrome DevTools → Application → Service Workers — old SW unregistered, new SW v451 active
```

**If any check fails:** stop, diagnose with the systematic-debugging skill, do NOT start cleanup task 4.x.

---

## What's Explicitly Deferred

- Persons / Vehicles / Properties feature parity review (separate engagement per user intent)
- Merging Clients into Businesses (Q4 option C — revisit if duplication causes friction)
- Adding `business_id` FK to Properties (Q4 option B — revisit if needed)
- Visual regression testing, k6/locust load tests, Playwright E2E, accessibility audit (out of scope)
- Inheritance from `parent_company` via FK to `business_groups` table (revisit if recursive aggregation needed)
- Patrol auto-logging from GPS breadcrumbs (revisit during Persons/Vehicles/Properties review)
