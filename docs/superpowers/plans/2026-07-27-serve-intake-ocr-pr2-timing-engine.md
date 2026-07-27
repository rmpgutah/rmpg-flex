# Serve Intake OCR — PR 2: Briefing Intelligence & Address-Class Timing Engine

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn PR 1's extracted-but-unconsumed fields into the attempt-timing behavior and officer briefing the operator actually asked for.

**Architecture:** Three new pure modules — a client-schedule parser, an address-class resolver, and a window-precedence function — feed `planAttemptWindows`, which stops keying on entity type. `buildPsoBriefing` reads the same fields and splits into seven topical notes. All decision logic stays pure and unit-tested; the route and `commitIntake` only wire values through.

**Tech Stack:** Cloudflare Workers, Hono, Workers AI, D1, Vitest.

**Spec:** [`docs/superpowers/specs/2026-07-26-serve-intake-ocr-enhancement-design.md`](../specs/2026-07-26-serve-intake-ocr-enhancement-design.md) — §3.1, §3.2, §3.3, items 21–40.

**Base:** branch `claude/serve-intake-timing-engine`, cut from `origin/main` after PR 1 (#3092) and its fixes (#3093) merged.

## Global Constraints

- **Operator decision D-2 is binding:** `address_class` is a property of the LOCATION, never the recipient. A registered agent at a residence gets residential timing. `isBusiness` must stop driving window selection; it keeps driving only who may lawfully accept service (URCP 4(d)(1)(E)).
- **Unconfirmed never yields business timing.** `unknown` and unconfirmed both fall through to residential defaults, which are strictly wider. Wrong-toward-residential costs a wasted window; wrong-toward-business costs the service.
- **Operator decision D-1:** entry bodies stay fully uppercase. The PDF applies `.toUpperCase()`; do not fight it. Bold/underline are the only hierarchy signals inside an entry.
- **Fail closed on parsing.** An unparseable client schedule falls back to `address_class` defaults and SAYS SO in the report. Never invent bands.
- **All D1 access is async** — always `await`.
- **Never build an `IN (...)` list from an unbounded array** — D1 caps bound parameters at 100; use `queryInChunks`/`executeInChunks` from `src/utils/db.ts`.
- **Never `SELECT c.*` from `calls_for_service`** (~100-column cap).
- **Structured logging** via `src/utils/logger.ts` (`log.info/warn/error`), never raw `console.*`.
- **No real case data** anywhere. Fixtures under `tests/fixtures/serve-intake/` are under a SHA-256 content ratchet — never modify them.
- **Pure decision functions take `nowIso` as a parameter** — no clock reads inside them.
- **Worker tests:** `npx vitest run tests/<file>`; full suite `npx vitest run`; typecheck `npm run typecheck`.
- **Baseline at branch point: 268 test files / 2328 tests passing, typecheck clean.** Any red is caused by this work.

## File Structure

| File | Responsibility |
|---|---|
| `src/utils/serveScheduleParse.ts` (new) | Parse `client_attempt_schedule` / `service_days_allowed` strings into structured bands and allowed weekdays. Pure. |
| `src/utils/serveAddressClass.ts` (new) | Resolve `address_class` + `confirmed` from extracted fields and existing records (§3.1). Pure. |
| `src/utils/serveAttemptWindows.ts` (new) | The precedence chain (§3.2) producing dated windows with an authority string. Pure. |
| `src/utils/serveDiligencePlanner.ts` (modify) | Delegate window selection to the precedence chain; fix the deadline-clamp collapse (D1) and weekday naming (D5). |
| `src/utils/serveIntakeBriefing.ts` (modify) | Read the new fields; fix the client-window source (D2); split into 7 notes. |
| `src/utils/serveIntakeRecords.ts` (modify) | Wire resolved address class + parsed schedule into the planner and briefing. |
| `src/routes/serveIntake.ts` (modify) | Wire the critic pass; persist validation issues; normalize per-candidate before arbitration. |

---

### Task 1: Client-schedule parser

Spec item 15 (consumption half). PR 1 extracts `client_attempt_schedule` as a canonical string like `06:00-09:00;09:00-18:00;18:00-21:00`; this parses it into bands. Pure, no I/O.

**Files:**
- Create: `src/utils/serveScheduleParse.ts`
- Test: `tests/serveScheduleParse.test.ts`

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces: `parseClientBands(raw: string): TimeBand[]`, `parseAllowedDays(raw: string): number[] | null`, `TimeBand = { start: string; end: string }` (both `HH:MM`, 24-hour).

- [ ] **Step 1: Write the failing test**

```ts
// tests/serveScheduleParse.test.ts
// ============================================================
// Serve Intake — client schedule parsing
// ============================================================
// The extractor emits client_attempt_schedule in a canonical
// 'HH:MM-HH:MM;HH:MM-HH:MM' form. This module turns that into bands the
// window planner can schedule against. Fails CLOSED: anything it cannot
// parse yields [] so the caller falls back to address-class defaults
// rather than inventing an attempt window.
// ============================================================

import { describe, it, expect } from 'vitest';
import { parseClientBands, parseAllowedDays } from '../src/utils/serveScheduleParse';

describe('parseClientBands', () => {
  it('parses the canonical three-band form', () => {
    expect(parseClientBands('06:00-09:00;09:00-18:00;18:00-21:00')).toEqual([
      { start: '06:00', end: '09:00' },
      { start: '09:00', end: '18:00' },
      { start: '18:00', end: '21:00' },
    ]);
  });

  it('parses a single band', () => {
    expect(parseClientBands('09:00-15:30')).toEqual([{ start: '09:00', end: '15:30' }]);
  });

  it('tolerates whitespace and an en-dash separator', () => {
    expect(parseClientBands(' 07:00 – 09:00 ; 17:00-20:30 ')).toEqual([
      { start: '07:00', end: '09:00' },
      { start: '17:00', end: '20:30' },
    ]);
  });

  it('drops a band whose end is not after its start', () => {
    expect(parseClientBands('09:00-09:00;10:00-08:00;11:00-13:00')).toEqual([
      { start: '11:00', end: '13:00' },
    ]);
  });

  it('drops an out-of-range clock value rather than clamping it', () => {
    expect(parseClientBands('25:00-26:00;11:00-13:00')).toEqual([
      { start: '11:00', end: '13:00' },
    ]);
  });

  it('returns empty for unparseable free text — fail closed', () => {
    expect(parseClientBands('mornings are best')).toEqual([]);
    expect(parseClientBands('')).toEqual([]);
  });
});

describe('parseAllowedDays', () => {
  // 0=Sun .. 6=Sat, matching Date#getDay and the planner's existing convention.
  it('maps "all" to every day', () => {
    expect(parseAllowedDays('all')).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('maps "no_sunday" to every day except Sunday', () => {
    expect(parseAllowedDays('no_sunday')).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('maps "weekdays" to Monday through Friday', () => {
    expect(parseAllowedDays('weekdays')).toEqual([1, 2, 3, 4, 5]);
  });

  it('maps a single named day', () => {
    expect(parseAllowedDays('friday')).toEqual([5]);
    expect(parseAllowedDays('SATURDAY')).toEqual([6]);
  });

  it('returns null when it cannot tell — caller keeps its own default', () => {
    expect(parseAllowedDays('')).toBeNull();
    expect(parseAllowedDays('whenever')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/serveScheduleParse.test.ts`
Expected: FAIL — `Failed to resolve import "../src/utils/serveScheduleParse"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/utils/serveScheduleParse.ts
// ============================================================
// RMPG Flex — Serve Intake client-schedule parsing
// ============================================================
// The extraction prompt asks the model to emit client_attempt_schedule
// in a canonical 24-hour form ('06:00-09:00;09:00-18:00'). Real client
// instructions read like "Diligence is 1 between 6AM-9AM, 1 between
// 9AM-6PM and 1 between 6PM-9PM" — the model does that conversion, this
// module only validates and structures the result.
//
// FAIL CLOSED. A band this module cannot parse is DROPPED, and a wholly
// unparseable string yields []. The caller then falls back to
// address-class defaults and says so in the report. Inventing an attempt
// window from a misread instruction is worse than admitting we could not
// read it — the officer would attempt outside the client's authorized
// hours and the service could be challenged.
// ============================================================

export interface TimeBand {
  start: string;   // 'HH:MM', 24-hour
  end: string;     // 'HH:MM', 24-hour, strictly after start
}

const CLOCK = /^([01]?\d|2[0-3]):([0-5]\d)$/;

function toMinutes(hhmm: string): number | null {
  const m = CLOCK.exec(hhmm.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function pad(hhmm: string): string {
  const [h, mm] = hhmm.trim().split(':');
  return `${h.padStart(2, '0')}:${mm}`;
}

export function parseClientBands(raw: string): TimeBand[] {
  if (!raw) return [];
  const out: TimeBand[] = [];
  for (const chunk of raw.split(';')) {
    // Accept ASCII hyphen, en-dash, and em-dash as the range separator —
    // the model and the source documents both use all three.
    const parts = chunk.split(/[-–—]/);
    if (parts.length !== 2) continue;
    const startMin = toMinutes(parts[0]);
    const endMin = toMinutes(parts[1]);
    if (startMin === null || endMin === null) continue;
    if (endMin <= startMin) continue;          // zero-length or inverted → drop
    out.push({ start: pad(parts[0]), end: pad(parts[1]) });
  }
  return out;
}

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const WEEKDAYS = [1, 2, 3, 4, 5];
const DAY_NAMES: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
  thursday: 4, friday: 5, saturday: 6,
};

// Returns null — NOT a default set — when the value carries no day
// information, so the caller can distinguish "client said nothing" from
// "client said every day".
export function parseAllowedDays(raw: string): number[] | null {
  const s = (raw || '').trim().toLowerCase();
  if (!s) return null;
  if (s === 'all' || s === '7 days a week' || s === 'any') return [...ALL_DAYS];
  if (s === 'no_sunday' || s === 'no sunday') return ALL_DAYS.filter((d) => d !== 0);
  if (s === 'weekdays' || s === 'weekday') return [...WEEKDAYS];
  const named = ALL_DAYS.filter((d) => {
    const name = Object.keys(DAY_NAMES).find((k) => DAY_NAMES[k] === d)!;
    return s.includes(name);
  });
  return named.length ? named : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/serveScheduleParse.test.ts`
Expected: PASS — 11 tests.

- [ ] **Step 5: Commit**

```bash
git add src/utils/serveScheduleParse.ts tests/serveScheduleParse.test.ts
git commit -m "feat(serve-intake): parse client attempt bands and allowed service days"
```

---

### Task 2: Address-class resolver

Spec §3.1 and item 24's precondition. Pure.

**Files:**
- Create: `src/utils/serveAddressClass.ts`
- Test: `tests/serveAddressClass.test.ts`

**Interfaces:**
- Consumes: `ExtractedField` from `src/utils/serveIntakeExtract`.
- Produces: `resolveAddressClass(input: AddressClassInput): AddressClassResult` where
  `AddressClassInput = { extracted?: string; operatorOverride?: string; propertyRecordClass?: string; businessRecordMatched?: boolean; instructionsText?: string }`
  and `AddressClassResult = { klass: 'residential' | 'business' | 'unknown'; confirmed: boolean; source: string }`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/serveAddressClass.test.ts
// ============================================================
// Address-class resolution (spec §3.1)
// ============================================================
// BINDING RULE (operator decision D-2): address class describes the
// LOCATION, never the recipient. A registered agent is frequently at a
// residence, and a residence needs residential attempt windows.
// Unconfirmed must never yield business timing.
// ============================================================

import { describe, it, expect } from 'vitest';
import { resolveAddressClass } from '../src/utils/serveAddressClass';

describe('resolveAddressClass', () => {
  it('an operator override wins over everything else', () => {
    const r = resolveAddressClass({
      operatorOverride: 'residential',
      extracted: 'business',
      propertyRecordClass: 'business',
    });
    expect(r).toEqual({ klass: 'residential', confirmed: true, source: 'operator' });
  });

  it('an existing property record outranks the extracted value', () => {
    const r = resolveAddressClass({ extracted: 'business', propertyRecordClass: 'residential' });
    expect(r.klass).toBe('residential');
    expect(r.confirmed).toBe(true);
    expect(r.source).toBe('property_record');
  });

  it('a matched business record confirms business', () => {
    const r = resolveAddressClass({ businessRecordMatched: true });
    expect(r).toEqual({ klass: 'business', confirmed: true, source: 'business_record' });
  });

  it('uses the extracted value when nothing outranks it, but marks it unconfirmed', () => {
    const r = resolveAddressClass({ extracted: 'business' });
    expect(r.klass).toBe('business');
    expect(r.confirmed).toBe(false);
    expect(r.source).toBe('extracted');
  });

  it('reads explicit packet language when no field was extracted', () => {
    const r = resolveAddressClass({ instructionsText: 'BUSINESS ADDRESS. Serve during hours.' });
    expect(r.klass).toBe('business');
    expect(r.source).toBe('packet_language');
  });

  it('does NOT treat a registered-agent mention as a business address', () => {
    // D-2: agents are frequently at residences.
    const r = resolveAddressClass({ instructionsText: 'Serve the registered agent at this address' });
    expect(r.klass).toBe('unknown');
    expect(r.confirmed).toBe(false);
  });

  it('returns unknown/unconfirmed when there is nothing to go on', () => {
    expect(resolveAddressClass({})).toEqual({ klass: 'unknown', confirmed: false, source: 'none' });
  });

  it('never reports confirmed for an unknown class', () => {
    const r = resolveAddressClass({ extracted: 'unknown' });
    expect(r.klass).toBe('unknown');
    expect(r.confirmed).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/serveAddressClass.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/utils/serveAddressClass.ts
// ============================================================
// RMPG Flex — Serve Intake address-class resolution (spec §3.1)
// ============================================================
// BINDING OPERATOR DECISION (D-2): address class is a property of the
// LOCATION, never the recipient. A registered agent is frequently at a
// residence, and serving a residence needs residential windows
// (evenings, weekends) rather than business hours. The corporate/agent
// role continues to drive WHO may accept service — that is a separate
// concern handled in the briefing's SERVICE AUTHORITY section.
//
// Resolution order, first hit wins:
//   1. operator confirmation at review
//   2. an existing properties/businesses record
//   3. explicit packet language
//   4. the extracted address_class field
//   5. unknown
//
// UNCONFIRMED NEVER YIELDS BUSINESS TIMING. `unknown` and unconfirmed
// both fall through to residential defaults downstream, which are
// strictly wider. Being wrong that way costs one unnecessary attempt
// window; being wrong the other way puts a server outside a house at
// 10:00 on a Tuesday and the service fails.
// ============================================================

export type AddressClass = 'residential' | 'business' | 'unknown';

export interface AddressClassInput {
  operatorOverride?: string;      // explicit choice on the review screen
  propertyRecordClass?: string;   // from an existing properties row
  businessRecordMatched?: boolean;// an existing businesses row matched this address
  instructionsText?: string;      // raw client instructions / field-sheet text
  extracted?: string;             // the model's address_class field
}

export interface AddressClassResult {
  klass: AddressClass;
  confirmed: boolean;
  source: 'operator' | 'property_record' | 'business_record' | 'packet_language' | 'extracted' | 'none';
}

const BUSINESS_LANGUAGE = /\b(business address|place of employment|commercial address|corporate address)\b/i;
const RESIDENTIAL_LANGUAGE = /\b(residence|residential address|abode|dwelling|home address)\b/i;

function coerce(raw: string | undefined): AddressClass | null {
  const s = (raw || '').trim().toLowerCase();
  if (s === 'residential' || s === 'business') return s;
  return null;
}

export function resolveAddressClass(input: AddressClassInput): AddressClassResult {
  const override = coerce(input.operatorOverride);
  if (override) return { klass: override, confirmed: true, source: 'operator' };

  const fromProperty = coerce(input.propertyRecordClass);
  if (fromProperty) return { klass: fromProperty, confirmed: true, source: 'property_record' };

  if (input.businessRecordMatched) {
    return { klass: 'business', confirmed: true, source: 'business_record' };
  }

  const text = input.instructionsText || '';
  // Residential is checked FIRST: if a string carries both signals, the
  // safe direction is residential (wider windows). See D-2.
  if (RESIDENTIAL_LANGUAGE.test(text)) {
    return { klass: 'residential', confirmed: false, source: 'packet_language' };
  }
  if (BUSINESS_LANGUAGE.test(text)) {
    return { klass: 'business', confirmed: false, source: 'packet_language' };
  }

  const fromExtract = coerce(input.extracted);
  if (fromExtract) return { klass: fromExtract, confirmed: false, source: 'extracted' };

  return { klass: 'unknown', confirmed: false, source: 'none' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/serveAddressClass.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/utils/serveAddressClass.ts tests/serveAddressClass.test.ts
git commit -m "feat(serve-intake): resolve address class from location evidence, not entity type"
```

---

### Task 3: Window precedence chain

Spec §3.2, items 21–23, 25, 26, 29, 30. Pure — this is the heart of PR 2.

**Files:**
- Create: `src/utils/serveAttemptWindows.ts`
- Test: `tests/serveAttemptWindows.test.ts`

**Interfaces:**
- Consumes: `TimeBand` from `serveScheduleParse`, `AddressClass` from `serveAddressClass`.
- Produces: `selectWindows(input: WindowInput): WindowSpec[]` where
  `WindowSpec = { window: string; focus: string; authority: 'client-specified' | 'site note' | 'residential default' | 'business default' }`
  and `WindowInput = { addressClass: AddressClass; clientBands: TimeBand[]; locationNote?: { hours_start?: string | null; hours_end?: string | null; cutoff_time?: string | null } | null }`.
  Also `scheduleFitsDeadline(bandCount: number, daysRemaining: number | null): boolean`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/serveAttemptWindows.test.ts
// ============================================================
// Attempt-window precedence (spec §3.2)
// ============================================================
// Precedence, descending:
//   1. client_attempt_schedule bands
//   2. location-note constraints
//   3. address_class defaults
//   4. generic doctrine (the residential default set)
// ============================================================

import { describe, it, expect } from 'vitest';
import { selectWindows, scheduleFitsDeadline } from '../src/utils/serveAttemptWindows';

describe('selectWindows precedence', () => {
  it('client bands win over everything', () => {
    const out = selectWindows({
      addressClass: 'business',
      clientBands: [{ start: '06:00', end: '09:00' }, { start: '18:00', end: '21:00' }],
      locationNote: { hours_start: '08:00', hours_end: '17:00' },
    });
    expect(out.map((w) => w.window)).toEqual(['06:00-09:00', '18:00-21:00']);
    expect(out.every((w) => w.authority === 'client-specified')).toBe(true);
  });

  it('falls to the location note when the client said nothing', () => {
    const out = selectWindows({
      addressClass: 'business',
      clientBands: [],
      locationNote: { hours_start: '08:00', hours_end: '17:00' },
    });
    expect(out.every((w) => w.authority === 'site note')).toBe(true);
    expect(out.length).toBeGreaterThan(0);
  });

  it('uses business defaults for a confirmed business location', () => {
    const out = selectWindows({ addressClass: 'business', clientBands: [], locationNote: null });
    expect(out.every((w) => w.authority === 'business default')).toBe(true);
    expect(out.map((w) => w.window)).toEqual(['09:30-11:30', '13:30-15:30']);
  });

  it('uses residential defaults for a residence', () => {
    const out = selectWindows({ addressClass: 'residential', clientBands: [], locationNote: null });
    expect(out.every((w) => w.authority === 'residential default')).toBe(true);
    expect(out.map((w) => w.window)).toEqual(['07:00-09:00', '11:00-13:00', '17:00-20:30']);
  });

  it('treats UNKNOWN as residential — the wider, safer set (D-2)', () => {
    const unknown = selectWindows({ addressClass: 'unknown', clientBands: [], locationNote: null });
    const residential = selectWindows({ addressClass: 'residential', clientBands: [], locationNote: null });
    expect(unknown.map((w) => w.window)).toEqual(residential.map((w) => w.window));
  });

  it('every window carries an authority string so the report can say why', () => {
    const out = selectWindows({ addressClass: 'residential', clientBands: [], locationNote: null });
    expect(out.every((w) => typeof w.authority === 'string' && w.authority.length > 0)).toBe(true);
  });
});

describe('scheduleFitsDeadline', () => {
  it('is true when there are at least as many days as required bands', () => {
    expect(scheduleFitsDeadline(3, 5)).toBe(true);
    expect(scheduleFitsDeadline(3, 3)).toBe(true);
  });

  it('is false when the client demands more distinct days than remain', () => {
    expect(scheduleFitsDeadline(3, 2)).toBe(false);
  });

  it('is true when there is no deadline to violate', () => {
    expect(scheduleFitsDeadline(3, null)).toBe(true);
  });

  it('is false when the deadline has already passed', () => {
    expect(scheduleFitsDeadline(1, -1)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/serveAttemptWindows.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/utils/serveAttemptWindows.ts
// ============================================================
// RMPG Flex — attempt-window precedence (spec §3.2)
// ============================================================
// One auditable function decides WHICH time bands to attempt in.
// Precedence, descending:
//   1. client_attempt_schedule — the client dictated hours; attempting
//      outside them can be challenged in court
//   2. location-note constraints — a recorded site notation
//   3. address_class defaults
//   4. generic doctrine (residential defaults)
//
// Every emitted window carries an `authority` string so the officer's
// briefing can print WHY that window was chosen rather than presenting
// a bare time range as if it were arbitrary.
// ============================================================

import type { TimeBand } from './serveScheduleParse';
import type { AddressClass } from './serveAddressClass';

export type WindowAuthority =
  | 'client-specified'
  | 'site note'
  | 'residential default'
  | 'business default';

export interface WindowSpec {
  window: string;              // 'HH:MM-HH:MM'
  focus: string;               // why this band
  authority: WindowAuthority;
}

export interface WindowInput {
  addressClass: AddressClass;
  clientBands: TimeBand[];
  locationNote?: {
    hours_start?: string | null;
    hours_end?: string | null;
    cutoff_time?: string | null;
  } | null;
}

// Residential hit rates peak pre-work and post-work; midday catches
// shift workers and the retired.
const RESIDENTIAL_DEFAULTS: WindowSpec[] = [
  { window: '07:00-09:00', focus: 'early morning — catch before work departure', authority: 'residential default' },
  { window: '11:00-13:00', focus: 'midday — vary the pattern', authority: 'residential default' },
  { window: '17:00-20:30', focus: 'evening — highest residential hit rate', authority: 'residential default' },
];

const BUSINESS_DEFAULTS: WindowSpec[] = [
  { window: '09:30-11:30', focus: 'mid-morning — after the opening rush', authority: 'business default' },
  { window: '13:30-15:30', focus: 'early afternoon — before end-of-day cutoff', authority: 'business default' },
];

export function selectWindows(input: WindowInput): WindowSpec[] {
  // 1. Client-dictated bands.
  if (input.clientBands.length) {
    return input.clientBands.map((b) => ({
      window: `${b.start}-${b.end}`,
      focus: 'client-specified attempt band — do not attempt outside these hours',
      authority: 'client-specified' as const,
    }));
  }

  // 2. Location-note hours.
  const note = input.locationNote;
  if (note?.hours_start) {
    const end = note.cutoff_time || note.hours_end || '17:00';
    return [
      { window: `${note.hours_start}-${end}`, focus: `per site notation: attempt within noted hours`, authority: 'site note' },
    ];
  }

  // 3/4. Address-class defaults. UNKNOWN falls to residential — the
  // wider set — per operator decision D-2.
  return input.addressClass === 'business'
    ? BUSINESS_DEFAULTS.map((w) => ({ ...w }))
    : RESIDENTIAL_DEFAULTS.map((w) => ({ ...w }));
}

// A client schedule that demands N distinct days cannot be satisfied in
// fewer than N days. The briefing flags this explicitly rather than
// silently producing a plan that violates the client's own instruction.
export function scheduleFitsDeadline(bandCount: number, daysRemaining: number | null): boolean {
  if (daysRemaining === null) return true;
  if (daysRemaining < 0) return false;
  return daysRemaining >= bandCount;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/serveAttemptWindows.test.ts`
Expected: PASS — 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/utils/serveAttemptWindows.ts tests/serveAttemptWindows.test.ts
git commit -m "feat(serve-intake): attempt-window precedence with authority attribution"
```

---

### Task 4: Planner — stop keying on `isBusiness`, fix the date collapse

Items 24, 27, 28. This is the behavior change operator decision D-2 asked for.

**Files:**
- Modify: `src/utils/serveDiligencePlanner.ts`
- Test: `tests/serveDiligencePlanner.test.ts` (existing file — APPEND, do not weaken existing assertions)

**Interfaces:**
- Consumes: `selectWindows`/`scheduleFitsDeadline` (Task 3), `parseAllowedDays` (Task 1), `resolveAddressClass`'s `AddressClass` type (Task 2).
- Produces: extended `PlanOptions` — adds `addressClass?: AddressClass`, `clientBands?: TimeBand[]`, `allowedDays?: number[] | null`, `startNotBefore?: string | null`. `AttemptWindow` gains `authority: WindowAuthority` and `weekday` becomes the full name.

- [ ] **Step 1: Write the failing test**

```ts
// APPEND to tests/serveDiligencePlanner.test.ts
import { planAttemptWindows } from '../src/utils/serveDiligencePlanner';

describe('D-2: timing keys off address class, not entity type', () => {
  it('a business ENTITY at a residential address gets residential windows', () => {
    // A registered agent at a house. isBusiness is true (corporate service)
    // but the LOCATION is a residence, so evenings must be scheduled.
    const plan = planAttemptWindows('2026-07-27T12:00:00Z', null, 'America/Denver', {
      isBusiness: true,
      addressClass: 'residential',
    });
    expect(plan.some((w) => w.window === '17:00-20:30')).toBe(true);
    expect(plan.every((w) => w.authority === 'residential default')).toBe(true);
  });

  it('an unknown address class is treated as residential', () => {
    const plan = planAttemptWindows('2026-07-27T12:00:00Z', null, 'America/Denver', {
      isBusiness: true,
      addressClass: 'unknown',
    });
    expect(plan.some((w) => w.window === '17:00-20:30')).toBe(true);
  });

  it('a confirmed business location gets business windows', () => {
    const plan = planAttemptWindows('2026-07-27T12:00:00Z', null, 'America/Denver', {
      isBusiness: false,
      addressClass: 'business',
    });
    expect(plan.every((w) => w.authority === 'business default')).toBe(true);
  });
});

describe('D1: the deadline clamp must not collapse attempts onto one date', () => {
  it('produces distinct dates when the deadline is tight', () => {
    // Deadline two days out, three attempts required. Previously every
    // offset past the deadline was clamped to the same day, so attempts
    // 2 and 3 printed on the same date.
    const plan = planAttemptWindows('2026-07-27T12:00:00Z', '2026-07-28', 'America/Denver', {
      addressClass: 'residential',
    });
    const dates = plan.map((w) => w.date);
    const windows = plan.map((w) => `${w.date} ${w.window}`);
    // Either the dates differ, or same-day attempts occupy DIFFERENT bands.
    expect(new Set(windows).size).toBe(plan.length);
    expect(dates.length).toBe(plan.length);
  });

  it('never emits two attempts in the same band on the same date', () => {
    const plan = planAttemptWindows('2026-07-27T12:00:00Z', '2026-07-27', 'America/Denver', {
      addressClass: 'residential',
    });
    const keys = plan.map((w) => `${w.date}|${w.window}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('D5: weekday names are spelled out', () => {
  it('emits full weekday names, not three-letter abbreviations', () => {
    const plan = planAttemptWindows('2026-07-27T12:00:00Z', null, 'America/Denver', {
      addressClass: 'residential',
    });
    for (const w of plan) {
      expect(w.weekday).toMatch(/^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)$/);
    }
  });
});

describe('client constraints', () => {
  it('never schedules a prohibited day', () => {
    // allowedDays excludes Sunday (0).
    const plan = planAttemptWindows('2026-07-27T12:00:00Z', null, 'America/Denver', {
      addressClass: 'residential',
      allowedDays: [1, 2, 3, 4, 5, 6],
    });
    expect(plan.every((w) => w.weekday !== 'Sunday')).toBe(true);
  });

  it('never schedules before the client start-date bar', () => {
    const plan = planAttemptWindows('2026-07-27T12:00:00Z', null, 'America/Denver', {
      addressClass: 'residential',
      startNotBefore: '2026-07-30',
    });
    expect(plan.every((w) => w.date >= '2026-07-30')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/serveDiligencePlanner.test.ts`
Expected: FAIL — `addressClass` is not an accepted option and `authority` is undefined on the result.

- [ ] **Step 3: Write the implementation**

In `src/utils/serveDiligencePlanner.ts`:

a) Extend the interfaces:

```ts
import type { TimeBand } from './serveScheduleParse';
import type { AddressClass } from './serveAddressClass';
import { selectWindows, type WindowAuthority } from './serveAttemptWindows';

export interface AttemptWindow {
  attempt: number;
  date: string;               // YYYY-MM-DD (America/Denver)
  weekday: string;            // FULL name — 'Monday', not 'Mon' (D5)
  window: string;             // '17:00-20:30'
  focus: string;
  authority: WindowAuthority; // why this band was chosen
  constrained?: boolean;
}

export interface PlanOptions {
  /** @deprecated for TIMING. Retained because callers still pass it and
   *  it still drives who may accept service. Per operator decision D-2 it
   *  MUST NOT select attempt windows — addressClass does that. */
  isBusiness?: boolean;
  addressClass?: AddressClass;
  clientBands?: TimeBand[];
  allowedDays?: number[] | null;
  startNotBefore?: string | null;
  locationNote?: {
    days_available?: number[] | null;
    hours_start?: string | null;
    hours_end?: string | null;
    cutoff_time?: string | null;
  } | null;
}
```

b) Replace the `localParts` weekday format with the full name (D5):

```ts
function localParts(d: Date, tz: string): { date: string; weekday: string; dowNum: number } {
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d);
  // 'long' — D5: the report reads "MONDAY", not "MON".
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long' }).format(d);
  const dowNum = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].indexOf(weekday);
  return { date, weekday, dowNum };
}
```

c) Replace the whole slot-selection block (the `if (locationNote?.hours_start) … else if (isBusiness) … else` chain) with a call into the precedence function, and fix the clamp (D1):

```ts
  const specs = selectWindows({
    addressClass: options.addressClass ?? 'unknown',
    clientBands: options.clientBands ?? [],
    locationNote: locationNote ?? null,
  });

  // Allowed days: client constraint > location note > address-class default.
  let allowedDows: Set<number>;
  if (options.allowedDays && options.allowedDays.length) {
    allowedDows = new Set(options.allowedDays);
  } else if (locationNote?.days_available?.length) {
    allowedDows = new Set(locationNote.days_available);
  } else if ((options.addressClass ?? 'unknown') === 'business') {
    allowedDows = WEEKDAYS;
  } else {
    allowedDows = new Set([0, 1, 2, 3, 4, 5, 6]);
  }

  // Earliest permitted offset honours the client's start-date bar.
  let minOffset = 0;
  if (options.startNotBefore && /^\d{4}-\d{2}-\d{2}$/.test(options.startNotBefore)) {
    for (let o = 0; o < 60; o++) {
      const { date } = localParts(new Date(now.getTime() + o * DAY_MS), tz);
      if (date >= options.startNotBefore) { minOffset = o; break; }
    }
  }

  const result: AttemptWindow[] = [];
  const used = new Set<string>();   // `${date}|${window}` — D1 guard
  let lastOffset = minOffset - 1;

  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i];
    let offset = nextAllowedDay(now, Math.max(minOffset, lastOffset + 1), allowedDows, tz);

    // D1 FIX: clamping to the deadline used to pin every remaining slot to
    // the SAME day, so attempts 2 and 3 printed on one date. Clamp, then
    // walk back to the earliest date whose (date, band) pair is still
    // free — distinct bands on one day are a valid tight-deadline plan;
    // duplicate (date, band) pairs are not.
    if (days !== null && offset > days) offset = Math.max(minOffset, days);

    let key = '';
    for (let guard = 0; guard < 30; guard++) {
      const { date } = localParts(new Date(now.getTime() + offset * DAY_MS), tz);
      key = `${date}|${spec.window}`;
      if (!used.has(key)) break;
      offset++;                       // same band already used that day → next day
      if (days !== null && offset > days) { offset = Math.max(minOffset, days); break; }
    }
    used.add(key);

    const { date, weekday } = localParts(new Date(now.getTime() + offset * DAY_MS), tz);
    result.push({
      attempt: i + 1,
      date,
      weekday,
      window: spec.window,
      focus: spec.focus,
      authority: spec.authority,
      constrained,
    });
    lastOffset = offset;
  }

  return result;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/serveDiligencePlanner.test.ts`
Expected: PASS — existing tests plus the 8 new ones.

- [ ] **Step 5: Run the full suite (other callers depend on this shape)**

Run: `npm run typecheck && npx vitest run`
Expected: 0 type errors. `serveAutoReplan.ts` and `serveIntake.ts:1727` also call `planAttemptWindows`; if the new required `authority` field breaks them, fix the call sites rather than making the field optional — the whole point is that every window states its authority.

- [ ] **Step 6: Commit**

```bash
git add src/utils/serveDiligencePlanner.ts tests/serveDiligencePlanner.test.ts
git commit -m "fix(serve-intake): timing keys off address class; distinct dates under a tight deadline"
```

---

### Task 5: Wire the timing inputs at commit

Items 21, 25, 26 — the plumbing that makes Tasks 1–4 live.

**Files:**
- Modify: `src/utils/serveIntakeRecords.ts` (the `planAttemptWindows` call at ~line 693)
- Test: `tests/serveIntakeCommitIntake.test.ts` (existing — APPEND)

**Interfaces:**
- Consumes: `resolveAddressClass` (Task 2), `parseClientBands`/`parseAllowedDays` (Task 1), extended `PlanOptions` (Task 4).
- Produces: no new exports; `attemptPlan` now carries `authority` and honours client constraints.

- [ ] **Step 1: Write the failing test**

```ts
// APPEND to tests/serveIntakeCommitIntake.test.ts
// These assert the WIRING — that commitIntake threads the extracted
// timing fields into the planner. The planner's own behavior is covered
// by tests/serveDiligencePlanner.test.ts.

import { resolveAddressClass } from '../src/utils/serveAddressClass';
import { parseClientBands, parseAllowedDays } from '../src/utils/serveScheduleParse';
import { planAttemptWindows } from '../src/utils/serveDiligencePlanner';

describe('commit-time timing wiring', () => {
  it('a client schedule reaches the plan as client-specified windows', () => {
    const bands = parseClientBands('06:00-09:00;09:00-18:00;18:00-21:00');
    const plan = planAttemptWindows('2026-07-27T12:00:00Z', null, 'America/Denver', {
      addressClass: resolveAddressClass({ extracted: 'residential' }).klass,
      clientBands: bands,
      allowedDays: parseAllowedDays('no_sunday'),
    });
    expect(plan.every((w) => w.authority === 'client-specified')).toBe(true);
    expect(plan.every((w) => w.weekday !== 'Sunday')).toBe(true);
  });

  it('a business ENTITY served at a residence still gets residential windows', () => {
    const klass = resolveAddressClass({ extracted: 'residential' }).klass;
    const plan = planAttemptWindows('2026-07-27T12:00:00Z', null, 'America/Denver', {
      isBusiness: true,
      addressClass: klass,
      clientBands: [],
    });
    expect(plan.some((w) => w.window === '17:00-20:30')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/serveIntakeCommitIntake.test.ts`
Expected: FAIL — imports resolve but `authority` is absent until Task 4 is in; if Task 4 is already committed this passes trivially, which is fine — its purpose is to pin the wiring contract.

- [ ] **Step 3: Wire it in `serveIntakeRecords.ts`**

Replace the `planAttemptWindows` call at ~line 693:

```ts
  // Address class describes the LOCATION (operator decision D-2). A
  // registered agent at a residence gets residential windows; isBusiness
  // no longer selects timing, only who may accept service.
  const addressClassResult = resolveAddressClass({
    propertyRecordClass: propertyRecord?.address_class ?? undefined,
    businessRecordMatched: !!businessRecord && isBusiness,
    instructionsText: queueRow.service_instructions || '',
    extracted: get('address_class'),
  });

  const clientBands = parseClientBands(get('client_attempt_schedule'));
  const allowedDays = parseAllowedDays(get('service_days_allowed'));
  const startNotBefore = get('attempt_start_not_before') || null;

  const attemptPlan = planAttemptWindows(nowIso, queueRow.deadline, 'America/Denver', {
    isBusiness,
    addressClass: addressClassResult.klass,
    clientBands,
    allowedDays,
    startNotBefore,
    locationNote,
  });

  log.info('serve-intake attempt plan', {
    address_class: addressClassResult.klass,
    class_source: addressClassResult.source,
    confirmed: addressClassResult.confirmed,
    client_bands: clientBands.length,
    authority: attemptPlan[0]?.authority ?? 'none',
  });
```

Add the imports at the top of the file:

```ts
import { resolveAddressClass } from './serveAddressClass';
import { parseClientBands, parseAllowedDays } from './serveScheduleParse';
```

If `propertyRecord` has no `address_class` property on its interface, add it as `address_class?: string | null` to the `PropertyRecord` interface in `src/utils/serveIntakeBriefing.ts` and select it in the property lookup query — report if that column does not exist on the live table, and pass `undefined` rather than inventing a column.

- [ ] **Step 4: Run tests**

Run: `npm run typecheck && npx vitest run`
Expected: 0 type errors, all green.

- [ ] **Step 5: Commit**

```bash
git add src/utils/serveIntakeRecords.ts tests/serveIntakeCommitIntake.test.ts
git commit -m "feat(serve-intake): thread address class and client schedule into the planner"
```

---

### Task 6: Briefing content — fix D2 and make authority address-class aware

Items 31–36.

**Files:**
- Modify: `src/utils/serveIntakeBriefing.ts`
- Test: `tests/serveIntakeBriefing.test.ts` (create if absent)

**Interfaces:**
- Consumes: the `fields` map already passed to `buildPsoBriefing`; `AttemptWindow.authority` (Task 4).
- Produces: `clientWindowText(queueRow): string | null` exported for test; `serviceAuthorityLines` gains an `addressClass` parameter.

- [ ] **Step 1: Write the failing test**

```ts
// tests/serveIntakeBriefing.test.ts
import { describe, it, expect } from 'vitest';
import { clientWindowText, assessOfficerSafety } from '../src/utils/serveIntakeBriefing';

const baseRow = {
  recipient_name: 'DANA WHITFIELD', recipient_address: '1180 E VINE ST',
  recipient_city: 'SALT LAKE CITY', recipient_state: 'UT', recipient_zip: '84121',
  document_type: 'subpoena', case_number: '900904528', court_name: 'THIRD DISTRICT',
  jurisdiction: 'UT', client_name: 'ICU', attorney_name: null,
  priority: 'rush' as const, deadline: '2026-06-30', service_instructions: null,
  notes: null, plaintiff: 'AVERY HOLT', defendant: 'NORTHGATE LOGISTICS, LLC',
  court_date: null,
};

describe('D2: client windows are read from service_instructions, not just notes', () => {
  it('finds a client restriction stated in service_instructions', () => {
    const row = { ...baseRow, service_instructions: 'Diligence is 1 between 6AM-9AM, 1 between 9AM-6PM.' };
    expect(clientWindowText(row)).toContain('6AM-9AM');
  });

  it('still finds one stated in notes', () => {
    const row = { ...baseRow, notes: 'SERVE ON FRIDAY BETWEEN 9AM AND 3:30PM' };
    expect(clientWindowText(row)).toContain('FRIDAY');
  });

  it('ignores the OCR provenance line that notes carries', () => {
    const row = { ...baseRow, notes: '[OCR intake 2026-07-27: 3/3 docs read, 92% confidence]' };
    expect(clientWindowText(row)).toBeNull();
  });

  it('returns null when the client genuinely specified nothing', () => {
    expect(clientWindowText(baseRow)).toBeNull();
  });
});

describe('officer safety remains unchanged by this task', () => {
  it('still returns a baseline caution for a routine civil paper', () => {
    const a = assessOfficerSafety({}, baseRow);
    expect(a.caution).toBe(true);
    expect(a.severity).toBe('baseline');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/serveIntakeBriefing.test.ts`
Expected: FAIL — `clientWindowText` is not exported.

- [ ] **Step 3: Implement**

a) Extract and export the client-window lookup, reading BOTH sources (D2 fix). Replace the `const clientWindows = (queueRow.notes || '').split('\n')[0]?.trim();` line:

```ts
// D2 FIX: the client's attempt restriction is written in
// service_instructions far more often than in notes, and notes' first
// line is usually the OCR provenance stamp. Reading only notes[0] made
// the report print "no client restriction" on packets whose own
// description quoted the client's schedule.
export function clientWindowText(queueRow: QueueRow): string | null {
  const candidates = [queueRow.service_instructions, queueRow.notes];
  for (const raw of candidates) {
    if (!raw) continue;
    for (const line of raw.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      if (t.startsWith('[OCR')) continue;           // provenance stamp, not a restriction
      if (!/\d\s*(am|pm|:)/i.test(t) && !/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(t)) continue;
      return t;
    }
  }
  return null;
}
```

b) Make service authority address-class aware (item 32). Change the signature to `serviceAuthorityLines(isBusiness: boolean, hint: string, addressClass: AddressClass)` and add, before the generic individual lines:

```ts
  if (!isBusiness && addressClass === 'business') {
    lines.push('SERVICE AT A PLACE OF EMPLOYMENT: substitute service on a co-worker is NOT dwelling substitute service. Unless the client expressly authorizes it, the recipient must be served PERSONALLY at a business address.');
  }
```

c) Surface the witness fee (item 33). In `buildBriefingNoteText`, inside the documents block:

```ts
  if (f('witness_fee_instrument')) {
    lines.push(`__CARRY WITH YOU: ${f('witness_fee_instrument')}__ — a witness fee must be tendered at service. Arriving without it fails the attempt.`);
  }
```

d) Distinguish the party being served from the case parties (item 34):

```ts
  const target = queueRow.recipient_name || '';
  const isCaseParty = [queueRow.plaintiff, queueRow.defendant]
    .filter(Boolean)
    .some((p) => (p || '').toLowerCase().includes(target.toLowerCase()) && target.length > 3);
  if (parties && target && !isCaseParty) {
    lines.push(`NOTE: ${target} is NOT a named party in this case — they are a non-party recipient (typical for a subpoena). Do not discuss the case; refer questions to the issuing court or hiring attorney.`);
  }
```

e) Out-of-state issuing court (item 35):

```ts
  const courtState = (queueRow.jurisdiction || '').trim().toUpperCase();
  const serviceState = (queueRow.recipient_state || '').trim().toUpperCase();
  if (courtState && serviceState && courtState !== serviceState) {
    lines.push(`OUT-OF-STATE PROCESS: the issuing court is in ${courtState} and service is in ${serviceState}. Under the Uniform Interstate Depositions and Discovery Act the subpoena must be domesticated in the service state — confirm with the hiring party that this has been done before attempting.`);
  }
```

f) Document checklist (item 36):

```ts
  const docList = (f('documents_to_serve') || '').split(';').map((s) => s.trim()).filter(Boolean);
  if (docList.length > 1) {
    lines.push('**■ DOCUMENT CHECKLIST** — confirm every item is in the packet before departing:');
    for (const d of docList) lines.push(`- [ ] ${d}`);
  }
```

g) Print each window's authority (item 29) in the attempt-plan block:

```ts
    for (const w of input.attemptPlan) {
      lines.push(`• Attempt ${w.attempt}: ${w.weekday} ${w.date}, ${w.window}  (${w.focus}) [${w.authority}]`);
    }
```

h) Flag an impossible client schedule (item 30):

```ts
    if (input.scheduleImpossible) {
      lines.push('__WARNING: the client\'s own attempt schedule requires more distinct days than remain before the deadline.__ Notify the hiring party — either the deadline moves or the schedule does. Do not silently attempt fewer times.');
    }
```

Add `scheduleImpossible?: boolean` to `BriefingInput`, and compute it at the call site in `serveIntakeRecords.ts` with `scheduleFitsDeadline(clientBands.length || 3, daysUntilDeadline(nowIso, queueRow.deadline))`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/serveIntakeBriefing.test.ts && npm run typecheck && npx vitest run`
Expected: PASS, 0 type errors.

- [ ] **Step 5: Commit**

```bash
git add src/utils/serveIntakeBriefing.ts src/utils/serveIntakeRecords.ts tests/serveIntakeBriefing.test.ts
git commit -m "fix(serve-intake): read client windows from instructions; address-class-aware authority"
```

---

### Task 7: Split the briefing into seven topical entries

Items 37–40 plus spec §3.3. The PDF renderer already handles N entries with per-author badges, so no renderer change is needed to make these appear.

**Files:**
- Modify: `src/utils/serveIntakeBriefing.ts` (`buildPsoBriefing`)
- Test: `tests/serveIntakeBriefing.test.ts` (APPEND)

**Interfaces:**
- Consumes: everything from Task 6.
- Produces: `buildPsoBriefing` returns 6 notes (the 7th, OCR context, is appended by `commitIntake` as it already is).

- [ ] **Step 1: Write the failing test**

```ts
// APPEND to tests/serveIntakeBriefing.test.ts
import { buildPsoBriefing } from '../src/utils/serveIntakeBriefing';

const input = {
  fields: {} as any,
  queueRow: baseRow,
  isBusiness: false,
  agentName: '',
  fullLocation: '1180 E VINE ST, SALT LAKE CITY, UT 84121',
  docCount: 3,
  attemptPlan: [
    { attempt: 1, date: '2026-06-27', weekday: 'Saturday', window: '07:00-09:00', focus: 'early morning', authority: 'residential default' as const },
  ],
};

describe('briefing decomposition (spec §3.3)', () => {
  it('emits six notes, one per topic', () => {
    const b = buildPsoBriefing(input, '2026-06-26T12:00:00Z');
    expect(b.notes).toHaveLength(6);
  });

  it('the safety note comes first so it sits at the top of the feed', () => {
    const b = buildPsoBriefing(input, '2026-06-26T12:00:00Z');
    expect(b.notes[0].author).toBe('OFFICER SAFETY');
  });

  it('assigns the documented author tags in order', () => {
    const b = buildPsoBriefing(input, '2026-06-26T12:00:00Z');
    expect(b.notes.map((n) => n.author)).toEqual([
      'OFFICER SAFETY', 'INTAKE', 'DISPATCH', 'DISPATCH', 'DISPATCH', 'DISPATCH',
    ]);
  });

  it('every note has non-empty body text', () => {
    const b = buildPsoBriefing(input, '2026-06-26T12:00:00Z');
    expect(b.notes.every((n) => n.text.trim().length > 0)).toBe(true);
  });

  it('note ids are unique so the renderer cannot collapse two entries', () => {
    const b = buildPsoBriefing(input, '2026-06-26T12:00:00Z');
    expect(new Set(b.notes.map((n) => n.id)).size).toBe(b.notes.length);
  });

  it('the attempt-plan note carries the window authority', () => {
    const b = buildPsoBriefing(input, '2026-06-26T12:00:00Z');
    const planNote = b.notes.find((n) => n.text.includes('ATTEMPT PLAN') || n.text.includes('Attempt 1'));
    expect(planNote?.text).toContain('residential default');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/serveIntakeBriefing.test.ts`
Expected: FAIL — currently 2 notes, not 6.

- [ ] **Step 3: Implement**

Split `buildBriefingNoteText` into six builders. **This is a code MOVE, not a rewrite** — every line of content that exists today must land in exactly one new note, unchanged. Nothing is deleted and nothing is invented.

Read the current `buildBriefingNoteText` and distribute its sections exactly as follows. The section headers named below are the literal `'**■ …**'` strings already in the function:

| New builder | Author | Sections moved into it (verbatim) |
|---|---|---|
| `buildSafetyNote(assessment)` | `OFFICER SAFETY` | The whole existing safety-note body from `buildPsoBriefing` — the `OFFICER SAFETY — RISK ASSESSMENT` header, `**Indicators:**`, `**Posture:**`, and the DV line |
| `buildIntakeNote(input, nowIso)` | `INTAKE` | `■ SERVICE PROFILE`, `■ CASE`, `■ TIMELINE`, `■ SERVICE AUTHORITY`, `■ SERVICE CONSTRAINTS`, `■ PROPERTY RECORD`, `■ BUSINESS RECORD`, plus the new witness-fee and non-party lines from Task 6 |
| `buildTacticalNote(input, hint)` | `DISPATCH` | `■ TACTICAL APPROACH` |
| `buildPlanNote(input)` | `DISPATCH` | `■ RECOMMENDED ATTEMPT PLAN`, `■ SERVICE WINDOWS`, `■ DILIGENCE STANDARD`, plus the Task 6 impossible-schedule warning |
| `buildAffidavitNote(input)` | `DISPATCH` | `■ AFFIDAVIT / DOCUMENTATION REQUIREMENTS`, `■ CLIENT INSTRUCTIONS (verbatim)`, plus the Task 6 document checklist |
| `buildContactsNote(input)` | `DISPATCH` | `■ CONTACTS` |

Each builder has the same shape: build a local `lines: string[]`, push its sections, `return lines.join('\n')`. Each keeps the `**PROCESS SERVICE — …**` style title as its first line so an entry is self-describing when read alone. A builder whose sections are all empty returns `''` and is skipped by `push` below, so a packet with no contacts does not emit an empty entry.

Then:

```ts
export function buildPsoBriefing(input: BriefingInput, nowIso: string): PsoBriefing {
  const assessment = assessOfficerSafety(input.fields, input.queueRow);
  const hint = hazardHintText(input.fields, input.queueRow);
  const notes: BriefingNote[] = [];
  let seq = 0;
  const push = (author: string, text: string) => {
    if (!text.trim()) return;
    notes.push({ id: `intake-${author.toLowerCase().replace(/\s+/g, '-')}-${nowIso}-${seq++}`, author, text, timestamp: nowIso });
  };

  push('OFFICER SAFETY', buildSafetyNote(assessment));
  push('INTAKE', buildIntakeNote(input, nowIso));
  push('DISPATCH', buildTacticalNote(input, hint));
  push('DISPATCH', buildPlanNote(input));
  push('DISPATCH', buildAffidavitNote(input));
  push('DISPATCH', buildContactsNote(input));

  return {
    notes,
    sceneSafety: assessment.sceneSafety,
    officerSafetyCaution: assessment.caution ? 1 : 0,
    domesticViolence: assessment.domesticViolence ? 1 : 0,
    descriptionPrefix: assessment.severity === 'high' ? 'OFFICER SAFETY · ' : '',
  };
}
```

Note the id scheme uses `nowIso` + a counter rather than `Date.now()` — `Date.now()` inside a loop can collide, and this function must stay deterministic for a given `nowIso`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/serveIntakeBriefing.test.ts && npm run typecheck && npx vitest run`
Expected: PASS, 0 type errors. Existing intake tests that assert on note COUNT will need updating — update them to the new count; do not weaken what they assert about content.

- [ ] **Step 5: Commit**

```bash
git add src/utils/serveIntakeBriefing.ts tests/serveIntakeBriefing.test.ts
git commit -m "feat(serve-intake): split the briefing into six topical entries"
```

---

### Task 8: Wire the bounded critic pass

Spec item 10 — implemented in PR 1 but never called. Operator decision: wire it.

**Files:**
- Modify: `src/routes/serveIntake.ts` (after `finalizeFields`)
- Test: `tests/serveIntakeCriticPass.test.ts` (new)

**Interfaces:**
- Consumes: `needsCriticPass(fields, issues)` from `serveIntakeExtract`, `validateFields` from `serveIntakeValidate`.
- Produces: `applyCriticResults(fields, critic): Record<string, ExtractedField>` exported from `src/utils/serveIntakeExtract.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/serveIntakeCriticPass.test.ts
import { describe, it, expect } from 'vitest';
import { applyCriticResults, needsCriticPass, TARGET_FIELDS, type ExtractedField } from '../src/utils/serveIntakeExtract';

function fieldsFrom(values: Record<string, string>, conf = 0.9): Record<string, ExtractedField> {
  const out: Record<string, ExtractedField> = {};
  for (const f of TARGET_FIELDS) out[f] = { value: values[f] ?? '', confidence: values[f] ? conf : 0 };
  return out;
}

describe('applyCriticResults', () => {
  it('overwrites only the fields the critic was asked about', () => {
    const base = fieldsFrom({ case_number: 'WRONG', court_name: 'KEEP' });
    const out = applyCriticResults(base, { case_number: { value: '900904528', confidence: 0.95 } });
    expect(out.case_number.value).toBe('900904528');
    expect(out.court_name.value).toBe('KEEP');
  });

  it('ignores a critic answer for a field it was not asked about', () => {
    const base = fieldsFrom({ case_number: 'A' });
    const out = applyCriticResults(base, { recipient_dob: { value: '1980-01-01', confidence: 1 } } as any);
    expect(out.recipient_dob?.value ?? '').toBe('');
  });

  it('keeps the original when the critic returns an empty value', () => {
    const base = fieldsFrom({ case_number: 'ORIGINAL' });
    const out = applyCriticResults(base, { case_number: { value: '', confidence: 0 } });
    expect(out.case_number.value).toBe('ORIGINAL');
  });

  it('does not mutate its input', () => {
    const base = fieldsFrom({ case_number: 'A' });
    applyCriticResults(base, { case_number: { value: 'B', confidence: 1 } });
    expect(base.case_number.value).toBe('A');
  });
});

describe('needsCriticPass gating (cost discipline)', () => {
  it('returns nothing when every critical field is confident', () => {
    const f = fieldsFrom({ case_number: 'X', recipient_address: 'Y' }, 0.95);
    expect(needsCriticPass(f, [])).toEqual([]);
  });

  it('never exceeds the cap even when everything is doubtful', () => {
    const f = fieldsFrom({
      case_number: 'a', recipient_address: 'b', court_name: 'c',
      service_deadline: 'd', recipient_dob: 'e', recipient_phone: 'f', address_class: 'g',
    }, 0.1);
    expect(needsCriticPass(f, []).length).toBeLessThanOrEqual(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/serveIntakeCriticPass.test.ts`
Expected: FAIL — `applyCriticResults` is not exported.

- [ ] **Step 3: Implement**

Add to `src/utils/serveIntakeExtract.ts`:

```ts
// Merge a critic pass's answers back over the original field map. Only
// fields the critic was actually asked about are eligible, and an empty
// critic answer never destroys a value the first pass found — a second
// opinion that says "I don't know" is not evidence the first was wrong.
export function applyCriticResults(
  fields: Record<string, ExtractedField>,
  critic: Partial<Record<string, ExtractedField>>,
): Record<string, ExtractedField> {
  const out: Record<string, ExtractedField> = {};
  for (const [k, v] of Object.entries(fields)) out[k] = { ...v };
  for (const [k, v] of Object.entries(critic)) {
    if (!v) continue;
    if (!(k in out)) continue;                 // not a target field — ignore
    const value = (v.value || '').trim();
    if (!value) continue;                      // critic had nothing — keep the original
    out[k] = { value, confidence: v.confidence ?? 0.5 };
  }
  return out;
}
```

In `src/routes/serveIntake.ts`, after `finalizeFields`:

```ts
  // Bounded critic pass (spec item 10): re-ask ONLY about doubtful
  // critical fields, capped at 5, so a bad scan gets a second look
  // without doubling neuron spend on every packet.
  const criticFields = needsCriticPass(validatedFields, validation.issues);
  let finalFields = validatedFields;
  if (criticFields.length) {
    log.info('serve-intake critic pass', { fields: criticFields });
    try {
      const critic = await withTimeout(
        criticExtract(c.env, combinedText, criticFields),
        CRITIC_TIMEOUT_MS, 'Critic pass timed out',
      );
      finalFields = finalizeFields(applyCriticResults(validatedFields, critic), nowIso);
    } catch (e) {
      log.warn('serve-intake critic pass failed; keeping first-pass fields', {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
```

Add `criticExtract` to `src/utils/serveIntakeExtract.ts`:

```ts
// ── Bounded critic pass ───────────────────────────────────────
// A SECOND look at a SHORT list of doubtful fields. Deliberately not a
// full re-extraction: the prompt names only the requested fields, so the
// model has one narrow job and the output is small. Cost is bounded by
// needsCriticPass's cap (5 fields), so a badly-scanned packet cannot
// blow the 10,000-neuron/day free allocation.
export const CRITIC_TIMEOUT_MS = 20_000;

const CRITIC_SYSTEM = `You are re-checking a SMALL number of fields another extraction pass was unsure about, in a legal process-service document.
Return STRICT JSON only — no commentary, no markdown fences — shaped exactly:
{"<field>": {"value": "<string>", "confidence": <0..1>}, ...}
Include ONLY the fields you were asked about.
If you cannot find a field, return an empty string with confidence 0. NEVER guess — an empty answer leaves the first pass's value in place, which is the safe outcome.
Dates use ISO YYYY-MM-DD. Phone numbers are digits only.`;

export async function criticExtract(
  env: { DB: D1Database; AI: Ai; KV?: KVNamespace },
  rawText: string,
  fieldNames: string[],
): Promise<Partial<Record<string, ExtractedField>>> {
  if (!fieldNames.length || !rawText.trim()) return {};
  const asked = fieldNames.join(', ');
  const res = await callAi(env, {
    system: CRITIC_SYSTEM,
    text: `Re-read the document below and report ONLY these fields: ${asked}\n\n---\n${rawText.slice(0, 24_000)}`,
    maxTokens: 512,
  });
  const parsed = tryParseModelJson(res.text);
  const out: Partial<Record<string, ExtractedField>> = {};
  for (const name of fieldNames) {
    const v = (parsed as any)?.[name];
    if (!v) continue;
    const value = typeof v === 'string' ? v : String(v?.value ?? '');
    const confidence = typeof v === 'object' && typeof v.confidence === 'number' ? v.confidence : 0.5;
    out[name] = { value: value.trim(), confidence };
  }
  return out;
}
```

A critic failure must never fail the upload — the `catch` at the call site keeps the first-pass fields. Note it routes through `callAi`, so a configured Claude/OpenAI key is used when present and it degrades to free Workers AI otherwise.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/serveIntakeCriticPass.test.ts && npm run typecheck && npx vitest run`
Expected: PASS, 0 type errors.

- [ ] **Step 5: Commit**

```bash
git add src/utils/serveIntakeExtract.ts src/routes/serveIntake.ts tests/serveIntakeCriticPass.test.ts
git commit -m "feat(serve-intake): wire the bounded critic pass (spec item 10)"
```

---

### Task 9: Persist validation issues; fix the conflicts snapshot

The two PR 1 carryovers the operator folded into this PR.

**Files:**
- Modify: `src/routes/serveIntake.ts`, `src/utils/serveIntakeRecords.ts`
- Test: `tests/serveIntakeArbitrate.test.ts` (APPEND)

**Interfaces:**
- Consumes: `normalizeFields` (existing), `arbitrateFields` (existing).
- Produces: `parsed_data._intake.validation_issues` persisted; `conflicts[].chosen` now matches the committed value.

- [ ] **Step 1: Write the failing test**

```ts
// APPEND to tests/serveIntakeArbitrate.test.ts
import { arbitrateFields } from '../src/utils/serveIntakeArbitrate';
import { normalizeFields } from '../src/utils/serveIntakeExtract';

describe('conflicts reflect POST-normalization values', () => {
  it('chosen matches what would actually be committed', () => {
    // Two documents disagree on the deadline, in different date formats.
    // The values differ, so a conflict IS produced — assert on it
    // unconditionally. A conditional assertion here would silently pass
    // if arbitration stopped recording the conflict at all, which is
    // exactly the regression this test exists to catch.
    const a = { docType: 'field_sheet', fields: normalizeFields({ service_deadline: { value: '6/26/2026', confidence: 0.8 } } as any) };
    const b = { docType: 'info_page', fields: normalizeFields({ service_deadline: { value: '6/30/2026', confidence: 0.9 } } as any) };
    const r = arbitrateFields([a, b]);

    // info_page outranks field_sheet for service mechanics, so it wins.
    expect(r.merged.service_deadline.value).toBe('2026-06-30');

    const c = r.conflicts.find((x) => x.field === 'service_deadline');
    expect(c).toBeDefined();
    // `chosen` must be the ISO form that lands in the DB — not the raw
    // model string, which is what PR 4's resolver would otherwise show.
    expect(c!.chosen).toBe('2026-06-30');
    expect(c!.rejected.map((x) => x.value)).toContain('2026-06-26');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/serveIntakeArbitrate.test.ts`
Expected: FAIL — `chosen` is the raw `6/30/2026`, not the ISO form.

- [ ] **Step 3: Implement**

a) In `src/routes/serveIntake.ts`, normalize each candidate BEFORE arbitration rather than once after. Where `docCandidates` is built, wrap each candidate's fields:

```ts
  // Normalize per-candidate so the conflicts audit records the values
  // that will actually be committed. Previously arbitration ran on raw
  // model output and normalization ran once afterwards, so a persisted
  // conflict could read chosen: "6/26/2026" while the row held
  // "2026-06-26" — PR 4's resolver would show a value that disagrees
  // with the record it is resolving.
  const docCandidates = collected
    .filter((c2) => c2.ex?.fields)
    .map((c2) => ({
      docType: c2.family ?? c2.ex.documentType,
      fields: normalizeFields(c2.ex.fields),
    }));
```

The post-arbitration `finalizeFields` call stays — it is idempotent over already-normalized values and still applies validation.

b) Persist the validation issues. In `commitIntake`'s `parsed_data._intake` assembly in `src/utils/serveIntakeRecords.ts`, add alongside `conflicts`:

```ts
      validation_issues: input.validationIssues ?? [],
```

Add `validationIssues?: Array<{ field: string; severity: 'warn' | 'error'; message: string }>` to `CommitInput`, and pass `validation.issues` from the route. This gives PR 4's review UI the reason behind a lowered confidence, and means records committed between now and PR 4 already carry it.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/serveIntakeArbitrate.test.ts && npm run typecheck && npx vitest run`
Expected: PASS, 0 type errors.

- [ ] **Step 5: Commit**

```bash
git add src/routes/serveIntake.ts src/utils/serveIntakeRecords.ts tests/serveIntakeArbitrate.test.ts
git commit -m "fix(serve-intake): normalize before arbitration; persist validation issues"
```

---

### Task 10: Re-run the A/B and update the spec

Closes the loop the same way PR 1 did.

**Files:**
- Modify: `docs/superpowers/specs/2026-07-26-serve-intake-ocr-enhancement-design.md`

- [ ] **Step 1: Run the fixture A/B**

```bash
bash .superpowers/sdd/run-ab.sh
```

That script supplies credentials from the local wrangler OAuth token and never prints them. Baseline to beat: incumbent `llama-3.3-70b-instruct-fp8-fast` at **35/36**. Run ONCE.

Expected: no field regresses. If any does, report it plainly rather than reporting only the total — a prompt change in Task 6 could perturb unrelated fields.

- [ ] **Step 2: Verify the full gate set**

```bash
npm run typecheck && npx vitest run
```

Expected: 0 type errors; every test green.

- [ ] **Step 3: Update the spec's status**

Mark items 21–40 and item 10 as delivered. Correct §3.3 to say `buildPsoBriefing` returns six notes with the OCR note appended by `commitIntake` (seven entries total on the report) — the spec currently says seven from `buildPsoBriefing`, which is off by one.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-07-26-serve-intake-ocr-enhancement-design.md
git commit -m "docs(serve-intake): mark PR 2 items delivered; correct the note-count"
```

---

## Final verification

- [ ] **Run every gate**

```bash
npm run typecheck && npx vitest run && cd client && npx tsc --noEmit && npx vitest run
```

Expected: worker typecheck 0 errors; worker suite green (268 baseline files + ~6 new); client untouched and green.

- [ ] **Open the PR**

```bash
git push -u origin claude/serve-intake-timing-engine
gh pr create -R rmpgutah/rmpg-flex --base main \
  --title "feat(serve-intake): PR 2 — address-class timing engine and briefing intelligence" \
  --body "Implements spec items 21-40 plus item 10 and two PR 1 carryovers. See docs/superpowers/specs/2026-07-26-serve-intake-ocr-enhancement-design.md"
```

---

## Deferred to later plans

- **PR 3** (items 41–58) — PDF render and visual, including the D3 right-margin clipping and badge colouring for the six new entries.
- **PR 4** (items 59–67) — Serve Intake review UI, which consumes `_intake.conflicts` and `_intake.validation_issues` persisted by this PR.
