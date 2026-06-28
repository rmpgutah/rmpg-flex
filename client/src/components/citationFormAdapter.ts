import type { CitationData, CitationViolation } from '../utils/pdf/v2/forms/citation';
import type { ViolationDraft } from './violationStackHelpers';

export function formToData(form: Partial<CitationData>, violations: ViolationDraft[]): CitationData {
  const data: CitationData = { ...form };
  if (violations.length > 0) {
    data.violations = violations.map<CitationViolation>((v) => ({
      statute_citation: v.statute_citation,
      description: v.description,
      offense_level: v.offense_level,
      fine_amount: v.fine_amount,
    }));
  }
  return data;
}
