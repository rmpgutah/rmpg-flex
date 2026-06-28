# Process-Service Assignment Console & Overdue Nudges — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a supervisor assignment console (roster + jobs), an officer "My Run" view, and a needs-attention engine (deadline approaching/passed, diligence gap, unassigned near deadline) surfaced as in-app badges and a 4-hourly cron that pushes notifications + a supervisor email digest.

**Architecture:** A pure, unit-tested classifier (`classifyServeJob`) holds all attention logic and is shared by the board, the needs-attention endpoint, and the cron sweep. Assignment reuses `serve_queue.officer_id` with `activity_log` audit. The cron sweep reuses the existing `notifications` table and `email_outbox` (drained by the existing email cron). Two small new tables: `serve_nudges` (dedup) and `serve_nudge_settings` (editable thresholds).

**Tech Stack:** Cloudflare Workers + Hono, D1 (via `src/utils/db.ts`), React 18 + Vite, vitest (worker tests in `tests/`, node env; client tests in `client/`, jsdom).

**Spec:** [docs/superpowers/specs/2026-06-13-process-service-assignment-console-design.md](../specs/2026-06-13-process-service-assignment-console-design.md)

---

## File Structure

**Create:**
- `migrations/01NN_serve_assignment_nudges.sql` — `serve_nudges` + `serve_nudge_settings` (+ seed). **01NN = next truly-free integer at impl time; `0104`/`0105` are contended by other PRs — verify `ls migrations/` + open PRs.**
- `src/utils/serveAttention.ts` — pure `classifyServeJob` + `shouldNotify` (no DB).
- `tests/serveAttention.test.ts` — classifier + dedup unit tests.
- `src/utils/serveNudgeSweep.ts` — cron sweep (classify → notifications + email_outbox enqueue + dedup).
- `client/src/hooks/useServeAssignments.ts` — board/assign/needs-attention/settings fetch+mutate.
- `client/src/pages/serve/serveAssignHelpers.ts` — pure board/reducer helpers.
- `client/src/pages/serve/__tests__/serveAssignHelpers.test.ts` — helper tests.
- `client/src/pages/serve/AssignTab.tsx` — Roster + jobs split board.
- `client/src/pages/serve/MyRunTab.tsx` — officer focused run view.

**Modify:**
- `src/routes/serve.ts` — `/assignments/board`, `/assignments/assign`, `/assignments/needs-attention`, `/assignments/settings` (GET/PUT).
- `src/index.ts` — call `sweepServeNudges` in the 4-hourly cron branch.
- `client/src/pages/ServePage.tsx` — add `Assign` (supervisor-gated) + `My Run` tabs.
- `client/public/sw.js` — bump `CACHE_NAME`.

