# PR-A — Attempt-Notes Fallback + Time-Clock Dual-Stamp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two surgical bugs in RMPG Flex — (1) the attempt-history row in `ServeJobCard.tsx` shows blank space when an operator omits notes, and (2) every clock-in/out timestamp is being labeled `+00:00` while it's actually UTC, causing a 6-hour summer / 7-hour winter offset in the display. Land both fixes plus the schema + backfill that lets all future time stamps display in the operator's wall-clock zone (America/Denver).

**Architecture:** A new shared helper `src/utils/denverTime.ts` exposes `nowDualStamp()` returning `{ utc, local }` strings via `Intl.DateTimeFormat` — the only DST-aware path inside Cloudflare Workers. Migration `0150_time_entries_local_stamps.sql` adds four `_local` columns to `time_entries`. Every clock write in `src/routes/personnel.ts` populates both UTC (canonical, for math/joins) and Denver wall-clock (for display). A one-shot Node script backfills the four `_local` columns for historical rows. The attempt-history row in `client/src/components/serve/ServeJobCard.tsx` falls back to `formatCodeShort(attempt.disposition_code)` when `attempt.notes` is empty, rendered italic + dimmer so reviewers can distinguish operator text from auto-derived text.

**Tech Stack:** TypeScript, Hono on Cloudflare Workers, D1 (SQLite-flavored), Vitest (Node env for `/src/`, jsdom env for `/client/`), React 18 + Tailwind, `Intl.DateTimeFormat`.

---

## File Structure

**Created:**
- `src/utils/denverTime.ts` — `nowDualStamp(date?: Date)` helper + pure formatter
- `tests/denverTime.test.ts` — unit tests for the helper (Node env)
- `migrations/0150_time_entries_local_stamps.sql` — idempotent ALTER TABLE (adds `clock_in_local`, `clock_out_local`, `break_start_local`; no `break_end_local` because `time_entries` has no `break_end` UTC column — `end-break` clears `break_start` and adds to the `break_minutes` duration)
- `scripts/backfill-time-entries-denver.js` — one-shot Node script that converts UTC rows to Denver wall-clock and writes to the `_local` columns

**Modified:**
- `src/routes/personnel.ts` — every `new Date().toISOString().replace(/\.\d{3}Z$/, '+00:00')` site swaps to `nowDualStamp()`; INSERT/UPDATE statements gain `_local` columns. Three timestamp-write touch points: clock-in (line ~745) → `clock_in_local`, clock-out (line ~770) → `clock_out_local`, start-break (line ~787) → `break_start_local`. The end-break route writes `break_minutes` (a duration) and clears `break_start` — no new column for it.
- `client/src/components/serve/ServeJobCard.tsx` — add `formatCodeShort` import; rewrite the attempt-row notes span at line 333 to use the fallback hierarchy.
- `client/src/pages/personnel/tabs/TimeAttendanceTab.tsx` — read `clock_in_local ?? clock_in` for display.
- `client/src/pages/mobile/cards/ShiftCard.tsx` — same display swap.
- `client/src/pages/MobileShiftPage.tsx` — same display swap.
- `client/src/pages/personnel/PersonnelDetailPanel.tsx` — same display swap.

**Out of scope for PR-A:** the disposition-registry table, shared `<DispositionCodeChip>` / `<DispositionCodePicker>` components, CC/CT taxonomies, cross-link engine. Those land in PR-B through PR-E.

---

## Pre-flight

- [ ] **Step 0.1: Confirm worktree is on the feature branch off latest origin/main**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/youthful-ramanujan-e393bc"
git fetch origin
git status -sb
```

Expected: branch is `claude/youthful-ramanujan-e393bc`, no uncommitted changes (the spec commit `0defd82` is already in place).

If `package-lock.json` is dirty from a prior `npm install mp4box` — leave it; we'll discard or commit it separately at the end. Do not stage it with code changes.

- [ ] **Step 0.2: Run baseline tests to confirm green start**

```bash
npm test -- --reporter=dot 2>&1 | tail -5
```

Expected: `Tests 1463 passed | 1 skipped (1464)` (or whatever the post-spec count is). If failing, stop and ask before proceeding.

---

## Task 1: `nowDualStamp()` helper (TDD)

**Files:**
- Create: `src/utils/denverTime.ts`
- Test: `tests/denverTime.test.ts`

- [ ] **Step 1.1: Write failing tests**

Create `tests/denverTime.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { nowDualStamp, toDenverWallClock } from '../src/utils/denverTime';

