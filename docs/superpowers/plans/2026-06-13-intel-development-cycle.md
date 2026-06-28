# Intel v2 — Wave 1: Intelligence Development Cycle — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an intelligence-development cycle on top of the existing intel stack — raw reports graded with the Admiralty 5×5×5 model, sanitized into disseminable intelligence products, released to inbox/dossier/PDF/external-share, with a source/CI registry and 28 CFR Part 23-style retention.

**Architecture:** A new two-bodied `intel_reports` entity (restricted `raw_narrative` + disseminable `sanitized_narrative`) moves through an explicit, role-and-completeness-gated state machine. Pure decision logic lives in `src/utils/intelDevelopment.ts` (vitest-tested, like `intelMatch`); routes live in a new `src/routes/intel/development.ts` mounted by `intel.ts` to keep the 44KB file from growing. Dissemination reuses existing rails (`notifications`, `audit_log`, `intel_index`, dossier, jsPDF generators). A daily cron branch flags reports for retention review.

**Tech Stack:** Cloudflare Workers + Hono + D1 (native prepared statements via `src/utils/db.ts`), vitest (node env), React 18 + Vite + Tailwind (Spillman pure-black tokens), jsPDF (`registerArialFont`).

**Spec:** `docs/superpowers/specs/2026-06-13-intel-development-cycle-design.md`

---

## File Structure

**Create:**
- `migrations/0104_intel_development.sql` — 5 new tables (idempotent DDL).
- `src/utils/intelDevelopment.ts` — pure decision logic + `IntelReport` type.
- `tests/intelDevelopment.test.ts` — unit tests for the pure logic.
- `src/utils/intelRetention.ts` — db-touching daily retention sweep (`sweepRetention`).
- `src/routes/intel/development.ts` — reports + sources routers.
- `client/src/utils/intelProductPdf.ts` — sanitized product PDF (Arial-only).
- `client/src/pages/intel/IntelReportsPage.tsx` — report queue/list.
- `client/src/pages/intel/IntelReportDetailPage.tsx` — lifecycle UI.
- `client/src/pages/intel/IntelSourcesPage.tsx` — source/CI registry.

**Modify:**
- `src/routes/intel.ts` — mount the two new sub-routers; add "Linked Intelligence" to the dossier handler.
- `src/utils/intelIndexer.ts` — add `intel_report` to `INTEL_TYPES` + `rowsFor`.
- `src/index.ts` — add the retention sweep to the per-minute cron branch.
- `client/src/App.tsx` — register 3 new routes.
- `client/src/components/Sidebar.tsx` — add nav links.
- `client/public/sw.js` — bump `CACHE_NAME` v916 → v917.

---

## Task 1: Migration — `0104_intel_development.sql`

**Files:**
- Create: `migrations/0104_intel_development.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 0104: Intel v2 Wave 1 — Intelligence Development Cycle.
-- Raw reports → Admiralty 5×5×5 grade → sanitized products → dissemination,
-- plus a source/CI registry and 28 CFR Part 23 retention metadata.
-- Spec: docs/superpowers/specs/2026-06-13-intel-development-cycle-design.md
-- ⚠️ Apply directly to live D1 (785de7ae) after merge — deploy-time
-- migration apply is continue-on-error. Idempotent DDL.

CREATE TABLE IF NOT EXISTS intel_reports (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  report_number       TEXT,
  title               TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'submitted',
  source_id           INTEGER,
  source_type         TEXT,
  source_reliability  TEXT,
  info_credibility    INTEGER,
  handling_code       TEXT,
  raw_narrative       TEXT,
  sanitized_narrative TEXT,
  assessment          TEXT,
  threat_level        TEXT DEFAULT 'low',
  classification      TEXT,
  criminal_predicate  TEXT,
  submitted_by        INTEGER,
  submitted_at        TEXT DEFAULT (datetime('now')),
  evaluated_by        INTEGER,
  evaluated_at        TEXT,
  analyzed_by         INTEGER,
  analyzed_at         TEXT,
  disseminated_by     INTEGER,
  disseminated_at     TEXT,
  review_date         TEXT,
  retention_status    TEXT DEFAULT 'active',
  rejected_reason     TEXT,
  recalled_reason     TEXT,
  created_at          TEXT DEFAULT (datetime('now')),
  updated_at          TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_intel_reports_number ON intel_reports(report_number);
CREATE INDEX IF NOT EXISTS idx_intel_reports_status ON intel_reports(status);
CREATE INDEX IF NOT EXISTS idx_intel_reports_retention ON intel_reports(retention_status);
CREATE INDEX IF NOT EXISTS idx_intel_reports_threat ON intel_reports(threat_level);
CREATE INDEX IF NOT EXISTS idx_intel_reports_submitter ON intel_reports(submitted_by);
CREATE INDEX IF NOT EXISTS idx_intel_reports_source ON intel_reports(source_id);

CREATE TABLE IF NOT EXISTS intel_sources (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  source_code             TEXT,
  source_type             TEXT NOT NULL,
  display_label           TEXT,
  true_identity_person_id INTEGER,
  handler_user_id         INTEGER,
  reliability_grade       TEXT,
  status                  TEXT DEFAULT 'active',
  restricted              INTEGER DEFAULT 1,
  notes_restricted        TEXT,
  created_by              INTEGER,
  created_at              TEXT DEFAULT (datetime('now')),
  updated_at              TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_intel_sources_code ON intel_sources(source_code);
CREATE INDEX IF NOT EXISTS idx_intel_sources_type ON intel_sources(source_type);
CREATE INDEX IF NOT EXISTS idx_intel_sources_status ON intel_sources(status);

CREATE TABLE IF NOT EXISTS intel_source_reliability_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id  INTEGER NOT NULL,
  old_grade  TEXT,
  new_grade  TEXT,
  reason     TEXT,
  changed_by INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_intel_srl_source ON intel_source_reliability_log(source_id);

CREATE TABLE IF NOT EXISTS intel_report_links (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id   INTEGER NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id   INTEGER NOT NULL,
  role        TEXT,
  added_by    INTEGER,
  created_at  TEXT DEFAULT (datetime('now')),
  UNIQUE (report_id, entity_type, entity_id, role)
);
CREATE INDEX IF NOT EXISTS idx_intel_report_links_report ON intel_report_links(report_id);
CREATE INDEX IF NOT EXISTS idx_intel_report_links_entity ON intel_report_links(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS intel_dissemination_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id       INTEGER NOT NULL,
  recipient_type  TEXT,
  recipient_id    INTEGER,
  recipient_label TEXT,
  channel         TEXT,
  handling_ack    INTEGER DEFAULT 0,
  reason          TEXT,
  disseminated_by INTEGER,
  created_at      TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_intel_dissem_report ON intel_dissemination_log(report_id);
```

- [ ] **Step 2: Apply locally to verify the DDL parses**

Run: `npm run migrate:local`
Expected: completes without error; `0104_intel_development.sql` listed as applied.

- [ ] **Step 3: Verify tables exist locally**

Run: `npx wrangler d1 execute rmpg-flex --local --command "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'intel_%' ORDER BY name"`
Expected: includes `intel_reports`, `intel_sources`, `intel_source_reliability_log`, `intel_report_links`, `intel_dissemination_log`.

- [ ] **Step 4: Commit**

```bash
git add migrations/0104_intel_development.sql
git commit -m "feat(intel): migration 0104 — development-cycle tables"
```

---

## Task 2: Pure logic — deterministic helpers (TDD)

**Files:**
- Create: `src/utils/intelDevelopment.ts`
- Test: `tests/intelDevelopment.test.ts`

This task adds the `IntelReport` type and the four fully-deterministic helpers: `gradeLabel`, `nextReportNumber`, `computeReviewDate`, `retentionStatus`. (The two user-contribution functions come in Task 3.)

- [ ] **Step 1: Write the failing test**

Create `tests/intelDevelopment.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  gradeLabel,
  nextReportNumber,
  computeReviewDate,
  retentionStatus,
  type IntelReport,
} from '../src/utils/intelDevelopment';

const base: IntelReport = {
  id: 1, report_number: 'INT-2026-0001', title: 't', status: 'submitted',
  source_reliability: null, info_credibility: null, handling_code: null,
  raw_narrative: null, sanitized_narrative: null, assessment: null,
  criminal_predicate: null, rejected_reason: null, recalled_reason: null,
  review_date: null, retention_status: 'active', disseminated_at: null,
};

describe('gradeLabel', () => {
  it('renders the Admiralty pair with words', () => {
    expect(gradeLabel('B', 2)).toBe('B2 — Usually reliable / Probably true');
  });
  it('handles cannot-be-judged grades', () => {
    expect(gradeLabel('F', 6)).toBe('F6 — Cannot be judged / Cannot be judged');
  });
  it('returns UNGRADED when missing', () => {
    expect(gradeLabel(null, null)).toBe('UNGRADED');
  });
});

describe('nextReportNumber', () => {
  it('zero-pads to 4 digits', () => {
    expect(nextReportNumber(2026, 1)).toBe('INT-2026-0001');
    expect(nextReportNumber(2026, 42)).toBe('INT-2026-0042');
  });
});

describe('computeReviewDate', () => {
  it('adds 5 years for a normal handling code', () => {
    expect(computeReviewDate('2026-06-13T00:00:00Z', 'H1')).toBe('2031-06-13');
  });
  it('adds 1 year for no-further-dissemination (H5)', () => {
    expect(computeReviewDate('2026-06-13T00:00:00Z', 'H5')).toBe('2027-06-13');
  });
});

describe('retentionStatus', () => {
  it('flags due_review once review_date passes', () => {
    const r = { ...base, status: 'disseminated', review_date: '2026-01-01', retention_status: 'active' };
    expect(retentionStatus(r, '2026-06-13T00:00:00Z')).toBe('due_review');
  });
  it('stays active before review_date', () => {
    const r = { ...base, status: 'disseminated', review_date: '2031-01-01', retention_status: 'active' };
    expect(retentionStatus(r, '2026-06-13T00:00:00Z')).toBe('active');
  });
  it('never re-flags an already-purged report', () => {
    const r = { ...base, review_date: '2000-01-01', retention_status: 'purged' };
    expect(retentionStatus(r, '2026-06-13T00:00:00Z')).toBe('purged');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/intelDevelopment.test.ts`
