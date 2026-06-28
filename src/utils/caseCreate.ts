// ============================================================
// caseCreate.ts — context-free Case File creation
// ============================================================
// Pure-DB case insert + junction wiring, usable from any worker
// context (no Hono Context needed). Mirrors POST /api/cases in
// src/routes/cases.ts so an auto-created case is indistinguishable
// from a manually-created one to every downstream reader.
//
// Junction writes are best-effort. A missing junction table (legacy
// D1 that never ran migration 0039) or a missing column (legacy D1
// without calls_for_service.case_id) must never abort case creation
// — the auto-create runs inside commitIntake, where a thrown error
// would orphan the freshly-inserted serve_queue row.
//
// Used by:
//   - src/utils/serveIntakeRecords.ts:commitIntake (auto-create a
//     Case File for every Serve Intake batch)
// ============================================================

import { execute, queryFirst } from './db';

// ── 2-letter case_type codes (mirrors src/routes/cases.ts) ──
const CASE_TYPE_CODES: Record<string, string> = {
  general: 'GN', criminal: 'CR', traffic: 'TR', medical: 'MD',
  security: 'SE', disorder: 'DS', service: 'SV', fire: 'FR',
  admin: 'AD', civil: 'CV', use_of_force: 'UF', property: 'PR',
  missing_person: 'MP', narcotics: 'NR', fraud: 'FD', juvenile: 'JV',
  domestic: 'DM', accident: 'AC', death: 'DT', theft: 'TH',
  assault: 'AS', burglary: 'BG', other: 'OT',
};

export function caseTypeCode(t: string): string {
  return CASE_TYPE_CODES[t] || 'GN';
}

const HIGH_SEVERITY = new Set(['homicide', 'sexual_assault', 'use_of_force', 'death', 'assault', 'kidnapping']);
const ELEVATED = new Set(['burglary', 'robbery', 'narcotics', 'arson', 'domestic', 'missing_person']);
const LOW = new Set(['admin', 'civil', 'property', 'other']);

export function autoCasePriority(caseType: string): string {
  if (HIGH_SEVERITY.has(caseType)) return 'critical';
  if (ELEVATED.has(caseType)) return 'high';
  if (LOW.has(caseType)) return 'low';
  return 'normal';
}

/**
 * Case number format: YY-NNNNNN-XX (e.g. 26-000042-SV).
 * Sequence is GLOBAL per year — the type code is a visual
 * disambiguator only. Format preserved exactly so existing
 * case numbers don't collide.
 */
export async function generateCaseNumber(db: D1Database, caseType: string): Promise<string> {
  const yy = String(new Date().getFullYear()).slice(-2);
  const typeCode = caseTypeCode(caseType);
  const prefix = `${yy}-`;
  const last = await queryFirst<{ case_number: string }>(
    db,
    `SELECT case_number FROM cases WHERE case_number LIKE ? ORDER BY id DESC LIMIT 1`,
    `${prefix}%`,
  );
  let nextNum = 1;
  if (last?.case_number) {
    const m = last.case_number.match(/\d{2}-(\d{6})-[A-Z]{2}/);
    if (m) nextNum = parseInt(m[1], 10) + 1;
  }
  return `${prefix}${String(nextNum).padStart(6, '0')}-${typeCode}`;
}

export interface LinkedPersonInput {
  person_id: number;
  relationship?: string;  // e.g. 'serve_recipient' | 'serve_recipient_agent'
}

export interface CreateCaseInput {
  title: string;
  case_type?: string;             // defaults to 'general'
  priority?: string;              // defaults to autoCasePriority(case_type)
  summary?: string | null;
  created_by: number | null;
  source?: string;                // logged on case_activity (e.g. 'serve-intake')

  // Junction links — any/all optional
  linked_call_id?: number | null;
  linked_persons?: LinkedPersonInput[];
  linked_property_id?: number | null;
  linked_serve_queue_id?: number | null;
}

export interface CreateCaseResult {
  case_id: number;
  case_number: string;
}

