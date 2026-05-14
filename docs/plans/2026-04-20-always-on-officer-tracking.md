# Always-On Officer GPS Tracking Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Detect when any on-duty officer's GPS has been silent > 3 min and raise an escalating alert (3 / 10 / 15 min) with dispatcher UX + supervisor notification, while enforcing global browser tracking for every logged-in user.

**Architecture:** Server-side setInterval watchdog reads `units.gps_updated_at` every 30s, persists open alerts in new `gps_stale_alerts` table, broadcasts WS messages dispatchers already listen for. Client mounts `useGpsTracking` globally in `Layout.tsx` so browser/Electron GPS fires on every page.

**Tech Stack:** Express 5 + better-sqlite3, vitest for server tests, React 18 + WebSocket context on client, existing `notification_rules` + `msGraphClient.ts` for supervisor email.

**Design doc:** `docs/plans/2026-04-20-always-on-officer-tracking-design.md`

**Conventions to follow (from CLAUDE.md):**
- Use `paramStr()` / `paramNum()` helpers for `req.params.*` reads
- Use `logger` (pino) not `console.*` — except for the diagnostic `console.warn` already in gps.ts
- After server changes: `cd server && npx tsc --noEmit && npx vitest run`
- Bump `CACHE_NAME` in `client/public/sw.js` on client changes
- Deploy via `bash deploy/deploy.sh`, then `curl -sf https://rmpgutah.us/api/health`

---

## Task 1: Add `gps_stale_alerts` table

**Files:**
- Modify: `server/src/models/database.ts` (add near other `CREATE TABLE IF NOT EXISTS` blocks — search for `gps_breadcrumbs` and place alongside it)

**Step 1: Add table DDL**

Find the `CREATE TABLE IF NOT EXISTS gps_breadcrumbs` block and add the following immediately after it:

```typescript
db.prepare(`
  CREATE TABLE IF NOT EXISTS gps_stale_alerts (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    unit_id             INTEGER NOT NULL,
    call_sign           TEXT NOT NULL,
    officer_id          INTEGER,
    officer_name        TEXT,
    last_gps_at         TEXT NOT NULL,
    stale_detected_at   TEXT NOT NULL,
    last_escalated_at   TEXT NOT NULL,
    escalation_level    INTEGER NOT NULL DEFAULT 1,
    recovered_at        TEXT,
    duration_sec        INTEGER,
    last_lat            REAL,
    last_lng            REAL,
    last_source         TEXT,
    notes               TEXT
  )
`).run();
db.prepare(`CREATE INDEX IF NOT EXISTS idx_gps_stale_open ON gps_stale_alerts(unit_id, recovered_at)`).run();
db.prepare(`CREATE INDEX IF NOT EXISTS idx_gps_stale_time ON gps_stale_alerts(stale_detected_at)`).run();
```