Expected: FAIL — cannot resolve `../src/utils/intelDevelopment`.

- [ ] **Step 3: Write the implementation**

Create `src/utils/intelDevelopment.ts`:

```ts
// ============================================================
// RMPG Flex — Intel Development Cycle: pure decision logic
// ============================================================
// Dependency-free helpers for the intelligence-development state
// machine, Admiralty 5×5×5 grading, retention, and redaction.
// Mirrors the intelMatch / intelDossier pattern: no DB, fully
// unit-tested (tests/intelDevelopment.test.ts).
// Spec: docs/superpowers/specs/2026-06-13-intel-development-cycle-design.md
// ============================================================

export type IntelStatus =
  | 'submitted' | 'under_evaluation' | 'graded' | 'analyzed'
  | 'disseminated' | 'recalled' | 'archived' | 'purged' | 'rejected';

export interface IntelReport {
  id: number;
  report_number: string | null;
  title: string;
  status: IntelStatus | string;
  source_reliability: string | null;
  info_credibility: number | null;
  handling_code: string | null;
  raw_narrative: string | null;
  sanitized_narrative: string | null;
  assessment: string | null;
  criminal_predicate: string | null;
  rejected_reason: string | null;
  recalled_reason: string | null;
  review_date: string | null;
  retention_status: string | null;
  disseminated_at: string | null;
  [k: string]: unknown;
}

const RELIABILITY: Record<string, string> = {
  A: 'Reliable', B: 'Usually reliable', C: 'Fairly reliable',
  D: 'Not usually reliable', E: 'Unreliable', F: 'Cannot be judged',
};
const CREDIBILITY: Record<number, string> = {
  1: 'Confirmed', 2: 'Probably true', 3: 'Possibly true',
  4: 'Doubtful', 5: 'Improbable', 6: 'Cannot be judged',
};

/** 'B2 — Usually reliable / Probably true' (or 'UNGRADED'). */
export function gradeLabel(reliability: string | null, credibility: number | null): string {
  if (!reliability || !credibility) return 'UNGRADED';
  const rel = RELIABILITY[reliability] ?? '?';
  const cred = CREDIBILITY[credibility] ?? '?';
  return `${reliability}${credibility} — ${rel} / ${cred}`;
}

/** 'INT-2026-0042' */
export function nextReportNumber(year: number, seq: number): string {
  return `INT-${year}-${String(seq).padStart(4, '0')}`;
}

/** Retention review date (YYYY-MM-DD). 28 CFR default +5y; sensitive codes sooner. */
export function computeReviewDate(disseminatedAtISO: string, handlingCode: string): string {
  const d = new Date(disseminatedAtISO);
  const years = handlingCode === 'H5' ? 1 : handlingCode === 'H4' ? 2 : 5;
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString().slice(0, 10);
}

/** Cron decision: should this report be flagged for review? Idempotent. */
export function retentionStatus(report: IntelReport, nowISO: string): string {
  const current = report.retention_status || 'active';
  if (current !== 'active') return current; // never re-touch flagged/purged
  if (!report.review_date) return 'active';
  if (['rejected', 'purged'].includes(String(report.status))) return current;
  return report.review_date <= nowISO.slice(0, 10) ? 'due_review' : 'active';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/intelDevelopment.test.ts`
Expected: PASS (all `gradeLabel`/`nextReportNumber`/`computeReviewDate`/`retentionStatus` cases).

- [ ] **Step 5: Commit**

```bash
git add src/utils/intelDevelopment.ts tests/intelDevelopment.test.ts
git commit -m "feat(intel): development-cycle pure helpers (grade/number/retention)"
```

---

## Task 3: Pure logic — state machine + confidence (TDD) — ⭐ USER-CONTRIBUTION POINTS

**Files:**
- Modify: `src/utils/intelDevelopment.ts`
- Modify: `tests/intelDevelopment.test.ts`

`canTransition` and `confidenceScore` are the two designated user-contribution points (learning mode). The tests below define the exact contract. When executing this task, **offer the user the chance to write the two function bodies**; the reference implementations here are the fallback and define the passing behavior.

- [ ] **Step 1: Add the failing tests**

Append to `tests/intelDevelopment.test.ts`:

```ts
import { canTransition, confidenceScore } from '../src/utils/intelDevelopment';

const graded: IntelReport = {
  ...base, status: 'graded',
  source_reliability: 'B', info_credibility: 2, handling_code: 'H1',
  sanitized_narrative: 'clean', assessment: 'significant', criminal_predicate: 'theft pattern',
};

describe('canTransition', () => {
  it('lets a supervisor claim a submitted report', () => {
    expect(canTransition({ ...base, status: 'submitted' }, 'under_evaluation', 'supervisor').ok).toBe(true);
  });
  it('blocks an officer from grading', () => {
    const r = { ...base, status: 'under_evaluation', source_reliability: 'A', info_credibility: 1, handling_code: 'H1' };
    expect(canTransition(r, 'graded', 'officer').ok).toBe(false);
  });
  it('requires a full grade before graded', () => {
    const r = { ...base, status: 'under_evaluation', source_reliability: 'A', info_credibility: null, handling_code: 'H1' };
    const res = canTransition(r, 'graded', 'supervisor');
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/grade|credibility/i);
  });
  it('allows grading a fully-graded report', () => {
    const r = { ...base, status: 'under_evaluation', source_reliability: 'A', info_credibility: 1, handling_code: 'H1' };
    expect(canTransition(r, 'graded', 'supervisor').ok).toBe(true);
  });
  it('requires sanitized narrative + assessment + predicate before analyzed', () => {
    const r = { ...graded, sanitized_narrative: null };
    expect(canTransition(r, 'analyzed', 'supervisor').ok).toBe(false);
  });
  it('allows dissemination of an analyzed, fully-prepared report', () => {
    expect(canTransition({ ...graded, status: 'analyzed' }, 'disseminated', 'supervisor').ok).toBe(true);
  });
  it('requires a reason to reject', () => {
    expect(canTransition({ ...base, status: 'submitted' }, 'rejected', 'supervisor').ok).toBe(false);
    expect(canTransition({ ...base, status: 'submitted', rejected_reason: 'no predicate' }, 'rejected', 'supervisor').ok).toBe(true);
  });
  it('requires a reason to recall', () => {
    expect(canTransition({ ...graded, status: 'disseminated' }, 'recalled', 'supervisor').ok).toBe(false);
    expect(canTransition({ ...graded, status: 'disseminated', recalled_reason: 'error' }, 'recalled', 'supervisor').ok).toBe(true);
  });
  it('rejects illegal jumps', () => {
    expect(canTransition({ ...base, status: 'submitted' }, 'disseminated', 'supervisor').ok).toBe(false);
  });
});

describe('confidenceScore', () => {
  it('is highest for A1', () => {
    expect(confidenceScore('A', 1)).toBe(100);
  });
  it('is lowest for E5', () => {
    expect(confidenceScore('E', 5)).toBeLessThanOrEqual(20);
  });
  it('treats cannot-be-judged (F/6) as neutral, not worst', () => {
    expect(confidenceScore('F', 6)).toBeGreaterThan(confidenceScore('E', 5));
  });
  it('returns 0 when ungraded', () => {
    expect(confidenceScore(null, null)).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/intelDevelopment.test.ts`
Expected: FAIL — `canTransition`/`confidenceScore` not exported.

- [ ] **Step 3: Implement (⭐ user writes these two bodies; reference impl below)**

Append to `src/utils/intelDevelopment.ts`:

