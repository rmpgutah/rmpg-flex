// Pure helpers for the fleet vehicle inspection (DVIR). The route derives the
// out-of-service decision server-side from the submitted checklist rather than
// trusting a client flag. Dependency-free → vitest without a D1 binding.

export interface InspectionChecklistItem {
  item?: string;
  category?: string;
  status?: string;    // pass | defect | fail | na
  severity?: string;  // minor | major | critical
  note?: string;
  notes?: string;
}

export interface InspectionSummary {
  result: 'pass' | 'fail';   // fail = at least one defect (back-compat with existing rows)
  defects: number;
  oos: boolean;              // a critical-severity defect → vehicle out of service
  criticalItems: string[];
}

function isDefect(status: unknown): boolean {
  const s = String(status ?? '').toLowerCase();
  return s === 'defect' || s === 'fail';
}

/** Roll a submitted checklist up into a result + OOS decision. */
export function summarizeInspection(items: InspectionChecklistItem[] | undefined): InspectionSummary {
  let defects = 0;
  let oos = false;
  const criticalItems: string[] = [];
  for (const it of items ?? []) {
    if (!isDefect(it.status)) continue;
    defects++;
    if (String(it.severity ?? '').toLowerCase() === 'critical') {
      oos = true;
      if (it.item) criticalItems.push(it.item);
    }
  }
  return { result: defects > 0 ? 'fail' : 'pass', defects, oos, criticalItems };
}