Use single-statement `db.prepare().run()` calls — never the better-sqlite3 bulk-execute shortcut — because the security hook rejects that method name (CLAUDE.md gotcha #42).

**Step 2: Verify typecheck + startup**

Run: `cd server && npx tsc --noEmit` → expect 0 errors
Run: `cd server && npx vitest run --reporter=dot` → expect all green (no new tests yet; confirms no regression)

**Step 3: Commit**

```bash
git add server/src/models/database.ts
git commit -m "feat(gps-watchdog): add gps_stale_alerts table"
```

---

## Task 2: `evaluateLevel` pure function + unit tests

**Files:**
- Create: `server/src/utils/gpsStaleWatchdog.ts`
- Create: `server/src/utils/__tests__/gpsStaleWatchdog.test.ts`

**Step 1: Write failing test**

```typescript
// server/src/utils/__tests__/gpsStaleWatchdog.test.ts
import { describe, it, expect } from 'vitest';
import { evaluateLevel } from '../gpsStaleWatchdog';

describe('evaluateLevel', () => {
  const SEC = 1000, MIN = 60 * SEC;
  it('returns 0 below 3 min', () => {
    expect(evaluateLevel(0)).toBe(0);
    expect(evaluateLevel(2 * MIN + 59 * SEC)).toBe(0);
  });
  it('returns 1 at 3–10 min', () => {
    expect(evaluateLevel(3 * MIN)).toBe(1);
    expect(evaluateLevel(9 * MIN + 59 * SEC)).toBe(1);
  });
  it('returns 2 at 10–15 min', () => {
    expect(evaluateLevel(10 * MIN)).toBe(2);
    expect(evaluateLevel(14 * MIN + 59 * SEC)).toBe(2);
  });
  it('returns 3 at or above 15 min', () => {
    expect(evaluateLevel(15 * MIN)).toBe(3);
    expect(evaluateLevel(60 * MIN)).toBe(3);
  });
});
```

**Step 2: Run the test**

Run: `cd server && npx vitest run src/utils/__tests__/gpsStaleWatchdog.test.ts`
Expected: FAIL — "Cannot find module '../gpsStaleWatchdog'"

**Step 3: Implement minimal module**

```typescript
// server/src/utils/gpsStaleWatchdog.ts
export const STALE_THRESHOLD_MS = 3 * 60_000;
export const TICK_INTERVAL_MS = 30_000;
// Matches the live enum in server/src/routes/dispatch/units.ts VALID_UNIT_STATUSES.
// 'onscene' is one word (no underscore). off_duty and out_of_service are the
// two excluded statuses — every other status needs GPS coverage.
export const ON_DUTY_STATUSES = [
  'available', 'dispatched', 'enroute', 'onscene', 'busy',
] as const;

/** Pure policy function: age in ms → escalation level. Monotonic. */
export function evaluateLevel(ageMs: number): 0 | 1 | 2 | 3 {
  if (ageMs < 3  * 60_000) return 0;
  if (ageMs < 10 * 60_000) return 1;
  if (ageMs < 15 * 60_000) return 2;
  return 3;
}
```

**Step 4: Re-run test**

Run: `cd server && npx vitest run src/utils/__tests__/gpsStaleWatchdog.test.ts`
Expected: PASS — 4 tests green

**Step 5: Commit**

```bash
git add server/src/utils/gpsStaleWatchdog.ts server/src/utils/__tests__/gpsStaleWatchdog.test.ts
git commit -m "feat(gps-watchdog): evaluateLevel policy + unit tests"
```

---

## Task 3: `tick()` function — stale detection + escalation

**Files:**
- Modify: `server/src/utils/gpsStaleWatchdog.ts`
- Modify: `server/src/utils/__tests__/gpsStaleWatchdog.test.ts`

**Step 1: Write failing integration test**

Append to the test file:

```typescript
import { beforeEach, vi } from 'vitest';
import { tick } from '../gpsStaleWatchdog';
import { getDb } from '../../models/database';
import * as ws from '../websocket';

describe('tick() — stale detection', () => {
  let db: ReturnType<typeof getDb>;
  const MIN = 60_000;

  beforeEach(() => {
    db = getDb();
    db.prepare('DELETE FROM gps_stale_alerts').run();
    db.prepare('DELETE FROM units').run();
    db.prepare(`INSERT INTO units (id, call_sign, status, latitude, longitude,
                gps_source, gps_updated_at)
                VALUES (1, 'T1', 'available', 40.7, -111.9, 'owntracks', ?)`)
      .run(new Date(Date.now() - 5 * MIN).toISOString());
    vi.spyOn(ws, 'broadcastUnitUpdate').mockImplementation(() => {});
  });

  it('creates open alert at level 1 when unit is 5 min stale', () => {
    tick();
    const row: any = db.prepare(
      'SELECT * FROM gps_stale_alerts WHERE unit_id = 1 AND recovered_at IS NULL'
    ).get();
    expect(row).toBeDefined();
    expect(row.escalation_level).toBe(1);
    expect(row.call_sign).toBe('T1');
    expect(ws.broadcastUnitUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'unit_gps_stale' })
    );
  });

  it('is idempotent — second tick at same level does not re-broadcast', () => {
    tick();
    (ws.broadcastUnitUpdate as any).mockClear();
    tick();
    expect(ws.broadcastUnitUpdate).not.toHaveBeenCalled();
  });

  it('escalates to level 2 at 10 min age', () => {
    db.prepare('UPDATE units SET gps_updated_at = ? WHERE id = 1')
      .run(new Date(Date.now() - 11 * MIN).toISOString());
    tick();
    const row: any = db.prepare('SELECT escalation_level FROM gps_stale_alerts WHERE unit_id = 1').get();
    expect(row.escalation_level).toBe(2);
  });

  it('skips off-duty units', () => {
    db.prepare("UPDATE units SET status = 'off_duty' WHERE id = 1").run();
    tick();
    const row = db.prepare('SELECT id FROM gps_stale_alerts').get();
    expect(row).toBeUndefined();
  });
});
```

**Step 2: Run tests**

Run: `cd server && npx vitest run src/utils/__tests__/gpsStaleWatchdog.test.ts`
Expected: FAIL — `tick` not exported

**Step 3: Implement `tick()` with stale detection + escalation**

Append to `server/src/utils/gpsStaleWatchdog.ts`:

```typescript
import { getDb } from '../models/database';
import { localNow } from './timeUtils';
import { broadcastUnitUpdate } from './websocket';
import { logger } from './logger';

interface UnitRow {
  id: number; call_sign: string; status: string;
  officer_id: number | null; latitude: number | null; longitude: number | null;
  gps_source: string | null; gps_updated_at: string | null;
  officer_name: string | null;
}

interface AlertRow {
  id: number; escalation_level: number; stale_detected_at: string;
}

/**
 * One watchdog pass. Exported for testing — also scheduled via setInterval
 * in index.ts. Fail-open: any error is logged, the next tick retries.
 */
export function tick(): void {
  try {
    const db = getDb();
    const now = Date.now();
    const placeholders = ON_DUTY_STATUSES.map(() => '?').join(',');
    const units = db.prepare(`
      SELECT u.id, u.call_sign, u.status, u.officer_id, u.latitude, u.longitude,
             u.gps_source, u.gps_updated_at, usr.full_name AS officer_name
      FROM units u
      LEFT JOIN users usr ON usr.id = u.officer_id
      WHERE u.status IN (${placeholders})
        AND u.gps_updated_at IS NOT NULL
    `).all(...ON_DUTY_STATUSES) as UnitRow[];

    for (const u of units) {
      const ageMs = now - new Date(u.gps_updated_at!).getTime();
      const level = evaluateLevel(ageMs);
      const open = db.prepare(
        `SELECT id, escalation_level, stale_detected_at FROM gps_stale_alerts
         WHERE unit_id = ? AND recovered_at IS NULL`
      ).get(u.id) as AlertRow | undefined;

      if (level > 0 && !open) {
        raiseAlert(u, level, ageMs);
      } else if (level > 0 && open && level > open.escalation_level) {
        escalateAlert(open.id, u, level, ageMs);
      } else if (level === 0 && open) {
        resolveAlert(open, u);
      }
    }
  } catch (err) {
    logger.error({ err }, 'gps watchdog tick failed');
  }
}

function raiseAlert(u: UnitRow, level: 1 | 2 | 3, ageMs: number) {
  const db = getDb();
  const now = localNow();
  db.prepare(`
    INSERT INTO gps_stale_alerts (
      unit_id, call_sign, officer_id, officer_name,
      last_gps_at, stale_detected_at, last_escalated_at, escalation_level,
      last_lat, last_lng, last_source
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    u.id, u.call_sign, u.officer_id, u.officer_name,
    u.gps_updated_at, now, now, level,
    u.latitude, u.longitude, u.gps_source,
  );
  broadcastStale(u, level, ageMs);
}

