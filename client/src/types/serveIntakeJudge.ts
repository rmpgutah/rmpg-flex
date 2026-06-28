// Mirror of FieldVerdict from src/utils/serveIntakeJudge.ts. Type-only —
// stays in lockstep manually (same convention as serveIntakeDefendants).
export interface FieldVerdict {
  ok: boolean;
  reason: string | null;
  suggested_value: string | null;
  judge_confidence: number;
  source: 'heuristic' | 'claude' | 'workers_ai';
}
