// Investigative case completeness / readiness (v3 Phase 1). Pure: a typed
// per-case-type checklist evaluated against computed signals. Percent is over
// REQUIRED items (the readiness gate is advisory on required completeness);
// optional items are surfaced but don't dock the score.

export interface CompletenessSignals {
  lead_investigator_id?: number | null;
  narrative?: string | null;
  summary?: string | null;
  solvability_score?: number | null;
  persons?: number;
  evidence?: number;
  attachments?: number;
  vehicles?: number;
  incidents?: number;
  calls?: number;
  tasks_total?: number;
  tasks_open?: number;
  suspect_identified?: boolean;
}

interface ChecklistDef {
  key: string;
  label: string;
  required: boolean;
  test: (s: CompletenessSignals) => boolean;
}

export interface ChecklistResult {
  key: string;
  label: string;
  required: boolean;
  met: boolean;
}

export interface CompletenessResult {
  percent: number;            // over required items
  requiredTotal: number;
  requiredMet: number;
  items: ChecklistResult[];   // required + optional
  missing: string[];          // labels of unmet REQUIRED items
}

const has = (n?: number, min = 1) => (n ?? 0) >= min;

const COMMON: ChecklistDef[] = [
  { key: 'lead_investigator', label: 'Lead investigator assigned', required: true, test: (s) => !!s.lead_investigator_id },
  { key: 'narrative', label: 'Narrative or summary written', required: true, test: (s) => !!(s.narrative?.trim() || s.summary?.trim()) },
  { key: 'persons', label: 'At least one person linked', required: true, test: (s) => has(s.persons) },
  { key: 'has_task', label: 'At least one investigative task', required: false, test: (s) => has(s.tasks_total) },
  { key: 'tasks_resolved', label: 'All tasks resolved', required: false, test: (s) => has(s.tasks_total) && (s.tasks_open ?? 0) === 0 },
];

// Types that warrant the fuller evidentiary checklist.
const INVESTIGATIVE = new Set([
  'criminal', 'burglary', 'theft', 'assault', 'robbery', 'narcotics',
  'homicide', 'sexual_assault', 'fraud', 'use_of_force', 'death', 'arson',
]);

const INVESTIGATIVE_EXTRA: ChecklistDef[] = [
  // Evidence OR attached files (photos, reports, PDFs) satisfy the evidence check.
  { key: 'evidence', label: 'Evidence logged', required: true, test: (s) => has(s.evidence) || has(s.attachments) },
  { key: 'suspect', label: 'Suspect identified', required: false, test: (s) => !!s.suspect_identified },
  { key: 'solvability', label: 'Solvability assessed', required: false, test: (s) => (s.solvability_score ?? 0) > 0 },
];

/** The merged checklist for a case type (common + investigative extras). */
export function getChecklist(caseType?: string | null): ChecklistDef[] {
  const t = String(caseType || '').toLowerCase();
  return INVESTIGATIVE.has(t) ? [...COMMON, ...INVESTIGATIVE_EXTRA] : COMMON;
}

export function evaluateCompleteness(caseType: string | null | undefined, signals: CompletenessSignals): CompletenessResult {
  const checklist = getChecklist(caseType);
  const items: ChecklistResult[] = checklist.map((d) => ({ key: d.key, label: d.label, required: d.required, met: !!d.test(signals) }));
  const required = items.filter((i) => i.required);
  const requiredMet = required.filter((i) => i.met).length;
  const requiredTotal = required.length;
  const percent = requiredTotal === 0 ? 100 : Math.round((requiredMet / requiredTotal) * 100);
  return {
    percent,
    requiredTotal,
    requiredMet,
    items,
    missing: required.filter((i) => !i.met).map((i) => i.label),
  };
}