```ts
const SUPERVISOR_ROLES = new Set(['admin', 'manager', 'supervisor']);

/**
 * ⭐ USER-CONTRIBUTION POINT — the completeness rules of the cycle.
 * Returns whether `report` may move to `toStatus` for a user with `role`.
 * Reference implementation of the §2 transition table:
 */
export function canTransition(
  report: IntelReport,
  toStatus: IntelStatus,
  role: string,
): { ok: boolean; reason?: string } {
  const from = report.status;
  const sup = SUPERVISOR_ROLES.has(role);
  const key = `${from}->${toStatus}`;
  const supOnly = (): { ok: boolean; reason?: string } =>
    sup ? { ok: true } : { ok: false, reason: 'supervisor+ required' };

  switch (key) {
    case 'submitted->under_evaluation':
      return supOnly();
    case 'submitted->graded':
    case 'under_evaluation->graded':
      if (!sup) return { ok: false, reason: 'supervisor+ required' };
      return report.source_reliability && report.info_credibility && report.handling_code
        ? { ok: true }
        : { ok: false, reason: 'grade requires reliability + credibility + handling_code' };
    case 'submitted->rejected':
    case 'under_evaluation->rejected':
    case 'graded->rejected':
      if (!sup) return { ok: false, reason: 'supervisor+ required' };
      return report.rejected_reason ? { ok: true } : { ok: false, reason: 'rejected_reason required' };
    case 'graded->analyzed':
      if (!sup) return { ok: false, reason: 'supervisor+ required' };
      return report.sanitized_narrative && report.assessment && report.criminal_predicate
        ? { ok: true }
        : { ok: false, reason: 'analysis requires sanitized_narrative + assessment + criminal_predicate' };
    case 'analyzed->disseminated':
      if (!sup) return { ok: false, reason: 'supervisor+ required' };
      return report.source_reliability && report.handling_code &&
        report.sanitized_narrative && report.criminal_predicate
        ? { ok: true }
        : { ok: false, reason: 'dissemination requires a graded, sanitized product with a predicate' };
    case 'disseminated->recalled':
      if (!sup) return { ok: false, reason: 'supervisor+ required' };
      return report.recalled_reason ? { ok: true } : { ok: false, reason: 'recalled_reason required' };
    case 'disseminated->archived':
    case 'recalled->archived':
    case 'archived->purged':
      return supOnly();
    default:
      return { ok: false, reason: `illegal transition ${from} → ${toStatus}` };
  }
}

const REL_WEIGHT: Record<string, number> = { A: 1.0, B: 0.8, C: 0.6, D: 0.4, E: 0.2, F: 0.5 };
const CRED_WEIGHT: Record<number, number> = { 1: 1.0, 2: 0.8, 3: 0.6, 4: 0.4, 5: 0.2, 6: 0.5 };

/**
 * ⭐ USER-CONTRIBUTION POINT — how source reliability (A–F) and information
 * credibility (1–6) combine into a single 0–100 confidence. "Cannot be judged"
 * (F / 6) is treated as neutral (0.5), not worst. Reference implementation:
 */
export function confidenceScore(reliability: string | null, credibility: number | null): number {
  if (!reliability || !credibility) return 0;
  const r = REL_WEIGHT[reliability] ?? 0.5;
  const c = CRED_WEIGHT[credibility] ?? 0.5;
  return Math.round(r * c * 100);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/intelDevelopment.test.ts`
Expected: PASS (all `canTransition` + `confidenceScore` cases).

- [ ] **Step 5: Commit**

```bash
git add src/utils/intelDevelopment.ts tests/intelDevelopment.test.ts
git commit -m "feat(intel): state-machine guard + confidence score"
```

---

## Task 4: Worker routes — reports submit/list/get + report-number helper

**Files:**
- Create: `src/routes/intel/development.ts`
- Modify: `src/routes/intel.ts` (mount the sub-routers)

- [ ] **Step 1: Create the router with submit/list/get**

Create `src/routes/intel/development.ts`:

```ts
// ============================================================
// RMPG Flex — Intel Development Cycle routes (Wave 1)
// ============================================================
// Mounted by intel.ts at /api/intel/reports and /api/intel/sources.
// Keeps the 44KB intel.ts from growing. Auth: /api/intel is already
// auth:'required' in routesConfig.ts; handlers add role gates.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../../types';
import { getDb, query, queryFirst, execute } from '../../utils/db';
import { requireRole } from '../../middleware/auth';
import {
  canTransition, nextReportNumber, computeReviewDate, gradeLabel, confidenceScore,
  type IntelReport, type IntelStatus,
} from '../../utils/intelDevelopment';

const operational = requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher');
const supervisorPlus = requireRole('admin', 'manager', 'supervisor');

const isSup = (c: any) =>
  ['admin', 'manager', 'supervisor'].includes(String((c.get('user') as { role?: string })?.role || ''));

/** Strip the restricted body + source identity for unauthorized viewers. */
function redact(r: any, sup: boolean, ownerId: number, viewerId: number): any {
  if (sup || r.submitted_by === viewerId) return r;
  const { raw_narrative, source_id, source_type, ...safe } = r;
  return { ...safe, raw_narrative: null, _redacted: true };
}

export const intelReports = new Hono<Env>();

// POST /api/intel/reports — submit a raw report
intelReports.post('/', operational, async (c) => {
  const db = getDb(c.env);
  const userId = c.get('userId') as number;
  const b = await c.req.json().catch(() => ({}));
  if (!b.title || !String(b.title).trim()) return c.json({ error: 'title required' }, 400);
  const year = new Date().getUTCFullYear();
  const cnt = await queryFirst<{ n: number }>(db,
    `SELECT COUNT(*) AS n FROM intel_reports WHERE report_number LIKE ?`, `INT-${year}-%`);
  const report_number = nextReportNumber(year, (cnt?.n || 0) + 1);
  const res = await execute(db,
    `INSERT INTO intel_reports
       (report_number, title, status, source_id, source_type, raw_narrative,
        threat_level, classification, submitted_by)
     VALUES (?, ?, 'submitted', ?, ?, ?, ?, ?, ?)`,
    report_number, String(b.title).trim(), b.source_id || null, b.source_type || null,
    b.raw_narrative || null, b.threat_level || 'low', b.classification || null, userId);
  return c.json({ success: true, id: res.meta?.last_row_id, report_number });
});

// GET /api/intel/reports?status=&threat=&mine=1&retention=
intelReports.get('/', operational, async (c) => {
  const db = getDb(c.env);
  const userId = c.get('userId') as number;
  const sup = isSup(c);
  const where: string[] = [];
  const args: unknown[] = [];
  const status = c.req.query('status');
  if (status) { where.push('status = ?'); args.push(status); }
  const threat = c.req.query('threat');
  if (threat) { where.push('threat_level = ?'); args.push(threat); }
  const retention = c.req.query('retention');
  if (retention) { where.push('retention_status = ?'); args.push(retention); }
  // Officers see disseminated products + their own drafts; supervisors see all.
  if (!sup) { where.push("(status = 'disseminated' OR submitted_by = ?)"); args.push(userId); }
  if (c.req.query('mine')) { where.push('submitted_by = ?'); args.push(userId); }
  const sql = `SELECT * FROM intel_reports ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY created_at DESC LIMIT 200`;
  const rows = await query<any>(db, sql, ...args);
  return c.json(rows.map((r) => ({
    ...redact(r, sup, r.submitted_by, userId),
    grade_label: gradeLabel(r.source_reliability, r.info_credibility),
    confidence: confidenceScore(r.source_reliability, r.info_credibility),
  })));
});

// GET /api/intel/reports/:id
intelReports.get('/:id', operational, async (c) => {
  const db = getDb(c.env);
  const userId = c.get('userId') as number;
  const sup = isSup(c);
  const id = Number(c.req.param('id'));
  const r = await queryFirst<any>(db, 'SELECT * FROM intel_reports WHERE id = ?', id);
  if (!r) return c.json({ error: 'not found' }, 404);
  if (!sup && r.status !== 'disseminated' && r.submitted_by !== userId)
    return c.json({ error: 'forbidden' }, 403);
  const links = await query<any>(db,
    'SELECT * FROM intel_report_links WHERE report_id = ? ORDER BY id', id);
  const dissem = sup
    ? await query<any>(db, 'SELECT * FROM intel_dissemination_log WHERE report_id = ? ORDER BY id DESC', id)
    : [];
  return c.json({
    ...redact(r, sup, r.submitted_by, userId),
    grade_label: gradeLabel(r.source_reliability, r.info_credibility),
    confidence: confidenceScore(r.source_reliability, r.info_credibility),
    links, dissemination: dissem,
  });
});

export const intelSources = new Hono<Env>();
```

- [ ] **Step 2: Mount the sub-routers in `intel.ts`**

In `src/routes/intel.ts`, add to the imports block (after line 25, near the other util imports):

```ts
import { intelReports, intelSources } from './intel/development';
```

Then immediately before `export default intel;` (end of file), add:

```ts
intel.route('/reports', intelReports);
intel.route('/sources', intelSources);
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no TS errors).

- [ ] **Step 4: Commit**

```bash
git add src/routes/intel/development.ts src/routes/intel.ts
git commit -m "feat(intel): reports submit/list/get + sub-router mount"
```

---

## Task 5: Worker routes — lifecycle transitions (evaluate/analyze/disseminate/recall/reject)

**Files:**
- Modify: `src/routes/intel/development.ts`

Each transition loads the row, merges the incoming payload, validates with `canTransition`, then writes fields + new status + the actor/timestamp + an `audit_log` row. Dissemination additionally writes `notifications` + `intel_dissemination_log`.

- [ ] **Step 1: Add the lifecycle handlers**

Insert into `src/routes/intel/development.ts` after the `GET /:id` handler (before `export const intelSources`):

```ts
async function audit(db: any, userId: number, action: string, id: number, details: unknown) {
  try {
    await execute(db,
      `INSERT INTO audit_log (user_id, action, entity_type, entity_id, details, created_at)
       VALUES (?, ?, 'intel_report', ?, ?, datetime('now'))`,
      userId, action, String(id), JSON.stringify(details));
  } catch (e: any) { console.error('[intel-dev] audit failed:', e?.message); }
}

async function loadReport(db: any, id: number): Promise<IntelReport | null> {
  return await queryFirst<IntelReport>(db, 'SELECT * FROM intel_reports WHERE id = ?', id);
}

