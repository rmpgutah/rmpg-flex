# NCIC/NLETS Data Codes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the NCIC/NLETS terminal render authentic NCIC + Utah data codes (code + decoded label) on output, and accept codes on input, via a single client-side code-table module.

**Architecture:** One new constants module (`client/src/constants/ncicCodes.ts`) holds authoritative bidirectional code tables and pure translate helpers. The formatter (`ncicFormatter.ts`) calls the helpers when rendering; the terminal panel (`NcicQueryPanel.tsx`) calls them for a `QZ` decoder command and code-tolerant `QV`. Client-only — no D1 migration, no server changes.

**Tech Stack:** TypeScript, React 18, Vitest (client suite via `cd client && npx vitest run`).

---

## Reference: spec

Design spec: [`docs/superpowers/specs/2026-06-15-ncic-data-codes-design.md`](../specs/2026-06-15-ncic-data-codes-design.md).

## File Structure

- **Create** `client/src/constants/ncicCodes.ts` — code tables + helpers (`encode`, `decode`, `fmtCoded`, `formatRaceEthnicity`, `normalizeHeight`, `normalizeWeight`, `lookupOffense`, `fmtOffense`, `lookupAnyCode`).
- **Create** `client/src/constants/__tests__/ncicCodes.test.ts` — unit tests.
- **Modify** `client/src/utils/ncicFormatter.ts` — render coded fields.
- **Modify** `client/src/components/NcicQueryPanel.tsx` — `QZ` decoder, code-tolerant `QV`, welcome/placeholder text.
- **Modify** `client/public/sw.js` — bump `CACHE_NAME`.

## Conventions for every task

- Run client tests with: `cd client && npx vitest run src/constants/__tests__/ncicCodes.test.ts`
- Run client typecheck with: `cd "$REPO" && cd client && npx tsc --noEmit`
- The repo root husky **pre-commit** hook runs the *Worker* vitest, which currently fails on a missing `unpdf` package unrelated to this work. **Task 0 fixes that** so commits pass cleanly; if it cannot be fixed, commit client-only changes with `git commit --no-verify` and say so in the task.
- Branch: do all work on a feature branch off `origin/main` and open a PR (project rule — never push to main directly).

---

## Task 0: Branch + environment prep

**Files:** none (setup only)

- [ ] **Step 1: Create the feature branch off origin/main**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/stupefied-mendel-596748"
git fetch origin
git checkout -b feat/ncic-data-codes origin/main
```

- [ ] **Step 2: Resolve the pre-existing `unpdf` test failure so the pre-commit hook passes**

Run: `npm install`
Then verify the Worker suite imports resolve:
Run: `npm test 2>&1 | tail -5`
Expected: no "Cannot find package 'unpdf'" errors. If `unpdf` still fails after install (worktree node_modules quirk), note it and use `git commit --no-verify` for the remaining client-only commits in this plan.

- [ ] **Step 3: Confirm the client test runner works**

Run: `cd client && npx vitest run src/utils/__tests__/formatters.test.ts`
Expected: PASS (sanity check that client vitest runs).

---

## Task 1: Code module — person descriptors + core helpers

**Files:**
- Create: `client/src/constants/ncicCodes.ts`
- Test: `client/src/constants/__tests__/ncicCodes.test.ts`

- [ ] **Step 1: Write the failing test**

Create `client/src/constants/__tests__/ncicCodes.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  encode, decode, fmtCoded, formatRaceEthnicity,
  normalizeHeight, normalizeWeight,
} from '../ncicCodes';