**Reference (read, don't change):**
- `src/utils/intelWatchlist.ts` — the sweep + `notifications` INSERT template.
- `src/routes/email.ts:819` — the `email_outbox` enqueue shape; `drainEmailOutbox` sends it.
- `src/routes/serve.ts` — `requireRole`, `WRITE`/`READ`, `getDb`/`query`/`queryFirst`/`execute`.

---

## Conventions for every task
- DB: `const db = getDb(c.env);` then `await query<T>(db, sql, ...binds)` / `queryFirst` / `execute`.
- Role gate (the local helper already in `serve.ts`): `const denied = requireRole(c, 'admin','manager','supervisor'); if (denied) return c.json({ error: denied }, 403);`
- Worker tests: `npm test`. Client: `cd client && npx vitest run` / `npx tsc --noEmit` / `npx vite build`. Worker types: `npm run typecheck`.
- Money/time: compare timestamps via `new Date(...)`; guard `NaN`.
- Commits small + frequent; ship via PR (`gh pr create`), not direct push.

---

# Milestone 1 — Schema + pure classifier

## Task 1: Migration `01NN_serve_assignment_nudges.sql`

**Files:** Create `migrations/01NN_serve_assignment_nudges.sql`

- [ ] **Step 1: Determine the migration number**

Run: `ls migrations/ | grep -E '^01' | sort | tail -6`
Pick the next integer **not already present and not used by an open PR** (the repo currently has `0104` contention). Use that as `NN`; name the file accordingly. Use the chosen number consistently below.

- [ ] **Step 2: Write the migration**

```sql
-- ============================================================
-- 01NN_serve_assignment_nudges.sql
-- Phase 2: serve-job needs-attention nudges.
-- serve_nudges = dedup tracking (cron won't re-spam a job+condition);
-- serve_nudge_settings = editable thresholds (single row).
-- Assignment itself reuses serve_queue.officer_id + activity_log audit
-- (no serve_queue ALTER).
-- ============================================================

CREATE TABLE IF NOT EXISTS serve_nudges (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  serve_queue_id   INTEGER NOT NULL,
  condition        TEXT NOT NULL,
  last_notified_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE(serve_queue_id, condition)
);
CREATE INDEX IF NOT EXISTS idx_serve_nudges_job ON serve_nudges(serve_queue_id);

CREATE TABLE IF NOT EXISTS serve_nudge_settings (
  id                       INTEGER PRIMARY KEY CHECK(id = 1),
  approaching_hours        INTEGER NOT NULL DEFAULT 48,
  diligence_gap_days       INTEGER NOT NULL DEFAULT 3,
  unassigned_window_hours  INTEGER NOT NULL DEFAULT 72,
  renotify_hours           INTEGER NOT NULL DEFAULT 24,
  notify_supervisor_email  INTEGER NOT NULL DEFAULT 1,
  digest_sender_user_id    INTEGER,
  updated_at               TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_by               INTEGER
);

INSERT OR IGNORE INTO serve_nudge_settings (id) VALUES (1);
```

- [ ] **Step 3: Apply local + verify**

Run: `npx wrangler d1 execute rmpg-flex --local --file migrations/01NN_serve_assignment_nudges.sql`
Run: `npx wrangler d1 execute rmpg-flex --local --command "SELECT approaching_hours, diligence_gap_days, renotify_hours FROM serve_nudge_settings WHERE id=1;"`
Expected: one row `48 | 3 | 24`.

(Note: `npm run migrate:local` may fail on the pre-existing `0064` baseline drift — apply this file directly with `--file` as above, that's expected.)

- [ ] **Step 4: Commit**

```bash
git add migrations/01NN_serve_assignment_nudges.sql
git commit -m "feat(serve): 01NN serve_nudges + serve_nudge_settings schema"
```

---

## Task 2: Pure `serveAttention.ts` (classifier + dedup) — TDD

**Files:** Create `src/utils/serveAttention.ts`; Test `tests/serveAttention.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/serveAttention.test.ts
import { describe, it, expect } from 'vitest';
import { classifyServeJob, shouldNotify, type ServeJobForAttention, type AttentionSettings } from '../src/utils/serveAttention';

const SETTINGS: AttentionSettings = { approaching_hours: 48, diligence_gap_days: 3, unassigned_window_hours: 72 };
const NOW = '2026-06-13T18:00:00.000Z';

const JOB = (p: Partial<ServeJobForAttention> = {}): ServeJobForAttention => ({
  id: 1, status: 'assigned', officer_id: 7, deadline: null, last_attempt_at: null, ...p,
});

describe('classifyServeJob', () => {
  it('returns nothing for an open job with no deadline and a recent attempt', () => {
    expect(classifyServeJob(JOB({ last_attempt_at: NOW }), NOW, SETTINGS)).toEqual([]);
  });

  it('flags deadline_passed when the deadline is in the past', () => {
    const r = classifyServeJob(JOB({ deadline: '2026-06-12T18:00:00.000Z', last_attempt_at: NOW }), NOW, SETTINGS);
    expect(r).toContain('deadline_passed');
    expect(r).not.toContain('deadline_approaching');
  });

  it('flags deadline_approaching within the window but not past', () => {
    const r = classifyServeJob(JOB({ deadline: '2026-06-14T18:00:00.000Z', last_attempt_at: NOW }), NOW, SETTINGS); // +24h
    expect(r).toContain('deadline_approaching');
    expect(r).not.toContain('deadline_passed');
  });

  it('does NOT flag approaching when the deadline is beyond the window', () => {
    const r = classifyServeJob(JOB({ deadline: '2026-06-20T18:00:00.000Z', last_attempt_at: NOW }), NOW, SETTINGS); // +7d
    expect(r).not.toContain('deadline_approaching');
  });

  it('flags diligence_gap when assigned and no attempt past the gap window', () => {
    expect(classifyServeJob(JOB({ last_attempt_at: null }), NOW, SETTINGS)).toContain('diligence_gap');
    expect(classifyServeJob(JOB({ last_attempt_at: '2026-06-08T18:00:00.000Z' }), NOW, SETTINGS)).toContain('diligence_gap'); // 5d ago
    expect(classifyServeJob(JOB({ last_attempt_at: '2026-06-12T18:00:00.000Z' }), NOW, SETTINGS)).not.toContain('diligence_gap'); // 1d ago
  });

  it('flags unassigned_near_deadline only when unassigned and within window', () => {
    const r = classifyServeJob(JOB({ officer_id: null, deadline: '2026-06-15T18:00:00.000Z' }), NOW, SETTINGS); // +48h, within 72h
    expect(r).toContain('unassigned_near_deadline');
    const assigned = classifyServeJob(JOB({ officer_id: 7, deadline: '2026-06-15T18:00:00.000Z' }), NOW, SETTINGS);
    expect(assigned).not.toContain('unassigned_near_deadline');
  });

  it('never classifies a closed job', () => {
    for (const status of ['served', 'cancelled', 'failed']) {
      expect(classifyServeJob(JOB({ status, deadline: '2026-06-01T00:00:00.000Z', officer_id: null }), NOW, SETTINGS)).toEqual([]);
    }
  });
});

describe('shouldNotify', () => {
  it('notifies when never notified', () => {
    expect(shouldNotify(null, NOW, 24)).toBe(true);
  });
  it('suppresses inside the renotify window, allows after', () => {
    expect(shouldNotify('2026-06-13T06:00:00.000Z', NOW, 24)).toBe(false); // 12h ago < 24h
    expect(shouldNotify('2026-06-12T06:00:00.000Z', NOW, 24)).toBe(true);  // 36h ago > 24h
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- serveAttention`
Expected: FAIL — cannot find `../src/utils/serveAttention`.

- [ ] **Step 3: Implement**

```ts
// src/utils/serveAttention.ts
// Pure needs-attention classifier for process-serve jobs. No DB access.

export type AttentionCondition =
  | 'deadline_passed' | 'deadline_approaching' | 'diligence_gap' | 'unassigned_near_deadline';

export interface AttentionSettings {
  approaching_hours: number;
  diligence_gap_days: number;
  unassigned_window_hours: number;
}

export interface ServeJobForAttention {
  id: number;
  status: string;
  officer_id: number | null;
  deadline: string | null;
  last_attempt_at: string | null;
}

const CLOSED = new Set(['served', 'cancelled', 'failed']);

function hoursBetween(aIso: string, bIso: string): number | null {
  const a = new Date(aIso).getTime();
  const b = new Date(bIso).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return (a - b) / 3_600_000;
}

export function classifyServeJob(
  job: ServeJobForAttention, nowIso: string, settings: AttentionSettings,
): AttentionCondition[] {
  if (CLOSED.has(job.status)) return [];
  const out: AttentionCondition[] = [];

  // Deadline conditions (passed outranks approaching).
  if (job.deadline) {
    const hToDeadline = hoursBetween(job.deadline, nowIso);
    if (hToDeadline !== null) {
      if (hToDeadline < 0) out.push('deadline_passed');
      else if (hToDeadline <= settings.approaching_hours) out.push('deadline_approaching');
    }
  }

  // Diligence gap: assigned + open + (no attempt or last attempt older than gap).
  if (job.officer_id != null) {
    const gapHours = settings.diligence_gap_days * 24;
    if (!job.last_attempt_at) {
      out.push('diligence_gap');
    } else {
      const sinceLast = hoursBetween(nowIso, job.last_attempt_at);
      if (sinceLast !== null && sinceLast > gapHours) out.push('diligence_gap');
    }
  }

  // Unassigned near deadline.
  if (job.officer_id == null && job.deadline) {
    const hToDeadline = hoursBetween(job.deadline, nowIso);
    if (hToDeadline !== null && hToDeadline <= settings.unassigned_window_hours) {
      out.push('unassigned_near_deadline');
    }
  }

  return out;
}

export function shouldNotify(lastNotifiedAt: string | null, nowIso: string, renotifyHours: number): boolean {
  if (!lastNotifiedAt) return true;
  const since = hoursBetween(nowIso, lastNotifiedAt);
  if (since === null) return true;
  return since > renotifyHours;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- serveAttention`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/serveAttention.ts tests/serveAttention.test.ts
git commit -m "feat(serve): pure needs-attention classifier + dedup + tests"
```

---

# Milestone 2 — Assignment endpoints

## Task 3: `/assignments/board` + `/assignments/assign`

**Files:** Modify `src/routes/serve.ts`

Add an import at the top alongside the existing imports:
```ts
import { classifyServeJob, type ServeJobForAttention, type AttentionSettings } from '../utils/serveAttention';
```

- [ ] **Step 1: Add a settings loader + the board endpoint**

Insert before the `sv.get('/', …)` list handler (keep static paths above `/:id`):

```ts
// ── Assignment console ─────────────────────────────────────
async function loadNudgeSettings(db: ReturnType<typeof getDb>): Promise<AttentionSettings & { renotify_hours: number; notify_supervisor_email: number; digest_sender_user_id: number | null }> {
  const row = await queryFirst<any>(db, 'SELECT * FROM serve_nudge_settings WHERE id = 1').catch(() => null);
  return {
    approaching_hours: row?.approaching_hours ?? 48,
    diligence_gap_days: row?.diligence_gap_days ?? 3,
    unassigned_window_hours: row?.unassigned_window_hours ?? 72,
    renotify_hours: row?.renotify_hours ?? 24,
    notify_supervisor_email: row?.notify_supervisor_email ?? 1,
    digest_sender_user_id: row?.digest_sender_user_id ?? null,
  };
}

// open jobs joined with their most-recent attempt time, for a board/needs-attention view
async function loadOpenJobsWithAttempts(db: ReturnType<typeof getDb>) {
  return query<any>(db,
    `SELECT q.id, q.status, q.officer_id, q.deadline, q.priority, q.sort_order,
            q.defendant_name, q.recipient_name, q.recipient_address, q.case_number,
            (SELECT MAX(a.attempt_at) FROM serve_attempts a WHERE a.serve_queue_id = q.id) AS last_attempt_at
       FROM serve_queue q
      WHERE q.status NOT IN ('served','cancelled','failed')
      ORDER BY q.deadline IS NULL, q.deadline ASC, q.sort_order ASC, q.id ASC
      LIMIT 1000`);
}

sv.get('/assignments/board', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied }, 403);
  const db = getDb(c.env);
  const now = new Date().toISOString();
  const settings = await loadNudgeSettings(db);
  const jobs = await loadOpenJobsWithAttempts(db);
  const officers = await query<any>(db, "SELECT id, full_name FROM users WHERE role IN ('officer','supervisor','manager','admin') ORDER BY full_name LIMIT 200");

  const byOfficer: Record<string, any[]> = {};
  const unassigned: any[] = [];
  const counts: Record<string, number> = {};
  for (const j of jobs) {
    const jobForAttn: ServeJobForAttention = { id: j.id, status: j.status, officer_id: j.officer_id, deadline: j.deadline, last_attempt_at: j.last_attempt_at };
    j.attention = classifyServeJob(jobForAttn, now, settings);
    if (j.officer_id == null) { unassigned.push(j); }
    else { (byOfficer[j.officer_id] ??= []).push(j); counts[j.officer_id] = (counts[j.officer_id] ?? 0) + 1; }
  }
  return c.json({
    officers: officers.map((o) => ({
      id: o.id, name: o.full_name, count: counts[o.id] ?? 0,
      attention: (byOfficer[o.id] ?? []).reduce((acc: any, j: any) => { for (const cnd of j.attention) acc[cnd] = (acc[cnd] ?? 0) + 1; return acc; }, {}),
    })),
    unassigned, byOfficer,
  });
});
```

- [ ] **Step 2: Add the bulk assign endpoint**

```ts
sv.post('/assignments/assign', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied }, 403);
  const db = getDb(c.env);
  const b = await c.req.json<any>();
  const jobIds: number[] = Array.isArray(b.job_ids) ? b.job_ids.map((x: any) => parseInt(x, 10)).filter((n: number) => !isNaN(n)) : [];
  if (!jobIds.length) return c.json({ error: 'job_ids required' }, 400);
  const officerId = b.officer_id == null ? null : parseInt(b.officer_id, 10);
  const user = c.get('user') as { id: number } | undefined;

  const assigned: number[] = [];
  const skipped: number[] = [];
  for (const id of jobIds) {
    const job = await queryFirst<any>(db, 'SELECT id, status, officer_id FROM serve_queue WHERE id = ?', id);
    if (!job) { skipped.push(id); continue; }
    if (['served', 'cancelled', 'failed'].includes(job.status)) { skipped.push(id); continue; }
    const newStatus = officerId == null ? 'pending' : (job.status === 'pending' ? 'assigned' : job.status);
    await execute(db, "UPDATE serve_queue SET officer_id = ?, status = ?, updated_at = datetime('now','localtime') WHERE id = ?", officerId, newStatus, id);
    await execute(db,
      `INSERT INTO activity_log (user_id, action, entity_type, entity_id, details) VALUES (?, 'assign', 'serve_assignment', ?, ?)`,
      user?.id ?? null, id, JSON.stringify({ from_officer: job.officer_id, to_officer: officerId, reason: b.reason ?? null }));
    assigned.push(id);
  }
  return c.json({ success: true, assigned, skipped });
});
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck` — expect PASS.

- [ ] **Step 4: Commit**

```bash
git add src/routes/serve.ts
git commit -m "feat(serve): assignment board + bulk assign endpoints (audited)"
```

---

## Task 4: `/assignments/needs-attention` + `/assignments/settings`

**Files:** Modify `src/routes/serve.ts`

- [ ] **Step 1: Add the endpoints (after the assign endpoint)**

```ts
sv.get('/assignments/needs-attention', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied }, 403);
  const db = getDb(c.env);
  const now = new Date().toISOString();
  const settings = await loadNudgeSettings(db);
  const jobs = await loadOpenJobsWithAttempts(db);
  const flagged = jobs.map((j) => ({ ...j, attention: classifyServeJob({ id: j.id, status: j.status, officer_id: j.officer_id, deadline: j.deadline, last_attempt_at: j.last_attempt_at }, now, settings) }))
    .filter((j) => j.attention.length > 0);
  return c.json({ data: flagged });
});