describe('toDenverWallClock', () => {
  it('formats a summer (MDT) UTC moment as Denver wall-clock', () => {
    // 2026-06-22T20:30:00Z = 14:30 MDT (UTC-6)
    const input = new Date('2026-06-22T20:30:00Z');
    expect(toDenverWallClock(input)).toBe('2026-06-22T14:30:00');
  });

  it('formats a winter (MST) UTC moment as Denver wall-clock', () => {
    // 2026-12-15T20:30:00Z = 13:30 MST (UTC-7)
    const input = new Date('2026-12-15T20:30:00Z');
    expect(toDenverWallClock(input)).toBe('2026-12-15T13:30:00');
  });

  it('formats a moment exactly at the spring-forward DST transition', () => {
    // 2026-03-08T09:00:00Z — Denver springs forward at 02:00 local, so
    // 09:00Z is post-spring-forward = 03:00 MDT (NOT 02:00 MST).
    const input = new Date('2026-03-08T09:00:00Z');
    expect(toDenverWallClock(input)).toBe('2026-03-08T03:00:00');
  });

  it('zero-pads single-digit hours and minutes', () => {
    // 2026-06-22T13:05:09Z = 07:05:09 MDT
    const input = new Date('2026-06-22T13:05:09Z');
    expect(toDenverWallClock(input)).toBe('2026-06-22T07:05:09');
  });
});

describe('nowDualStamp', () => {
  it('returns both UTC ISO and Denver wall-clock for a passed-in date', () => {
    const fixed = new Date('2026-06-22T20:30:00Z');
    const stamp = nowDualStamp(fixed);
    expect(stamp.utc).toBe('2026-06-22T20:30:00.000Z');
    expect(stamp.local).toBe('2026-06-22T14:30:00');
  });

  it('uses the current time when called with no argument', () => {
    const before = Date.now();
    const stamp = nowDualStamp();
    const after = Date.now();
    const parsed = new Date(stamp.utc).getTime();
    expect(parsed).toBeGreaterThanOrEqual(before);
    expect(parsed).toBeLessThanOrEqual(after);
    // Local always parses to a wall-clock string
    expect(stamp.local).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
  });
});
```

- [ ] **Step 1.2: Run the test — expect failure**

```bash
npx vitest run tests/denverTime.test.ts
```

Expected: 6 tests fail with `Cannot find module '../src/utils/denverTime'` or similar.

- [ ] **Step 1.3: Implement `src/utils/denverTime.ts`**

```typescript
// ============================================================
// RMPG Flex — Denver wall-clock helpers
//
// Cloudflare Workers have no TZ environment, Date.getTimezoneOffset() returns
// 0, and SQLite's `datetime(..., 'localtime')` resolves to UTC. The ONLY
// DST-aware path is Intl.DateTimeFormat carrying IANA zone data. These
// helpers wrap that so every write path that needs a "what the operator's
// wall clock reads" string gets one consistent format.
// ============================================================

const DENVER_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Denver',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

/**
 * Convert a Date to America/Denver wall-clock in `YYYY-MM-DDTHH:MM:SS` form
 * (no offset suffix — the value IS local, not UTC).
 *
 * - Uses IANA zone data, so DST flips are correct automatically.
 * - Output is sortable lexicographically within a single zone.
 * - No milliseconds; D1's TEXT timestamps don't use them either.
 */
export function toDenverWallClock(d: Date): string {
  const parts = DENVER_FORMATTER.formatToParts(d).reduce<Record<string, string>>(
    (acc, p) => {
      if (p.type !== 'literal') acc[p.type] = p.value;
      return acc;
    },
    {},
  );
  // Intl's `hour: '2-digit'` returns "24" for midnight on some Node builds; map to "00".
  const hour = parts.hour === '24' ? '00' : parts.hour;
  return `${parts.year}-${parts.month}-${parts.day}T${hour}:${parts.minute}:${parts.second}`;
}

export interface DualStamp {
  /** Canonical ISO-8601 UTC with milliseconds and `Z` suffix. Use for math. */
  utc: string;
  /** America/Denver wall-clock, no offset. Use for display. */
  local: string;
}

/**
 * Return both UTC and Denver wall-clock strings for the given moment (defaults
 * to "now"). Use this everywhere you'd otherwise call `new Date().toISOString()`
 * on a write path that humans will later read.
 */