// POST /:id/evaluate { source_reliability, info_credibility, handling_code }
intelReports.post('/:id/evaluate', supervisorPlus, async (c) => {
  const db = getDb(c.env); const userId = c.get('userId') as number;
  const id = Number(c.req.param('id'));
  const b = await c.req.json().catch(() => ({}));
  const r = await loadReport(db, id);
  if (!r) return c.json({ error: 'not found' }, 404);
  const merged = { ...r, source_reliability: b.source_reliability, info_credibility: b.info_credibility, handling_code: b.handling_code } as IntelReport;
  const gate = canTransition(merged, 'graded', String((c.get('user') as any)?.role || ''));
  if (!gate.ok) return c.json({ error: gate.reason }, 422);
  await execute(db,
    `UPDATE intel_reports SET source_reliability=?, info_credibility=?, handling_code=?,
       status='graded', evaluated_by=?, evaluated_at=datetime('now'), updated_at=datetime('now') WHERE id=?`,
    b.source_reliability, b.info_credibility, b.handling_code, userId, id);
  await audit(db, userId, 'evaluate', id, { grade: `${b.source_reliability}${b.info_credibility}`, handling_code: b.handling_code });
  return c.json({ success: true });
});

// POST /:id/analyze { sanitized_narrative, assessment, criminal_predicate, threat_level? }
intelReports.post('/:id/analyze', supervisorPlus, async (c) => {
  const db = getDb(c.env); const userId = c.get('userId') as number;
  const id = Number(c.req.param('id'));
  const b = await c.req.json().catch(() => ({}));
  const r = await loadReport(db, id);
  if (!r) return c.json({ error: 'not found' }, 404);
  const merged = { ...r, sanitized_narrative: b.sanitized_narrative, assessment: b.assessment, criminal_predicate: b.criminal_predicate } as IntelReport;
  const gate = canTransition(merged, 'analyzed', String((c.get('user') as any)?.role || ''));
  if (!gate.ok) return c.json({ error: gate.reason }, 422);
  await execute(db,
    `UPDATE intel_reports SET sanitized_narrative=?, assessment=?, criminal_predicate=?,
       threat_level=COALESCE(?, threat_level), status='analyzed',
       analyzed_by=?, analyzed_at=datetime('now'), updated_at=datetime('now') WHERE id=?`,
    b.sanitized_narrative, b.assessment, b.criminal_predicate, b.threat_level || null, userId, id);
  await audit(db, userId, 'analyze', id, { threat_level: b.threat_level });
  return c.json({ success: true });
});

// POST /:id/disseminate { recipient_user_ids?: number[] }
intelReports.post('/:id/disseminate', supervisorPlus, async (c) => {
  const db = getDb(c.env); const userId = c.get('userId') as number;
  const id = Number(c.req.param('id'));
  const b = await c.req.json().catch(() => ({}));
  const r = await loadReport(db, id);
  if (!r) return c.json({ error: 'not found' }, 404);
  const gate = canTransition(r, 'disseminated', String((c.get('user') as any)?.role || ''));
  if (!gate.ok) return c.json({ error: gate.reason }, 422);
  const reviewDate = computeReviewDate(new Date().toISOString(), r.handling_code || 'H1');
  await execute(db,
    `UPDATE intel_reports SET status='disseminated', disseminated_by=?, disseminated_at=datetime('now'),
       review_date=?, retention_status='active', updated_at=datetime('now') WHERE id=?`,
    userId, reviewDate, id);
  // Inbox: notify chosen recipients (or all supervisors+ by default).
  const recipients: number[] = Array.isArray(b.recipient_user_ids) && b.recipient_user_ids.length
    ? b.recipient_user_ids
    : (await query<any>(db, "SELECT id FROM users WHERE role IN ('admin','manager','supervisor') AND status='active'")).map((u) => u.id);
  const priority = r.threat_level === 'critical' || r.threat_level === 'high' ? 'high' : 'normal';
  for (const rid of recipients) {
    try {
      await execute(db,
        `INSERT INTO notifications (user_id, type, priority, title, message, entity_type, entity_id, created_at)
         VALUES (?, 'intel_product', ?, ?, ?, 'intel_report', ?, datetime('now'))`,
        rid, priority, `INTEL: ${r.title}`, r.sanitized_narrative || '', id);
      await execute(db,
        `INSERT INTO intel_dissemination_log (report_id, recipient_type, recipient_id, channel, disseminated_by)
         VALUES (?, 'user', ?, 'inbox', ?)`, id, rid, userId);
    } catch (e: any) { console.error('[intel-dev] notify failed:', e?.message); }
  }
  // Index the SANITIZED product into FTS so it appears in federated search.
  try {
    await execute(db,
      `INSERT INTO intel_index (entity_type, entity_id, label, body, identifiers)
       VALUES ('intel_report', ?, ?, ?, ?)`,
      id, `${r.report_number} ${r.title}`, r.sanitized_narrative || '', r.report_number || '');
  } catch (e: any) { console.error('[intel-dev] fts index failed:', e?.message); }
  await audit(db, userId, 'disseminate', id, { recipients: recipients.length, review_date: reviewDate });
  return c.json({ success: true, recipients: recipients.length, review_date: reviewDate });
});

// POST /:id/recall { reason }
intelReports.post('/:id/recall', supervisorPlus, async (c) => {
  const db = getDb(c.env); const userId = c.get('userId') as number;
  const id = Number(c.req.param('id'));
  const b = await c.req.json().catch(() => ({}));
  const r = await loadReport(db, id);
  if (!r) return c.json({ error: 'not found' }, 404);
  const merged = { ...r, recalled_reason: b.reason } as IntelReport;
  const gate = canTransition(merged, 'recalled', String((c.get('user') as any)?.role || ''));
  if (!gate.ok) return c.json({ error: gate.reason }, 422);
  await execute(db,
    `UPDATE intel_reports SET status='recalled', recalled_reason=?, updated_at=datetime('now') WHERE id=?`,
    b.reason, id);
  try { await execute(db, "DELETE FROM intel_index WHERE entity_type='intel_report' AND entity_id=?", id); } catch { /* fts optional */ }
  await audit(db, userId, 'recall', id, { reason: b.reason });
  return c.json({ success: true });
});

// POST /:id/reject { reason }
intelReports.post('/:id/reject', supervisorPlus, async (c) => {
  const db = getDb(c.env); const userId = c.get('userId') as number;
  const id = Number(c.req.param('id'));
  const b = await c.req.json().catch(() => ({}));
  const r = await loadReport(db, id);
  if (!r) return c.json({ error: 'not found' }, 404);
  const merged = { ...r, rejected_reason: b.reason } as IntelReport;
  const gate = canTransition(merged, 'rejected', String((c.get('user') as any)?.role || ''));
  if (!gate.ok) return c.json({ error: gate.reason }, 422);
  await execute(db,
    `UPDATE intel_reports SET status='rejected', rejected_reason=?, updated_at=datetime('now') WHERE id=?`,
    b.reason, id);
  await audit(db, userId, 'reject', id, { reason: b.reason });
  return c.json({ success: true });
});
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/routes/intel/development.ts
git commit -m "feat(intel): report lifecycle transitions + dissemination rails"
```

---

## Task 6: Worker routes — entity links, external share, sources registry

**Files:**
- Modify: `src/routes/intel/development.ts`

- [ ] **Step 1: Add link + share handlers (reports router)**

Insert after the `reject` handler:

```ts
// POST /:id/links { entity_type, entity_id, role }
intelReports.post('/:id/links', supervisorPlus, async (c) => {
  const db = getDb(c.env); const userId = c.get('userId') as number;
  const id = Number(c.req.param('id'));
  const b = await c.req.json().catch(() => ({}));
  if (!b.entity_type || !b.entity_id) return c.json({ error: 'entity_type + entity_id required' }, 400);
  await execute(db,
    `INSERT OR IGNORE INTO intel_report_links (report_id, entity_type, entity_id, role, added_by)
     VALUES (?, ?, ?, ?, ?)`,
    id, b.entity_type, Number(b.entity_id), b.role || 'mentioned', userId);
  return c.json({ success: true });
});

// DELETE /:id/links/:linkId
intelReports.delete('/:id/links/:linkId', supervisorPlus, async (c) => {
  const db = getDb(c.env);
  const r = await execute(db, 'DELETE FROM intel_report_links WHERE id = ? AND report_id = ?',
    Number(c.req.param('linkId')), Number(c.req.param('id')));
  return r.meta?.changes ? c.json({ success: true }) : c.json({ error: 'not found' }, 404);
});

// POST /:id/share { recipient_label, reason, recipient_type } — external/client share
intelReports.post('/:id/share', supervisorPlus, async (c) => {
  const db = getDb(c.env); const userId = c.get('userId') as number;
  const id = Number(c.req.param('id'));
  const b = await c.req.json().catch(() => ({}));
  const r = await loadReport(db, id);
  if (!r) return c.json({ error: 'not found' }, 404);
  if (r.status !== 'disseminated') return c.json({ error: 'only disseminated products can be shared' }, 422);
  if (!['H2', 'H3', 'H4'].includes(String(r.handling_code)))
    return c.json({ error: `handling code ${r.handling_code} does not permit external sharing` }, 422);
  if (!b.recipient_label) return c.json({ error: 'recipient_label required' }, 400);
  await execute(db,
    `INSERT INTO intel_dissemination_log (report_id, recipient_type, recipient_label, channel, reason, disseminated_by)
     VALUES (?, ?, ?, 'external_export', ?, ?)`,
    id, b.recipient_type || 'agency', b.recipient_label, b.reason || null, userId);
  await audit(db, userId, 'share_external', id, { recipient: b.recipient_label, handling_code: r.handling_code });
  return c.json({ success: true });
});
```

- [ ] **Step 2: Add the sources registry handlers**

Replace the `export const intelSources = new Hono<Env>();` line at the bottom with the full registry:

```ts
export const intelSources = new Hono<Env>();