sv.get('/assignments/settings', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied }, 403);
  const db = getDb(c.env);
  const row = await queryFirst(db, 'SELECT * FROM serve_nudge_settings WHERE id = 1');
  return c.json({ data: row ?? { id: 1, approaching_hours: 48, diligence_gap_days: 3, unassigned_window_hours: 72, renotify_hours: 24, notify_supervisor_email: 1, digest_sender_user_id: null } });
});

sv.put('/assignments/settings', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied }, 403);
  const db = getDb(c.env);
  const b = await c.req.json<any>();
  const user = c.get('user') as { id: number } | undefined;
  const cur = await queryFirst<any>(db, 'SELECT * FROM serve_nudge_settings WHERE id = 1') ?? {};
  await execute(db,
    `INSERT INTO serve_nudge_settings (id, approaching_hours, diligence_gap_days, unassigned_window_hours, renotify_hours, notify_supervisor_email, digest_sender_user_id, updated_by)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       approaching_hours = excluded.approaching_hours, diligence_gap_days = excluded.diligence_gap_days,
       unassigned_window_hours = excluded.unassigned_window_hours, renotify_hours = excluded.renotify_hours,
       notify_supervisor_email = excluded.notify_supervisor_email, digest_sender_user_id = excluded.digest_sender_user_id,
       updated_at = datetime('now','localtime'), updated_by = excluded.updated_by`,
    b.approaching_hours ?? cur.approaching_hours ?? 48,
    b.diligence_gap_days ?? cur.diligence_gap_days ?? 3,
    b.unassigned_window_hours ?? cur.unassigned_window_hours ?? 72,
    b.renotify_hours ?? cur.renotify_hours ?? 24,
    b.notify_supervisor_email !== undefined ? (b.notify_supervisor_email ? 1 : 0) : (cur.notify_supervisor_email ?? 1),
    b.digest_sender_user_id !== undefined ? b.digest_sender_user_id : (cur.digest_sender_user_id ?? null),
    user?.id ?? null);
  await execute(db, `INSERT INTO activity_log (user_id, action, entity_type, entity_id, details) VALUES (?, 'update', 'serve_nudge_settings', 1, ?)`, user?.id ?? null, JSON.stringify(b));
  const after = await queryFirst(db, 'SELECT * FROM serve_nudge_settings WHERE id = 1');
  return c.json({ data: after });
});
```

> `serve_nudge_settings.id` is the PRIMARY KEY → `ON CONFLICT(id)` is valid.

- [ ] **Step 2: Typecheck** — Run: `npm run typecheck` — expect PASS.

- [ ] **Step 3: Commit**

```bash
git add src/routes/serve.ts
git commit -m "feat(serve): needs-attention + nudge settings endpoints"
```

---

# Milestone 3 — Assign tab UI

## Task 5: `useServeAssignments` hook + pure helpers (TDD)

**Files:** Create `client/src/hooks/useServeAssignments.ts`, `client/src/pages/serve/serveAssignHelpers.ts`, `client/src/pages/serve/__tests__/serveAssignHelpers.test.ts`

- [ ] **Step 1: Write failing helper tests**

```ts
// client/src/pages/serve/__tests__/serveAssignHelpers.test.ts
import { describe, it, expect } from 'vitest';
import { toggleSelect, attentionSummary } from '../serveAssignHelpers';

