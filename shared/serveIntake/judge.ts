// SHARED types for the serve-intake quality gate (judge).
// Both Worker (src/utils/serveIntakeJudge.ts) and React
// (client/src/types/serveIntakeJudge.ts) import from this single copy.
// Do NOT duplicate. CI guard: scripts/check-serve-intake-dupes.sh.

export interface FieldVerdict {
  ok: boolean;
  reason: string | null;
  suggested_value: string | null;
  judge_confidence: number;
  source: 'heuristic' | 'claude' | 'workers_ai';
}