const sourceVisible = (s: any, sup: boolean) =>
  (sup || !s.restricted) ? s : { ...s, true_identity_person_id: null, notes_restricted: null, _restricted: true };

// GET /api/intel/sources
intelSources.get('/', operational, async (c) => {
  const db = getDb(c.env);
  const rows = await query<any>(db, 'SELECT * FROM intel_sources ORDER BY created_at DESC LIMIT 200');
  return c.json(rows.map((s) => sourceVisible(s, isSup(c))));
});

// POST /api/intel/sources
intelSources.post('/', supervisorPlus, async (c) => {
  const db = getDb(c.env); const userId = c.get('userId') as number;
  const b = await c.req.json().catch(() => ({}));
  if (!b.source_type) return c.json({ error: 'source_type required' }, 400);
  const year = new Date().getUTCFullYear();
  const cnt = await queryFirst<{ n: number }>(db,
    'SELECT COUNT(*) AS n FROM intel_sources WHERE source_code LIKE ?', `SRC-${year}-%`);
  const source_code = `SRC-${year}-${String((cnt?.n || 0) + 1).padStart(3, '0')}`;
  const res = await execute(db,
    `INSERT INTO intel_sources
       (source_code, source_type, display_label, true_identity_person_id, handler_user_id,
        reliability_grade, status, restricted, notes_restricted, created_by)
     VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
    source_code, b.source_type, b.display_label || null, b.true_identity_person_id || null,
    b.handler_user_id || null, b.reliability_grade || null,
    b.restricted === false ? 0 : 1, b.notes_restricted || null, userId);
  return c.json({ success: true, id: res.meta?.last_row_id, source_code });
});

// GET /api/intel/sources/:id
intelSources.get('/:id', operational, async (c) => {
  const db = getDb(c.env);
  const s = await queryFirst<any>(db, 'SELECT * FROM intel_sources WHERE id = ?', Number(c.req.param('id')));
  if (!s) return c.json({ error: 'not found' }, 404);
  return c.json(sourceVisible(s, isSup(c)));
});

// PUT /api/intel/sources/:id
intelSources.put('/:id', supervisorPlus, async (c) => {
  const db = getDb(c.env);
  const id = Number(c.req.param('id'));
  const b = await c.req.json().catch(() => ({}));
  const allowed = ['display_label', 'handler_user_id', 'status', 'restricted', 'notes_restricted', 'reliability_grade'];
  const sets: string[] = []; const args: unknown[] = [];
  for (const k of allowed) if (k in b) { sets.push(`${k} = ?`); args.push(b[k]); }
  if (!sets.length) return c.json({ error: 'no editable fields' }, 400);
  sets.push("updated_at = datetime('now')");
  args.push(id);
  await execute(db, `UPDATE intel_sources SET ${sets.join(', ')} WHERE id = ?`, ...args);
  return c.json({ success: true });
});

// POST /api/intel/sources/:id/reliability { new_grade, reason }
intelSources.post('/:id/reliability', supervisorPlus, async (c) => {
  const db = getDb(c.env); const userId = c.get('userId') as number;
  const id = Number(c.req.param('id'));
  const b = await c.req.json().catch(() => ({}));
  const s = await queryFirst<any>(db, 'SELECT reliability_grade FROM intel_sources WHERE id = ?', id);
  if (!s) return c.json({ error: 'not found' }, 404);
  await execute(db,
    `INSERT INTO intel_source_reliability_log (source_id, old_grade, new_grade, reason, changed_by)
     VALUES (?, ?, ?, ?, ?)`, id, s.reliability_grade || null, b.new_grade, b.reason || null, userId);
  await execute(db,
    "UPDATE intel_sources SET reliability_grade = ?, updated_at = datetime('now') WHERE id = ?", b.new_grade, id);
  return c.json({ success: true });
});
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/routes/intel/development.ts
git commit -m "feat(intel): entity links, external share, source/CI registry"
```

---

## Task 7: Retention cron sweep

**Files:**
- Create: `src/utils/intelRetention.ts`
- Modify: `src/index.ts` (per-minute cron branch)

- [ ] **Step 1: Create the sweep util**

Create `src/utils/intelRetention.ts`:

```ts
// ============================================================
// RMPG Flex — Intel retention sweep (28 CFR Part 23-style).
// Flips disseminated reports past their review_date to 'due_review'
// and raises a deduped anomaly_alert. Naturally idempotent: once a
// report is 'due_review' it no longer matches the active filter.
// ============================================================
import type { D1Database } from '@cloudflare/workers-types';
import { query, execute } from './db';

export async function sweepRetention(db: D1Database): Promise<number> {
  let flagged = 0;
  let due: any[] = [];
  try {
    due = await query<any>(db,
      `SELECT id, report_number, title FROM intel_reports
       WHERE retention_status = 'active' AND review_date IS NOT NULL
         AND review_date <= date('now') AND status NOT IN ('rejected','purged')
       LIMIT 200`);
  } catch { return 0; } // table not on this DB yet — no-op
  for (const r of due) {
    try {
      await execute(db,
        `UPDATE intel_reports SET retention_status='due_review', updated_at=datetime('now') WHERE id = ?`, r.id);
      await execute(db,
        `INSERT OR IGNORE INTO anomaly_alerts (alert_type, severity, title, details, dedup_key, created_at, updated_at)
         VALUES ('intel_retention_due', 'low', ?, ?, ?, datetime('now'), datetime('now'))`,
        `Intel review due: ${r.report_number || r.id}`,
        JSON.stringify({ report_id: r.id, title: r.title }),
        `intel_retention:${r.id}`);
      flagged++;
    } catch (e: any) { console.error('[intel-retention] flag failed:', e?.message); }
  }
  return flagged;
}
```

- [ ] **Step 2: Wire into the per-minute cron branch in `src/index.ts`**

In `src/index.ts`, inside the `if (event.cron === '* * * * *') {` block, after the existing intel-screen `ctx.waitUntil(...)` block (around line 350, before the email-poll block), add:

```ts
      // Intel retention sweep — flags disseminated products past their
      // 28 CFR review_date as due_review (deduped anomaly_alert). Cheap
      // when nothing is due; naturally idempotent.
      ctx.waitUntil(
        import('./utils/intelRetention')
          .then(({ sweepRetention }) => sweepRetention(env.DB))
          .then((n) => { if (n) console.log(`[intel-retention] ${n} flagged for review`); })
          .catch((err) => console.error('[intel-retention] sweep failed:', err)),
      );
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/utils/intelRetention.ts src/index.ts
git commit -m "feat(intel): retention sweep flags products due for review"
```

---

## Task 8: FTS indexer — index disseminated products

**Files:**
- Modify: `src/utils/intelIndexer.ts`

So a full reindex also picks up already-disseminated products (the disseminate route indexes incrementally; this keeps a rebuild consistent).

- [ ] **Step 1: Add `intel_report` to `INTEL_TYPES`**

In `src/utils/intelIndexer.ts` line ~22, change:

```ts
export const INTEL_TYPES = ['person', 'vehicle', 'property', 'case', 'incident', 'call',
  'warrant', 'citation', 'field_interview', 'trespass_order', 'evidence'] as const;
```

to:

```ts
export const INTEL_TYPES = ['person', 'vehicle', 'property', 'case', 'incident', 'call',
  'warrant', 'citation', 'field_interview', 'trespass_order', 'evidence', 'intel_report'] as const;
```

- [ ] **Step 2: Add the `case` to `rowsFor`**

In `rowsFor`, immediately before `default: return [];`, add:

```ts
    case 'intel_report':
      return (await query<any>(db,
        `SELECT id, report_number, title, sanitized_narrative FROM intel_reports WHERE status = 'disseminated'`)).map((r) => ({
        type, id: r.id,
        label: joinReal(r.report_number, r.title) || `Intel #${r.id}`,
        body: joinReal(r.sanitized_narrative),
        identifiers: joinReal(r.report_number),
      }));
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/utils/intelIndexer.ts
git commit -m "feat(intel): index disseminated products in FTS rebuild"
```

---

## Task 9: Dossier — "Linked Intelligence" section

**Files:**
- Modify: `src/routes/intel.ts` (the `/dossier/person/:id` handler, lines ~628–806)

- [ ] **Step 1: Query linked disseminated products in the dossier handler**

In `src/routes/intel.ts`, inside the `intel.get('/dossier/person/:id', ...)` handler, after the existing data is gathered and before the final `return c.json({...})`, add a try/catch block that fetches disseminated reports linked to this person (and its cluster ids if available). Add:

```ts
  // Linked Intelligence — disseminated products that name this person.
  let linkedIntel: any[] = [];
  try {
    linkedIntel = await query<any>(db,
      `SELECT r.id, r.report_number, r.title, r.threat_level, r.source_reliability,
              r.info_credibility, r.handling_code, r.disseminated_at, l.role
       FROM intel_report_links l JOIN intel_reports r ON r.id = l.report_id
       WHERE l.entity_type = 'person' AND l.entity_id = ? AND r.status = 'disseminated'
       ORDER BY r.disseminated_at DESC`, personId);
  } catch (err: any) { console.error('[intel] linked intel failed:', err?.message); }