describe('toggleSelect', () => {
  it('adds and removes an id immutably', () => {
    expect(toggleSelect([], 5)).toEqual([5]);
    expect(toggleSelect([5, 6], 5)).toEqual([6]);
    const a = [1]; const b = toggleSelect(a, 2);
    expect(a).toEqual([1]); expect(b).toEqual([1, 2]);
  });
});

describe('attentionSummary', () => {
  it('renders the highest-severity label + count', () => {
    expect(attentionSummary({ deadline_passed: 2, diligence_gap: 1 })).toBe('2 overdue');
    expect(attentionSummary({ unassigned_near_deadline: 3 })).toBe('3 unassigned');
    expect(attentionSummary({})).toBe('');
  });
});
```

- [ ] **Step 2: Run to verify failure** — `cd client && npx vitest run serveAssignHelpers` → FAIL.

- [ ] **Step 3: Implement the helpers**

```ts
// client/src/pages/serve/serveAssignHelpers.ts
export function toggleSelect(ids: number[], id: number): number[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
}

const SEVERITY: Array<[string, string]> = [
  ['deadline_passed', 'overdue'],
  ['unassigned_near_deadline', 'unassigned'],
  ['deadline_approaching', 'due soon'],
  ['diligence_gap', 'stalled'],
];

export function attentionSummary(counts: Record<string, number>): string {
  for (const [key, label] of SEVERITY) {
    if (counts[key]) return `${counts[key]} ${label}`;
  }
  return '';
}
```

- [ ] **Step 4: Run to verify pass** — `cd client && npx vitest run serveAssignHelpers` → PASS.

- [ ] **Step 5: Implement the hook**

```ts
// client/src/hooks/useServeAssignments.ts
import { useState, useCallback } from 'react';
import { apiFetch } from './useApi';