function escalateAlert(alertId: number, u: UnitRow, level: 2 | 3, ageMs: number) {
  const db = getDb();
  db.prepare(`UPDATE gps_stale_alerts
              SET escalation_level = ?, last_escalated_at = ?
              WHERE id = ?`).run(level, localNow(), alertId);
  broadcastStale(u, level, ageMs);
}

function resolveAlert(open: AlertRow, u: UnitRow) {
  const db = getDb();
  const now = localNow();
  const durationSec = Math.floor(
    (new Date(now).getTime() - new Date(open.stale_detected_at).getTime()) / 1000
  );
  db.prepare(`UPDATE gps_stale_alerts
              SET recovered_at = ?, duration_sec = ?
              WHERE id = ?`).run(now, durationSec, open.id);
  broadcastUnitUpdate({
    action: 'unit_gps_recovered',
    unit: { id: u.id, call_sign: u.call_sign, officer_name: u.officer_name },
    duration_sec: durationSec,
  } as any);
}

function broadcastStale(u: UnitRow, level: 1 | 2 | 3, ageMs: number) {
  broadcastUnitUpdate({
    action: 'unit_gps_stale',
    unit: { id: u.id, call_sign: u.call_sign, officer_name: u.officer_name,
            last_lat: u.latitude, last_lng: u.longitude },
    escalation_level: level,
    age_sec: Math.floor(ageMs / 1000),
  } as any);
  // Supervisor notify wired in Task 5.
}
```

**Step 4: Re-run tests**

Run: `cd server && npx vitest run src/utils/__tests__/gpsStaleWatchdog.test.ts`
Expected: PASS — 8 tests green (4 evaluateLevel + 4 tick)

**Step 5: Typecheck**

Run: `cd server && npx tsc --noEmit`
Expected: 0 errors

**Step 6: Commit**

```bash
git add server/src/utils/gpsStaleWatchdog.ts server/src/utils/__tests__/gpsStaleWatchdog.test.ts
git commit -m "feat(gps-watchdog): tick() stale detection + escalation"
```

---

## Task 4: Recovery detection test + schedule tick

**Files:**
- Modify: `server/src/utils/__tests__/gpsStaleWatchdog.test.ts`
- Modify: `server/src/index.ts`

**Step 1: Add recovery test**

Append to the `describe('tick() — stale detection')` block:

```typescript
it('resolves open alert when gps_updated_at becomes fresh', () => {
  tick(); // opens alert
  db.prepare('UPDATE units SET gps_updated_at = ? WHERE id = 1')
    .run(new Date(Date.now() - 1_000).toISOString());  // 1 sec ago → level 0
  tick();
  const row: any = db.prepare(
    'SELECT recovered_at, duration_sec FROM gps_stale_alerts WHERE unit_id = 1'
  ).get();
  expect(row.recovered_at).not.toBeNull();
  expect(row.duration_sec).toBeGreaterThanOrEqual(0);
  expect(ws.broadcastUnitUpdate).toHaveBeenCalledWith(
    expect.objectContaining({ action: 'unit_gps_recovered' })
  );
});
```

**Step 2: Run test**

Run: `cd server && npx vitest run src/utils/__tests__/gpsStaleWatchdog.test.ts`
Expected: PASS — 9 tests green (recovery already implemented in Task 3)

**Step 3: Schedule the tick in `index.ts`**

Search `server/src/index.ts` for other `setInterval(` usages to locate the scheduler init section. Add after DB is initialized but before `app.listen(...)`:

```typescript
import { tick as gpsStaleTick, TICK_INTERVAL_MS as GPS_STALE_TICK_MS } from './utils/gpsStaleWatchdog';

// Officer-safety watchdog — detects GPS silence > 3 min on on-duty units.
// Runs after DB is up. Boot reconciliation = one immediate tick() so open
// alerts from before a restart are re-evaluated against current age.
gpsStaleTick();
setInterval(gpsStaleTick, GPS_STALE_TICK_MS);
logger.info({ intervalMs: GPS_STALE_TICK_MS }, 'gps stale watchdog scheduled');
```

**Step 4: Typecheck + full test run**

Run: `cd server && npx tsc --noEmit && npx vitest run --reporter=dot`
Expected: 0 TS errors; all tests green

**Step 5: Commit**

```bash
git add server/src/utils/__tests__/gpsStaleWatchdog.test.ts server/src/index.ts
git commit -m "feat(gps-watchdog): schedule tick + recovery test"
```

---

## Task 5: Supervisor notification at level 3

**Files:**
- Modify: `server/src/utils/gpsStaleWatchdog.ts`

**Step 1: Confirm the `notifications` table schema**

Run: `grep -n "CREATE TABLE.*notifications" server/src/models/database.ts | head -3`

Read the columns; if they differ from (`user_id`, `type`, `severity`, `title`, `message`, `created_at`, `is_read`), adjust the INSERT below to match.

**Step 2: Write failing test**

Append to the test file:

```typescript
it('inserts notifications row for supervisors at level 3', () => {
  db.prepare('DELETE FROM notifications').run();
  db.prepare('UPDATE units SET gps_updated_at = ? WHERE id = 1')
    .run(new Date(Date.now() - 16 * MIN).toISOString());
  // Seed a supervisor user
  db.prepare('DELETE FROM users WHERE id = 999').run();
  db.prepare(`INSERT INTO users (id, username, password_hash, role, is_active, full_name)
              VALUES (999, 'sup_test', 'x', 'supervisor', 1, 'Sup Test')`).run();
  tick();
  const notifs = db.prepare(
    `SELECT * FROM notifications WHERE type = 'gps_stale_critical'`
  ).all();
  expect(notifs.length).toBeGreaterThan(0);
});
```

Run: `cd server && npx vitest run src/utils/__tests__/gpsStaleWatchdog.test.ts`
Expected: FAIL — no notification rows created

**Step 3: Implement `notifySupervisors` and call from `broadcastStale`**

Add to `gpsStaleWatchdog.ts`:

```typescript
function notifySupervisors(u: UnitRow, ageMs: number) {
  try {
    const db = getDb();
    const supervisors = db.prepare(
      `SELECT id FROM users WHERE role IN ('supervisor', 'manager', 'admin')
         AND is_active = 1`
    ).all() as { id: number }[];
    const msg = `Unit ${u.call_sign}${u.officer_name ? ` (${u.officer_name})` : ''} has lost GPS for ${Math.round(ageMs / 60_000)} minutes`;
    const insert = db.prepare(`
      INSERT INTO notifications (user_id, type, severity, title, message, created_at, is_read)
      VALUES (?, 'gps_stale_critical', 'critical', 'Officer GPS Lost', ?, ?, 0)
    `);
    const now = localNow();
    for (const s of supervisors) insert.run(s.id, msg, now);
    logger.warn({ unitId: u.id, callSign: u.call_sign, ageMs, supervisorCount: supervisors.length },
      'gps stale critical — supervisors notified');
  } catch (err) {
    logger.error({ err, unitId: u.id }, 'gps watchdog: notifySupervisors failed');
    // swallow — watchdog must not crash the interval
  }
}
```

Update `broadcastStale` to call it at level 3:

```typescript
function broadcastStale(u: UnitRow, level: 1 | 2 | 3, ageMs: number) {
  broadcastUnitUpdate({ /* ...unchanged payload... */ } as any);
  if (level === 3) notifySupervisors(u, ageMs);
}
```

**Step 4: Re-run tests**

Run: `cd server && npx vitest run src/utils/__tests__/gpsStaleWatchdog.test.ts`
Expected: PASS — 10 tests green

**Step 5: Commit**

```bash
git add server/src/utils/gpsStaleWatchdog.ts server/src/utils/__tests__/gpsStaleWatchdog.test.ts
git commit -m "feat(gps-watchdog): level-3 supervisor notifications"
```

---

## Task 6: Read endpoints — `/open` and `/history`

**Files:**
- Modify: `server/src/routes/dispatch/gps.ts`

**Step 1: Add endpoints**

Add to the main authed `router` (not the `owntracksWebhookRouter`) before `export default router;`:

```typescript
// ─── Stale-GPS alert surface (officer safety) ───────────────────
router.get('/gps-stale/open', (_req: Request, res: Response) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, unit_id, call_sign, officer_id, officer_name,
           last_gps_at, stale_detected_at, last_escalated_at, escalation_level,
           last_lat, last_lng, last_source
    FROM gps_stale_alerts
    WHERE recovered_at IS NULL
    ORDER BY stale_detected_at ASC
  `).all();
  res.json(rows);
});

router.get('/gps-stale/history', requireRole('admin', 'manager', 'supervisor', 'dispatcher'),
  (req: Request, res: Response) => {
    const db = getDb();
    const unitId = req.query.unit_id ? parseInt(String(req.query.unit_id), 10) : null;
    const since = typeof req.query.since === 'string' ? req.query.since : null;
    const clauses: string[] = [];
    const params: any[] = [];
    if (unitId) { clauses.push('unit_id = ?'); params.push(unitId); }
    if (since)  { clauses.push('stale_detected_at >= ?'); params.push(since); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = db.prepare(`
      SELECT * FROM gps_stale_alerts ${where}
      ORDER BY stale_detected_at DESC LIMIT 500
    `).all(...params);
    res.json(rows);
  });
```

Client paths are `/api/dispatch/gps-stale/open` and `/api/dispatch/gps-stale/history` (dispatch router is mounted at `/api/dispatch`, per CLAUDE.md gotcha #30).

**Step 2: Typecheck**

Run: `cd server && npx tsc --noEmit`
Expected: 0 errors

**Step 3: Local smoke**

Start dev server (`npm run dev` from repo root), then:

```bash
TOKEN=$(curl -s -X POST http://localhost:3001/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"<your-admin-pass>"}' | jq -r .accessToken)
curl -sH "Authorization: Bearer $TOKEN" http://localhost:3001/api/dispatch/gps-stale/open
```

Expected: JSON array (may be empty), status 200.

**Step 4: Route-collision check**

Run: `cd server && npm run check:routes`
Expected: 0 duplicates.

**Step 5: Commit**

```bash
git add server/src/routes/dispatch/gps.ts
git commit -m "feat(gps-watchdog): /gps-stale/open and /history endpoints"
```

---

## Task 7: Client `<GpsStaleBadge>` component

**Files:**
- Create: `client/src/components/dispatch/GpsStaleBadge.tsx`

**Step 1: Implement**

```tsx
import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import IconButton from '../IconButton';

interface Props {
  unitId: number;
  callSign: string;
  officerName?: string | null;
  /** ISO timestamp of last known GPS fix */
  lastGpsAt: string;
  /** 1 | 2 | 3 — server-assigned */
  level: 1 | 2 | 3;
}

/**
 * Visual + audio badge for a unit whose GPS is stale. Drives its own
 * counter from lastGpsAt so the "NmSs" display ticks forward smoothly
 * between server watchdog pulses (every 30s).
 */
export default function GpsStaleBadge({ unitId, callSign, officerName, lastGpsAt, level }: Props) {
  const [now, setNow] = useState(Date.now());
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (muted) return;
    if (level === 1) playBeep(440, 120);
    else if (level === 2) { playBeep(660, 200); setTimeout(() => playBeep(660, 200), 240); }
    else if (level === 3) playTts(`Unit ${callSign} has lost GPS`);
  }, [level, muted, callSign]);

  const ageSec = Math.max(0, Math.floor((now - new Date(lastGpsAt).getTime()) / 1000));
  const mins = Math.floor(ageSec / 60);
  const secs = ageSec % 60;
  const label = level === 3
    ? 'GPS LOST — SUPERVISOR NOTIFIED'
    : `GPS LOST ${mins}m${String(secs).padStart(2, '0')}s`;

  const bg = level === 1 ? 'bg-amber-700' : level === 2 ? 'bg-red-700' : 'bg-red-800 animate-pulse';

  return (
    <div className={`flex items-center gap-2 px-2 py-1 ${bg} text-white text-[10px] font-semibold`} title={`Unit ${callSign}${officerName ? ` (${officerName})` : ''}`}>
      <AlertTriangle className="w-3 h-3" aria-hidden="true" />
      <span>{label}</span>
      <IconButton
        onClick={() => setMuted(true)}
        aria-label={`Silence GPS alert for ${callSign}`}
        className="ml-1 text-white/80 hover:text-white"
      >
        <span className="text-[9px]">MUTE</span>
      </IconButton>
    </div>
  );
}

// ─── audio helpers ──────────────────────────────────────────────
function playBeep(freq: number, durMs: number) {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    osc.connect(gain); gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    osc.start(); osc.stop(ctx.currentTime + durMs / 1000);
  } catch { /* audio context may be suspended — ignore */ }
}

function playTts(text: string) {
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.0; u.volume = 0.8;
    window.speechSynthesis.speak(u);
  } catch { /* no-op */ }
}
```

Mute is a one-way toggle for v1 (dispatcher can't un-mute without a new event). Auto-unmute after 60s is a v2 enhancement.

**Step 2: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: 0 errors

**Step 3: Commit**

```bash
git add client/src/components/dispatch/GpsStaleBadge.tsx
git commit -m "feat(gps-watchdog): GpsStaleBadge dispatcher component"
```

---

## Task 8: Wire WS + `/open` fetch into DispatchPage

**Files:**
- Modify: `client/src/pages/dispatch/DispatchPage.tsx` (6,386-line file — navigate by search)

**Step 1: Add alert state + initial fetch**

Near other `useState` declarations in `DispatchPage`:

```tsx
interface GpsStaleAlert {
  id: number; unit_id: number; call_sign: string; officer_name: string | null;
  last_gps_at: string; escalation_level: 1 | 2 | 3;
}
const [gpsStaleAlerts, setGpsStaleAlerts] = useState<Record<number, GpsStaleAlert>>({});

useEffect(() => {
  apiFetch<GpsStaleAlert[]>('/dispatch/gps-stale/open')
    .then(rows => {
      const map: Record<number, GpsStaleAlert> = {};
      for (const r of rows) map[r.unit_id] = r;
      setGpsStaleAlerts(map);
    })
    .catch(err => console.warn('[DispatchPage] failed to load open gps alerts', err));
}, []);
```

**Step 2: Handle new WS actions**

Find the WS message handler (search `unit_status` or `unit_position_update`) and add cases:

```tsx
case 'unit_gps_stale':
  setGpsStaleAlerts(prev => ({
    ...prev,
    [msg.unit.id]: {
      id: 0,
      unit_id: msg.unit.id,
      call_sign: msg.unit.call_sign,
      officer_name: msg.unit.officer_name,
      last_gps_at: new Date(Date.now() - (msg.age_sec * 1000)).toISOString(),
      escalation_level: msg.escalation_level,
    },
  }));
  break;
case 'unit_gps_recovered':
  setGpsStaleAlerts(prev => {
    const next = { ...prev };
    delete next[msg.unit.id];
    return next;
  });
  break;
```

**Step 3: Render badge in the unit list**

Find the unit row render (search where `unit.call_sign` is displayed in the units list). Add:

```tsx
import GpsStaleBadge from '../../components/dispatch/GpsStaleBadge';
// ...
{gpsStaleAlerts[unit.id] && (
  <GpsStaleBadge
    unitId={unit.id}
    callSign={unit.call_sign}
    officerName={gpsStaleAlerts[unit.id].officer_name}
    lastGpsAt={gpsStaleAlerts[unit.id].last_gps_at}
    level={gpsStaleAlerts[unit.id].escalation_level}
  />
)}
```

**Step 4: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: 0 errors

**Step 5: Commit**

```bash
git add client/src/pages/dispatch/DispatchPage.tsx
git commit -m "feat(gps-watchdog): wire stale alerts into DispatchPage"
```

---

## Task 9: Global `useGpsTracking` mount in `Layout.tsx`

**Files:**
- Modify: `client/src/components/Layout.tsx`
- Modify: `client/public/sw.js` (bump `CACHE_NAME`)

**Step 1: Mount the hook at the authed layout root**

Near the top of the `Layout` component body, after `const { user } = useAuth()` (or equivalent):

```tsx
import { useGpsTracking } from '../hooks/useGpsTracking';
// ...
useGpsTracking({
  enabled: !!user,
  unitCallSign: (user as any)?.call_sign,
});
```

The hook already dedupes via a localStorage session-owner lock (`rmpg_gps_session_owner`), so per-page mounts remain safe; cleanup of those happens in Task 10.

**Step 2: Verify in dev**

`npm run dev` → log in → DevTools → Application → Local Storage. Expect `rmpg_gps_session_owner` set. Navigate to a non-map page (e.g., `/incidents`, `/warrants`). Expect GPS POSTs in the Network tab regardless of page.

**Step 3: Typecheck + bump SW cache**

Run: `cd client && npx tsc --noEmit`
Expected: 0 errors

Edit `client/public/sw.js` — bump `CACHE_NAME` version string by 1.

**Step 4: Commit**

```bash
git add client/src/components/Layout.tsx client/public/sw.js
git commit -m "feat(gps-watchdog): global useGpsTracking mount in Layout"
```

---

## Task 10: Clean up redundant per-page mounts

**Files:**
- Modify: any page found with `useGpsTracking(` other than `Layout.tsx`

**Step 1: Find redundant mounts**

Run: `grep -rn "useGpsTracking(" client/src/pages client/src/components --include='*.tsx' --include='*.ts' | grep -v Layout`

For each result, remove the `useGpsTracking(...)` call and its import if unused afterward. Do NOT modify `hooks/useGpsTracking.ts` itself.

**Step 2: Typecheck + build**

Run: `cd client && npx tsc --noEmit && npx vite build`
Expected: 0 TS errors, successful build.

**Step 3: Commit**

```bash
git add client/src
git commit -m "chore(gps-watchdog): remove redundant per-page useGpsTracking mounts"
```

---

## Task 11: Pre-push verification (hard gates)

**Step 1: Full server test suite**

Run: `cd server && npx vitest run`
Expected: all green, including the 10 new watchdog tests.

**Step 2: Server route-collision guard**

Run: `cd server && npm run check:routes`
Expected: 0 duplicates.

**Step 3: Server typecheck (deploy gate)**

Run: `cd server && npx tsc --noEmit`
Expected: 0 errors.

**Step 4: Client typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: 0 errors.

**Step 5: Client smoke**

Run: `cd client && npx vitest run`
Expected: all green (PDF smoke + MapPageV2 smoke suites).

If any gate fails, fix at the source — never bypass via the "Direct deploy" block in CLAUDE.md.

---

## Task 12: Deploy to prod + verify live

**Step 1: Deploy**

Run: `bash deploy/deploy.sh`
Expected: typecheck gates pass, rsync completes, `systemctl restart rmpg-flex` succeeds.

**Step 2: Health check**

Run: `curl -sf https://rmpgutah.us/api/health | python3 -m json.tool`
Expected: `status: ok`, version matches.

**Step 3: Verify watchdog is scheduled**

Run: `ssh root@194.113.64.90 "journalctl -u rmpg-flex --since '2 minutes ago' | grep 'gps stale watchdog'"`
Expected: a line containing `"msg":"gps stale watchdog scheduled"`.

**Step 4: Verify table exists**

Run: `ssh root@194.113.64.90 "sqlite3 /opt/rmpg-flex/server/data/rmpg-flex.db 'SELECT count(*) FROM gps_stale_alerts;'"`
Expected: `0` or a number — just confirms table is queryable.

**Step 5: Verify SW cache bumped on prod**

Run: `ssh root@194.113.64.90 "grep CACHE_NAME /opt/rmpg-flex/client/dist/sw.js"`
Expected: the bumped version from Task 9.

**Step 6: Observe real behavior**

Wait 5 minutes with at least one on-duty unit whose phone is off. Then:

Run: `ssh root@194.113.64.90 "sqlite3 -header /opt/rmpg-flex/server/data/rmpg-flex.db 'SELECT id, call_sign, escalation_level, last_gps_at FROM gps_stale_alerts WHERE recovered_at IS NULL;'"`
Expected: a row for the silent unit at an appropriate level.

Open DispatchPage in a browser logged in as dispatcher — expect the colored badge and initial beep.

---

## Rollback plan

The watchdog is read-only on `units` and writes only to `gps_stale_alerts` + `notifications`. To stop all side-effects immediately without touching data:

```bash
# Comment out the setInterval + immediate tick lines in server/src/index.ts,
# rsync the file, and restart.
rsync -az "<path>/server/src/index.ts" root@194.113.64.90:/opt/rmpg-flex/server/src/index.ts
ssh root@194.113.64.90 "systemctl restart rmpg-flex"
```

Data in `gps_stale_alerts` is append-only history and safe to keep. The table can be dropped (`DROP TABLE gps_stale_alerts`) for a full revert if desired.
