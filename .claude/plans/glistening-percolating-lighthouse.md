# RMPG Flex — Sex Offender Registry Lookup Module

## Context

Officers need a dedicated module to search and review sex offender registry records during field operations, traffic stops, and investigations. The existing `OffenderRegistryPage.tsx` manages general offender **alerts** (ban zones, watch lists, warrants, etc.) — it's not a registry lookup tool. This builds a purpose-built Sex Offender Registry interface with mugshot display, demographic details, addresses, offenses, and compliance status — designed to connect to official data feeds (USORS, NCIC) when available, with manual entry and CSV import as initial data sources.

The `coloradoDocScraper.ts` pattern (search, cache, cross-link persons) provides the data-layer template. The `persons` table already has `is_sex_offender` field for cross-referencing.

---

## Step 1 — Database: `sex_offender_registry` table

Add to `server/src/models/database.ts` in the migrations section:

```sql
CREATE TABLE IF NOT EXISTS sex_offender_registry (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id INTEGER,
  registry_id TEXT UNIQUE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  middle_name TEXT,
  aliases TEXT,
  dob TEXT, gender TEXT, race TEXT,
  height TEXT, weight TEXT,
  hair_color TEXT, eye_color TEXT,
  scars_marks_tattoos TEXT,
  photo_url TEXT,
  tier INTEGER DEFAULT 1,
  risk_level TEXT,
  registration_status TEXT DEFAULT 'compliant',
  registration_date TEXT, expiration_date TEXT,
  last_verification TEXT, next_verification_due TEXT,
  registration_jurisdiction TEXT,
  offenses TEXT DEFAULT '[]',
  conviction_state TEXT,
  addresses TEXT DEFAULT '[]',
  vehicles TEXT DEFAULT '[]',
  employer TEXT, employer_address TEXT,
  school TEXT, school_address TEXT,
  restrictions TEXT,
  conditions TEXT DEFAULT '[]',
  supervising_officer TEXT,
  source TEXT DEFAULT 'manual',
  notes TEXT,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (person_id) REFERENCES persons(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);
```

Plus indexes on last_name, registry_id, person_id, tier, registration_status.

---

## Step 2 — API: `server/src/routes/sexOffenderRegistry.ts` (NEW)

| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/` | any auth | Search/list with pagination, filter by tier/status/search |
| GET | `/stats` | any auth | Counts by tier, status, non-compliant, due for verification |
| GET | `/:id` | any auth | Full record detail |
| POST | `/` | admin, manager, supervisor | Create new entry |
| PUT | `/:id` | admin, manager, supervisor | Update entry |
| PUT | `/:id/verify` | admin, manager, supervisor, officer | Log compliance verification |
| POST | `/import` | admin | CSV/JSON bulk import |

Register in `server/src/index.ts` at `/api/sex-offender-registry`.

---

## Step 3 — Types: `client/src/types/index.ts`

Add `SexOffenderRecord`, `SORAddress`, `SOROffense`, `SORVehicle` interfaces and `SORTier` (1|2|3), `SORStatus`, `SORRiskLevel` types.

---

## Step 4 — Page: `client/src/pages/SexOffenderRegistryPage.tsx` (NEW)

### SplitPanel Layout

**Left — Registry List** (scrollable cards with mugshot thumbnails):
- 48x48 mugshot, name (LAST, FIRST), tier badge (1=green, 2=amber, 3=red), compliance LED, DOB
- Selected card gets blue ring highlight

**Right — Detail Profile** (9 sections):
1. **Header** — Large mugshot (120x160), full name, tier badge, risk level, registry ID
2. **Demographics** — DOB/age, gender, race, build, hair/eyes, scars/marks, aliases
3. **Addresses** — Current + historical with type icons, verified dates
4. **Offenses** — statute, description, date, victim age, court, case number
5. **Compliance** — Status LED, dates, [Verify Now] + [Flag Non-Compliant] buttons
6. **Vehicles** — Year/make/model/color/plate
7. **Employment & School** — Names + addresses
8. **Restrictions & Conditions** — Free text + conditions list
9. **Quick Actions** — [Edit] [Link Person] [Add Note]

### SplitPanel Props
`initialRatio={0.38}`, `minLeftPx={300}`, `minRightPx={400}`, `persistKey="sor-split"`, `leftLabel="Registry"`, `rightLabel="Profile"`

### Modals
- **Add/Edit Entry** — Full form with all fields
- **CSV Import** — File upload with preview

---

## Step 5 — Navigation Registration

- `App.tsx` — Route `/sex-offender-registry`
- `MenuBar.tsx` — Enforce menu item with ShieldAlert icon
- `Layout.tsx` — Page title mapping

---

## Files

| File | Action |
|------|--------|
| `server/src/models/database.ts` | Add `sex_offender_registry` table + indexes |
| `server/src/routes/sexOffenderRegistry.ts` | **NEW** — 7 endpoints |
| `server/src/index.ts` | Register route |
| `client/src/types/index.ts` | Add types |
| `client/src/pages/SexOffenderRegistryPage.tsx` | **NEW** — Full UI (~650 lines) |
| `client/src/App.tsx` | Add route |
| `client/src/components/MenuBar.tsx` | Add menu item |
| `client/src/components/Layout.tsx` | Add page title |

---

## Verification

1. `cd client && npx vite build` — zero errors
2. `bash deploy/deploy.sh` — deploy
3. `curl -sf https://rmpgutah.us/api/health`
4. Navigate to page — SplitPanel layout, stats, filters working
5. Add test entry — form works, detail panel populates all sections
6. Compliance [Verify Now] — updates last_verification date
7. Mobile — tab-based layout via SplitPanel