```

> Note: use the same person-id variable the handler already uses for the subject (it is named `personId` or `id` in that handler — match the existing name).

- [ ] **Step 2: Include it in the dossier response**

Add `linked_intel: linkedIntel,` to the object passed to the final `c.json({...})` in that handler.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/routes/intel.ts
git commit -m "feat(intel): surface linked intelligence on person dossier"
```

---

## Task 10: Client — sanitized product PDF

**Files:**
- Create: `client/src/utils/intelProductPdf.ts`

- [ ] **Step 1: Write the generator**

Create `client/src/utils/intelProductPdf.ts`:

```ts
// ═══════════════════════════════════════════════════════════════
// Intelligence Product — sanitized PDF (Intel v2 Wave 1).
// Arial-only (registerArialFont — project rule). NEVER renders the
// raw_narrative or source identity. Handling-code stamped header/footer.
// ═══════════════════════════════════════════════════════════════
import jsPDF from 'jspdf';
import { registerArialFont } from './pdf/fonts/registerArial';

export interface IntelProductData {
  report_number: string;
  title: string;
  grade_label: string;
  handling_code: string;
  threat_level: string;
  sanitized_narrative: string;
  assessment: string;
  disseminated_at: string | null;
  links: Array<{ entity_type: string; entity_id: number; role: string }>;
}

const GOLD = '#d4a017';
const SENTINELS = new Set(['', 'none', 'n/a', 'na', 'null', 'unknown']);
const real = (v: unknown) => v != null && !SENTINELS.has(String(v).trim().toLowerCase());
const show = (v: unknown) => (real(v) ? String(v) : '—');

const HANDLING: Record<string, string> = {
  H1: 'H1 — RMPG INTERNAL ONLY',
  H2: 'H2 — LAW ENFORCEMENT, NEED-TO-KNOW',
  H3: 'H3 — PARTNER/CLIENT, SANITIZED',
  H4: 'H4 — CONDITIONS APPLY — REFER TO ORIGINATOR',
  H5: 'H5 — NO FURTHER DISSEMINATION',
};

export function generateIntelProductPdf(d: IntelProductData): void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' });
  registerArialFont(doc);
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 40;
  const handling = HANDLING[d.handling_code] || d.handling_code || 'UNCLASSIFIED';

  const stamp = () => {
    doc.setFillColor(GOLD); doc.rect(0, 0, W, 22, 'F');
    doc.setTextColor('#000000'); doc.setFont('Arial', 'bold'); doc.setFontSize(9);
    doc.text(handling, W / 2, 15, { align: 'center' });
    doc.setFillColor(GOLD); doc.rect(0, H - 22, W, 22, 'F');
    doc.text(handling, W / 2, H - 8, { align: 'center' });
  };
  stamp();

  let y = 50;
  doc.setTextColor('#000000'); doc.setFont('Arial', 'bold'); doc.setFontSize(16);
  doc.text('INTELLIGENCE PRODUCT', M, y); y += 20;
  doc.setFontSize(11); doc.setFont('Arial', 'normal');
  doc.text(`${show(d.report_number)} — ${show(d.title)}`, M, y); y += 16;
  doc.text(`Grade: ${show(d.grade_label)}    Threat: ${show(d.threat_level).toUpperCase()}`, M, y); y += 16;
  doc.text(`Disseminated: ${show(d.disseminated_at)}`, M, y); y += 24;

  const block = (heading: string, text: string) => {
    if (y > H - 80) { doc.addPage(); stamp(); y = 50; }
    doc.setFont('Arial', 'bold'); doc.setFontSize(11); doc.text(heading, M, y); y += 16;
    doc.setFont('Arial', 'normal'); doc.setFontSize(10);
    for (const line of doc.splitTextToSize(show(text), W - 2 * M) as string[]) {
      if (y > H - 40) { doc.addPage(); stamp(); y = 50; }
      doc.text(line, M, y); y += 14;
    }
    y += 10;
  };
  block('ASSESSMENT', d.assessment);
  block('NARRATIVE (SANITIZED)', d.sanitized_narrative);
  if (d.links?.length) {
    block('LINKED ENTITIES', d.links.map((l) => `${l.entity_type} #${l.entity_id} (${l.role})`).join('\n'));
  }
  doc.save(`${d.report_number || 'intel-product'}.pdf`);
}
```

- [ ] **Step 2: Typecheck client**

Run: `cd client && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add client/src/utils/intelProductPdf.ts
git commit -m "feat(intel): sanitized intelligence-product PDF generator"
```

---

## Task 11: Client — reports queue page

**Files:**
- Create: `client/src/pages/intel/IntelReportsPage.tsx`

- [ ] **Step 1: Write the page**

Create `client/src/pages/intel/IntelReportsPage.tsx`:

```tsx
import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../../hooks/useApi';

interface ReportRow {
  id: number; report_number: string; title: string; status: string;
  threat_level: string; grade_label: string; confidence: number;
  retention_status: string; submitted_at: string;
}

const STATUSES = ['submitted', 'under_evaluation', 'graded', 'analyzed', 'disseminated', 'recalled', 'archived', 'rejected'];
const THREAT_COLOR: Record<string, string> = {
  critical: '#ef4444', high: '#f59e0b', medium: '#d4a017', low: '#888888',
};

