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