export function nowDualStamp(d: Date = new Date()): DualStamp {
  return {
    utc: d.toISOString(),
    local: toDenverWallClock(d),
  };
}
```

- [ ] **Step 1.4: Run the test — expect pass**

```bash
npx vitest run tests/denverTime.test.ts
```

Expected: `Tests 6 passed`. If a spring-forward or midnight edge fails on this machine's Node, investigate which Intl behavior diverged (Node 18 vs 20 has had quirks); do NOT relax the test — fix the helper.

- [ ] **Step 1.5: Run the full Worker test suite to confirm no collateral**

```bash
npm test -- --reporter=dot 2>&1 | tail -5
```

Expected: `Tests 1469 passed | 1 skipped` (baseline + 6 new tests).

- [ ] **Step 1.6: Commit**

```bash
git add src/utils/denverTime.ts tests/denverTime.test.ts
git commit -m "feat(time): add nowDualStamp helper for Denver wall-clock writes

Intl.DateTimeFormat with IANA zone data is the only DST-aware way to derive
'America/Denver' wall-clock inside Cloudflare Workers. nowDualStamp() returns
both UTC (canonical for math) and the Denver wall-clock string (for display)
so write paths can populate both columns from a single call.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2: Migration `0150_time_entries_local_stamps.sql`

**Files:**
- Create: `migrations/0150_time_entries_local_stamps.sql`

- [ ] **Step 2.1: Confirm next-free migration number**

```bash
ls migrations/ | sort | tail -5
```

Expected: `0149_nsopw_records_links.sql` is the high-water mark. If anything ≥`0150` exists, pick the next free integer and adjust this task's filename. The migration order matters; the literal `0150` does not.

- [ ] **Step 2.2: Create migration file**

`migrations/0150_time_entries_local_stamps.sql`:

```sql
-- ============================================================
-- PR-A — Time-clock dual-stamp
--
-- Adds America/Denver wall-clock columns alongside the existing UTC ISO
-- columns so display layers can read a string that matches the operator's
-- physical wall clock without parsing & converting on every render.
--
-- `time_entries` stores break end as a CLEARED `break_start` plus accumulated
-- `break_minutes` duration — there is no `break_end` UTC column, so no
-- `break_end_local` either.
--
-- Backfill of historical rows happens via scripts/backfill-time-entries-denver.js
-- (D1/SQLite has no IANA-aware datetime function; a Node script does the
-- DST-aware conversion per row).
-- ============================================================

ALTER TABLE time_entries ADD COLUMN clock_in_local TEXT;
ALTER TABLE time_entries ADD COLUMN clock_out_local TEXT;
ALTER TABLE time_entries ADD COLUMN break_start_local TEXT;

CREATE INDEX IF NOT EXISTS idx_time_entries_clock_in_local
  ON time_entries (clock_in_local);
```

D1 does **not** support `IF NOT EXISTS` on `ADD COLUMN`, so re-application after the column already exists will error with "duplicate column name." The deploy workflow has `continue-on-error: true` on the apply step so this is non-fatal; the boot reconciler pattern (already used elsewhere in the worker) handles the same idempotency on live D1.

- [ ] **Step 2.3: Apply to local D1**

```bash
npm run migrate:local 2>&1 | tail -10
```

Expected: `0150_time_entries_local_stamps.sql` applied without error.

- [ ] **Step 2.4: Verify columns exist on local D1**

```bash
npx wrangler d1 execute rmpg-flex --local --command "SELECT name FROM pragma_table_info('time_entries') WHERE name IN ('clock_in_local', 'clock_out_local', 'break_start_local', 'break_end_local')" 2>&1 | tail -10
```

Expected: 4 rows returned (the four new columns).

- [ ] **Step 2.5: Commit**

```bash
git add migrations/0150_time_entries_local_stamps.sql
git commit -m "feat(db): mig 0150 — add Denver wall-clock columns to time_entries

ALTER TABLE adds clock_in_local / clock_out_local / break_start_local /
break_end_local. UTC stays canonical for math; the local columns are for
display. Index on clock_in_local for shift-list date filtering.

🔴 After merge: apply directly to live D1 (785de7ae) per CLAUDE.md gotcha #4,
then run scripts/backfill-time-entries-denver.js once to populate historical
rows.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3: Wire dual-stamp into `personnel.ts` (clock-in)

**Files:**
- Modify: `src/routes/personnel.ts:741-750` (clock-in handler)

- [ ] **Step 3.1: Read the current clock-in handler to confirm line numbers**

```bash
grep -n "personnel.post('/time/clock-in'" src/routes/personnel.ts
grep -n "personnel.post('/time/clock-out'" src/routes/personnel.ts
grep -n "personnel.post('/time/start-break'" src/routes/personnel.ts
grep -n "personnel.post('/time/end-break'" src/routes/personnel.ts
```

Expected: clock-in at ~line 730–755, clock-out ~756–784, start-break ~786+, end-break further down. If line numbers drifted, use the new numbers — the surrounding INSERT/UPDATE statements are what matters, not the line numbers.

- [ ] **Step 3.2: Update the import block**

In `src/routes/personnel.ts`, add to the existing imports (line ~6 region):

```typescript
import { nowDualStamp } from '../utils/denverTime';
```

- [ ] **Step 3.3: Rewrite the clock-in INSERT to dual-stamp**

Find the block at the current `personnel.post('/time/clock-in', ...)` handler. Replace these three lines:

```typescript
    const stamp = new Date().toISOString().replace(/\.\d{3}Z$/, '+00:00');
    const result = await execute(db,
      `INSERT INTO time_entries (officer_id, clock_in, status, created_at) VALUES (?, ?, 'active', datetime('now','localtime'))`,
      officerId, stamp);