describe('person descriptor codes', () => {
  it('encodes stored race labels to NCIC codes', () => {
    expect(encode('RACE', 'White')).toBe('W');
    expect(encode('RACE', 'Black')).toBe('B');
    expect(encode('RACE', 'Native American')).toBe('I');
    expect(encode('RACE', 'Asian')).toBe('A');
    expect(encode('RACE', 'Pacific Islander')).toBe('A');
  });

  it('decodes a code back to its canonical label', () => {
    expect(decode('RACE', 'W')).toBe('White');
    expect(decode('SEX', 'M')).toBe('Male');
  });

  it('fmtCoded renders "CODE (LABEL)"', () => {
    expect(fmtCoded('RACE', 'White')).toBe('W (WHITE)');
    expect(fmtCoded('SEX', 'Female')).toBe('F (FEMALE)');
    expect(fmtCoded('EYE', 'Brown')).toBe('BRO (BROWN)');
    expect(fmtCoded('HAIR', 'Blonde')).toBe('BLN (BLOND)');
  });

  it('fmtCoded accepts a value already in code form', () => {
    expect(fmtCoded('RACE', 'W')).toBe('W (WHITE)');
  });

  it('fmtCoded returns empty string for empty input', () => {
    expect(fmtCoded('RACE', '')).toBe('');
    expect(fmtCoded('RACE', undefined as unknown as string)).toBe('');
  });

  it('falls back to the raw uppercased value when there is no code', () => {
    expect(fmtCoded('EYE', 'Amber')).toBe('AMBER');
    expect(encode('RACE', 'Klingon')).toBe('KLINGON');
  });

  it('treats Hispanic as ethnicity, not race', () => {
    expect(formatRaceEthnicity('Hispanic')).toEqual({ rac: 'U (UNKNOWN)', etn: 'H (HISPANIC)' });
    expect(formatRaceEthnicity('White')).toEqual({ rac: 'W (WHITE)', etn: null });
    expect(formatRaceEthnicity('')).toEqual({ rac: '', etn: null });
  });

  it('normalizes height to NCIC 3-digit feet-inches', () => {
    expect(normalizeHeight(`5'10"`)).toBe('510');
    expect(normalizeHeight('510')).toBe('510');
    expect(normalizeHeight('70in')).toBe('510');
    expect(normalizeHeight('6 ft 0 in')).toBe('600');
    expect(normalizeHeight('')).toBe('');
  });

  it('normalizes weight to NCIC 3-digit pounds', () => {
    expect(normalizeWeight('180')).toBe('180');
    expect(normalizeWeight('90')).toBe('090');
    expect(normalizeWeight('180 lbs')).toBe('180');
    expect(normalizeWeight(180)).toBe('180');
    expect(normalizeWeight('')).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/constants/__tests__/ncicCodes.test.ts`
Expected: FAIL — cannot find module `../ncicCodes`.

- [ ] **Step 3: Create the module with person tables + helpers**

Create `client/src/constants/ncicCodes.ts`:

```ts
// ============================================================
// RMPG Flex — NCIC / NLETS Data Codes
//
// Authoritative bidirectional code tables + pure translate
// helpers used by the NCIC terminal (ncicFormatter.ts for
// output rendering, NcicQueryPanel.tsx for input). Single
// source of truth, mirroring lawEnforcementEnums.ts.
//
// Codes follow the NCIC Code Manual (person descriptors,
// vehicle make/color/style) and Utah DLD / Utah Code where
// state-specific. Unknown values degrade gracefully to the
// raw value uppercased — the helpers never throw.
// ============================================================

export type NcicDomain =
  | 'RACE' | 'ETHNICITY' | 'SEX' | 'EYE' | 'HAIR'
  | 'VMA' | 'VCO' | 'VST'
  | 'STATE' | 'DL_CLASS' | 'DL_RESTRICTION' | 'DL_ENDORSEMENT';

interface CodeTable {
  toLabel: Map<string, string>; // CODE -> canonical Title-case label
  toCode: Map<string, string>;  // lowercased label/alias/code -> CODE
}

// Each row: [code, canonicalLabel, ...aliases]. Aliases let stored
// values that differ from the canonical label still resolve.
type Row = [string, string, ...string[]];

function makeTable(rows: Row[]): CodeTable {
  const toLabel = new Map<string, string>();
  const toCode = new Map<string, string>();
  for (const [code, label, ...aliases] of rows) {
    const C = code.toUpperCase();
    toLabel.set(C, label);
    toCode.set(label.toLowerCase(), C);
    toCode.set(C.toLowerCase(), C);
    for (const a of aliases) toCode.set(a.toLowerCase(), C);
  }
  return { toLabel, toCode };
}

// ── Person descriptors ──────────────────────────────────────

// NCIC race: W/B/I/A/U. (Hispanic is ETHNICITY, not race.)
const RACE = makeTable([
  ['W', 'White', 'Middle Eastern', 'Caucasian'],
  ['B', 'Black', 'African American'],
  ['I', 'American Indian', 'Native American', 'Alaska Native', 'Indigenous'],
  ['A', 'Asian', 'Pacific Islander', 'Asian/Pacific Islander'],
  ['U', 'Unknown', 'Mixed', 'Other'],
]);

const ETHNICITY = makeTable([
  ['H', 'Hispanic', 'Latino', 'Latina', 'Latinx'],
  ['N', 'Not Hispanic'],
  ['U', 'Unknown'],
]);

// NCIC sex: M/F/U. X retained for non-binary/other (modern).
const SEX = makeTable([
  ['M', 'Male'],
  ['F', 'Female'],
  ['X', 'Non-Binary', 'Other'],
  ['U', 'Unknown'],
]);

// NCIC eye color codes.
const EYE = makeTable([
  ['BLK', 'Black'],
  ['BLU', 'Blue'],
  ['BRO', 'Brown'],
  ['GRN', 'Green'],
  ['GRY', 'Gray'],
  ['HAZ', 'Hazel'],
  ['MAR', 'Maroon'],
  ['MUL', 'Multicolored'],
  ['PNK', 'Pink'],
  ['XXX', 'Unknown'],
]);

// NCIC hair color codes.
const HAIR = makeTable([
  ['BAL', 'Bald'],
  ['BLK', 'Black'],
  ['BLN', 'Blond', 'Blonde'],
  ['BLU', 'Blue'],
  ['BRO', 'Brown'],
  ['GRY', 'Gray', 'Grey'],
  ['GRN', 'Green'],
  ['ONG', 'Orange'],
  ['PNK', 'Pink'],
  ['PLE', 'Purple'],
  ['RED', 'Red', 'Auburn'],
  ['SDY', 'Sandy'],
  ['WHI', 'White'],
  ['XXX', 'Unknown'],
]);

// Registry of label-based domains. (OFFENSE is handled separately
// because it returns a structured entry, not a single code.)
const TABLES: Record<NcicDomain, CodeTable> = {
  RACE, ETHNICITY, SEX, EYE, HAIR,
  // Vehicle + geographic tables are added in later tasks; declare
  // empty placeholders so the type stays exhaustive until then.
  VMA: makeTable([]), VCO: makeTable([]), VST: makeTable([]),
  STATE: makeTable([]), DL_CLASS: makeTable([]),
  DL_RESTRICTION: makeTable([]), DL_ENDORSEMENT: makeTable([]),
};

// ── Core helpers (pure) ─────────────────────────────────────

/** label/alias/code → NCIC code; falls back to uppercased input. */
export function encode(domain: NcicDomain, value: string | null | undefined): string {
  const v = (value ?? '').trim();
  if (!v) return '';
  return TABLES[domain].toCode.get(v.toLowerCase()) ?? v.toUpperCase();
}

/** code (or label) → canonical label; falls back to uppercased input. */
export function decode(domain: NcicDomain, value: string | null | undefined): string {
  const v = (value ?? '').trim();
  if (!v) return '';
  const t = TABLES[domain];
  const asCode = v.toUpperCase();
  if (t.toLabel.has(asCode)) return t.toLabel.get(asCode)!;
  const code = t.toCode.get(v.toLowerCase());
  return code ? t.toLabel.get(code)! : v.toUpperCase();
}

/** "CODE (LABEL)"; "" for empty; raw uppercased value if no code exists. */
export function fmtCoded(domain: NcicDomain, value: string | null | undefined): string {
  const v = (value ?? '').trim();
  if (!v) return '';
  const code = encode(domain, v);
  const label = TABLES[domain].toLabel.get(code);
  return label ? `${code} (${label.toUpperCase()})` : v.toUpperCase();
}

/** Hispanic-aware race rendering: race line + optional ethnicity line. */
export function formatRaceEthnicity(rawRace: string | null | undefined): { rac: string; etn: string | null } {
  const v = (rawRace ?? '').trim();
  if (!v) return { rac: '', etn: null };
  if (/hispanic|latin[oax]?/i.test(v)) {
    return { rac: fmtCoded('RACE', 'U'), etn: fmtCoded('ETHNICITY', 'Hispanic') };
  }
  return { rac: fmtCoded('RACE', v), etn: null };
}

/** Height → NCIC 3-digit feet+inches (e.g. 5'10" -> "510"). "" if unparseable. */
export function normalizeHeight(value: string | number | null | undefined): string {
  if (value == null || value === '') return '';
  const s = String(value).trim();
  // Already NCIC form: 3 digits, feet 4-7, inches 00-11.
  if (/^[4-7]\d{2}$/.test(s)) {
    const inches = Number(s.slice(1));
    if (inches <= 11) return s;
  }
  // feet'inches"  or  "6 ft 0 in"
  const fi = s.match(/(\d)\D+(\d{1,2})/);
  if (fi) {
    const ft = Number(fi[1]); const inch = Number(fi[2]);
    if (ft >= 1 && ft <= 7 && inch <= 11) return `${ft}${String(inch).padStart(2, '0')}`;
  }
  // total inches (e.g. "70in", "70")
  const totalIn = s.match(/^(\d{2,3})\s*(?:in|")?$/i);
  if (totalIn) {
    const t = Number(totalIn[1]);
    if (t >= 36 && t <= 95) return `${Math.floor(t / 12)}${String(t % 12).padStart(2, '0')}`;
  }
  return '';
}

/** Weight → NCIC 3-digit pounds. "" if unparseable. */
export function normalizeWeight(value: string | number | null | undefined): string {
  if (value == null || value === '') return '';
  const m = String(value).match(/\d{1,3}/);
  if (!m) return '';
  return String(Number(m[0])).padStart(3, '0');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/constants/__tests__/ncicCodes.test.ts`
Expected: PASS (all person-descriptor tests green).

- [ ] **Step 5: Commit**

```bash
git add client/src/constants/ncicCodes.ts client/src/constants/__tests__/ncicCodes.test.ts
git commit -m "feat(ncic): code module — person descriptors + translate helpers"
```

---

## Task 2: Vehicle code tables (VMA / VCO / VST)

**Files:**
- Modify: `client/src/constants/ncicCodes.ts`
- Test: `client/src/constants/__tests__/ncicCodes.test.ts`

- [ ] **Step 1: Add the failing tests**

Append to `ncicCodes.test.ts`:

```ts
describe('vehicle codes', () => {
  it('encodes makes to NCIC VMA codes', () => {
    expect(encode('VMA', 'Toyota')).toBe('TOYT');
    expect(encode('VMA', 'Chevrolet')).toBe('CHEV');
    expect(encode('VMA', 'Ford')).toBe('FORD');
    expect(encode('VMA', 'Honda')).toBe('HOND');
    expect(encode('VMA', 'Mercedes-Benz')).toBe('MERZ');
  });
  it('fmtCoded renders vehicle make/color/style', () => {
    expect(fmtCoded('VMA', 'Toyota')).toBe('TOYT (TOYOTA)');
    expect(fmtCoded('VCO', 'Blue')).toBe('BLU (BLUE)');
    expect(fmtCoded('VST', 'Sedan (4-Door)')).toBe('4D (SEDAN 4-DOOR)');
    expect(fmtCoded('VST', 'Pickup Truck')).toBe('PK (PICKUP)');
  });
  it('maps compound colors', () => {
    expect(encode('VCO', 'Dark Blue')).toBe('DBL');
    expect(encode('VCO', 'Silver')).toBe('SIL');
    expect(encode('VCO', 'Maroon')).toBe('MAR');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd client && npx vitest run src/constants/__tests__/ncicCodes.test.ts`
Expected: FAIL — VMA/VCO/VST tables empty.

- [ ] **Step 3: Replace the empty VMA/VCO/VST placeholders with real tables**

In `ncicCodes.ts`, add these table definitions *above* the `TABLES` registry:

```ts
// ── Vehicle make (NCIC VMA) ─────────────────────────────────
const VMA = makeTable([
  ['ACUR', 'Acura'], ['AMER', 'AMC', 'American Motors'], ['AUDI', 'Audi'],
  ['BMW', 'BMW'], ['BUIC', 'Buick'], ['CADI', 'Cadillac'],
  ['CHEV', 'Chevrolet', 'Chevy'], ['CHRY', 'Chrysler'], ['DODG', 'Dodge'],
  ['FIAT', 'Fiat'], ['FORD', 'Ford'], ['GENE', 'Genesis'], ['GEO', 'Geo'],
  ['GMC', 'GMC'], ['HOND', 'Honda'], ['HUMM', 'Hummer'], ['HYUN', 'Hyundai'],
  ['INFI', 'Infiniti'], ['ISU', 'Isuzu'], ['JAGU', 'Jaguar'], ['JEEP', 'Jeep'],
  ['KIA', 'Kia'], ['LEXS', 'Lexus'], ['LINC', 'Lincoln'],
  ['LndRover', 'Land Rover', 'Range Rover'], ['MAZD', 'Mazda'],
  ['MERZ', 'Mercedes-Benz', 'Mercedes'], ['MERC', 'Mercury'], ['MINI', 'Mini'],
  ['MITS', 'Mitsubishi'], ['NISS', 'Nissan'], ['OLDS', 'Oldsmobile'],
  ['PLYM', 'Plymouth'], ['PONT', 'Pontiac'], ['PORS', 'Porsche'],
  ['RAM', 'Ram'], ['SATL', 'Saturn'], ['SCIO', 'Scion'], ['SMRT', 'Smart'],
  ['SUBA', 'Subaru'], ['SUZI', 'Suzuki'], ['TESL', 'Tesla'],
  ['TOYT', 'Toyota'], ['VOLK', 'Volkswagen', 'VW'], ['VOLV', 'Volvo'],
  ['HD', 'Harley-Davidson', 'Harley'],
]);

// ── Vehicle color (NCIC VCO) ────────────────────────────────
const VCO = makeTable([
  ['BGE', 'Beige'], ['BLK', 'Black'], ['BLU', 'Blue'], ['BRO', 'Brown'],
  ['BRZ', 'Bronze'], ['CPR', 'Copper'], ['CRM', 'Cream', 'Ivory'],
  ['DBL', 'Dark Blue', 'Navy'], ['DGR', 'Dark Green'], ['GLD', 'Gold'],
  ['GRY', 'Gray', 'Grey', 'Charcoal', 'Dark Gray', 'Light Gray'],
  ['GRN', 'Green'], ['LAV', 'Lavender'], ['LBL', 'Light Blue'],
  ['LGR', 'Light Green'], ['MAR', 'Maroon', 'Burgundy', 'Dark Red'],
  ['ONG', 'Orange'], ['PNK', 'Pink'], ['PLE', 'Purple'], ['RED', 'Red'],
  ['SIL', 'Silver'], ['TAN', 'Tan'], ['TEL', 'Teal'], ['TRQ', 'Turquoise'],
  ['WHI', 'White'], ['YEL', 'Yellow'], ['MUL', 'Multicolored', 'Multi-Color'],
]);

// ── Vehicle body style (NCIC VST) ───────────────────────────
const VST = makeTable([
  ['2D', '2-Door', 'Coupe (2-Door)'], ['4D', 'Sedan 4-Door', 'Sedan (4-Door)', 'Sedan'],
  ['CP', 'Coupe'], ['CV', 'Convertible'], ['SW', 'Station Wagon', 'Wagon'],
  ['HB', 'Hatchback'], ['UV', 'Utility', 'SUV', 'Crossover', 'ATV / UTV'],
  ['PK', 'Pickup', 'Pickup Truck'], ['VN', 'Van', 'Minivan', 'Cargo Van'],
  ['BU', 'Bus'], ['MC', 'Motorcycle', 'Scooter', 'Moped'],
  ['TL', 'Trailer'], ['TK', 'Truck', 'Box Truck', 'Flatbed', 'Tow Truck', 'Dump Truck'],
  ['TR', 'Truck Tractor', 'Semi Tractor'],
]);
```

Then update the `TABLES` registry, replacing the three vehicle placeholders:

```ts
  VMA, VCO, VST,
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd client && npx vitest run src/constants/__tests__/ncicCodes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/constants/ncicCodes.ts client/src/constants/__tests__/ncicCodes.test.ts
git commit -m "feat(ncic): vehicle make/color/style code tables"
```

---

## Task 3: Geographic + Utah DL code tables

**Files:**
- Modify: `client/src/constants/ncicCodes.ts`
- Test: `client/src/constants/__tests__/ncicCodes.test.ts`

- [ ] **Step 1: Add the failing tests**

Append to `ncicCodes.test.ts`:

```ts
describe('geographic + DL codes', () => {
  it('decodes state codes to names and back', () => {
    expect(fmtCoded('STATE', 'UT')).toBe('UT (UTAH)');
    expect(encode('STATE', 'Utah')).toBe('UT');
    expect(fmtCoded('STATE', 'CA')).toBe('CA (CALIFORNIA)');
  });
  it('renders Utah DL classes', () => {
    expect(fmtCoded('DL_CLASS', 'D')).toBe('D (OPERATOR)');
    expect(fmtCoded('DL_CLASS', 'M')).toBe('M (MOTORCYCLE)');
    expect(encode('DL_CLASS', 'CDL-A')).toBe('A');
  });
  it('renders CDL endorsements', () => {
    expect(fmtCoded('DL_ENDORSEMENT', 'H')).toBe('H (HAZARDOUS MATERIALS)');
    expect(fmtCoded('DL_ENDORSEMENT', 'P')).toBe('P (PASSENGER)');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd client && npx vitest run src/constants/__tests__/ncicCodes.test.ts`
Expected: FAIL — STATE/DL tables empty.

- [ ] **Step 3: Add the tables**

In `ncicCodes.ts`, add above the `TABLES` registry:

```ts
// ── US states / territories + common Canadian provinces (NLETS) ─
const STATE = makeTable([
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'],
  ['CA', 'California'], ['CO', 'Colorado'], ['CT', 'Connecticut'], ['DE', 'Delaware'],
  ['FL', 'Florida'], ['GA', 'Georgia'], ['HI', 'Hawaii'], ['ID', 'Idaho'],
  ['IL', 'Illinois'], ['IN', 'Indiana'], ['IA', 'Iowa'], ['KS', 'Kansas'],
  ['KY', 'Kentucky'], ['LA', 'Louisiana'], ['ME', 'Maine'], ['MD', 'Maryland'],
  ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'], ['MS', 'Mississippi'],
  ['MO', 'Missouri'], ['MT', 'Montana'], ['NE', 'Nebraska'], ['NV', 'Nevada'],
  ['NH', 'New Hampshire'], ['NJ', 'New Jersey'], ['NM', 'New Mexico'], ['NY', 'New York'],
  ['NC', 'North Carolina'], ['ND', 'North Dakota'], ['OH', 'Ohio'], ['OK', 'Oklahoma'],
  ['OR', 'Oregon'], ['PA', 'Pennsylvania'], ['RI', 'Rhode Island'], ['SC', 'South Carolina'],
  ['SD', 'South Dakota'], ['TN', 'Tennessee'], ['TX', 'Texas'], ['UT', 'Utah'],
  ['VT', 'Vermont'], ['VA', 'Virginia'], ['WA', 'Washington'], ['WV', 'West Virginia'],
  ['WI', 'Wisconsin'], ['WY', 'Wyoming'], ['DC', 'District of Columbia'],
  ['PR', 'Puerto Rico'], ['GU', 'Guam'], ['VI', 'U.S. Virgin Islands'],
  ['AS', 'American Samoa'], ['MP', 'Northern Mariana Islands'],
  ['AB', 'Alberta'], ['BC', 'British Columbia'], ['MB', 'Manitoba'],
  ['ON', 'Ontario'], ['QC', 'Quebec'],
]);

// ── Utah DL class (Utah DLD) ────────────────────────────────
const DL_CLASS = makeTable([
  ['A', 'Commercial A', 'CDL-A'], ['B', 'Commercial B', 'CDL-B'],
  ['C', 'Commercial C', 'CDL-C'], ['D', 'Operator', 'Standard', 'Class D'],
  ['M', 'Motorcycle'],
]);

// ── DL restrictions (common) ────────────────────────────────
const DL_RESTRICTION = makeTable([
  ['A', 'Corrective Lenses'], ['B', 'Outside Mirror'], ['C', 'Mechanical Aid'],
  ['E', 'No Manual Transmission'], ['L', 'No Air Brakes'],
]);

// ── CDL endorsements (federally standardized) ───────────────
const DL_ENDORSEMENT = makeTable([
  ['H', 'Hazardous Materials'], ['N', 'Tank Vehicles'], ['P', 'Passenger'],
  ['S', 'School Bus'], ['T', 'Double/Triple Trailers'], ['X', 'Hazmat + Tank'],
]);
```

Update the `TABLES` registry, replacing the four geographic/DL placeholders:

```ts
  STATE, DL_CLASS, DL_RESTRICTION, DL_ENDORSEMENT,
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd client && npx vitest run src/constants/__tests__/ncicCodes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/constants/ncicCodes.ts client/src/constants/__tests__/ncicCodes.test.ts
git commit -m "feat(ncic): state + Utah DL class/restriction/endorsement codes"
```

---

## Task 4: Curated Utah offense table

**Files:**
- Modify: `client/src/constants/ncicCodes.ts`
- Test: `client/src/constants/__tests__/ncicCodes.test.ts`

> **Accuracy note for the implementer:** Utah statutes and severity classes below
> are the load-bearing values and are given accurately. The 4-digit NCIC offense
> category codes follow the NCIC Uniform Offense Classification. Before marking this
> task done, **spot-verify the NCIC numerics** for the top offenses (theft, DUI,
> assault, burglary, controlled-substance) against an authoritative NCIC/NIBRS
> crosswalk; correct any that differ. Unmatched charges degrade to the raw label, so
> a missing entry is never a wrong code — only a missing annotation.

- [ ] **Step 1: Add the failing tests**

Append to `ncicCodes.test.ts`:

```ts
import { lookupOffense, fmtOffense } from '../ncicCodes';

describe('offense codes', () => {
  it('looks up an exact offense', () => {
    const e = lookupOffense('Theft');
    expect(e?.utahStatute).toBe('76-6-404');
    expect(e?.severity).toBeTruthy();
    expect(e?.ncicCode).toMatch(/^\d{4}$/);
  });
  it('matches by keyword inside a longer charge string', () => {
    expect(lookupOffense('DUI - First Offense')?.utahStatute).toBe('41-6a-502');
    expect(lookupOffense('AGGRAVATED ASSAULT W/ WEAPON')?.utahStatute).toBe('76-5-103');
  });
  it('prefers the more specific offense', () => {
    // "retail theft" must not resolve to generic "theft"
    expect(lookupOffense('Retail Theft')?.utahStatute).toBe('76-6-602');
  });
  it('fmtOffense annotates with statute, severity and NCIC code', () => {
    expect(fmtOffense('Theft')).toMatch(/^THEFT \(76-6-404 · .+ · NCIC \d{4}\)$/);
  });
  it('fmtOffense returns the raw charge when unmatched', () => {
    expect(fmtOffense('Jaywalking On Mars')).toBe('JAYWALKING ON MARS');
    expect(fmtOffense('')).toBe('');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd client && npx vitest run src/constants/__tests__/ncicCodes.test.ts`
Expected: FAIL — `lookupOffense`/`fmtOffense` not exported.

- [ ] **Step 3: Add the offense table + helpers**

In `ncicCodes.ts`, append at the end of the file:

```ts
// ── Curated Utah offense table ──────────────────────────────
// { utahStatute, ncicCode (NCIC Uniform Offense Classification),
//   severity (Utah class: F1/F2/F3 felony, MA/MB/MC misdemeanor,
//   INF infraction) }. Curated common set — NOT the full manual.
// Order matters: more-specific keys come first so substring
// matching resolves "retail theft" before generic "theft".

export interface OffenseEntry { utahStatute: string; ncicCode: string; severity: string; }

const OFFENSE: Array<[keyword: string, entry: OffenseEntry]> = [
  // Violent
  ['MURDER',                { utahStatute: '76-5-203', ncicCode: '0901', severity: 'F1' }],
  ['MANSLAUGHTER',          { utahStatute: '76-5-205', ncicCode: '0999', severity: 'F2' }],
  ['AGGRAVATED ROBBERY',    { utahStatute: '76-6-302', ncicCode: '1201', severity: 'F1' }],
  ['ROBBERY',               { utahStatute: '76-6-301', ncicCode: '1201', severity: 'F2' }],
  ['AGGRAVATED ASSAULT',    { utahStatute: '76-5-103', ncicCode: '1305', severity: 'F3' }],
  ['ASSAULT',               { utahStatute: '76-5-102', ncicCode: '1313', severity: 'MB' }],
  ['AGGRAVATED KIDNAPPING', { utahStatute: '76-5-302', ncicCode: '1099', severity: 'F1' }],
  ['KIDNAPPING',            { utahStatute: '76-5-301', ncicCode: '1099', severity: 'F2' }],
  ['RAPE',                  { utahStatute: '76-5-402', ncicCode: '1199', severity: 'F1' }],
  ['SEXUAL ASSAULT',        { utahStatute: '76-5-404', ncicCode: '1199', severity: 'MA' }],
  ['CHILD ABUSE',           { utahStatute: '76-5-109', ncicCode: '1399', severity: 'F3' }],
  ['DOMESTIC VIOLENCE',     { utahStatute: '77-36-1',  ncicCode: '1313', severity: 'MB' }],
  // Property
  ['AGGRAVATED BURGLARY',   { utahStatute: '76-6-203', ncicCode: '2299', severity: 'F1' }],
  ['BURGLARY',              { utahStatute: '76-6-202', ncicCode: '2204', severity: 'F3' }],
  ['RETAIL THEFT',          { utahStatute: '76-6-602', ncicCode: '2308', severity: 'MB' }],
  ['SHOPLIFTING',           { utahStatute: '76-6-602', ncicCode: '2308', severity: 'MB' }],
  ['AUTO THEFT',            { utahStatute: '76-6-404', ncicCode: '2404', severity: 'F2' }],
  ['VEHICLE THEFT',         { utahStatute: '76-6-404', ncicCode: '2404', severity: 'F2' }],
  ['THEFT BY DECEPTION',    { utahStatute: '76-6-405', ncicCode: '2603', severity: 'MB' }],
  ['THEFT',                 { utahStatute: '76-6-404', ncicCode: '2305', severity: 'MB' }],
  ['CRIMINAL MISCHIEF',     { utahStatute: '76-6-106', ncicCode: '2999', severity: 'MB' }],
  ['ARSON',                 { utahStatute: '76-6-102', ncicCode: '2001', severity: 'F2' }],
  ['FORGERY',               { utahStatute: '76-6-501', ncicCode: '2501', severity: 'F3' }],
  ['IDENTITY THEFT',        { utahStatute: '76-6-1102', ncicCode: '2604', severity: 'F3' }],
  ['FRAUD',                 { utahStatute: '76-6-405', ncicCode: '2603', severity: 'MA' }],
  ['POSSESSION OF STOLEN',  { utahStatute: '76-6-408', ncicCode: '2810', severity: 'MA' }],
  ['TRESPASS',              { utahStatute: '76-6-206', ncicCode: '5707', severity: 'MB' }],
  // Drugs
  ['DISTRIBUTION OF CONTROLLED', { utahStatute: '58-37-8(1)', ncicCode: '3599', severity: 'F2' }],
  ['POSSESSION WITH INTENT',     { utahStatute: '58-37-8(1)', ncicCode: '3599', severity: 'F2' }],
  ['POSSESSION OF MARIJUANA',    { utahStatute: '58-37-8(2)', ncicCode: '3562', severity: 'MB' }],
  ['POSSESSION OF CONTROLLED',   { utahStatute: '58-37-8(2)', ncicCode: '3550', severity: 'MA' }],
  ['DRUG PARAPHERNALIA',         { utahStatute: '58-37a-5',  ncicCode: '3562', severity: 'MB' }],
  // Weapons
  ['FELON IN POSSESSION', { utahStatute: '76-10-503', ncicCode: '5215', severity: 'F2' }],
  ['CONCEALED WEAPON',    { utahStatute: '76-10-504', ncicCode: '5212', severity: 'MB' }],
  ['DISCHARGE OF FIREARM',{ utahStatute: '76-10-508', ncicCode: '5212', severity: 'F3' }],
  // Public order / justice
  ['DISORDERLY CONDUCT',  { utahStatute: '76-9-102',  ncicCode: '5315', severity: 'INF' }],
  ['PUBLIC INTOXICATION', { utahStatute: '76-9-701',  ncicCode: '5012', severity: 'INF' }],
  ['INTOXICATION',        { utahStatute: '76-9-701',  ncicCode: '5012', severity: 'INF' }],
  ['RESISTING ARREST',    { utahStatute: '76-8-305',  ncicCode: '4801', severity: 'MA' }],
  ['OBSTRUCTING',         { utahStatute: '76-8-306',  ncicCode: '4801', severity: 'MB' }],
  ['FAILURE TO APPEAR',   { utahStatute: '77-7-22',   ncicCode: '5011', severity: 'MB' }],
  // Traffic
  ['DUI',                 { utahStatute: '41-6a-502', ncicCode: '5404', severity: 'MB' }],
  ['DRIVING UNDER THE INFLUENCE', { utahStatute: '41-6a-502', ncicCode: '5404', severity: 'MB' }],
  ['RECKLESS DRIVING',    { utahStatute: '41-6a-528', ncicCode: '5401', severity: 'MC' }],
  ['DRIVING ON SUSPENDED',{ utahStatute: '53-3-227',  ncicCode: '5402', severity: 'MC' }],
  ['ELUDING',             { utahStatute: '41-6a-210', ncicCode: '5499', severity: 'F3' }],
  ['NO INSURANCE',        { utahStatute: '41-12a-301', ncicCode: '5499', severity: 'INF' }],
];

/** Match a free-text charge to a curated offense entry (specific-first). */
export function lookupOffense(charge: string | null | undefined): OffenseEntry | null {
  const c = (charge ?? '').toUpperCase().trim();
  if (!c) return null;
  for (const [keyword, entry] of OFFENSE) {
    if (c.includes(keyword)) return entry;
  }
  return null;
}

/** "CHARGE (statute · severity · NCIC code)"; raw uppercased charge if unmatched. */
export function fmtOffense(charge: string | null | undefined): string {
  const base = (charge ?? '').toUpperCase().trim();
  if (!base) return '';
  const e = lookupOffense(base);
  return e ? `${base} (${e.utahStatute} · ${e.severity} · NCIC ${e.ncicCode})` : base;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd client && npx vitest run src/constants/__tests__/ncicCodes.test.ts`
Expected: PASS.

- [ ] **Step 5: Spot-verify NCIC numerics (accuracy gate)**

Verify the NCIC offense category codes for theft (2305), DUI (5404), assault (1313), burglary (2204), and controlled-substance possession (3550) against an authoritative NCIC Uniform Offense Classification / NIBRS crosswalk (web search is acceptable). Correct any that differ and re-run the test. Document any change in the commit body.

- [ ] **Step 6: Commit**

```bash
git add client/src/constants/ncicCodes.ts client/src/constants/__tests__/ncicCodes.test.ts
git commit -m "feat(ncic): curated Utah offense table (statute + severity + NCIC code)"
```

---

## Task 5: `lookupAnyCode` for the decoder command

**Files:**
- Modify: `client/src/constants/ncicCodes.ts`
- Test: `client/src/constants/__tests__/ncicCodes.test.ts`

- [ ] **Step 1: Add the failing test**

Append to `ncicCodes.test.ts`:

```ts
import { lookupAnyCode } from '../ncicCodes';

describe('lookupAnyCode (QZ decoder)', () => {
  it('finds a make by label', () => {
    const hits = lookupAnyCode('Toyota');
    expect(hits).toContainEqual({ domain: 'VMA', code: 'TOYT', label: 'Toyota' });
  });
  it('finds a make by code', () => {
    const hits = lookupAnyCode('TOYT');
    expect(hits).toContainEqual({ domain: 'VMA', code: 'TOYT', label: 'Toyota' });
  });
  it('finds a single-letter code across domains', () => {
    const hits = lookupAnyCode('W');
    expect(hits).toContainEqual({ domain: 'RACE', code: 'W', label: 'White' });
  });
  it('returns empty for nonsense', () => {
    expect(lookupAnyCode('zzzqq')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd client && npx vitest run src/constants/__tests__/ncicCodes.test.ts`
Expected: FAIL — `lookupAnyCode` not exported.

- [ ] **Step 3: Implement `lookupAnyCode`**

In `ncicCodes.ts`, append:

```ts
export interface CodeHit { domain: NcicDomain; code: string; label: string; }

/** Search every code table by label OR code, both directions. Powers `QZ`. */
export function lookupAnyCode(term: string | null | undefined): CodeHit[] {
  const t = (term ?? '').trim();
  if (!t) return [];
  const lower = t.toLowerCase();
  const upper = t.toUpperCase();
  const hits: CodeHit[] = [];
  const seen = new Set<string>();
  (Object.keys(TABLES) as NcicDomain[]).forEach((domain) => {
    const table = TABLES[domain];
    // by code
    if (table.toLabel.has(upper)) {
      const key = `${domain}:${upper}`;
      if (!seen.has(key)) { seen.add(key); hits.push({ domain, code: upper, label: table.toLabel.get(upper)! }); }
    }
    // by label/alias
    const code = table.toCode.get(lower);
    if (code) {
      const key = `${domain}:${code}`;
      if (!seen.has(key)) { seen.add(key); hits.push({ domain, code, label: table.toLabel.get(code)! }); }
    }
  });
  return hits;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd client && npx vitest run src/constants/__tests__/ncicCodes.test.ts`
Expected: PASS (all `ncicCodes` tests green).

- [ ] **Step 5: Commit**

```bash
git add client/src/constants/ncicCodes.ts client/src/constants/__tests__/ncicCodes.test.ts
git commit -m "feat(ncic): lookupAnyCode for the QZ decoder command"
```

---

## Task 6: Wire coded rendering into `ncicFormatter.ts`

**Files:**
- Modify: `client/src/utils/ncicFormatter.ts`

> No new unit test file here (the formatter has no existing test harness). Verification is by typecheck + the existing client build, plus the `ncicCodes` unit tests that back every helper. Keep edits surgical.

- [ ] **Step 1: Import the helpers**

At the top of `ncicFormatter.ts`, after the `parseTimestamp` import, add:

```ts
import {
  fmtCoded, formatRaceEthnicity, normalizeHeight, normalizeWeight, fmtOffense,
} from '../constants/ncicCodes';
```

- [ ] **Step 2: Coded person identification — `formatPersonResponse`**

Replace the SEX/RAC and HGT/WGT/EYE/HAI lines (around lines 228–229):

```ts
  // before:
  // lines.push(`  SEX/${pad(person.sex, 1)}  RAC/${pad(person.race, 1)}  DOB/${ncicDate(person.date_of_birth)}`);
  // lines.push(`  HGT/${pad(person.height, 4)}  WGT/${pad(String(person.weight || ''), 3)}  EYE/${pad(person.eye_color, 3)}  HAI/${pad(person.hair_color, 3)}`);
  {
    const { rac, etn } = formatRaceEthnicity(person.race);
    lines.push(`  SEX/${fmtCoded('SEX', person.sex)}  RAC/${rac}  DOB/${ncicDate(person.date_of_birth)}`);
    if (etn) lines.push(`  ETN/${etn}`);
    lines.push(`  HGT/${normalizeHeight(person.height) || pad(person.height, 4)}  WGT/${normalizeWeight(person.weight) || pad(String(person.weight || ''), 3)}  EYE/${fmtCoded('EYE', person.eye_color)}  HAI/${fmtCoded('HAIR', person.hair_color)}`);
  }
```

Replace the OLN/OLS line (around line 232):

```ts
  if (person.drivers_license) {
    lines.push(`  OLN/${pad(person.drivers_license, 15)}  OLS/${fmtCoded('STATE', person.dl_state) || pad(person.dl_state, 2)}`);
  }
```

Replace the criminal-history charge line and warrant charge lines to annotate offenses. In the `criminalHistory` loop (around line 281):

```ts
      lines.push(`  DOO/${ncicDate(ch.offense_date)}  OFL/${pad(ch.offense_level, 3)}  CHG/${fmtOffense(ch.offense)}`);
```

In the warrant loop (around line 268):

```ts
      lines.push(`  CHG/${fmtOffense(w.charge_description || w.type)}`);
```

- [ ] **Step 3: Coded vehicle identification — `formatVehicleResponse`**

Replace the VYR/VMA/VMO and VCO/VST lines (around lines 324–325):

```ts
  lines.push(`  VYR/${pad(String(vehicle.year || ''), 4)}  VMA/${fmtCoded('VMA', vehicle.make) || pad(vehicle.make, 10)}  VMO/${pad(vehicle.model, 15)}`);
  lines.push(`  VCO/${fmtCoded('VCO', vehicle.color) || pad(vehicle.color, 10)}  VST/${fmtCoded('VST', vehicle.style) || pad(vehicle.style, 4)}`);
```

Replace the LIC/LIS line (around line 322):

```ts
  lines.push(`  LIC/${pad(vehicle.plate_number, 10)}  LIS/${fmtCoded('STATE', vehicle.plate_state) || pad(vehicle.plate_state, 2)}`);
```

- [ ] **Step 4: Coded DL — `formatDlResponse`**

Replace the OLN/OLS/STS, CLS, SEX/RAC, HGT lines (around lines 465–475):

```ts
    lines.push(`  OLN/${pad(s.dl_number, 15)}  OLS/${fmtCoded('STATE', s.dl_state) || pad(s.dl_state, 2)}  STS/${pad(s.dl_status, 8)}`);
    lines.push(`  CLS/${fmtCoded('DL_CLASS', s.dl_class) || pad(s.dl_class, 4)}  EXP/${ncicDate(s.dl_expiration)}  ISS/${ncicDate(s.dl_issue_date)}`);
```

and:

```ts
    {
      const { rac, etn } = formatRaceEthnicity(s.race);
      lines.push(`  SEX/${fmtCoded('SEX', s.gender)}  RAC/${rac}  DOB/${ncicDate(s.date_of_birth)}`);
      if (etn) lines.push(`  ETN/${etn}`);
      lines.push(`  HGT/${normalizeHeight(s.height) || pad(s.height, 4)}  WGT/${normalizeWeight(s.weight) || pad(s.weight, 3)}  EYE/${fmtCoded('EYE', s.eye_color)}  HAI/${fmtCoded('HAIR', s.hair_color)}`);
    }
```

- [ ] **Step 5: Coded cross-reference person block — `formatCrossReferenceResponse`**

Replace the SEX/RAC, HGT, OLN lines (around lines 730–732):

```ts
      {
        const { rac, etn } = formatRaceEthnicity(p.race);
        lines.push(`  SEX/${fmtCoded('SEX', p.sex)}  RAC/${rac}  DOB/${ncicDate(p.date_of_birth)}`);
        if (etn) lines.push(`  ETN/${etn}`);
        lines.push(`  HGT/${normalizeHeight(p.height) || pad(p.height, 4)}  WGT/${normalizeWeight(p.weight) || pad(String(p.weight || ''), 3)}  EYE/${fmtCoded('EYE', p.eye_color)}  HAI/${fmtCoded('HAIR', p.hair_color)}`);
      }
      if (p.drivers_license) lines.push(`  OLN/${pad(p.drivers_license, 15)}  OLS/${fmtCoded('STATE', p.dl_state) || pad(p.dl_state, 2)}`);
```

Annotate inline warrant + criminal-history charges (around lines 752 and 762):

```ts
          lines.push(`    ${ncicDate(ch.offense_date)} ${pad(ch.offense_level, 3)} ${fmtOffense(ch.offense)}`);
```

```ts
          lines.push(`    OCA/${pad(w.warrant_number, 15)} CHG/${fmtOffense(w.charge_description || w.type)}`);
```

Also annotate the DL section state (around line 794):

```ts
      lines.push(`  OLN/${pad(s.dl_number, 15)}  OLS/${fmtCoded('STATE', s.dl_state) || pad(s.dl_state, 2)}  STS/${pad(s.dl_status, 8)}`);
```

- [ ] **Step 6: Coded arrest descriptors — `formatArrestResponse` + xref arrest block**

In `formatArrestResponse` (around lines 1039–1048) replace the SEX/RAC and physical descriptor parts to use coded values:

```ts
    if (r.gender) descParts.push(`SEX/${fmtCoded('SEX', r.gender)}`);
    if (r.race) descParts.push(`RAC/${formatRaceEthnicity(r.race).rac}`);
```

```ts
    if (r.height) physParts.push(`HGT/${normalizeHeight(r.height) || pad(r.height.toUpperCase(), 4)}`);
    if (r.weight) physParts.push(`WGT/${normalizeWeight(r.weight) || pad(r.weight, 3)}`);
    if (r.eye_color) physParts.push(`EYE/${fmtCoded('EYE', r.eye_color)}`);
    if (r.hair_color) physParts.push(`HAI/${fmtCoded('HAIR', r.hair_color)}`);
```

Annotate arrest charges (around line 1067–1069):

```ts
      lines.push(`  CHG/${r.charges.length} CHARGE(S):`);
      for (const ch of r.charges) {
        lines.push(`    >> ${fmtOffense(ch)}`);
      }
```

In the xref arrest block (around lines 837–845) apply the same `fmtCoded` for SEX/RAC and `fmtOffense` for the first charge:

```ts
      if (r.gender) descLine.push(`SEX/${fmtCoded('SEX', r.gender)}`);
      if (r.race) descLine.push(`RAC/${formatRaceEthnicity(r.race).rac}`);
```

```ts
        lines.push(`  CHG/${fmtOffense(r.charges[0])}`);
```

- [ ] **Step 7: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add client/src/utils/ncicFormatter.ts
git commit -m "feat(ncic): render coded values (RAC/VMA/VCO/state/offense) in formatter"
```

---

## Task 7: `QZ` decoder command in the terminal

**Files:**
- Modify: `client/src/components/NcicQueryPanel.tsx`

- [ ] **Step 1: Import the decoder**

In `NcicQueryPanel.tsx`, after the `ncicFormatter` import block (line 37), add:

```ts
import { lookupAnyCode, type CodeHit } from '../constants/ncicCodes';
```

- [ ] **Step 2: Add a render helper for the decoder block**

Above the `NcicQueryPanel` component (after `renderColorizedResponse`, around line 106), add:

```ts
const QZ_DOMAIN_LABEL: Record<string, string> = {
  RACE: 'RACE', ETHNICITY: 'ETHNICITY', SEX: 'SEX', EYE: 'EYE COLOR',
  HAIR: 'HAIR COLOR', VMA: 'VEHICLE MAKE', VCO: 'VEHICLE COLOR',
  VST: 'VEHICLE STYLE', STATE: 'STATE', DL_CLASS: 'DL CLASS',
  DL_RESTRICTION: 'DL RESTRICTION', DL_ENDORSEMENT: 'DL ENDORSEMENT',
};

/** Build the NCIC-style text block for a QZ code-translation query. */
function formatCodeDecode(term: string, hits: CodeHit[]): string {
  const ts = new Date();
  const hdr = [
    '*** NCIC RESPONSE ***',
    `ORI/RMPGFLEX01  MKE/QZ  QRY/CODE TRANSLATION`,
    '─'.repeat(60),
    '',
    `  CODE TRANSLATION: ${term.toUpperCase()}`,
    `  ${'─'.repeat(56)}`,
  ];
  if (hits.length === 0) {
    return [...hdr, '', '  NO MATCHING CODE FOUND', '', '─'.repeat(60), '*** END OF RECORD ***'].join('\n');
  }
  const body = hits.map(h => `  ${QZ_DOMAIN_LABEL[h.domain] || h.domain}: ${h.code} (${h.label.toUpperCase()})`);
  return [...hdr, '', ...body, '', `  SUMMARY: ${hits.length} CODE(S) FOUND`, '─'.repeat(60), '*** END OF RECORD ***'].join('\n');
}
```

- [ ] **Step 3: Handle the `QZ` verb in `runQuery`**

In the `switch (verb)` block, add a new case before `default:` (around line 742):

```ts
        case 'QZ': {
          // Code translation / decoder — no backend call
          const hits = lookupAnyCode(queryText);
          response = formatCodeDecode(queryText, hits);
          hasHit = hits.length > 0;
          playTone(hits.length > 0 ? 'info' : 'error');
          break;
        }
```

- [ ] **Step 4: Add `QZ` coloring (optional but consistent)**

`getNcicLineClass` already classifies `ORI/` as a header and `SUMMARY:` as summary, so the decoder block colorizes correctly with no change. Verify visually in Step 6.

- [ ] **Step 5: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/NcicQueryPanel.tsx
git commit -m "feat(ncic): QZ code-translation/decoder command"
```

---

## Task 8: Code-tolerant `QV` + welcome/placeholder copy

**Files:**
- Modify: `client/src/components/NcicQueryPanel.tsx`

- [ ] **Step 1: Expand a typed make code before the vehicle search**

In the `case 'QV':` block, replace the search-text construction so a known make code expands to its label before hitting the server's `LIKE make` query. Change the start of the `QV` case (around line 207):

```ts
        case 'QV': {
          // Vehicle query. If the operator typed an NCIC make code (e.g. TOYT),
          // expand it to the make label so the server's `LIKE make` matches.
          const qvExpanded = decode('VMA', queryText.trim());
          const qvText = qvExpanded !== queryText.trim().toUpperCase() ? qvExpanded : queryText;
          const data = await apiFetch<{
            type: string;
            results: NcicVehicle[];
            query: string;
          }>(`/records/ncic-query?type=vehicle&query=${encodeURIComponent(qvText)}`);
```

Add `decode` to the existing `ncicCodes` import at the top of the file:

```ts
import { lookupAnyCode, decode, type CodeHit } from '../constants/ncicCodes';
```

- [ ] **Step 2: Add `QZ` to both welcome-screen command boxes**

In both `<pre>` welcome blocks (around lines 807–824 and 887–904), add a `QZ` line. Insert after the `QC <name>` line in each box, keeping the box border alignment:

```
║  QZ <code/term> Code Translation         ║
```

- [ ] **Step 3: Update both input placeholders**

Change both `placeholder=` strings (lines 855 and 938) to include `QZ`:

```ts
placeholder="QX SMITH, JOHN | QV PLATE | QZ TOYT | QH NAME"
```

- [ ] **Step 4: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/NcicQueryPanel.tsx
git commit -m "feat(ncic): code-tolerant QV make codes + QZ help/placeholder copy"
```

---

## Task 9: Service-worker cache bump + full verification

**Files:**
- Modify: `client/public/sw.js`

- [ ] **Step 1: Find and bump `CACHE_NAME`**

Run: `grep -n "CACHE_NAME" client/public/sw.js`
Increment the version number in the `CACHE_NAME` constant by one (e.g. `...-v972` → `...-v973`). Use whatever the current value is + 1.

- [ ] **Step 2: Full client test suite**

Run: `cd client && npx vitest run`
Expected: PASS (including the new `ncicCodes` tests).

- [ ] **Step 3: Client typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Client build**

Run: `cd client && npx vite build`
Expected: build completes with no errors.

- [ ] **Step 5: Commit**

```bash
git add client/public/sw.js
git commit -m "chore(ncic): bump SW cache for NCIC data-codes client change"
```

- [ ] **Step 6: Push + open PR**

```bash
git push -u origin feat/ncic-data-codes
gh pr create --title "NCIC/NLETS data codes (Utah + US)" \
  --body "$(cat <<'EOF'
## Summary
Advances the NCIC/NLETS terminal to speak authentic NCIC + Utah data codes.

- New `client/src/constants/ncicCodes.ts` — bidirectional code tables (race/ethnicity, sex, eye, hair, vehicle make/color/style, US states + Canadian provinces, Utah DL class/restriction/endorsement) + curated Utah offense table (statute · severity · NCIC code) + pure helpers.
- `ncicFormatter.ts` renders `CODE (LABEL)` across person / vehicle / DL / arrest / cross-reference (Hispanic shown as ethnicity, height/weight normalized to NCIC form).
- `NcicQueryPanel.tsx` adds the `QZ` code-translation command and code-tolerant `QV` (typed make codes expand before search).
- Unit tests in `client/src/constants/__tests__/ncicCodes.test.ts`.

Client-only — no D1 migration, no server changes. SW cache bumped.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

**Spec coverage:**
- Code+label display → Tasks 1–6 (`fmtCoded`). ✔
- Person descriptors (race/ethnicity/sex/eye/hair/height/weight) → Task 1 + Task 6. ✔
- Vehicle codes (VMA/VCO/VST) → Task 2 + Task 6. ✔
- Geographic/agency (state + Utah DL) → Task 3 + Task 6. ✔
- Offense table (statute + severity + NCIC numeric) → Task 4 + Task 6. ✔
- Hispanic-as-ethnicity → Task 1 (`formatRaceEthnicity`) + Task 6. ✔
- Code-aware input: `QZ` decoder → Tasks 5 + 7; code-tolerant `QV` → Task 8. ✔
- Tests → Tasks 1–5. ✔
- SW bump + PR flow → Task 9. ✔
- Graceful fallback (never throws / raw value) → Task 1 helpers + tests. ✔

**Placeholder scan:** No TBD/TODO. All code steps carry concrete code. Task 4 Step 5 is an accuracy-verification gate (spot-check NCIC numerics), not a placeholder — the values ship real and degrade gracefully if a charge is unmatched.

**Type consistency:** `encode`/`decode`/`fmtCoded`/`formatRaceEthnicity`/`normalizeHeight`/`normalizeWeight`/`lookupOffense`/`fmtOffense`/`lookupAnyCode` and types `NcicDomain`/`OffenseEntry`/`CodeHit` are defined in Tasks 1–5 and consumed with identical signatures in Tasks 6–8. `TABLES` registry kept exhaustive across `NcicDomain` from Task 1 (placeholders) and filled in Tasks 2–3.