export default function IntelReportsPage() {
  const nav = useNavigate();
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    apiFetch<ReportRow[]>(`/intel/reports${status ? `?status=${status}` : ''}`)
      .then((r) => setRows(Array.isArray(r) ? r : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [status]);
  useEffect(load, [load]);

  return (
    <div className="p-4 space-y-3" style={{ background: '#000000', minHeight: '100%', color: '#ddd' }}>
      <div className="flex items-center justify-between">
        <h1 className="text-sm font-semibold tracking-wide" style={{ color: '#d4a017' }}>
          INTELLIGENCE PRODUCTS
        </h1>
        <button onClick={() => nav('/intel/reports/new')}
          className="px-3 py-1 text-xs font-semibold"
          style={{ background: '#d4a017', color: '#000', borderRadius: 2 }}>
          + NEW REPORT
        </button>
      </div>

      <div className="flex gap-1 flex-wrap text-[10px]">
        <button onClick={() => setStatus('')}
          className="px-2 py-1" style={{ background: status === '' ? '#d4a017' : '#0b0b0b', color: status === '' ? '#000' : '#888', borderRadius: 2 }}>
          ALL
        </button>
        {STATUSES.map((s) => (
          <button key={s} onClick={() => setStatus(s)}
            className="px-2 py-1 uppercase"
            style={{ background: status === s ? '#d4a017' : '#0b0b0b', color: status === s ? '#000' : '#888', borderRadius: 2 }}>
            {s.replace('_', ' ')}
          </button>
        ))}
      </div>

      <table className="w-full text-[11px]" style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ color: '#888', textAlign: 'left' }}>
            <th className="py-[3px] font-semibold text-[9px]">NUMBER</th>
            <th className="py-[3px] font-semibold text-[9px]">TITLE</th>
            <th className="py-[3px] font-semibold text-[9px]">STATUS</th>
            <th className="py-[3px] font-semibold text-[9px]">GRADE</th>
            <th className="py-[3px] font-semibold text-[9px]">CONF</th>
            <th className="py-[3px] font-semibold text-[9px]">THREAT</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} onClick={() => nav(`/intel/reports/${r.id}`)}
              style={{ cursor: 'pointer', borderTop: '1px solid #232323' }}>
              <td className="py-[2px]" style={{ color: '#d4a017' }}>{r.report_number}</td>
              <td className="py-[2px]">{r.title}</td>
              <td className="py-[2px] uppercase">{r.status.replace('_', ' ')}
                {r.retention_status === 'due_review' && <span style={{ color: '#f59e0b' }}> ⚑</span>}</td>
              <td className="py-[2px]">{r.grade_label === 'UNGRADED' ? '—' : r.grade_label.split(' — ')[0]}</td>
              <td className="py-[2px]">{r.confidence || '—'}</td>
              <td className="py-[2px] uppercase" style={{ color: THREAT_COLOR[r.threat_level] || '#888' }}>{r.threat_level}</td>
            </tr>
          ))}
          {!rows.length && !loading && (
            <tr><td colSpan={6} className="py-3 text-center" style={{ color: '#555' }}>No reports.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck client**

Run: `cd client && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/intel/IntelReportsPage.tsx
git commit -m "feat(intel): intelligence-products queue page"
```

---

## Task 12: Client — report detail / lifecycle page

**Files:**
- Create: `client/src/pages/intel/IntelReportDetailPage.tsx`

This is the lifecycle UI: it renders the current state and offers the next legal action(s). New reports use `id === 'new'` to show the submit form.

- [ ] **Step 1: Write the page**

Create `client/src/pages/intel/IntelReportDetailPage.tsx`:

```tsx
import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiFetch } from '../../hooks/useApi';
import { generateIntelProductPdf } from '../../utils/intelProductPdf';

const REL = ['A', 'B', 'C', 'D', 'E', 'F'];
const CRED = [1, 2, 3, 4, 5, 6];
const HANDLING = ['H1', 'H2', 'H3', 'H4', 'H5'];
const THREATS = ['low', 'medium', 'high', 'critical'];

const btn = (bg: string, fg = '#000'): React.CSSProperties => ({
  background: bg, color: fg, borderRadius: 2, padding: '4px 10px', fontSize: 11, fontWeight: 600,
});
const field: React.CSSProperties = { background: '#0b0b0b', color: '#ddd', border: '1px solid #232323', borderRadius: 2, padding: '4px 6px', fontSize: 11, width: '100%' };

export default function IntelReportDetailPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const isNew = id === 'new';
  const [r, setR] = useState<any>(null);
  const [draft, setDraft] = useState<any>({ title: '', raw_narrative: '', threat_level: 'low', source_type: 'officer_observation' });
  const [grade, setGrade] = useState<any>({ source_reliability: 'B', info_credibility: 2, handling_code: 'H1' });
  const [analysis, setAnalysis] = useState<any>({ sanitized_narrative: '', assessment: '', criminal_predicate: '', threat_level: 'low' });
  const [msg, setMsg] = useState('');

  const load = useCallback(() => {
    if (isNew) return;
    apiFetch<any>(`/intel/reports/${id}`).then(setR).catch(() => setMsg('Failed to load.'));
  }, [id, isNew]);
  useEffect(load, [load]);

  const act = async (path: string, body: unknown) => {
    setMsg('');
    try {
      const res = await apiFetch<any>(`/intel/reports/${id}${path}`, { method: 'POST', body: JSON.stringify(body) });
      if (res?.error) { setMsg(res.error); return; }
      load();
    } catch (e: any) { setMsg(e?.message || 'Action failed.'); }
  };

  const submit = async () => {
    setMsg('');
    if (!draft.title.trim()) { setMsg('Title required.'); return; }
    try {
      const res = await apiFetch<any>('/intel/reports', { method: 'POST', body: JSON.stringify(draft) });
      if (res?.id) nav(`/intel/reports/${res.id}`);
      else setMsg(res?.error || 'Submit failed.');
    } catch (e: any) { setMsg(e?.message || 'Submit failed.'); }
  };

  const wrap = (children: React.ReactNode) => (
    <div className="p-4 space-y-3" style={{ background: '#000', minHeight: '100%', color: '#ddd' }}>
      <button onClick={() => nav('/intel/reports')} style={{ color: '#888', fontSize: 11 }}>← Products</button>
      {msg && <div style={{ color: '#ef4444', fontSize: 11 }}>{msg}</div>}
      {children}
    </div>
  );

  if (isNew) {
    return wrap(
      <div className="space-y-2 max-w-2xl">
        <h1 className="text-sm font-semibold" style={{ color: '#d4a017' }}>NEW INTEL REPORT</h1>
        <input placeholder="Title" style={field} value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
        <select style={field} value={draft.source_type} onChange={(e) => setDraft({ ...draft, source_type: e.target.value })}>
          {['officer_observation', 'confidential_informant', 'anonymous_tip', 'public', 'other_agency', 'osint', 'technical', 'victim', 'witness', 'suspect'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <textarea placeholder="Raw narrative (restricted — source-identifying OK here)" rows={6} style={field}
          value={draft.raw_narrative} onChange={(e) => setDraft({ ...draft, raw_narrative: e.target.value })} />
        <select style={field} value={draft.threat_level} onChange={(e) => setDraft({ ...draft, threat_level: e.target.value })}>
          {THREATS.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <button onClick={submit} style={btn('#d4a017')}>SUBMIT REPORT</button>
      </div>,
    );
  }

  if (!r) return wrap(<div style={{ color: '#555' }}>Loading…</div>);

  return wrap(
    <div className="space-y-3 max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="text-sm font-semibold" style={{ color: '#d4a017' }}>
          {r.report_number} — {r.title}
        </h1>
        <span className="uppercase text-[11px]" style={{ color: '#888' }}>{r.status?.replace('_', ' ')}</span>
      </div>
      <div className="text-[11px]" style={{ color: '#aaa' }}>
        Grade: {r.grade_label} · Confidence: {r.confidence} · Handling: {r.handling_code || '—'} · Threat: {r.threat_level}
        {r.review_date && <> · Review: {r.review_date}</>}
      </div>

      {r.raw_narrative != null && (
        <div>
          <div className="text-[9px] font-semibold" style={{ color: '#888' }}>RAW NARRATIVE (RESTRICTED)</div>
          <div className="text-[11px] p-2" style={{ background: '#0b0b0b', borderRadius: 2 }}>{r.raw_narrative || '—'}</div>
        </div>
      )}
      {r.sanitized_narrative && (
        <div>
          <div className="text-[9px] font-semibold" style={{ color: '#888' }}>SANITIZED PRODUCT</div>
          <div className="text-[11px] p-2" style={{ background: '#0b0b0b', borderRadius: 2 }}>{r.sanitized_narrative}</div>
        </div>
      )}

      {/* Stage actions */}
      {['submitted', 'under_evaluation'].includes(r.status) && (
        <div className="space-y-2 p-2" style={{ border: '1px solid #232323', borderRadius: 2 }}>
          <div className="text-[9px] font-semibold" style={{ color: '#d4a017' }}>EVALUATE — ASSIGN 5×5×5 GRADE</div>
          <div className="flex gap-2">
            <select style={field} value={grade.source_reliability} onChange={(e) => setGrade({ ...grade, source_reliability: e.target.value })}>{REL.map((x) => <option key={x}>{x}</option>)}</select>
            <select style={field} value={grade.info_credibility} onChange={(e) => setGrade({ ...grade, info_credibility: Number(e.target.value) })}>{CRED.map((x) => <option key={x}>{x}</option>)}</select>
            <select style={field} value={grade.handling_code} onChange={(e) => setGrade({ ...grade, handling_code: e.target.value })}>{HANDLING.map((x) => <option key={x}>{x}</option>)}</select>
          </div>
          <button onClick={() => act('/evaluate', grade)} style={btn('#d4a017')}>GRADE</button>
        </div>
      )}

      {r.status === 'graded' && (
        <div className="space-y-2 p-2" style={{ border: '1px solid #232323', borderRadius: 2 }}>
          <div className="text-[9px] font-semibold" style={{ color: '#d4a017' }}>ANALYZE — SANITIZE + ASSESS</div>
          <textarea placeholder="Sanitized narrative (source protected)" rows={4} style={field}
            value={analysis.sanitized_narrative} onChange={(e) => setAnalysis({ ...analysis, sanitized_narrative: e.target.value })} />
          <textarea placeholder="Assessment / significance" rows={2} style={field}
            value={analysis.assessment} onChange={(e) => setAnalysis({ ...analysis, assessment: e.target.value })} />
          <input placeholder="Criminal predicate (28 CFR retention justification)" style={field}
            value={analysis.criminal_predicate} onChange={(e) => setAnalysis({ ...analysis, criminal_predicate: e.target.value })} />
          <button onClick={() => act('/analyze', analysis)} style={btn('#d4a017')}>SAVE ANALYSIS</button>
        </div>
      )}

      {r.status === 'analyzed' && (
        <button onClick={() => act('/disseminate', {})} style={btn('#22c55e')}>DISSEMINATE</button>
      )}

      {r.status === 'disseminated' && (
        <div className="flex gap-2">
          <button onClick={() => generateIntelProductPdf({
            report_number: r.report_number, title: r.title, grade_label: r.grade_label,
            handling_code: r.handling_code, threat_level: r.threat_level,
            sanitized_narrative: r.sanitized_narrative, assessment: r.assessment,
            disseminated_at: r.disseminated_at, links: r.links || [],
          })} style={btn('#0b0b0b', '#d4a017')}>EXPORT PDF</button>
          <button onClick={() => { const reason = prompt('Recall reason:'); if (reason) act('/recall', { reason }); }}
            style={btn('#0b0b0b', '#ef4444')}>RECALL</button>
        </div>
      )}

      {['submitted', 'under_evaluation', 'graded'].includes(r.status) && (
        <button onClick={() => { const reason = prompt('Reject reason:'); if (reason) act('/reject', { reason }); }}
          style={btn('#0b0b0b', '#ef4444')}>REJECT</button>
      )}
    </div>,
  );
}
```

- [ ] **Step 2: Typecheck client**

Run: `cd client && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/intel/IntelReportDetailPage.tsx
git commit -m "feat(intel): report lifecycle detail page"
```

---

## Task 13: Client — source/CI registry page

**Files:**
- Create: `client/src/pages/intel/IntelSourcesPage.tsx`

- [ ] **Step 1: Write the page**

Create `client/src/pages/intel/IntelSourcesPage.tsx`:

```tsx
import { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../../hooks/useApi';

interface Source {
  id: number; source_code: string; source_type: string; display_label: string;
  reliability_grade: string; status: string; restricted: number; _restricted?: boolean;
}
const TYPES = ['officer_observation', 'confidential_informant', 'anonymous_tip', 'public', 'other_agency', 'osint', 'technical', 'victim', 'witness', 'suspect'];
const field: React.CSSProperties = { background: '#0b0b0b', color: '#ddd', border: '1px solid #232323', borderRadius: 2, padding: '4px 6px', fontSize: 11 };

export default function IntelSourcesPage() {
  const [rows, setRows] = useState<Source[]>([]);
  const [form, setForm] = useState<any>({ source_type: 'confidential_informant', display_label: '', reliability_grade: 'C' });
  const [msg, setMsg] = useState('');

  const load = useCallback(() => {
    apiFetch<Source[]>('/intel/sources').then((r) => setRows(Array.isArray(r) ? r : [])).catch(() => setRows([]));
  }, []);
  useEffect(load, [load]);

  const create = async () => {
    setMsg('');
    try {
      const res = await apiFetch<any>('/intel/sources', { method: 'POST', body: JSON.stringify(form) });
      if (res?.error) setMsg(res.error); else { setForm({ source_type: 'confidential_informant', display_label: '', reliability_grade: 'C' }); load(); }
    } catch (e: any) { setMsg(e?.message || 'Failed.'); }
  };

  return (
    <div className="p-4 space-y-3" style={{ background: '#000', minHeight: '100%', color: '#ddd' }}>
      <h1 className="text-sm font-semibold" style={{ color: '#d4a017' }}>SOURCE / CI REGISTRY</h1>
      {msg && <div style={{ color: '#ef4444', fontSize: 11 }}>{msg}</div>}

      <div className="flex gap-2 flex-wrap items-center">
        <select style={field} value={form.source_type} onChange={(e) => setForm({ ...form, source_type: e.target.value })}>
          {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <input placeholder="Display label (non-identifying)" style={{ ...field, width: 220 }}
          value={form.display_label} onChange={(e) => setForm({ ...form, display_label: e.target.value })} />
        <select style={field} value={form.reliability_grade} onChange={(e) => setForm({ ...form, reliability_grade: e.target.value })}>
          {['A', 'B', 'C', 'D', 'E', 'F'].map((g) => <option key={g}>{g}</option>)}
        </select>
        <button onClick={create} style={{ background: '#d4a017', color: '#000', borderRadius: 2, padding: '4px 10px', fontSize: 11, fontWeight: 600 }}>+ ADD SOURCE</button>
      </div>

      <table className="w-full text-[11px]" style={{ borderCollapse: 'collapse' }}>
        <thead><tr style={{ color: '#888', textAlign: 'left' }}>
          <th className="py-[3px] text-[9px] font-semibold">CODE</th>
          <th className="py-[3px] text-[9px] font-semibold">TYPE</th>
          <th className="py-[3px] text-[9px] font-semibold">LABEL</th>
          <th className="py-[3px] text-[9px] font-semibold">RELIABILITY</th>
          <th className="py-[3px] text-[9px] font-semibold">STATUS</th>
        </tr></thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.id} style={{ borderTop: '1px solid #232323' }}>
              <td className="py-[2px]" style={{ color: '#d4a017' }}>{s.source_code}</td>
              <td className="py-[2px]">{s.source_type}{s._restricted && <span style={{ color: '#888' }}> 🔒</span>}</td>
              <td className="py-[2px]">{s.display_label || '—'}</td>
              <td className="py-[2px]">{s.reliability_grade || '—'}</td>
              <td className="py-[2px] uppercase">{s.status}</td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={5} className="py-3 text-center" style={{ color: '#555' }}>No sources.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck client**

Run: `cd client && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/intel/IntelSourcesPage.tsx
git commit -m "feat(intel): source/CI registry page"
```

---

## Task 14: Client — wire routes, nav, and SW bump

**Files:**
- Modify: `client/src/App.tsx`
- Modify: `client/src/components/Sidebar.tsx`
- Modify: `client/public/sw.js`

- [ ] **Step 1: Register the lazy imports in `App.tsx`**

Near the other intel lazy imports (around line 119), add:

```tsx
const IntelReportsPage = lazyRetry(() => import('./pages/intel/IntelReportsPage'));
const IntelReportDetailPage = lazyRetry(() => import('./pages/intel/IntelReportDetailPage'));
const IntelSourcesPage = lazyRetry(() => import('./pages/intel/IntelSourcesPage'));
```

- [ ] **Step 2: Add the routes in `App.tsx`**

Near the other `/intel/...` routes (around line 466), add:

```tsx
            <Route path="/intel/reports" element={<RouteErrorBoundary><IntelReportsPage /></RouteErrorBoundary>} />
            <Route path="/intel/reports/:id" element={<RouteErrorBoundary><IntelReportDetailPage /></RouteErrorBoundary>} />
            <Route path="/intel/sources" element={<RouteErrorBoundary><IntelSourcesPage /></RouteErrorBoundary>} />
```

- [ ] **Step 3: Add Sidebar nav links**

In `client/src/components/Sidebar.tsx`, find the existing intel nav entry (search for `/intel` or `IntelSearchPage`/`Intel Search` label) and add two sibling links in the same group/array, matching the existing entry's shape (icon + label + path). Add entries for:
- `{ label: 'Intel Products', path: '/intel/reports' }`
- `{ label: 'Source Registry', path: '/intel/sources' }`

(Use the same object/JSX structure as the adjacent intel item — match icon-component import style already in the file.)

- [ ] **Step 4: Bump the service worker cache**

In `client/public/sw.js` line 605, change:

```js
const CACHE_NAME = 'rmpg-flex-v916';
```

to:

```js
const CACHE_NAME = 'rmpg-flex-v917';
```

- [ ] **Step 5: Typecheck + build the client**

Run: `cd client && npx tsc --noEmit && npx vite build`
Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add client/src/App.tsx client/src/components/Sidebar.tsx client/public/sw.js
git commit -m "feat(intel): routes + nav for products/sources (SW v917)"
```

---

## Task 15: Full verification + PR

**Files:** none (verification)

- [ ] **Step 1: Worker typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 2: Full worker test suite**

Run: `npm test`
Expected: PASS — all prior tests + new `intelDevelopment.test.ts` cases green.

- [ ] **Step 3: Client typecheck + tests + build**

Run: `cd client && npx tsc --noEmit && npx vitest run && npx vite build`
Expected: all PASS.

- [ ] **Step 4: Push branch + open PR**

```bash
git push -u origin claude/jovial-fermi-d06843
gh pr create --title "Intel v2 Wave 1 — intelligence development cycle" \
  --body "$(cat <<'EOF'
## Summary
Wave 1 of the Intel v2 program: the intelligence-development cycle.

- New two-bodied `intel_reports` entity (restricted raw + disseminable sanitized).
- Admiralty 5×5×5 grading (source reliability A–F × info credibility 1–6 × handling code H1–H5).
- Role+completeness state machine (submitted→evaluated→graded→analyzed→disseminated; recall/reject/archive/purge), guarded by tested pure logic.
- Source / CI registry with identity redaction + reliability history.
- Dissemination to notifications inbox + FTS index + person dossier; sanitized handling-code-stamped PDF; external-share audit ledger.
- 28 CFR Part 23-style retention: review_date + daily cron flagging due-for-review.

Migration `0104_intel_development.sql` — **apply to live D1 `785de7ae` post-merge**.
SW bumped v916 → v917.

Spec: `docs/superpowers/specs/2026-06-13-intel-development-cycle-design.md`
Plan: `docs/superpowers/plans/2026-06-13-intel-development-cycle.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: Post-merge (manual, documented for the operator)**

After merge + green deploy: apply `0104` directly to live D1 via the Cloudflare D1 API (`mcp__bfc8f52c-…__d1_database_query`, database `785de7ae`), verify with `SELECT name FROM pragma_table_info('intel_reports')`, then `POST /api/intel/reindex` (admin, in a real browser — WAF blocks curl), and smoke-test a submit→evaluate→analyze→disseminate round-trip in the browser.

---

## Self-Review

**Spec coverage:**
- Two-bodied entity (raw + sanitized) → Task 1 (columns), Tasks 4/5 (handlers), Task 12 (UI). ✔
- Admiralty 5×5×5 → Task 2 `gradeLabel`, Task 3 `confidenceScore`, Task 5 evaluate route, Task 12 grading widget. ✔
- State machine → Task 3 `canTransition` + Task 5 transition routes. ✔
- Source/CI registry + reliability history → Task 1 tables, Task 6 routes, Task 13 page. ✔
- Dissemination: inbox + FTS + dossier + PDF + external share → Task 5 (inbox/FTS), Task 9 (dossier), Task 10 (PDF), Task 6 (share). ✔
- 28 CFR retention → Task 2 `computeReviewDate`/`retentionStatus`, Task 7 sweep. ✔
- Client pages + nav + SW bump → Tasks 11–14. ✔
- Tests → Tasks 2–3 (`intelDevelopment.test.ts`). ✔

**Placeholder scan:** The two ⭐ user-contribution functions ship with complete reference implementations (the tests pass against them) — not placeholders. Task 9 references "the existing person-id variable name" — flagged explicitly because the dossier handler's local variable name must be matched at edit time (verify with a quick read of `intel.ts:628`). No other TBDs.

**Type consistency:** `IntelReport` interface (Task 2) is the single source of truth, imported by `development.ts` (Tasks 4–6). `canTransition(report, toStatus, role)` and `confidenceScore(reliability, credibility)` signatures match between definition (Task 3) and call sites (Task 5, Task 11/12 via API fields). `generateIntelProductPdf(IntelProductData)` (Task 10) matches the call in Task 12. Handling codes H1–H5 consistent across migration, routes (`share` gate), PDF stamp, and UI select.