```

with:

```typescript
    const stamp = nowDualStamp();
    const result = await execute(db,
      `INSERT INTO time_entries (officer_id, clock_in, clock_in_local, status, created_at) VALUES (?, ?, ?, 'active', datetime('now','localtime'))`,
      officerId, stamp.utc, stamp.local);
```

(The `datetime('now','localtime')` on `created_at` stays — it's already wrong-but-consistent for the existing column, and `created_at` is only ever read for sort-order, never for wall-clock display. Fixing it cleanly is out of PR-A scope.)

- [ ] **Step 3.4: Rewrite the clock-out UPDATE to dual-stamp**

Find the `personnel.post('/time/clock-out', ...)` handler. Replace:

```typescript
    const stamp = new Date().toISOString().replace(/\.\d{3}Z$/, '+00:00');
    const a = new Date(entry.clock_in).getTime();
    const b = new Date(stamp).getTime();
    const hrs = Number.isFinite(a) && Number.isFinite(b) && b > a
      ? Math.round(((b - a) / 3_600_000 - (entry.break_minutes || 0) / 60) * 100) / 100
      : 0;

    await execute(db, `UPDATE time_entries SET clock_out = ?, total_hours = ?, status = 'completed' WHERE id = ?`, stamp, hrs, entry.id);
```

with:

```typescript
    const stamp = nowDualStamp();
    const a = new Date(entry.clock_in).getTime();
    const b = new Date(stamp.utc).getTime();
    const hrs = Number.isFinite(a) && Number.isFinite(b) && b > a
      ? Math.round(((b - a) / 3_600_000 - (entry.break_minutes || 0) / 60) * 100) / 100
      : 0;

    await execute(db, `UPDATE time_entries SET clock_out = ?, clock_out_local = ?, total_hours = ?, status = 'completed' WHERE id = ?`, stamp.utc, stamp.local, hrs, entry.id);
```

- [ ] **Step 3.5: Rewrite start-break for dual-stamp**

The current `personnel.post('/time/start-break', ...)` route writes
`break_start = datetime('now','localtime')` — which on Workers resolves to
UTC despite the `'localtime'` modifier. Replace that UPDATE statement:

```typescript
// before
await execute(db, `UPDATE time_entries SET status = 'on_break', break_start = datetime('now','localtime') WHERE id = ?`, entry.id);

// after
const stamp = nowDualStamp();
await execute(db, `UPDATE time_entries SET status = 'on_break', break_start = ?, break_start_local = ? WHERE id = ?`, stamp.utc, stamp.local, entry.id);
```

The `personnel.post('/time/end-break', ...)` route writes
`break_start = NULL, break_minutes = <total>` — i.e., it CLEARS `break_start`
and accumulates a duration. There is no `break_end` UTC column on
`time_entries`, so do NOT add a `_local` write to this route. Leave it
unchanged.

- [ ] **Step 3.6: Typecheck**

```bash
npm run typecheck 2>&1 | tail -10
```

Expected: zero errors. If `nowDualStamp` returns the wrong shape, fix it; if the SQL parameter count doesn't match, fix it.

- [ ] **Step 3.7: Run Worker tests**

```bash
npm test -- --reporter=dot 2>&1 | tail -5
```

Expected: all tests pass. There's no personnel-route test yet (CLAUDE.md gotcha #11) — that's a known gap; this PR doesn't seed one.

- [ ] **Step 3.8: Commit**

```bash
git add src/routes/personnel.ts
git commit -m "fix(personnel): dual-stamp time-clock writes UTC + Denver wall-clock

Every clock-in / clock-out / start-break / end-break write now records BOTH
the canonical UTC ISO string AND a 'America/Denver' wall-clock string via
nowDualStamp(). UTC stays the math column; the new *_local columns are what
display reads. Fixes the 6-hour-offset bug where the display layer treated
the +00:00-labeled UTC stamp as already-local.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4: Backfill script for historical rows

