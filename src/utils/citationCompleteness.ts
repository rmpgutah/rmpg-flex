// Citation data-completeness scoring. Pure: a required-item checklist
// evaluated against computed signals, mirroring evaluateCompleteness in
// caseCompleteness.ts. Percent/grade are over REQUIRED items only.

export interface CitationCompletenessSignals {
  person_id?: number | null;
  person_name?: string | null;
  violation_description?: string | null;
  violation_count?: number;
  issuing_officer_id?: number | null;
  issuing_officer_name?: string | null;
  court_date?: string | null;
  appearance_required?: number | null;
  vehicle_description?: string | null;
  vehicle_plate?: string | null;
}

interface ChecklistDef {
  key: string;
  label: string;
  required: boolean;
  test: (s: CitationCompletenessSignals) => boolean;
}

export interface CitationCompletenessResult {
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  score: number;
  missing_required: string[];
}

const CHECKLIST: ChecklistDef[] = [
  { key: 'subject', label: 'Subject identified', required: true, test: (s) => !!(s.person_id || s.person_name?.trim()) },
  { key: 'violation', label: 'Violation description recorded', required: true, test: (s) => !!s.violation_description?.trim() || (s.violation_count ?? 0) > 0 },
  { key: 'officer', label: 'Issuing officer recorded', required: true, test: (s) => !!(s.issuing_officer_id || s.issuing_officer_name?.trim()) },
  {
    key: 'court_date',
    label: 'Court date set',
    required: true,
    test: (s) => !s.appearance_required || !!s.court_date?.trim(),
  },
  { key: 'vehicle', label: 'Vehicle information recorded', required: false, test: (s) => !!(s.vehicle_description?.trim() || s.vehicle_plate?.trim()) },
];

const gradeFor = (score: number): CitationCompletenessResult['grade'] => {
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 60) return 'C';
  if (score >= 40) return 'D';
  return 'F';
};

export function evaluateCitationCompleteness(signals: CitationCompletenessSignals): CitationCompletenessResult {
  const required = CHECKLIST.filter((d) => d.required);
  const requiredMet = required.filter((d) => d.test(signals)).length;
  const score = required.length === 0 ? 100 : Math.round((requiredMet / required.length) * 100);
  const missing_required = required.filter((d) => !d.test(signals)).map((d) => d.label);
  return { grade: gradeFor(score), score, missing_required };
}