export interface BoardJob { id: number; status: string; officer_id: number | null; deadline: string | null; priority: string; defendant_name?: string; recipient_name?: string; recipient_address?: string; case_number?: string; attention: string[]; }
export interface BoardOfficer { id: number; name: string; count: number; attention: Record<string, number>; }
export interface Board { officers: BoardOfficer[]; unassigned: BoardJob[]; byOfficer: Record<string, BoardJob[]>; }

export function useServeAssignments() {
  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(false);
  const loadBoard = useCallback(async () => {
    setLoading(true);
    try { setBoard(await apiFetch<Board>('/process-server/assignments/board')); }
    catch { setBoard(null); }
    setLoading(false);
  }, []);
  const assign = useCallback(async (jobIds: number[], officerId: number | null, reason?: string) => {
    await apiFetch('/process-server/assignments/assign', { method: 'POST', body: JSON.stringify({ job_ids: jobIds, officer_id: officerId, reason }) });
  }, []);
  return { board, loading, loadBoard, assign };
}
```

> `/process-server` is the alias mount of the serve router (see `routesConfig.ts`); ServePage already uses `/process-server/*`. Match it.

- [ ] **Step 6: Typecheck** — `cd client && npx tsc --noEmit` → PASS.

- [ ] **Step 7: Commit**

```bash
git add client/src/hooks/useServeAssignments.ts client/src/pages/serve/serveAssignHelpers.ts client/src/pages/serve/__tests__/serveAssignHelpers.test.ts
git commit -m "feat(serve): assignment hook + pure helpers + tests"
```

---

## Task 6: `AssignTab.tsx` + wire into ServePage (supervisor-gated)

**Files:** Create `client/src/pages/serve/AssignTab.tsx`; Modify `client/src/pages/ServePage.tsx`

- [ ] **Step 1: Create the Assign tab (Roster + jobs split)**

```tsx
// client/src/pages/serve/AssignTab.tsx
import { useEffect, useState } from 'react';
import { Users } from 'lucide-react';
import { useServeAssignments, type BoardJob } from '../../hooks/useServeAssignments';
import { toggleSelect, attentionSummary } from './serveAssignHelpers';

export default function AssignTab() {
  const { board, loading, loadBoard, assign } = useServeAssignments();
  const [sel, setSel] = useState<number | 'unassigned' | null>('unassigned');
  const [picked, setPicked] = useState<number[]>([]);
  const [target, setTarget] = useState<number | ''>('');
  useEffect(() => { loadBoard(); }, [loadBoard]);

  const jobs: BoardJob[] = board ? (sel === 'unassigned' ? board.unassigned : (board.byOfficer[String(sel)] ?? [])) : [];

  const doAssign = async () => {
    if (!picked.length || target === '') return;
    await assign(picked, Number(target)); setPicked([]); await loadBoard();
  };
  const color = (j: BoardJob) => j.attention.includes('deadline_passed') ? '#e0533d' : j.attention.includes('deadline_approaching') ? '#d4a017' : '#ccc';

  if (loading || !board) return <div className="p-4 text-[11px] text-[#888]">Loading board…</div>;

  return (
    <div className="p-4 grid grid-cols-[200px_1fr] gap-4">
      <div>
        <div className="text-[9px] font-semibold text-[#888] uppercase mb-1">Officers</div>
        <button className={`w-full flex justify-between px-2 py-[3px] border-b border-[#141414] ${sel === 'unassigned' ? 'text-[#d4a017]' : 'text-[#ccc]'}`} onClick={() => { setSel('unassigned'); setPicked([]); }}>
          <span>Unassigned</span><span className="text-[#888]">{board.unassigned.length}</span>
        </button>
        {board.officers.map((o) => (
          <button key={o.id} className={`w-full flex justify-between px-2 py-[3px] border-b border-[#141414] ${sel === o.id ? 'text-[#d4a017]' : 'text-[#ccc]'}`} onClick={() => { setSel(o.id); setPicked([]); }}>
            <span>{o.name}</span>
            <span className="flex gap-1"><span className="text-[#888]">{o.count}</span>{attentionSummary(o.attention) && <span className="text-[#e0533d] text-[9px]">⚠</span>}</span>
          </button>
        ))}
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="text-[9px] font-semibold text-[#888] uppercase flex items-center gap-1"><Users size={12} /> {sel === 'unassigned' ? 'Unassigned pool' : board.officers.find((o) => o.id === sel)?.name + "'s run"}</div>
          {picked.length > 0 && (
            <div className="flex items-center gap-2 text-[11px]">
              <span className="text-[#888]">{picked.length} selected →</span>
              <select className="bg-[#0b0b0b] border border-[#232323] px-1" value={target} onChange={(e) => setTarget(e.target.value === '' ? '' : Number(e.target.value))}>
                <option value="">officer…</option>
                {board.officers.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
              <button className="px-2 py-[2px] bg-[#d4a017] text-black" onClick={doAssign}>Assign</button>
            </div>
          )}
        </div>
        <table className="w-full text-[11px]">
          <thead><tr className="text-left text-[9px] text-[#888] border-b border-[#232323]"><th className="py-[3px]">☐</th><th>Defendant</th><th>Address</th><th>Deadline</th><th>Flags</th></tr></thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id} className="border-b border-[#121212]" style={{ color: color(j) }}>
                <td className="py-[2px]"><input type="checkbox" checked={picked.includes(j.id)} onChange={() => setPicked((p) => toggleSelect(p, j.id))} /></td>
                <td>{j.defendant_name ?? j.recipient_name ?? j.id}</td>
                <td className="text-[#888]">{j.recipient_address ?? '—'}</td>
                <td>{j.deadline ?? '—'}</td>
                <td className="text-[9px] text-[#888]">{j.attention.join(', ')}</td>
              </tr>
            ))}
            {jobs.length === 0 && <tr><td colSpan={5} className="text-[#888] py-2">No jobs.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire into `ServePage.tsx` (supervisor-gated tab)**

READ `ServePage.tsx`. Edits:
(a) Add import near the top: `import AssignTab from './serve/AssignTab';`
(b) Change the TABS constant (line ~40) from `['Queue', 'Route', 'Map', 'Stats'] as const` to `['Queue', 'Route', 'Map', 'Stats', 'Assign'] as const`.
(c) The tab-button render maps over `TABS`. Gate `Assign` so only supervisors see it — wrap the per-tab render: skip when `tab === 'Assign'` and the current user role is not in `['admin','manager','supervisor']`. Find how the user/role is obtained in this file (e.g. an auth context/`user`); if none is imported, import the same auth hook other pages use (`useAuth` from the app's auth context) and read `user.role`. Filter the mapped tabs accordingly.
(d) The tab Icon ternary (line ~867): add `: tab === 'Assign' ? Users` (import `Users` from `lucide-react`) before the final fallback.
(e) Add a render branch after the `{activeTab === 'Stats' && (…)}` block: `{activeTab === 'Assign' && <AssignTab />}`.

- [ ] **Step 3: Typecheck + build** — `cd client && npx tsc --noEmit && npx vite build` → PASS.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/serve/AssignTab.tsx client/src/pages/ServePage.tsx
git commit -m "feat(serve): supervisor Assign tab (roster + jobs board)"
```

---

# Milestone 4 — Needs-Attention surfacing + officer My Run

## Task 7: Needs-Attention badge on the Assign tab

**Files:** Modify `client/src/pages/serve/AssignTab.tsx`

- [ ] **Step 1: Add a header summary line**

In `AssignTab`, compute and render an overall attention banner above the grid. Add after `if (loading || !board)`:

```tsx
  const totals = board.officers.reduce((acc, o) => { for (const k in o.attention) acc[k] = (acc[k] ?? 0) + o.attention[k]; return acc; }, {} as Record<string, number>);
  const unassignedNear = board.unassigned.filter((j) => j.attention.includes('unassigned_near_deadline')).length;
  if (unassignedNear) totals['unassigned_near_deadline'] = (totals['unassigned_near_deadline'] ?? 0) + unassignedNear;
  const overdue = totals['deadline_passed'] ?? 0;
```

Render a banner right inside the right-hand `<div>` (before the header flex), showing counts when present:

```tsx
        {(overdue > 0 || (totals['unassigned_near_deadline'] ?? 0) > 0) && (
          <div className="mb-2 px-2 py-1 border border-[#3a3a3a] text-[10px] text-[#e0533d] bg-[#1a0f0d]">
            ⚠ {overdue} overdue · {(totals['unassigned_near_deadline'] ?? 0)} unassigned near deadline · {(totals['deadline_approaching'] ?? 0)} due soon · {(totals['diligence_gap'] ?? 0)} stalled
          </div>
        )}
```

- [ ] **Step 2: Typecheck + build** — `cd client && npx tsc --noEmit && npx vite build` → PASS.

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/serve/AssignTab.tsx
git commit -m "feat(serve): needs-attention banner on Assign tab"
```

---

## Task 8: `MyRunTab.tsx` (officer focused run) + wire in

**Files:** Create `client/src/pages/serve/MyRunTab.tsx`; Modify `client/src/pages/ServePage.tsx`

- [ ] **Step 1: Create My Run**

```tsx
// client/src/pages/serve/MyRunTab.tsx
import { useEffect, useState } from 'react';
import { apiFetch } from '../../hooks/useApi';

interface RunJob { id: number; defendant_name?: string; recipient_name?: string; recipient_address?: string; deadline: string | null; priority: string; status: string; attempt_count?: number; }

export default function MyRunTab({ officerId }: { officerId: number }) {
  const [jobs, setJobs] = useState<RunJob[]>([]);
  const [loading, setLoading] = useState(false);
  const load = async () => {
    setLoading(true);
    try { setJobs(await apiFetch<RunJob[]>(`/process-server/priority-queue?officer_id=${officerId}`) ?? []); }
    catch { setJobs([]); }
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [officerId]);

  const open = jobs.filter((j) => !['served', 'cancelled', 'failed'].includes(j.status));
  return (
    <div className="p-4 space-y-2">
      <div className="text-[9px] font-semibold text-[#888] uppercase">My Run — {open.length} stop{open.length === 1 ? '' : 's'}</div>
      {loading ? <div className="text-[11px] text-[#888]">Loading…</div> : open.map((j, i) => (
        <div key={j.id} className="flex items-center gap-3 border border-[#232323] bg-[#0b0b0b] px-3 py-2 text-[11px]">
          <span className="text-[#d4a017] font-mono">{i + 1}</span>
          <div className="flex-1">
            <div className="text-[#ccc]">{j.defendant_name ?? j.recipient_name ?? `Job ${j.id}`} <span className="text-[#666]">{j.priority}</span></div>
            <div className="text-[#888] text-[10px]">{j.recipient_address ?? '—'} · due {j.deadline ?? '—'} · attempts {j.attempt_count ?? 0}</div>
          </div>
          {j.recipient_address && (
            <a className="text-[#d4a017]" href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(j.recipient_address)}`} target="_blank" rel="noreferrer">Navigate</a>
          )}
        </div>
      ))}
      {!loading && open.length === 0 && <div className="text-[11px] text-[#888]">Nothing assigned to you right now.</div>}
    </div>
  );
}
```

- [ ] **Step 2: Wire into ServePage**

(a) Import: `import MyRunTab from './serve/MyRunTab';`
(b) Add `'My Run'` to the TABS const: `['Queue', 'Route', 'Map', 'Stats', 'Assign', 'My Run'] as const`.
(c) Icon ternary: add `: tab === 'My Run' ? Route` (Route icon already imported) or reuse an existing icon import.
(d) Render branch: `{activeTab === 'My Run' && <MyRunTab officerId={Number(user.id)} />}` — use the same `user` reference the file already uses for `/routes/:date?officer_id=${Number(user.id)}` (it exists at serve.ts call sites; confirm the variable name in ServePage and match it).

- [ ] **Step 3: Typecheck + build** — `cd client && npx tsc --noEmit && npx vite build` → PASS.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/serve/MyRunTab.tsx client/src/pages/ServePage.tsx
git commit -m "feat(serve): officer My Run tab"
```

---

# Milestone 5 — Cron sweep + push

## Task 9: `serveNudgeSweep.ts` + wire into the 4h cron

**Files:** Create `src/utils/serveNudgeSweep.ts`; Modify `src/index.ts`

- [ ] **Step 1: Create the sweep**

```ts
// src/utils/serveNudgeSweep.ts
import type { Bindings } from '../types';
import { query, queryFirst, execute } from './db';
import { classifyServeJob, shouldNotify, type AttentionSettings } from './serveAttention';

const TITLES: Record<string, string> = {
  deadline_passed: 'OVERDUE serve', deadline_approaching: 'Serve deadline soon',
  diligence_gap: 'Serve attempt overdue (diligence)', unassigned_near_deadline: 'Unassigned serve near deadline',
};
const PRIORITY: Record<string, string> = { deadline_passed: 'high', unassigned_near_deadline: 'high', deadline_approaching: 'normal', diligence_gap: 'normal' };

export async function sweepServeNudges(db: Bindings['DB'], env: Bindings): Promise<number> {
  let settings: AttentionSettings & { renotify_hours: number; notify_supervisor_email: number; digest_sender_user_id: number | null };
  try {
    const s = await queryFirst<any>(db, 'SELECT * FROM serve_nudge_settings WHERE id = 1');
    settings = {
      approaching_hours: s?.approaching_hours ?? 48, diligence_gap_days: s?.diligence_gap_days ?? 3,
      unassigned_window_hours: s?.unassigned_window_hours ?? 72, renotify_hours: s?.renotify_hours ?? 24,
      notify_supervisor_email: s?.notify_supervisor_email ?? 1, digest_sender_user_id: s?.digest_sender_user_id ?? null,
    };
  } catch (err: any) { console.error('[serve-nudge] settings load failed:', err?.message); return 0; }

  let jobs: any[];
  try {
    jobs = await query<any>(db,
      `SELECT q.id, q.status, q.officer_id, q.deadline, q.defendant_name, q.recipient_name,
              (SELECT MAX(a.attempt_at) FROM serve_attempts a WHERE a.serve_queue_id = q.id) AS last_attempt_at
         FROM serve_queue q WHERE q.status NOT IN ('served','cancelled','failed') LIMIT 2000`);
  } catch (err: any) { console.error('[serve-nudge] jobs load failed:', err?.message); return 0; }

  const supervisors = await query<any>(db, "SELECT id, email FROM users WHERE role IN ('admin','manager','supervisor')").catch(() => []);
  const now = new Date().toISOString();
  const overdueForEmail: any[] = [];
  let notified = 0;

  for (const j of jobs) {
    const conditions = classifyServeJob({ id: j.id, status: j.status, officer_id: j.officer_id, deadline: j.deadline, last_attempt_at: j.last_attempt_at }, now, settings);
    for (const cond of conditions) {
      try {
        const nudge = await queryFirst<any>(db, 'SELECT last_notified_at FROM serve_nudges WHERE serve_queue_id = ? AND condition = ?', j.id, cond);
        if (!shouldNotify(nudge?.last_notified_at ?? null, now, settings.renotify_hours)) continue;
        const who = j.defendant_name ?? j.recipient_name ?? `Job ${j.id}`;
        const title = TITLES[cond]; const prio = PRIORITY[cond];
        const recipients = new Set<number>();
        if (j.officer_id != null) recipients.add(j.officer_id);
        for (const s of supervisors) recipients.add(s.id);
        for (const uid of recipients) {
          await execute(db,
            `INSERT INTO notifications (type, priority, title, message, entity_type, entity_id, user_id, is_read, created_at)
             VALUES ('serve_nudge', ?, ?, ?, 'serve_job', ?, ?, 0, datetime('now','localtime'))`,
            prio, title, `${title}: ${who}`, j.id, uid);
        }
        await execute(db,
          `INSERT INTO serve_nudges (serve_queue_id, condition, last_notified_at) VALUES (?, ?, datetime('now','localtime'))
           ON CONFLICT(serve_queue_id, condition) DO UPDATE SET last_notified_at = datetime('now','localtime')`,
          j.id, cond);
        notified++;
        if (cond === 'deadline_passed') overdueForEmail.push({ who, id: j.id, deadline: j.deadline });
      } catch (err: any) { console.error(`[serve-nudge] job ${j.id}/${cond} failed:`, err?.message); }
    }
  }

  // Supervisor email digest for overdue — enqueue into the durable outbox (drained by the email cron).
  if (settings.notify_supervisor_email && settings.digest_sender_user_id && overdueForEmail.length) {
    const to = supervisors.filter((s) => s.email).map((s) => ({ emailAddress: { address: s.email } }));
    if (to.length) {
      const rows = overdueForEmail.map((o) => `<li>${o.who} (job ${o.id}) — deadline ${o.deadline ?? 'n/a'}</li>`).join('');
      const payload = JSON.stringify({
        message: { subject: `RMPG: ${overdueForEmail.length} process-serve job(s) OVERDUE`, body: { contentType: 'HTML', content: `<p>The following process-serve jobs are past deadline:</p><ul>${rows}</ul>` }, toRecipients: to },
        saveToSentItems: true,
      });
      try { await execute(db, "INSERT INTO email_outbox (owner_user_id, payload, status) VALUES (?, ?, 'pending')", settings.digest_sender_user_id, payload); }
      catch (err: any) { console.error('[serve-nudge] email enqueue failed:', err?.message); }
    }
  }
  return notified;
}
```

- [ ] **Step 2: Wire into the 4-hourly cron in `src/index.ts`**

READ `scheduled()`. After the per-minute branch's `return;` (the code below it runs on the 4-hourly trigger), add alongside the other 4h `ctx.waitUntil(...)` scans:

```ts
    ctx.waitUntil(
      import('./utils/serveNudgeSweep')
        .then(({ sweepServeNudges }) => sweepServeNudges(env.DB, env))
        .then((n) => { if (n) console.log(`[serve-nudge] ${n} nudge(s) raised`); })
        .catch((err) => console.error('[serve-nudge] sweep failed:', err)),
    );
```

- [ ] **Step 3: Typecheck** — Run: `npm run typecheck` — expect PASS.

- [ ] **Step 4: Commit**

```bash
git add src/utils/serveNudgeSweep.ts src/index.ts
git commit -m "feat(serve): 4h cron nudge sweep — notifications + supervisor email digest (deduped)"
```

---

## Task 10: SW bump + full verification + PR

**Files:** Modify `client/public/sw.js`

- [ ] **Step 1: Bump the SW cache**

Read the current `const CACHE_NAME = 'rmpg-flex-vNNN';` line in `client/public/sw.js` and increment by 1.

- [ ] **Step 2: Full verification**

Run: `npm test && npm run typecheck`
Run: `cd client && npx vitest run && npx tsc --noEmit && npx vite build`
Expected: all PASS.

Manual DB sanity (local): apply the migration if not yet (`npx wrangler d1 execute rmpg-flex --local --file migrations/01NN_*.sql`), then:
`npx wrangler d1 execute rmpg-flex --local --command "SELECT * FROM serve_nudge_settings WHERE id=1;"` → one row.

- [ ] **Step 3: Commit + PR**

```bash
git add client/public/sw.js
git commit -m "chore(sw): bump cache for serve assignment console"
git push -u origin HEAD
gh pr create --title "Process-Service Phase 2: assignment console + officer run + overdue nudges" --body "Implements docs/superpowers/specs/2026-06-13-process-service-assignment-console-design.md

- Migration 01NN: serve_nudges (dedup) + serve_nudge_settings (editable thresholds)
- Pure classifyServeJob (4 conditions) + shouldNotify + tests
- /assignments board/assign/needs-attention/settings on the serve router (audited)
- ServePage: supervisor Assign tab (roster+jobs) + officer My Run tab
- 4h cron sweep → in-app notifications + supervisor email digest (deduped via serve_nudges)

⚠️ Migration number reconciled at build time (0104/0105 contention). After merge: apply to live D1 785de7ae + pragma_table_info verify.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

---

## Self-Review (completed during planning)

**Spec coverage** — every spec section maps to a task:
- §4 `serve_nudges`/`serve_nudge_settings` → Task 1; assignment-audit via `activity_log` → Task 3.
- §5 classifier (4 conditions, severity, thresholds) → Task 2; consumed by Tasks 3/4/9.
- §6 board/assign/needs-attention/settings endpoints → Tasks 3+4; cron sweep + dedup + email → Task 9.
- §7 Assign tab (roster+jobs) → Task 6; Needs-Attention surfacing → Task 7; officer My Run → Task 8; SW bump → Task 10.
- §9 edge cases: closed-job skip (Task 3 assign + Task 2 classifier), reassign audit (Task 3), dedup window (Tasks 2+9), null-deadline (Task 2), cron isolation (Task 9 try/catch + Task 9 wiring `.catch`).
- §10 tests: `classifyServeJob`/`shouldNotify` (Task 2), client helpers (Task 5), full run (Task 10).
- §11 milestones → the 5 milestone headers.

**Placeholder scan** — no TBD/TODO. The `01NN` migration number is a deliberate build-time decision (Task 1 Step 1 resolves it) given documented `0104` contention, not a placeholder. The two "confirm the variable name in ServePage and match it" steps (Task 6c role gate, Task 8d `user` ref) are deliberate: the file's auth/user accessor must be read in-place; the edit (filter `Assign` tab by `role ∈ {admin,manager,supervisor}`; pass `Number(user.id)` to MyRunTab) is specified.

**Type consistency** — `classifyServeJob(job, nowIso, settings)`, `ServeJobForAttention`, `AttentionSettings`, `AttentionCondition`, and `shouldNotify(lastNotifiedAt, nowIso, renotifyHours)` are identical across Tasks 2, 3, 4, 9. `useServeAssignments`/`Board`/`BoardJob`/`BoardOfficer` consistent across Tasks 5, 6, 7. Endpoint paths (`/process-server/assignments/board|assign|needs-attention|settings`, `/process-server/priority-queue`) match between hook (Task 5), MyRun (Task 8), and routes (Tasks 3/4). `serve_nudges` UNIQUE(serve_queue_id, condition) used identically in Task 1 DDL and Task 9 upsert.