**Files:**
- Create: `scripts/backfill-time-entries-denver.js`

- [ ] **Step 4.1: Write the script**

`scripts/backfill-time-entries-denver.js`:

```javascript
#!/usr/bin/env node
// ============================================================
// One-shot backfill — populate time_entries._local columns from the existing
// UTC ISO columns. Run via:
//   npx wrangler d1 execute rmpg-flex --remote --file scripts/backfill-time-entries-denver.js
//   ... NO — wrangler executes SQL, not JS. Run as a Node script that talks
//   to D1 via the wrangler CLI in batched UPDATEs:
//
//   node scripts/backfill-time-entries-denver.js  (uses --remote by default)
//   node scripts/backfill-time-entries-denver.js --local   (against local D1)
//
// Idempotent: only updates rows where the *_local column is still NULL.
// ============================================================

const { execSync } = require('node:child_process');

const FLAG = process.argv.includes('--local') ? '--local' : '--remote';
const BATCH = 100;

const DENVER_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Denver',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

function toDenverWallClock(utcString) {
  if (!utcString) return null;
  const d = new Date(utcString);
  if (Number.isNaN(d.getTime())) return null;
  const parts = DENVER_FMT.formatToParts(d).reduce((acc, p) => {
    if (p.type !== 'literal') acc[p.type] = p.value;
    return acc;
  }, {});
  const hour = parts.hour === '24' ? '00' : parts.hour;
  return `${parts.year}-${parts.month}-${parts.day}T${hour}:${parts.minute}:${parts.second}`;
}

function d1Query(sql) {
  const out = execSync(
    `npx wrangler d1 execute rmpg-flex ${FLAG} --json --command ${JSON.stringify(sql)}`,
    { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 },
  );
  const parsed = JSON.parse(out);
  return parsed[0]?.results ?? [];
}

function d1Execute(sql) {
  execSync(
    `npx wrangler d1 execute rmpg-flex ${FLAG} --command ${JSON.stringify(sql)}`,
    { encoding: 'utf8' },
  );
}

const COLUMN_PAIRS = [
  ['clock_in', 'clock_in_local'],
  ['clock_out', 'clock_out_local'],
  ['break_start', 'break_start_local'],
];

function escapeSqlValue(v) {
  if (v === null || v === undefined) return 'NULL';
  return `'${String(v).replace(/'/g, "''")}'`;
}