/**
 * Insert a `cases` row + every junction the caller specified.
 * Returns the new case id + case number. Junction writes are
 * try/catch'd individually — the case itself is created even
 * if one or more junction tables are missing or have drift.
 */
export async function createCaseWithLinks(
  db: D1Database,
  input: CreateCaseInput,
): Promise<CreateCaseResult> {
  const caseType = input.case_type ?? 'general';
  const priority = input.priority ?? autoCasePriority(caseType);
  const caseNumber = await generateCaseNumber(db, caseType);
  const persons = (input.linked_persons || []).filter((p) => Number.isFinite(p?.person_id));
  const title = input.title.trim().slice(0, 500);

  const ins = await execute(
    db,
    `INSERT INTO cases (
       case_number, title, case_type, status, priority, summary,
       linked_calls, linked_persons, linked_incidents, linked_evidence,
       created_by, opened_date
     ) VALUES (?, ?, ?, 'open', ?, ?, ?, ?, '[]', '[]', ?, date('now'))`,
    caseNumber, title, caseType, priority,
    input.summary?.trim().slice(0, 5000) ?? null,
    input.linked_call_id ? JSON.stringify([input.linked_call_id]) : '[]',
    JSON.stringify(persons.map((p) => p.person_id)),
    input.created_by,
  );
  const caseId = Number(ins.meta.last_row_id);

  // ── Junction writes (each best-effort) ──

  // CFS: dual-write — denormalized pointer on calls_for_service +
  // canonical junction row. The denormalized column is what the
  // dispatch UI reads; the junction is what cases.ts /full reads.
  if (input.linked_call_id) {
    try {
      await execute(
        db,
        'UPDATE calls_for_service SET case_id = ?, case_number = ? WHERE id = ?',
        caseId, caseNumber, input.linked_call_id,
      );
    } catch { /* legacy D1 without case_id/case_number cols — non-fatal */ }
    try {
      await execute(
        db,
        'INSERT OR IGNORE INTO case_calls (case_id, call_id, added_by) VALUES (?, ?, ?)',
        caseId, input.linked_call_id, input.created_by,
      );
    } catch { /* table may not exist on stale D1 — non-fatal */ }
  }

  for (const p of persons) {
    try {
      await execute(
        db,
        'INSERT OR IGNORE INTO case_person_links (case_id, person_id, relationship) VALUES (?, ?, ?)',
        caseId, p.person_id, p.relationship ?? 'linked',
      );
    } catch { /* non-fatal */ }
  }

  if (input.linked_property_id) {
    try {
      await execute(
        db,
        'INSERT OR IGNORE INTO case_properties (case_id, property_id, added_by) VALUES (?, ?, ?)',
        caseId, input.linked_property_id, input.created_by,
      );
    } catch { /* non-fatal */ }
  }

  // Serve queue: dual-write same pattern as CFS — denormalized
  // pointer on serve_queue + canonical case_serve_jobs junction.
  // Both come from migration 0146 — fail-open on legacy D1.
  if (input.linked_serve_queue_id) {
    try {
      await execute(
        db,
        'INSERT OR IGNORE INTO case_serve_jobs (case_id, serve_queue_id, added_by) VALUES (?, ?, ?)',
        caseId, input.linked_serve_queue_id, input.created_by,
      );
    } catch { /* table may not exist if mig 0146 not yet applied — non-fatal */ }
    try {
      await execute(
        db,
        'UPDATE serve_queue SET case_id = ? WHERE id = ?',
        caseId, input.linked_serve_queue_id,
      );
    } catch { /* column may not exist on legacy D1 — non-fatal */ }
  }

  // ── Activity log (best-effort, mirrors logCaseActivity in cases.ts) ──
  try {
    await execute(
      db,
      'INSERT INTO case_activity (case_id, action, actor_id, detail) VALUES (?, ?, ?, ?)',
      caseId, 'case.created', input.created_by,
      JSON.stringify({
        case_number: caseNumber,
        title,
        ...(input.source ? { source: input.source } : {}),
      }),
    );
  } catch { /* non-fatal */ }

  return { case_id: caseId, case_number: caseNumber };
}
