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