async function main() {
  let totalUpdated = 0;

  for (const [src, dst] of COLUMN_PAIRS) {
    console.log(`\n→ Backfilling ${dst} from ${src}`);
    let updatedThisCol = 0;

    while (true) {
      const rows = d1Query(
        `SELECT id, ${src} FROM time_entries WHERE ${src} IS NOT NULL AND ${dst} IS NULL LIMIT ${BATCH}`,
      );
      if (rows.length === 0) break;

      const updates = rows
        .map((r) => {
          const local = toDenverWallClock(r[src]);
          if (!local) return null;
          return `UPDATE time_entries SET ${dst} = ${escapeSqlValue(local)} WHERE id = ${Number(r.id)};`;
        })
        .filter(Boolean)
        .join('\n');

      if (updates.length === 0) break;
      d1Execute(updates);
      updatedThisCol += rows.length;
      console.log(`  …${updatedThisCol} rows`);
    }
    totalUpdated += updatedThisCol;
  }

  console.log(`\n✅ Backfill complete. ${totalUpdated} rows updated across 4 columns.`);
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
```

- [ ] **Step 4.2: Smoke-test the script against local D1**

```bash
# First make sure there's at least one historical row with no _local column populated.
npx wrangler d1 execute rmpg-flex --local --command "SELECT id, clock_in, clock_in_local FROM time_entries WHERE clock_in IS NOT NULL ORDER BY id DESC LIMIT 5"
node scripts/backfill-time-entries-denver.js --local
npx wrangler d1 execute rmpg-flex --local --command "SELECT id, clock_in, clock_in_local FROM time_entries WHERE clock_in IS NOT NULL ORDER BY id DESC LIMIT 5"
```

Expected: after running, the `clock_in_local` column shows wall-clock values that are 6 or 7 hours behind `clock_in` depending on the date.

- [ ] **Step 4.3: Confirm idempotency**

```bash
node scripts/backfill-time-entries-denver.js --local
```

Expected: `Backfill complete. 0 rows updated across 4 columns.` — the WHERE clause excludes already-populated rows.

- [ ] **Step 4.4: Commit**

```bash
git add scripts/backfill-time-entries-denver.js
git commit -m "feat(scripts): one-shot backfill for time_entries Denver wall-clock columns

Reads each UTC timestamp via wrangler, formats it via Intl.DateTimeFormat into
'America/Denver' wall-clock, and writes the result to the matching _local
column. Idempotent (skips rows where _local is already set). Defaults to
--remote; pass --local for the local D1.

🔴 Live run happens AFTER PR-A merges and mig 0150 is applied to live D1.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 5: Notes fallback in `ServeJobCard.tsx`

**Files:**
- Modify: `client/src/components/serve/ServeJobCard.tsx:1-30` (imports) and `~333` (the fallback span)

- [ ] **Step 5.1: Read the current imports**

```bash
sed -n '1,30p' client/src/components/serve/ServeJobCard.tsx
```

Expected output includes `import { safeDateStr, parseTimestamp } from '../../utils/dateUtils';` and a `formatEnumValue` import, but **no** `formatCodeShort` import.

- [ ] **Step 5.2: Add the import**

Add this line to the import block (preserve alphabetical-ish ordering — group it near the other `../../constants` or `../../utils` imports):

```typescript
import { formatCodeShort } from '../../constants/processServiceCodes';
```

(Confirm path with `ls client/src/constants/processServiceCodes.ts` — should exist per the earlier explore.)

- [ ] **Step 5.3: Locate the notes span**

```bash
grep -n "attempt.notes" client/src/components/serve/ServeJobCard.tsx
```

Expected: one match around line 333–334, inside the `job.attempts.map((attempt) => …)` block.

- [ ] **Step 5.4: Replace the conditional render**

Find this block:

```tsx
                    {attempt.notes && (
                      <span className="text-[10px] text-rmpg-400 truncate flex-1 min-w-0">{attempt.notes}</span>
                    )}
```

Replace with:

```tsx
                    {(() => {
                      const fallback = attempt.notes
                        || formatCodeShort((attempt as { disposition_code?: string | null }).disposition_code);
                      if (!fallback) return null;
                      const isFallback = !attempt.notes;
                      return (
                        <span
                          className={`text-[10px] truncate flex-1 min-w-0 ${
                            isFallback ? 'italic text-rmpg-500' : 'text-rmpg-400'
                          }`}
                          title={isFallback ? 'No operator notes — showing disposition code' : undefined}
                        >
                          {fallback}
                        </span>
                      );
                    })()}
```

The `as { disposition_code?: ... }` cast is a tactical narrowing because the `ServeAttempt` type may not yet declare `disposition_code` even though the column exists (added in migration `0143`). Confirm by reading the type:

```bash
grep -n "ServeAttempt" client/src/types/index.ts
```

If `ServeAttempt` already declares `disposition_code?: string | null`, drop the inline cast and just read `attempt.disposition_code`. If it doesn't, leave the cast — adding the field to the type is a PR-B concern (the chip will be the primary consumer).

- [ ] **Step 5.5: Typecheck the client**

```bash
cd client && npx tsc --noEmit 2>&1 | tail -10
cd ..
```

Expected: zero errors. If `formatCodeShort` isn't exported from the constants file, swap the import path — likely candidates are `client/src/utils/processServiceCodes.ts` or `client/src/constants/processServiceCodes.ts`. Use whichever defines it.

- [ ] **Step 5.6: Run client vitest**

```bash
cd client && npx vitest run 2>&1 | tail -10
cd ..
```

Expected: all tests pass. ServeJobCard probably has no test file; that's existing behavior, not a regression.

- [ ] **Step 5.7: Commit**

```bash
git add client/src/components/serve/ServeJobCard.tsx
git commit -m "fix(serve): attempt-history rows fall back to disposition code when notes empty

Previously attempt rows showed 'date | type | result' with empty trailing
space when an operator omitted the notes field. Now the row falls back to
formatCodeShort(disposition_code), rendered italic + dimmer so reviewers
can tell auto-derived text from operator-written text at a glance.

Per operator: code-only fallback (no hint text) — reader knows the
taxonomy from training.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 6: Update time-clock display reads

**Files (modify, same change each):**
- `client/src/pages/personnel/tabs/TimeAttendanceTab.tsx`
- `client/src/pages/mobile/cards/ShiftCard.tsx`
- `client/src/pages/MobileShiftPage.tsx`
- `client/src/pages/personnel/PersonnelDetailPanel.tsx`

- [ ] **Step 6.1: For each file, locate every read of `clock_in` / `clock_out` / `break_start` / `break_end` that ends up in display**

```bash
for f in client/src/pages/personnel/tabs/TimeAttendanceTab.tsx client/src/pages/mobile/cards/ShiftCard.tsx client/src/pages/MobileShiftPage.tsx client/src/pages/personnel/PersonnelDetailPanel.tsx; do
  echo "=== $f ==="
  grep -n "clock_in\|clock_out\|break_start\|break_end" "$f"
done
```

For each match: if the value flows into a `<time>` element, a formatter (`new Date(...).toLocale...`), or a string that gets shown to the user — it's a display read. Update it. If the value is used in math (subtraction, `getTime()`, duration calc), leave it as UTC (`clock_in`).

- [ ] **Step 6.2: Replace display reads with `_local` preference**

Pattern: `entry.clock_in` becomes `entry.clock_in_local ?? entry.clock_in`. The fallback to the legacy UTC string keeps ancient rows displayable until the backfill runs.

Apply the same swap to `clock_out` → `clock_out_local ?? clock_out` and
`break_start` → `break_start_local ?? break_start`. There is **no**
`break_end` column on `time_entries`; if a display site is showing "break
end" it's computing it from `break_start + break_minutes` (a duration),
which doesn't need a `_local` twin — the math result is already wall-clock
when both inputs are wall-clock.

Example (TimeAttendanceTab.tsx):

```tsx
// before
<td>{safeDateStr(entry.clock_in)}</td>

// after
<td>{safeDateStr(entry.clock_in_local ?? entry.clock_in)}</td>
```

If a file uses a helper that formats with `toLocaleTimeString` etc., the same swap applies — pass `clock_in_local ?? clock_in` into the helper.

`safeDateStr` (already imported in most of these files from `client/src/utils/dateUtils`) needs to handle the no-offset wall-clock format too. Verify quickly:

```bash
grep -n "safeDateStr\|parseTimestamp" client/src/utils/dateUtils.ts | head -10
```

If `safeDateStr` calls `new Date(s)` on a `YYYY-MM-DDTHH:MM:SS` string (no offset), browsers interpret it as **local time** (not UTC). That's what we want for display. If it falls through to `Invalid Date` for any reason, that file may need a tiny tolerance helper — but try the simple swap first; the format is parseable.

- [ ] **Step 6.3: Update the `TimeEntry` type to include the new columns**

```bash
grep -n "interface TimeEntry\|type TimeEntry" client/src/types/index.ts client/src/pages/personnel 2>/dev/null
```

Wherever `TimeEntry` (or similar) is defined, add the three optional fields:

```typescript
  clock_in_local?: string | null;
  clock_out_local?: string | null;
  break_start_local?: string | null;
```

(Optional, not required — historical rows have null until the backfill runs.)

- [ ] **Step 6.4: Typecheck**

```bash
cd client && npx tsc --noEmit 2>&1 | tail -10
cd ..
```

Expected: zero errors.

- [ ] **Step 6.5: Client tests**

```bash
cd client && npx vitest run 2>&1 | tail -10
cd ..
```

Expected: 0 new failures. `ShiftCard.test.tsx` exists per the explore — if it asserts a wall-clock string from `clock_in`, update the fixture to use `clock_in_local` so the test reflects the new read path.

- [ ] **Step 6.6: Commit**

```bash
git add client/src/pages/personnel/tabs/TimeAttendanceTab.tsx \
        client/src/pages/mobile/cards/ShiftCard.tsx \
        client/src/pages/MobileShiftPage.tsx \
        client/src/pages/personnel/PersonnelDetailPanel.tsx \
        client/src/types/index.ts
git commit -m "fix(personnel): display reads prefer clock_in_local with UTC fallback

Time-clock display sites now read clock_in_local ?? clock_in (and the same
for clock_out / break_start / break_end). New rows go through the dual-stamp
write path (PR-A task 3); ancient rows keep falling through to the UTC column
until scripts/backfill-time-entries-denver.js runs against live D1 post-merge.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 7: Open the PR

- [ ] **Step 7.1: Sanity-check the diff**

```bash
git log --oneline origin/main..HEAD
git diff --stat origin/main..HEAD
```

Expected: 5 commits (helper, migration, personnel routes, backfill script, ServeJobCard, display reads — possibly squashable to 5 if Task 5+6 share a commit, but the order above writes 6 commits). 8–10 files changed.

- [ ] **Step 7.2: Run BOTH test suites locally once more**

```bash
npm test -- --reporter=dot 2>&1 | tail -3
cd client && npx vitest run 2>&1 | tail -3 && cd ..
```

Expected: all green. If anything is red, stop and investigate before pushing.

- [ ] **Step 7.3: Push the branch**

```bash
git push -u origin claude/youthful-ramanujan-e393bc
```

- [ ] **Step 7.4: Open the PR**

```bash
gh pr create --title "fix(serve, personnel): attempt-notes fallback + time-clock dual-stamp (mig 0150)" --body "$(cat <<'EOF'
## Summary

PR-A of the Universal Disposition Framework program (spec:
[docs/superpowers/specs/2026-06-22-universal-disposition-framework-design.md](docs/superpowers/specs/2026-06-22-universal-disposition-framework-design.md)).

Two surgical bugs + one schema change + one backfill script:

- **Attempt-history row** in ServeJobCard now falls back to the disposition
  code's short form when the operator omits notes. Italic + dimmer styling
  distinguishes the auto-derived fallback from operator-written notes.
- **Time-clock** writes now dual-stamp UTC (canonical, for math) AND a
  DST-aware Denver wall-clock string (for display). Fixes the 6-hour-summer
  / 7-hour-winter offset every clock-in/out row was carrying. New helper
  src/utils/denverTime.ts uses Intl.DateTimeFormat with IANA zone data —
  the only DST-aware path inside Cloudflare Workers.
- **Migration 0150** adds clock_in_local / clock_out_local /
  break_start_local / break_end_local columns + an index on clock_in_local.
- **Backfill script** populates the _local columns for historical rows;
  idempotent.

## Test plan

- [ ] CI green (worker typecheck + client typecheck + client vitest + worker vitest including the 6 new denverTime tests)
- [ ] Clock in via the app at a known wall-clock time; confirm clock_in_local matches
- [ ] Open a serve job with an attempt that has a disposition_code but no notes; row shows italicized PS/XX.YY short label
- [ ] **After merge** (operator action):
  - [ ] Apply mig 0150 directly to live D1 (785de7ae) per CLAUDE.md gotcha #4
  - [ ] Run \`node scripts/backfill-time-entries-denver.js\` (defaults to --remote)
  - [ ] Verify with \`SELECT id, clock_in, clock_in_local FROM time_entries ORDER BY id DESC LIMIT 5\`

## Out of scope (later PRs in the program)

- Universal disposition registry table (PR-B)
- &lt;DispositionCodeChip&gt; / &lt;DispositionCodePicker&gt; components (PR-B)
- CC / CT taxonomies (PR-C, PR-D)
- Cross-link engine (PR-E)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed.

- [ ] **Step 7.5: Watch the checks**

```bash
gh pr checks
```

Expected: checks queue, then green. If the Workers Builds checks flake, ignore per [[feedback-workers-builds-flake]] — merge gate is GH Actions, not Workers Builds.

---

## Post-Merge Operator Actions (NOT part of the PR itself)

Once the operator merges PR-A, they (or a follow-up Claude session) must:

1. **Apply mig 0150 to live D1** — the deploy workflow's apply step is
   `continue-on-error`, so a successful CI run does not mean the column was added.
   Per CLAUDE.md and the helper script:

   ```bash
   scripts/apply-migration.sh 0150_time_entries_local_stamps.sql
   ```

2. **Run the backfill** against live D1:

   ```bash
   node scripts/backfill-time-entries-denver.js
   # Should print "Backfill complete. N rows updated across 4 columns."
   ```

3. **Verify** in the live data:

   ```bash
   npx wrangler d1 execute rmpg-flex --remote --command \
     "SELECT clock_in, clock_in_local FROM time_entries ORDER BY id DESC LIMIT 5"
   ```

   Both columns populated; the local one matches the operator's wall clock.

4. **Eyeball in the browser**: open the personnel time-attendance tab and confirm
   today's entries display the wall-clock time matching reality.

---

## Self-Review

(Performed inline during plan-writing; no separate review pass needed.)

**Spec coverage:**
- ✅ A1 Notes fallback — Task 5
- ✅ A2 Time-clock dual-stamp helper — Task 1
- ✅ A2 Migration 0150 — Task 2
- ✅ A2 Personnel route writes — Task 3
- ✅ A2 Backfill script — Task 4
- ✅ A2 Display reads — Task 6
- ✅ A3 Verification checklist — split between Step 6.5/6.6 (in-app verification, deferred to operator) and the Post-Merge Operator Actions section

**Placeholder scan:** No TBDs. No "implement later". Every code block is concrete. Two narrow tactical-cast comments are deliberate (explained inline).

**Type consistency:** `nowDualStamp()` returns `{ utc, local }` in Task 1 and is consumed with `stamp.utc` / `stamp.local` in Task 3. `formatCodeShort` signature matches between Task 5's import and the existing function in `client/src/constants/processServiceCodes.ts`.

**Spec-vs-plan gap:** The spec mentions checking `processServiceNotice.ts` for a parallel render. That's a Step-5.4 implementation-time check; if the file exists and has the same span, fix it the same way in the same commit. If it doesn't, do nothing.
